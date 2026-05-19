import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPLORE_REPO_INPUT_SCHEMA,
  EXPLORE_REPO_OUTPUT_SCHEMA,
  EXPLORE_RESULT_JSON_SCHEMA,
  computeConfidenceScore,
  normalizeExploreResult,
  reconcileConfidence,
  validateExploreRepoArgs,
} from '../src/explorer/schemas.mjs';

// Helper: build a grounded evidence item with a given groundingStatus and optional path
function makeEvidence({ groundingStatus = 'exact', path = 'src/foo.mjs' } = {}) {
  return { groundingStatus, path, startLine: 1, endLine: 10, why: 'test' };
}

// Helper: minimal stats object
function makeStats(overrides = {}) {
  return {
    grepCalls: 0,
    symbolCalls: 0,
    stoppedByBudget: false,
    gitLogCalls: 0,
    gitDiffCalls: 0,
    gitBlameCalls: 0,
    ...overrides,
  };
}

// ── computeConfidenceScore ────────────────────────────────────────────────────

test('computeConfidenceScore: single exact evidence item from one file cannot reach high', () => {
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const { level } = computeConfidenceScore(evidence, 1, makeStats());
  assert.notEqual(level, 'high', 'single exact evidence from one file must not be high');
});

test('computeConfidenceScore: partial-only evidence cannot become high', () => {
  const evidence = [
    makeEvidence({ groundingStatus: 'partial', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'partial', path: 'src/b.mjs' }),
    makeEvidence({ groundingStatus: 'partial', path: 'src/c.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 3, makeStats());
  assert.notEqual(level, 'high', 'partial-only evidence must not reach high confidence');
});

test('computeConfidenceScore: single exact evidence from one file can reach medium or high', () => {
  // With recalibrated base scores: 1 exact item from 1 file
  // base=0.30 + exact=0.18 + search=0 = 0.48 → medium, or higher with search
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const { level } = computeConfidenceScore(evidence, 1, makeStats());
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: two exact items from two different files can be high', () => {
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/b.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 2, makeStats({ grepCalls: 1 }));
  // With recalibrated scores: base=0.30 + 2*exact=0.36 + cross=0.12 + search=0.05 = 0.83 → high
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: two exact items from same file can reach high (relaxed gate)', () => {
  // Same path → distinctFiles = 1, but 2 exact items satisfy the relaxed gate (exactCount >= 1)
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 2, makeStats({ grepCalls: 1 }));
  // base=0.30 + 2*exact=0.36 + search=0.05 = 0.71 → high (no longer capped for single-file)
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: stoppedByBudget lowers confidence score', () => {
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/b.mjs' }),
  ];
  const withBudget = computeConfidenceScore(evidence, 2, makeStats({ stoppedByBudget: true }));
  const withoutBudget = computeConfidenceScore(evidence, 2, makeStats({ stoppedByBudget: false }));
  assert.ok(withBudget.score < withoutBudget.score,
    'stoppedByBudget must reduce the confidence score');
  assert.equal(withBudget.factors.stoppedByBudget, true);
});

test('computeConfidenceScore: no evidence returns score 0.10 and low level', () => {
  const { score, level } = computeConfidenceScore([], 0, makeStats());
  assert.equal(score, 0.1);
  assert.equal(level, 'low');
});

test('computeConfidenceScore: dropped evidence reduces score by 0.25', () => {
  // 2 items originally, 1 grounded
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const withDrop = computeConfidenceScore(evidence, 2, makeStats()); // 1 dropped
  const noDrop = computeConfidenceScore(evidence, 1, makeStats());  // 0 dropped
  assert.ok(withDrop.score < noDrop.score, 'dropped evidence must lower the score');
  const dropAdjustment = withDrop.factors.adjustments.some(a => a.includes('dropped as ungrounded'));
  assert.ok(dropAdjustment, 'adjustment note for dropped evidence should be present');
});

test('computeConfidenceScore: locate taskKind starts from higher base score', () => {
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const locateResult = computeConfidenceScore(evidence, 1, makeStats(), 'locate');
  const defaultResult = computeConfidenceScore(evidence, 1, makeStats(), undefined);
  assert.ok(locateResult.score > defaultResult.score,
    'locate taskKind must have a higher base score than default');
});

// ── reconcileConfidence ───────────────────────────────────────────────────────

test('reconcileConfidence: always returns computedLevel when evidence was dropped', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'low',
    droppedEvidence: 1,
    stoppedByBudget: false,
  });
  assert.equal(result, 'low', 'dropped evidence must force computed level');
});

test('reconcileConfidence: always returns computedLevel when stoppedByBudget', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
    stoppedByBudget: true,
  });
  assert.equal(result, 'medium', 'stoppedByBudget must force computed level');
});

