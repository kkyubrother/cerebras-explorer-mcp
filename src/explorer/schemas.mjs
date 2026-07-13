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

export const MAX_EVIDENCE_LINE_RANGE = 10_000;

function isValidEvidenceLineNumber(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

export const RETRY_SCHEMA = {
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
        'explain_code_path',
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

const CRITIC_WARNING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string' },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
    message: { type: 'string' },
    target: { type: 'string' },
    action: { type: 'string' },
  },
  required: ['type', 'severity', 'message', 'action'],
};

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['pass', 'caution', 'fail'] },
    warnings: { type: 'array', items: CRITIC_WARNING_SCHEMA },
    droppedEvidence: { type: 'integer', minimum: 0 },
    partialEvidence: { type: 'integer', minimum: 0 },
  },
  // `status` is always populated by the runtime/server, so the declared output
  // contract marks it required (matches DESIGN §11.3 and the agent-facing result).
  required: ['status', 'warnings', 'droppedEvidence', 'partialEvidence'],
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
    omittedDiscoveredPaths: { type: 'integer', minimum: 0 },
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
    'omittedDiscoveredPaths',
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
    'discoveredPaths',
    'evidence',
    'uncertainties',
    'nextAction',
    'evidenceQuality',
    'searchCoverage',
    'critic',
    'failure',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 2 },
    directAnswer: { type: 'string' },
    status: STATUS_SCHEMA,
    targets: { type: 'array', items: TARGET_ITEM_SCHEMA },
    discoveredPaths: { type: 'array', items: DISCOVERED_PATH_SCHEMA },
    evidence: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
    uncertainties: { type: 'array', items: { type: 'string' } },
    nextAction: NEXT_ACTION_SCHEMA,
    evidenceQuality: EVIDENCE_QUALITY_SCHEMA,
    critic: CRITIC_SCHEMA,
    failure: { anyOf: [{ type: 'null' }, FAILURE_SCHEMA] },
    searchCoverage: SEARCH_COVERAGE_SCHEMA,
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
            const startLine = isValidEvidenceLineNumber(item.startLine)
              ? item.startLine
              : undefined;
            const endLine = isValidEvidenceLineNumber(item.endLine)
              ? item.endLine
              : undefined;
            const malformedRange = !isValidEvidenceLineNumber(startLine) ||
              !isValidEvidenceLineNumber(endLine) ||
              endLine < startLine ||
              endLine - startLine + 1 > MAX_EVIDENCE_LINE_RANGE;

            const base = {
              ...(typeof item.id === 'string' && item.id ? { id: item.id } : {}),
              path: typeof item.path === 'string' ? item.path : '',
              ...(Number.isInteger(startLine) ? { startLine } : {}),
              ...(Number.isInteger(endLine) ? { endLine } : {}),
              why: typeof item.why === 'string' ? item.why : '',
              evidenceType: kind,
              ...(malformedRange ? { malformedRange: true } : {}),
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
    stats,
  };
}

// Internal trust-plane schemas are strict runtime contracts. They are kept
// separate from the parent-facing MCP schemas above and are never exposed as
// tool input or output fields.
const NON_EMPTY_INTERNAL_STRINGS = new WeakSet();

function internalString(enumValues) {
  const schema = {
    type: 'string',
    ...(enumValues ? { enum: [...enumValues] } : {}),
  };
  NON_EMPTY_INTERNAL_STRINGS.add(schema);
  return schema;
}

function internalStringArray({ minItems } = {}) {
  return {
    type: 'array',
    items: internalString(),
    ...(minItems === undefined ? {} : { minItems }),
  };
}

function strictInternalObject(properties, required) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

const CLAIM_TYPE_TO_PROOF_POLICY = Object.freeze({
  positive: 'direct_source',
  absence: 'bounded_absence',
  count: 'deterministic_count',
  symbol_definition: 'symbol_definition',
  symbol_usage: 'bounded_usage_cross_check',
  flow: 'ordered_handoffs',
  impact: 'impact_categories',
  comparison: 'distinct_policy_paths',
  claim_verification: 'support_or_refute',
});

const CLAIM_TYPES = Object.freeze(Object.keys(CLAIM_TYPE_TO_PROOF_POLICY));
const PROOF_POLICIES = Object.freeze(Object.values(CLAIM_TYPE_TO_PROOF_POLICY));

