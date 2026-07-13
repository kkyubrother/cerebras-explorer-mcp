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
