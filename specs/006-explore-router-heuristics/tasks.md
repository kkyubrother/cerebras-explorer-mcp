---

description: "Task list for feature 006-explore-router-heuristics"
---

# Tasks: Strengthen Explore Router Heuristics

**Input**: Design documents from `specs/006-explore-router-heuristics/`

**Prerequisites**: `specs/006-explore-router-heuristics/plan.md` (필수), `specs/006-explore-router-heuristics/spec.md` (사용자 스토리 필수)

**Tests**: Required — spec SC-001~SC-005 모두 단위 테스트로 검증되어야 한다. 본 작업은 신호별 5종 단위 테스트를 의무로 포함한다.

**원본 plan(참고)**: `docs/superpowers/plans/2026-05-19-tool-quality-improvements.md` Task 6 (Strengthen Explore Router Heuristics)

**Organization**: 본 작업은 spec의 User Story 1/2/3에 1:1 매핑된 Phase로 task를 묶어, 각 스토리를 독립적으로 구현·검증할 수 있게 한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 건드리거나 의존성이 없어 병렬 실행 가능한 task
- **[Story]**: `US1`(길이/scope 신호), `US2`(broad scope + 키워드 신호), `US3`(외부 표면 무변경)
- 모든 경로는 저장소 루트 기준 상대 경로

## Path Conventions

- 단일 패키지(Node.js MCP 서버). 변경 지점은 두 파일에 한정:
  - `src/mcp/server.mjs` — `hasBroadExploreScope` 헬퍼 추가 + `shouldUseV2ForExplore` 강화 + named export 노출
  - `tests/mcp-server.test.mjs` — 단위 테스트 5종 추가
- 외부 도구 표면 회귀는 기존 `tests/mcp-server.test.mjs`의 `tools/list` 분기 테스트로 커버(신규 파일 없음).

---

## Phase 1: Setup

**Purpose**: 작업에 필요한 컨텍스트 정렬 및 변경 지점 확정. 신규 의존성·디렉터리 추가는 없다.

- [ ] T001 `specs/006-explore-router-heuristics/spec.md`와 `specs/006-explore-router-heuristics/plan.md`를 다시 읽고 신호 정의(길이 1200자 임계, scope 길이 6, broad pattern 5종, 영문 7 + 한글 6 키워드)를 메모로 정리한다.
- [ ] T002 [P] `src/mcp/server.mjs`의 기존 `shouldUseV2ForExplore` 함수(L259-263 부근) 및 `callFreeExploreTool` 분기(L678 부근) 위치를 식별하고, 변경 영역을 plan §Implementation Outline (b)에 맞춰 좁힌다.
- [ ] T003 [P] `tests/mcp-server.test.mjs`의 기존 `tools/list` opt-in 분기 테스트(L346-L394 부근)와 명명 컨벤션(`node:test` + `node:assert/strict`)을 확인하여 신규 테스트 5종이 같은 스타일로 들어갈 위치를 정한다.

**Checkpoint**: 변경 대상 두 파일과 정확한 변경 라인 범위, 테스트 추가 위치가 확정된다.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: User Story 1/2/3 어느 쪽이든 사용할 공통 헬퍼와 안전한 입력 정제 로직을 먼저 마련한다. 본 phase의 결과물(`hasBroadExploreScope` 헬퍼와 prompt+context 길이 합 계산 패턴)은 이후 세 스토리의 신호 평가에 모두 재사용된다.

**경고**: 본 phase의 헬퍼가 완성되기 전에는 User Story 1/2 구현을 시작하지 않는다.

- [ ] T004 [P] `src/mcp/server.mjs`의 `shouldUseV2ForExplore` 바로 위에 `hasBroadExploreScope(scope)` 헬퍼를 추가한다. 동작:
  - `Array.isArray(scope) === false`면 즉시 `false`.
  - 배열 길이 `>= 6`이면 `true`.
  - 원소 중 `typeof === 'string'`인 항목에 한해 다음 패턴 중 하나라도 매치되면 `true`:
    - 정확히 `.` 또는 `./`
    - 부분 문자열 `**` 포함
    - 부분 문자열 `**/*` 포함
    - `/`로 구분된 마지막 세그먼트가 `**`로 끝남(예: `src/**`, `*/**`)
  - 모두 좁은 글롭이면 `false`.
