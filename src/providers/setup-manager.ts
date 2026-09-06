import { getOllamaStatus, pullLocalModel, type OllamaStatus } from './ollama-manager';
import { getWhisperStatus, downloadWhisperModel, downloadWhisperBinary, type WhisperStatus } from './whisper-manager';
import { getPiperStatus, downloadPiperVoice, downloadPiperBinary, type PiperStatus } from './piper-manager';
import { checkFreeDiskSpace } from '../shared/disk-util';
import { checkSystemRequirements, type SystemRequirementsResult } from '../shared/sys-check';
import { getDatabaseStatus, retryMigration, type DatabaseStatus } from '../db';
import { config } from '../shared/config';
import { logErrorToFile } from '../shared/error-logger';
import { saveSettings } from '../shared/settings-store';
import { migrateLegacyModelAssets } from '../shared/model-migration';

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
  whisper: WhisperStatus;
  piper: PiperStatus;
  logs: string[];
}

let isSettingUp = false;
let lastSetupError: string | null = null;
let setupLogs: string[] = [];

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
 * Returns complete setup status combining Ollama LLM (~2GB), Whisper STT (~460MB), Piper TTS (~50-60MB), Disk Space, System Specs, and DB Health.
 */
export async function getFullSetupStatus(): Promise<SetupStatus> {
  migrateLegacyModelAssets();
  const system = checkSystemRequirements();
  const dbStatus = getDatabaseStatus();
  const disk = checkFreeDiskSpace();
  const ollama = await getOllamaStatus();
  const whisper = getWhisperStatus();
  const piper = getPiperStatus();

  // If using cloud LLM (OpenAI, Gemini, Groq, Cloudflare), local Ollama model pull is optional
  const isCloudLlmActive = config.llm.provider !== 'ollama';
  const ollamaReady = isCloudLlmActive || (ollama.installed && ollama.running && ollama.modelDownloaded);

  const whisperReady = whisper.modelDownloaded && whisper.binaryDownloaded;
  const piperReady = piper.voiceDownloaded && piper.binaryDownloaded;
  const isDbReady = dbStatus.status === 'ready';
  const isComplete = ollamaReady && whisperReady && piperReady && isDbReady && !lastSetupError;

  let overallProgress = 100;
  if (!isComplete) {
    const oPart = ollamaReady ? 70 : (ollama.downloadProgress / 100) * 70;
    const wPart = whisperReady ? 20 : (whisper.downloadProgress / 100) * 20;
    const pPart = piperReady ? 10 : (piper.downloadProgress / 100) * 10;
    overallProgress = Math.round(oPart + wPart + pPart);
  }

  let stepText = 'pixi local offline models are fully set up and ready.';
  if (dbStatus.status === 'error') {
    stepText = `Database initialization error: ${dbStatus.errorText}`;
  } else if (lastSetupError) {
    stepText = `Setup Error: ${lastSetupError}`;
  } else if (!disk.isSufficient) {
    stepText = `Insufficient disk space: 3.0 GB required, only ${disk.freeGb} GB free on ${disk.targetPath}.`;
  } else if (!ollamaReady) {
    if (!ollama.installed) {
      stepText = 'Ollama is not installed. Download Ollama from https://ollama.com or add a cloud LLM key to .env.';
    } else if (!ollama.running) {
      stepText = 'Ollama is installed but not running. Start Ollama ("ollama serve") to download local model.';
    } else {
      stepText = `Setting up pixi (1/3): Pulling Ollama LLM model (${ollama.downloadProgress}%)...`;
    }
  } else if (!whisperReady) {
    stepText = `Setting up pixi (2/3): Downloading Whisper STT binary & model (${whisper.downloadProgress}%)...`;
  } else if (!piperReady) {
    stepText = `Setting up pixi (3/3): Downloading Piper TTS binary & voice model (${piper.downloadProgress}%)...`;
  }

  if (isComplete) {
    try {
      saveSettings({ onboardingCompleted: true });
    } catch {}
  }

  return {
    isComplete,
    overallProgress,
    stepText,
    error: lastSetupError || (dbStatus.status === 'error' ? dbStatus.errorText : null) || (!disk.isSufficient ? `Insufficient disk space (${disk.freeGb} GB free)` : null),
    diskSpaceOk: disk.isSufficient,
    freeSpaceGb: disk.freeGb,
    system,
    db: dbStatus,
    ollama,
    whisper,
    piper,
    logs: getSetupLogs(),
  };
}

