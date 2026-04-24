import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCriticWarnings,
  buildReportCritic,
  deriveTaskKindFromHints,
  extractReportCitations,
  groundEvidenceList,
  runDeterministicCriticPass,
} from '../src/explorer/critic.mjs';

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

test('deriveTaskKindFromHints maps symbol-first to locate', () => {
  assert.equal(deriveTaskKindFromHints({ strategy: 'symbol-first' }), 'locate');
  assert.equal(deriveTaskKindFromHints({ strategy: 'reference-chase' }), 'reference-chase');
  assert.equal(deriveTaskKindFromHints({}), 'default');
});

test('groundEvidenceList returns exact, partial, and dropped evidence counts without mutating input', () => {
  const evidence = [
    { path: './src/auth.js', startLine: 1, endLine: 4, why: 'read range' },
    { path: 'src/auth.js', startLine: 20, endLine: 24, why: 'grep-nearby range' },
    { path: 'src/missing.js', startLine: 1, endLine: 2, why: 'not observed' },
    { path: '', startLine: 1, endLine: 1, why: '' },
  ];
  const observedRanges = new Map([
    ['src/auth.js', [
      { startLine: 1, endLine: 4, source: 'read' },
      { startLine: 19, endLine: 19, source: 'grep' },
    ]],
  ]);

  const result = groundEvidenceList({
    evidence,
    observedRanges,
    observedGit: { commits: new Set(), blame: new Set() },
  });

  assert.equal(result.evidence.length, 2);
  assert.equal(result.exactEvidence, 1);
  assert.equal(result.partialEvidence, 1);
  assert.equal(result.droppedUngrounded, 1);
  assert.equal(result.droppedMalformed, 1);
  assert.equal(evidence[0].path, './src/auth.js', 'input evidence must not be mutated');
});

test('buildCriticWarnings explains warning reasons and actions', () => {
  const warnings = buildCriticWarnings({
    grounding: {
      droppedMalformed: 0,
      droppedUngrounded: 2,
      partialEvidence: 1,
      partialTargets: ['src/auth.js:20-24'],
    },
    confidence: {
      modelConfidence: 'high',
      finalConfidence: 'medium',
    },
    stats: makeStats({ stoppedByBudget: true }),
  });

  assert.ok(warnings.length <= 3, 'default warning list must stay compact');
  assert.ok(warnings.every(w => w.message && w.action), 'warnings need reason and action');
  assert.ok(warnings.some(w => w.type === 'confidence_downgraded'));
});

test('runDeterministicCriticPass returns compact critic warnings and capped confidence', () => {
  const normalized = {
    answer: 'answer',
    summary: 'summary',
    confidence: 'high',
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'only observed range' },
      { path: 'src/other.js', startLine: 1, endLine: 2, why: 'not observed' },
    ],
    candidatePaths: [],
    followups: [],
    stats: makeStats(),
  };
  const observedRanges = new Map([
    ['src/auth.js', [{ startLine: 1, endLine: 4, source: 'read' }]],
  ]);

  const { result } = runDeterministicCriticPass({
    normalized,
    observedRanges,
    observedGit: { commits: new Set(), blame: new Set() },
    stats: makeStats(),
    taskKind: 'default',
  });

  assert.notEqual(result.confidence, 'high');
  assert.equal(result.critic.status, 'caution');
  assert.ok(result.critic.warnings.some(w => w.type === 'dropped_evidence'));
  assert.ok(result.critic.warnings.every(w => !('citations' in w)));
});

test('extractReportCitations finds inline file citations', () => {
  const citations = extractReportCitations('See `src/auth.js:L1-L4` and src/routes/user.js:10-12.');
  assert.deepEqual(citations.map(c => c.path), ['src/auth.js', 'src/routes/user.js']);
  assert.equal(citations[0].startLine, 1);
  assert.equal(citations[0].endLine, 4);
});

test('buildReportCritic warns when markdown report lacks citations', () => {
  const critic = buildReportCritic({
    report: 'This report has claims but no inline citations.',
    filesRead: ['src/auth.js'],
    stats: makeStats(),
  });

  assert.equal(critic.status, 'caution');
  assert.equal(critic.warnings[0].type, 'citation_gap');
  assert.ok(critic.warnings[0].message);
  assert.ok(critic.warnings[0].action);
});

test('buildReportCritic warns for citations that were not read', () => {
  const critic = buildReportCritic({
    report: 'See `src/missing.js:L1-L2`.',
    filesRead: ['src/auth.js'],
    stats: makeStats(),
  });

  assert.equal(critic.status, 'caution');
  assert.equal(critic.warnings[0].target, '`src/missing.js:L1-L2`');
});
