# Feature Specification: trace_symbol usage cross-check enforcement

**Feature Branch**: `026-trace-symbol-cross-check`

**Created**: 2026-06-10

**Status**: implemented 2026-06-10 (branch `026-trace-symbol-cross-check`); closure verified (`npm test` 458 pass / 0 fail / 2 skipped, integration 5/5, SC-001 live 0 violations, adoption benchmark 9/9 — existing trace-symbol non-regressed at 1.0, new trace-symbol-cross-check 0.867). Merged to master 2026-06-12 (PR #43 US1/US2 + PR #44 US3/Polish).

**Input**: User description: "trace_symbol이 정의는 정확히 찾았지만 프로덕션 호출처를 누락하고도, repo-wide grep 0회 상태에서 verified / complete / high / critic pass를 반환 — 거짓 양성 차단은 잘 되지만 '다 찾았는가'(거짓 음성)는 어떤 신호도 없는 과신 모드. 4층 수정: ① 원인 측정 먼저(repo_symbol_context caller 수집 누락 원인), ② sufficiency gate 확장(taskMode='symbol_trace'에 usage cross-check 관측 요구, 미관측 시 targeted_read_needed 강등 + confidence cap), ③ additive critic warning usage_cross_check_missing, ④ symbol-first 전략 프롬프트 보강. 공개 surface 불변, 과경고 방지를 위해 scope 내 grep 충족 인정."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Honest completeness signal on usage tracing (Priority: P1)

A parent coding agent (Claude Code / Codex) calls `trace_symbol` to learn where a
symbol is defined **and used** before planning an edit. Today the explorer can
miss a real production callsite and still report `verified` / `complete:true` /
`confidence:high` with a passing critic, because nothing checks whether the
exploration ever cross-verified usages beyond a single symbol lookup. The parent
then edits with a false sense of complete impact knowledge.

After this feature, when a `symbol_trace` exploration finishes **without any
observed usage cross-check** (no grep or reference search for the target symbol
within the active scope), the result must stop short of claiming full
verification: verification downgrades to "targeted read needed", confidence is
capped at medium, and a single actionable warning tells the parent the one cheap
step that restores trust (run one scope-wide grep for the bare symbol name).

**Why this priority**: This is the trust contract of the tool. The project's
purpose is that a parent can act on the explorer's answer without re-exploring;
a silent false-negative mode on the tool whose job is usage tracing is the most
damaging possible overconfidence. The deterministic gate alone (without the
other stories) already removes the dishonest state, so it is an independently
shippable MVP.

**Independent Test**: Drive a scripted exploration (mocked model) that returns a
high-confidence symbol-trace answer after only a symbol lookup, and assert the
downgrade + warning appear; drive a second scripted exploration that performs a
grep for the symbol and assert no downgrade and no warning.

**Acceptance Scenarios**:

1. **Given** a `trace_symbol` call whose exploration used only a symbol lookup
   and file reads (no grep / reference search for the target symbol), **When**
   the model finishes with `confidence:high` and a complete-looking answer,
   **Then** the returned `status.verification` is `targeted_read_needed`,
   `status.confidence` is at most `medium` (with the existing
   confidence-downgrade warning trail), and `critic.warnings` contains exactly
   one `usage_cross_check_missing` warning naming the symbol and the follow-up
   action.
2. **Given** a `trace_symbol` call whose exploration ran at least one grep (or
   reference search) for the target symbol within the active scope, **When**
   the run finishes, **Then** no `usage_cross_check_missing` warning is added
   and the verification/confidence judgment is unchanged from today's rules.
3. **Given** a `trace_symbol` call with a narrow `scope` (for example a single
   directory), **When** the exploration greps for the symbol inside that scope,
   **Then** the cross-check requirement counts as satisfied — the gate never
   demands a search wider than the scope hard boundary.
4. **Given** any non-`symbol_trace` exploration (other wrappers, direct
   `explore_repo`, report mode), **When** it finishes, **Then** its results are
   byte-identical to today's behavior (the gate applies only to symbol tracing).

---

### User Story 2 - The reproduction case finds the production callsite (Priority: P2)

An operator replays the 2026-06-10 probe: tracing the symbol
`buildReportCritic` in this repository. The probe showed the explorer's symbol
context lookup returned only the definition and test usages, never the
production callsite in the report runtime path — and the exploration trusted
that single lookup. Before changing any judgment rules, the underlying miss
must be measured: why did caller collection skip the production callsite
(result truncation at the search cap? collection scope? pattern limits?), and
if the cause is a defect in the parser-free indexer, fix it within the
zero-dependency principle.

**Why this priority**: The gate (Story 1) makes the miss honest; this story
makes the miss less likely. It is second because honesty is required even after
the indexer improves — no parser-free indexer can promise completeness.

**Independent Test**: A regression fixture reproduces the probe shape (a symbol
defined in one module, called in a large production module and in tests) and
asserts the symbol-context caller list includes the production callsite; the
measured root cause is recorded in the feature's plan as a baseline note.

**Acceptance Scenarios**:

1. **Given** the reproduction fixture (definition + production callsite in a
   large file + test callsites), **When** the symbol-context lookup runs,
   **Then** the production callsite appears in the caller results.
2. **Given** the root-cause measurement, **When** the cause is identified,
   **Then** it is written down as a baseline (including whether it was a defect
   or an inherent cap) before any judgment-rule change lands.

---

### User Story 3 - The explorer is steered to cross-check before finalizing (Priority: P3)

The exploration model following the symbol-first strategy should normally
perform the cross-check on its own, so parents rarely ever see the downgrade
from Story 1. The strategy guidance must explicitly instruct: after confirming
the definition, run one scope-wide grep for the bare symbol name before
finalizing the answer.

**Why this priority**: Prompt guidance is non-deterministic — it reduces how
often the gate fires but cannot replace it. It ships last because its value is
cost reduction (fewer downgraded results, fewer parent follow-ups), not
correctness.

**Independent Test**: The symbol-first strategy prompt text contains the
cross-check instruction (asserted by a prompt snapshot test), and a live
benchmark run of the symbol-trace case shows a usage cross-check being
performed (observable in the run's recorded search counters).

**Acceptance Scenarios**:

1. **Given** the symbol-first strategy guidance, **When** its prompt is built,
   **Then** it instructs one scope-wide grep cross-check for the target symbol
   before finalizing.
2. **Given** the live symbol-trace benchmark case after this change, **When**
   it runs, **Then** the recorded exploration shows at least one grep or
   reference search (so the Story 1 warning does not fire in the normal path).

---

### Edge Cases

- **Narrow scope**: the cross-check is satisfied by a grep *within* the active
  scope; the gate must never push the explorer (or the parent) beyond the scope
  hard boundary.
- **Very common symbol names** (e.g. `get`): a cross-check attempt counts even
  when its results are truncated by the search-result cap; the gate checks that
  the search *happened*, not that its results were exhaustive.
- **Pattern matching rule**: an observed grep counts for the symbol only when
  its pattern contains the bare symbol name; unrelated greps must not satisfy
  the gate. Reference searches count when made for the target symbol.
- **No definition found at all**: when the exploration cannot even locate the
  symbol, today's low-confidence path already applies; the new gate must not
  add a second, redundant warning on top of that flow.
- **Aliased / renamed re-exports**: a usage reachable only through a rename is
  beyond the parser-free engine's documented limits and stays out of scope; the
  warning's action text is the mitigation.
- **Warning budget**: the critic returns at most 3 warnings today; the new
  warning competes within the existing budget and must not displace a
  higher-severity warning.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (root-cause baseline first)**: Before any judgment-rule change, the
  team MUST reproduce the 2026-06-10 probe miss (symbol `buildReportCritic` in
  this repository), measure why the caller collection skipped the production
  callsite, and record the finding as a baseline in the feature plan. If the
  cause is a correctable defect in the parser-free symbol/reference engine, it
  MUST be fixed within the zero-dependency principle; if it is an inherent cap
  (e.g. result-count truncation), the cap's role MUST be documented.
- **FR-002 (deterministic usage cross-check gate)**: For explorations carrying
  the symbol-trace task mode, the runtime MUST require an **observed usage
  cross-check** — at least one grep whose pattern contains the bare target
  symbol name, or one reference search for the target symbol, executed within
  the active scope — as an additional condition for reporting `verified`. The
  judgment MUST be a pure function of already-observed exploration facts (no
  extra model calls).
- **FR-003 (downgrade semantics)**: When the gate fails, the runtime MUST
  downgrade `status.verification` to `targeted_read_needed` and cap
  `status.confidence` from `high` to `medium`, reusing the existing
  confidence-downgrade mechanism so the cap is visible in the existing warning
  trail. `status.complete` follows the existing sufficiency rules for the
  downgraded verification level.
- **FR-004 (additive critic warning)**: The deterministic critic MUST emit a
  new warning type `usage_cross_check_missing` when the gate fails, following
  the established warning shape (`type`, `severity`, short `message`, `target`
  = the symbol, `action` = run one scope-wide grep for the bare symbol name /
  treat the usage list as possibly incomplete). The warning is additive: no
  schema version bump, existing warning types unchanged, the at-most-3 warning
  budget and ordering rules unchanged.
- **FR-005 (scope-aware satisfaction)**: A cross-check executed inside the
  call's active scope MUST satisfy the gate. The gate MUST NOT require, suggest,
  or imply searching outside the scope hard boundary.
- **FR-006 (strategy guidance)**: The symbol-first strategy guidance MUST
  instruct the exploration model to run one scope-wide grep for the bare symbol
  name after confirming the definition and before finalizing. Prompt-only
  compliance is acknowledged as non-deterministic; FR-002/FR-004 remain the
  enforcement layer.
- **FR-007 (surface freeze)**: No new public tools, no new tool inputs, no new
  environment variables, no change to the public `structuredContent` field set
  or `schemaVersion`. The gate applies only to the wrapper-owned symbol-trace
  task mode; direct `explore_repo` calls (which carry no wrapper-owned intent)
  are out of scope, consistent with the documented task-mode asymmetry.
- **FR-008 (benchmark reflection, record-only)**: The symbol-trace benchmark
  case MUST gain (a) an expectation group for the reproduction's production
  callsite file and (b) a structural check that a usage cross-check was
  performed. Benchmark results remain record-only and never gate releases.
- **FR-009 (invariants)**: Zero runtime dependencies; read-only exploration;
  all existing tests stay green; the existing behavior of every non-symbol-trace
  path is unchanged.
- **FR-010 (documentation)**: The evidence-sufficiency and critic sections of
  the design documentation MUST describe the new gate, the new warning type,
  and the scope-aware satisfaction rule; the changelog MUST record the change
  under the next version.

### Key Entities

- **Usage cross-check observation**: a runtime-internal fact — "a search for
  the target symbol was executed during this exploration" — derived from
  observed tool calls (search kind, pattern/symbol, scope). Never exposed in
  the public answer payload; feeds the gate and operational records only.
- **`usage_cross_check_missing` warning**: a deterministic critic warning item
  (type, severity, message, target symbol, follow-up action) appearing in the
  existing `critic.warnings` list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (no silent overconfidence)**: In repeated live replays of the probe
  (5 runs of the `buildReportCritic` trace), **zero** runs return
  `verified` + `confidence:high` without an observed usage cross-check. Runs
  that skip the cross-check carry the downgrade and the warning instead.
- **SC-002 (deterministic gate proven)**: Scripted-exploration tests prove both
  gate directions — downgrade + warning when no cross-check was observed;
  unchanged judgment and no warning when one was — including the narrow-scope
  satisfaction case. These tests pass on every run (no flakiness).
- **SC-003 (over-warning bounded)**: Across the full adoption benchmark suite,
  `usage_cross_check_missing` appears **zero** times on cases whose
  explorations did perform a cross-check, and the symbol-trace case's pass
  status does not regress from its pre-change result on the same suite.
- **SC-004 (bounded cost)**: The symbol-trace case's recorded average
  exploration turns increase by no more than 2 turns versus the pre-change
  baseline, and the internal token average stays within +25% (observed via the
  existing record-only effect metrics).
- **SC-005 (regression safety)**: The full test suite reports 0 failures, and
  the public response contract is byte-identical for non-symbol-trace calls.

## Assumptions

- The wrapper-owned task mode (`symbol_trace`) is the correct and sufficient
  scoping boundary for the gate; direct `explore_repo` calls with symbol hints
  intentionally keep today's behavior (documented asymmetry). Extending the
  gate to auto-detected symbol-first strategy is a separate future decision.
- "Usage cross-check" is defined as: one observed grep whose pattern contains
  the bare symbol name (substring match), or one observed reference search for
  the symbol. Aliased/renamed usages remain outside the parser-free engine's
  documented guarantees.
- The existing confidence-downgrade mechanism ("Model confidence was capped...")
  is reusable for the high→medium cap without contract changes.
- The reproduction fixture can be built deterministically from local files (no
  live model needed) for the indexer measurement (FR-001), while SC-001 uses a
  small number of live runs because exploration is sampled at temperature 1.0.
- Benchmark changes follow the record-only policy (established by spec 021):
  they inform, they never gate.
- The slight turn/token cost increase from the encouraged cross-check is
  acceptable and observable through the effect metrics added by spec 025.
