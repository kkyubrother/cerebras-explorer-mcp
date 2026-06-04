# Feature Specification: Report-mode Structured Citations

**Feature Branch**: `002-report-structured-citations`

**Created**: 2026-05-21

**Status**: Implemented

**Input**: User description: "Report-mode 도구(explore, explore_v2)의 출력에 structured citations를 추가한다. 현재 freeExplore/freeExploreV2는 Markdown report 텍스트만 반환하고, 상위 에이전트가 file:line 인용을 얻으려면 정규식으로 다시 파싱해야 한다. critic.mjs에 이미 존재하는 extractReportCitations/extractGitCitations 헬퍼를 재사용해 runtime 반환 객체에 citations[] (type, path, startLine, endLine 등)와 citation-derived targets[]를 추가한다. MCP structuredContent를 통해 상위 에이전트에 노출. 원본 plan은 docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md의 Task 2 섹션. 카테고리: P1. 의존성: Task 3(evidence-preservation benchmark)이 이 spec에 의존함. 변경 파일: src/explorer/runtime.mjs, src/mcp/server.mjs, src/explorer/critic.mjs(선택), tests/free-explore.test.mjs, tests/mcp-server.test.mjs."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upper agent reads file:line citations without re-parsing Markdown (Priority: P1)

When the explorer returns a report-mode response (`explore` or `explore_v2`), the parent agent currently receives only the Markdown report text. To act on the report — open files, jump to lines, schedule follow-up reads — the parent must rerun its own regex over the Markdown, duplicating work that the explorer's critic already does. This story exposes the citations the critic extracted as a structured array on the response so the parent agent reads them directly.

**Why this priority**: The whole purpose of the explorer is to spare the parent agent from context-burning navigation work. As long as the parent must regex-parse the Markdown to follow citations, the explorer's value leaks back into the parent's context budget. Surfacing the extraction the critic has already done is a near-zero-cost win that unlocks every downstream consumer.

**Independent Test**: With a fixture model that produces a Markdown report containing two well-formed citations (e.g., `` `src/auth.js:L1-L3` `` and `` `src/routes/user.js:L2` ``), call the report-mode runtime once and assert the response carries a `citations[]` array whose entries match the cited paths and line ranges, without any regex parsing by the test code.

**Acceptance Scenarios**:

1. **Given** a report-mode tool emits a Markdown report containing one or more file:line references, **When** the upper agent reads the response, **Then** every cited `path` and line range appears as a structured entry in the response's `citations[]` array.
2. **Given** the same response, **When** the upper agent reads the `targets[]` array, **Then** the same cited paths appear as citation-derived targets so a single follow-up step can plan reads from them.
3. **Given** a report with no citations, **When** the upper agent reads the response, **Then** `citations[]` is an empty array (not missing) and `targets[]` carries no citation-derived entries — so the parent can branch on length alone.

---

### User Story 2 - MCP clients receive citations through `structuredContent` (Priority: P1)

When the explorer is consumed over MCP (Claude Code, Codex, Gemini CLI), the parent reads the response as both human-readable `content[0].text` (Markdown) and machine-readable `structuredContent`. The Markdown stays intact, but `structuredContent` today does not carry the report's citations. This story routes the same `citations[]` and citation-derived `targets[]` through `structuredContent` so MCP clients pick them up via the existing transport.

**Why this priority**: Story 1 alone would expose citations only to in-process callers of the runtime. MCP is the explorer's primary delivery channel; without `structuredContent` carrying the data, every MCP-based parent (every shipped integration) keeps regex-parsing. The two stories together are how the win actually reaches users.

**Independent Test**: Invoke `explore` (or `explore_v2`) via the MCP request handler with the same Markdown-citation fixture, then assert that the returned MCP envelope contains the unchanged Markdown in `content[0].text` AND a populated `structuredContent.citations[]` with matching entries.

**Acceptance Scenarios**:

1. **Given** a report-mode MCP call, **When** the parent reads the envelope, **Then** `content[0].text` contains the Markdown report verbatim (no rewriting) and `structuredContent.citations[]` contains the structured entries.
2. **Given** the redaction pipeline already applied to MCP outputs, **When** a citation path contains a deny-listed secret name, **Then** the path is redacted in both Markdown and `structuredContent` in a consistent way (same string in both surfaces).
3. **Given** an empty-citation report, **When** the parent reads the envelope, **Then** `structuredContent.citations` is `[]` and not absent.

---

### Edge Cases

