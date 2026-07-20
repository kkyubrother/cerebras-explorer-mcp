import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildOracleParentHandoff,
  buildParentObservationReport,
  buildParentPrompt,
  classifyParentActionTrace,
  codexParentArgs,
  isEligibleParentObservationCase,
  isWithinCitedTarget,
  parseCodexParentTrace,
  summarizeParentObservations,
} from '../scripts/run-parent-observation.mjs';
import { fixtureTreeSha256 } from '../scripts/run-trust-suite.mjs';

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

function oracleCase(id = 'safe') {
  return {
    id,
    kind: 'fixture',
    sourceRef: 'fixture',
    invocation: {
      tool: 'explore_repo',
      args: { task: 'Explain the pinned value.' },
    },
    oracle: {
      expectedState: 'complete',
      allowedClaims: [{
        id: 'A1',
        text: 'The pinned value is true.',
        evidenceAnchorRefs: ['E1'],
      }],
      evidenceAnchors: [{
        id: 'E1',
        kind: 'source',
        path: 'src/a.mjs',
        startLine: 1,
        endLine: 1,
        sourceRole: 'implementation',
        temporalRole: 'current',
      }],
    },
  };
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function codexTrace({
  command = null,
  failed = false,
  completed = true,
  message = 'Parent answer.',
  messageBeforeCommand = false,
  unknownItemType = null,
} = {}) {
  const events = [
    { type: 'thread.started', thread_id: 'portable-id' },
    { type: 'turn.started' },
  ];
  const agentMessage = message === null ? null : {
    type: 'item.completed',
    item: { id: 'message', type: 'agent_message', text: message },
  };
  if (messageBeforeCommand && agentMessage) events.push(agentMessage);
  if (command) {
    events.push({
      type: 'item.started',
      item: {
        id: 'command', type: 'command_execution', command,
        status: 'in_progress', exit_code: null,
      },
    });
    events.push({
      type: failed ? 'item.failed' : 'item.completed',
      item: {
        id: 'command', type: 'command_execution', command,
        status: failed ? 'failed' : 'completed', exit_code: failed ? 1 : 0,
        aggregated_output: 'raw repository prose that must stay external',
      },
    });
  }
  if (unknownItemType) {
    events.push({
      type: 'item.started',
      item: { id: 'unknown-action', type: unknownItemType },
    });
    events.push({
      type: 'item.completed',
      item: { id: 'unknown-action', type: unknownItemType },
    });
  }
  if (!messageBeforeCommand && agentMessage) events.push(agentMessage);
  if (completed) events.push({
    type: 'turn.completed',
    usage: { input_tokens: 123, output_tokens: 45 },
  });
  return `${events.map(item => JSON.stringify(item)).join('\n')}\n`;
}

test('Spec 028 T066 — cited target and range allowance is exact and fail-closed', () => {
  const ranged = [target('src/a.mjs', 2, 8)];
  assert.equal(isWithinCitedTarget(target('src/a.mjs', 2, 8), ranged), true);
  assert.equal(isWithinCitedTarget(target('src/a.mjs', 4, 5), ranged), true);
  assert.equal(isWithinCitedTarget(target('src/a.mjs'), ranged), false);
  assert.equal(isWithinCitedTarget(target('src/a.mjs', 1, 5), ranged), false);
  assert.equal(isWithinCitedTarget(target('src/b.mjs', 4, 5), ranged), false);
  assert.equal(isWithinCitedTarget(target('C:\\repo\\src\\a.mjs'), ranged), false);
  assert.equal(isWithinCitedTarget(target('.env'), [target('.env')]), false);
});

test('Spec 028 T066 — cited reads, exact searches, and one allowed follow-up are allowances', () => {
  const result = classifyParentActionTrace(observation({
    allowedFollowUp: { tool: 'collect_evidence', scope: ['src/**'] },
    actions: [
      { type: 'read', path: 'src/a.mjs', startLine: 3, endLine: 5 },
      {
        type: 'search', operation: 'grep', query: 'requireAuth',
        targets: [target('src/a.mjs', 6, 7)],
      },
      {
        type: 'follow_up', tool: 'collect_evidence', scope: ['src/**'],
        returnedTargets: [target('src/b.mjs', 1, 2)],
      },
      { type: 'read', path: 'src/b.mjs', startLine: 1, endLine: 2 },
    ],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.noBroadNativeResearch, true);
  assert.deepEqual(result.allowance, {
    citedTargetReads: 2,
    citedPathSearches: 1,
    allowedFollowUps: 1,
  });
});

test('Spec 028 T066 — broad searches and uncited reads cannot disappear from the metric', () => {
  const result = classifyParentActionTrace(observation({
    actions: [
      { type: 'search', operation: 'walk', query: '*', targets: [] },
      { type: 'read', path: 'src/b.mjs' },
    ],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.noBroadNativeResearch, false);
  assert.equal(result.broadActionCount, 2);
  assert.deepEqual(result.violations.map(item => item.code), [
    'repository_wide_search', 'uncited_read',
  ]);
});

test('Spec 028 T066 — malformed or unapproved portable actions fail closed', () => {
  const unapproved = classifyParentActionTrace(observation({
    allowedFollowUp: { tool: 'trace_symbol', scope: ['src/**'] },
    actions: [{
      type: 'follow_up', tool: 'explore_repo', scope: ['src/**'], returnedTargets: [],
    }],
  }));
  assert.equal(unapproved.valid, false);
  assert.deepEqual(unapproved.violations.map(item => item.code), ['unapproved_follow_up']);
  assert.equal(classifyParentActionTrace({ ...observation(), extra: true }).valid, false);
});

test('Spec 028 T066 — eligibility excludes faults and non-action states', () => {
  assert.equal(isEligibleParentObservationCase({ oracle: { expectedState: 'complete' } }), true);
  assert.equal(isEligibleParentObservationCase({ oracle: { expectedState: 'verify_targets' } }), true);
  assert.equal(isEligibleParentObservationCase({ oracle: { expectedState: 'incomplete' } }), false);
  assert.equal(isEligibleParentObservationCase({
    kind: 'fault', oracle: { expectedState: 'complete' },
  }), false);
});

test('Spec 028 T068 — independent oracle deterministically supplies the schema-v3 handoff', () => {
  const handoff = buildOracleParentHandoff(oracleCase());
  assert.deepEqual(handoff, {
    schemaVersion: 3,
    directAnswer: 'The pinned value is true.',
    state: 'complete',
    evidence: [{
      id: 'E1', kind: 'source', path: 'src/a.mjs', startLine: 1, endLine: 1,
      supports: 'The pinned value is true.',
    }],
  });
  const prompt = buildParentPrompt(oracleCase(), handoff);
  assert.match(prompt, /Repository explorer result \(schema v3\):/);
  assert.match(prompt, /complete means answer from directAnswer/);
  assert.match(prompt, /verify_targets means inspect only targets/);
  assert.equal(/avoid|broad|expected action|read only these/iu.test(prompt), false,
    'the parent prompt may explain state routing but must not mention the measured behavior');
  assert.throws(() => buildOracleParentHandoff({
    ...oracleCase(),
    oracle: { expectedState: 'complete', allowedClaims: [], evidenceAnchors: [] },
  }), /independent answer and evidence oracle/);
});

test('Spec 028 T068 — actual completed command events are measured and agent self-report is ignored', () => {
  const handoff = buildOracleParentHandoff(oracleCase());
  const result = parseCodexParentTrace(codexTrace({
    command: 'Get-Content src/a.mjs | Select-Object -First 1',
    message: 'I performed a repository-wide search.',
  }), { repoId: 'fixture-repo', handoff });
  assert.equal(result.valid, true);
  assert.equal(result.noBroadNativeResearch, true);
  assert.equal(result.allowance.citedTargetReads, 1);
  assert.deepEqual(result.violations, []);
});

test('Spec 028 T068 — broad, failed, malformed, and incomplete command traces fail closed', async t => {
  const handoff = buildOracleParentHandoff(oracleCase());
  await t.test('repository-wide search', () => {
    const result = parseCodexParentTrace(codexTrace({
      command: 'rg -n pinned . src/a.mjs',
    }), {
      repoId: 'fixture-repo', handoff,
    });
    assert.equal(result.valid, true);
    assert.equal(result.noBroadNativeResearch, false);
    assert.deepEqual(result.violations.map(item => item.code), ['repository_wide_search']);
  });
  await t.test('failed command', () => {
    const result = parseCodexParentTrace(codexTrace({
      command: 'Get-Content src/a.mjs | Select-Object -First 1', failed: true,
    }), { repoId: 'fixture-repo', handoff, processExitCode: 1 });
    assert.equal(result.valid, false);
    assert.ok(result.violations.some(item => item.code === 'command_execution_failed'));
    assert.ok(result.violations.some(item => item.code === 'parent_process_failed'));
  });
  await t.test('a declined cited command followed by a completed parent remains observable', () => {
    const result = parseCodexParentTrace(codexTrace({
      command: 'Get-Content src/a.mjs | Select-Object -First 1', failed: true,
    }), { repoId: 'fixture-repo', handoff, processExitCode: 0 });
    assert.equal(result.valid, true);
    assert.equal(result.noBroadNativeResearch, true);
    assert.ok(result.violations.some(item => item.code === 'command_execution_failed'));
  });
  await t.test('malformed JSONL', () => {
    const result = parseCodexParentTrace('not-json\n', { repoId: 'fixture-repo', handoff });
    assert.equal(result.valid, false);
    assert.ok(result.violations.some(item => item.code === 'invalid_jsonl_trace'));
    assert.ok(result.violations.some(item => item.code === 'parent_turn_incomplete'));
  });
  await t.test('started command without completion', () => {
    const raw = [
      { type: 'turn.started' },
      { type: 'item.started', item: {
        id: 'pending', type: 'command_execution', command: 'Get-Content src/a.mjs',
      } },
    ].map(JSON.stringify).join('\n');
    const result = parseCodexParentTrace(raw, { repoId: 'fixture-repo', handoff });
    assert.equal(result.valid, false);
    assert.ok(result.violations.some(item => item.code === 'command_event_incomplete'));
  });
  await t.test('unclassified command', () => {
    const result = parseCodexParentTrace(codexTrace({ command: 'python inspect.py' }), {
      repoId: 'fixture-repo', handoff,
    });
    assert.equal(result.valid, false);
    assert.equal(result.broadActionCount, 1);
    assert.ok(result.violations.some(item => item.code === 'unclassified_command'));
  });
  await t.test('whole-file reads remain path-level cited reads without borrowing a range', () => {
    const result = parseCodexParentTrace(codexTrace({
      command: 'Get-Content src/a.mjs',
    }), { repoId: 'fixture-repo', handoff });
    assert.equal(isWithinCitedTarget(target('src/a.mjs'), [target('src/a.mjs', 1, 1)]), false);
    assert.equal(result.noBroadNativeResearch, true);
    assert.equal(result.broadActionCount, 0);
    assert.equal(result.allowance.citedTargetReads, 1);
    assert.deepEqual(result.violations, []);
  });
  await t.test('path prefix collisions are not cited reads', () => {
    const result = parseCodexParentTrace(codexTrace({
      command: 'Get-Content src/a.mjs.bak | Select-Object -First 1',
    }), { repoId: 'fixture-repo', handoff });
    assert.equal(result.valid, false);
    assert.equal(result.broadActionCount, 1);
    assert.ok(result.violations.some(item => item.code === 'unclassified_command'));
  });
  await t.test('unknown action item types fail closed', () => {
    const result = parseCodexParentTrace(codexTrace({
      unknownItemType: 'mcp_tool_call',
    }), { repoId: 'fixture-repo', handoff });
    assert.equal(result.valid, false);
    assert.equal(result.broadActionCount, 1);
    assert.ok(result.violations.some(item => item.code === 'unknown_action_type'));
  });
  await t.test('the exact Codex skill-context notice is passive, not a repository action', () => {
    const raw = [
      { type: 'turn.started' },
      { type: 'item.completed', item: {
        id: 'message', type: 'agent_message', text: 'Parent answer.',
      } },
      { type: 'item.completed', item: {
        id: 'diagnostic',
        type: 'error',
        message: 'Skill descriptions were shortened to fit the 2% skills context ' +
          ['bud', 'get'].join('') + '. ' +
          'Codex can still see every skill, but some descriptions are shorter. ' +
          'Disable unused skills or plugins to leave more room for the rest.',
      } },
      { type: 'turn.completed' },
    ].map(JSON.stringify).join('\n');
    const result = parseCodexParentTrace(raw, { repoId: 'fixture-repo', handoff });
    assert.equal(result.valid, true);
    assert.equal(result.noBroadNativeResearch, true);
    assert.deepEqual(result.violations, []);
  });
  await t.test('another completed error item remains fail-closed', () => {
    const raw = [
      { type: 'turn.started' },
      { type: 'item.completed', item: {
        id: 'error',
        type: 'error',
        message: 'A different parent error occurred.',
      } },
      { type: 'item.completed', item: {
        id: 'message', type: 'agent_message', text: 'Parent answer.',
      } },
      { type: 'turn.completed' },
    ].map(JSON.stringify).join('\n');
    const result = parseCodexParentTrace(raw, { repoId: 'fixture-repo', handoff });
    assert.equal(result.valid, false);
    assert.equal(result.broadActionCount, 1);
    assert.ok(result.violations.some(item => item.code === 'unknown_action_type'));
    assert.ok(result.violations.some(item => item.code === 'unclassified_command'));
  });
  await t.test('item events without an action type fail closed', () => {
    const raw = [
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'missing-type' } },
      { type: 'item.completed', item: { id: 'missing-type' } },
      { type: 'item.completed', item: {
        id: 'message', type: 'agent_message', text: 'Parent answer.',
      } },
      { type: 'turn.completed' },
    ].map(JSON.stringify).join('\n');
    const result = parseCodexParentTrace(raw, { repoId: 'fixture-repo', handoff });
    assert.equal(result.valid, false);
    assert.equal(result.broadActionCount, 1);
    assert.ok(result.violations.some(item => item.code === 'unknown_action_type'));
  });
  await t.test('a completed turn requires a final agent message', () => {
    const missing = parseCodexParentTrace(codexTrace({ message: null }), {
      repoId: 'fixture-repo', handoff,
    });
    assert.equal(missing.valid, false);
    assert.ok(missing.violations.some(item => item.code === 'final_agent_message_missing'));

    const notFinal = parseCodexParentTrace(codexTrace({
      command: 'Get-Content src/a.mjs | Select-Object -First 1',
      messageBeforeCommand: true,
    }), { repoId: 'fixture-repo', handoff });
    assert.equal(notFinal.valid, false);
    assert.ok(notFinal.violations.some(item => item.code === 'final_agent_message_missing'));
  });
  await t.test('an agent message after turn completion is rejected', () => {
    const raw = [
      { type: 'turn.started' },
      { type: 'turn.completed' },
      { type: 'item.completed', item: {
        id: 'message', type: 'agent_message', text: 'Too late.',
      } },
    ].map(JSON.stringify).join('\n');
    const result = parseCodexParentTrace(raw, { repoId: 'fixture-repo', handoff });
    assert.equal(result.valid, false);
    assert.ok(result.violations.some(item => item.code === 'event_after_turn_completion'));
    assert.ok(result.violations.some(item => item.code === 'final_agent_message_missing'));
  });
});

test('Spec 028 T068 — Codex parent invocation fixes isolation and read-only arguments', () => {
  assert.deepEqual(codexParentArgs('C:\\pinned\\repo'), [
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
    '--skip-git-repo-check', '-C', 'C:\\pinned\\repo', '-',
  ]);
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--trace-dir/);
});

test('Spec 028 T066 — summary keeps the full denominator and portable counts', () => {
  const summary = summarizeParentObservations([
    {
      observed: true, noBroad: true, broadActionCount: 0,
      allowance: { citedTargetReads: 2, citedPathSearches: 1, allowedFollowUps: 0 },
    },
    {
      observed: true, noBroad: false, broadActionCount: 1,
      allowance: { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 },
    },
    {
      observed: false, noBroad: false, broadActionCount: 0,
      allowance: { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 },
    },
  ]);
  assert.equal(summary.denominatorCaseCount, 3);
  assert.equal(summary.observedCaseCount, 2);
  assert.equal(summary.invalidObservationCaseCount, 1);
  assert.equal(summary.noBroadNativeResearchRate, 0.333333);
  assert.equal(summary.passed, false);
});

async function makeFixtureSuite() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'parent-observation-'));
  const benchmarkDir = path.join(projectRoot, 'benchmarks');
  const repoRoot = path.join(projectRoot, 'fixture', 'repo');
  const traceDir = path.join(projectRoot, 'traces');
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fs.mkdir(benchmarkDir, { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'src', 'a.mjs'), 'export const a = true;\n', 'utf8');
  const source = {
    kind: 'fixture',
    repoId: 'fixture-repo',
    repoPath: 'fixture/repo',
    repoTreeSha256: await fixtureTreeSha256(repoRoot),
  };
  const suite = {
    schemaVersion: 1,
    name: 'parent-observation-test',
    sources: { fixture: source },
    cases: [oracleCase('safe'), oracleCase('broad'), oracleCase('invalid')],
  };
  const suitePath = path.join(benchmarkDir, 'suite.json');
  await fs.writeFile(suitePath, JSON.stringify(suite), 'utf8');
  return { projectRoot, suite, suitePath, traceDir };
}

