import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as mcpServerModule from '../src/mcp/server.mjs';
import { buildExecutionProvenance, createMcpRequestHandler } from '../src/mcp/server.mjs';
import { getRepoRoot } from '../src/explorer/config.mjs';
import { adaptLegacyGoalAuditClient } from './helpers/legacy-goal-audit-client.mjs';

const EXPECTED_PUBLIC_TOOL_NAMES = [
  'find_relevant_code',
  'trace_symbol',
  'map_change_impact',
  'explain_code_path',
  'collect_evidence',
  'review_change_context',
  'explore_repo',
  'explore',
];

const EXPECTED_WRAPPER_TOOL_NAMES = EXPECTED_PUBLIC_TOOL_NAMES.filter(
  name => name !== 'explore_repo' && name !== 'explore',
);

const REMOVED_SPEC_013_TOOL_NAMES = [
  ['map', 'impact'].join('_'),
  ['find', 'entrypoints'].join('_'),
];

test('spec 022 execution provenance describes the live 8-tool registry', () => {
  const provenance = buildExecutionProvenance({ gitSha: 'abc1234' });

  assert.deepEqual(Object.keys(provenance).sort(), [
    'exposedToolCount',
    'gitSha',
    'packageVersion',
    'schemaVersion',
    'serverName',
    'serverVersion',
    'toolNames',
    'toolRegistryHash',
  ].sort());
  assert.equal(provenance.serverName, 'cerebras-explorer-mcp');
  assert.equal(provenance.serverVersion, '0.8.9');
  assert.equal(provenance.packageVersion, '0.8.9');
  assert.equal(provenance.schemaVersion, 2);
  assert.equal(provenance.gitSha, 'abc1234');
  assert.equal(provenance.exposedToolCount, EXPECTED_PUBLIC_TOOL_NAMES.length);
  assert.deepEqual(provenance.toolNames, EXPECTED_PUBLIC_TOOL_NAMES);
  assert.match(provenance.toolRegistryHash, /^[0-9a-f]{64}$/);
});

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
  constructor(adapterOptions = {}) {
    this.model = 'zai-glm-4.7';
    this.calls = 0;
    return adaptLegacyGoalAuditClient(this, adapterOptions);
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

class ThrowingChatClient {
  constructor() {
    this.model = 'mock';
  }

  async createChatCompletion() {
    throw new Error('provider unavailable');
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

async function readJsonl(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  return source.trim().split('\n').map(line => JSON.parse(line));
}

async function captureStderr(fn) {
  const originalWrite = process.stderr.write;
  const chunks = [];
  process.stderr.write = function patchedWrite(chunk, encoding, callback) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };
  try {
    const result = await fn();
    return { result, stderr: chunks.join('') };
  } finally {
    process.stderr.write = originalWrite;
  }
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

// T037 precedes the T042 MCP projection. As with the other test-first tasks,
// the missing projection runs as expected-red TODO; a partial export activates
// all assertions and fails normally.
function parentHandoffMcpTest(name, callback) {
  const buildResponse = mcpServerModule.buildParentHandoffResponse;
  const register = typeof buildResponse === 'function' ? test : test.todo;
  register(name, () => {
    assert.equal(typeof buildResponse, 'function',
      'buildParentHandoffResponse is not implemented');
    return callback(buildResponse);
  });
}

function mcpV3SourceEvidence(overrides = {}) {
  return {
    kind: 'source',
    path: 'src/auth.mjs',
    startLine: 10,
    endLine: 18,
    supports: 'The route validates the token before dispatch.',
    ...overrides,
  };
}

function assertQuietMcpEnvelope(response, expectedStructured) {
  assert.deepEqual(response.structuredContent, expectedStructured);
  assert.equal(response._meta, undefined, 'default MCP responses must omit operational metadata');
  assert.equal(response.content?.length, 1);
  assert.equal(response.content[0]?.type, 'text');
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized,
    /evidenceQuality|searchCoverage|critic|confidence|taskContract|coverageGaps|stats|transcriptPath|toolTrace/);
}

parentHandoffMcpTest(
  'Spec 028 T037 — complete and verify_targets MCP text mirror only action-relevant v3 facts',
  (buildResponse) => {
    const complete = {
      schemaVersion: 3,
      directAnswer: 'The route validates the token before dispatch.',
      state: 'complete',
      evidence: [mcpV3SourceEvidence()],
    };
    const completeResponse = buildResponse(structuredClone(complete));
    assertQuietMcpEnvelope(completeResponse, complete);
    assert.equal(completeResponse.content[0].text, complete.directAnswer,
      'complete text must be the direct answer only');
    assert.equal(completeResponse.isError, undefined);

    const verifyTargets = {
      schemaVersion: 3,
      directAnswer: 'The schema declaration and MCP projection must change together.',
      state: 'verify_targets',
      targets: [{
        path: 'src/explorer/schemas.mjs',
        startLine: 294,
        endLine: 324,
        role: 'edit',
        reason: 'Change the public output schema here.',
        evidenceRefs: ['E1'],
      }],
      evidence: [mcpV3SourceEvidence({
        id: 'E1',
        path: 'src/explorer/schemas.mjs',
        startLine: 294,
        endLine: 324,
        supports: 'This range declares the public output schema.',
      })],
    };
    const verifyResponse = buildResponse(structuredClone(verifyTargets));
    assertQuietMcpEnvelope(verifyResponse, verifyTargets);
    assert.equal(verifyResponse.content[0].text, [
      verifyTargets.directAnswer,
      '',
      'State: verify_targets',
      'Target: src/explorer/schemas.mjs:294-324 — Change the public output schema here.',
    ].join('\n'));
    assert.equal(verifyResponse.isError, undefined);
  },
);

parentHandoffMcpTest(
  'Spec 028 T037 — partial and all-blocked incomplete MCP results omit empty fields',
  (buildResponse) => {
    const partial = {
      schemaVersion: 3,
      directAnswer: 'The API route exists.',
      state: 'incomplete',
      evidence: [mcpV3SourceEvidence({ supports: 'The API route exists.' })],
      gaps: [{
        question: 'Whether an alternate bootstrap registers the route',
        reason: 'The bootstrap search was truncated.',
      }],
      followUp: {
        type: 'tool',
        tool: 'explore_repo',
        arguments: {
          task: 'Check bootstrap files for route registration.',
          scope: ['src/app/**'],
          hints: { files: ['src/app/index.mjs'] },
        },
      },
    };
    const partialResponse = buildResponse(structuredClone(partial));
    assertQuietMcpEnvelope(partialResponse, partial);
    assert.equal(partialResponse.content[0].text, [
      partial.directAnswer,
      '',
      'State: incomplete',
      'Gap: Whether an alternate bootstrap registers the route — The bootstrap search was truncated.',
      'Follow-up: explore_repo — Check bootstrap files for route registration.',
    ].join('\n'));
    assert.deepEqual(
      partialResponse.structuredContent.followUp.arguments.hints.files,
      ['src/app/index.mjs'],
      'explore_repo anchors stay nested under arguments.hints.files',
    );

    const allBlocked = {
      schemaVersion: 3,
      state: 'incomplete',
      gaps: [{
        question: 'Whether the deployed service uses the repository configuration',
        reason: 'This depends on live state unavailable to the repository explorer.',
      }],
      followUp: {
        type: 'external_verification',
        requirement: 'Report the active deployed configuration revision.',
      },
    };
    const blockedResponse = buildResponse(structuredClone(allBlocked));
    assertQuietMcpEnvelope(blockedResponse, allBlocked);
    assert.equal(blockedResponse.content[0].text, [
      'State: incomplete',
      'Gap: Whether the deployed service uses the repository configuration — This depends on live state unavailable to the repository explorer.',
      'Follow-up: Report the active deployed configuration revision.',
    ].join('\n'));
    for (const omitted of ['directAnswer', 'targets', 'evidence', 'failure']) {
      assert.equal(Object.hasOwn(blockedResponse.structuredContent, omitted), false,
        `all-blocked responses must omit ${omitted}`);
    }
  },
);

parentHandoffMcpTest(
  'Spec 028 T037 — failed MCP results use exact nested retry actions without stale success data',
  (buildResponse) => {
    const failed = {
      schemaVersion: 3,
      directAnswer: 'Provider failed before a trustworthy answer was produced.',
      state: 'failed',
      failure: {
        reason: 'provider_error',
        retry: {
          type: 'tool',
          tool: 'explore_repo',
          arguments: {
            task: 'Trace token validation.',
            hints: { files: ['src/auth.mjs'] },
          },
        },
      },
    };
    const response = buildResponse(structuredClone(failed));
    assertQuietMcpEnvelope(response, failed);
    assert.equal(response.isError, true);
    assert.equal(response.content[0].text, [
      failed.directAnswer,
      '',
      'State: failed',
      'Failure: provider_error',
      'Retry: explore_repo — Trace token validation.',
    ].join('\n'));
    for (const omitted of ['targets', 'evidence', 'gaps', 'followUp']) {
      assert.equal(Object.hasOwn(response.structuredContent, omitted), false,
        `failed responses must omit ${omitted}`);
    }
  },
);

parentHandoffMcpTest(
  'Spec 028 T037 — MCP projection rejects flattened, legacy, and tool-mismatched actions',
  (buildResponse) => {
    const incomplete = {
      schemaVersion: 3,
      state: 'incomplete',
      gaps: [{ question: 'Where is the symbol used?', reason: 'Usage evidence is incomplete.' }],
    };
    const invalidFollowUps = [
      {
        type: 'tool',
        tool: 'explore_repo',
        task: 'Search again.',
      },
      {
        type: 'tool',
        tool: 'explore_repo',
        args: { task: 'Search again.' },
      },
      {
        type: 'tool',
        tool: 'trace_symbol',
        arguments: { task: 'This is not a trace_symbol argument.' },
      },
      {
        type: 'tool',
        tool: 'explore_repo',
        arguments: { task: 'Search again.', hints: { files: ['src/a.mjs'], unknown: true } },
      },
    ];
    for (const followUp of invalidFollowUps) {
      assert.throws(() => buildResponse({ ...incomplete, followUp }));
    }

    const failed = {
      schemaVersion: 3,
      directAnswer: 'Provider failed.',
      state: 'failed',
      failure: { reason: 'provider_error' },
    };
    for (const retry of invalidFollowUps) {
      assert.throws(() => buildResponse({
        ...failed,
        failure: { reason: 'provider_error', retry },
      }));
    }
    for (const retry of [
      { type: 'ask_user', question: 'Should this be retried?' },
      {
        type: 'external_verification',
        requirement: 'Check the provider outside this explorer.',
      },
    ]) {
      assert.throws(() => buildResponse({
        ...failed,
        failure: { reason: 'provider_error', retry },
      }), 'failure.retry accepts tool actions only');
    }
  },
);

parentHandoffMcpTest(
  'Spec 028 T037 — real core and wrapper tool calls use the quiet v3 projection',
  async (buildResponse) => {
    const repoRoot = await makeRepoFixture();
    for (const [tool, args] of [
      ['explore_repo', {
        task: 'Trace users/me route authentication.',
        repo_root: repoRoot,
        scope: ['src/**'],
      }],
      ['find_relevant_code', {
        query: 'Locate users/me route authentication.',
        repo_root: repoRoot,
        scope: ['src/**'],
      }],
    ]) {
      const { handleRequest } = createMcpRequestHandler({
        runtimeOptions: { chatClient: new MockChatClient() },
      });
      const called = await handleRequest({
        jsonrpc: '2.0',
        id: tool,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      });
      const expectedEnvelope = buildResponse(structuredClone(called.structuredContent));
      assert.deepEqual(called, expectedEnvelope,
        `${tool} must route its actual result through buildParentHandoffResponse`);
      assert.equal(called._meta, undefined, `${tool} must keep default _meta quiet`);
      assert.equal(called.structuredContent.schemaVersion, 3);
      for (const legacy of [
        'status',
        'evidenceQuality',
        'searchCoverage',
        'critic',
        'nextAction',
        'discoveredPaths',
      ]) {
        assert.equal(Object.hasOwn(called.structuredContent, legacy), false,
          `${tool} must omit ${legacy}`);
      }
    }
  },
);

// spec 011: the report-mode router was removed. All explore calls use one
// backend unconditionally, so the previous routing tests are no longer applicable.

test('MCP request handler exposes explore_repo and returns structuredContent', async () => {
  const repoRoot = await makeRepoFixture();
  const rejectedSentinel = {
    id: 'REJECTED_PARENT_SENTINEL_ID',
    question: 'REJECTED_PARENT_SENTINEL_QUESTION',
    proofCondition: 'REJECTED_PARENT_SENTINEL_PROOF',
    reason: 'REJECTED_PARENT_SENTINEL_REASON',
  };
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MockChatClient({ rejectedGoal: rejectedSentinel }),
    },
  });

  const initialized = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
  });
  assert.equal(initialized.serverInfo.name, 'cerebras-explorer-mcp');
  assert.equal(initialized.serverInfo.version, '0.8.9');

  const listed = await handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  assert.equal(Array.isArray(listed.tools), true);
  const toolNames = listed.tools.map(t => t.name);
  assert.deepEqual(toolNames, EXPECTED_PUBLIC_TOOL_NAMES);
  for (const removedToolName of REMOVED_SPEC_013_TOOL_NAMES) {
    assert.ok(!toolNames.includes(removedToolName), `${removedToolName} must not be exposed`);
  }
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
  assert.match(exploreRepoTool.description, /general fallback for read-only repository exploration/);
  // spec 017: session input parameter was removed; description no longer
  // mentions it.
  assert.doesNotMatch(exploreRepoTool.description, /sessionId/);
  assert.equal(exploreRepoTool.inputSchema.properties.session, undefined,
    'spec 017: session input parameter was removed');
  // The public budget input is removed; structured calls use fixed, unlabeled limits.
  assert.equal(exploreRepoTool.inputSchema.properties.budget, undefined, 'budget input was removed in spec 011');
  assert.ok(exploreRepoTool.outputSchema.properties.targets, 'explore_repo must expose outputSchema targets');
  assert.equal(exploreRepoTool.outputSchema.additionalProperties, false);
  assert.equal(exploreRepoTool.outputSchema.properties.answer, undefined);
  const exploreTool = listed.tools.find(t => t.name === 'explore');
  assert.equal(exploreTool.inputSchema.properties.thoroughness, undefined,
    'inert thoroughness input was removed from explore');
  assert.doesNotMatch(exploreTool.description, /thoroughness/);
  for (const toolName of EXPECTED_WRAPPER_TOOL_NAMES) {
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
  assert.equal(called.structuredContent.schemaVersion, 2);
  assert.equal(called.structuredContent.failure, null);
  assert.ok(called.structuredContent.critic);
  assert.ok(Array.isArray(called.structuredContent.critic.warnings));
  assert.equal(called.structuredContent.evidenceQuality.level, called.structuredContent.status.confidence);
  assert.equal(called.structuredContent.evidenceQuality.exactCount, 2);
  assert.equal(called.structuredContent.evidenceQuality.fileCount, 2);
  assert.deepEqual(called.structuredContent.searchCoverage.scope, ['src/**']);
  assert.equal(called.structuredContent.searchCoverage.scopeLimited, true);
  assert.equal(called.structuredContent.searchCoverage.omittedDiscoveredPaths, 0);
  assert.ok(called.structuredContent.evidence.every(item => item.id && item.snippet), 'evidence must include ids and snippets');
  // spec 017: MCP response no longer exposes sessionId, session, or _debug.
  assert.equal(called.structuredContent.sessionId, undefined);
  assert.equal(called.structuredContent.session, undefined);
  assert.equal(called.structuredContent._debug, undefined);
  assert.equal(called.structuredContent.taskContract, undefined);
  assert.equal(called.structuredContent.coverageGaps, undefined);
  assert.equal(called.structuredContent.rejectedGoals, undefined);
  assert.equal(called.structuredContent.observations, undefined);
  assert.equal(called.structuredContent.semanticVerification, undefined);
  assert.equal(called.structuredContent.plan_proposed, undefined);
  assert.equal(called.structuredContent.goal_audit, undefined);
  const serializedMcpResult = JSON.stringify(called);
  for (const sentinel of Object.values(rejectedSentinel)) {
    assert.equal(serializedMcpResult.includes(sentinel), false,
      `rejected planning sentinel leaked through MCP: ${sentinel}`);
  }
  assert.doesNotMatch(serializedMcpResult,
    /taskContract|coverageGaps|rejectedGoals|observations|semanticVerification|runtimeAllowedEvidenceRefsBySubgoal|plan_proposed|goal_audit|plan_revised|goal_rejected|subgoal_state/);
  assert.match(called.content[0].text, /requireAuth/);
  assert.match(called.content[0].text, /Evidence Quality/);
  assert.match(called.content[0].text, /Search Coverage/);
  assert.match(called.content[0].text, /## Targets/);
  assert.doesNotMatch(called.content[0].text, /snippet:/);
  assert.doesNotMatch(called.content[0].text, /export function requireAuth/);
  assert.doesNotMatch(called.content[0].text, /FORGED_BY_MODEL/);
  assert.ok(called.structuredContent.evidence.every(item => !item.snippet.includes('FORGED_BY_MODEL')), 'model-supplied snippets are not returned');
  assert.doesNotMatch(called.content[0].text, /## Stats/);
  assert.doesNotMatch(called.content[0].text, /Session:/);
});

// spec 017: fallback-session integration test removed alongside SessionStore.

test('trace_symbol wrapper delegates through explore_repo and writes LOG_PATH transcript', async () => {
  const repoRoot = await makeRepoFixture();
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-wrapper-transcripts-'));
  const restore = applyEnvPatch({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
  });

  try {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: {
        chatClient: new MockChatClient(),
      },
    });

    const called = await handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'trace_symbol',
        arguments: {
          symbol: 'requireAuth',
          repo_root: repoRoot,
          scope: ['src/**'],
        },
      },
    });

    assert.equal(called.structuredContent.status.verification, 'verified');
    const files = (await fs.readdir(logDir)).filter(name => name.endsWith('.jsonl'));
    assert.equal(files.length, 1);

    const transcriptPath = path.join(logDir, files[0]);
    assert.match(files[0], /^[0-9T-]+Z_explore_repo_[0-9a-f-]{36}\.jsonl$/);
    const entries = await readJsonl(transcriptPath);
    assert.equal(entries[0].tool, 'explore_repo');
    assert.ok(entries.every(entry => entry.callId === entries[0].callId));
    assert.equal(entries[0].provenance.serverName, 'cerebras-explorer-mcp');
    assert.equal(entries[0].provenance.schemaVersion, 2);
    assert.equal(entries[0].provenance.exposedToolCount, EXPECTED_PUBLIC_TOOL_NAMES.length);
    assert.deepEqual(entries[0].provenance.toolNames, EXPECTED_PUBLIC_TOOL_NAMES);
    assert.match(entries[0].provenance.toolRegistryHash, /^[0-9a-f]{64}$/);
  } finally {
    restore();
  }
});

