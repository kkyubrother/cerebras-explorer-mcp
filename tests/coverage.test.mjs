import test from 'node:test';
import assert from 'node:assert/strict';
import * as coverageModule from '../src/explorer/coverage.mjs';
import {
  applyEvidenceRepairRound,
  createAtomicClaim,
  createCoverageGap,
  createRequiredSubgoal,
  createSafetyLimit,
  createTaskContract,
  deriveGapPriority,
  fingerprintAction,
  integrateAuditedLateGoals,
  mergeSafetyLimit,
  reduceTrustState,
  selectClaimCover,
  selectParentFollowUp,
  transitionSubgoal,
} from '../src/explorer/coverage.mjs';
import { redactValue } from '../src/explorer/redact.mjs';

const contractTest = test;

  const PROOF_POLICIES = [
    'direct_source',
    'bounded_absence',
    'deterministic_count',
    'symbol_definition',
    'bounded_usage_cross_check',
    'ordered_handoffs',
    'impact_categories',
    'distinct_policy_paths',
    'support_or_refute',
  ];

  const CLAIM_TYPE_POLICIES = {
    positive: 'direct_source',
    absence: 'bounded_absence',
    count: 'deterministic_count',
    symbol_definition: 'symbol_definition',
    symbol_usage: 'bounded_usage_cross_check',
    flow: 'ordered_handoffs',
    impact: 'impact_categories',
    comparison: 'distinct_policy_paths',
    claim_verification: 'support_or_refute',
  };

  function createAuditedSubgoal(overrides = {}) {
    return createRequiredSubgoal({
      id: 'S1',
      question: 'Where is normalizeExploreResult defined?',
      originRefs: ['request:0-41'],
      claimType: 'symbol_definition',
      proofCondition: 'Observe the in-scope definition and source body.',
      constraints: [],
      auditVerdict: 'ready',
      ...overrides,
    });
  }

  function createCandidateSubgoal(overrides = {}) {
    const audited = createAuditedSubgoal(overrides);
    const exploring = transitionSubgoal(audited, 'exploring');
    return transitionSubgoal(exploring, 'candidate', { claimRefs: ['C1'] });
  }

  function createSupportedSubgoal(overrides = {}) {
    return transitionSubgoal(createCandidateSubgoal(overrides), 'supported', {
      semanticVerified: true,
      resolution: 'affirmed',
    });
  }

  contractTest('Spec 028 T005 — TaskContract preserves the task and installs runtime-owned capabilities', () => {
    const subgoals = Array.from({ length: 13 }, (_, index) =>
      createAuditedSubgoal({ id: `S${index + 1}` }));
    const task = '  Trace normalizeExploreResult\nand its usages.  ';
    const contract = createTaskContract({
      task,
      effectiveScope: ['src/explorer'],
      constraints: ['Include definition and usages.'],
      capabilities: {
        repositoryRead: false,
        gitRead: false,
        repositoryWrite: true,
        liveRuntimeState: true,
        scopeWidening: true,
        secretPathRead: true,
      },
      subgoals,
      plannerVersion: 'planner-v1',
      goalAuditVersion: 'goal-audit-v1',
    });

    assert.equal(contract.task, task, 'the original task must remain verbatim');
    assert.deepEqual(contract.effectiveScope, ['src/explorer']);
    assert.deepEqual(contract.constraints, ['Include definition and usages.']);
    assert.deepEqual(contract.subgoals, subgoals,
      'the 12-item processing batch is not a semantic subgoal cap');
    assert.equal(contract.plannerVersion, 'planner-v1');
    assert.equal(contract.goalAuditVersion, 'goal-audit-v1');
    assert.deepEqual(contract.capabilities, {
      repositoryRead: true,
      gitRead: true,
      repositoryWrite: false,
      liveRuntimeState: false,
      scopeWidening: false,
      secretPathRead: false,
    });

    assert.throws(() => createTaskContract({
      task,
      effectiveScope: ['src/explorer'],
      constraints: [],
      subgoals: [subgoals[0], { ...subgoals[0] }],
      plannerVersion: 'planner-v1',
      goalAuditVersion: 'goal-audit-v1',
    }), /duplicate subgoal id/i,
    'runtime contract construction must reject duplicate goal identities');
  });

// T057 is intentionally test-first. T061 owns these three pure proof-policy
// capabilities. With none present the cases remain visible TODOs; exporting
// any subset activates every assertion so a partial implementation fails
// normally instead of hiding behind feature detection.
const T061_COVERAGE_PROOF_EXPORTS = [
  'buildAbsenceCertificate',
  'computeDeterministicCount',
  'selectCertifiedDeterministicCount',
  'evaluateProofPolicy',
];

function proofPolicyCoverageTest(name, callback) {
  const present = T061_COVERAGE_PROOF_EXPORTS.filter(
    exportName => typeof coverageModule[exportName] === 'function',
  );
  if (present.length === 0) {
    test.todo(name);
    return;
  }
  test(name, () => {
    const capabilities = {};
    for (const exportName of T061_COVERAGE_PROOF_EXPORTS) {
      assert.equal(
        typeof coverageModule[exportName],
        'function',
        `T061 partially implemented the proof-policy surface: ${exportName} is missing`,
      );
      capabilities[exportName] = coverageModule[exportName];
    }
    return callback(capabilities);
  });
}

function t057SearchObservation(overrides = {}) {
  return {
    id: 'Q1',
    kind: 'search',
    tool: 'repo_grep',
    normalizedArgs: { pattern: 'legacyRoute' },
    boundary: ['src/auth/**'],
    matchCount: 0,
    toolTruncated: false,
    contextTruncated: false,
    omittedOutOfScopeFiles: 0,
    deniedPaths: 0,
    errors: 0,
    enumerationComplete: true,
    ...overrides,
  };
}

function t057CertificateInput(overrides = {}) {
  return {
    id: 'A1',
    subgoalId: 'S-absence',
    claimBoundary: ['src/auth/**'],
    searches: [t057SearchObservation()],
    qualification: 'Static repository source within src/auth/**.',
    ...overrides,
  };
}

function assertFailedProof(result, message) {
  assert.equal(result?.passed, false, message);
  assert.equal(typeof result?.reason, 'string', `${message}: a stable reason is required`);
  assert.ok(result.reason.length > 0, `${message}: reason must not be empty`);
}

proofPolicyCoverageTest(
  'Spec 028 T057 — a complete bounded search produces a deterministic absence certificate',
  ({ buildAbsenceCertificate }) => {
    const input = t057CertificateInput();
    const snapshot = structuredClone(input);
    const certificate = buildAbsenceCertificate(input);

    assert.deepEqual(input, snapshot, 'certificate construction must not mutate runtime observations');
    assert.deepEqual(buildAbsenceCertificate(input), certificate,
      'the same observed boundary must produce the same certificate');
    assert.equal(certificate.id, 'A1');
    assert.equal(certificate.subgoalId, 'S-absence');
    assert.deepEqual(certificate.claimBoundary, ['src/auth/**']);
    assert.deepEqual(certificate.searchRefs, ['Q1']);
    assert.equal(certificate.complete, true);
    assert.equal(certificate.zeroMatches, true);
    assert.equal(certificate.qualification, input.qualification);
    assert.ok(Array.isArray(certificate.searchSummary) && certificate.searchSummary.length > 0);
    assert.ok(certificate.searchSummary.every(item => typeof item === 'string' && item.length > 0));
  },
);

proofPolicyCoverageTest(
  'Spec 028 T057 — truncation, omissions, denial, errors, or a narrower search keep absence uncertified',
  ({ buildAbsenceCertificate }) => {
    const incompleteCases = [
      ['narrower search boundary', { boundary: ['src/auth/internal/**'] }],
      ['tool truncation', { toolTruncated: true }],
      ['context truncation', { contextTruncated: true }],
      ['out-of-scope omission', { omittedOutOfScopeFiles: 1 }],
      ['denied path', { deniedPaths: 1 }],
      ['tool error', { errors: 1 }],
      ['incomplete enumeration', { enumerationComplete: false }],
    ];

    for (const [label, searchOverride] of incompleteCases) {
      const certificate = buildAbsenceCertificate(t057CertificateInput({
        claimBoundary: ['**'],
        searches: [t057SearchObservation({ boundary: ['**'], ...searchOverride })],
      }));
      assert.equal(certificate.complete, false, label);
      assert.deepEqual(certificate.searchRefs, ['Q1'], `${label}: observation remains auditable`);
    }
  },
);

proofPolicyCoverageTest(
  'Spec 028 T057 — deterministic counts use complete normalized identities, never prose or line numbers',
  ({ buildAbsenceCertificate, computeDeterministicCount, evaluateProofPolicy }) => {
    const certificate = buildAbsenceCertificate(t057CertificateInput({
      id: 'A-count',
      subgoalId: 'S-count',
      claimBoundary: ['src/routes/**'],
      searches: [t057SearchObservation({
        id: 'Q-count',
        boundary: ['src/routes/**'],
        matchCount: 2,
      })],
      qualification: 'Static route registrations within src/routes/**.',
    }));
    const input = {
      subgoalId: 'S-count',
      claimId: 'C-count',
      observationRef: 'Q-count',
      unit: 'matching_lines',
      claimBoundary: ['src/routes/**'],
      certificate,
      normalizedItemIds: ['route:/users', 'route:/users', 'route:/admin'],
      modelClaimedCount: 117,
      citedLineNumber: 117,
    };
    const snapshot = structuredClone(input);
    const count = computeDeterministicCount(input);

    assert.deepEqual(input, snapshot);
    assert.equal(count.complete, true);
    assert.equal(count.count, 2, 'duplicate normalized identities count once');
    assert.equal(count.subgoalId, 'S-count');
    assert.equal(count.claimId, 'C-count');
    assert.equal(count.unit, 'matching_lines');
    assert.equal(certificate.zeroMatches, false,
      'a complete non-empty enumeration is valid for counting, not absence proof');

    const incomplete = computeDeterministicCount({
      ...input,
      certificate: { ...certificate, complete: false },
    });
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.count, null,
      'an incomplete boundary must not leak a plausible numeric answer');

    assertFailedProof(evaluateProofPolicy({
      subgoal: {
        id: 'S-count-as-absence',
        claimType: 'absence',
        proofPolicy: 'bounded_absence',
        constraints: ['boundary:src/routes/**'],
      },
      claim: {
        id: 'C-count-as-absence',
        subgoalId: 'S-count-as-absence',
        text: 'opaque',
        evidenceRefs: ['Q-count'],
      },
      semanticVerdict: {
        claimId: 'C-count-as-absence',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['Q-count'],
      },
      absenceCertificates: [{ ...certificate, subgoalId: 'S-count-as-absence' }],
    }), 'a non-empty complete search cannot certify absence');
  },
);

proofPolicyCoverageTest(
  'Spec 028 T057 — claimType-derived negative, uniqueness, and exhaustive policies ignore claim language',
  ({ buildAbsenceCertificate, evaluateProofPolicy }) => {
    const certificate = buildAbsenceCertificate(t057CertificateInput());
    const texts = [
      'Only one static registration exists in the bounded source tree.',
      '경계 안의 정적 등록은 유일하다.',
      '境界内の静的登録は一意です。',
      'opaque-token-without-negative-keywords',
    ];
    const outcomes = texts.map(text => evaluateProofPolicy({
      subgoal: {
        id: 'S-absence',
        claimType: 'absence',
        proofPolicy: 'bounded_absence',
        constraints: ['boundary:src/auth/**', 'uniqueness', 'exhaustiveness'],
      },
      claim: { id: 'C1', subgoalId: 'S-absence', text, evidenceRefs: ['Q1'] },
      semanticVerdict: {
        claimId: 'C1',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['Q1'],
      },
      absenceCertificates: [certificate],
      deterministicCounts: [],
    }));

    assert.ok(outcomes.every(outcome => outcome?.passed === true));
    assert.deepEqual(
      outcomes.map(outcome => ({ passed: outcome.passed, reason: outcome.reason ?? null })),
      outcomes.map(() => ({ passed: true, reason: null })),
      'proofPolicy and runtime artifacts, not vocabulary, select the strong gate',
    );

    const incomplete = evaluateProofPolicy({
      subgoal: {
        id: 'S-absence',
        claimType: 'absence',
        proofPolicy: 'bounded_absence',
        constraints: ['boundary:src/auth/**'],
      },
      claim: { id: 'C1', subgoalId: 'S-absence', text: texts[3], evidenceRefs: ['Q1'] },
      semanticVerdict: {
        claimId: 'C1',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['Q1'],
      },
      absenceCertificates: [{ ...certificate, complete: false }],
      deterministicCounts: [],
    });
    assertFailedProof(incomplete, 'uncertified exhaustive claim');
  },
);

