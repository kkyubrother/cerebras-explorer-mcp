# Investigation Spec: evidence-preservation report-mode benchmark scoring

**Spec**: 021-evidence-preservation-investigation | **Date**: 2026-05-31 | **Status**: investigation complete, remediation pending decision

## Trigger

v0.7.0 post-release benchmark (record-only): `report-mode-citation-preservation` (suite `benchmarks/evidence-preservation.json`, tool `explore`) scored **63%** (pass threshold 0.75) and printed `evidence=0`. Flagged for follow-up.

## Findings (verbose re-run, 2026-05-31)

`explore` (Markdown report mode) on this repo, 15 turns / 27 tool calls:

| check | weight | result |
|---|---|---|
| Citation targets include impl or tests (`target_paths`, minCoverage 0.5) | 0.25 | **1/2 groups** (partial) |
| Preserves ≥2 citations | 0.25 | PASS (actual=22) |
| Preserves ≥2 cited files | 0.25 | PASS (actual=5) |
| Tool results not truncated | 0.10 | **FAIL** (actual=true) |
| No `citation_gap` warning | 0.15 | **FAIL** (actual=true) |

≈ 0.63.

## Analysis

1. **`evidence=0` is a display artifact, not a defect.** `explore` (report mode) returns `citations`/`targets`, not the structured `evidence[]` array that `explore_repo` populates. The benchmark printout reads `result.evidence?.length` → 0 (`scripts/run-benchmark.mjs:209`). Actual citation preservation is strong: 22 citations across 5 files, both well above the ≥2 thresholds.
2. **`citation_gap_warning=true` is most likely the documented calibration artifact** ([[feedback-benchmark-calibration]]: "models echo doc example paths into citations"). The case prompt (`evidence-preservation.json:11`) literally contains the example citation `src/explorer/runtime.mjs:L474-L500`; the model tends to echo it into the report even if it did not read exactly those lines, which trips the grounding critic. Citations are otherwise abundant.
3. **`tool_results_truncated=true`** reflects legitimate bounded-read truncation during a deep 27-tool-call exploration; spec 019 deliberately surfaces this as a trust caveat. Penalizing it (0.10) is a benchmark-calibration choice, not a code defect.
4. **target-paths 1/2 groups**: the report covered the implementation group (`runtime.mjs`/`critic.mjs`) but not the `tests/mcp-server.test.mjs` group (or partially), a soft coverage miss.
5. **Not a v0.7.0 regression.** The v0.7.0 change (transcript envvar removal) is orthogonal to citation/evidence extraction. 63% is consistent with the post-v0.3.0 ~60% band in [[feedback-benchmark-calibration]].

## Remediation options (decision pending — maintainer)

- **A (calibration — recommended)**: neutralize the self-echo by removing the literal `src/explorer/runtime.mjs:L474-L500` example from the case prompt (keep the "use backticked references" instruction), and/or down-weight `citation_gap` / `truncated` per the ≤0.25 informational-warning calibration guidance. Re-baseline the suite.
- **B (confirm first)**: capture one run with `CEREBRAS_EXPLORER_LOG_PATH` transcript on, inspect which citation triggered the gap, and confirm it is the echoed example before changing the benchmark.
- **C (no change)**: accept ~63% as the report-mode baseline; document that `evidence=0` for `explore` mode is expected and that citation_gap here is a known prompt-echo artifact.

## Out of scope

- Changing `explore` runtime citation/grounding behavior — no defect identified.
- Altering the v0.7.0 release (already shipped; benchmarks are record-only and never a gate).
