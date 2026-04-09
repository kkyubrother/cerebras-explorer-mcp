import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  sanitizeBenchmarkReport,
  sanitizePathForReport,
  sanitizeStringForReport,
} from '../src/benchmark/report.mjs';

test('sanitizePathForReport converts repo-root absolute paths to portable relative paths', () => {
  const repoRoot = path.resolve('tmp', 'private-repo');
  const target = path.join(repoRoot, 'benchmarks', 'core.json');

  assert.equal(sanitizePathForReport(repoRoot, { repoRoot }), '.');
  assert.equal(sanitizePathForReport(target, { repoRoot }), 'benchmarks/core.json');
});

test('sanitizePathForReport collapses external absolute paths to basename', () => {
  const repoRoot = path.resolve('tmp', 'private-repo');
  const external = path.join(path.parse(process.cwd()).root, 'external', 'reports', 'report.json');

  assert.equal(sanitizePathForReport(external, { repoRoot }), 'report.json');
});

test('sanitizeBenchmarkReport redacts absolute repo-root paths from nested report fields', () => {
  const repoRoot = path.resolve('tmp', 'private-repo');
  const report = {
    suite: {
      path: path.join(repoRoot, 'benchmarks', 'core.json'),
      repoRoot,
    },
    cases: [
      {
        result: {
          answer: `Repo path is ${path.join(repoRoot, 'src', 'index.mjs')}`,
          evidence: [
            { path: path.join(repoRoot, 'src', 'index.mjs') },
          ],
          candidatePaths: [path.join(repoRoot, 'src', 'mcp', 'server.mjs')],
          stats: { repoRoot },
          codeMap: {
            entryPoints: [path.join(repoRoot, 'src', 'index.mjs')],
            keyModules: [{ path: path.join(repoRoot, 'src', 'mcp', 'server.mjs') }],
          },
        },
      },
    ],
  };

  const sanitized = sanitizeBenchmarkReport(report, { repoRoot });

  assert.equal(sanitized.suite.path, 'benchmarks/core.json');
  assert.equal(sanitized.suite.repoRoot, '.');
  assert.equal(sanitized.cases[0].result.answer, 'Repo path is src/index.mjs');
  assert.equal(sanitized.cases[0].result.evidence[0].path, 'src/index.mjs');
  assert.equal(sanitized.cases[0].result.candidatePaths[0], 'src/mcp/server.mjs');
  assert.equal(sanitized.cases[0].result.stats.repoRoot, '.');
  assert.equal(sanitized.cases[0].result.codeMap.entryPoints[0], 'src/index.mjs');
  assert.equal(sanitized.cases[0].result.codeMap.keyModules[0].path, 'src/mcp/server.mjs');
});

test('sanitizeStringForReport preserves non-path strings', () => {
  assert.equal(
    sanitizeStringForReport('confidence=high evidence=4'),
    'confidence=high evidence=4',
  );
});
