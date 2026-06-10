# Feature Spec: benchmark effect measurement and dead-metric cleanup

**Spec**: 025-benchmark-effect-measurement | **Date**: 2026-06-10 | **Status**: draft

## Summary

Make the benchmark measure what the project actually promises. Today the suite
scores answer shape (keywords, targets, snippets) but does not measure either
core value proposition: (A) parent-agent context savings, or (B) citation
accuracy verified independently of the system's own self-report. Several
extended metrics have also been dead since spec 017 removed `stats` from the
MCP envelope — `avgToolTurns` always prints `0`, `noToolExitRate` always prints
`100%`, `deepBudgetAvgTotalTokens` filters on a budget label that spec 011
deleted, and the spec 007 transcript metrics never run because the runner
cannot see a `transcriptPath`.

This spec adds deterministic, harness-computed **effect metrics** (payload
tokens vs cited-source tokens, citation accuracy), restores the live metrics
through an **ops side-channel** (`_meta.ops`) that spec 017's changelog
promised as a follow-up, rewires what the public envelope already carries, and
deletes what is dead beyond recovery. The public parent-facing
`structuredContent` contract does not change.

## Motivation

- The 2026-06-10 project assessment scored benchmark design 4.5/10: the purpose
  declared in README ("상위 AI가 반복 탐색에 컨텍스트를 쓰지 않고 검증된 근거를
  받는다") has no corresponding measurement. Grounding checks are circular —
  `min_grounded_evidence_count` counts the system's own `groundingStatus`
  labels, so a grounding-pipeline regression would raise scores, not lower
  them.
- Live probes during the same assessment measured real compression (cited
  files of 54-95 KB delivered as 7-18 K-char responses) and verified 27/27
  citations by hand. Both observations are automatable with `node:fs` and the
  existing CJK-aware token estimator (spec 024) — no new dependencies.
- `CHANGELOG.md` (spec 017 entry) explicitly promised that stats-based
  benchmark metrics "degrade to zero/null ... until a follow-up spec adds a
  local ops log channel". This is that follow-up. The `explore` tool already
  ships `_meta.ops` (stats, transcriptPath); `explore_repo` and the six
  wrappers do not — an asymmetry with no design rationale.
- Per-metric triage (approved 2026-06-10): parent agents do not need internal
  turn counts or API token totals, so those live in the ops channel only;
  no-tool exits and budget stops are already expressed by `searchCoverage`, so
  the runner rewires to envelope data; the dead budget-label metric is deleted.

## Functional Requirements

- **FR-001 (contract freeze)**: Public MCP tool `structuredContent` remains
  byte-for-byte unchanged in shape. No new fields, no `schemaVersion` bump.
  Existing tests that pin the absence of `stats`/`transcriptPath`/`_debug` in
  `structuredContent` stay green.
- **FR-002 (ops channel symmetry)**: `explore_repo` and the six wrapper tools
  MUST return `_meta: { ops: { stats, transcriptPath } }` on success, built by
  the same redaction path the `explore` tool already uses for its `_meta.ops`.
  The `explore` tool's existing `_meta.ops` shape is unchanged. `_meta.ops` is
  operational/evaluation metadata (spec 022 boundary), not part of the
  parent-facing answer contract.
- **FR-003 (effect metrics)**: a new pure module `src/benchmark/effect-metrics.mjs`
  computes per case, deterministically and offline:
  - `responsePayloadTokens` — CJK-aware token estimate of
    `JSON.stringify(structuredContent)`; this approximates what the parent
    agent actually ingests. Reuse the spec 024 estimator (export
    `estimateStringTokens` from the runtime if not already exported; internal
    import, not a public contract).
  - `citedSourceTokens` — token estimate over the full content of the unique
    files referenced by `evidence[].path` ∪ `targets[].path`, read from disk
    by the harness. Documented as a **conservative lower bound** of what the
    parent would have read natively (it excludes native search overhead such
    as greps and wrong-file reads).
  - `contextSavingsRatio` = `citedSourceTokens / responsePayloadTokens`;
    `null` when no files were cited.
  - Suite-level aggregation: mean over cases with non-null values
    (`avgResponsePayloadTokens`, `avgCitedSourceTokens`,
    `avgContextSavingsRatio`).
- **FR-004 (independent citation verification)**: the same module re-verifies
  citations against the working tree, without trusting `groundingStatus`:
  - For `evidence[]` items: parse the `"N: content"` snippet lines and compare
    each against the actual file line. Classify per item:
    `match`, `mismatch`, `file_missing`, `range_invalid`, `out_of_root`
    (all four non-match classes count as failures — a missing file or invalid
    range is a fabrication signal), and `redacted` (neutral, excluded from the
    denominator, when `evidence[].redacted === true`).
  - `citationAccuracy` = `match / (match + mismatch + file_missing +
    range_invalid + out_of_root)`; `null` when the denominator is 0. The
    suite-level `citationAccuracy` pools all evidence items across cases
    (not a mean of per-case ratios).
  - For `explore` report results (`citations[]`, which carry no snippets):
    verify only file existence and line-range validity, and label the result
    as weak verification in the report output.
- **FR-005 (runner rewiring)**: `scripts/run-benchmark.mjs`:
  - `avgToolTurns` reads `_meta.ops.stats.turns`.
  - New `avgInternalTokens` reads `_meta.ops.stats.totalTokens` (operator cost
    observability; replaces the deleted metric below).
  - `noToolExitRate` reads `_meta.ops.stats.toolCalls === 0` when ops data is
    present, falling back to `searchCoverage.filesRead + grepCalls +
    listDirCalls + symbolCalls === 0` otherwise (caveat: the fallback cannot
    see git-tool-only explorations because `searchCoverage` has no git-call
    counter).
  - `budgetExhaustionRate` reads `searchCoverage.stoppedByBudget`.
  - `deepBudgetAvgTotalTokens` is deleted (it filters on `stats.budget ===
    'deep'`, a concept removed by spec 011).
  - When a source is absent (no `_meta.ops`, empty transcript), the affected
    metric MUST print/report `n/a` (JSON `null`) — never a fabricated `0` or
    `100%`. This no-fabrication rule is the regression this spec exists to fix.
- **FR-006 (transcript metrics revival)**: when `CEREBRAS_EXPLORER_LOG_PATH`
  is not set, the runner enables transcripts into a temporary directory for
  the duration of the run and deletes it on exit; a `--keep-transcripts` CLI
  flag preserves it. A user-provided `CEREBRAS_EXPLORER_LOG_PATH` is respected
  and never deleted. Per case, the runner locates the transcript via
  `_meta.ops.transcriptPath` and feeds `analyzeTranscriptFile` so
  `avgBroadSearchCalls` / `avgRepeatedToolPlanTurns` (spec 007) produce real
  values again. No new environment variables.
- **FR-007 (record-only)**: all new and restored metrics are record-only and
  MUST NOT affect case pass/fail or suite exit codes (spec 021 principle:
  benchmarks are never a gate).
- **FR-008 (harness safety)**: the harness reads files only; it never writes
  inside the benchmarked repository. Cited paths are resolved against
  `repoRoot`; a path resolving outside it is classified `out_of_root` and not
  read.
- **FR-009 (fixture and output honesty)**: replace the stale
  `tests/benchmark-transcript-metrics.test.mjs` fixture that still feeds
  `_debug.stats` (a shape `getStats` stopped reading at spec 017); console
  summary lines print `n/a` for null metrics.
- **FR-010 (zero-dep)**: Node built-ins only (`node:fs`, `node:path`,
  `node:os`).
- **FR-011 (docs)**: README benchmark section documents the new metrics with
  the conservative-lower-bound caveat for `citedSourceTokens`; DESIGN.md
  defines the ops side-channel boundary (spec 017 follow-up fulfilled, spec
  022 provenance precedent); CHANGELOG entry under the next version.

## Out of Scope

- Automated parent-agent A/B measurement (driving Claude Code/Codex headless
  to compare real parent token usage). TESTING.md manual observation
  procedures §1-§2 remain the honest stand-in; backlog candidate.
- Cleaning up adoption-suite prompt-echo overlap between case inputs and
  expectation keywords (spec 021 residue); backlog candidate.
- Full `_meta.ops` parity for `explore_repo` (toolTrace, filesRead, toolsUsed
  lists); only `stats` and `transcriptPath` are added.
- Any change to public `structuredContent`, tool schemas, transcript record
  format, or environment-variable surface.
- Semantic citation relevance (does the cited code support the claim?); this
  spec verifies textual accuracy only.

## Acceptance

- `npm test` 0 fail.
- Unit tests for `effect-metrics.mjs` cover: exact snippet match, mismatch,
  `file_missing`, `range_invalid`, `out_of_root`, redacted-neutral exclusion,
  ratio computation, and the no-citation `null` case, against a temporary
  fixture repo.
- An MCP server test asserts `explore_repo` (and at least one wrapper)
  responses carry `_meta.ops.stats` while `structuredContent` still lacks
  `stats`/`transcriptPath` (contract freeze guard).
- A runner-level test feeds synthetic case results and asserts: rewired
  sources are read, deleted metric is gone, and absent sources yield `null`
  (printed as `n/a`), not `0`/`1`.
- One real benchmark run (operator-verified, API key required) shows
  `avgToolTurns` > 0, `noToolExitRate` < 100%, transcript metrics non-null,
  and `citationAccuracy` reported with real classifications.
- Zero-dependency checks remain green.
