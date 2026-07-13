import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ABSENCE_CERTIFICATE_SCHEMA,
  ATOMIC_CLAIM_SCHEMA,
  EXPLORE_REPO_INPUT_SCHEMA,
  EXPLORE_REPO_OUTPUT_SCHEMA,
  EXPLORE_RESULT_JSON_SCHEMA,
  GOAL_AUDIT_RECORD_SCHEMA,
  RETRY_SCHEMA,
  SAFETY_LIMIT_SCHEMA,
  SEMANTIC_VERDICT_SCHEMA,
  TASK_CONTRACT_SCHEMA,
  computeConfidenceScore,
  normalizeExploreResult,
  reconcileConfidence,
  validateAbsenceCertificate,
  validateAtomicClaim,
  validateExploreRepoArgs,
  validateGoalAuditRecord,
  validateSafetyLimit,
  validateSemanticVerdict,
  validateTaskContract,
} from '../src/explorer/schemas.mjs';
import { RETRY_TOOLS } from '../src/explorer/runtime.mjs';

function internalSchemaTest(schema, validate, name, callback) {
  test(name, () => {
    callback(schema, validate);
  });
}

function assertStrictObjectTree(schema, label) {
  function visit(node, path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.type === 'object' || node.properties !== undefined) {
      assert.equal(node.type, 'object', `${label} ${path} must declare object type`);
      assert.equal(node.additionalProperties, false,
        `${label} ${path} must reject additional properties`);
      assert.ok(node.properties && typeof node.properties === 'object',
        `${label} ${path} must declare properties`);
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      visit(child, `${path}.properties.${key}`);
    }
    if (node.items) visit(node.items, `${path}.items`);
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      for (const [index, child] of (node[keyword] ?? []).entries()) {
        visit(child, `${path}.${keyword}[${index}]`);
      }
    }
    for (const [key, child] of Object.entries(node.$defs ?? {})) {
      visit(child, `${path}.$defs.${key}`);
    }
  }

  visit(schema, '$');
}

function assertSchemaKeys(schema, { required, optional = [] }, label) {
  assert.deepEqual(new Set(schema.required), new Set(required),
    `${label} required fields drifted`);
  assert.deepEqual(new Set(Object.keys(schema.properties)), new Set([...required, ...optional]),
    `${label} property set drifted`);
}

function assertStringArraySchema(schema, label) {
  assert.equal(schema.type, 'array', `${label} must be an array`);
  assert.equal(schema.items?.type, 'string', `${label} must contain strings`);
}

function assertStringProperties(schema, keys, label) {
  for (const key of keys) {
    assert.equal(schema.properties[key]?.type, 'string', `${label}.${key} must be a string`);
  }
}

function assertStrictValidator(validate, validValue, { missingKey, makeInvalid }) {
  assert.doesNotThrow(() => validate(structuredClone(validValue)));

  const withUnknownKey = structuredClone(validValue);
  withUnknownKey.unexpected = true;
  assert.throws(() => validate(withUnknownKey),
    'additionalProperties:false must be enforced at runtime');

  const missingRequired = structuredClone(validValue);
  delete missingRequired[missingKey];
  assert.throws(() => validate(missingRequired),
    'missing required fields must be rejected at runtime');

  const invalid = structuredClone(validValue);
  makeInvalid(invalid);
  assert.throws(() => validate(invalid),
    'invalid enum/type values must be rejected at runtime');
}

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

