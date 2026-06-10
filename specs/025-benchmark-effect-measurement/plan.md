# Benchmark Effect Measurement Implementation Plan (spec 025)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the benchmark measure parent-context savings and citation accuracy deterministically, restore the spec-017-dead metrics through an `_meta.ops` side-channel, and delete what is dead beyond recovery — without changing the public `structuredContent` contract.

**Architecture:** A new pure module `src/benchmark/effect-metrics.mjs` computes per-case effect metrics (payload tokens vs cited-source tokens) and re-verifies citations against the working tree. `src/mcp/server.mjs#callTool` gains the same `_meta.ops` side-channel `callFreeExploreTool` already has. `scripts/run-benchmark.mjs` rewires its extended metrics to ops/envelope sources, revives transcript metrics via a temporary `CEREBRAS_EXPLORER_LOG_PATH`, and prints `n/a` (never fabricated `0`/`100%`) when a source is absent.

**Tech Stack:** Node 22+ ESM, zero dependencies (`node:fs`, `node:path`, `node:os`, `node:test`). Token estimation reuses the spec 024 CJK-aware estimator in `src/explorer/runtime.mjs`.

**Baseline:** `master` post-`v0.8.3` (spec committed as `09abc0a`). `npm test`: 415 tests / 0 fail / 2 skipped (win32). Line numbers below were confirmed on this baseline — re-confirm before editing, they shift.

**Verified context for implementers (read this first):**
- `runtime.mjs:61` `function estimateStringTokens(str)` is module-private; `estimateTokens` (:77) is already exported. Snippets are rebuilt from disk at `runtime.mjs:653-683`: lines are `` `${lineNo}: ${lines[lineNo-1] ?? ''}` `` with the file split on `'\n'` (CRLF residue stays in the line text), a possible trailing `'... [snippet truncated]'` marker line, and a final whole-snippet `.slice(0, maxChars)` that can cut the **last** line mid-text. The verifier below replicates exactly this.
- `server.mjs:740-777` `callTool` already holds `result.stats` and `result.transcriptPath` locally (for the stderr ops summary) but does not return them. `redactValue` is already imported (used at :796).
- `scripts/run-benchmark.mjs:106-112` `getStats()` reads `result.stats`, which never exists post-spec-017; `:158-161` filters on `stats.budget === 'deep'`, a spec-011-removed concept; `:286-288` depends on `result.transcriptPath`, which never exists.
- Tests stub the LLM with `MockChatClient` (`tests/mcp-server.test.mjs:80-159`) + `makeRepoFixture()` (`:53-78`); handlers come from `createMcpRequestHandler({ runtimeOptions: { chatClient } })` and require an `initialize` round-trip before `tools/call`.

---

### Task 1: effect-metrics module (FR-003, FR-004, FR-008)

**Files:**
- Create: `tests/effect-metrics.test.mjs`
- Create: `src/benchmark/effect-metrics.mjs`
- Modify: `src/explorer/runtime.mjs:61` (add `export` keyword only)

- [ ] **Step 1: Write the failing test**

Create `tests/effect-metrics.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { computeCaseEffectMetrics, verifyCitations } from '../src/benchmark/effect-metrics.mjs';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/effect-metrics.test.mjs`
Expected: FAIL — `Cannot find module ... src/benchmark/effect-metrics.mjs`

- [ ] **Step 3: Export the estimator and write the module**

In `src/explorer/runtime.mjs:61` change:

```js
function estimateStringTokens(str) {
```

to:

```js
export function estimateStringTokens(str) {
```

Create `src/benchmark/effect-metrics.mjs`:

