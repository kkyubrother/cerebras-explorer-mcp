# Agent-Facing Contract Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo's AGENTS guidance says subagents should be used only when needed, so inline execution is the recommended path unless a reviewer explicitly asks for parallel implementation.

**Goal:** Improve the upper-agent experience by clarifying recommended tool exposure, making retry guidance directly actionable without unsafe input reflection, replacing fragile edit-intent regex decisions with wrapper-owned task modes, and exposing compact search coverage signals.

**Architecture:** Keep the model-generated compact result schema unchanged. Public MCP schemas remain additive, runtime-owned fields are derived after deterministic critic checks, and wrapper tools pass internal metadata that is never exposed as a user-callable input field.

**Tech Stack:** Node.js ESM, built-in `node:test`, MCP JSON schemas, existing ExplorerRuntime, existing integration examples.

---

## Current State

- `schemaVersion`, `evidenceQuality`, `failure`, top-level `session`, and MCP handled-error envelopes already exist.
- `failure.retry` currently exposes only `tool` and `hints`.
- `hasEditIntent(task)` currently uses regex over English/Korean task text.
- Codex and Gemini config examples currently expose a narrow 4-tool allowlist, while agent/skill instructions describe the full wrapper set.
- Runtime stats already track useful coverage signals such as `filesRead`, `grepCalls`, `listDirCalls`, `symbolCalls`, `toolResultsTruncated`, and `stoppedByBudget`, but these are not summarized in an agent-facing `searchCoverage` field.

## File Structure

- Modify `README.md`: split "recommended full wrapper" exposure from "minimal narrow allowlist"; explain why the 8-tool set is recommended for agent workflows.
- Modify `integrations/codex/config.toml.example`: make full 8-tool allowlist the primary example and keep a commented minimal 4-tool block.
- Modify `integrations/codex/AGENTS.md.example`: clarify that a narrow allowlist is an optional trust-boundary choice, not the default recommendation.
- Modify `integrations/gemini/settings.json.example`: make full 8-tool allowlist the primary example.
- Modify `integrations/gemini/README.md`: document full vs minimal allowlist and the trust-boundary tradeoff.
- Modify `tests/integrations.test.mjs`: update expectations for the full default allowlist and preserve a check that docs mention the minimal subset.
- Modify `src/explorer/schemas.mjs`: add optional `retry.args`, `retry.expectedImprovement`, and `searchCoverage` schemas.
- Modify `src/explorer/runtime.mjs`: sanitize retry recipes, carry internal `taskMode`, derive result status from task mode, and derive `searchCoverage`.
- Modify `src/mcp/server.mjs`: pass internal `taskMode` from wrapper builders and sanitize handled-error retry args.
- Modify `tests/schemas.test.mjs`: assert additive retry and coverage schema shape.
- Modify `tests/runtime.mock.test.mjs`: assert task-mode status behavior and search coverage output.
- Modify `tests/mcp-server.test.mjs`: assert wrapper task mode and sanitized retry args through MCP.
- Modify `DESIGN.md`: document retry recipe safety, task-mode precedence, and `searchCoverage`.

## Contract Decisions

- `retry.args` is optional and must be runtime-built, not a reflection of raw user input.
- `retry.args` must not include secret-like values, arbitrary unknown keys, or full original payloads.
- `retry.expectedImprovement` is optional, short, and human-readable.
- `taskMode` is internal only. It is accepted by `ExplorerRuntime.explore()` from trusted wrapper builders but is not added to `EXPLORE_REPO_INPUT_SCHEMA`.
- `hasEditIntent(task)` remains as fallback for direct `explore_repo` calls.
- `searchCoverage` is optional top-level agent-facing metadata. It is not model-generated and is not added to `EXPLORE_RESULT_JSON_SCHEMA`.
- `searchCoverage` summarizes coverage and truncation signals. It does not claim complete semantic coverage.

## Follow-up Tracking

- [ ] Evaluate removing `hasEditIntent(task)` fallback once all non-wrapper entry points
      either provide an explicit mode or intentionally keep text-based intent detection.

---

## Task 1: Align Integration Allowlist Documentation

