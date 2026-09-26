import { config } from '../shared/config';
import { checkFreeDiskSpace } from '../shared/disk-util';

type DiskStatus = ReturnType<typeof checkFreeDiskSpace>;
import { checkSystemRequirements, type SystemRequirementsResult } from '../shared/sys-check';
import { getDatabaseStatus, retryMigration, type DatabaseStatus } from '../db';
import { logErrorToFile } from '../shared/error-logger';
import { getSettings, saveSettings } from '../shared/settings-store';
import { migrateLegacyModelAssets } from '../shared/model-migration';
import { downloadWhisperBinary, downloadWhisperModel, getWhisperStatus } from './whisper-manager';
import { getOllamaStatus, pullLocalModel, type OllamaStatus } from './ollama-manager';
import { downloadPiperBinary, downloadPiperVoice, getPiperStatus } from './piper-manager';
import {
  evaluatePipelineReadiness,
  refreshPipelineReadiness,
  type PipelineReadiness,
  type StageReadiness,
} from './readiness';

export interface SetupStatus {
  isComplete: boolean;
  overallProgress: number; // 0 to 100
  stepText: string;
  error?: string | null;
  diskSpaceOk: boolean;
  freeSpaceGb: number;
  system: SystemRequirementsResult;
  db: DatabaseStatus;
  ollama: OllamaStatus;
  whisper: ReturnType<typeof getWhisperStatus>;
  piper: ReturnType<typeof getPiperStatus>;
  /** Ordered pipeline readiness (STT -> LLM -> TTS). */
  pipeline: PipelineReadiness;
}

let isSettingUp = false;
let lastSetupError: string | null = null;
let setupLogs: string[] = [];
let legacyMigrationChecked = false;

function ensureLegacyMigration(): void {
  if (legacyMigrationChecked) return;
  migrateLegacyModelAssets();
  legacyMigrationChecked = true;
}

export function getLastError(): string | null {
  return lastSetupError;
}

export function clearLastError(): void {
  lastSetupError = null;
}

export function getSetupLogs(): string[] {
  return [...setupLogs];
}

export function addSetupLog(msg: string): void {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  setupLogs.push(entry);
  if (setupLogs.length > 100) setupLogs.shift();
  console.log(entry);
}

/**
 * Builds the sequential STT -> LLM -> TTS step text and overall progress from
 * the shared readiness gate. Stages before the blocker count as complete, the
 * blocking stage contributes partial progress, later stages stay at 0.
 */
function buildSequentialProgress(
  pipeline: PipelineReadiness,
  dbStatus: DatabaseStatus,
  disk: DiskStatus
): { isComplete: boolean; overallProgress: number; stepText: string } {
  if (pipeline.ready && dbStatus.status === 'ready' && !lastSetupError) {
    return {
      isComplete: true,
      overallProgress: 100,
      stepText: 'pixi voice pipeline fully set up (STT -> LLM -> TTS) and ready.',
    };
  }

  let stepText = 'pixi local offline models are fully set up and ready.';
  if (dbStatus.status === 'error') {
    stepText = `Database initialization error: ${dbStatus.errorText}`;
  } else if (lastSetupError) {
    stepText = `Setup Error: ${lastSetupError}`;
  } else if (!disk.isSufficient) {
    stepText = `Insufficient disk space: 3.0 GB required, only ${disk.freeGb} GB free on ${disk.targetPath}.`;
  } else if (pipeline.currentStage) {
    const stageIndex = { stt: 1, llm: 2, tts: 3 } as const;
    const idx = stageIndex[pipeline.currentStage];
    const stage = pipeline.stages.find((s) => s.stage === pipeline.currentStage) as StageReadiness;
    stepText = `Setting up pixi (${idx}/3) — ${stage.label}: ${stage.statusText}`;
  } else if (!pipeline.ready) {
    stepText = pipeline.nextBlocker || 'Setup is not complete yet.';
  }

  return {
    isComplete: false,
    overallProgress: pipeline.overallProgress,
    stepText,
  };
}

/**
 * Returns complete setup status combining Whisper STT, Ollama LLM, Piper TTS,
 * disk space, system specs, and DB health — evaluated strictly in pipeline
 * order (STT -> LLM -> TTS) via the shared readiness gate.
 */
