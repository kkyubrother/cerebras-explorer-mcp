import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getBudgetConfig } from '../src/explorer/config.mjs';
import {
  RepoToolkit,
  collectTargetPathsFromToolResult,
  normalizeRepositoryObservation,
} from '../src/explorer/repo-tools.mjs';
import { LruCache, globalRepoCache } from '../src/explorer/cache.mjs';

function repositoryObservationTest(name, callback) {
  test(name, () => {
    callback(normalizeRepositoryObservation);
  });
}

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}
function hasRipgrep() {
  try { execFileSync('rg', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
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

repositoryObservationTest('repository observations preserve the authoritative boundary and compute result counts', normalize => {
  const observation = normalize({
    id: 'search-1',
    tool: 'repo_grep',
    args: {
      pattern: 'requireAuth',
      scope: ['**'],
    },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: {
      matches: [
        { path: 'src/auth.js', line: 1 },
        { path: 'src/routes/user.js', line: 2 },
      ],
      truncated: false,
      matchCount: 999,
      enumerationComplete: false,
      boundary: ['**'],
      contextTruncated: true,
    },
    contextTruncated: false,
  });

  assert.deepEqual(Object.keys(observation).sort(), [
    'boundary',
    'contextTruncated',
    'deniedPaths',
    'enumerationComplete',
    'errors',
    'id',
    'kind',
    'matchCount',
    'normalizedArgs',
    'omittedOutOfScopeFiles',
    'tool',
    'toolTruncated',
  ]);
  assert.equal(observation.id, 'search-1');
  assert.equal(observation.kind, 'search');
  assert.equal(observation.tool, 'repo_grep');
  assert.equal(observation.normalizedArgs.pattern, 'requireAuth');
  assert.deepEqual(observation.boundary, ['src/**']);
  assert.equal(observation.matchCount, 2);
  assert.equal(observation.toolTruncated, false);
  assert.equal(observation.contextTruncated, false);
  assert.equal(observation.omittedOutOfScopeFiles, 0);
  assert.equal(observation.deniedPaths, 0);
  assert.equal(observation.errors, 0);
  assert.equal(observation.enumerationComplete, true);
});

repositoryObservationTest('repository observations distinguish tool truncation from runtime context truncation', normalize => {
  const toolLimited = normalize({
    id: 'search-tool-limited',
    tool: 'repo_find_files',
    args: { pattern: '**/*.mjs' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: { matches: ['src/index.mjs'], truncated: true },
    contextTruncated: false,
  });
  assert.equal(toolLimited.toolTruncated, true);
  assert.equal(toolLimited.contextTruncated, false);
  assert.equal(toolLimited.enumerationComplete, false);

  const contextLimited = normalize({
    id: 'search-context-limited',
    tool: 'repo_find_files',
    args: { pattern: '**/*.mjs' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: { matches: ['src/index.mjs'], truncated: false },
    contextTruncated: true,
  });
  assert.equal(contextLimited.toolTruncated, false);
  assert.equal(contextLimited.contextTruncated, true);
  assert.equal(contextLimited.enumerationComplete, false);
});

repositoryObservationTest('repository observations retain omission, denial, and error counts without trusting invalid counts', normalize => {
  const blocked = normalize({
    id: 'search-blocked',
    tool: 'repo_grep',
    args: { pattern: 'token' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: {
      matches: [],
      truncated: false,
      omittedOutOfScopeFiles: 2,
      omittedSecretPaths: 3,
      errors: 4,
    },
  });
  assert.equal(blocked.omittedOutOfScopeFiles, 2);
  assert.equal(blocked.deniedPaths, 3);
  assert.equal(blocked.errors, 4);
  assert.equal(blocked.enumerationComplete, false);

  const invalidCounts = normalize({
    id: 'search-invalid-counts',
    tool: 'repo_grep',
    args: { pattern: 'token' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: {
      matches: [],
      truncated: false,
      omittedOutOfScopeFiles: -1,
      omittedSecretPaths: 1.5,
      errors: Number.NaN,
    },
  });
  assert.equal(invalidCounts.omittedOutOfScopeFiles, 0);
  assert.equal(invalidCounts.deniedPaths, 0);
  assert.equal(invalidCounts.errors, 0);
  assert.equal(invalidCounts.enumerationComplete, false);

  const executionError = normalize({
    id: 'search-execution-error',
    tool: 'repo_grep',
    args: { pattern: 'token' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: {
      error: true,
      stage: 'parse_or_exec',
      type: 'tool_execution_error',
      message: 'tool failed',
      tool: 'repo_grep',
    },
  });
  assert.equal(executionError.deniedPaths, 0);
  assert.equal(executionError.errors, 1);
  assert.equal(executionError.enumerationComplete, false);
});

repositoryObservationTest('policy-denied observations count the denial without leaking a path or double-counting an error', normalize => {
  const observation = normalize({
    id: 'search-secret-denied',
    tool: 'repo_read_file',
    args: { path: '.env', debugPath: '.env.local' },
    boundary: ['**'],
    result: {
      error: 'redacted_by_policy',
      reason: 'secret-deny-list',
      path: '.env',
      pattern: '**/.env',
    },
  });

  assert.equal(observation.deniedPaths, 1);
  assert.equal(observation.errors, 0);
  assert.equal(observation.enumerationComplete, false);
  assert.equal(observation.normalizedArgs.path, '[REDACTED:secret-path]');
  assert.equal(observation.normalizedArgs.debugPath, undefined);
  assert.doesNotMatch(JSON.stringify(observation), /\.env|secret-deny-list|redacted_by_policy/);
});

repositoryObservationTest('enumeration completeness requires a runtime candidate and never trusts result self-report', normalize => {
  const runtimeCertified = normalize({
    id: 'search-runtime-certified',
    tool: 'repo_grep',
    args: { pattern: 'needle' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: {
      matches: [],
      truncated: false,
      enumerationComplete: false,
    },
  });
  assert.equal(runtimeCertified.enumerationComplete, true);

  const selfReportedOnly = normalize({
    id: 'search-self-reported',
    tool: 'repo_grep',
    args: { pattern: 'needle' },
    boundary: ['src/**'],
    result: {
      matches: [],
      truncated: false,
      enumerationComplete: true,
    },
  });
  assert.equal(selfReportedOnly.enumerationComplete, false);

  const inheritedResult = normalize({
    id: 'search-inherited-result',
    tool: 'repo_grep',
    args: { pattern: 'needle' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: Object.create({ matches: [], truncated: false }),
  });
  assert.equal(inheritedResult.errors, 1);
  assert.equal(inheritedResult.enumerationComplete, false,
    'prototype-inherited result telemetry must never certify enumeration');

  const inheritedMatch = Object.assign(Object.create({ line: 1 }), {
    path: 'src/index.mjs',
  });
  const inheritedMatchResult = normalize({
    id: 'search-inherited-match',
    tool: 'repo_grep',
    args: { pattern: 'needle' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: { matches: [inheritedMatch], truncated: false },
  });
  assert.equal(inheritedMatchResult.matchCount, 0);
  assert.equal(inheritedMatchResult.enumerationComplete, false,
    'prototype-inherited nested match fields must not certify enumeration');

  const malformedRead = normalize({
    id: 'search-malformed-read',
    tool: 'repo_read_file',
    args: { path: 'src/index.mjs' },
    boundary: ['src/index.mjs'],
    enumerationCandidate: true,
    result: {
      path: 'src/index.mjs',
      startLine: -2,
      endLine: -1,
      content: 'not an observable range',
      truncated: false,
    },
  });
  assert.equal(malformedRead.matchCount, 0);
  assert.equal(malformedRead.enumerationComplete, false,
    'an invalid source range must not become a complete observation');

  assert.throws(() => normalize({
    id: 'search-invalid-boundary',
    tool: 'repo_grep',
    args: { pattern: 'needle' },
    boundary: 'src/**',
    enumerationCandidate: true,
    result: { matches: [], truncated: false },
  }), /boundary|string array/i, 'a malformed boundary must not widen to repository scope');
});

test('RepoToolkit finds files, greps, reads ranges, and respects gitignore', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig(),
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
    budgetConfig: getBudgetConfig(),
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

  await fs.writeFile(path.join(repoRoot, '.env'), 'CEREBRAS_API_KEY=super_secret_scope_escape');

  await assert.rejects(
    toolkit.readFile({ path: 'src/../.env', startLine: 1, endLine: 1 }),
    /Path is outside current scope: \.env/,
  );

  const normalizedListing = await toolkit.listDirectory({ dirPath: 'src/..', depth: 2 });
  assert.equal(normalizedListing.dirPath, '.');
  assert.equal(normalizedListing.entries.some(entry => entry.path === '.env'), false);
  assert.equal(normalizedListing.entries.some(entry => entry.path === 'docs'), false);
  assert.equal(normalizedListing.entries.some(entry => entry.path === 'src/auth.js'), true);
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
    budgetConfig: getBudgetConfig(),
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

test('collectTargetPathsFromToolResult handles git diff and show results', () => {
  const diffResult = { from: 'HEAD~1', to: 'HEAD', files: [{ path: 'src/foo.js', additions: 2, deletions: 1, patch: '' }] };
  assert.deepEqual(collectTargetPathsFromToolResult('repo_git_diff', diffResult), ['src/foo.js']);

  const showResult = { hash: 'abc', author: 'a', date: 'd', message: 'm', files: [{ path: 'src/bar.js', additions: 1, deletions: 0, patch: '' }] };
  assert.deepEqual(collectTargetPathsFromToolResult('repo_git_show', showResult), ['src/bar.js']);

  assert.deepEqual(collectTargetPathsFromToolResult('repo_git_log', { commits: [] }), []);
  assert.deepEqual(collectTargetPathsFromToolResult('repo_git_blame', { lines: [] }), []);
});

test('RepoToolkit git tools: gitLog returns commits', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  const log = await toolkit.gitLog({ path: 'hello.js', maxCount: 5 });
  assert.ok(log.commits.length >= 1, 'has commits for hello.js');
  assert.ok(log.commits.some(c => c.message.includes('greeting')), 'second commit found');
});

test('RepoToolkit git tools: gitBlame returns line authorship', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  assert.ok(Array.isArray(diff.files), 'files is an array');
  assert.ok(diff.files.length >= 1, 'at least one changed file');
  assert.equal(diff.files[0].path, 'hello.js');

  const stat = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD', stat: true });
  assert.ok(typeof stat.stat === 'string', 'stat returns string summary');
  assert.match(stat.stat, /hello\.js/);
});

test('RepoToolkit gitShow ignores repository external diff commands', { skip: !hasGit() || process.platform === 'win32' }, async () => {
  const root = await makeGitRepoFixture();
  const markerPath = await configureExternalDiffMarker(root);
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  const show = await toolkit.gitShow({ ref: 'HEAD' });

  assert.ok(show.files.some(f => f.path === 'hello.js'), 'normal show output is still parsed');
  await assert.rejects(fs.stat(markerPath), /ENOENT/, 'configured external diff command must not run');
});

test('RepoToolkit git tools: gitShow returns commit details', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  await assert.rejects(
    toolkit.gitShow({ ref: 'HEAD; rm -rf /' }),
    /Invalid ref/,
  );
});

async function makeRenameAcrossScopeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-rename-'));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  // Force rename detection so the unfixed code would emit `rename from <old>`.
  git(['config', 'diff.renames', 'true']);
  await fs.mkdir(path.join(root, 'internal'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'keep.js'), 'export const keep = 1;\n');
  await fs.writeFile(
    path.join(root, 'internal', 'out-of-scope-name.js'),
    'export const moved = 1;\n',
  );
  git(['add', '.']);
  git(['commit', '-m', 'initial: add internal and src files']);
  // Pure move of an out-of-scope file into the in-scope src/ directory.
  git(['mv', 'internal/out-of-scope-name.js', 'src/moved.js']);
  git(['commit', '-m', 'refactor: move file into src']);
  return root;
}

const OUT_OF_SCOPE_OLD_PATH = 'internal/out-of-scope-name.js';

test('RepoToolkit gitDiff does not leak out-of-scope old paths from a rename into scope', { skip: !hasGit() }, async () => {
  const root = await makeRenameAcrossScopeFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize(['src/**']);

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  const serialized = JSON.stringify(diff);
  assert.ok(serialized.includes('src/moved.js'), 'the in-scope new path is still reported');
  assert.ok(
    !serialized.includes(OUT_OF_SCOPE_OLD_PATH),
    `out-of-scope old path leaked through the diff patch: ${serialized}`,
  );

  const stat = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD', stat: true });
  assert.ok(
    !stat.stat.includes(OUT_OF_SCOPE_OLD_PATH),
    `out-of-scope old path leaked through the diff stat: ${stat.stat}`,
  );
});

test('RepoToolkit gitShow does not leak out-of-scope old paths from a rename into scope', { skip: !hasGit() }, async () => {
  const root = await makeRenameAcrossScopeFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize(['src/**']);

  const show = await toolkit.gitShow({ ref: 'HEAD' });
  const serialized = JSON.stringify(show);
  assert.ok(
    !serialized.includes(OUT_OF_SCOPE_OLD_PATH),
    `out-of-scope old path leaked through the show patch: ${serialized}`,
  );
});

test('RepoToolkit grep uses ripgrep when available', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
  await toolkit.initialize(['src/**', 'docs/**']);

  assert.equal(toolkit._hasRipgrep, true, 'ripgrep detected');
  const result = await toolkit.grep({ pattern: 'requireAuth' });
  assert.ok(result.matches.length >= 2, 'ripgrep finds matches');
  assert.ok(result.matches.some(m => m.path === 'src/auth.js'), 'finds in auth.js');
  assert.ok(result.matches.some(m => m.path === 'src/routes/user.js'), 'finds in user.js');
});

test('RepoToolkit rejects traversal scopes before grep can escape the repo root', { skip: !hasRipgrep() }, async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-scope-escape-'));
  const repoRoot = path.join(parent, 'repo');
  const outsideDir = path.join(parent, 'outside');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'inside.txt'), 'inside content\n');
  await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'LEAK_MARKER outside repo secret\n');

  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  await assert.rejects(
    toolkit.grep({ pattern: 'LEAK_MARKER', scope: ['../outside/**'] }),
    /Scope must stay within repo root/,
  );

  await assert.rejects(
    toolkit.grep({ pattern: 'LEAK_MARKER', scope: ['../outside'] }),
    /Scope must stay within repo root/,
  );

  const control = await toolkit.grep({ pattern: 'LEAK_MARKER', scope: ['.'] });
  assert.deepEqual(control.matches, []);
});

test('RepoToolkit gitDiff validates refs and disables external diff helpers', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const marker = path.join(root, 'diff-external-ran');
  const helper = path.join(root, 'diff-external.sh');
  await fs.writeFile(helper, `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\nexit 0\n`);
  await fs.chmod(helper, 0o755);
  execFileSync('git', ['config', 'diff.external', helper], { cwd: root, stdio: 'pipe' });

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  assert.ok(diff.files.some(f => f.path === 'hello.js'), 'diff still returns file changes');
  await assert.rejects(
    toolkit.gitDiff({ from: '--ext-diff', to: 'HEAD' }),
    /Invalid from ref/,
  );
  await assert.rejects(
    toolkit.gitDiff({ from: 'HEAD..HEAD', to: 'HEAD' }),
    /Invalid from ref/,
  );
  assert.equal(await fileExists(marker), false, 'diff.external helper was not executed');
});

test('RepoToolkit gitShow disables textconv helpers', { skip: !hasGit() }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-git-textconv-'));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  await fs.writeFile(path.join(root, '.gitattributes'), '*.evil diff=evil\n');
  await fs.writeFile(path.join(root, 'payload.evil'), 'first\n');
  git(['add', '.']);
  git(['commit', '-m', 'initial evil file']);
  await fs.writeFile(path.join(root, 'payload.evil'), 'second\n');
  git(['add', '.']);
  git(['commit', '-m', 'update evil file']);

  const marker = path.join(root, 'textconv-ran');
  const helper = path.join(root, 'textconv.sh');
  await fs.writeFile(helper, `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\ncat "$1"\n`);
  await fs.chmod(helper, 0o755);
  git(['config', 'diff.evil.textconv', helper]);

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  const show = await toolkit.gitShow({ ref: 'HEAD' });
  assert.ok(show.files.some(f => f.path === 'payload.evil'), 'show still returns changed file');
  assert.equal(await fileExists(marker), false, 'textconv helper was not executed');
});

// --- Phase 1: Cache Isolation Tests ---

test('cache isolates read_file results by repo root', async () => {
  globalRepoCache.clear();
  const repoA = await makeRepoFixture();
  const repoB = await makeRepoFixture();

  // Write different content to the same relative path in each repo
  await fs.writeFile(path.join(repoA, 'src', 'auth.js'), 'export const REPO = "A";\n');
  await fs.writeFile(path.join(repoB, 'src', 'auth.js'), 'export const REPO = "B";\n');

  const toolkitA = new RepoToolkit({ repoRoot: repoA, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
  await toolkitA.initialize(['src/**']);
  const toolkitB = new RepoToolkit({ repoRoot: repoB, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
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
  const toolkitFull = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
  await toolkitFull.initialize([]);

  const fullResult = await toolkitFull.callTool('repo_read_file', { path: 'docs/auth.md' });
  assert.ok(fullResult.content.includes('Auth'), 'full toolkit reads docs/auth.md');

  // Toolkit with src/** scope should reject docs/auth.md even if it was cached
  const toolkitSrc = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
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
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
  await toolkit.initialize(['src/**', 'docs/**']);

  const result1 = await toolkit.callTool('repo_grep', { pattern: 'requireAuth', maxResults: 1 });
  assert.equal(result1.matches.length, 1, 'maxResults:1 returns 1 match');

  const result10 = await toolkit.callTool('repo_grep', { pattern: 'requireAuth', maxResults: 10 });
  assert.ok(result10.matches.length > 1, 'maxResults:10 returns more matches (not polluted by maxResults:1 cache)');
});

test('find_files cache key includes maxResults', async () => {
  globalRepoCache.clear();
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
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

  const toolkitA = new RepoToolkit({ repoRoot: repoA, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
  await toolkitA.initialize(['src/**']);
  const toolkitB = new RepoToolkit({ repoRoot: repoB, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
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
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig(), extraIgnoreDirs: ['vendor'] });
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

  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize(['docs/**']);

  await assert.rejects(
    toolkit.gitLog({ path: 'hello.js' }),
    /outside current scope/,
  );
});

test('RepoToolkit gitBlame rejects out-of-scope path', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize(['docs/**']);

  const show = await toolkit.gitShow({ ref: 'HEAD' });
  assert.ok(!show.files.some(f => f.path === 'hello.js'), 'hello.js is filtered out — outside docs/** scope');
  assert.ok(show.files.some(f => f.path.startsWith('docs/')), 'docs/ files are included');
});

// ── 010 — Spec-4: gitDiff scope hard boundary ─────────────────────────────

test('010 US4#1 — RepoToolkit gitDiff filters changed files to current scope', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs\n');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['add', '.']);
  git(['commit', '-m', 'add docs']);
  await fs.writeFile(path.join(root, 'hello.js'), 'console.log("v3");\n');
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs v2\n');
  git(['add', '.']);
  git(['commit', '-m', 'touch both']);

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize(['docs/**']);

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  assert.ok(
    !diff.files.some(f => f.path === 'hello.js'),
    'hello.js must be filtered out — outside docs/** scope',
  );
  assert.ok(
    diff.files.some(f => f.path.startsWith('docs/')),
    'docs/ files must remain in the result',
  );
  assert.ok(diff.omittedOutOfScopeFiles > 0, 'omittedOutOfScopeFiles must be reported when filtering');
});

test('010 US4#2 — RepoToolkit gitDiff stat mode filters out-of-scope lines', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs\n');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['add', '.']);
  git(['commit', '-m', 'add docs']);
  await fs.writeFile(path.join(root, 'hello.js'), 'console.log("v3");\n');
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs v2\n');
  git(['add', '.']);
  git(['commit', '-m', 'touch both']);

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize(['docs/**']);

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD', stat: true });
  assert.ok(!/^\s*hello\.js\s+\|/m.test(diff.stat), `stat text should not include hello.js line, got:\n${diff.stat}`);
  assert.ok(/docs\/README\.md\s+\|/m.test(diff.stat), 'stat text should include docs/README.md line');
  assert.ok(diff.omittedOutOfScopeFiles > 0, 'omittedOutOfScopeFiles must be reported when stat filtering');
});

test('010 US4#4 — collectDiscoveredPathsFromToolResult only sees in-scope files', { skip: !hasGit() }, async () => {
  const { collectDiscoveredPathsFromToolResult } = await import('../src/explorer/repo-tools.mjs');
  const root = await makeGitRepoFixture();
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs\n');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['add', '.']);
  git(['commit', '-m', 'add docs']);
  await fs.writeFile(path.join(root, 'hello.js'), 'console.log("v3");\n');
  await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Docs v2\n');
  git(['add', '.']);
  git(['commit', '-m', 'touch both']);

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize(['docs/**']);
  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  const discovered = collectDiscoveredPathsFromToolResult('repo_git_diff', diff);
  assert.ok(
    !discovered.some(entry => entry.path === 'hello.js'),
    'discoveredPaths must not include scope-filtered files',
  );
  assert.ok(
    discovered.some(entry => entry.path && entry.path.startsWith('docs/')),
    'discoveredPaths must include in-scope changed files',
  );
});

test('callTool repo_read_file invalidates the cache when the file mtime changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-mtime-cache-'));
  const filePath = path.join(root, 'demo.txt');
  await fs.writeFile(filePath, 'initial content\nline 2\nline 3\n');

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  const first = await toolkit.callTool('repo_read_file', { path: 'demo.txt', startLine: 1, endLine: 5 });
  assert.match(JSON.stringify(first), /initial content/);

  await fs.writeFile(filePath, 'updated content\nline 2\nline 3\n');
  const future = (Date.now() + 5000) / 1000;
  await fs.utimes(filePath, future, future);

  const second = await toolkit.callTool('repo_read_file', { path: 'demo.txt', startLine: 1, endLine: 5 });
  assert.match(JSON.stringify(second), /updated content/, 'mtime change must invalidate cache and reread the file');
  assert.doesNotMatch(JSON.stringify(second), /initial content/);
});

// ─── Spec 026 US2: deterministic, diversity-preserving caller truncation ──────

async function makePaintWidgetFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-paintwidget-'));
  await fs.mkdir(path.join(root, 'lib'), { recursive: true });
  await fs.mkdir(path.join(root, 'app'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });

  // lib/def.js — definition of paintWidget
  await fs.writeFile(
    path.join(root, 'lib', 'def.js'),
    [
      'export function paintWidget(canvas, opts) {',
      '  canvas.fill(opts.color);',
      '  canvas.stroke(opts.border);',
      '  return canvas;',
      '}',
    ].join('\n') + '\n',
  );

  // app/main.js — large production file with exactly one call to paintWidget
  const mainLines = ['// Production entry point', ''];
  for (let i = 0; i < 100; i++) {
    mainLines.push(`// padding line ${i}`);
  }
  mainLines.push("import { paintWidget } from '../lib/def.js';");
  mainLines.push('');
  mainLines.push('function renderApp(canvas) {');
  mainLines.push('  return paintWidget(canvas, { color: "blue", border: "1px" });');
  mainLines.push('}');
  mainLines.push('');
  mainLines.push('export { renderApp };');
  await fs.writeFile(path.join(root, 'app', 'main.js'), mainLines.join('\n') + '\n');

  // tests/def.test.js — 25 call-like mention lines to paintWidget
  const testLines = ["import { paintWidget } from '../lib/def.js';", ''];
  for (let i = 0; i < 25; i++) {
    testLines.push(`  paintWidget(mockCanvas${i}, { color: 'red' });`);
  }
  await fs.writeFile(path.join(root, 'tests', 'def.test.js'), testLines.join('\n') + '\n');

  // docs/a.md, docs/b.md, docs/c.md — 30 total prose mention lines (10 each)
  for (const [letter, num] of [['a', 10], ['b', 10], ['c', 10]]) {
    const docLines = [`# Docs ${letter.toUpperCase()}`, ''];
    for (let i = 0; i < num; i++) {
      docLines.push(`The paintWidget function is described in section ${i}.`);
    }
    await fs.writeFile(path.join(root, 'docs', `${letter}.md`), docLines.join('\n') + '\n');
  }

  return root;
}

