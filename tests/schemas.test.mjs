import test from 'node:test';
import assert from 'node:assert/strict';
import * as schemaModule from '../src/explorer/schemas.mjs';

import {
  ABSENCE_CERTIFICATE_SCHEMA,
  ATOMIC_CLAIM_SCHEMA,
  CLAIM_SYNTHESIS_SCHEMA,
  EXPLORE_REPO_INPUT_SCHEMA,
  EXPLORE_REPO_OUTPUT_SCHEMA,
  EXPLORE_RESULT_JSON_SCHEMA,
  GOAL_AUDIT_RECORD_SCHEMA,
  PUBLIC_TOOL_ARGUMENT_SCHEMAS,
  RETRY_SCHEMA,
  SAFETY_LIMIT_SCHEMA,
  SEMANTIC_VERIFIER_RESPONSE_SCHEMA,
  SEMANTIC_VERDICT_SCHEMA,
  TASK_CONTRACT_SCHEMA,
  computeGoalAuditBinding,
  computeConfidenceScore,
  normalizeExploreResult,
  reconcileConfidence,
  validateAbsenceCertificate,
  validateAtomicClaim,
  validateClaimSynthesisResponse,
  validateExploreRepoArgs,
  validateGoalAuditRecord,
  validateSafetyLimit,
  validateSemanticVerifierResponse,
  validateSemanticVerdict,
  validateTaskContract,
} from '../src/explorer/schemas.mjs';
import { RETRY_TOOLS } from '../src/explorer/runtime.mjs';

// Test-first activation point for T055's retry/provenance vocabulary cleanup.
const T055_RETRY_VOCABULARY_LANDED = true;

test('Spec 028 T049 — removed report tool is absent from retry schema and runtime', () => {
  assert.equal(RETRY_SCHEMA.properties.tool.enum.includes('explore'), false);
  assert.equal(RETRY_TOOLS.includes('explore'), false);
  assert.equal(RETRY_SCHEMA.properties.args.properties.prompt, undefined);
});

test('Spec 028 T045 — explore_repo rejects public hints.strategy but keeps anchors', () => {
  assert.deepEqual(
    Object.keys(EXPLORE_REPO_INPUT_SCHEMA.properties.hints.properties).sort(),
    ['files', 'regex', 'symbols'],
  );
  assert.doesNotThrow(() => validateExploreRepoArgs({
    task: 'Trace auth.',
    scope: ['src/**'],
    hints: {
      symbols: ['requireAuth'],
      files: ['src/auth.mjs'],
      regex: ['requireAuth\\('],
    },
  }));
  for (const strategy of [
    'symbol-first',
    'reference-chase',
    'git-guided',
    'breadth-first',
    'blame-guided',
    'pattern-scan',
  ]) {
    assert.throws(
      () => validateExploreRepoArgs({ task: 'Trace auth.', hints: { strategy } }),
      /Unknown explore_repo hints argument: strategy/,
    );
  }
});

test('Spec 028 T045 — retry vocabularies are set-equal to the six public tools', t => {
  if (!T055_RETRY_VOCABULARY_LANDED) {
    t.todo('T055 activates exact retry vocabulary assertions');
    return;
  }
  const expected = Object.keys(PUBLIC_TOOL_ARGUMENT_SCHEMAS);
  assert.deepEqual(expected, [
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'explore_repo',
  ]);
  assert.deepEqual(RETRY_SCHEMA.properties.tool.enum, expected);
  assert.deepEqual(RETRY_TOOLS, expected);
  assert.equal(RETRY_SCHEMA.properties.args.properties.reviewGoal, undefined);
  assert.equal(RETRY_SCHEMA.properties.args.properties.prompt, undefined);
});

test('Spec 028 T048 — removed review wrapper is absent from retry schema and runtime', () => {
  assert.equal(RETRY_SCHEMA.properties.tool.enum.includes('review_change_context'), false);
  assert.equal(RETRY_TOOLS.includes('review_change_context'), false);
  assert.equal(RETRY_SCHEMA.properties.args.properties.reviewGoal, undefined);
});

function internalSchemaTest(schema, validate, name, callback) {
  test(name, () => {
    callback(schema, validate);
  });
}

function assertStrictObjectTree(schema, label) {
  function visit(node, path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.type === 'object' || node.properties !== undefined) {
      assert.equal(node.type, 'object', `${label} ${path} must declare object type`);
      assert.equal(node.additionalProperties, false,
        `${label} ${path} must reject additional properties`);
      assert.ok(node.properties && typeof node.properties === 'object',
        `${label} ${path} must declare properties`);
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      visit(child, `${path}.properties.${key}`);
    }
    if (node.items) visit(node.items, `${path}.items`);
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      for (const [index, child] of (node[keyword] ?? []).entries()) {
        visit(child, `${path}.${keyword}[${index}]`);
      }
    }
    for (const [key, child] of Object.entries(node.$defs ?? {})) {
      visit(child, `${path}.$defs.${key}`);
    }
  }

  visit(schema, '$');
}

function assertSchemaKeys(schema, { required, optional = [] }, label) {
  assert.deepEqual(new Set(schema.required), new Set(required),
    `${label} required fields drifted`);
  assert.deepEqual(new Set(Object.keys(schema.properties)), new Set([...required, ...optional]),
    `${label} property set drifted`);
}

function assertStringArraySchema(schema, label) {
  assert.equal(schema.type, 'array', `${label} must be an array`);
  assert.equal(schema.items?.type, 'string', `${label} must contain strings`);
}

function assertStringProperties(schema, keys, label) {
  for (const key of keys) {
    assert.equal(schema.properties[key]?.type, 'string', `${label}.${key} must be a string`);
  }
}

function assertStrictValidator(validate, validValue, { missingKey, makeInvalid }) {
  assert.doesNotThrow(() => validate(structuredClone(validValue)));

  const withUnknownKey = structuredClone(validValue);
  withUnknownKey.unexpected = true;
  assert.throws(() => validate(withUnknownKey),
    'additionalProperties:false must be enforced at runtime');

  const missingRequired = structuredClone(validValue);
  delete missingRequired[missingKey];
  assert.throws(() => validate(missingRequired),
    'missing required fields must be rejected at runtime');

  const invalid = structuredClone(validValue);
  makeInvalid(invalid);
  assert.throws(() => validate(invalid),
    'invalid enum/type values must be rejected at runtime');
}

function parentHandoffV3Test(name, callback) {
  const schema = schemaModule.PARENT_HANDOFF_V3_SCHEMA;
  const validate = schemaModule.validateParentHandoffV3;
  test(name, () => {
    assert.ok(schema, 'PARENT_HANDOFF_V3_SCHEMA is not implemented');
    assert.equal(typeof validate, 'function', 'validateParentHandoffV3 is not implemented');
    callback(schema, validate);
  });
}

function makeV3SourceEvidence(overrides = {}) {
  return {
    kind: 'source',
    path: 'src/auth.mjs',
    startLine: 10,
    endLine: 18,
    supports: 'The handler validates the token before dispatch.',
    ...overrides,
  };
}

function makeV3Target(overrides = {}) {
  return {
    path: 'src/auth.mjs',
    role: 'read',
    reason: 'Read the validated handler before changing it.',
    ...overrides,
  };
}

function makeV3Complete(overrides = {}) {
  return {
    schemaVersion: 3,
    directAnswer: 'The handler validates the token before dispatch.',
    state: 'complete',
    evidence: [makeV3SourceEvidence()],
    ...overrides,
  };
}

function assertV3Rejected(validate, value, label) {
  assert.throws(() => validate(structuredClone(value)), undefined, label);
}

parentHandoffV3Test(
  'Spec 028 T036 — schema v3 exposes only the strict minimal parent fields',
  (schema) => {
    assert.equal(schemaModule.EXPLORE_REPO_OUTPUT_SCHEMA, schema,
      'the MCP output schema must be the v3 parent-handoff schema');
    assertStrictObjectTree(schema, 'PARENT_HANDOFF_V3_SCHEMA');
    assert.deepEqual(new Set(schema.required), new Set(['schemaVersion', 'state']));
    assert.deepEqual(new Set(Object.keys(schema.properties)), new Set([
      'schemaVersion',
      'directAnswer',
      'state',
      'targets',
      'evidence',
      'gaps',
      'followUp',
      'failure',
    ]));
    assert.equal(schema.properties.schemaVersion.const, 3);
    assert.deepEqual(schema.properties.state.enum, [
      'complete',
      'verify_targets',
      'incomplete',
      'failed',
    ]);
    assert.equal(schema.properties.directAnswer.minLength, 1);
    assert.equal(schema.properties.targets.minItems, 1);
    assert.equal(schema.properties.evidence.minItems, 1);
    assert.equal(schema.properties.gaps.minItems, 1);

    assert.equal(schema.oneOf?.length, 4,
      'the public JSON Schema must discriminate all four states itself');
    const branches = new Map(schema.oneOf.map(branch => [branch.properties?.state?.const, branch]));
    const expectedBranches = {
      complete: {
        required: ['schemaVersion', 'directAnswer', 'state', 'evidence'],
        optional: ['targets'],
      },
      verify_targets: {
        required: ['schemaVersion', 'directAnswer', 'state', 'targets', 'evidence'],
        optional: [],
      },
      incomplete: {
        required: ['schemaVersion', 'state', 'gaps'],
        optional: ['directAnswer', 'targets', 'evidence', 'followUp'],
      },
      failed: {
        required: ['schemaVersion', 'directAnswer', 'state', 'failure'],
        optional: [],
      },
    };
    for (const [state, expected] of Object.entries(expectedBranches)) {
      const branch = branches.get(state);
      assert.ok(branch, `missing ${state} schema branch`);
      assert.equal(branch.additionalProperties, false, `${state} branch must be strict`);
      assert.deepEqual(new Set(branch.required), new Set(expected.required),
        `${state} required fields drifted`);
      assert.deepEqual(
        new Set(Object.keys(branch.properties)),
        new Set([...expected.required, ...expected.optional]),
        `${state} allowed fields drifted`,
      );
    }
  },
);

