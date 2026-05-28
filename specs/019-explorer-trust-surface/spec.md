# Feature Specification: Explorer Trust and Surface Hygiene

**Feature Branch**: `019-explorer-trust-surface`

**Created**: 2026-05-28

**Status**: Draft

**Input**: User description: "각각 수정 방향을 제안받아서 수정을 진행합니다. speckit-workflow를 따라갑니다"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trustworthy Evidence Accounting (Priority: P1)

A parent coding agent receives an exploration result and can trust that "exact", "verified", and "complete" mean the cited evidence was actually inspected at the claimed line range.

**Why this priority**: False exact evidence is the highest-risk failure because it can cause a parent agent to skip follow-up reads and act on unsupported claims.

**Independent Test**: Can be tested by constructing explorer outputs with grep-only, blame-only, malformed, and fully read evidence, then verifying the result downgrades or drops weak evidence while preserving exact status only for truly inspected ranges.

**Acceptance Scenarios**:

1. **Given** an evidence item spans multiple lines but only a single grep or blame line was observed, **When** the result is finalized, **Then** the item is not counted as exact evidence.
2. **Given** an evidence item omits valid line range data, **When** the result is normalized and criticized, **Then** it cannot be silently converted into exact line 1 evidence.
3. **Given** evidence was dropped, truncated, or the exploration stopped after enough evidence, **When** the trust summary is generated, **Then** the summary states the caveat clearly instead of implying all model-proposed evidence was grounded.

---

### User Story 2 - Lean Codex-Facing Result Surface (Priority: P1)

A Codex parent agent receives only the information needed for follow-up decisions, without duplicated snippets, broad repository inventory, or operational metadata that does not help answer the user's task.

**Why this priority**: Reducing unnecessary surface lowers token cost, prompt pollution, and accidental metadata exposure while preserving the control-plane fields required for agent handoff.

**Independent Test**: Can be tested by calling structured and Markdown exploration tools and verifying the response keeps answer, citations, targets, evidence, and required control-plane signals while constraining duplicate text and non-answer diagnostics.

**Acceptance Scenarios**:

1. **Given** a structured exploration result includes evidence snippets, **When** the MCP response is formatted for display, **Then** snippet content is not repeated in full in both display text and structured content by default.
2. **Given** a Markdown exploration result is returned, **When** structured content is emitted, **Then** operational metadata is either omitted from the default parent-agent surface or clearly separated from answer-oriented fields.
3. **Given** broad discovery tools find many paths, **When** discovered paths are surfaced, **Then** the list remains bounded and does not crowd out grounded targets and evidence.
4. **Given** an ops summary is written to stderr, **When** a transcript path exists, **Then** the default line does not expose more local path metadata than is needed to locate the log in normal operation.

---

### User Story 3 - Consistent Control-Plane Contract (Priority: P1)

A parent or sub-agent handoff can preserve the documented control-plane fields without guessing which warnings or coverage indicators are authoritative.

**Why this priority**: Handoff reliability depends on stable fields. Documentation that names absent fields or schemas that understate runtime guarantees cause downstream agents to lose caution signals.

**Independent Test**: Can be tested by comparing the documented handoff field list, runtime output, schemas, and examples, then verifying they agree on where warnings, search coverage, failure, and completion status live.

**Acceptance Scenarios**:

1. **Given** the server instructions list fields to preserve during handoff, **When** a structured exploration result is returned, **Then** every named field is present or the instructions name the actual replacement field.
2. **Given** runtime always emits search coverage, **When** schemas and examples describe the compact contract, **Then** they match that runtime guarantee or explicitly document a compatibility exception.
3. **Given** warning messages come from deterministic review, **When** the result is serialized, **Then** callers can identify the canonical warning location without receiving contradictory or duplicate guidance.

---

### User Story 4 - Useful Private Diagnostics (Priority: P2)

An operator debugging answer quality can inspect opt-in local diagnostics to understand tool choices, fallback provider behavior, and redaction status without expanding the public MCP answer surface.

**Why this priority**: Diagnostics improve reliability work, but they should not become default data handed to Codex unless they are needed for the current answer.

**Independent Test**: Can be tested by enabling transcript logging and provider failover in controlled fixtures, then verifying compact diagnostic summaries are available locally, redacted by default, and accurately identify which provider/model produced the answer.

**Acceptance Scenarios**:

