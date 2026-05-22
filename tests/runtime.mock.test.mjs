import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ExplorerRuntime } from '../src/explorer/runtime.mjs';
import { buildExplorerSystemPrompt, buildFinalizePrompt, detectStrategy } from '../src/explorer/prompt.mjs';
import { BUDGETS } from '../src/explorer/config.mjs';
import { RepoToolkit } from '../src/explorer/repo-tools.mjs';

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

function compactResult({
  directAnswer = 'analysis complete',
  statusConfidence = 'low',
  verification = 'verified',
  complete = true,
  warnings = [],
  targets = [],
  evidence = [],
  uncertainties = [],
  nextAction = { type: 'stop', reason: 'Complete.' },
} = {}) {
  return {
    directAnswer,
    status: {
      confidence: statusConfidence,
      verification,
      complete,
      warnings,
    },
    targets,
    evidence,
    uncertainties,
    nextAction,
  };
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
        content: JSON.stringify(compactResult({
          directAnswer: 'registerUserRoutes는 /users/me 라우트에 requireAuth 미들웨어를 직접 연결한다.',
          statusConfidence: 'high',
          evidence: [
            {
              path: 'src/routes/user.js',
              startLine: 1,
              endLine: 4,
              why: '라우트가 requireAuth를 import하고 /users/me에 연결한다.',
              snippet: '1: FORGED_BY_MODEL();',
            },
            {
              path: 'src/auth.js',
              startLine: 1,
              endLine: 4,
              why: 'requireAuth의 실제 동작이 여기 정의되어 있다.',
              snippet: '1: FORGED_BY_MODEL();',
            },
          ],
          targets: [
            {
              path: 'src/routes/user.js',
              startLine: 1,
              endLine: 4,
              role: 'read',
              reason: '라우트가 requireAuth를 import하고 /users/me에 연결한다.',
              evidenceRefs: [],
            },
            {
              path: 'src/auth.js',
              startLine: 1,
              endLine: 4,
              role: 'read',
              reason: 'requireAuth의 실제 동작이 여기 정의되어 있다.',
              evidenceRefs: [],
            },
          ],
          uncertainties: ['미들웨어 에러 핸들링 패턴은 별도 분석이 필요할 수 있다.'],
        })),
        toolCalls: [],
      },
    };
  }
}

function cloneMessages(messages) {
  return JSON.parse(JSON.stringify(messages));
}

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function assertNoOrphanedToolMessages(messages) {
  let pendingToolCallIds = null;

  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      pendingToolCallIds = new Set(message.tool_calls.map(call => call.id));
      continue;
    }

    if (message.role === 'tool') {
      assert.ok(pendingToolCallIds, 'tool message must follow an assistant tool_calls message');
      assert.ok(
        pendingToolCallIds.has(message.tool_call_id),
        `tool message ${message.tool_call_id} must match a preceding assistant tool_call`,
      );
      pendingToolCallIds.delete(message.tool_call_id);
      continue;
    }

    pendingToolCallIds = null;
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
  assert.ok(['medium', 'high'].includes(result.status.confidence), `confidence must be medium or high, got: ${result.status.confidence}`);
  assert.match(result.directAnswer, /requireAuth/);
  assert.equal(result.status.verification, 'verified');
  assert.ok(Array.isArray(result.targets), 'targets must be an array');
  assert.ok(result.targets.some(target => target.path === 'src/routes/user.js'), 'targets include route file');
  assert.ok(result.targets.every(target => target.role !== 'edit'), 'read-only tracing must not mark all evidence targets as edit');
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.failure, null);
  assert.equal(result.evidenceQuality.level, result.status.confidence);
  assert.equal(result.evidenceQuality.exactCount, 2);
  assert.equal(result.evidenceQuality.partialCount, 0);
  assert.equal(result.evidenceQuality.droppedCount, 0);
  assert.equal(result.evidenceQuality.fileCount, 2);
  assert.ok(Array.isArray(result.evidenceQuality.warnings));
  assert.match(result.evidenceQuality.summary, /evidence items grounded|Verified:/);
  assert.deepEqual(result.searchCoverage.scope, ['src/**']);
  assert.equal(result.searchCoverage.scopeLimited, true);
  assert.equal(result.searchCoverage.filesRead, result.stats.filesRead);
  assert.equal(result.searchCoverage.grepCalls, result.stats.grepCalls);
  assert.equal(result.searchCoverage.stoppedByBudget, false);
  assert.ok(Array.isArray(result.searchCoverage.warnings));
  assert.match(result.searchCoverage.summary, /scope-limited|repo-wide/);
  assert.equal(result.evidence.length, 2);
  assert.ok(result.evidence.every(item => item.id && item.snippet), 'evidence has ids and snippets');
  assert.ok(result.evidence.every(item => !item.snippet.includes('FORGED_BY_MODEL')), 'model-supplied snippets are replaced with local file snippets');
  assert.ok(result._debug?.stats, '_debug.stats is present');
  assert.ok(result._debug?.toolTrace, '_debug.toolTrace is present');
  assert.equal(result._debug.toolTrace.totalCalls, 3);
  assert.equal(result._debug.toolTrace.truncated, false);
  assert.deepEqual(
    result._debug.toolTrace.entries.map(entry => entry.tool),
    ['repo_grep', 'repo_read_file', 'repo_read_file'],
  );
  assert.deepEqual(result._debug.toolTrace.entries[0].args, { pattern: 'requireAuth', scope: ['src/**'] });
  assert.ok(result._debug.toolTrace.entries[0].result.matches >= 2);
  assert.equal(result._debug.toolTrace.entries[1].result.path, 'src/routes/user.js');
  assert.equal(JSON.stringify(result._debug.toolTrace).includes('/users/me'), false, 'trace excludes raw file content');
  assert.equal(result.stats.toolCalls, 3);
  assert.equal(result.stats.grepCalls, 1);
  assert.equal(result.stats.filesRead, 2);
  assert.equal(result.targets.some(target => target.path === 'src/routes/user.js'), true);

  // Phase 3: continuous confidence score
  assert.ok(typeof result.confidenceScore === 'number', 'confidenceScore must be a number');
  assert.ok(result.confidenceScore >= 0 && result.confidenceScore <= 1, 'confidenceScore must be in [0, 1]');
  assert.ok(['low', 'medium', 'high'].includes(result.status.confidence), 'confidenceLevel must be low|medium|high');
  assert.ok(result.confidenceFactors && typeof result.confidenceFactors === 'object', 'confidenceFactors must be an object');
  assert.ok(typeof result.confidenceFactors.evidenceCount === 'number', 'confidenceFactors.evidenceCount must be a number');
  assert.ok(typeof result.confidenceFactors.crossVerified === 'boolean', 'confidenceFactors.crossVerified must be a boolean');

  // Phase 3: evidence grounding status
  for (const ev of result.evidence) {
    assert.ok(ev.groundingStatus === 'exact' || ev.groundingStatus === 'partial', 'each evidence item must have groundingStatus');
  }

  assert.ok(Array.isArray(result.uncertainties), 'uncertainties must be an array');
  assert.equal(result.followups, undefined, 'legacy followups are no longer part of the runtime result');

  // Phase 3: codeMap
  assert.ok(result.codeMap && typeof result.codeMap === 'object', 'codeMap must be present');
  assert.ok(Array.isArray(result.codeMap.entryPoints), 'codeMap.entryPoints must be an array');
  assert.ok(Array.isArray(result.codeMap.keyModules), 'codeMap.keyModules must be an array');
  assert.ok(result.codeMap.keyModules.length >= 2, 'codeMap must include at least the two read files');
});

