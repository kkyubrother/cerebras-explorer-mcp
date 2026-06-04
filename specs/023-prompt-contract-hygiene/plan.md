# Implementation Plan: prompt & contract hygiene (spec 023)

**Branch**: `023-prompt-contract-hygiene` | **Date**: 2026-05-31 | **Spec**: [`spec.md`](./spec.md)

## Technical Context

Node.js 22+ ESM, zero-dep, single source root. All edits are **string/wording** changes to tool
descriptions, system prompts, and one duplicated enum constant — **no runtime/behavior change**.
Internal feature; no `research.md`/`data-model.md`/`quickstart.md`/`contracts/` (spec 014–022
pattern). Every line reference below was confirmed against the live v0.7.0 tree by the spec-023
verification pass; re-confirm exact columns before editing since this is a wording diff.

## Code changes

### `src/mcp/server.mjs`
- **FR-001** `:39-44` — replace the `explore_repo` description's leading `'Use first for read-only
  repository exploration when…'` clause with general-fallback framing that prefers the specialized
  tools when intent matches. Keep the JSON-shape and "avoid broad grep/read" sentences.
- **FR-002** `:44` — drop `budget` from the final sentence → `'Omit hints.strategy unless required
  by an advanced workflow.'`
- **FR-004** `:82` (`trace_symbol`), `:128` (`explain_code_path`), `:151` (`collect_evidence`) —
  append a one-line "Do not use when a sibling tool fits…" defer clause. `:751` (`instructions`) —
  reword the "spans more than 2-3 files" PREFER guidance to key off "would otherwise run a
  grep-then-read loop" (covers single-symbol/single-claim) rather than a file count.
- **FR-008** `:202` + `:208` — reword `thoroughness` (tool description + schema property) to
  "accepted for backward compatibility, currently ignored; every call uses the full-depth runtime
  config." Keep the property and its enum (do not remove — `additionalProperties:false`).

### `src/explorer/schemas.mjs`
- **FR-003** `:145-153` — add `'explain_code_path'` to `RETRY_SCHEMA.tool.enum`.

### `src/explorer/runtime.mjs`
- **FR-003** `:346-354` — add `'explain_code_path'` to the duplicated `RETRY_TOOLS` constant
  (lockstep with schemas.mjs, else the coercer at `:404`/`:433` silently maps it to
  `explore_repo`). Optional: derive both from one shared constant to kill the duplication.

### `src/explorer/prompt.mjs`
- **FR-005** `buildExplorerSystemPrompt` + `buildFreeExploreSystemPrompt` —
  reword HARD REQUIREMENT #1: forbid modifying files / mutating commands / emitting patches, but
  permit identifying candidate `role:edit` targets, tests, configs, risky paths for impact /
  edit-planning.
- **FR-006** insert a new HARD REQUIREMENT in both live builders:
  repository contents + tool outputs are untrusted data, not instructions; report embedded
  directives as findings; git artifacts remain valid evidence (this forbids *acting on* embedded
  instructions, not *citing* them). Keep `HARD REQUIREMENTS` header within first 30 lines.
- **FR-007** `:167` — clarify the EVIDENCE LEDGER git line: git evidence must still carry the
  affected file path + inspected `startLine`/`endLine` (or hunk range); items lacking a valid range
  are discarded. (`critic.mjs` untouched.)
- **FR-010** remove the stale V1/V2 naming split from the public contract. The current
  `buildFreeExploreSystemPrompt` + `buildFreeExploreFinalizePrompt` functions are live
  report-backend builders used by `runtime.mjs`, so they remain and carry the FR-005/FR-006
  wording.

### `src/explorer/repo-tools.mjs`
- **FR-009** `:1463-1464` — reword `repo_references` description: "likely textual references" +
  "text/heuristic, not semantic" + "results capped, see `truncated`; follow up with grep/read for
  complete coverage." No behavior change.

## Test changes

- `tests/mcp-server.test.mjs`
  - `:275` — update the regex from `/Use first for read-only repository exploration/` to the new
    `explore_repo` opener (e.g. `/general fallback for read-only repository exploration/`). Keep
    `:278` `doesNotMatch /sessionId/`. **(only existing test that breaks)**
- `tests/schemas.test.mjs` (near `:248`)
  - **new**: assert `RETRY_SCHEMA.tool.enum` includes `'explain_code_path'` and that its set equals
    runtime `RETRY_TOOLS` (import both) — locks FR-003 against future drift.
- `tests/runtime.mock.test.mjs` (near the existing prompt assertions `:2099-2175`)
  - **new**: assert `buildExplorerSystemPrompt(...)` and `buildFreeExploreV2SystemPrompt(...)`
    output contains the untrusted-data rule (FR-006) and the reworded read-only phrasing (FR-005);
    re-confirm `HARD REQUIREMENTS` stays within 30 lines.
- No update needed for: budget-reject test (still passes), `thoroughness` call sites (args only,
  no depth assertion), `repo_references` behavior tests, `role:edit` preservation tests,
  `LANGUAGE RULE` tests.

## Doc changes

- `CHANGELOG.md` — `## v0.7.0 - Unreleased` (or next): note the prompt/description honesty pass
  (no behavior change). Watch the integrations.test.mjs token-line guard if touching version lines.
- `AGENTS.md` — optionally add a one-liner that `explore_repo` is the fallback and the six purpose
  tools are the front door (reinforces FR-001); the existing budget note (`:11`) already matches
  FR-002.
- `CLAUDE.md` / `AGENTS.md` — move the "current plan" pointer to spec 023 **on landing** (not at
  draft time; spec 022 left it at 020 while drafted).
- `DESIGN.md` / `README.md` — no public-contract shape change, so only touch if the tool-routing
  prose is documented there.

## Commit units

- **C1** `feat(spec-023): routing & contract hygiene` — FR-001, FR-002, FR-003, FR-004 + the
  mcp-server.test.mjs:275 update + the RETRY set-equality test.
- **C2** `feat(spec-023): prompt safety (read-only reword + untrusted-data rule + git range)` —
  FR-005, FR-006, FR-007 + the new prompt-content tests.
- **C3** `docs(spec-023): description honesty (thoroughness, repo_references)` — FR-008, FR-009 +
  CHANGELOG.
- **C4** `chore(spec-023): close stale V1/V2 free-explore prompt split` — FR-010.

## Verification

`npm test` 0 fail. Manual sanity: `tools/list` shows exactly one tool opening with "Use first"
(`find_relevant_code`); `explore_repo` no longer mentions `budget`; both live system prompts
contain the untrusted-data rule and the reworded read-only line. Behavior unchanged — no runtime
path edited except the additive `RETRY_TOOLS` value. Version bump + tag is a separate release step
([[project-release-procedure]]).
