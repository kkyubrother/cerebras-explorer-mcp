# Tasks: evidence-preservation investigation (spec 021)

## Investigation (done)

- [x] T001 Re-run `report-mode-citation-preservation` with `--verbose`; capture per-check breakdown.
- [x] T002 Determine `evidence=0` cause → display artifact (`explore` returns `citations`, not structured `evidence[]`).
- [x] T003 Attribute the failing checks: `citation_gap_warning=true`, `tool_results_truncated=true`, and partial (1/2) target-path coverage.
- [x] T004 Confirm orthogonality to v0.7.0 (transcript envvar removal does not touch citation/evidence extraction).

## Remediation (pending maintainer decision)

- [ ] T010 [DECISION] Choose remediation A (calibration) / B (confirm-first) / C (no-change).
- [ ] T011 If A: edit `benchmarks/evidence-preservation.json` prompt to drop the literal `src/explorer/runtime.mjs:L474-L500` example; optionally re-weight `citation_gap`/`truncated`; re-baseline and record the new score.
- [ ] T012 If B: run with `CEREBRAS_EXPLORER_LOG_PATH` set, inspect the gapped citation in the transcript JSONL, then revisit A/C.
