import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const runnerPath = fileURLToPath(new URL('../scripts/run-benchmark.mjs', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

test('adoption runner stops after a provider failure and records the remaining denominator', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-provider-stop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const suitePath = path.join(root, 'suite.json');
  const outputPath = path.join(root, 'report.json');
  await fs.mkdir(repoRoot);
  await fs.writeFile(path.join(repoRoot, 'marker.txt'), 'marker\n', 'utf8');
  await fs.writeFile(suitePath, JSON.stringify({
    name: 'provider-stop-adoption',
    defaultPassScore: 0.7,
    cases: [
      {
        id: 'provider-first',
        description: 'The first case reaches the unavailable provider.',
        tool: 'explore_repo',
        args: { task: 'Find marker.txt.' },
      },
      {
        id: 'must-not-start',
        description: 'The second case must stay in the denominator without another request.',
        tool: 'explore_repo',
        args: { task: 'Read marker.txt.' },
      },
    ],
  }), 'utf8');

  let requestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    request.resume();
    response.writeHead(429, {
      'content-type': 'application/json',
      'retry-after': '86400',
    });
    response.end(JSON.stringify({ error: { message: 'sensitive upstream detail' } }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();

  const env = {
    ...process.env,
    CEREBRAS_API_KEY: 'test-key',
    CEREBRAS_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    CEREBRAS_EXPLORER_MODEL: 'zai-glm-4.7',
  };
  delete env.CEREBRAS_EXPLORER_LOG_PATH;
  delete env.EXPLORER_PROVIDER;
  delete env.EXPLORER_FAILOVER;

  let failure;
  try {
    await execFileAsync(process.execPath, [
      runnerPath,
      '--suite', suitePath,
      '--repo-root', repoRoot,
      '--output', outputPath,
    ], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, 'a provider failure keeps the benchmark exit non-zero');
  assert.match(failure.stdout, /FAIL provider-first/);
  assert.match(failure.stdout, /failureReason=provider_error/);
  assert.match(failure.stdout, /NOT_RUN must-not-start\s+reason=provider_unavailable/);
  assert.doesNotMatch(failure.stdout, /sensitive upstream detail/);
  assert.equal(requestCount, 1, 'the unavailable provider is not called for later cases');

  const report = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.equal(report.summary.caseCount, 2);
  assert.equal(report.summary.failedCount, 2);
  assert.equal(report.cases[0].notRun, undefined);
  assert.equal(report.cases[0].failureReason, 'provider_error');
  assert.deepEqual(report.cases[1].notRun, { reason: 'provider_unavailable' });
  assert.equal(report.cases[1].failureReason, undefined);
  assert.doesNotMatch(JSON.stringify(report), /sensitive upstream detail/);
});
