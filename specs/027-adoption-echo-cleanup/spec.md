# Feature Spec: adoption-suite prompt-echo credit cleanup

**Spec**: 027-adoption-echo-cleanup | **Date**: 2026-06-14 | **Status**: implemented 2026-06-14 — hygiene test RED→GREEN (18 echo tokens across 8 cases removed), `npm test` 462/0, echo-only `trace-symbol` score 0.15→0; live `npm run benchmark` record-only run pending operator API key

## Summary

The `benchmarks/adoption.json` suite awards real, fractional score to answers
that merely **echo the case's own input arguments** back into the response,
with no codebase discovery. The evaluator matches a keyword `group` when the
answer contains **any one** token in it (OR-within-group,
`src/benchmark/evaluator.mjs:86`) and awards
`pointsEarned = coverage × weight` (`evaluator.mjs:190`) **decoupled** from the
binary `passed` / `minCoverage` gate. So any scored group that contains **even
one** token derivable from the case `args` (e.g. the symbol handed to
`trace_symbol`) is earnable by a substring echo and contributes its fractional
weight even though the model proved nothing.

This spec removes that earnable-by-echo credit at the **case-authoring** layer
and adds a **hygiene guard test** so it cannot regress — without changing the
evaluator's (intentional) graded-scoring semantics, and without touching the
public tool surface, the `evidence-preservation` suite, or any runtime
dependency. It is the `adoption`-echo half of spec 025's deferred Out-of-Scope
seed; the parent-agent A/B half was dropped (see Out of Scope and
`plan/extension-backlog.md` (a)).

## Motivation

- **Quantified leak.** For case `trace-symbol` (args
  `symbol: "normalizeExploreResult"`), an answer that writes only
  `normalizeExploreResult` into `directAnswer` and discovers nothing matches
  1 of that expectation's 3 groups → coverage `0.333` → `0.333 × 0.45 = 0.15`
  points, i.e. **15% of the case's total weight (1.0) for pure echo** (verified
  by running `evaluateBenchmarkCase` against an echo-only result: `score 0.15`,
  `passed false`). The case still falls under the suite `defaultPassScore 0.72`
  (`adoption.json:4`; the bare `0.7` in `evaluator.mjs:202` is only the
  direct-call fallback), but the suite-level `averageScore` is inflated by the
  free `0.15`, and the inflation is invisible because it rides under the
  threshold.
- **Scope: 9 cases, 8 leak.** The suite has 9 cases. Eight contain at least one
  expectation token that is a verbatim substring of that case's `args`:
  `locate-relevant-code`, `trace-symbol`, `trace-symbol-cross-check`,
  `map-change-impact`, `explain-code-path`, `review-change-context`,
  `structured-output-contract`, `direct-vs-explorer-boundary`. `collect-evidence`
  is already clean and is the model the others should resemble (fully discovery
  tokens in both scored expectations).
- **Surgical for 7, one rewrite.** Seven cases are fixed by stripping/cleaning
  echo tokens while keeping discovery groups. `structured-output-contract`'s
  0.45-weight `combined_text` expectation is **all-echo** and cannot be stripped
  (that would empty its group list — see FR-001 vacuous-credit guard); its groups
  must be **replaced** with located-file discovery tokens. This stays mechanical
  (file paths the model must locate), not a semantic-relevance judgment.
- **On-thesis.** The project's value claim is that explorer output lets a parent
  agent *avoid native re-search*; a benchmark that pays for parroting the
  question measures the opposite. spec 026 already moved `trace-symbol` toward
  discovered-fact expectations (production callsite + usage cross-check); this
  continues that line.
- **Not an engine bug.** Graded partial credit is a deliberate feature. The
  defect is *authoring* that let an echo-earnable group carry weight. Reshaping
  the scorer would change every case in both suites for a problem isolated to a
  handful of groups — disproportionate (see FR-002).

## Functional Requirements

