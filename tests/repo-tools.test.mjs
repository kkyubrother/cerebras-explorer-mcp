import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBudgetConfig } from '../src/explorer/config.mjs';
import { RepoToolkit } from '../src/explorer/repo-tools.mjs';

async function makeRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-'));
  await fs.mkdir(path.join(root, 'src', 'routes'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'ignored'), { recursive: true });
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored/\n');
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    [
      'export function requireAuth(req, res, next) {',
      '  if (!req.user) throw new Error("unauthorized");',
      '  next();',
      '}',
      '',
      'export const AUTH_HEADER = "x-auth-token";',
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
  await fs.writeFile(
    path.join(root, 'docs', 'auth.md'),
    '# Auth\n\nThe user route uses requireAuth before handling /users/me.\n',
  );
  await fs.writeFile(path.join(root, 'ignored', 'secret.txt'), 'do not index');
  await fs.writeFile(path.join(root, 'logo.png'), Buffer.from([0, 1, 2, 3, 4]));
  return root;
}

test('RepoToolkit finds files, greps, reads ranges, and respects gitignore', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig('normal'),
  });
  await toolkit.initialize(['src/**', 'docs/**']);

  const found = await toolkit.findFiles({ pattern: 'src/**/*.js' });
  assert.deepEqual(found.matches.sort(), ['src/auth.js', 'src/routes/user.js']);

  const grep = await toolkit.grep({ pattern: 'requireAuth' });
  assert.equal(grep.matches.length >= 2, true);
  assert.equal(grep.matches.some(match => match.path === 'src/auth.js'), true);
  assert.equal(grep.matches.some(match => match.path === 'src/routes/user.js'), true);
  assert.equal(grep.matches.some(match => match.path === 'ignored/secret.txt'), false);

  const read = await toolkit.readFile({ path: 'src/routes/user.js', startLine: 1, endLine: 4 });
  assert.equal(read.startLine, 1);
  assert.equal(read.endLine, 4);
  assert.match(read.content, /4 \|   app.get\("\/users\/me", requireAuth/);

  const listing = await toolkit.listDirectory({ dirPath: '.', depth: 2 });
  assert.equal(listing.entries.some(entry => entry.path === 'ignored/secret.txt'), false);
  assert.equal(listing.entries.some(entry => entry.path === 'src/auth.js'), true);
});

test('RepoToolkit enforces the initial scope as a hard boundary', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig('normal'),
  });
  await toolkit.initialize(['src/**']);

  const listing = await toolkit.listDirectory({ dirPath: '.', depth: 2 });
  assert.equal(listing.entries.some(entry => entry.path === 'src'), true);
  assert.equal(listing.entries.some(entry => entry.path === 'docs'), false);
  assert.equal(listing.entries.some(entry => entry.path === 'docs/auth.md'), false);

  const expandedFind = await toolkit.findFiles({
    pattern: 'docs/**/*.md',
    scope: ['docs/**'],
  });
  assert.deepEqual(expandedFind.matches, []);

  const expandedGrep = await toolkit.grep({
    pattern: 'Auth',
    scope: ['docs/**'],
  });
  assert.deepEqual(expandedGrep.matches, []);

  await assert.rejects(
    toolkit.listDirectory({ dirPath: 'docs', depth: 1 }),
    /Directory is outside current scope: docs/,
  );
});

test('RepoToolkit blocks symlink reads and skips symlink entries during traversal', async () => {
  const repoRoot = await makeRepoFixture();
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-outside-'));
  const outsideFile = path.join(outsideDir, 'outside-secret.txt');
  await fs.writeFile(outsideFile, 'outside secret');

  const fileLinkPath = path.join(repoRoot, 'src', 'linked-secret.txt');
  const dirLinkPath = path.join(repoRoot, 'src', 'linked-dir');
  await fs.symlink(outsideFile, fileLinkPath);
  await fs.symlink(outsideDir, dirLinkPath, 'dir');

  const toolkit = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig('normal'),
  });
  await toolkit.initialize(['src/**']);

  const listing = await toolkit.listDirectory({ dirPath: 'src', depth: 2 });
  assert.equal(listing.entries.some(entry => entry.path === 'src/linked-secret.txt'), false);
  assert.equal(listing.entries.some(entry => entry.path === 'src/linked-dir'), false);

  const found = await toolkit.findFiles({ pattern: 'src/**/*.txt' });
  assert.deepEqual(found.matches, []);

  await assert.rejects(
    toolkit.readFile({ path: 'src/linked-secret.txt', startLine: 1, endLine: 1 }),
    /Symlinks are not supported|Path resolves outside repo root/,
  );
});
