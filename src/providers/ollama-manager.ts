import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { isLocalServerReachable, executeWithExponentialBackoff } from '../shared/http-util';
import { config } from '../shared/config';

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  modelName: string;
  modelDownloaded: boolean;
  downloading: boolean;
  downloadProgress: number; // 0 to 100
  statusText: string;
  ramGbTotal: number;
  ramGbFree: number;
  ramWarning: boolean;
  executablePath?: string;
}

const DEFAULT_LOCAL_MODEL = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';

let currentDownloadProgress = 0;
let isDownloading = false;

/**
 * Verifies if the Ollama executable (ollama.exe) is installed on the local machine.
 */
export function isOllamaInstalled(): { installed: boolean; path?: string } {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || '';
  const possiblePaths = [
    path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
    path.join(programFiles, 'Ollama', 'ollama.exe'),
  ];

  for (const execPath of possiblePaths) {
    if (fs.existsSync(execPath)) {
      return { installed: true, path: execPath };
    }
  }

  // Check via system PATH on Windows
  try {
    const stdout = execSync('where ollama', { encoding: 'utf-8', windowsHide: true });
    if (stdout && stdout.trim()) {
      const firstLine = stdout.split(/\r?\n/)[0].trim();
      if (firstLine && fs.existsSync(firstLine)) {
        return { installed: true, path: firstLine };
      }
    }
  } catch {
    // ignore lookup error if not on PATH
  }

  return { installed: false };
}

/**
 * Attempts to auto-start the local Ollama background service if installed on the Windows machine.
 */
export async function tryStartOllamaService(): Promise<boolean> {
  const baseUrl = config.llm.baseUrl || 'http://localhost:11434';
  if (await isLocalServerReachable(`${baseUrl}/api/tags`)) {
    return true;
  }

  const installCheck = isOllamaInstalled();
  if (!installCheck.installed) {
    console.warn('[Ollama Service] Cannot auto-start: Ollama executable is not installed on this machine.');
    return false;
  }

  const execPath = installCheck.path || 'ollama';

  try {
    console.log(`[Ollama Service] Verified Ollama installation at "${execPath}". Auto-starting service...`);
    const child = spawn(execPath, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    // Poll port 11434 for up to 3 seconds to confirm readiness
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isLocalServerReachable(`${baseUrl}/api/tags`)) {
        console.log('[Ollama Service] Successfully verified and started Ollama service on port 11434.');
        return true;
      }
    }
  } catch (err) {
    console.error('[Ollama Service Error] Failed to launch Ollama executable:', err);
  }

  return false;
}

/**
 * Checks system RAM specifications.
 */
export function checkSystemRam() {
  const bytesTotal = os.totalmem();
  const bytesFree = os.freemem();
  const ramGbTotal = Math.round((bytesTotal / (1024 * 1024 * 1024)) * 10) / 10;
  const ramGbFree = Math.round((bytesFree / (1024 * 1024 * 1024)) * 10) / 10;
  const ramWarning = ramGbTotal < 4;

  if (ramWarning) {
    console.warn(`[RAM Warning] System RAM (${ramGbTotal} GB) is under the 4GB recommended specification.`);
  }

  return { ramGbTotal, ramGbFree, ramWarning };
}

/**
 * Retrieves current Ollama runtime status, installation verification, RAM specs, and model availability.
 */
export async function getOllamaStatus(): Promise<OllamaStatus> {
  const ramInfo = checkSystemRam();
  const installCheck = isOllamaInstalled();
  const baseUrl = config.llm.baseUrl || 'http://localhost:11434';
  let running = await isLocalServerReachable(`${baseUrl}/api/tags`);

  if (!running && installCheck.installed) {
    // Attempt auto-starting the verified Ollama background service
    running = await tryStartOllamaService();
  }

  if (!running) {
    return {
      installed: installCheck.installed,
      running: false,
      modelName: DEFAULT_LOCAL_MODEL,
      modelDownloaded: false,
      downloading: false,
      downloadProgress: 0,
      statusText: installCheck.installed
        ? 'Ollama is installed but service is not running on port 11434. Run "ollama serve".'
        : 'Ollama is not installed. Download and install Ollama from https://ollama.com.',
      executablePath: installCheck.path,
      ...ramInfo,
    };
  }

  let modelDownloaded = false;
  try {
    const showRes = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DEFAULT_LOCAL_MODEL }),
    });
    if (showRes.ok) {
      const showData = (await showRes.json()) as { error?: string };
      if (!showData.error) {
        modelDownloaded = true;
      }
    }
  } catch (err) {
    console.error('[Ollama Status Error] Failed to verify model availability via /api/show:', err);
  }

  let statusText = 'Ready';
  if (isDownloading) {
    statusText = `Downloading ${DEFAULT_LOCAL_MODEL} (${currentDownloadProgress}%)...`;
  } else if (!modelDownloaded) {
    statusText = `Model ${DEFAULT_LOCAL_MODEL} not downloaded yet.`;
  }

  return {
    installed: true,
    running: true,
    modelName: DEFAULT_LOCAL_MODEL,
    modelDownloaded,
    downloading: isDownloading,
    downloadProgress: modelDownloaded ? 100 : currentDownloadProgress,
    statusText,
    executablePath: installCheck.path,
    ...ramInfo,
  };
}

