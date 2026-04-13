import { gzipSync } from 'node:zlib';
import {
  getExplorerClearThinking,
  getExplorerModel,
  getExplorerReasoningFormat,
  getExplorerTemperature,
  getExplorerTopP,
  isGlm47Model,
  isGptOssModel,
} from './config.mjs';

/** Threshold in bytes above which request payloads are gzip-compressed.
 *  Cerebras docs: gzip compression reduces 50K-token payloads by up to ~98%.
 *  Below this threshold, compression overhead outweighs the savings. */
const GZIP_THRESHOLD_BYTES = 4096;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_HTTP_TIMEOUT_MS = 60000;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 32000;

/**
 * Network-level errors that are safe to retry (transient connection failures).
 */
const RETRYABLE_NETWORK_ERRORS = new Set([
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
 * Retries on: 429/5xx HTTP errors, network errors (ECONNRESET, etc.), and timeouts.
 * Non-retryable errors (400, 401, 403, 404, etc.) are thrown immediately.
 */
async function fetchWithTimeoutAndRetry(fetchImpl, url, init, { errorPrefix = 'API', maxRetries = 2, timeoutMs } = {}) {
  const effectiveTimeout = timeoutMs ?? Number(process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS ?? DEFAULT_HTTP_TIMEOUT_MS);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      // Network errors and timeouts are retryable
      if (isRetryableNetworkError(error) && attempt < maxRetries) {
        lastError = new Error(`${errorPrefix} network error: ${error.message}`);
        const delay = getRetryDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (error.name === 'AbortError') {
        throw new Error(`${errorPrefix} timed out after ${effectiveTimeout}ms (${attempt + 1} attempt(s))`);
      }
      throw error;
    }
    clearTimeout(timer);

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
    if (!RETRYABLE_STATUSES.has(response.status)) {
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

function extractMessageText(content) {
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

function supportsReasoningOptions(model) {
  return isGlm47Model(model) || isGptOssModel(model);
}

export function extractFirstJsonObject(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue to scan for first balanced object
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let start = -1;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = input.slice(start, index + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          start = -1;
        }
      }
    }
  }

  return null;
}

export class CerebrasChatClient {
  constructor({
    apiKey = process.env.CEREBRAS_API_KEY,
    apiBaseUrl = process.env.CEREBRAS_API_BASE_URL || 'https://api.cerebras.ai/v1',
    model = getExplorerModel(),
    clearThinking = getExplorerClearThinking(model),
    reasoningFormat = getExplorerReasoningFormat(model),
    temperature = getExplorerTemperature(),
    topP = getExplorerTopP(),
    fetchImpl = globalThis.fetch,
    logger = () => {},
  } = {}) {
    this.apiKey = apiKey;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.model = model;
    this.clearThinking = clearThinking;
    this.reasoningFormat = reasoningFormat;
    this.defaultTemperature = temperature;
    this.defaultTopP = topP;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  ensureConfigured() {
    if (!this.apiKey) {
      throw new Error('CEREBRAS_API_KEY is required.');
    }
    if (!this.fetchImpl) {
      throw new Error('Global fetch is unavailable. Use Node 18+ or provide fetchImpl.');
    }
  }

  async createChatCompletion({
    messages,
    tools,
    responseFormat,
    reasoningEffort,
    reasoningFormat = this.reasoningFormat,
    clearThinking = this.clearThinking,
    temperature = this.defaultTemperature,
    topP = this.defaultTopP,
    maxCompletionTokens = 4000,
    parallelToolCalls = true,
  }) {
    this.ensureConfigured();

    const payload = {
      model: this.model,
      messages,
      max_completion_tokens: maxCompletionTokens,
      parallel_tool_calls: parallelToolCalls,
      stream: false,
    };

    if (typeof temperature === 'number') {
      payload.temperature = temperature;
    }
    if (typeof topP === 'number') {
      payload.top_p = topP;
    }
    if (supportsReasoningOptions(this.model) && reasoningEffort !== undefined && reasoningEffort !== null && reasoningEffort !== '') {
      payload.reasoning_effort = reasoningEffort;
    }
    if (supportsReasoningOptions(this.model) && reasoningFormat) {
      payload.reasoning_format = reasoningFormat;
    }
    if (isGlm47Model(this.model) && typeof clearThinking === 'boolean') {
      payload.clear_thinking = clearThinking;
    }

    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }
    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    // Compress payload with gzip when it exceeds threshold (saves up to ~98% on large payloads)
    const jsonBody = JSON.stringify(payload);
    const jsonBytes = Buffer.from(jsonBody, 'utf-8');
    const useGzip = jsonBytes.length >= GZIP_THRESHOLD_BYTES;
    const requestBody = useGzip ? gzipSync(jsonBytes, { level: 5 }) : jsonBody;
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
    if (useGzip) {
      headers['content-encoding'] = 'gzip';
    }

    const parsed = await fetchWithTimeoutAndRetry(this.fetchImpl, `${this.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: requestBody,
    }, { errorPrefix: 'Cerebras API' });

    const choice = parsed?.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new Error('Cerebras API response did not include a message.');
    }

    return {
      id: parsed.id,
      usage: parsed.usage ?? null,
      finishReason: choice.finish_reason ?? null,
      message: {
        role: message.role || 'assistant',
        content: extractMessageText(message.content),
        rawContent: message.content,
        reasoning: typeof message.reasoning === 'string' ? message.reasoning : '',
        rawReasoning: message.reasoning ?? null,
        toolCalls: Array.isArray(message.tool_calls)
          ? message.tool_calls.map(call => ({
              id: call.id,
              type: call.type,
              function: {
                name: call.function?.name,
                arguments: call.function?.arguments,
              },
            }))
          : [],
      },
    };
  }
}