- **FR-001 (no echo-earnable scoring group)**: Define the **echo corpus** of a
  case as all primitive leaf **values** of its `args` (recurse arrays/objects;
  *values only*, never the schema keys `symbol`/`scope`/`knownFiles`/…),
  joined by space and normalized with the evaluator's `normalizeText`
  (lowercase → collapse whitespace → trim). A token is an **echo token** iff
  `normalize(token)` is a substring of the corpus (direction `token ⊆ args`;
  substring, not whole-token equality — `structuredContent` ⊆ the query
  `"…structuredContent fields?"` must count). In `benchmarks/adoption.json`, no
  scored expectation `group` (one under a non-zero `weight`) may contain **any**
  echo token (existential rule, matching the OR-within-group matcher), unless
  that `(case-id, expectation-label, token)` triple is allowlisted (FR-003).
  Additionally, every scored expectation MUST retain **≥1 group**, and **≥1 of
  its groups MUST be a discovery group** (contains no echo token and is not
  allowlisted). Never reduce an expectation's `groups` to `[]` — the evaluator
  scores an empty group list as `coverage = 1` (`evaluator.mjs:97`), awarding
  full vacuous credit — and never leave an expectation earnable solely through
  allowlisted-echo tokens.
- **FR-002 (evaluator semantics frozen)**: `src/benchmark/evaluator.mjs` scoring
  semantics are unchanged; the linear partial-credit model
  (`pointsEarned = coverage × weight`) — shared with the `evidence-preservation`
  suite — MUST NOT be altered. One **additive internal export** of the existing
  pure helper `normalizeText` is permitted so the hygiene test computes the echo
  corpus with the *same* normalization the scorer uses (spec 025
  `estimateStringTokens` precedent: internal import, not a public contract). The
  leak is closed by removing the input it feeds on, not by reshaping the scorer:
  no cross-suite score shift, minimal blast radius.
- **FR-003 (regression guard test)**: A new unit test
  `tests/adoption-suite-hygiene.test.mjs` loads the real
  `benchmarks/adoption.json`, imports the evaluator's `normalizeText` (does not
  reimplement it), and for every case and every scored expectation asserts:
  (a) the expectation has ≥1 group; (b) no group contains a non-allowlisted echo
  token; (c) at least one group is fully discovery. The **allowlist** is an
  in-test object keyed `(case-id, expectation-label, token)` → one-line
  justification naming the input field that makes the echo legitimate; an entry
  is valid only when the same expectation retains an independent discovery group,
  so an allowlisted token can never be the sole earner of an expectation's
  weight. An empty allowlist is the goal. The test is deterministic, zero-API,
  and runs under `npm test`.
- **FR-004 (weight conservation, non-vacuous)**: Each expectation's `weight` is
  unchanged, so each case's total stays `1.0`. Because FR-001/FR-003 guarantee
  every scored expectation keeps ≥1 discovery group, no expectation collapses to
  vacuous `coverage = 1`, and an echo-only answer can no longer pass or
  materially score any expectation. Thinning some expectations to a single
  discovery group (`explain-code-path`, `review-change-context`,
  `direct-vs-explorer-boundary`) makes their realistic score more volatile; this
  is recorded in the PR (record-only, not gated).
- **FR-005 (record-only invariant preserved)**: The adoption suite stays
  record-only — run by `npm run benchmark` (live API), never gating `npm test`
  or exit codes (spec 021 / spec 025 FR-007). The only new gate is the
  deterministic FR-003 test, which checks suite *authoring*, not model output.
- **FR-006 (zero-dep)**: Node built-ins only; no `dependencies` /
  `devDependencies` added (AGENTS.md invariant).
- **FR-007 (docs, concrete)**: Add to the README benchmark section one explicit
  sentence stating that adoption keyword scoring credits **discovered facts**
  (located files, grounded snippets, production callsites), **not echoes of the
  case inputs**, and that `tests/adoption-suite-hygiene.test.mjs` enforces it.
  Editing `adoption.json` is the right-hand side of the AGENTS.md
  `evaluator.mjs → adoption.json` sync row and triggers no further doc sync; the
  additive `normalizeText` export is not a schema change.

## Per-case target state