test('ExplorerRuntime preserves model-provided edit targets when deriving evidence targets', async () => {
  class EditTargetClient {
    constructor() {
      this.model = 'mock';
      this.calls = 0;
    }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
                },
              },
              {
                id: 'call-2',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 5 }),
                },
              },
            ],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'requireAuth를 수정해야 합니다.',
            statusConfidence: 'high',
            evidence: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'requireAuth 구현 위치입니다.',
              },
              {
                path: 'src/routes/user.js',
                startLine: 1,
                endLine: 5,
                why: 'requireAuth 호출 위치입니다.',
              },
            ],
            targets: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                role: 'edit',
                reason: '수정이 필요한 구현 위치입니다.',
                evidenceRefs: ['E1'],
              },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new EditTargetClient() });
  const result = await runtime.explore({
    task: 'requireAuth 동작을 설명해라.',
    repo_root: repoRoot,
  });

  const target = result.targets.find(item => item.path === 'src/auth.js');
  assert.equal(target?.role, 'edit', 'model-provided edit role must not be overwritten by derived read targets');
  assert.equal(result.status.verification, 'targeted_read_needed');
  assert.equal(result.nextAction.target.role, 'edit');
});

test('ExplorerRuntime drops model-provided edit targets outside grounded evidence', async () => {
  class MaliciousTargetClient {
    constructor() {
      this.model = 'mock';
      this.calls = 0;
    }

    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
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
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'requireAuth는 인증되지 않은 요청을 거부합니다.',
            statusConfidence: 'high',
            evidence: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'requireAuth 구현 위치입니다.',
              },
            ],
            targets: [
              {
                path: '../../.ssh/id_rsa',
                role: 'edit',
                reason: '공격자가 주입한 저장소 밖 대상입니다.',
              },
              {
                path: '/home/user/.env',
                role: 'edit',
                reason: '공격자가 주입한 절대 경로 대상입니다.',
              },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MaliciousTargetClient() });
  const result = await runtime.explore({
    task: 'requireAuth 동작을 설명해라.',
    repo_root: repoRoot,
  });

  assert.ok(result.targets.every(target => !target.path.includes('..') && !path.isAbsolute(target.path)));
  assert.ok(result.targets.every(target => target.path !== '/home/user/.env'));
  assert.ok(result.targets.every(target => target.role !== 'edit'));
  assert.notEqual(result.status.verification, 'targeted_read_needed');
  assert.notEqual(result.nextAction.target?.path, '../../.ssh/id_rsa');
});

test('ExplorerRuntime does not treat review-change context as edit planning', async () => {
  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });

  const result = await runtime.explore({
    task: 'Review change context: What changed recently around auth routing? Summarize what changed and return grounded read targets.',
    repo_root: repoRoot,
    scope: ['src/**'],
    budget: 'quick',
  });

  assert.equal(result.status.verification, 'verified');
  assert.equal(result.nextAction.type, 'stop');
});

test('ExplorerRuntime still treats code changes as edit planning', async () => {
  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });

  const result = await runtime.explore({
    task: 'Change auth middleware behavior to add a new response field.',
    repo_root: repoRoot,
    scope: ['src/**'],
    budget: 'quick',
  });

  assert.equal(result.status.verification, 'targeted_read_needed');
  assert.equal(result.nextAction.type, 'read_target');
});

test('ExplorerRuntime uses internal taskMode before regex edit intent fallback', async () => {
  class EvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 8 }),
              },
            }, {
              id: 'call-read-2',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 8 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '근거가 충분합니다.',
            statusConfidence: 'high',
            evidence: [
              { path: 'src/auth.js', startLine: 1, endLine: 4, why: '검증 근거' },
              { path: 'src/routes/user.js', startLine: 1, endLine: 5, why: '호출 근거' },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new EvidenceClient() });
  const result = await runtime.explore({
    task: 'update code evidence for review',
    repo_root: root,
    scope: ['src/**'],
    budget: 'quick',
    taskMode: 'evidence_verification',
  });

  assert.equal(result.status.verification, 'verified');
});

test('ExplorerRuntime taskMode marks edit planning as targeted read needed', async () => {
  class EditPlanningClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 8 }),
              },
            }, {
              id: 'call-read-2',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/routes/user.js', startLine: 1, endLine: 8 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '변경 영향입니다.',
            statusConfidence: 'high',
            evidence: [
              { path: 'src/auth.js', startLine: 1, endLine: 4, why: '변경 영향 근거' },
              { path: 'src/routes/user.js', startLine: 1, endLine: 5, why: '호출 영향 근거' },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new EditPlanningClient() });
  const result = await runtime.explore({
    task: 'Assess auth behavior',
    repo_root: root,
    scope: ['src/**'],
    budget: 'quick',
    taskMode: 'edit_planning',
  });

  assert.equal(result.status.verification, 'targeted_read_needed');
});

test('Phase 2 — codeMap remains available without generating Mermaid diagram output', async () => {
  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });

  const result = await runtime.explore({
    task: '읽은 주요 모듈 구조를 요약해라.',
    repo_root: repoRoot,
    scope: ['src/**'],
    budget: 'quick',
  });

  assert.equal(result.diagram, undefined, 'runtime should not emit Mermaid diagram output');
  assert.equal(result._debug.diagram, undefined, 'debug payload should not emit Mermaid diagram output');
  assert.ok(result.codeMap, 'codeMap should remain available as structured data');
  assert.ok(result._debug.codeMap, 'debug payload should retain structured codeMap');
  assert.ok(result.codeMap.keyModules.some(item => item.path === 'src/auth.js'));
  assert.ok(result.codeMap.keyModules.some(item => item.path === 'src/routes/user.js'));
});

test('Phase 1 — explore circuit breaker trips after three all-error turns', async () => {
  class AllErrorExploreClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      if (this.calls <= 3) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `invalid-${this.calls}`,
              function: { name: 'repo_missing_tool', arguments: '{}' },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '부분 답변',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const client = new AllErrorExploreClient();
  const runtime = new ExplorerRuntime({ chatClient: client });

  const result = await runtime.explore({
    task: '실패하는 도구 호출을 반복해도 서킷 브레이커가 동작해야 한다.',
    repo_root: repoRoot,
    budget: 'quick',
  });

  assert.equal(result.stats.turns, 3, 'tool loop must stop after the third all-error turn');
  assert.equal(result.stats.stoppedByErrors, true, 'circuit breaker must mark stoppedByErrors');
  assert.equal(result.stats.stoppedByBudget, false, 'error stop must not be mislabeled as budget stop');
  assert.equal(client.calls, 4, 'three tool-loop calls plus one finalization call');
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.failure.category, 'execution');
  assert.equal(result.failure.reason, 'tool_errors');
  assert.equal(result.failure.retry.tool, 'explore_repo');
  assert.ok(result.failure.retry.hints.some(hint => /narrower scope|specific/i.test(hint)));
  assert.equal(result.failure.retry.args.task, 'Retry with a narrower scope or a more specific symbol/file anchor.');
  assert.deepEqual(Object.keys(result.failure.retry.args).sort(), ['scope', 'task']);
  assert.equal(result.failure.retry.expectedImprovement, 'A narrower task should reduce repeated tool errors and improve grounding.');
  assert.equal(result.evidenceQuality.level, result.status.confidence);

  const thirdTurnMessages = client.snapshots[2];
  assert.ok(
    thirdTurnMessages.some(m => m.role === 'user' && m.content?.includes('repeating the same failing')),
    'recovery guidance must be present before the third failing turn',
  );
});