test('computeConfidenceScore: single exact evidence from one file can reach medium or high', () => {
  // With recalibrated base scores: 1 exact item from 1 file
  // base=0.30 + exact=0.18 + search=0 = 0.48 → medium, or higher with search
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const { level } = computeConfidenceScore(evidence, 1, makeStats());
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: two exact items from two different files can be high', () => {
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/b.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 2, makeStats({ grepCalls: 1 }));
  // With recalibrated scores: base=0.30 + 2*exact=0.36 + cross=0.12 + search=0.05 = 0.83 → high
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: two exact items from same file can reach high (relaxed gate)', () => {
  // Same path → distinctFiles = 1, but 2 exact items satisfy the relaxed gate (exactCount >= 1)
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 2, makeStats({ grepCalls: 1 }));
  // base=0.30 + 2*exact=0.36 + search=0.05 = 0.71 → high (no longer capped for single-file)
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
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
    droppedEvidence: 1,
    stoppedByBudget: false,
  });
  assert.equal(result, 'low', 'dropped evidence must force computed level');
});

test('reconcileConfidence: always returns computedLevel when stoppedByBudget', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
    stoppedByBudget: true,
  });
  assert.equal(result, 'medium', 'stoppedByBudget must force computed level');
});

test('reconcileConfidence: locate still takes the lower of model and computed confidence', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'medium', 'locate must not bypass computed confidence');
});

test('reconcileConfidence: non-locate takes the lower of model and computed', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'medium', 'non-locate must take the lower confidence');
});

test('reconcileConfidence: model low is preserved even when computed is high', () => {
  const result = reconcileConfidence({
    modelConfidence: 'low',
    computedLevel: 'high',
    droppedEvidence: 0,
    stoppedByBudget: false,
  });
  assert.equal(result, 'low', 'lower of model/computed wins; here model=low');
});

test('agent-facing strategy hint stays advanced only and budget input was removed in spec 011', () => {
  assert.equal(
    EXPLORE_REPO_INPUT_SCHEMA.properties.budget,
    undefined,
    'spec 011: budget input was removed',
  );
  assert.match(
    EXPLORE_REPO_INPUT_SCHEMA.properties.hints.properties.strategy.description,
    /Advanced only/,
  );
});

// Named T010 imports keep these trust-plane contracts fail-closed if an export
// is removed or renamed later.
function makeValidRequiredSubgoal(overrides = {}) {
  return {
    id: 'S1',
    question: 'Where is the auth policy defined?',
    originRefs: ['request:0-32'],
    claimType: 'positive',
    proofPolicy: 'direct_source',
    proofCondition: 'Observe the in-scope implementation.',
    constraints: [],
    auditVerdict: 'ready',
    state: 'audited',
    claimRefs: [],
    ...overrides,
  };
}

function makeValidTaskContract() {
  return {
    task: 'Find the auth policy implementation.',
    effectiveScope: ['src'],
    constraints: [],
    capabilities: {
      repositoryRead: true,
      gitRead: true,
      repositoryWrite: false,
      liveRuntimeState: false,
      scopeWidening: false,
      secretPathRead: false,
    },
    subgoals: [makeValidRequiredSubgoal()],
    plannerVersion: 'planner-v1',
    goalAuditVersion: 'goal-audit-v1',
  };
}

