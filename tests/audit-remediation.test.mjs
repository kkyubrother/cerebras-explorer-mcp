import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isIntentOnlyFreeExploreReport } from '../src/explorer/runtime.mjs';
import { RepoToolkit, isCatastrophicRegexPattern, statPathDenied } from '../src/explorer/repo-tools.mjs';
import { buildFreeExploreSystemPrompt } from '../src/explorer/prompt.mjs';
import { getRuntimeConfig } from '../src/explorer/config.mjs';

// ── F2: intent-only report detection must cover CJK/Korean preambles ──────────
test('F2 — isIntentOnlyFreeExploreReport detects Korean intent-only preambles', () => {
  const intentOnly = [
    '보고서를 작성하겠습니다. 충분한 정보를 수집했습니다.',
    '충분한 정보를 수집했습니다.',
    '이제 보고서를 정리하겠습니다.',
    '필요한 증거를 모두 확보했습니다. 보고서를 작성하겠습니다.',
  ];
  for (const text of intentOnly) {
    assert.equal(isIntentOnlyFreeExploreReport(text), true, `must flag intent-only: ${text}`);
  }
});

test('F2 — isIntentOnlyFreeExploreReport keeps English detection and does not flag real reports', () => {
  assert.equal(isIntentOnlyFreeExploreReport('I have enough evidence; let me write the report.'), true);
  // A real (short) Korean report with substantive content + a citation must NOT be flagged.
  assert.equal(
    isIntentOnlyFreeExploreReport('이 프로젝트는 PostgreSQL을 사용합니다 (prisma/schema.prisma:5-8). 모델은 User, Company 등입니다.'),
    false,
    'a grounded report with citations must not be treated as intent-only',
  );
});

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

// ── F4: truncation-marker prompt names the markers the runtime actually emits ─
test('F4 — freeExplore system prompt references real truncation markers (no stale literals)', () => {
  const prompt = buildFreeExploreSystemPrompt({
    repoRoot: '/tmp/example',
    budgetConfig: getRuntimeConfig(),
    language: undefined,
    projectContext: undefined,
    previousSummaries: [],
    keyFiles: [],
  });
  // The runtime never emits a bare "[summarized]" token; do not name it.
  assert.ok(!prompt.includes('"[summarized]"'), 'prompt must not name the non-existent "[summarized]" literal');
  // The runtime DOES emit "[truncated ...]" markers and a "summarized to save context" recovery note.
  assert.ok(prompt.includes('[truncated'), 'prompt should reference the real "[truncated...]" marker');
  assert.ok(prompt.includes('summarized to save context'), 'prompt should reference the real summary-recovery wording');
});
