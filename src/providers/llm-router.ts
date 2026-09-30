import type { IntentResult } from '../shared/types';
import {
  type LLMProvider,
  createPrimaryLLMProvider,
  OllamaLLM,
} from './llm';
import { config } from '../shared/config';

export class LLMRouter implements LLMProvider {
  public name = 'llm-router';
  private local: LLMProvider;

  constructor(local?: LLMProvider) {
    const localModel = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';
    this.local = local || new OllamaLLM(config.llm.baseUrl, localModel);
  }

  async parseIntent(text: string, customSystemPrompt?: string): Promise<IntentResult> {
    const primary = createPrimaryLLMProvider();
    if (primary) {
      try {
        return await primary.parseIntent(text, customSystemPrompt);
      } catch (err) {
        console.warn(`[LLM Router] Primary (${primary.name}) failed parseIntent, falling back to local Ollama:`, err);
      }
    }
    return this.local.parseIntent(text, customSystemPrompt);
  }

  async generateCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
    const primary = createPrimaryLLMProvider();
    if (primary) {
      try {
        return await primary.generateCompletion(systemPrompt, userPrompt);
      } catch (err) {
        console.warn(`[LLM Router] Primary (${primary.name}) failed generateCompletion, falling back to local Ollama:`, err);
      }
    }
    return this.local.generateCompletion(systemPrompt, userPrompt);
  }
}

/**
 * Creates the LLMRouter with dynamic primary provider (if API key exists) and local Ollama fallback provider.
 */
export function createLLMRouter(): LLMProvider {
  return new LLMRouter();
}