internalSchemaTest(
  TASK_CONTRACT_SCHEMA,
  validateTaskContract,
  'Spec 028 T006 — TaskContract and runtime-owned nested entities are strict',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'TASK_CONTRACT_SCHEMA');
    assertSchemaKeys(schema, {
      required: [
        'task',
        'effectiveScope',
        'constraints',
        'capabilities',
        'subgoals',
        'plannerVersion',
        'goalAuditVersion',
      ],
    }, 'TASK_CONTRACT_SCHEMA');
    assert.equal(schema.properties.task.type, 'string');
    assertStringArraySchema(schema.properties.effectiveScope,
      'TASK_CONTRACT_SCHEMA.effectiveScope');
    assertStringArraySchema(schema.properties.constraints,
      'TASK_CONTRACT_SCHEMA.constraints');
    assert.equal(schema.properties.subgoals.type, 'array');
    assert.equal(schema.properties.subgoals.maxItems, undefined,
      '12 is a processing batch size, not a semantic subgoal cap');
    assert.equal(schema.properties.plannerVersion.type, 'string');
    assert.equal(schema.properties.goalAuditVersion.type, 'string');

    const capabilitySchema = schema.properties.capabilities;
    assertSchemaKeys(capabilitySchema, {
      required: [
        'repositoryRead',
        'gitRead',
        'repositoryWrite',
        'liveRuntimeState',
        'scopeWidening',
        'secretPathRead',
      ],
    }, 'TASK_CONTRACT_SCHEMA.capabilities');
    assert.equal(capabilitySchema.properties.repositoryRead.const, true);
    assert.equal(capabilitySchema.properties.gitRead.const, true);
    assert.equal(capabilitySchema.properties.repositoryWrite.const, false);
    assert.equal(capabilitySchema.properties.liveRuntimeState.const, false);
    assert.equal(capabilitySchema.properties.scopeWidening.const, false);
    assert.equal(capabilitySchema.properties.secretPathRead.const, false);

    const subgoalSchema = schema.properties.subgoals.items;
    assertSchemaKeys(subgoalSchema, {
      required: [
        'id',
        'question',
        'originRefs',
        'claimType',
        'proofPolicy',
        'proofCondition',
        'constraints',
        'auditVerdict',
        'state',
        'claimRefs',
      ],
      optional: ['resolution', 'blockerRef', 'gapRef'],
    }, 'TASK_CONTRACT_SCHEMA.subgoals[]');
    assertStringProperties(subgoalSchema, [
      'id',
      'question',
      'claimType',
      'proofPolicy',
      'proofCondition',
      'auditVerdict',
      'state',
      'resolution',
      'blockerRef',
      'gapRef',
    ], 'TASK_CONTRACT_SCHEMA.subgoals[]');
    assertStringArraySchema(subgoalSchema.properties.originRefs,
      'TASK_CONTRACT_SCHEMA.subgoals[].originRefs');
    assert.equal(subgoalSchema.properties.originRefs.minItems, 1);
    assertStringArraySchema(subgoalSchema.properties.constraints,
      'TASK_CONTRACT_SCHEMA.subgoals[].constraints');
    assertStringArraySchema(subgoalSchema.properties.claimRefs,
      'TASK_CONTRACT_SCHEMA.subgoals[].claimRefs');
    assert.deepEqual(subgoalSchema.properties.claimType.enum, [
      'positive',
      'absence',
      'count',
      'symbol_definition',
      'symbol_usage',
      'flow',
      'impact',
      'comparison',
      'claim_verification',
    ]);
    assert.deepEqual(subgoalSchema.properties.proofPolicy.enum, [
      'direct_source',
      'bounded_absence',
      'deterministic_count',
      'symbol_definition',
      'bounded_usage_cross_check',
      'ordered_handoffs',
      'impact_categories',
      'distinct_policy_paths',
      'support_or_refute',
    ]);
    assert.deepEqual(subgoalSchema.properties.auditVerdict.enum, [
      'ready',
      'blocked_scope',
      'blocked_capability',
      'requires_external_state',
      'missing_input',
      'contradictory',
      'unverifiable',
      'planning_incomplete',
    ]);
    assert.deepEqual(subgoalSchema.properties.state.enum, [
      'audited',
      'blocked',
      'exploring',
      'candidate',
      'supported',
      'gap',
      'contradicted',
    ]);
    assert.deepEqual(subgoalSchema.properties.resolution.enum, ['affirmed', 'refuted']);

    const valid = makeValidTaskContract();
    assertStrictValidator(validate, valid, {
      missingKey: 'task',
      makeInvalid: value => { value.subgoals[0].state = 'done'; },
    });
    const nestedExtra = structuredClone(valid);
    nestedExtra.subgoals[0].priority = 1;
    assert.throws(() => validate(nestedExtra));
    const capabilityExtra = structuredClone(valid);
    capabilityExtra.capabilities.networkRead = true;
    assert.throws(() => validate(capabilityExtra));
    const capabilityEscalation = structuredClone(valid);
    capabilityEscalation.capabilities.repositoryWrite = true;
    assert.throws(() => validate(capabilityEscalation));
    const emptyOrigin = structuredClone(valid);
    emptyOrigin.subgoals[0].originRefs = [];
    assert.throws(() => validate(emptyOrigin));
    const invalidConstraint = structuredClone(valid);
    invalidConstraint.constraints = [null];
    assert.throws(() => validate(invalidConstraint));
    const emptyTask = structuredClone(valid);
    emptyTask.task = '';
    assert.throws(() => validate(emptyTask));
  },
);

