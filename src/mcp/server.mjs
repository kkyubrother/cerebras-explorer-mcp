import { DEFAULT_PROTOCOL_VERSION, getExplorerModel, isTruthyEnv } from '../explorer/config.mjs';
import { exploreRepository, freeExploreRepository, freeExploreRepositoryV2 } from '../explorer/runtime.mjs';
import {
  EXPLORE_REPO_INPUT_SCHEMA,
  EXPLORE_REPO_OUTPUT_SCHEMA,
  validateExploreRepoArgs,
} from '../explorer/schemas.mjs';
import { globalSessionStore } from '../explorer/session.mjs';
import { StdioJsonRpcServer } from './jsonrpc-stdio.mjs';

const SERVER_INFO = {
  name: 'cerebras-explorer-mcp',
  version: '0.1.0',
};

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
    'Omit budget and hints.strategy unless required by a legacy workflow. Pass sessionId as "session" for follow-up calls.',
  inputSchema: EXPLORE_REPO_INPUT_SCHEMA,
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
};

// ─── Specialized tools (exposed when CEREBRAS_EXPLORER_EXTRA_TOOLS != false) ─

const EXPLAIN_SYMBOL_TOOL = {
  name: 'explain_symbol',
  title: 'Explain a code symbol',
  description:
    'Use this when you encounter an unfamiliar function, class, variable, or type and need to quickly understand its purpose, parameters, return type, and usage patterns across the codebase. ' +
    'Returns where the symbol is defined, what it does, and all call sites. Faster than manual grep-then-read workflows.',
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
      language: { type: 'string', description: 'BCP-47 language tag for the response (e.g. "ko", "en"). Defaults to auto-detect.' },
      context: { type: 'string', description: 'Optional additional context from the parent agent to guide exploration.' },
    },
    required: ['symbol'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
};

const TRACE_DEPENDENCY_TOOL = {
  name: 'trace_dependency',
  title: 'Trace module dependency chain',
  description:
    'Use this when you need to understand the import/dependency graph of a file — what it imports (downstream) and what imports it (upstream). ' +
    'Essential for refactoring, understanding coupling, or assessing the blast radius of a change. Faster than manually tracing imports across files.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      entryPoint: {
        type: 'string',
        description: 'Path to the starting file (relative to repo root).',
      },
      direction: {
        type: 'string',
        enum: ['downstream', 'upstream', 'both'],
        description: 'downstream = what this file imports; upstream = what imports this file; both = full graph.',
      },
      repo_root: { type: 'string' },
      session: { type: 'string' },
      language: { type: 'string', description: 'BCP-47 language tag for the response (e.g. "ko", "en"). Defaults to auto-detect.' },
      context: { type: 'string', description: 'Optional additional context from the parent agent to guide exploration.' },
    },
    required: ['entryPoint'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
};

const SUMMARIZE_CHANGES_TOOL = {
  name: 'summarize_changes',
  title: 'Summarize recent code changes',
  description:
    'Use this when you need to understand what changed recently in the codebase — after a merge, before a release, or to catch up on recent work. ' +
    'Analyzes git history in a given time range or branch and returns what files changed, key modifications, and the intent behind the changes.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      since: { type: 'string', description: "Time reference: '1 week ago', a commit hash, or a branch name." },
      until: { type: 'string' },
      path: { type: 'string' },
      repo_root: { type: 'string' },
      session: { type: 'string' },
      language: { type: 'string', description: 'BCP-47 language tag for the response (e.g. "ko", "en"). Defaults to auto-detect.' },
      context: { type: 'string', description: 'Optional additional context from the parent agent to guide exploration.' },
    },
    required: [],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
};

const FIND_SIMILAR_CODE_TOOL = {
  name: 'find_similar_code',
  title: 'Find similar code patterns',
  description:
    'Use this when you suspect duplicated logic, want to find all places that follow (or violate) a pattern, or need to locate code similar to a reference snippet or file. ' +
    'Scans the codebase using natural-language reasoning to find structural similarities — more flexible than regex search.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reference: { type: 'string', description: 'A file path or short code snippet to use as the reference.' },
      startLine: { type: 'number' },
      endLine: { type: 'number' },
      scope: { type: 'array', items: { type: 'string' } },
      repo_root: { type: 'string' },
      session: { type: 'string' },
      language: { type: 'string', description: 'BCP-47 language tag for the response (e.g. "ko", "en"). Defaults to auto-detect.' },
      context: { type: 'string', description: 'Optional additional context from the parent agent to guide exploration.' },
    },
    required: ['reference'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
};

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
      language: { type: 'string' },
      context: { type: 'string' },
    },
    required: ['query'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
};

