import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  canonicalFileSha256,
  dirtyTreeSha256,
  evaluationOptionsForCase,
  fixtureTreeSha256,
  parseArgs,
  payloadComparisonRecord,
  prepareFixtureRepository,
  printCase,
  repeatCountForCase,
  runtimeConfigSha256,
  runTrustSuite,
  sanitizeTrustArtifact,
} from '../scripts/run-trust-suite.mjs';
import { buildParentPayload, measureParentPayload } from '../src/explorer/parent-payload.mjs';

const execFileAsync = promisify(execFile);
const EMPTY_SHA256 = createHash('sha256').digest('hex');

test('trust runner parses the documented CLI without making usage or latency gates', () => {
  assert.deepEqual(parseArgs([
    '--suite', 'benchmarks/trust-known-answer.json',
    '--mode', 'live',
    '--repo-map', 'C:\\temp\\repo-map.json',
    '--output', 'C:\\temp\\trust.json',
    '--resume-from', 'C:\\temp\\trust-day-1.json',
    '--repeats', '3',
    '--verbose',
    '--measure-payload',
  ]), {
    suite: 'benchmarks/trust-known-answer.json',
    mode: 'live',
    repoMap: 'C:\\temp\\repo-map.json',
    output: 'C:\\temp\\trust.json',
    resumeFrom: 'C:\\temp\\trust-day-1.json',
    repeats: 3,
    verbose: true,
    measurePayload: true,
    help: false,
  });
  assert.throws(() => parseArgs(['--mode', 'fast']), /fixture or live/);
  assert.throws(() => parseArgs(['--repeats', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--resume-from', 'prior.json']), /only in live mode/);
  assert.throws(() => parseArgs([
    '--mode', 'live', '--repo-map', 'map.json',
    '--resume-from', 'same.json', '--output', 'same.json',
  ]), /different files/);
  assert.equal(repeatCountForCase({ repeatCount: 1 }, 3), 1);
  assert.equal(repeatCountForCase({ repeatCount: 3 }, 5), 5);
  assert.deepEqual(evaluationOptionsForCase('fixture', {}), {
    mode: 'fixture',
    profile: 'fixture_strict_v1',
  });
  assert.deepEqual(evaluationOptionsForCase('live', {
    livePolicy: { profile: 'fail_closed_anchor_or_gap_v1' },
  }), {
    mode: 'live',
    profile: 'fail_closed_anchor_or_gap_v1',
  });
  assert.deepEqual(evaluationOptionsForCase('live', {}), {
    mode: 'live',
    profile: null,
  });
});

test('fixture hashes are stable across line endings and sorted tree traversal', async t => {
  assert.equal(canonicalFileSha256('a\r\nb\r'), canonicalFileSha256('a\nb\n'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-fixture-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'z.txt'), 'z\r\n');
  await fs.writeFile(path.join(root, 'nested', 'a.txt'), 'a\r');
  const first = await fixtureTreeSha256(root);
  await fs.writeFile(path.join(root, 'z.txt'), 'z\n');
  await fs.writeFile(path.join(root, 'nested', 'a.txt'), 'a\n');
  assert.equal(await fixtureTreeSha256(root), first);
});

test('live checkpoint config hash binds behavior without binding API keys or log paths', () => {
  assert.equal(
    runtimeConfigSha256({
      CEREBRAS_API_KEY: 'first-secret',
      CEREBRAS_EXPLORER_LOG_PATH: 'C:\\first-log',
    }),
    runtimeConfigSha256({
      CEREBRAS_API_KEY: 'second-secret',
      CEREBRAS_EXPLORER_LOG_PATH: 'C:\\second-log',
    }),
  );
  assert.notEqual(
    runtimeConfigSha256({ CEREBRAS_EXPLORER_MODEL: 'zai-glm-4.7' }),
    runtimeConfigSha256({ CEREBRAS_EXPLORER_MODEL: 'gpt-oss-120b' }),
  );
});

test('dirty-tree pin is empty only for a clean worktree', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-dirty-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileAsync('git', ['-C', root, ...args], { windowsHide: true });
  await git('init', '--quiet');
  await git('config', 'user.email', 'trust@example.invalid');
  await git('config', 'user.name', 'Trust Runner');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(root, 'tracked.txt'), 'clean\n');
  await git('add', 'tracked.txt');
  await git('commit', '--quiet', '-m', 'fixture');
  assert.equal(await dirtyTreeSha256(root), EMPTY_SHA256);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'dirty\n');
  assert.notEqual(await dirtyTreeSha256(root), EMPTY_SHA256);
  await git('checkout', '--quiet', '--', 'tracked.txt');
  await fs.writeFile(path.join(root, 'untracked.txt'), 'new\n');
  assert.notEqual(await dirtyTreeSha256(root), EMPTY_SHA256);
  await fs.rm(path.join(root, 'untracked.txt'));
  await fs.writeFile(path.join(root, '.gitignore'), '.cerebras-explorer.json\n');
  await git('add', '.gitignore');
  await git('commit', '--quiet', '-m', 'ignore runtime config');
  assert.equal(await dirtyTreeSha256(root), EMPTY_SHA256);
  await fs.writeFile(path.join(root, '.cerebras-explorer.json'), '{"projectContext":"changed"}\n');
  assert.notEqual(await dirtyTreeSha256(root), EMPTY_SHA256);
});

