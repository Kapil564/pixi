import type { TranscriptionResult } from '../shared/types';
import {
  type STTProvider,
  createPrimarySTTProvider,
  LocalWhisperSTT,
} from './stt';
export class STTRouter implements STTProvider {
  public name = 'stt-router';

  constructor(
    private primary: STTProvider | null,
    private local: STTProvider
  ) {}

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (this.primary) {
      try {
        return await this.primary.transcribe(audioBuffer);
      } catch (err) {
        console.warn(`[STT Router] Primary (${this.primary.name}) failed, falling back to local Whisper:`, err);
      }
    }
    return this.local.transcribe(audioBuffer);
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