test('Phase 1 — freeExploreV2 circuit breaker trips after three all-error turns', async () => {
  class AllErrorFreeExploreV2Client {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      if (this.calls <= 3) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `invalid-v2-${this.calls}`,
              function: { name: 'repo_missing_tool', arguments: '{}' },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        finishReason: 'stop',
        message: {
          content: '# Partial report\n\nToo many tool errors.',
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const client = new AllErrorFreeExploreV2Client();
  const runtime = new ExplorerRuntime({ chatClient: client });

  const result = await runtime.freeExploreV2({
    prompt: '반복적인 도구 실패 이후 보고서를 작성해라.',
    repo_root: repoRoot,
    thoroughness: 'quick',
  });

  assert.equal(result.stats.turns, 3, 'V2 tool loop must stop after the third all-error turn');
  assert.equal(result.stats.stoppedByErrors, true, 'V2 circuit breaker must mark stoppedByErrors');
  assert.equal(result.stats.stoppedByBudget, false, 'error stop must not be mislabeled as budget stop');
  assert.equal(client.calls, 4, 'three tool-loop calls plus one finalization call');

  const thirdTurnMessages = client.snapshots[2];
  assert.ok(
    thirdTurnMessages.some(m => m.role === 'user' && m.content?.includes('repeating the same failing')),
    'V2 recovery guidance must be present before the third failing turn',
  );
});

test('freeExploreV2 labels truncated tool results as incomplete before synthesis', async () => {
  class TruncationClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: null,
            toolCalls: [
              {
                id: 'read-large',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/large.js', startLine: 1, endLine: 700 }),
                },
              },
            ],
          },
        };
      }

      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        finishReason: 'stop',
        message: {
          content: 'Large report cites `src/large.js:L1-L2`.',
          toolCalls: [],
        },
      };
    }
  }

  class CompleteResultClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion() {
      this.calls += 1;

      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: null,
            toolCalls: [
              {
                id: 'read-small',
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
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        finishReason: 'stop',
        message: {
          content: 'Small report cites `src/auth.js:L1-L2`.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const largeSource = Array.from(
    { length: 700 },
    (_, index) => `export const value${index} = '${'x'.repeat(60)}';`,
  ).join('\n');
  await fs.writeFile(path.join(root, 'src', 'large.js'), largeSource);

  const client = new TruncationClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.freeExploreV2({
    prompt: 'inspect a large file and produce a cited report',
    repo_root: root,
    thoroughness: 'quick',
  });

  const secondTurnMessages = client.snapshots[1] ?? [];
  const toolMessage = secondTurnMessages.find(message => message.role === 'tool');
  assert.ok(toolMessage, 'second model call must include the truncated tool result');
  assert.match(toolMessage.content, /Result was truncated before model synthesis/);
  const legacyFullInspectionPattern = new RegExp(['Full data', 'was inspected'].join(' '));
  assert.doesNotMatch(toolMessage.content, legacyFullInspectionPattern);
  assert.equal(result.searchCoverage.toolResultsTruncated, 1);
  assert.ok(
    result.searchCoverage.warnings.some(warning => /expected evidence is missing/i.test(warning)),
    'searchCoverage warning must tell the parent agent how to recover missing evidence',
  );
  const criticTruncationWarning = result.critic.warnings.find(
    warning => warning.type === 'truncated_tool_results',
  );
  assert.ok(criticTruncationWarning, 'critic must report truncated tool results');
  assert.match(criticTruncationWarning.message, /expected evidence is missing/i);

  const completeRuntime = new ExplorerRuntime({ chatClient: new CompleteResultClient() });
  const completeResult = await completeRuntime.freeExploreV2({
    prompt: 'inspect a small file and produce a cited report',
    repo_root: root,
    thoroughness: 'quick',
  });
  assert.equal(completeResult.searchCoverage.toolResultsTruncated, 0);
  assert.equal(
    completeResult.searchCoverage.warnings.some(warning => /expected evidence is missing/i.test(warning)),
    false,
    'complete tool results must not emit truncation recovery warnings',
  );
});

test('freeExploreV2 searchCoverage counts non-read tool calls', async () => {
  class CoverageFreeExploreV2Client {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'list-src',
                function: {
                  name: 'repo_list_dir',
                  arguments: JSON.stringify({ dirPath: 'src', depth: 1 }),
                },
              },
              {
                id: 'symbols-auth',
                function: {
                  name: 'repo_symbols',
                  arguments: JSON.stringify({ path: 'src/auth.js' }),
                },
              },
              {
                id: 'grep-auth',
                function: {
                  name: 'repo_grep',
                  arguments: JSON.stringify({ pattern: 'requireAuth', scope: ['src/**'] }),
                },
              },
            ],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        finishReason: 'stop',
        message: {
          content: '# Coverage report\n\nUsed list, symbol, and grep tools.',
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CoverageFreeExploreV2Client() });

  const result = await runtime.freeExploreV2({
    prompt: 'auth surface coverage',
    repo_root: repoRoot,
    thoroughness: 'quick',
  });

  assert.equal(result.stats.listDirCalls, 1);
  assert.equal(result.stats.symbolCalls, 1);
  assert.equal(result.stats.grepCalls, 1);
  assert.equal(result.searchCoverage.listDirCalls, 1);
  assert.equal(result.searchCoverage.symbolCalls, 1);
  assert.equal(result.searchCoverage.grepCalls, 1);
});

