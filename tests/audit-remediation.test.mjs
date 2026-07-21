import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RepoToolkit, isCatastrophicRegexPattern, statPathDenied } from '../src/explorer/repo-tools.mjs';
import { getRuntimeConfig } from '../src/explorer/config.mjs';

// ── F3: ReDoS-prone patterns are detected before the JS grep fallback runs ────
test('F3 — isCatastrophicRegexPattern flags nested-quantifier ReDoS patterns', () => {
  for (const pattern of ['(a+)+$', '(a*)*', '(.*)*', '(a+)*', '([a-z]+)+$']) {
    assert.equal(isCatastrophicRegexPattern(pattern), true, `must flag catastrophic: ${pattern}`);
  }
});

test('F3 — isCatastrophicRegexPattern leaves ordinary patterns alone', () => {
  for (const pattern of ['foo.*bar', 'function\\s+\\w+', '\\bclass\\b', 'a+b*c', 'export (default )?function']) {
    assert.equal(isCatastrophicRegexPattern(pattern), false, `must not flag ordinary: ${pattern}`);
  }
});

test('F3 — grep rejects a catastrophic pattern on the base-scope fallback path instead of blocking', async () => {
  // Base scope (a concrete path) forces the JS fallback (ripgrep is skipped), which
  // is the only place a model-supplied catastrophic pattern can block the event loop.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-f3-'));
  await fs.writeFile(path.join(root, 'evil.txt'), `${'a'.repeat(45)}!\n`);
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
  await toolkit.initialize(['evil.txt']);

  await assert.rejects(
    () => toolkit.grep({ pattern: '(a+)+$', scope: ['evil.txt'] }),
    /catastrophic backtracking|Pattern rejected/i,
    'a nested-quantifier pattern must be rejected on the fallback path, not executed',
  );

  // A safe pattern on the same fallback path must still work.
  const ok = await toolkit.grep({ pattern: 'aaa', scope: ['evil.txt'] });
  assert.ok(ok.matches.length >= 1, 'ordinary patterns must still match on the fallback path');
});

// ── F6: git --stat rename forms must not leak secret paths via brace prefix loss ─
test('F6 — statPathDenied reconstructs git brace-rename paths so secrets are not leaked', () => {
  // git --stat writes renames as `prefix/{old => new}`; a naive split drops the
  // shared prefix from the `new` side, so `.aws/credentials` was previously missed.
  const mustDeny = [
    // Prefix-loss leaks: the real `new` path is secret but old/basename are not.
    '.git/{config.bak => config}',           // -> .git/config (denied by path, not basename)
    '.aws/{settings => credentials}',        // -> .aws/credentials (denied by path, not basename)
    // Already-caught forms kept for coverage:
    'src/{x => credentials.json}',           // -> src/credentials.json (basename)
    'config/{old.txt => service-account.json}', // -> config/service-account.json (F1 deny)
  ];
  for (const p of mustDeny) {
    assert.equal(statPathDenied(p), true, `must deny secret rename form: ${p}`);
  }
  // Ordinary renames must still be allowed.
  assert.equal(statPathDenied('src/{a.ts => b.ts}'), false);
  assert.equal(statPathDenied('README.md'), false);
});
