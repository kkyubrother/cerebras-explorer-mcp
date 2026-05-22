# Tasks: 도구 표면 단순화와 옵션 정리

**Input**: Design documents from `./specs/011-consolidate-surface/`

**Prerequisites**: spec.md (필수), plan.md (필수), research.md, data-model.md, contracts/explore-repo-and-explore-response.md, quickstart.md

**Tests**: Required. 본 작업은 두 가지 breaking change를 포함하므로 회귀 무결 검증이 핵심. 신규 테스트는 surface 고정과 budget 입력 거부에 집중하고, 010 옵트인 케이스(legacy targets / auto session)는 삭제 또는 갱신한다.

**Organization**: spec.md user story 우선순위 순(P1 → P3)으로 Phase 구성. 코드 변경이 같은 파일에 집중되므로 user story 사이에 순서 의존이 강하다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 손대는 독립 작업
- **[Story]**: US1=explore 단일화, US2=budget 제거, US3=envvar 10개 제거

---

## Phase 1: Setup

- [ ] T001 작업 트리(`src/`, `tests/`, README/DESIGN/AGENTS/CHANGELOG, integrations/) clean 상태 확인. 본 작업 영역이 plan.md "Project Structure"에 한정되는지 점검.
- [ ] T002 baseline `npm test` 0 failure 확인(010 머지 직후 master 기준 378 tests, 375 pass, 0 fail, 3 skip 예상).

**Checkpoint**: baseline green.

---

## Phase 2: Foundational

> 본 phase에는 추가 task가 없다. user story들이 같은 파일을 손대므로 직렬화가 더 안전하지만, Spec-1/Spec-2/Spec-3 사이의 공유 사전 작업은 없다.

---

## Phase 3: User Story 1 — `explore`/`explore_v2` 단일화 (P1)

**Goal**: V1 explore 코드 제거, V2가 단일 `explore` backend가 됨. 도구 surface 8개 고정 (FR-001 ~ FR-005, SC-001 ~ SC-002).

**Independent Test**: spec.md US1 acceptance scenarios 4개.

### Tests for User Story 1

- [ ] T003 [P] [US1] `tests/mcp-server.test.mjs`에 신규 케이스 추가: `tools/list` 응답이 항상 8개를 반환하고, `ENABLE_EXPLORE_V2=true`/`EXTRA_TOOLS=false`/`ENABLE_EXPLORE=false` 어떤 환경에서도 결과가 동일해야 함. `explore_v2` 이름이 응답에 0건 등장.
- [ ] T004 [P] [US1] 같은 파일의 `MCP request handler exposes explore_v2 only when explicitly enabled` 케이스 제거(010 시점에 만들어진 분기 검증, 더 이상 의미 없음).
- [ ] T005 [P] [US1] `tests/runtime.mock.test.mjs`의 freeExplore 시나리오 중 V1 전용 동작(예: V1 finalize 경로, V1만 갖던 token budget 보호 가정)을 검토 — V2 동작으로 일관되게 통과하는지 확인. 필요 시 기대값 갱신.

### Implementation for User Story 1

- [ ] T006 [US1] `src/mcp/server.mjs`에서 `EXPLORE_V2_TOOL` 도구 정의 제거. `buildToolList()`의 `if (exploreV2ToolEnabled())` 분기 제거.
- [ ] T007 [US1] `src/mcp/server.mjs/callFreeExploreTool()`에서 `shouldUseV2ForExplore()` 라우터 호출 제거. 항상 `freeExploreRepositoryV2`(또는 그 후속 이름)를 호출하도록 단순화.
- [ ] T008 [US1] `src/mcp/server.mjs`의 `tools/call` handler에서 `explore_v2` 분기 제거.
- [ ] T009 [US1] `src/explorer/runtime.mjs`에서 V1 `freeExplore` 메서드 본문을 `freeExploreV2`의 본문으로 대체(또는 `freeExploreV2`를 `freeExplore`로 rename하고 V1 함수 제거). 외부 export(`freeExploreRepository`/`freeExploreRepositoryV2`)도 단일 함수로 정리.
- [ ] T010 [US1] `src/explorer/prompt.mjs`에서 V1 전용 builder(`buildFreeExploreSystemPrompt`/`buildFreeExploreUserPrompt`/`buildFreeExploreFinalizePrompt`) 제거 또는 V2 builder로 alias.
- [ ] T011 [US1] `src/mcp/server.mjs`의 MCP `initialize` instructions 문자열에서 "advanced opt-in `explore_v2`" 같은 문구를 단일 `explore` 설명으로 정리.
- [ ] T012 [US1] T003, T005 신규/갱신 케이스 모두 PASS, 회귀 무결 확인.