**Files:**
- Modify: `README.md`
- Modify: `integrations/codex/config.toml.example`
- Modify: `integrations/codex/AGENTS.md.example`
- Modify: `integrations/gemini/settings.json.example`
- Modify: `integrations/gemini/README.md`
- Modify: `tests/integrations.test.mjs`

- [ ] **Step 1: Write failing integration tests**

Update `tests/integrations.test.mjs` so Gemini expects the full recommended tool set:

```js
  assert.deepEqual(server.includeTools, [
    'explore_repo',
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'review_change_context',
    'explore',
  ]);

  const readme = await read('integrations/gemini/README.md');
  assert.match(readme, /recommended full wrapper/i);
  assert.match(readme, /minimal 4-tool/i);
```

Update the Codex test to require both the full tool names and the minimal explanation:

```js
  assert.match(toml, /"explain_code_path"/);
  assert.match(toml, /"collect_evidence"/);
  assert.match(toml, /"review_change_context"/);
  assert.match(toml, /"explore"/);
  assert.match(toml, /minimal 4-tool/i);

  const agents = await read('integrations/codex/AGENTS.md.example');
  assert.match(agents, /recommended full wrapper/i);
  assert.match(agents, /minimal 4-tool/i);
```

- [ ] **Step 2: Run the integration tests and verify red**

Run:

```powershell
node --test tests/integrations.test.mjs
```

Expected: FAIL because current Codex/Gemini examples expose only 4 tools and the docs do not include the new recommended/minimal wording.

- [ ] **Step 3: Update the Codex config example**

Replace `integrations/codex/config.toml.example` lines 8-14 with:

```toml
# Recommended full wrapper allowlist for normal coding sessions.
# This keeps low-level repo tools hidden while exposing the purpose-built
# explorer entry points that reduce parent-agent search/read loops.
enabled_tools = [
  "explore_repo",
  "find_relevant_code",
  "trace_symbol",
  "map_change_impact",
  "explain_code_path",
  "collect_evidence",
  "review_change_context",
  "explore",
]

# Minimal 4-tool allowlist for stricter trust boundaries:
# enabled_tools = [
#   "explore_repo",
#   "find_relevant_code",
#   "trace_symbol",
#   "map_change_impact",
# ]
```

- [ ] **Step 4: Update the Codex agent instructions**

Append this paragraph after the tool preference list in `integrations/codex/AGENTS.md.example`:

```md
Recommended full wrapper exposure is `explore_repo`, `find_relevant_code`,
`trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`,
`review_change_context`, and `explore`. Use the minimal 4-tool allowlist only
when the session needs a deliberately narrower trust boundary; it removes
purpose-built evidence, path, review, and Markdown-report entry points.
```

- [ ] **Step 5: Update the Gemini settings example**

Replace `integrations/gemini/settings.json.example` `includeTools` with:

```json
      "includeTools": [
        "explore_repo",
        "find_relevant_code",
        "trace_symbol",
        "map_change_impact",
        "explain_code_path",
        "collect_evidence",
        "review_change_context",
        "explore"
      ],
```

- [ ] **Step 6: Update the Gemini README**

Replace the `includeTools` block in `integrations/gemini/README.md` with the same 8-tool list from Step 5. Add this paragraph after the existing `includeTools` explanation:

```md
Recommended full wrapper exposure is the 8-tool list above. It keeps low-level
repo operations hidden while giving the agent separate entry points for locate,
symbol tracing, impact mapping, path explanation, evidence collection, change
review, structured JSON, and cited Markdown reports. A minimal 4-tool allowlist
(`explore_repo`, `find_relevant_code`, `trace_symbol`, `map_change_impact`) is
reasonable for stricter trust boundaries, but it reduces the agent-facing value
of the wrapper set.
```

- [ ] **Step 7: Update README quickstart**

Replace the Codex CLI `enabled_tools` block in `README.md` with the same full 8-tool list:

```toml
enabled_tools = [
  "explore_repo",
  "find_relevant_code",
  "trace_symbol",
  "map_change_impact",
  "explain_code_path",
  "collect_evidence",
  "review_change_context",
  "explore",
]
```

Add this paragraph after the block:

```md
The 8-tool allowlist is the recommended full wrapper setup. For a stricter
minimal trust boundary, expose only `explore_repo`, `find_relevant_code`,
`trace_symbol`, and `map_change_impact`; that subset intentionally drops the
purpose-built evidence, path, review, and Markdown-report entry points.
```

