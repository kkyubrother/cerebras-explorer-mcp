# Feature Specification: V2 Truncation Trust Wording

**Feature Branch**: `001-v2-truncation-trust-wording`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "V2 truncation trust wording 수정. src/explorer/runtime.mjs의 applyToolResultCharBudget()이 현재 'Full data was inspected; key content preserved above'라는 잘못된 신뢰 메시지를 반환하는데, 실제로는 데이터가 잘려서 모델에 전달됨. 이를 TRUNCATED_TOOL_RESULT_MARKER 상수를 도입해 'Result was truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing'로 교체하고, buildSearchCoverage의 truncation warning도 동일하게 강화한다. 원본 plan은 docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md의 Task 1 섹션(라인 53~195) 참조. 카테고리: P0. 변경 파일: src/explorer/runtime.mjs, tests/runtime.mock.test.mjs."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Honest truncation signal to the model (Priority: P1)

When the explorer runtime feeds a tool result back into the model after applying a character budget, the appended message currently asserts that the full data was inspected and the key content was preserved above. In reality the runtime sliced the serialized result and discarded the tail. The model uses that wording as a trust signal and can over-rely on the truncated evidence, producing reports that claim coverage the runtime never delivered. This story replaces the message with an honest statement that the result was truncated before model synthesis.

**Why this priority**: This is the only direct trust failure in the explorer surface. Every other coverage signal downstream (status verification, evidence quality, search coverage warnings) is interpreted in context of the same tool-result envelope. As long as the appended marker lies, every higher-level signal inherits that lie. The fix is small but unlocks correctness for the V2 finalization story.

**Independent Test**: With a fixture that intentionally produces a tool result larger than the per-tool character budget, capture the second-turn message stream the model sees and assert that the appended marker says the result was truncated before model synthesis (and does not claim full inspection). This can be validated in isolation from any other coverage or routing work.

**Acceptance Scenarios**:

1. **Given** a tool returns a serialized payload larger than its assigned budget, **When** the runtime forwards that result back into the model, **Then** the appended marker explicitly states that the result was truncated before model synthesis.
2. **Given** the same truncation event, **When** an observer inspects the appended marker, **Then** no phrase that implies "full data was inspected" or "key content preserved above" appears anywhere in the appended marker.
3. **Given** a tool result that fits within its budget, **When** the runtime forwards it, **Then** no truncation marker is appended and the result is delivered verbatim.

---

### User Story 2 - Actionable recovery guidance for the upper agent (Priority: P1)

The parent agent (Claude Code, Codex, Gemini CLI) that consumes the explorer report needs to know not just that something was truncated but also what to do about it. Today the truncation message tells the model nothing about recovery, and the surrounding `searchCoverage.warnings` array only counts how many tool results were truncated without saying how to make up for the missing evidence. This story makes the recovery action explicit in both the tool-result marker and the search coverage warning.

**Why this priority**: The runtime's compact contract has positioned `searchCoverage.warnings` as the place the upper agent looks when the explorer is uncertain. If a warning says "N tool result(s) truncated" but offers no remediation, the upper agent either ignores the warning or burns its own context re-exploring. Either outcome erodes the value of the explorer.

**Independent Test**: With the same truncation fixture, assert that the resulting `searchCoverage.warnings` array contains a warning whose text instructs the upper agent to re-run with a narrower query or read specific ranges if expected evidence is missing. The text-match test does not depend on any other Task 1 change.

**Acceptance Scenarios**:

1. **Given** at least one tool result was truncated during exploration, **When** the upper agent reads `searchCoverage.warnings`, **Then** the warning text names the remediation (narrower query or specific range read) needed to recover missing evidence.
2. **Given** no tool results were truncated, **When** the upper agent reads `searchCoverage.warnings`, **Then** no truncation-related warning is present.
3. **Given** the appended tool-result marker, **When** the model reads it, **Then** the marker itself echoes the same recovery guidance so the model can act on it without consulting `searchCoverage`.

---

### Edge Cases

