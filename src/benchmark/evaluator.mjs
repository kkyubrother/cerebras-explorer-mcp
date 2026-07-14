export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRepoPath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

export const FIXTURE_TRUST_EVALUATION_PROFILE = 'fixture_strict_v1';
export const LIVE_TRUST_EVALUATION_PROFILE = 'fail_closed_anchor_or_gap_v1';
export const PORTABLE_PARENT_OBSERVATION_PROFILE = 'parent-native-research-v3';
export const PORTABLE_PARENT_OBSERVATION_PENDING = 'pending_actual_harness';

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const GIT_SHA_HEX = /^[0-9a-f]{40}$/u;

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyRecordKeys(value, expectedKeys) {
  return isPlainRecord(value) && sameStringSet(Object.keys(value), expectedKeys);
}

function validPortableAllowance(value) {
  return hasOnlyRecordKeys(value, [
    'citedTargetReads', 'citedPathSearches', 'allowedFollowUps',
  ]) && Object.values(value).every(item => Number.isInteger(item) && item >= 0);
}

function validPortableSourcePin(value) {
  const commonValid = isPlainRecord(value) &&
    typeof value.caseId === 'string' && value.caseId.length > 0 &&
    typeof value.sourceRef === 'string' && value.sourceRef.length > 0 &&
    typeof value.repoId === 'string' && value.repoId.length > 0 &&
    SHA256_HEX.test(value.handoffSha256 ?? '');
  if (!commonValid) return false;
  if (value.kind === 'repository') {
    return hasOnlyRecordKeys(value, [
      'caseId', 'sourceRef', 'repoId', 'kind', 'gitSha',
      'dirtyTreeSha256', 'promptSha256', 'handoffSha256',
    ]) && GIT_SHA_HEX.test(value.gitSha ?? '') &&
      SHA256_HEX.test(value.dirtyTreeSha256 ?? '') &&
      SHA256_HEX.test(value.promptSha256 ?? '');
  }
  return value.kind === 'fixture' && hasOnlyRecordKeys(value, [
    'caseId', 'sourceRef', 'repoId', 'kind', 'repoTreeSha256',
    'promptSha256', 'handoffSha256',
  ]) && SHA256_HEX.test(value.repoTreeSha256 ?? '') &&
    SHA256_HEX.test(value.promptSha256 ?? '');
}