- [ ] T005 `src/mcp/server.mjs` 상단(또는 `shouldUseV2ForExplore` 바로 위)에 prompt+context 길이 합 계산 패턴을 정리한다. 구체적으로 `String(args?.prompt ?? '')`, `String(args?.context ?? '')`로 강제 변환한 뒤 `.length`를 합산하는 인라인 표현(또는 헬퍼 `computeExplorePromptLoad(args)`)을 마련한다. 1200 임계는 상수 `EXPLORE_V2_LENGTH_THRESHOLD = 1200`로 모듈 상단 또는 함수 인접 위치에 분리한다.
- [ ] T006 `src/mcp/server.mjs`에서 `shouldUseV2ForExplore`를 named export로 노출한다(`export function shouldUseV2ForExplore(...)` 또는 별도 `export { shouldUseV2ForExplore }`). 본 export는 JS 모듈 표면이며 MCP `tools/list` wire surface와 무관하므로 spec FR-007/SC-004에 영향 없음을 task 코멘트에 명시.

**Checkpoint**: `hasBroadExploreScope`·길이 합 헬퍼·`EXPLORE_V2_LENGTH_THRESHOLD` 상수·named export가 준비되어, User Story 1/2 신호 추가를 동시에 진행할 수 있다.

---

## Phase 3: User Story 1 - 긴 프롬프트가 자동으로 V2로 라우팅된다 (Priority: P1) MVP

**Goal**: prompt+context 길이 합이 1200 이상이거나 `thoroughness === 'deep'`이 명시되면 라우터가 V2 런타임을 선택한다.

**Independent Test**: `shouldUseV2ForExplore({ prompt: 'a'.repeat(1200), context: '', scope: ['src/foo'], thoroughness: 'normal' })`가 `true`를 반환하고, `'a'.repeat(1199)` 케이스는 `false`를 반환하면 단독 검증 완료.

### Tests for User Story 1 (Required)

> **NOTE: 다음 단위 테스트는 구현 전에 작성하고 FAIL을 확인한 뒤 구현으로 진행한다.**

- [ ] T007 [P] [US1] `tests/mcp-server.test.mjs`에 길이 신호 단독 테스트를 추가한다. 케이스:
  - `prompt='a'.repeat(1200), context=''` → `true` (정확히 1200 경계, `>= 1200` 검증)
  - `prompt='a'.repeat(1199), context=''` → `false` (경계 직하)
  - `prompt='a'.repeat(600), context='b'.repeat(600)` → `true` (합계 1200)
  - `prompt='short', thoroughness='deep'` → `true` (기존 deep 회귀)

### Implementation for User Story 1

- [ ] T008 [US1] `src/mcp/server.mjs`의 `shouldUseV2ForExplore` 본체에 길이 신호 분기를 추가한다. 동작: `String(args?.prompt ?? '').length + String(args?.context ?? '').length >= EXPLORE_V2_LENGTH_THRESHOLD`이면 `true` 반환. 기존 `args?.thoroughness === 'deep'` 분기는 OR 조합의 최상위에 유지한다(deep은 항상 V2 트리거).
- [ ] T009 [US1] 길이 신호와 deep 분기를 추가한 직후 T007의 4개 단위 테스트가 PASS함을 확인한다. 실패 시 임계 비교 연산자(`>=` vs `>`)와 입력 정제(`String(... ?? '')`)를 재점검한다.

**Checkpoint**: User Story 1이 단독 PASS. 짧은 quick 입력 회귀는 Phase 6에서 다시 확인.

---

## Phase 4: User Story 2 - 넓은 scope 또는 보고서 의도 키워드가 V2로 라우팅된다 (Priority: P1)

**Goal**: scope 배열이 6 이상이거나 broad scope 패턴(`.`, `./`, `**`, `**/*`, `*/**`)을 포함하면 V2가 선택되고, 영문 7 + 한글 6의 보고서 의도 키워드 중 하나라도 prompt에 포함되면 V2가 선택된다.

**Independent Test**:
- `shouldUseV2ForExplore({ prompt:'x', scope:['a','b','c','d','e','f'] })` → `true`
- `shouldUseV2ForExplore({ prompt:'x', scope:['src/**'] })` → `true`
- `shouldUseV2ForExplore({ prompt:'please do an architecture review of explore', scope:['src/foo'] })` → `true`
- `shouldUseV2ForExplore({ prompt:'아키텍처 흐름 종합 정리해줘', scope:['src/foo'] })` → `true`

