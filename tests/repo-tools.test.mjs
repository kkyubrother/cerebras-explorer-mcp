import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getBudgetConfig } from '../src/explorer/config.mjs';
import { RepoToolkit, collectCandidatePathsFromToolResult } from '../src/explorer/repo-tools.mjs';
import { LruCache, globalRepoCache } from '../src/explorer/cache.mjs';

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}
function hasRipgrep() {
  try { execFileSync('rg', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

async function makeGitRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-git-'));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  await fs.writeFile(path.join(root, 'hello.js'), 'console.log("hello");\n');
  git(['add', '.']);
  git(['commit', '-m', 'initial commit: add hello.js']);
  await fs.writeFile(path.join(root, 'hello.js'), 'console.log("hello world");\n');
  git(['add', '.']);
  git(['commit', '-m', 'update: expand greeting']);
  return root;
}

async function configureExternalDiffMarker(root) {
  const scriptPath = path.join(root, 'malicious-external-diff.sh');
  const markerPath = path.join(root, 'external-diff-ran.txt');
  await fs.writeFile(scriptPath, `#!/bin/sh
printf 'external diff invoked\n' >> '${markerPath}'
exit 0
`);
  await fs.chmod(scriptPath, 0o755);
  execFileSync('git', ['config', 'diff.external', scriptPath], { cwd: root, stdio: 'pipe' });
  return markerPath;
}

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

test('RepoToolkit blocks symlink reads and skips symlink entries during traversal', { skip: process.platform === 'win32' }, async () => {
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

test('collectCandidatePathsFromToolResult handles git diff and show results', () => {
  const diffResult = { from: 'HEAD~1', to: 'HEAD', files: [{ path: 'src/foo.js', additions: 2, deletions: 1, patch: '' }] };
  assert.deepEqual(collectCandidatePathsFromToolResult('repo_git_diff', diffResult), ['src/foo.js']);

  const showResult = { hash: 'abc', author: 'a', date: 'd', message: 'm', files: [{ path: 'src/bar.js', additions: 1, deletions: 0, patch: '' }] };
  assert.deepEqual(collectCandidatePathsFromToolResult('repo_git_show', showResult), ['src/bar.js']);

  assert.deepEqual(collectCandidatePathsFromToolResult('repo_git_log', { commits: [] }), []);
  assert.deepEqual(collectCandidatePathsFromToolResult('repo_git_blame', { lines: [] }), []);
});

test('RepoToolkit git tools: gitLog returns commits', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize();

  const log = await toolkit.gitLog({ maxCount: 10 });
  assert.ok(Array.isArray(log.commits), 'commits is an array');
  assert.ok(log.commits.length >= 2, 'at least 2 commits');
  assert.ok(log.commits[0].hash, 'commit has hash');
  assert.ok(log.commits[0].author, 'commit has author');
  assert.ok(log.commits[0].message, 'commit has message');
});

test('RepoToolkit git tools: gitLog filters by file path', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize();

  const log = await toolkit.gitLog({ path: 'hello.js', maxCount: 5 });
  assert.ok(log.commits.length >= 1, 'has commits for hello.js');
  assert.ok(log.commits.some(c => c.message.includes('greeting')), 'second commit found');
});

test('RepoToolkit git tools: gitBlame returns line authorship', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize();

  const blame = await toolkit.gitBlame({ path: 'hello.js', startLine: 1, endLine: 1 });
  assert.ok(Array.isArray(blame.lines), 'lines is an array');
  assert.ok(blame.lines.length >= 1, 'at least one blamed line');
  assert.ok(blame.lines[0].hash, 'line has commit hash');
  assert.ok(blame.lines[0].author, 'line has author');
  assert.equal(blame.lines[0].line, 1, 'line number is 1');
});

test('RepoToolkit git tools: gitDiff returns file changes', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize();

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  assert.ok(Array.isArray(diff.files), 'files is an array');
  assert.ok(diff.files.length >= 1, 'at least one changed file');
  assert.equal(diff.files[0].path, 'hello.js');

  const stat = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD', stat: true });
  assert.ok(typeof stat.stat === 'string', 'stat returns string summary');
  assert.match(stat.stat, /hello\.js/);
});

