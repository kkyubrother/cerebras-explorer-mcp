import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_PROTOCOL_VERSION, getExplorerModel } from '../explorer/config.mjs';
import { exploreRepository, freeExploreRepository } from '../explorer/runtime.mjs';
import {
  EXPLORE_REPO_INPUT_SCHEMA,
  EXPLORE_REPO_OUTPUT_SCHEMA,
  validateExploreRepoArgs,
} from '../explorer/schemas.mjs';
import { redactExploreResult, redactValue } from '../explorer/redact.mjs';
import { isTranscriptEnabled, isTranscriptRawMode } from '../explorer/transcript.mjs';
import { StdioJsonRpcServer } from './jsonrpc-stdio.mjs';

const SERVER_INFO = {
  name: 'cerebras-explorer-mcp',
  version: '0.8.3',
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
    'Use as the general fallback for read-only repository exploration when no purpose-specific tool fits, or when you need programmable structured JSON spanning multiple files: ' +
    'architecture, symbol usage, dependency/call tracing, bug root-cause hypotheses, change impact, config origin, or evidence collection. ' +
    'Prefer the specialized tools when intent matches (find_relevant_code to locate code, trace_symbol for a known symbol, map_change_impact for blast radius, explain_code_path for a flow, collect_evidence to verify a claim, review_change_context for PR review). ' +
    'Do not use for edits, running tests/builds, or single known-file inspection. ' +
    'Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. ' +
    'After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. ' +
    'Omit hints.strategy unless required by an advanced workflow.',
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
    'Give the natural-language query plus any known anchors via knownFiles, knownSymbols, or knownText to narrow the search. ' +
    'Do not use when the exact file/range is already known, a single grep would suffice, or a sibling tool fits the intent better (trace_symbol for a known symbol, explain_code_path for a request/event/job flow, map_change_impact for blast radius). ' +
    'Returns targets and cited evidence; read only returned edit/read targets afterward.',
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
    'Returns grounded targets and evidence without requiring a manual grep-then-read loop. ' +
    'Do not use when the symbol is unknown (use find_relevant_code) or you need a runtime flow (use explain_code_path).',
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
    'Coverage of documentation and example fixtures is best-effort; mention docs/examples in the change description if their impact must be included. ' +
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
    'Returns the verified path through the code and the targets worth reading next. ' +
    'Do not use for a single symbol (use trace_symbol) or a static blast-radius map (use map_change_impact).',
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
    'Best for verifying specific facts or a single review point before replying; for whole-PR/diff scoping use review_change_context.',
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
    },
    required: ['reviewGoal'],
  },
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Review change context'),
};

// ─── Phase 5: Free-form explore tool (beta) ───────────────────────────────

const EXPLORE_TOOL = {
  name: 'explore',
  title: 'Free-form repository exploration',
  description:
    'Use for a user-facing Markdown investigation report with inline file:line citations. ' +
    'Best for architecture walkthroughs, onboarding explanations, or broad "how does X work?" answers when polished prose is what the requester needs. ' +
    'For narrow lookups, symbol traces, impact maps, code-path walks, or PR/diff review context, prefer find_relevant_code, trace_symbol, map_change_impact, explain_code_path, or review_change_context — they return the same grounded evidence in their tool-specific shape. ' +
    'Do not use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'What to explore — a natural-language question or task.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'Optional path prefixes to focus on.' },
      repo_root: { type: 'string', description: 'Repository root path.' },
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
    EXPLAIN_CODE_PATH_TOOL,
    COLLECT_EVIDENCE_TOOL,
    REVIEW_CHANGE_CONTEXT_TOOL,
    EXPLORE_REPO_TOOL,
    EXPLORE_TOOL,
  ];
}

let memoizedGitSha;
let memoizedPackageVersion;
let memoizedToolRegistryHash;

function readPackageVersion() {
  if (memoizedPackageVersion !== undefined) return memoizedPackageVersion;
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    memoizedPackageVersion = typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : SERVER_INFO.version;
  } catch {
    memoizedPackageVersion = SERVER_INFO.version;
  }
  return memoizedPackageVersion;
}