test('deterministic Git fixture setup reproduces the portable commit pin and cleans up', async () => {
  const manifest = JSON.parse(await fs.readFile('benchmarks/trust-known-answer.json', 'utf8'));
  const caseDefinition = manifest.cases.find(item => item.id === 'fx-historical-source-role');
  const source = manifest.sources[caseDefinition.sourceRef];
  const sourceRoot = path.resolve(source.repoPath);
  const hostileRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-host-git-env-'));
  const redirectedGitDir = path.join(hostileRoot, 'redirected.git');
  const previous = Object.fromEntries([
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
  ].map(key => [key, process.env[key]]));
  process.env.GIT_DIR = redirectedGitDir;
  process.env.GIT_WORK_TREE = hostileRoot;
  process.env.GIT_CONFIG_GLOBAL = path.join(hostileRoot, 'host-global-config');
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
  process.env.GIT_CONFIG_VALUE_0 = path.join(hostileRoot, 'host-hooks');
  let prepared;
  try {
    prepared = await prepareFixtureRepository(sourceRoot, caseDefinition.fixtureSetup);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const tempRoot = path.dirname(prepared.repoRoot);
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', prepared.repoRoot, 'rev-parse', 'HEAD'],
      { windowsHide: true },
    );
    assert.equal(stdout.trim(), caseDefinition.fixtureSetup.headSha);
    assert.equal(prepared.fixtureSetupHeadSha, caseDefinition.fixtureSetup.headSha);
    await assert.rejects(fs.stat(path.join(sourceRoot, '.git')));
    await assert.rejects(fs.stat(redirectedGitDir),
      'host Git path overrides must not receive fixture writes');
  } finally {
    await prepared.cleanup();
    await fs.rm(hostileRoot, { recursive: true, force: true });
  }
  await assert.rejects(fs.stat(tempRoot));
});

test('trust report artifacts replace mapped and unrelated absolute paths', () => {
  const repoRoot = path.resolve('C:\\private\\repo');
  const artifact = {
    stats: { repoRoot },
    message: `Read ${repoRoot}\\src\\entry.mjs, C:\\secret\\trace.json, /opt/build/out.log, /data/private/a.txt, /app/build/a.txt, and /run/user/a`,
    evidence: [{ path: 'src/entry.mjs' }],
  };
  const safe = sanitizeTrustArtifact(artifact, { repoRoot, repoId: 'logical-repo' });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes(repoRoot), false);
  assert.equal(serialized.includes('C:\\secret\\trace.json'), false);
  assert.equal(serialized.includes('/opt/build/out.log'), false);
  assert.equal(serialized.includes('/data/private/a.txt'), false);
  assert.equal(serialized.includes('/app/build/a.txt'), false);
  assert.equal(serialized.includes('/run/user/a'), false);
  assert.match(serialized, /repo:logical-repo/);
  assert.equal(safe.evidence[0].path, 'src/entry.mjs');
});

