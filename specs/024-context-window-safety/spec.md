# Feature Spec: context-window safety for the explorer runtime

**Spec**: 024-context-window-safety | **Date**: 2026-06-01 | **Status**: draft (baseline `npm test` 385/0, 2 skipped)

## Summary

Close four context-window / evidence-grounding gaps in `ExplorerRuntime` that an external
prompt-system review surfaced and that were re-verified against `master` HEAD (post-`v0.7.1`).
Unlike spec 023 (a wording-only honesty pass), these are **behavior changes** — spec 023 explicitly
excluded runtime/behavior edits, so they are split here.

1. **FR-001 (AP-1)** — the report compaction *fallback* is a no-op between 70 % and 100 % of the
   context budget. When LLM-summary compaction is unavailable, the fallback truncation never fires
   until the hard 100 % threshold.
2. **FR-002 (AP-3)** — the compact (`explore`) loop has no proactive compaction at all; it only
   truncates at 100 %, while the report loop already compacts at 70 %.
3. **FR-003 (AP-4)** — `estimateTokens` uses a flat `chars/4` heuristic that under-counts CJK /
   non-ASCII text, so threshold checks can fire too late.
4. **FR-004 (AP-2)** — report-path citations are grounded only at **path** level
   (`buildReportCritic` checks "was this file read"), whereas the compact path grounds at
   **line-range** level via `observedRanges`.

A fifth, wording-only item rides along:

5. **FR-005 (AP-5)** — the report system prompt overstates that `[truncated]` markers preserve
   "key information", contradicting the actual truncation behavior.

The work plan and the line-level verification behind these items live in
[`reports/cerebras-explorer-mcp-2026-06-01-review-action-plan.md`](../../reports/cerebras-explorer-mcp-2026-06-01-review-action-plan.md).

## Motivation

- The project thesis is **trust = context saving** ([[project-trust-as-context-saving]]). The two
  exploration loops promise a "grounded, context-safe" result to the parent model. Where context
  management silently no-ops (FR-001) or never engages early (FR-002/FR-003), a long exploration can
  drift toward the provider hard limit before any compaction runs — turning "context saving" into a
  failed call. Where citation grounding is weaker on one path (FR-004), the parent over-trusts a
  `file:Lx-Ly` it should re-verify.