const TRACE_SYMBOL_TOOL = {
  name: 'trace_symbol',
  title: 'Trace a symbol',
  description:
    'Use when a known function, class, variable, or type needs definition plus usage/callsite context. ' +
    'Purpose-oriented alias for explain_symbol; returns grounded targets and evidence.',
  inputSchema: EXPLAIN_SYMBOL_TOOL.inputSchema,
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
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
      language: { type: 'string' },
      context: { type: 'string' },
    },
    required: ['change'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
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
      language: { type: 'string' },
      context: { type: 'string' },
    },
    required: ['pathQuery'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
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
      language: { type: 'string' },
      context: { type: 'string' },
    },
    required: ['claim'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
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
      language: { type: 'string' },
      context: { type: 'string' },
    },
    required: ['reviewGoal'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
};

// ─── Phase 5: Free-form explore tool (beta) ───────────────────────────────

const EXPLORE_TOOL = {
  name: 'explore',
  title: 'Free-form repository exploration',
  description:
    'Use for a user-facing Markdown investigation report with inline file:line citations. ' +
    'Best for architecture walkthroughs, onboarding explanations, code review context, or broad "how does X work?" answers. ' +
    'Do NOT use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead. ' +
    'Omit thoroughness in normal agent use unless a legacy workflow explicitly requires quick, normal, or deep.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'What to explore — a natural-language question or task.' },
      thoroughness: { type: 'string', enum: ['quick', 'normal', 'deep'], description: 'Advanced/legacy only. Omit for normal agent use; defaults to normal report depth.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'Optional path prefixes to focus on.' },
      repo_root: { type: 'string', description: 'Repository root path.' },
      session: { type: 'string', description: 'Session ID from a previous call.' },
      language: { type: 'string', description: 'BCP-47 language tag for the report (e.g. "ko", "en").' },
      context: { type: 'string', description: 'Optional additional context from the parent agent.' },
    },
    required: ['prompt'],
  },
};

// ─── V2 enhanced explore tool ────────────────────────────────────────────────

const EXPLORE_V2_TOOL = {
  name: 'explore_v2',
  title: 'Advanced repository exploration (V2)',
  description:
    'Advanced/legacy report tool. Use only for wide or deep Markdown reports that may exceed normal context or output limits. ' +
    'Best for large architecture deep-dives, end-to-end root-cause reports, or broad subsystem maps. ' +
    'Do NOT use just because the file path is unknown; prefer explore_repo when structured evidence, likely edit files, or next read targets are needed.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'What to explore — a natural-language question or task. Be specific for best results.' },
      thoroughness: { type: 'string', enum: ['quick', 'normal', 'deep'], description: 'Advanced/legacy only. Omit for normal agent use; defaults to normal report depth.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'Path prefixes to focus on (e.g. ["src/api/", "lib/auth/"]).' },
      repo_root: { type: 'string', description: 'Repository root path.' },
      session: { type: 'string', description: 'Session ID from a previous call for continuity.' },
      language: { type: 'string', description: 'BCP-47 language tag for the report (e.g. "ko", "en").' },
      context: { type: 'string', description: 'Additional context from the parent agent to guide exploration.' },
    },
    required: ['prompt'],
  },
};

function exploreToolEnabled() {
  const v = process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE;
  if (v === undefined || v === null) return true;
  return isTruthyEnv(v);
}

function exploreV2ToolEnabled() {
  if (!exploreToolEnabled()) return false;
  const v = process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2;
  if (v === undefined || v === null) return false;
  return isTruthyEnv(v);
}

function shouldUseV2ForExplore(args) {
  const prompt = String(args?.prompt ?? '').toLowerCase();
  return args?.thoroughness === 'deep' ||
    /deep dive|comprehensive|entire codebase|large architecture|end-to-end|전체|대규모|심층/.test(prompt);
}

// ─── Tool registry ─────────────────────────────────────────────────────────

function extraToolsEnabled() {
  const v = process.env.CEREBRAS_EXPLORER_EXTRA_TOOLS;
  if (v === undefined || v === null) return true;
  return isTruthyEnv(v);
}

function legacyToolsEnabled() {
  return isTruthyEnv(process.env.CEREBRAS_EXPLORER_LEGACY_TOOLS);
}

