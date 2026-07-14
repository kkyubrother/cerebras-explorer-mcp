const EVIDENCE_LINE_TOLERANCE = 2;
const MAX_EVIDENCE_LINE_RANGE = 10_000;

function scoreToLevel(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

function lowerLevel(a, b) {
  const order = { high: 2, medium: 1, low: 0 };
  return order[a] <= order[b] ? a : b;
}

function evidenceTarget(item) {
  if (!item?.path) return null;
  const start = Number.isInteger(item.startLine) ? item.startLine : null;
  const end = Number.isInteger(item.endLine) ? item.endLine : start;
  if (start === null) return item.path;
  return `${item.path}:${start}-${end}`;
}

/**
 * Check whether an evidence item's line range overlaps with any observed range
 * for that file. Exact grounding requires the observed ranges to fully cover
 * the cited range; nearby or partially overlapping anchors remain partial.
 */
export function checkEvidenceGrounding(observedRanges, evidenceItem) {
  const ranges = observedRanges.get(evidenceItem.path);
  if (!ranges || ranges.length === 0) {
    return { overlaps: false, partial: false };
  }

  const evidenceStart = evidenceItem.startLine;
  const evidenceEnd = evidenceItem.endLine;
  if (!Number.isInteger(evidenceStart) || !Number.isInteger(evidenceEnd) || evidenceStart < 1 || evidenceEnd < evidenceStart) {
    return { overlaps: false, partial: false };
  }
  const evidenceLength = evidenceEnd - evidenceStart + 1;
  let bestResult = { overlaps: false, partial: false };
  const overlappingRanges = [];

  for (const range of ranges) {
    const rangeStart = range.startLine;
    const rangeEnd = range.endLine;
    if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 1 || rangeEnd < rangeStart) {
      continue;
    }

    const overlaps = evidenceStart <= rangeEnd && evidenceEnd >= rangeStart;
    if (!overlaps) {
      const distance = Math.max(rangeStart - evidenceEnd, evidenceStart - rangeEnd, 0);
      if (distance <= EVIDENCE_LINE_TOLERANCE && evidenceLength <= 10) {
        bestResult = { overlaps: true, partial: true };
      }
      continue;
    }

    overlappingRanges.push(range);
    bestResult = { overlaps: true, partial: true };
  }

  if (isLineRangeFullyCovered(overlappingRanges, evidenceStart, evidenceEnd)) {
    return { overlaps: true, partial: false };
  }

  return bestResult;
}

function isLineRangeFullyCovered(ranges, startLine, endLine) {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    return false;
  }

  let cursor = startLine;
  const sorted = ranges
    .filter(range =>
      Number.isInteger(range?.startLine) &&
      Number.isInteger(range?.endLine) &&
      range.startLine <= range.endLine &&
      range.endLine >= startLine &&
      range.startLine <= endLine
    )
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  for (const range of sorted) {
    if (range.startLine > cursor) break;
    if (range.endLine >= cursor) cursor = range.endLine + 1;
    if (cursor > endLine) return true;
  }

  return false;
}

function isObservedCommit(sha, observedGit) {
  if (!sha || !observedGit?.commits) return false;
  return observedGit.commits.has(sha) ||
    [...observedGit.commits].some(h => h.startsWith(sha) || sha.startsWith(h));
}

function blameKeyMatches(key, path, line, sha = '') {
  const prefix = `${path}:${line}:`;
  if (!key.startsWith(prefix)) return false;
  if (!sha) return true;
  const observedSha = key.slice(prefix.length);
  return observedSha === sha || observedSha.startsWith(sha) || sha.startsWith(observedSha);
}

function hasObservedBlameLine(item, observedGit, line) {
  if (!observedGit?.blame || !item?.path || !Number.isInteger(line)) return false;
  const sha = item.sha ?? '';
  for (const key of observedGit.blame) {
    if (blameKeyMatches(key, item.path, line, sha)) return true;
  }
  return false;
}

function hasAnyObservedBlameLine(item, observedGit) {
  if (!hasValidEvidenceLineRange(item)) return false;
  for (let line = item.startLine; line <= item.endLine; line += 1) {
    if (hasObservedBlameLine(item, observedGit, line)) return true;
  }
  return false;
}

