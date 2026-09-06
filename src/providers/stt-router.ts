import notifier from 'node-notifier';
import type { TranscriptionResult } from '../shared/types';
import {
  type STTProvider,
  createPrimarySTTProvider,
  LocalWhisperSTT,
} from './stt';
import { isRateLimitOrQuotaError } from './llm-router';
import { logProviderUsage } from '../shared/provider-logger';

export class STTRouter implements STTProvider {
  public name = 'stt-router';

  constructor(
    private primary: STTProvider | null,
    private local: STTProvider
  ) {}

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (this.primary) {
      try {
        const result = await this.primary.transcribe(audioBuffer);
        logProviderUsage({
          turnPrompt: '[audio_input]',
          providerUsed: this.primary.name,
          fallbackOccurred: false,
        });
        return result;
      } catch (err) {
        if (isRateLimitOrQuotaError(err)) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[STT Router] Primary provider (${this.primary.name}) rate limit/quota reached: ${errMsg}`);
          console.warn('[STT Router] Automatically failing over to local Whisper model...');

          // Light OS notification
          notifier.notify({
            title: 'pixi Offline STT',
            message: 'API rate limit reached. Switched to local Whisper for transcription.',
            sound: false,
          });

          // Private local logging
          logProviderUsage({
            turnPrompt: '[audio_input]',
            providerUsed: 'local-whisper',
            fallbackOccurred: true,
            reason: 'quota_exceeded',
            errorDetails: errMsg,
          });

          return await this.local.transcribe(audioBuffer);
        }

        // Rethrow non-quota errors (auth/network/401) so they surface properly
        throw err;
      }
    }

    logProviderUsage({
      turnPrompt: '[audio_input]',
      providerUsed: 'local-whisper',
      fallbackOccurred: false,
    });
    return await this.local.transcribe(audioBuffer);
  }
}

/**
 * Creates the STTRouter with primary cloud provider (ElevenLabs/OpenAI/Groq/Cloudflare) and local Whisper fallback.
 */
export function createSTTRouter(): STTProvider {
  const primaryProvider = createPrimarySTTProvider();
  const localProvider = new LocalWhisperSTT();

  if (primaryProvider) {
    console.log(`[STT Router] Initialized Primary provider "${primaryProvider.name}" with local Whisper fallback.`);
    return new STTRouter(primaryProvider, localProvider);
  }

  console.log('[STT Router] No cloud STT key configured. Running 100% local via Whisper.');
  return new STTRouter(null, localProvider);
}
