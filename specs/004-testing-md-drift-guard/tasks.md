---
description: "Tasks for Task 4 — TESTING.md 고정 테스트 수치 제거 및 Drift 가드"
---

# Tasks: TESTING.md 고정 테스트 수치 제거 및 Drift 가드

**Input**: Design documents from `specs/004-testing-md-drift-guard/`

**Prerequisites**: plan.md (필수), spec.md (필수)

**Tests**: Required — 본 작업의 User Story 2 자체가 drift 가드 테스트를 추가하는 것이므로 테스트 작업은 필수이며 OPTIONAL이 아니다.

**Organization**: 작업은 User Story별로 묶여 있어, US1(TESTING.md 정리)과 US2(가드 테스트 추가)는 각각 독립적으로 구현·검증 가능하다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 다루고 의존성이 없어 병렬 실행 가능한 작업
- **[Story]**: 해당 작업이 속한 User Story (US1, US2)
- 모든 경로는 저장소 루트 기준 상대 경로로 표기한다

## Path Conventions

- **변경 대상 파일 2개**:
  - `TESTING.md` (루트)
  - `tests/integrations.test.mjs`
- **읽기 전용 참고 파일**:
  - `docs/superpowers/plans/2026-05-19-tool-quality-improvements.md` (원본 plan Task 4)
  - `AGENTS.md` (doc-snapshot 가드 운영 규약)
- **런타임 코드 변경 금지**: `src/**`, `scripts/**`, `package.json`은 본 작업에서 수정하지 않는다.

---

## Phase 1: Setup (공유 인프라)

**Purpose**: 본 작업 시작 전 저장소 상태 확인 및 작업 범위 고정

- [x] T001 현재 체크아웃이 `004-testing-md-drift-guard` 브랜치이며 `git status`가 깨끗한지 확인
- [x] T002 [P] `TESTING.md` 현재 본문에서 단위 섹션 17행("320 tests"), 통합 섹션 39행("5/5 통과"), stdio smoke 섹션 58행("도구 8개") 위치를 직접 열어 줄 번호 일치 확인 (편집 좌표 고정)
- [x] T003 [P] `tests/integrations.test.mjs` 말미 위치와 기존 doc-snapshot 가드 패턴(`fs.readFile` + `assert.doesNotMatch`/`assert.match`) 확인 (신규 블록 append 위치 고정)

---

## Phase 2: Foundational (선결 차단 조건)

**Purpose**: 모든 User Story가 의존하는 공통 불변 조건을 확정

**⚠️ CRITICAL**: 이 Phase가 끝나야 US1/US2 작업 진입 가능

- [x] T004 `TESTING.md`의 디스클레이머 문장 — "이 문서의 숫자는 마지막 관측값이며 실제 기준은 항상 현재 checkout에서의 `npm test` 결과" 취지의 문장 — 이 단위/통합/smoke 세 섹션 중 최소 한 곳에 살아 있는지 확인하고, 현재 위치(단위 섹션 21행 부근)를 보존 대상으로 명시 (FR-004)
- [x] T005 `TESTING.md`의 "최근 확인 환경" 메타데이터 블록(3~9행 부근)의 날짜/Node/npm/OS 값과 "Cerebras API 에러 코드 참조" 표(80~94행 부근)의 HTTP 코드(400, 401, 408, 429, 500, 502, 503, 504)는 가드 대상 외이며 편집·삭제 금지임을 명시
- [x] T006 가드 정규식 5종이 모두 "테스트 결과 단어(`tests`, `pass`, `skipped`, `통과`, `도구`)가 숫자 뒤에 결합된 형태"만 매칭하도록 설계됨을 확인 (단독 숫자 400/429 등은 어떤 정규식과도 매칭되지 않아야 함, spec Edge Cases 마지막 항목)

**Checkpoint**: 디스클레이머 유지 위치와 가드 비대상 영역이 확정됨 → US1/US2 진입 가능

---

## Phase 3: User Story 1 - 릴리스 검증자가 고정된 숫자를 신뢰 기준으로 오해하지 않는다 (Priority: P1) 🎯 MVP

