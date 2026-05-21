---

description: "Task 3 (Evidence Preservation Benchmark Coverage)의 atomic 작업 목록 초안"
---

# Tasks: Evidence Preservation Benchmark Coverage

**Input**: Design documents from `./specs/003-evidence-preservation-benchmark/`

**Prerequisites**: plan.md (필수), spec.md (필수)

**Tests**: 본 feature는 평가기 단위 테스트를 필수 산출물로 요구한다(spec SC-001/SC-004). 따라서 테스트 작업은 OPTIONAL이 아닌 Required로 포함된다.

**Organization**: 작업은 user story 단위로 묶어 각 story를 독립적으로 구현·검증할 수 있도록 정렬한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 다루고 의존성이 없는 경우 병렬 실행 가능
- **[Story]**: 해당 작업이 속한 user story (US1, US2)
- 모든 경로는 저장소 루트 기준 상대 경로로 표기

## Path Conventions

- 단일 Node 프로젝트 구조: 루트 아래 `./src/`, `./benchmarks/`, `./scripts/`, `./tests/`, `./package.json`
- 본 feature는 새 디렉터리를 만들지 않고, 평가기 한 파일·suite 한 파일·테스트 한 파일·`./package.json`의 scripts 블록만 손댄다(plan Project Structure)
- 신규 진입점은 별도 스크립트 파일을 만들지 않고 `./scripts/run-benchmark.mjs`의 `--suite` 인자를 재사용한다

---

## Phase 1: Setup (Shared Prerequisites)

**Purpose**: 본 작업의 강한 선행 의존성을 명시적으로 확인하고, 작업 시작 조건을 충족시킨다.

- [x] T001 Task 2(공통 `citations[]` 배열 도입)의 머지 상태를 확인한다. `./src/`의 report-mode 도구(`explore`, `explore_v2` 등) 결과 객체가 구조화된 `citations[]` 필드를 노출하는지 manual smoke로 점검하고, 미머지일 경우 본 feature 구현을 중단한다(plan Dependency Note, spec Assumptions).
- [x] T002 `./benchmarks/adoption.json`, `./scripts/run-benchmark.mjs`, `./package.json`의 `scripts.benchmark` 항목이 현재 상태에서 변경 없이 유지될 베이스라인임을 git diff 기준으로 기록한다. 본 feature의 어떤 단계에서도 이 세 항목을 수정하지 않음을 명문화한다(spec FR-008, SC-003).

**Checkpoint**: Task 2 머지 확인 + 기존 회귀 금지 표면 식별 완료. 이후 단계로 진행 가능.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 신규 체크 4종이 공통으로 사용할 안전 환원 헬퍼를 평가기 모듈 내부에 도입한다. 본 단계는 어떤 user story 구현보다도 먼저 완료되어야 한다.

**⚠️ CRITICAL**: 아래 헬퍼가 자리잡기 전에는 US1의 evaluator 분기 추가가 시작될 수 없다.

- [x] T003 [P] `./src/benchmark/evaluator.mjs`에 `getCitations(result)` 헬퍼를 추가한다. `result.citations`가 배열일 때 그대로 반환하고, 그렇지 않으면 빈 배열을 반환한다(spec Edge Cases: "citation 배열이 `null` 또는 비배열인 경우 0으로 처리").
- [x] T004 [P] `./src/benchmark/evaluator.mjs`에 `countCitationFiles(result)` 헬퍼를 추가한다. `getCitations(result)`의 항목 중 `path`가 truthy인 값만 모아 `Set`으로 중복 제거 후 크기를 반환한다(spec Edge Cases: "동일 파일을 가리키는 citation이 여러 개일 때 중복 제거").
- [x] T005 [P] `./src/benchmark/evaluator.mjs`에 `hasCitationGapWarning(result)` 헬퍼를 추가한다. `result.critic?.warnings`가 배열이 아닐 때 `false`로 환원하고, 배열일 때만 `warning.type === 'citation_gap'`을 검색한다(spec Edge Cases: "critic warning 구조가 누락된 경우 false").
- [x] T006 [P] `./src/benchmark/evaluator.mjs`에 `toolResultsWereTruncated(result)` 헬퍼를 추가한다. `result.searchCoverage?.toolResultsTruncated`와 기존 `getStats(result).toolResultsTruncated`를 각각 숫자로 강제 환원해 어느 하나라도 양수면 `true`, 둘 다 0이거나 누락이면 `false`를 반환한다(spec Edge Cases: "검색 coverage 메트릭이 없거나 critic warning 구조가 누락된 경우 안전하게 해석").

**Checkpoint**: 4종 헬퍼 도입 완료. `evaluateCheck()`의 신규 case가 의존할 수 있는 안전 환원 표면 확보.

