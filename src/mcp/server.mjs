import { DEFAULT_PROTOCOL_VERSION, getExplorerModel } from '../explorer/config.mjs';
import { exploreRepository, freeExploreRepository } from '../explorer/runtime.mjs';
import {
  EXPLORE_REPO_INPUT_SCHEMA,
  EXPLORE_REPO_OUTPUT_SCHEMA,
  validateExploreRepoArgs,
} from '../explorer/schemas.mjs';
import { globalSessionStore } from '../explorer/session.mjs';
import { redactExploreResult, redactValue } from '../explorer/redact.mjs';
import { StdioJsonRpcServer } from './jsonrpc-stdio.mjs';

const SERVER_INFO = {
  name: 'cerebras-explorer-mcp',
  version: '0.4.0',
};

const READ_ONLY_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
});

function readOnlyToolAnnotations(title) {
  return {
    title,
    ...READ_ONLY_TOOL_ANNOTATIONS,
  };
}

// ─── Core tool ────────────────────────────────────────────────────────────────

const EXPLORE_REPO_TOOL = {
  name: 'explore_repo',
  title: 'Autonomous repository explorer',
  description:
    'Use FIRST for read-only code discovery when the exact files are unknown, the task may span 3+ files, or you need cross-file evidence: ' +
    'architecture, symbol usage, dependency/call tracing, bug root cause, change impact, config origin, or evidence collection. ' +
    'Do NOT use for a single known file/range or when immediate editing is cheaper. ' +
    'Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. ' +
    'After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. ' +
    'Omit budget and hints.strategy unless required by an advanced workflow. Pass sessionId as "session" for follow-up calls.',
  inputSchema: EXPLORE_REPO_INPUT_SCHEMA,
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Autonomous repository explorer'),
};

// ─── Specialized tools (always exposed since spec 011) ─────────────────────

const FIND_RELEVANT_CODE_TOOL = {
  name: 'find_relevant_code',
  title: 'Find relevant code targets',
  description:
    'Use first when you need to locate the files and line ranges relevant to a feature, bug, config, route, or behavior before deciding what to read or edit. ' +
    'Give the natural-language query plus any known anchors. Returns targets and cited evidence; read only returned edit/read targets afterward.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'What code to locate and why.' },
      repo_root: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      knownFiles: { type: 'array', items: { type: 'string' } },
      knownSymbols: { type: 'array', items: { type: 'string' } },
      knownText: { type: 'array', items: { type: 'string' } },
      session: { type: 'string' },
    },
    required: ['query'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Find relevant code targets'),
};

const TRACE_SYMBOL_TOOL = {
  name: 'trace_symbol',
  title: 'Trace a symbol',
  description:
    'Use when a known function, class, variable, or type needs definition plus usage/callsite context. ' +
    'Returns grounded targets and evidence without requiring a manual grep-then-read loop.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      symbol: {
        type: 'string',
        description: 'The symbol name to explain (function, class, variable, type, etc.).',
      },
      repo_root: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      session: { type: 'string', description: 'Optional session ID for continuity.' },
    },
    required: ['symbol'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Trace a symbol'),
};

const MAP_CHANGE_IMPACT_TOOL = {
  name: 'map_change_impact',
  title: 'Map change impact',
  description:
    'Use before editing when you know the intended change but need blast-radius context: likely edit files, callers, tests, config, and risky dependent paths. ' +
    'Do not use for a one-line known-file edit.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      change: { type: 'string', description: 'The intended change or suspected bug fix.' },
      repo_root: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      knownFiles: { type: 'array', items: { type: 'string' } },
      knownSymbols: { type: 'array', items: { type: 'string' } },
      session: { type: 'string' },
    },
    required: ['change'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Map change impact'),
};

const EXPLAIN_CODE_PATH_TOOL = {
  name: 'explain_code_path',
  title: 'Explain a code path',
  description:
    'Use for route, middleware, request, event, job, or CLI flow tracing across files. ' +
    'Returns the verified path through the code and the targets worth reading next.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pathQuery: { type: 'string', description: 'The runtime path or flow to explain.' },
      repo_root: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      entryPoint: { type: 'string' },
      knownFiles: { type: 'array', items: { type: 'string' } },
      knownSymbols: { type: 'array', items: { type: 'string' } },
      session: { type: 'string' },
    },
    required: ['pathQuery'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Explain a code path'),
};

