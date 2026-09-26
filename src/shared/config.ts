import 'dotenv/config';
import { z } from 'zod';

const providerSchema = z.enum(['openai', 'gemini', 'ollama']);
const sttSchema = z.enum(['openai', 'elevenlabs', 'whisper']);
const ttsSchema = z.enum(['piper', 'elevenlabs']);

const openAiKey = process.env.OPENAI_API_KEY || '';
const geminiKey = process.env.GEMINI_API_KEY || '';
const elevenLabsKey = process.env.ELEVENLABS_API_KEY || '';

const defaultStt = elevenLabsKey ? 'elevenlabs' : (openAiKey ? 'openai' : 'whisper');
const defaultLlm = geminiKey ? 'gemini' : (openAiKey ? 'openai' : 'ollama');
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
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
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
    mode?: 'offline' | 'cloud';
    apiKeys?: {
      openai?: string;
      gemini?: string;
      elevenlabs?: string;
    };
  },
  options?: { force?: boolean }
): void {
  if (!settings) return;

  const keys = settings.apiKeys || {};
  const currentSignature = JSON.stringify({
    mode: settings.mode || 'default',
    openai: keys.openai || '',
    gemini: keys.gemini || '',
    elevenlabs: keys.elevenlabs || '',
  });

  if (!options?.force && currentSignature === lastAppliedSignature) {
    return;
  }
  lastAppliedSignature = currentSignature;

  if (keys.openai) {
    config.llm.openAiKey = keys.openai;
    config.stt.openAiKey = keys.openai;
  }
  if (keys.gemini) {
    config.llm.geminiKey = keys.gemini;
  }
  if (keys.elevenlabs) {
    config.tts.elevenLabsKey = keys.elevenlabs;
    config.stt.elevenLabsKey = keys.elevenlabs;
  }

  if (settings.mode === 'cloud') {
    if (config.llm.openAiKey) {
      config.llm.provider = 'openai';
    } else if (config.llm.geminiKey) {
      config.llm.provider = 'gemini';
    }

    if (config.stt.openAiKey) {
      config.stt.provider = 'openai';
    }

    if (config.tts.elevenLabsKey) {
      config.tts.provider = 'elevenlabs';
    }
  } else if (settings.mode === 'offline') {
    config.llm.provider = 'ollama';
    config.stt.provider = 'whisper';
    config.tts.provider = 'piper';
  }

  console.log(`[Config Engine] Applied runtime user settings (mode=${settings.mode || 'default'}, llm=${config.llm.provider}, stt=${config.stt.provider}, tts=${config.tts.provider})`);
}