function hasFullyObservedBlameRange(item, observedGit) {
  if (!hasValidEvidenceLineRange(item)) return false;
  for (let line = item.startLine; line <= item.endLine; line += 1) {
    if (!hasObservedBlameLine(item, observedGit, line)) return false;
  }
  return true;
}

export function groundEvidenceItem(item, { observedRanges, observedGit }) {
  const kind = item.evidenceType ?? 'file_range';

  if (kind === 'git_commit') {
    const sha = item.sha ?? item.commit ?? '';
    return isObservedCommit(sha, observedGit) ? { ...item, groundingStatus: 'exact' } : null;
  }

  if (kind === 'git_blame') {
    const { overlaps, partial } = checkEvidenceGrounding(observedRanges, item);
    if (overlaps && !partial) {
      return { ...item, groundingStatus: 'exact' };
    }
    if (overlaps) {
      return { ...item, groundingStatus: 'partial' };
    }
    if (hasFullyObservedBlameRange(item, observedGit)) {
      return { ...item, groundingStatus: 'exact' };
    }
    if (hasAnyObservedBlameLine(item, observedGit)) {
      return { ...item, groundingStatus: 'partial' };
    }
    return null;
  }

  if (kind === 'git_diff_hunk') {
    const { overlaps, partial } = checkEvidenceGrounding(observedRanges, item);
    if (!overlaps) {
      const sha = item.sha ?? item.commit ?? '';
      return isObservedCommit(sha, observedGit) ? { ...item, groundingStatus: 'partial' } : null;
    }
    return { ...item, groundingStatus: partial ? 'partial' : 'exact' };
  }

  const { overlaps, partial } = checkEvidenceGrounding(observedRanges, item);
  if (!overlaps) return null;
  return { ...item, groundingStatus: partial ? 'partial' : 'exact' };
}

export function groundEvidenceList({ evidence, observedRanges, observedGit }) {
  let droppedUngrounded = 0;
  let droppedMalformed = 0;
  const grounded = [];
  const partialTargets = [];

  for (const rawItem of evidence ?? []) {
    const item = {
      ...rawItem,
      path: typeof rawItem?.path === 'string' ? rawItem.path.replace(/^\.\//, '') : '',
    };

    if (!item.path || !item.why || item.malformedRange === true || !hasValidEvidenceLineRange(item)) {
      droppedMalformed += 1;
      continue;
    }

    const groundedItem = groundEvidenceItem(item, { observedRanges, observedGit });
    if (!groundedItem) {
      droppedUngrounded += 1;
      continue;
    }

    if (groundedItem.groundingStatus === 'partial') {
      const target = evidenceTarget(groundedItem);
      if (target) partialTargets.push(target);
    }
    grounded.push(groundedItem);
  }

  const exactEvidence = grounded.filter(item => item.groundingStatus === 'exact').length;
  const partialEvidence = grounded.filter(item => item.groundingStatus === 'partial').length;

  return {
    evidence: grounded,
    droppedUngrounded,
    droppedMalformed,
    exactEvidence,
    partialEvidence,
    partialTargets,
  };
}

const SOURCE_ROLES = new Set([
  'implementation', 'test', 'config', 'documentation', 'fixture', 'generated', 'unknown',
]);
const GIT_OBSERVATION_KINDS = new Set([
  'git_commit', 'git_blame', 'git_diff_hunk',
]);

function cloneSemanticVerdict(verdict) {
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) return {};
  return {
    ...verdict,
    ...(Array.isArray(verdict.supportingEvidenceRefs)
      ? { supportingEvidenceRefs: [...verdict.supportingEvidenceRefs] }
      : {}),
  };
}

function isValidSourceObservation(observation) {
  return observation?.kind === 'source' &&
    typeof observation.id === 'string' && observation.id.length > 0 &&
    typeof observation.path === 'string' && observation.path.length > 0 &&
    Number.isInteger(observation.startLine) && observation.startLine >= 1 &&
    Number.isInteger(observation.endLine) && observation.endLine >= observation.startLine &&
    typeof observation.snippet === 'string' && observation.snippet.trim().length > 0 &&
    observation.rangeGrounding === 'exact' &&
    SOURCE_ROLES.has(observation.sourceRole) &&
    observation.temporalRole === 'current' &&
    typeof observation.redacted === 'boolean';
}

