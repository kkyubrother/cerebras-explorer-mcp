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
  'explore_repo',
];

const TARGET_SIX_TOOL_NAMES = [
  'find_relevant_code',
  'trace_symbol',
  'map_change_impact',
  'explain_code_path',
  'collect_evidence',
  'explore_repo',
];

const TARGET_DISPATCH_RULE =
  'Need locations → find_relevant_code; Know the symbol → trace_symbol; ' +
  'Plan a change → map_change_impact; Need an execution/data path → explain_code_path; ' +
  'Need to verify one claim → collect_evidence; Anything else → explore_repo.';

const TARGET_TOOL_DESCRIPTIONS = Object.freeze({
  find_relevant_code:
    'Use when locating unknown implementation, configuration, test, or route positions. Do not use when the exact location is already known.',
  trace_symbol:
    'Use when explaining a known function, class, type, or variable and its usages. Do not use for unknown-symbol discovery or execution-flow tracing.',
  map_change_impact:
    'Use before a planned change to identify its blast radius. Do not use for a one-line edit in a known file.',
  explain_code_path:
    'Use when tracing an ordered request, event, job, CLI, or data flow. Do not use for static single-symbol usage.',
  collect_evidence:
    'Use when supporting or refuting an existing claim or hypothesis. Do not use for broad discovery without a claim.',
  explore_repo:
    'Use for repository investigations not clearly covered by another tool. Do not use it to control search tactics or effort.',
});

// Test-first activation point: T055 flips this only after exact descriptions
// and initialization instructions land. The assertions below never self-skip
// based on the quality they are meant to enforce.
const T055_SURFACE_TEXT_LANDED = true;

const EXPECTED_WRAPPER_TOOL_NAMES = EXPECTED_PUBLIC_TOOL_NAMES.filter(
  name => name !== 'explore_repo' && name !== 'explore',
);

const REMOVED_SPEC_013_TOOL_NAMES = [
  ['map', 'impact'].join('_'),
  ['find', 'entrypoints'].join('_'),
];