test('spec-026 US2: symbolContext includes production callsite, is deterministic, and caps per-file entries', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makePaintWidgetFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
  await toolkit.initialize([]);

  const result1 = await toolkit.symbolContext({ symbol: 'paintWidget', depth: 1 });

  // ① callers includes app/main.js with relation 'call'
  const mainCaller = result1.callers.find(c => c.path === 'app/main.js');
  assert.ok(mainCaller, 'production callsite app/main.js must be in callers');
  assert.equal(mainCaller.relation, 'call', 'app/main.js caller must have relation "call"');

  // ② two consecutive calls return deepEqual results (determinism)
  const result2 = await toolkit.symbolContext({ symbol: 'paintWidget', depth: 1 });
  assert.deepEqual(result1, result2, 'symbolContext must return identical results on consecutive calls');

  // ③ no file contributes more than 3 caller entries (round-robin diversity)
  const perFileCount = {};
  for (const caller of result1.callers) {
    perFileCount[caller.path] = (perFileCount[caller.path] ?? 0) + 1;
  }
  for (const [file, count] of Object.entries(perFileCount)) {
    assert.ok(count <= 3, `file "${file}" contributes ${count} entries — must be ≤3`);
  }

  // ④ definition exists and points at lib/def.js
  assert.ok(result1.definition, 'definition must be present');
  assert.ok(result1.definition.path === 'lib/def.js', `definition must point at lib/def.js, got: ${result1.definition.path}`);

  // ⑤ truncated/callerCount semantics preserved
  assert.equal(typeof result1.callerCount, 'number', 'callerCount must be a number');
  assert.ok(result1.callerCount >= result1.callers.length, 'callerCount must be >= callers.length');
  // There are 25+30=55 non-definition callable matches total; truncated is true when
  // the selected set is smaller than total callers (selection cap, not grep cap)
  assert.equal(result1.truncated, true, 'truncated must be true when the selected set is smaller than total callers');
});