function isValidGitObservation(observation) {
  if (!GIT_OBSERVATION_KINDS.has(observation?.kind) ||
      typeof observation.id !== 'string' || !observation.id ||
      typeof observation.content !== 'string' || !observation.content.trim() ||
      observation.temporalRole !== 'historical') {
    return false;
  }
  if (observation.kind === 'git_commit') {
    return typeof observation.sha === 'string' && observation.sha.length > 0;
  }
  if (observation.kind === 'git_blame') {
    return typeof observation.sha === 'string' && observation.sha.length > 0 &&
      typeof observation.path === 'string' && observation.path.length > 0 &&
      Number.isInteger(observation.startLine) && observation.startLine >= 1 &&
      observation.endLine === observation.startLine;
  }
  const hasAnyRange = observation.startLine !== undefined || observation.endLine !== undefined;
  return !hasAnyRange || (
    Number.isInteger(observation.startLine) && observation.startLine >= 1 &&
    Number.isInteger(observation.endLine) && observation.endLine >= observation.startLine
  );
}

function downgradeUnsupportedEvidence(verdict) {
  const downgraded = {
    ...verdict,
    result: 'insufficient',
    supportingEvidenceRefs: [],
    reasonCode: 'boundary_mismatch',
    note: 'Claim support was downgraded because its runtime evidence was incomplete or outside the verified boundary.',
  };
  delete downgraded.resolution;
  return downgraded;
}

function downgradeProofPolicy(verdict, reason = 'proof_policy_failed') {
  const reasonCode = reason === 'missing_transition'
    ? 'missing_transition'
    : reason === 'missing_category'
      ? 'missing_category'
      : 'boundary_mismatch';
  const downgraded = {
    ...verdict,
    result: 'insufficient',
    supportingEvidenceRefs: [],
    reasonCode,
    note: 'Claim support was downgraded because its runtime proof policy did not pass.',
  };
  delete downgraded.resolution;
  return downgraded;
}

function observedTemporalRole(observation) {
  if (observation?.kind === 'search') {
    return typeof observation.tool === 'string' && observation.tool.startsWith('repo_git_')
      ? 'historical'
      : 'current';
  }
  return observation?.temporalRole;
}

function structurallyValidObservation(observation) {
  if (observation?.kind === 'source') return isValidSourceObservation(observation);
  if (GIT_OBSERVATION_KINDS.has(observation?.kind)) return isValidGitObservation(observation);
  return observation?.kind === 'search' &&
    typeof observation.id === 'string' && observation.id.length > 0 &&
    typeof observation.tool === 'string' && observation.tool.length > 0 &&
    Array.isArray(observation.boundary) && observation.boundary.length > 0 &&
    observation.boundary.every(item => typeof item === 'string' && item.length > 0) &&
    Number.isInteger(observation.matchCount) && observation.matchCount >= 0 &&
    typeof observation.toolTruncated === 'boolean' &&
    typeof observation.contextTruncated === 'boolean' &&
    Number.isInteger(observation.omittedOutOfScopeFiles) &&
    observation.omittedOutOfScopeFiles >= 0 &&
    Number.isInteger(observation.deniedPaths) && observation.deniedPaths >= 0 &&
    Number.isInteger(observation.errors) && observation.errors >= 0 &&
    typeof observation.enumerationComplete === 'boolean';
}

/**
 * Combined downgrade-only gate for semantic support, structural proof policy,
 * and runtime-declared source/temporal roles. Claim wording is never inspected.
 */
