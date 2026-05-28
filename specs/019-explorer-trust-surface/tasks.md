# Tasks: Explorer Trust and Surface Hygiene

**Input**: Design documents from `/specs/019-explorer-trust-surface/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required. This repository follows TDD for code changes.

**Organization**: Tasks are grouped by user story and ordered so each story can be independently tested.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel when implemented by multiple agents.
- **[Story]**: User story from `spec.md`.
- Exact file paths are included in every task.

## Phase 1: Setup and Contract Baseline

**Purpose**: Establish the Speckit artifacts and identify the public contract surfaces affected by this feature.

- [x] T001 Create feature plan artifacts in `specs/019-explorer-trust-surface/plan.md`, `research.md`, `data-model.md`, `quickstart.md`, and `contracts/`
- [x] T002 Update current Speckit plan pointer in `AGENTS.md`
- [x] T003 [P] Inspect existing schema/runtime/server tests in `tests/critic.test.mjs`, `tests/runtime.mock.test.mjs`, `tests/mcp-server.test.mjs`, `tests/schemas.test.mjs`, `tests/transcript.test.mjs`, and `tests/providers.test.mjs`

---

## Phase 2: Foundational Tests (Blocking)

**Purpose**: Add failing tests before production changes.

**CRITICAL**: Do not edit production source for a behavior until its failing test exists.

- [x] T004 [P] [US1] Add failing evidence exactness tests for grep/blame anchors in `tests/critic.test.mjs`
- [x] T005 [P] [US1] Add failing malformed evidence range tests in `tests/schemas.test.mjs` and `tests/critic.test.mjs`
- [x] T006 [P] [US1] Add failing trust caveat tests for dropped/truncated/budget cases in `tests/runtime.mock.test.mjs`
- [x] T007 [P] [US2] Add failing MCP surface tests for reduced snippet display and Markdown diagnostics separation in `tests/mcp-server.test.mjs`
- [x] T008 [P] [US2] Add failing discovered path omission signal tests in `tests/runtime.mock.test.mjs` and `tests/schemas.test.mjs`
- [x] T009 [P] [US3] Add failing contract tests for `critic.warnings` and required `searchCoverage` in `tests/mcp-server.test.mjs`, `tests/schemas.test.mjs`, and `tests/integrations.test.mjs`
- [x] T010 [P] [US4] Add failing compact transcript diagnostic tests in `tests/transcript.test.mjs` and runtime transcript assertions in `tests/runtime.mock.test.mjs`
- [x] T011 [P] [US4] Add failing failover provider attribution tests in `tests/providers.test.mjs`
- [x] T012 Run targeted red-phase tests with `node --test tests/critic.test.mjs tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs tests/transcript.test.mjs tests/providers.test.mjs`

**Checkpoint**: New tests fail for the expected reasons.

---

## Phase 3: User Story 1 - Trustworthy Evidence Accounting (Priority: P1)

**Goal**: Exact/verified claims reflect only fully observed ranges, and trust summaries include caveats.

**Independent Test**: Targeted critic/schema/runtime tests pass for exactness, malformed ranges, and trust caveats.

- [x] T013 [US1] Update evidence range normalization in `src/explorer/schemas.mjs` so malformed ranges are not coerced to line 1
- [x] T014 [US1] Update grounding validation in `src/explorer/critic.mjs` to drop malformed ranges and count them as dropped evidence
- [x] T015 [US1] Update grep/blame grounding in `src/explorer/critic.mjs` so exact means the claimed range was fully observed
- [x] T016 [US1] Update trust summary caveats in `src/explorer/runtime.mjs` for dropped evidence, tool truncation, and stopped budget
- [x] T017 [US1] Run `node --test tests/critic.test.mjs tests/schemas.test.mjs tests/runtime.mock.test.mjs`

**Checkpoint**: User Story 1 works independently.

---

## Phase 4: User Story 2 - Lean Codex-Facing Result Surface (Priority: P1)

**Goal**: Parent agents receive compact answer content without duplicated snippets or operational metadata as default answer data.

**Independent Test**: MCP server and runtime tests pass for display text, Markdown structured content, discovered path bounds, and ops path formatting.

- [x] T018 [US2] Bound `discoveredPaths` and track omitted candidates in `src/explorer/runtime.mjs`
- [x] T019 [US2] Add `searchCoverage.omittedDiscoveredPaths` schema support in `src/explorer/schemas.mjs`
- [x] T020 [US2] Reduce default snippet duplication and sanitize stderr log paths in `src/mcp/server.mjs`
- [x] T021 [US2] Separate Markdown `explore` answer fields from ops diagnostics in `src/mcp/server.mjs`
- [x] T022 [US2] Run `node --test tests/runtime.mock.test.mjs tests/mcp-server.test.mjs tests/schemas.test.mjs`

**Checkpoint**: User Story 2 works independently.

---

## Phase 5: User Story 3 - Consistent Control-Plane Contract (Priority: P1)

**Goal**: Runtime output, schemas, examples, and docs agree on handoff fields and warning ownership.

**Independent Test**: Schema/server/doc guard tests pass and examples match the new compact contract.

- [x] T023 [US3] Add compact `critic.warnings` output in `src/mcp/server.mjs` and default handled-failure paths
- [x] T024 [US3] Update output schemas in `src/explorer/schemas.mjs` for required `searchCoverage`, `critic`, and discovery omission signaling
- [x] T025 [US3] Update contract docs in `README.md`, `DESIGN.md`, and `examples/expected-response.json`
- [x] T026 [US3] Update integration docs/tests in `tests/integrations.test.mjs` if public contract guard coverage changes
- [x] T027 [US3] Run `node --test tests/mcp-server.test.mjs tests/schemas.test.mjs tests/integrations.test.mjs`

**Checkpoint**: User Story 3 works independently.

---

## Phase 6: User Story 4 - Useful Private Diagnostics (Priority: P2)

**Goal**: Local diagnostics explain tool choices and failover attribution without expanding default answer payloads.

**Independent Test**: Transcript/provider/runtime diagnostics tests pass.

- [x] T028 [US4] Export or add compact diagnostic summary helpers in `src/explorer/transcript.mjs`
- [x] T029 [US4] Record compact redacted tool args/results in runtime transcript records in `src/explorer/runtime.mjs`
- [x] T030 [US4] Attach used provider/model metadata to successful failover completions in `src/explorer/providers/failover.mjs`
- [x] T031 [US4] Propagate used provider/model metadata into runtime stats or transcript diagnostics in `src/explorer/runtime.mjs`
- [x] T032 [US4] Run `node --test tests/transcript.test.mjs tests/runtime.mock.test.mjs tests/providers.test.mjs`

**Checkpoint**: User Story 4 works independently.

---

## Phase 7: Polish and Full Verification

**Purpose**: Validate repository invariants, docs sync, and full test suite.

- [x] T033 [P] Verify `package.json` still has no `dependencies` or `devDependencies`
- [x] T034 [P] Verify public MCP tool count remains eight and `explore_repo` input has no `budget`
- [x] T035 Run `npm test`
- [x] T036 If `CEREBRAS_API_KEY` is present, run `node scripts/integration-test.mjs`; otherwise record why it was skipped
- [x] T037 Review `git diff` for unintended changes and update this task list statuses

---

## Dependencies & Execution Order

- Phase 1 must complete before tests and implementation.
- Phase 2 red tests must be added before source changes for the corresponding behavior.
- US1, US2, and US3 are all P1, but implementation should run US1 first because evidence quality affects contract fields and summaries.
- US4 can follow the P1 contract changes because diagnostics should not expand the public surface.
- Phase 7 requires all desired user stories complete.

## Parallel Opportunities

- T004-T011 can be written in parallel by file.
- T013-T016 are tightly coupled but can be reviewed independently.
- T018-T021 can be split between runtime/schema and server surface work.
- T028-T031 can be split between transcript and provider/runtime work.

## Implementation Strategy

1. Add failing targeted tests.
2. Implement US1 trust fixes and pass targeted tests.
3. Implement US2/US3 public surface and schema/docs alignment.
4. Implement US4 diagnostics.
5. Run full `npm test` and optional integration test when credentials are available.
