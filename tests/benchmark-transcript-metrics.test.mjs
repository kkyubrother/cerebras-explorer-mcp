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

function syntheticCase({ ops, searchCoverage, transcriptMetrics = null, effectMetrics = null, citation = null } = {}) {
  return {
    result: {
      directAnswer: 'ok',
      evidence: [],
      targets: [],
      status: {},
      searchCoverage: searchCoverage ?? { filesRead: 1, grepCalls: 0, listDirCalls: 0, symbolCalls: 0, stoppedByBudget: false },
    },
    ops: ops ?? null,
    transcriptMetrics,
    effectMetrics,
    citation,
  };
}

test('computeExtendedMetrics reads ops stats and reports n/a (null) when ops are absent (spec 025)', () => {
  const withOps = computeExtendedMetrics([
    syntheticCase({ ops: { stats: { turns: 4, toolCalls: 6, totalTokens: 1200 } } }),
    syntheticCase({ ops: { stats: { turns: 2, toolCalls: 0, totalTokens: 800 } } }),
  ]);
  assert.equal(withOps.avgToolTurns, 3);
  assert.equal(withOps.avgInternalTokens, 1000);
  assert.equal(withOps.noToolExitRate, 0.5, 'ops.toolCalls === 0 marks a no-tool exit');
  assert.equal('deepBudgetAvgTotalTokens' in withOps, false, 'dead spec-011 metric is deleted');

  const withoutOps = computeExtendedMetrics([syntheticCase()]);
  assert.equal(withoutOps.avgToolTurns, null, 'no fabricated 0 without a source');
  assert.equal(withoutOps.avgInternalTokens, null);
  assert.equal(withoutOps.noToolExitRate, 0, 'searchCoverage fallback sees 1 file read');
});

test('computeExtendedMetrics sources budget exhaustion from searchCoverage (spec 025)', () => {
  const metrics = computeExtendedMetrics([
    syntheticCase({ searchCoverage: { filesRead: 2, grepCalls: 1, listDirCalls: 0, symbolCalls: 0, stoppedByBudget: true } }),
    syntheticCase(),
  ]);
  assert.equal(metrics.budgetExhaustionRate, 0.5);
});

test('computeExtendedMetrics aggregates effect metrics and pools citation checks (spec 025)', () => {
  const metrics = computeExtendedMetrics([
    syntheticCase({
      effectMetrics: { responsePayloadTokens: 100, citedSourceTokens: 1000, citedFileCount: 2, contextSavingsRatio: 10 },
      citation: { checks: [{ status: 'match' }, { status: 'mismatch' }, { status: 'redacted' }] },
    }),
    syntheticCase({
      effectMetrics: { responsePayloadTokens: 300, citedSourceTokens: 600, citedFileCount: 1, contextSavingsRatio: 2 },
      citation: { checks: [{ status: 'weak_match' }] },
    }),
  ]);
  assert.equal(metrics.avgResponsePayloadTokens, 200);
  assert.equal(metrics.avgCitedSourceTokens, 800);
  assert.equal(metrics.avgContextSavingsRatio, 6);
  assert.equal(metrics.citationAccuracy, 0.667, 'pooled across all non-neutral checks, not a mean of per-case ratios');
  assert.equal(metrics.weakCitationChecks, 1);
});

test('computeExtendedMetrics reports transcript averages only when transcript metrics exist', () => {
  const metrics = computeExtendedMetrics([
    syntheticCase({ transcriptMetrics: { broadSearchCalls: 2, repeatedToolPlanTurns: 1 } }),
    syntheticCase({ transcriptMetrics: { broadSearchCalls: 0, repeatedToolPlanTurns: 0 } }),
  ]);
  assert.equal(metrics.avgBroadSearchCalls, 1);
  assert.equal(metrics.avgRepeatedToolPlanTurns, 0.5);

  const withoutTranscripts = computeExtendedMetrics([syntheticCase()]);
  assert.equal(withoutTranscripts.avgBroadSearchCalls, null);
  assert.equal(withoutTranscripts.avgRepeatedToolPlanTurns, null);
});

test('computeExtendedMetrics handles mixed ops populations without fabricating values (spec 025)', () => {
  const metrics = computeExtendedMetrics([
    syntheticCase({ ops: { stats: { turns: 4, toolCalls: 6, totalTokens: 1200 } } }),
    syntheticCase(),
    syntheticCase({ ops: { stats: {} } }),
  ]);
  assert.equal(metrics.avgToolTurns, 4, 'empty ops.stats objects contribute nothing instead of fabricated zeros');
  assert.equal(metrics.avgInternalTokens, 1200);
  assert.equal(metrics.noToolExitRate, 0, 'fallback cases with real searchCoverage activity are not no-tool exits');
});

test('computeExtendedMetrics does not fabricate a no-tool exit from an absent searchCoverage (spec 025)', () => {
  const bare = syntheticCase();
  delete bare.result.searchCoverage;
  const metrics = computeExtendedMetrics([bare]);
  assert.equal(metrics.noToolExitRate, 0);
  assert.equal(metrics.evidenceSnippetRate, null, 'empty evidence denominator degrades to null, not 0');
});

test('computeExtendedMetrics counts an all-zero searchCoverage as a no-tool exit via the fallback (spec 025)', () => {
  const metrics = computeExtendedMetrics([
    syntheticCase({ searchCoverage: { filesRead: 0, grepCalls: 0, listDirCalls: 0, symbolCalls: 0, stoppedByBudget: false } }),
  ]);
  assert.equal(metrics.noToolExitRate, 1);
});