test('spec 022 execution provenance describes the live public registry', () => {
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
  assert.equal(provenance.serverVersion, '0.9.0');
  assert.equal(provenance.packageVersion, '0.9.0');
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

async function surfaceWithEnv(envPatch) {
  const restore = applyEnvPatch(envPatch);
  try {
    const { handleRequest } = createMcpRequestHandler();
    const listed = await handleRequest({
      jsonrpc: '2.0',
      id: 98,
      method: 'tools/list',
      params: {},
    });
    return {
      tools: listed.tools,
      provenance: buildExecutionProvenance({ gitSha: 'abc1234' }),
    };
  } finally {
    restore();
  }
}

function isTargetSixToolSurface(tools) {
  return JSON.stringify(tools.map(tool => tool.name)) === JSON.stringify(TARGET_SIX_TOOL_NAMES);
}

function sixToolSurfaceTest(name, callback) {
  test(name, async t => {
    const tools = await listToolsWithEnv({});
    if (!isTargetSixToolSurface(tools)) {
      t.todo('awaiting the six-tool implementation');
      return;
    }
    await callback({ tools, t });
  });
}

sixToolSurfaceTest('Spec 028 T045 — tools/list and provenance use one stable six-tool order', async ({ tools }) => {
  assert.deepEqual(tools.map(tool => tool.name), TARGET_SIX_TOOL_NAMES);
  const provenance = buildExecutionProvenance({ gitSha: 'abc1234' });
  assert.equal(provenance.exposedToolCount, 6);
  assert.deepEqual(provenance.toolNames, TARGET_SIX_TOOL_NAMES);
  assert.match(provenance.toolRegistryHash, /^[0-9a-f]{64}$/);
  assert.equal(
    provenance.toolRegistryHash,
    buildExecutionProvenance({ gitSha: 'different-sha' }).toolRegistryHash,
    'registry hash must not depend on git state',
  );
});

sixToolSurfaceTest('Spec 028 T045 — legacy environment variables cannot change the six-tool registry', async () => {
  const legacyKeys = [
    'CEREBRAS_EXPLORER_EXTRA_TOOLS',
    'CEREBRAS_EXPLORER_ENABLE_EXPLORE',
    'CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2',
  ];
  const scenarios = [{}];
  for (let mask = 0; mask < 2 ** legacyKeys.length; mask += 1) {
    scenarios.push(Object.fromEntries(legacyKeys.map((key, index) =>
      [key, mask & (1 << index) ? 'true' : 'false'])));
  }
  for (const env of scenarios) {
    const { tools, provenance } = await surfaceWithEnv(env);
    assert.deepEqual(tools.map(tool => tool.name), TARGET_SIX_TOOL_NAMES);
    assert.deepEqual(provenance.toolNames, TARGET_SIX_TOOL_NAMES);
    assert.equal(provenance.exposedToolCount, 6);
    for (const tool of tools) assertReadOnlyAnnotations(tool);
  }
});

sixToolSurfaceTest('Spec 028 T045 — removed public tool names are listed nowhere and have no handler', async () => {
  const { handleRequest } = createMcpRequestHandler();
  for (const name of ['review_change_context', 'explore']) {
    await assert.rejects(
      handleRequest({
        jsonrpc: '2.0',
        id: 45,
        method: 'tools/call',
        params: { name, arguments: {} },
      }),
      new RegExp(`Unknown tool: ${name}`),
    );
  }
});

test('Spec 028 T045 — retained tool descriptions have one trigger and one boundary', async t => {
  if (!T055_SURFACE_TEXT_LANDED) {
    t.todo('T055 activates exact description fixtures');
    return;
  }
  const tools = await listToolsWithEnv({});
  assert.deepEqual(tools.map(tool => tool.name), TARGET_SIX_TOOL_NAMES);
  for (const tool of tools) {
    assert.equal(tool.description, TARGET_TOOL_DESCRIPTIONS[tool.name], tool.name);
  }
});

test('Spec 028 T045 — initialization contains one concise six-way dispatch rule', async t => {
  if (!T055_SURFACE_TEXT_LANDED) {
    t.todo('T055 activates exact initialization fixtures');
    return;
  }
  const { handleRequest } = createMcpRequestHandler();
  const initialized = await handleRequest({
    jsonrpc: '2.0',
    id: 46,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {} },
  });
  assert.ok(initialized.instructions.includes(TARGET_DISPATCH_RULE));
  assert.match(initialized.instructions, /use complete directly/);
  assert.match(initialized.instructions, /inspect only targets for verify_targets/);
  assert.match(
    initialized.instructions,
    /for incomplete, use supported partial facts, inspect only returned targets when present/iu,
  );
  assert.ok(initialized.instructions.length <= 800);
  assert.doesNotMatch(initialized.instructions, /review_change_context|Markdown report|status\.verification/);
  for (const name of TARGET_SIX_TOOL_NAMES) {
    assert.equal(initialized.instructions.split(name).length - 1, 1, name);
  }
});

test('Spec 028 T045 — MCP rejects hints.strategy as invalid arguments before provider use', async () => {
  const tools = await listToolsWithEnv({});
  const exploreRepoTool = tools.find(tool => tool.name === 'explore_repo');
  assert.equal(exploreRepoTool?.inputSchema?.properties?.hints?.properties?.strategy, undefined);
  let providerCalls = 0;
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: {
        model: 'must-not-run',
        async createChatCompletion() {
          providerCalls += 1;
          throw new Error('provider must not be called for invalid arguments');
        },
      },
    },
  });
  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 47,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: { task: 'Trace auth.', hints: { strategy: 'symbol-first' } },
    },
  });
  assert.equal(called.isError, true);
  assert.equal(called.structuredContent?.state, 'failed');
  assert.equal(called.structuredContent?.failure?.reason, 'invalid_arguments');
  assert.equal(called._meta, undefined);
  assert.equal(providerCalls, 0);
});

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
    /evidenceQuality|searchCoverage|critic|confidence|taskContract|auditBinding|coverageGaps|stats|transcriptPath|toolTrace/);
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
  assert.equal(initialized.serverInfo.version, '0.9.0');

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
  assert.ok(!toolNames.includes('review_change_context'), 'review_change_context was removed in T048');
  assert.ok(!toolNames.includes('explain_symbol'), 'removed shortcut explain_symbol must not be exposed');
  assert.ok(!toolNames.includes('trace_dependency'), 'removed shortcut trace_dependency must not be exposed');
  assert.ok(!toolNames.includes('summarize_changes'), 'removed shortcut summarize_changes must not be exposed');
  assert.ok(!toolNames.includes('find_similar_code'), 'removed shortcut find_similar_code must not be exposed');
  assert.ok(!toolNames.includes('explore_v2'), 'explore_v2 tool name was removed in spec 011');
  const exploreRepoTool = listed.tools.find(t => t.name === 'explore_repo');
  // spec 017: session input parameter was removed; description no longer
  // mentions it.
  assert.doesNotMatch(exploreRepoTool.description, /sessionId/);
  assert.equal(exploreRepoTool.inputSchema.properties.session, undefined,
    'spec 017: session input parameter was removed');
  assert.ok(exploreRepoTool.outputSchema.properties.targets, 'explore_repo must expose outputSchema targets');
  assert.equal(exploreRepoTool.outputSchema.additionalProperties, false);
  assert.equal(exploreRepoTool.outputSchema.properties.answer, undefined);
  const exploreTool = listed.tools.find(t => t.name === 'explore');
  assert.equal(exploreTool, undefined, 'report-only explore was removed in T049');
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

  assert.equal(called.structuredContent.schemaVersion, 3);
  assert.equal(called.structuredContent.state, 'complete');
  assert.match(called.structuredContent.directAnswer, /requireAuth/);
  assert.equal(called.structuredContent.answer, undefined);
  assert.equal(called.structuredContent.candidatePaths, undefined);
  assert.equal(called.structuredContent.citations, undefined);
  assert.equal(called.structuredContent.stats, undefined);
  assert.equal(called.structuredContent.evidence.length, 1,
    'the parent receives only the minimal claim-cover evidence');
  assert.ok(called.structuredContent.evidence.every(item => item.kind === 'source'));
  // spec 017: MCP response no longer exposes sessionId, session, or _debug.
  assert.equal(called.structuredContent.sessionId, undefined);
  assert.equal(called.structuredContent.session, undefined);
  assert.equal(called.structuredContent._debug, undefined);
  assert.equal(called.structuredContent.taskContract, undefined);
  assert.equal(called.structuredContent.coverageGaps, undefined);
  assert.equal(called.structuredContent.rejectedGoals, undefined);
  assert.equal(called.structuredContent.goalAuditRecords, undefined);
  assert.equal(called.structuredContent.auditBinding, undefined);
  assert.equal(called.structuredContent.deterministicCounts, undefined);
  assert.equal(called.structuredContent.observations, undefined);
  assert.equal(called.structuredContent.semanticVerification, undefined);
  assert.equal(called.structuredContent.plan_proposed, undefined);
  assert.equal(called.structuredContent.goal_audit, undefined);
  assert.equal(called.structuredContent.status, undefined);
  assert.equal(called.structuredContent.failure, undefined);
  assert.equal(called.structuredContent.critic, undefined);
  assert.equal(called.structuredContent.evidenceQuality, undefined);
  assert.equal(called.structuredContent.searchCoverage, undefined);
  assert.equal(called._meta, undefined);
  const serializedMcpResult = JSON.stringify(called);
  for (const sentinel of Object.values(rejectedSentinel)) {
    assert.equal(serializedMcpResult.includes(sentinel), false,
      `rejected planning sentinel leaked through MCP: ${sentinel}`);
  }
  assert.doesNotMatch(serializedMcpResult,
    /taskContract|auditBinding|coverageGaps|rejectedGoals|goalAuditRecords|deterministicCounts|normalizedItemIds|observations|semanticVerification|runtimeAllowedEvidenceRefsBySubgoal|plan_proposed|goal_audit|plan_revised|goal_rejected|subgoal_state/);
  assert.match(called.content[0].text, /requireAuth/);
  assert.equal(called.content[0].text, called.structuredContent.directAnswer);
  assert.doesNotMatch(called.content[0].text, /Evidence Quality/);
  assert.doesNotMatch(called.content[0].text, /Search Coverage/);
  assert.doesNotMatch(called.content[0].text, /## Targets/);
  assert.doesNotMatch(called.content[0].text, /snippet:/);
  assert.doesNotMatch(called.content[0].text, /export function requireAuth/);
  assert.doesNotMatch(called.content[0].text, /FORGED_BY_MODEL/);
  assert.ok(called.structuredContent.evidence.every(item =>
    !JSON.stringify(item).includes('FORGED_BY_MODEL')), 'model-supplied snippets are not returned');
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

    assert.equal(called.structuredContent.schemaVersion, 3);
    assert.equal(called.structuredContent.state, 'complete');
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
    assert.match(lines[0], /^\[cerebras-explorer\] tool=explore_repo turns=\d+ toolCalls=\d+ safetyLimits=\d+ elapsed=\d+s$/);
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
    assert.match(line, /^\[cerebras-explorer\] tool=explore_repo turns=\d+ toolCalls=\d+ safetyLimits=\d+ elapsed=\d+s log=.+\.jsonl$/);
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
    assert.match(stderr.trim(), /^\[cerebras-explorer\] tool=explore_repo turns=0 toolCalls=0 safetyLimits=0 elapsed=0s failure=provider_error$/);
  } finally {
    restore();
  }
});