test('RepoToolkit gitDiff ignores repository external diff commands', { skip: !hasGit() || process.platform === 'win32' }, async () => {
  const root = await makeGitRepoFixture();
  const markerPath = await configureExternalDiffMarker(root);
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize();

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });

  assert.ok(diff.files.some(f => f.path === 'hello.js'), 'normal diff output is still parsed');
  await assert.rejects(fs.stat(markerPath), /ENOENT/, 'configured external diff command must not run');
});

test('RepoToolkit gitShow ignores repository external diff commands', { skip: !hasGit() || process.platform === 'win32' }, async () => {
  const root = await makeGitRepoFixture();
  const markerPath = await configureExternalDiffMarker(root);
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize();

  const show = await toolkit.gitShow({ ref: 'HEAD' });

  assert.ok(show.files.some(f => f.path === 'hello.js'), 'normal show output is still parsed');
  await assert.rejects(fs.stat(markerPath), /ENOENT/, 'configured external diff command must not run');
});

test('RepoToolkit git tools: gitShow returns commit details', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize();

  const show = await toolkit.gitShow({ ref: 'HEAD' });
  assert.ok(show.hash, 'has hash');
  assert.ok(show.author, 'has author');
  assert.ok(show.message, 'has message');
  assert.ok(Array.isArray(show.files), 'has files array');
  assert.ok(show.files.some(f => f.path === 'hello.js'), 'hello.js is in changed files');
});

test('RepoToolkit git tools: gitShow rejects invalid ref', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize();

  await assert.rejects(
    toolkit.gitShow({ ref: 'HEAD; rm -rf /' }),
    /Invalid ref/,
  );
});

test('RepoToolkit grep uses ripgrep when available', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['src/**', 'docs/**']);

  assert.equal(toolkit._hasRipgrep, true, 'ripgrep detected');
  const result = await toolkit.grep({ pattern: 'requireAuth' });
  assert.ok(result.matches.length >= 2, 'ripgrep finds matches');
  assert.ok(result.matches.some(m => m.path === 'src/auth.js'), 'finds in auth.js');
  assert.ok(result.matches.some(m => m.path === 'src/routes/user.js'), 'finds in user.js');
});

// --- Phase 1: Cache Isolation Tests ---

test('cache isolates read_file results by repo root', async () => {
  globalRepoCache.clear();
  const repoA = await makeRepoFixture();
  const repoB = await makeRepoFixture();

  // Write different content to the same relative path in each repo
  await fs.writeFile(path.join(repoA, 'src', 'auth.js'), 'export const REPO = "A";\n');
  await fs.writeFile(path.join(repoB, 'src', 'auth.js'), 'export const REPO = "B";\n');

  const toolkitA = new RepoToolkit({ repoRoot: repoA, budgetConfig: getBudgetConfig('normal'), cache: globalRepoCache });
  await toolkitA.initialize(['src/**']);
  const toolkitB = new RepoToolkit({ repoRoot: repoB, budgetConfig: getBudgetConfig('normal'), cache: globalRepoCache });
  await toolkitB.initialize(['src/**']);

  const resultA = await toolkitA.callTool('repo_read_file', { path: 'src/auth.js' });
  const resultB = await toolkitB.callTool('repo_read_file', { path: 'src/auth.js' });

  assert.ok(resultA.content.includes('"A"'), 'repo A content is correct');
  assert.ok(resultB.content.includes('"B"'), 'repo B content is not polluted by repo A cache');
});

test('cache does not reuse read_file across different base scopes', async () => {
  globalRepoCache.clear();
  const repoRoot = await makeRepoFixture();

  // Toolkit with no scope restriction reads docs/auth.md
  const toolkitFull = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal'), cache: globalRepoCache });
  await toolkitFull.initialize([]);

  const fullResult = await toolkitFull.callTool('repo_read_file', { path: 'docs/auth.md' });
  assert.ok(fullResult.content.includes('Auth'), 'full toolkit reads docs/auth.md');

  // Toolkit with src/** scope should reject docs/auth.md even if it was cached
  const toolkitSrc = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal'), cache: globalRepoCache });
  await toolkitSrc.initialize(['src/**']);

  await assert.rejects(
    toolkitSrc.callTool('repo_read_file', { path: 'docs/auth.md' }),
    /outside current scope/,
    'scoped toolkit rejects out-of-scope file even after cache was populated by full toolkit',
  );
});

