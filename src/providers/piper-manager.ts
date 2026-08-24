import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { getAppPaths } from '../shared/paths';
import { fetchWithRetry, executeWithExponentialBackoff } from '../shared/http-util';

export interface PiperStatus {
  voiceName: string; // 'en_US-amy-medium' | 'en_US-lessac-medium' | 'en_GB-alan-medium'
  voiceDownloaded: boolean;
  binaryDownloaded: boolean;
  downloading: boolean;
  downloadProgress: number; // 0 to 100
  statusText: string;
  voicePath: string;
}

export function isPiperBinaryDownloaded(): boolean {
  if (process.env.PIPER_BINARY && fs.existsSync(process.env.PIPER_BINARY)) {
    return true;
  }
  const binDir = path.join(getAppPaths().userDataDir, 'bin');
  const candidates = [
    path.join(binDir, 'piper.exe'),
    path.join(binDir, 'piper-tts.exe'),
    path.join(binDir, 'piper', 'piper.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return true;
  }
  return false;
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

let currentVoice = process.env.PIPER_LOCAL_VOICE || 'en_US-amy-medium';
let isDownloading = false;
let currentProgress = 0;

/**
 * Returns voices directory in per-user AppData: %APPDATA%\Saira\voices\
 */
export function getVoicesDir(): string {
  const paths = getAppPaths();
  const voicesDir = path.join(paths.userDataDir, 'voices');
  if (!fs.existsSync(voicesDir)) {
    fs.mkdirSync(voicesDir, { recursive: true });
  }
  return voicesDir;
}

export function getSelectedVoiceName(): string {
  return currentVoice;
}

export function setSelectedVoiceName(voiceName: string): void {
  if (VOICE_URLS[voiceName]) {
    currentVoice = voiceName;
    console.log(`[Piper Manager] Selected local voice model changed to: "${currentVoice}"`);
  }
}

/**
 * Checks if a specific Piper voice model (.onnx and .onnx.json) exists in %APPDATA%\Saira\voices\
 */
export function isVoiceDownloaded(voiceName = currentVoice): boolean {
  const onnxPath = path.join(getVoicesDir(), `${voiceName}.onnx`);
  const jsonPath = path.join(getVoicesDir(), `${voiceName}.onnx.json`);
  return fs.existsSync(onnxPath) && fs.existsSync(jsonPath) && fs.statSync(onnxPath).size > 5 * 1024 * 1024;
}

export function getVoicePath(voiceName = currentVoice): string {
  return path.join(getVoicesDir(), `${voiceName}.onnx`);
}

/**
 * Returns current status of local Piper voice model storage.
 */
export function getPiperStatus(): PiperStatus {
  const downloaded = isVoiceDownloaded(currentVoice);
  const binaryDownloaded = isPiperBinaryDownloaded();
  const voicePath = getVoicePath(currentVoice);

  let statusText = 'Ready';
  if (isDownloading) {
    statusText = `Downloading Piper voice ${currentVoice} (${currentProgress}%)...`;
  } else if (!downloaded || !binaryDownloaded) {
    statusText = `Piper setup pending (binary=${binaryDownloaded}, voice=${downloaded}).`;
  }

  return {
    voiceName: currentVoice,
    voiceDownloaded: downloaded,
    binaryDownloaded,
    downloading: isDownloading,
    downloadProgress: currentProgress,
    statusText,
    voicePath,
  };
}

/**
 * Downloads Piper voice ONNX model and JSON config into %APPDATA%\Saira\voices\
 * with progress tracking.
 */
export async function downloadPiperVoice(
  voiceName = currentVoice,
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  const urls = VOICE_URLS[voiceName];
  if (!urls) {
    console.error(`[Piper Download] Unknown voice name: ${voiceName}`);
    return false;
  }

  if (isVoiceDownloaded(voiceName)) {
    console.log(`[Piper Download] Voice model "${voiceName}" is already downloaded.`);
    if (onProgress) onProgress(100, `Piper voice ${voiceName} ready.`);
    return true;
  }

  if (isDownloading) {
    console.log('[Piper Download] Download already in progress.');
    return true;
  }

  isDownloading = true;
  currentProgress = 0;
  console.log(`[Piper Download] Starting download for voice "${voiceName}"...`);
  const targetPath = getVoicePath(voiceName);
  const tempPath = `${targetPath}.tmp`;

  try {
    await executeWithExponentialBackoff(
      async () => {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch {}
        }

        // 1. Download JSON config
        const jsonRes = await fetchWithRetry(urls.json, undefined, 2, 1000);
        if (jsonRes.ok) {
          const jsonText = await jsonRes.text();
          const jsonPath = path.join(getVoicesDir(), `${voiceName}.onnx.json`);
          fs.writeFileSync(jsonPath, jsonText, 'utf-8');
        }

        // 2. Download ONNX model file
        const res = await fetchWithRetry(urls.onnx, undefined, 2, 1000);
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const contentLengthHeader = res.headers.get('content-length');
        const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 55 * 1024 * 1024;
        let loadedBytes = 0;

        const fileStream = fs.createWriteStream(tempPath);
        const reader = res.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          loadedBytes += value.length;
          fileStream.write(Buffer.from(value));

          if (totalBytes > 0) {
            const percent = Math.min(99, Math.round((loadedBytes / totalBytes) * 100));
            currentProgress = percent;
            if (onProgress) {
              onProgress(percent, `Downloading Piper voice ${voiceName}: ${percent}%`);
            }
          }
        }

        await new Promise<void>((resolve, reject) => {
          fileStream.on('finish', resolve);
          fileStream.on('error', reject);
          fileStream.end();
        });

        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        fs.renameSync(tempPath, targetPath);
      },
      3,
      1500,
      (attempt, delayMs, err) => {
        const warning = `Network glitch downloading Piper voice ${voiceName}. Retrying in ${delayMs / 1000}s (Attempt ${attempt}/3)...`;
        console.warn(`[Piper Download Retry] ${warning}`, err);
        if (onProgress) {
          onProgress(currentProgress, warning);
        }
      }
    );

    currentProgress = 100;
    isDownloading = false;
    console.log(`[Piper Download] Successfully downloaded voice "${voiceName}" to ${targetPath}.`);
    if (onProgress) {
      onProgress(100, `Piper voice ${voiceName} download complete.`);
    }
    return true;
  } catch (err) {
    console.error(`[Piper Download Error] Failed downloading voice ${voiceName}:`, err);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
    isDownloading = false;
    return false;
  }
}

