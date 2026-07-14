import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  canonicalFileSha256,
  dirtyTreeSha256,
  evaluationOptionsForCase,
  fixtureTreeSha256,
  parseArgs,
  prepareFixtureRepository,
  repeatCountForCase,
  runTrustSuite,
  sanitizeTrustArtifact,
} from '../scripts/run-trust-suite.mjs';
import { buildParentPayload, measureParentPayload } from '../src/explorer/parent-payload.mjs';

const execFileAsync = promisify(execFile);
const EMPTY_SHA256 = createHash('sha256').digest('hex');

test('trust runner parses the documented CLI without making usage or latency gates', () => {
  assert.deepEqual(parseArgs([
    '--suite', 'benchmarks/trust-known-answer.json',
    '--mode', 'live',
    '--repo-map', 'C:\\temp\\repo-map.json',
    '--output', 'C:\\temp\\trust.json',
    '--repeats', '3',
    '--verbose',
    '--measure-payload',
  ]), {
    suite: 'benchmarks/trust-known-answer.json',
    mode: 'live',
    repoMap: 'C:\\temp\\repo-map.json',
    output: 'C:\\temp\\trust.json',
    repeats: 3,
    verbose: true,
    measurePayload: true,
    help: false,
  });
  assert.throws(() => parseArgs(['--mode', 'fast']), /fixture or live/);
  assert.throws(() => parseArgs(['--repeats', '0']), /positive integer/);
  assert.equal(repeatCountForCase({ repeatCount: 1 }, 3), 1);
  assert.equal(repeatCountForCase({ repeatCount: 3 }, 5), 5);
  assert.deepEqual(evaluationOptionsForCase('fixture', {}), {
    mode: 'fixture',
    profile: 'fixture_strict_v1',
  });
  assert.deepEqual(evaluationOptionsForCase('live', {
    livePolicy: { profile: 'fail_closed_anchor_or_gap_v1' },
  }), {
    mode: 'live',
    profile: 'fail_closed_anchor_or_gap_v1',
  });
  assert.deepEqual(evaluationOptionsForCase('live', {}), {
    mode: 'live',
    profile: null,
  });
});

test('fixture hashes are stable across line endings and sorted tree traversal', async t => {
  assert.equal(canonicalFileSha256('a\r\nb\r'), canonicalFileSha256('a\nb\n'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-fixture-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'z.txt'), 'z\r\n');
  await fs.writeFile(path.join(root, 'nested', 'a.txt'), 'a\r');
  const first = await fixtureTreeSha256(root);
  await fs.writeFile(path.join(root, 'z.txt'), 'z\n');
  await fs.writeFile(path.join(root, 'nested', 'a.txt'), 'a\n');
  assert.equal(await fixtureTreeSha256(root), first);
});

test('dirty-tree pin is empty only for a clean worktree', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-dirty-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileAsync('git', ['-C', root, ...args], { windowsHide: true });
  await git('init', '--quiet');
  await git('config', 'user.email', 'trust@example.invalid');
  await git('config', 'user.name', 'Trust Runner');
  await git('config', 'commit.gpgsign', 'false');
  await fs.writeFile(path.join(root, 'tracked.txt'), 'clean\n');
  await git('add', 'tracked.txt');
  await git('commit', '--quiet', '-m', 'fixture');
  assert.equal(await dirtyTreeSha256(root), EMPTY_SHA256);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'dirty\n');
  assert.notEqual(await dirtyTreeSha256(root), EMPTY_SHA256);
  await git('checkout', '--quiet', '--', 'tracked.txt');
  await fs.writeFile(path.join(root, 'untracked.txt'), 'new\n');
  assert.notEqual(await dirtyTreeSha256(root), EMPTY_SHA256);
});