proofPolicyCoverageTest(
  'Spec 028 T057 — count and supported-refutation goals require their runtime proof artifacts',
  ({ buildAbsenceCertificate, computeDeterministicCount, evaluateProofPolicy }) => {
    const countCertificate = buildAbsenceCertificate(t057CertificateInput({
      id: 'A-count',
      subgoalId: 'S-count',
    }));
    const deterministicCount = computeDeterministicCount({
      subgoalId: 'S-count',
      claimId: 'C-count',
      observationRef: 'Q1',
      unit: 'matching_lines',
      claimBoundary: ['src/auth/**'],
      certificate: countCertificate,
      normalizedItemIds: ['registration:primary'],
    });
    const countInput = {
      subgoal: {
        id: 'S-count',
        claimType: 'count',
        proofPolicy: 'deterministic_count',
        constraints: ['boundary:src/auth/**'],
      },
      claim: {
        id: 'C-count',
        subgoalId: 'S-count',
        text: 'opaque',
        evidenceRefs: ['Q1'],
        measurement: { kind: 'count', unit: 'matching_lines', value: 1 },
      },
      semanticVerdict: {
        claimId: 'C-count',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['Q1'],
      },
      absenceCertificates: [countCertificate],
      deterministicCounts: [deterministicCount],
    };
    assert.equal(evaluateProofPolicy(countInput).passed, true);
    assertFailedProof(evaluateProofPolicy({
      ...countInput,
      deterministicCounts: [{ ...deterministicCount, claimId: 'C-unrelated' }],
    }), 'a deterministic count computed for another claim');
    assertFailedProof(evaluateProofPolicy({
      ...countInput,
      claim: {
        ...countInput.claim,
        measurement: { kind: 'count', unit: 'matching_lines', value: 999 },
      },
    }), 'a model-authored count value that differs from the runtime count');
    assertFailedProof(evaluateProofPolicy({
      ...countInput,
      claim: {
        ...countInput.claim,
        measurement: { kind: 'count', unit: 'array_entries', value: 1 },
      },
    }), 'an array-entry count that repository search tools did not compute');
    assertFailedProof(evaluateProofPolicy({
      ...countInput,
      deterministicCounts: [{ ...deterministicCount, complete: false, count: null }],
    }), 'uncertified deterministic count');

    const refutationCertificate = buildAbsenceCertificate(t057CertificateInput({
      id: 'A-refute',
      subgoalId: 'S-refute',
    }));
    const refutationInput = {
      subgoal: {
        id: 'S-refute',
        claimType: 'claim_verification',
        proofPolicy: 'support_or_refute',
        constraints: ['boundary:src/auth/**'],
      },
      claim: {
        id: 'C-refute',
        subgoalId: 'S-refute',
        text: 'The supplied registration premise is refuted within src/auth/**.',
        evidenceRefs: ['Q1'],
      },
      semanticVerdict: {
        claimId: 'C-refute',
        result: 'supported',
        resolution: 'refuted',
        supportingEvidenceRefs: ['Q1'],
      },
      absenceCertificates: [refutationCertificate],
      deterministicCounts: [],
    };
    const uncorroboratedRefutation = evaluateProofPolicy(refutationInput);
    assertFailedProof(uncorroboratedRefutation,
      'a certificate-only refutation requires independent corroboration');
    assert.equal(uncorroboratedRefutation.reason, 'uncorroborated_refutation');
    assert.equal(evaluateProofPolicy({
      ...refutationInput,
      policyArtifacts: { absenceRefutationCorroborated: true },
    }).passed, true);
    assertFailedProof(evaluateProofPolicy({
      ...refutationInput,
      semanticVerdict: {
        ...refutationInput.semanticVerdict,
        result: 'contradicted',
        resolution: undefined,
        supportingEvidenceRefs: [],
      },
    }), 'candidate contradiction is not a supported refutation');
    assertFailedProof(evaluateProofPolicy({
      ...refutationInput,
      absenceCertificates: [{ ...refutationCertificate, complete: false }],
      policyArtifacts: { absenceRefutationCorroborated: true },
    }), 'unsupported refutation boundary');

    assert.equal(evaluateProofPolicy({
      ...refutationInput,
      claim: { ...refutationInput.claim, evidenceRefs: ['E-counterexample'] },
      semanticVerdict: {
        ...refutationInput.semanticVerdict,
        supportingEvidenceRefs: ['E-counterexample'],
      },
      absenceCertificates: [],
      observations: [{
        id: 'E-counterexample',
        kind: 'source',
        path: 'src/routes/public.mjs',
      }],
    }).passed, true,
    'a direct source counterexample can support a refutation without absence proof');

    assertFailedProof(evaluateProofPolicy({
      ...refutationInput,
      semanticVerdict: {
        ...refutationInput.semanticVerdict,
        resolution: 'affirmed',
      },
      absenceCertificates: [],
      observations: [t057SearchObservation()],
    }), 'an affirmed verification cannot rely on search metadata alone');
  },
);

proofPolicyCoverageTest(
  'Spec 028 T061 — proof artifacts stay bound to the accepted claim and runtime evidence',
  ({
    buildAbsenceCertificate,
    computeDeterministicCount,
    evaluateProofPolicy,
    selectCertifiedDeterministicCount,
  }) => {
    const validCertificate = buildAbsenceCertificate(t057CertificateInput());
    assert.match(validCertificate.searchSummary[0], /legacyRoute/);
    assert.doesNotMatch(validCertificate.searchSummary[0], /matches=/,
      'public absence concepts must not expose raw search counters');

    const absenceInput = {
      subgoal: {
        id: 'S-absence',
        claimType: 'absence',
        proofPolicy: 'bounded_absence',
        constraints: [],
      },
      claim: { id: 'C1', subgoalId: 'S-absence', text: 'opaque', evidenceRefs: ['Q1'] },
      semanticVerdict: {
        claimId: 'C1',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['Q1'],
      },
      absenceCertificates: [{
        ...validCertificate,
        id: 'unrelated',
        searchRefs: ['Q-unrelated'],
      }, validCertificate],
    };
    assert.equal(evaluateProofPolicy(absenceInput).passed, true,
      'a later claim-bound certificate must not be hidden by an unrelated first record');
    assertFailedProof(evaluateProofPolicy({
      ...absenceInput,
      absenceCertificates: [absenceInput.absenceCertificates[0]],
    }), 'an unrelated same-subgoal certificate');

    const missingIdentities = computeDeterministicCount({
      subgoalId: 'S-absence',
      claimId: 'C1',
      observationRef: 'Q1',
      unit: 'matching_lines',
      claimBoundary: ['src/auth/**'],
      certificate: validCertificate,
    });
    assert.equal(missingIdentities.complete, false);
    assert.equal(missingIdentities.count, null);

    const countCertificate = buildAbsenceCertificate(t057CertificateInput({
      id: 'A-count-bound',
      subgoalId: 'S-count-bound',
      searches: [t057SearchObservation({ id: 'Q-count-bound', matchCount: 0 })],
    }));
    const boundCount = computeDeterministicCount({
      subgoalId: 'S-count-bound',
      claimId: 'C-count-bound',
      observationRef: 'Q-count-bound',
      unit: 'matching_lines',
      claimBoundary: ['src/auth/**'],
      certificate: countCertificate,
      normalizedItemIds: [],
    });
    const boundInput = {
      subgoal: {
        id: 'S-count-bound',
        claimType: 'count',
        proofPolicy: 'deterministic_count',
      },
      claim: {
        id: 'C-count-bound',
        subgoalId: 'S-count-bound',
        evidenceRefs: ['Q-unrelated', 'Q-count-bound'],
        measurement: { kind: 'count', unit: 'matching_lines', value: 0 },
      },
      semanticVerdict: {
        claimId: 'C-count-bound',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['Q-count-bound'],
      },
      absenceCertificates: [countCertificate],
      deterministicCounts: [boundCount],
    };
    assert.equal(selectCertifiedDeterministicCount(boundInput), boundCount);
    assert.equal(selectCertifiedDeterministicCount({
      ...boundInput,
      semanticVerdict: {
        ...boundInput.semanticVerdict,
        supportingEvidenceRefs: ['Q-unrelated'],
      },
    }), null, 'the model cannot bind a count to an unsupported search');
    assert.equal(selectCertifiedDeterministicCount({
      ...boundInput,
      deterministicCounts: [boundCount, { ...boundCount }],
    }), null, 'duplicate eligible count artifacts fail closed');
    assert.equal(selectCertifiedDeterministicCount({
      ...boundInput,
      absenceCertificates: [{
        ...countCertificate,
        searchRefs: ['Q-unrelated', 'Q-count-bound'],
      }],
    }), null, 'a multi-search certificate cannot ambiguously bind one normalized count');

    const usageSubgoal = {
      id: 'S-usage',
      claimType: 'symbol_usage',
      proofPolicy: 'bounded_usage_cross_check',
      constraints: [],
    };
    assertFailedProof(evaluateProofPolicy({
      subgoal: usageSubgoal,
      claim: { id: 'C-usage', subgoalId: 'S-usage', text: 'opaque', evidenceRefs: ['E1'] },
      semanticVerdict: {
        claimId: 'C-usage',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['E1'],
      },
      observations: [
        { id: 'E1', kind: 'source', path: 'src/auth.js' },
        t057SearchObservation({ id: 'Q-unrelated' }),
      ],
    }), 'an unrelated clean search cannot satisfy usage cross-check');

    assertFailedProof(evaluateProofPolicy({
      subgoal: {
        id: 'S-flow',
        claimType: 'flow',
        proofPolicy: 'ordered_handoffs',
        constraints: [],
      },
      claim: { id: 'C-flow', subgoalId: 'S-flow', text: 'opaque', evidenceRefs: ['E1'] },
      semanticVerdict: {
        claimId: 'C-flow',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['E1'],
      },
      observations: [{ id: 'E1', kind: 'source', path: 'src/entry.js' }],
      policyArtifacts: { transitionsComplete: true },
    }), 'a model-like completion boolean cannot prove transitions');
  },
);