parentHandoffV3Test(
  'Spec 028 T036 — every v3 state accepts only its conditional fields',
  (_schema, validate) => {
    const complete = makeV3Complete();
    const verifyTargets = makeV3Complete({
      state: 'verify_targets',
      targets: [makeV3Target({ role: 'edit', evidenceRefs: ['E1'] })],
      evidence: [makeV3SourceEvidence({ id: 'E1' })],
    });
    const incompleteWithPartial = {
      schemaVersion: 3,
      directAnswer: 'The API route exists.',
      state: 'incomplete',
      targets: [makeV3Target()],
      evidence: [makeV3SourceEvidence({ supports: 'The API route exists.' })],
      gaps: [{
        question: 'Whether another bootstrap also registers the route',
        reason: 'The bootstrap enumeration was truncated.',
      }],
      followUp: {
        type: 'tool',
        tool: 'explore_repo',
        arguments: {
          task: 'Check bootstrap files for route registration.',
          scope: ['src/app/**'],
          hints: { files: ['src/app/index.mjs'] },
        },
      },
    };
    const incompleteBlocked = {
      schemaVersion: 3,
      state: 'incomplete',
      gaps: [{
        question: 'Whether the deployed service uses this configuration',
        reason: 'The fact depends on live state unavailable to this repository explorer.',
      }],
      followUp: {
        type: 'external_verification',
        requirement: 'Report the active deployed configuration revision.',
      },
    };
    const failed = {
      schemaVersion: 3,
      directAnswer: 'Explorer was cancelled before a trustworthy answer was produced.',
      state: 'failed',
      failure: { reason: 'aborted' },
    };

    for (const valid of [complete, verifyTargets, incompleteWithPartial, incompleteBlocked, failed]) {
      assert.doesNotThrow(() => validate(structuredClone(valid)));
    }

    assertV3Rejected(validate, { ...complete, directAnswer: '' }, 'complete needs an answer');
    assertV3Rejected(validate, { ...complete, evidence: [] }, 'complete needs evidence');
    for (const required of ['directAnswer', 'evidence']) {
      const invalid = structuredClone(complete);
      delete invalid[required];
      assertV3Rejected(validate, invalid, `complete requires ${required}`);
    }
    assertV3Rejected(validate, { ...complete, gaps: incompleteWithPartial.gaps },
      'complete cannot expose gaps');
    assertV3Rejected(validate, { ...complete, followUp: incompleteWithPartial.followUp },
      'complete cannot expose a follow-up');
    assertV3Rejected(validate, { ...complete, failure: { reason: 'internal_error' } },
      'complete cannot expose a failure');

    const verifyWithoutTargets = structuredClone(verifyTargets);
    delete verifyWithoutTargets.targets;
    assertV3Rejected(validate, verifyWithoutTargets, 'verify_targets needs targets');
    assertV3Rejected(validate, { ...verifyTargets, targets: [] },
      'verify_targets cannot return an empty target list');
    for (const required of ['directAnswer', 'evidence']) {
      const invalid = structuredClone(verifyTargets);
      delete invalid[required];
      assertV3Rejected(validate, invalid, `verify_targets requires ${required}`);
    }

    const incompleteWithoutGaps = structuredClone(incompleteWithPartial);
    delete incompleteWithoutGaps.gaps;
    assertV3Rejected(validate, incompleteWithoutGaps, 'incomplete needs gaps');
    assertV3Rejected(validate, { ...incompleteWithPartial, gaps: [] },
      'incomplete cannot return an empty gap list');
    const partialWithoutEvidence = structuredClone(incompleteWithPartial);
    delete partialWithoutEvidence.evidence;
    assertV3Rejected(validate, partialWithoutEvidence,
      'an incomplete supported partial answer needs evidence');
    const evidenceWithoutPartial = structuredClone(incompleteWithPartial);
    delete evidenceWithoutPartial.directAnswer;
    assertV3Rejected(validate, evidenceWithoutPartial,
      'incomplete evidence cannot appear without a supported partial answer');
    assertV3Rejected(validate, { ...incompleteBlocked, directAnswer: '' },
      'all-blocked incomplete omits rather than empties directAnswer');
    assertV3Rejected(validate, { ...incompleteBlocked, failure: { reason: 'provider_error' } },
      'incomplete cannot expose a failure');
    assert.doesNotThrow(() => validate({
      schemaVersion: 3,
      state: 'incomplete',
      gaps: structuredClone(incompleteBlocked.gaps),
    }), 'incomplete followUp is optional when no action would help');

    const failedWithoutAnswer = structuredClone(failed);
    delete failedWithoutAnswer.directAnswer;
    assertV3Rejected(validate, failedWithoutAnswer, 'failed needs a concise answer');
    const failedWithoutFailure = structuredClone(failed);
    delete failedWithoutFailure.failure;
    assertV3Rejected(validate, failedWithoutFailure, 'failed needs failure data');
    assertV3Rejected(validate, { ...failed, directAnswer: '' },
      'failed directAnswer cannot be empty');
    assertV3Rejected(validate, { ...failed, failure: null },
      'failed failure cannot be null');
    assertV3Rejected(validate, {
      ...failed,
      failure: { reason: 'provider_error', retry: null },
    }, 'failed retry is omitted rather than null');
    for (const forbidden of ['targets', 'evidence', 'gaps', 'followUp']) {
      const invalid = structuredClone(failed);
      invalid[forbidden] = forbidden === 'followUp'
        ? { type: 'ask_user', question: 'Retry?' }
        : [{}];
      assertV3Rejected(validate, invalid, `failed cannot expose ${forbidden}`);
    }
  },
);

