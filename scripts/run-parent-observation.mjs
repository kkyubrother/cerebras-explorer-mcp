#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { buildOracleParentHandoff } from '../src/benchmark/oracle-parent-handoff.mjs';
import { isSecretPath } from '../src/explorer/security.mjs';
import { dirtyTreeSha256, fixtureTreeSha256 } from './run-trust-suite.mjs';

export { buildOracleParentHandoff } from '../src/benchmark/oracle-parent-handoff.mjs';

const execFileAsync = promisify(execFile);
const CHECKOUT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TRACE_BYTES = 64 * 1024 * 1024;
const PARENT_PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

export const PARENT_OBSERVATION_POLICY = Object.freeze({
  id: 'parent-native-research-v3',
  eligibleStates: Object.freeze(['complete', 'verify_targets']),
  passThreshold: 0.9,
  denominator: 'fixed_nonfault_complete_or_verify_targets',
  broadNativeResearch: 'uncited_native_repository_research',
  allowedVerification: 'cited_target_or_allowed_follow_up',
  handoffSource: 'independent_oracle_schema_v3',
  commandEvidence: 'completed_or_failed_command_events',
});

export const TRUST_PARENT_OBSERVATION_CASE_IDS = Object.freeze([
  'obs-deny-list-count-range',
  'obs-large-route-ui-api-mismatch',
  'obs-route-admin-divergence',
  'obs-repeat-tests-environment',
  'obs-aws-inventory-classification',
  'fx-incomplete-multipart',
  'fx-scope-limited-absence',
  'audit-untraceable-invention',
  'audit-duplicate-merge',
  'audit-overbroad-decomposition',
  'audit-omitted-request-part',
  'fx-supported-refutation',
  'fx-scoped-zero-match',
  'fx-route-policy-divergence',
]);

const ELIGIBLE_STATES = new Set(PARENT_OBSERVATION_POLICY.eligibleStates);
const SEARCH_OPERATIONS = new Set(['grep', 'glob', 'walk']);
const PASSIVE_ITEM_TYPES = new Set(['agent_message', 'reasoning']);
const SAFE_CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const OBSERVATION_KEYS = new Set(['repoId', 'citedTargets', 'allowedFollowUp', 'actions']);
const TARGET_KEYS = new Set(['path', 'startLine', 'endLine']);
const FOLLOW_UP_KEYS = new Set(['tool', 'scope']);
const ACTION_KEYS = Object.freeze({
  read: new Set(['type', 'path', 'startLine', 'endLine']),
  search: new Set(['type', 'operation', 'query', 'targets']),
  follow_up: new Set(['type', 'tool', 'scope', 'returnedTargets']),
});
const COMMAND_BOUNDARY = '[\\s|;&\'"`()=]';
const READ_COMMAND = new RegExp(
  `(?:^|${COMMAND_BOUNDARY})(get-content|cat|sed|type|more|head|tail)(?=${COMMAND_BOUNDARY}|$)`,
  'iu',
);
const SEARCH_COMMAND = new RegExp(
  `(?:^|${COMMAND_BOUNDARY})(rg|grep|select-string|findstr|find|get-childitem|gci|ls|dir)(?=${COMMAND_BOUNDARY}|$)`,
  'iu',
);

function hasOnlyKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.has(key));
}

function hasWindowsAbsolutePrefix(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

export function normalizePortablePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (path.isAbsolute(raw) || hasWindowsAbsolutePrefix(raw)) return null;
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized.includes('\0')) {
    return null;
  }
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  if (isSecretPath(normalized, { env: {} }).matched) return null;
  return normalized;
}

function normalizeRange(value) {
  const hasStart = Object.hasOwn(value, 'startLine');
  const hasEnd = Object.hasOwn(value, 'endLine');
  if (hasStart !== hasEnd) return null;
  if (!hasStart) return { startLine: null, endLine: null };
  if (!Number.isInteger(value.startLine) || !Number.isInteger(value.endLine) ||
      value.startLine < 1 || value.endLine < value.startLine) return null;
  return { startLine: value.startLine, endLine: value.endLine };
}

