import {
  type TTSProvider,
  createPrimaryTTSProvider,
  PiperLocalTTS,
} from './tts';
export class TTSRouter implements TTSProvider {
  public name = 'tts-router';

  constructor(
    private primary: TTSProvider | null,
    private local: TTSProvider
  ) {}

  async speak(text: string, onStart?: () => void): Promise<void> {
    if (this.primary) {
      try {
        return await this.primary.speak(text, onStart);
      } catch (err) {
        console.warn(`[TTS Router] Primary (${this.primary.name}) failed speak, falling back to local Piper:`, err);
      }
    }
    return this.local.speak(text, onStart);
  }

  stop(): void {
    if (this.primary) {
      this.primary.stop();
    }
    this.local.stop();
  }
}

/**
 * Creates the TTSRouter with explicit primary provider priority (ElevenLabs)
 * and local Piper TTS fallback.
 */
export function createTTSRouter(): TTSProvider {
  const primaryProvider = createPrimaryTTSProvider();
  const localProvider = new PiperLocalTTS();

  if (primaryProvider) {
    console.log(`[TTS Router] Initialized Primary provider "${primaryProvider.name}" with local Piper fallback.`);
    return new TTSRouter(primaryProvider, localProvider);
  }

  console.log('[TTS Router] No cloud TTS API key configured. Running 100% local via Piper.');
  return new TTSRouter(null, localProvider);
}