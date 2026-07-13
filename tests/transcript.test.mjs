import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildCompactToolDiagnostic,
  createCompactToolTrace,
  createTranscriptRecorder,
  isTranscriptEnabled,
  isTranscriptRawMode,
  recordPlanningEvent,
  recordTrustEvent,
} from '../src/explorer/transcript.mjs';

function withEnvPatch(patch, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

async function readJsonl(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  return source.trim().split('\n').map(line => JSON.parse(line));
}

const TRANSCRIPT_ENV_OFF = {
  CEREBRAS_EXPLORER_LOG_PATH: undefined,
  CEREBRAS_EXPLORER_LOG_RAW: undefined,
  CEREBRAS_EXPLORER_TRANSCRIPT: undefined,
  CEREBRAS_EXPLORER_TRANSCRIPT_DIR: undefined,
};

const FAKE_PROVENANCE = {
  serverName: 'cerebras-explorer-mcp',
  serverVersion: '0.8.2',
  packageVersion: '0.8.2',
  schemaVersion: 2,
  gitSha: 'abc1234',
  toolRegistryHash: 'a'.repeat(64),
  exposedToolCount: 8,
  toolNames: ['explore_repo'],
};

test('LOG_PATH enables transcripts with UUID callId and default redaction', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-log-'));
  const fakeKey = 'sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
  }, async () => {
    assert.equal(isTranscriptEnabled(), true);
    assert.equal(isTranscriptRawMode(), false);

    const recorder = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_repo',
      task: 'inspect auth flow',
    });

    assert.equal(typeof recorder.filePath, 'string');
    assert.equal(typeof recorder.callId, 'string');
    assert.match(recorder.callId, /^[0-9a-f-]{36}$/);
    assert.match(
      path.basename(recorder.filePath),
      /^[0-9T-]+Z_explore_repo_[0-9a-f-]{36}\.jsonl$/,
    );

    recorder.record('assistant', { content: `provider returned ${fakeKey}` });
    await recorder.finalize({ turns: 1, toolCalls: 0 });

    const entries = await readJsonl(recorder.filePath);
    const filenameCallId = path.basename(recorder.filePath, '.jsonl').split('_').at(-1);
    assert.equal(filenameCallId, recorder.callId);
    assert.ok(entries.length >= 3);
    assert.ok(entries.every(entry => entry.callId === recorder.callId));
    assert.equal(entries.at(-1).redacted, true);
    assert.equal(entries.at(-1).callId, recorder.callId);

    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(fakeKey), false);
    assert.match(serialized, /\[REDACTED:openai-api-key\]/);
  });
});

test('LOG_PATH transcript metadata records execution provenance when supplied', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-provenance-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-provenance-log-'));

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
  }, async () => {
    const recorder = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_repo',
      task: 'inspect provenance',
      provenance: FAKE_PROVENANCE,
    });

    await recorder.finalize({ turns: 0, toolCalls: 0 });

    const entries = await readJsonl(recorder.filePath);
    assert.deepEqual(entries[0].provenance, FAKE_PROVENANCE);
    assert.equal(entries[0].type, 'meta');
    assert.equal(entries[0].tool, 'explore_repo');
  });
});

test('Spec 028 T023 — planning events force redaction and immutable metadata in raw mode', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-plan-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-plan-log-'));
  const fakeKey = `sk-proj-${'p'.repeat(32)}`;

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const recorder = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_repo',
      task: 'inspect planning trace',
    });
    recordPlanningEvent(recorder, 'plan_proposed', {
      t: 0,
      type: 'assistant',
      callId: 'attacker-controlled',
      detail: `plan_proposed ${fakeKey}`,
      path: 'config/.env',
    });
    await recorder.finalize({ turns: 0, toolCalls: 0 });

    const entries = await readJsonl(recorder.filePath);
    const planningEntry = entries.find(entry => entry.type === 'plan_proposed');
    assert.equal(planningEntry.callId, recorder.callId);
    assert.ok(planningEntry.t > 0);
    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(fakeKey), false);
    assert.match(serialized, /\[REDACTED:openai-api-key\]/);
    assert.equal(serialized.includes('config/.env'), false);
    assert.match(serialized, /\[REDACTED:secret-path\]/);
  });
});

