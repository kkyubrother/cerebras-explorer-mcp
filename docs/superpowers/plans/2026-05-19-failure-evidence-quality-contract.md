# Failure Evidence Quality Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo's AGENTS guidance says subagents should be used only when needed, so inline execution is the recommended path for this focused contract change.

**Goal:** Add a stable agent-facing `schemaVersion`, `evidenceQuality`, and structured `failure` contract to `explore_repo` results without asking the model to generate those fields.

**Architecture:** Keep the internal model schema compact-only and derived fields runtime-owned. `schemas.mjs` defines the public MCP envelope, `runtime.mjs` derives quality/failure from critic and stats, and `server.mjs` exposes the same fields in normal and handled error responses.

**Tech Stack:** Node.js ESM, built-in `node:test`, MCP JSON schemas, existing ExplorerRuntime and deterministic critic.

---

## File Structure

- Modify `src/explorer/schemas.mjs`: define `EVIDENCE_QUALITY_SCHEMA`, `FAILURE_SCHEMA`, nullable schema helper, and require `schemaVersion`, `evidenceQuality`, `failure` in `EXPLORE_REPO_OUTPUT_SCHEMA` only.
- Modify `src/explorer/runtime.mjs`: derive `evidenceQuality` and `failure` after critic grounding; preserve raw `confidenceScore` and `confidenceFactors` in `_debug`.
- Modify `src/mcp/server.mjs`: include new fields in `toAgentFacingResult()` and build structured failure content for handled MCP errors.
- Modify `tests/schemas.test.mjs`: assert the public schema changes and internal model schema remains unchanged.
- Modify `tests/runtime.mock.test.mjs`: assert normal, budget/error, and invalid-final-response runtime outputs.
- Modify `tests/mcp-server.test.mjs`: assert normal `structuredContent` and handled `isError` responses contain the new envelope fields.
- Modify `README.md` and `DESIGN.md`: document `schemaVersion`, `evidenceQuality`, `failure`, and the precedence rule.

## Contract Decisions

- `schemaVersion` is always `1` in agent-facing results.
- `evidenceQuality` is always present in agent-facing results and runtime final results.
- `failure` is always present in agent-facing results and is either `null` or a structured object.
- `failure` is for execution/input/provider/internal failure events. Low confidence is represented by `evidenceQuality.level` and `status`, not by `failure`.
- If `failure` is not `null`, an upper AI should inspect `failure.retry` before `nextAction`.
- If `failure` is `null`, an upper AI should use `nextAction` as it does today.
- `_debug.confidenceScore` and `_debug.confidenceFactors` remain diagnostic details and do not move into the top-level contract.

### Public Shapes

```js
const EVIDENCE_QUALITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    level: { type: 'string', enum: ['low', 'medium', 'high'] },
    exactCount: { type: 'integer' },
    partialCount: { type: 'integer' },
    droppedCount: { type: 'integer' },
    fileCount: { type: 'integer' },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['level', 'exactCount', 'partialCount', 'droppedCount', 'fileCount', 'warnings', 'summary'],
};

const FAILURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: ['execution', 'input', 'provider', 'internal'] },
    reason: {
      type: 'string',
      enum: [
        'budget_exhausted',
        'tool_errors',
        'aborted',
        'invalid_session',
        'repo_mismatch',
        'invalid_arguments',
        'provider_error',
        'access_denied',
        'invalid_final_response',
      ],
    },
    message: { type: 'string' },
    retry: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            tool: {
              type: 'string',
              enum: [
                'explore_repo',
                'find_relevant_code',
                'collect_evidence',
                'trace_symbol',
                'map_change_impact',
                'review_change_context',
                'explore',
              ],
            },
            hints: { type: 'array', items: { type: 'string' } },
          },
          required: ['tool', 'hints'],
        },
      ],
    },
  },
  required: ['category', 'reason', 'message', 'retry'],
};
```

### Derived Runtime Helpers

