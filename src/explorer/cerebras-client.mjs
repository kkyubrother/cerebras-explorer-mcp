import { getExplorerModel } from './config.mjs';

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
    fetchImpl = globalThis.fetch,
    logger = () => {},
  } = {}) {
    this.apiKey = apiKey;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.model = model;
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
    temperature = 0.1,
    maxCompletionTokens = 4000,
    parallelToolCalls = true,
  }) {
    this.ensureConfigured();

    const payload = {
      model: this.model,
      messages,
      temperature,
      max_completion_tokens: maxCompletionTokens,
      reasoning_effort: reasoningEffort,
      parallel_tool_calls: parallelToolCalls,
      stream: false,
    };

    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }
    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    const response = await this.fetchImpl(`${this.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let parsed;
    try {
      parsed = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      throw new Error(`Failed to parse Cerebras response: ${error.message}`);
    }

    if (!response.ok) {
      const errorMessage = parsed?.error?.message || `${response.status} ${response.statusText}`;
      throw new Error(`Cerebras API error: ${errorMessage}`);
    }

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
