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
  fixtureTreeSha256,
  parseArgs,
  repeatCountForCase,
  sanitizeTrustArtifact,
} from '../scripts/run-trust-suite.mjs';

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
