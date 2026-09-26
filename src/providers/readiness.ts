import { config } from '../shared/config';
import { getDatabaseStatus } from '../db';
import { getOllamaStatus } from './ollama-manager';
import { getWhisperStatus } from './whisper-manager';
import { getPiperStatus } from './piper-manager';

export type PipelineStage = 'stt' | 'llm' | 'tts';
export const PIPELINE_STAGE_ORDER: PipelineStage[] = ['stt', 'llm', 'tts'];
export const STAGE_LABELS: Record<PipelineStage, string> = {
  stt: 'Speech recognition (Whisper STT)',
  llm: 'Language model (Ollama LLM)',
  tts: 'Speech synthesis (Piper TTS)',
};
export const STAGE_SHORT_LABELS: Record<PipelineStage, string> = { stt: 'STT', llm: 'LLM', tts: 'TTS' };

export interface StageReadiness {
  stage: PipelineStage;
  label: string;
  localRequired: boolean;
  ready: boolean;
  progress: number;
  statusText: string;
}

export interface PipelineReadiness {
  ready: boolean;
  stages: StageReadiness[];
  currentStage: PipelineStage | null;
  overallProgress: number;
  nextBlocker: string | null;
  dbReady: boolean;
}

export async function evaluatePipelineReadiness(): Promise<PipelineReadiness> {
  const whisper = getWhisperStatus();
  const ollama = await getOllamaStatus();
  const piper = getPiperStatus();
  const dbStatus = getDatabaseStatus();
  const dbReady = dbStatus.status === 'ready';

  const sttLocal = config.stt.provider === 'whisper';
  const llmLocal = config.llm.provider === 'ollama';
  const ttsLocal = config.tts.provider === 'piper';

  const sttReady = !sttLocal || (whisper.binaryDownloaded && whisper.modelDownloaded);
  const llmReady = !llmLocal || (ollama.installed && ollama.running && ollama.modelDownloaded);
  const ttsReady = !ttsLocal || (piper.binaryDownloaded && piper.voiceDownloaded);

  const stages: StageReadiness[] = [
    {
      stage: 'stt',
      label: STAGE_LABELS.stt,
      localRequired: sttLocal,
      ready: sttReady,
      progress: sttReady ? 100 : whisper.downloadProgress,
      statusText: whisper.statusText,
    },
    {
      stage: 'llm',
      label: STAGE_LABELS.llm,
      localRequired: llmLocal,
      ready: llmReady,
      progress: llmReady ? 100 : ollama.downloadProgress,
      statusText: ollama.statusText,
    },
    {
      stage: 'tts',
      label: STAGE_LABELS.tts,
      localRequired: ttsLocal,
      ready: ttsReady,
      progress: ttsReady ? 100 : piper.downloadProgress,
      statusText: piper.statusText,
    },
  ];

  const firstBlocked = stages.find((s) => !s.ready);
  const completedCount = stages.filter((s) => s.ready).length;
  const overallProgress = Math.round((completedCount / stages.length) * 100);

  return {
    ready: !firstBlocked && dbReady,
    stages,
    currentStage: firstBlocked ? firstBlocked.stage : null,
    overallProgress,
    nextBlocker: firstBlocked ? firstBlocked.statusText : !dbReady ? `DB: ${dbStatus.errorText}` : null,
    dbReady,
  };
}

let cachedReadiness: PipelineReadiness | null = null;
let lastSignature = '';
const listeners = new Set<(r: PipelineReadiness) => void>();

export async function refreshPipelineReadiness(force = false): Promise<PipelineReadiness> {
  const readiness = await evaluatePipelineReadiness();
  cachedReadiness = readiness;

  const sig = `${readiness.ready}-${readiness.currentStage}-${readiness.overallProgress}`;
  if (sig !== lastSignature) {
    lastSignature = sig;
    for (const listener of listeners) {
      try { listener(readiness); } catch { /* ignore */ }
    }
  }
  return readiness;
}

export function getCachedPipelineReadiness(): PipelineReadiness | null {
  return cachedReadiness;
}

export function isPipelineReady(): boolean {
  return cachedReadiness?.ready ?? false;
}

export async function ensurePipelineReady(): Promise<PipelineReadiness> {
  return cachedReadiness?.ready ? cachedReadiness : refreshPipelineReadiness(true);
}

export function startReadinessWatcher(intervalMs = 2000): void {
  setInterval(() => {
    refreshPipelineReadiness().catch(() => {});
  }, intervalMs);
}

export function onReadinessChange(listener: (readiness: PipelineReadiness) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