function normalizeTarget(value) {
  if (!hasOnlyKeys(value, TARGET_KEYS)) return null;
  const normalizedPath = normalizePortablePath(value.path);
  const range = normalizeRange(value);
  if (!normalizedPath || !range) return null;
  return { path: normalizedPath, ...range };
}

function normalizeTargetList(value) {
  if (!Array.isArray(value)) return null;
  const targets = value.map(normalizeTarget);
  return targets.some(item => item === null) ? null : targets;
}

function normalizeScope(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const normalized = value.map(normalizePortablePath);
  if (normalized.some(item => item === null)) return null;
  return [...new Set(normalized)].sort();
}

function normalizeFollowUp(value) {
  if (value === undefined) return null;
  if (!hasOnlyKeys(value, FOLLOW_UP_KEYS) || typeof value.tool !== 'string' || !value.tool.trim()) {
    return undefined;
  }
  const scope = normalizeScope(value.scope);
  if (scope === null) return undefined;
  return { tool: value.tool.trim(), scope };
}

function sameFollowUp(actual, allowed) {
  return Boolean(allowed) && actual.tool === allowed.tool &&
    actual.scope.length === allowed.scope.length &&
    actual.scope.every((item, index) => item === allowed.scope[index]);
}

function rangeWithin(requested, citation) {
  if (citation.startLine === null) return true;
  if (requested.startLine === null) return false;
  return requested.startLine >= citation.startLine && requested.endLine <= citation.endLine;
}

function isWithinNormalizedCitedTarget(requested, citations) {
  return citations.some(citation => citation.path === requested.path && rangeWithin(requested, citation));
}

export function isWithinCitedTarget(requestedTarget, citedTargets) {
  const requested = normalizeTarget(requestedTarget);
  const citations = normalizeTargetList(citedTargets);
  return Boolean(requested && citations && isWithinNormalizedCitedTarget(requested, citations));
}

function observationViolation(code, actionIndex = null) {
  return actionIndex === null ? { code } : { code, actionIndex };
}

function invalidTrace(code) {
  return {
    valid: false,
    noBroadNativeResearch: false,
    broadActionCount: 0,
    allowance: { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 },
    violations: [observationViolation(code)],
    referencedPaths: [],
  };
}

