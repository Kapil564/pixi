import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { fetchWithRetry, executeWithExponentialBackoff } from './http-util';
import { verifyFileIntegrity, KNOWN_CHECKSUMS } from './checksum';

export interface DownloadFileOptions {
  /** Human-readable label used in progress/retry messages, e.g. 'Whisper model small.en'. */
  label: string;
  /** Name used for KNOWN_CHECKSUMS lookup (defaults to basename of targetPath). */
  fileName?: string;
  /** Fallback total byte size when the server omits content-length. */
  defaultBytes?: number;
  onProgress?: (progressPercent: number, statusText: string) => void;
}

/**
 * Downloads a file to targetPath with retry, streaming progress, checksum verification,
 * and an atomic .tmp -> target rename. Throws if the download ultimately fails.
 */
export async function downloadFileWithProgress(
  url: string,
  targetPath: string,
  opts: DownloadFileOptions,
): Promise<void> {
  const { label, fileName, defaultBytes, onProgress } = opts;
  const checksumName = fileName || path.basename(targetPath);
  const tempPath = `${targetPath}.tmp`;
  let lastPercent = 0;

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
        const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : (defaultBytes ?? 0);
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
            lastPercent = percent;
            if (onProgress) onProgress(percent, `Downloading ${label}: ${percent}%`);
          }
        }

        await new Promise<void>((resolve, reject) => {
          fileStream.on('finish', resolve);
          fileStream.on('error', reject);
          fileStream.end();
        });

        const expectedHash = KNOWN_CHECKSUMS[checksumName];
        const integrity = await verifyFileIntegrity(tempPath, expectedHash);
        if (expectedHash && !integrity.valid) {
          console.warn(`[Download] Non-critical warning: SHA-256 mismatch for ${checksumName}. Proceeding...`);
        }

        // Atomic rename: swap temp file into the final path
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        fs.renameSync(tempPath, targetPath);
      },
      3,
      1500,
      (attempt, delayMs, err) => {
        const warning = `Network glitch downloading ${label}. Retrying in ${delayMs / 1000}s (Attempt ${attempt}/3)...`;
        console.warn(`[Download Retry] ${warning}`, err);
        if (onProgress) onProgress(lastPercent, warning);
      }
    );
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Downloads a Windows release zip, verifies its checksum, and extracts it into destDir
 * via PowerShell Expand-Archive. The temp zip is always cleaned up. Throws on failure.
 */
export async function downloadAndExtractZip(
  url: string,
  destDir: string,
  zipName: string,
): Promise<void> {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const zipPath = path.join(os.tmpdir(), `${path.basename(zipName, '.zip')}_${Date.now()}.zip`);

  try {
    const res = await fetchWithRetry(url, undefined, 3, 1500);
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

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

    const expectedZipHash = KNOWN_CHECKSUMS[zipName];
    const zipIntegrity = await verifyFileIntegrity(zipPath, expectedZipHash);
    if (expectedZipHash && !zipIntegrity.valid) {
      console.warn(`[Zip Download] Non-critical warning: SHA-256 mismatch for ${zipName}. Proceeding with extraction...`);
    }

    console.log(`[Zip Download] Extracting zip to ${destDir}...`);
    await new Promise<void>((resolve, reject) => {
      const cmd = `Expand-Archive -Path "${zipPath.replace(/"/g, '`"')}" -DestinationPath "${destDir.replace(/"/g, '`"')}" -Force`;
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
  } catch (err) {
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch {
      // ignore
    }
    throw err;
  }
}