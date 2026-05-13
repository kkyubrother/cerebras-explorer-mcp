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
        'Advanced only. Omit for normal agent use; the server chooses the default exploration depth. Use only when a workflow explicitly needs quick, normal, or deep.',
    },
    hints: {
      type: 'object',
      additionalProperties: false,
      description:
        'Starting hints to accelerate exploration. Provide known symbols, file paths, or regex patterns so the explorer skips broad scanning.',
      properties: {
        symbols: { type: 'array', items: { type: 'string' }, description: 'Known symbol names to start with (e.g. ["handleAuth", "JwtValidator"]).' },
        files: { type: 'array', items: { type: 'string' }, description: 'Known file paths to examine first (e.g. ["src/middleware/auth.ts"]).' },
        regex: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Advanced only. Prefer wrapper knownText for literal anchors; use regex only when the caller already knows an exact pattern.',
        },
        strategy: {
          type: 'string',
          enum: ['symbol-first', 'reference-chase', 'git-guided', 'breadth-first', 'blame-guided', 'pattern-scan'],
          description:
            'Advanced only. Omit for normal agent use; strategy is auto-detected from the task and known anchors.',
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
        'Advanced/optional. Omit for normal agent use; the explorer infers response language from the task text. Use only when a workflow must force a BCP-47 language tag such as "ko", "en", or "ja".',
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
    query: { type: 'string' },
  },
  required: ['description', 'priority'],
};

const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    verification: {
      type: 'string',
      enum: ['verified', 'targeted_read_needed', 'follow_up_needed', 'broad_search_needed'],
    },
    complete: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['confidence', 'verification', 'complete', 'warnings'],
};

const TARGET_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    startLine: { type: 'integer' },
    endLine: { type: 'integer' },
    role: { type: 'string', enum: ['edit', 'read', 'test', 'config', 'context', 'reference'] },
    reason: { type: 'string' },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
  },
  required: ['path', 'role', 'reason', 'evidenceRefs'],
};

const NEXT_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['stop', 'read_target', 'explore_followup', 'ask_user'] },
    reason: { type: 'string' },
    query: { type: 'string' },
    target: TARGET_ITEM_SCHEMA,
  },
  required: ['type', 'reason'],
};

const EVIDENCE_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    path: { type: 'string' },
    startLine: { type: 'integer' },
    endLine: { type: 'integer' },
    why: { type: 'string' },
    snippet: { type: 'string' },
    redacted: { type: 'boolean' },
    redactions: { type: 'array', items: { type: 'string' } },
    groundingStatus: { type: 'string', enum: ['exact', 'partial'] },
    evidenceType: {
      type: 'string',
      enum: ['file_range', 'git_commit', 'git_blame', 'git_diff_hunk'],
    },
    sha: { type: 'string' },
    author: { type: 'string' },
    commit: { type: 'string' },
    oldPath: { type: 'string' },
    newPath: { type: 'string' },
    newStartLine: { type: 'integer' },
    newEndLine: { type: 'integer' },
  },
  required: ['path', 'startLine', 'endLine', 'why'],
};

export const EXPLORE_REPO_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
  ],
  properties: {
    directAnswer: { type: 'string' },
    status: STATUS_SCHEMA,
    targets: { type: 'array', items: TARGET_ITEM_SCHEMA },
    evidence: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
    uncertainties: { type: 'array', items: { type: 'string' } },
    nextAction: NEXT_ACTION_SCHEMA,
    sessionId: { type: 'string' },
    _debug: { type: 'object', additionalProperties: true },
  },
};

export const EXPLORE_RESULT_JSON_SCHEMA = {
  name: 'explore_repo_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      directAnswer: {
        type: 'string',
        description: 'Short direct answer. Optional for the model; the runtime aliases answer when omitted.',
      },
      status: STATUS_SCHEMA,
      targets: {
        type: 'array',
        items: TARGET_ITEM_SCHEMA,
      },
      nextAction: NEXT_ACTION_SCHEMA,
      uncertainties: {
        type: 'array',
        items: { type: 'string' },
      },
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
        items: EVIDENCE_ITEM_SCHEMA,
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
      'confidence',
      'evidence',
      'candidatePaths',
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
 */
function normalizeFollowupItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const description = typeof item.description === 'string' ? item.description : '';
  if (!description) {
    return null;
  }
  const priority = item.priority === 'recommended' ? 'recommended' : 'optional';
  const query = typeof item.query === 'string' && item.query.trim() ? item.query.trim() : null;
  return {
    description,
    priority,
    ...(query ? { query } : {}),
  };
}

function normalizeCandidatePath(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && typeof item.path === 'string') return item.path;
  return null;
}

function normalizeTargetItem(item) {
  if (!item || typeof item !== 'object' || typeof item.path !== 'string' || !item.path) {
    return null;
  }
  const role = ['edit', 'read', 'test', 'config', 'context', 'reference'].includes(item.role) ? item.role : 'read';
  const target = {
    path: item.path,
    role,
    reason: typeof item.reason === 'string' ? item.reason : '',
    evidenceRefs: Array.isArray(item.evidenceRefs)
      ? item.evidenceRefs.filter(ref => typeof ref === 'string')
      : [],
  };
  if (Number.isInteger(item.startLine)) target.startLine = item.startLine;
  if (Number.isInteger(item.endLine)) target.endLine = item.endLine;
  return target;
}

function normalizeStatus(status, confidence) {
  if (!status || typeof status !== 'object') {
    return {
      confidence,
      verification: 'broad_search_needed',
      complete: false,
      warnings: [],
    };
  }
  const verification = ['verified', 'targeted_read_needed', 'follow_up_needed', 'broad_search_needed'].includes(status.verification)
    ? status.verification
    : 'broad_search_needed';
  return {
    confidence: ['low', 'medium', 'high'].includes(status.confidence) ? status.confidence : confidence,
    verification,
    complete: Boolean(status.complete),
    warnings: Array.isArray(status.warnings) ? status.warnings.filter(item => typeof item === 'string') : [],
  };
}

export function normalizeExploreResult(raw, stats) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const confidence =
    safe.confidence === 'low' || safe.confidence === 'medium' || safe.confidence === 'high'
      ? safe.confidence
      : 'low';
  const answer = typeof safe.answer === 'string' ? safe.answer : '';
  return {
    directAnswer: typeof safe.directAnswer === 'string' ? safe.directAnswer : answer,
    answer,
    summary: typeof safe.summary === 'string' ? safe.summary : '',
    confidence,
    status: normalizeStatus(safe.status, confidence),
    targets: Array.isArray(safe.targets)
      ? safe.targets.map(normalizeTargetItem).filter(Boolean)
      : [],
    nextAction: safe.nextAction && typeof safe.nextAction === 'object'
      ? {
          type: ['stop', 'read_target', 'explore_followup', 'ask_user'].includes(safe.nextAction.type)
            ? safe.nextAction.type
            : 'stop',
          reason: typeof safe.nextAction.reason === 'string' ? safe.nextAction.reason : '',
          ...(typeof safe.nextAction.query === 'string' ? { query: safe.nextAction.query } : {}),
          ...(safe.nextAction.target ? { target: normalizeTargetItem(safe.nextAction.target) } : {}),
        }
      : { type: 'stop', reason: '' },
    uncertainties: Array.isArray(safe.uncertainties)
      ? safe.uncertainties.filter(item => typeof item === 'string')
      : [],
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
              ...(typeof item.id === 'string' && item.id ? { id: item.id } : {}),
              path: typeof item.path === 'string' ? item.path : '',
              startLine: Number.isInteger(item.startLine) ? item.startLine : 1,
              endLine: Number.isInteger(item.endLine) ? item.endLine : 1,
              why: typeof item.why === 'string' ? item.why : '',
              evidenceType: kind,
            };
            if (item.groundingStatus === 'exact' || item.groundingStatus === 'partial') {
              base.groundingStatus = item.groundingStatus;
            }

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
      ? safe.candidatePaths.map(normalizeCandidatePath).filter(Boolean)
      : [],
    followups: Array.isArray(safe.followups)
      ? safe.followups.map(normalizeFollowupItem).filter(Boolean)
      : [],
    ...(typeof safe.sessionId === 'string' && safe.sessionId ? { sessionId: safe.sessionId } : {}),
    ...(typeof stats?.sessionId === 'string' && stats.sessionId ? { sessionId: stats.sessionId } : {}),
    stats,
    _debug: safe._debug && typeof safe._debug === 'object' ? safe._debug : {},
  };
}