```js
const SCHEMA_VERSION = 1;

function buildEvidenceQuality(result, stats, grounding = {}) {
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const exactCount = evidence.filter(item => item.groundingStatus === 'exact').length;
  const partialCount = evidence.filter(item => item.groundingStatus === 'partial').length;
  const droppedCount = (grounding.droppedUngrounded ?? 0) + (grounding.droppedMalformed ?? 0);
  const fileCount = new Set(evidence.map(item => item.path).filter(Boolean)).size;
  const warnings = Array.isArray(result.status?.warnings) ? result.status.warnings.slice(0, 5) : [];
  const summary = result.trustSummary || buildTrustSummary(result, stats);

  return {
    level: result.status?.confidence ?? 'low',
    exactCount,
    partialCount,
    droppedCount,
    fileCount,
    warnings,
    summary,
  };
}

function buildFailure(result, stats) {
  if (result.failure === null) return null;
  if (result.failure && typeof result.failure === 'object') return normalizeFailure(result.failure);
  if (stats.stoppedByAbort) {
    return makeFailure('execution', 'aborted', 'Exploration was cancelled before completion.', null);
  }
  if (stats.stoppedByErrors) {
    return makeFailure('execution', 'tool_errors', 'Exploration stopped after repeated tool errors.', {
      tool: 'explore_repo',
      hints: ['Retry with a narrower scope or a more specific symbol/file anchor.'],
    });
  }
  if (stats.stoppedByBudget) {
    return makeFailure('execution', 'budget_exhausted', 'Exploration stopped at the turn budget before all follow-up checks were exhausted.', {
      tool: 'explore_repo',
      hints: ['Retry with a narrower scope or a more specific task.', 'Use deep budget only when the repo-wide context is required.'],
    });
  }
  return null;
}
```

## Task 1: Public Schema Contract

**Files:**
- Modify: `tests/schemas.test.mjs`
- Modify: `src/explorer/schemas.mjs`

- [ ] **Step 1: Write the failing schema test**

Update `tests/schemas.test.mjs` in `agent-facing output schema is compact and exposes directAnswer, status, targets, snippets, sessionId, and debug`:

```js
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.required, [
    'schemaVersion',
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
    'evidenceQuality',
    'failure',
  ]);
  assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const, 1);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.evidenceQuality);
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.failure);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.evidenceQuality, undefined);
  assert.equal(EXPLORE_RESULT_JSON_SCHEMA.schema.properties.failure, undefined);
```

- [ ] **Step 2: Run the schema test and verify red**

Run:

```powershell
node --test tests/schemas.test.mjs
```

Expected result: FAIL because `schemaVersion`, `evidenceQuality`, and `failure` are not in `EXPLORE_REPO_OUTPUT_SCHEMA`.

- [ ] **Step 3: Implement the output schema**

In `src/explorer/schemas.mjs`, add the public schemas near `NEXT_ACTION_SCHEMA` and `EVIDENCE_ITEM_SCHEMA`:

```js
const RETRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tool: {
      type: 'string',
      enum: [
        'explore_repo',
        'find_relevant_code',
        'collect_evidence',
        'trace_symbol',
        'map_change_impact',
        'review_change_context',
        'explore',
      ],
    },
    hints: { type: 'array', items: { type: 'string' } },
  },
  required: ['tool', 'hints'],
};

const FAILURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: ['execution', 'input', 'provider', 'internal'] },
    reason: {
      type: 'string',
      enum: [
        'budget_exhausted',
        'tool_errors',
        'aborted',
        'invalid_session',
        'repo_mismatch',
        'invalid_arguments',
        'provider_error',
        'access_denied',
        'invalid_final_response',
      ],
    },
    message: { type: 'string' },
    retry: { anyOf: [{ type: 'null' }, RETRY_SCHEMA] },
  },
  required: ['category', 'reason', 'message', 'retry'],
};

const EVIDENCE_QUALITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    level: { type: 'string', enum: ['low', 'medium', 'high'] },
    exactCount: { type: 'integer' },
    partialCount: { type: 'integer' },
    droppedCount: { type: 'integer' },
    fileCount: { type: 'integer' },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['level', 'exactCount', 'partialCount', 'droppedCount', 'fileCount', 'warnings', 'summary'],
};
```

Update `EXPLORE_REPO_OUTPUT_SCHEMA.required` and `properties`:

