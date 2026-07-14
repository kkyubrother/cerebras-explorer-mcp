#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isSecretPath } from '../src/explorer/security.mjs';

export const PARENT_OBSERVATION_POLICY = Object.freeze({
  id: 'parent-native-research-v1',
  eligibleStates: Object.freeze(['complete', 'verify_targets']),
  passThreshold: 0.9,
  denominator: 'Non-fault known-answer cases with oracle expectedState complete or verify_targets.',
  broadNativeResearch: 'Unscoped or repository-wide grep, glob, or walk, and reads or searches outside cited targets before an allowed follow-up returns a new cited target.',
  allowedVerification: 'Reads and exact searches confined to cited target paths and ranges, plus the handoff allowed follow-up.',
});

const ELIGIBLE_STATES = new Set(PARENT_OBSERVATION_POLICY.eligibleStates);
const SEARCH_OPERATIONS = new Set(['grep', 'glob', 'walk']);
const OBSERVATION_KEYS = new Set(['repoId', 'citedTargets', 'allowedFollowUp', 'actions']);
const TARGET_KEYS = new Set(['path', 'startLine', 'endLine']);
const FOLLOW_UP_KEYS = new Set(['tool', 'scope']);
const ACTION_KEYS = Object.freeze({
  read: new Set(['type', 'path', 'startLine', 'endLine']),
  search: new Set(['type', 'operation', 'query', 'targets']),
  follow_up: new Set(['type', 'tool', 'scope', 'returnedTargets']),
});
const CHECKOUT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
      value.startLine < 1 || value.endLine < value.startLine) {
    return null;
  }
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

/**
 * Exact cited-target allowance used by the parent observer. A path-only target
 * permits a target read; a ranged target permits only a contained range.
 */
export function isWithinCitedTarget(requestedTarget, citedTargets) {
  const requested = normalizeTarget(requestedTarget);
  const citations = normalizeTargetList(citedTargets);
  if (!requested || !citations) return false;
  return isWithinNormalizedCitedTarget(requested, citations);
}

function observationViolation(code, actionIndex = null) {
  return actionIndex === null ? { code } : { code, actionIndex };
}

function invalidTrace(code) {
  return {
    valid: false,
    noBroadNativeResearch: false,
    broadActionCount: 0,
    allowance: {
      citedTargetReads: 0,
      citedPathSearches: 0,
      allowedFollowUps: 0,
    },
    violations: [observationViolation(code)],
    referencedPaths: [],
  };
}