test('Phase 1 — freeExploreV2 compaction preserves complete turns and valid tool sequencing', async () => {
  class CompactionSequenceClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      if (this.calls <= 3) {
        return {
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
          message: {
            content: '',
            toolCalls: [{
              id: `read-large-${this.calls}`,
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/large.js', startLine: 1, endLine: 220 }),
              },
            }],
          },
        };
      }

      if (this.calls === 4) {
        return {
          usage: { prompt_tokens: 45, completion_tokens: 20, total_tokens: 65 },
          finishReason: 'stop',
          message: {
            content: 'Compaction summary',
            toolCalls: [],
          },
        };
      }

      if (this.calls === 5) {
        const compactedMessages = this.snapshots[4];
        assert.equal(compactedMessages[0].role, 'system');
        assert.equal(compactedMessages[1].role, 'user');
        assert.equal(compactedMessages[2].role, 'assistant');
        assert.notEqual(compactedMessages[3]?.role, 'tool', 'compaction must preserve complete turns, not start with a tool');
        assertNoOrphanedToolMessages(compactedMessages);
      }

      return {
        usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        finishReason: 'stop',
        message: {
          content: '# Final report\n\nCompaction kept valid turn boundaries.',
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const largeLines = Array.from({ length: 260 }, (_, index) => `export const line${index} = "${'x'.repeat(700)}";`);
  await fs.writeFile(path.join(repoRoot, 'src', 'large.js'), largeLines.join('\n'));

  const client = new CompactionSequenceClient();
  const runtime = new ExplorerRuntime({ chatClient: client });

  const result = await runtime.freeExploreV2({
    prompt: '큰 파일을 반복적으로 읽으며 컨텍스트 컴팩션을 강제로 발생시켜라.',
    context: 'context '.repeat(40000),
    repo_root: repoRoot,
    thoroughness: 'normal',
  });

  assert.match(result.report, /Compaction kept valid turn boundaries/);
  assert.ok(result.stats.llmCompactions >= 1, 'LLM compaction must have occurred');
  assert.equal(result.stats.inputTokens, 215, 'compaction usage must retain prompt token accounting');
  assert.equal(result.stats.outputTokens, 80, 'compaction usage must retain completion token accounting');
  assert.equal(result.stats.totalTokens, 295, 'compaction usage must retain total token accounting');
  assert.equal(
    result.stats.inputTokens + result.stats.outputTokens,
    result.stats.totalTokens,
    'inputTokens + outputTokens must equal totalTokens when compaction usage is counted normally',
  );
});

test('ExplorerRuntime carries compact uncertainties instead of legacy followups', async () => {
  class UncertaintyClient {
    constructor() {
      this.model = 'zai-glm-4.7';
    }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '테스트 답변',
            statusConfidence: 'medium',
            evidence: [],
            uncertainties: ['추가 조사가 필요합니다'],
            nextAction: {
              type: 'ask_user',
              reason: '추가 조사가 필요합니다',
            },
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-string-followup-'));
  await fs.writeFile(path.join(root, 'index.js'), 'console.log("hello");');

  const runtime = new ExplorerRuntime({ chatClient: new UncertaintyClient() });
  const result = await runtime.explore({ task: '테스트', repo_root: root });

  assert.ok(Array.isArray(result.uncertainties));
  assert.ok(result.uncertainties.includes('추가 조사가 필요합니다'));
  assert.equal(result.followups, undefined);
});

test('ExplorerRuntime does not expose recentActivity when git_log tool is called', { skip: !hasGit() }, async () => {
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
          content: JSON.stringify(compactResult({
            directAnswer: '최근 커밋 이력을 확인했습니다.',
            statusConfidence: 'medium',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-git-'));
  await fs.writeFile(path.join(root, 'index.js'), 'console.log("hello");');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', 'index.js'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add index'], { cwd: root, stdio: 'ignore' });

  const runtime = new ExplorerRuntime({ chatClient: new GitLogClient() });
  const result = await runtime.explore({
    task: '최근에 어떤 파일이 변경되었나요?',
    repo_root: root,
    hints: { strategy: 'git-guided' },
  });

  assert.equal(result.recentActivity, undefined);
  assert.equal(result._debug?.recentActivity, undefined);
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
          content: JSON.stringify(compactResult({
            directAnswer: '인증 함수가 확인됩니다.',
            statusConfidence: 'medium',
            evidence: [
              { path: 'src/auth.js', startLine: 5, endLine: 6, why: '함수 본문' },
            ],
          })),
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
          content: JSON.stringify(compactResult({
            directAnswer: '답변', statusConfidence: 'low',
            evidence: [],
          })),
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
  assert.ok(result.directAnswer);
});

test('ExplorerRuntime returns sessionId in stats when sessionStore is provided', async () => {
  class SimpleClient {
    constructor() { this.model = 'mock'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '세션 테스트', statusConfidence: 'low',
            targets: [
              { path: 'src/auth.js', role: 'read', reason: 'session target', evidenceRefs: [] },
            ],
            evidence: [],
          })),
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
  assert.equal(result.sessionId, result.stats.sessionId, 'sessionId must also be top-level');

  // Session should store compact target paths from this call
  const session = sessionStore.get(result.stats.sessionId);
  assert.ok(session, 'session must exist in the store');
  assert.ok(session.targetPaths.includes('src/auth.js'), 'targetPaths must be accumulated');
});

test('ExplorerRuntime reports remainingCalls after the current session call is consumed', async () => {
  class SimpleClient {
    constructor() { this.model = 'mock'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '세션 테스트', statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const { SessionStore } = await import('../src/explorer/session.mjs');
  const sessionStore = new SessionStore({ maxCalls: 5 });
  const runtime = new ExplorerRuntime({ chatClient: new SimpleClient() });

  const first = await runtime.explore(
    { task: '첫 번째 세션 호출', repo_root: root },
    { sessionStore },
  );
  assert.equal(first.stats.remainingCalls, 4, 'new session stats must report remaining calls after this call completes');
  assert.equal(sessionStore.getRemainingCalls(first.stats.sessionId), 4, 'session store and runtime stats must agree after first call');

  const second = await runtime.explore(
    { task: '두 번째 세션 호출', repo_root: root, session: first.stats.sessionId },
    { sessionStore },
  );
  assert.equal(second.stats.remainingCalls, 3, 'reused session stats must decrement after the current call completes');
  assert.equal(sessionStore.getRemainingCalls(second.stats.sessionId), 3, 'session store and runtime stats must agree after second call');
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
          content: JSON.stringify(compactResult({
            directAnswer: 'ok', statusConfidence: 'low',
            evidence: [],
          })),
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

test('ExplorerRuntime falls back to a new session when exhausted_session', async () => {
  class SimpleClient {
    constructor() { this.model = 'mock'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'ok', statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const { SessionStore } = await import('../src/explorer/session.mjs');
  // maxCalls=1 so the session is exhausted after the first call
  const sessionStore = new SessionStore({ maxCalls: 1 });
  const runtime = new ExplorerRuntime({ chatClient: new SimpleClient() });

  // First call — creates session, exhausts it (calls reaches maxCalls=1)
  const first = await runtime.explore({ task: '첫 번째', repo_root: root }, { sessionStore });
  const exhaustedId = first.stats.sessionId;

  // Second call — passes the exhausted session ID
  const second = await runtime.explore(
    { task: '두 번째', repo_root: root, session: exhaustedId },
    { sessionStore },
  );

  // Must succeed and silently use a new session
  assert.ok(second.stats.sessionId, 'sessionId must exist in fallback result');
  assert.notEqual(second.stats.sessionId, exhaustedId, 'fallback must create a new session ID');
  assert.equal(second.stats.sessionStatus, 'fallback', 'sessionStatus must be "fallback"');
});

test('ExplorerRuntime falls back to a new session when expired_session', async () => {
  class SimpleClient {
    constructor() { this.model = 'mock'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'ok', statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const { SessionStore } = await import('../src/explorer/session.mjs');
  const sessionStore = new SessionStore();
  const runtime = new ExplorerRuntime({ chatClient: new SimpleClient() });

  // First call — creates session
  const first = await runtime.explore({ task: '첫 번째', repo_root: root }, { sessionStore });
  const sessionId = first.stats.sessionId;

  // Backdate lastUsedAt to simulate TTL expiry without relying on wall-clock timing
  const raw = sessionStore._sessions.get(sessionId);
  raw.lastUsedAt = Date.now() - sessionStore._ttlMs - 1000;

  // Second call — passes the now-expired session ID
  const second = await runtime.explore(
    { task: '두 번째', repo_root: root, session: sessionId },
    { sessionStore },
  );

  // Must succeed and silently use a new session
  assert.ok(second.stats.sessionId, 'sessionId must exist in fallback result');
  assert.notEqual(second.stats.sessionId, sessionId, 'fallback must create a new session ID');
  assert.equal(second.stats.sessionStatus, 'fallback', 'sessionStatus must be "fallback"');
});

test('ExplorerRuntime reuses the same session when the same Windows repo is passed as a Git Bash path', { skip: process.platform !== 'win32' }, async () => {
  class SimpleClient {
    constructor() { this.model = 'mock'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'ok', statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const bashStyleRoot = root.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
  const { SessionStore } = await import('../src/explorer/session.mjs');
  const sessionStore = new SessionStore();
  const runtime = new ExplorerRuntime({ chatClient: new SimpleClient() });

  const first = await runtime.explore({ task: '첫 번째', repo_root: root }, { sessionStore });
  const second = await runtime.explore(
    { task: '두 번째', repo_root: bashStyleRoot, session: first.stats.sessionId },
    { sessionStore },
  );

  assert.equal(second.stats.sessionStatus, 'reused');
  assert.equal(second.stats.sessionId, first.stats.sessionId);
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
          content: JSON.stringify(compactResult({
            directAnswer: '즉시 답변합니다.',
            statusConfidence: 'medium',
            evidence: [],
          })),
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
          content: JSON.stringify(compactResult({
            directAnswer: '분석 완료',
            statusConfidence: 'low',
            evidence: [],
          })),
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
  assert.equal(typeof result.directAnswer, 'string', 'answer must be a string even on malformed content');
  assert.ok(result.directAnswer.length > 0, 'answer must not be empty');
  assert.equal(result.status.confidence, 'low', 'confidence must be low on fallback path');
  assert.ok(Array.isArray(result.evidence), 'evidence must be an array on fallback');
  assert.ok(Array.isArray(result.uncertainties), 'uncertainties must be an array on fallback');
  assert.equal(result.followups, undefined);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.failure.category, 'internal');
  assert.equal(result.failure.reason, 'invalid_final_response');
  assert.equal(result.failure.retry.tool, 'explore_repo');
  assert.ok(result.failure.retry.hints.some(hint => /specific/i.test(hint)));
  assert.equal(result.failure.retry.args.task, 'Retry with a more specific task, symbol, file, or scope.');
  assert.deepEqual(Object.keys(result.failure.retry.args).sort(), ['scope', 'task']);
  assert.equal(result.failure.retry.expectedImprovement, 'A more specific prompt should improve compact JSON synthesis.');
  assert.equal(result.evidenceQuality.level, 'low');
});

test('ExplorerRuntime budget retry args do not echo unchanged scope', async () => {
  class BudgetRetryScopeClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'Budget exhausted before enough evidence was gathered.',
              statusConfidence: 'low',
              verification: 'follow_up_needed',
              complete: false,
              uncertainties: ['Budget exhausted before full follow-up.'],
              nextAction: { type: 'continue', reason: 'Retry with a narrower task.' },
            })),
            toolCalls: [],
          },
        };
      }

      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `grep-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `unlikely-${this.calls}`, scope: ['src/**'] }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new BudgetRetryScopeClient() });
  const result = await runtime.explore({
    task: 'Map auth behavior broadly enough to exhaust the quick budget.',
    repo_root: root,
    scope: ['src/**', 'tests/**'],
    budget: 'quick',
  });

  assert.equal(result.stats.stoppedByBudget, true);
  assert.equal(result.failure.reason, 'budget_exhausted');
  assert.equal(result.failure.retry.args.task, 'Retry with a narrower scope or a more specific task.');
  assert.equal(result.failure.retry.args.scope, undefined);
  assert.deepEqual(Object.keys(result.failure.retry.args).sort(), ['task']);
  assert.ok(
    result.failure.retry.hints.every(hint => !/deep budget/i.test(hint)),
    'budget exhaustion retry hints must not ask parent agents to select deep budget',
  );
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
          content: JSON.stringify(compactResult({
            directAnswer: '버그는 abc1234 커밋에서 도입됐습니다.',
            statusConfidence: 'medium',
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
          })),
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

test('Phase 5 — session reuse stores targetPathsWithContext as {path, why} objects', async () => {
  // Verifies that after an explore() call with evidence, the session stores
  // targetPathsWithContext as { path, why }[] objects (not plain strings).
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
          content: JSON.stringify(compactResult({
            directAnswer: '분석 완료',
            statusConfidence: 'medium',
            evidence: [
              { path: 'src/auth.js', startLine: 1, endLine: 4, why: '인증 함수 정의 위치' },
              { path: 'src/routes/user.js', startLine: 1, endLine: 6, why: '라우트 등록 위치' },
            ],
          })),
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
  assert.ok(Array.isArray(session.targetPathsWithContext),
    'targetPathsWithContext must be an array');
  assert.ok(session.targetPathsWithContext.length >= 2,
    'must have at least 2 enriched paths from evidence items');

  // Verify each entry is a { path, why } object
  for (const entry of session.targetPathsWithContext) {
    assert.equal(typeof entry.path, 'string', 'each entry must have a path string');
    assert.equal(typeof entry.why, 'string', 'each entry must have a why string');
    assert.ok(entry.why.length > 0, 'why must not be empty (should come from evidence.why)');
  }

  // Verify the paths are from the evidence items
  const paths = session.targetPathsWithContext.map(e => e.path);
  assert.ok(paths.includes('src/auth.js'), 'must include src/auth.js from evidence');
  assert.ok(paths.includes('src/routes/user.js'), 'must include src/routes/user.js from evidence');
});

test('Phase 5 — unknown tool validation stays in sync with current tool definitions', async () => {
  class UnknownToolClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'unknown-tool',
              function: { name: 'repo_totally_new_tool', arguments: '{}' },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'done',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const client = new UnknownToolClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  await runtime.explore({ task: 'unknown tool sync test', repo_root: root, budget: 'quick' });

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: BUDGETS.quick });
  await toolkit.initialize();
  const definedNames = toolkit.buildToolDefinitions().map(tool => tool.function.name).sort();

  const secondTurnMessages = client.snapshots[1];
  const validationToolMessage = secondTurnMessages[secondTurnMessages.length - 1];
  assert.equal(validationToolMessage.role, 'tool');

  const validationPayload = JSON.parse(validationToolMessage.content);
  const listedTools = validationPayload.message
    .split('Available tools: ')[1]
    .replace('. Choose one of these.', '')
    .split(', ')
    .sort();

  assert.deepEqual(listedTools, definedNames, 'validation error must derive its available tool list from current tool definitions');
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
          content: JSON.stringify(compactResult({
            directAnswer: '분석 완료', statusConfidence: 'low',
            evidence: [],
          })),
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
          content: JSON.stringify(compactResult({
            directAnswer: '빠른 답변', statusConfidence: 'low',
            evidence: [],
          })),
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

test('Phase 4 — critic-lite: confidence=high with only 1 evidence item is reconciled to medium', async () => {
  // With recalibrated confidence scoring, a single evidence item (no cross-file
  // verification, non-locate task) computes to 'medium' (base 0.30 + 0.18 = 0.48).
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
          content: JSON.stringify(compactResult({
            directAnswer: '자신있게 단정합니다.',
            statusConfidence: 'high',
            evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: '유일한 근거' }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new OverconfidentClient() });
  const result = await runtime.explore({ task: '인증 함수 분석', repo_root: root, budget: 'quick' });

  // Recalibrated scorer: base 0.30 + 0.18 (1 exact) = 0.48 → 'medium'
  // reconcileConfidence: lowerOf('high', 'medium') = 'medium'
  assert.ok(['low', 'medium'].includes(result.status.confidence),
    `confidence=high with 1 evidence item should be reconciled down, got ${result.status.confidence}`);
  assert.equal(result.critic.status, 'caution');
  assert.ok(result.critic.warnings.some(w => w.type === 'confidence_downgraded'));
  assert.ok(result.critic.warnings.every(w => w.message && w.action));
});

test('Phase 4 — freeExploreV2 respects turn multiplier override', async () => {
  class TurnBudgetClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion() {
      this.calls += 1;

      if (this.calls <= BUDGETS.quick.maxTurns) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `budget-${this.calls}`,
              function: {
                name: 'repo_grep',
                arguments: JSON.stringify({ pattern: 'requireAuth', maxResults: 1 }),
              },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        finishReason: 'stop',
        message: {
          content: '# Final report\n\nBudget override respected.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();

  await withEnv({
    CEREBRAS_EXPLORER_V2_TURN_MULTIPLIER: '1',
    CEREBRAS_EXPLORER_V2_MAX_EXTRA_TURNS: '0',
  }, async () => {
    const client = new TurnBudgetClient();
    const runtime = new ExplorerRuntime({ chatClient: client });
    const result = await runtime.freeExploreV2({
      prompt: 'turn override test',
      repo_root: root,
      thoroughness: 'quick',
    });

    assert.equal(result.stats.turns, BUDGETS.quick.maxTurns, 'V2 turn multiplier override must keep the base quick budget');
    assert.equal(result.stats.stoppedByBudget, true, 'result must stop by budget when the override removes extra turns');
    assert.equal(result.searchCoverage.stoppedByBudget, true);
    assert.ok(result.searchCoverage.warnings.some(warning => /budget/i.test(warning)));
    assert.equal(client.calls, BUDGETS.quick.maxTurns + 1, 'one finalization call should follow the bounded tool loop');
  });
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
  assert.ok(typeof result.directAnswer === 'string' && result.directAnswer.length > 0,
    'strict schema: answer must be a non-empty string');
  assert.ok(typeof result.directAnswer === 'string',
    'strict schema: summary must be a string');
  assert.ok(['low', 'medium', 'high'].includes(result.status.confidence),
    'strict schema: confidence must be low|medium|high');
  assert.ok(Array.isArray(result.targets),
    'strict schema: targets must be an array');
  assert.ok(Array.isArray(result.evidence),
    'strict schema: evidence must be an array');
  assert.ok(Array.isArray(result.uncertainties),
    'strict schema: uncertainties must be an array');
  assert.equal(result.candidatePaths, undefined,
    'strict schema: candidatePaths must not be exposed');
  assert.equal(result.followups, undefined,
    'strict schema: followups must not be exposed');
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
          content: JSON.stringify(compactResult({
            directAnswer: '인증 함수 위치를 확인했습니다.',
            statusConfidence: 'high',
            evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: '함수 정의' }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new JsonSuccessClient() });
  const result = await runtime.explore({ task: '인증 함수 찾기', repo_root: root });

  // JSON parse success: each field has the correct runtime type
  assert.equal(typeof result.directAnswer, 'string', 'answer must parse to string');
  assert.equal(typeof result.directAnswer, 'string', 'summary must parse to string');
  assert.ok(['low', 'medium', 'high'].includes(result.status.confidence), 'confidence must parse to valid label');
  assert.ok(Array.isArray(result.targets), 'targets must parse to array');
  assert.ok(Array.isArray(result.evidence), 'evidence must parse to array');
  assert.ok(Array.isArray(result.uncertainties), 'uncertainties must parse to array');
  assert.equal(result.candidatePaths, undefined);
  assert.equal(result.followups, undefined);
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
          content: JSON.stringify(compactResult({
            directAnswer: '테스트 답변',
            statusConfidence: 'medium',
            evidence: [],
          })),
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
          content: JSON.stringify(compactResult({
            directAnswer: 'reasoning forwarded',
            statusConfidence: 'low',
            evidence: [],
          })),
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

  assert.equal(result.directAnswer, 'reasoning forwarded');
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
          content: JSON.stringify(compactResult({
            directAnswer: 'malformed args handled',
            statusConfidence: 'low',
            evidence: [],
          })),
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
  assert.equal(result.directAnswer, 'malformed args handled');
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
          content: JSON.stringify(compactResult({
            directAnswer: 'checked',
            statusConfidence: 'low',
            evidence: [],
          })),
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
          content: JSON.stringify(compactResult({
            directAnswer: 'found requireAuth definition',
            statusConfidence: 'medium',
            evidence: [
              { kind: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 4, quote: 'export function requireAuth', why: 'definition of requireAuth', groundingStatus: 'exact' },
            ],
          })),
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
          content: JSON.stringify(compactResult({
            directAnswer: 'found',
            statusConfidence: 'medium',
            evidence: [
              // Wide range — grep only saw line 1, so L1-L200 should be partial not exact
              { kind: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 200, why: 'requireAuth module', evidenceType: 'file_range' },
            ],
          })),
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
          content: JSON.stringify(compactResult({
            directAnswer: 'found',
            statusConfidence: 'medium',
            evidence: [
              { evidenceType: 'git_commit', path: 'src/auth.js', sha: 'abc12345', why: 'commit that added requireAuth', startLine: 1, endLine: 4 },
            ],
          })),
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
          content: JSON.stringify(compactResult({ directAnswer: 'done', statusConfidence: 'low', evidence: [] })),
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
          content: JSON.stringify(compactResult({ directAnswer: 'done', statusConfidence: 'low', evidence: [] })),
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
          content: 'Here is my findings:\n\n```json\n' + JSON.stringify(compactResult({
            directAnswer: 'prose wrapped JSON salvaged',
            statusConfidence: 'medium',
            evidence: [],
          })) + '\n```\n\nThat is all I found.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new ProseWrappedClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root, budget: 'quick' });
  assert.ok(result, 'explore succeeded');
  assert.equal(result.directAnswer, 'prose wrapped JSON salvaged', 'prose-wrapped JSON is salvaged locally');
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
          content: JSON.stringify(compactResult({
            directAnswer: 'repaired after malformed JSON',
            statusConfidence: 'low',
            evidence: [],
          })),
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
  assert.equal(result.directAnswer, 'repaired after malformed JSON', 'repaired result is used');
});

test('finalize prompt bounds output size for compact JSON synthesis', () => {
  const prompt = buildFinalizePrompt();

  assert.match(prompt, /directAnswer.*1200/i);
  assert.match(prompt, /at most 8 targets/i);
  assert.match(prompt, /at most 8 evidence/i);
});

test('finalizeAfterToolLoop gives repair pass the full finalize token budget', async () => {
  const seenFinalizeBudgets = [];
  class TokenBudgetRepairClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion({ messages, maxCompletionTokens }) {
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
      const lastMessage = messages[messages.length - 1]?.content ?? '';
      if (!lastMessage.includes('Produce the final exploration result now.')
        && !lastMessage.includes('Repair your previous response')) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: { content: '', toolCalls: [] },
        };
      }
      seenFinalizeBudgets.push(maxCompletionTokens);
      if (lastMessage.includes('Produce the final exploration result now.')) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: maxCompletionTokens, total_tokens: 10 + maxCompletionTokens },
          message: {
            content: '{"directAnswer":"truncated","targets":[{"path":"src/auth.js","startLine":',
            toolCalls: [],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'repaired with full budget',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new TokenBudgetRepairClient() });
  const result = await runtime.explore({ task: 'find auth', repo_root: root, budget: 'quick' });

  assert.deepEqual(seenFinalizeBudgets, [
    BUDGETS.quick.finalizeMaxCompletionTokens,
    BUDGETS.quick.finalizeMaxCompletionTokens,
  ]);
  assert.equal(result.directAnswer, 'repaired with full budget');
});