export function classifyParentActionTrace(observation) {
  if (!hasOnlyKeys(observation, OBSERVATION_KEYS)) return invalidTrace('invalid_observation_shape');
  if (typeof observation.repoId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(observation.repoId)) {
    return invalidTrace('invalid_repo_id');
  }
  const initialTargets = normalizeTargetList(observation.citedTargets);
  const allowedFollowUp = normalizeFollowUp(observation.allowedFollowUp);
  if (!initialTargets || allowedFollowUp === undefined || !Array.isArray(observation.actions)) {
    return invalidTrace('invalid_observation_shape');
  }

  const citedTargets = [...initialTargets];
  const referencedPaths = initialTargets.map(item => item.path);
  const violations = [];
  const allowance = { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 };
  let broadActionCount = 0;
  let followedUp = false;

  for (let actionIndex = 0; actionIndex < observation.actions.length; actionIndex += 1) {
    const action = observation.actions[actionIndex];
    const allowedKeys = ACTION_KEYS[action?.type];
    if (!allowedKeys || !hasOnlyKeys(action, allowedKeys)) {
      violations.push(observationViolation('invalid_action_shape', actionIndex));
      continue;
    }
    if (action.type === 'read') {
      const target = normalizeTarget({
        path: action.path,
        ...(Object.hasOwn(action, 'startLine') ? { startLine: action.startLine } : {}),
        ...(Object.hasOwn(action, 'endLine') ? { endLine: action.endLine } : {}),
      });
      if (!target) {
        violations.push(observationViolation('invalid_read_target', actionIndex));
      } else {
        referencedPaths.push(target.path);
        if (isWithinNormalizedCitedTarget(target, citedTargets) ||
            citedTargets.some(citation => citation.path === target.path)) {
          allowance.citedTargetReads += 1;
        }
        else {
          broadActionCount += 1;
          violations.push(observationViolation(
            allowedFollowUp && !followedUp ? 'uncited_read_before_allowed_follow_up' : 'uncited_read',
            actionIndex,
          ));
        }
      }
      continue;
    }
    if (action.type === 'search') {
      const targets = normalizeTargetList(action.targets);
      if (!SEARCH_OPERATIONS.has(action.operation) ||
          typeof action.query !== 'string' || !action.query.trim() || !targets) {
        violations.push(observationViolation('invalid_search_action', actionIndex));
      } else {
        referencedPaths.push(...targets.map(item => item.path));
        if (targets.length === 0) {
          broadActionCount += 1;
          violations.push(observationViolation('repository_wide_search', actionIndex));
        } else if (targets.every(target => isWithinNormalizedCitedTarget(target, citedTargets))) {
          allowance.citedPathSearches += 1;
        } else {
          broadActionCount += 1;
          violations.push(observationViolation(
            allowedFollowUp && !followedUp ? 'uncited_search_before_allowed_follow_up' : 'uncited_search',
            actionIndex,
          ));
        }
      }
      continue;
    }
    const scope = normalizeScope(action.scope);
    const returnedTargets = normalizeTargetList(action.returnedTargets ?? []);
    if (typeof action.tool !== 'string' || !action.tool.trim() || scope === null || !returnedTargets) {
      violations.push(observationViolation('invalid_follow_up_action', actionIndex));
      continue;
    }
    const normalizedAction = { tool: action.tool.trim(), scope };
    if (!sameFollowUp(normalizedAction, allowedFollowUp) || followedUp) {
      violations.push(observationViolation('unapproved_follow_up', actionIndex));
      continue;
    }
    followedUp = true;
    allowance.allowedFollowUps += 1;
    citedTargets.push(...returnedTargets);
    referencedPaths.push(...returnedTargets.map(item => item.path));
  }

  const valid = !violations.some(item => item.code.startsWith('invalid_') ||
    item.code === 'unapproved_follow_up');
  return {
    valid,
    noBroadNativeResearch: valid && broadActionCount === 0,
    broadActionCount,
    allowance,
    violations,
    referencedPaths: [...new Set(referencedPaths)],
  };
}

export function buildParentPrompt(caseDefinition, handoff) {
  const task = caseDefinition?.invocation?.args?.task ?? caseDefinition?.invocation?.args?.query ??
    caseDefinition?.invocation?.args?.claim ?? caseDefinition?.invocation?.args?.pathQuery ??
    caseDefinition?.invocation?.args?.change ?? caseDefinition?.invocation?.args?.symbol;
  if (typeof task !== 'string' || !task.trim()) throw new Error('Parent-observation case has no user task.');
  return [
    'Use the repository-exploration result below to answer the user task.',
    'Handoff contract: complete means answer from directAnswer; verify_targets means inspect only targets; ' +
      'incomplete means preserve gaps and use at most its followUp; failed means retry only when failure.retry exists.',
    '',
    'User task:',
    task,
    '',
    'Repository explorer result (schema v3):',
    JSON.stringify(handoff),
  ].join('\n');
}