export function applyClaimProofPolicyGate({
  subgoal,
  claim,
  semanticVerdict,
  observations,
  proofPolicyResult,
  roleRequirement,
} = {}) {
  const verdict = cloneSemanticVerdict(semanticVerdict);
  if (verdict.result !== 'supported') return verdict;
  if (proofPolicyResult?.passed !== true) {
    return downgradeProofPolicy(verdict, proofPolicyResult?.reason);
  }
  const proofBindingPresent = ['subgoalId', 'claimId', 'proofPolicy'].some(key =>
    Object.hasOwn(proofPolicyResult, key));
  if (proofBindingPresent && (
    proofPolicyResult.subgoalId !== subgoal?.id ||
    proofPolicyResult.claimId !== claim?.id ||
    proofPolicyResult.proofPolicy !== subgoal?.proofPolicy
  )) {
    return downgradeProofPolicy(verdict, 'proof_binding_mismatch');
  }
  if (!subgoal || !claim || verdict.claimId !== claim.id || claim.subgoalId !== subgoal.id ||
      !Array.isArray(claim.evidenceRefs) || !Array.isArray(verdict.supportingEvidenceRefs) ||
      verdict.supportingEvidenceRefs.length === 0 || !Array.isArray(observations) ||
      !roleRequirement || typeof roleRequirement !== 'object' ||
      !Array.isArray(roleRequirement.observationKinds) ||
      roleRequirement.observationKinds.length === 0 ||
      !Array.isArray(roleRequirement.sourceRoles)) {
    return downgradeProofPolicy(verdict, 'invalid_role_requirement');
  }

  const allowedTemporalRoles = Array.isArray(roleRequirement.temporalRoles)
    ? roleRequirement.temporalRoles
    : [roleRequirement.temporalRole];
  if (allowedTemporalRoles.length === 0 ||
      allowedTemporalRoles.some(role => !['current', 'historical'].includes(role))) {
    return downgradeProofPolicy(verdict, 'invalid_role_requirement');
  }

  const claimRefs = new Set(claim.evidenceRefs);
  const observationById = new Map();
  const duplicates = new Set();
  for (const observation of observations) {
    const id = typeof observation?.id === 'string' ? observation.id : '';
    if (!id) continue;
    if (observationById.has(id)) duplicates.add(id);
    else observationById.set(id, observation);
  }
  const allowedKinds = new Set(roleRequirement.observationKinds);
  const allowedSourceRoles = new Set(roleRequirement.sourceRoles);
  const valid = new Set(verdict.supportingEvidenceRefs).size ===
      verdict.supportingEvidenceRefs.length &&
    verdict.supportingEvidenceRefs.every(ref => {
      if (typeof ref !== 'string' || !claimRefs.has(ref) || duplicates.has(ref)) return false;
      const observation = observationById.get(ref);
      if (!structurallyValidObservation(observation) || !allowedKinds.has(observation.kind)) {
        return false;
      }
      if (!allowedTemporalRoles.includes(observedTemporalRole(observation))) return false;
      return observation.kind !== 'source' || allowedSourceRoles.has(observation.sourceRole);
    });

  return valid ? verdict : downgradeProofPolicy(verdict, 'source_role_mismatch');
}

/**
 * Downgrade-only structural gate after isolated semantic verification. It does
 * not interpret claim prose and can never promote a verifier result.
 */
export function applyClaimEvidenceGate({ claim, semanticVerdict, observations } = {}) {
  const verdict = cloneSemanticVerdict(semanticVerdict);
  if (verdict.result !== 'supported') return verdict;
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) ||
      verdict.claimId !== claim.id ||
      !Array.isArray(claim.evidenceRefs) ||
      !Array.isArray(verdict.supportingEvidenceRefs) ||
      verdict.supportingEvidenceRefs.length === 0 ||
      !Array.isArray(observations)) {
    return downgradeUnsupportedEvidence(verdict);
  }

  const claimRefs = new Set(claim.evidenceRefs.filter(ref => typeof ref === 'string' && ref));
  const observationById = new Map();
  const duplicateIds = new Set();
  for (const observation of observations) {
    const id = typeof observation?.id === 'string' ? observation.id : '';
    if (!id) continue;
    if (observationById.has(id)) duplicateIds.add(id);
    else observationById.set(id, observation);
  }

  const supportingRefs = verdict.supportingEvidenceRefs;
  const valid = new Set(supportingRefs).size === supportingRefs.length &&
    supportingRefs.every(ref => {
      if (typeof ref !== 'string' || !claimRefs.has(ref) || duplicateIds.has(ref)) return false;
      const observation = observationById.get(ref);
      return isValidSourceObservation(observation) || isValidGitObservation(observation);
    });

  return valid ? verdict : downgradeUnsupportedEvidence(verdict);
}