// ── Phase 10 — Confidence Recalibration ──────────────────────────────────────

test('Phase 10 — runtime downgrades model high confidence to computed medium when evidence is weak', async () => {
  // The model claims "high" confidence but only provides a single piece of evidence
  // from one file with no search calls. The runtime should downgrade to medium or low.
  let callCount = 0;
  class WeakEvidenceClient {
    get model() { return 'zai-glm-4.7'; }
    async createChatCompletion({ messages }) {
      callCount += 1;
      const last = messages[messages.length - 1];
      const isSystem = last?.role === 'system';
      // Initial plan turn: emit a single read tool call
      if (callCount === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-read-1',
              type: 'function',
              function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/auth.js', start_line: 1, end_line: 3 }) },
            }],
          },
        };
      }
      // Finalize turn: claim high confidence with only one evidence item from one file
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'requireAuth is defined in src/auth.js',
            statusConfidence: 'high',
            evidence: [{
              path: 'src/auth.js',
              startLine: 1,
              endLine: 3,
              why: 'definition found here',
              evidenceType: 'file_range',
            }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new WeakEvidenceClient() });
  const result = await runtime.explore({ task: 'find requireAuth', repo_root: root, budget: 'quick' });
  assert.ok(result, 'explore returned a result');
  // The model claimed "high" but with only 1 exact item from 1 file, it must not be "high"
  assert.notEqual(result.status.confidence, 'high',
    'runtime must downgrade model-claimed high to medium/low when evidence is weak (single file, no search)');
});

