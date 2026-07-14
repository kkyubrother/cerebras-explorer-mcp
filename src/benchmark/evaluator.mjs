export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRepoPath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

function invalidKnownBadEvaluation(problems) {
  return {
    passed: false,
    observedState: 'invalid',
    violations: [{ code: 'INVALID_BASELINE_ARTIFACT', problems }],
  };
}

function splitDirectAnswerStatements(value) {
  return String(value ?? '')
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/u)
    .map(normalizeText)
    .filter(Boolean);
}

function evidenceCoversAnchor(evidence, anchor) {
  if (evidence?.evidenceType !== 'file_range' || evidence?.groundingStatus !== 'exact') return false;
  if (normalizeRepoPath(evidence?.path) !== normalizeRepoPath(anchor?.path)) return false;
  if (!Number.isInteger(anchor?.startLine) || !Number.isInteger(anchor?.endLine)) return true;
  if (!Number.isInteger(evidence?.startLine) || !Number.isInteger(evidence?.endLine)) return false;
  return evidence.startLine <= anchor.startLine && evidence.endLine >= anchor.endLine;
}

export function evaluateKnownBadBaseline(oracle, artifact) {
  if (!oracle || typeof oracle !== 'object' || !artifact || typeof artifact !== 'object') {
    return invalidKnownBadEvaluation(['oracle and artifact must be objects']);
  }

  if (artifact.recordType === 'documented_known_bad_observation') {
    const failureClass = artifact?.observation?.failureClass;
    const expectedFailureClass = oracle.documentedFailureClass;
    if (
      typeof failureClass !== 'string' || !failureClass ||
      typeof expectedFailureClass !== 'string' || !expectedFailureClass ||
      artifact?.source?.rawParentPayloadPreserved !== false ||
      artifact.parentPayload !== undefined
    ) {
      return invalidKnownBadEvaluation(['documented observation shape is invalid']);
    }
    if (failureClass !== expectedFailureClass) {
      return {
        passed: false,
        observedState: 'not_recorded',
        violations: [{
          code: 'DOCUMENTED_FAILURE_CLASS_MISMATCH',
          expected: expectedFailureClass,
          actual: failureClass,
        }],
      };
    }
    return {
      passed: false,
      observedState: 'not_recorded',
      violations: [{ code: 'DOCUMENTED_TRUST_FAILURE', failureClass }],
    };
  }

  const violations = [];
  if (artifact.transport && !artifact.parentPayload) {
    const transport = artifact.transport;
    const expectation = oracle.transportExpectation;
    if (
      !expectation || typeof expectation !== 'object' ||
      !Object.hasOwn(transport, 'requestId') ||
      typeof transport.cancelNotificationSent !== 'boolean' ||
      typeof transport.abortObserved !== 'boolean'
    ) {
      return invalidKnownBadEvaluation(['transport observation shape is invalid']);
    }
    const state = transport.abortObserved ? 'failed' : 'no_response';
    if (oracle.expectedState && state !== oracle.expectedState) {
      violations.push({
        code: 'EXPECTED_STATE_MISMATCH',
        expected: oracle.expectedState,
        actual: state,
      });
    }
    if (transport.requestId !== expectation.requestId) {
      violations.push({
        code: 'REQUEST_ID_MISMATCH',
        expected: expectation.requestId,
        actual: transport.requestId,
      });
    }
    if (
      expectation.cancelNotificationSent === true &&
      transport.cancelNotificationSent !== true
    ) {
      violations.push({ code: 'CANCEL_NOTIFICATION_MISSING', requestId: expectation.requestId });
    }
    if (expectation.abortObserved === true && !transport.abortObserved) {
      violations.push({ code: 'REQUEST_NOT_ABORTED', requestId: expectation.requestId });
    }
    return { passed: violations.length === 0, observedState: state, violations };
  }

  const payload = artifact.parentPayload;
  const result = payload?.structuredContent;
  const problems = [];
  if (!payload || typeof payload !== 'object') problems.push('parentPayload is required');
  if (!Array.isArray(payload?.content)) problems.push('parentPayload.content must be an array');
  if (!result || typeof result !== 'object') problems.push('structuredContent must be an object');
  if (result?.schemaVersion !== 2) problems.push('structuredContent.schemaVersion must be 2');
  if (typeof result?.directAnswer !== 'string' || !result.directAnswer.trim()) {
    problems.push('structuredContent.directAnswer must be non-empty');
  }
  if (typeof result?.status?.verification !== 'string') {
    problems.push('structuredContent.status.verification must be a string');
  }
  if (typeof result?.status?.complete !== 'boolean') {
    problems.push('structuredContent.status.complete must be a boolean');
  }
  if (!Array.isArray(result?.evidence)) problems.push('structuredContent.evidence must be an array');
  if (problems.length > 0) return invalidKnownBadEvaluation(problems);

  const state = result.failure ? 'failed' : result.status.complete ? 'complete' : 'incomplete';
  const evidence = result.evidence;
  const directStatements = splitDirectAnswerStatements(result.directAnswer);

  if (oracle.expectedState && state !== oracle.expectedState) {
    violations.push({
      code: 'EXPECTED_STATE_MISMATCH',
      expected: oracle.expectedState,
      actual: state,
    });
  }

  for (const claim of oracle.forbiddenClaims ?? []) {
    if (directStatements.includes(normalizeText(claim.text))) {
      violations.push({
        code: 'FORBIDDEN_CLAIM_PRESENT',
        claimId: claim.id,
      });
    }
  }

  const anchorsById = new Map((oracle.evidenceAnchors ?? []).map(anchor => [anchor.id, anchor]));
  for (const goal of oracle.expectedGoals ?? []) {
    if (goal.expectedResolution !== 'supported') continue;
    const anchorRefs = Array.isArray(goal.evidenceAnchorRefs) ? goal.evidenceAnchorRefs : [];
    const coveredRefs = anchorRefs.filter(ref => {
      const anchor = anchorsById.get(ref);
      return anchor && evidence.some(item => evidenceCoversAnchor(item, anchor));
    });
    const requiredCount = goal.anchorPolicy === 'all' ? anchorRefs.length : Math.min(anchorRefs.length, 1);
    const coveredCount = coveredRefs.length;
    if (requiredCount > 0 && coveredCount < requiredCount) {
      violations.push({
        code: 'REQUIRED_GOAL_UNSUPPORTED',
        goalId: goal.id,
        requiredAnchorCount: requiredCount,
        coveredAnchorCount: coveredCount,
        missingAnchorRefs: anchorRefs.filter(ref => !coveredRefs.includes(ref)),
      });
    }
  }

  return {
    passed: violations.length === 0,
    observedState: state,
    violations,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sameStringSet(left, right) {
  const normalizedLeft = [...new Set(asArray(left).map(normalizeText).filter(Boolean))].sort();
  const normalizedRight = [...new Set(asArray(right).map(normalizeText).filter(Boolean))].sort();
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function trustArtifactParts(artifact) {
  const wrapped = artifact && typeof artifact === 'object' ? artifact : {};
  const result = wrapped.result && typeof wrapped.result === 'object'
    ? wrapped.result
    : wrapped;
  const publicResult = result.parentHandoff && typeof result.parentHandoff === 'object'
    ? result.parentHandoff
    : result.structuredContent && typeof result.structuredContent === 'object'
      ? result.structuredContent
      : result;
  const semantic = result.semanticVerification && typeof result.semanticVerification === 'object'
    ? result.semanticVerification
    : {};
  const taskContract = result.taskContract ?? semantic.taskContract ?? {};
  return {
    wrapped,
    result,
    publicResult,
    semantic,
    subgoals: asArray(taskContract.subgoals),
    observations: asArray(result.observations),
    coverageGaps: asArray(result.coverageGaps ?? semantic.coverageGaps),
    rejectedGoals: asArray(result.rejectedGoals),
    auditRecords: asArray(
      wrapped.goalAuditRecords ?? result.goalAuditRecords ?? result.auditRecords,
    ),
  };
}

function expectedGoalResolutionMatches(goal, expectedResolution) {
  if (expectedResolution === 'supported') {
    return goal?.state === 'supported' && goal?.resolution === 'affirmed';
  }
  if (expectedResolution === 'refuted') {
    return goal?.state === 'supported' && goal?.resolution === 'refuted';
  }
  if (expectedResolution === 'gap') {
    return ['blocked', 'gap', 'contradicted'].includes(goal?.state) && goal?.resolution === undefined;
  }
  return expectedResolution === 'failed';
}

function matchRequiredGoals(expectedGoals, actualGoals) {
  const remaining = [...actualGoals];
  const actualByOracleId = new Map();
  const missing = [];
  for (const expected of expectedGoals) {
    if (expected.expectedResolution === 'failed') continue;
    const index = remaining.findIndex(goal =>
      normalizeText(goal?.question) === normalizeText(expected.question) &&
      goal?.claimType === expected.claimType &&
      (!Array.isArray(expected.requestOriginRefs) ||
        sameStringSet(goal?.originRefs, expected.requestOriginRefs))
    );
    if (index < 0) {
      missing.push(expected);
      continue;
    }
    actualByOracleId.set(expected.id, remaining[index]);
    remaining.splice(index, 1);
  }
  return { actualByOracleId, missing, unexpected: remaining };
}

function acceptedClaims(semantic) {
  const verdictByClaimId = new Map(asArray(semantic.verdicts ?? semantic.semanticVerdicts)
    .map(verdict => [verdict?.claimId, verdict]));
  return asArray(semantic.claims)
    .filter(claim => claim?.verdict === 'supported' &&
      verdictByClaimId.get(claim.id)?.result === 'supported')
    .map(claim => ({ claim, verdict: verdictByClaimId.get(claim.id) }));
}

function publicStatements(publicResult) {
  if (typeof publicResult?.directAnswer !== 'string') return [];
  return publicResult.directAnswer
    .split(/\r?\n+/u)
    .map(normalizeText)
    .filter(Boolean);
}

function rangeCovers(item, anchor) {
  if (!Number.isInteger(anchor?.startLine) || !Number.isInteger(anchor?.endLine)) return true;
  return Number.isInteger(item?.startLine) && Number.isInteger(item?.endLine) &&
    item.startLine <= anchor.startLine && item.endLine >= anchor.endLine;
}

function observationSupportsAnchor(observation, anchor) {
  if (observation?.kind !== anchor?.kind) return false;
  if (anchor.path !== undefined &&
      normalizeRepoPath(observation?.path) !== normalizeRepoPath(anchor.path)) return false;
  if (anchor.sha !== undefined && observation?.sha !== anchor.sha) return false;
  if (!rangeCovers(observation, anchor)) return false;
  if (anchor.sourceRole !== undefined && observation?.sourceRole !== anchor.sourceRole) return false;
  if (anchor.temporalRole !== undefined && observation?.temporalRole !== anchor.temporalRole) return false;
  return true;
}

function publicEvidenceSupportsAnchor(evidence, anchor) {
  const kind = evidence?.kind ?? (
    evidence?.evidenceType === 'file_range' ? 'source' : evidence?.evidenceType
  );
  if (kind !== anchor?.kind) return false;
  if (anchor.path !== undefined &&
      normalizeRepoPath(evidence?.path) !== normalizeRepoPath(anchor.path)) return false;
  if (anchor.sha !== undefined && evidence?.sha !== anchor.sha) return false;
  if (!rangeCovers(evidence, anchor)) return false;
  if (anchor.kind === 'git_commit' && anchor.path === undefined &&
      (evidence?.path !== undefined || evidence?.startLine !== undefined ||
        evidence?.endLine !== undefined)) return false;
  return true;
}

function boundaryEntryCovers(outer, inner) {
  const normalizedOuter = normalizeRepoPath(outer).replace(/^\.\//u, '');
  const normalizedInner = normalizeRepoPath(inner).replace(/^\.\//u, '');
  if (normalizedOuter === normalizedInner || normalizedOuter === '**') return true;
  if (!normalizedOuter.endsWith('/**')) return false;
  const prefix = normalizedOuter.slice(0, -3);
  return normalizedInner === prefix || normalizedInner.startsWith(`${prefix}/`);
}

function boundaryCovers(outerBoundary, innerBoundary) {
  const outer = asArray(outerBoundary);
  const inner = asArray(innerBoundary);
  return inner.length > 0 && inner.every(innerEntry =>
    outer.some(outerEntry => boundaryEntryCovers(outerEntry, innerEntry))
  );
}

function countObservationIssue(value) {
  if (Array.isArray(value)) return value.length;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function searchIndependentlyComplete(search, claimBoundary) {
  return search?.kind === 'search' &&
    search.matchCount === 0 &&
    search.enumerationComplete === true &&
    search.toolTruncated === false &&
    search.contextTruncated === false &&
    search.walkTruncated !== true &&
    search.resultTruncated !== true &&
    search.truncated !== true &&
    countObservationIssue(search.omittedOutOfScopeFiles) === 0 &&
    countObservationIssue(search.deniedPaths) === 0 &&
    countObservationIssue(search.errors) === 0 &&
    boundaryCovers(search.boundary, claimBoundary);
}

function auditRecordFor(parts, proposalRef) {
  const explicit = parts.auditRecords.find(record => record?.proposedGoalId === proposalRef);
  if (explicit) return explicit;
  const rejected = parts.rejectedGoals.find(record => record?.proposedGoalId === proposalRef);
  if (rejected) return rejected;
  const required = parts.subgoals.find(goal => goal?.id === proposalRef);
  return required ? {
    proposedGoalId: proposalRef,
    verdict: required.auditVerdict,
  } : null;
}

function rejectedGoalLeaked(parts, expectedAudit) {
  if (parts.subgoals.some(goal => goal?.id === expectedAudit.proposalRef) ||
      asArray(parts.semantic.claims).some(claim => claim?.subgoalId === expectedAudit.proposalRef) ||
      parts.coverageGaps.some(gap => gap?.subgoalId === expectedAudit.proposalRef)) {
    return true;
  }
  const rejected = parts.rejectedGoals.find(record =>
    record?.proposedGoalId === expectedAudit.proposalRef);
  const publicText = normalizeText(JSON.stringify(parts.publicResult));
  return JSON.stringify(parts.publicResult).includes(expectedAudit.proposalRef) ||
    (typeof rejected?.question === 'string' && rejected.question &&
      publicText.includes(normalizeText(rejected.question)));
}

function trustSignature({ observedState, expectedGoals, matchedGoals, allowedClaims, accepted }) {
  const acceptedTexts = new Set(accepted.map(item => normalizeText(item.claim.text)));
  return JSON.stringify({
    state: observedState,
    goals: expectedGoals.map(expected => {
      const actual = matchedGoals.get(expected.id);
      return {
        id: expected.id,
        state: actual?.state ?? (expected.expectedResolution === 'failed' ? 'failed' : 'missing'),
        resolution: actual?.resolution ?? null,
      };
    }).sort((left, right) => left.id.localeCompare(right.id)),
    claims: allowedClaims
      .filter(claim => acceptedTexts.has(normalizeText(claim.text)))
      .map(claim => claim.id)
      .sort(),
  });
}

/**
 * Evaluate one direct-runtime trust artifact against an independently authored
 * case oracle. Model confidence, self-scores, and grounding labels are never
 * acceptance inputs.
 */
export function evaluateTrustCase(caseDefinition, artifact) {
  const oracle = caseDefinition?.oracle;
  if (!oracle || typeof oracle !== 'object' || !artifact || typeof artifact !== 'object') {
    return {
      id: caseDefinition?.id ?? null,
      passed: false,
      observedState: 'invalid',
      repeatabilitySignature: '',
      violations: [{ code: 'INVALID_TRUST_ARTIFACT' }],
    };
  }

  const parts = trustArtifactParts(artifact);
  const violations = [];
  const expectedGoals = asArray(oracle.expectedGoals);
  const allowedClaims = asArray(oracle.allowedClaims);
  const forbiddenClaims = asArray(oracle.forbiddenClaims);
  const observedState = typeof parts.publicResult?.state === 'string'
    ? parts.publicResult.state
    : 'invalid';

  if (observedState !== oracle.expectedState) {
    violations.push({
      code: 'EXPECTED_STATE_MISMATCH',
      expected: oracle.expectedState,
      actual: observedState,
    });
  }

  const unresolved = parts.subgoals.some(goal => goal?.state !== 'supported');
  const stateAgreesWithGoals = parts.result?.failure || parts.publicResult?.failure
    ? observedState === 'failed'
    : parts.subgoals.length > 0 && (unresolved
      ? observedState === 'incomplete'
      : observedState === 'complete' || observedState === 'verify_targets');
  if (!stateAgreesWithGoals) {
    violations.push({ code: 'STATE_REDUCTION_MISMATCH', actual: observedState });
  }

  for (const expectedAudit of asArray(oracle.expectedGoalAudits)) {
    const actual = auditRecordFor(parts, expectedAudit.proposalRef);
    if (!actual || actual.verdict !== expectedAudit.verdict ||
        (expectedAudit.mergedInto !== undefined &&
          actual.mergeInto !== expectedAudit.mergedInto)) {
      violations.push({
        code: 'GOAL_AUDIT_MISMATCH',
        proposalRef: expectedAudit.proposalRef,
        expected: expectedAudit.verdict,
        actual: actual?.verdict ?? null,
      });
    }
    if (expectedAudit.required === false &&
        parts.subgoals.some(goal => goal?.id === expectedAudit.proposalRef)) {
      violations.push({
        code: 'GOAL_AUDIT_REQUIREDNESS_MISMATCH',
        proposalRef: expectedAudit.proposalRef,
      });
    }
    if (expectedAudit.mustNotLeak === true && rejectedGoalLeaked(parts, expectedAudit)) {
      violations.push({ code: 'REJECTED_GOAL_LEAKED', proposalRef: expectedAudit.proposalRef });
    }
  }

  const matched = observedState === 'failed'
    ? { actualByOracleId: new Map(), missing: [], unexpected: [] }
    : matchRequiredGoals(expectedGoals, parts.subgoals);
  for (const expected of matched.missing) {
    violations.push({ code: 'REQUIRED_GOAL_MISSING', goalId: expected.id });
  }
  for (const actual of matched.unexpected) {
    violations.push({ code: 'UNEXPECTED_REQUIRED_GOAL', subgoalId: actual?.id ?? null });
  }
  for (const expected of expectedGoals) {
    if (expected.expectedResolution === 'failed') continue;
    const actual = matched.actualByOracleId.get(expected.id);
    if (actual && !expectedGoalResolutionMatches(actual, expected.expectedResolution)) {
      violations.push({
        code: 'REQUIRED_GOAL_RESOLUTION_MISMATCH',
        goalId: expected.id,
        expected: expected.expectedResolution,
        actual: actual.state,
      });
    }
  }

  const accepted = acceptedClaims(parts.semantic);
  const acceptedByText = new Map(accepted.map(item => [normalizeText(item.claim.text), item]));
  const allowedByText = new Map(allowedClaims.map(claim => [normalizeText(claim.text), claim]));
  const statements = new Set(publicStatements(parts.publicResult));
  const observationsById = new Map(parts.observations.map(item => [item?.id, item]));
  const anchorsById = new Map(asArray(oracle.evidenceAnchors).map(item => [item?.id, item]));
  const publicEvidence = asArray(parts.publicResult?.evidence);

  if (observedState !== 'failed') {
    for (const statement of statements) {
      if (!allowedByText.has(statement)) {
        violations.push({ code: 'UNEXPECTED_PARENT_CLAIM', text: statement });
      }
    }
    for (const item of accepted) {
      if (!allowedByText.has(normalizeText(item.claim.text))) {
        violations.push({ code: 'UNEXPECTED_ACCEPTED_CLAIM', claimId: item.claim.id });
      }
    }
  }

  for (const forbidden of forbiddenClaims) {
    const text = normalizeText(forbidden.text);
    if (statements.has(text) || acceptedByText.has(text)) {
      violations.push({ code: 'FORBIDDEN_CLAIM_PRESENT', claimId: forbidden.id });
    }
  }

  for (const allowed of allowedClaims) {
    const text = normalizeText(allowed.text);
    const acceptedClaim = acceptedByText.get(text);
    if (!acceptedClaim || !statements.has(text)) {
      violations.push({ code: 'ALLOWED_CLAIM_MISSING', claimId: allowed.id });
      continue;
    }
    const actualGoal = matched.actualByOracleId.get(allowed.goalId);
    if (!actualGoal || acceptedClaim.claim.subgoalId !== actualGoal.id) {
      violations.push({ code: 'CLAIM_GOAL_MISMATCH', claimId: allowed.id });
      continue;
    }
    for (const anchorRef of asArray(allowed.evidenceAnchorRefs)) {
      const anchor = anchorsById.get(anchorRef);
      const declaredEvidenceRefs = new Set(asArray(acceptedClaim.claim.evidenceRefs));
      const supportingObservations = asArray(acceptedClaim.verdict.supportingEvidenceRefs)
        .filter(ref => declaredEvidenceRefs.has(ref))
        .map(ref => observationsById.get(ref));
      if (!anchor || !supportingObservations.some(item =>
        observationSupportsAnchor(item, anchor))) {
        violations.push({
          code: 'CLAIM_EVIDENCE_UNSUPPORTED',
          claimId: allowed.id,
          anchorRef,
        });
      }
      if (actualGoal.claimType !== 'absence' && anchor &&
          !publicEvidence.some(item => publicEvidenceSupportsAnchor(item, anchor))) {
        violations.push({
          code: 'PARENT_EVIDENCE_UNSUPPORTED',
          claimId: allowed.id,
          anchorRef,
        });
      }
    }
  }

  const expectedBoundary = oracle.boundary?.claimScope;
  for (const expected of expectedGoals.filter(goal =>
    goal.claimType === 'absence' && goal.expectedResolution === 'supported')) {
    const actualGoal = matched.actualByOracleId.get(expected.id);
    if (!actualGoal) continue;
    const certificate = asArray(parts.semantic.absenceCertificates)
      .find(item => item?.subgoalId === actualGoal.id);
    if (!certificate || certificate.complete !== true) {
      violations.push({ code: 'ABSENCE_CERTIFICATE_MISSING', goalId: expected.id });
      continue;
    }
    const claimBoundary = expected.claimBoundary ?? expectedBoundary;
    if (!sameStringSet(certificate.claimBoundary, claimBoundary)) {
      violations.push({ code: 'ABSENCE_BOUNDARY_MISMATCH', goalId: expected.id });
    }
    const searches = asArray(certificate.searchRefs)
      .map(ref => observationsById.get(ref));
    if (certificate.zeroMatches !== true || searches.length === 0 || searches.some(search =>
      !searchIndependentlyComplete(search, certificate.claimBoundary))) {
      violations.push({ code: 'ABSENCE_SEARCH_INCOMPLETE', goalId: expected.id });
    }
    const publicAbsence = publicEvidence.find(item =>
      item?.kind === 'absence' && sameStringSet(item.boundary, claimBoundary));
    if (!publicAbsence || asArray(publicAbsence.searches).length === 0) {
      violations.push({ code: 'PUBLIC_ABSENCE_EVIDENCE_MISSING', goalId: expected.id });
    }
  }

  const repeatabilitySignature = trustSignature({
    observedState,
    expectedGoals,
    matchedGoals: matched.actualByOracleId,
    allowedClaims,
    accepted,
  });
  return {
    id: caseDefinition.id,
    passed: violations.length === 0,
    observedState,
    repeatabilitySignature,
    violations,
  };
}

/** Evaluate repeated runs while deliberately ignoring optional evidence choice. */
export function evaluateTrustRepeatability(caseDefinition, artifacts) {
  const runs = asArray(artifacts).map(artifact => evaluateTrustCase(caseDefinition, artifact));
  const signatures = runs.map(run => run.repeatabilitySignature);
  const violations = [];
  const expectedRunCount = Number.isInteger(caseDefinition?.repeatCount)
    ? caseDefinition.repeatCount
    : runs.length;
  if (runs.length !== expectedRunCount) {
    violations.push({
      code: 'REPEAT_COUNT_MISMATCH',
      expected: expectedRunCount,
      actual: runs.length,
    });
  }
  runs.forEach((run, index) => {
    if (!run.passed) {
      violations.push({
        code: 'RUN_EVALUATION_FAILED',
        run: index + 1,
        violationCodes: run.violations.map(item => item.code),
      });
    }
  });
  if (new Set(signatures).size > 1) {
    violations.push({ code: 'REPEATABILITY_MISMATCH' });
  }
  return {
    id: caseDefinition?.id ?? null,
    passed: violations.length === 0,
    runCount: runs.length,
    expectedRunCount,
    signatures,
    runs,
    violations,
  };
}

function joinLines(values) {
  return values.filter(Boolean).join('\n');
}

function getSourceText(result, source) {
  switch (source) {
    case 'direct_answer':
      return result.directAnswer ?? '';
    case 'combined_text':
      return joinLines([
        result.directAnswer,
        result.state,
        ...(result.targets ?? []).map(item => item.reason),
        ...(result.evidence ?? []).map(item => item.supports),
        ...(result.gaps ?? []).flatMap(item => [item.need, item.blocker]),
        result.followUp?.action,
        result.followUp?.reason,
        result.retry?.action,
        result.retry?.reason,
      ]);
    case 'evidence_paths':
      return joinLines((result.evidence ?? []).map(item => item.path));
    case 'evidence_supports':
      return joinLines((result.evidence ?? []).map(item => item.supports));
    case 'target_paths':
      return joinLines((result.targets ?? []).map(item => item.path));
    case 'target_reasons':
      return joinLines((result.targets ?? []).map(item => item.reason));
    case 'evidence_snippets':
      return joinLines((result.evidence ?? []).map(item => item.snippet));
    case 'result_state':
      return result.state ?? '';
    default:
      throw new Error(`Unknown benchmark source: ${source}`);
  }
}

function evaluateKeywordGroups(haystack, groups) {
  const normalizedHaystack = normalizeText(haystack);
  const details = groups.map(group => {
    const matchedToken = group.find(token => normalizedHaystack.includes(normalizeText(token))) ?? null;
    return {
      group,
      matched: Boolean(matchedToken),
      matchedToken,
    };
  });
  const matchedCount = details.filter(item => item.matched).length;
  return {
    matchedCount,
    totalCount: groups.length,
    coverage: groups.length > 0 ? matchedCount / groups.length : 1,
    details,
  };
}

function evaluateCheck(result, check) {
  let passed = false;
  let actual;
  let expected = check.value;
  switch (check.type) {
    case 'min_evidence_count':
      actual = (result.evidence ?? []).length;
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'min_target_count':
      actual = (result.targets ?? []).length;
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'min_evidence_snippet_count':
      actual = (result.evidence ?? []).filter(item => typeof item.snippet === 'string' && item.snippet.trim()).length;
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'has_direct_answer':
      actual = typeof result.directAnswer === 'string' && result.directAnswer.trim().length > 0;
      passed = actual === Boolean(check.value);
      break;
    default:
      throw new Error(`Unknown benchmark check type: ${check.type}`);
  }

  return {
    label: check.label,
    type: check.type,
    expected,
    actual,
    passed,
    weight: Number(check.weight ?? 1),
    pointsEarned: passed ? Number(check.weight ?? 1) : 0,
  };
}

export function evaluateBenchmarkCase(caseDefinition, result) {
  const expectations = Array.isArray(caseDefinition.expectations) ? caseDefinition.expectations : [];
  const checks = Array.isArray(caseDefinition.checks) ? caseDefinition.checks : [];

  const scoredExpectations = expectations.map(expectation => {
    const evaluation = evaluateKeywordGroups(
      getSourceText(result, expectation.source),
      expectation.groups ?? [],
    );
    const weight = Number(expectation.weight ?? 1);
    return {
      label: expectation.label,
      source: expectation.source,
      weight,
      minCoverage: Number(expectation.minCoverage ?? 1),
      ...evaluation,
      passed: evaluation.coverage >= Number(expectation.minCoverage ?? 1),
      pointsEarned: evaluation.coverage * weight,
    };
  });

  const scoredChecks = checks.map(check => evaluateCheck(result, check));
  const totalWeight =
    scoredExpectations.reduce((sum, item) => sum + item.weight, 0) +
    scoredChecks.reduce((sum, item) => sum + item.weight, 0);
  const earnedWeight =
    scoredExpectations.reduce((sum, item) => sum + item.pointsEarned, 0) +
    scoredChecks.reduce((sum, item) => sum + item.pointsEarned, 0);
  const normalizedScore = totalWeight > 0 ? earnedWeight / totalWeight : 0;
  const passScore = Number(caseDefinition.passScore ?? 0.7);

  return {
    id: caseDefinition.id,
    description: caseDefinition.description ?? '',
    score: Math.round(normalizedScore * 1000) / 1000,
    passScore,
    passed: normalizedScore >= passScore,
    expectations: scoredExpectations,
    checks: scoredChecks,
  };
}

export function summarizeBenchmarkSuite(caseResults) {
  const count = caseResults.length;
  const averageScore = count > 0
    ? caseResults.reduce((sum, item) => sum + item.evaluation.score, 0) / count
    : 0;
  const passedCount = caseResults.filter(item => item.evaluation.passed).length;

  return {
    caseCount: count,
    passedCount,
    failedCount: count - passedCount,
    averageScore: Math.round(averageScore * 1000) / 1000,
  };
}
