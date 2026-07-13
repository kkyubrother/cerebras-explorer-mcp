import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ExplorerRuntime } from '../src/explorer/runtime.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MANIFEST_URL = new URL('../benchmarks/trust-known-answer.json', import.meta.url);
const EXPECTED_US1_FIXTURE_IDS = Object.freeze([
  'fx-semantic-mismatch',
  'fx-incomplete-multipart',
  'fx-partial-multipart',
  'fx-contradictory-policies',
  'audit-feasible-unsupported',
  'fx-supported-refutation',
  'fx-cancellation',
  'fx-provider-failure',
]);

function projectPath(relativePath) {
  return path.join(PROJECT_ROOT, ...relativePath.split('/'));
}

function responseSchemaRequired(request) {
  const wrapped = request.responseFormat?.json_schema;
  const schema = wrapped?.schema ?? wrapped;
  return Array.isArray(schema?.required) ? schema.required : [];
}

function classifyProviderStage(request, plannerCallCount) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  if (messages.some(message => typeof message?.content === 'string'
      && message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))) {
    return 'repair';
  }

  const required = responseSchemaRequired(request);
  if (required.includes('taskSummary') && required.includes('subgoals')) {
    return plannerCallCount === 0 ? 'planner' : 'plan_revision';
  }
  if (required.includes('goals') && required.includes('uncoveredRequestParts')) {
    return 'goal_audit';
  }
  if (required.includes('findings') && required.includes('uncoveredRequestParts')) {
    return 'goal_coverage';
  }
  if (required.includes('claims')) return 'claim_synthesis';
  if (required.includes('verdicts') && required.includes('uncoveredRequestParts')) {
    return 'semantic_verifier';
  }
  if (request.responseFormat) return 'synthesis';
  return 'exploration';
}

function normalizeFixtureCompletion(result) {
  const message = structuredClone(result.message);
  message.content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
  message.toolCalls = message.toolCalls.map(toolCall => ({
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: typeof toolCall.function?.arguments === 'string'
        ? toolCall.function.arguments
        : JSON.stringify(toolCall.function?.arguments ?? {}),
    },
  }));
  return {
    usage: result.usage ?? {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
    },
    finishReason: result.finishReason ?? (message.toolCalls.length > 0 ? 'tool_calls' : 'stop'),
    message,
  };
}

class SequentialFixtureClient {
  constructor(document, { beforeResponse = null } = {}) {
    this.model = 'fixture-us1';
    this.responses = document.responses;
    this.cursor = 0;
    this.plannerCallCount = 0;
    this.stageLabels = [];
    this.beforeResponse = beforeResponse;
    this.abortPending = new Promise(resolve => {
      this.resolveAbortPending = resolve;
    });
  }

