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

// Wrapper tools pass trusted internal taskMode directly to ExplorerRuntime.
// It is intentionally absent from this public schema; direct explore_repo
// input rejects unknown fields via additionalProperties: false.

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

const DISCOVERED_PATH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    kind: { type: 'string', enum: ['file', 'dir', 'unknown'] },
    sourceTool: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['path', 'kind', 'sourceTool', 'reason'],
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

const RETRY_ARGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: { type: 'string' },
    query: { type: 'string' },
    symbol: { type: 'string' },
    change: { type: 'string' },
    pathQuery: { type: 'string' },
    claim: { type: 'string' },
    reviewGoal: { type: 'string' },
    prompt: { type: 'string' },
    scope: { type: 'array', items: { type: 'string' } },
    knownFiles: { type: 'array', items: { type: 'string' } },
    knownSymbols: { type: 'array', items: { type: 'string' } },
    knownText: { type: 'array', items: { type: 'string' } },
    hints: {
      type: 'object',
      additionalProperties: false,
      properties: {
        symbols: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' } },
        regex: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

const RETRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tool: {
      type: 'string',
      enum: [
        'explore_repo',
        'find_relevant_code',
        'collect_evidence',
        'trace_symbol',
        'map_change_impact',
        'review_change_context',
        'explore',
      ],
    },
    hints: { type: 'array', items: { type: 'string' } },
    args: RETRY_ARGS_SCHEMA,
    expectedImprovement: { type: 'string' },
  },
  required: ['tool', 'hints'],
};

const FAILURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: ['execution', 'input', 'provider', 'internal'] },
    reason: {
      type: 'string',
      enum: [
        'budget_exhausted',
        'tool_errors',
        'aborted',
        'invalid_session',
        'repo_mismatch',
        'invalid_arguments',
        'provider_error',
        'access_denied',
        'invalid_final_response',
      ],
    },
    message: { type: 'string' },
    retry: { anyOf: [{ type: 'null' }, RETRY_SCHEMA] },
  },
  required: ['category', 'reason', 'message', 'retry'],
};

const EVIDENCE_QUALITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    level: { type: 'string', enum: ['low', 'medium', 'high'] },
    exactCount: { type: 'integer' },
    partialCount: { type: 'integer' },
    droppedCount: { type: 'integer' },
    fileCount: { type: 'integer' },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['level', 'exactCount', 'partialCount', 'droppedCount', 'fileCount', 'warnings', 'summary'],
};

const SESSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['created', 'reused', 'fallback'] },
    remainingCalls: { type: 'integer', minimum: 0 },
  },
  required: ['id', 'status', 'remainingCalls'],
};

const SEARCH_COVERAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: { type: 'array', items: { type: 'string' } },
    scopeLimited: { type: 'boolean' },
    filesRead: { type: 'integer', minimum: 0 },
    grepCalls: { type: 'integer', minimum: 0 },
    listDirCalls: { type: 'integer', minimum: 0 },
    symbolCalls: { type: 'integer', minimum: 0 },
    toolResultsTruncated: { type: 'integer', minimum: 0 },
    stoppedByBudget: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: [
    'scope',
    'scopeLimited',
    'filesRead',
    'grepCalls',
    'listDirCalls',
    'symbolCalls',
    'toolResultsTruncated',
    'stoppedByBudget',
    'warnings',
    'summary',
  ],
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
    'schemaVersion',
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
    'evidenceQuality',
    'failure',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    directAnswer: { type: 'string' },
    status: STATUS_SCHEMA,
    targets: { type: 'array', items: TARGET_ITEM_SCHEMA },
    discoveredPaths: { type: 'array', items: DISCOVERED_PATH_SCHEMA },
    evidence: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
    uncertainties: { type: 'array', items: { type: 'string' } },
    nextAction: NEXT_ACTION_SCHEMA,
    evidenceQuality: EVIDENCE_QUALITY_SCHEMA,
    failure: { anyOf: [{ type: 'null' }, FAILURE_SCHEMA] },
    sessionId: { type: 'string' },
    session: SESSION_SCHEMA,
    searchCoverage: SEARCH_COVERAGE_SCHEMA,
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
        description: 'Short direct answer to the delegated exploration task.',
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
      evidence: {
        type: 'array',
        items: EVIDENCE_ITEM_SCHEMA,
      },
    },
    required: [
      'directAnswer',
      'status',
      'targets',
      'evidence',
      'uncertainties',
      'nextAction',
    ],
  },
};

export function validateExploreRepoArgs(args, { allowInternal = false } = {}) {
  if (!args || typeof args !== 'object') {
    throw new Error('Arguments must be an object.');
  }
  const allowedKeys = new Set(Object.keys(EXPLORE_REPO_INPUT_SCHEMA.properties));
  if (allowInternal) allowedKeys.add('taskMode');
  for (const key of Object.keys(args)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown explore_repo argument: ${key}`);
    }
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
    const allowedHintKeys = new Set(Object.keys(EXPLORE_REPO_INPUT_SCHEMA.properties.hints.properties));
    for (const key of Object.keys(args.hints)) {
      if (!allowedHintKeys.has(key)) {
        throw new Error(`Unknown explore_repo hints argument: ${key}`);
      }
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

function normalizeNextAction(item) {
  if (!item || typeof item !== 'object') {
    return { type: 'stop', reason: '' };
  }
  const type = ['stop', 'read_target', 'explore_followup', 'ask_user'].includes(item.type)
    ? item.type
    : 'stop';
  const target = item.target ? normalizeTargetItem(item.target) : null;
  return {
    type,
    reason: typeof item.reason === 'string' ? item.reason : '',
    ...(typeof item.query === 'string' && item.query.trim() ? { query: item.query.trim() } : {}),
    ...(target ? { target } : {}),
  };
}

export function normalizeExploreResult(raw, stats) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const confidence = safe.status?.confidence === 'low' ||
    safe.status?.confidence === 'medium' ||
    safe.status?.confidence === 'high'
    ? safe.status.confidence
    : 'low';
  return {
    directAnswer: typeof safe.directAnswer === 'string' ? safe.directAnswer : '',
    status: normalizeStatus(safe.status, confidence),
    targets: Array.isArray(safe.targets)
      ? safe.targets.map(normalizeTargetItem).filter(Boolean)
      : [],
    nextAction: normalizeNextAction(safe.nextAction),
    uncertainties: Array.isArray(safe.uncertainties)
      ? safe.uncertainties.filter(item => typeof item === 'string')
      : [],
    evidence: Array.isArray(safe.evidence)
      ? safe.evidence
          .filter(item => item && typeof item === 'object')
          .map(item => {
            // Determine evidence kind — default to file_range when omitted.
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
    ...(typeof safe.sessionId === 'string' && safe.sessionId ? { sessionId: safe.sessionId } : {}),
    ...(typeof stats?.sessionId === 'string' && stats.sessionId ? { sessionId: stats.sessionId } : {}),
    stats,
    _debug: safe._debug && typeof safe._debug === 'object' ? safe._debug : {},
  };
}
