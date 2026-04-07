import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ExplorerRuntime } from '../src/explorer/runtime.mjs';

async function makeRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-runtime-'));
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

  async createChatCompletion({ messages }) {
    this.calls += 1;

    if (this.calls === 1) {
      return {
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
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
      const lastToolMessage = messages[messages.length - 1];
      assert.equal(lastToolMessage.role, 'tool');
      assert.match(lastToolMessage.content, /requireAuth/);
      return {
        usage: { prompt_tokens: 110, completion_tokens: 20, total_tokens: 130 },
        message: {
          content: '',
          toolCalls: [
            {
              id: 'call-2',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 6 }),
              },
            },
          ],
        },
      };
    }

    if (this.calls === 3) {
      const lastToolMessage = messages[messages.length - 1];
      assert.equal(lastToolMessage.role, 'tool');
      assert.match(lastToolMessage.content, /\/users\/me/);
      return {
        usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 },
        message: {
          content: '',
          toolCalls: [
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
      usage: { prompt_tokens: 130, completion_tokens: 40, total_tokens: 170 },
      message: {
        content: JSON.stringify({
          answer:
            'registerUserRoutes는 /users/me 라우트에 requireAuth 미들웨어를 직접 연결한다.',
          summary:
            'auth.js에서 requireAuth를 정의하고, user.js에서 이를 import해 /users/me에 적용한다.',
          confidence: 'high',
          evidence: [
            {
              path: 'src/routes/user.js',
              startLine: 1,
              endLine: 4,
              why: '라우트가 requireAuth를 import하고 /users/me에 연결한다.',
            },
            {
              path: 'src/auth.js',
              startLine: 1,
              endLine: 4,
              why: 'requireAuth의 실제 동작이 여기 정의되어 있다.',
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

test('ExplorerRuntime performs an autonomous tool loop and returns structured findings', async () => {
  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });

  const result = await runtime.explore({
    task: 'users/me 라우트에 인증 미들웨어가 어떻게 붙는지 추적해라.',
    repo_root: repoRoot,
    scope: ['src/**'],
    budget: 'quick',
  });

  assert.equal(result.confidence, 'high');
  assert.match(result.answer, /requireAuth/);
  assert.equal(result.evidence.length, 2);
  assert.equal(result.stats.toolCalls, 3);
  assert.equal(result.stats.grepCalls, 1);
  assert.equal(result.stats.filesRead, 2);
  assert.equal(result.candidatePaths.includes('src/routes/user.js'), true);
});
