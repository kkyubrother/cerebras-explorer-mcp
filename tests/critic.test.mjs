import test from 'node:test';
import assert from 'node:assert/strict';
import * as criticModule from '../src/explorer/critic.mjs';

import {
  buildCriticWarnings,
  deriveTaskKindFromTaskMode,
  groundEvidenceList,
  runDeterministicCriticPass,
} from '../src/explorer/critic.mjs';

function makeStats(overrides = {}) {
  return {
    grepCalls: 0,
    symbolCalls: 0,
    safetyLimits: [],
    gitLogCalls: 0,
    gitDiffCalls: 0,
    gitBlameCalls: 0,
    ...overrides,
  };
}

test('deriveTaskKindFromTaskMode preserves runtime-owned locate classification', () => {
  assert.equal(deriveTaskKindFromTaskMode('locate'), 'locate');
  assert.equal(deriveTaskKindFromTaskMode('symbol_trace'), 'locate');
  assert.equal(deriveTaskKindFromTaskMode('edit_planning'), 'default');
  assert.equal(deriveTaskKindFromTaskMode(), 'default');
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
    stats: makeStats(),
  });

  assert.ok(warnings.length <= 3, 'default warning list must stay compact');
  assert.ok(warnings.every(w => w.message && w.action), 'warnings need reason and action');
  assert.ok(warnings.some(w => w.type === 'confidence_downgraded'));
});

