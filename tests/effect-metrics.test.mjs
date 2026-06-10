import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { computeCaseEffectMetrics, verifyCitations } from '../src/benchmark/effect-metrics.mjs';

async function makeFixtureRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'effect-metrics-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    ['export function requireAuth(req) {', '  return req.user != null;', '}'].join('\n'),
  );
  return root;
}

function evidenceItem(overrides = {}) {
  return {
    id: 'E1',
    path: 'src/auth.js',
    startLine: 1,
    endLine: 2,
    snippet: '1: export function requireAuth(req) {\n2:   return req.user != null;',
    ...overrides,
  };
}

test('verifyCitations classifies exact snippet match', async () => {
  const repoRoot = await makeFixtureRepo();
  const { checks, citationAccuracy } = await verifyCitations({
    result: { evidence: [evidenceItem()] },
    repoRoot,
  });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, 'match');
  assert.equal(citationAccuracy, 1);
});

test('verifyCitations tolerates a maxChars-cut final snippet line (prefix match)', async () => {
  const repoRoot = await makeFixtureRepo();
  const { checks } = await verifyCitations({
    result: {
      evidence: [evidenceItem({
        snippet: '1: export function requireAuth(req) {\n2:   return req.user !',
      })],
    },
    repoRoot,
  });
  assert.equal(checks[0].status, 'match');
});

test('verifyCitations classifies mismatch, file_missing, range_invalid, out_of_root as failures', async () => {
  const repoRoot = await makeFixtureRepo();
  const { checks, citationAccuracy } = await verifyCitations({
    result: {
      evidence: [
        evidenceItem({ id: 'E1', snippet: '1: FORGED_BY_MODEL();' }),
        evidenceItem({ id: 'E2', path: 'src/gone.js' }),
        evidenceItem({ id: 'E3', startLine: 1, endLine: 99 }),
        evidenceItem({ id: 'E4', path: '../escape.js' }),
        evidenceItem({ id: 'E5' }),
      ],
    },
    repoRoot,
  });
  assert.deepEqual(checks.map(c => c.status), [
    'mismatch', 'file_missing', 'range_invalid', 'out_of_root', 'match',
  ]);
  assert.equal(citationAccuracy, 0.2);
});

test('verifyCitations excludes redacted and non-file_range evidence from the denominator', async () => {
  const repoRoot = await makeFixtureRepo();
  const { checks, citationAccuracy } = await verifyCitations({
    result: {
      evidence: [
        evidenceItem({ redacted: true }),
        evidenceItem({ evidenceType: 'git_commit', sha: 'abc1234' }),
        evidenceItem(),
      ],
    },
    repoRoot,
  });
  assert.deepEqual(checks.map(c => c.status), ['redacted', 'skipped', 'match']);
  assert.equal(citationAccuracy, 1);
});

test('verifyCitations downgrades snippetless evidence and report citations to weak_match', async () => {
  const repoRoot = await makeFixtureRepo();
  const noSnippet = evidenceItem();
  delete noSnippet.snippet;
  const { checks } = await verifyCitations({
    result: {
      evidence: [noSnippet],
      citations: [{ path: 'src/auth.js', startLine: 2, endLine: 3 }],
    },
    repoRoot,
  });
  assert.deepEqual(checks.map(c => c.status), ['weak_match', 'weak_match']);
  assert.ok(checks.every(c => c.weak === true));
});

test('verifyCitations returns null accuracy when nothing is countable', async () => {
  const repoRoot = await makeFixtureRepo();
  const { citationAccuracy } = await verifyCitations({ result: { evidence: [] }, repoRoot });
  assert.equal(citationAccuracy, null);
});

test('computeCaseEffectMetrics measures payload vs cited source tokens', async () => {
  const repoRoot = await makeFixtureRepo();
  const result = {
    directAnswer: 'requireAuth checks req.user.',
    evidence: [evidenceItem()],
    targets: [{ path: 'src/auth.js', startLine: 1, endLine: 3, role: 'read' }],
  };
  const metrics = await computeCaseEffectMetrics({ result, repoRoot });
  assert.ok(metrics.responsePayloadTokens > 0);
  assert.ok(metrics.citedSourceTokens > 0);
  assert.equal(metrics.citedFileCount, 1, 'evidence and target paths deduplicate');
  assert.equal(typeof metrics.contextSavingsRatio, 'number');
});

test('computeCaseEffectMetrics returns null ratio when nothing is cited', async () => {
  const repoRoot = await makeFixtureRepo();
  const metrics = await computeCaseEffectMetrics({
    result: { directAnswer: 'nothing found', evidence: [], targets: [] },
    repoRoot,
  });
  assert.equal(metrics.citedFileCount, 0);
  assert.equal(metrics.contextSavingsRatio, null);
});

test('computeCaseEffectMetrics never reads outside the repo root', async () => {
  const repoRoot = await makeFixtureRepo();
  const metrics = await computeCaseEffectMetrics({
    result: { evidence: [evidenceItem({ path: '../../etc/passwd' })], targets: [] },
    repoRoot,
  });
  assert.equal(metrics.citedFileCount, 0);
});
