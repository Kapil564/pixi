import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { config } from '../shared/config';
import { getSelectedVoiceName, isVoiceDownloaded, getVoicePath, downloadPiperVoice, downloadPiperBinary } from './piper-manager';
import { getAppPaths } from '../shared/paths';

export interface TTSProvider {
  name: string;
  speak(text: string): Promise<void>;
  stop(): void;
}

let activePlaybackProcess: ChildProcess | null = null;
let playbackQueue: Promise<void> = Promise.resolve();

function stopActivePlayback(): void {
  if (activePlaybackProcess && !activePlaybackProcess.killed) {
    try {
      const pid = activePlaybackProcess.pid;
      activePlaybackProcess.kill('SIGKILL');
      if (pid) {
        spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true });
      }
    } catch (err) {
      console.debug('[TTS Stop Warning]:', err);
    }
    activePlaybackProcess = null;
  }
}

function spawnPowerShellScript(script: string): ChildProcess {
  const encodedCommand = Buffer.from(script, 'utf-16le').toString('base64');
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
    windowsHide: true,
  });
}

function playAudioBuffer(buffer: Buffer): Promise<void> {
  playbackQueue = playbackQueue.then(async () => {
    stopActivePlayback();
    const isMp3 = buffer.slice(0, 3).toString('utf8') === 'ID3' || buffer[0] === 0xff;
    const ext = isMp3 ? 'mp3' : 'wav';
    const tempFile = path.join(os.tmpdir(), `saira_speech_${Date.now()}.${ext}`);
    fs.writeFileSync(tempFile, buffer);

    await new Promise<void>((resolve) => {
      const script = `
        try {
          Add-Type -AssemblyName presentationCore
          $player = New-Object System.Windows.Media.MediaPlayer
          $player.Open([Uri]"file:///${tempFile.replace(/\\/g, '/')}")
          $waited = 0
          while ($player.NaturalDuration.HasTimeSpan -eq $false -and $waited -lt 40) {
            Start-Sleep -Milliseconds 100
            $waited++
          }
          $player.Play()
          if ($player.NaturalDuration.HasTimeSpan) {
            $ms = [math]::Ceiling($player.NaturalDuration.TimeSpan.TotalMilliseconds)
            Start-Sleep -Milliseconds ($ms + 300)
          } else {
            Start-Sleep -Seconds 5
          }
          $player.Close()
        } catch {
          try {
            $wmp = New-Object -ComObject WMPlayer.OCX
            $wmp.URL = "${tempFile.replace(/\\/g, '\\\\')}"
            $wmp.controls.play()
            while ($wmp.playState -ne 1 -and $wmp.playState -ne 8) { Start-Sleep -Milliseconds 200 }
          } catch {
            $sp = New-Object System.Media.SoundPlayer("${tempFile.replace(/\\/g, '\\\\')}")
            $sp.PlaySync()
          }
        }
      `;
      activePlaybackProcess = spawnPowerShellScript(script);

      activePlaybackProcess.on('close', () => {
        try {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (err) {
          console.debug('[TTS File Cleanup Warning]:', err);
        }
        activePlaybackProcess = null;
        resolve();
      });

      activePlaybackProcess.on('error', (err) => {
        console.warn('[TTS Playback Process Error]:', err);
        activePlaybackProcess = null;
        resolve();
      });
    });
  }).catch((err) => {
    console.warn('[TTS Playback Queue Warning]:', err);
  });

  return playbackQueue;
}

export class PiperLocalTTS implements TTSProvider {
  public name = 'local-piper';
  private child: ChildProcess | null = null;

  async speak(text: string): Promise<void> {
    const activeVoice = getSelectedVoiceName();
    const voicePath = getVoicePath(activeVoice);
    const downloaded = isVoiceDownloaded(activeVoice);

    console.log(`[Piper Local TTS] Synthesizing "${text.slice(0, 30)}..." via voice model "${activeVoice}" (downloaded=${downloaded})...`);

    if (!downloaded) {
      console.warn(`[Piper Local TTS] Voice "${activeVoice}" not downloaded. Attempting download...`);
      await downloadPiperVoice(activeVoice);
    }

    let piperBinary = findPiperExecutable();
    if (!piperBinary) {
      console.warn('[Piper Local TTS] Piper executable binary missing. Attempting automatic download...');
      await downloadPiperBinary();
      piperBinary = findPiperExecutable();
    }

    if (!piperBinary || !fs.existsSync(voicePath)) {
      console.warn('[Piper Local TTS] Unable to locate Piper binary or voice model file after download attempts.');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const outputWav = path.join(os.tmpdir(), `saira_piper_${Date.now()}.wav`);
        const configJsonPath = `${voicePath}.json`;
        const args = ['-m', voicePath, '-f', outputWav];
        if (fs.existsSync(configJsonPath)) {
          args.push('-c', configJsonPath);
        }

        console.log(`[Piper Local TTS] Running: ${piperBinary} ${args.join(' ')}`);

        this.child = spawn(piperBinary, args, { windowsHide: true });
        let stderr = '';
        this.child.stderr?.on('data', (data) => { stderr += data.toString(); });

        this.child.on('error', (err) => {
          cleanupPiperFiles(outputWav);
          this.child = null;
          reject(err);
        });

        this.child.on('close', async (code) => {
          this.child = null;
          if (fs.existsSync(outputWav) && fs.statSync(outputWav).size > 100) {
            try {
              const buffer = fs.readFileSync(outputWav);
              cleanupPiperFiles(outputWav);
              await playAudioBuffer(buffer);
              resolve();
            } catch (err) {
              cleanupPiperFiles(outputWav);
              reject(err);
            }
          } else {
            cleanupPiperFiles(outputWav);
            reject(new Error(`Piper failed (exit code ${code}): ${stderr || 'No output WAV generated.'}`));
          }
        });

        // Piper reads text from stdin
        this.child.stdin?.write(text, 'utf-8');
        this.child.stdin?.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  stop(): void {
    stopActivePlayback();
    if (this.child && !this.child.killed) {
      try {
        const pid = this.child.pid;
        this.child.kill('SIGKILL');
        if (pid) {
          spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true });
        }
      } catch {
        // ignore
      }
      this.child = null;
    }
  }
}

export class FishAudioTTS implements TTSProvider {
  public name = 'fishaudio';
  private apiKey: string;
  private referenceId: string;
  private model: string;
  private fallback: TTSProvider;

  constructor(apiKey: string, referenceId = '933563129e564b19a115bedd57b7406a', model = 's2.1-pro-free') {
    this.apiKey = apiKey;
    this.referenceId = referenceId || '933563129e564b19a115bedd57b7406a';
    this.model = model || 's2.1-pro-free';
    this.fallback = createFallbackTTS();
  }

  async speak(text: string): Promise<void> {
    const key = this.apiKey || config.tts.fishAudioKey;
    if (!key) {
      return this.fallback.speak(text);
    }

    try {
      const { FishAudioClient } = await import('fish-audio');
      const client = new FishAudioClient({ apiKey: key });
      const targetModel = this.model || 's2.1-pro-free';

      const payload: { text: string; format: string; reference_id?: string } = {
        text,
        format: 'mp3',
      };
      if (this.referenceId) {
        payload.reference_id = this.referenceId;
      }

      const stream = await client.textToSpeech.convert(payload as any, targetModel as any);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as any) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      await playAudioBuffer(buffer);
    } catch (sdkErr) {
      console.warn('[Fish Audio SDK Warning]:', sdkErr, '. Attempting direct REST fetch fallback...');
      try {
        const body: Record<string, any> = {
          text,
          format: 'mp3',
          model: this.model || 's2.1-pro-free',
        };
        if (this.referenceId) {
          body.reference_id = this.referenceId;
        }

        const response = await fetch('https://api.fish.audio/v1/tts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          throw new Error(`Fish Audio TTS failed (${response.status}): ${errText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await playAudioBuffer(buffer);
      } catch (err) {
        throw err;
      }
    }
  }

  stop(): void {
    stopActivePlayback();
    this.fallback.stop();
  }
}

export class ElevenLabsTTS implements TTSProvider {
  public name = 'elevenlabs';
  private apiKey: string;
  private voiceId: string;

  constructor(apiKey: string, voiceId: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId || 'C8uRRxxNZH0vRqJbVFJy';
  }

  async speak(text: string): Promise<void> {
    if (!this.apiKey) throw new Error('ElevenLabs API key is missing.');

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errText || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer);
  }

  stop(): void {
    stopActivePlayback();
  }
}