test('011 US1 — explore tool name explore_v2 is not exposed under any env', async () => {
  const repoRoot = await makeRepoFixture();
  // Even with the legacy opt-in envvar set, the explore_v2 tool name must not appear.
  const restore = applyEnvPatch({ CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2: 'true' });
  try {
    const { handleRequest } = createMcpRequestHandler();
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

test('Spec 028 T048 — review_change_context is neither listed nor callable', async () => {
  const { handleRequest } = createMcpRequestHandler();
  const listed = await handleRequest({ jsonrpc: '2.0', id: 20, method: 'tools/list' });
  assert.equal(listed.tools.some(tool => tool.name === 'review_change_context'), false);
  await assert.rejects(
    handleRequest({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'review_change_context',
        arguments: { reviewGoal: 'Inspect the current diff.' },
      },
    }),
    /Unknown tool: review_change_context/,
  );
});

test('Spec 028 T049 — report-only explore is neither listed nor callable', async () => {
  const { handleRequest } = createMcpRequestHandler();
  const listed = await handleRequest({ jsonrpc: '2.0', id: 22, method: 'tools/list' });
  assert.equal(listed.tools.some(tool => tool.name === 'explore'), false);
  await assert.rejects(
    handleRequest({
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: {
        name: 'explore',
        arguments: { prompt: 'Write a Markdown report.' },
      },
    }),
    /Unknown tool: explore/,
  );
});

test('collect_evidence wrapper uses evidence verification mode instead of edit regex fallback', async () => {
  const repoRoot = await makeRepoFixture();
  const baseClient = new MockChatClient();
  const providerRequests = [];
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: {
        model: baseClient.model,
        async createChatCompletion(request) {
          providerRequests.push(request);
          return baseClient.createChatCompletion(request);
        },
      },
    },
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

  assert.equal(called.structuredContent.schemaVersion, 3);
  assert.equal(called.structuredContent.state, 'incomplete');
  assert.notEqual(called.structuredContent.state, 'verify_targets');
  assert.ok(called.structuredContent.gaps.length > 0);
  const providerText = providerRequests
    .flatMap(request => request.messages ?? [])
    .map(message => typeof message.content === 'string' ? message.content : '')
    .join('\n');
  assert.match(providerText,
    /Verify this claim with repository evidence: update code behavior is already documented/u);
  assert.doesNotMatch(providerText, /compact evidence bundle|with snippets|Mark uncertainties/u);
});

test('MCP request handler declares read-only annotations for the current public surface', async () => {
  // The current public registry is invariant under every removed surface toggle.
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
      `${scenario.name}: public registry must ignore legacy surface envvars`,
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
  assert.equal(called.structuredContent.failure.reason, 'repo_mismatch');
  // F7: clients may surface only content text on isError and drop structuredContent,
  // so the machine-readable reason must also appear in the text.
  assert.match(called.content[0].text, /Failure: repo_mismatch/i);
  assert.equal(called._meta, undefined);
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
  assert.equal(called.structuredContent.schemaVersion, 3);
  assert.equal(called.structuredContent.state, 'failed');
  assert.equal(called.structuredContent.failure.reason, 'invalid_arguments');
  assert.equal(called.structuredContent.failure.retry, undefined);
  assert.equal(called._meta, undefined);
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
      assert.equal(called.structuredContent.failure.reason, 'invalid_arguments');
      assert.equal(called.structuredContent.schemaVersion, 3);
      assert.equal(called.structuredContent.state, 'failed');
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
  assert.equal(called.structuredContent.schemaVersion, 3);
  assert.equal(called.structuredContent.state, 'failed');
  assert.equal(called.structuredContent.failure.reason, 'provider_error');
  assert.equal(called.structuredContent.failure.retry.type, 'tool');
  assert.equal(called.structuredContent.failure.retry.tool, 'explore_repo');
  assert.deepEqual(called.structuredContent.failure.retry.arguments, {
    task: 'Retry after the provider recovers, or narrow the task and scope.',
  });
  assert.equal(called.structuredContent.failure.retry.args, undefined);
  assert.equal(called.structuredContent.failure.retry.hints, undefined);
  assert.equal(called.structuredContent.failure.retry.expectedImprovement, undefined);
  assert.equal(called._meta, undefined);
});

test('MCP request handler returns execution failures for exposed wrapper tools as MCP errors', async () => {
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

  const cases = [{
    name: 'trace_symbol',
    arguments: { symbol: 'requireAuth', repo_root: repoRoot },
  }];

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

test('explore_repo and wrappers keep operational diagnostics out of the parent response', async () => {
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

    assert.equal(called._meta, undefined, `${toolName} response must keep _meta quiet`);
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