test('structured safety limits are emitted as exact record-only transcript events', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-limit-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-limit-log-'));

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
  }, async () => {
    const recorder = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_repo',
      task: 'inspect a bounded repository',
    });
    const limit = {
      name: 'context_limit',
      stage: 'verification',
      affectedSubgoalIds: ['S1'],
      truncated: true,
    };

    await recorder.finalize({ turns: 1, toolCalls: 0, safetyLimits: [limit] });

    const entries = await readJsonl(recorder.filePath);
    const safetyEvents = entries.filter(entry => entry.type === 'safety_limit');
    assert.equal(safetyEvents.length, 1);
    assert.deepEqual(
      {
        name: safetyEvents[0].name,
        stage: safetyEvents[0].stage,
        affectedSubgoalIds: safetyEvents[0].affectedSubgoalIds,
        truncated: safetyEvents[0].truncated,
      },
      limit,
    );
    assert.equal(entries.at(-1).type, 'meta', 'final summary stays the last transcript record');
  });
});

test('Spec 028 T034 — trust events are allowlisted and forced-redacted in raw mode', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-trust-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-trust-log-'));
  const sentinel = 'UNVERIFIED_TRANSCRIPT_PROSE_SENTINEL';
  const fakeKey = `sk-proj-${'t'.repeat(32)}`;
  const allowedSecretId = `AKIA${'A'.repeat(16)}`;

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    const recorder = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_repo',
      task: 'inspect trust events',
    });
    recordTrustEvent(recorder, 'claim', {
      t: 0,
      type: 'attacker-type',
      callId: 'attacker-call-id',
      phase: 'initial',
      claims: [{
        id: 'C1',
        subgoalId: 'S1',
        text: `${sentinel} ${fakeKey} config/.env`,
        evidenceRefs: ['E1', fakeKey],
        arbitrary: sentinel,
      }],
    });
    recordTrustEvent(recorder, 'verdict', {
      phase: 'initial',
      claims: [{ id: 'C1', subgoalId: 'S1', evidenceRefs: ['E1'] }],
      verdicts: [{
        claimId: 'C1',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['E1'],
        reasonCode: 'entailed',
        note: sentinel,
      }],
      uncoveredRequestParts: [{ question: sentinel, proofCondition: sentinel }],
    });
    recordTrustEvent(recorder, 'repair', {
      status: 'started',
      gaps: [{ id: 'G1', subgoalId: 'S1', question: sentinel, followUp: sentinel }],
      priorActionFingerprints: ['tool:one'],
    });
    recordTrustEvent(recorder, 'repair', {
      status: 'finished',
      outcome: 'completed',
      selectedGapIds: ['G1'],
      affectedSubgoalIds: ['S1'],
      actionFingerprints: ['tool:two'],
      freshEvidenceRefs: ['E2'],
      outcomes: [{ id: 'S1', state: 'supported', resolution: 'affirmed' }],
      completion: sentinel,
    });
    recorder.observeUsage({
      providerIndex: 1,
      model: 'trust-model',
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    });
    recorder.observeUsage({
      model: 'trust-model',
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
    await recorder.finalize({
      toolCalls: 2,
      elapsedMs: 25,
      safetyLimits: [{
        name: 'tool_result_limit',
        stage: 'repair',
        affectedSubgoalIds: ['S1', allowedSecretId, 'config/.env'],
        truncated: true,
      }],
    }, {
      finalEvent: {
        failureReason: null,
        requiredSubgoals: [{ id: 'S1', state: 'supported', resolution: 'affirmed' }],
        acceptedClaimIds: ['C1'],
        gaps: [],
        parentPayload: {
          encoding: 'utf8',
          contentBytes: 11,
          structuredContentBytes: 17,
          parentPayloadBytes: 28,
          sha256: 'a'.repeat(64),
          ignored: sentinel,
        },
        directAnswer: sentinel,
      },
    });

    const entries = await readJsonl(recorder.filePath);
    assert.deepEqual(entries.map(entry => entry.type), [
      'meta',
      'claim',
      'verdict',
      'repair',
      'repair',
      'safety_limit',
      'final',
      'usage',
      'meta',
    ]);
    assert.deepEqual(entries[1].claims, [{
      claimId: 'C1',
      subgoalId: 'S1',
      evidenceRefs: ['E1', '[REDACTED:openai-api-key]'],
    }]);
    assert.equal(entries[2].uncoveredProposalCount, 1);
    assert.equal(entries[2].verdicts[0].subgoalId, 'S1');
    assert.equal(entries[3].status, 'started');
    assert.equal(entries[4].status, 'finished');
    assert.equal(entries[4].outcome, 'completed');
    assert.equal(entries[5].stage, 'repair');
    assert.deepEqual(entries[6].acceptedClaimIds, ['C1']);
    assert.deepEqual(entries[6].parentPayload, {
      encoding: 'utf8',
      contentBytes: 11,
      structuredContentBytes: 17,
      parentPayloadBytes: 28,
      sha256: 'a'.repeat(64),
    });
    assert.deepEqual(entries[7], {
      providerIndex: 1,
      model: 'trust-model',
      providerCalls: 2,
      repositoryToolCalls: 2,
      inputTokens: 16,
      outputTokens: 10,
      totalTokens: 26,
      elapsedMs: 25,
      t: entries[7].t,
      type: 'usage',
      callId: recorder.callId,
    });
    assert.ok(entries.every(entry => entry.callId === recorder.callId));
    assert.equal(entries.at(-1).type, 'meta');
    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(sentinel), false);
    assert.equal(serialized.includes(fakeKey), false);
    assert.doesNotMatch(serialized, /config\/\.env/);
    assert.match(serialized, /\[REDACTED:aws-access-key\]/);
    assert.match(serialized, /\[REDACTED:openai-api-key\]/);
    assert.match(serialized, /\[REDACTED:secret-path\]/);
    assert.deepEqual(entries.at(-1).stats.safetyLimits[0].affectedSubgoalIds, [
      'S1',
      '[REDACTED:aws-access-key]',
      '[REDACTED:secret-path]',
    ]);
  });
});

