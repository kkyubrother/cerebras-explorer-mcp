import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_PROTOCOL_VERSION } from '../explorer/config.mjs';
import { exploreRepository } from '../explorer/runtime.mjs';
import {
  EXPLORE_REPO_INPUT_SCHEMA,
  EXPLORE_REPO_OUTPUT_SCHEMA,
  validateExploreRepoArgs,
  validateParentHandoffV3,
} from '../explorer/schemas.mjs';
import { redactValue } from '../explorer/redact.mjs';
import { buildParentPayload } from '../explorer/parent-payload.mjs';
import { isTranscriptEnabled, isTranscriptRawMode } from '../explorer/transcript.mjs';
import { StdioJsonRpcServer } from './jsonrpc-stdio.mjs';

const SERVER_INFO = {
  name: 'cerebras-explorer-mcp',
  version: '0.8.9',
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
    'Use for repository investigations not clearly covered by another tool. Do not use it to control search tactics or effort.',
  inputSchema: EXPLORE_REPO_INPUT_SCHEMA,
  outputSchema: EXPLORE_REPO_OUTPUT_SCHEMA,
  annotations: readOnlyToolAnnotations('Autonomous repository explorer'),
};

// ─── Specialized tools (always exposed since spec 011) ─────────────────────

const FIND_RELEVANT_CODE_TOOL = {
  name: 'find_relevant_code',
  title: 'Find relevant code targets',
  description:
    'Use when locating unknown implementation, configuration, test, or route positions. Do not use when the exact location is already known.',
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
    'Use when explaining a known function, class, type, or variable and its usages. Do not use for unknown-symbol discovery or execution-flow tracing.',
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
    'Use before a planned change to identify its blast radius. Do not use for a one-line edit in a known file.',
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
    'Use when tracing an ordered request, event, job, CLI, or data flow. Do not use for static single-symbol usage.',
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
    'Use when supporting or refuting an existing claim or hypothesis. Do not use for broad discovery without a claim.',
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

// ─── Tool registry ─────────────────────────────────────────────────────────

function buildToolList() {
  return [
    FIND_RELEVANT_CODE_TOOL,
    TRACE_SYMBOL_TOOL,
    MAP_CHANGE_IMPACT_TOOL,
    EXPLAIN_CODE_PATH_TOOL,
    COLLECT_EVIDENCE_TOOL,
    EXPLORE_REPO_TOOL,
  ];
}

const TOOL_DISPATCH_RULE =
  'Need locations → find_relevant_code; Know the symbol → trace_symbol; ' +
  'Plan a change → map_change_impact; Need an execution/data path → explain_code_path; ' +
  'Need to verify one claim → collect_evidence; Anything else → explore_repo.';

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

function buildAnchorHints({ knownFiles, knownSymbols, knownText } = {}) {
  const hints = {};
  const files = cleanStringArray(knownFiles);
  const symbols = cleanStringArray(knownSymbols);
  const regex = cleanStringArray(knownText).map(escapeRegexLiteral);
  if (files.length > 0) hints.files = files;
  if (symbols.length > 0) hints.symbols = symbols;
  if (regex.length > 0) hints.regex = regex;
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
    hints: { symbols: [symbol.trim()] },
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
    hints: buildAnchorHints({ knownFiles, knownSymbols }),
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
    hints: buildAnchorHints({ knownFiles: files, knownSymbols }),
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

/**
 * Project a strict runtime-owned handoff into the only facts visible to the
 * parent agent. Redaction precedes validation so text and structured output
 * are generated from one identical safe value.
 */
export function buildParentHandoffResponse(parentHandoff) {
  const safeHandoff = redactValue(parentHandoff).value;
  validateParentHandoffV3(safeHandoff);
  return {
    ...(safeHandoff.state === 'failed' ? { isError: true } : {}),
    ...buildParentPayload(safeHandoff),
  };
}

function validateExploreRepoPublicArgs(args) {
  try {
    validateExploreRepoArgs(args);
  } catch (error) {
    throw makeInvalidArgsError(error?.message ?? String(error));
  }
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
  const hasRequestId = requestId => requestId !== null && requestId !== undefined;

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

  function formatOpsSummary({ tool, stats = {}, transcriptPath = null, raw = false, failureReason = '' }) {
    const safeStats = stats && typeof stats === 'object' ? stats : {};
    const elapsedSeconds = Math.round((safeStats.elapsedMs ?? 0) / 1000);
    let line =
      `[cerebras-explorer] tool=${tool} ` +
      `turns=${safeStats.turns ?? 0} ` +
      `toolCalls=${safeStats.toolCalls ?? 0} ` +
      `safetyLimits=${Array.isArray(safeStats.safetyLimits) ? safeStats.safetyLimits.length : 0} ` +
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

  function handledParentFailureResult({
    reason,
    message,
    retryTool = null,
    retryArgs = null,
  }) {
    const failure = { reason };
    if (retryTool && retryArgs) {
      failure.retry = {
        type: 'tool',
        tool: retryTool,
        arguments: retryArgs,
      };
    }
    return buildParentHandoffResponse({
      schemaVersion: 3,
      directAnswer: message,
      state: 'failed',
      failure,
    });
  }

  async function callTool(exploreArgs, progressToken, requestId, toolName = 'explore_repo') {
    const abortController = new AbortController();
    if (hasRequestId(requestId)) activeAbortControllers.set(requestId, abortController);
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
      failureReason = result.parentHandoff?.failure?.reason ?? result.failure?.reason ?? '';
      try {
        return buildParentHandoffResponse(result.parentHandoff);
      } catch (error) {
        error.parentHandoffError = true;
        throw error;
      }
    } catch (error) {
      stats = error?.stats ?? stats;
      transcriptPath = error?.transcriptPath ?? transcriptPath;
      failureReason = error?.name === 'AbortError'
        ? 'aborted'
        : error?.repoRootError
          ? 'repo_mismatch'
        : error?.explorerFailureKind === 'provider'
          ? 'provider_error'
        : error?.parentHandoffError
          ? 'internal_error'
        : error?.failure?.reason ?? error?.reason ?? 'execution_failed';
      throw error;
    } finally {
      writeOpsSummary({
        tool: toolName,
        stats,
        transcriptPath,
        raw: isTranscriptRawMode(),
        failureReason,
      });
      if (hasRequestId(requestId)) activeAbortControllers.delete(requestId);
    }
  }

  async function handleRequest(message) {
    switch (message.method) {
      case 'initialize': {
        const requestedVersion = message.params?.protocolVersion;
        if (typeof requestedVersion === 'string' && requestedVersion.trim()) {
          negotiatedProtocolVersion = requestedVersion;
        }
        return {
          protocolVersion: negotiatedProtocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Cerebras Explorer provides read-only repository exploration with grounded schema-v3 handoffs. ' +
            `${TOOL_DISPATCH_RULE} ` +
            'Repository scope is a hard boundary. Pass known file, symbol, or text anchors when available. ' +
            'Use _meta.progressToken for long path or impact calls.',
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
            validateExploreRepoPublicArgs(args);
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

          // Unreachable: all exposed tool names are handled above.
          // If a new tool is added to buildToolList() but not dispatched here,
          // this safeguard surfaces the oversight as an error.
          const error = new Error(`Tool "${name}" is listed but has no handler.`);
          error.code = -32603;
          throw error;
        } catch (error) {
          const handledResult = handledParentFailureResult;
          if (error?.name === 'AbortError') {
            return handledResult({
              category: 'execution',
              reason: 'aborted',
              message: `${name} was cancelled before completion.`,
              retryTool: null,
            });
          }
          if (error.repoRootError) {
            return handledResult({
              category: 'input',
              reason: 'repo_mismatch',
              message: `Unable to resolve repo_root for ${name}: ${error.message}`,
              retryTool: null,
            });
          }
          if (error.code === -32602) {
            return handledResult({
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
            const parentProjectionFailure = error?.parentHandoffError;
            return handledResult({
              category: parentProjectionFailure ? 'internal' : 'provider',
              reason: parentProjectionFailure ? 'internal_error' : 'provider_error',
              message: parentProjectionFailure
                ? `${name} execution failed because its parent handoff was invalid.`
                : `${name} execution failed because the provider was unavailable.`,
              retryTool: 'explore_repo',
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
      if (hasRequestId(requestId)) {
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