test('explore_repo MCP call writes one stderr ops summary without polluting result payload', async () => {
  const repoRoot = await makeRepoFixture();
  const restore = applyEnvPatch({
    CEREBRAS_EXPLORER_LOG_PATH: undefined,
    CEREBRAS_EXPLORER_LOG_RAW: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
  });

  try {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: {
        chatClient: new MockChatClient(),
      },
    });

    const { result: called, stderr } = await captureStderr(() => handleRequest({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: {
        name: 'explore_repo',
        arguments: {
          task: 'trace requireAuth usage',
          repo_root: repoRoot,
          scope: ['src/**'],
        },
      },
    }));

    const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[cerebras-explorer\] tool=explore_repo turns=\d+ toolCalls=\d+ stoppedByBudget=(true|false) elapsed=\d+s$/);
    assert.doesNotMatch(JSON.stringify(called), /\[cerebras-explorer\]/);
  } finally {
    restore();
  }
});

test('explore_repo stderr ops summary includes transcript log path when LOG_PATH is set', async () => {
  const repoRoot = await makeRepoFixture();
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-ops-summary-log-'));
  const restore = applyEnvPatch({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
  });

  try {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: {
        chatClient: new MockChatClient(),
      },
    });

    const { stderr } = await captureStderr(() => handleRequest({
      jsonrpc: '2.0',
      id: 32,
      method: 'tools/call',
      params: {
        name: 'explore_repo',
        arguments: {
          task: 'trace requireAuth usage',
          repo_root: repoRoot,
          scope: ['src/**'],
        },
      },
    }));

    const line = stderr.trim();
    assert.match(line, /^\[cerebras-explorer\] tool=explore_repo turns=\d+ toolCalls=\d+ stoppedByBudget=(true|false) elapsed=\d+s log=.+\.jsonl$/);
    assert.equal(line.includes(logDir), false, 'ops summary should not expose the full local log directory');
    assert.match(line, / log=[^/\\]+\.jsonl$/);
  } finally {
    restore();
  }
});

