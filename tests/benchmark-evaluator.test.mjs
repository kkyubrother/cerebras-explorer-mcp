import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIVE_TRUST_EVALUATION_PROFILE,
  PORTABLE_PARENT_OBSERVATION_PENDING,
  PORTABLE_PARENT_OBSERVATION_PROFILE,
  evaluateBenchmarkCase,
  evaluateKnownBadBaseline,
  evaluatePortableParentObservationRecord,
  evaluateTrustCase,
  evaluateTrustRepeatability,
  projectPortableParentObservationReport,
  summarizeBenchmarkSuite,
} from '../src/benchmark/evaluator.mjs';
import {
  PARENT_OBSERVATION_POLICY,
  TRUST_PARENT_OBSERVATION_CASE_IDS,
  buildOracleParentHandoff,
  buildParentPrompt,
  isEligibleParentObservationCase,
} from '../scripts/run-parent-observation.mjs';
import {
  buildParentPayload,
  measureParentPayload,
} from '../src/explorer/parent-payload.mjs';

const TRUST_MANIFEST_URL = new URL('../benchmarks/trust-known-answer.json', import.meta.url);
const ADOPTION_MANIFEST_URL = new URL('../benchmarks/adoption.json', import.meta.url);
const BASELINE_RESULTS_URL = new URL('../fixtures/trust-known-answer/baseline-results/', import.meta.url);
const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_ORACLE_PROVENANCE = new Set([
  'fixture_assertion',
  'source_review',
  'external_record',
]);
const FORBIDDEN_ORACLE_PROVENANCE = [
  'explorer_output',
  'model_output',
  'self_report',
];
const ORACLE_CLAIM_TYPES = new Set([
  'positive',
  'absence',
  'count',
  'symbol_definition',
  'symbol_usage',
  'flow',
  'impact',
  'comparison',
  'claim_verification',
]);
const ORACLE_RESOLUTIONS = new Set(['supported', 'refuted', 'gap', 'failed']);
const ORACLE_STATES = new Set(['complete', 'incomplete', 'failed']);

function validRequiredTextAssociations(value) {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return false;
  const ids = new Set();
  const validAlternatives = alternatives => {
    if (!Array.isArray(alternatives) || alternatives.length === 0 || alternatives.length > 8 ||
        alternatives.some(token => typeof token !== 'string' || !token.trim() ||
          token.length > 128)) return false;
    const normalized = alternatives.map(token => token.normalize('NFKC').toLowerCase().trim());
    return new Set(normalized).size === normalized.length;
  };
  return value.every(association => {
    if (!isObject(association) ||
        Object.keys(association).sort().join(',') !==
          'id,predicateGroups,subjectAlternatives' ||
        typeof association.id !== 'string' || !association.id.trim() ||
        ids.has(association.id) ||
        !validAlternatives(association.subjectAlternatives) ||
        !Array.isArray(association.predicateGroups) ||
        association.predicateGroups.length === 0 || association.predicateGroups.length > 4 ||
        association.predicateGroups.some(group => !validAlternatives(group))) return false;
    ids.add(association.id);
    return true;
  });
}
const ORACLE_FAILURE_CATEGORIES = new Set(['execution', 'input', 'provider', 'internal']);
const ORACLE_FAILURE_REASONS = new Set([
  'tool_errors',
  'aborted',
  'repo_mismatch',
  'invalid_arguments',
  'provider_error',
  'access_denied',
  'invalid_final_response',
]);
const ORACLE_SAFETY_LIMIT_NAMES = new Set([
  'turn_limit',
  'context_limit',
  'generation_output_limit',
  'walk_limit',
  'tool_result_limit',
]);
const ORACLE_SAFETY_LIMIT_STAGES = new Set([
  'planner',
  'goal_audit',
  'plan_revision',
  'exploration',
  'synthesis',
  'verification',
  'repair',
]);
const ORACLE_SOURCE_ROLES = new Set([
  'implementation',
  'test',
  'config',
  'documentation',
  'fixture',
  'generated',
  'unknown',
]);
const ORACLE_TEMPORAL_ROLES = new Set(['current', 'historical']);
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
const EXPECTED_US5_FIXTURE_IDS = Object.freeze([
  'fx-scoped-zero-match',
  'fx-truncated-all-usages',
  'fx-route-policy-divergence',
  'fx-semantic-mismatch',
  'fx-historical-source-role',
]);
const WRAPPER_RUNTIME_ACCEPTANCE_TEST =
  'Spec 028 T068 — every retained wrapper has a distinct end-to-end proof-policy acceptance';
const wrapperRuntimeTest = subtest => Object.freeze({
  path: 'tests/runtime.mock.test.mjs',
  name: WRAPPER_RUNTIME_ACCEPTANCE_TEST,
  subtest,
});
const EXPECTED_WRAPPER_ACCEPTANCES = Object.freeze([
  Object.freeze({
    tool: 'find_relevant_code',
    proofPolicy: 'bounded_relevant_location_set',
    scenarioRef: 'locate-relevant-code',
    runtimeTest: wrapperRuntimeTest('find_relevant_code'),
  }),
  Object.freeze({
    tool: 'trace_symbol',
    proofPolicy: 'definition_and_usage_cross_check',
    scenarioRef: 'trace-symbol-cross-check',
    runtimeTest: wrapperRuntimeTest('trace_symbol'),
  }),
  Object.freeze({
    tool: 'map_change_impact',
    proofPolicy: 'requested_impact_categories',
    scenarioRef: 'map-change-impact',
    runtimeTest: wrapperRuntimeTest('map_change_impact'),
  }),
  Object.freeze({
    tool: 'explain_code_path',
    proofPolicy: 'ordered_handoffs',
    scenarioRef: 'explain-code-path',
    runtimeTest: wrapperRuntimeTest('explain_code_path'),
  }),
  Object.freeze({
    tool: 'collect_evidence',
    proofPolicy: 'support_or_refute',
    scenarioRef: 'collect-evidence',
    runtimeTest: wrapperRuntimeTest('collect_evidence'),
  }),
  Object.freeze({
    tool: 'explore_repo',
    proofPolicy: 'audited_subgoal_policies',
    scenarioRef: 'explore-recent-change-context',
    runtimeTest: wrapperRuntimeTest('explore_repo'),
  }),
]);
const EXPECTED_OFFLINE_GUARD_IDS = Object.freeze([
  'minimal_parent_handoff',
  'no_parent_policy_controls',
  'safety_invariants',
  'no_internal_budget_surface',
]);
const EXPECTED_SC_IDS = Object.freeze(
  Array.from({ length: 16 }, (_, index) => `SC-${String(index + 1).padStart(3, '0')}`),
);
const EXPECTED_CROSS_REPOSITORY_GATE_CASE_IDS = Object.freeze([
  'obs-deny-list-count-range',
  'obs-large-route-ui-api-mismatch',
  'obs-route-admin-divergence',
  'obs-external-process-inference',
  'obs-repeat-tests-environment',
]);

const EXPECTED_KNOWN_BAD_VIOLATIONS = {
  'obs-deny-list-count-range': ['FORBIDDEN_CLAIM_PRESENT'],
  'obs-large-route-ui-api-mismatch': ['REQUIRED_GOAL_UNSUPPORTED:G1'],
  'obs-route-admin-divergence': [
    'REQUIRED_GOAL_UNSUPPORTED:G2',
    'REQUIRED_GOAL_UNSUPPORTED:G3',
  ],
  'obs-external-process-inference': ['DOCUMENTED_TRUST_FAILURE'],
  'obs-repeat-tests-environment': [
    'REQUIRED_GOAL_UNSUPPORTED:G2',
    'REQUIRED_GOAL_UNSUPPORTED:G3',
  ],
  'obs-aws-inventory-classification': ['REQUIRED_GOAL_UNSUPPORTED:G1'],
  'fx-jsonrpc-id-zero-cancellation': [
    'EXPECTED_STATE_MISMATCH',
    'REQUEST_NOT_ABORTED',
  ],
};

async function loadTrustManifest() {
  return parseTrustManifest(await fs.readFile(TRUST_MANIFEST_URL, 'utf8'));
}

function artifactDefinitionForCase(manifest, caseDefinition) {
  const baselineRef = caseDefinition.schemaV2Baseline?.baselineRef;
  if (baselineRef) {
    return { kind: 'baseline', definition: manifest.baselines[baselineRef] };
  }
  const observationRef = caseDefinition.knownBadObservationRef;
  if (observationRef) {
    return { kind: 'observation', definition: manifest.observations[observationRef] };
  }
  return null;
}

async function loadKnownBadEntries() {
  const manifest = await loadTrustManifest();
  const entries = [];
  for (const caseDefinition of manifest.cases) {
    const artifactDefinition = artifactDefinitionForCase(manifest, caseDefinition);
    if (!artifactDefinition) continue;
    const artifactUrl = new URL('../' + artifactDefinition.definition.artifact, import.meta.url);
    const rawArtifact = await fs.readFile(artifactUrl, 'utf8');
    entries.push({
      caseDefinition,
      ...artifactDefinition,
      rawArtifact,
      artifact: JSON.parse(rawArtifact),
    });
  }
  return { manifest, entries };
}

function normalizeLfBytes(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const output = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 13) {
      output.push(bytes[index]);
      continue;
    }
    if (bytes[index + 1] === 10) index += 1;
    output.push(10);
  }
  return Buffer.from(output);
}

function canonicalSha256(input) {
  return createHash('sha256')
    .update(normalizeLfBytes(input))
    .digest('hex');
}