**Checkpoint**: SC-001/SC-002 충족, tools/list 8개 고정.

---

## Phase 4: User Story 2 — `budget` 입력 제거 + 단일 deep config (P2)

**Goal**: `EXPLORE_REPO_INPUT_SCHEMA`에서 `budget` 제거. 모든 호출에 deep config 적용 (FR-006 ~ FR-010, SC-003 ~ SC-005, SC-007).

**Independent Test**: spec.md US2 acceptance scenarios 4개.

### Tests for User Story 2

- [ ] T013 [P] [US2] `tests/runtime.mock.test.mjs`에 신규 케이스 추가: `explore_repo({ budget: 'quick', ... })` 호출이 schema validation에서 unknown property로 거부됨.
- [ ] T014 [P] [US2] 같은 파일의 budget 인자를 명시 사용하던 케이스를 정리:
  - `BudgetRetryScopeClient` 케이스의 `budget: 'quick'` 인자를 제거하고 deep 기본 동작으로 통과하도록 갱신.
  - `TokenBudgetRepairClient`/`ResponseFormatRepairClient` 등 budget 인자 사용 케이스도 동일 정리.
  - `result.stats.budget`/`budgetSource`를 검증하던 부분이 있으면 단일 표기 또는 부재로 갱신.
- [ ] T015 [P] [US2] `tests/runtime.mock.test.mjs`에 신규 케이스 추가: 임의의 explore_repo 호출이 deep config 한도(`maxTurns=30`, `maxSearchResults=80`, `maxReadLines=320` 등)를 사용하는지 확인 — `result.stats.maxTurns` 또는 동등 신호로 검증.

### Implementation for User Story 2

- [ ] T016 [US2] `src/explorer/schemas.mjs/EXPLORE_REPO_INPUT_SCHEMA.properties`에서 `budget` 속성 제거.
- [ ] T017 [US2] `src/explorer/config.mjs/BUDGETS`를 deep 단일로 단순화 (또는 quick/normal을 deep로 alias하여 외부 import 보호). 데이터 모델 §4 참조.
- [ ] T018 [US2] `src/explorer/config.mjs/getBudgetConfig(label)`을 label 인자 무시·deep 고정 반환으로 단순화.
- [ ] T019 [US2] `src/explorer/config.mjs/chooseAutoBudget()`을 항상 `'deep'` 반환하는 단순 함수로 변경 (또는 호출부에서 인라인).
- [ ] T020 [US2] `src/explorer/runtime.mjs`에서 budget 결정 분기 정리: `budgetLabel`, `budgetSource` 계산 코드 단순화 또는 'deep' 고정.
- [ ] T021 [US2] `src/explorer/runtime.mjs/buildFailure()`의 budget retry hint에서 "narrower scope or more specific task" 안내는 유지하되 "deep budget 선택" 같은 label 권유 문구가 있다면 제거.
- [ ] T022 [US2] `src/explorer/runtime.mjs/buildSearchCoverage()`와 `buildEvidenceQuality` 또는 `buildTrustSummary`의 summary 문구에서 budget label 언급 정리(단일 표기 또는 부재).
- [ ] T023 [US2] `src/mcp/server.mjs`의 wrapper handler에서 `buildXxxArgs()`로 만들어지는 `explore_repo` 인자에 `budget` 키가 포함되면 제거.
- [ ] T024 [US2] T013 ~ T015 신규/갱신 케이스 모두 PASS, 회귀 무결 확인.

**Checkpoint**: SC-003/SC-004/SC-005/SC-007 충족.

---

## Phase 5: User Story 3 — envvar 10개 제거 + 010 legacy/auto-session 분기 제거 (P3)

**Goal**: data-model.md §6의 10개 envvar 제거 및 010 신규 분기 영구 제거 (FR-011 ~ FR-014, SC-006).

**Independent Test**: spec.md US3 acceptance scenarios 4개.

### Tests for User Story 3

- [ ] T025 [P] [US3] `tests/session.test.mjs`의 010 신규 케이스 제거:
  - `010 US5 — findReusableForRepo returns the most-recently-used session for a repoRoot`
  - `010 US5 — findReusableForRepo rejects expired and exhausted sessions`
- [ ] T026 [P] [US3] `tests/runtime.mock.test.mjs`의 010 신규 케이스 제거:
  - `010 US5 — CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1 reuses a reusable session for the same repoRoot`
  - `010 US5 — without the opt-in envvar, repeated calls always create a new session` (개념은 살리되 envvar 부재 가정으로 갱신 가능)
  - `010 US2#3 — CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1 restores reference target promotion`