- [ ] **Step 8: Run integration tests and verify green**

Run:

```powershell
node --test tests/integrations.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```powershell
git add README.md integrations/codex/config.toml.example integrations/codex/AGENTS.md.example integrations/gemini/settings.json.example integrations/gemini/README.md tests/integrations.test.mjs
git commit -m "docs: recommend full explorer wrapper allowlist"
```

---

## Task 2: Add Safe Retry Arguments

**Files:**
- Modify: `src/explorer/schemas.mjs`
- Modify: `src/explorer/runtime.mjs`
- Modify: `src/mcp/server.mjs`
- Modify: `tests/schemas.test.mjs`
- Modify: `tests/runtime.mock.test.mjs`
- Modify: `tests/mcp-server.test.mjs`
- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Write failing schema assertions**

In `tests/schemas.test.mjs`, inside the agent-facing output schema test, add:

```js
  const retrySchema = EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure.anyOf[1].properties.retry.anyOf[1];
  assert.ok(retrySchema.properties.args);
  assert.ok(retrySchema.properties.expectedImprovement);
  assert.equal(retrySchema.properties.args.additionalProperties, false);
```

- [ ] **Step 2: Write failing runtime retry assertions**

In `tests/runtime.mock.test.mjs`, inside the existing budget-exhaustion or repeated-tool-error test that asserts `result.failure.retry.tool`, add:

```js
  assert.equal(result.failure.retry.args.task, 'Retry with a narrower scope or a more specific symbol/file anchor.');
  assert.deepEqual(Object.keys(result.failure.retry.args).sort(), ['scope', 'task']);
  assert.equal(result.failure.retry.expectedImprovement, 'A narrower task should reduce repeated tool errors and improve grounding.');
```

Use the budget-exhaustion test for this assertion if it is easier to produce deterministic `scope`; the expected keys must remain `['scope', 'task']`.

- [ ] **Step 3: Write failing MCP handled-error retry assertions**

In `tests/mcp-server.test.mjs`, inside `MCP request handler returns execution failures for explore_repo without mislabeling them as argument errors`, add:

```js
  assert.deepEqual(called.structuredContent.failure.retry.args, {
    task: 'Retry after the provider recovers, or narrow the task and scope.',
    scope: [],
  });
  assert.equal(
    called.structuredContent.failure.retry.expectedImprovement,
    'A provider recovery or narrower scope should reduce failure risk.',
  );
```

- [ ] **Step 4: Run targeted tests and verify red**

Run:

```powershell
node --test tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

Expected: FAIL because `retry.args` and `retry.expectedImprovement` are not in the schema or runtime output.

- [ ] **Step 5: Extend the retry schema**

In `src/explorer/schemas.mjs`, add this schema before `RETRY_SCHEMA`:

```js
const RETRY_ARGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: { type: 'string' },
    query: { type: 'string' },
    symbol: { type: 'string' },
    change: { type: 'string' },
    pathQuery: { type: 'string' },
    claim: { type: 'string' },
    reviewGoal: { type: 'string' },
    prompt: { type: 'string' },
    scope: { type: 'array', items: { type: 'string' } },
    knownFiles: { type: 'array', items: { type: 'string' } },
    knownSymbols: { type: 'array', items: { type: 'string' } },
    knownText: { type: 'array', items: { type: 'string' } },
    hints: {
      type: 'object',
      additionalProperties: false,
      properties: {
        symbols: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' } },
        regex: { type: 'array', items: { type: 'string' } },
        strategy: {
          type: 'string',
          enum: ['symbol-first', 'reference-chase', 'git-guided', 'breadth-first', 'blame-guided', 'pattern-scan'],
        },
      },
    },
  },
};
```

Update `RETRY_SCHEMA.properties`:

```js
    hints: { type: 'array', items: { type: 'string' } },
    args: RETRY_ARGS_SCHEMA,
    expectedImprovement: { type: 'string' },
```

Keep `required: ['tool', 'hints']` unchanged for compatibility.

- [ ] **Step 6: Add retry sanitizer helpers in runtime**

In `src/explorer/runtime.mjs`, add these helpers above `makeFailure()`:

