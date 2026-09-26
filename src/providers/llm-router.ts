import type { IntentResult } from '../shared/types';
import {
  type LLMProvider,
  createPrimaryLLMProvider,
  OllamaLLM,
} from './llm';
import { config } from '../shared/config';
export class LLMRouter implements LLMProvider {
  public name = 'llm-router';

  constructor(
    private primary: LLMProvider | null,
    private local: LLMProvider
  ) {}

  async parseIntent(text: string, customSystemPrompt?: string): Promise<IntentResult> {
    if (this.primary) {
      try {
        return await this.primary.parseIntent(text, customSystemPrompt);
      } catch (err) {
        console.warn(`[LLM Router] Primary (${this.primary.name}) failed parseIntent, falling back to local Ollama:`, err);
      }
    }
    return this.local.parseIntent(text, customSystemPrompt);
  }

  async generateCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
    if (this.primary) {
      try {
        return await this.primary.generateCompletion(systemPrompt, userPrompt);
      } catch (err) {
        console.warn(`[LLM Router] Primary (${this.primary.name}) failed generateCompletion, falling back to local Ollama:`, err);
      }
    }
    return this.local.generateCompletion(systemPrompt, userPrompt);
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