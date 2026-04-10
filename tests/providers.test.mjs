import test from 'node:test';
import assert from 'node:assert/strict';

import { OpenAICompatChatClient } from '../src/explorer/providers/openai-compat.mjs';
import { OllamaChatClient } from '../src/explorer/providers/ollama.mjs';
import { FailoverChatClient } from '../src/explorer/providers/failover.mjs';
import { createChatClient } from '../src/explorer/providers/index.mjs';
import { CerebrasChatClient } from '../src/explorer/cerebras-client.mjs';
import { classifyTaskComplexity, getModelForBudget, getReasoningEffortForBudget } from '../src/explorer/config.mjs';

// ─── Shared mock fetch helpers ───────────────────────────────────────────────

function makeMockFetch(responseBody, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => JSON.stringify(responseBody),
  });
}

const VALID_COMPLETION_RESPONSE = {
  id: 'cmpl-test-1',
  choices: [
    {
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: 'Test response',
        tool_calls: null,
      },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

// ─── OpenAICompatChatClient ──────────────────────────────────────────────────

test('OpenAICompatChatClient: model property reflects constructor arg', () => {
  const client = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'gpt-4o',
    fetchImpl: makeMockFetch(VALID_COMPLETION_RESPONSE),
  });
  assert.equal(client.model, 'gpt-4o');
});

test('OpenAICompatChatClient: returns normalised message from API response', async () => {
  const client = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    fetchImpl: makeMockFetch(VALID_COMPLETION_RESPONSE),
  });

  const result = await client.createChatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
  });

  assert.equal(result.message.content, 'Test response');
  assert.equal(result.message.role, 'assistant');
  assert.deepEqual(result.message.toolCalls, []);
  assert.equal(result.usage.total_tokens, 15);
});

test('OpenAICompatChatClient: throws when API key is missing', async () => {
  const client = new OpenAICompatChatClient({
    apiKey: '',
    model: 'gpt-4o-mini',
    fetchImpl: makeMockFetch(VALID_COMPLETION_RESPONSE),
  });
  await assert.rejects(
    () => client.createChatCompletion({ messages: [] }),
    /EXPLORER_OPENAI_API_KEY/,
  );
});

test('OpenAICompatChatClient: throws on non-200 API response', async () => {
  const errorResponse = { error: { message: 'rate limit exceeded' } };
  const client = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    fetchImpl: makeMockFetch(errorResponse, 429),
  });
  await assert.rejects(
    () => client.createChatCompletion({ messages: [] }),
    /rate limit exceeded/,
  );
});

test('OpenAICompatChatClient: normalises tool_calls array in response', async () => {
  const responseWithToolCall = {
    id: 'cmpl-tool-1',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-abc',
              type: 'function',
              function: { name: 'repo_grep', arguments: '{"pattern":"foo"}' },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };

  const client = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    fetchImpl: makeMockFetch(responseWithToolCall),
  });

  const result = await client.createChatCompletion({ messages: [] });
  assert.equal(result.message.toolCalls.length, 1);
  assert.equal(result.message.toolCalls[0].id, 'call-abc');
  assert.equal(result.message.toolCalls[0].function.name, 'repo_grep');
});

// ─── OllamaChatClient ────────────────────────────────────────────────────────

test('OllamaChatClient: uses Ollama base URL and model defaults', () => {
  const prevUrl = process.env.EXPLORER_OLLAMA_BASE_URL;
  const prevModel = process.env.EXPLORER_OLLAMA_MODEL;
  delete process.env.EXPLORER_OLLAMA_BASE_URL;
  delete process.env.EXPLORER_OLLAMA_MODEL;

  try {
    const client = new OllamaChatClient({
      fetchImpl: makeMockFetch(VALID_COMPLETION_RESPONSE),
    });
    assert.equal(client.model, 'llama3');
  } finally {
    if (prevUrl !== undefined) process.env.EXPLORER_OLLAMA_BASE_URL = prevUrl;
    if (prevModel !== undefined) process.env.EXPLORER_OLLAMA_MODEL = prevModel;
  }
});