```js
  required: [
    'schemaVersion',
    'directAnswer',
    'status',
    'targets',
    'evidence',
    'uncertainties',
    'nextAction',
    'evidenceQuality',
    'failure',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    directAnswer: { type: 'string' },
    status: STATUS_SCHEMA,
    targets: { type: 'array', items: TARGET_ITEM_SCHEMA },
    evidence: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
    uncertainties: { type: 'array', items: { type: 'string' } },
    nextAction: NEXT_ACTION_SCHEMA,
    evidenceQuality: EVIDENCE_QUALITY_SCHEMA,
    failure: { anyOf: [{ type: 'null' }, FAILURE_SCHEMA] },
    sessionId: { type: 'string' },
    _debug: { type: 'object', additionalProperties: true },
  },
```

Do not add these fields to `EXPLORE_RESULT_JSON_SCHEMA`.

- [ ] **Step 4: Run the schema test and verify green**

Run:

```powershell
node --test tests/schemas.test.mjs
```

Expected result: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/explorer/schemas.mjs tests/schemas.test.mjs
git commit -m "feat: define failure evidence quality output schema"
```

## Task 2: Runtime-Derived Quality And Failure

**Files:**
- Modify: `tests/runtime.mock.test.mjs`
- Modify: `src/explorer/runtime.mjs`

- [ ] **Step 1: Write failing runtime assertions for a normal result**

In `tests/runtime.mock.test.mjs`, inside `ExplorerRuntime performs an autonomous tool loop and returns structured findings`, add:

```js
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.failure, null);
  assert.equal(result.evidenceQuality.level, result.status.confidence);
  assert.equal(result.evidenceQuality.exactCount, 2);
  assert.equal(result.evidenceQuality.partialCount, 0);
  assert.equal(result.evidenceQuality.droppedCount, 0);
  assert.equal(result.evidenceQuality.fileCount, 2);
  assert.ok(Array.isArray(result.evidenceQuality.warnings));
  assert.match(result.evidenceQuality.summary, /evidence items grounded|Verified:/);
```

- [ ] **Step 2: Write failing runtime assertions for execution failures**

In `Phase 1 — explore circuit breaker trips after three all-error turns`, add:

```js
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.failure.category, 'execution');
  assert.equal(result.failure.reason, 'tool_errors');
  assert.equal(result.failure.retry.tool, 'explore_repo');
  assert.ok(result.failure.retry.hints.some(hint => /narrower scope|specific/i.test(hint)));
  assert.equal(result.evidenceQuality.level, result.status.confidence);
```

In `Phase 1 — malformed freeform content still produces strict-schema result`, add:

```js
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.failure.category, 'internal');
  assert.equal(result.failure.reason, 'invalid_final_response');
  assert.equal(result.failure.retry.tool, 'explore_repo');
  assert.ok(result.failure.retry.hints.some(hint => /specific/i.test(hint)));
  assert.equal(result.evidenceQuality.level, 'low');
```

- [ ] **Step 3: Run runtime tests and verify red**

Run:

```powershell
node --test tests/runtime.mock.test.mjs
```

Expected result: FAIL because runtime results do not yet contain `schemaVersion`, `evidenceQuality`, or `failure`.

- [ ] **Step 4: Add derived helper functions**

In `src/explorer/runtime.mjs`, add helpers near `buildTrustSummary()`:

```js
const AGENT_FACING_SCHEMA_VERSION = 1;

function makeFailure(category, reason, message, retry = null) {
  return {
    category,
    reason,
    message,
    retry: retry && retry.tool && Array.isArray(retry.hints)
      ? { tool: retry.tool, hints: retry.hints.filter(item => typeof item === 'string') }
      : null,
  };
}

function normalizeFailure(failure) {
  if (!failure || typeof failure !== 'object') return null;
  const categories = ['execution', 'input', 'provider', 'internal'];
  const reasons = [
    'budget_exhausted',
    'tool_errors',
    'aborted',
    'invalid_session',
    'repo_mismatch',
    'invalid_arguments',
    'provider_error',
    'access_denied',
    'invalid_final_response',
  ];
  const category = categories.includes(failure.category) ? failure.category : 'internal';
  const reason = reasons.includes(failure.reason) ? failure.reason : 'provider_error';
  const message = typeof failure.message === 'string' && failure.message.trim()
    ? failure.message.trim()
    : 'Explorer could not complete normally.';
  const retry = failure.retry && typeof failure.retry === 'object'
    ? {
        tool: typeof failure.retry.tool === 'string' ? failure.retry.tool : 'explore_repo',
        hints: Array.isArray(failure.retry.hints)
          ? failure.retry.hints.filter(item => typeof item === 'string')
          : [],
      }
    : null;
  return makeFailure(category, reason, message, retry);
}

