import {
  getExplorerClearThinking,
  getExplorerModel,
  getExplorerReasoningFormat,
  getExplorerTemperature,
  getExplorerTopP,
  isGlm47Model,
  isGptOssModel,
} from './config.mjs';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_HTTP_TIMEOUT_MS = 60000;

/**
 * Fetch with AbortController-based timeout and automatic retry for 429/5xx.
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
      if (error.name === 'AbortError') {
        throw new Error(`${errorPrefix} timed out after ${effectiveTimeout}ms`);
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
      const retryDelayMs = response.status === 429 ? 2000 : 1000;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
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

    const parsed = await fetchWithTimeoutAndRetry(this.fetchImpl, `${this.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
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