async function makeMultiFileBreadthFixture() {
  // 8 code files, each containing 4 calls to 'myFunc' (32 candidates total, all same tier).
  // True round-robin must give every file at least 1 slot before any file gets its 2nd.
  // Greedy groupwise cap would fill first ~6-7 files (3 each = 18-21) leaving later files at 0.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-breadth-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });

  // Definition file
  await fs.writeFile(
    path.join(root, 'src', 'def.js'),
    'export function myFunc(x) { return x; }\n',
  );

  // 8 caller files, each with 4 calls
  for (let i = 0; i < 8; i++) {
    const letter = String.fromCharCode(97 + i); // a..h
    const lines = [`import { myFunc } from './def.js';`, ''];
    for (let j = 0; j < 4; j++) {
      lines.push(`myFunc(${i * 10 + j});`);
    }
    await fs.writeFile(path.join(root, 'src', `caller_${letter}.js`), lines.join('\n') + '\n');
  }

  return root;
}

test('spec-026 US2 round-robin breadth: all files represented before any file gets a 2nd slot', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeMultiFileBreadthFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
  await toolkit.initialize([]);

  const result = await toolkit.symbolContext({ symbol: 'myFunc', depth: 1 });

  // 32 candidates total (8 files × 4 calls each), 20-slot output cap, per-file cap 3.
  // True round-robin: round 0 = 1 from each of 8 files (8 slots),
  //                   round 1 = 1 more from each of 8 files (16 slots),
  //                   round 2 = 1 more from each of 8 files (24 — but stop at 20).
  // So 20 selected entries span all 8 files.
  assert.ok(result.callers.length === 20, `expected 20 selected callers, got ${result.callers.length}`);

  const filesRepresented = new Set(result.callers.map(c => c.path));
  assert.equal(
    filesRepresented.size,
    8,
    `round-robin must represent all 8 files; only got ${filesRepresented.size}: ${[...filesRepresented].join(', ')}`,
  );

  for (const [file, count] of Object.entries(
    result.callers.reduce((acc, c) => { acc[c.path] = (acc[c.path] ?? 0) + 1; return acc; }, {}),
  )) {
    assert.ok(count <= 3, `file "${file}" has ${count} entries — must be ≤3`);
  }

  // Determinism: second call must return identical results
  const result2 = await toolkit.symbolContext({ symbol: 'myFunc', depth: 1 });
  assert.deepEqual(result.callers, result2.callers, 'round-robin selection must be deterministic');
});