test('Spec 028 T068 — portable fixture results replay and payload metrics bind to actual handoffs', async () => {
  const suitePath = path.resolve('benchmarks/trust-known-answer.json');
  const manifest = JSON.parse(await fs.readFile(suitePath, 'utf8'));
  const report = await runTrustSuite({
    suite: suitePath,
    mode: 'fixture',
    repoMap: null,
    output: null,
    repeats: 3,
    verbose: false,
    measurePayload: true,
    help: false,
  });

  assert.equal(report.summary.passed, true);
  assert.equal(report.summary.failedCaseCount, 0);
  assert.equal(report.summary.skippedCaseCount, 0);
  assert.deepEqual(report.summary.payload, {
    metric: manifest.offlineResults.payloadComparison.metric,
    comparedRunCount: 5,
    medianReductionRatio: 0.881,
    minimumMedianReduction: 0.4,
  });
  assert.deepEqual(
    report.cases.map(item => item.id).sort(),
    [...manifest.offlineResults.fixtureTrust.acceptedCaseIds].sort(),
  );

  for (const caseId of manifest.offlineResults.fixtureTrust.repeatableCaseIds) {
    assert.equal(
      report.cases.find(item => item.id === caseId)?.runs?.length,
      manifest.offlineResults.fixtureTrust.repeatCount,
      `${caseId} must replay three times`,
    );
  }

  assert.equal(manifest.offlineResults.parentObservation.status, 'recorded');
  assert.equal(
    manifest.cases.some(item => Object.hasOwn(item, 'parentObservation')),
    false,
    'synthetic per-case parent actions must not substitute for the recorded parent harness',
  );
  for (const caseResult of report.cases) {
    for (const run of caseResult.runs ?? []) {
      const handoff = run.artifact?.parentHandoff;
      if (!handoff) continue;
      assert.deepEqual(
        run.payload?.schemaV3,
        measureParentPayload(buildParentPayload(handoff)),
        `${caseResult.id} payload measurement must be derived from its actual schema-v3 handoff`,
      );
    }
  }
});

test('Spec 028 T069 — payload gate rebuilds every independent oracle sample and fails closed on drift', async () => {
  const manifest = JSON.parse(await fs.readFile('benchmarks/trust-known-answer.json', 'utf8'));
  assert.equal(payloadComparisonRecord(manifest).comparedRunCount, 5);

  manifest.offlineResults.payloadComparison.samples[0].currentParentPayloadBytes += 1;
  assert.throws(
    () => payloadComparisonRecord(manifest),
    /Portable payload sample obs-deny-list-count-range is invalid/,
  );
});

function liveAuditBinding(goal) {
  const core = {
    id: goal.id,
    question: goal.question,
    originRefs: [...new Set(goal.originRefs ?? [])].sort(),
    claimType: goal.claimType,
    proofPolicy: goal.proofPolicy,
    proofCondition: goal.proofCondition,
    constraints: [...new Set(goal.constraints ?? [])].sort(),
    auditVerdict: goal.auditVerdict,
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(['required-subgoal-audit-binding-v1', core]))
    .digest('hex');
  return `audit-v1:${digest.match(/.{16}/gu).join('-')}`;
}

function passingLiveGapArtifact(totalTokens = 0) {
  const task = 'Check the pinned file.';
  const originRef = `request:0-${task.length}`;
  const subgoal = {
    id: 'S-live-gap',
    question: task,
    originRefs: [originRef],
    claimType: 'positive',
    proofPolicy: 'direct_source',
    proofCondition: 'Read direct repository evidence for the request.',
    constraints: [],
    auditVerdict: 'ready',
    state: 'gap',
  };
  subgoal.auditBinding = liveAuditBinding(subgoal);
  return {
    parentHandoff: {
      schemaVersion: 3,
      state: 'incomplete',
      gaps: [{
        question: task,
        reason: 'The bounded repository evidence is not sufficient.',
      }],
    },
    taskContract: { task, subgoals: [subgoal] },
    coverageGaps: [{ subgoalId: subgoal.id, question: task }],
    semanticVerification: { claims: [], verdicts: [], absenceCertificates: [] },
    observations: [],
    stats: {
      inputTokens: totalTokens,
      outputTokens: 0,
      totalTokens,
      turns: 1,
      toolCalls: 0,
    },
  };
}