- A citation spans a single line (`L2` rather than `L1-L3`). The structured entry must record `startLine === endLine` rather than dropping one of the fields.
- A citation uses backticks vs no backticks vs inline-code variants. The structured output must match whatever the critic's existing extractors already accept; behavior changes to the extractors are explicitly out of scope.
- The model emits a citation to a path the runtime cannot read (denied by the secret deny-list or outside the allowed root). The Markdown remains unchanged but the corresponding structured citation must be redacted or omitted to match the deny-list policy applied elsewhere.
- The report mentions a path multiple times. Each distinct citation appears as its own structured entry; downstream `targets[]` derivation deduplicates by `(path, startLine, endLine)` so the parent does not read the same range twice.
- The model emits a git-style citation (`commit SHA`, branch ref) rather than a file:line citation. The existing git citation extractor's output flows through under its own `type` value so consumers can distinguish file ranges from git references.
- A backwards-compatible consumer that ignored the new fields continues to work — no existing field is renamed or removed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The report-mode runtime MUST attach a `citations[]` array to the response object whenever the Markdown report contains one or more file:line or git citations the existing critic extractors recognize.
- **FR-002**: Each `citations[]` entry MUST carry a stable shape: a `type` discriminating file ranges from git references, a `path` (when applicable), and `startLine`/`endLine` integers when the citation names a range.
- **FR-003**: The report-mode runtime MUST also attach a `targets[]` array derived from the citations, where each entry carries the same `path`/`startLine`/`endLine` plus a `role` indicating it came from a report citation (so report `targets[]` are distinguishable from `explore_repo`'s compact `targets[]`).
- **FR-004**: The MCP request handler MUST propagate `citations[]` and citation-derived `targets[]` into `structuredContent` for both `explore` and `explore_v2` responses, without altering the existing Markdown returned in `content[0].text`.
- **FR-005**: When the report contains zero citations, both `citations[]` and the citation-derived portion of `targets[]` MUST be present and empty, never absent.
- **FR-006**: The same redaction pipeline applied to other MCP outputs MUST apply to citation paths so deny-listed paths never leak into either Markdown or `structuredContent`.
- **FR-007**: The runtime MUST reuse the existing report and git citation extractors that the critic uses; behavior of those extractors is out of scope. Only their output normalization for the public response shape is in scope.
- **FR-008**: An upper agent able to read either the structured response or the MCP `structuredContent` MUST be able to enumerate every cited file range without parsing the Markdown.

### Key Entities *(include if feature involves data)*

- **Citation**: A normalized record of one file:line or git reference the critic extracted from the report Markdown. Carries `type`, `path`, and line range when applicable.
- **Citation-derived target**: A `targets[]` entry whose source is a report citation rather than a model-emitted compact result. Carries the same locator fields plus a `role` marker so consumers can distinguish citation-driven targets from compact-tool targets.
- **Report response**: The runtime return shape for `explore` / `explore_v2` consumed both in-process and via MCP `structuredContent`; gains `citations[]` and citation-derived `targets[]` additively.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of report-mode responses for fixtures whose Markdown contains at least one well-formed citation expose every citation in `citations[]` and in `targets[]`, verified by a regression that compares the structured arrays against the citations the critic already extracts.
- **SC-002**: A parent agent reading the MCP envelope can list every cited file range using only `structuredContent.citations` (no Markdown regex), verified by a test that consumes the envelope through the documented MCP shape.
- **SC-003**: Reports with zero citations return `citations: []` (not `undefined`/absent) and emit no citation-derived `targets[]` entries, verified by a fixture that produces no citations.
- **SC-004**: The Markdown returned in `content[0].text` for an MCP call before and after this change is byte-identical for the same model output, verified by a snapshot equality check.

## Assumptions

- The existing critic citation extractors (`extractReportCitations`, `extractGitCitations`) produce the shape this spec needs and remain the single source of citation truth; this feature only normalizes their output for public consumption.
- The compact `explore_repo` contract is untouched. Its `targets[]` continues to come from the compact JSON the model emits, not from Markdown citations. Only the report-mode `targets[]` carries the new citation-derived role.
- Redaction, gzip, and transcript-recording behavior already applied to MCP outputs continues to apply uniformly to the new fields with no special-casing.
- Task 3 (Evidence Preservation Benchmark Coverage) consumes `citations[]` as a direct input. This spec deliberately surfaces the array in a shape Task 3's benchmark checks can read without further transformation.
- Public integrations (Codex, Gemini CLI, Continue, Cursor, OpenCode, Claude Code, Claude Desktop) do not advertise `structuredContent.citations` today, so no documented contract is broken by introducing the field; documentation updates are tracked under Task 9, not here.
