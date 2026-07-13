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

export function reduceTrustState({ fatalFault = null, requiredSubgoals = [], parentMustReadTargets = false } = {}) {
  if (fatalFault) return 'failed';
  if (!Array.isArray(requiredSubgoals) || requiredSubgoals.length === 0) return 'incomplete';
  if (requiredSubgoals.some(subgoal => subgoal?.state !== 'supported')) return 'incomplete';
  return parentMustReadTargets === true ? 'verify_targets' : 'complete';
}
