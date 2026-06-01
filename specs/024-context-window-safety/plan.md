# Implementation Plan: context-window safety (spec 024)

**Branch**: `024-context-window-safety` | **Date**: 2026-06-01 | **Spec**: [`spec.md`](./spec.md)

## Technical Context

Node.js 22+ ESM, zero-dep, single source root. Unlike spec 023, these are **behavior changes** to
`ExplorerRuntime` (context compaction + evidence grounding), plus one wording-only prompt edit.
Baseline before changes: `npm test` 385 pass / 0 fail / 2 skipped. Every line reference was
re-confirmed against `master` HEAD (post-`v0.7.1`); re-confirm columns before editing since line
numbers shift. The mock at `tests/runtime.mock.test.mjs:229-240` enforces `tool_call`→`tool`
pairing — keep all injected messages on turn boundaries.

## Code changes

### `src/explorer/runtime.mjs`

- **FR-003** `:57-66` — replace `estimateTokens`' per-message `Math.ceil(content.length / 4)` with a
  helper `estimateStringTokens(str)` = `ceil(asciiCount/4 + nonAsciiCount/2)`, applied to `content`,
  `JSON.stringify(tool_calls)`, and `reasoning`. **Export** `estimateTokens` (named export) for the
  unit test. No other call-site change (both loops call it).
- **FR-002** `:1414` area (before the `explore` turn loop) — add
  `const compactionThreshold = Math.floor((budgetConfig.maxContextTokens ?? 100_000) * 0.70);`.
  `:1430` — replace the unconditional `compactOldToolResults(messages, budgetConfig.maxContextTokens)`
  with: if `estimateTokens(messages) >= compactionThreshold && messages.length > 6`, then
  `messages = compactOldToolResults(messages, compactionThreshold)` and inject/refresh the evidence
  ledger (FR-002a). Keep the 100 % safety net implicitly (threshold band now starts at 70 %).
- **FR-002a** — add module-level `const LEDGER_MARKER = '[verified-evidence-ledger]';` and a helper
  `buildEvidenceLedgerMessage(observedRanges, observedGit)` returning a `path:Lx-Ly` list (+ up to
  10 commit shas), or `null` when empty. Injection: filter out any prior
  `m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(LEDGER_MARKER)`, then
  `messages.push({ role: 'user', content: ledger })`. Pushed at the top-of-loop slot only.
- **FR-004** report loop (`freeExplore`, `:1900` area) — add `const observedRanges = new Map();`
  near the `filesRead` Set (`:1918`). In the tool-result loop (`:2094` area) record ranges with the
  existing `recordObservedRange(observedRanges, …)`: `repo_read_file` → `(path, startLine, endLine,
  'read')`; `repo_grep` matches → `(path, line, line, 'grep')`; `repo_symbol_context` macro
  `observedRanges[]` → `(path, startLine, endLine, source)`. `:2266` — pass `observedRanges` to
  `buildReportCritic({ report, filesRead, observedRanges, stats })`.

### `src/explorer/critic.mjs`

- **FR-004** `buildReportCritic` (`:528`) — add `observedRanges = new Map()` to the destructured
  params. After the existing `unknownCitations` block (`:563-573`), add a `citation_line_gap` pass:
  for each `citations` item (file_range, from `extractReportCitations`) where
  `filesReadSet.has(path)` **and** `observedRanges.has(path)`, call the in-module
  `checkEvidenceGrounding(observedRanges, citation)`; collect items with `!overlaps`. If any, push
  one `{ type: 'citation_line_gap', severity: 'medium', message, target, action }` warning. No new
  import (same module). Path-level `unknownCitations` warning unchanged.

### `src/explorer/prompt.mjs`

- **FR-005** `:386` — replace `'- If you see "[summarized]" or "[truncated]" markers, the key
  information is preserved — work with what is available.'` with wording that content may be omitted
  and to re-read a narrower range / re-run a narrower query if expected evidence is missing.

## Test changes

- `tests/runtime.mock.test.mjs`
  - **new (FR-002)** compact-path `explore` test: a mock that reads large files until estimate
    crosses 70 %, asserting old `tool` results are prefix-truncated and exactly one `user` message
    starts with `[verified-evidence-ledger]`, via `assertNoOrphanedToolMessages` (reuse helper).
  - **new (FR-001)** report-path test: summary-failure (throw) or cap-exhausted mock in the 70–100 %
    band asserting old `tool` results are truncated (fallback now fires). May extend the existing
    compaction client.
- `tests/runtime.unit.test.mjs` *(or nearest unit suite; else add to runtime.mock)*
  - **new (FR-003)** `estimateTokens` unit test: Korean-heavy array estimates `> length/4` and `>`
    an equal-`length` ASCII array.
- `tests/critic.test.mjs`
  - **new (FR-004)** `buildReportCritic` with `observedRanges`: `citation_line_gap` present for an
    out-of-range citation; absent when covered. Confirm the four existing `buildReportCritic` tests
    (`:323-380`, no `observedRanges`) stay green.
- `tests/free-explore.test.mjs` *(or runtime.mock prompt-assertion block)*
  - **new (FR-005)** assert `buildFreeExploreSystemPrompt(...)` contains the reworded marker line and
    not the old "key information is preserved" string.

## Commit units

- **C1** `docs(spec-024): add context-window safety spec` — `specs/024-*` (spec.md + plan.md).
- **C2** `fix(spec-024): report compaction fallback fires at 70% (AP-1)` — FR-001 + its test.
  *(P0, isolated — revertable on its own.)*
- **C3** `feat(spec-024): CJK-aware token estimation (AP-4)` — FR-003 + unit test.
- **C4** `feat(spec-024): proactive compaction + evidence ledger on compact path (AP-3)` — FR-002 +
  FR-002a + test. *(Highest risk — isolated commit so it can be reverted alone.)*
- **C5** `feat(spec-024): report citation line-range grounding (AP-2)` — FR-004 + test.
- **C6** `docs(spec-024): truncation-marker honesty (AP-5)` — FR-005 + test.

## Verification

- `npm test` 0 fail; baseline 385/0/2-skipped preserved + new tests green.
- Manual: a >70 % compact exploration shows prefix-truncated old tool results and a single
  `[verified-evidence-ledger]` message; report fallback truncates when summary is unavailable;
  `estimateTokens` on Korean text exceeds `length/4`; a report citing an unread line range yields
  `citation_line_gap`; `buildFreeExploreSystemPrompt` no longer claims `[truncated]` preserves key
  info.
- Zero-dependency invariant unchanged. No public MCP envelope shape change (compact envelope and
  report envelope keep their fields; `citation_line_gap` is an additive critic warning type).

## Landing tasks (on merge, not at draft)

- Move the CLAUDE.md / AGENTS.md "current plan" pointer to spec 024 (speckit convention; spec 023
  moved it on landing).
- `CHANGELOG.md`: note the context-window-safety behavior fixes under the next version. Version
  bump + tag is a separate release step ([[project-release-procedure]]).
