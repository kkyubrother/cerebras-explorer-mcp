import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCriticWarnings,
  buildReportCritic,
  deriveTaskKindFromHints,
  extractGitCitations,
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

test('groundEvidenceList treats wide symbol-context evidence as partial, not exact', () => {
  const result = groundEvidenceList({
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 200, why: 'wide claim from symbol context' },
    ],
    observedRanges: new Map([
      ['src/auth.js', [{ startLine: 50, endLine: 55, source: 'symbol_context_definition' }]],
    ]),
    observedGit: { commits: new Set(), blame: new Set() },
  });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.exactEvidence, 0);
  assert.equal(result.partialEvidence, 1);
  assert.equal(result.evidence[0].groundingStatus, 'partial');
});

test('groundEvidenceList requires observed sha for sha-only git diff hunk evidence', () => {
  const result = groundEvidenceList({
    evidence: [
      {
        evidenceType: 'git_diff_hunk',
        path: 'src/auth.js',
        startLine: 1,
        endLine: 10,
        sha: 'abc1234',
        why: 'observed commit hunk',
      },
      {
        evidenceType: 'git_diff_hunk',
        path: 'src/auth.js',
        startLine: 20,
        endLine: 30,
        sha: 'deadbeef',
        why: 'unobserved commit hunk',
      },
    ],
    observedRanges: new Map(),
    observedGit: { commits: new Set(['abc1234567890abcdef']), blame: new Set() },
  });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].sha, 'abc1234');
  assert.equal(result.evidence[0].groundingStatus, 'partial');
  assert.equal(result.droppedUngrounded, 1);
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
  assert.equal(result.confidenceFactors.evidenceCount, 2);
  assert.equal(result.confidenceFactors.evidenceGrounded, 1);
});

test('runDeterministicCriticPass still caps overconfident locate tasks', () => {
  const normalized = {
    answer: 'answer',
    summary: 'summary',
    confidence: 'high',
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'single exact locate evidence' },
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
    taskKind: 'locate',
  });

  assert.equal(result.confidence, 'medium');
  assert.equal(result.critic.status, 'caution');
  assert.ok(result.critic.warnings.some(w => w.type === 'confidence_downgraded'));
});

test('extractReportCitations finds inline file citations', () => {
  const citations = extractReportCitations('See `src/auth.js:L1-L4` and src/routes/user.js:10-12.');
  assert.deepEqual(citations.map(c => c.path), ['src/auth.js', 'src/routes/user.js']);
  assert.equal(citations[0].startLine, 1);
  assert.equal(citations[0].endLine, 4);
});

test('extractReportCitations ignores root filenames and non-path dotted values', () => {
  const citations = extractReportCitations('Ignore README.md:L10, node.js:14, and 192.168.0.1:8080.');
  assert.deepEqual(citations, []);
});

test('extractGitCitations finds commit and blame citations', () => {
  const citations = extractGitCitations('See commit:abc1234 and blame:src/auth.js:L5.');
  assert.deepEqual(citations, [
    { type: 'git_commit', sha: 'abc1234', raw: 'commit:abc1234' },
    { type: 'git_blame', path: 'src/auth.js', line: 5, raw: 'blame:src/auth.js:L5' },
  ]);
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

test('buildReportCritic warns when report has no citations and no files read', () => {
  const critic = buildReportCritic({
    report: 'This report has claims but no grounding.',
    filesRead: [],
    stats: makeStats(),
  });

  assert.equal(critic.status, 'fail');
  assert.equal(critic.warnings[0].type, 'no_files_read');
  assert.ok(critic.warnings[0].message);
  assert.ok(critic.warnings[0].action);
});

test('buildReportCritic accepts git citations as citations', () => {
  const critic = buildReportCritic({
    report: 'Recent history points to commit:abc1234.',
    filesRead: [],
    stats: makeStats(),
  });

  assert.equal(critic.status, 'pass');
  assert.deepEqual(critic.warnings, []);
});

test('buildReportCritic warns for citations that were not read', () => {
  const critic = buildReportCritic({
    report: 'See `src/missing.js:L1-L2` and `src/other.js:L3`.',
    filesRead: ['src/auth.js'],
    stats: makeStats(),
  });

  assert.equal(critic.status, 'caution');
  assert.equal(critic.warnings[0].target, '`src/missing.js:L1-L2`');
  assert.match(critic.warnings[0].message, /2 citation\(s\)/);
});