test('explore_repo stderr ops summary marks LOG_RAW mode after log path', async () => {
  const repoRoot = await makeRepoFixture();
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-ops-summary-raw-log-'));
  const restore = applyEnvPatch({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
    CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
  });

  try {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: {
        chatClient: new MockChatClient(),
      },
    });

    const { stderr } = await captureStderr(() => handleRequest({
      jsonrpc: '2.0',
      id: 33,
      method: 'tools/call',
      params: {
        name: 'explore_repo',
        arguments: {
          task: 'trace requireAuth usage',
          repo_root: repoRoot,
          scope: ['src/**'],
        },
      },
    }));

    assert.match(stderr.trim(), / log=[^/\\]+\.jsonl raw=true$/);
    assert.equal(stderr.includes(logDir), false, 'raw ops summary should not expose the full local log directory');
  } finally {
    restore();
  }
});

test('explore MCP call writes stderr ops summary for free-form reports', async () => {
  const repoRoot = await makeRepoFixture();
  const report = 'Summary cites `src/auth.js:L1-L3`.';
  const restore = applyEnvPatch({
    CEREBRAS_EXPLORER_LOG_PATH: undefined,
    CEREBRAS_EXPLORER_LOG_RAW: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
  });

  try {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: {
        chatClient: new MarkdownReportClient(report),
      },
    });

    const { stderr } = await captureStderr(() => handleRequest({
      jsonrpc: '2.0',
      id: 34,
      method: 'tools/call',
      params: {
        name: 'explore',
        arguments: {
          prompt: 'explain auth flow',
          repo_root: repoRoot,
        },
      },
    }));

    assert.match(stderr.trim(), /^\[cerebras-explorer\] tool=explore turns=\d+ toolCalls=\d+ stoppedByBudget=(true|false) elapsed=\d+s$/);
  } finally {
    restore();
  }
});