function citedTargetsFromHandoff(handoff) {
  return handoff.evidence.filter(item => item.kind === 'source').map(item => ({
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
  }));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandMentionsPath(command, targetPath) {
  const normalized = command.replaceAll('\\', '/');
  const needle = escapeRegex(targetPath.replaceAll('\\', '/'));
  const boundary = `[\\s'"\`,;|&(){}\\[\\]=]`;
  return new RegExp(
    `(?:^|${boundary})(?:\\./)?${needle}(?=$|${boundary})`,
    'iu',
  ).test(normalized);
}

function commandTokens(command) {
  const raw = command.match(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^\s|;&]+/gu) ?? [];
  return raw.map(value => {
    const quoted = (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    return (quoted ? value.slice(1, -1) : value).replaceAll('\\', '/').trim();
  }).filter(Boolean);
}

function hasBroadRootOperand(command) {
  const roots = new Set(['.', './', '*', '**', '$pwd', '${pwd}']);
  return commandTokens(command).some(token => roots.has(token.toLocaleLowerCase('en')));
}

function explicitReadRange(command) {
  const normalized = command.replaceAll('\\', '/');
  const sed = normalized.match(/(?:^|\s)sed\b[\s\S]*?['"]?(\d+)\s*,\s*(\d+)p['"]?/iu);
  if (sed) {
    const startLine = Number(sed[1]);
    const endLine = Number(sed[2]);
    if (startLine >= 1 && endLine >= startLine) return { startLine, endLine };
  }

  const slice = normalized.match(/\[\s*(\d+)\s*\.\.\s*(\d+)\s*\]/u);
  if (slice) {
    const startIndex = Number(slice[1]);
    const endIndex = Number(slice[2]);
    if (startIndex >= 0 && endIndex >= startIndex) {
      return { startLine: startIndex + 1, endLine: endIndex + 1 };
    }
  }

  const skip = normalized.match(/(?:^|\s)-Skip\s+(\d+)(?=\s|$)/iu);
  const first = normalized.match(/(?:^|\s)-First\s+(\d+)(?=\s|$)/iu);
  if (first) {
    const skipped = skip ? Number(skip[1]) : 0;
    const count = Number(first[1]);
    if (skipped >= 0 && count >= 1) {
      return { startLine: skipped + 1, endLine: skipped + count };
    }
  }
  return null;
}

function actionsFromCommand(command, citedTargets) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const mentioned = citedTargets.filter(target => commandMentionsPath(command, target.path));
  if (SEARCH_COMMAND.test(command)) {
    return [{
      type: 'search',
      operation: 'grep',
      query: 'actual_parent_command',
      targets: hasBroadRootOperand(command) ? [] : mentioned,
    }];
  }
  if (READ_COMMAND.test(command)) {
    if (mentioned.length === 0) return [];
    const range = explicitReadRange(command);
    return mentioned.map(target => ({
      type: 'read',
      path: target.path,
      ...(range ?? {}),
    }));
  }
  return null;
}

function appendTraceFailures(classification, failures, unclassifiedCount) {
  if (failures.length === 0 && unclassifiedCount === 0) return classification;
  const broadActionCount = classification.broadActionCount + unclassifiedCount;
  return {
    ...classification,
    valid: false,
    noBroadNativeResearch: false,
    broadActionCount,
    violations: [
      ...classification.violations,
      ...failures.map(code => observationViolation(code)),
      ...Array.from({ length: unclassifiedCount }, () => observationViolation('unclassified_command')),
    ],
  };
}

function appendTraceWarnings(classification, warnings) {
  if (warnings.length === 0) return classification;
  return {
    ...classification,
    violations: [
      ...classification.violations,
      ...warnings.map(code => observationViolation(code)),
    ],
  };
}

export function parseCodexParentTrace(rawJsonl, { repoId, handoff, processExitCode = 0 }) {
  if (typeof rawJsonl !== 'string') return invalidTrace('invalid_jsonl_trace');
  const citedTargets = citedTargetsFromHandoff(handoff);
  const actions = [];
  const startedCommands = new Set();
  const unknownActionItems = new Set();
  const failures = [];
  const warnings = [];
  let unclassifiedCount = 0;
  let unknownActionCount = 0;
  let turnCompleted = false;
  let finalAgentMessage = false;
  let lastCompletedItemType = null;
  const lines = rawJsonl.split(/\r?\n/u).filter(Boolean);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      failures.push('invalid_jsonl_trace');
      continue;
    }
    const item = event?.item;
    const isItemEvent = /^item\.(?:started|completed|failed)$/u.test(event?.type ?? '');
    if (turnCompleted) {
      if (event?.type === 'turn.completed') failures.push('duplicate_turn_completion');
      else failures.push('event_after_turn_completion');
      continue;
    }
    if (isItemEvent && (typeof item?.type !== 'string' || !item.type ||
        (item.type !== 'command_execution' && !PASSIVE_ITEM_TYPES.has(item.type)))) {
      const identity = typeof item.id === 'string' && item.id
        ? item.id
        : `${lineIndex}:${item?.type ?? 'missing'}`;
      if (!unknownActionItems.has(identity)) {
        unknownActionItems.add(identity);
        unknownActionCount += 1;
        failures.push('unknown_action_type');
      }
      continue;
    }
    if (event.type === 'item.started' && item?.type === 'command_execution') {
      if (typeof item.id !== 'string' || !item.id) failures.push('invalid_command_event');
      else startedCommands.add(item.id);
      continue;
    }
    if ((event.type === 'item.completed' || event.type === 'item.failed') &&
        item?.type === 'command_execution') {
      if (typeof item.id !== 'string' || !startedCommands.delete(item.id)) {
        failures.push('command_completion_without_start');
      }
      const parsed = actionsFromCommand(item.command, citedTargets);
      if (parsed === null || parsed.length === 0) unclassifiedCount += 1;
      else actions.push(...parsed);
      if (event.type === 'item.failed' || item.status !== 'completed' || item.exit_code !== 0) {
        warnings.push('command_execution_failed');
      }
      lastCompletedItemType = 'command_execution';
      continue;
    }
    if (event.type === 'item.completed' && item?.type === 'agent_message') {
      if (typeof item.text !== 'string' || !item.text.trim()) {
        failures.push('invalid_agent_message');
      } else {
        finalAgentMessage = true;
        lastCompletedItemType = 'agent_message';
      }
      continue;
    }
    if (event.type === 'item.failed' && PASSIVE_ITEM_TYPES.has(item?.type)) {
      failures.push('parent_item_failed');
      continue;
    }
    if (event.type === 'item.completed' && item?.type === 'reasoning') {
      lastCompletedItemType = 'reasoning';
      continue;
    }
    if (event.type === 'turn.completed') {
      if (turnCompleted) failures.push('duplicate_turn_completion');
      turnCompleted = true;
    } else if (event.type === 'turn.failed') failures.push('parent_turn_failed');
    else if (event.type === 'error') failures.push('parent_error_event');
  }
  if (startedCommands.size > 0) failures.push('command_event_incomplete');
  if (!turnCompleted) failures.push('parent_turn_incomplete');
  if (!finalAgentMessage || lastCompletedItemType !== 'agent_message') {
    failures.push('final_agent_message_missing');
  }
  if (processExitCode !== 0) failures.push('parent_process_failed');
  const classification = classifyParentActionTrace({ repoId, citedTargets, actions });
  return appendTraceWarnings(appendTraceFailures(
    classification,
    [...new Set(failures)],
    unclassifiedCount + unknownActionCount,
  ), [...new Set(warnings)]);
}

