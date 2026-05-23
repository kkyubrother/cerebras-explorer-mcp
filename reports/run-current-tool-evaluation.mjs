import fs from 'node:fs/promises';
import path from 'node:path';

import { createMcpRequestHandler } from '../src/mcp/server.mjs';
import { globalSessionStore } from '../src/explorer/session.mjs';

const ROOT = '/home/kyubr/IdeaProjects';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = path.resolve('reports', `tool-eval-current-${RUN_ID}`);
const CASE_DIR = path.join(OUT_DIR, 'cases');
const PACKET_DIR = path.join(OUT_DIR, 'subagent-packets');

const repos = [
  {
    key: 'cerebras-explorer-mcp',
    root: `${ROOT}/cerebras-explorer-mcp`,
    scope: ['src/**', 'tests/**', 'examples/**'],
    symbol: 'createMcpRequestHandler',
    fileAnchor: 'src/mcp/server.mjs',
    feature: 'MCP tool dispatch and evidence grounding',
    pathFlow: 'tools/call request dispatch from createMcpRequestHandler into wrapper task builders and runtime callTool',
    claim: 'explore_repo rejects a public budget input and all public tools are read-only annotated',
    change: 'rename or refactor the public tool output contract fields around evidenceQuality and searchCoverage',
    reviewGoal: 'Review the current public MCP surface for fixed 10-tool behavior and removed explore_v2/budget inputs.',
    entryKind: 'mcp',
  },
  {
    key: 'DeepResearch',
    root: `${ROOT}/DeepResearch`,
    scope: ['app/**', 'main.py', 'migrations/**'],
    symbol: 'create_app',
    fileAnchor: 'app/main.py',
    feature: 'FastAPI app, orchestration, provider, and repository wiring',
    pathFlow: 'FastAPI app startup and API route registration through create_app',
    claim: 'create_app is the main FastAPI application factory and wires API routers or middleware',
    change: 'add request telemetry across FastAPI routes and provider calls',
    reviewGoal: 'Review recent changes that could affect orchestration, provider logging, or API behavior.',
    entryKind: 'http',
  },
  {
    key: 'aicc_manage',
    root: `${ROOT}/aicc_manage`,
    scope: ['src/**', 'websocket-server/src/**', 'lambda/**', 'prisma/**', 'scripts/**'],
    symbol: 'authMiddleware',
    fileAnchor: 'websocket-server/src/middleware/auth.ts',
    feature: 'Next.js app auth, websocket auth, Lambda handlers, and Prisma data model',
    pathFlow: 'websocket client connection authentication through authMiddleware into socket handlers',
    claim: 'websocket-server authenticates Socket.IO connections with authMiddleware before registering chat or notification handlers',
    change: 'tighten websocket authentication and internal secret validation without breaking notification pushes',
    reviewGoal: 'Review recent auth and websocket-related changes for security or behavior risk.',
    entryKind: 'event',
  },
  {
    key: 'bible',
    root: `${ROOT}/bible`,
    scope: ['src/**', 'functions/**', 'scripts/**', 'migrations/**'],
    symbol: 'useStore',
    fileAnchor: 'src/store.tsx',
    feature: 'React reader state, Cloudflare Pages Functions auth, bookmarks, and exam APIs',
    pathFlow: 'Telegram auth Pages Function creates or authenticates a user session and exposes session state to the frontend',
    claim: 'Telegram authentication uses a Cloudflare Pages Function and session helper rather than only client-side state',
    change: 'refactor reader selection state and bookmark sync without breaking Cloudflare Functions APIs',
    reviewGoal: 'Review current reader/search/bookmark changes for user-visible regressions and API contract risk.',
    entryKind: 'http',
  },
  {
    key: 'studious-memory',
    root: `${ROOT}/studious-memory`,
    scope: ['backend/**', 'frontend/src/**', 'extensions/firefox-inbox/src/**', 'scripts/**', 'android/**'],
    symbol: 'scoped_tool',
    fileAnchor: 'backend/mcp_server.py',
    feature: 'backend MCP/FastAPI surface, frontend auth, extension capture, and ops scripts',
    pathFlow: 'Firefox extension capture submission from apiClient through backend source intake or MCP surface',
    claim: 'MCP tools are registered through scoped_tool or equivalent wrappers in backend/mcp_server.py',
    change: 'harden API-key bearer authentication across frontend extension and backend endpoints',
    reviewGoal: 'Review recent backend/frontend contract changes around source intake, API keys, and MCP tools.',
    entryKind: 'mcp',
  },
];

const tools = [
  'explore_repo',
  'find_relevant_code',
  'trace_symbol',
  'map_change_impact',
  'map_impact',
  'explain_code_path',
  'collect_evidence',
  'review_change_context',
  'find_entrypoints',
  'explore',
];

