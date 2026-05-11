import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBudgetConfig, isSecretPath } from '../../src/explorer/config.mjs';
import { RepoToolkit } from '../../src/explorer/repo-tools.mjs';
import { exploreRepository } from '../../src/explorer/runtime.mjs';

const joinSecretParts = (...parts) => parts.join('');
const SECRET = joinSecretParts('sk', '-proj-', 'secret-deny-list-fixture');

async function makeSecretFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-secret-deny-'));
  await fs.mkdir(path.join(root, '.ssh'), { recursive: true });
  await fs.mkdir(path.join(root, '.aws'), { recursive: true });
  await fs.mkdir(path.join(root, 'secrets'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });

  await fs.writeFile(path.join(root, '.env'), `OPENAI_API_KEY=${SECRET}\n`);
  await fs.writeFile(path.join(root, '.env.local'), `LOCAL_KEY=${SECRET}\n`);
  await fs.writeFile(path.join(root, '.npmrc'), `//registry.npmjs.org/:_authToken=${SECRET}\n`);
  await fs.writeFile(path.join(root, '.ssh', 'id_rsa'), `${joinSecretParts('-----BEGIN ', 'OPENSSH PRIVATE KEY-----')}\n`);
  await fs.writeFile(path.join(root, '.aws', 'credentials'), `[default]\naws_secret_access_key=${SECRET}\n`);
  await fs.writeFile(path.join(root, 'secrets', 'app.pem'), `${joinSecretParts('-----BEGIN ', 'PRIVATE KEY-----')}\n`);
  await fs.writeFile(path.join(root, 'src', 'credentials.json'), `{"token":"${SECRET}"}\n`);
  await fs.writeFile(path.join(root, 'src', 'main.js'), 'export function visible() { return "ok"; }\n');
  return root;
}

test('secret path matcher covers default deny-list fixtures', () => {
  for (const relPath of [
    '.env',
    '.env.local',
    '.npmrc',
    '.ssh/id_rsa',
    '.aws/credentials',
    'secrets/app.pem',
    'src/credentials.json',
  ]) {
    assert.equal(isSecretPath(relPath).matched, true, `${relPath} must match the secret deny-list`);
  }
  assert.equal(isSecretPath('src/main.js').matched, false);
});

test('RepoToolkit excludes secret files from traversal, read, grep, symbols, and context enrichment', async () => {
  const root = await makeSecretFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('quick') });
  await toolkit.initialize(['**']);

  const walked = await toolkit.walkFiles({ scope: ['**'] });
  assert.ok(walked.files.includes('src/main.js'), 'normal files must still be visible');
  assert.ok(!walked.files.includes('.env'), '.env must be hidden from traversal');
  assert.ok(!walked.files.includes('src/credentials.json'), 'credentials.json must be hidden from traversal');

  const listed = await toolkit.listDirectory({ dirPath: '.', depth: 3 });
  const listedPaths = listed.entries.map(entry => entry.path);
  assert.ok(!listedPaths.includes('.env'), '.env must be hidden from directory listing');
  assert.ok(!listedPaths.includes('.ssh'), '.ssh must be hidden from directory listing');
  assert.ok(!listedPaths.includes('secrets'), 'secrets directory must be hidden from directory listing');

  const deniedRead = await toolkit.readFile({ path: '.env', startLine: 1, endLine: 5 });
  assert.equal(deniedRead.error, 'redacted_by_policy');
  assert.equal(deniedRead.reason, 'secret-deny-list');
  assert.equal(deniedRead.path, '.env');
  assert.ok(!JSON.stringify(deniedRead).includes(SECRET));

  const allowedRead = await toolkit.readFile({ path: 'src/main.js', startLine: 1, endLine: 5 });
  assert.match(allowedRead.content, /visible/);

  const grep = await toolkit.grep({ pattern: 'secret-deny-list-fixture', scope: ['**'] });
  assert.equal(grep.matches?.length ?? 0, 0, 'grep must not surface secret-file matches');

  const grepWithContext = await toolkit.callTool('repo_grep', {
    pattern: 'secret-deny-list-fixture',
    scope: ['**'],
    contextLines: 2,
  });
  assert.equal(grepWithContext.matches?.length ?? 0, 0, 'context enrichment must not re-read secret files');

  const deniedSymbols = await toolkit.symbols({ path: 'src/credentials.json' });
  assert.equal(deniedSymbols.error, 'redacted_by_policy');

  const symbolContext = await toolkit.symbolContext({ symbol: 'secret-deny-list-fixture', scope: ['**'] });
  assert.equal(symbolContext.callers.length, 0);
  assert.equal(symbolContext.definition, null);
});

test('secret deny-list can be disabled explicitly for local debugging', async () => {
  const previous = process.env.CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST;
  process.env.CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST = '1';
  try {
    const root = await makeSecretFixture();
    const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('quick') });
    await toolkit.initialize(['**']);
    const read = await toolkit.readFile({ path: '.env', startLine: 1, endLine: 5 });
    assert.match(read.content, new RegExp(SECRET));
  } finally {
    if (previous === undefined) delete process.env.CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST;
    else process.env.CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST = previous;
  }
});

test('deny-listed file content is blocked before provider-facing tool messages', async () => {
  const root = await makeSecretFixture();

  class SecretReadClient {
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
                id: 'call-read-secret',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: '.env', startLine: 1, endLine: 5 }),
                },
              },
            ],
          },
        };
      }

      this.providerMessages = JSON.stringify(messages);
      assert.ok(!this.providerMessages.includes(SECRET), 'provider-facing messages must not contain raw secret values');
      assert.match(this.providerMessages, /redacted_by_policy/);
      return {
        message: {
          content: JSON.stringify({
            answer: 'The secret file was denied by policy.',
            summary: 'Secret file content was not exposed.',
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

  const chatClient = new SecretReadClient();
  const result = await exploreRepository({
    task: 'Check whether secret files can be read.',
    repo_root: root,
    budget: 'quick',
  }, { chatClient });

  assert.ok(chatClient.calls >= 2);
  assert.ok(!chatClient.providerMessages.includes(SECRET));
  assert.ok(!JSON.stringify(result).includes(SECRET));
});
