import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyzeTranscriptEntries, analyzeTranscriptFile } from '../src/benchmark/transcript-metrics.mjs';
import { computeExtendedMetrics } from '../scripts/run-benchmark.mjs';

test('analyzeTranscriptEntries summarizes assistant, broad search, read, and budget signals', () => {
  const metrics = analyzeTranscriptEntries([
    { type: 'assistant', turn: 1, toolCalls: ['repo_grep'] },
    { type: 'tool', turn: 1, tool: 'repo_grep', error: false },
    { type: 'assistant', turn: 2, toolCalls: ['repo_read_file', 'repo_symbols'] },
    { type: 'tool', turn: 2, tool: 'repo_read_file', error: false },
    { type: 'tool', turn: 2, tool: 'repo_symbols', error: false },
    { type: 'meta', stats: { stoppedByBudget: false } },
  ]);

  assert.deepEqual(metrics, {
    assistantTurns: 2,
    toolCalls: 3,
    broadSearchCalls: 1,
    readCalls: 2,
    toolErrorCalls: 0,
    repeatedToolPlanTurns: 0,
    stoppedByBudget: false,
  });
});

test('analyzeTranscriptEntries detects repeated tool plans and tool errors', () => {
  const metrics = analyzeTranscriptEntries([
    { type: 'assistant', turn: 1, toolCalls: [{ name: 'repo_grep' }] },
    { type: 'assistant', turn: 2, toolCalls: [{ name: 'repo_grep' }] },
    { type: 'tool', turn: 2, tool: 'repo_grep', error: true },
  ]);

  assert.equal(metrics.repeatedToolPlanTurns, 1);
  assert.equal(metrics.toolErrorCalls, 1);
});

test('analyzeTranscriptEntries uses the final meta stats for stoppedByBudget', () => {
  const metrics = analyzeTranscriptEntries([
    { type: 'meta', stats: { stoppedByBudget: true } },
    { type: 'meta', stats: { stoppedByBudget: false } },
  ]);

  assert.equal(metrics.stoppedByBudget, false);
});

test('analyzeTranscriptFile returns null for missing paths and parses JSONL files', async () => {
  assert.equal(await analyzeTranscriptFile(null), null);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcript-metrics-'));
  const transcriptPath = path.join(tempDir, 'transcript.jsonl');
  await fs.writeFile(
    transcriptPath,
    [
      JSON.stringify({ type: 'assistant', toolCalls: ['repo_find_files'] }),
      '',
      JSON.stringify({ type: 'tool', tool: 'repo_find_files', error: false }),
      JSON.stringify({ type: 'meta', stats: { stoppedByBudget: true } }),
      '',
    ].join('\n'),
    'utf8',
  );

  assert.deepEqual(await analyzeTranscriptFile(transcriptPath), {
    assistantTurns: 1,
    toolCalls: 1,
    broadSearchCalls: 1,
    readCalls: 0,
    toolErrorCalls: 0,
    repeatedToolPlanTurns: 0,
    stoppedByBudget: true,
  });
});

test('computeExtendedMetrics reports transcript averages only when transcript metrics exist', () => {
  const successfulResult = {
    directAnswer: 'ok',
    evidence: [],
    targets: [],
    status: {},
    _debug: {
      stats: {
        turns: 1,
        toolCalls: 1,
        stoppedByBudget: false,
      },
    },
  };

  const metrics = computeExtendedMetrics([
    {
      result: successfulResult,
      transcriptMetrics: { broadSearchCalls: 2, repeatedToolPlanTurns: 1 },
    },
    {
      result: successfulResult,
      transcriptMetrics: { broadSearchCalls: 0, repeatedToolPlanTurns: 0 },
    },
  ]);

  assert.equal(metrics.avgBroadSearchCalls, 1);
  assert.equal(metrics.avgRepeatedToolPlanTurns, 0.5);

  const withoutTranscripts = computeExtendedMetrics([
    { result: successfulResult, transcriptMetrics: null },
  ]);
  assert.equal(withoutTranscripts.avgBroadSearchCalls, null);
  assert.equal(withoutTranscripts.avgRepeatedToolPlanTurns, null);
});
