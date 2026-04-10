import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ExplorerRuntime } from '../src/explorer/runtime.mjs';

async function makeRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-freeexplore-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    'export function requireAuth(req, res, next) {\n  if (!req.user) throw new Error("unauthorized");\n  next();\n}\n',
  );
  return root;
}

// --- Phase 8: freeExplore Stabilization Tests ---

test('freeExplore executes tool calls without repoToolkit ReferenceError', async () => {
  class SimpleToolClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: null,
            toolCalls: [
              { id: 't1', function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) } },
            ],
          },
        };
      }
      // Final report
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'requireAuth is defined in src/auth.js',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new SimpleToolClient() });

  let result;
  let error;
  try {
    result = await runtime.freeExplore({ prompt: 'where is requireAuth', repo_root: root });
  } catch (err) {
    error = err;
  }

  assert.ok(!error, `freeExplore should not throw (got: ${error?.message})`);
  assert.ok(result, 'freeExplore returned a result');
  assert.ok(result.report, 'result has a report');
});

test('freeExplore continues after malformed tool arguments', async () => {
  class MalformedArgsClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: null,
            toolCalls: [
              { id: 'bad', function: { name: 'repo_grep', arguments: '{INVALID JSON' } },
              { id: 'ok', function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) } },
            ],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: { content: 'Done exploring despite malformed args', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MalformedArgsClient() });
  const result = await runtime.freeExplore({ prompt: 'find auth', repo_root: root });

  assert.ok(result, 'freeExplore completed despite malformed args');
  assert.ok(result.report, 'result has report');
});

test('freeExplore sets stoppedByBudget when budget is exhausted', async () => {
  // Always return tool calls to exhaust the budget
  class BudgetExhaustClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      // Always use tools until budget runs out, then provide finalize
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser?.content?.includes('finalize') || lastUser?.content?.includes('wrap')) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: { content: 'Final report: found requireAuth', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: null,
          toolCalls: [
            { id: `t${this.calls}`, function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: `term${this.calls}` }) } },
          ],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new BudgetExhaustClient() });
  const result = await runtime.freeExplore({ prompt: 'explore everything', repo_root: root, thoroughness: 'quick' });

  assert.ok(result, 'freeExplore completed');
  assert.equal(result.stats.stoppedByBudget, true, 'stoppedByBudget is true when budget runs out');
  assert.ok(result.report, 'report is set even when budget is exhausted');
});

test('freeExplore finalizes when budget exhausted even if interim text exists', async () => {
  let finalizeCallCount = 0;
  class InterimReportClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser?.content?.includes('final') || lastUser?.content?.includes('wrap')) {
        finalizeCallCount += 1;
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: { content: 'Finalized report after budget exhaustion', toolCalls: [] },
        };
      }
      // Always keep calling tools (never produce final report naturally)
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'I found some things...',  // interim content with tool calls
          toolCalls: [
            { id: `t${this.calls}`, function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: `auth${this.calls}` }) } },
          ],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new InterimReportClient() });
  const result = await runtime.freeExplore({ prompt: 'deep dive into auth', repo_root: root, thoroughness: 'quick' });

  assert.ok(result, 'freeExplore completed');
  assert.ok(finalizeCallCount >= 1, 'finalize was called when budget was exhausted');
  assert.equal(result.stats.stoppedByBudget, true, 'stoppedByBudget is true');
});
