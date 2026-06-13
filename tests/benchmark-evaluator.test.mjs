import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { evaluateBenchmarkCase, summarizeBenchmarkSuite } from '../src/benchmark/evaluator.mjs';

test('evaluateBenchmarkCase scores keyword expectations and checks', () => {
  const caseDefinition = {
    id: 'demo',
    passScore: 0.7,
    expectations: [
      {
        label: 'Answer groups',
        source: 'direct_answer',
        groups: [['sessionstore'], ['target paths'], ['missing-token']],
        weight: 0.6,
      },
      {
        label: 'Evidence paths',
        source: 'evidence_paths',
        groups: [['src/explorer/runtime.mjs']],
        weight: 0.2,
      },
    ],
    checks: [
      {
        label: 'Has grounded evidence',
        type: 'min_grounded_evidence_count',
        value: 1,
        weight: 0.2,
      },
    ],
  };

  const result = {
    directAnswer: 'SessionStore updates target paths after each call.',
    evidence: [
      {
        path: 'src/explorer/runtime.mjs',
        groundingStatus: 'exact',
      },
    ],
    targets: [
      { path: 'src/explorer/session.mjs', role: 'read', reason: 'session target storage', evidenceRefs: [] },
    ],
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.id, 'demo');
  assert.equal(evaluation.expectations[0].matchedCount, 2);
  assert.equal(evaluation.checks[0].passed, true);
  assert.equal(evaluation.passed, true);
  assert.ok(evaluation.score > 0.7);
});

test('summarizeBenchmarkSuite aggregates pass and average score', () => {
  const summary = summarizeBenchmarkSuite([
    { evaluation: { passed: true, score: 0.8 } },
    { evaluation: { passed: false, score: 0.4 } },
  ]);

  assert.deepEqual(summary, {
    caseCount: 2,
    passedCount: 1,
    failedCount: 1,
    averageScore: 0.6,
  });
});

test('evaluateBenchmarkCase scores adoption fields', () => {
  const caseDefinition = {
    id: 'adoption',
    passScore: 0.7,
    expectations: [
      {
        label: 'Direct answer',
        source: 'direct_answer',
        groups: [['requireauth']],
        weight: 0.25,
      },
      {
        label: 'Targets',
        source: 'target_paths',
        groups: [['src/auth.js']],
        weight: 0.25,
      },
      {
        label: 'Snippets',
        source: 'evidence_snippets',
        groups: [['export function']],
        weight: 0.25,
      },
    ],
    checks: [
      { label: 'Has direct answer', type: 'has_direct_answer', value: true, weight: 0.1 },
      { label: 'Has targets', type: 'min_target_count', value: 1, weight: 0.1 },
      { label: 'Has snippets', type: 'min_evidence_snippet_count', value: 1, weight: 0.05 },
    ],
  };

  const result = {
    directAnswer: 'requireAuth is defined in auth.js',
    targets: [{ path: 'src/auth.js', role: 'read', reason: 'definition', evidenceRefs: ['E1'] }],
    evidence: [{ path: 'src/auth.js', snippet: '1: export function requireAuth() {}' }],
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.passed, true);
});

test('evaluateBenchmarkCase checks minimum citation count', () => {
  const caseDefinition = {
    id: 'citation-count',
    checks: [
      { label: 'Citation count', type: 'min_citation_count', value: 2, weight: 1 },
    ],
  };

  const passing = evaluateBenchmarkCase(caseDefinition, {
    citations: [
      { path: 'src/explorer/runtime.mjs' },
      { path: 'src/mcp/server.mjs' },
    ],
  });
  assert.equal(passing.checks[0].actual, 2);
  assert.equal(passing.checks[0].passed, true);

  const failing = evaluateBenchmarkCase(caseDefinition, {
    citations: [
      { path: 'src/explorer/runtime.mjs' },
    ],
  });
  assert.equal(failing.checks[0].actual, 1);
  assert.equal(failing.checks[0].passed, false);

  const nullCitations = evaluateBenchmarkCase(caseDefinition, { citations: null });
  assert.equal(nullCitations.checks[0].actual, 0);
  assert.equal(nullCitations.checks[0].passed, false);

  const nonArrayCitations = evaluateBenchmarkCase(caseDefinition, { citations: 'src/explorer/runtime.mjs' });
  assert.equal(nonArrayCitations.checks[0].actual, 0);
  assert.equal(nonArrayCitations.checks[0].passed, false);
});