const WRAPPER_GOAL_SEEDS = Object.freeze({
  find_relevant_code: Object.freeze(['locations', 'relevance', 'smallest_set']),
  trace_symbol: Object.freeze(['definition', 'usage']),
  map_change_impact: Object.freeze([
    'targets',
    'dependents',
    'requested_categories',
    'risk_boundary',
  ]),
  explain_code_path: Object.freeze(['entry', 'handoffs', 'terminal_effect', 'transitions']),
  collect_evidence: Object.freeze(['verdict', 'direct_evidence', 'counterevidence']),
  explore_repo: Object.freeze([]),
});

const PLANNER_SUBGOAL_SCHEMA = strictInternalObject({
  id: internalString(),
  question: internalString(),
  originRefs: internalStringArray(),
  claimType: internalString(CLAIM_TYPES),
  proofCondition: internalString(),
  constraints: internalStringArray(),
}, ['id', 'question', 'originRefs', 'claimType', 'proofCondition', 'constraints']);

export const LATE_UNCOVERED_PROPOSAL_SCHEMA = strictInternalObject({
  question: internalString(),
  originRefs: internalStringArray(),
  claimType: internalString(CLAIM_TYPES),
  proofCondition: internalString(),
  constraints: internalStringArray(),
}, ['question', 'originRefs', 'claimType', 'proofCondition', 'constraints']);

export const PLANNER_PROPOSAL_SCHEMA = strictInternalObject({
  taskSummary: internalString(),
  constraints: internalStringArray(),
  subgoals: {
    type: 'array',
    items: PLANNER_SUBGOAL_SCHEMA,
  },
}, ['taskSummary', 'constraints', 'subgoals']);

const CAPABILITY_MANIFEST_SCHEMA = strictInternalObject({
  repositoryRead: { type: 'boolean', const: true },
  gitRead: { type: 'boolean', const: true },
  repositoryWrite: { type: 'boolean', const: false },
  liveRuntimeState: { type: 'boolean', const: false },
  scopeWidening: { type: 'boolean', const: false },
  secretPathRead: { type: 'boolean', const: false },
}, [
  'repositoryRead',
  'gitRead',
  'repositoryWrite',
  'liveRuntimeState',
  'scopeWidening',
  'secretPathRead',
]);

const REQUIRED_SUBGOAL_SCHEMA = strictInternalObject({
  id: internalString(),
  question: internalString(),
  originRefs: internalStringArray({ minItems: 1 }),
  claimType: internalString(CLAIM_TYPES),
  proofPolicy: internalString(PROOF_POLICIES),
  proofCondition: internalString(),
  constraints: internalStringArray(),
  auditVerdict: internalString([
    'ready',
    'blocked_scope',
    'blocked_capability',
    'requires_external_state',
    'missing_input',
    'contradictory',
    'unverifiable',
    'planning_incomplete',
  ]),
  state: internalString([
    'audited',
    'blocked',
    'exploring',
    'candidate',
    'supported',
    'gap',
    'contradicted',
  ]),
  resolution: internalString(['affirmed', 'refuted']),
  claimRefs: internalStringArray(),
  blockerRef: internalString(),
  gapRef: internalString(),
}, [
  'id',
  'question',
  'originRefs',
  'claimType',
  'proofPolicy',
  'proofCondition',
  'constraints',
  'auditVerdict',
  'state',
  'claimRefs',
]);

export const TASK_CONTRACT_SCHEMA = strictInternalObject({
  task: internalString(),
  effectiveScope: internalStringArray(),
  constraints: internalStringArray(),
  capabilities: CAPABILITY_MANIFEST_SCHEMA,
  subgoals: {
    type: 'array',
    items: REQUIRED_SUBGOAL_SCHEMA,
    minItems: 1,
  },
  plannerVersion: internalString(),
  goalAuditVersion: internalString(),
}, [
  'task',
  'effectiveScope',
  'constraints',
  'capabilities',
  'subgoals',
  'plannerVersion',
  'goalAuditVersion',
]);

export const GOAL_AUDIT_RECORD_SCHEMA = strictInternalObject({
  proposedGoalId: internalString(),
  verdict: internalString([
    'ready',
    'merge_duplicate',
    'needs_decomposition',
    'reject_untraceable',
    'blocked_scope',
    'blocked_capability',
    'requires_external_state',
    'missing_input',
    'contradictory',
    'unverifiable',
  ]),
  originRefs: internalStringArray(),
  mergeInto: internalString(),
  missingRequestParts: internalStringArray(),
  reason: internalString(),
}, [
  'proposedGoalId',
  'verdict',
  'originRefs',
  'missingRequestParts',
  'reason',
]);

