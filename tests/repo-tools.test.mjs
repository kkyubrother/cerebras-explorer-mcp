import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getRuntimeConfig } from '../src/explorer/config.mjs';
import * as repoToolExports from '../src/explorer/repo-tools.mjs';
import {
  RepoToolkit,
  canonicalizeRepositoryObservationScope,
  classifySourceRole,
  collectTargetPathsFromToolResult,
  normalizedRepositoryFileIdentity,
  normalizeRepositoryObservation,
} from '../src/explorer/repo-tools.mjs';
import { LruCache, globalRepoCache } from '../src/explorer/cache.mjs';

function repositoryObservationTest(name, callback) {
  test(name, () => {
    callback(normalizeRepositoryObservation);
  });
}

function toolSpecificEnumerationTest(name, optionsOrCallback, maybeCallback) {
  const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;

  test(name, options, async t => {
    const deriveCoverage = repoToolExports.deriveRepositoryObservationCoverage;
    if (deriveCoverage === undefined) {
      t.todo('Spec 028 T060 repository coverage derivation is not implemented yet');
      return;
    }
    assert.equal(typeof deriveCoverage, 'function',
      'a partially exported T060 capability must fail instead of silently skipping');
    await callback(t, deriveCoverage);
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

async function makeEnumerationGitFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-enumeration-git-'));
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, 'src', 'large.js'), 'export const lines = [];\n');
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  await fs.writeFile(path.join(root, '.env'), 'TOKEN=placeholder\n');
  git(['add', '.']);
  git(['commit', '-m', 'initial enumeration fixture']);

  await fs.writeFile(path.join(root, 'src', 'app.js'), 'export const value = 2;\n');
  const largePatch = Array.from({ length: 500 }, (_, index) =>
    `export const item${index} = "${'x'.repeat(24)}";`).join('\n');
  await fs.writeFile(path.join(root, 'src', 'large.js'), `${largePatch}\n`);
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Updated guide\n');
  await fs.writeFile(path.join(root, '.env'), 'TOKEN=changed-placeholder\n');
  git(['add', '.']);
  git(['commit', '-m', 'change scoped and filtered paths']);

  await fs.writeFile(path.join(root, 'src', 'app.js'), 'export const value = 3;\n');
  git(['add', 'src/app.js']);
  git(['commit', '-m', 'change one scoped path']);
  return root;
}

class WalkTelemetryToolkit extends RepoToolkit {
  constructor(options, telemetry = {}) {
    super(options);
    this.injectedWalkTelemetry = telemetry;
  }

  async walkFiles(args = {}) {
    const result = await super.walkFiles(args);
    return {
      ...result,
      ...this.injectedWalkTelemetry,
      truncated: Boolean(result.truncated || this.injectedWalkTelemetry.truncated),
    };
  }
}

class GrepTelemetryToolkit extends RepoToolkit {
  constructor(options, telemetry = {}) {
    super(options);
    this.injectedGrepTelemetry = telemetry;
  }

  async grep(args = {}) {
    const result = await super.grep(args);
    return {
      ...result,
      ...this.injectedGrepTelemetry,
      truncated: Boolean(result.truncated || this.injectedGrepTelemetry.truncated),
    };
  }
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
    'normalizedItemAnchors',
    'normalizedItemIds',
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
  assert.equal(observation.normalizedItemIds.length, 2);
  assert.ok(observation.normalizedItemIds.every(item => /^sha256:[0-9a-f]{64}$/.test(item)));
  assert.notEqual(observation.normalizedItemIds[0], observation.normalizedItemIds[1]);
  assert.deepEqual(observation.normalizedItemAnchors, [
    { path: 'src/auth.js', line: 1 },
    { path: 'src/routes/user.js', line: 2 },
  ]);
  assert.equal(observation.toolTruncated, false);
  assert.equal(observation.contextTruncated, false);
  assert.equal(observation.omittedOutOfScopeFiles, 0);
  assert.equal(observation.deniedPaths, 0);
  assert.equal(observation.errors, 0);
  assert.equal(observation.enumerationComplete, true);
});

