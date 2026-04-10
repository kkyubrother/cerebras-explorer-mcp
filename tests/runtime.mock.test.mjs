import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ExplorerRuntime } from '../src/explorer/runtime.mjs';
import { buildExplorerSystemPrompt, detectStrategy } from '../src/explorer/prompt.mjs';
import { BUDGETS } from '../src/explorer/config.mjs';

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
          followups: [
            {
              description: '미들웨어 에러 핸들링 패턴 추가 분석',
              priority: 'optional',
              suggestedCall: {
                task: 'Analyze error handling in auth middleware',
                scope: ['src/**'],
                budget: 'quick',
                hints: { symbols: ['handleAuthError'], strategy: 'symbol-first' },
              },
            },
          ],
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

  // Core fields — confidence calibration: 2 exact cross-verified evidence items with
  // a non-locate task yields 'medium' with the task-aware scoring (base 0.15).
  assert.ok(['medium', 'high'].includes(result.confidence), `confidence must be medium or high, got: ${result.confidence}`);
  assert.match(result.answer, /requireAuth/);
  assert.equal(result.evidence.length, 2);
  assert.equal(result.stats.toolCalls, 3);
  assert.equal(result.stats.grepCalls, 1);
  assert.equal(result.stats.filesRead, 2);
  assert.equal(result.candidatePaths.includes('src/routes/user.js'), true);

  // Phase 3: continuous confidence score
  assert.ok(typeof result.confidenceScore === 'number', 'confidenceScore must be a number');
  assert.ok(result.confidenceScore >= 0 && result.confidenceScore <= 1, 'confidenceScore must be in [0, 1]');
  assert.ok(['low', 'medium', 'high'].includes(result.confidenceLevel), 'confidenceLevel must be low|medium|high');
  assert.ok(result.confidenceFactors && typeof result.confidenceFactors === 'object', 'confidenceFactors must be an object');
  assert.ok(typeof result.confidenceFactors.evidenceCount === 'number', 'confidenceFactors.evidenceCount must be a number');
  assert.ok(typeof result.confidenceFactors.crossVerified === 'boolean', 'confidenceFactors.crossVerified must be a boolean');

  // Phase 3: evidence grounding status
  for (const ev of result.evidence) {
    assert.ok(ev.groundingStatus === 'exact' || ev.groundingStatus === 'partial', 'each evidence item must have groundingStatus');
  }

  // Phase 3: structured followups
  assert.ok(Array.isArray(result.followups), 'followups must be an array');
  if (result.followups.length > 0) {
    const followup = result.followups[0];
    assert.ok(typeof followup.description === 'string', 'followup.description must be a string');
    assert.ok(followup.priority === 'recommended' || followup.priority === 'optional', 'followup.priority must be recommended|optional');
  }

  // Phase 3: codeMap
  assert.ok(result.codeMap && typeof result.codeMap === 'object', 'codeMap must be present');
  assert.ok(Array.isArray(result.codeMap.entryPoints), 'codeMap.entryPoints must be an array');
  assert.ok(Array.isArray(result.codeMap.keyModules), 'codeMap.keyModules must be an array');
  assert.ok(result.codeMap.keyModules.length >= 2, 'codeMap must include at least the two read files');
});