```js
// Spec 025: deterministic, offline effect metrics for the benchmark harness.
// Measures what the parent agent ingests (payload tokens) against a
// conservative lower bound of what it would have read natively (cited source
// tokens), and re-verifies citations against the working tree without
// trusting the system's own groundingStatus labels. Read-only by design.
import fs from 'node:fs/promises';
import path from 'node:path';

import { estimateStringTokens } from '../explorer/runtime.mjs';

const NEUTRAL_STATUSES = new Set(['redacted', 'skipped']);
const MATCH_STATUSES = new Set(['match', 'weak_match']);

function resolveInsideRoot(repoRoot, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) return null;
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relPath.trim());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function uniqueCitedPaths(result) {
  const paths = new Set();
  for (const item of result?.evidence ?? []) {
    if (typeof item?.path === 'string' && item.path.trim()) paths.add(item.path.trim());
  }
  for (const item of result?.targets ?? []) {
    if (typeof item?.path === 'string' && item.path.trim()) paths.add(item.path.trim());
  }
  return [...paths];
}

export async function computeCaseEffectMetrics({ result, repoRoot }) {
  const responsePayloadTokens = estimateStringTokens(JSON.stringify(result ?? {}));
  let citedSourceTokens = 0;
  let citedFileCount = 0;
  for (const relPath of uniqueCitedPaths(result)) {
    const resolved = resolveInsideRoot(repoRoot, relPath);
    if (!resolved) continue;
    try {
      const content = await fs.readFile(resolved, 'utf8');
      citedSourceTokens += estimateStringTokens(content);
      citedFileCount += 1;
    } catch {
      // Missing files are classified by verifyCitations; they add no tokens.
    }
  }
  return {
    responsePayloadTokens,
    citedSourceTokens,
    citedFileCount,
    contextSavingsRatio: citedFileCount > 0 && responsePayloadTokens > 0
      ? Math.round((citedSourceTokens / responsePayloadTokens) * 100) / 100
      : null,
  };
}

// Replicates the snippet shape built at runtime.mjs readEvidenceSnippet():
// "N: content" lines from a '\n'-split file, optional trailing
// "... [snippet truncated]" marker, and a whole-snippet maxChars cut that can
// truncate the final line mid-text (hence the prefix tolerance).
function parseSnippetLines(snippet) {
  const lines = [];
  for (const raw of String(snippet).split('\n')) {
    const match = raw.match(/^(\d+): (.*)$/);
    if (match) lines.push({ line: Number(match[1]), text: match[2] });
  }
  return lines;
}

async function readFileLines(repoRoot, relPath) {
  const resolved = resolveInsideRoot(repoRoot, relPath);
  if (!resolved) return { status: 'out_of_root' };
  try {
    return { lines: (await fs.readFile(resolved, 'utf8')).split('\n') };
  } catch {
    return { status: 'file_missing' };
  }
}

function validRange(startLine, endLine, totalLines) {
  return Number.isInteger(startLine) && Number.isInteger(endLine)
    && startLine >= 1 && endLine >= startLine && endLine <= totalLines;
}

async function verifyEvidenceItem(item, repoRoot) {
  const citation = `${item?.path}:${item?.startLine}-${item?.endLine}`;
  if (item?.redacted === true) return { citation, status: 'redacted' };
  if ((item?.evidenceType ?? 'file_range') !== 'file_range') {
    return { citation, status: 'skipped' };
  }
  const file = await readFileLines(repoRoot, item?.path);
  if (file.status) return { citation, status: file.status };
  if (!validRange(item.startLine, item.endLine, file.lines.length)) {
    return { citation, status: 'range_invalid' };
  }
  const snippetLines = parseSnippetLines(item.snippet ?? '');
  if (snippetLines.length === 0) {
    // No snippet to compare (e.g. oversized file skipped by the runtime):
    // existence + range validity is the strongest possible check.
    return { citation, status: 'weak_match', weak: true };
  }
  for (const [index, { line, text }] of snippetLines.entries()) {
    if (line < item.startLine || line > item.endLine) return { citation, status: 'mismatch' };
    const fileLine = file.lines[line - 1] ?? '';
    const isLast = index === snippetLines.length - 1;
    const matches = fileLine === text || (isLast && text.length > 0 && fileLine.startsWith(text));
    if (!matches) return { citation, status: 'mismatch' };
  }
  return { citation, status: 'match' };
}

async function verifyReportCitation(item, repoRoot) {
  const citation = `${item?.path}:${item?.startLine}-${item?.endLine}`;
  const file = await readFileLines(repoRoot, item?.path);
  if (file.status) return { citation, status: file.status, weak: true };
  if (!validRange(item?.startLine, item?.endLine, file.lines.length)) {
    return { citation, status: 'range_invalid', weak: true };
  }
  // citations[] carry no snippets: existence + range validity only.
  return { citation, status: 'weak_match', weak: true };
}

export async function verifyCitations({ result, repoRoot }) {
  const checks = [];
  for (const item of result?.evidence ?? []) {
    checks.push(await verifyEvidenceItem(item, repoRoot));
  }
  for (const item of result?.citations ?? []) {
    checks.push(await verifyReportCitation(item, repoRoot));
  }
  const counted = checks.filter(check => !NEUTRAL_STATUSES.has(check.status));
  const matched = counted.filter(check => MATCH_STATUSES.has(check.status));
  return {
    checks,
    citationAccuracy: counted.length > 0
      ? Math.round((matched.length / counted.length) * 1000) / 1000
      : null,
  };
}

export { NEUTRAL_STATUSES as NEUTRAL_CITATION_STATUSES, MATCH_STATUSES as MATCH_CITATION_STATUSES };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/effect-metrics.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: 0 fail (the `export` keyword on `estimateStringTokens` is additive)

- [ ] **Step 6: Commit**

```bash
git add src/benchmark/effect-metrics.mjs tests/effect-metrics.test.mjs src/explorer/runtime.mjs
git commit -m "feat(spec-025): add deterministic effect metrics and citation verification"
```

---

### Task 2: `_meta.ops` side-channel on explore_repo/wrappers (FR-001, FR-002)

**Files:**
- Modify: `tests/mcp-server.test.mjs` (append new test at end of file)
- Modify: `src/mcp/server.mjs:756-761` (`callTool` return block)

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-server.test.mjs`:

