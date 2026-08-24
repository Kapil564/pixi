import 'dotenv/config';
import { z } from 'zod';

const providerSchema = z.enum(['openai', 'gemini', 'groq', 'ollama', 'cloudflare']);
const sttSchema = z.enum(['openai', 'groq', 'cloudflare', 'elevenlabs', 'whisper']);
const ttsSchema = z.enum(['piper', 'fishaudio', 'elevenlabs', 'azure', 'cloudflare']);

const openAiKey = process.env.OPENAI_API_KEY || '';
const groqKey = process.env.GROQ_API_KEY || '';
const geminiKey = process.env.GEMINI_API_KEY || '';
const fishAudioKey = process.env.FISH_AUDIO_API_KEY || process.env.FISH_AUDIO_KEY || '';
const elevenLabsKey = process.env.ELEVENLABS_API_KEY || '';
const azureKey = process.env.AZURE_SPEECH_KEY || '';

const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN || '';
const cloudflareGatewayId = process.env.CLOUDFLARE_GATEWAY_ID || '';

const defaultStt = (cloudflareAccountId && cloudflareApiToken)
  ? 'cloudflare'
  : (elevenLabsKey ? 'elevenlabs' : (groqKey ? 'groq' : (openAiKey ? 'openai' : 'whisper')));
const defaultLlm = (cloudflareAccountId && cloudflareApiToken)
  ? 'cloudflare'
  : (geminiKey ? 'gemini' : (groqKey ? 'groq' : (openAiKey ? 'openai' : 'ollama')));
const defaultTts = fishAudioKey
  ? 'fishaudio'
  : (elevenLabsKey ? 'elevenlabs' : ((cloudflareAccountId && cloudflareApiToken) ? 'cloudflare' : (azureKey ? 'azure' : 'piper')));

export const config = {
  cloudflare: {
    accountId: cloudflareAccountId,
    apiToken: cloudflareApiToken,
    gatewayId: cloudflareGatewayId,
    sttModel: process.env.CLOUDFLARE_STT_MODEL || '@cf/openai/whisper',
    llmModel: process.env.CLOUDFLARE_LLM_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    ttsModel: process.env.CLOUDFLARE_TTS_MODEL || (cloudflareGatewayId ? 'elevenlabs/eleven-multilingual-v2' : '@cf/myshell/melotts-english'),
  },
  stt: {
    provider: sttSchema.default(defaultStt).parse(process.env.STT_PROVIDER),
    openAiKey,
    groqKey,
    cloudflareApiToken,
    elevenLabsKey,
    offlineBaseUrl: process.env.OFFLINE_STT_URL || 'http://localhost:8000',
  },
  llm: {
    provider: providerSchema.default(defaultLlm).parse(process.env.LLM_PROVIDER),
    openAiKey,
    geminiKey,
    groqKey,
    cloudflareApiToken,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  },
  tts: {
    provider: ttsSchema.default(defaultTts).parse(process.env.TTS_PROVIDER),
    fishAudioKey,
    elevenLabsKey,
    azureKey,
    cloudflareApiToken,
    referenceId: process.env.FISH_AUDIO_REFERENCE_ID || process.env.FISH_AUDIO_VOICE_ID || '933563129e564b19a115bedd57b7406a',
    model: process.env.FISH_AUDIO_MODEL || 's2.1-pro-free',
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'C8uRRxxNZH0vRqJbVFJy',
    region: process.env.AZURE_SPEECH_REGION || '',
  },
  server: {
    port: Number(process.env.PORT || 16123),
  },
};

/**
 * Dynamically applies user settings (API keys and cloud/offline mode) to runtime config.
 */
export function applyUserSettingsToConfig(settings: {
  mode?: 'offline' | 'cloud';
  apiKeys?: {
    openai?: string;
    gemini?: string;
    groq?: string;
    fishaudio?: string;
    elevenlabs?: string;
  };
}): void {
  if (!settings) return;

  const keys = settings.apiKeys || {};

  if (keys.openai) {
    config.llm.openAiKey = keys.openai;
    config.stt.openAiKey = keys.openai;
  }
  if (keys.gemini) {
    config.llm.geminiKey = keys.gemini;
  }
  if (keys.groq) {
    config.llm.groqKey = keys.groq;
    config.stt.groqKey = keys.groq;
  }
  if (keys.fishaudio) {
    config.tts.fishAudioKey = keys.fishaudio;
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
    } else if (config.llm.groqKey) {
      config.llm.provider = 'groq';
    }

    if (config.stt.openAiKey) {
      config.stt.provider = 'openai';
    } else if (config.stt.groqKey) {
      config.stt.provider = 'groq';
    }

    if (config.tts.fishAudioKey) {
      config.tts.provider = 'fishaudio';
    } else if (config.tts.elevenLabsKey) {
      config.tts.provider = 'elevenlabs';
    }
  } else if (settings.mode === 'offline') {
    config.llm.provider = 'ollama';
    config.stt.provider = 'whisper';
    config.tts.provider = 'piper';
  }

  console.log(`[Config Engine] Applied runtime user settings (mode=${settings.mode || 'default'}, llm=${config.llm.provider}, stt=${config.stt.provider}, tts=${config.tts.provider})`);
}