function buildEvidenceQuality(result, stats, grounding = {}) {
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const exactCount = evidence.filter(item => item.groundingStatus === 'exact').length;
  const partialCount = evidence.filter(item => item.groundingStatus === 'partial').length;
  const droppedCount = (grounding.droppedUngrounded ?? 0) + (grounding.droppedMalformed ?? 0);
  const fileCount = new Set(evidence.map(item => item.path).filter(Boolean)).size;
  const warnings = Array.isArray(result.status?.warnings) ? result.status.warnings.slice(0, 5) : [];
  const summary = result.trustSummary || buildTrustSummary(result, stats);
  return {
    level: result.status?.confidence ?? 'low',
    exactCount,
    partialCount,
    droppedCount,
    fileCount,
    warnings,
    summary,
  };
}

function buildFailure(result, stats) {
  const existing = normalizeFailure(result.failure);
  if (existing) return existing;
  if (stats.stoppedByAbort) {
    return makeFailure('execution', 'aborted', 'Exploration was cancelled before completion.', null);
  }
  if (stats.stoppedByErrors) {
    return makeFailure('execution', 'tool_errors', 'Exploration stopped after repeated tool errors.', {
      tool: 'explore_repo',
      hints: ['Retry with a narrower scope or a more specific symbol/file anchor.'],
    });
  }
  if (stats.stoppedByBudget) {
    return makeFailure('execution', 'budget_exhausted', 'Exploration stopped at the turn budget before all follow-up checks were exhausted.', {
      tool: 'explore_repo',
      hints: ['Retry with a narrower scope or a more specific task.', 'Use deep budget only when repo-wide context is required.'],
    });
  }
  return null;
}

function attachAgentFacingContract(result, stats, grounding = {}) {
  result.schemaVersion = AGENT_FACING_SCHEMA_VERSION;
  result.failure = buildFailure(result, stats);
  result.evidenceQuality = buildEvidenceQuality(result, stats, grounding);
  return result;
}
```

- [ ] **Step 5: Attach the contract in runtime finalization**

In the `explore()` finalization path, after:

```js
    normalized.trustSummary = buildTrustSummary(normalized, stats);
```

add:

```js
    attachAgentFacingContract(normalized, stats, criticPass.grounding);
```

In the final JSON repair fallback object inside `finalizeAfterToolLoop()`, add the failure field:

```js
        failure: {
          category: 'internal',
          reason: 'invalid_final_response',
          message: 'The explorer could not synthesize a valid compact JSON answer.',
          retry: {
            tool: 'explore_repo',
            hints: ['Retry with a more specific task, symbol, file, or scope.'],
          },
        },
```

If `freeExplore()` or `freeExploreV2()` returns compact runtime results through the same normalization path, call `attachAgentFacingContract()` in those finalization paths as well.

- [ ] **Step 6: Run runtime tests and verify green**

Run:

```powershell
node --test tests/runtime.mock.test.mjs
```

Expected result: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add src/explorer/runtime.mjs tests/runtime.mock.test.mjs
git commit -m "feat: derive evidence quality and failure signals"
```

## Task 3: MCP Structured Content And Handled Errors

**Files:**
- Modify: `tests/mcp-server.test.mjs`
- Modify: `src/mcp/server.mjs`

- [ ] **Step 1: Write failing MCP assertions for normal output**

In `MCP request handler exposes explore_repo and returns structuredContent`, add:

```js
  assert.equal(called.structuredContent.schemaVersion, 1);
  assert.equal(called.structuredContent.failure, null);
  assert.equal(called.structuredContent.evidenceQuality.level, called.structuredContent.status.confidence);
  assert.equal(called.structuredContent.evidenceQuality.exactCount, 2);
  assert.equal(called.structuredContent.evidenceQuality.fileCount, 2);
  assert.match(called.content[0].text, /Evidence Quality/);
```

- [ ] **Step 2: Write failing MCP assertions for handled errors**

In `MCP request handler returns execution failures for explore_repo without mislabeling them as argument errors`, add:

```js
  assert.equal(called.structuredContent.schemaVersion, 1);
  assert.equal(called.structuredContent.status.verification, 'broad_search_needed');
  assert.equal(called.structuredContent.failure.category, 'provider');
  assert.equal(called.structuredContent.failure.reason, 'provider_error');
  assert.equal(called.structuredContent.failure.retry.tool, 'explore_repo');
  assert.equal(called.structuredContent.evidenceQuality.level, 'low');
```

