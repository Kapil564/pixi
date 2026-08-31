import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { getAppPaths } from '../shared/paths';
import { fetchWithRetry, executeWithExponentialBackoff } from '../shared/http-util';
import { verifyFileIntegrity, KNOWN_CHECKSUMS } from '../shared/checksum';

export interface WhisperStatus {
  modelName: string; // 'small.en' | 'base.en'
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

let currentModel = process.env.WHISPER_LOCAL_MODEL || 'small.en';
let isDownloading = false;
let currentProgress = 0;

/**
 * Returns the models directory inside per-user AppData: %APPDATA%\Saira\models\
 */
export function getModelsDir(): string {
  const paths = getAppPaths();
  const modelsDir = path.join(paths.userDataDir, 'models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
}

export function getSelectedModelName(): string {
  return currentModel;
}

export function setSelectedModelName(modelName: string): void {
  if (MODEL_URLS[modelName]) {
    currentModel = modelName;
    console.log(`[Whisper Manager] Selected local STT model changed to: "${currentModel}"`);
  }
}

/**
 * Checks if a specific model binary exists in %APPDATA%\Saira\models\
 */
export function isModelDownloaded(modelName = currentModel): boolean {
  const modelPath = path.join(getModelsDir(), `ggml-${modelName}.bin`);
  return fs.existsSync(modelPath) && fs.statSync(modelPath).size > 10 * 1024 * 1024;
}

export function getModelPath(modelName = currentModel): string {
  return path.join(getModelsDir(), `ggml-${modelName}.bin`);
}

export function findExeRecursive(dir: string, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Priority 1: Check for whisper-cli.exe in current dir
    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name === 'whisper-cli.exe' || name === 'whisper-cli') {
          return path.join(dir, entry.name);
        }
      }
    }

    // Priority 2: Check for other whisper binaries in current dir
    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name === 'whisper.exe' || (name.startsWith('whisper') && name.endsWith('.exe'))) {
          return path.join(dir, entry.name);
        }
      }
    }

    // Priority 3: Check subdirectories recursively
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = findExeRecursive(path.join(dir, entry.name), depth + 1);
        if (found) return found;
      }
    }

    // Priority 4: Fallback to main.exe in current dir if no whisper-cli exists
    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name === 'main.exe' || name === 'main') {
          return path.join(dir, entry.name);
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Checks if a whisper.cpp executable binary exists in app bin dir or system PATH.
 */
export function isWhisperBinaryDownloaded(): boolean {
  if (process.env.WHISPER_CPP_BINARY && fs.existsSync(process.env.WHISPER_CPP_BINARY)) {
    return true;
  }

  try {
    const binDir = path.join(getAppPaths().userDataDir, 'bin');
    if (fs.existsSync(binDir)) {
      return Boolean(findExeRecursive(binDir));
    }
  } catch {
    // ignore
  }

  return false;
}

/**
 * Downloads prebuilt Whisper Windows executable binary zip and extracts it into %APPDATA%\Saira\bin\
 */
export async function downloadWhisperBinary(): Promise<boolean> {
  const binDir = path.join(getAppPaths().userDataDir, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  if (isWhisperBinaryDownloaded()) {
    console.log('[Whisper Binary Download] Whisper executable binary is already present.');
    return true;
  }

  console.log('[Whisper Binary Download] Starting download of Whisper executable binary for Windows...');
  try {
    const res = await fetchWithRetry(WHISPER_WINDOWS_BIN_URL, undefined, 3, 1500);
    if (!res.ok || !res.body) {
      console.error(`[Whisper Binary Download Failed] HTTP ${res.status}: ${res.statusText}`);
      return false;
    }

    const zipPath = path.join(os.tmpdir(), `whisper_windows_amd64_${Date.now()}.zip`);
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

    const expectedZipHash = KNOWN_CHECKSUMS['whisper-bin-x64.zip'];
    const zipIntegrity = await verifyFileIntegrity(zipPath, expectedZipHash);
    if (expectedZipHash && !zipIntegrity.valid) {
      try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch {}
      throw new Error(`Integrity verification failed for whisper-bin-x64.zip (SHA-256 mismatch).`);
    }

    console.log(`[Whisper Binary Download] Extracting zip to ${binDir}...`);
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
        else reject(new Error(`Expand-Archive exited with code ${code}`));
      });
      proc.on('error', reject);
    });

    console.log('[Whisper Binary Download] Successfully extracted Whisper binary.');
    return isWhisperBinaryDownloaded();
  } catch (err) {
    console.error('[Whisper Binary Download Error]:', err);
    return false;
  }
}

