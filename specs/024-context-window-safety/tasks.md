# Tasks: context-window safety for the explorer runtime (spec 024)

- [x] T001 Fix report-loop fallback compaction to use the 70% `compactionThreshold` instead of the 100% hard context limit.
- [x] T002 Add CJK-aware token estimation with ASCII `/4` and non-ASCII `/2` weighting.
- [x] T003 Add compact-path proactive compaction at 70% of the context window.
- [x] T004 Inject a deterministic `[verified-evidence-ledger]` message after compact-path compaction while preserving tool-call pairing.
- [x] T005 Track report-loop observed line ranges for `repo_read_file`, `repo_grep`, and `repo_symbol_context`.
- [x] T006 Wire report-loop `observedRanges` into `buildReportCritic` and emit `citation_line_gap` for cited ranges outside inspected ranges.
- [x] T007 Reword report context-management prompt text so truncation markers do not imply omitted content was preserved.
- [x] T008 Update CHANGELOG and current-plan pointers for the spec 024 landing.
- [x] T099 Verify closure with `npm test` 411 pass / 0 fail on 2026-06-05.