### Tests for User Story 2 (Required)

> **NOTE: 다음 단위 테스트는 구현 전에 작성하고 FAIL을 확인한 뒤 구현으로 진행한다.**

- [ ] T010 [P] [US2] `tests/mcp-server.test.mjs`에 scope 길이/broad pattern 신호 테스트를 추가한다. 케이스:
  - scope 길이 6 → `true`, 길이 5 → `false`
  - scope 단일 원소가 `.`, `./`, `src/**`, `**/*.ts`, `*/**` 각각인 5개 서브케이스 → 모두 `true`
  - scope가 배열이 아닌 경우(`'src/**'` 문자열, `null`, `undefined`) → 모두 `false`
- [ ] T011 [P] [US2] `tests/mcp-server.test.mjs`에 확장 키워드 신호 테스트를 추가한다. 케이스:
  - 영문 7종 각각(`deep dive`, `comprehensive`, `entire codebase`, `large architecture`, `end-to-end`, `architecture review`, `subsystem review`)을 짧은 prompt에 포함 + 대소문자 혼합(`Architecture Review`) 한 케이스 → 모두 `true`
  - 한글 6종 각각(`전체`, `대규모`, `심층`, `종합`, `아키텍처`, `흐름`)을 prompt에 포함 → 모두 `true`
  - 영문 키워드와 한글 키워드를 모두 포함하지 않는 짧은 prompt(`explain auth briefly`) → `false`

### Implementation for User Story 2

- [ ] T012 [US2] `src/mcp/server.mjs`의 `shouldUseV2ForExplore`에 `hasBroadExploreScope(args?.scope)` 분기를 추가한다(OR 조합). T004의 헬퍼를 그대로 호출한다.
- [ ] T013 [US2] `src/mcp/server.mjs`의 `shouldUseV2ForExplore`에 확장 키워드 정규식 두 개를 추가한다:
  - 영문(소문자 변환 후 매칭): `deep dive|comprehensive|entire codebase|large architecture|end-to-end|architecture review|subsystem review`
  - 한글(원본 prompt에 대해 매칭): `전체|대규모|심층|종합|아키텍처|흐름`
  - 두 정규식 중 하나라도 매치되면 `true`. 가독성을 위해 정규식은 모듈 상단의 상수(`EXPLORE_V2_KEYWORDS_EN`, `EXPLORE_V2_KEYWORDS_KO`)로 분리.
- [ ] T014 [US2] T010, T011이 모두 PASS함을 확인한다. 실패 시 (a) `Array.isArray` 가드, (b) `prompt.toLowerCase()` 누락, (c) 한글 정규식이 원본 prompt(소문자 변환 전) 대상인지 점검.

**Checkpoint**: User Story 2가 단독 PASS. 두 키워드 정규식과 broad scope 헬퍼가 OR로 결합되어 동작.

---

## Phase 5: User Story 3 - 외부 도구 표면은 변경되지 않는다 (Priority: P2)

**Goal**: 라우터 강화 이후에도 `tools/list` 결과·`explore` 입력 스키마·`explore_v2` opt-in 정책이 본 변경 전과 동일해야 한다.

**Independent Test**: `CEREBRAS_EXPLORER_EXPLORE_V2`(또는 `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`) 미설정 상태에서 `tools/list`를 호출하면 응답 도구 목록에 `explore_v2`가 없고, `explore`의 `inputSchema` 필드 이름·타입·필수 여부가 변경 전과 동일하다.

### Tests for User Story 3 (Required by 기존 테스트로 커버)

- [ ] T015 [US3] `tests/mcp-server.test.mjs`의 기존 `tools/list` opt-in 분기 테스트(L346-L394 부근)를 실행해 PASS함을 확인한다. 신규 테스트 추가는 하지 않는다(spec Assumptions에 따라 기존 contract 테스트가 회귀를 커버).
- [ ] T016 [US3] `npm test` 전체를 실행해 `tools/list` 스냅샷·contract 테스트가 변경 없이 통과하는지 확인한다(spec SC-003·SC-004 충족).

### Implementation for User Story 3

