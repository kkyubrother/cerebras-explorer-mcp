import { createHash } from 'node:crypto';

const CLAIM_TYPE_TO_PROOF_POLICY = Object.freeze({
  positive: 'direct_source',
  absence: 'bounded_absence',
  count: 'deterministic_count',
  symbol_definition: 'symbol_definition',
  symbol_usage: 'bounded_usage_cross_check',
  flow: 'ordered_handoffs',
  impact: 'impact_categories',
  comparison: 'distinct_policy_paths',
  claim_verification: 'support_or_refute',
});

const PROOF_POLICY_PRIORITY = Object.freeze({
  bounded_absence: 0,
  deterministic_count: 1,
  bounded_usage_cross_check: 2,
  ordered_handoffs: 3,
  impact_categories: 4,
  distinct_policy_paths: 5,
  support_or_refute: 6,
  symbol_definition: 7,
  direct_source: 8,
});

const BLOCKING_AUDIT_VERDICTS = new Set([
  'blocked_scope',
  'blocked_capability',
  'requires_external_state',
  'missing_input',
  'contradictory',
  'unverifiable',
  'planning_incomplete',
]);

const GAP_REASONS = new Set([
  'missing_evidence',
  'semantic_mismatch',
  'contradicted',
  'planning_incomplete',
  'scope_blocked',
  'capability_blocked',
  'external_state_required',
  'missing_input',
  'contradictory_request',
  'unverifiable',
  'truncated',
  'enumeration_incomplete',
  'safety_limit_reached',
  'denied_evidence',
  'uncovered_request',
]);

const NON_REPAIRABLE_GAP_REASONS = new Set([
  'planning_incomplete',
  'scope_blocked',
  'capability_blocked',
  'external_state_required',
  'missing_input',
  'contradictory_request',
  'unverifiable',
  'safety_limit_reached',
  'denied_evidence',
]);

const SAFETY_LIMIT_NAMES = new Set([
  'turn_limit',
  'context_limit',
  'generation_output_limit',
  'walk_limit',
  'tool_result_limit',
]);

const SAFETY_LIMIT_STAGES = new Set([
  'planner',
  'goal_audit',
  'plan_revision',
  'exploration',
  'synthesis',
  'verification',
  'repair',
]);

const WRAPPER_GOAL_SEEDS = Object.freeze({
  find_relevant_code: Object.freeze(['locations', 'relevance', 'smallest_set']),
  trace_symbol: Object.freeze(['definition', 'usage']),
  map_change_impact: Object.freeze([
    'targets',
    'dependents',
    'requested_categories',
    'risk_boundary',
  ]),
  explain_code_path: Object.freeze(['entry', 'handoffs', 'terminal_effect', 'transitions']),
  collect_evidence: Object.freeze(['verdict', 'direct_evidence', 'counterevidence']),
  explore_repo: Object.freeze([]),
});

const PLANNER_GOAL_KEYS = new Set([
  'id',
  'question',
  'originRefs',
  'claimType',
  'proofCondition',
  'constraints',
]);