const COLLECT_EVIDENCE_TOOL = {
  name: 'collect_evidence',
  title: 'Collect cited evidence',
  description:
    'Use when you already have a claim, hypothesis, or review point and need a compact bundle of grounded file:line evidence with snippets. ' +
    'Best for verifying facts before replying or reviewing a change.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      claim: { type: 'string', description: 'The claim or hypothesis to verify.' },
      repo_root: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      knownFiles: { type: 'array', items: { type: 'string' } },
      knownSymbols: { type: 'array', items: { type: 'string' } },
      knownText: { type: 'array', items: { type: 'string' } },
      session: { type: 'string' },
    },
    required: ['claim'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Collect cited evidence'),
};

const REVIEW_CHANGE_CONTEXT_TOOL = {
  name: 'review_change_context',
  title: 'Review change context',
  description:
    'Use for PR/review preparation or recent-change analysis when you need what changed, why it matters, and which files deserve review attention. ' +
    'Combines git-guided discovery with grounded code evidence.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reviewGoal: { type: 'string', description: 'What to review or validate.' },
      since: { type: 'string' },
      until: { type: 'string' },
      path: { type: 'string' },
      repo_root: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      session: { type: 'string' },
    },
    required: ['reviewGoal'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Review change context'),
};

const MAP_IMPACT_TOOL = {
  name: 'map_impact',
  title: 'Map impact from anchor',
  description:
    'Use when the parent already knows the specific anchor (a file path or symbol name) that is about to change and wants a deeper dependency chain plus test/config blast radius. ' +
    'Differs from map_change_impact: this tool puts the anchor in front and runs a deeper reference chase; map_change_impact takes a natural-language change description.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      anchor: {
        type: 'string',
        description: 'A file path (e.g. "src/auth.js") or a symbol name (e.g. "requireAuth") that will change.',
      },
      changeType: {
        type: 'string',
        enum: ['rename', 'refactor', 'remove', 'add'],
        description: 'Optional. The intended kind of change so the task statement reflects it (e.g. callers matter more for "remove").',
      },
      repo_root: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      knownFiles: { type: 'array', items: { type: 'string' } },
      knownSymbols: { type: 'array', items: { type: 'string' } },
      session: { type: 'string' },
    },
    required: ['anchor'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Map impact from anchor'),
};

const FIND_ENTRYPOINTS_TOOL = {
  name: 'find_entrypoints',
  title: 'Find entry points',
  description:
    'Use to surface where execution starts in a repository: HTTP routes, CLI commands, cron handlers, MCP tools, or event handlers. ' +
    'Faster than running find_relevant_code with manual regex hints. Detection is regex-based and may include false positives — verify cited lines before acting.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      entryKind: {
        type: 'string',
        enum: ['http', 'cli', 'cron', 'mcp', 'event', 'all'],
        description: 'Optional. Restrict detection to one entry kind. Defaults to "all".',
      },
      repo_root: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      session: { type: 'string' },
    },
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Find entry points'),
};

// ─── Phase 5: Free-form explore tool (beta) ───────────────────────────────

const EXPLORE_TOOL = {
  name: 'explore',
  title: 'Free-form repository exploration',
  description:
    'Use for a user-facing Markdown investigation report with inline file:line citations. ' +
    'Best for architecture walkthroughs, onboarding explanations, code review context, or broad "how does X work?" answers. ' +
    'Do NOT use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead. ' +
    'Omit thoroughness in normal agent use unless an advanced workflow explicitly requires quick, normal, or deep.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'What to explore — a natural-language question or task.' },
      thoroughness: { type: 'string', enum: ['quick', 'normal', 'deep'], description: 'Advanced only. Omit for normal agent use; defaults to normal report depth.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'Optional path prefixes to focus on.' },
      repo_root: { type: 'string', description: 'Repository root path.' },
      session: { type: 'string', description: 'Session ID from a previous call.' },
      language: { type: 'string', description: 'BCP-47 language tag for the report (e.g. "ko", "en").' },
      context: { type: 'string', description: 'Optional additional context from the parent agent.' },
    },
    required: ['prompt'],
  },
  annotations: readOnlyToolAnnotations('Free-form repository exploration'),
};

// ─── Tool registry ─────────────────────────────────────────────────────────

function buildToolList() {
  return [
    FIND_RELEVANT_CODE_TOOL,
    TRACE_SYMBOL_TOOL,
    MAP_CHANGE_IMPACT_TOOL,
    MAP_IMPACT_TOOL,
    EXPLAIN_CODE_PATH_TOOL,
    COLLECT_EVIDENCE_TOOL,
    REVIEW_CHANGE_CONTEXT_TOOL,
    FIND_ENTRYPOINTS_TOOL,
    EXPLORE_REPO_TOOL,
    EXPLORE_TOOL,
  ];
}

