# Tasks: V2 Truncation Trust Wording

**Input**: Design documents from `specs/001-v2-truncation-trust-wording/`

- spec: `specs/001-v2-truncation-trust-wording/spec.md`
- plan: `specs/001-v2-truncation-trust-wording/plan.md`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Required (regression test in `tests/runtime.mock.test.mjs`). spec FR-007 및 SC-001~SC-004 검증을 위해 회귀 테스트가 명시적으로 요구된다.

**Organization**: Tasks는 user story 기준으로 그룹화되어 있어 US1과 US2를 독립적으로 검증·배포 가능하다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 서로 다른 파일을 건드리고 의존성이 없을 때만 표기 (병렬 실행 가능)
- **[Story]**: US1 = honest truncation envelope, US2 = actionable searchCoverage warning
- 모든 경로는 저장소 루트 기준 상대 경로

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- 본 feature의 변경 범위는 `src/explorer/runtime.mjs` 단일 소스 파일과 `tests/runtime.mock.test.mjs` 단일 테스트 파일

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 본 feature는 별도 setup이 필요 없다 (신규 디렉터리/의존성/툴체인 변경 없음). plan.md "Project Structure" 결정에 따라 기존 단일 프로젝트 구조를 그대로 사용한다.

_Phase 1 skipped — no new setup required._

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: US1과 US2가 모두 의존하는 단일 진실 공급원(canonical truncation marker)을 먼저 도입한다. 이 마커가 없으면 envelope 문구·V2 카운터·searchCoverage 경고가 일관된 기준으로 매칭될 수 없으므로 양쪽 user story의 prerequisite다.

- [ ] T001 [P] `src/explorer/runtime.mjs`의 `applyToolResultCharBudget()` 함수 바로 위(module 내부 스코프)에 `const TRUNCATED_TOOL_RESULT_MARKER = '[truncated-tool-result-before-synthesis]';` 상수를 추가한다. 공개 export 없이 동일 파일 내 호출자만 사용 가능하도록 module-local로 유지한다 (plan.md Implementation Outline 1, Risks "마커 기반 카운터 false-negative" 항목 참조).

**Checkpoint**: Foundation 준비 완료 — US1, US2 작업을 (이론적으로) 병렬 진행 가능. 단, 동일 파일(`src/explorer/runtime.mjs`)을 모두 건드리므로 실무상 순차 진행 권장.

---

## Phase 3: User Story 1 - Honest truncation signal to the model (Priority: P1)

**Goal**: `applyToolResultCharBudget()`이 반환하는 tool-result envelope에서 "Full data was inspected; key content preserved above" 문구를 제거하고, 결과가 모델 합성 이전에 잘렸음을 정직하게 선언하는 메시지로 교체한다. 동시에 V2 truncation 카운터를 substring 휴리스틱(`[truncated:`)에서 T001의 canonical marker 기반으로 전환해 spec FR-003·FR-006을 충족한다.

**Independent Test**: per-tool 문자 예산을 초과하는 직렬화 payload를 만드는 fixture로 `freeExploreV2`를 실행한 뒤, 두 번째 턴 tool 메시지에 "Result was truncated before model synthesis" 문구가 포함되고 "Full data was inspected" 문구가 일절 등장하지 않음을 단언한다. 동시에 `searchCoverage.toolResultsTruncated`가 절단 envelope 개수와 정확히 일치함을 확인한다 (spec Acceptance Scenario 1~3, SC-001/SC-003).

### Tests for User Story 1 (RED first)

> 본 feature는 spec FR-007이 회귀 테스트를 명시적으로 요구하므로 테스트를 먼저 작성하고 실패시킨 뒤 구현에 진입한다.

- [ ] T002 [US1] `tests/runtime.mock.test.mjs`에 회귀 테스트 케이스 `freeExploreV2 labels truncated tool results as incomplete before synthesis`를 추가한다. fixture는 약 700행 분량의 대용량 텍스트 파일을 임시로 생성해 단일 tool call로 읽게 만들어 per-tool 문자 예산을 강제로 초과시키고, 다음을 한 블록에서 단언한다: (a) 두 번째 턴 tool 메시지에 정규식 `/Result was truncated before model synthesis/`가 매칭됨, (b) 동일 메시지에 `"Full data was inspected"` 부분 문자열이 포함되지 **않음**, (c) `searchCoverage.toolResultsTruncated === 1` (spec SC-003). 이 시점에서 테스트는 RED여야 한다 (plan.md Test Strategy "신규 단위 테스트 (1건)" 참조). US2의 추가 단언(T005)은 같은 테스트에 이어 붙이므로 본 task에서는 envelope·카운터까지만 검증한다.

