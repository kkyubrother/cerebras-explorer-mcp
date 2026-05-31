# Legacy Surface Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove live legacy-shaped implementation surfaces while preserving intentional regression guards for removed public contracts.

**Architecture:** Keep the fixed 8-tool MCP surface unchanged. Remove internal `defaultBudget`, V2 naming, and budget-routing compatibility shims first, then tighten benchmark-only aliases where they do not represent the current compact contract. Public breaking changes such as removing `thoroughness` or `CEREBRAS_EXPLORER_V2_*` envvars are handled last and only with matching README/DESIGN/CHANGELOG/test updates.

**Tech Stack:** Node.js 22+ ESM, built-in `node:test`, zero runtime dependencies.

---

### Task 1: Drop Project Config `defaultBudget`

**Files:**
- Modify: `src/explorer/config.mjs`
- Modify: `tests/project-config.test.mjs`
- Modify: `tests/regression.test.mjs`

- [x] **Step 1: Write/update failing tests**

`tests/project-config.test.mjs` must assert that `normalizeProjectConfig({ defaultBudget: 'deep' })` drops the key:

```js
test('normalizeProjectConfig: legacy defaultBudget is dropped', () => {
  const config = normalizeProjectConfig({ defaultBudget: 'deep' });
  assert.equal(config.defaultBudget, undefined);
});
```

- [x] **Step 2: Run test to verify behavior**

Run: `node --test tests/project-config.test.mjs tests/regression.test.mjs`

Expected after implementation: PASS with 23 tests, 0 failures.

- [x] **Step 3: Remove implementation support**

`src/explorer/config.mjs` must not document or copy `raw.defaultBudget` in `normalizeProjectConfig()`.

- [x] **Step 4: Search for remaining references**

Run: `rg -n "defaultBudget" src tests README.md DESIGN.md CHANGELOG.md examples integrations specs docs plan AGENTS.md`

Expected: only tests that prove the legacy key is ignored.

### Task 2: Rename Live V2 Internals To Single Explore Backend

**Files:**
- Modify: `src/explorer/config.mjs`
- Modify: `src/explorer/runtime.mjs`
- Modify: `src/explorer/prompt.mjs`
- Modify: `tests/project-config.test.mjs`
- Modify: `tests/runtime.mock.test.mjs`
- Modify: `tests/free-explore.test.mjs`
- Modify if needed: `README.md`, `DESIGN.md`, `CHANGELOG.md`

- [x] **Step 1: Add failing tests for transcript/tool prompt naming**

Add or update tests so `ExplorerRuntime.freeExplore(...)` transcript metadata uses `tool: 'explore'`, and live report prompts no longer identify as `Cerebras Explorer V2`.

Run targeted command:

```bash
node --test tests/runtime.mock.test.mjs tests/free-explore.test.mjs
```

Expected before implementation: at least one assertion fails on the old `explore_v2` / `V2` naming.

- [x] **Step 2: Rename config helpers without changing envvar behavior**

Replace exported helper names:

```js
getExploreTurnMultiplier()
getExploreMaxExtraTurns()
getExploreMaxCompactions()
```

Keep `CEREBRAS_EXPLORER_V2_TURN_MULTIPLIER`, `CEREBRAS_EXPLORER_V2_MAX_EXTRA_TURNS`, and `CEREBRAS_EXPLORER_V2_MAX_COMPACTIONS` for this task unless Task 5 removes them.

- [x] **Step 3: Rename runtime/prompt internals**

Rename the live backend methods and prompt builders from `freeExploreV2` / `buildFreeExploreV2SystemPrompt` / `buildFreeExploreV2FinalizePrompt` to single-backend names. Preserve exported wrappers if needed for tests during the transition, but ensure new code paths use the non-V2 names.

- [x] **Step 4: Run targeted tests**

Run:

```bash
node --test tests/project-config.test.mjs tests/runtime.mock.test.mjs tests/free-explore.test.mjs
```

Expected: PASS.

### Task 3: Remove Budget Routing Compatibility Stubs