export class AzureTTS implements TTSProvider {
  public name = 'azure';
  private apiKey: string;
  private region: string;

  constructor(apiKey: string, region: string) {
    this.apiKey = apiKey;
    this.region = region;
  }

  async speak(text: string): Promise<void> {
    if (!this.apiKey || !this.region) {
      throw new Error('Azure Speech key and region are required.');
    }

    const tokenResponse = await fetch(
      `https://${this.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
      },
    );

    if (!tokenResponse.ok) {
      throw new Error(`Azure token request failed (${tokenResponse.status}): ${tokenResponse.statusText}`);
    }

    const token = await tokenResponse.text();
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-JennyNeural">${text.replace(/</g, '&lt;')}</voice></speak>`;

    const response = await fetch(
      `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          Authorization: `Bearer ${token}`,
        },
        body: ssml,
      },
    );

    if (!response.ok) {
      throw new Error(`Azure TTS failed (${response.status}): ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer);
  }

  stop(): void {
    stopActivePlayback();
  }
}

export class CloudflareElevenLabsTTS implements TTSProvider {
  public name = 'cloudflare';
  private accountId: string;
  private apiToken: string;
  private gatewayId: string;
  private model: string;
  private voiceId: string;

  constructor(
    accountId: string,
    apiToken: string,
    gatewayId = '',
    model = 'elevenlabs/eleven-multilingual-v2',
    voiceId = '',
  ) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.gatewayId = gatewayId;
    this.model = model;
    this.voiceId = voiceId || 'QTKSa2Iyv0yoxvXY2V8a';
  }

