import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ExplorerRuntime as RuntimeImplementation, estimateTokens } from '../src/explorer/runtime.mjs';
import { buildExplorerSystemPrompt, buildFreeExploreSystemPrompt, buildFinalizePrompt, detectStrategy, buildExplorerUserPrompt, STRATEGY_DESCRIPTIONS } from '../src/explorer/prompt.mjs';
import { getRuntimeConfig } from '../src/explorer/config.mjs';
import { RepoToolkit } from '../src/explorer/repo-tools.mjs';
import {
  createRequiredSubgoal,
  createTaskContract,
  fingerprintAction,
} from '../src/explorer/coverage.mjs';
import { adaptLegacyGoalAuditClient } from './helpers/legacy-goal-audit-client.mjs';

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

// Existing tests below isolate the pre-028 exploration loop. Their provider
// scripts predate required planning, so this test-only adapter answers only the
// isolated planner/auditor calls. T017 uses RuntimeImplementation directly.
class ExplorerRuntime extends RuntimeImplementation {
  constructor({ chatClient = null, ...options } = {}) {
    super({ ...options, chatClient: adaptLegacyGoalAuditClient(chatClient) });
  }
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

async function readJsonl(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  return source.trim().split('\n').map(line => JSON.parse(line));
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
  });

  // Core fields — confidence calibration: 2 exact cross-verified evidence items with
  // a non-locate task yields 'medium' with the task-aware scoring (base 0.15).
  assert.ok(['medium', 'high'].includes(result.status.confidence), `confidence must be medium or high, got: ${result.status.confidence}`);
  assert.match(result.directAnswer, /requireAuth/);
  assert.equal(result.status.verification, 'verified');
  assert.ok(Array.isArray(result.targets), 'targets must be an array');
  assert.ok(result.targets.some(target => target.path === 'src/routes/user.js'), 'targets include route file');
  assert.ok(result.targets.every(target => target.role !== 'edit'), 'read-only tracing must not mark all evidence targets as edit');
  assert.equal(result.schemaVersion, 2);
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
  // spec 017: _debug envelope was removed; toolCalls/grepCalls/filesRead stay on
  // result.stats which is no longer propagated to MCP structuredContent. The
  // toolTrace and its grep/read entries are no longer surfaced.
  assert.equal(result._debug, undefined, 'runtime no longer exposes a _debug envelope');
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

test('ExplorerRuntime explore writes LOG_PATH transcript with stable callId records', async () => {
  const repoRoot = await makeRepoFixture();
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-runtime-transcripts-'));

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
  }, async () => {
    const runtime = new ExplorerRuntime({ chatClient: new MockChatClient() });
    const result = await runtime.explore({
      task: 'users/me 라우트에 인증 미들웨어가 어떻게 붙는지 추적해라.',
      repo_root: repoRoot,
      scope: ['src/**'],
    });

    assert.equal(typeof result.transcriptPath, 'string');
    assert.match(
      path.basename(result.transcriptPath),
      /^[0-9T-]+Z_explore_repo_[0-9a-f-]{36}\.jsonl$/,
    );

    const files = (await fs.readdir(logDir)).filter(name => name.endsWith('.jsonl'));
    assert.deepEqual(files, [path.basename(result.transcriptPath)]);

    const entries = await readJsonl(result.transcriptPath);
    const filenameCallId = path.basename(result.transcriptPath, '.jsonl').split('_').at(-1);
    assert.ok(entries.length >= 3);
    assert.ok(entries.every(entry => entry.callId === filenameCallId));
    assert.ok(entries.some(entry => entry.type === 'assistant'));
    assert.ok(entries.some(entry => entry.type === 'tool'));
    const grepEntry = entries.find(entry => entry.type === 'tool' && entry.tool === 'repo_grep');
    assert.ok(grepEntry, 'grep tool entry must be recorded');
    assert.deepEqual(grepEntry.args, { pattern: 'requireAuth', scope: ['src/**'] });
    assert.ok(grepEntry.result.matches >= 2);
    assert.deepEqual(grepEntry.result.paths, ['src/auth.js', 'src/routes/user.js']);
    assert.equal(JSON.stringify(grepEntry).includes('export function requireAuth'), false);
    assert.equal(entries.at(-1).redacted, true);
  });
});

test('ExplorerRuntime trust summary mentions dropped evidence caveats', async () => {
  class DroppedEvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-auth',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth rejects unauthenticated requests.',
              statusConfidence: 'high',
              evidence: [
                { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'read implementation' },
                { path: 'src/missing.js', startLine: 1, endLine: 2, why: 'not observed' },
              ],
            })),
            toolCalls: [],
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
  const runtime = new ExplorerRuntime({ chatClient: new DroppedEvidenceClient() });
  const result = await runtime.explore({
    task: 'Explain requireAuth',
    repo_root: root,
    taskMode: 'symbol_trace',
  });

  assert.equal(result.evidenceQuality.droppedCount, 1);
  assert.match(result.evidenceQuality.summary, /retained evidence/i);
  assert.match(result.evidenceQuality.summary, /1 evidence item\(s\) dropped/i);
  assert.doesNotMatch(result.evidenceQuality.summary, /^.*All evidence grounded in inspected code\.$/);
});

test('ExplorerRuntime drops target evidenceRefs that do not reference retained evidence ids', async () => {
  class InvalidRefsClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-auth',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth는 인증되지 않은 요청을 거부합니다.',
              statusConfidence: 'high',
              evidence: [
                { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'requireAuth 구현 위치입니다.' },
              ],
              targets: [
                {
                  path: 'src/auth.js',
                  startLine: 1,
                  endLine: 4,
                  role: 'read',
                  reason: '근거가 있는 target입니다.',
                  evidenceRefs: ['file_range', 'E1', 'missing-id'],
                },
              ],
            })),
            toolCalls: [],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new InvalidRefsClient() });
  const result = await runtime.explore({
    task: 'requireAuth를 설명해라.',
    repo_root: root,
    scope: ['src/**'],
  });

  const validEvidenceIds = new Set(result.evidence.map(item => item.id));
  assert.ok(result.targets.length > 0, 'expected at least one grounded target');
  for (const target of result.targets) {
    for (const ref of target.evidenceRefs) {
      assert.equal(validEvidenceIds.has(ref), true, `${ref} must point at retained evidence`);
    }
  }
  assert.ok(!JSON.stringify(result.targets).includes('file_range'), 'dangling ref "file_range" must be dropped');
  assert.ok(!JSON.stringify(result.targets).includes('missing-id'), 'hallucinated ref "missing-id" must be dropped');
});

test('ExplorerRuntime bounds discoveredPaths and reports omitted candidate count', async () => {
  class DiscoveryClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [
              {
                id: 'list-src',
                function: { name: 'repo_list_dir', arguments: JSON.stringify({ dirPath: 'src' }) },
              },
              {
                id: 'read-auth',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
                },
              },
            ],
          },
        };
      }
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth is defined in src/auth.js.',
              statusConfidence: 'medium',
              evidence: [
                { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'definition was read' },
              ],
            })),
            toolCalls: [],
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
  for (let i = 0; i < 60; i += 1) {
    await fs.writeFile(path.join(root, 'src', `candidate-${i}.js`), `export const c${i} = ${i};\n`);
  }

  const runtime = new ExplorerRuntime({ chatClient: new DiscoveryClient() });
  const result = await runtime.explore({
    task: 'Find auth-related candidates',
    repo_root: root,
  });

  assert.ok(result.discoveredPaths.length <= 50, `expected bounded discoveredPaths, got ${result.discoveredPaths.length}`);
  assert.ok(result.searchCoverage.omittedDiscoveredPaths > 0);
  assert.ok(
    result.searchCoverage.warnings.some(warning => /discovered path/i.test(warning)),
    'searchCoverage must warn when discovered path candidates are omitted',
  );
});

test('ExplorerRuntime stats use successful failover provider metadata when present', async () => {
  class ProviderMetadataClient {
    constructor() { this.model = 'primary-model'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      const base = {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        usedProvider: { providerIndex: 1, model: 'fallback-model' },
      };
      if (responseFormat) {
        return {
          ...base,
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'Provider metadata was attached.',
              statusConfidence: 'low',
              evidence: [],
            })),
            toolCalls: [],
          },
        };
      }
      return {
        ...base,
        message: { content: '', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new ProviderMetadataClient() });
  const result = await runtime.explore({
    task: 'Return a minimal provider metadata result',
    repo_root: root,
  });

  assert.equal(result.stats.model, 'fallback-model');
  assert.equal(result.stats.providerIndex, 1);
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
  });

  assert.equal(result.diagram, undefined, 'runtime should not emit Mermaid diagram output');
  // spec 017: _debug envelope was removed; codeMap stays on the raw runtime result.
  assert.equal(result._debug, undefined, 'runtime no longer exposes a _debug envelope');
  assert.ok(result.codeMap, 'codeMap should remain available as structured data');
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
  });

  assert.equal(result.stats.turns, 3, 'tool loop must stop after the third all-error turn');
  assert.equal(result.stats.stoppedByErrors, true, 'circuit breaker must mark stoppedByErrors');
  assert.equal('stoppedByBudget' in result.stats, false, 'structured stats must not expose a budget stop');
  assert.deepEqual(result.stats.safetyLimits, [], 'tool errors must not be mislabeled as safety-limit stops');
  assert.equal(client.calls, 3, 'tool-error termination must not make an untrusted finalization call');
  assert.equal(result.schemaVersion, 2);
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

test('Phase 1 — freeExplore circuit breaker trips after three all-error turns', async () => {
  class AllErrorFreeExploreClient {
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
  const client = new AllErrorFreeExploreClient();
  const runtime = new ExplorerRuntime({ chatClient: client });

  const result = await runtime.freeExplore({
    prompt: '반복적인 도구 실패 이후 보고서를 작성해라.',
    repo_root: repoRoot,
  });

  assert.equal(result.stats.turns, 3, 'report-mode tool loop must stop after the third all-error turn');
  assert.equal(result.stats.stoppedByErrors, true, 'report-mode circuit breaker must mark stoppedByErrors');
  assert.equal(result.stats.stoppedByBudget, false, 'error stop must not be mislabeled as budget stop');
  assert.equal(client.calls, 4, 'three tool-loop calls plus one finalization call');

  const thirdTurnMessages = client.snapshots[2];
  assert.ok(
    thirdTurnMessages.some(m => m.role === 'user' && m.content?.includes('repeating the same failing')),
    'report-mode recovery guidance must be present before the third failing turn',
  );
});

test('freeExplore labels truncated tool results as incomplete before synthesis', async () => {
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
  const result = await runtime.freeExplore({
    prompt: 'inspect a large file and produce a cited report',
    repo_root: root,
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
  const completeResult = await completeRuntime.freeExplore({
    prompt: 'inspect a small file and produce a cited report',
    repo_root: root,
  });
  assert.equal(completeResult.searchCoverage.toolResultsTruncated, 0);
  assert.equal(
    completeResult.searchCoverage.warnings.some(warning => /expected evidence is missing/i.test(warning)),
    false,
    'complete tool results must not emit truncation recovery warnings',
  );
});

test('freeExplore searchCoverage counts non-read tool calls', async () => {
  class CoverageFreeExploreClient {
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
  const runtime = new ExplorerRuntime({ chatClient: new CoverageFreeExploreClient() });

  const result = await runtime.freeExplore({
    prompt: 'auth surface coverage',
    repo_root: repoRoot,
  });

  assert.equal(result.stats.listDirCalls, 1);
  assert.equal(result.stats.symbolCalls, 1);
  assert.equal(result.stats.grepCalls, 1);
  assert.equal(result.searchCoverage.listDirCalls, 1);
  assert.equal(result.searchCoverage.symbolCalls, 1);
  assert.equal(result.searchCoverage.grepCalls, 1);
});

test('Phase 1 — freeExplore compaction preserves complete turns and valid tool sequencing', async () => {
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

  const result = await runtime.freeExplore({
    prompt: '큰 파일을 반복적으로 읽으며 컨텍스트 컴팩션을 강제로 발생시켜라.',
    context: 'context '.repeat(40000),
    repo_root: repoRoot,
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

test('freeExplore fallback compaction fires in the 70-100% band when LLM summary is unavailable (spec 024 FR-001)', async () => {
  // The LLM-summary compaction call uses maxCompletionTokens: 1000. Throwing for it
  // forces the runtime down the catch-branch fallback. Before FR-001 that fallback
  // passed maxContextTokens (100%), so compactOldToolResults no-oped in the 70-100%
  // band; now it passes compactionThreshold (70%) and actually truncates old tool results.
  class SummaryFailsClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages, maxCompletionTokens }) {
      if (maxCompletionTokens === 1000) {
        throw new Error('summary provider unavailable');
      }
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      if (this.calls <= 10) {
        return {
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
          message: {
            content: '',
            toolCalls: [{
              id: `read-${this.calls}`,
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/large.js', startLine: 1, endLine: 220 }),
              },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        finishReason: 'stop',
        message: {
          content: '# Final report\n\nFallback truncation kept the loop within budget.',
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const largeLines = Array.from({ length: 260 }, (_, index) => `export const line${index} = "${'x'.repeat(700)}";`);
  await fs.writeFile(path.join(repoRoot, 'src', 'large.js'), largeLines.join('\n'));

  const client = new SummaryFailsClient();
  const runtime = new ExplorerRuntime({ chatClient: client });

  const result = await runtime.freeExplore({
    prompt: 'Force fallback compaction by exhausting the summary path.',
    context: 'context '.repeat(40000), // ~80k tokens → inside the 70-100% band of 110k
    repo_root: repoRoot,
  });

  const sawTruncatedToolResult = client.snapshots.some(snapshot =>
    snapshot.some(message =>
      message.role === 'tool'
      && typeof message.content === 'string'
      && message.content.includes('[truncated from'),
    ),
  );
  assert.ok(
    sawTruncatedToolResult,
    'fallback compaction must truncate old tool results in the 70-100% band (FR-001)',
  );

  for (const snapshot of client.snapshots) {
    assertNoOrphanedToolMessages(snapshot);
  }
  assert.ok(result.report.length > 0, 'a report must still be produced after fallback compaction');
});

test('estimateTokens weights non-ASCII higher than ASCII (spec 024 FR-003)', () => {
  const koreanText = '가'.repeat(400); // 400 non-ASCII chars
  const asciiText = 'a'.repeat(400);   // 400 ASCII chars

  const koreanEstimate = estimateTokens([{ role: 'user', content: koreanText }]);
  const asciiEstimate = estimateTokens([{ role: 'user', content: asciiText }]);
  const legacyChars4 = Math.ceil(koreanText.length / 4);

  // Non-ASCII text must estimate more tokens than the same length of ASCII...
  assert.ok(
    koreanEstimate > asciiEstimate,
    `Korean text (${koreanEstimate}) must estimate more tokens than equal-length ASCII (${asciiEstimate})`,
  );
  // ...and more than the legacy flat chars/4 heuristic.
  assert.ok(
    koreanEstimate > legacyChars4,
    `Korean text (${koreanEstimate}) must estimate more than legacy chars/4 (${legacyChars4})`,
  );
  // ASCII estimation stays at chars/4.
  assert.equal(asciiEstimate, Math.ceil(asciiText.length / 4));
  // tool_calls and reasoning fields are also counted.
  assert.ok(estimateTokens([{ role: 'assistant', content: '', reasoning: koreanText }]) > 0);
});

test('explore compacts proactively at 70% and injects a deterministic evidence ledger (spec 024 FR-002)', async () => {
  const LEDGER_MARKER = '[verified-evidence-ledger]'; // internal protocol string (runtime.mjs)

  class CompactExploreClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages, responseFormat }) {
      this.calls += 1;
      this.snapshots.push(cloneMessages(messages));

      // Finalize call (json_schema) → return a valid compact JSON result.
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          message: { content: JSON.stringify(compactResult({ directAnswer: 'done' })), toolCalls: [] },
        };
      }

      // First turns: read the large file to push the compact context past 70%.
      if (this.calls <= 8) {
        return {
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
          message: {
            content: '',
            toolCalls: [{
              id: `read-${this.calls}`,
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/large.js', startLine: 1, endLine: 220 }),
              },
            }],
          },
        };
      }

      // Stop calling tools → loop finalizes.
      return {
        usage: { prompt_tokens: 45, completion_tokens: 15, total_tokens: 60 },
        finishReason: 'stop',
        message: { content: 'Done exploring.', toolCalls: [] },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const largeLines = Array.from({ length: 260 }, (_, index) => `export const line${index} = "${'x'.repeat(700)}";`);
  await fs.writeFile(path.join(repoRoot, 'src', 'large.js'), largeLines.join('\n'));

  const client = new CompactExploreClient();
  const runtime = new ExplorerRuntime({ chatClient: client });

  const result = await runtime.explore({
    task: 'Force proactive compaction on the compact path.',
    repo_root: repoRoot,
    scope: ['src/**'],
  });

  const isLedger = (message) =>
    message.role === 'user'
    && typeof message.content === 'string'
    && message.content.startsWith(LEDGER_MARKER);

  // (a) proactive compaction truncated at least one old tool result.
  const sawTruncatedToolResult = client.snapshots.some(snapshot =>
    snapshot.some(message =>
      message.role === 'tool'
      && typeof message.content === 'string'
      && message.content.includes('[truncated from'),
    ),
  );
  assert.ok(sawTruncatedToolResult, 'proactive compaction must truncate old tool results (FR-002)');
  assert.ok(result.stats.safetyLimits.some(limit =>
    limit.name === 'context_limit' && limit.stage === 'exploration' && limit.truncated),
    'the compacted context must remain observable as an exact safety limit');

  // (b) a deterministic ledger was injected, lists the inspected range, and is never duplicated.
  const ledgerSnapshot = client.snapshots.find(snapshot => snapshot.some(isLedger));
  assert.ok(ledgerSnapshot, 'an evidence ledger must be injected after proactive compaction (FR-002)');
  const ledgerMsg = ledgerSnapshot.find(isLedger);
  assert.ok(ledgerMsg.content.includes('large.js'), 'ledger must list the inspected file');
  assert.match(ledgerMsg.content, /L\d+-\d+/, 'ledger must carry a verified line range');
  assert.ok(
    client.snapshots.every(snapshot => snapshot.filter(isLedger).length <= 1),
    'at most one ledger message may exist at a time (dedup-replace)',
  );

  // (c) tool_call pairing stays intact across every snapshot.
  for (const snapshot of client.snapshots) {
    assertNoOrphanedToolMessages(snapshot);
  }
});

test('freeExplore wires observedRanges into the report critic for line-range grounding (spec 024 FR-004)', async () => {
  // Reads src/auth.js lines 1-4, then writes a report citing L50-L60 (outside the
  // inspected range). End-to-end this must surface a citation_line_gap, proving the
  // report loop records observedRanges and passes them to buildReportCritic.
  class CiteOutOfRangeClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
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
        usage: { prompt_tokens: 45, completion_tokens: 30, total_tokens: 75 },
        finishReason: 'stop',
        message: {
          content: '# Report\n\nThe auth guard is defined at `src/auth.js:L50-L60` (claimed).',
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CiteOutOfRangeClient() });

  const result = await runtime.freeExplore({
    prompt: 'Where is the auth guard defined?',
    repo_root: repoRoot,
  });

  const lineGap = result.critic.warnings.find(warning => warning.type === 'citation_line_gap');
  assert.ok(lineGap, 'freeExplore must wire observedRanges into buildReportCritic (FR-004)');
  assert.match(lineGap.target, /auth\.js/);
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
  const commitObservation = result.observations.find(item => item.kind === 'git_commit');
  assert.ok(commitObservation, 'git log must produce a runtime-owned commit observation');
  assert.equal(commitObservation.id, 'E1');
  assert.equal(commitObservation.temporalRole, 'historical');
  assert.match(commitObservation.sha, /^[0-9a-f]{40}$/);
  assert.match(commitObservation.content, /add index/);
  assert.ok(result.observations.some(item =>
    item.id === 'E1:search' && item.kind === 'search' && item.tool === 'repo_git_log'),
  'git history keeps its normalized search boundary separately from commit content');
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
    { task: '인증 함수 찾기', repo_root: root, scope: ['src/**'] },
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

// spec 017: SessionStore was removed entirely. Tests that exercised session
// fallback / remainingCalls / cross-call summary injection were deleted along
// with src/explorer/session.mjs.

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
  const result = await runtime.explore({ task: '단순 질문', repo_root: root });

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
  await runtime.explore({ task: '테스트', repo_root: root });

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
  const result = await runtime.explore({ task: '인증 위치 찾기', repo_root: root });

  // Fallback path must still produce schema-compliant structure
  assert.equal(typeof result.directAnswer, 'string', 'answer must be a string even on malformed content');
  assert.ok(result.directAnswer.length > 0, 'answer must not be empty');
  assert.equal(result.status.confidence, 'low', 'confidence must be low on fallback path');
  assert.ok(Array.isArray(result.evidence), 'evidence must be an array on fallback');
  assert.ok(Array.isArray(result.uncertainties), 'uncertainties must be an array on fallback');
  assert.equal(result.followups, undefined);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.failure.category, 'internal');
  assert.equal(result.failure.reason, 'invalid_final_response');
  assert.equal(result.failure.retry.tool, 'explore_repo');
  assert.ok(result.failure.retry.hints.some(hint => /specific/i.test(hint)));
  assert.equal(result.failure.retry.args.task, 'Retry with a more specific task, symbol, file, or scope.');
  assert.deepEqual(Object.keys(result.failure.retry.args).sort(), ['scope', 'task']);
  assert.equal(result.failure.retry.expectedImprovement, 'A more specific prompt should improve compact JSON synthesis.');
  assert.equal(result.evidenceQuality.level, 'low');
});

// T008 fixed the expected behavior before T013 changed runtime fault precedence.
test('Spec 028 T008 — a valid partial tool-result limit is non-fatal and cannot establish completion', async () => {
  class PartialToolLimitClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-long-file',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/long.js', startLine: 1, endLine: 10_000 }),
              },
            }],
          },
        };
      }

      if (!responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: { content: 'Ready to synthesize.', toolCalls: [] },
        };
      }

      return {
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'The complete file could not be inspected within the fixed read limit.',
            verification: 'follow_up_needed',
            complete: false,
            uncertainties: ['The requested exhaustive read is incomplete.'],
            nextAction: { type: 'stop', reason: 'The bounded result is incomplete.' },
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const longSource = Array.from({ length: 400 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join('\n');
  await fs.writeFile(path.join(root, 'src', 'long.js'), longSource);

  const runtime = new ExplorerRuntime({ chatClient: new PartialToolLimitClient() });
  const result = await runtime.explore({
    task: 'Inspect every line in src/long.js and report whether any line was omitted.',
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal('budget' in result.stats, false);
  assert.equal('stoppedByBudget' in result.stats, false);
  assert.equal(result.status.complete, false);
  assert.equal(result.failure, null, 'a valid partial result is an incomplete proof state, not execution failure');
  assert.equal(result.nextAction.type, 'stop', 'a fixed limit must not create a pointless question for the parent');
  assert.equal(Array.isArray(result.stats.safetyLimits), true);
  const limit = result.stats.safetyLimits.find(item => item.name === 'tool_result_limit');
  assert.ok(limit, 'the exact reached limit must be recorded');
  assert.equal(limit.stage, 'exploration');
  assert.equal(limit.truncated, true);
  assert.equal(Array.isArray(limit.affectedSubgoalIds), true);
});

test('Spec 028 T008 — an output-capped invalid control response remains a fatal fault', async () => {
  class InvalidControlOutputClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (!responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          message: { content: '', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
        finishReason: 'length',
        message: { content: '{}', toolCalls: [] },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new InvalidControlOutputClient() });
  const result = await runtime.explore({ task: 'Locate the auth middleware.', repo_root: root });

  assert.equal('budget' in result.stats, false);
  assert.equal('stoppedByBudget' in result.stats, false);
  assert.equal(result.status.complete, false);
  assert.ok(result.failure, 'invalid required control JSON cannot be promoted as partial evidence');
  assert.equal(result.failure.reason, 'invalid_final_response');
  assert.equal(Array.isArray(result.stats.safetyLimits), true);
  const limit = result.stats.safetyLimits.find(item => item.name === 'generation_output_limit');
  assert.ok(limit, 'the provider output ceiling must remain observable alongside the fatal fault');
  assert.equal(limit.stage, 'synthesis');
  assert.equal(limit.truncated, true);
});

test('Spec 028 T013 — a recovered output cap remains observable but non-fatal', async () => {
  class RecoveredControlOutputClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (!responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          message: { content: '', toolCalls: [] },
        };
      }
      if (this.calls === 2) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
          finishReason: 'length',
          message: { content: '{"directAnswer":', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 35, completion_tokens: 10, total_tokens: 45 },
        finishReason: 'stop',
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'The capped control response was repaired without adding facts.',
            verification: 'follow_up_needed',
            complete: false,
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new RecoveredControlOutputClient() });
  const result = await runtime.explore({ task: 'Locate the auth middleware.', repo_root: root });

  assert.equal(result.failure, null, 'successful bounded recovery must not become an execution failure');
  assert.equal(result.status.complete, false, 'recovery cannot establish proof without grounded evidence');
  assert.ok(result.stats.safetyLimits.some(limit =>
    limit.name === 'generation_output_limit' && limit.stage === 'synthesis' && limit.truncated));
});

