# Clarifications: Symbol Precision Baseline Coverage

**Feature Branch**: `008-symbol-precision-baseline`
**Created**: 2026-05-21
**Spec**: [spec.md](spec.md)

## Scan Result

`/speckit-clarify` scanned `spec.md` for `[NEEDS CLARIFICATION]` markers.

- Markers found: **0**
- Mandatory sections present: **all**
- Acceptance scenarios per user story: present and Given/When/Then-formed

## Informed Defaults Carried From Spec

1. **Classifier already exists** — `src/explorer/symbols.mjs` (`relationForUsage`, `classifyReference`) already implements the parser-free relation classifier with the four target relations. This feature primarily locks the classifier behind regression tests and documents the parser-free boundary in DESIGN.md. Source: spec scope memo + sub-agent validation report.
2. **Four canonical regression cases** — `session.touch()` → `member_call`, `new SessionManager()` → `constructor`, `(req: Request)` → `type_reference`, `requireAuth(req, res, next)` → `call`. Each asserted via `assert.deepEqual` so the `{ type, relation }` shape is also pinned. Source: spec FR-001 + User Story 1.
3. **Legacy contract untouched** — `categorizeReference()` continues to return `definition | import | usage` for downstream callers; only the `classifyReference().relation` field carries the precise category. Source: spec FR-003/FR-004.
4. **DESIGN.md boundary paragraph contract** — six categories listed (`call`, `member_call`, `constructor`, `type_reference`, `import`, `export`), LSP non-completeness caveat present, line-range re-verification advice present. Inserted near the existing symbol/reference section. Source: spec FR-006.

## Observation on ordered-checks order

Spec FR-005 reads `constructor → member_call → call`, but the current code at `src/explorer/symbols.mjs` lines 393-403 reads `constructor → call → member_call` because the `call` branch's left-edge negative class `[^.\w$#]` already excludes `.touch`. The two orderings are equivalent for the four cases. The new regression test guards either order; no spec amendment is required. Source: plan draft Risks §2.

## Scope Confirmation

- In scope: regression test addition to `tests/symbols.test.mjs`, parser-free boundary paragraph in `DESIGN.md`. Classifier code change only if a future regression makes the test fail (User Story 3 P3 fallback).
- Out of scope: whitespace-tolerant matching (`session . touch()`), multi-pattern lines, JSX/decorator/dynamic-import patterns.

## Verdict

No questions to ask the user. Spec is ready for `/speckit-plan`.
