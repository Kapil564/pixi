import notifier from 'node-notifier';
import {
  type TTSProvider,
  createPrimaryTTSProvider,
  PiperLocalTTS,
} from './tts';
import { isRateLimitOrQuotaError } from './llm-router';
import { logProviderUsage } from '../shared/provider-logger';

export class TTSRouter implements TTSProvider {
  public name = 'tts-router';

  constructor(
    private primary: TTSProvider | null,
    private local: TTSProvider
  ) {}

  async speak(text: string, onStart?: () => void): Promise<void> {
    if (this.primary) {
      try {
        await this.primary.speak(text, onStart);
        logProviderUsage({
          turnPrompt: text,
          providerUsed: this.primary.name,
          fallbackOccurred: false,
        });
        return;
      } catch (err) {
        if (isRateLimitOrQuotaError(err)) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[TTS Router] Primary provider (${this.primary.name}) rate limit/quota reached: ${errMsg}`);
          console.warn('[TTS Router] Automatically failing over to local Piper voice model...');

          // OS notification
          notifier.notify({
            title: 'pixi Offline Voice',
            message: 'API rate limit reached. Switched to offline voice for speech synthesis.',
            sound: false,
          });

          // Private local logging
          logProviderUsage({
            turnPrompt: text,
            providerUsed: 'local-piper',
            fallbackOccurred: true,
            reason: 'quota_exceeded',
            errorDetails: errMsg,
          });

          return await this.local.speak(text, onStart);
        }

        // Rethrow non-quota errors (auth/network/401) so they surface properly
        throw err;
      }
    }

    logProviderUsage({
      turnPrompt: text,
      providerUsed: 'local-piper',
      fallbackOccurred: false,
    });
    return await this.local.speak(text, onStart);
  }

  stop(): void {
    if (this.primary) {
      this.primary.stop();
    }
    this.local.stop();
  }
}

/**
 * Creates the TTSRouter with explicit primary provider priority (Fish Audio > ElevenLabs > Azure > Cloudflare)
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
