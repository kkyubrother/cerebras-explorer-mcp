# Clarifications: Wrapper Unknown-Key Regression Matrix

**Feature Branch**: `005-wrapper-unknown-key-matrix`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all**
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

1. **No code change** — `validatePublicToolArgs()` already routes all six wrappers; this feature is test-only. FR-005 explicitly forbids per-wrapper destructuring guards. Source: spec FR-005 + sub-agent validation report.
2. **Required-arg matrix** — each wrapper's legal required argument is fixed by its existing public schema (`find_relevant_code.query`, `trace_symbol.symbol`, `map_change_impact.change`, `explain_code_path.pathQuery`, `collect_evidence.claim`, `review_change_context.reviewGoal`). The matrix tests inject exactly one unknown key per wrapper, with the unknown key name varying so accidental schema-pass cannot mask a regression. Source: spec FR-002 + sub-agent code inspection.
3. **Canary contract** — the `ShouldNotRunChatClient` double's "runtime should not be invoked for invalid wrapper arguments" string must never appear in any response, proving short-circuit at validation time. Source: spec FR-003.

## Scope Confirmation

- In scope: matrix test in `tests/mcp-server.test.mjs` covering all six wrappers; canary assertion for `createChatCompletion` non-invocation; structuredContent.failure shape assertion for each wrapper.
- Out of scope: any change to `src/mcp/server.mjs`; argument type validation; missing-required-arg cases (those are different failure modes).

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan`.