// ─── Specialized tool task builders ────────────────────────────────────────

function cleanStringArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
}

function makeInvalidArgsError(message) {
  return Object.assign(new Error(message), { code: -32602 });
}

function validatePublicToolArgs(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw makeInvalidArgsError(`${tool.name} arguments must be an object.`);
  }
  const properties = tool.inputSchema?.properties ?? {};
  const allowedKeys = new Set(Object.keys(properties));
  for (const key of Object.keys(args)) {
    if (!allowedKeys.has(key)) {
      throw makeInvalidArgsError(`Unknown ${tool.name} argument: ${key}`);
    }
  }
  for (const [key, schema] of Object.entries(properties)) {
    const value = args[key];
    if (value === undefined) continue;
    if (schema.type === 'string' && typeof value !== 'string') {
      throw makeInvalidArgsError(`${tool.name}.${key} must be a string when provided.`);
    }
    if (schema.type === 'array') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw makeInvalidArgsError(`${tool.name}.${key} must be an array of strings when provided.`);
      }
    }
    if (schema.enum && !schema.enum.includes(value)) {
      throw makeInvalidArgsError(`${tool.name}.${key} must be one of: ${schema.enum.join(', ')}.`);
    }
  }
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAnchorHints({ knownFiles, knownSymbols, knownText, strategy } = {}) {
  const hints = {};
  const files = cleanStringArray(knownFiles);
  const symbols = cleanStringArray(knownSymbols);
  const regex = cleanStringArray(knownText).map(escapeRegexLiteral);
  if (files.length > 0) hints.files = files;
  if (symbols.length > 0) hints.symbols = symbols;
  if (regex.length > 0) hints.regex = regex;
  if (strategy) hints.strategy = strategy;
  return Object.keys(hints).length > 0 ? hints : undefined;
}

function buildTraceSymbolArgs(args) {
  const { symbol, repo_root, scope, session } = args;
  if (!symbol || typeof symbol !== 'string' || !symbol.trim()) {
    throw makeInvalidArgsError('trace_symbol requires a non-empty "symbol" argument.');
  }
  const task = `Explain the symbol "${symbol.trim()}": where it is defined, what it does, its parameters/return type if applicable, and where it is called or used in the codebase.`;
  return {
    task, repo_root, scope, session,
    taskMode: 'symbol_trace',
    hints: { symbols: [symbol.trim()], strategy: 'symbol-first' },
  };
}

function buildFindRelevantCodeArgs(args) {
  const { query, repo_root, scope, knownFiles, knownSymbols, knownText, session } = args;
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw makeInvalidArgsError('find_relevant_code requires a non-empty "query" argument.');
  }
  const task = `Find the code most relevant to this task and return the smallest useful read/edit targets: ${query.trim()}.`;
  return {
    task,
    repo_root,
    scope,
    session,
    taskMode: 'locate',
    hints: buildAnchorHints({ knownFiles, knownSymbols, knownText }),
  };
}

function buildMapChangeImpactArgs(args) {
  const { change, repo_root, scope, knownFiles, knownSymbols, session } = args;
  if (!change || typeof change !== 'string' || !change.trim()) {
    throw makeInvalidArgsError('map_change_impact requires a non-empty "change" argument.');
  }
  const task = `Map the likely impact of this intended change before editing: ${change.trim()}. Identify likely edit targets, read targets, callers, tests, configuration, and risky dependent paths.`;
  return {
    task,
    repo_root,
    scope,
    session,
    taskMode: 'edit_planning',
    hints: buildAnchorHints({ knownFiles, knownSymbols, strategy: 'reference-chase' }),
  };
}

function buildExplainCodePathArgs(args) {
  const { pathQuery, repo_root, scope, entryPoint, knownFiles, knownSymbols, session } = args;
  if (!pathQuery || typeof pathQuery !== 'string' || !pathQuery.trim()) {
    throw makeInvalidArgsError('explain_code_path requires a non-empty "pathQuery" argument.');
  }
  const files = [...cleanStringArray(knownFiles)];
  if (typeof entryPoint === 'string' && entryPoint.trim()) files.unshift(entryPoint.trim());
  const task = `Explain this code path across files with grounded citations: ${pathQuery.trim()}. Include the entry point, handoff points, and next read targets.`;
  return {
    task,
    repo_root,
    scope,
    session,
    taskMode: 'path_explanation',
    hints: buildAnchorHints({ knownFiles: files, knownSymbols, strategy: 'reference-chase' }),
  };
}