export function codexParentArgs(repoRoot) {
  return [
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
    '--skip-git-repo-check', '-C', repoRoot, '-',
  ];
}

async function resolveCodexInvocation() {
  if (process.platform !== 'win32') return { command: 'codex', prefixArgs: [] };
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const entry = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    try {
      if ((await fs.stat(entry)).isFile()) return { command: process.execPath, prefixArgs: [entry] };
    } catch {
      // Continue through PATH. The fallback remains shell-free.
    }
  }
  return { command: 'codex.cmd', prefixArgs: [] };
}

export async function invokeCodexParent({ repoRoot, prompt }) {
  const invocation = await resolveCodexInvocation();
  return new Promise(resolve => {
    const child = spawn(invocation.command, [...invocation.prefixArgs, ...codexParentArgs(repoRoot)], {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let settled = false;
    let overflowed = false;
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), PARENT_PROCESS_TIMEOUT_MS);
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_TRACE_BYTES) {
        overflowed = true;
        child.kill();
      } else stdoutChunks.push(chunk);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ rawJsonl: Buffer.concat(stdoutChunks).toString('utf8'), exitCode: 1 });
    });
    child.on('close', exitCode => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        rawJsonl: Buffer.concat(stdoutChunks).toString('utf8'),
        exitCode: overflowed ? 1 : (exitCode ?? 1),
      });
    });
    child.stdin.end(prompt, 'utf8');
  });
}

export function isEligibleParentObservationCase(caseDefinition) {
  if (!caseDefinition || typeof caseDefinition !== 'object') return false;
  if (caseDefinition.kind === 'fault' || caseDefinition.fault === true || caseDefinition.oracle?.fault === true) {
    return false;
  }
  return ELIGIBLE_STATES.has(caseDefinition.oracle?.expectedState);
}

