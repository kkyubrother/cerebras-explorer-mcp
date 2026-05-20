# Tool Quality Improvements Implementation Plan

> Status note: proposed implementation plan, not current repository status. Re-check `TESTING.md`, `src/`, and `tests/` before executing tasks because verification counts and some current-state notes can drift as fixes land.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo's AGENTS guidance says subagents should be used only when needed, so inline execution is the default path unless a task owner deliberately splits off an independent benchmark or docs task.

**Goal:** Convert the tool-quality review into concrete, testable changes that improve V2 evidence reliability, report-mode handoff quality, router decisions, and adoption measurement without expanding the read-only trust boundary.

**Architecture:** Keep `explore_repo` as the structured core and keep wrapper tools as slim task-mode shortcuts. Improve `explore`/`explore_v2` report-mode metadata by deriving citations and targets deterministically from the Markdown report, and measure V2 truncation/compaction risk before making V2 the only backend.

**Tech Stack:** Node.js ESM, built-in `node:test`, MCP JSON-RPC handlers, existing `ExplorerRuntime`, existing benchmark runner, Markdown docs.

---

## Current-State Reconciliation

- P0 truncation wording is still valid: `src/explorer/runtime.mjs` currently says "Full data was inspected; key content preserved above" after a prefix slice.
- P0 `TESTING.md` drift has moved again since this plan was written; current verification lives in `TESTING.md`, and this plan's direction is to avoid treating fixed totals as a release contract.
- P1 wrapper unknown-key rejection is already implemented in `validatePublicToolArgs()` and covered for `trace_symbol`; this plan expands it into a full wrapper matrix.
- `searchCoverage.warnings` already reports truncation, but the wording should explicitly say truncation happened before synthesis and missing expected evidence requires a narrower rerun or targeted read.
- `explore_v2` stays opt-in as a public tool. Router improvements happen only inside the normal `explore` handler.

## File Structure

- Modify `src/explorer/runtime.mjs`: replace misleading V2 truncation text, expose deterministic report citations/targets for report tools, keep V2 stats and search coverage honest.
- Modify `src/explorer/critic.mjs`: reuse or lightly extend existing report citation extraction helpers when needed.
- Modify `src/mcp/server.mjs`: strengthen `explore` router heuristics and ensure report-mode structuredContent carries derived citation metadata.
- Modify `src/benchmark/evaluator.mjs`: add citation and truncation/compaction checks for benchmark suites.
- Create `src/benchmark/transcript-metrics.mjs`: parse JSONL transcript entries into adoption metrics.
- Modify `scripts/run-benchmark.mjs`: include evidence-preservation and transcript metrics in JSON output and console summary.
- Modify `benchmarks/adoption.json`: add adoption checks that match the compact contract.
- Create `benchmarks/evidence-preservation.json`: separate suite for V1/V2 report citation preservation.
- Modify `tests/runtime.mock.test.mjs`: add deterministic V2 truncation and citation preservation tests.
- Modify `tests/free-explore.test.mjs`: assert report-mode `citations[]` and `targets[]`.
- Modify `tests/mcp-server.test.mjs`: broaden wrapper unknown-key rejection tests and router tests.
- Modify `tests/benchmark-evaluator.test.mjs`: cover new benchmark checks.
- Create `tests/benchmark-transcript-metrics.test.mjs`: cover transcript-derived adoption metrics.
- Modify `tests/integrations.test.mjs`: assert `TESTING.md` avoids fixed test totals.
- Modify `TESTING.md`: describe the verification contract as command plus pass/fail rule, not a stale fixed count.
- Modify `README.md` and `DESIGN.md`: document V2 risk controls, report citations, router behavior, benchmark commands, and unchanged trust-boundary decisions.

## Guardrails

- Do not remove `explain_code_path` or `collect_evidence` until transcript/adoption metrics show low value.
- Do not expose `explore_v2` by default.
- Do not add write/edit/apply-patch tools to this MCP server.
- Do not expose low-level repo tools to the parent MCP surface.
- Do not rework `candidatePaths` as part of this plan; the public compact contract remains `directAnswer`, `status`, `targets`, `evidence`, `uncertainties`, `nextAction`, `sessionId`, and derived metadata.
- Do not add an LSP dependency for symbol precision work.

---

## Task 1: Fix V2 Truncation Trust Wording

**Files:**
- Modify: `src/explorer/runtime.mjs`
- Test: `tests/runtime.mock.test.mjs`

- [ ] **Step 1: Add a failing V2 truncation test**

Append this test near the existing `freeExploreV2` tests in `tests/runtime.mock.test.mjs`:

```js
test('freeExploreV2 labels truncated tool results as incomplete before synthesis', async () => {
  class TruncationClient {
    constructor() {
      this.model = 'zai-glm-4.7';
      this.calls = 0;
      this.snapshots = [];
    }

    async createChatCompletion({ messages }) {
      this.calls += 1;
      this.snapshots.push(messages);
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          message: {
            content: null,
            toolCalls: [
              {
                id: 'read-large',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path: 'src/large.js', startLine: 1, endLine: 700 }),
                },
              },
            ],
          },
        };
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'Large report cites `src/large.js:L1-L2`.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const largeSource = Array.from(
    { length: 700 },
    (_, index) => `export const value${index} = '${'x'.repeat(60)}';`,
  ).join('\n');
  await fs.writeFile(path.join(root, 'src', 'large.js'), largeSource);

  const client = new TruncationClient();
  const runtime = new ExplorerRuntime({ chatClient: client });
  const result = await runtime.freeExploreV2({
    prompt: 'inspect a large file and produce a cited report',
    repo_root: root,
    thoroughness: 'quick',
  });

  const secondTurnMessages = client.snapshots[1] ?? [];
  const toolMessage = secondTurnMessages.find(message => message.role === 'tool');
  assert.ok(toolMessage, 'second model call must include the truncated tool result');
  assert.match(toolMessage.content, /Result was truncated before model synthesis/);
  assert.doesNotMatch(toolMessage.content, /Full data was inspected/);
  assert.equal(result.searchCoverage.toolResultsTruncated, 1);
  assert.ok(
    result.searchCoverage.warnings.some(warning => /expected evidence is missing/i.test(warning)),
    'searchCoverage warning must tell the parent agent how to recover missing evidence',
  );
});
```

- [ ] **Step 2: Run the targeted test and verify red**

Run:

```powershell
node --test tests/runtime.mock.test.mjs --test-name-pattern "freeExploreV2 labels truncated tool results"
```

Expected: FAIL because the current truncation message still contains "Full data was inspected" and `searchCoverage.warnings` does not mention missing expected evidence.

- [ ] **Step 3: Replace the truncation marker and warning text**

In `src/explorer/runtime.mjs`, replace `applyToolResultCharBudget()` with this version and update the truncation counter to use the marker:

