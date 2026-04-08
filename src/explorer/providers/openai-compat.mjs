import { AbstractChatClient } from './abstract.mjs';

/**
 * OpenAI-compatible chat client.
 *
 * Works with any provider that exposes the standard OpenAI
 * `/v1/chat/completions` endpoint — Groq, Together, Fireworks, etc.
 *
 * Cerebras-specific fields (reasoning_effort, clear_thinking) are NOT sent.
 *
 * Environment variables (when using createChatClient()):
 *   EXPLORER_OPENAI_API_KEY   — required
 *   EXPLORER_OPENAI_BASE_URL  — default: https://api.openai.com/v1
 *   EXPLORER_OPENAI_MODEL     — default: gpt-4o-mini
 */
export class OpenAICompatChatClient extends AbstractChatClient {
  constructor({
    apiKey = process.env.EXPLORER_OPENAI_API_KEY,
    baseUrl = process.env.EXPLORER_OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model = process.env.EXPLORER_OPENAI_MODEL || 'gpt-4o-mini',
    fetchImpl = globalThis.fetch,
    logger = () => {},
  } = {}) {
    super();
    this._apiKey = apiKey;
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._model = model;
    this._fetchImpl = fetchImpl;
    this._logger = logger;
  }

  get model() {
    return this._model;
  }

  _ensureConfigured() {
    if (!this._apiKey) {
      throw new Error('EXPLORER_OPENAI_API_KEY is required for openai-compat provider.');
    }
    if (!this._fetchImpl) {
      throw new Error('Global fetch is unavailable. Use Node 18+ or provide fetchImpl.');
    }
  }

  _extractMessageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map(item => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
        .join('');
    }
    return '';
  }

  async createChatCompletion({
    messages,
    tools,
    responseFormat,
    temperature = 0.1,
    maxCompletionTokens = 4000,
    parallelToolCalls = true,
    // reasoningEffort is intentionally ignored — not supported by standard OpenAI API
  }) {
    this._ensureConfigured();

    const payload = {
      model: this._model,
      messages,
      temperature,
      max_completion_tokens: maxCompletionTokens,
      parallel_tool_calls: parallelToolCalls,
      stream: false,
    };

    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }
    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    const response = await this._fetchImpl(`${this._baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let parsed;
    try {
      parsed = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      throw new Error(`Failed to parse provider response: ${error.message}`);
    }

    if (!response.ok) {
      const errorMessage = parsed?.error?.message || `${response.status} ${response.statusText}`;
      throw new Error(`Provider API error: ${errorMessage}`);
    }

    const choice = parsed?.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new Error('Provider API response did not include a message.');
    }

    return {
      id: parsed.id ?? null,
      usage: parsed.usage ?? null,
      finishReason: choice.finish_reason ?? null,
      message: {
        role: message.role || 'assistant',
        content: this._extractMessageText(message.content),
        rawContent: message.content,
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
