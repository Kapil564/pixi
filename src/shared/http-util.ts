export async function isLocalServerReachable(url: string, timeout = 800): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Executes an async task (such as a download or API operation) with automatic exponential backoff retries.
 */
export async function executeWithExponentialBackoff<T>(
  taskFn: (attempt: number) => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 1500,
  onRetry?: (attempt: number, delayMs: number, err: any) => void
): Promise<T> {
  let attempt = 0;
  let lastError: any = null;

  while (attempt < maxRetries) {
    try {
      attempt++;
      return await taskFn(attempt);
    } catch (err) {
      lastError = err;
      console.warn(`[Retry Engine] Attempt ${attempt}/${maxRetries} failed:`, err instanceof Error ? err.message : err);

      if (attempt < maxRetries) {
        const delayMs = Math.round(initialDelayMs * Math.pow(2, attempt - 1));
        if (onRetry) {
          onRetry(attempt, delayMs, err);
        }
        console.log(`[Retry Engine] Retrying in ${delayMs}ms (Attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastError || new Error(`Operation failed after ${maxRetries} attempts.`);
}

/**
 * Fetches a URL with exponential backoff retries for handling transient network issues.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
  delayMs = 1500
): Promise<Response> {
  return executeWithExponentialBackoff(
    async () => {
      const res = await fetch(url, options);
      if (res.ok) {
        return res;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    },
    maxRetries,
    delayMs,
    (attempt, delay) => {
      console.warn(`[HTTP Retry] Download for ${url} failed. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`);
    }
  );
}