function resolveGitSha() {
  if (memoizedGitSha !== undefined) return memoizedGitSha;
  const envSha = process.env.CEREBRAS_EXPLORER_GIT_SHA?.trim();
  if (envSha) {
    memoizedGitSha = envSha;
    return memoizedGitSha;
  }
  try {
    const raw = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha = raw.trim();
    memoizedGitSha = sha || null;
  } catch {
    memoizedGitSha = null;
  }
  return memoizedGitSha;
}

function buildToolRegistryHash(tools) {
  const shape = tools.map(({ name, inputSchema, outputSchema }) => ({
    name,
    inputSchema,
    outputSchema: outputSchema ?? null,
  }));
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

export function buildExecutionProvenance(options = {}) {
  const {
    tools = null,
    packageVersion = null,
    toolRegistryHash = null,
  } = options;
  const registry = Array.isArray(tools) ? tools : buildToolList();
  const hash = toolRegistryHash
    ?? (tools ? buildToolRegistryHash(registry) : (memoizedToolRegistryHash ??= buildToolRegistryHash(registry)));

  return {
    serverName: SERVER_INFO.name,
    serverVersion: SERVER_INFO.version,
    packageVersion: packageVersion ?? readPackageVersion(),
    schemaVersion: 2,
    gitSha: Object.hasOwn(options, 'gitSha') ? options.gitSha : resolveGitSha(),
    toolRegistryHash: hash,
    exposedToolCount: registry.length,
    toolNames: registry.map(tool => tool.name),
  };
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
  const { symbol, repo_root, scope } = args;
  if (!symbol || typeof symbol !== 'string' || !symbol.trim()) {
    throw makeInvalidArgsError('trace_symbol requires a non-empty "symbol" argument.');
  }
  const task = `Explain the symbol "${symbol.trim()}": where it is defined, what it does, its parameters/return type if applicable, and where it is called or used in the codebase.`;
  return {
    task, repo_root, scope,
    taskMode: 'symbol_trace',
    hints: { symbols: [symbol.trim()], strategy: 'symbol-first' },
  };
}

function buildFindRelevantCodeArgs(args) {
  const { query, repo_root, scope, knownFiles, knownSymbols, knownText } = args;
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw makeInvalidArgsError('find_relevant_code requires a non-empty "query" argument.');
  }
  const task = `Find the code most relevant to this task and return the smallest useful read/edit targets: ${query.trim()}.`;
  return {
    task,
    repo_root,
    scope,
    taskMode: 'locate',
    hints: buildAnchorHints({ knownFiles, knownSymbols, knownText }),
  };
}

function buildMapChangeImpactArgs(args) {
  const { change, repo_root, scope, knownFiles, knownSymbols } = args;
  if (!change || typeof change !== 'string' || !change.trim()) {
    throw makeInvalidArgsError('map_change_impact requires a non-empty "change" argument.');
  }
  const task = `Map the likely impact of this intended change before editing: ${change.trim()}. Identify likely edit targets, read targets, callers, tests, configuration, and risky dependent paths.`;
  return {
    task,
    repo_root,
    scope,
    taskMode: 'edit_planning',
    hints: buildAnchorHints({ knownFiles, knownSymbols, strategy: 'reference-chase' }),
  };
}

function buildExplainCodePathArgs(args) {
  const { pathQuery, repo_root, scope, entryPoint, knownFiles, knownSymbols } = args;
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
    taskMode: 'path_explanation',
    hints: buildAnchorHints({ knownFiles: files, knownSymbols, strategy: 'reference-chase' }),
  };
}

function buildCollectEvidenceArgs(args) {
  const { claim, repo_root, scope, knownFiles, knownSymbols, knownText } = args;
  if (!claim || typeof claim !== 'string' || !claim.trim()) {
    throw makeInvalidArgsError('collect_evidence requires a non-empty "claim" argument.');
  }
  const task = `Verify this claim and collect a compact evidence bundle with snippets: ${claim.trim()}. Mark uncertainties and avoid unsupported facts.`;
  return {
    task,
    repo_root,
    scope,
    taskMode: 'evidence_verification',
    hints: buildAnchorHints({ knownFiles, knownSymbols, knownText }),
  };
}