function buildCollectEvidenceArgs(args) {
  const { claim, repo_root, scope, knownFiles, knownSymbols, knownText, session } = args;
  if (!claim || typeof claim !== 'string' || !claim.trim()) {
    throw makeInvalidArgsError('collect_evidence requires a non-empty "claim" argument.');
  }
  const task = `Verify this claim and collect a compact evidence bundle with snippets: ${claim.trim()}. Mark uncertainties and avoid unsupported facts.`;
  return {
    task,
    repo_root,
    scope,
    session,
    taskMode: 'evidence_verification',
    hints: buildAnchorHints({ knownFiles, knownSymbols, knownText }),
  };
}

function buildReviewChangeContextArgs(args) {
  const { reviewGoal, since, until, path: filePath, repo_root, scope, session } = args;
  if (!reviewGoal || typeof reviewGoal !== 'string' || !reviewGoal.trim()) {
    throw makeInvalidArgsError('review_change_context requires a non-empty "reviewGoal" argument.');
  }
  const sincePart = since ? ` since "${since}"` : '';
  const untilPart = until ? ` until "${until}"` : '';
  const pathPart = filePath ? ` for path "${filePath}"` : '';
  const task = `Review change context${sincePart}${untilPart}${pathPart}: ${reviewGoal.trim()}. Summarize what changed, why it matters, likely review risks, and grounded read targets.`;
  return {
    task,
    repo_root,
    scope,
    session,
    taskMode: 'change_review',
    hints: buildAnchorHints({ knownFiles: filePath ? [filePath] : [], strategy: 'git-guided' }),
  };
}

function looksLikeFilePath(value) {
  if (typeof value !== 'string') return false;
  return value.includes('/') || value.includes('\\') || /\.[a-zA-Z0-9]{1,8}$/.test(value);
}

function buildMapImpactArgs(args) {
  const { anchor, changeType, repo_root, scope, knownFiles, knownSymbols, session } = args;
  if (!anchor || typeof anchor !== 'string' || !anchor.trim()) {
    throw makeInvalidArgsError('map_impact requires a non-empty "anchor" argument (file path or symbol name).');
  }
  const anchorTrimmed = anchor.trim();
  const anchorIsFile = looksLikeFilePath(anchorTrimmed);
  const mergedFiles = [...cleanStringArray(knownFiles)];
  const mergedSymbols = [...cleanStringArray(knownSymbols)];
  if (anchorIsFile) {
    if (!mergedFiles.includes(anchorTrimmed)) mergedFiles.unshift(anchorTrimmed);
  } else if (!mergedSymbols.includes(anchorTrimmed)) {
    mergedSymbols.unshift(anchorTrimmed);
  }
  const changeKind = typeof changeType === 'string' && changeType.trim() ? changeType.trim() : null;
  const changeClause = changeKind
    ? `Intended ${changeKind} of anchor "${anchorTrimmed}".`
    : `Anchor: "${anchorTrimmed}".`;
  const task = `${changeClause} Trace the deep dependency chain from this anchor: which other files import or call it, which tests cover it, and which configuration entries reference it. Return likely edit/read/test/config targets with cited evidence so the parent agent can plan the change.`;
  return {
    task,
    repo_root,
    scope,
    session,
    taskMode: 'impact_analysis',
    hints: buildAnchorHints({ knownFiles: mergedFiles, knownSymbols: mergedSymbols, strategy: 'reference-chase' }),
  };
}

const ENTRY_POINT_REGEX_BY_KIND = {
  http: [
    '\\bapp\\.(get|post|put|delete|patch)\\s*\\(',
    '\\brouter\\.(get|post|put|delete|patch)\\s*\\(',
    '@app\\.route\\s*\\(',
    '@(Get|Post|Put|Delete|Patch)\\s*\\(',
    '\\bhttp\\.HandleFunc\\s*\\(',
    '\\b(?:r|mux|chi)\\.(Get|Post|Put|Delete|Patch)\\s*\\(',
    '@\\w+\\.(get|post|put|delete|patch)\\s*\\(',
  ],
  cli: [
    '\\bprogram\\.command\\s*\\(',
    '\\b\\.argument\\s*\\(',
    '@click\\.command\\s*\\(',
    '\\bargparse\\.ArgumentParser\\s*\\(',
    '\\bcobra\\.Command\\b',
    '\\bprocess\\.argv\\b',
  ],
  cron: [
    '\\bcron\\.schedule\\s*\\(',
    '\\bnode-cron\\b',
    '\\bsetInterval\\s*\\(',
    '@scheduled\\b',
  ],
  mcp: [
    '\\btools/list\\b',
    '\\bmcpServer\\.tool\\s*\\(',
    '\\bregisterTool\\s*\\(',
  ],
  event: [
    '\\.on\\([\'"]',
    '\\baddEventListener\\s*\\(',
    '\\bEventEmitter\\b',
    '\\.emit\\([\'"]',
  ],
};

