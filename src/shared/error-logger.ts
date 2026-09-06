import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths, ensureUserDataDirectories } from './paths';

/**
 * Logs errors exclusively to err.txt on disk (both in current working directory and AppData)
 * ensuring zero error popups or error banners appear on the renderer UI.
 */
export function logErrorToFile(error: any, context = 'General'): void {
  const timestamp = new Date().toISOString();
  const errorMsg = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
  const logEntry = `[${timestamp}] [${context}] ${errorMsg}\n----------------------------------------\n`;

  // Always log to terminal console for debugging
  console.error(`[Error Logger - ${context}]:`, errorMsg);

  // 1. Write to cwd/err.txt
  try {
    const cwdErrPath = path.join(process.cwd(), 'err.txt');
    fs.appendFileSync(cwdErrPath, logEntry, 'utf-8');
  } catch {
    // Ignore cwd write failures
  }

  // 2. Write to %APPDATA%\pixi\err.txt
  try {
    ensureUserDataDirectories();
    const appDataErrPath = path.join(getAppPaths().userDataDir, 'err.txt');
    fs.appendFileSync(appDataErrPath, logEntry, 'utf-8');
  } catch {
    // Ignore AppData write failures
  }
}
