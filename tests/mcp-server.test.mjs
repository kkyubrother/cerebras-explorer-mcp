import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMcpRequestHandler } from '../src/mcp/server.mjs';

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
  assert.ok(toolNames.includes('explain_symbol'), 'explain_symbol must be in tool list');
  assert.ok(toolNames.includes('trace_dependency'), 'trace_dependency must be in tool list');
  assert.ok(toolNames.includes('summarize_changes'), 'summarize_changes must be in tool list');
  assert.ok(toolNames.includes('find_similar_code'), 'find_similar_code must be in tool list');

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

  assert.equal(called.structuredContent.confidence, 'high');
  assert.equal(called.structuredContent.evidence.length, 2);
  assert.match(called.content[0].text, /requireAuth/);
});
