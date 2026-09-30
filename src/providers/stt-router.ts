import type { TranscriptionResult } from '../shared/types';
import {
  type STTProvider,
  createPrimarySTTProvider,
  LocalWhisperSTT,
} from './stt';

export class STTRouter implements STTProvider {
  public name = 'stt-router';
  private local: STTProvider;

  constructor(local: STTProvider = new LocalWhisperSTT()) {
    this.local = local;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    const primary = createPrimarySTTProvider();
    if (primary) {
      try {
        return await primary.transcribe(audioBuffer);
      } catch (err) {
        console.warn(`[STT Router] Primary (${primary.name}) failed, falling back to local Whisper:`, err);
      }
    }
    return this.local.transcribe(audioBuffer);
  }
}

/**
 * Creates the STTRouter with dynamic primary cloud provider (ElevenLabs/OpenAI) and local Whisper fallback.
 */
export function createSTTRouter(): STTProvider {
  return new STTRouter();
}