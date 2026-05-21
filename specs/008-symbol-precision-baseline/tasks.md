---

description: "Task list for Task 8 — Symbol Precision Baseline Coverage"
---

# Tasks: Symbol Precision Baseline Coverage

**Input**: Design documents from `specs/008-symbol-precision-baseline/`

**Prerequisites**: `specs/008-symbol-precision-baseline/spec.md`, `specs/008-symbol-precision-baseline/plan.md`

**Tests**: Required. 본 feature 자체가 회귀 테스트 추가와 경계 문서화를 목적으로 한다. 신규 단위 테스트는 선택 사항이 아니라 본 작업의 핵심 산출물이다.

**Organization**: Tasks는 user story(US1/US2/US3) 단위로 묶어 독립적으로 테스트 가능하도록 한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 만지고 선행 의존성이 없으면 병렬 가능
- **[Story]**: US1 = 분류기 회귀 테스트, US2 = parser-free 경계 문서화, US3 = (조건부) 분류기 보정
- 모든 경로는 저장소 루트 기준 상대 경로로 기술한다.

## Path Conventions

- 단일 프로젝트 구조: `src/explorer/symbols.mjs`, `tests/symbols.test.mjs`, 루트의 `DESIGN.md`
- 본 작업에서 신규 디렉터리나 모듈을 만들지 않는다.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 본 feature의 변경 면적 확인과 작업 브랜치 정렬

- [ ] T001 작업 브랜치 `008-symbol-precision-baseline` 으로 체크아웃되어 있고, `tests/symbols.test.mjs`, `src/explorer/symbols.mjs`, `DESIGN.md` 의 작업 트리가 깨끗한지 확인한다 (`git status` 가 clean).
- [ ] T002 [P] `specs/008-symbol-precision-baseline/spec.md` 의 User Story 1 Acceptance Scenarios 4건과 `specs/008-symbol-precision-baseline/plan.md` Implementation Outline Step (b) 의 입력/기대값이 정확히 일치하는지 본 tasks.md 작성자가 1회 교차 확인한다 (코드 변경 없음, 사람 리뷰만).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 기존 분류기 동작이 spec.md User Story 1 의 4 케이스를 이미 만족하는지 사전 확인. 이 단계에서 코드 변경은 절대 발생하지 않는다.

**중요**: 본 단계가 끝나기 전까지 어떤 User Story 작업도 시작하지 않는다.

- [ ] T003 `node --test tests/symbols.test.mjs` 를 변경 없이 실행해 0 failures 로 PASS 하는지 확인한다. 만약 사전 단계에서 이미 FAIL 한다면 본 작업과 무관한 회귀이므로 즉시 보고하고 본 feature 진행을 중단한다.
- [ ] T004 [P] `src/explorer/symbols.mjs` 의 `relationForUsage()` (라인 379-410 부근) 와 `classifyReference()` 가 plan.md Implementation Outline Step (c) 에 기술된 ordered checks (export → type_reference → constructor → call(왼쪽 경계 negative class) → member_call → property → reference) 를 그대로 가지고 있는지 사람 리뷰로 확인한다. 차이가 있으면 spec.md FR-005 와 plan.md 의 "동치 표현" 해석을 다시 검토한다.

**Checkpoint**: 기존 분류기 동작이 4 케이스를 이미 만족함을 확인 → User Story 작업 가능.

---

## Phase 3: User Story 1 - 분류기 회귀 베이스라인 확정 (Priority: P1) MVP

**Goal**: `classifyReference` 의 4 대표 케이스(`member_call`, `constructor`, `type_reference`, `call`) 분류 결과를 단위 테스트로 굳혀, 향후 분류기 회귀가 PR 단계에서 즉시 FAIL 로 포착되게 한다.

**Independent Test**: `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference distinguishes"` 단독 실행으로 신규 테스트 PASS 를 확인할 수 있다. spec.md SC-002 와 동일한 게이트.

### Implementation for User Story 1