internalSchemaTest(
  GOAL_AUDIT_RECORD_SCHEMA,
  validateGoalAuditRecord,
  'Spec 028 T006 — goal-audit records are strict and categorical',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'GOAL_AUDIT_RECORD_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['proposedGoalId', 'verdict', 'originRefs', 'missingRequestParts', 'reason'],
      optional: ['mergeInto'],
    }, 'GOAL_AUDIT_RECORD_SCHEMA');
    assertStringArraySchema(schema.properties.originRefs,
      'GOAL_AUDIT_RECORD_SCHEMA.originRefs');
    assertStringArraySchema(schema.properties.missingRequestParts,
      'GOAL_AUDIT_RECORD_SCHEMA.missingRequestParts');
    assertStringProperties(schema, [
      'proposedGoalId',
      'verdict',
      'mergeInto',
      'reason',
    ], 'GOAL_AUDIT_RECORD_SCHEMA');
    assert.deepEqual(schema.properties.verdict.enum, [
      'ready',
      'merge_duplicate',
      'needs_decomposition',
      'reject_untraceable',
      'blocked_scope',
      'blocked_capability',
      'requires_external_state',
      'missing_input',
      'contradictory',
      'unverifiable',
    ]);

    assertStrictValidator(validate, {
      proposedGoalId: 'S1',
      verdict: 'ready',
      originRefs: ['request:0-32'],
      missingRequestParts: [],
      reason: 'Traceable and observable.',
    }, {
      missingKey: 'proposedGoalId',
      makeInvalid: value => { value.verdict = 'approved'; },
    });
  },
);

internalSchemaTest(
  ATOMIC_CLAIM_SCHEMA,
  validateAtomicClaim,
  'Spec 028 T006 — atomic claims are strict and carry one runtime verdict',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'ATOMIC_CLAIM_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['id', 'subgoalId', 'text', 'evidenceRefs', 'verdict'],
    }, 'ATOMIC_CLAIM_SCHEMA');
    assertStringArraySchema(schema.properties.evidenceRefs,
      'ATOMIC_CLAIM_SCHEMA.evidenceRefs');
    assertStringProperties(schema, [
      'id',
      'subgoalId',
      'text',
      'verdict',
    ], 'ATOMIC_CLAIM_SCHEMA');
    assert.equal(schema.properties.evidenceRefs.minItems, 1);
    assert.deepEqual(schema.properties.verdict.enum, [
      'pending',
      'supported',
      'insufficient',
      'contradicted',
    ]);

    assertStrictValidator(validate, {
      id: 'C1',
      subgoalId: 'S1',
      text: 'The policy is defined in src/auth.mjs.',
      evidenceRefs: ['E1'],
      verdict: 'pending',
    }, {
      missingKey: 'id',
      makeInvalid: value => { value.verdict = 'verified'; },
    });
  },
);