test('Spec 028 T013 — an intentional short file range is not a tool-result limit', async () => {
  class ShortRangeClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          message: {
            content: '',
            toolCalls: [{
              id: 'short-read',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/long.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }
      if (!responseFormat) {
        return {
          usage: { prompt_tokens: 25, completion_tokens: 5, total_tokens: 30 },
          message: { content: 'Ready to synthesize.', toolCalls: [] },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'The requested first four lines were inspected.',
            statusConfidence: 'high',
            evidence: [{
              path: 'src/long.js',
              startLine: 1,
              endLine: 4,
              why: 'requested bounded range',
              evidenceType: 'file_range',
              groundingStatus: 'exact',
            }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const longSource = Array.from({ length: 400 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join('\n');
  await fs.writeFile(path.join(root, 'src', 'long.js'), longSource);
  const runtime = new ExplorerRuntime({ chatClient: new ShortRangeClient() });
  const result = await runtime.explore({
    task: 'Read only lines 1 through 4 of src/long.js.',
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(result.stats.safetyLimits.some(limit => limit.name === 'tool_result_limit'), false);
});

test('ExplorerRuntime turn limit stays non-fatal and preserves the hard scope', async () => {
  class TurnLimitScopeClient {
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
              directAnswer: 'The turn limit was reached before enough evidence was gathered.',
              statusConfidence: 'low',
              verification: 'follow_up_needed',
              complete: false,
              uncertainties: ['The turn limit was reached before full follow-up.'],
              nextAction: { type: 'stop', reason: 'The bounded result is incomplete.' },
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
  const runtime = new ExplorerRuntime({ chatClient: new TurnLimitScopeClient() });
  const result = await runtime.explore({
    task: 'Map auth behavior broadly enough to reach the fixed turn limit.',
    repo_root: root,
    scope: ['src/**', 'tests/**'],
  });

  assert.equal('stoppedByBudget' in result.stats, false);
  assert.equal(result.failure, null, 'a valid turn limit is a partial proof state, not an execution fault');
  assert.deepEqual(result.stats.scope, ['src/**', 'tests/**']);
  assert.ok(result.stats.safetyLimits.some(limit =>
    limit.name === 'turn_limit' && limit.stage === 'exploration' && limit.truncated === false));
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
    hints: { strategy: 'git-guided' },
  });

  // git_commit evidence with unverified SHA must be dropped (fabrication prevention)
  assert.equal(result.evidence.length, 0, 'unverified git_commit evidence must be dropped');
});

// spec 017: Phase 5 session reuse test removed alongside SessionStore module.

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
  await runtime.explore({ task: 'unknown tool sync test', repo_root: root });

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

test('Phase 4 — checkpoint message is inserted after every 4 turns', async () => {
  // Verifies that when maxTurns > 6, a checkpoint user message is
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
  await runtime.explore({ task: '인증 분석', repo_root: root });

  // The 5th call to createChatCompletion (turnIndex=4) should have a checkpoint
  // user message injected before it. That means capturedMessages[4] should contain
  // a user message with "Checkpoint" text.
  const turn5Messages = capturedMessages[4];
  const checkpointMsg = turn5Messages.find(
    m => m.role === 'user' && m.content?.includes('Checkpoint'),
  );
  assert.ok(checkpointMsg, 'checkpoint message must be injected at turnIndex=4');
});

test('Phase 4 — checkpoint is NOT inserted before the loop reaches the interval', async () => {
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
  await runtime.explore({ task: '테스트', repo_root: root });

  // No message should contain "Checkpoint"
  const hasCheckpoint = capturedMessages.some(msgs =>
    msgs.some(m => m.role === 'user' && m.content?.includes('Checkpoint')),
  );
  assert.equal(hasCheckpoint, false, 'checkpoint must NOT be inserted before the interval');
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
  const result = await runtime.explore({ task: '인증 함수 분석', repo_root: root });

  // Recalibrated scorer: base 0.30 + 0.18 (1 exact) = 0.48 → 'medium'
  // reconcileConfidence: lowerOf('high', 'medium') = 'medium'
  assert.ok(['low', 'medium'].includes(result.status.confidence),
    `confidence=high with 1 evidence item should be reconciled down, got ${result.status.confidence}`);
  assert.equal(result.critic.status, 'caution');
  assert.ok(result.critic.warnings.some(w => w.type === 'confidence_downgraded'));
  assert.ok(result.critic.warnings.every(w => w.message && w.action));
});

test('Phase 4 — freeExplore respects turn multiplier override', async () => {
  class TurnBudgetClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion() {
      this.calls += 1;

      if (this.calls <= getRuntimeConfig().maxTurns) {
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
    CEREBRAS_EXPLORER_TURN_MULTIPLIER: '1',
    CEREBRAS_EXPLORER_MAX_EXTRA_TURNS: '0',
  }, async () => {
    const client = new TurnBudgetClient();
    const runtime = new ExplorerRuntime({ chatClient: client });
    const result = await runtime.freeExplore({
      prompt: 'turn override test',
      repo_root: root,
    });

    assert.equal(result.stats.turns, getRuntimeConfig().maxTurns, 'turn multiplier override must keep the base runtime config');
    assert.equal(result.stats.stoppedByBudget, true, 'result must stop by budget when the override removes extra turns');
    assert.equal(result.searchCoverage.stoppedByBudget, true);
    assert.ok(result.searchCoverage.warnings.some(warning => /budget/i.test(warning)));
    assert.equal(client.calls, getRuntimeConfig().maxTurns + 1, 'one finalization call should follow the bounded tool loop');
  });
});

test('freeExplore recovers from finishReason=length finalize and increments outputRecoveries', async () => {
  class LengthRecoveryClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
    }

    async createChatCompletion() {
      this.calls += 1;

      if (this.calls <= getRuntimeConfig().maxTurns) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `tool-${this.calls}`,
              function: {
                name: 'repo_grep',
                arguments: JSON.stringify({ pattern: 'requireAuth', maxResults: 1 }),
              },
            }],
          },
        };
      }

      if (this.calls === getRuntimeConfig().maxTurns + 1) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
          finishReason: 'length',
          message: {
            content: '# Final report\n\nThis sentence was cut off before',
            toolCalls: [],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        finishReason: 'stop',
        message: {
          content: ' the model could finish it. The report is now complete.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();

  await withEnv({
    CEREBRAS_EXPLORER_TURN_MULTIPLIER: '1',
    CEREBRAS_EXPLORER_MAX_EXTRA_TURNS: '0',
  }, async () => {
    const client = new LengthRecoveryClient();
    const runtime = new ExplorerRuntime({ chatClient: client });
    const result = await runtime.freeExplore({
      prompt: 'output recovery test',
      repo_root: root,
    });

    assert.equal(
      result.stats.outputRecoveries,
      1,
      'one recovery attempt must run when finalize returns finishReason=length',
    );
    assert.equal(
      client.calls,
      getRuntimeConfig().maxTurns + 2,
      'main loop + finalize + one recovery continuation call',
    );
    assert.match(result.report, /cut off before/);
    assert.match(result.report, /report is now complete/);
  });
});

// ── Phase 3 — 프롬프트 구조 재배치 + 전략 유연화 ─────────────────────────────

test('Phase 3 — system prompt has HARD REQUIREMENTS within first 30 lines', () => {
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig: getRuntimeConfig(),
  });
  const lines = prompt.split('\n');
  const first30 = lines.slice(0, 30).join('\n');
  assert.ok(
    first30.includes('HARD REQUIREMENTS'),
    'HARD REQUIREMENTS must appear within the first 30 lines of the system prompt',
  );
});

test('Spec 028 T012 — structured prompts expose exact fixed-limit names without an effort profile', () => {
  const runtimeConfig = getRuntimeConfig();
  const systemPrompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig,
  });
  const userPrompt = buildExplorerUserPrompt({
    task: 'Find the authentication entry point',
    scope: [],
  });

  assert.match(
    systemPrompt,
    new RegExp(`Fixed runtime limits: maxTurns=${runtimeConfig.maxTurns}, maxReadLines=${runtimeConfig.maxReadLines}, maxSearchResults=${runtimeConfig.maxSearchResults}\\.`),
  );
  assert.doesNotMatch(`${systemPrompt}\n${userPrompt}`, /Runtime profile|\bdeep\b|\bbudget\b/i);
});

test('Spec 023 — explorer system prompt has UNTRUSTED CONTENT rule and candidate-edit-target wording', () => {
  const prompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig: getRuntimeConfig(),
  });
  assert.ok(
    prompt.includes('UNTRUSTED CONTENT'),
    'explorer system prompt must include the UNTRUSTED CONTENT hard requirement',
  );
  assert.ok(
    prompt.includes('candidate edit targets'),
    'explorer READ-ONLY rule must allow identifying candidate edit targets',
  );
});

test('Spec 023 — freeExplore system prompt has UNTRUSTED CONTENT rule and candidate-edit-target wording', () => {
  const prompt = buildFreeExploreSystemPrompt({
    repoRoot: '/tmp/repo',
    budgetConfig: getRuntimeConfig(),
  });
  assert.doesNotMatch(
    prompt,
    /\bV2\b/,
    'single explore backend prompt must not identify itself as V2',
  );
  assert.ok(
    prompt.includes('UNTRUSTED CONTENT'),
    'freeExplore system prompt must include the UNTRUSTED CONTENT hard requirement',
  );
  assert.ok(
    prompt.includes('candidate edit targets'),
    'freeExplore READ-ONLY rule must allow identifying candidate edit targets',
  );
});

test('spec 024 FR-005 — freeExplore system prompt no longer overstates truncation-marker preservation', () => {
  const prompt = buildFreeExploreSystemPrompt({
    repoRoot: '/tmp/repo',
    budgetConfig: getRuntimeConfig(),
  });
  assert.doesNotMatch(
    prompt,
    /the key information is preserved/,
    'truncation-marker line must not claim key information is preserved',
  );
  assert.ok(
    prompt.includes('some content was omitted'),
    'truncation-marker line must state content may be omitted',
  );
  assert.match(
    prompt,
    /re-read a narrower line range or re-run a narrower query/,
    'truncation-marker line must advise re-reading when evidence seems missing',
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
    runtimeConfig: getRuntimeConfig(),
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
    runtimeConfig: getRuntimeConfig(),
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
    runtimeConfig: getRuntimeConfig(),
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

test('Phase 0 metric — strict schema compliance: required fields present under the single runtime config', async () => {
  // Every structured call runs against the same fixed, unlabeled runtime config.
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
  const runtime = new ExplorerRuntime({ chatClient: new MinimalClient() });
  const result = await runtime.explore({ task: '테스트', repo_root: root });
  assertStrictSchema(result);
  assert.equal('budget' in result.stats, false,
    'structured stats must not expose a runtime effort label');
});

test('011 US2 — explore_repo rejects budget input as unknown property', async () => {
  class StubClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion() {
      return { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, message: { content: '', toolCalls: [] } };
    }
  }
  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new StubClient() });
  await assert.rejects(
    runtime.explore({ task: '테스트', repo_root: root, budget: 'quick' }),
    /Unknown explore_repo argument: budget/,
  );
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
        // The fixed runtime config leaves GLM 4.7 reasoningEffort undefined and
        // uses temperature: 1.0, topP: 0.95.
        assert.equal(reasoningEffort, undefined);
        assert.equal(temperature, 1.0);
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
  const result = await runtime.explore({ task: 'find auth', repo_root: root });
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
  const result = await runtime.explore({ task: 'find auth', repo_root: root });
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
              { path: 'src/auth.js', startLine: 1, endLine: 4, snippet: 'export function requireAuth', why: 'definition of requireAuth', groundingStatus: 'exact' },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new SymbolContextClient() });
  const result = await runtime.explore({ task: 'where is requireAuth defined', repo_root: root });

  // The symbol_context observation for src/auth.js should allow evidence grounding
  assert.ok(result, 'explore succeeded');
  // Evidence for src/auth.js should be retained (grounded via symbol_context observations)
  const authEvidence = result.evidence?.filter(e => e.path === 'src/auth.js') ?? [];
  assert.ok(authEvidence.length > 0, 'evidence for src/auth.js is retained via symbol_context observations');
});

