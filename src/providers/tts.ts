import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { config } from '../shared/config';
import { assertOk } from '../shared/http-util';
import { getSelectedVoiceName, isVoiceDownloaded, getVoicePath, downloadPiperVoice, downloadPiperBinary } from './piper-manager';
import { cleanupFiles, findLocalBinary } from '../shared/disk-util';
import { killProcessTree } from '../shared/exec-util';

export interface TTSProvider {
  name: string;
  speak(text: string, onStart?: () => void): Promise<void>;
  stop(): void;
}

let activePlaybackProcess: ChildProcess | null = null;
let playbackQueue: Promise<void> = Promise.resolve();

function stopActivePlayback(): void {
  if (activePlaybackProcess && !activePlaybackProcess.killed) {
    killProcessTree(activePlaybackProcess);
    activePlaybackProcess = null;
  }
}

function spawnPowerShellScript(script: string): ChildProcess {
  const encodedCommand = Buffer.from(script, 'utf-16le').toString('base64');
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
    windowsHide: true,
  });
}

function playAudioBuffer(buffer: Buffer, onStart?: () => void): Promise<void> {
  playbackQueue = playbackQueue.then(async () => {
    stopActivePlayback();
    const isMp3 = buffer.slice(0, 3).toString('utf8') === 'ID3' || buffer[0] === 0xff;
    const ext = isMp3 ? 'mp3' : 'wav';
    const tempFile = path.join(os.tmpdir(), `pixi_speech_${Date.now()}.${ext}`);
    fs.writeFileSync(tempFile, buffer);

    if (onStart) {
      try { onStart(); } catch {}
    }

    await new Promise<void>((resolve) => {
      const script = `
        if ("${ext}" -eq "wav") {
          try {
            $sp = New-Object System.Media.SoundPlayer("${tempFile.replace(/\\/g, '\\\\')}")
            $sp.PlaySync()
            exit 0
          } catch {}
        }
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

  async speak(text: string, onStart?: () => void): Promise<void> {
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
        const outputWav = path.join(os.tmpdir(), `pixi_piper_${Date.now()}.wav`);
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
          cleanupFiles(outputWav);
          this.child = null;
          reject(err);
        });

        this.child.on('close', async (code) => {
          this.child = null;
          if (code === null) {
            // Process was stopped or killed intentionally (e.g., barge-in / speech interrupted)
            cleanupFiles(outputWav);
            resolve();
            return;
          }

          if (fs.existsSync(outputWav) && fs.statSync(outputWav).size > 100) {
            try {
              const buffer = fs.readFileSync(outputWav);
              cleanupFiles(outputWav);
              await playAudioBuffer(buffer, onStart);
              resolve();
            } catch (err) {
              cleanupFiles(outputWav);
              reject(err);
            }
          } else {
            cleanupFiles(outputWav);
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
      killProcessTree(this.child);
      this.child = null;
    }
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

  async speak(text: string, onStart?: () => void): Promise<void> {
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

    await assertOk(response, 'ElevenLabs TTS');

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer, onStart);
  }

  stop(): void {
    stopActivePlayback();
  }
}

export function createPrimaryTTSProvider(): TTSProvider | null {
  const provider = config.tts.provider;

  switch (provider) {
    case 'elevenlabs':
      if (config.tts.elevenLabsKey) {
        return new ElevenLabsTTS(config.tts.elevenLabsKey, config.tts.voiceId);
      }
      console.warn('[TTS] Provider forced to elevenlabs but ELEVENLABS_API_KEY missing.');
      return null;
    case 'piper':
    default:
      return null;
  }
}

function findPiperExecutable(): string | undefined {
  return findLocalBinary({
    envVar: 'PIPER_BINARY',
    knownNames: ['piper.exe', 'piper-tts.exe', path.join('piper', 'piper.exe')],
    pathNames: ['piper', 'piper-tts'],
  });
}