test('grep cache key includes maxResults — different maxResults get different cache entries', async () => {
  globalRepoCache.clear();
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal'), cache: globalRepoCache });
  await toolkit.initialize(['src/**', 'docs/**']);

  const result1 = await toolkit.callTool('repo_grep', { pattern: 'requireAuth', maxResults: 1 });
  assert.equal(result1.matches.length, 1, 'maxResults:1 returns 1 match');

  const result10 = await toolkit.callTool('repo_grep', { pattern: 'requireAuth', maxResults: 10 });
  assert.ok(result10.matches.length > 1, 'maxResults:10 returns more matches (not polluted by maxResults:1 cache)');
});

test('find_files cache key includes maxResults', async () => {
  globalRepoCache.clear();
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal'), cache: globalRepoCache });
  await toolkit.initialize(['src/**']);

  const result1 = await toolkit.callTool('repo_find_files', { pattern: 'src/**/*.js', maxResults: 1 });
  assert.equal(result1.matches.length, 1, 'maxResults:1 returns 1 file');

  const result10 = await toolkit.callTool('repo_find_files', { pattern: 'src/**/*.js', maxResults: 10 });
  assert.ok(result10.matches.length > 1, 'maxResults:10 is not polluted by maxResults:1 cache');
});

test('cache isolates repo_symbols results by repo root', async () => {
  globalRepoCache.clear();
  const repoA = await makeRepoFixture();
  const repoB = await makeRepoFixture();

  // Write different symbols to the same path in each repo
  await fs.writeFile(path.join(repoA, 'src', 'auth.js'), 'export function fromRepoA() {}\n');
  await fs.writeFile(path.join(repoB, 'src', 'auth.js'), 'export function fromRepoB() {}\n');

  const toolkitA = new RepoToolkit({ repoRoot: repoA, budgetConfig: getBudgetConfig('normal'), cache: globalRepoCache });
  await toolkitA.initialize(['src/**']);
  const toolkitB = new RepoToolkit({ repoRoot: repoB, budgetConfig: getBudgetConfig('normal'), cache: globalRepoCache });
  await toolkitB.initialize(['src/**']);

  const symA = await toolkitA.callTool('repo_symbols', { path: 'src/auth.js' });
  const symB = await toolkitB.callTool('repo_symbols', { path: 'src/auth.js' });

  assert.ok(symA.symbols.some(s => s.name === 'fromRepoA'), 'repo A has fromRepoA symbol');
  assert.ok(symB.symbols.some(s => s.name === 'fromRepoB'), 'repo B has fromRepoB symbol (not polluted by A)');
  assert.ok(!symB.symbols.some(s => s.name === 'fromRepoA'), 'repo B does not have fromRepoA from wrong cache');
});

test('LruCache accepts precomputed serializedLength without breaking eviction', () => {
  const cache = new LruCache({ maxBytes: 60 });

  cache.set('a', { id: 'a' }, null, { serializedLength: 20 });
  cache.set('b', { id: 'b' }, null, { serializedLength: 20 });

  assert.equal(cache.get('a'), undefined, 'oldest entry is evicted using the precomputed size');
  assert.deepEqual(cache.get('b'), { id: 'b' }, 'newer entry remains accessible');
  assert.equal(cache.stats().cacheEntries, 1, 'only one entry remains after eviction');
});

// --- Phase 4: Observation Ledger Tests ---

test('repo_symbol_context returns observations with source for definition and callers', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['src/**', 'docs/**']);

  const result = await toolkit.symbolContext({ symbol: 'requireAuth' });

  assert.ok(Array.isArray(result.observedRanges), 'observedRanges is an array');
  assert.ok(result.observedRanges.length > 0, 'at least one observation');

  const defObs = result.observedRanges.find(o => o.source === 'symbol_context_definition');
  assert.ok(defObs, 'definition observation has source=symbol_context_definition');
  assert.ok(defObs.path, 'definition observation has path');
  assert.ok(typeof defObs.startLine === 'number', 'definition observation has startLine');

  const usageObs = result.observedRanges.filter(o => o.source === 'symbol_context_usage');
  assert.ok(usageObs.length > 0, 'caller observations have source=symbol_context_usage');
});

