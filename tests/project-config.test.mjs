import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getRepoRoot,
  getRuntimeConfig,
  loadProjectConfig,
  normalizeProjectConfig,
  resolveRepoRoot,
} from '../src/explorer/config.mjs';
import * as configModule from '../src/explorer/config.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-config-'));
}

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('Spec 028 T008 — structured runtime limits are fixed, unlabeled, and not effort controls', async () => {
  const baseline = getRuntimeConfig();
  assert.deepEqual(baseline, {
    maxTurns: 30,
    maxSearchResults: 80,
    maxReadLines: 320,
    maxDirectoryEntries: 300,
    maxWalkFiles: 6000,
    maxCompletionTokens: 16_384,
    finalizeMaxCompletionTokens: 3000,
    maxContextTokens: 110_000,
    temperature: 1.0,
    topP: 0.95,
  });
  const fixedLimitKeys = [
    'maxTurns',
    'maxSearchResults',
    'maxReadLines',
    'maxDirectoryEntries',
    'maxWalkFiles',
    'maxCompletionTokens',
    'finalizeMaxCompletionTokens',
    'maxContextTokens',
  ];

  for (const key of fixedLimitKeys) {
    assert.equal(Number.isInteger(baseline[key]), true, `${key} must be a fixed integer limit`);
    assert.ok(baseline[key] > 0, `${key} must be positive`);
  }
  assert.equal(
    Object.keys(baseline).some(key => /effort|strategy|thorough|label|multiplier/i.test(key)),
    false,
    'the structured runtime config must not encode a selectable effort tier',
  );

  const injected = normalizeProjectConfig({
    maxTurns: 1,
    searchDepth: 'shallow',
    strategy: 'fast',
    safetyLimits: { maxTurns: 1 },
  });
  assert.deepEqual(injected, {}, 'project config cannot override fixed runtime limits or search policy');

  const originalMaxTurns = baseline.maxTurns;
  try {
    baseline.maxTurns = originalMaxTurns + 1;
  } catch {
    // A frozen object is one valid implementation; a defensive copy is also valid.
  }
  const observedMaxTurns = getRuntimeConfig().maxTurns;
  try {
    baseline.maxTurns = originalMaxTurns;
  } catch {
    // Frozen configs need no restoration.
  }
  assert.equal(observedMaxTurns, originalMaxTurns,
    'a caller cannot mutate the process-wide fixed runtime limits');
});

// ─── loadProjectConfig ────────────────────────────────────────────────────────

test('loadProjectConfig returns {} when config file does not exist', async () => {
  const root = await makeTempDir();
  const config = await loadProjectConfig(root);
  assert.deepEqual(config, {});
});

test('loadProjectConfig reads and parses .cerebras-explorer.json', async () => {
  const root = await makeTempDir();
  const payload = { projectContext: 'My project' };
  await fs.writeFile(path.join(root, '.cerebras-explorer.json'), JSON.stringify(payload));
  const config = await loadProjectConfig(root);
  assert.equal(config.projectContext, 'My project');
});

test('loadProjectConfig returns {} for invalid JSON', async () => {
  const root = await makeTempDir();
  await fs.writeFile(path.join(root, '.cerebras-explorer.json'), '{ invalid json }');
  const config = await loadProjectConfig(root);
  assert.deepEqual(config, {});
});

test('loadProjectConfig returns {} when file contains non-object JSON', async () => {
  const root = await makeTempDir();
  await fs.writeFile(path.join(root, '.cerebras-explorer.json'), JSON.stringify([1, 2, 3]));
  const config = await loadProjectConfig(root);
  assert.deepEqual(config, {});
});

test('loadProjectConfig returns {} for an empty object', async () => {
  const root = await makeTempDir();
  await fs.writeFile(path.join(root, '.cerebras-explorer.json'), '{}');
  const config = await loadProjectConfig(root);
  assert.deepEqual(config, {});
});

// ─── normalizeProjectConfig ──────────────────────────────────────────────────

// T047_ACTIVE_SURFACE_GUARD_FIXTURE_START
const T054_LEGACY_CONFIG_SURFACE_REMOVED = true;

test('Spec 028 T047 — project config drops case-insensitive legacy policy keys', () => {
  const config = normalizeProjectConfig({
    budget: 'deep',
    BudgetTier: 'deep',
    BUDGET_CONFIG: { turns: 99 },
    defaultBudget: 'deep',
  });
  assert.deepEqual(config, {});
});

test('Spec 028 T047 — legacy report effort envvars cannot alter runtime limits', async () => {
  const baseline = getRuntimeConfig();
  await withEnv({
    CEREBRAS_EXPLORER_TURN_MULTIPLIER: '4',
    CEREBRAS_EXPLORER_MAX_EXTRA_TURNS: '200',
    CEREBRAS_EXPLORER_MAX_COMPACTIONS: '10',
  }, async () => {
    assert.deepEqual(getRuntimeConfig(), baseline);
  });
});

test('Spec 028 T047 — legacy report effort getters are not exported', t => {
  if (!T054_LEGACY_CONFIG_SURFACE_REMOVED) {
    t.todo('T054 activates the legacy getter removal assertions');
    return;
  }
  for (const name of [
    'getExploreTurnMultiplier',
    'getExploreMaxExtraTurns',
    'getExploreMaxCompactions',
  ]) {
    assert.equal(name in configModule, false, `${name} must not be exported`);
  }
});
// T047_ACTIVE_SURFACE_GUARD_FIXTURE_END