parentHandoffV3Test(
  'Spec 028 T036 — v3 nested target, evidence, gap, action, and failure unions are exact',
  (_schema, validate) => {
    const source = makeV3SourceEvidence({
      id: 'E1',
      snippet: '10: validateToken(token);',
    });
    const git = {
      kind: 'git',
      sha: 'abc1234',
      supports: 'This commit introduced token validation.',
    };
    const absence = {
      kind: 'absence',
      boundary: ['src/auth/**'],
      searches: ['symbol references: legacyAuthorize', 'text: legacyAuthorize'],
      supports: 'No static reference to legacyAuthorize was found in src/auth/**.',
    };
    for (const evidence of [source, git, absence]) {
      assert.doesNotThrow(() => validate(makeV3Complete({ evidence: [evidence] })));
    }

    for (const role of ['read', 'edit', 'test', 'config']) {
      assert.doesNotThrow(() => validate(makeV3Complete({
        targets: [makeV3Target({ role })],
      })));
    }

    const incompleteBase = {
      schemaVersion: 3,
      state: 'incomplete',
      gaps: [{ question: 'Which environment is intended?', reason: 'The caller did not name one.' }],
    };
    assert.doesNotThrow(() => validate({
      ...incompleteBase,
      followUp: { type: 'ask_user', question: 'Which deployment should be checked?' },
    }));
    assert.doesNotThrow(() => validate({
      ...incompleteBase,
      followUp: {
        type: 'external_verification',
        requirement: 'Report the live deployment revision.',
      },
    }));

    const toolActions = [
      ['find_relevant_code', { query: 'Locate token validation.' }],
      ['trace_symbol', { symbol: 'validateToken' }],
      ['map_change_impact', { change: 'Change token validation.' }],
      ['explain_code_path', { pathQuery: 'Trace request authentication.' }],
      ['collect_evidence', { claim: 'The route validates tokens.' }],
      ['explore_repo', {
        task: 'Explain token validation.',
        hints: { files: ['src/auth.mjs'], symbols: ['validateToken'], regex: ['validateToken'] },
      }],
    ];
    for (const [tool, args] of toolActions) {
      assert.doesNotThrow(() => validate({
        ...incompleteBase,
        followUp: { type: 'tool', tool, arguments: args },
      }), tool);
    }
    assert.doesNotThrow(() => validate({
      ...incompleteBase,
      followUp: {
        type: 'tool',
        tool: 'trace_symbol',
        arguments: { symbol: 'validateToken', scope: ['src/auth/**'] },
      },
    }));

    const requiredFieldCases = [
      ['target.path', makeV3Complete({ targets: [makeV3Target()] }), 'targets', 0, 'path'],
      ['target.role', makeV3Complete({ targets: [makeV3Target()] }), 'targets', 0, 'role'],
      ['target.reason', makeV3Complete({ targets: [makeV3Target()] }), 'targets', 0, 'reason'],
      ['source.path', makeV3Complete({ evidence: [source] }), 'evidence', 0, 'path'],
      ['source.startLine', makeV3Complete({ evidence: [source] }), 'evidence', 0, 'startLine'],
      ['source.endLine', makeV3Complete({ evidence: [source] }), 'evidence', 0, 'endLine'],
      ['source.supports', makeV3Complete({ evidence: [source] }), 'evidence', 0, 'supports'],
      ['git.sha', makeV3Complete({ evidence: [git] }), 'evidence', 0, 'sha'],
      ['git.supports', makeV3Complete({ evidence: [git] }), 'evidence', 0, 'supports'],
      ['absence.boundary', makeV3Complete({ evidence: [absence] }), 'evidence', 0, 'boundary'],
      ['absence.searches', makeV3Complete({ evidence: [absence] }), 'evidence', 0, 'searches'],
      ['absence.supports', makeV3Complete({ evidence: [absence] }), 'evidence', 0, 'supports'],
      ['gap.question', structuredClone(incompleteBase), 'gaps', 0, 'question'],
      ['gap.reason', structuredClone(incompleteBase), 'gaps', 0, 'reason'],
    ];
    for (const [label, value, collection, index, key] of requiredFieldCases) {
      delete value[collection][index][key];
      assertV3Rejected(validate, value, `${label} is required`);
    }

    for (const followUp of [
      { type: 'ask_user' },
      { type: 'external_verification' },
      { type: 'tool', tool: 'explore_repo' },
      { type: 'tool', arguments: { task: 'Search.' } },
    ]) {
      assertV3Rejected(validate, { ...incompleteBase, followUp },
        'follow-up variants require their exact fields');
    }

    for (const [label, evidence] of [
      ['source with git key', { ...source, sha: 'abc1234' }],
      ['git with source key', { ...git, snippet: 'not allowed' }],
      ['absence with git key', { ...absence, sha: 'abc1234' }],
    ]) {
      assertV3Rejected(validate, makeV3Complete({ evidence: [evidence] }), label);
    }

    for (const tool of ['review_change_context', 'explore']) {
      assertV3Rejected(validate, {
        ...incompleteBase,
        followUp: { type: 'tool', tool, arguments: { task: 'Retry.' } },
      }, `removed tool ${tool} is rejected`);
    }
    assertV3Rejected(validate, {
      ...incompleteBase,
      followUp: {
        type: 'tool',
        tool: 'trace_symbol',
        arguments: { task: 'Wrong selected-tool arguments.' },
      },
    }, 'tool arguments must match the selected tool');
    assertV3Rejected(validate, {
      ...incompleteBase,
      followUp: {
        type: 'tool',
        tool: 'explore_repo',
        arguments: { task: 'Search.', hints: { strategy: 'breadth-first' } },
      },
    }, 'follow-up arguments cannot expose hints.strategy');

    const failureReasons = [
      'invalid_arguments',
      'repo_mismatch',
      'aborted',
      'provider_error',
      'tool_failure',
      'verifier_error',
      'access_denied',
      'internal_error',
    ];
    for (const reason of failureReasons) {
      assert.doesNotThrow(() => validate({
        schemaVersion: 3,
        directAnswer: 'Explorer could not produce a trustworthy answer.',
        state: 'failed',
        failure: { reason },
      }), reason);
    }
    assert.doesNotThrow(() => validate({
      schemaVersion: 3,
      directAnswer: 'Provider failed before verification.',
      state: 'failed',
      failure: {
        reason: 'provider_error',
        retry: {
          type: 'tool',
          tool: 'explore_repo',
          arguments: { task: 'Trace token validation.' },
        },
      },
    }));

    const nestedMutations = [
      ['target', makeV3Complete({ targets: [makeV3Target({ unexpected: true })] })],
      ['source evidence', makeV3Complete({ evidence: [{ ...source, unexpected: true }] })],
      ['git evidence', makeV3Complete({ evidence: [{ ...git, unexpected: true }] })],
      ['absence evidence', makeV3Complete({ evidence: [{ ...absence, unexpected: true }] })],
      ['gap', { ...incompleteBase, gaps: [{ ...incompleteBase.gaps[0], unexpected: true }] }],
      ['follow-up', {
        ...incompleteBase,
        followUp: { type: 'ask_user', question: 'Which deployment?', unexpected: true },
      }],
      ['failure', {
        schemaVersion: 3,
        directAnswer: 'Explorer failed.',
        state: 'failed',
        failure: { reason: 'internal_error', unexpected: true },
      }],
      ['retry', {
        schemaVersion: 3,
        directAnswer: 'Provider failed.',
        state: 'failed',
        failure: {
          reason: 'provider_error',
          retry: {
            type: 'tool',
            tool: 'explore_repo',
            arguments: { task: 'Retry.' },
            unexpected: true,
          },
        },
      }],
    ];
    for (const [label, value] of nestedMutations) {
      assertV3Rejected(validate, value, `${label} rejects additional properties`);
    }
  },
);

parentHandoffV3Test(
  'Spec 028 T036 — schema v3 rejects schema v2 and diagnostic fields',
  (_schema, validate) => {
    assertV3Rejected(validate, { ...makeV3Complete(), schemaVersion: 2 },
      'schemaVersion 2 is rejected');
    assertV3Rejected(validate, { ...makeV3Complete(), state: 'verified' },
      'v2 verification values are rejected');
    for (const field of [
      'status',
      'verification',
      'confidence',
      'complete',
      'warnings',
      'nextAction',
      'evidenceQuality',
      'searchCoverage',
      'critic',
      'discoveredPaths',
      'candidatePaths',
      'uncertainties',
      'trustSummary',
    ]) {
      const invalid = makeV3Complete();
      invalid[field] = field === 'complete' ? true : {};
      assertV3Rejected(validate, invalid, `v2 field ${field} is rejected`);
    }
  },
);

// Helper: build a grounded evidence item with a given groundingStatus and optional path
function makeEvidence({ groundingStatus = 'exact', path = 'src/foo.mjs' } = {}) {
  return { groundingStatus, path, startLine: 1, endLine: 10, why: 'test' };
}

// Helper: minimal stats object
function makeStats(overrides = {}) {
  return {
    grepCalls: 0,
    symbolCalls: 0,
    safetyLimits: [],
    gitLogCalls: 0,
    gitDiffCalls: 0,
    gitBlameCalls: 0,
    ...overrides,
  };
}

// ── computeConfidenceScore ────────────────────────────────────────────────────

test('computeConfidenceScore: single exact evidence item from one file cannot reach high', () => {
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const { level } = computeConfidenceScore(evidence, 1, makeStats());
  assert.notEqual(level, 'high', 'single exact evidence from one file must not be high');
});

test('computeConfidenceScore: partial-only evidence cannot become high', () => {
  const evidence = [
    makeEvidence({ groundingStatus: 'partial', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'partial', path: 'src/b.mjs' }),
    makeEvidence({ groundingStatus: 'partial', path: 'src/c.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 3, makeStats());
  assert.notEqual(level, 'high', 'partial-only evidence must not reach high confidence');
});

test('computeConfidenceScore: single exact evidence from one file can reach medium or high', () => {
  // With recalibrated base scores: 1 exact item from 1 file
  // base=0.30 + exact=0.18 + search=0 = 0.48 → medium, or higher with search
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const { level } = computeConfidenceScore(evidence, 1, makeStats());
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: two exact items from two different files can be high', () => {
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/b.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 2, makeStats({ grepCalls: 1 }));
  // With recalibrated scores: base=0.30 + 2*exact=0.36 + cross=0.12 + search=0.05 = 0.83 → high
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: two exact items from same file can reach high (relaxed gate)', () => {
  // Same path → distinctFiles = 1, but 2 exact items satisfy the relaxed gate (exactCount >= 1)
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
  ];
  const { level } = computeConfidenceScore(evidence, 2, makeStats({ grepCalls: 1 }));
  // base=0.30 + 2*exact=0.36 + search=0.05 = 0.71 → high (no longer capped for single-file)
  assert.ok(['medium', 'high'].includes(level), `expected medium or high, got ${level}`);
});

test('computeConfidenceScore: safety-limit observations are not confidence inputs', () => {
  const evidence = [
    makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' }),
    makeEvidence({ groundingStatus: 'exact', path: 'src/b.mjs' }),
  ];
  const withLimit = computeConfidenceScore(evidence, 2, makeStats({
    safetyLimits: [{
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: ['S1'],
      truncated: true,
    }],
  }));
  const withoutLimit = computeConfidenceScore(evidence, 2, makeStats());
  assert.equal(withLimit.score, withoutLimit.score,
    'proof-state limits must not be converted into confidence penalties');
});

test('computeConfidenceScore: no evidence returns score 0.10 and low level', () => {
  const { score, level } = computeConfidenceScore([], 0, makeStats());
  assert.equal(score, 0.1);
  assert.equal(level, 'low');
});

test('computeConfidenceScore: dropped evidence reduces score by 0.25', () => {
  // 2 items originally, 1 grounded
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const withDrop = computeConfidenceScore(evidence, 2, makeStats()); // 1 dropped
  const noDrop = computeConfidenceScore(evidence, 1, makeStats());  // 0 dropped
  assert.ok(withDrop.score < noDrop.score, 'dropped evidence must lower the score');
  const dropAdjustment = withDrop.factors.adjustments.some(a => a.includes('dropped as ungrounded'));
  assert.ok(dropAdjustment, 'adjustment note for dropped evidence should be present');
});

test('computeConfidenceScore: locate taskKind starts from higher base score', () => {
  const evidence = [makeEvidence({ groundingStatus: 'exact', path: 'src/a.mjs' })];
  const locateResult = computeConfidenceScore(evidence, 1, makeStats(), 'locate');
  const defaultResult = computeConfidenceScore(evidence, 1, makeStats(), undefined);
  assert.ok(locateResult.score > defaultResult.score,
    'locate taskKind must have a higher base score than default');
});

// ── reconcileConfidence ───────────────────────────────────────────────────────

test('reconcileConfidence: always returns computedLevel when evidence was dropped', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'low',
    droppedEvidence: 1,
  });
  assert.equal(result, 'low', 'dropped evidence must force computed level');
});