test('repo_grep returns line-level observations via runtime integration', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['src/**', 'docs/**']);

  const result = await toolkit.grep({ pattern: 'requireAuth', maxResults: 10 });

  // Verify grep returns line-level match info (runtime records these as 'grep' source observations)
  assert.ok(Array.isArray(result.matches), 'matches is an array');
  assert.ok(result.matches.length > 0, 'grep found matches');
  for (const match of result.matches) {
    assert.ok(typeof match.line === 'number', 'each match has a line number');
    assert.ok(match.path, 'each match has a path');
  }
});

// --- Phase 2: Scope Hard Boundary Tests ---

test('RepoToolkit grep with ripgrep respects initialize base scope', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['src/**']);

  assert.equal(toolkit._hasRipgrep, true, 'ripgrep is available');
  // Even with rg, base scope must be honored
  const result = await toolkit.grep({ pattern: 'Auth' });
  assert.ok(!result.matches.some(m => m.path === 'docs/auth.md'), 'rg does not return docs/auth.md when scope=src/**');
  assert.ok(result.matches.some(m => m.path.startsWith('src/')), 'rg returns src/ matches');
});

test('RepoToolkit grep with ripgrep respects extraIgnoreDirs', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeRepoFixture();
  // Create a custom dir that should be ignored
  await fs.mkdir(path.join(repoRoot, 'vendor'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'vendor', 'lib.js'), 'function requireAuth() {} // vendor copy\n');

  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal'), extraIgnoreDirs: ['vendor'] });
  await toolkit.initialize([]);

  assert.equal(toolkit._hasRipgrep, true, 'ripgrep is available');
  const result = await toolkit.grep({ pattern: 'requireAuth' });
  assert.ok(!result.matches.some(m => m.path.startsWith('vendor/')), 'rg does not return vendor/ results when extraIgnoreDirs=[vendor]');
});

test('RepoToolkit grep with ripgrep respects built-in ignore dirs', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeRepoFixture();
  await fs.mkdir(path.join(repoRoot, 'node_modules', 'demo-lib'), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, 'node_modules', 'demo-lib', 'index.js'),
    'function requireAuth() {} // dependency copy\n',
  );

  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize([]);

  assert.equal(toolkit._hasRipgrep, true, 'ripgrep is available');
  const result = await toolkit.grep({ pattern: 'requireAuth' });
  assert.ok(
    !result.matches.some(m => m.path.startsWith('node_modules/')),
    'rg does not return node_modules/ results from built-in ignore dirs',
  );
});

test('RepoToolkit symbols rejects out-of-scope paths', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['src/**']);

  await assert.rejects(
    toolkit.symbols({ path: 'docs/auth.md' }),
    /outside current scope/,
  );
});

test('RepoToolkit gitLog rejects out-of-scope path', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  // Add a docs dir
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs\n');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['add', '.']);
  git(['commit', '-m', 'add docs']);

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['docs/**']);

  await assert.rejects(
    toolkit.gitLog({ path: 'hello.js' }),
    /outside current scope/,
  );
});

test('RepoToolkit gitBlame rejects out-of-scope path', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['docs/**']);

  await assert.rejects(
    toolkit.gitBlame({ path: 'hello.js' }),
    /outside current scope/,
  );
});

test('RepoToolkit gitShow filters changed files to current scope', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  // Add a docs dir with a file in a separate commit
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs\n');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['add', '.']);
  git(['commit', '-m', 'add docs']);
  // Another commit that touches both hello.js and docs
  await fs.writeFile(path.join(root, 'hello.js'), 'console.log("v3");\n');
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs v2\n');
  git(['add', '.']);
  git(['commit', '-m', 'touch both']);

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['docs/**']);

  const show = await toolkit.gitShow({ ref: 'HEAD' });
  assert.ok(!show.files.some(f => f.path === 'hello.js'), 'hello.js is filtered out — outside docs/** scope');
  assert.ok(show.files.some(f => f.path.startsWith('docs/')), 'docs/ files are included');
});