**Goal**: `TESTING.md`에서 시간이 지나면 낡아 버리는 절대 수치 3종(`320 tests` 류, `5/5 통과`, `도구 8개`)을 제거하고 합격 기준을 행위 기준 문장으로 재서술

**Independent Test**: 새 검증자가 정리된 `TESTING.md`만 읽고 `npm test`/통합 테스트/stdio smoke의 합격·실패 판정 기준을 1분 이내에 진술할 수 있으며, 진술 어디에도 절대 숫자가 등장하지 않는다.

### Implementation for User Story 1

- [x] T007 [US1] `TESTING.md` 단위 테스트 섹션 17행 부근 "최근 관측 결과(2026-05-21): `320 tests`, `319 pass`, `1 skipped`, `0 fail`." 문장에서 `320 tests`, `319 pass`, `1 skipped` 세 절대 수치 제거. 대체 문장은 "성공 기준 = `npm test`가 `0 fail`로 종료" 형태로 재서술하되, `npm test`와 `0 fail` 토큰은 본문에 반드시 유지 (FR-001, FR-006 양성 어서션 대상)
- [x] T008 [US1] `TESTING.md` 단위 테스트 섹션 21행 부근 디스클레이머 문장 — "이 문서의 숫자는 마지막 관측값입니다. 실제 기준은 항상 위 `npm test` 실행 결과입니다." — 가 그대로 살아 있는지 확인 (FR-004, T004와 연동)
- [x] T009 [US1] `TESTING.md` 통합 테스트 섹션 39행 부근 "전체 결과: `5/5` 통과." 문장을 삭제하고 "스크립트가 보고하는 모든 케이스가 통과(스크립트가 `0 fail`로 종료)" 형태의 행위 기준 문장으로 대체. 케이스별 결과 표(31~37행 부근)의 "통과/실패" 마커는 운영 정보로 유지 (FR-002, spec Assumptions 일치)
- [x] T010 [US1] `TESTING.md` stdio smoke 섹션 58행 부근 "`tools/list`에서 기본 공개 도구 8개 확인" 문장에서 `8개`를 제거하고 "`tools/list` 응답에서 공개 도구 목록이 누락 없이 반환되는 것을 확인" 형태로 재서술. 같은 섹션 내 다른 줄에 잔존하는 `도구 N개`/`N개 공개 도구`/`N개 도구` 형태가 있는지 확인하고 발견 시 동일 방식으로 제거 (FR-003)
- [x] T011 [US1] 편집 후 `TESTING.md` 본문에 대해 spec FR-005 다섯 정규식의 매칭 건수가 0임을 수동 확인(예: 에디터 검색 또는 grep): `\b\d+\s+tests\b`, `\b\d+\s+pass\b`, `\b\d+\s+skipped\b`, `\b\d+\s*/\s*\d+\s*통과\b`, `\b\d+\s*개\s*(공개\s*)?도구\b` (SC-002)
- [x] T012 [US1] 편집 후 `TESTING.md` 본문에 `npm test` 표기와 `0 fail`(또는 `0 failures`) 문구가 각각 최소 1회 이상 등장하는지 수동 확인 (SC-003)

**Checkpoint**: User Story 1만 단독으로 완료해도 릴리스 검증자가 `TESTING.md`에서 절대 수치에 오도되지 않는 MVP 상태가 된다. US2 없이도 1회성 청소 가치는 살아 있다.

---

## Phase 4: User Story 2 - Drift 가드가 향후 고정 수치 재유입을 자동으로 차단한다 (Priority: P2)

**Goal**: `tests/integrations.test.mjs`에 단일 `test(...)` 블록을 append하여, `TESTING.md`에 금지 패턴이 재유입될 때 `npm test` 단계에서 즉시 실패시키는 자동 가드를 설치

**Independent Test**: 가드 테스트만 단독 실행해 통과를 확인한 뒤, `TESTING.md`에 임의로 `320 tests` 같은 문구를 다시 추가한 사본을 만들면 같은 가드가 빨갛게 떨어지고 실패 메시지에 위반 패턴이 식별 가능한 형태로 출력된다.

