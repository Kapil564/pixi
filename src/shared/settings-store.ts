import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getAppPaths, ensureUserDataDirectories } from './paths';
import { applyUserSettingsToConfig } from './config';

export interface UserSettings {
  onboardingCompleted: boolean;
  mode?: 'offline' | 'cloud' | 'custom';
  apiKeys: {
    openai?: string;
    gemini?: string;
    opencode?: string;
    elevenlabs?: string;
  };
}

const DEFAULT_SETTINGS: UserSettings = {
  onboardingCompleted: false,
  mode: 'custom',
  apiKeys: {},
};

function getSettingsFilePath(): string {
  ensureUserDataDirectories();
  return path.join(getAppPaths().userDataDir, 'settings.json');
}

function getMachineSecretKey(): string {
  const user = os.userInfo?.()?.username || 'user';
  const host = os.hostname() || 'windows';
  return `pixi-secret:${user}@${host}`;
}

function xorTransform(buffer: Buffer, key: string): Buffer {
  const keyBuffer = Buffer.from(key, 'utf-8');
  const result = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    result[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
  }
  return result;
}

function obfuscateFallback(plainText: string): string {
  return `obf:${xorTransform(Buffer.from(plainText, 'utf-8'), getMachineSecretKey()).toString('base64')}`;
}

function deobfuscateFallback(obfText: string): string {
  if (!obfText.startsWith('obf:')) return obfText;
  try {
    return xorTransform(Buffer.from(obfText.slice(4), 'base64'), getMachineSecretKey()).toString('utf-8');
  } catch {
    return obfText;
  }
}

function getSecureChannel(): { encryptString(s: string): Buffer; decryptString(b: Buffer): string } | null {
  try {
    const { app, safeStorage } = require('electron');
    if (app && typeof app.isReady === 'function' && app.isReady() && safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage;
    }
  } catch (err) {
    console.warn('[Settings Store Warning] safeStorage unavailable:', err);
  }
  return null;
}

/**
 * Encrypts sensitive API key strings using Electron safeStorage (DPAPI) or machine-bound fallback.
 */
function encryptSecret(secret?: string): string | undefined {
  if (!secret) return undefined;
  if (secret.startsWith('enc:') || secret.startsWith('obf:')) return secret; // Already encrypted

  const secureChannel = getSecureChannel();
  if (secureChannel) {
    return `enc:${secureChannel.encryptString(secret).toString('base64')}`;
  }
  return obfuscateFallback(secret);
}

/**
 * Decrypts sensitive API key strings using Electron safeStorage (DPAPI) or machine-bound fallback.
 */
function decryptSecret(secret?: string): string | undefined {
  if (!secret) return undefined;
  if (secret.startsWith('obf:')) return deobfuscateFallback(secret);
  if (!secret.startsWith('enc:')) return secret; // Unencrypted legacy plain text

  const secureChannel = getSecureChannel();
  if (secureChannel) {
    return secureChannel.decryptString(Buffer.from(secret.slice(4), 'base64'));
  }
  return secret;
}

let cachedSettings: UserSettings | null = null;

function areSettingsEqual(a: UserSettings, b: UserSettings): boolean {
  if (a.onboardingCompleted !== b.onboardingCompleted) return false;
  if (a.mode !== b.mode) return false;
  const keysA = a.apiKeys || {};
  const keysB = b.apiKeys || {};
  const allKeys = new Set([...Object.keys(keysA), ...Object.keys(keysB)]);
  for (const k of allKeys) {
    if ((keysA as Record<string, string | undefined>)[k] !== (keysB as Record<string, string | undefined>)[k]) {
      return false;
    }
  }
  return true;
}

/**
 * Reads user settings from %APPDATA%\pixi\settings.json and syncs with runtime config.
 * Caches settings in memory to avoid repeated synchronous disk reads and redundant config triggers.
 */
export function getSettings(forceReload = false): UserSettings {
  if (cachedSettings && !forceReload) {
    return cachedSettings;
  }

  const filePath = getSettingsFilePath();
  let loaded: UserSettings = DEFAULT_SETTINGS;

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      const rawKeys = parsed.apiKeys || {};

      loaded = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        apiKeys: {
          openai: decryptSecret(rawKeys.openai),
          gemini: decryptSecret(rawKeys.gemini),
          opencode: decryptSecret(rawKeys.opencode),
          elevenlabs: decryptSecret(rawKeys.elevenlabs),
        },
      };
    }
  } catch (err) {
    console.warn('[Settings Store Error] Failed to read settings.json:', err);
  }

  cachedSettings = loaded;
  applyUserSettingsToConfig(loaded);
  return loaded;
}

/**
 * Saves user settings to %APPDATA%\pixi\settings.json and syncs with runtime config.
 * Skips disk writes and redundant notifications if the settings have not changed.
 */
export function saveSettings(settings: Partial<UserSettings>): UserSettings {
  const current = getSettings();
  const updated: UserSettings = {
    ...current,
    ...settings,
    apiKeys: { ...current.apiKeys, ...(settings.apiKeys || {}) },
  };

  if (areSettingsEqual(current, updated)) {
    return current;
  }

  try {
    const filePath = getSettingsFilePath();
    const diskSettings = {
      ...updated,
      apiKeys: {
        openai: encryptSecret(updated.apiKeys.openai),
        gemini: encryptSecret(updated.apiKeys.gemini),
        opencode: encryptSecret(updated.apiKeys.opencode),
        elevenlabs: encryptSecret(updated.apiKeys.elevenlabs),
      },
    };

    fs.writeFileSync(filePath, JSON.stringify(diskSettings, null, 2), 'utf-8');
    console.log('[Settings Store] Successfully saved user settings to settings.json.');
    cachedSettings = updated;
  } catch (err) {
    console.error('[Settings Store Error] Failed to write settings.json:', err);
    throw err instanceof Error ? err : new Error(`Failed to save settings: ${String(err)}`);
  }

  applyUserSettingsToConfig(updated);
  return updated;
}

/**
 * Resets user settings and wipes stored API keys.
 */
export function resetUserSettings(): UserSettings {
  const filePath = getSettingsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[Settings Store] Reset user settings: deleted settings.json');
    }
  } catch (err) {
    console.warn('[Settings Store Error] Failed to delete settings.json during reset:', err);
  }
  cachedSettings = null;
  return getSettings(true);
}