function parseTrustManifest(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (cause) {
    const error = new Error('Trust manifest is not valid JSON.', { cause });
    error.code = 'INVALID_TRUST_MANIFEST';
    error.problems = ['manifest is not valid JSON'];
    throw error;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[A-Za-z]:/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function isSafeScope(value) {
  return isSafeRelativePath(value)
    && (!/[*?\[]/.test(value)
      || (value.endsWith('/**') && !/[*?\[]/.test(value.slice(0, -3))));
}

function isValidRequestOriginRef(value, requestText) {
  const match = /^request:(\d+)-(\d+)$/.exec(value ?? '');
  if (!match || typeof requestText !== 'string') return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start)
    && Number.isSafeInteger(end)
    && start >= 0
    && end > start
    && end <= requestText.length
    && requestText.slice(start, end).trim().length > 0;
}

function pathInScope(candidate, scope) {
  return Array.isArray(scope) && scope.some(entry => typeof entry === 'string'
    && (entry.endsWith('/**')
      ? candidate === entry.slice(0, -3) || candidate.startsWith(entry.slice(0, -3) + '/')
      : candidate === entry));
}

function sameStringSet(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.length === right.length
    && left.every(value => right.includes(value));
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasExactKeys(value, keys) {
  return isObject(value) && sameStringSet(Object.keys(value), keys);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function collectForbiddenPortableResultKeys(value, prefix = 'offlineResults') {
  if (!isObject(value) && !Array.isArray(value)) return [];
  const forbidden = [];
  for (const [key, nested] of Object.entries(value)) {
    const keyPath = `${prefix}.${key}`;
    if (/^(passed|generatedAt|timestamp|latency|tokens?|usage|transcript|repoRoot|absolutePath)$/i.test(key)) {
      forbidden.push(keyPath);
    }
    forbidden.push(...collectForbiddenPortableResultKeys(nested, keyPath));
  }
  return forbidden;
}

function portableParentSourcePin(caseDefinition, sources) {
  const source = sources[caseDefinition.sourceRef];
  const handoff = buildOracleParentHandoff(caseDefinition);
  const common = {
    caseId: caseDefinition.id,
    sourceRef: caseDefinition.sourceRef,
    repoId: source.repoId,
    kind: source.kind,
  };
  const promptSha256 = canonicalSha256(buildParentPrompt(caseDefinition, handoff));
  const handoffSha256 = canonicalSha256(JSON.stringify(handoff));
  return source.kind === 'repository'
    ? {
        ...common,
        gitSha: source.gitSha,
        dirtyTreeSha256: source.dirtyTreeSha256,
        promptSha256,
        handoffSha256,
      }
    : {
        ...common,
        repoTreeSha256: source.repoTreeSha256,
        promptSha256,
        handoffSha256,
      };
}

function portableParentMetrics(cases) {
  const denominatorCaseCount = cases.length;
  const noBroadNativeResearchCaseCount = cases
    .filter(item => item.noBroad).length;
  return {
    denominatorCaseCount,
    observedCaseCount: cases.filter(item => item.observed).length,
    invalidObservationCaseCount: cases.filter(item => !item.observed).length,
    noBroadNativeResearchCaseCount,
    broadNativeResearchCaseCount: cases.filter(item => item.broadActionCount > 0).length,
    noBroadNativeResearchRate: denominatorCaseCount === 0 ? null :
      Math.round((noBroadNativeResearchCaseCount / denominatorCaseCount) * 1_000_000) / 1_000_000,
    allowance: {
      citedTargetReads: cases.reduce(
        (sum, item) => sum + item.allowance.citedTargetReads, 0,
      ),
      citedPathSearches: cases.reduce(
        (sum, item) => sum + item.allowance.citedPathSearches, 0,
      ),
      allowedFollowUps: cases.reduce(
        (sum, item) => sum + item.allowance.allowedFollowUps, 0,
      ),
    },
  };
}

function recordedParentObservationControl(pendingRecord) {
  const sourcePinByCase = new Map(
    pendingRecord.sourcePins.map(item => [item.caseId, item]),
  );
  const cases = pendingRecord.denominatorCaseIds.map(caseId => ({
    id: caseId,
    repoId: sourcePinByCase.get(caseId).repoId,
    sourcePin: sourcePinByCase.get(caseId).kind === 'repository'
      ? {
          kind: 'repository',
          gitSha: sourcePinByCase.get(caseId).gitSha,
          dirtyTreeSha256: sourcePinByCase.get(caseId).dirtyTreeSha256,
        }
      : {
          kind: 'fixture',
          repoTreeSha256: sourcePinByCase.get(caseId).repoTreeSha256,
        },
    promptSha256: sourcePinByCase.get(caseId).promptSha256,
    handoffSha256: sourcePinByCase.get(caseId).handoffSha256,
    broadActionCount: 0,
    observed: true,
    noBroad: true,
    allowance: { citedTargetReads: 0, citedPathSearches: 0, allowedFollowUps: 0 },
    violations: [],
    traceSha256: canonicalSha256(`synthetic-control:${caseId}`),
  }));
  const metrics = portableParentMetrics(cases);
  return projectPortableParentObservationReport({
    schemaVersion: 3,
    kind: 'parent_observation',
    policy: {
      id: PORTABLE_PARENT_OBSERVATION_PROFILE,
      passThreshold: pendingRecord.minimumRate,
    },
    metrics: { ...metrics, passThreshold: pendingRecord.minimumRate, passed: true },
    cases,
  }, {
    denominatorCaseIds: pendingRecord.denominatorCaseIds,
    sourcePins: pendingRecord.sourcePins,
    reportSha256: canonicalSha256('synthetic-parent-observation-control'),
  });
}

function projectPath(relativePath) {
  return path.join(PROJECT_ROOT, ...relativePath.split('/'));
}

async function walkRegularFiles(root, relativeRoot = '') {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const relativePath = relativeRoot ? relativeRoot + '/' + entry.name : entry.name;
    const absolutePath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('symlink: ' + relativePath);
    if (entry.isDirectory()) {
      files.push(...await walkRegularFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    } else {
      throw new Error('non-regular entry: ' + relativePath);
    }
  }
  return files;
}

async function fixtureTreeSha256(root, readFile) {
  const files = await walkRegularFiles(root);
  files.sort((left, right) => left.relativePath === right.relativePath
    ? 0
    : left.relativePath < right.relativePath ? -1 : 1);
  const hash = createHash('sha256');
  for (const file of files) {
    const content = normalizeLfBytes(await readFile(file.absolutePath));
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function validateProvider(document, label, problems) {
  if (!isObject(document)
      || document.fixtureVersion !== 1
      || typeof document.scenario !== 'string'
      || document.scenario.length === 0
      || !Array.isArray(document.responses)
      || document.responses.length === 0) {
    problems.push(label + ' has an invalid provider document shape');
    return;
  }
  if (Object.hasOwn(document, 'oracle')) problems.push(label + ' embeds a model-authored oracle');
  document.responses.forEach((response, index) => {
    const modes = isObject(response)
      ? [Object.hasOwn(response, 'result'), Object.hasOwn(response, 'error'), response.waitForAbort === true]
      : [];
    if (!isObject(response)
        || typeof response.stage !== 'string'
        || response.stage.length === 0
        || modes.filter(Boolean).length !== 1) {
      problems.push(label + ' response ' + index + ' is not parseable');
    } else if (Object.hasOwn(response, 'result')) {
      const message = response.result?.message;
      if (!isObject(message)
          || !Object.hasOwn(message, 'content')
          || !Array.isArray(message.toolCalls)) {
        problems.push(label + ' response ' + index + ' has an invalid result message');
      }
    } else if (Object.hasOwn(response, 'error')
        && (!isObject(response.error)
          || typeof response.error.message !== 'string'
          || response.error.message.length === 0)) {
      problems.push(label + ' response ' + index + ' has an invalid error');
    }
  });
}

async function readPinned(relativePath, expectedHash, label, context, parseJson = false) {
  const { problems, readFile } = context;
  if (!isSafeRelativePath(relativePath)) {
    problems.push(label + ' path is not repository-relative');
    return null;
  }
  if (!SHA256_PATTERN.test(expectedHash ?? '')) {
    problems.push(label + ' is missing a SHA-256 pin');
  }
  let raw;
  try {
    raw = await readFile(projectPath(relativePath));
  } catch (error) {
    problems.push(label + ' cannot be read: ' + error.code);
    return null;
  }
  if (SHA256_PATTERN.test(expectedHash ?? '') && canonicalSha256(raw) !== expectedHash) {
    problems.push(label + ' hash does not match');
  }
  if (!parseJson) return raw;
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    problems.push(label + ' is not valid JSON');
    return null;
  }
}

async function validatePortableOfflineResults(manifest, {
  cases,
  caseById,
  sources,
  context,
}) {
  const { problems } = context;
  const results = manifest.offlineResults;
  if (!isObject(results)) {
    problems.push('portable offline results have an invalid top-level shape');
    return;
  }
  const forbiddenKeys = collectForbiddenPortableResultKeys(results);
  if (forbiddenKeys.length > 0) {
    problems.push('portable offline results contain machine-local or self-reported fields');
  }
  if (!hasExactKeys(results, [
    'profile',
    'fixtureTrust',
    'guardAcceptances',
    'parentObservation',
    'wrapperAcceptances',
    'payloadComparison',
    'criteria',
  ]) || results.profile !== 'portable-offline-v1') {
    problems.push('portable offline results have an invalid top-level shape');
    return;
  }

  const directFixtureCaseIds = cases
    .filter(item => isObject(item)
      && sources[item.sourceRef]?.kind === 'fixture'
      && item.fixtureExecution === 'direct')
    .map(item => item.id);
  const repeatableFixtureCaseIds = cases
    .filter(item => isObject(item)
      && sources[item.sourceRef]?.kind === 'fixture'
      && item.fixtureExecution === 'direct'
      && item.repeatCount === 3)
    .map(item => item.id);
  const fixtureTrust = results.fixtureTrust;
  if (!hasExactKeys(fixtureTrust, [
    'acceptedCaseIds', 'repeatableCaseIds', 'repeatCount',
  ])
      || !sameStringSet(fixtureTrust.acceptedCaseIds, directFixtureCaseIds)
      || !sameStringSet(fixtureTrust.repeatableCaseIds, repeatableFixtureCaseIds)
      || fixtureTrust.repeatCount !== 3) {
    problems.push('portable fixture results do not cover every direct fixture and repeatability case');
  }

  const guardAcceptances = results.guardAcceptances;
  const guardRefs = new Set();
  if (!Array.isArray(guardAcceptances) || !sameStringSet(
    guardAcceptances.map(item => item?.id),
    EXPECTED_OFFLINE_GUARD_IDS,
  )) {
    problems.push('portable guard acceptances do not cover the fixed guard set');
  } else {
    for (const acceptance of guardAcceptances) {
      if (!hasExactKeys(acceptance, ['id', 'tests']) ||
          !Array.isArray(acceptance.tests) || acceptance.tests.length === 0) {
        problems.push(`portable guard acceptance ${String(acceptance?.id)} is invalid`);
        continue;
      }
      const uniqueTests = new Set();
      let acceptanceValid = true;
      for (const testRef of acceptance.tests) {
        const relativePath = typeof testRef?.path === 'string'
          ? testRef.path.replaceAll('\\', '/')
          : '';
        const testName = typeof testRef?.name === 'string' ? testRef.name : '';
        const identity = `${relativePath}\n${testName}`;
        if (!hasExactKeys(testRef, ['path', 'name']) ||
            !/^tests\/(?:[^/]+\/)*[^/]+\.test\.mjs$/u.test(relativePath) ||
            relativePath.includes('..') || path.isAbsolute(relativePath) ||
            !testName || uniqueTests.has(identity)) {
          acceptanceValid = false;
          continue;
        }
        uniqueTests.add(identity);
        let source = '';
        try {
          source = String(await context.readFile(path.join(PROJECT_ROOT, relativePath), 'utf8'));
        } catch {
          acceptanceValid = false;
          continue;
        }
        const markerCount = source.split(testName).length - 1;
        const markerIndex = source.indexOf(testName);
        const prefix = markerIndex >= 0
          ? source.slice(Math.max(0, markerIndex - 160), markerIndex)
          : '';
        if (markerCount !== 1 ||
            !/[A-Za-z_$][\w$]*(?:\.skip|\.todo)?\s*\(\s*['"`]$/u.test(prefix) ||
            /\.(?:skip|todo)\s*\(\s*['"`]$/u.test(prefix)) {
          acceptanceValid = false;
        }
      }
      if (!acceptanceValid) {
        problems.push(`portable guard acceptance ${acceptance.id} is not bound to active tests`);
      } else {
        guardRefs.add(`guard:${acceptance.id}`);
      }
    }
  }

  const eligibleParentCases = cases.filter(isEligibleParentObservationCase);
  const eligibleParentCaseIds = [...TRUST_PARENT_OBSERVATION_CASE_IDS];
  if (!sameStringSet(eligibleParentCases.map(item => item.id), eligibleParentCaseIds)) {
    problems.push('portable parent-observation denominator drifted from the fixed 14 cases');
  }
  const eligibleParentCaseById = new Map(eligibleParentCases.map(item => [item.id, item]));
  const parentObservation = results.parentObservation;
  const expectedSourcePins = [];
  for (const caseId of eligibleParentCaseIds) {
    const caseDefinition = eligibleParentCaseById.get(caseId);
    if (!caseDefinition) continue;
    try {
      expectedSourcePins.push(portableParentSourcePin(caseDefinition, sources));
    } catch {
      problems.push(`case ${caseId} cannot produce an independent parent handoff`);
    }
  }
  const parentEvaluation = evaluatePortableParentObservationRecord(parentObservation, {
    expectedCaseIds: eligibleParentCaseIds,
    expectedMinimumRate: PARENT_OBSERVATION_POLICY.passThreshold,
    expectedSourcePins,
  });
  for (const problem of parentEvaluation.problems) {
    problems.push(problem);
  }

  let adoption;
  try {
    adoption = JSON.parse(await context.readFile(fileURLToPath(ADOPTION_MANIFEST_URL), 'utf8'));
  } catch {
    problems.push('adoption manifest cannot be read for wrapper acceptance validation');
  }
  const wrapperAcceptances = results.wrapperAcceptances;
  if (!Array.isArray(wrapperAcceptances)
      || !sameStringSet(
        wrapperAcceptances.map(item => JSON.stringify(item)),
        EXPECTED_WRAPPER_ACCEPTANCES.map(item => JSON.stringify(item)),
      )) {
    problems.push('portable wrapper acceptances do not match the six proof policies');
  } else {
    const adoptionById = new Map((adoption?.cases ?? []).map(item => [item.id, item]));
    let runtimeAcceptanceSource = '';
    try {
      runtimeAcceptanceSource = String(await context.readFile(
        path.join(PROJECT_ROOT, 'tests/runtime.mock.test.mjs'),
        'utf8',
      ));
    } catch {
      problems.push('runtime wrapper acceptance test cannot be read');
    }
    for (const acceptance of wrapperAcceptances) {
      const runtimeTest = acceptance?.runtimeTest;
      if (!hasExactKeys(acceptance, ['tool', 'proofPolicy', 'scenarioRef', 'runtimeTest'])
          || adoptionById.get(acceptance.scenarioRef)?.tool !== acceptance.tool
          || !hasExactKeys(runtimeTest, ['path', 'name', 'subtest'])
          || runtimeTest.path !== 'tests/runtime.mock.test.mjs'
          || runtimeTest.name !== WRAPPER_RUNTIME_ACCEPTANCE_TEST
          || runtimeTest.subtest !== acceptance.tool
          || runtimeAcceptanceSource.split(WRAPPER_RUNTIME_ACCEPTANCE_TEST).length - 1 !== 1
          || !runtimeAcceptanceSource.includes(`tool: '${acceptance.tool}'`)
          || !runtimeAcceptanceSource.includes('await t.test(wrapperCase.tool')) {
        problems.push(`wrapper acceptance ${acceptance.tool} has an invalid adoption scenario`);
      }
    }
  }

  const payloadComparison = results.payloadComparison;
  const responseBaselineCaseIds = cases
    .filter(item => {
      if (!isObject(item)) return false;
      const baselineRef = item.schemaV2Baseline?.baselineRef;
      return Number.isInteger(manifest.baselines?.[baselineRef]?.parentPayloadBytes)
        && manifest.baselines[baselineRef].parentPayloadBytes > 0;
    })
    .map(item => item.id);
  const sampleIds = Array.isArray(payloadComparison?.samples)
    ? payloadComparison.samples.map(item => item?.caseId)
    : [];
  const reductions = [];
  if (!hasExactKeys(payloadComparison, [
    'metric', 'minimumMedianReduction', 'samples',
  ])
      || payloadComparison.metric !== manifest.payloadMetric?.id
      || payloadComparison.minimumMedianReduction !== 0.4
      || !sameStringSet(sampleIds, responseBaselineCaseIds)) {
    problems.push('portable payload comparison has an invalid denominator or metric');
  }
  for (const sample of payloadComparison?.samples ?? []) {
    const caseDefinition = caseById.get(sample?.caseId);
    const baseline = manifest.baselines?.[sample?.baselineRef];
    let measurement;
    try {
      measurement = measureParentPayload(buildParentPayload(
        buildOracleParentHandoff(caseDefinition),
      ));
    } catch {
      measurement = null;
    }
    if (!hasExactKeys(sample, [
      'caseId', 'baselineRef', 'currentParentPayloadBytes', 'currentPayloadSha256',
    ])
        || caseDefinition?.schemaV2Baseline?.baselineRef !== sample.baselineRef
        || sample.currentParentPayloadBytes !== measurement?.parentPayloadBytes
        || sample.currentPayloadSha256 !== measurement?.sha256
        || !Number.isInteger(baseline?.parentPayloadBytes)
        || sample.currentParentPayloadBytes >= baseline.parentPayloadBytes) {
      problems.push(`portable payload sample ${String(sample?.caseId)} is invalid`);
      continue;
    }
    reductions.push(
      (baseline.parentPayloadBytes - sample.currentParentPayloadBytes)
        / baseline.parentPayloadBytes,
    );
  }
  if (reductions.length === 0
      || median(reductions) < payloadComparison?.minimumMedianReduction) {
    problems.push('portable payload comparison misses the median reduction gate');
  }

  const criteria = results.criteria;
  if (!isObject(criteria) || !sameStringSet(Object.keys(criteria), EXPECTED_SC_IDS)) {
    problems.push('portable results must define every SC-001 through SC-016 gate');
    return;
  }
  const wrapperRefs = new Set(
    (wrapperAcceptances ?? []).map(item => `wrapper:${item.tool}`),
  );
  const metricRefs = new Set([
    'metric:payload_reduction',
    'metric:parent_observation',
    'metric:fixture_repeatability',
  ]);
  for (const criterion of EXPECTED_SC_IDS) {
    const refs = criteria[criterion];
    if (!Array.isArray(refs) || refs.length === 0 || new Set(refs).size !== refs.length) {
      problems.push(`portable criterion ${criterion} has no unique evidence refs`);
      continue;
    }
    for (const ref of refs) {
      const [kind, id] = typeof ref === 'string' ? ref.split(':', 2) : [];
      const resolved = kind === 'fixture'
        ? fixtureTrust?.acceptedCaseIds?.includes(id)
        : kind === 'case'
          ? caseById.has(id)
          : kind === 'wrapper'
            ? wrapperRefs.has(ref)
            : kind === 'metric'
              ? metricRefs.has(ref)
              : kind === 'guard'
                ? guardRefs.has(ref)
                : false;
      if (!resolved) problems.push(`portable criterion ${criterion} has unresolved ref ${ref}`);
    }
  }
  if (!sameStringSet(
    Array.isArray(criteria['SC-003'])
      ? criteria['SC-003'].map(ref => ref.replace(/^case:/, ''))
      : [],
    EXPECTED_CROSS_REPOSITORY_GATE_CASE_IDS,
  )
      || !sameStringSet(criteria['SC-007'], [...wrapperRefs])
      || !sameStringSet(criteria['SC-006'], ['metric:payload_reduction'])
      || !sameStringSet(criteria['SC-008'], ['metric:parent_observation'])
      || !sameStringSet(criteria['SC-009'], ['metric:fixture_repeatability'])
      || !sameStringSet(criteria['SC-011'], ['guard:no_parent_policy_controls'])
      || !sameStringSet(criteria['SC-012'], ['guard:safety_invariants'])
      || !sameStringSet(criteria['SC-013'], ['guard:no_internal_budget_surface'])) {
    problems.push('portable criteria do not bind the fixed cross-repository, wrapper, metric, and guard gates');
  }
  const expectedGoalAuditIds = cases
    .filter(item => isObject(item) && item.kind === 'goal_audit')
    .map(item => `fixture:${item.id}`);
  const expectedBlockerIds = cases
    .filter(item => isObject(item)
      && item.kind === 'goal_audit'
      && item.oracle?.expectedState === 'incomplete')
    .map(item => `fixture:${item.id}`)
    .concat('fixture:fx-generation-output-cap-invalid-control');
  if (!sameStringSet(criteria['SC-014'], expectedGoalAuditIds)
      || !sameStringSet(criteria['SC-016'], expectedBlockerIds)) {
    problems.push('portable goal-audit and blocker criteria omit required scenarios');
  }
}

async function collectTrustManifestProblems(manifest, options = {}) {
  const problems = [];
  const context = { problems, readFile: options.readFile ?? fs.readFile };
  if (!isObject(manifest)) return ['manifest must be an object'];
  if (manifest.schemaVersion !== 1) problems.push('manifest schemaVersion must be 1');
  if (manifest.hashSchemes?.file?.id !== 'sha256-lf-v1'
      || manifest.hashSchemes?.fixtureTree?.id !== 'sha256-tree-lf-v1'
      || manifest.hashSchemes?.dirtyTree?.id !== 'sha256-dirty-tree-v1') {
    problems.push('manifest hash schemes are invalid');
  }
  const allowedProvenanceValues = Array.isArray(manifest.oraclePolicy?.allowedProvenance)
    ? manifest.oraclePolicy.allowedProvenance
    : [];
  const forbiddenProvenanceValues = Array.isArray(manifest.oraclePolicy?.forbiddenProvenance)
    ? manifest.oraclePolicy.forbiddenProvenance
    : [];
  const allowedProvenance = new Set(allowedProvenanceValues);
  if (allowedProvenance.size !== SAFE_ORACLE_PROVENANCE.size
      || [...SAFE_ORACLE_PROVENANCE].some(kind => !allowedProvenance.has(kind))
      || FORBIDDEN_ORACLE_PROVENANCE.some(kind => !forbiddenProvenanceValues.includes(kind))) {
    problems.push('manifest oracle provenance policy is not independent');
  }
  if (manifest.oraclePolicy?.modelConfidenceIsOracle !== false
      || manifest.oraclePolicy?.groundingStatusIsSemanticOracle !== false) {
    problems.push('model self-report cannot be an oracle');
  }

  const sources = isObject(manifest.sources) ? manifest.sources : {};
  if (Object.keys(sources).length === 0) problems.push('manifest sources must be non-empty');
  const registeredProviders = new Set();
  for (const [sourceId, source] of Object.entries(sources)) {
    const label = 'source ' + sourceId;
    if (!isObject(source)) {
      problems.push(label + ' is not parseable');
      continue;
    }
    if (source.kind !== 'record'
        && (typeof source.repoId !== 'string' || source.repoId.length === 0)) {
      problems.push(label + ' is missing repoId');
    }
    if (source.kind === 'repository') {
      if (!GIT_SHA_PATTERN.test(source.gitSha ?? '')
          || !SHA256_PATTERN.test(source.dirtyTreeSha256 ?? '')) {
        problems.push(label + ' is missing repository hash pins');
      }
      continue;
    }
    if (source.kind === 'record') {
      await readPinned(source.path, source.sha256, label + ' record', context);
      continue;
    }
    if (source.kind !== 'fixture') {
      problems.push(label + ' has an invalid kind');
      continue;
    }
    if (!isSafeRelativePath(source.root)
        || !isSafeRelativePath(source.repoPath)
        || source.repoPath !== source.root + '/repo'
        || !isSafeRelativePath(source.providerPath)
        || !source.providerPath.startsWith(source.root + '/')) {
      problems.push(label + ' has an invalid fixture boundary');
    }
    if (!SHA256_PATTERN.test(source.repoTreeSha256 ?? '')) {
      problems.push(label + ' is missing a fixture-tree hash pin');
    } else if (isSafeRelativePath(source.repoPath)) {
      try {
        if (await fixtureTreeSha256(projectPath(source.repoPath), context.readFile)
            !== source.repoTreeSha256) {
          problems.push(label + ' fixture-tree hash does not match');
        }
      } catch (error) {
        problems.push(label + ' fixture tree cannot be read: ' + error.message);
      }
    }
    registeredProviders.add(source.providerPath);
    const provider = await readPinned(
      source.providerPath,
      source.providerSha256,
      label + ' provider',
      context,
      true,
    );
    if (provider) validateProvider(provider, label + ' provider', problems);
  }

  for (const [kind, definitions] of [
    ['baseline', manifest.baselines],
    ['observation', manifest.observations],
  ]) {
    for (const [id, definition] of Object.entries(isObject(definitions) ? definitions : {})) {
      const label = kind + ' ' + id;
      if (!isObject(definition)) {
        problems.push(label + ' is not parseable');
        continue;
      }
      const artifact = await readPinned(
        definition.artifact,
        definition.artifactSha256,
        label,
        context,
        true,
      );
      if (isObject(artifact) && Object.hasOwn(artifact, 'oracle')) {
        problems.push(label + ' embeds a model-authored oracle');
      }
    }
  }

  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  if (cases.length === 0) problems.push('manifest cases must be a non-empty array');
  const caseIds = new Set();
  const caseById = new Map();
  const provenanceBySourceKind = {
    fixture: 'fixture_assertion',
    repository: 'source_review',
    record: 'external_record',
  };
  for (const caseDefinition of cases) {
    if (!isObject(caseDefinition)) {
      problems.push('case entry is not parseable');
      continue;
    }
    const label = 'case ' + String(caseDefinition.id ?? '<missing>');
    if (typeof caseDefinition.id !== 'string' || caseIds.has(caseDefinition.id)) {
      problems.push(label + ' has an invalid or duplicate id');
    }
    caseIds.add(caseDefinition.id);
    if (typeof caseDefinition.id === 'string' && !caseById.has(caseDefinition.id)) {
      caseById.set(caseDefinition.id, caseDefinition);
    }
    if (!['observed', 'fixture', 'goal_audit'].includes(caseDefinition.kind)
        || !Number.isInteger(caseDefinition.repeatCount)
        || caseDefinition.repeatCount < 1) {
      problems.push(label + ' has an invalid case shape');
    }
    const source = sources[caseDefinition.sourceRef];
    const request = caseDefinition.request;
    const oracle = caseDefinition.oracle;
    const boundary = oracle?.boundary;
    const liveRepositoryCase = source?.kind === 'repository' && !oracle?.transportExpectation;
    if (!isObject(source) || !isObject(request) || !isObject(oracle) || !isObject(boundary)) {
      problems.push(label + ' has an unparseable source, request, oracle, or boundary');
      continue;
    }

    if (source.kind === 'repository' && !oracle.transportExpectation) {
      const livePolicy = caseDefinition.livePolicy;
      if (!isObject(livePolicy)
          || Object.keys(livePolicy).length !== 1
          || livePolicy.profile !== LIVE_TRUST_EVALUATION_PROFILE) {
        problems.push(label + ' has an invalid live evaluation policy');
      }
    } else if (caseDefinition.livePolicy !== undefined) {
      problems.push(label + ' has a live evaluation policy on a non-live source');
    }

    const provenance = oracle.provenance;
    if (!SAFE_ORACLE_PROVENANCE.has(provenance?.kind)
        || provenance?.sourceRef !== caseDefinition.sourceRef
        || provenance?.kind !== provenanceBySourceKind[source.kind]) {
      problems.push(label + ' oracle is not independently authored');
    }
    const allowedClaims = Array.isArray(oracle.allowedClaims) ? oracle.allowedClaims : [];
    const forbiddenClaims = Array.isArray(oracle.forbiddenClaims) ? oracle.forbiddenClaims : [];
    const anchors = Array.isArray(oracle.evidenceAnchors) ? oracle.evidenceAnchors : [];
    if (!ORACLE_STATES.has(oracle.expectedState)
        || !Array.isArray(oracle.allowedClaims)
        || !Array.isArray(oracle.forbiddenClaims)
        || anchors.length === 0) {
      problems.push(label + ' is missing required oracle fields');
    }
    const parts = Array.isArray(request.parts) ? request.parts : [];
    const partIds = new Set(parts.map(part => part?.id));
    const goals = Array.isArray(oracle.expectedGoals) ? oracle.expectedGoals : [];
    if (typeof request.text !== 'string'
        || parts.length === 0
        || parts.some(part => !isObject(part)
          || typeof part.id !== 'string'
          || typeof part.text !== 'string')
        || partIds.size !== parts.length
        || goals.length === 0) {
      problems.push(label + ' is missing request parts or expected goals');
    }
    const goalIds = new Set();
    const coveredParts = new Set();
    const referencedAnchors = new Set();
    const goalResolutions = [];
    for (const goal of goals) {
      if (!isObject(goal)
          || typeof goal.id !== 'string'
          || typeof goal.question !== 'string'
          || !ORACLE_CLAIM_TYPES.has(goal.claimType)
          || !ORACLE_RESOLUTIONS.has(goal.expectedResolution)
          || !['any', 'all'].includes(goal.anchorPolicy)
          || goalIds.has(goal.id)) {
        problems.push(label + ' has an invalid or duplicate expected goal');
        continue;
      }
      goalIds.add(goal.id);
      goalResolutions.push(goal.expectedResolution);
      const originRefs = Array.isArray(goal.originRefs) ? goal.originRefs : [];
      if (originRefs.length === 0 || originRefs.some(ref => !partIds.has(ref))) {
        problems.push(label + ' goal ' + goal.id + ' has invalid origin refs');
      }
      if (liveRepositoryCase && goal.requestOriginRefs === undefined) {
        problems.push(label + ' live goal ' + goal.id + ' lacks request-origin refs');
      }
      if (goal.requestOriginRefs !== undefined) {
        const requestOriginRefs = Array.isArray(goal.requestOriginRefs)
          ? goal.requestOriginRefs
          : [];
        if (requestOriginRefs.length === 0
            || new Set(requestOriginRefs).size !== requestOriginRefs.length
            || requestOriginRefs.some(ref => !isValidRequestOriginRef(ref, request.text))) {
          problems.push(label + ' goal ' + goal.id + ' has invalid request-origin refs');
        }
      }
      for (const ref of originRefs) coveredParts.add(ref);
      const evidenceAnchorRefs = Array.isArray(goal.evidenceAnchorRefs)
        ? goal.evidenceAnchorRefs
        : [];
      if (evidenceAnchorRefs.length === 0) {
        problems.push(label + ' goal ' + goal.id + ' has no evidence anchors');
      }
      for (const ref of evidenceAnchorRefs) referencedAnchors.add(ref);
    }
    for (const partId of partIds) {
      if (!coveredParts.has(partId)) problems.push(label + ' request part ' + partId + ' has no goal');
    }
    const claimIds = new Set();
    for (const claim of allowedClaims) {
      const evidenceAnchorRefs = Array.isArray(claim?.evidenceAnchorRefs)
        ? claim.evidenceAnchorRefs
        : [];
      const requiredTextGroups = claim?.requiredTextGroups;
      const invalidRequiredTextGroups = requiredTextGroups !== undefined &&
        (!Array.isArray(requiredTextGroups) || requiredTextGroups.length === 0 ||
          requiredTextGroups.some(group => !Array.isArray(group) || group.length === 0 ||
            group.some(token => typeof token !== 'string' || !token.trim())));
      const invalidRequiredTextAssociations =
        !validRequiredTextAssociations(claim?.requiredTextAssociations);
      if (!isObject(claim)
          || typeof claim.id !== 'string'
          || typeof claim.text !== 'string'
          || claimIds.has(claim.id)
          || !goalIds.has(claim.goalId)
          || evidenceAnchorRefs.length === 0
          || invalidRequiredTextGroups
          || invalidRequiredTextAssociations) {
        problems.push(label + ' allowed claim has an unknown goal or invalid shape');
      }
      if (typeof claim?.id === 'string') claimIds.add(claim.id);
      for (const ref of evidenceAnchorRefs) referencedAnchors.add(ref);
    }
    for (const claim of forbiddenClaims) {
      if (!isObject(claim)
          || typeof claim.id !== 'string'
          || typeof claim.text !== 'string'
          || typeof claim.reason !== 'string'
          || claimIds.has(claim.id)
          || (claim.goalId !== undefined && !goalIds.has(claim.goalId))) {
        problems.push(label + ' forbidden claim has an invalid shape');
      }
      if (typeof claim?.id === 'string') claimIds.add(claim.id);
    }
    if ((oracle.expectedState === 'complete'
        && goalResolutions.some(resolution => ['gap', 'failed'].includes(resolution)))
        || (oracle.expectedState === 'incomplete'
          && (!goalResolutions.includes('gap') || goalResolutions.includes('failed')))
        || (oracle.expectedState === 'failed' && !goalResolutions.includes('failed'))) {
      problems.push(label + ' expected state contradicts goal resolutions');
    }
    if (oracle.expectedFailure !== undefined
        && (!isObject(oracle.expectedFailure)
          || !ORACLE_FAILURE_CATEGORIES.has(oracle.expectedFailure.category)
          || !ORACLE_FAILURE_REASONS.has(oracle.expectedFailure.reason)
          || oracle.expectedState !== 'failed')) {
      problems.push(label + ' has an invalid expected failure oracle');
    }
    if (oracle.expectedSafetyLimits !== undefined) {
      const limits = Array.isArray(oracle.expectedSafetyLimits)
        ? oracle.expectedSafetyLimits
        : [];
      const limitKeys = new Set();
      if (limits.length === 0 || limits.some(limit => {
        const key = `${limit?.name}:${limit?.stage}:${limit?.truncated}`;
        const invalid = !isObject(limit)
          || Object.keys(limit).length !== 3
          || !ORACLE_SAFETY_LIMIT_NAMES.has(limit.name)
          || !ORACLE_SAFETY_LIMIT_STAGES.has(limit.stage)
          || typeof limit.truncated !== 'boolean'
          || limitKeys.has(key);
        limitKeys.add(key);
        return invalid;
      })) {
        problems.push(label + ' has an invalid expected safety-limit oracle');
      }
    }

    const scope = Array.isArray(boundary.scope) ? boundary.scope : [];
    const claimScope = Array.isArray(boundary.claimScope) ? boundary.claimScope : [];
    if (typeof boundary.repoId !== 'string'
        || boundary.repoId.length === 0
        || boundary.repoId !== source.repoId
        || scope.length === 0
        || scope.some(entry => !isSafeScope(entry))
        || !sameStringSet(scope, claimScope)) {
      problems.push(label + ' has an invalid repository boundary');
    }
    if (caseDefinition.invocation?.tool !== 'explore_repo'
        || caseDefinition.invocation?.args?.task !== request.text
        || !sameStringSet(caseDefinition.invocation?.args?.scope, scope)) {
      problems.push(label + ' invocation crosses the oracle boundary');
    }

    const anchorIds = new Set();
    for (const anchor of anchors) {
      if (!isObject(anchor)
          || typeof anchor.id !== 'string'
          || anchorIds.has(anchor.id)
          || !['source', 'search', 'git_commit'].includes(anchor.kind)) {
        problems.push(label + ' has an invalid evidence boundary');
        continue;
      }
      anchorIds.add(anchor.id);

      if (anchor.kind === 'source') {
        if (!isSafeRelativePath(anchor.path)
            || !pathInScope(anchor.path, claimScope)
            || !Number.isInteger(anchor.startLine)
            || !Number.isInteger(anchor.endLine)
            || anchor.startLine < 1
            || anchor.endLine < anchor.startLine
            || !ORACLE_SOURCE_ROLES.has(anchor.sourceRole)
            || !ORACLE_TEMPORAL_ROLES.has(anchor.temporalRole)
            || anchor.sha !== undefined
            || anchor.boundary !== undefined
            || anchor.tool !== undefined) {
          problems.push(label + ' has an invalid evidence boundary: source');
          continue;
        }
      } else if (anchor.kind === 'search') {
        if (typeof anchor.tool !== 'string' || !anchor.tool
            || !sameStringSet(anchor.boundary, claimScope)
            || !isNonNegativeInteger(anchor.matchCount)
            || typeof anchor.toolTruncated !== 'boolean'
            || typeof anchor.contextTruncated !== 'boolean'
            || !isNonNegativeInteger(anchor.omittedOutOfScopeFiles)
            || !isNonNegativeInteger(anchor.deniedPaths)
            || !isNonNegativeInteger(anchor.errors)
            || typeof anchor.enumerationComplete !== 'boolean'
            || anchor.path !== undefined
            || anchor.startLine !== undefined
            || anchor.endLine !== undefined
            || anchor.sha !== undefined
            || anchor.sourceRole !== undefined
            || anchor.temporalRole !== undefined) {
          problems.push(label + ' has an invalid evidence boundary: search');
        }
        continue;
      } else {
        if (!GIT_SHA_PATTERN.test(anchor.sha ?? '')
            || anchor.temporalRole !== 'historical'
            || anchor.path !== undefined
            || anchor.startLine !== undefined
            || anchor.endLine !== undefined
            || anchor.boundary !== undefined
            || anchor.tool !== undefined
            || anchor.sourceRole !== undefined) {
          problems.push(label + ' has an invalid evidence boundary: git_commit');
        }
        continue;
      }

      if (source.kind === 'fixture') {
        try {
          const raw = normalizeLfBytes(await context.readFile(
            projectPath(source.repoPath + '/' + anchor.path),
          ));
          const text = raw.toString('utf8');
          const lineCount = text.length === 0
            ? 0
            : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
          if (anchor.endLine > lineCount) problems.push(label + ' evidence range exceeds fixture');
        } catch (error) {
          problems.push(label + ' evidence file cannot be read: ' + error.code);
        }
      }
    }

    if (caseDefinition.fixtureSetup !== undefined) {
      const setup = caseDefinition.fixtureSetup;
      const setupKeys = isObject(setup) ? Object.keys(setup).sort() : [];
      if (!isObject(setup)
          || setup.kind !== 'deterministic_git_commit'
          || !sameStringSet(setupKeys, [
            'date', 'email', 'headSha', 'kind', 'message', 'name',
          ])
          || typeof setup.message !== 'string' || !setup.message
          || typeof setup.name !== 'string' || !setup.name
          || typeof setup.email !== 'string' || !setup.email
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(setup.date ?? '')
          || !GIT_SHA_PATTERN.test(setup.headSha ?? '')
          || !anchors.some(anchor =>
            anchor.kind === 'git_commit' && anchor.sha === setup.headSha)) {
        problems.push(label + ' has an invalid deterministic Git fixture setup');
      }
    }
    for (const ref of referencedAnchors) {
      if (!anchorIds.has(ref)) problems.push(label + ' has a dangling evidence anchor ref');
    }

    const baseline = caseDefinition.schemaV2Baseline;
    if (!isObject(baseline)
        || (baseline.baselineRef && !isObject(manifest.baselines?.[baseline.baselineRef]))
        || (!baseline.baselineRef && (baseline.outcome !== 'not_recorded'
          || baseline.schemaVersion !== 2
          || typeof baseline.reason !== 'string'
          || baseline.reason.length === 0))) {
      problems.push(label + ' has an unparseable schema-v2 baseline reference');
    }
    if (caseDefinition.knownBadObservationRef
        && !isObject(manifest.observations?.[caseDefinition.knownBadObservationRef])) {
      problems.push(label + ' has an unparseable observation reference');
    }
    if (caseDefinition.providerFixture) {
      const fixture = caseDefinition.providerFixture;
      if (!isSafeRelativePath(fixture.path)
          || !fixture.path.startsWith(source.root + '/')) {
        problems.push(label + ' provider fixture crosses its source boundary');
      }
      registeredProviders.add(fixture.path);
      const provider = await readPinned(
        fixture.path,
        fixture.sha256,
        label + ' provider fixture',
        context,
        true,
      );
      if (provider) validateProvider(provider, label + ' provider fixture', problems);
    }
  }

  const us1Subset = manifest.fixtureSubsets?.US1;
  if (!isObject(manifest.fixtureSubsets)
      || !Array.isArray(us1Subset)
      || us1Subset.length === 0
      || new Set(us1Subset).size !== us1Subset.length
      || us1Subset.some(id => typeof id !== 'string' || id.length === 0)) {
    problems.push('US1 fixture subset must contain unique case ids');
  } else {
    if (!sameStringSet(us1Subset, EXPECTED_US1_FIXTURE_IDS)) {
      problems.push('US1 fixture subset does not match the required scenario ids');
    }
    for (const caseId of us1Subset) {
      const caseDefinition = caseById.get(caseId);
      const source = sources[caseDefinition?.sourceRef];
      if (!caseDefinition) {
        problems.push('US1 fixture subset references unknown case ' + caseId);
        continue;
      }
      if (source?.kind !== 'fixture'
          || caseDefinition.fixtureExecution !== 'direct'
          || caseDefinition.repeatCount !== 3) {
        problems.push('US1 fixture case ' + caseId + ' is not a direct three-run fixture');
      }
      if (caseDefinition.oracle?.expectedGoals?.some(goal =>
        !Array.isArray(goal.requestOriginRefs) || goal.requestOriginRefs.length === 0)) {
        problems.push('US1 fixture case ' + caseId + ' lacks request-origin oracles');
      }
      if (caseDefinition.oracle?.expectedState === 'failed'
          && !isObject(caseDefinition.oracle.expectedFailure)) {
        problems.push('US1 fixture case ' + caseId + ' lacks a failure oracle');
      }
      const providerPath = caseDefinition.providerFixture?.path ?? source?.providerPath;
      const providerSha256 = caseDefinition.providerFixture?.sha256 ?? source?.providerSha256;
      if (!isSafeRelativePath(providerPath) || !SHA256_PATTERN.test(providerSha256 ?? '')) {
        problems.push('US1 fixture case ' + caseId + ' lacks a pinned provider sequence');
      }
    }
  }

  const us5Subset = manifest.fixtureSubsets?.US5;
  if (!Array.isArray(us5Subset)
      || us5Subset.length === 0
      || new Set(us5Subset).size !== us5Subset.length
      || us5Subset.some(id => typeof id !== 'string' || id.length === 0)) {
    problems.push('US5 fixture subset must contain unique case ids');
  } else {
    if (!sameStringSet(us5Subset, EXPECTED_US5_FIXTURE_IDS)) {
      problems.push('US5 fixture subset does not match the required scenario ids');
    }
    for (const caseId of us5Subset) {
      const caseDefinition = caseById.get(caseId);
      const source = sources[caseDefinition?.sourceRef];
      if (!caseDefinition) {
        problems.push('US5 fixture subset references unknown case ' + caseId);
        continue;
      }
      if (source?.kind !== 'fixture' || caseDefinition.fixtureExecution !== 'direct') {
        problems.push('US5 fixture case ' + caseId + ' is not a direct fixture');
      }
      const providerPath = caseDefinition.providerFixture?.path ?? source?.providerPath;
      const providerSha256 = caseDefinition.providerFixture?.sha256 ?? source?.providerSha256;
      if (!isSafeRelativePath(providerPath) || !SHA256_PATTERN.test(providerSha256 ?? '')) {
        problems.push('US5 fixture case ' + caseId + ' lacks a pinned provider sequence');
      }
    }
  }

  await validatePortableOfflineResults(manifest, {
    cases,
    caseById,
    sources,
    context,
  });

  try {
    const fixtureFiles = await walkRegularFiles(projectPath('fixtures/trust-known-answer'));
    const actualProviders = new Set(fixtureFiles
      .filter(file => /^provider-responses.*\.json$/.test(path.basename(file.relativePath)))
      .map(file => 'fixtures/trust-known-answer/' + file.relativePath));
    for (const providerPath of actualProviders) {
      if (!registeredProviders.has(providerPath)) problems.push('unregistered provider: ' + providerPath);
    }
    for (const providerPath of registeredProviders) {
      if (!actualProviders.has(providerPath)) problems.push('missing provider: ' + providerPath);
    }
  } catch (error) {
    problems.push('provider inventory cannot be read: ' + error.message);
  }
  return problems;
}

async function assertTrustManifestIntegrity(manifest, options) {
  let problems;
  try {
    problems = await collectTrustManifestProblems(manifest, options);
  } catch (cause) {
    problems = ['validator could not parse manifest: ' + cause.message];
  }
  if (problems.length === 0) return;
  const error = new Error('Trust manifest integrity failed:\n- ' + problems.join('\n- '));
  error.code = 'INVALID_TRUST_MANIFEST';
  error.problems = problems;
  throw error;
}

async function expectIntegrityProblem(manifest, expectedProblem, options) {
  await assert.rejects(assertTrustManifestIntegrity(manifest, options), error => {
    assert.equal(error.code, 'INVALID_TRUST_MANIFEST');
    assert.equal(
      error.problems.some(problem => problem.includes(expectedProblem)),
      true,
      'expected problem containing: ' + expectedProblem + '\n' + error.message,
    );
    return true;
  });
}

function readFileWithReplacement(relativePath, replacement) {
  const target = path.resolve(projectPath(relativePath));
  const bytes = Buffer.isBuffer(replacement) ? replacement : Buffer.from(replacement);
  return async filePath => path.resolve(filePath) === target ? bytes : fs.readFile(filePath);
}

test('trust manifest and all registered fixtures pass independent integrity validation', async () => {
  assert.deepEqual(await collectTrustManifestProblems(await loadTrustManifest()), []);
});

test('Spec 028 T068 — portable parent record binds actual-harness fields without raw traces', async () => {
  const manifest = await loadTrustManifest();
  const record = recordedParentObservationControl(
    manifest.offlineResults.parentObservation,
  );
  assert.deepEqual(Object.keys(record.cases[0]), [
    'id', 'repoId', 'sourcePin', 'promptSha256', 'handoffSha256', 'traceSha256',
    'observed', 'noBroad', 'broadActionCount', 'allowance', 'violations',
  ]);
  assert.equal(record.metrics.passed, undefined);
  assert.equal(record.metrics.passThreshold, undefined);
  manifest.offlineResults.parentObservation = record;
  assert.deepEqual(await collectTrustManifestProblems(manifest), []);
});

test('Spec 028 T068 — portable results fail closed on self-reporting, omissions, and denominator drift', async t => {
  const canonical = await loadTrustManifest();
  const mutations = [
    ['missing result block', 'invalid top-level shape', manifest => {
      delete manifest.offlineResults;
    }],
    ['self-reported pass', 'machine-local or self-reported fields', manifest => {
      manifest.offlineResults.passed = true;
    }],
    ['fixture omission', 'do not cover every direct fixture', manifest => {
      manifest.offlineResults.fixtureTrust.acceptedCaseIds.pop();
    }],
    ['pending actual parent harness', 'pending the actual harness', manifest => {
      const record = manifest.offlineResults.parentObservation;
      record.profile = PORTABLE_PARENT_OBSERVATION_PROFILE;
      record.status = PORTABLE_PARENT_OBSERVATION_PENDING;
      record.reportSha256 = null;
      record.metrics = null;
      record.cases = [];
    }],
    ['broad parent research', 'misses the no-broad-research gate', manifest => {
      const record = recordedParentObservationControl(
        manifest.offlineResults.parentObservation,
      );
      for (const item of record.cases.slice(0, 2)) {
        item.noBroad = false;
        item.broadActionCount = 1;
        item.violations = ['repository_wide_search'];
      }
      record.metrics = portableParentMetrics(record.cases);
      manifest.offlineResults.parentObservation = record;
    }],
    ['parent source pin substitution', 'source pins or handoff hashes do not match', manifest => {
      manifest.offlineResults.parentObservation.sourcePins[0].handoffSha256 = '0'.repeat(64);
    }],
    ['parent case hash substitution', 'case obs-deny-list-count-range is invalid', manifest => {
      const record = recordedParentObservationControl(
        manifest.offlineResults.parentObservation,
      );
      record.cases[0].promptSha256 = '0'.repeat(64);
      manifest.offlineResults.parentObservation = record;
    }],
    ['wrapper substitution', 'do not match the six proof policies', manifest => {
      manifest.offlineResults.wrapperAcceptances[0].proofPolicy = 'generic';
    }],
    ['payload cherry-pick', 'invalid denominator or metric', manifest => {
      manifest.offlineResults.payloadComparison.samples.pop();
    }],
    ['payload regression', 'sample obs-deny-list-count-range is invalid', manifest => {
      manifest.offlineResults.payloadComparison.samples[0].currentParentPayloadBytes = 4594;
    }],
    ['criterion omission', 'every SC-001 through SC-016', manifest => {
      delete manifest.offlineResults.criteria['SC-016'];
    }],
  ];
  for (const [name, expected, mutate] of mutations) {
    await t.test(name, async () => {
      const manifest = structuredClone(canonical);
      mutate(manifest);
      await expectIntegrityProblem(manifest, expected);
    });
  }
});

test('Spec 028 T068 — manifest requires the explicit live evaluation profile only on live cases', async () => {
  const missing = await loadTrustManifest();
  delete missing.cases.find(item => item.id === 'obs-deny-list-count-range').livePolicy;
  await expectIntegrityProblem(missing, 'invalid live evaluation policy');

  const unknown = await loadTrustManifest();
  unknown.cases.find(item => item.id === 'obs-deny-list-count-range').livePolicy.profile = 'relaxed';
  await expectIntegrityProblem(unknown, 'invalid live evaluation policy');

  const extra = await loadTrustManifest();
  extra.cases.find(item => item.id === 'obs-deny-list-count-range').livePolicy.allowFailure = true;
  await expectIntegrityProblem(extra, 'invalid live evaluation policy');

  const fixture = await loadTrustManifest();
  fixture.cases.find(item => item.id === 'fx-semantic-mismatch').livePolicy = {
    profile: LIVE_TRUST_EVALUATION_PROFILE,
  };
  await expectIntegrityProblem(fixture, 'live evaluation policy on a non-live source');

  const missingOrigins = await loadTrustManifest();
  delete missingOrigins.cases.find(item => item.id === 'obs-deny-list-count-range')
    .oracle.expectedGoals[0].requestOriginRefs;
  await expectIntegrityProblem(missingOrigins, 'live goal G1 lacks request-origin refs');
});

test('trust manifest integrity rejects invalid US1 fixture subset entries', async t => {
  const canonical = await loadTrustManifest();
  const mutations = [
    ['duplicate', 'unique case ids', manifest => {
      manifest.fixtureSubsets.US1.push(manifest.fixtureSubsets.US1[0]);
    }],
    ['unknown', 'references unknown case', manifest => {
      manifest.fixtureSubsets.US1[0] = 'missing-us1-case';
    }],
    ['scenario replacement', 'does not match the required scenario ids', manifest => {
      manifest.fixtureSubsets.US1[0] = 'fx-scope-limited-absence';
    }],
    ['partial', 'not a direct three-run fixture', manifest => {
      manifest.cases.find(item => item.id === 'fx-incomplete-multipart').fixtureExecution = 'partial';
    }],
    ['single run', 'not a direct three-run fixture', manifest => {
      manifest.cases.find(item => item.id === 'fx-cancellation').repeatCount = 1;
    }],
    ['missing request origin', 'lacks request-origin oracles', manifest => {
      delete manifest.cases.find(item => item.id === 'fx-semantic-mismatch')
        .oracle.expectedGoals[0].requestOriginRefs;
    }],
    ['missing failure oracle', 'lacks a failure oracle', manifest => {
      delete manifest.cases.find(item => item.id === 'fx-provider-failure')
        .oracle.expectedFailure;
    }],
  ];
  for (const [name, expected, mutate] of mutations) {
    await t.test(name, async () => {
      const manifest = structuredClone(canonical);
      mutate(manifest);
      await expectIntegrityProblem(manifest, expected);
    });
  }
});

test('Spec 028 T063 — trust manifest pins the exact US5 fixture subset', async t => {
  const canonical = await loadTrustManifest();
  assert.deepEqual(canonical.fixtureSubsets.US5, EXPECTED_US5_FIXTURE_IDS);
  const mutations = [
    ['duplicate', 'unique case ids', manifest => {
      manifest.fixtureSubsets.US5.push(manifest.fixtureSubsets.US5[0]);
    }],
    ['unknown', 'references unknown case', manifest => {
      manifest.fixtureSubsets.US5[0] = 'missing-us5-case';
    }],
    ['scenario replacement', 'does not match the required scenario ids', manifest => {
      manifest.fixtureSubsets.US5[0] = 'fx-supported-refutation';
    }],
  ];
  for (const [name, expected, mutate] of mutations) {
    await t.test(name, async () => {
      const manifest = structuredClone(canonical);
      mutate(manifest);
      await expectIntegrityProblem(manifest, expected);
    });
  }
});

test('Spec 028 T063 — evidence anchors are a strict source/search/git_commit union', async t => {
  const canonical = await loadTrustManifest();
  const mutations = [
    ['unknown kind', 'invalid evidence boundary', manifest => {
      manifest.cases.find(item => item.id === 'fx-route-policy-divergence')
        .oracle.evidenceAnchors[0].kind = 'model_assertion';
    }],
    ['source without range', 'invalid evidence boundary: source', manifest => {
      delete manifest.cases.find(item => item.id === 'fx-route-policy-divergence')
        .oracle.evidenceAnchors[0].startLine;
    }],
    ['search with fabricated path', 'invalid evidence boundary: search', manifest => {
      manifest.cases.find(item => item.id === 'fx-scoped-zero-match')
        .oracle.evidenceAnchors[0].path = 'src/in-scope/primary.mjs';
    }],
    ['search boundary mismatch', 'invalid evidence boundary: search', manifest => {
      manifest.cases.find(item => item.id === 'fx-scoped-zero-match')
        .oracle.evidenceAnchors[0].boundary = ['src/**'];
    }],
    ['git commit with fabricated path', 'invalid evidence boundary: git_commit', manifest => {
      manifest.cases.find(item => item.id === 'fx-historical-source-role')
        .oracle.evidenceAnchors[0].path = 'src/service.mjs';
    }],
    ['git commit with invalid sha', 'invalid evidence boundary: git_commit', manifest => {
      manifest.cases.find(item => item.id === 'fx-historical-source-role')
        .oracle.evidenceAnchors[0].sha = 'abc1234';
    }],
    ['Git setup pin mismatch', 'invalid deterministic Git fixture setup', manifest => {
      manifest.cases.find(item => item.id === 'fx-historical-source-role')
        .fixtureSetup.headSha = '0'.repeat(40);
    }],
  ];
  for (const [name, expected, mutate] of mutations) {
    await t.test(name, async () => {
      const manifest = structuredClone(canonical);
      mutate(manifest);
      await expectIntegrityProblem(manifest, expected);
    });
  }
});

test('trust manifest integrity rejects missing and mismatched pins', async t => {
  const mutations = [
    ['repository pins', 'missing repository hash pins', manifest => {
      delete manifest.sources['repo-lawfirm-fe7a5ca'].gitSha;
    }],
    ['fixture tree pin', 'missing a fixture-tree hash pin', manifest => {
      delete manifest.sources['fixture-semantic-mismatch'].repoTreeSha256;
    }],
    ['default provider pin', 'provider is missing a SHA-256 pin', manifest => {
      delete manifest.sources['fixture-semantic-mismatch'].providerSha256;
    }],
    ['record pin', 'record is missing a SHA-256 pin', manifest => {
      delete manifest.sources['research-record'].sha256;
    }],
    ['baseline pin', 'baseline v2-obs-deny-list-count-range is missing', manifest => {
      delete manifest.baselines['v2-obs-deny-list-count-range'].artifactSha256;
    }],
    ['observation pin', 'observation research-obs-external-process-inference is missing', manifest => {
      delete manifest.observations['research-obs-external-process-inference'].artifactSha256;
    }],
    ['provider override pin', 'provider fixture is missing a SHA-256 pin', manifest => {
      const caseDefinition = manifest.cases.find(item => item.id === 'fx-scope-limited-absence');
      delete caseDefinition.providerFixture.sha256;
    }],
    ['well-formed wrong pin', 'provider hash does not match', manifest => {
      manifest.sources['fixture-semantic-mismatch'].providerSha256 = '0'.repeat(64);
    }],
  ];
  const canonical = await loadTrustManifest();
  for (const [name, expected, mutate] of mutations) {
    await t.test(name, async () => {
      const manifest = structuredClone(canonical);
      mutate(manifest);
      await expectIntegrityProblem(manifest, expected);
    });
  }
});

test('trust manifest integrity rejects explorer-authored or embedded oracles', async t => {
  const canonical = await loadTrustManifest();
  for (const provenance of FORBIDDEN_ORACLE_PROVENANCE) {
    await t.test(provenance, async () => {
      const manifest = structuredClone(canonical);
      manifest.oraclePolicy.allowedProvenance.push(provenance);
      manifest.cases[0].oracle.provenance.kind = provenance;
      await expectIntegrityProblem(manifest, 'oracle is not independently authored');
    });
  }
  await t.test('provider-embedded oracle', async () => {
    const manifest = structuredClone(canonical);
    const source = manifest.sources['fixture-semantic-mismatch'];
    const provider = JSON.parse(await fs.readFile(projectPath(source.providerPath), 'utf8'));
    provider.oracle = { expectedState: 'complete' };
    const replacement = Buffer.from(JSON.stringify(provider));
    source.providerSha256 = canonicalSha256(replacement);
    await expectIntegrityProblem(
      manifest,
      'embeds a model-authored oracle',
      { readFile: readFileWithReplacement(source.providerPath, replacement) },
    );
  });
});

test('trust manifest integrity rejects invalid boundaries', async t => {
  const mutations = [
    ['wrong repo', 'invalid repository boundary', caseDefinition => {
      caseDefinition.oracle.boundary.repoId = 'different-repository';
    }],
    ['scope traversal', 'invalid repository boundary', caseDefinition => {
      caseDefinition.oracle.boundary.scope = ['../escape/**'];
      caseDefinition.oracle.boundary.claimScope = ['../escape/**'];
      caseDefinition.invocation.args.scope = ['../escape/**'];
    }],
    ['unsupported wildcard', 'invalid repository boundary', caseDefinition => {
      caseDefinition.oracle.boundary.scope = ['src/?.mjs'];
      caseDefinition.oracle.boundary.claimScope = ['src/?.mjs'];
      caseDefinition.invocation.args.scope = ['src/?.mjs'];
    }],
    ['non-string scope', 'invalid repository boundary', caseDefinition => {
      caseDefinition.oracle.boundary.scope = [1];
      caseDefinition.oracle.boundary.claimScope = [1];
      caseDefinition.invocation.args.scope = [1];
    }],
    ['claim scope expansion', 'invalid repository boundary', caseDefinition => {
      caseDefinition.oracle.boundary.claimScope = ['src/outside/**'];
    }],
    ['anchor escape', 'invalid evidence boundary', caseDefinition => {
      caseDefinition.oracle.evidenceAnchors[0].path = 'src/outside.mjs';
    }],
    ['invalid line range', 'evidence range exceeds fixture', caseDefinition => {
      caseDefinition.oracle.evidenceAnchors[0].endLine = 999;
    }],
    ['invocation drift', 'invocation crosses the oracle boundary', caseDefinition => {
      caseDefinition.invocation.args.scope = ['src/**'];
    }],
  ];
  const canonical = await loadTrustManifest();
  for (const [name, expected, mutate] of mutations) {
    await t.test(name, async () => {
      const manifest = structuredClone(canonical);
      mutate(manifest.cases.find(item => item.id === 'fx-semantic-mismatch'));
      await expectIntegrityProblem(manifest, expected);
    });
  }
  await t.test('missing source and boundary repoId', async () => {
    const manifest = structuredClone(canonical);
    delete manifest.sources['fixture-semantic-mismatch'].repoId;
    delete manifest.cases
      .find(item => item.id === 'fx-semantic-mismatch').oracle.boundary.repoId;
    await expectIntegrityProblem(manifest, 'source fixture-semantic-mismatch is missing repoId');
  });
});

test('trust manifest integrity rejects missing goals and dangling references', async t => {
  const mutations = [
    ['empty expected goals', 'missing request parts or expected goals', caseDefinition => {
      caseDefinition.oracle.expectedGoals = [];
    }],
    ['missing expected state', 'missing required oracle fields', caseDefinition => {
      delete caseDefinition.oracle.expectedState;
    }],
    ['missing claim type', 'invalid or duplicate expected goal', caseDefinition => {
      delete caseDefinition.oracle.expectedGoals[0].claimType;
    }],
    ['missing expected resolution', 'invalid or duplicate expected goal', caseDefinition => {
      delete caseDefinition.oracle.expectedGoals[0].expectedResolution;
    }],
    ['missing allowed claims', 'missing required oracle fields', caseDefinition => {
      delete caseDefinition.oracle.allowedClaims;
    }],
    ['missing forbidden claims', 'missing required oracle fields', caseDefinition => {
      delete caseDefinition.oracle.forbiddenClaims;
    }],
    ['unknown request origin', 'has invalid origin refs', caseDefinition => {
      caseDefinition.oracle.expectedGoals[0].originRefs = ['P999'];
    }],
    ['non-array request origins', 'has invalid origin refs', caseDefinition => {
      caseDefinition.oracle.expectedGoals[0].originRefs = {};
    }],
    ['uncovered request part', 'request part P2 has no goal', caseDefinition => {
      for (const goal of caseDefinition.oracle.expectedGoals) {
        goal.originRefs = goal.originRefs.filter(ref => ref !== 'P2');
      }
    }],
    ['dangling anchor', 'dangling evidence anchor ref', caseDefinition => {
      caseDefinition.oracle.expectedGoals[0].evidenceAnchorRefs = ['E999'];
    }],
    ['allowed claim without anchors', 'allowed claim has an unknown goal or invalid shape', caseDefinition => {
      delete caseDefinition.oracle.allowedClaims[0].evidenceAnchorRefs;
    }],
    ['invalid allowed claim semantic groups', 'allowed claim has an unknown goal or invalid shape', caseDefinition => {
      caseDefinition.oracle.allowedClaims[0].requiredTextGroups = [['']];
    }],
    ['invalid allowed claim semantic association', 'allowed claim has an unknown goal or invalid shape', caseDefinition => {
      caseDefinition.oracle.allowedClaims[0].requiredTextAssociations = [{
        id: 'route-policy',
        subjectAlternatives: ['route'],
        predicateGroups: [[]],
      }];
    }],
    ['duplicate claim id', 'allowed claim has an unknown goal or invalid shape', caseDefinition => {
      caseDefinition.oracle.allowedClaims[1].id = 'A1';
    }],
    ['forbidden claim with unknown goal', 'forbidden claim has an invalid shape', caseDefinition => {
      caseDefinition.oracle.forbiddenClaims[0].goalId = 'G999';
    }],
    ['complete state with gap goal', 'expected state contradicts goal resolutions', caseDefinition => {
      caseDefinition.oracle.expectedGoals[0].expectedResolution = 'gap';
    }],
    ['duplicate goal id', 'invalid or duplicate expected goal', caseDefinition => {
      caseDefinition.oracle.expectedGoals[1].id = 'G1';
    }],
  ];
  const canonical = await loadTrustManifest();
  for (const [name, expected, mutate] of mutations) {
    await t.test(name, async () => {
      const manifest = structuredClone(canonical);
      mutate(manifest.cases.find(item => item.id === 'obs-deny-list-count-range'));
      await expectIntegrityProblem(manifest, expected);
    });
  }
});

test('trust manifest integrity rejects unparseable cases and provider documents', async t => {
  assert.throws(
    () => parseTrustManifest('{"cases": ['),
    error => error.code === 'INVALID_TRUST_MANIFEST'
      && error.problems.includes('manifest is not valid JSON'),
  );
  const canonical = await loadTrustManifest();
  await t.test('null case', async () => {
    const manifest = structuredClone(canonical);
    manifest.cases[0] = null;
    await expectIntegrityProblem(manifest, 'case entry is not parseable');
  });
  await t.test('invalid case request', async () => {
    const manifest = structuredClone(canonical);
    manifest.cases[0].request = '{not-an-object}';
    await expectIntegrityProblem(manifest, 'unparseable source, request, oracle, or boundary');
  });
  await t.test('non-array provenance policy', async () => {
    const manifest = structuredClone(canonical);
    manifest.oraclePolicy.allowedProvenance = {};
    manifest.oraclePolicy.forbiddenProvenance = {};
    await expectIntegrityProblem(manifest, 'oracle provenance policy is not independent');
  });
  await t.test('non-array allowed claims', async () => {
    const manifest = structuredClone(canonical);
    manifest.cases[0].oracle.allowedClaims = {};
    await expectIntegrityProblem(manifest, 'missing required oracle fields');
  });
  await t.test('malformed provider JSON', async () => {
    const manifest = structuredClone(canonical);
    const source = manifest.sources['fixture-semantic-mismatch'];
    const replacement = Buffer.from('{"fixtureVersion":');
    source.providerSha256 = canonicalSha256(replacement);
    await expectIntegrityProblem(
      manifest,
      'provider is not valid JSON',
      { readFile: readFileWithReplacement(source.providerPath, replacement) },
    );
  });
  await t.test('ambiguous provider response', async () => {
    const manifest = structuredClone(canonical);
    const source = manifest.sources['fixture-semantic-mismatch'];
    const provider = JSON.parse(await fs.readFile(projectPath(source.providerPath), 'utf8'));
    delete provider.responses[0].result;
    const replacement = Buffer.from(JSON.stringify(provider));
    source.providerSha256 = canonicalSha256(replacement);
    await expectIntegrityProblem(
      manifest,
      'response 0 is not parseable',
      { readFile: readFileWithReplacement(source.providerPath, replacement) },
    );
  });
  await t.test('provider result without content and toolCalls', async () => {
    const manifest = structuredClone(canonical);
    const source = manifest.sources['fixture-semantic-mismatch'];
    const provider = JSON.parse(await fs.readFile(projectPath(source.providerPath), 'utf8'));
    provider.responses[0].result.message = {};
    const replacement = Buffer.from(JSON.stringify(provider));
    source.providerSha256 = canonicalSha256(replacement);
    await expectIntegrityProblem(
      manifest,
      'response 0 has an invalid result message',
      { readFile: readFileWithReplacement(source.providerPath, replacement) },
    );
  });
});

function knownBadViolationKeys(evaluation) {
  return evaluation.violations.map(violation =>
    violation.goalId ? violation.code + ':' + violation.goalId : violation.code
  );
}

function buildCorrectedArtifact(caseDefinition, knownBadArtifact) {
  if (knownBadArtifact.transport && !knownBadArtifact.parentPayload) {
    return {
      transport: {
        ...knownBadArtifact.transport,
        abortObserved: true,
        outcome: 'aborted',
      },
    };
  }

  const expectedState = caseDefinition.oracle.expectedState;
  const directAnswer = caseDefinition.oracle.allowedClaims
    .map(claim => claim.text)
    .join(' ') || 'The requested conclusion remains unresolved.';
  return {
    parentPayload: {
      content: [{ type: 'text', text: directAnswer }],
      structuredContent: {
        schemaVersion: 2,
        directAnswer,
        status: {
          confidence: 'high',
          verification: expectedState === 'complete' ? 'verified' : 'follow_up_needed',
          complete: expectedState === 'complete',
          warnings: [],
        },
        evidence: caseDefinition.oracle.evidenceAnchors.map(anchor => ({
          id: anchor.id,
          path: anchor.path,
          startLine: anchor.startLine,
          endLine: anchor.endLine,
          why: 'Independent corrected control.',
          evidenceType: 'file_range',
          groundingStatus: 'exact',
        })),
        failure: expectedState === 'failed' ? { reason: 'aborted' } : null,
      },
    },
  };
}

test('known-bad artifact registry is set-equal, immutable, and hash-pinned', async () => {
  const { manifest, entries } = await loadKnownBadEntries();
  const registeredFiles = entries
    .map(entry => entry.definition.artifact.split('/').at(-1))
    .sort();
  const directoryFiles = (await fs.readdir(BASELINE_RESULTS_URL))
    .filter(name => name.endsWith('.json'))
    .sort();

  assert.deepEqual(registeredFiles, directoryFiles);
  assert.equal(
    entries.filter(entry => entry.kind === 'baseline').length,
    Object.keys(manifest.baselines).length,
  );
  assert.equal(
    entries.filter(entry => entry.kind === 'observation').length,
    Object.keys(manifest.observations).length,
  );
  assert.equal(entries.length, 7);

  for (const entry of entries) {
    const { artifact, caseDefinition, definition, rawArtifact } = entry;
    assert.equal(
      definition.artifact.startsWith('fixtures/trust-known-answer/baseline-results/'),
      true,
    );
    assert.equal(artifact.caseId, caseDefinition.id);
    assert.equal(artifact.immutable, true);
    assert.equal(artifact.oracle, undefined, 'the observed artifact must not contain its oracle');
    assert.equal(canonicalSha256(rawArtifact), definition.artifactSha256);

    if (artifact.parentPayload) {
      const contentBytes = Buffer.byteLength(JSON.stringify(artifact.parentPayload.content));
      const structuredContentBytes = Buffer.byteLength(
        JSON.stringify(artifact.parentPayload.structuredContent),
      );
      assert.deepEqual(artifact.measurement, {
        encoding: 'utf8',
        formula: 'byteLength(JSON.stringify(content)) + byteLength(JSON.stringify(structuredContent))',
        contentBytes,
        structuredContentBytes,
        parentPayloadBytes: contentBytes + structuredContentBytes,
      });
      assert.equal(definition.contentBytes, contentBytes);
      assert.equal(definition.structuredContentBytes, structuredContentBytes);
      assert.equal(definition.parentPayloadBytes, contentBytes + structuredContentBytes);
    } else if (artifact.transport) {
      assert.equal(definition.outcome, 'no_response');
      assert.equal(artifact.measurement.parentPayloadBytes, 0);
    } else {
      assert.equal(entry.kind, 'observation');
      assert.equal(artifact.recordType, 'documented_known_bad_observation');
      assert.equal(artifact.source.rawParentPayloadPreserved, false);
      assert.equal(artifact.measurement, undefined);
    }
  }
});

test('manifest oracles reject every immutable known-bad artifact', async t => {
  const { entries } = await loadKnownBadEntries();
  for (const entry of entries) {
    await t.test(entry.caseDefinition.id, () => {
      const evaluation = evaluateKnownBadBaseline(
        entry.caseDefinition.oracle,
        entry.artifact,
      );
      assert.equal(evaluation.passed, false);
      assert.notEqual(evaluation.observedState, 'invalid');
      assert.deepEqual(
        knownBadViolationKeys(evaluation),
        EXPECTED_KNOWN_BAD_VIOLATIONS[entry.caseDefinition.id],
      );
    });
  }
});

test('known-bad evaluator accepts corrected controls for all seven records', async t => {
  const { entries } = await loadKnownBadEntries();
  for (const entry of entries) {
    await t.test(entry.caseDefinition.id, () => {
      const correctedArtifact = buildCorrectedArtifact(
        entry.caseDefinition,
        entry.artifact,
      );
      assert.deepEqual(
        evaluateKnownBadBaseline(entry.caseDefinition.oracle, correctedArtifact),
        {
          passed: true,
          observedState: entry.caseDefinition.oracle.expectedState,
          violations: [],
        },
      );
    });
  }
});

test('known-bad evaluator does not reject an explicit negation by substring', async () => {
  const { entries } = await loadKnownBadEntries();
  const entry = entries.find(item => item.caseDefinition.id === 'obs-external-process-inference');
  const correctedArtifact = buildCorrectedArtifact(entry.caseDefinition, entry.artifact);
  correctedArtifact.parentPayload.structuredContent.directAnswer =
    'It is false that the flow launches an external process.';
  correctedArtifact.parentPayload.content[0].text =
    correctedArtifact.parentPayload.structuredContent.directAnswer;
  assert.equal(
    evaluateKnownBadBaseline(entry.caseDefinition.oracle, correctedArtifact).passed,
    true,
  );
});

test('known-bad evaluator binds transport ids and documented failure classes to the oracle', async () => {
  const { entries } = await loadKnownBadEntries();
  const cancellation = entries.find(
    item => item.caseDefinition.id === 'fx-jsonrpc-id-zero-cancellation',
  );
  const correctedCancellation = buildCorrectedArtifact(
    cancellation.caseDefinition,
    cancellation.artifact,
  );
  correctedCancellation.transport.requestId = 1;
  assert.deepEqual(
    knownBadViolationKeys(evaluateKnownBadBaseline(
      cancellation.caseDefinition.oracle,
      correctedCancellation,
    )),
    ['REQUEST_ID_MISMATCH'],
  );

  const documented = entries.find(
    item => item.caseDefinition.id === 'obs-external-process-inference',
  );
  const wrongClass = structuredClone(documented.artifact);
  wrongClass.observation.failureClass = 'different_failure';
  assert.deepEqual(
    knownBadViolationKeys(evaluateKnownBadBaseline(
      documented.caseDefinition.oracle,
      wrongClass,
    )),
    ['DOCUMENTED_FAILURE_CLASS_MISMATCH'],
  );
});

test('known-bad evaluator requires exact file-range grounding for goal anchors', async () => {
  const { entries } = await loadKnownBadEntries();
  const entry = entries.find(item => item.caseDefinition.id === 'obs-large-route-ui-api-mismatch');
  const correctedArtifact = buildCorrectedArtifact(entry.caseDefinition, entry.artifact);
  correctedArtifact.parentPayload.structuredContent.evidence
    .find(item => item.id === 'E3').groundingStatus = 'partial';

  const evaluation = evaluateKnownBadBaseline(entry.caseDefinition.oracle, correctedArtifact);
  assert.deepEqual(knownBadViolationKeys(evaluation), ['REQUIRED_GOAL_UNSUPPORTED:G1']);
});

test('known-bad evaluator fails closed on an incomplete payload', async () => {
  const manifest = await loadTrustManifest();
  const caseDefinition = manifest.cases.find(item => item.id === 'obs-deny-list-count-range');
  assert.deepEqual(evaluateKnownBadBaseline(caseDefinition.oracle, {}), {
    passed: false,
    observedState: 'invalid',
    violations: [{
      code: 'INVALID_BASELINE_ARTIFACT',
      problems: [
        'parentPayload is required',
        'parentPayload.content must be an array',
        'structuredContent must be an object',
        'structuredContent.schemaVersion must be 2',
        'structuredContent.directAnswer must be non-empty',
        'structuredContent.status.verification must be a string',
        'structuredContent.status.complete must be a boolean',
        'structuredContent.evidence must be an array',
      ],
    }],
  });
});

test('evaluateBenchmarkCase scores keyword expectations and checks', () => {
  const caseDefinition = {
    id: 'demo',
    passScore: 0.7,
    expectations: [
      {
        label: 'Answer groups',
        source: 'direct_answer',
        groups: [['sessionstore'], ['target paths'], ['missing-token']],
        minCoverage: 2 / 3,
        weight: 0.6,
      },
      {
        label: 'Evidence paths',
        source: 'evidence_paths',
        groups: [['src/explorer/runtime.mjs']],
        weight: 0.2,
      },
    ],
    checks: [
      {
        label: 'Has structured evidence',
        type: 'min_evidence_count',
        value: 1,
        weight: 0.2,
      },
    ],
  };

  const result = {
    schemaVersion: 3,
    directAnswer: 'SessionStore updates target paths after each call.',
    state: 'complete',
    evidence: [
      {
        path: 'src/explorer/runtime.mjs',
        kind: 'source',
      },
    ],
    targets: [
      { path: 'src/explorer/session.mjs', role: 'read', reason: 'session target storage', evidenceRefs: [] },
    ],
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.id, 'demo');
  assert.equal(evaluation.expectations[0].matchedCount, 2);
  assert.equal(evaluation.checks[0].passed, true);
  assert.equal(evaluation.passed, true);
  assert.ok(evaluation.score > 0.7);
});

test('summarizeBenchmarkSuite aggregates pass and average score', () => {
  const summary = summarizeBenchmarkSuite([
    { evaluation: { passed: true, score: 0.8 } },
    { evaluation: { passed: false, score: 0.4 } },
  ]);

  assert.deepEqual(summary, {
    caseCount: 2,
    passedCount: 1,
    failedCount: 1,
    averageScore: 0.6,
  });
});

test('evaluateBenchmarkCase scores adoption fields', () => {
  const caseDefinition = {
    id: 'adoption',
    passScore: 0.7,
    expectations: [
      {
        label: 'Direct answer',
        source: 'direct_answer',
        groups: [['requireauth']],
        weight: 0.25,
      },
      {
        label: 'Targets',
        source: 'target_paths',
        groups: [['src/auth.js']],
        weight: 0.25,
      },
      {
        label: 'Snippets',
        source: 'evidence_snippets',
        groups: [['export function']],
        weight: 0.25,
      },
    ],
    checks: [
      { label: 'Has direct answer', type: 'has_direct_answer', value: true, weight: 0.1 },
      { label: 'Has targets', type: 'min_target_count', value: 1, weight: 0.1 },
      { label: 'Has snippets', type: 'min_evidence_snippet_count', value: 1, weight: 0.05 },
    ],
  };

  const result = {
    schemaVersion: 3,
    directAnswer: 'requireAuth is defined in auth.js',
    state: 'complete',
    targets: [{ path: 'src/auth.js', role: 'read', reason: 'definition', evidenceRefs: ['E1'] }],
    evidence: [{ path: 'src/auth.js', snippet: '1: export function requireAuth() {}' }],
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.passed, true);
});

test('Spec 028 T052 — non-v3 evaluator checks stay removed', () => {
  for (const checkType of [
    'min_grounded_evidence_count',
    'min_citation_count',
    'min_citation_file_count',
    'tool_results_truncated_equals',
    'citation_gap_warning_equals',
    'critic_warning_absent',
    'status_verification_equals',
  ]) {
    assert.throws(
      () => evaluateBenchmarkCase({
        id: `removed-${checkType}`,
        checks: [{ label: checkType, type: checkType, value: 1 }],
      }, {}),
      new RegExp(`Unknown benchmark check type: ${checkType}`),
    );
  }
});

test('evaluateBenchmarkCase rejects removed legacy benchmark aliases', () => {
  for (const source of [
    'answer',
    'summary',
    'candidate_paths',
    'confidence_level',
    'evidence_why',
    'followup_descriptions',
    'status_verification',
    'next_action',
    'confidence',
  ]) {
    assert.throws(
      () => evaluateBenchmarkCase({
        id: `removed-${source}`,
        expectations: [
          {
            label: source,
            source,
            groups: [['anything']],
          },
        ],
      }, {
        directAnswer: 'anything',
        candidatePaths: ['src/legacy-auth.js'],
        status: { confidence: 'high' },
      }),
      new RegExp(`Unknown benchmark source: ${source}`),
    );
  }

  assert.throws(
    () => evaluateBenchmarkCase({
      id: 'removed-min-candidate-path-count',
      checks: [
        { label: 'Candidate paths', type: 'min_candidate_path_count', value: 1 },
      ],
    }, {
      targets: [{ path: 'src/auth.js', role: 'read', reason: 'auth definition', evidenceRefs: [] }],
    }),
    /Unknown benchmark check type: min_candidate_path_count/,
  );
});

test('evaluateBenchmarkCase reads schema-v3 MCP results', () => {
  const caseDefinition = {
    id: 'compact',
    passScore: 0.9,
    expectations: [
      {
        label: 'Combined text includes compact fields',
        source: 'combined_text',
        groups: [['direct answer'], ['target reason']],
        weight: 0.25,
      },
      {
        label: 'Target paths come from compact targets',
        source: 'target_paths',
        groups: [['src/mcp/server.mjs']],
        weight: 0.15,
      },
      {
        label: 'Result state',
        source: 'result_state',
        groups: [['verify_targets']],
        weight: 0.15,
      },
    ],
    checks: [
      { label: 'Compact targets', type: 'min_target_count', value: 1, weight: 0.1 },
    ],
  };

  const result = {
    schemaVersion: 3,
    directAnswer: 'Direct answer from compact result.',
    state: 'verify_targets',
    targets: [
      { path: 'src/mcp/server.mjs', role: 'read', reason: 'Target reason for compact output.' },
    ],
    evidence: [
      {
        kind: 'source',
        path: 'src/mcp/server.mjs',
        startLine: 1,
        endLine: 1,
        supports: 'The compact output is assembled by the MCP server.',
      },
    ],
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.passed, true);
});

test('evaluateBenchmarkCase matches result_state as an exact enum value', () => {
  const evaluation = evaluateBenchmarkCase({
    id: 'exact-state',
    expectations: [{
      label: 'Complete state',
      source: 'result_state',
      groups: [['complete']],
    }],
  }, {
    schemaVersion: 3,
    state: 'incomplete',
  });

  assert.equal(evaluation.expectations[0].passed, false);
  assert.equal(evaluation.expectations[0].details[0].matched, false);
  assert.equal(evaluation.expectations[0].details[0].matchedToken, null);
});

test('evaluateBenchmarkCase requires every expectation and check', () => {
  const result = { schemaVersion: 3, state: 'complete', directAnswer: 'Primary signal.' };
  const expectation = (token, weight) => ({
    label: token, source: 'direct_answer', groups: [[token]], weight,
  });
  const failedExpectation = evaluateBenchmarkCase({
    id: 'mandatory-expectation', passScore: 0.5,
    expectations: [expectation('primary signal', 0.9), expectation('missing signal', 0.1)],
  }, result);
  assert.equal(failedExpectation.score, 0.9);
  assert.equal(failedExpectation.passed, false);

  const failedCheck = evaluateBenchmarkCase({
    id: 'mandatory-check', passScore: 0.5,
    expectations: [expectation('primary signal', 0.9)],
    checks: [{ label: 'Missing target', type: 'min_target_count', value: 1, weight: 0.1 }],
  }, result);
  assert.equal(failedCheck.score, 0.9);
  assert.equal(failedCheck.passed, false);
});

test('evaluateBenchmarkCase enforces git evidence and target-count bounds', () => {
  const definition = {
    id: 'bounds', passScore: 1,
    checks: [
      { label: 'Git', type: 'min_git_evidence_count', value: 1 },
      { label: 'Quiet', type: 'max_target_count', value: 1 },
    ],
  };
  const result = {
    schemaVersion: 3, state: 'complete', targets: [{ path: 'src/one.mjs' }],
    evidence: [{ kind: 'git', sha: 'abc1234', supports: 'Registry change.' }],
  };
  assert.equal(evaluateBenchmarkCase(definition, result).passed, true);
  assert.equal(evaluateBenchmarkCase(definition, { ...result, evidence: [] }).passed, false);
  assert.equal(evaluateBenchmarkCase(definition, {
    ...result, targets: [...result.targets, { path: 'src/two.mjs' }],
  }).passed, false);
});

test('Spec 028 T071 — adoption fails closed for incomplete and aborted results', () => {
  const definition = {
    id: 'state-gate', passScore: 1,
    expectations: [{ label: 'Answer', source: 'direct_answer', groups: [['matched answer']] }],
  };
  const results = [
    {
      schemaVersion: 3, state: 'incomplete', directAnswer: 'Matched answer.',
      evidence: [{ kind: 'source', path: 'src/a.mjs', startLine: 1, endLine: 1, supports: 'Matched answer.' }],
      gaps: [{ question: 'What remains?', reason: 'Search incomplete.' }],
    },
    { schemaVersion: 3, state: 'failed', directAnswer: 'Matched answer.', failure: { reason: 'aborted' } },
  ];
  for (const result of results) {
    const evaluation = evaluateBenchmarkCase(definition, result);
    assert.equal(evaluation.score, 1);
    assert.equal(evaluation.passed, false);
  }
});

test('Spec 028 T071 — combined text uses schema-v3 gap and action fields only', () => {
  const combined = (result, groups) => evaluateBenchmarkCase({
    id: 'combined-v3', expectations: [{ label: 'Text', source: 'combined_text', groups }],
  }, result).expectations[0];
  const base = {
    schemaVersion: 3, state: 'incomplete',
    gaps: [{ question: 'Current question', reason: 'Current reason' }],
  };
  const gapText = combined({
    ...base,
    gaps: [{ ...base.gaps[0], need: 'Legacy need', blocker: 'Legacy blocker' }],
    retry: { action: 'Legacy retry' },
  }, [['current question'], ['current reason'], ['legacy need'], ['legacy blocker'], ['legacy retry']]);
  assert.deepEqual(gapText.details.map(item => item.matched), [true, true, false, false, false]);

  for (const [followUp, token] of [
    [{ type: 'tool', tool: 'collect_evidence', arguments: { claim: 'Tool claim' } }, 'tool claim'],
    [{ type: 'ask_user', question: 'Which deployment?' }, 'which deployment'],
    [{ type: 'external_verification', requirement: 'Inspect deployed routes.' }, 'inspect deployed routes'],
  ]) {
    assert.equal(combined({ ...base, followUp }, [[followUp.type], [token]]).passed, true);
  }

  const retryText = combined({
    schemaVersion: 3, state: 'failed', directAnswer: 'Provider failed.',
    failure: {
      reason: 'provider_error',
      retry: { type: 'tool', tool: 'collect_evidence', arguments: { claim: 'Current retry' } },
    },
    retry: { action: 'Legacy retry' },
  }, [['provider_error'], ['collect_evidence'], ['current retry'], ['legacy retry']]);
  assert.deepEqual(retryText.details.map(item => item.matched), [true, true, true, false]);
});

test('evaluateBenchmarkCase rejects removed recentActivity benchmark sources and checks', () => {
  assert.throws(
    () => evaluateBenchmarkCase({
      id: 'removed-recent-activity-source',
      expectations: [
        {
          label: 'Hot files',
          source: 'hot_files',
          groups: [['src/mcp/server.mjs']],
        },
      ],
    }, { _debug: { recentActivity: { hotFiles: ['src/mcp/server.mjs'] } } }),
    /Unknown benchmark source: hot_files/,
  );

  assert.throws(
    () => evaluateBenchmarkCase({
      id: 'removed-recent-activity-check',
      checks: [
        { label: 'Has recent activity', type: 'has_recent_activity', value: true },
      ],
    }, { _debug: { recentActivity: { hotFiles: ['src/mcp/server.mjs'] } } }),
    /Unknown benchmark check type: has_recent_activity/,
  );

});

test('Spec 028 T052 — report benchmark entry points migrate to structured suites', async () => {
  const packageManifest = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageManifest.scripts['benchmark:evidence'], undefined);
  await assert.rejects(
    fs.access(new URL('../benchmarks/evidence-preservation.json', import.meta.url)),
    error => error?.code === 'ENOENT',
  );

  const adoption = JSON.parse(await fs.readFile(new URL('../benchmarks/adoption.json', import.meta.url), 'utf8'));
  const traceCase = adoption.cases.find(item => item.id === 'trace-symbol-cross-check');
  assert.equal(traceCase?.args?.symbol, 'buildParentHandoffResponse');
  assert.deepEqual(traceCase?.args?.scope, ['src/**']);
  assert.deepEqual(traceCase?.checks?.map(item => item.type), [
    'min_evidence_count',
  ]);
  const fallbackCase = adoption.cases.find(item => item.id === 'explore-recent-change-context');
  assert.equal(fallbackCase?.tool, 'explore_repo');
  assert.equal(typeof fallbackCase?.args?.task, 'string');
  assert.doesNotMatch(JSON.stringify(adoption), /buildReportCritic|review_change_context/);
});

function trustOracleCase() {
  return {
    id: 'independent-trust-case',
    repeatCount: 3,
    oracle: {
      expectedState: 'complete',
      expectedGoals: [
        {
          id: 'G1',
          question: 'How is access checked?',
          claimType: 'positive',
          expectedResolution: 'supported',
          evidenceAnchorRefs: ['A-source'],
          anchorPolicy: 'all',
        },
        {
          id: 'G2',
          question: 'Are there any other checks in scope?',
          claimType: 'absence',
          expectedResolution: 'supported',
          evidenceAnchorRefs: ['A-source'],
          anchorPolicy: 'all',
        },
      ],
      expectedGoalAudits: [
        { proposalRef: 'S1', verdict: 'ready', required: true },
        {
          proposalRef: 'S-invented',
          verdict: 'reject_untraceable',
          required: false,
          mustNotLeak: true,
        },
      ],
      allowedClaims: [
        {
          id: 'C-allowed-1',
          goalId: 'G1',
          text: 'Access is checked by requireUser.',
          evidenceAnchorRefs: ['A-source'],
        },
        {
          id: 'C-allowed-2',
          goalId: 'G2',
          text: 'No other access check exists within src/**.',
          evidenceAnchorRefs: ['A-source'],
        },
      ],
      forbiddenClaims: [{
        id: 'C-forbidden',
        goalId: 'G2',
        text: 'No other access check exists in the repository.',
      }],
      evidenceAnchors: [{
        id: 'A-source',
        kind: 'source',
        path: 'src/auth.mjs',
        startLine: 4,
        endLine: 6,
        sourceRole: 'implementation',
        temporalRole: 'current',
      }],
      boundary: {
        repoId: 'fixture-auth',
        scope: ['src/**'],
        claimScope: ['src/**'],
      },
    },
  };
}

function passingTrustArtifact() {
  const directAnswer = [
    'Access is checked by requireUser.',
    'No other access check exists within src/**.',
  ].join('\n');
  const source = {
    id: 'E-source',
    kind: 'source',
    path: 'src/auth.mjs',
    startLine: 4,
    endLine: 6,
    snippet: '4: export function requireUser() {\n5:   return true;\n6: }',
    rangeGrounding: 'exact',
    sourceRole: 'implementation',
    temporalRole: 'current',
  };
  const search = {
    id: 'E-search',
    kind: 'search',
    tool: 'repo_grep',
    boundary: ['src/**'],
    matchCount: 0,
    toolTruncated: false,
    contextTruncated: false,
    omittedOutOfScopeFiles: 0,
    deniedPaths: 0,
    errors: 0,
    enumerationComplete: true,
  };
  return {
    goalAuditRecords: [
      { proposedGoalId: 'S1', verdict: 'ready' },
      { proposedGoalId: 'S-invented', verdict: 'reject_untraceable' },
    ],
    result: {
      parentHandoff: {
        schemaVersion: 3,
        state: 'complete',
        directAnswer,
        evidence: [
          {
            id: 'P-source',
            kind: 'source',
            path: 'src/auth.mjs',
            startLine: 4,
            endLine: 6,
            snippet: source.snippet,
            supports: 'Access check.',
          },
          {
            id: 'P-absence',
            kind: 'absence',
            boundary: ['src/**'],
            searches: ['access check'],
            supports: 'Bounded absence.',
          },
        ],
      },
      taskContract: {
        subgoals: [
          {
            id: 'S1',
            question: 'How is access checked?',
            claimType: 'positive',
            auditVerdict: 'ready',
            state: 'supported',
            resolution: 'affirmed',
          },
          {
            id: 'S2',
            question: 'Are there any other checks in scope?',
            claimType: 'absence',
            auditVerdict: 'ready',
            state: 'supported',
            resolution: 'affirmed',
          },
        ],
      },
      observations: [source, search],
      rejectedGoals: [{
        proposedGoalId: 'S-invented',
        verdict: 'reject_untraceable',
        question: 'Invent a migration plan.',
      }],
      semanticVerification: {
        score: 1,
        claims: [
          {
            id: 'C1',
            subgoalId: 'S1',
            text: 'Access is checked by requireUser.',
            evidenceRefs: ['E-source'],
            verdict: 'supported',
          },
          {
            id: 'C2',
            subgoalId: 'S2',
            text: 'No other access check exists within src/**.',
            evidenceRefs: ['E-source', 'E-search'],
            verdict: 'supported',
          },
        ],
        verdicts: [
          {
            claimId: 'C1',
            result: 'supported',
            resolution: 'affirmed',
            supportingEvidenceRefs: ['E-source'],
          },
          {
            claimId: 'C2',
            result: 'supported',
            resolution: 'affirmed',
            supportingEvidenceRefs: ['E-source', 'E-search'],
          },
        ],
        absenceCertificates: [{
          id: 'P-absence',
          subgoalId: 'S2',
          claimBoundary: ['src/**'],
          searchRefs: ['E-search'],
          searchSummary: ['access check'],
          complete: true,
          zeroMatches: true,
        }],
      },
    },
  };
}

function liveTrustOracleCase() {
  const caseDefinition = trustOracleCase();
  caseDefinition.request = { text: 'guard bounded' };
  caseDefinition.oracle.expectedGoals[0].requestOriginRefs = ['request:0-5'];
  caseDefinition.oracle.expectedGoals[1].requestOriginRefs = ['request:6-13'];
  caseDefinition.oracle.allowedClaims[0].requiredTextGroups = [
    ['repository evidence'],
    ['request guard'],
  ];
  caseDefinition.oracle.allowedClaims[1].requiredTextGroups = [
    ['bounded check'],
    ['independently observed source'],
  ];
  caseDefinition.livePolicy = { profile: LIVE_TRUST_EVALUATION_PROFILE };
  return caseDefinition;
}

function liveGoalAuditBinding(goal) {
  const core = {
    id: goal.id,
    question: goal.question,
    originRefs: [...new Set(goal.originRefs ?? [])].sort(),
    claimType: goal.claimType,
    proofPolicy: goal.proofPolicy,
    proofCondition: goal.proofCondition,
    constraints: [...new Set(goal.constraints ?? [])].sort(),
    auditVerdict: goal.auditVerdict,
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(['required-subgoal-audit-binding-v1', core]))
    .digest('hex');
  return `audit-v1:${digest.match(/.{16}/gu).join('-')}`;
}

function bindLiveGoalAudits(artifact) {
  const proofPolicyByClaimType = {
    positive: 'direct_source',
    absence: 'bounded_absence',
    count: 'deterministic_count',
    symbol_definition: 'symbol_definition',
    symbol_usage: 'bounded_usage_cross_check',
    flow: 'ordered_handoffs',
    impact: 'impact_categories',
    comparison: 'distinct_policy_paths',
    claim_verification: 'support_or_refute',
  };
  artifact.result.taskContract.task ??= 'guard bounded';
  for (const goal of artifact.result.taskContract.subgoals) {
    goal.proofPolicy = proofPolicyByClaimType[goal.claimType];
    goal.proofCondition ??= 'Observe direct evidence for the required request part.';
    goal.constraints ??= [];
    goal.auditVerdict ??= 'ready';
    goal.auditBinding = liveGoalAuditBinding(goal);
  }
  return artifact;
}

function liveCompleteArtifact() {
  const artifact = passingTrustArtifact();
  artifact.result.parentHandoff.directAnswer = [
    'Repository evidence shows the request guard at the cited source range.',
    'The bounded check is resolved by the independently observed source.',
  ].join('\n');
  artifact.result.taskContract.subgoals = [
    {
      id: 'model-goal-alpha',
      question: 'Locate the guard implementation.',
      originRefs: ['request:0-5'],
      claimType: 'symbol_definition',
      state: 'supported',
      resolution: 'affirmed',
    },
    {
      id: 'model-goal-beta',
      question: 'Check the bounded repository area.',
      originRefs: ['request:6-13'],
      claimType: 'absence',
      state: 'supported',
      resolution: 'affirmed',
    },
  ];
  artifact.result.semanticVerification.claims[0].text =
    'Repository evidence shows the request guard at the cited source range.';
  artifact.result.semanticVerification.claims[0].subgoalId = 'model-goal-alpha';
  artifact.result.semanticVerification.claims[1].text =
    'The bounded check is resolved by the independently observed source.';
  artifact.result.semanticVerification.claims[1].subgoalId = 'model-goal-beta';
  artifact.result.semanticVerification.absenceCertificates[0].subgoalId = 'model-goal-beta';
  return bindLiveGoalAudits(artifact);
}

function liveIncompleteArtifact() {
  const artifact = passingTrustArtifact();
  artifact.result.parentHandoff = {
    schemaVersion: 3,
    state: 'incomplete',
    gaps: [
      {
        question: 'guard',
        reason: 'The available repository observations do not prove it.',
      },
      {
        question: 'bounded',
        reason: 'The available repository observations do not prove it.',
      },
    ],
  };
  artifact.result.taskContract.subgoals = [
    {
      id: 'model-gap-one',
      question: 'Resolve the guard request.',
      originRefs: ['request:0-5'],
      claimType: 'positive',
      state: 'gap',
    },
    {
      id: 'model-gap-two',
      question: 'Resolve the bounded request.',
      originRefs: ['request:6-13'],
      claimType: 'absence',
      state: 'blocked',
    },
  ];
  artifact.result.coverageGaps = [
    { subgoalId: 'model-gap-one', question: 'Resolve the guard request.' },
    { subgoalId: 'model-gap-two', question: 'Resolve the bounded request.' },
  ];
  artifact.result.semanticVerification = {
    claims: [],
    verdicts: [],
    absenceCertificates: [],
  };
  return bindLiveGoalAudits(artifact);
}

function violationCodes(evaluation) {
  return evaluation.violations.map(item => item.code);
}

test('Spec 028 T064 — independent trust evaluator covers audits, goals, claims, state, absence, and roles', () => {
  const evaluation = evaluateTrustCase(trustOracleCase(), passingTrustArtifact());
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.observedState, 'complete');
  assert.deepEqual(evaluation.violations, []);
  assert.equal(typeof evaluation.repeatabilitySignature, 'string');
});

test('Spec 028 T068 — fatal oracles bind raw failure and safety-limit facts', () => {
  const caseDefinition = {
    id: 'fatal-output-cap',
    oracle: {
      expectedState: 'failed',
      expectedFailure: { category: 'internal', reason: 'invalid_final_response' },
      expectedSafetyLimits: [{
        name: 'generation_output_limit',
        stage: 'synthesis',
        truncated: true,
      }],
      expectedGoals: [{ expectedResolution: 'failed' }],
      allowedClaims: [],
      forbiddenClaims: [],
      evidenceAnchors: [],
    },
  };
  const artifact = {
    result: {
      parentHandoff: {
        schemaVersion: 3,
        state: 'failed',
        directAnswer: 'The explorer could not validate required control output.',
        failure: { reason: 'internal_error' },
      },
      failure: { category: 'internal', reason: 'invalid_final_response' },
      stats: {
        safetyLimits: [{
          name: 'generation_output_limit',
          stage: 'synthesis',
          affectedSubgoalIds: [],
          truncated: true,
        }],
      },
    },
  };

  assert.deepEqual(evaluateTrustCase(caseDefinition, artifact).violations, []);

  const wrongFailure = structuredClone(artifact);
  wrongFailure.result.failure.reason = 'provider_error';
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, wrongFailure))
    .includes('EXPECTED_FAILURE_MISMATCH'));

  const missingLimit = structuredClone(artifact);
  missingLimit.result.stats.safetyLimits = [];
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, missingLimit))
    .includes('EXPECTED_SAFETY_LIMIT_MISSING'));
});

test('Spec 028 T068 — explicit live profile accepts paraphrased anchored completion or fail-closed gaps', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };

  const strictDefault = evaluateTrustCase(caseDefinition, liveCompleteArtifact());
  assert.equal(strictDefault.passed, false, 'fixture evaluation remains exact by default');
  assert.ok(violationCodes(strictDefault).includes('REQUIRED_GOAL_MISSING'));

  const complete = evaluateTrustCase(caseDefinition, liveCompleteArtifact(), options);
  assert.equal(complete.passed, true);
  assert.equal(complete.observedState, 'complete');
  assert.equal(complete.evaluationProfile, LIVE_TRUST_EVALUATION_PROFILE);

  const incomplete = evaluateTrustCase(caseDefinition, liveIncompleteArtifact(), options);
  assert.equal(incomplete.passed, true);
  assert.equal(incomplete.observedState, 'incomplete');
});

