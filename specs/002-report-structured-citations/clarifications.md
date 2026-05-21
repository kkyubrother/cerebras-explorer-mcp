# Clarifications: Report-mode Structured Citations

**Feature Branch**: `002-report-structured-citations`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all**
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

1. **Citation shape** — entries carry `type`, `path`, `startLine`, `endLine`. The `type` discriminates file ranges (`file_range`) from git references; single-line citations record `startLine === endLine` rather than dropping a field. Source: spec Edge Cases + Task 2 source plan.
2. **Targets `role` marker** — citation-derived `targets[]` carry `role: 'reference'` to distinguish them from `explore_repo`'s compact `targets[]`. Source: spec FR-003, Task 2 source plan.
3. **Extractor reuse** — the critic's `extractReportCitations` / `extractGitCitations` are the single source of citation truth; this feature only normalizes their output for public consumption. Source: spec FR-007 + sub-agent validation report.
4. **Redaction policy** — citation paths flow through the existing redaction pipeline so deny-listed paths are stripped in both Markdown and `structuredContent`. Source: spec FR-006.

## Scope Confirmation

- In scope: `freeExplore` / `freeExploreV2` return-object additive fields, MCP `structuredContent` propagation for `explore` and `explore_v2`, regression tests for both surfaces.
- Out of scope: the critic extractor implementations themselves, the compact `explore_repo` contract, any new public field name beyond `citations` and the citation-derived `targets` role marker.

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan`.
