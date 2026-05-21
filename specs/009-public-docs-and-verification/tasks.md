# Tasks: Public Docs Refresh and Full Verification

**Input**: Design documents from `./specs/009-public-docs-and-verification/`

**Prerequisites**: spec.md (필수), plan.md (필수)

**Tests**: Required. 본 작업의 "테스트"는 신규 테스트 코드 추가가 아니라, 이미 머지된 선행 Task의 회귀 게이트(포커스 테스트, 전체 `npm test`, 비-provider 벤치마크 JSON 파싱, 선택적 provider 벤치마크)를 docs 변경 시점에 다시 실행해 통과를 확인하는 단계다. 검증 파이프라인 자체가 본 작업의 산출물이므로 OPTIONAL로 두지 않는다.

**Organization**: 본 작업은 closing task이며 코드 변경이 없는 docs-only 작업이다. Phase 0 (Predecessor Gate) → Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3~5 (User Story 1: docs 라벨링) → Phase 6 (User Story 2: 검증 파이프라인) → Phase 7 (Polish) 순으로 진행한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 건드리는 독립 작업이라 병렬 가능
- **[Story]**: US1 = docs 라벨링, US2 = 검증 파이프라인
- 모든 경로는 상대 경로(`./README.md`, `./DESIGN.md`, `./CHANGELOG.md`)로 표기

---

## Phase 0: Predecessor Gate (NEW)

**Purpose**: 본 작업은 closing task로, 선행 Task 1·2·3·6·7이 모두 `master`에 머지된 상태가 진입 조건이다. 하나라도 누락된 상태에서 docs만 선반영되면 README/DESIGN 문구가 실제 코드와 어긋나 신뢰성 회귀가 발생한다 (FR-010, plan Predecessor Gate 섹션).

**Halt 조건**: 아래 다섯 신호 중 **하나라도 누락**되면 본 plan에 대응하는 docs 변경을 **진행하지 않는다**. Phase 1 이후의 모든 task가 차단된다.

- [x] T001 [Gate] `git log master --grep="truncation"` 으로 Task 1(V2 truncation 문구 정정) 머지 커밋을 1개 이상 확인. 누락 시 halt.
- [x] T002 [P] [Gate] `git log master --grep="citations"` 으로 Task 2(report-mode `citations[]`/`targets[]` 노출) 머지 커밋을 1개 이상 확인. `structuredContent` 키워드도 보조 검색어로 허용한다. 누락 시 halt.
- [x] T003 [P] [Gate] `git log master --grep="evidence-preservation"` 으로 Task 3(evidence-preservation 벤치마크 추가) 머지 커밋을 1개 이상 확인. `./benchmarks/evidence-preservation.json` 파일 존재도 함께 확인한다. 누락 시 halt.
- [x] T004 [P] [Gate] `git log master --grep="explore.*router"` 또는 `git log master --grep="router heuristic"` 으로 Task 6(`explore` 라우터 휴리스틱 확장) 머지 커밋을 1개 이상 확인. 누락 시 halt.
- [x] T005 [P] [Gate] `git log master --grep="adoption"` 으로 Task 7(transcript 기반 adoption 메트릭) 머지 커밋을 1개 이상 확인. `./benchmarks/adoption.json` 존재도 함께 확인한다. 누락 시 halt.

**Checkpoint**: 다섯 신호가 모두 충족된 경우에만 Phase 1 이후로 진행한다. 하나라도 누락되면 본 작업은 `Predecessor Gate` 미통과로 보류 처리하고, docs 변경을 시작하지 않는다.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 본 작업은 코드 변경이 없는 docs-only 작업이므로 별도의 프로젝트 초기화/의존성 설치 단계는 필요하지 않다. Phase 0 (Predecessor Gate) 통과만이 본 phase의 실질적 진입 요건이다.

- [x] T006 본 작업의 작업 트리(`./README.md`, `./DESIGN.md`, `./CHANGELOG.md`)가 깨끗한지 `git status`로 확인. 무관 변경이 섞이지 않도록 본 phase 이후 해당 3개 파일만 수정 대상으로 한정한다 (FR-007, plan Risks "Docs 변경 확산").