function buildEntryPointRegexBundle(entryKind) {
  if (entryKind === 'all') {
    const seen = new Set();
    const merged = [];
    for (const kind of Object.keys(ENTRY_POINT_REGEX_BY_KIND)) {
      for (const pattern of ENTRY_POINT_REGEX_BY_KIND[kind]) {
        if (!seen.has(pattern)) {
          seen.add(pattern);
          merged.push(pattern);
        }
      }
    }
    return merged;
  }
  return ENTRY_POINT_REGEX_BY_KIND[entryKind] ?? [];
}

function buildFindEntrypointsArgs(args) {
  const { entryKind = 'all', repo_root, scope, session } = args;
  const kindDescriptionByKind = {
    http: 'HTTP routes only',
    cli: 'CLI commands only',
    cron: 'cron/schedule handlers only',
    mcp: 'MCP tool registrations only',
    event: 'event handlers only',
    all: 'all entry kinds (HTTP routes, CLI commands, cron/schedule handlers, MCP tool registrations, event handlers)',
  };
  const kindDescription = kindDescriptionByKind[entryKind] ?? kindDescriptionByKind.all;
  const task = `Find ${kindDescription} in this repository. Report grounded file:line evidence for each entry point and group targets by entry kind in the directAnswer. Entry-point detection is regex-based, so flag each cited line as something the parent agent should verify before acting (mention this caveat in the report once).`;
  const regex = buildEntryPointRegexBundle(entryKind);
  const hints = { strategy: 'auto' };
  if (regex.length > 0) hints.regex = regex;
  return {
    task,
    repo_root,
    scope,
    session,
    taskMode: 'entry_point_discovery',
    hints,
  };
}

// ─── Request handler ────────────────────────────────────────────────────────