```js
test('explore_repo and wrappers expose _meta.ops without touching structuredContent (spec 025)', async () => {
  const repoRoot = await makeRepoFixture();

  for (const [toolName, args] of [
    ['explore_repo', { task: 'users/me 라우트 인증 추적', repo_root: repoRoot, scope: ['src/**'] }],
    ['find_relevant_code', { query: 'auth middleware wiring', repo_root: repoRoot }],
  ]) {
    const { handleRequest } = createMcpRequestHandler({
      runtimeOptions: { chatClient: new MockChatClient() },
    });
    await handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
    });
    const called = await handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

    assert.ok(called._meta?.ops, `${toolName} response must carry _meta.ops (spec 025)`);
    assert.equal(typeof called._meta.ops.stats?.turns, 'number', `${toolName} ops.stats.turns`);
    assert.equal(typeof called._meta.ops.stats?.toolCalls, 'number', `${toolName} ops.stats.toolCalls`);
    assert.ok('transcriptPath' in called._meta.ops, `${toolName} ops.transcriptPath key`);
    // FR-001 contract freeze: the side-channel must not leak into the answer payload.
    assert.equal(called.structuredContent.stats, undefined);
    assert.equal(called.structuredContent.transcriptPath, undefined);
    assert.equal(called.structuredContent._debug, undefined);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/mcp-server.test.mjs --test-name-pattern "spec 025"`
Expected: FAIL — `called._meta?.ops` is `undefined`

- [ ] **Step 3: Implement**

In `src/mcp/server.mjs` `callTool`, replace:

```js
      const agentResult = redactExploreResult(toAgentFacingResult(result)).value;
      return {
        content: [{ type: 'text', text: formatExploreResult(agentResult) }],
        structuredContent: agentResult,
      };
```

with:

```js
      const agentResult = redactExploreResult(toAgentFacingResult(result)).value;
      // Spec 025: ops side-channel, symmetric with callFreeExploreTool. This is
      // operational/eval metadata (spec 022 boundary), not the answer contract.
      const ops = redactValue({
        stats: result.stats ?? {},
        transcriptPath: result.transcriptPath ?? result.stats?.transcriptPath ?? null,
      }).value;
      return {
        content: [{ type: 'text', text: formatExploreResult(agentResult) }],
        structuredContent: agentResult,
        _meta: { ops },
      };
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/mcp-server.test.mjs`
Expected: PASS (all, including existing contract-freeze assertions at :337/:353-355)

Run: `npm test`
Expected: 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.mjs tests/mcp-server.test.mjs
git commit -m "feat(spec-025): expose _meta.ops side-channel on explore_repo and wrappers"
```

---

### Task 3: rewire extended metrics, delete the dead one (FR-005, FR-009 fixture)

**Files:**
- Modify: `tests/benchmark-transcript-metrics.test.mjs:79-113` (replace the stale `_debug.stats` fixture test)
- Modify: `scripts/run-benchmark.mjs:106-202` (`getStats` removed, `computeExtendedMetrics` rewritten)

- [ ] **Step 1: Replace the stale fixture test with the new contract (failing first)**

In `tests/benchmark-transcript-metrics.test.mjs`, replace the entire last test (`'computeExtendedMetrics reports transcript averages only when transcript metrics exist'`, lines 79-113) with:

```js
function syntheticCase({ ops, searchCoverage, transcriptMetrics = null, effectMetrics = null, citation = null } = {}) {
  return {
    result: {
      directAnswer: 'ok',
      evidence: [],
      targets: [],
      status: {},
      searchCoverage: searchCoverage ?? { filesRead: 1, grepCalls: 0, listDirCalls: 0, symbolCalls: 0, stoppedByBudget: false },
    },
    ops: ops ?? null,
    transcriptMetrics,
    effectMetrics,
    citation,
  };
}