test('reconcileConfidence: safety-limit metadata does not create a separate confidence branch', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
    safetyLimits: [{
      name: 'turn_limit',
      stage: 'exploration',
      affectedSubgoalIds: ['S1'],
      truncated: false,
    }],
  });
  assert.equal(result, 'medium', 'normal model/computed reconciliation still applies');
});

test('reconcileConfidence: locate still takes the lower of model and computed confidence', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
  });
  assert.equal(result, 'medium', 'locate must not bypass computed confidence');
});

test('reconcileConfidence: non-locate takes the lower of model and computed', () => {
  const result = reconcileConfidence({
    modelConfidence: 'high',
    computedLevel: 'medium',
    droppedEvidence: 0,
  });
  assert.equal(result, 'medium', 'non-locate must take the lower confidence');
});

test('reconcileConfidence: model low is preserved even when computed is high', () => {
  const result = reconcileConfidence({
    modelConfidence: 'low',
    computedLevel: 'high',
    droppedEvidence: 0,
  });
  assert.equal(result, 'low', 'lower of model/computed wins; here model=low');
});

test('public strategy input stays removed', () => {
  assert.equal(
    EXPLORE_REPO_INPUT_SCHEMA.properties.hints.properties.strategy,
    undefined,
    'spec 028: strategy selection is runtime-owned',
  );
});

// Named T010 imports keep these trust-plane contracts fail-closed if an export
// is removed or renamed later.
function makeValidRequiredSubgoal(overrides = {}) {
  const subgoal = {
    id: 'S1',
    question: 'Where is the auth policy defined?',
    originRefs: ['request:0-32'],
    claimType: 'positive',
    proofPolicy: 'direct_source',
    proofCondition: 'Observe the in-scope implementation.',
    constraints: [],
    auditVerdict: 'ready',
    state: 'audited',
    claimRefs: [],
    ...overrides,
  };
  subgoal.auditBinding = computeGoalAuditBinding(subgoal);
  return subgoal;
}

function makeValidTaskContract() {
  return {
    task: 'Find the auth policy implementation.',
    effectiveScope: ['src'],
    constraints: [],
    capabilities: {
      repositoryRead: true,
      gitRead: true,
      repositoryWrite: false,
      liveRuntimeState: false,
      scopeWidening: false,
      secretPathRead: false,
    },
    subgoals: [makeValidRequiredSubgoal()],
    plannerVersion: 'planner-v1',
    goalAuditVersion: 'goal-audit-v1',
  };
}

internalSchemaTest(
  TASK_CONTRACT_SCHEMA,
  validateTaskContract,
  'Spec 028 T006 — TaskContract and runtime-owned nested entities are strict',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'TASK_CONTRACT_SCHEMA');
    assertSchemaKeys(schema, {
      required: [
        'task',
        'effectiveScope',
        'constraints',
        'capabilities',
        'subgoals',
        'plannerVersion',
        'goalAuditVersion',
      ],
    }, 'TASK_CONTRACT_SCHEMA');
    assert.equal(schema.properties.task.type, 'string');
    assertStringArraySchema(schema.properties.effectiveScope,
      'TASK_CONTRACT_SCHEMA.effectiveScope');
    assertStringArraySchema(schema.properties.constraints,
      'TASK_CONTRACT_SCHEMA.constraints');
    assert.equal(schema.properties.subgoals.type, 'array');
    assert.equal(schema.properties.subgoals.maxItems, undefined,
      '12 is a processing batch size, not a semantic subgoal cap');
    assert.equal(schema.properties.plannerVersion.type, 'string');
    assert.equal(schema.properties.goalAuditVersion.type, 'string');

    const capabilitySchema = schema.properties.capabilities;
    assertSchemaKeys(capabilitySchema, {
      required: [
        'repositoryRead',
        'gitRead',
        'repositoryWrite',
        'liveRuntimeState',
        'scopeWidening',
        'secretPathRead',
      ],
    }, 'TASK_CONTRACT_SCHEMA.capabilities');
    assert.equal(capabilitySchema.properties.repositoryRead.const, true);
    assert.equal(capabilitySchema.properties.gitRead.const, true);
    assert.equal(capabilitySchema.properties.repositoryWrite.const, false);
    assert.equal(capabilitySchema.properties.liveRuntimeState.const, false);
    assert.equal(capabilitySchema.properties.scopeWidening.const, false);
    assert.equal(capabilitySchema.properties.secretPathRead.const, false);

    const subgoalSchema = schema.properties.subgoals.items;
    assertSchemaKeys(subgoalSchema, {
      required: [
        'id',
        'question',
        'originRefs',
        'claimType',
        'proofPolicy',
        'proofCondition',
        'constraints',
        'auditVerdict',
        'auditBinding',
        'state',
        'claimRefs',
      ],
      optional: ['resolution', 'blockerRef', 'gapRef'],
    }, 'TASK_CONTRACT_SCHEMA.subgoals[]');
    assertStringProperties(subgoalSchema, [
      'id',
      'question',
      'claimType',
      'proofPolicy',
      'proofCondition',
      'auditVerdict',
      'auditBinding',
      'state',
      'resolution',
      'blockerRef',
      'gapRef',
    ], 'TASK_CONTRACT_SCHEMA.subgoals[]');
    assertStringArraySchema(subgoalSchema.properties.originRefs,
      'TASK_CONTRACT_SCHEMA.subgoals[].originRefs');
    assert.equal(subgoalSchema.properties.originRefs.minItems, 1);
    assertStringArraySchema(subgoalSchema.properties.constraints,
      'TASK_CONTRACT_SCHEMA.subgoals[].constraints');
    assertStringArraySchema(subgoalSchema.properties.claimRefs,
      'TASK_CONTRACT_SCHEMA.subgoals[].claimRefs');

    const validContract = makeValidTaskContract();
    for (const mutate of [
      goal => { goal.id = 'S2'; },
      goal => { goal.question = 'Where is the changed auth policy defined?'; },
      goal => { goal.originRefs = ['request:1-32']; },
      goal => { goal.claimType = 'claim_verification'; goal.proofPolicy = 'support_or_refute'; },
      goal => { goal.proofPolicy = 'bounded_absence'; goal.claimType = 'absence'; },
      goal => { goal.proofCondition = 'Observe a different acceptance condition.'; },
      goal => { goal.constraints = ['A new immutable constraint.']; },
      goal => { goal.auditVerdict = 'unverifiable'; },
    ]) {
      const mutated = structuredClone(validContract);
      mutate(mutated.subgoals[0]);
      assert.throws(() => validate(mutated), /auditBinding/,
        'every immutable acceptance-core mutation must invalidate the audit binding');
    }

    const reordered = makeValidTaskContract();
    reordered.subgoals[0] = makeValidRequiredSubgoal({
      originRefs: ['request:0-32', 'request:0-10'],
      constraints: ['second', 'first'],
    });
    reordered.subgoals[0].originRefs.reverse();
    reordered.subgoals[0].constraints.reverse();
    assert.doesNotThrow(() => validate(reordered),
      'origin and constraint order is not part of the immutable binding');

    const mutableState = makeValidTaskContract();
    mutableState.subgoals[0].state = 'exploring';
    mutableState.subgoals[0].claimRefs = ['C1'];
    assert.doesNotThrow(() => validate(mutableState),
      'runtime exploration state is intentionally outside the audit binding');

    const duplicateIds = makeValidTaskContract();
    duplicateIds.subgoals.push(structuredClone(duplicateIds.subgoals[0]));
    assert.throws(() => validate(duplicateIds), /duplicate subgoal id/i,
      'schema validation must independently reject duplicate goal identities');
    assert.deepEqual(subgoalSchema.properties.claimType.enum, [
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
    assert.deepEqual(subgoalSchema.properties.proofPolicy.enum, [
      'direct_source',
      'bounded_absence',
      'deterministic_count',
      'symbol_definition',
      'bounded_usage_cross_check',
      'ordered_handoffs',
      'impact_categories',
      'distinct_policy_paths',
      'support_or_refute',
    ]);
    assert.deepEqual(subgoalSchema.properties.auditVerdict.enum, [
      'ready',
      'blocked_scope',
      'blocked_capability',
      'requires_external_state',
      'missing_input',
      'contradictory',
      'unverifiable',
      'planning_incomplete',
    ]);
    assert.deepEqual(subgoalSchema.properties.state.enum, [
      'audited',
      'blocked',
      'exploring',
      'candidate',
      'supported',
      'gap',
      'contradicted',
    ]);
    assert.deepEqual(subgoalSchema.properties.resolution.enum, ['affirmed', 'refuted']);

    const valid = makeValidTaskContract();
    assertStrictValidator(validate, valid, {
      missingKey: 'task',
      makeInvalid: value => { value.subgoals[0].state = 'done'; },
    });
    const nestedExtra = structuredClone(valid);
    nestedExtra.subgoals[0].priority = 1;
    assert.throws(() => validate(nestedExtra));
    const capabilityExtra = structuredClone(valid);
    capabilityExtra.capabilities.networkRead = true;
    assert.throws(() => validate(capabilityExtra));
    const capabilityEscalation = structuredClone(valid);
    capabilityEscalation.capabilities.repositoryWrite = true;
    assert.throws(() => validate(capabilityEscalation));
    const emptyOrigin = structuredClone(valid);
    emptyOrigin.subgoals[0].originRefs = [];
    assert.throws(() => validate(emptyOrigin));
    const invalidConstraint = structuredClone(valid);
    invalidConstraint.constraints = [null];
    assert.throws(() => validate(invalidConstraint));
    const emptyTask = structuredClone(valid);
    emptyTask.task = '';
    assert.throws(() => validate(emptyTask));
  },
);