```js
const TRUNCATED_TOOL_RESULT_MARKER = '[truncated-tool-result-before-synthesis]';

function applyToolResultCharBudget(toolName, toolResult) {
  const serialized = JSON.stringify(redactValue(toolResult).value);
  const budget = TOOL_RESULT_CHAR_BUDGETS[toolName] ?? TOOL_RESULT_CHAR_BUDGETS._default;
  if (serialized.length <= budget) return serialized;

  const preview = serialized.slice(0, budget - 180);
  return preview +
    `\n... ${TRUNCATED_TOOL_RESULT_MARKER} [truncated: ${serialized.length} -> ${budget} chars. ` +
    'Result was truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing.]';
}
```

Replace the V2 counter check:

```js
if (serialized.includes(TRUNCATED_TOOL_RESULT_MARKER)) {
  stats.toolResultsTruncated += 1;
}
```

Update `buildSearchCoverage()` truncation warning:

```js
if ((stats.toolResultsTruncated ?? 0) > 0) {
  warnings.push(
    `${stats.toolResultsTruncated} tool result(s) were truncated before model synthesis; ` +
    're-run with a narrower query or read specific ranges if expected evidence is missing.',
  );
}
```

- [ ] **Step 4: Verify the targeted test passes**

Run:

```powershell
node --test tests/runtime.mock.test.mjs --test-name-pattern "freeExploreV2 labels truncated tool results"
```

Expected: PASS with 0 failures for the new test.

- [ ] **Step 5: Commit**

```powershell
git add src/explorer/runtime.mjs tests/runtime.mock.test.mjs
git commit -m "fix: clarify v2 truncation evidence limits"
```

---

## Task 2: Add Structured Citations to Report Tools

**Files:**
- Modify: `src/explorer/runtime.mjs`
- Modify: `src/explorer/critic.mjs` only if the existing extractors need a small normalization helper
- Test: `tests/free-explore.test.mjs`
- Test: `tests/mcp-server.test.mjs`

- [ ] **Step 1: Add failing runtime tests for report citations**

In `tests/free-explore.test.mjs`, add this test:

```js
test('freeExplore exposes report citations and citation targets', async () => {
  class CitationReportClient {
    constructor() { this.model = 'test'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'Summary cites `src/auth.js:L1-L3` and `src/routes/user.js:L2`.',
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new CitationReportClient() });
  const result = await runtime.freeExplore({
    prompt: 'explain auth flow with citations',
    repo_root: root,
    thoroughness: 'quick',
  });

  assert.deepEqual(result.citations.map(item => ({
    type: item.type,
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
  })), [
    { type: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 3 },
    { type: 'file_range', path: 'src/routes/user.js', startLine: 2, endLine: 2 },
  ]);
  assert.deepEqual(result.targets.map(item => ({
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
    role: item.role,
  })), [
    { path: 'src/auth.js', startLine: 1, endLine: 3, role: 'reference' },
    { path: 'src/routes/user.js', startLine: 2, endLine: 2, role: 'reference' },
  ]);
});
```

- [ ] **Step 2: Add a failing MCP structuredContent test**

In `tests/mcp-server.test.mjs`, add a test that calls the public `explore` tool and asserts the text response remains Markdown while `structuredContent.citations` is machine-readable:

```js
test('explore returns Markdown text plus structured citations', async () => {
  class CitationClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion() {
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: 'Auth flow: `src/auth.js:L1-L3`.',
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new CitationClient() },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 31,
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: { prompt: 'explain auth flow', repo_root: repoRoot, thoroughness: 'quick' },
    },
  });

  assert.equal(called.content[0].text, 'Auth flow: `src/auth.js:L1-L3`.');
  assert.deepEqual(called.structuredContent.citations.map(item => ({
    type: item.type,
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
  })), [
    { type: 'file_range', path: 'src/auth.js', startLine: 1, endLine: 3 },
  ]);
  assert.equal(called.structuredContent.targets[0].role, 'reference');
});
```

- [ ] **Step 3: Run the targeted tests and verify red**

Run:

```powershell
node --test tests/free-explore.test.mjs tests/mcp-server.test.mjs --test-name-pattern "citations|structured citations"
```

Expected: FAIL because `freeExplore()` and `freeExploreV2()` currently return `report`, `filesRead`, `toolsUsed`, `stats`, `critic`, and coverage fields, but not `citations[]` or report `targets[]`.

- [ ] **Step 4: Add deterministic citation normalization**

In `src/explorer/runtime.mjs`, import the existing citation extractors:

```js
import {
  buildReportCritic,
  deriveTaskKindFromHints,
  extractGitCitations,
  extractReportCitations,
  runDeterministicCriticPass,
} from './critic.mjs';
```

Add these helpers near `buildSearchCoverage()`:

```js
function buildReportCitations(report) {
  const fileCitations = extractReportCitations(report).map(item => ({
    type: 'file_range',
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
    raw: item.raw,
  }));
  const gitCitations = extractGitCitations(report).map(item => ({
    type: item.type ?? 'git_commit',
    ...(item.path ? { path: item.path } : {}),
    ...(Number.isInteger(item.line) ? { startLine: item.line, endLine: item.line } : {}),
    ...(item.sha ? { sha: item.sha } : {}),
    raw: item.raw,
  }));
  return [...fileCitations, ...gitCitations];
}

function buildReportCitationTargets(citations) {
  const seen = new Set();
  const targets = [];
  for (const citation of citations) {
    if (!citation.path) continue;
    const key = `${citation.path}:${citation.startLine ?? ''}:${citation.endLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      path: citation.path,
      ...(Number.isInteger(citation.startLine) ? { startLine: citation.startLine } : {}),
      ...(Number.isInteger(citation.endLine) ? { endLine: citation.endLine } : {}),
      role: 'reference',
      reason: 'Markdown report citation',
      evidenceRefs: [],
    });
  }
  return targets;
}
```

- [ ] **Step 5: Attach citations to both report-mode returns**

In both `freeExplore()` and `freeExploreV2()`, compute citations after `reportFilesRead` and before the return:

```js
const citations = buildReportCitations(report);
const targets = buildReportCitationTargets(citations);
```

Add the fields to both returned objects:

```js
return {
  report,
  citations,
  targets,
  filesRead: reportFilesRead,
  toolsUsed: [...toolsUsed],
  stats,
  critic,
  searchCoverage: buildSearchCoverage(stats),
  toolTrace: toolTrace.toJSON(),
};
```

For `freeExploreV2()`, keep the existing `transcriptPath` field:

```js
return {
  report,
  citations,
  targets,
  filesRead: reportFilesRead,
  toolsUsed: [...toolsUsed],
  stats,
  critic,
  searchCoverage: buildSearchCoverage(stats),
  transcriptPath: transcript.filePath,
  toolTrace: toolTrace.toJSON(),
};
```

- [ ] **Step 6: Verify report citation tests pass**

Run:

```powershell
node --test tests/free-explore.test.mjs tests/mcp-server.test.mjs --test-name-pattern "citations|structured citations"
```

Expected: PASS with 0 failures for the new report citation tests.

- [ ] **Step 7: Commit**

```powershell
git add src/explorer/runtime.mjs tests/free-explore.test.mjs tests/mcp-server.test.mjs
git commit -m "feat: expose structured citations for report tools"
```

---

## Task 3: Add Evidence Preservation Benchmark Coverage

**Files:**
- Modify: `src/benchmark/evaluator.mjs`
- Modify: `tests/benchmark-evaluator.test.mjs`
- Create: `benchmarks/evidence-preservation.json`
- Modify: `package.json`

- [ ] **Step 1: Add failing evaluator tests for citation checks**

In `tests/benchmark-evaluator.test.mjs`, add:

```js
test('evaluateBenchmarkCase scores report citation preservation checks', () => {
  const caseDefinition = {
    id: 'citation-preservation',
    passScore: 1,
    checks: [
      { label: 'Citation count', type: 'min_citation_count', value: 2, weight: 0.3 },
      { label: 'Citation files', type: 'min_citation_file_count', value: 2, weight: 0.3 },
      { label: 'No truncation', type: 'tool_results_truncated_equals', value: false, weight: 0.2 },
      { label: 'No citation gap', type: 'citation_gap_warning_equals', value: false, weight: 0.2 },
    ],
  };

  const result = {
    report: 'Report cites `src/a.js:L1-L2` and `src/b.js:L3`.',
    citations: [
      { type: 'file_range', path: 'src/a.js', startLine: 1, endLine: 2 },
      { type: 'file_range', path: 'src/b.js', startLine: 3, endLine: 3 },
    ],
    searchCoverage: { toolResultsTruncated: 0 },
    critic: { warnings: [] },
  };

  const evaluation = evaluateBenchmarkCase(caseDefinition, result);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.checks[0].actual, 2);
  assert.equal(evaluation.checks[1].actual, 2);
});
```

- [ ] **Step 2: Run the evaluator test and verify red**

Run:

```powershell
node --test tests/benchmark-evaluator.test.mjs --test-name-pattern "citation preservation"
```

Expected: FAIL with `Unknown benchmark check type: min_citation_count`.

- [ ] **Step 3: Add citation and truncation checks to the evaluator**

In `src/benchmark/evaluator.mjs`, add helpers near `countGroundedEvidence()`:

```js
function getCitations(result) {
  return Array.isArray(result?.citations) ? result.citations : [];
}