test('Spec 028 T068 — live count claims bind a complete static measurement to its paired source', () => {
  const countText = 'The runtime-owned static array count is 2.';
  const caseDefinition = {
    id: 'live-static-array-count',
    livePolicy: { profile: LIVE_TRUST_EVALUATION_PROFILE },
    oracle: {
      expectedState: 'complete',
      expectedGoals: [{
        id: 'G1',
        requestOriginRefs: ['request:0-5'],
        claimType: 'count',
        expectedResolution: 'supported',
        evidenceAnchorRefs: ['A1'],
        anchorPolicy: 'any',
      }],
      allowedClaims: [],
      forbiddenClaims: [],
      evidenceAnchors: [{
        id: 'A1',
        kind: 'source',
        path: 'src/patterns.mjs',
        startLine: 1,
        endLine: 5,
        sourceRole: 'implementation',
        temporalRole: 'current',
      }],
      boundary: { claimScope: ['src/patterns.mjs'] },
    },
  };
  const artifact = {
    result: {
      parentHandoff: {
        schemaVersion: 3,
        state: 'complete',
        directAnswer: countText,
        targets: [{
          path: 'src/patterns.mjs', startLine: 1, endLine: 5, role: 'read',
          reason: countText, evidenceRefs: ['E1'],
        }],
        evidence: [{
          id: 'E1', kind: 'source', path: 'src/patterns.mjs',
          startLine: 1, endLine: 5, supports: countText,
        }],
      },
      taskContract: {
        subgoals: [{
          id: 'S1', question: 'Count the static entries.', originRefs: ['request:0-5'],
          claimType: 'count', state: 'supported', resolution: 'affirmed',
        }],
      },
      coverageGaps: [],
      observations: [{
        id: 'E1', kind: 'source', path: 'src/patterns.mjs', startLine: 1, endLine: 5,
        sourceRole: 'implementation', temporalRole: 'current',
      }, {
        id: 'E1:search', kind: 'search', tool: 'repo_symbol_context',
        boundary: ['src/patterns.mjs'], matchCount: 2, toolTruncated: false,
        contextTruncated: false, omittedOutOfScopeFiles: 0, deniedPaths: 0, errors: 0,
        enumerationComplete: true,
        normalizedItemIds: [`sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`],
        deterministicMeasurement: { kind: 'count', unit: 'array_entries', value: 2 },
      }],
      semanticVerification: {
        claims: [{
          id: 'C1', subgoalId: 'S1', text: countText, evidenceRefs: ['E1:search'],
          verdict: 'supported', measurement: { kind: 'count', unit: 'array_entries', value: 2 },
        }],
        verdicts: [{
          claimId: 'C1', result: 'supported', resolution: 'affirmed',
          supportingEvidenceRefs: ['E1:search'],
        }],
        deterministicCounts: [{
          subgoalId: 'S1', claimId: 'C1', observationRef: 'E1:search',
          unit: 'array_entries', complete: true, count: 2,
        }],
        absenceCertificates: [],
      },
    },
  };
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };

  bindLiveGoalAudits(artifact);

  assert.equal(evaluateTrustCase(caseDefinition, artifact, options).passed, true);
  artifact.result.observations[1].normalizedItemIds.pop();
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, artifact, options))
    .includes('LIVE_REQUIRED_GOAL_UNSUPPORTED'));
});