repositoryObservationTest('count identities come only from valid grep and file-search results', normalize => {
  const files = normalize({
    id: 'search-files',
    tool: 'repo_find_files',
    args: { pattern: '**/*.mjs' },
    boundary: ['src/**'],
    enumerationCandidate: true,
    result: {
      matches: ['src/a.mjs', 'src/b.mjs', 'src/a.mjs'],
      truncated: false,
    },
  });
  assert.equal(files.normalizedItemIds.length, 3);
  assert.ok(files.normalizedItemIds.every(item => /^sha256:[0-9a-f]{64}$/.test(item)));
  assert.equal(files.normalizedItemIds[0], files.normalizedItemIds[2]);
  assert.notEqual(files.normalizedItemIds[0], files.normalizedItemIds[1]);
  assert.equal(files.normalizedItemIds[0], normalizedRepositoryFileIdentity('src/a.mjs'));
  assert.equal(Object.hasOwn(files, 'normalizedItemAnchors'), false,
    'file counts do not expose line anchors');

  const secretPath = normalize({
    id: 'search-secret-file',
    tool: 'repo_find_files',
    args: { pattern: '**/*' },
    boundary: ['**'],
    enumerationCandidate: true,
    result: { matches: ['.env'], truncated: false },
  });
  assert.equal(Object.hasOwn(secretPath, 'normalizedItemIds'), false,
    'a deny-listed result path must never become a count identity');
  assert.doesNotMatch(JSON.stringify(secretPath), /\.env/);

  for (const [tool, matches] of [
    ['repo_find_files', ['outside/escape.mjs']],
    ['repo_grep', [{ path: 'outside/escape.mjs', line: 1 }]],
  ]) {
    const outOfBoundary = normalize({
      id: `search-out-of-boundary-${tool}`,
      tool,
      args: tool === 'repo_grep'
        ? { pattern: 'needle', scope: ['src/**'] }
        : { pattern: '**/*.mjs', scope: ['src/**'] },
      boundary: ['src/**'],
      enumerationCandidate: true,
      result: { matches, truncated: false },
    });
    assert.equal(Object.hasOwn(outOfBoundary, 'normalizedItemIds'), false);
    assert.equal(Object.hasOwn(outOfBoundary, 'normalizedItemAnchors'), false);
    assert.equal(outOfBoundary.enumerationComplete, false,
      'an out-of-boundary result can never certify an exact count');
    assert.doesNotMatch(JSON.stringify(outOfBoundary), /outside|escape/u,
      'invalid result paths stay out of normalized observations');
  }
});