internalSchemaTest(
  GOAL_AUDIT_RECORD_SCHEMA,
  validateGoalAuditRecord,
  'Spec 028 T006 — goal-audit records are strict and categorical',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'GOAL_AUDIT_RECORD_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['proposedGoalId', 'verdict', 'originRefs', 'missingRequestParts', 'reason'],
      optional: ['mergeInto'],
    }, 'GOAL_AUDIT_RECORD_SCHEMA');
    assertStringArraySchema(schema.properties.originRefs,
      'GOAL_AUDIT_RECORD_SCHEMA.originRefs');
    assertStringArraySchema(schema.properties.missingRequestParts,
      'GOAL_AUDIT_RECORD_SCHEMA.missingRequestParts');
    assertStringProperties(schema, [
      'proposedGoalId',
      'verdict',
      'mergeInto',
      'reason',
    ], 'GOAL_AUDIT_RECORD_SCHEMA');
    assert.deepEqual(schema.properties.verdict.enum, [
      'ready',
      'merge_duplicate',
      'needs_decomposition',
      'reject_untraceable',
      'blocked_scope',
      'blocked_capability',
      'requires_external_state',
      'missing_input',
      'contradictory',
      'unverifiable',
    ]);

    assertStrictValidator(validate, {
      proposedGoalId: 'S1',
      verdict: 'ready',
      originRefs: ['request:0-32'],
      missingRequestParts: [],
      reason: 'Traceable and observable.',
    }, {
      missingKey: 'proposedGoalId',
      makeInvalid: value => { value.verdict = 'approved'; },
    });
  },
);

internalSchemaTest(
  ATOMIC_CLAIM_SCHEMA,
  validateAtomicClaim,
  'Spec 028 T006 — atomic claims are strict and carry one runtime verdict',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'ATOMIC_CLAIM_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['id', 'subgoalId', 'text', 'evidenceRefs', 'verdict'],
      optional: ['measurement'],
    }, 'ATOMIC_CLAIM_SCHEMA');
    assertStringArraySchema(schema.properties.evidenceRefs,
      'ATOMIC_CLAIM_SCHEMA.evidenceRefs');
    assertStringProperties(schema, [
      'id',
      'subgoalId',
      'text',
      'verdict',
    ], 'ATOMIC_CLAIM_SCHEMA');
    assert.equal(schema.properties.evidenceRefs.minItems, 1);
    assert.deepEqual(schema.properties.verdict.enum, [
      'pending',
      'supported',
      'insufficient',
      'contradicted',
    ]);
    assertSchemaKeys(schema.properties.measurement, {
      required: ['kind', 'unit', 'value'],
    }, 'ATOMIC_CLAIM_SCHEMA.measurement');
    assert.deepEqual(schema.properties.measurement.properties.unit.enum,
      ['matching_lines', 'files', 'array_entries']);
    assert.equal(schema.properties.measurement.properties.value.minimum, 0);

    assertStrictValidator(validate, {
      id: 'C1',
      subgoalId: 'S1',
      text: 'The policy is defined in src/auth.mjs.',
      evidenceRefs: ['E1'],
      verdict: 'pending',
    }, {
      missingKey: 'id',
      makeInvalid: value => { value.verdict = 'verified'; },
    });
  },
);

internalSchemaTest(
  SEMANTIC_VERDICT_SCHEMA,
  validateSemanticVerdict,
  'Spec 028 T006 — semantic verdicts are strict and cannot rewrite claims',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'SEMANTIC_VERDICT_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['claimId', 'result', 'supportingEvidenceRefs', 'reasonCode', 'note'],
      optional: ['resolution'],
    }, 'SEMANTIC_VERDICT_SCHEMA');
    assertStringArraySchema(schema.properties.supportingEvidenceRefs,
      'SEMANTIC_VERDICT_SCHEMA.supportingEvidenceRefs');
    assertStringProperties(schema, [
      'claimId',
      'result',
      'resolution',
      'reasonCode',
      'note',
    ], 'SEMANTIC_VERDICT_SCHEMA');
    assert.deepEqual(schema.properties.result.enum, [
      'supported',
      'insufficient',
      'contradicted',
    ]);
    assert.deepEqual(schema.properties.resolution.enum, ['affirmed', 'refuted']);
    assert.deepEqual(schema.properties.reasonCode.enum, [
      'entailed',
      'semantic_mismatch',
      'overgeneralized',
      'missing_transition',
      'missing_category',
      'boundary_mismatch',
      'contradiction',
      'uncovered_request',
    ]);
    assert.equal(schema.properties.text, undefined);
    assert.equal(schema.properties.evidence, undefined);

    assertStrictValidator(validate, {
      claimId: 'C1',
      result: 'supported',
      resolution: 'affirmed',
      supportingEvidenceRefs: ['E1'],
      reasonCode: 'entailed',
      note: 'The cited implementation directly supports the claim.',
    }, {
      missingKey: 'claimId',
      makeInvalid: value => { value.reasonCode = 'confident'; },
    });

    const missingResolution = {
      claimId: 'C1',
      result: 'supported',
      supportingEvidenceRefs: ['E1'],
      reasonCode: 'entailed',
      note: 'Supported without a runtime resolution.',
    };
    assert.throws(() => validate(missingResolution));
    assert.throws(() => validate({
      ...missingResolution,
      result: 'insufficient',
      resolution: 'affirmed',
      supportingEvidenceRefs: [],
      reasonCode: 'semantic_mismatch',
    }));
  },
);

internalSchemaTest(
  CLAIM_SYNTHESIS_SCHEMA,
  validateClaimSynthesisResponse,
  'Spec 028 T028 — claim synthesis emits references, never model-authored verdicts or evidence facts',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'CLAIM_SYNTHESIS_SCHEMA');
    assertSchemaKeys(schema, { required: ['claims'] }, 'CLAIM_SYNTHESIS_SCHEMA');
    assert.equal(schema.properties.claims.type, 'array');
    const claimSchema = schema.properties.claims.items;
    assertSchemaKeys(claimSchema, {
      required: ['id', 'subgoalId', 'text', 'evidenceRefs'],
      optional: ['measurement'],
    }, 'CLAIM_SYNTHESIS_SCHEMA.claims.items');
    assertStringArraySchema(claimSchema.properties.evidenceRefs,
      'CLAIM_SYNTHESIS_SCHEMA.claims.items.evidenceRefs');
    assert.equal(claimSchema.properties.evidenceRefs.minItems, undefined,
      'provider-facing strict schemas must avoid unsupported minItems');
    for (const forbidden of ['verdict', 'evidence', 'snippet', 'matchCount', 'complete']) {
      assert.equal(claimSchema.properties[forbidden], undefined);
    }

    const valid = {
      claims: [{
        id: 'C1',
        subgoalId: 'S1',
        text: 'requireAuth is defined in src/auth.js.',
        evidenceRefs: ['E1'],
      }],
    };
    assertStrictValidator(validate, valid, {
      missingKey: 'claims',
      makeInvalid: value => { value.claims = 'not-an-array'; },
    });
    assert.throws(() => validate({
      claims: [{ ...valid.claims[0], verdict: 'supported' }],
    }));
    assert.throws(() => validate({
      claims: [{ ...valid.claims[0], evidenceRefs: [] }],
    }), 'local validation must reject empty evidence references');
    assert.doesNotThrow(() => validate({
      claims: [{
        ...valid.claims[0],
        measurement: { kind: 'count', unit: 'matching_lines', value: 2 },
      }],
    }));
    assert.throws(() => validate({
      claims: [{
        ...valid.claims[0],
        measurement: { kind: 'count', unit: 'matching_lines', value: -1 },
      }],
    }));
  },
);