test('Spec 028 T068 — live profile rejects unsafe states, false completion, bad claims, and evidence', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };

  const failed = liveIncompleteArtifact();
  failed.result.parentHandoff = {
    schemaVersion: 3,
    state: 'failed',
    directAnswer: 'The provider failed.',
    failure: { reason: 'provider_error' },
  };
  failed.result.failure = { category: 'provider', reason: 'provider_error' };
  const failedCodes = violationCodes(evaluateTrustCase(caseDefinition, failed, options));
  assert.ok(failedCodes.includes('LIVE_STATE_REJECTED'));
  assert.equal(failedCodes.includes('LIVE_UNSUPPORTED_PARENT_CLAIM'), false,
    'a provider failure message is not a repository claim');

  const falseComplete = liveCompleteArtifact();
  falseComplete.result.taskContract.subgoals[0].state = 'gap';
  delete falseComplete.result.taskContract.subgoals[0].resolution;
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, falseComplete, options))
    .includes('STATE_REDUCTION_MISMATCH'));

  const forbidden = liveCompleteArtifact();
  forbidden.result.parentHandoff.directAnswer =
    'The cited source was inspected. No other access check exists in the repository.';
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, forbidden, options))
    .includes('FORBIDDEN_CLAIM_PRESENT'));

  const targetOverclaim = liveCompleteArtifact();
  const contradictoryCount = 'The verified collection contains 53 entries.';
  caseDefinition.oracle.forbiddenClaims.push({
    id: 'C-forbidden-target-count',
    goalId: 'G1',
    text: contradictoryCount,
  });
  targetOverclaim.result.parentHandoff.targets = [{
    path: 'src/auth.mjs',
    startLine: 4,
    endLine: 6,
    role: 'read',
    reason: contradictoryCount,
    evidenceRefs: ['P-source'],
  }];
  const targetOverclaimCodes = violationCodes(
    evaluateTrustCase(caseDefinition, targetOverclaim, options),
  );
  assert.ok(targetOverclaimCodes.includes('FORBIDDEN_CLAIM_PRESENT'));
  assert.ok(targetOverclaimCodes.includes('LIVE_UNSUPPORTED_PARENT_CLAIM'));

  const outOfBoundary = liveCompleteArtifact();
  outOfBoundary.result.parentHandoff.evidence.push({
    kind: 'source',
    path: 'outside/auth.mjs',
    startLine: 1,
    endLine: 1,
    supports: 'Outside evidence.',
  });
  outOfBoundary.result.observations.push({
    id: 'outside',
    kind: 'source',
    path: 'outside/auth.mjs',
    startLine: 1,
    endLine: 1,
  });
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, outOfBoundary, options))
    .includes('PARENT_EVIDENCE_OUT_OF_BOUNDARY'));

  const ungrounded = liveCompleteArtifact();
  ungrounded.result.parentHandoff.evidence[0].endLine = 99;
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, ungrounded, options))
    .includes('PARENT_EVIDENCE_UNGROUNDED'));

  const noGap = liveIncompleteArtifact();
  delete noGap.result.parentHandoff.gaps;
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, noGap, options))
    .includes('LIVE_EXPLICIT_GAP_MISSING'));
});

