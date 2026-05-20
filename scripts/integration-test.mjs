#!/usr/bin/env node
/**
 * Integration test against real Cerebras API.
 * Usage: CEREBRAS_API_KEY=<key> node scripts/integration-test.mjs
 */

import { ExplorerRuntime } from '../src/explorer/runtime.mjs';
import { createChatClient } from '../src/explorer/providers/index.mjs';
import { SessionStore } from '../src/explorer/session.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];

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

function getStatusConfidence(result) {
  return result?.status?.confidence;
}

function getSessionId(result) {
  return result?.session?.id ?? result?.sessionId ?? result?.stats?.sessionId ?? '';
}

function getSessionSummary(result) {
  const sessionId = getSessionId(result);
  if (!sessionId) return null;
  return {
    id: sessionId,
    status: result?.session?.status ?? result?.stats?.sessionStatus,
    remainingCalls: result?.session?.remainingCalls ?? result?.stats?.remainingCalls,
  };
}

export function buildExploreRepoChecks(result, {
  answerLabel = 'directAnswer',
  minAnswerLength = 10,
  minFilesRead = 0,
  answerIncludes = null,
} = {}) {
  const answer = getDirectAnswer(result);
  const confidence = getStatusConfidence(result);
  const sessionId = getSessionId(result);
  const checks = [];

  checks.push([`${answerLabel} is non-empty`, answer.length > minAnswerLength]);
  checks.push(['status.confidence is valid', CONFIDENCE_LEVELS.includes(confidence)]);
  checks.push(['evidence array exists', Array.isArray(result?.evidence)]);
  checks.push(['targets array exists', Array.isArray(result?.targets)]);
  checks.push([
    'targets have path strings',
    Array.isArray(result?.targets) && result.targets.every(item => typeof item?.path === 'string' && item.path.trim()),
  ]);
  checks.push([
    'evidenceQuality.level is valid',
    CONFIDENCE_LEVELS.includes(result?.evidenceQuality?.level),
  ]);
  checks.push([
    'searchCoverage summary exists',
    typeof result?.searchCoverage?.summary === 'string' && result.searchCoverage.summary.length > 0,
  ]);
  checks.push(['failure is null', result?.failure === null]);
  checks.push(['session id exists', typeof sessionId === 'string' && sessionId.startsWith('sess_')]);
  checks.push(['stats.turns > 0', result?.stats?.turns > 0]);
  checks.push(['stats.elapsedMs > 0', result?.stats?.elapsedMs > 0]);
  if (minFilesRead > 0) {
    checks.push([`stats.filesRead >= ${minFilesRead}`, (result?.stats?.filesRead ?? 0) >= minFilesRead]);
  }
  if (answerIncludes instanceof RegExp) {
    checks.push([`${answerLabel} matches expected topic`, answerIncludes.test(answer)]);
  }

  return checks;
}