- What happens when the serialized payload exceeds the budget by only a few characters? The truncation marker must still be appended and counted, so the upper agent never has to guess whether near-budget responses are complete.
- What happens when multiple tool calls in the same exploration trip the budget? The runtime should record one truncation count per affected tool result, and the warning text should pluralize the count truthfully.
- What happens when the tool result is itself an error message? The budget should not be applied to error envelopes that are already small; if it must be truncated, the marker rules still apply.
- What happens to existing transcripts produced before this change? The old "Full data was inspected" phrase must not leak back through any caching layer or recorded transcript replay; downstream tests should verify it is absent from current outputs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The runtime MUST replace any "Full data was inspected; key content preserved above" wording in tool-result truncation envelopes with text that states the result was truncated before model synthesis.
- **FR-002**: The truncation envelope MUST include explicit recovery guidance directing the consumer to re-run with a narrower query or read specific ranges when expected evidence is missing.
- **FR-003**: The truncation envelope MUST carry a stable, machine-detectable marker so downstream counters (`toolResultsTruncated`) can rely on a single source of truth instead of substring matching against a hand-written prefix.
- **FR-004**: When at least one tool result is truncated during an exploration session, the search-coverage warning surface MUST emit a warning whose text matches the same recovery guidance as the envelope (re-run with a narrower query or read specific ranges).
- **FR-005**: When no tool result is truncated, the search-coverage warning surface MUST NOT emit a truncation warning.
- **FR-006**: The runtime MUST preserve the original truncation accounting fields (`stats.toolResultsTruncated` and equivalents in `searchCoverage`) so existing benchmarks and tests that read those counts continue to work.
- **FR-007**: Any regression test that previously asserted the legacy "Full data was inspected" wording MUST be updated, and a new regression test MUST assert the corrected wording in the tool-result envelope and the search-coverage warning together.

### Key Entities *(include if feature involves data)*

- **Tool-result envelope**: The string the runtime hands back to the model after applying its character budget. Currently carries a misleading "full data inspected" suffix; will carry an honest truncation marker plus recovery guidance.
- **Search-coverage warnings**: A surface-level list of warnings exposed in the compact contract that the upper agent reads to calibrate trust; one of its emitted warnings concerns truncation and must align with the envelope wording.
- **Truncation marker**: A canonical, machine-detectable token embedded in the envelope to drive accurate counting; replaces the current heuristic that scans for the substring `[truncated:`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of tool-result truncation envelopes produced by the runtime contain the honest truncation marker and recovery guidance; 0% contain the legacy "Full data was inspected" wording. Verified by an automated regression that sweeps both the envelope and the search-coverage warning text.
- **SC-002**: When the runtime truncates any tool result, the search-coverage warning surface returns at least one warning whose recovery guidance matches the envelope wording, verified by a single test fixture that triggers truncation and inspects both surfaces in one assertion block.
- **SC-003**: The truncation counter (`toolResultsTruncated`) continues to match the count of truncated envelopes after the marker is introduced, verified by a test that intentionally truncates N envelopes and asserts the counter equals N.
- **SC-004**: A consumer reading either the envelope or the warning text can name the remediation action (narrower query or specific range read) without inspecting any other field, verified by the wording itself stating the two remediation options.

## Assumptions

- The compact result contract (status, evidence, searchCoverage, etc.) does not need new top-level fields for this change; only the text of one envelope and one warning, plus an internal marker constant, are modified.
- Existing per-tool character budgets remain unchanged. This feature is about honest reporting of an already-occurring truncation, not about lifting the budget.
- Parent agents do not parse the legacy wording programmatically; the legacy phrasing was treated as advisory prose, so wording changes do not break any documented public contract.
- The change applies uniformly to V1 (`freeExplore`) and V2 (`freeExploreV2`) runtimes because both share the same `applyToolResultCharBudget` helper.
- Pre-existing redaction, gzip, and transcript-recording behavior over the truncated envelope continues to function; the new marker is plain text and does not interact with binary or compressed payloads.