---

## Phase 3: User Story 1 - report-mode 도구의 citation 보존을 회귀 없이 측정 (Priority: P1) 🎯 MVP

**Goal**: report-mode 도구가 일정 수 이상의 citation·서로 다른 cited 파일을 보존하고 truncation/citation gap warning이 없는지를 자동으로 측정한다. 신규 체크 4종이 evaluator에 추가되고, 신규 suite 파일이 모든 체크를 실 케이스에서 한 번 이상 사용한다.

**Independent Test**: `./tests/benchmark-evaluator.test.mjs`만 실행해도 신규 체크 4종이 통과/실패 양방향으로 동작하는지 검증할 수 있고, `./benchmarks/evidence-preservation.json`을 `JSON.parse`한 결과가 1개 이상의 케이스를 포함하는지 확인할 수 있다(spec User Story 1 Independent Test, SC-001/SC-002).

### Tests for User Story 1 (Required) ⚠️

> **NOTE: 평가기 분기 추가 전에 실패하는 테스트를 먼저 작성하고, 구현 후 통과로 전환한다(plan Constitution Check: 테스트 우선 원칙).**

- [x] T007 [P] [US1] `./tests/benchmark-evaluator.test.mjs`에 `min_citation_count` 체크의 통과/실패 시나리오 2개를 추가한다. `citations` 길이 2이고 임계 2일 때 통과, 길이 1이고 임계 2일 때 실패. `citations`가 `null`/비배열일 때도 0으로 환원되어 실패하는 보조 단언을 동일 테스트에 포함한다(spec SC-001, Edge Cases).
- [x] T008 [P] [US1] `./tests/benchmark-evaluator.test.mjs`에 `min_citation_file_count` 체크의 통과/실패 시나리오 2개를 추가한다. 동일 `path` 두 개일 때 고유 1로 환원되어 임계 2에서 실패, 서로 다른 `path` 두 개일 때 통과(spec SC-001, Edge Cases).
- [x] T009 [P] [US1] `./tests/benchmark-evaluator.test.mjs`에 `tool_results_truncated_equals` 체크의 통과/실패 시나리오 2개를 추가한다. `searchCoverage.toolResultsTruncated > 0` 또는 `stats.toolResultsTruncated > 0`일 때 `actual === true`, 둘 다 0이거나 누락일 때 `actual === false`임을 양방향 단언한다(spec SC-001, User Story 1 Acceptance Scenario 3).
- [x] T010 [P] [US1] `./tests/benchmark-evaluator.test.mjs`에 `citation_gap_warning_equals` 체크의 통과/실패 시나리오 2개를 추가한다. `critic.warnings`에 `type: 'citation_gap'` 항목이 있을 때 `true`, 누락이거나 다른 `type`만 있을 때 `false`임을 양방향 단언한다(spec SC-001, User Story 1 Acceptance Scenario 3).

**Checkpoint (Tests)**: T007~T010 단언은 총 8개 시나리오를 구성하며 현재 시점에는 모두 실패해야 한다. 실패 확인 후에만 다음 구현 작업으로 진행한다.

### Implementation for User Story 1

- [x] T011 [US1] `./src/benchmark/evaluator.mjs`의 `evaluateCheck()` 스위치에 `min_citation_count` case를 추가한다. `actual = getCitations(result).length`, `passed = actual >= Number(check.value ?? 0)`. 반환 객체 형태(`label`, `type`, `expected`, `actual`, `passed`, `weight`, `pointsEarned`)는 기존 분기와 동일하게 유지한다(plan Implementation Outline (a)).
- [x] T012 [US1] `./src/benchmark/evaluator.mjs`의 `evaluateCheck()` 스위치에 `min_citation_file_count` case를 추가한다. `actual = countCitationFiles(result)`, `passed = actual >= Number(check.value ?? 0)`.
- [x] T013 [US1] `./src/benchmark/evaluator.mjs`의 `evaluateCheck()` 스위치에 `tool_results_truncated_equals` case를 추가한다. `actual = toolResultsWereTruncated(result)`(boolean), `passed = actual === Boolean(check.value)`. 엄격 비교(`===`)와 명시적 boolean 환원을 사용한다(plan Risks & Mitigations 마지막 항목).
- [x] T014 [US1] `./src/benchmark/evaluator.mjs`의 `evaluateCheck()` 스위치에 `citation_gap_warning_equals` case를 추가한다. `actual = hasCitationGapWarning(result)`(boolean), `passed = actual === Boolean(check.value)`.
- [x] T015 [US1] T007~T010 단위 테스트가 모두 통과하도록 T011~T014 구현을 보정한다. 실패가 남아 있으면 헬퍼/스위치 분기를 재검토하고, 기존 evaluator 테스트가 회귀되지 않았는지 `npm test` 출력으로 동시 확인한다(spec SC-004).
- [x] T016 [P] [US1] `./benchmarks/evidence-preservation.json`을 신설한다. 최상위 필드는 `name`, `description`, `defaultPassScore`, `cases` 네 가지로 구성하고, `cases`는 비어 있지 않은 배열이어야 한다(spec SC-002).
- [x] T017 [US1] `./benchmarks/evidence-preservation.json`의 첫 케이스를 작성한다. 필드 골격: `id`, `description`, `tool`(예: `"explore"`), `args`(`prompt`/`thoroughness`/`scope` 등 report-mode 도구 인자), `expectations`(기존 keyword 그룹 방식 재사용), `checks`. `checks` 배열에는 신규 4종 체크가 각각 최소 1회 등장해야 하며 `tool_results_truncated_equals.value`와 `citation_gap_warning_equals.value`는 모두 `false`로 설정한다(spec FR-006, plan Implementation Outline (b)).
- [x] T018 [US1] `./benchmarks/evidence-preservation.json`의 `checks` 가중치 합이 1.0 이하가 되도록 분배하고, JSON이 표준 `JSON.parse`로 무손실 파싱되는지 manual 확인한다.

