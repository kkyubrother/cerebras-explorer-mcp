import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ExplorerRuntime } from '../src/explorer/runtime.mjs';

async function makeRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-freeexplore-'));
  await fs.mkdir(path.join(root, 'src', 'routes'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    'export function requireAuth(req, res, next) {\n  if (!req.user) throw new Error("unauthorized");\n  next();\n}\n',
  );
  await fs.writeFile(
    path.join(root, 'src', 'routes', 'user.js'),
    'import { requireAuth } from "../auth.js";\nexport function registerUserRoutes(app) {\n  app.get("/users/me", requireAuth);\n}\n',
  );
  return root;
}

function withEnvPatch(patch, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
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
              { id: 't1', function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }) } },
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
  assert.equal(result.critic.status, 'caution');
  assert.ok(result.critic.warnings.some(w => w.type === 'citation_gap'));
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

test('freeExplore searchCoverage counts non-read tool calls', async () => {
  class CoverageClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: null,
            toolCalls: [
              { id: 'list', function: { name: 'repo_list_dir', arguments: JSON.stringify({ dirPath: 'src', depth: 1 }) } },
              { id: 'symbols', function: { name: 'repo_symbols', arguments: JSON.stringify({ path: 'src/auth.js' }) } },
              { id: 'grep', function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth', scope: ['src/**'] }) } },
            ],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: { content: 'Coverage report', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CoverageClient() });
  const result = await runtime.freeExplore({ prompt: 'map auth surface', repo_root: root });

  assert.equal(result.stats.listDirCalls, 1);
  assert.equal(result.stats.symbolCalls, 1);
  assert.equal(result.stats.grepCalls, 1);
  assert.equal(result.searchCoverage.listDirCalls, 1);
  assert.equal(result.searchCoverage.symbolCalls, 1);
  assert.equal(result.searchCoverage.grepCalls, 1);
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

test('freeExplore finalizes and returns a non-empty report when the tool loop terminates', async () => {
  // spec 011: freeExplore now delegates to the (formerly V2) backend, which has
  // periodic checkpoint nudges asking the model to wrap up. The contract this
  // test protects is "the loop reliably produces a report even when the model
  // never stops calling tools on its own".
  let finalizeCallCount = 0;
  class InterimReportClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const lastUserText = String(lastUser?.content ?? '');
      if (
        lastUserText.includes('final')
        || lastUserText.includes('wrap')
        || lastUserText.includes('Budget exhausted')
        || lastUserText.includes('Checkpoint')
      ) {
        finalizeCallCount += 1;
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: { content: 'Finalized report after loop termination', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'I found some things...',
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
  assert.ok(finalizeCallCount >= 1, 'finalize-style turn must fire at least once');
  assert.ok(
    typeof result.report === 'string' && result.report.trim().length > 0,
    'report must be a non-empty string after the loop terminates',
  );
});

test('freeExplore finalizes intent-only no-tool responses instead of returning them as reports', async () => {
  let finalizeCallCount = 0;
  class IntentOnlyClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const lastUserText = String(lastUser?.content ?? '');
      if (lastUserText.includes('Budget exhausted') || lastUserText.includes('final Markdown report')) {
        finalizeCallCount += 1;
        return {
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          message: {
            content: '## Summary\n\nProvider behavior is implemented by Cerebras and OpenAI-compatible clients.',
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: null,
            toolCalls: [
              { id: 't1', function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }) } },
            ],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        message: {
          content: 'I have enough evidence to write the report. Let me compile it now.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new IntentOnlyClient() });
  const result = await runtime.freeExplore({ prompt: 'explain providers', repo_root: root, thoroughness: 'quick' });

  assert.equal(finalizeCallCount, 1, 'intent-only no-tool response should trigger finalize prompt');
  assert.match(result.report, /Provider behavior/);
  assert.doesNotMatch(result.report, /Let me compile it now/);
});

test('freeExplore stops after repeated unknown tool errors', async () => {
  class UnknownToolClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser?.content?.includes('Budget exhausted') || lastUser?.content?.includes('final Markdown report')) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: { content: 'Final report after repeated tool errors', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: null,
          toolCalls: [
            { id: `bad${this.calls}`, function: { name: 'repo_search', arguments: JSON.stringify({ pattern: 'auth' }) } },
          ],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new UnknownToolClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.freeExplore({ prompt: 'find auth', repo_root: root, thoroughness: 'quick' });

  assert.ok(result, 'freeExplore completed');
  assert.equal(result.stats.stoppedByErrors, true, 'stoppedByErrors is true after repeated all-error turns');
  assert.equal(result.stats.stoppedByBudget, false, 'circuit breaker stops before budget exhaustion');
  assert.equal(result.stats.turns, 3, 'circuit breaker fires at the configured threshold');
  assert.equal(result.stats.toolCalls, 3, 'unknown tool calls are counted and returned as validation errors');
  assert.equal(client.calls, 4, 'three tool-loop calls plus one finalization call');
});

test('freeExplore exposes report citations and citation targets', async () => {
  class CitationReportClient {
    constructor() { this.model = 'test'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'Summary cites `src/auth.js:L1-L3` and `src/routes/user.js:L2`.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CitationReportClient() });
  const result = await runtime.freeExplore({
    prompt: 'explain auth flow with citations',
    repo_root: root,
    thoroughness: 'quick',
  });

  assert.deepEqual(result.citations.map(item => ({
    type: item.type,
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
  })), [
    { type: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 3 },
    { type: 'file_range', path: 'src/routes/user.js', startLine: 2, endLine: 2 },
  ]);
  assert.deepEqual(result.targets.map(item => ({
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
    role: item.role,
  })), [
    { path: 'src/auth.js', startLine: 1, endLine: 3, role: 'reference' },
    { path: 'src/routes/user.js', startLine: 2, endLine: 2, role: 'reference' },
  ]);
});

test('freeExplore returns empty citations and targets when report has no citations', async () => {
  class PlainReportClient {
    constructor() { this.model = 'test'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'No file references here.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new PlainReportClient() });
  const result = await runtime.freeExplore({
    prompt: 'write a report without citations',
    repo_root: root,
    thoroughness: 'quick',
  });

  assert.deepEqual(result.citations, []);
  assert.deepEqual(result.targets, []);
});

test('freeExploreV2 exposes the same citation shape with transcriptPath preserved', async () => {
  class CitationReportClient {
    constructor() { this.model = 'test'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        finishReason: 'stop',
        message: {
          content: 'Summary cites `src/auth.js:L1-L3` and `src/routes/user.js:L2`.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-freeexplore-transcripts-'));
  await withEnvPatch({
    CEREBRAS_EXPLORER_TRANSCRIPT: 'true',
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: transcriptDir,
  }, async () => {
    const runtime = new ExplorerRuntime({ chatClient: new CitationReportClient() });
    const result = await runtime.freeExploreV2({
      prompt: 'explain auth flow with citations',
      repo_root: root,
      thoroughness: 'quick',
    });

    assert.deepEqual(result.citations.map(item => ({
      type: item.type,
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
    })), [
      { type: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 3 },
      { type: 'file_range', path: 'src/routes/user.js', startLine: 2, endLine: 2 },
    ]);
    assert.deepEqual(result.targets.map(item => ({
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      role: item.role,
    })), [
      { path: 'src/auth.js', startLine: 1, endLine: 3, role: 'reference' },
      { path: 'src/routes/user.js', startLine: 2, endLine: 2, role: 'reference' },
    ]);
    assert.equal(typeof result.transcriptPath, 'string');
  });
});

test('freeExplore deduplicates citation-derived targets by (path, startLine, endLine)', async () => {
  class DuplicateCitationClient {
    constructor() { this.model = 'test'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'First `src/auth.js:L1-L3`, then repeated `src/auth.js:L1-L3`.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new DuplicateCitationClient() });
  const result = await runtime.freeExplore({
    prompt: 'explain auth flow with repeated citations',
    repo_root: root,
    thoroughness: 'quick',
  });

  assert.equal(result.citations.length, 2);
  assert.deepEqual(result.targets.map(item => ({
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
    role: item.role,
  })), [
    { path: 'src/auth.js', startLine: 1, endLine: 3, role: 'reference' },
  ]);
});
