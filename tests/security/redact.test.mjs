import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import * as mcpServerModule from '../../src/mcp/server.mjs';
import { createMcpRequestHandler } from '../../src/mcp/server.mjs';
import { getRuntimeConfig } from '../../src/explorer/config.mjs';
import { RepoToolkit } from '../../src/explorer/repo-tools.mjs';
import { redactText, redactValue } from '../../src/explorer/redact.mjs';
import { createTranscriptRecorder } from '../../src/explorer/transcript.mjs';
import { adaptLegacyGoalAuditClient } from '../helpers/legacy-goal-audit-client.mjs';

const execFileAsync = promisify(execFile);
const joinSecretParts = (...parts) => parts.join('');
const OPENAI_KEY = joinSecretParts('sk', '-proj-', 'abcdefghijklmnopqrstuvwxyz1234567890');
const GITHUB_PAT = joinSecretParts('gh', 'p_', 'a'.repeat(40));
const JWT = joinSecretParts('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjMifQ', '.', 'signature_part');
const PRIVATE_KEY = [
  joinSecretParts('-----BEGIN ', 'PRIVATE KEY-----'),
  'MIIEvAIBADANBgkqhkiG9w0BAQEFAASC',
  joinSecretParts('-----END ', 'PRIVATE KEY-----'),
].join('\n');
const PRIVATE_KEY_LABELS = [
  'PRIVATE KEY',
  'RSA PRIVATE KEY',
  'OPENSSH PRIVATE KEY',
  'EC PRIVATE KEY',
  'DSA PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
];

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function makeRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-redact-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'config.js'), `export const key = "${OPENAI_KEY}";\n`);
  return root;
}