- [ ] T017 [US3] `src/mcp/server.mjs`에서 본 작업으로 인해 변경된 코드가 `EXPLORE_TOOL.inputSchema`, `EXPLORE_V2_TOOL`, `exploreV2ToolEnabled()`, `buildToolList()` 어느 곳도 건드리지 않았음을 diff로 점검한다. 헬퍼·라우터·상수·named export만 변경되었는지 라인 단위로 확인한다.
- [ ] T018 [US3] README L319-321 및 DESIGN L206 문구를 변경하지 않았음을 확인한다(plan 명시: 두 문서는 본 작업에서 수정 금지).

**Checkpoint**: 외부 MCP wire surface 회귀 0건. `explore_v2`는 여전히 환경 변수 기반 opt-in.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 안전성·경계·전 신호 회귀를 확정한다. 여기에서 예외 없음 보장(FR-009)과 1200자 경계(FR-002)를 한 번 더 검증한다.

- [ ] T019 [P] `tests/mcp-server.test.mjs`에 안전성·짧은 quick 회귀 테스트를 추가한다. 케이스:
  - `shouldUseV2ForExplore(undefined)` → `false`, throw 없음
  - `shouldUseV2ForExplore({})` → `false`
  - `{ prompt: 123, context: null, scope: 'src/**' }` → `false` (비기대 타입; broad pattern은 배열 아님)
  - `{ prompt: 'explain auth briefly', thoroughness: 'quick' }` → `false`
- [ ] T020 [P] `tests/mcp-server.test.mjs`의 1200자 경계 테스트(T007에 포함)가 정확히 `>=` 비교를 검증하는지 재점검한다. 필요 시 `prompt='a'.repeat(1201)` → `true`, `'a'.repeat(0), context='b'.repeat(1200)` → `true` 두 케이스를 추가해 boundary 매트릭스를 보강한다.
- [ ] T021 `src/mcp/server.mjs`의 `shouldUseV2ForExplore`가 어떤 입력에도 throw하지 않음을 코드 리뷰로 재확인한다. 점검 포인트: `args?.` optional chaining, `String(... ?? '')`, `Array.isArray` 가드, 정규식 매칭 전 `typeof === 'string'` 검증.
- [ ] T022 `node --test tests/mcp-server.test.mjs --test-name-pattern "shouldUseV2ForExplore"` 또는 동등한 명령으로 신규 라우터 테스트만 빠르게 회귀 실행한 뒤, 마지막에 `npm test` 전체를 실행해 SC-001~SC-005 모두 PASS임을 확인한다.
- [ ] T023 [P] 변경 라인 수(`src/mcp/server.mjs` 약 10~25라인, `tests/mcp-server.test.mjs` 약 60~100라인) 범위를 초과하지 않았는지 `git diff --stat`으로 확인하고, 초과 시 plan §Project Structure에 맞춰 스코프를 좁힌다.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 의존성 없음. 즉시 시작 가능.
- **Phase 2 (Foundational)**: Phase 1 완료 후 시작. User Story 1/2의 신호 평가가 모두 본 phase의 헬퍼·상수·named export에 의존하므로 **반드시 먼저 끝나야 한다**.
- **Phase 3 (US1)**: Phase 2 완료 후 시작. Phase 4와 병렬 가능(서로 다른 신호 분기).
- **Phase 4 (US2)**: Phase 2 완료 후 시작. Phase 3과 병렬 가능. 단, 둘 다 같은 함수(`shouldUseV2ForExplore`)를 수정하므로 동일 함수 내 OR 조합 머지 시점에는 순차 커밋이 안전(T008 → T012/T013 순서 권장).
- **Phase 5 (US3)**: Phase 3·4 완료 후 시작. 외부 표면 무변경 검증은 라우터 구현이 끝난 뒤 의미가 있다.
- **Phase 6 (Polish)**: Phase 3·4·5 완료 후 시작.

### Within Each User Story

- 단위 테스트(T007/T010/T011/T019)는 **구현 task 전에 작성하고 FAIL을 확인**한 뒤 구현으로 진행한다.
- Foundational 헬퍼(T004/T005/T006) → US1·US2 신호 분기(T008/T012/T013) → US3 표면 회귀 검증(T015~T018) → Polish 안전성(T019~T023) 순서로 진행한다.
- 한 스토리가 완료되기 전에 다음 우선순위 스토리로 넘어가지 않는다(병렬 작업자가 있다면 예외).

### Parallel Opportunities