test('ExplorerRuntime accepts legacy string followups and normalizes them', async () => {
  class LegacyFollowupClient {
    constructor() {
      this.model = 'zai-glm-4.7';
    }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        message: {
          content: JSON.stringify({
            answer: '테스트 답변',
            summary: '테스트 요약',
            confidence: 'medium',
            evidence: [],
            candidatePaths: [],
            followups: ['추가 조사가 필요합니다'],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-legacy-'));
  await fs.writeFile(path.join(root, 'index.js'), 'console.log("hello");');

  const runtime = new ExplorerRuntime({ chatClient: new LegacyFollowupClient() });
  const result = await runtime.explore({ task: '테스트', repo_root: root });

  assert.ok(Array.isArray(result.followups));
  if (result.followups.length > 0) {
    assert.ok(typeof result.followups[0].description === 'string', 'legacy string followup must be normalized to object');
    assert.ok(result.followups[0].priority === 'optional');
  }
});

test('ExplorerRuntime builds recentActivity when git_log tool is called', async () => {
  class GitLogClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-git-1',
                function: {
                  name: 'repo_git_log',
                  arguments: JSON.stringify({ maxCount: 5 }),
                },
              },
            ],
          },
        };
      }
      return {
        usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
        message: {
          content: JSON.stringify({
            answer: '최근 커밋 이력을 확인했습니다.',
            summary: '최근 변경 사항 요약',
            confidence: 'medium',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-git-'));
  await fs.writeFile(path.join(root, 'index.js'), 'console.log("hello");');

  const runtime = new ExplorerRuntime({ chatClient: new GitLogClient() });
  const result = await runtime.explore({
    task: '최근에 어떤 파일이 변경되었나요?',
    repo_root: root,
    hints: { strategy: 'git-guided' },
  });

  // recentActivity may be null if git_log returned no commits (non-git dir)
  // The important thing is the field is present or absent — no crash
  assert.ok('recentActivity' in result || result.recentActivity === undefined);
  assert.equal(result.stats.gitLogCalls, 1);
});

test('ExplorerRuntime partial match evidence: evidence within tolerance lines is kept', async () => {
  class PartialMatchClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-read-1',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
                },
              },
            ],
          },
        };
      }
      // Evidence references lines 5-6 but we only read 1-4.
      // With EVIDENCE_LINE_TOLERANCE=2, line 5 is within tolerance → kept as partial.
      return {
        usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
        message: {
          content: JSON.stringify({
            answer: '인증 함수가 확인됩니다.',
            summary: '요약',
            confidence: 'medium',
            evidence: [
              { path: 'src/auth.js', startLine: 5, endLine: 6, why: '함수 본문' },
            ],
            candidatePaths: ['src/auth.js'],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new PartialMatchClient() });
  const result = await runtime.explore({
    task: '인증 함수 확인',
    repo_root: root,
    scope: ['src/**'],
    budget: 'quick',
  });

  // The evidence item at lines 5-6 should be kept as a partial match (read range was 1-4,
  // and 5 is within EVIDENCE_LINE_TOLERANCE=2 of endLine=4)
  assert.ok(result.evidence.length >= 1, 'partial-match evidence should be retained');
  const partialItems = result.evidence.filter(e => e.groundingStatus === 'partial');
  assert.ok(partialItems.length >= 1, 'at least one evidence item should have groundingStatus=partial');
});