  async speak(text: string): Promise<void> {
    if (!this.accountId || !this.apiToken) {
      throw new Error('Cloudflare account ID and API token are required.');
    }

    let url: string;
    let body: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiToken}`,
    };

    if (this.gatewayId) {
      url = `https://gateway.ai.cloudflare.com/v1/${this.accountId}/${this.gatewayId}/elevenlabs/v1/text-to-speech/${this.voiceId}`;
      if (process.env.ELEVENLABS_API_KEY) {
        headers['xi-api-key'] = process.env.ELEVENLABS_API_KEY;
      }
      body = JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
      });
    } else {
      let targetModel = this.model || '@cf/myshell/melotts-english';
      if (targetModel.includes('elevenlabs')) {
        targetModel = '@cf/myshell/melotts-english';
      }
      url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${targetModel}`;
      body = JSON.stringify({ text });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cloudflare TTS failed (${response.status}): ${errText || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer);
  }

  stop(): void {
    stopActivePlayback();
  }
}

function createFallbackTTS(): TTSProvider {
  return new PiperLocalTTS();
}

export function createPrimaryTTSProvider(): TTSProvider | null {
  const provider = config.tts.provider;

  switch (provider) {
    case 'fishaudio':
      if (config.tts.fishAudioKey) {
        return new FishAudioTTS(config.tts.fishAudioKey, config.tts.referenceId, config.tts.model);
      }
      console.warn('[TTS] Provider forced to fishaudio but FISH_AUDIO_API_KEY missing.');
      return null;
    case 'elevenlabs':
      if (config.tts.elevenLabsKey) {
        return new ElevenLabsTTS(config.tts.elevenLabsKey, config.tts.voiceId);
      }
      console.warn('[TTS] Provider forced to elevenlabs but ELEVENLABS_API_KEY missing.');
      return null;
    case 'azure':
      if (config.tts.azureKey && config.tts.region) {
        return new AzureTTS(config.tts.azureKey, config.tts.region);
      }
      console.warn('[TTS] Provider forced to azure but AZURE_SPEECH_KEY and/or AZURE_SPEECH_REGION missing.');
      return null;
    case 'cloudflare':
      if (config.cloudflare.accountId && config.cloudflare.apiToken) {
        return new CloudflareElevenLabsTTS(
          config.cloudflare.accountId,
          config.cloudflare.apiToken,
          config.cloudflare.gatewayId,
          config.cloudflare.ttsModel,
          config.tts.voiceId,
        );
      }
      console.warn('[TTS] Provider forced to cloudflare but CLOUDFLARE_API_TOKEN or ACCOUNT_ID missing.');
      return null;
    case 'piper':
    default:
      return null;
  }
}

function findPiperExecutable(): string | undefined {
  if (process.env.PIPER_BINARY && fs.existsSync(process.env.PIPER_BINARY)) {
    return process.env.PIPER_BINARY;
  }

  try {
    const binDir = path.join(getAppPaths().userDataDir, 'bin');
    const candidates = [
      path.join(binDir, 'piper.exe'),
      path.join(binDir, 'piper-tts.exe'),
      path.join(binDir, 'piper', 'piper.exe'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // ignore
  }

  return (
    findExecutableInPath('piper') ||
    findExecutableInPath('piper-tts')
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

function cleanupPiperFiles(...files: string[]): void {
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
}

export function createTTSProvider(): TTSProvider {
  const primary = createPrimaryTTSProvider();
  if (primary) return primary;
  return createFallbackTTS();
}