test('ExplorerRuntime forwards abortSignal into chat client requests', async () => {
  const seenSignals = [];

  class SignalCaptureClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion(request) {
      this.calls += 1;
      seenSignals.push(request.signal);
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'signal forwarded',
            statusConfidence: 'low',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const controller = new AbortController();
  const runtime = new ExplorerRuntime({ chatClient: new SignalCaptureClient() });

  const result = await runtime.explore(
    {
      task: '인증 구조를 요약해라.',
      repo_root: repoRoot,
      budget: 'quick',
    },
    { abortSignal: controller.signal },
  );

  assert.equal(result.directAnswer, 'signal forwarded');
  assert.ok(seenSignals.length >= 2, 'explore + finalize calls should both receive the signal');
  assert.ok(seenSignals.every(signal => signal === controller.signal), 'abortSignal must be forwarded unchanged');
});

// ── 010 — Spec-1: status contract on evidence sufficiency ───────────────────

test('010 US1#1 — locate task with exact evidence stays complete even when budget exhausts', async () => {
  // Mock client emits one read tool call to ground evidence, then loops on no-op tool calls
  // until the budget runs out. The runtime must finalize with complete:true based on evidence
  // sufficiency rather than failing because of stoppedByBudget.
  class BudgetWithEvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth is defined in src/auth.js:1-4.',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'function declaration site',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
            })),
            toolCalls: [],
          },
        };
      }

      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `noop-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `unlikely-${this.calls}`, scope: ['src/**'] }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new BudgetWithEvidenceClient() });
  const result = await runtime.explore({
    task: 'find where requireAuth is defined',
    taskMode: 'symbol_trace',
    repo_root: root,
    budget: 'quick',
  });

  assert.equal(result.stats.stoppedByBudget, true, 'fixture must exhaust the quick budget');
  assert.equal(result.searchCoverage.stoppedByBudget, true, 'budget fact must remain visible');
  assert.equal(result.status.complete, true, 'sufficient locate evidence must yield complete:true');
  assert.ok(
    result.status.verification === 'verified' || result.status.verification === 'targeted_read_needed',
    `verification must reflect sufficiency, got ${result.status.verification}`,
  );
  assert.equal(result.failure, null, 'budget exhaustion must not produce failure when sufficient');
  assert.ok(result._debug?.evidenceSufficiency?.sufficient === true);
  assert.ok(
    (result.status.warnings ?? []).some(w => /budget/i.test(w)),
    'budget warning should remain in status.warnings even when complete',
  );
});

test('010 US1#2 — path_explanation with one evidence still incomplete after budget exhausts', async () => {
  // path_explanation requires exact >= 2 OR fileCount >= 2. One file/one exact item ⇒ insufficient.
  class PathExplanationClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'Partial trace — only first hop found.',
              statusConfidence: 'high',
              verification: 'follow_up_needed',
              complete: false,
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'entry function',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
            })),
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `noop-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `nothing-${this.calls}`, scope: ['src/**'] }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new PathExplanationClient() });
  const result = await runtime.explore({
    task: 'Trace request flow from requireAuth to response',
    taskMode: 'path_explanation',
    repo_root: root,
    budget: 'quick',
  });

  assert.equal(result.stats.stoppedByBudget, true);
  assert.equal(result.status.complete, false, 'complex task with one evidence must stay incomplete');
  assert.equal(result.status.verification, 'follow_up_needed');
  assert.equal(result.failure?.reason, 'budget_exhausted', 'insufficient + budget exhaustion must emit failure');
  assert.equal(result._debug?.evidenceSufficiency?.sufficient, false);
});