```js
const RETRY_TEXT_MAX = 500;
const RETRY_LIST_MAX = 8;

function sanitizeRetryText(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, RETRY_TEXT_MAX);
}

function sanitizeRetryList(value) {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, RETRY_LIST_MAX);
  return items.length > 0 ? items : [];
}

function sanitizeRetryHints(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const hints = {};
  const symbols = sanitizeRetryList(value.symbols);
  const files = sanitizeRetryList(value.files);
  const regex = sanitizeRetryList(value.regex);
  if (symbols) hints.symbols = symbols;
  if (files) hints.files = files;
  if (regex) hints.regex = regex;
  if (typeof value.strategy === 'string' &&
      ['symbol-first', 'reference-chase', 'git-guided', 'breadth-first', 'blame-guided', 'pattern-scan'].includes(value.strategy)) {
    hints.strategy = value.strategy;
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

function sanitizeRetryArgs(args = {}) {
  const safe = {};
  for (const key of ['task', 'query', 'symbol', 'change', 'pathQuery', 'claim', 'reviewGoal', 'prompt']) {
    const text = sanitizeRetryText(args[key]);
    if (text) safe[key] = text;
  }
  for (const key of ['scope', 'knownFiles', 'knownSymbols', 'knownText']) {
    const items = sanitizeRetryList(args[key]);
    if (items) safe[key] = items;
  }
  const hints = sanitizeRetryHints(args.hints);
  if (hints) safe.hints = hints;
  return safe;
}

function buildRetryRecipe({ tool = 'explore_repo', args = {}, hints = [], expectedImprovement = '' } = {}) {
  const retryTool = RETRY_TOOLS.includes(tool) ? tool : 'explore_repo';
  const safeArgs = sanitizeRetryArgs(args);
  const safeExpectedImprovement = sanitizeRetryText(expectedImprovement);
  return {
    tool: retryTool,
    hints: Array.isArray(hints) ? hints.filter(item => typeof item === 'string') : [],
    ...(Object.keys(safeArgs).length > 0 ? { args: safeArgs } : {}),
    ...(safeExpectedImprovement ? { expectedImprovement: safeExpectedImprovement } : {}),
  };
}
```

- [ ] **Step 7: Use sanitized retry recipes in runtime failures**

Replace `makeFailure()` with:

```js
function makeFailure(category, reason, message, retry = null) {
  return {
    category,
    reason,
    message,
    retry: retry ? buildRetryRecipe(retry) : null,
  };
}
```

Update `buildFailure()` retry objects:

```js
    return makeFailure('execution', 'tool_errors', 'Exploration stopped after repeated tool errors.', {
      tool: 'explore_repo',
      hints: ['Retry with a narrower scope or a more specific symbol/file anchor.'],
      args: {
        task: 'Retry with a narrower scope or a more specific symbol/file anchor.',
        scope: Array.isArray(stats.scope) ? stats.scope : [],
      },
      expectedImprovement: 'A narrower task should reduce repeated tool errors and improve grounding.',
    });
```

Use the same shape for `budget_exhausted`:

```js
    return makeFailure('execution', 'budget_exhausted', 'Exploration stopped at the turn budget before all follow-up checks were exhausted.', {
      tool: 'explore_repo',
      hints: ['Retry with a narrower scope or a more specific task.', 'Use deep budget only when repo-wide context is required.'],
      args: {
        task: 'Retry with a narrower scope or a more specific task.',
        scope: Array.isArray(stats.scope) ? stats.scope : [],
      },
      expectedImprovement: 'A narrower task should reduce budget pressure and improve evidence quality.',
    });
```

For `invalid_final_response`, use:

```js
      args: {
        task: 'Retry with a more specific task, symbol, file, or scope.',
        scope: Array.isArray(stats.scope) ? stats.scope : [],
      },
      expectedImprovement: 'A more specific prompt should improve compact JSON synthesis.',
```

- [ ] **Step 8: Store effective scope in runtime stats**

In `ExplorerRuntime.explore()`, after `const effectiveScope = ...`, ensure initial stats includes:

```js
      scope: Array.isArray(effectiveScope) ? effectiveScope : [],
```

Use the same `scope` field in `freeExplore()` and `freeExploreV2()` stats if those paths build retry recipes.

- [ ] **Step 9: Add server-side handled-error retry args**