/**
 * Deterministically classifies a portable parent action trace. It has no file
 * system or model dependency; repository boundary checks are layered on by the
 * CLI after classification.
 */
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
  const allowance = {
    citedTargetReads: 0,
    citedPathSearches: 0,
    allowedFollowUps: 0,
  };
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
        continue;
      }
      referencedPaths.push(target.path);
      if (isWithinNormalizedCitedTarget(target, citedTargets)) {
        allowance.citedTargetReads += 1;
      } else {
        broadActionCount += 1;
        violations.push(observationViolation(
          allowedFollowUp && !followedUp
            ? 'uncited_read_before_allowed_follow_up'
            : 'uncited_read',
          actionIndex,
        ));
      }
      continue;
    }

    if (action.type === 'search') {
      const targets = normalizeTargetList(action.targets);
      if (!SEARCH_OPERATIONS.has(action.operation) ||
          typeof action.query !== 'string' || !action.query.trim() || !targets) {
        violations.push(observationViolation('invalid_search_action', actionIndex));
        continue;
      }
      referencedPaths.push(...targets.map(item => item.path));
      if (targets.length === 0) {
        broadActionCount += 1;
        violations.push(observationViolation('repository_wide_search', actionIndex));
      } else if (targets.every(target => isWithinNormalizedCitedTarget(target, citedTargets))) {
        allowance.citedPathSearches += 1;
      } else {
        broadActionCount += 1;
        violations.push(observationViolation(
          allowedFollowUp && !followedUp
            ? 'uncited_search_before_allowed_follow_up'
            : 'uncited_search',
          actionIndex,
        ));
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

  const valid = !violations.some(item => item.code.startsWith('invalid_') || item.code === 'unapproved_follow_up');
  return {
    valid,
    noBroadNativeResearch: valid && broadActionCount === 0,
    broadActionCount,
    allowance,
    violations,
    referencedPaths: [...new Set(referencedPaths)],
  };
}

export function isEligibleParentObservationCase(caseDefinition) {
  if (!caseDefinition || typeof caseDefinition !== 'object') return false;
  if (caseDefinition.kind === 'fault' || caseDefinition.fault === true || caseDefinition.oracle?.fault === true) {
    return false;
  }
  return ELIGIBLE_STATES.has(caseDefinition.oracle?.expectedState);
}

function caseResult(caseDefinition, repoId, classification) {
  if (!caseDefinition.parentObservation) {
    return {
      id: caseDefinition.id,
      repoId,
      observation: 'unobserved',
      noBroadNativeResearch: false,
      broadActionCount: 0,
      allowance: {
        citedTargetReads: 0,
        citedPathSearches: 0,
        allowedFollowUps: 0,
      },
      violations: ['observation_missing'],
    };
  }
  return {
    id: caseDefinition.id,
    repoId,
    observation: classification.valid ? 'observed' : 'invalid',
    noBroadNativeResearch: classification.noBroadNativeResearch,
    broadActionCount: classification.broadActionCount,
    allowance: classification.allowance,
    violations: classification.violations.map(item => item.code),
  };
}

export function summarizeParentObservations(results) {
  const denominatorCaseCount = results.length;
  const noBroadNativeResearchCaseCount = results.filter(item => item.noBroadNativeResearch).length;
  const broadNativeResearchCaseCount = results.filter(item => item.broadActionCount > 0).length;
  const observedCaseCount = results.filter(item => item.observation === 'observed').length;
  const unobservedCaseCount = results.filter(item => item.observation === 'unobserved').length;
  const invalidObservationCaseCount = results.filter(item => item.observation === 'invalid').length;
  const noBroadNativeResearchRate = denominatorCaseCount === 0
    ? null
    : Math.round((noBroadNativeResearchCaseCount / denominatorCaseCount) * 1_000_000) / 1_000_000;
  const sumAllowance = key => results.reduce((sum, item) => sum + item.allowance[key], 0);

  return {
    denominatorCaseCount,
    observedCaseCount,
    unobservedCaseCount,
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
  const options = { suite: null, repoMap: null, output: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--suite') options.suite = argv[++index];
    else if (arg === '--repo-map') options.repoMap = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log([
    'Usage: node scripts/run-parent-observation.mjs --suite <file> --repo-map <file> --output <file>',
    '',
    'The suite stores portable parentObservation traces. Repository roots are',
    'resolved only through the external logical-id map and are never reported.',
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

function mappedRepoKey(source, observation, repoMap) {
  const candidates = [observation?.repoId, source?.repoId];
  if (source?.repoId === 'cerebras-explorer-mcp') candidates.push('self');
  return candidates.find(candidate => typeof candidate === 'string' &&
    typeof repoMap[candidate] === 'string') ?? null;
}

function defaultLogicalRepoId(source, observation, repoMap) {
  return mappedRepoKey(source, observation, repoMap) ?? observation?.repoId ?? source?.repoId ?? 'unknown';
}

async function resolveRepoRoot({ source, observation, repoMap, suitePath }) {
  if (source?.kind === 'fixture') {
    if (typeof source.repoPath !== 'string') return { error: 'fixture_repo_path_missing' };
    if (observation.repoId !== source.repoId) return { error: 'repo_id_mismatch' };
    const root = path.resolve(path.dirname(suitePath), '..', source.repoPath);
    return { root, repoId: source.repoId };
  }
  if (source?.kind !== 'repository') return { error: 'repository_source_missing' };
  const selfAlias = source.repoId === 'cerebras-explorer-mcp' && observation.repoId === 'self';
  if (observation.repoId !== source.repoId && !selfAlias) return { error: 'repo_id_mismatch' };
  const key = mappedRepoKey(source, observation, repoMap);
  if (!key) return { error: 'repo_mapping_missing' };
  const configured = repoMap[key];
  if (!path.isAbsolute(configured) && !hasWindowsAbsolutePrefix(configured)) {
    return { error: 'repo_mapping_not_absolute' };
  }
  return { root: path.resolve(configured), repoId: key };
}

async function validateRootAndPaths(root, referencedPaths) {
  let realRoot;
  try {
    realRoot = await fs.realpath(root);
    const stat = await fs.stat(realRoot);
    if (!stat.isDirectory()) return 'repo_root_invalid';
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

function appendInvalidViolation(classification, code) {
  return {
    ...classification,
    valid: false,
    noBroadNativeResearch: false,
    violations: [...classification.violations, observationViolation(code)],
  };
}

export async function buildParentObservationReport({ suite, suitePath, repoMap }) {
  if (!suite || !Array.isArray(suite.cases) || !suite.sources || typeof suite.sources !== 'object') {
    throw new Error('Suite must contain sources and cases.');
  }
  if (!repoMap || typeof repoMap !== 'object' || Array.isArray(repoMap)) {
    throw new Error('Repository map must be an object.');
  }

  const eligibleCases = suite.cases.filter(isEligibleParentObservationCase);
  const results = [];
  for (const definition of eligibleCases) {
    const source = suite.sources[definition.sourceRef];
    const observation = definition.parentObservation;
    const fallbackRepoId = defaultLogicalRepoId(source, observation, repoMap);
    if (!observation) {
      results.push(caseResult(definition, fallbackRepoId, null));
      continue;
    }

    let classification = classifyParentActionTrace(observation);
    const resolution = await resolveRepoRoot({ source, observation, repoMap, suitePath });
    const repoId = resolution.repoId ?? fallbackRepoId;
    if (resolution.error) {
      classification = appendInvalidViolation(classification, resolution.error);
    } else {
      const boundaryError = await validateRootAndPaths(resolution.root, classification.referencedPaths);
      if (boundaryError) classification = appendInvalidViolation(classification, boundaryError);
    }
    results.push(caseResult(definition, repoId, classification));
  }

  return {
    schemaVersion: 1,
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
  if (!options.suite || !options.repoMap || !options.output) {
    throw new Error('--suite, --repo-map, and --output are required.');
  }
  if (isInsideCheckout(options.repoMap) || isInsideCheckout(options.output)) {
    throw new Error('Repository map and output must remain outside the checkout.');
  }

  const suitePath = path.resolve(options.suite);
  const suite = await readJson(suitePath, 'suite');
  const repoMap = await readJson(path.resolve(options.repoMap), 'repository map');
  const report = await buildParentObservationReport({ suite, suitePath, repoMap });
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
