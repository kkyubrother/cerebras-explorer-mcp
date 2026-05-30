# Tasks: evidence-preservation investigation (spec 021)

## Investigation (done)

- [x] T001 Re-run `report-mode-citation-preservation` with `--verbose`; capture per-check breakdown.
- [x] T002 Determine `evidence=0` cause → display artifact (`explore` returns `citations`, not structured `evidence[]`).
- [x] T003 Attribute the failing checks: `citation_gap_warning=true`, `tool_results_truncated=true`, and partial (1/2) target-path coverage.
- [x] T004 Confirm orthogonality to v0.7.0 (transcript envvar removal does not touch citation/evidence extraction).

## Remediation — A applied (2026-05-31)

- [x] T010 [DECISION] Chose **A** (benchmark calibration); maintainer approved.
- [x] T011 Removed the literal `src/explorer/runtime.mjs:L474-L500` example from the case prompt (self-echo source), replaced with a placeholder `path/to/file.ext:L10-L20`. Weights left unchanged — the documented 0.75 core / 0.25 informational split is intentional ([[feedback-benchmark-calibration]]). Re-baseline: **63% FAIL → 75% PASS** on two consecutive runs; `target_paths` 1/2 → 2/2 groups, citations 25–28 across 6–7 files. `tool_results_truncated` and `citation_gap` still fire by design within the 0.25 informational budget, so core-full lands exactly at the 0.75 PASS threshold.
- [~] T012 N/A — chose A, not B.