test('Spec 028 T069 — live profile rejects an anchored claim missing oracle semantics', () => {
  const caseDefinition = liveTrustOracleCase();
  const artifact = liveCompleteArtifact();
  const wrong = 'Repository evidence shows an unrelated cache at the cited source range.';
  artifact.result.semanticVerification.claims[0].text = wrong;
  artifact.result.parentHandoff.directAnswer = [
    wrong,
    artifact.result.semanticVerification.claims[1].text,
  ].join('\n');

  const evaluation = evaluateTrustCase(caseDefinition, artifact, {
    mode: 'live',
    profile: LIVE_TRUST_EVALUATION_PROFILE,
  });
  const codes = violationCodes(evaluation);
  assert.ok(codes.includes('LIVE_REQUIRED_GOAL_UNSUPPORTED'));
  assert.ok(codes.includes('LIVE_UNSUPPORTED_PARENT_CLAIM'));
});

test('Spec 028 T069 — live semantic markers require token boundaries', () => {
  const caseDefinition = liveTrustOracleCase();
  caseDefinition.oracle.allowedClaims[0].requiredTextGroups = [['117']];
  const artifact = liveCompleteArtifact();
  const wrong = 'The cited definition ends at line 1170.';
  artifact.result.semanticVerification.claims[0].text = wrong;
  artifact.result.parentHandoff.directAnswer = [
    wrong,
    artifact.result.semanticVerification.claims[1].text,
  ].join('\n');

  const evaluation = evaluateTrustCase(caseDefinition, artifact, {
    mode: 'live',
    profile: LIVE_TRUST_EVALUATION_PROFILE,
  });
  assert.equal(evaluation.passed, false);
  assert.ok(violationCodes(evaluation).includes('LIVE_REQUIRED_GOAL_UNSUPPORTED'));
});