test('LOG_RAW truthy mode preserves raw transcript record data and marks final meta', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-raw-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-raw-log-'));
  const fakeKey = 'sk-proj-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_LOG_RAW: 'true',
  }, async () => {
    assert.equal(isTranscriptRawMode(), true);
    const recorder = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_repo',
      task: 'inspect raw mode',
    });

    recorder.record('assistant', { content: `raw key ${fakeKey}` });
    await recorder.finalize({ turns: 1, toolCalls: 0 });

    const entries = await readJsonl(recorder.filePath);
    assert.equal(entries.at(-1).redacted, false);
    assert.match(JSON.stringify(entries), new RegExp(fakeKey));
  });
});

test('legacy transcript envvars are ignored even when set alongside LOG_PATH', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-precedence-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-precedence-log-'));
  const legacyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-legacy-log-'));

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
    CEREBRAS_EXPLORER_TRANSCRIPT: 'true',
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: legacyDir,
  }, async () => {
    const recorder = createTranscriptRecorder({ repoRoot, tool: 'explore_repo', task: 'precedence' });
    await recorder.finalize({ turns: 0, toolCalls: 0 });

    assert.equal(path.dirname(recorder.filePath), path.resolve(logDir));
    assert.deepEqual((await fs.readdir(legacyDir)).filter(name => name.endsWith('.jsonl')), []);
  });
});