test('evaluateBenchmarkCase checks minimum unique citation file count', () => {
  const caseDefinition = {
    id: 'citation-file-count',
    checks: [
      { label: 'Citation files', type: 'min_citation_file_count', value: 2, weight: 1 },
    ],
  };

  const passing = evaluateBenchmarkCase(caseDefinition, {
    citations: [
      { path: 'src/explorer/runtime.mjs' },
      { path: 'src/mcp/server.mjs' },
    ],
  });
  assert.equal(passing.checks[0].actual, 2);
  assert.equal(passing.checks[0].passed, true);

  const duplicatePath = evaluateBenchmarkCase(caseDefinition, {
    citations: [
      { path: 'src/explorer/runtime.mjs' },
      { path: 'src/explorer/runtime.mjs' },
      { path: '' },
      {},
    ],
  });
  assert.equal(duplicatePath.checks[0].actual, 1);
  assert.equal(duplicatePath.checks[0].passed, false);
});

test('evaluateBenchmarkCase checks tool result truncation equality', () => {
  const expectedTruncated = {
    id: 'tool-truncated-true',
    checks: [
      { label: 'Tool results truncated', type: 'tool_results_truncated_equals', value: true, weight: 1 },
    ],
  };
  const expectedNotTruncated = {
    id: 'tool-truncated-false',
    checks: [
      { label: 'Tool results truncated', type: 'tool_results_truncated_equals', value: false, weight: 1 },
    ],
  };

  const fromCoverage = evaluateBenchmarkCase(expectedTruncated, {
    searchCoverage: { toolResultsTruncated: 1 },
  });
  assert.equal(fromCoverage.checks[0].actual, true);
  assert.equal(fromCoverage.checks[0].passed, true);

  const fromStats = evaluateBenchmarkCase(expectedTruncated, {
    stats: { toolResultsTruncated: 1 },
  });
  assert.equal(fromStats.checks[0].actual, true);
  assert.equal(fromStats.checks[0].passed, true);

  const missingSignals = evaluateBenchmarkCase(expectedNotTruncated, {});
  assert.equal(missingSignals.checks[0].actual, false);
  assert.equal(missingSignals.checks[0].passed, true);

  const unexpectedTruncation = evaluateBenchmarkCase(expectedNotTruncated, {
    searchCoverage: { toolResultsTruncated: 2 },
  });
  assert.equal(unexpectedTruncation.checks[0].actual, true);
  assert.equal(unexpectedTruncation.checks[0].passed, false);
});

test('evaluateBenchmarkCase checks citation gap warning equality', () => {
  const expectedGap = {
    id: 'citation-gap-true',
    checks: [
      { label: 'Citation gap warning', type: 'citation_gap_warning_equals', value: true, weight: 1 },
    ],
  };
  const expectedNoGap = {
    id: 'citation-gap-false',
    checks: [
      { label: 'Citation gap warning', type: 'citation_gap_warning_equals', value: false, weight: 1 },
    ],
  };

  const gapWarning = evaluateBenchmarkCase(expectedGap, {
    critic: { warnings: [{ type: 'citation_gap' }] },
  });
  assert.equal(gapWarning.checks[0].actual, true);
  assert.equal(gapWarning.checks[0].passed, true);

  const otherWarning = evaluateBenchmarkCase(expectedNoGap, {
    critic: { warnings: [{ type: 'truncation' }] },
  });
  assert.equal(otherWarning.checks[0].actual, false);
  assert.equal(otherWarning.checks[0].passed, true);

  const missingWarnings = evaluateBenchmarkCase(expectedNoGap, {});
  assert.equal(missingWarnings.checks[0].actual, false);
  assert.equal(missingWarnings.checks[0].passed, true);

  const unexpectedGap = evaluateBenchmarkCase(expectedNoGap, {
    critic: { warnings: [{ type: 'citation_gap' }] },
  });
  assert.equal(unexpectedGap.checks[0].actual, true);
  assert.equal(unexpectedGap.checks[0].passed, false);
});

