import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from '../shared/paths';
import { downloadFileWithProgress, downloadAndExtractZip } from '../shared/download';
import { findLocalBinary } from '../shared/disk-util';

export interface WhisperStatus {
  modelName: string;
  modelDownloaded: boolean;
  binaryDownloaded: boolean;
  downloading: boolean;
  downloadProgress: number; // 0 to 100
  statusText: string;
  modelPath: string;
}

const MODEL_URLS: Record<string, string> = {
  'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
};

const WHISPER_WINDOWS_BIN_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip';

let selectedModel = process.env.WHISPER_LOCAL_MODEL || 'small.en';
let isDownloading = false;
let downloadProgress = 0;

function modelsDir(): string {
  const dir = path.join(getAppPaths().userDataDir, 'models');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function findWhisperBinary(): string | undefined {
  return findLocalBinary({
    envVar: 'WHISPER_CPP_BINARY',
    recursive: true,
    binDir: path.join(getAppPaths().userDataDir, 'bin'),
  });
}

export function getSelectedModelName(): string {
  return selectedModel;
}

export function setSelectedModelName(modelName: string): void {
  if (MODEL_URLS[modelName]) {
    selectedModel = modelName;
    console.log(`[Whisper Manager] Selected local STT model changed to: "${selectedModel}"`);
  }
}

export function isModelDownloaded(modelName = selectedModel): boolean {
  const p = getModelPath(modelName);
  return fs.existsSync(p) && fs.statSync(p).size > 10 * 1024 * 1024;
}

export function getModelPath(modelName = selectedModel): string {
  return path.join(modelsDir(), `ggml-${modelName}.bin`);
}

export async function downloadWhisperBinary(): Promise<boolean> {
  if (findWhisperBinary()) return true;
  console.log('[Whisper Manager] Downloading Whisper executable for Windows...');
  try {
    await downloadAndExtractZip(
      WHISPER_WINDOWS_BIN_URL,
      path.join(getAppPaths().userDataDir, 'bin'),
      'whisper-bin-x64.zip',
    );
    return true;
  } catch (err) {
    console.error('[Whisper Manager Binary Download Error]:', err);
    return false;
  }
}

export async function downloadWhisperModel(
  modelName = selectedModel,
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  const url = MODEL_URLS[modelName];
  if (!url) {
    console.error(`[Whisper Manager] Unknown model: ${modelName}`);
    return false;
  }
  if (isModelDownloaded(modelName)) {
    if (onProgress) onProgress(100, `Whisper model ${modelName} ready.`);
    return true;
  }

  isDownloading = true;
  downloadProgress = 0;
  const targetPath = getModelPath(modelName);

  try {
    await downloadFileWithProgress(url, targetPath, {
      label: `Whisper model ${modelName}`,
      fileName: `ggml-${modelName}.bin`,
      defaultBytes: 460 * 1024 * 1024,
      onProgress: (pct) => {
        downloadProgress = pct;
        if (onProgress) onProgress(pct, `Downloading Whisper model ${modelName}: ${pct}%`);
      },
    });
    isDownloading = false;
    downloadProgress = 100;
    if (onProgress) onProgress(100, `Whisper model ${modelName} download complete.`);
    return true;
  } catch (err) {
    console.error(`[Whisper Download Error]:`, err);
    isDownloading = false;
    return false;
  }
}

export function getWhisperStatus(): WhisperStatus {
  const downloaded = isModelDownloaded(selectedModel);
  const binaryDownloaded = Boolean(findWhisperBinary());
  let statusText = 'Ready';
  if (isDownloading) statusText = `Downloading Whisper model ${selectedModel} (${downloadProgress}%)...`;
  else if (!binaryDownloaded) statusText = 'Whisper executable binary missing.';
  else if (!downloaded) statusText = `Whisper model ${selectedModel} not downloaded yet.`;

  return {
    modelName: selectedModel,
    modelDownloaded: downloaded,
    binaryDownloaded,
    downloading: isDownloading,
    downloadProgress,
    statusText,
    modelPath: getModelPath(selectedModel),
  };
}