/**
 * Pulls the default local Ollama model (llama3.2:3b) with streaming NDJSON progress updates.
 * Verifies if the model is already downloaded first to prevent redundant network downloads.
 */
export async function pullLocalModel(
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  const status = await getOllamaStatus();

  if (!status.installed) {
    console.warn('[Ollama Pull] Cannot pull model: Ollama is not installed on this machine.');
    if (onProgress) onProgress(0, 'Ollama is not installed. Install Ollama from https://ollama.com.');
    return false;
  }

  if (!status.running) {
    console.warn('[Ollama Pull] Cannot pull model: Ollama server is not running on port 11434.');
    if (onProgress) onProgress(0, 'Ollama server is not running on port 11434.');
    return false;
  }

  // Verification step: check if model is already downloaded
  if (status.modelDownloaded) {
    console.log(`[Ollama Pull] Verified: Model "${DEFAULT_LOCAL_MODEL}" is already downloaded and ready.`);
    currentDownloadProgress = 100;
    if (onProgress) {
      onProgress(100, `Model ${DEFAULT_LOCAL_MODEL} is already downloaded and ready.`);
    }
    return true;
  }

  if (isDownloading) {
    console.log('[Ollama Pull] Download already in progress.');
    return true;
  }

  isDownloading = true;
  currentDownloadProgress = 0;
  console.log(`[Ollama Pull] Model "${DEFAULT_LOCAL_MODEL}" not found locally. Starting auto-pull...`);

  const baseUrl = config.llm.baseUrl || 'http://localhost:11434';

  try {
    await executeWithExponentialBackoff(
      async () => {
        const res = await fetch(`${baseUrl}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: DEFAULT_LOCAL_MODEL, stream: true }),
        });

        if (!res.ok || !res.body) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as { status?: string; completed?: number; total?: number };
              if (parsed.completed && parsed.total && parsed.total > 0) {
                const percent = Math.round((parsed.completed / parsed.total) * 100);
                currentDownloadProgress = percent;
                if (onProgress) {
                  onProgress(percent, `Downloading ${DEFAULT_LOCAL_MODEL}: ${percent}%`);
                }
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      },
      3,
      1500,
      (attempt, delayMs, err) => {
        const warning = `Network glitch pulling ${DEFAULT_LOCAL_MODEL}. Retrying in ${delayMs / 1000}s (Attempt ${attempt}/3)...`;
        console.warn(`[Ollama Pull Retry] ${warning}`, err);
        if (onProgress) {
          onProgress(currentDownloadProgress, warning);
        }
      }
    );

    currentDownloadProgress = 100;
    isDownloading = false;
    console.log(`[Ollama Pull] Successfully downloaded model "${DEFAULT_LOCAL_MODEL}".`);
    if (onProgress) {
      onProgress(100, `Model ${DEFAULT_LOCAL_MODEL} download complete.`);
    }
    return true;
  } catch (err) {
    console.error('[Ollama Pull Exception]:', err);
    isDownloading = false;
    return false;
  }
}

/**
 * Auto-checks and ensures local model readiness on app startup.
 */
export async function ensureLocalModelReady(): Promise<void> {
  const status = await getOllamaStatus();
  if (status.running && !status.modelDownloaded && !status.downloading) {
    console.log('[Ollama Init] Auto-triggering first-run model pull for fallback readiness...');
    pullLocalModel((percent) => {
      if (percent % 25 === 0) {
        console.log(`[Ollama Model Download Progress]: ${percent}%`);
      }
    }).catch((err) => {
      console.error('[Ollama Model Download Error]:', err);
    });
  }
}
