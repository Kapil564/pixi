import {
  type TTSProvider,
  createPrimaryTTSProvider,
  PiperLocalTTS,
} from './tts';

export class TTSRouter implements TTSProvider {
  public name = 'tts-router';
  private local: TTSProvider;

  constructor(local: TTSProvider = new PiperLocalTTS()) {
    this.local = local;
  }

  async speak(text: string, onStart?: () => void): Promise<void> {
    const primary = createPrimaryTTSProvider();
    if (primary) {
      try {
        return await primary.speak(text, onStart);
      } catch (err) {
        console.warn(`[TTS Router] Primary (${primary.name}) failed speak, falling back to local Piper:`, err);
      }
    }
    return this.local.speak(text, onStart);
  }

  stop(): void {
    const primary = createPrimaryTTSProvider();
    if (primary) {
      primary.stop();
    }
    this.local.stop();
  }
}

/**
 * Creates the TTSRouter with dynamic primary provider (ElevenLabs)
 * and local Piper TTS fallback.
 */
export function createTTSRouter(): TTSProvider {
  return new TTSRouter();
}