function countCitationFiles(result) {
  return new Set(getCitations(result).map(item => item.path).filter(Boolean)).size;
}

function hasCitationGapWarning(result) {
  return (result?.critic?.warnings ?? []).some(warning => warning.type === 'citation_gap');
}

function toolResultsWereTruncated(result) {
  const coverageValue = result?.searchCoverage?.toolResultsTruncated ?? 0;
  const statsValue = getStats(result).toolResultsTruncated ?? 0;
  return coverageValue > 0 || statsValue > 0;
}
```

Add cases to `evaluateCheck()`:

```js
    case 'min_citation_count':
      actual = getCitations(result).length;
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'min_citation_file_count':
      actual = countCitationFiles(result);
      passed = actual >= Number(check.value ?? 0);
      break;
    case 'citation_gap_warning_equals':
      actual = hasCitationGapWarning(result);
      passed = actual === Boolean(check.value);
      break;
    case 'tool_results_truncated_equals':
      actual = toolResultsWereTruncated(result);
      passed = actual === Boolean(check.value);
      break;
```

- [ ] **Step 4: Add a focused evidence preservation suite**

Create `benchmarks/evidence-preservation.json`:

```json
{
  "name": "evidence-preservation-report-tools",
  "description": "Checks whether explore/explore_v2 reports preserve machine-readable citations when report synthesis is broad or deep.",
  "defaultPassScore": 0.78,
  "cases": [
    {
      "id": "explore-router-deep-report-citations",
      "description": "The normal explore tool should route deep report work to the V2 backend while preserving structured citations.",
      "tool": "explore",
      "args": {
        "prompt": "Deep dive into how V2 truncation, compaction, and final report synthesis work. Cite src/explorer/runtime.mjs, src/explorer/prompt.mjs, and tests/runtime.mock.test.mjs line ranges.",
        "thoroughness": "deep",
        "scope": ["src/explorer/runtime.mjs", "src/explorer/prompt.mjs", "tests/runtime.mock.test.mjs"]
      },
      "expectations": [
        {
          "label": "Report discusses V2 evidence risks",
          "source": "combined_text",
          "groups": [["truncation", "truncated"], ["compaction", "compact"], ["citation", "evidence"]],
          "weight": 0.35
        }
      ],
      "checks": [
        { "label": "Citations present", "type": "min_citation_count", "value": 3, "weight": 0.25 },
        { "label": "Multiple cited files", "type": "min_citation_file_count", "value": 2, "weight": 0.2 },
        { "label": "No citation gap warning", "type": "citation_gap_warning_equals", "value": false, "weight": 0.2 }
      ]
    }
  ]
}
```

- [ ] **Step 5: Add an npm script for the new suite**

In `package.json`, add:

```json
"benchmark:evidence": "node ./scripts/run-benchmark.mjs --suite ./benchmarks/evidence-preservation.json"
```

Keep the existing `benchmark` script unchanged.

- [ ] **Step 6: Verify evaluator tests pass**

Run:

```powershell
node --test tests/benchmark-evaluator.test.mjs
```

Expected: PASS with 0 failures.

- [ ] **Step 7: Verify the benchmark suite can be parsed**

Run without provider calls by evaluating the JSON with Node:

```powershell
node -e "const fs=require('fs'); const s=JSON.parse(fs.readFileSync('benchmarks/evidence-preservation.json','utf8')); if(!Array.isArray(s.cases)||s.cases.length!==1) throw new Error('invalid suite');"
```

Expected: exits with code 0.

- [ ] **Step 8: Commit**

```powershell
git add src/benchmark/evaluator.mjs tests/benchmark-evaluator.test.mjs benchmarks/evidence-preservation.json package.json
git commit -m "test: benchmark report evidence preservation"
```

---

## Task 4: Remove Fixed Test Totals From TESTING.md

**Files:**
- Modify: `TESTING.md`
- Modify: `tests/integrations.test.mjs`

- [ ] **Step 1: Add a failing docs test**

In `tests/integrations.test.mjs`, add:

```js
test('TESTING.md describes the test contract without hard-coded totals', async () => {
  const testing = await read('TESTING.md');
  assert.match(testing, /npm test/);
  assert.match(testing, /0 (failures|fail)/i);
  assert.doesNotMatch(testing, /\b\d+\s+tests\b/i);
  assert.doesNotMatch(testing, /\b\d+\s+pass\b/i);
  assert.doesNotMatch(testing, /\b\d+\s+skipped\b/i);
});
```

- [ ] **Step 2: Run the docs test and verify red**

Run:

```powershell
node --test tests/integrations.test.mjs --test-name-pattern "TESTING.md"
```

Expected: FAIL because `TESTING.md` currently contains fixed observed totals.

- [ ] **Step 3: Replace the fixed-count paragraph**

In `TESTING.md`, replace the current-count paragraph with:

```md
성공 기준은 `npm test`가 `0 fail`로 종료되는 것입니다. 테스트 총수와 skip 수는 새 테스트 추가와 OS 환경에 따라 바뀌므로 이 문서에서는 고정된 숫자를 릴리스 기준으로 삼지 않습니다.

