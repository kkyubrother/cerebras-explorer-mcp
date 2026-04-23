/**
 * Shared HTTP fetch utility with timeout, retry, and exponential backoff.
 *
 * Used by CerebrasChatClient and OpenAICompatChatClient (and any future
 * provider) to avoid duplicating retry logic across provider implementations.
 */

export const DEFAULT_HTTP_TIMEOUT_MS = 60000;
export const BASE_RETRY_DELAY_MS = 500;
export const MAX_RETRY_DELAY_MS = 32000;

// Cerebras docs: 408, 429, >=500 are retried by default.
// See: https://inference-docs.cerebras.ai/api-reference/error-codes
export const DEFAULT_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Network-level errors that are safe to retry (transient connection failures).
 */
export const RETRYABLE_NETWORK_ERRORS = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT',
  'EPIPE', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

function isRetryableNetworkError(error) {
  if (error.name === 'AbortError') return true; // timeout — safe to retry
  const code = error.code || error.cause?.code || '';
  return RETRYABLE_NETWORK_ERRORS.has(code);
}

/**
 * Compute retry delay with exponential backoff and jitter.
 * Honors Retry-After header when available.
 *
 * @param {number} attempt - Current attempt (0-based)
 * @param {Response} [response] - HTTP response (may contain Retry-After)
 * @returns {number} Delay in milliseconds
 */
function getRetryDelay(attempt, response) {
  // Honor Retry-After header if present
  if (response?.headers) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0 && seconds <= 120) {
        return seconds * 1000;
      }
    }
  }

  // Exponential backoff: 500ms, 1s, 2s, 4s, ... capped at 32s
  const baseDelay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt), MAX_RETRY_DELAY_MS);
  // Add 0-25% jitter to prevent thundering herd
  const jitter = baseDelay * Math.random() * 0.25;
  return Math.round(baseDelay + jitter);
}

/**
 * Fetch with AbortController-based timeout and automatic retry.
 * Retries on: retryable HTTP status codes, network errors, and timeouts.
 * Non-retryable errors (400, 401, 403, 404, etc.) are thrown immediately.
 *
 * @param {Function} fetchImpl - fetch implementation
 * @param {string} url
 * @param {object} init - fetch RequestInit
 * @param {object} [opts]
 * @param {string} [opts.errorPrefix='API']
 * @param {number} [opts.maxRetries=2]
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.externalSignal]
 * @param {Set<number>} [opts.retryableStatuses] - HTTP status codes to retry (default: DEFAULT_RETRYABLE_STATUSES)
 * @param {boolean} [opts.retryNetworkErrors=true] - whether to retry on network-level errors
 */
export async function fetchWithTimeoutAndRetry(fetchImpl, url, init, {
  errorPrefix = 'API',
  maxRetries = 2,
  timeoutMs,
  externalSignal,
  retryableStatuses = DEFAULT_RETRYABLE_STATUSES,
  retryNetworkErrors = true,
} = {}) {
  const effectiveTimeout = timeoutMs ?? Number(process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS ?? DEFAULT_HTTP_TIMEOUT_MS);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Bail immediately if the caller has already cancelled.
    if (externalSignal?.aborted) {
      const err = new Error(`${errorPrefix} request cancelled`);
      err.name = 'AbortError';
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    // Forward external cancellation to the internal controller so the
    // underlying fetch is actually aborted rather than left as a ghost request.
    let externalListener;
    if (externalSignal) {
      externalListener = () => controller.abort();
      externalSignal.addEventListener('abort', externalListener, { once: true });
    }

    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      if (externalListener) externalSignal.removeEventListener('abort', externalListener);
      // External cancellation takes priority — never retry on caller abort.
      if (error.name === 'AbortError' && externalSignal?.aborted) throw error;
      // Network errors and timeouts are retryable
      if (retryNetworkErrors && isRetryableNetworkError(error) && attempt < maxRetries) {
        lastError = new Error(`${errorPrefix} network error: ${error.message}`);
        const delay = getRetryDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (error.name === 'AbortError') {
        // Internal timeout (externalSignal not aborted).
        throw new Error(`${errorPrefix} timed out after ${effectiveTimeout}ms (${attempt + 1} attempt(s))`);
      }
      throw error;
    }
    clearTimeout(timer);
    if (externalListener) externalSignal.removeEventListener('abort', externalListener);

    const responseText = await response.text();
    let parsed;
    try {
      parsed = responseText ? JSON.parse(responseText) : {};
    } catch (err) {
      throw new Error(`Failed to parse ${errorPrefix} response: ${err.message}`);
    }

    if (response.ok) {
      return parsed;
    }

    const errorMessage = parsed?.error?.message || `${response.status} ${response.statusText}`;
    if (!retryableStatuses.has(response.status)) {
      // Non-retryable (400, 401, 403, 404, …)
      throw new Error(`${errorPrefix} error: ${errorMessage}`);
    }

    lastError = new Error(`${errorPrefix} error: ${errorMessage}`);
    if (attempt < maxRetries) {
      const delay = getRetryDelay(attempt, response);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error(`${errorPrefix} request failed after retries`);
}

/**
 * Extract plain text from a chat message content field.
 * Handles both string content and OpenAI-style ContentPart arrays.
 *
 * @param {string|Array|*} content
 * @returns {string}
 */
export function extractMessageText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        if (item.type === 'text' && typeof item.text === 'string') return item.text;
        return '';
      })
      .join('');
  }
  return '';
}