### Implementation for User Story 1

- [ ] T003 [US1] `src/explorer/runtime.mjs::applyToolResultCharBudget()`의 반환 문자열 분기를 교체한다. 기존의 "...Full data was inspected; key content preserved above" 문구를 제거하고, T001에서 도입한 `TRUNCATED_TOOL_RESULT_MARKER`와 함께 정확히 `Result was truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing.` 문장이 envelope에 포함되도록 한다. preview slice 길이는 새 마커 + 메시지 길이를 감안해 `budget - 180` 부근으로 조정한다 (plan.md Implementation Outline 2). redaction → JSON.stringify → 절단 순서는 보존한다 (plan.md Risks "redaction 순서 회귀").

- [ ] T004 [US1] `src/explorer/runtime.mjs`의 `freeExploreV2` 루프(plan.md에 따르면 2188행 인근)에서 truncation 카운터를 계산하는 `serialized.includes('[truncated:')` 휴리스틱을 `serialized.includes(TRUNCATED_TOOL_RESULT_MARKER)` 호출로 교체한다. V1(`freeExplore`) 경로가 동일 카운터를 별도로 읽는다면 동일하게 마커 기반으로 통일한다. FR-006(카운터 불변)을 깨지 않도록 1 envelope당 1 증가 의미를 유지한다.

**Checkpoint**: US1 단독 검증 — T002 테스트가 GREEN이 되고, `npm test`에서 `runtime.mock.test.mjs`만 단독 실행해도 통과해야 한다. envelope 문구·V2 카운터 측면에서 US1이 독립적으로 배포 가능한 상태.

---

## Phase 4: User Story 2 - Actionable recovery guidance for the upper agent (Priority: P1)

**Goal**: `buildSearchCoverage()`가 노출하는 truncation warning 텍스트를 envelope 메시지와 동일한 복구 지침("re-run with a narrower query or read specific ranges if expected evidence is missing")으로 정렬해 상위 에이전트(Claude Code/Codex/Gemini CLI)가 단일 필드만 읽고도 다음 액션을 결정할 수 있게 한다 (spec FR-004, SC-002, SC-004).

**Independent Test**: US1과 동일한 절단 fixture로 `searchCoverage.warnings` 배열을 읽어 적어도 한 경고가 `/expected evidence is missing/i` 정규식에 매칭되는지 단언한다. 절단이 없는 fixture에서는 해당 warning이 emit되지 **않음**을 동시에 검증해 FR-005를 충족한다.

### Tests for User Story 2 (RED first)

- [ ] T005 [US2] `tests/runtime.mock.test.mjs`의 T002 테스트 블록에 단언 두 가지를 추가한다: (a) `searchCoverage.warnings` 중 적어도 하나가 정규식 `/expected evidence is missing/i`에 매칭됨 (spec Acceptance Scenario 1 of US2, SC-002), (b) 절단이 발생하지 않는 보조 fixture(또는 동일 fixture의 비절단 경로)에서 같은 정규식에 매칭되는 warning이 **존재하지 않음** (spec Acceptance Scenario 2 of US2, FR-005). 본 단언은 T002에 이어 붙이므로 별도 테스트 함수를 만들 필요는 없으나, 비절단 케이스가 같은 파일에 부재하다면 동일 케이스 내에서 절단 전/후를 분리해 검증한다. 이 시점에서 단언은 RED여야 한다.

### Implementation for User Story 2

- [ ] T006 [US2] `src/explorer/runtime.mjs::buildSearchCoverage()`(plan.md에 따르면 443행 인근)의 truncation warning 문자열을 교체한다. 기존 `"N tool result(s) were truncated before final synthesis."`(또는 그에 준하는 문구)를 `"N tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing."`로 교체해 envelope 메시지(T003)와 동일한 복구 지침을 노출한다. 절단 카운트가 0일 때 warning을 emit하지 않는 기존 분기는 그대로 유지한다 (FR-005). pluralization 규칙도 기존 동작을 보존한다 (spec Edge Cases 두 번째 항목).