- Windows/환경 의존 git 경로 안전성 테스트는 환경에 따라 skip될 수 있습니다.
- `git` 또는 `rg`가 없는 환경에서는 추가 skip이 생길 수 있습니다.
- PR 또는 릴리스 검증에서는 항상 현재 checkout에서 `npm test`를 다시 실행합니다.
```

- [ ] **Step 4: Verify the docs test passes**

Run:

```powershell
node --test tests/integrations.test.mjs --test-name-pattern "TESTING.md"
```

Expected: PASS with 0 failures for the docs test.

- [ ] **Step 5: Commit**

```powershell
git add TESTING.md tests/integrations.test.mjs
git commit -m "docs: avoid stale test totals"
```

---

## Task 5: Expand Wrapper Unknown-Key Regression Coverage

**Files:**
- Modify: `tests/mcp-server.test.mjs`
- Modify: `src/mcp/server.mjs` only if the matrix test exposes a missing guard

- [ ] **Step 1: Replace the single unknown-key test with a wrapper matrix**

Replace the current `MCP request handler rejects unknown wrapper arguments before runtime execution` test in `tests/mcp-server.test.mjs` with:

```js
test('MCP request handler rejects unknown wrapper arguments before runtime execution', async () => {
  class ShouldNotRunChatClient {
    constructor() {
      this.model = 'zai-glm-4.7';
    }

    async createChatCompletion() {
      throw new Error('runtime should not be invoked for invalid wrapper arguments');
    }
  }

  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: {
      chatClient: new ShouldNotRunChatClient(),
    },
  });

  const cases = [
    { name: 'find_relevant_code', args: { query: 'find auth', language: 'ko' }, unknown: 'language' },
    { name: 'trace_symbol', args: { symbol: 'requireAuth', context: 'not public' }, unknown: 'context' },
    { name: 'map_change_impact', args: { change: 'change auth', prompt: 'not public' }, unknown: 'prompt' },
    { name: 'explain_code_path', args: { pathQuery: 'auth request path', knownText: ['auth'] }, unknown: 'knownText' },
    { name: 'collect_evidence', args: { claim: 'auth is guarded', entryPoint: 'src/auth.js' }, unknown: 'entryPoint' },
    { name: 'review_change_context', args: { reviewGoal: 'review auth changes', knownFiles: ['src/auth.js'] }, unknown: 'knownFiles' },
  ];

  for (const testCase of cases) {
    const called = await handleRequest({
      jsonrpc: '2.0',
      id: `invalid-${testCase.name}`,
      method: 'tools/call',
      params: {
        name: testCase.name,
        arguments: testCase.args,
      },
    });

    assert.equal(called.isError, true, `${testCase.name} must return an MCP error`);
    assert.match(called.content[0].text, new RegExp(`Invalid arguments for ${testCase.name}`));
    assert.match(called.content[0].text, new RegExp(`Unknown ${testCase.name} argument: ${testCase.unknown}`));
    assert.doesNotMatch(called.content[0].text, /runtime should not be invoked/);
    assert.equal(called.structuredContent.failure.category, 'input');
    assert.equal(called.structuredContent.failure.reason, 'invalid_arguments');
  }
});
```

- [ ] **Step 2: Run the matrix test**

Run:

```powershell
node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"
```

Expected: PASS on the current checkout because `validatePublicToolArgs()` already rejects unknown keys for every public tool before wrapper builders call runtime.

- [ ] **Step 3: If the matrix fails, keep the guard centralized**

If a wrapper path bypasses the guard, do not add one-off destructuring checks inside each builder. Keep the centralized `validatePublicToolArgs()` pattern and route the missing tool through it before `callTool()`.

The dispatch shape must remain:

```js
if (name === 'collect_evidence') {
  validatePublicToolArgs(COLLECT_EVIDENCE_TOOL, args);
  return await callTool(buildCollectEvidenceArgs(args), progressToken, requestId);
}
```

- [ ] **Step 4: Commit**

```powershell
git add tests/mcp-server.test.mjs src/mcp/server.mjs
git commit -m "test: cover wrapper argument strictness"
```

---

## Task 6: Strengthen Explore Router Heuristics

**Files:**
- Modify: `src/mcp/server.mjs`
- Test: `tests/mcp-server.test.mjs`

- [ ] **Step 1: Add router tests for prompt length and broad scope**

In `tests/mcp-server.test.mjs`, add:

```js
test('explore router uses V2 for long or broad report prompts', async () => {
  class RouterClient {
    constructor() { this.model = 'zai-glm-4.7'; }
    async createChatCompletion({ messages }) {
      const system = messages[0]?.content ?? '';
      return {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          content: system.includes('Cerebras Explorer V2') ? 'V2 report' : 'V1 report',
          toolCalls: [],
        },
      };
    }
  }

  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new RouterClient() },
  });

  const normal = await handleRequest({
    jsonrpc: '2.0',
    id: 'router-normal',
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: { prompt: 'explain auth briefly', repo_root: repoRoot, thoroughness: 'quick' },
    },
  });
  assert.equal(normal.structuredContent.report, 'V1 report');

  const longPrompt = await handleRequest({
    jsonrpc: '2.0',
    id: 'router-long',
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: {
        prompt: `Explain architecture thoroughly. ${'detail '.repeat(220)}`,
        repo_root: repoRoot,
        thoroughness: 'normal',
      },
    },
  });
  assert.equal(longPrompt.structuredContent.report, 'V2 report');

  const broadScope = await handleRequest({
    jsonrpc: '2.0',
    id: 'router-broad',
    method: 'tools/call',
    params: {
      name: 'explore',
      arguments: {
        prompt: 'produce a subsystem review across this repo',
        repo_root: repoRoot,
        scope: ['src/**', 'tests/**', 'docs/**', 'integrations/**', 'benchmarks/**', 'scripts/**'],
      },
    },
  });
  assert.equal(broadScope.structuredContent.report, 'V2 report');
});
```

- [ ] **Step 2: Run the router test and verify red**

Run:

```powershell
node --test tests/mcp-server.test.mjs --test-name-pattern "explore router uses V2"
```

Expected: FAIL because the current router uses V2 only for `thoroughness: deep` or a narrow keyword regex.

- [ ] **Step 3: Replace the router with explicit signals**

In `src/mcp/server.mjs`, replace `shouldUseV2ForExplore(args)` with:

```js
function hasBroadExploreScope(scope) {
  if (!Array.isArray(scope)) return false;
  if (scope.length >= 6) return true;
  return scope.some(item => {
    const value = String(item ?? '').trim();
    return value === '.' || value === './' || value === '**' || value === '**/*' || value.endsWith('/**');
  });
}

