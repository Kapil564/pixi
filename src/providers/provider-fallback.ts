import notifier from 'node-notifier';
import { logProviderUsage } from '../shared/provider-logger';

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

export interface NamedProvider {
  name: string;
}

export interface ProviderFallbackLabels {
  /** Used for console prefixes, e.g. 'LLM Router'. */
  routerName: string;
  /** Console notice when falling back, e.g. 'Automatically failing over to local model...'. */
  fallbackNotice: string;
  /** providerUsed label for logProviderUsage, e.g. 'local-ollama'. */
  localProviderUsed: string;
  title: string;
  message: string;
}

/**
 * Runs the primary provider, falling back to the local provider on rate-limit/quota errors.
 * Non-quota errors are rethrown; the 100%-local path is logged the same way as a fallback.
 */
export async function withProviderFallback<P extends NamedProvider, R>(
  primary: P | null,
  local: P,
  call: (provider: P) => Promise<R>,
  turnPrompt: string,
  labels: ProviderFallbackLabels,
): Promise<R> {
  if (primary) {
    try {
      const result = await call(primary);
      logProviderUsage({
        turnPrompt,
        providerUsed: primary.name,
        fallbackOccurred: false,
      });
      return result;
    } catch (err) {
      if (isRateLimitOrQuotaError(err)) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[${labels.routerName}] Primary provider (${primary.name}) rate limit/quota reached: ${errMsg}`);
        console.warn(`[${labels.routerName}] ${labels.fallbackNotice}`);

        // Light OS notification
        notifier.notify({
          title: labels.title,
          message: labels.message,
          sound: false,
        });

        // Private local logging
        logProviderUsage({
          turnPrompt,
          providerUsed: labels.localProviderUsed,
          fallbackOccurred: true,
          reason: 'quota_exceeded',
          errorDetails: errMsg,
        });

        return await call(local);
      }

      // Rethrow non-quota errors (auth/network/401) so they surface properly
      throw err;
    }
  }

  logProviderUsage({
    turnPrompt,
    providerUsed: labels.localProviderUsed,
    fallbackOccurred: false,
  });
  return await call(local);
}