function buildToolList() {
  const tools = [];
  if (extraToolsEnabled()) {
    tools.push(
      FIND_RELEVANT_CODE_TOOL,
      TRACE_SYMBOL_TOOL,
      MAP_CHANGE_IMPACT_TOOL,
      EXPLAIN_CODE_PATH_TOOL,
      COLLECT_EVIDENCE_TOOL,
      REVIEW_CHANGE_CONTEXT_TOOL,
    );
  }
  tools.push(EXPLORE_REPO_TOOL);
  if (legacyToolsEnabled()) {
    tools.push(
      EXPLAIN_SYMBOL_TOOL,
      TRACE_DEPENDENCY_TOOL,
      SUMMARIZE_CHANGES_TOOL,
      FIND_SIMILAR_CODE_TOOL,
    );
  }
  if (exploreToolEnabled()) {
    tools.push(EXPLORE_TOOL);
  }
  if (exploreV2ToolEnabled()) {
    tools.push(EXPLORE_V2_TOOL);
  }
  return tools;
}

// ─── Specialized tool task builders ────────────────────────────────────────

function cleanStringArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
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

function buildExplainSymbolArgs(args) {
  const { symbol, repo_root, scope, session, language, context } = args;
  if (!symbol || typeof symbol !== 'string' || !symbol.trim()) {
    throw Object.assign(new Error('explain_symbol requires a non-empty "symbol" argument.'), { code: -32602 });
  }
  let task = `Explain the symbol "${symbol.trim()}": where it is defined, what it does, its parameters/return type if applicable, and where it is called or used in the codebase.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task, repo_root, scope, session, language,
    hints: { symbols: [symbol.trim()], strategy: 'symbol-first' },
  };
}

function buildTraceDependencyArgs(args) {
  const { entryPoint, direction = 'both', repo_root, session, language, context } = args;
  if (!entryPoint || typeof entryPoint !== 'string' || !entryPoint.trim()) {
    throw Object.assign(new Error('trace_dependency requires a non-empty "entryPoint" argument.'), { code: -32602 });
  }
  let task = `Trace the import/dependency chain of "${entryPoint.trim()}". Direction: ${direction}. List which modules are imported and which modules import this file.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task, repo_root, session, language,
    hints: { files: [entryPoint.trim()], strategy: 'reference-chase' },
  };
}

function buildSummarizeChangesArgs(args) {
  const { since, until, path: filePath, repo_root, session, language, context } = args;
  const sincePart = since ? `since "${since}"` : 'in recent history';
  const untilPart = until ? ` until "${until}"` : '';
  const pathPart = filePath ? ` for path: ${filePath}` : '';
  let task = `Summarize the code changes ${sincePart}${untilPart}${pathPart}. Describe what files changed, the key modifications, and the overall intent of the changes.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task, repo_root, session, language,
    hints: { strategy: 'git-guided' },
  };
}

function buildFindSimilarCodeArgs(args) {
  const { reference, startLine, endLine, scope, repo_root, session, language, context } = args;
  if (!reference || typeof reference !== 'string' || !reference.trim()) {
    throw Object.assign(new Error('find_similar_code requires a non-empty "reference" argument.'), { code: -32602 });
  }
  const lineNote = startLine && endLine ? ` (lines ${startLine}–${endLine})` : '';
  let task = `Find code patterns similar to "${reference.trim()}"${lineNote} across the codebase.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task, repo_root, scope, session, language,
    hints: { files: [reference.trim()], strategy: 'pattern-scan' },
  };
}

function buildFindRelevantCodeArgs(args) {
  const { query, repo_root, scope, knownFiles, knownSymbols, knownText, session, language, context } = args;
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw Object.assign(new Error('find_relevant_code requires a non-empty "query" argument.'), { code: -32602 });
  }
  let task = `Find the code most relevant to this task and return the smallest useful read/edit targets: ${query.trim()}.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task,
    repo_root,
    scope,
    session,
    language,
    hints: buildAnchorHints({ knownFiles, knownSymbols, knownText }),
  };
}

function buildMapChangeImpactArgs(args) {
  const { change, repo_root, scope, knownFiles, knownSymbols, session, language, context } = args;
  if (!change || typeof change !== 'string' || !change.trim()) {
    throw Object.assign(new Error('map_change_impact requires a non-empty "change" argument.'), { code: -32602 });
  }
  let task = `Map the likely impact of this intended change before editing: ${change.trim()}. Identify likely edit targets, read targets, callers, tests, configuration, and risky dependent paths.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task,
    repo_root,
    scope,
    session,
    language,
    hints: buildAnchorHints({ knownFiles, knownSymbols, strategy: 'reference-chase' }),
  };
}

