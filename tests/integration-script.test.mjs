import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_URL = pathToFileURL(path.join(ROOT, 'scripts', 'integration-test.mjs')).href;

test('integration script compact checks do not require legacy explore result fields', () => {
  const code = `
    delete process.env.CEREBRAS_API_KEY;
    const mod = await import(${JSON.stringify(SCRIPT_URL)});
    const compactResult = {
      directAnswer: 'SessionStore creates, validates, and updates exploration sessions.',
      status: {
        confidence: 'medium',
        verification: 'verified',
        complete: true,
        warnings: [],
      },
      targets: [{ path: 'src/explorer/session.mjs', role: 'context' }],
      evidence: [],
      evidenceQuality: {
        level: 'medium',
        exactCount: 0,
        partialCount: 0,
        droppedCount: 0,
        fileCount: 0,
        warnings: [],
        summary: 'No evidence needed for helper validation.',
      },
      searchCoverage: {
        scope: [],
        scopeLimited: false,
        filesRead: 1,
        grepCalls: 0,
        listDirCalls: 0,
        symbolCalls: 0,
        toolResultsTruncated: 0,
        stoppedByBudget: false,
        warnings: [],
        summary: 'repo-wide search; 1 file read(s), 0 grep search(es).',
      },
      failure: null,
      sessionId: 'sess_test',
      stats: {
        sessionId: 'sess_test',
        sessionStatus: 'created',
        remainingCalls: 4,
        turns: 1,
        elapsedMs: 10,
        filesRead: 1,
      },
    };
    const checks = mod.buildExploreRepoChecks(compactResult, {
      answerLabel: 'directAnswer',
      minFilesRead: 1,
      answerIncludes: /sessionstore/i,
    });
    console.log(JSON.stringify({
      exports: Object.keys(mod).sort(),
      failures: checks.filter(([, ok]) => !ok).map(([name]) => name),
    }));
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CEREBRAS_API_KEY: '' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.ok(payload.exports.includes('buildExploreRepoChecks'));
  assert.deepEqual(payload.failures, []);
});