In the repo root resolution error test, add:

```js
  assert.equal(called.structuredContent.failure.category, 'input');
  assert.equal(called.structuredContent.failure.reason, 'repo_mismatch');
```

If the current test uses an unresolvable path rather than a true session mismatch, use `invalid_session` only for session errors and `invalid_arguments` for generic invalid params. The test name and expected reason must match the actual catch path.

- [ ] **Step 3: Run MCP tests and verify red**

Run:

```powershell
node --test tests/mcp-server.test.mjs
```

Expected result: FAIL because MCP `structuredContent` does not yet include the new fields on normal or handled error responses.

- [ ] **Step 4: Implement agent-facing defaults and error envelope**

In `src/mcp/server.mjs`, add helper functions near `toAgentFacingResult()`:

```js
function defaultEvidenceQuality(summary = 'No grounded evidence was retained.') {
  return {
    level: 'low',
    exactCount: 0,
    partialCount: 0,
    droppedCount: 0,
    fileCount: 0,
    warnings: [],
    summary,
  };
}

function buildHandledFailure({ category, reason, message, retryTool = 'explore_repo', hints = [] }) {
  return {
    schemaVersion: 1,
    directAnswer: '',
    status: {
      confidence: 'low',
      verification: 'broad_search_needed',
      complete: false,
      warnings: [message],
    },
    targets: [],
    evidence: [],
    uncertainties: [message],
    nextAction: { type: 'ask_user', reason: message },
      evidenceQuality: defaultEvidenceQuality(message, [message]),
    failure: {
      category,
      reason,
      message,
      retry: retryTool ? { tool: retryTool, hints } : null,
    },
    _debug: {},
  };
}
```

Update `toAgentFacingResult(result)` to return defaults:

```js
      schemaVersion: result.schemaVersion ?? 1,
      directAnswer: result.directAnswer || '',
      status: result.status ?? {
        confidence: 'low',
        verification: 'broad_search_needed',
        complete: false,
        warnings: [],
      },
      targets: Array.isArray(result.targets) ? result.targets : [],
      evidence: Array.isArray(result.evidence) ? result.evidence : [],
      uncertainties: Array.isArray(result.uncertainties) ? result.uncertainties : [],
      nextAction: result.nextAction ?? { type: 'stop', reason: '' },
      evidenceQuality: result.evidenceQuality ?? defaultEvidenceQuality(result.trustSummary),
      failure: result.failure ?? null,
      ...(sessionId ? { sessionId } : {}),
      _debug: debug,
```

Update the handled catch paths:

```js
          if (error.repoRootError) {
            const message = `Unable to resolve repo_root for ${name}: ${error.message}`;
            return {
              isError: true,
              content: [{ type: 'text', text: message }],
              structuredContent: buildHandledFailure({
                category: 'input',
                reason: 'repo_mismatch',
                message,
                retryTool: null,
              }),
            };
          }
          if (error.code === -32602) {
            const message = `Invalid arguments for ${name}: ${error.message}`;
            const reason = error.sessionError === 'repo_mismatch'
              ? 'repo_mismatch'
              : error.sessionError === 'invalid_session'
                ? 'invalid_session'
                : 'invalid_arguments';
            return {
              isError: true,
              content: [{ type: 'text', text: message }],
              structuredContent: buildHandledFailure({
                category: 'input',
                reason,
                message,
                retryTool: reason === 'invalid_session' ? 'explore_repo' : null,
                hints: reason === 'invalid_session' ? ['Drop the stale session id and retry with the current repo root.'] : [],
              }),
            };
          }
          if (exposedToolNames.has(name)) {
            const message = `${name} execution failed: ${error.message}`;
            return {
              isError: true,
              content: [{ type: 'text', text: message }],
              structuredContent: buildHandledFailure({
                category: 'provider',
                reason: 'provider_error',
                message,
                retryTool: name === 'explore' ? 'explore' : 'explore_repo',
                hints: ['Retry after the provider recovers, or narrow the task and scope.'],
              }),
            };
          }
```