export async function getFullSetupStatus(): Promise<SetupStatus> {
  ensureLegacyMigration();
  const system = checkSystemRequirements();
  const dbStatus = getDatabaseStatus();
  const disk = checkFreeDiskSpace();

  const pipeline = await evaluatePipelineReadiness();
  const seq = buildSequentialProgress(pipeline, dbStatus, disk);

  const ollama = await getOllamaStatus();

  return {
    isComplete: seq.isComplete,
    overallProgress: seq.overallProgress,
    stepText: seq.stepText,
    error:
      lastSetupError ||
      (dbStatus.status === 'error' ? dbStatus.errorText : null) ||
      (!disk.isSufficient ? `Insufficient disk space (${disk.freeGb} GB free)` : null),
    diskSpaceOk: disk.isSufficient,
    freeSpaceGb: disk.freeGb,
    system,
    db: dbStatus,
    ollama,
    whisper: getWhisperStatus(),
    piper: getPiperStatus(),
    pipeline,
  };
}

/**
 * Runs the first-run setup sequence strictly in pipeline order:
 *   Step 1/3: STT  (Whisper binary + model)
 *   Step 2/3: LLM  (Ollama service + model pull)
 *   Step 3/3: TTS  (Piper binary + voice)
 * Each stage must complete before the next begins — no parallel installs.
 */
