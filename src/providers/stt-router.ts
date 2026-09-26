import type { TranscriptionResult } from '../shared/types';
import {
  type STTProvider,
  createPrimarySTTProvider,
  LocalWhisperSTT,
} from './stt';
import { withProviderFallback } from './provider-fallback';

export class STTRouter implements STTProvider {
  public name = 'stt-router';

  constructor(
    private primary: STTProvider | null,
    private local: STTProvider
  ) {}

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    return withProviderFallback(
      this.primary,
      this.local,
      (p) => p.transcribe(audioBuffer),
      '[audio_input]',
      {
        routerName: 'STT Router',
        fallbackNotice: 'Automatically failing over to local Whisper model...',
        localProviderUsed: 'local-whisper',
        title: 'pixi Offline STT',
        message: 'API rate limit reached. Switched to local Whisper for transcription.',
      },
    );
  }
}

/**
 * Creates the STTRouter with primary cloud provider (ElevenLabs/OpenAI) and local Whisper fallback.
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