test('explore_repo MCP call writes stderr ops summary when execution fails', async () => {
  const repoRoot = await makeRepoFixture();
  const restore = applyEnvPatch({
    CEREBRAS_EXPLORER_LOG_PATH: undefined,
    CEREBRAS_EXPLORER_LOG_RAW: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
  });

  try {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: {
        chatClient: new ThrowingChatClient(),
      },
    });

    const { result: called, stderr } = await captureStderr(() => handleRequest({
      jsonrpc: '2.0',
      id: 35,
      method: 'tools/call',
      params: {
        name: 'explore_repo',
        arguments: {
          task: 'trace requireAuth usage',
          repo_root: repoRoot,
          scope: ['src/**'],
        },
      },
    }));

    assert.equal(called.isError, true);
    assert.match(stderr.trim(), /^\[cerebras-explorer\] tool=explore_repo turns=0 toolCalls=0 stoppedByBudget=false elapsed=0s failure=provider_error$/);
  } finally {
    restore();
  }
});

test('explore provider-error retry recipe matches the explore input schema', async () => {
  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new ThrowingChatClient() },
  });

  const failed = await handleRequest({
    jsonrpc: '2.0',
    id: 70,
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: { prompt: 'explain the auth flow', repo_root: repoRoot, scope: ['src/**'] },
    },
  });

  const retry = failed.structuredContent.failure.retry;
  assert.equal(retry.tool, 'explore', 'retry recipe targets the explore tool');
  // explore requires `prompt` and rejects unknown keys, so a recipe using
  // explore_repo's `task` key would be unusable by the parent agent.
  assert.equal(retry.args.task, undefined, 'retry args must not use the explore_repo `task` key for explore');
  assert.equal(typeof retry.args.prompt, 'string', 'retry args must carry a `prompt` for explore');

  // Replaying the suggested retry must not be rejected as invalid input.
  const replay = await handleRequest({
    jsonrpc: '2.0',
    id: 71,
    method: 'tools/call',
    params: { name: retry.tool, arguments: { ...retry.args, repo_root: repoRoot } },
  });
  assert.notEqual(
    replay.structuredContent.failure?.reason,
    'invalid_arguments',
    'the suggested retry args must be accepted by the explore schema',
  );
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
      },
    },
  });

  assert.equal(called.content[0].text, report);
  assert.equal(called.structuredContent.report, report);
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
  assert.ok(called.structuredContent.searchCoverage);
  assert.ok(called.structuredContent.critic);
  assert.equal(called.structuredContent.failure, null);
  assert.equal(called.structuredContent.filesRead, undefined);
  assert.equal(called.structuredContent.toolsUsed, undefined);
  assert.equal(called.structuredContent.stats, undefined);
  assert.equal(called.structuredContent.transcriptPath, undefined);
  assert.equal(called.structuredContent.toolTrace, undefined);
  assert.ok(called._meta?.ops, 'operational diagnostics should be separated into MCP _meta');
  assert.ok(called._meta.ops.stats);
});

