/**
 * Regression tests for P0/P1 issues from feedback_1.md
 *
 * Each test targets a specific bug that was fixed. These ensure we don't
 * regress as the codebase evolves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getBudgetConfig } from '../src/explorer/config.mjs';
import { RepoToolkit } from '../src/explorer/repo-tools.mjs';
import { ExplorerRuntime } from '../src/explorer/runtime.mjs';
import { globalRepoCache, cacheKeyReadFile, cacheKeyGrep } from '../src/explorer/cache.mjs';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

async function makeRepoFixture(prefix = 'regression-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    'export function requireAuth(req, res, next) {\n  if (!req.user) return res.status(401).end();\n  next();\n}\n',
  );
  await fs.writeFile(
    path.join(root, 'src', 'util.js'),
    'export function noop() {}\n',
  );
  return root;
}

// ─── P0-1: cross-repo cache isolation ────────────────────────────────────────

test('P0: cache keys are isolated by repoRoot — different repos do not share cache entries', async () => {
  const rootA = await makeRepoFixture('cache-a-');
  const rootB = await makeRepoFixture('cache-b-');

  // Write a different file at the same relative path in each fixture
  await fs.writeFile(path.join(rootA, 'src', 'auth.js'), 'const FROM_REPO_A = true;\n');
  await fs.writeFile(path.join(rootB, 'src', 'auth.js'), 'const FROM_REPO_B = true;\n');

  const budgetConfig = getBudgetConfig('quick');
  const cache = globalRepoCache;

  const toolkitA = new RepoToolkit({ repoRoot: rootA, budgetConfig, cache });
  const toolkitB = new RepoToolkit({ repoRoot: rootB, budgetConfig, cache });

  await toolkitA.initialize();
  await toolkitB.initialize();

  const resultA = await toolkitA.callTool('repo_read_file', { path: 'src/auth.js' });
  const resultB = await toolkitB.callTool('repo_read_file', { path: 'src/auth.js' });

  assert.ok(resultA.content.includes('REPO_A'), `Repo A result must contain REPO_A content, got: ${resultA.content}`);
  assert.ok(resultB.content.includes('REPO_B'), `Repo B result must contain REPO_B content, got: ${resultB.content}`);
  assert.ok(!resultA.content.includes('REPO_B'), 'Repo A result must NOT contain REPO_B content');
  assert.ok(!resultB.content.includes('REPO_A'), 'Repo B result must NOT contain REPO_A content');
});

test('P0: cacheKeyReadFile includes repoRootReal to prevent cross-repo collisions', () => {
  const keyA = cacheKeyReadFile('/repo/a', 'src/auth.js', 1, 100);
  const keyB = cacheKeyReadFile('/repo/b', 'src/auth.js', 1, 100);
  assert.notEqual(keyA, keyB, 'cache keys for same relative path in different repos must differ');
});

test('P0: cacheKeyGrep includes repoRootReal and maxResults', () => {
  const k1 = cacheKeyGrep('/repo/a', 'pattern', false, [], 50, 0);
  const k2 = cacheKeyGrep('/repo/b', 'pattern', false, [], 50, 0);
  const k3 = cacheKeyGrep('/repo/a', 'pattern', false, [], 100, 0);
  assert.notEqual(k1, k2, 'different repo roots must produce different keys');
  assert.notEqual(k1, k3, 'different maxResults must produce different keys');
});

// ─── P0-2: ripgrep scope bypass ──────────────────────────────────────────────

test('P0: ripgrep fast-path is skipped when baseScopeRules is active', async () => {
  const root = await makeRepoFixture('scope-rg-');
  // Add a file OUTSIDE the scope
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'notes.md'), 'requireAuth is documented here\n');

  const budgetConfig = getBudgetConfig('quick');
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig });
  // Initialize with scope restricted to src/**
  await toolkit.initialize(['src/**']);

  const result = await toolkit.grep({ pattern: 'requireAuth' });

  const docMatch = result.matches.find(m => m.path.startsWith('docs/'));
  assert.equal(docMatch, undefined, 'grep with baseScopeRules must not return results outside scope (docs/)');
});

// ─── P0-3: malformed tool args isolation ─────────────────────────────────────

test('P0: malformed tool arguments produce error result instead of crashing explore', async () => {
  class MalformedArgClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        // Return a tool call with invalid JSON arguments
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-bad',
              function: { name: 'repo_read_file', arguments: '{INVALID_JSON' },
            }],
          },
        };
      }
      // After the error is fed back, return a valid final answer
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: JSON.stringify({
            answer: '파싱 오류가 발생했지만 탐색은 계속됐습니다.',
            summary: '요약',
            confidence: 'low',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture('malformed-');
  const runtime = new ExplorerRuntime({ chatClient: new MalformedArgClient() });

  // Must NOT throw — malformed args must be caught and returned as a tool error
  let result;
  await assert.doesNotReject(async () => {
    result = await runtime.explore({
      task: '인증 함수 분석',
      repo_root: root,
      budget: 'quick',
    });
  }, 'explore() must not throw when a tool call has malformed JSON arguments');

  assert.ok(result, 'result must be returned even after malformed tool args');
  assert.ok(typeof result.answer === 'string', 'result must have an answer field');
});

// ─── P0-4: macro tool grounding (repo_symbol_context) ────────────────────────

test('P0: repo_symbol_context result includes observedRanges metadata', async () => {
  const root = await makeRepoFixture('sym-ctx-');
  const budgetConfig = getBudgetConfig('quick');
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig });
  await toolkit.initialize();

  const result = await toolkit.callTool('repo_symbol_context', { symbol: 'requireAuth' });

  assert.ok(Array.isArray(result.observedRanges), 'symbolContext must return observedRanges array');
  // requireAuth is defined in src/auth.js — at least the definition should be in observedRanges
  if (result.definition) {
    assert.ok(result.observedRanges.length >= 1, 'observedRanges must contain at least the definition location');
    const defRange = result.observedRanges[0];
    assert.ok(typeof defRange.path === 'string', 'each observed range must have a path');
    assert.ok(typeof defRange.startLine === 'number', 'each observed range must have a startLine');
    assert.ok(typeof defRange.endLine === 'number', 'each observed range must have an endLine');
  }
});

// ─── P0-6: freeExplore intermediate drafts ───────────────────────────────────

test('P0: freeExplore does not use intermediate tool-call content as final report', async () => {
  class DraftLeakClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        // Turn 1: content AND tool calls (draft + tool call in same response)
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: 'DRAFT_CONTENT_MUST_NOT_LEAK',
            toolCalls: [{
              id: 'call-1',
              function: { name: 'repo_list_dir', arguments: JSON.stringify({ dirPath: '.', depth: 1 }) },
            }],
          },
        };
      }
      // Turn 2: final response with no tool calls
      return {
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        message: {
          content: 'FINAL_REPORT_CONTENT',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture('free-draft-');
  const runtime = new ExplorerRuntime({ chatClient: new DraftLeakClient() });
  const result = await runtime.freeExplore({
    prompt: '저장소 구조를 설명해라',
    repo_root: root,
    budget: 'quick',
  });

  assert.ok(!result.report.includes('DRAFT'), `report must NOT contain intermediate draft content, got: ${result.report}`);
  assert.ok(result.report.includes('FINAL_REPORT'), `report must contain the final response content, got: ${result.report}`);
});

// ─── P1-1: defaultBudget reflection ──────────────────────────────────────────

test('P1: defaultBudget from project config is applied before budgetConfig is computed', async () => {
  const root = await makeRepoFixture('budget-');
  // Write a project config with defaultBudget: 'quick'
  await fs.writeFile(
    path.join(root, '.cerebras-explorer.json'),
    JSON.stringify({ defaultBudget: 'quick' }),
  );

  class BudgetCheckClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.capturedMaxTurns = null;
    }
    async createChatCompletion({ maxCompletionTokens }) {
      // Return immediately with a final answer so we can check the budget
      return {
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        message: {
          content: JSON.stringify({
            answer: 'done', summary: 'done', confidence: 'low',
            evidence: [], candidatePaths: [], followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const runtime = new ExplorerRuntime({ chatClient: new BudgetCheckClient() });
  const result = await runtime.explore({
    task: '테스트',
    repo_root: root,
    // No explicit budget — should fall back to project config's 'quick'
  });

  // 'quick' budget has maxTurns = 4, 'normal' has 8.
  // If defaultBudget is correctly applied, stats.budget should be 'quick'.
  assert.equal(result.stats.budget, 'quick',
    `stats.budget must reflect defaultBudget from project config, got: ${result.stats.budget}`);
});