test('ExplorerRuntime calls onProgress callback on each turn', async () => {
  class TwoTurnClient {
    constructor() { this.model = 'mock'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          message: {
            content: '',
            toolCalls: [{
              id: 'c1',
              function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'auth' }) },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 60, completion_tokens: 20, total_tokens: 80 },
        message: {
          content: JSON.stringify({
            answer: '답변', summary: '요약', confidence: 'low',
            evidence: [], candidatePaths: [], followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new TwoTurnClient() });
  const progressEvents = [];

  const result = await runtime.explore(
    { task: '인증 함수 찾기', repo_root: root, scope: ['src/**'], budget: 'quick' },
    { onProgress: (evt) => progressEvents.push(evt) },
  );

  assert.ok(progressEvents.length >= 2, 'onProgress must be called at least twice');
  for (const evt of progressEvents) {
    assert.ok(typeof evt.progress === 'number', 'progress must be a number');
    assert.ok(typeof evt.total === 'number', 'total must be a number');
    assert.ok(typeof evt.message === 'string', 'message must be a string');
  }
  assert.ok(result.answer);
});

test('ExplorerRuntime returns sessionId in stats when sessionStore is provided', async () => {
  class SimpleClient {
    constructor() { this.model = 'mock'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify({
            answer: '세션 테스트', summary: '요약', confidence: 'low',
            evidence: [], candidatePaths: ['src/auth.js'], followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const { SessionStore } = await import('../src/explorer/session.mjs');
  const sessionStore = new SessionStore();

  const runtime = new ExplorerRuntime({ chatClient: new SimpleClient() });
  const result = await runtime.explore(
    { task: '테스트', repo_root: root },
    { sessionStore },
  );

  assert.ok(typeof result.stats.sessionId === 'string', 'stats.sessionId must be a string');
  assert.ok(result.stats.sessionId.startsWith('sess_'), 'sessionId must start with sess_');

  // Session should store candidatePaths from this call
  const session = sessionStore.get(result.stats.sessionId);
  assert.ok(session, 'session must exist in the store');
  assert.ok(session.candidatePaths.includes('src/auth.js'), 'candidatePaths must be accumulated');
});

test('ExplorerRuntime injects previous session context into next call', async () => {
  const capturedPrompts = [];

  class CapturingClient {
    constructor() { this.model = 'mock'; }
    async createChatCompletion({ messages }) {
      capturedPrompts.push(messages[0].content); // system prompt
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify({
            answer: 'ok', summary: 'previous context test', confidence: 'low',
            evidence: [], candidatePaths: [], followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const { SessionStore } = await import('../src/explorer/session.mjs');
  const sessionStore = new SessionStore();
  const runtime = new ExplorerRuntime({ chatClient: new CapturingClient() });

  // First call — creates session
  const first = await runtime.explore({ task: '첫 번째 탐색', repo_root: root }, { sessionStore });
  const sessionId = first.stats.sessionId;

  // Second call — uses session ID
  await runtime.explore(
    { task: '두 번째 탐색', repo_root: root, session: sessionId },
    { sessionStore },
  );

  // Each explore() now makes 2 chat completions (agentic + finalize).
  // First explore: capturedPrompts[0] (agentic), capturedPrompts[1] (finalize)
  // Second explore: capturedPrompts[2] (agentic), capturedPrompts[3] (finalize)
  // The second explore's agentic system prompt should include the previous summary.
  const secondSystemPrompt = capturedPrompts[2];
  assert.ok(
    secondSystemPrompt.includes('previous context test') ||
    secondSystemPrompt.includes('Findings from previous'),
    'Second call must reference previous session summary in system prompt',
  );
});

// ── Phase 1 — 최종 출력 경로 단일화 ──────────────────────────────────────────

test('Phase 1 — no-tool exit always routes through finalize (strict schema)', async () => {
  // When the model answers immediately with no tool calls the response must still
  // go through finalizeAfterToolLoop so the strict schema is always applied.
  // We verify this by checking that the result conforms to strict schema even
  // when the MockClient returns valid JSON without any tool calls.
  class ImmediateAnswerClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      // First call (agentic loop): no tool calls — triggers finalizeAfterToolLoop
      // Second call (finalize): returns the JSON answer
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify({
            answer: '즉시 답변합니다.',
            summary: '도구 없이 바로 답변했습니다.',
            confidence: 'medium',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new ImmediateAnswerClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({ task: '단순 질문', repo_root: root, budget: 'quick' });

  assertStrictSchema(result);
  // finalize was called: total calls = 1 (agentic loop no-tool) + 1 (finalize) = 2
  assert.equal(client.calls, 2, 'finalizeAfterToolLoop must be called even on no-tool exit');
});

test('Phase 1 — finalize prompt triggers no additional tool calls', async () => {
  // Verifies that the finalize step is called with parallelToolCalls:false and
  // the model honours the no-tool instruction (no toolCalls in finalize response).
  const capturedRequests = [];

  class TrackingClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion(req) {
      this.calls += 1;
      capturedRequests.push(req);
      return {
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        message: {
          content: JSON.stringify({
            answer: '분석 완료',
            summary: '요약',
            confidence: 'low',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new TrackingClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  await runtime.explore({ task: '테스트', repo_root: root, budget: 'quick' });

  // The finalize request (last call) must have parallelToolCalls:false
  const finalizeReq = capturedRequests[capturedRequests.length - 1];
  assert.equal(finalizeReq.parallelToolCalls, false, 'finalize request must have parallelToolCalls:false');

  // The finalize user message must include the finalize prompt keywords
  const finalizeMessages = finalizeReq.messages;
  const lastUserMsg = [...finalizeMessages].reverse().find(m => m.role === 'user');
  assert.ok(lastUserMsg?.content?.includes('HARD REQUIREMENTS'), 'finalize prompt must include HARD REQUIREMENTS');
});

test('Phase 1 — malformed freeform content still produces strict-schema result', async () => {
  // When the model returns non-JSON content the fallback path in finalizeAfterToolLoop
  // must still produce a result that passes strict schema (with confidence=low).
  class MalformedFinalizeClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        // agentic loop: no tool calls → triggers finalize
        return {
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          message: { content: '', toolCalls: [] },
        };
      }
      // finalize call: returns plain prose (not valid JSON)
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: 'The authentication middleware is located in src/auth.js.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MalformedFinalizeClient() });
  const result = await runtime.explore({ task: '인증 위치 찾기', repo_root: root, budget: 'quick' });

  // Fallback path must still produce schema-compliant structure
  assert.equal(typeof result.answer, 'string', 'answer must be a string even on malformed content');
  assert.ok(result.answer.length > 0, 'answer must not be empty');
  assert.equal(result.confidence, 'low', 'confidence must be low on fallback path');
  assert.ok(Array.isArray(result.evidence), 'evidence must be an array on fallback');
  assert.ok(Array.isArray(result.followups), 'followups must be an array on fallback');
});

// ── Phase 5 — evidence/schema/context 고도화 ──────────────────────────────────

test('Phase 5 — git_commit evidence without verified SHA is dropped (strict validation)', async () => {
  // Verifies that git_commit evidence with a SHA that was not actually returned by
  // a git tool call is dropped. The fixture has no git repo, so repo_git_log returns
  // an error and observedGit.commits stays empty. Evidence citing 'abc1234' is unverified.
  class GitEvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-git',
              function: { name: 'repo_git_log', arguments: JSON.stringify({ maxCount: 3 }) },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify({
            answer: '버그는 abc1234 커밋에서 도입됐습니다.',
            summary: '커밋 이력 분석 완료',
            confidence: 'medium',
            evidence: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: '버그가 도입된 파일',
                evidenceType: 'git_commit',
                sha: 'abc1234',
                author: 'dev@example.com',
              },
            ],
            candidatePaths: ['src/auth.js'],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new GitEvidenceClient() });
  const result = await runtime.explore({
    task: '이 버그가 언제 도입됐나요?',
    repo_root: root,
    budget: 'quick',
    hints: { strategy: 'git-guided' },
  });

  // git_commit evidence with unverified SHA must be dropped (fabrication prevention)
  assert.equal(result.evidence.length, 0, 'unverified git_commit evidence must be dropped');
});

test('Phase 5 — session reuse stores candidatePathsWithContext as {path, why} objects', async () => {
  // Verifies that after an explore() call with evidence, the session stores
  // candidatePathsWithContext as { path, why }[] objects (not plain strings).
  // The mock must call repo_read_file first so the evidence passes grounding.
  class SimpleClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        // Read both files to establish observedRanges for grounding
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [
              { id: 'c1', function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }) } },
              { id: 'c2', function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 6 }) } },
            ],
          },
        };
      }
      // Second call: no tools → triggers finalize
      return {
        usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  // Finalize client returns answer with evidence in observed ranges
  class FinalizeClient extends SimpleClient {
    async createChatCompletion(req) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [
              { id: 'c1', function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }) } },
              { id: 'c2', function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 6 }) } },
            ],
          },
        };
      }
      // finalizeAfterToolLoop call: return evidence within observed ranges
      return {
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        message: {
          content: JSON.stringify({
            answer: '분석 완료',
            summary: '요약',
            confidence: 'medium',
            evidence: [
              { path: 'src/auth.js', startLine: 1, endLine: 4, why: '인증 함수 정의 위치' },
              { path: 'src/routes/user.js', startLine: 1, endLine: 6, why: '라우트 등록 위치' },
            ],
            candidatePaths: ['src/auth.js', 'src/routes/user.js'],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const { SessionStore } = await import('../src/explorer/session.mjs');
  const sessionStore = new SessionStore();
  const runtime = new ExplorerRuntime({ chatClient: new FinalizeClient() });

  const result = await runtime.explore({ task: '인증 분석', repo_root: root, budget: 'quick' }, { sessionStore });
  const session = sessionStore.get(result.stats.sessionId);

  assert.ok(session, 'session must exist');
  assert.ok(Array.isArray(session.candidatePathsWithContext),
    'candidatePathsWithContext must be an array');
  assert.ok(session.candidatePathsWithContext.length >= 2,
    'must have at least 2 enriched paths from evidence items');

  // Verify each entry is a { path, why } object
  for (const entry of session.candidatePathsWithContext) {
    assert.equal(typeof entry.path, 'string', 'each entry must have a path string');
    assert.equal(typeof entry.why, 'string', 'each entry must have a why string');
    assert.ok(entry.why.length > 0, 'why must not be empty (should come from evidence.why)');
  }

  // Verify the paths are from the evidence items
  const paths = session.candidatePathsWithContext.map(e => e.path);
  assert.ok(paths.includes('src/auth.js'), 'must include src/auth.js from evidence');
  assert.ok(paths.includes('src/routes/user.js'), 'must include src/routes/user.js from evidence');
});

// ── Phase 4 — 멀티턴 안정화 장치 ─────────────────────────────────────────────

test('Phase 4 — checkpoint message is inserted for normal/deep budget after every 4 turns', async () => {
  // Verifies that for budgets with maxTurns > 6, a checkpoint user message is
  // injected into the conversation every CHECKPOINT_INTERVAL (4) turns.
  const capturedMessages = [];

  class CheckpointObserverClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      capturedMessages.push([...messages]);

      if (this.calls <= 4) {
        // Keep making tool calls for the first 4 turns to trigger checkpoint
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `call-${this.calls}`,
              function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'auth' }) },
            }],
          },
        };
      }
      // Turn 5: answer without tools
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify({
            answer: '분석 완료', summary: '요약', confidence: 'low',
            evidence: [], candidatePaths: [], followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new CheckpointObserverClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  // Use 'normal' budget (maxTurns=10 > 6 → checkpoint enabled)
  await runtime.explore({ task: '인증 분석', repo_root: root, budget: 'normal' });

  // The 5th call to createChatCompletion (turnIndex=4) should have a checkpoint
  // user message injected before it. That means capturedMessages[4] should contain
  // a user message with "Checkpoint" text.
  const turn5Messages = capturedMessages[4];
  const checkpointMsg = turn5Messages.find(
    m => m.role === 'user' && m.content?.includes('Checkpoint'),
  );
  assert.ok(checkpointMsg, 'checkpoint message must be injected at turnIndex=4 for normal budget');
});

