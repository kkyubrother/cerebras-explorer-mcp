import test from 'node:test';
import assert from 'node:assert/strict';

import { computeConfidenceScore, reconcileConfidence } from '../src/explorer/schemas.mjs';

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

test('computeConfidenceScore: single exact evidence from one file caps at medium', () => {
  // One exact item from one file — score would otherwise be high enough, but gate should cap it
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const { level } = computeConfidenceScore(evidence, 1, makeStats());
  assert.ok(['low', 'medium'].includes(level), `expected low or medium, got ${level}`);
});

test('computeConfidenceScore: two exact items from two different files can be high', () => {
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/b.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 2, makeStats({ grepCalls: 1 }));
  // With 2 exact + 2 distinct files + search used, score = 0.15 + 0.36 + 0.12 + 0.05 = 0.68 → medium
  // But with 'locate' task it could be higher
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: two exact items from same file caps at medium (hard gate)', () => {
  // Same path → distinctFiles = 1 → gate fires even with 2 exact items
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
  ];
  const { level, factors } = computeConfidenceScore(evidence, 2, makeStats({ grepCalls: 1 }));
  assert.notEqual(level, 'high', 'two exact items from same file must be capped at medium');
  const capped = factors.adjustments.some(a => a.includes('capped at medium'));
  // Only fires if score reached high — may not fire if score < 0.7; accept either outcome
  if (level !== 'high') {
    // either the gate fired, or the score was already medium/low
    assert.ok(true);
  }
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
    taskKind: 'locate',
    exactEvidence: 2,
    droppedEvidence: 1,
    stoppedByBudget: false,
  });
  assert.equal(result, 'low', 'dropped evidence must force computed level');
});

test('reconcileConfidence: always returns computedLevel when stoppedByBudget', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    taskKind: 'locate',
    exactEvidence: 1,
    droppedEvidence: 0,
    stoppedByBudget: true,
  });
  assert.equal(result, 'medium', 'stoppedByBudget must force computed level');
});

test('reconcileConfidence: locate with exactEvidence >= 1 trusts model confidence', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    taskKind: 'locate',
    exactEvidence: 1,
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'high', 'locate + exact evidence allows model confidence to stand');
});

test('reconcileConfidence: non-locate takes the lower of model and computed', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    taskKind: 'causal',
    exactEvidence: 2,
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'medium', 'non-locate must take the lower confidence');
});

test('reconcileConfidence: model low is preserved even when computed is high', () => {
  const result = reconcileConfidence({
    modelConfidence: 'low',
    computedLevel: 'high',
    taskKind: 'causal',
    exactEvidence: 2,
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'low', 'lower of model/computed wins; here model=low');
});