function shouldUseV2ForExplore(args) {
  const prompt = String(args?.prompt ?? '');
  const lowerPrompt = prompt.toLowerCase();
  const context = String(args?.context ?? '');
  const scope = Array.isArray(args?.scope) ? args.scope : [];
  const broadReportIntent = /deep dive|comprehensive|entire codebase|large architecture|end-to-end|architecture review|subsystem review|전체|대규모|심층|종합|아키텍처|흐름/.test(lowerPrompt);

  return args?.thoroughness === 'deep' ||
    broadReportIntent ||
    prompt.length + context.length >= 1200 ||
    hasBroadExploreScope(scope);
}
```

- [ ] **Step 4: Verify router tests pass**

Run:

```powershell
node --test tests/mcp-server.test.mjs --test-name-pattern "explore router uses V2"
```

Expected: PASS with 0 failures for router behavior.

- [ ] **Step 5: Commit**

```powershell
git add src/mcp/server.mjs tests/mcp-server.test.mjs
git commit -m "feat: route broad explore reports to v2"
```

---

## Task 7: Add Transcript-Based Adoption Metrics

**Files:**
- Create: `src/benchmark/transcript-metrics.mjs`
- Create: `tests/benchmark-transcript-metrics.test.mjs`
- Modify: `scripts/run-benchmark.mjs`
- Modify: `benchmarks/adoption.json`

- [ ] **Step 1: Add failing tests for transcript metric parsing**

Create `tests/benchmark-transcript-metrics.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeTranscriptEntries } from '../src/benchmark/transcript-metrics.mjs';

test('analyzeTranscriptEntries summarizes parent-adoption signals', () => {
  const metrics = analyzeTranscriptEntries([
    { type: 'meta', tool: 'explore_v2', task: 'find auth' },
    { type: 'assistant', turn: 0, toolCalls: ['repo_grep', 'repo_read_file'] },
    { type: 'tool', turn: 0, tool: 'repo_grep', error: false },
    { type: 'tool', turn: 0, tool: 'repo_read_file', error: false },
    { type: 'assistant', turn: 1, toolCalls: ['repo_read_file'] },
    { type: 'tool', turn: 1, tool: 'repo_read_file', error: false },
    { type: 'meta', stats: { turns: 2, toolCalls: 3, stoppedByBudget: false } },
  ]);

  assert.deepEqual(metrics, {
    assistantTurns: 2,
    toolCalls: 3,
    broadSearchCalls: 1,
    readCalls: 2,
    toolErrorCalls: 0,
    repeatedToolPlanTurns: 0,
    stoppedByBudget: false,
  });
});

test('analyzeTranscriptEntries counts repeated tool plans', () => {
  const metrics = analyzeTranscriptEntries([
    { type: 'assistant', turn: 0, toolCalls: ['repo_grep'] },
    { type: 'assistant', turn: 1, toolCalls: ['repo_grep'] },
    { type: 'tool', turn: 0, tool: 'repo_grep', error: false },
    { type: 'tool', turn: 1, tool: 'repo_grep', error: true },
  ]);

  assert.equal(metrics.repeatedToolPlanTurns, 1);
  assert.equal(metrics.toolErrorCalls, 1);
});
```

- [ ] **Step 2: Run the metric tests and verify red**

Run:

```powershell
node --test tests/benchmark-transcript-metrics.test.mjs
```

Expected: FAIL because `src/benchmark/transcript-metrics.mjs` does not exist.

- [ ] **Step 3: Implement transcript metrics**

Create `src/benchmark/transcript-metrics.mjs`:

```js
import fs from 'node:fs/promises';

const BROAD_SEARCH_TOOLS = new Set(['repo_grep', 'repo_find_files', 'repo_list_dir']);
const READ_TOOLS = new Set(['repo_read_file', 'repo_symbol_context', 'repo_symbols', 'repo_references']);