test('deterministic Git fixture setup reproduces the portable commit pin and cleans up', async () => {
  const manifest = JSON.parse(await fs.readFile('benchmarks/trust-known-answer.json', 'utf8'));
  const caseDefinition = manifest.cases.find(item => item.id === 'fx-historical-source-role');
  const source = manifest.sources[caseDefinition.sourceRef];
  const sourceRoot = path.resolve(source.repoPath);
  const hostileRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-host-git-env-'));
  const redirectedGitDir = path.join(hostileRoot, 'redirected.git');
  const previous = Object.fromEntries([
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
  ].map(key => [key, process.env[key]]));
  process.env.GIT_DIR = redirectedGitDir;
  process.env.GIT_WORK_TREE = hostileRoot;
  process.env.GIT_CONFIG_GLOBAL = path.join(hostileRoot, 'host-global-config');
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
  process.env.GIT_CONFIG_VALUE_0 = path.join(hostileRoot, 'host-hooks');
  let prepared;
  try {
    prepared = await prepareFixtureRepository(sourceRoot, caseDefinition.fixtureSetup);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const tempRoot = path.dirname(prepared.repoRoot);
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', prepared.repoRoot, 'rev-parse', 'HEAD'],
      { windowsHide: true },
    );
    assert.equal(stdout.trim(), caseDefinition.fixtureSetup.headSha);
    assert.equal(prepared.fixtureSetupHeadSha, caseDefinition.fixtureSetup.headSha);
    await assert.rejects(fs.stat(path.join(sourceRoot, '.git')));
    await assert.rejects(fs.stat(redirectedGitDir),
      'host Git path overrides must not receive fixture writes');
  } finally {
    await prepared.cleanup();
    await fs.rm(hostileRoot, { recursive: true, force: true });
  }
  await assert.rejects(fs.stat(tempRoot));
});

test('trust report artifacts replace mapped and unrelated absolute paths', () => {
  const repoRoot = path.resolve('C:\\private\\repo');
  const artifact = {
    stats: { repoRoot },
    message: `Read ${repoRoot}\\src\\entry.mjs and C:\\secret\\trace.json`,
    evidence: [{ path: 'src/entry.mjs' }],
  };
  const safe = sanitizeTrustArtifact(artifact, { repoRoot, repoId: 'logical-repo' });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes(repoRoot), false);
  assert.equal(serialized.includes('C:\\secret\\trace.json'), false);
  assert.match(serialized, /repo:logical-repo/);
  assert.equal(safe.evidence[0].path, 'src/entry.mjs');
});

test('Spec 028 T068 — portable fixture results replay and payload metrics bind to actual handoffs', async () => {
  const suitePath = path.resolve('benchmarks/trust-known-answer.json');
  const manifest = JSON.parse(await fs.readFile(suitePath, 'utf8'));
  const report = await runTrustSuite({
    suite: suitePath,
    mode: 'fixture',
    repoMap: null,
    output: null,
    repeats: 3,
    verbose: false,
    measurePayload: true,
    help: false,
  });

  assert.equal(report.summary.passed, true);
  assert.equal(report.summary.failedCaseCount, 0);
  assert.equal(report.summary.skippedCaseCount, 0);
  assert.deepEqual(
    report.cases.map(item => item.id).sort(),
    [...manifest.offlineResults.fixtureTrust.acceptedCaseIds].sort(),
  );

  for (const caseId of manifest.offlineResults.fixtureTrust.repeatableCaseIds) {
    assert.equal(
      report.cases.find(item => item.id === caseId)?.runs?.length,
      manifest.offlineResults.fixtureTrust.repeatCount,
      `${caseId} must replay three times`,
    );
  }

  assert.equal(manifest.offlineResults.parentObservation.status, 'recorded');
  assert.equal(
    manifest.cases.some(item => Object.hasOwn(item, 'parentObservation')),
    false,
    'synthetic per-case parent actions must not substitute for the recorded parent harness',
  );
  for (const caseResult of report.cases) {
    for (const run of caseResult.runs ?? []) {
      const handoff = run.artifact?.parentHandoff;
      if (!handoff) continue;
      assert.deepEqual(
        run.payload?.schemaV3,
        measureParentPayload(buildParentPayload(handoff)),
        `${caseResult.id} payload measurement must be derived from its actual schema-v3 handoff`,
      );
    }
  }
});