function buildExplainCodePathArgs(args) {
  const { pathQuery, repo_root, scope, entryPoint, knownFiles, knownSymbols, session, language, context } = args;
  if (!pathQuery || typeof pathQuery !== 'string' || !pathQuery.trim()) {
    throw Object.assign(new Error('explain_code_path requires a non-empty "pathQuery" argument.'), { code: -32602 });
  }
  const files = [...cleanStringArray(knownFiles)];
  if (typeof entryPoint === 'string' && entryPoint.trim()) files.unshift(entryPoint.trim());
  let task = `Explain this code path across files with grounded citations: ${pathQuery.trim()}. Include the entry point, handoff points, and next read targets.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task,
    repo_root,
    scope,
    session,
    language,
    hints: buildAnchorHints({ knownFiles: files, knownSymbols, strategy: 'reference-chase' }),
  };
}

function buildCollectEvidenceArgs(args) {
  const { claim, repo_root, scope, knownFiles, knownSymbols, knownText, session, language, context } = args;
  if (!claim || typeof claim !== 'string' || !claim.trim()) {
    throw Object.assign(new Error('collect_evidence requires a non-empty "claim" argument.'), { code: -32602 });
  }
  let task = `Verify this claim and collect a compact evidence bundle with snippets: ${claim.trim()}. Mark uncertainties and avoid unsupported facts.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task,
    repo_root,
    scope,
    session,
    language,
    hints: buildAnchorHints({ knownFiles, knownSymbols, knownText }),
  };
}

