---
description: "Task list for spec 012 — Symbol Precision Extension (edge case baselines)"
---

# Tasks: Symbol Precision Extension — Edge Case Baselines

**Input**: Design documents from `specs/012-symbol-precision-extension/`

**Prerequisites**: `specs/012-symbol-precision-extension/spec.md`, `specs/012-symbol-precision-extension/plan.md`

**Tests**: Required. 본 feature 자체가 회귀 테스트 추가와 경계 문서 보강을 목적으로 한다.

**Organization**: User story 단위로 task 묶음.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 만지고 선행 의존성이 없으면 병렬 가능
- **[Story]**: US1 = 분류기 회귀 테스트, US2 = parser-free 경계 단락 보강
- 모든 경로는 저장소 루트 기준 상대 경로로 기술한다.

## Path Conventions

- 단일 프로젝트 구조: `tests/symbols.test.mjs`, 루트 `DESIGN.md`, `plan/extension-backlog.md`
- 본 작업에서 신규 디렉터리/모듈은 만들지 않는다.
- `src/explorer/symbols.mjs`는 본 작업에서 수정하지 않는다 (분류기 의미 개선은 후속 spec).

---

## Phase 1: Setup

**Purpose**: 작업 트리 정리 및 현재 분류기 출력의 spec 측정값 재현.

- [x] T001 master 브랜치에서 시작하며 작업 트리가 깨끗한지 확인한다 (`git status` clean). spec 008의 기존 분류기 테스트가 0 failures로 PASS하는지 `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference"` 1회로 확인한다.

- [x] T002 [P] 임시 1회용 측정 스크립트로 spec.md User Story 1 Acceptance Scenarios 8건의 입력을 다시 `classifyReference()`에 통과시키고, 각 결과(`{ type, relation }`)가 spec.md의 기대 라벨과 정확히 일치하는지 확인한다. 차이가 발견되면 즉시 spec.md Assumptions 절을 재검토하고 본 작업 진행을 중단한다 (코드 변경 없음).

---

## Phase 2: User Story 1 — Edge case baseline 회귀 테스트 (P1)

**Purpose**: 5개 영역(공백 멤버 호출, 다중 패턴 라인, JSX, 데코레이터, 동적 임포트)의 현재 분류 결과를 단위 테스트로 굳혀, 정규식/ordered checks 변경이 우발적으로 baseline을 깰 때 즉시 실패하도록 한다.

- [x] T003 [US1] `tests/symbols.test.mjs`에서 spec 008이 추가한 `classifyReference distinguishes member, call, constructor, and type relations` 테스트(현재 분류기 4 baseline) 바로 아래 위치를 결정한다 (사람 리뷰만, 코드 변경 없음).

- [x] T004 [US1] T003에서 결정한 위치에 신규 테스트 `classifyReference baselines edge case patterns for spaced member calls, multi-pattern lines, JSX, decorators, and dynamic imports`를 추가한다. spec.md User Story 1의 8개 acceptance scenario를 한 테스트 안에서 `assert.deepEqual` 8회로 검증한다.

- [x] T005 [US1] `node --test tests/symbols.test.mjs` 단독 실행으로 신규 테스트가 PASS하고 spec 008의 기존 분류기 테스트가 그대로 PASS함을 확인한다.

**Checkpoint**: User Story 1만으로도 회귀 가드가 성립한다. User Story 2를 시작하지 않아도 본 시점에 단위 검증 가능.

---

## Phase 3: User Story 2 — DESIGN.md parser-free 경계 단락 보강 (P2)

**Purpose**: 분류기 출력에 의존하는 호출자가 5개 영역의 현재 한계를 한 곳에서 인지할 수 있도록 문서를 보강한다.

- [x] T006 [US2] `DESIGN.md`의 parser-free 경계 단락 위치를 확인한다 (spec 008이 추가한 단락). 신규 단락이 들어갈 위치는 기존 단락 바로 뒤로 고정한다.

- [x] T007 [US2] T006에서 확인한 위치에 신규 단락을 한 단락(최대 ~150 단어)으로 추가한다. 단락은 5개 영역(공백 멤버 호출, 다중 패턴 라인, JSX, 데코레이터, 동적 임포트) 각각에 대해 "현재 분류기가 어떤 라벨로 분류하고, 그 라벨이 의미와 다를 수 있는 영역인지" 한 문장씩 명시하고, 끝에서 "호출자는 의미적 확신이 필요할 때 라인 범위를 별도 검증해야 한다"를 한 번 더 반복한다.

- [x] T008 [US2] `grep`으로 5개 영역의 키워드("공백 멤버 호출" 또는 "spaced", "다중 패턴" 또는 "multi-pattern", "JSX", "데코레이터" 또는 "decorator", "동적 임포트" 또는 "dynamic import")가 모두 DESIGN.md에 등장하는지 확인한다.

---

## Phase 4: Wrap-up

**Purpose**: backlog 갱신, 전체 회귀 검증, 단일 커밋 생성.

- [x] T009 `plan/extension-backlog.md` §4의 "우선순위와 다음 단계" 부근에 "→ spec 012(`symbol-precision-extension`)로 완료"를 한 줄 추가한다.

- [x] T010 `npm test` 전체를 1회 실행해 0 failures를 확인한다. spec 008의 기존 단위 테스트가 그대로 통과함을 함께 확인한다.

- [x] T011 본 spec의 변경분을 단일 커밋으로 묶는다. 메시지: `test(spec-012): baseline edge case classifier behavior for parser-free symbols`. 변경 파일: `tests/symbols.test.mjs`, `DESIGN.md`, `plan/extension-backlog.md`, `specs/012-symbol-precision-extension/spec.md`, `specs/012-symbol-precision-extension/plan.md`, `specs/012-symbol-precision-extension/tasks.md`.