// ─── Spec 014: repo-specific ignore (nested .gitignore + extraIgnorePatterns) ───

async function makeNestedIgnoreFixture() {
  // Note: avoid `build`, `tmp`, `dist`, `target`, etc — these are in
  // DEFAULT_IGNORE_DIRS and would be excluded regardless of nested rules.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-nested-ignore-'));
  await fs.mkdir(path.join(root, 'packages', 'foo', 'compiled'), { recursive: true });
  await fs.mkdir(path.join(root, 'packages', 'foo', 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'packages', 'bar', 'compiled'), { recursive: true });
  // packages/foo has a .gitignore that excludes compiled/; packages/bar does not.
  await fs.writeFile(path.join(root, 'packages', 'foo', '.gitignore'), 'compiled/\n');
  await fs.writeFile(path.join(root, 'packages', 'foo', 'compiled', 'output.txt'), 'foo-compiled-output');
  await fs.writeFile(path.join(root, 'packages', 'foo', 'src', 'index.js'), '// foo entry\n');
  await fs.writeFile(path.join(root, 'packages', 'bar', 'compiled', 'output.txt'), 'bar-compiled-output');
  await fs.writeFile(path.join(root, 'noisy.txt'), 'top-level noisy file (not a directory)');
  await fs.mkdir(path.join(root, 'noisy'));
  await fs.writeFile(path.join(root, 'noisy', 'note.txt'), 'noisy note');
  await fs.writeFile(path.join(root, 'fixture.snapshot.json'), '{"snap": true}');
  return root;
}