In `src/mcp/server.mjs`, update `buildHandledFailure()` signature:

```js
  function buildHandledFailure({ category, reason, message, retryTool = 'explore_repo', hints = [], retryArgs = null, expectedImprovement = '' }) {
```

Update the retry object:

```js
        retry: retryTool ? {
          tool: retryTool,
          hints,
          ...(retryArgs ? { args: retryArgs } : {}),
          ...(expectedImprovement ? { expectedImprovement } : {}),
        } : null,
```

For provider failures, pass:

```js
                retryArgs: {
                  task: 'Retry after the provider recovers, or narrow the task and scope.',
                  scope: Array.isArray(args?.scope) ? args.scope.filter(item => typeof item === 'string').slice(0, 8) : [],
                },
                expectedImprovement: 'A provider recovery or narrower scope should reduce failure risk.',
```

Do not pass raw `args` directly.

- [ ] **Step 10: Document retry recipe safety**

In `README.md` near the `failure` explanation, add:

```md
`failure.retry.args` is a sanitized retry recipe, not a reflection of the
original tool input. It contains only bounded text fields, bounded string
arrays, and known hint keys that the runtime considers safe to hand back to an
upper agent.
```

In `DESIGN.md` near agent control precedence, add:

```md
Retry recipe safety:

- Runtime builds `failure.retry.args`; it does not echo arbitrary caller input.
- Retry text fields are bounded.
- Retry list fields are bounded.
- Unknown keys are dropped before the object reaches MCP `structuredContent`.
```

- [ ] **Step 11: Run targeted tests and verify green**

Run:

```powershell
node --test tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

Expected: PASS.

- [ ] **Step 12: Commit Task 2**

Run:

```powershell
git add src/explorer/schemas.mjs src/explorer/runtime.mjs src/mcp/server.mjs tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs README.md DESIGN.md
git commit -m "feat: add safe retry recipes"
```

---

## Task 3: Introduce Internal Task Modes

**Files:**
- Modify: `src/mcp/server.mjs`
- Modify: `src/explorer/runtime.mjs`
- Modify: `tests/runtime.mock.test.mjs`
- Modify: `tests/mcp-server.test.mjs`
- Modify: `DESIGN.md`

- [ ] **Step 1: Write failing runtime task-mode tests**

Add a test to `tests/runtime.mock.test.mjs` near the existing edit-planning tests:

```js
test('ExplorerRuntime uses internal taskMode before regex edit intent fallback', async () => {
  class EvidenceClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 8 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '근거가 충분합니다.',
            statusConfidence: 'high',
            evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: '검증 근거' }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new EvidenceClient() });
  const result = await runtime.explore({
    task: 'update claim evidence for review',
    repo_root: root,
    scope: ['src/**'],
    budget: 'quick',
    taskMode: 'evidence_verification',
  });

  assert.equal(result.status.verification, 'verified');
});
```

Add a companion edit-planning assertion:

```js
test('ExplorerRuntime taskMode marks edit planning as targeted read needed', async () => {
  class EditPlanningClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }
    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'call-read-1',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 8 }),
              },
            }],
          },
        };
      }
      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '변경 영향입니다.',
            statusConfidence: 'high',
            evidence: [{ path: 'src/auth.js', startLine: 1, endLine: 4, why: '변경 영향 근거' }],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new EditPlanningClient() });
  const result = await runtime.explore({
    task: 'Assess auth behavior',
    repo_root: root,
    scope: ['src/**'],
    budget: 'quick',
    taskMode: 'edit_planning',
  });

  assert.equal(result.status.verification, 'targeted_read_needed');
});
```

- [ ] **Step 2: Write failing MCP wrapper-mode assertion**

In `tests/mcp-server.test.mjs`, add a test using `collect_evidence` with a phrase that would match `hasEditIntent()` without task mode:

```js
test('collect_evidence wrapper uses evidence verification mode instead of edit regex fallback', async () => {
  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new MockChatClient() },
  });

  const called = await handleRequest({
    jsonrpc: '2.0',
    id: 88,
    method: 'tools/call',
    params: {
      name: 'collect_evidence',
      arguments: {
        claim: 'update behavior is already documented',
        repo_root: repoRoot,
        scope: ['src/**'],
      },
    },
  });

  assert.notEqual(called.structuredContent.status.verification, 'targeted_read_needed');
});
```

If `MockChatClient` produces edit targets, use a small local mock that returns only read/evidence targets so the test isolates `taskMode`.

- [ ] **Step 3: Run targeted tests and verify red**

Run:

```powershell
node --test tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

