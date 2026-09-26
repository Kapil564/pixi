import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from '../shared/paths';
import { downloadFileWithProgress } from '../shared/download';
import { findLocalBinary } from '../shared/disk-util';
import { createLocalAssetManager, ensureDataSubdir } from '../shared/local-asset-manager';

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

const modelsDir = () => ensureDataSubdir('models');

const findWhisperBinary = () => findLocalBinary({
  envVar: 'WHISPER_CPP_BINARY',
  recursive: true,
  binDir: path.join(getAppPaths().userDataDir, 'bin'),
});

const whisperManager = createLocalAssetManager({
  assetLabel: 'Whisper model',
  assetTerm: 'model',
  selectionTerm: 'STT model',
  dirName: 'models',
  selectionEnvVar: 'WHISPER_LOCAL_MODEL',
  defaultSelection: 'small.en',
  logPrefix: 'Whisper Manager',
  hasAsset: (name) => Boolean(MODEL_URLS[name]),
  isDownloaded: (name) => {
    const modelPath = path.join(modelsDir(), `ggml-${name}.bin`);
    return fs.existsSync(modelPath) && fs.statSync(modelPath).size > 10 * 1024 * 1024;
  },
  getAssetPath: (name) => path.join(modelsDir(), `ggml-${name}.bin`),
  downloadAsset: async (name, targetPath, onProgress) => {
    await downloadFileWithProgress(MODEL_URLS[name], targetPath, {
      label: `Whisper model ${name}`,
      fileName: `ggml-${name}.bin`,
      defaultBytes: 460 * 1024 * 1024,
      onProgress,
    });
  },
  findBinary: findWhisperBinary,
  binaryDownloadUrl: WHISPER_WINDOWS_BIN_URL,
  binaryZipName: 'whisper-bin-x64.zip',
  binaryDisplayName: 'Whisper executable',
  buildStatusText: ({ name, downloading, progress, downloaded, binaryDownloaded }) => {
    if (downloading) return `Downloading Whisper model ${name} (${progress}%)...`;
    if (!binaryDownloaded) return 'Whisper executable binary missing.';
    if (!downloaded) return `Whisper model ${name} not downloaded yet.`;
    return 'Ready';
  },
});

export function getSelectedModelName(): string {
  return whisperManager.getSelection();
}

export function setSelectedModelName(modelName: string): void {
  whisperManager.setSelection(modelName);
}

/**
 * Checks if a specific model binary exists in %APPDATA%\pixi\models\
 */
export function isModelDownloaded(modelName = getSelectedModelName()): boolean {
  return whisperManager.isDownloaded(modelName);
}

export function getModelPath(modelName = getSelectedModelName()): string {
  return whisperManager.getAssetPath(modelName);
}

/**
 * Downloads prebuilt Whisper Windows executable binary zip and extracts it into %APPDATA%\pixi\bin\
 */
export async function downloadWhisperBinary(): Promise<boolean> {
  return whisperManager.downloadBinary();
}

/**
 * Returns current status of local Whisper model storage and binary.
 */
export function getWhisperStatus(): WhisperStatus {
  const s = whisperManager.getStatus();
  return {
    modelName: s.name,
    modelDownloaded: s.downloaded,
    binaryDownloaded: s.binaryDownloaded,
    downloading: s.downloading,
    downloadProgress: s.downloadProgress,
    statusText: s.statusText,
    modelPath: s.assetPath,
  };
}

/**
 * Downloads GGML Whisper model binary (small.en or base.en) directly into %APPDATA%\pixi\models\
 * with streaming progress tracking.
 */
export async function downloadWhisperModel(
  modelName?: string,
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  return whisperManager.downloadAsset(modelName, onProgress);
}