export const EXPLORE_REPO_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: {
      type: 'string',
      description:
        'Natural-language exploration request from the parent model. Example: "Trace how auth middleware is applied to API routes".',
    },
    repo_root: {
      type: 'string',
      description:
        'Optional repository root. Defaults to the current working directory of the MCP server process.',
    },
    scope: {
      type: 'array',
      description:
        'Optional list of path prefixes or glob-like patterns to constrain exploration. Example: ["src/api/**", "docs/auth/**"].',
      items: { type: 'string' },
    },
    budget: {
      type: 'string',
      enum: ['quick', 'normal', 'deep'],
      description:
        'Exploration depth. quick minimizes cost, normal is default, deep allows longer autonomous search.',
    },
    hints: {
      type: 'object',
      additionalProperties: false,
      description:
        'Optional starting hints from the parent model. These help the explorer narrow the search earlier.',
      properties: {
        symbols: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' } },
        regex: { type: 'array', items: { type: 'string' } },
        strategy: {
          type: 'string',
          enum: ['symbol-first', 'reference-chase', 'git-guided', 'breadth-first', 'blame-guided', 'pattern-scan'],
          description:
            'Exploration strategy hint. If omitted, the strategy is auto-detected from the task text.',
        },
      },
    },
    session: {
      type: 'string',
      description:
        'Optional session ID returned by a previous explore_repo call. When provided, the explorer carries over discovered file paths and prior summaries to accelerate follow-up exploration.',
    },
    language: {
      type: 'string',
      description:
        'Optional BCP-47 language tag (e.g. "ko", "en", "ja") for the response language. When omitted, the explorer infers the language from the task text.',
    },
  },
  required: ['task'],
};

// Schema for structured followup items — used in AI model output
const FOLLOWUP_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string' },
    priority: { type: 'string', enum: ['recommended', 'optional'] },
    suggestedCall: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task: { type: 'string' },
        scope: { type: 'array', items: { type: 'string' } },
        budget: { type: 'string', enum: ['quick', 'normal', 'deep'] },
        hints: {
          type: 'object',
          additionalProperties: false,
          properties: {
            symbols: { type: 'array', items: { type: 'string' } },
            strategy: { type: 'string' },
          },
          required: ['symbols', 'strategy'],
        },
      },
      required: ['task', 'scope', 'budget', 'hints'],
    },
  },
  required: ['description', 'priority', 'suggestedCall'],
};

export const EXPLORE_RESULT_JSON_SCHEMA = {
  name: 'explore_repo_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      answer: {
        type: 'string',
        description: 'Direct answer to the delegated exploration task.',
      },
      summary: {
        type: 'string',
        description: 'A short synthesis of the important findings.',
      },
      confidence: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            startLine: { type: 'integer' },
            endLine: { type: 'integer' },
            why: { type: 'string' },
          },
          required: ['path', 'startLine', 'endLine', 'why'],
        },
      },
      candidatePaths: {
        type: 'array',
        items: { type: 'string' },
      },
      followups: {
        type: 'array',
        items: FOLLOWUP_ITEM_SCHEMA,
      },
    },
    required: [
      'answer',
      'summary',
      'confidence',
      'evidence',
      'candidatePaths',
      'followups',
    ],
  },
};

export function validateExploreRepoArgs(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('Arguments must be an object.');
  }
  if (typeof args.task !== 'string' || !args.task.trim()) {
    throw new Error('task is required and must be a non-empty string.');
  }
  if (
    args.scope !== undefined &&
    (!Array.isArray(args.scope) || args.scope.some(item => typeof item !== 'string'))
  ) {
    throw new Error('scope must be an array of strings when provided.');
  }
  if (
    args.budget !== undefined &&
    !['quick', 'normal', 'deep'].includes(args.budget)
  ) {
    throw new Error('budget must be one of quick, normal, or deep.');
  }
  if (args.repo_root !== undefined && typeof args.repo_root !== 'string') {
    throw new Error('repo_root must be a string when provided.');
  }
  if (args.session !== undefined && (typeof args.session !== 'string' || !args.session.trim())) {
    throw new Error('session must be a non-empty string when provided.');
  }
  if (args.language !== undefined && (typeof args.language !== 'string' || !args.language.trim())) {
    throw new Error('language must be a non-empty string when provided.');
  }
  if (args.hints !== undefined) {
    if (!args.hints || typeof args.hints !== 'object' || Array.isArray(args.hints)) {
      throw new Error('hints must be an object when provided.');
    }
    for (const key of ['symbols', 'files', 'regex']) {
      const value = args.hints[key];
      if (value !== undefined) {
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
          throw new Error(`hints.${key} must be an array of strings when provided.`);
        }
      }
    }
    const validStrategies = ['symbol-first', 'reference-chase', 'git-guided', 'breadth-first', 'blame-guided', 'pattern-scan'];
    if (args.hints.strategy !== undefined && !validStrategies.includes(args.hints.strategy)) {
      throw new Error(`hints.strategy must be one of: ${validStrategies.join(', ')}.`);
    }
  }
}