function formatChecks(checks) {
  return checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} — ${name}`).join('\n');
}

async function testExploreRepo() {
  logSection('1. explore_repo (quick) — 기본 동작, compact contract');

  const client = createChatClient({ budget: 'quick' });
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });
  const sessionStore = new SessionStore();

  const result = await runtime.explore({
    task: 'How does the session management work in this project? Find the SessionStore class and explain its key methods.',
    repo_root: REPO_ROOT,
    budget: 'quick',
    hints: { symbols: ['SessionStore'], strategy: 'symbol-first' },
  }, {
    onProgress: ({ progress, total, message }) => {
      process.stderr.write(`  [explore_repo] ${message} (${progress}/${total})\n`);
    },
    sessionStore,
  });

  log('Direct Answer', getDirectAnswer(result));
  log('Status Confidence', `${getStatusConfidence(result)} (evidenceQuality: ${result.evidenceQuality?.level})`);
  log('Evidence Quality', result.evidenceQuality);
  log('Search Coverage', result.searchCoverage);
  log('Failure', result.failure);
  log('Session', getSessionSummary(result));
  log('Evidence count', `${result.evidence?.length ?? 0} items`);
  if (result.evidence?.length > 0) {
    log('Evidence sample', result.evidence.slice(0, 3));
  }
  log('Targets', result.targets?.slice(0, 5) ?? []);
  log('Stats', {
    model: result.stats?.model,
    turns: result.stats?.turns,
    toolCalls: result.stats?.toolCalls,
    filesRead: result.stats?.filesRead,
    elapsedMs: result.stats?.elapsedMs,
    cacheHits: result.stats?.cacheHits,
    cacheMisses: result.stats?.cacheMisses,
  });

  const checks = buildExploreRepoChecks(result, {
    answerLabel: 'directAnswer',
    minFilesRead: 1,
    answerIncludes: /sessionstore|session/i,
  });

  log('Checks', formatChecks(checks));
  return checks.every(([, ok]) => ok);
}

async function testExploreRepoNormal() {
  logSection('2. explore_repo (normal) — deeper analysis, confidence scoring');

  const client = createChatClient({ budget: 'normal' });
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });
  const sessionStore = new SessionStore();

  const result = await runtime.explore({
    task: 'Trace the full execution flow when explore_v2 tool is called from the MCP server. Start from server.mjs request handler, through runtime.mjs freeExploreV2(), and explain each advanced technique (LLM compaction, tool result budgeting, max output recovery).',
    repo_root: REPO_ROOT,
    budget: 'normal',
    hints: { symbols: ['freeExploreV2', 'callFreeExploreV2Tool'], files: ['src/mcp/server.mjs', 'src/explorer/runtime.mjs'] },
  }, {
    onProgress: ({ progress, total, message }) => {
      process.stderr.write(`  [explore_repo normal] ${message} (${progress}/${total})\n`);
    },
    sessionStore,
  });

  log('Direct Answer (first 500 chars)', getDirectAnswer(result).slice(0, 500));
  log('Status Confidence', `${getStatusConfidence(result)} (evidenceQuality: ${result.evidenceQuality?.level})`);
  log('Evidence Quality', result.evidenceQuality);
  log('Search Coverage', result.searchCoverage);
  log('Failure', result.failure);
  log('Session', getSessionSummary(result));
  log('Evidence count', `${result.evidence?.length ?? 0} items`);
  log('Stats', {
    turns: result.stats?.turns,
    toolCalls: result.stats?.toolCalls,
    filesRead: result.stats?.filesRead,
    elapsedMs: result.stats?.elapsedMs,
    symbolCalls: result.stats?.symbolCalls,
    grepCalls: result.stats?.grepCalls,
  });

  const checks = buildExploreRepoChecks(result, {
    answerLabel: 'directAnswer',
    minFilesRead: 3,
    answerIncludes: /v2|explore/i,
  });

  log('Checks', formatChecks(checks));
  return checks.every(([, ok]) => ok);
}

async function testFreeExplore() {
  logSection('3. freeExplore (explore tool) — Markdown report');

  const client = createChatClient({ budget: 'quick' });
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });

  const result = await runtime.freeExplore({
    prompt: 'Explain the provider system in this project: how CerebrasChatClient, OpenAICompatChatClient, and FailoverChatClient work together.',
    repo_root: REPO_ROOT,
    thoroughness: 'quick',
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

async function testFreeExploreV2() {
  logSection('4. freeExploreV2 (explore_v2 tool) — advanced techniques');

  const client = createChatClient({ budget: 'normal' });
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });

  const result = await runtime.freeExploreV2({
    prompt: 'Produce a comprehensive architecture report of this project. Cover: MCP server structure, explorer runtime loop, prompt system, session management, caching, symbol extraction, provider abstraction, and the three V2 advanced techniques. Include file:line citations.',
    repo_root: REPO_ROOT,
    thoroughness: 'normal',
    language: 'ko',
  }, {
    onProgress: ({ progress, total, message }) => {
      process.stderr.write(`  [freeExploreV2] ${message} (${progress}/${total})\n`);
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
  checks.push(['V2 stats tracked (llmCompactions field)', result.stats?.llmCompactions !== undefined]);
  checks.push(['V2 stats tracked (toolResultsTruncated field)', result.stats?.toolResultsTruncated !== undefined]);
  checks.push(['V2 stats tracked (outputRecoveries field)', result.stats?.outputRecoveries !== undefined]);
  checks.push(['turns > 3 (actually explored)', (result.stats?.turns ?? 0) > 3]);
  checks.push(['filesRead >= 3', (result.filesRead?.length ?? 0) >= 3]);

  log('Checks', checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} — ${name}`).join('\n'));
  return checks.every(([, ok]) => ok);
}

async function testToolValidation() {
  logSection('5. Tool name validation — hallucinated tool feedback');

  const client = createChatClient({ budget: 'quick' });
  const runtime = new ExplorerRuntime({ chatClient: client, logger: console.error });
  const sessionStore = new SessionStore();

  // This test verifies that the system handles tool validation properly.
  // We can't force the model to hallucinate, but we can verify the runtime starts and completes.
  const result = await runtime.explore({
    task: 'What is the main entry point file of this project? Just find index.mjs and describe its contents.',
    repo_root: REPO_ROOT,
    budget: 'quick',
    hints: { files: ['src/index.mjs'] },
  }, {
    onProgress: ({ progress, total, message }) => {
      process.stderr.write(`  [tool-validation] ${message} (${progress}/${total})\n`);
    },
    sessionStore,
  });

  log('Direct Answer (first 300 chars)', getDirectAnswer(result).slice(0, 300));
  log('Status Confidence', getStatusConfidence(result));
  log('Evidence Quality', result.evidenceQuality);
  log('Search Coverage', result.searchCoverage);
  log('Failure', result.failure);
  log('Session', getSessionSummary(result));
  log('Stats', { turns: result.stats?.turns, toolCalls: result.stats?.toolCalls });

  const checks = buildExploreRepoChecks(result, {
    answerLabel: 'directAnswer',
    minFilesRead: 1,
    answerIncludes: /index|entry/i,
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
    results.push(['explore_repo (quick)', await testExploreRepo()]);
  } catch (err) {
    console.error('TEST 1 FAILED:', err.message);
    results.push(['explore_repo (quick)', false]);
  }

  try {
    results.push(['explore_repo (normal)', await testExploreRepoNormal()]);
  } catch (err) {
    console.error('TEST 2 FAILED:', err.message);
    results.push(['explore_repo (normal)', false]);
  }

  try {
    results.push(['freeExplore', await testFreeExplore()]);
  } catch (err) {
    console.error('TEST 3 FAILED:', err.message);
    results.push(['freeExplore', false]);
  }

  try {
    results.push(['freeExploreV2', await testFreeExploreV2()]);
  } catch (err) {
    console.error('TEST 4 FAILED:', err.message);
    results.push(['freeExploreV2', false]);
  }

  try {
    results.push(['tool validation', await testToolValidation()]);
  } catch (err) {
    console.error('TEST 5 FAILED:', err.message);
    results.push(['tool validation', false]);
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
