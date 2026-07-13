#!/usr/bin/env node
/**
 * Integration test against real Cerebras API.
 * Usage: CEREBRAS_API_KEY=<key> node scripts/integration-test.mjs
 */

import { ExplorerRuntime } from '../src/explorer/runtime.mjs';
import { createChatClient } from '../src/explorer/providers/index.mjs';
import { validateParentHandoffV3 } from '../src/explorer/schemas.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function log(label, data) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${label}`);
  console.log('═'.repeat(70));
  if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function logSection(title) {
  console.log(`\n\n${'█'.repeat(70)}`);
  console.log(`  TEST: ${title}`);
  console.log('█'.repeat(70));
}

function getDirectAnswer(result) {
  return typeof result?.directAnswer === 'string' ? result.directAnswer : '';
}

export function buildParentHandoffChecks(result, {
  expectedState,
  expectedFailureReason = null,
  expectedFollowUpType = null,
  answerIncludes = null,
} = {}) {
  const handoff = result?.parentHandoff ?? result;
  const answer = getDirectAnswer(handoff);
  const checks = [];
  let schemaValid = true;
  try {
    validateParentHandoffV3(handoff);
  } catch {
    schemaValid = false;
  }

  checks.push(['schema v3 validates', schemaValid]);
  checks.push([`state is ${expectedState}`, handoff?.state === expectedState]);
  checks.push(['parent payload omits operational diagnostics', [
    'status',
    'evidenceQuality',
    'searchCoverage',
    'critic',
    'stats',
    'nextAction',
  ].every(key => !Object.hasOwn(handoff ?? {}, key))]);

  if (expectedState === 'complete') {
    checks.push(['complete has a direct answer', answer.length > 10]);
    checks.push(['complete has evidence', Array.isArray(handoff?.evidence) && handoff.evidence.length > 0]);
  } else if (expectedState === 'incomplete') {
    checks.push(['incomplete has actionable gaps', Array.isArray(handoff?.gaps) && handoff.gaps.length > 0]);
    checks.push(['incomplete has no failure', !Object.hasOwn(handoff ?? {}, 'failure')]);
    checks.push([
      'partial answer has evidence when present',
      !answer || (Array.isArray(handoff?.evidence) && handoff.evidence.length > 0),
    ]);
    if (expectedFollowUpType) {
      checks.push([
        `follow-up type is ${expectedFollowUpType}`,
        handoff?.followUp?.type === expectedFollowUpType,
      ]);
    }
  } else if (expectedState === 'failed') {
    checks.push(['failed has a direct answer', answer.length > 10]);
    checks.push(['failed has a failure reason', typeof handoff?.failure?.reason === 'string']);
    checks.push([
      'failed has no stale success fields',
      ['targets', 'evidence', 'gaps', 'followUp'].every(key => !Object.hasOwn(handoff ?? {}, key)),
    ]);
    if (expectedFailureReason) {
      checks.push([
        `failure reason is ${expectedFailureReason}`,
        handoff?.failure?.reason === expectedFailureReason,
      ]);
    }
  }
  if (answerIncludes instanceof RegExp) {
    checks.push(['directAnswer matches expected topic', answerIncludes.test(answer)]);
  }

  return checks;
}

function formatChecks(checks) {
  return checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} — ${name}`).join('\n');
}

async function testExploreRepo() {
  logSection('1. explore_repo — schema-v3 complete');

  const client = createChatClient();
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });
  const result = await runtime.explore({
    task: 'What version string is declared in package.json?',
    repo_root: REPO_ROOT,
    hints: {
      files: ['package.json'],
    },
  }, {
    onProgress: ({ progress, total, message }) => {
      process.stderr.write(`  [explore_repo] ${message} (${progress}/${total})\n`);
    },
  });

  log('Parent Handoff', result.parentHandoff);
  log('Parent Payload Measurement', result.parentPayloadMeasurement);

  const checks = buildParentHandoffChecks(result, {
    expectedState: 'complete',
    answerIncludes: /version/i,
  });

  log('Checks', formatChecks(checks));
  return checks.every(([, ok]) => ok);
}

async function testExploreRepoIncomplete() {
  logSection('2. schema-v3 incomplete external-state example');

  const result = {
    schemaVersion: 3,
    state: 'incomplete',
    gaps: [{
      question: 'Whether the MCP server currently running at home is this exact checkout',
      reason: 'Repository evidence cannot establish the state of a process on another computer.',
    }],
    followUp: {
      type: 'external_verification',
      requirement: 'Report the commit SHA loaded by the running home MCP server.',
    },
  };

  log('Parent Handoff', result);

  const checks = buildParentHandoffChecks(result, {
    expectedState: 'incomplete',
    expectedFollowUpType: 'external_verification',
  });

  log('Checks', formatChecks(checks));
  return checks.every(([, ok]) => ok);
}

async function testFreeExplore() {
  logSection('3. freeExplore (explore tool) — Markdown report');

  const client = createChatClient();
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });

  const result = await runtime.freeExplore({
    prompt: 'Explain the provider system in this project: how CerebrasChatClient, OpenAICompatChatClient, and FailoverChatClient work together.',
    repo_root: REPO_ROOT,
  }, {
    onProgress: ({ progress, total, message }) => {
      process.stderr.write(`  [freeExplore] ${message} (${progress}/${total})\n`);
    },
  });

  log('Report (first 800 chars)', result.report?.slice(0, 800));
  log('Stats', {
    turns: result.stats?.turns,
    toolCalls: result.stats?.toolCalls,
    filesRead: result.stats?.filesRead,
    elapsedMs: result.stats?.elapsedMs,
  });
  log('Files Read', result.filesRead);
  log('Tools Used', result.toolsUsed);

  const checks = [];
  checks.push(['report is non-empty', !!result.report && result.report.length > 100]);
  checks.push(['report mentions providers', result.report?.toLowerCase().includes('provider') || result.report?.toLowerCase().includes('cerebras')]);
  checks.push(['filesRead is array', Array.isArray(result.filesRead)]);
  checks.push(['toolsUsed is array', Array.isArray(result.toolsUsed)]);

  log('Checks', checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} — ${name}`).join('\n'));
  return checks.every(([, ok]) => ok);
}