  async createChatCompletion(request) {
    const stage = classifyProviderStage(request, this.plannerCallCount);
    if (stage === 'planner' || stage === 'plan_revision') this.plannerCallCount += 1;
    this.stageLabels.push(stage);

    const response = this.responses[this.cursor];
    assert.ok(response, `unexpected provider call ${stage}`);
    assert.equal(stage, response.stage, `provider stage ${this.cursor + 1}`);
    this.cursor += 1;

    if (this.beforeResponse) {
      await this.beforeResponse({ stage, responseIndex: this.cursor - 1 });
    }

    if (response.waitForAbort === true) {
      assert.ok(request.signal, 'waitForAbort requires the runtime abort signal');
      this.resolveAbortPending();
      await new Promise((resolve, reject) => {
        const abort = () => {
          const error = new Error('fixture request aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
      });
      assert.fail('waitForAbort fixture unexpectedly resolved');
    }

    if (response.error) {
      const error = new Error(response.error.message);
      error.name = response.error.name ?? 'Error';
      if (typeof response.error.retryable === 'boolean') {
        error.retryable = response.error.retryable;
      }
      throw error;
    }
    return normalizeFixtureCompletion(response.result);
  }

  assertConsumed() {
    assert.equal(this.cursor, this.responses.length, 'provider fixture must be fully consumed');
  }
}

function normalizeStatement(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizePath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function sameStringSet(actual, expected) {
  return actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function deriveTrustState(result) {
  if (result.failure) return 'failed';
  const subgoals = result.taskContract?.subgoals;
  assert.ok(Array.isArray(subgoals) && subgoals.length > 0,
    'non-failed result requires a runtime task contract');
  return subgoals.every(goal => goal.state === 'supported') ? 'complete' : 'incomplete';
}

function goalMatchesOracle(goal, expectedResolution) {
  if (expectedResolution === 'supported') {
    return goal.state === 'supported' && goal.resolution === 'affirmed';
  }
  if (expectedResolution === 'refuted') {
    return goal.state === 'supported' && goal.resolution === 'refuted';
  }
  if (expectedResolution === 'gap') {
    return ['blocked', 'gap', 'contradicted'].includes(goal.state)
      && goal.resolution === undefined;
  }
  return false;
}

function assertGoalOracle(caseDefinition, result, state) {
  const expectedGoals = caseDefinition.oracle.expectedGoals;
  if (state === 'failed') {
    assert.ok(expectedGoals.every(goal => goal.expectedResolution === 'failed'),
      'only failed goal oracles may match a fatal runtime result');
    return {
      signature: expectedGoals.map(goal =>
        `${goal.id}:${normalizeStatement(goal.question)}:${goal.requestOriginRefs.join(',')}:${goal.claimType}:failed`).sort(),
      runtimeGoalByOracleId: new Map(),
    };
  }

  const actualGoals = result.taskContract.subgoals;
  assert.equal(actualGoals.length, expectedGoals.length,
    'runtime required-goal count must match the independent oracle');
  const remaining = [...actualGoals];
  const runtimeGoalByOracleId = new Map();
  for (const expected of expectedGoals) {
    const matchIndex = remaining.findIndex(goal =>
      normalizeStatement(goal.question) === normalizeStatement(expected.question)
      && sameStringSet(goal.originRefs ?? [], expected.requestOriginRefs)
      && goal.claimType === expected.claimType
      && goalMatchesOracle(goal, expected.expectedResolution));
    assert.notEqual(matchIndex, -1,
      `missing ${expected.id}:${expected.claimType}:${expected.expectedResolution} runtime goal`);
    runtimeGoalByOracleId.set(expected.id, remaining[matchIndex]);
    remaining.splice(matchIndex, 1);
  }
  assert.equal(remaining.length, 0);
  return {
    signature: expectedGoals.map(expected => {
      const goal = runtimeGoalByOracleId.get(expected.id);
      return `${expected.id}:${normalizeStatement(goal.question)}:${[...(goal.originRefs ?? [])].sort().join(',')}:` +
        `${goal.claimType}:${goal.state}:${goal.resolution ?? '-'}`;
    }).sort(),
    runtimeGoalByOracleId,
  };
}

function acceptedClaims(result) {
  if (result.failure) return [];
  const stateByGoal = new Map(result.taskContract.subgoals.map(goal => [goal.id, goal.state]));
  const verdictByClaimId = new Map((result.semanticVerification?.verdicts ?? [])
    .map(verdict => [verdict.claimId, verdict]));
  return (result.semanticVerification?.claims ?? [])
    .filter(claim => claim.verdict === 'supported'
      && stateByGoal.get(claim.subgoalId) === 'supported')
    .map(claim => ({
      id: claim.id,
      subgoalId: claim.subgoalId,
      text: normalizeStatement(claim.text),
      evidenceRefs: [...claim.evidenceRefs].sort(),
      supportingEvidenceRefs: [
        ...(verdictByClaimId.get(claim.id)?.supportingEvidenceRefs ?? []),
      ].sort(),
    }))
    .sort((left, right) => left.text.localeCompare(right.text));
}

function sourceRangeCovers(item, anchor) {
  return normalizePath(item?.path) === normalizePath(anchor?.path)
    && Number.isInteger(item?.startLine)
    && Number.isInteger(item?.endLine)
    && item.startLine <= anchor.startLine
    && item.endLine >= anchor.endLine;
}

async function assertClaimOracle(manifest, caseDefinition, result, accepted, runtimeGoalByOracleId) {
  const expected = caseDefinition.oracle.allowedClaims;
  assert.deepEqual(accepted.map(claim => claim.text),
    expected.map(claim => normalizeStatement(claim.text)).sort(),
    'accepted runtime claims must exactly match the independent allow-list');

  const acceptedByText = new Map(accepted.map(claim => [claim.text, claim]));
  const observationById = new Map((result.observations ?? []).map(observation =>
    [observation.id, observation]));
  const anchorById = new Map(caseDefinition.oracle.evidenceAnchors.map(anchor =>
    [anchor.id, anchor]));

  for (const allowed of expected) {
    const claim = acceptedByText.get(normalizeStatement(allowed.text));
    const goal = runtimeGoalByOracleId.get(allowed.goalId);
    assert.ok(goal, `allowed claim references unmatched oracle goal ${allowed.goalId}`);
    assert.equal(claim.subgoalId, goal.id,
      `allowed claim ${allowed.id} must belong to oracle goal ${allowed.goalId}`);

    for (const anchorRef of allowed.evidenceAnchorRefs) {
      const anchor = anchorById.get(anchorRef);
      assert.ok(anchor, `missing oracle evidence anchor ${anchorRef}`);
      assert.equal(anchor.kind, 'source', 'US1 runtime anchors must be source ranges');
      const supportingObservation = claim.supportingEvidenceRefs
        .map(ref => observationById.get(ref))
        .find(observation => sourceRangeCovers(observation, anchor));
      assert.ok(supportingObservation,
        `allowed claim ${allowed.id} lacks runtime observation for ${anchorRef}`);
      const parentEvidence = (result.evidence ?? []).find(item =>
        sourceRangeCovers(item, anchor) && sourceRangeCovers(item, supportingObservation));
      assert.ok(parentEvidence,
        `parent evidence for ${allowed.id} is not aligned with ${supportingObservation.id}`);
      const source = manifest.sources[caseDefinition.sourceRef];
      const sourceLines = (await fs.readFile(
        path.join(projectPath(source.repoPath), ...anchor.path.split('/')),
        'utf8',
      )).split(/\r?\n/);
      const expectedSnippet = sourceLines
        .slice(anchor.startLine - 1, anchor.endLine)
        .map((line, index) => `${anchor.startLine + index}: ${line}`)
        .join('\n');
      assert.ok(String(parentEvidence.snippet ?? '').includes(expectedSnippet),
        `parent evidence for ${allowed.id} does not match the pinned fixture source`);
    }
  }

  const acceptedTextSet = new Set(accepted.map(claim => claim.text));
  const directStatements = String(result.directAnswer ?? '')
    .split(/\r?\n+/)
    .map(normalizeStatement)
    .filter(Boolean)
    .sort();
  if (!result.failure) {
    assert.deepEqual(directStatements, expected.map(claim => normalizeStatement(claim.text)).sort(),
      'parent directAnswer must contain exactly the accepted allow-listed claims');
  } else {
    assert.equal(normalizeStatement(result.directAnswer), normalizeStatement(result.failure.message),
      'failed results may return only their normalized failure message');
  }
  for (const forbidden of caseDefinition.oracle.forbiddenClaims) {
    const statement = normalizeStatement(forbidden.text);
    assert.equal(acceptedTextSet.has(statement), false, `forbidden claim accepted: ${statement}`);
    assert.equal(directStatements.includes(statement), false, `forbidden claim returned: ${statement}`);
  }
}

async function runFixtureCase(manifest, caseDefinition, providerOverride = null, options = {}) {
  const source = manifest.sources[caseDefinition.sourceRef];
  const providerPath = caseDefinition.providerFixture?.path ?? source.providerPath;
  const provider = providerOverride ?? JSON.parse(await fs.readFile(projectPath(providerPath), 'utf8'));
  const client = new SequentialFixtureClient(provider, {
    beforeResponse: options.beforeResponse,
  });
  const runtime = new ExplorerRuntime({ chatClient: client });
  const controller = provider.responses.some(response => response.waitForAbort === true)
    ? new AbortController()
    : null;
  const running = runtime.explore({
    ...caseDefinition.invocation.args,
    repo_root: options.repoRoot ?? projectPath(source.repoPath),
  }, controller ? { abortSignal: controller.signal } : undefined);
  if (controller) {
    await client.abortPending;
    controller.abort();
  }
  const result = await running;
  client.assertConsumed();
  return { result, stages: client.stageLabels };
}

test('Spec 028 T035 — US1 known-answer fixtures agree on state and claims across three runs', {
  timeout: 30_000,
}, async t => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_URL, 'utf8'));
  const caseById = new Map(manifest.cases.map(caseDefinition => [caseDefinition.id, caseDefinition]));
  const subset = manifest.fixtureSubsets.US1;

  assert.deepEqual([...subset].sort(), [...EXPECTED_US1_FIXTURE_IDS].sort());
  for (const caseId of subset) {
    await t.test(caseId, async () => {
      const caseDefinition = caseById.get(caseId);
      assert.ok(caseDefinition);
      assert.equal(caseDefinition.repeatCount, 3);
      const signatures = [];

      for (let run = 0; run < caseDefinition.repeatCount; run += 1) {
        const { result, stages } = await runFixtureCase(manifest, caseDefinition);
        const state = deriveTrustState(result);
        assert.equal(state, caseDefinition.oracle.expectedState);
        assert.equal(typeof result.status?.complete, 'boolean');
        assert.equal(result.status.complete, state === 'complete',
          'parent completion must agree with independently reduced trust state');
        if (state === 'failed') {
          assert.deepEqual({
            category: result.failure?.category,
            reason: result.failure?.reason,
          }, caseDefinition.oracle.expectedFailure);
        } else {
          assert.equal(result.failure, null);
        }
        const { signature: goals, runtimeGoalByOracleId } =
          assertGoalOracle(caseDefinition, result, state);
        const accepted = acceptedClaims(result);
        await assertClaimOracle(manifest, caseDefinition, result, accepted, runtimeGoalByOracleId);

        if (caseId === 'fx-incomplete-multipart') {
          assert.equal(stages.filter(stage => stage === 'plan_revision').length, 1);
        }
        if (caseId === 'audit-feasible-unsupported') {
          assert.ok(stages.includes('repair'));
        }
        signatures.push(JSON.stringify({ state, goals, accepted }));
      }

      assert.equal(new Set(signatures).size, 1,
        'state, goal resolution, and accepted claims must be stable across repeats');
    });
  }
});

test('Spec 028 T035 — parent evidence is rebuilt when final evidence is remapped', async () => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_URL, 'utf8'));
  const caseDefinition = manifest.cases.find(item => item.id === 'fx-supported-refutation');
  assert.ok(caseDefinition);
  const provider = JSON.parse(await fs.readFile(
    projectPath(caseDefinition.providerFixture.path), 'utf8'));
  const mutated = structuredClone(provider);
  const synthesis = mutated.responses.find(response => response.stage === 'synthesis');
  const evidence = synthesis?.result?.message?.content?.evidence;
  const remapped = evidence?.find(item => item.id === 'E3');
  assert.ok(remapped);
  Object.assign(remapped, {
    path: 'src/policy.mjs',
    startLine: 1,
    endLine: 1,
    why: 'A grounded but unrelated policy declaration.',
  });

  const { result } = await runFixtureCase(manifest, caseDefinition, mutated);
  assert.equal(result.taskContract.subgoals[0].state, 'supported',
    'the adversarial mutation must isolate parent-evidence projection');
  assert.equal(result.status.complete, true);
  assert.equal(result.directAnswer,
    "The claim is false: legacyRouteAccess is 'public', so not every route requires authentication.");
  assert.deepEqual(result.evidence.map(item => ({
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
  })), [{ path: 'src/routes/legacy.mjs', startLine: 1, endLine: 1 }]);
});