test('explore rejects removed thoroughness input', async () => {
  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new MarkdownReportClient('No call should be made.'),
    },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 31,
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: {
        prompt: 'explain auth flow',
        repo_root: repoRoot,
        thoroughness: 'quick',
      },
    },
  });

  assert.equal(called.isError, true);
  assert.match(called.content[0].text, /Unknown explore argument: thoroughness/);
  assert.equal(called.structuredContent.failure.category, 'input');
  assert.equal(called.structuredContent.failure.reason, 'invalid_arguments');
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

test('MCP request handler rejects removed spec 013 wrappers as unknown tools', async () => {
  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new MockChatClient() },
  });

  const listed = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const toolNames = listed.tools.map(t => t.name);
  for (const removedToolName of REMOVED_SPEC_013_TOOL_NAMES) {
    assert.ok(!toolNames.includes(removedToolName), `${removedToolName} must not be listed`);
    await assert.rejects(
      handleRequest({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: removedToolName, arguments: { repo_root: repoRoot } },
      }),
      new RegExp(`Unknown tool: ${removedToolName}`),
    );
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

test('MCP request handler declares read-only annotations for the fixed 8-tool surface', async () => {
  // spec 011: tool surface is fixed at 8 regardless of legacy envvars.
  const expectedNames = EXPECTED_PUBLIC_TOOL_NAMES;

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
      `${scenario.name}: tool surface is fixed at 8 regardless of legacy envvars`,
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

  const { result: called, stderr } = await captureStderr(() => handleRequest({
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
    }));

  assert.equal(called.isError, true);
  assert.match(called.content[0].text, /Unable to resolve repo_root for explore_repo/);
  assert.match(called.content[0].text, new RegExp(normalizedRepoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(called.content[0].text, /Invalid explore_repo arguments/);
  assert.equal(called.structuredContent.failure.category, 'input');
  assert.equal(called.structuredContent.failure.reason, 'repo_mismatch');
  // F7: clients may surface only content text on isError and drop structuredContent,
  // so the machine-readable reason must also appear in the text.
  assert.match(called.content[0].text, /reason: repo_mismatch/i);
  assert.match(stderr.trim(), /tool=explore_repo .* failure=repo_mismatch$/);
});

test('MCP request handler classifies generic invalid params as invalid_arguments', async () => {
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
  assert.equal(called.structuredContent.schemaVersion, 2);
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
  assert.match(called.content[0].text, /provider failed/i);
  assert.doesNotMatch(called.content[0].text, /provider exploded/);
  assert.doesNotMatch(called.content[0].text, /Invalid explore_repo arguments/);
  assert.doesNotMatch(called.content[0].text, /Invalid arguments for explore_repo/);
  assert.equal(called.structuredContent.schemaVersion, 2);
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
      arguments: { prompt: '런타임 실패를 재현해라.', repo_root: repoRoot },
    },
    {
      name: 'trace_symbol',
      arguments: { symbol: 'requireAuth', repo_root: repoRoot },
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const { result: called, stderr } = await captureStderr(() => handleRequest({
        jsonrpc: '2.0',
        id: 100 + index,
        method: 'tools/call',
        params: testCase,
      }));

    assert.equal(called.isError, true, `${testCase.name} must return an MCP tool error`);
    assert.match(called.content[0].text, /provider (?:failed|was unavailable)/i);
    assert.doesNotMatch(called.content[0].text, /provider exploded/);
    assert.doesNotMatch(called.content[0].text, /Invalid arguments for/);
    assert.match(stderr.trim(), new RegExp(`tool=${testCase.name} .* failure=provider_error$`));
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

test('explore_repo and wrappers expose _meta.ops without touching structuredContent (spec 025)', async () => {
  const repoRoot = await makeRepoFixture();

  for (const [toolName, args] of [
    ['explore_repo', { task: 'users/me 라우트 인증 추적', repo_root: repoRoot, scope: ['src/**'] }],
    ['find_relevant_code', { query: 'auth middleware wiring', repo_root: repoRoot }],
  ]) {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: { chatClient: new MockChatClient() },
    });
    await handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
    });
    const called = await handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

    assert.ok(called._meta?.ops, `${toolName} response must carry _meta.ops (spec 025)`);
    assert.equal(typeof called._meta.ops.stats?.turns, 'number', `${toolName} ops.stats.turns`);
    assert.equal(typeof called._meta.ops.stats?.toolCalls, 'number', `${toolName} ops.stats.toolCalls`);
    assert.ok('transcriptPath' in called._meta.ops, `${toolName} ops.transcriptPath key`);
    // FR-001 contract freeze: the side-channel must not leak into the answer payload.
    assert.equal(called.structuredContent.stats, undefined);
    assert.equal(called.structuredContent.transcriptPath, undefined);
    assert.equal(called.structuredContent._debug, undefined);
  }
});