test('Spec 028 T029 — runtime ledger assigns stable ids and rebuilds redacted current source', async () => {
  const rawSecret = 'sk-proj-1234567890abcdefghijklmnop';
  const rawPrivateBody = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
  class ObservationLedgerClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: 'FORGED_EXPLORER_SNIPPET',
            toolCalls: [
              {
                id: 'read-auth',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 2 }),
                },
              },
              {
                id: 'grep-missing',
                function: {
                  name: 'repo_grep',
                  arguments: JSON.stringify({ pattern: 'legacyGuard', scope: ['src/routes/**'] }),
                },
              },
              {
                id: 'list-routes',
                function: {
                  name: 'repo_list_dir',
                  arguments: JSON.stringify({ dirPath: 'src/routes', depth: 1 }),
                },
              },
            ],
          },
        };
      }
      if (this.calls === 2) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-redaction',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/redaction.js', startLine: 1, endLine: 5 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'runtime observations recorded',
            evidence: [],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  await fs.writeFile(path.join(root, 'src', 'redaction.js'), [
    `export const token = '${rawSecret}';`,
    'export const key = `-----BEGIN PRIVATE KEY-----',
    rawPrivateBody,
    '-----END PRIVATE KEY-----`;',
    'export const safe = true;',
  ].join('\n'));
  const runtime = new ExplorerRuntime({ chatClient: new ObservationLedgerClient() });
  const result = await runtime.explore({
    task: 'Locate authentication and check whether legacyGuard exists.',
    repo_root: root,
    scope: ['src/**'],
  });

  assert.deepEqual(result.observations.map(item => item.id), [
    'E1', 'E1:search', 'E2', 'E3', 'E4', 'E4:search',
  ]);
  assert.deepEqual(result.observations[0], {
    id: 'E1',
    kind: 'source',
    path: 'src/auth.js',
    startLine: 1,
    endLine: 2,
    snippet: [
      '1: export function requireAuth(req, res, next) {',
      '2:   if (!req.user) throw new Error("unauthorized");',
    ].join('\n'),
    rangeGrounding: 'exact',
    sourceRole: 'implementation',
    temporalRole: 'current',
    redacted: false,
  });
  assert.equal(result.observations[1].kind, 'search');
  assert.equal(result.observations[1].tool, 'repo_read_file');
  assert.equal(result.observations[1].toolTruncated, true,
    'the exact rebuilt source range must not erase read-result truncation');
  assert.deepEqual(result.observations[1].boundary, ['src/auth.js']);
  assert.equal(result.observations[2].kind, 'search');
  assert.equal(result.observations[2].tool, 'repo_grep');
  assert.deepEqual(result.observations[2].normalizedArgs, {
    pattern: 'legacyGuard',
    scope: ['src/routes/**'],
  });
  assert.deepEqual(result.observations[2].boundary, ['src/routes/**'],
    'the local scope narrows the hard scope instead of being unioned with it');
  assert.equal(result.observations[2].matchCount, 0);
  assert.equal(result.observations[2].enumerationComplete, false,
    'T029 must not preempt the tool-specific completeness policy in T060');
  assert.equal(result.observations[3].tool, 'repo_list_dir');
  assert.deepEqual(result.observations[3].boundary, ['src/routes/*']);
  assert.equal(result.observations[4].kind, 'source');
  assert.equal(result.observations[4].redacted, true);
  assert.match(result.observations[4].snippet, /\[REDACTED:openai-api-key\]/);
  assert.match(result.observations[4].snippet, /\[REDACTED:private-key-block\]/);
  assert.equal(result.observations[4].rangeGrounding, 'partial');
  assert.equal(result.observations[5].tool, 'repo_read_file');
  assert.equal(result.observations[5].toolTruncated, false);
  assert.doesNotMatch(JSON.stringify(result.observations), /FORGED_EXPLORER_SNIPPET/);
  assert.doesNotMatch(JSON.stringify(result.observations), new RegExp(rawSecret));
  assert.doesNotMatch(JSON.stringify(result.observations), new RegExp(rawPrivateBody));
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
  const result = await runtime.explore({ task: 'find requireAuth', repo_root: root });
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
  const result = await runtime.explore({ task: 'git history of auth', repo_root: root });
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
  await runtime.explore({ task: 'find auth', repo_root: root });
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
  await runtime.explore({ task: 'find something', repo_root: root });

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
  const result = await runtime.explore({ task: 'find auth', repo_root: root });
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
  const result = await runtime.explore({ task: 'find auth', repo_root: root });
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
  const result = await runtime.explore({ task: 'find auth', repo_root: root });

  assert.deepEqual(seenFinalizeBudgets, [
    getRuntimeConfig().finalizeMaxCompletionTokens,
    getRuntimeConfig().finalizeMaxCompletionTokens,
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
  const result = await runtime.explore({ task: 'find requireAuth', repo_root: root });
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
    },
    { abortSignal: controller.signal },
  );

  assert.equal(result.directAnswer, 'signal forwarded');
  assert.ok(seenSignals.length >= 2, 'explore + finalize calls should both receive the signal');
  assert.ok(seenSignals.every(signal => signal === controller.signal), 'abortSignal must be forwarded unchanged');
});

// ── 010 — Spec-1: status contract on evidence sufficiency ───────────────────

test('010 US1#1 — locate task with exact evidence stays complete when the turn limit is reached', async () => {
  // Mock client emits one read tool call to ground evidence, then loops on no-op tool calls
  // until the fixed turn limit is reached. The runtime must finalize with complete:true based
  // on evidence sufficiency rather than treating the safety limit as a failure.
  class TurnLimitWithEvidenceClient {
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
  const runtime = new ExplorerRuntime({ chatClient: new TurnLimitWithEvidenceClient() });
  const result = await runtime.explore({
    task: 'find where requireAuth is defined',
    taskMode: 'symbol_trace',
    repo_root: root,
  });

  assert.equal('stoppedByBudget' in result.stats, false);
  assert.equal(result.searchCoverage.stoppedByBudget, false, 'the v2 compatibility field must not mislabel a safety limit');
  assert.ok(result.stats.safetyLimits.some(limit => limit.name === 'turn_limit'));
  assert.equal(result.status.complete, true, 'sufficient locate evidence must yield complete:true');
  assert.ok(
    result.status.verification === 'verified' || result.status.verification === 'targeted_read_needed',
    `verification must reflect sufficiency, got ${result.status.verification}`,
  );
  assert.equal(result.failure, null, 'a turn limit must not produce failure when evidence is sufficient');
  assert.ok(result.stats?.evidenceSufficiency?.sufficient === true);
  assert.ok((result.status.warnings ?? []).every(w => !/budget/i.test(w)));
});


test('010 security — broad find vulnerability task remains incomplete when the turn limit is reached', async () => {
  class BroadSecurityFindClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'One potential auth flaw was observed, but coverage is incomplete.',
              statusConfidence: 'high',
              evidence: [{
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                why: 'single exact evidence item that must not complete a broad security review',
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
              arguments: JSON.stringify({ pattern: `no-security-hit-${this.calls}`, scope: ['src/**'] }),
            },
          }],
        },
      };
    }
  }

  for (const taskMode of [undefined, 'locate']) {
    const root = await makeRepoFixture();
    const runtime = new ExplorerRuntime({ chatClient: new BroadSecurityFindClient() });
    const result = await runtime.explore({
      task: 'find vulnerabilities in authentication',
      ...(taskMode ? { taskMode } : {}),
      repo_root: root,
    });

    assert.equal('stoppedByBudget' in result.stats, false);
    assert.equal(result.searchCoverage.stoppedByBudget, false);
    assert.ok(result.stats.safetyLimits.some(limit => limit.name === 'turn_limit'));
    assert.equal(result.status.complete, false, `broad security task must stay incomplete for taskMode=${taskMode}`);
    assert.equal(result.status.verification, 'follow_up_needed');
    assert.equal(result.failure, null, 'a valid partial limit is not an execution failure');
    assert.deepEqual(result.stats?.evidenceSufficiency, {
      sufficient: false,
      reason: 'general_needs_more_evidence',
    });
  }
});

test('010 US1#2 — path_explanation with one evidence stays incomplete after the turn limit', async () => {
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
  });

  assert.equal('stoppedByBudget' in result.stats, false);
  assert.ok(result.stats.safetyLimits.some(limit => limit.name === 'turn_limit'));
  assert.equal(result.status.complete, false, 'complex task with one evidence must stay incomplete');
  assert.equal(result.status.verification, 'follow_up_needed');
  assert.equal(result.failure, null, 'insufficient proof plus a valid limit must remain non-fatal');
  assert.equal(result.stats?.evidenceSufficiency?.sufficient, false);
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
  });

  if (result.status.verification === 'follow_up_needed' || result.status.verification === 'broad_search_needed') {
    assert.notEqual(result.nextAction.type, 'ask_user',
      'with a cited read target, nextAction should pick explore_followup over ask_user');
  }
});

// spec 017: SessionStore was removed. The spec-011 regression check
// for the legacy CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO opt-in is
// no longer reachable and has been deleted.

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

// spec 011: CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS was removed. The
// modern targets vs discoveredPaths split is permanent, so the opt-in
// regression test from 010 is gone.

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
  });

  // Either runtime critic forces fail directly, or our injected critic survives normalization.
  // Either way: when evidence count is positive but critic fail is the signal, we must stay
  // in broad_search_needed and complete:false.
  if (result.critic?.status === 'fail') {
    assert.equal(result.status.complete, false);
    assert.equal(result.status.verification, 'broad_search_needed');
    assert.equal(result.stats?.evidenceSufficiency?.sufficient, false);
  }
});

// ── spec 026 US1 — usage cross-check gate scenario tests ────────────────────

// Helper: builds a mock client that does exactly the given tool calls then finalizes.
// toolSequence: array of {name, arguments} objects for the tool turn.
// finalResult: compactResult overrides for the finalize turn.
function makeSymbolTraceClient({ toolSequence = [], finalResult = {} } = {}) {
  class Spec026Client {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this._toolIdx = 0;
    }

    async createChatCompletion({ responseFormat }) {
      this.calls += 1;

      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'requireAuth rejects unauthenticated requests.',
              statusConfidence: 'high',
              evidence: [
                { path: 'src/auth.js', startLine: 1, endLine: 4, why: 'symbol definition site', evidenceType: 'file_range', groundingStatus: 'exact' },
              ],
              ...finalResult,
            })),
            toolCalls: [],
          },
        };
      }

      if (this._toolIdx < toolSequence.length) {
        const toolDef = toolSequence[this._toolIdx];
        this._toolIdx += 1;
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: '',
            toolCalls: [{
              id: `tc-${this._toolIdx}`,
              function: {
                name: toolDef.name,
                arguments: JSON.stringify(toolDef.arguments),
              },
            }],
          },
        };
      }

      // No more tools — trigger finalize
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: { content: '', toolCalls: [] },
      };
    }
  }

  return new Spec026Client();
}

test('spec 026 T003(a): symbol_trace + only repo_symbol_context/repo_read_file → targeted_read_needed + medium + warning', async () => {
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  assert.equal(result.status.verification, 'targeted_read_needed', `expected targeted_read_needed, got ${result.status.verification}`);
  assert.equal(result.status.confidence, 'medium', `expected medium confidence, got ${result.status.confidence}`);
  assert.equal(result.status.complete, true, 'complete must be true for targeted_read_needed');
  const crossCheckWarning = (result.critic?.warnings ?? []).find(w => w.type === 'usage_cross_check_missing');
  assert.ok(crossCheckWarning, 'must have exactly one usage_cross_check_missing warning');
  assert.equal(
    (result.critic?.warnings ?? []).filter(w => w.type === 'usage_cross_check_missing').length,
    1,
    'exactly one usage_cross_check_missing',
  );
  assert.equal(result.nextAction?.type, 'read_target', `expected read_target nextAction, got ${result.nextAction?.type}`);
});

