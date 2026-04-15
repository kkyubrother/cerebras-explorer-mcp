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
import { fetchWithTimeoutAndRetry, extractMessageText } from './utils/http-client.mjs';

/** Threshold in bytes above which request payloads are gzip-compressed.
 *  Cerebras docs: gzip compression reduces 50K-token payloads by up to ~98%.
 *  At Cerebras speeds, compression CPU time can exceed network savings for small
 *  payloads (see "Designing for Cerebras" — infrastructure overhead matters more
 *  when inference is fast). Set conservatively high so compression only kicks in
 *  when the payload is large enough to clearly benefit. */
const GZIP_THRESHOLD_BYTES = 32_768;

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
    signal,
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
    }, { errorPrefix: 'Cerebras API', externalSignal: signal });

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
