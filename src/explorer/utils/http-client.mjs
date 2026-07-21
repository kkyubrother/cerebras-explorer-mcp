/**
 * Shared HTTP fetch utility with timeout, retry, and exponential backoff.
 *
 * Used by CerebrasChatClient and OpenAICompatChatClient (and any future
 * provider) to avoid duplicating retry logic across provider implementations.
 */

export const DEFAULT_HTTP_TIMEOUT_MS = 60000;
export const BASE_RETRY_DELAY_MS = 500;
export const MAX_RETRY_DELAY_MS = 32000;
const RATE_LIMIT_RETRY_DELAY_MS = 15000;
const MAX_RETRY_AFTER_SECONDS = 120;

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

function providerErrorCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value)
    ? value
    : null;
}

function annotateProviderFailure(error, {
  httpStatus = null,
  retryable = false,
  attemptCount = 1,
  code = null,
  retryAfterSeconds = null,
} = {}) {
  if (!error || typeof error !== 'object') return error;
  error.httpStatus = Number.isInteger(httpStatus) ? httpStatus : null;
  error.retryable = retryable === true;
  error.attemptCount = Number.isInteger(attemptCount) && attemptCount > 0 ? attemptCount : 1;
  const safeCode = providerErrorCode(code);
  if (safeCode) error.providerCode = safeCode;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    error.retryAfterSeconds = Math.ceil(retryAfterSeconds);
  }
  return error;
}

function getRetryAfterSeconds(response) {
  if (!response?.headers) return null;
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;

  const retryAt = Date.parse(retryAfter);
  if (!Number.isFinite(retryAt)) return null;
  const remainingSeconds = (retryAt - Date.now()) / 1000;
  return remainingSeconds > 0 ? remainingSeconds : null;
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
  const retryAfterSeconds = getRetryAfterSeconds(response);
  if (retryAfterSeconds !== null && retryAfterSeconds <= MAX_RETRY_AFTER_SECONDS) {
    return retryAfterSeconds * 1000;
  }

  if (response?.status === 429) {
    return Math.min(RATE_LIMIT_RETRY_DELAY_MS * Math.pow(2, attempt), MAX_RETRY_DELAY_MS);
  }

  // Exponential backoff: 500ms, 1s, 2s, 4s, ... capped at 32s
  const baseDelay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt), MAX_RETRY_DELAY_MS);
  // Add 0-25% jitter to prevent thundering herd
  const jitter = baseDelay * Math.random() * 0.25;
  return Math.round(baseDelay + jitter);
}

function waitForRetryDelay(delay, externalSignal, errorPrefix) {
  if (externalSignal?.aborted) {
    const error = new Error(`${errorPrefix} request cancelled`);
    error.name = 'AbortError';
    return Promise.reject(error);
  }
  if (!externalSignal) return new Promise(resolve => setTimeout(resolve, delay));
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      externalSignal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timeoutId);
      const error = new Error(`${errorPrefix} request cancelled`);
      error.name = 'AbortError';
      reject(error);
    };
    externalSignal.addEventListener('abort', onAbort, { once: true });
  });
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
    let timedOut = false;
    let timeoutId;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        const error = new Error(`${errorPrefix} timed out after ${effectiveTimeout}ms (${attempt + 1} attempt(s))`);
        error.name = 'AbortError';
        reject(error);
      }, effectiveTimeout);
    });

    // Forward external cancellation to the internal controller so the
    // underlying fetch is actually aborted rather than left as a ghost request.
    let externalListener;
    let externalAbortPromise;
    if (externalSignal) {
      externalAbortPromise = new Promise((_resolve, reject) => {
        externalListener = () => {
          controller.abort();
          const error = new Error(`${errorPrefix} request cancelled`);
          error.name = 'AbortError';
          reject(error);
        };
        externalSignal.addEventListener('abort', externalListener, { once: true });
      });
    }

    let response;
    let responseText;
    try {
      const fetchAndReadBody = (async () => {
        const fetched = await fetchImpl(url, { ...init, signal: controller.signal });
        return { response: fetched, responseText: await fetched.text() };
      })();
      const raced = externalAbortPromise
        ? await Promise.race([fetchAndReadBody, timeoutPromise, externalAbortPromise])
        : await Promise.race([fetchAndReadBody, timeoutPromise]);
      response = raced.response;
      responseText = raced.responseText;
    } catch (error) {
      // External cancellation takes priority — never retry on caller abort.
      if (error.name === 'AbortError' && externalSignal?.aborted) throw error;
      // Network errors and timeouts are retryable
      if (retryNetworkErrors && (timedOut || isRetryableNetworkError(error)) && attempt < maxRetries) {
        lastError = annotateProviderFailure(
          new Error(`${errorPrefix} network error: ${error.message}`),
          { retryable: true, attemptCount: attempt + 1 },
        );
        const delay = getRetryDelay(attempt);
        await waitForRetryDelay(delay, externalSignal, errorPrefix);
        continue;
      }
      if (error.name === 'AbortError' || timedOut) {
        // Internal timeout (externalSignal not aborted).
        throw annotateProviderFailure(
          new Error(`${errorPrefix} timed out after ${effectiveTimeout}ms (${attempt + 1} attempt(s))`),
          { retryable: true, attemptCount: attempt + 1 },
        );
      }
      throw annotateProviderFailure(error, {
        retryable: retryNetworkErrors && isRetryableNetworkError(error),
        attemptCount: attempt + 1,
      });
    } finally {
      clearTimeout(timeoutId);
      if (externalListener) externalSignal.removeEventListener('abort', externalListener);
    }
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
    const errorCode = parsed?.error?.code;
    if (!retryableStatuses.has(response.status)) {
      // Non-retryable (400, 401, 403, 404, …)
      throw annotateProviderFailure(new Error(`${errorPrefix} error: ${errorMessage}`), {
        httpStatus: response.status,
        retryable: false,
        attemptCount: attempt + 1,
        code: errorCode,
      });
    }

    lastError = annotateProviderFailure(new Error(`${errorPrefix} error: ${errorMessage}`), {
      httpStatus: response.status,
      retryable: true,
      attemptCount: attempt + 1,
      code: errorCode,
      retryAfterSeconds: getRetryAfterSeconds(response),
    });
    if (attempt < maxRetries) {
      if (lastError.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) break;
      const delay = getRetryDelay(attempt, response);
      await waitForRetryDelay(delay, externalSignal, errorPrefix);
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