test('repository file identities canonicalize safe relative paths and reject unsafe paths', () => {
  assert.equal(
    normalizedRepositoryFileIdentity('.\\src\\routes\\user.js'),
    normalizedRepositoryFileIdentity('src/routes/user.js'),
  );
  assert.match(normalizedRepositoryFileIdentity('src/routes/user.js'), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(normalizedRepositoryFileIdentity('../outside.js'), null);
  assert.equal(normalizedRepositoryFileIdentity('.env'), null);
});

test('repository observation scopes canonicalize repository-wide and equivalent path forms', () => {
  assert.deepEqual(canonicalizeRepositoryObservationScope([]), ['**']);
  assert.deepEqual(canonicalizeRepositoryObservationScope(['.']), ['**']);
  assert.deepEqual(canonicalizeRepositoryObservationScope([
    'ui\\pages\\marketing\\**\\',
    'ui/pages/marketing/**/',
    'ui/pages/marketing/**',
  ]), ['ui/pages/marketing/**']);
});

repositoryObservationTest('static string-array definitions expose a runtime-owned exact count', normalize => {
  const result = {
    symbol: 'DEFAULT_SECRET_DENY_PATTERNS',
    definition: {
      path: 'src/security.mjs',
      line: 10,
      endLine: 15,
      content: [
        'export const DEFAULT_SECRET_DENY_PATTERNS = Object.freeze([',
        "  '.env',",
        "  'comma,inside',",
        '  // comments and escaped delimiters are not entries',
        "  'quote\\\'inside',",
        ']);',
      ].join('\n'),
    },
    callers: [],
    callerCount: 0,
    truncated: false,
  };
  const observation = normalize({
    id: 'symbol-array',
    tool: 'repo_symbol_context',
    args: { symbol: 'DEFAULT_SECRET_DENY_PATTERNS', scope: ['src/security.mjs'] },
    boundary: ['src/security.mjs'],
    enumerationCandidate: true,
    result,
  });

  assert.equal(observation.enumerationComplete, true);
  assert.deepEqual(observation.deterministicMeasurement, {
    kind: 'count',
    unit: 'array_entries',
    value: 3,
  });
  assert.equal(observation.normalizedItemIds.length, 3);
  assert.ok(observation.normalizedItemIds.every(item => /^sha256:[0-9a-f]{64}$/.test(item)));

  for (const content of [
    "export const ITEMS = ['safe', ...dynamicItems];",
    "export const ITEMS = ['safe' + getValue()];",
    "export const ITEMS = ['unterminated'",
  ]) {
    const rejected = normalize({
      id: `rejected-${content.length}`,
      tool: 'repo_symbol_context',
      args: { symbol: 'ITEMS', scope: ['src/items.mjs'] },
      boundary: ['src/items.mjs'],
      enumerationCandidate: true,
      result: {
        symbol: 'ITEMS',
        definition: { path: 'src/items.mjs', line: 1, endLine: 1, content },
        callers: [],
        callerCount: 0,
        truncated: false,
      },
    });
    assert.equal(Object.hasOwn(rejected, 'deterministicMeasurement'), false);
    assert.equal(Object.hasOwn(rejected, 'normalizedItemIds'), false);
  }
});

test('Spec 028 T068 — the pinned current secret policy has 70 statically provable entries', async () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
  await toolkit.initialize(['src/explorer/security.mjs']);

  const result = await toolkit.symbolContext({
    symbol: 'DEFAULT_SECRET_DENY_PATTERNS',
    path: 'src/explorer/security.mjs',
  });
  const observation = normalizeRepositoryObservation({
    id: 'current-secret-policy',
    tool: 'repo_symbol_context',
    args: {
      symbol: 'DEFAULT_SECRET_DENY_PATTERNS',
      path: 'src/explorer/security.mjs',
    },
    boundary: ['src/explorer/security.mjs'],
    enumerationCandidate: true,
    result,
  });

  assert.equal(result.definition.path, 'src/explorer/security.mjs');
  assert.equal(result.definition.line, 43);
  assert.equal(result.definition.endLine, 117);
  assert.deepEqual(observation.deterministicMeasurement, {
    kind: 'count',
    unit: 'array_entries',
    value: 70,
  });
  assert.equal(observation.normalizedItemIds.length, 70);
  assert.equal(new Set(observation.normalizedItemIds).size, 70);
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

toolSpecificEnumerationTest(
  'Spec 028 T058 — grep/find preserve distinct walk and result limits plus omission telemetry',
  async (t, deriveCoverage) => {
    const root = await makeRepoFixture();
    try {
      const runtimeConfig = getRuntimeConfig();
      const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig });
      await toolkit.initialize(['src/**']);
      toolkit._hasRipgrep = false;

      const walk = await toolkit.walkFiles({ scope: ['src/routes/**'] });
      assert.equal(walk.walkTruncated, false,
        'walk telemetry must explicitly distinguish a complete traversal');

      const findArgs = { pattern: '**/*.js', scope: ['src/routes/**'] };
      const found = await toolkit.findFiles(findArgs);
      assert.equal(found.walkTruncated, false);
      assert.equal(found.resultTruncated, false);
      const findCoverage = deriveCoverage({
        tool: 'repo_find_files',
        args: findArgs,
        result: { ...found, boundary: ['**'], enumerationComplete: false },
        effectiveScope: ['src/routes/**'],
        contextTruncated: false,
      });
      assert.deepEqual(findCoverage.boundary, ['src/routes/**'],
        'the runtime boundary must win over a result self-report');
      assert.equal(findCoverage.toolTruncated, false);
      assert.equal(findCoverage.enumerationComplete, true);

      const grepArgs = { pattern: 'requireAuth', scope: ['src/routes/**'] };
      const grepped = await toolkit.grep(grepArgs);
      assert.equal(grepped.walkTruncated, false);
      assert.equal(grepped.resultTruncated, false);
      const grepCoverage = deriveCoverage({
        tool: 'repo_grep',
        args: grepArgs,
        result: grepped,
        effectiveScope: ['src/routes/**'],
        contextTruncated: false,
      });
      assert.deepEqual(grepCoverage.boundary, ['src/routes/**']);
      assert.equal(grepCoverage.enumerationComplete, true);

      const baseAliasArgs = { pattern: 'requireAuth', scope: ['src'] };
      const baseAlias = await toolkit.grep(baseAliasArgs);
      const baseAliasCoverage = deriveCoverage({
        tool: 'repo_grep',
        args: baseAliasArgs,
        result: baseAlias,
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.deepEqual(baseAliasCoverage.boundary, ['src/**'],
        'a literal local scope equal to the effective glob prefix is the same boundary');
      assert.equal(baseAliasCoverage.enumerationComplete, true);

      const walkLimitedConfig = { ...runtimeConfig, maxWalkFiles: 1 };
      const walkLimited = new RepoToolkit({ repoRoot: root, runtimeConfig: walkLimitedConfig });
      await walkLimited.initialize(['src/**']);
      walkLimited._hasRipgrep = false;
      const limitedWalk = await walkLimited.walkFiles();
      assert.equal(limitedWalk.walkTruncated, true);

      for (const [tool, args, result] of [
        ['repo_find_files', { pattern: '**/*.js' }, await walkLimited.findFiles({ pattern: '**/*.js' })],
        ['repo_grep', { pattern: 'requireAuth' }, await walkLimited.grep({ pattern: 'requireAuth' })],
      ]) {
        assert.equal(result.walkTruncated, true, `${tool} must preserve the underlying walk limit`);
        assert.equal(result.resultTruncated, false,
          `${tool} must not mislabel an underlying walk limit as a result cap`);
        const coverage = deriveCoverage({
          tool,
          args,
          result,
          effectiveScope: ['src/**'],
          contextTruncated: false,
        });
        assert.equal(coverage.toolTruncated, true);
        assert.equal(coverage.enumerationComplete, false);
      }

      const resultLimitedConfig = { ...runtimeConfig, maxSearchResults: 1 };
      const resultLimited = new RepoToolkit({ repoRoot: root, runtimeConfig: resultLimitedConfig });
      await resultLimited.initialize(['src/**']);
      resultLimited._hasRipgrep = false;
      for (const [tool, args, result] of [
        ['repo_find_files', { pattern: '**/*.js' }, await resultLimited.findFiles({ pattern: '**/*.js' })],
        ['repo_grep', { pattern: 'requireAuth' }, await resultLimited.grep({ pattern: 'requireAuth' })],
      ]) {
        assert.equal(result.walkTruncated, false,
          `${tool} must preserve that the traversal itself completed`);
        assert.equal(result.resultTruncated, true, `${tool} must expose its own result cap`);
        const coverage = deriveCoverage({
          tool,
          args,
          result,
          effectiveScope: ['src/**'],
          contextTruncated: false,
        });
        assert.equal(coverage.toolTruncated, true);
        assert.equal(coverage.enumerationComplete, false);
      }

      const omissionCases = [
        { telemetry: { errors: 1 }, resultField: 'errors', coverageField: 'errors' },
        { telemetry: { omittedSecretPaths: 1 }, resultField: 'omittedSecretPaths', coverageField: 'deniedPaths' },
        { telemetry: { omittedOutOfScopeFiles: 1 }, resultField: 'omittedOutOfScopeFiles', coverageField: 'omittedOutOfScopeFiles' },
      ];
      for (const { telemetry, resultField, coverageField } of omissionCases) {
        const affected = new WalkTelemetryToolkit({ repoRoot: root, runtimeConfig }, telemetry);
        await affected.initialize(['src/**']);
        affected._hasRipgrep = false;
        for (const [tool, args, result] of [
          ['repo_find_files', { pattern: '**/*.js' }, await affected.findFiles({ pattern: '**/*.js' })],
          ['repo_grep', { pattern: 'requireAuth' }, await affected.grep({ pattern: 'requireAuth' })],
        ]) {
          assert.equal(result[resultField], 1, `${tool} must retain ${resultField} from traversal`);
          const coverage = deriveCoverage({
            tool,
            args,
            result,
            effectiveScope: ['src/**'],
            contextTruncated: false,
          });
          assert.equal(coverage[coverageField], 1);
          assert.equal(coverage.enumerationComplete, false);
        }
      }

      await fs.writeFile(path.join(root, '.env'), 'TOKEN=denied-marker\n');
      const denied = new RepoToolkit({ repoRoot: root, runtimeConfig });
      await denied.initialize(['**']);
      denied._hasRipgrep = false;
      const deniedWalk = await denied.walkFiles();
      assert.equal(deniedWalk.omittedSecretPaths, 1,
        'the traversal must count a denied path without exposing its name');
      for (const [tool, args, result] of [
        ['repo_find_files', { pattern: '**/*' }, await denied.findFiles({ pattern: '**/*' })],
        ['repo_grep', { pattern: 'denied-marker' }, await denied.grep({ pattern: 'denied-marker' })],
      ]) {
        assert.equal(result.omittedSecretPaths, 1, `${tool} must preserve traversal denials`);
        const coverage = deriveCoverage({
          tool,
          args,
          result,
          effectiveScope: ['**'],
          contextTruncated: false,
        });
        assert.equal(coverage.deniedPaths, 1);
        assert.equal(coverage.enumerationComplete, false);
        assert.doesNotMatch(JSON.stringify(coverage), /\.env|denied-marker/);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

toolSpecificEnumerationTest(
  'Spec 028 T058 — symbol and reference operations stay conservative and propagate search failures',
  async (t, deriveCoverage) => {
    const root = await makeRepoFixture();
    try {
      const runtimeConfig = getRuntimeConfig();
      const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig });
      await toolkit.initialize(['src/**']);
      toolkit._hasRipgrep = false;

      const symbolArgs = { path: 'src/auth.js' };
      const symbols = await toolkit.symbols(symbolArgs);
      const symbolCoverage = deriveCoverage({
        tool: 'repo_symbols',
        args: symbolArgs,
        result: { ...symbols, boundary: ['**'], enumerationComplete: true },
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.deepEqual(symbolCoverage.boundary, ['src/auth.js']);
      assert.equal(symbolCoverage.enumerationComplete, false,
        'heuristic symbol extraction must not certify semantic exhaustiveness');

      const referenceArgs = { symbol: 'requireAuth' };
      const references = await toolkit.references(referenceArgs);
      assert.equal(references.walkTruncated, false);
      assert.equal(references.resultTruncated, false);
      const referenceCoverage = deriveCoverage({
        tool: 'repo_references',
        args: referenceArgs,
        result: { ...references, boundary: ['**'], enumerationComplete: true },
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.deepEqual(referenceCoverage.boundary, ['src/**']);
      assert.equal(referenceCoverage.enumerationComplete, false,
        'reference search alone cannot prove semantic or dynamic-call exhaustiveness');

      const searchFailureCases = [
        { telemetry: { walkTruncated: true, truncated: true }, resultField: 'walkTruncated', coverageField: 'toolTruncated' },
        { telemetry: { resultTruncated: true, truncated: true }, resultField: 'resultTruncated', coverageField: 'toolTruncated' },
        { telemetry: { errors: 1 }, resultField: 'errors', coverageField: 'errors' },
        { telemetry: { omittedSecretPaths: 1 }, resultField: 'omittedSecretPaths', coverageField: 'deniedPaths' },
        { telemetry: { omittedOutOfScopeFiles: 1 }, resultField: 'omittedOutOfScopeFiles', coverageField: 'omittedOutOfScopeFiles' },
      ];
      for (const { telemetry, resultField, coverageField } of searchFailureCases) {
        const affected = new GrepTelemetryToolkit({ repoRoot: root, runtimeConfig }, telemetry);
        await affected.initialize(['src/**']);
        affected._hasRipgrep = false;
        const result = await affected.references(referenceArgs);
        assert.equal(result[resultField], telemetry[resultField],
          `repo_references must retain underlying ${resultField}`);
        const coverage = deriveCoverage({
          tool: 'repo_references',
          args: referenceArgs,
          result,
          effectiveScope: ['src/**'],
          contextTruncated: false,
        });
        assert.equal(coverage[coverageField], coverageField === 'toolTruncated' ? true : 1);
        assert.equal(coverage.enumerationComplete, false);
      }

      await fs.writeFile(path.join(root, '.env'), 'TOKEN=placeholder\n');
      const unrestricted = new RepoToolkit({ repoRoot: root, runtimeConfig });
      await unrestricted.initialize(['**']);
      const deniedResult = await unrestricted.symbols({ path: '.env' });
      const deniedCoverage = deriveCoverage({
        tool: 'repo_symbols',
        args: { path: '.env' },
        result: deniedResult,
        effectiveScope: ['**'],
        contextTruncated: false,
      });
      assert.equal(deniedCoverage.deniedPaths, 1);
      assert.equal(deniedCoverage.enumerationComplete, false);
      assert.doesNotMatch(JSON.stringify(deniedCoverage), /\.env/,
        'coverage telemetry must count a denial without leaking the denied path');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

toolSpecificEnumerationTest(
  'Spec 028 T058 — macros certify only explicitly complete underlying expansion',
  async (t, deriveCoverage) => {
    const root = await makeRepoFixture();
    try {
      const runtimeConfig = getRuntimeConfig();
      const args = { symbol: 'requireAuth' };
      const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig });
      await toolkit.initialize(['src/**']);
      toolkit._hasRipgrep = false;

      const complete = await toolkit.symbolContext(args);
      assert.equal(complete.walkTruncated, false);
      assert.equal(complete.resultTruncated, false);
      assert.equal(complete.macroTruncated, false);
      const completeCoverage = deriveCoverage({
        tool: 'repo_symbol_context',
        args,
        result: complete,
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.deepEqual(completeCoverage.boundary, ['src/**']);
      assert.equal(completeCoverage.enumerationComplete, true);

      const largeCallerPath = path.join(root, 'src', 'large-caller.js');
      await fs.writeFile(
        largeCallerPath,
        `${'// filler\n'.repeat(35_000)}export function largeCaller() { return requireAuth(); }\n`,
      );
      const largeCallerSize = (await fs.stat(largeCallerPath)).size;
      assert.ok(largeCallerSize > 256 * 1024 && largeCallerSize < 512 * 1024,
        'the regression fixture must remain between the former grep and read ceilings');
      const largeFileContext = await toolkit.symbolContext(args);
      assert.equal(largeFileContext.resultTruncated, false,
        'a readable source file must not make a base-scope symbol search incomplete');
      assert.ok(largeFileContext.callers.some(caller => caller.path === 'src/large-caller.js'));
      const largeFileCoverage = deriveCoverage({
        tool: 'repo_symbol_context',
        args,
        result: largeFileContext,
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.equal(largeFileCoverage.enumerationComplete, true);
      await fs.rm(largeCallerPath);

      const manyCallers = Array.from({ length: 25 }, (_, index) =>
        `export function caller${index}() { requireAuth(); }`).join('\n');
      await fs.writeFile(path.join(root, 'src', 'many-callers.js'), `${manyCallers}\n`);
      const cappedToolkit = new RepoToolkit({ repoRoot: root, runtimeConfig });
      await cappedToolkit.initialize(['src/**']);
      cappedToolkit._hasRipgrep = false;
      const capped = await cappedToolkit.symbolContext(args);
      assert.equal(capped.walkTruncated, false);
      assert.equal(capped.resultTruncated, false);
      assert.equal(capped.macroTruncated, true,
        'macro-local caller caps must remain distinct from underlying search caps');
      const cappedCoverage = deriveCoverage({
        tool: 'repo_symbol_context',
        args,
        result: { ...capped, truncated: false, boundary: ['**'], enumerationComplete: true },
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.deepEqual(cappedCoverage.boundary, ['src/**']);
      assert.equal(cappedCoverage.toolTruncated, true);
      assert.equal(cappedCoverage.enumerationComplete, false,
        'a macro self-report cannot override its runtime-observed caller cap');

      const underlyingFailureCases = [
        { telemetry: { walkTruncated: true, truncated: true }, resultField: 'walkTruncated', coverageField: 'toolTruncated' },
        { telemetry: { resultTruncated: true, truncated: true }, resultField: 'resultTruncated', coverageField: 'toolTruncated' },
        { telemetry: { errors: 1 }, resultField: 'errors', coverageField: 'errors' },
        { telemetry: { omittedSecretPaths: 1 }, resultField: 'omittedSecretPaths', coverageField: 'deniedPaths' },
        { telemetry: { omittedOutOfScopeFiles: 1 }, resultField: 'omittedOutOfScopeFiles', coverageField: 'omittedOutOfScopeFiles' },
      ];
      for (const { telemetry, resultField, coverageField } of underlyingFailureCases) {
        const affected = new GrepTelemetryToolkit({ repoRoot: root, runtimeConfig }, telemetry);
        await affected.initialize(['src/**']);
        affected._hasRipgrep = false;
        const result = await affected.symbolContext(args);
        assert.equal(result[resultField], telemetry[resultField],
          `repo_symbol_context must retain underlying ${resultField}`);
        const coverage = deriveCoverage({
          tool: 'repo_symbol_context',
          args,
          result,
          effectiveScope: ['src/**'],
          contextTruncated: false,
        });
        assert.equal(coverage[coverageField], coverageField === 'toolTruncated' ? true : 1);
        assert.equal(coverage.enumerationComplete, false);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

toolSpecificEnumerationTest(
  'Spec 028 T058 — scoped git completeness is limited to the exact historical slice',
  { skip: !hasGit() },
  async (t, deriveCoverage) => {
    const root = await makeEnumerationGitFixture();
    try {
      const runtimeConfig = getRuntimeConfig();
      const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig });
      await toolkit.initialize(['src/**']);

      const gitSlices = [
        {
          tool: 'repo_git_diff',
          args: { from: 'HEAD~1', to: 'HEAD', path: 'src/app.js' },
          result: await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD', path: 'src/app.js' }),
          boundary: ['src/app.js'],
        },
        {
          tool: 'repo_git_show',
          args: { ref: 'HEAD' },
          result: await toolkit.gitShow({ ref: 'HEAD' }),
          boundary: ['src/**'],
        },
        {
          tool: 'repo_git_blame',
          args: { path: 'src/app.js', startLine: 1, endLine: 1 },
          result: await toolkit.gitBlame({ path: 'src/app.js', startLine: 1, endLine: 1 }),
          boundary: ['src/app.js'],
        },
        {
          tool: 'repo_git_log',
          args: { path: 'src/app.js', maxCount: 10 },
          result: await toolkit.gitLog({ path: 'src/app.js', maxCount: 10 }),
          boundary: ['src/app.js'],
        },
      ];
      for (const { tool, args, result, boundary } of gitSlices) {
        assert.equal(result.resultTruncated, false, `${tool} must expose a complete result slice`);
        const coverage = deriveCoverage({
          tool,
          args,
          result: { ...result, boundary: ['**'], enumerationComplete: false },
          effectiveScope: ['src/**'],
          contextTruncated: false,
        });
        assert.deepEqual(coverage.boundary, boundary);
        assert.equal(coverage.enumerationComplete, true,
          `${tool} may certify only its explicit historical slice`);
      }

      const broadArgs = { from: 'HEAD~2', to: 'HEAD~1' };
      const filtered = await toolkit.gitDiff(broadArgs);
      assert.ok(filtered.omittedOutOfScopeFiles > 0);
      assert.ok(filtered.omittedSecretPaths > 0);
      const filteredCoverage = deriveCoverage({
        tool: 'repo_git_diff',
        args: broadArgs,
        result: filtered,
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.ok(filteredCoverage.omittedOutOfScopeFiles > 0);
      assert.ok(filteredCoverage.deniedPaths > 0);
      assert.equal(filteredCoverage.enumerationComplete, false);

      const largeArgs = { from: 'HEAD~2', to: 'HEAD~1', path: 'src/large.js' };
      const limited = await toolkit.gitDiff(largeArgs);
      assert.equal(limited.resultTruncated, true,
        'per-file patch clipping must be retained as explicit result telemetry');
      const limitedCoverage = deriveCoverage({
        tool: 'repo_git_diff',
        args: largeArgs,
        result: limited,
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.equal(limitedCoverage.toolTruncated, true);
      assert.equal(limitedCoverage.enumerationComplete, false);

      const limitedLogArgs = { path: 'src/app.js', maxCount: 1 };
      const limitedLog = await toolkit.gitLog(limitedLogArgs);
      assert.equal(limitedLog.resultTruncated, true,
        'git log must query enough metadata to distinguish a full slice from its maxCount cap');
      const limitedLogCoverage = deriveCoverage({
        tool: 'repo_git_log',
        args: limitedLogArgs,
        result: limitedLog,
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.equal(limitedLogCoverage.toolTruncated, true);
      assert.equal(limitedLogCoverage.enumerationComplete, false);

      let errorResult;
      try {
        await toolkit.gitDiff({ from: 'missing-ref', to: 'HEAD', path: 'src/app.js' });
        assert.fail('invalid git history lookup should fail');
      } catch (error) {
        errorResult = {
          error: true,
          stage: 'parse_or_exec',
          type: 'tool_execution_error',
          message: error.message,
          tool: 'repo_git_diff',
        };
      }
      const errorCoverage = deriveCoverage({
        tool: 'repo_git_diff',
        args: { from: 'missing-ref', to: 'HEAD', path: 'src/app.js' },
        result: errorResult,
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.equal(errorCoverage.errors, 1);
      assert.equal(errorCoverage.enumerationComplete, false);

      await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Docs only\n');
      const git = args => execFileSync('git', args, {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      git(['add', 'docs/guide.md']);
      git(['commit', '-m', 'docs only change']);

      const directoryLogArgs = { path: 'src', maxCount: 10 };
      const directoryLog = await toolkit.gitLog(directoryLogArgs);
      assert.equal(directoryLog.resultTruncated, false);
      assert.equal(directoryLog.commits.some(commit => commit.message === 'docs only change'), false,
        'a scope-root directory log must use the immutable scope pathspec');
      const directoryLogCoverage = deriveCoverage({
        tool: 'repo_git_log',
        args: directoryLogArgs,
        result: directoryLog,
        effectiveScope: ['src/**'],
        contextTruncated: false,
      });
      assert.deepEqual(directoryLogCoverage.boundary, ['src/**']);
      assert.equal(directoryLogCoverage.enumerationComplete, true);
      await assert.rejects(toolkit.gitLog({ path: 'docs', maxCount: 10 }),
        /outside current scope/);

      await fs.mkdir(path.join(root, 'src', 'private'), { recursive: true });
      await fs.mkdir(path.join(root, 'src', 'public'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'private', 'inside.js'),
        'export const inside = true;\n');
      git(['add', 'src/private/inside.js']);
      git(['commit', '-m', 'private scoped change']);
      await fs.writeFile(path.join(root, 'src', 'public', 'outside.js'),
        'export const outside = true;\n');
      git(['add', 'src/public/outside.js']);
      git(['commit', '-m', 'public sibling change']);

      const privateToolkit = new RepoToolkit({ repoRoot: root, runtimeConfig });
      await privateToolkit.initialize(['src/private/**']);
      const privateDirectoryLog = await privateToolkit.gitLog({ path: 'src', maxCount: 10 });
      assert.equal(privateDirectoryLog.commits.some(commit =>
        commit.message === 'private scoped change'), true);
      assert.equal(privateDirectoryLog.commits.some(commit =>
        commit.message === 'public sibling change'), false,
        'an ancestor directory request must not broaden a narrower immutable scope');
      const privateDirectoryCoverage = deriveCoverage({
        tool: 'repo_git_log',
        args: { path: 'src', maxCount: 10 },
        result: privateDirectoryLog,
        effectiveScope: ['src/private/**'],
        contextTruncated: false,
      });
      assert.deepEqual(privateDirectoryCoverage.boundary, ['src/private/**']);
      assert.equal(privateDirectoryCoverage.enumerationComplete, true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test('Spec 028 T029 — source roles use conservative path segments and suffixes', () => {
  const fixtures = new Map([
    ['generated/client/index.ts', 'generated'],
    ['tests/fixtures/auth-response.json', 'fixture'],
    ['docs/local-e2e-test.md', 'documentation'],
    ['tests/test_cli.py', 'test'],
    ['src/auth.spec.mjs', 'test'],
    ['pipeline/config.py', 'config'],
    ['app/my_lib/config.py', 'config'],
    ['config/defaults.mjs', 'config'],
    ['prisma/schema.prisma', 'config'],
    ['requirements.txt', 'config'],
    ['kiro/pipeline-runner.json', 'config'],
    ['src/contest.mjs', 'implementation'],
    ['src/specialist.ts', 'implementation'],
    ['assets/logo.png', 'unknown'],
  ]);

  for (const [sourcePath, expected] of fixtures) {
    assert.equal(classifySourceRole(sourcePath), expected, sourcePath);
  }
  assert.equal(classifySourceRole(''), 'unknown');
  assert.equal(classifySourceRole(null), 'unknown');
});

test('RepoToolkit finds files, greps, reads ranges, and respects gitignore', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({
    repoRoot,
    runtimeConfig: getRuntimeConfig(),
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

test('RepoToolkit fallback grep shares the readable text ceiling for exact and broad scopes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-exact-grep-'));
  try {
    await fs.mkdir(path.join(root, 'prisma'), { recursive: true });
    const mediumContent = `${'// filler\n'.repeat(35_000)}model mkt_source {\n  id Int @id\n}\n`;
    const oversizedContent = `${'// filler\n'.repeat(60_000)}model oversized {\n  id Int @id\n}\n`;
    await fs.writeFile(path.join(root, 'prisma', 'schema.prisma'), mediumContent);
    await fs.writeFile(path.join(root, 'prisma', 'oversized.prisma'), oversizedContent);

    const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
    await toolkit.initialize(['prisma/**']);
    toolkit._hasRipgrep = false;

    const exact = await toolkit.grep({
      pattern: '^model mkt_source',
      scope: ['prisma/schema.prisma'],
    });
    assert.deepEqual(exact.matches.map(match => match.path), ['prisma/schema.prisma']);
    assert.equal(exact.skipped.largeFiles, 0);
    assert.equal(exact.truncated, false);

    const broad = await toolkit.grep({
      pattern: '^model mkt_source',
      scope: ['prisma/**'],
    });
    assert.deepEqual(broad.matches.map(match => match.path), ['prisma/schema.prisma']);
    assert.equal(broad.skipped.largeFiles, 1);
    assert.equal(broad.truncated, true);

    const oversized = await toolkit.grep({
      pattern: '^model oversized',
      scope: ['prisma/oversized.prisma'],
    });
    assert.deepEqual(oversized.matches, []);
    assert.equal(oversized.skipped.largeFiles, 1);
    assert.equal(oversized.truncated, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('RepoToolkit enforces the initial scope as a hard boundary', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({
    repoRoot,
    runtimeConfig: getRuntimeConfig(),
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
    runtimeConfig: getRuntimeConfig(),
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
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
  await toolkit.initialize();

  const log = await toolkit.gitLog({ path: 'hello.js', maxCount: 5 });
  assert.ok(log.commits.length >= 1, 'has commits for hello.js');
  assert.ok(log.commits.some(c => c.message.includes('greeting')), 'second commit found');
});

test('RepoToolkit git tools: gitBlame returns line authorship', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
  await toolkit.initialize();

  const show = await toolkit.gitShow({ ref: 'HEAD' });

  assert.ok(show.files.some(f => f.path === 'hello.js'), 'normal show output is still parsed');
  await assert.rejects(fs.stat(markerPath), /ENOENT/, 'configured external diff command must not run');
});

test('RepoToolkit git tools: gitShow returns commit details', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

  const toolkitA = new RepoToolkit({ repoRoot: repoA, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
  await toolkitA.initialize(['src/**']);
  const toolkitB = new RepoToolkit({ repoRoot: repoB, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
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
  const toolkitFull = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
  await toolkitFull.initialize([]);

  const fullResult = await toolkitFull.callTool('repo_read_file', { path: 'docs/auth.md' });
  assert.ok(fullResult.content.includes('Auth'), 'full toolkit reads docs/auth.md');

  // Toolkit with src/** scope should reject docs/auth.md even if it was cached
  const toolkitSrc = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
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
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
  await toolkit.initialize(['src/**', 'docs/**']);

  const result1 = await toolkit.callTool('repo_grep', { pattern: 'requireAuth', maxResults: 1 });
  assert.equal(result1.matches.length, 1, 'maxResults:1 returns 1 match');

  const result10 = await toolkit.callTool('repo_grep', { pattern: 'requireAuth', maxResults: 10 });
  assert.ok(result10.matches.length > 1, 'maxResults:10 returns more matches (not polluted by maxResults:1 cache)');
});

test('find_files cache key includes maxResults', async () => {
  globalRepoCache.clear();
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
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

  const toolkitA = new RepoToolkit({ repoRoot: repoA, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
  await toolkitA.initialize(['src/**']);
  const toolkitB = new RepoToolkit({ repoRoot: repoB, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
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
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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

test('RepoToolkit rejects undeclared repo_grep fields instead of widening the search', async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
  await toolkit.initialize([]);

  await assert.rejects(
    toolkit.callTool('repo_grep', {
      pattern: 'requireAuth',
      path: 'src/auth.js',
    }),
    /Invalid tool arguments for repo_grep: unexpected field "path".*scope/u,
  );
});

// --- Phase 2: Scope Hard Boundary Tests ---

test('RepoToolkit grep with ripgrep respects initialize base scope', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig(), extraIgnoreDirs: ['vendor'] });
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

  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
  await toolkit.initialize(['docs/**']);

  await assert.rejects(
    toolkit.gitLog({ path: 'hello.js' }),
    /outside current scope/,
  );
});

test('RepoToolkit gitBlame rejects out-of-scope path', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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
  const toolkit = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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

  const toolkit = new RepoToolkit({ repoRoot: root, runtimeConfig: getRuntimeConfig() });
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
    runtimeConfig: getRuntimeConfig(),
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
  const baseline = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig() });
  await baseline.initialize();
  const baselineFiles = (await baseline.findFiles({ pattern: '**/*' })).matches.sort();

  const withEmpty = new RepoToolkit({
    repoRoot,
    runtimeConfig: getRuntimeConfig(),
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
    runtimeConfig: getRuntimeConfig(),
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
    runtimeConfig: getRuntimeConfig(),
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
  const open = new RepoToolkit({ repoRoot, runtimeConfig: getRuntimeConfig(), cache: globalRepoCache });
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
    runtimeConfig: getRuntimeConfig(),
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