- T002, T003 (Phase 1, 서로 다른 파일 식별 작업)
- T004 (헬퍼 신규 추가)는 T005(상수·길이 합 패턴), T006(named export)과 다른 코드 영역이므로 `[P]` 마킹. 단, 모두 같은 파일(`src/mcp/server.mjs`)이라 머지 충돌을 피하려면 순차 커밋 권장.
- T007, T010, T011 (Phase 3·4 테스트 작성): 같은 파일이지만 서로 다른 `test()` 블록이라 작성 자체는 병렬 가능. 커밋은 순차.
- T019, T020, T023 (Phase 6 polish): 서로 다른 검증 축이므로 병렬 가능.
- 서로 다른 스토리를 다른 작업자가 맡는다면 Phase 3와 Phase 4를 병렬 진행 가능(공통 헬퍼는 Phase 2에서 이미 준비됨).

---

## Parallel Example: User Story 1 + User Story 2 동시 진행

```bash
# Phase 2 완료 후, 두 스토리의 테스트를 먼저 작성(같은 파일, 다른 test 블록):
Task: "T007 [US1] 길이 신호 테스트를 tests/mcp-server.test.mjs에 추가"
Task: "T010 [US2] scope 신호 테스트를 tests/mcp-server.test.mjs에 추가"
Task: "T011 [US2] 키워드 신호 테스트를 tests/mcp-server.test.mjs에 추가"

# 이후 구현은 src/mcp/server.mjs 한 함수 내부를 수정하므로 순차 커밋:
Task: "T008 [US1] shouldUseV2ForExplore에 길이 신호 분기 추가"
Task: "T012 [US2] shouldUseV2ForExplore에 broad scope 분기 추가"
Task: "T013 [US2] shouldUseV2ForExplore에 키워드 정규식 추가"
```

---

## Implementation Strategy

### MVP (User Story 1)

1. Phase 1 Setup 완료
2. Phase 2 Foundational 완료(헬퍼·상수·export)
3. Phase 3 US1 완료 → 길이 신호 + deep 회귀가 모두 PASS
4. STOP & VALIDATE: 짧은 quick 입력이 여전히 V1로 가는지 한 번 더 확인 후 머지 가능

### Incremental Delivery

1. Setup + Foundational → 공통 헬퍼 준비
2. US1 추가 → 길이 신호로 긴 prompt가 자동 V2 (MVP)
3. US2 추가 → broad scope + 키워드 신호로 보고서 의도 자동 V2
4. US3 검증 → 외부 표면 회귀 0건 확인
5. Polish → 안전성·경계·전 신호 매트릭스 확정 후 `npm test` 전체 PASS

### Parallel Team Strategy

- 작업자 A: Phase 2 (Foundational) → Phase 3 (US1)
- 작업자 B: Phase 2 완료 후 Phase 4 (US2) 진입
- 작업자 C: Phase 3·4 완료 후 Phase 5 (US3) 회귀 검증 + Phase 6 Polish
- 두 작업자가 같은 함수를 수정하므로, 머지는 US1 → US2 순서로 PR을 합치는 것을 권장.

---

## Notes

- `[P]` 표기는 서로 다른 파일이거나 같은 파일 내 다른 블록을 수정할 때만 사용. 본 작업은 두 파일에 집중되므로 실제 커밋은 순차 진행이 안전.
- 모든 단위 테스트는 `node:test` + `node:assert/strict`만 사용한다(신규 의존성 추가 금지).
- `shouldUseV2ForExplore`를 named export로 노출하더라도 MCP `tools/list` wire surface는 바뀌지 않으므로 spec FR-007·SC-004와 무관(plan §Risks 마지막 항목 참고).
- 1200 임계와 키워드 목록은 상수로 분리해 추후 벤치마크(`benchmarks/`)로 재조정 가능하도록 한다.
- spec edge case의 모든 항목(`undefined`/`null`/비문자열 안전 처리, scope 비배열, 1200 경계, 대소문자 무관, deep 우선)은 Phase 3·4·6 테스트로 빠짐없이 커버해야 한다.
- 커밋 시점은 (1) Foundational 헬퍼 완료, (2) US1 PASS, (3) US2 PASS, (4) US3 회귀 PASS, (5) Polish 완료의 5개 체크포인트 권장. 각 체크포인트에서 `npm test` 부분 실행으로 회귀를 확인.
