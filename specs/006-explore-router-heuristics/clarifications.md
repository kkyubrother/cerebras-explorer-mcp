# Clarifications: Strengthen Explore Router Heuristics

**Feature Branch**: `006-explore-router-heuristics`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all**
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

1. **Length threshold** — 1200 characters for `prompt + context` is the V2 trigger boundary. Stated as a calibration constant that can be retuned via benchmarks (Assumptions §2). Source: spec FR-002 + plan draft Risks.
2. **Broad scope criteria** — `scope.length >= 6` OR any entry that is `.`, `./`, ends with `/**`, equals `**` or `**/*` or `*/**`. Source: spec FR-003/FR-004.
3. **Expanded keyword set** — English (lowercased): `deep dive`, `comprehensive`, `entire codebase`, `large architecture`, `end-to-end`, `architecture review`, `subsystem review`. Korean (literal): `전체`, `대규모`, `심층`, `종합`, `아키텍처`, `흐름`. Source: spec FR-005.
4. **Existing behavior preservation** — `thoroughness === 'deep'` continues to route V2 as the first OR branch; `explore_v2` opt-in policy unchanged; `tools/list` surface unchanged. Source: spec FR-001/FR-007/FR-008.
5. **Safety defaults** — `prompt`, `context`, `scope` of `undefined`/`null`/wrong type collapse to empty string / empty array without throwing. Source: spec FR-009.

## Acknowledged Trade-off

The `흐름` keyword can false-positive on casual prose; this is accepted because the report-intent semantics align well enough and the V2 path is internal (callers do not observe a different tool name). Source: spec User Story 2 + plan draft Risks.

## Scope Confirmation

- In scope: `shouldUseV2ForExplore()` heuristic strengthening plus a `hasBroadExploreScope()` helper, both in `src/mcp/server.mjs`; five new router unit tests in `tests/mcp-server.test.mjs`.
- Out of scope: external tool surface, `tools/list` shape, `explore_v2` opt-in policy, README/DESIGN documentation updates (handled by Task 9).

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan`.