1. **Given** transcript logging is enabled, **When** tools run, **Then** the transcript contains compact redacted argument/result summaries sufficient for debugging answer quality.
2. **Given** raw logging is not enabled, **When** diagnostic summaries mention secret-looking values or secret paths, **Then** those values remain redacted.
3. **Given** failover selects a fallback provider, **When** runtime stats or transcript diagnostics are inspected, **Then** the successful provider/model is not mislabeled as the first configured provider.

### Edge Cases

- A one-line grep or blame hit should remain usable as an anchor but should not prove neighboring unobserved lines exactly.
- Malformed evidence should reduce confidence without discarding the direct answer when other grounded evidence remains.
- Results with many discovered paths should still expose a count or truncation signal so callers know candidates were omitted.
- Compatibility choices should not change the public tool count or reintroduce removed session, budget, or debug fields.
- Redaction must preserve environment variable identifiers as public code interface while masking secret values and secret file paths.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST distinguish exact evidence from single-line anchor evidence so exact status only applies to fully observed line ranges.
- **FR-002**: The system MUST prevent malformed or missing evidence ranges from being silently normalized into exact evidence.
- **FR-003**: The system MUST include caveats in trust summaries when evidence was dropped, tool results were truncated, or completion occurred after budget exhaustion.
- **FR-004**: The system MUST keep required handoff control-plane fields available to parent agents: verification status, completion status, evidence quality, search coverage, failure status, and deterministic warnings.
- **FR-005**: The system MUST make warning ownership unambiguous by documenting and testing the canonical warning field or by exposing the documented warning field.
- **FR-006**: The system MUST reduce duplicated evidence snippet content in default MCP display text while preserving structured evidence for agents that consume it.
- **FR-007**: The system MUST keep broad discovered path output bounded and visibly indicate when candidates were omitted or truncated.
- **FR-008**: The system MUST separate answer-oriented Markdown exploration data from operational diagnostics in the default Codex-facing result surface.
- **FR-009**: The system MUST avoid exposing unnecessary local path detail in default stderr summaries while preserving enough information for operators to locate logs.
- **FR-010**: The system MUST align user-facing documentation with internal-only provider override status so users do not mistake implementation escape hatches for stable public contracts.
- **FR-011**: The system MUST provide opt-in diagnostics that help debug answer quality without exposing raw file content or secrets by default.
- **FR-012**: The system MUST accurately identify the provider/model that successfully produced a response when failover occurs.
- **FR-013**: The system MUST preserve zero runtime dependencies, read-only repository access, secret deny-list enforcement, the fixed eight public tool surface, and the absence of an `explore_repo` budget input.
- **FR-014**: The system MUST keep README, DESIGN, examples, schemas, and integration documentation synchronized for any public contract or user-visible string change.

### Key Entities *(include if feature involves data)*

- **Evidence Item**: A cited file or git-backed range with grounding status, reason, and optional snippet.
- **Warning Signal**: A deterministic caution emitted by the runtime or critic that parent agents must preserve during handoff.
- **Search Coverage**: A compact record of scope, truncation, budget, and search breadth relevant to follow-up trust.
- **Discovered Path**: A non-actionable candidate path found during exploration that may guide later follow-up but is not a grounded target.
- **Operational Diagnostic**: Local opt-in transcript or stderr metadata used for debugging answer quality.
- **Provider Attempt**: A model/provider call attempt and its success/failure outcome during failover.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tests demonstrate that multi-line evidence grounded only by a single grep or blame line is no longer counted as exact.
- **SC-002**: Tests demonstrate that missing, non-integer, or inverted evidence ranges cannot become exact line 1 evidence.
- **SC-003**: Snapshot or integration tests demonstrate that dropped evidence, truncation, or budget caveats appear in trust-facing summaries.
- **SC-004**: Contract tests or doc guards demonstrate that handoff field documentation matches actual structured output.
- **SC-005**: MCP response tests demonstrate reduced duplicate snippet output while structured evidence remains available.
- **SC-006**: Discovery tests demonstrate bounded discovered path output with an omission/truncation signal.
- **SC-007**: Transcript tests demonstrate compact diagnostic records are redacted by default and useful for identifying tool choices.
- **SC-008**: Provider tests demonstrate fallback success is attributed to the provider/model that actually succeeded.
- **SC-009**: Full `npm test` passes with zero failures after code, schema, examples, and documentation updates.

## Assumptions

- Existing research and Claude one-shot feedback are accepted as the decision input for this feature.
- The feature may adjust public response schemas only when required to align already documented control-plane fields.
- Any schema change will be treated as a public contract change and synchronized with README, DESIGN, examples, and tests.
- The implementation should prefer small compatibility-preserving changes before larger redesigns.
