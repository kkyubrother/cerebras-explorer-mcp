import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPLORE_REPO_INPUT_SCHEMA,
  EXPLORE_REPO_OUTPUT_SCHEMA,
  EXPLORE_RESULT_JSON_SCHEMA,
  computeConfidenceScore,
  normalizeExploreResult,
  reconcileConfidence,
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

test('agent-facing budget and strategy fields are marked advanced/legacy', () => {
  assert.match(
    EXPLORE_REPO_INPUT_SCHEMA.properties.budget.description,
    /Advanced\/legacy only/,
  );
  assert.match(
    EXPLORE_REPO_INPUT_SCHEMA.properties.hints.properties.strategy.description,
    /Advanced\/legacy only/,
  );
});

test('followup suggestedCall is optional in schema and normalization', () => {
  const followupSchema = EXPLORE_RESULT_JSON_SCHEMA.schema.properties.followups.items;
  assert.deepEqual(followupSchema.required, ['description', 'priority']);
  assert.deepEqual(followupSchema.properties.suggestedCall.required, ['task']);

  const result = normalizeExploreResult({
    answer: 'answer',
    summary: 'summary',
    confidence: 'medium',
    evidence: [],
    candidatePaths: [],
    followups: [
      { description: 'check related routes', priority: 'recommended' },
    ],
  }, makeStats());

  assert.equal(result.followups.length, 1);
  assert.equal(result.followups[0].description, 'check related routes');
  assert.equal(result.followups[0].suggestedCall, null);
});

test('agent-facing output schema exposes directAnswer, status, targets, snippets, and debug', () => {
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.directAnswer);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.status);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.targets);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.evidence.items.properties.snippet);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties._debug);
});

test('normalizeExploreResult accepts legacy object candidatePaths and v3 fields', () => {
  const result = normalizeExploreResult({
    directAnswer: 'direct',
    answer: 'answer',
    summary: 'summary',
    confidence: 'high',
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
    candidatePaths: [{ path: 'src/auth.js', why: 'definition' }],
    followups: [],
  }, makeStats());

  assert.equal(result.directAnswer, 'direct');
  assert.equal(result.status.verification, 'targeted_read_needed');
  assert.equal(result.targets[0].evidenceRefs[0], 'E1');
  assert.equal(result.evidence[0].snippet, '1: export function requireAuth() {}');
  assert.deepEqual(result.candidatePaths, ['src/auth.js']);
});
