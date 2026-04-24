const EVIDENCE_LINE_TOLERANCE = 2;

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
 * for that file. Source-aware: grep-only observations can only produce partial
 * grounding for wide evidence ranges; read/symbol_context_definition produce exact.
 */
export function checkEvidenceGrounding(observedRanges, evidenceItem) {
  const ranges = observedRanges.get(evidenceItem.path);
  if (!ranges || ranges.length === 0) {
    return { overlaps: false, partial: false };
  }

  const evidenceStart = evidenceItem.startLine;
  const evidenceEnd = evidenceItem.endLine;
  const evidenceLength = evidenceEnd - evidenceStart + 1;
  let bestResult = { overlaps: false, partial: false };

  for (const range of ranges) {
    const rangeStart = range.startLine;
    const rangeEnd = range.endLine;
    const source = range.source ?? 'read';

    const overlaps = evidenceStart <= rangeEnd && evidenceEnd >= rangeStart;
    if (!overlaps) {
      const distance = Math.max(rangeStart - evidenceEnd, evidenceStart - rangeEnd, 0);
      if (distance <= EVIDENCE_LINE_TOLERANCE && evidenceLength <= 10) {
        bestResult = { overlaps: true, partial: true };
      }
      continue;
    }

    let isExact;
    if (source === 'read') {
      isExact = evidenceStart >= rangeStart && evidenceEnd <= rangeEnd;
    } else if (source === 'symbol_context_definition') {
      isExact = true;
    } else if (source === 'grep') {
      isExact = evidenceLength <= 3;
    } else if (source === 'diff_hunk') {
      isExact = evidenceStart >= rangeStart && evidenceEnd <= rangeEnd;
    } else if (source === 'blame') {
      isExact = evidenceLength <= 3;
    } else {
      isExact = false;
    }

    if (isExact) {
      return { overlaps: true, partial: false };
    }
    bestResult = { overlaps: true, partial: true };
  }

  return bestResult;
}

