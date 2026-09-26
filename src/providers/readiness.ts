import { config } from '../shared/config';
import { getDatabaseStatus } from '../db';
import { getOllamaStatus } from './ollama-manager';
import { getWhisperStatus } from './whisper-manager';
import { getPiperStatus } from './piper-manager';

/**
 * Ordered readiness gate for the voice pipeline: STT -> LLM -> TTS.
 *
 * Every consumer (orchestrator request handling, reminder scheduler, renderer
 * microphone capture) asks this module whether the pipeline is ready instead of
 * probing individual providers independently. The pipeline only reports ready
 * once EVERY stage in the ordered chain is ready, evaluated and reported in
 * strict order: a missing STT model is reported before the LLM, and the LLM
 * before TTS, so downstream services never start ahead of upstream ones.
 */

export type PipelineStage = 'stt' | 'llm' | 'tts';

/** Execution & reporting order of the voice pipeline. */
export const PIPELINE_STAGE_ORDER: PipelineStage[] = ['stt', 'llm', 'tts'];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  stt: 'Speech recognition (Whisper STT)',
  llm: 'Language model (Ollama LLM)',
  tts: 'Speech synthesis (Piper TTS)',
};

export const STAGE_SHORT_LABELS: Record<PipelineStage, string> = {
  stt: 'STT',
  llm: 'LLM',
  tts: 'TTS',
};

/** Contribution of each stage to the overall 0-100 setup progress. */
const STAGE_WEIGHTS: Record<PipelineStage, number> = { stt: 35, llm: 50, tts: 15 };

export interface StageReadiness {
  stage: PipelineStage;
  label: string;
  /** False when a cloud provider is configured for this stage (local assets optional). */
  localRequired: boolean;
  ready: boolean;
  /** 0-100 download/setup progress for this stage alone. */
  progress: number;
  statusText: string;
}