test('Spec 028 T013 — critic reports only goal-affecting safety limits', () => {
  const base = {
    grounding: { droppedMalformed: 0, droppedUngrounded: 0, partialEvidence: 0 },
    confidence: { modelConfidence: 'high', finalConfidence: 'high' },
  };
  const operationalOnly = buildCriticWarnings({
    ...base,
    stats: makeStats({
      safetyLimits: [{
        name: 'context_limit',
        stage: 'exploration',
        affectedSubgoalIds: [],
        truncated: true,
      }],
    }),
  });
  const affected = buildCriticWarnings({
    ...base,
    stats: makeStats({
      safetyLimits: [{
        name: 'tool_result_limit',
        stage: 'exploration',
        affectedSubgoalIds: ['S1'],
        truncated: true,
      }],
    }),
  });

  assert.equal(operationalOnly.some(warning => warning.type === 'safety_limit_reached'), false);
  const warning = affected.find(item => item.type === 'safety_limit_reached');
  assert.ok(warning);
  assert.match(warning.message, /tool_result_limit/);
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

// ── spec 026 US1 — usage cross-check gate ────────────────────────────────────

test('spec 026 T002-①: buildCriticWarnings emits usage_cross_check_missing when required and not observed', () => {
  const warnings = buildCriticWarnings({
    grounding: { droppedMalformed: 0, droppedUngrounded: 0 },
    confidence: { modelConfidence: 'high', finalConfidence: 'high' },
    stats: makeStats(),
    usageCrossCheck: { required: true, observed: false, symbol: 'mySym' },
  });

  const w = warnings.find(w => w.type === 'usage_cross_check_missing');
  assert.ok(w, 'must emit usage_cross_check_missing warning');
  assert.equal(w.severity, 'medium');
  assert.ok(w.message.includes('mySym'), `message must include symbol, got: ${w.message}`);
  assert.equal(w.target, 'mySym');
  assert.ok(w.action, 'action must be present');
  // action must NOT imply searching outside scope
  assert.ok(
    !w.action.toLowerCase().includes('outside') && !w.action.toLowerCase().includes('global') && !w.action.toLowerCase().includes('entire repo'),
    `action must not imply searching outside scope, got: ${w.action}`,
  );
  assert.ok(w.action.toLowerCase().includes('grep'), 'action should suggest a grep follow-up');
  assert.ok(
    !w.action.toLowerCase().includes('repo_grep'),
    `action must not expose internal repo_grep tool name, got: ${w.action}`,
  );
  assert.equal(warnings.filter(w => w.type === 'usage_cross_check_missing').length, 1, 'exactly one warning');
});

test('spec 026 T002-②: warning cap — usage_cross_check_missing precedes confidence_downgraded', () => {
  // droppedMalformed triggers dropped_evidence (medium), usageCrossCheck fires (medium),
  // confidence_downgraded and an affected safety limit also fire → 4 medium warnings,
  // slice(0,3) keeps first 3. The new warning must be pushed BEFORE confidence_downgraded.
  const warnings = buildCriticWarnings({
    grounding: { droppedMalformed: 2, droppedUngrounded: 0 },
    confidence: { modelConfidence: 'high', finalConfidence: 'medium' },
    stats: makeStats({
      safetyLimits: [{
        name: 'turn_limit',
        stage: 'exploration',
        affectedSubgoalIds: ['S1'],
        truncated: false,
      }],
    }),
    usageCrossCheck: { required: true, observed: false, symbol: 'mySym' },
  });

  assert.ok(warnings.length <= 3, 'must not exceed the 3-warning cap');
  assert.ok(warnings.some(w => w.type === 'safety_limit_reached'),
    'a goal-affecting safety limit must survive the warning cap');
  const crossCheckIdx = warnings.findIndex(w => w.type === 'usage_cross_check_missing');
  const downgradedIdx = warnings.findIndex(w => w.type === 'confidence_downgraded');
  assert.ok(crossCheckIdx !== -1, 'usage_cross_check_missing must fit within the warning cap');
  // If confidence_downgraded is also present, cross_check must come before it
  if (downgradedIdx !== -1) {
    assert.ok(crossCheckIdx < downgradedIdx, 'usage_cross_check_missing must precede confidence_downgraded');
  }
});

test('spec 026 T002-③a: buildCriticWarnings with observed:true emits no usage_cross_check_missing', () => {
  const warnings = buildCriticWarnings({
    grounding: { droppedMalformed: 0, droppedUngrounded: 0 },
    confidence: { modelConfidence: 'high', finalConfidence: 'high' },
    stats: makeStats(),
    usageCrossCheck: { required: true, observed: true, symbol: 'mySym' },
  });

  assert.ok(!warnings.some(w => w.type === 'usage_cross_check_missing'), 'observed:true must not emit warning');
});

test('spec 026 T002-③b: buildCriticWarnings with omitted usageCrossCheck (old signature) emits no usage_cross_check_missing', () => {
  // This is exactly the existing :208 test signature — must stay green unmodified.
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
    stats: makeStats(),
  });

  assert.ok(!warnings.some(w => w.type === 'usage_cross_check_missing'), 'omitted param must not fire gate');
  assert.ok(warnings.length <= 3, 'default warning list must stay compact');
  assert.ok(warnings.every(w => w.message && w.action), 'warnings need reason and action');
  assert.ok(warnings.some(w => w.type === 'confidence_downgraded'));
});