export function summarizeParentObservations(results) {
  const denominatorCaseCount = results.length;
  const noBroadNativeResearchCaseCount = results.filter(item => item.noBroad).length;
  const broadNativeResearchCaseCount = results.filter(item => item.broadActionCount > 0).length;
  const observedCaseCount = results.filter(item => item.observed).length;
  const invalidObservationCaseCount = results.filter(item => !item.observed).length;
  const noBroadNativeResearchRate = denominatorCaseCount === 0 ? null :
    Math.round((noBroadNativeResearchCaseCount / denominatorCaseCount) * 1_000_000) / 1_000_000;
  const sumAllowance = key => results.reduce((sum, item) => sum + item.allowance[key], 0);
  return {
    denominatorCaseCount,
    observedCaseCount,
    invalidObservationCaseCount,
    noBroadNativeResearchCaseCount,
    broadNativeResearchCaseCount,
    noBroadNativeResearchRate,
    passThreshold: PARENT_OBSERVATION_POLICY.passThreshold,
    passed: noBroadNativeResearchRate !== null &&
      noBroadNativeResearchRate >= PARENT_OBSERVATION_POLICY.passThreshold,
    allowance: {
      citedTargetReads: sumAllowance('citedTargetReads'),
      citedPathSearches: sumAllowance('citedPathSearches'),
      allowedFollowUps: sumAllowance('allowedFollowUps'),
    },
  };
}

function parseArgs(argv) {
  const options = { suite: null, repoMap: null, output: null, traceDir: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--suite') options.suite = argv[++index];
    else if (arg === '--repo-map') options.repoMap = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--trace-dir') options.traceDir = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log([
    'Usage: node scripts/run-parent-observation.mjs --suite <file> --repo-map <file> --output <file> --trace-dir <directory>',
    '',
    'Runs an actual Codex parent against independent schema-v3 oracle handoffs.',
    'Raw Codex JSONL is written only to the external trace directory.',
  ].join('\n'));
}

async function readJson(file, label) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw new Error(`Could not read ${label} JSON.`);
  }
}

