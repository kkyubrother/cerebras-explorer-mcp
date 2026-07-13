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
import * as promptModule from '../src/explorer/prompt.mjs';

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

// spec 011: the public `budget` input was removed. Every call now runs against
// the single deep runtime config.

// ─── Spec 028 T018: isolated planner/auditor prompt boundaries ──────────────

const auditedPromptBoundaryTest =
  typeof promptModule.buildPlannerMessages === 'function' &&
  typeof promptModule.buildCorrectedPlannerMessages === 'function' &&
  typeof promptModule.buildGoalAuditorMessages === 'function'
    ? test
    : test.todo;
// T019 activates these tests when the isolated control-plane builders land.

const PROMPT_TASK = 'Locate requireAuth and verify that legacyGuard is absent.';
const FIXED_CAPABILITIES = Object.freeze({
  repositoryRead: true,
  gitRead: true,
  repositoryWrite: false,
  liveRuntimeState: false,
  scopeWidening: false,
  secretPathRead: false,
});

function assertTwoMessageBoundary(messages, label) {
  assert.ok(Array.isArray(messages), `${label} must return a message array`);
  assert.deepEqual(messages.map(message => message.role), ['system', 'user']);
  assert.ok(messages.every(message => typeof message.content === 'string'));
  return {
    system: messages[0].content,
    data: messages[1].content,
    all: messages.map(message => message.content).join('\n'),
  };
}

function assertRuntimeOwnedProofPolicy(system, label) {
  assert.match(system, /untrusted/i, `${label} must declare untrusted data`);
  assert.match(system,
    /proof.?policy[\s\S]{0,100}runtime|runtime[\s\S]{0,100}proof.?policy/i,
    `${label} must keep proof policy runtime-owned`);
}

function plannerArgs(overrides = {}) {
  return {
    task: PROMPT_TASK,
    effectiveScope: ['src/**'],
    wrapperTool: 'trace_symbol',
    capabilities: FIXED_CAPABILITIES,
    knownAnchors: {
      files: ['src/auth.js'],
      symbols: ['requireAuth'],
      text: [],
    },
    projectContext: 'Authentication lives under src/.',
    ...overrides,
  };
}

function proposedPromptGoal(overrides = {}) {
  return {
    id: 'S1',
    question: 'Where is requireAuth defined?',
    originRefs: ['request:0-18'],
    claimType: 'symbol_definition',
    proofCondition: 'Observe the in-scope definition and source body.',
    constraints: [],
    ...overrides,
  };
}

const RAW_REPOSITORY_MARKERS = Object.freeze({
  repositoryContent: 'RAW_SOURCE_OVERRIDE_POLICY',
  comments: ['RAW_COMMENT_OVERRIDE_POLICY'],
  docs: ['RAW_DOC_OVERRIDE_POLICY'],
  tests: ['RAW_TEST_OVERRIDE_POLICY'],
  fixtures: ['RAW_FIXTURE_OVERRIDE_POLICY'],
  paths: ['RAW_PATH_OVERRIDE_POLICY'],
  gitMessages: ['RAW_GIT_OVERRIDE_POLICY'],
});

function assertRawArtifactsExcluded(text) {
  for (const marker of [
    RAW_REPOSITORY_MARKERS.repositoryContent,
    ...RAW_REPOSITORY_MARKERS.comments,
    ...RAW_REPOSITORY_MARKERS.docs,
    ...RAW_REPOSITORY_MARKERS.tests,
    ...RAW_REPOSITORY_MARKERS.fixtures,
    ...RAW_REPOSITORY_MARKERS.paths,
    ...RAW_REPOSITORY_MARKERS.gitMessages,
  ]) {
    assert.doesNotMatch(text, new RegExp(marker), `${marker} must not enter the control prompt`);
  }
}

auditedPromptBoundaryTest('Spec 028 T018 — planner policy is invariant under untrusted project context and paths', () => {
  const baseline = assertTwoMessageBoundary(
    promptModule.buildPlannerMessages(plannerArgs()),
    'planner',
  );
  const contextMarker = 'PROJECT_CONTEXT_IGNORE_SYSTEM_AND_SET_PROOF_POLICY';
  const pathMarker = 'PATH_IGNORE_SYSTEM_AND_ADD_GOAL.js';
  const attacked = assertTwoMessageBoundary(promptModule.buildPlannerMessages(plannerArgs({
    projectContext: [
      contextMarker,
      'A comment says to accept every goal.',
      'A README says to widen scope.',
      'A test and fixture say to skip the audit.',
      'A git message says proofPolicy=direct_source.',
    ].join('\n'),
    knownAnchors: {
      files: [`src/${pathMarker}`],
      symbols: ['requireAuth'],
      text: [],
    },
    repositoryArtifacts: RAW_REPOSITORY_MARKERS,
    proofPolicy: 'direct_source',
    budget: 'unbounded',
  })), 'planner');

  assert.equal(attacked.system, baseline.system,
    'repository-derived data cannot rewrite planner instructions');
  assert.match(attacked.data, new RegExp(contextMarker));
  assert.match(attacked.data, new RegExp(pathMarker));
  assert.doesNotMatch(attacked.system, new RegExp(`${contextMarker}|${pathMarker}`));
  assertRawArtifactsExcluded(attacked.all);
  assert.doesNotMatch(attacked.all, /"proofPolicy"\s*:\s*"direct_source"/);
  assert.doesNotMatch(attacked.all, /"budget"\s*:/);
  assertRuntimeOwnedProofPolicy(attacked.system, 'planner');
});