test('Spec 014 — nested .gitignore is prefix-bounded (foo/compiled excluded, bar/compiled kept)', async () => {
  const repoRoot = await makeNestedIgnoreFixture();
  const toolkit = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();

  const found = await toolkit.findFiles({ pattern: '**/*' });
  const paths = found.matches;

  assert.ok(
    !paths.includes('packages/foo/compiled/output.txt'),
    'foo/compiled/output.txt must be excluded by packages/foo/.gitignore',
  );
  assert.ok(
    paths.includes('packages/bar/compiled/output.txt'),
    'bar/compiled/output.txt must remain because packages/bar has no .gitignore',
  );
  assert.ok(
    paths.includes('packages/foo/src/index.js'),
    'foo/src/index.js must be kept (not matched by compiled/ rule)',
  );
});

test('Spec 014 — root .gitignore and nested .gitignore coexist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-nested-ignore-coexist-'));
  await fs.writeFile(path.join(root, '.gitignore'), '*.log\n');
  await fs.mkdir(path.join(root, 'pkg', 'compiled'), { recursive: true });
  await fs.writeFile(path.join(root, 'pkg', '.gitignore'), 'compiled/\n');
  await fs.writeFile(path.join(root, 'pkg', 'compiled', 'artifact.bin'), 'compiled artifact');
  await fs.writeFile(path.join(root, 'app.log'), 'log');
  await fs.writeFile(path.join(root, 'pkg', 'index.js'), '// pkg entry\n');

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();
  const found = await toolkit.findFiles({ pattern: '**/*' });
  assert.ok(!found.matches.includes('app.log'), 'root .gitignore must exclude *.log');
  assert.ok(!found.matches.includes('pkg/compiled/artifact.bin'), 'nested .gitignore must exclude pkg/compiled/');
  assert.ok(found.matches.includes('pkg/index.js'), 'pkg/index.js must be kept');
});