**Checkpoint**: US1 완료 — 신규 체크 4종이 evaluator에서 동작하고, suite 파일에서 모두 사용되며, 통과/실패 양방향 단위 테스트 8 시나리오가 모두 통과한다.

---

## Phase 4: User Story 2 - 신규 suite를 기존 워크플로에 충돌 없이 실행 (Priority: P2)

**Goal**: 별도 npm 스크립트를 추가해 evidence preservation suite를 단독으로 실행할 수 있게 한다. 기존 `benchmark` 스크립트와 adoption suite의 동작·출력 포맷은 변하지 않는다.

**Independent Test**: 새 npm 스크립트만 단독 호출해도 suite 파일이 정상 파싱되고 케이스 목록이 비어 있지 않은 상태로 로드된다. 기존 `npm run benchmark`는 변경 없이 동작한다(spec User Story 2 Acceptance Scenarios).

### Implementation for User Story 2

- [x] T019 [US2] `./package.json`의 `scripts` 블록에 `"benchmark:evidence": "node ./scripts/run-benchmark.mjs --suite ./benchmarks/evidence-preservation.json"`을 추가한다. 기존 `start`, `test`, `benchmark`, `prepublishOnly` 키는 변경하지 않는다(plan Implementation Outline (c)).
- [x] T020 [US2] `./scripts/run-benchmark.mjs`가 `--suite ./benchmarks/evidence-preservation.json` 인자로 호출되었을 때 신규 suite 파일을 정상 로드·파싱하는지 manual smoke로 확인한다. 스크립트 자체는 수정하지 않는다(plan Project Structure, FR-007).
- [x] T021 [US2] 기존 `npm run benchmark` 호출 시 기본 `--suite` 경로가 여전히 `./benchmarks/adoption.json`이고 출력 포맷이 그대로인지 코드 리뷰 단계에서 diff로 확인한다. 변경이 발견되면 본 작업 범위 밖이므로 즉시 되돌린다(spec FR-008, SC-003).

**Checkpoint**: US2 완료 — 단독 진입점 노출, 기존 진입점 회귀 없음.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 전체 회귀 확인과 suite JSON 파싱 가드 안착.

- [x] T022 [P] `./tests/benchmark-evaluator.test.mjs`에 suite JSON 파싱 가드를 추가한다. `node:fs/promises`로 `./benchmarks/evidence-preservation.json`을 읽어 `JSON.parse` 후 `Array.isArray(suite.cases) && suite.cases.length >= 1`을 단언한다(spec SC-002, plan Test Strategy "Suite JSON 파싱 가드").
- [x] T023 [P] `./tests/benchmark-evaluator.test.mjs`에 edge case 가드 테스트 1개를 추가한다. `citations` `null`/비배열, `critic.warnings` 누락, `searchCoverage` 누락 입력을 한 테스트에 묶어 신규 체크들이 예외 없이 0/false로 환원되는지 단언한다(spec Edge Cases 네 항목).
- [x] T024 `npm test`를 전체 실행해 evidence preservation 관련 신규 테스트 포함 후에도 0 failure로 종료되는지 확인한다(spec SC-004).
- [x] T025 `npm run benchmark`(기존)와 `npm run benchmark:evidence`(신규)를 순서대로 실행해, 전자의 출력 포맷이 변하지 않았고 후자가 신규 suite를 로드해 신규 체크를 수행하는지 manual smoke로 확인한다(spec FR-008, SC-003).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Task 2(공통 `citations[]` 배열 도입) 머지가 hard predecessor. T001에서 미머지 확인 시 본 feature 진행 중단(plan Dependency Note).
- **Phase 2 (Foundational)**: Phase 1 완료 후 시작. 4종 헬퍼 도입은 모든 user story 분기 추가를 BLOCK한다.
- **Phase 3 (US1)**: Phase 2 완료 후 시작. 테스트 우선 작업(T007~T010) → 평가기 분기(T011~T014) → 테스트 통과 보정(T015) → suite 파일 작성(T016~T018) 순서.
- **Phase 4 (US2)**: Phase 3에서 신규 suite 파일이 존재한 이후에만 의미가 있다. 단, 평가기 분기 자체는 US2 작업과 독립적이므로, US1의 T016 이후 시점이면 병렬 시작 가능.
- **Phase 5 (Polish)**: 모든 user story 완료 후 시작.

