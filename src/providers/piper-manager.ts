import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from '../shared/paths';
import { fetchWithRetry } from '../shared/http-util';
import { downloadFileWithProgress } from '../shared/download';
import { findLocalBinary } from '../shared/disk-util';
import { createLocalAssetManager, ensureDataSubdir } from '../shared/local-asset-manager';

export interface PiperStatus {
  voiceName: string;
  voiceDownloaded: boolean;
  binaryDownloaded: boolean;
  downloading: boolean;
  downloadProgress: number; // 0 to 100
  statusText: string;
  voicePath: string;
}

const VOICE_URLS: Record<string, { onnx: string; json: string }> = {
  'en_US-amy-medium': {
    onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx',
    json: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
  },
  'en_US-lessac-medium': {
    onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    json: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
  },
  'en_GB-alan-medium': {
    onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alan/medium/en_GB-alan-medium.onnx',
    json: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json',
  },
};

const voicesDir = () => ensureDataSubdir('voices');

const findPiperBinary = () => findLocalBinary({
  envVar: 'PIPER_BINARY',
  knownNames: ['piper.exe', 'piper-tts.exe', path.join('piper', 'piper.exe')],
  binDir: path.join(getAppPaths().userDataDir, 'bin'),
});

const piperManager = createLocalAssetManager({
  assetLabel: 'Piper voice',
  assetTerm: 'voice',
  selectionTerm: 'voice model',
  dirName: 'voices',
  selectionEnvVar: 'PIPER_LOCAL_VOICE',
  defaultSelection: 'en_US-amy-medium',
  logPrefix: 'Piper Manager',
  hasAsset: (name) => Boolean(VOICE_URLS[name]),
  isDownloaded: (name) => {
    const onnxPath = path.join(voicesDir(), `${name}.onnx`);
    const jsonPath = path.join(voicesDir(), `${name}.onnx.json`);
    return fs.existsSync(onnxPath) && fs.existsSync(jsonPath) && fs.statSync(onnxPath).size > 5 * 1024 * 1024;
  },
  getAssetPath: (name) => path.join(voicesDir(), `${name}.onnx`),
  downloadAsset: async (name, targetPath, onProgress) => {
    const urls = VOICE_URLS[name];
    const jsonRes = await fetchWithRetry(urls.json, undefined, 2, 1000);
    if (!jsonRes.ok) {
      throw new Error(`Failed to download Piper JSON config: HTTP ${jsonRes.status}`);
    }
    fs.writeFileSync(`${targetPath}.json`, await jsonRes.text(), 'utf-8');

    await downloadFileWithProgress(urls.onnx, targetPath, {
      label: `Piper voice ${name}`,
      fileName: `${name}.onnx`,
      defaultBytes: 55 * 1024 * 1024,
      onProgress,
    });
  },
  findBinary: findPiperBinary,
  binaryDownloadUrl: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  binaryZipName: 'piper_windows_amd64.zip',
  binaryDisplayName: 'Piper executable',
  buildStatusText: ({ name, downloading, progress, downloaded, binaryDownloaded }) => {
    if (downloading) return `Downloading Piper voice ${name} (${progress}%)...`;
    if (!downloaded || !binaryDownloaded) return `Piper setup pending (binary=${binaryDownloaded}, voice=${downloaded}).`;
    return 'Ready';
  },
});

export function getSelectedVoiceName(): string {
  return piperManager.getSelection();
}

export function setSelectedVoiceName(voiceName: string): void {
  piperManager.setSelection(voiceName);
}

/**
 * Checks if a specific Piper voice model (.onnx and .onnx.json) exists in %APPDATA%\pixi\voices\
 */
export function isVoiceDownloaded(voiceName = getSelectedVoiceName()): boolean {
  return piperManager.isDownloaded(voiceName);
}

export function getVoicePath(voiceName = getSelectedVoiceName()): string {
  return piperManager.getAssetPath(voiceName);
}

/**
 * Returns current status of local Piper voice model storage.
 */
export function getPiperStatus(): PiperStatus {
  const s = piperManager.getStatus();
  return {
    voiceName: s.name,
    voiceDownloaded: s.downloaded,
    binaryDownloaded: s.binaryDownloaded,
    downloading: s.downloading,
    downloadProgress: s.downloadProgress,
    statusText: s.statusText,
    voicePath: s.assetPath,
  };
}

/**
 * Downloads Piper voice ONNX model and JSON config into %APPDATA%\pixi\voices\
 * with progress tracking.
 */
export async function downloadPiperVoice(
  voiceName?: string,
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  return piperManager.downloadAsset(voiceName, onProgress);
}

/**
 * Downloads Piper Windows binary zip and extracts piper.exe into %APPDATA%\pixi\bin\
 */
export async function downloadPiperBinary(): Promise<boolean> {
  return piperManager.downloadBinary();
}