function roundSix(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Project the portable, hash-bound subset of a schema-v3 harness report. */
export function projectPortableParentObservationReport(report, {
  denominatorCaseIds = [],
  sourcePins = [],
  reportSha256 = null,
} = {}) {
  const metrics = report?.metrics;
  return {
    profile: report?.policy?.id ?? null,
    status: 'recorded',
    denominatorCaseIds: [...denominatorCaseIds],
    minimumRate: report?.policy?.passThreshold ?? null,
    reportSha256,
    sourcePins: sourcePins.map(item => ({ ...item })),
    metrics: isPlainRecord(metrics) ? {
      denominatorCaseCount: metrics.denominatorCaseCount,
      observedCaseCount: metrics.observedCaseCount,
      invalidObservationCaseCount: metrics.invalidObservationCaseCount,
      noBroadNativeResearchCaseCount: metrics.noBroadNativeResearchCaseCount,
      broadNativeResearchCaseCount: metrics.broadNativeResearchCaseCount,
      noBroadNativeResearchRate: metrics.noBroadNativeResearchRate,
      allowance: isPlainRecord(metrics.allowance) ? { ...metrics.allowance } : metrics.allowance,
    } : null,
    cases: Array.isArray(report?.cases) ? report.cases.map(item => ({
      id: item?.id,
      repoId: item?.repoId,
      sourcePin: isPlainRecord(item?.sourcePin) ? { ...item.sourcePin } : item?.sourcePin,
      promptSha256: item?.promptSha256,
      handoffSha256: item?.handoffSha256,
      traceSha256: item?.traceSha256,
      observed: item?.observed,
      noBroad: item?.noBroad,
      broadActionCount: item?.broadActionCount,
      allowance: isPlainRecord(item?.allowance) ? { ...item.allowance } : item?.allowance,
      violations: Array.isArray(item?.violations) ? [...item.violations] : item?.violations,
    })) : [],
  };
}

/**
 * Validate the portable projection of an actual parent-observation harness run.
 * Raw Codex JSONL remains external; report and trace hashes bind this record to
 * those artifacts without copying machine paths, commands, prose, or usage.
 */
export function evaluatePortableParentObservationRecord(record, {
  expectedCaseIds = [],
  expectedMinimumRate = 0.9,
  expectedSourcePins = [],
} = {}) {
  const problems = [];
  const expectedTopKeys = [
    'profile', 'status', 'denominatorCaseIds', 'minimumRate', 'reportSha256',
    'sourcePins', 'metrics', 'cases',
  ];
  if (!hasOnlyRecordKeys(record, expectedTopKeys)) {
    return { valid: false, problems: ['portable parent-observation record has an invalid shape'] };
  }
  if (record.profile !== PORTABLE_PARENT_OBSERVATION_PROFILE) {
    problems.push('portable parent-observation record has an invalid profile');
  }
  if (!sameStringSet(record.denominatorCaseIds, expectedCaseIds) ||
      expectedCaseIds.length !== 14) {
    problems.push('portable parent-observation denominator drifted from the fixed 14 cases');
  }
  if (record.minimumRate !== expectedMinimumRate) {
    problems.push('portable parent-observation minimum rate drifted');
  }

  const sourcePins = Array.isArray(record.sourcePins) ? record.sourcePins : [];
  if (!sameStringSet(
    sourcePins.map(item => JSON.stringify(item)),
    expectedSourcePins.map(item => JSON.stringify(item)),
  ) || sourcePins.some(item => !validPortableSourcePin(item))) {
    problems.push('portable parent-observation source pins or handoff hashes do not match');
  }

  if (record.status === PORTABLE_PARENT_OBSERVATION_PENDING) {
    if (record.reportSha256 !== null || record.metrics !== null ||
        !Array.isArray(record.cases) || record.cases.length !== 0) {
      problems.push('pending parent-observation placeholder contains unobserved result data');
    }
    problems.push('portable parent-observation record is pending the actual harness');
    return { valid: false, problems };
  }
  if (record.status !== 'recorded') {
    problems.push('portable parent-observation record has an invalid status');
  }
  if (!SHA256_HEX.test(record.reportSha256 ?? '')) {
    problems.push('portable parent-observation report hash is missing');
  }

  const cases = Array.isArray(record.cases) ? record.cases : [];
  const sourcePinByCase = new Map(sourcePins.map(item => [item.caseId, item]));
  if (!sameStringSet(cases.map(item => item?.id), expectedCaseIds)) {
    problems.push('portable parent-observation cases do not cover the fixed denominator');
  }
  for (const item of cases) {
    const exactShape = hasOnlyRecordKeys(item, [
      'id', 'repoId', 'sourcePin', 'promptSha256', 'handoffSha256',
      'traceSha256', 'observed', 'noBroad', 'broadActionCount',
      'allowance', 'violations',
    ]);
    const expectedPin = sourcePinByCase.get(item?.id);
    const expectedCaseSourcePin = expectedPin?.kind === 'repository'
      ? {
          kind: 'repository',
          gitSha: expectedPin.gitSha,
          dirtyTreeSha256: expectedPin.dirtyTreeSha256,
        }
      : {
          kind: 'fixture',
          repoTreeSha256: expectedPin?.repoTreeSha256,
        };
    const codes = Array.isArray(item?.violations) ? item.violations : [];
    if (!exactShape || expectedPin?.repoId !== item.repoId ||
        JSON.stringify(item.sourcePin) !== JSON.stringify(expectedCaseSourcePin) ||
        item.promptSha256 !== expectedPin?.promptSha256 ||
        item.handoffSha256 !== expectedPin?.handoffSha256 ||
        !SHA256_HEX.test(item.promptSha256 ?? '') ||
        !SHA256_HEX.test(item.handoffSha256 ?? '') ||
        typeof item.observed !== 'boolean' ||
        typeof item.noBroad !== 'boolean' ||
        !Number.isInteger(item.broadActionCount) || item.broadActionCount < 0 ||
        !validPortableAllowance(item.allowance) ||
        !SHA256_HEX.test(item.traceSha256 ?? '') ||
        new Set(codes).size !== codes.length ||
        codes.some(code => typeof code !== 'string' || !/^[a-z0-9_]+$/u.test(code)) ||
        (item.noBroad && (!item.observed || item.broadActionCount !== 0))) {
      problems.push(`portable parent-observation case ${String(item?.id)} is invalid`);
    }
  }

  const denominatorCaseCount = cases.length;
  const observedCaseCount = cases.filter(item => item?.observed === true).length;
  const invalidObservationCaseCount = cases.filter(item => item?.observed === false).length;
  const noBroadNativeResearchCaseCount = cases
    .filter(item => item?.noBroad === true).length;
  const broadNativeResearchCaseCount = cases
    .filter(item => Number.isInteger(item?.broadActionCount) && item.broadActionCount > 0).length;
  const noBroadNativeResearchRate = denominatorCaseCount === 0
    ? null
    : roundSix(noBroadNativeResearchCaseCount / denominatorCaseCount);
  const allowance = {
    citedTargetReads: cases.reduce(
      (sum, item) => sum + (item?.allowance?.citedTargetReads ?? 0), 0,
    ),
    citedPathSearches: cases.reduce(
      (sum, item) => sum + (item?.allowance?.citedPathSearches ?? 0), 0,
    ),
    allowedFollowUps: cases.reduce(
      (sum, item) => sum + (item?.allowance?.allowedFollowUps ?? 0), 0,
    ),
  };
  const expectedMetrics = {
    denominatorCaseCount,
    observedCaseCount,
    invalidObservationCaseCount,
    noBroadNativeResearchCaseCount,
    broadNativeResearchCaseCount,
    noBroadNativeResearchRate,
    allowance,
  };
  if (!hasOnlyRecordKeys(record.metrics, Object.keys(expectedMetrics)) ||
      JSON.stringify(record.metrics) !== JSON.stringify(expectedMetrics)) {
    problems.push('portable parent-observation metrics do not match the case records');
  }
  if (noBroadNativeResearchRate === null || noBroadNativeResearchRate < record.minimumRate) {
    problems.push('portable parent-observation record misses the no-broad-research gate');
  }
  return { valid: problems.length === 0, problems };
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
  if (anchor.kind === 'search') {
    return observation?.tool === anchor.tool &&
      sameStringSet(observation?.boundary, anchor.boundary) &&
      observation?.matchCount === anchor.matchCount &&
      observation?.toolTruncated === anchor.toolTruncated &&
      observation?.contextTruncated === anchor.contextTruncated &&
      countObservationIssue(observation?.omittedOutOfScopeFiles) ===
        anchor.omittedOutOfScopeFiles &&
      countObservationIssue(observation?.deniedPaths) === anchor.deniedPaths &&
      countObservationIssue(observation?.errors) === anchor.errors &&
      observation?.enumerationComplete === anchor.enumerationComplete;
  }
  if (anchor.path !== undefined &&
      normalizeRepoPath(observation?.path) !== normalizeRepoPath(anchor.path)) return false;
  if (anchor.sha !== undefined && observation?.sha !== anchor.sha) return false;
  if (!rangeCovers(observation, anchor)) return false;
  if (anchor.sourceRole !== undefined && observation?.sourceRole !== anchor.sourceRole) return false;
  if (anchor.temporalRole !== undefined && observation?.temporalRole !== anchor.temporalRole) return false;
  return true;
}

function publicEvidenceSupportsAnchor(evidence, anchor) {
  const publicKind = evidence?.kind ?? (
    evidence?.evidenceType === 'file_range' ? 'source' : evidence?.evidenceType
  );
  const kind = publicKind === 'git' && anchor?.kind === 'git_commit'
    ? 'git_commit'
    : publicKind === 'absence' && anchor?.kind === 'search'
      ? 'search'
      : publicKind;
  if (kind !== anchor?.kind) return false;
  if (anchor.kind === 'search') {
    return sameStringSet(evidence?.boundary, anchor.boundary) &&
      asArray(evidence?.searches).length > 0;
  }
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

function invalidEvaluationProfile(caseDefinition, mode, profile) {
  return {
    id: caseDefinition?.id ?? null,
    passed: false,
    observedState: 'invalid',
    evaluationProfile: profile ?? null,
    repeatabilitySignature: JSON.stringify({ state: 'invalid' }),
    violations: [{ code: 'INVALID_EVALUATION_PROFILE', mode, profile: profile ?? null }],
  };
}

function liveEvaluationProfile(caseDefinition, options) {
  const mode = options?.mode ?? 'fixture';
  const profile = options?.profile ?? (
    mode === 'fixture' ? FIXTURE_TRUST_EVALUATION_PROFILE : null
  );
  if (mode === 'fixture') {
    return profile === FIXTURE_TRUST_EVALUATION_PROFILE
      ? { mode, profile }
      : null;
  }
  if (mode !== 'live' || profile !== LIVE_TRUST_EVALUATION_PROFILE) return null;
  const policy = caseDefinition?.livePolicy;
  if (!policy || Object.keys(policy).length !== 1 || policy.profile !== profile) return null;
  return { mode, profile };
}

function liveForbiddenClaimPresent(parts, forbiddenClaim) {
  const forbidden = normalizeText(forbiddenClaim?.text);
  if (!forbidden) return false;
  const parentStatements = splitDirectAnswerStatements(parts.publicResult?.directAnswer);
  const supportedClaims = acceptedClaims(parts.semantic)
    .map(item => normalizeText(item.claim?.text));
  return parentStatements.includes(forbidden) || supportedClaims.includes(forbidden);
}

function publicEvidenceInBoundary(evidence, claimScope) {
  if (evidence?.kind === 'source') {
    return typeof evidence.path === 'string' && boundaryCovers(claimScope, [evidence.path]);
  }
  if (evidence?.kind === 'git') {
    return evidence.path === undefined || boundaryCovers(claimScope, [evidence.path]);
  }
  if (evidence?.kind === 'absence') {
    return boundaryCovers(claimScope, evidence.boundary);
  }
  return false;
}

function publicEvidenceIsGrounded(evidence, parts) {
  if (evidence?.kind === 'source') {
    return parts.observations.some(observation =>
      observation?.kind === 'source' &&
      normalizeRepoPath(observation.path) === normalizeRepoPath(evidence.path) &&
      rangeCovers(observation, evidence));
  }
  if (evidence?.kind === 'git') {
    return parts.observations.some(observation =>
      ['git_commit', 'git_blame', 'git_diff_hunk'].includes(observation?.kind) &&
      observation.sha === evidence.sha &&
      (evidence.path === undefined ||
        normalizeRepoPath(observation.path) === normalizeRepoPath(evidence.path)) &&
      rangeCovers(observation, evidence));
  }
  if (evidence?.kind !== 'absence') return false;
  return asArray(parts.semantic.absenceCertificates).some(certificate => {
    if (certificate?.complete !== true || certificate?.zeroMatches !== true ||
        !sameStringSet(certificate.claimBoundary, evidence.boundary) ||
        !sameStringSet(certificate.searchSummary, evidence.searches)) return false;
    const searches = asArray(certificate.searchRefs)
      .map(ref => parts.observations.find(observation => observation?.id === ref));
    return searches.length > 0 && searches.every(search =>
      searchIndependentlyComplete(search, certificate.claimBoundary));
  });
}

function publicEvidenceSupportsLiveAnchor(evidence, anchor, parts) {
  if (!publicEvidenceSupportsAnchor(evidence, anchor)) return false;
  return parts.observations.some(observation => observationSupportsAnchor(observation, anchor));
}

function parseRequestOriginRef(value) {
  const match = /^request:(\d+)-(\d+)$/u.exec(String(value ?? ''));
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < end
    ? { start, end }
    : null;
}

function originsCoverExpected(actualRefs, expectedRefs) {
  const actual = asArray(actualRefs).map(parseRequestOriginRef).filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const expected = asArray(expectedRefs).map(parseRequestOriginRef).filter(Boolean);
  if (actual.length === 0 || expected.length !== asArray(expectedRefs).length ||
      expected.length === 0) return false;
  return expected.every(target => {
    let cursor = target.start;
    for (const interval of actual) {
      if (interval.end <= cursor || interval.start > cursor) continue;
      cursor = Math.max(cursor, interval.end);
      if (cursor >= target.end) return true;
    }
    return false;
  });
}

function liveGoalMatches(expectedGoals, actualGoals) {
  const candidates = expectedGoals.map(expected => actualGoals
    .map((actual, index) => ({ actual, index }))
    .filter(({ actual }) => originsCoverExpected(actual?.originRefs, expected.requestOriginRefs))
    .sort((left, right) => {
      const leftExact = left.actual?.claimType === expected.claimType ? 0 : 1;
      const rightExact = right.actual?.claimType === expected.claimType ? 0 : 1;
      return leftExact - rightExact || left.index - right.index;
    }));
  const expectedOrder = expectedGoals.map((_, index) => index)
    .sort((left, right) => candidates[left].length - candidates[right].length || left - right);
  const ownerByActual = new Map();
  const actualByExpected = new Map();

  const assign = (expectedIndex, visited) => {
    for (const candidate of candidates[expectedIndex]) {
      if (visited.has(candidate.index)) continue;
      visited.add(candidate.index);
      const previousExpected = ownerByActual.get(candidate.index);
      if (previousExpected === undefined || assign(previousExpected, visited)) {
        ownerByActual.set(candidate.index, expectedIndex);
        actualByExpected.set(expectedIndex, candidate.actual);
        return true;
      }
    }
    return false;
  };
  for (const expectedIndex of expectedOrder) assign(expectedIndex, new Set());
  return new Map(expectedGoals.flatMap((goal, index) =>
    actualByExpected.has(index) ? [[goal.id, actualByExpected.get(index)]] : []));
}

function liveClaimTypeCompatible(expectedType, actualType) {
  return expectedType === actualType ||
    (expectedType === 'positive' && actualType === 'symbol_definition');
}

function liveClaimHasCertifiedStaticArrayAnchor(item, anchor, parts) {
  const measurement = item?.claim?.measurement;
  if (measurement?.kind !== 'count' || measurement.unit !== 'array_entries' ||
      !Number.isSafeInteger(measurement.value) || measurement.value < 0) return false;
  const supportingRefs = new Set(asArray(item?.verdict?.supportingEvidenceRefs));
  return asArray(item?.claim?.evidenceRefs).some(ref => {
    if (!supportingRefs.has(ref) || !String(ref).endsWith(':search')) return false;
    const search = parts.observations.find(observation => observation?.id === ref);
    const identities = asArray(search?.normalizedItemIds);
    const deterministicCount = asArray(parts.semantic?.deterministicCounts).find(count =>
      count?.claimId === item.claim.id && count?.observationRef === ref &&
      count?.complete === true && count?.unit === 'array_entries' &&
      count?.count === measurement.value);
    if (search?.kind !== 'search' || search.tool !== 'repo_symbol_context' ||
        search.enumerationComplete !== true ||
        search.deterministicMeasurement?.kind !== 'count' ||
        search.deterministicMeasurement?.unit !== 'array_entries' ||
        search.deterministicMeasurement?.value !== measurement.value ||
        identities.length !== measurement.value ||
        new Set(identities).size !== identities.length || !deterministicCount) {
      return false;
    }
    const source = parts.observations.find(observation =>
      observation?.id === ref.slice(0, -':search'.length));
    return observationSupportsAnchor(source, anchor) &&
      boundaryCovers(search.boundary, [anchor.path]);
  });
}

function liveClaimSupportsAnchor(item, anchor, parts) {
  const supportingRefs = new Set(asArray(item?.verdict?.supportingEvidenceRefs));
  return asArray(item?.claim?.evidenceRefs).some(ref => supportingRefs.has(ref) &&
    parts.observations.some(observation =>
      observation?.id === ref && observationSupportsAnchor(observation, anchor))) ||
    liveClaimHasCertifiedStaticArrayAnchor(item, anchor, parts);
}

function liveAnchorDispositions(expectedGoals, anchorsById, publicEvidence, parts) {
  const matchedGoals = liveGoalMatches(expectedGoals, parts.subgoals);
  const accepted = acceptedClaims(parts.semantic);
  const publicClaimTexts = new Set(publicStatements(parts.publicResult));
  const publicGaps = new Set(asArray(parts.publicResult?.gaps)
    .map(gap => normalizeText(gap?.question)).filter(Boolean));
  const internalGapIds = new Set(parts.coverageGaps
    .filter(gap => typeof gap?.subgoalId === 'string' && gap.subgoalId)
    .map(gap => gap.subgoalId));

  return expectedGoals.map(expected => {
    const actual = matchedGoals.get(expected.id);
    if (!actual) return { goalId: expected.id, disposition: 'missing', claimTexts: [] };
    const claims = accepted.filter(item => item.claim?.subgoalId === actual.id);
    const anchorRefs = asArray(expected.evidenceAnchorRefs);
    const covered = anchorRefs.filter(ref => {
      const anchor = anchorsById.get(ref);
      return anchor && publicEvidence.some(evidence =>
        publicEvidenceSupportsLiveAnchor(evidence, anchor, parts)) &&
        claims.some(item => liveClaimSupportsAnchor(item, anchor, parts));
    });
    const required = expected.anchorPolicy === 'all'
      ? anchorRefs.length
      : Math.min(anchorRefs.length, 1);
    const surfacedClaims = claims.filter(item =>
      publicClaimTexts.has(normalizeText(item.claim?.text)) &&
      anchorRefs.some(ref => {
        const anchor = anchorsById.get(ref);
        return anchor && liveClaimSupportsAnchor(item, anchor, parts);
      }));
    const resolutionSupported = expected.expectedResolution === 'refuted'
      ? actual.state === 'supported' && actual.resolution === 'refuted'
      : actual.state === 'supported' && actual.resolution === 'affirmed';
    if (resolutionSupported && liveClaimTypeCompatible(expected.claimType, actual.claimType) &&
        required > 0 && covered.length >= required && surfacedClaims.length > 0) {
      return {
        goalId: expected.id,
        disposition: 'anchor_supported',
        claimTexts: surfacedClaims.map(item => normalizeText(item.claim.text)),
      };
    }
    const unresolved = ['blocked', 'gap', 'contradicted'].includes(actual.state) ||
      (internalGapIds.has(actual.id) && surfacedClaims.length === 0);
    if (unresolved && internalGapIds.has(actual.id) &&
        publicGaps.has(normalizeText(actual.question))) {
      return { goalId: expected.id, disposition: 'explicit_gap', claimTexts: [] };
    }
    return { goalId: expected.id, disposition: 'unresolved', claimTexts: [] };
  });
}

function originRefsFitWithinExpected(actualRefs, expectedRefs) {
  const actual = asArray(actualRefs).map(parseRequestOriginRef).filter(Boolean);
  const expected = asArray(expectedRefs).map(parseRequestOriginRef).filter(Boolean);
  return actual.length > 0 && actual.length === asArray(actualRefs).length &&
    expected.length > 0 && expected.length === asArray(expectedRefs).length &&
    actual.every(inner => expected.some(outer =>
      inner.start >= outer.start && inner.end <= outer.end));
}

function liveSupplementalClaimTexts(expectedGoals, anchorsById, parts) {
  const publicClaimTexts = new Set(publicStatements(parts.publicResult));
  const subgoalById = new Map(parts.subgoals.map(subgoal => [subgoal?.id, subgoal]));
  return acceptedClaims(parts.semantic).flatMap(item => {
    const subgoal = subgoalById.get(item.claim?.subgoalId);
    if (subgoal?.state !== 'supported' || !publicClaimTexts.has(normalizeText(item.claim?.text))) {
      return [];
    }
    const refinesComparison = expectedGoals.some(expected =>
      expected.claimType === 'comparison' &&
      ['positive', 'count', 'symbol_definition', 'comparison'].includes(subgoal.claimType) &&
      originRefsFitWithinExpected(subgoal.originRefs, expected.requestOriginRefs) &&
      asArray(expected.evidenceAnchorRefs).some(ref => {
        const anchor = anchorsById.get(ref);
        return anchor && liveClaimSupportsAnchor(item, anchor, parts);
      }));
    return refinesComparison ? [normalizeText(item.claim.text)] : [];
  });
}

function evaluateLiveTrustCase(caseDefinition, artifact, profile) {
  const oracle = caseDefinition.oracle;
  const parts = trustArtifactParts(artifact);
  const violations = [];
  const observedState = typeof parts.publicResult?.state === 'string'
    ? parts.publicResult.state
    : 'invalid';
  const expectedGoals = asArray(oracle.expectedGoals);
  const publicEvidence = asArray(parts.publicResult?.evidence);
  const claimScope = asArray(oracle.boundary?.claimScope);
  const anchorsById = new Map(asArray(oracle.evidenceAnchors)
    .map(anchor => [anchor?.id, anchor]));

  if (!['complete', 'verify_targets', 'incomplete'].includes(observedState)) {
    violations.push({ code: 'LIVE_STATE_REJECTED', actual: observedState });
  }

  const unresolved = parts.subgoals.some(goal => goal?.state !== 'supported');
  if ((observedState === 'complete' || observedState === 'verify_targets') &&
      (parts.subgoals.length === 0 || unresolved || asArray(parts.publicResult?.gaps).length > 0)) {
    violations.push({ code: 'STATE_REDUCTION_MISMATCH', actual: observedState });
  }

  if (observedState === 'incomplete') {
    const gaps = asArray(parts.publicResult?.gaps);
    if (gaps.length === 0 || gaps.some(gap =>
      typeof gap?.question !== 'string' || !gap.question.trim() ||
      typeof gap?.reason !== 'string' || !gap.reason.trim())) {
      violations.push({ code: 'LIVE_EXPLICIT_GAP_MISSING' });
    }
  }

  for (const forbidden of asArray(oracle.forbiddenClaims)) {
    if (liveForbiddenClaimPresent(parts, forbidden)) {
      violations.push({ code: 'FORBIDDEN_CLAIM_PRESENT', claimId: forbidden.id });
    }
  }

  for (const evidence of publicEvidence) {
    if (!publicEvidenceInBoundary(evidence, claimScope)) {
      violations.push({ code: 'PARENT_EVIDENCE_OUT_OF_BOUNDARY' });
    }
    if (!publicEvidenceIsGrounded(evidence, parts)) {
      violations.push({ code: 'PARENT_EVIDENCE_UNGROUNDED' });
    }
  }

  const dispositions = liveAnchorDispositions(
    expectedGoals,
    anchorsById,
    publicEvidence,
    parts,
  );
  const allowedParentStatements = new Set([
    ...dispositions.flatMap(item => item.claimTexts),
    ...liveSupplementalClaimTexts(expectedGoals, anchorsById, parts),
  ]);
  for (const statement of publicStatements(parts.publicResult)) {
    if (!allowedParentStatements.has(statement)) {
      violations.push({ code: 'LIVE_UNSUPPORTED_PARENT_CLAIM' });
    }
  }
  if (observedState === 'complete' || observedState === 'verify_targets') {
    if (typeof parts.publicResult?.directAnswer !== 'string' ||
        !parts.publicResult.directAnswer.trim()) {
      violations.push({ code: 'LIVE_DIRECT_ANSWER_MISSING' });
    }
    for (const disposition of dispositions.filter(item =>
      item.disposition !== 'anchor_supported')) {
      violations.push({
        code: 'LIVE_REQUIRED_GOAL_UNSUPPORTED',
        goalId: disposition.goalId,
      });
    }
  } else if (observedState === 'incomplete') {
    if (!dispositions.some(item => item.disposition === 'explicit_gap')) {
      violations.push({ code: 'LIVE_REQUIRED_GOAL_GAP_MISSING' });
    }
    for (const disposition of dispositions.filter(item =>
      !['anchor_supported', 'explicit_gap'].includes(item.disposition))) {
      violations.push({
        code: disposition.disposition === 'missing'
          ? 'LIVE_REQUIRED_GOAL_MISSING'
          : 'LIVE_REQUIRED_GOAL_UNRESOLVED',
        goalId: disposition.goalId,
      });
    }
  }

  return {
    id: caseDefinition.id,
    passed: violations.length === 0,
    observedState,
    evaluationProfile: profile,
    repeatabilitySignature: JSON.stringify({
      state: observedState,
      dispositions: dispositions.map(({ goalId, disposition }) => ({ goalId, disposition })),
    }),
    violations,
  };
}

/**
 * Evaluate one direct-runtime trust artifact against an independently authored
 * case oracle. Model confidence, self-scores, and grounding labels are never
 * acceptance inputs.
 */
export function evaluateTrustCase(caseDefinition, artifact, options = {}) {
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

  const evaluationProfile = liveEvaluationProfile(caseDefinition, options);
  if (!evaluationProfile) {
    return invalidEvaluationProfile(caseDefinition, options?.mode ?? 'fixture', options?.profile);
  }
  if (evaluationProfile.mode === 'live') {
    return evaluateLiveTrustCase(caseDefinition, artifact, evaluationProfile.profile);
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

  if (oracle.expectedFailure) {
    const actualFailure = parts.result?.failure ?? parts.publicResult?.failure ?? null;
    if (actualFailure?.category !== oracle.expectedFailure.category ||
        actualFailure?.reason !== oracle.expectedFailure.reason) {
      violations.push({
        code: 'EXPECTED_FAILURE_MISMATCH',
        expected: oracle.expectedFailure,
        actual: actualFailure ? {
          category: actualFailure.category ?? null,
          reason: actualFailure.reason ?? null,
        } : null,
      });
    }
  }

  const actualSafetyLimits = asArray(parts.result?.stats?.safetyLimits);
  for (const expectedLimit of asArray(oracle.expectedSafetyLimits)) {
    if (!actualSafetyLimits.some(actual =>
      actual?.name === expectedLimit.name &&
      actual?.stage === expectedLimit.stage &&
      actual?.truncated === expectedLimit.truncated)) {
      violations.push({
        code: 'EXPECTED_SAFETY_LIMIT_MISSING',
        expected: expectedLimit,
      });
    }
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
      if (anchor && !publicEvidence.some(item => publicEvidenceSupportsAnchor(item, anchor))) {
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
    evaluationProfile: evaluationProfile.profile,
    repeatabilitySignature,
    violations,
  };
}

/** Evaluate repeated runs while deliberately ignoring optional evidence choice. */
export function evaluateTrustRepeatability(caseDefinition, artifacts, options = {}) {
  const runs = asArray(artifacts)
    .map(artifact => evaluateTrustCase(caseDefinition, artifact, options));
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