export function createMcpRequestHandler({
  logger = () => {},
  runtimeOptions = {},
  sendNotification = null,
  sessionStore = globalSessionStore,
} = {}) {
  let negotiatedProtocolVersion = DEFAULT_PROTOCOL_VERSION;

  // Track active explorations for abort support
  const activeAbortControllers = new Map(); // requestId → AbortController

  /**
   * Build an onProgress callback that fires MCP notifications/progress when
   * `progressToken` is present and `sendNotification` is wired up.
   */
  function makeProgressCallback(progressToken) {
    if ((progressToken === null || progressToken === undefined) || !sendNotification) return null;
    return ({ progress, total, message }) => {
      try {
        sendNotification('notifications/progress', { progressToken, progress, total, message });
      } catch {
        // Swallow errors — progress notification failure must not abort exploration.
      }
    };
  }

  /**
   * Format explore_repo result as readable text for the parent model.
   * Provides a scannable summary at the top with full JSON in a collapsible block.
   */
  function formatExploreResult(result) {
    const lines = [];

    lines.push(`## Result`);
    lines.push(`Confidence: ${result.status?.confidence ?? 'unknown'}`);
    if (result.status?.verification) lines.push(`Verification: ${result.status.verification}`);
    if (result.evidenceQuality) {
      lines.push(`Evidence Quality: ${result.evidenceQuality.level} (${result.evidenceQuality.exactCount} exact, ${result.evidenceQuality.partialCount} partial, ${result.evidenceQuality.droppedCount} dropped)`);
    }
    if (result.searchCoverage) {
      lines.push(`Search Coverage: ${result.searchCoverage.summary}`);
    }
    if (result.trustSummary) lines.push(`Grounding: ${result.trustSummary}`);
    lines.push('');

    lines.push(`## Answer`);
    lines.push(result.directAnswer || '(no answer)');

    if (result.nextAction?.type && result.nextAction.type !== 'stop') {
      lines.push('');
      lines.push(`## Next Action`);
      lines.push(`${result.nextAction.type}: ${result.nextAction.reason}`);
    }

    if (result.targets?.length > 0) {
      lines.push('');
      lines.push(`## Targets`);
      for (const target of result.targets.slice(0, 12)) {
        const location = target.startLine ? `${target.path}:${target.startLine}-${target.endLine}` : target.path;
        const refs = target.evidenceRefs?.length ? ` (${target.evidenceRefs.join(', ')})` : '';
        lines.push(`- [${target.role}] \`${location}\`${refs} - ${target.reason}`);
      }
      if (result.targets.length > 12) {
        lines.push(`- ... and ${result.targets.length - 12} more targets`);
      }
    }

    if (result.evidence?.length > 0) {
      lines.push('');
      lines.push(`## Evidence (${result.evidence.length} items, confidence: ${result.status?.confidence ?? 'unknown'})`);
      for (const e of result.evidence.slice(0, 10)) {
        const grounding = e.groundingStatus === 'exact' ? '' : ' [partial]';
        const id = e.id ? `${e.id} ` : '';
        lines.push(`- ${id}\`${e.path}:${e.startLine}-${e.endLine}\`${grounding} - ${e.why}`);
        if (e.snippet) {
          lines.push(`  snippet: ${e.snippet.replace(/\n/g, '\n  ')}`);
        }
      }
      if (result.evidence.length > 10) {
        lines.push(`- ... and ${result.evidence.length - 10} more evidence items`);
      }
    }

    if (result.uncertainties?.length > 0) {
      lines.push('');
      lines.push(`## Uncertainty`);
      for (const uncertainty of result.uncertainties) {
        lines.push(`- ${uncertainty}`);
      }
    }

    if (result.sessionId) {
      lines.push('');
      lines.push(`Session: ${result.sessionId} (pass as "session" for follow-up calls)`);
    }

    return lines.join('\n');
  }

  function defaultEvidenceQuality(summary = 'No grounded evidence was retained.', warnings = []) {
    return {
      level: 'low',
      exactCount: 0,
      partialCount: 0,
      droppedCount: 0,
      fileCount: 0,
      warnings: warnings.filter(item => typeof item === 'string').slice(0, 5),
      summary,
    };
  }

  function defaultSearchCoverage(summary = 'No search coverage was recorded.') {
    return {
      scope: [],
      scopeLimited: false,
      filesRead: 0,
      grepCalls: 0,
      listDirCalls: 0,
      symbolCalls: 0,
      toolResultsTruncated: 0,
      stoppedByBudget: false,
      warnings: [],
      summary,
    };
  }

  function buildAgentSession(result) {
    const stats = result.stats ?? result._debug?.stats ?? {};
    const id = result.session?.id ?? result.sessionId ?? stats.sessionId ?? null;
    const status = result.session?.status ?? stats.sessionStatus ?? null;
    const remainingCalls = result.session?.remainingCalls ?? stats.remainingCalls;
    if (!id || !['created', 'reused', 'fallback'].includes(status) || !Number.isInteger(remainingCalls) || remainingCalls < 0) {
      return null;
    }
    return { id, status, remainingCalls };
  }

  function buildHandledFailure({
    category,
    reason,
    message,
    retryTool = 'explore_repo',
    hints = [],
    retryArgs = null,
    expectedImprovement = '',
  }) {
    return {
      schemaVersion: 1,
      directAnswer: '',
      status: {
        confidence: 'low',
        verification: 'broad_search_needed',
        complete: false,
        warnings: [message],
      },
      targets: [],
      evidence: [],
      uncertainties: [message],
      nextAction: { type: 'ask_user', reason: message },
      evidenceQuality: defaultEvidenceQuality(message, [message]),
      searchCoverage: defaultSearchCoverage(message),
      failure: {
        category,
        reason,
        message,
        retry: retryTool ? {
          tool: retryTool,
          hints,
          ...(retryArgs ? { args: retryArgs } : {}),
          ...(expectedImprovement ? { expectedImprovement } : {}),
        } : null,
      },
      _debug: {},
    };
  }

  function toAgentFacingResult(result) {
    const sessionId = result.sessionId ?? result.stats?.sessionId ?? result._debug?.stats?.sessionId ?? null;
    const session = buildAgentSession(result);
    const debug = { ...(result._debug ?? {}) };
    delete debug.legacy;

    return {
      schemaVersion: result.schemaVersion ?? 1,
      directAnswer: result.directAnswer || '',
      status: result.status ?? {
        confidence: 'low',
        verification: 'broad_search_needed',
        complete: false,
        warnings: [],
      },
      targets: Array.isArray(result.targets) ? result.targets : [],
      discoveredPaths: Array.isArray(result.discoveredPaths) ? result.discoveredPaths : [],
      evidence: Array.isArray(result.evidence) ? result.evidence : [],
      uncertainties: Array.isArray(result.uncertainties) ? result.uncertainties : [],
      nextAction: result.nextAction ?? { type: 'stop', reason: '' },
      evidenceQuality: result.evidenceQuality ?? defaultEvidenceQuality(result.trustSummary),
      searchCoverage: result.searchCoverage ?? defaultSearchCoverage(),
      failure: result.failure ?? null,
      ...(sessionId ? { sessionId } : {}),
      ...(session ? { session } : {}),
      _debug: debug,
    };
  }

  async function callTool(exploreArgs, progressToken, requestId) {
    const abortController = new AbortController();
    if (requestId) activeAbortControllers.set(requestId, abortController);
    try {
      const result = await exploreRepository(exploreArgs, {
        logger,
        ...runtimeOptions,
        onProgress: makeProgressCallback(progressToken),
        sessionStore,
        abortSignal: abortController.signal,
      });
      const agentResult = redactExploreResult(toAgentFacingResult(result)).value;
      return {
        content: [{ type: 'text', text: formatExploreResult(agentResult) }],
        structuredContent: agentResult,
      };
    } finally {
      if (requestId) activeAbortControllers.delete(requestId);
    }
  }

  async function callFreeExploreTool(exploreArgs, progressToken, requestId) {
    const abortController = new AbortController();
    if (requestId) activeAbortControllers.set(requestId, abortController);
    try {
      const result = await freeExploreRepository(exploreArgs, {
        logger,
        ...runtimeOptions,
        onProgress: makeProgressCallback(progressToken),
        sessionStore,
        abortSignal: abortController.signal,
      });
      const safeResult = redactValue(result).value;
      return {
        content: [{ type: 'text', text: safeResult.report }],
        structuredContent: safeResult,
      };
    } finally {
      if (requestId) activeAbortControllers.delete(requestId);
    }
  }

  async function handleRequest(message) {
    switch (message.method) {
      case 'initialize': {
        const requestedVersion = message.params?.protocolVersion;
        if (typeof requestedVersion === 'string' && requestedVersion.trim()) {
          negotiatedProtocolVersion = requestedVersion;
        }
        const toolCount = buildToolList().length;
        return {
          protocolVersion: negotiatedProtocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            `Cerebras Explorer provides autonomous codebase exploration (${toolCount} tools, powered by ${getExplorerModel()}). ` +
            'PREFER these tools over manual file search (Grep/Glob/Read) for any task that spans more than 2-3 files or requires cross-file understanding. ' +
            'explore_repo returns structured JSON with directAnswer, status, targets, discoveredPaths, and grounded evidence snippets; explore returns a Markdown report for human consumption. ' +
            'Purpose shortcuts: find_relevant_code, trace_symbol, map_change_impact, map_impact, explain_code_path, collect_evidence, review_change_context, find_entrypoints. ' +
            'All tools accept a "session" parameter for multi-call continuity — pass sessionId from one call to the next. ' +
            'Pass _meta.progressToken for heavy calls (broad reports / path / impact) to receive turn-by-turn progress updates. ' +
            'When summarizing or handing off a result to another agent, preserve these control-plane fields verbatim: ' +
            'status.verification, status.complete, evidenceQuality, searchCoverage, failure, session/sessionId, and any critic.warnings.',
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: buildToolList() };
      case 'tools/call': {
        const name = message.params?.name;
        const args = message.params?.arguments ?? {};
        const progressToken = message.params?._meta?.progressToken ?? null;
        const requestId = message.id ?? null;
        const exposedToolNames = new Set(buildToolList().map(tool => tool.name));

        try {
          if (!exposedToolNames.has(name)) {
            const error = new Error(`Unknown tool: ${name}`);
            error.code = -32601;
            throw error;
          }

          if (name === 'explore_repo') {
            validateExploreRepoArgs(args);
            return await callTool(args, progressToken, requestId);
          }
          if (name === 'find_relevant_code') {
            validatePublicToolArgs(FIND_RELEVANT_CODE_TOOL, args);
            return await callTool(buildFindRelevantCodeArgs(args), progressToken, requestId);
          }
          if (name === 'trace_symbol') {
            validatePublicToolArgs(TRACE_SYMBOL_TOOL, args);
            return await callTool(buildTraceSymbolArgs(args), progressToken, requestId);
          }
          if (name === 'map_change_impact') {
            validatePublicToolArgs(MAP_CHANGE_IMPACT_TOOL, args);
            return await callTool(buildMapChangeImpactArgs(args), progressToken, requestId);
          }
          if (name === 'map_impact') {
            validatePublicToolArgs(MAP_IMPACT_TOOL, args);
            return await callTool(buildMapImpactArgs(args), progressToken, requestId);
          }
          if (name === 'explain_code_path') {
            validatePublicToolArgs(EXPLAIN_CODE_PATH_TOOL, args);
            return await callTool(buildExplainCodePathArgs(args), progressToken, requestId);
          }
          if (name === 'collect_evidence') {
            validatePublicToolArgs(COLLECT_EVIDENCE_TOOL, args);
            return await callTool(buildCollectEvidenceArgs(args), progressToken, requestId);
          }
          if (name === 'review_change_context') {
            validatePublicToolArgs(REVIEW_CHANGE_CONTEXT_TOOL, args);
            return await callTool(buildReviewChangeContextArgs(args), progressToken, requestId);
          }
          if (name === 'find_entrypoints') {
            validatePublicToolArgs(FIND_ENTRYPOINTS_TOOL, args);
            return await callTool(buildFindEntrypointsArgs(args), progressToken, requestId);
          }
          if (name === 'explore') {
            validatePublicToolArgs(EXPLORE_TOOL, args);
            return await callFreeExploreTool(args, progressToken, requestId);
          }

          // Unreachable: all exposed tool names are handled above.
          // If a new tool is added to buildToolList() but not dispatched here,
          // this safeguard surfaces the oversight as an error.
          const error = new Error(`Tool "${name}" is listed but has no handler.`);
          error.code = -32603;
          throw error;
        } catch (error) {
          if (error.repoRootError) {
            const message = `Unable to resolve repo_root for ${name}: ${error.message}`;
            return {
              isError: true,
              content: [{ type: 'text', text: message }],
              structuredContent: buildHandledFailure({
                category: 'input',
                reason: 'repo_mismatch',
                message,
                retryTool: null,
              }),
            };
          }
          if (error.code === -32602) {
            const message = `Invalid arguments for ${name}: ${error.message}`;
            const reason = error.sessionError === 'repo_mismatch'
              ? 'repo_mismatch'
              : error.sessionError === 'invalid_session'
                ? 'invalid_session'
                : 'invalid_arguments';
            return {
              isError: true,
              content: [{ type: 'text', text: message }],
              structuredContent: buildHandledFailure({
                category: 'input',
                reason,
                message,
                retryTool: reason === 'invalid_session' ? 'explore_repo' : null,
                hints: reason === 'invalid_session'
                  ? ['Drop the stale session id and retry with the current repo root.']
                  : [],
              }),
            };
          }
          if (exposedToolNames.has(name)) {
            const message = `${name} execution failed: ${error.message}`;
            const retryScope = Array.isArray(args?.scope)
              ? args.scope.filter(item => typeof item === 'string').slice(0, 8)
              : [];
            return {
              isError: true,
              content: [{ type: 'text', text: message }],
              structuredContent: buildHandledFailure({
                category: 'provider',
                reason: 'provider_error',
                message,
                retryTool: name === 'explore' ? 'explore' : 'explore_repo',
                hints: ['Retry after the provider recovers, or narrow the task and scope.'],
                retryArgs: {
                  task: 'Retry after the provider recovers, or narrow the task and scope.',
                  scope: retryScope,
                },
                expectedImprovement: 'A provider recovery or narrower scope should reduce failure risk.',
              }),
            };
          }
          throw error;
        }
      }
      default: {
        const error = new Error(`Method not found: ${message.method}`);
        error.code = -32601;
        throw error;
      }
    }
  }

  async function handleNotification(message) {
    if (message.method === 'notifications/initialized') {
      return;
    }
    if (message.method === 'notifications/cancelled') {
      const requestId = message.params?.requestId;
      if (requestId) {
        const controller = activeAbortControllers.get(requestId);
        if (controller) {
          controller.abort();
          activeAbortControllers.delete(requestId);
          logger(`Cancelled exploration for request ${requestId}`);
        }
      }
      return;
    }
    logger(`Ignoring notification: ${message.method}`);
  }

  return { handleRequest, handleNotification };
}

export function startMcpServer({ logger = () => {}, runtimeOptions = {} } = {}) {
  // Use a lazy-binding closure so that sendNotification can reference `transport`
  // before it is assigned (transport is created after the handler).
  let transport;

  const { handleRequest, handleNotification } = createMcpRequestHandler({
    logger,
    runtimeOptions,
    sendNotification: (method, params) => transport?.sendNotification(method, params),
  });

  transport = new StdioJsonRpcServer({ logger, handleRequest, handleNotification });
  transport.start();
  return transport;
}