internalSchemaTest(
  SEMANTIC_VERIFIER_RESPONSE_SCHEMA,
  validateSemanticVerifierResponse,
  'Spec 028 T028 — verifier can return verdicts and goal proposals but cannot rewrite claims',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'SEMANTIC_VERIFIER_RESPONSE_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['verdicts', 'uncoveredRequestParts'],
    }, 'SEMANTIC_VERIFIER_RESPONSE_SCHEMA');
    assert.equal(schema.properties.verdicts.items, SEMANTIC_VERDICT_SCHEMA);
    assert.equal(schema.properties.uncoveredRequestParts.type, 'array');
    for (const forbidden of ['claims', 'directAnswer', 'evidence', 'confidence']) {
      assert.equal(schema.properties[forbidden], undefined);
    }

    const valid = {
      verdicts: [{
        claimId: 'C1',
        result: 'supported',
        resolution: 'affirmed',
        supportingEvidenceRefs: ['E1'],
        reasonCode: 'entailed',
        note: 'The rebuilt source entails the existing claim.',
      }],
      uncoveredRequestParts: [],
    };
    assertStrictValidator(validate, valid, {
      missingKey: 'verdicts',
      makeInvalid: value => { value.uncoveredRequestParts = false; },
    });
    assert.throws(() => validate({
      ...valid,
      verdicts: [{ ...valid.verdicts[0], text: 'A rewritten claim.' }],
    }));
  },
);

internalSchemaTest(
  ABSENCE_CERTIFICATE_SCHEMA,
  validateAbsenceCertificate,
  'Spec 028 T006 — absence certificates are strict runtime-owned proof objects',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'ABSENCE_CERTIFICATE_SCHEMA');
    assertSchemaKeys(schema, {
      required: [
        'id',
        'subgoalId',
        'claimBoundary',
        'searchRefs',
        'searchSummary',
        'complete',
        'zeroMatches',
      ],
      optional: ['qualification'],
    }, 'ABSENCE_CERTIFICATE_SCHEMA');
    assertStringArraySchema(schema.properties.claimBoundary,
      'ABSENCE_CERTIFICATE_SCHEMA.claimBoundary');
    assertStringArraySchema(schema.properties.searchRefs,
      'ABSENCE_CERTIFICATE_SCHEMA.searchRefs');
    assertStringArraySchema(schema.properties.searchSummary,
      'ABSENCE_CERTIFICATE_SCHEMA.searchSummary');
    assertStringProperties(schema, [
      'id',
      'subgoalId',
      'qualification',
    ], 'ABSENCE_CERTIFICATE_SCHEMA');
    assert.equal(schema.properties.complete.type, 'boolean');
    assert.equal(schema.properties.zeroMatches.type, 'boolean');

    assertStrictValidator(validate, {
      id: 'A1',
      subgoalId: 'S1',
      claimBoundary: ['src'],
      searchRefs: ['O1'],
      searchSummary: ['legacy route registration'],
      complete: true,
      zeroMatches: true,
      qualification: 'Static in-scope source only.',
    }, {
      missingKey: 'id',
      makeInvalid: value => { value.complete = 'yes'; },
    });
    assert.doesNotThrow(() => validate({
      id: 'A2',
      subgoalId: 'S2',
      claimBoundary: [],
      searchRefs: [],
      searchSummary: [],
      complete: false,
      zeroMatches: false,
    }), 'an incomplete certificate may preserve an empty repository boundary and no searches');
  },
);

internalSchemaTest(
  SAFETY_LIMIT_SCHEMA,
  validateSafetyLimit,
  'Spec 028 T006 — safety limits use exact strict ceiling and stage enums',
  (schema, validate) => {
    assertStrictObjectTree(schema, 'SAFETY_LIMIT_SCHEMA');
    assertSchemaKeys(schema, {
      required: ['name', 'stage', 'affectedSubgoalIds', 'truncated'],
    }, 'SAFETY_LIMIT_SCHEMA');
    assertStringArraySchema(schema.properties.affectedSubgoalIds,
      'SAFETY_LIMIT_SCHEMA.affectedSubgoalIds');
    assertStringProperties(schema, ['name', 'stage'], 'SAFETY_LIMIT_SCHEMA');
    assert.deepEqual(schema.properties.name.enum, [
      'turn_limit',
      'context_limit',
      'generation_output_limit',
      'walk_limit',
      'tool_result_limit',
    ]);
    assert.deepEqual(schema.properties.stage.enum, [
      'planner',
      'goal_audit',
      'plan_revision',
      'exploration',
      'synthesis',
      'verification',
      'repair',
    ]);
    assert.equal(schema.properties.affectedSubgoalIds.minItems ?? 0, 0,
      'an operational-only limit may affect no subgoal');
    assert.equal(schema.properties.truncated.type, 'boolean');

    assertStrictValidator(validate, {
      name: 'tool_result_limit',
      stage: 'exploration',
      affectedSubgoalIds: [],
      truncated: true,
    }, {
      missingKey: 'name',
      makeInvalid: value => { value.name = 'unknown_ceiling'; },
    });
  },
);

test('internal model result schema uses the compact explore contract', () => {
  assert.deepEqual(EXPLORE_RESULT_JSON_SCHEMA.schema.required, [
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
  ]);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.directAnswer);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.status);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.targets);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.evidence);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.uncertainties);
  assert.ok(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.nextAction);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.answer, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.summary, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.confidence, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.candidatePaths, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.followups, undefined);
});

test('validateExploreRepoArgs rejects unknown public keys', () => {
  assert.throws(
    () => validateExploreRepoArgs({ task: 'find auth code', context: 'ignore this' }),
    /Unknown explore_repo argument: context/,
  );
});

test('validateExploreRepoArgs rejects unknown hint keys', () => {
  assert.throws(
    () => validateExploreRepoArgs({
      task: 'find auth code',
      hints: { files: ['src/auth.js'], taskMode: 'locate' },
    }),
    /Unknown explore_repo hints argument: taskMode/,
  );
});

test('agent-facing output is v3 while model synthesis remains an internal compact contract', () => {
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.required, ['schemaVersion', 'state']);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const, 3);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.directAnswer);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.state);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.targets);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.evidence);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.gaps);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.followUp);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure);
  for (const removed of [
    'status',
    'discoveredPaths',
    'uncertainties',
    'nextAction',
    'evidenceQuality',
    'searchCoverage',
    'critic',
    'sessionId',
    'session',
    '_debug',
  ]) {
    assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties[removed], undefined, removed);
  }
  assert.equal(EXPLORE_REPO_INPUT_SCHEMA.properties.session, undefined);

  assert.deepEqual(EXPLORE_RESULT_JSON_SCHEMA.schema.required, [
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
  ]);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.schemaVersion, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.evidenceQuality, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.failure, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.searchCoverage, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.critic, undefined);
});

test('normalizeExploreResult accepts compact result fields without legacy aliases', () => {
  const result = normalizeExploreResult({
    directAnswer: 'direct',
    status: {
      confidence: 'high',
      verification: 'targeted_read_needed',
      complete: true,
      warnings: [],
    },
    targets: [
      {
        path: 'src/auth.js',
        startLine: 1,
        endLine: 4,
        role: 'read',
        reason: 'definition',
        evidenceRefs: ['E1'],
      },
    ],
    evidence: [
      {
        id: 'E1',
        path: 'src/auth.js',
        startLine: 1,
        endLine: 4,
        why: 'definition',
        snippet: '1: export function requireAuth() {}',
      },
    ],
    uncertainties: ['read auth before editing'],
    nextAction: {
      type: 'read_target',
      reason: 'Read src/auth.js before editing.',
    },
  }, makeStats());

  assert.equal(result.directAnswer, 'direct');
  assert.equal(result.status.verification, 'targeted_read_needed');
  assert.equal(result.targets[0].evidenceRefs[0], 'E1');
  assert.equal(result.evidence[0].snippet, undefined);
  assert.deepEqual(result.uncertainties, ['read auth before editing']);
  assert.equal(result.nextAction.type, 'read_target');
  assert.equal(result.answer, undefined);
  assert.equal(result.candidatePaths, undefined);
  assert.equal(result.followups, undefined);
});