// T033 activates this transport-to-runtime cancellation matrix after the
// semantic verifier and repair stages exist end to end.
const mcpPipelineCancellationTest = test;
const CANCELLATION_TASK = 'Locate requireAuth and trace legacyGuard usage.';

function cancellationControlStage(request, verifierFinished) {
  const wrapped = request.responseFormat?.json_schema;
  const schema = wrapped?.schema ?? wrapped;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (required.includes('taskSummary') && required.includes('subgoals')) return 'planner';
  if (required.includes('goals') && required.includes('uncoveredRequestParts')) return 'auditor';
  if (required.includes('claims')) return 'claim_synthesis';
  if (required.includes('verdicts') && required.includes('uncoveredRequestParts')) {
    return 'verifier';
  }
  if (request.responseFormat) return 'legacy_synthesis';
  return verifierFinished ? 'repair' : 'explorer';
}

function cancellationCompletion(value, toolCalls = []) {
  return {
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    message: {
      content: typeof value === 'string' ? value : JSON.stringify(value),
      toolCalls,
    },
  };
}

class BlockingPipelineClient {
  constructor(cancelAt) {
    this.model = 'zai-glm-4.7';
    this.cancelAt = cancelAt;
    this.labels = [];
    this.signals = new Set();
    this.explorerCalls = 0;
    this.verifierFinished = false;
    this.reached = new Promise(resolve => { this.resolveReached = resolve; });
    this.goals = [
      {
        id: 'S-definition',
        question: 'Where is requireAuth defined?',
        originRefs: ['request:0-18'],
        claimType: 'symbol_definition',
        proofCondition: 'Observe the definition and current source body.',
        constraints: [],
      },
      {
        id: 'S-usage',
        question: 'Where is legacyGuard used?',
        originRefs: ['request:23-46'],
        claimType: 'symbol_usage',
        proofCondition: 'Cross-check exact and symbolic usage within src/**.',
        constraints: ['Keep the fixed src/** scope.'],
      },
    ];
    this.claims = [
      {
        id: 'C-definition',
        subgoalId: 'S-definition',
        text: 'requireAuth is defined in src/auth.js. STALE_SUPPORTED_SENTINEL',
        evidenceRefs: ['E1'],
      },
      {
        id: 'C-usage',
        subgoalId: 'S-usage',
        text: 'legacyGuard has no exact textual usage in src/**. STALE_CANDIDATE_SENTINEL',
        evidenceRefs: ['E2'],
      },
    ];
  }

