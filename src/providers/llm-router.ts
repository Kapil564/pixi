import type { IntentResult } from '../shared/types';
import {
  type LLMProvider,
  createPrimaryLLMProvider,
  OllamaLLM,
} from './llm';
import { config } from '../shared/config';
import { withProviderFallback } from './provider-fallback';

export class LLMRouter implements LLMProvider {
  public name = 'llm-router';

  constructor(
    private primary: LLMProvider | null,
    private local: LLMProvider
  ) {}

  async parseIntent(text: string, customSystemPrompt?: string): Promise<IntentResult> {
    return withProviderFallback(
      this.primary,
      this.local,
      (p) => p.parseIntent(text, customSystemPrompt),
      text,
      {
        routerName: 'LLM Router',
        fallbackNotice: 'Automatically failing over to local Ollama model for this turn...',
        localProviderUsed: 'local-ollama',
        title: 'pixi Offline Mode',
        message: 'API rate limit reached. Switched to local model for this turn.',
      },
    );
  }

  async generateCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
    return withProviderFallback(
      this.primary,
      this.local,
      (p) => p.generateCompletion(systemPrompt, userPrompt),
      userPrompt,
      {
        routerName: 'LLM Router',
        fallbackNotice: 'Automatically failing over to local Ollama model for this turn...',
        localProviderUsed: 'local-ollama',
        title: 'pixi Offline Mode',
        message: 'API rate limit reached. Switched to local model for this turn.',
      },
    );
  }
}

/**
 * Creates the LLMRouter with primary provider (if API key exists) and local Ollama fallback provider.
 */
export function createLLMRouter(): LLMProvider {
  const primaryProvider = createPrimaryLLMProvider();
  const localModel = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';
  const localProvider = new OllamaLLM(config.llm.baseUrl, localModel);

  if (primaryProvider && primaryProvider.name !== 'ollama') {
    console.log(`[LLM Router] Initialized Primary provider "${primaryProvider.name}" with local Ollama fallback ("${localModel}").`);
    return new LLMRouter(primaryProvider, localProvider);
  }

  console.log(`[LLM Router] No cloud API key configured. Running 100% local via Ollama ("${localModel}").`);
  return new LLMRouter(null, localProvider);
}