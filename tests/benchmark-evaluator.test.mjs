import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

import {
  evaluateBenchmarkCase,
  evaluateKnownBadBaseline,
  summarizeBenchmarkSuite,
} from '../src/benchmark/evaluator.mjs';

const TRUST_MANIFEST_URL = new URL('../benchmarks/trust-known-answer.json', import.meta.url);
const BASELINE_RESULTS_URL = new URL('../fixtures/trust-known-answer/baseline-results/', import.meta.url);

const EXPECTED_KNOWN_BAD_VIOLATIONS = {
  'obs-deny-list-count-range': ['FORBIDDEN_CLAIM_PRESENT'],
  'obs-large-route-ui-api-mismatch': ['REQUIRED_GOAL_UNSUPPORTED:G1'],
  'obs-route-admin-divergence': [
    'REQUIRED_GOAL_UNSUPPORTED:G2',
    'REQUIRED_GOAL_UNSUPPORTED:G3',
  ],
  'obs-external-process-inference': ['DOCUMENTED_TRUST_FAILURE'],
  'obs-repeat-tests-environment': [
    'REQUIRED_GOAL_UNSUPPORTED:G2',
    'REQUIRED_GOAL_UNSUPPORTED:G3',
  ],
  'obs-aws-inventory-classification': ['REQUIRED_GOAL_UNSUPPORTED:G1'],
  'fx-jsonrpc-id-zero-cancellation': [
    'EXPECTED_STATE_MISMATCH',
    'REQUEST_NOT_ABORTED',
  ],
};

async function loadTrustManifest() {
  return JSON.parse(await fs.readFile(TRUST_MANIFEST_URL, 'utf8'));
}

function artifactDefinitionForCase(manifest, caseDefinition) {
  const baselineRef = caseDefinition.schemaV2Baseline?.baselineRef;
  if (baselineRef) {
    return { kind: 'baseline', definition: manifest.baselines[baselineRef] };
  }
  const observationRef = caseDefinition.knownBadObservationRef;
  if (observationRef) {
    return { kind: 'observation', definition: manifest.observations[observationRef] };
  }
  return null;
}

async function loadKnownBadEntries() {
  const manifest = await loadTrustManifest();
  const entries = [];
  for (const caseDefinition of manifest.cases) {
    const artifactDefinition = artifactDefinitionForCase(manifest, caseDefinition);
    if (!artifactDefinition) continue;
    const artifactUrl = new URL('../' + artifactDefinition.definition.artifact, import.meta.url);
    const rawArtifact = await fs.readFile(artifactUrl, 'utf8');
    entries.push({
      caseDefinition,
      ...artifactDefinition,
      rawArtifact,
      artifact: JSON.parse(rawArtifact),
    });
  }
  return { manifest, entries };
}

function canonicalSha256(rawText) {
  return createHash('sha256')
    .update(rawText.replace(/\r\n?/g, '\n'))
    .digest('hex');
}

function knownBadViolationKeys(evaluation) {
  return evaluation.violations.map(violation =>
    violation.goalId ? violation.code + ':' + violation.goalId : violation.code
  );
}

function buildCorrectedArtifact(caseDefinition, knownBadArtifact) {
  if (knownBadArtifact.transport && !knownBadArtifact.parentPayload) {
    return {
      transport: {
        ...knownBadArtifact.transport,
        abortObserved: true,
        outcome: 'aborted',
      },
    };
  }

  const expectedState = caseDefinition.oracle.expectedState;
  const directAnswer = caseDefinition.oracle.allowedClaims
    .map(claim => claim.text)
    .join(' ') || 'The requested conclusion remains unresolved.';
  return {
    parentPayload: {
      content: [{ type: 'text', text: directAnswer }],
      structuredContent: {
        schemaVersion: 2,
        directAnswer,
        status: {
          confidence: 'high',
          verification: expectedState === 'complete' ? 'verified' : 'follow_up_needed',
          complete: expectedState === 'complete',
          warnings: [],
        },
        evidence: caseDefinition.oracle.evidenceAnchors.map(anchor => ({
          id: anchor.id,
          path: anchor.path,
          startLine: anchor.startLine,
          endLine: anchor.endLine,
          why: 'Independent corrected control.',
          evidenceType: 'file_range',
          groundingStatus: 'exact',
        })),
        failure: expectedState === 'failed' ? { reason: 'aborted' } : null,
      },
    },
  };
}

test('known-bad artifact registry is set-equal, immutable, and hash-pinned', async () => {
  const { manifest, entries } = await loadKnownBadEntries();
  const registeredFiles = entries
    .map(entry => entry.definition.artifact.split('/').at(-1))
    .sort();
  const directoryFiles = (await fs.readdir(BASELINE_RESULTS_URL))
    .filter(name => name.endsWith('.json'))
    .sort();

  assert.deepEqual(registeredFiles, directoryFiles);
  assert.equal(
    entries.filter(entry => entry.kind === 'baseline').length,
    Object.keys(manifest.baselines).length,
  );
  assert.equal(
    entries.filter(entry => entry.kind === 'observation').length,
    Object.keys(manifest.observations).length,
  );
  assert.equal(entries.length, 7);

  for (const entry of entries) {
    const { artifact, caseDefinition, definition, rawArtifact } = entry;
    assert.equal(
      definition.artifact.startsWith('fixtures/trust-known-answer/baseline-results/'),
      true,
    );
    assert.equal(artifact.caseId, caseDefinition.id);
    assert.equal(artifact.immutable, true);
    assert.equal(artifact.oracle, undefined, 'the observed artifact must not contain its oracle');
    assert.equal(canonicalSha256(rawArtifact), definition.artifactSha256);

    if (artifact.parentPayload) {
      const contentBytes = Buffer.byteLength(JSON.stringify(artifact.parentPayload.content));
      const structuredContentBytes = Buffer.byteLength(
        JSON.stringify(artifact.parentPayload.structuredContent),
      );
      assert.deepEqual(artifact.measurement, {
        encoding: 'utf8',
        formula: 'byteLength(JSON.stringify(content)) + byteLength(JSON.stringify(structuredContent))',
        contentBytes,
        structuredContentBytes,
        parentPayloadBytes: contentBytes + structuredContentBytes,
      });
      assert.equal(definition.contentBytes, contentBytes);
      assert.equal(definition.structuredContentBytes, structuredContentBytes);
      assert.equal(definition.parentPayloadBytes, contentBytes + structuredContentBytes);
    } else if (artifact.transport) {
      assert.equal(definition.outcome, 'no_response');
      assert.equal(artifact.measurement.parentPayloadBytes, 0);
    } else {
      assert.equal(entry.kind, 'observation');
      assert.equal(artifact.recordType, 'documented_known_bad_observation');
      assert.equal(artifact.source.rawParentPayloadPreserved, false);
      assert.equal(artifact.measurement, undefined);
    }
  }
});

