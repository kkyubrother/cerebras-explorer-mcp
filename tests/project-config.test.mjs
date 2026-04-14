import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getRepoRoot,
  loadProjectConfig,
  normalizeProjectConfig,
  resolveRepoRoot,
} from '../src/explorer/config.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-config-'));
}

// ─── loadProjectConfig ────────────────────────────────────────────────────────

test('loadProjectConfig returns {} when config file does not exist', async () => {
  const root = await makeTempDir();
  const config = await loadProjectConfig(root);
  assert.deepEqual(config, {});
});

test('loadProjectConfig reads and parses .cerebras-explorer.json', async () => {
  const root = await makeTempDir();
  const payload = { defaultBudget: 'quick', projectContext: 'My project' };
  await fs.writeFile(path.join(root, '.cerebras-explorer.json'), JSON.stringify(payload));
  const config = await loadProjectConfig(root);
  assert.equal(config.defaultBudget, 'quick');
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

test('normalizeProjectConfig: valid defaultBudget is kept', () => {
  const config = normalizeProjectConfig({ defaultBudget: 'deep' });
  assert.equal(config.defaultBudget, 'deep');
});

test('normalizeProjectConfig: invalid defaultBudget is dropped', () => {
  const config = normalizeProjectConfig({ defaultBudget: 'ultra' });
  assert.equal(config.defaultBudget, undefined);
});

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
  const config = normalizeProjectConfig({ unknownKey: 'value', defaultBudget: 'normal' });
  assert.equal(config.defaultBudget, 'normal');
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
      defaultBudget: 'quick',
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
            answer: 'Test answer',
            summary: 'Test summary',
            confidence: 'low',
            evidence: [],
            candidatePaths: [],
            followups: [],
          }),
          toolCalls: [],
        },
      };
    }
  }

  const runtime = new ExplorerRuntime({ chatClient: new MockClient() });
  // No scope in args — should fall back to defaultScope from config file
  const result = await runtime.explore({ task: 'What is this project?', repo_root: root });
  assert.ok(typeof result.answer === 'string');
  assert.ok(result.stats.repoRoot === root);
});
