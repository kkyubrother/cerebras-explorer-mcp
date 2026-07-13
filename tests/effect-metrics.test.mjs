import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as effectMetricsModule from '../src/benchmark/effect-metrics.mjs';
import * as coverageModule from '../src/explorer/coverage.mjs';
import { computeCaseEffectMetrics, verifyCitations } from '../src/benchmark/effect-metrics.mjs';

function pendingExportTest(module, exportName, name, callback) {
  const exported = module[exportName];
  const register = typeof exported === 'function' ? test : test.todo;
  register(name, () => {
    assert.equal(typeof exported, 'function', `${exportName} is not implemented`);
    return callback(exported);
  });
}

function v3PublicEvidence(id, supports, overrides = {}) {
  return {
    id,
    kind: 'source',
    path: `src/${id.toLowerCase()}.mjs`,
    startLine: 1,
    endLine: 2,
    supports,
    ...overrides,
  };
}

pendingExportTest(
  effectMetricsModule,
  'measureParentPayload',
  'Spec 028 T039 — payload bytes include UTF-8 content and structuredContent but not _meta',
  (measureParentPayload) => {
    const response = {
      content: [{ type: 'text', text: '인증 흐름은 🔐 토큰을 검사한다.' }],
      structuredContent: {
        schemaVersion: 3,
        directAnswer: '인증 흐름은 🔐 토큰을 검사한다.',
        state: 'complete',
        evidence: [v3PublicEvidence('E1', '인증 흐름은 토큰을 검사한다.')],
      },
      _meta: { ops: { transcriptPath: 'must-not-count', stats: { tokens: 9_999_999 } } },
    };
    const expectedContentBytes = Buffer.byteLength(JSON.stringify(response.content), 'utf8');
    const expectedStructuredContentBytes = Buffer.byteLength(
      JSON.stringify(response.structuredContent),
      'utf8',
    );
    const contentJson = JSON.stringify(response.content);
    const structuredContentJson = JSON.stringify(response.structuredContent);
    const expectedSha256 = createHash('sha256')
      .update(contentJson)
      .update('\0')
      .update(structuredContentJson)
      .digest('hex');
    const measured = measureParentPayload(response);

    assert.deepEqual(measured, {
      encoding: 'utf8',
      contentBytes: expectedContentBytes,
      structuredContentBytes: expectedStructuredContentBytes,
      parentPayloadBytes: expectedContentBytes + expectedStructuredContentBytes,
      sha256: expectedSha256,
    });
    assert.ok(measured.parentPayloadBytes >
      JSON.stringify(response.content).length + JSON.stringify(response.structuredContent).length,
    'UTF-8 byte size must not use JavaScript UTF-16 string length');

    const withoutMeta = measureParentPayload({
      content: response.content,
      structuredContent: response.structuredContent,
    });
    assert.deepEqual(withoutMeta, measured, 'operational _meta is not parent payload size');
  },
);

pendingExportTest(
  effectMetricsModule,
  'measureParentPayload',
  'Spec 028 T039 — changing text changes total parent payload even when structuredContent is stable',
  (measureParentPayload) => {
    const structuredContent = {
      schemaVersion: 3,
      directAnswer: 'The route validates tokens.',
      state: 'complete',
      evidence: [v3PublicEvidence('E1', 'The route validates tokens.')],
    };
    const short = measureParentPayload({
      content: [{ type: 'text', text: 'The route validates tokens.' }],
      structuredContent,
    });
    const long = measureParentPayload({
      content: [{ type: 'text', text: 'The route validates tokens. Extra parent-visible text.' }],
      structuredContent,
    });
    assert.equal(short.structuredContentBytes, long.structuredContentBytes);
    assert.ok(long.contentBytes > short.contentBytes);
    assert.equal(
      long.parentPayloadBytes - short.parentPayloadBytes,
      long.contentBytes - short.contentBytes,
    );
  },
);