/**
 * Returns current status of local Whisper model storage and binary.
 */
export function getWhisperStatus(): WhisperStatus {
  const modelDownloaded = isModelDownloaded(currentModel);
  const binaryDownloaded = isWhisperBinaryDownloaded();
  const modelPath = getModelPath(currentModel);

  let statusText = 'Ready';
  if (isDownloading) {
    statusText = `Downloading Whisper model ${currentModel} (${currentProgress}%)...`;
  } else if (!binaryDownloaded) {
    statusText = 'Whisper executable binary missing.';
  } else if (!modelDownloaded) {
    statusText = `Whisper model ${currentModel} not downloaded yet.`;
  }

  return {
    modelName: currentModel,
    modelDownloaded,
    binaryDownloaded,
    downloading: isDownloading,
    downloadProgress: currentProgress,
    statusText,
    modelPath,
  };
}

/**
 * Downloads GGML Whisper model binary (small.en or base.en) directly into %APPDATA%\Saira\models\
 * with streaming progress tracking.
 */
export async function downloadWhisperModel(
  modelName = currentModel,
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  const url = MODEL_URLS[modelName];
  if (!url) {
    console.error(`[Whisper Download] Unknown model name: ${modelName}`);
    return false;
  }

  if (isModelDownloaded(modelName)) {
    console.log(`[Whisper Download] Model "${modelName}" is already downloaded.`);
    if (onProgress) onProgress(100, `Whisper model ${modelName} ready.`);
    return true;
  }

  if (isDownloading) {
    console.log('[Whisper Download] Download already in progress.');
    return true;
  }

  isDownloading = true;
  currentProgress = 0;
  console.log(`[Whisper Download] Starting download for model "${modelName}" from ${url}...`);
  const targetPath = getModelPath(modelName);
  const tempPath = `${targetPath}.tmp`;

  try {
    await executeWithExponentialBackoff(
      async () => {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch {}
        }

        const res = await fetchWithRetry(url, undefined, 2, 1000);
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const contentLengthHeader = res.headers.get('content-length');
        const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 460 * 1024 * 1024;
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
              onProgress(percent, `Downloading Whisper model ${modelName}: ${percent}%`);
            }
          }
        }

        await new Promise<void>((resolve, reject) => {
          fileStream.on('finish', resolve);
          fileStream.on('error', reject);
          fileStream.end();
        });

        const modelFileName = `ggml-${modelName}.bin`;
        const expectedModelHash = KNOWN_CHECKSUMS[modelFileName];
        const modelIntegrity = await verifyFileIntegrity(tempPath, expectedModelHash);
        if (expectedModelHash && !modelIntegrity.valid) {
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
          throw new Error(`Integrity verification failed for ${modelFileName} (SHA-256 mismatch).`);
        }

        // Rename temp file to final .bin file
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        fs.renameSync(tempPath, targetPath);
      },
      3,
      1500,
      (attempt, delayMs, err) => {
        const warning = `Network glitch downloading Whisper model ${modelName}. Retrying in ${delayMs / 1000}s (Attempt ${attempt}/3)...`;
        console.warn(`[Whisper Download Retry] ${warning}`, err);
        if (onProgress) {
          onProgress(currentProgress, warning);
        }
      }
    );

    currentProgress = 100;
    isDownloading = false;
    console.log(`[Whisper Download] Successfully downloaded Whisper model "${modelName}" to ${targetPath}.`);
    if (onProgress) {
      onProgress(100, `Whisper model ${modelName} download complete.`);
    }
    return true;
  } catch (err) {
    console.error(`[Whisper Download Error] Failed downloading model ${modelName}:`, err);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
    isDownloading = false;
    return false;
  }
}
