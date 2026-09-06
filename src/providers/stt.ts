import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { config } from '../shared/config';
import { isLocalServerReachable } from '../shared/http-util';
import type { TranscriptionResult } from '../shared/types';
import { getSelectedModelName, isModelDownloaded, getModelPath, downloadWhisperModel, downloadWhisperBinary, findExeRecursive } from './whisper-manager';
import { getAppPaths } from '../shared/paths';

export interface STTProvider {
  name: string;
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}

export class OpenAiSTT implements STTProvider {
  public name = 'openai';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error('OpenAI API key is missing.');

    const formData = new FormData();
    const uint8 = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8], { type: 'audio/wav' });
    formData.append('file', blob, 'recording.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI STT failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

export class GroqSTT implements STTProvider {
  public name = 'groq';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error('Groq API key is missing.');

    const formData = new FormData();
    const uint8 = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8], { type: 'audio/wav' });
    formData.append('file', blob, 'recording.wav');
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'en');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq STT failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

export class ElevenLabsSTT implements STTProvider {
  public name = 'elevenlabs';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error('ElevenLabs API key is missing.');

    const formData = new FormData();
    const uint8 = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8], { type: 'audio/wav' });
    formData.append('file', blob, 'recording.wav');
    formData.append('model_id', 'scribe_v1');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs STT failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

export class LocalWhisperSTT implements STTProvider {
  public name = 'local-whisper';
  private baseUrl: string;

