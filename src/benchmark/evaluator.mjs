function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function joinLines(values) {
  return values.filter(Boolean).join('\n');
}

function getLegacy(result) {
  return result?._debug?.legacy ?? {};
}

function getStats(result) {
  return result?._debug?.stats ?? result?.stats ?? {};
}

function getRecentActivity(result) {
  return result?.recentActivity ?? result?._debug?.legacy?.recentActivity ?? result?._debug?.recentActivity ?? null;
}

function getCandidatePaths(result) {
  return result?.candidatePaths ?? getLegacy(result).candidatePaths ?? [];
}

function getFollowups(result) {
  return result?.followups ?? getLegacy(result).followups ?? [];
}

function getSourceText(result, source) {
  const legacy = getLegacy(result);
  const recentActivity = getRecentActivity(result);
  switch (source) {
    case 'direct_answer':
      return result.directAnswer ?? result.answer ?? legacy.answer ?? '';
    case 'answer':
      return result.answer ?? legacy.answer ?? result.directAnswer ?? '';
    case 'summary':
      return result.summary ?? legacy.summary ?? '';
    case 'combined_text':
      return joinLines([
        result.directAnswer,
        result.status?.verification,
        result.nextAction?.reason,
        ...(result.targets ?? []).map(item => item.reason),
        ...(result.evidence ?? []).map(item => item.why),
        result.answer,
        result.summary,
        legacy.answer,
        legacy.summary,
        ...getFollowups(result).map(item => item.description),
      ]);
    case 'evidence_paths':
      return joinLines((result.evidence ?? []).map(item => item.path));
    case 'evidence_why':
      return joinLines((result.evidence ?? []).map(item => item.why));
    case 'candidate_paths':
      return joinLines(getCandidatePaths(result));
    case 'target_paths':
      return joinLines((result.targets ?? []).map(item => item.path));
    case 'target_reasons':
      return joinLines((result.targets ?? []).map(item => item.reason));
    case 'evidence_snippets':
      return joinLines((result.evidence ?? []).map(item => item.snippet));
    case 'followup_descriptions':
      return joinLines(getFollowups(result).map(item => item.description));
    case 'status_verification':
      return result.status?.verification ?? '';
    case 'next_action':
      return joinLines([result.nextAction?.type, result.nextAction?.reason, result.nextAction?.query]);
    case 'recent_commit_messages':
      return joinLines((recentActivity?.recentCommits ?? []).map(item => item.message));
    case 'hot_files':
      return joinLines(recentActivity?.hotFiles ?? []);
    case 'confidence':
      return result.status?.confidence ?? result.confidence ?? legacy.confidence ?? '';
    case 'confidence_level':
      return result.status?.confidence ?? result.confidenceLevel ?? legacy.confidenceLevel ?? result.confidence ?? legacy.confidence ?? '';
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
  switch (check.type) {
    case 'min_evidence_count':
      actual = (result.evidence ?? []).length;
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'min_grounded_evidence_count':
      actual = countGroundedEvidence(result);
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'min_candidate_path_count':
      actual = getCandidatePaths(result).length;
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
    case 'status_verification_equals':
      actual = result.status?.verification ?? null;
      passed = actual === check.value;
      break;
    case 'has_recent_activity':
      actual = Boolean(getRecentActivity(result));
      passed = actual === Boolean(check.value);
      break;
    case 'stopped_by_budget_equals':
      actual = Boolean(getStats(result).stoppedByBudget);
      passed = actual === Boolean(check.value);
      break;
    case 'has_session_id':
      {
        const sessionId = result.sessionId ?? getStats(result).sessionId;
        actual = typeof sessionId === 'string' && sessionId.startsWith('sess_');
      }
      passed = actual === Boolean(check.value);
      break;
    default:
      throw new Error(`Unknown benchmark check type: ${check.type}`);
  }

  return {
    label: check.label,
    type: check.type,
    expected: check.value,
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