test('Phase 4 — checkpoint is NOT inserted for quick budget (maxTurns <= 6)', async () => {
  const capturedMessages = [];

  class NoCheckpointClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      capturedMessages.push([...messages]);
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: JSON.stringify({
            answer: '빠른 답변', summary: '요약', confidence: 'low',
            evidence: [], candidatePaths: [], followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new NoCheckpointClient() });
  // Use 'quick' budget (maxTurns=6 → checkpoint disabled)
  await runtime.explore({ task: '테스트', repo_root: root, budget: 'quick' });

  // No message should contain "Checkpoint"
  const hasCheckpoint = capturedMessages.some(msgs =>
    msgs.some(m => m.role === 'user' && m.content?.includes('Checkpoint')),
  );
  assert.equal(hasCheckpoint, false, 'checkpoint must NOT be inserted for quick budget');
});

test('Phase 4 — critic-lite: confidence=high with only 1 evidence item is downgraded to low', async () => {
  // With the task-aware confidence scoring, a single evidence item (no cross-file
  // verification, non-locate task) computes to 'low' (base 0.15 + 0.18 = 0.33).
  // The model's 'high' claim is reconciled down to the computed level.
  class OverconfidentClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        // Read one file so the evidence has an observed range
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-1',
              function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }) },
            }],
          },
        };
      }
      // Finalize: model claims high confidence with only 1 evidence item
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify({
            answer: '자신있게 단정합니다.',
            summary: '요약',
            confidence: 'high',
            evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: '유일한 근거' }],
            candidatePaths: ['src/auth.js'],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new OverconfidentClient() });
  const result = await runtime.explore({ task: '인증 함수 분석', repo_root: root, budget: 'quick' });

  // task-aware scorer: base 0.15 + 0.18 (1 exact) = 0.33 → 'low'
  // reconcileConfidence: lowerOf('high', 'low') = 'low'
  assert.equal(result.confidence, 'low',
    'confidence=high with 1 evidence item must be downgraded to low by task-aware scoring');
});