- [ ] T005 [US1] `tests/symbols.test.mjs` 의 기존 `test('classifyReference adds relation details without changing legacy type', ...)` (라인 240 부근) 바로 다음 위치에, 신규 테스트 `test('classifyReference distinguishes member, call, constructor, and type relations', ...)` 를 추가한다. 단일 `test(...)` 블록 안에 네 개의 `assert.deepEqual` 호출만 둔다.
- [ ] T006 [US1] T005 의 테스트 블록 안에 다음 4 assertion 을 plan.md Implementation Outline Step (b) 와 spec.md User Story 1 Acceptance Scenarios 와 동일한 입력/기대값으로 추가한다:
  - `assert.deepEqual(classifyReference('session.touch();', 'touch', 'session.ts'), { type: 'usage', relation: 'member_call' })`
  - `assert.deepEqual(classifyReference('const manager = new SessionManager();', 'SessionManager', 'session.ts'), { type: 'usage', relation: 'constructor' })`
  - `assert.deepEqual(classifyReference('type Handler = (req: Request) => Response;', 'Request', 'types.ts'), { type: 'usage', relation: 'type_reference' })`
  - `assert.deepEqual(classifyReference('return requireAuth(req, res, next);', 'requireAuth', 'routes.js'), { type: 'usage', relation: 'call' })`
- [ ] T007 [US1] `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference distinguishes"` 를 실행해 신규 테스트가 단독으로 PASS 하는지 확인한다. 사전 검증 결과 분류기는 이미 4 케이스를 모두 분류하므로 정상 흐름에서는 PASS 가 예상된다.
- [ ] T008 [US1] `node --test tests/symbols.test.mjs` 전체 실행으로 기존 테스트들 (`classifyReference adds relation details without changing legacy type`, `repo_references finds symbol definition and usages across files`, `repo_references handles JavaScript private symbol names` 등) 이 모두 PASS 함을 확인한다. 회귀가 발견되면 Phase 5(US3) 를 발동한다.

**Checkpoint**: User Story 1 단독으로 검증 가능. SC-002, SC-004 충족.

---

## Phase 4: User Story 2 - parser-free 경계 문서화 (Priority: P2)

**Goal**: `DESIGN.md` 의 Phase 3 섹션 끝에 parser-free 분류기의 의도와 한계를 명시해, `repo_references`/`repo_symbol_context` 호출자가 분류 결과를 "타겟 맵" 으로만 사용하고 라인 범위를 별도 검증하게 유도한다.

**Independent Test**: `DESIGN.md` 만 읽어도 (a) 6개 카테고리, (b) LSP 비완전성, (c) 라인 범위 별도 검증 권고 의 세 요소를 모두 파악할 수 있는지 `Grep` 또는 사람 리뷰로 확인한다. spec.md User Story 2 Independent Test 와 동일.

### Implementation for User Story 2

- [ ] T009 [P] [US2] `DESIGN.md` 의 `## 17. 추후 확장` 안 `### Phase 3 — 의존성 최소화 심볼 엔진 정밀도 향상` 섹션(라인 615-643 부근) 끝, `### Phase 4 — 런타임 고도화` 직전 위치를 식별한다. 기존 본문 1~4 항목을 삭제하거나 의미를 바꾸지 않는다.
- [ ] T010 [US2] T009 에서 식별한 위치에 `Parser-free 분류기 경계` 단락(또는 Phase 3 의 새 하위 항목 `5.`)을 추가한다. 단락은 다음 세 요소를 모두 포함해야 한다 (spec.md FR-006):
  - (a) `repo_references` 와 `repo_symbol_context` 가 돌려주는 `relation` 카테고리 목록 6개: `call`, `member_call`, `constructor`, `type_reference`, `import`, `export`.
  - (b) 이 분류는 정규식 기반 syntax-lite 추론이며 LSP/tree-sitter 수준의 완전성(스코프 분석, 타입 해석, JSX, 데코레이터, 동적 import 전개) 을 주장하지 않는다는 단서.
  - (c) 신뢰가 중요한 편집 직전에는 `repo_read` 등으로 라인 범위를 별도 검증하라는 권고. 분류 결과는 "타겟 맵" 용도로만 사용한다고 명시.
- [ ] T011 [US2] T010 의 단락이 Phase 3 본문의 기존 1~4 항목과 모순되지 않는지, 그리고 본 작업이 카테고리 집합을 확장하지 않음을 함께 명시했는지 사람 리뷰로 확인한다 (spec.md FR-004 의 "신규 분류 카테고리 추가 금지" 와 일관).
- [ ] T012 [US2] `Grep` 으로 `DESIGN.md` 안에서 6개 카테고리 토큰 (`call`, `member_call`, `constructor`, `type_reference`, `import`, `export`), `LSP`, `라인 범위` 키워드가 새 단락 안에 모두 등장하는지 단순 검증한다.

**Checkpoint**: User Story 2 단독으로 검증 가능. SC-003 충족. US1 과 다른 파일을 만지므로 US1 과 병렬 가능.

---

## Phase 5: User Story 3 - (조건부) 분류기 갭 보정 (Priority: P3)