**Files:**
- Modify: `src/explorer/config.mjs`
- Modify: `src/explorer/runtime.mjs`
- Modify: `src/explorer/providers/index.mjs`
- Modify: `tests/cerebras-client.test.mjs`
- Modify: `tests/providers.test.mjs`
- Modify: `tests/repo-tools.test.mjs`
- Modify: `tests/security/redact.test.mjs`
- Modify: `tests/security/secret-deny-list.test.mjs`
- Modify: `tests/runtime.mock.test.mjs`
- Modify if needed: `DESIGN.md`

- [x] **Step 1: Add failing tests for no public budget aliases**

Tests must no longer import or assert `BUDGETS.quick`, `BUDGETS.normal`, `chooseAutoBudget`, or budget-argument behavior in `createChatClient`.

Run:

```bash
node --test tests/cerebras-client.test.mjs tests/providers.test.mjs
```

Expected before implementation: tests fail if production exports still advertise ignored budget-routing helpers.

- [x] **Step 2: Simplify config exports**

Keep only a single deep runtime config. `getBudgetConfig()` takes no argument and returns the deep config. Remove `chooseAutoBudget()`, `getModelForBudget()`, and `classifyTaskComplexity()` if no live runtime code consumes them.

- [x] **Step 3: Simplify provider factory**

`createChatClient()` should accept only `{ fetchImpl, logger }`. Cerebras provider construction should call `getExplorerModel()` directly.

- [x] **Step 4: Replace test fixture usage**

Replace `BUDGETS.quick` and `BUDGETS.normal` in tests with `getBudgetConfig()` or a local copy of the specific field being asserted.

- [x] **Step 5: Run targeted tests**

Run:

```bash
node --test tests/cerebras-client.test.mjs tests/providers.test.mjs tests/repo-tools.test.mjs tests/security/redact.test.mjs tests/security/secret-deny-list.test.mjs tests/runtime.mock.test.mjs
```

Expected: PASS.

### Task 4: Tighten Benchmark Legacy Aliases

**Files:**
- Modify: `src/benchmark/evaluator.mjs`
- Modify: `tests/benchmark-evaluator.test.mjs`
- Modify if schema changes: `benchmarks/adoption.json`

- [x] **Step 1: Add failing tests for current contract-only benchmark sources**

`candidate_paths`, `min_candidate_path_count`, `answer`, `summary`, and `confidence_level` should either be removed with explicit unknown-source errors or renamed to current contract names.

Run:

```bash
node --test tests/benchmark-evaluator.test.mjs
```

Expected before implementation: assertions fail while old aliases are still accepted.

- [x] **Step 2: Remove `candidatePaths` shim**

Delete `getCandidatePaths()` and use `targets[].path` only for benchmark target-path checks.

- [x] **Step 3: Run benchmark tests**

Run:

```bash
node --test tests/benchmark-evaluator.test.mjs
```

Expected: PASS.

### Task 5: Public Compatibility Boundary Audit

**Files:**
- Read/update: `README.md`
- Read/update: `DESIGN.md`
- Read/update: `CHANGELOG.md`
- Read/update: `tests/integrations.test.mjs`
- Read/update: `integrations/**`

- [x] **Step 1: Decide public breaking removals**

Audit `thoroughness` and `CEREBRAS_EXPLORER_V2_*` envvars. If removed, update public docs and integration snapshots in the same change. If retained, explicitly document them as the remaining compatibility boundary, not as stale implementation.

- [x] **Step 2: Run sync tests**

Run:

```bash
node --test tests/integrations.test.mjs
```

Expected: PASS.

### Task 6: Final Verification And Plan Closure

**Files:**
- Modify: `docs/superpowers/plans/2026-06-01-legacy-surface-cleanup.md`
- Move or delete according to `AGENTS.md` plan closure rule after all tasks are complete and landed.

- [x] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [x] **Step 2: Confirm zero-dependency invariant**

Run:

```bash
node -e "const p=require('./package.json'); if ((p.dependencies&&Object.keys(p.dependencies).length)||(p.devDependencies&&Object.keys(p.devDependencies).length)) process.exit(1)"
```

Expected: exit 0.

- [x] **Step 3: Close plan**

When all tasks are implemented and committed/landed, either check every box and move the plan to `docs/superpowers/plans/completed/`, or delete it according to `plan/README.md`.
