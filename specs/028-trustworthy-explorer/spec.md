# Feature Specification: Trustworthy, Quiet Explorer Handoff

**Feature Branch**: `028-trustworthy-explorer`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "Make the explorer trustworthy above all else, quiet for parent agents, internally sub-goal driven, minimal in its parent-facing output, and smaller in public tool surface. Remove the unused internal budget abstraction as well as public budget choices. Validate goals before pursuing them, and handle wrong, impossible, or unachieved goals honestly without pointless retries. Cerebras Code Plan makes cost a non-goal."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete or Honest Answers (Priority: P1)

A parent agent delegates a multi-part repository question and receives an answer that is complete only when every required part of the request has adequate supporting evidence. If any required part cannot be established, the explorer names only the unresolved part and does not present the whole request as verified.

**Why this priority**: The explorer's primary value depends on the parent being able to trust its completion signal. A compact but overconfident answer causes more harm than an explicitly incomplete answer.

**Independent Test**: Run known-answer tasks containing several independently checkable requirements, including the previously observed large-repository route mismatch, route-specific authorization differences, missing implementation questions, and repeated small-repository runs. The story passes when every required part is either supported or surfaced as an unresolved gap and no incomplete result is labeled complete.

**Acceptance Scenarios**:

1. **Given** a request with several required questions, **When** the explorer finds evidence for only some questions, **Then** it returns the supported answer, identifies the minimum unresolved gaps, and marks the result as needing further verification.
2. **Given** all required questions have sufficient evidence, **When** the explorer finishes, **Then** it returns a complete result with no unnecessary warnings or diagnostic detail.
3. **Given** an observed source range does not semantically support a proposed claim, **When** the result is verified, **Then** that claim is removed, corrected, or explicitly marked unsupported rather than being presented as exact evidence.
4. **Given** two repository paths implement different policies, **When** the explorer summarizes the policy, **Then** it preserves the distinction and does not generalize one path's behavior to all paths.

---

### User Story 2 - Quiet Parent Handoff (Priority: P2)

A parent agent receives only the direct answer, the current action state, and the smallest set of actionable targets and cited evidence needed to use or verify the answer. Internal planning, search statistics, candidate paths, critic diagnostics, and successful sub-goal details remain available in operational logs without appearing in the normal parent-facing result.

**Why this priority**: Extra fields and repeated trust summaries increase parent cognitive load and make correct tool use less likely. Quiet results make the tool easier to adopt and harder to misuse.

**Independent Test**: Compare successful, incomplete, and failed responses against the minimum information each parent needs. A successful response must not contain fields that do not change the parent's next action; incomplete and failed responses may add only the gap or retry information required to proceed.

**Acceptance Scenarios**:

1. **Given** a fully supported answer, **When** the parent receives the result, **Then** it sees one unambiguous completion state, the answer, and only the targets and evidence required by that answer.
2. **Given** no follow-up is required, **When** the result is complete, **Then** candidate inventories, search counters, critic pass details, sub-goal ledgers, token usage, and empty warning collections are absent from the parent-facing payload.
3. **Given** a required sub-goal remains unresolved, **When** the result is returned, **Then** only that gap and, when materially useful, at most one narrow follow-up action are added to the normal payload.
4. **Given** an operator needs full diagnostics, **When** logging is enabled, **Then** the detailed sub-goal, search, critic, truncation, timing, and usage information remains available outside the parent-facing answer.

---

### User Story 3 - Valid Goals and Honest Blockers (Priority: P1)

A parent agent can trust that the explorer pursues only goals required by the delegated request. Before repository exploration, proposed goals are checked for request traceability, independent observability, scope and capability feasibility, consistency, and useful granularity. A planner-invented or malformed goal is removed or repaired internally; a user-required goal that cannot be established remains visible only as a concise, accurately classified gap.

**Why this priority**: A perfect verifier cannot rescue a plan that asks the wrong question. Pursuing invented, contradictory, or statically impossible goals wastes work and can turn an otherwise useful answer into a misleading completion or noisy failure.

