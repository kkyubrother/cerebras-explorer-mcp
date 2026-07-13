import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'integration-test.mjs');
const SCRIPT_URL = pathToFileURL(path.join(ROOT, 'scripts', 'integration-test.mjs')).href;

test('integration script uses only the structured v3 runtime contract', async () => {
  const source = await fs.readFile(SCRIPT_PATH, 'utf8');

  assert.doesNotMatch(source, /SessionStore/);
  assert.doesNotMatch(source, /freeExplore/);
  assert.match(source, /runtime\.explore\(/);
  assert.match(source, /CEREBRAS_EXPLORER_LOG_PATH|transcript/i);
});

test('integration script validates complete, incomplete, and failed v3 handoffs', () => {
  const code = `
    delete process.env.CEREBRAS_API_KEY;
    const mod = await import(${JSON.stringify(SCRIPT_URL)});
    const cases = [{
      expectedState: 'complete',
      result: {
        schemaVersion: 3,
        directAnswer: 'measureParentPayload measures content and structuredContent.',
        state: 'complete',
        evidence: [{
          kind: 'source',
          path: 'src/explorer/parent-payload.mjs',
          startLine: 1,
          endLine: 2,
          supports: 'Defines the parent payload measurement.',
        }],
      },
    }, {
      expectedState: 'incomplete',
      expectedFollowUpType: 'external_verification',
      result: {
        schemaVersion: 3,
        state: 'incomplete',
        gaps: [{
          question: 'Which revision is deployed?',
          reason: 'Repository evidence cannot establish live process state.',
        }],
        followUp: {
          type: 'external_verification',
          requirement: 'Report the deployed revision.',
        },
      },
    }, {
      expectedState: 'failed',
      expectedFailureReason: 'aborted',
      result: {
        schemaVersion: 3,
        directAnswer: 'The explorer was cancelled before a trustworthy answer was produced.',
        state: 'failed',
        failure: { reason: 'aborted' },
      },
    }];
    const failures = cases.flatMap(item =>
      mod.buildParentHandoffChecks(item.result, item)
        .filter(([, ok]) => !ok)
        .map(([name]) => item.expectedState + ': ' + name));
    console.log(JSON.stringify({
      exports: Object.keys(mod).sort(),
      failures,
    }));
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CEREBRAS_API_KEY: '' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.ok(payload.exports.includes('buildParentHandoffChecks'));
  assert.deepEqual(payload.failures, []);
});