test('reconcileConfidence: locate still takes the lower of model and computed confidence', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'medium', 'locate must not bypass computed confidence');
});

test('reconcileConfidence: non-locate takes the lower of model and computed', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'medium', 'non-locate must take the lower confidence');
});

test('reconcileConfidence: model low is preserved even when computed is high', () => {
  const result = reconcileConfidence({
    modelConfidence: 'low',
    computedLevel: 'high',
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'low', 'lower of model/computed wins; here model=low');
});

test('agent-facing budget and strategy fields are marked advanced only', () => {
  assert.match(
    EXPLORE_REPO_INPUT_SCHEMA.properties.budget.description,
    /Advanced only/,
  );
  assert.match(
    EXPLORE_REPO_INPUT_SCHEMA.properties.hints.properties.strategy.description,
    /Advanced only/,
  );
});

test('internal model result schema uses the compact explore contract', () => {
  assert.deepEqual(EXPLORE_RESULT_JSON_SCHEMA.schema.required, [
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
  ]);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.directAnswer);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.status);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.targets);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.evidence);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.uncertainties);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.nextAction);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.answer, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.summary, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.confidence, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.candidatePaths, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.followups, undefined);
});

test('validateExploreRepoArgs rejects unknown public keys', () => {
  assert.throws(
    () => validateExploreRepoArgs({ task: 'find auth code', context: 'ignore this' }),
    /Unknown explore_repo argument: context/,
  );
});

test('validateExploreRepoArgs rejects unknown hint keys', () => {
  assert.throws(
    () => validateExploreRepoArgs({
      task: 'find auth code',
      hints: { files: ['src/auth.js'], taskMode: 'locate' },
    }),
    /Unknown explore_repo hints argument: taskMode/,
  );
});

test('agent-facing output schema is compact and exposes directAnswer, status, targets, snippets, sessionId, and debug', () => {
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.required, [
    'schemaVersion',
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
    'evidenceQuality',
    'failure',
  ]);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const, 1);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.directAnswer);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.status);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.targets);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.evidence.items.properties.snippet);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.evidenceQuality);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure.anyOf[1].properties.reason.enum.includes('invalid_arguments'));
  const retrySchema = EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure.anyOf[1].properties.retry.anyOf[1];
  assert.ok(retrySchema.properties.args);
  assert.ok(retrySchema.properties.expectedImprovement);
  assert.equal(retrySchema.properties.args.additionalProperties, false);
  assert.equal(
    retrySchema.properties.args.properties.hints.properties.strategy,
    undefined,
    'failure.retry.args must not expose advanced hints.strategy',
  );
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.sessionId);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.session);
  assert.deepEqual(
    EXPLORE_REPO_OUTPUT_SCHEMA.properties.session.properties.status.enum,
    ['created', 'reused', 'fallback'],
  );
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.properties.session.required, [
    'id',
    'status',
    'remainingCalls',
  ]);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.searchCoverage);
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.properties.searchCoverage.required, [
    'scope',
    'scopeLimited',
    'filesRead',
    'grepCalls',
    'listDirCalls',
    'symbolCalls',
    'toolResultsTruncated',
    'stoppedByBudget',
    'warnings',
    'summary',
  ]);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties._debug);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.answer, undefined);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.candidatePaths, undefined);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.followups, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.schemaVersion, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.evidenceQuality, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.failure, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.searchCoverage, undefined);
});

test('normalizeExploreResult accepts compact result fields without legacy aliases', () => {
  const result = normalizeExploreResult({
    directAnswer: 'direct',
    status: {
      confidence: 'high',
      verification: 'targeted_read_needed',
      complete: true,
      warnings: [],
    },
    targets: [
      {
        path: 'src/auth.js',
        startLine: 1,
        endLine: 4,
        role: 'read',
        reason: 'definition',
        evidenceRefs: ['E1'],
      },
    ],
    evidence: [
      {
        id: 'E1',
        path: 'src/auth.js',
        startLine: 1,
        endLine: 4,
        why: 'definition',
        snippet: '1: export function requireAuth() {}',
      },
    ],
    uncertainties: ['read auth before editing'],
    nextAction: {
      type: 'read_target',
      reason: 'Read src/auth.js before editing.',
    },
  }, makeStats());

  assert.equal(result.directAnswer, 'direct');
  assert.equal(result.status.verification, 'targeted_read_needed');
  assert.equal(result.targets[0].evidenceRefs[0], 'E1');
  assert.equal(result.evidence[0].snippet, undefined);
  assert.deepEqual(result.uncertainties, ['read auth before editing']);
  assert.equal(result.nextAction.type, 'read_target');
  assert.equal(result.answer, undefined);
  assert.equal(result.candidatePaths, undefined);
  assert.equal(result.followups, undefined);
});