test('evaluateBenchmarkCase checks critic_warning_absent — warning absent passes, present fails', () => {
  const absentCheck = {
    id: 'usage-cross-check-absent',
    checks: [
      { label: 'No usage cross-check warning', type: 'critic_warning_absent', warningType: 'usage_cross_check_missing', weight: 0.1 },
    ],
  };

  // Warning absent → pass
  const warningAbsent = evaluateBenchmarkCase(absentCheck, {});
  assert.equal(warningAbsent.checks[0].actual, true);
  assert.equal(warningAbsent.checks[0].passed, true);
  assert.equal(warningAbsent.checks[0].expected, 'usage_cross_check_missing');

  // Other warning type present → still absent → pass
  const otherWarning = evaluateBenchmarkCase(absentCheck, {
    critic: { warnings: [{ type: 'citation_gap' }] },
  });
  assert.equal(otherWarning.checks[0].actual, true);
  assert.equal(otherWarning.checks[0].passed, true);

  // Target warning present → fail
  const warningPresent = evaluateBenchmarkCase(absentCheck, {
    critic: { warnings: [{ type: 'usage_cross_check_missing' }] },
  });
  assert.equal(warningPresent.checks[0].actual, false);
  assert.equal(warningPresent.checks[0].passed, false);

  // Multiple warnings including target → fail
  const multipleWarnings = evaluateBenchmarkCase(absentCheck, {
    critic: { warnings: [{ type: 'citation_gap' }, { type: 'usage_cross_check_missing' }] },
  });
  assert.equal(multipleWarnings.checks[0].actual, false);
  assert.equal(multipleWarnings.checks[0].passed, false);

  // null/non-array warnings → absent → pass
  const nullWarnings = evaluateBenchmarkCase(absentCheck, { critic: { warnings: null } });
  assert.equal(nullWarnings.checks[0].actual, true);
  assert.equal(nullWarnings.checks[0].passed, true);
});

test('evaluateBenchmarkCase rejects removed legacy benchmark aliases', () => {
  for (const source of ['answer', 'summary', 'candidate_paths', 'confidence_level']) {
    assert.throws(
      () => evaluateBenchmarkCase({
        id: `removed-${source}`,
        expectations: [
          {
            label: source,
            source,
            groups: [['anything']],
          },
        ],
      }, {
        directAnswer: 'anything',
        candidatePaths: ['src/legacy-auth.js'],
        status: { confidence: 'high' },
      }),
      new RegExp(`Unknown benchmark source: ${source}`),
    );
  }

  assert.throws(
    () => evaluateBenchmarkCase({
      id: 'removed-min-candidate-path-count',
      checks: [
        { label: 'Candidate paths', type: 'min_candidate_path_count', value: 1 },
      ],
    }, {
      targets: [{ path: 'src/auth.js', role: 'read', reason: 'auth definition', evidenceRefs: [] }],
    }),
    /Unknown benchmark check type: min_candidate_path_count/,
  );
});