test('Spec 014 — nested .gitignore negation rules (`!keep`) are silently dropped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-nested-ignore-negation-'));
  await fs.mkdir(path.join(root, 'pkg', 'compiled'), { recursive: true });
  // `!keep.js` would override a previous rule in real git, but we silently drop it.
  await fs.writeFile(path.join(root, 'pkg', '.gitignore'), 'compiled/\n!keep.js\n');
  await fs.writeFile(path.join(root, 'pkg', 'compiled', 'output.bin'), 'art');
  await fs.writeFile(path.join(root, 'pkg', 'compiled', 'keep.js'), '// keep me');

  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig() });
  await toolkit.initialize();
  const found = await toolkit.findFiles({ pattern: '**/*' });
  // compiled/ rule still excludes both — negation is dropped, no re-include happens.
  assert.ok(!found.matches.includes('pkg/compiled/keep.js'), 'negation rule must NOT re-include keep.js');
  assert.ok(!found.matches.includes('pkg/compiled/output.bin'), 'compiled/ rule still applies');
});

test('Spec 014 — extraIgnorePatterns glob excludes directory prefix and deep matches', async () => {
  const repoRoot = await makeNestedIgnoreFixture();
  const toolkit = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig(),
    extraIgnorePatterns: ['noisy/**', '**/*.snapshot.json'],
  });
  await toolkit.initialize();

  const found = await toolkit.findFiles({ pattern: '**/*' });
  assert.ok(!found.matches.includes('noisy/note.txt'), 'noisy/** must exclude noisy/note.txt');
  assert.ok(found.matches.includes('noisy.txt'), 'noisy.txt (top-level file) is not matched by noisy/**');
  assert.ok(!found.matches.includes('fixture.snapshot.json'), '**/*.snapshot.json must exclude deep snapshot files');
});