export const GOAL_AUDITOR_RESPONSE_SCHEMA = strictInternalObject({
  goals: {
    type: 'array',
    items: GOAL_AUDIT_RECORD_SCHEMA,
  },
  uncoveredRequestParts: {
    type: 'array',
    items: LATE_UNCOVERED_PROPOSAL_SCHEMA,
  },
}, ['goals', 'uncoveredRequestParts']);

export const ATOMIC_CLAIM_SCHEMA = strictInternalObject({
  id: internalString(),
  subgoalId: internalString(),
  text: internalString(),
  evidenceRefs: internalStringArray({ minItems: 1 }),
  verdict: internalString([
    'pending',
    'supported',
    'insufficient',
    'contradicted',
  ]),
}, ['id', 'subgoalId', 'text', 'evidenceRefs', 'verdict']);

const SYNTHESIZED_CLAIM_SCHEMA = strictInternalObject({
  id: internalString(),
  subgoalId: internalString(),
  text: internalString(),
  evidenceRefs: internalStringArray(),
}, ['id', 'subgoalId', 'text', 'evidenceRefs']);

export const CLAIM_SYNTHESIS_SCHEMA = strictInternalObject({
  claims: {
    type: 'array',
    items: SYNTHESIZED_CLAIM_SCHEMA,
  },
}, ['claims']);

export const SEMANTIC_VERDICT_SCHEMA = strictInternalObject({
  claimId: internalString(),
  result: internalString(['supported', 'insufficient', 'contradicted']),
  resolution: internalString(['affirmed', 'refuted']),
  supportingEvidenceRefs: internalStringArray(),
  reasonCode: internalString([
    'entailed',
    'semantic_mismatch',
    'overgeneralized',
    'missing_transition',
    'missing_category',
    'boundary_mismatch',
    'contradiction',
    'uncovered_request',
  ]),
  note: internalString(),
}, ['claimId', 'result', 'supportingEvidenceRefs', 'reasonCode', 'note']);

export const SEMANTIC_VERIFIER_RESPONSE_SCHEMA = strictInternalObject({
  verdicts: {
    type: 'array',
    items: SEMANTIC_VERDICT_SCHEMA,
  },
  uncoveredRequestParts: {
    type: 'array',
    items: LATE_UNCOVERED_PROPOSAL_SCHEMA,
  },
}, ['verdicts', 'uncoveredRequestParts']);

export const ABSENCE_CERTIFICATE_SCHEMA = strictInternalObject({
  id: internalString(),
  subgoalId: internalString(),
  claimBoundary: internalStringArray(),
  searchRefs: internalStringArray(),
  searchSummary: internalStringArray(),
  complete: { type: 'boolean' },
  qualification: internalString(),
}, [
  'id',
  'subgoalId',
  'claimBoundary',
  'searchRefs',
  'searchSummary',
  'complete',
]);

export const SAFETY_LIMIT_SCHEMA = strictInternalObject({
  name: internalString([
    'turn_limit',
    'context_limit',
    'generation_output_limit',
    'walk_limit',
    'tool_result_limit',
  ]),
  stage: internalString([
    'planner',
    'goal_audit',
    'plan_revision',
    'exploration',
    'synthesis',
    'verification',
    'repair',
  ]),
  affectedSubgoalIds: internalStringArray(),
  truncated: { type: 'boolean' },
}, ['name', 'stage', 'affectedSubgoalIds', 'truncated']);