test('evaluateBenchmarkCase reads compact MCP results', () => {
  const caseDefinition = {
    id: 'compact',
    passScore: 0.9,
    expectations: [
      {
        label: 'Combined text includes compact fields',
        source: 'combined_text',
        groups: [['direct answer'], ['target reason'], ['followup']],
        weight: 0.25,
      },
      {
        label: 'Target paths come from compact targets',
        source: 'target_paths',
        groups: [['src/mcp/server.mjs']],
        weight: 0.15,
      },
      {
        label: 'Next action',
        source: 'next_action',
        groups: [['explore_followup']],
        weight: 0.15,
      },
      {
        label: 'Confidence comes from status',
        source: 'confidence',
        groups: [['high']],
        weight: 0.15,
      },
    ],
    checks: [
      { label: 'Compact targets', type: 'min_target_count', value: 1, weight: 0.1 },
    ],
  };

  const result = {
    directAnswer: 'Direct answer from compact result.',
    status: {
      confidence: 'high',
      verification: 'follow_up_needed',
      complete: false,
      warnings: [],
    },
    targets: [
      { path: 'src/mcp/server.mjs', role: 'read', reason: 'Target reason for compact output.', evidenceRefs: [] },
    ],
    evidence: [],
    nextAction: { type: 'explore_followup', reason: 'Followup needed.' },
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.passed, true);
});

test('evaluateBenchmarkCase rejects removed recentActivity benchmark sources and checks', () => {
  assert.throws(
    () => evaluateBenchmarkCase({
      id: 'removed-recent-activity-source',
      expectations: [
        {
          label: 'Hot files',
          source: 'hot_files',
          groups: [['src/mcp/server.mjs']],
        },
      ],
    }, { _debug: { recentActivity: { hotFiles: ['src/mcp/server.mjs'] } } }),
    /Unknown benchmark source: hot_files/,
  );

  assert.throws(
    () => evaluateBenchmarkCase({
      id: 'removed-recent-activity-check',
      checks: [
        { label: 'Has recent activity', type: 'has_recent_activity', value: true },
      ],
    }, { _debug: { recentActivity: { hotFiles: ['src/mcp/server.mjs'] } } }),
    /Unknown benchmark check type: has_recent_activity/,
  );

  assert.throws(
    () => evaluateBenchmarkCase({
      id: 'removed-budget-stop-check',
      checks: [
        { label: 'Budget stop', type: 'stopped_by_budget_equals', value: true },
      ],
    }, { searchCoverage: { stoppedByBudget: true } }),
    /Unknown benchmark check type: stopped_by_budget_equals/,
  );
});

test('evidence preservation benchmark suite is parseable and non-empty', async () => {
  const suiteUrl = new URL('../benchmarks/evidence-preservation.json', import.meta.url);
  const raw = await fs.readFile(suiteUrl, 'utf8');
  const suite = JSON.parse(raw);

  assert.equal(typeof suite.name, 'string');
  assert.ok(Array.isArray(suite.cases));
  assert.ok(suite.cases.length >= 1);
});

test('evaluateBenchmarkCase defaults missing evidence preservation signals safely', () => {
  const caseDefinition = {
    id: 'missing-evidence-preservation-signals',
    checks: [
      { label: 'Citation count', type: 'min_citation_count', value: 1, weight: 0.25 },
      { label: 'Citation files', type: 'min_citation_file_count', value: 1, weight: 0.25 },
      { label: 'Tool results truncated', type: 'tool_results_truncated_equals', value: false, weight: 0.25 },
      { label: 'Citation gap warning', type: 'citation_gap_warning_equals', value: false, weight: 0.25 },
    ],
  };

  const nullCitations = evaluateBenchmarkCase(caseDefinition, {
    citations: null,
  });
  assert.equal(nullCitations.checks[0].actual, 0);
  assert.equal(nullCitations.checks[0].passed, false);
  assert.equal(nullCitations.checks[1].actual, 0);
  assert.equal(nullCitations.checks[1].passed, false);
  assert.equal(nullCitations.checks[2].actual, false);
  assert.equal(nullCitations.checks[2].passed, true);
  assert.equal(nullCitations.checks[3].actual, false);
  assert.equal(nullCitations.checks[3].passed, true);

  const nonArrayCitations = evaluateBenchmarkCase(caseDefinition, {
    citations: { path: 'src/explorer/runtime.mjs' },
    critic: {},
  });
  assert.equal(nonArrayCitations.checks[0].actual, 0);
  assert.equal(nonArrayCitations.checks[1].actual, 0);
  assert.equal(nonArrayCitations.checks[2].actual, false);
  assert.equal(nonArrayCitations.checks[3].actual, false);
});