**Goal**: Phase 3 (User Story 1) 의 신규 테스트가 FAIL 한 경우에만 발동되는 안전망. plan.md Step 3 의 ordered-checks 패치를 `relationForUsage()` 에 적용해 갭을 메운다. 정상 흐름에서는 본 Phase 전체를 SKIP 한다.

**조건부 실행**: T007 또는 T008 에서 신규 테스트가 PASS 했으면 본 Phase 의 모든 task 는 SKIP. FAIL 케이스가 정확히 어떤 입력인지 식별 후에만 T013 이하를 진행한다.

**Independent Test**: 의도적으로 분류기에서 한 분기 (예: `member_call`) 를 제거해 FAIL 을 재현한 뒤, plan.md Step 3 의 패치를 적용했을 때 단일 케이스가 다시 PASS 하는지 확인한다 (spec.md User Story 3 Independent Test 와 동일).

### Implementation for User Story 3

- [ ] T013 [US3] (조건부) T007/T008 의 FAIL 출력에서 어떤 입력 라인이 어떤 `relation` 으로 잘못 분류되었는지 식별한다. 4 케이스 중 어떤 케이스가 깨졌는지에 따라 보정 범위를 결정한다.
- [ ] T014 [US3] (조건부) `src/explorer/symbols.mjs` 의 `relationForUsage()` ordered checks 만을 spec.md FR-005 (`constructor` → `member_call` → `call` 의 동치 표현) 가 유지되도록 보정한다. `type_reference` 분기는 별도 검사로 남긴다. `categorizeReference()` 의 legacy 반환값 (`definition|import|usage`) 계약과 분류 카테고리 집합은 절대 변경하지 않는다 (spec.md FR-003, FR-004).
- [ ] T015 [US3] (조건부) `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference distinguishes"` 단독 PASS 와, 전체 `node --test tests/symbols.test.mjs` PASS 를 모두 다시 확인한다. 기존 `classifyReference adds relation details without changing legacy type` 테스트의 결과가 변하지 않았는지 확인한다.
- [ ] T016 [US3] (조건부) 보정으로 신규 분류 카테고리나 신규 키가 추가되지 않았는지, 그리고 `repo_references` 통합 테스트 (라인 315-341 부근) 의 기대값이 그대로 유지되는지 사람 리뷰로 확인한다.

**Checkpoint**: 조건부 Phase. 발동 시 SC-001, SC-004 가 다시 만족됨을 확인한다.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 본 작업의 최종 게이트 확인. spec.md Success Criteria 와 plan.md Test Strategy 의 게이트를 한 번에 점검한다.

- [ ] T017 `node --test tests/symbols.test.mjs` 전체 실행이 0 failures 로 종료하는지 확인한다 (spec.md FR-008, SC-001).
- [ ] T018 [P] `tests/symbols.test.mjs` 의 라인 240-360 범위에서 기존 테스트들 (`classifyReference adds relation details without changing legacy type`, `repo_references finds symbol definition and usages across files`, `repo_references handles JavaScript private symbol names`) 의 본문과 기대값이 본 작업으로 인해 변경되지 않았는지 `git diff` 로 확인한다 (spec.md Assumptions: 기존 테스트 의미 불변).
- [ ] T019 [P] `git diff --stat` 으로 본 작업의 커밋 범위가 `tests/symbols.test.mjs`, `DESIGN.md`, 그리고 (US3 발동 시에 한해) `src/explorer/symbols.mjs` 로만 한정되어 있는지 확인한다 (spec.md FR-009).
- [ ] T020 spec.md Success Criteria SC-001 ~ SC-005 를 한 줄씩 체크하고, 충족되지 않은 항목이 있으면 해당 Phase 로 돌아간다. 본 task 가 통과해야 작업 종료.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 의존성 없음. 즉시 시작.
- **Phase 2 (Foundational)**: Phase 1 완료 후 시작. 모든 User Story 를 블록한다.
- **Phase 3 (US1)**: Phase 2 완료 후 시작. Phase 4 와 다른 파일을 만지므로 Phase 4 와 병렬 가능.
- **Phase 4 (US2)**: Phase 2 완료 후 시작. Phase 3 과 병렬 가능.
- **Phase 5 (US3)**: Phase 3 의 T007/T008 결과에 따라 조건부 발동. 정상 흐름에서는 SKIP.
- **Phase 6 (Polish)**: Phase 3 + Phase 4 완료 후 시작. US3 가 발동된 경우 Phase 5 까지 완료된 후 시작.

### User Story Dependencies

