import { AbstractChatClient } from './abstract.mjs';
import { fetchWithTimeoutAndRetry, extractMessageText } from '../utils/http-client.mjs';

function stripUnsupportedMessageFields(messages) {
  if (!Array.isArray(messages)) {
    return messages;
  }

  return messages.map(message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return message;
    }

    const normalized = { ...message };
    delete normalized.reasoning;
    return normalized;
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function acceptsNull(schema) {
  if (!isPlainObject(schema)) return false;
  if (schema.type === 'null') return true;
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  if (Array.isArray(schema.anyOf) && schema.anyOf.some(acceptsNull)) return true;
  return false;
}

function makeNullable(schema) {
  if (!isPlainObject(schema) || acceptsNull(schema)) {
    return schema;
  }

  if (schema.type !== undefined) {
    const next = { ...schema };
    next.type = Array.isArray(schema.type)
      ? [...new Set([...schema.type, 'null'])]
      : [schema.type, 'null'];
    if (Array.isArray(schema.enum) && !schema.enum.includes(null)) {
      next.enum = [...schema.enum, null];
    }
    return next;
  }

  return {
    anyOf: [schema, { type: 'null' }],
  };
}

function convertSchemaForOpenAIStrict(schema, { nullable = false } = {}) {
  if (Array.isArray(schema)) {
    return schema.map(item => convertSchemaForOpenAIStrict(item));
  }
  if (!isPlainObject(schema)) {
    return schema;
  }

  const next = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' || key === 'required' || key === 'items' || key === 'prefixItems' || key === '$defs' || key === 'definitions' || key === 'anyOf') {
      continue;
    }
    next[key] = convertSchemaForOpenAIStrict(value);
  }

  if (isPlainObject(schema.$defs)) {
    next.$defs = Object.fromEntries(
      Object.entries(schema.$defs).map(([key, value]) => [key, convertSchemaForOpenAIStrict(value)]),
    );
  }
  if (isPlainObject(schema.definitions)) {
    next.definitions = Object.fromEntries(
      Object.entries(schema.definitions).map(([key, value]) => [key, convertSchemaForOpenAIStrict(value)]),
    );
  }
  if (Array.isArray(schema.anyOf)) {
    next.anyOf = schema.anyOf.map(item => convertSchemaForOpenAIStrict(item));
  }
  if (isPlainObject(schema.items) || Array.isArray(schema.items)) {
    next.items = convertSchemaForOpenAIStrict(schema.items);
  }
  if (Array.isArray(schema.prefixItems)) {
    next.prefixItems = schema.prefixItems.map(item => convertSchemaForOpenAIStrict(item));
  }

  if (isPlainObject(schema.properties)) {
    const originallyRequired = new Set(Array.isArray(schema.required) ? schema.required : []);
    next.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        convertSchemaForOpenAIStrict(value, { nullable: !originallyRequired.has(key) }),
      ]),
    );
    next.required = Object.keys(schema.properties);
    next.additionalProperties = false;
  }

  return nullable ? makeNullable(next) : next;
}

export function makeOpenAIStrictCompatibleResponseFormat(responseFormat) {
  if (
    !isPlainObject(responseFormat) ||
    responseFormat.type !== 'json_schema' ||
    !isPlainObject(responseFormat.json_schema) ||
    !isPlainObject(responseFormat.json_schema.schema) ||
    responseFormat.json_schema.strict !== true
  ) {
    return responseFormat;
  }

  return {
    ...responseFormat,
    json_schema: {
      ...responseFormat.json_schema,
      schema: convertSchemaForOpenAIStrict(responseFormat.json_schema.schema),
    },
  };
}

/**
 * OpenAI-compatible chat client.
 *
 * Works with any provider that exposes the standard OpenAI
 * `/v1/chat/completions` endpoint — Groq, Together, Fireworks, etc.
 *
 * Cerebras-specific fields (reasoning_effort, clear_thinking) are NOT sent.
 * Assistant-message `reasoning` fields are stripped because they are not part
 * of the standard OpenAI-compatible request schema.
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

  async createChatCompletion({
    messages,
    tools,
    responseFormat,
    temperature = 1,
    topP = 0.95,
    maxCompletionTokens = 4000,
    parallelToolCalls = true,
    signal,
    // reasoningEffort is intentionally ignored — not supported by standard OpenAI API
  }) {
    this._ensureConfigured();

    const payload = {
      model: this._model,
      messages: stripUnsupportedMessageFields(messages),
      temperature,
      max_completion_tokens: maxCompletionTokens,
      parallel_tool_calls: parallelToolCalls,
      stream: false,
    };

    if (typeof topP === 'number') {
      payload.top_p = topP;
    }
    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }
    if (responseFormat) {
      payload.response_format = makeOpenAIStrictCompatibleResponseFormat(responseFormat);
    }

    const parsed = await fetchWithTimeoutAndRetry(this._fetchImpl, `${this._baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(payload),
    }, { errorPrefix: 'Provider API', externalSignal: signal });

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
