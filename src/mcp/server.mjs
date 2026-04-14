import { DEFAULT_PROTOCOL_VERSION, getExplorerModel, isTruthyEnv } from '../explorer/config.mjs';
import { exploreRepository, freeExploreRepository, freeExploreRepositoryV2 } from '../explorer/runtime.mjs';
import { EXPLORE_REPO_INPUT_SCHEMA, validateExploreRepoArgs } from '../explorer/schemas.mjs';
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
    'Autonomous codebase explorer powered by Cerebras. Use this tool INSTEAD OF making your own Grep/Glob/Read calls when you need to: ' +
    '(1) understand how a feature or system works end-to-end, ' +
    '(2) find where a symbol is defined and used across the codebase, ' +
    '(3) trace dependencies or import chains, ' +
    '(4) investigate a bug\'s root cause across multiple files, ' +
    '(5) answer architectural questions about the project. ' +
    'The explorer performs its own multi-turn search/read loop autonomously and returns grounded, evidence-backed findings with file:line citations. ' +
    'This is faster and more thorough than manual file-by-file search. ' +
    'Returns structured JSON with answer, evidence, and confidence level. ' +
    'Pass stats.sessionId as "session" in follow-up calls for incremental exploration.',
  inputSchema: EXPLORE_REPO_INPUT_SCHEMA,
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
};

// ─── Phase 5: Free-form explore tool (beta) ───────────────────────────────

const EXPLORE_TOOL = {
  name: 'explore',
  title: 'Free-form repository exploration',
  description:
    'Use this when you need a comprehensive, human-readable Markdown report about the codebase. ' +
    'Ideal for: architecture overviews, explaining how complex systems work, code review analysis, or answering broad "how does X work?" questions. ' +
    'The report includes inline file:line citations and is ready to present directly to the user without further processing. ' +
    'More thorough than manual search — the explorer reads multiple files and cross-references findings autonomously. ' +
    'For structured JSON output (programmatic use), use explore_repo instead.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'What to explore — a natural-language question or task.' },
      thoroughness: { type: 'string', enum: ['quick', 'normal', 'deep'], description: 'How deep to explore (default: normal).' },
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
    'Enhanced version of explore with three advanced techniques: ' +
    '(1) LLM-based conversation compaction — intelligently summarizes earlier findings to maximize useful context, ' +
    '(2) tool result budgeting — caps individual tool outputs to prevent context overflow, ' +
    '(3) max output recovery — automatically continues the report if it gets cut short. ' +
    'Use this for deep, complex explorations that span many files or require comprehensive reports. ' +
    'Produces a thorough Markdown report with file:line citations. ' +
    'Best for: architecture deep-dives, root cause analysis, understanding complex systems end-to-end.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'What to explore — a natural-language question or task. Be specific for best results.' },
      thoroughness: { type: 'string', enum: ['quick', 'normal', 'deep'], description: '"quick": fast scan, "normal": balanced (default), "deep": comprehensive investigation.' },
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

// ─── Tool registry ─────────────────────────────────────────────────────────

function extraToolsEnabled() {
  const v = process.env.CEREBRAS_EXPLORER_EXTRA_TOOLS;
  if (v === undefined || v === null) return true;
  return isTruthyEnv(v);
}

function buildToolList() {
  const tools = [EXPLORE_REPO_TOOL];
  if (extraToolsEnabled()) {
    tools.push(EXPLAIN_SYMBOL_TOOL, TRACE_DEPENDENCY_TOOL, SUMMARIZE_CHANGES_TOOL, FIND_SIMILAR_CODE_TOOL);
  }
  if (exploreToolEnabled()) {
    tools.push(EXPLORE_TOOL, EXPLORE_V2_TOOL);
  }
  return tools;
}

// ─── Specialized tool task builders ────────────────────────────────────────

function buildExplainSymbolArgs(args) {
  const { symbol, repo_root, scope, session, language, context } = args;
  if (!symbol || typeof symbol !== 'string' || !symbol.trim()) {
    throw Object.assign(new Error('explain_symbol requires a non-empty "symbol" argument.'), { code: -32602 });
  }
  let task = `Explain the symbol "${symbol.trim()}": where it is defined, what it does, its parameters/return type if applicable, and where it is called or used in the codebase.`;
  if (context) task += `\n\nAdditional context: ${context}`;
  return {
    task, repo_root, scope, session, language,
    budget: 'normal',
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
    budget: 'normal',
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
    budget: 'normal',
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
    budget: 'normal',
    hints: { files: [reference.trim()], strategy: 'pattern-scan' },
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
    if (!progressToken || !sendNotification) return null;
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

    // Trust summary first — this is what the parent model reads to decide trust
    if (result.trustSummary) {
      lines.push(result.trustSummary);
      lines.push('');
    }

    lines.push(`## Answer`);
    lines.push(result.answer || '(no answer)');

    if (result.evidence?.length > 0) {
      lines.push('');
      lines.push(`## Evidence (${result.evidence.length} items, confidence: ${result.confidence})`);
      for (const e of result.evidence.slice(0, 10)) {
        const grounding = e.groundingStatus === 'exact' ? '' : ' [partial]';
        lines.push(`- \`${e.path}:${e.startLine}-${e.endLine}\`${grounding} — ${e.why}`);
      }
      if (result.evidence.length > 10) {
        lines.push(`- ... and ${result.evidence.length - 10} more evidence items`);
      }
    }

    if (result.followups?.length > 0) {
      lines.push('');
      lines.push(`## Suggested Follow-ups`);
      for (const f of result.followups) {
        lines.push(`- [${f.priority}] ${f.description}`);
      }
    }

    const statsLine = [
      `${result.stats?.turns ?? '?'} turns`,
      `${result.stats?.filesRead ?? '?'} files read`,
      `${result.stats?.elapsedMs ?? '?'}ms`,
    ].join(', ');
    lines.push('');
    lines.push(`## Stats: ${statsLine}`);

    if (result.stats?.sessionId) {
      lines.push(`Session ID: ${result.stats.sessionId} (pass as "session" for follow-up calls)`);
    }

    return lines.join('\n');
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
      return {
        content: [{ type: 'text', text: formatExploreResult(result) }],
        structuredContent: result,
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
        return {
          protocolVersion: negotiatedProtocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            `Cerebras Explorer provides autonomous codebase exploration (${toolCount} tools, powered by ${getExplorerModel()}). ` +
            'PREFER these tools over manual file search (Grep/Glob/Read) for any task that spans more than 2-3 files or requires cross-file understanding. ' +
            'explore_repo returns structured JSON with grounded evidence; explore returns a Markdown report for human consumption. ' +
            'Specialized shortcuts: explain_symbol (symbol lookup), trace_dependency (import chains), summarize_changes (git history), find_similar_code (pattern detection). ' +
            'All tools accept a "session" parameter for multi-call continuity — pass stats.sessionId from one call to the next. ' +
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

        try {
          if (name === 'explore_repo') {
            validateExploreRepoArgs(args);
            return await callTool(args, progressToken, requestId);
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

          const error = new Error(`Unknown tool: ${name}`);
          error.code = -32601;
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
          if (name === 'explore_repo') {
            return {
              isError: true,
              content: [{ type: 'text', text: `Invalid explore_repo arguments: ${error.message}` }],
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