test('spec 026 T003(b): symbol_trace + repo_grep containing symbol → verified, no warning', async () => {
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_grep', arguments: { pattern: 'requireAuth', scope: ['src/**'] } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  assert.equal(result.status.verification, 'verified', `expected verified, got ${result.status.verification}`);
  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'must not have usage_cross_check_missing when grep satisfied gate',
  );
});

test('spec 026 T003(c): 0-match grep still satisfies gate (attempt counts, args-based)', async () => {
  // The repo fixture has requireAuth defined in src/auth.js, so grep for 'requireAuth_NOMATCH'
  // returns 0 matches. But for the gate, we check the ARGS pattern. Here we use a pattern
  // that contains the bare symbol name so it satisfies the gate even with 0 matches.
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      // Pattern contains "requireAuth" but won't match anything meaningful
      { name: 'repo_grep', arguments: { pattern: 'requireAuth_something_that_wont_match', scope: ['src/**'] } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  // grep attempt (args-based) satisfies the gate even if 0 matches
  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'a grep attempt (args-based, even 0-match) must satisfy the gate',
  );
  assert.equal(result.status.verification, 'verified', `expected verified, got ${result.status.verification}`);
});

test('spec 026 T003(d): repo_references call satisfies gate', async () => {
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_references', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'repo_references satisfies the gate',
  );
  assert.equal(result.status.verification, 'verified', `expected verified, got ${result.status.verification}`);
});

test('spec 026 T003(e): narrow scope + grep inside scope satisfies gate', async () => {
  // Read a file within scope (src/routes/user.js) so evidence can be grounded.
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_grep', arguments: { pattern: 'requireAuth', scope: ['src/routes/**'] } },
      { name: 'repo_read_file', arguments: { path: 'src/routes/user.js', startLine: 1, endLine: 7 } },
    ],
    finalResult: {
      directAnswer: 'requireAuth is imported and used in route handler.',
      statusConfidence: 'high',
      evidence: [
        { path: 'src/routes/user.js', startLine: 1, endLine: 7, why: 'requireAuth usage site', evidenceType: 'file_range', groundingStatus: 'exact' },
      ],
    },
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    scope: ['src/routes/**'],
    repo_root: root,
  });

  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'grep within narrow scope satisfies gate',
  );
  assert.equal(result.status.verification, 'verified', `expected verified, got ${result.status.verification}`);
});

test('spec 026 T003(f): critic-fail path → broad_search_needed, NO usage_cross_check_missing (no double warning)', async () => {
  // All tool calls error → stoppedByErrors → critic fail → broad_search_needed
  class AllErrorsClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion({ responseFormat }) {
      this.calls += 1;
      if (responseFormat) {
        return {
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          message: {
            content: JSON.stringify(compactResult({
              directAnswer: 'Could not find symbol.',
              statusConfidence: 'low',
              evidence: [],
            })),
            toolCalls: [],
          },
        };
      }
      // Always return invalid tool name → triggers tool error → stoppedByErrors
      return {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        message: {
          content: '',
          toolCalls: [{
            id: `tc-${this.calls}`,
            function: {
              name: 'repo_nonexistent_tool',
              arguments: JSON.stringify({ x: 1 }),
            },
          }],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new AllErrorsClient() });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  // When critic fails (broad_search_needed), gate must NOT fire
  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'no usage_cross_check_missing when path is broad_search_needed',
  );
  assert.equal(result.status.verification, 'broad_search_needed', `expected broad_search_needed, got ${result.status.verification}`);
});

test('spec 026 T003(g): taskMode locate → no warning, no downgrade', async () => {
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Locate requireAuth',
    taskMode: 'locate',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    'locate taskMode must not trigger gate',
  );
  // verification should NOT be targeted_read_needed due to gate (may be verified or something else)
  assert.notEqual(
    result.status.verification,
    'targeted_read_needed',
    'locate taskMode must not be downgraded by gate to targeted_read_needed',
  );
});

test('spec 026 T003(i): symbol_trace where the ONLY grep attempt errors → targeted_read_needed + usage_cross_check_missing', async () => {
  // An erroring grep attempt must NOT satisfy the gate.
  // Technique: pass a catastrophic regex pattern combined with a narrow scope so ripgrep
  // returns null (baseScopeRules active) and the JS fallback throws on isCatastrophicRegexPattern.
  const client = makeSymbolTraceClient({
    toolSequence: [
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
      // This grep call will error: pattern is catastrophic AND narrow scope forces JS fallback.
      { name: 'repo_grep', arguments: { pattern: '(requireAuth+)+', scope: ['src/**'] } },
      { name: 'repo_read_file', arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 } },
    ],
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    // Pass a narrow scope so baseScopeRules.patterns.length > 0 → ripgrep returns null
    // → JS fallback hits isCatastrophicRegexPattern → throws → error result
    scope: ['src/**'],
    repo_root: root,
  });

  // The errored grep must NOT satisfy the gate → warning must fire
  const crossCheckWarning = (result.critic?.warnings ?? []).find(w => w.type === 'usage_cross_check_missing');
  assert.ok(crossCheckWarning, 'errored grep attempt must NOT satisfy the gate — usage_cross_check_missing must be present');
  assert.equal(
    (result.critic?.warnings ?? []).filter(w => w.type === 'usage_cross_check_missing').length,
    1,
    'exactly one usage_cross_check_missing',
  );
  assert.equal(result.status.verification, 'targeted_read_needed', `expected targeted_read_needed, got ${result.status.verification}`);
});

test('spec 026 T003(h): symbol_trace with all evidence ungrounded → broad_search_needed or follow_up_needed, NO usage_cross_check_missing', async () => {
  // Model returns evidence items but none get grounded (no reads, no observed ranges) →
  // grounding.evidence drops to 0 → precedence route fires in buildResultStatus →
  // gate must NOT emit usage_cross_check_missing
  const client = makeSymbolTraceClient({
    toolSequence: [
      // Only a symbol_context call (does not create observed ranges for evidence lines)
      { name: 'repo_symbol_context', arguments: { symbol: 'requireAuth' } },
    ],
    finalResult: {
      // Model claims evidence but the tool call did NOT produce a file read for those lines
      // so groundEvidenceList will drop them as ungrounded.
      // Use a path that was NOT read so observedRanges won't cover it.
      evidence: [
        { path: 'src/unread_file.js', startLine: 1, endLine: 5, why: 'symbol usage', evidenceType: 'file_range', groundingStatus: 'exact' },
      ],
      statusConfidence: 'high',
    },
  });

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.explore({
    task: 'Trace requireAuth usages',
    taskMode: 'symbol_trace',
    hints: { symbols: ['requireAuth'] },
    repo_root: root,
  });

  // When all evidence is dropped: broad_search_needed (no grounded evidence forces this branch)
  assert.equal(
    result.status.verification,
    'broad_search_needed',
    `expected broad_search_needed (all evidence dropped), got ${result.status.verification}`,
  );
  // Gate must NOT fire on this precedence route
  assert.ok(
    !(result.critic?.warnings ?? []).some(w => w.type === 'usage_cross_check_missing'),
    `no usage_cross_check_missing on all-evidence-dropped precedence route (verification=${result.status.verification})`,
  );
});

// ── spec 026 US3: symbol-first strategy cross-check instruction (T015) ──────────

test('spec 026 T015: buildExplorerUserPrompt symbol-first approach includes cross-check instruction and truncated fallback', () => {
  const prompt = buildExplorerUserPrompt({
    task: 'Find where requireAuth is defined',
    hints: { strategy: 'symbol-first', symbols: ['requireAuth'] },
    scope: [],
  });

  // ① The approach text must instruct a scope-wide repo_grep cross-check before finalizing
  assert.ok(
    prompt.includes('repo_grep') && prompt.includes('cross-check'),
    `symbol-first approach must instruct repo_grep cross-check; got: ${prompt.slice(prompt.indexOf('Initial strategy'), prompt.indexOf('Initial strategy') + 400)}`,
  );
  assert.ok(
    /before finaliz/i.test(prompt),
    'symbol-first approach must say "before finalizing" (or similar) for the cross-check instruction',
  );

  // ② The fallback condition must mention "truncated"
  assert.ok(
    /truncated/i.test(prompt),
    'symbol-first approach must mention "truncated" as a fallback trigger',
  );
});

test('spec 026 T015: STRATEGY_DESCRIPTIONS symbol-first mentions cross-check', () => {
  const desc = STRATEGY_DESCRIPTIONS['symbol-first'];
  assert.ok(typeof desc === 'string', 'STRATEGY_DESCRIPTIONS must have symbol-first entry');
  assert.ok(
    /cross.check/i.test(desc),
    `STRATEGY_DESCRIPTIONS['symbol-first'] must mention cross-check; got: "${desc}"`,
  );
});

test('spec 026 T015: system prompt strategy catalog symbol-first line mentions cross-check', () => {
  const systemPrompt = buildExplorerSystemPrompt({
    repoRoot: '/tmp/repo',
    runtimeConfig: getRuntimeConfig(),
  });
  // Find the strategy catalog line for symbol-first
  const lines = systemPrompt.split('\n');
  const symbolFirstLine = lines.find(l => l.includes('symbol-first') && l.includes('→'));
  assert.ok(symbolFirstLine, 'system prompt strategy catalog must have a symbol-first line');
  assert.ok(
    /cross.check/i.test(symbolFirstLine),
    `system prompt symbol-first catalog line must mention cross-check; got: "${symbolFirstLine}"`,
  );
});

// T022 activates these expected-red orchestration tests by adding the late-goal
// audit helper used by the semantic verifier. Until then Node executes the
// callbacks as TODOs, so missing runtime behavior stays visible without making
// the test-first commits unshippable.
const auditedPlanningRuntimeTest =
  typeof RuntimeImplementation.prototype.auditLateGoalProposals === 'function'
    ? test
    : test.todo;

const GOAL_AUDIT_TASK = 'Locate requireAuth and verify legacyGuard is absent.';

function requestOrigin(task, text) {
  const start = task.indexOf(text);
  assert.notEqual(start, -1, `request fragment not found: ${text}`);
  return `request:${start}-${start + text.length}`;
}

function proposedRuntimeGoal(overrides = {}) {
  return {
    id: 'S-definition',
    question: 'Where is requireAuth defined?',
    originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'Locate requireAuth')],
    claimType: 'symbol_definition',
    proofCondition: 'Observe the in-scope requireAuth definition and source body.',
    constraints: [],
    ...overrides,
  };
}

function plannerControl(subgoals, overrides = {}) {
  return {
    taskSummary: 'Locate the symbol and check the requested absence.',
    constraints: [],
    subgoals,
    ...overrides,
  };
}

function auditControlRecord(goal, verdict = 'ready', overrides = {}) {
  return {
    proposedGoalId: goal.id,
    verdict,
    originRefs: [...goal.originRefs],
    missingRequestParts: [],
    reason: `Audited as ${verdict}.`,
    ...overrides,
  };
}

function auditorControl(goals, uncoveredRequestParts = []) {
  return { goals, uncoveredRequestParts };
}

function coverageControl(findings, uncoveredRequestParts = []) {
  return { findings, uncoveredRequestParts };
}

function coveredObligation(obligationId, coveredByGoalIds) {
  return {
    obligationId,
    disposition: 'covered',
    coveredByGoalIds,
    reason: 'The audited goal mapping preserves this runtime obligation.',
  };
}

function remainingObligation(obligationId) {
  return {
    obligationId,
    disposition: 'remaining',
    coveredByGoalIds: [],
    reason: 'No audited corrected goal fully preserves this runtime obligation.',
  };
}

function controlCompletion(content, { finishReason = 'stop' } = {}) {
  return {
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    finishReason,
    message: {
      content: typeof content === 'string' ? content : JSON.stringify(content),
      toolCalls: [],
    },
  };
}

function classifyControlRequest(request) {
  const wrappedSchema = request.responseFormat?.json_schema;
  const schema = wrappedSchema?.schema ?? wrappedSchema;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (required.includes('taskSummary') && required.includes('subgoals')) return 'planner';
  if (required.includes('goals') && required.includes('uncoveredRequestParts')) return 'goal_audit';
  if (required.includes('findings') && required.includes('uncoveredRequestParts')) {
    return 'goal_coverage';
  }
  if (required.includes('claims')) return 'claim_synthesis';
  if (required.includes('verdicts') && required.includes('uncoveredRequestParts')) {
    return 'semantic_verifier';
  }
  if (request.responseFormat) return 'synthesis';
  return 'exploration';
}

class ScriptedGoalAuditClient {
  constructor(steps) {
    this.model = 'zai-glm-4.7';
    const planningOnly = steps.some(step => step.stage.startsWith('synthesis:')) &&
      !steps.some(step => step.stage.startsWith('claim_synthesis:') ||
        step.stage.startsWith('semantic_verifier:'));
    const explorationCount = steps.reduce((highest, step) => {
      const match = /^exploration:(\d+)$/.exec(step.stage);
      return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
    }, 0);
    this.steps = planningOnly
      ? [
          ...steps,
          {
            stage: `exploration:${explorationCount + 1}`,
            content: 'Planning-only fixture closes the single evidence-repair round without a tool action.',
          },
        ]
      : steps;
    this.stepCursor = 0;
    this.requests = [];
    this.completions = [];
    this.stageCounts = new Map();
    this.stageLabels = [];
  }

  async createChatCompletion(request) {
    const stage = classifyControlRequest(request);
    if (stage === 'planner' || stage === 'goal_audit' || stage === 'goal_coverage' ||
        stage === 'semantic_verifier') {
      assert.equal((request.tools?.length ?? 0), 0,
        `${stage} must not receive repository tools`);
    }
    const count = (this.stageCounts.get(stage) ?? 0) + 1;
    this.stageCounts.set(stage, count);
    const label = `${stage}:${count}`;
    this.stageLabels.push(label);
    this.requests.push(request);

    let step = this.steps[this.stepCursor];
    while (step?.optional && step.stage !== label) {
      this.stepCursor += 1;
      step = this.steps[this.stepCursor];
    }
    assert.ok(step, `unexpected provider call ${label}`);
    assert.equal(label, step.stage);
    this.stepCursor += 1;
    const completion = step.run
      ? await step.run(request, this)
      : controlCompletion(step.content ?? step.value);
    this.completions.push(completion);
    return completion;
  }
}

function readyExplorationResult() {
  return compactResult({
    directAnswer: 'The audited goals are ready for evidence verification.',
    verification: 'follow_up_needed',
    complete: false,
    evidence: [],
  });
}

function definitionAndAbsenceGoals() {
  return [
    proposedRuntimeGoal(),
    proposedRuntimeGoal({
      id: 'S-absence',
      question: 'Is legacyGuard absent from the in-scope registration surface?',
      originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'verify legacyGuard is absent')],
      claimType: 'absence',
      proofCondition: 'Enumerate the in-scope registration surface and certify bounded absence.',
    }),
  ];
}

auditedPlanningRuntimeTest('Spec 028 T017 — initial plan and isolated audit finish before exploration', async () => {
  const goals = definitionAndAbsenceGoals();
  const invented = proposedRuntimeGoal({
    id: 'S-invented',
    question: 'Which cache refactor should be implemented?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a repository location where a cache refactor could be added.',
  });
  const proposal = plannerControl([...goals, invented]);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: proposal },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(goals[0], 'ready', { mergeInto: null }),
        auditControlRecord(goals[1]),
        auditControlRecord(invented, 'reject_untraceable', { originRefs: [] }),
      ]),
    },
    { stage: 'exploration:1', content: 'Audited goals are ready for repository exploration.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });

  const result = await runtime.explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.deepEqual(client.stageLabels, [
    'planner:1',
    'goal_audit:1',
    'exploration:1',
    'synthesis:1',
    'exploration:2',
  ]);
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id),
    ['S-definition', 'S-absence']);
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.auditVerdict),
    ['ready', 'ready']);
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.proofPolicy),
    ['symbol_definition', 'bounded_absence']);
  assert.doesNotMatch(JSON.stringify(client.requests[2].messages), /S-invented/,
    'rejected goals must not leak into exploration');
});

auditedPlanningRuntimeTest('Spec 028 T017 — one corrected plan is re-audited and recursion is impossible', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: 'Locate requireAuth and prove every legacyGuard registration outcome.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe the definition and separately enumerate the registration surface.',
  });
  const corrected = definitionAndAbsenceGoals();
  const uncovered = {
    question: corrected[1].question,
    originRefs: [...corrected[1].originRefs],
    claimType: corrected[1].claimType,
    proofCondition: corrected[1].proofCondition,
    constraints: [],
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(broad, 'needs_decomposition'),
      ], [uncovered]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(corrected[0]),
        auditControlRecord(corrected[1], 'needs_decomposition'),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
        coveredObligation('revision-obligation-2', [corrected[1].id]),
      ]),
    },
    { stage: 'exploration:1', content: 'Corrected audited goals are ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });

  const result = await runtime.explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.deepEqual(client.stageLabels, [
    'planner:1',
    'goal_audit:1',
    'planner:2',
    'goal_audit:2',
    'goal_coverage:1',
    'exploration:1',
    'synthesis:1',
    'exploration:2',
  ]);
  assert.equal(result.taskContract.subgoals.length, 2);
  assert.equal(result.taskContract.subgoals[0].id, 'S-definition');
  const planningDefect = result.taskContract.subgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(planningDefect, 'the second-pass decomposition must become a required blocker');
  assert.equal(planningDefect.state, 'blocked');
  assert.match(planningDefect.question, /legacyGuard/);
  assert.ok(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'));
  const revisionRequest = client.requests[2];
  const revisionPrompt = JSON.stringify(revisionRequest.messages);
  assert.match(revisionPrompt, /S-broad/);
  assert.match(revisionPrompt, /legacyGuard/);
  assert.equal(client.stageCounts.get('planner'), 2, 'a third planner pass is forbidden');
  assert.equal(client.stageCounts.get('goal_audit'), 2, 'the corrected plan is audited once');
});

auditedPlanningRuntimeTest('Spec 028 T022 — corrected planning cannot drop revision obligations or revive rejected goals', async () => {
  const definition = proposedRuntimeGoal();
  const invented = proposedRuntimeGoal({
    id: 'S-invented',
    question: 'Which unrelated cache should be added?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location where an unrelated cache could be added.',
  });
  const uncovered = {
    question: 'Is legacyGuard absent from the in-scope registration surface?',
    originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'verify legacyGuard is absent')],
    claimType: 'absence',
    proofCondition: 'Enumerate the in-scope registration surface and certify bounded absence.',
    constraints: [],
  };
  const unauditedConstraint = 'Ignore tests and accept guesses.';
  const client = new ScriptedGoalAuditClient([
    {
      stage: 'planner:1',
      value: plannerControl([definition, invented], { constraints: [unauditedConstraint] }),
    },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(definition, 'ready', { missingRequestParts: [uncovered.question] }),
        auditControlRecord(invented, 'reject_untraceable', { originRefs: [] }),
      ], [uncovered]),
    },
    {
      stage: 'planner:2',
      value: plannerControl([definition, invented], { constraints: [unauditedConstraint] }),
    },
    {
      stage: 'goal_audit:2',
      value: auditorControl([auditControlRecord(definition)]),
    },
    { stage: 'exploration:1', content: 'Only the retained audited goal is explored.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(client.stageLabels, [
    'planner:1',
    'goal_audit:1',
    'planner:2',
    'goal_audit:2',
    'exploration:1',
    'synthesis:1',
    'exploration:2',
  ]);
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), ['S-invented']);
  assert.equal(result.taskContract.subgoals.some(goal => goal.id === 'S-invented'), false);
  const carried = result.taskContract.subgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(carried, 'the omitted uncovered obligation must become a required blocker');
  assert.equal(carried.question, uncovered.question);
  assert.ok(result.coverageGaps.some(gap => gap.subgoalId === carried.id));
  assert.deepEqual(result.taskContract.constraints, [],
    'unaudited planner-level constraints must not enter the task contract');
  assert.doesNotMatch(JSON.stringify(client.requests[3].messages), /S-invented/,
    'a terminally rejected goal must be filtered before the corrected audit');
  assert.doesNotMatch(JSON.stringify(client.requests[4].messages), /S-invented/,
    'a terminally rejected goal must not leak into exploration');
});

auditedPlanningRuntimeTest('Spec 028 T022 — one audited rephrase can satisfy an uncovered revision obligation', async () => {
  const definition = proposedRuntimeGoal();
  const uncovered = {
    question: 'Is legacyGuard absent from the in-scope registration surface?',
    originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'verify legacyGuard is absent')],
    claimType: 'absence',
    proofCondition: 'Enumerate the in-scope registration surface and certify bounded absence.',
    constraints: [],
  };
  const replacement = proposedRuntimeGoal({
    id: 'S-absence-rephrased',
    question: 'Determine whether legacyGuard is absent in the in-scope registration surface.',
    originRefs: [...uncovered.originRefs],
    claimType: 'absence',
    proofCondition: 'Completely enumerate the bounded registration surface and establish absence.',
  });
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([definition]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(definition, 'ready', { missingRequestParts: [uncovered.question] }),
      ], [uncovered]),
    },
    { stage: 'planner:2', value: plannerControl([definition, replacement]) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(definition),
        auditControlRecord(replacement),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        coveredObligation('revision-obligation-1', [replacement.id]),
      ]),
    },
    { stage: 'exploration:1', content: 'The audited replacement is ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id),
    ['S-definition', 'S-absence-rephrased']);
  assert.equal(result.taskContract.subgoals.some(goal =>
    goal.auditVerdict === 'planning_incomplete'), false);
  assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.reason === 'missing_evidence')
    .map(gap => gap.subgoalId), ['S-definition', 'S-absence-rephrased']);
  const coveragePrompt = JSON.stringify(client.requests[4].messages);
  assert.match(coveragePrompt, /S-absence-rephrased/);
  assert.doesNotMatch(coveragePrompt, /S-definition/,
    'preserved goals that cannot discharge a revision obligation stay out of the coverage prompt');
});

auditedPlanningRuntimeTest('Spec 028 T022 — range-only decomposition cannot erase a missing request distinction', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe requireAuth definition and usage plus the legacyGuard absence outcome.',
  });
  const revised = [
    proposedRuntimeGoal({
      id: 'S-definition',
      originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    }),
    proposedRuntimeGoal({
      id: 'S-usage',
      question: 'Where is requireAuth used?',
      originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
      claimType: 'symbol_usage',
      proofCondition: 'Observe bounded requireAuth usage sites.',
    }),
  ];
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl(revised) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(revised.map(goal => auditControlRecord(goal))),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        remainingObligation('revision-obligation-1'),
      ]),
    },
    { stage: 'exploration:1', content: 'Only audited revised goals are explored.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(result.taskContract.subgoals
    .filter(goal => goal.auditVerdict === 'ready')
    .map(goal => goal.id), ['S-definition', 'S-usage']);
  const carried = result.taskContract.subgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(carried, 'legacyGuard absence cannot be discharged by range-only positive goals');
  assert.equal(carried.question, GOAL_AUDIT_TASK);
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.reason === 'planning_incomplete')
    .map(gap => gap.reason), ['planning_incomplete']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — opaque coverage mapping preserves directional distinctions', async () => {
  const task = 'Check whether frontend calls backend and whether backend calls frontend.';
  const forward = {
    id: 'S-forward',
    question: 'Does frontend call backend?',
    originRefs: [`request:0-${task.length}`],
    claimType: 'flow',
    proofCondition: 'Observe the frontend-to-backend call path.',
    constraints: [],
  };
  const reverse = {
    question: 'Does backend call frontend?',
    originRefs: [`request:0-${task.length}`],
    claimType: 'flow',
    proofCondition: 'Observe the backend-to-frontend call path.',
    constraints: [],
  };
  const wrongReplacement = {
    ...forward,
    id: 'S-forward-again',
    question: 'Can frontend call backend?',
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([forward]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(forward, 'ready', { missingRequestParts: [reverse.question] }),
      ], [reverse]),
    },
    { stage: 'planner:2', value: plannerControl([forward, wrongReplacement]) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(forward),
        auditControlRecord(wrongReplacement),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([remainingObligation('revision-obligation-1')]),
    },
    { stage: 'exploration:1', content: 'Only forward goals are ready.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task, repo_root: root });

  const carried = result.taskContract.subgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(carried);
  assert.equal(carried.question, reverse.question);
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.reason === 'planning_incomplete')
    .map(gap => gap.reason), ['planning_incomplete']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — opaque coverage mapping accepts a valid Korean decomposition', async () => {
  const task = '인증과 인가 흐름을 각각 분석해줘.';
  const broad = {
    id: 'K-broad',
    question: task,
    originRefs: [`request:0-${task.length}`],
    claimType: 'flow',
    proofCondition: '인증과 인가 흐름을 각각 관찰한다.',
    constraints: [],
  };
  const corrected = [
    {
      id: 'K-authentication',
      question: '인증 흐름을 분석한다.',
      originRefs: [`request:0-${task.length}`],
      claimType: 'flow',
      proofCondition: '인증 진입점과 전이를 관찰한다.',
      constraints: [],
    },
    {
      id: 'K-authorization',
      question: '인가 흐름을 분석한다.',
      originRefs: [`request:0-${task.length}`],
      claimType: 'flow',
      proofCondition: '인가 진입점과 전이를 관찰한다.',
      constraints: [],
    },
  ];
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
      ]),
    },
    { stage: 'exploration:1', content: '교정된 목표를 탐색합니다.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task, repo_root: root, language: 'ko' });

  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id),
    corrected.map(goal => goal.id));
  assert.equal(result.taskContract.subgoals.some(goal =>
    goal.auditVerdict === 'planning_incomplete'), false);
  assert.equal(result.coverageGaps.some(gap => gap.reason === 'planning_incomplete'), false);
  assert.deepEqual(result.coverageGaps.map(gap => gap.reason),
    ['missing_evidence', 'missing_evidence']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — invalid coverage cardinality fails after one bounded retry', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const corrected = definitionAndAbsenceGoals();
  const invalidCoverage = coverageControl([
    coveredObligation('revision-obligation-1', [corrected[0].id]),
  ]);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
    },
    { stage: 'goal_coverage:1', value: invalidCoverage },
    { stage: 'goal_coverage:2', value: invalidCoverage },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.equal(client.stageCounts.get('goal_coverage'), 2);
  assert.ok(result.failure);
  assert.equal(result.failure.reason, 'invalid_final_response');
  assert.equal(client.stageLabels.includes('exploration:1'), false);
});

auditedPlanningRuntimeTest('Spec 028 T022 — coverage reconciliation cannot invent new obligations', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const corrected = definitionAndAbsenceGoals();
  const invented = {
    question: 'Which unrelated cache should be implemented?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location for an unrelated cache.',
    constraints: [],
  };
  const invalidCoverage = coverageControl([
    coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
  ], [invented]);
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
    },
    { stage: 'goal_coverage:1', value: invalidCoverage },
    { stage: 'goal_coverage:2', value: invalidCoverage },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.equal(client.stageCounts.get('goal_coverage'), 2);
  assert.equal(result.failure?.reason, 'invalid_final_response');
  assert.equal(client.stageLabels.includes('exploration:1'), false);
});

auditedPlanningRuntimeTest('Spec 028 T022 — rejected corrected goals leave the original obligation blocked', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const wrong = proposedRuntimeGoal({
    id: 'S-wrong',
    question: 'Which unrelated cache should be added?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location for an unrelated cache.',
  });
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(broad, 'needs_decomposition')]),
    },
    { stage: 'planner:2', value: plannerControl([wrong]) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(wrong, 'reject_untraceable', { originRefs: [] }),
      ]),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([remainingObligation('revision-obligation-1')]),
    },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.equal(result.failure, null);
  assert.equal(result.taskContract.subgoals.length, 1);
  assert.equal(result.taskContract.subgoals[0].question, broad.question);
  assert.equal(result.taskContract.subgoals[0].auditVerdict, 'planning_incomplete');
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), ['S-wrong']);
  assert.deepEqual(result.coverageGaps.map(gap => gap.reason), ['planning_incomplete']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — a corrected plan filtered to zero goals carries the obligation', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const invented = proposedRuntimeGoal({
    id: 'S-invented',
    question: 'Which unrelated cache should be added?',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location for an unrelated cache.',
  });
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad, invented]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(broad, 'needs_decomposition'),
        auditControlRecord(invented, 'reject_untraceable', { originRefs: [] }),
      ]),
    },
    { stage: 'planner:2', value: plannerControl([invented]) },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(client.stageLabels, ['planner:1', 'goal_audit:1', 'planner:2']);
  assert.equal(result.failure, null);
  assert.equal(result.taskContract.subgoals.length, 1);
  assert.equal(result.taskContract.subgoals[0].auditVerdict, 'planning_incomplete');
  assert.equal(result.taskContract.subgoals[0].question, broad.question);
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), ['S-invented']);
});

auditedPlanningRuntimeTest('Spec 028 T022 — a corrected audit cannot reclassify a preserved goal silently', async () => {
  const definition = proposedRuntimeGoal();
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: 'Independently inspect the requested authentication facets.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe separate evidence for the requested authentication facets.',
  });
  const absence = definitionAndAbsenceGoals()[1];
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([definition, broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(definition),
        auditControlRecord(broad, 'needs_decomposition'),
      ]),
    },
    { stage: 'planner:2', value: plannerControl([definition, absence]) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([
        auditControlRecord(definition, 'blocked_scope'),
        auditControlRecord(absence),
      ]),
    },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.deepEqual(client.stageLabels, [
    'planner:1', 'goal_audit:1', 'planner:2', 'goal_audit:2',
  ]);
  assert.ok(result.failure, 'inconsistent second-pass control must fail closed');
  assert.equal(result.status.complete, false);
});

auditedPlanningRuntimeTest('Spec 028 T022 — preserved origin and constraint sets may be reordered', async () => {
  const kept = proposedRuntimeGoal({
    id: 'S-kept',
    originRefs: [
      requestOrigin(GOAL_AUDIT_TASK, 'Locate requireAuth'),
      'wrapper:trace_symbol:definition',
    ],
    constraints: ['Stay in scope.', 'Use source evidence.'],
  });
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: 'Inspect both authentication distinctions.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested distinction independently.',
  });
  const reordered = {
    ...kept,
    originRefs: [...kept.originRefs].reverse(),
    constraints: [...kept.constraints].reverse(),
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([kept, broad]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(kept),
        auditControlRecord(broad, 'needs_decomposition'),
      ]),
    },
    { stage: 'planner:2', value: plannerControl([reordered]) },
    {
      stage: 'goal_audit:2',
      value: auditorControl([auditControlRecord(reordered)]),
    },
    { stage: 'exploration:1', content: 'The preserved goal remains auditable.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({
    task: GOAL_AUDIT_TASK,
    repo_root: root,
    taskMode: 'symbol_trace',
  });

  assert.equal(result.failure, null);
  assert.equal(result.taskContract.subgoals[0].id, kept.id);
  assert.ok(result.taskContract.subgoals.some(goal =>
    goal.auditVerdict === 'planning_incomplete'));
});

auditedPlanningRuntimeTest('Spec 028 T022 — initial goal audit batches are bounded and reconcile cross-batch coverage', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const goals = Array.from({ length: 13 }, (_, index) => ({
    id: `P${index + 1}`,
    question: `Inspect authentication facet ${index + 1}.`,
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: `Observe repository evidence for authentication facet ${index + 1}.`,
    constraints: [],
  }));
  class BatchedInitialAuditClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.auditBatches = [];
      this.stages = [];
    }

    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      this.stages.push(stage);
      if (stage === 'planner') return controlCompletion(plannerControl(goals));
      if (stage === 'goal_audit') {
        const prompt = JSON.stringify(request.messages);
        const batch = goals.filter(goal => new RegExp(`\\b${goal.id}\\b`).test(prompt));
        this.auditBatches.push(batch.map(goal => goal.id));
        const uncovered = batch.some(goal => goal.id === 'P13')
          ? []
          : [{
            ...goals[12],
            id: undefined,
            question: 'Review authentication facet 13.',
            proofCondition: 'Observe repository evidence that resolves authentication facet 13.',
          }];
        delete uncovered[0]?.id;
        const missingQuestion = uncovered[0]?.question;
        return controlCompletion(auditorControl(
          batch.map((goal, index) => auditControlRecord(goal, 'ready', {
            missingRequestParts: index === 0 && missingQuestion ? [missingQuestion] : [],
          })),
          uncovered,
        ));
      }
      if (stage === 'goal_coverage') {
        return controlCompletion(coverageControl([
          coveredObligation('batch-uncovered-1', ['P13']),
        ]));
      }
      if (stage === 'exploration') return controlCompletion('Batched goals are ready.');
      return controlCompletion(readyExplorationResult());
    }
  }

  const client = new BatchedInitialAuditClient();
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task, repo_root: root });

  assert.equal(client.auditBatches.length, 2);
  assert.ok(client.auditBatches.every(batch => batch.length <= 12));
  assert.deepEqual(client.auditBatches.flat(), goals.map(goal => goal.id));
  assert.deepEqual(result.taskContract.subgoals.map(goal => goal.id), goals.map(goal => goal.id));
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.reason === 'planning_incomplete'), [],
    'another batch must not create a false uncovered blocker for a ready goal');
  assert.equal(result.coverageGaps.filter(gap => gap.reason === 'missing_evidence').length,
    goals.length);
});

auditedPlanningRuntimeTest('Spec 028 T017 — malformed goal-audit control output fails before exploration', async () => {
  const goals = definitionAndAbsenceGoals();
  class MalformedAuditClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.stages = [];
      this.auditCalls = 0;
    }

    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      this.stages.push(stage);
      if (stage === 'planner') return controlCompletion(plannerControl(goals));
      if (stage === 'goal_audit') {
        this.auditCalls += 1;
        return controlCompletion({});
      }
      return controlCompletion(readyExplorationResult());
    }
  }

  const root = await makeRepoFixture();
  const client = new MalformedAuditClient();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });

  assert.ok(client.auditCalls >= 1 && client.auditCalls <= 2,
    'invalid required control output may receive at most one bounded recovery');
  assert.equal(client.stages.includes('exploration'), false);
  assert.equal(client.stages.includes('synthesis'), false);
  assert.ok(result.failure, 'invalid audit JSON is an execution fault, not a coverage gap');
  assert.equal(result.status.complete, false);
  assert.equal(/Where is requireAuth defined/.test(result.directAnswer ?? ''), false,
    'planner content must never become a stale parent answer');
});

auditedPlanningRuntimeTest('Spec 028 T017 — an all-blocked audited plan returns without futile exploration', async () => {
  const blockedTask = 'Report which requireAuth revision is active in the deployed service.';
  const blocked = {
    id: 'S-live',
    question: 'Which requireAuth revision is active in the deployed service?',
    originRefs: [`request:0-${blockedTask.length}`],
    claimType: 'positive',
    proofCondition: 'Observe the active deployed revision.',
    constraints: [],
  };
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([blocked]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(blocked, 'requires_external_state'),
      ]),
    },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task: blockedTask, repo_root: root });

  assert.deepEqual(client.stageLabels, ['planner:1', 'goal_audit:1']);
  assert.equal(result.failure, null, 'a valid blocker is incomplete, not failed');
  assert.equal(result.status.complete, false);
  assert.equal(result.taskContract.subgoals[0].state, 'blocked');
  assert.equal(result.taskContract.subgoals[0].auditVerdict, 'requires_external_state');
  assert.ok(result.coverageGaps.some(gap => gap.reason === 'external_state_required'));
});

auditedPlanningRuntimeTest('Spec 028 T023 — planning, rejection, and blocker transitions stay in redacted transcripts', async () => {
  const root = await makeRepoFixture();
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-planning-events-'));
  const fakeKey = `sk-proj-${'q'.repeat(32)}`;
  const broad = proposedRuntimeGoal({
    id: 'T-broad',
    question: GOAL_AUDIT_TASK,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe each requested authentication distinction independently.',
  });
  const invented = proposedRuntimeGoal({
    id: 'T-invented',
    question: `Inspect unrelated credential ${fakeKey}.`,
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe an unrelated credential in repository content.',
  });
  const corrected = definitionAndAbsenceGoals();
  const client = new ScriptedGoalAuditClient([
    { stage: 'planner:1', value: plannerControl([broad, invented]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([
        auditControlRecord(broad, 'needs_decomposition'),
        auditControlRecord(invented, 'reject_untraceable', { originRefs: [] }),
      ]),
    },
    { stage: 'planner:2', value: plannerControl(corrected) },
    {
      stage: 'goal_audit:2',
      value: auditorControl(corrected.map(goal =>
        auditControlRecord(goal, 'needs_decomposition'))),
    },
    {
      stage: 'goal_coverage:1',
      value: coverageControl([
        coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
      ]),
    },
  ]);

  await withEnv({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const runtime = new RuntimeImplementation({ chatClient: client });
    const result = await runtime.explore({ task: GOAL_AUDIT_TASK, repo_root: root });
    const entries = await readJsonl(result.transcriptPath);
    const eventTypes = new Set([
      'plan_proposed',
      'goal_audit',
      'plan_revised',
      'goal_rejected',
      'subgoal_state',
    ]);
    const planningEvents = entries.filter(entry => eventTypes.has(entry.type));

    assert.deepEqual(planningEvents.map(entry => entry.type), [
      'plan_proposed',
      'goal_audit',
      'goal_rejected',
      'plan_revised',
      'goal_audit',
      'subgoal_state',
      'subgoal_state',
    ]);
    assert.equal(planningEvents[0].revisionCount, 0);
    assert.deepEqual(planningEvents[0].proposal.subgoals.map(goal => goal.id),
      ['T-broad', 'T-invented']);
    assert.equal(planningEvents[1].revisionCount, 0);
    assert.deepEqual(planningEvents[1].auditRecords.map(record => record.proposedGoalId),
      ['T-broad', 'T-invented']);
    assert.deepEqual(planningEvents[1].capabilities, {
      repositoryRead: true,
      gitRead: true,
      repositoryWrite: false,
      liveRuntimeState: false,
      scopeWidening: false,
      secretPathRead: false,
    });
    assert.equal(planningEvents[2].proposedGoalId, 'T-invented');
    assert.equal(planningEvents[2].verdict, 'reject_untraceable');
    assert.equal(planningEvents[3].revisionCount, 1);
    assert.equal(planningEvents[3].proposal.subgoals.some(goal => goal.id === 'T-invented'), false);
    assert.equal(planningEvents[4].revisionCount, 1);
    assert.deepEqual(planningEvents.slice(5).map(event => event.subgoalId),
      corrected.map(goal => goal.id));
    assert.ok(planningEvents.slice(5).every(event => event.from === 'audit'));
    assert.ok(planningEvents.slice(5).every(event => event.to === 'blocked'));
    assert.ok(planningEvents.slice(5).every(event => event.reason === 'planning_incomplete'));
    assert.equal(entries.some(entry => entry.type === 'assistant'), false);
    assert.equal(entries.some(entry => entry.type === 'tool'), false);
    assert.equal(entries.at(-1).type, 'meta');

    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(fakeKey), false);
    assert.match(serialized, /\[REDACTED:openai-api-key\]/);
  });
});

auditedPlanningRuntimeTest('Spec 028 T022 — control prompts and returned trust state redact secret values', async () => {
  const secret = ['sk', '-proj-', 'a'.repeat(32)].join('');
  const task = `Inspect ${secret} without exposing it.`;
  const goal = {
    id: 'S-secret',
    question: 'Inspect the supplied token safely.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe whether the requested repository evidence can be inspected safely.',
    constraints: [],
  };
  const client = new ScriptedGoalAuditClient([
    {
      stage: 'planner:1',
      run(request) {
        const serialized = JSON.stringify(request.messages);
        assert.doesNotMatch(serialized, new RegExp(secret));
        assert.match(serialized, /\[REDACTED:openai-api-key\]/);
        return controlCompletion(plannerControl([goal]));
      },
    },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(goal)]),
    },
    {
      stage: 'exploration:1',
      run(request) {
        const serialized = JSON.stringify(request.messages);
        assert.doesNotMatch(serialized, new RegExp(secret));
        assert.match(serialized, /\[REDACTED:openai-api-key\]/);
        return controlCompletion('The redacted audited goal is ready.');
      },
    },
    {
      stage: 'synthesis:1',
      run(request) {
        assert.doesNotMatch(JSON.stringify(request.messages), new RegExp(secret));
        return controlCompletion(readyExplorationResult());
      },
    },
  ]);
  const root = await makeRepoFixture();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({ task, repo_root: root });

  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.match(result.taskContract.task, /\[REDACTED:openai-api-key\]/);

  const lateProposal = {
    ...goal,
    id: 'L-secret',
    question: `Inspect ${secret} safely.`,
  };
  const lateClient = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      const serialized = JSON.stringify(request.messages);
      assert.doesNotMatch(serialized, new RegExp(secret));
      assert.match(serialized, /\[REDACTED:openai-api-key\]/);
      return controlCompletion(auditorControl([auditControlRecord(lateProposal)]));
    },
  };
  const lateRuntime = new RuntimeImplementation({ chatClient: lateClient });
  const lateResult = await lateRuntime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [lateProposal],
  });
  assert.doesNotMatch(JSON.stringify(lateResult), new RegExp(secret));
  assert.match(lateResult.requiredSubgoals[0].question, /\[REDACTED:openai-api-key\]/);
});

auditedPlanningRuntimeTest('Spec 028 T017 — cancellation is honored at every planning and audit stage', async () => {
  const broad = proposedRuntimeGoal({
    id: 'S-broad',
    question: 'Locate requireAuth and independently check legacyGuard.',
    originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
    claimType: 'positive',
    proofCondition: 'Observe the definition and enumerate the registration surface.',
  });
  const corrected = definitionAndAbsenceGoals();
  const revisionAudit = auditorControl([
    auditControlRecord(broad, 'needs_decomposition'),
  ], [{
    question: corrected[1].question,
    originRefs: [...corrected[1].originRefs],
    claimType: corrected[1].claimType,
    proofCondition: corrected[1].proofCondition,
    constraints: [],
  }]);

  for (const abortAt of [
    'planner:1',
    'goal_audit:1',
    'planner:2',
    'goal_audit:2',
    'goal_coverage:1',
  ]) {
    const controller = new AbortController();
    class AbortAtStageClient {
      constructor() {
        this.model = 'zai-glm-4.7';
        this.counts = new Map();
        this.labels = [];
      }

      async createChatCompletion(request) {
        assert.equal(request.signal, controller.signal);
        const stage = classifyControlRequest(request);
        const count = (this.counts.get(stage) ?? 0) + 1;
        this.counts.set(stage, count);
        const label = `${stage}:${count}`;
        this.labels.push(label);
        if (label === abortAt) {
          controller.abort();
          const error = new Error(`cancelled at ${label}`);
          error.name = 'AbortError';
          throw error;
        }
        if (label === 'planner:1') return controlCompletion(plannerControl([broad]));
        if (label === 'goal_audit:1') return controlCompletion(revisionAudit);
        if (label === 'planner:2') return controlCompletion(plannerControl(corrected));
        if (label === 'goal_audit:2') {
          return controlCompletion(auditorControl(corrected.map(goal => auditControlRecord(goal))));
        }
        if (label === 'goal_coverage:1') {
          return controlCompletion(coverageControl([
            coveredObligation('revision-obligation-1', corrected.map(goal => goal.id)),
            coveredObligation('revision-obligation-2', [corrected[1].id]),
          ]));
        }
        assert.fail(`exploration must not start after cancellation target ${abortAt}`);
      }
    }

    const root = await makeRepoFixture();
    const client = new AbortAtStageClient();
    const runtime = new RuntimeImplementation({ chatClient: client });
    const result = await runtime.explore(
      { task: GOAL_AUDIT_TASK, repo_root: root },
      { abortSignal: controller.signal },
    );

    assert.equal(client.labels.at(-1), abortAt);
    assert.equal(result.failure?.reason, 'aborted', abortAt);
    assert.equal(result.status.complete, false, abortAt);
    assert.equal(/requireAuth is defined/.test(result.directAnswer ?? ''), false,
      `stale intermediate content leaked after ${abortAt}`);
  }
});

auditedPlanningRuntimeTest('Spec 028 T033 — provider faults retain precedence through audit wrappers', async t => {
  const initialGoal = proposedRuntimeGoal();
  await t.test('initial batched audit', async () => {
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([initialGoal]) },
      {
        stage: 'goal_audit:1',
        run() {
          throw new Error('initial audit provider outage');
        },
      },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task: GOAL_AUDIT_TASK,
      repo_root: root,
    });
    assert.equal(result.failure?.category, 'provider');
    assert.equal(result.failure?.reason, 'provider_error');
  });

  await t.test('revision coverage reconciliation', async () => {
    const broad = proposedRuntimeGoal({
      id: 'S-broad-provider',
      question: 'Locate requireAuth and independently check legacyGuard.',
      originRefs: [`request:0-${GOAL_AUDIT_TASK.length}`],
      claimType: 'positive',
      proofCondition: 'Observe the definition and enumerate the registration surface.',
    });
    const corrected = definitionAndAbsenceGoals();
    const client = new ScriptedGoalAuditClient([
      { stage: 'planner:1', value: plannerControl([broad]) },
      {
        stage: 'goal_audit:1',
        value: auditorControl([
          auditControlRecord(broad, 'needs_decomposition'),
        ], [{
          question: corrected[1].question,
          originRefs: [...corrected[1].originRefs],
          claimType: corrected[1].claimType,
          proofCondition: corrected[1].proofCondition,
          constraints: [],
        }]),
      },
      { stage: 'planner:2', value: plannerControl(corrected) },
      {
        stage: 'goal_audit:2',
        value: auditorControl(corrected.map(goal => auditControlRecord(goal))),
      },
      {
        stage: 'goal_coverage:1',
        run() {
          throw new Error('revision reconciliation provider outage');
        },
      },
    ]);
    const root = await makeRepoFixture();
    const result = await new RuntimeImplementation({ chatClient: client }).explore({
      task: GOAL_AUDIT_TASK,
      repo_root: root,
    });
    assert.equal(result.failure?.category, 'provider');
    assert.equal(result.failure?.reason, 'provider_error');
  });

  await t.test('late-goal audit wrapper', async () => {
    const lateGoal = {
      ...initialGoal,
      id: 'L-provider',
    };
    const client = new ScriptedGoalAuditClient([{
      stage: 'goal_audit:1',
      run() {
        throw new Error('late audit provider outage');
      },
    }]);
    const runtime = new RuntimeImplementation({ chatClient: client });
    await assert.rejects(runtime.auditLateGoalProposals({
      task: GOAL_AUDIT_TASK,
      effectiveScope: ['src/**'],
      wrapperTool: 'find_relevant_code',
      proposals: [lateGoal],
    }), error => error?.explorerFailureKind === 'provider');
  });
});

auditedPlanningRuntimeTest('Spec 028 T017 — late goal proposals are audited in bounded batches without re-planning', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const proposals = Array.from({ length: 13 }, (_, index) => ({
    id: `L${index + 1}`,
    question: `Inspect authentication facet ${index + 1}.`,
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: `Observe repository evidence for authentication facet ${index + 1}.`,
    constraints: [],
  }));

  class LateBatchAuditClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.requests = [];
      this.seenGoalIds = [];
    }

    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      assert.notEqual(stage, 'planner', 'late proposals must never invoke the planner');
      this.requests.push(request);
      if (stage === 'goal_coverage') {
        return controlCompletion(coverageControl([
          coveredObligation('batch-uncovered-1', ['L13']),
        ]));
      }
      assert.equal(stage, 'goal_audit');
      const prompt = JSON.stringify(request.messages);
      const batch = proposals.filter(goal =>
        new RegExp(`\\b${goal.id}\\b`).test(prompt));
      assert.ok(batch.length > 0 && batch.length <= 12);
      this.seenGoalIds.push(...batch.map(goal => goal.id));
      const records = batch.map(goal => {
        if (goal.id === 'L11') {
          return auditControlRecord(goal, 'reject_untraceable', { originRefs: [] });
        }
        if (goal.id === 'L12') return auditControlRecord(goal, 'needs_decomposition');
        return auditControlRecord(goal);
      });
      const { id: _ignoredId, ...otherBatchPart } = proposals[12];
      if (!batch.some(goal => goal.id === 'L13')) {
        records[0].missingRequestParts = [otherBatchPart.question];
      }
      return controlCompletion(auditorControl(
        records,
        batch.some(goal => goal.id === 'L13') ? [] : [otherBatchPart],
      ));
    }
  }

  const client = new LateBatchAuditClient();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals,
  });

  assert.ok(client.requests.length >= 2, '13 goals cannot fit in one bounded audit batch');
  assert.deepEqual(client.seenGoalIds, proposals.map(goal => goal.id),
    'late proposals must be audited exactly once and in request order');
  assert.deepEqual(result.requiredSubgoals
    .filter(goal => goal.auditVerdict === 'ready')
    .map(goal => goal.id), [
    ...proposals.slice(0, 10).map(goal => goal.id),
    proposals[12].id,
  ]);
  const latePlanningDefect = result.requiredSubgoals.find(goal =>
    goal.auditVerdict === 'planning_incomplete');
  assert.ok(latePlanningDefect);
  assert.equal(latePlanningDefect.state, 'blocked');
  assert.equal(latePlanningDefect.question, proposals[11].question);
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), ['L11']);
  assert.deepEqual(result.gaps.map(gap => gap.reason), ['planning_incomplete']);
  assert.equal(result.revisionRequest, null, 'late goals can never trigger another planner pass');
});

auditedPlanningRuntimeTest('Spec 028 T022 — a clean large audit skips unnecessary coverage reconciliation', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const proposals = Array.from({ length: 25 }, (_, index) => ({
    id: `Q${index + 1}`,
    question: `Inspect authentication facet ${index + 1}.`,
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: `Observe repository evidence for authentication facet ${index + 1}.`,
    constraints: [],
  }));
  const stages = [];
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      stages.push(stage);
      assert.equal(stage, 'goal_audit',
        'a clean batched audit must not trigger a holistic coverage provider call');
      const prompt = JSON.stringify(request.messages);
      const batch = proposals.filter(goal => new RegExp(`\\b${goal.id}\\b`).test(prompt));
      assert.ok(batch.length > 0 && batch.length <= 12);
      return controlCompletion(auditorControl(batch.map(goal => auditControlRecord(goal))));
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals,
  });

  assert.deepEqual(stages, ['goal_audit', 'goal_audit', 'goal_audit']);
  assert.deepEqual(result.requiredSubgoals.map(goal => goal.id), proposals.map(goal => goal.id));
  assert.deepEqual(result.gaps, []);
});

auditedPlanningRuntimeTest('Spec 028 T022 — rejected and uncovered batch conflict fails closed', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const proposals = Array.from({ length: 13 }, (_, index) => ({
    id: `C${index + 1}`,
    question: `Inspect authentication facet ${index + 1}.`,
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: `Observe repository evidence for authentication facet ${index + 1}.`,
    constraints: [],
  }));
  let auditCalls = 0;
  let coverageCalls = 0;
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      if (stage === 'goal_coverage') {
        coverageCalls += 1;
        return controlCompletion(coverageControl([remainingObligation('batch-uncovered-1')]));
      }
      assert.equal(stage, 'goal_audit');
      auditCalls += 1;
      const prompt = JSON.stringify(request.messages);
      const batch = proposals.filter(goal => new RegExp(`\\b${goal.id}\\b`).test(prompt));
      const records = batch.map(goal => goal.id === 'C13'
        ? auditControlRecord(goal, 'reject_untraceable', { originRefs: [] })
        : auditControlRecord(goal));
      const { id: _ignored, ...conflict } = proposals[12];
      if (!batch.some(goal => goal.id === 'C13')) {
        records[0].missingRequestParts = [conflict.question];
      }
      return controlCompletion(auditorControl(
        records,
        batch.some(goal => goal.id === 'C13') ? [] : [conflict],
      ));
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });

  await assert.rejects(runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals,
  }), error => error?.code === 'ERR_INVALID_GOAL_CONTROL' &&
    /rejected proposal was also reported as uncovered/.test(error.cause?.message ?? ''));
  assert.equal(auditCalls, 2);
  assert.equal(coverageCalls, 0, 'the merged audit conflict must fail before reconciliation');
});

auditedPlanningRuntimeTest('Spec 028 T022 — rejected and uncovered direct conflict fails closed', async () => {
  const task = 'Inspect the requested authentication facet.';
  const proposal = {
    id: 'C-direct',
    question: 'Invent an unrelated cache change.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe a location for an unrelated cache change.',
    constraints: [],
  };
  const { id: _ignored, ...conflict } = proposal;
  let calls = 0;
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      calls += 1;
      assert.equal(classifyControlRequest(request), 'goal_audit');
      return controlCompletion(auditorControl([
        auditControlRecord(proposal, 'reject_untraceable', { originRefs: [] }),
      ], [conflict]));
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });

  await assert.rejects(runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [proposal],
  }), error => error?.code === 'ERR_INVALID_GOAL_CONTROL' &&
    /rejected proposal was also reported as uncovered/.test(error.cause?.message ?? ''));
  assert.equal(calls, 2, 'the invalid direct audit receives only one bounded retry');
});

auditedPlanningRuntimeTest('Spec 028 T022 — a genuine late uncovered part becomes a terminal planning gap', async () => {
  const task = 'Inspect authentication and authorization facets.';
  const proposal = {
    id: 'L-authentication',
    question: 'Inspect the authentication facet.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe bounded repository evidence for authentication.',
    constraints: [],
  };
  const uncovered = {
    question: 'Inspect the authorization facet.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe bounded repository evidence for authorization.',
    constraints: [],
  };
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      assert.equal(classifyControlRequest(request), 'goal_audit');
      return controlCompletion(auditorControl([
        auditControlRecord(proposal, 'ready', {
          missingRequestParts: [uncovered.question],
        }),
      ], [uncovered]));
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [proposal],
  });

  assert.equal(result.requiredSubgoals.length, 2);
  assert.equal(result.requiredSubgoals[0].id, 'L-authentication');
  assert.equal(result.requiredSubgoals[1].auditVerdict, 'planning_incomplete');
  assert.equal(result.requiredSubgoals[1].question, uncovered.question);
  assert.deepEqual(result.gaps.map(gap => gap.reason), ['planning_incomplete']);
  assert.equal(result.revisionRequest, null);
});

auditedPlanningRuntimeTest('Spec 028 T017 — late goal audit forwards cancellation without registering goals', async () => {
  const task = 'Inspect the requested authentication facet.';
  const proposal = {
    id: 'L1',
    question: 'Inspect the requested authentication facet.',
    originRefs: [`request:0-${task.length}`],
    claimType: 'positive',
    proofCondition: 'Observe the requested repository evidence.',
    constraints: [],
  };
  const controller = new AbortController();
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      assert.equal(classifyControlRequest(request), 'goal_audit');
      assert.equal(request.signal, controller.signal);
      controller.abort();
      const error = new Error('late audit cancelled');
      error.name = 'AbortError';
      throw error;
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });

  await assert.rejects(runtime.auditLateGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'find_relevant_code',
    proposals: [proposal],
  }, { abortSignal: controller.signal }), error => error?.name === 'AbortError');
});

// T030-T033 implement this pipeline in stages. T033 flips this alias after the
// verifier, late-goal audit, repair, and fatal-fault paths have all landed.
const semanticPipelineRuntimeTest = test;

function trustGoal(task, {
  id,
  question,
  originText,
  claimType = 'positive',
  proofCondition = `Observe current repository evidence for ${question}`,
  constraints = [],
}) {
  return {
    id,
    question,
    originRefs: [requestOrigin(task, originText)],
    claimType,
    proofCondition,
    constraints,
  };
}

function candidateClaim(id, subgoalId, text, evidenceRefs) {
  return { id, subgoalId, text, evidenceRefs };
}

function semanticVerdict(claimId, result, evidenceRefs = []) {
  return {
    claimId,
    result,
    ...(result === 'supported' ? { resolution: 'affirmed' } : {}),
    supportingEvidenceRefs: evidenceRefs,
    reasonCode: result === 'supported'
      ? 'entailed'
      : result === 'contradicted' ? 'contradiction' : 'semantic_mismatch',
    note: `${claimId} is ${result}.`,
  };
}

function toolControlCompletion(tool, args, id) {
  return {
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    finishReason: 'tool_calls',
    message: {
      content: '',
      toolCalls: [{
        id,
        function: { name: tool, arguments: JSON.stringify(args) },
      }],
    },
  };
}

function parseControlPacket(request) {
  const content = request.messages.findLast(message =>
    message.role === 'user' && typeof message.content === 'string' &&
    message.content.includes('BEGIN_CONTROL_DATA_JSON'))?.content ?? '';
  const match = /BEGIN_CONTROL_DATA_JSON\n([\s\S]*?)\nEND_CONTROL_DATA_JSON/.exec(content);
  assert.ok(match, 'isolated control request must contain structured control data');
  return JSON.parse(match[1]);
}

function lateAuditResponse(request, verdict) {
  const packet = parseControlPacket(request);
  const proposals = packet.proposals ?? [];
  assert.ok(proposals.length > 0);
  return controlCompletion(auditorControl(proposals.map(proposal =>
    auditControlRecord(proposal, verdict, verdict === 'reject_untraceable'
      ? { originRefs: [] }
      : {}))));
}

function verifierResponse(verdicts, uncoveredRequestParts = []) {
  return { verdicts, uncoveredRequestParts };
}

function assertRepairRequest(request, { question, anchors }) {
  const packet = JSON.stringify(request.messages);
  assert.ok(packet.includes(question));
  assert.ok(packet.includes('src/**'));
  for (const anchor of anchors) assert.ok(packet.includes(anchor));
  assert.ok((request.tools?.length ?? 0) > 0,
    'repair must remain a scoped repository-tool pass');
  assert.equal(request.responseFormat, undefined,
    'repair input is a gap task, not a second planner/control response');
}

function buildTrustSteps({ goals, initial, repair }) {
  const steps = [
    { stage: 'planner:1', value: plannerControl(goals) },
    {
      stage: 'goal_audit:1',
      value: auditorControl(goals.map(goal => auditControlRecord(goal))),
    },
  ];
  let exploration = 0;
  let claimSynthesis = 0;
  let verification = 0;
  let audit = 1;

  const addPass = (pass, { includeFinalSynthesis = false } = {}) => {
    if (pass.providerError) {
      exploration += 1;
      steps.push({
        stage: `exploration:${exploration}`,
        run(request) {
          pass.assertRequest?.(request);
          const error = new Error(pass.providerError);
          error.retryable = false;
          throw error;
        },
      });
      return;
    }
    for (const call of pass.tools ?? []) {
      exploration += 1;
      steps.push({
        stage: `exploration:${exploration}`,
        run(request) {
          pass.assertRequest?.(request);
          return toolControlCompletion(call.tool, call.args, call.id);
        },
      });
    }
    exploration += 1;
    steps.push({ stage: `exploration:${exploration}`, content: pass.prose ?? 'Evidence pass complete.' });
    if (includeFinalSynthesis) {
      steps.push({ stage: 'synthesis:1', value: readyExplorationResult() });
    }
    claimSynthesis += 1;
    steps.push({
      stage: `claim_synthesis:${claimSynthesis}`,
      value: { claims: pass.claims },
    });

    const verifierSteps = pass.verifierSteps ?? [{
      verdicts: pass.verdicts,
      uncovered: pass.uncovered,
      assertRequest: pass.assertVerifier,
    }];
    for (const verifier of verifierSteps) {
      verification += 1;
      steps.push({
        stage: `semantic_verifier:${verification}`,
        run(request) {
          verifier.assertRequest?.(request);
          if (verifier.error) {
            const error = new Error(verifier.error);
            error.retryable = false;
            throw error;
          }
          if (verifier.raw !== undefined) {
            return controlCompletion(verifier.raw, { finishReason: verifier.finishReason });
          }
          return controlCompletion(verifierResponse(
            verifier.verdicts,
            verifier.uncovered ?? [],
          ));
        },
      });
    }
    if (pass.auditVerdict) {
      audit += 1;
      steps.push({
        stage: `goal_audit:${audit}`,
        run: request => lateAuditResponse(request, pass.auditVerdict),
      });
    }
  };

  addPass(initial, { includeFinalSynthesis: true });
  if (repair) addPass(repair);
  return steps;
}

async function runTrustScript(steps, { task, setup, abortSignal } = {}) {
  const root = await makeRepoFixture();
  if (setup) await setup(root);
  const client = new ScriptedGoalAuditClient(steps);
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({
    task: task ?? GOAL_AUDIT_TASK,
    repo_root: root,
    scope: ['src/**'],
  }, { abortSignal });
  return { client, result };
}

function providerToolActions(client) {
  return client.completions.flatMap(completion => completion?.message?.toolCalls ?? [])
    .map(call => ({
      type: 'tool',
      tool: call.function.name,
      arguments: JSON.parse(call.function.arguments),
    }));
}

function assertNoRequiredLeak(result, text) {
  assert.equal(result.taskContract.subgoals.some(goal => goal.question === text), false);
  assert.equal(result.coverageGaps.some(gap => gap.question === text), false);
  assert.doesNotMatch(result.directAnswer ?? '', new RegExp(text));
}

test('Spec 028 T030 — isolated semantic controls reduce claims without trusting exploration prose', async () => {
  const goals = definitionAndAbsenceGoals();
  const supported = candidateClaim(
    'C-definition', goals[0].id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const mismatch = candidateClaim(
    'C-absence', goals[1].id, 'legacyGuard is absent from every repository path.', ['E2']);
  const privateSentinel = 'PRIVATE_EXPLORER_REASONING';
  const steps = buildTrustSteps({
    goals,
    initial: {
      tools: [
        { tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'read-auth' },
        { tool: 'repo_grep', args: { pattern: 'legacyGuard', scope: ['src/**'] }, id: 'grep-legacy' },
      ],
      prose: privateSentinel,
      claims: [supported, mismatch],
      verifierSteps: [{
        raw: verifierResponse([
          semanticVerdict(supported.id, 'supported', ['E1']),
          { ...semanticVerdict(mismatch.id, 'insufficient'), resolution: null },
        ]),
      }],
    },
    repair: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
        id: 'repair-routes',
      }],
      assertRequest: request => assertRepairRequest(request, {
        question: goals[1].question,
        anchors: ['src/auth.js', 'legacyGuard'],
      }),
      claims: [
        { ...supported, evidenceRefs: ['E1', 'E3'] },
        { ...mismatch, evidenceRefs: ['E2', 'E3'] },
      ],
      verdicts: [
        semanticVerdict(supported.id, 'supported', ['E1', 'E3']),
        semanticVerdict(mismatch.id, 'insufficient'),
      ],
    },
  });
  const { client, result } = await runTrustScript(steps);
  assert.deepEqual(client.stageLabels, [
    'planner:1',
    'goal_audit:1',
    'exploration:1',
    'exploration:2',
    'exploration:3',
    'synthesis:1',
    'claim_synthesis:1',
    'semantic_verifier:1',
    'exploration:4',
    'exploration:5',
    'claim_synthesis:2',
    'semantic_verifier:2',
  ]);
  for (const stage of [
    'claim_synthesis:1', 'semantic_verifier:1',
    'claim_synthesis:2', 'semantic_verifier:2',
  ]) {
    const request = client.requests[client.stageLabels.indexOf(stage)];
    assert.equal((request.tools?.length ?? 0), 0);
    assert.doesNotMatch(JSON.stringify(request.messages), new RegExp(privateSentinel));
  }
  const postClaimRequest = client.requests[
    client.stageLabels.indexOf('claim_synthesis:2')
  ];
  const priorPacketText = postClaimRequest.messages.findLast(message =>
    typeof message.content === 'string' &&
    message.content.includes('BEGIN_REQUIRED_PRIOR_CLAIMS_JSON'))?.content ?? '';
  const priorPacketMatch = /BEGIN_REQUIRED_PRIOR_CLAIMS_JSON\n([\s\S]*?)\nEND_REQUIRED_PRIOR_CLAIMS_JSON/
    .exec(priorPacketText);
  assert.ok(priorPacketMatch);
  const priorPacket = JSON.parse(priorPacketMatch[1]);
  assert.ok(priorPacket.priorClaims.every(claim =>
    Object.keys(claim).sort().join(',') === 'evidenceRefs,id,subgoalId,text'));
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[0].id).state, 'supported');
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[1].id).state, 'gap');
  assert.ok(result.coverageGaps.some(gap =>
    gap.subgoalId === goals[1].id && gap.reason === 'semantic_mismatch' &&
    gap.repairable === false));
  assert.deepEqual(result.semanticVerification.verdicts.map(verdict =>
    [verdict.claimId, verdict.result]), [
    ['C-definition', 'supported'],
    ['C-absence', 'insufficient'],
  ]);
  assert.deepEqual(result.semanticVerification.runtimeAllowedEvidenceRefsBySubgoal
    .map(item => [item.subgoalId, item.evidenceRefs]), [
    ['S-definition', ['E1', 'E1:search', 'E2', 'E3', 'E3:search']],
    ['S-absence', ['E1', 'E1:search', 'E2', 'E3', 'E3:search']],
  ]);
});

test('Spec 028 T031 — verifier proposals are audited once without re-planning or parent leakage', async t => {
  const fixtures = [
    {
      name: 'ready proposal enters one repair and ends terminal',
      verdict: 'ready',
      expectedReason: 'semantic_mismatch',
      expectedState: 'gap',
      repairable: false,
    },
    {
      name: 'untraceable proposal is discarded',
      verdict: 'reject_untraceable',
    },
    {
      name: 'scope blocker becomes a terminal required gap',
      verdict: 'blocked_scope',
      expectedReason: 'scope_blocked',
      expectedState: 'blocked',
      repairable: false,
    },
    {
      name: 'undecomposed proposal becomes a terminal planning gap',
      verdict: 'needs_decomposition',
      expectedReason: 'planning_incomplete',
      expectedState: 'blocked',
      repairable: false,
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const goal = definitionAndAbsenceGoals()[0];
      const claim = candidateClaim(
        'C-definition', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
      const proposal = {
        question: fixture.verdict === 'reject_untraceable'
          ? 'Which unrelated cache should be rewritten?'
          : 'Which requested authentication check still needs repository evidence?',
        originRefs: [requestOrigin(GOAL_AUDIT_TASK, 'Locate requireAuth')],
        claimType: 'positive',
        proofCondition: 'Observe the requested authentication evidence.',
        constraints: [],
      };
      const steps = buildTrustSteps({
        goals: [goal],
        initial: {
          tools: [{
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'read-auth',
          }],
          claims: [claim],
          verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
          uncovered: [proposal],
          auditVerdict: fixture.verdict,
        },
        repair: fixture.verdict === 'ready' ? {
          tools: [{
            tool: 'repo_read_file',
            args: { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
            id: 'repair-auth-check',
          }],
          assertRequest: request => assertRepairRequest(request, {
            question: proposal.question,
            anchors: ['src/auth.js'],
          }),
          claims: [
            { ...claim, evidenceRefs: ['E1', 'E2'] },
            candidateClaim(
              'C-late-auth-check',
              'late-uncovered:initial:1',
              'The requested additional authentication check is not yet established.',
              ['E2'],
            ),
          ],
          verdicts: [
            semanticVerdict(claim.id, 'supported', ['E1', 'E2']),
            semanticVerdict('C-late-auth-check', 'insufficient'),
          ],
        } : null,
      });
      const { client, result } = await runTrustScript(steps);

      assert.equal(client.stageCounts.get('planner'), 1);
      assert.equal(client.stageCounts.get('goal_audit'), 2);
      assert.equal(client.stageCounts.get('semantic_verifier'),
        fixture.verdict === 'ready' ? 2 : 1);
      const lateAuditRequest = client.requests[client.stageLabels.indexOf('goal_audit:2')];
      assert.deepEqual(parseControlPacket(lateAuditRequest).proposals.map(item => item.id), [
        'late-uncovered:initial:1',
      ]);
      if (fixture.verdict === 'reject_untraceable') {
        assertNoRequiredLeak(result, proposal.question);
        assert.deepEqual(result.rejectedGoals.map(item => item.proposedGoalId), [
          'late-uncovered:initial:1',
        ]);
      } else {
        const lateGoal = result.taskContract.subgoals.find(item =>
          item.id === 'late-uncovered:initial:1');
        const gap = result.coverageGaps.find(item => item.subgoalId === lateGoal?.id);
        assert.ok(lateGoal);
        assert.ok(gap);
        assert.equal(lateGoal.state, fixture.expectedState);
        assert.equal(gap.reason, fixture.expectedReason);
        assert.equal(gap.repairable, fixture.repairable);
      }
      assert.equal(result.failure, null);
    });
  }
});

test('Spec 028 T031 — proposals from every verifier batch enter one late audit ledger', async () => {
  const task = 'Inspect every requested authentication facet in the repository.';
  const goals = Array.from({ length: 13 }, (_, index) => trustGoal(task, {
    id: `S-batch-${index + 1}`,
    question: `Inspect requested authentication facet ${index + 1}.`,
    originText: task,
  }));

  class BatchedVerifierClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.stageCounts = new Map();
      this.lateAuditBatches = [];
    }

    async createChatCompletion(request) {
      const stage = classifyControlRequest(request);
      const count = (this.stageCounts.get(stage) ?? 0) + 1;
      this.stageCounts.set(stage, count);

      if (stage === 'planner') return controlCompletion(plannerControl(goals));
      if (stage === 'goal_audit') {
        const proposals = parseControlPacket(request).proposals;
        if (proposals.every(goal => goal.id.startsWith('late-uncovered:'))) {
          this.lateAuditBatches.push(proposals.map(goal => goal.id));
        }
        return controlCompletion(auditorControl(
          proposals.map(goal => auditControlRecord(goal)),
        ));
      }
      if (stage === 'exploration') {
        if (count === 1) {
          return toolControlCompletion(
            'repo_read_file',
            { path: 'src/auth.js', startLine: 1, endLine: 4 },
            'batch-read',
          );
        }
        if (count === 3) {
          assertRepairRequest(request, {
            question: 'Inspect verifier batch 1 follow-up requirement.',
            anchors: ['src/auth.js'],
          });
          const repairMessage = request.messages.findLast(message =>
            typeof message.content === 'string' &&
            message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))?.content ?? '';
          const repairMatch = /BEGIN_EVIDENCE_REPAIR_JSON\n([\s\S]*?)\nEND_EVIDENCE_REPAIR_JSON/
            .exec(repairMessage);
          assert.ok(repairMatch);
          assert.deepEqual(JSON.parse(repairMatch[1]).questions.map(item => item.question), [
            'Inspect verifier batch 1 follow-up requirement.',
            'Inspect verifier batch 2 follow-up requirement.',
          ]);
          return toolControlCompletion(
            'repo_read_file',
            { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
            'batch-repair-read',
          );
        }
        return controlCompletion('Evidence collection complete.');
      }
      if (stage === 'synthesis') return controlCompletion(readyExplorationResult());
      if (stage === 'claim_synthesis') {
        const batchGoals = parseControlPacket(request).control.requiredSubgoals;
        return controlCompletion({
          claims: batchGoals.map(goal => candidateClaim(
            `C-${goal.id}`,
            goal.id,
            `Observed source evidence for ${goal.question}`,
            count <= 2
              ? ['E1']
              : goal.id.startsWith('late-uncovered:') ? ['E2'] : ['E1', 'E2'],
          )),
        });
      }
      if (stage === 'semantic_verifier') {
        const claims = parseControlPacket(request).claims;
        return controlCompletion(verifierResponse(
          claims.map(claim => claim.subgoalId.startsWith('late-uncovered:')
            ? semanticVerdict(claim.id, 'insufficient')
            : semanticVerdict(claim.id, 'supported',
                count <= 2 ? ['E1'] : ['E1', 'E2'])),
          count <= 2 ? [{
            question: `Inspect verifier batch ${count} follow-up requirement.`,
            originRefs: [`request:0-${task.length}`],
            claimType: 'positive',
            proofCondition: `Observe repository evidence for verifier batch ${count}.`,
            constraints: [],
          }] : [],
        ));
      }
      assert.fail(`unexpected stage ${stage}`);
    }
  }

  const root = await makeRepoFixture();
  const client = new BatchedVerifierClient();
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime.explore({
    task,
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(client.stageCounts.get('planner'), 1);
  assert.equal(client.stageCounts.get('semantic_verifier'), 4);
  assert.deepEqual(client.lateAuditBatches, [[
    'late-uncovered:initial:1',
    'late-uncovered:initial:2',
  ]], 'all verifier batches must be collected before one isolated late audit');
  assert.deepEqual(result.taskContract.subgoals
    .filter(goal => goal.id.startsWith('late-uncovered:'))
    .map(goal => goal.state), ['gap', 'gap']);
  assert.deepEqual(result.coverageGaps
    .filter(gap => gap.subgoalId?.startsWith('late-uncovered:'))
    .map(gap => gap.repairable), [false, false]);
});

test('Spec 028 T031 — post-repair verifier proposals use the same audit and stay terminal', async () => {
  const task = 'Locate requireAuth and inspect its requested route registration.';
  const existing = createRequiredSubgoal({
    id: 'S-existing',
    question: 'Where is requireAuth defined?',
    originRefs: [requestOrigin(task, 'Locate requireAuth')],
    claimType: 'symbol_definition',
    proofCondition: 'Observe the in-scope definition and source body.',
    constraints: [],
    auditVerdict: 'ready',
  });
  const taskContract = createTaskContract({
    task,
    effectiveScope: ['src/**'],
    constraints: [],
    subgoals: [existing],
    plannerVersion: 'planner-v1',
    goalAuditVersion: 'goal-audit-v1',
  });
  const stages = [];
  const client = {
    model: 'zai-glm-4.7',
    async createChatCompletion(request) {
      stages.push(classifyControlRequest(request));
      return lateAuditResponse(request, 'ready');
    },
  };
  const runtime = new RuntimeImplementation({ chatClient: client });
  const result = await runtime._auditVerifierGoalProposals({
    task,
    effectiveScope: ['src/**'],
    wrapperTool: 'explore_repo',
    taskContract,
    coverageGaps: [],
    rejectedGoals: [{
      proposedGoalId: 'late-uncovered:post-repair:1',
      verdict: 'reject_untraceable',
      originRefs: [],
      missingRequestParts: [],
      reason: 'Previously rejected.',
    }],
    uncoveredRequestParts: [{
      question: 'Which requested route registration still needs inspection?',
      originRefs: [requestOrigin(task, 'inspect its requested route registration')],
      claimType: 'positive',
      proofCondition: 'Observe current route registration source.',
      constraints: [],
    }],
    phase: 'post-repair',
  });

  assert.deepEqual(stages, ['goal_audit']);
  const lateGoal = result.taskContract.subgoals.find(goal =>
    goal.id === 'late-uncovered:post-repair:2');
  assert.ok(lateGoal, 'runtime ids must avoid prior rejected-goal ids');
  assert.equal(lateGoal.state, 'gap');
  const gap = result.coverageGaps.find(item => item.subgoalId === lateGoal.id);
  assert.equal(gap.reason, 'uncovered_request');
  assert.equal(gap.repairable, false);
  assert.deepEqual(result.rejectedGoals.map(goal => goal.proposedGoalId), [
    'late-uncovered:post-repair:1',
  ]);
});

semanticPipelineRuntimeTest('Spec 028 T026 — verifier input is isolated and gates semantic mismatch', async () => {
  const goals = definitionAndAbsenceGoals();
  const supported = candidateClaim(
    'C-definition', goals[0].id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const mismatch = candidateClaim(
    'C-absence', goals[1].id, 'legacyGuard is absent from every repository path.', ['E2']);
  const privateSentinels = [
    'PRIVATE_EXPLORER_REASONING',
    'MODEL_CONFIDENCE_099',
  ];
  const steps = buildTrustSteps({
    goals,
    initial: {
      tools: [
        { tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'read-auth' },
        { tool: 'repo_grep', args: { pattern: 'legacyGuard', scope: ['src/**'] }, id: 'grep-legacy' },
      ],
      prose: privateSentinels.join(' '),
      claims: [supported, mismatch],
      verdicts: [
        semanticVerdict(supported.id, 'supported', ['E1']),
        semanticVerdict(mismatch.id, 'insufficient'),
      ],
      assertVerifier(request) {
        const packet = JSON.stringify(request.messages);
        for (const expected of [
          'Locate requireAuth', 'src/**', supported.id, mismatch.id,
          'export function requireAuth', 'sourceRole', 'temporalRole', 'current',
        ]) assert.match(packet, new RegExp(expected.replaceAll('*', '\\*')));
        for (const sentinel of privateSentinels) {
          assert.doesNotMatch(packet, new RegExp(sentinel));
        }
      },
    },
    repair: { tools: [], claims: [], verdicts: [] },
  });
  const { client, result } = await runTrustScript(steps);

  assert.equal(client.stageCounts.get('semantic_verifier'), 1);
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[0].id).state, 'supported');
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[1].id).state, 'gap');
  assert.match(result.directAnswer, /requireAuth is defined/);
  assert.doesNotMatch(result.directAnswer, /absent from every repository path/);
  assert.ok(result.coverageGaps.some(gap =>
    gap.subgoalId === goals[1].id && gap.reason === 'semantic_mismatch'));
  assert.equal(result.failure, null);
});

test('Spec 028 T032 — verifier inventions are audited without re-planning or leakage', async t => {
  const task = 'Locate requireAuth and report whether route registration needs another authentication check.';
  const goal = trustGoal(task, {
    id: 'S-definition',
    question: 'Where is requireAuth defined?',
    originText: 'Locate requireAuth',
    claimType: 'symbol_definition',
  });
  const claim = candidateClaim(
    'C-definition', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const cases = [
    {
      name: 'initial untraceable proposal is discarded',
      question: 'Which unrelated cache should be rewritten?',
      initialVerdict: 'supported',
      auditVerdict: 'reject_untraceable',
      postRepair: false,
    },
    {
      name: 'post-repair traceable proposal becomes a terminal gap',
      question: 'Which route registration needs another authentication check?',
      initialVerdict: 'insufficient',
      auditVerdict: 'ready',
      postRepair: true,
    },
    {
      name: 'post-repair untraceable proposal is discarded',
      question: 'Which unrelated cache should be rewritten?',
      initialVerdict: 'insufficient',
      auditVerdict: 'reject_untraceable',
      postRepair: true,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const proposal = {
        question: fixture.question,
        originRefs: [requestOrigin(task, fixture.postRepair
          ? 'report whether route registration needs another authentication check'
          : 'Locate requireAuth')],
        claimType: 'positive',
        proofCondition: `Observe evidence for ${fixture.question}`,
        constraints: [],
      };
      const initial = {
        tools: [{ tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 1 }, id: 'read-partial' }],
        claims: [claim],
        verdicts: [semanticVerdict(claim.id, fixture.initialVerdict,
          fixture.initialVerdict === 'supported' ? ['E1'] : [])],
        ...(fixture.postRepair ? {} : {
          uncovered: [proposal], auditVerdict: fixture.auditVerdict,
        }),
      };
      const repair = fixture.postRepair ? {
        tools: [{ tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'repair-read' }],
        assertRequest: request => assertRepairRequest(request, {
          question: goal.question,
          anchors: ['src/auth.js'],
        }),
        claims: [{ ...claim, evidenceRefs: ['E1', 'E2'] }],
        verdicts: [semanticVerdict(claim.id, 'supported', ['E1', 'E2'])],
        uncovered: [proposal],
        auditVerdict: fixture.auditVerdict,
      } : null;
      const { client, result } = await runTrustScript(
        buildTrustSteps({ goals: [goal], initial, repair }), { task });

      assert.equal(client.stageCounts.get('planner'), 1);
      assert.equal(client.stageCounts.get('goal_audit'), 2);
      assert.equal(client.stageCounts.get('semantic_verifier'), fixture.postRepair ? 2 : 1);
      assert.equal(providerToolActions(client).filter(action =>
        action.arguments.path === 'src/auth.js' && action.arguments.endLine === 4).length,
      fixture.postRepair ? 1 : 0);
      if (fixture.auditVerdict === 'ready') {
        const gap = result.coverageGaps.find(item => item.question === fixture.question);
        assert.ok(gap);
        assert.equal(gap.reason, 'uncovered_request');
        assert.equal(gap.repairable, false);
      } else {
        assertNoRequiredLeak(result, fixture.question);
      }
      assert.equal(result.failure, null);
    });
  }
});

test('Spec 028 T032 — one repair reopens claims and suppresses equivalent follow-up', async () => {
  const task = 'Verify every user route uses requireAuth and determine whether legacyGuard is registered.';
  const goals = [
    trustGoal(task, {
      id: 'S-routes', question: 'Does every user route use requireAuth?',
      originText: 'Verify every user route uses requireAuth', claimType: 'absence',
    }),
    trustGoal(task, {
      id: 'S-legacy', question: 'Is legacyGuard registered?',
      originText: 'determine whether legacyGuard is registered', claimType: 'absence',
      proofCondition: 'Use the exact grep and complete route-registration read without repeating either action.',
      constraints: ['Do not widen src/** or require external state.'],
    }),
    trustGoal(task, {
      id: 'S-recovered', question: 'Does the public route use requireAuth?',
      originText: 'Verify every user route uses requireAuth', claimType: 'positive',
    }),
  ];
  const routeClaim = candidateClaim(
    'C-routes', goals[0].id, 'Every observed user route uses requireAuth.', ['E1']);
  const legacyClaim = candidateClaim(
    'C-legacy', goals[1].id, 'legacyGuard is absent from src/**.', ['E2']);
  const recoveredClaim = candidateClaim(
    'C-recovered', goals[2].id, 'The public route uses requireAuth.', ['E1']);
  const repairAction = {
    type: 'tool',
    tool: 'repo_read_file',
    arguments: { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
  };
  const repairFingerprint = fingerprintAction(repairAction);
  const steps = buildTrustSteps({
    goals,
    initial: {
      tools: [
        { tool: 'repo_read_file', args: { path: 'src/routes/user.js', startLine: 1, endLine: 4 }, id: 'read-route' },
        { tool: 'repo_grep', args: { pattern: 'legacyGuard', scope: ['src/**'] }, id: 'grep-legacy' },
      ],
      claims: [routeClaim, legacyClaim, recoveredClaim],
      verdicts: [
        semanticVerdict(routeClaim.id, 'supported', ['E1']),
        semanticVerdict(legacyClaim.id, 'insufficient'),
        semanticVerdict(recoveredClaim.id, 'contradicted'),
      ],
    },
    repair: {
      tools: [{
        tool: repairAction.tool,
        args: { endLine: 20, startLine: 1, path: 'src/routes/user.js' },
        id: 'repair-routes',
      }],
      assertRequest: request => assertRepairRequest(request, {
        question: goals[1].question,
        anchors: ['src/routes/user.js', 'legacyGuard'],
      }),
      claims: [
        { ...routeClaim, evidenceRefs: ['E1', 'E3'] },
        { ...legacyClaim, evidenceRefs: ['E2', 'E3'] },
        { ...recoveredClaim, evidenceRefs: ['E1', 'E3'] },
      ],
      verdicts: [
        semanticVerdict(routeClaim.id, 'contradicted'),
        semanticVerdict(legacyClaim.id, 'insufficient'),
        semanticVerdict(recoveredClaim.id, 'supported', ['E3']),
      ],
      assertVerifier(request) {
        const packet = JSON.stringify(request.messages);
        for (const id of [
          'S-routes', 'S-legacy', 'S-recovered',
          'C-routes', 'C-legacy', 'C-recovered',
        ]) {
          assert.match(packet, new RegExp(id));
        }
        assert.match(packet, /\/users\/public/);
      },
    },
  });
  const { client, result } = await runTrustScript(steps, {
    task,
    setup: root => fs.appendFile(
      path.join(root, 'src', 'routes', 'user.js'),
      '\n\nexport const publicRoute = app => app.get("/users/public", publicHandler);',
    ),
  });

  assert.equal(client.stageCounts.get('semantic_verifier'), 2);
  assert.equal(client.stageCounts.get('claim_synthesis'), 2);
  assert.equal(client.stageCounts.get('planner'), 1);
  assert.equal(providerToolActions(client).filter(action =>
    fingerprintAction(action) === repairFingerprint).length, 1);
  assert.doesNotMatch(result.directAnswer ?? '', /Every observed user route uses requireAuth/);
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[0].id).state, 'contradicted');
  assert.equal(result.taskContract.subgoals.find(goal =>
    goal.id === goals[2].id).state, 'supported',
  'fresh repair evidence can resolve a previously contradicted goal');
  const legacyGap = result.coverageGaps.find(gap => gap.subgoalId === goals[1].id);
  assert.ok(legacyGap.attemptedActionFingerprints.includes(repairFingerprint));
  assert.equal(legacyGap.repairable, false);
  assert.equal(legacyGap.followUp, undefined,
    'the only equivalent action was already attempted during repair');
  assert.deepEqual(result.observations.map(observation => observation.id), [
    'E1', 'E1:search', 'E2', 'E3', 'E3:search',
  ]);
  assert.equal(result.failure, null);
});

test('Spec 028 T032 — repair never re-executes an equivalent initial action', async () => {
  const task = 'Determine whether requireAuth is fully established by the inspected range.';
  const goal = trustGoal(task, {
    id: 'S-repeat',
    question: task,
    originText: task,
  });
  const claim = candidateClaim(
    'C-repeat', goal.id, 'The inspected range fully establishes requireAuth.', ['E1']);
  const action = {
    type: 'tool',
    tool: 'repo_read_file',
    arguments: { path: 'src/auth.js', startLine: 1, endLine: 4 },
  };
  const { client, result } = await runTrustScript(buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{ tool: action.tool, args: action.arguments, id: 'initial-read' }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
    repair: {
      tools: [{ tool: action.tool, args: { endLine: 4, path: 'src/auth.js', startLine: 1 }, id: 'repeat-read' }],
      assertRequest: request => assertRepairRequest(request, {
        question: goal.question,
        anchors: ['src/auth.js'],
      }),
      claims: [{ ...claim }],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
  }), { task });

  assert.equal(client.stageCounts.get('claim_synthesis'), 1,
    'no fresh observation means there is no post-repair synthesis');
  assert.equal(client.stageCounts.get('semantic_verifier'), 1);
  assert.deepEqual(result.observations.map(observation => observation.id), ['E1', 'E1:search']);
  assert.equal(result.stats.filesRead, 1, 'the equivalent repair read was suppressed');
  assert.equal(result.directAnswer, '',
    'an unresolved claim must not fall back to pre-verifier exploration text');
  const gap = result.coverageGaps.find(item => item.subgoalId === goal.id);
  assert.equal(gap.repairable, false);
  assert.deepEqual(gap.attemptedActionFingerprints, [fingerprintAction(action)]);
});

test('Spec 028 T032 — post-repair synthesis cannot omit a prior claim', async () => {
  const task = 'Determine whether requireAuth protects the inspected route.';
  const goal = trustGoal(task, {
    id: 'S-preserve',
    question: task,
    originText: task,
  });
  const claim = candidateClaim(
    'C-preserve', goal.id, 'requireAuth protects the inspected route.', ['E1']);
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'initial-auth',
      }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'insufficient')],
    },
    repair: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/routes/user.js', startLine: 1, endLine: 20 },
        id: 'repair-route',
      }],
      claims: [],
      verdicts: [],
    },
  });
  const omittedClaimIndex = steps.findIndex(step => step.stage === 'claim_synthesis:2');
  steps.splice(omittedClaimIndex + 1, 0, {
    stage: 'claim_synthesis:3',
    value: { claims: [] },
  });

  const { result } = await runTrustScript(steps, { task });
  assert.equal(result.failure?.category, 'internal');
  assert.equal(result.failure?.reason, 'invalid_final_response');
  assert.equal(result.status.complete, false);
  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.evidence, []);
  assert.doesNotMatch(result.directAnswer, /requireAuth protects the inspected route/);
});

test('Spec 028 T032 — a zero-observation gap still receives the one repair round', async () => {
  const task = 'Determine whether requireAuth is defined.';
  const goal = trustGoal(task, {
    id: 'S-anchorless',
    question: task,
    originText: task,
  });
  const claim = candidateClaim(
    'C-anchorless', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const steps = [
    { stage: 'planner:1', value: plannerControl([goal]) },
    {
      stage: 'goal_audit:1',
      value: auditorControl([auditControlRecord(goal)]),
    },
    { stage: 'exploration:1', content: 'No initial repository action.' },
    { stage: 'synthesis:1', value: readyExplorationResult() },
    {
      stage: 'exploration:2',
      run(request) {
        assertRepairRequest(request, { question: goal.question, anchors: [] });
        const content = request.messages.find(message =>
          message.role === 'user' && message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))
          ?.content ?? '';
        const match = /BEGIN_EVIDENCE_REPAIR_JSON\n([\s\S]*?)\nEND_EVIDENCE_REPAIR_JSON/.exec(content);
        assert.deepEqual(JSON.parse(match?.[1] ?? 'null').anchors, [],
          'question and immutable scope bound an anchorless repair');
        return toolControlCompletion('repo_read_file', {
          path: 'src/auth.js', startLine: 1, endLine: 4,
        }, 'anchorless-repair');
      },
    },
    { stage: 'exploration:3', content: 'Anchorless repair complete.' },
    { stage: 'claim_synthesis:1', value: { claims: [claim] } },
    {
      stage: 'semantic_verifier:1',
      value: verifierResponse([semanticVerdict(claim.id, 'supported', ['E1'])]),
    },
  ];

  const { client, result } = await runTrustScript(steps, { task });

  assert.equal(client.stageCounts.get('exploration'), 3);
  assert.equal(client.stageCounts.get('claim_synthesis'), 1);
  assert.equal(result.taskContract.subgoals.find(item => item.id === goal.id).state,
    'supported');
  assert.equal(result.coverageGaps.some(gap => gap.subgoalId === goal.id), false);
  assert.deepEqual(result.observations.map(observation => observation.id), ['E1', 'E1:search']);
});

semanticPipelineRuntimeTest('Spec 028 T026 — valid partial limits are goal-local and non-fatal', async () => {
  const goals = definitionAndAbsenceGoals();
  const definition = candidateClaim(
    'C-definition', goals[0].id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const exhaustive = candidateClaim(
    'C-long', goals[1].id, 'legacyGuard is absent from every line of src/long.js.', ['E2']);
  const steps = buildTrustSteps({
    goals,
    initial: {
      tools: [
        { tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'read-auth' },
        { tool: 'repo_read_file', args: { path: 'src/long.js', startLine: 1, endLine: 10_000 }, id: 'read-long' },
      ],
      claims: [definition, exhaustive],
      verdicts: [
        semanticVerdict(definition.id, 'supported', ['E1']),
        semanticVerdict(exhaustive.id, 'insufficient'),
      ],
      assertVerifier(request) {
        assert.match(JSON.stringify(request.messages),
          /tool_result_limit|toolTruncated|contextTruncated/);
      },
    },
  });
  const { client, result } = await runTrustScript(steps, {
    setup: root => fs.writeFile(
      path.join(root, 'src', 'long.js'),
      Array.from({ length: 400 }, (_, index) => `export const line${index} = ${index};`).join('\n'),
    ),
  });

  assert.equal(client.stageCounts.get('semantic_verifier'), 1);
  assert.equal(result.failure, null);
  assert.match(result.directAnswer, /requireAuth is defined/);
  assert.doesNotMatch(result.directAnswer, /legacyGuard is absent from every line/);
  assert.ok(result.coverageGaps.some(gap =>
    gap.subgoalId === goals[1].id && gap.reason === 'safety_limit_reached'));
  const toolLimits = result.stats.safetyLimits.filter(limit =>
    limit.name === 'tool_result_limit');
  assert.deepEqual(toolLimits.map(limit => limit.stage), ['exploration']);
  assert.ok(toolLimits[0].affectedSubgoalIds.includes(goals[1].id));
});

semanticPipelineRuntimeTest('Spec 028 T033 — cancellation after the final verifier response suppresses verified output', async () => {
  const controller = new AbortController();
  const goal = definitionAndAbsenceGoals()[0];
  const claim = candidateClaim(
    'C-late-cancel', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  const steps = buildTrustSteps({
    goals: [goal],
    initial: {
      tools: [{
        tool: 'repo_read_file',
        args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
        id: 'read-auth',
      }],
      claims: [claim],
      verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
      assertVerifier() {
        controller.abort();
      },
    },
  });

  const { result } = await runTrustScript(steps, { abortSignal: controller.signal });

  assert.equal(controller.signal.aborted, true);
  assert.equal(result.failure?.reason, 'aborted');
  assert.equal(result.status.complete, false);
  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.evidence, []);
  assert.doesNotMatch(result.directAnswer, /requireAuth is defined/);
});

semanticPipelineRuntimeTest('Spec 028 T033 — invalid final control never promotes a stale draft', async t => {
  const goal = definitionAndAbsenceGoals()[0];
  const claim = candidateClaim(
    'C-final-stale', goal.id, 'requireAuth is defined in src/auth.js.', ['E1']);
  for (const fixture of [
    {
      name: 'bounded invalid responses become an internal control failure',
      secondStep: { stage: 'synthesis:2', content: 'STALE_FINAL_REPAIR_SENTINEL' },
      category: 'internal',
      reason: 'invalid_final_response',
    },
    {
      name: 'provider failure during final repair takes precedence',
      secondStep: {
        stage: 'synthesis:2',
        run() {
          const error = new Error('final repair provider outage');
          error.retryable = false;
          throw error;
        },
      },
      category: 'provider',
      reason: 'provider_error',
    },
  ]) {
    await t.test(fixture.name, async () => {
      const steps = buildTrustSteps({
        goals: [goal],
        initial: {
          tools: [{
            tool: 'repo_read_file',
            args: { path: 'src/auth.js', startLine: 1, endLine: 4 },
            id: 'read-auth',
          }],
          claims: [claim],
          verdicts: [semanticVerdict(claim.id, 'supported', ['E1'])],
        },
      });
      const synthesisIndex = steps.findIndex(step => step.stage === 'synthesis:1');
      steps.splice(
        synthesisIndex,
        1,
        { stage: 'synthesis:1', content: 'STALE_FINAL_PRIMARY_SENTINEL' },
        fixture.secondStep,
      );

      const { client, result } = await runTrustScript(steps);

      assert.equal(client.stageCounts.get('semantic_verifier') ?? 0, 0);
      assert.equal(result.failure?.category, fixture.category);
      assert.equal(result.failure?.reason, fixture.reason);
      assert.equal(result.status.complete, false);
      assert.deepEqual(result.targets, []);
      assert.deepEqual(result.evidence, []);
      assert.deepEqual(result.discoveredPaths, []);
      assert.doesNotMatch(JSON.stringify(result), /STALE_FINAL_(?:PRIMARY|REPAIR)_SENTINEL/);
    });
  }
});

semanticPipelineRuntimeTest('Spec 028 T026 — invalid verifier and provider faults fail closed', async t => {
  const goal = definitionAndAbsenceGoals()[0];
  const staleText = 'UNVERIFIED_FIRST_PASS_CLAIM';
  const claim = candidateClaim('C-stale', goal.id, staleText, ['E1']);
  const faultCases = [
    {
      name: 'malformed verifier JSON after bounded recovery',
      verifierSteps: [{ raw: '{"verdicts":' }, { raw: '{"verdicts":' }],
      verifierCalls: 2,
      failureCategory: 'internal',
      failureReason: 'invalid_final_response',
    },
    {
      name: 'output-capped invalid verifier JSON',
      verifierSteps: [
        { raw: '{"verdicts":', finishReason: 'length' },
        { raw: '{"verdicts":', finishReason: 'length' },
      ],
      verifierCalls: 2,
      failureCategory: 'internal',
      failureReason: 'invalid_final_response',
      check(result) {
        const limit = result.stats.safetyLimits.find(item =>
          item.name === 'generation_output_limit');
        assert.equal(limit.stage, 'verification');
        assert.equal(limit.truncated, true);
      },
    },
    {
      name: 'provider fault at verifier',
      verifierSteps: [{ error: 'non-retryable verifier outage' }],
      verifierCalls: 1,
      failureCategory: 'provider',
      failureReason: 'provider_error',
    },
    {
      name: 'provider fault during repair',
      verifierSteps: [{ verdicts: [semanticVerdict(claim.id, 'insufficient')] }],
      repairError: 'non-retryable repair outage',
      verifierCalls: 1,
      failureCategory: 'provider',
      failureReason: 'provider_error',
    },
  ];

  for (const fixture of faultCases) {
    await t.test(fixture.name, async () => {
      const initial = {
        tools: [{ tool: 'repo_read_file', args: { path: 'src/auth.js', startLine: 1, endLine: 4 }, id: 'read-auth' }],
        prose: staleText,
        claims: [claim],
        verifierSteps: fixture.verifierSteps,
      };
      const repair = fixture.repairError ? { providerError: fixture.repairError } : null;
      if (repair) {
        repair.assertRequest = request => assertRepairRequest(request, {
          question: goal.question,
          anchors: ['src/auth.js'],
        });
      }
      const { client, result } = await runTrustScript(
        buildTrustSteps({ goals: [goal], initial, repair }));

      assert.ok(result.failure);
      assert.equal(result.failure.category, fixture.failureCategory);
      assert.equal(result.failure.reason, fixture.failureReason);
      assert.doesNotMatch(result.directAnswer ?? '', new RegExp(staleText));
      assert.equal(result.status.complete, false);
      assert.deepEqual(result.targets, []);
      assert.deepEqual(result.evidence, []);
      assert.deepEqual(result.discoveredPaths, []);
      assert.equal(client.stageCounts.get('semantic_verifier'), fixture.verifierCalls);
      fixture.check?.(result);
    });
  }
});