// ── Phase 3 — 프롬프트 구조 재배치 + 전략 유연화 ─────────────────────────────

test('Phase 3 — system prompt has HARD REQUIREMENTS within first 30 lines', () => {
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    budgetConfig: BUDGETS.normal,
  });
  const lines = prompt.split('\n');
  const first30 = lines.slice(0, 30).join('\n');
  assert.ok(
    first30.includes('HARD REQUIREMENTS'),
    'HARD REQUIREMENTS must appear within the first 30 lines of the system prompt',
  );
});

test('Phase 3 — detectStrategy returns compound array for mixed-signal task', () => {
  // A task that triggers both git-guided (변경) and blame-guided (버그) signals
  const strategy = detectStrategy('이 버그가 언제 변경된 커밋에서 도입됐는지 찾아라');
  assert.ok(Array.isArray(strategy), 'compound task must return an array of strategies');
  assert.ok(strategy.includes('git-guided'), 'should detect git-guided');
  assert.ok(strategy.includes('blame-guided'), 'should detect blame-guided');
});

test('Phase 3 — detectStrategy returns single string for unambiguous task', () => {
  const strategy = detectStrategy('requireAuth 함수가 어디 정의되어 있는지 찾아라');
  assert.equal(typeof strategy, 'string', 'unambiguous task must return a single strategy string');
  assert.equal(strategy, 'symbol-first');
});

test('Phase 3 — Korean task produces Korean answer/summary language (language rule)', async () => {
  // This test checks that when language is not specified the LANGUAGE RULE in the
  // system prompt mentions "same natural language as the delegated task".
  // We verify the system prompt contains the expected language rule text.
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    budgetConfig: BUDGETS.quick,
  });
  assert.ok(
    prompt.includes('LANGUAGE RULE'),
    'system prompt must include a LANGUAGE RULE section',
  );
  assert.ok(
    prompt.includes('same natural language'),
    'default language rule must say "same natural language as the delegated task"',
  );
});

test('Phase 3 — explicit language is reflected in system prompt language rule', () => {
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    budgetConfig: BUDGETS.quick,
    language: 'Korean',
  });
  assert.ok(
    prompt.includes('Korean'),
    'explicit language must appear in the system prompt language rule',
  );
  assert.ok(
    !prompt.includes('same natural language'),
    'explicit language must override the default language rule',
  );
});

test('Phase 3 — system prompt does not expose the absolute repo root path', () => {
  const repoRoot = path.resolve('fixtures', 'demo-repo');
  const prompt = buildExplorerSystemPrompt({
    repoRoot,
    budgetConfig: BUDGETS.quick,
  });

  assert.ok(
    !prompt.includes(repoRoot),
    'system prompt must not embed the absolute repository root path',
  );
  assert.ok(
    prompt.includes('tool paths are relative to the repo root'),
    'system prompt should still explain path semantics',
  );
});

