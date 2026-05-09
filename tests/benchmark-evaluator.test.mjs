import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateBenchmarkCase, summarizeBenchmarkSuite } from '../src/benchmark/evaluator.mjs';

test('evaluateBenchmarkCase scores keyword expectations and checks', () => {
  const caseDefinition = {
    id: 'demo',
    passScore: 0.7,
    expectations: [
      {
        label: 'Answer groups',
        source: 'answer',
        groups: [['sessionstore'], ['candidatepaths'], ['missing-token']],
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
        label: 'Has grounded evidence',
        type: 'min_grounded_evidence_count',
        value: 1,
        weight: 0.2,
      },
    ],
  };

  const result = {
    answer: 'SessionStore updates candidatePaths after each call.',
    evidence: [
      {
        path: 'src/explorer/runtime.mjs',
        groundingStatus: 'exact',
      },
    ],
    candidatePaths: ['src/explorer/session.mjs'],
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

test('evaluateBenchmarkCase reads compact MCP results with debug legacy fallbacks', () => {
  const caseDefinition = {
    id: 'compact',
    passScore: 0.9,
    expectations: [
      {
        label: 'Combined text includes compact and legacy fields',
        source: 'combined_text',
        groups: [['direct answer'], ['target reason'], ['legacy summary'], ['followup']],
        weight: 0.25,
      },
      {
        label: 'Candidate paths fall back to legacy debug',
        source: 'candidate_paths',
        groups: [['src/explorer/session.mjs']],
        weight: 0.15,
      },
      {
        label: 'Recent activity falls back to debug legacy',
        source: 'hot_files',
        groups: [['src/mcp/server.mjs']],
        weight: 0.15,
      },
      {
        label: 'Confidence comes from status',
        source: 'confidence',
        groups: [['high']],
        weight: 0.15,
      },
    ],
    checks: [
      { label: 'Legacy candidate paths', type: 'min_candidate_path_count', value: 1, weight: 0.1 },
      { label: 'Recent activity', type: 'has_recent_activity', value: true, weight: 0.1 },
      { label: 'Budget stop', type: 'stopped_by_budget_equals', value: true, weight: 0.05 },
      { label: 'Session id', type: 'has_session_id', value: true, weight: 0.05 },
    ],
  };

  const result = {
    directAnswer: 'Direct answer from compact result.',
    status: {
      confidence: 'high',
      verification: 'follow_up_needed',
      complete: false,
      warnings: [],
    },
    targets: [
      { path: 'src/mcp/server.mjs', role: 'read', reason: 'Target reason for compact output.', evidenceRefs: [] },
    ],
    evidence: [],
    nextAction: { type: 'explore_followup', reason: 'Followup needed.' },
    sessionId: 'sess_compact',
    _debug: {
      stats: { stoppedByBudget: true },
      legacy: {
        summary: 'Legacy summary from raw runtime.',
        candidatePaths: ['src/explorer/session.mjs'],
        followups: [{ description: 'Followup from legacy debug.' }],
        recentActivity: { hotFiles: ['src/mcp/server.mjs (2 commits)'] },
      },
    },
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.passed, true);
});
