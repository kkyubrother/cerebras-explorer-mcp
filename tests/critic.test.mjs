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

test('groundEvidenceList treats grep anchors as exact only for fully observed ranges', () => {
  const result = groundEvidenceList({
    evidence: [
      { path: 'src/auth.js', startLine: 10, endLine: 10, why: 'single grep hit' },
      { path: 'src/auth.js', startLine: 10, endLine: 12, why: 'neighboring lines not inspected' },
    ],
    observedRanges: new Map([
      ['src/auth.js', [{ startLine: 10, endLine: 10, source: 'grep' }]],
    ]),
    observedGit: { commits: new Set(), blame: new Set() },
  });

  assert.equal(result.evidence.length, 2);
  assert.equal(result.exactEvidence, 1);
  assert.equal(result.partialEvidence, 1);
  assert.equal(result.evidence[0].groundingStatus, 'exact');
  assert.equal(result.evidence[1].groundingStatus, 'partial');
});

test('groundEvidenceList does not count single-line blame as exact multi-line evidence', () => {
  const result = groundEvidenceList({
    evidence: [
      {
        evidenceType: 'git_blame',
        path: 'src/auth.js',
        startLine: 20,
        endLine: 22,
        sha: 'abc1234',
        why: 'only one blamed line was observed',
      },
    ],
    observedRanges: new Map([
      ['src/auth.js', [{ startLine: 20, endLine: 20, source: 'blame' }]],
    ]),
    observedGit: { commits: new Set(), blame: new Set(['src/auth.js:20:abc1234']) },
  });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.exactEvidence, 0);
  assert.equal(result.partialEvidence, 1);
  assert.equal(result.evidence[0].groundingStatus, 'partial');
});

test('groundEvidenceList drops malformed line ranges instead of grounding them', () => {
  const result = groundEvidenceList({
    evidence: [
      { path: 'src/auth.js', why: 'missing range' },
      { path: 'src/auth.js', startLine: '1', endLine: 2, why: 'non-integer start' },
      { path: 'src/auth.js', startLine: 5, endLine: 3, why: 'inverted range' },
      { path: 'src/auth.js', startLine: 1, endLine: 2, why: 'valid range' },
    ],
    observedRanges: new Map([
      ['src/auth.js', [{ startLine: 1, endLine: 2, source: 'read' }]],
    ]),
    observedGit: { commits: new Set(), blame: new Set() },
  });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.droppedMalformed, 3);
  assert.equal(result.droppedUngrounded, 0);
  assert.equal(result.exactEvidence, 1);
});

test('groundEvidenceList rejects unsafe and overly broad blame ranges before grounding scans', () => {
  const result = groundEvidenceList({
    evidence: [
      {
        evidenceType: 'git_blame',
        path: 'src/auth.js',
        startLine: 1e100,
        endLine: 1e100,
        sha: 'abc1234',
        why: 'unsafe integer range',
      },
      {
        evidenceType: 'git_blame',
        path: 'src/auth.js',
        startLine: 1,
        endLine: 10_001,
        sha: 'abc1234',
        why: 'range exceeds critic cap',
      },
      {
        evidenceType: 'git_blame',
        path: 'src/auth.js',
        startLine: 20,
        endLine: 20,
        sha: 'abc1234',
        why: 'valid blamed line',
      },
    ],
    observedRanges: new Map(),
    observedGit: { commits: new Set(), blame: new Set(['src/auth.js:20:abc1234']) },
  });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.droppedMalformed, 2);
  assert.equal(result.droppedUngrounded, 0);
  assert.equal(result.evidence[0].groundingStatus, 'exact');
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
    directAnswer: 'answer',
    status: { confidence: 'high', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'only observed range' },
      { path: 'src/other.js', startLine: 1, endLine: 2, why: 'not observed' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
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

  assert.notEqual(result.status.confidence, 'high');
  assert.equal(result.critic.status, 'caution');
  assert.ok(result.critic.warnings.some(w => w.type === 'dropped_evidence'));
  assert.ok(result.critic.warnings.every(w => !('citations' in w)));
  assert.equal(result.confidenceFactors.evidenceCount, 2);
  assert.equal(result.confidenceFactors.evidenceGrounded, 1);
});