test('spec 026 T002-④a: runDeterministicCriticPass with gate-fail caps finalConfidence to medium (not low)', () => {
  const normalized = {
    directAnswer: 'answer',
    status: { confidence: 'high', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'symbol definition' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
    stats: makeStats(),
  };
  const observedRanges = new Map([
    ['src/auth.js', [{ startLine: 1, endLine: 4, source: 'read' }]],
  ]);

  const { result, confidence } = runDeterministicCriticPass({
    normalized,
    observedRanges,
    observedGit: { commits: new Set(), blame: new Set() },
    stats: makeStats(),
    taskKind: 'locate',
    usageCrossCheck: { required: true, observed: false, symbol: 'mySym' },
  });

  // modelConfidence should remain 'high' (as evaluated), finalConfidence capped to medium
  assert.equal(confidence.modelConfidence, 'high', 'modelConfidence must be preserved');
  assert.equal(result.status.confidence, 'medium', 'finalConfidence must be capped to medium');
  assert.notEqual(result.status.confidence, 'low', 'must never cap to low');
  // confidence_downgraded warning fires automatically because model!=final
  assert.ok(result.critic.warnings.some(w => w.type === 'confidence_downgraded'), 'confidence_downgraded must fire');
  // usage_cross_check_missing must also be present
  assert.ok(result.critic.warnings.some(w => w.type === 'usage_cross_check_missing'), 'usage_cross_check_missing must be present');
});

test('spec 026 T002-④b: runDeterministicCriticPass with gate-pass leaves confidence unchanged', () => {
  const normalized = {
    directAnswer: 'answer',
    status: { confidence: 'high', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'symbol definition' },
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
    usageCrossCheck: { required: true, observed: true, symbol: 'mySym' },
  });

  // gate-pass: no usage_cross_check_missing warning; confidence can be whatever evaluateConfidence returns
  assert.ok(!result.critic.warnings.some(w => w.type === 'usage_cross_check_missing'), 'gate-pass must not emit warning');
});

// ── spec 026 precedence-route suppression tests ───────────────────────────────

test('spec 026 T002-⑤a: runDeterministicCriticPass with stoppedByAbort emits NO usage_cross_check_missing and NO gate cap', () => {
  // stoppedByAbort is a precedence route — critic must NOT warn or cap on it.
  // Set up two files so evaluateConfidence reaches 'high' (cross-verified + exactCount >= 1 + locate base).
  // taskKind:'locate' (base=0.45) + exactCount=1 (+0.18) + cross-verified (+0.12) = 0.75 → 'high'
  const normalized = {
    directAnswer: 'Exploration aborted.',
    status: { confidence: 'high', verification: 'verified', complete: false, warnings: [] },
    targets: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'symbol definition', evidenceType: 'file_range' },
      { path: 'src/other.js', startLine: 5, endLine: 8, why: 'usage site', evidenceType: 'file_range' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Aborted.' },
  };
  const observedRanges = new Map([
    ['src/auth.js', [{ startLine: 1, endLine: 4, source: 'read' }]],
    ['src/other.js', [{ startLine: 5, endLine: 8, source: 'read' }]],
  ]);
  const statsAbort = makeStats({ stoppedByAbort: true });

  // Baseline: same inputs WITHOUT stoppedByAbort — gate WOULD cap high→medium
  const { confidence: baselineConf } = runDeterministicCriticPass({
    normalized,
    observedRanges,
    observedGit: { commits: new Set(), blame: new Set() },
    stats: makeStats(),
    taskKind: 'locate',
    usageCrossCheck: { required: true, observed: false, symbol: 'mySym' },
  });
  // Sanity check: without abort, gate caps high→medium
  assert.equal(baselineConf.finalConfidence, 'medium', 'baseline (no abort): gate must cap high→medium');

  // Now test with stoppedByAbort — gate must be suppressed
  const { result, confidence } = runDeterministicCriticPass({
    normalized,
    observedRanges,
    observedGit: { commits: new Set(), blame: new Set() },
    stats: statsAbort,
    taskKind: 'locate',
    usageCrossCheck: { required: true, observed: false, symbol: 'mySym' },
  });

  assert.ok(
    !result.critic.warnings.some(w => w.type === 'usage_cross_check_missing'),
    'stoppedByAbort route must NOT emit usage_cross_check_missing',
  );
  // Gate cap must NOT be applied: evaluateConfidence returns 'high', so finalConfidence stays 'high'
  assert.equal(
    confidence.finalConfidence,
    'high',
    `stoppedByAbort: gate must not cap confidence — expected high (gate suppressed), got ${confidence.finalConfidence}`,
  );
});