Concrete minimal edits from the per-case audit (every case keeps ≥1 discovery
group). "echo" = verbatim substring of that case's `args` values.

| Case | Edit | Surviving discovery anchor |
|---|---|---|
| `locate-relevant-code` | drop `tools/list` from `["tools/list","buildToolList"]` → `["buildToolList"]` | `src/mcp/server.mjs`, `tests/mcp-server.test.mjs`, `buildToolList` |
| `trace-symbol` | remove pure-echo group `["normalizeExploreResult"]` | `schemas.mjs`, `evidence`/`targets`, `src/explorer/schemas.mjs` |
| `trace-symbol-cross-check` | remove pure-echo group `["buildReportCritic"]` | `critic.mjs`, `runtime.mjs`, `src/explorer/runtime.mjs` |
| `map-change-impact` | drop echo group `["tests"]`; `["output","schema"]`→`["schema"]`; `["test","검증"]`→`["검증"]` | `schemas.mjs`/`runtime.mjs`/`server.mjs`, `runtime`/`normaliz` |
| `explain-code-path` | remove `["tools/call"]`,`["exploreRepository"]` (→ `["handleRequest"]`); remove target `["src/mcp/server.mjs"]` (knownFile) | `handleRequest`, `src/explorer/runtime.mjs` |
| `review-change-context` | remove `["tool","metadata"]`; `["test","검토"]`→`["검토"]` | `server.mjs` (consider adding a discovered synonym; `검토`-only is thin) |
| `structured-output-contract` | **rewrite** all-echo `combined_text` → `[["src/explorer/schemas.mjs"],["src/mcp/server.mjs"]]` (owners of `normalizeExploreResult`@schemas.mjs:469, `formatExploreResult`@server.mjs:486); `status_verification` untouched | located-file groups; `status_verification` enum |
| `direct-vs-explorer-boundary` | **decision: strip** `README.md` everywhere + `explore_repo` + `return` (empty allowlist) | `next_action` `read_target`/`stop`; `combined_text` survivor `반환` is thin — flagged for future redesign |

## Out of Scope

- **Parent-agent A/B automation** — dropped 2026-06-14 (not deferred). A
  never-gating, npm-test-external harness that spawns an external parent CLI and
  parses its transcript via a per-parent adapter: a CLI format change silently
  yields a record-only report that *looks* authoritative but is wrong, and the
  pressure to tame that brittleness threatens the zero-dep invariant. TESTING.md
  "수동 관찰 절차" §1–§2 remain the honest stand-in. Recorded in
  `plan/extension-backlog.md` (a).
- **Evaluator scoring-semantics changes** (gating `pointsEarned` on
  `minCoverage`, engine-side discovered-token tagging). Rejected in FR-002. The
  adversarial review confirmed the author-layer fix + corrected predicate closes
  the leak with the scorer untouched.
- **The `evidence-preservation` suite.** Only `adoption.json` is touched.
- **Any public surface change** — tool schemas, `structuredContent`, envvars,
  transcript format.
- **Semantic citation relevance.** `structured-output-contract`'s replacement
  tokens are located file paths (mechanical), not relevance judgments.

## Acceptance

- `npm test` 0 fail, including `tests/adoption-suite-hygiene.test.mjs`.
- The hygiene test fails when any scored expectation (a) is left with zero
  groups, (b) contains a non-allowlisted echo token, or (c) has no fully
  discovery group — i.e. it catches both the pure-echo regression and the
  empty-group over-scoring regression.
- The test computes its echo corpus via the evaluator's exported `normalizeText`
  (algorithm parity with the scorer; no divergent reimplementation).
- Zero-dependency check remains green.
- A `npm run benchmark` live run (operator-verified, API key required)
  completes; per-case `passed` / `score` recorded; the PR notes the record-only
  score diff and confirms no expectation now scores via vacuous empty groups.
- `benchmarks/adoption.json` contains no scored expectation group with a
  non-allowlisted echo token, and every scored expectation has ≥1 discovery
  group (the conditions the hygiene test encodes).
