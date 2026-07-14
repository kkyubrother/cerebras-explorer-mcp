import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildParentObservationReport,
  classifyParentActionTrace,
  isEligibleParentObservationCase,
  isWithinCitedTarget,
  summarizeParentObservations,
} from '../scripts/run-parent-observation.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/run-parent-observation.mjs', import.meta.url));

function target(pathname, startLine, endLine) {
  return {
    path: pathname,
    ...(startLine === undefined ? {} : { startLine, endLine }),
  };
}

function observation(overrides = {}) {
  return {
    repoId: 'fixture-repo',
    citedTargets: [target('src/a.mjs', 2, 8)],
    actions: [],
    ...overrides,
  };
}

test('Spec 028 T066 — cited target and range allowance is exact and fail-closed', () => {
  const ranged = [target('src/a.mjs', 2, 8)];
  assert.equal(isWithinCitedTarget(target('src/a.mjs', 2, 8), ranged), true);
  assert.equal(isWithinCitedTarget(target('src/a.mjs', 4, 5), ranged), true);
  assert.equal(isWithinCitedTarget(target('src/a.mjs'), ranged), false);
  assert.equal(isWithinCitedTarget(target('src/a.mjs', 1, 5), ranged), false);
  assert.equal(isWithinCitedTarget(target('src/b.mjs', 4, 5), ranged), false);

  const wholeFile = [target('src/a.mjs')];
  assert.equal(isWithinCitedTarget(target('src/a.mjs'), wholeFile), true);
  assert.equal(isWithinCitedTarget(target('src/a.mjs', 100, 120), wholeFile), true);
  assert.equal(isWithinCitedTarget(target('C:\\repo\\src\\a.mjs'), wholeFile), false);
  assert.equal(isWithinCitedTarget(target('.env'), [target('.env')]), false);
});

test('Spec 028 T066 — cited reads, exact searches, and one allowed follow-up are allowances', () => {
  const result = classifyParentActionTrace(observation({
    allowedFollowUp: { tool: 'collect_evidence', scope: ['src/**'] },
    actions: [
      { type: 'read', path: 'src/a.mjs', startLine: 3, endLine: 5 },
      {
        type: 'search',
        operation: 'grep',
        query: 'requireAuth',
        targets: [target('src/a.mjs', 6, 7)],
      },
      {
        type: 'follow_up',
        tool: 'collect_evidence',
        scope: ['src/**'],
        returnedTargets: [target('src/b.mjs', 1, 2)],
      },
      { type: 'read', path: 'src/b.mjs', startLine: 1, endLine: 2 },
    ],
  }));

  assert.equal(result.valid, true);
  assert.equal(result.noBroadNativeResearch, true);
  assert.equal(result.broadActionCount, 0);
  assert.deepEqual(result.allowance, {
    citedTargetReads: 2,
    citedPathSearches: 1,
    allowedFollowUps: 1,
  });
  assert.deepEqual(result.violations, []);
});

test('Spec 028 T066 — broad searches and uncited reads cannot disappear from the fixed metric', () => {
  const result = classifyParentActionTrace(observation({
    allowedFollowUp: { tool: 'collect_evidence', scope: ['src/**'] },
    actions: [
      { type: 'read', path: 'src/b.mjs', startLine: 1, endLine: 2 },
      { type: 'search', operation: 'walk', query: '*', targets: [] },
      {
        type: 'follow_up',
        tool: 'collect_evidence',
        scope: ['src/**'],
        returnedTargets: [target('src/b.mjs', 1, 2)],
      },
      { type: 'read', path: 'src/b.mjs', startLine: 1, endLine: 2 },
    ],
  }));

  assert.equal(result.valid, true);
  assert.equal(result.noBroadNativeResearch, false);
  assert.equal(result.broadActionCount, 2);
  assert.deepEqual(result.violations.map(item => item.code), [
    'uncited_read_before_allowed_follow_up',
    'repository_wide_search',
  ]);
  assert.equal(result.allowance.citedTargetReads, 1,
    'the later cited read stays allowed without erasing the earlier broad read');
});

