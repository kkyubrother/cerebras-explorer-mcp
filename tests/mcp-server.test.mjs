import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMcpRequestHandler } from '../src/mcp/server.mjs';
import { getRepoRoot } from '../src/explorer/config.mjs';

async function makeRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-mcp-server-'));
  await fs.mkdir(path.join(root, 'src', 'routes'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    [
      'export function requireAuth(req, res, next) {',
      '  if (!req.user) throw new Error("unauthorized");',
      '  next();',
      '}',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(root, 'src', 'routes', 'user.js'),
    [
      'import { requireAuth } from "../auth.js";',
      '',
      'export function registerUserRoutes(app) {',
      '  app.get("/users/me", requireAuth, (req, res) => {',
      '    res.json({ id: req.user.id });',
      '  });',
      '}',
    ].join('\n'),
  );
  return root;
}

class MockChatClient {
  constructor() {
    this.model = 'zai-glm-4.7';
    this.calls = 0;
  }

  async createChatCompletion() {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
        message: {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              function: {
                name: 'repo_grep',
                arguments: JSON.stringify({ pattern: 'requireAuth', scope: ['src/**'] }),
              },
            },
          ],
        },
      };
    }
    if (this.calls === 2) {
      return {
        usage: { prompt_tokens: 90, completion_tokens: 20, total_tokens: 110 },
        message: {
          content: '',
          toolCalls: [
            {
              id: 'call-2',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 5 }),
              },
            },
            {
              id: 'call-3',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            },
          ],
        },
      };
    }
    return {
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      message: {
        content: JSON.stringify({
          directAnswer: 'users/me 라우트는 requireAuth를 거친 뒤 처리된다.',
          status: { confidence: 'high', verification: 'verified', complete: true, warnings: [] },
          targets: [],
          evidence: [
            {
              path: 'src/routes/user.js',
              startLine: 1,
              endLine: 5,
              why: '라우트가 requireAuth를 import하고 연결한다.',
              snippet: '1: FORGED_BY_MODEL();',
            },
            {
              path: 'src/auth.js',
              startLine: 1,
              endLine: 4,
              why: 'requireAuth 구현이 여기 있다.',
              snippet: '1: FORGED_BY_MODEL();',
            },
          ],
          uncertainties: [],
          nextAction: { type: 'stop', reason: 'Complete.' },
        }),
        toolCalls: [],
      },
    };
  }
}

class MarkdownReportClient {
  constructor(report) {
    this.model = 'mock';
    this.report = report;
  }

  async createChatCompletion() {
    return {
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      finishReason: 'stop',
      message: {
        content: this.report,
        toolCalls: [],
      },
    };
  }
}

function applyEnvPatch(patch) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function listToolsWithEnv(envPatch) {
  const restore = applyEnvPatch(envPatch);
  try {
    const { handleRequest } = createMcpRequestHandler();
    const listed = await handleRequest({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/list',
      params: {},
    });
    return listed.tools;
  } finally {
    restore();
  }
}

