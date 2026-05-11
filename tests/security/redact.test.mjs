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
            answer: `The key is ${OPENAI_KEY}`,
            summary: `Config contains ${OPENAI_KEY}`,
            confidence: 'high',
            evidence: [
              {
                path: 'src/config.js',
                startLine: 1,
                endLine: 1,
                why: `Line contains ${OPENAI_KEY}`,
              },
            ],
            candidatePaths: ['src/config.js'],
            followups: [],
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
        budget: 'quick',
      },
    },
  });

  const serialized = JSON.stringify(called);
  assert.ok(!serialized.includes(OPENAI_KEY), 'MCP result must not include raw secret');
  assert.match(serialized, /\[REDACTED:openai-api-key\]/);
  assert.equal(called.structuredContent.evidence[0].redacted, true);
  assert.deepEqual(called.structuredContent.evidence[0].redactions, ['openai-api-key']);
});

test('MCP explore and explore_v2 Markdown reports are redacted', async () => {
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
  const previous = process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2;
  process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2 = 'true';
  try {
    const { handleRequest } = createMcpRequestHandler({ runtimeOptions: { chatClient: new MarkdownClient() } });
    for (const name of ['explore', 'explore_v2']) {
      const called = await handleRequest({
        jsonrpc: '2.0',
        id: name,
        method: 'tools/call',
        params: {
          name,
          arguments: {
            prompt: 'Produce a report.',
            repo_root: repoRoot,
            thoroughness: 'quick',
          },
        },
      });
      assert.ok(!JSON.stringify(called).includes(OPENAI_KEY), `${name} must redact Markdown output`);
      assert.match(JSON.stringify(called), /\[REDACTED:openai-api-key\]/);
    }
  } finally {
    if (previous === undefined) delete process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2;
    else process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2 = previous;
  }
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

  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('quick') });
  await toolkit.initialize();

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  assert.ok(!JSON.stringify(diff).includes(OPENAI_KEY));
  assert.match(JSON.stringify(diff), /\[REDACTED:openai-api-key\]/);

  const shown = await toolkit.gitShow({ ref: 'HEAD' });
  assert.ok(!JSON.stringify(shown).includes(OPENAI_KEY));
  assert.match(JSON.stringify(shown), /\[REDACTED:openai-api-key\]/);
});