**Independent Test**: Run fixtures containing a planner-invented goal, a goal that is too broad, a goal outside hard scope, a request requiring live runtime state unavailable to a read-only static explorer, contradictory requirements, missing caller input, and a feasible goal that simply remains unsupported. The story passes when the explorer revises the plan at most once, never exposes rejected internal goals, does not retry known-impossible work, and returns each user-required blocker as `incomplete` rather than an execution failure.

**Acceptance Scenarios**:

1. **Given** the planner proposes a goal not traceable to any part of the original request, **When** the plan is audited, **Then** that goal is rejected, logged internally, and neither blocks completion nor appears in the parent handoff.
2. **Given** a required goal is too broad to have one observable proof condition, **When** the plan is audited, **Then** it is decomposed into independently verifiable goals before exploration.
3. **Given** the initial plan omits an explicit requested part, **When** coverage validation detects the omission, **Then** the missing part becomes a required goal through at most one plan revision.
4. **Given** a user-required goal needs evidence outside hard scope, unavailable live state, a write operation, missing caller input, or mutually contradictory conditions, **When** feasibility is assessed, **Then** the goal remains required, prevents completion, and becomes a concise gap with the exact blocker.
5. **Given** every requested goal is presently infeasible, **When** planning finishes, **Then** the explorer returns `incomplete` with no invented partial answer, no execution-failure label, and at most one useful next action.
6. **Given** a goal is feasible but still unsupported after the single repair round, **When** state is reduced, **Then** supported facts remain usable and the unmet goal is returned as an evidence gap without another planning or repair loop.
7. **Given** the caller's premise appears false but can be checked through repository evidence or certified bounded absence, **When** goals are audited, **Then** the goal remains feasible and may complete with a supported refutation rather than being mislabeled impossible.

---

### User Story 4 - Small, Distinct Tool Surface (Priority: P3)

A parent agent chooses among a small set of clearly distinct explorer intents without deciding runtime budgets or understanding internal exploration strategies. Redundant or rarely useful public tools are removed instead of being kept as aliases, and ambiguous tasks always have one obvious general fallback.

**Why this priority**: Every public tool adds selection burden. The surface should contain only intents that materially improve task framing, verification policy, or result quality.

**Independent Test**: Present representative locate, symbol trace, change impact, code-path, evidence verification, change-review, and narrative-report tasks. Each retained tool must have an independently testable task for which it is meaningfully better than the fallback. Any tool without such a task must be removed or folded into the fallback.

**Acceptance Scenarios**:

1. **Given** a common repository question, **When** the parent considers the tool list, **Then** one specialized intent or the general fallback is clearly appropriate without needing extra configuration choices.
2. **Given** two public tools produce the same exploration policy and parent outcome, **When** the surface is reviewed, **Then** only one remains public.
3. **Given** a proposed new public tool, **When** it lacks observed adoption evidence and a distinct verification policy, **Then** it is not added.
4. **Given** any retained public tool, **When** it is invoked without advanced options, **Then** it internally selects the necessary effort and never asks the parent to choose a budget.

---

### User Story 5 - Trustworthy Negative and Critical Claims (Priority: P4)

A parent agent can distinguish a positively observed fact from a bounded statement that something was not found. Absence, security, authorization, and edit-impact conclusions are never stronger than the inspected scope and search coverage justify.

**Why this priority**: Negative claims and critical policy conclusions are the cases where a plausible but incomplete explorer answer is most likely to mislead the parent.

**Independent Test**: Run tasks that ask whether a route, rewrite, callsite, permission check, or model definition exists. The story passes when every negative result names its inspected boundary and incomplete enumeration can never produce an unqualified repository-wide absence claim.

**Acceptance Scenarios**:

1. **Given** a scope-limited search, **When** no match is found, **Then** the answer states that the item was not found within that scope rather than claiming repository-wide absence.
2. **Given** repository enumeration or tool output was bounded or truncated, **When** a negative claim is requested, **Then** the result remains incomplete or narrows the claim to the inspected boundary.
3. **Given** a security or authorization conclusion differs across routes, **When** the explorer answers, **Then** it lists the distinct enforcement paths needed for the conclusion.

### Edge Cases