/**
 * Runs the unified 3-step first-run setup sequence combining LLM, STT, and TTS downloads with error propagation.
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
  addSetupLog('Starting 3-step unified first-run setup sequence...');
  migrateLegacyModelAssets();

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

    // Step 1: Ollama local LLM model setup (~2GB, 70% weight)
    const isCloudLlmActive = config.llm.provider !== 'ollama';
    if (!isCloudLlmActive) {
      const ollamaStatus = await getOllamaStatus();
      if (!ollamaStatus.installed) {
        const errMsg = 'Ollama is not installed. Download from https://ollama.com or configure OPENAI_API_KEY / GEMINI_API_KEY in .env';
        addSetupLog(errMsg);
        lastSetupError = errMsg;
        isSettingUp = false;
        if (onProgress) onProgress(0, errMsg);
        return false;
      }
      if (!ollamaStatus.running) {
        const errMsg = 'Ollama server is not running on port 11434. Please launch Ollama service.';
        addSetupLog(errMsg);
        lastSetupError = errMsg;
        isSettingUp = false;
        if (onProgress) onProgress(0, errMsg);
        return false;
      }
      if (!ollamaStatus.modelDownloaded) {
        addSetupLog('Step 1 of 3: Pulling local Ollama LLM model...');
        const pulled = await pullLocalModel((percent) => {
          const overall = Math.round((percent / 100) * 70);
          const logMsg = `Step 1/3 (Ollama LLM): ${percent}%`;
          if (percent % 25 === 0) addSetupLog(logMsg);
          if (onProgress) onProgress(overall, logMsg);
        });
        if (!pulled) {
          throw new Error('Failed to pull local Ollama LLM model.');
        }
      }
    }

    // Step 2: Ensure Whisper local STT binary & model are downloaded (~460MB, 20% weight)
    const whisperStatus = getWhisperStatus();
    if (!whisperStatus.binaryDownloaded) {
      addSetupLog('Step 2a of 3: Downloading Whisper executable binary for Windows...');
      if (onProgress) onProgress(72, 'Step 2/3 (Whisper Binary): Downloading whisper-cli.exe...');
      const binOk = await downloadWhisperBinary();
      if (!binOk) {
        throw new Error('Failed to download Whisper executable binary (whisper-cli.exe).');
      }
    }
    if (!whisperStatus.modelDownloaded) {
      addSetupLog('Step 2b of 3: Downloading local Whisper STT model...');
      const modelOk = await downloadWhisperModel(whisperStatus.modelName, (percent) => {
        const overall = Math.round(74 + (percent / 100) * 16);
        const logMsg = `Step 2/3 (Whisper STT): ${percent}%`;
        if (percent % 25 === 0) addSetupLog(logMsg);
        if (onProgress) onProgress(overall, logMsg);
      });
      if (!modelOk) {
        throw new Error(`Failed to download Whisper STT model (${whisperStatus.modelName}).`);
      }
    }

    // Step 3: Ensure Piper local TTS binary and voice model are downloaded (~50-60MB, 10% weight)
    const piperStatus = getPiperStatus();
    if (!piperStatus.binaryDownloaded) {
      addSetupLog('Step 3a of 3: Downloading Piper executable binary for Windows...');
      if (onProgress) onProgress(92, 'Step 3/3 (Piper Binary): Downloading piper.exe...');
      const binOk = await downloadPiperBinary();
      if (!binOk) {
        throw new Error('Failed to download Piper TTS binary (piper.exe).');
      }
    }
    if (!piperStatus.voiceDownloaded) {
      addSetupLog('Step 3b of 3: Downloading local Piper TTS voice model...');
      const voiceOk = await downloadPiperVoice(piperStatus.voiceName, (percent) => {
        const overall = Math.round(95 + (percent / 100) * 5);
        const logMsg = `Step 3/3 (Piper Voice): ${percent}%`;
        if (percent % 25 === 0) addSetupLog(logMsg);
        if (onProgress) onProgress(overall, logMsg);
      });
      if (!voiceOk) {
        throw new Error(`Failed to download Piper TTS voice model (${piperStatus.voiceName}).`);
      }
    }

    isSettingUp = false;
    lastSetupError = null;
    addSetupLog('3-step setup sequence completed successfully.');

    let dbStatus = getDatabaseStatus();
    if (dbStatus.status !== 'ready') {
      addSetupLog('DB not ready after downloads, retrying migration...');
      retryMigration();
      dbStatus = getDatabaseStatus();
    }
    if (dbStatus.status === 'ready') {
      try {
        saveSettings({ onboardingCompleted: true });
      } catch {}
    } else {
      lastSetupError = `Setup completed but database failed: ${dbStatus.errorText}`;
      addSetupLog(lastSetupError);
    }
    if (onProgress) {
      onProgress(100, 'pixi local offline models fully set up!');
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

let lastReportedOverall = -1;

/**
 * Non-blocking auto-check executed on application startup.
 */
export async function ensureFullSetupReady(
  onProgress?: (percent: number, text: string) => void,
  onError?: (errText: string) => void
): Promise<void> {
  const status = await getFullSetupStatus();
  if (!status.isComplete && !lastSetupError) {
    addSetupLog('Auto-triggering 3-step background setup for offline models...');
    runFullSetupSequence((percent, text) => {
      if (onProgress) onProgress(percent, text);
      const step10 = Math.floor(percent / 10) * 10;
      if (step10 !== lastReportedOverall || percent === 100) {
        lastReportedOverall = step10;
        addSetupLog(`Overall ${percent}% | ${text}`);
      }
    }).then((success) => {
      if (!success && lastSetupError && onError) {
        onError(lastSetupError);
      }
    }).catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      addSetupLog(`Auto-run error: ${errMsg}`);
      if (onError) onError(errMsg);
    });
  }
}