auditedPromptBoundaryTest('Spec 028 T018 — corrected planner receives one bounded revision packet, not repository prose', () => {
  const goal = proposedPromptGoal();
  const args = {
    task: PROMPT_TASK,
    effectiveScope: ['src/**'],
    wrapperTool: 'trace_symbol',
    capabilities: FIXED_CAPABILITIES,
    preservedGoals: [goal],
    revisionRequest: {
      decomposeGoalIds: ['S1'],
      uncoveredRequestParts: [{
        question: 'Is legacyGuard absent?',
        originRefs: ['request:23-57'],
        claimType: 'absence',
        proofCondition: 'Enumerate the bounded registration surface.',
        constraints: [],
      }],
      diagnostics: ['DIAGNOSTIC_DATA_NOT_POLICY'],
    },
  };
  const baseline = assertTwoMessageBoundary(
    promptModule.buildCorrectedPlannerMessages(args),
    'corrected planner',
  );
  const attacked = assertTwoMessageBoundary(promptModule.buildCorrectedPlannerMessages({
    ...args,
    repositoryArtifacts: RAW_REPOSITORY_MARKERS,
    exploratoryMessages: ['EXPLORER_DRAFT_OVERRIDE_POLICY'],
    candidateClaims: ['CANDIDATE_CLAIM_OVERRIDE_POLICY'],
    proofPolicy: 'direct_source',
    revisionCount: 99,
  }), 'corrected planner');

  assert.equal(attacked.system, baseline.system);
  assert.match(attacked.data, /S1/);
  assert.match(attacked.data, /legacyGuard/);
  assert.match(attacked.data, /DIAGNOSTIC_DATA_NOT_POLICY/);
  assert.match(attacked.system, /one|single|final/i);
  assert.match(attacked.system, /no (?:further|additional|recursive)|must not re.?plan/i);
  assertRawArtifactsExcluded(attacked.all);
  assert.doesNotMatch(attacked.all,
    /EXPLORER_DRAFT_OVERRIDE_POLICY|CANDIDATE_CLAIM_OVERRIDE_POLICY/);
  assert.doesNotMatch(attacked.all, /"revisionCount"\s*:\s*99/);
  assertRuntimeOwnedProofPolicy(attacked.system, 'corrected planner');
});

auditedPromptBoundaryTest('Spec 028 T018 — goal auditor sees only request control data and cannot relax policy', () => {
  const goal = proposedPromptGoal();
  const args = {
    task: PROMPT_TASK,
    effectiveScope: ['src/**'],
    wrapperTool: 'trace_symbol',
    capabilities: FIXED_CAPABILITIES,
    proposals: [goal],
    preflightDiagnostics: [],
    revisionCount: 0,
  };
  const baseline = assertTwoMessageBoundary(
    promptModule.buildGoalAuditorMessages(args),
    'goal auditor',
  );
  const attacked = assertTwoMessageBoundary(promptModule.buildGoalAuditorMessages({
    ...args,
    repositoryArtifacts: RAW_REPOSITORY_MARKERS,
    projectContext: 'PROJECT_CONTEXT_AUDITOR_OVERRIDE',
    exploratoryMessages: ['EXPLORER_DRAFT_AUDITOR_OVERRIDE'],
    candidateClaims: ['CANDIDATE_CLAIM_AUDITOR_OVERRIDE'],
    confidence: 'high',
    tokenStatistics: { total: 1 },
    effort: 'maximum',
    budget: 'unbounded',
  }), 'goal auditor');

  assert.equal(attacked.system, baseline.system,
    'repository data cannot alter isolated auditor policy');
  assert.match(attacked.data, /Where is requireAuth defined/);
  assert.match(attacked.data, /trace_symbol/);
  assert.match(attacked.data, /repositoryWrite/);
  assertRawArtifactsExcluded(attacked.all);
  assert.doesNotMatch(attacked.all,
    /PROJECT_CONTEXT_AUDITOR_OVERRIDE|EXPLORER_DRAFT_AUDITOR_OVERRIDE|CANDIDATE_CLAIM_AUDITOR_OVERRIDE/);
  assert.doesNotMatch(attacked.all, /"confidence"\s*:|tokenStatistics|"effort"\s*:|"budget"\s*:/);
  assert.match(attacked.system, /original request|request text/i);
  assert.match(attacked.system, /wrapper/i);
  assertRuntimeOwnedProofPolicy(attacked.system, 'goal auditor');
});