test('retry tool vocabulary includes explain_code_path and stays set-equal across modules', () => {
  assert.ok(
    RETRY_SCHEMA.properties.tool.enum.includes('explain_code_path'),
    'RETRY_SCHEMA tool enum must include explain_code_path',
  );
  assert.deepEqual(
    new Set(RETRY_SCHEMA.properties.tool.enum),
    new Set(RETRY_TOOLS),
    'schema tool enum and runtime RETRY_TOOLS must have the same members',
  );
});

test('normalizeExploreResult marks malformed evidence ranges instead of coercing to line 1', () => {
  const result = normalizeExploreResult({
    directAnswer: 'direct',
    status: {
      confidence: 'medium',
      verification: 'verified',
      complete: true,
      warnings: [],
    },
    targets: [],
    evidence: [
      { path: 'src/auth.js', why: 'missing range' },
      { path: 'src/auth.js', startLine: '1', endLine: 2, why: 'non-integer start' },
      { path: 'src/auth.js', startLine: 5, endLine: 3, why: 'inverted range' },
      { path: 'src/auth.js', startLine: 1, endLine: 2, why: 'valid range' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
  }, makeStats());

  assert.equal(result.evidence.length, 4);
  assert.equal(result.evidence[0].malformedRange, true);
  assert.equal(result.evidence[0].startLine, undefined);
  assert.equal(result.evidence[0].endLine, undefined);
  assert.equal(result.evidence[1].malformedRange, true);
  assert.equal(result.evidence[1].startLine, undefined);
  assert.equal(result.evidence[1].endLine, 2);
  assert.equal(result.evidence[2].malformedRange, true);
  assert.equal(result.evidence[2].startLine, 5);
  assert.equal(result.evidence[2].endLine, 3);
  assert.equal(result.evidence[3].malformedRange, undefined);
  assert.equal(result.evidence[3].startLine, 1);
  assert.equal(result.evidence[3].endLine, 2);
});

test('normalizeExploreResult marks unsafe and overly broad evidence ranges as malformed', () => {
  const result = normalizeExploreResult({
    directAnswer: 'direct',
    status: { confidence: 'medium', verification: 'verified', complete: true, warnings: [] },
    targets: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1e100, endLine: 1e100, why: 'unsafe range' },
      { path: 'src/auth.js', startLine: 1, endLine: 10_001, why: 'overly broad range' },
      { path: 'src/auth.js', startLine: 1, endLine: 10_000, why: 'maximum valid range' },
    ],
    uncertainties: [],
    nextAction: { type: 'stop', reason: 'Complete.' },
  }, makeStats());

  assert.equal(result.evidence[0].malformedRange, true);
  assert.equal(result.evidence[0].startLine, undefined);
  assert.equal(result.evidence[0].endLine, undefined);
  assert.equal(result.evidence[1].malformedRange, true);
  assert.equal(result.evidence[1].startLine, 1);
  assert.equal(result.evidence[1].endLine, 10_001);
  assert.equal(result.evidence[2].malformedRange, undefined);
  assert.equal(result.evidence[2].startLine, 1);
  assert.equal(result.evidence[2].endLine, 10_000);
});

const PLANNER_TASK = 'Trace authenticateUser and verify that legacyLogin is absent.';
const REQUEST_ORIGIN = 'request:0-22';
const TRACE_DEFINITION_ORIGIN = 'wrapper:trace_symbol:definition';

function plannerGoal(overrides = {}) {
  return {
    id: 'S1',
    question: 'Where is authenticateUser defined?',
    originRefs: [REQUEST_ORIGIN],
    claimType: 'symbol_definition',
    proofCondition: 'Observe the in-scope definition and source body.',
    constraints: [],
    ...overrides,
  };
}

function plannerProposal(subgoals = [plannerGoal()], overrides = {}) {
  return {
    taskSummary: 'Trace authenticateUser and check the legacy registration.',
    constraints: ['Do not infer deployed runtime state.'],
    subgoals,
    ...overrides,
  };
}

function goalAudit(goal, verdict = 'ready', overrides = {}) {
  return {
    proposedGoalId: goal.id,
    verdict,
    originRefs: [...goal.originRefs],
    missingRequestParts: [],
    reason: `Categorized as ${verdict}.`,
    ...overrides,
  };
}

function auditorResponse(goals, uncoveredRequestParts = []) {
  return { goals, uncoveredRequestParts };
}

function validatePlanner(value, context = {}) {
  assert.equal(typeof schemaModule.validatePlannerProposal, 'function');
  return schemaModule.validatePlannerProposal(value, {
    task: PLANNER_TASK,
    wrapperTool: 'trace_symbol',
    ...context,
  });
}

function validateAuditor(value, proposal, context = {}) {
  assert.equal(typeof schemaModule.validateGoalAuditorResponse, 'function');
  return schemaModule.validateGoalAuditorResponse(value, {
    task: PLANNER_TASK,
    wrapperTool: 'trace_symbol',
    plannerProposal: proposal,
    ...context,
  });
}

test('Spec 028 T016 — planner and auditor schemas are strict control-plane objects', () => {
  const plannerSchema = schemaModule.PLANNER_PROPOSAL_SCHEMA;
  const auditorSchema = schemaModule.GOAL_AUDITOR_RESPONSE_SCHEMA;
  assertStrictObjectTree(plannerSchema, 'PLANNER_PROPOSAL_SCHEMA');
  assertStrictObjectTree(auditorSchema, 'GOAL_AUDITOR_RESPONSE_SCHEMA');
  assertSchemaKeys(plannerSchema, {
    required: ['taskSummary', 'constraints', 'subgoals'],
  }, 'PLANNER_PROPOSAL_SCHEMA');
  assertSchemaKeys(plannerSchema.properties.subgoals.items, {
    required: ['id', 'question', 'originRefs', 'claimType', 'proofCondition', 'constraints'],
  }, 'PLANNER_PROPOSAL_SCHEMA.subgoals[]');
  assertSchemaKeys(auditorSchema, {
    required: ['goals', 'uncoveredRequestParts'],
  }, 'GOAL_AUDITOR_RESPONSE_SCHEMA');
  assert.equal(auditorSchema.properties.goals.items, schemaModule.GOAL_AUDIT_RECORD_SCHEMA);
  assert.equal(auditorSchema.properties.uncoveredRequestParts.items,
    schemaModule.LATE_UNCOVERED_PROPOSAL_SCHEMA);
  assert.equal('proofPolicy' in plannerSchema.properties.subgoals.items.properties, false);
  assert.equal('auditBinding' in plannerSchema.properties.subgoals.items.properties, false);
  for (const runtimeOwned of ['revisionRequired', 'revisionCount', 'requestRevision']) {
    assert.equal(runtimeOwned in plannerSchema.properties, false);
    assert.equal(runtimeOwned in auditorSchema.properties, false);
  }
});

test('Spec 028 T020 — provider control schemas avoid unsupported validation keywords', () => {
  for (const [label, root] of [
    ['PLANNER_PROPOSAL_SCHEMA', schemaModule.PLANNER_PROPOSAL_SCHEMA],
    ['GOAL_AUDITOR_RESPONSE_SCHEMA', schemaModule.GOAL_AUDITOR_RESPONSE_SCHEMA],
    ['CLAIM_SYNTHESIS_SCHEMA', schemaModule.CLAIM_SYNTHESIS_SCHEMA],
    ['SEMANTIC_VERIFIER_RESPONSE_SCHEMA', schemaModule.SEMANTIC_VERIFIER_RESPONSE_SCHEMA],
  ]) {
    const pending = [root];
    while (pending.length > 0) {
      const node = pending.pop();
      if (!node || typeof node !== 'object') continue;
      assert.equal('minLength' in node, false, `${label} must be accepted by Cerebras`);
      assert.equal('minItems' in node, false, `${label} must be accepted by Cerebras`);
      pending.push(...Object.values(node));
    }
  }
});

test('Spec 028 T020 — late uncovered proposals are strict origin-validated control data', () => {
  const schema = schemaModule.LATE_UNCOVERED_PROPOSAL_SCHEMA;
  assertStrictObjectTree(schema, 'LATE_UNCOVERED_PROPOSAL_SCHEMA');
  assertSchemaKeys(schema, {
    required: ['question', 'originRefs', 'claimType', 'proofCondition', 'constraints'],
  }, 'LATE_UNCOVERED_PROPOSAL_SCHEMA');
  assert.equal('id' in schema.properties, false);
  assert.equal('proofPolicy' in schema.properties, false);

  const proposal = {
    question: 'Determine whether legacyLogin is absent.',
    originRefs: [`request:${PLANNER_TASK.indexOf('verify')}-${PLANNER_TASK.length}`],
    claimType: 'absence',
    proofCondition: 'Enumerate the bounded registration surface and certify absence.',
    constraints: [],
  };
  assert.doesNotThrow(() => schemaModule.validateLateUncoveredProposal(proposal, {
    task: PLANNER_TASK,
    wrapperTool: 'trace_symbol',
  }));
  assert.throws(() => schemaModule.validateLateUncoveredProposal({
    ...proposal,
    id: 'model-owned-id',
  }, {
    task: PLANNER_TASK,
    wrapperTool: 'trace_symbol',
  }));
  assert.throws(() => schemaModule.validateLateUncoveredProposal({
    ...proposal,
    originRefs: [`request:0-${PLANNER_TASK.length + 1}`],
  }, {
    task: PLANNER_TASK,
    wrapperTool: 'trace_symbol',
  }));
  assert.throws(() => schemaModule.validateLateUncoveredProposal({
    ...proposal,
    originRefs: [],
  }, {
    task: PLANNER_TASK,
    wrapperTool: 'trace_symbol',
  }));
});