**Checkpoint**: 작업 트리가 clean이며 본 작업의 수정 영역이 README·DESIGN·CHANGELOG 3개 파일로 한정되었음을 확인.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 본 작업은 코드/스키마/런타임 변경이 없으므로 foundational 단계에서 작성할 공유 인프라가 없다. Predecessor Gate (Phase 0) 통과가 모든 user story의 사전 조건을 대신한다.

> 본 phase에는 추가 task가 없다. 빈 phase를 채우기 위해 가짜 task를 생성하지 않는다 (plan Constitution Check, plan Technical Context "Constraints").

**Checkpoint**: Phase 0과 Phase 1을 통과했다면 user story phase를 곧장 시작할 수 있다.

---

## Phase 3: User Story 1 — README 도구 섹션 갱신 (Priority: P1)

**Goal**: 한 사람이 `./README.md`를 한 번 정독했을 때 wrapper / `explore_repo` / `explore` / `explore_v2`의 역할 구분, `explore`가 broad/deep 보고 프롬프트에 한해 내부적으로 V2 백엔드를 쓸 수 있다는 점, report 도구의 structuredContent `citations[]`/`targets[]` 노출을 모두 한 곳에서 식별할 수 있게 한다 (FR-001, FR-002, FR-003, SC-001).

**Independent Test**: `./README.md`의 도구 섹션만 정독해도 위 세 가지 진술이 한 곳에 모여 있는지 사람 리뷰 또는 단순 `Grep`(예: `explore_v2`, `citations`, `structuredContent`)으로 확인할 수 있다.

### Implementation for User Story 1 — README