test('legacy TRANSCRIPT envvars no longer enable transcripts (removed in v0.7.0)', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-legacy-repo-'));
  const legacyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-legacy-dir-'));

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_TRANSCRIPT: 'yes',
    CEREBRAS_EXPLORER_TRANSCRIPT_DIR: legacyDir,
  }, async () => {
    assert.equal(isTranscriptEnabled(), false);
    const recorder = createTranscriptRecorder({ repoRoot, tool: 'explore_repo', task: 'legacy' });
    assert.equal(recorder.filePath, null);
    assert.equal(recorder.callId, null);
    await recorder.finalize({ turns: 0, toolCalls: 0 });

    assert.deepEqual((await fs.readdir(legacyDir)).filter(name => name.endsWith('.jsonl')), []);
  });
});

test('transcripts stay disabled when neither LOG_PATH nor legacy enable flag is set', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-off-repo-'));

  await withEnvPatch(TRANSCRIPT_ENV_OFF, async () => {
    assert.equal(isTranscriptEnabled(), false);
    const recorder = createTranscriptRecorder({ repoRoot, tool: 'explore_repo', task: 'off' });

    assert.equal(recorder.filePath, null);
    assert.equal(recorder.callId, null);
    recorder.record('assistant', { content: 'no-op' });
    await recorder.finalize({ turns: 0, toolCalls: 0 });
  });
});

test('default transcript redaction masks deny-list paths and secret values', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-deny-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-deny-log-'));
  const fakeKey = 'sk-proj-cccccccccccccccccccccccccccccccc';

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
  }, async () => {
    const recorder = createTranscriptRecorder({ repoRoot, tool: 'explore_repo', task: 'deny-list' });
    recorder.record('tool', {
      path: '.env',
      content: `OPENAI_API_KEY=${fakeKey}`,
    });
    await recorder.finalize({ turns: 1, toolCalls: 1 });

    const serialized = JSON.stringify(await readJsonl(recorder.filePath));
    assert.equal(serialized.includes(fakeKey), false);
    assert.doesNotMatch(serialized, /\.env/);
    assert.match(serialized, /\[REDACTED:openai-api-key\]/);
    assert.match(serialized, /\[REDACTED:secret-path\]/);
  });
});

test('compact tool trace stores bounded tool summaries without raw content', () => {
  const trace = createCompactToolTrace({ maxEntries: 2 });

  trace.record({
    turn: 1,
    tool: 'repo_read_file',
    args: { path: 'src/auth.js', startLine: 1, endLine: 40 },
    result: {
      path: 'src/auth.js',
      startLine: 1,
      endLine: 40,
      totalLines: 100,
      truncated: false,
      content: 'secret raw file content must not be retained',
    },
  });
  trace.record({
    turn: 2,
    tool: 'repo_grep',
    args: { pattern: 'requireAuth', scope: ['src/**'], maxResults: 20 },
    result: {
      matches: [
        { path: 'src/auth.js', line: 1, text: 'export function requireAuth() {}' },
        { path: 'src/routes/user.js', line: 4, text: 'app.get("/me", requireAuth)' },
      ],
      truncated: false,
    },
  });
  trace.record({
    turn: 3,
    tool: 'repo_symbols',
    args: { path: 'src/auth.js', kind: 'all' },
    result: {
      path: 'src/auth.js',
      symbols: [{ name: 'requireAuth' }],
    },
  });

  const result = trace.toJSON();
  assert.equal(result.totalCalls, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries[0].args, { path: 'src/auth.js', startLine: 1, endLine: 40 });
  assert.deepEqual(result.entries[0].result, {
    path: 'src/auth.js',
    startLine: 1,
    endLine: 40,
    totalLines: 100,
    truncated: false,
  });
  assert.equal(result.entries[1].result.matches, 2);
  assert.deepEqual(result.entries[1].result.paths, ['src/auth.js', 'src/routes/user.js']);
  assert.equal(JSON.stringify(result).includes('secret raw file content'), false);
  assert.equal(JSON.stringify(result).includes('export function requireAuth'), false);
});

