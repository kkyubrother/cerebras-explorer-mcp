# Clarifications: Evidence Preservation Benchmark Coverage

**Feature Branch**: `003-evidence-preservation-benchmark`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all**
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

1. **Four new check types** — `min_citation_count`, `min_citation_file_count`, `tool_results_truncated_equals`, `citation_gap_warning_equals` are the public benchmark-suite identifiers chosen by the spec. Source: spec FR-001~004 + source plan Task 3.
2. **Citations source** — checks consume `result.citations[]` directly. This means **Task 2 must be merged first**, or the new checks produce only false-negative signals. Source: spec Dependency note + sub-agent validation report.
3. **Separate suite + entry point** — `benchmarks/evidence-preservation.json` and a dedicated npm script run alongside the existing `benchmark` script without altering adoption suite execution. Source: spec FR-007.
4. **Edge handling** — null/non-array `citations` and missing critic warnings collapse to 0/false safely; duplicate file paths are deduplicated for file-diversity count. Source: spec Edge Cases.

## Scope Confirmation

- In scope: evaluator switch additions, suite file, npm entry point, evaluator unit tests.
- Out of scope: changing existing `min_grounded_evidence_count` / `min_evidence_snippet_count` behavior, modifying `adoption.json` cases (that is Task 7's territory), provider-side benchmark execution (operator decision, not a merge gate here).

## Hard Dependency

Task 2 (`citations[]` exposure) is the strict predecessor. `/speckit-plan` execution should not begin code work until Task 2 is merged into master.

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan` (gated on Task 2 merge).