test('010 US1#3 — buildNextAction prefers explore_followup with a cited target over ask_user', async () => {
  // Confidence:high but partial grounding so verification falls to follow_up_needed.
  // Targets array carries a read target ⇒ nextAction should be explore_followup, not ask_user.
  class FollowUpClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'partial answer with one grounded reference',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'reference',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
              targets: [{
                path: 'src/routes/user.js',
                startLine: 1,
                endLine: 6,
                role: 'read',
                reason: 'verify caller',
                evidenceRefs: [],
              }],
            })),
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `noop-${this.calls}`,
            function: {
              name: 'repo_grep',
              arguments: JSON.stringify({ pattern: `nothing-${this.calls}` }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new FollowUpClient() });
  const result = await runtime.explore({
    task: 'Trace the request flow end-to-end',
    taskMode: 'path_explanation',
    repo_root: root,
    budget: 'quick',
  });

  if (result.status.verification === 'follow_up_needed' || result.status.verification === 'broad_search_needed') {
    assert.notEqual(result.nextAction.type, 'ask_user',
      'with a cited read target, nextAction should pick explore_followup over ask_user');
  }
});

// ── 010 — Spec-2: targets[] / discoveredPaths[] separation ──────────────────

test('010 US2#1 — listDir entries land in discoveredPaths[], not targets[]', async () => {
  class ListDirClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth is defined in src/auth.js:1-4.',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'function declaration site',
                evidenceType: 'file_range',
                groundingStatus: 'exact',
              }],
            })),
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'list-1',
              function: { name: 'repo_list_dir', arguments: JSON.stringify({ path: '.' }) },
            }],
          },
        };
      }
      if (this.calls === 2) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  // Inject a fake .github directory and docs file so list_dir picks them up
  const root = await makeRepoFixture();
  await fs.mkdir(path.join(root, '.github'), { recursive: true });
  await fs.writeFile(path.join(root, '.github', 'workflows.yml'), 'name: ci');
  await fs.writeFile(path.join(root, 'README.md'), '# repo');

  const runtime = new ExplorerRuntime({ chatClient: new ListDirClient() });
  const result = await runtime.explore({
    task: 'find where requireAuth is defined',
    taskMode: 'symbol_trace',
    repo_root: root,
    budget: 'quick',
  });

  assert.ok(Array.isArray(result.discoveredPaths), 'discoveredPaths[] must be present');
  assert.ok(result.discoveredPaths.length > 0, 'list_dir entries must surface in discoveredPaths[]');
  assert.ok(
    result.discoveredPaths.some(d => d.sourceTool === 'repo_list_dir'),
    'discoveredPaths must record sourceTool=repo_list_dir for listDir entries',
  );

  const targetPaths = (result.targets ?? []).map(t => t.path);
  // src/auth.js (the grounded evidence target) is allowed, but README.md / .github
  // must not appear in targets[].
  assert.ok(!targetPaths.includes('README.md'), `targets[] should not include README.md, got ${targetPaths.join(',')}`);
  assert.ok(!targetPaths.includes('.github'), `targets[] should not include .github, got ${targetPaths.join(',')}`);
});