test('Spec 014 — extraIgnorePatterns empty is backwards-compatible', async () => {
  const repoRoot = await makeNestedIgnoreFixture();
  const baseline = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig() });
  await baseline.initialize();
  const baselineFiles = (await baseline.findFiles({ pattern: '**/*' })).matches.sort();

  const withEmpty = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig(),
    extraIgnorePatterns: [],
  });
  await withEmpty.initialize();
  const withEmptyFiles = (await withEmpty.findFiles({ pattern: '**/*' })).matches.sort();
  assert.deepEqual(withEmptyFiles, baselineFiles, 'empty extraIgnorePatterns must produce identical results');
});

test('Spec 014 — secret deny-list cannot be bypassed by extraIgnorePatterns', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-secret-priority-'));
  await fs.writeFile(path.join(root, '.env'), 'API_KEY=should-stay-hidden');
  await fs.writeFile(path.join(root, 'normal.js'), '// keep');

  // The user tries to "un-ignore" .env via negation; spec 014 silently drops `!`
  // entries, and even if it did not, secret deny-list runs *before* the
  // extraIgnorePatterns evaluation in shouldIgnorePath.
  const toolkit = new RepoToolkit({
    repoRoot: root,
    budgetConfig: getBudgetConfig(),
    extraIgnorePatterns: ['!.env'],
  });
  await toolkit.initialize();
  const found = await toolkit.findFiles({ pattern: '**/*' });
  assert.ok(!found.matches.includes('.env'), '.env must remain hidden regardless of extraIgnorePatterns');
  assert.ok(found.matches.includes('normal.js'), 'normal.js is not a secret and must be present');
});

