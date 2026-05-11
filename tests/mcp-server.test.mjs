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
          answer: 'users/me 라우트는 requireAuth를 거친 뒤 처리된다.',
          summary: 'user.js가 auth.js의 requireAuth를 연결한다.',
          confidence: 'high',
          evidence: [
            {
              path: 'src/routes/user.js',
              startLine: 1,
              endLine: 5,
              why: '라우트가 requireAuth를 import하고 연결한다.',
            },
            {
              path: 'src/auth.js',
              startLine: 1,
              endLine: 4,
              why: 'requireAuth 구현이 여기 있다.',
            },
          ],
          candidatePaths: ['src/routes/user.js', 'src/auth.js'],
          followups: [],
        }),
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
  assert.ok(!toolNames.includes('explore_v2'), 'explore_v2 must be opt-in');
  const exploreRepoTool = listed.tools.find(t => t.name === 'explore_repo');
  assert.match(exploreRepoTool.description, /Use FIRST/);
  assert.match(exploreRepoTool.description, /Pass sessionId as "session"/);
  assert.match(exploreRepoTool.inputSchema.properties.budget.description, /Advanced only/);
  assert.ok(exploreRepoTool.outputSchema.properties.targets, 'explore_repo must expose outputSchema targets');
  assert.equal(exploreRepoTool.outputSchema.additionalProperties, false);
  assert.equal(exploreRepoTool.outputSchema.properties.answer, undefined);
  for (const toolName of [
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'review_change_context',
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
        budget: 'quick',
      },
    },
  });

  assert.ok(['medium', 'high'].includes(called.structuredContent.status.confidence), `confidence must be medium or high, got: ${called.structuredContent.status.confidence}`);
  assert.match(called.structuredContent.directAnswer, /requireAuth/);
  assert.equal(called.structuredContent.answer, undefined);
  assert.equal(called.structuredContent.candidatePaths, undefined);
  assert.equal(called.structuredContent.stats, undefined);
  assert.equal(called.structuredContent.status.verification, 'verified');
  assert.equal(called.structuredContent.targets.length, 2);
  assert.equal(called.structuredContent.evidence.length, 2);
  assert.ok(called.structuredContent.evidence.every(item => item.id && item.snippet), 'evidence must include ids and snippets');
  assert.ok(called.structuredContent.sessionId.startsWith('sess_'), 'sessionId must be top-level');
  assert.ok(called.structuredContent._debug.stats, '_debug.stats must be populated');
  assert.equal(Object.hasOwn(called.structuredContent._debug, 'legacy'), false);
  assert.match(called.content[0].text, /requireAuth/);
  assert.match(called.content[0].text, /## Targets/);
  assert.match(called.content[0].text, /snippet:/);
  assert.doesNotMatch(called.content[0].text, /## Stats/);
  assert.doesNotMatch(called.content[0].text, /stats\.sessionId/);
});

test('MCP request handler declares read-only annotations for every exposed tool shape', async () => {
  const cases = [
    {
      name: 'default',
      env: {
        CEREBRAS_EXPLORER_EXTRA_TOOLS: undefined,
        CEREBRAS_EXPLORER_ENABLE_EXPLORE: undefined,
        CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2: undefined,
      },
      expectedNames: [
        'find_relevant_code',
        'trace_symbol',
        'map_change_impact',
        'explain_code_path',
        'collect_evidence',
        'review_change_context',
        'explore_repo',
        'explore',
      ],
    },
    {
      name: 'v2 enabled',
      env: {
        CEREBRAS_EXPLORER_EXTRA_TOOLS: undefined,
        CEREBRAS_EXPLORER_ENABLE_EXPLORE: undefined,
        CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2: 'true',
      },
      expectedNames: [
        'find_relevant_code',
        'trace_symbol',
        'map_change_impact',
        'explain_code_path',
        'collect_evidence',
        'review_change_context',
        'explore_repo',
        'explore',
        'explore_v2',
      ],
    },
    {
      name: 'extra tools disabled',
      env: {
        CEREBRAS_EXPLORER_EXTRA_TOOLS: 'false',
        CEREBRAS_EXPLORER_ENABLE_EXPLORE: undefined,
        CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2: undefined,
      },
      expectedNames: ['explore_repo', 'explore'],
    },
    {
      name: 'minimum tool surface',
      env: {
        CEREBRAS_EXPLORER_EXTRA_TOOLS: 'false',
        CEREBRAS_EXPLORER_ENABLE_EXPLORE: 'false',
        CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2: undefined,
      },
      expectedNames: ['explore_repo'],
    },
  ];

  for (const testCase of cases) {
    const tools = await listToolsWithEnv(testCase.env);
    assert.deepEqual(
      tools.map(tool => tool.name),
      testCase.expectedNames,
      `${testCase.name} tool names must match expected exposed surface`,
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
        budget: 'quick',
      },
    },
  });

  assert.equal(called.isError, true);
  assert.match(called.content[0].text, /explore_repo execution failed/i);
  assert.match(called.content[0].text, /provider exploded/);
  assert.doesNotMatch(called.content[0].text, /Invalid explore_repo arguments/);
  assert.doesNotMatch(called.content[0].text, /Invalid arguments for explore_repo/);
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

test('MCP request handler exposes explore_v2 only when explicitly enabled', async () => {
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

    process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2 = 'true';
    handler = createMcpRequestHandler().handleRequest;
    listed = await handler({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/list',
      params: {},
    });
    assert.ok(listed.tools.map(tool => tool.name).includes('explore_v2'));
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
        budget: 'quick',
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