- [x] T007 [US1] `./README.md`의 "공개 MCP 도구" 도구 섹션(도구 표 및 `explore_repo`/`explore`/`explore_v2` 하위 문단)에 다음을 한 곳에서 일관되게 진술한다 (FR-001).
  - `explore_repo`는 구조화 핸드오프의 정상 표면이다.
  - wrapper 도구 6개(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`)는 내부적으로 `explore_repo`에 위임하는 목적형 표면이다.
  - `explore`는 사람용 Markdown 보고 도구다.
  - `explore_v2`는 의도적 opt-in 상태이며 `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true` 플래그로 활성화된다.
- [x] T008 [US1] 같은 도구 섹션에 `explore`가 broad 또는 deep 보고 프롬프트에 한해 **내부적으로** V2 백엔드를 쓸 수 있음을 명시한다. 이것이 parent-agent 입력 결정이 아니라 서버 라우터의 런타임 판단이라는 점을 분명히 한다 (FR-002).
- [x] T009 [US1] 같은 도구 섹션에 `explore`/`explore_v2`의 report 도구가 Markdown 본문을 `text`로 반환하면서 동시에, 본문에서 파생된 기계 판독용 `citations[]`와 인용 `targets[]`를 `structuredContent`에 함께 포함한다는 점을 명시한다. parent agent가 file:line 인용을 regex로 긁어내지 않아도 되게 하려는 의도를 함께 기술한다 (FR-003).
- [x] T010 [US1] 위 세 진술이 README 내 단일 영역(도구 섹션)에 모이도록 정렬한다. 같은 메시지가 여러 섹션에 흩어진 옛 문구로 남아 있다면 본 phase에서 한 곳으로 통합한다 (Edge Cases, SC-001).

**Checkpoint**: README의 도구 섹션을 한 번 정독해 SC-001의 식별 요건이 충족되는지 확인. 본 phase 이후에도 같은 파일을 수정하는 후속 task가 없으므로 [P] 표기는 다음 user story 단위에서 가능하다.

---

## Phase 4: User Story 1 (cont.) — DESIGN.md "V2 Evidence Reliability Gates" 신규 섹션 (Priority: P1)

**Goal**: `./DESIGN.md`에 V2 신뢰 가이드라인의 **단일 출처** 섹션을 신설해, truncation 라벨, `searchCoverage.warnings` 복구 경로, report-mode `citations[]`/`targets[]` 노출, V2 단독 백엔드 게이트 조건을 한 섹션에서 모두 확인할 수 있게 한다 (FR-004, FR-005, SC-002).

**Independent Test**: `./DESIGN.md`에 정확히 한 곳의 "V2 Evidence Reliability Gates" 섹션이 존재하며, 본문에 (a) truncation 라벨, (b) `searchCoverage.warnings` 복구 경로, (c) `citations[]`/`targets[]`, (d) V2 단독 백엔드 게이트 조건의 네 진술이 모두 포함되어 있는지 사람 리뷰 또는 단순 `Grep`으로 확인할 수 있다.

### Implementation for User Story 1 — DESIGN

- [x] T011 [P] [US1] `./DESIGN.md`의 critic pass 섹션 인근(plan의 "11. deterministic critic pass" 이후, "12. 경계 강화 정책" 이전 영역)에 `V2 Evidence Reliability Gates` 라는 정확한 제목의 신규 섹션을 한 곳만 추가한다 (FR-004, SC-002). 다른 위치에 동일 제목 섹션이 존재하지 않도록 한다.
- [x] T012 [US1] 신규 섹션 본문에 truncation 라벨 진술을 포함한다. V2 런타임의 도구 결과 truncation은 모델이 결과를 합성하기 **이전** 단계에서 발생하며, 이 사실은 응답에 라벨 형태로 가시화된다는 점, 따라서 V2 응답이 깔끔해 보여도 truncation 라벨이 있는 경우 호출자는 누락 가능성을 인지해야 한다는 점을 명시한다 (FR-004(a)).
- [x] T013 [US1] 같은 섹션 본문에 `searchCoverage.warnings` 복구 경로 진술을 포함한다. 이 필드는 단순한 경고가 아니라 호출자가 누락된 증거를 어떤 follow-up 호출로 복구할 수 있는지를 알려주는 복구 경로이며, 호출자는 이를 무시하지 말고 다음 호출의 입력으로 사용해야 한다는 점을 명시한다 (FR-004(b)).
- [x] T014 [US1] 같은 섹션 본문에 report-mode `citations[]`/`targets[]` 노출 진술을 포함한다. `explore`/`explore_v2`가 report-mode일 때 응답은 Markdown 본문과 함께 `structuredContent`의 `citations[]`(파일/라인 인용)와 인용에서 파생된 `targets[]`(다음 읽기/검증 대상)를 노출하며, 본 필드가 V1 `explore_repo`의 `targets[]`/`evidence[]`와는 별도의 report-mode 전용 필드라는 점을 명시한다 (FR-004(c)).
- [x] T015 [US1] 같은 섹션 본문에 V2 단독 보고 백엔드 승격 게이트 조건을 명시한다. (i) evidence-preservation 벤치마크가 안정적인 citation 보존을 보일 것, (ii) 동일 벤치마크에서 미해명 citation gap 경고(`searchCoverage.warnings` 또는 동등 신호)가 부재할 것, 본 조건 충족 전까지 V2는 opt-in 및 내부 사용으로 한정된다는 점을 한 묶음으로 진술한다 (FR-005).
- [x] T016 [US1] DESIGN 내 기존의 짧은 V2/V1 critic 차이 진술이 본 신규 섹션과 같은 메시지를 다른 말로 반복하지 않도록, 인접 기존 문단은 신규 섹션으로의 짧은 참조만 남기도록 정렬한다 (Edge Cases, plan Risks "기존 outdated V2 언급과 신규 섹션 중복"). 인접 문단의 read-only/redaction/scope 관련 기존 진술은 변경하지 않는다 (FR-007).

**Checkpoint**: `V2 Evidence Reliability Gates`가 정확히 한 곳 존재하고 네 진술 (a)~(d)가 모두 포함되어 있는지 확인 (SC-002).

---

## Phase 5: User Story 1 (cont.) — CHANGELOG.md 외부 가시 변경 묶음 (Priority: P1)

**Goal**: `./CHANGELOG.md`에 본 플랜의 외부 가시 변경 5개를 외부 독자가 한 묶음으로 식별 가능하게 기록한다 (FR-006, SC-003).

**Independent Test**: `./CHANGELOG.md`를 보았을 때 다섯 항목(truncation 문구, `citations[]`/`targets[]`, evidence-preservation 벤치마크, `explore` 라우터, transcript adoption 메트릭)이 단일 릴리즈 묶음으로 묶여 있는지 사람 리뷰로 확인할 수 있다.

### Implementation for User Story 1 — CHANGELOG

- [x] T017 [P] [US1] `./CHANGELOG.md`에 `package.json`의 현재 `0.2.0` 버전과 충돌하지 않는 별도 변경 묶음을 둔다. 현재 구현은 기존 `## v0.2.0 - 2026-05-19` 아래 `Tool Quality Follow-up (2026-05-21)` 섹션으로 기록하며, 묶음 머리말 한 줄에 "이 묶음은 `docs/superpowers/plans/2026-05-19-tool-quality-improvements.md`의 산출물"임을 외부 독자가 식별할 수 있도록 짧게 라벨링한다 (FR-006, plan (c)).
- [x] T018 [US1] 같은 묶음 안에 다섯 항목을 `### Added`/`### Changed`/`### Documentation` 등의 하위 그룹으로 분배해 기록한다 (FR-006, SC-003).
  - V2 truncation 문구 정정 (Task 1).
  - report-mode `citations[]`/`targets[]` 노출 (Task 2).
  - evidence-preservation 벤치마크 추가 (Task 3).
  - `explore` 라우터 휴리스틱 확장 (Task 6).
  - transcript 기반 adoption 메트릭 (Task 7).
- [x] T019 [US1] 각 항목 문구는 README/DESIGN 갱신과 같은 신뢰 가이드라인을 짧게 반복하되 길게 늘이지 않는다. CHANGELOG 항목이 README/DESIGN과 메시지 충돌을 일으키지 않도록 정렬한다 (Edge Cases, FR-007).

**Checkpoint**: SC-003 — CHANGELOG의 다섯 항목이 외부 독자 입장에서 단일 묶음으로 식별 가능한지 확인. 본 단계로 User Story 1 (docs 라벨링)이 완결된다.

---

## Phase 6: User Story 2 — 검증 파이프라인 실행 (Priority: P1)

**Goal**: 운영자가 단일 명령 세트로 본 플랜의 모든 회귀 게이트가 통과했음을 한 번에 확인한다. 단계 (a)~(c)는 게이트, 단계 (d)는 기록 단계다 (FR-008, FR-009, SC-004, SC-005, SC-006, SC-007).

**Independent Test**: User Story 1 (Phase 3~5) 머지가 끝났다고 가정한 상태에서, plan Implementation Outline (d)의 네 단계를 순서대로 실행했을 때 (a)(b)(c)는 종료 코드 0과 0 failure로 끝나고 (d)는 키 유무에 따라 실행되거나 건너뛰어지는지 확인한다.

### Implementation for User Story 2 — 검증 파이프라인

- [x] T020 [US2] **(a) 포커스 테스트 실행** — Task 1·2·3·6·7이 도입/수정한 테스트 파일 묶음만 `node --test`로 실행한다. 정확한 파일 경로는 Predecessor Gate(Phase 0)에서 확인된 머지 커밋들의 변경 파일 목록에서 도출하며, 본 task draft에서는 경로를 enumerate하지 않는다 (plan Risks: 미머지 시점 경로 박제 회피). 0 failure 종료를 게이트로 한다 (SC-004, FR-008(1), FR-009).
- [x] T021 [US2] **(b) 전체 `npm test` 실행** — 저장소 루트에서 `npm test`를 실행한다. 종료 코드 0과 failure 수 0을 게이트로 한다. skip 수는 Windows 또는 git 가용성 등 환경 의존이며 게이트가 아니다. skip 수 변동을 failure로 오해하지 않도록 본 phase의 PR 본문에 "skip 수는 게이트가 아님"을 명시한다 (SC-005, FR-008(2), FR-009, Edge Cases, plan Risks "`npm test` skip 수 환경 의존성").
- [x] T022 [US2] **(c) 비-provider 벤치마크 JSON 파싱** — `./benchmarks/adoption.json`과 `./benchmarks/evidence-preservation.json`을 JSON 파서가 예외 없이 파싱하는지 저장소 표준 절차에 따른 short script 또는 `node -e`로 확인한다. 두 파일 모두 통과하고 명령이 종료 코드 0으로 끝나야 한다 (SC-006, FR-008(3), FR-009).
- [x] T023 [Optional] [US2] **(d) Provider 벤치마크 (기록 단계, 게이트 아님)** — provider 키(`CEREBRAS_API_KEY` 등)가 있는 환경에 한해 `npm run benchmark` 와 `npm run benchmark:evidence`를 순서대로 실행한다. 키가 없는 환경에서는 본 task를 건너뛰며, 건너뛴 사실 자체를 PR 본문/머지 기록에 남긴다. 실행한 경우 케이스별 PASS/FAIL 요약, 점수, 경고를 PR 본문에 기록한다. 본 단계의 실패는 docs 머지를 차단하지 않으며, V2가 단독 보고 백엔드로 승격될 수 있는지 판단 자료로만 보관된다 (SC-007, FR-008(4), FR-009, plan Risks "Provider 벤치마크 결과를 게이트로 오인").
  - Result (2026-05-21): `npm run benchmark` PASS 8/8, average score 93%; `npm run benchmark:evidence` PASS 1/1, average score 80%. Provider benchmark results remain record-only and are not a merge gate.

**Checkpoint**: T020·T021·T022가 모두 통과했고 T023이 실행 또는 명시적 skip 기록으로 종료되었는지 확인. 본 단계가 끝나야 User Story 1의 docs 변경을 `master`에 머지할 수 있다 (Test Strategy G1·G2·G3·R1).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 단일 출처 유지, install-ref 일관성, skip 수 변동 무관 게이트 정책의 외부 가시화.

- [x] T024 [P] 본 작업 PR 본문에 "skip 수 변동은 게이트가 아님 / failure 수만 게이트"임을 명시한다. 검증 절차 단계별 기대 결과(T020~T023)와 함께 한 곳에 정리한다 (SC-005, FR-009, Edge Cases).
- [x] T025 [P] README/DESIGN/CHANGELOG 전반에서 신규 섹션과 메시지 충돌을 일으키는 outdated V2 언급을 점검한다. 동일 메시지가 여러 곳에서 다른 말로 반복되지 않도록 단일 출처(DESIGN의 "V2 Evidence Reliability Gates" 섹션)로 수렴시키고, 인접 기존 문단은 짧은 참조만 남긴다 (Edge Cases, plan Risks "기존 outdated V2 언급과 신규 섹션 중복", FR-007).
- [x] T026 [P] README/DESIGN/CHANGELOG의 install-ref 스니펫과 도구 read-only 어노테이션 진술이 본 작업 전과 동일하게 유지되는지 점검한다. 본 작업은 새 외부 계약을 도입하지 않으므로 install 스니펫 형식과 read-only/redaction/scope 관련 기존 진술은 한 글자도 회귀시키지 않는다 (FR-007, plan Constitution Check).
- [x] T027 docs 변경이 본 plan의 단계 (a)~(c)에 명시한 영역(README 도구 섹션, DESIGN 신규 섹션, CHANGELOG 신규 묶음)에만 한정되었는지 `git diff --stat`으로 최종 확인한다. 본 plan 외 영역으로 docs 변경이 확산되지 않도록 한다 (plan Risks "Docs 변경이 본 플랜 외 영역으로 확산").

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0 (Predecessor Gate)**: 강한 선행. T001~T005 중 하나라도 실패하면 Phase 1 이후 모든 task가 차단된다 (FR-010, plan Predecessor Gate).
- **Phase 1 (Setup)**: Phase 0 통과 후 시작.
- **Phase 2 (Foundational)**: 비어 있음. Phase 0·1 통과만으로 user story phase 진입 가능.
- **Phase 3·4·5 (User Story 1)**: Phase 0·1 통과 후 시작. 서로 다른 파일을 건드리므로 phase 단위로 병렬 가능 (T011, T017은 [P] 표기).
- **Phase 6 (User Story 2)**: Phase 3·4·5 완료 후 실행. 검증 파이프라인은 docs 머지 직전 단계다.
- **Phase 7 (Polish)**: Phase 3·4·5·6 완료 후 실행.

### User Story Dependencies (within this feature)

- **User Story 1 (docs 라벨링)**: Phase 0 (Predecessor Gate) 통과를 강한 선행으로 가진다. Task 1·2·3·6·7 머지 신호가 모두 확인된 상태에서만 시작한다.
- **User Story 2 (검증 파이프라인)**: User Story 1의 docs 변경 작업 트리가 준비된 상태에서 머지 직전에 실행한다. Phase 0과는 별개로, "docs 변경 자체가 회귀를 일으키지 않음"을 확인하는 단계다.

### Strong Predecessor Tasks (외부 의존)

본 작업은 다음 다섯 Task의 master 머지를 강한 선행으로 가진다. Phase 0이 이를 검증한다.

- Task 1 — V2 truncation 문구 정정
- Task 2 — report-mode `citations[]`/`targets[]` 노출
- Task 3 — evidence-preservation 벤치마크 추가
- Task 6 — `explore` 라우터 휴리스틱 확장
- Task 7 — transcript 기반 adoption 메트릭

### Within Each User Story

- User Story 1 내부에서는 README(Phase 3) → DESIGN(Phase 4) → CHANGELOG(Phase 5) 순으로 진행하되, 서로 다른 파일이므로 phase 간 [P] 병렬 진행도 가능하다.
- User Story 2 내부에서는 T020 → T021 → T022 → T023 순서가 강제된다 (plan Implementation Outline (d), FR-008).

### Parallel Opportunities

- Phase 0의 T002·T003·T004·T005는 T001 이후 [P]로 병렬 검색 가능하다.
- Phase 3의 README, Phase 4의 DESIGN, Phase 5의 CHANGELOG는 서로 다른 파일을 건드리므로 user story 1 안에서도 병렬 작업이 가능하다 (T011, T017 [P]).
- Phase 7의 T024·T025·T026는 서로 다른 점검 단면이라 [P]로 병렬 가능하다.

---

## Implementation Strategy

### Closing Task Order

1. Phase 0 (Predecessor Gate)을 가장 먼저 수행한다. 다섯 신호가 모두 충족되지 않으면 본 작업은 보류한다.
2. Phase 1·2 통과 후 Phase 3·4·5 (docs 라벨링)을 진행한다.
3. docs 변경이 작업 트리에 반영된 상태에서 Phase 6 (검증 파이프라인 a→b→c→d)을 실행한다. (a)·(b)·(c)가 모두 통과해야 docs 머지가 허용된다.
4. Phase 7 (Polish)에서 단일 출처/install-ref/회귀 금지 범위를 최종 점검한다.
5. PR 본문에 검증 결과 요약과 (provider 키가 없는 경우) (d) 건너뜀 사실을 기록한 뒤 `master`로 머지한다.

### Gate vs. Record 구분

- **Gate (머지 차단 가능)**: T020 (focus tests), T021 (`npm test`), T022 (benchmark JSON parse). 모두 종료 코드 0 + 0 failure 요구.
- **Record (머지 차단 불가)**: T023 (provider 벤치마크). 실행한 경우 결과를 기록, 실행하지 못한 경우 사유를 기록.

---

## Notes

- [P] task = 다른 파일을 건드리는 독립 작업. 같은 파일을 동시에 수정하는 task에는 [P]를 붙이지 않는다.
- [Story] 라벨은 docs 라벨링(US1)과 검증 파이프라인(US2)의 추적성을 위해 부착한다.
- 본 작업은 코드 변경이 없으므로 신규 테스트를 추가하지 않는다. 검증은 이미 머지된 선행 Task의 게이트 재실행이다 (plan Test Strategy).
- skip 수 변동은 환경(Windows, git 가용성) 의존이며 게이트가 아니다. failure 수만 게이트다 (SC-005, FR-009, Edge Cases).
- provider 벤치마크(T023)는 키가 있는 환경에서만 수행하며 결과는 V2 단독 보고 백엔드 승격 판단 자료로만 사용된다. 본 단계의 실패는 docs 머지를 차단하지 않는다 (SC-007, FR-009).
- 모든 경로는 상대 경로(`./README.md`, `./DESIGN.md`, `./CHANGELOG.md`, `./benchmarks/adoption.json`, `./benchmarks/evidence-preservation.json`)로 표기한다.
