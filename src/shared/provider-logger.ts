import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from './paths';

export interface ProviderLogEntry {
  timestamp: string;
  turnPrompt: string;
  providerUsed: string;
  fallbackOccurred: boolean;
  reason?: string;
  errorDetails?: string;
}

/**
 * Logs turn provider usage and fallback events locally to %APPDATA%\pixi\provider_logs.jsonl.
 * Data is 100% private to the local machine and never transmitted remotely.
 */
export function logProviderUsage(entry: Omit<ProviderLogEntry, 'timestamp'>): void {
  try {
    const paths = getAppPaths();
    if (!fs.existsSync(paths.userDataDir)) {
      fs.mkdirSync(paths.userDataDir, { recursive: true });
    }

    const logPath = path.join(paths.userDataDir, 'provider_logs.jsonl');
    const record: ProviderLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch (err) {
    console.error('[Provider Logger Error] Failed to write local provider log:', err);
  }
}