- [ ] T027 [P] [US3] `tests/mcp-server.test.mjs`에서 `EXTRA_TOOLS=false`/`ENABLE_EXPLORE=false`/`ENABLE_EXPLORE_V2=true` 분기 검증 케이스 제거.
- [ ] T028 [P] [US3] `tests/security/redact.test.mjs`의 010 US3#4 (`CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES`) 케이스는 유지 — 본 작업 범위 밖.

### Implementation for User Story 3

- [ ] T029 [US3] `src/explorer/config.mjs`에서 다음 helper 제거:
  - `legacyDiscoveredTargetsEnabled`
  - `autoSessionByRepoEnabled`
  - `extraToolsEnabled`
  - `exploreToolEnabled`
  - `exploreV2ToolEnabled` (US1과 함께)
- [ ] T030 [US3] `src/explorer/config.mjs/getModelForBudget(budget)`을 단순 `getExplorerModel()` 호출로 대체. budget 인자/branch 모두 제거. `getExplorerModel()` 내 `CEREBRAS_MODEL` alias fallback 코드 제거.
- [ ] T031 [US3] `src/explorer/config.mjs/chooseAutoBudget()`에서 `CEREBRAS_EXPLORER_AUTO_ROUTE` envvar 사용 분기 제거(이미 US2에서 단순화되었으므로 정합성 확인).
- [ ] T032 [US3] `src/explorer/runtime.mjs`의 `legacyDiscoveredTargetsEnabled()` 호출 분기 제거. `buildTargets({ includeLegacyReferences })` 매개변수도 제거 또는 항상 false 고정. discovered path 자동 승격 코드 경로 자체를 제거.
- [ ] T033 [US3] `src/explorer/runtime.mjs/resolveSessionForExplore()`의 `autoSessionByRepoEnabled()` 분기 제거. `sessionSource='auto_repo'` 케이스도 함께 제거. 다른 sessionSource enum(`explicit`/`created`/`reused`)은 유지.
- [ ] T034 [US3] `src/explorer/session.mjs/findReusableForRepo` method 제거 (외부 사용처 없음).
- [ ] T035 [US3] `src/mcp/server.mjs/buildToolList()`에서 `extraToolsEnabled()`/`exploreToolEnabled()` 분기 제거 → 항상 8개 도구 노출 (US1의 T006과 정합).
- [ ] T036 [US3] T025 ~ T027 케이스 제거 후 `npm test`가 통과하는지 회귀 확인.

**Checkpoint**: SC-006/SC-008 grep 검증 가능 상태.

---

## Phase 6: Polish — 문서/CHANGELOG/integration/smoke 통합

**Purpose**: 3개 user story 완료 후 cross-cutting 정리.

### Documentation

- [ ] T037 [P] [Polish] `README.md` 갱신:
  - 환경변수 표에서 제거된 10개 항목 삭제. 010 추가 envvar(`REDACT_ENV_VAR_NAMES`)는 유지.
  - 공개 도구 섹션에서 `explore_v2` 설명 제거. wrapper decision rule에서 "opt-in `explore_v2`" 항목 삭제.
  - `explore_repo` 입력 스키마 예시에서 `budget` 키 제거.
  - 010에서 추가한 "010 호환/보안 옵션" 단락 정리(`AUTO_SESSION_BY_REPO`/`LEGACY_DISCOVERED_TARGETS` 제거, `REDACT_ENV_VAR_NAMES`만 유지).
  - Security Model 절은 010 그대로 유지(env var 보존 정책).
  - 안전 경계 절은 010 그대로 유지(scope hard boundary).
- [ ] T038 [P] [Polish] `DESIGN.md` 갱신:
  - §11.5 targets vs discoveredPaths 본문에서 `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS` 언급 제거.
  - §11.7 session/progress operational contract 본문에서 `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO` 옵트인 안내를 "더 이상 지원하지 않음 / explicit session만 사용" 같은 정리 문구로 변경 또는 단락 자체 정리.
  - §13 budget 정책 절 — budget 단일 deep config를 반영하여 quick/normal/deep 3종 표 대신 deep 한 줄 설명으로 축소.
- [ ] T039 [P] [Polish] `AGENTS.md` 갱신:
  - 공개 도구 8개 invariant 그대로 유지하되 `explore_v2` opt-in 언급 제거(이미 8개 surface에 V2 backend가 단일 `explore`로 들어가므로 표현 정리).
  - 환경변수 동기화 매트릭스에서 제거된 envvar 줄 정리.