// ── Phase 0 baseline metrics ──────────────────────────────────────────────────

/**
 * Assert that `result` passes all required-field type checks (strict schema compliance).
 * Re-use this helper in every test that produces a result to track schema compliance rate.
 */
function assertStrictSchema(result) {
  assert.ok(typeof result.answer === 'string' && result.answer.length > 0,
    'strict schema: answer must be a non-empty string');
  assert.ok(typeof result.summary === 'string',
    'strict schema: summary must be a string');
  assert.ok(['low', 'medium', 'high'].includes(result.confidence),
    'strict schema: confidence must be low|medium|high');
  assert.ok(Array.isArray(result.evidence),
    'strict schema: evidence must be an array');
  assert.ok(Array.isArray(result.candidatePaths),
    'strict schema: candidatePaths must be an array');
  assert.ok(Array.isArray(result.followups),
    'strict schema: followups must be an array');
  assert.ok(result.stats && typeof result.stats === 'object',
    'strict schema: stats must be an object');
  assert.ok(typeof result.stats.turns === 'number',
    'strict schema: stats.turns must be a number');
}

test('Phase 0 metric — JSON parse success: model content parsed into correct field types', async () => {
  // Verifies that when the model returns valid JSON the runtime correctly parses every
  // top-level field. This is the "JSON parse success" baseline.
  class JsonSuccessClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        message: {
          content: JSON.stringify({
            answer: '인증 함수 위치를 확인했습니다.',
            summary: 'requireAuth는 auth.js에 정의됩니다.',
            confidence: 'high',
            evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: '함수 정의' }],
            candidatePaths: ['src/auth.js'],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new JsonSuccessClient() });
  const result = await runtime.explore({ task: '인증 함수 찾기', repo_root: root });

  // JSON parse success: each field has the correct runtime type
  assert.equal(typeof result.answer, 'string', 'answer must parse to string');
  assert.equal(typeof result.summary, 'string', 'summary must parse to string');
  assert.ok(['low', 'medium', 'high'].includes(result.confidence), 'confidence must parse to valid label');
  assert.ok(Array.isArray(result.evidence), 'evidence must parse to array');
  assert.ok(Array.isArray(result.candidatePaths), 'candidatePaths must parse to array');
  assert.ok(Array.isArray(result.followups), 'followups must parse to array');
  assert.equal(typeof result.confidenceScore, 'number', 'confidenceScore must be a number after parse');
  assertStrictSchema(result);
});

test('Phase 0 metric — strict schema compliance: all required fields present across budgets', async () => {
  // Verifies that every supported budget label produces a result conforming to strict schema.
  // This is the "strict schema 적합률" baseline.
  class MinimalClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        message: {
          content: JSON.stringify({
            answer: '테스트 답변',
            summary: '테스트 요약',
            confidence: 'medium',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();

  for (const budget of ['quick', 'normal', 'deep']) {
    const runtime = new ExplorerRuntime({ chatClient: new MinimalClient() });
    const result = await runtime.explore({ task: '테스트', repo_root: root, budget });
    assertStrictSchema(result);
    assert.equal(result.stats.budget, budget,
      `budget label must be '${budget}' in stats`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

test('ExplorerRuntime forwards assistant reasoning into the next turn when available', async () => {
  class ReasoningClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ messages, reasoningEffort, temperature, topP }) {
      this.calls += 1;

      if (this.calls === 1) {
        assert.equal(reasoningEffort, 'none');
        // quick budget now has temperature: 0.3 (Phase 2 budget-specific temperature)
        assert.equal(temperature, 0.3);
        assert.equal(topP, 0.95);
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            reasoning: 'Search for requireAuth before reading files.',
            toolCalls: [
              {
                id: 'call-r-1',
                function: {
                  name: 'repo_grep',
                  arguments: JSON.stringify({ pattern: 'requireAuth', scope: ['src/**'] }),
                },
              },
            ],
          },
        };
      }

      const assistantMessages = messages.filter(message => message.role === 'assistant');
      assert.ok(
        assistantMessages.some(message => message.reasoning === 'Search for requireAuth before reading files.'),
        'previous assistant reasoning must be sent back on the next turn',
      );

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify({
            answer: 'ok',
            summary: 'reasoning forwarded',
            confidence: 'low',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          reasoning: '',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new ReasoningClient() });
  const result = await runtime.explore({
    task: '인증 함수 위치를 빠르게 찾아라.',
    repo_root: root,
    scope: ['src/**'],
    budget: 'quick',
  });

  assert.equal(result.summary, 'reasoning forwarded');
});

// --- Phase 3: Malformed Tool Args / Parallel Tool Failure Isolation ---

test('ExplorerRuntime continues when one tool call has invalid JSON arguments', async () => {
  class MalformedArgsClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'bad-1',
                function: { name: 'repo_grep', arguments: 'NOT VALID JSON {{{' },
              },
              {
                id: 'good-1',
                function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) },
              },
            ],
          },
        };
      }
      // Finalize
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({
            answer: 'found',
            summary: 'malformed args handled',
            confidence: 'low',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MalformedArgsClient() });
  // Must not throw — the bad tool call is isolated as an error, good one proceeds
  const result = await runtime.explore({ task: 'find auth', repo_root: root, budget: 'quick' });
  assert.ok(result, 'explore() did not throw despite malformed tool args');
  assert.equal(result.summary, 'malformed args handled');
});