test('Spec 028 T066 — malformed or unapproved traces fail closed without exposing values', () => {
  const unapproved = classifyParentActionTrace(observation({
    allowedFollowUp: { tool: 'trace_symbol', scope: ['src/**'] },
    actions: [{
      type: 'follow_up',
      tool: 'explore_repo',
      scope: ['src/**'],
      returnedTargets: [],
    }],
  }));
  assert.equal(unapproved.valid, false);
  assert.equal(unapproved.noBroadNativeResearch, false);
  assert.deepEqual(unapproved.violations.map(item => item.code), ['unapproved_follow_up']);

  const absolute = classifyParentActionTrace(observation({
    citedTargets: [target('C:\\Users\\someone\\secret.mjs')],
  }));
  assert.equal(absolute.valid, false);
  assert.deepEqual(absolute.violations.map(item => item.code), ['invalid_observation_shape']);
  assert.equal(JSON.stringify(absolute).includes('someone'), false);
});

test('Spec 028 T066 — denominator eligibility is oracle-state based and excludes faults', () => {
  assert.equal(isEligibleParentObservationCase({
    kind: 'fixture',
    oracle: { expectedState: 'complete' },
  }), true);
  assert.equal(isEligibleParentObservationCase({
    kind: 'observed',
    oracle: { expectedState: 'verify_targets' },
  }), true);
  assert.equal(isEligibleParentObservationCase({
    kind: 'fixture',
    oracle: { expectedState: 'incomplete' },
  }), false);
  assert.equal(isEligibleParentObservationCase({
    kind: 'fault',
    oracle: { expectedState: 'complete' },
  }), false);
  assert.equal(isEligibleParentObservationCase({
    kind: 'fixture',
    fault: true,
    oracle: { expectedState: 'complete' },
  }), false);
});

test('Spec 028 T066 — unobserved and invalid eligible cases stay in the denominator', () => {
  const summary = summarizeParentObservations([
    {
      observation: 'observed',
      noBroadNativeResearch: true,
      broadActionCount: 0,
      allowance: { citedTargetReads: 2, citedPathSearches: 1, allowedFollowUps: 0 },
    },
    {
      observation: 'observed',
      noBroadNativeResearch: false,
      broadActionCount: 1,
      allowance: { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 },
    },
    {
      observation: 'unobserved',
      noBroadNativeResearch: false,
      broadActionCount: 0,
      allowance: { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 },
    },
    {
      observation: 'invalid',
      noBroadNativeResearch: false,
      broadActionCount: 0,
      allowance: { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 },
    },
  ]);

  assert.equal(summary.denominatorCaseCount, 4);
  assert.equal(summary.noBroadNativeResearchCaseCount, 1);
  assert.equal(summary.broadNativeResearchCaseCount, 1);
  assert.equal(summary.unobservedCaseCount, 1);
  assert.equal(summary.invalidObservationCaseCount, 1);
  assert.equal(summary.noBroadNativeResearchRate, 0.25);
  assert.equal(summary.passed, false);
  assert.deepEqual(summary.allowance, {
    citedTargetReads: 2,
    citedPathSearches: 1,
    allowedFollowUps: 0,
  });
});