export async function runFullSetupSequence(
  onProgress?: (overallPercent: number, statusText: string) => void
): Promise<boolean> {
  if (isSettingUp) {
    addSetupLog('Setup sequence already in progress.');
    return false;
  }

  isSettingUp = true;
  lastSetupError = null;
  addSetupLog('Starting sequential 3-step setup sequence (STT -> LLM -> TTS)...');
  ensureLegacyMigration();

  try {
    // 0a. System Requirements check (warnings logged to terminal console, non-blocking for UI)
    const sys = checkSystemRequirements();
    if (sys.warnings.length > 0 || sys.errors.length > 0) {
      const warnMsg = `System spec notice: ${(sys.errors.concat(sys.warnings)).join(' ')}`;
      addSetupLog(warnMsg);
      console.warn(`[Setup System Warning] ${warnMsg}`);
    }

    // 0b. Disk space check
    const disk = checkFreeDiskSpace();
    if (!disk.isSufficient) {
      const errMsg = `Insufficient disk space: 3.0 GB required, but only ${disk.freeGb} GB free on drive ${disk.targetPath}`;
      addSetupLog(errMsg);
      lastSetupError = errMsg;
      isSettingUp = false;
      if (onProgress) onProgress(0, errMsg);
      return false;
    }

    // Pre-compute which stages actually need local downloads.
    const cloudStt = config.stt.provider !== 'whisper';
    const cloudLlm = config.llm.provider !== 'ollama';
    const cloudTts = config.tts.provider !== 'piper';

    // ---------- STEP 1/3: STT (Whisper binary + model) ----------
    if (!cloudStt) {
      const whisperStatus = getWhisperStatus();
      if (!whisperStatus.binaryDownloaded) {
        addSetupLog('Step 1/3 (STT): Downloading Whisper executable binary for Windows...');
        if (onProgress) onProgress(2, 'Step 1/3 (STT): Downloading whisper-cli.exe...');
        const binOk = await downloadWhisperBinary();
        if (!binOk) {
          throw new Error('Failed to download Whisper executable binary (whisper-cli.exe).');
        }
      }
      if (!whisperStatus.modelDownloaded) {
        addSetupLog('Step 1/3 (STT): Downloading local Whisper STT model...');
        const modelOk = await downloadWhisperModel(whisperStatus.modelName, (percent) => {
          const overall = Math.round(4 + (percent / 100) * 31); // STT occupies 0-35%
          const logMsg = `Step 1/3 (Whisper STT): ${percent}%`;
          if (percent % 25 === 0) addSetupLog(logMsg);
          if (onProgress) onProgress(overall, logMsg);
        });
        if (!modelOk) {
          throw new Error(`Failed to download Whisper STT model (${whisperStatus.modelName}).`);
        }
      }
      addSetupLog('Step 1/3 (STT): Whisper STT ready.');
    } else {
      addSetupLog('Step 1/3 (STT): Cloud STT provider active — local Whisper download skipped.');
    }

    // ---------- STEP 2/3: LLM (Ollama service + model) ----------
    if (!cloudLlm) {
      const ollamaStatus = await getOllamaStatus();
      if (!ollamaStatus.installed) {
        const errMsg = 'Ollama is not installed. Download from https://ollama.com or configure OPENAI_API_KEY / GEMINI_API_KEY in .env';
        addSetupLog(errMsg);
        lastSetupError = errMsg;
        isSettingUp = false;
        if (onProgress) onProgress(35, errMsg);
        return false;
      }
      if (!ollamaStatus.running) {
        const errMsg = 'Ollama server is not running on port 11434. Please launch Ollama service.';
        addSetupLog(errMsg);
        lastSetupError = errMsg;
        isSettingUp = false;
        if (onProgress) onProgress(35, errMsg);
        return false;
      }
      if (!ollamaStatus.modelDownloaded) {
        addSetupLog('Step 2/3 (LLM): Pulling local Ollama LLM model...');
        const pulled = await pullLocalModel((percent) => {
          const overall = Math.round(35 + (percent / 100) * 50); // LLM occupies 35-85%
          const logMsg = `Step 2/3 (Ollama LLM): ${percent}%`;
          if (percent % 25 === 0) addSetupLog(logMsg);
          if (onProgress) onProgress(overall, logMsg);
        });
        if (!pulled) {
          throw new Error('Failed to pull local Ollama LLM model.');
        }
      }
      addSetupLog('Step 2/3 (LLM): Ollama LLM ready.');
    } else {
      addSetupLog('Step 2/3 (LLM): Cloud LLM provider active — local Ollama model pull skipped.');
    }

    // ---------- STEP 3/3: TTS (Piper binary + voice) ----------
    if (!cloudTts) {
      const piperStatus = getPiperStatus();
      if (!piperStatus.binaryDownloaded) {
        addSetupLog('Step 3/3 (TTS): Downloading Piper executable binary for Windows...');
        if (onProgress) onProgress(85, 'Step 3/3 (TTS): Downloading piper.exe...');
        const binOk = await downloadPiperBinary();
        if (!binOk) {
          throw new Error('Failed to download Piper TTS binary (piper.exe).');
        }
      }
      if (!piperStatus.voiceDownloaded) {
        addSetupLog('Step 3/3 (TTS): Downloading local Piper TTS voice model...');
        const voiceOk = await downloadPiperVoice(piperStatus.voiceName, (percent) => {
          const overall = Math.round(85 + (percent / 100) * 15); // TTS occupies 85-100%
          const logMsg = `Step 3/3 (Piper Voice): ${percent}%`;
          if (percent % 25 === 0) addSetupLog(logMsg);
          if (onProgress) onProgress(overall, logMsg);
        });
        if (!voiceOk) {
          throw new Error(`Failed to download Piper TTS voice model (${piperStatus.voiceName}).`);
        }
      }
      addSetupLog('Step 3/3 (TTS): Piper TTS ready.');
    } else {
      addSetupLog('Step 3/3 (TTS): Cloud TTS provider active — local Piper download skipped.');
    }

    isSettingUp = false;
    lastSetupError = null;
    addSetupLog('Sequential setup sequence completed successfully (STT -> LLM -> TTS).');

    // Refresh the shared readiness gate so the orchestrator/scheduler/renderer
    // see the new state immediately.
    await refreshPipelineReadiness(true);

    let dbStatus = getDatabaseStatus();
    if (dbStatus.status !== 'ready') {
      addSetupLog('DB not ready after downloads, retrying migration...');
      retryMigration();
      dbStatus = getDatabaseStatus();
    }
    if (dbStatus.status === 'ready') {
      if (!getSettings().onboardingCompleted) {
        try {
          saveSettings({ onboardingCompleted: true });
        } catch {}
      }
    } else {
      lastSetupError = `Setup completed but database failed: ${dbStatus.errorText}`;
      addSetupLog(lastSetupError);
    }
    if (onProgress) {
      onProgress(100, 'pixi voice pipeline fully set up (STT -> LLM -> TTS)!');
    }
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logErrorToFile(err, 'SetupSequence');
    addSetupLog(`Exception during setup sequence: ${errMsg}`);
    lastSetupError = errMsg;
    isSettingUp = false;
    if (onProgress) onProgress(0, `Setup Failed: ${errMsg}`);
    return false;
  }
}

/**
 * Passive startup check (no downloads). Offline model downloads only begin
 * when the user opts in via onboarding (setup:begin / retrySetup IPC).
 */
export async function ensureFullSetupReady(): Promise<void> {
  const status = await getFullSetupStatus();
  if (!status.isComplete) {
    addSetupLog(
      `Voice pipeline not ready yet (blocked at ${status.pipeline.currentStage ?? 'unknown'}). Downloads will begin once you choose a setup mode in onboarding.`
    );
  }
}