function assertReadOnlyAnnotations(tool) {
  assert.ok(tool.annotations, `${tool.name} must declare annotations`);
  assert.equal(tool.annotations.title, tool.title, `${tool.name} annotation title must match tool title`);
  assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must be read-only`);
  assert.equal(tool.annotations.destructiveHint, false, `${tool.name} must not be destructive`);
  assert.equal(tool.annotations.idempotentHint, true, `${tool.name} must be idempotent`);
  assert.equal(tool.annotations.openWorldHint, true, `${tool.name} must disclose provider API egress`);
}

// spec 011: shouldUseV2ForExplore router was removed. All explore calls route
// to the (formerly V2) backend unconditionally, so the previous routing tests
// are no longer applicable.

test('MCP request handler exposes explore_repo and returns structuredContent', async () => {
  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MockChatClient(),
    },
  });

  const initialized = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
  });
  assert.equal(initialized.serverInfo.name, 'cerebras-explorer-mcp');
  assert.equal(initialized.serverInfo.version, '0.4.0');

  const listed = await handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  assert.equal(Array.isArray(listed.tools), true);
  const toolNames = listed.tools.map(t => t.name);
  assert.ok(toolNames.includes('explore_repo'), 'explore_repo must be in tool list');
  // Extra tools are on by default
  assert.ok(toolNames.includes('find_relevant_code'), 'find_relevant_code must be in tool list');
  assert.ok(toolNames.includes('trace_symbol'), 'trace_symbol must be in tool list');
  assert.ok(toolNames.includes('map_change_impact'), 'map_change_impact must be in tool list');
  assert.ok(toolNames.includes('explain_code_path'), 'explain_code_path must be in tool list');
  assert.ok(toolNames.includes('collect_evidence'), 'collect_evidence must be in tool list');
  assert.ok(toolNames.includes('review_change_context'), 'review_change_context must be in tool list');
  assert.ok(!toolNames.includes('explain_symbol'), 'removed shortcut explain_symbol must not be exposed');
  assert.ok(!toolNames.includes('trace_dependency'), 'removed shortcut trace_dependency must not be exposed');
  assert.ok(!toolNames.includes('summarize_changes'), 'removed shortcut summarize_changes must not be exposed');
  assert.ok(!toolNames.includes('find_similar_code'), 'removed shortcut find_similar_code must not be exposed');
  assert.ok(!toolNames.includes('explore_v2'), 'explore_v2 tool name was removed in spec 011');
  const exploreRepoTool = listed.tools.find(t => t.name === 'explore_repo');
  assert.match(exploreRepoTool.description, /Use FIRST/);
  assert.match(exploreRepoTool.description, /Pass sessionId as "session"/);
  // spec 011: budget input was removed; every call runs against the single deep runtime config.
  assert.equal(exploreRepoTool.inputSchema.properties.budget, undefined, 'budget input was removed in spec 011');
  assert.ok(exploreRepoTool.outputSchema.properties.targets, 'explore_repo must expose outputSchema targets');
  assert.equal(exploreRepoTool.outputSchema.additionalProperties, false);
  assert.equal(exploreRepoTool.outputSchema.properties.answer, undefined);
  for (const toolName of [
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'map_impact',
    'explain_code_path',
    'collect_evidence',
    'review_change_context',
    'find_entrypoints',
  ]) {
    const tool = listed.tools.find(t => t.name === toolName);
    assert.equal(tool.inputSchema.properties.language, undefined, `${toolName} must not expose language`);
    assert.equal(tool.inputSchema.properties.context, undefined, `${toolName} must not expose context`);
  }

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: 'users/me 라우트에 인증 미들웨어가 어떻게 붙는지 추적해라.',
        repo_root: repoRoot,
        scope: ['src/**'],
      },
    },
  });

  assert.ok(['medium', 'high'].includes(called.structuredContent.status.confidence), `confidence must be medium or high, got: ${called.structuredContent.status.confidence}`);
  assert.match(called.structuredContent.directAnswer, /requireAuth/);
  assert.equal(called.structuredContent.answer, undefined);
  assert.equal(called.structuredContent.candidatePaths, undefined);
  assert.equal(called.structuredContent.citations, undefined);
  assert.equal(called.structuredContent.stats, undefined);
  assert.equal(called.structuredContent.status.verification, 'verified');
  assert.equal(called.structuredContent.targets.length, 2);
  assert.equal(called.structuredContent.evidence.length, 2);
  assert.equal(called.structuredContent.schemaVersion, 1);
  assert.equal(called.structuredContent.failure, null);
  assert.equal(called.structuredContent.evidenceQuality.level, called.structuredContent.status.confidence);
  assert.equal(called.structuredContent.evidenceQuality.exactCount, 2);
  assert.equal(called.structuredContent.evidenceQuality.fileCount, 2);
  assert.deepEqual(called.structuredContent.searchCoverage.scope, ['src/**']);
  assert.equal(called.structuredContent.searchCoverage.scopeLimited, true);
  assert.ok(called.structuredContent.evidence.every(item => item.id && item.snippet), 'evidence must include ids and snippets');
  assert.ok(called.structuredContent.sessionId.startsWith('sess_'), 'sessionId must be top-level');
  assert.deepEqual(called.structuredContent.session, {
    id: called.structuredContent.sessionId,
    status: 'created',
    remainingCalls: 4,
  });
  assert.ok(called.structuredContent._debug.stats, '_debug.stats must be populated');
  assert.equal(Object.hasOwn(called.structuredContent._debug, 'legacy'), false);
  assert.match(called.content[0].text, /requireAuth/);
  assert.match(called.content[0].text, /Evidence Quality/);
  assert.match(called.content[0].text, /Search Coverage/);
  assert.match(called.content[0].text, /## Targets/);
  assert.match(called.content[0].text, /snippet:/);
  assert.doesNotMatch(called.content[0].text, /FORGED_BY_MODEL/);
  assert.ok(called.structuredContent.evidence.every(item => !item.snippet.includes('FORGED_BY_MODEL')), 'model-supplied snippets are not returned');
  assert.doesNotMatch(called.content[0].text, /## Stats/);
  assert.doesNotMatch(called.content[0].text, /stats\.sessionId/);
});

test('MCP request handler exposes fallback session when supplied session is exhausted', async () => {
  const repoRoot = await makeRepoFixture();
  const { SessionStore } = await import('../src/explorer/session.mjs');
  const sessionStore = new SessionStore({ maxCalls: 1 });
  const { handleRequest } = createMcpRequestHandler({
    sessionStore,
    runtimeOptions: {
      chatClient: new MockChatClient(),
    },
  });

  const first = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: '첫 번째 호출',
        repo_root: repoRoot,
        scope: ['src/**'],
      },
    },
  });

  const exhaustedId = first.structuredContent.session.id;

  const second = await handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: '두 번째 호출',
        repo_root: repoRoot,
        scope: ['src/**'],
        session: exhaustedId,
      },
    },
  });

  assert.equal(second.structuredContent.session.status, 'fallback');
  assert.notEqual(second.structuredContent.session.id, exhaustedId);
  assert.equal(second.structuredContent.session.id, second.structuredContent.sessionId);
  assert.equal(second.structuredContent.session.remainingCalls, 0);
});

test('explore returns Markdown text plus structured citations', async () => {
  const repoRoot = await makeRepoFixture();
  const report = 'Summary cites `src/auth.js:L1-L3` and `src/routes/user.js:L2`.';
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MarkdownReportClient(report),
    },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 30,
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: {
        prompt: 'explain auth flow with citations',
        repo_root: repoRoot,
        thoroughness: 'quick',
      },
    },
  });

  assert.equal(called.content[0].text, report);
  assert.deepEqual(called.structuredContent.citations.map(item => ({
    type: item.type,
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
  })), [
    { type: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 3 },
    { type: 'file_range', path: 'src/routes/user.js', startLine: 2, endLine: 2 },
  ]);
  assert.equal(called.structuredContent.targets[0].role, 'reference');
});

test('011 US1 — explore tool name explore_v2 is not exposed under any env', async () => {
  const repoRoot = await makeRepoFixture();
  const report = 'Summary cites `src/auth.js:L1-L3`.';
  // Even with the legacy opt-in envvar set, the explore_v2 tool name must not appear.
  const restore = applyEnvPatch({ CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2: 'true' });
  try {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: { chatClient: new MarkdownReportClient(report) },
    });
    const listed = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const toolNames = listed.tools.map(t => t.name);
    assert.ok(!toolNames.includes('explore_v2'), `explore_v2 must not be exposed (got ${toolNames.join(',')})`);
    // Calling it by name must be rejected as an unknown tool.
    await assert.rejects(
      handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'explore_v2', arguments: { prompt: 'noop', repo_root: repoRoot } },
      }),
      /Unknown tool: explore_v2/,
    );
  } finally {
    restore();
  }
});

test('explore redacts deny-listed paths consistently in both surfaces', async () => {
  const repoRoot = await makeRepoFixture();
  const report = 'Secret `secrets/.env.production:L1` and public `src/auth.js:L1`.';
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MarkdownReportClient(report),
    },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 32,
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: {
        prompt: 'explain auth flow with secret citation',
        repo_root: repoRoot,
        thoroughness: 'quick',
      },
    },
  });

  assert.doesNotMatch(called.content[0].text, /secrets\/\.env\.production/);
  assert.match(called.content[0].text, /\[REDACTED:secret-path\]/);
  assert.equal(called.structuredContent.citations[0].path, '[REDACTED:secret-path]');
  assert.equal(called.structuredContent.citations[1].path, 'src/auth.js');
});

test('explore with empty-citation report exposes citations: [] in structuredContent', async () => {
  const repoRoot = await makeRepoFixture();
  const report = 'No file references here.';
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MarkdownReportClient(report),
    },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 33,
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: {
        prompt: 'write a report without citations',
        repo_root: repoRoot,
        thoroughness: 'quick',
      },
    },
  });

  assert.equal(called.content[0].text, report);
  assert.deepEqual(called.structuredContent.citations, []);
  assert.equal(Array.isArray(called.structuredContent.targets), true);
  assert.deepEqual(called.structuredContent.targets, []);
});

test('collect_evidence wrapper uses evidence verification mode instead of edit regex fallback', async () => {
  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new MockChatClient() },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 88,
    method: 'tools/call',
    params: {
      name: 'collect_evidence',
      arguments: {
        claim: 'update code behavior is already documented',
        repo_root: repoRoot,
        scope: ['src/**'],
      },
    },
  });

  assert.equal(called.structuredContent.status.verification, 'verified');
});

test('MCP request handler declares read-only annotations for the fixed 10-tool surface', async () => {
  // spec 013: tool surface is fixed at 10 (spec 011 added 8; spec 013 added
  // map_impact and find_entrypoints) regardless of legacy envvars.
  const expectedNames = [
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'map_impact',
    'explain_code_path',
    'collect_evidence',
    'review_change_context',
    'find_entrypoints',
    'explore_repo',
    'explore',
  ];

  const envScenarios = [
    { name: 'default', env: {} },
    {
      name: 'legacy envvars are ignored',
      env: {
        CEREBRAS_EXPLORER_EXTRA_TOOLS: 'false',
        CEREBRAS_EXPLORER_ENABLE_EXPLORE: 'false',
        CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2: 'true',
      },
    },
  ];

  for (const scenario of envScenarios) {
    const tools = await listToolsWithEnv(scenario.env);
    assert.deepEqual(
      tools.map(tool => tool.name),
      expectedNames,
      `${scenario.name}: tool surface is fixed at 10 regardless of legacy envvars`,
    );
    for (const tool of tools) assertReadOnlyAnnotations(tool);
  }
});

test('MCP request handler returns repo_root resolution errors without mislabeling them as generic argument errors', async () => {
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MockChatClient(),
    },
  });

  const rawRepoRoot = process.platform === 'win32'
    ? '/c/Users/daeryun/definitely-missing-cerebras-explorer-repo'
    : '/definitely/missing/cerebras-explorer-repo';
  const normalizedRepoRoot = getRepoRoot(rawRepoRoot);

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: '없는 저장소 경로를 진단해라.',
        repo_root: rawRepoRoot,
      },
    },
  });

  assert.equal(called.isError, true);
  assert.match(called.content[0].text, /Unable to resolve repo_root for explore_repo/);
  assert.match(called.content[0].text, new RegExp(normalizedRepoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(called.content[0].text, /Invalid explore_repo arguments/);
  assert.equal(called.structuredContent.failure.category, 'input');
  assert.equal(called.structuredContent.failure.reason, 'repo_mismatch');
});

test('MCP request handler classifies generic invalid params separately from session errors', async () => {
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MockChatClient(),
    },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 44,
    method: 'tools/call',
    params: {
      name: 'trace_symbol',
      arguments: {},
    },
  });

  assert.equal(called.isError, true);
  assert.match(called.content[0].text, /Invalid arguments for trace_symbol/);
  assert.equal(called.structuredContent.schemaVersion, 1);
  assert.equal(called.structuredContent.failure.category, 'input');
  assert.equal(called.structuredContent.failure.reason, 'invalid_arguments');
  assert.equal(called.structuredContent.failure.retry, null);
  assert.equal(called.structuredContent.evidenceQuality.level, 'low');
});

test('MCP request handler rejects unknown wrapper arguments before runtime execution', async (t) => {
  class ShouldNotRunChatClient {
    constructor() {
      this.model = 'zai-glm-4.7';
    }

    async createChatCompletion() {
      throw new Error('runtime should not be invoked for invalid wrapper arguments');
    }
  }

  const WRAPPER_MATRIX = [
    {
      tool: 'find_relevant_code',
      args: { query: 'where is auth applied' },
      unknownKey: 'extraneousField',
    },
    {
      tool: 'trace_symbol',
      args: { symbol: 'requireAuth' },
      unknownKey: 'context',
    },
    {
      tool: 'map_change_impact',
      args: { change: 'rename requireAuth' },
      unknownKey: 'unexpected',
    },
    {
      tool: 'map_impact',
      args: { anchor: 'src/auth.js' },
      unknownKey: 'reasonForChange',
    },
    {
      tool: 'explain_code_path',
      args: { pathQuery: 'login request flow' },
      unknownKey: 'flowType',
    },
    {
      tool: 'collect_evidence',
      args: { claim: 'tokens are revoked on logout' },
      unknownKey: 'priority',
    },
    {
      tool: 'review_change_context',
      args: { reviewGoal: 'audit auth refactor' },
      unknownKey: 'severity',
    },
    {
      tool: 'find_entrypoints',
      args: {},
      unknownKey: 'targetLanguage',
    },
  ];

  for (const [index, { tool, args, unknownKey }] of WRAPPER_MATRIX.entries()) {
    await t.test(`rejects unknown ${tool} argument: ${unknownKey}`, async () => {
      const { handleRequest } = createMcpRequestHandler({
        runtimeOptions: {
          chatClient: new ShouldNotRunChatClient(),
        },
      });

      const called = await handleRequest({
        jsonrpc: '2.0',
        id: 100 + index,
        method: 'tools/call',
        params: {
          name: tool,
          arguments: {
            ...args,
            [unknownKey]: 'rejected-by-validator',
          },
        },
      });

      assert.equal(called.isError, true);
      // Keep names ASCII so RegExp escape is unnecessary.
      assert.match(called.content[0].text, new RegExp(`Invalid arguments for ${tool}`));
      assert.match(called.content[0].text, new RegExp(`Unknown ${tool} argument: ${unknownKey}`));
      assert.doesNotMatch(called.content[0].text, /runtime should not be invoked/);
      assert.equal(called.structuredContent.failure.category, 'input');
      assert.equal(called.structuredContent.failure.reason, 'invalid_arguments');
    });
  }
});

test('map_impact rejects missing or empty anchor argument before runtime dispatch', async () => {
  class ShouldNotRunChatClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion() {
      throw new Error('runtime should not be invoked for invalid map_impact arguments');
    }
  }

  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new ShouldNotRunChatClient() },
  });

  for (const [index, args] of [{}, { anchor: '' }, { anchor: '   ' }].entries()) {
    const called = await handleRequest({
      jsonrpc: '2.0',
      id: 220 + index,
      method: 'tools/call',
      params: { name: 'map_impact', arguments: args },
    });
    assert.equal(called.isError, true, `case ${index}: must error on missing/empty anchor`);
    assert.match(called.content[0].text, /map_impact requires a non-empty "anchor"/);
    assert.equal(called.structuredContent.failure.category, 'input');
    assert.equal(called.structuredContent.failure.reason, 'invalid_arguments');
  }
});

test('find_entrypoints rejects unknown entryKind via enum schema before runtime dispatch', async () => {
  class ShouldNotRunChatClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion() {
      throw new Error('runtime should not be invoked for invalid find_entrypoints arguments');
    }
  }

  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new ShouldNotRunChatClient() },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 230,
    method: 'tools/call',
    params: { name: 'find_entrypoints', arguments: { entryKind: 'unknown_kind' } },
  });
  assert.equal(called.isError, true);
  assert.match(called.content[0].text, /Invalid arguments for find_entrypoints/);
  assert.match(called.content[0].text, /entryKind must be one of/);
  assert.equal(called.structuredContent.failure.category, 'input');
  assert.equal(called.structuredContent.failure.reason, 'invalid_arguments');
});

test('MCP request handler returns execution failures for explore_repo without mislabeling them as argument errors', async () => {
  class ThrowingChatClient {
    constructor() {
      this.model = 'zai-glm-4.7';
    }

    async createChatCompletion() {
      throw new Error('provider exploded');
    }
  }

  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new ThrowingChatClient(),
    },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: '런타임 실패를 재현해라.',
        repo_root: repoRoot,
      },
    },
  });

  assert.equal(called.isError, true);
  assert.match(called.content[0].text, /explore_repo execution failed/i);
  assert.match(called.content[0].text, /provider exploded/);
  assert.doesNotMatch(called.content[0].text, /Invalid explore_repo arguments/);
  assert.doesNotMatch(called.content[0].text, /Invalid arguments for explore_repo/);
  assert.equal(called.structuredContent.schemaVersion, 1);
  assert.equal(called.structuredContent.status.verification, 'broad_search_needed');
  assert.equal(called.structuredContent.failure.category, 'provider');
  assert.equal(called.structuredContent.failure.reason, 'provider_error');
  assert.equal(called.structuredContent.failure.retry.tool, 'explore_repo');
  assert.deepEqual(called.structuredContent.failure.retry.args, {
    task: 'Retry after the provider recovers, or narrow the task and scope.',
    scope: [],
  });
  assert.equal(
    called.structuredContent.failure.retry.expectedImprovement,
    'A provider recovery or narrower scope should reduce failure risk.',
  );
  assert.equal(called.structuredContent.evidenceQuality.level, 'low');
});

test('MCP request handler returns execution failures for other exposed tools as MCP errors', async () => {
  class ThrowingChatClient {
    constructor() {
      this.model = 'zai-glm-4.7';
    }

    async createChatCompletion() {
      throw new Error('provider exploded');
    }
  }

  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new ThrowingChatClient(),
    },
  });

  const cases = [
    {
      name: 'explore',
      arguments: { prompt: '런타임 실패를 재현해라.', repo_root: repoRoot, thoroughness: 'quick' },
    },
    {
      name: 'trace_symbol',
      arguments: { symbol: 'requireAuth', repo_root: repoRoot },
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const called = await handleRequest({
      jsonrpc: '2.0',
      id: 100 + index,
      method: 'tools/call',
      params: testCase,
    });

    assert.equal(called.isError, true, `${testCase.name} must return an MCP tool error`);
    assert.match(called.content[0].text, new RegExp(`${testCase.name} execution failed`, 'i'));
    assert.match(called.content[0].text, /provider exploded/);
    assert.doesNotMatch(called.content[0].text, /Invalid arguments for/);
  }
});

test('011 — explore_v2 tool name is gone regardless of envvar', async () => {
  const previous = process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2;
  try {
    delete process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2;
    let handler = createMcpRequestHandler().handleRequest;
    let listed = await handler({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/list',
      params: {},
    });
    assert.ok(!listed.tools.map(tool => tool.name).includes('explore_v2'));

    // spec 011: envvar is ignored, explore_v2 still must not appear.
    process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2 = 'true';
    handler = createMcpRequestHandler().handleRequest;
    listed = await handler({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/list',
      params: {},
    });
    assert.ok(!listed.tools.map(tool => tool.name).includes('explore_v2'));
  } finally {
    if (previous === undefined) delete process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2;
    else process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2 = previous;
  }
});

test('MCP request handler sends progress notifications when progressToken is 0', async () => {
  const repoRoot = await makeRepoFixture();
  const notifications = [];
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MockChatClient(),
    },
    sendNotification: (method, params) => {
      notifications.push({ method, params });
    },
  });

  await handleRequest({
    jsonrpc: '2.0',
    id: 200,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: 'users/me 라우트에 인증 미들웨어가 어떻게 붙는지 추적해라.',
        repo_root: repoRoot,
        scope: ['src/**'],
      },
      _meta: {
        progressToken: 0,
      },
    },
  });

  assert.ok(notifications.length > 0, 'progress notifications must be emitted for progressToken=0');
  assert.ok(
    notifications.every(notification => notification.method === 'notifications/progress'),
    'all emitted notifications must be progress notifications',
  );
  assert.ok(
    notifications.every(notification => notification.params.progressToken === 0),
    'progressToken=0 must be preserved in emitted notifications',
  );
});