export interface PipelineReadiness {
  ready: boolean;
  /** Ordered stages: index 0 = STT, 1 = LLM, 2 = TTS. */
  stages: StageReadiness[];
  /** First stage (in pipeline order) that is not ready; null when all are ready. */
  currentStage: PipelineStage | null;
  /** 0-100 across the ordered pipeline. */
  overallProgress: number;
  /** Human-readable reason the pipeline is blocked, if any. */
  nextBlocker: string | null;
  dbReady: boolean;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function evaluateSttStage(): Promise<StageReadiness> {
  const label = STAGE_LABELS.stt;
  const localRequired = config.stt.provider === 'whisper';
  if (!localRequired) {
    return {
      stage: 'stt',
      label,
      localRequired: false,
      ready: true,
      progress: 100,
      statusText: `Cloud STT provider "${config.stt.provider}" active. Local Whisper not required.`,
    };
  }

  const whisper = getWhisperStatus();
  const ready = whisper.binaryDownloaded && whisper.modelDownloaded;
  // Binary is ~40% of the stage, model download the remaining ~60%
  const progress = ready
    ? 100
    : clampProgress((whisper.binaryDownloaded ? 40 : 0) + (whisper.binaryDownloaded ? (whisper.downloadProgress / 100) * 60 : 0));

  let statusText = 'Ready.';
  if (whisper.downloading) {
    statusText = `Downloading Whisper STT model (${whisper.downloadProgress}%)...`;
  } else if (!whisper.binaryDownloaded) {
    statusText = 'Whisper STT executable not downloaded yet.';
  } else if (!whisper.modelDownloaded) {
    statusText = 'Whisper STT model not downloaded yet.';
  }

  return { stage: 'stt', label, localRequired: true, ready, progress, statusText };
}

async function evaluateLlmStage(): Promise<StageReadiness> {
  const label = STAGE_LABELS.llm;
  const localRequired = config.llm.provider === 'ollama';
  if (!localRequired) {
    return {
      stage: 'llm',
      label,
      localRequired: false,
      ready: true,
      progress: 100,
      statusText: `Cloud LLM provider "${config.llm.provider}" active. Local Ollama model not required.`,
    };
  }

  const ollama = await getOllamaStatus();
  const ready = ollama.installed && ollama.running && ollama.modelDownloaded;

  let progress = 0;
  let statusText = 'Ready.';
  if (ready) {
    progress = 100;
  } else if (!ollama.installed) {
    statusText = 'Ollama is not installed. Download it from https://ollama.com or add a cloud LLM key.';
  } else if (!ollama.running) {
    statusText = 'Ollama is installed but not running on port 11434.';
    progress = 10;
  } else if (ollama.downloading) {
    progress = clampProgress(20 + (ollama.downloadProgress / 100) * 80);
    statusText = `Pulling Ollama LLM model (${ollama.downloadProgress}%)...`;
  } else {
    statusText = `Ollama LLM model "${ollama.modelName}" not downloaded yet.`;
    progress = 20;
  }

  return { stage: 'llm', label, localRequired: true, ready, progress, statusText };
}

async function evaluateTtsStage(): Promise<StageReadiness> {
  const label = STAGE_LABELS.tts;
  const localRequired = config.tts.provider === 'piper';
  if (!localRequired) {
    return {
      stage: 'tts',
      label,
      localRequired: false,
      ready: true,
      progress: 100,
      statusText: `Cloud TTS provider "${config.tts.provider}" active. Local Piper voice not required.`,
    };
  }

  const piper = getPiperStatus();
  const ready = piper.binaryDownloaded && piper.voiceDownloaded;
  // Binary is ~40% of the stage, voice model the remaining ~60%
  const progress = ready
    ? 100
    : clampProgress((piper.binaryDownloaded ? 40 : 0) + (piper.binaryDownloaded ? (piper.downloadProgress / 100) * 60 : 0));

  let statusText = 'Ready.';
  if (piper.downloading) {
    statusText = `Downloading Piper TTS voice (${piper.downloadProgress}%)...`;
  } else if (!piper.binaryDownloaded) {
    statusText = 'Piper TTS executable not downloaded yet.';
  } else if (!piper.voiceDownloaded) {
    statusText = 'Piper TTS voice model not downloaded yet.';
  }

  return { stage: 'tts', label, localRequired: true, ready, progress, statusText };
}

/**
 * Evaluates the full pipeline in strict order (STT -> LLM -> TTS).
 * Stages before the blocker count as complete, the blocking stage contributes
 * partial progress, and everything after it stays at 0 — mirroring the rule
 * that downstream services are never started ahead of upstream ones.
 */
export async function evaluatePipelineReadiness(): Promise<PipelineReadiness> {
  const [stt, llm, tts] = await Promise.all([evaluateSttStage(), evaluateLlmStage(), evaluateTtsStage()]);
  const stages = [stt, llm, tts];

  const dbStatus = getDatabaseStatus();
  const dbReady = dbStatus.status === 'ready';

  let overallProgress = 0;
  let currentStage: PipelineStage | null = null;
  let nextBlocker: string | null = null;

  for (const stage of stages) {
    if (stage.ready) {
      overallProgress += STAGE_WEIGHTS[stage.stage];
      continue;
    }
    if (!currentStage) {
      currentStage = stage.stage;
      nextBlocker = stage.statusText;
      overallProgress += (stage.progress / 100) * STAGE_WEIGHTS[stage.stage];
    }
    // Later stages remain at 0 progress (sequentially waiting)
  }

  if (!dbReady) {
    nextBlocker = `Database initialization error: ${dbStatus.errorText}`;
  }

  return {
    ready: !currentStage && dbReady,
    stages,
    currentStage,
    overallProgress: clampProgress(overallProgress),
    nextBlocker,
    dbReady,
  };
}

let cachedReadiness: PipelineReadiness | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 1500;
let pollTimer: NodeJS.Timeout | null = null;
let lastReadyState: boolean | null = null;
/** Signature of the last pushed readiness snapshot, for change detection. */
let lastPushSignature: string | null = null;
const changeListeners = new Set<(readiness: PipelineReadiness) => void>();

/**
 * Cached readiness evaluation shared by all consumers. Bypasses the cache with
 * `force` for critical decisions (request gating, post-setup refresh).
 */
export async function refreshPipelineReadiness(force = false): Promise<PipelineReadiness> {
  const now = Date.now();
  if (!force && cachedReadiness && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedReadiness;
  }

  cachedReadiness = await evaluatePipelineReadiness();
  cacheTimestamp = Date.now();

  const previousReady = lastReadyState;
  lastReadyState = cachedReadiness.ready;

  if (previousReady !== null && previousReady !== cachedReadiness.ready) {
    console.log(
      cachedReadiness.ready
        ? '[Readiness] Voice pipeline is READY (STT -> LLM -> TTS all set up).'
        : `[Readiness] Voice pipeline is NOT ready (blocked at ${cachedReadiness.currentStage ? STAGE_SHORT_LABELS[cachedReadiness.currentStage] : 'unknown'}: ${cachedReadiness.nextBlocker})`
    );
  }

  // Push to listeners whenever the snapshot meaningfully changes (ready flip
  // OR per-stage progress/status shift) so the UI can render live stage
  // progress instead of only end-state flips.
  const signature = JSON.stringify([
    cachedReadiness.ready,
    cachedReadiness.currentStage,
    cachedReadiness.overallProgress,
    cachedReadiness.stages.map((s) => [s.stage, s.ready, s.progress, s.statusText]),
  ]);
  if (signature !== lastPushSignature) {
    const isFirstPush = lastPushSignature === null;
    lastPushSignature = signature;
    for (const listener of changeListeners) {
      try {
        listener(cachedReadiness);
      } catch (err) {
        console.warn('[Readiness] Change listener error:', err);
      }
    }
    // Skip logging the very first evaluation (app boot snapshot)
    if (!isFirstPush) {
      console.log(
        `[Readiness] Update — ready=${cachedReadiness.ready}, stage=${cachedReadiness.currentStage ?? 'none'}, progress=${cachedReadiness.overallProgress}%`
      );
    }
  }

  return cachedReadiness;
}

export function getCachedPipelineReadiness(): PipelineReadiness | null {
  return cachedReadiness;
}

/** Fast synchronous check for non-critical callers (e.g. reminder scheduler). */
export function isPipelineReady(): boolean {
  return cachedReadiness?.ready ?? false;
}

/**
 * Hard gate for pipeline entry points (audio/text requests). Returns cached
 * state when ready; re-evaluates fresh when not, so the gate opens the moment
 * setup completes.
 */
export async function ensurePipelineReady(): Promise<PipelineReadiness> {
  const cached = getCachedPipelineReadiness();
  if (cached?.ready) return cached;
  return refreshPipelineReadiness(true);
}

/**
 * Background poller that keeps the cached readiness fresh so the renderer,
 * scheduler, and orchestrator always see current state. Started once by the
 * orchestrator at boot.
 */
export function startReadinessWatcher(intervalMs = 2000): void {
  if (pollTimer) return;

  const tick = () => {
    refreshPipelineReadiness().catch((err) => console.warn('[Readiness] Evaluation failed:', err));
  };

  tick();
  pollTimer = setInterval(tick, intervalMs);
  console.log(`[Readiness] Pipeline readiness watcher started (polling every ${intervalMs}ms, order: STT -> LLM -> TTS).`);
}

export function onReadinessChange(listener: (readiness: PipelineReadiness) => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