- **US1 (P1)**: Foundational (Phase 2) 후 단독 시작 가능. 다른 user story 에 의존하지 않음.
- **US2 (P2)**: Foundational (Phase 2) 후 단독 시작 가능. US1 과 다른 파일 (`DESIGN.md`) 을 만지므로 완전히 독립.
- **US3 (P3)**: US1 의 신규 테스트 결과에 조건부로 의존. 정상 흐름에서는 발동되지 않음.

### Within Each User Story

- US1: T005 (테스트 블록 추가) → T006 (4 assertion 채우기) → T007 (단독 PASS 확인) → T008 (전체 PASS 확인). 순차.
- US2: T009 (위치 식별) → T010 (단락 작성) → T011 (모순 검증) → T012 (Grep 검증). 순차.
- US3: T013 → T014 → T015 → T016. 조건부 순차.

### Parallel Opportunities

- T002 (Phase 1) 는 T001 과 독립이므로 병렬 가능.
- T004 (Phase 2) 는 T003 과 독립이므로 병렬 가능.
- Phase 3 (US1) 과 Phase 4 (US2) 는 서로 다른 파일을 만지므로 완전 병렬 가능.
- T009 (Phase 4) 는 Phase 3 의 어떤 task 와도 파일 충돌이 없어 [P] 표시.
- Phase 6 의 T018, T019 는 서로 다른 검증 단면이므로 병렬 가능.

---

## Parallel Example: Phase 3 와 Phase 4 동시 진행

```bash
# 같은 사람이 진행해도 파일 충돌이 없으므로 한 세션 안에서 교차 작업 가능
# 트랙 A (US1): tests/symbols.test.mjs 만 만짐
#   T005 → T006 → T007 → T008
# 트랙 B (US2): DESIGN.md 만 만짐
#   T009 → T010 → T011 → T012
# 두 트랙이 모두 완료된 뒤 Phase 6 진입
```

---

## Implementation Strategy

### MVP First (User Story 1 만)

1. Phase 1 (Setup) 완료.
2. Phase 2 (Foundational) 완료 — 기존 분류기가 4 케이스를 이미 만족함을 확인.
3. Phase 3 (US1) 완료 → 신규 테스트 단독 PASS + 전체 PASS 확인.
4. **STOP & VALIDATE**: spec.md SC-002, SC-004 충족 확인. 여기까지 커밋해도 회귀 가드는 이미 확보됨.

### Incremental Delivery

1. Setup + Foundational → 기반 확인.
2. US1 완료 → 회귀 테스트 가드 확보 (MVP, spec.md SC-002/SC-004).
3. US2 완료 → 호출자 오용 방지 문서 추가 (spec.md SC-003).
4. (조건부) US3 발동 시 → 회귀 보정 (spec.md SC-001 재확인).
5. Phase 6 → 모든 SC 게이트 통과 확인.

### Parallel Team Strategy

여러 명이 진행할 경우:

1. Phase 1 + Phase 2 는 한 사람이 완료.
2. Phase 2 종료 후:
   - 개발자 A: Phase 3 (US1, `tests/symbols.test.mjs` 만 만짐)
   - 개발자 B: Phase 4 (US2, `DESIGN.md` 만 만짐)
3. 두 명 모두 종료 후 Phase 6 를 한 사람이 정리.
4. US3 는 Phase 3 결과에 따라 조건부 발동 — 발동 시 개발자 A 가 이어서 진행.

---

## Notes

- [P] 표시는 서로 다른 파일을 만지며 선행 의존성이 없는 task 에만 부여한다.
- 본 작업은 단위 테스트 추가와 문서 단락 추가가 핵심이며, 정상 흐름에서 `src/explorer/symbols.mjs` 는 변경하지 않는다 (spec.md Assumptions, plan.md Implementation Outline Step (c)).
- 신규 테스트는 반드시 `assert.deepEqual` 을 사용해 `{ type, relation }` 키 집합과 값 라벨을 동시에 가드한다 (`assert.equal` 로 풀어 쓰지 않는다).
- `DESIGN.md` 단락은 Phase 3 본문 1~4 항목의 의미를 바꾸지 않고 끝에 추가한다.
- 커밋 범위는 `tests/symbols.test.mjs`, `DESIGN.md`, (조건부) `src/explorer/symbols.mjs` 로 제한한다 (spec.md FR-009).
- US3 가 발동되지 않은 경우 본 tasks.md 의 T013~T016 은 그대로 미체크 상태로 남겨 둔다 (조건부 SKIP 임을 기록으로 남기기 위함).
- 본 작업은 plan 의 Task 9 (문서/검증 마감) 와 별도 커밋이며 Task 9 의 전체 `npm test` 회귀 게이트가 본 베이스라인을 다시 확인한다.
