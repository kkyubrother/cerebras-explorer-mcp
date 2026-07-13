#!/usr/bin/env node
/**
 * Integration test against real Cerebras API.
 * Usage: CEREBRAS_API_KEY=<key> node scripts/integration-test.mjs
 * Recommended: set CEREBRAS_EXPLORER_LOG_PATH to retain redacted transcripts.
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

async function testFailedCancellation() {
  logSection('3. explore_repo — schema-v3 failed cancellation');

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
    results.push(['explore_repo (failed)', await testFailedCancellation()]);
  } catch (err) {
    console.error('TEST 3 FAILED:', err.message);
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