test('Spec 028 T035 — parent evidence is rebuilt when final evidence crops its observation', async () => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_URL, 'utf8'));
  const caseDefinition = manifest.cases.find(item => item.id === 'fx-incomplete-multipart');
  assert.ok(caseDefinition);
  const provider = JSON.parse(await fs.readFile(
    projectPath(caseDefinition.providerFixture.path), 'utf8'));
  const mutated = structuredClone(provider);
  const synthesis = mutated.responses.find(response => response.stage === 'synthesis');
  const evidence = synthesis?.result?.message?.content?.evidence;
  const cropped = evidence?.find(item => item.id === 'E1');
  assert.ok(cropped);
  cropped.endLine = cropped.startLine;

  const { result } = await runFixtureCase(manifest, caseDefinition, mutated);
  assert.equal(result.taskContract.subgoals.every(goal => goal.state === 'supported'), true,
    'the adversarial mutation must isolate parent-evidence projection');
  assert.equal(result.status.complete, true);
  assert.equal(result.directAnswer.includes("serviceMode returns 'safe'."), true);
  const rebuilt = result.evidence.find(item => item.path === 'src/service.mjs');
  assert.deepEqual({ startLine: rebuilt?.startLine, endLine: rebuilt?.endLine }, {
    startLine: 1,
    endLine: 3,
  });
});