  blockUntilCancelled(request, stage) {
    this.targetSignal = request.signal;
    this.resolveReached(stage);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`cancellation did not reach ${stage}`)), 2_000);
      const abort = () => {
        clearTimeout(timer);
        const error = new Error(`cancelled at ${stage}`);
        error.name = 'AbortError';
        reject(error);
      };
      if (request.signal.aborted) abort();
      else request.signal.addEventListener('abort', abort, { once: true });
    });
  }

  async createChatCompletion(request) {
    this.signals.add(request.signal);
    const stage = cancellationControlStage(request, this.verifierFinished);
    this.labels.push(stage);
    if (stage === this.cancelAt) return this.blockUntilCancelled(request, stage);

    if (stage === 'planner') {
      return cancellationCompletion({
        taskSummary: 'STALE_PLANNER_SENTINEL',
        constraints: [],
        subgoals: this.goals,
      });
    }
    if (stage === 'auditor') {
      return cancellationCompletion({
        goals: this.goals.map(goal => ({
          proposedGoalId: goal.id,
          verdict: 'ready',
          originRefs: goal.originRefs,
          missingRequestParts: [],
          reason: 'STALE_AUDITOR_SENTINEL',
        })),
        uncoveredRequestParts: [],
      });
    }
    if (stage === 'explorer') {
      this.explorerCalls += 1;
      if (this.explorerCalls === 1) {
        return cancellationCompletion('', [{
          id: 'read-auth',
          function: {
            name: 'repo_read_file',
            arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
          },
        }]);
      }
      if (this.explorerCalls === 2) {
        return cancellationCompletion('', [{
          id: 'grep-legacy',
          function: {
            name: 'repo_grep',
            arguments: JSON.stringify({ pattern: 'legacyGuard', scope: ['src/**'] }),
          },
        }]);
      }
      return cancellationCompletion('STALE_EXPLORER_SENTINEL');
    }
    if (stage === 'legacy_synthesis') {
      return cancellationCompletion({
        directAnswer: 'STALE_EXPLORER_SENTINEL',
        status: {
          confidence: 'low',
          verification: 'follow_up_needed',
          complete: false,
          warnings: [],
        },
        targets: [],
        evidence: [],
        uncertainties: [],
        nextAction: { type: 'stop', reason: 'Evidence pass complete.' },
      });
    }
    if (stage === 'claim_synthesis') {
      return cancellationCompletion({ claims: this.claims });
    }
    if (stage === 'verifier') {
      this.verifierFinished = true;
      return cancellationCompletion({
        verdicts: [
          {
            claimId: 'C-definition',
            result: 'supported',
            resolution: 'affirmed',
            supportingEvidenceRefs: ['E1'],
            reasonCode: 'entailed',
            note: 'Definition supported.',
          },
          {
            claimId: 'C-usage',
            result: 'insufficient',
            supportingEvidenceRefs: [],
            reasonCode: 'semantic_mismatch',
            note: 'A symbolic cross-check is still required.',
          },
        ],
        uncoveredRequestParts: [],
      });
    }
    assert.fail(`unexpected pre-cancellation stage: ${stage}`);
  }
}