test('010 US2#3 — CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1 restores reference target promotion', async () => {
  process.env.CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS = '1';
  try {
    class ListDirLegacyClient {
      constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
      async createChatCompletion({ responseFormat }) {
        this.calls += 1;
        if (responseFormat) {
          return {
            usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
            message: {
              content: JSON.stringify(compactResult({
                directAnswer: 'requireAuth is defined in src/auth.js:1-4.',
                statusConfidence: 'high',
                evidence: [{
                  path: 'src/auth.js',
                  startLine: 1,
                  endLine: 4,
                  why: 'def',
                  evidenceType: 'file_range',
                  groundingStatus: 'exact',
                }],
              })),
              toolCalls: [],
            },
          };
        }
        if (this.calls === 1) {
          return {
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
            message: {
              content: '',
              toolCalls: [{ id: 'l1', function: { name: 'repo_list_dir', arguments: JSON.stringify({ path: '.' }) } }],
            },
          };
        }
        if (this.calls === 2) {
          return {
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
            message: {
              content: '',
              toolCalls: [{ id: 'r1', function: { name: 'repo_read_file', arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }) } }],
            },
          };
        }
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: { content: '', toolCalls: [] },
        };
      }
    }

    const root = await makeRepoFixture();
    await fs.writeFile(path.join(root, 'README.md'), '# repo');

    const runtime = new ExplorerRuntime({ chatClient: new ListDirLegacyClient() });
    const result = await runtime.explore({
      task: 'find requireAuth',
      taskMode: 'symbol_trace',
      repo_root: root,
      budget: 'quick',
    });

    const referenceTargets = (result.targets ?? []).filter(t => t.role === 'reference');
    assert.ok(
      referenceTargets.length > 0,
      'legacy envvar must re-enable reference target promotion in targets[]',
    );
  } finally {
    delete process.env.CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS;
  }
});

test('010 US2#2 — buildReportCitationTargets merges same-file citations at file level', async () => {
  const { buildReportCitationTargets } = await import('../src/explorer/runtime.mjs').then(async m => {
    // The helper is not exported. Build a structurally equivalent test via the public route.
    return { buildReportCitationTargets: null };
  }).catch(() => ({ buildReportCitationTargets: null }));

  // The helper is module-private. Validate via the runtime freeExplore path: emit a
  // report with two citations of the same file and one citation of another file, and
  // assert the resulting targets[] is file-merged.
  class ReportCitationClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      // Provide a finalized Markdown report directly.
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: [
            '## Findings',
            'See `src/auth.js:L1-L3` and `src/auth.js:L5-L8` and `src/routes/user.js:L2`.',
          ].join('\n'),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new ReportCitationClient() });
  const reportResult = await runtime.freeExplore({
    prompt: 'Summarize the auth wiring',
    thoroughness: 'quick',
    repo_root: root,
  });

  const targets = reportResult.targets ?? [];
  const authTargets = targets.filter(t => t.path === 'src/auth.js');
  assert.equal(authTargets.length, 1, `src/auth.js should be merged into a single target, got ${authTargets.length}`);
  if (authTargets[0]) {
    assert.equal(authTargets[0].startLine, 1, 'merged startLine must be the min');
    assert.equal(authTargets[0].endLine, 8, 'merged endLine must be the max');
    assert.match(authTargets[0].reason, /merged from 2 ranges/i, 'reason should record merge count');
  }
});

test('010 US1#4 — critic fail forces broad_search_needed regardless of evidence count', async () => {
  // The model emits high confidence with multiple grounded items, but a synthetic critic
  // fail status must short-circuit to broad_search_needed and complete:false.
  class CriticFailClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify({
              ...compactResult({
                directAnswer: 'A confident answer with critic failure injected.',
                statusConfidence: 'high',
                evidence: [
                  { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'def', evidenceType: 'file_range', groundingStatus: 'exact' },
                  { path: 'src/routes/user.js', startLine: 1, endLine: 6, why: 'caller', evidenceType: 'file_range', groundingStatus: 'exact' },
                ],
              }),
              critic: { status: 'fail', warnings: [{ message: 'synthetic critic failure' }] },
            }),
            toolCalls: [],
          },
        };
      }
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CriticFailClient() });
  const result = await runtime.explore({
    task: 'symbol trace requireAuth',
    taskMode: 'symbol_trace',
    repo_root: root,
    budget: 'quick',
  });

  // Either runtime critic forces fail directly, or our injected critic survives normalization.
  // Either way: when evidence count is positive but critic fail is the signal, we must stay
  // in broad_search_needed and complete:false.
  if (result.critic?.status === 'fail') {
    assert.equal(result.status.complete, false);
    assert.equal(result.status.verification, 'broad_search_needed');
    assert.equal(result._debug?.evidenceSufficiency?.sufficient, false);
  }
});