test('Spec 028 T035 — every supported claim in one goal is projected', async () => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_URL, 'utf8'));
  const caseDefinition = manifest.cases.find(item => item.id === 'fx-supported-refutation');
  assert.ok(caseDefinition);
  const provider = JSON.parse(await fs.readFile(
    projectPath(caseDefinition.providerFixture.path), 'utf8'));
  const mutated = structuredClone(provider);
  const claimSynthesis = mutated.responses.find(response => response.stage === 'claim_synthesis');
  const verifier = mutated.responses.find(response => response.stage === 'semantic_verifier');
  const synthesis = mutated.responses.find(response => response.stage === 'synthesis');
  const firstClaim = claimSynthesis.result.message.content.claims.find(claim => claim.id === 'C1');
  Object.assign(firstClaim, {
    text: 'The default access policy is authenticated.',
    evidenceRefs: ['E1'],
  });
  const firstVerdict = verifier.result.message.content.verdicts.find(verdict =>
    verdict.claimId === 'C1');
  Object.assign(firstVerdict, {
    result: 'supported',
    resolution: 'refuted',
    supportingEvidenceRefs: ['E1'],
    reasonCode: 'entailed',
  });
  const remapped = synthesis.result.message.content.evidence.find(item => item.id === 'E3');
  Object.assign(remapped, { path: 'src/policy.mjs', startLine: 1, endLine: 1 });

  const { result } = await runFixtureCase(manifest, caseDefinition, mutated);
  assert.equal(result.taskContract.subgoals[0].state, 'supported');
  assert.equal(result.status.complete, true);
  assert.deepEqual(result.directAnswer.split('\n').sort(), [
    'The default access policy is authenticated.',
    "The claim is false: legacyRouteAccess is 'public', so not every route requires authentication.",
  ].sort());
  assert.deepEqual(result.evidence.map(item => item.path).sort(), [
    'src/policy.mjs',
    'src/routes/legacy.mjs',
  ]);
});

