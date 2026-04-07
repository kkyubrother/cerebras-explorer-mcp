import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_EXPLORER_MODEL } from '../src/explorer/config.mjs';
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