test('computeExtendedMetrics reads ops stats and reports n/a (null) when ops are absent (spec 025)', () => {
  const withOps = computeExtendedMetrics([
    syntheticCase({ ops: { stats: { turns: 4, toolCalls: 6, totalTokens: 1200 } } }),
    syntheticCase({ ops: { stats: { turns: 2, toolCalls: 0, totalTokens: 800 } } }),
  ]);
  assert.equal(withOps.avgToolTurns, 3);
  assert.equal(withOps.avgInternalTokens, 1000);
  assert.equal(withOps.noToolExitRate, 0.5, 'ops.toolCalls === 0 marks a no-tool exit');
  assert.equal('deepBudgetAvgTotalTokens' in withOps, false, 'dead spec-011 metric is deleted');

  const withoutOps = computeExtendedMetrics([syntheticCase()]);
  assert.equal(withoutOps.avgToolTurns, null, 'no fabricated 0 without a source');
  assert.equal(withoutOps.avgInternalTokens, null);
  assert.equal(withoutOps.noToolExitRate, 0, 'searchCoverage fallback sees 1 file read');
});

test('computeExtendedMetrics sources budget exhaustion from searchCoverage (spec 025)', () => {
  const metrics = computeExtendedMetrics([
    syntheticCase({ searchCoverage: { filesRead: 2, grepCalls: 1, listDirCalls: 0, symbolCalls: 0, stoppedByBudget: true } }),
    syntheticCase(),
  ]);
  assert.equal(metrics.budgetExhaustionRate, 0.5);
});

test('computeExtendedMetrics aggregates effect metrics and pools citation checks (spec 025)', () => {
  const metrics = computeExtendedMetrics([
    syntheticCase({
      effectMetrics: { responsePayloadTokens: 100, citedSourceTokens: 1000, citedFileCount: 2, contextSavingsRatio: 10 },
      citation: { checks: [{ status: 'match' }, { status: 'mismatch' }, { status: 'redacted' }] },
    }),
    syntheticCase({
      effectMetrics: { responsePayloadTokens: 300, citedSourceTokens: 600, citedFileCount: 1, contextSavingsRatio: 2 },
      citation: { checks: [{ status: 'weak_match' }] },
    }),
  ]);
  assert.equal(metrics.avgResponsePayloadTokens, 200);
  assert.equal(metrics.avgCitedSourceTokens, 800);
  assert.equal(metrics.avgContextSavingsRatio, 6);
  assert.equal(metrics.citationAccuracy, 0.667, 'pooled across all non-neutral checks, not per-case means');
  assert.equal(metrics.weakCitationChecks, 1);
});

