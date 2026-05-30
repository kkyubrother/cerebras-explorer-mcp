/**
 * Regression tests for prior P0/P1 fixes.
 *
 * Each test targets a specific bug that was fixed. These ensure we don't
 * regress as the codebase evolves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExplorerRuntime } from '../src/explorer/runtime.mjs';
import { cacheKeyReadFile, cacheKeyGrep } from '../src/explorer/cache.mjs';

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

// ─── P0-1: cache key derivation ──────────────────────────────────────────────

// Cross-repo cache isolation behaviour (read_file/symbols/scope) is covered by
// the dedicated cluster in repo-tools.test.mjs; here we only guard the key
// derivation functions directly, since they have no other direct unit coverage.

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
            directAnswer: '파싱 오류가 발생했지만 탐색은 계속됐습니다.',
            status: { confidence: 'low', verification: 'broad_search_needed', complete: false, warnings: [] },
            targets: [],
            evidence: [],
            uncertainties: [],
            nextAction: { type: 'ask_user', reason: 'Tool arguments were malformed.' },
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
    });
  }, 'explore() must not throw when a tool call has malformed JSON arguments');

  assert.ok(result, 'result must be returned even after malformed tool args');
  assert.ok(typeof result.directAnswer === 'string', 'result must have a directAnswer field');
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
  });

  assert.ok(!result.report.includes('DRAFT'), `report must NOT contain intermediate draft content, got: ${result.report}`);
  assert.ok(result.report.includes('FINAL_REPORT'), `report must contain the final response content, got: ${result.report}`);
});

// spec 011: project config defaultBudget and the `budget` input were both
// removed. Every call now runs against the single deep runtime config.
