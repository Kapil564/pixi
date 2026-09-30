import 'dotenv/config';
import { z } from 'zod';

const providerSchema = z.enum(['openai', 'gemini', 'opencode', 'ollama']);
const sttSchema = z.enum(['openai', 'elevenlabs', 'whisper']);
const ttsSchema = z.enum(['piper', 'elevenlabs']);

const openAiKey = process.env.OPENAI_API_KEY || '';
const geminiKey = process.env.GEMINI_API_KEY || '';
const openCodeKey = process.env.OPENCODE_API_KEY || '';
const elevenLabsKey = process.env.ELEVENLABS_API_KEY || '';

const defaultStt = elevenLabsKey ? 'elevenlabs' : (openAiKey ? 'openai' : 'whisper');
const defaultLlm = openCodeKey ? 'opencode' : (geminiKey ? 'gemini' : (openAiKey ? 'openai' : 'ollama'));
const defaultTts = elevenLabsKey ? 'elevenlabs' : 'piper';

export const config = {
  stt: {
    provider: (() => {
      try { return sttSchema.default(defaultStt).parse(process.env.STT_PROVIDER); }
      catch { console.warn(`[Config] Invalid STT_PROVIDER "${process.env.STT_PROVIDER}", falling back to "${defaultStt}"`); return defaultStt; }
    })(),
    openAiKey,
    elevenLabsKey,
    offlineBaseUrl: process.env.OFFLINE_STT_URL || 'http://localhost:8000',
  },
  llm: {
    provider: (() => {
      try { return providerSchema.default(defaultLlm).parse(process.env.LLM_PROVIDER); }
      catch { console.warn(`[Config] Invalid LLM_PROVIDER "${process.env.LLM_PROVIDER}", falling back to "${defaultLlm}"`); return defaultLlm; }
    })(),
    openAiKey,
    geminiKey,
    openCodeKey,
    model: process.env.LLM_MODEL || (openCodeKey ? 'space-bunny-free' : 'gpt-4o-mini'),
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  },
  tts: {
    provider: (() => {
      try { return ttsSchema.default(defaultTts).parse(process.env.TTS_PROVIDER); }
      catch { console.warn(`[Config] Invalid TTS_PROVIDER "${process.env.TTS_PROVIDER}", falling back to "${defaultTts}"`); return defaultTts; }
    })(),
    elevenLabsKey,
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'C8uRRxxNZH0vRqJbVFJy',
  },
  server: {
    port: parseInt(String(process.env.PORT || 16123), 10) || 16123,
  },
};

let lastAppliedSignature = '';

/**
 * Dynamically applies user settings (API keys and cloud/offline mode) to runtime config.
 * Avoids duplicate executions and logs if the settings are unchanged.
 */
export function applyUserSettingsToConfig(
  settings: {
    mode?: 'offline' | 'cloud' | 'custom';
    apiKeys?: {
      openai?: string;
      gemini?: string;
      opencode?: string;
      elevenlabs?: string;
    };
  },
  options?: { force?: boolean }
): void {
  if (!settings) return;

  const keys = settings.apiKeys || {};
  const currentSignature = JSON.stringify({
    mode: settings.mode || 'custom',
    openai: keys.openai || '',
    gemini: keys.gemini || '',
    opencode: keys.opencode || '',
    elevenlabs: keys.elevenlabs || '',
  });

  if (!options?.force && currentSignature === lastAppliedSignature) {
    return;
  }
  lastAppliedSignature = currentSignature;

  // Sync API keys to runtime config
  config.llm.openAiKey = keys.openai || '';
  config.stt.openAiKey = keys.openai || '';
  config.llm.geminiKey = keys.gemini || '';
  config.llm.openCodeKey = keys.opencode || '';
  config.tts.elevenLabsKey = keys.elevenlabs || '';
  config.stt.elevenLabsKey = keys.elevenlabs || '';

  // Determine provider independently for each capability:
  // 1. STT: OpenAI key -> openai, else ElevenLabs key -> elevenlabs, else local Whisper
  if (config.stt.openAiKey) {
    config.stt.provider = 'openai';
  } else if (config.stt.elevenLabsKey) {
    config.stt.provider = 'elevenlabs';
  } else {
    config.stt.provider = 'whisper';
  }

  // 2. LLM: OpenCode key -> opencode, else Gemini key -> gemini, else OpenAI key -> openai, else local Ollama
  if (config.llm.openCodeKey) {
    config.llm.provider = 'opencode';
  } else if (config.llm.geminiKey) {
    config.llm.provider = 'gemini';
  } else if (config.llm.openAiKey) {
    config.llm.provider = 'openai';
  } else {
    config.llm.provider = 'ollama';
  }

  // 3. TTS: ElevenLabs key -> elevenlabs, else local Piper
  if (config.tts.elevenLabsKey) {
    config.tts.provider = 'elevenlabs';
  } else {
    config.tts.provider = 'piper';
  }

  console.log(`[Config Engine] Applied runtime provider configuration: STT=${config.stt.provider}, LLM=${config.llm.provider}, TTS=${config.tts.provider}`);
}