test('computeExtendedMetrics reports transcript averages only when transcript metrics exist', () => {
  const metrics = computeExtendedMetrics([
    syntheticCase({ transcriptMetrics: { broadSearchCalls: 2, repeatedToolPlanTurns: 1 } }),
    syntheticCase({ transcriptMetrics: { broadSearchCalls: 0, repeatedToolPlanTurns: 0 } }),
  ]);
  assert.equal(metrics.avgBroadSearchCalls, 1);
  assert.equal(metrics.avgRepeatedToolPlanTurns, 0.5);

  const withoutTranscripts = computeExtendedMetrics([syntheticCase()]);
  assert.equal(withoutTranscripts.avgBroadSearchCalls, null);
  assert.equal(withoutTranscripts.avgRepeatedToolPlanTurns, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/benchmark-transcript-metrics.test.mjs`
Expected: FAIL — `avgToolTurns` is `0` (not `3`/`null`), `deepBudgetAvgTotalTokens` still present

- [ ] **Step 3: Rewrite `computeExtendedMetrics`**

In `scripts/run-benchmark.mjs`, delete `getStats` (lines 106-112) and replace the whole `computeExtendedMetrics` function (and its doc comment) with:

```js
/**
 * Compute extended benchmark metrics beyond pass/fail scoring. All metrics are
 * record-only (spec 021: never a gate). Sources (spec 025):
 *   - _meta.ops side-channel  : avgToolTurns, avgInternalTokens, noToolExitRate (primary)
 *   - structuredContent       : budgetExhaustionRate, noToolExitRate (fallback),
 *                               avgGroundedEvidence, avgTargets, evidenceSnippetRate,
 *                               targetedVerificationRate
 *   - effect-metrics harness  : avgResponsePayloadTokens, avgCitedSourceTokens,
 *                               avgContextSavingsRatio, citationAccuracy, weakCitationChecks
 *   - transcript analysis     : avgBroadSearchCalls, avgRepeatedToolPlanTurns
 * A metric with no available source is null (printed as "n/a") — never a
 * fabricated 0/100%.
 */
export function computeExtendedMetrics(caseResults) {
  const successCases = caseResults.filter(cr => cr.result !== null);
  const count = successCases.length;
  if (count === 0) return null;

  const avgOf = values => (values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null);
  const round1 = value => (value === null ? null : Math.round(value * 10) / 10);
  const round3 = value => (value === null ? null : Math.round(value * 1000) / 1000);

  const opsStats = successCases
    .map(cr => cr.ops?.stats)
    .filter(stats => stats && typeof stats === 'object');

  const avgToolTurns = round1(avgOf(opsStats.map(stats => stats.turns ?? 0)));
  const avgInternalTokensRaw = avgOf(opsStats.map(stats => stats.totalTokens ?? 0));

  const budgetExhaustionRate =
    successCases.filter(cr => cr.result.searchCoverage?.stoppedByBudget === true).length / count;

  const noToolExitRate = successCases.filter(cr => {
    const stats = cr.ops?.stats;
    if (stats && typeof stats.toolCalls === 'number') return stats.toolCalls === 0;
    // Fallback caveat: searchCoverage has no git-call counter, so a
    // git-tools-only exploration can be misread as a no-tool exit here.
    const sc = cr.result.searchCoverage ?? {};
    return ((sc.filesRead ?? 0) + (sc.grepCalls ?? 0) + (sc.listDirCalls ?? 0) + (sc.symbolCalls ?? 0)) === 0;
  }).length / count;

  const avgGroundedEvidence =
    successCases.reduce((sum, cr) => {
      const grounded = (cr.result.evidence ?? []).filter(
        e => e.groundingStatus === 'exact' || e.groundingStatus === 'partial',
      ).length;
      return sum + grounded;
    }, 0) / count;

  const evidenceCount = successCases.reduce((sum, cr) => sum + (cr.result.evidence?.length ?? 0), 0);
  const snippetCount = successCases.reduce((sum, cr) => {
    return sum + (cr.result.evidence ?? []).filter(item => typeof item.snippet === 'string' && item.snippet.trim()).length;
  }, 0);

  const avgTargets =
    successCases.reduce((sum, cr) => sum + (cr.result.targets?.length ?? 0), 0) / count;

  const targetedVerificationRate =
    successCases.filter(cr => cr.result.status?.verification === 'targeted_read_needed').length / count;

  const transcriptCases = successCases.filter(cr => cr.transcriptMetrics);
  const avgBroadSearchCalls = transcriptCases.length > 0
    ? transcriptCases.reduce((sum, cr) => sum + Number(cr.transcriptMetrics.broadSearchCalls ?? 0), 0) / transcriptCases.length
    : null;
  const avgRepeatedToolPlanTurns = transcriptCases.length > 0
    ? transcriptCases.reduce((sum, cr) => sum + Number(cr.transcriptMetrics.repeatedToolPlanTurns ?? 0), 0) / transcriptCases.length
    : null;

  const effectCases = successCases.map(cr => cr.effectMetrics).filter(Boolean);
  const avgResponsePayloadTokens = avgOf(effectCases.map(m => m.responsePayloadTokens));
  const avgCitedSourceTokens = avgOf(effectCases.map(m => m.citedSourceTokens));
  const avgContextSavingsRatio = avgOf(
    effectCases.map(m => m.contextSavingsRatio).filter(value => typeof value === 'number'),
  );

  const allChecks = successCases.flatMap(cr => cr.citation?.checks ?? []);
  const countedChecks = allChecks.filter(check => !NEUTRAL_CITATION_STATUSES.has(check.status));
  const matchedChecks = countedChecks.filter(check => MATCH_CITATION_STATUSES.has(check.status));
  const citationAccuracy = countedChecks.length > 0
    ? round3(matchedChecks.length / countedChecks.length)
    : null;
  const weakCitationChecks = allChecks.filter(check => check.status === 'weak_match').length;

  return {
    avgToolTurns,
    avgInternalTokens: avgInternalTokensRaw === null ? null : Math.round(avgInternalTokensRaw),
    budgetExhaustionRate: round3(budgetExhaustionRate),
    noToolExitRate: round3(noToolExitRate),
    avgGroundedEvidence: round1(avgGroundedEvidence),
    avgTargets: round1(avgTargets),
    evidenceSnippetRate: evidenceCount > 0
      ? round3(snippetCount / evidenceCount)
      : 0,
    targetedVerificationRate: round3(targetedVerificationRate),
    avgBroadSearchCalls: round1(avgBroadSearchCalls),
    avgRepeatedToolPlanTurns: round1(avgRepeatedToolPlanTurns),
    avgResponsePayloadTokens: avgResponsePayloadTokens === null ? null : Math.round(avgResponsePayloadTokens),
    avgCitedSourceTokens: avgCitedSourceTokens === null ? null : Math.round(avgCitedSourceTokens),
    avgContextSavingsRatio: avgContextSavingsRatio === null ? null : Math.round(avgContextSavingsRatio * 100) / 100,
    citationAccuracy,
    weakCitationChecks,
  };
}
```

Add to the imports at the top of `scripts/run-benchmark.mjs`:

```js
import {
  computeCaseEffectMetrics,
  verifyCitations,
  NEUTRAL_CITATION_STATUSES,
  MATCH_CITATION_STATUSES,
} from '../src/benchmark/effect-metrics.mjs';
```

Also delete the now-dangling deep-budget console lines from `main()` (Task 4
replaces this whole block, but the intermediate commit must not reference a
deleted metric):

```js
    if (metrics.deepBudgetAvgTotalTokens !== null) {
      console.log(`  deep budget tokens : ${metrics.deepBudgetAvgTotalTokens} avg total`);
    }
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/benchmark-transcript-metrics.test.mjs`
Expected: PASS

Run: `npm test`
Expected: 0 fail

- [ ] **Step 5: Commit**

```bash
git add scripts/run-benchmark.mjs tests/benchmark-transcript-metrics.test.mjs
git commit -m "feat(spec-025): rewire benchmark metrics to ops/envelope sources, drop dead deep-budget metric"
```

---

### Task 4: runner integration — ops capture, per-case effect metrics, transcript revival (FR-005 console, FR-006, FR-007)

**Files:**
- Modify: `scripts/run-benchmark.mjs` — `parseArgs`, `printHelp`, `runCase`, `main`, `printCaseResult` console block

No good unit seam exists for `main()`; this task is wired code covered by the
suite-level guards from Tasks 1-3 plus the real-run verification in Task 6.
Keep the changes mechanical.

- [ ] **Step 1: Extend CLI options**

In `parseArgs`, add to the `options` object: `keepTranscripts: false,` and add the branch:

```js
    else if (arg === '--keep-transcripts') options.keepTranscripts = true;
```

In `printHelp`, add the line:

```js
      '  --keep-transcripts  Keep the temporary transcript directory (when the runner created one)',
```

- [ ] **Step 2: Capture ops in `runCase`**

Replace the `return` of `runCase` with:

```js
  const ops = response._meta?.ops ?? null;
  return {
    elapsedMs: Date.now() - startedAt,
    result: response.structuredContent,
    // Keep stats for metrics; do not persist transcriptPath on the case
    // result so temp paths never reach the saved JSON report.
    ops: ops ? { stats: ops.stats ?? null } : null,
    transcriptPath: ops?.transcriptPath ?? null,
  };
```

- [ ] **Step 3: Enable temporary transcripts around `main()`'s run**

Add `import os from 'node:os';` to the imports. In `main()`, after `const repoRoot = path.resolve(options.repoRoot);` add:

```js
  // Spec 025 (FR-006): transcripts power the spec 007 metrics. If the operator
  // did not opt in, enable them into a temp dir for this run only.
  let tempTranscriptDir = null;
  if (!process.env.CEREBRAS_EXPLORER_LOG_PATH) {
    tempTranscriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-benchmark-transcripts-'));
    process.env.CEREBRAS_EXPLORER_LOG_PATH = tempTranscriptDir;
  }
```

Wrap everything from `const handleRequest = await createHandler(() => {});` to the end of `main()` in `try { ... } finally { ... }` with:

```js
  } finally {
    if (tempTranscriptDir) {
      delete process.env.CEREBRAS_EXPLORER_LOG_PATH;
      if (options.keepTranscripts) {
        console.log(`Transcripts kept at ${tempTranscriptDir}`);
      } else {
        await fs.rm(tempTranscriptDir, { recursive: true, force: true });
      }
    }
  }
```

- [ ] **Step 4: Wire per-case analysis in the case loop**

Replace the body of the `try` block inside the `for (const suiteCase of selectedCases)` loop with:

```js
      const { result, elapsedMs, ops, transcriptPath } = await runCase(handleRequest, caseDefinition, repoRoot);
      const transcriptMetrics = transcriptPath
        ? await analyzeTranscriptFile(transcriptPath).catch(() => null)
        : null;
      const effectMetrics = await computeCaseEffectMetrics({ result, repoRoot }).catch(() => null);
      const citation = await verifyCitations({ result, repoRoot }).catch(() => null);
      const evaluation = evaluateBenchmarkCase(caseDefinition, result);
      const caseResult = { caseDefinition, evaluation, result, elapsedMs, ops, transcriptMetrics, effectMetrics, citation };
      caseResults.push(caseResult);
      printCaseResult(caseResult, options.verbose);
```

Note: `computeCaseEffectMetrics(...)`/`verifyCitations(...)` return promises;
`.catch` keeps a harness fault from failing the case (FR-007: record-only). In
the `catch` block's `failed` object, add `ops: null, effectMetrics: null,
citation: null` alongside the existing `transcriptMetrics: null`.

- [ ] **Step 5: Honest console output**

Add next to `formatPercent`:

```js
function formatMetric(value, formatter = String) {
  return value === null || value === undefined ? 'n/a' : formatter(value);
}
```

Replace the `if (metrics) { ... }` console block in `main()` with:

```js
  if (metrics) {
    console.log(`  avg tool turns     : ${formatMetric(metrics.avgToolTurns)}`);
    console.log(`  avg internal tokens: ${formatMetric(metrics.avgInternalTokens)}`);
    console.log(`  budget exhaustion  : ${formatPercent(metrics.budgetExhaustionRate)}`);
    console.log(`  no-tool exit rate  : ${formatPercent(metrics.noToolExitRate)}`);
    console.log(`  avg grounded evid. : ${metrics.avgGroundedEvidence}`);
    console.log(`  avg targets        : ${metrics.avgTargets}`);
    console.log(`  evidence snippets  : ${formatPercent(metrics.evidenceSnippetRate)}`);
    console.log(`  targeted verify    : ${formatPercent(metrics.targetedVerificationRate)}`);
    console.log(`  avg broad searches : ${formatMetric(metrics.avgBroadSearchCalls)}`);
    console.log(`  avg repeated plans : ${formatMetric(metrics.avgRepeatedToolPlanTurns)}`);
    console.log(`  payload tokens     : ${formatMetric(metrics.avgResponsePayloadTokens)} avg/case`);
    console.log(`  cited source tokens: ${formatMetric(metrics.avgCitedSourceTokens)} avg/case (conservative native-read lower bound)`);
    console.log(`  context savings    : ${formatMetric(metrics.avgContextSavingsRatio, v => `${v}x`)}`);
    console.log(`  citation accuracy  : ${formatMetric(metrics.citationAccuracy, formatPercent)} (${metrics.weakCitationChecks} weak checks)`);
  }
```

- [ ] **Step 6: Syntax + suite check**

Run: `node --check scripts/run-benchmark.mjs` — Expected: no output
Run: `npm test` — Expected: 0 fail

- [ ] **Step 7: Commit**

```bash
git add scripts/run-benchmark.mjs
git commit -m "feat(spec-025): per-case effect metrics, citation verification, and transcript revival in the benchmark runner"
```

---

### Task 5: documentation (FR-011)

**Files:**
- Modify: `README.md` (벤치마크 section, after the scoring bullet list)
- Modify: `DESIGN.md` (§11.7 끝에 ops 채널 단락 추가)
- Modify: `CHANGELOG.md` (new Unreleased section above `## v0.8.3`)

- [ ] **Step 1: README — add after the "벤치마크는 exact-string 정답 대신 ..." bullet list**

```markdown
spec 025 이후 벤치마크는 다음 효과 메트릭을 함께 기록합니다 (모두 record-only — 합격/불합격에 영향 없음):

- `avgResponsePayloadTokens`: 상위 AI가 실제로 받는 `structuredContent`의 토큰 추정치
- `avgCitedSourceTokens`: 인용된 파일 전체를 native로 읽었을 때의 토큰 추정치 — 탐색 오버헤드를 제외한 **보수적 하한**
- `avgContextSavingsRatio`: 위 둘의 비율 (>1이면 위임이 컨텍스트를 절감)
- `citationAccuracy`: 하너스가 인용 파일을 직접 열어 snippet을 라인 단위로 대조한 독립 검증 일치율 (시스템 자기보고 `groundingStatus`와 무관)
- `avgToolTurns` / `avgInternalTokens`: `_meta.ops` 사이드채널 기반 내부 효율/비용 지표
- transcript 기반 지표(`avgBroadSearchCalls` 등)는 실행 중 임시 transcript를 자동 활성화해 계산하며, `--keep-transcripts`로 파일을 보존할 수 있습니다.

소스가 없는 지표는 0이나 100%로 날조하지 않고 `n/a`로 표기합니다.
```

- [ ] **Step 2: DESIGN.md — append to §11.7**

```markdown
spec 025에서 `_meta.ops` 사이드채널이 `explore`뿐 아니라 `explore_repo`와 wrapper 6개에도 대칭 적용되었다 (`{ stats, transcriptPath }` 최소 집합). 이는 spec 017 변경 기록이 약속했던 "local ops log channel" follow-up의 이행이며, spec 022가 정의한 경계(운영/평가 metadata는 응답 계약이 아니라 envelope/log에 속한다)를 따른다. 부모 agent는 `_meta.ops`를 답변 신호로 사용해서는 안 되고, `structuredContent`의 control-plane 필드만 신뢰해야 한다. 벤치마크 하너스는 이 채널로 내부 효율 지표를 복원하고, 인용 정확성은 자기보고 `groundingStatus`가 아니라 working tree 대조로 독립 검증한다.
```

- [ ] **Step 3: CHANGELOG.md — insert above `## v0.8.3`**

```markdown
## v0.8.4 - Unreleased

### Benchmark effect measurement (spec 025)

The public 8-tool `structuredContent` contract and `schemaVersion` are
unchanged. `_meta.ops` is operational metadata, not part of the answer payload.

- **Added (spec 025)**: the benchmark records deterministic effect metrics —
  response payload tokens vs cited-source tokens (a conservative lower bound of
  parent context savings) and an independent `citationAccuracy` computed by
  re-reading cited files instead of trusting self-reported `groundingStatus`.
- **Added (spec 025)**: `explore_repo` and the six wrappers now return the same
  `_meta.ops` side-channel (`stats`, `transcriptPath`) the `explore` tool
  already had, fulfilling the spec 017 follow-up promise of a local ops
  channel.
- **Fixed (spec 025)**: dead benchmark metrics no longer fabricate values —
  `avgToolTurns`/`noToolExitRate` read real ops data (previously always
  `0`/`100%`), `budgetExhaustionRate` reads `searchCoverage`, transcript
  metrics run again via an auto-enabled temporary transcript directory
  (`--keep-transcripts` to retain), and the spec-011-dead
  `deepBudgetAvgTotalTokens` metric is deleted. Metrics without a source print
  `n/a`.
```

- [ ] **Step 4: Run the doc guards and commit**

Run: `npm test` — Expected: 0 fail (integrations.test.mjs CHANGELOG/README guards stay green)

```bash
git add README.md DESIGN.md CHANGELOG.md
git commit -m "docs(spec-025): document effect metrics, ops side-channel, and honest n/a reporting"
```

---

### Task 6: verification (Acceptance)

- [ ] **Step 1: Full suite** — Run: `npm test` — Expected: 0 fail
- [ ] **Step 2: Integration test (runtime export touched)** — Run: `node ./scripts/integration-test.mjs` (requires `CEREBRAS_API_KEY`) — Expected: 5/5 PASS
- [ ] **Step 3: Real benchmark run** — Run: `node ./scripts/run-benchmark.mjs --suite ./benchmarks/adoption.json --verbose --output "$env:TEMP\spec025-report.json"`
  Expected (acceptance): all cases PASS; `avg tool turns` > 0 (not `n/a`/`0` fabrication); `no-tool exit rate` < 100%; `avg broad searches`/`avg repeated plans` non-`n/a`; `payload tokens`/`cited source tokens`/`context savings` real numbers; `citation accuracy` reported (expected near 100% per the 2026-06-10 live probes). Inspect the JSON report: `metrics` contains the new fields; no temp transcript paths appear anywhere in the file.
- [ ] **Step 4: Honest-degrade spot check** — Run the evidence-preservation suite: `node ./scripts/run-benchmark.mjs --suite ./benchmarks/evidence-preservation.json --verbose` — Expected: weak citation checks counted for the `explore` case (citations[] carry no snippets); no crash.
- [ ] **Step 5: Spec closure prep** — update `specs/025-benchmark-effect-measurement/spec.md` Status line to `implemented <date>; closure verified (npm test <N>/0)` at landing, per project convention.

## Landing tasks (on merge, not at draft)

- [ ] Move the CLAUDE.md / AGENTS.md SPECKIT pointer to spec 025 (project convention: pointer moves at landing).
- [ ] CHANGELOG `v0.8.4 - Unreleased` heading gets its release date at the next release (separate release step per README procedure).