  constructor(baseUrl = config.stt.offlineBaseUrl) {
    this.baseUrl = baseUrl;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    // 1. Prefer an external local faster-whisper / whisper.cpp HTTP server if available.
    if (await isLocalServerReachable(this.baseUrl)) {
      try {
        const formData = new FormData();
        const uint8 = new Uint8Array(audioBuffer);
        const blob = new Blob([uint8], { type: 'audio/wav' });
        formData.append('audio', blob, 'recording.wav');

        const response = await fetch(`${this.baseUrl}/transcribe`, {
          method: 'POST',
          body: formData as unknown as BodyInit,
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.text || '';
          if (text.trim()) return { text };
        }
      } catch (err) {
        console.warn('[Local Whisper STT] Local HTTP server unreachable, falling back to CLI:', err);
      }
    }

    // 2. Fall back to a local whisper.cpp CLI binary if present.
    const activeModel = getSelectedModelName();
    const modelPath = getModelPath(activeModel);
    const downloaded = isModelDownloaded(activeModel);

    console.log(`[Local Whisper STT] Transcribing audio buffer (${audioBuffer.length} bytes) via model "${activeModel}" (downloaded=${downloaded})...`);

    if (!downloaded) {
      console.warn(`[Local Whisper STT] Model "${activeModel}" not downloaded. Attempting download...`);
      await downloadWhisperModel(activeModel);
    }

    let cliBinary = findWhisperExecutable();
    if (!cliBinary) {
      console.log('[Local Whisper STT] Executable binary not found. Attempting automatic download...');
      await downloadWhisperBinary();
      cliBinary = findWhisperExecutable();
    }

    if (cliBinary && fs.existsSync(modelPath)) {
      try {
        const text = await transcribeWithWhisperCli(audioBuffer, cliBinary, modelPath);
        return { text };
      } catch (err) {
        console.warn('[Local Whisper STT] CLI transcription failed:', err);
      }
    }

    console.warn('[Local Whisper STT] No usable local whisper backend found. Options:');
    console.warn('  - Set WHISPER_CPP_BINARY to a whisper.cpp main executable');
    console.warn('  - Start a local server at', this.baseUrl);
    console.warn('  - Configure an API key for cloud STT');
    return { text: '' };
  }
}


function findWhisperExecutable(): string | undefined {
  if (process.env.WHISPER_CPP_BINARY && fs.existsSync(process.env.WHISPER_CPP_BINARY)) {
    return process.env.WHISPER_CPP_BINARY;
  }

  try {
    const binDir = path.join(getAppPaths().userDataDir, 'bin');
    if (fs.existsSync(binDir)) {
      const found = findExeRecursive(binDir);
      if (found) return found;
    }
  } catch {
    // ignore
  }

  return (
    findExecutableInPath('whisper-cli') ||
    findExecutableInPath('whisper-cpp') ||
    findExecutableInPath('whisper') ||
    findExecutableInPath('main')
  );
}

function findExecutableInPath(name: string): string | undefined {
  const extensions = ['.exe', '.cmd', '.bat', ''];
  const paths = (process.env.PATH || '').split(';');
  for (const dir of paths) {
    for (const ext of extensions) {
      const full = path.join(dir, name + ext);
      try {
        if (fs.existsSync(full) && !fs.statSync(full).isDirectory()) return full;
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

function writeTempWav(buffer: Buffer): string {
  const tmp = path.join(os.tmpdir(), `pixi_stt_${Date.now()}.wav`);
  fs.writeFileSync(tmp, buffer);
  return tmp;
}

function transcribeWithWhisperCli(audioBuffer: Buffer, cliBinary: string, modelPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpWav = writeTempWav(audioBuffer);
    const outputPrefix = path.join(os.tmpdir(), `pixi_whisper_${Date.now()}`);
    const outputTxt = `${outputPrefix}.txt`;
    const args = [
      '-m', modelPath,
      '-f', tmpWav,
      '-otxt',
      '-of', outputPrefix,
      '-l', 'en',
      '-nt',
    ];

    console.log(`[Local Whisper STT] Running CLI: ${cliBinary} ${args.join(' ')}`);
    const proc = spawn(cliBinary, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('error', (err) => {
      cleanupFiles(tmpWav, outputTxt);
      reject(err);
    });

    proc.on('close', (code) => {
      try {
        let text = '';
        if (fs.existsSync(outputTxt)) {
          text = fs.readFileSync(outputTxt, 'utf-8').replace(/\[.*?\]/g, '').trim();
          fs.unlinkSync(outputTxt);
        } else if (stdout.trim()) {
          text = stdout.replace(/\[.*?\]/g, '').trim();
        }

        // Filter out CLI deprecation warnings (e.g. from main.exe)
        text = text
          .split('\n')
          .filter((line) => {
            const l = line.trim();
            return (
              !l.startsWith('WARNING:') &&
              !l.includes('deprecated') &&
              !l.includes('ggerganov/whisper.cpp') &&
              !l.startsWith('Please use')
            );
          })
          .join(' ')
          .trim();

        cleanupFiles(tmpWav);
        if (code !== 0 && !text) {
          reject(new Error(`whisper.cpp exited ${code}: ${stderr || 'no stderr'}`));
        } else {
          console.log(`[Local Whisper STT] Transcribed text: "${text}"`);
          resolve(text);
        }
      } catch (err) {
        reject(err);
      }
    });
  });
}

function cleanupFiles(...files: string[]): void {
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
}

export class CloudflareSTT implements STTProvider {
  public name = 'cloudflare';
  private accountId: string;
  private apiToken: string;
  private gatewayId: string;
  private model: string;
  private fallbacks: STTProvider[];

  constructor(
    accountId: string,
    apiToken: string,
    gatewayId = '',
    model = '@cf/openai/whisper',
    fallbacks: STTProvider[] = [],
  ) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.gatewayId = gatewayId;
    this.model = model;
    this.fallbacks = fallbacks;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiToken) throw new Error('Cloudflare API Token is missing.');

    try {
      if (this.gatewayId && this.accountId) {
        const formData = new FormData();
        const uint8 = new Uint8Array(audioBuffer);
        const blob = new Blob([uint8], { type: 'audio/wav' });
        formData.append('file', blob, 'recording.wav');
        formData.append('model', 'whisper-1');

        const url = `https://gateway.ai.cloudflare.com/v1/${this.accountId}/${this.gatewayId}/openai/audio/transcriptions`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiToken}` },
          body: formData as unknown as BodyInit,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Cloudflare AI Gateway STT failed (${response.status}): ${errText || response.statusText}`);
        }

        const data = await response.json();
        return { text: data.text || '' };
      }

      if (!this.accountId) throw new Error('Cloudflare Account ID is missing.');

      const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.model}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: audioBuffer as unknown as BodyInit,
      });

      if (!response.ok) {
        const errText = await response.text();
        let detail = errText || response.statusText;
        if (response.status === 401) {
          detail = `Authentication error (401). Verify CLOUDFLARE_API_TOKEN in .env has 'Workers AI - Read/Edit' permissions. Raw error: ${errText}`;
        }
        throw new Error(`Cloudflare Workers AI STT failed (${response.status}): ${detail}`);
      }

      const data = await response.json();
      const text = data.result?.text || data.text || '';
      return { text };
    } catch (err) {
      console.warn(`[Cloudflare STT Warning]: ${err instanceof Error ? err.message : err}`);
      for (const fallback of this.fallbacks) {
        try {
          console.warn('[Cloudflare STT] Attempting fallback STT provider...');
          return await fallback.transcribe(audioBuffer);
        } catch {
          // try next fallback
        }
      }
      throw err;
    }
  }
}

export function createPrimarySTTProvider(): STTProvider | null {
  const provider = config.stt.provider;

  switch (provider) {
    case 'openai':
      if (config.stt.openAiKey) return new OpenAiSTT(config.stt.openAiKey);
      console.warn('[STT] Provider forced to openai but OPENAI_API_KEY missing.');
      return null;
    case 'groq':
      if (config.stt.groqKey) return new GroqSTT(config.stt.groqKey);
      console.warn('[STT] Provider forced to groq but GROQ_API_KEY missing.');
      return null;
    case 'cloudflare':
      if (config.cloudflare.apiToken && config.cloudflare.accountId) {
        return new CloudflareSTT(
          config.cloudflare.accountId,
          config.cloudflare.apiToken,
          config.cloudflare.gatewayId,
          config.cloudflare.sttModel,
        );
      }
      console.warn('[STT] Provider forced to cloudflare but CLOUDFLARE_API_TOKEN or ACCOUNT_ID missing.');
      return null;
    default:
      return null;
  }
}

/**
 * Creates the configured cloud STT provider with automatic fallback to local Whisper.
 * Use this if you want an STTProvider directly, rather than the STTRouter.
 */
export async function createSTTProvider(): Promise<STTProvider> {
  const primary = createPrimarySTTProvider();
  if (primary) return primary;
  return new LocalWhisperSTT();
}