function isInsideCheckout(candidate) {
  const relative = path.relative(CHECKOUT_ROOT, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function mappedRepoKey(source, repoMap) {
  const candidates = [source?.repoId];
  if (source?.repoId === 'cerebras-explorer-mcp') candidates.push('self');
  return candidates.find(candidate => typeof candidate === 'string' &&
    typeof repoMap[candidate] === 'string') ?? null;
}

async function resolveRepoRoot({ source, repoMap, suitePath }) {
  if (source?.kind === 'fixture') {
    if (typeof source.repoPath !== 'string') return { error: 'fixture_repo_path_missing' };
    return {
      root: path.resolve(path.dirname(suitePath), '..', source.repoPath),
      repoId: source.repoId,
    };
  }
  if (source?.kind !== 'repository') return { error: 'repository_source_missing' };
  const key = mappedRepoKey(source, repoMap);
  if (!key) return { error: 'repo_mapping_missing' };
  const configured = repoMap[key];
  if (!path.isAbsolute(configured) && !hasWindowsAbsolutePrefix(configured)) {
    return { error: 'repo_mapping_not_absolute' };
  }
  return { root: path.resolve(configured), repoId: source.repoId };
}

async function validateRootAndPaths(root, referencedPaths) {
  let realRoot;
  try {
    realRoot = await fs.realpath(root);
    if (!(await fs.stat(realRoot)).isDirectory()) return 'repo_root_invalid';
  } catch {
    return 'repo_root_invalid';
  }
  for (const relativePath of referencedPaths) {
    const candidate = path.resolve(realRoot, ...relativePath.split('/'));
    const relative = path.relative(realRoot, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return 'path_outside_repo';
    try {
      const realCandidate = await fs.realpath(candidate);
      const realRelative = path.relative(realRoot, realCandidate);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return 'path_outside_repo';
    } catch {
      return 'referenced_path_missing';
    }
  }
  return null;
}

async function validateSourcePin(source, root) {
  if (source.kind === 'fixture') {
    if (!/^[0-9a-f]{64}$/u.test(source.repoTreeSha256 ?? '')) return 'source_pin_missing';
    return await fixtureTreeSha256(root) === source.repoTreeSha256 ? null : 'source_pin_mismatch';
  }
  if (!/^[0-9a-f]{40}$/u.test(source.gitSha ?? '') ||
      !/^[0-9a-f]{64}$/u.test(source.dirtyTreeSha256 ?? '')) return 'source_pin_missing';
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', windowsHide: true,
    });
    const dirtyHash = await dirtyTreeSha256(root);
    return stdout.trim() === source.gitSha && dirtyHash === source.dirtyTreeSha256
      ? null
      : 'source_pin_mismatch';
  } catch {
    return 'source_pin_mismatch';
  }
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function portableSourcePin(source) {
  if (source?.kind === 'fixture') {
    return {
      kind: 'fixture',
      repoTreeSha256: typeof source.repoTreeSha256 === 'string'
        ? source.repoTreeSha256
        : null,
    };
  }
  if (source?.kind === 'repository') {
    return {
      kind: 'repository',
      gitSha: typeof source.gitSha === 'string' ? source.gitSha : null,
      dirtyTreeSha256: typeof source.dirtyTreeSha256 === 'string'
        ? source.dirtyTreeSha256
        : null,
    };
  }
  return null;
}

function failedCaseResult({
  id,
  repoId,
  sourcePin,
  code,
  promptSha256 = null,
  handoffSha256 = null,
  traceSha256 = null,
}) {
  return {
    id,
    repoId,
    sourcePin,
    promptSha256,
    handoffSha256,
    traceSha256,
    observed: false,
    noBroad: false,
    broadActionCount: 0,
    allowance: { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 },
    violations: [code],
  };
}

function observedCaseResult({
  id,
  repoId,
  sourcePin,
  promptSha256,
  handoffSha256,
  traceSha256,
  classification,
}) {
  return {
    id,
    repoId,
    sourcePin,
    promptSha256,
    handoffSha256,
    traceSha256,
    observed: classification.valid,
    noBroad: classification.noBroadNativeResearch,
    broadActionCount: classification.broadActionCount,
    allowance: classification.allowance,
    violations: classification.violations.map(item => item.code),
  };
}

function assertSafeCaseIds(cases) {
  const ids = new Set();
  for (const definition of cases) {
    if (typeof definition?.id !== 'string' || !SAFE_CASE_ID.test(definition.id) ||
        ids.has(definition.id)) {
      throw new Error('Parent-observation case ids must be safe and unique.');
    }
    ids.add(definition.id);
  }
}

async function resolveExternalTraceDirectory(traceDir) {
  if (typeof traceDir !== 'string' || !path.isAbsolute(traceDir) || isInsideCheckout(traceDir)) {
    throw new Error('Trace directory must be an absolute path outside the checkout.');
  }
  await fs.mkdir(traceDir, { recursive: true });
  const realTraceDir = await fs.realpath(traceDir);
  if (isInsideCheckout(realTraceDir)) {
    throw new Error('Trace directory must be an absolute path outside the checkout.');
  }
  return realTraceDir;
}

export async function buildParentObservationReport({
  suite,
  suitePath,
  repoMap,
  traceDir,
  runParent = invokeCodexParent,
}) {
  if (!suite || !Array.isArray(suite.cases) || !suite.sources || typeof suite.sources !== 'object') {
    throw new Error('Suite must contain sources and cases.');
  }
  if (!repoMap || typeof repoMap !== 'object' || Array.isArray(repoMap)) {
    throw new Error('Repository map must be an object.');
  }
  const derivedEligibleCases = suite.cases.filter(isEligibleParentObservationCase);
  assertSafeCaseIds(derivedEligibleCases);
  let eligibleCases = derivedEligibleCases;
  if (suite.name === 'trust-known-answer') {
    const derivedIds = derivedEligibleCases.map(item => item.id).sort();
    const fixedIds = [...TRUST_PARENT_OBSERVATION_CASE_IDS].sort();
    if (JSON.stringify(derivedIds) !== JSON.stringify(fixedIds)) {
      throw new Error('Trust-suite parent-observation denominator drifted from the fixed 14 cases.');
    }
    const caseById = new Map(derivedEligibleCases.map(item => [item.id, item]));
    eligibleCases = TRUST_PARENT_OBSERVATION_CASE_IDS.map(id => caseById.get(id));
  }
  const realTraceDir = await resolveExternalTraceDirectory(traceDir);
  const results = [];
  for (const definition of eligibleCases) {
    const source = suite.sources[definition.sourceRef];
    const sourcePin = portableSourcePin(source);
    const resolution = await resolveRepoRoot({ source, repoMap, suitePath });
    const repoId = resolution.repoId ?? source?.repoId ?? 'unknown';
    if (resolution.error) {
      results.push(failedCaseResult({
        id: definition.id, repoId, sourcePin, code: resolution.error,
      }));
      continue;
    }
    let handoff;
    try {
      handoff = buildOracleParentHandoff(definition);
    } catch {
      results.push(failedCaseResult({
        id: definition.id, repoId, sourcePin, code: 'oracle_handoff_invalid',
      }));
      continue;
    }
    const handoffSha256 = sha256Text(JSON.stringify(handoff));
    let prompt;
    try {
      prompt = buildParentPrompt(definition, handoff);
    } catch {
      results.push(failedCaseResult({
        id: definition.id,
        repoId,
        sourcePin,
        code: 'parent_prompt_invalid',
        handoffSha256,
      }));
      continue;
    }
    const promptSha256 = sha256Text(prompt);
    const citedTargets = citedTargetsFromHandoff(handoff);
    const boundaryError = await validateRootAndPaths(
      resolution.root,
      citedTargets.map(item => item.path),
    );
    if (boundaryError) {
      results.push(failedCaseResult({
        id: definition.id,
        repoId,
        sourcePin,
        code: boundaryError,
        promptSha256,
        handoffSha256,
      }));
      continue;
    }
    const pinError = await validateSourcePin(source, resolution.root);
    if (pinError) {
      results.push(failedCaseResult({
        id: definition.id,
        repoId,
        sourcePin,
        code: pinError,
        promptSha256,
        handoffSha256,
      }));
      continue;
    }
    let execution;
    try {
      execution = await runParent({
        repoRoot: resolution.root,
        prompt,
        caseId: definition.id,
        handoff,
      });
    } catch {
      execution = { rawJsonl: '', exitCode: 1 };
    }
    const rawJsonl = typeof execution?.rawJsonl === 'string' ? execution.rawJsonl : '';
    const traceSha256 = sha256Text(rawJsonl);
    await fs.writeFile(path.join(realTraceDir, `${definition.id}.jsonl`), rawJsonl, 'utf8');
    const classification = parseCodexParentTrace(rawJsonl, {
      repoId,
      handoff,
      processExitCode: execution?.exitCode ?? 1,
    });
    results.push(observedCaseResult({
      id: definition.id,
      repoId,
      sourcePin,
      promptSha256,
      handoffSha256,
      traceSha256,
      classification,
    }));
  }
  return {
    schemaVersion: 3,
    kind: 'parent_observation',
    suite: {
      schemaVersion: suite.schemaVersion ?? null,
      name: typeof suite.name === 'string' ? suite.name : 'unnamed',
    },
    policy: PARENT_OBSERVATION_POLICY,
    metrics: summarizeParentObservations(results),
    cases: results,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.suite || !options.repoMap || !options.output || !options.traceDir) {
    throw new Error('--suite, --repo-map, --output, and --trace-dir are required.');
  }
  if (isInsideCheckout(options.repoMap) || isInsideCheckout(options.output) ||
      isInsideCheckout(options.traceDir)) {
    throw new Error('Repository map, output, and trace directory must remain outside the checkout.');
  }
  const suitePath = path.resolve(options.suite);
  const suite = await readJson(suitePath, 'suite');
  const repoMap = await readJson(path.resolve(options.repoMap), 'repository map');
  const report = await buildParentObservationReport({
    suite,
    suitePath,
    repoMap,
    traceDir: path.resolve(options.traceDir),
  });
  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fs.writeFile(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Parent observation: ${report.metrics.noBroadNativeResearchCaseCount}/${report.metrics.denominatorCaseCount} eligible cases without broad native re-search.`);
  if (!report.metrics.passed) process.exitCode = 1;
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