internalSchemaTest(
  SEMANTIC_VERDICT_SCHEMA,
  validateSemanticVerdict,
  'Spec 028 T006 — semantic verdicts are strict and cannot rewrite claims',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'SEMANTIC_VERDICT_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['claimId', 'result', 'supportingEvidenceRefs', 'reasonCode', 'note'],
    }, 'SEMANTIC_VERDICT_SCHEMA');
    assertStringArraySchema(schema.properties.supportingEvidenceRefs,
      'SEMANTIC_VERDICT_SCHEMA.supportingEvidenceRefs');
    assertStringProperties(schema, [
      'claimId',
      'result',
      'reasonCode',
      'note',
    ], 'SEMANTIC_VERDICT_SCHEMA');
    assert.deepEqual(schema.properties.result.enum, [
      'supported',
      'insufficient',
      'contradicted',
    ]);
    assert.deepEqual(schema.properties.reasonCode.enum, [
      'entailed',
      'semantic_mismatch',
      'overgeneralized',
      'missing_transition',
      'missing_category',
      'boundary_mismatch',
      'contradiction',
      'uncovered_request',
    ]);
    assert.equal(schema.properties.text, undefined);
    assert.equal(schema.properties.evidence, undefined);

    assertStrictValidator(validate, {
      claimId: 'C1',
      result: 'supported',
      supportingEvidenceRefs: ['E1'],
      reasonCode: 'entailed',
      note: 'The cited implementation directly supports the claim.',
    }, {
      missingKey: 'claimId',
      makeInvalid: value => { value.reasonCode = 'confident'; },
    });
  },
);

internalSchemaTest(
  ABSENCE_CERTIFICATE_SCHEMA,
  validateAbsenceCertificate,
  'Spec 028 T006 — absence certificates are strict runtime-owned proof objects',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'ABSENCE_CERTIFICATE_SCHEMA');
    assertSchemaKeys(schema, {
      required: [
        'id',
        'subgoalId',
        'claimBoundary',
        'searchRefs',
        'searchSummary',
        'complete',
      ],
      optional: ['qualification'],
    }, 'ABSENCE_CERTIFICATE_SCHEMA');
    assertStringArraySchema(schema.properties.claimBoundary,
      'ABSENCE_CERTIFICATE_SCHEMA.claimBoundary');
    assertStringArraySchema(schema.properties.searchRefs,
      'ABSENCE_CERTIFICATE_SCHEMA.searchRefs');
    assertStringArraySchema(schema.properties.searchSummary,
      'ABSENCE_CERTIFICATE_SCHEMA.searchSummary');
    assertStringProperties(schema, [
      'id',
      'subgoalId',
      'qualification',
    ], 'ABSENCE_CERTIFICATE_SCHEMA');
    assert.equal(schema.properties.complete.type, 'boolean');

    assertStrictValidator(validate, {
      id: 'A1',
      subgoalId: 'S1',
      claimBoundary: ['src'],
      searchRefs: ['O1'],
      searchSummary: ['legacy route registration'],
      complete: true,
      qualification: 'Static in-scope source only.',
    }, {
      missingKey: 'id',
      makeInvalid: value => { value.complete = 'yes'; },
    });
    assert.doesNotThrow(() => validate({
      id: 'A2',
      subgoalId: 'S2',
      claimBoundary: [],
      searchRefs: [],
      searchSummary: [],
      complete: false,
    }), 'an incomplete certificate may preserve an empty repository boundary and no searches');
  },
);

internalSchemaTest(
  SAFETY_LIMIT_SCHEMA,
  validateSafetyLimit,
  'Spec 028 T006 — safety limits use exact strict ceiling and stage enums',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'SAFETY_LIMIT_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['name', 'stage', 'affectedSubgoalIds', 'truncated'],
    }, 'SAFETY_LIMIT_SCHEMA');
    assertStringArraySchema(schema.properties.affectedSubgoalIds,
      'SAFETY_LIMIT_SCHEMA.affectedSubgoalIds');
    assertStringProperties(schema, ['name', 'stage'], 'SAFETY_LIMIT_SCHEMA');
    assert.deepEqual(schema.properties.name.enum, [
      'turn_limit',
      'context_limit',
      'generation_output_limit',
      'walk_limit',
      'tool_result_limit',
    ]);
    assert.deepEqual(schema.properties.stage.enum, [
      'planner',
      'goal_audit',
      'plan_revision',
      'exploration',
      'synthesis',
      'verification',
      'repair',
    ]);
    assert.equal(schema.properties.affectedSubgoalIds.minItems ?? 0, 0,
      'an operational-only limit may affect no subgoal');
    assert.equal(schema.properties.truncated.type, 'boolean');

    assertStrictValidator(validate, {
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: [],
      truncated: true,
    }, {
      missingKey: 'name',
      makeInvalid: value => { value.name = 'budget'; },
    });
  },
);

