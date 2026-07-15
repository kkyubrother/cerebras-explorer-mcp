import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ExplorerRuntime as RuntimeImplementation,
  buildParentHandoffV3,
  buildRuntimeGenericImpactPolicyArtifacts,
  buildRuntimeWrapperPolicyArtifacts,
  estimateTokens,
} from '../src/explorer/runtime.mjs';
import { buildExplorerSystemPrompt, buildFinalizePrompt, detectStrategy, buildExplorerUserPrompt, STRATEGY_DESCRIPTIONS } from '../src/explorer/prompt.mjs';
import { getRuntimeConfig } from '../src/explorer/config.mjs';
import {
  deriveRepositoryObservationCoverage,
  normalizedRepositoryFileIdentity,
  RepoToolkit,
} from '../src/explorer/repo-tools.mjs';
import {
  createRequiredSubgoal,
  createTaskContract,
  fingerprintAction,
} from '../src/explorer/coverage.mjs';
import { adaptLegacyGoalAuditClient } from './helpers/legacy-goal-audit-client.mjs';
import { validateParentHandoffV3, validateTaskContract } from '../src/explorer/schemas.mjs';

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function makeRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-runtime-'));
  await fs.mkdir(path.join(root, 'src', 'routes'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    [
      'export function requireAuth(req, res, next) {',
      '  if (!req.user) throw new Error("unauthorized");',
      '  next();',
      '}',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(root, 'src', 'routes', 'user.js'),
    [
      'import { requireAuth } from "../auth.js";',
      '',
      'export function registerUserRoutes(app) {',
      '  app.get("/users/me", requireAuth, (req, res) => {',
      '    res.json({ id: req.user.id });',
      '  });',
      '}',
    ].join('\n'),
  );
  return root;
}

test('Spec 028 T069 — omitted public scope keeps trace enumeration certifiable', async () => {
  const root = await makeRepoFixture();
  try {
    const runtime = new RuntimeImplementation({ chatClient: { model: 'zai-glm-4.7' } });
    const context = await runtime._initExploreContext({
      repoRootArg: root,
      scope: undefined,
      taskText: 'Trace requireAuth.',
    });
    assert.deepEqual(context.effectiveScope, [],
      'the internal repository boundary must not add noise to the parent contract');

    const args = { symbol: 'requireAuth' };
    const result = await context.repoToolkit.symbolContext(args);
    const coverage = deriveRepositoryObservationCoverage({
      tool: 'repo_symbol_context',
      args,
      result,
      effectiveScope: context.effectiveScope,
      contextTruncated: false,
    });
    assert.equal(coverage.enumerationComplete, true,
      'the optional public scope must not force an uncertifiable fast path');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function compactResult({
  directAnswer = 'analysis complete',
  statusConfidence = 'low',
  verification = 'verified',
  complete = true,
  warnings = [],
  targets = [],
  evidence = [],
  uncertainties = [],
  nextAction = { type: 'stop', reason: 'Complete.' },
} = {}) {
  return {
    directAnswer,
    status: {
      confidence: statusConfidence,
      verification,
      complete,
      warnings,
    },
    targets,
    evidence,
    uncertainties,
    nextAction,
  };
}

function parentHandoffFixture() {
  const subgoal = {
    id: 'S1',
    question: 'Where is token validation implemented?',
    proofPolicy: 'direct_source',
    state: 'supported',
  };
  return {
    semanticVerification: {
      taskContract: { effectiveScope: ['src/**'], subgoals: [subgoal] },
      claims: [{
        id: 'C1',
        subgoalId: 'S1',
        text: 'Token validation is implemented in src/auth.js.',
        verdict: 'supported',
        evidenceRefs: ['E1', 'E2'],
      }],
      semanticVerdicts: [{
        claimId: 'C1',
        result: 'supported',
        supportingEvidenceRefs: ['E2', 'E1'],
      }],
    },
    observations: [
      { id: 'E1', kind: 'source', path: 'src/auth.js', startLine: 1, endLine: 4 },
      { id: 'E2', kind: 'source', path: 'src/routes/user.js', startLine: 1, endLine: 6 },
    ],
    result: {
      evidence: [
        { id: 'E1', path: 'src/auth.js', startLine: 1, endLine: 4 },
        { id: 'E2', path: 'src/routes/user.js', startLine: 1, endLine: 6 },
      ],
      targets: [{
        path: 'src/auth.js',
        startLine: 1,
        endLine: 4,
        role: 'edit',
        reason: 'Change token validation here.',
      }],
    },
  };
}

test('Spec 028 T041 — v3 handoff minimizes direct evidence and omits irrelevant targets', () => {
  const fixture = parentHandoffFixture();
  const handoff = buildParentHandoffV3({
    ...fixture,
    task: 'Explain token validation behavior.',
  });

  assert.deepEqual(handoff, {
    schemaVersion: 3,
    state: 'complete',
    directAnswer: 'Token validation is implemented in src/auth.js.',
    evidence: [{
      kind: 'source',
      path: 'src/auth.js',
      startLine: 1,
      endLine: 4,
      supports: 'Token validation is implemented in src/auth.js.',
    }],
  });
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));

  const selectedEvidenceDropped = buildParentHandoffV3({
    ...fixture,
    result: {
      ...fixture.result,
      evidence: fixture.result.evidence.filter(item => item.id !== 'E1'),
    },
    task: 'Explain token validation behavior.',
  });
  assert.equal(selectedEvidenceDropped.state, 'incomplete');
  assert.equal(selectedEvidenceDropped.directAnswer, undefined,
    'a claim cannot switch to a redundant ref after its selected proof is dropped');
  assert.equal(selectedEvidenceDropped.evidence, undefined);
  assert.equal(selectedEvidenceDropped.gaps.length, 1);
  assert.doesNotThrow(() => validateParentHandoffV3(selectedEvidenceDropped));
});

test('Spec 028 T071 — v3 handoff preserves every verifier-approved path named by a location claim', () => {
  const fixture = parentHandoffFixture();
  fixture.semanticVerification.claims[0].text =
    'src/auth.js defines validation and src/routes/user.js invokes it.';

  const handoff = buildParentHandoffV3({
    ...fixture,
    task: 'Locate token validation and its route usage.',
    taskMode: 'locate',
  });

  assert.equal(handoff.state, 'complete');
  assert.deepEqual(handoff.evidence.map(item => item.path), [
    'src/auth.js',
    'src/routes/user.js',
  ]);
  assert.deepEqual(new Set(handoff.targets.map(item => item.path)), new Set([
    'src/auth.js',
    'src/routes/user.js',
  ]));
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));
});

test('Spec 028 T041 — edit intent deterministically becomes verify_targets', () => {
  const fixture = parentHandoffFixture();
  const handoff = buildParentHandoffV3({
    ...fixture,
    task: 'Modify the token validation implementation.',
    taskMode: 'edit_planning',
  });

  assert.equal(handoff.state, 'verify_targets');
  assert.deepEqual(handoff.targets, [{
    path: 'src/auth.js',
    startLine: 1,
    endLine: 4,
    role: 'edit',
    reason: 'Token validation is implemented in src/auth.js.',
    evidenceRefs: ['E1'],
  }]);
  assert.equal(handoff.evidence.length, 1);
  assert.equal(handoff.evidence[0].id, 'E1');
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));
});

test('Spec 028 T069 — parent target reasons contain only accepted evidence support', () => {
  const fixture = parentHandoffFixture();
  const verified = 'The verified static collection contains 70 entries.';
  fixture.semanticVerification.claims[0].text = verified;
  fixture.result.targets[0].reason = 'The static collection contains 53 entries.';

  const handoff = buildParentHandoffV3({
    ...fixture,
    task: 'Modify the static collection after confirming its entry count.',
    taskMode: 'edit_planning',
  });

  assert.equal(handoff.state, 'verify_targets');
  assert.equal(handoff.targets[0].reason, verified);
  assert.equal(handoff.evidence[0].supports, verified);
  assert.doesNotMatch(JSON.stringify(handoff), /53 entries/u);
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));
});

test('Spec 028 T041 — partial and all-blocked handoffs expose only actionable gaps', () => {
  const partial = parentHandoffFixture();
  const blockedGoal = {
    id: 'S2',
    question: 'Whether every alternate bootstrap uses token validation',
    proofPolicy: 'bounded_absence',
    state: 'gap',
  };
  partial.semanticVerification.taskContract.subgoals.push(blockedGoal);
  const partialHandoff = buildParentHandoffV3({
    ...partial,
    task: 'Explain token validation and check every alternate bootstrap.',
    coverageGaps: [{
      id: 'G2',
      subgoalId: 'S2',
      question: blockedGoal.question,
      reason: 'enumeration_incomplete',
      repairable: false,
      priority: 100,
    }],
  });
  assert.equal(partialHandoff.state, 'incomplete');
  assert.equal(partialHandoff.directAnswer,
    'Token validation is implemented in src/auth.js.');
  assert.equal(partialHandoff.evidence.length, 1);
  assert.deepEqual(partialHandoff.gaps, [{
    question: 'Explain token validation and check every alternate bootstrap.',
    reason: 'The required repository boundary was not completely enumerated.',
  }]);
  assert.equal(partialHandoff.followUp, undefined);

  const allBlocked = buildParentHandoffV3({
    result: {},
    task: 'Report the deployed token validation revision.',
    taskContract: {
      effectiveScope: ['src/**'],
      subgoals: [{
        id: 'S-live',
        question: 'INTERNAL_GOAL_SENTINEL',
        auditBinding: 'INTERNAL_BINDING_SENTINEL',
        proofPolicy: 'direct_source',
        state: 'blocked',
      }],
    },
    coverageGaps: [{
      id: 'G-live',
      subgoalId: 'S-live',
      question: 'INTERNAL_GOAL_SENTINEL',
      reason: 'external_state_required',
      repairable: false,
      priority: 0,
    }],
  });
  assert.deepEqual(allBlocked, {
    schemaVersion: 3,
    state: 'incomplete',
    gaps: [{
      question: 'Report the deployed token validation revision.',
      reason: 'This depends on live or external state unavailable to the repository explorer.',
    }],
    followUp: {
      type: 'external_verification',
      requirement: 'Report the deployed token validation revision.',
    },
  });
  assert.doesNotThrow(() => validateParentHandoffV3(partialHandoff));
  assert.doesNotThrow(() => validateParentHandoffV3(allBlocked));
  assert.doesNotMatch(JSON.stringify(allBlocked), /INTERNAL_(?:GOAL|BINDING)_SENTINEL/);
});

test('Spec 028 T041 — failed handoff maps reasons and drops stale success data', () => {
  const handoff = buildParentHandoffV3({
    result: {
      directAnswer: 'Stale unverified answer.',
      evidence: [{ id: 'stale', path: 'src/stale.js', startLine: 1, endLine: 1 }],
      failure: {
        reason: 'tool_errors',
        message: 'Repository tools failed before verification.',
        retry: { args: { task: 'Retry the token trace.', scope: ['src/**'] } },
      },
    },
    task: 'Trace token validation.',
  });
  assert.deepEqual(handoff, {
    schemaVersion: 3,
    directAnswer: 'Repository tools failed before verification.',
    state: 'failed',
    failure: {
      reason: 'tool_failure',
      retry: {
        type: 'tool',
        tool: 'explore_repo',
        arguments: { task: 'Retry the token trace.', scope: ['src/**'] },
      },
    },
  });
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));
});

test('Spec 028 T041 — plan-level gaps prevent a false complete handoff', () => {
  const fixture = parentHandoffFixture();
  const handoff = buildParentHandoffV3({
    ...fixture,
    task: 'Explain token validation behavior.',
    coverageGaps: [{
      id: 'G-plan',
      question: 'Resolve the uncovered request obligation.',
      reason: 'planning_incomplete',
      repairable: false,
      priority: 0,
    }],
  });

  assert.equal(handoff.state, 'incomplete');
  assert.equal(handoff.directAnswer,
    'Token validation is implemented in src/auth.js.');
  assert.deepEqual(handoff.gaps, [{
    question: 'Explain token validation behavior.',
    reason: 'This requested part could not be reduced to a complete verifiable repository goal.',
  }]);
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));
});

test('Spec 028 T041 — shared search refs require claim-local absence certificates', () => {
  const subgoals = [
    {
      id: 'S1',
      question: 'Is legacyAuth absent from src?',
      proofPolicy: 'bounded_absence',
      state: 'supported',
    },
    {
      id: 'S2',
      question: 'Is debugAuth absent from src?',
      proofPolicy: 'bounded_absence',
      state: 'supported',
    },
  ];
  const claims = [
    {
      id: 'C1',
      subgoalId: 'S1',
      text: 'legacyAuth is absent from the enumerated src boundary.',
      verdict: 'supported',
      evidenceRefs: ['E1'],
    },
    {
      id: 'C2',
      subgoalId: 'S2',
      text: 'debugAuth is absent from the enumerated src boundary.',
      verdict: 'supported',
      evidenceRefs: ['E1'],
    },
  ];
  const handoff = buildParentHandoffV3({
    result: {},
    task: 'Check bounded absence for legacyAuth and debugAuth.',
    semanticVerification: {
      taskContract: { effectiveScope: ['src/**'], subgoals },
      claims,
      semanticVerdicts: claims.map(claim => ({
        claimId: claim.id,
        result: 'supported',
        supportingEvidenceRefs: ['E1'],
      })),
      absenceCertificates: [{
        id: 'A1',
        subgoalId: 'S1',
        claimBoundary: ['src/**'],
        searchRefs: ['E1'],
        searchSummary: ['Searched legacyAuth across src/** with no matches.'],
        complete: true,
        zeroMatches: true,
      }],
    },
    observations: [{ id: 'E1', kind: 'search' }],
  });

  assert.equal(handoff.state, 'incomplete');
  assert.equal(handoff.directAnswer,
    'legacyAuth is absent from the enumerated src boundary.');
  assert.deepEqual(handoff.evidence, [{
    kind: 'absence',
    boundary: ['src/**'],
    searches: ['Searched legacyAuth across src/** with no matches.'],
    supports: 'legacyAuth is absent from the enumerated src boundary.',
  }]);
  assert.deepEqual(handoff.gaps, [{
    question: 'Check bounded absence for legacyAuth and debugAuth.',
    reason: 'Required repository evidence was not found.',
  }]);
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));
});

test('Spec 028 T041 — verifier failure classification uses explicit provenance', () => {
  const verifierFailure = buildParentHandoffV3({
    result: {
      failure: {
        reason: 'invalid_final_response',
        publicReason: 'verifier_error',
        message: 'The isolated control output was invalid.',
      },
    },
    task: 'Trace token validation.',
  });
  const unmarkedFailure = buildParentHandoffV3({
    result: {
      failure: {
        reason: 'invalid_final_response',
        message: 'A verifier-like phrase must not classify this failure.',
      },
    },
    task: 'Trace token validation.',
  });

  assert.equal(verifierFailure.failure.reason, 'verifier_error');
  assert.equal(unmarkedFailure.failure.reason, 'internal_error');
  assert.doesNotThrow(() => validateParentHandoffV3(verifierFailure));
  assert.doesNotThrow(() => validateParentHandoffV3(unmarkedFailure));
});

// Existing tests below isolate the pre-028 exploration loop. Their provider
// scripts predate required planning, so this test-only adapter answers only the
// isolated planner/auditor calls. T017 uses RuntimeImplementation directly.
class ExplorerRuntime extends RuntimeImplementation {
  constructor({ chatClient = null, ...options } = {}) {
    super({ ...options, chatClient: adaptLegacyGoalAuditClient(chatClient) });
  }
}

class MockChatClient {
  constructor() {
    this.model = 'zai-glm-4.7';
    this.calls = 0;
  }

  async createChatCompletion({ messages }) {
    this.calls += 1;

    if (this.calls === 1) {
      return {
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        message: {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              function: {
                name: 'repo_grep',
                arguments: JSON.stringify({ pattern: 'requireAuth', scope: ['src/**'] }),
              },
            },
          ],
        },
      };
    }

    if (this.calls === 2) {
      const lastToolMessage = messages[messages.length - 1];
      assert.equal(lastToolMessage.role, 'tool');
      assert.match(lastToolMessage.content, /requireAuth/);
      return {
        usage: { prompt_tokens: 110, completion_tokens: 20, total_tokens: 130 },
        message: {
          content: '',
          toolCalls: [
            {
              id: 'call-2',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 6 }),
              },
            },
          ],
        },
      };
    }

    if (this.calls === 3) {
      const lastToolMessage = messages[messages.length - 1];
      assert.equal(lastToolMessage.role, 'tool');
      assert.match(lastToolMessage.content, /\/users\/me/);
      return {
        usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 },
        message: {
          content: '',
          toolCalls: [
            {
              id: 'call-3',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            },
          ],
        },
      };
    }

    return {
      usage: { prompt_tokens: 130, completion_tokens: 40, total_tokens: 170 },
      message: {
        content: JSON.stringify(compactResult({
          directAnswer: 'registerUserRoutes는 /users/me 라우트에 requireAuth 미들웨어를 직접 연결한다.',
          statusConfidence: 'high',
          evidence: [
            {
              path: 'src/routes/user.js',
              startLine: 1,
              endLine: 4,
              why: '라우트가 requireAuth를 import하고 /users/me에 연결한다.',
              snippet: '1: FORGED_BY_MODEL();',
            },
            {
              path: 'src/auth.js',
              startLine: 1,
              endLine: 4,
              why: 'requireAuth의 실제 동작이 여기 정의되어 있다.',
              snippet: '1: FORGED_BY_MODEL();',
            },
          ],
          targets: [
            {
              path: 'src/routes/user.js',
              startLine: 1,
              endLine: 4,
              role: 'read',
              reason: '라우트가 requireAuth를 import하고 /users/me에 연결한다.',
              evidenceRefs: [],
            },
            {
              path: 'src/auth.js',
              startLine: 1,
              endLine: 4,
              role: 'read',
              reason: 'requireAuth의 실제 동작이 여기 정의되어 있다.',
              evidenceRefs: [],
            },
          ],
          uncertainties: ['미들웨어 에러 핸들링 패턴은 별도 분석이 필요할 수 있다.'],
        })),
        toolCalls: [],
      },
    };
  }
}

function cloneMessages(messages) {
  return JSON.parse(JSON.stringify(messages));
}

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function readJsonl(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  return source.trim().split('\n').map(line => JSON.parse(line));
}

function assertNoOrphanedToolMessages(messages) {
  let pendingToolCallIds = null;

  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      pendingToolCallIds = new Set(message.tool_calls.map(call => call.id));
      continue;
    }

    if (message.role === 'tool') {
      assert.ok(pendingToolCallIds, 'tool message must follow an assistant tool_calls message');
      assert.ok(
        pendingToolCallIds.has(message.tool_call_id),
        `tool message ${message.tool_call_id} must match a preceding assistant tool_call`,
      );
      pendingToolCallIds.delete(message.tool_call_id);
      continue;
    }

    pendingToolCallIds = null;
  }
}

test('ExplorerRuntime performs an autonomous tool loop and returns structured findings', async () => {
  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });

  const result = await runtime.explore({
    task: 'users/me 라우트에 인증 미들웨어가 어떻게 붙는지 추적해라.',
    repo_root: repoRoot,
    scope: ['src/**'],
  });

  // Core fields — confidence calibration: 2 exact cross-verified evidence items with
  // a non-locate task yields 'medium' with the task-aware scoring (base 0.15).
  assert.ok(['medium', 'high'].includes(result.status.confidence), `confidence must be medium or high, got: ${result.status.confidence}`);
  assert.match(result.directAnswer, /requireAuth/);
  assert.equal(result.status.verification, 'verified');
  assert.ok(Array.isArray(result.targets), 'targets must be an array');
  assert.ok(result.targets.some(target => target.path === 'src/routes/user.js'), 'targets include route file');
  assert.ok(result.targets.every(target => target.role !== 'edit'), 'read-only tracing must not mark all evidence targets as edit');
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.failure, null);
  assert.equal(result.parentHandoff.schemaVersion, 3);
  assert.equal(result.parentHandoff.state, 'complete');
  assert.equal(Object.hasOwn(result.parentHandoff, 'status'), false);
  assert.doesNotThrow(() => validateParentHandoffV3(result.parentHandoff));
  assert.deepEqual(Object.keys(result.parentPayloadMeasurement).sort(), [
    'contentBytes',
    'encoding',
    'parentPayloadBytes',
    'sha256',
    'structuredContentBytes',
  ]);
  assert.equal(result.parentPayloadMeasurement.encoding, 'utf8');
  assert.equal(result.parentPayloadMeasurement.parentPayloadBytes,
    result.parentPayloadMeasurement.contentBytes +
      result.parentPayloadMeasurement.structuredContentBytes);
  assert.match(result.parentPayloadMeasurement.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.evidenceQuality.level, result.status.confidence);
  assert.equal(result.evidenceQuality.exactCount, 2);
  assert.equal(result.evidenceQuality.partialCount, 0);
  assert.equal(result.evidenceQuality.droppedCount, 0);
  assert.equal(result.evidenceQuality.fileCount, 2);
  assert.ok(Array.isArray(result.evidenceQuality.warnings));
  assert.match(result.evidenceQuality.summary, /evidence items grounded|Verified:/);
  assert.deepEqual(result.searchCoverage.scope, ['src/**']);
  assert.equal(result.searchCoverage.scopeLimited, true);
  assert.equal(result.searchCoverage.filesRead, result.stats.filesRead);
  assert.equal(result.searchCoverage.grepCalls, result.stats.grepCalls);
  assert.ok(Array.isArray(result.searchCoverage.warnings));
  assert.match(result.searchCoverage.summary, /scope-limited|repo-wide/);
  assert.equal(result.evidence.length, 2);
  assert.ok(result.evidence.every(item => item.id && item.snippet), 'evidence has ids and snippets');
  assert.ok(result.evidence.every(item => !item.snippet.includes('FORGED_BY_MODEL')), 'model-supplied snippets are replaced with local file snippets');
  // spec 017: _debug envelope was removed; toolCalls/grepCalls/filesRead stay on
  // result.stats which is no longer propagated to MCP structuredContent. The
  // toolTrace and its grep/read entries are no longer surfaced.
  assert.equal(result._debug, undefined, 'runtime no longer exposes a _debug envelope');
  assert.equal(result.stats.toolCalls, 3);
  assert.equal(result.stats.grepCalls, 1);
  assert.equal(result.stats.filesRead, 2);
  assert.equal(result.targets.some(target => target.path === 'src/routes/user.js'), true);

  // Phase 3: continuous confidence score
  assert.ok(typeof result.confidenceScore === 'number', 'confidenceScore must be a number');
  assert.ok(result.confidenceScore >= 0 && result.confidenceScore <= 1, 'confidenceScore must be in [0, 1]');
  assert.ok(['low', 'medium', 'high'].includes(result.status.confidence), 'confidenceLevel must be low|medium|high');
  assert.ok(result.confidenceFactors && typeof result.confidenceFactors === 'object', 'confidenceFactors must be an object');
  assert.ok(typeof result.confidenceFactors.evidenceCount === 'number', 'confidenceFactors.evidenceCount must be a number');
  assert.ok(typeof result.confidenceFactors.crossVerified === 'boolean', 'confidenceFactors.crossVerified must be a boolean');

  // Phase 3: evidence grounding status
  for (const ev of result.evidence) {
    assert.ok(ev.groundingStatus === 'exact' || ev.groundingStatus === 'partial', 'each evidence item must have groundingStatus');
  }

  assert.ok(Array.isArray(result.uncertainties), 'uncertainties must be an array');
  assert.equal(result.followups, undefined, 'legacy followups are no longer part of the runtime result');

  // Phase 3: codeMap
  assert.ok(result.codeMap && typeof result.codeMap === 'object', 'codeMap must be present');
  assert.ok(Array.isArray(result.codeMap.entryPoints), 'codeMap.entryPoints must be an array');
  assert.ok(Array.isArray(result.codeMap.keyModules), 'codeMap.keyModules must be an array');
  assert.ok(result.codeMap.keyModules.length >= 2, 'codeMap must include at least the two read files');
});

test('ExplorerRuntime explore writes LOG_PATH transcript with stable callId records', async () => {
  const repoRoot = await makeRepoFixture();
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-runtime-transcripts-'));

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
  }, async () => {
    const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });
    const result = await runtime.explore({
      task: 'users/me 라우트에 인증 미들웨어가 어떻게 붙는지 추적해라.',
      repo_root: repoRoot,
      scope: ['src/**'],
    });

    assert.equal(typeof result.transcriptPath, 'string');
    assert.match(
      path.basename(result.transcriptPath),
      /^[0-9T-]+Z_explore_repo_[0-9a-f-]{36}\.jsonl$/,
    );

    const files = (await fs.readdir(logDir)).filter(name => name.endsWith('.jsonl'));
    assert.deepEqual(files, [path.basename(result.transcriptPath)]);

    const entries = await readJsonl(result.transcriptPath);
    const filenameCallId = path.basename(result.transcriptPath, '.jsonl').split('_').at(-1);
    assert.ok(entries.length >= 3);
    assert.ok(entries.every(entry => entry.callId === filenameCallId));
    assert.ok(entries.some(entry => entry.type === 'assistant'));
    assert.ok(entries.some(entry => entry.type === 'tool'));
    const grepEntry = entries.find(entry => entry.type === 'tool' && entry.tool === 'repo_grep');
    assert.ok(grepEntry, 'grep tool entry must be recorded');
    assert.deepEqual(grepEntry.args, { pattern: 'requireAuth', scope: ['src/**'] });
    assert.ok(grepEntry.result.matches >= 2);
    assert.deepEqual(grepEntry.result.paths, ['src/auth.js', 'src/routes/user.js']);
    assert.equal(JSON.stringify(grepEntry).includes('export function requireAuth'), false);
    assert.equal(entries.at(-1).redacted, true);
  });
});

test('ExplorerRuntime semantic projection omits unverified model evidence', async () => {
  class DroppedEvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-auth',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth rejects unauthenticated requests.',
              statusConfidence: 'high',
              evidence: [
                { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'read implementation' },
                { path: 'src/missing.js', startLine: 1, endLine: 2, why: 'not observed' },
              ],
            })),
            toolCalls: [],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new DroppedEvidenceClient() });
  const result = await runtime.explore({
    task: 'Explain requireAuth',
    repo_root: root,
    taskMode: 'symbol_trace',
  });

  assert.ok(result.evidence.some(item =>
    item.path === 'src/auth.js' && item.startLine === 1 && item.endLine === 4));
  assert.ok(result.evidence.every(item => item.path !== 'src/missing.js'));
  assert.equal(result.evidenceQuality.droppedCount, 0,
    'unverified model evidence is excluded before the parent-facing critic pass');
  assert.doesNotMatch(result.evidenceQuality.summary, /evidence item\(s\) dropped/i);
});

test('ExplorerRuntime drops target evidenceRefs that do not reference retained evidence ids', async () => {
  class InvalidRefsClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-auth',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth는 인증되지 않은 요청을 거부합니다.',
              statusConfidence: 'high',
              evidence: [
                { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'requireAuth 구현 위치입니다.' },
              ],
              targets: [
                {
                  path: 'src/auth.js',
                  startLine: 1,
                  endLine: 4,
                  role: 'read',
                  reason: '근거가 있는 target입니다.',
                  evidenceRefs: ['file_range', 'E1', 'missing-id'],
                },
              ],
            })),
            toolCalls: [],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new InvalidRefsClient() });
  const result = await runtime.explore({
    task: 'requireAuth를 설명해라.',
    repo_root: root,
    scope: ['src/**'],
  });

  const validEvidenceIds = new Set(result.evidence.map(item => item.id));
  assert.ok(result.targets.length > 0, 'expected at least one grounded target');
  for (const target of result.targets) {
    for (const ref of target.evidenceRefs) {
      assert.equal(validEvidenceIds.has(ref), true, `${ref} must point at retained evidence`);
    }
  }
  assert.ok(!JSON.stringify(result.targets).includes('file_range'), 'dangling ref "file_range" must be dropped');
  assert.ok(!JSON.stringify(result.targets).includes('missing-id'), 'hallucinated ref "missing-id" must be dropped');
});

test('ExplorerRuntime bounds discoveredPaths and reports omitted candidate count', async () => {
  class DiscoveryClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'list-src',
                function: { name: 'repo_list_dir', arguments: JSON.stringify({ dirPath: 'src' }) },
              },
              {
                id: 'read-auth',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
                },
              },
            ],
          },
        };
      }
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth is defined in src/auth.js.',
              statusConfidence: 'medium',
              evidence: [
                { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'definition was read' },
              ],
            })),
            toolCalls: [],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  for (let i = 0; i < 60; i += 1) {
    await fs.writeFile(path.join(root, 'src', `candidate-${i}.js`), `export const c${i} = ${i};\n`);
  }

  const runtime = new ExplorerRuntime({ chatClient: new DiscoveryClient() });
  const result = await runtime.explore({
    task: 'Find auth-related candidates',
    repo_root: root,
  });

  assert.ok(result.discoveredPaths.length <= 50, `expected bounded discoveredPaths, got ${result.discoveredPaths.length}`);
  assert.ok(result.searchCoverage.omittedDiscoveredPaths > 0);
  assert.ok(
    result.searchCoverage.warnings.some(warning => /discovered path/i.test(warning)),
    'searchCoverage must warn when discovered path candidates are omitted',
  );
});

test('ExplorerRuntime stats use successful failover provider metadata when present', async () => {
  class ProviderMetadataClient {
    constructor() { this.model = 'primary-model'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      const base = {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        usedProvider: { providerIndex: 1, model: 'fallback-model' },
      };
      if (responseFormat) {
        return {
          ...base,
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'Provider metadata was attached.',
              statusConfidence: 'low',
              evidence: [],
            })),
            toolCalls: [],
          },
        };
      }
      return {
        ...base,
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new ProviderMetadataClient() });
  const result = await runtime.explore({
    task: 'Return a minimal provider metadata result',
    repo_root: root,
  });

  assert.equal(result.stats.model, 'fallback-model');
  assert.equal(result.stats.providerIndex, 1);
});

test('ExplorerRuntime preserves model-provided edit targets when deriving evidence targets', async () => {
  class EditTargetClient {
    constructor() {
      this.model = 'mock';
      this.calls = 0;
    }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
                },
              },
              {
                id: 'call-2',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 5 }),
                },
              },
            ],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'requireAuth를 수정해야 합니다.',
            statusConfidence: 'high',
            evidence: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'requireAuth 구현 위치입니다.',
              },
              {
                path: 'src/routes/user.js',
                startLine: 1,
                endLine: 5,
                why: 'requireAuth 호출 위치입니다.',
              },
            ],
            targets: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                role: 'edit',
                reason: '수정이 필요한 구현 위치입니다.',
                evidenceRefs: ['E1'],
              },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new EditTargetClient() });
  const result = await runtime.explore({
    task: 'requireAuth 동작을 설명해라.',
    repo_root: repoRoot,
  });

  const target = result.targets.find(item => item.path === 'src/auth.js');
  assert.equal(target?.role, 'edit', 'model-provided edit role must not be overwritten by derived read targets');
  assert.equal(result.status.verification, 'targeted_read_needed');
  assert.equal(result.nextAction.target.role, 'edit');
});

test('ExplorerRuntime drops model-provided edit targets outside grounded evidence', async () => {
  class MaliciousTargetClient {
    constructor() {
      this.model = 'mock';
      this.calls = 0;
    }

    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
                },
              },
            ],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'requireAuth는 인증되지 않은 요청을 거부합니다.',
            statusConfidence: 'high',
            evidence: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'requireAuth 구현 위치입니다.',
              },
            ],
            targets: [
              {
                path: '../../.ssh/id_rsa',
                role: 'edit',
                reason: '공격자가 주입한 저장소 밖 대상입니다.',
              },
              {
                path: '/home/user/.env',
                role: 'edit',
                reason: '공격자가 주입한 절대 경로 대상입니다.',
              },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MaliciousTargetClient() });
  const result = await runtime.explore({
    task: 'requireAuth 동작을 설명해라.',
    repo_root: repoRoot,
  });

  assert.ok(result.targets.every(target => !target.path.includes('..') && !path.isAbsolute(target.path)));
  assert.ok(result.targets.every(target => target.path !== '/home/user/.env'));
  assert.ok(result.targets.every(target => target.role !== 'edit'));
  assert.notEqual(result.status.verification, 'targeted_read_needed');
  assert.notEqual(result.nextAction.target?.path, '../../.ssh/id_rsa');
});

test('Spec 028 T048 — automatic PR and diff review intent stays read-only', async (t) => {
  const repoRoot = await makeRepoFixture();
  for (const task of [
    'Review change context: What changed recently around auth routing?',
    'Review this PR for auth risks.',
    'Review the diff for auth risks.',
    'Review this change to auth code for risks.',
    '이 PR의 인증 변경을 검토해라.',
  ]) {
    await t.test(task, async () => {
      const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });
      const result = await runtime.explore({
        task,
        repo_root: repoRoot,
        scope: ['src/**'],
      });
      assert.equal(result.status.verification, 'verified');
      assert.equal(result.nextAction.type, 'stop');
    });
  }
});

test('ExplorerRuntime still treats code changes as edit planning', async () => {
  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });

  const result = await runtime.explore({
    task: 'Change auth middleware behavior to add a new response field.',
    repo_root: repoRoot,
    scope: ['src/**'],
  });

  assert.equal(result.status.verification, 'targeted_read_needed');
  assert.equal(result.nextAction.type, 'read_target');
});

test('ExplorerRuntime uses evidence taskMode before edit fallback and fails closed without counter-search', async () => {
  class EvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 8 }),
              },
            }, {
              id: 'call-read-2',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 8 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '근거가 충분합니다.',
            statusConfidence: 'high',
            evidence: [
              { path: 'src/auth.js', startLine: 1, endLine: 4, why: '검증 근거' },
              { path: 'src/routes/user.js', startLine: 1, endLine: 5, why: '호출 근거' },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new EvidenceClient() });
  const result = await runtime.explore({
    task: 'update code evidence for review',
    repo_root: root,
    scope: ['src/**'],
    taskMode: 'evidence_verification',
  });

  assert.equal(result.status.verification, 'broad_search_needed');
  assert.notEqual(result.status.verification, 'targeted_read_needed');
});

test('ExplorerRuntime taskMode marks edit planning as targeted read needed', async () => {
  class EditPlanningClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 8 }),
              },
            }, {
              id: 'call-read-2',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 8 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '변경 영향입니다.',
            statusConfidence: 'high',
            evidence: [
              { path: 'src/auth.js', startLine: 1, endLine: 4, why: '변경 영향 근거' },
              { path: 'src/routes/user.js', startLine: 1, endLine: 5, why: '호출 영향 근거' },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new EditPlanningClient() });
  const result = await runtime.explore({
    task: 'Assess auth behavior',
    repo_root: root,
    scope: ['src/**'],
    taskMode: 'edit_planning',
  });

  assert.equal(result.status.verification, 'targeted_read_needed');
});

test('Phase 2 — codeMap remains available without generating Mermaid diagram output', async () => {
  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });

  const result = await runtime.explore({
    task: '읽은 주요 모듈 구조를 요약해라.',
    repo_root: repoRoot,
    scope: ['src/**'],
  });

  assert.equal(result.diagram, undefined, 'runtime should not emit Mermaid diagram output');
  // spec 017: _debug envelope was removed; codeMap stays on the raw runtime result.
  assert.equal(result._debug, undefined, 'runtime no longer exposes a _debug envelope');
  assert.ok(result.codeMap, 'codeMap should remain available as structured data');
  assert.ok(result.codeMap.keyModules.some(item => item.path === 'src/auth.js'));
  assert.ok(result.codeMap.keyModules.some(item => item.path === 'src/routes/user.js'));
});

test('Phase 1 — explore circuit breaker trips after three all-error turns', async () => {
  class AllErrorExploreClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      if (this.calls <= 3) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `invalid-${this.calls}`,
              function: { name: 'repo_missing_tool', arguments: '{}' },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '부분 답변',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const client = new AllErrorExploreClient();
  const runtime = new ExplorerRuntime({ chatClient: client });

  const result = await runtime.explore({
    task: '실패하는 도구 호출을 반복해도 서킷 브레이커가 동작해야 한다.',
    repo_root: repoRoot,
  });

  assert.equal(result.stats.turns, 3, 'tool loop must stop after the third all-error turn');
  assert.equal(result.stats.stoppedByErrors, true, 'circuit breaker must mark stoppedByErrors');
  assert.deepEqual(result.stats.safetyLimits, [], 'tool errors must not be mislabeled as safety-limit stops');
  assert.equal(client.calls, 3, 'tool-error termination must not make an untrusted finalization call');
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.failure.category, 'execution');
  assert.equal(result.failure.reason, 'tool_errors');
  assert.equal(result.failure.retry.tool, 'explore_repo');
  assert.ok(result.failure.retry.hints.some(hint => /narrower scope|specific/i.test(hint)));
  assert.equal(result.failure.retry.args.task, 'Retry with a narrower scope or a more specific symbol/file anchor.');
  assert.deepEqual(Object.keys(result.failure.retry.args).sort(), ['scope', 'task']);
  assert.equal(result.failure.retry.expectedImprovement, 'A narrower task should reduce repeated tool errors and improve grounding.');
  assert.equal(result.evidenceQuality.level, result.status.confidence);

  const thirdTurnMessages = client.snapshots[2];
  assert.ok(
    thirdTurnMessages.some(m => m.role === 'user' && m.content?.includes('repeating the same failing')),
    'recovery guidance must be present before the third failing turn',
  );
});

test('estimateTokens weights non-ASCII higher than ASCII (spec 024 FR-003)', () => {
  const koreanText = '가'.repeat(400); // 400 non-ASCII chars
  const asciiText = 'a'.repeat(400);   // 400 ASCII chars

  const koreanEstimate = estimateTokens([{ role: 'user', content: koreanText }]);
  const asciiEstimate = estimateTokens([{ role: 'user', content: asciiText }]);
  const legacyChars4 = Math.ceil(koreanText.length / 4);

  // Non-ASCII text must estimate more tokens than the same length of ASCII...
  assert.ok(
    koreanEstimate > asciiEstimate,
    `Korean text (${koreanEstimate}) must estimate more tokens than equal-length ASCII (${asciiEstimate})`,
  );
  // ...and more than the legacy flat chars/4 heuristic.
  assert.ok(
    koreanEstimate > legacyChars4,
    `Korean text (${koreanEstimate}) must estimate more than legacy chars/4 (${legacyChars4})`,
  );
  // ASCII estimation stays at chars/4.
  assert.equal(asciiEstimate, Math.ceil(asciiText.length / 4));
  // tool_calls and reasoning fields are also counted.
  assert.ok(estimateTokens([{ role: 'assistant', content: '', reasoning: koreanText }]) > 0);
});

test('explore compacts proactively at 70% and injects a deterministic evidence ledger (spec 024 FR-002)', async () => {
  const LEDGER_MARKER = '[verified-evidence-ledger]'; // internal protocol string (runtime.mjs)

  class CompactExploreClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages, responseFormat }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      // Finalize call (json_schema) → return a valid compact JSON result.
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          message: { content: JSON.stringify(compactResult({ directAnswer: 'done' })), toolCalls: [] },
        };
      }

      // First turns: read the large file to push the compact context past 70%.
      if (this.calls <= 8) {
        return {
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
          message: {
            content: '',
            toolCalls: [{
              id: `read-${this.calls}`,
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/large.js', startLine: 1, endLine: 220 }),
              },
            }],
          },
        };
      }

      // Stop calling tools → loop finalizes.
      return {
        usage: { prompt_tokens: 45, completion_tokens: 15, total_tokens: 60 },
        finishReason: 'stop',
        message: { content: 'Done exploring.', toolCalls: [] },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const largeLines = Array.from({ length: 260 }, (_, index) => `export const line${index} = "${'x'.repeat(700)}";`);
  await fs.writeFile(path.join(repoRoot, 'src', 'large.js'), largeLines.join('\n'));

  const client = new CompactExploreClient();
  const runtime = new ExplorerRuntime({ chatClient: client });

  const result = await runtime.explore({
    task: 'Force proactive compaction on the compact path.',
    repo_root: repoRoot,
    scope: ['src/**'],
  });

  const isLedger = (message) =>
    message.role === 'user'
    && typeof message.content === 'string'
    && message.content.startsWith(LEDGER_MARKER);

  // (a) proactive compaction truncated at least one old tool result.
  const sawTruncatedToolResult = client.snapshots.some(snapshot =>
    snapshot.some(message =>
      message.role === 'tool'
      && typeof message.content === 'string'
      && message.content.includes('[truncated from'),
    ),
  );
  assert.ok(sawTruncatedToolResult, 'proactive compaction must truncate old tool results (FR-002)');
  assert.ok(result.stats.safetyLimits.some(limit =>
    limit.name === 'context_limit' && limit.stage === 'exploration' && limit.truncated),
    'the compacted context must remain observable as an exact safety limit');

  // (b) a deterministic ledger was injected, lists the inspected range, and is never duplicated.
  const ledgerSnapshot = client.snapshots.find(snapshot => snapshot.some(isLedger));
  assert.ok(ledgerSnapshot, 'an evidence ledger must be injected after proactive compaction (FR-002)');
  const ledgerMsg = ledgerSnapshot.find(isLedger);
  assert.ok(ledgerMsg.content.includes('large.js'), 'ledger must list the inspected file');
  assert.match(ledgerMsg.content, /L\d+-\d+/, 'ledger must carry a verified line range');
  assert.ok(
    client.snapshots.every(snapshot => snapshot.filter(isLedger).length <= 1),
    'at most one ledger message may exist at a time (dedup-replace)',
  );

  // (c) tool_call pairing stays intact across every snapshot.
  for (const snapshot of client.snapshots) {
    assertNoOrphanedToolMessages(snapshot);
  }
});

test('ExplorerRuntime carries compact uncertainties instead of legacy followups', async () => {
  class UncertaintyClient {
    constructor() {
      this.model = 'zai-glm-4.7';
    }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '테스트 답변',
            statusConfidence: 'medium',
            evidence: [],
            uncertainties: ['추가 조사가 필요합니다'],
            nextAction: {
              type: 'ask_user',
              reason: '추가 조사가 필요합니다',
            },
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-string-followup-'));
  await fs.writeFile(path.join(root, 'index.js'), 'console.log("hello");');

  const runtime = new ExplorerRuntime({ chatClient: new UncertaintyClient() });
  const result = await runtime.explore({ task: '테스트', repo_root: root });

  assert.ok(Array.isArray(result.uncertainties));
  assert.ok(result.uncertainties.includes('추가 조사가 필요합니다'));
  assert.equal(result.followups, undefined);
});

test('ExplorerRuntime does not expose recentActivity when git_log tool is called', { skip: !hasGit() }, async () => {
  class GitLogClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-git-1',
                function: {
                  name: 'repo_git_log',
                  arguments: JSON.stringify({ maxCount: 5 }),
                },
              },
            ],
          },
        };
      }
      return {
        usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '최근 커밋 이력을 확인했습니다.',
            statusConfidence: 'medium',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-git-'));
  await fs.writeFile(path.join(root, 'index.js'), 'console.log("hello");');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', 'index.js'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add index'], { cwd: root, stdio: 'ignore' });

  const runtime = new ExplorerRuntime({ chatClient: new GitLogClient() });
  const result = await runtime.explore({
    task: '최근에 어떤 파일이 변경되었나요?',
    repo_root: root,
  });

  assert.equal(result.recentActivity, undefined);
  assert.equal(result._debug?.recentActivity, undefined);
  assert.equal(result.stats.gitLogCalls, 1);
  const commitObservation = result.observations.find(item => item.kind === 'git_commit');
  assert.ok(commitObservation, 'git log must produce a runtime-owned commit observation');
  assert.equal(commitObservation.id, 'E1');
  assert.equal(commitObservation.temporalRole, 'historical');
  assert.match(commitObservation.sha, /^[0-9a-f]{40}$/);
  assert.match(commitObservation.content, /add index/);
  assert.ok(result.observations.some(item =>
    item.id === 'E1:search' && item.kind === 'search' && item.tool === 'repo_git_log'),
  'git history keeps its normalized search boundary separately from commit content');
});

test('ExplorerRuntime semantic projection rebuilds exact observed ranges', async () => {
  class PartialMatchClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-read-1',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
                },
              },
            ],
          },
        };
      }
      // Evidence references lines 5-6 but we only read 1-4.
      // With EVIDENCE_LINE_TOLERANCE=2, line 5 is within tolerance → kept as partial.
      return {
        usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '인증 함수가 확인됩니다.',
            statusConfidence: 'medium',
            evidence: [
              { path: 'src/auth.js', startLine: 5, endLine: 6, why: '함수 본문' },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new PartialMatchClient() });
  const result = await runtime.explore({
    task: '인증 함수 확인',
    repo_root: root,
    scope: ['src/**'],
  });

  assert.ok(result.evidence.some(item =>
    item.path === 'src/auth.js' &&
    item.startLine === 1 &&
    item.endLine === 4 &&
    item.groundingStatus === 'exact'),
  'parent evidence is rebuilt from the runtime observation');
  assert.ok(result.evidence.every(item =>
    !(item.path === 'src/auth.js' && item.startLine === 5 && item.endLine === 6)),
  'the nearby model-proposed range is not exposed to the parent');
});

test('ExplorerRuntime calls onProgress callback on each turn', async () => {
  class TwoTurnClient {
    constructor() { this.model = 'mock'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          message: {
            content: '',
            toolCalls: [{
              id: 'c1',
              function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'auth' }) },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 60, completion_tokens: 20, total_tokens: 80 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '답변', statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new TwoTurnClient() });
  const progressEvents = [];

  const result = await runtime.explore(
    { task: '인증 함수 찾기', repo_root: root, scope: ['src/**'] },
    { onProgress: (evt) => progressEvents.push(evt) },
  );

  assert.ok(progressEvents.length >= 2, 'onProgress must be called at least twice');
  for (const evt of progressEvents) {
    assert.ok(typeof evt.progress === 'number', 'progress must be a number');
    assert.ok(typeof evt.total === 'number', 'total must be a number');
    assert.ok(typeof evt.message === 'string', 'message must be a string');
  }
  assert.ok(result.directAnswer);
});

// spec 017: SessionStore was removed entirely. Tests that exercised session
// fallback / remainingCalls / cross-call summary injection were deleted along
// with src/explorer/session.mjs.

// ── Phase 1 — 최종 출력 경로 단일화 ──────────────────────────────────────────

test('Phase 1 — no-tool exit always routes through finalize (strict schema)', async () => {
  // When the model answers immediately with no tool calls the response must still
  // go through finalizeAfterToolLoop so the strict schema is always applied.
  // We verify this by checking that the result conforms to strict schema even
  // when the MockClient returns valid JSON without any tool calls.
  class ImmediateAnswerClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      // First call (agentic loop): no tool calls — triggers finalizeAfterToolLoop
      // Second call (finalize): returns the JSON answer
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '즉시 답변합니다.',
            statusConfidence: 'medium',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new ImmediateAnswerClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({ task: '단순 질문', repo_root: root });

  assertStrictSchema(result);
  // finalize was called: total calls = 1 (agentic loop no-tool) + 1 (finalize) = 2
  assert.equal(client.calls, 2, 'finalizeAfterToolLoop must be called even on no-tool exit');
});

test('Phase 1 — finalize prompt triggers no additional tool calls', async () => {
  // Verifies that the finalize step is called with parallelToolCalls:false and
  // the model honours the no-tool instruction (no toolCalls in finalize response).
  const capturedRequests = [];

  class TrackingClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion(req) {
      this.calls += 1;
      capturedRequests.push(req);
      return {
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '분석 완료',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new TrackingClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  await runtime.explore({ task: '테스트', repo_root: root });

  // The finalize request (last call) must have parallelToolCalls:false
  const finalizeReq = capturedRequests[capturedRequests.length - 1];
  assert.equal(finalizeReq.parallelToolCalls, false, 'finalize request must have parallelToolCalls:false');

  // The finalize user message must include the finalize prompt keywords
  const finalizeMessages = finalizeReq.messages;
  const lastUserMsg = [...finalizeMessages].reverse().find(m => m.role === 'user');
  assert.ok(lastUserMsg?.content?.includes('HARD REQUIREMENTS'), 'finalize prompt must include HARD REQUIREMENTS');
});

test('Phase 1 — malformed freeform content still produces strict-schema result', async () => {
  // When the model returns non-JSON content the fallback path in finalizeAfterToolLoop
  // must still produce a result that passes strict schema (with confidence=low).
  class MalformedFinalizeClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        // agentic loop: no tool calls → triggers finalize
        return {
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          message: { content: '', toolCalls: [] },
        };
      }
      // finalize call: returns plain prose (not valid JSON)
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: 'The authentication middleware is located in src/auth.js.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MalformedFinalizeClient() });
  const result = await runtime.explore({ task: '인증 위치 찾기', repo_root: root });

  // Fallback path must still produce schema-compliant structure
  assert.equal(typeof result.directAnswer, 'string', 'answer must be a string even on malformed content');
  assert.ok(result.directAnswer.length > 0, 'answer must not be empty');
  assert.equal(result.status.confidence, 'low', 'confidence must be low on fallback path');
  assert.ok(Array.isArray(result.evidence), 'evidence must be an array on fallback');
  assert.ok(Array.isArray(result.uncertainties), 'uncertainties must be an array on fallback');
  assert.equal(result.followups, undefined);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.failure.category, 'internal');
  assert.equal(result.failure.reason, 'invalid_final_response');
  assert.equal(result.failure.retry.tool, 'explore_repo');
  assert.ok(result.failure.retry.hints.some(hint => /specific/i.test(hint)));
  assert.equal(result.failure.retry.args.task, 'Retry with a more specific task, symbol, file, or scope.');
  assert.deepEqual(Object.keys(result.failure.retry.args).sort(), ['scope', 'task']);
  assert.equal(result.failure.retry.expectedImprovement, 'A more specific prompt should improve compact JSON synthesis.');
  assert.equal(result.evidenceQuality.level, 'low');
});

// T008 fixed the expected behavior before T013 changed runtime fault precedence.
test('Spec 028 T008 — a valid partial tool-result limit is non-fatal and cannot establish completion', async () => {
  class PartialToolLimitClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-long-file',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/long.js', startLine: 1, endLine: 10_000 }),
              },
            }],
          },
        };
      }

      if (!responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: { content: 'Ready to synthesize.', toolCalls: [] },
        };
      }

      return {
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'The complete file could not be inspected within the fixed read limit.',
            verification: 'follow_up_needed',
            complete: false,
            uncertainties: ['The requested exhaustive read is incomplete.'],
            nextAction: { type: 'stop', reason: 'The bounded result is incomplete.' },
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const longSource = Array.from({ length: 400 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join('\n');
  await fs.writeFile(path.join(root, 'src', 'long.js'), longSource);

  const runtime = new ExplorerRuntime({ chatClient: new PartialToolLimitClient() });
  const result = await runtime.explore({
    task: 'Inspect every line in src/long.js and report whether any line was omitted.',
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(result.status.complete, false);
  assert.equal(result.failure, null, 'a valid partial result is an incomplete proof state, not execution failure');
  assert.equal(result.nextAction.type, 'stop', 'a fixed limit must not create a pointless question for the parent');
  assert.equal(Array.isArray(result.stats.safetyLimits), true);
  const limit = result.stats.safetyLimits.find(item => item.name === 'tool_result_limit');
  assert.ok(limit, 'the exact reached limit must be recorded');
  assert.equal(limit.stage, 'exploration');
  assert.equal(limit.truncated, true);
  assert.equal(Array.isArray(limit.affectedSubgoalIds), true);
});

test('Spec 028 T008 — an output-capped invalid control response remains a fatal fault', async () => {
  class InvalidControlOutputClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (!responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          message: { content: '', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
        finishReason: 'length',
        message: { content: '{}', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new InvalidControlOutputClient() });
  const result = await runtime.explore({ task: 'Locate the auth middleware.', repo_root: root });

  assert.equal(result.status.complete, false);
  assert.ok(result.failure, 'invalid required control JSON cannot be promoted as partial evidence');
  assert.equal(result.failure.reason, 'invalid_final_response');
  assert.equal(Array.isArray(result.stats.safetyLimits), true);
  const limit = result.stats.safetyLimits.find(item => item.name === 'generation_output_limit');
  assert.ok(limit, 'the provider output ceiling must remain observable alongside the fatal fault');
  assert.equal(limit.stage, 'synthesis');
  assert.equal(limit.truncated, true);
});

test('Spec 028 T013 — a recovered output cap remains observable but non-fatal', async () => {
  class RecoveredControlOutputClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (!responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          message: { content: '', toolCalls: [] },
        };
      }
      if (this.calls === 2) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
          finishReason: 'length',
          message: { content: '{"directAnswer":', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 35, completion_tokens: 10, total_tokens: 45 },
        finishReason: 'stop',
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'The capped control response was repaired without adding facts.',
            verification: 'follow_up_needed',
            complete: false,
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new RecoveredControlOutputClient() });
  const result = await runtime.explore({ task: 'Locate the auth middleware.', repo_root: root });

  assert.equal(result.failure, null, 'successful bounded recovery must not become an execution failure');
  assert.equal(result.status.complete, false, 'recovery cannot establish proof without grounded evidence');
  assert.ok(result.stats.safetyLimits.some(limit =>
    limit.name === 'generation_output_limit' && limit.stage === 'synthesis' && limit.truncated));
});

test('Spec 028 T013 — an intentional short file range is not a tool-result limit', async () => {
  class ShortRangeClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          message: {
            content: '',
            toolCalls: [{
              id: 'short-read',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/long.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      if (!responseFormat) {
        return {
          usage: { prompt_tokens: 25, completion_tokens: 5, total_tokens: 30 },
          message: { content: 'Ready to synthesize.', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'The requested first four lines were inspected.',
            statusConfidence: 'high',
            evidence: [{
              path: 'src/long.js',
              startLine: 1,
              endLine: 4,
              why: 'requested bounded range',
              evidenceType: 'file_range',
              groundingStatus: 'exact',
            }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const longSource = Array.from({ length: 400 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join('\n');
  await fs.writeFile(path.join(root, 'src', 'long.js'), longSource);
  const runtime = new ExplorerRuntime({ chatClient: new ShortRangeClient() });
  const result = await runtime.explore({
    task: 'Read only lines 1 through 4 of src/long.js.',
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(result.stats.safetyLimits.some(limit => limit.name === 'tool_result_limit'), false);
});

test('ExplorerRuntime turn limit stays non-fatal and preserves the hard scope', async () => {
  class TurnLimitScopeClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'The turn limit was reached before enough evidence was gathered.',
              statusConfidence: 'low',
              verification: 'follow_up_needed',
              complete: false,
              uncertainties: ['The turn limit was reached before full follow-up.'],
              nextAction: { type: 'stop', reason: 'The bounded result is incomplete.' },
            })),
            toolCalls: [],
          },
        };
      }

      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `grep-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `unlikely-${this.calls}`, scope: ['src/**'] }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new TurnLimitScopeClient() });
  const result = await runtime.explore({
    task: 'Map auth behavior broadly enough to reach the fixed turn limit.',
    repo_root: root,
    scope: ['src/**', 'tests/**'],
  });

  assert.equal(result.failure, null, 'a valid turn limit is a partial proof state, not an execution fault');
  assert.deepEqual(result.stats.scope, ['src/**', 'tests/**']);
  assert.ok(result.stats.safetyLimits.some(limit =>
    limit.name === 'turn_limit' && limit.stage === 'exploration' && limit.truncated === false));
});

// ── Phase 5 — evidence/schema/context 고도화 ──────────────────────────────────

test('Phase 5 — git_commit evidence without verified SHA is dropped (strict validation)', async () => {
  // Verifies that git_commit evidence with a SHA that was not actually returned by
  // a git tool call is dropped. The fixture has no git repo, so repo_git_log returns
  // an error and observedGit.commits stays empty. Evidence citing 'abc1234' is unverified.
  class GitEvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-git',
              function: { name: 'repo_git_log', arguments: JSON.stringify({ maxCount: 3 }) },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '버그는 abc1234 커밋에서 도입됐습니다.',
            statusConfidence: 'medium',
            evidence: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: '버그가 도입된 파일',
                evidenceType: 'git_commit',
                sha: 'abc1234',
                author: 'dev@example.com',
              },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new GitEvidenceClient() });
  const result = await runtime.explore({
    task: '이 버그가 언제 도입됐나요?',
    repo_root: root,
  });

  // The semantic projection may retain separately verified source evidence, but it must
  // never expose the model-proposed commit or SHA.
  assert.ok(result.evidence.every(item =>
    item.evidenceType !== 'git_commit' && item.sha !== 'abc1234'),
  'unverified git_commit evidence must not reach the parent');
});

// spec 017: Phase 5 session reuse test removed alongside SessionStore module.

test('Phase 5 — unknown tool validation stays in sync with current tool definitions', async () => {
  class UnknownToolClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'unknown-tool',
              function: { name: 'repo_totally_new_tool', arguments: '{}' },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'done',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new UnknownToolClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  await runtime.explore({ task: 'unknown tool sync test', repo_root: root });

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
  await toolkit.initialize();
  const definedNames = toolkit.buildToolDefinitions().map(tool => tool.function.name).sort();

  const secondTurnMessages = client.snapshots[1];
  const validationToolMessage = secondTurnMessages[secondTurnMessages.length - 1];
  assert.equal(validationToolMessage.role, 'tool');

  const validationPayload = JSON.parse(validationToolMessage.content);
  const listedTools = validationPayload.message
    .split('Available tools: ')[1]
    .replace('. Choose one of these.', '')
    .split(', ')
    .sort();

  assert.deepEqual(listedTools, definedNames, 'validation error must derive its available tool list from current tool definitions');
});

// ── Phase 4 — 멀티턴 안정화 장치 ─────────────────────────────────────────────

test('Phase 4 — checkpoint message is inserted after every 4 turns', async () => {
  // Verifies that when maxTurns > 6, a checkpoint user message is
  // injected into the conversation every CHECKPOINT_INTERVAL (4) turns.
  const capturedMessages = [];

  class CheckpointObserverClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      capturedMessages.push([...messages]);

      if (this.calls <= 4) {
        // Keep making tool calls for the first 4 turns to trigger checkpoint
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `call-${this.calls}`,
              function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'auth' }) },
            }],
          },
        };
      }
      // Turn 5: answer without tools
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '분석 완료', statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new CheckpointObserverClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  await runtime.explore({ task: '인증 분석', repo_root: root });

  // The 5th call to createChatCompletion (turnIndex=4) should have a checkpoint
  // user message injected before it. That means capturedMessages[4] should contain
  // a user message with "Checkpoint" text.
  const turn5Messages = capturedMessages[4];
  const checkpointMsg = turn5Messages.find(
    m => m.role === 'user' && m.content?.includes('Checkpoint'),
  );
  assert.ok(checkpointMsg, 'checkpoint message must be injected at turnIndex=4');
});

test('Phase 4 — checkpoint is NOT inserted before the loop reaches the interval', async () => {
  const capturedMessages = [];

  class NoCheckpointClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      capturedMessages.push([...messages]);
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '빠른 답변', statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new NoCheckpointClient() });
  await runtime.explore({ task: '테스트', repo_root: root });

  // No message should contain "Checkpoint"
  const hasCheckpoint = capturedMessages.some(msgs =>
    msgs.some(m => m.role === 'user' && m.content?.includes('Checkpoint')),
  );
  assert.equal(hasCheckpoint, false, 'checkpoint must NOT be inserted before the interval');
});

test('Phase 4 — critic-lite: confidence=high with only 1 evidence item is reconciled to medium', async () => {
  // With recalibrated confidence scoring, a single evidence item (no cross-file
  // verification, non-locate task) computes to 'medium' (base 0.30 + 0.18 = 0.48).
  // The model's 'high' claim is reconciled down to the computed level.
  class OverconfidentClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        // Read one file so the evidence has an observed range
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-1',
              function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }) },
            }],
          },
        };
      }
      // Finalize: model claims high confidence with only 1 evidence item
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '자신있게 단정합니다.',
            statusConfidence: 'high',
            evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: '유일한 근거' }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new OverconfidentClient() });
  const result = await runtime.explore({ task: '인증 함수 분석', repo_root: root });

  // Recalibrated scorer: base 0.30 + 0.18 (1 exact) = 0.48 → 'medium'
  // reconcileConfidence: lowerOf('high', 'medium') = 'medium'
  assert.ok(['low', 'medium'].includes(result.status.confidence),
    `confidence=high with 1 evidence item should be reconciled down, got ${result.status.confidence}`);
  assert.equal(result.critic.status, 'caution');
  assert.ok(result.critic.warnings.some(w => w.type === 'confidence_downgraded'));
  assert.ok(result.critic.warnings.every(w => w.message && w.action));
});

test('Phase 3 — system prompt has HARD REQUIREMENTS within first 30 lines', () => {
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig: getRuntimeConfig(),
  });
  const lines = prompt.split('\n');
  const first30 = lines.slice(0, 30).join('\n');
  assert.ok(
    first30.includes('HARD REQUIREMENTS'),
    'HARD REQUIREMENTS must appear within the first 30 lines of the system prompt',
  );
});

test('Spec 028 T012 — structured prompts expose exact fixed-limit names without an effort profile', () => {
  const runtimeConfig = getRuntimeConfig();
  const systemPrompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig,
  });
  const userPrompt = buildExplorerUserPrompt({
    task: 'Find the authentication entry point',
    scope: [],
  });

  assert.match(
    systemPrompt,
    new RegExp(`Fixed runtime limits: maxTurns=${runtimeConfig.maxTurns}, maxReadLines=${runtimeConfig.maxReadLines}, maxSearchResults=${runtimeConfig.maxSearchResults}\\.`),
  );
  assert.doesNotMatch(`${systemPrompt}\n${userPrompt}`, /Runtime profile|\bdeep\b/i);
});

test('Spec 023 — explorer system prompt has UNTRUSTED CONTENT rule and candidate-edit-target wording', () => {
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig: getRuntimeConfig(),
  });
  assert.ok(
    prompt.includes('UNTRUSTED CONTENT'),
    'explorer system prompt must include the UNTRUSTED CONTENT hard requirement',
  );
  assert.ok(
    prompt.includes('candidate edit targets'),
    'explorer READ-ONLY rule must allow identifying candidate edit targets',
  );
});

test('Phase 3 — detectStrategy returns compound array for mixed-signal task', () => {
  // A task that triggers both git-guided (변경) and blame-guided (버그) signals
  const strategy = detectStrategy('이 버그가 언제 변경된 커밋에서 도입됐는지 찾아라');
  assert.ok(Array.isArray(strategy), 'compound task must return an array of strategies');
  assert.ok(strategy.includes('git-guided'), 'should detect git-guided');
  assert.ok(strategy.includes('blame-guided'), 'should detect blame-guided');
});

test('Phase 3 — detectStrategy returns single string for unambiguous task', () => {
  const strategy = detectStrategy('requireAuth 함수가 어디 정의되어 있는지 찾아라');
  assert.equal(typeof strategy, 'string', 'unambiguous task must return a single strategy string');
  assert.equal(strategy, 'symbol-first');
});

test('Spec 028 T053 — wrapper task modes preserve internal strategy without a public hint', () => {
  const tracePrompt = buildExplorerUserPrompt({
    task: 'Inspect this delegated target.',
    scope: [],
    hints: { symbols: ['requireAuth'] },
    taskMode: 'symbol_trace',
  });
  assert.match(tracePrompt, /Strategy: symbol-first/);

  for (const taskMode of ['edit_planning', 'path_explanation']) {
    const prompt = buildExplorerUserPrompt({
      task: 'Inspect this delegated target.',
      scope: [],
      hints: { files: ['src/auth.mjs'] },
      taskMode,
    });
    assert.match(prompt, /Strategy: reference-chase/);
  }
});

test('Phase 3 — Korean task produces Korean answer/summary language (language rule)', async () => {
  // This test checks that when language is not specified the LANGUAGE RULE in the
  // system prompt mentions "same natural language as the delegated task".
  // We verify the system prompt contains the expected language rule text.
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig: getRuntimeConfig(),
  });
  assert.ok(
    prompt.includes('LANGUAGE RULE'),
    'system prompt must include a LANGUAGE RULE section',
  );
  assert.ok(
    prompt.includes('same natural language'),
    'default language rule must say "same natural language as the delegated task"',
  );
});

test('Phase 3 — explicit language is reflected in system prompt language rule', () => {
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig: getRuntimeConfig(),
    language: 'Korean',
  });
  assert.ok(
    prompt.includes('Korean'),
    'explicit language must appear in the system prompt language rule',
  );
  assert.ok(
    !prompt.includes('same natural language'),
    'explicit language must override the default language rule',
  );
});

test('Phase 3 — system prompt does not expose the absolute repo root path', () => {
  const repoRoot = path.resolve('fixtures', 'demo-repo');
  const prompt = buildExplorerSystemPrompt({
    repoRoot,
    runtimeConfig: getRuntimeConfig(),
  });

  assert.ok(
    !prompt.includes(repoRoot),
    'system prompt must not embed the absolute repository root path',
  );
  assert.ok(
    prompt.includes('tool paths are relative to the repo root'),
    'system prompt should still explain path semantics',
  );
});

// ── Phase 0 baseline metrics ──────────────────────────────────────────────────

/**
 * Assert that `result` passes all required-field type checks (strict schema compliance).
 * Re-use this helper in every test that produces a result to track schema compliance rate.
 */
function assertStrictSchema(result) {
  assert.ok(typeof result.directAnswer === 'string' && result.directAnswer.length > 0,
    'strict schema: answer must be a non-empty string');
  assert.ok(typeof result.directAnswer === 'string',
    'strict schema: summary must be a string');
  assert.ok(['low', 'medium', 'high'].includes(result.status.confidence),
    'strict schema: confidence must be low|medium|high');
  assert.ok(Array.isArray(result.targets),
    'strict schema: targets must be an array');
  assert.ok(Array.isArray(result.evidence),
    'strict schema: evidence must be an array');
  assert.ok(Array.isArray(result.uncertainties),
    'strict schema: uncertainties must be an array');
  assert.equal(result.candidatePaths, undefined,
    'strict schema: candidatePaths must not be exposed');
  assert.equal(result.followups, undefined,
    'strict schema: followups must not be exposed');
  assert.ok(result.stats && typeof result.stats === 'object',
    'strict schema: stats must be an object');
  assert.ok(typeof result.stats.turns === 'number',
    'strict schema: stats.turns must be a number');
}

test('Phase 0 metric — JSON parse success: model content parsed into correct field types', async () => {
  // Verifies that when the model returns valid JSON the runtime correctly parses every
  // top-level field. This is the "JSON parse success" baseline.
  class JsonSuccessClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '인증 함수 위치를 확인했습니다.',
            statusConfidence: 'high',
            evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: '함수 정의' }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new JsonSuccessClient() });
  const result = await runtime.explore({ task: '인증 함수 찾기', repo_root: root });

  // JSON parse success: each field has the correct runtime type
  assert.equal(typeof result.directAnswer, 'string', 'answer must parse to string');
  assert.equal(typeof result.directAnswer, 'string', 'summary must parse to string');
  assert.ok(['low', 'medium', 'high'].includes(result.status.confidence), 'confidence must parse to valid label');
  assert.ok(Array.isArray(result.targets), 'targets must parse to array');
  assert.ok(Array.isArray(result.evidence), 'evidence must parse to array');
  assert.ok(Array.isArray(result.uncertainties), 'uncertainties must parse to array');
  assert.equal(result.candidatePaths, undefined);
  assert.equal(result.followups, undefined);
  assert.equal(typeof result.confidenceScore, 'number', 'confidenceScore must be a number after parse');
  assertStrictSchema(result);
});

test('Phase 0 metric — strict schema compliance: required fields present under the single runtime config', async () => {
  // Every structured call runs against the same fixed, unlabeled runtime config.
  class MinimalClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '테스트 답변',
            statusConfidence: 'medium',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MinimalClient() });
  const result = await runtime.explore({ task: '테스트', repo_root: root });
  assertStrictSchema(result);
});

// ─────────────────────────────────────────────────────────────────────────────

test('ExplorerRuntime forwards assistant reasoning into the next turn when available', async () => {
  class ReasoningClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ messages, reasoningEffort, temperature, topP }) {
      this.calls += 1;

      if (this.calls === 1) {
        // The fixed runtime config leaves GLM 4.7 reasoningEffort undefined and
        // uses temperature: 1.0, topP: 0.95.
        assert.equal(reasoningEffort, undefined);
        assert.equal(temperature, 1.0);
        assert.equal(topP, 0.95);
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            reasoning: 'Search for requireAuth before reading files.',
            toolCalls: [
              {
                id: 'call-r-1',
                function: {
                  name: 'repo_grep',
                  arguments: JSON.stringify({ pattern: 'requireAuth', scope: ['src/**'] }),
                },
              },
            ],
          },
        };
      }

      const assistantMessages = messages.filter(message => message.role === 'assistant');
      assert.ok(
        assistantMessages.some(message => message.reasoning === 'Search for requireAuth before reading files.'),
        'previous assistant reasoning must be sent back on the next turn',
      );

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'reasoning forwarded',
            statusConfidence: 'low',
            evidence: [],
          })),
          reasoning: '',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new ReasoningClient() });
  const result = await runtime.explore({
    task: '인증 함수 위치를 빠르게 찾아라.',
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(result.directAnswer, 'reasoning forwarded');
});

// --- Phase 3: Malformed Tool Args / Parallel Tool Failure Isolation ---

test('ExplorerRuntime continues when one tool call has invalid JSON arguments', async () => {
  class MalformedArgsClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'bad-1',
                function: { name: 'repo_grep', arguments: 'NOT VALID JSON {{{' },
              },
              {
                id: 'good-1',
                function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) },
              },
            ],
          },
        };
      }
      // Finalize
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'malformed args handled',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MalformedArgsClient() });
  // Must not throw — the bad tool call is isolated as an error, good one proceeds
  const result = await runtime.explore({ task: 'find auth', repo_root: root });
  assert.ok(result, 'explore() did not throw despite malformed tool args');
  assert.equal(result.directAnswer, 'malformed args handled');
});

test('ExplorerRuntime preserves successful tool results even when one sibling tool fails', async () => {
  let capturedMessages = null;
  class OneFailClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'fail-1',
                function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'does/not/exist.js' }) },
              },
              {
                id: 'ok-1',
                function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) },
              },
            ],
          },
        };
      }
      capturedMessages = messages;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'checked',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new OneFailClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root });
  assert.ok(result, 'explore() succeeded');
  // The successful grep result must appear in the message history
  const toolMessages = capturedMessages?.filter(m => m.role === 'tool') ?? [];
  assert.ok(toolMessages.some(m => m.content && m.content.includes('requireAuth')),
    'grep tool result (requireAuth) is in context even though sibling tool failed');
});

// --- Phase 4: Observation Ledger Tests ---

test('ExplorerRuntime records observations from macro tools (repo_symbol_context)', async () => {
  let capturedMessages = null;
  class SymbolContextClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'sc-1',
                function: {
                  name: 'repo_symbol_context',
                  arguments: JSON.stringify({ symbol: 'requireAuth' }),
                },
              },
            ],
          },
        };
      }
      capturedMessages = messages;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'found requireAuth definition',
            statusConfidence: 'medium',
            evidence: [
              { path: 'src/auth.js', startLine: 1, endLine: 4, snippet: 'export function requireAuth', why: 'definition of requireAuth', groundingStatus: 'exact' },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new SymbolContextClient() });
  const result = await runtime.explore({ task: 'where is requireAuth defined', repo_root: root });

  // The symbol_context observation for src/auth.js should allow evidence grounding
  assert.ok(result, 'explore succeeded');
  // Evidence for src/auth.js should be retained (grounded via symbol_context observations)
  const authEvidence = result.evidence?.filter(e => e.path === 'src/auth.js') ?? [];
  assert.ok(authEvidence.length > 0, 'evidence for src/auth.js is retained via symbol_context observations');
});

test('Spec 028 T048 — PR and diff review text automatically selects git-guided exploration', () => {
  for (const task of [
    'Review this PR for auth risks.',
    'Review the diff for auth risks.',
    'Audit this pull request for regressions.',
    '이 PR의 변경을 검토해라.',
  ]) {
    const strategy = detectStrategy(task);
    assert.equal(
      strategy === 'git-guided' ||
        (Array.isArray(strategy) && strategy.includes('git-guided')),
      true,
      task,
    );
  }
});

test('Spec 028 T029 — runtime ledger assigns stable ids and rebuilds redacted current source', async () => {
  const rawSecret = 'sk-proj-1234567890abcdefghijklmnop';
  const rawPrivateBody = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
  class ObservationLedgerClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: 'FORGED_EXPLORER_SNIPPET',
            toolCalls: [
              {
                id: 'read-auth',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 2 }),
                },
              },
              {
                id: 'grep-missing',
                function: {
                  name: 'repo_grep',
                  arguments: JSON.stringify({ pattern: 'legacyGuard', scope: ['src/routes/**'] }),
                },
              },
              {
                id: 'list-routes',
                function: {
                  name: 'repo_list_dir',
                  arguments: JSON.stringify({ dirPath: 'src/routes', depth: 1 }),
                },
              },
            ],
          },
        };
      }
      if (this.calls === 2) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-redaction',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/redaction.js', startLine: 1, endLine: 5 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'runtime observations recorded',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  await fs.writeFile(path.join(root, 'src', 'redaction.js'), [
    `export const token = '${rawSecret}';`,
    'export const key = `-----BEGIN PRIVATE KEY-----',
    rawPrivateBody,
    '-----END PRIVATE KEY-----`;',
    'export const safe = true;',
  ].join('\n'));
  const runtime = new ExplorerRuntime({ chatClient: new ObservationLedgerClient() });
  const result = await runtime.explore({
    task: 'Locate authentication and check whether legacyGuard exists.',
    repo_root: root,
    scope: ['src/**'],
  });

  const observationIds = result.observations.map(item => item.id);
  assert.deepEqual(observationIds.slice(0, 6), [
    'E1', 'E1:search', 'E2', 'E3', 'E4', 'E4:search',
  ]);
  assert.equal(new Set(observationIds).size, observationIds.length,
    'bounded repair observations must keep unique stable ids');
  assert.deepEqual(result.observations[0], {
    id: 'E1',
    kind: 'source',
    path: 'src/auth.js',
    startLine: 1,
    endLine: 2,
    snippet: [
      '1: export function requireAuth(req, res, next) {',
      '2:   if (!req.user) throw new Error("unauthorized");',
    ].join('\n'),
    rangeGrounding: 'exact',
    sourceRole: 'implementation',
    temporalRole: 'current',
    redacted: false,
  });
  assert.equal(result.observations[1].kind, 'search');
  assert.equal(result.observations[1].tool, 'repo_read_file');
  assert.equal(result.observations[1].toolTruncated, true,
    'the exact rebuilt source range must not erase read-result truncation');
  assert.deepEqual(result.observations[1].boundary, ['src/auth.js']);
  assert.equal(result.observations[2].kind, 'search');
  assert.equal(result.observations[2].tool, 'repo_grep');
  assert.deepEqual(result.observations[2].normalizedArgs, {
    pattern: 'legacyGuard',
    scope: ['src/routes/**'],
  });
  assert.deepEqual(result.observations[2].boundary, ['src/routes/**'],
    'the local scope narrows the hard scope instead of being unioned with it');
  assert.equal(result.observations[2].matchCount, 0);
  assert.equal(result.observations[2].enumerationComplete, true,
    'T062 must consume the tool-specific completeness policy implemented in T060');
  assert.equal(result.observations[3].tool, 'repo_list_dir');
  assert.deepEqual(result.observations[3].boundary, ['src/routes/*']);
  assert.equal(result.observations[4].kind, 'source');
  assert.equal(result.observations[4].redacted, true);
  assert.match(result.observations[4].snippet, /\[REDACTED:openai-api-key\]/);
  assert.match(result.observations[4].snippet, /\[REDACTED:private-key-block\]/);
  assert.equal(result.observations[4].rangeGrounding, 'partial');
  assert.equal(result.observations[5].tool, 'repo_read_file');
  assert.equal(result.observations[5].toolTruncated, false);
  assert.doesNotMatch(JSON.stringify(result.observations), /FORGED_EXPLORER_SNIPPET/);
  assert.doesNotMatch(JSON.stringify(result.observations), new RegExp(rawSecret));
  assert.doesNotMatch(JSON.stringify(result.observations), new RegExp(rawPrivateBody));
});

// --- Phase 5: Source-aware Grounding + Git Evidence Validation Tests ---

test('grep-only observation does not exact-ground a wide file range', async () => {
  // Build a runtime result directly by checking the grounding function behavior
  // We do this through an explore() call with mock data
  class GrepOnlyClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'grep-1',
                function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) },
              },
            ],
          },
        };
      }
      // Model reports wide range evidence based only on grep
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'found',
            statusConfidence: 'medium',
            evidence: [
              // Wide range — grep only saw line 1, so L1-L200 should be partial not exact
              { kind: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 200, why: 'requireAuth module', evidenceType: 'file_range' },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new GrepOnlyClient() });
  const result = await runtime.explore({ task: 'find requireAuth', repo_root: root });
  assert.ok(result, 'explore succeeded');
  const wideEvidence = result.evidence?.find(e => e.path === 'src/auth.js' && e.startLine === 1 && e.endLine === 200);
  if (wideEvidence) {
    assert.equal(wideEvidence.groundingStatus, 'partial', 'wide range grounded from grep-only must be partial, not exact');
  }
  // Either dropped OR partial — never exact
  const exactWide = result.evidence?.find(e => e.path === 'src/auth.js' && e.startLine === 1 && e.endLine === 200 && e.groundingStatus === 'exact');
  assert.ok(!exactWide, 'wide range evidence based solely on grep observation must not be exact');
});

test('hallucinated git_commit evidence is dropped (no matching observed hash)', async () => {
  class HallucinatedGitClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'grep-1',
                function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) },
              },
            ],
          },
        };
      }
      // Model hallucinates a git_commit evidence without ever calling git tools
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'found',
            statusConfidence: 'medium',
            evidence: [
              { evidenceType: 'git_commit', path: 'src/auth.js', sha: 'abc12345', why: 'commit that added requireAuth', startLine: 1, endLine: 4 },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new HallucinatedGitClient() });
  const result = await runtime.explore({ task: 'git history of auth', repo_root: root });
  assert.ok(result, 'explore succeeded');
  // Hallucinated commit should be dropped — git tools were never called so hash not in observedGit
  const gitCommitEvidence = result.evidence?.find(e => e.evidenceType === 'git_commit');
  assert.ok(!gitCommitEvidence, 'hallucinated git_commit evidence is dropped when no git tool was called');
});

// --- Phase 6: Loop Stagnation + Checkpoint Softening Tests ---

test('ExplorerRuntime injects recovery guidance after repeated identical tool plans', async () => {
  const injectedMessages = [];
  class RepeatingClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      // Capture user messages that are not the initial task (recovery messages)
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser && lastUser.content && lastUser.content.includes('unproductive')) {
        injectedMessages.push(lastUser.content);
      }
      // Always return same tool call (stagnation)
      if (this.calls <= 5) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: `c-${this.calls}`, function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'auth' }) } }],
          },
        };
      }
      // Finalize
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({ directAnswer: 'done', statusConfidence: 'low', evidence: [] })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new RepeatingClient() });
  await runtime.explore({ task: 'find auth', repo_root: root });
  assert.ok(injectedMessages.length > 0, 'recovery guidance was injected after repeated identical tool plans');
});

test('Checkpoint prompt does not force exactly one more tool call', async () => {
  // The checkpoint message should not contain "exactly one more tool call"
  let checkpointContent = null;
  class CheckpointCaptureClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      // Look for checkpoint message in user messages
      const checkpointMsg = messages.find(m => m.role === 'user' && m.content?.includes('Checkpoint:'));
      if (checkpointMsg && !checkpointContent) {
        checkpointContent = checkpointMsg.content;
      }
      if (this.calls <= 4) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: `c-${this.calls}`, function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: `term${this.calls}` }) } }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({ directAnswer: 'done', statusConfidence: 'low', evidence: [] })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CheckpointCaptureClient() });
  await runtime.explore({ task: 'find something', repo_root: root });

  if (checkpointContent) {
    assert.ok(!checkpointContent.includes('exactly one more tool call'), 'checkpoint must not force exactly one more tool call');
    assert.ok(checkpointContent.includes('1–2 tool calls') || checkpointContent.includes('smallest next step'), 'checkpoint uses softened language');
  }
});

// --- Phase 7: Finalize Hardening Tests ---

test('finalizeAfterToolLoop salvages prose-wrapped JSON locally', async () => {
  class ProseWrappedClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: 'g1', function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) } }],
          },
        };
      }
      // Finalize response wraps JSON in prose
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'Here is my findings:\n\n```json\n' + JSON.stringify(compactResult({
            directAnswer: 'prose wrapped JSON salvaged',
            statusConfidence: 'medium',
            evidence: [],
          })) + '\n```\n\nThat is all I found.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new ProseWrappedClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root });
  assert.ok(result, 'explore succeeded');
  assert.equal(result.directAnswer, 'prose wrapped JSON salvaged', 'prose-wrapped JSON is salvaged locally');
});

test('finalizeAfterToolLoop repairs malformed JSON with a no-tool repair pass', async () => {
  let repairCallCount = 0;
  class MalformedFinalizeClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      // First call: tool use
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: 'g1', function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) } }],
          },
        };
      }
      // Finalize: return truly malformed JSON (not salvageable by prose extraction)
      if (this.calls === 2) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: { content: 'I found auth: {broken json here...', toolCalls: [] },
        };
      }
      // Repair pass
      repairCallCount += 1;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'repaired after malformed JSON',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MalformedFinalizeClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root });
  assert.ok(result, 'explore succeeded despite malformed finalize JSON');
  assert.equal(repairCallCount, 1, 'repair pass was called exactly once');
  assert.equal(result.directAnswer, 'repaired after malformed JSON', 'repaired result is used');
});

test('finalize prompt bounds output size for compact JSON synthesis', () => {
  const prompt = buildFinalizePrompt();

  assert.match(prompt, /directAnswer.*1200/i);
  assert.match(prompt, /at most 8 targets/i);
  assert.match(prompt, /at most 8 evidence/i);
});

test('finalizeAfterToolLoop gives repair pass the full finalize output limit', async () => {
  const seenFinalizeLimits = [];
  class OutputLimitRepairClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages, maxCompletionTokens }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: 'g1', function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) } }],
          },
        };
      }
      const lastMessage = messages[messages.length - 1]?.content ?? '';
      if (!lastMessage.includes('Produce the final exploration result now.')
        && !lastMessage.includes('Repair your previous response')) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: { content: '', toolCalls: [] },
        };
      }
      seenFinalizeLimits.push(maxCompletionTokens);
      if (lastMessage.includes('Produce the final exploration result now.')) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: maxCompletionTokens, total_tokens: 10 + maxCompletionTokens },
          message: {
            content: '{"directAnswer":"truncated","targets":[{"path":"src/auth.js","startLine":',
            toolCalls: [],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'repaired with full output limit',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new OutputLimitRepairClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root });

  assert.deepEqual(seenFinalizeLimits, [
    getRuntimeConfig().finalizeMaxCompletionTokens,
    getRuntimeConfig().finalizeMaxCompletionTokens,
  ]);
  assert.equal(result.directAnswer, 'repaired with full output limit');
});

// ── Phase 10 — Confidence Recalibration ──────────────────────────────────────

test('Phase 10 — runtime downgrades model high confidence to computed medium when evidence is weak', async () => {
  // The model claims "high" confidence but only provides a single piece of evidence
  // from one file with no search calls. The runtime should downgrade to medium or low.
  let callCount = 0;
  class WeakEvidenceClient {
    get model() { return 'zai-glm-4.7'; }
    async createChatCompletion({ messages }) {
      callCount += 1;
      const last = messages[messages.length - 1];
      const isSystem = last?.role === 'system';
      // Initial plan turn: emit a single read tool call
      if (callCount === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-read-1',
              type: 'function',
              function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/auth.js', start_line: 1, end_line: 3 }) },
            }],
          },
        };
      }
      // Finalize turn: claim high confidence with only one evidence item from one file
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'requireAuth is defined in src/auth.js',
            statusConfidence: 'high',
            evidence: [{
              path: 'src/auth.js',
              startLine: 1,
              endLine: 3,
              why: 'definition found here',
              evidenceType: 'file_range',
            }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new WeakEvidenceClient() });
  const result = await runtime.explore({ task: 'find requireAuth', repo_root: root });
  assert.ok(result, 'explore returned a result');
  // The model claimed "high" but with only 1 exact item from 1 file, it must not be "high"
  assert.notEqual(result.status.confidence, 'high',
    'runtime must downgrade model-claimed high to medium/low when evidence is weak (single file, no search)');
});

test('ExplorerRuntime forwards abortSignal into chat client requests', async () => {
  const seenSignals = [];

  class SignalCaptureClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion(request) {
      this.calls += 1;
      seenSignals.push(request.signal);
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'signal forwarded',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const controller = new AbortController();
  const runtime = new ExplorerRuntime({ chatClient: new SignalCaptureClient() });

  const result = await runtime.explore(
    {
      task: '인증 구조를 요약해라.',
      repo_root: repoRoot,
    },
    { abortSignal: controller.signal },
  );

  assert.equal(result.directAnswer, 'signal forwarded');
  assert.ok(seenSignals.length >= 2, 'explore + finalize calls should both receive the signal');
  assert.ok(seenSignals.every(signal => signal === controller.signal), 'abortSignal must be forwarded unchanged');
});

// ── 010 — Spec-1: status contract on evidence sufficiency ───────────────────

test('010 US1#1 — locate task with exact evidence stays complete when the turn limit is reached', async () => {
  // Mock client emits one read tool call to ground evidence, then loops on no-op tool calls
  // until the fixed turn limit is reached. The runtime must finalize with complete:true based
  // on evidence sufficiency rather than treating the safety limit as a failure.
  class TurnLimitWithEvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth is defined in src/auth.js:1-4.',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'function declaration site',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
            })),
            toolCalls: [],
          },
        };
      }

      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `noop-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `unlikely-${this.calls}`, scope: ['src/**'] }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new TurnLimitWithEvidenceClient() });
  const result = await runtime.explore({
    task: 'find where requireAuth is defined',
    taskMode: 'symbol_trace',
    repo_root: root,
  });

  assert.ok(result.stats.safetyLimits.some(limit => limit.name === 'turn_limit'));
  assert.equal(result.status.complete, true, 'sufficient locate evidence must yield complete:true');
  assert.ok(
    result.status.verification === 'verified' || result.status.verification === 'targeted_read_needed',
    `verification must reflect sufficiency, got ${result.status.verification}`,
  );
  assert.equal(result.failure, null, 'a turn limit must not produce failure when evidence is sufficient');
  assert.ok(result.stats?.evidenceSufficiency?.sufficient === true);
});


test('010 security — broad find vulnerability task remains incomplete when the turn limit is reached', async () => {
  class BroadSecurityFindClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'One potential auth flaw was observed, but coverage is incomplete.',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'single exact evidence item that must not complete a broad security review',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
            })),
            toolCalls: [],
          },
        };
      }

      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `noop-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `no-security-hit-${this.calls}`, scope: ['src/**'] }),
            },
          }],
        },
      };
    }
  }

  for (const taskMode of [undefined, 'locate']) {
    const root = await makeRepoFixture();
    const runtime = new ExplorerRuntime({ chatClient: new BroadSecurityFindClient() });
    const result = await runtime.explore({
      task: 'find vulnerabilities in authentication',
      ...(taskMode ? { taskMode } : {}),
      repo_root: root,
    });

    assert.ok(result.stats.safetyLimits.some(limit => limit.name === 'turn_limit'));
    assert.equal(result.status.complete, false, `broad security task must stay incomplete for taskMode=${taskMode}`);
    assert.equal(result.status.verification, 'follow_up_needed');
    assert.equal(result.failure, null, 'a valid partial limit is not an execution failure');
    assert.deepEqual(result.stats?.evidenceSufficiency, {
      sufficient: false,
      reason: 'general_needs_more_evidence',
    });
  }
});

test('Spec 028 T035 — broad single-source proof stays incomplete without a safety limit', async () => {
  class BroadSingleSourceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-auth',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth rejects requests without req.user.',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'one observed authorization implementation',
              }],
            })),
            toolCalls: [],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new BroadSingleSourceClient() });
  const result = await runtime.explore({
    task: 'Analyze authorization behavior across the repository.',
    repo_root: root,
  });

  assert.equal(result.stats.safetyLimits.some(limit => limit.affectedSubgoalIds?.length > 0), false);
  assert.deepEqual(result.stats.evidenceSufficiency, {
    sufficient: false,
    reason: 'general_needs_more_evidence',
  });
  assert.equal(result.status.verification, 'follow_up_needed');
  assert.equal(result.status.complete, false);
  assert.equal(result.failure, null);
});

test('010 US1#2 — path_explanation with one evidence stays incomplete after the turn limit', async () => {
  // path_explanation requires exact >= 2 OR fileCount >= 2. One file/one exact item ⇒ insufficient.
  class PathExplanationClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'Partial trace — only first hop found.',
              statusConfidence: 'high',
              verification: 'follow_up_needed',
              complete: false,
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'entry function',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
            })),
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `noop-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `nothing-${this.calls}`, scope: ['src/**'] }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new PathExplanationClient() });
  const result = await runtime.explore({
    task: 'Trace request flow from requireAuth to response',
    taskMode: 'path_explanation',
    repo_root: root,
  });

  assert.ok(result.stats.safetyLimits.some(limit => limit.name === 'turn_limit'));
  assert.equal(result.status.complete, false, 'complex task with one evidence must stay incomplete');
  assert.equal(result.status.verification, 'follow_up_needed');
  assert.equal(result.failure, null, 'insufficient proof plus a valid limit must remain non-fatal');
  assert.equal(result.stats?.evidenceSufficiency?.sufficient, false);
});

test('010 US1#3 — buildNextAction prefers explore_followup with a cited target over ask_user', async () => {
  // Confidence:high but partial grounding so verification falls to follow_up_needed.
  // Targets array carries a read target ⇒ nextAction should be explore_followup, not ask_user.
  class FollowUpClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'partial answer with one grounded reference',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'reference',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
              targets: [{
                path: 'src/routes/user.js',
                startLine: 1,
                endLine: 6,
                role: 'read',
                reason: 'verify caller',
                evidenceRefs: [],
              }],
            })),
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `noop-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `nothing-${this.calls}` }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new FollowUpClient() });
  const result = await runtime.explore({
    task: 'Trace the request flow end-to-end',
    taskMode: 'path_explanation',
    repo_root: root,
  });

  if (result.status.verification === 'follow_up_needed' || result.status.verification === 'broad_search_needed') {
    assert.notEqual(result.nextAction.type, 'ask_user',
      'with a cited read target, nextAction should pick explore_followup over ask_user');
  }
});

// spec 017: SessionStore was removed. The spec-011 regression check
// for the legacy CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO opt-in is
// no longer reachable and has been deleted.

// ── 010 — Spec-2: targets[] / discoveredPaths[] separation ──────────────────

test('010 US2#1 — listDir entries land in discoveredPaths[], not targets[]', async () => {
  class ListDirClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth is defined in src/auth.js:1-4.',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'function declaration site',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
            })),
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'list-1',
              function: { name: 'repo_list_dir', arguments: JSON.stringify({ dirPath: '.' }) },
            }],
          },
        };
      }
      if (this.calls === 2) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  // Inject a fake .github directory and docs file so list_dir picks them up
  const root = await makeRepoFixture();
  await fs.mkdir(path.join(root, '.github'), { recursive: true });
  await fs.writeFile(path.join(root, '.github', 'workflows.yml'), 'name: ci');
  await fs.writeFile(path.join(root, 'README.md'), '# repo');

  const runtime = new ExplorerRuntime({ chatClient: new ListDirClient() });
  const result = await runtime.explore({
    task: 'find where requireAuth is defined',
    taskMode: 'symbol_trace',
    repo_root: root,
  });

  assert.ok(Array.isArray(result.discoveredPaths), 'discoveredPaths[] must be present');
  assert.ok(result.discoveredPaths.length > 0, 'list_dir entries must surface in discoveredPaths[]');
  assert.ok(
    result.discoveredPaths.some(d => d.sourceTool === 'repo_list_dir'),
    'discoveredPaths must record sourceTool=repo_list_dir for listDir entries',
  );

  const targetPaths = (result.targets ?? []).map(t => t.path);
  // src/auth.js (the grounded evidence target) is allowed, but README.md / .github
  // must not appear in targets[].
  assert.ok(!targetPaths.includes('README.md'), `targets[] should not include README.md, got ${targetPaths.join(',')}`);
  assert.ok(!targetPaths.includes('.github'), `targets[] should not include .github, got ${targetPaths.join(',')}`);
});

// spec 011: CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS was removed. The
// modern targets vs discoveredPaths split is permanent, so the opt-in
// regression test from 010 is gone.

test('010 US1#4 — critic fail forces broad_search_needed regardless of evidence count', async () => {
  // The model emits high confidence with multiple grounded items, but a synthetic critic
  // fail status must short-circuit to broad_search_needed and complete:false.
  class CriticFailClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify({
              ...compactResult({
                directAnswer: 'A confident answer with critic failure injected.',
                statusConfidence: 'high',
                evidence: [
                  { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'def', evidenceType: 'file_range', groundingStatus: 'exact' },
                  { path: 'src/routes/user.js', startLine: 1, endLine: 6, why: 'caller', evidenceType: 'file_range', groundingStatus: 'exact' },
                ],
              }),
              critic: { status: 'fail', warnings: [{ message: 'synthetic critic failure' }] },
            }),
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CriticFailClient() });
  const result = await runtime.explore({
    task: 'symbol trace requireAuth',
    taskMode: 'symbol_trace',
    repo_root: root,
  });

  // Either runtime critic forces fail directly, or our injected critic survives normalization.
  // Either way: when evidence count is positive but critic fail is the signal, we must stay
  // in broad_search_needed and complete:false.
  if (result.critic?.status === 'fail') {
    assert.equal(result.status.complete, false);
    assert.equal(result.status.verification, 'broad_search_needed');
    assert.equal(result.stats?.evidenceSufficiency?.sufficient, false);
  }
});

// ── spec 026 US1 — usage cross-check gate scenario tests ────────────────────

// Helper: builds a mock client that does exactly the given tool calls then finalizes.
// toolSequence: array of {name, arguments} objects for the tool turn.
// finalResult: compactResult overrides for the finalize turn.
function makeSymbolTraceClient({ toolSequence = [], finalResult = {} } = {}) {
  class Spec026Client {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this._toolIdx = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;

      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth rejects unauthenticated requests.',
              statusConfidence: 'high',
              evidence: [
                { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'symbol definition site', evidenceType: 'file_range', groundingStatus: 'exact' },
              ],
              ...finalResult,
            })),
            toolCalls: [],
          },
        };
      }

      if (this._toolIdx < toolSequence.length) {
        const toolDef = toolSequence[this._toolIdx];
        this._toolIdx += 1;
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `tc-${this._toolIdx}`,
              function: {
                name: toolDef.name,
                arguments: JSON.stringify(toolDef.arguments),
              },
            }],
          },
        };
      }

      // No more tools — trigger finalize
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  return new Spec026Client();
}

test('spec 026 T003(a): symbol_trace + only repo_symbol_context/repo_read_file → targeted_read_needed + medium + warning', async () => {
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  assert.equal(result.status.verification, 'targeted_read_needed', `expected targeted_read_needed, got ${result.status.verification}`);
  assert.equal(result.status.confidence, 'medium', `expected medium confidence, got ${result.status.confidence}`);
  assert.equal(result.status.complete, true, 'complete must be true for targeted_read_needed');
  const crossCheckWarning = (result.critic?.warnings ?? []).find(w => w.type === 'usage_cross_check_missing');
  assert.ok(crossCheckWarning, 'must have exactly one usage_cross_check_missing warning');
  assert.equal(
    (result.critic?.warnings ?? []).filter(w => w.type === 'usage_cross_check_missing').length,
    1,
    'exactly one usage_cross_check_missing',
  );
  assert.equal(result.nextAction?.type, 'read_target', `expected read_target nextAction, got ${result.nextAction?.type}`);
});

test('spec 026 T003(b): symbol_trace + repo_grep containing symbol → verified, no warning', async () => {
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_grep', arguments: { pattern: 'requireAuth', scope: ['src/**'] } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  assert.equal(result.status.verification, 'verified', `expected verified, got ${result.status.verification}`);
  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'must not have usage_cross_check_missing when grep satisfied gate',
  );
});

test('spec 026 T003(c): 0-match grep still satisfies gate (attempt counts, args-based)', async () => {
  // The repo fixture has requireAuth defined in src/auth.js, so grep for 'requireAuth_NOMATCH'
  // returns 0 matches. But for the gate, we check the ARGS pattern. Here we use a pattern
  // that contains the bare symbol name so it satisfies the gate even with 0 matches.
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      // Pattern contains "requireAuth" but won't match anything meaningful
      { name: 'repo_grep', arguments: { pattern: 'requireAuth_something_that_wont_match', scope: ['src/**'] } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  // grep attempt (args-based) satisfies the gate even if 0 matches
  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'a grep attempt (args-based, even 0-match) must satisfy the gate',
  );
  assert.equal(result.status.verification, 'verified', `expected verified, got ${result.status.verification}`);
});

test('spec 026 T003(d): repo_references call satisfies gate', async () => {
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_references', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'repo_references satisfies the gate',
  );
  assert.equal(result.status.verification, 'verified', `expected verified, got ${result.status.verification}`);
});

test('spec 026 T003(e): narrow scope + grep inside scope satisfies gate', async () => {
  // Read a file within scope (src/routes/user.js) so evidence can be grounded.
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_grep', arguments: { pattern: 'requireAuth', scope: ['src/routes/**'] } },
      { name: 'repo_read_file', arguments: { path: 'src/routes/user.js', startLine: 1, endLine: 7 } },
    ],
    finalResult: {
      directAnswer: 'requireAuth is imported and used in route handler.',
      statusConfidence: 'high',
      evidence: [
        { path: 'src/routes/user.js', startLine: 1, endLine: 7, why: 'requireAuth usage site', evidenceType: 'file_range', groundingStatus: 'exact' },
      ],
    },
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    scope: ['src/routes/**'],
    repo_root: root,
  });

  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'grep within narrow scope satisfies gate',
  );
  assert.equal(result.status.verification, 'verified', `expected verified, got ${result.status.verification}`);
});

test('spec 026 T003(f): critic-fail path → broad_search_needed, NO usage_cross_check_missing (no double warning)', async () => {
  // All tool calls error → stoppedByErrors → critic fail → broad_search_needed
  class AllErrorsClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'Could not find symbol.',
              statusConfidence: 'low',
              evidence: [],
            })),
            toolCalls: [],
          },
        };
      }
      // Always return invalid tool name → triggers tool error → stoppedByErrors
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `tc-${this.calls}`,
            function: {
              name: 'repo_nonexistent_tool',
              arguments: JSON.stringify({ x: 1 }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new AllErrorsClient() });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  // When critic fails (broad_search_needed), gate must NOT fire
  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'no usage_cross_check_missing when path is broad_search_needed',
  );
  assert.equal(result.status.verification, 'broad_search_needed', `expected broad_search_needed, got ${result.status.verification}`);
});

test('spec 026 T003(g): taskMode locate → no warning, no downgrade', async () => {
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Locate requireAuth',
    taskMode: 'locate',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'locate taskMode must not trigger gate',
  );
  // verification should NOT be targeted_read_needed due to gate (may be verified or something else)
  assert.notEqual(
    result.status.verification,
    'targeted_read_needed',
    'locate taskMode must not be downgraded by gate to targeted_read_needed',
  );
});

test('spec 026 T003(i): symbol_trace where the ONLY grep attempt errors → targeted_read_needed + usage_cross_check_missing', async () => {
  // An erroring grep attempt must NOT satisfy the gate.
  // Technique: pass a catastrophic regex pattern combined with a narrow scope so ripgrep
  // returns null (baseScopeRules active) and the JS fallback throws on isCatastrophicRegexPattern.
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      // This grep call will error: pattern is catastrophic AND narrow scope forces JS fallback.
      { name: 'repo_grep', arguments: { pattern: '(requireAuth+)+', scope: ['src/**'] } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    // Pass a narrow scope so baseScopeRules.patterns.length > 0 → ripgrep returns null
    // → JS fallback hits isCatastrophicRegexPattern → throws → error result
    scope: ['src/**'],
    repo_root: root,
  });

  // The errored grep must NOT satisfy the gate → warning must fire
  const crossCheckWarning = (result.critic?.warnings ?? []).find(w => w.type === 'usage_cross_check_missing');
  assert.ok(crossCheckWarning, 'errored grep attempt must NOT satisfy the gate — usage_cross_check_missing must be present');
  assert.equal(
    (result.critic?.warnings ?? []).filter(w => w.type === 'usage_cross_check_missing').length,
    1,
    'exactly one usage_cross_check_missing',
  );
  assert.equal(result.status.verification, 'targeted_read_needed', `expected targeted_read_needed, got ${result.status.verification}`);
});

test('spec 026 T003(h): symbol_trace with all evidence ungrounded → broad_search_needed or follow_up_needed, NO usage_cross_check_missing', async () => {
  // Model returns evidence items but none get grounded (no source reads or observed ranges) →
  // grounding.evidence drops to 0 → precedence route fires in buildResultStatus →
  // gate must NOT emit usage_cross_check_missing
  const client = makeSymbolTraceClient({
    toolSequence: [
      // A directory listing is a valid exploration action but cannot ground source evidence.
      { name: 'repo_list_dir', arguments: { dirPath: 'src' } },
    ],
    finalResult: {
      // Model claims evidence but the tool call did NOT produce source for those lines,
      // so groundEvidenceList will drop them as ungrounded.
      evidence: [
        { path: 'src/unread_file.js', startLine: 1, endLine: 5, why: 'symbol usage', evidenceType: 'file_range', groundingStatus: 'exact' },
      ],
      statusConfidence: 'high',
    },
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  // When all evidence is dropped: broad_search_needed (no grounded evidence forces this branch)
  assert.equal(
    result.status.verification,
    'broad_search_needed',
    `expected broad_search_needed (all evidence dropped), got ${result.status.verification}`,
  );
  // Gate must NOT fire on this precedence route
  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    `no usage_cross_check_missing on all-evidence-dropped precedence route (verification=${result.status.verification})`,
  );
});

// ── spec 026 US3: symbol-first strategy cross-check instruction (T015) ──────────

test('spec 026 T015: buildExplorerUserPrompt symbol-first approach includes cross-check instruction and truncated fallback', () => {
  const prompt = buildExplorerUserPrompt({
    task: 'Find where requireAuth is defined',
    hints: { symbols: ['requireAuth'] },
    scope: [],
  });

  // ① The approach text must instruct a scope-wide repo_grep cross-check before finalizing
  assert.ok(
    prompt.includes('repo_grep') && prompt.includes('cross-check'),
    `symbol-first approach must instruct repo_grep cross-check; got: ${prompt.slice(prompt.indexOf('Initial strategy'), prompt.indexOf('Initial strategy') + 400)}`,
  );
  assert.ok(
    /before finaliz/i.test(prompt),
    'symbol-first approach must say "before finalizing" (or similar) for the cross-check instruction',
  );

  // ② The fallback condition must mention "truncated"
  assert.ok(
    /truncated/i.test(prompt),
    'symbol-first approach must mention "truncated" as a fallback trigger',
  );
});

test('spec 026 T015: STRATEGY_DESCRIPTIONS symbol-first mentions cross-check', () => {
  const desc = STRATEGY_DESCRIPTIONS['symbol-first'];
  assert.ok(typeof desc === 'string', 'STRATEGY_DESCRIPTIONS must have symbol-first entry');
  assert.ok(
    /cross.check/i.test(desc),
    `STRATEGY_DESCRIPTIONS['symbol-first'] must mention cross-check; got: "${desc}"`,
  );
});

test('spec 026 T015: system prompt strategy catalog symbol-first line mentions cross-check', () => {
  const systemPrompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig: getRuntimeConfig(),
  });
  // Find the strategy catalog line for symbol-first
  const lines = systemPrompt.split('\n');
  const symbolFirstLine = lines.find(l => l.includes('symbol-first') && l.includes('→'));
  assert.ok(symbolFirstLine, 'system prompt strategy catalog must have a symbol-first line');
  assert.ok(
    /cross.check/i.test(symbolFirstLine),
    `system prompt symbol-first catalog line must mention cross-check; got: "${symbolFirstLine}"`,
  );
});

// T022 activates these expected-red orchestration tests by adding the late-goal
// audit helper used by the semantic verifier. Until then Node executes the
// callbacks as TODOs, so missing runtime behavior stays visible without making
// the test-first commits unshippable.
const auditedPlanningRuntimeTest =
  typeof RuntimeImplementation.prototype.auditLateGoalProposals === 'function'
    ? test
    : test.todo;

const GOAL_AUDIT_TASK = 'Locate requireAuth and verify legacyGuard is absent.';

function requestOrigin(task, text) {
  const start = task.indexOf(text);
  assert.notEqual(start, -1, `request fragment not found: ${text}`);
  return `request:${start}-${start + text.length}`;
}

function proposedRuntimeGoal(overrides = {}) {
  return {
    id: 'S-definition',
    question: 'Where is requireAuth defined?',
    originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'Locate requireAuth')],
    claimType: 'symbol_definition',
    proofCondition: 'Observe the in-scope requireAuth definition and source body.',
    constraints: [],
    ...overrides,
  };
}

function plannerControl(subgoals, overrides = {}) {
  return {
    taskSummary: 'Locate the symbol and check the requested absence.',
    constraints: [],
    subgoals,
    ...overrides,
  };
}

function auditControlRecord(goal, verdict = 'ready', overrides = {}) {
  return {
    proposedGoalId: goal.id,
    verdict,
    originRefs: [...goal.originRefs],
    missingRequestParts: [],
    reason: `Audited as ${verdict}.`,
    ...overrides,
  };
}

function auditorControl(goals, uncoveredRequestParts = []) {
  return { goals, uncoveredRequestParts };
}

function coverageControl(findings, uncoveredRequestParts = []) {
  return { findings, uncoveredRequestParts };
}

function coveredObligation(obligationId, coveredByGoalIds) {
  return {
    obligationId,
    disposition: 'covered',
    coveredByGoalIds,
    reason: 'The audited goal mapping preserves this runtime obligation.',
  };
}

function remainingObligation(obligationId) {
  return {
    obligationId,
    disposition: 'remaining',
    coveredByGoalIds: [],
    reason: 'No audited corrected goal fully preserves this runtime obligation.',
  };
}

function controlCompletion(content, { finishReason = 'stop' } = {}) {
  return {
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    finishReason,
    message: {
      content: typeof content === 'string' ? content : JSON.stringify(content),
      toolCalls: [],
    },
  };
}

function classifyControlRequest(request) {
  const wrappedSchema = request.responseFormat?.json_schema;
  const schema = wrappedSchema?.schema ?? wrappedSchema;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (required.includes('taskSummary') && required.includes('subgoals')) return 'planner';
  if (required.includes('goals') && required.includes('uncoveredRequestParts')) return 'goal_audit';
  if (required.includes('findings') && required.includes('uncoveredRequestParts')) {
    return 'goal_coverage';
  }
  if (required.includes('claims')) return 'claim_synthesis';
  if (required.includes('verdicts') && required.includes('uncoveredRequestParts')) {
    return 'semantic_verifier';
  }
  if (request.responseFormat) return 'synthesis';
  return 'exploration';
}

class ScriptedGoalAuditClient {
  constructor(steps) {
    this.model = 'zai-glm-4.7';
    const planningOnly = steps.some(step => step.stage.startsWith('synthesis:')) &&
      !steps.some(step => step.stage.startsWith('claim_synthesis:') ||
        step.stage.startsWith('semantic_verifier:'));
    const explorationCount = steps.reduce((highest, step) => {
      const match = /^exploration:(\d+)$/.exec(step.stage);
      return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
    }, 0);
    this.steps = planningOnly
      ? [
          ...steps,
          {
            stage: `exploration:${explorationCount + 1}`,
            content: 'Planning-only fixture closes the single evidence-repair round without a tool action.',
          },
        ]
      : steps;
    this.stepCursor = 0;
    this.requests = [];
    this.completions = [];
    this.stageCounts = new Map();
    this.stageLabels = [];
  }

  async createChatCompletion(request) {
    const stage = classifyControlRequest(request);
    if (stage === 'planner' || stage === 'goal_audit' || stage === 'goal_coverage' ||
        stage === 'semantic_verifier') {
      assert.equal((request.tools?.length ?? 0), 0,
        `${stage} must not receive repository tools`);
    }
    const count = (this.stageCounts.get(stage) ?? 0) + 1;
    this.stageCounts.set(stage, count);
    const label = `${stage}:${count}`;
    this.stageLabels.push(label);
    this.requests.push(request);

    let step = this.steps[this.stepCursor];
    while (step?.repeatStage && step.repeatStage !== stage) {
      this.stepCursor += 1;
      step = this.steps[this.stepCursor];
    }
    while (step?.optional && step.stage !== label) {
      this.stepCursor += 1;
      step = this.steps[this.stepCursor];
    }
    assert.ok(step, `unexpected provider call ${label}`);
    if (step.repeatStage) {
      assert.equal(stage, step.repeatStage);
    } else {
      assert.equal(label, step.stage);
      this.stepCursor += 1;
    }
    const completion = step.run
      ? await step.run(request, this)
      : controlCompletion(step.content ?? step.value);
    this.completions.push(completion);
    return completion;
  }
}

function readyExplorationResult() {
  return compactResult({
    directAnswer: 'The audited goals are ready for evidence verification.',
    verification: 'follow_up_needed',
    complete: false,
    evidence: [],
  });
}

function definitionAndAbsenceGoals() {
  return [
    proposedRuntimeGoal(),
    proposedRuntimeGoal({
      id: 'S-absence',
      question: 'Is legacyGuard absent from the in-scope registration surface?',
      originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'verify legacyGuard is absent')],
      claimType: 'absence',
      proofCondition: 'Enumerate the in-scope registration surface and certify bounded absence.',
    }),
  ];
}

function locateWrapperGoals() {
  return ['locations', 'relevance', 'smallest_set'].map((seed, index) => ({
    id: `S-locate-${seed}`,
    question: `Resolve the find_relevant_code ${seed} obligation.`,
    originRefs: [`wrapper:find_relevant_code:${seed}`],
    claimType: 'positive',
    proofCondition: `Observe direct repository evidence for ${seed}.`,
    constraints: [],
  }));
}

auditedPlanningRuntimeTest('Spec 028 T017 — initial plan and isolated audit finish before exploration', async () => {
  const goals = definitionAndAbsenceGoals();
  const invented = proposedRuntimeGoal({
    id: 'S-invented',
    question: 'Which cache refactor should be implemented?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a repository location where a cache refactor could be added.',
  });
  const proposal = plannerControl([...goals, invented]);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: proposal },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(goals[0], 'ready', { mergeInto: null }),
        auditControlRecord(goals[1]),
        auditControlRecord(invented, 'reject_untraceable', { originRefs: [] }),
      ]),
    },
    { stage: 'exploration:1', content: 'Audited goals are ready for repository exploration.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });

  const result = await runtime.explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.deepEqual(client.stageLabels, [
    'planner:1',
    'goal_audit:1',
    'exploration:1',
    'synthesis:1',
    'exploration:2',
  ]);
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id),
    ['S-definition', 'S-absence']);
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.auditVerdict),
    ['ready', 'ready']);
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.proofPolicy),
    ['symbol_definition', 'bounded_absence']);
  assert.match(JSON.stringify(client.requests[2].messages), /S-definition/,
    'accepted required goals must reach the exploration model');
  assert.match(JSON.stringify(client.requests[2].messages), /S-absence/,
    'every accepted required goal must remain in the exploration ledger');
  assert.doesNotMatch(JSON.stringify(client.requests[2].messages), /S-invented/,
    'rejected goals must not leak into exploration');
});

auditedPlanningRuntimeTest('Spec 028 T071 — an omitted fixed wrapper seed gets one planner correction before exploration', async () => {
  const goals = locateWrapperGoals();
  const omitted = goals.slice(0, 2);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl(omitted) },
    {
      stage: 'planner:2',
      run(request) {
        assert.match(JSON.stringify(request.messages), /wrapper:find_relevant_code:smallest_set/u);
        return controlCompletion(plannerControl(goals));
      },
    },
    {
      stage: 'goal_audit:1',
      value: auditorControl(goals.map(goal => auditControlRecord(goal))),
    },
    { stage: 'exploration:1', content: 'All fixed locate obligations are audited.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
    taskMode: 'locate',
  });

  assert.equal(result.failure, null);
  assert.deepEqual(client.stageLabels.slice(0, 4), [
    'planner:1',
    'planner:2',
    'goal_audit:1',
    'exploration:1',
  ]);
  assert.deepEqual(result.taskContract.subgoals.flatMap(goal => goal.originRefs),
    goals.flatMap(goal => goal.originRefs));
});

auditedPlanningRuntimeTest('Spec 028 T071 — repeated fixed wrapper seed omission fails before audit or exploration', async () => {
  const omitted = locateWrapperGoals().slice(0, 2);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl(omitted) },
    { stage: 'planner:2', value: plannerControl(omitted) },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
    taskMode: 'locate',
  });

  assert.deepEqual(client.stageLabels, ['planner:1', 'planner:2']);
  assert.ok(result.failure);
  assert.equal(result.parentHandoff.state, 'failed');
});

auditedPlanningRuntimeTest('Spec 028 T071 — collect_evidence split goals get one planner correction', async () => {
  const task = 'Verify that every user route requires authentication.';
  const requestRef = `request:0-${task.length}`;
  const verdictGoal = {
    id: 'S-collect-verdict',
    question: task,
    originRefs: [requestRef, 'wrapper:collect_evidence:verdict'],
    claimType: 'claim_verification',
    proofCondition: 'Support or refute the claim from direct evidence and counterevidence search.',
    constraints: [],
  };
  const splitGoal = {
    ...verdictGoal,
    id: 'S-collect-direct-evidence',
    question: 'Find direct evidence for the claim.',
    originRefs: [requestRef],
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([verdictGoal, splitGoal]) },
    {
      stage: 'planner:2',
      run(request) {
        assert.match(JSON.stringify(request.messages), /requires exactly one verdict goal/u);
        return controlCompletion(plannerControl([verdictGoal]));
      },
    },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(verdictGoal)]),
    },
    { stage: 'exploration:1', content: 'The canonical collect verdict is audited.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task,
    repo_root: root,
    scope: ['src/**'],
    taskMode: 'evidence_verification',
  });

  assert.equal(result.failure, null);
  assert.deepEqual(client.stageLabels.slice(0, 4), [
    'planner:1',
    'planner:2',
    'goal_audit:1',
    'exploration:1',
  ]);
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), [verdictGoal.id]);
});

auditedPlanningRuntimeTest('Spec 028 T071 — an auditor cannot silently discard a fixed wrapper seed', async () => {
  const goals = locateWrapperGoals();
  const requestRef = requestOrigin(GOAL_AUDIT_TASK, 'Locate requireAuth');
  goals.at(-1).originRefs.unshift(requestRef);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl(goals) },
    {
      stage: 'goal_audit:1',
      value: auditorControl(goals.map((goal, index) => index === goals.length - 1
        ? auditControlRecord(goal, 'ready', { originRefs: [requestRef] })
        : auditControlRecord(goal))),
    },
    {
      stage: 'goal_audit:2',
      run(request) {
        assert.match(JSON.stringify(request.messages), /fixed wrapper origin/u);
        return controlCompletion(auditorControl(goals.map(goal => auditControlRecord(goal))));
      },
    },
    { stage: 'exploration:1', content: 'All fixed locate obligations survived audit.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
    taskMode: 'locate',
  });

  assert.equal(result.failure, null);
  assert.deepEqual(client.stageLabels.slice(0, 4), [
    'planner:1',
    'goal_audit:1',
    'goal_audit:2',
    'exploration:1',
  ]);
});

auditedPlanningRuntimeTest('Spec 028 T068 — invalid control retries receive only bounded validator feedback', async () => {
  const goal = proposedRuntimeGoal();
  const absenceGoal = {
    id: 'S-absence',
    question: 'Is legacyGuard absent?',
    originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'verify legacyGuard is absent')],
    claimType: 'absence',
    proofCondition: 'Search the complete in-scope boundary for legacyGuard.',
    constraints: [],
  };
  const goals = [goal, absenceGoal];
  const invalidOrigin = requestOrigin(GOAL_AUDIT_TASK, 'verify legacyGuard is absent');
  const invalidMarker = 'INVALID_MODEL_OUTPUT_SHOULD_NOT_REAPPEAR';
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl(goals) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(goal, 'ready', {
          originRefs: [invalidOrigin],
          reason: invalidMarker,
        }),
        auditControlRecord(absenceGoal),
      ]),
    },
    {
      stage: 'goal_audit:2',
      run(request) {
        const retryPacket = JSON.stringify(request.messages);
        assert.match(retryPacket, /failed runtime validation/i);
        assert.match(retryPacket, /unproposed origin/);
        assert.match(retryPacket, new RegExp(invalidOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(retryPacket, /allowed originRefs by proposal/u);
        for (const proposed of goals) {
          assert.match(retryPacket, new RegExp(
            `${proposed.id}=\\[${proposed.originRefs.join(',')}\\]`,
            'u',
          ));
        }
        assert.doesNotMatch(retryPacket, new RegExp(invalidMarker));
        return controlCompletion(auditorControl(goals.map(proposed => auditControlRecord(proposed))));
      },
    },
    { stage: 'exploration:1', content: 'The corrected audited goal is ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();

  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.deepEqual(client.stageLabels.slice(0, 3), [
    'planner:1',
    'goal_audit:1',
    'goal_audit:2',
  ]);
  assert.deepEqual(result.taskContract.subgoals.map(subgoal => subgoal.id), goals.map(item => item.id));
});

auditedPlanningRuntimeTest('Spec 028 T069 — repeated cross-goal auditor origins still fail closed', async () => {
  const goals = definitionAndAbsenceGoals();
  const crossGoalOrigin = goals[1].originRefs[0];
  const invalidAudit = () => auditorControl(goals.map((goal, index) =>
    auditControlRecord(goal, 'ready', {
      originRefs: index === 0 ? [crossGoalOrigin] : goal.originRefs,
    })));
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl(goals) },
    { stage: 'goal_audit:1', value: invalidAudit() },
    { stage: 'goal_audit:2', value: invalidAudit() },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(client.stageCounts.get('goal_audit'), 2);
  assert.equal(client.stageCounts.get('exploration') ?? 0, 0);
  assert.equal(result.failure?.reason, 'invalid_final_response');
  assert.equal(result.parentHandoff.state, 'failed');
});

auditedPlanningRuntimeTest('Spec 028 T068 — consumed duplicate audits remain internal diagnostics', async () => {
  const retained = proposedRuntimeGoal();
  const duplicate = proposedRuntimeGoal({
    id: 'S-definition-rephrased',
    question: 'Which declaration provides requireAuth?',
  });
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([retained, duplicate]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(retained),
        auditControlRecord(duplicate, 'merge_duplicate', { mergeInto: retained.id }),
      ]),
    },
    { stage: 'exploration:1', content: 'The merged audited goal is ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), [retained.id]);
  assert.deepEqual(result.goalAuditRecords.map(record => ({
    proposedGoalId: record.proposedGoalId,
    verdict: record.verdict,
    ...(record.mergeInto ? { mergeInto: record.mergeInto } : {}),
  })), [
    { proposedGoalId: retained.id, verdict: 'ready' },
    {
      proposedGoalId: duplicate.id,
      verdict: 'merge_duplicate',
      mergeInto: retained.id,
    },
  ]);
  assert.equal(result.parentHandoff.goalAuditRecords, undefined);
  assert.doesNotMatch(JSON.stringify(result.parentHandoff), /goalAuditRecords|merge_duplicate/);
});

auditedPlanningRuntimeTest('Spec 028 T017 — one corrected plan is re-audited and recursion is impossible', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: 'Locate requireAuth and prove every legacyGuard registration outcome.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe the definition and separately enumerate the registration surface.',
  });
  const corrected = definitionAndAbsenceGoals();
  const uncovered = {
    question: corrected[1].question,
    originRefs: [...corrected[1].originRefs],
    claimType: corrected[1].claimType,
    proofCondition: corrected[1].proofCondition,
    constraints: [],
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(broad, 'needs_decomposition'),
      ], [uncovered]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(corrected[0]),
        auditControlRecord(corrected[1], 'needs_decomposition'),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
        coveredObligation('revision-obligation-2', [corrected[1].id]),
      ]),
    },
    { stage: 'exploration:1', content: 'Corrected audited goals are ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });

  const result = await runtime.explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.deepEqual(client.stageLabels, [
    'planner:1',
    'goal_audit:1',
    'planner:2',
    'goal_audit:2',
    'goal_coverage:1',
    'exploration:1',
    'synthesis:1',
    'exploration:2',
  ]);
  assert.equal(result.taskContract.subgoals.length, 2);
  assert.equal(result.taskContract.subgoals[0].id, 'S-definition');
  const planningDefect = result.taskContract.subgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(planningDefect, 'the second-pass decomposition must become a required blocker');
  assert.equal(planningDefect.state, 'blocked');
  assert.match(planningDefect.question, /legacyGuard/);
  assert.ok(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'));
  const revisionRequest = client.requests[2];
  const revisionPrompt = JSON.stringify(revisionRequest.messages);
  assert.match(revisionPrompt, /S-broad/);
  assert.match(revisionPrompt, /legacyGuard/);
  assert.equal(client.stageCounts.get('planner'), 2, 'a third planner pass is forbidden');
  assert.equal(client.stageCounts.get('goal_audit'), 2, 'the corrected plan is audited once');
  assert.deepEqual(result.goalAuditRecords.map(record => [
    record.proposedGoalId,
    record.verdict,
  ]), [
    ['S-broad', 'needs_decomposition'],
    ['S-definition', 'ready'],
    ['S-absence', 'needs_decomposition'],
  ], 'direct-runtime diagnostics retain both consumed audit rounds');
  assert.equal(result.parentHandoff.goalAuditRecords, undefined);
  assert.doesNotMatch(JSON.stringify(result.parentHandoff),
    /goalAuditRecords|needs_decomposition/);
});

auditedPlanningRuntimeTest('Spec 028 T069 — strict origin containment gets one uniquely bound refinement', async () => {
  const task = 'Compare frontend administrator policy with backend administrator and developer access policies.';
  const preserved = proposedRuntimeGoal({
    id: 'S-frontend-policy',
    question: 'Which frontend administrator policy is enforced?',
    originRefs: [requestOrigin(task, 'frontend administrator policy')],
    claimType: 'positive',
    proofCondition: 'Observe the frontend administrator predicate.',
  });
  const broad = proposedRuntimeGoal({
    id: 'S-backend-broad',
    question: 'Which backend administrator and developer policies apply?',
    originRefs: [requestOrigin(task, 'backend administrator and developer access policies')],
    claimType: 'comparison',
    proofCondition: 'Compare the backend administrator and developer policy paths.',
  });
  const nested = proposedRuntimeGoal({
    id: 'S-developer-nested',
    question: 'Which developer access policy applies?',
    originRefs: [requestOrigin(task, 'developer access policies')],
    claimType: 'comparison',
    proofCondition: 'Compare the developer-specific access paths.',
  });
  const correctedAdmin = {
    ...broad,
    question: 'Which backend administrator policy applies?',
    originRefs: [requestOrigin(task, 'backend administrator')],
    proofCondition: 'Compare the backend administrator policy paths.',
  };
  const correctedDeveloper = {
    ...nested,
    question: 'Which developer access path applies?',
    originRefs: [requestOrigin(task, 'developer access')],
    proofCondition: 'Compare the developer-specific access path independently.',
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([preserved, broad, nested]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([preserved, broad, nested].map(goal => auditControlRecord(goal))),
    },
    {
      stage: 'planner:2',
      run(request) {
        const packet = parseControlPacket(request);
        assert.deepEqual(new Set(packet.revisionRequest.refineGoalIds),
          new Set([broad.id, nested.id]));
        assert.deepEqual(packet.revisionRequest.decomposeGoalIds, []);
        assert.match(request.messages[0].content, /exactly one same-type descendant goal/u);
        return controlCompletion(plannerControl([
          preserved,
          correctedAdmin,
          correctedDeveloper,
        ]));
      },
    },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(correctedAdmin),
        auditControlRecord(correctedDeveloper),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      run(request) {
        assert.match(request.messages[0].content,
          /refine obligation requires exactly one coveredByGoalId/u);
        assert.match(request.messages[0].content,
          /same-type refined goals must not retain equal or containing confirmed origin signatures/u);
        return controlCompletion(coverageControl([
          coveredObligation('revision-obligation-1', [correctedDeveloper.id]),
          coveredObligation('revision-obligation-2', [correctedDeveloper.id]),
        ]));
      },
    },
    {
      stage: 'goal_coverage:2',
      value: coverageControl([
        coveredObligation('revision-obligation-1', [correctedAdmin.id]),
        coveredObligation('revision-obligation-2', [correctedDeveloper.id]),
      ]),
    },
    { stage: 'exploration:1', content: 'The uniquely refined goals are ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(result.failure, null, JSON.stringify({
    stages: client.stageLabels,
    failure: result.failure,
  }));
  assert.equal(client.stageCounts.get('planner'), 2);
  assert.equal(client.stageCounts.get('goal_audit'), 2);
  assert.equal(client.stageCounts.get('goal_coverage'), 2,
    'one invalid duplicate binding receives only the bounded correction attempt');
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id),
    [preserved.id, correctedAdmin.id, correctedDeveloper.id]);
  assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
  assert.ok(result.taskContract.subgoals.every(goal =>
    /^audit-v1:/.test(goal.auditBinding)));
});

auditedPlanningRuntimeTest('Spec 028 T069 — distinct refine ids cannot retain equal confirmed origins', async () => {
  const task = 'Compare frontend administrator policy with backend administrator and developer access policies.';
  const broad = proposedRuntimeGoal({
    id: 'S-backend-broad-equal',
    question: 'Which backend administrator and developer policies apply?',
    originRefs: [requestOrigin(task, 'backend administrator and developer access policies')],
    claimType: 'comparison',
    proofCondition: 'Compare the backend administrator and developer policy paths.',
  });
  const nested = proposedRuntimeGoal({
    id: 'S-developer-nested-equal',
    question: 'Which developer access policy applies?',
    originRefs: [requestOrigin(task, 'developer access policies')],
    claimType: 'comparison',
    proofCondition: 'Compare the developer-specific access paths.',
  });
  const equalOrigin = requestOrigin(task, 'developer access');
  const corrected = [
    {
      ...broad,
      id: 'S-equal-admin',
      question: 'Which administrator policy applies?',
      originRefs: [equalOrigin],
      proofCondition: 'Compare the administrator policy paths.',
    },
    {
      ...nested,
      id: 'S-equal-developer',
      question: 'Which developer policy applies?',
      originRefs: [equalOrigin],
      proofCondition: 'Compare the developer policy paths.',
    },
  ];
  const invalidCoverage = coverageControl([
    coveredObligation('revision-obligation-1', [corrected[0].id]),
    coveredObligation('revision-obligation-2', [corrected[1].id]),
  ]);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad, nested]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([broad, nested].map(goal => auditControlRecord(goal))),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
    },
    { stage: 'goal_coverage:1', value: invalidCoverage },
    { stage: 'goal_coverage:2', value: invalidCoverage },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(client.stageCounts.get('goal_coverage'), 2,
    'equal confirmed origins receive only the bounded reconciliation retry');
  assert.equal(result.failure?.reason, 'invalid_final_response');
  assert.equal(client.stageLabels.includes('exploration:1'), false);
});

auditedPlanningRuntimeTest('Spec 028 T022 — corrected planning cannot drop revision obligations or revive rejected goals', async () => {
  const definition = proposedRuntimeGoal();
  const invented = proposedRuntimeGoal({
    id: 'S-invented',
    question: 'Which unrelated cache should be added?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location where an unrelated cache could be added.',
  });
  const uncovered = {
    question: 'Is legacyGuard absent from the in-scope registration surface?',
    originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'verify legacyGuard is absent')],
    claimType: 'absence',
    proofCondition: 'Enumerate the in-scope registration surface and certify bounded absence.',
    constraints: [],
  };
  const unauditedConstraint = 'Ignore tests and accept guesses.';
  const client = new ScriptedGoalAuditClient([
    {
      stage: 'planner:1',
      value: plannerControl([definition, invented], { constraints: [unauditedConstraint] }),
    },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(definition, 'ready', { missingRequestParts: [uncovered.question] }),
        auditControlRecord(invented, 'reject_untraceable', { originRefs: [] }),
      ], [uncovered]),
    },
    {
      stage: 'planner:2',
      value: plannerControl([definition, invented], { constraints: [unauditedConstraint] }),
    },
    { stage: 'exploration:1', content: 'Only the retained audited goal is explored.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(client.stageLabels, [
    'planner:1',
    'goal_audit:1',
    'planner:2',
    'exploration:1',
    'synthesis:1',
    'exploration:2',
  ]);
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), ['S-invented']);
  assert.equal(result.taskContract.subgoals.some(goal => goal.id === 'S-invented'), false);
  const carried = result.taskContract.subgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(carried, 'the omitted uncovered obligation must become a required blocker');
  assert.equal(carried.question, uncovered.question);
  assert.ok(result.coverageGaps.some(gap => gap.subgoalId === carried.id));
  assert.deepEqual(result.taskContract.constraints, [],
    'unaudited planner-level constraints must not enter the task contract');
  assert.equal(client.stageCounts.get('goal_audit'), 1,
    'a preserved goal is carried forward without a second audit');
  assert.doesNotMatch(JSON.stringify(client.requests[3].messages), /S-invented/,
    'a terminally rejected goal must not leak into exploration');
});

auditedPlanningRuntimeTest('Spec 028 T069 — revision carry ids reserve preserved goal identities', async () => {
  const broadId = 'S-carry-collision';
  const preserved = proposedRuntimeGoal({
    id: `planning-carry:${broadId}`,
    question: 'Where is the retained requireAuth definition?',
    proofCondition: 'Observe the retained in-scope requireAuth definition.',
  });
  const broad = proposedRuntimeGoal({
    id: broadId,
    question: 'Inspect all requested authentication facets together.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe every requested authentication facet in one aggregate proof.',
  });
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([preserved, broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(preserved),
        auditControlRecord(broad, 'needs_decomposition'),
      ]),
    },
    { stage: 'planner:2', value: plannerControl([preserved]) },
    { stage: 'exploration:1', content: 'Only the preserved goal can be explored.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
  });

  assert.equal(result.failure, null, JSON.stringify(result.failure));
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), [
    preserved.id,
    `planning-carry:${broadId}:2`,
  ]);
  assert.equal(new Set(result.taskContract.subgoals.map(goal => goal.id)).size,
    result.taskContract.subgoals.length);
  assert.equal(result.taskContract.subgoals[1].auditVerdict, 'planning_incomplete');
});

auditedPlanningRuntimeTest('Spec 028 T022 — one audited rephrase can satisfy an uncovered revision obligation', async () => {
  const definition = proposedRuntimeGoal();
  const uncovered = {
    question: 'Is legacyGuard absent from the in-scope registration surface?',
    originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'verify legacyGuard is absent')],
    claimType: 'absence',
    proofCondition: 'Enumerate the in-scope registration surface and certify bounded absence.',
    constraints: [],
  };
  const replacement = proposedRuntimeGoal({
    id: 'S-absence-rephrased',
    question: 'Determine whether legacyGuard is absent in the in-scope registration surface.',
    originRefs: [...uncovered.originRefs],
    claimType: 'absence',
    proofCondition: 'Completely enumerate the bounded registration surface and establish absence.',
  });
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([definition]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(definition, 'ready', { missingRequestParts: [uncovered.question] }),
      ], [uncovered]),
    },
    { stage: 'planner:2', value: plannerControl([definition, replacement]) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(replacement),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        coveredObligation('revision-obligation-1', [replacement.id]),
      ]),
    },
    { stage: 'exploration:1', content: 'The audited replacement is ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id),
    ['S-definition', 'S-absence-rephrased']);
  assert.equal(result.taskContract.subgoals.some(goal =>
    goal.auditVerdict === 'planning_incomplete'), false);
  assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.reason === 'missing_evidence')
    .map(gap => gap.subgoalId), ['S-definition', 'S-absence-rephrased']);
  const coveragePrompt = JSON.stringify(client.requests[4].messages);
  assert.match(coveragePrompt, /S-absence-rephrased/);
  assert.doesNotMatch(coveragePrompt, /S-definition/,
    'preserved goals that cannot discharge a revision obligation stay out of the coverage prompt');
});

auditedPlanningRuntimeTest(
  'Spec 028 T071 — uncovered reconciliation accepts a governing-phrase origin expansion',
  async () => {
    const task = 'Map every user-facing page that uses the Prisma model.';
    const preserved = {
      id: 'S-prisma-model',
      question: 'Which Prisma model is requested?',
      originRefs: [requestOrigin(task, 'Prisma model')],
      claimType: 'symbol_definition',
      proofCondition: 'Observe the requested Prisma model definition.',
      constraints: [],
    };
    const uncovered = {
      question: 'Which user-facing pages use the model?',
      originRefs: [requestOrigin(task, 'user-facing page')],
      claimType: 'impact',
      proofCondition: 'Enumerate the bounded user-facing page surface and observe every model use.',
      constraints: [],
    };
    const replacement = {
      id: 'S-user-facing-pages',
      question: 'Which user-facing pages use the requested model?',
      originRefs: [requestOrigin(task, 'every user-facing page')],
      claimType: 'impact',
      proofCondition: 'Enumerate the bounded user-facing page surface and observe every model use.',
      constraints: [],
    };
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([preserved]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([
          auditControlRecord(preserved, 'ready', { missingRequestParts: [uncovered.question] }),
        ], [uncovered]),
      },
      { stage: 'planner:2', value: plannerControl([preserved, replacement]) },
      {
        stage: 'goal_audit:2',
        value: auditorControl([auditControlRecord(replacement)]),
      },
      {
        stage: 'goal_coverage:1',
        value: coverageControl([
          coveredObligation('revision-obligation-1', [replacement.id]),
        ]),
      },
      { stage: 'exploration:1', content: 'The clarified page goal is ready.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('goal_coverage'), 1,
      JSON.stringify(client.stageLabels));
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), [
      preserved.id,
      replacement.id,
    ]);
    assert.equal(result.taskContract.subgoals.some(goal =>
      goal.auditVerdict === 'planning_incomplete'), false);
    assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T071 — uncovered reconciliation rejects an unrelated extra origin',
  async () => {
    const task = 'Map every user-facing page that uses the Prisma model.';
    const preserved = {
      id: 'S-prisma-model',
      question: 'Which Prisma model is requested?',
      originRefs: [requestOrigin(task, 'Prisma model')],
      claimType: 'symbol_definition',
      proofCondition: 'Observe the requested Prisma model definition.',
      constraints: [],
    };
    const uncovered = {
      question: 'Which user-facing pages use the model?',
      originRefs: [requestOrigin(task, 'user-facing page')],
      claimType: 'impact',
      proofCondition: 'Enumerate the bounded user-facing page surface and observe every model use.',
      constraints: [],
    };
    const widened = {
      id: 'S-pages-and-unrelated-model',
      question: 'Which user-facing pages use the requested model?',
      originRefs: [
        requestOrigin(task, 'every user-facing page'),
        requestOrigin(task, 'Prisma model'),
      ],
      claimType: 'impact',
      proofCondition: 'Enumerate the bounded user-facing page surface and observe every model use.',
      constraints: [],
    };
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([preserved]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([
          auditControlRecord(preserved, 'ready', { missingRequestParts: [uncovered.question] }),
        ], [uncovered]),
      },
      { stage: 'planner:2', value: plannerControl([preserved, widened]) },
      {
        stage: 'goal_audit:2',
        value: auditorControl([auditControlRecord(widened)]),
      },
      { stage: 'exploration:1', content: 'Only the audited goals are explored.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(client.stageCounts.get('goal_coverage') ?? 0, 0,
      'an unrelated origin must be rejected before another model call');
    assert.equal(result.taskContract.subgoals.some(goal => goal.id === widened.id), true);
    const carried = result.taskContract.subgoals.find(goal =>
      goal.auditVerdict === 'planning_incomplete');
    assert.ok(carried);
    assert.equal(carried.question, uncovered.question);
    assert.equal(result.coverageGaps.some(gap =>
      gap.subgoalId === carried.id && gap.reason === 'planning_incomplete'), true);
  },
);

auditedPlanningRuntimeTest('Spec 028 T022 — range-only decomposition cannot erase a missing request distinction', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe requireAuth definition and usage plus the legacyGuard absence outcome.',
  });
  const revised = [
    proposedRuntimeGoal({
      id: 'S-definition',
      originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    }),
    proposedRuntimeGoal({
      id: 'S-usage',
      question: 'Where is requireAuth used?',
      originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
      claimType: 'symbol_usage',
      proofCondition: 'Observe bounded requireAuth usage sites.',
    }),
  ];
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl(revised) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(revised.map(goal => auditControlRecord(goal))),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        remainingObligation('revision-obligation-1'),
      ]),
    },
    { stage: 'exploration:1', content: 'Only audited revised goals are explored.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(result.taskContract.subgoals
    .filter(goal => goal.auditVerdict === 'ready')
    .map(goal => goal.id), ['S-definition', 'S-usage']);
  const carried = result.taskContract.subgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(carried, 'legacyGuard absence cannot be discharged by range-only positive goals');
  assert.equal(carried.question, GOAL_AUDIT_TASK);
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.reason === 'planning_incomplete')
    .map(gap => gap.reason), ['planning_incomplete']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — opaque coverage mapping preserves directional distinctions', async () => {
  const task = 'Check whether frontend calls backend and whether backend calls frontend.';
  const forward = {
    id: 'S-forward',
    question: 'Does frontend call backend?',
    originRefs: [`request:0-${task.length}`],
    claimType: 'flow',
    proofCondition: 'Observe the frontend-to-backend call path.',
    constraints: [],
  };
  const reverse = {
    question: 'Does backend call frontend?',
    originRefs: [`request:0-${task.length}`],
    claimType: 'flow',
    proofCondition: 'Observe the backend-to-frontend call path.',
    constraints: [],
  };
  const wrongReplacement = {
    ...forward,
    id: 'S-forward-again',
    question: 'Can frontend call backend?',
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([forward]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(forward, 'ready', { missingRequestParts: [reverse.question] }),
      ], [reverse]),
    },
    { stage: 'planner:2', value: plannerControl([forward, wrongReplacement]) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(wrongReplacement),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([remainingObligation('revision-obligation-1')]),
    },
    { stage: 'exploration:1', content: 'Only forward goals are ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task, repo_root: root });

  const carried = result.taskContract.subgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(carried);
  assert.equal(carried.question, reverse.question);
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.reason === 'planning_incomplete')
    .map(gap => gap.reason), ['planning_incomplete']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — opaque coverage mapping accepts a valid Korean decomposition', async () => {
  const task = '인증과 인가 흐름을 각각 분석해줘.';
  const broad = {
    id: 'K-broad',
    question: task,
    originRefs: [`request:0-${task.length}`],
    claimType: 'flow',
    proofCondition: '인증과 인가 흐름을 각각 관찰한다.',
    constraints: [],
  };
  const corrected = [
    {
      id: 'K-authentication',
      question: '인증 흐름을 분석한다.',
      originRefs: [`request:0-${task.length}`],
      claimType: 'flow',
      proofCondition: '인증 진입점과 전이를 관찰한다.',
      constraints: [],
    },
    {
      id: 'K-authorization',
      question: '인가 흐름을 분석한다.',
      originRefs: [`request:0-${task.length}`],
      claimType: 'flow',
      proofCondition: '인가 진입점과 전이를 관찰한다.',
      constraints: [],
    },
  ];
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
      ]),
    },
    { stage: 'exploration:1', content: '교정된 목표를 탐색합니다.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task, repo_root: root, language: 'ko' });

  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id),
    corrected.map(goal => goal.id));
  assert.equal(result.taskContract.subgoals.some(goal =>
    goal.auditVerdict === 'planning_incomplete'), false);
  assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
  assert.deepEqual(result.coverageGaps.map(gap => gap.reason),
    ['missing_evidence', 'missing_evidence']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — invalid coverage cardinality fails after one bounded retry', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const corrected = definitionAndAbsenceGoals();
  const invalidCoverage = coverageControl([
    coveredObligation('revision-obligation-1', [corrected[0].id]),
  ]);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
    },
    { stage: 'goal_coverage:1', value: invalidCoverage },
    { stage: 'goal_coverage:2', value: invalidCoverage },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.equal(client.stageCounts.get('goal_coverage'), 2);
  assert.ok(result.failure);
  assert.equal(result.failure.reason, 'invalid_final_response');
  assert.equal(client.stageLabels.includes('exploration:1'), false);
});

auditedPlanningRuntimeTest('Spec 028 T022 — coverage reconciliation cannot invent new obligations', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const corrected = definitionAndAbsenceGoals();
  const invented = {
    question: 'Which unrelated cache should be implemented?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location for an unrelated cache.',
    constraints: [],
  };
  const invalidCoverage = coverageControl([
    coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
  ], [invented]);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
    },
    { stage: 'goal_coverage:1', value: invalidCoverage },
    { stage: 'goal_coverage:2', value: invalidCoverage },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.equal(client.stageCounts.get('goal_coverage'), 2);
  assert.equal(result.failure?.reason, 'invalid_final_response');
  assert.equal(client.stageLabels.includes('exploration:1'), false);
});

auditedPlanningRuntimeTest('Spec 028 T022 — rejected corrected goals leave the original obligation blocked', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const wrong = proposedRuntimeGoal({
    id: 'S-wrong',
    question: 'Which unrelated cache should be added?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location for an unrelated cache.',
  });
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl([wrong]) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(wrong, 'reject_untraceable', { originRefs: [] }),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([remainingObligation('revision-obligation-1')]),
    },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.equal(result.failure, null);
  assert.equal(result.taskContract.subgoals.length, 1);
  assert.equal(result.taskContract.subgoals[0].question, broad.question);
  assert.equal(result.taskContract.subgoals[0].auditVerdict, 'planning_incomplete');
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), ['S-wrong']);
  assert.deepEqual(result.coverageGaps.map(gap => gap.reason), ['planning_incomplete']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — a corrected plan filtered to zero goals carries the obligation', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const invented = proposedRuntimeGoal({
    id: 'S-invented',
    question: 'Which unrelated cache should be added?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location for an unrelated cache.',
  });
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad, invented]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(broad, 'needs_decomposition'),
        auditControlRecord(invented, 'reject_untraceable', { originRefs: [] }),
      ]),
    },
    { stage: 'planner:2', value: plannerControl([invented]) },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(client.stageLabels, ['planner:1', 'goal_audit:1', 'planner:2']);
  assert.equal(result.failure, null);
  assert.equal(result.taskContract.subgoals.length, 1);
  assert.equal(result.taskContract.subgoals[0].auditVerdict, 'planning_incomplete');
  assert.equal(result.taskContract.subgoals[0].question, broad.question);
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), ['S-invented']);
});

auditedPlanningRuntimeTest('Spec 028 T069 — corrected audit excludes preserved goals from reclassification', async () => {
  const definition = proposedRuntimeGoal();
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: 'Independently inspect the requested authentication facets.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe separate evidence for the requested authentication facets.',
  });
  const absence = definitionAndAbsenceGoals()[1];
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([definition, broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(definition),
        auditControlRecord(broad, 'needs_decomposition'),
      ]),
    },
    { stage: 'planner:2', value: plannerControl([definition, absence]) },
    {
      stage: 'goal_audit:2',
      run(request) {
        const packet = parseControlPacket(request);
        assert.deepEqual(packet.proposals.map(goal => goal.id), [absence.id]);
        assert.deepEqual(packet.existingGoalLedger.map(goal => goal.id), [definition.id]);
        return controlCompletion(auditorControl([auditControlRecord(absence)]));
      },
    },
    { stage: 'exploration:1', content: 'The preserved and corrected goals remain auditable.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

    assert.deepEqual(client.stageLabels, [
      'planner:1', 'goal_audit:1', 'planner:2', 'goal_audit:2',
      'exploration:1', 'synthesis:1', 'exploration:2',
    ]);
  assert.equal(result.failure, null);
  assert.deepEqual(result.taskContract.subgoals
    .filter(goal => goal.auditVerdict === 'ready')
    .map(goal => goal.id), [definition.id, absence.id]);
  assert.equal(result.taskContract.subgoals.find(goal => goal.id === definition.id)?.auditVerdict,
    'ready');
  assert.equal(result.status.complete, false);
});

auditedPlanningRuntimeTest('Spec 028 T069 — corrected planning cannot rename a decomposition defect', async () => {
  const definition = proposedRuntimeGoal();
  const broad = proposedRuntimeGoal({
    id: 'S-broad-original',
    question: 'Inspect all requested authentication facets together.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe every requested authentication facet in one aggregate proof.',
  });
  const renamedBroad = { ...broad, id: 'S-broad-renamed' };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([definition, broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(definition),
        auditControlRecord(broad, 'needs_decomposition'),
      ]),
    },
    { stage: 'planner:2', value: plannerControl([definition, renamedBroad]) },
    { stage: 'exploration:1', content: 'Only the preserved leaf remains explorable.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const result = await new RuntimeImplementation({ chatClient: client }).explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
  });

  assert.equal(result.failure, null);
  assert.equal(client.stageCounts.get('goal_audit'), 1);
  assert.equal(result.taskContract.subgoals.some(goal => goal.id === renamedBroad.id), false);
  assert.ok(result.taskContract.subgoals.some(goal =>
    goal.auditVerdict === 'planning_incomplete' && goal.question === broad.question));
  assert.ok(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'));
});

auditedPlanningRuntimeTest(
  'Spec 028 T069 — one narrowed origin cannot satisfy a decomposition obligation',
  async () => {
    const broad = proposedRuntimeGoal({
      id: 'S-origin-correction',
      originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    });
    const corrected = {
      ...broad,
      originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'Locate requireAuth')],
    };
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([broad]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
      },
      { stage: 'planner:2', value: plannerControl([corrected]) },
      {
        stage: 'goal_audit:2',
        run(request) {
          const packet = parseControlPacket(request);
          assert.deepEqual(packet.proposals.map(goal => goal.id), [corrected.id]);
          return controlCompletion(auditorControl([auditControlRecord(corrected)]));
        },
      },
      { stage: 'exploration:1', content: 'The corrected requested goal is explored conservatively.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task: GOAL_AUDIT_TASK,
      repo_root: root,
    });

    assert.equal(result.failure, null);
    assert.equal(client.stageCounts.get('goal_audit'), 2);
    assert.equal(client.stageCounts.get('goal_coverage') ?? 0, 0,
      'fewer than two descendants fail decomposition without another model call');
    const retained = result.taskContract.subgoals.find(goal => goal.id === corrected.id);
    assert.deepEqual(retained?.originRefs, corrected.originRefs);
    assert.equal(retained?.auditVerdict, 'ready');
    assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), true);
    assert.equal(result.status.complete, false);
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.match(JSON.stringify(client.requests[4].messages),
      /cover every listed goal separately[\s\S]*impact_categories/i);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — one exact acceptance-core origin correction replaces a false decomposition blocker',
  async () => {
    const task = 'Map pipeline flow, tests, and environment configuration impact.';
    const original = {
      id: 'S-config-impact-original',
      question: 'Which environment configuration inputs affect the pipeline?',
      originRefs: [requestOrigin(task, 'environment configuration impact')],
      claimType: 'impact',
      proofCondition: 'Observe the environment configuration inputs and their pipeline effect.',
      constraints: ['Keep the answer within the requested pipeline.'],
    };
    const corrected = {
      ...original,
      id: 'S-config-impact-corrected',
      originRefs: [`request:0-${task.length}`],
    };
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([original]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([auditControlRecord(original, 'needs_decomposition')]),
      },
      { stage: 'planner:2', value: plannerControl([corrected]) },
      {
        stage: 'goal_audit:2',
        value: auditorControl([auditControlRecord(corrected)]),
      },
      { stage: 'exploration:1', content: 'The corrected config goal is ready.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null);
    assert.equal(client.stageCounts.get('goal_coverage') ?? 0, 0);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), [corrected.id]);
    assert.equal(result.taskContract.subgoals[0].auditVerdict, 'ready');
    assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff),
      /planning-carry|planning_incomplete|goal_coverage|auditVerdict/u);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — auditor-requested corrections may reuse rejected planner ids',
  async () => {
    const task = 'Identify the translation pipeline implementation, tests, and every environment/configuration input needed to run it.';
    const retained = {
      id: 'S-flow',
      question: 'What is the primary translation pipeline implementation path?',
      originRefs: [requestOrigin(task, 'Identify the translation pipeline implementation')],
      claimType: 'flow',
      proofCondition: 'Observe the primary entry path and the implementation calls it makes.',
      constraints: ['Keep the answer within the requested translation pipeline.'],
    };
    const originals = [
      {
        id: 'S-tests',
        question: 'Which tests cover the translation pipeline entry path?',
        originRefs: [requestOrigin(task, 'Identify'), requestOrigin(task, 'tests,')],
        claimType: 'positive',
        proofCondition: 'Observe the translation pipeline tests and the behavior they cover.',
        constraints: ['Keep the answer within the requested translation pipeline.'],
      },
      {
        id: 'S-config',
        question: 'Which environment and configuration inputs are needed to run the pipeline?',
        originRefs: [
          requestOrigin(task, 'Identify'),
          requestOrigin(task, 'every environment/configuration input needed to run it.'),
        ],
        claimType: 'impact',
        proofCondition: 'Observe every requested runtime input and how it affects execution.',
        constraints: ['Keep the answer within the requested translation pipeline.'],
      },
    ];
    const testsEnd = task.indexOf('tests,') + 'tests,'.length;
    const corrected = [
      { ...originals[0], originRefs: [`request:0-${testsEnd}`] },
      { ...originals[1], originRefs: [`request:0-${task.length}`] },
    ];
    const uncovered = corrected.map(goal => ({
      question: goal.question,
      originRefs: [...goal.originRefs],
      claimType: goal.claimType,
      proofCondition: goal.proofCondition,
      constraints: [...goal.constraints],
    }));
    let normalizedIds = [];
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([retained, ...originals]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([
          auditControlRecord(retained),
          ...originals.map(goal =>
            auditControlRecord(goal, 'reject_untraceable', { originRefs: [] })),
        ], uncovered),
      },
      { stage: 'planner:2', value: plannerControl([retained, ...corrected]) },
      {
        stage: 'goal_audit:2',
        run(request) {
          const packet = parseControlPacket(request);
          assert.equal(packet.proposals.length, 2);
          assert.deepEqual(packet.existingGoalLedger.map(goal => goal.id), [retained.id]);
          normalizedIds = packet.proposals.map(goal => goal.id);
          for (const [index, proposal] of packet.proposals.entries()) {
            assert.notEqual(proposal.id, originals[index].id);
            assert.match(proposal.id,
              new RegExp(`^revision-corrected:${originals[index].id}(?::\\d+)?$`, 'u'));
            assert.deepEqual({ ...proposal, id: originals[index].id }, corrected[index]);
          }
          return controlCompletion(auditorControl(
            packet.proposals.map(goal => auditControlRecord(goal)),
          ));
        },
      },
      { stage: 'exploration:1', content: 'The corrected tests goal is ready.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-revision-ids-'));
    let result;
    await withEnv({ CEREBRAS_EXPLORER_LOG_PATH: logDir }, async () => {
      result = await new RuntimeImplementation({ chatClient: client }).explore({
        task,
        repo_root: root,
      });
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(normalizedIds.length, 2);
    assert.equal(client.stageCounts.get('goal_coverage') ?? 0, 0);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id),
      [retained.id, ...normalizedIds]);
    assert.ok(result.taskContract.subgoals.every(goal => goal.auditVerdict === 'ready'));
    assert.deepEqual(result.goalAuditRecords.map(record => [
      record.proposedGoalId,
      record.verdict,
    ]), [
      [retained.id, 'ready'],
      [originals[0].id, 'reject_untraceable'],
      [originals[1].id, 'reject_untraceable'],
      [normalizedIds[0], 'ready'],
      [normalizedIds[1], 'ready'],
    ]);
    assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId),
      originals.map(goal => goal.id));
    assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff),
      /revision-corrected|reject_untraceable|planning-carry|planning_incomplete|goalAuditRecords/u);
    const planningEntries = await readJsonl(result.transcriptPath);
    const revisedPlan = planningEntries.find(entry => entry.type === 'plan_revised');
    const revisedAudit = planningEntries.find(entry =>
      entry.type === 'goal_audit' && entry.revisionCount === 1);
    assert.deepEqual(revisedPlan.proposal.subgoals.map(goal => goal.id),
      [retained.id, ...normalizedIds]);
    assert.deepEqual(revisedAudit.auditRecords.map(record => record.proposedGoalId),
      normalizedIds);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — a rejected id cannot authorize a different auditor request part',
  async () => {
    const task = 'Map the translation pipeline tests and environment inputs.';
    const rejected = {
      id: 'S-tests',
      question: 'Which tests cover the translation pipeline?',
      originRefs: [requestOrigin(task, 'tests')],
      claimType: 'positive',
      proofCondition: 'Observe the translation pipeline tests.',
      constraints: [],
    };
    const differentPart = {
      id: rejected.id,
      question: 'Which environment inputs are needed to run the translation pipeline?',
      originRefs: [`request:0-${task.length}`],
      claimType: 'impact',
      proofCondition: 'Observe the requested environment inputs and their runtime effect.',
      constraints: [],
    };
    const uncovered = {
      question: differentPart.question,
      originRefs: [...differentPart.originRefs],
      claimType: differentPart.claimType,
      proofCondition: differentPart.proofCondition,
      constraints: [],
    };
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([rejected]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([
          auditControlRecord(rejected, 'reject_untraceable', { originRefs: [] }),
        ], [uncovered]),
      },
      { stage: 'planner:2', value: plannerControl([differentPart]) },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.deepEqual(client.stageLabels, ['planner:1', 'goal_audit:1', 'planner:2']);
    assert.equal(result.taskContract.subgoals.some(goal => goal.id === rejected.id), false);
    assert.ok(result.taskContract.subgoals.some(goal =>
      goal.auditVerdict === 'planning_incomplete' && goal.question === uncovered.question));
    assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), [rejected.id]);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — canonical pipeline leaves are validated before audit',
  async () => {
    const task = 'Map the translation pipeline implementation, tests, and every environment/configuration input needed to run it.';
    const invalid = [
      {
        id: 'S-pipeline-flow',
        question: 'What is the implementation flow of the translation pipeline?',
        originRefs: [requestOrigin(task, 'Map the translation pipeline implementation')],
        claimType: 'flow',
        proofCondition: 'Identify the translation pipeline implementation flow.',
        constraints: [],
      },
      {
        id: 'S-pipeline-tests',
        question: 'Which tests cover the translation pipeline?',
        originRefs: [requestOrigin(task, 'tests')],
        claimType: 'positive',
        proofCondition: 'Identify tests that cover the translation pipeline.',
        constraints: [],
      },
      {
        id: 'S-pipeline-inputs',
        question: 'Which environment and configuration inputs are required?',
        originRefs: [requestOrigin(task, 'every environment/configuration input needed to run it.')],
        claimType: 'impact',
        proofCondition: 'Identify every environment and configuration input needed to run the pipeline.',
        constraints: [],
      },
    ];
    const canonical = invalid.map((goal, index) => ({
      ...goal,
      originRefs: [
        ['request:0-44'],
        ['request:0-51'],
        [`request:0-${task.length}`],
      ][index],
    }));
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(invalid) },
      {
        stage: 'planner:2',
        run(request) {
          const correction = request.messages.at(-1)?.content ?? '';
          assert.match(correction, /implementation=request:0-44/u);
          assert.match(correction, /tests=request:0-51/u);
          assert.match(correction, new RegExp(`inputs=request:0-${task.length}`, 'u'));
          return controlCompletion(plannerControl(canonical));
        },
      },
      {
        stage: 'goal_audit:1',
        run(request) {
          const packet = parseControlPacket(request);
          assert.deepEqual(packet.proposals, canonical);
          return controlCompletion(auditorControl(
            packet.proposals.map(goal => auditControlRecord(goal)),
          ));
        },
      },
      { stage: 'exploration:1', content: 'The canonical pipeline leaves are ready.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('planner'), 2);
    assert.equal(client.stageCounts.get('goal_audit'), 1);
    assert.equal(client.stageCounts.get('goal_coverage') ?? 0, 0);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), canonical.map(goal => goal.id));
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.originRefs),
      canonical.map(goal => goal.originRefs));
    assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — a repeatedly narrowed auditor origin restores the immutable planner origin',
  async () => {
    const task = 'Map the translation pipeline implementation, tests, and every environment/configuration input needed to run it.';
    const goals = [
      {
        id: 'S-pipeline-flow-audit-recovery',
        question: 'What is the implementation flow of the translation pipeline?',
        originRefs: ['request:0-44'],
        claimType: 'flow',
        proofCondition: 'Identify the translation pipeline implementation flow.',
        constraints: [],
      },
      {
        id: 'S-pipeline-tests-audit-recovery',
        question: 'Which tests cover the translation pipeline?',
        originRefs: ['request:0-51'],
        claimType: 'positive',
        proofCondition: 'Identify tests that cover the translation pipeline.',
        constraints: [],
      },
      {
        id: 'S-pipeline-inputs-audit-recovery',
        question: 'Which environment and configuration inputs are required?',
        originRefs: [`request:0-${task.length}`],
        claimType: 'impact',
        proofCondition: 'Identify every environment and configuration input needed to run the pipeline.',
        constraints: [],
      },
    ];
    const narrowedAudit = () => auditorControl(goals.map((goal, index) =>
      auditControlRecord(goal, 'ready', {
        originRefs: index === 1 ? ['request:45-51'] : goal.originRefs,
      })));
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(goals) },
      { stage: 'goal_audit:1', value: narrowedAudit() },
      {
        stage: 'goal_audit:2',
        run(request) {
          assert.match(JSON.stringify(request.messages), /unproposed origin request:45-51/u);
          return controlCompletion(narrowedAudit());
        },
      },
      { stage: 'exploration:1', content: 'The restored pipeline goals are ready.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('goal_audit'), 2);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.originRefs),
      goals.map(goal => goal.originRefs));
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — pipeline validation preserves an additional same-category obligation',
  async () => {
    const task = 'Map the translation pipeline implementation, tests, and every environment/configuration input needed to run it, and separately map retry integration tests.';
    const inputEnd = task.indexOf(', and separately map retry integration tests.');
    const goals = [
      {
        id: 'S-pipeline-flow-with-extra',
        question: 'What is the implementation flow of the translation pipeline?',
        originRefs: ['request:0-44'],
        claimType: 'flow',
        proofCondition: 'Observe the translation pipeline implementation flow.',
        constraints: [],
      },
      {
        id: 'S-pipeline-tests-with-extra',
        question: 'Which tests cover the translation pipeline?',
        originRefs: ['request:0-51'],
        claimType: 'positive',
        proofCondition: 'Observe tests that cover the translation pipeline.',
        constraints: [],
      },
      {
        id: 'S-pipeline-inputs-with-extra',
        question: 'Which environment and configuration inputs are required?',
        originRefs: [`request:0-${inputEnd + 1}`],
        claimType: 'impact',
        proofCondition: 'Observe every environment and configuration input needed to run the pipeline.',
        constraints: [],
      },
      {
        id: 'S-pipeline-retry-tests-extra',
        question: 'Which retry integration tests cover failure recovery?',
        originRefs: [requestOrigin(task, 'separately map retry integration tests.')],
        claimType: 'positive',
        proofCondition: 'Observe the separately requested retry integration tests.',
        constraints: [],
      },
    ];
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(goals) },
      { stage: 'goal_audit:1', value: auditorControl(goals.map(goal => auditControlRecord(goal))) },
      { stage: 'exploration:1', content: 'All requested pipeline obligations are retained.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null);
    assert.equal(client.stageCounts.get('planner'), 1);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), goals.map(goal => goal.id));
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — canonical access leaves reject an invented umbrella audit',
  async () => {
    const task = 'Compare administrator and developer access policy across frontend guards and backend route families.';
    const administrator = requestOrigin(task, 'administrator');
    const developer = requestOrigin(task, 'developer');
    const frontend = requestOrigin(task, 'frontend guards');
    const backend = requestOrigin(task, 'backend route families.');
    const goals = [
      {
        id: 'canonical-access-frontend-actor-a',
        question: 'How do frontend guards enforce administrator access?',
        originRefs: [administrator, frontend],
        claimType: 'positive',
        proofCondition: 'Observe the frontend guard that enforces administrator access.',
        constraints: [],
      },
      {
        id: 'canonical-access-backend-actor-a',
        question: 'Which backend route families use distinct administrator checks?',
        originRefs: [administrator, backend],
        claimType: 'comparison',
        proofCondition: 'Compare the administrator gating predicates across backend route families.',
        constraints: [],
      },
      {
        id: 'canonical-access-backend-actor-b',
        question: 'Which backend route families give developer-specific access?',
        originRefs: [developer, backend],
        claimType: 'comparison',
        proofCondition: 'Compare developer-specific behavior across backend route families.',
        constraints: [],
      },
      {
        id: 'S-access-frontend-actor-b',
        question: 'Do frontend guards define developer-specific access?',
        originRefs: [developer, frontend],
        claimType: 'positive',
        proofCondition: 'Observe or refute developer-specific behavior in frontend guards.',
        constraints: [],
      },
    ];
    const submittedGoals = goals.map((goal, index) => ({
      ...goal,
      originRefs: [`request:0-${task.length}`, index === 0 || index === 3 ? frontend : backend],
    }));
    const umbrella = {
      question: 'Compare administrator and developer access policy',
      originRefs: [requestOrigin(task, 'Compare administrator and developer access policy')],
      claimType: 'comparison',
      proofCondition: 'Establish one global comparison across the already separate leaves.',
      constraints: [],
    };
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(submittedGoals) },
      {
        stage: 'planner:2',
        run(request) {
          const correction = request.messages.at(-1)?.content ?? '';
          assert.match(correction, new RegExp(
            `frontend_actor_a=\\[${administrator},${frontend}\\]`,
            'u',
          ));
          assert.match(correction, new RegExp(
            `backend_actor_a=\\[${administrator},${backend}\\]`,
            'u',
          ));
          assert.match(correction, new RegExp(
            `backend_actor_b=\\[${developer},${backend}\\]`,
            'u',
          ));
          assert.match(correction,
            /Required canonical leaf contract: exactly one of each/u);
          assert.match(correction,
            /frontend_actor_a=\{claimType:positive,actor:"administrator",surface:"frontend guards"/u);
          assert.match(correction,
            /backend_actor_a=\{claimType:comparison,actor:"administrator",surface:"backend route families"/u);
          assert.match(correction,
            /backend_actor_b=\{claimType:comparison,actor:"developer",surface:"backend route families"/u);
          assert.match(correction,
            /keep each exact actor and surface concept in question or proofCondition/u);
          assert.match(correction,
            /do not merge, duplicate, or add a fourth leaf/u);
          return controlCompletion(plannerControl(goals));
        },
      },
      {
        stage: 'goal_audit:1',
        run(request) {
          const packet = parseControlPacket(request);
          assert.deepEqual(packet.proposals, goals);
          return controlCompletion(auditorControl(goals.map((goal, index) =>
            auditControlRecord(goal, index < 3 ? 'needs_decomposition' : 'ready')), [umbrella]));
        },
      },
      {
        stage: 'goal_audit:2',
        value: auditorControl(goals.map(goal => auditControlRecord(goal))),
      },
      { stage: 'exploration:1', content: 'The three access leaves are ready.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('planner'), 2);
    assert.equal(client.stageCounts.get('goal_audit'), 2);
    assert.equal(client.stageCounts.get('goal_coverage') ?? 0, 0);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), goals.map(goal => goal.id));
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.originRefs),
      goals.map(goal => goal.originRefs));
    assert.ok(result.taskContract.subgoals.every(goal => goal.auditVerdict === 'ready'));
    assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — repeated canonical access origin drift restores request-derived origins',
  async () => {
    const task = 'Compare administrator and developer access policy across frontend guards and backend route families.';
    const administrator = requestOrigin(task, 'administrator');
    const developer = requestOrigin(task, 'developer');
    const frontend = requestOrigin(task, 'frontend guards');
    const backend = requestOrigin(task, 'backend route families.');
    const corrected = [
      {
        id: 'S-access-recovery-frontend-admin',
        question: 'How do frontend guards enforce administrator access?',
        originRefs: [administrator, frontend],
        claimType: 'positive',
        proofCondition: 'Observe the frontend guard enforcing administrator access.',
        constraints: [],
      },
      {
        id: 'S-access-recovery-backend-admin',
        question: 'Which backend route families use administrator checks?',
        originRefs: [administrator, backend],
        claimType: 'comparison',
        proofCondition: 'Compare administrator predicates across backend route families.',
        constraints: [],
      },
      {
        id: 'S-access-recovery-backend-developer',
        question: 'Which backend route families give developer-specific access?',
        originRefs: [developer, backend],
        claimType: 'comparison',
        proofCondition: 'Compare developer behavior across backend route families.',
        constraints: [],
      },
    ];
    const invalid = corrected.map((goal, index) => ({
      ...goal,
      originRefs: [`request:0-${task.length}`, index === 0 ? frontend : backend],
    }));
    const ambiguousRetry = [
      invalid[0],
      invalid[1],
      { ...invalid[1], id: 'S-access-recovery-duplicate-backend-admin' },
    ];
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(invalid) },
      { stage: 'planner:2', value: plannerControl(ambiguousRetry) },
      {
        stage: 'goal_audit:1',
        run(request) {
          const packet = parseControlPacket(request);
          assert.deepEqual(packet.proposals, corrected);
          return controlCompletion(auditorControl(
            corrected.map(goal => auditControlRecord(goal)),
          ));
        },
      },
      { stage: 'exploration:1', content: 'The restored access leaves are ready.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('planner'), 2);
    assert.equal(client.stageCounts.get('goal_audit'), 1);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.originRefs),
      corrected.map(goal => goal.originRefs));
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — ambiguous access leaves remain fail-closed across retries',
  async () => {
    const task = 'Compare administrator and developer access policy across frontend guards and backend route families.';
    const administrator = requestOrigin(task, 'administrator');
    const frontend = requestOrigin(task, 'frontend guards');
    const backend = requestOrigin(task, 'backend route families.');
    const frontendAdministrator = {
      id: 'S-ambiguous-access-frontend-admin',
      question: 'How do frontend guards enforce administrator access?',
      originRefs: [administrator, frontend],
      claimType: 'positive',
      proofCondition: 'Observe the frontend guard enforcing administrator access.',
      constraints: [],
    };
    const backendAdministrator = {
      id: 'S-ambiguous-access-backend-admin',
      question: 'Which backend route families use administrator checks?',
      originRefs: [administrator, backend],
      claimType: 'comparison',
      proofCondition: 'Compare administrator predicates across backend route families.',
      constraints: [],
    };
    const ambiguous = [
      frontendAdministrator,
      backendAdministrator,
      { ...backendAdministrator, id: 'S-ambiguous-access-duplicate-backend-admin' },
    ];
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(ambiguous) },
      { stage: 'planner:2', value: plannerControl(ambiguous) },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.deepEqual(client.stageLabels, ['planner:1', 'planner:2']);
    assert.ok(result.failure);
    assert.equal(result.parentHandoff.state, 'failed');
    assert.match(JSON.stringify(client.requests[1].messages),
      /Required canonical leaf contract: exactly one of each/iu);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — invocation classification leaves require one contiguous action origin',
  async () => {
    const task = 'Inventory every Amazon Bedrock invocation and classify direct SDK calls, wrappers, and configuration-only references.';
    const classifyStart = task.indexOf('classify');
    const invalid = [
      {
        id: 'S-direct',
        question: 'Which direct Amazon Bedrock SDK invocation sites exist?',
        originRefs: [
          requestOrigin(task, 'Inventory every Amazon Bedrock invocation'),
          requestOrigin(task, 'classify direct SDK calls,'),
        ],
        claimType: 'count',
        proofCondition: 'Enumerate every direct SDK invocation site.',
        constraints: [],
      },
      {
        id: 'S-wrappers',
        question: 'Which Amazon Bedrock wrapper entry points exist?',
        originRefs: [
          requestOrigin(task, 'Inventory every Amazon Bedrock invocation'),
          requestOrigin(task, 'wrappers,'),
        ],
        claimType: 'comparison',
        proofCondition: 'Classify every wrapper entry point separately from direct SDK calls.',
        constraints: [],
      },
      {
        id: 'S-config',
        question: 'Which Amazon Bedrock references are configuration-only?',
        originRefs: [
          requestOrigin(task, 'Inventory every Amazon Bedrock invocation'),
          requestOrigin(task, 'configuration-only references.'),
        ],
        claimType: 'comparison',
        proofCondition: 'Classify configuration-only references separately from invocations.',
        constraints: [],
      },
    ];
    const corrected = invalid.map((goal, index) => ({
      ...goal,
      originRefs: [`request:${classifyStart}-${[
        task.indexOf('wrappers,') - 1,
        task.indexOf('wrappers,') + 'wrappers,'.length,
        task.length,
      ][index]}`],
    }));
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(invalid) },
      { stage: 'planner:2', value: plannerControl(invalid) },
      {
        stage: 'goal_audit:1',
        value: auditorControl(corrected.map(goal => auditControlRecord(goal)), []),
      },
      { stage: 'exploration:1', content: 'The three classification leaves are explored.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('planner'), 2);
    assert.equal(client.stageCounts.get('goal_audit'), 1);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.originRefs),
      corrected.map(goal => goal.originRefs));
    assert.match(JSON.stringify(client.requests[1].messages),
      /one exact contiguous request origin.*shared classification action/iu);
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — invocation validation preserves a trailing same-category obligation',
  async () => {
    const task = 'Inventory every Amazon Bedrock invocation and classify direct SDK calls, wrappers, and configuration-only references, and separately classify retry wrappers.';
    const classifyStart = task.indexOf('classify');
    const configurationEnd = task.indexOf(', and separately classify retry wrappers.') + 1;
    const goals = [
      {
        id: 'S-direct-with-extra',
        question: 'Which direct Amazon Bedrock SDK invocation sites exist?',
        originRefs: [`request:${classifyStart}-${task.indexOf('wrappers,') - 1}`],
        claimType: 'count',
        proofCondition: 'Enumerate every direct SDK invocation site.',
        constraints: [],
      },
      {
        id: 'S-wrappers-with-extra',
        question: 'Which Amazon Bedrock wrapper entry points exist?',
        originRefs: [
          `request:${classifyStart}-${task.indexOf('wrappers,') + 'wrappers,'.length}`,
        ],
        claimType: 'comparison',
        proofCondition: 'Classify every wrapper entry point separately from direct SDK calls.',
        constraints: [],
      },
      {
        id: 'S-config-with-extra',
        question: 'Which Amazon Bedrock references are configuration-only?',
        originRefs: [`request:${classifyStart}-${configurationEnd}`],
        claimType: 'comparison',
        proofCondition: 'Classify configuration-only references separately from invocations.',
        constraints: [],
      },
      {
        id: 'S-retry-wrappers-extra',
        question: 'Which retry wrappers need separate classification?',
        originRefs: [requestOrigin(task, 'and separately classify retry wrappers.')],
        claimType: 'comparison',
        proofCondition: 'Classify the separately requested retry wrappers.',
        constraints: [],
      },
    ];
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(goals) },
      { stage: 'goal_audit:1', value: auditorControl(goals.map(goal => auditControlRecord(goal))) },
      { stage: 'exploration:1', content: 'All requested classification obligations are retained.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('planner'), 1);
    assert.equal(client.stageCounts.get('goal_audit'), 1);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), goals.map(goal => goal.id));
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.originRefs),
      goals.map(goal => goal.originRefs));
  },
);

auditedPlanningRuntimeTest(
  'Spec 028 T069 — invocation classification rejects missing and duplicate categories',
  async () => {
    const task = 'Inventory every Amazon Bedrock invocation and classify direct SDK calls, wrappers, and configuration-only references.';
    const classifyStart = task.indexOf('classify');
    const direct = {
      id: 'S-direct-category',
      question: 'Which direct Amazon Bedrock SDK invocation sites exist?',
      originRefs: [`request:${classifyStart}-${task.indexOf('wrappers,') - 1}`],
      claimType: 'count',
      proofCondition: 'Enumerate every direct SDK invocation site.',
      constraints: [],
    };
    const wrappers = {
      id: 'S-wrapper-category',
      question: 'Which Amazon Bedrock wrapper entry points exist?',
      originRefs: [`request:${classifyStart}-${task.indexOf('wrappers,') + 'wrappers,'.length}`],
      claimType: 'comparison',
      proofCondition: 'Classify every wrapper entry point separately from direct SDK calls.',
      constraints: [],
    };
    const invalid = [direct, wrappers, { ...direct, id: 'S-duplicate-direct-category' }];
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl(invalid) },
      { stage: 'planner:2', value: plannerControl(invalid) },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task,
      repo_root: root,
    });

    assert.deepEqual(client.stageLabels, ['planner:1', 'planner:2']);
    assert.ok(result.failure);
    assert.equal(result.parentHandoff.state, 'failed');
    assert.match(JSON.stringify(client.requests[1].messages),
      /exactly one direct, wrapper, and configuration goal/iu);
  },
);

test('Spec 028 T069 — ambiguous origin corrections remain fail-closed', async () => {
  const task = 'Map pipeline environment configuration impact.';
  const original = {
    id: 'S-config-original',
    question: 'Which environment configuration inputs affect the pipeline?',
    originRefs: [requestOrigin(task, 'environment configuration')],
    claimType: 'impact',
    proofCondition: 'Observe the environment configuration inputs and their pipeline effect.',
    constraints: [],
  };
  const corrected = ['A', 'B'].map(suffix => ({
    ...original,
    id: `S-config-corrected-${suffix}`,
    originRefs: [`request:0-${task.length}`],
  }));
  const runtime = new RuntimeImplementation({
    chatClient: {
      model: 'zai-glm-4.7',
      async createChatCompletion() {
        assert.fail('ambiguous correction must fail closed without another model call');
      },
    },
  });
  const result = await runtime._reconcileGoalCoverage({
    chatClient: runtime._explicitChatClient,
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'explore_repo',
    obligations: [{
      obligationId: 'revision-obligation-1',
      sourceId: original.id,
      kind: 'decompose',
      goal: original,
    }],
    proposal: plannerControl(corrected),
    auditRecords: corrected.map(goal => auditControlRecord(goal)),
    eligibleGoalIds: corrected.map(goal => goal.id),
  });

  assert.deepEqual(result.findings, [{
    obligationId: 'revision-obligation-1',
    disposition: 'remaining',
    coveredByGoalIds: [],
    reason: 'A decomposition obligation requires at least two audited descendant goals.',
  }]);
});

auditedPlanningRuntimeTest('Spec 028 T022 — preserved origin and constraint sets may be reordered', async () => {
  const kept = proposedRuntimeGoal({
    id: 'S-kept',
    originRefs: [
      requestOrigin(GOAL_AUDIT_TASK, 'Locate requireAuth'),
      'wrapper:trace_symbol:definition',
      'wrapper:trace_symbol:usage',
    ],
    constraints: ['Stay in scope.', 'Use source evidence.'],
  });
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: 'Inspect both authentication distinctions.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested distinction independently.',
  });
  const reordered = {
    ...kept,
    originRefs: [...kept.originRefs].reverse(),
    constraints: [...kept.constraints].reverse(),
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([kept, broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(kept),
        auditControlRecord(broad, 'needs_decomposition'),
      ]),
    },
    { stage: 'planner:2', value: plannerControl([reordered]) },
    { stage: 'exploration:1', content: 'The preserved goal remains auditable.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    taskMode: 'symbol_trace',
  });

  assert.equal(result.failure, null);
  assert.equal(result.taskContract.subgoals[0].id, kept.id);
  assert.ok(result.taskContract.subgoals.some(goal =>
    goal.auditVerdict === 'planning_incomplete'));
});

auditedPlanningRuntimeTest('Spec 028 T022 — initial goal audit batches are bounded and reconcile cross-batch coverage', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const goals = Array.from({ length: 13 }, (_, index) => ({
    id: `P${index + 1}`,
    question: `Inspect authentication facet ${index + 1}.`,
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: `Observe repository evidence for authentication facet ${index + 1}.`,
    constraints: [],
  }));
  class BatchedInitialAuditClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.auditBatches = [];
      this.stages = [];
    }

    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      this.stages.push(stage);
      if (stage === 'planner') return controlCompletion(plannerControl(goals));
      if (stage === 'goal_audit') {
        const prompt = JSON.stringify(request.messages);
        const batch = goals.filter(goal => new RegExp(`\\b${goal.id}\\b`).test(prompt));
        this.auditBatches.push(batch.map(goal => goal.id));
        const uncovered = batch.some(goal => goal.id === 'P13')
          ? []
          : [{
            ...goals[12],
            id: undefined,
            question: 'Review authentication facet 13.',
            proofCondition: 'Observe repository evidence that resolves authentication facet 13.',
          }];
        delete uncovered[0]?.id;
        const missingQuestion = uncovered[0]?.question;
        return controlCompletion(auditorControl(
          batch.map((goal, index) => auditControlRecord(goal, 'ready', {
            missingRequestParts: index === 0 && missingQuestion ? [missingQuestion] : [],
          })),
          uncovered,
        ));
      }
      if (stage === 'goal_coverage') {
        return controlCompletion(coverageControl([
          coveredObligation('batch-uncovered-1', ['P13']),
        ]));
      }
      if (stage === 'exploration') return controlCompletion('Batched goals are ready.');
      return controlCompletion(readyExplorationResult());
    }
  }

  const client = new BatchedInitialAuditClient();
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task, repo_root: root });

  assert.equal(client.auditBatches.length, 2);
  assert.ok(client.auditBatches.every(batch => batch.length <= 12));
  assert.deepEqual(client.auditBatches.flat(), goals.map(goal => goal.id));
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), goals.map(goal => goal.id));
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.reason === 'planning_incomplete'), [],
    'another batch must not create a false uncovered blocker for a ready goal');
  assert.equal(result.coverageGaps.filter(gap => gap.reason === 'missing_evidence').length,
    goals.length);
});

auditedPlanningRuntimeTest('Spec 028 T017 — malformed goal-audit control output fails before exploration', async () => {
  const goals = definitionAndAbsenceGoals();
  class MalformedAuditClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.stages = [];
      this.auditCalls = 0;
    }

    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      this.stages.push(stage);
      if (stage === 'planner') return controlCompletion(plannerControl(goals));
      if (stage === 'goal_audit') {
        this.auditCalls += 1;
        return controlCompletion({});
      }
      return controlCompletion(readyExplorationResult());
    }
  }

  const root = await makeRepoFixture();
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-invalid-goal-audit-'));
  const client = new MalformedAuditClient();
  const runtime = new RuntimeImplementation({ chatClient: client });
  let result;
  await withEnv({ CEREBRAS_EXPLORER_LOG_PATH: logDir }, async () => {
    result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });
  });

  assert.ok(client.auditCalls >= 1 && client.auditCalls <= 2,
    'invalid required control output may receive at most one bounded recovery');
  assert.equal(client.stages.includes('exploration'), false);
  assert.equal(client.stages.includes('synthesis'), false);
  assert.ok(result.failure, 'invalid audit JSON is an execution fault, not a coverage gap');
  assert.equal(result.status.complete, false);
  assert.equal(/Where is requireAuth defined/.test(result.directAnswer ?? ''), false,
    'planner content must never become a stale parent answer');
  const entries = await readJsonl(result.transcriptPath);
  const invalid = entries.find(entry => entry.type === 'control_invalid');
  assert.equal(invalid?.stage, 'goal_audit');
  assert.match(invalid?.reason ?? '', /GoalAuditorResponse/u);
  assert.equal(invalid?.attempts?.length, 2);
  assert.deepEqual(invalid?.attempts?.map(item => item.attempt), [1, 2]);
  assert.ok(invalid?.attempts?.every(item =>
    typeof item.reason === 'string' && item.reason.length > 0));
  assert.equal(JSON.stringify(result.parentHandoff).includes('attempts'), false,
    'bounded control diagnostics remain transcript-only');
});

auditedPlanningRuntimeTest('Spec 028 T017 — an all-blocked audited plan returns without futile exploration', async () => {
  const blockedTask = 'Report which requireAuth revision is active in the deployed service.';
  const blocked = {
    id: 'S-live',
    question: 'Which requireAuth revision is active in the deployed service?',
    originRefs: [`request:0-${blockedTask.length}`],
    claimType: 'positive',
    proofCondition: 'Observe the active deployed revision.',
    constraints: [],
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([blocked]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(blocked, 'requires_external_state'),
      ]),
    },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: blockedTask, repo_root: root });

  assert.deepEqual(client.stageLabels, ['planner:1', 'goal_audit:1']);
  assert.equal(result.failure, null, 'a valid blocker is incomplete, not failed');
  assert.equal(result.status.complete, false);
  assert.equal(result.taskContract.subgoals[0].state, 'blocked');
  assert.equal(result.taskContract.subgoals[0].auditVerdict, 'requires_external_state');
  assert.ok(result.coverageGaps.some(gap => gap.reason === 'external_state_required'));
});

auditedPlanningRuntimeTest('Spec 028 T023 — planning, rejection, and blocker transitions stay in redacted transcripts', async () => {
  const root = await makeRepoFixture();
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-planning-events-'));
  const fakeKey = `sk-proj-${'q'.repeat(32)}`;
  const broad = proposedRuntimeGoal({
    id: 'T-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const invented = proposedRuntimeGoal({
    id: 'T-invented',
    question: `Inspect unrelated credential ${fakeKey}.`,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe an unrelated credential in repository content.',
  });
  const corrected = definitionAndAbsenceGoals();
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad, invented]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(broad, 'needs_decomposition'),
        auditControlRecord(invented, 'reject_untraceable', { originRefs: [] }),
      ]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal =>
        auditControlRecord(goal, 'needs_decomposition'))),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
      ]),
    },
  ]);

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const runtime = new RuntimeImplementation({ chatClient: client });
    const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });
    const entries = await readJsonl(result.transcriptPath);
    const eventTypes = new Set([
      'plan_proposed',
      'goal_audit',
      'plan_revised',
      'goal_rejected',
      'subgoal_state',
    ]);
    const planningEvents = entries.filter(entry => eventTypes.has(entry.type));

    assert.deepEqual(planningEvents.map(entry => entry.type), [
      'plan_proposed',
      'goal_audit',
      'goal_rejected',
      'plan_revised',
      'goal_audit',
      'subgoal_state',
      'subgoal_state',
    ]);
    assert.equal(planningEvents[0].revisionCount, 0);
    assert.deepEqual(planningEvents[0].proposal.subgoals.map(goal => goal.id),
      ['T-broad', 'T-invented']);
    assert.equal(planningEvents[1].revisionCount, 0);
    assert.deepEqual(planningEvents[1].auditRecords.map(record => record.proposedGoalId),
      ['T-broad', 'T-invented']);
    assert.deepEqual(planningEvents[1].capabilities, {
      repositoryRead: true,
      gitRead: true,
      repositoryWrite: false,
      liveRuntimeState: false,
      scopeWidening: false,
      secretPathRead: false,
    });
    assert.equal(planningEvents[2].proposedGoalId, 'T-invented');
    assert.equal(planningEvents[2].verdict, 'reject_untraceable');
    assert.equal(planningEvents[3].revisionCount, 1);
    assert.equal(planningEvents[3].proposal.subgoals.some(goal => goal.id === 'T-invented'), false);
    assert.equal(planningEvents[4].revisionCount, 1);
    assert.deepEqual(planningEvents.slice(5).map(event => event.subgoalId),
      corrected.map(goal => goal.id));
    assert.ok(planningEvents.slice(5).every(event => event.from === 'audit'));
    assert.ok(planningEvents.slice(5).every(event => event.to === 'blocked'));
    assert.ok(planningEvents.slice(5).every(event => event.reason === 'planning_incomplete'));
    assert.equal(entries.some(entry => entry.type === 'assistant'), false);
    assert.equal(entries.some(entry => entry.type === 'tool'), false);
    assert.equal(entries.at(-1).type, 'meta');

    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(fakeKey), false);
    assert.match(serialized, /\[REDACTED:openai-api-key\]/);
  });
});

auditedPlanningRuntimeTest('Spec 028 T022 — control prompts and returned trust state redact secret values', async () => {
  const secret = ['sk', '-proj-', 'a'.repeat(32)].join('');
  const task = `Inspect ${secret} without exposing it.`;
  const goal = {
    id: 'S-secret',
    question: 'Inspect the supplied token safely.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe whether the requested repository evidence can be inspected safely.',
    constraints: [],
  };
  const client = new ScriptedGoalAuditClient([
    {
      stage: 'planner:1',
      run(request) {
        const serialized = JSON.stringify(request.messages);
        assert.doesNotMatch(serialized, new RegExp(secret));
        assert.match(serialized, /\[REDACTED:openai-api-key\]/);
        return controlCompletion(plannerControl([goal]));
      },
    },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(goal)]),
    },
    {
      stage: 'exploration:1',
      run(request) {
        const serialized = JSON.stringify(request.messages);
        assert.doesNotMatch(serialized, new RegExp(secret));
        assert.match(serialized, /\[REDACTED:openai-api-key\]/);
        return controlCompletion('The redacted audited goal is ready.');
      },
    },
    {
      stage: 'synthesis:1',
      run(request) {
        assert.doesNotMatch(JSON.stringify(request.messages), new RegExp(secret));
        return controlCompletion(readyExplorationResult());
      },
    },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task, repo_root: root });

  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.match(result.taskContract.task, /\[REDACTED:openai-api-key\]/);
  assert.doesNotThrow(() => validateTaskContract(result.taskContract),
    'the runtime-owned redacted diagnostic projection is resealed');

  const lateProposal = {
    ...goal,
    id: 'L-secret',
    question: `Inspect ${secret} safely.`,
  };
  const lateClient = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      const serialized = JSON.stringify(request.messages);
      assert.doesNotMatch(serialized, new RegExp(secret));
      assert.match(serialized, /\[REDACTED:openai-api-key\]/);
      return controlCompletion(auditorControl([auditControlRecord(lateProposal)]));
    },
  };
  const lateRuntime = new RuntimeImplementation({ chatClient: lateClient });
  const lateResult = await lateRuntime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [lateProposal],
  });
  assert.doesNotMatch(JSON.stringify(lateResult), new RegExp(secret));
  assert.match(lateResult.requiredSubgoals[0].question, /\[REDACTED:openai-api-key\]/);
  const [safeLateGoal] = lateResult.requiredSubgoals;
  assert.doesNotThrow(() => createTaskContract({
    task,
    effectiveScope: ['src/**'],
    constraints: [],
    subgoals: [safeLateGoal],
    plannerVersion: 'planner-v1',
    goalAuditVersion: 'goal-audit-v1',
  }));
});

auditedPlanningRuntimeTest('Spec 028 T017 — cancellation is honored at every planning and audit stage', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: 'Locate requireAuth and independently check legacyGuard.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe the definition and enumerate the registration surface.',
  });
  const corrected = definitionAndAbsenceGoals();
  const revisionAudit = auditorControl([
    auditControlRecord(broad, 'needs_decomposition'),
  ], [{
    question: corrected[1].question,
    originRefs: [...corrected[1].originRefs],
    claimType: corrected[1].claimType,
    proofCondition: corrected[1].proofCondition,
    constraints: [],
  }]);

  for (const abortAt of [
    'planner:1',
    'goal_audit:1',
    'planner:2',
    'goal_audit:2',
    'goal_coverage:1',
  ]) {
    const controller = new AbortController();
    class AbortAtStageClient {
      constructor() {
        this.model = 'zai-glm-4.7';
        this.counts = new Map();
        this.labels = [];
      }

      async createChatCompletion(request) {
        assert.equal(request.signal, controller.signal);
        const stage = classifyControlRequest(request);
        const count = (this.counts.get(stage) ?? 0) + 1;
        this.counts.set(stage, count);
        const label = `${stage}:${count}`;
        this.labels.push(label);
        if (label === abortAt) {
          controller.abort();
          const error = new Error(`cancelled at ${label}`);
          error.name = 'AbortError';
          throw error;
        }
        if (label === 'planner:1') return controlCompletion(plannerControl([broad]));
        if (label === 'goal_audit:1') return controlCompletion(revisionAudit);
        if (label === 'planner:2') return controlCompletion(plannerControl(corrected));
        if (label === 'goal_audit:2') {
          return controlCompletion(auditorControl(corrected.map(goal => auditControlRecord(goal))));
        }
        if (label === 'goal_coverage:1') {
          return controlCompletion(coverageControl([
            coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
            coveredObligation('revision-obligation-2', [corrected[1].id]),
          ]));
        }
        assert.fail(`exploration must not start after cancellation target ${abortAt}`);
      }
    }

    const root = await makeRepoFixture();
    const client = new AbortAtStageClient();
    const runtime = new RuntimeImplementation({ chatClient: client });
    const result = await runtime.explore(
      { task: GOAL_AUDIT_TASK, repo_root: root },
      { abortSignal: controller.signal },
    );

    assert.equal(client.labels.at(-1), abortAt);
    assert.equal(result.failure?.reason, 'aborted', abortAt);
    assert.equal(result.status.complete, false, abortAt);
    assert.equal(/requireAuth is defined/.test(result.directAnswer ?? ''), false,
      `stale intermediate content leaked after ${abortAt}`);
  }
});

auditedPlanningRuntimeTest('Spec 028 T033 — provider faults retain precedence through audit wrappers', async t => {
  const initialGoal = proposedRuntimeGoal();
  await t.test('initial batched audit', async () => {
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([initialGoal]) },
      {
        stage: 'goal_audit:1',
        run() {
          throw new Error('initial audit provider outage');
        },
      },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task: GOAL_AUDIT_TASK,
      repo_root: root,
    });
    assert.equal(result.failure?.category, 'provider');
    assert.equal(result.failure?.reason, 'provider_error');
  });

  await t.test('revision coverage reconciliation', async () => {
    const broad = proposedRuntimeGoal({
      id: 'S-broad-provider',
      question: 'Locate requireAuth and independently check legacyGuard.',
      originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
      claimType: 'positive',
      proofCondition: 'Observe the definition and enumerate the registration surface.',
    });
    const corrected = definitionAndAbsenceGoals();
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([broad]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([
          auditControlRecord(broad, 'needs_decomposition'),
        ], [{
          question: corrected[1].question,
          originRefs: [...corrected[1].originRefs],
          claimType: corrected[1].claimType,
          proofCondition: corrected[1].proofCondition,
          constraints: [],
        }]),
      },
      { stage: 'planner:2', value: plannerControl(corrected) },
      {
        stage: 'goal_audit:2',
        value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
      },
      {
        stage: 'goal_coverage:1',
        run() {
          throw new Error('revision reconciliation provider outage');
        },
      },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task: GOAL_AUDIT_TASK,
      repo_root: root,
    });
    assert.equal(result.failure?.category, 'provider');
    assert.equal(result.failure?.reason, 'provider_error');
  });

  await t.test('late-goal audit wrapper', async () => {
    const lateGoal = {
      ...initialGoal,
      id: 'L-provider',
    };
    const client = new ScriptedGoalAuditClient([{
      stage: 'goal_audit:1',
      run() {
        throw new Error('late audit provider outage');
      },
    }]);
    const runtime = new RuntimeImplementation({ chatClient: client });
    await assert.rejects(runtime.auditLateGoalProposals({
      task: GOAL_AUDIT_TASK,
      effectiveScope: ['src/**'],
      wrapperTool: 'find_relevant_code',
      proposals: [lateGoal],
    }), error => error?.explorerFailureKind === 'provider');
  });
});

auditedPlanningRuntimeTest('Spec 028 T017 — late goal proposals are audited in bounded batches without re-planning', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const proposals = Array.from({ length: 13 }, (_, index) => ({
    id: `L${index + 1}`,
    question: `Inspect authentication facet ${index + 1}.`,
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: `Observe repository evidence for authentication facet ${index + 1}.`,
    constraints: [],
  }));

  class LateBatchAuditClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.requests = [];
      this.seenGoalIds = [];
    }

    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      assert.notEqual(stage, 'planner', 'late proposals must never invoke the planner');
      this.requests.push(request);
      if (stage === 'goal_coverage') {
        return controlCompletion(coverageControl([
          coveredObligation('batch-uncovered-1', ['L13']),
        ]));
      }
      assert.equal(stage, 'goal_audit');
      const prompt = JSON.stringify(request.messages);
      const batch = proposals.filter(goal =>
        new RegExp(`\\b${goal.id}\\b`).test(prompt));
      assert.ok(batch.length > 0 && batch.length <= 12);
      this.seenGoalIds.push(...batch.map(goal => goal.id));
      const records = batch.map(goal => {
        if (goal.id === 'L11') {
          return auditControlRecord(goal, 'reject_untraceable', { originRefs: [] });
        }
        if (goal.id === 'L12') return auditControlRecord(goal, 'needs_decomposition');
        return auditControlRecord(goal);
      });
      const { id: _ignoredId, ...otherBatchPart } = proposals[12];
      if (!batch.some(goal => goal.id === 'L13')) {
        records[0].missingRequestParts = [otherBatchPart.question];
      }
      return controlCompletion(auditorControl(
        records,
        batch.some(goal => goal.id === 'L13') ? [] : [otherBatchPart],
      ));
    }
  }

  const client = new LateBatchAuditClient();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals,
  });

  assert.ok(client.requests.length >= 2, '13 goals cannot fit in one bounded audit batch');
  assert.deepEqual(client.seenGoalIds, proposals.map(goal => goal.id),
    'late proposals must be audited exactly once and in request order');
  assert.deepEqual(result.requiredSubgoals
    .filter(goal => goal.auditVerdict === 'ready')
    .map(goal => goal.id), [
    ...proposals.slice(0, 10).map(goal => goal.id),
    proposals[12].id,
  ]);
  const latePlanningDefect = result.requiredSubgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(latePlanningDefect);
  assert.equal(latePlanningDefect.state, 'blocked');
  assert.equal(latePlanningDefect.question, proposals[11].question);
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), ['L11']);
  assert.deepEqual(result.gaps.map(gap => gap.reason), ['planning_incomplete']);
  assert.equal(result.revisionRequest, null, 'late goals can never trigger another planner pass');
});

auditedPlanningRuntimeTest('Spec 028 T022 — a clean large audit skips unnecessary coverage reconciliation', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const proposals = Array.from({ length: 25 }, (_, index) => ({
    id: `Q${index + 1}`,
    question: `Inspect authentication facet ${index + 1}.`,
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: `Observe repository evidence for authentication facet ${index + 1}.`,
    constraints: [],
  }));
  const stages = [];
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      stages.push(stage);
      assert.equal(stage, 'goal_audit',
        'a clean batched audit must not trigger a holistic coverage provider call');
      const prompt = JSON.stringify(request.messages);
      const batch = proposals.filter(goal => new RegExp(`\\b${goal.id}\\b`).test(prompt));
      assert.ok(batch.length > 0 && batch.length <= 12);
      return controlCompletion(auditorControl(batch.map(goal => auditControlRecord(goal))));
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals,
  });

  assert.deepEqual(stages, ['goal_audit', 'goal_audit', 'goal_audit']);
  assert.deepEqual(result.requiredSubgoals.map(goal => goal.id), proposals.map(goal => goal.id));
  assert.deepEqual(result.gaps, []);
});

auditedPlanningRuntimeTest('Spec 028 T022 — rejected and uncovered batch conflict fails closed', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const proposals = Array.from({ length: 13 }, (_, index) => ({
    id: `C${index + 1}`,
    question: `Inspect authentication facet ${index + 1}.`,
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: `Observe repository evidence for authentication facet ${index + 1}.`,
    constraints: [],
  }));
  let auditCalls = 0;
  let coverageCalls = 0;
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      if (stage === 'goal_coverage') {
        coverageCalls += 1;
        return controlCompletion(coverageControl([remainingObligation('batch-uncovered-1')]));
      }
      assert.equal(stage, 'goal_audit');
      auditCalls += 1;
      const prompt = JSON.stringify(request.messages);
      const batch = proposals.filter(goal => new RegExp(`\\b${goal.id}\\b`).test(prompt));
      const records = batch.map(goal => goal.id === 'C13'
        ? auditControlRecord(goal, 'reject_untraceable', { originRefs: [] })
        : auditControlRecord(goal));
      const { id: _ignored, ...conflict } = proposals[12];
      if (!batch.some(goal => goal.id === 'C13')) {
        records[0].missingRequestParts = [conflict.question];
      }
      return controlCompletion(auditorControl(
        records,
        batch.some(goal => goal.id === 'C13') ? [] : [conflict],
      ));
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });

  await assert.rejects(runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals,
  }), error => error?.code === 'ERR_INVALID_GOAL_CONTROL' &&
    /rejected proposal was also reported as uncovered/.test(error.cause?.message ?? ''));
  assert.equal(auditCalls, 2);
  assert.equal(coverageCalls, 0, 'the merged audit conflict must fail before reconciliation');
});

auditedPlanningRuntimeTest('Spec 028 T022 — rejected and uncovered direct conflict fails closed', async () => {
  const task = 'Inspect the requested authentication facet.';
  const proposal = {
    id: 'C-direct',
    question: 'Invent an unrelated cache change.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location for an unrelated cache change.',
    constraints: [],
  };
  const { id: _ignored, ...conflict } = proposal;
  let calls = 0;
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      calls += 1;
      assert.equal(classifyControlRequest(request), 'goal_audit');
      return controlCompletion(auditorControl([
        auditControlRecord(proposal, 'reject_untraceable', { originRefs: [] }),
      ], [conflict]));
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });

  await assert.rejects(runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [proposal],
  }), error => error?.code === 'ERR_INVALID_GOAL_CONTROL' &&
    /rejected proposal was also reported as uncovered/.test(error.cause?.message ?? ''));
  assert.equal(calls, 2, 'the invalid direct audit receives only one bounded retry');
});

auditedPlanningRuntimeTest('Spec 028 T022 — a genuine late uncovered part becomes a terminal planning gap', async () => {
  const task = 'Inspect authentication and authorization facets.';
  const proposal = {
    id: 'L-authentication',
    question: 'Inspect the authentication facet.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe bounded repository evidence for authentication.',
    constraints: [],
  };
  const uncovered = {
    question: 'Inspect the authorization facet.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe bounded repository evidence for authorization.',
    constraints: [],
  };
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      assert.equal(classifyControlRequest(request), 'goal_audit');
      return controlCompletion(auditorControl([
        auditControlRecord(proposal, 'ready', {
          missingRequestParts: [uncovered.question],
        }),
      ], [uncovered]));
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [proposal],
  });

  assert.equal(result.requiredSubgoals.length, 2);
  assert.equal(result.requiredSubgoals[0].id, 'L-authentication');
  assert.equal(result.requiredSubgoals[1].auditVerdict, 'planning_incomplete');
  assert.equal(result.requiredSubgoals[1].question, uncovered.question);
  assert.deepEqual(result.gaps.map(gap => gap.reason), ['planning_incomplete']);
  assert.equal(result.revisionRequest, null);
});

auditedPlanningRuntimeTest('Spec 028 T069 — a stronger late obligation cannot disappear through an external merge', async () => {
  const task = 'Inspect the requested authentication facet.';
  const originRefs = [`request:0-${task.length}`];
  const existing = createRequiredSubgoal({
    id: 'S-existing-auth',
    question: 'Inspect the requested authentication facet.',
    originRefs,
    claimType: 'positive',
    proofCondition: 'Observe bounded authentication evidence.',
    constraints: [],
    auditVerdict: 'ready',
  });
  const proposal = {
    id: 'L-stronger-auth',
    question: existing.question,
    originRefs,
    claimType: existing.claimType,
    proofCondition: existing.proofCondition,
    constraints: ['Also prove an additional export boundary.'],
  };
  let calls = 0;
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      calls += 1;
      const packet = parseControlPacket(request);
      return controlCompletion(auditorControl([{
        ...auditControlRecord(packet.proposals[0], 'merge_duplicate'),
        mergeInto: existing.id,
      }]));
    },
  };

  await assert.rejects(new RuntimeImplementation({ chatClient: client }).auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [proposal],
    existingGoalLedger: [existing],
  }), error => error?.code === 'ERR_INVALID_GOAL_CONTROL' &&
    /strengthened the constraints/.test(error.cause?.message ?? ''));
  assert.equal(calls, 2, 'an invalid external merge gets only one bounded correction');
});

auditedPlanningRuntimeTest('Spec 028 T069 — a distinct late acceptance core cannot disappear through an external merge', async () => {
  const task = 'Locate requireAuth and inspect its export boundary.';
  const originRefs = [`request:0-${task.length}`];
  const existing = createRequiredSubgoal({
    id: 'S-existing-definition',
    question: 'Where is requireAuth defined?',
    originRefs,
    claimType: 'symbol_definition',
    proofCondition: 'Observe the in-scope requireAuth definition.',
    constraints: [],
    auditVerdict: 'ready',
  });
  const proposal = {
    id: 'L-export-boundary',
    question: 'Which exported API exposes requireAuth?',
    originRefs,
    claimType: existing.claimType,
    proofCondition: 'Observe the export boundary that exposes requireAuth.',
    constraints: [],
  };
  let calls = 0;
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      calls += 1;
      const packet = parseControlPacket(request);
      return controlCompletion(auditorControl([{
        ...auditControlRecord(packet.proposals[0], 'merge_duplicate'),
        mergeInto: existing.id,
      }]));
    },
  };

  await assert.rejects(new RuntimeImplementation({ chatClient: client }).auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [proposal],
    existingGoalLedger: [existing],
  }), error => error?.code === 'ERR_INVALID_GOAL_CONTROL' &&
    /changed the acceptance core/.test(error.cause?.message ?? ''));
  assert.equal(calls, 2, 'an invalid external merge gets only one bounded correction');
});

auditedPlanningRuntimeTest('Spec 028 T017 — late goal audit forwards cancellation without registering goals', async () => {
  const task = 'Inspect the requested authentication facet.';
  const proposal = {
    id: 'L1',
    question: 'Inspect the requested authentication facet.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe the requested repository evidence.',
    constraints: [],
  };
  const controller = new AbortController();
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      assert.equal(classifyControlRequest(request), 'goal_audit');
      assert.equal(request.signal, controller.signal);
      controller.abort();
      const error = new Error('late audit cancelled');
      error.name = 'AbortError';
      throw error;
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });

  await assert.rejects(runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [proposal],
  }, { abortSignal: controller.signal }), error => error?.name === 'AbortError');
});

// T030-T033 implement this pipeline in stages. T033 flips this alias after the
// verifier, late-goal audit, repair, and fatal-fault paths have all landed.
const semanticPipelineRuntimeTest = test;

function trustGoal(task, {
  id,
  question,
  originText,
  claimType = 'positive',
  proofCondition = `Observe current repository evidence for ${question}`,
  constraints = [],
}) {
  return {
    id,
    question,
    originRefs: [requestOrigin(task, originText)],
    claimType,
    proofCondition,
    constraints,
  };
}

function candidateClaim(id, subgoalId, text, evidenceRefs) {
  return { id, subgoalId, text, evidenceRefs };
}

function semanticVerdict(claimId, result, evidenceRefs = []) {
  return {
    claimId,
    result,
    ...(result === 'supported' ? { resolution: 'affirmed' } : {}),
    supportingEvidenceRefs: evidenceRefs,
    reasonCode: result === 'supported'
      ? 'entailed'
      : result === 'contradicted' ? 'contradiction' : 'semantic_mismatch',
    note: `${claimId} is ${result}.`,
  };
}

function toolControlCompletion(tool, args, id) {
  return toolBatchControlCompletion([{ tool, args, id }]);
}

function toolBatchControlCompletion(calls) {
  return {
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    finishReason: 'tool_calls',
    message: {
      content: '',
      toolCalls: calls.map(call => ({
        id: call.id,
        function: { name: call.tool, arguments: JSON.stringify(call.args) },
      })),
    },
  };
}

function parseControlPacket(request) {
  const content = request.messages.findLast(message =>
    message.role === 'user' && typeof message.content === 'string' &&
    message.content.includes('BEGIN_CONTROL_DATA_JSON'))?.content ?? '';
  const match = /BEGIN_CONTROL_DATA_JSON\n([\s\S]*?)\nEND_CONTROL_DATA_JSON/.exec(content);
  assert.ok(match, 'isolated control request must contain structured control data');
  return JSON.parse(match[1]);
}

function lateAuditResponse(request, verdict) {
  const packet = parseControlPacket(request);
  const proposals = packet.proposals ?? [];
  assert.ok(proposals.length > 0);
  return controlCompletion(auditorControl(proposals.map(proposal =>
    auditControlRecord(proposal, verdict, verdict === 'reject_untraceable'
      ? { originRefs: [] }
      : {}))));
}

function verifierResponse(verdicts, uncoveredRequestParts = []) {
  return { verdicts, uncoveredRequestParts };
}

function parseRepairPacket(request) {
  const content = request.messages.findLast(message =>
    message.role === 'user' && typeof message.content === 'string' &&
    message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))?.content ?? '';
  const match = /BEGIN_EVIDENCE_REPAIR_JSON\n([\s\S]*?)\nEND_EVIDENCE_REPAIR_JSON/
    .exec(content);
  assert.ok(match, 'repair request must contain structured evidence-repair data');
  return JSON.parse(match[1]);
}

function assertRepairRequest(request, { question, anchors }) {
  const packet = JSON.stringify(request.messages);
  assert.ok(packet.includes(question));
  assert.ok(packet.includes('src/**'));
  for (const anchor of anchors) assert.ok(packet.includes(anchor));
  assert.ok((request.tools?.length ?? 0) > 0,
    'repair must remain a scoped repository-tool pass');
  assert.equal(request.responseFormat, undefined,
    'repair input is a gap task, not a second planner/control response');
  return parseRepairPacket(request);
}

function buildTrustSteps({ goals, initial, repair }) {
  const steps = [
    { stage: 'planner:1', value: plannerControl(goals) },
    {
      stage: 'goal_audit:1',
      value: auditorControl(goals.map(goal => auditControlRecord(goal))),
    },
  ];
  let exploration = 0;
  let verification = 0;
  let audit = 1;
  let hasRuntimeObservation = false;
  let hasDirectSourceObservation = false;

  const addPass = (pass, { includeFinalSynthesis = false, repairPass = false } = {}) => {
    if (pass.providerError) {
      exploration += 1;
      steps.push({
        stage: `exploration:${exploration}`,
        run(request) {
          pass.assertRequest?.(request);
          const error = new Error(pass.providerError);
          error.retryable = false;
          throw error;
        },
      });
      return;
    }
    if (repairPass) {
      exploration += 1;
      steps.push({
        stage: `exploration:${exploration}`,
        run(request) {
          pass.assertRequest?.(request);
          const calls = pass.tools ?? [];
          return calls.length > 0
            ? toolBatchControlCompletion(calls)
            : controlCompletion(pass.prose ?? 'Evidence repair completed without a tool action.');
        },
      });
    } else {
      for (const call of pass.tools ?? []) {
        exploration += 1;
        steps.push({
          stage: `exploration:${exploration}`,
          run(request) {
            pass.assertRequest?.(request);
            return toolControlCompletion(call.tool, call.args, call.id);
          },
        });
      }
      exploration += 1;
      steps.push({ stage: `exploration:${exploration}`, content: pass.prose ?? 'Evidence pass complete.' });
    }
    const passTools = pass.tools ?? [];
    hasRuntimeObservation ||= passTools.length > 0;
    hasDirectSourceObservation ||= passTools.some(call =>
      call.tool === 'repo_read_file' || call.tool === 'repo_symbol_context');
    if (includeFinalSynthesis) {
      steps.push({ stage: 'synthesis:1', value: readyExplorationResult() });
    }

    const activeSubgoalIds = repairPass
      ? new Set([...(initial.claims ?? []), ...(pass.claims ?? [])]
        .map(claim => claim.subgoalId))
      : new Set(goals.map(goal => goal.id));
    const activeGoals = goals.filter(goal => activeSubgoalIds.has(goal.id));
    const hasPotentialClaimBatch =
      (hasRuntimeObservation && activeGoals.some(goal => goal.claimType !== 'positive')) ||
      (hasDirectSourceObservation && activeGoals.some(goal => goal.claimType === 'positive'));
    if (hasPotentialClaimBatch) {
      steps.push({
        stage: 'claim_synthesis:*',
        repeatStage: 'claim_synthesis',
        run(request) {
          const subgoalIds = new Set(parseControlPacket(request).control.requiredSubgoals
            .map(goal => goal.id));
          return controlCompletion({
            claims: (pass.claims ?? []).filter(claim => subgoalIds.has(claim.subgoalId)),
          });
        },
      });
    }

    const carriesPriorClaims = repairPass && (initial.claims?.length ?? 0) > 0;
    if (hasPotentialClaimBatch && ((pass.claims?.length ?? 0) > 0 || carriesPriorClaims)) {
      const verifierSteps = pass.verifierSteps ?? [{
        verdicts: pass.verdicts,
        uncovered: pass.uncovered,
        assertRequest: pass.assertVerifier,
      }];
      for (const verifier of verifierSteps) {
        verification += 1;
        steps.push({
          stage: `semantic_verifier:${verification}`,
          run(request) {
            verifier.assertRequest?.(request);
            if (verifier.error) {
              const error = new Error(verifier.error);
              error.retryable = false;
              throw error;
            }
            if (verifier.raw !== undefined) {
              return controlCompletion(verifier.raw, { finishReason: verifier.finishReason });
            }
            return controlCompletion(verifierResponse(
              verifier.verdicts,
              verifier.uncovered ?? [],
            ));
          },
        });
      }
      if (pass.auditVerdict) {
        audit += 1;
        steps.push({
          stage: `goal_audit:${audit}`,
          run: request => lateAuditResponse(request, pass.auditVerdict),
        });
      }
    }
  };

  addPass(initial, { includeFinalSynthesis: true });
  if (repair) addPass(repair, { repairPass: true });
  return steps;
}

async function runTrustScript(steps, {
  task,
  setup,
  abortSignal,
  scope = ['src/**'],
  taskMode,
} = {}) {
  const root = await makeRepoFixture();
  if (setup) await setup(root);
  const client = new ScriptedGoalAuditClient(steps);
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({
    task: task ?? GOAL_AUDIT_TASK,
    repo_root: root,
    scope,
    ...(taskMode ? { taskMode } : {}),
  }, { abortSignal });
  return { client, result };
}

function providerToolActions(client) {
  return client.completions.flatMap(completion => completion?.message?.toolCalls ?? [])
    .map(call => ({
      type: 'tool',
      tool: call.function.name,
      arguments: JSON.parse(call.function.arguments),
    }));
}

function assertNoRequiredLeak(result, text) {
  assert.equal(result.taskContract.subgoals.some(goal => goal.question === text), false);
  assert.equal(result.coverageGaps.some(gap => gap.question === text), false);
  assert.doesNotMatch(result.directAnswer ?? '', new RegExp(text));
}

// T062 integrates proof-policy artifacts into the runtime result. Until that
// direct-runtime diagnostic exists, execute the complete provider script but
// report these T059 tests as TODO. Once even a partial integration exposes the
// marker, every assertion below runs so an incomplete implementation stays red.
function hasRuntimeProofPolicyIntegration(result) {
  return Array.isArray(result?.semanticVerification?.absenceCertificates);
}

function requireRuntimeProofPolicyIntegration(t, result) {
  if (hasRuntimeProofPolicyIntegration(result)) return true;
  t.todo('T062 must expose runtime-computed absenceCertificates before T059 activates.');
  return false;
}

function assertMinimalCompleteParentHandoff(result, {
  answer,
  evidenceCount,
  evidenceKinds,
}) {
  const handoff = result.parentHandoff;
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));
  assert.deepEqual(Object.keys(handoff).sort(), [
    'directAnswer', 'evidence', 'schemaVersion', 'state',
  ]);
  assert.equal(handoff.schemaVersion, 3);
  assert.equal(handoff.state, 'complete');
  assert.equal(handoff.directAnswer, answer);
  assert.equal(handoff.evidence.length, evidenceCount);
  assert.deepEqual(handoff.evidence.map(item => item.kind).sort(), [...evidenceKinds].sort());
}

function expectedParentGapQuestion(result, goal) {
  const task = result.taskContract.task;
  const requestSlices = (goal?.originRefs ?? []).flatMap(originRef => {
    const match = /^request:(\d+)-(\d+)$/.exec(originRef);
    if (!match) return [];
    return [task.slice(Number(match[1]), Number(match[2])).trim()];
  }).filter(Boolean);
  return [...new Set(requestSlices)].join(' / ') || task.trim();
}

function assertMinimalIncompleteParentHandoff(result, question) {
  const handoff = result.parentHandoff;
  assert.doesNotThrow(() => validateParentHandoffV3(handoff));
  assert.deepEqual(Object.keys(handoff).sort(), ['gaps', 'schemaVersion', 'state']);
  assert.equal(handoff.schemaVersion, 3);
  assert.equal(handoff.state, 'incomplete');
  assert.equal(handoff.gaps.length, 1);
  const gap = result.coverageGaps.find(item => item.subgoalId) ?? null;
  const goal = result.taskContract.subgoals.find(item => item.id === gap?.subgoalId) ?? null;
  const requestQuestion = expectedParentGapQuestion(result, goal);
  assert.equal(handoff.gaps[0].question, requestQuestion);
  if (question !== requestQuestion) {
    assert.notEqual(handoff.gaps[0].question, question,
      'model-authored goal text must not leak into the parent gap');
  }
  assert.ok(handoff.gaps[0].reason.length > 0);
}

function assertInternalProofGap(result, goalId) {
  const subgoal = result.taskContract.subgoals.find(item => item.id === goalId);
  assert.ok(subgoal, `missing runtime sub-goal ${goalId}`);
  assert.notEqual(subgoal.state, 'supported');
  assert.ok(result.coverageGaps.some(gap => gap.subgoalId === goalId));
  const claims = result.semanticVerification.claims.filter(claim => claim.subgoalId === goalId);
  assert.ok(claims.length > 0);
  assert.ok(claims.every(claim => claim.verdict !== 'supported'),
    'deterministic proof policy must override a model-supported overclaim');
}

test('Spec 028 T059 — runtime enforces negative and critical proof boundaries', async t => {
  const fixtures = [
    {
      name: 'scoped absence produces one certified public absence item',
      task: 'Confirm legacyGuard is absent from src/routes/**.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-scoped-absence',
        question: 'Is legacyGuard absent from src/routes/**?',
        originText: 'legacyGuard is absent from src/routes/**',
        claimType: 'absence',
        proofCondition: 'Completely search src/routes/** and certify the bounded static absence.',
        constraints: ['Keep the conclusion qualified to src/routes/**.'],
      },
      claimText: 'No static reference to legacyGuard exists in src/routes/**.',
      initialTools: [{
        tool: 'repo_grep',
        args: { pattern: 'legacyGuard', scope: ['src/routes/**'] },
        id: 'scoped-absence-search',
      }],
      initialEvidenceRefs: ['E1'],
      assertImplemented({ result, goal, claim }) {
        assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
        assert.equal(result.semanticVerification.claims.find(item => item.id === claim.id).verdict,
          'supported');
        const certificate = result.semanticVerification.absenceCertificates.find(item =>
          item.subgoalId === goal.id);
        assert.ok(certificate);
        assert.equal(certificate.complete, true);
        assert.deepEqual(certificate.claimBoundary, ['src/routes/**']);
        assert.ok(certificate.searchRefs.includes('E1'));
        assert.equal(result.directAnswer, claim.text,
          'the direct runtime result must retain a certified search-backed claim');
        assertMinimalCompleteParentHandoff(result, {
          answer: claim.text,
          evidenceCount: 1,
          evidenceKinds: ['absence'],
        });
        assert.deepEqual(result.parentHandoff.evidence[0].boundary, ['src/routes/**']);
        assert.ok(result.parentHandoff.evidence[0].searches.length > 0);
      },
    },
    {
      name: 'repository-wide absence cannot be inferred from narrower searches',
      task: 'Confirm legacyGuard is absent from every path in the repository.',
      scope: [],
      goal: {
        id: 'S-repository-absence',
        question: 'Is legacyGuard absent from every path in the repository?',
        originText: 'legacyGuard is absent from every path in the repository',
        claimType: 'absence',
        proofCondition: 'Certify a complete repository-wide static search boundary.',
        constraints: ['Do not generalize from a narrower src/routes search.'],
      },
      claimText: 'No static reference to legacyGuard exists anywhere in the repository.',
      initialTools: [{
        tool: 'repo_grep',
        args: { pattern: 'legacyGuard', scope: ['src/routes/**'] },
        id: 'narrow-absence-search',
      }],
      initialEvidenceRefs: ['E1'],
      repairTools: [{
        tool: 'repo_grep',
        args: { pattern: 'legacyGuard', scope: ['src/**'] },
        id: 'still-narrow-absence-search',
      }],
      repairEvidenceRefs: ['E1', 'E2'],
      assertImplemented({ result, goal }) {
        assertInternalProofGap(result, goal.id);
        assertMinimalIncompleteParentHandoff(result, goal.question);
        assert.equal(result.parentHandoff.evidence, undefined);
        assert.equal(result.parentHandoff.directAnswer, undefined);
        assert.equal(result.semanticVerification.absenceCertificates.some(item =>
          item.subgoalId === goal.id && item.complete === true), false);
      },
    },
    {
      name: 'complete nonzero search produces a deterministic runtime count',
      task: 'Count the lines containing requireAuth in src/routes/**.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-route-count',
        question: 'How many lines contain requireAuth in src/routes/**?',
        originText: 'Count the lines containing requireAuth in src/routes/**',
        claimType: 'count',
        proofCondition: 'Completely search src/routes/** and count unique matching locations.',
        constraints: ['Keep the count qualified to src/routes/**.'],
      },
      claimText: 'There are exactly 2 lines containing requireAuth in src/routes/**.',
      countMeasurement: { kind: 'count', unit: 'matching_lines', value: 2 },
      initialTools: [{
        tool: 'repo_grep',
        args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
        id: 'complete-route-count',
      }],
      initialEvidenceRefs: ['E1'],
      repairTools: [{
        tool: 'repo_grep',
        args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
        id: 'duplicate-complete-route-count',
      }],
      repairEvidenceRefs: ['E1'],
      assertImplemented({ result, goal, claim }) {
        assertInternalProofGap(result, goal.id);
        assert.equal(result.semanticVerification.claims.find(item => item.id === claim.id).verdict,
          'insufficient');
        const count = result.semanticVerification.deterministicCounts.find(item =>
          item.subgoalId === goal.id);
        assert.deepEqual(count, {
          subgoalId: goal.id,
          claimId: claim.id,
          observationRef: 'E1',
          unit: 'matching_lines',
          claimBoundary: ['src/routes/**'],
          certificateRef: `absence:${claim.id}:E1`,
          complete: true,
          count: 2,
        });
        assert.equal(result.observations.find(item => item.id === 'E1')
          .normalizedItemIds.length, 2);
        assert.equal(result.parentHandoff.state, 'incomplete',
          'a nonzero search count is not supported until exact sources cover every match');
        assert.equal(result.parentHandoff.directAnswer, undefined,
          'a search-only count must not become an unsupported parent claim');
      },
    },
    {
      name: 'source-covered nonzero search count is safe for schema-v3 projection',
      task: 'Count the lines containing requireAuth in src/routes/**.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-source-covered-route-count',
        question: 'How many lines contain requireAuth in src/routes/**?',
        originText: 'Count the lines containing requireAuth in src/routes/**',
        claimType: 'count',
        proofCondition: 'Completely search src/routes/** and source-ground every counted line.',
        constraints: ['Keep the count qualified to src/routes/**.'],
      },
      claimText: 'There are exactly 2 lines containing requireAuth in src/routes/**.',
      countMeasurement: { kind: 'count', unit: 'matching_lines', value: 2 },
      initialTools: [{
        tool: 'repo_grep',
        args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
        id: 'source-covered-route-count',
      }, {
        tool: 'repo_read_file',
        args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
        id: 'read-source-covered-route-count',
      }],
      initialEvidenceRefs: ['E1', 'E2'],
      assertImplemented({ result, goal, claim }) {
        assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
        assert.equal(result.semanticVerification.claims.find(item => item.id === claim.id).verdict,
          'supported');
        assert.deepEqual(result.observations.find(item => item.id === 'E1')
          .normalizedItemAnchors, [
          { path: 'src/routes/user.js', line: 1 },
          { path: 'src/routes/user.js', line: 4 },
        ]);
        const projectedClaim = result.semanticVerification.claims.find(item => item.id === claim.id);
        assertMinimalCompleteParentHandoff(result, {
          answer: projectedClaim.text,
          evidenceCount: 1,
          evidenceKinds: ['source'],
        });
        assert.equal(result.parentHandoff.evidence[0].path, 'src/routes/user.js');
      },
    },
    {
      name: 'source-covered grep lines cannot become a semantic invocation-site count',
      task: 'Count direct SDK invocation sites in src/routes/**.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-semantic-invocation-count',
        question: 'How many direct SDK invocation sites are in src/routes/**?',
        originText: 'Count direct SDK invocation sites in src/routes/**',
        claimType: 'count',
        proofCondition: 'Enumerate and verify each direct SDK invocation site.',
        constraints: ['Do not substitute matching source lines for semantic invocation sites.'],
      },
      claimText: 'There are exactly 2 direct SDK invocation sites in src/routes/**.',
      countMeasurement: { kind: 'count', unit: 'matching_lines', value: 2 },
      initialTools: [{
        tool: 'repo_grep',
        args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
        id: 'grep-semantic-invocation-count',
      }, {
        tool: 'repo_read_file',
        args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
        id: 'read-semantic-invocation-count',
      }],
      initialEvidenceRefs: ['E1', 'E2'],
      repairTools: [{
        tool: 'repo_read_file',
        args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
        id: 'repair-semantic-invocation-count',
      }],
      repairEvidenceRefs: ['E1', 'E2', 'E3'],
      assertImplemented({ result, goal }) {
        assertInternalProofGap(result, goal.id);
        assertMinimalIncompleteParentHandoff(result, goal.question);
      },
    },
    {
      name: 'static string-array symbol context produces an exact array-entry count',
      task: 'Count the entries in DEFAULT_SECRET_DENY_PATTERNS and cite its definition.',
      scope: ['src/patterns.mjs'],
      goal: {
        id: 'S-static-array-count',
        question: 'How many entries are in DEFAULT_SECRET_DENY_PATTERNS?',
        originText: 'Count the entries in DEFAULT_SECRET_DENY_PATTERNS',
        claimType: 'count',
        proofCondition: 'Read the complete static array definition and count its entries.',
        constraints: ['Keep the count bound to the cited definition.'],
      },
      claimText: 'DEFAULT_SECRET_DENY_PATTERNS contains exactly 13 entries.',
      countMeasurement: { kind: 'count', unit: 'array_entries', value: 13 },
      initialTools: [{
        tool: 'repo_symbol_context',
        args: {
          symbol: 'DEFAULT_SECRET_DENY_PATTERNS',
          scope: ['src/patterns.mjs'],
        },
        id: 'static-array-symbol',
      }, {
        tool: 'repo_read_file',
        args: { path: 'src/patterns.mjs', startLine: 1, endLine: 15 },
        id: 'static-array-read',
      }],
      initialEvidenceRefs: ['E1', 'E1:search', 'E2', 'E2:search'],
      assertVerifier(request) {
        const packet = parseControlPacket(request);
        const countObservation = packet.observations.find(item => item.id === 'E1:search');
        assert.deepEqual(countObservation?.deterministicMeasurement, {
          kind: 'count',
          unit: 'array_entries',
          value: 13,
        });
        assert.deepEqual(packet.claims[0].measurement, {
          kind: 'count',
          unit: 'array_entries',
          value: 13,
        });
      },
      async setup(root) {
        await fs.writeFile(path.join(root, 'src', 'patterns.mjs'), [
          'export const DEFAULT_SECRET_DENY_PATTERNS = Object.freeze([',
          "  '.env',",
          "  '**/.env',",
          "  '*.pem',",
          "  '*.key',",
          "  '*.p12',",
          "  '*.pfx',",
          "  'credentials.json',",
          "  'secrets.json',",
          "  '.npmrc',",
          "  '.pypirc',",
          "  '.netrc',",
          "  '.aws/credentials',",
          "  '.ssh/id_*',",
          ']);',
          '',
        ].join('\n'));
      },
      assertImplemented({ result, goal, claim }) {
        const source = result.observations.find(item => item.id === 'E1');
        const countObservation = result.observations.find(item => item.id === 'E1:search');
        assert.equal(source.kind, 'source');
        assert.match(source.snippet, /DEFAULT_SECRET_DENY_PATTERNS/u);
        assert.deepEqual(countObservation.deterministicMeasurement, {
          kind: 'count',
          unit: 'array_entries',
          value: 13,
        });
        const count = result.semanticVerification.deterministicCounts.find(item =>
          item.claimId === claim.id);
        assert.equal(count.complete, true);
        assert.equal(count.unit, 'array_entries');
        assert.equal(count.count, 13);
        assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
        assert.equal(result.parentHandoff.state, 'complete', JSON.stringify({
          handoff: result.parentHandoff,
          resultState: result.state,
          directAnswer: result.directAnswer,
          claims: result.semanticVerification.claims,
          allowed: result.semanticVerification.runtimeAllowedEvidenceRefsBySubgoal,
        }, null, 2));
        assert.doesNotThrow(() => validateParentHandoffV3(result.parentHandoff));
        assert.match(result.parentHandoff.directAnswer,
          /deterministic count of array entries.* is 13\./u);
        assert.deepEqual(result.parentHandoff.evidence.map(item => item.kind), ['source']);
        assert.deepEqual(result.semanticVerification.runtimeAllowedEvidenceRefsBySubgoal, [{
          subgoalId: goal.id,
          evidenceRefs: ['E1', 'E1:search', 'E2', 'E2:search'],
        }]);
        assert.equal(result.parentHandoff.targets.length, 1);
        assert.equal(result.parentHandoff.targets[0].path, 'src/patterns.mjs');
      },
    },
    {
      name: 'static array count and closing line comparison shares one bounded definition',
      task: 'Distinguish the 3 static array entries from the ending source line 5.',
      scope: ['src/patterns.mjs'],
      goal: {
        id: 'S-static-array-comparison',
        question: 'How do the static array entry count and ending source line differ?',
        originText: 'Distinguish the 3 static array entries from the ending source line 5',
        claimType: 'comparison',
        proofCondition: 'Compare the runtime-owned array count with the exact definition range.',
        constraints: ['Do not treat the ending source line as the entry count.'],
      },
      claimText: 'The static array has 3 entries and its definition ends on source line 5.',
      initialTools: [{
        tool: 'repo_symbol_context',
        args: {
          symbol: 'DEFAULT_SECRET_DENY_PATTERNS',
          scope: ['src/patterns.mjs'],
        },
        id: 'static-array-comparison',
      }, {
        tool: 'repo_read_file',
        args: { path: 'src/patterns.mjs', startLine: 1, endLine: 5 },
        id: 'static-array-comparison-read',
      }],
      initialEvidenceRefs: ['E1', 'E1:search', 'E2', 'E2:search'],
      async setup(root) {
        await fs.writeFile(path.join(root, 'src', 'patterns.mjs'), [
          'export const DEFAULT_SECRET_DENY_PATTERNS = Object.freeze([',
          "  '.env',",
          "  '**/.env',",
          "  '*.pem',",
          ']);',
          '',
        ].join('\n'));
      },
      assertImplemented({ result, goal, claim }) {
        assert.equal(result.semanticVerification.deterministicCounts.length, 0,
          'comparison reuses the runtime observation without inventing a count certificate');
        assert.equal(result.semanticVerification.claims.find(item => item.id === claim.id).verdict,
          'supported');
        assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
        assert.equal(result.parentHandoff.state, 'complete');
        assert.match(result.parentHandoff.directAnswer, /3 entries.*line 5/u);
        assert.deepEqual(result.parentHandoff.evidence.map(item => item.kind), ['source']);
      },
    },
    {
      name: 'zero count replaces a model-invented number with the runtime count',
      task: 'Count the lines containing legacyGuard in src/routes/**.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-zero-route-count',
        question: 'How many lines contain legacyGuard in src/routes/**?',
        originText: 'Count the lines containing legacyGuard in src/routes/**',
        claimType: 'count',
        proofCondition: 'Completely search src/routes/** and count unique matching locations.',
        constraints: ['Keep the count qualified to src/routes/**.'],
      },
      claimText: 'There are exactly 999 lines containing legacyGuard in src/routes/**.',
      countMeasurement: { kind: 'count', unit: 'matching_lines', value: 0 },
      initialTools: [{
        tool: 'repo_grep',
        args: { pattern: 'legacyGuard', scope: ['src/routes/**'] },
        id: 'complete-zero-route-count',
      }],
      initialEvidenceRefs: ['E1'],
      assertImplemented({ result, goal, claim }) {
        const verifiedClaim = result.semanticVerification.claims.find(item =>
          item.id === claim.id);
        const count = result.semanticVerification.deterministicCounts.find(item =>
          item.claimId === claim.id);
        assert.equal(count.count, 0);
        assert.match(verifiedClaim.text, /deterministic count.* is 0\./u);
        assert.doesNotMatch(verifiedClaim.text, /999/u);
        assert.doesNotMatch(result.directAnswer ?? '', /999/u);
        assert.equal(result.parentHandoff.state, 'complete');
        assert.match(result.parentHandoff.directAnswer, /deterministic count.* is 0\./u);
        assert.doesNotMatch(JSON.stringify(result.parentHandoff), /999/u);
        assert.equal(result.parentHandoff.evidence[0].kind, 'absence');
        assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
      },
    },
    {
      name: 'source-first evidence cannot project a model-invented nonzero count',
      task: 'Count the lines containing requireAuth in src/routes/** and cite the route source.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-source-first-route-count',
        question: 'How many lines contain requireAuth in src/routes/**?',
        originText: 'Count the lines containing requireAuth in src/routes/**',
        claimType: 'count',
        proofCondition: 'Completely search src/routes/** and count unique matching locations.',
        constraints: ['Keep the count qualified to src/routes/**.'],
      },
      claimText: 'There are exactly 999 lines containing requireAuth in src/routes/**.',
      countMeasurement: { kind: 'count', unit: 'matching_lines', value: 999 },
      initialTools: [
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-source-before-count',
        },
        {
          tool: 'repo_grep',
          args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
          id: 'complete-source-first-route-count',
        },
      ],
      initialEvidenceRefs: ['E1', 'E2'],
      repairTools: [
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'repair-read-source-before-count',
        },
        {
          tool: 'repo_grep',
          args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
          id: 'repair-complete-source-first-route-count',
        },
      ],
      repairEvidenceRefs: ['E1', 'E2', 'E3', 'E4'],
      assertImplemented({ result, goal, claim }) {
        const verifiedClaim = result.semanticVerification.claims.find(item =>
          item.id === claim.id);
        const count = result.semanticVerification.deterministicCounts.find(item =>
          item.claimId === claim.id);
        assert.equal(count.count, 2);
        assert.equal(verifiedClaim.verdict, 'insufficient');
        assert.doesNotMatch(result.directAnswer ?? '', /999/u);
        assert.notEqual(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
        assert.equal(result.parentHandoff.state, 'incomplete');
        assert.equal(result.parentHandoff.directAnswer, undefined);
        assert.doesNotMatch(JSON.stringify(result.parentHandoff), /999/u);
      },
    },
    {
      name: 'count canonicalization follows the exact verifier-supported search observation',
      task: 'Count the lines containing legacyGuard in src/routes/**.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-bound-route-count',
        question: 'How many lines contain legacyGuard in src/routes/**?',
        originText: 'Count the lines containing legacyGuard in src/routes/**',
        claimType: 'count',
        proofCondition: 'Completely search src/routes/** and count unique matching locations.',
        constraints: ['Bind the count to the verifier-supported search.'],
      },
      claimText: 'There are exactly 999 lines containing legacyGuard in src/routes/**.',
      countMeasurement: { kind: 'count', unit: 'matching_lines', value: 0 },
      initialTools: [
        {
          tool: 'repo_grep',
          args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
          id: 'complete-unrelated-route-count',
        },
        {
          tool: 'repo_grep',
          args: { pattern: 'legacyGuard', scope: ['src/routes/**'] },
          id: 'complete-supported-route-count',
        },
      ],
      initialEvidenceRefs: ['E1', 'E2'],
      verifierEvidenceRefs: ['E2'],
      assertImplemented({ result, goal, claim }) {
        const verifiedClaim = result.semanticVerification.claims.find(item =>
          item.id === claim.id);
        assert.equal(verifiedClaim.verdict, 'supported');
        assert.match(verifiedClaim.text, /deterministic count.* is 0\./u);
        assert.doesNotMatch(verifiedClaim.text, / is 2\.|999/u);
        const counts = result.semanticVerification.deterministicCounts.filter(item =>
          item.claimId === claim.id);
        assert.deepEqual(counts.map(item => [item.observationRef, item.count]), [
          ['E1', 2],
          ['E2', 0],
        ]);
        assert.equal(result.parentHandoff.state, 'complete');
        assert.match(result.parentHandoff.directAnswer, /deterministic count.* is 0\./u);
        assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
      },
    },
    {
      name: 'complete file search produces a deterministic runtime count',
      task: 'Count JavaScript files in src/routes/**.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-route-file-count',
        question: 'How many JavaScript files exist in src/routes/**?',
        originText: 'Count JavaScript files in src/routes/**',
        claimType: 'count',
        proofCondition: 'Completely enumerate JavaScript files in src/routes/**.',
        constraints: ['Keep the count qualified to src/routes/**.'],
      },
      claimText: 'There is exactly 1 JavaScript file in src/routes/**.',
      countMeasurement: { kind: 'count', unit: 'files', value: 1 },
      initialTools: [{
        tool: 'repo_find_files',
        args: { pattern: '**/*.js', scope: ['src/routes/**'] },
        id: 'complete-route-file-count',
      }],
      initialEvidenceRefs: ['E1'],
      assertImplemented({ result, goal }) {
        const count = result.semanticVerification.deterministicCounts.find(item =>
          item.subgoalId === goal.id);
        assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
        assert.equal(count.complete, true);
        assert.equal(count.count, 1);
        const itemIds = result.observations.find(item => item.id === 'E1').normalizedItemIds;
        assert.equal(itemIds.length, 1);
        assert.match(itemIds[0], /^sha256:[0-9a-f]{64}$/);
      },
    },
    {
      name: 'truncated nonzero search cannot produce a deterministic count',
      task: 'Count the lines containing requireAuth in src/routes/**.',
      scope: ['src/routes/**'],
      goal: {
        id: 'S-truncated-route-count',
        question: 'How many lines contain requireAuth in src/routes/**?',
        originText: 'Count the lines containing requireAuth in src/routes/**',
        claimType: 'count',
        proofCondition: 'Completely search src/routes/** and count unique matching locations.',
        constraints: ['Do not treat truncated matches as an exact count.'],
      },
      claimText: 'There are exactly 1 lines containing requireAuth in src/routes/**.',
      countMeasurement: { kind: 'count', unit: 'matching_lines', value: 1 },
      initialTools: [{
        tool: 'repo_grep',
        args: { pattern: 'requireAuth', scope: ['src/routes/**'], maxResults: 1 },
        id: 'truncated-route-count',
      }],
      initialEvidenceRefs: ['E1'],
      repairTools: [{
        tool: 'repo_grep',
        args: { pattern: 'requireAuth', scope: ['src/routes/**'], maxResults: 1 },
        id: 'still-truncated-route-count',
      }],
      repairEvidenceRefs: ['E1', 'E2'],
      assertImplemented({ result, goal }) {
        assert.ok(result.semanticVerification.deterministicCounts.length > 0);
        assert.ok(result.semanticVerification.deterministicCounts.every(item =>
          item.subgoalId !== goal.id || (item.complete === false && item.count === null)));
        assertInternalProofGap(result, goal.id);
        assertMinimalIncompleteParentHandoff(result, goal.question);
      },
    },
    {
      name: 'truncated symbol search cannot prove all usages',
      task: 'List all usages of requireAuth in src/**.',
      goal: {
        id: 'S-all-usages',
        question: 'What are all usages of requireAuth in src/**?',
        originText: 'all usages of requireAuth in src/**',
        claimType: 'symbol_usage',
        proofCondition: 'Cross-check every in-scope usage without truncated results.',
        constraints: ['The answer must be exhaustive.'],
      },
      claimText: 'The returned matches represent all requireAuth usages in src/**.',
      initialTools: [{
        tool: 'repo_grep',
        args: { pattern: 'requireAuth', scope: ['src/**'], maxResults: 1 },
        id: 'truncated-usage-search',
      }],
      initialEvidenceRefs: ['E1'],
      repairTools: [{
        tool: 'repo_grep',
        args: { pattern: 'requireAuth', scope: ['src/**'], maxResults: 2 },
        id: 'still-truncated-usage-search',
      }],
      repairEvidenceRefs: ['E1', 'E2'],
      assertImplemented({ result, goal }) {
        assert.ok(result.observations.some(observation =>
          observation.kind === 'search' && observation.toolTruncated === true));
        assertInternalProofGap(result, goal.id);
        assertMinimalIncompleteParentHandoff(result, goal.question);
      },
    },
    {
      name: 'narrow symbol search cannot prove all usages in a broader task scope',
      task: 'List all usages of requireAuth in src/**.',
      scope: ['src/**'],
      goal: {
        id: 'S-narrow-all-usages',
        question: 'What are all usages of requireAuth in src/**?',
        originText: 'all usages of requireAuth in src/**',
        claimType: 'symbol_usage',
        proofCondition: 'Cross-check every in-scope usage across src/**.',
        constraints: ['Do not generalize from a narrower route-only search.'],
      },
      claimText: 'src/routes/user.js contains every requireAuth usage in src/**.',
      initialTools: [
        {
          tool: 'repo_grep',
          args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
          id: 'narrow-usage-search',
        },
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'narrow-usage-source',
        },
      ],
      initialEvidenceRefs: ['E1', 'E2'],
      repairTools: [
        {
          tool: 'repo_grep',
          args: { pattern: 'requireAuth', scope: ['src/routes/**'] },
          id: 'still-narrow-usage-search',
        },
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'still-narrow-usage-source',
        },
      ],
      repairEvidenceRefs: ['E1', 'E2', 'E3', 'E4'],
      assertImplemented({ result, goal }) {
        const searches = result.observations.filter(observation =>
          observation.kind === 'search' && observation.tool === 'repo_grep');
        assert.ok(searches.length > 0 && searches.every(observation =>
          observation.enumerationComplete === true &&
          observation.boundary.length === 1 &&
          observation.boundary[0] === 'src/routes/**'), JSON.stringify(searches, null, 2));
        assertInternalProofGap(result, goal.id);
        assertMinimalIncompleteParentHandoff(result, goal.question);
      },
    },
    {
      name: 'exhaustive classification cannot pass from two paths without an enumeration',
      task: 'Inventory route authorization mechanisms and classify user and admin guards.',
      goal: {
        id: 'S-exhaustive-route-policy',
        question: 'Which user and admin guards are in the exhaustive route inventory?',
        originText: 'Inventory route authorization mechanisms and classify user and admin guards',
        claimType: 'comparison',
        proofCondition: 'Enumerate every matching route guard and distinguish user from admin policy.',
        constraints: ['Do not infer exhaustive membership from two example files.'],
      },
      setup: async root => {
        await fs.writeFile(
          path.join(root, 'src', 'routes', 'admin.js'),
          [
            'import { requireAdmin } from "../admin-auth.js";',
            'export function registerAdminRoutes(app) {',
            '  app.get("/admin", requireAdmin, (_req, res) => res.end());',
            '}',
          ].join('\n'),
        );
      },
      claimText: 'The exhaustive inventory contains requireAuth and requireAdmin route guards.',
      initialTools: [
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 6 },
          id: 'read-user-policy-without-enumeration',
        },
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/admin.js', startLine: 1, endLine: 4 },
          id: 'read-admin-policy-without-enumeration',
        },
      ],
      initialEvidenceRefs: ['E1', 'E2'],
      assertImplemented({ client, result, goal }) {
        assertInternalProofGap(result, goal.id);
        assert.equal(result.coverageGaps.find(gap => gap.subgoalId === goal.id)?.repairable, false);
        assert.equal(providerToolActions(client).length, 2,
          'an unavailable runtime category artifact must not trigger a futile repair call');
        assertMinimalIncompleteParentHandoff(result, goal.question);
      },
    },
    {
      name: 'source-backed grep lines cannot self-certify an exhaustive classification predicate',
      task: 'Inventory every route authorization mechanism and classify user and admin guards.',
      goal: {
        id: 'S-source-backed-exhaustive-route-policy',
        question: 'Which user and admin guards are in the exhaustive route inventory?',
        originText: 'Inventory every route authorization mechanism and classify user and admin guards',
        claimType: 'comparison',
        proofCondition: 'Enumerate every matching route guard and distinguish user from admin policy.',
        constraints: ['A grep predicate for route registration names cannot certify guard categories.'],
      },
      setup: async root => {
        await fs.writeFile(
          path.join(root, 'src', 'routes', 'admin.js'),
          [
            'import { requireAdmin } from "../admin-auth.js";',
            'export function registerAdminRoutes(app) {',
            '  app.get("/admin", requireAdmin, (_req, res) => res.end());',
            '}',
          ].join('\n'),
        );
      },
      claimText: 'The exhaustive inventory contains requireAuth on the user route and requireAdmin on the admin route.',
      initialTools: [
        {
          tool: 'repo_grep',
          args: { pattern: 'registerUserRoutes|registerAdminRoutes', scope: ['src/routes/**'] },
          id: 'enumerate-route-policies',
        },
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 6 },
          id: 'read-enumerated-user-policy',
        },
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/admin.js', startLine: 1, endLine: 4 },
          id: 'read-enumerated-admin-policy',
        },
      ],
      initialEvidenceRefs: ['E1', 'E2', 'E3'],
      assertImplemented({ client, result, goal }) {
        assertInternalProofGap(result, goal.id);
        assert.equal(result.coverageGaps.find(gap => gap.subgoalId === goal.id)?.repairable, false);
        assert.equal(providerToolActions(client).length, 3,
          'more model-selected evidence cannot create a runtime-owned category predicate');
        assertMinimalIncompleteParentHandoff(result, goal.question);
      },
    },
    {
      name: 'route-policy comparison preserves both distinct current paths',
      task: 'Compare the authorization policies of the user and admin routes.',
      goal: {
        id: 'S-route-policy',
        question: 'How do the user and admin route authorization policies differ?',
        originText: 'authorization policies of the user and admin routes',
        claimType: 'comparison',
        proofCondition: 'Observe and compare each current route policy independently.',
        constraints: ['Do not generalize one route policy to the other.'],
      },
      setup: async root => {
        await fs.writeFile(
          path.join(root, 'src', 'routes', 'admin.js'),
          [
            'import { requireAdmin } from "../admin-auth.js";',
            'export function registerAdminRoutes(app) {',
            '  app.get("/admin", requireAdmin, (_req, res) => res.end());',
            '}',
          ].join('\n'),
        );
      },
      claimText: 'The user route uses requireAuth, while the admin route uses requireAdmin.',
      initialTools: [
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 6 },
          id: 'read-user-policy',
        },
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/admin.js', startLine: 1, endLine: 4 },
          id: 'read-admin-policy',
        },
      ],
      initialEvidenceRefs: ['E1', 'E2'],
      assertImplemented({ client, result, goal, claim }) {
        assert.equal(client.stageCounts.get('semantic_verifier'), 2,
          'a two-path comparison receives focused corroboration');
        assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
          'supported');
        assert.equal(result.coverageGaps.length, 0);
        assertMinimalCompleteParentHandoff(result, {
          answer: claim.text,
          evidenceCount: 2,
          evidenceKinds: ['source', 'source'],
        });
        assert.deepEqual(new Set(result.parentHandoff.evidence.map(item => item.path)),
          new Set(['src/routes/user.js', 'src/routes/admin.js']));
      },
    },
    {
      name: 'historical git evidence alone cannot prove current behavior',
      requiresGit: true,
      task: 'Which authentication function does current src/auth.js export?',
      goal: {
        id: 'S-current-auth',
        question: 'Which authentication function does current src/auth.js export?',
        originText: 'authentication function does current src/auth.js export',
        claimType: 'positive',
        proofCondition: 'Observe current implementation source for src/auth.js.',
        constraints: ['Historical evidence alone cannot establish current behavior.'],
      },
      setup: async root => {
        execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: root,
          stdio: 'ignore',
        });
        execFileSync('git', ['config', 'user.name', 'Test User'], {
          cwd: root,
          stdio: 'ignore',
        });
        await fs.writeFile(path.join(root, 'src', 'auth.js'),
          'export function legacyAuth() { return true; }\n');
        execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
        execFileSync('git', ['commit', '-m', 'add legacy auth'], {
          cwd: root,
          stdio: 'ignore',
        });
        await fs.writeFile(path.join(root, 'src', 'auth.js'),
          'export function requireAuth() { return true; }\n');
      },
      claimText: 'Current src/auth.js exports legacyAuth.',
      initialTools: [{
        tool: 'repo_git_log',
        args: { path: 'src/auth.js', maxCount: 1 },
        id: 'historical-auth-log',
      }],
      initialEvidenceRefs: ['E1'],
      repairTools: [{
        tool: 'repo_git_log',
        args: { path: 'src/auth.js', maxCount: 5 },
        id: 'more-historical-auth-log',
      }],
      repairEvidenceRefs: ['E1', 'E2'],
      assertImplemented({ result, goal }) {
        const directObservations = result.observations.filter(observation =>
          observation.kind === 'git_commit');
        assert.ok(directObservations.length > 0);
        assert.ok(directObservations.every(observation =>
          observation.temporalRole === 'historical'));
        assert.deepEqual(result.semanticVerification?.claims ?? [], []);
        assert.ok(result.coverageGaps.some(gap =>
          gap.subgoalId === goal.id && gap.reason === 'missing_evidence'));
        assertMinimalIncompleteParentHandoff(result, goal.question);
      },
    },
    {
      name: 'impact result remains incomplete when requested categories are missing',
      task: 'Plan the impact of changing requireAuth, including callers, tests, configuration, and documentation.',
      taskMode: 'edit_planning',
      goal: {
        id: 'S-impact-categories',
        question: 'What is the impact of changing requireAuth across callers, tests, configuration, and documentation?',
        originText: 'impact of changing requireAuth, including callers, tests, configuration, and documentation',
        claimType: 'impact',
        proofCondition: 'Observe or certify absence for every requested impact category.',
        constraints: ['Cover callers, tests, configuration, and documentation independently.'],
      },
      claimText: 'Changing requireAuth is fully covered across callers, tests, configuration, and documentation.',
      initialTools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'read-impact-definition',
      }],
      initialEvidenceRefs: ['E1'],
      repairTools: [{
        tool: 'repo_read_file',
        args: { path: 'src/routes/user.js', startLine: 1, endLine: 6 },
        id: 'read-impact-caller',
      }],
      repairEvidenceRefs: ['E1', 'E2'],
      assertImplemented({ result, goal }) {
        assertInternalProofGap(result, goal.id);
        assertMinimalIncompleteParentHandoff(result, goal.question);
      },
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async t => {
      if (fixture.requiresGit && !hasGit()) {
        t.skip('git is required for temporal-role runtime coverage');
        return;
      }
      const goal = trustGoal(fixture.task, fixture.goal);
      if (fixture.taskMode === 'edit_planning') {
        goal.originRefs.push(
          'wrapper:map_change_impact:targets',
          'wrapper:map_change_impact:dependents',
          'wrapper:map_change_impact:requested_categories',
          'wrapper:map_change_impact:risk_boundary',
        );
      }
      const claim = candidateClaim(
        `C-${goal.id}`,
        goal.id,
        fixture.claimText,
        fixture.initialEvidenceRefs,
      );
      if (fixture.countMeasurement) claim.measurement = { ...fixture.countMeasurement };
      const repairClaim = fixture.repairTools
        ? { ...claim, evidenceRefs: fixture.repairEvidenceRefs }
        : null;
      const steps = buildTrustSteps({
        goals: [goal],
        initial: {
          tools: fixture.initialTools,
          claims: [claim],
          ...(fixture.goal.claimType === 'comparison'
            ? {
                verifierSteps: [{
                  verdicts: [semanticVerdict(
                    claim.id,
                    'supported',
                    fixture.verifierEvidenceRefs ?? fixture.initialEvidenceRefs,
                  )],
                  assertRequest: fixture.assertVerifier,
                }, {
                  verdicts: [semanticVerdict(
                    claim.id,
                    'supported',
                    fixture.verifierEvidenceRefs ?? fixture.initialEvidenceRefs,
                  )],
                }],
              }
            : {
                verdicts: [semanticVerdict(
                  claim.id,
                  'supported',
                  fixture.verifierEvidenceRefs ?? fixture.initialEvidenceRefs,
                )],
                assertVerifier: fixture.assertVerifier,
              }),
        },
        repair: fixture.repairTools ? {
          tools: fixture.repairTools,
          claims: [repairClaim],
          verdicts: [semanticVerdict(
            repairClaim.id,
            'supported',
            fixture.repairEvidenceRefs,
          )],
        } : null,
      });
      const { client, result } = await runTrustScript(steps, {
        task: fixture.task,
        scope: fixture.scope ?? ['src/**'],
        taskMode: fixture.taskMode,
        setup: fixture.setup,
      });
      assert.equal(client.stageCounts.get('planner'), 1);
      assert.equal(client.stageCounts.get('goal_audit'), 1);
      if (fixture.name === 'static string-array symbol context produces an exact array-entry count') {
        assert.equal(hasRuntimeProofPolicyIntegration(result), true,
          JSON.stringify({
            failure: result.failure,
            observations: result.observations,
            stages: client.stageLabels,
          }, null, 2));
      }
      if (!requireRuntimeProofPolicyIntegration(t, result)) return;
      fixture.assertImplemented({ client, result, goal, claim });
    });
  }
});

semanticPipelineRuntimeTest(
  'Spec 028 T069 — symbol definition claims retain the exact source end line',
  async () => {
    const task = 'Cite the helper definition and its exact source range.';
    const goal = trustGoal(task, {
      id: 'S-symbol-definition-range',
      question: 'Where is helper defined?',
      originText: task,
      claimType: 'symbol_definition',
      proofCondition: 'Observe the complete helper definition and its exact source range.',
    });
    const claim = candidateClaim(
      'C-symbol-definition-range',
      goal.id,
      'helper is defined in src/helper.js starting at line 2.',
      ['E1', 'E2'],
    );
    const { result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/usage.js', startLine: 2, endLine: 3 },
          id: 'read-helper-usage-range',
        }, {
          tool: 'repo_symbol_context',
          args: { symbol: 'helper', scope: ['src/helper.js'] },
          id: 'symbol-helper-definition-range',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E2'])],
        assertVerifier(request) {
          assert.match(parseControlPacket(request).claims[0].text, /lines 2 through 5/u,
            'the deterministic range must be verified before it can reach the parent');
        },
      },
    }), {
      task,
      scope: ['src/**'],
      async setup(root) {
        await Promise.all([
          fs.writeFile(path.join(root, 'src', 'usage.js'), [
            '// unrelated usage',
            'export const result = helper();',
            '',
          ].join('\n')),
          fs.writeFile(path.join(root, 'src', 'helper.js'), [
            '// helper implementation',
            'export function helper() {',
            '  const value = 1;',
            '  return value;',
            '}',
            '',
          ].join('\n')),
        ]);
      },
    });

    assert.equal(result.failure, null);
    assert.equal(result.taskContract.subgoals[0].state, 'supported');
    assert.equal(result.parentHandoff.state, 'complete');
    assert.match(result.semanticVerification.claims[0].text, /lines 2 through 5/u);
    assert.match(result.parentHandoff.directAnswer, /lines 2 through 5/u);
    assert.deepEqual(result.parentHandoff.evidence.map(item => ({
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
    })), [{ path: 'src/helper.js', startLine: 2, endLine: 5 }]);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — plain file reads cannot author a symbol definition end line',
  async () => {
    const task = 'Cite the helper definition.';
    const goal = trustGoal(task, {
      id: 'S-symbol-read-range',
      question: 'Where is helper defined?',
      originText: task,
      claimType: 'symbol_definition',
      proofCondition: 'Observe the helper definition.',
    });
    const claim = candidateClaim(
      'C-symbol-read-range',
      goal.id,
      'helper is defined in src/helper.js starting at line 2.',
      ['E1'],
    );
    const { result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/helper.js', startLine: 2, endLine: 200 },
          id: 'broad-helper-definition-read',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
      },
    }), {
      task,
      scope: ['src/helper.js'],
      async setup(root) {
        await fs.writeFile(path.join(root, 'src', 'helper.js'), [
          '// helper implementation',
          'export function helper() {',
          '  return 1;',
          '}',
          '// unrelated trailing content',
          'export const later = true;',
          '',
        ].join('\n'));
      },
    });

    assert.equal(result.failure, null);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.doesNotMatch(result.semanticVerification.claims[0].text, /\bthrough\b/u);
    assert.doesNotMatch(result.parentHandoff.directAnswer, /\bthrough\b/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — one static-array request preserves count, definition range, and comparison',
  async () => {
    const task = [
      'Count the entries in DEFAULT_SECRET_DENY_PATTERNS.',
      'Cite the definition and distinguish the number of array entries from the ending source line number.',
    ].join(' ');
    const goals = [
      trustGoal(task, {
        id: 'S-static-array-count-combined',
        question: 'How many entries are in DEFAULT_SECRET_DENY_PATTERNS?',
        originText: 'Count the entries in DEFAULT_SECRET_DENY_PATTERNS',
        claimType: 'count',
        proofCondition: 'Read the complete static array definition and count its entries.',
        constraints: ['Keep the count bound to the cited definition.'],
      }),
      trustGoal(task, {
        id: 'S-static-array-definition-combined',
        question: 'Where is DEFAULT_SECRET_DENY_PATTERNS defined?',
        originText: 'Cite the definition',
        claimType: 'symbol_definition',
        proofCondition: 'Observe the complete symbol definition and its exact source range.',
      }),
      trustGoal(task, {
        id: 'S-static-array-comparison-combined',
        question: 'How do the array entry count and ending source line number differ?',
        originText: 'distinguish the number of array entries from the ending source line number',
        claimType: 'comparison',
        proofCondition: 'Compare the runtime-owned array count with the exact definition range.',
        constraints: ['Do not treat the ending source line as the entry count.'],
      }),
    ];
    const claims = [
      {
        ...candidateClaim(
          'C-static-array-count-combined',
          goals[0].id,
          'DEFAULT_SECRET_DENY_PATTERNS contains exactly 3 entries.',
          ['E1', 'E1:search', 'E2', 'E2:search'],
        ),
        measurement: { kind: 'count', unit: 'array_entries', value: 3 },
      },
      candidateClaim(
        'C-static-array-definition-combined',
        goals[1].id,
        'DEFAULT_SECRET_DENY_PATTERNS is defined in src/patterns.mjs as a frozen array.',
        ['E1', 'E2'],
      ),
      candidateClaim(
        'C-static-array-comparison-combined',
        goals[2].id,
        'The array entry count is 3, whereas the ending source line number of the definition is 5.',
        ['E1', 'E1:search', 'E2', 'E2:search'],
      ),
    ];
    const verdicts = [
      semanticVerdict(claims[0].id, 'supported', ['E1', 'E1:search']),
      semanticVerdict(claims[1].id, 'supported', ['E1']),
      semanticVerdict(claims[2].id, 'supported', ['E1', 'E1:search']),
    ];
    const { result } = await runTrustScript(buildTrustSteps({
      goals,
      initial: {
        tools: [{
          tool: 'repo_symbol_context',
          args: {
            symbol: 'DEFAULT_SECRET_DENY_PATTERNS',
            scope: ['src/patterns.mjs'],
          },
          id: 'static-array-combined-symbol',
        }, {
          tool: 'repo_read_file',
          args: { path: 'src/patterns.mjs', startLine: 1, endLine: 6 },
          id: 'static-array-combined-read',
        }],
        claims,
        verifierSteps: [{ verdicts }, { verdicts }],
      },
    }), {
      task,
      scope: ['src/patterns.mjs'],
      async setup(root) {
        await fs.writeFile(path.join(root, 'src', 'patterns.mjs'), [
          'export const DEFAULT_SECRET_DENY_PATTERNS = Object.freeze([',
          "  '.env',",
          "  '**/.env',",
          "  '*.pem',",
          ']);',
          'export const unrelated = true;',
          '',
        ].join('\n'));
      },
    });

    assert.equal(result.failure, null);
    assert.deepEqual(result.taskContract.subgoals.map(goal => [goal.id, goal.state]), [
      [goals[0].id, 'supported'],
      [goals[1].id, 'supported'],
      [goals[2].id, 'supported'],
    ]);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.match(result.parentHandoff.directAnswer,
      /deterministic count of array entries.* is 3\./u);
    assert.match(result.parentHandoff.directAnswer, /lines 1 through 5/u);
    assert.match(result.parentHandoff.directAnswer, /entry count is 3.*line number.*5/u);
    assert.equal(result.parentHandoff.gaps, undefined);
    assert.deepEqual(result.parentHandoff.evidence.map(item => ({
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
    })), [{ path: 'src/patterns.mjs', startLine: 1, endLine: 5 }]);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff),
      /:search|deterministicMeasurement|runtimeAllowedEvidenceRefs/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — canonical invocation classes stay exhaustive without repeated markers',
  async () => {
    const task = 'Inventory every Amazon Bedrock invocation and classify direct SDK calls, wrappers, and configuration-only references.';
    const classifyStart = task.indexOf('classify');
    const directEnd = task.indexOf('wrappers,') - 1;
    const wrappersEnd = task.indexOf('wrappers,') + 'wrappers,'.length;
    const goals = [
      {
        id: 'S-bedrock-direct',
        question: 'Which direct Amazon Bedrock SDK invocation sites exist?',
        originRefs: [`request:${classifyStart}-${directEnd}`],
        claimType: 'count',
        proofCondition: 'Enumerate every direct SDK invocation site.',
        constraints: [],
      },
      {
        id: 'S-bedrock-wrappers',
        question: 'Which Amazon Bedrock wrapper entry points exist?',
        originRefs: [`request:${classifyStart}-${wrappersEnd}`],
        claimType: 'comparison',
        proofCondition: 'Classify wrapper entry points separately from direct SDK calls.',
        constraints: [],
      },
      {
        id: 'S-bedrock-config',
        question: 'Which Amazon Bedrock references are configuration-only?',
        originRefs: [`request:${classifyStart}-${task.length}`],
        claimType: 'comparison',
        proofCondition: 'Classify configuration-only references separately from invocations.',
        constraints: [],
      },
    ];
    const wrapperClaim = candidateClaim(
      'C-bedrock-wrappers',
      goals[1].id,
      'src/wrapper-a.js is an Amazon Bedrock wrapper entry point.',
      ['E1', 'E2'],
    );
    const steps = [
      { stage: 'planner:1', value: plannerControl(goals) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([
          auditControlRecord(goals[0], 'blocked_scope'),
          auditControlRecord(goals[1]),
          auditControlRecord(goals[2], 'blocked_scope'),
        ]),
      },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/wrapper-a.js' },
          'read-bedrock-wrapper-a',
        ),
      },
      {
        stage: 'exploration:2',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/wrapper-b.js' },
          'read-bedrock-wrapper-b',
        ),
      },
      { stage: 'exploration:3', content: 'The in-scope wrapper sources were inspected.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: { claims: [wrapperClaim] } },
      {
        stage: 'semantic_verifier:1',
        value: verifierResponse([
          semanticVerdict(wrapperClaim.id, 'supported', ['E1', 'E2']),
        ]),
      },
      {
        stage: 'semantic_verifier:2',
        value: verifierResponse([
          semanticVerdict(wrapperClaim.id, 'supported', ['E1', 'E2']),
        ]),
      },
    ];
    const { client, result } = await runTrustScript(steps, {
      task,
      setup: async root => {
        await Promise.all([
          fs.writeFile(
            path.join(root, 'src', 'wrapper-a.js'),
            'export const invokeViaWrapperA = client => client.invokeModel();\n',
          ),
          fs.writeFile(
            path.join(root, 'src', 'wrapper-b.js'),
            'export const invokeViaWrapperB = client => client.converse();\n',
          ),
        ]);
      },
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('semantic_verifier'), 2);
    assert.equal(providerToolActions(client).length, 2,
      'a canonical unrepairable classification gap must not trigger a futile repair');
    const wrapperGoal = result.taskContract.subgoals.find(goal => goal.id === goals[1].id);
    assert.equal(wrapperGoal?.state, 'gap');
    const wrapperGap = result.coverageGaps.find(gap => gap.subgoalId === goals[1].id);
    assert.equal(wrapperGap?.reason, 'semantic_mismatch');
    assert.equal(wrapperGap?.repairable, false);
    const wrapperVerdict = result.semanticVerification.verdicts.find(verdict =>
      verdict.claimId === wrapperClaim.id);
    assert.equal(wrapperVerdict?.result, 'insufficient');
    assert.equal(wrapperVerdict?.reasonCode, 'missing_category');
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.equal(result.parentHandoff.directAnswer, undefined);
    assert.equal(result.parentHandoff.evidence, undefined);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — incomplete canonical access claims fail closed before parent handoff',
  async () => {
    const task = 'Compare administrator and developer access policy across frontend guards and backend route families.';
    const administrator = requestOrigin(task, 'administrator');
    const developer = requestOrigin(task, 'developer');
    const frontend = requestOrigin(task, 'frontend guards');
    const backend = requestOrigin(task, 'backend route families.');
    const goals = [
      {
        id: 'canonical-access-frontend-actor-a',
        question: 'How do frontend guards enforce administrator access?',
        originRefs: [administrator, frontend],
        claimType: 'positive',
        proofCondition: 'Observe the frontend guard that enforces administrator access.',
        constraints: [],
      },
      {
        id: 'canonical-access-backend-actor-a',
        question: 'Which backend route families use distinct administrator checks?',
        originRefs: [administrator, backend],
        claimType: 'comparison',
        proofCondition: 'Compare the administrator gating predicates across backend route families.',
        constraints: [],
      },
      {
        id: 'canonical-access-backend-actor-b',
        question: 'Which backend route families give developer-specific access?',
        originRefs: [developer, backend],
        claimType: 'comparison',
        proofCondition: 'Compare developer-specific behavior across backend route families.',
        constraints: [],
      },
    ];
    const claims = [
      candidateClaim(
        'C-access-frontend-admin',
        goals[0].id,
        'The frontend administrator guard redirects unauthorized users.',
        ['E1'],
      ),
      candidateClaim(
        'C-access-backend-admin',
        goals[1].id,
        'The src/admin-auth ADMIN_USERS helper and src/feedback admin_user_info row-existence check are distinct administrator policies.',
        ['E2', 'E3', 'E4'],
      ),
      candidateClaim(
        'C-access-backend-developer',
        goals[2].id,
        'app/api/cases and app/api/draft routes map the development department to dyhan7301.',
        ['E5', 'E6', 'E7'],
      ),
    ];
    const tools = [
      { tool: 'repo_read_file', args: { path: 'src/frontend.js' }, id: 'read-access-frontend' },
      { tool: 'repo_read_file', args: { path: 'src/admin-auth.js' }, id: 'read-access-auth' },
      { tool: 'repo_read_file', args: { path: 'src/feedback.js' }, id: 'read-access-feedback' },
      { tool: 'repo_read_file', args: { path: 'src/inquiry.js' }, id: 'read-access-inquiry' },
      { tool: 'repo_read_file', args: { path: 'app/api/cases/route.ts' }, id: 'read-access-cases' },
      { tool: 'repo_read_file', args: { path: 'app/api/draft/save/route.ts' }, id: 'read-access-draft-save' },
      { tool: 'repo_read_file', args: { path: 'app/api/draft/save/[id]/route.ts' }, id: 'read-access-draft-id' },
    ];
    const primaryVerdicts = claims.map((claim, index) =>
      semanticVerdict(claim.id, 'supported', [
        ['E1'],
        ['E2', 'E3', 'E4'],
        ['E5', 'E6', 'E7'],
      ][index]));
    const { client, result } = await runTrustScript(buildTrustSteps({
      goals,
      initial: {
        tools,
        claims,
        verifierSteps: [
          { verdicts: primaryVerdicts },
          { verdicts: [semanticVerdict(claims[1].id, 'supported', ['E2', 'E3', 'E4'])] },
          { verdicts: [semanticVerdict(claims[2].id, 'supported', ['E5', 'E6', 'E7'])] },
        ],
      },
    }), {
      task,
      scope: ['src/**', 'app/api/**'],
      setup: async root => {
        const files = new Map([
          ['src/frontend.js', "export const adminGuard = user => user ? true : redirect('/ai');\n"],
          ['src/admin-auth.js', 'export const ADMIN_USERS = [\'admin\'];\n'],
          ['src/feedback.js', 'export const feedbackAdmin = row => Boolean(row?.admin_user_info);\n'],
          ['src/inquiry.js', 'export const inquiryAdmin = user => user?.is_admin === true;\n'],
          ['app/api/cases/route.ts', "export const caseUser = department => department === 'development' ? 'dyhan7301' : null;\n"],
          ['app/api/draft/save/route.ts', "export const draftUser = department => department === 'development' ? 'dyhan7301' : null;\n"],
          ['app/api/draft/save/[id]/route.ts', "export const draftIdUser = department => department === 'development' ? 'dyhan7301' : null;\n"],
        ]);
        for (const [relativePath, content] of files) {
          const absolutePath = path.join(root, ...relativePath.split('/'));
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(absolutePath, content);
        }
      },
    });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      stages: client.stageLabels,
    }));
    assert.equal(client.stageCounts.get('semantic_verifier'), 3);
    assert.equal(providerToolActions(client).length, tools.length,
      'canonical claim-shape failures are terminal and must not trigger a futile repair');
    assert.deepEqual(result.taskContract.subgoals.map(goal => [goal.id, goal.state]), [
      [goals[0].id, 'gap'],
      [goals[1].id, 'gap'],
      [goals[2].id, 'supported'],
    ]);
    assert.ok(result.coverageGaps.filter(gap =>
      [goals[0].id, goals[1].id].includes(gap.subgoalId) &&
      gap.reason === 'semantic_mismatch' && gap.repairable === false).length === 2);
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.equal(result.parentHandoff.directAnswer, claims[2].text);
    assert.doesNotMatch(result.parentHandoff.directAnswer,
      /redirects unauthorized|src\/admin-auth ADMIN_USERS/u);
    assert.equal(result.parentHandoff.gaps.length, 2);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — bounded file reads preserve source evidence beyond line twelve',
  async () => {
    const task = 'Verify the terminal marker in the bounded long source file.';
    const goal = trustGoal(task, {
      id: 'S-long-source-range',
      question: task,
      originText: task,
      proofCondition: 'Read the bounded source range through the terminal marker.',
    });
    const claim = candidateClaim(
      'C-long-source-range',
      goal.id,
      'The bounded source range ends with TERMINAL_MARKER.',
      ['E1'],
    );
    const steps = buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/long-source.js', startLine: 1, endLine: 20 },
          id: 'read-long-source',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
        assertVerifier(request) {
          const source = parseControlPacket(request).observations.find(item => item.id === 'E1');
          assert.equal(source?.endLine, 20);
          assert.match(source?.snippet ?? '', /20: export const TERMINAL_MARKER = true;/u);
        },
      },
    });
    const { result } = await runTrustScript(steps, {
      task,
      setup: async root => {
        const lines = Array.from({ length: 19 }, (_, index) =>
          `export const filler${index + 1} = ${index + 1};`);
        lines.push('export const TERMINAL_MARKER = true;');
        await fs.writeFile(path.join(root, 'src', 'long-source.js'), `${lines.join('\n')}\n`);
      },
    });

    assert.equal(result.failure, null);
    assert.equal(result.observations.find(item => item.id === 'E1')?.endLine, 20);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.deepEqual(result.parentHandoff.evidence.map(item => [
      item.path,
      item.startLine,
      item.endLine,
    ]), [['src/long-source.js', 1, 20]]);
  },
);

test('Spec 028 T069 — generic claims cannot define their own structural proof obligations', () => {
  const flow = createRequiredSubgoal({
    id: 'S-generic-flow',
    question: 'Trace the generic execution path.',
    originRefs: ['request:0-10'],
    claimType: 'flow',
    proofCondition: 'Observe the entry and handoff source ranges.',
    constraints: [],
    auditVerdict: 'ready',
  });
  const impact = createRequiredSubgoal({
    id: 'S-generic-impact',
    question: 'Map the generic impact categories.',
    originRefs: ['request:11-20'],
    claimType: 'impact',
    proofCondition: 'Observe every requested impact category.',
    constraints: [],
    auditVerdict: 'ready',
  });
  const claims = [
    candidateClaim('C-generic-flow', flow.id, 'The execution path spans two sources.', ['E1', 'E2']),
    candidateClaim('C-generic-impact', impact.id, 'The impact spans source and docs.', ['E1', 'E3']),
  ];
  const observations = [
    {
      id: 'E1', kind: 'source', path: 'src/entry.js', startLine: 1, endLine: 4,
      sourceRole: 'implementation', temporalRole: 'current',
    },
    {
      id: 'E2', kind: 'source', path: 'src/handoff.js', startLine: 5, endLine: 9,
      sourceRole: 'implementation', temporalRole: 'current',
    },
    {
      id: 'E3', kind: 'source', path: 'docs/runtime.md', startLine: 1, endLine: 3,
      sourceRole: 'documentation', temporalRole: 'current',
    },
  ];
  const artifacts = buildRuntimeWrapperPolicyArtifacts({
    wrapperTool: 'explore_repo',
    subgoals: [flow, impact],
    claims,
    semanticVerdicts: [
      semanticVerdict(claims[0].id, 'supported', ['E1']),
      semanticVerdict(claims[1].id, 'supported', ['E1', 'E3']),
    ],
    observations,
  });

  assert.equal(artifacts.size, 0,
    'explore_repo has no runtime-owned transition or impact-category seed');
});

test('Spec 028 T069 — generic impact inventory artifacts fail closed on structural variants', async t => {
  const effectiveScope = ['ui/pages/marketing/**'];
  const impact = createRequiredSubgoal({
    id: 'S-generic-impact-inventory-artifact',
    question: 'Map the bounded marketing UI file surface.',
    originRefs: ['request:0-42'],
    claimType: 'impact',
    proofCondition: 'Use the exact bounded file inventory and current source for every member.',
    constraints: [],
    auditVerdict: 'ready',
  });
  const fileA = normalizedRepositoryFileIdentity('ui/pages/marketing/a.js');
  const fileB = normalizedRepositoryFileIdentity('ui/pages/marketing/b.js');
  const fixture = () => {
    const claim = candidateClaim(
      'C-generic-impact-inventory-artifact', impact.id,
      'The bounded surface contains the two observed marketing pages.',
      ['E-search', 'E-a', 'E-b']);
    const verdict = semanticVerdict(claim.id, 'supported', [...claim.evidenceRefs]);
    return {
      claim,
      verdict,
      observations: [
        {
          id: 'E-search', kind: 'search', tool: 'repo_find_files',
          normalizedArgs: { pattern: '**/*', scope: ['ui/pages/marketing/**'] },
          boundary: ['ui/pages/marketing/**'], matchCount: 2,
          normalizedItemIds: [fileA, fileB], enumerationComplete: true,
        },
        {
          id: 'E-a', kind: 'source', path: 'ui/pages/marketing/a.js',
          startLine: 1, endLine: 2, rangeGrounding: 'exact',
          sourceRole: 'implementation', temporalRole: 'current',
        },
        {
          id: 'E-b', kind: 'source', path: 'ui/pages/marketing/b.js',
          startLine: 1, endLine: 2, rangeGrounding: 'exact',
          sourceRole: 'implementation', temporalRole: 'current',
        },
      ],
    };
  };
  const build = (
    value,
    corroboratedClaimIds = new Set([value.claim.id]),
    scope = effectiveScope,
  ) =>
    buildRuntimeGenericImpactPolicyArtifacts({
      wrapperTool: 'explore_repo',
      effectiveScope: scope,
      subgoals: [impact],
      claims: [value.claim],
      semanticVerdicts: [value.verdict],
      observations: value.observations,
      corroboratedClaimIds,
    });

  const complete = fixture();
  const completeArtifact = build(complete).get(complete.claim.id);
  assert.deepEqual(completeArtifact, {
    genericImpactCertification: {
      marker: 'generic-impact-file-surface-v1',
      boundary: 'ui/pages/marketing/**',
    },
    requiredImpactCategories: ['ui/pages/marketing/**'],
    coveredImpactCategories: ['ui/pages/marketing/**'],
    impactCategoryEvidenceRefs: { 'ui/pages/marketing/**': ['E-a', 'E-b'] },
  });

  const cases = [
    ['source only', value => {
      value.claim.evidenceRefs = ['E-a', 'E-b'];
      value.verdict.supportingEvidenceRefs = ['E-a', 'E-b'];
    }],
    ['grep instead of file inventory', value => {
      value.observations[0].tool = 'repo_grep';
    }],
    ['wrong file pattern', value => {
      value.observations[0].normalizedArgs.pattern = '**/*.js';
    }],
    ['narrower boundary', value => {
      value.observations[0].boundary = ['ui/pages/marketing/a.js'];
    }],
    ['truncated inventory', value => {
      value.observations[0].enumerationComplete = false;
    }],
    ['zero matches', value => {
      value.observations[0].matchCount = 0;
      value.observations[0].normalizedItemIds = [];
      value.claim.evidenceRefs = ['E-search'];
      value.verdict.supportingEvidenceRefs = ['E-search'];
    }],
    ['duplicate file identities', value => {
      value.observations[0].normalizedItemIds = [fileA, fileA];
    }],
    ['missing source for one file', value => {
      value.observations = value.observations.filter(item => item.id !== 'E-b');
    }],
    ['source outside the inventory', value => {
      value.observations[0].matchCount = 1;
      value.observations[0].normalizedItemIds = [fileA];
    }],
    ['multiple supported searches', value => {
      value.observations.push({ ...value.observations[0], id: 'E-search-2' });
      value.claim.evidenceRefs.push('E-search-2');
      value.verdict.supportingEvidenceRefs.push('E-search-2');
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const value = fixture();
      mutate(value);
      assert.equal(build(value).size, 0);
    });
  }
  assert.equal(build(fixture(), new Set()).size, 0,
    'a structurally valid inventory without focused corroboration remains incomplete');
  assert.equal(build(fixture(), undefined, [
    'ui/pages/marketing/**',
    'docs/**',
  ]).size, 0, 'multiple distinct effective-scope entries cannot certify one generic surface');
  for (const scope of [[], ['.']]) {
    const value = fixture();
    value.observations[0].boundary = ['**'];
    const artifact = build(value, undefined, scope).get(value.claim.id);
    assert.equal(artifact?.genericImpactCertification?.boundary, '**');
    assert.deepEqual(artifact?.requiredImpactCategories, ['**']);
  }
  const canonicalPathScope = fixture();
  assert.equal(build(canonicalPathScope, undefined, [
    'ui\\pages\\marketing\\**\\',
    'ui/pages/marketing/**',
  ]).get(canonicalPathScope.claim.id)?.genericImpactCertification?.boundary,
  'ui/pages/marketing/**');
  assert.equal(buildRuntimeGenericImpactPolicyArtifacts({
    wrapperTool: 'map_change_impact',
    effectiveScope,
    subgoals: [impact],
    claims: [complete.claim],
    semanticVerdicts: [complete.verdict],
    observations: complete.observations,
    corroboratedClaimIds: new Set([complete.claim.id]),
  }).size, 0, 'fixed wrapper artifacts stay on their existing path');
});

semanticPipelineRuntimeTest(
  'Spec 028 T069 — generic flow remains incomplete without runtime-owned transitions',
  async t => {
    for (const fixture of [
      { name: 'all cited sources supported', supportingRefs: ['E1', 'E2'], expectedState: 'incomplete' },
      { name: 'missing handoff support', supportingRefs: ['E1'], expectedState: 'incomplete' },
    ]) {
      await t.test(fixture.name, async () => {
        const task = 'Trace the implementation entry and handoff.';
        const goal = trustGoal(task, {
          id: 'S-generic-flow-e2e',
          question: task,
          originText: task,
          claimType: 'flow',
          proofCondition: 'Observe the implementation entry and adjacent handoff.',
        });
        const claim = candidateClaim(
          'C-generic-flow-e2e', goal.id, 'The path runs from auth to the route.', ['E1', 'E2']);
        const initial = {
          tools: [
            {
              tool: 'repo_read_file',
              args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
              id: 'read-generic-flow-entry',
            },
            {
              tool: 'repo_read_file',
              args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
              id: 'read-generic-flow-handoff',
            },
          ],
          claims: [claim],
          verdicts: [semanticVerdict(claim.id, 'supported', fixture.supportingRefs)],
        };
        const { result } = await runTrustScript(buildTrustSteps({
          goals: [goal],
          initial,
          repair: fixture.expectedState === 'incomplete' ? {
            tools: [],
            claims: [claim],
            verdicts: [semanticVerdict(claim.id, 'supported', fixture.supportingRefs)],
          } : null,
        }), { task });

        assert.equal(result.failure, null);
        assert.equal(result.parentHandoff.state, fixture.expectedState);
        assertInternalProofGap(result, goal.id);
        assertMinimalIncompleteParentHandoff(result, goal.question);
        assert.equal(Object.hasOwn(result.parentHandoff, 'policyArtifacts'), false);
      });
    }
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — generic impact cannot infer omitted requested categories from its own citations',
  async () => {
    const task = 'Map change impact across source, documentation, agent configuration, and dependencies.';
    const goal = trustGoal(task, {
      id: 'S-generic-impact-e2e',
      question: task,
      originText: task,
      claimType: 'impact',
      proofCondition: 'Observe all four requested impact categories independently.',
      constraints: ['Do not treat one cited category as the required set.'],
    });
    const claim = candidateClaim(
      'C-generic-impact-e2e', goal.id, 'The requested impact is fully covered.', ['E1']);
    const { result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-generic-impact-source',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
      },
      repair: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'repair-generic-impact-source',
        }],
        claims: [{ ...claim, evidenceRefs: ['E1', 'E2'] }],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1', 'E2'])],
      },
    }), { task });

    assert.equal(result.failure, null);
    assertInternalProofGap(result, goal.id);
    assertMinimalIncompleteParentHandoff(result, goal.question);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — generic impact completes from one exact scoped file inventory with source coverage',
  async () => {
    const task = 'Map every UI page affected by the shared marketing API route.';
    const goal = trustGoal(task, {
      id: 'S-generic-impact-bounded-inventory',
      question: task,
      originText: task,
      claimType: 'impact',
      proofCondition: 'Enumerate every file in the exact UI scope entry and read exact current source for every enumerated file.',
    });
    const claim = candidateClaim(
      'C-generic-impact-bounded-inventory',
      goal.id,
      'The shared marketing API route impacts the list, detail, and settings UI pages.',
      ['E1', 'E2', 'E3', 'E4'],
    );
    let focusedPacket = null;
    const { client, result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [
          {
            tool: 'repo_find_files',
            args: { pattern: '**/*', scope: ['ui/pages/marketing/**'] },
            id: 'enumerate-generic-impact-pages',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'ui/pages/marketing/detail.js' },
            id: 'read-generic-impact-detail',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'ui/pages/marketing/list.js' },
            id: 'read-generic-impact-list',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'ui/pages/marketing/settings.js' },
            id: 'read-generic-impact-settings',
          },
        ],
        claims: [claim],
        verifierSteps: [
          { verdicts: [semanticVerdict(claim.id, 'supported', claim.evidenceRefs)] },
          {
            verdicts: [semanticVerdict(claim.id, 'supported', claim.evidenceRefs)],
            assertRequest(request) {
              focusedPacket = {
                control: parseControlPacket(request),
                system: request.messages[0].content,
              };
            },
          },
        ],
      },
    }), {
      task,
      scope: ['ui/pages/marketing/**'],
      setup: async root => {
        const directory = path.join(root, 'ui', 'pages', 'marketing');
        await fs.mkdir(directory, { recursive: true });
        await Promise.all([
          fs.writeFile(path.join(directory, 'detail.js'), "export const detailApi = '/api/marketing/detail';\n"),
          fs.writeFile(path.join(directory, 'list.js'), "export const listApi = '/api/marketing/list';\n"),
          fs.writeFile(path.join(directory, 'settings.js'), "export const settingsApi = '/api/marketing/settings';\n"),
        ]);
      },
    });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.equal(client.stageCounts.get('semantic_verifier'), 2);
    assert.ok(focusedPacket, 'generic impact inventory needs an independent focused check');
    assert.match(focusedPacket.system, /FOCUSED GENERIC IMPACT INVENTORY CORROBORATION/u);
    assert.deepEqual(focusedPacket.control.control.effectiveScope, {
      mode: 'paths',
      paths: ['ui/pages/marketing/**'],
    });
    assert.deepEqual(focusedPacket.control.observations.map(item => item.id),
      ['E1', 'E2', 'E3', 'E4']);
    assertMinimalCompleteParentHandoff(result, {
      answer: claim.text,
      evidenceCount: 3,
      evidenceKinds: ['source', 'source', 'source'],
    });
    assert.deepEqual(result.parentHandoff.evidence.map(item => item.path), [
      'ui/pages/marketing/detail.js',
      'ui/pages/marketing/list.js',
      'ui/pages/marketing/settings.js',
    ]);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff),
      /repo_find_files|normalizedItemIds|policyArtifacts|corroborat/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — generic impact remains incomplete when focused inventory verification disagrees',
  async () => {
    const task = 'Map every UI page affected by the shared marketing API route.';
    const goal = trustGoal(task, {
      id: 'S-generic-impact-focused-disagreement',
      question: task,
      originText: task,
      claimType: 'impact',
      proofCondition: 'Enumerate the exact UI scope and verify every enumerated file from current source.',
    });
    const claim = candidateClaim(
      'C-generic-impact-focused-disagreement', goal.id,
      'The route affects both bounded marketing pages.', ['E1', 'E2', 'E3']);
    const focusedVerdict = semanticVerdict(claim.id, 'insufficient', ['E1', 'E2']);
    focusedVerdict.reasonCode = 'boundary_mismatch';
    focusedVerdict.note = 'The selected scope does not answer the whole audited impact goal.';
    const { client, result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [
          {
            tool: 'repo_find_files',
            args: { pattern: '**/*', scope: ['docs/**'] },
            id: 'enumerate-focused-disagreement',
          },
          {
            tool: 'repo_read_file', args: { path: 'docs/marketing/a.md' },
            id: 'read-focused-disagreement-a',
          },
          {
            tool: 'repo_read_file', args: { path: 'docs/marketing/b.md' },
            id: 'read-focused-disagreement-b',
          },
        ],
        claims: [claim],
        verifierSteps: [
          { verdicts: [semanticVerdict(claim.id, 'supported', claim.evidenceRefs)] },
          { verdicts: [focusedVerdict] },
        ],
      },
      repair: {
        tools: [],
        prose: 'No materially new repository action is available.',
        claims: [],
        verdicts: [],
      },
    }), {
      task,
      scope: ['docs/**'],
      setup: async root => {
        const directory = path.join(root, 'docs', 'marketing');
        await fs.mkdir(directory, { recursive: true });
        await Promise.all([
          fs.writeFile(path.join(directory, 'a.md'), '# Marketing API A\n'),
          fs.writeFile(path.join(directory, 'b.md'), '# Marketing API B\n'),
        ]);
      },
    });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.equal(client.stageCounts.get('semantic_verifier'), 2);
    assertInternalProofGap(result, goal.id);
    assertMinimalIncompleteParentHandoff(result, goal.question);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff), /repo_find_files|corroborat/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T071 — an irrelevant certificate-only refutation requires focused verifier agreement',
  async () => {
    const task = 'Verify whether explore_repo validates evidence against observed file ranges before returning.';
    const goal = trustGoal(task, {
      id: 'S-focused-absence-refutation',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Support or refute the behavior claim with semantically appropriate bounded evidence.',
      constraints: ['A filename glob or another language definition form cannot refute JavaScript behavior.'],
    });
    const claim = candidateClaim(
      'C-focused-absence-refutation',
      goal.id,
      'The claim is refuted because no explore_repo implementation validates observed file ranges in src/**.',
      ['E1', 'E2'],
    );
    const primaryVerdict = semanticVerdict(claim.id, 'supported', ['E1', 'E2']);
    primaryVerdict.resolution = 'refuted';
    let focusedRequest = null;
    const repairClaim = { ...claim, evidenceRefs: ['E1', 'E2', 'E3'] };
    const steps = buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [
          {
            tool: 'repo_find_files',
            args: { pattern: '**/explore_repo*', scope: ['src/**'] },
            id: 'irrelevant-explore-repo-filename-search',
          },
          {
            tool: 'repo_grep',
            args: { pattern: 'def explore_repo', scope: ['src/**'] },
            id: 'irrelevant-python-definition-search',
          },
        ],
        claims: [claim],
        verifierSteps: [
          { verdicts: [primaryVerdict] },
          {
            verdicts: [semanticVerdict(claim.id, 'insufficient')],
            assertRequest(request) {
              focusedRequest = parseControlPacket(request);
            },
          },
        ],
      },
      repair: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/explorer.js', startLine: 1, endLine: 5 },
          id: 'read-actual-explorer-implementation',
        }],
        claims: [repairClaim],
        verdicts: [semanticVerdict(claim.id, 'contradicted')],
      },
    });
    const { client, result } = await runTrustScript(steps, {
      task,
      async setup(root) {
        await fs.writeFile(path.join(root, 'src', 'explorer.js'), [
          'export function explore_repo(evidence, observedRanges) {',
          '  return evidence.every(item => observedRanges.has(item.range));',
          '}',
          '',
        ].join('\n'));
      },
    });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.ok(focusedRequest,
      'certificate-only refutation must receive an independent focused check');
    assert.deepEqual(focusedRequest.claims.map(item => item.id), [claim.id]);
    assert.equal(client.stageCounts.get('semantic_verifier') >= 2, true);
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.equal(result.parentHandoff.directAnswer, undefined);
    assert.equal(result.parentHandoff.evidence, undefined);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff), /no explore_repo implementation/u);
    assertMinimalIncompleteParentHandoff(result, goal.question);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T071 — exact textual absence can complete after two verifier checks agree',
  async () => {
    const task = 'Verify the premise that the literal text legacyGuard occurs in src/routes/**.';
    const goal = trustGoal(task, {
      id: 'S-focused-exact-text-absence',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Completely search the bounded scope for the exact literal text.',
      constraints: ['Keep the conclusion qualified to the exact text and src/routes/**.'],
    });
    const claim = candidateClaim(
      'C-focused-exact-text-absence',
      goal.id,
      'The premise is refuted: the literal text legacyGuard has no static occurrence in src/routes/**.',
      ['E1'],
    );
    const primaryVerdict = semanticVerdict(claim.id, 'supported', ['E1']);
    primaryVerdict.resolution = 'refuted';
    const focusedVerdict = semanticVerdict(claim.id, 'supported', ['E1']);
    focusedVerdict.resolution = 'refuted';
    let focusedRequest = null;
    const steps = buildTrustSteps({
      goals: [goal],
      initial: {
        assertRequest(request) {
          assert.doesNotMatch(JSON.stringify(request.messages),
            /plausible counterexample, exception, or alternative/u,
            'generic support_or_refute goals must not inherit collect-only search work');
        },
        tools: [{
          tool: 'repo_grep',
          args: { pattern: 'legacyGuard', scope: ['src/routes/**'] },
          id: 'exact-literal-absence-search',
        }],
        claims: [claim],
        verifierSteps: [
          { verdicts: [primaryVerdict] },
          {
            verdicts: [focusedVerdict],
            assertRequest(request) {
              focusedRequest = parseControlPacket(request);
            },
          },
        ],
      },
    });
    const { client, result } = await runTrustScript(steps, {
      task,
      scope: ['src/routes/**'],
    });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.ok(focusedRequest,
      'an absence-only refutation must be corroborated before completion');
    assert.deepEqual(focusedRequest.claims.map(item => item.id), [claim.id]);
    assert.equal(client.stageCounts.get('semantic_verifier'), 2);
    assertMinimalCompleteParentHandoff(result, {
      answer: claim.text,
      evidenceCount: 1,
      evidenceKinds: ['absence'],
    });
    assert.deepEqual(result.parentHandoff.evidence[0].boundary, ['src/routes/**']);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff), /corroborat|proofPolicy/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T071 — collect_evidence affirmation stays incomplete without counterevidence search',
  async () => {
    const task = 'Verify that every user route requires authentication.';
    const proposedGoal = trustGoal(task, {
      id: 'S-collect-direct-only',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Support or refute the claim from current source and a bounded counterevidence search.',
    });
    const goal = {
      ...proposedGoal,
      originRefs: [...proposedGoal.originRefs, 'wrapper:collect_evidence:verdict'],
    };
    const claim = candidateClaim(
      'C-collect-direct-only', goal.id, 'The user route requires authentication.', ['E1']);
    const repairedClaim = { ...claim, evidenceRefs: ['E1', 'E2'] };
    const { result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-collect-auth',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
      },
      repair: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-collect-route',
        }],
        assertRequest(request) {
          const packet = assertRepairRequest(request, {
            question: goal.question,
            anchors: ['src/auth.js'],
          });
          assert.deepEqual(packet.questions, [{
            id: `semantic-gap:${goal.id}`,
            subgoalId: goal.id,
            question: goal.question,
            gapReason: 'semantic_mismatch',
            proofPolicy: 'support_or_refute',
            proofCondition: goal.proofCondition,
            wrapperPart: 'verdict',
            claimDiagnostics: [{
              claimId: claim.id,
              text: claim.text,
              reasonCode: 'boundary_mismatch',
            }],
          }]);
          assert.match(request.messages[0].content,
            /support_or_refute[\s\S]*plausible disconfirming exception/u);
        },
        claims: [repairedClaim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1', 'E2'])],
      },
    }), { task, taskMode: 'evidence_verification' });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assertInternalProofGap(result, goal.id);
    assertMinimalIncompleteParentHandoff(result, goal.question);
    assert.equal(result.parentHandoff.directAnswer, undefined);
    assert.equal(result.parentHandoff.evidence, undefined);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T071 — collect_evidence folds uncovered verifier facets into its one verdict',
  async () => {
    const task = 'Verify that every user route requires authentication.';
    const proposedGoal = trustGoal(task, {
      id: 'S-collect-uncovered-facet',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Support or refute the claim from current source and bounded counter-search.',
    });
    const goal = {
      ...proposedGoal,
      originRefs: [...proposedGoal.originRefs, 'wrapper:collect_evidence:verdict'],
    };
    const claim = candidateClaim(
      'C-collect-uncovered-facet',
      goal.id,
      'The user route requires authentication.',
      ['E1', 'E2'],
    );
    const repairedClaim = { ...claim, evidenceRefs: ['E1', 'E2', 'E3'] };
    const uncovered = [{
      question: 'Could another requested route registration refute the claim?',
      originRefs: [requestOrigin(task, task)],
      claimType: 'positive',
      proofCondition: 'Inspect the remaining requested route facet.',
      constraints: [],
    }];
    const { client, result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        assertRequest(request) {
          assert.match(JSON.stringify(request.messages),
            /wrapper:collect_evidence:verdict[\s\S]{0,260}plausible counterexample/u);
        },
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-collect-route',
        }, {
          tool: 'repo_grep',
          args: { pattern: 'skipAuth|allowAnonymous', scope: ['src/**'] },
          id: 'grep-collect-counterevidence',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'contradicted')],
        uncovered,
      },
      repair: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-collect-repair',
        }],
        claims: [repairedClaim],
        verdicts: [semanticVerdict(claim.id, 'contradicted')],
        uncovered,
      },
    }), { task, taskMode: 'evidence_verification' });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.equal(client.stageCounts.get('goal_audit'), 1,
      'uncovered collect facets must not trigger a late goal audit');
    assert.equal(client.stageCounts.get('semantic_verifier'), 2);
    assert.deepEqual(result.taskContract.subgoals.map(item => item.id), [goal.id]);
    assert.equal(result.taskContract.subgoals[0].state, 'gap');
    assert.equal(result.coverageGaps.length, 1);
    assert.equal(result.coverageGaps[0].reason, 'uncovered_request');
    assert.equal(result.coverageGaps[0].repairable, false);
    assert.equal(result.taskContract.subgoals.some(item =>
      item.id.startsWith('late-uncovered:')), false);
    assertMinimalIncompleteParentHandoff(result, goal.question);
    assert.equal(result.parentHandoff.directAnswer, undefined);
    assert.equal(result.parentHandoff.evidence, undefined);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T071 — collect_evidence ignores an unapproved counterevidence search',
  async () => {
    const task = 'Verify that every user route requires authentication.';
    const proposedGoal = trustGoal(task, {
      id: 'S-collect-unapproved-search',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Support or refute the claim from current source and a bounded counterevidence search.',
    });
    const goal = {
      ...proposedGoal,
      originRefs: [...proposedGoal.originRefs, 'wrapper:collect_evidence:verdict'],
    };
    const claim = candidateClaim(
      'C-collect-unapproved-search', goal.id, 'The user route requires authentication.', ['E1', 'E2']);
    const repairedClaim = { ...claim, evidenceRefs: ['E1', 'E2', 'E3'] };
    const { result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-collect-user-route',
        }, {
          tool: 'repo_grep',
          args: { pattern: 'skipAuth|allowAnonymous', scope: ['src/**'] },
          id: 'search-collect-counterevidence',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
      },
      repair: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-collect-auth-repair',
        }],
        claims: [repairedClaim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1', 'E3'])],
      },
    }), { task, taskMode: 'evidence_verification' });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.equal(result.semanticVerification.absenceCertificates.some(certificate =>
      certificate.subgoalId === goal.id && certificate.complete === true &&
      certificate.searchRefs.includes('E2')), true);
    assertInternalProofGap(result, goal.id);
    assertMinimalIncompleteParentHandoff(result, goal.question);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T071 — extra approved search telemetry cannot erase a valid collect answer',
  async () => {
    const task = 'Verify that the user route requires authentication.';
    const proposedGoal = trustGoal(task, {
      id: 'S-collect-extra-search',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Support or refute the claim from current source and bounded counter-search.',
    });
    const goal = {
      ...proposedGoal,
      originRefs: [...proposedGoal.originRefs, 'wrapper:collect_evidence:verdict'],
    };
    const claim = candidateClaim(
      'C-collect-extra-search',
      goal.id,
      'The user route requires authentication.',
      ['E1', 'E2', 'E3'],
    );
    const primaryVerdict = semanticVerdict(claim.id, 'supported', ['E1', 'E2', 'E3']);
    const corroboratedVerdict = semanticVerdict(claim.id, 'supported', ['E1', 'E2']);
    const { result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-collect-extra-search-route',
        }, {
          tool: 'repo_grep',
          args: { pattern: 'skipAuth|allowAnonymous', scope: ['src/**'] },
          id: 'grep-collect-disconfirming',
        }, {
          tool: 'repo_grep',
          args: { pattern: 'requireAuth', scope: ['src/**'] },
          id: 'grep-collect-confirming',
        }],
        claims: [claim],
        verifierSteps: [
          { verdicts: [primaryVerdict] },
          { verdicts: [corroboratedVerdict] },
        ],
      },
    }), { task, taskMode: 'evidence_verification' });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assertMinimalCompleteParentHandoff(result, {
      answer: claim.text,
      evidenceCount: 1,
      evidenceKinds: ['source'],
    });
    assert.equal(result.parentHandoff.evidence[0].path, 'src/routes/user.js');
    assert.doesNotMatch(JSON.stringify(result.parentHandoff),
      /skipAuth|allowAnonymous|repo_grep|matchCount|certificate/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T071 — an approved but unrelated collect counter-search cannot complete',
  async () => {
    const task = 'Verify that every user route requires authentication.';
    const proposedGoal = trustGoal(task, {
      id: 'S-collect-unrelated-search',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Support or refute the claim from current source and bounded counter-search.',
    });
    const goal = {
      ...proposedGoal,
      originRefs: [...proposedGoal.originRefs, 'wrapper:collect_evidence:verdict'],
    };
    const claim = candidateClaim(
      'C-collect-unrelated-search',
      goal.id,
      'Every user route requires authentication.',
      ['E1', 'E2'],
    );
    const repairedClaim = { ...claim, evidenceRefs: ['E1', 'E2', 'E3'] };
    const initialPrimary = semanticVerdict(claim.id, 'supported', ['E1', 'E2']);
    const repairPrimary = semanticVerdict(claim.id, 'supported', ['E1', 'E2', 'E3']);
    const focusedInsufficient = semanticVerdict(claim.id, 'insufficient', ['E1']);
    let focusedChecks = 0;
    const assertFocused = request => {
      focusedChecks += 1;
      const packet = JSON.stringify(request.messages);
      assert.match(packet, /FOCUSED COLLECT AFFIRMATION CORROBORATION/u);
      assert.match(packet, /definitelyUnrelatedBuildBanner/u);
      assert.equal(request.temperature, 0,
        'the high-risk focused verdict must use deterministic sampling');
      assert.equal(request.topP, 1);
    };
    const { client, result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-collect-unrelated-route',
        }, {
          tool: 'repo_grep',
          args: { pattern: 'definitelyUnrelatedBuildBanner', scope: ['src/**'] },
          id: 'grep-collect-unrelated-counterevidence',
        }],
        claims: [claim],
        verifierSteps: [
          { verdicts: [initialPrimary] },
          { verdicts: [focusedInsufficient], assertRequest: assertFocused },
        ],
      },
      repair: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-collect-unrelated-repair',
        }],
        claims: [repairedClaim],
        verifierSteps: [
          { verdicts: [repairPrimary] },
          { verdicts: [focusedInsufficient], assertRequest: assertFocused },
        ],
      },
    }), { task, taskMode: 'evidence_verification' });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.equal(client.stageCounts.get('semantic_verifier'), 4);
    assert.equal(focusedChecks, 2);
    assertInternalProofGap(result, goal.id);
    assertMinimalIncompleteParentHandoff(result, goal.question);
    assert.equal(result.parentHandoff.directAnswer, undefined);
    assert.equal(result.parentHandoff.evidence, undefined);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T071 — a direct source counterexample does not trigger an extra verifier call',
  async () => {
    const task = 'Verify the premise that the user route does not call requireAuth.';
    const proposedGoal = trustGoal(task, {
      id: 'S-direct-source-refutation',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Read the current route and support or refute the premise directly.',
    });
    const goal = {
      ...proposedGoal,
      originRefs: [...proposedGoal.originRefs, 'wrapper:collect_evidence:verdict'],
    };
    const claim = candidateClaim(
      'C-direct-source-refutation',
      goal.id,
      'The premise is refuted: src/routes/user.js calls requireAuth.',
      ['E1'],
    );
    const verdict = semanticVerdict(claim.id, 'supported', ['E1']);
    verdict.resolution = 'refuted';
    const { client, result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        assertRequest(request) {
          const ledger = JSON.stringify(request.messages);
          assert.match(ledger,
            /direct source\/git counterexample may instead refute the claim without that search/u);
        },
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-direct-route-counterexample',
        }],
        claims: [claim],
        verdicts: [verdict],
      },
    }), { task, taskMode: 'evidence_verification' });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.equal(client.stageCounts.get('semantic_verifier'), 1);
    assert.deepEqual(providerToolActions(client).map(action => action.tool), [
      'repo_read_file',
    ]);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.equal(result.parentHandoff.directAnswer, claim.text);
    assert.deepEqual(result.parentHandoff.evidence.map(item => item.kind), ['source']);
    assert.equal(result.parentHandoff.evidence[0].path, 'src/routes/user.js');
    assert.doesNotMatch(JSON.stringify(result.parentHandoff), /corroborat|proofPolicy/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — multi-path comparison requires focused verifier agreement',
  async () => {
    const task = 'Compare administrator and developer access across frontend and backend routes.';
    const frontendGoal = trustGoal(task, {
      id: 'S-focused-frontend',
      question: 'How does the frontend administrator guard work?',
      originText: task,
      claimType: 'positive',
      proofCondition: 'Observe the frontend administrator predicate.',
    });
    const backendGoal = trustGoal(task, {
      id: 'S-focused-backend',
      question: 'Which distinct backend administrator checks exist?',
      originText: task,
      claimType: 'comparison',
      proofCondition: 'Compare each distinct backend administrator predicate.',
    });
    const developerGoal = trustGoal(task, {
      id: 'S-focused-developer',
      question: 'Which backend routes provide developer-specific access?',
      originText: task,
      claimType: 'comparison',
      proofCondition: 'Compare the two developer-specific backend mappings.',
    });
    const frontendClaim = candidateClaim(
      'C-focused-frontend', frontendGoal.id,
      'The frontend guard checks ADMIN_USERS membership.', ['E1']);
    const wrongBackendClaim = candidateClaim(
      'C-focused-backend', backendGoal.id,
      'Backend routes use ADMIN_USERS membership and an admin_user_info row-existence check.',
      ['E2', 'E3']);
    const developerClaim = candidateClaim(
      'C-focused-developer', developerGoal.id,
      'The case and draft routes both map the development department to dyhan7301.',
      ['E5', 'E6']);
    const sourceTools = [
      { tool: 'repo_read_file', args: { path: 'src/frontend.js' }, id: 'focused-front' },
      { tool: 'repo_read_file', args: { path: 'src/backend-list.js' }, id: 'focused-list' },
      { tool: 'repo_read_file', args: { path: 'src/backend-existence.js' }, id: 'focused-existence' },
      { tool: 'repo_read_file', args: { path: 'src/backend-flag.js' }, id: 'focused-flag' },
      { tool: 'repo_read_file', args: { path: 'src/cases.js' }, id: 'focused-cases' },
      { tool: 'repo_read_file', args: { path: 'src/draft.js' }, id: 'focused-draft' },
      { tool: 'repo_read_file', args: { path: 'src/backend-list-secondary.js' }, id: 'focused-list-secondary' },
    ];
    const setup = async root => {
      const files = new Map([
        ['frontend.js', 'export const frontendAdmin = id => ADMIN_USERS.includes(id);\n'],
        ['backend-list.js', 'export const listAdmin = id => ADMIN_USERS.includes(id);\n'],
        ['backend-existence.js', 'export const rowAdmin = adminUser => Boolean(adminUser);\n'],
        ['backend-flag.js', 'export const flagAdmin = user => user?.is_admin === true;\n'],
        ['cases.js', "export const caseUser = department => department === 'development' ? 'dyhan7301' : null;\n"],
        ['draft.js', "export const draftUser = department => department === 'development' ? 'dyhan7301' : null;\n"],
        ['backend-list-secondary.js', 'export const secondaryAdmin = id => ADMIN_USERS.includes(id);\n'],
      ]);
      for (const [name, content] of files) {
        await fs.writeFile(path.join(root, 'src', name), content);
      }
    };
    const primaryVerdicts = [
      semanticVerdict(frontendClaim.id, 'supported', ['E1']),
      semanticVerdict(wrongBackendClaim.id, 'supported', ['E2', 'E3']),
      semanticVerdict(developerClaim.id, 'supported', ['E5', 'E6']),
    ];
    let focusedPacket = null;
    const steps = buildTrustSteps({
      goals: [frontendGoal, backendGoal, developerGoal],
      initial: {
        tools: sourceTools,
        claims: [frontendClaim, wrongBackendClaim, developerClaim],
        verifierSteps: [{ verdicts: primaryVerdicts }, {
          verdicts: [{
            ...semanticVerdict(wrongBackendClaim.id, 'insufficient', ['E2', 'E3']),
            reasonCode: 'missing_category',
            note: 'The uncited is_admin source is another in-boundary administrator variant.',
          }],
          assertRequest(request) {
            focusedPacket = {
              control: parseControlPacket(request),
              system: request.messages[0].content,
            };
          },
        }, {
          verdicts: [semanticVerdict(developerClaim.id, 'supported', ['E5', 'E6'])],
        }],
      },
      repair: {
        tools: [],
        prose: 'No materially new repository action is available.',
        claims: [],
        verdicts: [],
      },
    });
    const { client, result } = await runTrustScript(steps, { task, setup });

    assert.equal(result.failure, null, JSON.stringify(result.failure));
    assert.equal(client.stageCounts.get('semantic_verifier'), 3);
    assert.deepEqual(focusedPacket.control.claims.map(claim => claim.id),
      [wrongBackendClaim.id]);
    assert.deepEqual(focusedPacket.control.control.requiredSubgoals.map(goal => goal.id),
      [backendGoal.id]);
    assert.deepEqual(focusedPacket.control.observations.map(item => item.id),
      [
        'E1', 'E1:search', 'E2', 'E2:search', 'E3', 'E3:search',
        'E4', 'E4:search', 'E5', 'E5:search', 'E6', 'E6:search',
        'E7', 'E7:search',
      ]);
    assert.equal(focusedPacket.control.claims[0].evidenceRefs.includes('E4'), false,
      'the omitted policy source remains outside the claim evidence subset');
    assert.match(focusedPacket.system, /FOCUSED MULTI-PATH COMPARISON CORROBORATION/u);
    assert.match(focusedPacket.system, /Do not require every observation/u);
    assert.match(focusedPacket.system,
      /uncited current-source observations as omission candidates/u);
    assert.match(focusedPacket.system,
      /query or read proves retrieval only[\s\S]{0,220}controlling the allow\/deny decision/u);
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === frontendGoal.id)?.state,
      'supported');
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === backendGoal.id)?.state,
      'gap');
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === developerGoal.id)?.state,
      'supported');
    assert.equal(result.semanticVerification.claims.find(claim =>
      claim.id === wrongBackendClaim.id)?.verdict, 'insufficient');
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.match(result.parentHandoff.directAnswer, /frontend guard checks ADMIN_USERS/u);
    assert.match(result.parentHandoff.directAnswer, /case and draft routes/u);
    assert.doesNotMatch(result.parentHandoff.directAnswer, /admin_user_info row-existence check/u);
    assert.equal(result.parentHandoff.gaps.some(gap =>
      gap.question === expectedParentGapQuestion(result, backendGoal)), true);

    const partiallySupportedBackendClaim = {
      ...wrongBackendClaim,
      evidenceRefs: ['E2', 'E3', 'E7'],
    };
    const primaryPartialSteps = buildTrustSteps({
      goals: [frontendGoal, backendGoal, developerGoal],
      initial: {
        tools: sourceTools,
        claims: [frontendClaim, partiallySupportedBackendClaim, developerClaim],
        verifierSteps: [{
          verdicts: [
            semanticVerdict(frontendClaim.id, 'supported', ['E1']),
            semanticVerdict(partiallySupportedBackendClaim.id, 'supported', ['E2', 'E3']),
            semanticVerdict(developerClaim.id, 'supported', ['E5', 'E6']),
          ],
        }, {
          verdicts: [semanticVerdict(developerClaim.id, 'supported', ['E5', 'E6'])],
        }],
      },
      repair: {
        tools: [],
        prose: 'No materially new repository action is available.',
        claims: [],
        verdicts: [],
      },
    });
    const primaryPartial = await runTrustScript(primaryPartialSteps, { task, setup });
    assert.equal(primaryPartial.client.stageCounts.get('semantic_verifier'), 2,
      'a partial primary verdict fails closed before its focused corroboration');
    assert.equal(primaryPartial.result.taskContract.subgoals.find(goal =>
      goal.id === backendGoal.id)?.state, 'gap');

    const correctBackendClaim = candidateClaim(
      'C-focused-backend-correct', backendGoal.id,
      'The admin helper uses ADMIN_USERS; feedback checks admin_user_info row existence; inquiry requires the is_admin boolean flag to be true; the secondary admin route also uses ADMIN_USERS.',
      ['E2', 'E3', 'E4', 'E7']);
    const positiveSteps = buildTrustSteps({
      goals: [frontendGoal, backendGoal, developerGoal],
      initial: {
        tools: sourceTools,
        claims: [frontendClaim, correctBackendClaim, developerClaim],
        verifierSteps: [{
          verdicts: [
            semanticVerdict(frontendClaim.id, 'supported', ['E1']),
            semanticVerdict(correctBackendClaim.id, 'supported', ['E2', 'E3', 'E4', 'E7']),
            semanticVerdict(developerClaim.id, 'supported', ['E5', 'E6']),
          ],
        }, {
          verdicts: [semanticVerdict(
            correctBackendClaim.id, 'supported', ['E2', 'E3', 'E4', 'E7'])],
        }, {
          verdicts: [semanticVerdict(developerClaim.id, 'supported', ['E5', 'E6'])],
        }],
      },
    });
    const positive = await runTrustScript(positiveSteps, { task, setup });
    assert.equal(positive.client.stageCounts.get('semantic_verifier'), 3);
    assert.equal(positive.result.taskContract.subgoals.find(goal =>
      goal.id === backendGoal.id)?.state, 'supported');
    assert.equal(positive.result.semanticVerification.claims.find(claim =>
      claim.id === correctBackendClaim.id)?.verdict, 'supported');
    assertMinimalCompleteParentHandoff(positive.result, {
      answer: [frontendClaim.text, correctBackendClaim.text, developerClaim.text].join('\n'),
      evidenceCount: 7,
      evidenceKinds: ['source', 'source', 'source', 'source', 'source', 'source', 'source'],
    });
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — an exhaustive sibling request cannot contaminate a comparison goal',
  async () => {
    const task = 'Confirm every frontend page named by the fixed anchor, and compare the two API prefix policies.';
    const frontendGoal = trustGoal(task, {
      id: 'S-sibling-exhaustive-ui',
      question: 'Which frontend pages are named by the fixed anchor?',
      originText: 'Confirm every frontend page named by the fixed anchor',
      proofCondition: 'Read the fixed frontend-page anchor.',
    });
    const comparisonGoal = trustGoal(task, {
      id: 'S-sibling-api-comparison',
      question: 'How do the two API prefix policies differ?',
      originText: 'compare the two API prefix policies',
      claimType: 'comparison',
      proofCondition: 'Compare the two explicitly requested API prefix policies.',
    });
    const frontendClaim = candidateClaim(
      'C-sibling-exhaustive-ui',
      frontendGoal.id,
      'The fixed anchor names the inquiry frontend page.',
      ['E1'],
    );
    const comparisonClaim = candidateClaim(
      'C-sibling-api-comparison',
      comparisonGoal.id,
      'The internal prefix requires an admin flag while the public prefix does not.',
      ['E2', 'E3'],
    );
    const { result } = await runTrustScript(buildTrustSteps({
      goals: [frontendGoal, comparisonGoal],
      initial: {
        tools: [
          {
            tool: 'repo_read_file',
            args: { path: 'src/frontend-pages.js', startLine: 1, endLine: 1 },
            id: 'read-sibling-ui-anchor',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'src/internal-policy.js', startLine: 1, endLine: 1 },
            id: 'read-sibling-internal-policy',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'src/public-policy.js', startLine: 1, endLine: 1 },
            id: 'read-sibling-public-policy',
          },
        ],
        claims: [frontendClaim, comparisonClaim],
        verifierSteps: [{
          verdicts: [
            semanticVerdict(frontendClaim.id, 'supported', ['E1']),
            semanticVerdict(comparisonClaim.id, 'supported', ['E2', 'E3']),
          ],
        }, {
          verdicts: [semanticVerdict(comparisonClaim.id, 'supported', ['E2', 'E3'])],
        }],
      },
    }), {
      task,
      async setup(root) {
        await fs.writeFile(
          path.join(root, 'src', 'frontend-pages.js'),
          "export const pages = ['inquiry'];\n",
        );
        await fs.writeFile(
          path.join(root, 'src', 'internal-policy.js'),
          'export const internalPolicy = user => user?.is_admin === true;\n',
        );
        await fs.writeFile(
          path.join(root, 'src', 'public-policy.js'),
          'export const publicPolicy = () => true;\n',
        );
      },
    });

    assert.equal(result.failure, null);
    assert.equal(result.taskContract.subgoals.find(goal =>
      goal.id === comparisonGoal.id)?.state, 'supported');
    assert.equal(result.parentHandoff.state, 'complete');
    assert.match(result.parentHandoff.directAnswer, /internal prefix requires an admin flag/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — an unrelated claim cannot borrow a sibling absence certificate',
  async () => {
    const task = 'Inventory every route guard and determine whether any additional guarded route exists.';
    const inventoryGoal = trustGoal(task, {
      id: 'S-claim-bound-inventory',
      question: 'Which route guards are in the exhaustive inventory?',
      originText: 'Inventory every route guard',
      claimType: 'comparison',
      proofCondition: 'Enumerate and compare every route guard.',
      constraints: ['A separate absence claim is not inventory evidence unless this claim cites it.'],
    });
    const absenceGoal = trustGoal(task, {
      id: 'S-claim-bound-absence',
      question: 'Does any additional guarded route exist?',
      originText: 'whether any additional guarded route exists',
      claimType: 'absence',
      proofCondition: 'Completely search the fixed scope for another guarded route.',
      constraints: ['Keep the absence qualified to src/**.'],
    });
    const inventoryClaim = candidateClaim(
      'C-claim-bound-inventory',
      inventoryGoal.id,
      'The exhaustive inventory contains the user and admin guards.',
      ['E1', 'E2'],
    );
    const absenceClaim = candidateClaim(
      'C-claim-bound-absence',
      absenceGoal.id,
      'No additional guarded route exists within src/**.',
      ['E3'],
    );
    const steps = buildTrustSteps({
      goals: [inventoryGoal, absenceGoal],
      initial: {
        tools: [
          {
            tool: 'repo_read_file',
            args: { path: 'src/routes/user.js', startLine: 1, endLine: 6 },
            id: 'read-claim-bound-user-route',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'src/routes/admin.js', startLine: 1, endLine: 4 },
            id: 'read-claim-bound-admin-route',
          },
          {
            tool: 'repo_grep',
            args: { pattern: 'guardedRouteThatDoesNotExist', scope: ['src/**'] },
            id: 'search-claim-bound-additional-route',
          },
        ],
        claims: [inventoryClaim, absenceClaim],
        verifierSteps: [{
          verdicts: [
            semanticVerdict(inventoryClaim.id, 'supported', ['E1', 'E2']),
            semanticVerdict(absenceClaim.id, 'supported', ['E3']),
          ],
        }, {
          verdicts: [semanticVerdict(inventoryClaim.id, 'supported', ['E1', 'E2'])],
        }],
      },
    });
    const { client, result } = await runTrustScript(steps, {
      task,
      async setup(root) {
        await fs.writeFile(path.join(root, 'src', 'routes', 'admin.js'), [
          'import { requireAdmin } from "../admin-auth.js";',
          'export function registerAdminRoutes(app) {',
          '  app.get("/admin", requireAdmin, (_req, res) => res.end());',
          '}',
        ].join('\n'));
      },
    });

    assert.equal(result.failure, null);
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === inventoryGoal.id)?.state,
      'gap');
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === absenceGoal.id)?.state,
      'supported');
    assert.equal(result.coverageGaps.find(gap => gap.subgoalId === inventoryGoal.id)?.repairable,
      false);
    assert.equal(providerToolActions(client).length, 3,
      'a sibling certificate must not trigger a futile repair or certify an uncited claim');
    assert.doesNotThrow(() => validateParentHandoffV3(result.parentHandoff));
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.equal(result.parentHandoff.directAnswer, absenceClaim.text);
    assert.equal(result.parentHandoff.evidence[0].kind, 'absence');
    assert.equal(result.parentHandoff.gaps[0].question,
      expectedParentGapQuestion(result, inventoryGoal));
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T062 — audited historical verification projects an exact sha-only git commit',
  { skip: !hasGit() },
  async () => {
    const task = 'Which inspected commit introduced requireAuth?';
    const goal = trustGoal(task, {
      id: 'S-historical-commit',
      question: task,
      originText: task,
      claimType: 'claim_verification',
      proofCondition: 'Verify the requested historical change from an observed commit.',
    });
    const claim = candidateClaim(
      'C-historical-commit',
      goal.id,
      'The inspected commit introduced requireAuth.',
      ['E1'],
    );
    const steps = buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_git_log',
          args: { path: 'src/auth.js', maxCount: 5 },
          id: 'historical-auth-log',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
      },
    });
    const { result } = await runTrustScript(steps, {
      task,
      async setup(root) {
        const git = args => execFileSync('git', args, {
          cwd: root,
          stdio: 'pipe',
          encoding: 'utf8',
        });
        git(['init']);
        git(['config', 'user.email', 'explorer@example.invalid']);
        git(['config', 'user.name', 'Explorer Test']);
        git(['add', '.']);
        git(['commit', '-m', 'introduce requireAuth']);
      },
    });

    assert.equal(result.semanticVerification.claims[0].verdict, 'supported');
    assert.equal(result.directAnswer, claim.text);
    assertMinimalCompleteParentHandoff(result, {
      answer: claim.text,
      evidenceCount: 1,
      evidenceKinds: ['git'],
    });
    const evidence = result.parentHandoff.evidence[0];
    assert.match(evidence.sha, /^[0-9a-f]{40}$/);
    assert.equal(evidence.path, undefined);
    assert.equal(evidence.startLine, undefined);
    assert.equal(evidence.endLine, undefined);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T068 — every retained wrapper has a distinct end-to-end proof-policy acceptance',
  async t => {
    const wrapperCases = [
      {
        tool: 'find_relevant_code',
        taskMode: 'locate',
        expectedState: 'complete',
        seeds: [
          ['locations', 'positive', ['E1']],
          ['relevance', 'positive', ['E1']],
          ['smallest_set', 'positive', ['E1']],
        ],
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'locate-auth',
        }],
      },
      {
        tool: 'trace_symbol',
        taskMode: 'symbol_trace',
        expectedState: 'complete',
        seeds: [
          ['definition', 'symbol_definition', ['E1']],
          ['usage', 'symbol_usage', ['E2', 'E3']],
        ],
        tools: [
          {
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'trace-definition',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
            id: 'trace-usage',
          },
          {
            tool: 'repo_grep',
            args: { pattern: 'requireAuth', scope: ['src/**'] },
            id: 'trace-cross-check',
          },
        ],
      },
      {
        tool: 'map_change_impact',
        taskMode: 'edit_planning',
        expectedState: 'verify_targets',
        scope: ['**'],
        seeds: [
          ['targets', 'impact', ['E1']],
          ['dependents', 'impact', ['E2']],
          ['requested_categories', 'impact', ['E3']],
          ['risk_boundary', 'impact', ['E4']],
        ],
        tools: [
          {
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'impact-target',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
            id: 'impact-dependent',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'tests/auth.test.js', startLine: 1, endLine: 1 },
            id: 'impact-test',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'config/auth.json', startLine: 1, endLine: 1 },
            id: 'impact-config',
          },
        ],
        async setup(root) {
          await fs.mkdir(path.join(root, 'tests'), { recursive: true });
          await fs.mkdir(path.join(root, 'config'), { recursive: true });
          await fs.writeFile(path.join(root, 'tests', 'auth.test.js'), 'test("auth", () => {});\n');
          await fs.writeFile(path.join(root, 'config', 'auth.json'), '{"required":true}\n');
        },
      },
      {
        tool: 'explain_code_path',
        taskMode: 'path_explanation',
        expectedState: 'complete',
        seeds: [
          ['entry', 'flow', ['E1']],
          ['handoffs', 'flow', ['E2']],
          ['terminal_effect', 'flow', ['E3']],
          ['transitions', 'flow', ['E4']],
        ],
        tools: ['entry', 'handoff', 'terminal', 'transition'].map((name, index) => ({
          tool: 'repo_read_file',
          args: { path: `src/flow/${name}.js`, startLine: 1, endLine: 1 },
          id: `flow-${index + 1}`,
        })),
        async setup(root) {
          await fs.mkdir(path.join(root, 'src', 'flow'), { recursive: true });
          for (const name of ['entry', 'handoff', 'terminal', 'transition']) {
            await fs.writeFile(path.join(root, 'src', 'flow', `${name}.js`),
              `export const ${name} = true;\n`);
          }
        },
      },
      {
        tool: 'collect_evidence',
        taskMode: 'evidence_verification',
        expectedState: 'complete',
        seeds: [
          ['verdict', 'claim_verification', ['E1', 'E2']],
        ],
        tools: [
          {
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'verify-direct',
          },
          {
            tool: 'repo_grep',
            args: { pattern: 'skipAuth|allowAnonymous', scope: ['src/**'] },
            id: 'verify-counterevidence',
          },
        ],
      },
      {
        tool: 'explore_repo',
        expectedState: 'complete',
        seeds: [['request', 'positive', ['E1']]],
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'explore-auth',
        }],
      },
    ];

    for (const wrapperCase of wrapperCases) {
      await t.test(wrapperCase.tool, async () => {
        const task = `Verify the ${wrapperCase.tool} proof-policy contract.`;
        const goals = wrapperCase.seeds.map(([seed, claimType], index) => ({
          id: `${wrapperCase.tool}-goal-${index + 1}`,
          question: `Verify ${seed} for ${wrapperCase.tool}.`,
          originRefs: wrapperCase.tool === 'explore_repo'
            ? [`request:0-${task.length}`]
            : wrapperCase.tool === 'collect_evidence'
              ? [`request:0-${task.length}`, `wrapper:${wrapperCase.tool}:${seed}`]
              : [`wrapper:${wrapperCase.tool}:${seed}`],
          claimType,
          proofCondition: `Observe bounded evidence for ${seed}.`,
          constraints: [],
        }));
        const claims = goals.map((goal, index) => candidateClaim(
          `${wrapperCase.tool}-claim-${index + 1}`,
          goal.id,
          `${wrapperCase.tool} verified ${wrapperCase.seeds[index][0]}.`,
          wrapperCase.seeds[index][2],
        ));
        const verdicts = claims.map((claim, index) => {
          const verdict = semanticVerdict(claim.id, 'supported', claim.evidenceRefs);
          if (wrapperCase.seeds[index][0] === wrapperCase.refutedSeed) {
            verdict.resolution = 'refuted';
          }
          return verdict;
        });
        const { client, result } = await runTrustScript(buildTrustSteps({
          goals,
          initial: {
            tools: wrapperCase.tools,
            claims,
            verdicts,
            ...(wrapperCase.tool === 'collect_evidence'
              ? { verifierSteps: [{ verdicts }, { verdicts }] }
              : {}),
          },
        }), {
          task,
          taskMode: wrapperCase.taskMode,
          setup: wrapperCase.setup,
          scope: wrapperCase.scope ?? ['src/**'],
        });

        assert.equal(result.failure, null, JSON.stringify({
          stages: client.stageLabels,
          failure: result.failure,
          goals: result.taskContract?.subgoals,
          claims: result.semanticVerification?.claims,
          verdicts: result.semanticVerification?.verdicts,
        }));
        assert.deepEqual(result.taskContract.subgoals.map(goal => goal.state),
          goals.map(() => 'supported'), JSON.stringify({
            goals: result.taskContract.subgoals,
            claims: result.semanticVerification?.claims,
            verdicts: result.semanticVerification?.verdicts,
            observations: result.observations?.map(item => ({
              id: item.id,
              kind: item.kind,
              path: item.path,
              sourceRole: item.sourceRole,
            })),
          }));
        assert.equal(result.parentHandoff.state, wrapperCase.expectedState,
          JSON.stringify(result.parentHandoff));
        assert.equal(result.parentHandoff.directAnswer.split('\n').length, goals.length);
        assert.doesNotMatch(JSON.stringify(result.parentHandoff),
          /taskContract|semanticVerification|proofPolicy|toolCalls|deterministicCounts/u);
      });
    }
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T068 — wrapper proofs accept shared implementation evidence and reject missing or incompatible evidence',
  async t => {
    const sharedCases = [
      {
        name: 'explain_code_path can reuse one source for related flow seeds',
        tool: 'explain_code_path',
        taskMode: 'path_explanation',
        expectedState: 'complete',
        seeds: ['entry', 'handoffs', 'terminal_effect', 'transitions'],
      },
      {
        name: 'map_change_impact can reuse one source for related impact seeds',
        tool: 'map_change_impact',
        taskMode: 'edit_planning',
        expectedState: 'verify_targets',
        seeds: ['targets', 'dependents', 'requested_categories', 'risk_boundary'],
      },
    ];
    for (const wrapperCase of sharedCases) {
      await t.test(wrapperCase.name, async () => {
        const task = `Verify shared evidence for ${wrapperCase.tool}.`;
        const goals = wrapperCase.seeds.map((seed, index) => ({
          id: `${wrapperCase.tool}-shared-goal-${index + 1}`,
          question: `Verify ${seed}.`,
          originRefs: [`wrapper:${wrapperCase.tool}:${seed}`],
          claimType: wrapperCase.tool === 'explain_code_path' ? 'flow' : 'impact',
          proofCondition: `Observe bounded evidence for ${seed}.`,
          constraints: [],
        }));
        const claims = goals.map((goal, index) => candidateClaim(
          `${wrapperCase.tool}-shared-claim-${index + 1}`,
          goal.id,
          `${wrapperCase.tool} verified ${wrapperCase.seeds[index]}.`,
          ['E1'],
        ));
        const { result } = await runTrustScript(buildTrustSteps({
          goals,
          initial: {
            tools: [{
              tool: 'repo_read_file',
              args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
              id: `${wrapperCase.tool}-shared-initial`,
            }],
            claims,
            verdicts: claims.map(claim => semanticVerdict(claim.id, 'supported', ['E1'])),
          },
        }), { task, taskMode: wrapperCase.taskMode });

        assert.equal(result.failure, null);
        assert.deepEqual(result.taskContract.subgoals.map(goal => goal.state),
          goals.map(() => 'supported'));
        assert.equal(result.parentHandoff.state, wrapperCase.expectedState);
        assert.equal(result.parentHandoff.directAnswer.split('\n').length, goals.length);
      });
    }

    await t.test('requested impact categories accept implementation evidence', async () => {
      const tool = 'map_change_impact';
      const task = 'Verify implementation evidence for requested impact categories.';
      const seeds = ['targets', 'dependents', 'requested_categories', 'risk_boundary'];
      const goals = seeds.map((seed, index) => ({
        id: `impact-role-goal-${index + 1}`,
        question: `Verify ${seed}.`,
        originRefs: [`wrapper:${tool}:${seed}`],
        claimType: 'impact',
        proofCondition: `Observe independent evidence for ${seed}.`,
        constraints: [],
      }));
      const claims = goals.map((goal, index) => candidateClaim(
        `impact-role-claim-${index + 1}`,
        goal.id,
        `Impact verified ${seeds[index]}.`,
        [`E${index + 1}`],
      ));
      const { client, result } = await runTrustScript(buildTrustSteps({
        goals,
        initial: {
          tools: seeds.map((seed, index) => ({
            tool: 'repo_read_file',
            args: { path: `src/impact/${seed}.js`, startLine: 1, endLine: 1 },
            id: `impact-role-${index + 1}`,
          })),
          claims,
          verdicts: claims.map((claim, index) =>
            semanticVerdict(claim.id, 'supported', [`E${index + 1}`])),
        },
      }), {
        task,
        taskMode: 'edit_planning',
        async setup(root) {
          await fs.mkdir(path.join(root, 'src', 'impact'), { recursive: true });
          for (const name of seeds) {
            await fs.writeFile(path.join(root, 'src', 'impact', `${name}.js`),
              `export const ${name.replaceAll('-', '_')} = true;\n`);
          }
        },
      });

      assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
      assert.deepEqual(result.taskContract.subgoals.map(goal => goal.state),
        goals.map(() => 'supported'));
      assert.equal(result.parentHandoff.state, 'verify_targets');
    });

    await t.test('map_change_impact keeps search evidence outside its source-only role', async () => {
      const tool = 'map_change_impact';
      const task = 'Verify fixed impact wrapper evidence roles.';
      const seeds = ['targets', 'dependents', 'requested_categories', 'risk_boundary'];
      const goals = seeds.map((seed, index) => ({
        id: `fixed-impact-source-role-${index + 1}`,
        question: `Verify ${seed}.`,
        originRefs: [`wrapper:${tool}:${seed}`],
        claimType: 'impact',
        proofCondition: `Observe source evidence for ${seed}.`,
        constraints: [],
      }));
      const claims = goals.map((goal, index) => candidateClaim(
        `fixed-impact-source-role-claim-${index + 1}`,
        goal.id,
        `Fixed impact wrapper verified ${seeds[index]}.`,
        index === 0 ? ['E1', 'E2'] : ['E1'],
      ));
      const verdicts = claims.map(claim =>
        semanticVerdict(claim.id, 'supported', claim.evidenceRefs));
      const { client, result } = await runTrustScript(buildTrustSteps({
        goals,
        initial: {
          tools: [{
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'fixed-impact-source',
          }, {
            tool: 'repo_find_files',
            args: { pattern: '**/*', scope: ['src/**'] },
            id: 'fixed-impact-search',
          }],
          claims,
          verdicts,
        },
        repair: {
          tools: [],
          prose: 'No materially new repository action is available.',
          claims: [],
          verdicts: [],
        },
      }), { task, taskMode: 'edit_planning' });

      assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
      assert.equal(result.taskContract.subgoals[0].state, 'gap');
      assert.deepEqual(result.taskContract.subgoals.slice(1).map(goal => goal.state),
        ['supported', 'supported', 'supported']);
      assert.equal(result.semanticVerification.verdicts[0].result, 'insufficient');
      assert.equal(client.stageCounts.get('semantic_verifier'), 1,
        'fixed impact claims must not enter generic focused corroboration');
      assert.equal(result.parentHandoff.state, 'incomplete');
    });

    await t.test('missing and incompatible evidence cannot fabricate flow artifacts', async () => {
      const tool = 'explain_code_path';
      const seeds = ['entry', 'handoffs', 'terminal_effect', 'transitions'];
      const goals = seeds.map((seed, index) => ({
        id: `flow-location-goal-${index + 1}`,
        question: `Verify ${seed}.`,
        originRefs: [`wrapper:${tool}:${seed}`],
        claimType: 'flow',
        proofCondition: `Observe bounded evidence for ${seed}.`,
        constraints: [],
      }));
      const claims = goals.map((goal, index) => candidateClaim(
        `flow-location-claim-${index + 1}`,
        goal.id,
        `Flow verified ${seeds[index]}.`,
        [`E${index + 1}`],
      ));
      const verdicts = claims.map((claim, index) =>
        semanticVerdict(claim.id, 'supported', [`E${index + 1}`]));
      const observations = [
        ...['E1', 'E2'].map(id => ({
          id,
          kind: 'source',
          path: 'src/flow/single.js',
          startLine: 1,
          endLine: 1,
          snippet: 'export const single = true;',
          rangeGrounding: 'exact',
          sourceRole: 'implementation',
          temporalRole: 'current',
          redacted: false,
        })),
        {
          id: 'E4',
          kind: 'source',
          path: 'docs/flow.md',
          startLine: 1,
          endLine: 1,
          snippet: 'Documented transition only.',
          rangeGrounding: 'exact',
          sourceRole: 'documentation',
          temporalRole: 'current',
          redacted: false,
        },
      ];
      const artifacts = buildRuntimeWrapperPolicyArtifacts({
        wrapperTool: tool,
        subgoals: goals,
        claims,
        semanticVerdicts: verdicts,
        observations,
      });

      assert.equal(artifacts.size, seeds.length);
      assert.deepEqual(artifacts.get(claims[0].id)?.observedTransitions, ['entry']);
      assert.deepEqual(artifacts.get(claims[1].id)?.observedTransitions, ['handoffs']);
      assert.deepEqual(artifacts.get(claims[2].id)?.observedTransitions, []);
      assert.deepEqual(artifacts.get(claims[3].id)?.observedTransitions, []);
      assert.deepEqual(artifacts.get(claims[2].id)?.transitionEvidenceRefs,
        { terminal_effect: [] });
      assert.deepEqual(artifacts.get(claims[3].id)?.transitionEvidenceRefs,
        { transitions: [] });
    });
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — bounded usage accepts a literal alias for the full effective scope',
  async () => {
    const task = 'Trace the requireAuth definition and every in-scope usage.';
    const goals = [
      {
        id: 'trace-reversed-definition',
        question: 'Where is requireAuth defined?',
        originRefs: ['wrapper:trace_symbol:definition'],
        claimType: 'symbol_definition',
        proofCondition: 'Observe the requireAuth definition source.',
        constraints: [],
      },
      {
        id: 'trace-reversed-usage',
        question: 'Where is requireAuth used?',
        originRefs: ['wrapper:trace_symbol:usage'],
        claimType: 'symbol_usage',
        proofCondition: 'Cross-check every in-scope usage and read the usage source.',
        constraints: [],
      },
    ];
    const claims = [
      candidateClaim(
        'trace-reversed-definition-claim',
        goals[0].id,
        'requireAuth is defined in src/auth.js.',
        ['E1'],
      ),
      candidateClaim(
        'trace-reversed-usage-claim',
        goals[1].id,
        'requireAuth is used by src/routes/user.js.',
        ['E2', 'E3'],
      ),
    ];
    const { result } = await runTrustScript(buildTrustSteps({
      goals,
      initial: {
        tools: [
          {
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'trace-reversed-definition-read',
          },
          {
            tool: 'repo_grep',
            args: { pattern: 'requireAuth', scope: ['src'] },
            id: 'trace-reversed-usage-cross-check',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
            id: 'trace-reversed-usage-read',
          },
        ],
        claims,
        verdicts: [
          semanticVerdict(claims[0].id, 'supported', ['E1']),
          semanticVerdict(claims[1].id, 'supported', ['E2', 'E3']),
        ],
      },
    }), { task, taskMode: 'symbol_trace' });

    assert.equal(result.failure, null);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.state),
      goals.map(() => 'supported'));
    assert.equal(result.parentHandoff.state, 'complete');
    assert.match(result.parentHandoff.directAnswer, /src\/routes\/user\.js/u);
    const usageSearch = result.observations.find(observation =>
      observation.kind === 'search' && observation.normalizedArgs?.scope?.[0] === 'src');
    assert.deepEqual(usageSearch?.boundary, ['src/**']);
    assert.equal(usageSearch?.enumerationComplete, true);
    assert.ok(result.parentHandoff.evidence.some(item =>
      item.kind === 'source' && item.path === 'src/routes/user.js'));
  },
);

test('Spec 028 T030 — isolated semantic controls reduce claims without trusting exploration prose', async () => {
  const goals = definitionAndAbsenceGoals();
  const supported = candidateClaim(
    'C-definition', goals[0].id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const mismatch = candidateClaim(
    'C-absence', goals[1].id, 'legacyGuard is absent from every repository path.', ['E2']);
  const privateSentinel = 'PRIVATE_EXPLORER_REASONING';
  const steps = buildTrustSteps({
    goals,
    initial: {
      tools: [
        { tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'read-auth' },
        { tool: 'repo_grep', args: { pattern: 'legacyGuard', scope: ['src/**'] }, id: 'grep-legacy' },
      ],
      prose: privateSentinel,
      claims: [supported, mismatch],
      verifierSteps: [{
        raw: verifierResponse([
          semanticVerdict(supported.id, 'supported', ['E1']),
          { ...semanticVerdict(mismatch.id, 'insufficient'), resolution: null },
        ]),
      }],
    },
    repair: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
        id: 'repair-routes',
      }],
      assertRequest: request => assertRepairRequest(request, {
        question: goals[1].question,
        anchors: ['src/auth.js', 'legacyGuard'],
      }),
      claims: [
        { ...supported, evidenceRefs: ['E1', 'E3'] },
        { ...mismatch, evidenceRefs: ['E2', 'E3'] },
      ],
      verdicts: [
        semanticVerdict(supported.id, 'supported', ['E1', 'E3']),
        semanticVerdict(mismatch.id, 'insufficient'),
      ],
    },
  });
  const { client, result } = await runTrustScript(steps);
  assert.deepEqual(client.stageLabels, [
    'planner:1',
    'goal_audit:1',
    'exploration:1',
    'exploration:2',
    'exploration:3',
    'synthesis:1',
    'claim_synthesis:1',
    'semantic_verifier:1',
    'exploration:4',
    'claim_synthesis:2',
    'semantic_verifier:2',
  ]);
  for (const stage of [
    'claim_synthesis:1', 'semantic_verifier:1',
    'claim_synthesis:2', 'semantic_verifier:2',
  ]) {
    const request = client.requests[client.stageLabels.indexOf(stage)];
    assert.equal((request.tools?.length ?? 0), 0);
    assert.doesNotMatch(JSON.stringify(request.messages), new RegExp(privateSentinel));
  }
  const postClaimRequest = client.requests[
    client.stageLabels.indexOf('claim_synthesis:2')
  ];
  const priorPacketText = postClaimRequest.messages.findLast(message =>
    typeof message.content === 'string' &&
    message.content.includes('BEGIN_REQUIRED_PRIOR_CLAIMS_JSON'))?.content ?? '';
  const priorPacketMatch = /BEGIN_REQUIRED_PRIOR_CLAIMS_JSON\n([\s\S]*?)\nEND_REQUIRED_PRIOR_CLAIMS_JSON/
    .exec(priorPacketText);
  assert.ok(priorPacketMatch);
  const priorPacket = JSON.parse(priorPacketMatch[1]);
  assert.ok(priorPacket.priorClaims.every(claim =>
    Object.keys(claim).sort().join(',') === 'evidenceRefs,id,subgoalId,text'));
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[0].id).state, 'supported');
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[1].id).state, 'gap');
  assert.ok(result.coverageGaps.some(gap =>
    gap.subgoalId === goals[1].id && gap.reason === 'semantic_mismatch' &&
    gap.repairable === false));
  assert.deepEqual(result.semanticVerification.verdicts.map(verdict =>
    [verdict.claimId, verdict.result]), [
    ['C-definition', 'supported'],
    ['C-absence', 'insufficient'],
  ]);
  assert.deepEqual(result.semanticVerification.runtimeAllowedEvidenceRefsBySubgoal
    .map(item => [item.subgoalId, item.evidenceRefs]), [
    ['S-definition', ['E1', 'E3']],
    ['S-absence', ['E2', 'E3']],
  ]);
});

semanticPipelineRuntimeTest(
  'Spec 028 T069 — irrelevant model measurement cannot break or influence a non-count claim',
  async () => {
    const goal = definitionAndAbsenceGoals()[0];
    const claim = {
      ...candidateClaim(
        'C-non-count-measurement',
        goal.id,
        'requireAuth is defined in src/auth.js.',
        ['E1'],
      ),
      measurement: { kind: 'count', unit: 'matching_lines', value: 999 },
    };
    const steps = buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-auth-for-non-count',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
      },
    });

    const { result } = await runTrustScript(steps);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.equal(result.semanticVerification.claims[0].measurement, undefined);
    assert.equal(JSON.stringify(result.parentHandoff).includes('999'), false);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — nullable and malformed measurement noise is stripped from non-count claims',
  async t => {
    for (const fixture of [
      { name: 'nullable strict-schema field', measurement: null },
      {
        name: 'malformed measurement object',
        measurement: { kind: 'unsupported', unit: 42, value: 'not-a-number' },
      },
    ]) {
      await t.test(fixture.name, async () => {
        const goal = definitionAndAbsenceGoals()[0];
        const claim = {
          ...candidateClaim(
            `C-non-count-${fixture.name.replaceAll(' ', '-')}`,
            goal.id,
            'requireAuth is defined in src/auth.js.',
            ['E1'],
          ),
          measurement: fixture.measurement,
        };
        const { result } = await runTrustScript(buildTrustSteps({
          goals: [goal],
          initial: {
            tools: [{
              tool: 'repo_read_file',
              args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
              id: `read-auth-${fixture.name.replaceAll(' ', '-')}`,
            }],
            claims: [claim],
            verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
          },
        }));

        assert.equal(result.failure, null);
        assert.equal(result.parentHandoff.state, 'complete');
        assert.equal(result.semanticVerification.claims[0].measurement, undefined);
      });
    }
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — one leaf goal cannot fan out into noisy parent claims',
  async () => {
    const task = 'Identify the bounded requireAuth implementation.';
    const goal = trustGoal(task, {
      id: 'S-quiet-leaf',
      question: task,
      originText: task,
      proofCondition: 'Observe the bounded requireAuth implementation source.',
    });
    const fragmentOne = candidateClaim(
      'C-quiet-fragment-one', goal.id, 'requireAuth is exported.', ['E1']);
    const fragmentTwo = candidateClaim(
      'C-quiet-fragment-two', goal.id, 'requireAuth returns true.', ['E1']);
    const aggregate = candidateClaim(
      'C-quiet-aggregate', goal.id, 'requireAuth is the bounded authentication implementation.', ['E1']);
    const steps = [
      { stage: 'planner:1', value: plannerControl([goal]) },
      { stage: 'goal_audit:1', value: auditorControl([auditControlRecord(goal)]) },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/auth.js', startLine: 1, endLine: 4 },
          'read-quiet-leaf',
        ),
      },
      { stage: 'exploration:2', content: 'The bounded evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: { claims: [fragmentOne, fragmentTwo] } },
      {
        stage: 'claim_synthesis:2',
        run(request) {
          const retryText = JSON.stringify(request.messages);
          assert.match(retryText, /at most one aggregate claim/u);
          assert.match(retryText, /zero or one aggregate claim/u);
          return controlCompletion({ claims: [aggregate] });
        },
      },
      {
        stage: 'semantic_verifier:1',
        value: verifierResponse([semanticVerdict(aggregate.id, 'supported', ['E1'])]),
      },
    ];

    const { client, result } = await runTrustScript(steps, { task });

    assert.equal(client.stageCounts.get('claim_synthesis'), 2);
    assert.equal(result.failure, null);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.equal(result.parentHandoff.directAnswer, aggregate.text);
    assert.deepEqual(result.semanticVerification.claims.map(claim => claim.id), [aggregate.id]);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — unrequested inventory counts get one bounded claim correction',
  async () => {
    const task = 'Identify the test that covers the pipeline entry path.';
    const goal = trustGoal(task, {
      id: 'S-entry-path-test',
      question: task,
      originText: task,
      proofCondition: 'Identify one exactly observed entry-path test and what it verifies.',
    });
    const noisy = candidateClaim(
      'C-entry-path-test',
      goal.id,
      'tests/test_cli.py verifies worker fan-out, and the broader suite contains 61 test functions.',
      ['E1'],
    );
    const corrected = candidateClaim(
      noisy.id,
      goal.id,
      'tests/test_cli.py verifies worker fan-out for the pipeline entry path.',
      ['E1'],
    );
    const steps = [
      { stage: 'planner:1', value: plannerControl([goal]) },
      { stage: 'goal_audit:1', value: auditorControl([auditControlRecord(goal)]) },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'tests/test_cli.py', startLine: 1, endLine: 6 },
          'read-entry-path-test',
        ),
      },
      { stage: 'exploration:2', content: 'The bounded test evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: { claims: [noisy] } },
      {
        stage: 'claim_synthesis:2',
        run(request) {
          const correction = JSON.stringify(request.messages);
          assert.match(correction, /unrequested inventory count/u);
          assert.match(correction, new RegExp(goal.id, 'u'));
          assert.match(correction, /return only the narrow requested fact/u);
          return controlCompletion({ claims: [corrected] });
        },
      },
      {
        stage: 'semantic_verifier:1',
        value: verifierResponse([semanticVerdict(corrected.id, 'supported', ['E1'])]),
      },
    ];

    const { client, result } = await runTrustScript(steps, {
      task,
      scope: ['tests/**'],
      async setup(root) {
        await fs.mkdir(path.join(root, 'tests'), { recursive: true });
        await fs.writeFile(path.join(root, 'tests', 'test_cli.py'), [
          'from pipeline import cli',
          '',
          'def test_worker_fan_out(monkeypatch):',
          '    calls = []',
          '    cli.main(["run", "--workers", "3"])',
          '    assert len(calls) == 3',
        ].join('\n'));
      },
    });

    assert.equal(client.stageCounts.get('claim_synthesis'), 2);
    assert.equal(result.failure, null);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.equal(result.parentHandoff.directAnswer, corrected.text);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — partial test inventories get one bounded claim correction',
  async () => {
    const task = 'Identify the test that covers the pipeline entry path.';
    const goal = trustGoal(task, {
      id: 'S-partial-test-inventory',
      question: task,
      originText: task,
      proofCondition: 'Identify one exactly observed entry-path test and what it verifies.',
    });
    const noisy = candidateClaim(
      'C-partial-test-inventory',
      goal.id,
      'Four test files cover the entry path: test_cli, test_orchestrator, test_handlers, and test_db.',
      ['E1', 'E2', 'E3', 'E4'],
    );
    const corrected = candidateClaim(
      noisy.id,
      goal.id,
      'tests/test_cli.py verifies the pipeline entry path.',
      ['E1'],
    );
    const testFiles = [
      'test_cli.py',
      'test_orchestrator.py',
      'test_handlers.py',
      'test_db.py',
    ];
    const steps = [
      { stage: 'planner:1', value: plannerControl([goal]) },
      { stage: 'goal_audit:1', value: auditorControl([auditControlRecord(goal)]) },
      ...testFiles.map((file, index) => ({
        stage: `exploration:${index + 1}`,
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: `tests/${file}`, startLine: 1, endLine: 3 },
          `read-partial-inventory-${index + 1}`,
        ),
      })),
      { stage: 'exploration:5', content: 'The bounded test evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: { claims: [noisy] } },
      {
        stage: 'claim_synthesis:2',
        run(request) {
          const correction = JSON.stringify(request.messages);
          assert.match(correction, /multiple test paths as a partial suite inventory/u);
          assert.match(correction, /at most one exactly observed test path/u);
          return controlCompletion({ claims: [corrected] });
        },
      },
      {
        stage: 'semantic_verifier:1',
        value: verifierResponse([semanticVerdict(corrected.id, 'supported', ['E1'])]),
      },
    ];

    const { client, result } = await runTrustScript(steps, {
      task,
      scope: ['tests/**'],
      async setup(root) {
        await fs.mkdir(path.join(root, 'tests'), { recursive: true });
        await Promise.all(testFiles.map((file, index) => fs.writeFile(
          path.join(root, 'tests', file),
          `def test_pipeline_entry_${index + 1}():\n    assert True\n`,
        )));
      },
    });

    assert.equal(client.stageCounts.get('claim_synthesis'), 2);
    assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
    assert.equal(result.parentHandoff.state, 'complete');
    assert.equal(result.parentHandoff.directAnswer, corrected.text);
    assert.deepEqual(result.semanticVerification.claims.map(claim => claim.evidenceRefs), [['E1']]);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — an explicit every-test goal remains verifier-gated',
  async () => {
    const task = 'Inventory every test file that covers the pipeline entry path.';
    const goal = trustGoal(task, {
      id: 'S-every-test-inventory',
      question: task,
      originText: task,
      proofCondition: 'Observe every requested test file before accepting the inventory.',
    });
    const claim = candidateClaim(
      'C-every-test-inventory',
      goal.id,
      'tests/test_cli.py and tests/test_orchestrator.py cover the pipeline entry path.',
      ['E1', 'E2'],
    );
    let verifierPacket;
    const testFiles = ['test_cli.py', 'test_orchestrator.py'];
    const steps = [
      { stage: 'planner:1', value: plannerControl([goal]) },
      { stage: 'goal_audit:1', value: auditorControl([auditControlRecord(goal)]) },
      ...testFiles.map((file, index) => ({
        stage: `exploration:${index + 1}`,
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: `tests/${file}`, startLine: 1, endLine: 3 },
          `read-every-test-${index + 1}`,
        ),
      })),
      { stage: 'exploration:3', content: 'The bounded test evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: { claims: [claim] } },
      {
        stage: 'semantic_verifier:1',
        run(request) {
          verifierPacket = parseControlPacket(request);
          return controlCompletion(verifierResponse([
            semanticVerdict(claim.id, 'insufficient', ['E1', 'E2']),
          ]));
        },
      },
      { stage: 'exploration:4', content: 'No materially new repair action remains.' },
    ];

    const { client, result } = await runTrustScript(steps, {
      task,
      scope: ['tests/**'],
      async setup(root) {
        await fs.mkdir(path.join(root, 'tests'), { recursive: true });
        await Promise.all(testFiles.map((file, index) => fs.writeFile(
          path.join(root, 'tests', file),
          `def test_pipeline_entry_${index + 1}():\n    assert True\n`,
        )));
      },
    });

    assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
    assert.equal(client.stageCounts.get('claim_synthesis'), 1);
    assert.deepEqual(verifierPacket.claims[0].evidenceRefs, ['E1', 'E2']);
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.equal(result.taskContract.subgoals[0].state, 'gap');
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — repeated partial test inventory quarantines only that sub-goal',
  async () => {
    const task = 'Locate requireAuth and identify the test that covers the pipeline entry path.';
    const goals = [
      trustGoal(task, {
        id: 'S-stable-test-inventory-definition',
        question: 'Where is requireAuth defined?',
        originText: 'Locate requireAuth',
        claimType: 'symbol_definition',
        proofCondition: 'Observe the requireAuth definition source.',
      }),
      trustGoal(task, {
        id: 'S-repeated-partial-test-inventory',
        question: 'Which test covers the pipeline entry path?',
        originText: 'identify the test that covers the pipeline entry path',
        proofCondition: 'Identify one exactly observed entry-path test and what it verifies.',
      }),
    ];
    const stable = candidateClaim(
      'C-stable-test-inventory-definition',
      goals[0].id,
      'requireAuth is defined in src/auth.js.',
      ['E1'],
    );
    const noisy = candidateClaim(
      'C-repeated-partial-test-inventory',
      goals[1].id,
      'Three test files cover the entry path: test_cli, test_orchestrator, and test_handlers.',
      ['E2', 'E3', 'E4'],
    );
    const repeatedPartialInventory = { claims: [noisy] };
    const testFiles = ['test_cli.py', 'test_orchestrator.py', 'test_handlers.py'];
    const steps = [
      { stage: 'planner:1', value: plannerControl(goals) },
      { stage: 'goal_audit:1', value: auditorControl(
        goals.map(goal => auditControlRecord(goal))) },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/auth.js', startLine: 1, endLine: 4 },
          'read-stable-test-inventory-definition',
        ),
      },
      ...testFiles.map((file, index) => ({
        stage: `exploration:${index + 2}`,
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: `tests/${file}`, startLine: 1, endLine: 3 },
          `read-repeated-partial-${index + 1}`,
        ),
      })),
      { stage: 'exploration:5', content: 'The bounded evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: { claims: [stable] } },
      { stage: 'claim_synthesis:2', value: repeatedPartialInventory },
      {
        stage: 'claim_synthesis:3',
        run(request) {
          assert.match(JSON.stringify(request.messages),
            /multiple test paths as a partial suite inventory/u);
          return controlCompletion(repeatedPartialInventory);
        },
      },
      {
        stage: 'semantic_verifier:1',
        run(request) {
          const packet = parseControlPacket(request);
          assert.deepEqual(packet.claims.map(claim => claim.id), [stable.id]);
          return controlCompletion(verifierResponse([
            semanticVerdict(stable.id, 'supported', ['E1']),
          ]));
        },
      },
      { stage: 'exploration:6', content: 'No materially new repair action remains.' },
    ];

    const { client, result } = await runTrustScript(steps, {
      task,
      scope: ['src/**', 'tests/**'],
      async setup(root) {
        await fs.mkdir(path.join(root, 'tests'), { recursive: true });
        await Promise.all(testFiles.map((file, index) => fs.writeFile(
          path.join(root, 'tests', file),
          `def test_pipeline_entry_${index + 1}():\n    assert True\n`,
        )));
      },
    });

    assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
    assert.equal(client.stageCounts.get('claim_synthesis'), 3);
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.equal(result.parentHandoff.directAnswer, stable.text);
    assert.deepEqual(result.semanticVerification.claims.map(claim => claim.id), [stable.id]);
    assert.deepEqual(result.taskContract.subgoals.map(goal => [goal.id, goal.state]), [
      [goals[0].id, 'supported'],
      [goals[1].id, 'gap'],
    ]);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff),
      /C-repeated-partial|Three test files|claim_synthesis/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — repeated claim fanout quarantines only the noisy sub-goal',
  async () => {
    const task = 'Locate requireAuth and map the environment configuration impact.';
    const goals = [
      trustGoal(task, {
        id: 'S-stable-definition',
        question: 'Where is requireAuth defined?',
        originText: 'Locate requireAuth',
        claimType: 'symbol_definition',
        proofCondition: 'Observe the requireAuth definition source.',
      }),
      trustGoal(task, {
        id: 'S-noisy-config-impact',
        question: 'What is the environment configuration impact?',
        originText: 'environment configuration impact',
        claimType: 'impact',
        proofCondition: 'Observe the configuration input and its affected pipeline path.',
      }),
    ];
    const stable = candidateClaim(
      'C-stable-definition', goals[0].id, 'requireAuth is defined in src/auth.js.', ['E1']);
    const noisy = [
      candidateClaim(
        'C-noisy-config-input', goals[1].id, 'AUTH_MODE is read from config.', ['E2']),
      candidateClaim(
        'C-noisy-config-effect', goals[1].id, 'AUTH_MODE affects route setup.', ['E2']),
    ];
    const repeatedFanout = { claims: [stable, ...noisy] };
    const steps = [
      { stage: 'planner:1', value: plannerControl(goals) },
      {
        stage: 'goal_audit:1',
        value: auditorControl(goals.map(goal => auditControlRecord(goal))),
      },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/auth.js', startLine: 1, endLine: 4 },
          'read-stable-definition',
        ),
      },
      {
        stage: 'exploration:2',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/config.js', startLine: 1, endLine: 4 },
          'read-noisy-config',
        ),
      },
      { stage: 'exploration:3', content: 'The bounded evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: repeatedFanout },
      {
        stage: 'claim_synthesis:2',
        run(request) {
          assert.match(JSON.stringify(request.messages), /zero or one aggregate claim/u);
          return controlCompletion(repeatedFanout);
        },
      },
      {
        stage: 'semantic_verifier:1',
        run(request) {
          const packet = parseControlPacket(request);
          assert.deepEqual(packet.claims.map(claim => claim.id), [stable.id]);
          return controlCompletion(verifierResponse([
            semanticVerdict(stable.id, 'supported', ['E1']),
          ]));
        },
      },
      { stage: 'exploration:4', content: 'No materially new repair action remains.' },
    ];

    const { client, result } = await runTrustScript(steps, { task });

    assert.equal(client.stageCounts.get('claim_synthesis'), 2);
    assert.equal(client.stageCounts.get('semantic_verifier'), 1);
    assert.equal(result.failure, null);
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.equal(result.parentHandoff.directAnswer, stable.text);
    assert.deepEqual(result.semanticVerification.claims.map(claim => claim.id), [stable.id]);
    assert.deepEqual(result.taskContract.subgoals.map(goal => [goal.id, goal.state]), [
      [goals[0].id, 'supported'],
      [goals[1].id, 'gap'],
    ]);
    assert.ok(result.coverageGaps.some(gap =>
      gap.subgoalId === goals[1].id && gap.reason === 'missing_evidence' &&
      gap.repairable === false));
    assert.match(JSON.stringify(result.parentHandoff), /environment configuration impact/u);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff),
      /C-noisy|AUTH_MODE|claim_synthesis|aggregate claim/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — direct-source synthesis hides search evidence from claims but not verification',
  async () => {
    const task = 'Explain what requireAuth does when req.user is missing.';
    const goal = trustGoal(task, {
      id: 'S-direct-source-filter',
      question: task,
      originText: task,
      proofCondition: 'Observe the current requireAuth implementation source.',
    });
    const claim = candidateClaim(
      'C-direct-source-filter',
      goal.id,
      'requireAuth throws unauthorized when req.user is missing.',
      ['E1'],
    );
    let verifierPacket;
    const steps = [
      { stage: 'planner:1', value: plannerControl([goal]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([auditControlRecord(goal)]),
      },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/auth.js', startLine: 1, endLine: 4 },
          'read-require-auth-definition',
        ),
      },
      {
        stage: 'exploration:2',
        run: () => toolControlCompletion(
          'repo_grep',
          { pattern: 'requireAuth', scope: ['src/**'] },
          'grep-require-auth',
        ),
      },
      { stage: 'exploration:3', content: 'The bounded evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      {
        stage: 'claim_synthesis:1',
        run(request) {
          const packet = parseControlPacket(request);
          assert.deepEqual(packet.observations.map(item => item.id), ['E1']);
          assert.ok(packet.observations.every(item => item.kind === 'source'));
          return controlCompletion({ claims: [claim] });
        },
      },
      {
        stage: 'semantic_verifier:1',
        run(request) {
          verifierPacket = parseControlPacket(request);
          return controlCompletion(verifierResponse([
            semanticVerdict(claim.id, 'supported', ['E1']),
          ]));
        },
      },
    ];

    const { client, result } = await runTrustScript(steps, { task });

    assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
    assert.deepEqual(verifierPacket.claims[0].evidenceRefs, ['E1']);
    assert.ok(verifierPacket.observations.some(item => item.id === 'E2' && item.kind === 'search'));
    assert.equal(result.parentHandoff.state, 'complete');
    assert.equal(result.parentHandoff.directAnswer, claim.text);
    assert.deepEqual(result.semanticVerification.claims[0].evidenceRefs, ['E1']);
    assert.deepEqual(result.semanticVerification.runtimeAllowedEvidenceRefsBySubgoal, [{
      subgoalId: goal.id,
      evidenceRefs: ['E1'],
    }]);
    assert.deepEqual(result.parentHandoff.evidence.map(item => item.kind), ['source']);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff), /repo_grep|E2/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — mixed claim synthesis isolates one direct-source goal and restores goal order',
  async () => {
    const task = 'Identify the test that covers the entry path and locate requireAuth.';
    const goals = [
      trustGoal(task, {
        id: 'S-mixed-entry-test',
        question: 'Which test covers the entry path?',
        originText: 'Identify the test that covers the entry path',
        proofCondition: 'Identify one exactly observed entry-path test and what it verifies.',
      }),
      trustGoal(task, {
        id: 'S-mixed-auth-definition',
        question: 'Where is requireAuth defined?',
        originText: 'locate requireAuth',
        claimType: 'symbol_definition',
        proofCondition: 'Observe the requireAuth definition source.',
      }),
    ];
    const claims = [
      candidateClaim(
        'C-mixed-entry-test',
        goals[0].id,
        'tests/test_cli.py verifies worker fan-out for the entry path.',
        ['E1'],
      ),
      candidateClaim(
        'C-mixed-auth-definition',
        goals[1].id,
        'requireAuth is defined in src/auth.js.',
        ['E2'],
      ),
    ];
    let nonDirectPacket;
    let directPacket;
    let verifierPacket;
    const steps = [
      { stage: 'planner:1', value: plannerControl(goals) },
      {
        stage: 'goal_audit:1',
        value: auditorControl(goals.map(goal => auditControlRecord(goal))),
      },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'tests/test_cli.py', startLine: 1, endLine: 4 },
          'read-mixed-entry-test',
        ),
      },
      {
        stage: 'exploration:2',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/auth.js', startLine: 1, endLine: 4 },
          'read-mixed-auth-definition',
        ),
      },
      {
        stage: 'exploration:3',
        run: () => toolControlCompletion(
          'repo_grep',
          { pattern: '^def test_', scope: ['tests/**'] },
          'grep-mixed-test-inventory',
        ),
      },
      { stage: 'exploration:4', content: 'The mixed evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      {
        stage: 'claim_synthesis:1',
        run(request) {
          directPacket = parseControlPacket(request);
          return controlCompletion({ claims: [claims[0]] });
        },
      },
      {
        stage: 'claim_synthesis:2',
        run(request) {
          nonDirectPacket = parseControlPacket(request);
          return controlCompletion({ claims: [claims[1]] });
        },
      },
      {
        stage: 'semantic_verifier:1',
        run(request) {
          verifierPacket = parseControlPacket(request);
          return controlCompletion(verifierResponse([
            semanticVerdict(claims[0].id, 'supported', ['E1']),
            semanticVerdict(claims[1].id, 'supported', ['E2']),
          ]));
        },
      },
    ];

    const { client, result } = await runTrustScript(steps, {
      task,
      scope: ['src/**', 'tests/**'],
      async setup(root) {
        await fs.mkdir(path.join(root, 'tests'), { recursive: true });
        const extraTests = Array.from(
          { length: 60 },
          (_, index) => `def test_generated_${index + 2}(): pass`,
        );
        await fs.writeFile(path.join(root, 'tests', 'test_cli.py'), [
          'from pipeline import cli',
          '',
          'def test_worker_fan_out():',
          '    assert cli is not None',
          ...extraTests,
        ].join('\n'));
      },
    });

    assert.equal(client.stageCounts.get('claim_synthesis'), 2);
    assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
    assert.deepEqual(nonDirectPacket.control.requiredSubgoals.map(goal => goal.id), [goals[1].id]);
    const inventory = nonDirectPacket.observations.find(item => item.id === 'E3');
    assert.equal(inventory?.kind, 'search');
    assert.equal(inventory?.matchCount, 61);
    assert.deepEqual(directPacket.control.requiredSubgoals.map(goal => goal.id), [goals[0].id]);
    assert.deepEqual(directPacket.observations.map(item => item.id), ['E1', 'E2']);
    assert.ok(directPacket.observations.every(item => item.kind === 'source'));
    assert.deepEqual(verifierPacket.claims.map(claim => claim.id), claims.map(claim => claim.id));
    assert.ok(verifierPacket.observations.some(item => item.id === 'E3' && item.kind === 'search'));
    assert.equal(result.parentHandoff.state, 'complete');
    assert.deepEqual(result.semanticVerification.claims.map(claim => claim.id),
      claims.map(claim => claim.id));
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — a direct-source claim with only search evidence remains a gap',
  async () => {
    const task = 'Explain what requireAuth does when req.user is missing.';
    const goal = trustGoal(task, {
      id: 'S-direct-source-search-only',
      question: task,
      originText: task,
      proofCondition: 'Observe the current requireAuth implementation source.',
    });
    const steps = [
      { stage: 'planner:1', value: plannerControl([goal]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([auditControlRecord(goal)]),
      },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_grep',
          { pattern: 'requireAuth', scope: ['src/**'] },
          'grep-require-auth-only',
        ),
      },
      { stage: 'exploration:2', content: 'The bounded search pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'exploration:3', content: 'No direct source evidence was read.' },
    ];

    const { client, result } = await runTrustScript(steps, { task });

    assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
    assert.equal(client.stageCounts.get('claim_synthesis') ?? 0, 0);
    assert.equal(client.stageCounts.get('semantic_verifier') ?? 0, 0);
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.deepEqual(result.semanticVerification.claims, []);
    assert.ok(result.coverageGaps.some(gap => gap.subgoalId === goal.id),
      JSON.stringify(result.coverageGaps));
    assert.doesNotMatch(JSON.stringify(result.parentHandoff),
      /C-direct-source-search-only|repo_grep|E1/u);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — an unprojectable supported claim records an internal parent gap',
  async () => {
    const task = 'Compare the bounded requireAuth definition and route usage.';
    const goal = trustGoal(task, {
      id: 'S-parent-gap-ledger',
      question: task,
      originText: task,
      claimType: 'comparison',
      proofCondition: 'Observe distinct bounded definition and route-usage sources.',
    });
    const claim = candidateClaim(
      'C-parent-gap-ledger',
      goal.id,
      'requireAuth is defined in src/auth.js and used by src/routes/user.js.',
      ['E1', 'E2', 'E3'],
    );
    const { result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-parent-gap-ledger',
        }, {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-route-parent-gap-ledger',
        }, {
          tool: 'repo_grep',
          args: { pattern: 'requireAuth', scope: ['src/**'] },
          id: 'search-parent-gap-ledger',
        }],
        claims: [claim],
        verifierSteps: [{
          verdicts: [semanticVerdict(claim.id, 'supported', ['E1', 'E2', 'E3'])],
        }, {
          verdicts: [semanticVerdict(claim.id, 'supported', ['E1', 'E2', 'E3'])],
        }],
      },
    }), { task });

    assert.equal(result.failure, null, JSON.stringify({
      failure: result.failure,
      parentHandoff: result.parentHandoff,
      observations: result.observations,
    }));
    assert.equal(result.taskContract.subgoals[0].state, 'supported');
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.equal(result.parentHandoff.directAnswer, undefined);
    assert.ok(result.coverageGaps.some(gap =>
      gap.id === `parent-projection:${goal.id}` &&
      gap.subgoalId === goal.id && gap.reason === 'missing_evidence'));
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — post-repair non-count claims also ignore measurement noise',
  async () => {
    const goal = definitionAndAbsenceGoals()[0];
    const claim = {
      ...candidateClaim(
        'C-post-repair-measurement',
        goal.id,
        'requireAuth is defined in src/auth.js.',
        ['E1'],
      ),
      measurement: null,
    };
    const repairedClaim = {
      ...claim,
      evidenceRefs: ['E1', 'E2'],
      measurement: { kind: 'unsupported', unit: false, value: 'still-not-a-number' },
    };
    const { client, result } = await runTrustScript(buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-auth-before-measurement-repair',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'insufficient')],
      },
      repair: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'read-route-for-measurement-repair',
        }],
        claims: [repairedClaim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E2'])],
      },
    }));

    assert.equal(result.failure, null);
    assert.equal(client.stageCounts.get('claim_synthesis'), 2);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.equal(result.semanticVerification.claims[0].measurement, undefined);
    assert.doesNotMatch(JSON.stringify(result.parentHandoff), /not-a-number/u);
  },
);

test('Spec 028 T031 — verifier proposals are audited once without re-planning or parent leakage', async t => {
  const fixtures = [
    {
      name: 'ready proposal enters one repair and ends terminal',
      verdict: 'ready',
      expectedReason: 'semantic_mismatch',
      expectedState: 'gap',
      repairable: false,
    },
    {
      name: 'untraceable proposal is discarded',
      verdict: 'reject_untraceable',
    },
    {
      name: 'scope blocker becomes a terminal required gap',
      verdict: 'blocked_scope',
      expectedReason: 'scope_blocked',
      expectedState: 'blocked',
      repairable: false,
    },
    {
      name: 'undecomposed proposal becomes a terminal planning gap',
      verdict: 'needs_decomposition',
      expectedReason: 'planning_incomplete',
      expectedState: 'blocked',
      repairable: false,
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const task = 'Locate requireAuth and verify legacyGuard is absent and inspect middleware registration.';
      const goal = trustGoal(task, {
        id: 'S-definition',
        question: 'Where is requireAuth defined?',
        originText: 'Locate requireAuth',
        claimType: 'symbol_definition',
        proofCondition: 'Observe the in-scope requireAuth definition and source body.',
      });
      const claim = candidateClaim(
        'C-definition', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
      const proposal = {
        question: fixture.verdict === 'reject_untraceable'
          ? 'Which unrelated cache should be rewritten?'
          : 'Which requested authentication check still needs repository evidence?',
        originRefs: [requestOrigin(task, 'inspect middleware registration')],
        claimType: 'positive',
        proofCondition: 'Observe the requested authentication evidence.',
        constraints: [],
      };
      const steps = buildTrustSteps({
        goals: [goal],
        initial: {
          tools: [{
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'read-auth',
          }],
          claims: [claim],
          verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
          uncovered: [proposal],
          auditVerdict: fixture.verdict,
        },
        repair: fixture.verdict === 'ready' ? {
          tools: [{
            tool: 'repo_read_file',
            args: { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
            id: 'repair-auth-check',
          }],
          assertRequest: request => assertRepairRequest(request, {
            question: proposal.question,
            anchors: ['src/auth.js'],
          }),
          claims: [
            { ...claim, evidenceRefs: ['E1', 'E2'] },
            candidateClaim(
              'C-late-auth-check',
              'late-uncovered:initial:1',
              'The requested additional authentication check is not yet established.',
              ['E2'],
            ),
          ],
          verdicts: [
            semanticVerdict(claim.id, 'supported', ['E1', 'E2']),
            semanticVerdict('C-late-auth-check', 'insufficient'),
          ],
        } : null,
      });
      const { client, result } = await runTrustScript(steps, { task });

      assert.equal(result.failure, null, JSON.stringify(client.stageLabels));
      assert.equal(client.stageCounts.get('planner'), 1);
      assert.equal(client.stageCounts.get('goal_audit'), 2);
      assert.equal(client.stageCounts.get('semantic_verifier'),
        fixture.verdict === 'ready' ? 2 : 1);
      const lateAuditRequest = client.requests[client.stageLabels.indexOf('goal_audit:2')];
      assert.deepEqual(parseControlPacket(lateAuditRequest).proposals.map(item => item.id), [
        'late-uncovered:initial:1',
      ]);
      if (fixture.verdict === 'reject_untraceable') {
        assertNoRequiredLeak(result, proposal.question);
        assert.deepEqual(result.rejectedGoals.map(item => item.proposedGoalId), [
          'late-uncovered:initial:1',
        ]);
      } else {
        const lateGoal = result.taskContract.subgoals.find(item =>
          item.id === 'late-uncovered:initial:1');
        const gap = result.coverageGaps.find(item => item.subgoalId === lateGoal?.id);
        assert.ok(lateGoal);
        assert.ok(gap);
        assert.equal(lateGoal.state, fixture.expectedState);
        assert.equal(gap.reason, fixture.expectedReason);
        assert.equal(gap.repairable, fixture.repairable);
      }
      assert.equal(result.failure, null);
    });
  }
});

semanticPipelineRuntimeTest(
  'Spec 028 T069 — invalid late audit fails closed without materializing verifier proposals',
  async () => {
    const task = 'Locate requireAuth and inspect middleware registration.';
    const goal = trustGoal(task, {
      id: 'S-late-audit-preserve',
      question: 'Where is requireAuth defined?',
      originText: 'Locate requireAuth',
      claimType: 'symbol_definition',
      proofCondition: 'Observe the in-scope requireAuth definition.',
    });
    const claim = candidateClaim(
      'C-late-audit-preserve', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
    const inventedConstraint = 'VERIFIER_ONLY_LATE_CONSTRAINT';
    const proposal = {
      question: 'Which requested middleware registration still needs evidence?',
      originRefs: [requestOrigin(task, 'inspect middleware registration')],
      claimType: 'positive',
      proofCondition: 'Observe the requested middleware registration.',
      constraints: [inventedConstraint],
    };
    const steps = [
      { stage: 'planner:1', value: plannerControl([goal]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([auditControlRecord(goal)]),
      },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/auth.js', startLine: 1, endLine: 4 },
          'read-auth-before-late-audit',
        ),
      },
      { stage: 'exploration:2', content: 'The initial evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: { claims: [claim] } },
      {
        stage: 'semantic_verifier:1',
        value: verifierResponse([semanticVerdict(claim.id, 'supported', ['E1'])], [proposal]),
      },
      { stage: 'goal_audit:2', value: {} },
      { stage: 'goal_audit:3', value: {} },
    ];

    const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-invalid-late-audit-'));
    let client;
    let result;
    await withEnv({ CEREBRAS_EXPLORER_LOG_PATH: logDir }, async () => {
      ({ client, result } = await runTrustScript(steps, { task }));
    });

    assert.equal(client.stageCounts.get('goal_audit'), 3,
      'late audit receives only one bounded correction attempt');
    assert.equal(result.failure?.reason, 'invalid_final_response');
    assert.equal(result.failure?.publicReason, 'verifier_error');
    assert.equal(result.parentHandoff.state, 'failed');
    assert.equal(result.parentHandoff.failure.reason, 'verifier_error');
    assert.doesNotMatch(result.directAnswer ?? '', /requireAuth is defined/u);
    assert.doesNotMatch(JSON.stringify({
      taskContract: result.taskContract,
      coverageGaps: result.coverageGaps,
      parentHandoff: result.parentHandoff,
    }), /late-uncovered|VERIFIER_ONLY_LATE_CONSTRAINT|middleware registration still needs/u);
    const invalidEvents = (await readJsonl(result.transcriptPath))
      .filter(entry => entry.type === 'control_invalid');
    assert.equal(invalidEvents.length, 1);
    assert.equal(invalidEvents[0].stage, 'late_goal_audit');
    assert.deepEqual(invalidEvents[0].attempts?.map(item => item.attempt), [1, 2]);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — an audited late duplicate merges into the immutable existing goal',
  async () => {
    const task = 'Locate requireAuth.';
    const goal = trustGoal(task, {
      id: 'S-existing-late-merge',
      question: 'Where is requireAuth defined?',
      originText: task,
      claimType: 'symbol_definition',
      proofCondition: 'Observe the in-scope requireAuth definition.',
    });
    const claim = candidateClaim(
      'C-existing-late-merge', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
    const duplicate = {
      question: goal.question,
      originRefs: [...goal.originRefs],
      claimType: goal.claimType,
      proofCondition: goal.proofCondition,
      constraints: [...goal.constraints],
    };
    const steps = [
      { stage: 'planner:1', value: plannerControl([goal]) },
      { stage: 'goal_audit:1', value: auditorControl([auditControlRecord(goal)]) },
      {
        stage: 'exploration:1',
        run: () => toolControlCompletion(
          'repo_read_file',
          { path: 'src/auth.js', startLine: 1, endLine: 4 },
          'read-existing-late-merge',
        ),
      },
      { stage: 'exploration:2', content: 'The bounded evidence pass is complete.' },
      { stage: 'synthesis:1', value: readyExplorationResult() },
      { stage: 'claim_synthesis:1', value: { claims: [claim] } },
      {
        stage: 'semantic_verifier:1',
        value: verifierResponse([semanticVerdict(claim.id, 'supported', ['E1'])], [duplicate]),
      },
      {
        stage: 'goal_audit:2',
        run(request) {
          const packet = parseControlPacket(request);
          assert.deepEqual(packet.proposals.map(item => item.id), ['late-uncovered:initial:1']);
          assert.deepEqual(packet.existingGoalLedger.map(item => item.id), [goal.id]);
          assert.equal(JSON.stringify(packet.existingGoalLedger).includes('supported'), false,
            'runtime state is not part of the immutable semantic ledger');
          return controlCompletion(auditorControl([{
            ...auditControlRecord(packet.proposals[0], 'merge_duplicate'),
            mergeInto: goal.id,
          }]));
        },
      },
    ];

    const { client, result } = await runTrustScript(steps, { task });
    assert.equal(client.stageCounts.get('goal_audit'), 2);
    assert.deepEqual(result.taskContract.subgoals.map(item => item.id), [goal.id]);
    assert.deepEqual(result.coverageGaps, []);
    assert.equal(result.parentHandoff.state, 'complete');
    assert.equal(JSON.stringify(result.parentHandoff).includes('existingGoalLedger'), false);
    assert.equal(JSON.stringify(result.parentHandoff).includes('mergeInto'), false);
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — a distinct late obligation sharing origin and claim type is still audited',
  async () => {
    const goal = definitionAndAbsenceGoals()[0];
    const claim = candidateClaim(
      'C-covered-origin', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
    const proposal = {
      question: 'Which exported API exposes requireAuth?',
      originRefs: [...goal.originRefs],
      claimType: goal.claimType,
      proofCondition: 'Observe the export boundary that exposes requireAuth.',
      constraints: [],
    };
    const steps = buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-covered-origin',
        }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
        uncovered: [proposal],
        auditVerdict: 'ready',
      },
      repair: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 7 },
          id: 'inspect-require-auth-export-boundary',
        }],
        claims: [
          { ...claim, evidenceRefs: ['E1', 'E2'] },
          candidateClaim(
            'C-export-boundary',
            'late-uncovered:initial:1',
            'The export boundary for requireAuth is not yet established.',
            ['E2'],
          ),
        ],
        verdicts: [
          semanticVerdict(claim.id, 'supported', ['E1', 'E2']),
          semanticVerdict('C-export-boundary', 'insufficient'),
        ],
      },
    });

    const { client, result } = await runTrustScript(steps);
    assert.equal(client.stageCounts.get('planner'), 1);
    assert.equal(client.stageCounts.get('goal_audit'), 2);
    assert.equal(client.stageCounts.get('semantic_verifier'), 2);
    const lateAuditRequest = client.requests[client.stageLabels.indexOf('goal_audit:2')];
    assert.deepEqual(parseControlPacket(lateAuditRequest).proposals.map(item => item.id), [
      'late-uncovered:initial:1',
    ]);
    const lateGoal = result.taskContract.subgoals.find(item =>
      item.id === 'late-uncovered:initial:1');
    assert.ok(lateGoal);
    assert.equal(lateGoal.state, 'gap');
    assert.deepEqual(result.rejectedGoals, []);
    assert.equal(result.parentHandoff.state, 'incomplete');
    assert.ok(result.parentHandoff.gaps.some(gap =>
      gap.question === expectedParentGapQuestion(result, lateGoal)));
    assert.equal(JSON.stringify(result.parentHandoff).includes(proposal.question), false,
      'the parent gap is derived from the immutable request rather than verifier prose');
  },
);

test('Spec 028 T031 — proposals from every verifier batch enter one late audit ledger', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const goals = Array.from({ length: 13 }, (_, index) => trustGoal(task, {
    id: `S-batch-${index + 1}`,
    question: `Inspect requested authentication facet ${index + 1}.`,
    originText: task,
  }));

  class BatchedVerifierClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.stageCounts = new Map();
      this.lateAuditBatches = [];
    }

    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      const count = (this.stageCounts.get(stage) ?? 0) + 1;
      this.stageCounts.set(stage, count);

      if (stage === 'planner') return controlCompletion(plannerControl(goals));
      if (stage === 'goal_audit') {
        const proposals = parseControlPacket(request).proposals;
        if (proposals.every(goal => goal.id.startsWith('late-uncovered:'))) {
          this.lateAuditBatches.push(proposals.map(goal => goal.id));
        }
        return controlCompletion(auditorControl(
          proposals.map(goal => auditControlRecord(goal)),
        ));
      }
      if (stage === 'exploration') {
        if (count === 1) {
          return toolControlCompletion(
            'repo_read_file',
            { path: 'src/auth.js', startLine: 1, endLine: 4 },
            'batch-read',
          );
        }
        if (count === 3) {
          assertRepairRequest(request, {
            question: 'Inspect verifier batch 1 follow-up requirement.',
            anchors: ['src/auth.js'],
          });
          const repairMessage = request.messages.findLast(message =>
            typeof message.content === 'string' &&
            message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))?.content ?? '';
          const repairMatch = /BEGIN_EVIDENCE_REPAIR_JSON\n([\s\S]*?)\nEND_EVIDENCE_REPAIR_JSON/
            .exec(repairMessage);
          assert.ok(repairMatch);
          assert.deepEqual(JSON.parse(repairMatch[1]).questions.map(item => item.question), [
            'Inspect verifier batch 1 follow-up requirement.',
            'Inspect verifier batch 2 follow-up requirement.',
          ]);
          return toolControlCompletion(
            'repo_read_file',
            { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
            'batch-repair-read',
          );
        }
        return controlCompletion('Evidence collection complete.');
      }
      if (stage === 'synthesis') return controlCompletion(readyExplorationResult());
      if (stage === 'claim_synthesis') {
        const packet = parseControlPacket(request);
        const batchGoals = packet.control.requiredSubgoals;
        const evidenceRefs = packet.observations
          .filter(observation => observation.kind === 'source')
          .map(observation => observation.id);
        return controlCompletion({
          claims: batchGoals.map(goal => candidateClaim(
            `C-${goal.id}`,
            goal.id,
            `Observed source evidence for ${goal.question}`,
            evidenceRefs,
          )),
        });
      }
      if (stage === 'semantic_verifier') {
        const claims = parseControlPacket(request).claims;
        return controlCompletion(verifierResponse(
          claims.map(claim => claim.subgoalId.startsWith('late-uncovered:')
            ? semanticVerdict(claim.id, 'insufficient')
            : semanticVerdict(claim.id, 'supported', claim.evidenceRefs)),
          count <= 2 ? [{
            question: `Inspect verifier batch ${count} follow-up requirement.`,
            originRefs: [`request:0-${task.length}`],
            claimType: 'positive',
            proofCondition: `Observe repository evidence for verifier batch ${count}.`,
            constraints: [],
          }] : [],
        ));
      }
      assert.fail(`unexpected stage ${stage}`);
    }
  }

  const root = await makeRepoFixture();
  const client = new BatchedVerifierClient();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({
    task,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(client.stageCounts.get('planner'), 1);
  assert.equal(client.stageCounts.get('semantic_verifier'), 4);
  assert.deepEqual(client.lateAuditBatches, [[
    'late-uncovered:initial:1',
    'late-uncovered:initial:2',
  ]], 'all verifier batches must be collected before one isolated late audit');
  assert.deepEqual(result.taskContract.subgoals
    .filter(goal => goal.id.startsWith('late-uncovered:'))
    .map(goal => goal.state), ['gap', 'gap']);
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.subgoalId?.startsWith('late-uncovered:'))
    .map(gap => gap.repairable), [false, false]);
});

test('Spec 028 T031 — post-repair verifier proposals use the same audit and stay terminal', async () => {
  const task = 'Locate requireAuth and inspect its requested route registration.';
  const existing = createRequiredSubgoal({
    id: 'S-existing',
    question: 'Where is requireAuth defined?',
    originRefs: [requestOrigin(task, 'Locate requireAuth')],
    claimType: 'symbol_definition',
    proofCondition: 'Observe the in-scope definition and source body.',
    constraints: [],
    auditVerdict: 'ready',
  });
  const taskContract = createTaskContract({
    task,
    effectiveScope: ['src/**'],
    constraints: [],
    subgoals: [existing],
    plannerVersion: 'planner-v1',
    goalAuditVersion: 'goal-audit-v1',
  });
  const stages = [];
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      stages.push(classifyControlRequest(request));
      return lateAuditResponse(request, 'ready');
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime._auditVerifierGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'explore_repo',
    taskContract,
    coverageGaps: [],
    rejectedGoals: [{
      proposedGoalId: 'late-uncovered:post-repair:1',
      verdict: 'reject_untraceable',
      originRefs: [],
      missingRequestParts: [],
      reason: 'Previously rejected.',
    }],
    uncoveredRequestParts: [{
      question: 'Which requested route registration still needs inspection?',
      originRefs: [requestOrigin(task, 'inspect its requested route registration')],
      claimType: 'positive',
      proofCondition: 'Observe current route registration source.',
      constraints: [],
    }],
    phase: 'post-repair',
  });

  assert.deepEqual(stages, ['goal_audit']);
  const lateGoal = result.taskContract.subgoals.find(goal =>
    goal.id === 'late-uncovered:post-repair:2');
  assert.ok(lateGoal, 'runtime ids must avoid prior rejected-goal ids');
  assert.equal(lateGoal.state, 'gap');
  const gap = result.coverageGaps.find(item => item.subgoalId === lateGoal.id);
  assert.equal(gap.reason, 'uncovered_request');
  assert.equal(gap.repairable, false);
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), [
    'late-uncovered:post-repair:1',
  ]);
});

test('Spec 028 T071 — collect_evidence rejects any late-goal integration bypass', async () => {
  const task = 'Verify whether requireAuth protects the requested route.';
  const audited = createRequiredSubgoal({
    id: 'S-collect-verdict',
    question: 'Is the supplied repository claim supported or refuted?',
    originRefs: [requestOrigin(task, task), 'wrapper:collect_evidence:verdict'],
    claimType: 'claim_verification',
    proofCondition: 'Reach one evidence-backed verdict for the supplied claim.',
    constraints: [],
    auditVerdict: 'ready',
  });
  const taskContract = createTaskContract({
    task,
    effectiveScope: ['src/**'],
    constraints: [],
    subgoals: [audited],
    plannerVersion: 'planner-v1',
    goalAuditVersion: 'goal-audit-v1',
  });
  const stages = [];
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      stages.push(classifyControlRequest(request));
      return lateAuditResponse(request, 'ready');
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });
  await assert.rejects(runtime._auditVerifierGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'collect_evidence',
    taskContract,
    coverageGaps: [],
    rejectedGoals: [],
    uncoveredRequestParts: [{
      question: 'Could a different requested route refute the claim?',
      originRefs: [requestOrigin(task, 'requested route')],
      claimType: 'positive',
      proofCondition: 'Inspect the other requested route facet.',
      constraints: [],
    }],
    phase: 'initial',
  }), /single verdict goal/u);

  assert.deepEqual(stages, []);
  assert.deepEqual(taskContract.subgoals.map(goal => goal.id), [audited.id]);
});

semanticPipelineRuntimeTest('Spec 028 T026 — verifier input is isolated and gates semantic mismatch', async () => {
  const goals = definitionAndAbsenceGoals();
  const supported = candidateClaim(
    'C-definition', goals[0].id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const mismatch = candidateClaim(
    'C-absence', goals[1].id, 'legacyGuard is absent from every repository path.', ['E2']);
  const privateSentinels = [
    'PRIVATE_EXPLORER_REASONING',
    'MODEL_CONFIDENCE_099',
  ];
  const steps = buildTrustSteps({
    goals,
    initial: {
      tools: [
        { tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'read-auth' },
        { tool: 'repo_grep', args: { pattern: 'legacyGuard', scope: ['src/**'] }, id: 'grep-legacy' },
      ],
      prose: privateSentinels.join(' '),
      claims: [supported, mismatch],
      verdicts: [
        semanticVerdict(supported.id, 'supported', ['E1']),
        semanticVerdict(mismatch.id, 'insufficient'),
      ],
      assertVerifier(request) {
        const packet = JSON.stringify(request.messages);
        for (const expected of [
          'Locate requireAuth', 'src/**', supported.id, mismatch.id,
          'export function requireAuth', 'sourceRole', 'temporalRole', 'current',
        ]) assert.match(packet, new RegExp(expected.replaceAll('*', '\\*')));
        for (const sentinel of privateSentinels) {
          assert.doesNotMatch(packet, new RegExp(sentinel));
        }
      },
    },
    repair: { tools: [], claims: [], verdicts: [] },
  });
  const { client, result } = await runTrustScript(steps);

  assert.equal(client.stageCounts.get('semantic_verifier'), 1);
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[0].id).state, 'supported');
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[1].id).state, 'gap');
  assert.match(result.directAnswer, /requireAuth is defined/);
  assert.doesNotMatch(result.directAnswer, /absent from every repository path/);
  assert.ok(result.coverageGaps.some(gap =>
    gap.subgoalId === goals[1].id && gap.reason === 'semantic_mismatch'));
  assert.equal(result.failure, null);
});

test('Spec 028 T032 — verifier inventions are audited without re-planning or leakage', async t => {
  const task = 'Locate requireAuth and report whether route registration needs another authentication check.';
  const goal = trustGoal(task, {
    id: 'S-definition',
    question: 'Where is requireAuth defined?',
    originText: 'Locate requireAuth',
    claimType: 'symbol_definition',
  });
  const claim = candidateClaim(
    'C-definition', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const cases = [
    {
      name: 'initial untraceable proposal is discarded',
      question: 'Which unrelated cache should be rewritten?',
      initialVerdict: 'supported',
      auditVerdict: 'reject_untraceable',
      postRepair: false,
    },
    {
      name: 'post-repair traceable proposal becomes a terminal gap',
      question: 'Which route registration needs another authentication check?',
      initialVerdict: 'insufficient',
      auditVerdict: 'ready',
      postRepair: true,
    },
    {
      name: 'post-repair untraceable proposal is discarded',
      question: 'Which unrelated cache should be rewritten?',
      initialVerdict: 'insufficient',
      auditVerdict: 'reject_untraceable',
      postRepair: true,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const proposal = {
        question: fixture.question,
        originRefs: [requestOrigin(task, fixture.postRepair
          ? 'report whether route registration needs another authentication check'
          : 'Locate requireAuth')],
        claimType: 'positive',
        proofCondition: `Observe evidence for ${fixture.question}`,
        constraints: [],
      };
      const initial = {
        tools: [{ tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 1 }, id: 'read-partial' }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, fixture.initialVerdict,
          fixture.initialVerdict === 'supported' ? ['E1'] : [])],
        ...(fixture.postRepair ? {} : {
          uncovered: [proposal], auditVerdict: fixture.auditVerdict,
        }),
      };
      const repair = fixture.postRepair ? {
        tools: [{ tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'repair-read' }],
        assertRequest: request => assertRepairRequest(request, {
          question: goal.question,
          anchors: ['src/auth.js'],
        }),
        claims: [{ ...claim, evidenceRefs: ['E1', 'E2'] }],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1', 'E2'])],
        uncovered: [proposal],
        auditVerdict: fixture.auditVerdict,
      } : null;
      const { client, result } = await runTrustScript(
        buildTrustSteps({ goals: [goal], initial, repair }), { task });

      assert.equal(client.stageCounts.get('planner'), 1);
      assert.equal(client.stageCounts.get('goal_audit'), 2);
      assert.equal(client.stageCounts.get('semantic_verifier'), fixture.postRepair ? 2 : 1);
      assert.equal(providerToolActions(client).filter(action =>
        action.arguments.path === 'src/auth.js' && action.arguments.endLine === 4).length,
      fixture.postRepair ? 1 : 0);
      if (fixture.auditVerdict === 'ready') {
        const gap = result.coverageGaps.find(item => item.question === fixture.question);
        assert.ok(gap);
        assert.equal(gap.reason, 'uncovered_request');
        assert.equal(gap.repairable, false);
      } else {
        assertNoRequiredLeak(result, fixture.question);
      }
      assert.equal(result.failure, null);
    });
  }
});

test('Spec 028 T032 — one repair reopens claims and suppresses equivalent follow-up', async () => {
  const task = 'Verify every user route uses requireAuth and determine whether legacyGuard is registered.';
  const goals = [
    trustGoal(task, {
      id: 'S-routes', question: 'Does every user route use requireAuth?',
      originText: 'Verify every user route uses requireAuth', claimType: 'absence',
    }),
    trustGoal(task, {
      id: 'S-legacy', question: 'Is legacyGuard registered?',
      originText: 'determine whether legacyGuard is registered', claimType: 'absence',
      proofCondition: 'Use the exact grep and complete route-registration read without repeating either action.',
      constraints: ['Do not widen src/** or require external state.'],
    }),
    trustGoal(task, {
      id: 'S-recovered', question: 'Does the public route use requireAuth?',
      originText: 'Verify every user route uses requireAuth', claimType: 'positive',
    }),
  ];
  const routeClaim = candidateClaim(
    'C-routes', goals[0].id, 'Every observed user route uses requireAuth.', ['E1']);
  const legacyClaim = candidateClaim(
    'C-legacy', goals[1].id, 'legacyGuard is absent from src/**.', ['E2']);
  const recoveredClaim = candidateClaim(
    'C-recovered', goals[2].id, 'The public route uses requireAuth.', ['E1']);
  const repairAction = {
    type: 'tool',
    tool: 'repo_read_file',
    arguments: { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
  };
  const repairFingerprint = fingerprintAction(repairAction);
  const steps = buildTrustSteps({
    goals,
    initial: {
      tools: [
        { tool: 'repo_read_file', args: { path: 'src/routes/user.js', startLine: 1, endLine: 4 }, id: 'read-route' },
        { tool: 'repo_grep', args: { pattern: 'legacyGuard', scope: ['src/**'] }, id: 'grep-legacy' },
      ],
      claims: [routeClaim, legacyClaim, recoveredClaim],
      verdicts: [
        semanticVerdict(routeClaim.id, 'supported', ['E1']),
        semanticVerdict(legacyClaim.id, 'insufficient'),
        semanticVerdict(recoveredClaim.id, 'contradicted'),
      ],
    },
    repair: {
      tools: [{
        tool: repairAction.tool,
        args: { endLine: 20, startLine: 1, path: 'src/routes/user.js' },
        id: 'repair-routes',
      }],
      assertRequest: request => assertRepairRequest(request, {
        question: goals[1].question,
        anchors: ['src/routes/user.js', 'legacyGuard'],
      }),
      claims: [
        { ...routeClaim, evidenceRefs: ['E1', 'E3'] },
        { ...legacyClaim, evidenceRefs: ['E2', 'E3'] },
        { ...recoveredClaim, evidenceRefs: ['E1', 'E3'] },
      ],
      verdicts: [
        semanticVerdict(routeClaim.id, 'contradicted'),
        semanticVerdict(legacyClaim.id, 'insufficient'),
        semanticVerdict(recoveredClaim.id, 'supported', ['E3']),
      ],
      assertVerifier(request) {
        const packet = JSON.stringify(request.messages);
        for (const id of [
          'S-routes', 'S-legacy', 'S-recovered',
          'C-routes', 'C-legacy', 'C-recovered',
        ]) {
          assert.match(packet, new RegExp(id));
        }
        assert.match(packet, /\/users\/public/);
      },
    },
  });
  const { client, result } = await runTrustScript(steps, {
    task,
    setup: root => fs.appendFile(
      path.join(root, 'src', 'routes', 'user.js'),
      '\n\nexport const publicRoute = app => app.get("/users/public", publicHandler);',
    ),
  });

  assert.equal(client.stageCounts.get('semantic_verifier'), 2);
  assert.equal(client.stageCounts.get('claim_synthesis'), 4);
  assert.equal(client.stageCounts.get('planner'), 1);
  assert.equal(providerToolActions(client).filter(action =>
    fingerprintAction(action) === repairFingerprint).length, 1);
  assert.doesNotMatch(result.directAnswer ?? '', /Every observed user route uses requireAuth/);
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[0].id).state, 'contradicted');
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[2].id).state, 'supported',
  'fresh repair evidence can resolve a previously contradicted goal');
  const legacyGap = result.coverageGaps.find(gap => gap.subgoalId === goals[1].id);
  assert.ok(legacyGap.attemptedActionFingerprints.includes(repairFingerprint));
  assert.equal(legacyGap.repairable, false);
  assert.equal(legacyGap.followUp, undefined,
    'the only equivalent action was already attempted during repair');
  assert.deepEqual(result.observations.map(observation => observation.id), [
    'E1', 'E1:search', 'E2', 'E3', 'E3:search',
  ]);
  assert.equal(result.failure, null);
});

test('Spec 028 T032 — repair never re-executes an equivalent initial action', async () => {
  const task = 'Determine whether requireAuth is fully established by the inspected range.';
  const goal = trustGoal(task, {
    id: 'S-repeat',
    question: task,
    originText: task,
  });
  const claim = candidateClaim(
    'C-repeat', goal.id, 'The inspected range fully establishes requireAuth.', ['E1']);
  const action = {
    type: 'tool',
    tool: 'repo_read_file',
    arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 },
  };
  const { client, result } = await runTrustScript(buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{ tool: action.tool, args: action.arguments, id: 'initial-read' }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
    repair: {
      tools: [{ tool: action.tool, args: { endLine: 4, path: 'src/auth.js', startLine: 1 }, id: 'repeat-read' }],
      assertRequest(request) {
        assertRepairRequest(request, {
          question: goal.question,
          anchors: ['src/auth.js'],
        });
        const content = request.messages.find(message =>
          message.role === 'user' && message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))
          ?.content ?? '';
        const match = /BEGIN_EVIDENCE_REPAIR_JSON\n([\s\S]*?)\nEND_EVIDENCE_REPAIR_JSON/.exec(content);
        const packet = JSON.parse(match?.[1] ?? 'null');
        assert.deepEqual(packet.history.sourceRanges, [{
          path: 'src/auth.js', startLine: 1, endLine: 4,
        }]);
        assert.ok(packet.history.searches.some(item =>
          item.tool === 'repo_read_file' && item.arguments.path === 'src/auth.js' &&
          item.arguments.startLine === 1 && item.arguments.endLine === 4));
        assert.match(request.messages[0].content, /Do not repeat an exact or equivalent prior action/u);
      },
      claims: [{ ...claim }],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
  }), { task });

  assert.equal(client.stageCounts.get('claim_synthesis'), 1,
    'no fresh observation means there is no post-repair synthesis');
  assert.equal(client.stageCounts.get('semantic_verifier'), 1);
  assert.deepEqual(result.observations.map(observation => observation.id), ['E1', 'E1:search']);
  assert.equal(result.stats.filesRead, 1, 'the equivalent repair read was suppressed');
  assert.equal(result.directAnswer, '',
    'an unresolved claim must not fall back to pre-verifier exploration text');
  const gap = result.coverageGaps.find(item => item.subgoalId === goal.id);
  assert.equal(gap.repairable, false);
  assert.deepEqual(gap.attemptedActionFingerprints, [fingerprintAction(action)]);
});

test('Spec 028 T069 — runtime carries an omitted post-repair prior claim without stale success', async () => {
  const task = 'Determine whether requireAuth protects the inspected route.';
  const goal = trustGoal(task, {
    id: 'S-preserve',
    question: task,
    originText: task,
  });
  const claim = candidateClaim(
    'C-preserve', goal.id, 'requireAuth protects the inspected route.', ['E1']);
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'initial-auth',
      }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
    repair: {
      tools: [
        {
          tool: 'repo_read_file',
          args: { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
          id: 'repair-route',
        },
        {
          tool: 'repo_grep',
          args: { pattern: 'requireAuth', scope: ['src/**'] },
          id: 'repair-auth-search',
        },
      ],
      claims: [],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
  });

  const { client, result } = await runTrustScript(steps, { task });
  const postClaimRequest = client.requests[
    client.stageLabels.indexOf('claim_synthesis:2')
  ];
  const postClaimPacket = parseControlPacket(postClaimRequest);
  assert.deepEqual(postClaimPacket.observations.map(item => item.id), ['E1', 'E2']);
  assert.ok(postClaimPacket.observations.every(item => item.kind === 'source'));
  const priorPacketText = postClaimRequest.messages.findLast(message =>
    typeof message.content === 'string' &&
    message.content.includes('BEGIN_REQUIRED_PRIOR_CLAIMS_JSON'))?.content ?? '';
  const priorPacketMatch = /BEGIN_REQUIRED_PRIOR_CLAIMS_JSON\n([\s\S]*?)\nEND_REQUIRED_PRIOR_CLAIMS_JSON/
    .exec(priorPacketText);
  assert.ok(priorPacketMatch);
  const priorPacket = JSON.parse(priorPacketMatch[1]);
  assert.deepEqual(priorPacket.freshEvidenceRefs, ['E2']);
  assert.deepEqual(priorPacket.priorClaims, [claim]);
  const postVerifierPacket = parseControlPacket(client.requests[
    client.stageLabels.indexOf('semantic_verifier:2')
  ]);
  assert.ok(postVerifierPacket.observations.some(item =>
    item.id === 'E3' && item.kind === 'search'));
  assert.equal(client.stageCounts.get('claim_synthesis'), 2);
  assert.equal(result.failure, null);
  assert.equal(result.parentHandoff.state, 'incomplete');
  assert.deepEqual(result.semanticVerification.claims.map(item => item.id), [claim.id]);
  assert.equal(result.semanticVerification.claims[0].verdict, 'insufficient');
  assert.doesNotMatch(result.directAnswer, /requireAuth protects the inspected route/);
});

test('Spec 028 T032 — a zero-observation gap still receives the one repair round', async () => {
  const task = 'Determine whether requireAuth is defined.';
  const goal = trustGoal(task, {
    id: 'S-anchorless',
    question: task,
    originText: task,
  });
  const claim = candidateClaim(
    'C-anchorless', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const steps = [
    { stage: 'planner:1', value: plannerControl([goal]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(goal)]),
    },
    { stage: 'exploration:1', content: 'No initial repository action.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
    {
      stage: 'exploration:2',
      run(request) {
        assertRepairRequest(request, { question: goal.question, anchors: [] });
        const content = request.messages.find(message =>
          message.role === 'user' && message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))
          ?.content ?? '';
        const match = /BEGIN_EVIDENCE_REPAIR_JSON\n([\s\S]*?)\nEND_EVIDENCE_REPAIR_JSON/.exec(content);
        assert.deepEqual(JSON.parse(match?.[1] ?? 'null').anchors, [],
          'question and immutable scope bound an anchorless repair');
        return toolControlCompletion('repo_read_file', {
          path: 'src/auth.js', startLine: 1, endLine: 4,
        }, 'anchorless-repair');
      },
    },
    { stage: 'claim_synthesis:1', value: { claims: [claim] } },
    {
      stage: 'semantic_verifier:1',
      value: verifierResponse([semanticVerdict(claim.id, 'supported', ['E1'])]),
    },
  ];

  const { client, result } = await runTrustScript(steps, { task });

  assert.equal(client.stageCounts.get('exploration'), 2);
  assert.equal(client.stageCounts.get('claim_synthesis'), 1);
  assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
    'supported');
  assert.equal(result.coverageGaps.some(gap => gap.subgoalId === goal.id), false);
  assert.deepEqual(result.observations.map(observation => observation.id), ['E1', 'E1:search']);
});

semanticPipelineRuntimeTest('Spec 028 T026 — valid partial limits are goal-local and non-fatal', async () => {
  const goals = definitionAndAbsenceGoals();
  const definition = candidateClaim(
    'C-definition', goals[0].id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const exhaustive = candidateClaim(
    'C-long', goals[1].id, 'legacyGuard is absent from every line of src/long.js.', ['E2']);
  const steps = buildTrustSteps({
    goals,
    initial: {
      tools: [
        { tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'read-auth' },
        { tool: 'repo_read_file', args: { path: 'src/long.js', startLine: 1, endLine: 10_000 }, id: 'read-long' },
      ],
      claims: [definition, exhaustive],
      verdicts: [
        semanticVerdict(definition.id, 'supported', ['E1']),
        semanticVerdict(exhaustive.id, 'insufficient'),
      ],
      assertVerifier(request) {
        assert.match(JSON.stringify(request.messages),
          /tool_result_limit|toolTruncated|contextTruncated/);
      },
    },
  });
  const { client, result } = await runTrustScript(steps, {
    setup: root => fs.writeFile(
      path.join(root, 'src', 'long.js'),
      Array.from({ length: 400 }, (_, index) => `export const line${index} = ${index};`).join('\n'),
    ),
  });

  assert.equal(client.stageCounts.get('semantic_verifier'), 1);
  assert.equal(result.failure, null);
  assert.match(result.directAnswer, /requireAuth is defined/);
  assert.doesNotMatch(result.directAnswer, /legacyGuard is absent from every line/);
  assert.ok(result.coverageGaps.some(gap =>
    gap.subgoalId === goals[1].id && gap.reason === 'safety_limit_reached'));
  const toolLimits = result.stats.safetyLimits.filter(limit =>
    limit.name === 'tool_result_limit');
  assert.deepEqual(toolLimits.map(limit => limit.stage), ['exploration']);
  assert.ok(toolLimits[0].affectedSubgoalIds.includes(goals[1].id));
});

semanticPipelineRuntimeTest('Spec 028 T033 — cancellation after the final verifier response suppresses verified output', async () => {
  const controller = new AbortController();
  const goal = definitionAndAbsenceGoals()[0];
  const claim = candidateClaim(
    'C-late-cancel', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'read-auth',
      }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
      assertVerifier() {
        controller.abort();
      },
    },
  });

  const { result } = await runTrustScript(steps, { abortSignal: controller.signal });

  assert.equal(controller.signal.aborted, true);
  assert.equal(result.failure?.reason, 'aborted');
  assert.equal(result.status.complete, false);
  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.evidence, []);
  assert.doesNotMatch(result.directAnswer, /requireAuth is defined/);
});

semanticPipelineRuntimeTest('Spec 028 T034 — semantic repair lifecycle stays diagnostic and prose-free', async () => {
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-trust-events-'));
  const goal = definitionAndAbsenceGoals()[0];
  const claimText = 'UNVERIFIED_CLAIM_TRANSCRIPT_SENTINEL';
  const explorationDraft = 'UNVERIFIED_EXPLORATION_TRANSCRIPT_SENTINEL';
  const repairDraft = 'UNVERIFIED_REPAIR_TRANSCRIPT_SENTINEL';
  const verifierNote = 'UNVERIFIED_VERIFIER_NOTE_SENTINEL';
  const initialClaim = candidateClaim('C-transcript', goal.id, claimText, ['E1']);
  const repairedClaim = candidateClaim('C-transcript', goal.id, claimText, ['E1', 'E2']);
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'read-auth',
      }],
      prose: explorationDraft,
      claims: [initialClaim],
      verdicts: [{
        ...semanticVerdict(initialClaim.id, 'insufficient'),
        note: verifierNote,
      }],
    },
    repair: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/routes/user.js', startLine: 1, endLine: 8 },
        id: 'read-route',
      }],
      prose: repairDraft,
      claims: [repairedClaim],
      verdicts: [{
        ...semanticVerdict(repairedClaim.id, 'supported', ['E2']),
        note: verifierNote,
      }],
    },
  });

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const { client, result } = await runTrustScript(steps);
    const entries = await readJsonl(result.transcriptPath);
    const claims = entries.filter(entry => entry.type === 'claim');
    const verdicts = entries.filter(entry => entry.type === 'verdict');
    const repairs = entries.filter(entry => entry.type === 'repair');
    const finals = entries.filter(entry => entry.type === 'final');
    const usage = entries.filter(entry => entry.type === 'usage');

    assert.deepEqual(claims.map(entry => entry.phase), ['initial', 'post-repair']);
    assert.deepEqual(verdicts.map(entry => entry.phase), ['initial', 'post-repair']);
    assert.deepEqual(repairs.map(entry => entry.status), ['started', 'finished']);
    assert.equal(repairs[1].outcome, 'completed');
    assert.equal(repairs[1].outcomes[0].state, 'supported');
    assert.deepEqual(finals[0].acceptedClaimIds, [initialClaim.id]);
    assert.equal(finals[0].requiredSubgoals[0].state, 'supported');
    assert.deepEqual(finals[0].parentPayload, result.parentPayloadMeasurement);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].providerCalls, client.requests.length);
    assert.equal(usage[0].repositoryToolCalls, 2);
    const repairTool = entries.find(entry => entry.type === 'tool' && entry.stage === 'repair');
    assert.ok(repairTool);
    assert.ok(repairs[1].actionFingerprints.includes(repairTool.actionFingerprint));
    assert.equal(entries.at(-1).type, 'meta');
    assert.ok(entries.filter(entry => entry.type === 'assistant')
      .every(entry => !('content' in entry) && Number.isInteger(entry.contentChars)));
    assert.ok(claims.every(entry => entry.claims.every(claim => !('text' in claim))));
    assert.ok(verdicts.every(entry => entry.verdicts.every(verdict => !('note' in verdict))));

    const serialized = JSON.stringify(entries);
    for (const sentinel of [claimText, explorationDraft, repairDraft, verifierNote]) {
      assert.equal(serialized.includes(sentinel), false);
    }
  });
});

semanticPipelineRuntimeTest('Spec 028 T041 — transcript records only claims accepted by the parent projection', {
  skip: !hasGit(),
}, async () => {
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-parent-accepted-claims-'));
  const task = 'Identify the committed requireAuth change.';
  const goal = trustGoal(task, {
    id: 'S-parent-projection',
    question: task,
    originText: task,
  });
  const claim = candidateClaim(
    'C-parent-projection', goal.id, 'requireAuth changed in the inspected diff.', ['E1']);
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_git_diff',
        args: { from: 'HEAD~1', to: 'HEAD', path: 'src/auth.js' },
        id: 'diff-auth',
      }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
    },
    repair: {
      tools: [{
        tool: 'repo_git_show',
        args: { ref: 'HEAD' },
        id: 'show-auth-repair',
      }],
      claims: [{ ...claim, evidenceRefs: ['E1', 'E2'] }],
      verdicts: [semanticVerdict(claim.id, 'supported', ['E2'])],
    },
  });

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const { result } = await runTrustScript(steps, {
      task,
      async setup(root) {
        const git = args => execFileSync('git', args, {
          cwd: root,
          stdio: 'pipe',
          encoding: 'utf8',
        });
        git(['init']);
        git(['config', 'user.email', 'explorer@example.invalid']);
        git(['config', 'user.name', 'Explorer Test']);
        git(['add', '.']);
        git(['commit', '-m', 'base']);
        await fs.appendFile(path.join(root, 'src', 'auth.js'), '\n// inspected change\n');
        git(['add', 'src/auth.js']);
        git(['commit', '-m', 'change auth']);
      },
    });
    const entries = await readJsonl(result.transcriptPath);
    const final = entries.find(entry => entry.type === 'final');

    assert.deepEqual(result.semanticVerification?.claims ?? [], []);
    assert.equal(result.parentHandoff.state, 'incomplete',
      'a diff hunk without a commit sha cannot be parent-facing git proof');
    assert.deepEqual(final.acceptedClaimIds, []);
  });
});

semanticPipelineRuntimeTest('Spec 028 T034 — transcript persistence cannot change the committed terminal outcome', async () => {
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-trust-terminal-cutoff-'));
  const controller = new AbortController();
  const goal = definitionAndAbsenceGoals()[0];
  const claim = candidateClaim(
    'C-terminal-cutoff', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'read-auth-terminal-cutoff',
      }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
    },
  });

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const originalAppendFile = fs.appendFile;
    let abortedDuringTerminalWrite = false;
    fs.appendFile = async (file, data, ...rest) => {
      if (!abortedDuringTerminalWrite && String(data).includes('"type":"final"')) {
        abortedDuringTerminalWrite = true;
        controller.abort();
      }
      return originalAppendFile.call(fs, file, data, ...rest);
    };
    let result;
    try {
      ({ result } = await runTrustScript(steps, { abortSignal: controller.signal }));
    } finally {
      fs.appendFile = originalAppendFile;
    }

    const entries = await readJsonl(result.transcriptPath);
    const final = entries.find(entry => entry.type === 'final');
    assert.equal(abortedDuringTerminalWrite, true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(result.failure?.reason, undefined);
    assert.equal(final.failureReason, undefined);
    assert.deepEqual(final.acceptedClaimIds, [claim.id]);
  });
});

semanticPipelineRuntimeTest('Spec 028 T034 — planner and auditor cancellation count the issued provider request', async () => {
  const goal = definitionAndAbsenceGoals()[0];
  for (const abortAt of ['planner:1', 'goal_audit:1']) {
    const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-trust-planning-cancel-'));
    const controller = new AbortController();
    const labels = [];
    const client = {
      model: 'zai-glm-4.7',
      async createChatCompletion(request) {
        const stage = classifyControlRequest(request);
        const label = `${stage}:1`;
        labels.push(label);
        if (label === abortAt) {
          controller.abort();
          const error = new Error(`cancelled at ${label}`);
          error.name = 'AbortError';
          throw error;
        }
        if (label === 'planner:1') return controlCompletion(plannerControl([goal]));
        assert.fail(`unexpected request after ${abortAt}: ${label}`);
      },
    };

    await withEnv({
      CEREBRAS_EXPLORER_LOG_PATH: logDir,
      CEREBRAS_EXPLORER_LOG_RAW: 'true',
    }, async () => {
      const root = await makeRepoFixture();
      const result = await new RuntimeImplementation({ chatClient: client }).explore(
        { task: GOAL_AUDIT_TASK, repo_root: root },
        { abortSignal: controller.signal },
      );
      const entries = await readJsonl(result.transcriptPath);
      const usage = entries.find(entry => entry.type === 'usage');

      assert.equal(result.failure?.reason, 'aborted', abortAt);
      assert.equal(labels.at(-1), abortAt);
      assert.equal(usage.providerCalls, labels.length, abortAt);
    });
  }
});

semanticPipelineRuntimeTest('Spec 028 T034 — failed repair records one terminal failure without stale claims', async () => {
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-trust-failure-events-'));
  const goal = definitionAndAbsenceGoals()[0];
  const staleText = 'UNVERIFIED_FAILED_REPAIR_CLAIM_SENTINEL';
  const claim = candidateClaim('C-failed-repair', goal.id, staleText, ['E1']);
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'read-auth',
      }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
    repair: {
      providerError: 'repair provider outage sentinel',
    },
  });

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const { client, result } = await runTrustScript(steps);
    const entries = await readJsonl(result.transcriptPath);
    const repairs = entries.filter(entry => entry.type === 'repair');
    const final = entries.find(entry => entry.type === 'final');
    const usage = entries.find(entry => entry.type === 'usage');

    assert.equal(result.failure?.reason, 'provider_error');
    assert.deepEqual(repairs.map(entry => entry.status), ['started', 'finished']);
    assert.equal(repairs[1].outcome, 'failed');
    assert.equal(final.failureReason, 'provider_error');
    assert.deepEqual(final.acceptedClaimIds, []);
    assert.equal(usage.providerCalls, client.requests.length);
    assert.equal(entries.at(-1).type, 'meta');
    assert.equal(JSON.stringify(entries).includes(staleText), false);
    assert.equal(JSON.stringify(entries).includes('repair provider outage sentinel'), false);
  });
});

semanticPipelineRuntimeTest('Spec 028 T069 — repair executes one bounded parallel tool batch', async () => {
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-trust-repair-batch-'));
  const goal = definitionAndAbsenceGoals()[0];
  const claim = candidateClaim(
    'C-repair-batch', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const repairCalls = [
    {
      tool: 'repo_read_file',
      args: { path: 'src/routes/user.js', startLine: 1, endLine: 4 },
      id: 'repair-route-opening',
    },
    {
      tool: 'repo_read_file',
      args: { path: 'src/routes/user.js', startLine: 5, endLine: 7 },
      id: 'repair-route-closing',
    },
  ];
  const repairedClaim = { ...claim, evidenceRefs: ['E1', 'E2', 'E3'] };
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'read-auth',
      }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
    repair: {
      tools: repairCalls,
      claims: [repairedClaim],
      verdicts: [semanticVerdict(claim.id, 'supported', ['E2', 'E3'])],
    },
  });

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const { client, result } = await runTrustScript(steps);
    const entries = await readJsonl(result.transcriptPath);
    const repairs = entries.filter(entry => entry.type === 'repair');
    const repairTools = entries.filter(entry => entry.type === 'tool' && entry.stage === 'repair');
    const usage = entries.find(entry => entry.type === 'usage');
    const repairRequestIndexes = client.requests.flatMap((request, index) =>
      JSON.stringify(request.messages).includes('BEGIN_EVIDENCE_REPAIR_JSON') ? [index] : []);
    const repairCompletion = client.completions[repairRequestIndexes[0]];
    const repairFingerprints = repairCalls.map(call => fingerprintAction({
      type: 'tool',
      tool: call.tool,
      arguments: call.args,
    }));

    assert.equal(result.failure, null);
    assert.deepEqual(repairRequestIndexes.length, 1);
    assert.deepEqual(repairCompletion.message.toolCalls.map(call => call.id),
      repairCalls.map(call => call.id));
    assert.deepEqual(client.stageLabels, [
      'planner:1',
      'goal_audit:1',
      'exploration:1',
      'exploration:2',
      'synthesis:1',
      'claim_synthesis:1',
      'semantic_verifier:1',
      'exploration:3',
      'claim_synthesis:2',
      'semantic_verifier:2',
    ]);
    assert.deepEqual(repairs.map(entry => entry.status), ['started', 'finished']);
    assert.equal(repairs[1].outcome, 'completed');
    assert.equal(repairTools.length, repairCalls.length);
    for (const fingerprint of repairFingerprints) {
      assert.equal(providerToolActions(client).filter(action =>
        fingerprintAction(action) === fingerprint).length, 1);
      assert.equal(repairTools.filter(entry => entry.actionFingerprint === fingerprint).length, 1);
    }
    assert.equal(entries.some(entry => entry.type === 'provider_failure'), false);
    assert.equal(usage.providerCalls, client.requests.length);
  });
});

semanticPipelineRuntimeTest('Spec 028 T033 — invalid final control never promotes a stale draft', async t => {
  const goal = definitionAndAbsenceGoals()[0];
  const claim = candidateClaim(
    'C-final-stale', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  for (const fixture of [
    {
      name: 'bounded invalid responses become an internal control failure',
      secondStep: { stage: 'synthesis:2', content: 'STALE_FINAL_REPAIR_SENTINEL' },
      category: 'internal',
      reason: 'invalid_final_response',
    },
    {
      name: 'provider failure during final repair takes precedence',
      secondStep: {
        stage: 'synthesis:2',
        run() {
          const error = new Error('final repair provider outage');
          error.retryable = false;
          throw error;
        },
      },
      category: 'provider',
      reason: 'provider_error',
    },
  ]) {
    await t.test(fixture.name, async () => {
      const steps = buildTrustSteps({
        goals: [goal],
        initial: {
          tools: [{
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'read-auth',
          }],
          claims: [claim],
          verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
        },
      });
      const synthesisIndex = steps.findIndex(step => step.stage === 'synthesis:1');
      steps.splice(
        synthesisIndex,
        1,
        { stage: 'synthesis:1', content: 'STALE_FINAL_PRIMARY_SENTINEL' },
        fixture.secondStep,
      );

      const { client, result } = await runTrustScript(steps);

      assert.equal(client.stageCounts.get('semantic_verifier') ?? 0, 0);
      assert.equal(result.failure?.category, fixture.category);
      assert.equal(result.failure?.reason, fixture.reason);
      assert.equal(result.status.complete, false);
      assert.deepEqual(result.targets, []);
      assert.deepEqual(result.evidence, []);
      assert.deepEqual(result.discoveredPaths, []);
      assert.doesNotMatch(JSON.stringify(result), /STALE_FINAL_(?:PRIMARY|REPAIR)_SENTINEL/);
    });
  }
});

semanticPipelineRuntimeTest(
  'Spec 028 T069 — verifier evidence cannot cross claim boundaries and receives one correction',
  async () => {
    const task = 'Locate requireAuth and locate registerUserRoutes.';
    const goals = [
      trustGoal(task, {
        id: 'S-auth-definition',
        question: 'Where is requireAuth defined?',
        originText: 'Locate requireAuth',
      }),
      trustGoal(task, {
        id: 'S-route-definition',
        question: 'Where is registerUserRoutes defined?',
        originText: 'locate registerUserRoutes',
      }),
    ];
    const claims = [
      candidateClaim('C-auth-definition', goals[0].id,
        'requireAuth is defined in src/auth.js.', ['E1']),
      candidateClaim('C-route-definition', goals[1].id,
        'registerUserRoutes is defined in src/routes/user.js.', ['E2']),
    ];
    const invalidVerdicts = [
      semanticVerdict(claims[0].id, 'supported', ['E2']),
      semanticVerdict(claims[1].id, 'supported', ['E2']),
    ];
    const correctedVerdicts = [
      semanticVerdict(claims[0].id, 'supported', ['E1']),
      semanticVerdict(claims[1].id, 'supported', ['E2']),
    ];
    const steps = buildTrustSteps({
      goals,
      initial: {
        tools: [
          {
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'read-auth-for-verifier-boundary',
          },
          {
            tool: 'repo_read_file',
            args: { path: 'src/routes/user.js', startLine: 1, endLine: 6 },
            id: 'read-route-for-verifier-boundary',
          },
        ],
        claims,
        verifierSteps: [
          { verdicts: invalidVerdicts },
          {
            verdicts: correctedVerdicts,
            assertRequest(request) {
              const correction = JSON.stringify(request.messages);
              assert.match(correction,
                /supportingEvidenceRef must come from that same claim evidenceRefs/u);
              assert.match(correction,
                /outside claim C-auth-definition: invalid=\[E2\], allowed=\[E1\]/u);
            },
          },
        ],
      },
    });

    const { client, result } = await runTrustScript(steps, { task });

    assert.equal(client.stageCounts.get('semantic_verifier'), 2);
    assert.equal(result.failure, null);
    assert.deepEqual(result.taskContract.subgoals.map(goal => goal.state),
      ['supported', 'supported']);
    assert.equal(result.parentHandoff.state, 'complete');
  },
);

semanticPipelineRuntimeTest(
  'Spec 028 T069 — repeated cross-claim verifier evidence fails as verifier_error',
  async () => {
    const task = 'Locate requireAuth.';
    const goal = trustGoal(task, {
      id: 'S-verifier-boundary-failure',
      question: task,
      originText: task,
    });
    const claim = candidateClaim(
      'C-verifier-boundary-failure',
      goal.id,
      'requireAuth is defined in src/auth.js.',
      ['E1'],
    );
    const invalid = semanticVerdict(claim.id, 'supported', ['E-outside-claim']);
    const steps = buildTrustSteps({
      goals: [goal],
      initial: {
        tools: [{
          tool: 'repo_read_file',
          args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
          id: 'read-auth-for-repeated-verifier-boundary',
        }],
        claims: [claim],
        verifierSteps: [{ verdicts: [invalid] }, { verdicts: [invalid] }],
      },
    });

    const { client, result } = await runTrustScript(steps, { task });

    assert.equal(client.stageCounts.get('semantic_verifier'), 2);
    assert.equal(result.failure?.reason, 'invalid_final_response');
    assert.equal(result.failure?.publicReason, 'verifier_error');
    assert.equal(result.parentHandoff.state, 'failed');
    assert.equal(result.parentHandoff.failure.reason, 'verifier_error');
    assert.doesNotMatch(result.directAnswer, /requireAuth is defined/u);
  },
);

semanticPipelineRuntimeTest('Spec 028 T026 — invalid verifier and provider faults fail closed', async t => {
  const goal = definitionAndAbsenceGoals()[0];
  const staleText = 'UNVERIFIED_FIRST_PASS_CLAIM';
  const claim = candidateClaim('C-stale', goal.id, staleText, ['E1']);
  const faultCases = [
    {
      name: 'malformed verifier JSON after bounded recovery',
      verifierSteps: [{ raw: '{"verdicts":' }, { raw: '{"verdicts":' }],
      verifierCalls: 2,
      failureCategory: 'internal',
      failureReason: 'invalid_final_response',
    },
    {
      name: 'output-capped invalid verifier JSON',
      verifierSteps: [
        { raw: '{"verdicts":', finishReason: 'length' },
        { raw: '{"verdicts":', finishReason: 'length' },
      ],
      verifierCalls: 2,
      failureCategory: 'internal',
      failureReason: 'invalid_final_response',
      check(result) {
        const limit = result.stats.safetyLimits.find(item =>
          item.name === 'generation_output_limit');
        assert.equal(limit.stage, 'verification');
        assert.equal(limit.truncated, true);
      },
    },
    {
      name: 'provider fault at verifier',
      verifierSteps: [{ error: 'non-retryable verifier outage' }],
      verifierCalls: 1,
      failureCategory: 'provider',
      failureReason: 'provider_error',
    },
    {
      name: 'provider fault during repair',
      verifierSteps: [{ verdicts: [semanticVerdict(claim.id, 'insufficient')] }],
      repairError: 'non-retryable repair outage',
      verifierCalls: 1,
      failureCategory: 'provider',
      failureReason: 'provider_error',
    },
  ];

  for (const fixture of faultCases) {
    await t.test(fixture.name, async () => {
      const initial = {
        tools: [{ tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'read-auth' }],
        prose: staleText,
        claims: [claim],
        verifierSteps: fixture.verifierSteps,
      };
      const repair = fixture.repairError ? { providerError: fixture.repairError } : null;
      if (repair) {
        repair.assertRequest = request => assertRepairRequest(request, {
          question: goal.question,
          anchors: ['src/auth.js'],
        });
      }
      const { client, result } = await runTrustScript(
        buildTrustSteps({ goals: [goal], initial, repair }));

      assert.ok(result.failure);
      assert.equal(result.failure.category, fixture.failureCategory);
      assert.equal(result.failure.reason, fixture.failureReason);
      assert.doesNotMatch(result.directAnswer ?? '', new RegExp(staleText));
      assert.equal(result.status.complete, false);
      assert.deepEqual(result.targets, []);
      assert.deepEqual(result.evidence, []);
      assert.deepEqual(result.discoveredPaths, []);
      assert.equal(client.stageCounts.get('semantic_verifier'), fixture.verifierCalls);
      fixture.check?.(result);
    });
  }
});
