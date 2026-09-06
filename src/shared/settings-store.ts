import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getAppPaths, ensureUserDataDirectories } from './paths';
import { applyUserSettingsToConfig } from './config';

export interface UserSettings {
  onboardingCompleted: boolean;
  mode: 'offline' | 'cloud';
  apiKeys: {
    openai?: string;
    gemini?: string;
    groq?: string;
    fishaudio?: string;
    elevenlabs?: string;
  };
}

const DEFAULT_SETTINGS: UserSettings = {
  onboardingCompleted: false,
  mode: 'offline',
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

function obfuscateFallback(plainText: string): string {
  const key = getMachineSecretKey();
  const buffer = Buffer.from(plainText, 'utf-8');
  const keyBuffer = Buffer.from(key, 'utf-8');
  const result = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    result[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
  }
  return `obf:${result.toString('base64')}`;
}

function deobfuscateFallback(obfText: string): string {
  if (!obfText.startsWith('obf:')) return obfText;
  try {
    const rawBase64 = obfText.slice(4);
    const buffer = Buffer.from(rawBase64, 'base64');
    const key = getMachineSecretKey();
    const keyBuffer = Buffer.from(key, 'utf-8');
    const result = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      result[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
    }
    return result.toString('utf-8');
  } catch {
    return obfText;
  }
}

/**
 * Encrypts sensitive API key strings using Electron safeStorage (DPAPI) or machine-bound fallback.
 */
function encryptSecret(secret?: string): string | undefined {
  if (!secret) return undefined;
  if (secret.startsWith('enc:') || secret.startsWith('obf:')) return secret; // Already encrypted

  try {
    const { app, safeStorage } = require('electron');
    if (app && typeof app.isReady === 'function' && app.isReady() && safeStorage && safeStorage.isEncryptionAvailable()) {
      const encryptedBuffer = safeStorage.encryptString(secret);
      return `enc:${encryptedBuffer.toString('base64')}`;
    }
  } catch (err) {
    console.warn('[Settings Store Warning] safeStorage encryption unavailable, using machine-bound obfuscation:', err);
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

  try {
    const { app, safeStorage } = require('electron');
    if (app && typeof app.isReady === 'function' && app.isReady() && safeStorage && safeStorage.isEncryptionAvailable()) {
      const base64Str = secret.slice(4);
      const encryptedBuffer = Buffer.from(base64Str, 'base64');
      return safeStorage.decryptString(encryptedBuffer);
    }
  } catch (err) {
    console.warn('[Settings Store Warning] safeStorage decryption skipped:', err);
  }
  return secret;
}

/**
 * Reads user settings from %APPDATA%\pixi\settings.json and syncs with runtime config.
 */
export function getSettings(): UserSettings {
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
          groq: decryptSecret(rawKeys.groq),
          fishaudio: decryptSecret(rawKeys.fishaudio),
          elevenlabs: decryptSecret(rawKeys.elevenlabs),
        },
      };
    }
  } catch (err) {
    console.warn('[Settings Store Error] Failed to read settings.json:', err);
  }

  applyUserSettingsToConfig(loaded);
  return loaded;
}

/**
 * Saves user settings to %APPDATA%\pixi\settings.json and syncs with runtime config.
 */
export function saveSettings(settings: Partial<UserSettings>): UserSettings {
  const current = getSettings();
  const updated: UserSettings = {
    ...current,
    ...settings,
    apiKeys: { ...current.apiKeys, ...(settings.apiKeys || {}) },
  };

  try {
    const filePath = getSettingsFilePath();
    const diskSettings = {
      ...updated,
      apiKeys: {
        openai: encryptSecret(updated.apiKeys.openai),
        gemini: encryptSecret(updated.apiKeys.gemini),
        groq: encryptSecret(updated.apiKeys.groq),
        fishaudio: encryptSecret(updated.apiKeys.fishaudio),
        elevenlabs: encryptSecret(updated.apiKeys.elevenlabs),
      },
    };

    fs.writeFileSync(filePath, JSON.stringify(diskSettings, null, 2), 'utf-8');
    console.log('[Settings Store] Successfully saved user settings to settings.json.');
  } catch (err) {
    console.error('[Settings Store Error] Failed to write settings.json:', err);
    throw err instanceof Error ? err : new Error(`Failed to save settings: ${String(err)}`);
  }

  applyUserSettingsToConfig(updated);
  return updated;
}