test('internal model result schema uses the compact explore contract', () => {
  assert.deepEqual(EXPLORE_RESULT_JSON_SCHEMA.schema.required, [
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
  ]);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.directAnswer);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.status);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.targets);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.evidence);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.uncertainties);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.nextAction);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.answer, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.summary, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.confidence, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.candidatePaths, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.followups, undefined);
});

test('validateExploreRepoArgs rejects unknown public keys', () => {
  assert.throws(
    () => validateExploreRepoArgs({ task: 'find auth code', context: 'ignore this' }),
    /Unknown explore_repo argument: context/,
  );
});

test('validateExploreRepoArgs rejects unknown hint keys', () => {
  assert.throws(
    () => validateExploreRepoArgs({
      task: 'find auth code',
      hints: { files: ['src/auth.js'], taskMode: 'locate' },
    }),
    /Unknown explore_repo hints argument: taskMode/,
  );
});

test('agent-facing output schema is compact and exposes directAnswer, status, targets, snippets', () => {
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.required, [
    'schemaVersion',
    'directAnswer',
    'status',
    'targets',
    'discoveredPaths',
    'evidence',
    'uncertainties',
    'nextAction',
    'evidenceQuality',
    'searchCoverage',
    'critic',
    'failure',
  ]);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const, 2);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.directAnswer);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.status);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.targets);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.evidence.items.properties.snippet);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.evidenceQuality);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.critic);
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.properties.critic.required, [
    'status',
    'warnings',
    'droppedEvidence',
    'partialEvidence',
  ]);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure.anyOf[1].properties.reason.enum.includes('invalid_arguments'));
  const retrySchema = EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure.anyOf[1].properties.retry.anyOf[1];
  assert.ok(retrySchema.properties.args);
  assert.ok(retrySchema.properties.expectedImprovement);
  assert.equal(retrySchema.properties.args.additionalProperties, false);
  assert.equal(
    retrySchema.properties.args.properties.hints.properties.strategy,
    undefined,
    'failure.retry.args must not expose advanced hints.strategy',
  );
  // spec 017: session / sessionId / _debug were removed from the response
  // envelope along with the invalid_session failure reason.
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.sessionId, undefined);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.session, undefined);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties._debug, undefined);
  assert.ok(
    !EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure.anyOf[1].properties.reason.enum.includes('invalid_session'),
    'invalid_session is no longer a recognised failure reason',
  );
  // spec 017: input schema also drops the session parameter.
  assert.equal(EXPLORE_REPO_INPUT_SCHEMA.properties.session, undefined);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.searchCoverage);
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.properties.searchCoverage.required, [
    'scope',
    'scopeLimited',
    'filesRead',
    'grepCalls',
    'listDirCalls',
    'symbolCalls',
    'toolResultsTruncated',
    'stoppedByBudget',
    'omittedDiscoveredPaths',
    'warnings',
    'summary',
  ]);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.answer, undefined);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.candidatePaths, undefined);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.followups, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.schemaVersion, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.evidenceQuality, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.failure, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.searchCoverage, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.critic, undefined);
});

