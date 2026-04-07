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
      },
    },
  },
  required: ['task'],
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
        items: { type: 'string' },
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
  }
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
      ? safe.followups.filter(item => typeof item === 'string')
      : [],
    stats,
  };
}