async function testFreeExploreAdvanced() {
  logSection('4. freeExplore backend — advanced techniques');

  const client = createChatClient();
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });

  const result = await runtime.freeExplore({
    prompt: 'Produce a comprehensive architecture report of this project. Cover: MCP server structure, explorer runtime loop, prompt system, transcript ops logging, caching, symbol extraction, provider abstraction, and the three report-mode advanced techniques. Include file:line citations.',
    repo_root: REPO_ROOT,
    language: 'ko',
  }, {
    onProgress: ({ progress, total, message }) => {
      process.stderr.write(`  [freeExplore] ${message} (${progress}/${total})\n`);
    },
  });

  log('Report (first 1200 chars)', result.report?.slice(0, 1200));
  log('Report length', `${result.report?.length ?? 0} chars`);
  log('Stats', {
    turns: result.stats?.turns,
    toolCalls: result.stats?.toolCalls,
    filesRead: result.stats?.filesRead,
    elapsedMs: result.stats?.elapsedMs,
    llmCompactions: result.stats?.llmCompactions,
    toolResultsTruncated: result.stats?.toolResultsTruncated,
    outputRecoveries: result.stats?.outputRecoveries,
  });
  log('Files Read', result.filesRead);
  log('Transcript Path', result.transcriptPath ?? '(disabled)');

  const checks = [];
  checks.push(['report is substantial (>500 chars)', (result.report?.length ?? 0) > 500]);
  checks.push(['report in Korean', /[가-힣]/.test(result.report ?? '')]);
  checks.push(['report-mode stats tracked (llmCompactions field)', result.stats?.llmCompactions !== undefined]);
  checks.push(['report-mode stats tracked (toolResultsTruncated field)', result.stats?.toolResultsTruncated !== undefined]);
  checks.push(['report-mode stats tracked (outputRecoveries field)', result.stats?.outputRecoveries !== undefined]);
  checks.push(['turns > 3 (actually explored)', (result.stats?.turns ?? 0) > 3]);
  checks.push(['filesRead >= 3', (result.filesRead?.length ?? 0) >= 3]);

  log('Checks', checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} — ${name}`).join('\n'));
  return checks.every(([, ok]) => ok);
}

async function testFailedCancellation() {
  logSection('5. explore_repo — schema-v3 failed cancellation');

  const client = createChatClient();
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });

  const controller = new AbortController();
  controller.abort();
  const result = await runtime.explore({
    task: 'Find the package version.',
    repo_root: REPO_ROOT,
  }, {
    abortSignal: controller.signal,
  });

  log('Parent Handoff', result.parentHandoff);
  log('Parent Payload Measurement', result.parentPayloadMeasurement);

  const checks = buildParentHandoffChecks(result, {
    expectedState: 'failed',
    expectedFailureReason: 'aborted',
  });

  log('Checks', formatChecks(checks));
  return checks.every(([, ok]) => ok);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.CEREBRAS_API_KEY) {
    console.error('ERROR: Set CEREBRAS_API_KEY environment variable');
    process.exit(1);
  }

  console.log('Cerebras Explorer MCP — Integration Test');
  console.log(`Repo root: ${REPO_ROOT}`);
  console.log('API Key: [present]');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const results = [];

  try {
    results.push(['explore_repo (complete)', await testExploreRepo()]);
  } catch (err) {
    console.error('TEST 1 FAILED:', err.message);
    results.push(['explore_repo (complete)', false]);
  }

  try {
    results.push(['v3 incomplete example', await testExploreRepoIncomplete()]);
  } catch (err) {
    console.error('TEST 2 FAILED:', err.message);
    results.push(['v3 incomplete example', false]);
  }

  try {
    results.push(['freeExplore', await testFreeExplore()]);
  } catch (err) {
    console.error('TEST 3 FAILED:', err.message);
    results.push(['freeExplore', false]);
  }

  try {
    results.push(['freeExplore advanced', await testFreeExploreAdvanced()]);
  } catch (err) {
    console.error('TEST 4 FAILED:', err.message);
    results.push(['freeExplore advanced', false]);
  }

  try {
    results.push(['explore_repo (failed)', await testFailedCancellation()]);
  } catch (err) {
    console.error('TEST 5 FAILED:', err.message);
    results.push(['explore_repo (failed)', false]);
  }

  // Summary
  console.log(`\n\n${'█'.repeat(70)}`);
  console.log('  INTEGRATION TEST SUMMARY');
  console.log('█'.repeat(70));
  for (const [name, ok] of results) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}`);
  }
  const passed = results.filter(([, ok]) => ok).length;
  console.log(`\n  ${passed}/${results.length} tests passed.`);

  if (passed < results.length) {
    process.exit(1);
  }
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