test('OllamaChatClient: respects EXPLORER_OLLAMA_MODEL env var', () => {
  const prev = process.env.EXPLORER_OLLAMA_MODEL;
  process.env.EXPLORER_OLLAMA_MODEL = 'qwen2.5-coder:32b';

  try {
    const client = new OllamaChatClient({
      fetchImpl: makeMockFetch(VALID_COMPLETION_RESPONSE),
    });
    assert.equal(client.model, 'qwen2.5-coder:32b');
  } finally {
    if (prev === undefined) delete process.env.EXPLORER_OLLAMA_MODEL;
    else process.env.EXPLORER_OLLAMA_MODEL = prev;
  }
});

test('OllamaChatClient: returns normalised message from Ollama-compatible response', async () => {
  const client = new OllamaChatClient({
    model: 'llama3',
    fetchImpl: makeMockFetch(VALID_COMPLETION_RESPONSE),
  });

  const result = await client.createChatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
  });

  assert.equal(result.message.content, 'Test response');
  assert.deepEqual(result.message.toolCalls, []);
});

// ─── FailoverChatClient ──────────────────────────────────────────────────────

test('FailoverChatClient: uses first provider when it succeeds', async () => {
  const primary = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'primary-model',
    fetchImpl: makeMockFetch(VALID_COMPLETION_RESPONSE),
  });
  const fallback = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'fallback-model',
    fetchImpl: makeMockFetch({ ...VALID_COMPLETION_RESPONSE, id: 'fallback' }),
  });

  const client = new FailoverChatClient({ providers: [primary, fallback] });
  assert.equal(client.model, 'primary-model');

  const result = await client.createChatCompletion({ messages: [] });
  assert.equal(result.id, 'cmpl-test-1');  // came from primary
});

test('FailoverChatClient: falls back to second provider when first fails', async () => {
  const failingFetch = async () => { throw new Error('Connection refused'); };
  const primary = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'primary-model',
    fetchImpl: failingFetch,
  });
  const successFetch = makeMockFetch({ ...VALID_COMPLETION_RESPONSE, id: 'fallback-id' });
  const fallback = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'fallback-model',
    fetchImpl: successFetch,
  });

  const client = new FailoverChatClient({ providers: [primary, fallback] });
  const result = await client.createChatCompletion({ messages: [] });
  assert.equal(result.id, 'fallback-id');
});

test('FailoverChatClient: throws when all providers fail', async () => {
  const failingFetch = async () => { throw new Error('All down'); };
  const p1 = new OpenAICompatChatClient({ apiKey: 'k', model: 'm1', fetchImpl: failingFetch });
  const p2 = new OpenAICompatChatClient({ apiKey: 'k', model: 'm2', fetchImpl: failingFetch });

  const client = new FailoverChatClient({ providers: [p1, p2] });
  await assert.rejects(() => client.createChatCompletion({ messages: [] }), /All down/);
});

test('FailoverChatClient: throws when constructed with empty providers array', () => {
  assert.throws(() => new FailoverChatClient({ providers: [] }), /at least one provider/);
});

// ─── createChatClient factory ────────────────────────────────────────────────

test('createChatClient: returns CerebrasChatClient by default', () => {
  const prevProvider = process.env.EXPLORER_PROVIDER;
  const prevFailover = process.env.EXPLORER_FAILOVER;
  delete process.env.EXPLORER_PROVIDER;
  delete process.env.EXPLORER_FAILOVER;

  try {
    const client = createChatClient();
    assert.ok(client instanceof CerebrasChatClient, 'default provider must be CerebrasChatClient');
  } finally {
    if (prevProvider !== undefined) process.env.EXPLORER_PROVIDER = prevProvider;
    if (prevFailover !== undefined) process.env.EXPLORER_FAILOVER = prevFailover;
  }
});