Expected: FAIL because runtime ignores `taskMode` and wrapper builders do not set it.

- [ ] **Step 4: Add task-mode constants and helpers**

In `src/explorer/runtime.mjs`, add near `hasEditIntent()`:

```js
const TASK_MODES = new Set([
  'locate',
  'symbol_trace',
  'edit_planning',
  'path_explanation',
  'evidence_verification',
  'change_review',
]);

function normalizeTaskMode(taskMode) {
  return TASK_MODES.has(taskMode) ? taskMode : null;
}

function isEditPlanningMode({ taskMode, task }) {
  const mode = normalizeTaskMode(taskMode);
  if (mode === 'edit_planning') return true;
  if (mode === 'evidence_verification' || mode === 'change_review' || mode === 'path_explanation' || mode === 'symbol_trace' || mode === 'locate') {
    return false;
  }
  return hasEditIntent(task);
}
```

- [ ] **Step 5: Use task mode in status derivation**

Change `buildResultStatus()` signature:

```js
function buildResultStatus(result, stats, { task, taskMode } = {}) {
```

Replace:

```js
  const editPlanning = hasEditIntent(task);
```

with:

```js
  const editPlanning = isEditPlanningMode({ taskMode, task });
```

Change the runtime call:

```js
    normalized.status = buildResultStatus(normalized, stats, {
      task: args.task,
      taskMode: args.taskMode,
    });
```

- [ ] **Step 6: Set taskMode in wrapper builders**

In `src/mcp/server.mjs`, add the following fields to builder returns:

```js
// buildTraceSymbolArgs
    taskMode: 'symbol_trace',
```

```js
// buildFindRelevantCodeArgs
    taskMode: 'locate',
```

```js
// buildMapChangeImpactArgs
    taskMode: 'edit_planning',
```

```js
// buildExplainCodePathArgs
    taskMode: 'path_explanation',
```

```js
// buildCollectEvidenceArgs
    taskMode: 'evidence_verification',
```

```js
// buildReviewChangeContextArgs
    taskMode: 'change_review',
```

Do not add `taskMode` to `EXPLORE_REPO_INPUT_SCHEMA`.

- [ ] **Step 7: Document task-mode precedence**

Add this paragraph to `DESIGN.md` near the wrapper-tool section:

```md
Wrapper tools pass an internal `taskMode` to runtime. Runtime uses this mode
before text-based edit-intent detection when deciding `status.verification` and
`nextAction`. Direct `explore_repo` calls still use text-based fallback because
they have no wrapper-owned intent.
```

- [ ] **Step 8: Run targeted tests and verify green**

Run:

```powershell
node --test tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```powershell
git add src/explorer/runtime.mjs src/mcp/server.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs DESIGN.md
git commit -m "feat: route wrapper intent through task modes"
```

---

## Task 4: Add Search Coverage Metadata

**Files:**
- Modify: `src/explorer/schemas.mjs`
- Modify: `src/explorer/runtime.mjs`
- Modify: `src/mcp/server.mjs`
- Modify: `tests/schemas.test.mjs`
- Modify: `tests/runtime.mock.test.mjs`
- Modify: `tests/mcp-server.test.mjs`
- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Write failing schema assertions**

In `tests/schemas.test.mjs`, inside the agent-facing output schema test, add:

```js
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.searchCoverage);
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.properties.searchCoverage.required, [
    'scope',
    'scopeLimited',
    'filesRead',
    'grepCalls',
    'listDirCalls',
    'symbolCalls',
    'toolResultsTruncated',
    'stoppedByBudget',
    'warnings',
    'summary',
  ]);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.searchCoverage, undefined);
