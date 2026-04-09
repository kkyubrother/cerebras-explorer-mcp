import { DEFAULT_PROTOCOL_VERSION, getExplorerModel, isTruthyEnv } from '../explorer/config.mjs';
import { exploreRepository } from '../explorer/runtime.mjs';
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
    'Delegates read-only codebase exploration to a standalone Cerebras explorer agent. The parent model gives one high-level task; the explorer performs its own search/read loop and returns structured findings. Pass the returned stats.sessionId as "session" in a follow-up call to carry over discovered context.',
  inputSchema: EXPLORE_REPO_INPUT_SCHEMA,
};

// ─── Specialized tools (exposed when CEREBRAS_EXPLORER_EXTRA_TOOLS != false) ─

const EXPLAIN_SYMBOL_TOOL = {
  name: 'explain_symbol',
  title: 'Explain a code symbol',
  description:
    'Explains a function, class, variable, or type: where it is defined, what it does, and where it is used. Internally uses the symbol-first exploration strategy.',
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
    'Traces the import/dependency chain starting from an entry file. Returns which modules import or are imported by the entry point. Uses the reference-chase strategy.',
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
      maxDepth: { type: 'number' },
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
    'Summarizes git changes in a given time range or branch. Returns an overview of what changed and why. Uses the git-guided strategy.',
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
    'Finds code that uses patterns similar to a reference file, path, or snippet via natural-language reasoning (no numeric similarity score). Useful for discovering duplicates, repeated logic, or convention violations. Uses the pattern-scan strategy.',
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
  const { entryPoint, direction = 'both', maxDepth = 3, repo_root, session, language, context } = args;
  if (!entryPoint || typeof entryPoint !== 'string' || !entryPoint.trim()) {
    throw Object.assign(new Error('trace_dependency requires a non-empty "entryPoint" argument.'), { code: -32602 });
  }
  const depthNote = Number.isFinite(maxDepth) ? ` Follow at most ${maxDepth} levels deep.` : '';
  let task = `Trace the import/dependency chain of "${entryPoint.trim()}". Direction: ${direction}.${depthNote} List which modules are imported and which modules import this file.`;
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

  async function callTool(exploreArgs, progressToken) {
    const result = await exploreRepository(exploreArgs, {
      logger,
      ...runtimeOptions,
      onProgress: makeProgressCallback(progressToken),
      sessionStore,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
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
            `This MCP server exposes ${toolCount} tool(s) powered by the Cerebras ${getExplorerModel()} model. ` +
            'explore_repo is the general-purpose tool; the specialized tools are pre-configured shortcuts. ' +
            'Pass _meta.progressToken in tool calls to receive turn-by-turn notifications/progress updates. ' +
            'Use stats.sessionId from one call as "session" in the next call for incremental exploration.',
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

        try {
          if (name === 'explore_repo') {
            validateExploreRepoArgs(args);
            return await callTool(args, progressToken);
          }
          if (name === 'explain_symbol') {
            return await callTool(buildExplainSymbolArgs(args), progressToken);
          }
          if (name === 'trace_dependency') {
            return await callTool(buildTraceDependencyArgs(args), progressToken);
          }
          if (name === 'summarize_changes') {
            return await callTool(buildSummarizeChangesArgs(args), progressToken);
          }
          if (name === 'find_similar_code') {
            return await callTool(buildFindSimilarCodeArgs(args), progressToken);
          }

          const error = new Error(`Unknown tool: ${name}`);
          error.code = -32601;
          throw error;
        } catch (error) {
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
    if (
      message.method === 'notifications/initialized' ||
      message.method === 'notifications/cancelled'
    ) {
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
