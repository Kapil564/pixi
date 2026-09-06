import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Resolves the OS-appropriate per-user app data directory:
 * - Electron main process: app.getPath('userData')
 * - Fallback (CLI / non-Electron / node process): %APPDATA%\pixi on Windows
 *   or ~/.config/pixi on Linux/macOS
 */
export function getUserDataDir(): string {
  // If running inside Electron main process
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // Not running in Electron main process
  }

  // Windows per-user AppData environment variable
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'pixi');
  }

  // Fallback using os.homedir() for Windows
  return path.join(os.homedir(), 'AppData', 'Roaming', 'pixi');
}

export interface AppPaths {
  userDataDir: string;
  dbPath: string;
  memoryDir: string;
  profileMdPath: string;
  archiveDir: string;
  migrationsFolder: string;
}

/**
 * Returns absolute per-user storage paths derived from getUserDataDir().
 */
export function getAppPaths(): AppPaths {
  const userDataDir = getUserDataDir();

  // Find Drizzle migrations folder location (dev vs prod bundle)
  // In packaged Electron apps we are inside dist/main/index.js, so migrations live
  // at app.asar root (../../drizzle), in dist/drizzle, or in app resources directory.
  const candidates = [
    path.join(__dirname, '..', '..', 'drizzle'),        // dist/main -> app root / app.asar root
    path.join(process.resourcesPath || '', 'app.asar', 'drizzle'), // electron-builder app.asar/drizzle
    path.join(__dirname, '..', 'drizzle'),              // dist/main -> dist/drizzle
    path.join(__dirname, 'drizzle'),                    // dist/drizzle
    path.join(process.cwd(), 'drizzle'),                // dev source root
    path.join(process.resourcesPath || '', 'drizzle'), // electron-builder resources
  ];
  let migrationsFolder = candidates[0];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      migrationsFolder = candidate;
      break;
    }
  }

  return {
    userDataDir,
    dbPath: path.join(userDataDir, 'assistant.db'),
    memoryDir: path.join(userDataDir, 'memory'),
    profileMdPath: path.join(userDataDir, 'memory', 'profile.md'),
    archiveDir: path.join(userDataDir, 'archive', 'sessions'),
    migrationsFolder,
  };
}

/**
 * Ensures per-user application directories exist on local disk.
 */
export function ensureUserDataDirectories(): void {
  const paths = getAppPaths();
  if (!fs.existsSync(paths.userDataDir)) {
    fs.mkdirSync(paths.userDataDir, { recursive: true });
  }
  if (!fs.existsSync(paths.memoryDir)) {
    fs.mkdirSync(paths.memoryDir, { recursive: true });
  }
  if (!fs.existsSync(paths.archiveDir)) {
    fs.mkdirSync(paths.archiveDir, { recursive: true });
  }
}
