import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from '../shared/paths';
import { fetchWithRetry } from '../shared/http-util';
import { downloadFileWithProgress, downloadAndExtractZip } from '../shared/download';
import { findLocalBinary } from '../shared/disk-util';

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

const PIPER_WINDOWS_BIN_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

let selectedVoice = process.env.PIPER_LOCAL_VOICE || 'en_US-amy-medium';
let isDownloading = false;
let downloadProgress = 0;

function voicesDir(): string {
  const dir = path.join(getAppPaths().userDataDir, 'voices');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function findPiperBinary(): string | undefined {
  return findLocalBinary({
    envVar: 'PIPER_BINARY',
    knownNames: ['piper.exe', 'piper-tts.exe', path.join('piper', 'piper.exe')],
    binDir: path.join(getAppPaths().userDataDir, 'bin'),
  });
}

export function getSelectedVoiceName(): string {
  return selectedVoice;
}

export function setSelectedVoiceName(voiceName: string): void {
  if (VOICE_URLS[voiceName]) {
    selectedVoice = voiceName;
    console.log(`[Piper Manager] Selected local voice model changed to: "${selectedVoice}"`);
  }
}

export function isVoiceDownloaded(voiceName = selectedVoice): boolean {
  const onnxPath = path.join(voicesDir(), `${voiceName}.onnx`);
  const jsonPath = path.join(voicesDir(), `${voiceName}.onnx.json`);
  return fs.existsSync(onnxPath) && fs.existsSync(jsonPath) && fs.statSync(onnxPath).size > 5 * 1024 * 1024;
}

export function getVoicePath(voiceName = selectedVoice): string {
  return path.join(voicesDir(), `${voiceName}.onnx`);
}

export async function downloadPiperBinary(): Promise<boolean> {
  if (findPiperBinary()) return true;
  console.log('[Piper Manager] Downloading Piper executable for Windows...');
  try {
    await downloadAndExtractZip(
      PIPER_WINDOWS_BIN_URL,
      path.join(getAppPaths().userDataDir, 'bin'),
      'piper_windows_amd64.zip',
    );
    return true;
  } catch (err) {
    console.error('[Piper Manager Binary Download Error]:', err);
    return false;
  }
}

export async function downloadPiperVoice(
  voiceName = selectedVoice,
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  const urls = VOICE_URLS[voiceName];
  if (!urls) {
    console.error(`[Piper Manager] Unknown voice: ${voiceName}`);
    return false;
  }
  if (isVoiceDownloaded(voiceName)) {
    if (onProgress) onProgress(100, `Piper voice ${voiceName} ready.`);
    return true;
  }

  isDownloading = true;
  downloadProgress = 0;
  const targetPath = getVoicePath(voiceName);

  try {
    // 1. Download JSON config
    const jsonRes = await fetchWithRetry(urls.json, undefined, 2, 1000);
    if (!jsonRes.ok) {
      throw new Error(`Failed to download Piper JSON config: HTTP ${jsonRes.status}`);
    }
    fs.writeFileSync(`${targetPath}.json`, await jsonRes.text(), 'utf-8');

    // 2. Download ONNX model
    await downloadFileWithProgress(urls.onnx, targetPath, {
      label: `Piper voice ${voiceName}`,
      fileName: `${voiceName}.onnx`,
      defaultBytes: 55 * 1024 * 1024,
      onProgress: (pct) => {
        downloadProgress = pct;
        if (onProgress) onProgress(pct, `Downloading Piper voice ${voiceName}: ${pct}%`);
      },
    });

    isDownloading = false;
    downloadProgress = 100;
    if (onProgress) onProgress(100, `Piper voice ${voiceName} download complete.`);
    return true;
  } catch (err) {
    console.error(`[Piper Download Error]:`, err);
    isDownloading = false;
    return false;
  }
}

export function getPiperStatus(): PiperStatus {
  const downloaded = isVoiceDownloaded(selectedVoice);
  const binaryDownloaded = Boolean(findPiperBinary());
  let statusText = 'Ready';
  if (isDownloading) statusText = `Downloading Piper voice ${selectedVoice} (${downloadProgress}%)...`;
  else if (!downloaded || !binaryDownloaded) statusText = `Piper setup pending (binary=${binaryDownloaded}, voice=${downloaded}).`;

  return {
    voiceName: selectedVoice,
    voiceDownloaded: downloaded,
    binaryDownloaded,
    downloading: isDownloading,
    downloadProgress,
    statusText,
    voicePath: getVoicePath(selectedVoice),
  };
}