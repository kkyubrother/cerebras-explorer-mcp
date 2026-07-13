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

function getStats(result) {
  // spec 017: MCP structuredContent no longer exposes _debug.stats. Raw runtime
  // results still carry result.stats for benchmark/transcript use.
  return result?.stats ?? {};
}

function getCitations(result) {
  return Array.isArray(result?.citations) ? result.citations : [];
}

function countCitationFiles(result) {
  return new Set(
    getCitations(result)
      .map(item => item?.path)
      .filter(Boolean),
  ).size;
}

function hasCitationGapWarning(result) {
  const warnings = result?.critic?.warnings;
  return Array.isArray(warnings) && warnings.some(warning => warning?.type === 'citation_gap');
}

function hasCriticWarningType(result, type) {
  const warnings = result?.critic?.warnings;
  return Array.isArray(warnings) && warnings.some(warning => warning?.type === type);
}

function toolResultsWereTruncated(result) {
  const coverageCount = Number(result?.searchCoverage?.toolResultsTruncated ?? 0);
  const statsCount = Number(getStats(result).toolResultsTruncated ?? 0);
  return coverageCount > 0 || statsCount > 0;
}

function getSourceText(result, source) {
  switch (source) {
    case 'direct_answer':
      return result.directAnswer ?? '';
    case 'combined_text':
      return joinLines([
        result.directAnswer,
        result.status?.verification,
        result.nextAction?.reason,
        result.nextAction?.query,
        ...(result.targets ?? []).map(item => item.reason),
        ...(result.evidence ?? []).map(item => item.why),
        ...(result.uncertainties ?? []),
      ]);
    case 'evidence_paths':
      return joinLines((result.evidence ?? []).map(item => item.path));
    case 'evidence_why':
      return joinLines((result.evidence ?? []).map(item => item.why));
    case 'target_paths':
      return joinLines((result.targets ?? []).map(item => item.path));
    case 'target_reasons':
      return joinLines((result.targets ?? []).map(item => item.reason));
    case 'evidence_snippets':
      return joinLines((result.evidence ?? []).map(item => item.snippet));
    case 'followup_descriptions':
      return joinLines([result.nextAction?.reason, result.nextAction?.query]);
    case 'status_verification':
      return result.status?.verification ?? '';
    case 'next_action':
      return joinLines([result.nextAction?.type, result.nextAction?.reason, result.nextAction?.query]);
    case 'confidence':
      return result.status?.confidence ?? '';
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

function countGroundedEvidence(result) {
  return (result.evidence ?? []).filter(item =>
    item.groundingStatus === 'exact' || item.groundingStatus === 'partial'
  ).length;
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
    case 'min_grounded_evidence_count':
      actual = countGroundedEvidence(result);
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
    case 'min_citation_count':
      actual = getCitations(result).length;
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'min_citation_file_count':
      actual = countCitationFiles(result);
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'tool_results_truncated_equals':
      actual = toolResultsWereTruncated(result);
      passed = actual === Boolean(check.value);
      break;
    case 'citation_gap_warning_equals':
      actual = hasCitationGapWarning(result);
      passed = actual === Boolean(check.value);
      break;
    case 'critic_warning_absent':
      expected = check.warningType;
      actual = !hasCriticWarningType(result, check.warningType);
      passed = actual;
      break;
    case 'has_direct_answer':
      actual = typeof result.directAnswer === 'string' && result.directAnswer.trim().length > 0;
      passed = actual === Boolean(check.value);
      break;
    case 'status_verification_equals':
      actual = result.status?.verification ?? null;
      passed = actual === check.value;
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