test('normalizeExploreResult accepts compact result fields without legacy aliases', () => {
  const result = normalizeExploreResult({
    directAnswer: 'direct',
    status: {
      confidence: 'high',
      verification: 'targeted_read_needed',
      complete: true,
      warnings: [],
    },
    targets: [
      {
        path: 'src/auth.js',
        startLine: 1,
        endLine: 4,
        role: 'read',
        reason: 'definition',
        evidenceRefs: ['E1'],
      },
    ],
    evidence: [
      {
        id: 'E1',
        path: 'src/auth.js',
        startLine: 1,
        endLine: 4,
        why: 'definition',
        snippet: '1: export function requireAuth() {}',
      },
    ],
    uncertainties: ['read auth before editing'],
    nextAction: {
      type: 'read_target',
      reason: 'Read src/auth.js before editing.',
    },
  }, makeStats());

  assert.equal(result.directAnswer, 'direct');
  assert.equal(result.status.verification, 'targeted_read_needed');
  assert.equal(result.targets[0].evidenceRefs[0], 'E1');
  assert.equal(result.evidence[0].snippet, undefined);
  assert.deepEqual(result.uncertainties, ['read auth before editing']);
  assert.equal(result.nextAction.type, 'read_target');
  assert.equal(result.answer, undefined);
  assert.equal(result.candidatePaths, undefined);
  assert.equal(result.followups, undefined);
});

test('retry tool vocabulary includes explain_code_path and stays set-equal across modules', () => {
  assert.ok(
    RETRY_SCHEMA.properties.tool.enum.includes('explain_code_path'),
    'RETRY_SCHEMA tool enum must include explain_code_path',
  );
  assert.deepEqual(
    new Set(RETRY_SCHEMA.properties.tool.enum),
    new Set(RETRY_TOOLS),
    'schema tool enum and runtime RETRY_TOOLS must have the same members',
  );
});

test('normalizeExploreResult marks malformed evidence ranges instead of coercing to line 1', () => {
  const result = normalizeExploreResult({
    directAnswer: 'direct',
    status: {
      confidence: 'medium',
      verification: 'verified',
      complete: true,
      warnings: [],
    },
    targets: [],
    evidence: [
      { path: 'src/auth.js', why: 'missing range' },
      { path: 'src/auth.js', startLine: '1', endLine: 2, why: 'non-integer start' },
      { path: 'src/auth.js', startLine: 5, endLine: 3, why: 'inverted range' },
      { path: 'src/auth.js', startLine: 1, endLine: 2, why: 'valid range' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
  }, makeStats());

  assert.equal(result.evidence.length, 4);
  assert.equal(result.evidence[0].malformedRange, true);
  assert.equal(result.evidence[0].startLine, undefined);
  assert.equal(result.evidence[0].endLine, undefined);
  assert.equal(result.evidence[1].malformedRange, true);
  assert.equal(result.evidence[1].startLine, undefined);
  assert.equal(result.evidence[1].endLine, 2);
  assert.equal(result.evidence[2].malformedRange, true);
  assert.equal(result.evidence[2].startLine, 5);
  assert.equal(result.evidence[2].endLine, 3);
  assert.equal(result.evidence[3].malformedRange, undefined);
  assert.equal(result.evidence[3].startLine, 1);
  assert.equal(result.evidence[3].endLine, 2);
});

test('normalizeExploreResult marks unsafe and overly broad evidence ranges as malformed', () => {
  const result = normalizeExploreResult({
    directAnswer: 'direct',
    status: { confidence: 'medium', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1e100, endLine: 1e100, why: 'unsafe range' },
      { path: 'src/auth.js', startLine: 1, endLine: 10_001, why: 'overly broad range' },
      { path: 'src/auth.js', startLine: 1, endLine: 10_000, why: 'maximum valid range' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
  }, makeStats());

  assert.equal(result.evidence[0].malformedRange, true);
  assert.equal(result.evidence[0].startLine, undefined);
  assert.equal(result.evidence[0].endLine, undefined);
  assert.equal(result.evidence[1].malformedRange, true);
  assert.equal(result.evidence[1].startLine, 1);
  assert.equal(result.evidence[1].endLine, 10_001);
  assert.equal(result.evidence[2].malformedRange, undefined);
  assert.equal(result.evidence[2].startLine, 1);
  assert.equal(result.evidence[2].endLine, 10_000);
});
