export const EXPLORE_REPO_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: {
      type: 'string',
      description:
        'Natural-language exploration request. Be specific for best results: ' +
        '"How does the auth middleware validate JWT tokens and where is it applied?" ' +
        'is better than "explain auth".',
    },
    repo_root: {
      type: 'string',
      description:
        'Repository root path. Defaults to the current working directory of the MCP server process.',
    },
    scope: {
      type: 'array',
      description:
        'Path prefixes or glob patterns to focus exploration. Example: ["src/api/**", "lib/auth/"]. Omit to search the entire repo.',
      items: { type: 'string' },
    },
    budget: {
      type: 'string',
      enum: ['quick', 'normal', 'deep'],
      description:
        'Exploration depth. "quick": fast lookup (3-10 turns), "normal": multi-file analysis (up to 20 turns, default), "deep": comprehensive investigation (up to 30 turns).',
    },
    hints: {
      type: 'object',
      additionalProperties: false,
      description:
        'Starting hints to accelerate exploration. Provide known symbols, file paths, or regex patterns so the explorer skips broad scanning.',
      properties: {
        symbols: { type: 'array', items: { type: 'string' }, description: 'Known symbol names to start with (e.g. ["handleAuth", "JwtValidator"]).' },
        files: { type: 'array', items: { type: 'string' }, description: 'Known file paths to examine first (e.g. ["src/middleware/auth.ts"]).' },
        regex: { type: 'array', items: { type: 'string' }, description: 'Regex patterns to search for (e.g. ["TODO.*security", "deprecated"]).' },
        strategy: {
          type: 'string',
          enum: ['symbol-first', 'reference-chase', 'git-guided', 'breadth-first', 'blame-guided', 'pattern-scan'],
          description:
            'Exploration strategy. symbol-first: find definitions. reference-chase: find callers/usages. ' +
            'git-guided: analyze recent changes. breadth-first: understand project structure. ' +
            'blame-guided: trace bug origins. pattern-scan: find similar code patterns. Auto-detected if omitted.',
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
            // Evidence kind — determines grounding strategy
            evidenceType: {
              type: 'string',
              enum: ['file_range', 'git_commit', 'git_blame', 'git_diff_hunk'],
            },
            sha: { type: 'string' },          // git_commit / git_blame / git_diff_hunk
            author: { type: 'string' },        // git_blame
            commit: { type: 'string' },        // alias for sha (git_commit)
            oldPath: { type: 'string' },       // git_diff_hunk (rename)
            newPath: { type: 'string' },       // git_diff_hunk (rename)
            newStartLine: { type: 'integer' }, // git_diff_hunk
            newEndLine: { type: 'integer' },   // git_diff_hunk
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

export { computeConfidenceScore, reconcileConfidence } from './critic.mjs';

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
          .map(item => {
            // Determine evidence kind — default to file_range for legacy items
            const EVIDENCE_TYPES = ['file_range', 'git_commit', 'git_blame', 'git_diff_hunk'];
            const kind = typeof item.evidenceType === 'string' && EVIDENCE_TYPES.includes(item.evidenceType)
              ? item.evidenceType
              : 'file_range';

            const base = {
              path: typeof item.path === 'string' ? item.path : '',
              startLine: Number.isInteger(item.startLine) ? item.startLine : 1,
              endLine: Number.isInteger(item.endLine) ? item.endLine : 1,
              why: typeof item.why === 'string' ? item.why : '',
              evidenceType: kind,
            };

            // Kind-specific optional fields
            if (kind === 'git_commit') {
              const sha = typeof item.sha === 'string' ? item.sha : (typeof item.commit === 'string' ? item.commit : '');
              if (sha) base.sha = sha;
              if (typeof item.author === 'string' && item.author) base.author = item.author;
            } else if (kind === 'git_blame') {
              if (typeof item.sha === 'string' && item.sha) base.sha = item.sha;
              if (typeof item.author === 'string' && item.author) base.author = item.author;
            } else if (kind === 'git_diff_hunk') {
              const sha = typeof item.sha === 'string' ? item.sha : (typeof item.commit === 'string' ? item.commit : '');
              if (sha) base.sha = sha;
              if (typeof item.oldPath === 'string' && item.oldPath) base.oldPath = item.oldPath;
              if (typeof item.newPath === 'string' && item.newPath) base.newPath = item.newPath;
              if (Number.isInteger(item.newStartLine)) base.newStartLine = item.newStartLine;
              if (Number.isInteger(item.newEndLine)) base.newEndLine = item.newEndLine;
            }
            // file_range: no extra fields needed beyond base
            return base;
          })
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