pendingExportTest(
  coverageModule,
  'selectClaimCoverEvidenceRefs',
  'Spec 028 T039 — simple claims keep one direct item while flow and comparison keep required parts',
  (selectClaimCoverEvidenceRefs) => {
    const selected = selectClaimCoverEvidenceRefs({
      subgoals: [
        { id: 'S1', proofPolicy: 'direct_source' },
        { id: 'S2', proofPolicy: 'ordered_handoffs' },
        { id: 'S3', proofPolicy: 'distinct_policy_paths' },
        { id: 'S4', proofPolicy: 'direct_source' },
      ],
      claims: [
        { id: 'C1', subgoalId: 'S1', verdict: 'supported', evidenceRefs: ['E1', 'E2'] },
        { id: 'C2', subgoalId: 'S2', verdict: 'supported', evidenceRefs: ['E3', 'E4'] },
        { id: 'C3', subgoalId: 'S3', verdict: 'supported', evidenceRefs: ['E5', 'E6'] },
        { id: 'C4', subgoalId: 'S4', verdict: 'insufficient', evidenceRefs: ['E7'] },
      ],
      verdicts: [
        { claimId: 'C1', result: 'supported', supportingEvidenceRefs: ['E1', 'E2'] },
        { claimId: 'C2', result: 'supported', supportingEvidenceRefs: ['E3', 'E4'] },
        { claimId: 'C3', result: 'supported', supportingEvidenceRefs: ['E5', 'E6'] },
        { claimId: 'C4', result: 'insufficient', supportingEvidenceRefs: [] },
      ],
    });

    assert.deepEqual(selected, ['E1', 'E3', 'E4', 'E5', 'E6']);
  },
);

pendingExportTest(
  coverageModule,
  'selectClaimCoverEvidenceRefs',
  'Spec 028 T039 — claim-cover selection is stable, verifier-bounded, and globally deduplicated',
  (selectClaimCoverEvidenceRefs) => {
    const selected = selectClaimCoverEvidenceRefs({
      subgoals: [
        { id: 'S1', proofPolicy: 'direct_source' },
        { id: 'S2', proofPolicy: 'bounded_usage_cross_check' },
      ],
      claims: [
        { id: 'C1', subgoalId: 'S1', verdict: 'supported', evidenceRefs: ['E1', 'E2'] },
        { id: 'C2', subgoalId: 'S2', verdict: 'supported', evidenceRefs: ['E2', 'E3', 'E2'] },
      ],
      verdicts: [
        { claimId: 'C1', result: 'supported', supportingEvidenceRefs: ['E2', 'E1'] },
        { claimId: 'C2', result: 'supported', supportingEvidenceRefs: ['E2', 'E3'] },
      ],
    });
    assert.deepEqual(selected, ['E1', 'E2', 'E3'],
      'simple proof follows claim ref order; structural proof keeps approved refs once');
  },
);

async function makeFixtureRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'effect-metrics-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    ['export function requireAuth(req) {', '  return req.user != null;', '}'].join('\n'),
  );
  return root;
}

function evidenceItem(overrides = {}) {
  return {
    id: 'E1',
    path: 'src/auth.js',
    startLine: 1,
    endLine: 2,
    snippet: '1: export function requireAuth(req) {\n2:   return req.user != null;',
    ...overrides,
  };
}

pendingExportTest(
  effectMetricsModule,
  'measureParentPayload',
  'Spec 028 T039 — case metrics consume the full parent payload and cite structured evidence',
  async (measureParentPayload) => {
    const repoRoot = await makeFixtureRepo();
    const structuredContent = {
      schemaVersion: 3,
      directAnswer: 'requireAuth checks req.user.',
      state: 'complete',
      evidence: [{
        ...evidenceItem(),
        kind: 'source',
        supports: 'requireAuth checks req.user.',
      }],
    };
    const shortPayload = {
      content: [{ type: 'text', text: 'requireAuth checks req.user.' }],
      structuredContent,
    };
    const longPayload = {
      content: [{ type: 'text', text: `requireAuth checks req.user. ${'Visible detail. '.repeat(40)}` }],
      structuredContent,
    };
    const short = await computeCaseEffectMetrics({ parentPayload: shortPayload, repoRoot });
    const long = await computeCaseEffectMetrics({ parentPayload: longPayload, repoRoot });

    assert.equal(short.parentPayloadBytes,
      measureParentPayload(shortPayload).parentPayloadBytes);
    assert.equal(long.parentPayloadBytes,
      measureParentPayload(longPayload).parentPayloadBytes);
    assert.ok(long.parentPayloadBytes > short.parentPayloadBytes);
    assert.ok(long.responsePayloadTokens > short.responsePayloadTokens);
    assert.equal(short.citedFileCount, 1);
    assert.equal(long.citedFileCount, 1);
  },
);

