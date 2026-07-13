import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAtomicClaim,
  createCoverageGap,
  createRequiredSubgoal,
  createSafetyLimit,
  createTaskContract,
  deriveGapPriority,
  fingerprintAction,
  mergeSafetyLimit,
  reduceTrustState,
  transitionSubgoal,
} from '../src/explorer/coverage.mjs';

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
  });

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

  contractTest('Spec 028 T005 — SafetyLimit names exact ceilings and never accepts a generic budget', () => {
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
      name: 'budget',
      stage: 'exploration',
      affectedSubgoalIds: ['S1'],
      truncated: true,
    }), /safety limit|budget/i);
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
    });
    assert.equal(reopened.state, 'candidate');
    assert.equal(reopened.resolution, undefined);
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