test('createChatClient: returns OpenAICompatChatClient when EXPLORER_PROVIDER=openai-compat', () => {
  const prev = process.env.EXPLORER_PROVIDER;
  const prevFailover = process.env.EXPLORER_FAILOVER;
  process.env.EXPLORER_PROVIDER = 'openai-compat';
  delete process.env.EXPLORER_FAILOVER;

  try {
    const client = createChatClient();
    assert.ok(client instanceof OpenAICompatChatClient);
  } finally {
    if (prev === undefined) delete process.env.EXPLORER_PROVIDER;
    else process.env.EXPLORER_PROVIDER = prev;
    if (prevFailover !== undefined) process.env.EXPLORER_FAILOVER = prevFailover;
  }
});

test('createChatClient: returns OllamaChatClient when EXPLORER_PROVIDER=ollama', () => {
  const prev = process.env.EXPLORER_PROVIDER;
  const prevFailover = process.env.EXPLORER_FAILOVER;
  process.env.EXPLORER_PROVIDER = 'ollama';
  delete process.env.EXPLORER_FAILOVER;

  try {
    const client = createChatClient();
    assert.ok(client instanceof OllamaChatClient);
  } finally {
    if (prev === undefined) delete process.env.EXPLORER_PROVIDER;
    else process.env.EXPLORER_PROVIDER = prev;
    if (prevFailover !== undefined) process.env.EXPLORER_FAILOVER = prevFailover;
  }
});

test('createChatClient: returns FailoverChatClient when EXPLORER_FAILOVER is set', () => {
  const prevFailover = process.env.EXPLORER_FAILOVER;
  const prevKey = process.env.EXPLORER_OPENAI_API_KEY;
  process.env.EXPLORER_FAILOVER = 'cerebras,openai-compat';
  process.env.EXPLORER_OPENAI_API_KEY = 'test-key';

  try {
    const client = createChatClient();
    assert.ok(client instanceof FailoverChatClient);
  } finally {
    if (prevFailover === undefined) delete process.env.EXPLORER_FAILOVER;
    else process.env.EXPLORER_FAILOVER = prevFailover;
    if (prevKey === undefined) delete process.env.EXPLORER_OPENAI_API_KEY;
    else process.env.EXPLORER_OPENAI_API_KEY = prevKey;
  }
});

test('createChatClient: throws on unknown provider name', () => {
  const prev = process.env.EXPLORER_PROVIDER;
  const prevFailover = process.env.EXPLORER_FAILOVER;
  process.env.EXPLORER_PROVIDER = 'anthropic';
  delete process.env.EXPLORER_FAILOVER;

  try {
    assert.throws(() => createChatClient(), /Unknown provider/);
  } finally {
    if (prev === undefined) delete process.env.EXPLORER_PROVIDER;
    else process.env.EXPLORER_PROVIDER = prev;
    if (prevFailover !== undefined) process.env.EXPLORER_FAILOVER = prevFailover;
  }
});

// ─── classifyTaskComplexity ──────────────────────────────────────────────────

test('classifyTaskComplexity: simple queries', () => {
  assert.equal(classifyTaskComplexity('requireAuth 함수가 어디 정의돼 있어?'), 'simple');
  assert.equal(classifyTaskComplexity('Where is the CacheManager class defined?'), 'simple');
  assert.equal(classifyTaskComplexity('ExplorerRuntime 찾아줘'), 'simple');
});

test('classifyTaskComplexity: complex queries', () => {
  assert.equal(classifyTaskComplexity('이 메모리 누수의 원인을 분석해줘'), 'complex');
  assert.equal(classifyTaskComplexity('Identify the security vulnerability in the auth module'), 'complex');
  assert.equal(classifyTaskComplexity('왜 이 성능 문제가 발생하는가?'), 'complex');
});

test('classifyTaskComplexity: moderate queries (default)', () => {
  assert.equal(classifyTaskComplexity('인증 미들웨어의 전체 구조를 설명해줘'), 'moderate');
  assert.equal(classifyTaskComplexity('How does the cache layer work?'), 'moderate');
  assert.equal(classifyTaskComplexity('What changed in the last release?'), 'moderate');
});

// ─── getModelForBudget ───────────────────────────────────────────────────────

