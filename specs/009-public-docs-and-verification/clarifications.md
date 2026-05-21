# Clarifications: Public Docs Refresh and Full Verification

**Feature Branch**: `009-public-docs-and-verification`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all**
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

1. **Closing-task gate** — Task 1 (truncation wording), Task 2 (citations[]), Task 3 (evidence-preservation benchmark), Task 6 (router heuristics), Task 7 (transcript metrics) must all be merged to master before this work begins. Source: spec FR-010 + Assumptions §1.
2. **Single new DESIGN section** — "V2 Evidence Reliability Gates" is the canonical section name and the single source for truncation labeling, `searchCoverage.warnings` recovery, citations/targets exposure, and V2 sole-backend gate criteria. Source: spec FR-004/FR-005.
3. **CHANGELOG grouping** — the five externally visible changes are recorded as one release bundle so readers identify them as a single plan outcome. Source: spec FR-006.
4. **Verification pipeline ordering** — focus tests → full `npm test` → benchmark JSON parse (adoption + evidence-preservation) → optional provider benchmark. Steps 1-3 are gates (exit 0); step 4 is a recording step (not a merge gate). Source: spec FR-008/FR-009.
5. **`npm test` skip-count tolerance** — failure count is the gate, not skip count. Skips vary with Windows / git availability. Source: spec Edge Cases + SC-005.

## Hard Dependencies

This task cannot proceed in isolation. Pre-flight check before code work:

- `git log master --grep="truncation"` finds Task 1's merge,
- `git log master --grep="citations"` finds Task 2's merge,
- `git log master --grep="evidence preservation"` finds Task 3's merge,
- `git log master --grep="router"` finds Task 6's merge,
- `git log master --grep="transcript"` finds Task 7's merge.

If any of these are missing, halt and remerge predecessors before continuing.

## Scope Confirmation

- In scope: README.md tool section refresh, DESIGN.md new "V2 Evidence Reliability Gates" section, CHANGELOG.md release entry, verification pipeline execution and result capture.
- Out of scope: any code change under `src/` or `tests/`, integration README updates beyond install-ref consistency, new tools or new public response fields.

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan` (entry condition: predecessor merge gate passes).
