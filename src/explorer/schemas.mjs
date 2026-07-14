import { createHash } from 'node:crypto';

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
        'find_relevant_code',
        'trace_symbol',
        'map_change_impact',
        'explain_code_path',
        'collect_evidence',
        'explore_repo',
      ],
    },
    hints: { type: 'array', items: { type: 'string' } },
    args: RETRY_ARGS_SCHEMA,
    expectedImprovement: { type: 'string' },
  },
  required: ['tool', 'hints'],
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

function strictPublicObject(properties, required = []) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

function nonEmptyPublicString(extra = {}) {
  return { type: 'string', minLength: 1, ...extra };
}

function publicStringArray({ minItems } = {}) {
  return {
    type: 'array',
    items: { type: 'string' },
    ...(minItems === undefined ? {} : { minItems }),
  };
}

const V3_TARGET_SCHEMA = strictPublicObject({
  path: nonEmptyPublicString(),
  startLine: { type: 'integer', minimum: 1 },
  endLine: { type: 'integer', minimum: 1 },
  role: { type: 'string', enum: ['read', 'edit', 'test', 'config'] },
  reason: nonEmptyPublicString(),
  evidenceRefs: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    items: nonEmptyPublicString(),
  },
}, ['path', 'role', 'reason']);

const V3_SOURCE_EVIDENCE_SCHEMA = strictPublicObject({
  id: nonEmptyPublicString(),
  kind: { type: 'string', const: 'source' },
  path: nonEmptyPublicString(),
  startLine: { type: 'integer', minimum: 1 },
  endLine: { type: 'integer', minimum: 1 },
  supports: nonEmptyPublicString(),
  snippet: nonEmptyPublicString(),
}, ['kind', 'path', 'startLine', 'endLine', 'supports']);

const V3_GIT_EVIDENCE_SCHEMA = strictPublicObject({
  id: nonEmptyPublicString(),
  kind: { type: 'string', const: 'git' },
  sha: nonEmptyPublicString(),
  path: nonEmptyPublicString(),
  startLine: { type: 'integer', minimum: 1 },
  endLine: { type: 'integer', minimum: 1 },
  supports: nonEmptyPublicString(),
}, ['kind', 'sha', 'supports']);

const V3_ABSENCE_EVIDENCE_SCHEMA = strictPublicObject({
  id: nonEmptyPublicString(),
  kind: { type: 'string', const: 'absence' },
  boundary: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    items: nonEmptyPublicString(),
  },
  searches: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    items: nonEmptyPublicString(),
  },
  supports: nonEmptyPublicString(),
}, ['kind', 'boundary', 'searches', 'supports']);

const V3_EVIDENCE_SCHEMA = {
  oneOf: [
    V3_SOURCE_EVIDENCE_SCHEMA,
    V3_GIT_EVIDENCE_SCHEMA,
    V3_ABSENCE_EVIDENCE_SCHEMA,
  ],
};

const V3_GAP_SCHEMA = strictPublicObject({
  question: nonEmptyPublicString(),
  reason: nonEmptyPublicString(),
}, ['question', 'reason']);

const PUBLIC_SCOPE_SCHEMA = publicStringArray();
const PUBLIC_KNOWN_FILES_SCHEMA = publicStringArray();
const PUBLIC_KNOWN_SYMBOLS_SCHEMA = publicStringArray();
const PUBLIC_KNOWN_TEXT_SCHEMA = publicStringArray();

const V3_EXPLORE_REPO_ARGUMENT_SCHEMA = strictPublicObject({
  task: nonEmptyPublicString(),
  repo_root: nonEmptyPublicString(),
  scope: PUBLIC_SCOPE_SCHEMA,
  hints: strictPublicObject({
    symbols: PUBLIC_KNOWN_SYMBOLS_SCHEMA,
    files: PUBLIC_KNOWN_FILES_SCHEMA,
    regex: publicStringArray(),
  }),
  language: nonEmptyPublicString(),
}, ['task']);

const V3_FIND_RELEVANT_CODE_ARGUMENT_SCHEMA = strictPublicObject({
  query: nonEmptyPublicString(),
  repo_root: nonEmptyPublicString(),
  scope: PUBLIC_SCOPE_SCHEMA,
  knownFiles: PUBLIC_KNOWN_FILES_SCHEMA,
  knownSymbols: PUBLIC_KNOWN_SYMBOLS_SCHEMA,
  knownText: PUBLIC_KNOWN_TEXT_SCHEMA,
}, ['query']);

const V3_TRACE_SYMBOL_ARGUMENT_SCHEMA = strictPublicObject({
  symbol: nonEmptyPublicString(),
  repo_root: nonEmptyPublicString(),
  scope: PUBLIC_SCOPE_SCHEMA,
}, ['symbol']);