function withEnvPatch(patch, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function v3RedactionMcpTest(name, callback) {
  const buildResponse = mcpServerModule.buildParentHandoffResponse;
  const register = typeof buildResponse === 'function' ? test : test.todo;
  register(name, () => {
    assert.equal(typeof buildResponse, 'function',
      'buildParentHandoffResponse is not implemented');
    return callback(buildResponse);
  });
}

test('redactText covers core secret patterns and leaves generic hex off by default', () => {
  const genericHex = '0123456789abcdef0123456789abcdef';
  const input = [
    joinSecretParts('AKIA', '1234567890ABCDEF'),
    GITHUB_PAT,
    OPENAI_KEY,
    joinSecretParts('AI', 'za', 'A'.repeat(35)),
    joinSecretParts('xox', 'b-', '1234567890-abcdefghijkl'),
    joinSecretParts('sk', '-ant-', 'abcdefghijklmnopqrstuvwxyz123456'),
    joinSecretParts('sk', '_live_', '1234567890abcdefghijklmn'),
    JWT,
    PRIVATE_KEY,
    genericHex,
  ].join('\n');

  const result = redactText(input);
  assert.ok(result.redacted);
  for (const rule of [
    'aws-access-key',
    'github-token',
    'openai-api-key',
    'gcp-api-key',
    'slack-token',
    'anthropic-api-key',
    'stripe-live-secret',
    'jwt',
    'private-key-block',
  ]) {
    assert.ok(result.redactions.includes(rule), `${rule} must be reported`);
    assert.match(result.text, new RegExp(`\\[REDACTED:${rule}\\]`));
  }
  assert.match(result.text, new RegExp(genericHex), 'generic hex must not be redacted by default');
});

test('redactText covers common PEM private key block labels', () => {
  for (const label of PRIVATE_KEY_LABELS) {
    const block = [
      `-----BEGIN ${label}-----`,
      'MIIEvAIBADANBgkqhkiG9w0BAQEFAASC',
      `-----END ${label}-----`,
    ].join('\n');

    const result = redactText(block);
    assert.ok(result.redacted, `${label} block must be redacted`);
    assert.deepEqual(result.redactions, ['private-key-block']);
    assert.equal(result.text, '[REDACTED:private-key-block]');
  }
});

test('F1 — redactText redacts an unclosed private key block whose END marker was truncated away', () => {
  // Evidence snippets truncate long lines/tool results before the final redaction
  // pass, so the matching -----END----- is frequently cut off. The key body must
  // still not survive (see audit finding F1: service-account private_key leak).
  const truncated = [
    `-----BEGIN ${joinSecretParts('PRIVATE ', 'KEY')}-----`,
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ' + 'C'.repeat(180),
    '... [truncated from 1753 chars to save context]',
  ].join('\n');

  const result = redactText(truncated);
  assert.ok(result.redacted, 'a BEGIN PRIVATE KEY block with no END must still be redacted');
  assert.ok(result.redactions.includes('private-key-block'), 'must report the private-key-block rule');
  assert.ok(!result.text.includes('MIIEvQIBAD'), 'private key body must not survive redaction');
});

test('F1 — redactText redacts a JSON-escaped service-account private key truncated mid-body', () => {
  // service-account JSON stores the key on one physical line with literal \n escapes;
  // a truncated evidence snippet keeps BEGIN + base64 but loses the END marker.
  const jsonSnippet =
    `"private_key": "-----BEGIN ${joinSecretParts('PRIVATE ', 'KEY')}-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw` +
    'ggSjAgEAAoIBAQ'.repeat(40);

  const result = redactText(jsonSnippet);
  assert.ok(result.redacted, 'JSON-escaped truncated private key must be redacted');
  assert.ok(!result.text.includes('MIIEvQIBAD'), 'private key body must not leak');
});

test('redactValue recursively redacts nested string fields', () => {
  const result = redactValue({
    content: `token=${OPENAI_KEY}`,
    nested: [{ patch: `+${GITHUB_PAT}` }],
  });
  assert.ok(result.redacted);
  assert.deepEqual(result.redactions.sort(), ['github-token', 'openai-api-key']);
  assert.ok(!JSON.stringify(result.value).includes(OPENAI_KEY));
  assert.ok(!JSON.stringify(result.value).includes(GITHUB_PAT));
});

test('Spec 028 T038 — v3 source, git, absence, gap, and failure values share one redaction boundary', () => {
  const raw = {
    text: `Found ${OPENAI_KEY} in config/.env`,
    source: {
      kind: 'source',
      path: '.env.production',
      startLine: 1,
      endLine: 1,
      supports: `The source contains ${OPENAI_KEY}.`,
      snippet: `1: token=${OPENAI_KEY}`,
    },
    git: {
      kind: 'git',
      sha: 'abc1234',
      path: '.npmrc',
      supports: `The commit mentions ${GITHUB_PAT}.`,
    },
    absence: {
      kind: 'absence',
      boundary: ['config/.env'],
      searches: [`text: ${OPENAI_KEY}`],
      supports: `No other ${OPENAI_KEY} was found.`,
    },
    gap: {
      question: `Whether ${OPENAI_KEY} exists elsewhere`,
      reason: 'The config/.env boundary was denied.',
    },
    failure: {
      reason: 'provider_error',
      retry: {
        type: 'tool',
        tool: 'explore_repo',
        arguments: {
          task: `Inspect ${OPENAI_KEY} without opening .env.production.`,
          hints: { files: ['config/.env'] },
        },
      },
    },
  };

  const redacted = redactValue(raw);
  const serialized = JSON.stringify(redacted.value);
  assert.equal(serialized.includes(OPENAI_KEY), false);
  assert.equal(serialized.includes(GITHUB_PAT), false);
  assert.equal(serialized.includes('.env.production'), false);
  assert.equal(serialized.includes('config/.env'), false);
  assert.match(serialized, /\[REDACTED:openai-api-key\]/);
  assert.match(serialized, /\[REDACTED:github-token\]/);
  assert.match(serialized, /\[REDACTED:secret-path\]/);
  assert.deepEqual(new Set(redacted.redactions), new Set([
    'openai-api-key',
    'github-token',
    'secret-path',
  ]));
});

v3RedactionMcpTest(
  'Spec 028 T046 — structured handoff redaction supersedes report-only redaction',
  (buildResponse) => {
    const handoff = {
      schemaVersion: 3,
      directAnswer: `The source, history, and bounded search mention ${OPENAI_KEY}.`,
      state: 'complete',
      evidence: [
        {
          kind: 'source',
          path: '.env.production',
          startLine: 1,
          endLine: 1,
          supports: `The source contains ${OPENAI_KEY}.`,
          snippet: `1: token=${OPENAI_KEY}`,
        },
        {
          kind: 'git',
          sha: 'abc1234',
          path: '.npmrc',
          supports: `The commit contains ${GITHUB_PAT}.`,
        },
        {
          kind: 'absence',
          boundary: ['config/.env'],
          searches: [`text: ${OPENAI_KEY}`],
          supports: `No other ${OPENAI_KEY} was found in config/.env.`,
        },
      ],
    };
    const response = buildResponse(handoff);
    const serialized = JSON.stringify(response);
    assert.equal(serialized.includes(OPENAI_KEY), false);
    assert.equal(serialized.includes(GITHUB_PAT), false);
    assert.equal(serialized.includes('.env.production'), false);
    assert.equal(serialized.includes('config/.env'), false);
    assert.match(response.content[0].text, /\[REDACTED:openai-api-key\]/);
    assert.match(serialized, /\[REDACTED:secret-path\]/);
    assert.equal(Object.hasOwn(response.structuredContent, 'report'), false,
      'the structured redaction contract must not depend on a Markdown report field');
    assert.equal(serialized.includes('"redacted"'), false,
      'redaction diagnostics stay outside the strict parent contract');
    assert.equal(serialized.includes('"redactions"'), false,
      'redaction diagnostics stay outside the strict parent contract');
  },
);

v3RedactionMcpTest(
  'Spec 028 T038 — v3 gaps, follow-ups, failures, and retries redact identically in MCP text and data',
  (buildResponse) => {
    const incomplete = buildResponse({
      schemaVersion: 3,
      state: 'incomplete',
      gaps: [{
        question: `Whether ${OPENAI_KEY} is active`,
        reason: 'The config/.env boundary is unavailable.',
      }],
      followUp: {
        type: 'external_verification',
        requirement: `Check ${OPENAI_KEY} outside config/.env.`,
      },
    });
    const failed = buildResponse({
      schemaVersion: 3,
      directAnswer: `Provider rejected ${OPENAI_KEY} before verification.`,
      state: 'failed',
      failure: {
        reason: 'provider_error',
        retry: {
          type: 'tool',
          tool: 'explore_repo',
          arguments: {
            task: `Retry without ${OPENAI_KEY}.`,
            hints: { files: ['config/.env'] },
          },
        },
      },
    });

    for (const response of [incomplete, failed]) {
      const serialized = JSON.stringify(response);
      assert.equal(serialized.includes(OPENAI_KEY), false);
      assert.equal(serialized.includes('config/.env'), false);
      assert.match(serialized, /\[REDACTED:openai-api-key\]/);
      assert.match(serialized, /\[REDACTED:secret-path\]/);
      assert.equal(response._meta, undefined);
    }
  },
);

test('Spec 028 T038 — operational JSONL redacts v3 payload-shaped diagnostics', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-v3-redact-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-v3-redact-log-'));

  await withEnvPatch({
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: undefined,
  }, async () => {
    const recorder = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_repo',
      task: 'verify v3 log redaction',
    });
    recorder.record('parent_handoff_diagnostic', {
      contentText: `Answer contains ${OPENAI_KEY}.`,
      structuredContent: {
        schemaVersion: 3,
        directAnswer: `Answer contains ${OPENAI_KEY}.`,
        state: 'complete',
        evidence: [{
          kind: 'git',
          sha: 'abc1234',
          path: '.npmrc',
          supports: `Commit contains ${GITHUB_PAT}.`,
        }],
      },
    });
    await recorder.finalize({ turns: 0, toolCalls: 0, elapsedMs: 0 });

    const serialized = await fs.readFile(recorder.filePath, 'utf8');
    assert.equal(serialized.includes(OPENAI_KEY), false);
    assert.equal(serialized.includes(GITHUB_PAT), false);
    assert.equal(serialized.includes('.npmrc'), false);
    assert.match(serialized, /\[REDACTED:openai-api-key\]/);
    assert.match(serialized, /\[REDACTED:github-token\]/);
    assert.match(serialized, /\[REDACTED:secret-path\]/);
  });
});