test('runDeterministicCriticPass still caps overconfident locate tasks', () => {
  const normalized = {
    directAnswer: 'answer',
    status: { confidence: 'high', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'single exact locate evidence' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
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

  assert.equal(result.status.confidence, 'medium');
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

test('extractReportCitations preserves leading dot for dotfile paths', () => {
  const citations = extractReportCitations(
    'See `.github/PULL_REQUEST_TEMPLATE.md:L5` and .github/workflows/ci.yml:L10-L20 for CI rules.'
  );
  assert.deepEqual(citations.map(c => c.path), [
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/workflows/ci.yml',
  ]);
  assert.equal(citations[0].startLine, 5);
  assert.equal(citations[1].startLine, 10);
  assert.equal(citations[1].endLine, 20);
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

test('buildReportCritic counts git citations but flags them when unverified', () => {
  const critic = buildReportCritic({
    report: 'Recent history points to commit:abc1234.',
    filesRead: [],
    stats: makeStats(),
  });

  // A git citation still counts as a citation, so the report does not trip no_files_read.
  assert.ok(!critic.warnings.some(w => w.type === 'no_files_read'));
  // But an uninspected commit must not be silently accepted as grounded.
  assert.equal(critic.status, 'caution');
  assert.ok(critic.warnings.some(w => w.type === 'git_citation_gap'));
});

test('buildReportCritic flags git commit citations not observed via git tools', () => {
  const critic = buildReportCritic({
    report: 'Introduced in commit:abc1234; commit:deadbee is unrelated.',
    filesRead: [],
    observedGit: { commits: new Set(['abc1234']), blame: new Set() },
    stats: makeStats(),
  });

  const gap = critic.warnings.find(w => w.type === 'git_citation_gap');
  assert.ok(gap, 'must flag a commit citation that was not observed via a git tool');
  assert.match(gap.target, /deadbee/);
  assert.match(gap.message, /1 git citation/);
});

test('buildReportCritic does not flag git citations grounded in observed git tools', () => {
  const critic = buildReportCritic({
    report: 'Origin at blame:src/auth.js:L5 and commit:abc1234.',
    filesRead: [],
    observedGit: { commits: new Set(['abc1234']), blame: new Set(['src/auth.js:5:abc1234']) },
    stats: makeStats(),
  });

  assert.ok(!critic.warnings.some(w => w.type === 'git_citation_gap'));
});

test('buildReportCritic flags blame citations whose line was not blamed', () => {
  const critic = buildReportCritic({
    report: 'See blame:src/auth.js:L5 for the change.',
    filesRead: [],
    observedGit: { commits: new Set(), blame: new Set() },
    stats: makeStats(),
  });

  assert.ok(critic.warnings.some(w => w.type === 'git_citation_gap'));
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

test('buildReportCritic flags citations outside inspected line ranges (spec 024 FR-004)', () => {
  const critic = buildReportCritic({
    report: 'Auth at `src/auth.js:L1-L4`. Routing at `src/routes/user.js:50-60`.',
    filesRead: ['src/auth.js', 'src/routes/user.js'],
    observedRanges: new Map([
      ['src/auth.js', [{ startLine: 1, endLine: 4, source: 'read' }]],
      ['src/routes/user.js', [{ startLine: 1, endLine: 10, source: 'read' }]],
    ]),
    stats: makeStats(),
  });

  const lineGap = critic.warnings.find(warning => warning.type === 'citation_line_gap');
  assert.ok(lineGap, 'must warn when a cited range is outside inspected ranges');
  // auth.js:L1-4 is covered (1-4 read); user.js:50-60 is not (only 1-10 read).
  assert.match(lineGap.target, /user\.js/);
  assert.match(lineGap.message, /1 citation\(s\)/);
});

test('buildReportCritic does not flag citations within inspected line ranges (spec 024 FR-004)', () => {
  const critic = buildReportCritic({
    report: 'Auth at `src/auth.js:L1-L4`.',
    filesRead: ['src/auth.js'],
    observedRanges: new Map([
      ['src/auth.js', [{ startLine: 1, endLine: 10, source: 'read' }]],
    ]),
    stats: makeStats(),
  });

  assert.ok(
    !critic.warnings.some(warning => warning.type === 'citation_line_gap'),
    'a citation covered by an inspected range must not warn',
  );
});

test('buildReportCritic skips line-range grounding for paths without observed ranges (spec 024 FR-004)', () => {
  // Path read but not range-instrumented → falls back to path-level check, no line gap.
  const critic = buildReportCritic({
    report: 'Auth at `src/auth.js:L99-L120`.',
    filesRead: ['src/auth.js'],
    observedRanges: new Map(), // no ranges recorded for this path
    stats: makeStats(),
  });

  assert.ok(
    !critic.warnings.some(warning => warning.type === 'citation_line_gap'),
    'without observed ranges for the path, no line-gap warning is emitted (no false positive)',
  );
});