test('spec 026 T002-⑤b: runDeterministicCriticPass when all evidence is dropped emits NO usage_cross_check_missing and NO gate cap', () => {
  // All evidence items are ungrounded → grounding.evidence becomes [] → precedence route
  const normalized = {
    directAnswer: 'Answer with ungrounded evidence.',
    status: { confidence: 'high', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [
      // These items won't have matching observed ranges → droppedUngrounded
      { path: 'src/missing.js', startLine: 10, endLine: 20, why: 'ungrounded claim' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
  };
  // Empty observedRanges → no range covers the evidence → all dropped
  const observedRanges = new Map();

  const { result, confidence } = runDeterministicCriticPass({
    normalized,
    observedRanges,
    observedGit: { commits: new Set(), blame: new Set() },
    stats: makeStats(),
    taskKind: 'symbol_trace',
    usageCrossCheck: { required: true, observed: false, symbol: 'mySym' },
  });

  // After dropping, grounding.evidence.length === 0 → precedence route
  assert.ok(
    !result.critic.warnings.some(w => w.type === 'usage_cross_check_missing'),
    'all-evidence-dropped route must NOT emit usage_cross_check_missing',
  );
  // Gate cap must NOT be applied when evidence is all dropped — finalConfidence must be 'low'
  assert.equal(
    confidence.finalConfidence,
    'low',
    `gate must not cap confidence when evidence is all dropped — expected low, got ${confidence.finalConfidence}`,
  );
});

test('spec 026 T002-⑤c: runDeterministicCriticPass when finalConfidence is low emits NO usage_cross_check_missing and confidence stays low', () => {
  // When evaluateConfidence produces 'low', it is already a precedence route —
  // gate must not warn (no double warning) and must not cap (low→medium violates FR-003 intent
  // since 'low' already maps to follow_up_needed in buildResultStatus).
  const normalized = {
    directAnswer: 'Very sparse answer.',
    // modelConfidence 'low' → evaluateConfidence will return 'low' as final
    status: { confidence: 'low', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'symbol definition' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
  };
  const observedRanges = new Map([
    ['src/auth.js', [{ startLine: 1, endLine: 4, source: 'read' }]],
  ]);

  const { result, confidence } = runDeterministicCriticPass({
    normalized,
    observedRanges,
    observedGit: { commits: new Set(), blame: new Set() },
    stats: makeStats(),
    taskKind: 'symbol_trace',
    usageCrossCheck: { required: true, observed: false, symbol: 'mySym' },
  });

  assert.ok(
    !result.critic.warnings.some(w => w.type === 'usage_cross_check_missing'),
    'low-confidence route must NOT emit usage_cross_check_missing',
  );
  // confidence must remain 'low' — gate must not upgrade it or suppress it
  assert.equal(
    confidence.finalConfidence,
    'low',
    `low-confidence route: finalConfidence must stay low, got ${confidence.finalConfidence}`,
  );
});

// spec 026 status-level invariant: 'usage_cross_check_missing' must never appear on a
// critic 'fail' result — the precedence route (stoppedByErrors) suppresses the gate.
test('spec 026 invariant: usage_cross_check_missing must be absent from critic fail (tool_errors) results', () => {
  // Build a result via the tool_errors path: stoppedByErrors → gateSuppressed → no gate warning.
  const normalized = {
    directAnswer: 'Stopped by errors.',
    status: { confidence: 'high', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: 'symbol definition' }],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
  };
  const observedRanges = new Map([
    ['src/auth.js', [{ startLine: 1, endLine: 4, source: 'read' }]],
  ]);

  const { result } = runDeterministicCriticPass({
    normalized,
    observedRanges,
    observedGit: { commits: new Set(), blame: new Set() },
    stats: makeStats({ stoppedByErrors: true }),
    taskKind: 'symbol_trace',
    usageCrossCheck: { required: true, observed: false, symbol: 'mySym' },
  });

  // Invariant: critic fail path must never carry usage_cross_check_missing
  assert.equal(result.critic.status, 'fail', 'stoppedByErrors must produce critic fail');
  assert.ok(
    !result.critic.warnings.some(w => w.type === 'usage_cross_check_missing'),
    'usage_cross_check_missing must be absent on critic fail (tool_errors) path',
  );
});

const claimEvidenceGateTest = test;

function atomicClaim({
  id = 'C1',
  text = 'The current runtime enables authentication.',
  evidenceRefs = ['E1'],
} = {}) {
  return {
    id,
    subgoalId: 'S1',
    text,
    evidenceRefs,
    verdict: 'pending',
  };
}

function semanticVerdict(result = 'supported', {
  claimId = 'C1',
  supportingEvidenceRefs = ['E1'],
  reasonCode = result === 'supported' ? 'entailed' : 'semantic_mismatch',
  resolution = result === 'supported' ? 'affirmed' : null,
} = {}) {
  return {
    claimId,
    result,
    supportingEvidenceRefs,
    reasonCode,
    note: 'Isolated verifier result.',
    ...(resolution ? { resolution } : {}),
  };
}

function sourceObservation(id = 'E1', overrides = {}) {
  return {
    id,
    kind: 'source',
    path: `src/source-${id}.mjs`,
    startLine: 1,
    endLine: 1,
    snippet: 'export const authenticationEnabled = true;',
    rangeGrounding: 'exact',
    sourceRole: 'implementation',
    temporalRole: 'current',
    redacted: false,
    ...overrides,
  };
}

function gitObservation(id = 'E1') {
  return {
    id,
    kind: 'git_commit',
    sha: 'abc1234',
    content: 'Authentication was introduced in this observed commit.',
    temporalRole: 'historical',
  };
}

function applyClaimEvidenceGate(input) {
  assert.equal(typeof criticModule.applyClaimEvidenceGate, 'function');
  return criticModule.applyClaimEvidenceGate(input);
}

claimEvidenceGateTest('Spec 028 T025 — only exact reconstructed observations preserve support', () => {
  const claim = atomicClaim();
  const verdict = semanticVerdict();
  const exact = sourceObservation();
  assert.deepEqual(applyClaimEvidenceGate({
    claim,
    semanticVerdict: verdict,
    observations: [exact],
  }), verdict);

  const missingSourceRole = { ...exact };
  const missingTemporalRole = { ...exact };
  delete missingSourceRole.sourceRole;
  delete missingTemporalRole.temporalRole;
  const invalidObservations = [
    { ...exact, rangeGrounding: 'partial' },
    { ...exact, snippet: '' },
    missingSourceRole,
    missingTemporalRole,
  ];
  for (const observation of invalidObservations) {
    const effective = applyClaimEvidenceGate({
      claim,
      semanticVerdict: verdict,
      observations: [observation],
    });
    assert.equal(effective.result, 'insufficient');
    assert.equal(effective.reasonCode, 'boundary_mismatch');
    assert.deepEqual(effective.supportingEvidenceRefs, []);
    assert.equal(effective.resolution, undefined);
  }
});

claimEvidenceGateTest('Spec 028 T025 — explicit source roles inform but never replace semantic verification', () => {
  const roles = ['documentation', 'test', 'fixture'];
  for (const sourceRole of roles) {
    const observations = [sourceObservation('E1', { sourceRole })];
    const roleClaim = atomicClaim({
      text: `The observed ${sourceRole} source states authentication is enabled.`,
    });
    const supported = semanticVerdict();
    assert.deepEqual(applyClaimEvidenceGate({
      claim: roleClaim,
      semanticVerdict: supported,
      observations,
    }), supported, 'a claim about the source itself may use its matching role');

    const mismatch = semanticVerdict('insufficient', {
      reasonCode: 'semantic_mismatch',
    });
    assert.deepEqual(applyClaimEvidenceGate({
      claim: atomicClaim(),
      semanticVerdict: mismatch,
      observations,
    }), mismatch, 'the same source role cannot be promoted into current behavior proof');
  }
});

claimEvidenceGateTest('Spec 028 T025 — temporal provenance cannot be rewritten into current behavior', () => {
  const currentClaim = atomicClaim();
  const currentVerdict = semanticVerdict();
  assert.deepEqual(applyClaimEvidenceGate({
    claim: currentClaim,
    semanticVerdict: currentVerdict,
    observations: [sourceObservation()],
  }), currentVerdict);

  const historyClaim = atomicClaim({
    text: 'The observed commit introduced authentication.',
  });
  const historyVerdict = semanticVerdict();
  assert.deepEqual(applyClaimEvidenceGate({
    claim: historyClaim,
    semanticVerdict: historyVerdict,
    observations: [gitObservation()],
  }), historyVerdict);

  const temporalMismatch = semanticVerdict('insufficient', {
    reasonCode: 'boundary_mismatch',
  });
  assert.deepEqual(applyClaimEvidenceGate({
    claim: currentClaim,
    semanticVerdict: temporalMismatch,
    observations: [gitObservation()],
  }), temporalMismatch);
});

claimEvidenceGateTest('Spec 028 T025 — exact evidence count cannot override semantic mismatch', () => {
  const claim = atomicClaim({ evidenceRefs: ['E1', 'E2'] });
  const verdict = semanticVerdict('insufficient', {
    supportingEvidenceRefs: ['E1', 'E2'],
    reasonCode: 'semantic_mismatch',
  });
  const input = {
    claim,
    semanticVerdict: verdict,
    observations: [sourceObservation('E1'), sourceObservation('E2')],
  };
  const snapshot = structuredClone(input);

  assert.deepEqual(applyClaimEvidenceGate(input), verdict);
  assert.deepEqual(input, snapshot);
});

claimEvidenceGateTest('Spec 028 T025 — cross-file evidence cannot outvote an overgeneralized verdict', () => {
  const claim = atomicClaim({
    text: 'Every registered route applies both authentication policies.',
    evidenceRefs: ['E1', 'E2'],
  });
  const verdict = semanticVerdict('insufficient', {
    supportingEvidenceRefs: ['E1'],
    reasonCode: 'overgeneralized',
  });
  const observations = [
    sourceObservation('E1', { path: 'src/routes/admin.mjs' }),
    sourceObservation('E2', { path: 'src/routes/user.mjs' }),
  ];
  const forward = applyClaimEvidenceGate({ claim, semanticVerdict: verdict, observations });
  const reversed = applyClaimEvidenceGate({
    claim,
    semanticVerdict: verdict,
    observations: [...observations].reverse(),
  });

  assert.deepEqual(forward, verdict);
  assert.deepEqual(reversed, verdict);
});

// T061 introduces the combined downgrade-only proof gate. Until the export is
// present these remain visible test-first TODOs. A stub export activates every
// assertion and therefore cannot make a partial implementation look complete.
const T061_CRITIC_PROOF_EXPORTS = ['applyClaimProofPolicyGate'];

function proofPolicyCriticTest(name, callback) {
  const present = T061_CRITIC_PROOF_EXPORTS.filter(
    exportName => typeof criticModule[exportName] === 'function',
  );
  if (present.length === 0) {
    test.todo(name);
    return;
  }
  test(name, () => {
    const capabilities = {};
    for (const exportName of T061_CRITIC_PROOF_EXPORTS) {
      assert.equal(
        typeof criticModule[exportName],
        'function',
        `T061 partially implemented the critic proof surface: ${exportName} is missing`,
      );
      capabilities[exportName] = criticModule[exportName];
    }
    return callback(capabilities);
  });
}

function t057Subgoal(overrides = {}) {
  return {
    id: 'S1',
    claimType: 'positive',
    proofPolicy: 'direct_source',
    constraints: ['boundary:src/**'],
    ...overrides,
  };
}

function t057RoleRequirement(overrides = {}) {
  return {
    observationKinds: ['source'],
    sourceRoles: ['implementation', 'config'],
    temporalRole: 'current',
    ...overrides,
  };
}

function t057GateInput(overrides = {}) {
  return {
    subgoal: t057Subgoal(),
    claim: atomicClaim(),
    semanticVerdict: semanticVerdict(),
    observations: [sourceObservation()],
    proofPolicyResult: { passed: true, reason: null },
    roleRequirement: t057RoleRequirement(),
    ...overrides,
  };
}

function assertProofDowngrade(result, label) {
  assert.equal(result.result, 'insufficient', label);
  assert.deepEqual(result.supportingEvidenceRefs, [], `${label}: evidence refs must be cleared`);
  assert.equal(result.resolution, undefined, `${label}: support resolution must be removed`);
  assert.equal(typeof result.reasonCode, 'string', `${label}: a stable reason code is required`);
  assert.ok(result.reasonCode.length > 0);
}

proofPolicyCriticTest(
  'Spec 028 T057 — current behavior requires a runtime-declared current implementation/config role',
  ({ applyClaimProofPolicyGate }) => {
    const validRoles = ['implementation', 'config'];
    for (const sourceRole of validRoles) {
      const verdict = semanticVerdict();
      assert.deepEqual(applyClaimProofPolicyGate(t057GateInput({
        semanticVerdict: verdict,
        observations: [sourceObservation('E1', { sourceRole })],
      })), verdict, sourceRole);
    }

    for (const sourceRole of ['test', 'documentation', 'fixture', 'generated', 'unknown']) {
      const downgraded = applyClaimProofPolicyGate(t057GateInput({
        observations: [sourceObservation('E1', { sourceRole })],
      }));
      assertProofDowngrade(downgraded, sourceRole);
    }

    const documentationVerdict = semanticVerdict();
    assert.deepEqual(applyClaimProofPolicyGate(t057GateInput({
      claim: atomicClaim({ text: 'This document states that authentication is enabled.' }),
      semanticVerdict: documentationVerdict,
      observations: [sourceObservation('E1', { sourceRole: 'documentation' })],
      roleRequirement: t057RoleRequirement({ sourceRoles: ['documentation'] }),
    })), documentationVerdict,
    'a claim specifically about documentation may use documentation as primary evidence');
  },
);

proofPolicyCriticTest(
  'Spec 028 T057 — temporal role is explicit and historical evidence cannot prove current behavior',
  ({ applyClaimProofPolicyGate }) => {
    const historicalVerdict = semanticVerdict();
    assert.deepEqual(applyClaimProofPolicyGate(t057GateInput({
      claim: atomicClaim({ text: 'The observed commit introduced authentication.' }),
      semanticVerdict: historicalVerdict,
      observations: [gitObservation()],
      roleRequirement: {
        observationKinds: ['git_commit'],
        sourceRoles: [],
        temporalRole: 'historical',
      },
    })), historicalVerdict);

    const wrongTime = applyClaimProofPolicyGate(t057GateInput({
      observations: [gitObservation()],
      roleRequirement: {
        observationKinds: ['git_commit'],
        sourceRoles: [],
        temporalRole: 'current',
      },
    }));
    assertProofDowngrade(wrongTime, 'historical evidence for a current claim');

    const sourceMarkedHistorical = applyClaimProofPolicyGate(t057GateInput({
      observations: [sourceObservation('E1', { temporalRole: 'historical' })],
    }));
    assertProofDowngrade(sourceMarkedHistorical, 'historical source observation');
  },
);

proofPolicyCriticTest(
  'Spec 028 T057 — role gates use structured requirements rather than claim-language keywords',
  ({ applyClaimProofPolicyGate }) => {
    const texts = [
      'Current authentication behavior is enabled.',
      '현재 인증 동작이 활성화되어 있다.',
      '現在の認証動作は有効です。',
      'opaque-fact-token',
    ];
    const outcomes = texts.map(text => applyClaimProofPolicyGate(t057GateInput({
      claim: atomicClaim({ text }),
      observations: [sourceObservation('E1', { sourceRole: 'documentation' })],
    })));

    assert.ok(outcomes.every(result => result.result === 'insufficient'));
    assert.deepEqual(
      outcomes.map(result => result.reasonCode),
      outcomes.map(() => outcomes[0].reasonCode),
    );
  },
);

proofPolicyCriticTest(
  'Spec 028 T057 — only a proof-policy-approved supported refutation resolves the premise',
  ({ applyClaimProofPolicyGate }) => {
    const refutation = semanticVerdict('supported', { resolution: 'refuted' });
    const input = t057GateInput({
      subgoal: t057Subgoal({
        claimType: 'claim_verification',
        proofPolicy: 'support_or_refute',
      }),
      claim: atomicClaim({
        text: 'The supplied registration premise is refuted within src/**.',
      }),
      semanticVerdict: refutation,
    });
    const snapshot = structuredClone(input);

    assert.deepEqual(applyClaimProofPolicyGate(input), refutation);
    assert.deepEqual(input, snapshot, 'the combined critic gate must be downgrade-only and pure');

    const uncertified = applyClaimProofPolicyGate({
      ...input,
      proofPolicyResult: { passed: false, reason: 'incomplete_enumeration' },
    });
    assertProofDowngrade(uncertified, 'uncertified supported refutation');

    const contradiction = semanticVerdict('contradicted', {
      supportingEvidenceRefs: [],
      resolution: null,
      reasonCode: 'contradiction',
    });
    assert.deepEqual(applyClaimProofPolicyGate({
      ...input,
      semanticVerdict: contradiction,
    }), contradiction,
    'candidate contradiction remains unresolved and is never promoted to refuted support');
  },
);

proofPolicyCriticTest(
  'Spec 028 T061 — proof bindings and search provenance fail closed',
  ({ applyClaimProofPolicyGate }) => {
    const allowedReasonCodes = new Set([
      'entailed', 'semantic_mismatch', 'overgeneralized', 'missing_transition',
      'missing_category', 'boundary_mismatch', 'contradiction', 'uncovered_request',
    ]);
    const mismatchedBinding = applyClaimProofPolicyGate(t057GateInput({
      proofPolicyResult: {
        passed: true,
        reason: null,
        subgoalId: 'S-other',
        claimId: 'C1',
        proofPolicy: 'direct_source',
      },
    }));
    assertProofDowngrade(mismatchedBinding, 'proof result reused across sub-goals');
    assert.ok(allowedReasonCodes.has(mismatchedBinding.reasonCode));

    const searchClaim = atomicClaim({ evidenceRefs: ['Q1'] });
    const searchVerdict = semanticVerdict('supported', { supportingEvidenceRefs: ['Q1'] });
    const currentSearchRequirement = {
      observationKinds: ['search'],
      sourceRoles: [],
      temporalRole: 'current',
    };
    const gitSearch = t057GateInput({
      claim: searchClaim,
      semanticVerdict: searchVerdict,
      observations: [{
        id: 'Q1',
        kind: 'search',
        tool: 'repo_git_log',
        boundary: ['src/auth.js'],
        matchCount: 1,
        toolTruncated: false,
        contextTruncated: false,
        omittedOutOfScopeFiles: 0,
        deniedPaths: 0,
        errors: 0,
        enumerationComplete: true,
      }],
      roleRequirement: currentSearchRequirement,
    });
    assertProofDowngrade(applyClaimProofPolicyGate(gitSearch),
      'historical git search used as current evidence');

    assertProofDowngrade(applyClaimProofPolicyGate({
      ...gitSearch,
      observations: [{
        ...gitSearch.observations[0],
        tool: 'repo_grep',
        boundary: [],
        errors: -1,
      }],
    }), 'malformed search telemetry');
  },
);