const V3_MAP_CHANGE_IMPACT_ARGUMENT_SCHEMA = strictPublicObject({
  change: nonEmptyPublicString(),
  repo_root: nonEmptyPublicString(),
  scope: PUBLIC_SCOPE_SCHEMA,
  knownFiles: PUBLIC_KNOWN_FILES_SCHEMA,
  knownSymbols: PUBLIC_KNOWN_SYMBOLS_SCHEMA,
}, ['change']);

const V3_EXPLAIN_CODE_PATH_ARGUMENT_SCHEMA = strictPublicObject({
  pathQuery: nonEmptyPublicString(),
  repo_root: nonEmptyPublicString(),
  scope: PUBLIC_SCOPE_SCHEMA,
  entryPoint: nonEmptyPublicString(),
  knownFiles: PUBLIC_KNOWN_FILES_SCHEMA,
  knownSymbols: PUBLIC_KNOWN_SYMBOLS_SCHEMA,
}, ['pathQuery']);

const V3_COLLECT_EVIDENCE_ARGUMENT_SCHEMA = strictPublicObject({
  claim: nonEmptyPublicString(),
  repo_root: nonEmptyPublicString(),
  scope: PUBLIC_SCOPE_SCHEMA,
  knownFiles: PUBLIC_KNOWN_FILES_SCHEMA,
  knownSymbols: PUBLIC_KNOWN_SYMBOLS_SCHEMA,
  knownText: PUBLIC_KNOWN_TEXT_SCHEMA,
}, ['claim']);

export const PUBLIC_TOOL_ARGUMENT_SCHEMAS = Object.freeze({
  find_relevant_code: V3_FIND_RELEVANT_CODE_ARGUMENT_SCHEMA,
  trace_symbol: V3_TRACE_SYMBOL_ARGUMENT_SCHEMA,
  map_change_impact: V3_MAP_CHANGE_IMPACT_ARGUMENT_SCHEMA,
  explain_code_path: V3_EXPLAIN_CODE_PATH_ARGUMENT_SCHEMA,
  collect_evidence: V3_COLLECT_EVIDENCE_ARGUMENT_SCHEMA,
  explore_repo: V3_EXPLORE_REPO_ARGUMENT_SCHEMA,
});

const V3_TOOL_ACTION_SCHEMA = {
  oneOf: Object.entries(PUBLIC_TOOL_ARGUMENT_SCHEMAS).map(([tool, argumentSchema]) =>
    strictPublicObject({
      type: { type: 'string', const: 'tool' },
      tool: { type: 'string', const: tool },
      arguments: argumentSchema,
    }, ['type', 'tool', 'arguments'])),
};

const V3_ASK_USER_ACTION_SCHEMA = strictPublicObject({
  type: { type: 'string', const: 'ask_user' },
  question: nonEmptyPublicString(),
}, ['type', 'question']);

const V3_EXTERNAL_VERIFICATION_ACTION_SCHEMA = strictPublicObject({
  type: { type: 'string', const: 'external_verification' },
  requirement: nonEmptyPublicString(),
}, ['type', 'requirement']);

const V3_FOLLOW_UP_SCHEMA = {
  oneOf: [
    V3_TOOL_ACTION_SCHEMA,
    V3_ASK_USER_ACTION_SCHEMA,
    V3_EXTERNAL_VERIFICATION_ACTION_SCHEMA,
  ],
};

const V3_FAILURE_SCHEMA = strictPublicObject({
  reason: {
    type: 'string',
    enum: [
      'invalid_arguments',
      'repo_mismatch',
      'aborted',
      'provider_error',
      'tool_failure',
      'verifier_error',
      'access_denied',
      'internal_error',
    ],
  },
  retry: V3_TOOL_ACTION_SCHEMA,
}, ['reason']);

const V3_PARENT_PROPERTIES = {
  schemaVersion: { type: 'integer', const: 3 },
  directAnswer: nonEmptyPublicString(),
  state: {
    type: 'string',
    enum: ['complete', 'verify_targets', 'incomplete', 'failed'],
  },
  targets: { type: 'array', minItems: 1, items: V3_TARGET_SCHEMA },
  evidence: { type: 'array', minItems: 1, items: V3_EVIDENCE_SCHEMA },
  gaps: { type: 'array', minItems: 1, items: V3_GAP_SCHEMA },
  followUp: V3_FOLLOW_UP_SCHEMA,
  failure: V3_FAILURE_SCHEMA,
};

function parentStateProperties(state, keys) {
  const properties = Object.fromEntries(keys.map(key => [key, V3_PARENT_PROPERTIES[key]]));
  properties.state = { type: 'string', const: state };
  return properties;
}

