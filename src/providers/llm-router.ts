import notifier from 'node-notifier';
import type { IntentResult } from '../shared/types';
import {
  type LLMProvider,
  createPrimaryLLMProvider,
  OllamaLLM,
} from './llm';
import { logProviderUsage } from '../shared/provider-logger';
import { config } from '../shared/config';

/**
 * Checks if an error is specifically a rate limit, quota exceeded, or resource exhaustion error.
 * Excludes authentication (401), invalid request (400), or connection refused errors.
 */
export function isRateLimitOrQuotaError(err: unknown): boolean {
  if (!err) return false;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();

  const quotaKeywords = [
    '429',
    'rate_limit',
    'ratelimit',
    'rate limit',
    'quota',
    'exceeded_quota',
    'insufficient_quota',
    'resource_exhausted',
    'too many requests',
    'tokens per minute',
    'requests per minute',
  ];

  return quotaKeywords.some((kw) => message.includes(kw));
}

export class LLMRouter implements LLMProvider {
  public name = 'llm-router';

  constructor(
    private primary: LLMProvider | null,
    private local: LLMProvider
  ) {}

  async parseIntent(text: string, customSystemPrompt?: string): Promise<IntentResult> {
    if (this.primary) {
      try {
        const result = await this.primary.parseIntent(text, customSystemPrompt);
        logProviderUsage({
          turnPrompt: text,
          providerUsed: this.primary.name,
          fallbackOccurred: false,
        });
        return result;
      } catch (err) {
        if (isRateLimitOrQuotaError(err)) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[LLM Router] Primary provider (${this.primary.name}) rate limit/quota reached: ${errMsg}`);
          console.warn('[LLM Router] Automatically failing over to local Ollama model for this turn...');

          // Light notification to user
          notifier.notify({
            title: 'pixi Offline Mode',
            message: 'API rate limit reached. Switched to local model for this turn.',
            sound: false,
          });

          // Private local logging
          logProviderUsage({
            turnPrompt: text,
            providerUsed: 'local-ollama',
            fallbackOccurred: true,
            reason: 'quota_exceeded',
            errorDetails: errMsg,
          });

          return await this.local.parseIntent(text, customSystemPrompt);
        }

        // Rethrow non-quota errors (e.g. auth failures, 401, invalid JSON) so they are surfaced properly
        throw err;
      }
    }

    // No primary provider configured -> run fully local from start
    logProviderUsage({
      turnPrompt: text,
      providerUsed: 'local-ollama',
      fallbackOccurred: false,
    });
    return await this.local.parseIntent(text, customSystemPrompt);
  }

  async generateCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
    if (this.primary) {
      try {
        const result = await this.primary.generateCompletion(systemPrompt, userPrompt);
        logProviderUsage({
          turnPrompt: userPrompt,
          providerUsed: this.primary.name,
          fallbackOccurred: false,
        });
        return result;
      } catch (err) {
        if (isRateLimitOrQuotaError(err)) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[LLM Router] Primary provider (${this.primary.name}) completion quota reached: ${errMsg}`);
          console.warn('[LLM Router] Automatically failing over to local Ollama model...');

          logProviderUsage({
            turnPrompt: userPrompt,
            providerUsed: 'local-ollama',
            fallbackOccurred: true,
            reason: 'quota_exceeded',
            errorDetails: errMsg,
          });

          return await this.local.generateCompletion(systemPrompt, userPrompt);
        }

        throw err;
      }
    }

    logProviderUsage({
      turnPrompt: userPrompt,
      providerUsed: 'local-ollama',
      fallbackOccurred: false,
    });
    return await this.local.generateCompletion(systemPrompt, userPrompt);
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