- The request contains both a simple lookup and a broad architectural question.
- The parent's scope excludes a file required by one internal sub-goal.
- The repository is larger than the explorer can enumerate completely in one call.
- Tool output is truncated after enough positive evidence exists but before an absence claim is established.
- The model proposes evidence whose path and line range were observed but whose content does not support the stated reason.
- Two sources contradict each other or current code contradicts documentation.
- A repeated identical request finds a different but still valid evidence set.
- Exploration is cancelled, the provider fails, or no grounded evidence is retained.
- A task implies editing, but no adequately supported edit target is found.
- Logging is disabled and the parent must still receive a sufficient minimal failure or gap explanation.
- The planner invents a useful-sounding goal that the parent did not request.
- A proposed goal is circular, too broad, contradictory, or has no independently observable completion condition.
- A required answer depends on a running service, private external system, or mutable state that repository evidence cannot establish.
- The hard scope excludes required evidence, and widening scope would require new parent authority.
- All requested goals are infeasible before any repository search is useful.
- The requested symbol or behavior does not exist, but a bounded search can establish that negative result.
- A fixed safety or context limit is reached after partial supported evidence has been collected.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The explorer MUST identify the required internal sub-goals of each request before declaring the request complete.
- **FR-002**: Internal sub-goals MUST preserve every explicit user constraint, requested comparison, requested boundary, and requested output distinction.
- **FR-003**: Every required sub-goal MUST have a defined evidence condition appropriate to the kind of claim being made.
- **FR-004**: A result MUST be complete only when every required sub-goal is supported; evidence quantity alone MUST NOT establish completion.
- **FR-005**: An unresolved required sub-goal MUST be returned as a concise gap, MAY include at most one narrow follow-up action when it can materially change the result, and MUST prevent a complete result.
- **FR-006**: Every parent-facing claim MUST be supported by evidence whose content, path, and range are relevant to that claim.
- **FR-007**: Unsupported, contradictory, or over-generalized claims MUST be removed, narrowed, or exposed as gaps before the result reaches the parent.
- **FR-008**: Repository-wide negative claims MUST require evidence that the relevant search boundary was fully inspected; otherwise the claim MUST be explicitly bounded or incomplete.
- **FR-009**: Scope, truncation, cancellation, provider failure, and incomplete enumeration MUST limit completion and claim strength consistently.
- **FR-010**: The parent MUST NOT be asked to choose a runtime budget, internal strategy, turn count, or search depth for normal use.
- **FR-011**: Internal search selection and ordering MAY adapt to the task, repository, and sub-goal state without changing fixed safety limits or adding configuration choices.
- **FR-012**: A successful parent-facing result MUST contain only a version identifier, a direct answer, one action-oriented result state, and the minimum actionable targets and cited evidence needed for that answer.
- **FR-013**: Optional parent-facing fields MUST be omitted when empty or when they do not alter the parent's next action.
- **FR-014**: Detailed sub-goal state, search counters, candidate inventories, critic diagnostics, usage, timing, and successful internal checks MUST be kept outside the normal parent-facing answer and MAY be retained in operational logs.
- **FR-015**: Model self-confidence and verbose trust summaries MUST NOT be shown to the parent unless they change the required parent action.
- **FR-016**: The public tool surface MUST contain no more than six tools, and every retained specialized tool MUST have a distinct user intent and verification policy that cannot be represented equally well by the general fallback.
- **FR-017**: No new public tool MAY be added without observed usage evidence, an independently testable parent scenario, and a distinct verification policy.
- **FR-018**: Redundant or low-value public tools MUST be removed cleanly rather than retained indefinitely as aliases.
- **FR-019**: The general structured explorer MUST remain the obvious fallback when no specialized intent clearly fits.
- **FR-020**: Removing or changing a public tool or parent-facing field MUST include synchronized client guidance, examples, migration notes, and regression guards.
- **FR-021**: Existing read-only filesystem access, hard scope boundaries, cancellation behavior, secret deny-list, and redaction protections MUST remain active.
- **FR-022**: A cancelled or failed exploration MUST return an honest non-complete state and only the retry or recovery information needed by the parent.
- **FR-023**: Repeated runs MAY select different valid evidence, but they MUST agree on required sub-goal coverage and MUST NOT alternate between complete and incomplete solely because optional evidence differs.
- **FR-024**: Trustworthiness MUST be evaluated on multiple real repositories and languages using independently checked known-answer tasks, including large-repository, authorization, negative-claim, and repeated-run scenarios.
- **FR-025**: Cost and token usage MUST remain observable for operators but MUST NOT be an acceptance gate for this feature.
- **FR-026**: Every proposed internal goal MUST be traceable to one or more explicit parts of the original request and MUST state an independently observable evidence condition.
- **FR-027**: Before exploration, the explorer MUST validate proposed goals for request coverage, scope and read-only capability feasibility, observability, consistency, and independently verifiable granularity.
- **FR-028**: A planner-, explorer-, or verifier-invented, duplicate, circular, or otherwise untraceable goal MUST pass the same goal audit, be rejected or merged when invalid, be logged internally, and MUST NOT block completion or appear in the parent-facing result.
- **FR-029**: A goal that is valid but too broad MUST be decomposed, an explicit requested part omitted by the initial plan MUST be inserted as a required goal, and strict one-way containment between same-type auditor-confirmed origin signatures MUST be refined into uniquely reconciled descendants, through at most one bounded plan revision.
- **FR-030**: The explorer MUST NOT recursively re-plan. After one plan revision, every remaining uncovered, undecomposable, or ambiguously refined requested part MUST be materialized as a blocked required goal and honest gap rather than remain a diagnostic or trigger another planning loop.
- **FR-031**: A user-required goal blocked by hard scope, read-only capability, unavailable external or live state, missing caller input, contradiction, or lack of an observable proof condition MUST remain required and MUST prevent a complete result.
- **FR-032**: A user-required but presently infeasible or unsupported goal MUST produce an `incomplete` result, not `failed`; `failed` MUST be reserved for invalid invocation, cancellation, provider, tool, verifier, or internal execution faults.
- **FR-033**: The parent-facing gap MUST derive its question from confirmed original-request slices and state only the requested part and action-relevant blocker. It MUST NOT expose model-authored goal/audit wording, audit bindings, rejected internal goals, planning history, feasibility scores, or repeated diagnostic explanations.
- **FR-034**: A goal known to be infeasible under the current authority and boundary MUST NOT enter the repair round. Repair is permitted only for feasible evidence gaps that one narrow query or small targeted batch can plausibly close. After repair, the parent MUST NOT be offered the same normalized tool/action again for the same gap unless materially new input, authority, or external evidence is required.
- **FR-035**: The implementation MUST remove the internal budget abstraction, budget labels, budget-derived completion logic, and operator effort-tuning controls. Fixed, non-configurable safety and context limits MAY remain only to protect process health and provider constraints.
- **FR-036**: Reaching a fixed safety or context limit MUST be recorded operationally and MUST produce an `incomplete` limit gap only when a valid partial execution leaves affected goals unproven; it MUST NOT become a budget choice or completion shortcut. If a provider output cap leaves a required planner, auditor, verifier, or final control response invalid after bounded recovery, the result MUST instead be `failed`.