const V3_COMPLETE_STATE_SCHEMA = strictPublicObject(
  parentStateProperties('complete', [
    'schemaVersion', 'directAnswer', 'state', 'targets', 'evidence',
  ]),
  ['schemaVersion', 'directAnswer', 'state', 'evidence'],
);

const V3_VERIFY_TARGETS_STATE_SCHEMA = strictPublicObject(
  parentStateProperties('verify_targets', [
    'schemaVersion', 'directAnswer', 'state', 'targets', 'evidence',
  ]),
  ['schemaVersion', 'directAnswer', 'state', 'targets', 'evidence'],
);

const V3_INCOMPLETE_NO_PARTIAL_SCHEMA = strictPublicObject(
  parentStateProperties('incomplete', [
    'schemaVersion', 'state', 'targets', 'gaps', 'followUp',
  ]),
  ['schemaVersion', 'state', 'gaps'],
);

const V3_INCOMPLETE_WITH_PARTIAL_SCHEMA = strictPublicObject(
  parentStateProperties('incomplete', [
    'schemaVersion', 'directAnswer', 'state', 'targets', 'evidence', 'gaps', 'followUp',
  ]),
  ['schemaVersion', 'directAnswer', 'state', 'evidence', 'gaps'],
);

const V3_INCOMPLETE_STATE_SCHEMA = {
  ...strictPublicObject(
    parentStateProperties('incomplete', [
      'schemaVersion', 'directAnswer', 'state', 'targets', 'evidence', 'gaps', 'followUp',
    ]),
    ['schemaVersion', 'state', 'gaps'],
  ),
  oneOf: [V3_INCOMPLETE_NO_PARTIAL_SCHEMA, V3_INCOMPLETE_WITH_PARTIAL_SCHEMA],
};

const V3_FAILED_STATE_SCHEMA = strictPublicObject(
  parentStateProperties('failed', ['schemaVersion', 'directAnswer', 'state', 'failure']),
  ['schemaVersion', 'directAnswer', 'state', 'failure'],
);

export const PARENT_HANDOFF_V3_SCHEMA = {
  ...strictPublicObject(V3_PARENT_PROPERTIES, ['schemaVersion', 'state']),
  oneOf: [
    V3_COMPLETE_STATE_SCHEMA,
    V3_VERIFY_TARGETS_STATE_SCHEMA,
    V3_INCOMPLETE_STATE_SCHEMA,
    V3_FAILED_STATE_SCHEMA,
  ],
};

export const EXPLORE_REPO_OUTPUT_SCHEMA = PARENT_HANDOFF_V3_SCHEMA;

function failPublicValidation(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function validatePublicSchemaValue(schema, value, path = 'ParentHandoffV3') {
  if (!schema || typeof schema !== 'object') {
    failPublicValidation(path, 'invalid schema node');
  }

  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    const errors = [];
    for (const branch of schema.oneOf) {
      try {
        validatePublicSchemaValue(branch, value, path);
        matches += 1;
      } catch (error) {
        errors.push(error?.message ?? String(error));
      }
    }
    if (matches !== 1) {
      failPublicValidation(
        path,
        `expected exactly one schema branch, matched ${matches}; ${errors[0] ?? 'no branch detail'}`,
      );
    }
  }

  switch (schema.type) {
    case undefined:
      break;
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        failPublicValidation(path, 'expected an object');
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        failPublicValidation(path, 'expected a plain object');
      }
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key)) {
          failPublicValidation(path, `missing required property ${key}`);
        }
      }
      const allowedKeys = new Set(Object.keys(schema.properties ?? {}));
      if (schema.additionalProperties === false) {
        for (const key of Reflect.ownKeys(value)) {
          if (typeof key !== 'string' || !allowedKeys.has(key)) {
            failPublicValidation(path, `unexpected property ${String(key)}`);
          }
        }
      }
      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (Object.hasOwn(value, key)) {
          validatePublicSchemaValue(childSchema, value[key], `${path}.${key}`);
        }
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) failPublicValidation(path, 'expected an array');
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        failPublicValidation(path, `expected at least ${schema.minItems} item(s)`);
      }
      if (schema.uniqueItems === true) {
        const fingerprints = value.map(item => JSON.stringify(item));
        if (new Set(fingerprints).size !== fingerprints.length) {
          failPublicValidation(path, 'expected unique items');
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        validatePublicSchemaValue(schema.items, value[index], `${path}[${index}]`);
      }
      break;
    }
    case 'string':
      if (typeof value !== 'string') failPublicValidation(path, 'expected a string');
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        failPublicValidation(path, `expected at least ${schema.minLength} character(s)`);
      }
      break;
    case 'integer':
      if (!Number.isSafeInteger(value)) failPublicValidation(path, 'expected a safe integer');
      if (schema.minimum !== undefined && value < schema.minimum) {
        failPublicValidation(path, `expected a value >= ${schema.minimum}`);
      }
      break;
    default:
      failPublicValidation(path, `unsupported schema type ${schema.type}`);
  }

  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    failPublicValidation(path, `expected constant ${String(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    failPublicValidation(path, 'value is not in the allowed enum');
  }
  return value;
}

export function validateParentHandoffV3(value) {
  return validatePublicSchemaValue(PARENT_HANDOFF_V3_SCHEMA, value);
}

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
const GOAL_AUDIT_BINDING_DOMAIN = 'required-subgoal-audit-binding-v1';

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
  collect_evidence: Object.freeze(['verdict']),
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
  auditBinding: internalString(),
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
  'auditBinding',
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

const COUNT_MEASUREMENT_SCHEMA = strictInternalObject({
  kind: internalString(['count']),
  unit: internalString(['matching_lines', 'files', 'array_entries']),
  value: { type: 'integer', minimum: 0 },
}, ['kind', 'unit', 'value']);

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
  measurement: COUNT_MEASUREMENT_SCHEMA,
}, ['id', 'subgoalId', 'text', 'evidenceRefs', 'verdict']);

const SYNTHESIZED_CLAIM_SCHEMA = strictInternalObject({
  id: internalString(),
  subgoalId: internalString(),
  text: internalString(),
  evidenceRefs: internalStringArray(),
  measurement: COUNT_MEASUREMENT_SCHEMA,
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
  zeroMatches: { type: 'boolean' },
  qualification: internalString(),
}, [
  'id',
  'subgoalId',
  'claimBoundary',
  'searchRefs',
  'searchSummary',
  'complete',
  'zeroMatches',
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
      if (schema.minimum !== undefined && value < schema.minimum) {
        failInternalValidation(path, `expected a value >= ${schema.minimum}`);
      }
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

function sortedUniqueStrings(value, label) {
  if (!Array.isArray(value) ||
      value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${label} must be a non-empty string array.`);
  }
  return [...new Set(value)].sort();
}

