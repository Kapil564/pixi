import {
  type TTSProvider,
  createPrimaryTTSProvider,
  PiperLocalTTS,
} from './tts';
import { withProviderFallback } from './provider-fallback';

export class TTSRouter implements TTSProvider {
  public name = 'tts-router';

  constructor(
    private primary: TTSProvider | null,
    private local: TTSProvider
  ) {}

  async speak(text: string, onStart?: () => void): Promise<void> {
    return withProviderFallback(
      this.primary,
      this.local,
      (p) => p.speak(text, onStart),
      text,
      {
        routerName: 'TTS Router',
        fallbackNotice: 'Automatically failing over to local Piper voice model...',
        localProviderUsed: 'local-piper',
        title: 'pixi Offline Voice',
        message: 'API rate limit reached. Switched to offline voice for speech synthesis.',
      },
    );
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