### User Story Dependencies

- **US1 (P1)**: Phase 2(헬퍼 도입) 완료 후 즉시 시작 가능. Task 2 머지가 본 feature 전체의 hard predecessor.
- **US2 (P2)**: US1에서 `./benchmarks/evidence-preservation.json`이 존재한 시점부터 시작 가능. US1의 평가기 분기 구현과는 파일이 분리되어 있어 일부 병렬 진행 가능.

### Within Each User Story

- 테스트(Phase 3의 T007~T010)는 평가기 분기(T011~T014) 구현 전에 작성되고, 작성 직후에는 모두 실패해야 한다(plan Constitution Check).
- 헬퍼 도입(Phase 2) → 스위치 분기 추가(US1 구현) → suite 파일 작성(US1 후반) → npm 스크립트 추가(US2) → 전체 회귀 점검(Polish).
- 동일 파일을 수정하는 작업끼리는 [P] 표기하지 않는다(예: T011~T014는 모두 `./src/benchmark/evaluator.mjs`를 손대므로 순차 진행).

### Parallel Opportunities

- **Phase 2**: T003~T006은 모두 `./src/benchmark/evaluator.mjs`의 별개 헬퍼 함수 추가지만 동일 파일을 다루므로 실제 편집은 순차 진행 권장. [P]는 "독립적으로 생각·리뷰할 수 있다"는 의미로만 부여.
- **Phase 3 Tests**: T007~T010은 동일 테스트 파일에 시나리오를 추가하지만, 시나리오 단위로 독립 작성 가능. 한 PR에 묶을 수도 분리할 수도 있음.
- **Phase 3 Suite**: T016은 신규 파일 생성으로, 평가기 작업(T011~T015)과 파일이 다르므로 진짜 병렬 가능.
- **Phase 5**: T022/T023은 동일 테스트 파일을 다루므로 편집은 순차, 작성 자체는 독립.

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 Setup 완료(Task 2 머지 확인 포함).
2. Phase 2 Foundational 완료(4종 헬퍼 도입).
3. Phase 3 US1 완료(테스트 우선 → 평가기 분기 → suite 파일).
4. **STOP and VALIDATE**: 신규 체크 4종이 통과/실패 양방향으로 동작하고 suite 파일이 1개 이상의 케이스를 가지는지 단위 테스트로 확인.
5. 이 시점에서 회귀 신호 자체는 이미 측정 가능(단, 단독 진입점 없음).

### Incremental Delivery

1. Setup + Foundational → 안전 기본값 표면 확보.
2. US1 완료 → 평가기 + suite 파일로 MVP 신호 측정 가능.
3. US2 추가 → 운영자가 단독 명령으로 호출 가능.
4. Polish → 전체 회귀와 suite 파싱 가드 안착.

---

## Notes

- [P] tasks는 서로 다른 관심사(또는 다른 파일)를 다뤄 독립 작성·리뷰가 가능함을 뜻한다. 동일 파일에 대한 다중 편집은 실제 머지 단계에서 순차 진행을 권장.
- 본 feature의 hard predecessor는 Task 2(공통 `citations[]` 배열 도입)의 머지다. 미머지 상태에서 본 feature를 머지하면 모든 케이스가 0 citation을 보고해 false negative 회귀 신호를 생성한다(plan Risks & Mitigations).
- 기존 `./benchmarks/adoption.json`, `./scripts/run-benchmark.mjs`, `./package.json`의 `scripts.benchmark`는 본 feature의 어떤 단계에서도 수정하지 않는다(spec FR-008, SC-003).
- 실 provider 호출 풀 실행은 본 spec의 통과 조건이 아니다(spec Assumptions). 평가기 단위 테스트와 suite JSON 파싱 가드만으로 acceptance를 종료한다.