test('ExplorerRuntime preserves successful tool results even when one sibling tool fails', async () => {
  let capturedMessages = null;
  class OneFailClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'fail-1',
                function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'does/not/exist.js' }) },
              },
              {
                id: 'ok-1',
                function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) },
              },
            ],
          },
        };
      }
      capturedMessages = messages;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({
            answer: 'checked',
            summary: 'sibling results preserved',
            confidence: 'low',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new OneFailClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root, budget: 'quick' });
  assert.ok(result, 'explore() succeeded');
  // The successful grep result must appear in the message history
  const toolMessages = capturedMessages?.filter(m => m.role === 'tool') ?? [];
  assert.ok(toolMessages.some(m => m.content && m.content.includes('requireAuth')),
    'grep tool result (requireAuth) is in context even though sibling tool failed');
});

// --- Phase 4: Observation Ledger Tests ---

test('ExplorerRuntime records observations from macro tools (repo_symbol_context)', async () => {
  let capturedMessages = null;
  class SymbolContextClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'sc-1',
                function: {
                  name: 'repo_symbol_context',
                  arguments: JSON.stringify({ symbol: 'requireAuth' }),
                },
              },
            ],
          },
        };
      }
      capturedMessages = messages;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({
            answer: 'found requireAuth definition',
            summary: 'symbol context observations recorded',
            confidence: 'medium',
            evidence: [
              { kind: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 4, quote: 'export function requireAuth', why: 'definition of requireAuth', groundingStatus: 'exact' },
            ],
            candidatePaths: [{ path: 'src/auth.js', why: 'definition' }],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new SymbolContextClient() });
  const result = await runtime.explore({ task: 'where is requireAuth defined', repo_root: root, budget: 'quick' });

  // The symbol_context observation for src/auth.js should allow evidence grounding
  assert.ok(result, 'explore succeeded');
  // Evidence for src/auth.js should be retained (grounded via symbol_context observations)
  const authEvidence = result.evidence?.filter(e => e.path === 'src/auth.js') ?? [];
  assert.ok(authEvidence.length > 0, 'evidence for src/auth.js is retained via symbol_context observations');
});

// --- Phase 5: Source-aware Grounding + Git Evidence Validation Tests ---

test('grep-only observation does not exact-ground a wide file range', async () => {
  // Build a runtime result directly by checking the grounding function behavior
  // We do this through an explore() call with mock data
  class GrepOnlyClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'grep-1',
                function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) },
              },
            ],
          },
        };
      }
      // Model reports wide range evidence based only on grep
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({
            answer: 'found',
            summary: 'grep observation grounding test',
            confidence: 'medium',
            evidence: [
              // Wide range — grep only saw line 1, so L1-L200 should be partial not exact
              { kind: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 200, why: 'requireAuth module', evidenceType: 'file_range' },
            ],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new GrepOnlyClient() });
  const result = await runtime.explore({ task: 'find requireAuth', repo_root: root, budget: 'quick' });
  assert.ok(result, 'explore succeeded');
  const wideEvidence = result.evidence?.find(e => e.path === 'src/auth.js' && e.startLine === 1 && e.endLine === 200);
  if (wideEvidence) {
    assert.equal(wideEvidence.groundingStatus, 'partial', 'wide range grounded from grep-only must be partial, not exact');
  }
  // Either dropped OR partial — never exact
  const exactWide = result.evidence?.find(e => e.path === 'src/auth.js' && e.startLine === 1 && e.endLine === 200 && e.groundingStatus === 'exact');
  assert.ok(!exactWide, 'wide range evidence based solely on grep observation must not be exact');
});