test('Spec 028 T069 — live atomic claims may jointly satisfy one shared source oracle', () => {
  const caseDefinition = liveTrustOracleCase();
  caseDefinition.oracle.allowedClaims[0].requiredTextGroups.push([
    'independently observed source',
  ]);
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };
  const complete = liveCompleteArtifact();

  assert.equal(evaluateTrustCase(caseDefinition, complete, options).passed, true);

  const missing = structuredClone(complete);
  missing.result.semanticVerification.claims[1].text =
    'The bounded check is resolved by another cited source.';
  missing.result.parentHandoff.directAnswer = missing.result.semanticVerification.claims
    .map(claim => claim.text)
    .join('\n');
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, missing, options))
    .includes('LIVE_REQUIRED_GOAL_UNSUPPORTED'));
});

test('Spec 028 T069 — live explicit gaps bind the required claim type', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };
  const artifact = livePartialGapArtifact(0);
  assert.equal(evaluateTrustCase(caseDefinition, artifact, options).passed, true);

  const wrongType = structuredClone(artifact);
  wrongType.result.taskContract.subgoals[0].claimType = 'absence';
  bindLiveGoalAudits(wrongType);
  const wrongTypeCodes = violationCodes(evaluateTrustCase(caseDefinition, wrongType, options));
  assert.ok(wrongTypeCodes.includes('LIVE_REQUIRED_GOAL_MISSING'));
});

