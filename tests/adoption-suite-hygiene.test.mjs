import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeText } from '../src/benchmark/evaluator.mjs';

// spec 027: the adoption benchmark must not award keyword-group credit for
// answers that merely echo a case's own input args. Because the evaluator
// matches a group when ANY one token is present (OR-within-group) and awards
// pointsEarned = coverage * weight decoupled from the pass gate, a scored group
// containing even one token derivable from the args is earnable by pure echo.
// This guard asserts, at the authoring layer, that no scored expectation group
// is echo-earnable and that every scored expectation keeps a real discovery
// anchor. It reuses the evaluator's own normalizeText so the substring test is
// computed with the same normalization the scorer uses.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suite = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'benchmarks', 'adoption.json'), 'utf8'),
);

// Deliberate, justified exceptions keyed `${caseId}::${expectationLabel}::${normalizedToken}`.
// An entry is only defensible when the same expectation retains an independent
// discovery group, so an allowlisted token can never be the sole earner of the
// expectation's weight. The goal (spec 027 FR-003) is to keep this empty.
const ECHO_ALLOWLIST = Object.create(null);

function collectArgValues(value, out) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectArgValues(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectArgValues(item, out);
    return out;
  }
  out.push(String(value));
  return out;
}

// Echo corpus = normalized join of the case args VALUES only (never the schema
// keys). A token is an echo token iff its normalized form is a substring of the
// corpus (direction token ⊆ args; substring, not whole-token equality).
function echoCorpus(args) {
  return normalizeText(collectArgValues(args ?? {}, []).join(' '));
}

function isEchoToken(corpus, token) {
  const normalized = normalizeText(token);
  return normalized.length > 0 && corpus.includes(normalized);
}

function allowKey(caseId, label, token) {
  return `${caseId}::${label}::${normalizeText(token)}`;
}

function scoredExpectations(testCase) {
  return (Array.isArray(testCase.expectations) ? testCase.expectations : [])
    .filter(expectation => Number(expectation.weight ?? 1) > 0);
}

function containsHangul(value) {
  return /[\uac00-\ud7a3]/u.test(String(value));
}

test('adoption suite: no scored expectation group is echo-earnable', () => {
  const violations = [];
  for (const testCase of suite.cases) {
    const corpus = echoCorpus(testCase.args);
    for (const expectation of scoredExpectations(testCase)) {
      const groups = Array.isArray(expectation.groups) ? expectation.groups : [];
      for (const group of groups) {
        for (const token of group) {
          if (isEchoToken(corpus, token) && !(allowKey(testCase.id, expectation.label, token) in ECHO_ALLOWLIST)) {
            violations.push(
              `${testCase.id} / "${expectation.label}" group ${JSON.stringify(group)}: "${token}" is a substring of the case args (echo-earnable)`,
            );
          }
        }
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `echo-earnable groups found (strip the echo token or replace with a discovered fact):\n${violations.join('\n')}`,
  );
});

test('adoption suite: every scored expectation keeps >=1 group and >=1 discovery group', () => {
  const violations = [];
  for (const testCase of suite.cases) {
    const corpus = echoCorpus(testCase.args);
    for (const expectation of scoredExpectations(testCase)) {
      const groups = Array.isArray(expectation.groups) ? expectation.groups : [];
      if (groups.length < 1) {
        // An empty group list scores coverage = 1 (full vacuous credit) in the
        // evaluator — strictly worse than the echo leak.
        violations.push(`${testCase.id} / "${expectation.label}": scored expectation has zero groups`);
        continue;
      }
      const hasDiscoveryGroup = groups.some(
        group => group.length > 0 && group.every(token => !isEchoToken(corpus, token)),
      );
      if (!hasDiscoveryGroup) {
        violations.push(`${testCase.id} / "${expectation.label}": no discovery group (every group is echo-earnable)`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `expectations missing a discovery anchor:\n${violations.join('\n')}`,
  );
});

test('adoption suite: English tasks do not require language-incompatible keywords', () => {
  const violations = [];
  for (const testCase of suite.cases) {
    const taskText = collectArgValues(testCase.args ?? {}, []).join(' ');
    if (containsHangul(taskText)) continue;
    for (const expectation of scoredExpectations(testCase)) {
      for (const group of expectation.groups ?? []) {
        if (group.some(containsHangul)) {
          violations.push(`${testCase.id} / "${expectation.label}": ${JSON.stringify(group)}`);
        }
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `English tasks contain language-incompatible scored keywords:\n${violations.join('\n')}`,
  );
});

test('adoption suite: v3 and wrapper scenarios keep objective source anchors', () => {
  const byId = new Map(suite.cases.map(testCase => [testCase.id, testCase]));
  const serialized = testCase => JSON.stringify(byId.get(testCase));

  assert.match(serialized('map-change-impact'), /tests\/(schemas|runtime\.mock|mcp-server)\.test\.mjs/);
  assert.match(serialized('explain-code-path'), /src\/mcp\/jsonrpc-stdio\.mjs/);
  assert.match(serialized('explore-recent-change-context'), /min_git_evidence_count/);
  assert.match(serialized('structured-output-contract'), /src\/explorer\/parent-payload\.mjs/);
  assert.match(serialized('structured-output-contract'), /buildParentPayload/);
  assert.doesNotMatch(serialized('structured-output-contract'), /formatExploreResult/);
  assert.match(serialized('direct-vs-explorer-boundary'), /max_target_count/);
});

test('adoption suite: quiet schema-v3 does not require optional evidence snippets', () => {
  const serializedSuite = JSON.stringify(suite);
  assert.doesNotMatch(serializedSuite, /min_evidence_snippet_count/);
  assert.doesNotMatch(serializedSuite, /"source":"evidence_snippets"/);
});
