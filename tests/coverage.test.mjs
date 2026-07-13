import test from 'node:test';
import assert from 'node:assert/strict';
import * as coverageModule from '../src/explorer/coverage.mjs';
import {
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
  }) {
    assert.equal(typeof coverageModule.reduceGoalAudit, 'function');
    return coverageModule.reduceGoalAudit({
      preflight: preflightResult,
      auditRecords,
      uncoveredRequestParts,
      revisionCount,
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