const AUDITOR_VERDICTS = new Set([
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

const BLOCKER_GAP_REASON = Object.freeze({
  blocked_scope: 'scope_blocked',
  blocked_capability: 'capability_blocked',
  requires_external_state: 'external_state_required',
  missing_input: 'missing_input',
  contradictory: 'contradictory_request',
  unverifiable: 'unverifiable',
});

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${label} must be a string array.`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
  return [...value];
}

function fixedCapabilities() {
  return {
    repositoryRead: true,
    gitRead: true,
    repositoryWrite: false,
    liveRuntimeState: false,
    scopeWidening: false,
    secretPathRead: false,
  };
}

export function createTaskContract(input) {
  const value = requireObject(input, 'TaskContract');
  if (!Array.isArray(value.subgoals)) {
    throw new TypeError('TaskContract.subgoals must be an array.');
  }

  return {
    task: requireString(value.task, 'TaskContract.task'),
    effectiveScope: requireStringArray(value.effectiveScope, 'TaskContract.effectiveScope'),
    constraints: requireStringArray(value.constraints, 'TaskContract.constraints'),
    capabilities: fixedCapabilities(),
    subgoals: [...value.subgoals],
    plannerVersion: requireString(value.plannerVersion, 'TaskContract.plannerVersion'),
    goalAuditVersion: requireString(value.goalAuditVersion, 'TaskContract.goalAuditVersion'),
  };
}

export function createRequiredSubgoal(input) {
  const value = requireObject(input, 'RequiredSubgoal');
  const proofPolicy = CLAIM_TYPE_TO_PROOF_POLICY[value.claimType];
  if (!proofPolicy) {
    throw new TypeError(`Unsupported RequiredSubgoal.claimType: ${value.claimType}`);
  }
  if (value.auditVerdict !== 'ready' && !BLOCKING_AUDIT_VERDICTS.has(value.auditVerdict)) {
    throw new TypeError(`Unsupported required-goal audit verdict: ${value.auditVerdict}`);
  }

  const blocked = BLOCKING_AUDIT_VERDICTS.has(value.auditVerdict);
  const subgoal = {
    id: requireString(value.id, 'RequiredSubgoal.id'),
    question: requireString(value.question, 'RequiredSubgoal.question'),
    originRefs: requireStringArray(value.originRefs, 'RequiredSubgoal.originRefs', { allowEmpty: false }),
    claimType: value.claimType,
    proofPolicy,
    proofCondition: requireString(value.proofCondition, 'RequiredSubgoal.proofCondition'),
    constraints: requireStringArray(value.constraints, 'RequiredSubgoal.constraints'),
    auditVerdict: value.auditVerdict,
    state: blocked ? 'blocked' : 'audited',
    claimRefs: [],
  };
  if (blocked && typeof value.blockerRef === 'string' && value.blockerRef) {
    subgoal.blockerRef = value.blockerRef;
  }
  return subgoal;
}

export function createAtomicClaim(input) {
  const value = requireObject(input, 'AtomicClaim');
  return {
    id: requireString(value.id, 'AtomicClaim.id'),
    subgoalId: requireString(value.subgoalId, 'AtomicClaim.subgoalId'),
    text: requireString(value.text, 'AtomicClaim.text'),
    evidenceRefs: requireStringArray(value.evidenceRefs, 'AtomicClaim.evidenceRefs', { allowEmpty: false }),
    verdict: 'pending',
  };
}

export function deriveGapPriority({ requestOrder, proofPolicy } = {}) {
  if (!Number.isInteger(requestOrder) || requestOrder < 0) {
    throw new TypeError('requestOrder must be a non-negative integer.');
  }
  const policyPriority = PROOF_POLICY_PRIORITY[proofPolicy];
  if (!Number.isInteger(policyPriority)) {
    throw new TypeError(`Unsupported proof policy: ${proofPolicy}`);
  }
  return requestOrder * 100 + policyPriority;
}

function cloneFollowUp(value) {
  const followUp = requireObject(value, 'CoverageGap.followUp');
  const cloned = { ...followUp };
  if (Array.isArray(followUp.scope)) cloned.scope = [...followUp.scope];
  if (Array.isArray(followUp.anchors)) cloned.anchors = [...followUp.anchors];
  return cloned;
}

export function createCoverageGap(input, priorityContext = {}) {
  const value = requireObject(input, 'CoverageGap');
  if (!GAP_REASONS.has(value.reason)) {
    throw new TypeError(`Unsupported coverage-gap reason: ${value.reason}`);
  }

  const repairable = value.repairable === true && !NON_REPAIRABLE_GAP_REASONS.has(value.reason);
  const gap = {
    id: requireString(value.id, 'CoverageGap.id'),
    question: requireString(value.question, 'CoverageGap.question'),
    reason: value.reason,
    repairable,
    priority: deriveGapPriority(priorityContext),
    attemptedActionFingerprints: [],
  };
  if (typeof value.subgoalId === 'string' && value.subgoalId) {
    gap.subgoalId = value.subgoalId;
  }
  if (repairable && value.followUp !== undefined) {
    gap.followUp = cloneFollowUp(value.followUp);
  }
  return gap;
}

export function createSafetyLimit(input) {
  const value = requireObject(input, 'SafetyLimit');
  if (!SAFETY_LIMIT_NAMES.has(value.name)) {
    throw new TypeError(`Unsupported safety limit name: ${value.name}`);
  }
  if (!SAFETY_LIMIT_STAGES.has(value.stage)) {
    throw new TypeError(`Unsupported safety limit stage: ${value.stage}`);
  }
  if (typeof value.truncated !== 'boolean') {
    throw new TypeError('SafetyLimit.truncated must be a boolean.');
  }

  return {
    name: value.name,
    stage: value.stage,
    affectedSubgoalIds: requireStringArray(
      value.affectedSubgoalIds,
      'SafetyLimit.affectedSubgoalIds',
    ),
    truncated: value.truncated,
  };
}

export function mergeSafetyLimit(existingLimits = [], input) {
  if (!Array.isArray(existingLimits)) {
    throw new TypeError('Safety limit observations must be an array.');
  }
  const normalizedExisting = existingLimits.map(createSafetyLimit);
  const next = createSafetyLimit(input);
  const index = normalizedExisting.findIndex(item =>
    item.name === next.name && item.stage === next.stage);
  if (index === -1) return [...normalizedExisting, next];

  return normalizedExisting.map((item, itemIndex) => itemIndex === index
    ? {
        ...item,
        affectedSubgoalIds: [...new Set([
          ...item.affectedSubgoalIds,
          ...next.affectedSubgoalIds,
        ])],
        truncated: item.truncated || next.truncated,
      }
    : item);
}

function canonicalizeJson(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Action fingerprints require finite numbers.');
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError('Action fingerprints require JSON-compatible values.');
  }
  if (seen.has(value)) throw new TypeError('Action fingerprints do not accept cyclic values.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => canonicalizeJson(item, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Action fingerprints require plain JSON objects.');
    }
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalizeJson(value[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function fingerprintAction(action) {
  const canonical = canonicalizeJson(action, new Set());
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return `sha256:${digest}`;
}

function illegalTransition(from, to, detail = '') {
  const suffix = detail ? ` ${detail}` : '';
  throw new Error(`Illegal sub-goal transition: ${from} -> ${to}.${suffix}`);
}

export function transitionSubgoal(input, nextState, metadata = {}) {
  const subgoal = requireObject(input, 'RequiredSubgoal');
  const currentState = subgoal.state;
  const next = {
    ...subgoal,
    claimRefs: Array.isArray(subgoal.claimRefs) ? [...subgoal.claimRefs] : [],
  };

  if (currentState === 'audited' && nextState === 'exploring') {
    next.state = 'exploring';
    return next;
  }

  if (currentState === 'exploring' && nextState === 'candidate') {
    next.state = 'candidate';
    next.claimRefs = requireStringArray(metadata.claimRefs, 'candidate claimRefs', { allowEmpty: false });
    return next;
  }

  if (currentState === 'candidate' && nextState === 'supported') {
    if (metadata.semanticVerified !== true) {
      illegalTransition(currentState, nextState, 'Semantic verification is required.');
    }
    if (metadata.resolution !== 'affirmed' && metadata.resolution !== 'refuted') {
      illegalTransition(currentState, nextState, 'A supported resolution is required.');
    }
    next.state = 'supported';
    next.resolution = metadata.resolution;
    delete next.gapRef;
    return next;
  }

  if (currentState === 'candidate' && (nextState === 'gap' || nextState === 'contradicted')) {
    next.state = nextState;
    next.gapRef = requireString(metadata.gapRef, `${nextState} gapRef`);
    delete next.resolution;
    return next;
  }

  if (currentState === 'gap' && nextState === 'exploring') {
    if (metadata.repairable !== true || metadata.repairRound !== 1) {
      illegalTransition(currentState, nextState, 'Exactly one repair round is required.');
    }
    next.state = 'exploring';
    delete next.gapRef;
    delete next.resolution;
    return next;
  }

  if (currentState === 'supported' && nextState === 'candidate') {
    requireStringArray(metadata.counterevidenceRefs, 'counterevidenceRefs', { allowEmpty: false });
    next.state = 'candidate';
    delete next.resolution;
    return next;
  }

  if (currentState === 'blocked') {
    illegalTransition(currentState, nextState, 'Blocked goals are terminal.');
  }
  illegalTransition(currentState, nextState);
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function cloneGoalProposal(value) {
  return {
    id: value.id,
    question: value.question,
    originRefs: [...value.originRefs],
    claimType: value.claimType,
    proofCondition: value.proofCondition,
    constraints: [...value.constraints],
  };
}

function isValidOriginRef(originRef, task, wrapperTool) {
  if (typeof originRef !== 'string') return false;
  const requestMatch = /^request:(\d+)-(\d+)$/.exec(originRef);
  if (requestMatch) {
    const start = Number(requestMatch[1]);
    const end = Number(requestMatch[2]);
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
      start >= 0 && end > start && end <= task.length && task.slice(start, end).trim() !== '';
  }
  const wrapperMatch = /^wrapper:([^:]+):([^:]+)$/.exec(originRef);
  return Boolean(wrapperMatch && wrapperMatch[1] === wrapperTool &&
    WRAPPER_GOAL_SEEDS[wrapperTool]?.includes(wrapperMatch[2]));
}

function hasCircularProofCondition(proofCondition) {
  return /\b(?:model|assistant|explorer)\b.{0,48}\b(?:confiden(?:ce|t)|believ(?:e|es)|thinks?)\b/i
    .test(proofCondition) ||
    /\bfinal\s+status\s+(?:says?|reports?|indicates?|shows?|is)\b.{0,48}\b(?:complete|verified|supported|done|successful)\b/i
      .test(proofCondition);
}

function proposalShapeError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'expected an object';
  if ([...Object.keys(value)].some(key => !PLANNER_GOAL_KEYS.has(key))) {
    return 'contains a model-authored runtime field';
  }
  if (typeof value.id !== 'string' || value.id.length === 0) return 'invalid id';
  if (typeof value.question !== 'string' || value.question.length === 0) return 'invalid question';
  if (!Array.isArray(value.originRefs) || value.originRefs.length === 0 ||
      value.originRefs.some(item => typeof item !== 'string' || item.length === 0)) {
    return 'invalid origins';
  }
  if (!Object.hasOwn(CLAIM_TYPE_TO_PROOF_POLICY, value.claimType)) return 'invalid claim type';
  if (typeof value.proofCondition !== 'string' || value.proofCondition.length === 0) {
    return 'invalid proof condition';
  }
  if (!Array.isArray(value.constraints) ||
      value.constraints.some(item => typeof item !== 'string' || item.length === 0)) {
    return 'invalid constraints';
  }
  return null;
}

function preflightDiagnostic(proposedGoalId, code, reason) {
  return { proposedGoalId, code, reason };
}

export function preflightGoalProposals(input) {
  const value = requireObject(input, 'Goal preflight');
  const task = requireString(value.task, 'Goal preflight.task');
  requireStringArray(value.effectiveScope, 'Goal preflight.effectiveScope');
  if (!Array.isArray(value.proposals)) {
    throw new TypeError('Goal preflight.proposals must be an array.');
  }
  const wrapperTool = value.wrapperTool ?? 'explore_repo';
  const diagnostics = [];
  const knownGoalIds = value.proposals
    .map(proposal => proposal?.id)
    .filter(id => typeof id === 'string' && id.length > 0);
  if (typeof wrapperTool !== 'string' || !Object.hasOwn(WRAPPER_GOAL_SEEDS, wrapperTool)) {
    for (const proposedGoalId of knownGoalIds) {
      diagnostics.push(preflightDiagnostic(
        proposedGoalId,
        'invalid_wrapper',
        `Unsupported planning wrapper: ${wrapperTool}`,
      ));
    }
    return {
      task,
      wrapperTool,
      auditCandidates: [],
      diagnostics,
      ineligibleGoalIds: [],
      excludedGoalIds: uniqueStrings(knownGoalIds),
      knownGoalIds: uniqueStrings(knownGoalIds),
      mechanicalMergeTargets: {},
      controlFault: {
        code: 'invalid_wrapper',
        proposedGoalIds: uniqueStrings(knownGoalIds),
      },
    };
  }

  const idCounts = new Map();
  for (const id of knownGoalIds) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  const duplicateIds = new Set([...idCounts].filter(([, count]) => count > 1).map(([id]) => id));
  const auditCandidates = [];
  const excludedGoalIds = new Set();
  const ineligibleGoalIds = new Set();
  const mechanicalMergeTargets = Object.create(null);
  const exactGoalIndex = new Map();

  for (let index = 0; index < value.proposals.length; index += 1) {
    const proposal = value.proposals[index];
    const proposedGoalId = typeof proposal?.id === 'string' && proposal.id
      ? proposal.id
      : `proposal:${index}`;
    const shapeError = proposalShapeError(proposal);
    if (shapeError) {
      diagnostics.push(preflightDiagnostic(proposedGoalId, 'invalid_proposal', shapeError));
      if (typeof proposal?.id === 'string' && proposal.id) excludedGoalIds.add(proposal.id);
      continue;
    }
    if (duplicateIds.has(proposal.id)) {
      diagnostics.push(preflightDiagnostic(proposal.id, 'duplicate_id', 'Duplicate proposal id.'));
      excludedGoalIds.add(proposal.id);
      continue;
    }
    if (proposal.originRefs.some(originRef => !isValidOriginRef(originRef, task, wrapperTool))) {
      diagnostics.push(preflightDiagnostic(
        proposal.id,
        'invalid_origin_ref',
        'Every origin must be a bounded request slice or an active fixed wrapper seed.',
      ));
      excludedGoalIds.add(proposal.id);
      continue;
    }

    const cloned = cloneGoalProposal(proposal);
    const exactKey = JSON.stringify([cloned.question, cloned.claimType, cloned.proofCondition]);
    const retainedIndex = exactGoalIndex.get(exactKey);
    if (retainedIndex !== undefined) {
      const retained = auditCandidates[retainedIndex];
      retained.originRefs = uniqueStrings([...retained.originRefs, ...cloned.originRefs]);
      retained.constraints = uniqueStrings([...retained.constraints, ...cloned.constraints]);
      mechanicalMergeTargets[cloned.id] = retained.id;
      diagnostics.push(preflightDiagnostic(
        cloned.id,
        'mechanical_duplicate',
        `Merged into ${retained.id}.`,
      ));
      continue;
    }

    exactGoalIndex.set(exactKey, auditCandidates.length);
    auditCandidates.push(cloned);
    if (hasCircularProofCondition(cloned.proofCondition)) {
      ineligibleGoalIds.add(cloned.id);
      diagnostics.push(preflightDiagnostic(
        cloned.id,
        'circular_proof_condition',
        'Proof depends on model confidence or final status.',
      ));
    }
  }

  return {
    task,
    wrapperTool,
    auditCandidates,
    diagnostics,
    ineligibleGoalIds: [...ineligibleGoalIds],
    excludedGoalIds: [...excludedGoalIds],
    knownGoalIds: uniqueStrings(knownGoalIds),
    mechanicalMergeTargets: { ...mechanicalMergeTargets },
    controlFault: duplicateIds.size > 0
      ? { code: 'duplicate_id', proposedGoalIds: [...duplicateIds] }
      : null,
  };
}

function validateAuditRecord(record, proposal) {
  requireObject(record, 'Goal audit record');
  if (record.proposedGoalId !== proposal.id || !AUDITOR_VERDICTS.has(record.verdict)) {
    throw new TypeError(`Invalid audit record for ${proposal.id}.`);
  }
  const originRefs = requireStringArray(record.originRefs, `${proposal.id}.originRefs`);
  if (record.verdict !== 'reject_untraceable' && originRefs.length === 0) {
    throw new TypeError(`${proposal.id} requires at least one confirmed origin.`);
  }
  if (originRefs.some(originRef => !proposal.originRefs.includes(originRef))) {
    throw new TypeError(`${proposal.id} contains an unproposed audit origin.`);
  }
  if (!Array.isArray(record.missingRequestParts) ||
      record.missingRequestParts.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${proposal.id}.missingRequestParts must be a string array.`);
  }
  requireString(record.reason, `${proposal.id}.reason`);
  const hasMergeTarget = typeof record.mergeInto === 'string' && record.mergeInto.length > 0;
  if ((record.verdict === 'merge_duplicate') !== hasMergeTarget) {
    throw new TypeError(`${proposal.id} has an invalid merge target.`);
  }
  return { ...record, originRefs: [...originRefs], missingRequestParts: [...record.missingRequestParts] };
}

