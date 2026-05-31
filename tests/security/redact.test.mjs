import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { createMcpRequestHandler } from '../../src/mcp/server.mjs';
import { getBudgetConfig } from '../../src/explorer/config.mjs';
import { RepoToolkit } from '../../src/explorer/repo-tools.mjs';
import { redactText, redactValue } from '../../src/explorer/redact.mjs';

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

test('MCP explore_repo redacts provider-facing messages, content text, structuredContent, evidence, and debug', async () => {
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

  const chatClient = new RedactionClient();
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
  assert.equal(called.structuredContent.evidence[0].redacted, true);
  assert.deepEqual(called.structuredContent.evidence[0].redactions, ['openai-api-key']);
});

test('MCP explore Markdown reports are redacted', async () => {
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

  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
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