test('compact tool trace records short error summaries', () => {
  const trace = createCompactToolTrace();
  trace.record({
    turn: 1,
    tool: 'repo_read_file',
    args: { path: 'src/missing.js' },
    result: {
      error: true,
      type: 'tool_execution_error',
      stage: 'parse_or_exec',
      message: 'Unable to access path src/missing.js',
    },
  });

  const result = trace.toJSON();
  assert.equal(result.entries[0].result.error, true);
  assert.equal(result.entries[0].result.type, 'tool_execution_error');
  assert.match(result.entries[0].result.message, /missing/);
});

test('compact tool trace bounds nested argument depth', () => {
  const trace = createCompactToolTrace();
  let nested = 'leaf';
  for (let i = 0; i < 10000; i += 1) {
    nested = { child: nested };
  }

  assert.doesNotThrow(() => {
    trace.record({
      turn: 1,
      tool: 'repo_list_dir',
      args: { dirPath: '.', scope: nested },
      result: { entries: [] },
    });
  });

  const result = trace.toJSON();
  assert.equal(result.totalCalls, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(JSON.stringify(result.entries[0].args).includes('[MaxDepth]'), true);
});

test('finalize waits for in-flight threshold flushes so JSONL contains all records in order', async () => {
  // FLUSH_THRESHOLD is 5 (internal). Recording 11 entries triggers two
  // threshold-based fire-and-forget flushes before finalize is called.
  // Without the writeChain serialization those flushes could race with the
  // finalize flush and produce an incomplete or out-of-order JSONL.
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-chain-repo-'));
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-transcript-chain-log-'));

  await withEnvPatch({
    ...TRANSCRIPT_ENV_OFF,
    CEREBRAS_EXPLORER_LOG_PATH: logDir,
  }, async () => {
    const recorder = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_repo',
      task: 'chain test',
    });

    // Record 11 entries synchronously to trigger two threshold flushes (at 5
    // and 10 buffered entries including the initial meta record written in the
    // constructor). Then call finalize without any await in between.
    for (let i = 0; i < 11; i += 1) {
      recorder.record('assistant', { seq: i });
    }
    await recorder.finalize({ turns: 11, toolCalls: 0 });

    const entries = await readJsonl(recorder.filePath);

    // Must contain: initial meta + 11 assistant records + usage + final meta.
    assert.equal(entries.length, 14);
    // Every entry must carry the correct callId (proves no corruption)
    assert.ok(entries.every(entry => entry.callId === recorder.callId));
    // Initial meta record is first
    assert.equal(entries[0].type, 'meta');
    assert.equal(entries[0].tool, 'explore_repo');
    // Final meta record is last
    assert.equal(entries.at(-1).type, 'meta');
    assert.ok('stats' in entries.at(-1));
    // Assistant records are present and in order
    const assistantEntries = entries.filter(entry => entry.type === 'assistant');
    assert.equal(assistantEntries.length, 11);
    for (let i = 0; i < 11; i += 1) {
      assert.equal(assistantEntries[i].seq, i);
    }
  });
});

test('compact tool diagnostics expose redacted args and result summaries without raw content', () => {
  const diagnostic = buildCompactToolDiagnostic({
    tool: 'repo_read_file',
    args: {
      path: 'src/auth.js',
      startLine: 1,
      endLine: 40,
      ignoredPrompt: 'do not retain this',
    },
    result: {
      path: 'src/auth.js',
      startLine: 1,
      endLine: 40,
      totalLines: 100,
      truncated: false,
      content: 'raw source content must not be retained',
    },
  });

  assert.deepEqual(diagnostic.args, { path: 'src/auth.js', startLine: 1, endLine: 40 });
  assert.deepEqual(diagnostic.result, {
    path: 'src/auth.js',
    startLine: 1,
    endLine: 40,
    totalLines: 100,
    truncated: false,
  });
  assert.equal(JSON.stringify(diagnostic).includes('raw source content'), false);
  assert.equal(JSON.stringify(diagnostic).includes('ignoredPrompt'), false);
});