test('getModelForBudget: returns quick model env var', () => {
  const prev = process.env.CEREBRAS_EXPLORER_MODEL_QUICK;
  process.env.CEREBRAS_EXPLORER_MODEL_QUICK = 'fast-model';
  try {
    assert.equal(getModelForBudget('quick'), 'fast-model');
  } finally {
    if (prev === undefined) delete process.env.CEREBRAS_EXPLORER_MODEL_QUICK;
    else process.env.CEREBRAS_EXPLORER_MODEL_QUICK = prev;
  }
});

test('getModelForBudget: returns deep model env var', () => {
  const prev = process.env.CEREBRAS_EXPLORER_MODEL_DEEP;
  process.env.CEREBRAS_EXPLORER_MODEL_DEEP = 'reasoning-model';
  try {
    assert.equal(getModelForBudget('deep'), 'reasoning-model');
  } finally {
    if (prev === undefined) delete process.env.CEREBRAS_EXPLORER_MODEL_DEEP;
    else process.env.CEREBRAS_EXPLORER_MODEL_DEEP = prev;
  }
});

test('getModelForBudget: falls back to global model when budget env var not set', () => {
  const prevQuick = process.env.CEREBRAS_EXPLORER_MODEL_QUICK;
  const prevGlobal = process.env.CEREBRAS_EXPLORER_MODEL;
  delete process.env.CEREBRAS_EXPLORER_MODEL_QUICK;
  process.env.CEREBRAS_EXPLORER_MODEL = 'global-model';
  try {
    assert.equal(getModelForBudget('quick'), 'global-model');
  } finally {
    if (prevQuick !== undefined) process.env.CEREBRAS_EXPLORER_MODEL_QUICK = prevQuick;
    if (prevGlobal === undefined) delete process.env.CEREBRAS_EXPLORER_MODEL;
    else process.env.CEREBRAS_EXPLORER_MODEL = prevGlobal;
  }
});

test('OpenAICompatChatClient: strips assistant reasoning from outgoing messages', async () => {
  let capturedPayload = null;
  const client = new OpenAICompatChatClient({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    fetchImpl: async (_url, init) => {
      capturedPayload = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(VALID_COMPLETION_RESPONSE),
      };
    },
  });

  await client.createChatCompletion({
    messages: [{ role: 'assistant', content: 'hello', reasoning: 'private plan' }],
  });

  assert.equal(capturedPayload.messages[0].reasoning, undefined);
});

test('getReasoningEffortForBudget: gpt-oss uses low/medium/high ladder', () => {
  assert.equal(getReasoningEffortForBudget('gpt-oss-120b', 'quick'), 'low');
  assert.equal(getReasoningEffortForBudget('gpt-oss-120b', 'normal'), 'medium');
  assert.equal(getReasoningEffortForBudget('gpt-oss-120b', 'deep'), 'high');
});

// --- Phase 9: Provider Timeout / Abort / Retry ---

test('OpenAICompatChatClient aborts timed-out requests', async () => {
  const previousTimeout = process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS;
  process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS = '50';

  const hangingFetch = async (_url, { signal }) => {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })));
    });
  };

  const client = new OpenAICompatChatClient({ apiKey: 'test-key', fetchImpl: hangingFetch });
  try {
    await assert.rejects(
      client.createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
      /timed out/,
    );
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS;
    } else {
      process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS = previousTimeout;
    }
  }
});

test('OpenAICompatChatClient retries on 429 and succeeds', async () => {
  let callCount = 0;
  const retryFetch = async (_url, _init) => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => JSON.stringify({ error: { message: 'rate limited' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        id: 'test',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok', tool_calls: [] } }],
      }),
    };
  };

  const client = new OpenAICompatChatClient({ apiKey: 'test-key', fetchImpl: retryFetch });
  const result = await client.createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
  assert.ok(result, 'succeeded after retry');
  assert.equal(callCount, 2, 'fetch called twice');
});

test('Non-retryable 400 errors are not retried', async () => {
  let callCount = 0;
  const badFetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({ error: { message: 'bad request' } }),
    };
  };

  const client = new OpenAICompatChatClient({ apiKey: 'test-key', fetchImpl: badFetch });
  await assert.rejects(
    client.createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    /bad request/,
  );
  assert.equal(callCount, 1, '400 not retried');
});
