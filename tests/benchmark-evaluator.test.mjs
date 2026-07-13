import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateBenchmarkCase,
  evaluateKnownBadBaseline,
  summarizeBenchmarkSuite,
} from '../src/benchmark/evaluator.mjs';

const TRUST_MANIFEST_URL = new URL('../benchmarks/trust-known-answer.json', import.meta.url);
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
const ORACLE_FAILURE_CATEGORIES = new Set(['execution', 'input', 'provider', 'internal']);
const ORACLE_FAILURE_REASONS = new Set([
  'budget_exhausted',
  'tool_errors',
  'aborted',
  'repo_mismatch',
  'invalid_arguments',
  'provider_error',
  'access_denied',
  'invalid_final_response',
]);
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
    if (!isObject(source) || !isObject(request) || !isObject(oracle) || !isObject(boundary)) {
      problems.push(label + ' has an unparseable source, request, oracle, or boundary');
      continue;
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
      if (!isObject(claim)
          || typeof claim.id !== 'string'
          || typeof claim.text !== 'string'
          || claimIds.has(claim.id)
          || !goalIds.has(claim.goalId)
          || evidenceAnchorRefs.length === 0) {
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
          || !isSafeRelativePath(anchor.path)
          || !pathInScope(anchor.path, claimScope)
          || !Number.isInteger(anchor.startLine)
          || !Number.isInteger(anchor.endLine)
          || anchor.startLine < 1
          || anchor.endLine < anchor.startLine) {
        problems.push(label + ' has an invalid evidence boundary');
        continue;
      }
      anchorIds.add(anchor.id);
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
      caseDefinition.oracle.expectedGoals[1].originRefs = ['P1'];
    }],
    ['dangling anchor', 'dangling evidence anchor ref', caseDefinition => {
      caseDefinition.oracle.expectedGoals[0].evidenceAnchorRefs = ['E999'];
    }],
    ['allowed claim without anchors', 'allowed claim has an unknown goal or invalid shape', caseDefinition => {
      delete caseDefinition.oracle.allowedClaims[0].evidenceAnchorRefs;
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
    directAnswer: 'SessionStore updates target paths after each call.',
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
    directAnswer: 'requireAuth is defined in auth.js',
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
        groups: [['direct answer'], ['target reason'], ['followup']],
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
    directAnswer: 'Direct answer from compact result.',
    state: 'verify_targets',
    targets: [
      { path: 'src/mcp/server.mjs', role: 'read', reason: 'Target reason for compact output.', evidenceRefs: [] },
    ],
    evidence: [],
    followUp: { action: 'read_target', reason: 'Followup needed.' },
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.passed, true);
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

  assert.throws(
    () => evaluateBenchmarkCase({
      id: 'removed-budget-stop-check',
      checks: [
        { label: 'Budget stop', type: 'stopped_by_budget_equals', value: true },
      ],
    }, { searchCoverage: { stoppedByBudget: true } }),
    /Unknown benchmark check type: stopped_by_budget_equals/,
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
  assert.equal(traceCase?.args?.symbol, 'buildParentPayload');
  assert.deepEqual(traceCase?.checks?.map(item => item.type), [
    'min_evidence_count',
    'min_evidence_snippet_count',
  ]);
  const fallbackCase = adoption.cases.find(item => item.id === 'explore-recent-change-context');
  assert.equal(fallbackCase?.tool, 'explore_repo');
  assert.equal(typeof fallbackCase?.args?.task, 'string');
  assert.doesNotMatch(JSON.stringify(adoption), /buildReportCritic|review_change_context/);
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