- [ ] T040 [Polish] `CHANGELOG.md`에 011 단일 묶음으로 기록:
  - Breaking: `explore_repo` 입력에서 `budget` 키 제거, `explore_v2` 도구 이름 제거(`explore`가 동일 기능 제공).
  - Removed: 환경변수 10개 명시 + 010 두 옵트인 동작(legacy targets, auto session)의 영구 종료.
  - Changed: 모든 explore 호출에 단일 deep config 적용, V1 explore 코드 경로 제거, 모델 선택을 단일 `CEREBRAS_EXPLORER_MODEL`로 통일.
  - Migration 안내: budget 키 제거, `explore_v2`→`explore` 이름 변경, `CEREBRAS_MODEL`→`CEREBRAS_EXPLORER_MODEL` 변경, `AUTO_SESSION_BY_REPO` 사용자는 explicit `session` 전환.

### Integrations

- [ ] T041 [P] [Polish] `integrations/*/README.md`와 `integrations/*/*.json.example` 점검:
  - 제거된 10개 envvar 권유 또는 예시가 있으면 모두 제거.
  - `explore_v2` 호출 예시가 있으면 `explore`로 변경.
  - `budget` 입력 예시가 있으면 제거.
  - `tests/integrations.test.mjs`가 snapshot 가드를 하는 경우 기대값 갱신.

### Verification

- [ ] T042 [Polish] `npm test` 전체 회귀: 종료 코드 0, failure 수 0.
- [ ] T043 [Polish] grep 검증 (SC-006): 10개 envvar 이름이 src/tests/docs/integrations에서 0건(CHANGELOG 회상 예외). quickstart.md Q3 명령을 그대로 사용 가능.
- [ ] T044 [Polish] grep 검증 (SC-008): README/DESIGN/AGENTS의 envvar 표가 data-model.md §7 "Retained Environment Variables"와 일치. `explore_v2`/`budget` 입력 언급 0건.
- [ ] T045 [Polish] Manual smoke: `node src/index.mjs`로 stdio MCP 서버 boot. `initialize` instructions 문자열에 `explore_v2`/`budget`/제거된 envvar 언급이 0건, 010 progressToken/control-plane 보존 안내는 유지.
- [ ] T046 [Polish] `git diff master..HEAD --stat`으로 변경 영역이 plan.md "Project Structure"에 명시된 파일로 한정되었는지 셀프 리뷰.

**Checkpoint**: SC-001~SC-010 충족, 머지 준비 완료.

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 (Setup): 즉시 시작.
- Phase 2 (Foundational): 비어 있음.
- Phase 3 (US1, P1): Phase 1 직후. `src/mcp/server.mjs`, `src/explorer/runtime.mjs`, `src/explorer/prompt.mjs`에 변경 집중.
- Phase 4 (US2, P2): Phase 3 이후. 같은 `runtime.mjs` 영역 + `config.mjs`, `schemas.mjs`.
- Phase 5 (US3, P3): Phase 4 이후. 같은 `runtime.mjs`/`config.mjs`/`session.mjs`/`server.mjs`.
- Phase 6 (Polish): Phase 5 이후. 문서/CHANGELOG/integration 통합.

### Within Each User Story

- 테스트 갱신/추가 → 코드 변경 → npm test → 다음 phase.

### Parallel Opportunities

- T037/T038/T039는 서로 다른 문서 파일이라 병렬 가능.
- T041(integrations)는 코드 변경과 독립이라 Phase 3~5와 병행 가능(같은 manifest를 두 사람이 동시에 수정하지만 않으면).

---

## Implementation Strategy

본 작업은 010과 달리 **제거/단순화 중심**이라 phase 단위 commit이 비교적 빠르게 끝날 수 있다. 010과 동일한 페이스로 진행:

1. Phase 1 baseline
2. Phase 3 US1 (V1/V2 단일화) → commit
3. Phase 4 US2 (budget 제거) → commit
4. Phase 5 US3 (envvar 10개) → commit
5. Phase 6 Polish + CHANGELOG → commit
6. master로 `--no-ff` merge, 브랜치 삭제

---

## Notes

- `[P]` tasks = 다른 파일 손대므로 병렬 작성 가능.
- `[Story]` 라벨로 traceability 유지.
- 010 옵트인 envvar 두 개(`AUTO_SESSION_BY_REPO`, `LEGACY_DISCOVERED_TARGETS`)의 migration window가 본 작업으로 종료되므로 CHANGELOG에 반드시 명시.
- `EXPLORE_REPO_OUTPUT_SCHEMA`는 010 그대로 유지(`discoveredPaths`, `omittedOutOfScopeFiles` 등 신규 필드 포함). 본 작업의 breaking은 입력 schema와 도구 이름에만 한정.
