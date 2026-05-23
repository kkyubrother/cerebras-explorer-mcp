# First Pass Feedback Fixes Implementation Plan

> Status note: completed historical implementation plan. Embedded expected test totals were observed during this plan and are not current verification evidence. Use `TESTING.md` for the latest test status.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the first three validated feedback fixes: strict public tool arguments, simpler failure retry handoff, and current test/benchmark metadata.

**Architecture:** Keep the public compact contract intact. Add deterministic validation before runtime dispatch, keep retry recipes free of advanced strategy/budget steering, and repair benchmark/test documentation without reintroducing legacy top-level fields.

**Tech Stack:** Node.js ESM, `node:test`, MCP stdio handler, repository-local markdown docs.

---

### Task 1: Strict Public Tool Argument Validation

**Files:**
- Modify: `src/explorer/schemas.mjs`
- Modify: `src/mcp/server.mjs`
- Test: `tests/schemas.test.mjs`
- Test: `tests/mcp-server.test.mjs`

- [x] **Step 1: Write failing schema tests**

Add tests proving `validateExploreRepoArgs()` rejects unknown top-level keys and unknown `hints` keys.

- [x] **Step 2: Write failing MCP wrapper tests**

Add tests proving a wrapper call with an unknown argument fails before runtime invocation.

- [x] **Step 3: Run targeted tests and verify RED**

Run: `node --test tests/schemas.test.mjs tests/mcp-server.test.mjs`

Expected: failures showing unknown keys are currently accepted.

- [x] **Step 4: Implement shared object-key validation**

Add a small helper that compares provided object keys against each public schema's allowed set. Use it in `validateExploreRepoArgs()` and the wrapper builders before they construct internal runtime args.

- [x] **Step 5: Run targeted tests and verify GREEN**

Run: `node --test tests/schemas.test.mjs tests/mcp-server.test.mjs`

Expected: all targeted tests pass.

### Task 2: Simplify Failure Retry Handoff

**Files:**
- Modify: `src/explorer/schemas.mjs`
- Modify: `src/explorer/runtime.mjs`
- Test: `tests/schemas.test.mjs`
- Test: `tests/runtime.mock.test.mjs`

- [x] **Step 1: Write failing retry tests**

Add tests proving `failure.retry.args.hints.strategy` is not emitted and budget-exhausted retry hints do not instruct the parent agent to choose deep budget.

- [x] **Step 2: Run targeted tests and verify RED**

Run: `node --test tests/schemas.test.mjs tests/runtime.mock.test.mjs`

Expected: failures showing strategy or deep-budget wording still leaks through.

- [x] **Step 3: Implement minimal retry cleanup**

Remove `strategy` from retry args schema/sanitization and replace the deep-budget hint with a scope/task narrowing hint.

- [x] **Step 4: Run targeted tests and verify GREEN**

Run: `node --test tests/schemas.test.mjs tests/runtime.mock.test.mjs`

Expected: all targeted tests pass.

### Task 3: Benchmark Evaluator And TESTING.md Drift

**Files:**
- Modify: `src/benchmark/evaluator.mjs`
- Modify: `tests/benchmark-evaluator.test.mjs`
- Modify: `TESTING.md`

- [x] **Step 1: Write failing benchmark evaluator test**

Add a test proving legacy `min_candidate_path_count` reads compact `targets` instead of throwing.

- [x] **Step 2: Run targeted test and verify RED**

Run: `node --test tests/benchmark-evaluator.test.mjs`

Expected: `ReferenceError: getCandidatePaths is not defined`.

- [x] **Step 3: Implement candidate-path compatibility helper**

Add `getCandidatePaths(result)` that returns `result.candidatePaths` when present, otherwise compact `result.targets[].path`.

- [x] **Step 4: Update TESTING.md**

Replace stale fixed test counts with the current command and latest observed `307 tests`, `304 pass`, `3 skipped`, `0 fail` summary, while saying the command is authoritative.

- [x] **Step 5: Run full verification**

Run: `npm test`

Expected: `307 tests`, `304 pass`, `3 skipped`, `0 fail`.