test('Spec 028 T069 — live explicit gaps use request-derived questions', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };
  const artifact = liveIncompleteArtifact();

  assert.notEqual(
    artifact.result.parentHandoff.gaps[0].question,
    artifact.result.taskContract.subgoals[0].question,
  );
  assert.equal(
    evaluateTrustCase(caseDefinition, artifact, options).passed,
    true,
  );
});

test('Spec 028 T069 — live origin matching bridges only internal whitespace gaps', () => {
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };
  const build = task => {
    const caseDefinition = liveTrustOracleCase();
    caseDefinition.request.text = task;
    caseDefinition.oracle.expectedGoals[0].requestOriginRefs = ['request:0-13'];
    const artifact = liveCompleteArtifact();
    artifact.result.taskContract.task = task;
    artifact.result.taskContract.subgoals[0].originRefs = [
      'request:0-5',
      'request:6-13',
    ];
    bindLiveGoalAudits(artifact);
    return { caseDefinition, artifact };
  };

  const whitespace = build('guard bounded');
  assert.equal(evaluateTrustCase(
    whitespace.caseDefinition,
    whitespace.artifact,
    options,
  ).passed, true);

  const punctuation = build('guard/bounded');
  const punctuationEvaluation = evaluateTrustCase(
    punctuation.caseDefinition,
    punctuation.artifact,
    options,
  );
  const punctuationCodes = violationCodes(punctuationEvaluation);
  assert.equal(punctuationEvaluation.passed, false);
  assert.ok(punctuationCodes.includes('LIVE_REQUIRED_GOAL_UNSUPPORTED'),
    JSON.stringify(punctuationCodes));
});

test('Spec 028 T069 — live explicit gaps accept exclusive unresolved refinement sets', () => {
  const caseDefinition = liveTrustOracleCase();
  caseDefinition.oracle.expectedGoals = [{
    ...caseDefinition.oracle.expectedGoals[0],
    id: 'G-impact',
    claimType: 'impact',
    requestOriginRefs: ['request:0-13'],
  }];
  caseDefinition.oracle.allowedClaims = [];
  const artifact = liveIncompleteArtifact();
  artifact.result.taskContract.subgoals = [
    {
      id: 'model-impact-code',
      question: 'Determine the implementation impact.',
      originRefs: ['request:0-13'],
      claimType: 'impact',
      state: 'gap',
    },
    {
      id: 'model-impact-tests',
      question: 'Determine the test impact.',
      originRefs: ['request:0-13'],
      claimType: 'impact',
      state: 'gap',
    },
  ];
  artifact.result.coverageGaps = artifact.result.taskContract.subgoals.map(goal => ({
    subgoalId: goal.id,
    question: goal.question,
  }));
  artifact.result.parentHandoff.gaps = [{
    question: 'guard bounded',
    reason: 'The available repository observations do not prove the impact.',
  }];
  bindLiveGoalAudits(artifact);

  const evaluation = evaluateTrustCase(caseDefinition, artifact, {
    mode: 'live',
    profile: LIVE_TRUST_EVALUATION_PROFILE,
  });
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation.violations));
});

test('Spec 028 T069 — live explicit gaps reject one broad unresolved goal shared by obligations', () => {
  const caseDefinition = liveTrustOracleCase();
  caseDefinition.oracle.expectedGoals = caseDefinition.oracle.expectedGoals.map((goal, index) => ({
    ...goal,
    id: `G-impact-${index + 1}`,
    claimType: 'impact',
  }));
  caseDefinition.oracle.allowedClaims = [];
  const artifact = liveIncompleteArtifact();
  artifact.result.taskContract.subgoals = [{
    id: 'model-broad-impact',
    question: 'Determine every requested impact.',
    originRefs: ['request:0-13'],
    claimType: 'impact',
    state: 'gap',
  }];
  artifact.result.coverageGaps = [{
    subgoalId: 'model-broad-impact',
    question: 'Determine every requested impact.',
  }];
  artifact.result.parentHandoff.gaps = [{
    question: 'guard bounded',
    reason: 'The available repository observations do not prove the impact.',
  }];
  bindLiveGoalAudits(artifact);

  const evaluation = evaluateTrustCase(caseDefinition, artifact, {
    mode: 'live',
    profile: LIVE_TRUST_EVALUATION_PROFILE,
  });
  assert.equal(evaluation.passed, false);
  assert.ok(violationCodes(evaluation).includes('LIVE_REQUIRED_GOAL_MISSING'));
});

test('Spec 028 T069 — live goals require an intact audit binding', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };

  const missing = liveCompleteArtifact();
  delete missing.result.taskContract.subgoals[0].auditBinding;
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, missing, options))
    .includes('LIVE_GOAL_AUDIT_BINDING_INVALID'));

  const malformed = liveCompleteArtifact();
  malformed.result.taskContract.subgoals[0].auditBinding = 'audit-v1:not-a-binding';
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, malformed, options))
    .includes('LIVE_GOAL_AUDIT_BINDING_INVALID'));

  const mutated = liveCompleteArtifact();
  mutated.result.taskContract.subgoals[0].question = 'A different unaudited obligation.';
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, mutated, options))
    .includes('LIVE_GOAL_AUDIT_BINDING_INVALID'));
});

test('Spec 028 T069 — live goal binding rejects ambiguous origins and accepts exclusive origins', () => {
  const caseDefinition = liveTrustOracleCase();
  caseDefinition.oracle.expectedGoals[1].claimType = 'positive';
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };

  const exact = liveIncompleteArtifact();
  exact.result.taskContract.subgoals[0].claimType = 'positive';
  exact.result.taskContract.subgoals[1].claimType = 'positive';
  bindLiveGoalAudits(exact);
  assert.equal(evaluateTrustCase(caseDefinition, exact, options).passed, true);

  const ambiguous = structuredClone(exact);
  for (const goal of ambiguous.result.taskContract.subgoals) {
    goal.originRefs = ['request:0-13'];
  }
  bindLiveGoalAudits(ambiguous);
  const codes = violationCodes(evaluateTrustCase(caseDefinition, ambiguous, options));
  assert.ok(codes.includes('LIVE_REQUIRED_GOAL_MISSING'));
});

test('Spec 028 T069 — live goal binding accepts equal origins with distinct anchors', () => {
  const caseDefinition = liveTrustOracleCase();
  caseDefinition.oracle.expectedGoals[0].requestOriginRefs = ['request:0-13'];
  caseDefinition.oracle.expectedGoals[1].requestOriginRefs = ['request:0-13'];
  caseDefinition.oracle.expectedGoals[1].claimType = 'positive';
  caseDefinition.oracle.expectedGoals[1].evidenceAnchorRefs = ['A-search'];
  caseDefinition.oracle.evidenceAnchors.push({
    id: 'A-search',
    kind: 'search',
    tool: 'repo_grep',
    boundary: ['src/**'],
    matchCount: 0,
    toolTruncated: false,
    contextTruncated: false,
    omittedOutOfScopeFiles: 0,
    deniedPaths: 0,
    errors: 0,
    enumerationComplete: true,
  });
  const artifact = liveCompleteArtifact();
  for (const goal of artifact.result.taskContract.subgoals) {
    goal.originRefs = ['request:0-13'];
    goal.claimType = 'positive';
  }
  bindLiveGoalAudits(artifact);

  const evaluation = evaluateTrustCase(caseDefinition, artifact, {
    mode: 'live',
    profile: LIVE_TRUST_EVALUATION_PROFILE,
  });
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation.violations));
});