function hasValidEvidenceLineRange(item) {
  return Number.isSafeInteger(item.startLine) &&
    Number.isSafeInteger(item.endLine) &&
    item.startLine >= 1 &&
    item.endLine >= item.startLine &&
    item.endLine - item.startLine + 1 <= MAX_EVIDENCE_LINE_RANGE;
}

function affectedSafetyLimitNames(stats = {}) {
  if (!Array.isArray(stats.safetyLimits)) return [];
  return [...new Set(stats.safetyLimits
    .filter(limit => Array.isArray(limit?.affectedSubgoalIds) && limit.affectedSubgoalIds.length > 0)
    .map(limit => limit?.name)
    .filter(name => typeof name === 'string' && name))];
}

/**
 * Compute a continuous confidence score (0.0-1.0) and breakdown factors
 * based on evidence grounding and exploration stats.
 */
export function computeConfidenceScore(groundedEvidence, totalEvidenceBefore, stats, taskKind) {
  const gitLogCalls = stats.gitLogCalls ?? 0;
  const gitDiffCalls = stats.gitDiffCalls ?? 0;
  const gitBlameCalls = stats.gitBlameCalls ?? 0;
  const exactCount = groundedEvidence.filter(e => e.groundingStatus === 'exact').length;
  const distinctFiles = new Set(groundedEvidence.map(e => e.path)).size;
  const usedSearch = ((stats.grepCalls ?? 0) + (stats.symbolCalls ?? 0)) > 0;
  const evidenceDropped = totalEvidenceBefore - groundedEvidence.length;

  const factors = {
    evidenceCount: totalEvidenceBefore,
    evidenceGrounded: groundedEvidence.length,
    evidenceDropped,
    exactCount,
    crossVerified: distinctFiles >= 2,
    symbolSearchUsed: usedSearch,
    gitLogCalls,
    gitDiffCalls,
    gitBlameCalls,
    gitGroundingHint: (gitLogCalls + gitDiffCalls + gitBlameCalls) > 0 ? 'git_tools_used' : 'none',
    taskKind: taskKind ?? 'default',
    adjustments: [],
  };

  let score = taskKind === 'locate' ? 0.45 : 0.30;
  factors.adjustments.push(`base=${score.toFixed(2)} (taskKind=${factors.taskKind})`);

  if (exactCount > 0) {
    const bonus = Math.min(exactCount, 3) * 0.18;
    score += bonus;
    factors.adjustments.push(`+${bonus.toFixed(2)} (${exactCount} exact evidence item(s))`);
  }

  if (distinctFiles >= 2) {
    score += 0.12;
    factors.adjustments.push('+0.12 (cross-verified across multiple files)');
  }

  if (usedSearch) {
    score += 0.05;
    factors.adjustments.push('+0.05 (symbol/grep search used)');
  }

  const gitActionCalls = gitDiffCalls + gitBlameCalls + (stats.gitShowCalls ?? 0);
  if (gitActionCalls > 0) {
    score += 0.05;
    factors.adjustments.push('+0.05 (git blame/diff/show used - git evidence quality)');
  }

  if (evidenceDropped > 0) {
    const isGitLogOnly = gitLogCalls > 0 && gitActionCalls === 0;
    const dropRate = isGitLogOnly ? 0.04 : 0.08;
    const dropPenalty = Math.min(evidenceDropped * dropRate, 0.20);
    score -= dropPenalty;
    if (isGitLogOnly) {
      factors.adjustments.push(`-${dropPenalty.toFixed(2)} (${evidenceDropped} evidence item(s) dropped as ungrounded - git-log-only, reduced penalty)`);
    } else {
      factors.adjustments.push(`-${dropPenalty.toFixed(2)} (${evidenceDropped} evidence item(s) dropped as ungrounded)`);
    }
  }

  if (groundedEvidence.length === 0) {
    score = 0.1;
    factors.adjustments = ['score=0.10 (no grounded evidence)'];
  }

  score = Math.max(0, Math.min(1, score));

  let level = scoreToLevel(score);
  if (level === 'high' && exactCount < 1) {
    level = 'medium';
    factors.adjustments.push('capped at medium (high requires at least 1 exact evidence item)');
  }

  return {
    score: Math.round(score * 100) / 100,
    level,
    factors,
  };
}