test('Spec 028 T016 — origin references are bounded and auditor-confirmed', () => {
  const goal = plannerGoal({ originRefs: [REQUEST_ORIGIN, TRACE_DEFINITION_ORIGIN] });
  const proposal = plannerProposal([goal]);
  assert.doesNotThrow(() => validatePlanner(proposal));
  assert.doesNotThrow(() => validateAuditor(auditorResponse([
    goalAudit(goal, 'ready', { originRefs: [REQUEST_ORIGIN] }),
  ]), proposal));

  for (const invalidOrigin of [
    'request:-1-4',
    'request:0-0',
    `request:0-${PLANNER_TASK.length + 1}`,
    'request:0.5-4',
    'wrapper:trace_symbol:unknown',
    'wrapper:map_change_impact:targets',
  ]) {
    const invalid = plannerProposal([plannerGoal({ originRefs: [invalidOrigin] })]);
    assert.throws(() => validatePlanner(invalid), invalidOrigin);
  }

  const unconfirmed = auditorResponse([
    goalAudit(goal, 'ready', { originRefs: ['request:0-5'] }),
  ]);
  assert.throws(() => validateAuditor(unconfirmed, proposal),
    'auditor origins must be a subset of the proposed origins');
  assert.throws(() => validateAuditor(auditorResponse([
    goalAudit(goal, 'ready', { originRefs: [] }),
  ]), proposal), 'ready goals require a confirmed origin');
  assert.doesNotThrow(() => validateAuditor(auditorResponse([
    goalAudit(goal, 'reject_untraceable', { originRefs: [] }),
  ]), proposal), 'an untraceable rejection may confirm no origin');
  assert.throws(() => validatePlanner(plannerProposal([])),
    'provider-compatible schema still requires runtime to reject an empty plan');
  assert.throws(() => validatePlanner(plannerProposal([plannerGoal({ originRefs: [] })])),
    'provider-compatible schema still requires planner origins');
  assert.throws(() => validateAuditor(auditorResponse([]), proposal),
    'provider-compatible schema still requires at least one audit record');
  assert.throws(() => validatePlanner(proposal, { wrapperTool: 'review_change_context' }),
    'removed wrappers cannot become an origin authority');
});

test('Spec 028 T016 — claim types map to one runtime-owned proof policy', () => {
  const policyByClaimType = new Map([
    ['positive', 'direct_source'],
    ['absence', 'bounded_absence'],
    ['count', 'deterministic_count'],
    ['symbol_definition', 'symbol_definition'],
    ['symbol_usage', 'bounded_usage_cross_check'],
    ['flow', 'ordered_handoffs'],
    ['impact', 'impact_categories'],
    ['comparison', 'distinct_policy_paths'],
    ['claim_verification', 'support_or_refute'],
  ]);

  for (const [claimType, proofPolicy] of policyByClaimType) {
    assert.doesNotThrow(() => validatePlanner(plannerProposal([
      plannerGoal({ claimType }),
    ])), claimType);

    const contract = makeValidTaskContract();
    contract.subgoals[0].claimType = claimType;
    contract.subgoals[0].proofPolicy = proofPolicy;
    contract.subgoals[0].auditBinding = computeGoalAuditBinding(contract.subgoals[0]);
    assert.doesNotThrow(() => validateTaskContract(contract), claimType);
    contract.subgoals[0].proofPolicy = proofPolicy === 'direct_source'
      ? 'bounded_absence'
      : 'direct_source';
    assert.throws(() => validateTaskContract(contract),
      `${claimType} cannot be paired with a model-selected proof policy`);
  }

  const modelPolicy = plannerProposal();
  modelPolicy.subgoals[0].proofPolicy = 'direct_source';
  assert.throws(() => validatePlanner(modelPolicy), 'the planner cannot author proofPolicy');
  const modelBinding = plannerProposal();
  modelBinding.subgoals[0].auditBinding = 'audit-v1:model-authored';
  assert.throws(() => validatePlanner(modelBinding),
    'the planner cannot author the runtime audit binding');
  const unknownType = plannerProposal([plannerGoal({ claimType: 'security_review' })]);
  assert.throws(() => validatePlanner(unknownType));
});

test('Spec 028 T016 — auditor verdicts are categorical and merge rules are strict', () => {
  const first = plannerGoal();
  const second = plannerGoal({
    id: 'S2',
    question: 'Identify the authenticateUser declaration.',
    originRefs: [TRACE_DEFINITION_ORIGIN],
  });
  const proposal = plannerProposal([first, second]);
  const verdicts = [
    'ready',
    'merge_duplicate',
    'needs_decomposition',
    'reject_untraceable',
    'blocked_scope',
    'blocked_capability',
    'requires_external_state',
    'missing_input',
    'contradictory',
    'unverifiable',
  ];

  for (const verdict of verdicts) {
    const goal = verdict === 'merge_duplicate' ? second : first;
    const record = goalAudit(goal, verdict, verdict === 'merge_duplicate'
      ? { mergeInto: first.id }
      : {});
    assert.doesNotThrow(() => validateAuditor(auditorResponse([record]), proposal), verdict);
  }

  assert.throws(() => validateAuditor(auditorResponse([
    goalAudit(second, 'merge_duplicate'),
  ]), proposal), 'merge_duplicate requires mergeInto');
  assert.throws(() => validateAuditor(auditorResponse([
    goalAudit(first, 'ready', { mergeInto: second.id }),
  ]), proposal), 'non-merge verdicts cannot carry mergeInto');
  assert.throws(() => validateAuditor(auditorResponse([
    goalAudit(second, 'merge_duplicate', { mergeInto: second.id }),
  ]), proposal), 'a duplicate cannot merge into itself');
  assert.throws(() => validateAuditor(auditorResponse([
    goalAudit(second, 'merge_duplicate', { mergeInto: 'missing-goal' }),
  ]), proposal), 'the merge target must be an existing proposal');
  assert.doesNotThrow(() => validateAuditor(auditorResponse([
    goalAudit(second, 'merge_duplicate', { mergeInto: 'existing-audited-goal' }),
  ]), proposal, { externalMergeTargetIds: ['existing-audited-goal'] }),
  'late audit may explicitly merge into an allow-listed immutable goal');
  assert.throws(() => validateAuditor(auditorResponse([
    goalAudit(second, 'merge_duplicate', { mergeInto: 'other-existing-goal' }),
  ]), proposal, { externalMergeTargetIds: ['existing-audited-goal'] }),
  'an external merge target must be explicitly allow-listed');
  assert.throws(() => validateAuditor(auditorResponse([
    goalAudit(first, 'ready'),
    goalAudit(first, 'blocked_scope'),
  ]), proposal), 'one proposal cannot receive contradictory audit records');
  for (const invalidVerdict of ['approved', 'planning_incomplete', 'ready_with_caveat']) {
    assert.throws(() => validateAuditor(auditorResponse([
      goalAudit(first, invalidVerdict),
    ]), proposal), invalidVerdict);
  }
});

test('Spec 028 T016 — revision decisions remain runtime-owned', () => {
  const broad = plannerGoal({
    question: 'Establish the definition and every bounded usage in one goal.',
  });
  const proposal = plannerProposal([broad]);
  const uncovered = {
    question: 'Determine whether legacyLogin is absent.',
    originRefs: [`request:${PLANNER_TASK.indexOf('verify')}-${PLANNER_TASK.length}`],
    claimType: 'absence',
    proofCondition: 'Enumerate the bounded registration surface and certify absence.',
    constraints: [],
  };
  const response = auditorResponse([
    goalAudit(broad, 'needs_decomposition'),
  ], [uncovered]);
  assert.doesNotThrow(() => validateAuditor(response, proposal));

  for (const [key, value] of [
    ['revisionRequired', true],
    ['revisionCount', 1],
    ['requestRevision', true],
    ['repairCount', 1],
  ]) {
    const modelOwnedDecision = structuredClone(response);
    modelOwnedDecision[key] = value;
    assert.throws(() => validateAuditor(modelOwnedDecision, proposal), key);
  }

  const plannerOwnedDecision = structuredClone(proposal);
  plannerOwnedDecision.revisionCount = 1;
  assert.throws(() => validatePlanner(plannerOwnedDecision));
});