/**
 * Compute a continuous confidence score (0.0–1.0) and breakdown factors
 * based on evidence grounding and exploration stats.
 *
 * @param {object[]} groundedEvidence - evidence items after grounding filter
 * @param {number} totalEvidenceBefore - count before grounding filter
 * @param {object} stats - runtime stats (stoppedByBudget, grepCalls, etc.)
 * @returns {{ score: number, level: string, factors: object }}
 */
export function computeConfidenceScore(groundedEvidence, totalEvidenceBefore, stats) {
  let score = 0.5;
  const factors = {
    evidenceCount: groundedEvidence.length,
    evidenceGrounded: groundedEvidence.length,
    evidenceDropped: totalEvidenceBefore - groundedEvidence.length,
    crossVerified: false,
    symbolSearchUsed: (stats.grepCalls ?? 0) > 0,
    stoppedByBudget: stats.stoppedByBudget ?? false,
    adjustments: [],
  };

  // All evidence grounded (none dropped)
  if (factors.evidenceDropped === 0 && groundedEvidence.length > 0) {
    score += 0.2;
    factors.adjustments.push('+0.20 (all evidence grounded)');
  } else if (factors.evidenceDropped > 0) {
    score -= 0.3;
    factors.adjustments.push('-0.30 (some evidence not grounded in inspected ranges)');
  }

  // Cross-verified: evidence from 2+ distinct files
  const uniqueFiles = new Set(groundedEvidence.map(e => e.path));
  factors.crossVerified = uniqueFiles.size >= 2;
  if (factors.crossVerified) {
    score += 0.15;
    factors.adjustments.push('+0.15 (cross-verified across multiple files)');
  }

  // Symbol/grep search was used
  if (factors.symbolSearchUsed) {
    score += 0.05;
    factors.adjustments.push('+0.05 (symbol search used)');
  }

  // Stopped by budget
  if (factors.stoppedByBudget) {
    score -= 0.2;
    factors.adjustments.push('-0.20 (stopped by budget before completion)');
  }

  // Only a single evidence item
  if (groundedEvidence.length === 1) {
    score -= 0.1;
    factors.adjustments.push('-0.10 (single evidence point)');
  }

  // No evidence at all
  if (groundedEvidence.length === 0) {
    score = 0.1;
    factors.adjustments = ['score=0.10 (no grounded evidence)'];
  }

  score = Math.max(0, Math.min(1, score));

  let level;
  if (score >= 0.7) {
    level = 'high';
  } else if (score >= 0.4) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return {
    score: Math.round(score * 100) / 100,
    level,
    factors,
  };
}

/**
 * Normalize a structured followup item from the AI model output.
 * Accepts both legacy string format and new structured object format.
 */
function normalizeFollowupItem(item) {
  if (typeof item === 'string') {
    // Legacy string followup — wrap in minimal structured format
    return {
      description: item,
      priority: 'optional',
      suggestedCall: null,
    };
  }
  if (!item || typeof item !== 'object') {
    return null;
  }
  const description = typeof item.description === 'string' ? item.description : '';
  if (!description) {
    return null;
  }
  const priority = item.priority === 'recommended' ? 'recommended' : 'optional';
  let suggestedCall = null;
  if (item.suggestedCall && typeof item.suggestedCall === 'object') {
    suggestedCall = {
      task: typeof item.suggestedCall.task === 'string' ? item.suggestedCall.task : description,
      scope: Array.isArray(item.suggestedCall.scope) ? item.suggestedCall.scope.filter(s => typeof s === 'string') : [],
      budget: ['quick', 'normal', 'deep'].includes(item.suggestedCall.budget) ? item.suggestedCall.budget : 'normal',
      hints: {
        symbols: Array.isArray(item.suggestedCall.hints?.symbols) ? item.suggestedCall.hints.symbols.filter(s => typeof s === 'string') : [],
        strategy: typeof item.suggestedCall.hints?.strategy === 'string' ? item.suggestedCall.hints.strategy : null,
      },
    };
  }
  return { description, priority, suggestedCall };
}

export function normalizeExploreResult(raw, stats) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  return {
    answer: typeof safe.answer === 'string' ? safe.answer : '',
    summary: typeof safe.summary === 'string' ? safe.summary : '',
    confidence:
      safe.confidence === 'low' || safe.confidence === 'medium' || safe.confidence === 'high'
        ? safe.confidence
        : 'low',
    evidence: Array.isArray(safe.evidence)
      ? safe.evidence
          .filter(item => item && typeof item === 'object')
          .map(item => ({
            path: typeof item.path === 'string' ? item.path : '',
            startLine: Number.isInteger(item.startLine) ? item.startLine : 1,
            endLine: Number.isInteger(item.endLine) ? item.endLine : 1,
            why: typeof item.why === 'string' ? item.why : '',
          }))
          .filter(item => item.path && item.why)
      : [],
    candidatePaths: Array.isArray(safe.candidatePaths)
      ? safe.candidatePaths.filter(item => typeof item === 'string')
      : [],
    followups: Array.isArray(safe.followups)
      ? safe.followups.map(normalizeFollowupItem).filter(Boolean)
      : [],
    stats,
  };
}