test('Spec 014 follow-up — ripgrep grep fast path excludes extraIgnorePatterns (parity with findFiles)', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeNestedIgnoreFixture();
  await fs.writeFile(path.join(repoRoot, 'fixture.snapshot.json'), '{"marker":"GREP_MARKER"}');
  await fs.writeFile(path.join(repoRoot, 'normal.js'), 'const GREP_MARKER = true;\n');

  const toolkit = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig(),
    extraIgnorePatterns: ['**/*.snapshot.json'],
  });
  await toolkit.initialize([]);
  assert.equal(toolkit._hasRipgrep, true, 'ripgrep must be available for this test');

  const result = await toolkit.grep({ pattern: 'GREP_MARKER' });
  assert.ok(result.matches.some(match => match.path === 'normal.js'), 'normal.js must match GREP_MARKER');
  assert.ok(
    !result.matches.some(match => match.path === 'fixture.snapshot.json'),
    'grep must not surface a path excluded by extraIgnorePatterns',
  );
});

test('Spec 014 follow-up — grep cache keys partition by extraIgnorePatterns', async () => {
  globalRepoCache.clear();
  const repoRoot = await makeNestedIgnoreFixture();
  await fs.writeFile(path.join(repoRoot, 'fixture.snapshot.json'), '{"marker":"CACHE_MARKER"}');
  await fs.writeFile(path.join(repoRoot, 'normal.js'), 'const CACHE_MARKER = true;\n');

  // First toolkit has no extra ignores, so it both matches and caches the snapshot path.
  const open = new RepoToolkit({ repoRoot, budgetConfig: getBudgetConfig(), cache: globalRepoCache });
  await open.initialize([]);
  const openResult = await open.callTool('repo_grep', { pattern: 'CACHE_MARKER' });
  assert.ok(
    openResult.matches.some(match => match.path === 'fixture.snapshot.json'),
    'baseline toolkit (no extra ignores) must match the snapshot file',
  );

  // Second toolkit ignores the snapshot. Without an extraIgnorePatterns fingerprint
  // in the cache key, it would collide with `open`'s entry and wrongly inherit the match.
  const ignored = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig(),
    cache: globalRepoCache,
    extraIgnorePatterns: ['**/*.snapshot.json'],
  });
  await ignored.initialize([]);
  const ignoredResult = await ignored.callTool('repo_grep', { pattern: 'CACHE_MARKER' });
  assert.ok(ignoredResult.matches.some(match => match.path === 'normal.js'), 'ignored toolkit must still match normal.js');
  assert.ok(
    !ignoredResult.matches.some(match => match.path === 'fixture.snapshot.json'),
    'extraIgnorePatterns toolkit must not inherit the snapshot match via a shared cache entry',
  );
});