### Tests for User Story 2 (필수 — 본 작업의 핵심 산출물) ⚠️

> **NOTE**: 본 작업에서 추가하는 가드 자체가 테스트이므로, "테스트를 먼저 작성해 실패시킨다"는 일반적 TDD 흐름 대신 "US1 완료(=금지 패턴 0건) 상태에서 가드를 추가해 통과시킨다 → 의도적 위반 inject로 가드가 실제로 떨어지는지 검증한다" 순서를 따른다.

- [x] T013 [US2] `tests/integrations.test.mjs` 말미에 신규 `test(...)` 블록 append. 블록 이름은 `TESTING.md`라는 식별 키워드를 포함하여 `--test-name-pattern "TESTING.md"`로 단독 실행 가능해야 함 (예: `test('TESTING.md does not pin absolute test totals or fixed tool counts', ...)`). SC-001 호환
- [x] T014 [US2] 같은 블록 본문에서 `await read('TESTING.md')`(또는 동등한 기존 헬퍼)로 `TESTING.md` 본문을 메모리에 1회 적재. 신규 import는 추가하지 않고 파일 상단 기존 import(`node:test`, `node:assert/strict`, `node:fs/promises` 등)만 사용
- [x] T015 [US2] 같은 블록에 금지 패턴 어서션 5건(`assert.doesNotMatch`) 추가 (FR-005):
  - `/\b\d+\s+tests\b/` — 단위 테스트 총수
  - `/\b\d+\s+pass\b/` — 단위 테스트 통과수 (단어 경계로 `bypass`/`passport`/`passing` 등 무관 단어 배제)
  - `/\b\d+\s+skipped\b/` — skip 수
  - `/\b\d+\s*\/\s*\d+\s*통과\b/` — 통합 테스트 고정 분수(공백 변형 허용)
  - `/\b\d+\s*개\s*(공개\s*)?도구\b/` — stdio smoke 도구 개수
- [x] T016 [US2] 같은 블록에 양성 어서션 2건(`assert.match`) 추가 (FR-006):
  - `/\bnpm test\b/` — 합격 기준 명령이 본문에 살아 있는지
  - `/\b0\s+(fail|failures)\b/` — `0 fail`(또는 `0 failures`) 표기가 본문에 살아 있는지
- [x] T017 [US2] 7개 어서션 각각의 세 번째 인자(메시지)에 어떤 정규식이 어떤 의도를 검사했는지 표시(예: `'TESTING.md must not pin absolute unit test count (\\d+ tests)'`). `node:test` 실패 시 이 문자열로 위반 패턴 식별 가능해야 함 (FR-007)

**Checkpoint**: User Story 2가 추가되면 US1의 1회성 청소 효과가 자동 가드로 영속화된다. US1 단독 완료 상태와 비교해 회귀 방지 보장이 추가된다.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 가드 단독 통과와 의도적 위반 시 실패를 모두 실증하여 작업이 닫힘을 확인

- [x] T018 가드 테스트 단독 실행: `node --test tests/integrations.test.mjs --test-name-pattern "TESTING.md"`가 0 fail로 통과하는지 확인 (SC-001)
- [x] T019 의도적 위반 inject 검증(SC-004): `TESTING.md` 사본에 `320 tests`를 임시 삽입하고 T018 명령 재실행 → 실패 + 위반 패턴 메시지(T017에서 지정한 정규식/의도 문자열) 출력 확인 후 사본 폐기. 동일 절차를 `5/5 통과`, `공개 도구 8개`에 대해 각각 1회씩 반복하여 3개 위반 패턴이 모두 실제로 가드를 트리거함을 확인. inject 흔적은 커밋에 포함하지 않음
- [x] T020 양성 어서션 자기 검증: `TESTING.md` 사본에서 `0 fail` 토큰을 임시 제거하고 T018 명령 재실행 → `/\b0\s+(fail|failures)\b/` 양성 어서션 실패 확인 후 사본 폐기 (FR-006이 실제 작동함을 입증)
- [x] T021 전체 회귀: `npm test`가 0 fail로 종료하는지 확인. 기존 doc-snapshot 가드 군과의 충돌 부재 확인
- [x] T022 PR diff 최종 점검: 변경 파일이 `TESTING.md`와 `tests/integrations.test.mjs` 두 개뿐이며 `src/**`, `scripts/**`, `package.json`이 비어 있는지 확인

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 즉시 시작 가능
- **Foundational (Phase 2)**: Phase 1 완료 후 진입. US1/US2를 모두 차단
- **User Story 1 (Phase 3)**: Phase 2 완료 후 진입. US2 없이도 단독 완성 가능 (MVP)
- **User Story 2 (Phase 4)**: Phase 2 완료 후 진입. US1 완료 상태를 전제로 가드가 첫 실행에서 통과해야 하므로, **실무상 US1 → US2 순서를 권장**
- **Polish (Phase 5)**: US2까지 완료 후 진입