test('Spec 028 T068 — report runs the parent, stores raw JSONL externally, and stays portable', async t => {
  const fixture = await makeFixtureSuite();
  t.after(() => fs.rm(fixture.projectRoot, { recursive: true, force: true }));
  const inputs = new Map();
  const traces = new Map();
  const report = await buildParentObservationReport({
    suite: fixture.suite,
    suitePath: fixture.suitePath,
    repoMap: {},
    traceDir: fixture.traceDir,
    runParent: async ({ caseId, prompt, handoff }) => {
      inputs.set(caseId, { prompt, handoff });
      const rawJsonl = caseId === 'safe'
        ? codexTrace({ command: 'Get-Content src/a.mjs | Select-Object -First 1' })
        : caseId === 'broad'
          ? codexTrace({ command: 'rg -n pinned . src/a.mjs' })
          : 'not-json\n';
      traces.set(caseId, rawJsonl);
      return { rawJsonl, exitCode: 0 };
    },
  });
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.metrics.denominatorCaseCount, 3);
  assert.equal(report.metrics.observedCaseCount, 2);
  assert.equal(report.metrics.invalidObservationCaseCount, 1);
  assert.equal(report.metrics.noBroadNativeResearchCaseCount, 1);
  assert.equal(report.metrics.passed, false);
  assert.deepEqual(report.cases.map(item => item.repoId), [
    'fixture-repo', 'fixture-repo', 'fixture-repo',
  ]);
  assert.deepEqual(report.cases.map(item => item.observed), [true, true, false]);
  assert.deepEqual(report.cases.map(item => item.noBroad), [true, false, false]);
  for (const item of report.cases) {
    const input = inputs.get(item.id);
    assert.deepEqual(item.sourcePin, {
      kind: 'fixture',
      repoTreeSha256: fixture.suite.sources.fixture.repoTreeSha256,
    });
    assert.equal(item.promptSha256, sha256Text(input.prompt));
    assert.equal(item.handoffSha256, sha256Text(JSON.stringify(input.handoff)));
    assert.equal(item.traceSha256, sha256Text(traces.get(item.id)));
  }
  assert.deepEqual((await fs.readdir(fixture.traceDir)).sort(), [
    'broad.jsonl', 'invalid.jsonl', 'safe.jsonl',
  ]);
  const rawTrace = await fs.readFile(path.join(fixture.traceDir, 'safe.jsonl'), 'utf8');
  assert.match(rawTrace, /raw repository prose that must stay external/);
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    fixture.projectRoot, 'raw repository prose', 'input_tokens', 'output_tokens',
    'directAnswer', 'aggregated_output', 'command_execution', 'Get-Content', 'rg -n',
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test('Spec 028 T068 — source pin mismatch blocks the parent before execution', async t => {
  const fixture = await makeFixtureSuite();
  t.after(() => fs.rm(fixture.projectRoot, { recursive: true, force: true }));
  fixture.suite.sources.fixture.repoTreeSha256 = '0'.repeat(64);
  let called = false;
  const report = await buildParentObservationReport({
    suite: { ...fixture.suite, cases: [oracleCase('pin-mismatch')] },
    suitePath: fixture.suitePath,
    repoMap: {},
    traceDir: fixture.traceDir,
    runParent: async () => {
      called = true;
      return { rawJsonl: codexTrace(), exitCode: 0 };
    },
  });
  assert.equal(called, false);
  assert.deepEqual(report.cases[0].violations, ['source_pin_mismatch']);
});

test('Spec 028 T068 — repository aliases never replace the source logical repo id', async t => {
  const fixture = await makeFixtureSuite();
  t.after(() => fs.rm(fixture.projectRoot, { recursive: true, force: true }));
  const repoRoot = path.join(fixture.projectRoot, 'fixture', 'repo');
  fixture.suite.sources.fixture = {
    kind: 'repository',
    repoId: 'cerebras-explorer-mcp',
  };
  const report = await buildParentObservationReport({
    suite: { ...fixture.suite, cases: [oracleCase('mapped-source')] },
    suitePath: fixture.suitePath,
    repoMap: { self: repoRoot },
    traceDir: fixture.traceDir,
    runParent: async () => {
      assert.fail('a missing source pin must block parent execution');
    },
  });
  assert.equal(report.cases[0].repoId, 'cerebras-explorer-mcp');
  assert.deepEqual(report.cases[0].violations, ['source_pin_missing']);
});

test('Spec 028 T068 — unsafe or duplicate case ids cannot become trace paths', async t => {
  const fixture = await makeFixtureSuite();
  t.after(() => fs.rm(fixture.projectRoot, { recursive: true, force: true }));
  for (const cases of [
    [oracleCase('../escape')],
    [oracleCase('duplicate'), oracleCase('duplicate')],
  ]) {
    await assert.rejects(buildParentObservationReport({
      suite: { ...fixture.suite, cases },
      suitePath: fixture.suitePath,
      repoMap: {},
      traceDir: fixture.traceDir,
      runParent: async () => ({ rawJsonl: codexTrace(), exitCode: 0 }),
    }), /case ids must be safe and unique/);
  }
});

test('Spec 028 T068 — the trust-suite parent denominator cannot silently shrink', async () => {
  const traceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'parent-denominator-'));
  try {
    await assert.rejects(buildParentObservationReport({
      suite: {
        schemaVersion: 1, name: 'trust-known-answer', sources: {}, cases: [],
      },
      suitePath: path.resolve('benchmarks/trust-known-answer.json'),
      repoMap: {},
      traceDir,
      runParent: async () => ({ rawJsonl: codexTrace(), exitCode: 0 }),
    }), /denominator drifted from the fixed 14 cases/);
  } finally {
    await fs.rm(traceDir, { recursive: true, force: true });
  }
});