/**
 * Reconcile the model-reported confidence level with the computed level.
 */
export function reconcileConfidence({ modelConfidence, computedLevel, droppedEvidence }) {
  if (droppedEvidence > 0) return computedLevel;
  return lowerLevel(modelConfidence, computedLevel);
}

export function evaluateConfidence({
  evidence,
  totalEvidenceBefore,
  stats,
  taskKind,
  modelConfidence,
  droppedEvidence,
}) {
  const { score, level, factors } = computeConfidenceScore(evidence, totalEvidenceBefore, stats, taskKind);
  const finalConfidence = reconcileConfidence({
    modelConfidence,
    computedLevel: level,
    droppedEvidence,
  });

  return {
    score,
    computedLevel: level,
    finalConfidence,
    factors,
    modelConfidence,
    downgraded: modelConfidence != null && lowerLevel(modelConfidence, finalConfidence) === finalConfidence && modelConfidence !== finalConfidence,
  };
}

export function deriveTaskKindFromTaskMode(taskMode) {
  return taskMode === 'locate' || taskMode === 'symbol_trace' ? 'locate' : 'default';
}

function pushWarning(warnings, warning) {
  warnings.push(warning);
}

export function buildCriticWarnings({
  grounding,
  confidence,
  stats,
  maxWarnings = 3,
  usageCrossCheck = null,
  gateSuppressed = false,
}) {
  const warnings = [];
  const safetyLimitNames = affectedSafetyLimitNames(stats);
  if (safetyLimitNames.length > 0) {
    pushWarning(warnings, {
      type: 'safety_limit_reached',
      severity: 'medium',
      message: `A fixed safety limit affected required proof: ${safetyLimitNames.join(', ')}.`,
      action: 'Use supported unaffected claims only; treat the affected requirement as incomplete.',
    });
  }

  if ((grounding.droppedMalformed ?? 0) > 0) {
    pushWarning(warnings, {
      type: 'dropped_evidence',
      severity: 'medium',
      message: `${grounding.droppedMalformed} evidence item(s) were removed because required fields or valid line ranges were missing.`,
      action: 'Rely only on the remaining evidence list.',
    });
  }

  if ((grounding.droppedUngrounded ?? 0) > 0) {
    pushWarning(warnings, {
      type: 'dropped_evidence',
      severity: grounding.droppedUngrounded >= 2 ? 'medium' : 'low',
      message: `${grounding.droppedUngrounded} evidence item(s) were removed because their line ranges were not inspected.`,
      action: 'Do not rely on claims that depended only on removed evidence.',
    });
  }

  if ((grounding.partialEvidence ?? 0) > 0) {
    const target = grounding.partialTargets?.[0];
    pushWarning(warnings, {
      type: 'partial_evidence',
      severity: 'low',
      message: `${grounding.partialEvidence} evidence item(s) are grounded only by grep, blame, or nearby line observations.`,
      target,
      action: 'Treat the targeted evidence as weaker than an exact file read.',
    });
  }

  // spec 026: usage cross-check gate warning — push BEFORE confidence_downgraded so it
  // wins the warning-cap competition when both fire simultaneously (R5).
  // Suppressed on all precedence routes (stoppedByErrors/stoppedByAbort/no-evidence/low-confidence)
  // that pre-empt 'verified' in buildResultStatus — no double warning on those paths.
  if (usageCrossCheck?.required && !usageCrossCheck.observed && !gateSuppressed) {
    const sym = usageCrossCheck.symbol ?? '';
    pushWarning(warnings, {
      type: 'usage_cross_check_missing',
      severity: 'medium',
      message: `Usage tracing relied on a single symbol lookup; no grep or reference search for \`${sym}\` was observed.`,
      target: sym,
      action: `Run one grep for the bare symbol name within the current scope (natively or via a follow-up trace_symbol/explore_repo with the same symbol and scope) before trusting the usage list as complete.`,
    });
  }

  if (confidence?.modelConfidence && confidence.modelConfidence !== confidence.finalConfidence) {
    pushWarning(warnings, {
      type: 'confidence_downgraded',
      severity: 'medium',
      message: `Model confidence was capped from ${confidence.modelConfidence} to ${confidence.finalConfidence}.`,
      action: 'Use the capped confidence value.',
    });
  }

  if (stats?.stoppedByErrors) {
    pushWarning(warnings, {
      type: 'tool_errors',
      severity: 'high',
      message: 'Exploration stopped after repeated tool errors.',
      action: 'Treat the answer as partial and consider a narrower follow-up task.',
    });
  }

  return warnings
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, maxWarnings);
}