/**
 * Seal the immutable, runtime-audited acceptance core of one required goal.
 * Mutable exploration state is intentionally excluded. The grouped digest
 * remains stable when optional generic-hex redaction is enabled.
 */
export function computeGoalAuditBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Required subgoal audit binding input must be an object.');
  }
  const scalarKeys = [
    'id',
    'question',
    'claimType',
    'proofPolicy',
    'proofCondition',
    'auditVerdict',
  ];
  for (const key of scalarKeys) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new TypeError(`Required subgoal audit binding ${key} must be a non-empty string.`);
    }
  }
  const core = {
    id: value.id,
    question: value.question,
    originRefs: sortedUniqueStrings(value.originRefs, 'Required subgoal originRefs'),
    claimType: value.claimType,
    proofPolicy: value.proofPolicy,
    proofCondition: value.proofCondition,
    constraints: sortedUniqueStrings(value.constraints, 'Required subgoal constraints'),
    auditVerdict: value.auditVerdict,
  };
  const digest = createHash('sha256')
    .update(JSON.stringify([GOAL_AUDIT_BINDING_DOMAIN, core]))
    .digest('hex');
  return `audit-v1:${digest.match(/.{16}/g).join('-')}`;
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
  const subgoalIds = new Set();
  for (let index = 0; index < validated.subgoals.length; index += 1) {
    const subgoal = validated.subgoals[index];
    if (subgoalIds.has(subgoal.id)) {
      failInternalValidation(
        `TaskContract.subgoals[${index}].id`,
        `duplicate subgoal id ${subgoal.id}`,
      );
    }
    subgoalIds.add(subgoal.id);
    const expectedPolicy = CLAIM_TYPE_TO_PROOF_POLICY[subgoal.claimType];
    if (subgoal.proofPolicy !== expectedPolicy) {
      failInternalValidation(
        `TaskContract.subgoals[${index}].proofPolicy`,
        `expected runtime-derived policy ${expectedPolicy}`,
      );
    }
    if (subgoal.auditBinding !== computeGoalAuditBinding(subgoal)) {
      failInternalValidation(
        `TaskContract.subgoals[${index}].auditBinding`,
        'does not match the runtime-audited acceptance core',
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
  const externalMergeTargetIds = new Set(
    Array.isArray(context.externalMergeTargetIds)
      ? context.externalMergeTargetIds.filter(id => typeof id === 'string' && id)
      : [],
  );

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
      if (record.mergeInto === record.proposedGoalId ||
          (!proposalById.has(record.mergeInto) && !externalMergeTargetIds.has(record.mergeInto))) {
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
  if (value.reasonCode === 'uncovered_request' && value.result !== 'insufficient') {
    failInternalValidation(path, 'uncovered_request requires an insufficient verdict');
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