function failInternalValidation(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function validateInternalValue(schema, value, path) {
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        failInternalValidation(path, 'expected an object');
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        failInternalValidation(path, 'expected a plain object');
      }
      for (const key of schema.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          failInternalValidation(path, `missing required property ${key}`);
        }
      }
      const allowedKeys = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !allowedKeys.has(key)) {
          failInternalValidation(path, `unexpected property ${String(key)}`);
        }
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          validateInternalValue(child, value[key], `${path}.${key}`);
        }
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) failInternalValidation(path, 'expected an array');
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        failInternalValidation(path, `expected at least ${schema.minItems} item(s)`);
      }
      for (let index = 0; index < value.length; index += 1) {
        validateInternalValue(schema.items, value[index], `${path}[${index}]`);
      }
      break;
    case 'string':
      if (typeof value !== 'string') failInternalValidation(path, 'expected a string');
      if (NON_EMPTY_INTERNAL_STRINGS.has(schema) && value.length === 0) {
        failInternalValidation(path, 'expected at least 1 character');
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        failInternalValidation(path, `expected at least ${schema.minLength} character(s)`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') failInternalValidation(path, 'expected a boolean');
      break;
    case 'integer':
      if (!Number.isSafeInteger(value)) failInternalValidation(path, 'expected a safe integer');
      break;
    default:
      failInternalValidation(path, `unsupported schema type ${schema.type}`);
  }

  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    failInternalValidation(path, `expected constant ${String(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    failInternalValidation(path, 'value is not in the allowed enum');
  }
  return value;
}

function validateInternalEntity(schema, label, value) {
  return validateInternalValue(schema, value, label);
}

function validateOriginContext({ task, wrapperTool } = {}, label) {
  if (typeof task !== 'string' || task.length === 0) {
    failInternalValidation(`${label}.task`, 'expected the original non-empty task string');
  }
  const activeWrapper = wrapperTool === undefined ? 'explore_repo' : wrapperTool;
  if (typeof activeWrapper !== 'string' || !Object.hasOwn(WRAPPER_GOAL_SEEDS, activeWrapper)) {
    failInternalValidation(`${label}.wrapperTool`, 'expected one retained explorer wrapper');
  }
  return { task, activeWrapper };
}

function validateOriginRefs(originRefs, context, path) {
  const { task, activeWrapper } = validateOriginContext(context, path);
  for (let index = 0; index < originRefs.length; index += 1) {
    const originRef = originRefs[index];
    const requestMatch = /^request:(\d+)-(\d+)$/.exec(originRef);
    if (requestMatch) {
      const start = Number(requestMatch[1]);
      const end = Number(requestMatch[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          start < 0 || end <= start || end > task.length || task.slice(start, end).trim() === '') {
        failInternalValidation(`${path}[${index}]`, `invalid request origin ${originRef}`);
      }
      continue;
    }

    const wrapperMatch = /^wrapper:([^:]+):([^:]+)$/.exec(originRef);
    if (wrapperMatch &&
        wrapperMatch[1] === activeWrapper &&
        WRAPPER_GOAL_SEEDS[activeWrapper].includes(wrapperMatch[2])) {
      continue;
    }
    failInternalValidation(`${path}[${index}]`, `invalid wrapper origin ${originRef}`);
  }
}

function validateRequiredOriginRefs(originRefs, context, path) {
  if (originRefs.length === 0) {
    failInternalValidation(path, 'expected at least one origin reference');
  }
  validateOriginRefs(originRefs, context, path);
}

function validateGoalAuditRecordRules(value, path) {
  const hasMergeInto = Object.prototype.hasOwnProperty.call(value, 'mergeInto');
  if (value.verdict === 'merge_duplicate' && !hasMergeInto) {
    failInternalValidation(path, 'merge_duplicate requires mergeInto');
  }
  if (value.verdict !== 'merge_duplicate' && hasMergeInto) {
    failInternalValidation(path, 'mergeInto is allowed only for merge_duplicate');
  }
  if (value.verdict !== 'reject_untraceable' && value.originRefs.length === 0) {
    failInternalValidation(path, `${value.verdict} requires at least one confirmed origin`);
  }
}

export function validateExploreControlResult(value) {
  return validateInternalEntity(
    EXPLORE_RESULT_JSON_SCHEMA.schema,
    'ExploreControlResult',
    value,
  );
}

export function validateTaskContract(value) {
  const validated = validateInternalEntity(TASK_CONTRACT_SCHEMA, 'TaskContract', value);
  for (let index = 0; index < validated.subgoals.length; index += 1) {
    const subgoal = validated.subgoals[index];
    const expectedPolicy = CLAIM_TYPE_TO_PROOF_POLICY[subgoal.claimType];
    if (subgoal.proofPolicy !== expectedPolicy) {
      failInternalValidation(
        `TaskContract.subgoals[${index}].proofPolicy`,
        `expected runtime-derived policy ${expectedPolicy}`,
      );
    }
  }
  return validated;
}

export function validateGoalAuditRecord(value) {
  const validated = validateInternalEntity(GOAL_AUDIT_RECORD_SCHEMA, 'GoalAuditRecord', value);
  validateGoalAuditRecordRules(validated, 'GoalAuditRecord');
  return validated;
}

export function validatePlannerProposal(value, context) {
  const validated = validateInternalEntity(PLANNER_PROPOSAL_SCHEMA, 'PlannerProposal', value);
  if (validated.subgoals.length === 0) {
    failInternalValidation('PlannerProposal.subgoals', 'expected at least one subgoal');
  }
  for (let index = 0; index < validated.subgoals.length; index += 1) {
    validateRequiredOriginRefs(
      validated.subgoals[index].originRefs,
      context,
      `PlannerProposal.subgoals[${index}].originRefs`,
    );
  }
  return validated;
}

export function validateLateUncoveredProposal(value, context) {
  const validated = validateInternalEntity(
    LATE_UNCOVERED_PROPOSAL_SCHEMA,
    'LateUncoveredProposal',
    value,
  );
  validateRequiredOriginRefs(
    validated.originRefs,
    context,
    'LateUncoveredProposal.originRefs',
  );
  return validated;
}

export function validateGoalAuditorResponse(value, context = {}) {
  const validated = validateInternalEntity(
    GOAL_AUDITOR_RESPONSE_SCHEMA,
    'GoalAuditorResponse',
    value,
  );
  if (validated.goals.length === 0) {
    failInternalValidation('GoalAuditorResponse.goals', 'expected at least one audit record');
  }
  const plannerProposal = validatePlannerProposal(context.plannerProposal, context);
  const proposalById = new Map();
  for (const proposal of plannerProposal.subgoals) {
    proposalById.set(proposal.id, proposal);
  }
  const auditedGoalIds = new Set();

  for (let index = 0; index < validated.goals.length; index += 1) {
    const record = validated.goals[index];
    const path = `GoalAuditorResponse.goals[${index}]`;
    validateGoalAuditRecordRules(record, path);

    if (auditedGoalIds.has(record.proposedGoalId)) {
      failInternalValidation(path, `duplicate audit record for ${record.proposedGoalId}`);
    }
    auditedGoalIds.add(record.proposedGoalId);

    const proposal = proposalById.get(record.proposedGoalId);
    if (!proposal) {
      failInternalValidation(path, `unknown proposedGoalId ${record.proposedGoalId}`);
    }
    validateOriginRefs(record.originRefs, context, `${path}.originRefs`);
    for (const originRef of record.originRefs) {
      if (!proposal.originRefs.includes(originRef)) {
        failInternalValidation(path, `unproposed origin ${originRef}`);
      }
    }

    if (record.verdict === 'merge_duplicate') {
      if (record.mergeInto === record.proposedGoalId || !proposalById.has(record.mergeInto)) {
        failInternalValidation(path, `invalid merge target ${record.mergeInto}`);
      }
    }
  }

  for (let index = 0; index < validated.uncoveredRequestParts.length; index += 1) {
    validateRequiredOriginRefs(
      validated.uncoveredRequestParts[index].originRefs,
      context,
      `GoalAuditorResponse.uncoveredRequestParts[${index}].originRefs`,
    );
  }
  return validated;
}

export function validateAtomicClaim(value) {
  return validateInternalEntity(ATOMIC_CLAIM_SCHEMA, 'AtomicClaim', value);
}

export function validateClaimSynthesisResponse(value) {
  const validated = validateInternalEntity(
    CLAIM_SYNTHESIS_SCHEMA,
    'ClaimSynthesisResponse',
    value,
  );
  for (let index = 0; index < validated.claims.length; index += 1) {
    if (validated.claims[index].evidenceRefs.length === 0) {
      failInternalValidation(
        `ClaimSynthesisResponse.claims[${index}].evidenceRefs`,
        'expected at least one evidence reference',
      );
    }
  }
  return validated;
}

function validateSemanticVerdictRules(value, path) {
  const hasResolution = Object.prototype.hasOwnProperty.call(value, 'resolution');
  if (value.result === 'supported' && !hasResolution) {
    failInternalValidation(path, 'supported verdict requires resolution');
  }
  if (value.result !== 'supported' && hasResolution) {
    failInternalValidation(path, 'resolution is allowed only for supported verdicts');
  }
}

export function validateSemanticVerdict(value) {
  const validated = validateInternalEntity(SEMANTIC_VERDICT_SCHEMA, 'SemanticVerdict', value);
  validateSemanticVerdictRules(validated, 'SemanticVerdict');
  return validated;
}

export function validateSemanticVerifierResponse(value) {
  const validated = validateInternalEntity(
    SEMANTIC_VERIFIER_RESPONSE_SCHEMA,
    'SemanticVerifierResponse',
    value,
  );
  for (let index = 0; index < validated.verdicts.length; index += 1) {
    validateSemanticVerdictRules(
      validated.verdicts[index],
      `SemanticVerifierResponse.verdicts[${index}]`,
    );
  }
  return validated;
}

export function validateAbsenceCertificate(value) {
  return validateInternalEntity(ABSENCE_CERTIFICATE_SCHEMA, 'AbsenceCertificate', value);
}

export function validateSafetyLimit(value) {
  return validateInternalEntity(SAFETY_LIMIT_SCHEMA, 'SafetyLimit', value);
}