function buildReviewChangeContextArgs(args) {
  const { reviewGoal, since, until, path: filePath, repo_root, scope, session, language, context } = args;
  if (!reviewGoal || typeof reviewGoal !== 'string' || !reviewGoal.trim()) {
    throw Object.assign(new Error('review_change_context requires a non-empty "reviewGoal" argument.'), { code: -32602 });
  }
  const sincePart = since ? ` since "${since}"` : '';
  const untilPart = until ? ` until "${until}"` : '';
  const pathPart = filePath ? ` for path "${filePath}"` : '';
  let task = `Review change context${sincePart}${untilPart}${pathPart}: ${reviewGoal.trim()}. Summarize what changed, why it matters, likely review risks, and grounded read targets.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task,
    repo_root,
    scope,
    session,
    language,
    hints: buildAnchorHints({ knownFiles: filePath ? [filePath] : [], strategy: 'git-guided' }),
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
    lines.push(`Confidence: ${result.status?.confidence ?? result.confidence ?? 'unknown'}`);
    if (result.status?.verification) lines.push(`Verification: ${result.status.verification}`);
    if (result.trustSummary) lines.push(`Grounding: ${result.trustSummary}`);
    lines.push('');

    lines.push(`## Answer`);
    lines.push(result.directAnswer || result.answer || '(no answer)');

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

  function toAgentFacingResult(result) {
    const sessionId = result.sessionId ?? result.stats?.sessionId ?? result._debug?.stats?.sessionId ?? null;
    const legacy = {
      answer: result.answer,
      summary: result.summary,
      candidatePaths: result.candidatePaths,
      followups: result.followups,
      confidence: result.confidence,
      confidenceLevel: result.confidenceLevel,
      critic: result.critic,
      trustSummary: result.trustSummary,
      codeMap: result.codeMap,
      diagram: result.diagram,
      recentActivity: result.recentActivity,
    };
    for (const key of Object.keys(legacy)) {
      if (legacy[key] === undefined) delete legacy[key];
    }

    return {
      directAnswer: result.directAnswer || result.answer || '',
      status: result.status ?? {
        confidence: result.confidence ?? 'low',
        verification: 'broad_search_needed',
        complete: false,
        warnings: [],
      },
      targets: Array.isArray(result.targets) ? result.targets : [],
      evidence: Array.isArray(result.evidence) ? result.evidence : [],
      uncertainties: Array.isArray(result.uncertainties) ? result.uncertainties : [],
      nextAction: result.nextAction ?? { type: 'stop', reason: '' },
      ...(sessionId ? { sessionId } : {}),
      _debug: {
        ...(result._debug ?? {}),
        ...(Object.keys(legacy).length > 0 ? { legacy } : {}),
      },
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
      const agentResult = toAgentFacingResult(result);
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
      const runner = shouldUseV2ForExplore(exploreArgs)
        ? freeExploreRepositoryV2
        : freeExploreRepository;
      const result = await runner(exploreArgs, {
        logger,
        ...runtimeOptions,
        onProgress: makeProgressCallback(progressToken),
        sessionStore,
        abortSignal: abortController.signal,
      });
      return {
        content: [{ type: 'text', text: result.report }],
        structuredContent: result,
      };
    } finally {
      if (requestId) activeAbortControllers.delete(requestId);
    }
  }

  async function callFreeExploreV2Tool(exploreArgs, progressToken, requestId) {
    const abortController = new AbortController();
    if (requestId) activeAbortControllers.set(requestId, abortController);
    try {
      const result = await freeExploreRepositoryV2(exploreArgs, {
        logger,
        ...runtimeOptions,
        onProgress: makeProgressCallback(progressToken),
        sessionStore,
        abortSignal: abortController.signal,
      });
      return {
        content: [{ type: 'text', text: result.report }],
        structuredContent: result,
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
        const legacySentence = legacyToolsEnabled()
          ? 'Legacy shortcuts enabled: explain_symbol, trace_dependency, summarize_changes, find_similar_code. '
          : 'Legacy shortcuts are hidden by default; use purpose shortcuts instead. ';
        return {
          protocolVersion: negotiatedProtocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            `Cerebras Explorer provides autonomous codebase exploration (${toolCount} tools, powered by ${getExplorerModel()}). ` +
            'PREFER these tools over manual file search (Grep/Glob/Read) for any task that spans more than 2-3 files or requires cross-file understanding. ' +
            'explore_repo returns structured JSON with directAnswer, status, targets, and grounded evidence snippets; explore returns a Markdown report for human consumption. ' +
            'Purpose shortcuts: find_relevant_code, trace_symbol, map_change_impact, explain_code_path, collect_evidence, review_change_context. ' +
            legacySentence +
            'All tools accept a "session" parameter for multi-call continuity — pass sessionId from one call to the next. ' +
            'Pass _meta.progressToken to receive turn-by-turn progress updates.',
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
            return await callTool(buildFindRelevantCodeArgs(args), progressToken, requestId);
          }
          if (name === 'trace_symbol') {
            return await callTool(buildExplainSymbolArgs(args), progressToken, requestId);
          }
          if (name === 'map_change_impact') {
            return await callTool(buildMapChangeImpactArgs(args), progressToken, requestId);
          }
          if (name === 'explain_code_path') {
            return await callTool(buildExplainCodePathArgs(args), progressToken, requestId);
          }
          if (name === 'collect_evidence') {
            return await callTool(buildCollectEvidenceArgs(args), progressToken, requestId);
          }
          if (name === 'review_change_context') {
            return await callTool(buildReviewChangeContextArgs(args), progressToken, requestId);
          }
          if (name === 'explain_symbol') {
            return await callTool(buildExplainSymbolArgs(args), progressToken, requestId);
          }
          if (name === 'trace_dependency') {
            return await callTool(buildTraceDependencyArgs(args), progressToken, requestId);
          }
          if (name === 'summarize_changes') {
            return await callTool(buildSummarizeChangesArgs(args), progressToken, requestId);
          }
          if (name === 'find_similar_code') {
            return await callTool(buildFindSimilarCodeArgs(args), progressToken, requestId);
          }
          if (name === 'explore') {
            return await callFreeExploreTool(args, progressToken, requestId);
          }
          if (name === 'explore_v2') {
            return await callFreeExploreV2Tool(args, progressToken, requestId);
          }

          // Unreachable: all exposed tool names are handled above.
          // If a new tool is added to buildToolList() but not dispatched here,
          // this safeguard surfaces the oversight as an error.
          const error = new Error(`Tool "${name}" is listed but has no handler.`);
          error.code = -32603;
          throw error;
        } catch (error) {
          if (error.repoRootError) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Unable to resolve repo_root for ${name}: ${error.message}` }],
            };
          }
          if (error.code === -32602) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Invalid arguments for ${name}: ${error.message}` }],
            };
          }
          if (exposedToolNames.has(name)) {
            return {
              isError: true,
              content: [{ type: 'text', text: `${name} execution failed: ${error.message}` }],
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