**Checkpoint**: US2 단독 검증 — T005의 추가 단언이 GREEN이 되고 envelope 메시지(T003)와 warning 텍스트(T006) 양쪽에서 동일한 복구 지침을 한 fixture로 한 번에 확인 가능. US1·US2 모두 독립 동작.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 옛 문구의 잔존 0건 확인, 기존 스냅샷·prose-drift 가드와의 충돌 점검, 전체 테스트 회귀 검증.

- [ ] T007 [P] 저장소 루트에서 `git grep "Full data was inspected"` 및 `git grep "key content preserved above"`를 실행해 매칭 0건임을 확인한다 (spec SC-001 "0% contain the legacy wording", plan.md Risks "캐시 / transcript 재생과 옛 문구의 잔존" 항목). 매칭이 남아 있으면 동일 PR에서 제거한다.

- [ ] T008 [P] 저장소 루트에서 `git grep "before final synthesis"`로 `buildSearchCoverage()` 외에 옛 warning 문구가 잔존하지 않는지 확인한다 (FR-004 정렬). 매칭이 남아 있으면 본 task 내에서 제거한다.

- [ ] T009 저장소 루트에서 `npm test`를 전수 실행해 다음을 검증한다: (a) `tests/runtime.mock.test.mjs`의 신규 회귀(T002+T005) GREEN, (b) `tests/integration-script.test.mjs`의 `toolResultsTruncated: 0` 기대값과 `tests/schemas.test.mjs`의 필드 존재성 검증이 회귀 없이 통과 (plan.md Test Strategy "기존 truncation 관련 테스트 영향"), (c) `tests/integrations.test.mjs` prose-drift 스냅샷이 새 문구와 충돌하지 않음. 충돌 시 동일 PR에서 스냅샷만 갱신하고 의미 변경은 가하지 않는다.

- [ ] T010 (선택) `CEREBRAS_API_KEY` 보유 환경에 한해 `node scripts/integration-test.mjs`를 1회 실행해 실제 모델 추론 경로에서도 새 envelope 텍스트로 회귀 없음을 확인한다 (plan.md Test Strategy "수동 검증", 비용 발생하므로 필수 아님).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: skip — 본 feature는 setup 작업 없음.
- **Phase 2 (Foundational)**: T001이 US1·US2 전부의 prerequisite. T001 완료 전까지는 어떠한 user story 작업도 시작 불가.
- **Phase 3 (US1)**: T001 완료 후 진입. 내부 순서는 T002 (RED test) → T003 (envelope 교체) → T004 (카운터 마커 전환).
- **Phase 4 (US2)**: T001 완료 후 진입. 내부 순서는 T005 (RED test 단언 추가) → T006 (warning 텍스트 교체). T002 테스트 블록을 확장하므로 사실상 T002 작성 완료 후 T005 진행.
- **Phase 5 (Polish)**: 모든 user story 구현 완료 후 진입. T007·T008은 병렬 가능, T009는 두 user story 모두 GREEN 이후.

### User Story Dependencies

- **US1 (P1)**: Foundational(T001) 완료 후 독립 진행 가능. 다른 user story에 의존하지 않음.
- **US2 (P1)**: Foundational(T001) 완료 후 독립 진행 가능. envelope와 warning을 동일 fixture로 묶어 검증하기 위해 T005는 T002 테스트 블록을 확장하는 형태이므로 실무상 US1 테스트 작성 직후 이어 진행하는 것이 효율적이지만, 구현(T006) 자체는 US1 구현(T003·T004)과 독립.

### Within Each User Story

- 테스트가 먼저 작성되어 RED 상태임을 확인한 뒤에만 구현 task 진입 (spec FR-007 요구).
- 동일 소스 파일(`src/explorer/runtime.mjs`) 내 변경이 다수이므로 같은 user story 내 구현 task는 직렬로 진행.
- 한 user story가 완료되어 GREEN이 된 뒤 다음 user story로 이동(또는 병렬 작업자에 위임).

### Parallel Opportunities