function providerFailureArtifact(totalTokens = 0) {
  return {
    failure: { category: 'provider', reason: 'provider_error' },
    parentHandoff: {
      schemaVersion: 3,
      state: 'failed',
      directAnswer: 'The provider request failed.',
      failure: { reason: 'provider_error' },
    },
    stats: {
      inputTokens: totalTokens,
      outputTokens: 0,
      totalTokens,
      turns: 1,
      toolCalls: 0,
    },
  };
}

async function createLiveResumeFixture(t, caseRuns = [
  ['repeat-case', 3],
  ['tail-case', 1],
]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-live-resume-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(repoRoot);
  const git = (...args) => execFileAsync('git', ['-C', repoRoot, ...args], { windowsHide: true });
  await git('init', '--quiet');
  await git('config', 'user.email', 'trust@example.invalid');
  await git('config', 'user.name', 'Trust Runner');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(repoRoot, 'tracked.txt'), 'pinned\n');
  await git('add', 'tracked.txt');
  await git('commit', '--quiet', '-m', 'fixture');
  const { stdout } = await git('rev-parse', 'HEAD');

  const task = 'Check the pinned file.';
  const manifest = {
    name: 'live-resume-fixture',
    sources: {
      repo: {
        kind: 'repository',
        repoId: 'live-resume-repo',
        gitSha: stdout.trim(),
        dirtyTreeSha256: EMPTY_SHA256,
      },
    },
    cases: caseRuns.map(([id, repeatCount]) => ({
      id,
      sourceRef: 'repo',
      repeatCount,
      livePolicy: { profile: 'fail_closed_anchor_or_gap_v1' },
      invocation: { tool: 'explore_repo', args: { task } },
      oracle: {
        expectedGoals: [{
          id: 'G-live-gap',
          question: task,
          claimType: 'positive',
          expectedResolution: 'gap',
          requestOriginRefs: [`request:0-${task.length}`],
          evidenceAnchorRefs: [],
        }],
        allowedClaims: [],
        forbiddenClaims: [],
        evidenceAnchors: [],
        boundary: { claimScope: ['.'] },
      },
    })),
  };
  const suitePath = path.join(root, 'suite.json');
  const repoMapPath = path.join(root, 'repo-map.json');
  await fs.writeFile(suitePath, JSON.stringify(manifest));
  await fs.writeFile(repoMapPath, JSON.stringify({ 'live-resume-repo': repoRoot }));
  return {
    root,
    repoRoot,
    git,
    manifest,
    suitePath,
    repoMapPath,
    options: {
      suite: suitePath,
      mode: 'live',
      repoMap: repoMapPath,
      output: null,
      resumeFrom: null,
      repeats: null,
      verbose: false,
      measurePayload: false,
      help: false,
    },
  };
}