test('Spec 028 T035 — oracle rejects a claim supported by the wrong observation', async () => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_URL, 'utf8'));
  const caseDefinition = manifest.cases.find(item => item.id === 'fx-supported-refutation');
  assert.ok(caseDefinition);
  const provider = JSON.parse(await fs.readFile(
    projectPath(caseDefinition.providerFixture.path), 'utf8'));
  const mutated = structuredClone(provider);
  const claimSynthesis = mutated.responses.find(response => response.stage === 'claim_synthesis');
  const verifier = mutated.responses.find(response => response.stage === 'semantic_verifier');
  const claim = claimSynthesis.result.message.content.claims.find(item => item.id === 'C2');
  claim.evidenceRefs = ['E1', 'E3'];
  const verdict = verifier.result.message.content.verdicts.find(item => item.claimId === 'C2');
  verdict.supportingEvidenceRefs = ['E1'];

  const { result } = await runFixtureCase(manifest, caseDefinition, mutated);
  const state = deriveTrustState(result);
  assert.equal(state, 'complete', 'the mutation must reach the independent oracle');
  const { runtimeGoalByOracleId } = assertGoalOracle(caseDefinition, result, state);
  const accepted = acceptedClaims(result);
  await assert.rejects(() => assertClaimOracle(
    manifest,
    caseDefinition,
    result,
    accepted,
    runtimeGoalByOracleId,
  ), /lacks runtime observation/);
});

test('Spec 028 T035 — source drift after verification fails closed', async t => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_URL, 'utf8'));
  const caseDefinition = manifest.cases.find(item => item.id === 'fx-supported-refutation');
  assert.ok(caseDefinition);
  const source = manifest.sources[caseDefinition.sourceRef];
  const provider = JSON.parse(await fs.readFile(
    projectPath(caseDefinition.providerFixture.path), 'utf8'));

  for (const mutation of ['changed', 'deleted']) {
    await t.test(mutation, async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-explorer-drift-'));
      const repoRoot = path.join(tempRoot, 'repo');
      await fs.cp(projectPath(source.repoPath), repoRoot, { recursive: true });
      let applied = false;
      try {
        const { result } = await runFixtureCase(manifest, caseDefinition, provider, {
          repoRoot,
          beforeResponse: async ({ stage }) => {
            if (stage !== 'synthesis' || applied) return;
            applied = true;
            const target = path.join(repoRoot, 'src', 'routes', 'legacy.mjs');
            if (mutation === 'changed') {
              await fs.writeFile(target, "export const legacyRouteAccess = 'authenticated';\n");
            } else {
              await fs.rm(target);
            }
          },
        });

        assert.equal(applied, true);
        assert.equal(result.taskContract.subgoals[0].state, 'supported',
          'the mutation must occur after semantic verification');
        assert.equal(result.status.complete, false);
        assert.equal(result.directAnswer, '');
        assert.deepEqual(result.evidence, []);
        assert.equal(result.failure, null);
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    });
  }
});