pendingExportTest(
  effectMetricsModule,
  'measureParentPayload',
  'Spec 028 T039 — v3 git and absence evidence stay neutral in file-range citation accuracy',
  async () => {
    const repoRoot = await makeFixtureRepo();
    const { checks, citationAccuracy } = await verifyCitations({
      result: {
        evidence: [
          {
            ...evidenceItem(),
            kind: 'source',
            supports: 'requireAuth checks req.user.',
          },
          {
            kind: 'git',
            sha: 'abc1234',
            supports: 'The commit introduced requireAuth.',
          },
          {
            kind: 'absence',
            boundary: ['src/**'],
            searches: ['text: legacyAuth'],
            supports: 'No legacyAuth reference was found in src/**.',
          },
        ],
      },
      repoRoot,
    });
    assert.deepEqual(checks.map(check => check.status), ['match', 'skipped', 'skipped']);
    assert.equal(citationAccuracy, 1);
  },
);

test('verifyCitations classifies exact snippet match', async () => {
  const repoRoot = await makeFixtureRepo();
  const { checks, citationAccuracy } = await verifyCitations({
    result: { evidence: [evidenceItem()] },
    repoRoot,
  });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, 'match');
  assert.equal(citationAccuracy, 1);
});

test('verifyCitations tolerates a maxChars-cut final snippet line (prefix match)', async () => {
  const repoRoot = await makeFixtureRepo();
  const { checks } = await verifyCitations({
    result: {
      evidence: [evidenceItem({
        snippet: '1: export function requireAuth(req) {\n2:   return req.user !',
      })],
    },
    repoRoot,
  });
  assert.equal(checks[0].status, 'match');
});

test('verifyCitations classifies mismatch, file_missing, range_invalid, out_of_root as failures', async () => {
  const repoRoot = await makeFixtureRepo();
  const { checks, citationAccuracy } = await verifyCitations({
    result: {
      evidence: [
        evidenceItem({ id: 'E1', snippet: '1: FORGED_BY_MODEL();' }),
        evidenceItem({ id: 'E2', path: 'src/gone.js' }),
        evidenceItem({ id: 'E3', startLine: 1, endLine: 99 }),
        evidenceItem({ id: 'E4', path: '../escape.js' }),
        evidenceItem({ id: 'E5' }),
      ],
    },
    repoRoot,
  });
  assert.deepEqual(checks.map(c => c.status), [
    'mismatch', 'file_missing', 'range_invalid', 'out_of_root', 'match',
  ]);
  assert.equal(citationAccuracy, 0.2);
});

test('verifyCitations excludes redacted and non-file_range evidence from the denominator', async () => {
  const repoRoot = await makeFixtureRepo();
  const { checks, citationAccuracy } = await verifyCitations({
    result: {
      evidence: [
        evidenceItem({ redacted: true }),
        evidenceItem({ evidenceType: 'git_commit', sha: 'abc1234' }),
        evidenceItem(),
      ],
    },
    repoRoot,
  });
  assert.deepEqual(checks.map(c => c.status), ['redacted', 'skipped', 'match']);
  assert.equal(citationAccuracy, 1);
});

test('verifyCitations downgrades snippetless evidence and report citations to weak_match', async () => {
  const repoRoot = await makeFixtureRepo();
  const noSnippet = evidenceItem();
  delete noSnippet.snippet;
  const { checks } = await verifyCitations({
    result: {
      evidence: [noSnippet],
      citations: [{ path: 'src/auth.js', startLine: 2, endLine: 3 }],
    },
    repoRoot,
  });
  assert.deepEqual(checks.map(c => c.status), ['weak_match', 'weak_match']);
  assert.ok(checks.every(c => c.weak === true));
});