```

- [ ] **Step 2: Write failing runtime coverage assertions**

In `tests/runtime.mock.test.mjs`, inside `ExplorerRuntime performs an autonomous tool loop and returns structured findings`, add:

```js
  assert.deepEqual(result.searchCoverage.scope, ['src/**']);
  assert.equal(result.searchCoverage.scopeLimited, true);
  assert.equal(result.searchCoverage.filesRead, result.stats.filesRead);
  assert.equal(result.searchCoverage.grepCalls, result.stats.grepCalls);
  assert.equal(result.searchCoverage.stoppedByBudget, false);
  assert.ok(Array.isArray(result.searchCoverage.warnings));
  assert.match(result.searchCoverage.summary, /scope-limited|repo-wide/);
```

Add an assertion in a budget stop test:

```js
  assert.equal(result.searchCoverage.stoppedByBudget, true);
  assert.ok(result.searchCoverage.warnings.some(warning => /budget/i.test(warning)));
```

- [ ] **Step 3: Write failing MCP coverage assertion**

In `tests/mcp-server.test.mjs`, inside `MCP request handler exposes explore_repo and returns structuredContent`, add:

```js
  assert.deepEqual(called.structuredContent.searchCoverage.scope, ['src/**']);
  assert.equal(called.structuredContent.searchCoverage.scopeLimited, true);
  assert.match(called.content[0].text, /Search Coverage/);
```

- [ ] **Step 4: Run targeted tests and verify red**

Run:

```powershell
node --test tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

Expected: FAIL because `searchCoverage` does not exist.

- [ ] **Step 5: Add search coverage schema**

In `src/explorer/schemas.mjs`, add before `EVIDENCE_ITEM_SCHEMA`:

```js
const SEARCH_COVERAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: { type: 'array', items: { type: 'string' } },
    scopeLimited: { type: 'boolean' },
    filesRead: { type: 'integer', minimum: 0 },
    grepCalls: { type: 'integer', minimum: 0 },
    listDirCalls: { type: 'integer', minimum: 0 },
    symbolCalls: { type: 'integer', minimum: 0 },
    toolResultsTruncated: { type: 'integer', minimum: 0 },
    stoppedByBudget: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: [
    'scope',
    'scopeLimited',
    'filesRead',
    'grepCalls',
    'listDirCalls',
    'symbolCalls',
    'toolResultsTruncated',
    'stoppedByBudget',
    'warnings',
    'summary',
  ],
};
```

Add this property to `EXPLORE_REPO_OUTPUT_SCHEMA.properties`:

```js
    searchCoverage: SEARCH_COVERAGE_SCHEMA,
```

Do not add `searchCoverage` to `EXPLORE_REPO_OUTPUT_SCHEMA.required` during this change. It is additive and may be absent from older handled-error paths until all callers are upgraded.

- [ ] **Step 6: Add runtime coverage helpers**

In `src/explorer/runtime.mjs`, add near `buildEvidenceQuality()`:

```js
function buildSearchCoverage(stats = {}) {
  const scope = Array.isArray(stats.scope)
    ? stats.scope.filter(item => typeof item === 'string')
    : [];
  const warnings = [];
  if (scope.length > 0) warnings.push(`Result is limited to scope: ${scope.join(', ')}`);
  if (stats.stoppedByBudget) warnings.push('Exploration stopped by budget before all follow-up checks were exhausted.');
  if ((stats.toolResultsTruncated ?? 0) > 0) warnings.push(`${stats.toolResultsTruncated} tool result(s) were truncated before final synthesis.`);

  const summary = scope.length > 0
    ? `scope-limited search across ${scope.join(', ')}; ${stats.filesRead ?? 0} file read(s), ${stats.grepCalls ?? 0} grep search(es).`
    : `repo-wide search; ${stats.filesRead ?? 0} file read(s), ${stats.grepCalls ?? 0} grep search(es).`;

  return {
    scope,
    scopeLimited: scope.length > 0,
    filesRead: stats.filesRead ?? 0,
    grepCalls: stats.grepCalls ?? 0,
    listDirCalls: stats.listDirCalls ?? 0,
    symbolCalls: stats.symbolCalls ?? 0,
    toolResultsTruncated: stats.toolResultsTruncated ?? 0,
    stoppedByBudget: Boolean(stats.stoppedByBudget),
    warnings,
    summary,
  };
}
```

Update `attachAgentFacingContract()`:

```js
  result.searchCoverage = buildSearchCoverage(stats);
```

- [ ] **Step 7: Preserve effective scope in all runtime stats**