async function makeFixtureSuite() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'parent-observation-'));
  const benchmarkDir = path.join(projectRoot, 'benchmarks');
  const repoRoot = path.join(projectRoot, 'fixture', 'repo');
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fs.mkdir(benchmarkDir, { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'src', 'a.mjs'), 'export const a = true;\n', 'utf8');

  const suite = {
    schemaVersion: 1,
    name: 'parent-observation-test',
    sources: {
      fixture: {
        kind: 'fixture',
        repoId: 'fixture-repo',
        repoPath: 'fixture/repo',
      },
    },
    cases: [
      {
        id: 'safe',
        kind: 'fixture',
        sourceRef: 'fixture',
        oracle: { expectedState: 'complete' },
        parentObservation: observation({
          citedTargets: [target('src/a.mjs')],
          actions: [{ type: 'read', path: 'src/a.mjs' }],
        }),
      },
      {
        id: 'broad',
        kind: 'fixture',
        sourceRef: 'fixture',
        oracle: { expectedState: 'verify_targets' },
        parentObservation: observation({
          citedTargets: [target('src/a.mjs')],
          actions: [{ type: 'search', operation: 'glob', query: '*.mjs', targets: [] }],
        }),
      },
      {
        id: 'unobserved',
        kind: 'fixture',
        sourceRef: 'fixture',
        oracle: { expectedState: 'complete' },
      },
      {
        id: 'fault',
        kind: 'fault',
        sourceRef: 'fixture',
        oracle: { expectedState: 'complete' },
      },
      {
        id: 'incomplete',
        kind: 'fixture',
        sourceRef: 'fixture',
        oracle: { expectedState: 'incomplete' },
      },
    ],
  };
  const suitePath = path.join(benchmarkDir, 'suite.json');
  await fs.writeFile(suitePath, JSON.stringify(suite), 'utf8');
  return { projectRoot, suite, suitePath };
}

test('Spec 028 T066 — report stores logical repo ids and fixed portable metrics only', async t => {
  const fixture = await makeFixtureSuite();
  t.after(() => fs.rm(fixture.projectRoot, { recursive: true, force: true }));

  const report = await buildParentObservationReport({
    suite: fixture.suite,
    suitePath: fixture.suitePath,
    repoMap: {},
  });
  assert.equal(report.metrics.denominatorCaseCount, 3);
  assert.equal(report.metrics.observedCaseCount, 2);
  assert.equal(report.metrics.noBroadNativeResearchCaseCount, 1);
  assert.equal(report.metrics.noBroadNativeResearchRate, 0.333333);
  assert.equal(report.metrics.passed, false);
  assert.deepEqual(report.cases.map(item => item.repoId), [
    'fixture-repo', 'fixture-repo', 'fixture-repo',
  ]);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(fixture.projectRoot), false);
  assert.equal(serialized.includes('export const a'), false);
  assert.equal(serialized.includes('transcript'), false);
});

test('Spec 028 T066 — CLI accepts only suite/map/output and writes a report before failing the gate', async t => {
  const fixture = await makeFixtureSuite();
  t.after(() => fs.rm(fixture.projectRoot, { recursive: true, force: true }));
  const repoMapPath = path.join(fixture.projectRoot, 'repo-map.json');
  const outputPath = path.join(fixture.projectRoot, 'out', 'parent-observation.json');
  await fs.writeFile(repoMapPath, '{}', 'utf8');

  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--suite', fixture.suitePath,
    '--repo-map', repoMapPath,
    '--output', outputPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /1\/3 eligible cases/);
  const report = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.equal(report.metrics.denominatorCaseCount, 3);
  assert.equal(report.metrics.passed, false);
  assert.equal(JSON.stringify(report).includes(fixture.projectRoot), false);
});

test('Spec 028 T066 — repository sources resolve through logical ids without reporting roots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parent-observation-map-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'src', 'a.mjs'), 'ok\n', 'utf8');
  const suitePath = path.join(root, 'suite.json');
  const suite = {
    schemaVersion: 1,
    name: 'mapped',
    sources: {
      self: { kind: 'repository', repoId: 'cerebras-explorer-mcp' },
    },
    cases: [{
      id: 'mapped-safe',
      kind: 'observed',
      sourceRef: 'self',
      oracle: { expectedState: 'complete' },
      parentObservation: {
        repoId: 'self',
        citedTargets: [target('src/a.mjs')],
        actions: [{ type: 'read', path: 'src/a.mjs' }],
      },
    }],
  };

  const report = await buildParentObservationReport({
    suite,
    suitePath,
    repoMap: { self: repoRoot },
  });
  assert.equal(report.metrics.passed, true);
  assert.equal(report.cases[0].repoId, 'self');
  assert.equal(JSON.stringify(report).includes(repoRoot), false);
});