- Each item carries a confirmed HEAD `file:line` and a known test-impact (recorded in the action
  plan's appendix). The review was a ZIP snapshot; every line below was re-confirmed against the
  live tree, and three post-023 commits were checked for prior fixes: `86e365a` (bounded compact
  *blame* ranges only — report critic untouched), `a79d70b` (budget-exhaustion `searchCoverage`,
  orthogonal to compaction), `95c9c3b` (legacy-surface removal, shifted line numbers).
- Severity is **low–medium**. None of these produce a wrong answer on a small task; they degrade
  *gracefully-or-not* on large/long explorations and asymmetrically across the two output modes.

## Functional Requirements

### Context-window management

- **FR-001** (report fallback no-op): in `freeExplore`, the two fallback calls
  `compactOldToolResults(messages, budgetConfig.maxContextTokens)` (`src/explorer/runtime.mjs:1953`
  cap-exhausted branch, `:1973` summary-failure branch) must pass the **70 % `compactionThreshold`**
  (already computed at `:1932`) instead of the 100 % `maxContextTokens`. `compactOldToolResults`
  no-ops while `estimated < threshold` (`:80`), so the current fallback does nothing in the
  70–100 % band. Passing `compactionThreshold` makes the simple-truncation fallback actually fire
  when LLM-summary compaction is unavailable. No change to the LLM-summary branch.

- **FR-002** (compact-path proactive compaction): the compact `explore` loop currently calls
  `compactOldToolResults(messages, budgetConfig.maxContextTokens)` unconditionally each turn
  (`src/explorer/runtime.mjs:1430`), i.e. it only truncates at 100 %. Replace this with a proactive
  block mirroring the report loop: compute `compactionThreshold = floor(maxContextTokens * 0.70)`
  once outside the turn loop, and when `estimateTokens(messages) >= compactionThreshold &&
  messages.length > 6`, run `compactOldToolResults(messages, compactionThreshold)` **and** inject a
  **deterministic evidence ledger** built from the already-tracked `observedRanges`/`observedGit`
  (`:1407-1408`). The ledger is a `path:Lx-Ly` list of **verified inspected locations** (NOT
  snippets — `observedRanges` stores `{startLine,endLine,source}` only), so the model retains its
  grounded anchors even after old tool results are truncated. The compact path keeps its
  deterministic critic; no LLM-summary call is added here (determinism over the report path's lossy
  summary).

  - **FR-002a** (injection safety): the ledger is pushed **only at the top-of-loop slot** (same
    place the checkpoint message is pushed, `:1433`), after compaction and before the chat call —
    always a turn boundary, never between an `assistant.tool_calls` message and its matching `tool`
    messages. De-dup is a **replace**: filter out any prior `m.role === 'user' && content
    startsWith(LEDGER_MARKER)` before pushing the refreshed ledger; the filter must never match
    `tool`/`assistant` messages. (The mock at `tests/runtime.mock.test.mjs:229-240` asserts
    tool-call pairing and will catch a violation.)

- **FR-003** (CJK-aware token estimate): `estimateTokens` (`src/explorer/runtime.mjs:57-66`) weights
  every character at `1/4` token. Replace the per-string `length/4` with a helper that counts
  non-ASCII separately: `ceil(asciiChars/4 + nonAsciiChars/2)`. This roughly doubles the token
  weight of CJK/non-ASCII text (Korean is ≈1.5 chars/token in practice), reducing — **not
  eliminating** — under-counting. `/2` is a deliberate middle point: more aggressive divisors
  over-estimate and cause premature compaction (a quality trade-off). The helper applies to
  `content`, `tool_calls` JSON, and `reasoning`. `estimateTokens` is exported for a unit test
  (project precedent: internals exported for set-equality / pinning tests).

### Evidence grounding parity

- **FR-004** (report citation line-range grounding): the report loop records only file **paths**
  (`filesRead.add(safeToolResult.path)`, `src/explorer/runtime.mjs:2095`) and `buildReportCritic`
  only checks `filesReadSet.has(citation.path)` (`src/explorer/critic.mjs:563`). Add an
  `observedRanges` Map to the report loop and record ranges for the range-bearing tools it uses
  (`repo_read_file` start/end, `repo_grep` match lines, `repo_symbol_context` macro ranges) via the
  existing `recordObservedRange` (`:1210`). Pass `observedRanges` to `buildReportCritic` as an
  **optional** parameter (default empty `Map`, so the four existing `buildReportCritic` tests that
  omit it stay green). In `buildReportCritic`, for each file citation whose path **is** read **and**
  for which `observedRanges` **has** entries, run `checkEvidenceGrounding(observedRanges, citation)`
  (`critic.mjs:28`, reused) — emit a `citation_line_gap` warning (severity `medium`) when the cited
  range overlaps no inspected range. **False-positive guard**: only line-check paths that have
  observed ranges; a path read by an un-instrumented tool falls back to the existing path-level
  check, never double-warns. The existing `unknownCitations` path-level warning is unchanged.

### Prompt honesty (wording-only)

- **FR-005** (truncation-marker honesty): `buildFreeExploreSystemPrompt`'s line
  `'- If you see "[summarized]" or "[truncated]" markers, the key information is preserved — work
  with what is available.'` (`src/explorer/prompt.mjs:386`) overstates preservation.
  `compactOldToolResults` keeps only a 300-char prefix (`runtime.mjs:93`) and the char-budget marker
  itself advises re-reading if evidence is missing (`runtime.mjs:166`). Reword to: content may be
  omitted, and if expected evidence is missing the model should re-read a narrower range or re-run a
  narrower query. No behavior change.

## Out of Scope

- **Provider hard-limit calibration.** `maxContextTokens: 110_000` is a self-imposed budget, not the
  measured provider ceiling (unknown — action plan §5). FR-003 improves the estimate's *direction*,
  not a measured limit.
- **Output-continuation overlap/consistency detection.** The `finishReason === 'length'` recovery
  (`runtime.mjs:2194-2251`) stays best-effort; deterministic overlap detection and main-loop
  (non-finalize) cut-off recovery are a separate, larger effort.
- **LLM-summary quality** (`compactWithLlmSummary`, `runtime.mjs:196-237`). FR-002 adds a
  deterministic ledger to the *compact* path; it does not change the report path's summary or try to
  validate summary fidelity.
- **`detectStrategy` "switch once" routing** (action-plan T-3) — partly intended anti-thrashing;
  deferred, measure-first against spec 006.
- **A-facing routing wording** (T-1) — intended spec-023 FR-004 design; optional, not in this spec.
- **Relaxing the compact deterministic critic** — its line-range / `malformedRange` gate is an
  intended fabrication guard (spec 023 Out of Scope, preserved).

## Acceptance

- `npm test` 0 fail (baseline 385 pass / 0 fail / 2 skipped → at least 385 + new tests, 0 fail).
- **FR-001**: a report-path test where LLM-summary compaction is unavailable (cap exhausted or
  summary throws) asserts old tool results are truncated in the 70–100 % band (previously a no-op).
- **FR-002**: a compact-path (`explore`) test that crosses 70 % asserts (a) old tool results are
  truncated and (b) a single `user` ledger message starting with the ledger marker is present, with
  no orphaned `tool` messages (tool-call pairing intact).
- **FR-003**: a `estimateTokens` unit test asserts a Korean-heavy string estimates higher than the
  same `length` of ASCII and higher than the old `length/4`.
- **FR-004**: a `buildReportCritic` test passing `observedRanges` asserts a `citation_line_gap`
  warning for a cited range outside inspected ranges, and **no** warning when the cited range is
  covered; the four existing `buildReportCritic` tests (no `observedRanges`) stay green.
- **FR-005**: a prompt-content assertion confirms the reworded marker line and the absence of the
  old "key information is preserved" wording in `buildFreeExploreSystemPrompt`.
- Existing compaction test (`tests/runtime.mock.test.mjs` ~`:1289` report-path, `llmCompactions>=1`,
  usage accounting 215/80/295) stays green. Zero-dependency invariant unchanged.

## Open questions for implementation kickoff

- **FR-002 ledger refresh cadence**: replace-on-every-compaction (chosen — deterministic, always
  current) vs inject-once. Chosen keeps exactly one current ledger as `observedRanges` grows.
- **FR-003 divisor**: `/2` (chosen, middle point) vs `/1.5` (closer to measured Korean ratio, more
  aggressive). Revisit if a provider limit is ever measured.
- **CLAUDE.md / AGENTS.md "current plan" pointer**: per speckit convention, move to spec 024 **on
  landing** (a `plan.md` landing task), not at draft time.