function requestOrder(originRefs, fallback) {
  const offsets = originRefs.flatMap(originRef => {
    const match = /^request:(\d+)-(\d+)$/.exec(originRef);
    return match ? [Number(match[1])] : [];
  });
  return offsets.length > 0 ? Math.min(...offsets) : fallback;
}

function planningGoalId(proposal, usedIds) {
  if (typeof proposal.id === 'string' && proposal.id && !usedIds.has(proposal.id)) {
    return proposal.id;
  }
  const digest = createHash('sha256').update(JSON.stringify([
    proposal.question,
    proposal.originRefs,
    proposal.claimType,
    proposal.proofCondition,
    proposal.constraints,
  ])).digest('hex').slice(0, 16);
  const base = `planning-${digest}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function materializeBlockedGoal(proposal, auditVerdict, gapReason, order, usedIds) {
  const id = planningGoalId(proposal, usedIds);
  usedIds.add(id);
  const gapId = `audit-gap:${id}`;
  const required = createRequiredSubgoal({
    ...proposal,
    id,
    auditVerdict,
    blockerRef: gapId,
  });
  const gap = createCoverageGap({
    id: gapId,
    subgoalId: id,
    question: proposal.question,
    reason: gapReason,
    repairable: false,
  }, {
    requestOrder: requestOrder(proposal.originRefs, order),
    proofPolicy: required.proofPolicy,
  });
  return { required, gap };
}

export function reduceGoalAudit(input) {
  const value = requireObject(input, 'Goal audit reduction');
  const preflight = requireObject(value.preflight, 'Goal audit reduction.preflight');
  if (!Array.isArray(preflight.auditCandidates) || !Array.isArray(value.auditRecords) ||
      !Array.isArray(value.uncoveredRequestParts)) {
    throw new TypeError('Goal audit reduction requires candidate, audit, and uncovered arrays.');
  }
  if (value.revisionCount !== 0 && value.revisionCount !== 1) {
    throw new TypeError('Goal audit reduction.revisionCount must be 0 or 1.');
  }

  const proposals = preflight.auditCandidates.map(cloneGoalProposal);
  const proposalById = new Map(proposals.map(proposal => [proposal.id, proposal]));
  const ignoredIds = new Set([
    ...(preflight.excludedGoalIds ?? []),
    ...Object.keys(preflight.mechanicalMergeTargets ?? {}),
  ]);
  const knownIds = new Set(preflight.knownGoalIds ?? proposals.map(proposal => proposal.id));
  const recordById = new Map();
  for (const record of value.auditRecords) {
    const id = record?.proposedGoalId;
    const proposal = proposalById.get(id);
    if (!proposal) {
      if (knownIds.has(id) && ignoredIds.has(id)) continue;
      throw new TypeError(`Audit record references unknown proposal: ${id}`);
    }
    if (recordById.has(id)) throw new TypeError(`Duplicate audit record for ${id}.`);
    recordById.set(id, validateAuditRecord(record, proposal));
  }
  for (const proposal of proposals) {
    if (!recordById.has(proposal.id)) {
      throw new TypeError(`Missing audit record for ${proposal.id}.`);
    }
  }

  function mergeRoot(id, seen = new Set()) {
    if (seen.has(id)) throw new TypeError(`Circular audit merge involving ${id}.`);
    seen.add(id);
    const record = recordById.get(id);
    if (record.verdict !== 'merge_duplicate') return id;
    if (record.mergeInto === id || !proposalById.has(record.mergeInto)) {
      throw new TypeError(`Invalid merge target for ${id}.`);
    }
    return mergeRoot(record.mergeInto, seen);
  }

  const groups = new Map();
  for (const proposal of proposals) {
    const rootId = mergeRoot(proposal.id);
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId).push(proposal.id);
  }

  const requiredSubgoals = [];
  const gaps = [];
  const rejectedGoals = [];
  const planningDefects = [];
  const usedIds = new Set();
  const ineligibleIds = new Set(preflight.ineligibleGoalIds ?? []);
  let groupOrder = 0;
  for (const [rootId, memberIds] of groups) {
    const proposal = proposalById.get(rootId);
    const record = recordById.get(rootId);
    const merged = {
      ...proposal,
      originRefs: uniqueStrings(memberIds.flatMap(id => recordById.get(id).originRefs)),
      constraints: uniqueStrings(memberIds.flatMap(id => proposalById.get(id).constraints)),
    };

    if (record.verdict === 'reject_untraceable') {
      if (memberIds.length > 1) {
        throw new TypeError(`A merged goal cannot target rejected proposal ${rootId}.`);
      }
      rejectedGoals.push({ ...record, originRefs: [...record.originRefs] });
      groupOrder += 1;
      continue;
    }
    if (ineligibleIds.has(rootId) || record.verdict === 'needs_decomposition') {
      planningDefects.push({
        proposal: merged,
        code: ineligibleIds.has(rootId) ? 'circular_proof_condition' : 'needs_decomposition',
        reason: record.reason,
        order: groupOrder,
      });
      groupOrder += 1;
      continue;
    }
    if (record.verdict === 'ready') {
      const required = createRequiredSubgoal({ ...merged, auditVerdict: 'ready' });
      usedIds.add(required.id);
      requiredSubgoals.push(required);
      groupOrder += 1;
      continue;
    }
    const gapReason = BLOCKER_GAP_REASON[record.verdict];
    if (!gapReason) throw new TypeError(`Unsupported reduced verdict: ${record.verdict}`);
    const blocked = materializeBlockedGoal(
      merged,
      record.verdict,
      gapReason,
      groupOrder,
      usedIds,
    );
    requiredSubgoals.push(blocked.required);
    gaps.push(blocked.gap);
    groupOrder += 1;
  }

  const uncoveredRequestParts = value.uncoveredRequestParts.map((part, index) => {
    if (Object.prototype.hasOwnProperty.call(part ?? {}, 'id')) {
      throw new TypeError('Uncovered request parts cannot author ids.');
    }
    const shapeError = proposalShapeError({ id: `uncovered:${index}`, ...part });
    if (shapeError) throw new TypeError(`Invalid uncovered request part: ${shapeError}.`);
    if (typeof preflight.task !== 'string' ||
        typeof preflight.wrapperTool !== 'string' ||
        part.originRefs.some(originRef =>
          !isValidOriginRef(originRef, preflight.task, preflight.wrapperTool))) {
      throw new TypeError('Invalid uncovered request-part origin.');
    }
    return { ...part, originRefs: [...part.originRefs], constraints: [...part.constraints] };
  });
  const reportedMissingParts = uniqueStrings(
    [...recordById.values()].flatMap(record => record.missingRequestParts),
  );
  if (reportedMissingParts.some(missingPart =>
    !uncoveredRequestParts.some(part => part.question === missingPart))) {
    throw new TypeError('Audit records report request gaps without structured uncovered parts.');
  }

  let revisionRequest = null;
  if (planningDefects.length > 0 || uncoveredRequestParts.length > 0) {
    if (value.revisionCount === 0) {
      revisionRequest = {
        decomposeGoalIds: planningDefects.map(defect => defect.proposal.id),
        uncoveredRequestParts,
        diagnostics: [
          ...(preflight.diagnostics ?? []),
          ...planningDefects
            .filter(defect => defect.code === 'needs_decomposition')
            .map(defect => preflightDiagnostic(defect.proposal.id, defect.code, defect.reason)),
        ],
      };
    } else {
      const remaining = [
        ...planningDefects.map(defect => ({ proposal: defect.proposal, order: defect.order })),
        ...uncoveredRequestParts.map((proposal, index) => ({
          proposal,
          order: proposals.length + index,
        })),
      ];
      for (const item of remaining) {
        const blocked = materializeBlockedGoal(
          item.proposal,
          'planning_incomplete',
          'planning_incomplete',
          item.order,
          usedIds,
        );
        requiredSubgoals.push(blocked.required);
        gaps.push(blocked.gap);
      }
    }
  }

  return {
    requiredSubgoals,
    gaps,
    rejectedGoals,
    revisionRequest,
    diagnostics: [...(preflight.diagnostics ?? [])],
    controlFault: preflight.controlFault ?? null,
  };
}

export function reduceTrustState({
  fatalFault = null,
  requiredSubgoals = [],
  parentMustReadTargets = false,
  safetyLimits = [],
} = {}) {
  if (fatalFault) return 'failed';
  if (!Array.isArray(requiredSubgoals) || requiredSubgoals.length === 0) return 'incomplete';
  if (!Array.isArray(safetyLimits)) {
    throw new TypeError('Safety limit observations must be an array.');
  }
  const affectedSubgoalIds = new Set(
    safetyLimits.flatMap(limit => createSafetyLimit(limit).affectedSubgoalIds),
  );
  if (requiredSubgoals.some(subgoal =>
    subgoal?.state !== 'supported' || affectedSubgoalIds.has(subgoal?.id))) {
    return 'incomplete';
  }
  return parentMustReadTargets === true ? 'verify_targets' : 'complete';
}
