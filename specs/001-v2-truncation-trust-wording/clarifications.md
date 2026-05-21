# Clarifications: V2 Truncation Trust Wording

**Feature Branch**: `001-v2-truncation-trust-wording`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all** (User Scenarios, Requirements, Success Criteria, Assumptions)
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

Two design choices were resolved without questions because the source plan and the sub-agent validation report pinned them:

1. **Exact replacement wording** — the envelope says "Result was truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing." The `searchCoverage` warning uses the same recovery phrasing. Source: original plan Task 1 Step 3 + sub-agent validation report.
2. **Marker location** — a single stable token (`TRUNCATED_TOOL_RESULT_MARKER`-shaped constant) replaces the substring-matching heuristic. The constant name itself is an implementation choice for `/speckit-plan`, not `/speckit-clarify`.

## Scope Confirmation

- In scope: `applyToolResultCharBudget()` envelope wording, `buildSearchCoverage()` truncation warning text, the marker that drives `toolResultsTruncated` counting, one new regression test in `tests/runtime.mock.test.mjs`.
- Out of scope: per-tool character budgets, redaction, gzip, transcript recording, the compact `targets[]` contract, any change to public response schemas.

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan`.