function normalizeToolPlan(toolCalls) {
  return Array.isArray(toolCalls) ? toolCalls.filter(Boolean).sort().join('|') : '';
}

export function analyzeTranscriptEntries(entries) {
  const assistantEntries = entries.filter(entry => entry.type === 'assistant');
  const toolEntries = entries.filter(entry => entry.type === 'tool');
  let repeatedToolPlanTurns = 0;
  let previousPlan = '';

  for (const entry of assistantEntries) {
    const plan = normalizeToolPlan(entry.toolCalls);
    if (plan && plan === previousPlan) repeatedToolPlanTurns += 1;
    if (plan) previousPlan = plan;
  }

  const finalStats = [...entries].reverse().find(entry => entry.type === 'meta' && entry.stats)?.stats ?? {};

  return {
    assistantTurns: assistantEntries.length,
    toolCalls: toolEntries.length,
    broadSearchCalls: toolEntries.filter(entry => BROAD_SEARCH_TOOLS.has(entry.tool)).length,
    readCalls: toolEntries.filter(entry => READ_TOOLS.has(entry.tool)).length,
    toolErrorCalls: toolEntries.filter(entry => Boolean(entry.error)).length,
    repeatedToolPlanTurns,
    stoppedByBudget: Boolean(finalStats.stoppedByBudget),
  };
}

export async function analyzeTranscriptFile(filePath) {
  if (!filePath) return null;
  const raw = await fs.readFile(filePath, 'utf8');
  const entries = raw
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  return analyzeTranscriptEntries(entries);
}
```

- [ ] **Step 4: Wire metrics into benchmark reports**

In `scripts/run-benchmark.mjs`, import:

```js
import { analyzeTranscriptFile } from '../src/benchmark/transcript-metrics.mjs';
```

After each case run returns `result`, add:

```js
const transcriptMetrics = result.transcriptPath
  ? await analyzeTranscriptFile(result.transcriptPath).catch(() => null)
  : null;
const caseResult = { caseDefinition, evaluation, result, elapsedMs, transcriptMetrics };
```

Extend `computeExtendedMetrics()`:

```js
const transcriptCases = caseResults.filter(cr => cr.transcriptMetrics);
const avgBroadSearchCalls = transcriptCases.length > 0
  ? transcriptCases.reduce((sum, cr) => sum + cr.transcriptMetrics.broadSearchCalls, 0) / transcriptCases.length
  : null;
const avgRepeatedToolPlanTurns = transcriptCases.length > 0
  ? transcriptCases.reduce((sum, cr) => sum + cr.transcriptMetrics.repeatedToolPlanTurns, 0) / transcriptCases.length
  : null;
```

Add the rounded values to the returned metrics object:

```js
avgBroadSearchCalls: avgBroadSearchCalls !== null ? Math.round(avgBroadSearchCalls * 10) / 10 : null,
avgRepeatedToolPlanTurns: avgRepeatedToolPlanTurns !== null ? Math.round(avgRepeatedToolPlanTurns * 10) / 10 : null,
```

- [ ] **Step 5: Add adoption checks for structured handoff**

In `benchmarks/adoption.json`, add checks to existing cases rather than adding broad new prompts:

```json
{ "label": "Citations or evidence snippets present", "type": "min_evidence_snippet_count", "value": 1, "weight": 0.1 }
```

For report-mode cases added in Task 3, rely on `min_citation_count` instead of evidence snippets.

- [ ] **Step 6: Verify benchmark metric tests pass**

Run:

```powershell
node --test tests/benchmark-transcript-metrics.test.mjs
```

Expected: PASS with 0 failures.

- [ ] **Step 7: Commit**

```powershell
git add src/benchmark/transcript-metrics.mjs tests/benchmark-transcript-metrics.test.mjs scripts/run-benchmark.mjs benchmarks/adoption.json
git commit -m "feat: add transcript adoption metrics"
```

---

## Task 8: Add Symbol Precision Baseline Coverage

**Files:**
- Modify: `tests/symbols.test.mjs`
- Modify: `src/explorer/symbols.mjs` only for classifier gaps exposed by tests
- Modify: `DESIGN.md`

- [ ] **Step 1: Add precision tests for common parser-free relation cases**

Append these cases near the existing `classifyReference adds relation details without changing legacy type` test in `tests/symbols.test.mjs`:

```js
test('classifyReference distinguishes member, call, constructor, and type relations', () => {
  assert.deepEqual(
    classifyReference('session.touch();', 'touch', 'session.ts'),
    { type: 'usage', relation: 'member_call' },
  );
  assert.deepEqual(
    classifyReference('const manager = new SessionManager();', 'SessionManager', 'session.ts'),
    { type: 'usage', relation: 'constructor' },
  );
  assert.deepEqual(
    classifyReference('type Handler = (req: Request) => Response;', 'Request', 'types.ts'),
    { type: 'usage', relation: 'type_reference' },
  );
  assert.deepEqual(
    classifyReference('return requireAuth(req, res, next);', 'requireAuth', 'routes.js'),
    { type: 'usage', relation: 'call' },
  );
});
```

- [ ] **Step 2: Run the symbol tests**

Run:

```powershell
node --test tests/symbols.test.mjs --test-name-pattern "classifyReference"
```

Expected: PASS if the current classifier already covers the cases; FAIL if one relation is misclassified.

- [ ] **Step 3: Patch only failing classifier gaps**

If a case fails, patch `relationForUsage()` in `src/explorer/symbols.mjs` with ordered checks like:

```js
if (new RegExp(`\\bnew\\s+${escaped}\\s*\\(`).test(trimmed)) {
  return 'constructor';
}
if (new RegExp(`\\.${escaped}\\s*\\(`).test(trimmed)) {
  return 'member_call';
}
if (new RegExp(`\\b${escaped}\\s*\\(`).test(trimmed)) {
  return 'call';
}
```

Keep `categorizeReference()` returning the legacy `definition|import|usage` type and put extra precision only in `classifyReference().relation`.

- [ ] **Step 4: Document the long-term boundary**

In `DESIGN.md`, add this paragraph near the symbol/reference design section:

```md
Symbol precision remains parser-free by design. `repo_references` and `repo_symbol_context` may classify common relations such as `call`, `member_call`, `constructor`, `type_reference`, `import`, and `export`, but they do not claim LSP-level completeness. When relation confidence matters, parent agents should treat symbol results as a targeted map and verify returned line ranges before editing.
```

- [ ] **Step 5: Verify symbol tests pass**

Run:

```powershell
node --test tests/symbols.test.mjs
```

Expected: PASS with 0 failures.

- [ ] **Step 6: Commit**

```powershell
git add tests/symbols.test.mjs src/explorer/symbols.mjs DESIGN.md
git commit -m "test: capture symbol relation precision baseline"
```

---

## Task 9: Update Public Docs and Run Full Verification

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Verify: all touched files

- [ ] **Step 1: Update README tool-quality guidance**

Add this concise guidance to the tool section in `README.md`:

```md
`explore_repo` and the six wrapper tools are the normal agent-facing surface for structured handoff. `explore` remains the human-readable Markdown report tool; for broad or deep report prompts it may internally use the V2 backend. `explore_v2` is still opt-in because choosing V1 versus V2 is normally a runtime detail, not a parent-agent decision.