test('manifest oracles reject every immutable known-bad artifact', async t => {
  const { entries } = await loadKnownBadEntries();
  for (const entry of entries) {
    await t.test(entry.caseDefinition.id, () => {
      const evaluation = evaluateKnownBadBaseline(
        entry.caseDefinition.oracle,
        entry.artifact,
      );
      assert.equal(evaluation.passed, false);
      assert.notEqual(evaluation.observedState, 'invalid');
      assert.deepEqual(
        knownBadViolationKeys(evaluation),
        EXPECTED_KNOWN_BAD_VIOLATIONS[entry.caseDefinition.id],
      );
    });
  }
});

test('known-bad evaluator accepts corrected controls for all seven records', async t => {
  const { entries } = await loadKnownBadEntries();
  for (const entry of entries) {
    await t.test(entry.caseDefinition.id, () => {
      const correctedArtifact = buildCorrectedArtifact(
        entry.caseDefinition,
        entry.artifact,
      );
      assert.deepEqual(
        evaluateKnownBadBaseline(entry.caseDefinition.oracle, correctedArtifact),
        {
          passed: true,
          observedState: entry.caseDefinition.oracle.expectedState,
          violations: [],
        },
      );
    });
  }
});

test('known-bad evaluator does not reject an explicit negation by substring', async () => {
  const { entries } = await loadKnownBadEntries();
  const entry = entries.find(item => item.caseDefinition.id === 'obs-external-process-inference');
  const correctedArtifact = buildCorrectedArtifact(entry.caseDefinition, entry.artifact);
  correctedArtifact.parentPayload.structuredContent.directAnswer =
    'It is false that the flow launches an external process.';
  correctedArtifact.parentPayload.content[0].text =
    correctedArtifact.parentPayload.structuredContent.directAnswer;
  assert.equal(
    evaluateKnownBadBaseline(entry.caseDefinition.oracle, correctedArtifact).passed,
    true,
  );
});

test('known-bad evaluator binds transport ids and documented failure classes to the oracle', async () => {
  const { entries } = await loadKnownBadEntries();
  const cancellation = entries.find(
    item => item.caseDefinition.id === 'fx-jsonrpc-id-zero-cancellation',
  );
  const correctedCancellation = buildCorrectedArtifact(
    cancellation.caseDefinition,
    cancellation.artifact,
  );
  correctedCancellation.transport.requestId = 1;
  assert.deepEqual(
    knownBadViolationKeys(evaluateKnownBadBaseline(
      cancellation.caseDefinition.oracle,
      correctedCancellation,
    )),
    ['REQUEST_ID_MISMATCH'],
  );

  const documented = entries.find(
    item => item.caseDefinition.id === 'obs-external-process-inference',
  );
  const wrongClass = structuredClone(documented.artifact);
  wrongClass.observation.failureClass = 'different_failure';
  assert.deepEqual(
    knownBadViolationKeys(evaluateKnownBadBaseline(
      documented.caseDefinition.oracle,
      wrongClass,
    )),
    ['DOCUMENTED_FAILURE_CLASS_MISMATCH'],
  );
});

test('known-bad evaluator requires exact file-range grounding for goal anchors', async () => {
  const { entries } = await loadKnownBadEntries();
  const entry = entries.find(item => item.caseDefinition.id === 'obs-large-route-ui-api-mismatch');
  const correctedArtifact = buildCorrectedArtifact(entry.caseDefinition, entry.artifact);
  correctedArtifact.parentPayload.structuredContent.evidence
    .find(item => item.id === 'E3').groundingStatus = 'partial';

  const evaluation = evaluateKnownBadBaseline(entry.caseDefinition.oracle, correctedArtifact);
  assert.deepEqual(knownBadViolationKeys(evaluation), ['REQUIRED_GOAL_UNSUPPORTED:G1']);
});

test('known-bad evaluator fails closed on an incomplete payload', async () => {
  const manifest = await loadTrustManifest();
  const caseDefinition = manifest.cases.find(item => item.id === 'obs-deny-list-count-range');
  assert.deepEqual(evaluateKnownBadBaseline(caseDefinition.oracle, {}), {
    passed: false,
    observedState: 'invalid',
    violations: [{
      code: 'INVALID_BASELINE_ARTIFACT',
      problems: [
        'parentPayload is required',
        'parentPayload.content must be an array',
        'structuredContent must be an object',
        'structuredContent.schemaVersion must be 2',
        'structuredContent.directAnswer must be non-empty',
        'structuredContent.status.verification must be a string',
        'structuredContent.status.complete must be a boolean',
        'structuredContent.evidence must be an array',
      ],
    }],
  });
});

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