function buildReviewChangeContextArgs(args) {
  const { reviewGoal, since, until, path: filePath, repo_root, scope } = args;
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
    taskMode: 'change_review',
    hints: buildAnchorHints({ knownFiles: filePath ? [filePath] : [], strategy: 'git-guided' }),
  };
}

// ─── Request handler ────────────────────────────────────────────────────────

export function createMcpRequestHandler({
  logger = () => {},
  runtimeOptions = {},
  sendNotification = null,
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

    return lines.join('\n');
  }

  function formatOpsSummary({ tool, stats = {}, transcriptPath = null, raw = false, failureReason = '' }) {
    const safeStats = stats && typeof stats === 'object' ? stats : {};
    const elapsedSeconds = Math.round((safeStats.elapsedMs ?? 0) / 1000);
    let line =
      `[cerebras-explorer] tool=${tool} ` +
      `turns=${safeStats.turns ?? 0} ` +
      `toolCalls=${safeStats.toolCalls ?? 0} ` +
      `stoppedByBudget=${Boolean(safeStats.stoppedByBudget)} ` +
      `elapsed=${elapsedSeconds}s`;
    if (transcriptPath) line += ` log=${path.basename(transcriptPath)}`;
    if (raw) line += ' raw=true';
    if (failureReason) line += ` failure=${failureReason}`;
    return line;
  }

  function writeOpsSummary(summary) {
    try {
      process.stderr.write(`${formatOpsSummary(summary)}\n`);
    } catch {
      // Operational logging must never affect the MCP response path.
    }
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
      omittedDiscoveredPaths: 0,
      warnings: [],
      summary,
    };
  }

  function normalizeCriticWarning(warning) {
    if (warning && typeof warning === 'object') {
      return {
        type: typeof warning.type === 'string' && warning.type ? warning.type : 'runtime_warning',
        severity: ['low', 'medium', 'high'].includes(warning.severity) ? warning.severity : 'medium',
        message: typeof warning.message === 'string' ? warning.message : '',
        ...(typeof warning.target === 'string' && warning.target ? { target: warning.target } : {}),
        action: typeof warning.action === 'string' && warning.action
          ? warning.action
          : 'Review this warning before relying on the result.',
      };
    }
    return {
      type: 'runtime_warning',
      severity: 'medium',
      message: typeof warning === 'string' ? warning : 'Explorer emitted an unspecified warning.',
      action: 'Review this warning before relying on the result.',
    };
  }

  function defaultCritic(warnings = []) {
    const normalizedWarnings = Array.isArray(warnings)
      ? warnings.map(normalizeCriticWarning).filter(warning => warning.message)
      : [];
    return {
      status: normalizedWarnings.some(warning => warning.severity === 'high')
        ? 'fail'
        : (normalizedWarnings.length > 0 ? 'caution' : 'pass'),
      warnings: normalizedWarnings,
      droppedEvidence: 0,
      partialEvidence: 0,
    };
  }

  function toAgentFacingCritic(result = {}) {
    const warnings = Array.isArray(result.critic?.warnings)
      ? result.critic.warnings
      : [];
    return {
      status: result.critic?.status ?? (warnings.length > 0 ? 'caution' : 'pass'),
      warnings: warnings.map(normalizeCriticWarning).filter(warning => warning.message),
      droppedEvidence: Number.isInteger(result.critic?.droppedEvidence)
        ? result.critic.droppedEvidence
        : (result.evidenceQuality?.droppedCount ?? 0),
      partialEvidence: Number.isInteger(result.critic?.partialEvidence)
        ? result.critic.partialEvidence
        : (result.evidenceQuality?.partialCount ?? 0),
    };
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
      schemaVersion: 2,
      directAnswer: '',
      status: {
        confidence: 'low',
        verification: 'broad_search_needed',
        complete: false,
        warnings: [message],
      },
      targets: [],
      discoveredPaths: [],
      evidence: [],
      uncertainties: [message],
      nextAction: { type: 'ask_user', reason: message },
      evidenceQuality: defaultEvidenceQuality(message, [message]),
      searchCoverage: defaultSearchCoverage(message),
      critic: defaultCritic([message]),
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
    };
  }

  // Build a non-throwing isError tool result from a handled failure. The
  // machine-readable reason is mirrored into content[0].text because some MCP
  // clients surface only the text on isError and discard structuredContent (F7).
  function handledFailureResult(opts) {
    return {
      isError: true,
      content: [{ type: 'text', text: `${opts.message} [reason: ${opts.reason}]` }],
      structuredContent: buildHandledFailure(opts),
    };
  }

  function toAgentFacingResult(result) {
    return {
      schemaVersion: result.schemaVersion ?? 2,
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
      critic: toAgentFacingCritic(result),
      failure: result.failure ?? null,
    };
  }

  function toAgentFacingFreeExploreResult(result) {
    return {
      report: result.report ?? '',
      citations: Array.isArray(result.citations) ? result.citations : [],
      targets: Array.isArray(result.targets) ? result.targets : [],
      searchCoverage: result.searchCoverage ?? defaultSearchCoverage(),
      critic: {
        ...defaultCritic(),
        ...(result.critic && typeof result.critic === 'object' ? result.critic : {}),
        warnings: Array.isArray(result.critic?.warnings)
          ? result.critic.warnings.map(normalizeCriticWarning).filter(warning => warning.message)
          : [],
        droppedEvidence: 0,
        partialEvidence: 0,
      },
      failure: result.failure ?? null,
    };
  }

  async function callTool(exploreArgs, progressToken, requestId, toolName = 'explore_repo') {
    const abortController = new AbortController();
    if (requestId) activeAbortControllers.set(requestId, abortController);
    let stats = null;
    let transcriptPath = null;
    let failureReason = '';
    try {
      const provenance = runtimeOptions.provenance ?? (isTranscriptEnabled() ? buildExecutionProvenance() : null);
      const result = await exploreRepository(exploreArgs, {
        logger,
        ...runtimeOptions,
        provenance,
        onProgress: makeProgressCallback(progressToken),
        abortSignal: abortController.signal,
      });
      stats = result.stats;
      transcriptPath = result.transcriptPath ?? result.stats?.transcriptPath ?? null;
      const agentResult = redactExploreResult(toAgentFacingResult(result)).value;
      // Spec 025: ops side-channel, symmetric with callFreeExploreTool. This is
      // operational/eval metadata (spec 022 boundary), not the answer contract.
      const ops = redactValue({ stats: stats ?? {}, transcriptPath }).value;
      return {
        content: [{ type: 'text', text: formatExploreResult(agentResult) }],
        structuredContent: agentResult,
        _meta: { ops },
      };
    } catch (error) {
      stats = error?.stats ?? stats;
      transcriptPath = error?.transcriptPath ?? transcriptPath;
      failureReason = error?.failure?.reason ?? error?.reason ?? 'execution_failed';
      throw error;
    } finally {
      writeOpsSummary({
        tool: toolName,
        stats,
        transcriptPath,
        raw: isTranscriptRawMode(),
        failureReason,
      });
      if (requestId) activeAbortControllers.delete(requestId);
    }
  }

  async function callFreeExploreTool(exploreArgs, progressToken, requestId) {
    const abortController = new AbortController();
    if (requestId) activeAbortControllers.set(requestId, abortController);
    let stats = null;
    let transcriptPath = null;
    let failureReason = '';
    try {
      const provenance = runtimeOptions.provenance ?? (isTranscriptEnabled() ? buildExecutionProvenance() : null);
      const result = await freeExploreRepository(exploreArgs, {
        logger,
        ...runtimeOptions,
        provenance,
        onProgress: makeProgressCallback(progressToken),
        abortSignal: abortController.signal,
      });
      stats = result.stats;
      transcriptPath = result.transcriptPath ?? null;
      const safeResult = redactValue(toAgentFacingFreeExploreResult(result)).value;
      const ops = redactValue({
        stats: stats ?? {},
        transcriptPath,
        toolTrace: result.toolTrace ?? null,
        filesRead: result.filesRead ?? [],
        toolsUsed: result.toolsUsed ?? [],
      }).value;
      return {
        content: [{ type: 'text', text: safeResult.report }],
        structuredContent: safeResult,
        _meta: { ops },
      };
    } catch (error) {
      stats = error?.stats ?? stats;
      transcriptPath = error?.transcriptPath ?? transcriptPath;
      failureReason = error?.failure?.reason ?? error?.reason ?? 'execution_failed';
      throw error;
    } finally {
      writeOpsSummary({
        tool: 'explore',
        stats,
        transcriptPath,
        raw: isTranscriptRawMode(),
        failureReason,
      });
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
            'PREFER these tools over manual file search (Grep/Glob/Read) whenever you would otherwise run a grep-then-read loop — including for a single known symbol or claim — and especially for multi-file or cross-file understanding. ' +
            'explore_repo returns structured JSON with directAnswer, status, targets, discoveredPaths, and grounded evidence snippets; explore returns a Markdown report for human consumption. ' +
            'Purpose shortcuts: find_relevant_code, trace_symbol, map_change_impact, explain_code_path, collect_evidence, review_change_context. ' +
            'Pass _meta.progressToken for heavy calls (broad reports / path / impact) to receive turn-by-turn progress updates. ' +
            'When summarizing or handing off a result to another agent, preserve these control-plane fields verbatim: ' +
            'status.verification, status.complete, evidenceQuality, searchCoverage, failure, and any critic.warnings.',
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
            return await callTool(args, progressToken, requestId, name);
          }
          if (name === 'find_relevant_code') {
            validatePublicToolArgs(FIND_RELEVANT_CODE_TOOL, args);
            return await callTool(buildFindRelevantCodeArgs(args), progressToken, requestId, name);
          }
          if (name === 'trace_symbol') {
            validatePublicToolArgs(TRACE_SYMBOL_TOOL, args);
            return await callTool(buildTraceSymbolArgs(args), progressToken, requestId, name);
          }
          if (name === 'map_change_impact') {
            validatePublicToolArgs(MAP_CHANGE_IMPACT_TOOL, args);
            return await callTool(buildMapChangeImpactArgs(args), progressToken, requestId, name);
          }
          if (name === 'explain_code_path') {
            validatePublicToolArgs(EXPLAIN_CODE_PATH_TOOL, args);
            return await callTool(buildExplainCodePathArgs(args), progressToken, requestId, name);
          }
          if (name === 'collect_evidence') {
            validatePublicToolArgs(COLLECT_EVIDENCE_TOOL, args);
            return await callTool(buildCollectEvidenceArgs(args), progressToken, requestId, name);
          }
          if (name === 'review_change_context') {
            validatePublicToolArgs(REVIEW_CHANGE_CONTEXT_TOOL, args);
            return await callTool(buildReviewChangeContextArgs(args), progressToken, requestId, name);
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
            return handledFailureResult({
              category: 'input',
              reason: 'repo_mismatch',
              message: `Unable to resolve repo_root for ${name}: ${error.message}`,
              retryTool: null,
            });
          }
          if (error.code === -32602) {
            return handledFailureResult({
              category: 'input',
              reason: 'invalid_arguments',
              message: `Invalid arguments for ${name}: ${error.message}`,
              retryTool: null,
            });
          }
          if (exposedToolNames.has(name)) {
            const retryScope = Array.isArray(args?.scope)
              ? args.scope.filter(item => typeof item === 'string').slice(0, 8)
              : [];
            return handledFailureResult({
              category: 'provider',
              reason: 'provider_error',
              message: `${name} execution failed: ${error.message}`,
              retryTool: name === 'explore' ? 'explore' : 'explore_repo',
              hints: ['Retry after the provider recovers, or narrow the task and scope.'],
              retryArgs: {
                task: 'Retry after the provider recovers, or narrow the task and scope.',
                scope: retryScope,
              },
              expectedImprovement: 'A provider recovery or narrower scope should reduce failure risk.',
            });
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