test('MCP explore_repo redacts provider-facing messages and strict v3 output without diagnostics', async () => {
  const repoRoot = await makeRepoFixture();

  class RedactionClient {
    constructor() {
      this.model = 'mock';
      this.calls = 0;
      this.providerMessages = '';
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          message: {
            content: '',
            toolCalls: [
              {
                id: 'call-read-config',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/config.js', startLine: 1, endLine: 1 }),
                },
              },
            ],
          },
        };
      }

      this.providerMessages = JSON.stringify(messages);
      assert.ok(!this.providerMessages.includes(OPENAI_KEY), 'provider-facing tool message must be redacted');
      assert.match(this.providerMessages, /\[REDACTED:openai-api-key\]/);
      return {
        message: {
          content: JSON.stringify({
            directAnswer: `The key is ${OPENAI_KEY}`,
            status: { confidence: 'high', verification: 'verified', complete: true, warnings: [] },
            targets: [
              { path: 'src/config.js', role: 'read', reason: `Line contains ${OPENAI_KEY}`, evidenceRefs: [] },
            ],
            evidence: [
              {
                path: 'src/config.js',
                startLine: 1,
                endLine: 1,
                why: `Line contains ${OPENAI_KEY}`,
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

  const chatClient = adaptLegacyGoalAuditClient(new RedactionClient());
  const { handleRequest } = createMcpRequestHandler({ runtimeOptions: { chatClient } });
  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: 'Inspect config key redaction.',
        repo_root: repoRoot,
        scope: ['src/**'],
      },
    },
  });

  const serialized = JSON.stringify(called);
  assert.ok(!serialized.includes(OPENAI_KEY), 'MCP result must not include raw secret');
  assert.match(serialized, /\[REDACTED:openai-api-key\]/);
  assert.equal(called.structuredContent.schemaVersion, 3);
  assert.equal(called.structuredContent.evidence[0].redacted, undefined);
  assert.equal(called.structuredContent.evidence[0].redactions, undefined);
  assert.equal(called._meta, undefined);
});

test.skip('MCP explore Markdown reports are redacted', async () => {
  class MarkdownClient {
    constructor() {
      this.model = 'mock';
    }

    async createChatCompletion() {
      return {
        message: {
          content: `Report mentions ${OPENAI_KEY}`,
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  // spec 011: explore_v2 tool name was removed; only `explore` is exercised here.
  const { handleRequest } = createMcpRequestHandler({ runtimeOptions: { chatClient: new MarkdownClient() } });
  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 'explore',
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: {
        prompt: 'Produce a report.',
        repo_root: repoRoot,
      },
    },
  });
  assert.ok(!JSON.stringify(called).includes(OPENAI_KEY), 'explore must redact Markdown output');
  assert.match(JSON.stringify(called), /\[REDACTED:openai-api-key\]/);
});

test('git diff and show patches are redacted', { skip: !hasGit() }, async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-redact-git-'));
  await execFileAsync('git', ['init'], { cwd: repoRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot });

  await fs.writeFile(path.join(repoRoot, 'config.js'), 'export const key = "none";\n');
  await execFileAsync('git', ['add', 'config.js'], { cwd: repoRoot });
  await execFileAsync('git', ['commit', '-m', 'base'], { cwd: repoRoot });

  await fs.writeFile(path.join(repoRoot, 'config.js'), `export const key = "${OPENAI_KEY}";\n`);
  await execFileAsync('git', ['add', 'config.js'], { cwd: repoRoot });
  await execFileAsync('git', ['commit', '-m', `add ${OPENAI_KEY}`], { cwd: repoRoot });

  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
  await toolkit.initialize();

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  assert.ok(!JSON.stringify(diff).includes(OPENAI_KEY));
  assert.match(JSON.stringify(diff), /\[REDACTED:openai-api-key\]/);

  const shown = await toolkit.gitShow({ ref: 'HEAD' });
  assert.ok(!JSON.stringify(shown).includes(OPENAI_KEY));
  assert.match(JSON.stringify(shown), /\[REDACTED:openai-api-key\]/);
});

// ── 010 — Spec-3: redaction preserves env var identifiers ─────────────────

test('010 US3#1 — redactText preserves process.env identifiers in code snippets', () => {
  const input = 'const key = process.env.CEREBRAS_API_KEY;';
  const result = redactText(input);
  assert.equal(result.text, input, 'process.env identifier must not be masked');
  assert.equal(result.redacted, false, 'no redactions should be reported');
});

test('010 US3#1b — redactText preserves import.meta.env and Deno.env.get identifiers', () => {
  for (const sample of [
    'const url = import.meta.env.VITE_API_URL;',
    'const tok = Deno.env.get("TOKEN");',
  ]) {
    const result = redactText(sample);
    assert.equal(result.text, sample, `identifier must be preserved: ${sample}`);
    assert.equal(result.redacted, false);
  }
});

test('010 US3#2 — redactText still redacts standalone secret env file paths', () => {
  const result = redactText('Read `.env.production:L1-L3` before debugging.');
  assert.match(result.text, /\[REDACTED:secret-path\]/);
  assert.equal(result.redacted, true);
});

test('010 US3#3 — redactText redacts secret values but not env var identifiers', () => {
  const value = `${joinSecretParts('sk', '-proj-', 'a'.repeat(40))}`;
  const result = redactText(`process.env.OPENAI_API_KEY = "${value}";`);
  assert.match(result.text, /process\.env\.OPENAI_API_KEY/, 'identifier must remain');
  assert.match(result.text, /\[REDACTED:openai-api-key\]/, 'value must be masked');
  assert.ok(!result.text.includes(value), 'raw secret value must not survive');
});

test('010 US3#4 — opt-in CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES masks identifiers', () => {
  const result = redactText('const key = process.env.CEREBRAS_API_KEY;', { includeEnvVarNames: true });
  assert.match(result.text, /process\.env\.\[REDACTED:env-var-name\]/);
  assert.ok(result.redactions.includes('env-var-name'));
});

test('010 US3 — backtick and punctuation boundaries leave identifiers intact', () => {
  for (const sample of [
    'use `process.env.A_KEY` for that flag.',
    'config: import.meta.env.VITE_X, import.meta.env.VITE_Y;',
    'fn(Deno.env.get("X"))',
  ]) {
    const result = redactText(sample);
    assert.equal(result.text, sample, `boundary regression: ${sample}`);
  }
});