In `ExplorerRuntime.explore()` stats object, add:

```js
      scope: Array.isArray(effectiveScope) ? effectiveScope : [],
```

In `freeExplore()` and `freeExploreV2()` stats objects, add the same `scope` field using their `effectiveScope`.

- [ ] **Step 8: Add MCP text rendering and handled-error default**

In `src/mcp/server.mjs`, add this helper near `defaultEvidenceQuality()`:

```js
  function defaultSearchCoverage(summary = 'No search coverage was recorded.') {
    return {
      scope: [],
      scopeLimited: false,
      filesRead: 0,
      grepCalls: 0,
      listDirCalls: 0,
      symbolCalls: 0,
      toolResultsTruncated: 0,
      stoppedByBudget: false,
      warnings: [],
      summary,
    };
  }
```

Add `searchCoverage` to `buildHandledFailure()`:

```js
      searchCoverage: defaultSearchCoverage(message),
```

Add `searchCoverage` to `toAgentFacingResult()`:

```js
      searchCoverage: result.searchCoverage ?? defaultSearchCoverage(),
```

In `formatExploreResult(result)`, after the evidence quality line, add:

```js
    if (result.searchCoverage) {
      lines.push(`Search Coverage: ${result.searchCoverage.summary}`);
    }
```

- [ ] **Step 9: Document coverage semantics**

In `README.md` near compact contract docs, add:

```md
`searchCoverage` summarizes what the explorer actually searched or read. It is
a quality signal, not a proof of complete semantic coverage. When
`scopeLimited` is true, absence of evidence means "not found inside this scope,"
not "not present in the repository."
```

In `DESIGN.md`, add:

```md
`searchCoverage` is runtime-owned metadata derived from stats. It reports scope,
basic read/search counts, budget stop, and tool-result truncation. It deliberately
does not expose raw `_debug.toolTrace` and does not claim LSP-level semantic
coverage.
```

- [ ] **Step 10: Run targeted tests and verify green**

Run:

```powershell
node --test tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Commit Task 4**

Run:

```powershell
git add src/explorer/schemas.mjs src/explorer/runtime.mjs src/mcp/server.mjs tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs README.md DESIGN.md
git commit -m "feat: expose compact search coverage"
```

---

## Task 5: Final Verification

**Files:**
- Verify all changed files from Tasks 1 through 4.

- [ ] **Step 1: Check the worktree**

Run:

```powershell
git status --short
```

Expected: only intentional tracked changes are present before the final commit, or no changes if each task was committed separately.

- [ ] **Step 2: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected: exit code 0.

- [ ] **Step 3: Run targeted contract tests**

Run:

```powershell
node --test tests/integrations.test.mjs tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

Expected: exit code 0.

- [ ] **Step 4: Run full test suite**

Run:

```powershell
npm test
```

Expected: exit code 0 with no failures. Current baseline is `297 tests`, `294 pass`, `3 skipped`, `0 fail`; future test count may increase after this plan.

- [ ] **Step 5: Inspect final diff summary**

Run:

```powershell
git log --oneline -6
git status --short
```

Expected: recent commits correspond to the four task commits above and no unrelated files are staged.

---

## Self-Review

Spec coverage:

- Integration allowlist alignment is covered by Task 1.
- Safe retry args and the no-raw-reflection rule are covered by Task 2.
- Wrapper-owned task modes and regex fallback are covered by Task 3.
- Compact source/search coverage is covered by Task 4.
- Full verification is covered by Task 5.

Placeholder scan:

- The plan has no open-ended completion-marker steps.
- Each code-changing task starts with failing tests, then implementation, then targeted verification.

Type consistency:

- Retry uses `tool`, `hints`, optional `args`, and optional `expectedImprovement`.
- Search coverage consistently uses `searchCoverage`.
- Task mode values are `locate`, `symbol_trace`, `edit_planning`, `path_explanation`, `evidence_verification`, and `change_review`.

Scope:

- Persistent session/cache is intentionally excluded from this implementation plan because it needs a separate invalidation design for repo fingerprint, dirty working tree state, file hash/mtime checks, and stale evidence prevention.
- Provider latency/token observability is intentionally excluded from this implementation plan. Success-path details should remain in `_debug`; failure-path retry guidance is covered by Task 2.