export function groundEvidenceItem(item, { observedRanges, observedGit }) {
  const kind = item.evidenceType ?? 'file_range';

  if (kind === 'git_commit') {
    const sha = item.sha ?? item.commit ?? '';
    if (!sha) return null;
    const matched = observedGit.commits.has(sha) ||
      [...observedGit.commits].some(h => h.startsWith(sha) || sha.startsWith(h));
    return matched ? { ...item, groundingStatus: 'exact' } : null;
  }

  if (kind === 'git_blame') {
    const blameKey = `${item.path}:${item.startLine}:${item.sha ?? ''}`;
    const endKey = `${item.path}:${item.endLine}:${item.sha ?? ''}`;
    return observedGit.blame.has(blameKey) || observedGit.blame.has(endKey)
      ? { ...item, groundingStatus: 'exact' }
      : null;
  }

  if (kind === 'git_diff_hunk') {
    const { overlaps, partial } = checkEvidenceGrounding(observedRanges, item);
    if (!overlaps) {
      return item.sha ? { ...item, groundingStatus: 'partial' } : null;
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

    if (!item.path || !item.why) {
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
    evidenceCount: groundedEvidence.length,
    evidenceGrounded: groundedEvidence.length,
    evidenceDropped,
    exactCount,
    crossVerified: distinctFiles >= 2,
    symbolSearchUsed: usedSearch,
    stoppedByBudget: stats.stoppedByBudget ?? false,
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

  if (factors.stoppedByBudget) {
    score -= 0.10;
    factors.adjustments.push('-0.10 (stopped by budget before completion)');
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
export function reconcileConfidence({ modelConfidence, computedLevel, taskKind, exactEvidence, droppedEvidence, stoppedByBudget }) {
  if (droppedEvidence > 0 || stoppedByBudget) return computedLevel;
  if (taskKind === 'locate' && exactEvidence >= 1) return modelConfidence;
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
  const exactEvidence = evidence.filter(item => item.groundingStatus === 'exact').length;
  const finalConfidence = reconcileConfidence({
    modelConfidence,
    computedLevel: level,
    taskKind,
    exactEvidence,
    droppedEvidence,
    stoppedByBudget: stats.stoppedByBudget ?? false,
  });

  return {
    score,
    computedLevel: level,
    finalConfidence,
    factors,
    modelConfidence,
    downgraded: lowerLevel(modelConfidence, finalConfidence) === finalConfidence && modelConfidence !== finalConfidence,
  };
}

export function deriveTaskKindFromHints(hints = {}) {
  const strategy = hints?.strategy ?? null;
  return strategy === 'symbol-first' ? 'locate' : (strategy ?? 'default');
}

function pushWarning(warnings, warning) {
  warnings.push(warning);
}

export function buildCriticWarnings({
  grounding,
  confidence,
  stats,
  maxWarnings = 3,
}) {
  const warnings = [];

  if ((grounding.droppedMalformed ?? 0) > 0) {
    pushWarning(warnings, {
      type: 'dropped_evidence',
      severity: 'medium',
      message: `${grounding.droppedMalformed} evidence item(s) were removed because required fields were missing.`,
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

  if (confidence?.modelConfidence && confidence.modelConfidence !== confidence.finalConfidence) {
    pushWarning(warnings, {
      type: 'confidence_downgraded',
      severity: 'medium',
      message: `Model confidence was capped from ${confidence.modelConfidence} to ${confidence.finalConfidence}.`,
      action: 'Use the capped confidence value.',
    });
  }

  if (stats?.stoppedByBudget) {
    pushWarning(warnings, {
      type: 'budget_exhausted',
      severity: 'medium',
      message: 'Exploration stopped at the configured turn budget.',
      action: 'Treat broad conclusions as incomplete unless supported by exact evidence.',
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
    modelConfidence: normalized.confidence,
    droppedEvidence: grounding.droppedUngrounded + grounding.droppedMalformed,
  });

  confidence.factors.droppedUngrounded = grounding.droppedUngrounded;
  confidence.factors.droppedMalformed = grounding.droppedMalformed;

  const warnings = buildCriticWarnings({ grounding, confidence, stats, maxWarnings });

  return {
    result: {
      ...normalized,
      evidence: grounding.evidence,
      confidenceScore: confidence.score,
      confidenceLevel: confidence.finalConfidence,
      confidenceFactors: confidence.factors,
      confidence: confidence.finalConfidence,
      critic: {
        status: buildCriticStatus(warnings),
        warnings,
      },
    },
    grounding,
    confidence,
  };
}

export function extractReportCitations(report) {
  if (typeof report !== 'string' || !report.trim()) return [];
  const citations = [];
  const regex = /`?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+):L?(\d+)(?:-L?(\d+))?`?/g;
  let match;
  while ((match = regex.exec(report)) !== null) {
    citations.push({
      path: match[1].replace(/\\/g, '/').replace(/^\.\//, ''),
      startLine: Number(match[2]),
      endLine: Number(match[3] ?? match[2]),
      raw: match[0],
    });
  }
  return citations;
}

export function buildReportCritic({
  report,
  filesRead = [],
  stats = {},
  maxWarnings = 3,
}) {
  const warnings = [];
  const citations = extractReportCitations(report);
  const filesReadSet = new Set(filesRead.map(path => String(path).replace(/\\/g, '/').replace(/^\.\//, '')));

  if (typeof report !== 'string' || !report.trim()) {
    warnings.push({
      type: 'citation_gap',
      severity: 'high',
      message: 'The report is empty.',
      action: 'Treat this result as failed and rerun with a narrower task.',
    });
  } else if (filesRead.length > 0 && citations.length === 0) {
    warnings.push({
      type: 'citation_gap',
      severity: 'medium',
      message: 'The report does not include inline file citations.',
      action: 'Treat broad claims as unverified unless the parent agent checks the cited files separately.',
    });
  }

  const unknownCitation = citations.find(citation => !filesReadSet.has(citation.path));
  if (unknownCitation) {
    warnings.push({
      type: 'citation_gap',
      severity: 'medium',
      message: `The report cites ${unknownCitation.raw}, but that path was not recorded as read.`,
      target: unknownCitation.raw,
      action: 'Verify that citation before relying on the related claim.',
    });
  }

  if (stats?.stoppedByBudget) {
    warnings.push({
      type: 'budget_exhausted',
      severity: 'medium',
      message: 'Exploration stopped at the configured turn budget.',
      action: 'Treat broad conclusions as incomplete unless they have direct citations.',
    });
  }

  if (stats?.stoppedByErrors) {
    warnings.push({
      type: 'tool_errors',
      severity: 'high',
      message: 'Exploration stopped after repeated tool errors.',
      action: 'Treat the report as partial and consider a narrower follow-up task.',
    });
  }

  if ((stats?.toolResultsTruncated ?? 0) > 0) {
    warnings.push({
      type: 'truncated_tool_results',
      severity: 'low',
      message: `${stats.toolResultsTruncated} tool result(s) were truncated before final synthesis.`,
      action: 'Treat detailed claims about truncated files as weaker than directly cited ranges.',
    });
  }

  if ((stats?.outputRecoveries ?? 0) > 0) {
    warnings.push({
      type: 'output_recovery',
      severity: 'low',
      message: `${stats.outputRecoveries} output recovery attempt(s) were needed after length truncation.`,
      action: 'Check the report ending for repeated or incomplete text.',
    });
  }

  const limitedWarnings = warnings
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, maxWarnings);

  return {
    status: buildCriticStatus(limitedWarnings),
    warnings: limitedWarnings,
  };
}