### Key Entities

- **Required Sub-goal**: One independently verifiable part of the parent request, including its importance, claim type, evidence condition, and current completion state.
- **Supported Claim**: A concise affirmed or refuted answer statement linked to relevant observed evidence and to the sub-goal it satisfies. A contradicted candidate is not a completed goal unless a separate supported refutation establishes the resolution.
- **Coverage Gap**: A required sub-goal that is missing, contradicted, scope-blocked, truncated, or otherwise insufficiently supported, plus the narrowest useful follow-up.
- **Parent Handoff**: The minimal normal result consumed by the parent agent: direct answer, action state, required targets, and cited evidence, with gaps or failure information only when applicable.
- **Operational Trace**: Non-parent-facing diagnostic information such as sub-goal history, tool calls, candidate paths, critic detail, timing, and usage.
- **Public Tool Intent**: A parent-recognizable task category retained only when it produces a distinct internal policy or verification outcome.
- **Goal Audit**: The internal pre-execution decision that accepts, decomposes, merges, rejects, or classifies each proposed goal using the original request and a fixed explorer capability manifest.
- **Goal Blocker**: An action-relevant reason a valid user-required goal cannot currently be proven, such as hard scope, missing input, unavailable external state, contradiction, or missing evidence.
- **Safety Limit**: A fixed process/context/provider ceiling used only to prevent runaway or invalid execution. It is not an effort policy, completion criterion, or parent configuration surface.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the known-answer regression suite, 100% of results with at least one unresolved required sub-goal are returned as non-complete.
- **SC-002**: The regression suite contains zero parent-facing claims whose cited content does not support the claim's stated reason.
- **SC-003**: The previously observed large-repository route mismatch, route-specific authorization divergence, deny-list count error, unsupported external-process inference, and repeated-run missing-test cases are all either answered correctly or surfaced as explicit gaps.
- **SC-004**: 100% of repository-wide negative claims either demonstrate complete relevant coverage or state the exact boundary within which no match was found.
- **SC-005**: A normal successful handoff exposes no empty collections, candidate inventories, search counters, critic internals, sub-goal ledgers, usage statistics, or redundant confidence summaries.
- **SC-006**: The median parent-facing payload across the adoption and cross-repository suites is at least 40% smaller than the current compact contract while preserving all information required for the parent's next action.
- **SC-007**: The public MCP surface contains at most six tools, no new tools, and every retained tool passes at least one distinct parent-intent acceptance scenario.
- **SC-008**: In parent-agent observation tests, at least 90% of known-answer tasks finish without a broad native re-search after explorer handoff; critical verification is limited to the cited targets.
- **SC-009**: Repeated identical requests agree on required sub-goal completion state in 100% of regression runs, even when their optional evidence sets differ.
- **SC-010**: Cancellation, provider failure, scope limitation, and incomplete enumeration scenarios produce the correct non-complete or bounded outcome in 100% of tests.
- **SC-011**: No normal parent workflow requires a budget, strategy, turn-count, or depth decision.
- **SC-012**: All existing read-only, scope, cancellation, deny-list, redaction, and zero-runtime-dependency guards remain green.
- **SC-013**: Active source, schemas, prompts, metrics, and operator configuration contain no internal budget label, budget configuration object, budget-derived completion branch, or budget effort-tuning control; historical migration text and negative regression guards are the only permitted exceptions.
- **SC-014**: In wrong-goal and feasibility fixtures, 100% of planner- and verifier-proposed goals receive the expected accept, decompose, merge, reject, or blocker outcome, with no second plan revision and no unaudited late goal registration.
- **SC-015**: Planner-invented or rejected goals appear in 0% of parent-facing payloads and prevent completion in 0% of otherwise complete tasks.
- **SC-016**: Scope-blocked, capability-blocked, external-state, missing-input, contradictory, unverifiable, valid-partial safety-limit, and post-repair unsupported cases produce the expected `incomplete` gap rather than `failed` or a pointless repair in 100% of tests; invalid required control output produces `failed`, and no post-repair follow-up repeats an equivalent attempted action.

## Assumptions

- Cerebras Code Plan makes inference cost a non-goal for acceptance; usage remains logged for operational awareness.
- The default environment is approved for provider egress under Cerebras ZDR. Existing secret protections remain project invariants but are not the focus of this feature.
- A clean breaking change to the pre-1.0 public surface is acceptable when accompanied by synchronized migration documentation and tests.
- Parent agents benefit more from one calibrated action state than from several overlapping confidence, quality, warning, and next-action summaries.
- Full internal diagnostics remain useful to maintainers and evaluators even when removed from the parent-facing payload.
- The public budget input remains removed, and the internal budget abstraction is removed with it. Static safety/context limits remain necessary because model context, provider output, filesystem traversal, and process execution are physically bounded.
- Goal feasibility is assessed only against the explorer's present read-only/static capabilities, effective scope, available inputs, and observable repository evidence. It is not a claim that the user's broader real-world objective is impossible.
- One plan revision and one later repair round are separate fixed workflow stages; neither is parent-configurable or recursively repeated.
- This feature creates no write-back capability and does not change the explorer's read-only mission.
