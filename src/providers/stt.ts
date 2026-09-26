import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { config } from '../shared/config';
import { isLocalServerReachable, assertOk } from '../shared/http-util';
import type { TranscriptionResult } from '../shared/types';
import { getSelectedModelName, isModelDownloaded, getModelPath, downloadWhisperModel, downloadWhisperBinary } from './whisper-manager';
import { cleanupFiles, findLocalBinary } from '../shared/disk-util';

export interface STTProvider {
  name: string;
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}

export class MultipartSTT implements STTProvider {
  public name: string;
  private apiKey: string;
  private url: string;
  private authHeader: string;
  private authValue: string;
  private modelField: string;
  private model: string;
  private language?: string;

  constructor(config: {
    name: string;
    url: string;
    apiKey: string;
    model: string;
    authHeader?: string;
    authValue?: string;
    modelField?: string;
    language?: string;
  }) {
    this.name = config.name;
    this.url = config.url;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.authHeader = config.authHeader ?? 'Authorization';
    this.authValue = config.authValue ?? `Bearer ${config.apiKey}`;
    this.modelField = config.modelField ?? 'model';
    this.language = config.language;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error(`${this.name} API key is missing.`);

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' }), 'recording.wav');
    formData.append(this.modelField, this.model);
    if (this.language) formData.append('language', this.language);

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { [this.authHeader]: this.authValue },
      body: formData as unknown as BodyInit,
    });

    await assertOk(response, `${this.name} STT`);

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
  return findLocalBinary({
    envVar: 'WHISPER_CPP_BINARY',
    recursive: true,
    pathNames: ['whisper-cli', 'whisper-cpp', 'whisper', 'main'],
  });
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

export function createPrimarySTTProvider(): STTProvider | null {
  const provider = config.stt.provider;

  switch (provider) {
    case 'openai':
      if (config.stt.openAiKey) return new MultipartSTT({
        name: 'openai',
        url: 'https://api.openai.com/v1/audio/transcriptions',
        apiKey: config.stt.openAiKey,
        model: 'whisper-1',
        language: 'en',
      });
      console.warn('[STT] Provider forced to openai but OPENAI_API_KEY missing.');
      return null;
    case 'elevenlabs':
      if (config.stt.elevenLabsKey) {
        return new MultipartSTT({
          name: 'elevenlabs',
          url: 'https://api.elevenlabs.io/v1/speech-to-text',
          apiKey: config.stt.elevenLabsKey,
          model: 'scribe_v1',
          authHeader: 'xi-api-key',
          authValue: config.stt.elevenLabsKey,
          modelField: 'model_id',
        });
      }
      console.warn('[STT] Provider forced to elevenlabs but ELEVENLABS_API_KEY missing.');
      return null;
    default:
      return null;
  }
}
