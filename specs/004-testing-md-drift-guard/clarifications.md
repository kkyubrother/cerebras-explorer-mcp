# Clarifications: TESTING.md Fixed Totals Removal and Drift Guard

**Feature Branch**: `004-testing-md-drift-guard`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all**
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

1. **Scope expansion beyond source plan** — the source plan's regex only addresses the unit-test paragraph. The spec deliberately expands the cleanup to the integration result table (`N/N 통과`) and stdio smoke tool count (`N개 도구`) because sub-agent review identified them as the same drift class. Source: spec leading note + Task 4 scope review.
2. **Guard file location** — `tests/integrations.test.mjs` is the established doc-snapshot guard location (per AGENTS.md "8+ doc-snapshot guards"). New guard sits next to existing ones rather than creating a separate file. Source: spec Assumptions §2.
3. **Disclaimer retention** — the "이 문서의 숫자는 마지막 관측값" disclaimer stays. The cleanup removes specific numbers, not the meta-statement that explains why numbers aren't authoritative. Source: spec FR-004.
4. **API error code exemption** — codes 400/401/429 etc. in the error reference table are externally-defined identifiers and must not match the guard regexes. The patterns require co-occurrence with test-result words. Source: spec Edge Cases.

## Scope Confirmation

- In scope: TESTING.md prose updates (unit, integration, stdio smoke sections) and a new doc-drift guard test in `tests/integrations.test.mjs`.
- Out of scope: any change under `src/`, English translation sync of TESTING.md, integration test case-name rows (per-case 통과/실패 markers are operational signal worth keeping).

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan`.
