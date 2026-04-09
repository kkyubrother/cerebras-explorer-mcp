import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EXPLORER_MODEL,
  getReasoningEffortForBudget,
} from '../src/explorer/config.mjs';
import { CerebrasChatClient } from '../src/explorer/cerebras-client.mjs';

test('CerebrasChatClient uses CEREBRAS_EXPLORER_MODEL when explicit model is not passed', () => {
  const previousExplorerModel = process.env.CEREBRAS_EXPLORER_MODEL;
  const previousCerebrasModel = process.env.CEREBRAS_MODEL;

  process.env.CEREBRAS_EXPLORER_MODEL = 'zai-glm-4.8-preview';
  process.env.CEREBRAS_MODEL = 'ignored-fallback';

  try {
    const client = new CerebrasChatClient({ apiKey: 'test-key', fetchImpl: async () => null });
    assert.equal(client.model, 'zai-glm-4.8-preview');

    delete process.env.CEREBRAS_EXPLORER_MODEL;
    const fallbackClient = new CerebrasChatClient({ apiKey: 'test-key', fetchImpl: async () => null });
    assert.equal(fallbackClient.model, 'ignored-fallback');

    delete process.env.CEREBRAS_MODEL;
    const defaultClient = new CerebrasChatClient({ apiKey: 'test-key', fetchImpl: async () => null });
    assert.equal(defaultClient.model, DEFAULT_EXPLORER_MODEL);
  } finally {
    if (previousExplorerModel === undefined) {
      delete process.env.CEREBRAS_EXPLORER_MODEL;
    } else {
      process.env.CEREBRAS_EXPLORER_MODEL = previousExplorerModel;
    }

    if (previousCerebrasModel === undefined) {
      delete process.env.CEREBRAS_MODEL;
    } else {
      process.env.CEREBRAS_MODEL = previousCerebrasModel;
    }
  }
});

test('CerebrasChatClient sends GLM 4.7 preserved-thinking defaults and normalizes reasoning', async () => {
  let capturedPayload = null;
  const client = new CerebrasChatClient({
    apiKey: 'test-key',
    model: 'zai-glm-4.7',
    fetchImpl: async (_url, init) => {
      capturedPayload = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({
          id: 'chatcmpl-test',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: 'Checking the repository.',
                reasoning: 'Start with grep, then read the narrowed files.',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'repo_grep', arguments: '{"pattern":"auth"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
    },
  });

  const result = await client.createChatCompletion({
    messages: [{ role: 'user', content: 'Find auth.' }],
    reasoningEffort: 'none',
  });

  assert.equal(capturedPayload.temperature, 1);
  assert.equal(capturedPayload.top_p, 0.95);
  assert.equal(capturedPayload.reasoning_effort, 'none');
  assert.equal(capturedPayload.reasoning_format, 'parsed');
  assert.equal(capturedPayload.clear_thinking, false);
  assert.equal(result.message.reasoning, 'Start with grep, then read the narrowed files.');
  assert.equal(result.message.toolCalls[0].function.name, 'repo_grep');
});

test('CerebrasChatClient omits GLM-only fields for models that do not support them', async () => {
  let capturedPayload = null;
  const client = new CerebrasChatClient({
    apiKey: 'test-key',
    model: 'llama3.1-8b',
    fetchImpl: async (_url, init) => {
      capturedPayload = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({
          id: 'chatcmpl-test',
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'ok',
                tool_calls: null,
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
    },
  });

  await client.createChatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    reasoningEffort: 'none',
  });

  assert.equal('clear_thinking' in capturedPayload, false);
  assert.equal('reasoning_effort' in capturedPayload, false);
  assert.equal('reasoning_format' in capturedPayload, false);
});

test('getReasoningEffortForBudget maps GLM 4.7 budgets to supported values', () => {
  assert.equal(getReasoningEffortForBudget('zai-glm-4.7', 'quick'), 'none');
  assert.equal(getReasoningEffortForBudget('zai-glm-4.7', 'normal'), undefined);
  assert.equal(getReasoningEffortForBudget('zai-glm-4.7', 'deep'), undefined);
});
