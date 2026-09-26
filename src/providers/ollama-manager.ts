import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
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

export interface OllamaInstallInfo {
  installed: boolean;
  path?: string;
  appPath?: string;
}

const DEFAULT_LOCAL_MODEL = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';

let currentDownloadProgress = 0;
let isDownloading = false;
let cachedInstallInfo: OllamaInstallInfo | null = null;
let startingServicePromise: Promise<boolean> | null = null;
let lastStartAttemptTime = 0;
let lastStatusCache: { status: OllamaStatus; timestamp: number } | null = null;

/**
 * Verifies if Ollama executable is installed on the local machine.
 * Caches result and inspects PATH directly in Node without spawning cmd.exe.
 */
export function isOllamaInstalled(forceCheck = false): OllamaInstallInfo {
  if (cachedInstallInfo && !forceCheck) {
    return cachedInstallInfo;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || '';
  const possibleDirs = [
    path.join(localAppData, 'Programs', 'Ollama'),
    path.join(programFiles, 'Ollama'),
  ];

  for (const dir of possibleDirs) {
    const cliPath = path.join(dir, 'ollama.exe');
    const appPath = path.join(dir, 'ollama app.exe');
    if (fs.existsSync(cliPath)) {
      cachedInstallInfo = {
        installed: true,
        path: cliPath,
        appPath: fs.existsSync(appPath) ? appPath : undefined,
      };
      return cachedInstallInfo;
    }
  }

  // Pure JS search across system PATH without launching cmd.exe / where.exe
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidateCli = path.join(dir, 'ollama.exe');
    if (fs.existsSync(candidateCli)) {
      const candidateApp = path.join(dir, 'ollama app.exe');
      cachedInstallInfo = {
        installed: true,
        path: candidateCli,
        appPath: fs.existsSync(candidateApp) ? candidateApp : undefined,
      };
      return cachedInstallInfo;
    }
  }

  cachedInstallInfo = { installed: false };
  return cachedInstallInfo;
}

/**
 * Attempts to auto-start the local Ollama background service if installed.
 * Prevents multiple concurrent spawns and avoids console/terminal window flash.
 */
export async function tryStartOllamaService(): Promise<boolean> {
  if (startingServicePromise) {
    return startingServicePromise;
  }

  const now = Date.now();
  // Cooldown: do not re-attempt if last attempt failed within 10 seconds
  if (now - lastStartAttemptTime < 10000) {
    return false;
  }

  startingServicePromise = (async () => {
    lastStartAttemptTime = Date.now();
    const baseUrl = config.llm.baseUrl || 'http://localhost:11434';
    if (await isLocalServerReachable(`${baseUrl}/api/tags`, 1500)) {
      return true;
    }

    const installCheck = isOllamaInstalled();
    if (!installCheck.installed) {
      console.warn('[Ollama Service] Cannot auto-start: Ollama executable is not installed on this machine.');
      return false;
    }

    try {
      // 1. Prefer the official Windows GUI tray app ("ollama app.exe")
      // It has SUBSYSTEM_WINDOWS (GUI), so Windows Terminal NEVER opens a tab or console window.
      if (installCheck.appPath && fs.existsSync(installCheck.appPath)) {
        console.log(`[Ollama Service] Launching Ollama Windows GUI service at "${installCheck.appPath}"...`);
        const child = spawn(installCheck.appPath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      } else if (process.platform === 'win32') {
        // 2. If only "ollama.exe" is present on Windows, launch via WScript.Shell with style 0 (hidden)
        // to prevent Windows 11 Windows Terminal from opening and closing a console tab.
        const execPath = installCheck.path || 'ollama.exe';
        console.log(`[Ollama Service] Launching headless Ollama CLI service via hidden host at "${execPath}"...`);
        const tempVbs = path.join(os.tmpdir(), `launch_ollama_${Date.now()}.vbs`);
        const vbsContent = `CreateObject("Wscript.Shell").Run chr(34) & "${execPath.replace(/\\/g, '\\\\')}" & chr(34) & " serve", 0, False\n`;
        fs.writeFileSync(tempVbs, vbsContent, 'utf-8');
        const child = spawn('wscript.exe', [tempVbs], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        setTimeout(() => {
          try {
            if (fs.existsSync(tempVbs)) fs.unlinkSync(tempVbs);
          } catch {}
        }, 10000);
      } else {
        // 3. Fallback for non-Windows platforms
        const execPath = installCheck.path || 'ollama';
        console.log(`[Ollama Service] Auto-starting Ollama service at "${execPath}"...`);
        const child = spawn(execPath, ['serve'], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }

      // Poll port 11434 for up to 8 seconds (16 attempts * 500ms) to confirm readiness
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isLocalServerReachable(`${baseUrl}/api/tags`, 1000)) {
          console.log('[Ollama Service] Successfully verified and started Ollama service on port 11434.');
          return true;
        }
      }
    } catch (err) {
      console.error('[Ollama Service Error] Failed to launch Ollama executable:', err);
    }

    return false;
  })();

  try {
    return await startingServicePromise;
  } finally {
    startingServicePromise = null;
  }
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
  const now = Date.now();
  if (lastStatusCache && now - lastStatusCache.timestamp < 2000 && !lastStatusCache.status.downloading) {
    return lastStatusCache.status;
  }

  const ramInfo = checkSystemRam();
  const installCheck = isOllamaInstalled();
  const baseUrl = config.llm.baseUrl || 'http://localhost:11434';
  let running = await isLocalServerReachable(`${baseUrl}/api/tags`, 1500);

  if (!running && installCheck.installed) {
    running = await tryStartOllamaService();
  }

  if (!running) {
    const result: OllamaStatus = {
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
    lastStatusCache = { status: result, timestamp: now };
    return result;
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

  const result: OllamaStatus = {
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
  lastStatusCache = { status: result, timestamp: now };
  return result;
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
