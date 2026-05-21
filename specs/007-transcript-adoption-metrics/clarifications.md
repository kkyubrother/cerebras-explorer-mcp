# Clarifications: Transcript-Based Adoption Metrics

**Feature Branch**: `007-transcript-adoption-metrics`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all**
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

1. **Public function names** — `analyzeTranscriptEntries(entries)` and `analyzeTranscriptFile(filePath)` exported from `src/benchmark/transcript-metrics.mjs`. Source: spec FR-001.
2. **Metric shape (seven scalars)** — `assistantTurns`, `toolCalls`, `broadSearchCalls`, `readCalls`, `toolErrorCalls`, `repeatedToolPlanTurns`, `stoppedByBudget`. Source: spec FR-002.
3. **Tool categorization** — broad search: `repo_grep`, `repo_find_files`, `repo_list_dir`. Read: `repo_read_file`, `repo_symbol_context`, `repo_symbols`, `repo_references`. Source: spec FR-003.
4. **Repeated plan rule** — increments only when the current assistant turn's sorted tool set equals the previous turn's sorted tool set; empty plans excluded. Source: spec FR-004.
5. **`stoppedByBudget`** — derived from the last `meta` entry's `stats.stoppedByBudget` cast to boolean. Source: spec FR-005.
6. **Average rollups** — `avgBroadSearchCalls` and `avgRepeatedToolPlanTurns` rounded to one decimal place; `null` when no transcripts exist. Source: spec FR-008.
7. **Function location correction** — `computeExtendedMetrics()` lives in `scripts/run-benchmark.mjs` (lines ~128-180), not `src/benchmark/report.mjs` as the source plan implied. The plan draft applies the change in the actual location. Source: plan draft's correction note based on code reading.

## Scope Confirmation

- In scope: new `src/benchmark/transcript-metrics.mjs`, new `tests/benchmark-transcript-metrics.test.mjs`, edits to `scripts/run-benchmark.mjs` and `benchmarks/adoption.json`.
- Out of scope: multi-session aggregation, new evaluator check types (Task 3 owns that), provider-side runs (operator decision).

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan`.