- **Phase 2 내**: T001만 단일 task이므로 병렬 슬롯 없음. [P] 마커는 향후 확장 여지 표시.
- **Phase 3 vs Phase 4**: 이론적으로 US1·US2를 서로 다른 작업자가 병렬로 잡을 수 있으나, 양쪽 모두 `src/explorer/runtime.mjs` 단일 파일과 `tests/runtime.mock.test.mjs` 단일 테스트 케이스를 공유하므로 머지 충돌을 피하려면 한 작업자가 순차 진행하는 것을 권장. 본 plan은 단일 PR을 가정한다.
- **Phase 5 내**: T007과 T008은 서로 다른 grep 패턴으로 독립이므로 [P] 병렬 가능. T009는 전수 테스트라 직렬.

---

## Parallel Example: Phase 5 grep 검증

```bash
# 옛 문구 잔존 0건 확인 — 두 grep을 병렬 실행:
Task: T007 — git grep "Full data was inspected" / git grep "key content preserved above"
Task: T008 — git grep "before final synthesis"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 2 (T001) 완료 — canonical marker 도입.
2. Phase 3 (T002 → T003 → T004) 완료 — envelope 정직화 + V2 카운터 마커 전환.
3. **STOP and VALIDATE**: 단독 fixture로 envelope 문구·카운터 검증. 이 시점에서도 spec의 핵심 trust 실패는 해소된다 (SC-001/SC-003 단독 충족).
4. 필요 시 단독 배포 후 US2로 확장.

### Incremental Delivery

1. Foundation (T001) → US1 완료 → MVP 배포 가능 (envelope 정직화).
2. US2 추가 (T005 → T006) → searchCoverage warning까지 정렬된 정식 배포.
3. Phase 5로 잔존·회귀 점검 후 PR 머지.

### Single-PR Strategy (권장)

본 feature는 LOC 10~20 줄 수준의 단일 helper 정합성 변경이므로 US1·US2를 한 PR에 묶고, Phase 2→3→4→5 순서로 단일 작업자가 순차 진행하는 것이 가장 효율적이다 (plan.md Summary "변경 LOC는 10~20 줄 수준").

---

## Acceptance Scenario Mapping

| Spec scenario | Verified by |
|---|---|
| US1 Scenario 1 (envelope에 "truncated before model synthesis" 명시) | T002 단언 (a), T003 구현 |
| US1 Scenario 2 ("Full data was inspected" 문구 부재) | T002 단언 (b), T007 grep 0건 |
| US1 Scenario 3 (예산 내 결과에는 마커 미부착) | T002 fixture의 비절단 분기 (T005에서 보조 fixture로 확장) |
| US2 Scenario 1 (warning에 복구 지침 포함) | T005 단언 (a), T006 구현 |
| US2 Scenario 2 (절단 0건이면 warning 없음) | T005 단언 (b) |
| US2 Scenario 3 (envelope도 동일 복구 지침 echo) | T003 구현 — envelope 메시지에 동일 문장 포함 |
| SC-001 (legacy 문구 0%) | T007, T008 grep 검증 |
| SC-002 (envelope ↔ warning 동일 fixture 검증) | T002+T005가 한 테스트 블록에서 동시 단언 |
| SC-003 (`toolResultsTruncated === N`) | T002 단언 (c), T004 카운터 구현 |
| SC-004 (단일 필드로 remediation 식별 가능) | T003 envelope 텍스트, T006 warning 텍스트 |
| FR-007 (회귀 테스트 신규 추가) | T002, T005 |

---

## Notes

- [P] tasks = 서로 다른 파일을 건드리고 의존성이 없을 때만. 본 feature는 대부분 동일 파일을 건드리므로 [P] 표기가 매우 제한적.
- [Story] 라벨로 task-to-user-story 추적성 확보. US1/US2 둘 다 P1이므로 우선순위 동등.
- 테스트는 구현 전에 RED 확인 — spec FR-007의 명시적 요구.
- 각 user story checkpoint에서 멈춰 독립 검증 가능.
- 회피 사항: 공개 도구 표면·JSON Schema·환경 변수 변경, 새 의존성 추가, redaction/캐시 순서 변경. 모두 plan.md Constitution Check에서 금지된 행위.