// NOTE: buildCriticStatus maps warning severity to status string.
// Any new high-severity warning type added here MUST also be keyed in
// gateSuppressed (runDeterministicCriticPass) so that cause-keyed suppression
// stays equivalent to status-keyed suppression. Failure to do so would allow
// usage_cross_check_missing to fire simultaneously with the new warning,
// producing spurious double-warnings on precedence routes.
export function buildCriticStatus(warnings) {
  if (warnings.some(warning => warning.severity === 'high')) return 'fail';
  if (warnings.length > 0) return 'caution';
  return 'pass';
}

export function runDeterministicCriticPass({
  normalized,
  observedRanges,
  observedGit,
  stats,
  taskKind,
  maxWarnings = 3,
  usageCrossCheck = null,
}) {
  const totalEvidenceBefore = normalized.evidence.length;
  const grounding = groundEvidenceList({
    evidence: normalized.evidence,
    observedRanges,
    observedGit,
  });
  const confidence = evaluateConfidence({
    evidence: grounding.evidence,
    totalEvidenceBefore,
    stats,
    taskKind,
    modelConfidence: normalized.status?.confidence,
    droppedEvidence: grounding.droppedUngrounded + grounding.droppedMalformed,
  });

  confidence.factors.droppedUngrounded = grounding.droppedUngrounded;
  confidence.factors.droppedMalformed = grounding.droppedMalformed;

  // spec 026: suppress the cross-check gate on all precedence routes that pre-empt 'verified'
  // in buildResultStatus (runtime.mjs:993-996):
  //   • stoppedByErrors  — critic-fail → broad_search_needed
  //   • stoppedByAbort   — abort path  → broad_search_needed
  //   • no grounded evidence — evidence-dropped path → broad_search_needed
  //   • finalConfidence === 'low' — low-confidence path → follow_up_needed
  // The suppression predicate MUST be evaluated against the pre-cap finalConfidence so that
  // the 'low' branch is read before any potential cap mutates it.
  const gateSuppressed =
    Boolean(stats?.stoppedByErrors) ||
    Boolean(stats?.stoppedByAbort) ||
    affectedSafetyLimitNames(stats).length > 0 ||
    (grounding.evidence?.length ?? 0) === 0 ||
    confidence.finalConfidence === 'low';

  // spec 026: gate-fail caps finalConfidence to medium (never low — R4 constraint).
  // modelConfidence is preserved; confidence_downgraded warning fires automatically.
  if (usageCrossCheck?.required && !usageCrossCheck.observed && !gateSuppressed) {
    if (confidence.finalConfidence === 'high') {
      confidence.finalConfidence = 'medium';
      confidence.factors.adjustments.push('capped at medium (usage cross-check missing)');
    }
    // medium or below: no further lowering (low → follow_up_needed violates FR-003)
  }

  const warnings = buildCriticWarnings({ grounding, confidence, stats, maxWarnings, usageCrossCheck, gateSuppressed });

  return {
    result: {
      ...normalized,
      evidence: grounding.evidence,
      confidenceScore: confidence.score,
      confidenceLevel: confidence.finalConfidence,
      confidenceFactors: confidence.factors,
      status: {
        ...(normalized.status ?? {}),
        confidence: confidence.finalConfidence,
      },
      critic: {
        status: buildCriticStatus(warnings),
        warnings,
      },
    },
    grounding,
    confidence,
  };
}