async function waitForCancellationStage(client, stage) {
  let timer;
  try {
    return await Promise.race([
      client.reached,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`runtime never reached ${stage}`)), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

mcpPipelineCancellationTest(
  'Spec 028 T027 — MCP cancellation reaches planner, auditor, explorer, verifier, and repair',
  async t => {
    for (const [index, cancelAt] of [
      'planner',
      'auditor',
      'explorer',
      'verifier',
      'repair',
    ].entries()) {
      await t.test(cancelAt, async () => {
        const repoRoot = await makeRepoFixture();
        const logs = [];
        const client = new BlockingPipelineClient(cancelAt);
        const { handleRequest, handleNotification } = createMcpRequestHandler({
          logger: line => logs.push(line),
          runtimeOptions: { chatClient: client },
        });
        const requestId = index === 0 ? 0 : 100 + index;
        const pending = handleRequest({
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: {
            name: 'explore_repo',
            arguments: {
              task: CANCELLATION_TASK,
              repo_root: repoRoot,
              scope: ['src/**'],
            },
          },
        });

        assert.equal(await waitForCancellationStage(client, cancelAt), cancelAt);
        assert.equal(client.targetSignal.aborted, false);
        await handleNotification({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId },
        });
        assert.equal(client.targetSignal.aborted, true);

        const called = await pending;
        assert.equal(client.signals.size, 1,
          'every provider stage must receive the MCP-created signal');
        assert.equal(client.labels.at(-1), cancelAt);
        assert.equal(called.structuredContent.failure?.reason, 'aborted');
        assert.equal(called.structuredContent.failure?.retry ?? null, null);
        assert.equal(
          called.structuredContent.state === 'failed'
            || called.structuredContent.status?.complete === false,
          true,
          'an aborted request must never project a complete result',
        );
        assert.equal(called.structuredContent.evidence?.length ?? 0, 0);
        assert.equal(called.structuredContent.targets?.length ?? 0, 0);
        assert.doesNotMatch(JSON.stringify(called), /STALE_[A-Z_]+/);
        assert.match(called.content?.[0]?.text ?? '', /abort|cancel/i);

        await handleNotification({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId },
        });
        assert.equal(logs.filter(line =>
          line.includes(`Cancelled exploration for request ${requestId}`)).length, 1,
        'a completed cancellation must remove the active controller');
      });
    }
  },
);