Report tools return Markdown as text and include derived `citations[]` and `targets[]` in `structuredContent` so parent agents do not need to regex-scrape file:line references before verification.
```

- [ ] **Step 2: Update DESIGN with V2 evidence controls**

Add this section to `DESIGN.md`:

```md
### V2 Evidence Reliability Gates

V2 is allowed to spend more turns and compact context, so it must make evidence loss visible. Tool-result truncation is labeled as happening before model synthesis, `searchCoverage.warnings` tells the caller how to recover missing evidence, and report-mode outputs expose derived `citations[]` plus citation `targets[]`.

V2 can become the sole report backend only after the evidence-preservation benchmark shows stable citation retention under broad report prompts and no unexplained citation-gap warnings.
```

- [ ] **Step 3: Verify focused test files**

Run:

```powershell
node --test tests/runtime.mock.test.mjs tests/free-explore.test.mjs tests/mcp-server.test.mjs tests/benchmark-evaluator.test.mjs tests/benchmark-transcript-metrics.test.mjs tests/integrations.test.mjs tests/symbols.test.mjs
```

Expected: PASS with 0 failures.

- [ ] **Step 4: Run full test suite**

Run:

```powershell
npm test
```

Expected: exits with code 0. Skip counts may vary by Windows/git availability; failures must be 0.

- [ ] **Step 5: Run non-provider benchmark validation**

Run:

```powershell
node -e "for (const f of ['benchmarks/adoption.json','benchmarks/evidence-preservation.json']) { const s=require('fs').readFileSync(f,'utf8'); JSON.parse(s); }"
```

Expected: exits with code 0.

- [ ] **Step 6: Optional provider benchmark run**

Run this only in an environment with a working provider key:

```powershell
npm run benchmark
npm run benchmark:evidence
```

Expected: benchmark commands complete and print per-case PASS/FAIL summaries. Record any failed case with its score and warnings before deciding whether V2 can replace V1.

- [ ] **Step 7: Commit**

```powershell
git add README.md DESIGN.md
git commit -m "docs: document tool quality gates"
```

---

## Execution Order

1. Task 1 first because it fixes a misleading trust statement.
2. Task 2 before Task 3 because benchmarks need `citations[]`.
3. Task 3 and Task 7 can be implemented separately after Task 2 because they touch different benchmark files.
4. Task 4 and Task 5 are low-risk maintenance and can be done anytime after Task 1.
5. Task 6 should happen after Task 2 so V2-routed report output has the same citation contract as V1.
6. Task 8 is long-term quality baseline and should not block P0/P1 work.
7. Task 9 closes docs and verification after all code/test changes land.

## Completion Criteria

- V2 truncated tool results no longer imply that full data was inspected.
- Report-mode MCP responses expose `structuredContent.citations[]` and citation-derived `targets[]`.
- Evidence-preservation benchmark suite exists and can evaluate citation retention.
- `TESTING.md` no longer creates stale test-count drift.
- Wrapper strict-argument behavior is covered for all six wrappers.
- `explore` routes broad report prompts to V2 using prompt length, context length, and scope signals in addition to keywords.
- Adoption metrics can read transcript JSONL and report broad-search/read/repeated-plan signals.
- Full `npm test` exits with 0 failures.