test('Spec 028 T069 — live goal binding rejects equal origins with indistinguishable anchors', () => {
  const caseDefinition = liveTrustOracleCase();
  caseDefinition.oracle.expectedGoals[0].requestOriginRefs = ['request:0-13'];
  caseDefinition.oracle.expectedGoals[1].requestOriginRefs = ['request:0-13'];
  caseDefinition.oracle.expectedGoals[1].claimType = 'positive';
  caseDefinition.oracle.expectedGoals[1].evidenceAnchorRefs = ['A-source'];
  for (const allowedClaim of caseDefinition.oracle.allowedClaims) {
    delete allowedClaim.requiredTextGroups;
  }
  const artifact = liveCompleteArtifact();
  for (const goal of artifact.result.taskContract.subgoals) {
    goal.originRefs = ['request:0-13'];
    goal.claimType = 'positive';
  }
  bindLiveGoalAudits(artifact);

  const evaluation = evaluateTrustCase(caseDefinition, artifact, {
    mode: 'live',
    profile: LIVE_TRUST_EVALUATION_PROFILE,
  });
  assert.equal(evaluation.passed, false);
  assert.ok(violationCodes(evaluation).includes('LIVE_REQUIRED_GOAL_UNSUPPORTED'));
});

test('Spec 028 T069 — live semantic associations bind each predicate to its route', () => {
  const cases = [
    {
      name: 'direct clauses',
      passed: true,
      text: 'The admin helper uses ADMIN_USERS membership; the feedback route checks admin_user_info row existence; the inquiry route requires the is_admin boolean flag to be true.',
    },
    {
      name: 'swapped direct clauses',
      passed: false,
      text: 'The admin helper checks the is_admin boolean flag; the feedback route uses ADMIN_USERS membership; the inquiry route checks admin_user_info row existence.',
    },
    {
      name: 'comma-qualified direct clause',
      passed: true,
      text: 'The admin helper uses ADMIN_USERS membership; the feedback route checks admin_user_info and, when the row is absent, rejects access; the inquiry route requires the is_admin boolean flag to be true.',
    },
    {
      name: 'negated mechanisms',
      passed: false,
      text: 'The admin helper does not use ADMIN_USERS membership; the feedback route never checks admin_user_info row existence; the inquiry route does not check the is_admin boolean flag.',
    },
    {
      name: 'cannot mechanisms',
      passed: false,
      text: 'The admin helper cannot use ADMIN_USERS membership; the feedback route cannot check admin_user_info row existence; the inquiry route cannot check the is_admin boolean flag.',
    },
    {
      name: 'without mechanisms',
      passed: false,
      text: 'The admin helper operates without ADMIN_USERS membership; the feedback route allows access without checking admin_user_info row existence; the inquiry route works without requiring the is_admin boolean flag.',
    },
    {
      name: 'Korean negated mechanisms',
      passed: false,
      text: 'admin helper는 ADMIN_USERS membership을 사용하지 않는다; feedback route는 admin_user_info row를 검사하지 않는다; inquiry route는 is_admin boolean flag를 확인하지 않는다.',
    },
    {
      name: 'distant unrelated predicate words',
      passed: false,
      text: 'The admin helper uses ADMIN_USERS membership; the feedback route logs admin_user_info metadata ' +
        'x'.repeat(160) +
        ' row is a UI label; the inquiry route requires the is_admin boolean flag to be true.',
    },
    {
      name: 'respectively ordered',
      passed: true,
      text: 'The admin helper, feedback route, and inquiry route use ADMIN_USERS membership, admin_user_info row existence, and the is_admin boolean flag, respectively.',
    },
    {
      name: 'respectively swapped',
      passed: false,
      text: 'The admin helper, feedback route, and inquiry route use the is_admin boolean flag, ADMIN_USERS membership, and admin_user_info row existence, respectively.',
    },
    {
      name: 'respectively swapped after a correct introductory inventory',
      passed: false,
      text: 'Given ADMIN_USERS membership, admin_user_info row existence, and is_admin boolean as the three mechanisms, the admin helper, feedback route, and inquiry route use is_admin boolean, ADMIN_USERS membership, and admin_user_info row existence, respectively.',
    },
  ];
  for (const fixture of cases) {
    const caseDefinition = liveTrustOracleCase();
    caseDefinition.oracle.allowedClaims[0].requiredTextGroups = [
      ['ADMIN_USERS'], ['admin_user_info'], ['is_admin'],
    ];
    caseDefinition.oracle.allowedClaims[0].requiredTextAssociations = [
      {
        id: 'admin-helper-membership',
        subjectAlternatives: ['admin helper'],
        predicateGroups: [['ADMIN_USERS']],
      },
      {
        id: 'feedback-row-existence',
        subjectAlternatives: ['feedback route'],
        predicateGroups: [['admin_user_info'], ['row', 'existence']],
      },
      {
        id: 'inquiry-boolean-flag',
        subjectAlternatives: ['inquiry route'],
        predicateGroups: [['is_admin'], ['boolean', 'flag', 'true']],
      },
    ];
    const artifact = liveCompleteArtifact();
    artifact.result.semanticVerification.claims[0].text = fixture.text;
    artifact.result.parentHandoff.directAnswer = [
      fixture.text,
      artifact.result.semanticVerification.claims[1].text,
    ].join('\n');

    const evaluation = evaluateTrustCase(caseDefinition, artifact, {
      mode: 'live',
      profile: LIVE_TRUST_EVALUATION_PROFILE,
    });
    assert.equal(evaluation.passed, fixture.passed, fixture.name);
    if (!fixture.passed) {
      assert.ok(violationCodes(evaluation).includes('LIVE_REQUIRED_GOAL_UNSUPPORTED'),
        fixture.name);
      assert.ok(violationCodes(evaluation).includes('LIVE_UNSUPPORTED_PARENT_CLAIM'),
        fixture.name);
    }
  }
});

test('Spec 028 T068 — live profile rejects generic gaps and evidence-bag completions', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };

  const generic = liveIncompleteArtifact();
  generic.result.parentHandoff.directAnswer = 'A different unsupported wrong answer.';
  generic.result.parentHandoff.gaps = [{ question: 'Anything?', reason: 'Unknown.' }];
  generic.result.taskContract.subgoals = [];
  generic.result.coverageGaps = [];
  const genericCodes = violationCodes(evaluateTrustCase(caseDefinition, generic, options));
  assert.ok(genericCodes.includes('LIVE_REQUIRED_GOAL_MISSING'));
  assert.ok(genericCodes.includes('LIVE_UNSUPPORTED_PARENT_CLAIM'));

  const evidenceBag = liveCompleteArtifact();
  evidenceBag.result.parentHandoff.directAnswer = 'An unrelated answer beside valid anchor files.';
  evidenceBag.result.semanticVerification.claims = [];
  evidenceBag.result.semanticVerification.verdicts = [];
  const evidenceBagCodes = violationCodes(evaluateTrustCase(caseDefinition, evidenceBag, options));
  assert.ok(evidenceBagCodes.includes('LIVE_REQUIRED_GOAL_UNSUPPORTED'));
  assert.ok(evidenceBagCodes.includes('LIVE_UNSUPPORTED_PARENT_CLAIM'));

  const broadGap = liveIncompleteArtifact();
  broadGap.result.taskContract.subgoals = [{
    id: 'one-broad-gap',
    question: 'Resolve every request part.',
    originRefs: ['request:0-13'],
    claimType: 'positive',
    state: 'gap',
  }];
  broadGap.result.coverageGaps = [{
    subgoalId: 'one-broad-gap',
    question: 'Resolve every request part.',
  }];
  broadGap.result.parentHandoff.gaps = [{
    question: 'guard bounded',
    reason: 'The available repository observations do not prove it.',
  }];
  bindLiveGoalAudits(broadGap);
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, broadGap, options))
    .includes('LIVE_REQUIRED_GOAL_MISSING'),
  'one broad model goal cannot satisfy two independent oracle goals');
});

function livePartialGapArtifact(gapIndex) {
  const artifact = liveCompleteArtifact();
  const gapGoal = artifact.result.taskContract.subgoals[gapIndex];
  gapGoal.state = 'gap';
  delete gapGoal.resolution;
  artifact.result.parentHandoff.state = 'incomplete';
  artifact.result.parentHandoff.gaps = [{
    question: gapIndex === 0 ? 'guard' : 'bounded',
    reason: 'The available repository observations do not prove it.',
  }];
  artifact.result.coverageGaps = [{ subgoalId: gapGoal.id, question: gapGoal.question }];
  artifact.result.parentHandoff.directAnswer =
    artifact.result.semanticVerification.claims[gapIndex === 0 ? 1 : 0].text;
  return artifact;
}

test('Spec 028 T069 — live profile accepts an explicit parent-projection gap', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };
  const artifact = livePartialGapArtifact(0);
  const internallySupported = artifact.result.taskContract.subgoals[0];
  internallySupported.state = 'supported';
  internallySupported.resolution = 'affirmed';
  artifact.result.coverageGaps[0].reason = 'missing_evidence';

  const evaluation = evaluateTrustCase(caseDefinition, artifact, options);
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation.violations));
});

test('Spec 028 T068 — live repeatability includes which required goal remained unresolved', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };
  const first = livePartialGapArtifact(0);
  const second = livePartialGapArtifact(1);
  assert.equal(evaluateTrustCase(caseDefinition, first, options).passed, true);
  assert.equal(evaluateTrustCase(caseDefinition, second, options).passed, true);

  const evaluation = evaluateTrustRepeatability(caseDefinition, [first, second], options);
  assert.equal(evaluation.passed, false);
  assert.ok(violationCodes(evaluation).includes('REPEATABILITY_MISMATCH'));
});

test('Spec 028 T068 — live evaluation relaxation cannot be selected implicitly or by an unknown profile', () => {
  const caseDefinition = liveTrustOracleCase();
  const artifact = liveIncompleteArtifact();

  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, artifact, { mode: 'live' }))
    .includes('INVALID_EVALUATION_PROFILE'));
  assert.ok(violationCodes(evaluateTrustCase(caseDefinition, artifact, {
    mode: 'live',
    profile: 'relaxed',
  })).includes('INVALID_EVALUATION_PROFILE'));

  const undeclared = structuredClone(caseDefinition);
  delete undeclared.livePolicy;
  assert.ok(violationCodes(evaluateTrustCase(undeclared, artifact, {
    mode: 'live',
    profile: LIVE_TRUST_EVALUATION_PROFILE,
  })).includes('INVALID_EVALUATION_PROFILE'));
});

test('Spec 028 T068 — live repeatability compares completion state while ignoring optional citations', () => {
  const caseDefinition = liveTrustOracleCase();
  const options = { mode: 'live', profile: LIVE_TRUST_EVALUATION_PROFILE };
  const first = liveIncompleteArtifact();
  const second = liveIncompleteArtifact();
  second.result.parentHandoff.evidence = [{
    kind: 'source',
    path: 'src/auth.mjs',
    startLine: 4,
    endLine: 6,
    supports: 'Optional citation.',
  }];

  const stable = evaluateTrustRepeatability(caseDefinition, [first, second, liveIncompleteArtifact()], options);
  assert.equal(stable.passed, true);
  assert.equal(new Set(stable.signatures).size, 1);

  const failed = liveIncompleteArtifact();
  failed.result.parentHandoff = {
    schemaVersion: 3,
    state: 'failed',
    directAnswer: 'The provider failed.',
    failure: { reason: 'provider_error' },
  };
  failed.result.failure = { category: 'provider', reason: 'provider_error' };
  const unstable = evaluateTrustRepeatability(caseDefinition, [first, second, failed], options);
  assert.equal(unstable.passed, false);
  assert.ok(violationCodes(unstable).includes('REPEATABILITY_MISMATCH'));
});

test('Spec 028 T064 — goal audit and required-goal coverage use the external oracle', () => {
  const artifact = passingTrustArtifact();
  artifact.goalAuditRecords[0].verdict = 'blocked_scope';
  artifact.result.taskContract.subgoals.pop();

  const codes = violationCodes(evaluateTrustCase(trustOracleCase(), artifact));
  assert.ok(codes.includes('GOAL_AUDIT_MISMATCH'));
  assert.ok(codes.includes('REQUIRED_GOAL_MISSING'));
});

test('Spec 028 T064 — semantic support never trusts explorer scores or grounding labels', () => {
  for (const mutation of [
    observation => { observation.sourceRole = 'documentation'; },
    observation => { observation.temporalRole = 'historical'; },
  ]) {
    const artifact = passingTrustArtifact();
    mutation(artifact.result.observations[0]);
    artifact.result.observations[0].rangeGrounding = 'exact';
    artifact.result.semanticVerification.score = 1;

    const evaluation = evaluateTrustCase(trustOracleCase(), artifact);
    assert.equal(evaluation.passed, false);
    assert.ok(violationCodes(evaluation).includes('CLAIM_EVIDENCE_UNSUPPORTED'));
  }
});

test('Spec 028 T064 — absence certification is recomputed from boundary and search facts', () => {
  const boundaryMismatch = passingTrustArtifact();
  boundaryMismatch.result.semanticVerification.absenceCertificates[0].claimBoundary = ['src/auth.mjs'];
  assert.ok(violationCodes(evaluateTrustCase(trustOracleCase(), boundaryMismatch))
    .includes('ABSENCE_BOUNDARY_MISMATCH'));

  const truncated = passingTrustArtifact();
  truncated.result.observations.find(item => item.kind === 'search').toolTruncated = true;
  assert.ok(violationCodes(evaluateTrustCase(trustOracleCase(), truncated))
    .includes('ABSENCE_SEARCH_INCOMPLETE'));

  const nonzero = passingTrustArtifact();
  nonzero.result.observations.find(item => item.kind === 'search').matchCount = 1;
  assert.ok(violationCodes(evaluateTrustCase(trustOracleCase(), nonzero))
    .includes('ABSENCE_SEARCH_INCOMPLETE'));
});

test('Spec 028 T064 — rejected goals may remain diagnostic but cannot leak into required/public state', () => {
  const artifact = passingTrustArtifact();
  artifact.result.taskContract.subgoals.push({
    id: 'S-invented',
    question: 'Invent a migration plan.',
    claimType: 'impact',
    auditVerdict: 'ready',
    state: 'supported',
    resolution: 'affirmed',
  });
  artifact.result.parentHandoff.directAnswer += '\nInvent a migration plan.';

  const codes = violationCodes(evaluateTrustCase(trustOracleCase(), artifact));
  assert.ok(codes.includes('UNEXPECTED_REQUIRED_GOAL'));
  assert.ok(codes.includes('REJECTED_GOAL_LEAKED'));
});

test('Spec 028 T064 — public state is checked against both oracle and required-goal reduction', () => {
  const artifact = passingTrustArtifact();
  artifact.result.taskContract.subgoals[1].state = 'gap';
  delete artifact.result.taskContract.subgoals[1].resolution;

  const codes = violationCodes(evaluateTrustCase(trustOracleCase(), artifact));
  assert.ok(codes.includes('REQUIRED_GOAL_RESOLUTION_MISMATCH'));
  assert.ok(codes.includes('STATE_REDUCTION_MISMATCH'));
});

test('Spec 028 T064 — repeatability ignores optional evidence but pins state, goal resolution, and claims', () => {
  const runs = [passingTrustArtifact(), passingTrustArtifact(), passingTrustArtifact()];
  runs[1].result.observations.reverse();
  runs[1].result.parentHandoff.evidence.reverse();
  runs[2].result.observations.push({
    id: 'E-optional',
    kind: 'source',
    path: 'src/optional.mjs',
    startLine: 1,
    endLine: 1,
    sourceRole: 'implementation',
    temporalRole: 'current',
  });

  const stable = evaluateTrustRepeatability(trustOracleCase(), runs);
  assert.equal(stable.passed, true);
  assert.equal(new Set(stable.signatures).size, 1);

  runs[2].result.taskContract.subgoals[1].state = 'gap';
  delete runs[2].result.taskContract.subgoals[1].resolution;
  runs[2].result.parentHandoff.state = 'incomplete';
  const unstable = evaluateTrustRepeatability(trustOracleCase(), runs);
  assert.equal(unstable.passed, false);
  assert.ok(violationCodes(unstable).includes('REPEATABILITY_MISMATCH'));
});

test('Spec 028 T052 — report evidence preservation migrates to independent structured integrity cases', async () => {
  const manifest = await loadTrustManifest();
  assert.deepEqual(manifest.fixtureSubsets?.structuredEvidenceIntegrity, [
    'fx-semantic-mismatch',
    'fx-truncated-enumeration',
  ]);

  for (const caseId of manifest.fixtureSubsets.structuredEvidenceIntegrity) {
    const caseDefinition = manifest.cases.find(item => item.id === caseId);
    assert.ok(caseDefinition, `${caseId} must reference a registered trust case`);
    assert.equal(caseDefinition.kind, 'fixture');
    assert.equal(caseDefinition.invocation?.tool, 'explore_repo');
    assert.equal(caseDefinition.oracle?.expectedState, 'incomplete');
    assert.deepEqual(caseDefinition.oracle?.allowedClaims, []);
    assert.ok(caseDefinition.oracle?.forbiddenClaims?.length > 0);
    assert.ok(caseDefinition.oracle?.evidenceAnchors?.length > 0);
    assert.ok(caseDefinition.oracle.evidenceAnchors.every(anchor =>
      anchor.kind === 'source' && anchor.temporalRole === 'current'));
  }

  const semanticCase = manifest.cases.find(item => item.id === 'fx-semantic-mismatch');
  assert.match(semanticCase.oracle.forbiddenClaims[0].text, /117 configured secret patterns/);
  const truncatedCase = manifest.cases.find(item => item.id === 'fx-truncated-enumeration');
  assert.equal(truncatedCase.oracle.expectedGoals[0].anchorPolicy, 'all');
});