function truncate(value, limit = 1600) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length <= limit ? text : `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`;
}

function argsFor(tool, repo) {
  const base = { repo_root: repo.root, scope: repo.scope };
  switch (tool) {
    case 'explore_repo':
      return {
        ...base,
        task: `Explain the repository purpose and the main implementation path for ${repo.feature}. Return grounded targets that a parent coding agent should verify before editing.`,
      };
    case 'find_relevant_code':
      return {
        ...base,
        query: `Find the smallest useful files and line ranges for understanding ${repo.feature}.`,
        knownFiles: [repo.fileAnchor],
      };
    case 'trace_symbol':
      return { ...base, symbol: repo.symbol };
    case 'map_change_impact':
      return {
        ...base,
        change: repo.change,
        knownFiles: [repo.fileAnchor],
        knownSymbols: [repo.symbol],
      };
    case 'map_impact':
      return {
        ...base,
        anchor: repo.fileAnchor,
        changeType: 'refactor',
        knownSymbols: [repo.symbol],
      };
    case 'explain_code_path':
      return {
        ...base,
        pathQuery: repo.pathFlow,
        entryPoint: repo.fileAnchor,
        knownFiles: [repo.fileAnchor],
        knownSymbols: [repo.symbol],
      };
    case 'collect_evidence':
      return {
        ...base,
        claim: repo.claim,
        knownFiles: [repo.fileAnchor],
        knownSymbols: [repo.symbol],
      };
    case 'review_change_context':
      return {
        ...base,
        reviewGoal: repo.reviewGoal,
        path: repo.fileAnchor,
      };
    case 'find_entrypoints':
      return {
        ...base,
        entryKind: repo.entryKind,
      };
    case 'explore':
      return {
        ...base,
        prompt: `Give a concise architecture report for ${repo.feature}. Include inline file:line citations and flag uncertainty.`,
        language: 'en',
      };
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function summarizeStructured(tool, structuredContent) {
  if (!structuredContent || typeof structuredContent !== 'object') return {};
  if (tool === 'explore') {
    return {
      reportPreview: truncate(structuredContent.report ?? '', 2600),
      citations: (structuredContent.citations ?? []).slice(0, 12),
      targets: (structuredContent.targets ?? []).slice(0, 8),
      filesRead: structuredContent.filesRead ?? [],
      toolsUsed: structuredContent.toolsUsed ?? [],
      critic: structuredContent.critic ?? null,
      searchCoverage: structuredContent.searchCoverage ?? null,
      stats: structuredContent.stats
        ? {
            turns: structuredContent.stats.turns,
            toolCalls: structuredContent.stats.toolCalls,
            filesRead: structuredContent.stats.filesRead,
            grepCalls: structuredContent.stats.grepCalls,
            symbolCalls: structuredContent.stats.symbolCalls,
            stoppedByBudget: structuredContent.stats.stoppedByBudget,
            elapsedMs: structuredContent.stats.elapsedMs,
            totalTokens: structuredContent.stats.totalTokens,
          }
        : null,
    };
  }

  return {
    directAnswer: truncate(structuredContent.directAnswer ?? '', 2200),
    status: structuredContent.status ?? null,
    evidenceQuality: structuredContent.evidenceQuality ?? null,
    failure: structuredContent.failure ?? null,
    nextAction: structuredContent.nextAction ?? null,
    searchCoverage: structuredContent.searchCoverage ?? null,
    critic: structuredContent.critic ?? null,
    sessionId: structuredContent.sessionId ?? null,
    session: structuredContent.session ?? null,
    targets: (structuredContent.targets ?? []).slice(0, 8),
    discoveredPathsCount: Array.isArray(structuredContent.discoveredPaths) ? structuredContent.discoveredPaths.length : 0,
    evidence: (structuredContent.evidence ?? []).slice(0, 8).map(item => ({
      id: item.id,
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      groundingStatus: item.groundingStatus,
      evidenceType: item.evidenceType,
      why: item.why,
      snippet: truncate(item.snippet ?? '', 900),
    })),
    uncertainties: structuredContent.uncertainties ?? [],
    stats: structuredContent._debug?.stats
      ? {
          turns: structuredContent._debug.stats.turns,
          toolCalls: structuredContent._debug.stats.toolCalls,
          filesRead: structuredContent._debug.stats.filesRead,
          grepCalls: structuredContent._debug.stats.grepCalls,
          symbolCalls: structuredContent._debug.stats.symbolCalls,
          stoppedByBudget: structuredContent._debug.stats.stoppedByBudget,
          elapsedMs: structuredContent._debug.stats.elapsedMs,
          totalTokens: structuredContent._debug.stats.totalTokens,
        }
      : null,
  };
}

function markdownCase({ tool, repo, toolInfo, args, elapsedMs, response }) {
  const structured = response?.structuredContent ?? null;
  const summary = summarizeStructured(tool, structured);
  return [
    `# ${tool} on ${repo.key}`,
    '',
    '## Tool Description',
    toolInfo?.description ?? '(missing)',
    '',
    '## Input Schema',
    '```json',
    JSON.stringify(toolInfo?.inputSchema ?? {}, null, 2),
    '```',
    '',
    '## Request',
    '```json',
    JSON.stringify(args, null, 2),
    '```',
    '',
    '## Response Summary',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
    `ElapsedMs: ${elapsedMs}`,
    `McpIsError: ${Boolean(response?.isError)}`,
    '',
  ].join('\n');
}

function markdownPacket(tool, toolInfo, cases) {
  const caseSections = cases.map(item => [
    `## Case ${item.repo}`,
    '',
    '### Request',
    '```json',
    JSON.stringify(item.args, null, 2),
    '```',
    '',
    '### Response',
    '```json',
    JSON.stringify(item.summary, null, 2),
    '```',
  ].join('\n'));

  return [
    `# Code-blind evaluator packet: ${tool}`,
    '',
    'You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.',
    '',
    '## Tool Description',
    toolInfo?.description ?? '(missing)',
    '',
    '## Input Schema',
    '```json',
    JSON.stringify(toolInfo?.inputSchema ?? {}, null, 2),
    '```',
    '',
    ...caseSections,
    '',
  ].join('\n');
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  await fs.mkdir(CASE_DIR, { recursive: true });
  await fs.mkdir(PACKET_DIR, { recursive: true });

  const progressEvents = [];
  const { handleRequest } = createMcpRequestHandler({
    logger: message => {
      process.stderr.write(`[handler] ${message}\n`);
    },
    sendNotification: (method, params) => {
      if (method === 'notifications/progress') {
        progressEvents.push({ t: Date.now(), method, params });
      }
    },
  });

  const list = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  const toolInfos = new Map(list.tools.map(tool => [tool.name, tool]));

  const results = [];
  let id = 10;
  for (const tool of tools) {
    for (const repo of repos) {
      const args = argsFor(tool, repo);
      const started = Date.now();
      process.stderr.write(`[run] ${tool} on ${repo.key}\n`);
      let response;
      let error = null;
      try {
        response = await handleRequest({
          jsonrpc: '2.0',
          id: id++,
          method: 'tools/call',
          params: {
            name: tool,
            arguments: args,
            _meta: { progressToken: `${tool}:${repo.key}` },
          },
        });
      } catch (err) {
        error = { name: err.name, message: err.message, stack: err.stack };
      }
      const elapsedMs = Date.now() - started;
      const summary = summarizeStructured(tool, response?.structuredContent);
      const record = {
        tool,
        repo: repo.key,
        args,
        elapsedMs,
        error,
        isError: Boolean(response?.isError),
        summary,
        structuredContent: response?.structuredContent ?? null,
        contentText: response?.content?.[0]?.text ? truncate(response.content[0].text, 8000) : null,
      };
      results.push(record);
      await writeJson(path.join(CASE_DIR, `${tool}__${repo.key}.json`), record);
      await fs.writeFile(
        path.join(CASE_DIR, `${tool}__${repo.key}.md`),
        markdownCase({ tool, repo, toolInfo: toolInfos.get(tool), args, elapsedMs, response }),
        'utf8',
      );
    }
  }

  for (const tool of tools) {
    const cases = results
      .filter(item => item.tool === tool)
      .map(item => ({
        repo: item.repo,
        args: item.args,
        summary: item.summary,
        elapsedMs: item.elapsedMs,
        isError: item.isError,
        error: item.error,
      }));
    await fs.writeFile(
      path.join(PACKET_DIR, `${tool}.md`),
      markdownPacket(tool, toolInfos.get(tool), cases),
      'utf8',
    );
  }

  const aggregate = {
    runId: RUN_ID,
    outDir: OUT_DIR,
    toolCount: tools.length,
    repoCount: repos.length,
    caseCount: results.length,
    tools,
    repos: repos.map(({ key, root, scope }) => ({ key, root, scope })),
    results: results.map(({ structuredContent, contentText, ...rest }) => rest),
    progressEvents,
  };
  await writeJson(path.join(OUT_DIR, 'summary.json'), aggregate);
  await writeJson(path.join(OUT_DIR, 'tools-list.json'), list.tools);
  console.log(JSON.stringify({ outDir: OUT_DIR, caseCount: results.length }, null, 2));
}

try {
  await main();
} finally {
  globalSessionStore.destroy();
}