proofPolicyCoverageTest(
  'Spec 028 T068 — a same-definition comparison accepts only a certified static-array count pair',
  ({ evaluateProofPolicy }) => {
    const source = {
      id: 'E-source',
      kind: 'source',
      path: 'src/security.mjs',
      startLine: 43,
      endLine: 117,
      rangeGrounding: 'exact',
    };
    const count = t057SearchObservation({
      id: 'E-source:search',
      tool: 'repo_symbol_context',
      normalizedArgs: { symbol: 'DEFAULT_SECRET_DENY_PATTERNS' },
      boundary: ['src/security.mjs'],
      matchCount: 2,
      deterministicMeasurement: { kind: 'count', unit: 'array_entries', value: 2 },
      normalizedItemIds: [
        `sha256:${'1'.repeat(64)}`,
        `sha256:${'2'.repeat(64)}`,
      ],
    });
    const input = {
      subgoal: {
        id: 'S-compare',
        claimType: 'comparison',
        proofPolicy: 'distinct_policy_paths',
        constraints: [],
      },
      claim: {
        id: 'C-compare',
        subgoalId: 'S-compare',
        text: 'opaque',
        evidenceRefs: ['E-source', 'E-source:search'],
      },
      semanticVerdict: {
        claimId: 'C-compare',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['E-source', 'E-source:search'],
      },
      observations: [source, count],
    };

    assert.equal(evaluateProofPolicy(input).passed, true);
    assertFailedProof(evaluateProofPolicy({
      ...input,
      observations: [source, { ...count, enumerationComplete: false }],
    }), 'an incomplete array observation cannot prove a same-source comparison');
    assertFailedProof(evaluateProofPolicy({
      ...input,
      observations: [source, {
        ...count,
        normalizedItemIds: count.normalizedItemIds.slice(0, 1),
      }],
    }), 'a model count without matching runtime identities cannot prove a comparison');
    assertFailedProof(evaluateProofPolicy({
      ...input,
      observations: [source, { ...count, boundary: ['src/other.mjs'] }],
    }), 'the static count and cited definition must share a bounded source');
    assertFailedProof(evaluateProofPolicy({
      ...input,
      observations: [source, { ...count, id: 'E-other:search' }],
    }), 'a static count must be paired with the exact source observation id');
    assertFailedProof(evaluateProofPolicy({
      ...input,
      observations: [{ ...source, rangeGrounding: 'partial' }, count],
    }), 'a partial definition range cannot prove a complete static-array comparison');
  },
);

  contractTest('Spec 028 T005 — RequiredSubgoal derives proof policy and initial state at runtime', () => {
    for (const [claimType, proofPolicy] of Object.entries(CLAIM_TYPE_POLICIES)) {
      const subgoal = createAuditedSubgoal({
        claimType,
        proofPolicy: 'model_authored_policy',
        state: 'supported',
        resolution: 'affirmed',
      });

      assert.equal(subgoal.proofPolicy, proofPolicy, claimType);
      assert.equal(subgoal.state, 'audited', claimType);
      assert.equal(subgoal.resolution, undefined, claimType);
      assert.deepEqual(subgoal.claimRefs, [], claimType);
    }

    const blocked = createAuditedSubgoal({
      auditVerdict: 'blocked_scope',
      blockerRef: 'G1',
    });
    assert.equal(blocked.state, 'blocked');
    assert.equal(blocked.blockerRef, 'G1');

    const suppliedBinding = createAuditedSubgoal({ auditBinding: 'model-authored-binding' });
    assert.notEqual(suppliedBinding.auditBinding, 'model-authored-binding');
    assert.match(suppliedBinding.auditBinding,
      /^audit-v1:(?:[0-9a-f]{16}-){3}[0-9a-f]{16}$/);
    assert.doesNotMatch(suppliedBinding.auditBinding, /[0-9a-f]{32}/,
      'the seal must survive optional generic-hex redaction');
    assert.equal(redactValue(suppliedBinding.auditBinding, {
      includeGenericHex: true,
    }).value, suppliedBinding.auditBinding);
  });

  contractTest('Spec 028 T005 — AtomicClaim starts pending and cannot self-promote', () => {
    const claim = createAtomicClaim({
      id: 'C1',
      subgoalId: 'S1',
      text: 'normalizeExploreResult is defined in schemas.mjs.',
      evidenceRefs: ['E1'],
      verdict: 'supported',
    });

    assert.deepEqual(claim, {
      id: 'C1',
      subgoalId: 'S1',
      text: 'normalizeExploreResult is defined in schemas.mjs.',
      evidenceRefs: ['E1'],
      verdict: 'pending',
    });
  });

  contractTest('Spec 028 T005 — CoverageGap priority is deterministic and runtime-owned', () => {
    const firstRequestPriorities = PROOF_POLICIES.map(proofPolicy =>
      deriveGapPriority({ requestOrder: 0, proofPolicy }));
    const secondRequestPriorities = PROOF_POLICIES.map(proofPolicy =>
      deriveGapPriority({ requestOrder: 1, proofPolicy }));

    assert.ok(firstRequestPriorities.every(Number.isInteger));
    assert.ok(
      deriveGapPriority({ requestOrder: 0, proofPolicy: 'bounded_absence' }) <
        deriveGapPriority({ requestOrder: 0, proofPolicy: 'direct_source' }),
      'a proof-sensitive absence gap must outrank a same-origin direct-source gap',
    );
    assert.ok(Math.max(...firstRequestPriorities) < Math.min(...secondRequestPriorities),
      'original request order must dominate proof-policy tie-breaking');
    assert.equal(
      deriveGapPriority({ requestOrder: 0, proofPolicy: 'bounded_absence' }),
      deriveGapPriority({ requestOrder: 0, proofPolicy: 'bounded_absence' }),
    );

    const gap = createCoverageGap({
      id: 'G1',
      subgoalId: 'S1',
      question: 'Where is the missing definition evidence?',
      reason: 'missing_evidence',
      repairable: true,
      followUp: {
        task: 'Locate the exact definition.',
        scope: ['src/explorer'],
        anchors: ['normalizeExploreResult'],
      },
      priority: -999,
      attemptedActionFingerprints: ['model-authored-fingerprint'],
    }, {
      requestOrder: 1,
      proofPolicy: 'symbol_definition',
    });

    assert.equal(gap.priority, deriveGapPriority({
      requestOrder: 1,
      proofPolicy: 'symbol_definition',
    }));
    assert.notEqual(gap.priority, -999, 'a model/caller priority must be ignored');
    assert.equal(gap.reason, 'missing_evidence');
    assert.equal(gap.repairable, true);
    assert.deepEqual(gap.followUp.scope, ['src/explorer']);
    assert.deepEqual(gap.attemptedActionFingerprints, [],
      'attempt history starts empty and is populated only by runtime actions');
  });

  test('Spec 028 T041 — claim cover keeps shared references scoped to each claim', () => {
    const cover = selectClaimCover({
      subgoals: [
        { id: 'S1', proofPolicy: 'direct_source', state: 'supported' },
        { id: 'S2', proofPolicy: 'ordered_handoffs', state: 'supported' },
        { id: 'S3', proofPolicy: 'deterministic_count', state: 'supported' },
        { id: 'S4', proofPolicy: 'impact_categories', state: 'supported' },
      ],
      claims: [
        { id: 'C1', subgoalId: 'S1', verdict: 'supported', evidenceRefs: ['E1', 'E2'] },
        { id: 'C2', subgoalId: 'S2', verdict: 'supported', evidenceRefs: ['E2', 'E3'] },
        { id: 'C3', subgoalId: 'S3', verdict: 'supported', evidenceRefs: ['E4', 'E5'] },
        { id: 'C4', subgoalId: 'S4', verdict: 'supported', evidenceRefs: ['E6', 'E7', 'E8'] },
      ],
      verdicts: [
        { claimId: 'C1', result: 'supported', supportingEvidenceRefs: ['E2', 'E1'] },
        { claimId: 'C2', result: 'supported', supportingEvidenceRefs: ['E2', 'E3'] },
        { claimId: 'C3', result: 'supported', supportingEvidenceRefs: ['E4', 'E5'] },
        { claimId: 'C4', result: 'supported', supportingEvidenceRefs: ['E6', 'E7', 'E8'] },
      ],
    });

    assert.deepEqual(cover.evidenceRefs, ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
    assert.deepEqual(cover.evidenceRefsByClaimId.get('C1'), ['E1']);
    assert.deepEqual(cover.evidenceRefsByClaimId.get('C2'), ['E2', 'E3']);
    assert.deepEqual(cover.evidenceRefsByClaimId.get('C3'), ['E4', 'E5'],
      'count claims cannot discard the enumeration evidence behind the computed value');
    assert.deepEqual(cover.evidenceRefsByClaimId.get('C4'), ['E6', 'E7', 'E8'],
      'impact claims retain every approved category source');
  });

  test('Spec 028 T071 — direct claims retain each explicitly named source path without duplicate ranges', () => {
    const cover = selectClaimCover({
      subgoals: [{ id: 'S1', proofPolicy: 'direct_source', state: 'supported' }],
      claims: [{
        id: 'C1',
        subgoalId: 'S1',
        verdict: 'supported',
        text: 'src/auth.js defines validation and tests/auth.test.js verifies it.',
        evidenceRefs: ['E1', 'E2', 'E3'],
      }],
      verdicts: [{
        claimId: 'C1',
        result: 'supported',
        supportingEvidenceRefs: ['E3', 'E2', 'E1'],
      }],
      observations: [
        { id: 'E1', kind: 'source', path: 'src/auth.js', startLine: 1, endLine: 4 },
        { id: 'E2', kind: 'source', path: 'src/auth.js', startLine: 8, endLine: 12 },
        { id: 'E3', kind: 'source', path: 'tests/auth.test.js', startLine: 1, endLine: 9 },
      ],
    });

    assert.deepEqual(cover.evidenceRefs, ['E1', 'E3']);
    assert.deepEqual(cover.evidenceRefsByClaimId.get('C1'), ['E1', 'E3']);
  });

  test('Spec 028 T041 — parent follow-up uses gap priority and suppresses repeated tools', () => {
    const askUser = selectParentFollowUp({
      effectiveScope: ['src/**'],
      coverageGaps: [
        {
          id: 'G-tool',
          question: 'Where is the remaining definition?',
          reason: 'missing_evidence',
          repairable: true,
          priority: 100,
          followUp: { task: 'Find the definition.', anchors: ['src/auth.js'] },
        },
        {
          id: 'G-input',
          question: 'Which deployment should be checked?',
          reason: 'missing_input',
          repairable: false,
          priority: 0,
        },
      ],
    });
    assert.deepEqual(askUser, {
      type: 'ask_user',
      question: 'Which deployment should be checked?',
    });

    const gap = {
      id: 'G-tool',
      question: 'Where is the remaining definition?',
      reason: 'missing_evidence',
      repairable: true,
      priority: 0,
      followUp: { task: 'Find the definition.', anchors: ['src/auth.js'] },
      attemptedActionFingerprints: [],
    };
    const action = selectParentFollowUp({
      coverageGaps: [gap],
      effectiveScope: ['src/**'],
    });
    assert.deepEqual(action, {
      type: 'tool',
      tool: 'explore_repo',
      arguments: {
        task: 'Find the definition.',
        scope: ['src/**'],
        hints: { files: ['src/auth.js'] },
      },
    });
    assert.equal(selectParentFollowUp({
      coverageGaps: [{
        ...gap,
        attemptedActionFingerprints: [fingerprintAction(action)],
      }],
      effectiveScope: ['src/**'],
    }), null);
  });

  contractTest('Spec 028 T031 — audited late goals become bounded initial or terminal gaps', () => {
    const existing = createSupportedSubgoal();
    const taskContract = createTaskContract({
      task: 'Locate the definition and inspect the requested route registration.',
      effectiveScope: ['src/**'],
      constraints: [],
      subgoals: [existing],
      plannerVersion: 'planner-v1',
      goalAuditVersion: 'goal-audit-v1',
    });
    const ready = createRequiredSubgoal({
      id: 'late-uncovered:initial:1',
      question: 'Which requested route registration still needs inspection?',
      originRefs: ['request:26-66'],
      claimType: 'positive',
      proofCondition: 'Observe the requested route registration in current source.',
      constraints: ['Remain within src/**.'],
      auditVerdict: 'ready',
    });
    const blockedGap = createCoverageGap({
      id: 'audit-gap:late-blocked',
      subgoalId: 'late-blocked',
      question: 'What does the deployed route currently execute?',
      reason: 'external_state_required',
      repairable: false,
    }, { requestOrder: 1, proofPolicy: 'direct_source' });
    const blocked = createRequiredSubgoal({
      id: 'late-blocked',
      question: blockedGap.question,
      originRefs: ['request:26-66'],
      claimType: 'positive',
      proofCondition: 'Observe deployed route execution state.',
      constraints: [],
      auditVerdict: 'requires_external_state',
      blockerRef: blockedGap.id,
    });
    const input = {
      taskContract,
      coverageGaps: [],
      rejectedGoals: [],
      auditResult: {
        requiredSubgoals: [ready, blocked],
        gaps: [blockedGap],
        rejectedGoals: [{
          proposedGoalId: 'late-rejected',
          verdict: 'reject_untraceable',
          originRefs: [],
          missingRequestParts: [],
          reason: 'Not requested.',
        }],
        revisionRequest: null,
      },
    };
    const snapshot = structuredClone(input);

    const initial = integrateAuditedLateGoals({ ...input, phase: 'initial' });
    const postRepair = integrateAuditedLateGoals({ ...input, phase: 'post-repair' });

    const initialLate = initial.taskContract.subgoals.find(goal => goal.id === ready.id);
    const postRepairLate = postRepair.taskContract.subgoals.find(goal => goal.id === ready.id);
    assert.equal(initialLate.state, 'gap');
    assert.equal(postRepairLate.state, 'gap');
    assert.deepEqual(initial.coverageGaps.map(gap => [gap.reason, gap.repairable]), [
      ['uncovered_request', true],
      ['external_state_required', false],
    ]);
    assert.deepEqual(postRepair.coverageGaps.map(gap => [gap.reason, gap.repairable]), [
      ['uncovered_request', false],
      ['external_state_required', false],
    ]);
    assert.equal(initial.taskContract.subgoals.find(goal => goal.id === blocked.id).state, 'blocked');
    assert.deepEqual(initial.rejectedGoals.map(goal => goal.proposedGoalId), ['late-rejected']);
    assert.ok(initial.taskContract.constraints.includes('Remain within src/**.'));
    assert.deepEqual(input, snapshot, 'late-goal integration must not mutate audited inputs');
    assert.throws(() => integrateAuditedLateGoals({
      ...input,
      auditResult: {
        ...input.auditResult,
        requiredSubgoals: [createAuditedSubgoal({ id: existing.id })],
        gaps: [],
      },
      phase: 'initial',
    }), /duplicate or invalid id/);

    const exactDuplicate = createAuditedSubgoal({ id: 'late-duplicate' });
    const duplicateResult = integrateAuditedLateGoals({
      taskContract,
      coverageGaps: [],
      rejectedGoals: [],
      auditResult: {
        requiredSubgoals: [exactDuplicate],
        gaps: [],
        rejectedGoals: [],
        revisionRequest: null,
      },
      phase: 'initial',
    });
    assert.equal(duplicateResult.taskContract.subgoals.length, 1,
      'an already-required exact obligation must not become a duplicate gap');
    assert.deepEqual(duplicateResult.coverageGaps, []);

    const duplicateBlockedGap = createCoverageGap({
      id: 'audit-gap:late-duplicate-blocked',
      subgoalId: 'late-duplicate-blocked',
      question: exactDuplicate.question,
      reason: 'scope_blocked',
      repairable: false,
    }, { requestOrder: 0, proofPolicy: exactDuplicate.proofPolicy });
    const duplicateBlocked = createRequiredSubgoal({
      ...exactDuplicate,
      id: 'late-duplicate-blocked',
      auditVerdict: 'blocked_scope',
      blockerRef: duplicateBlockedGap.id,
    });
    const duplicateBlockedResult = integrateAuditedLateGoals({
      taskContract,
      coverageGaps: [],
      rejectedGoals: [],
      auditResult: {
        requiredSubgoals: [duplicateBlocked],
        gaps: [duplicateBlockedGap],
        rejectedGoals: [],
        revisionRequest: null,
      },
      phase: 'initial',
    });
    assert.equal(duplicateBlockedResult.taskContract.subgoals.length, 1,
      'auditor verdict drift must not duplicate an existing exact obligation');
    assert.deepEqual(duplicateBlockedResult.coverageGaps, []);

    const strengthened = createRequiredSubgoal({
      ...exactDuplicate,
      id: 'late-strengthened',
      constraints: ['Inspect the route-specific caller too.'],
      auditVerdict: 'ready',
    });
    const strengthenedResult = integrateAuditedLateGoals({
      taskContract,
      coverageGaps: [],
      rejectedGoals: [],
      auditResult: {
        requiredSubgoals: [strengthened],
        gaps: [],
        rejectedGoals: [],
        revisionRequest: null,
      },
      phase: 'post-repair',
    });
    assert.equal(strengthenedResult.taskContract.subgoals.length, 2,
      'a stronger audited obligation must not silently inherit prior support');
    assert.equal(strengthenedResult.coverageGaps[0].repairable, false);
    assert.throws(() => integrateAuditedLateGoals({
      taskContract,
      coverageGaps: [],
      rejectedGoals: input.auditResult.rejectedGoals,
      auditResult: {
        requiredSubgoals: [],
        gaps: [],
        rejectedGoals: input.auditResult.rejectedGoals,
        revisionRequest: null,
      },
      phase: 'initial',
    }), /unique non-empty proposal ids/);
  });

  contractTest('Spec 028 T009 — action fingerprints are opaque, stable, and key-order independent', () => {
    const first = fingerprintAction({
      type: 'tool',
      tool: 'explore_repo',
      arguments: {
        task: 'Locate the parser.',
        scope: ['src/**'],
      },
    });
    const equivalent = fingerprintAction({
      arguments: {
        scope: ['src/**'],
        task: 'Locate the parser.',
      },
      tool: 'explore_repo',
      type: 'tool',
    });
    const different = fingerprintAction({
      type: 'tool',
      tool: 'explore_repo',
      arguments: {
        task: 'Locate the parser.',
        scope: ['tests/**'],
      },
    });

    assert.match(first, /^sha256:[0-9a-f]{64}$/);
    assert.equal(first, equivalent, 'JSON object key order must not create a new attempted action');
    assert.notEqual(first, different, 'materially different arguments need a distinct fingerprint');
    assert.notEqual(
      first,
      fingerprintAction(JSON.parse('{"type":"tool","tool":"explore_repo","arguments":{"task":"Locate the parser.","scope":["src/**"]},"__proto__":{"polluted":true}}')),
      'an own __proto__ argument must not disappear during canonicalization',
    );
    assert.doesNotMatch(first, /Locate|src|explore_repo/, 'fingerprints must not leak raw action data');
  });

  contractTest('Spec 028 T005 — SafetyLimit accepts only exact named ceilings', () => {
    assert.deepEqual(createSafetyLimit({
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: ['S1'],
      truncated: true,
    }), {
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: ['S1'],
      truncated: true,
    });

    assert.deepEqual(createSafetyLimit({
      name: 'context_limit',
      stage: 'synthesis',
      affectedSubgoalIds: [],
      truncated: false,
    }).affectedSubgoalIds, [], 'an operational-only limit may affect no goal');

    assert.throws(() => createSafetyLimit({
      name: 'unknown_ceiling',
      stage: 'exploration',
      affectedSubgoalIds: ['S1'],
      truncated: true,
    }), /safety limit|unknown/i);
  });

  test('Spec 028 T013 — safety-limit observations merge deterministically without losing affected goals', () => {
    const first = mergeSafetyLimit([], {
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: ['S2'],
      truncated: false,
    });
    const merged = mergeSafetyLimit(first, {
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: ['S1', 'S2'],
      truncated: true,
    });

    assert.deepEqual(merged, [{
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: ['S2', 'S1'],
      truncated: true,
    }]);
    assert.deepEqual(first[0].affectedSubgoalIds, ['S2'], 'merging must not mutate prior observations');
  });

  contractTest('Spec 028 T005 — audited goals follow the legal verified success path', () => {
    const audited = createAuditedSubgoal();
    const exploring = transitionSubgoal(audited, 'exploring');
    const candidate = transitionSubgoal(exploring, 'candidate', { claimRefs: ['C1'] });
    const supported = transitionSubgoal(candidate, 'supported', {
      semanticVerified: true,
      resolution: 'refuted',
    });

    assert.equal(audited.state, 'audited', 'transitions must not mutate their input');
    assert.equal(exploring.state, 'exploring');
    assert.deepEqual(candidate.claimRefs, ['C1']);
    assert.equal(supported.state, 'supported');
    assert.equal(supported.resolution, 'refuted');
    assert.ok([exploring, candidate, supported].every(goal =>
      goal.auditBinding === audited.auditBinding));

    const mutated = { ...audited, question: 'A post-audit mutation.' };
    assert.throws(() => transitionSubgoal(mutated, 'exploring'), /audit binding/i);
  });

  contractTest('Spec 028 T005 — candidate goals may become gaps or contradictions', () => {
    const candidate = createCandidateSubgoal();
    const gap = transitionSubgoal(candidate, 'gap', { gapRef: 'G1' });
    const contradicted = transitionSubgoal(candidate, 'contradicted', { gapRef: 'G2' });

    assert.equal(gap.state, 'gap');
    assert.equal(gap.gapRef, 'G1');
    assert.equal(contradicted.state, 'contradicted');
    assert.equal(contradicted.gapRef, 'G2');
  });

  contractTest('Spec 028 T005 — terminal gaps require the one repair path and fresh verification', () => {
    const gap = transitionSubgoal(createCandidateSubgoal(), 'gap', { gapRef: 'G1' });

    assert.throws(() => transitionSubgoal(gap, 'supported', {
      semanticVerified: true,
      resolution: 'affirmed',
    }), /transition/i);
    assert.throws(() => transitionSubgoal(gap, 'exploring'), /repair|transition/i);
    assert.throws(() => transitionSubgoal(gap, 'exploring', {
      repairable: false,
      repairRound: 1,
    }), /repair|transition/i);
    assert.throws(() => transitionSubgoal(gap, 'exploring', {
      repairable: true,
      repairRound: 2,
    }), /repair|transition/i);

    const exploring = transitionSubgoal(gap, 'exploring', {
      repairable: true,
      repairRound: 1,
    });
    const candidate = transitionSubgoal(exploring, 'candidate', { claimRefs: ['C2'] });
    const supported = transitionSubgoal(candidate, 'supported', {
      semanticVerified: true,
      resolution: 'affirmed',
    });
    assert.equal(supported.state, 'supported');
  });

  contractTest('Spec 028 T005 — supported goals reopen only for recorded counterevidence', () => {
    const supported = createSupportedSubgoal();

    assert.throws(() => transitionSubgoal(supported, 'candidate'), /counterevidence|transition/i);
    assert.throws(
      () => transitionSubgoal(supported, 'candidate', { counterevidenceRefs: [null] }),
      /counterevidence|transition/i,
    );
    const reopened = transitionSubgoal(supported, 'candidate', {
      counterevidenceRefs: ['E2'],
      claimRefs: ['C2'],
    });
    assert.equal(reopened.state, 'candidate');
    assert.deepEqual(reopened.claimRefs, ['C2']);
    assert.equal(reopened.resolution, undefined);
  });

  test('Spec 028 T032 — contradicted goals reopen only for recorded post-repair evidence', () => {
    const contradicted = transitionSubgoal(createCandidateSubgoal(), 'contradicted', {
      gapRef: 'G-contradicted',
    });

    assert.throws(() => transitionSubgoal(contradicted, 'candidate'),
      /counterevidence|transition/i);
    const reopened = transitionSubgoal(contradicted, 'candidate', {
      counterevidenceRefs: ['E2'],
      claimRefs: ['C2'],
    });

    assert.equal(reopened.state, 'candidate');
    assert.deepEqual(reopened.claimRefs, ['C2']);
    assert.equal(reopened.gapRef, undefined);
  });

  test('Spec 028 T032 — one repair terminalizes gaps and records only actual selected-gap actions', () => {
    const supported = createSupportedSubgoal({ id: 'S-supported' });
    const firstCandidate = createCandidateSubgoal({ id: 'S-first' });
    const secondCandidate = createCandidateSubgoal({ id: 'S-second' });
    const firstGapGoal = transitionSubgoal(firstCandidate, 'gap', { gapRef: 'G-first' });
    const secondGapGoal = transitionSubgoal(secondCandidate, 'gap', { gapRef: 'G-second' });
    const blocked = createAuditedSubgoal({
      id: 'S-blocked',
      auditVerdict: 'blocked_scope',
      blockerRef: 'G-blocked',
    });
    const firstGap = {
      ...createCoverageGap({
        id: 'G-first',
        subgoalId: firstGapGoal.id,
        question: firstGapGoal.question,
        reason: 'semantic_mismatch',
        repairable: true,
        followUp: { type: 'tool', tool: 'repo_read_file', arguments: { path: 'src/a.js' } },
      }, { requestOrder: 1, proofPolicy: firstGapGoal.proofPolicy }),
      attemptedActionFingerprints: ['sha256:prior'],
    };
    const secondGap = createCoverageGap({
      id: 'G-second',
      subgoalId: secondGapGoal.id,
      question: secondGapGoal.question,
      reason: 'missing_evidence',
      repairable: true,
    }, { requestOrder: 2, proofPolicy: secondGapGoal.proofPolicy });
    const blockerGap = createCoverageGap({
      id: 'G-blocked',
      subgoalId: blocked.id,
      question: blocked.question,
      reason: 'scope_blocked',
      repairable: false,
    }, { requestOrder: 3, proofPolicy: blocked.proofPolicy });
    const action = {
      type: 'tool',
      tool: 'repo_read_file',
      arguments: { path: 'src/a.js', startLine: 1, endLine: 20 },
    };
    const input = {
      taskContract: createTaskContract({
        task: 'Resolve every requested part.',
        effectiveScope: ['src/**'],
        constraints: [],
        subgoals: [supported, firstGapGoal, secondGapGoal, blocked],
        plannerVersion: 'planner-v1',
        goalAuditVersion: 'goal-audit-v1',
      }),
      coverageGaps: [secondGap, blockerGap, firstGap],
      selectedGapIds: ['G-first'],
      attemptedActions: [action, {
        arguments: { endLine: 20, path: 'src/a.js', startLine: 1 },
        tool: 'repo_read_file',
        type: 'tool',
      }],
      freshEvidenceRefs: ['E3', 'E3:search'],
    };
    const snapshot = structuredClone(input);
    const result = applyEvidenceRepairRound(input);

    assert.deepEqual(input, snapshot, 'repair reduction must not mutate its input');
    assert.deepEqual(result.attemptedActionFingerprints, [fingerprintAction(action)]);
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === supported.id).state,
      'supported');
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === firstGapGoal.id).state,
      'exploring');
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === secondGapGoal.id).state,
      'exploring', 'fresh counterevidence reopens every feasible gap');
    assert.equal(result.taskContract.subgoals.find(goal => goal.id === blocked.id).state,
      'blocked');
    assert.ok(result.coverageGaps.every(gap => gap.repairable === false));
    assert.ok(result.coverageGaps.every(gap => gap.followUp === undefined));
    assert.deepEqual(result.coverageGaps.find(gap => gap.id === 'G-first')
      .attemptedActionFingerprints, ['sha256:prior', fingerprintAction(action)]);
    assert.deepEqual(result.coverageGaps.find(gap => gap.id === 'G-second')
      .attemptedActionFingerprints, []);
  });

  test('Spec 028 T032 — repair rejects blocked and duplicate sub-goal gap links', () => {
    const blocked = createAuditedSubgoal({
      id: 'S-blocked-repair',
      auditVerdict: 'blocked_scope',
      blockerRef: 'G-blocked-repair',
    });
    const forgedRepairable = createCoverageGap({
      id: 'G-forged-repair',
      subgoalId: blocked.id,
      question: blocked.question,
      reason: 'missing_evidence',
      repairable: true,
    }, { requestOrder: 0, proofPolicy: blocked.proofPolicy });
    const taskContract = createTaskContract({
      task: 'Inspect the blocked goal.',
      effectiveScope: ['src/**'],
      constraints: [],
      subgoals: [blocked],
      plannerVersion: 'planner-v1',
      goalAuditVersion: 'goal-audit-v1',
    });
    assert.throws(() => applyEvidenceRepairRound({
      taskContract,
      coverageGaps: [forgedRepairable],
      selectedGapIds: [forgedRepairable.id],
      attemptedActions: [],
      freshEvidenceRefs: [],
    }), /invalid sub-goal link/i);

    const candidate = createCandidateSubgoal({ id: 'S-duplicate-gap' });
    const gapGoal = transitionSubgoal(candidate, 'gap', { gapRef: 'G-duplicate-1' });
    const first = createCoverageGap({
      id: 'G-duplicate-1',
      subgoalId: gapGoal.id,
      question: gapGoal.question,
      reason: 'missing_evidence',
      repairable: true,
    }, { requestOrder: 0, proofPolicy: gapGoal.proofPolicy });
    const second = createCoverageGap({
      id: 'G-duplicate-2',
      subgoalId: gapGoal.id,
      question: gapGoal.question,
      reason: 'contradicted',
      repairable: false,
    }, { requestOrder: 0, proofPolicy: gapGoal.proofPolicy });
    assert.throws(() => applyEvidenceRepairRound({
      taskContract: { ...taskContract, subgoals: [gapGoal] },
      coverageGaps: [first, second],
      selectedGapIds: [first.id],
      attemptedActions: [],
      freshEvidenceRefs: [],
    }), /multiple coverage gaps/i);
  });

  contractTest('Spec 028 T005 — illegal shortcuts and blocked-goal transitions fail closed', () => {
    const audited = createAuditedSubgoal();
    const exploring = transitionSubgoal(audited, 'exploring');
    const candidate = transitionSubgoal(exploring, 'candidate', { claimRefs: ['C1'] });
    const contradicted = transitionSubgoal(candidate, 'contradicted', { gapRef: 'G1' });
    const blocked = createAuditedSubgoal({
      auditVerdict: 'requires_external_state',
      blockerRef: 'G-external',
    });

    assert.throws(() => transitionSubgoal(audited, 'supported', {
      semanticVerified: true,
      resolution: 'affirmed',
    }), /transition/i);
    assert.throws(() => transitionSubgoal(exploring, 'supported', {
      semanticVerified: true,
      resolution: 'affirmed',
    }), /transition/i);
    assert.throws(() => transitionSubgoal(candidate, 'audited'), /transition/i);
    assert.throws(() => transitionSubgoal(candidate, 'supported', {
      resolution: 'affirmed',
    }), /verification|transition/i);
    assert.throws(() => transitionSubgoal(contradicted, 'supported', {
      semanticVerified: true,
      resolution: 'affirmed',
    }), /transition/i);
    assert.throws(() => transitionSubgoal(blocked, 'exploring'), /transition|terminal/i);
  });

  contractTest('Spec 028 T005 — fatal faults take precedence over every normal state', () => {
    const fatalTypes = [
      'invalid_invocation',
      'cancelled',
      'provider',
      'tool',
      'verifier',
      'internal',
    ];

    for (const type of fatalTypes) {
      assert.equal(reduceTrustState({
        fatalFault: { type },
        requiredSubgoals: [createAuditedSubgoal()],
        parentMustReadTargets: true,
      }), 'failed', type);
    }
  });

  contractTest('Spec 028 T005 — required-goal coverage precedes parent target verification', () => {
    const supported = createSupportedSubgoal();
    const blocked = createAuditedSubgoal({
      id: 'S2',
      auditVerdict: 'blocked_capability',
      blockerRef: 'G2',
    });
    const safetyLimited = {
      ...createAuditedSubgoal({ id: 'S3' }),
      state: 'gap',
      gapRef: 'G3',
    };

    const nonSupported = [
      createAuditedSubgoal({ id: 'S-audited' }),
      blocked,
      transitionSubgoal(createAuditedSubgoal({ id: 'S-exploring' }), 'exploring'),
      createCandidateSubgoal({ id: 'S-candidate' }),
      safetyLimited,
      transitionSubgoal(createCandidateSubgoal({ id: 'S-contradicted' }), 'contradicted', {
        gapRef: 'G-contradicted',
      }),
    ];

    for (const subgoal of nonSupported) {
      assert.equal(reduceTrustState({
        fatalFault: null,
        requiredSubgoals: [supported, subgoal],
        parentMustReadTargets: true,
      }), 'incomplete', `${subgoal.state} is not an execution failure or completion`);
    }
    assert.equal(reduceTrustState({
      fatalFault: null,
      requiredSubgoals: [supported, safetyLimited],
      parentMustReadTargets: false,
    }), 'incomplete', 'an affected safety-limit gap is not an execution failure');
    assert.equal(reduceTrustState({
      fatalFault: null,
      requiredSubgoals: [supported],
      parentMustReadTargets: true,
    }), 'verify_targets');
    assert.equal(reduceTrustState({
      fatalFault: null,
      requiredSubgoals: [supported],
      parentMustReadTargets: false,
    }), 'complete');
  });

  test('Spec 028 T013 — only affected safety limits block supported goals and fatal faults still win', () => {
    const supported = createSupportedSubgoal();
    const operationalOnly = createSafetyLimit({
      name: 'context_limit',
      stage: 'exploration',
      affectedSubgoalIds: [],
      truncated: true,
    });
    const affected = createSafetyLimit({
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: [supported.id],
      truncated: true,
    });

    assert.equal(reduceTrustState({
      requiredSubgoals: [supported],
      safetyLimits: [operationalOnly],
    }), 'complete', 'operator-only observations must not change trust state');
    assert.equal(reduceTrustState({
      requiredSubgoals: [supported],
      safetyLimits: [affected],
    }), 'incomplete', 'a limit invalidating a required proof must block completion');
    assert.equal(reduceTrustState({
      fatalFault: { type: 'invalid_control_output' },
      requiredSubgoals: [supported],
      safetyLimits: [affected],
    }), 'failed', 'fatal control faults take precedence over valid partial limits');
  });

  const goalAuditTest = test;

  const GOAL_AUDIT_TASK = 'Trace authenticateUser and determine whether legacyLogin is absent.';
  const FULL_ORIGIN = `request:0-${GOAL_AUDIT_TASK.length}`;
  const AUTH_ORIGIN = 'request:0-22';
  const LEGACY_ORIGIN = `request:${GOAL_AUDIT_TASK.indexOf('determine')}-${GOAL_AUDIT_TASK.length}`;
  const TRACE_DEFINITION_SEED = 'wrapper:trace_symbol:definition';
  const TRACE_USAGE_SEED = 'wrapper:trace_symbol:usage';
  const WRAPPER_SEEDS = new Map([
    ['find_relevant_code', ['locations', 'relevance', 'smallest_set']],
    ['trace_symbol', ['definition', 'usage']],
    ['map_change_impact', ['targets', 'dependents', 'requested_categories', 'risk_boundary']],
    ['explain_code_path', ['entry', 'handoffs', 'terminal_effect', 'transitions']],
    ['collect_evidence', ['verdict', 'direct_evidence', 'counterevidence']],
    ['explore_repo', []],
  ]);

  function goalProposal(overrides = {}) {
    return {
      id: 'S1',
      question: 'Where is authenticateUser defined?',
      originRefs: [AUTH_ORIGIN],
      claimType: 'symbol_definition',
      proofCondition: 'Observe the in-scope definition and source body.',
      constraints: [],
      ...overrides,
    };
  }

  function auditRecord(proposal, verdict = 'ready', overrides = {}) {
    return {
      proposedGoalId: proposal.id,
      verdict,
      originRefs: [...proposal.originRefs],
      missingRequestParts: [],
      reason: `Audited as ${verdict}.`,
      ...overrides,
    };
  }

  function preflight(proposals, { wrapperTool = 'trace_symbol', ...overrides } = {}) {
    assert.equal(typeof coverageModule.preflightGoalProposals, 'function');
    return coverageModule.preflightGoalProposals({
      task: GOAL_AUDIT_TASK,
      effectiveScope: ['src/**'],
      wrapperTool,
      proposals,
      ...overrides,
    });
  }

  function reduceAudit({
    preflightResult,
    auditRecords,
    uncoveredRequestParts = [],
    revisionCount = 0,
    existingRequiredSubgoals = [],
  }) {
    assert.equal(typeof coverageModule.reduceGoalAudit, 'function');
    return coverageModule.reduceGoalAudit({
      preflight: preflightResult,
      auditRecords,
      uncoveredRequestParts,
      revisionCount,
      existingRequiredSubgoals,
    });
  }

  goalAuditTest('Spec 028 T015 — valid offsets and module-owned wrapper seeds are the only traceable origins', () => {
    const requestGoal = goalProposal();
    const validRequest = preflight([requestGoal]);

    assert.deepEqual(validRequest.diagnostics, []);
    assert.deepEqual(validRequest.auditCandidates.map(goal => goal.id), ['S1']);
    const fullRange = preflight([goalProposal({ id: 'S-full', originRefs: [FULL_ORIGIN] })]);
    assert.deepEqual(fullRange.auditCandidates.map(goal => goal.id), ['S-full'],
      'request origins use zero-based half-open offsets and may cover the whole task');

    for (const [wrapperTool, seedNames] of WRAPPER_SEEDS) {
      for (const [index, seedName] of seedNames.entries()) {
        const originRef = `wrapper:${wrapperTool}:${seedName}`;
        const checked = preflight([goalProposal({
          id: `${wrapperTool}-${index}`,
          originRefs: [originRef],
        })], { wrapperTool });
        assert.deepEqual(checked.diagnostics, [], originRef);
        assert.deepEqual(checked.auditCandidates.map(goal => goal.originRefs), [[originRef]]);
      }
    }

    const unknownSeed = preflight([goalProposal({
      id: 'S3',
      originRefs: ['wrapper:trace_symbol:invented'],
    })]);
    assert.ok(unknownSeed.diagnostics.some(diagnostic =>
      diagnostic.proposedGoalId === 'S3' && diagnostic.code === 'invalid_origin_ref'));
    assert.deepEqual(unknownSeed.auditCandidates, []);

    const wrongActiveWrapper = preflight([goalProposal({
      id: 'S4',
      originRefs: [TRACE_USAGE_SEED],
    })], { wrapperTool: 'map_change_impact' });
    assert.deepEqual(wrongActiveWrapper.auditCandidates, []);

    for (const removedTool of ['review_change_context', 'explore']) {
      const removed = preflight([goalProposal()], { wrapperTool: removedTool });
      assert.deepEqual(removed.auditCandidates, [], removedTool);
      assert.ok(removed.diagnostics.length > 0, removedTool);
    }

    const fallbackSeed = preflight([goalProposal({
      id: 'S5',
      originRefs: ['wrapper:explore_repo:anything'],
    })], { wrapperTool: 'explore_repo' });
    assert.deepEqual(fallbackSeed.auditCandidates, [], 'explore_repo has no fixed seed beyond the request');
  });

  goalAuditTest('Spec 028 T015 — malformed offsets and duplicate ids fail deterministic preflight', () => {
    const invalidOrigins = [
      'request:-1-4',
      'request:0-0',
      'request:8-4',
      `request:0-${GOAL_AUDIT_TASK.length + 1}`,
      'request:0.5-4',
      'request:x-4',
    ];

    for (const [index, originRef] of invalidOrigins.entries()) {
      const id = `BAD${index + 1}`;
      const result = preflight([goalProposal({ id, originRefs: [originRef] })]);
      assert.ok(result.diagnostics.some(diagnostic =>
        diagnostic.proposedGoalId === id && diagnostic.code === 'invalid_origin_ref'), originRef);
      assert.equal(result.auditCandidates.some(goal => goal.id === id), false, originRef);
    }

    const duplicateProposals = [
      goalProposal({ id: 'SAME' }),
      goalProposal({
        id: 'SAME',
        question: 'Is legacyLogin absent?',
        originRefs: [LEGACY_ORIGIN],
        claimType: 'absence',
        proofCondition: 'Enumerate the bounded route registrations and certify absence.',
      }),
    ];
    const duplicateId = preflight(duplicateProposals);
    assert.ok(duplicateId.diagnostics.some(diagnostic => diagnostic.code === 'duplicate_id'));
    assert.equal(duplicateId.auditCandidates.some(goal => goal.id === 'SAME'), false,
      'conflicting duplicate ids must not leave an auditable survivor');
    const duplicateReduced = reduceAudit({
      preflightResult: duplicateId,
      auditRecords: duplicateProposals.map(proposal => auditRecord(proposal, 'ready')),
    });
    assert.equal(duplicateReduced.requiredSubgoals.some(goal => goal.id === 'SAME'), false,
      'auditor output cannot revive conflicting duplicate ids');
    assert.equal(duplicateReduced.controlFault?.code, 'duplicate_id',
      'ambiguous ids remain an explicit control fault for runtime recovery or failure');

    const invalid = goalProposal({ id: 'BAD-ready', originRefs: ['request:0-0'] });
    const invalidReduced = reduceAudit({
      preflightResult: preflight([invalid]),
      auditRecords: [auditRecord(invalid, 'ready')],
    });
    assert.deepEqual(invalidReduced.requiredSubgoals, [],
      'an auditor cannot promote a goal excluded by deterministic origin checks');
  });

  goalAuditTest('Spec 028 T021 — incomplete audit sets and invalid merge graphs fail closed', () => {
    const first = goalProposal();
    const second = goalProposal({
      id: 'S2',
      question: 'Identify the authenticateUser declaration.',
      originRefs: [TRACE_DEFINITION_SEED],
    });
    const checked = preflight([first, second]);

    assert.throws(() => reduceAudit({
      preflightResult: checked,
      auditRecords: [auditRecord(first)],
    }), /Missing audit record/);
    assert.throws(() => reduceAudit({
      preflightResult: checked,
      auditRecords: [
        auditRecord(first, 'ready', { missingRequestParts: ['An omitted request part.'] }),
        auditRecord(second),
      ],
    }), /without structured uncovered parts/);
    assert.throws(() => reduceAudit({
      preflightResult: checked,
      auditRecords: [
        auditRecord(first, 'ready', { missingRequestParts: ['The omitted request part.'] }),
        auditRecord(second),
      ],
      uncoveredRequestParts: [{
        question: 'A different request part.',
        originRefs: [LEGACY_ORIGIN],
        claimType: 'absence',
        proofCondition: 'Enumerate the bounded registration surface and certify absence.',
        constraints: [],
      }],
    }), /without structured uncovered parts/);
    assert.throws(() => reduceAudit({
      preflightResult: checked,
      auditRecords: [
        auditRecord(first),
        auditRecord(second),
        auditRecord({ ...second, id: 'unknown' }),
      ],
    }), /unknown proposal/);
    assert.throws(() => reduceAudit({
      preflightResult: checked,
      auditRecords: [
        auditRecord(first, 'merge_duplicate', { mergeInto: first.id }),
        auditRecord(second),
      ],
    }), /Invalid merge target/);
    assert.throws(() => reduceAudit({
      preflightResult: checked,
      auditRecords: [
        auditRecord(first, 'merge_duplicate', { mergeInto: second.id }),
        auditRecord(second, 'merge_duplicate', { mergeInto: first.id }),
      ],
    }), /Circular audit merge/);
    assert.throws(() => reduceAudit({
      preflightResult: checked,
      auditRecords: [
        auditRecord(first, 'reject_untraceable', { originRefs: [] }),
        auditRecord(second, 'merge_duplicate', { mergeInto: first.id }),
      ],
    }), /cannot target rejected proposal/);
    assert.throws(() => reduceAudit({
      preflightResult: checked,
      auditRecords: [auditRecord(first), auditRecord(second)],
      uncoveredRequestParts: [{
        question: 'An uncovered request part.',
        originRefs: ['request:900-999'],
        claimType: 'positive',
        proofCondition: 'Observe matching repository evidence.',
        constraints: [],
      }],
      revisionCount: 1,
    }), /Invalid uncovered request-part origin/);
  });

  goalAuditTest('Spec 028 T015 — mechanical and audited duplicates merge without losing origins or constraints', () => {
    const first = goalProposal({
      originRefs: [AUTH_ORIGIN, FULL_ORIGIN],
      constraints: ['Include the source body.'],
    });
    const mechanicalDuplicate = goalProposal({
      id: 'S2',
      originRefs: [TRACE_DEFINITION_SEED],
      constraints: ['Do not infer deployed state.'],
    });
    const mechanicallyMerged = preflight([first, mechanicalDuplicate]);

    assert.equal(mechanicallyMerged.auditCandidates.length, 1);
    assert.deepEqual(new Set(mechanicallyMerged.auditCandidates[0].originRefs),
      new Set([AUTH_ORIGIN, FULL_ORIGIN, TRACE_DEFINITION_SEED]));
    assert.deepEqual(new Set(mechanicallyMerged.auditCandidates[0].constraints),
      new Set(['Include the source body.', 'Do not infer deployed state.']));

    const semanticDuplicate = goalProposal({
      id: 'S2',
      question: 'Identify the authenticateUser declaration.',
      originRefs: [TRACE_DEFINITION_SEED],
      constraints: ['Preserve the requested boundary.'],
    });
    const semanticPreflight = preflight([first, semanticDuplicate]);
    const reduced = reduceAudit({
      preflightResult: semanticPreflight,
      auditRecords: [
        auditRecord(first, 'ready', { originRefs: [AUTH_ORIGIN] }),
        auditRecord(semanticDuplicate, 'merge_duplicate', { mergeInto: 'S1' }),
      ],
    });

    assert.equal(reduced.requiredSubgoals.length, 1);
    assert.deepEqual(new Set(reduced.requiredSubgoals[0].originRefs),
      new Set([AUTH_ORIGIN, TRACE_DEFINITION_SEED]));
    assert.equal(reduced.requiredSubgoals[0].originRefs.includes(FULL_ORIGIN), false,
      'only auditor-confirmed origins enter the required ledger');
    assert.ok(reduced.requiredSubgoals[0].constraints.includes('Preserve the requested boundary.'));
  });

  goalAuditTest('Spec 028 T069 — same-type origin containment gets one fail-closed refinement', () => {
    const broad = goalProposal({
      id: 'S-broad-origin',
      question: 'Compare the frontend and backend policy.',
      originRefs: [FULL_ORIGIN, TRACE_DEFINITION_SEED],
      claimType: 'comparison',
      proofCondition: 'Observe the frontend and backend policy paths.',
    });
    const nested = goalProposal({
      id: 'S-nested-origin',
      question: 'Compare the developer and admin policy.',
      originRefs: [AUTH_ORIGIN],
      claimType: 'comparison',
      proofCondition: 'Observe the developer and admin policy paths.',
    });
    const checked = preflight([broad, nested]);
    const records = [
      auditRecord(broad, 'ready', { originRefs: [FULL_ORIGIN] }),
      auditRecord(nested),
    ];

    const initial = reduceAudit({
      preflightResult: checked,
      auditRecords: records,
    });
    assert.deepEqual(initial.requiredSubgoals, []);
    assert.deepEqual(initial.gaps, []);
    assert.deepEqual(new Set(initial.revisionRequest.refineGoalIds),
      new Set([broad.id, nested.id]));
    assert.deepEqual(new Set(initial.revisionRequest.refineGoals.map(goal => goal.id)),
      new Set([broad.id, nested.id]));
    assert.deepEqual(initial.revisionRequest.refineGoals
      .find(goal => goal.id === broad.id).originRefs, [FULL_ORIGIN],
    'the refinement obligation uses auditor-confirmed rather than proposed origins');
    assert.deepEqual(initial.revisionRequest.decomposeGoalIds, []);
    assert.ok(initial.revisionRequest.diagnostics.every(item =>
      item.code === 'ambiguous_origin_binding'));

    const repeated = reduceAudit({
      preflightResult: checked,
      auditRecords: records,
      revisionCount: 1,
    });
    assert.equal(repeated.revisionRequest, null);
    assert.deepEqual(new Set(repeated.requiredSubgoals.map(goal => goal.id)),
      new Set([broad.id, nested.id]));
    assert.ok(repeated.requiredSubgoals.every(goal =>
      goal.auditVerdict === 'planning_incomplete' && goal.state === 'blocked'));
    assert.ok(repeated.gaps.every(gap => gap.reason === 'planning_incomplete'));
  });

  goalAuditTest('Spec 028 T069 — distinct facets and claim types do not trigger origin refinement', () => {
    const sharedDefinition = goalProposal({
      id: 'S-shared-definition',
      originRefs: [AUTH_ORIGIN, TRACE_DEFINITION_SEED],
      claimType: 'positive',
      question: 'Which shared definition governs the first surface?',
      proofCondition: 'Observe the first surface and shared definition.',
    });
    const sharedUsage = goalProposal({
      id: 'S-shared-usage',
      originRefs: [AUTH_ORIGIN, TRACE_USAGE_SEED],
      claimType: 'positive',
      question: 'Which shared definition governs the second surface?',
      proofCondition: 'Observe the second surface and shared definition.',
    });
    const differentType = goalProposal({
      id: 'S-different-type',
      originRefs: [AUTH_ORIGIN],
      claimType: 'absence',
      question: 'Is a legacy definition absent from this surface?',
      proofCondition: 'Enumerate the bounded surface and certify absence.',
    });
    const proposals = [sharedDefinition, sharedUsage, differentType];
    const reduced = reduceAudit({
      preflightResult: preflight(proposals),
      auditRecords: proposals.map(goal => auditRecord(goal)),
    });

    assert.deepEqual(reduced.requiredSubgoals.map(goal => goal.id),
      proposals.map(goal => goal.id));
    assert.equal(reduced.revisionRequest, null);

    const equalOrigins = [
      goalProposal({
        id: 'S-equal-one',
        originRefs: [AUTH_ORIGIN],
        claimType: 'positive',
        question: 'Which first fact is requested by this atomic phrase?',
        proofCondition: 'Observe the separately audited first fact.',
      }),
      goalProposal({
        id: 'S-equal-two',
        originRefs: [AUTH_ORIGIN],
        claimType: 'positive',
        question: 'Which second fact is requested by this atomic phrase?',
        proofCondition: 'Observe the separately audited second fact.',
      }),
    ];
    const equalReduced = reduceAudit({
      preflightResult: preflight(equalOrigins),
      auditRecords: equalOrigins.map(goal => auditRecord(goal)),
    });
    assert.deepEqual(equalReduced.requiredSubgoals.map(goal => goal.id),
      equalOrigins.map(goal => goal.id));
    assert.equal(equalReduced.revisionRequest, null,
      'equal audited origins do not create a noisy or impossible refinement');
  });

  goalAuditTest('Spec 028 T069 — a corrected goal cannot remain ambiguous with the preserved ledger', () => {
    const preserved = createRequiredSubgoal({
      ...goalProposal({ id: 'S-preserved', originRefs: [FULL_ORIGIN], claimType: 'comparison' }),
      auditVerdict: 'ready',
    });
    const corrected = goalProposal({
      id: 'S-corrected',
      originRefs: [AUTH_ORIGIN],
      claimType: 'comparison',
      question: 'Compare the corrected policy surface.',
      proofCondition: 'Observe the corrected policy surface independently.',
    });
    const reduced = reduceAudit({
      preflightResult: preflight([corrected]),
      auditRecords: [auditRecord(corrected)],
      revisionCount: 1,
      existingRequiredSubgoals: [preserved],
    });

    assert.equal(reduced.requiredSubgoals[0].id, corrected.id);
    assert.equal(reduced.requiredSubgoals[0].auditVerdict, 'planning_incomplete');
    assert.equal(reduced.gaps[0].reason, 'planning_incomplete');
  });

  goalAuditTest('Spec 028 T015 — circular proof conditions cannot be promoted by a ready audit verdict', () => {
    const proposals = [
      goalProposal({
        id: 'S1',
        proofCondition: 'The model is confident that the goal is complete.',
      }),
      goalProposal({
        id: 'S2',
        question: 'Is legacyLogin absent?',
        originRefs: [LEGACY_ORIGIN],
        claimType: 'absence',
        proofCondition: 'The final status says the answer is verified.',
      }),
    ];
    const checked = preflight(proposals);
    assert.deepEqual(
      checked.diagnostics.filter(item => item.code === 'circular_proof_condition')
        .map(item => item.proposedGoalId),
      ['S1', 'S2'],
    );
    const repositoryStatus = preflight([goalProposal({
      id: 'S-status',
      proofCondition: 'Observe that migration status is complete in the in-scope config.',
    })]);
    assert.deepEqual(repositoryStatus.diagnostics, [],
      'an observable repository status is not model self-verification');

    const reduced = reduceAudit({
      preflightResult: checked,
      auditRecords: proposals.map(proposal => auditRecord(proposal)),
    });
    assert.deepEqual(reduced.requiredSubgoals, []);
    assert.ok(reduced.revisionRequest,
      'the traceable requested parts still need observable proof conditions after correction');

    const covered = goalProposal({ id: 'S-covered' });
    const invented = goalProposal({
      id: 'S-circular-invention',
      question: 'Design an unrelated auth framework.',
      proofCondition: 'The model is confident that the design is excellent.',
    });
    const inventionReduced = reduceAudit({
      preflightResult: preflight([covered, invented]),
      auditRecords: [auditRecord(covered), auditRecord(invented, 'reject_untraceable')],
    });
    assert.deepEqual(inventionReduced.requiredSubgoals.map(goal => goal.id), [covered.id]);
    assert.equal(inventionReduced.revisionRequest, null,
      'a circular planner invention does not consume the revision when requested parts are covered');
  });

  goalAuditTest('Spec 028 T015 — untraceable inventions are discarded without becoming required gaps', () => {
    const requested = goalProposal();
    const invented = goalProposal({
      id: 'S-invented',
      question: 'Design a new authentication framework.',
      proofCondition: 'The proposed framework has a documented design.',
    });
    const reduced = reduceAudit({
      preflightResult: preflight([requested, invented]),
      auditRecords: [auditRecord(requested), auditRecord(invented, 'reject_untraceable')],
    });

    assert.deepEqual(reduced.requiredSubgoals.map(goal => goal.id), [requested.id]);
    assert.deepEqual(reduced.gaps, []);
    assert.equal(reduced.rejectedGoals[0].proposedGoalId, invented.id);
    assert.equal(reduced.revisionRequest, null,
      'a planner invention must not create work or block the covered requested goal');
  });

  goalAuditTest('Spec 028 T015 — every valid blocker becomes one terminal non-repairable required gap', () => {
    const blockerReasons = new Map([
      ['blocked_scope', 'scope_blocked'],
      ['blocked_capability', 'capability_blocked'],
      ['requires_external_state', 'external_state_required'],
      ['missing_input', 'missing_input'],
      ['contradictory', 'contradictory_request'],
      ['unverifiable', 'unverifiable'],
    ]);

    for (const [verdict, gapReason] of blockerReasons) {
      const proposal = goalProposal({ id: `S-${verdict}` });
      const reduced = reduceAudit({
        preflightResult: preflight([proposal]),
        auditRecords: [auditRecord(proposal, verdict)],
      });
      const [required] = reduced.requiredSubgoals;
      const [gap] = reduced.gaps;

      assert.equal(required.auditVerdict, verdict);
      assert.equal(required.state, 'blocked');
      assert.equal(typeof required.blockerRef, 'string');
      assert.ok(required.blockerRef.length > 0);
      assert.equal(gap.subgoalId, required.id);
      assert.equal(gap.reason, gapReason);
      assert.equal(gap.repairable, false, verdict);
      assert.equal(reduced.revisionRequest, null, verdict);
      assert.equal(reduceTrustState({ requiredSubgoals: [required] }), 'incomplete', verdict);
    }
  });

  goalAuditTest('Spec 028 T015 — difficulty and a refutable false premise remain feasible ready goals', () => {
    const difficult = goalProposal({
      id: 'S-large',
      question: 'Trace authenticateUser usages across the repository.',
      claimType: 'symbol_usage',
      proofCondition: 'Cross-check bounded usages independently of the definition lookup.',
    });
    const falsePremise = goalProposal({
      id: 'S-refute',
      question: 'Does the claimed legacyLogin registration exist?',
      originRefs: [LEGACY_ORIGIN],
      claimType: 'claim_verification',
      proofCondition: 'Support or refute the claim with direct evidence and bounded counterevidence search.',
    });
    const reduced = reduceAudit({
      preflightResult: preflight([difficult, falsePremise]),
      auditRecords: [
        auditRecord(difficult, 'ready', {
          reason: 'The repository is large and the search path is not obvious, but the goal is observable.',
        }),
        auditRecord(falsePremise),
      ],
    });

    assert.deepEqual(reduced.requiredSubgoals.map(goal => goal.state), ['audited', 'audited']);
    assert.deepEqual(reduced.requiredSubgoals.map(goal => goal.proofPolicy),
      ['bounded_usage_cross_check', 'support_or_refute']);
    assert.deepEqual(reduced.gaps, []);
    assert.equal(reduced.revisionRequest, null);
  });

  goalAuditTest('Spec 028 T015 — decomposition and missing request parts get one revision only', () => {
    const broad = goalProposal({
      id: 'S-broad',
      question: 'Establish both the authenticateUser definition and all bounded usages.',
      proofCondition: 'Observe the distinct definition and independent bounded-usage conditions.',
    });
    const uncovered = {
      question: 'Determine whether legacyLogin is absent.',
      originRefs: [LEGACY_ORIGIN],
      claimType: 'absence',
      proofCondition: 'Enumerate the bounded registration surface and certify absence.',
      constraints: [],
    };
    const checked = preflight([broad]);
    const records = [auditRecord(broad, 'needs_decomposition')];

    const initial = reduceAudit({
      preflightResult: checked,
      auditRecords: records,
      uncoveredRequestParts: [uncovered],
      revisionCount: 0,
    });
    assert.deepEqual(initial.revisionRequest.decomposeGoalIds, [broad.id]);
    assert.deepEqual(initial.revisionRequest.uncoveredRequestParts, [uncovered]);
    assert.deepEqual(initial.requiredSubgoals, []);
    assert.deepEqual(initial.gaps, []);

    const correctedGoals = [
      goalProposal({ id: 'S-definition' }),
      goalProposal({
        id: 'S-usage',
        question: 'Where is authenticateUser used?',
        originRefs: [AUTH_ORIGIN, TRACE_USAGE_SEED],
        claimType: 'symbol_usage',
        proofCondition: 'Cross-check bounded usages independently of the definition lookup.',
      }),
      goalProposal({
        id: 'S-absence',
        ...uncovered,
      }),
    ];
    const corrected = reduceAudit({
      preflightResult: preflight(correctedGoals),
      auditRecords: correctedGoals.map(goal => auditRecord(goal)),
      revisionCount: 1,
    });
    assert.deepEqual(corrected.requiredSubgoals.map(goal => goal.id),
      ['S-definition', 'S-usage', 'S-absence']);
    assert.ok(corrected.requiredSubgoals.every(goal => goal.state === 'audited'));
    assert.deepEqual(corrected.gaps, []);
    assert.equal(corrected.revisionRequest, null);

    const afterRevision = reduceAudit({
      preflightResult: checked,
      auditRecords: records,
      uncoveredRequestParts: [uncovered],
      revisionCount: 1,
    });
    assert.equal(afterRevision.revisionRequest, null, 'recursive re-planning is forbidden');
    assert.equal(afterRevision.requiredSubgoals.length, 2);
    assert.equal(afterRevision.gaps.length, 2);
    assert.ok(afterRevision.requiredSubgoals.every(goal =>
      goal.auditVerdict === 'planning_incomplete' && goal.state === 'blocked'));
    assert.ok(afterRevision.gaps.every(gap =>
      gap.reason === 'planning_incomplete' && gap.repairable === false));
    assert.ok(afterRevision.gaps.every(gap => Number.isInteger(gap.priority)));
    assert.equal(new Set(afterRevision.requiredSubgoals.map(goal => goal.id)).size, 2);
    assert.ok(afterRevision.requiredSubgoals.every(goal => typeof goal.id === 'string' && goal.id));
    assert.deepEqual(new Set(afterRevision.requiredSubgoals.map(goal => goal.question)),
      new Set([broad.question, uncovered.question]));
    assert.deepEqual(new Set(afterRevision.requiredSubgoals.flatMap(goal => goal.originRefs)),
      new Set([AUTH_ORIGIN, LEGACY_ORIGIN]));
    for (const gap of afterRevision.gaps) {
      assert.ok(afterRevision.requiredSubgoals.some(goal => goal.id === gap.subgoalId));
    }
    assert.deepEqual(reduceAudit({
      preflightResult: checked,
      auditRecords: records,
      uncoveredRequestParts: [uncovered],
      revisionCount: 1,
    }), afterRevision, 'second-pass materialization must be deterministic');
    assert.equal(reduceTrustState({ requiredSubgoals: afterRevision.requiredSubgoals }), 'incomplete');
  });

  const claimReductionTest = test;

  function candidateGoal(id, claimRefs, claimType = 'positive') {
    const audited = createAuditedSubgoal({
      id,
      claimType,
      question: 'Resolve requested part ' + id + '.',
      proofCondition: claimType === 'claim_verification'
        ? 'Support or refute the supplied premise with bounded evidence.'
        : 'Observe evidence that resolves requested part ' + id + '.',
    });
    return transitionSubgoal(
      transitionSubgoal(audited, 'exploring'),
      'candidate',
      { claimRefs },
    );
  }

  function atomicClaim(id, {
    subgoalId = 'S' + id.slice(1),
    evidenceRefs = ['E' + id.slice(1)],
    text = 'Atomic answer ' + id + '.',
  } = {}) {
    return createAtomicClaim({ id, subgoalId, text, evidenceRefs });
  }

  function semanticVerdict(claimId, result = 'supported', {
    supportingEvidenceRefs = ['E' + claimId.slice(1)],
    resolution = result === 'supported' ? 'affirmed' : null,
  } = {}) {
    return {
      claimId,
      result,
      supportingEvidenceRefs,
      reasonCode: result === 'supported' ? 'entailed' :
        result === 'contradicted' ? 'contradiction' : 'semantic_mismatch',
      note: 'Verifier returned ' + result + '.',
      ...(resolution ? { resolution } : {}),
    };
  }

  function evidenceLink(subgoalId, ...evidenceRefs) {
    return { subgoalId, evidenceRefs };
  }

  function reduceClaims(input) {
    assert.equal(typeof coverageModule.reduceSemanticClaims, 'function');
    return coverageModule.reduceSemanticClaims(input);
  }

  const claimStates = result => result.claims
    .map(claim => [claim.id, claim.verdict]).sort();
  const goalStates = result => result.requiredSubgoals
    .map(goal => [goal.id, goal.state, goal.resolution]);
  const gapStates = result => result.gaps
    .map(gap => [gap.subgoalId, gap.reason]);

  claimReductionTest('Spec 028 T024 — supported atomic claim preserves text and affirms one goal', () => {
    const claim = atomicClaim('C1', {
      text: 'The current implementation exports authenticateUser.',
    });
    const result = reduceClaims({
      requiredSubgoals: [candidateGoal('S1', ['C1'])],
      claims: [claim],
      semanticVerdicts: [semanticVerdict('C1')],
      evidenceBySubgoal: [evidenceLink('S1', 'E1')],
    });

    assert.deepEqual(result.claims, [{ ...claim, verdict: 'supported' }]);
    assert.deepEqual(goalStates(result), [['S1', 'supported', 'affirmed']]);
    assert.deepEqual(result.gaps, []);
  });

  test('Spec 028 T032 — every atomic claim must agree before a goal is supported', () => {
    const claims = [
      atomicClaim('C1'),
      atomicClaim('C2', { subgoalId: 'S1', evidenceRefs: ['E2'] }),
    ];
    const base = {
      requiredSubgoals: [candidateGoal('S1', ['C1', 'C2'])],
      claims,
      evidenceBySubgoal: [evidenceLink('S1', 'E1', 'E2')],
    };
    const contradicted = reduceClaims({
      ...base,
      semanticVerdicts: [
        semanticVerdict('C1'),
        semanticVerdict('C2', 'contradicted', { supportingEvidenceRefs: [] }),
      ],
    });
    assert.deepEqual(goalStates(contradicted), [['S1', 'contradicted', undefined]]);
    assert.deepEqual(gapStates(contradicted), [['S1', 'contradicted']]);

    const incomplete = reduceClaims({
      ...base,
      semanticVerdicts: [
        semanticVerdict('C1'),
        semanticVerdict('C2', 'insufficient', { supportingEvidenceRefs: [] }),
      ],
    });
    assert.deepEqual(goalStates(incomplete), [['S1', 'gap', undefined]]);
    assert.deepEqual(gapStates(incomplete), [['S1', 'semantic_mismatch']]);
  });

  claimReductionTest('Spec 028 T024 — supported refutation resolves a goal but contradiction alone does not', () => {
    const premise = atomicClaim('C1', {
      text: 'The claimed legacyLogin registration exists.',
    });
    const refutation = atomicClaim('C2', {
      subgoalId: 'S1',
      text: 'The claimed registration is absent within the certified boundary.',
    });
    const evidenceBySubgoal = [evidenceLink('S1', 'E1', 'E2')];

    const contradictedOnly = reduceClaims({
      requiredSubgoals: [candidateGoal('S1', ['C1'], 'claim_verification')],
      claims: [premise],
      semanticVerdicts: [semanticVerdict('C1', 'contradicted')],
      evidenceBySubgoal,
    });
    assert.deepEqual(claimStates(contradictedOnly), [['C1', 'contradicted']]);
    assert.deepEqual(goalStates(contradictedOnly), [['S1', 'contradicted', undefined]]);
    assert.deepEqual(gapStates(contradictedOnly), [['S1', 'contradicted']]);

    const resolved = reduceClaims({
      requiredSubgoals: [candidateGoal('S1', ['C1', 'C2'], 'claim_verification')],
      claims: [premise, refutation],
      semanticVerdicts: [
        semanticVerdict('C1', 'contradicted'),
        semanticVerdict('C2', 'supported', { resolution: 'refuted' }),
      ],
      evidenceBySubgoal,
    });
    assert.deepEqual(goalStates(resolved), [['S1', 'supported', 'refuted']]);

    const invalidVerdicts = [
      semanticVerdict('C2', 'supported', { resolution: null }),
      semanticVerdict('C1', 'contradicted', { resolution: 'refuted' }),
    ];
    for (const verdict of invalidVerdicts) {
      const claim = verdict.claimId === 'C1' ? premise : refutation;
      assert.throws(() => reduceClaims({
        requiredSubgoals: [candidateGoal('S1', [claim.id], 'claim_verification')],
        claims: [claim],
        semanticVerdicts: [verdict],
        evidenceBySubgoal,
      }), TypeError);
    }

    const conflicting = {
      requiredSubgoals: [candidateGoal('S1', ['C1', 'C2'], 'claim_verification')],
      claims: [premise, refutation],
      semanticVerdicts: [
        semanticVerdict('C1', 'supported', { resolution: 'affirmed' }),
        semanticVerdict('C2', 'supported', { resolution: 'refuted' }),
      ],
      evidenceBySubgoal,
    };
    const conflictResult = reduceClaims(conflicting);
    assert.deepEqual(goalStates(conflictResult), [['S1', 'contradicted', undefined]]);
    assert.deepEqual(gapStates(conflictResult), [['S1', 'contradicted']]);
  });

  claimReductionTest('Spec 028 T024 — claim, goal, and verdict relationships fail closed', () => {
    const claim = atomicClaim('C1');
    const verdict = semanticVerdict('C1');
    const base = {
      requiredSubgoals: [candidateGoal('S1', ['C1'])],
      claims: [claim],
      semanticVerdicts: [verdict],
      evidenceBySubgoal: [evidenceLink('S1', 'E1')],
    };
    const invalidControls = [
      { claims: [claim, { ...claim }] },
      { claims: [{ ...claim, subgoalId: 'unknown-subgoal' }] },
      { requiredSubgoals: [candidateGoal('S1', ['C1', 'C9'])] },
      {
        requiredSubgoals: [
          candidateGoal('S1', ['C2']),
          candidateGoal('S2', ['C1']),
        ],
        claims: [claim, atomicClaim('C2')],
        semanticVerdicts: [verdict, semanticVerdict('C2')],
        evidenceBySubgoal: [evidenceLink('S1', 'E1'), evidenceLink('S2', 'E2')],
      },
      { semanticVerdicts: [] },
      { semanticVerdicts: [verdict, { ...verdict }] },
      { semanticVerdicts: [semanticVerdict('C9', 'supported', {
        supportingEvidenceRefs: ['E1'],
      })] },
    ];

    for (const override of invalidControls) {
      assert.throws(() => reduceClaims({ ...base, ...override }), TypeError);
    }
  });

  claimReductionTest('Spec 028 T024 — evidence subsets and subgoal boundaries gate claim support', () => {
    const baseClaim = atomicClaim('C1');
    const base = {
      requiredSubgoals: [candidateGoal('S1', ['C1'])],
      claims: [baseClaim],
      evidenceBySubgoal: [evidenceLink('S1', 'E1')],
    };
    for (const verdict of [
      semanticVerdict('C1', 'supported', { supportingEvidenceRefs: [] }),
      semanticVerdict('C1', 'supported', { supportingEvidenceRefs: ['E9'] }),
    ]) {
      assert.throws(() => reduceClaims({
        ...base,
        semanticVerdicts: [verdict],
      }), TypeError);
    }

    const sibling = atomicClaim('C2');
    const invalidCandidates = [
      {
        claim: atomicClaim('C1', { evidenceRefs: ['E1', 'E2'] }),
        evidenceBySubgoal: [evidenceLink('S1', 'E1'), evidenceLink('S2', 'E2')],
      },
      {
        claim: atomicClaim('C1', { evidenceRefs: ['E9'] }),
        evidenceBySubgoal: [evidenceLink('S1', 'E1'), evidenceLink('S2', 'E2')],
      },
    ];
    for (const fixture of invalidCandidates) {
      const result = reduceClaims({
        requiredSubgoals: [
          candidateGoal('S1', ['C1']),
          candidateGoal('S2', ['C2']),
        ],
        claims: [fixture.claim, sibling],
        semanticVerdicts: [
          semanticVerdict('C1', 'supported', {
            supportingEvidenceRefs: [fixture.claim.evidenceRefs[0]],
          }),
          semanticVerdict('C2'),
        ],
        evidenceBySubgoal: fixture.evidenceBySubgoal,
      });
      assert.equal(result.claims.find(claim => claim.id === 'C1').verdict, 'insufficient');
      assert.notEqual(result.requiredSubgoals[0].state, 'supported');
      assert.equal(result.requiredSubgoals[1].state, 'supported');
    }
  });

  claimReductionTest('Spec 028 T024 — request coverage and reduction are deterministic', () => {
    const claims = [atomicClaim('C1'), atomicClaim('C2')];
    const semanticVerdicts = [
      semanticVerdict('C1'),
      semanticVerdict('C2', 'insufficient'),
    ];
    const evidenceBySubgoal = [
      evidenceLink('S1', 'E1'),
      evidenceLink('S2', 'E2'),
    ];
    const blocked = createAuditedSubgoal({
      id: 'S3',
      auditVerdict: 'blocked_scope',
      blockerRef: 'G3',
    });
    const blockerGap = createCoverageGap({
      id: 'G3',
      subgoalId: 'S3',
      question: blocked.question,
      reason: 'scope_blocked',
      repairable: false,
    }, {
      requestOrder: 2,
      proofPolicy: blocked.proofPolicy,
    });
    const input = {
      requiredSubgoals: [
        candidateGoal('S1', ['C1']),
        candidateGoal('S2', ['C2']),
        blocked,
      ],
      existingGaps: [blockerGap],
      claims,
      semanticVerdicts,
      evidenceBySubgoal,
    };
    const snapshot = structuredClone(input);
    const forward = reduceClaims(input);
    const reversed = reduceClaims({
      ...input,
      claims: [...claims].reverse(),
      semanticVerdicts: [...semanticVerdicts].reverse(),
      evidenceBySubgoal: [...evidenceBySubgoal].reverse(),
    });

    assert.deepEqual(input, snapshot);
    assert.deepEqual(reversed.requiredSubgoals, forward.requiredSubgoals);
    assert.deepEqual(reversed.gaps, forward.gaps);
    assert.deepEqual(claimStates(reversed), claimStates(forward));
    assert.deepEqual(goalStates(forward), [
      ['S1', 'supported', 'affirmed'],
      ['S2', 'gap', undefined],
      ['S3', 'blocked', undefined],
    ]);
    assert.deepEqual(claimStates(forward), [['C1', 'supported'], ['C2', 'insufficient']]);
    assert.deepEqual(gapStates(forward), [
      ['S2', 'semantic_mismatch'],
      ['S3', 'scope_blocked'],
    ]);
    assert.equal(reduceTrustState({ requiredSubgoals: forward.requiredSubgoals }), 'incomplete');
  });

  test('Spec 028 T030 — an active goal with no claims becomes a missing-evidence gap', () => {
    const audited = createAuditedSubgoal({ id: 'S-empty' });
    const result = reduceClaims({
      requiredSubgoals: [audited],
      claims: [],
      semanticVerdicts: [],
      evidenceBySubgoal: [{ subgoalId: audited.id, evidenceRefs: [] }],
    });

    assert.deepEqual(goalStates(result), [['S-empty', 'gap', undefined]]);
    assert.deepEqual(gapStates(result), [['S-empty', 'missing_evidence']]);
  });

  test('Spec 028 T032 — post-repair gaps require fresh proof and preserve attempted actions', () => {
    const candidate = candidateGoal('S1', ['C1']);
    const existingGap = {
      ...createCoverageGap({
        id: 'semantic-gap:S1',
        subgoalId: 'S1',
        question: candidate.question,
        reason: 'semantic_mismatch',
        repairable: false,
      }, { requestOrder: 0, proofPolicy: candidate.proofPolicy }),
      attemptedActionFingerprints: ['sha256:attempted'],
    };
    const oldOnly = atomicClaim('C1', { evidenceRefs: ['E1', 'E2'] });
    const stalePromotion = reduceClaims({
      phase: 'post-repair',
      freshEvidenceRefs: ['E2'],
      requiredSubgoals: [candidate],
      existingGaps: [existingGap],
      claims: [oldOnly],
      semanticVerdicts: [semanticVerdict('C1', 'supported', {
        supportingEvidenceRefs: ['E1'],
      })],
      evidenceBySubgoal: [evidenceLink('S1', 'E1', 'E2')],
    });

    assert.deepEqual(claimStates(stalePromotion), [['C1', 'supported']]);
    assert.deepEqual(goalStates(stalePromotion), [['S1', 'gap', undefined]]);
    assert.equal(stalePromotion.gaps[0].repairable, false);
    assert.deepEqual(stalePromotion.gaps[0].attemptedActionFingerprints,
      ['sha256:attempted']);
    assert.equal(stalePromotion.gaps[0].followUp, undefined);
    assert.throws(() => reduceClaims({
      phase: 'post-repair',
      freshEvidenceRefs: ['E2'],
      requiredSubgoals: [candidate],
      existingGaps: [existingGap, { ...existingGap, id: 'semantic-gap:S1:duplicate' }],
      claims: [oldOnly],
      semanticVerdicts: [semanticVerdict('C1', 'supported', {
        supportingEvidenceRefs: ['E1'],
      })],
      evidenceBySubgoal: [evidenceLink('S1', 'E1', 'E2')],
    }), /multiple existing gaps/i);

    const refreshed = atomicClaim('C1', { evidenceRefs: ['E1', 'E2'] });
    const supported = reduceClaims({
      phase: 'post-repair',
      freshEvidenceRefs: ['E2'],
      requiredSubgoals: [candidate],
      existingGaps: [existingGap],
      claims: [refreshed],
      semanticVerdicts: [semanticVerdict('C1', 'supported', {
        supportingEvidenceRefs: ['E2'],
      })],
      evidenceBySubgoal: [evidenceLink('S1', 'E1', 'E2')],
    });
    assert.deepEqual(goalStates(supported), [['S1', 'supported', 'affirmed']]);
    assert.deepEqual(supported.gaps, []);

    const multiCandidate = candidateGoal('S-multi', ['C-old', 'C-fresh']);
    const multiGap = {
      ...existingGap,
      id: 'semantic-gap:S-multi',
      subgoalId: 'S-multi',
      question: multiCandidate.question,
    };
    const supportedByCombinedEvidence = reduceClaims({
      phase: 'post-repair',
      freshEvidenceRefs: ['E2'],
      requiredSubgoals: [multiCandidate],
      existingGaps: [multiGap],
      claims: [
        atomicClaim('C-old', { subgoalId: 'S-multi', evidenceRefs: ['E1'] }),
        atomicClaim('C-fresh', { subgoalId: 'S-multi', evidenceRefs: ['E2'] }),
      ],
      semanticVerdicts: [
        semanticVerdict('C-old', 'supported', {
          supportingEvidenceRefs: ['E1'],
        }),
        semanticVerdict('C-fresh', 'supported', {
          supportingEvidenceRefs: ['E2'],
        }),
      ],
      evidenceBySubgoal: [evidenceLink('S-multi', 'E1', 'E2')],
    });
    assert.deepEqual(claimStates(supportedByCombinedEvidence), [
      ['C-fresh', 'supported'],
      ['C-old', 'supported'],
    ]);
    assert.deepEqual(goalStates(supportedByCombinedEvidence), [
      ['S-multi', 'supported', 'affirmed'],
    ]);
    assert.deepEqual(supportedByCombinedEvidence.gaps, []);
  });