async function writeResumeReport(filePath, report) {
  await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

test('Spec 028 T069 — live checkpoints resume run slots across repeated provider windows', async t => {
  const fixture = await createLiveResumeFixture(t);
  const calls = [];
  const runDay = async (resumeFrom, artifacts) => {
    let index = 0;
    return runTrustSuite({ ...fixture.options, resumeFrom }, {
      runLiveCase: async caseDefinition => {
        calls.push(caseDefinition.id);
        return structuredClone(artifacts[index++]);
      },
    });
  };

  const dayOne = await runDay(null, [
    passingLiveGapArtifact(11),
    providerFailureArtifact(901),
  ]);
  const dayOnePath = path.join(fixture.root, 'day-one.json');
  await writeResumeReport(dayOnePath, dayOne);
  assert.equal(dayOne.schemaVersion, 2);
  assert.equal(dayOne.checkpoint.profile, 'live-resume-v1');
  assert.deepEqual(dayOne.cases[0].runs.map(run => run.notRun?.reason ?? 'executed'), [
    'executed', 'executed', 'provider_unavailable',
  ]);

  const dayTwo = await runDay(dayOnePath, [
    passingLiveGapArtifact(22),
    providerFailureArtifact(902),
  ]);
  const dayTwoPath = path.join(fixture.root, 'day-two.json');
  await writeResumeReport(dayTwoPath, dayTwo);
  assert.deepEqual(dayTwo.cases[0].runs.map(run => run.notRun?.reason ?? 'executed'), [
    'executed', 'executed', 'executed',
  ]);
  assert.equal(dayTwo.cases[1].notRun.reason, 'provider_unavailable');

  const dayThree = await runDay(dayTwoPath, [
    passingLiveGapArtifact(33),
    passingLiveGapArtifact(44),
  ]);
  assert.deepEqual(calls, [
    'repeat-case', 'repeat-case',
    'repeat-case', 'repeat-case',
    'repeat-case', 'tail-case',
  ]);
  assert.equal(dayThree.summary.passed, true);
  assert.equal(dayThree.summary.executedRunCount, 4);
  assert.equal(dayThree.summary.notRunRunCount, 0);
  assert.deepEqual(
    dayThree.cases[0].runs.map(run => run.recordOnly.usage.totalTokens),
    [11, 22, 33],
  );
  assert.equal(dayThree.summary.recordOnly.totalTokens, 110);
  assert.equal(JSON.stringify(dayThree).includes(fixture.root), false);
});

test('Spec 028 T069 — resume keeps completed semantic failures instead of retrying to pass', async t => {
  const fixture = await createLiveResumeFixture(t, [['semantic-failure', 1]]);
  const artifact = passingLiveGapArtifact(17);
  artifact.parentHandoff.gaps = [];
  const initial = await runTrustSuite(fixture.options, {
    runLiveCase: async () => artifact,
  });
  assert.equal(initial.summary.passed, false);
  const reportPath = path.join(fixture.root, 'semantic-failure.json');
  await writeResumeReport(reportPath, initial);

  let calls = 0;
  const resumed = await runTrustSuite({ ...fixture.options, resumeFrom: reportPath }, {
    runLiveCase: async () => {
      calls += 1;
      return passingLiveGapArtifact(99);
    },
  });
  assert.equal(calls, 0);
  assert.equal(resumed.summary.passed, false);
  assert.deepEqual(
    resumed.cases[0].runs[0].evaluation.violations,
    initial.cases[0].runs[0].evaluation.violations,
  );
  assert.equal(resumed.cases[0].runs[0].recordOnly.usage.totalTokens, 17);
});

test('Spec 028 T069 — resume rejects stale or corrupted checkpoints before provider calls', async t => {
  const fixture = await createLiveResumeFixture(t, [['checkpoint-case', 1]]);
  const initial = await runTrustSuite(fixture.options, {
    runLiveCase: async () => passingLiveGapArtifact(5),
  });
  const variants = [
    report => {
      report.schemaVersion = 1;
      delete report.checkpoint;
    },
    report => {
      report.checkpoint.runnerPin.gitSha = '0'.repeat(40);
    },
    report => {
      report.checkpoint.manifestSha256 = '0'.repeat(64);
    },
    report => {
      report.checkpoint.runtimeConfigSha256 = '0'.repeat(64);
    },
    report => {
      report.checkpoint.selectedCases[0].runCount = 2;
    },
    report => {
      report.cases[0].runs[0].artifact.parentHandoff.gaps[0].reason = 'tampered';
    },
  ];

  for (const [index, mutate] of variants.entries()) {
    const report = structuredClone(initial);
    mutate(report);
    const reportPath = path.join(fixture.root, `invalid-${index}.json`);
    await writeResumeReport(reportPath, report);
    let calls = 0;
    await assert.rejects(runTrustSuite({ ...fixture.options, resumeFrom: reportPath }, {
      runLiveCase: async () => {
        calls += 1;
        return passingLiveGapArtifact(99);
      },
    }), /Resume report|Resume checkpoint/);
    assert.equal(calls, 0);
  }
});

test('Spec 028 T069 — selected live case ids are unique before provider calls', async t => {
  const fixture = await createLiveResumeFixture(t, [
    ['duplicate-case', 1],
    ['duplicate-case', 1],
  ]);
  let calls = 0;
  await assert.rejects(runTrustSuite(fixture.options, {
    runLiveCase: async () => {
      calls += 1;
      return passingLiveGapArtifact();
    },
  }), /unique non-empty ids/);
  assert.equal(calls, 0);
});

test('Spec 028 T069 — selected run counts are positive integers before provider calls', async t => {
  const fixture = await createLiveResumeFixture(t, [['run-count-case', 1]]);
  let calls = 0;
  for (const invalid of [0, -1, 1.5, '3']) {
    fixture.manifest.cases[0].repeatCount = invalid;
    await fs.writeFile(fixture.suitePath, JSON.stringify(fixture.manifest));
    await assert.rejects(runTrustSuite(fixture.options, {
      runLiveCase: async () => {
        calls += 1;
        return passingLiveGapArtifact();
      },
    }), /positive integer run count/);
  }
  assert.equal(calls, 0);
});

test('Spec 028 T069 — resume rechecks every repository pin before provider calls', async t => {
  const fixture = await createLiveResumeFixture(t, [['pin-case', 1]]);
  const initial = await runTrustSuite(fixture.options, {
    runLiveCase: async () => passingLiveGapArtifact(7),
  });
  const reportPath = path.join(fixture.root, 'pin-report.json');
  await writeResumeReport(reportPath, initial);
  await fs.writeFile(path.join(fixture.repoRoot, 'tracked.txt'), 'dirty\n');

  let calls = 0;
  await assert.rejects(runTrustSuite({ ...fixture.options, resumeFrom: reportPath }, {
    runLiveCase: async () => {
      calls += 1;
      return passingLiveGapArtifact(99);
    },
  }), /Live source preflight failed/);
  assert.equal(calls, 0);
});

test('Spec 028 T069 — live source drift during a provider run fails the case', async t => {
  const fixture = await createLiveResumeFixture(t, [['drift-case', 1]]);
  let calls = 0;
  const report = await runTrustSuite(fixture.options, {
    runLiveCase: async () => {
      calls += 1;
      await fs.writeFile(path.join(fixture.repoRoot, 'tracked.txt'), 'changed during run\n');
      return passingLiveGapArtifact(19);
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.summary.passed, false);
  assert.equal(report.cases[0].runs[0].harnessFailure.code, 'RUNNER_EXECUTION_FAILED');
  assert.match(report.cases[0].runs[0].harnessFailure.message, /changed after source preflight/);
});

test('Spec 028 T069 — ignored source observations cannot escape the live source pin', async t => {
  const fixture = await createLiveResumeFixture(t, [['ignored-source-case', 1]]);
  await fs.writeFile(path.join(fixture.repoRoot, '.gitignore'), 'ignored.js\n');
  await fixture.git('add', '.gitignore');
  await fixture.git('commit', '--quiet', '-m', 'ignore generated source');
  const { stdout } = await fixture.git('rev-parse', 'HEAD');
  fixture.manifest.sources.repo.gitSha = stdout.trim();
  await fs.writeFile(fixture.suitePath, JSON.stringify(fixture.manifest));
  await fs.writeFile(path.join(fixture.repoRoot, 'ignored.js'), 'export const ignored = true;\n');

  const report = await runTrustSuite(fixture.options, {
    runLiveCase: async () => {
      const artifact = passingLiveGapArtifact(23);
      artifact.observations = [{
        id: 'E-ignored',
        kind: 'source',
        path: 'ignored.js',
        startLine: 1,
        endLine: 1,
        snippet: '1: export const ignored = true;',
      }];
      return artifact;
    },
  });
  assert.equal(report.summary.passed, false);
  assert.match(
    report.cases[0].runs[0].harnessFailure.message,
    /ignored source outside the source pin/,
  );
});

test('Spec 028 T069 — harness failures redact values and paths before resume', async t => {
  const fixture = await createLiveResumeFixture(t, [['harness-case', 1]]);
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
  const initial = await runTrustSuite(fixture.options, {
    runLiveCase: async () => {
      throw new Error(`Provider wrapper exposed ${secret} at C:\\private\\trace.json`);
    },
  });
  const reportPath = path.join(fixture.root, 'harness-report.json');
  await writeResumeReport(reportPath, initial);
  const resumed = await runTrustSuite({ ...fixture.options, resumeFrom: reportPath }, {
    runLiveCase: async () => {
      throw new Error('completed harness failures must not be retried');
    },
  });
  for (const report of [initial, resumed]) {
    const serialized = JSON.stringify(report.cases[0].runs[0].harnessFailure);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes('C:\\private'), false);
    assert.match(serialized, /REDACTED:openai-api-key/);
  }
});

test('Spec 028 T069 — live provider failure stops the remaining batch without hiding its denominator', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-provider-stop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(repoRoot);
  const git = (...args) => execFileAsync('git', ['-C', repoRoot, ...args], { windowsHide: true });
  await git('init', '--quiet');
  await git('config', 'user.email', 'trust@example.invalid');
  await git('config', 'user.name', 'Trust Runner');
  await git('config', 'commit.gpgsign', 'false');
  await fs.writeFile(path.join(repoRoot, 'tracked.txt'), 'pinned\n');
  await git('add', 'tracked.txt');
  await git('commit', '--quiet', '-m', 'fixture');
  const { stdout } = await git('rev-parse', 'HEAD');
  const repoSha = stdout.trim();

  const oracle = {
    expectedGoals: [],
    allowedClaims: [],
    forbiddenClaims: [],
    evidenceAnchors: [],
    boundary: { claimScope: ['.'] },
  };
  const manifest = {
    name: 'provider-stop-fixture',
    sources: {
      repo: {
        kind: 'repository',
        repoId: 'provider-stop-repo',
        gitSha: repoSha,
        dirtyTreeSha256: EMPTY_SHA256,
      },
    },
    cases: ['provider-first', 'must-not-start'].map(id => ({
      id,
      sourceRef: 'repo',
      repeatCount: 3,
      livePolicy: { profile: 'fail_closed_anchor_or_gap_v1' },
      invocation: { tool: 'explore_repo', args: { task: `Run ${id}` } },
      oracle,
    })),
  };
  const suitePath = path.join(root, 'suite.json');
  const repoMapPath = path.join(root, 'repo-map.json');
  await fs.writeFile(suitePath, JSON.stringify(manifest));
  await fs.writeFile(repoMapPath, JSON.stringify({ 'provider-stop-repo': repoRoot }));

  const calls = [];
  const report = await runTrustSuite({
    suite: suitePath,
    mode: 'live',
    repoMap: repoMapPath,
    output: null,
    repeats: 3,
    verbose: false,
    measurePayload: false,
    help: false,
  }, {
    runLiveCase: async caseDefinition => {
      calls.push(caseDefinition.id);
      return {
        failure: {
          category: 'provider',
          reason: 'provider_error',
          message: 'sensitive upstream detail must not reach verbose output',
        },
        parentHandoff: {
          schemaVersion: 3,
          state: 'failed',
          directAnswer: 'The provider request failed.',
          failure: { reason: 'provider_error' },
        },
        stats: {},
      };
    },
  });

  assert.deepEqual(calls, ['provider-first']);
  assert.deepEqual(report.cases[0].providerFailure, {
    category: 'provider',
    reason: 'provider_error',
  });
  assert.equal(report.cases[0].runs.length, 3);
  assert.equal(report.cases[0].runs[0].notRun, undefined);
  assert.deepEqual(report.cases[0].runs.slice(1).map(run => run.notRun?.reason), [
    'provider_unavailable',
    'provider_unavailable',
  ]);
  assert.equal(report.cases[1].notRun.reason, 'provider_unavailable');
  assert.deepEqual(report.cases[1].runs.map(run => run.notRun?.reason), [
    'provider_unavailable',
    'provider_unavailable',
    'provider_unavailable',
  ]);
  assert.deepEqual({
    selectedCaseCount: report.summary.selectedCaseCount,
    executedCaseCount: report.summary.executedCaseCount,
    notRunCaseCount: report.summary.notRunCaseCount,
    plannedRunCount: report.summary.plannedRunCount,
    executedRunCount: report.summary.executedRunCount,
    notRunRunCount: report.summary.notRunRunCount,
  }, {
    selectedCaseCount: 2,
    executedCaseCount: 1,
    notRunCaseCount: 1,
    plannedRunCount: 6,
    executedRunCount: 1,
    notRunRunCount: 5,
  });
  assert.equal(report.summary.failedCaseCount, 1);
  assert.equal(report.summary.passed, false);

  const verboseLines = [];
  const originalLog = console.log;
  try {
    console.log = (...values) => verboseLines.push(values.join(' '));
    printCase(report.cases[0], true);
    printCase(report.cases[1], true);
  } finally {
    console.log = originalLog;
  }
  assert.equal(verboseLines.some(line => line.includes('provider=provider/provider_error')), true);
  assert.equal(verboseLines.some(line => line.includes('sensitive upstream detail')), false);
});