### User Story Dependencies

- **User Story 1 (P1, MVP)**: Foundational 이후 즉시 시작. 다른 스토리에 의존하지 않음
- **User Story 2 (P2)**: Foundational 이후 시작 가능하나, US1이 끝나지 않은 상태에서 가드를 추가하면 가드 자체가 즉시 실패하므로 US1 완료 후 진입하는 것이 자연스러움. 가드 정규식 5종은 US1이 제거 대상으로 삼는 패턴과 동일하므로, 두 스토리는 정규식 명세를 공유한다(Phase 2 T006에서 명세 확정).

### Within Each User Story

- **US1 내부 순서**: T007 → T008 → T009 → T010 → T011 → T012 (단위 → 통합 → smoke → 검증). T007, T009, T010은 서로 다른 섹션을 편집하지만 같은 파일이라 [P] 표시는 하지 않음
- **US2 내부 순서**: T013(블록 생성) → T014(파일 적재) → T015(금지 어서션 5건) → T016(양성 어서션 2건) → T017(메시지 부착). 모두 같은 파일·같은 블록 내부 작업이라 직렬 진행

### Parallel Opportunities

- Phase 1의 T002, T003은 서로 다른 파일을 읽기만 하므로 병렬 가능
- Phase 3과 Phase 4는 서로 다른 파일을 편집하므로 이론적으로 병렬 가능하나, 위 "User Story Dependencies" 사유로 직렬 권장
- Phase 5의 T018~T022는 직렬(각 단계가 이전 결과를 전제로 함)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup 완료
2. Phase 2 Foundational 완료 (디스클레이머·비대상 영역·정규식 명세 확정)
3. Phase 3 User Story 1 완료 → `TESTING.md`만 정리된 상태로 PR 가능 (가드 없는 1회성 청소)
4. **STOP & VALIDATE**: 새 검증자가 정리된 `TESTING.md`만 보고 1분 이내 합격 기준을 진술할 수 있는지 검증

### Incremental Delivery (권장)

1. Setup + Foundational → 명세 확정
2. US1 추가 → `TESTING.md` 정리 → MVP 배포 가능
3. US2 추가 → 가드 설치 → 회귀 방지 영속화
4. Polish → 단독 통과·의도적 위반·전체 회귀 모두 실증

---

## Notes

- [P] = 다른 파일, 의존성 없음. 본 작업은 변경 파일이 2개뿐이라 같은 스토리 내 [P]는 거의 없음
- [Story] 라벨로 US1/US2 트레이서빌리티 유지
- 가드 정규식은 특정 숫자가 아닌 일반형(예: `\d+/\d+\s*통과`)을 거부하므로 미래 케이스 수 증가(5→7 등)도 동일하게 차단됨 (spec Edge Cases 1번)
- API 에러 코드 표의 단독 숫자(400, 429 등)는 어떤 정규식과도 매칭되지 않으며 가드 대상이 아님 (spec Edge Cases 4번, plan Risks 1번)
- `0 fail`은 양성 어서션 대상이므로 US1에서 절대 수치 제거 시 의도적으로 보존
- 본 작업은 문서/테스트 레이어에만 머무르며 런타임 코드를 건드리지 않음. PR diff가 `TESTING.md`와 `tests/integrations.test.mjs` 두 파일에만 머무는지 T022에서 최종 확인
