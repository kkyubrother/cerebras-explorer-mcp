import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  sanitizeBenchmarkReport,
  sanitizePathForReport,
  sanitizeStringForReport,
} from '../src/benchmark/report.mjs';
import { buildBenchmarkReport } from '../scripts/run-benchmark.mjs';

test('sanitizePathForReport converts repo-root absolute paths to portable relative paths', () => {
  const repoRoot = path.resolve('tmp', 'private-repo');
  const target = path.join(repoRoot, 'benchmarks', 'adoption.json');

  assert.equal(sanitizePathForReport(repoRoot, { repoRoot }), '.');
  assert.equal(sanitizePathForReport(target, { repoRoot }), 'benchmarks/adoption.json');
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
      path: path.join(repoRoot, 'benchmarks', 'adoption.json'),
      repoRoot,
    },
    cases: [
      {
        result: {
          directAnswer: `Repo path is ${path.join(repoRoot, 'src', 'index.mjs')}`,
          evidence: [
            { path: path.join(repoRoot, 'src', 'index.mjs') },
          ],
          targets: [
            { path: path.join(repoRoot, 'src', 'mcp', 'server.mjs') },
          ],
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

  assert.equal(sanitized.suite.path, 'benchmarks/adoption.json');
  assert.equal(sanitized.suite.repoRoot, '.');
  assert.equal(sanitized.cases[0].result.directAnswer, 'Repo path is src/index.mjs');
  assert.equal(sanitized.cases[0].result.evidence[0].path, 'src/index.mjs');
  assert.equal(sanitized.cases[0].result.targets[0].path, 'src/mcp/server.mjs');
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

test('buildBenchmarkReport records run-level provenance without changing case results', () => {
  const repoRoot = path.resolve('tmp', 'private-repo');
  const provenance = {
    serverName: 'cerebras-explorer-mcp',
    serverVersion: '0.8.2',
    packageVersion: '0.8.2',
    schemaVersion: 2,
    gitSha: 'abc1234',
    toolRegistryHash: 'a'.repeat(64),
    exposedToolCount: 8,
    toolNames: ['explore_repo'],
  };
  const result = {
    schemaVersion: 2,
    directAnswer: 'ok',
    status: { confidence: 'high' },
    evidence: [],
  };

  const report = buildBenchmarkReport({
    suite: { name: 'suite', description: 'desc' },
    suitePath: path.join(repoRoot, 'benchmarks', 'adoption.json'),
    repoRoot,
    summary: { passedCount: 1, caseCount: 1 },
    metrics: { avgTargets: 0 },
    caseResults: [{ result }],
    provenance,
    generatedAt: '2026-06-05T00:00:00.000Z',
    cwd: process.cwd(),
  });

  assert.deepEqual(report.provenance, provenance);
  assert.equal(report.suite.path, 'benchmarks/adoption.json');
  assert.equal(report.suite.repoRoot, '.');
  assert.deepEqual(report.cases[0].result, result);
});