Adjust repo-root expected reason if the implementation chooses `provider_error` for filesystem resolution errors. Keep input-session errors as `invalid_session` or `repo_mismatch`; generic invalid params should use `invalid_arguments`.

- [ ] **Step 5: Add text summary section**

In `formatExploreResult(result)`, after the verification line, add:

```js
    if (result.evidenceQuality) {
      lines.push(`Evidence Quality: ${result.evidenceQuality.level} (${result.evidenceQuality.exactCount} exact, ${result.evidenceQuality.partialCount} partial, ${result.evidenceQuality.droppedCount} dropped)`);
    }
```

- [ ] **Step 6: Run MCP tests and verify green**

Run:

```powershell
node --test tests/mcp-server.test.mjs
```

Expected result: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add src/mcp/server.mjs tests/mcp-server.test.mjs
git commit -m "feat: expose failure and evidence quality in mcp output"
```

## Task 4: Docs And Examples

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Update README example**

In `README.md`, update the `explore_repo` return example to include:

```json
  "schemaVersion": 1,
  "evidenceQuality": {
    "level": "high",
    "exactCount": 2,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 2,
    "warnings": [],
    "summary": "Verified: 2 files read, 1 grep searches, 2/2 evidence items grounded, cross-verified across 2 files. All evidence grounded in inspected code."
  },
  "failure": null
```

Add prose after the example:

```markdown
`failure` is reserved for execution/input/provider/internal failure events. Low confidence remains a quality signal in `evidenceQuality` and `status`, not a failure. If `failure` is present, inspect `failure.retry` before following `nextAction`; otherwise follow `nextAction`.
```

- [ ] **Step 2: Update DESIGN contract section**

In `DESIGN.md`, update the return schema section to include:

```json
{
  "schemaVersion": 1,
  "directAnswer": "string",
  "status": { "confidence": "low|medium|high" },
  "targets": [],
  "evidence": [],
  "uncertainties": [],
  "nextAction": { "type": "stop|read_target|explore_followup|ask_user" },
  "evidenceQuality": {
    "level": "low|medium|high",
    "exactCount": 0,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 0,
    "warnings": [],
    "summary": "string"
  },
  "failure": null,
  "sessionId": "sess_..."
}
```

Add the precedence rule:

```markdown
Agent control precedence:

1. `failure.retry` wins when `failure` is present.
2. `nextAction` wins when `failure` is null.
3. `evidenceQuality.level` gates whether the agent should re-open cited targets or trust the answer.
4. `_debug` remains diagnostic and should not drive ordinary agent behavior.
```

- [ ] **Step 3: Run text checks**

Run:

```powershell
rg -n "schemaVersion|evidenceQuality|failure.retry|Agent control precedence" README.md DESIGN.md
```

Expected result: both docs contain the new terms and precedence text.

- [ ] **Step 4: Commit Task 4**

Run:

```powershell
git add README.md DESIGN.md
git commit -m "docs: document failure and evidence quality contract"
```

## Task 5: Full Verification

**Files:**
- Verify all changed files from Tasks 1 through 4.

- [ ] **Step 1: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected result: exit code 0.

- [ ] **Step 2: Run targeted tests**

Run:

```powershell
node --test tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

Expected result: exit code 0.

- [ ] **Step 3: Run full tests**

Run:

```powershell
npm test
```

Expected result: exit code 0 with no failed tests. The skip count may remain the repo's current expected skip count.

- [ ] **Step 4: Inspect final diff**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected result: only intentional tracked changes are present. Existing untracked `.codex/` remains excluded.

## Self-Review

Spec coverage:

- `schemaVersion` is covered by Task 1, Task 2, Task 3, and Task 4.
- Always-present `evidenceQuality` is covered by Task 1, Task 2, Task 3, and Task 4.
- Nullable `failure` and its precedence over `nextAction` are covered by Task 1, Task 2, Task 3, and Task 4.
- The MCP handled-error boundary is covered by Task 3.
- Documentation updates are covered by Task 4.

Type consistency:

- The plan uses `evidenceQuality`, `failure`, `retry`, and `schemaVersion` consistently across schema, runtime, MCP, and docs.
- The plan keeps model-generated `EXPLORE_RESULT_JSON_SCHEMA` separate from runtime-owned agent-facing fields.

Scope:

- The plan excludes a full session object, ready-to-submit retry input, wrapper/router redesign, latency telemetry, and symbol precision work.