const PIPER_WINDOWS_BIN_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

/**
 * Downloads Piper Windows binary zip and extracts piper.exe into %APPDATA%\Saira\bin\
 */
export async function downloadPiperBinary(): Promise<boolean> {
  const binDir = path.join(getAppPaths().userDataDir, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const piperExeCandidates = [
    path.join(binDir, 'piper.exe'),
    path.join(binDir, 'piper', 'piper.exe'),
  ];
  for (const candidate of piperExeCandidates) {
    if (fs.existsSync(candidate)) return true;
  }

  console.log('[Piper Binary Download] Starting download of Piper executable binary for Windows...');
  try {
    const res = await fetchWithRetry(PIPER_WINDOWS_BIN_URL, undefined, 3, 1500);
    if (!res.ok || !res.body) {
      console.error(`[Piper Binary Download Failed] HTTP ${res.status}: ${res.statusText}`);
      return false;
    }

    const zipPath = path.join(os.tmpdir(), `piper_windows_amd64_${Date.now()}.zip`);
    const fileStream = fs.createWriteStream(zipPath);

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }
    fileStream.end();

    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    console.log(`[Piper Binary Download] Extracting zip to ${binDir}...`);
    await new Promise<void>((resolve, reject) => {
      const cmd = `Expand-Archive -Path "${zipPath.replace(/"/g, '`"')}" -DestinationPath "${binDir.replace(/"/g, '`"')}" -Force`;
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
      proc.on('close', (code) => {
        try {
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        } catch {
          // ignore
        }
        if (code === 0) resolve();
        else reject(new Error(`PowerShell Expand-Archive failed with code ${code}`));
      });
      proc.on('error', reject);
    });

    console.log('[Piper Binary Download] Successfully downloaded and extracted Piper executable.');
    return true;
  } catch (err) {
    console.error('[Piper Binary Download Error] Failed to download or extract Piper binary:', err);
    return false;
  }
}