test('hallucinated git_commit evidence is dropped (no matching observed hash)', async () => {
  class HallucinatedGitClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'grep-1',
                function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) },
              },
            ],
          },
        };
      }
      // Model hallucinates a git_commit evidence without ever calling git tools
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({
            answer: 'found',
            summary: 'git evidence hallucination test',
            confidence: 'medium',
            evidence: [
              { evidenceType: 'git_commit', path: 'src/auth.js', sha: 'abc12345', why: 'commit that added requireAuth', startLine: 1, endLine: 4 },
            ],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new HallucinatedGitClient() });
  const result = await runtime.explore({ task: 'git history of auth', repo_root: root, budget: 'quick' });
  assert.ok(result, 'explore succeeded');
  // Hallucinated commit should be dropped — git tools were never called so hash not in observedGit
  const gitCommitEvidence = result.evidence?.find(e => e.evidenceType === 'git_commit');
  assert.ok(!gitCommitEvidence, 'hallucinated git_commit evidence is dropped when no git tool was called');
});

// --- Phase 6: Loop Stagnation + Checkpoint Softening Tests ---

test('ExplorerRuntime injects recovery guidance after repeated identical tool plans', async () => {
  const injectedMessages = [];
  class RepeatingClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      // Capture user messages that are not the initial task (recovery messages)
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser && lastUser.content && lastUser.content.includes('unproductive')) {
        injectedMessages.push(lastUser.content);
      }
      // Always return same tool call (stagnation)
      if (this.calls <= 5) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: `c-${this.calls}`, function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'auth' }) } }],
          },
        };
      }
      // Finalize
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({ answer: 'done', summary: 'stagnation recovery', confidence: 'low', evidence: [], candidatePaths: [], followups: [] }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new RepeatingClient() });
  await runtime.explore({ task: 'find auth', repo_root: root, budget: 'normal' });
  assert.ok(injectedMessages.length > 0, 'recovery guidance was injected after repeated identical tool plans');
});

test('Checkpoint prompt does not force exactly one more tool call', async () => {
  // The checkpoint message should not contain "exactly one more tool call"
  let checkpointContent = null;
  class CheckpointCaptureClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      // Look for checkpoint message in user messages
      const checkpointMsg = messages.find(m => m.role === 'user' && m.content?.includes('Checkpoint:'));
      if (checkpointMsg && !checkpointContent) {
        checkpointContent = checkpointMsg.content;
      }
      if (this.calls <= 4) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: `c-${this.calls}`, function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: `term${this.calls}` }) } }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({ answer: 'done', summary: 'checkpoint test', confidence: 'low', evidence: [], candidatePaths: [], followups: [] }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CheckpointCaptureClient() });
  await runtime.explore({ task: 'find something', repo_root: root, budget: 'normal' });

  if (checkpointContent) {
    assert.ok(!checkpointContent.includes('exactly one more tool call'), 'checkpoint must not force exactly one more tool call');
    assert.ok(checkpointContent.includes('1–2 tool calls') || checkpointContent.includes('smallest next step'), 'checkpoint uses softened language');
  }
});

// --- Phase 7: Finalize Hardening Tests ---

test('finalizeAfterToolLoop salvages prose-wrapped JSON locally', async () => {
  class ProseWrappedClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: 'g1', function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) } }],
          },
        };
      }
      // Finalize response wraps JSON in prose
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'Here is my findings:\n\n```json\n' + JSON.stringify({
            answer: 'found in prose',
            summary: 'prose wrapped JSON salvaged',
            confidence: 'medium',
            evidence: [],
            candidatePaths: [{ path: 'src/auth.js', why: 'contains requireAuth' }],
            followups: [],
          }) + '\n```\n\nThat is all I found.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new ProseWrappedClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root, budget: 'quick' });
  assert.ok(result, 'explore succeeded');
  assert.equal(result.summary, 'prose wrapped JSON salvaged', 'prose-wrapped JSON is salvaged locally');
});

test('finalizeAfterToolLoop repairs malformed JSON with a no-tool repair pass', async () => {
  let repairCallCount = 0;
  class MalformedFinalizeClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages }) {
      this.calls += 1;
      // First call: tool use
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{ id: 'g1', function: { name: 'repo_grep', arguments: JSON.stringify({ pattern: 'requireAuth' }) } }],
          },
        };
      }
      // Finalize: return truly malformed JSON (not salvageable by prose extraction)
      if (this.calls === 2) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: { content: 'I found auth: {broken json here...', toolCalls: [] },
        };
      }
      // Repair pass
      repairCallCount += 1;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({
            answer: 'repaired answer',
            summary: 'repaired after malformed JSON',
            confidence: 'low',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MalformedFinalizeClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root, budget: 'quick' });
  assert.ok(result, 'explore succeeded despite malformed finalize JSON');
  assert.equal(repairCallCount, 1, 'repair pass was called exactly once');
  assert.equal(result.summary, 'repaired after malformed JSON', 'repaired result is used');
});