test('verifyCitations returns null accuracy when nothing is countable', async () => {
  const repoRoot = await makeFixtureRepo();
  const { citationAccuracy } = await verifyCitations({ result: { evidence: [] }, repoRoot });
  assert.equal(citationAccuracy, null);
});

test('computeCaseEffectMetrics measures payload vs cited source tokens', async () => {
  const repoRoot = await makeFixtureRepo();
  const result = {
    directAnswer: 'requireAuth checks req.user.',
    evidence: [evidenceItem()],
    targets: [{ path: 'src/auth.js', startLine: 1, endLine: 3, role: 'read' }],
  };
  const metrics = await computeCaseEffectMetrics({ result, repoRoot });
  assert.ok(metrics.responsePayloadTokens > 0);
  assert.ok(metrics.citedSourceTokens > 0);
  assert.equal(metrics.citedFileCount, 1, 'evidence and target paths deduplicate');
  assert.equal(typeof metrics.contextSavingsRatio, 'number');
});

test('computeCaseEffectMetrics returns null ratio when nothing is cited', async () => {
  const repoRoot = await makeFixtureRepo();
  const metrics = await computeCaseEffectMetrics({
    result: { directAnswer: 'nothing found', evidence: [], targets: [] },
    repoRoot,
  });
  assert.equal(metrics.citedFileCount, 0);
  assert.equal(metrics.contextSavingsRatio, null);
});

test('computeCaseEffectMetrics never reads outside the repo root', async () => {
  const repoRoot = await makeFixtureRepo();
  const metrics = await computeCaseEffectMetrics({
    result: { evidence: [evidenceItem({ path: '../../etc/passwd' })], targets: [] },
    repoRoot,
  });
  assert.equal(metrics.citedFileCount, 0);
});

test('verifyCitations matches snippets and detects forgeries on CRLF files', async () => {
  const repoRoot = await makeFixtureRepo();
  await fs.writeFile(path.join(repoRoot, 'src', 'crlf.js'), 'const a = 1;\r\nconst b = 2;\r\n');
  // Replicate the runtime snippet builder on a CRLF file: '\n' split leaves '\r'.
  const crlfSnippet = '1: const a = 1;\r\n2: const b = 2;\r';
  const ok = await verifyCitations({
    result: { evidence: [evidenceItem({ path: 'src/crlf.js', snippet: crlfSnippet })] },
    repoRoot,
  });
  assert.equal(ok.checks[0].status, 'match');

  const forged = await verifyCitations({
    result: { evidence: [evidenceItem({ path: 'src/crlf.js', snippet: '1: FORGED();\r' })] },
    repoRoot,
  });
  assert.equal(forged.checks[0].status, 'mismatch');
});

test('verifyCitations ignores the truncation marker line and flags out-of-range snippet lines', async () => {
  const repoRoot = await makeFixtureRepo();
  const truncated = await verifyCitations({
    result: { evidence: [evidenceItem({
      snippet: '1: export function requireAuth(req) {\n... [snippet truncated]',
    })] },
    repoRoot,
  });
  assert.equal(truncated.checks[0].status, 'match');

  const outOfRange = await verifyCitations({
    result: { evidence: [evidenceItem({ snippet: '3: }' })] },
    repoRoot,
  });
  assert.equal(outOfRange.checks[0].status, 'mismatch', 'snippet line outside startLine-endLine is a mismatch');
});

test('verifyCitations treats oversized files as unreadable instead of slurping them', async () => {
  const repoRoot = await makeFixtureRepo();
  await fs.writeFile(path.join(repoRoot, 'src', 'big.js'), 'x'.repeat(513 * 1024));
  const { checks } = await verifyCitations({
    result: { evidence: [evidenceItem({ path: 'src/big.js', startLine: 1, endLine: 1, snippet: `1: ${'x'.repeat(20)}` })] },
    repoRoot,
  });
  assert.equal(checks[0].status, 'file_missing');
});