test('normalizeProjectConfig: string array fields are filtered', () => {
  const config = normalizeProjectConfig({
    defaultScope: ['src/**', 123, null, 'tests/**'],
    extraIgnoreDirs: ['generated', true, 'vendor'],
    keyFiles: ['src/index.mjs'],
  });
  assert.deepEqual(config.defaultScope, ['src/**', 'tests/**']);
  assert.deepEqual(config.extraIgnoreDirs, ['generated', 'vendor']);
  assert.deepEqual(config.keyFiles, ['src/index.mjs']);
});

test('normalizeProjectConfig: extraIgnorePatterns filters non-string entries (spec 014)', () => {
  const config = normalizeProjectConfig({
    extraIgnorePatterns: ['tmp/**', 42, null, '**/*.snapshot.json', { glob: 'oops' }],
  });
  assert.deepEqual(config.extraIgnorePatterns, ['tmp/**', '**/*.snapshot.json']);
});

test('normalizeProjectConfig: extraIgnorePatterns dropped when not an array (spec 014)', () => {
  const config = normalizeProjectConfig({ extraIgnorePatterns: 'tmp/**' });
  assert.equal(config.extraIgnorePatterns, undefined);
});

test('normalizeProjectConfig: projectContext trimmed and kept', () => {
  const config = normalizeProjectConfig({ projectContext: '  My app.  ' });
  assert.equal(config.projectContext, 'My app.');
});

test('normalizeProjectConfig: empty projectContext is dropped', () => {
  const config = normalizeProjectConfig({ projectContext: '   ' });
  assert.equal(config.projectContext, undefined);
});

test('normalizeProjectConfig: null input returns {}', () => {
  assert.deepEqual(normalizeProjectConfig(null), {});
  assert.deepEqual(normalizeProjectConfig(undefined), {});
});

test('normalizeProjectConfig: unknown fields are ignored', () => {
  const config = normalizeProjectConfig({ unknownKey: 'value' });
  assert.equal(config.unknownKey, undefined);
});

test('getRepoRoot normalizes Git Bash-style Windows repo roots', () => {
  const repoRoot = getRepoRoot('/c/Users/daeryun/project-name', {
    cwd: 'C:\\workspace\\cerebras-explorer-mcp',
    platform: 'win32',
  });
  assert.equal(repoRoot, 'C:\\Users\\daeryun\\project-name');
});

test('resolveRepoRoot canonicalizes Git Bash-style Windows repo roots before session binding', async () => {
  let realpathArg = null;
  const repoRoot = await resolveRepoRoot('/c/Users/daeryun/project-name', {
    cwd: 'C:\\workspace\\cerebras-explorer-mcp',
    platform: 'win32',
    realpathImpl: async input => {
      realpathArg = input;
      return input;
    },
  });
  assert.equal(repoRoot, 'C:\\Users\\daeryun\\project-name');
  assert.equal(realpathArg, 'C:\\Users\\daeryun\\project-name');
});

test('resolveRepoRoot wraps unresolved repo_root errors with repo_root context', async () => {
  await assert.rejects(
    () => resolveRepoRoot('/c/Users/daeryun/missing-project', {
      cwd: 'C:\\workspace\\cerebras-explorer-mcp',
      platform: 'win32',
      realpathImpl: async input => {
        const error = new Error(`ENOENT: no such file or directory, realpath '${input}'`);
        error.code = 'ENOENT';
        throw error;
      },
    }),
    error => {
      assert.equal(error.code, -32602);
      assert.equal(error.repoRootError, 'unresolvable');
      assert.equal(error.repoRootResolved, 'C:\\Users\\daeryun\\missing-project');
      assert.match(error.message, /repo_root could not be resolved/);
      assert.match(error.message, /C:\\Users\\daeryun\\missing-project/);
      return true;
    },
  );
});

// ─── Integration: projectConfig applied in runtime ───────────────────────────

test('loadProjectConfig is applied in ExplorerRuntime via defaultScope', async () => {
  // This test verifies that a .cerebras-explorer.json defaultScope is applied
  // when args.scope is not provided. It does so by checking that the runtime
  // does not crash when a config file exists.
  const { ExplorerRuntime } = await import('../src/explorer/runtime.mjs');

  const root = await makeTempDir();
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'index.js'), 'console.log("hello");');
  await fs.writeFile(
    path.join(root, '.cerebras-explorer.json'),
    JSON.stringify({
      defaultScope: ['src/**'],
      projectContext: 'A test project for cerebras-explorer.',
    }),
  );

  class MockClient {
    constructor() { this.model = 'mock'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: JSON.stringify({
            directAnswer: 'Test answer',
            status: { confidence: 'low', verification: 'broad_search_needed', complete: false, warnings: [] },
            targets: [],
            evidence: [],
            uncertainties: [],
            nextAction: { type: 'ask_user', reason: 'No evidence found.' },
          }),
          toolCalls: [],
        },
      };
    }
  }

  const runtime = new ExplorerRuntime({ chatClient: new MockClient() });
  // No scope in args — should fall back to defaultScope from config file
  const result = await runtime.explore({ task: 'What is this project?', repo_root: root });
  assert.ok(typeof result.directAnswer === 'string');
  assert.ok(result.stats.repoRoot === root);
});
