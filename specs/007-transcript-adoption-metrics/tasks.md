---

description: "Task list draft for Task 7 — Transcript-Based Adoption Metrics"

---

# Tasks: Transcript-Based Adoption Metrics

**Input**: Design documents from `specs/007-transcript-adoption-metrics/`

**Prerequisites**: `specs/007-transcript-adoption-metrics/plan.md` (필수), `specs/007-transcript-adoption-metrics/spec.md` (사용자 스토리 + Acceptance Scenarios)

**Tests**: Required. spec FR-010 / SC-001이 `node --test tests/benchmark-transcript-metrics.test.mjs`를 0 failures로 통과할 것을 명시한다. US1 단위 테스트 2종(요약, 반복 계획)은 필수 산출물이다.

**Organization**: 작업은 사용자 스토리(US1·US2·US3)별로 묶어 각 스토리가 독립적으로 구현·검증되도록 한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일이고 선행 의존성이 없어 병렬 실행 가능
- **[Story]**: US1 / US2 / US3 로 추적성 부여
- 모든 경로는 저장소 루트 기준의 상대 경로로 기재

## Path Conventions

- 단일 프로젝트 구조: 루트의 `src/`, `scripts/`, `benchmarks/`, `tests/`
- 본 작업의 신규 모듈은 `src/benchmark/`에, 단위 테스트는 `tests/`에 배치한다.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 신규 모듈과 테스트 파일을 둘 위치를 확정하고, plan.md가 가리키는 실제 코드 위치(특히 `computeExtendedMetrics`가 `scripts/run-benchmark.mjs` 안에 있다는 사실)를 사전 확인한다. 코드 변경은 없다.

- [x] T001 [P] `specs/007-transcript-adoption-metrics/plan.md`의 Implementation Outline (a)~(g)를 읽고 영향 파일 4개(`src/benchmark/transcript-metrics.mjs` 신규, `tests/benchmark-transcript-metrics.test.mjs` 신규, `scripts/run-benchmark.mjs` 수정, `benchmarks/adoption.json` 수정)를 작업 체크리스트로 확정한다.
- [x] T002 [P] `scripts/run-benchmark.mjs`에서 `computeExtendedMetrics` 정의 라인과 케이스 루프의 `caseResult` 조립 라인을 식별해 본 phase의 작업 노트에 기록한다(plan.md 235라인/267~278라인 근처 가이드 반영). 파일 수정은 하지 않는다.
- [x] T003 [P] `src/explorer/transcript.mjs`의 `createTranscriptRecorder`가 작성하는 JSONL 엔트리 스키마(`type: 'assistant' | 'tool' | 'meta'`, `turn`, `tool`, `toolCalls`, `error`, `stats`)를 점검하고 본 작업에서 사용할 키 집합을 확정한다(읽기만).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 신규 모듈 `src/benchmark/transcript-metrics.mjs`에서 사용할 broad search / read 도구 카테고리 상수를 한 곳에 모아 정의한다. 이 상수가 US1·US2·US3 어디에서나 동일 의미로 쓰이도록 사전에 합의한다.

CRITICAL: 모든 사용자 스토리는 이 phase의 도구 분류 상수가 확정된 다음에야 시작할 수 있다.

- [x] T004 [Foundation] `src/benchmark/transcript-metrics.mjs` 상단에 `BROAD_SEARCH_TOOLS = new Set(['repo_grep', 'repo_find_files', 'repo_list_dir'])` 상수를 정의한다(spec FR-003, plan Implementation Outline (c)).
- [x] T005 [Foundation] 같은 파일에 `READ_TOOLS = new Set(['repo_read_file', 'repo_symbol_context', 'repo_symbols', 'repo_references'])` 상수를 정의한다(spec FR-003).
- [x] T006 [Foundation] 두 상수의 출처가 README / DESIGN 도구 표에서 옴을 짧은 주석으로 명시해 R5(stale tool list) 위험을 완화한다.

Checkpoint: 도구 카테고리 상수가 모듈 상단에 고정 — US1·US2·US3 구현 시작 가능.

---

## Phase 3: User Story 1 — Transcript에서 채택 신호를 정량화한다 (Priority: P2) MVP

**Goal**: `src/benchmark/transcript-metrics.mjs`에 `analyzeTranscriptEntries`와 `analyzeTranscriptFile`을 추가해, transcript 엔트리 배열 / JSONL 파일로부터 7개 스칼라 필드를 가진 평면 객체를 안전하게 반환한다.

**Independent Test**: `node --test tests/benchmark-transcript-metrics.test.mjs` 실행 시 합성 entries 배열을 입력으로 `assistantTurns`, `toolCalls`, `broadSearchCalls`, `readCalls`, `toolErrorCalls`, `repeatedToolPlanTurns`, `stoppedByBudget` 7개 필드를 정확한 값으로 받는지 확인한다(spec SC-002).

### Tests for User Story 1 (Required — spec FR-010)

NOTE: Tests를 먼저 작성하고 실행하면 FAIL해야 한다. 그 다음 구현으로 GREEN을 만든다.

- [x] T007 [P] [US1] `tests/benchmark-transcript-metrics.test.mjs`를 신규로 만들고 "요약 시나리오" 테스트를 추가한다: 두 assistant 턴 + broad search 1회 + read 2회 + 마지막 `meta` 엔트리 `stats.stoppedByBudget: false`. 기대값은 `{ assistantTurns: 2, toolCalls: 합산값, broadSearchCalls: 1, readCalls: 2, toolErrorCalls: 0, repeatedToolPlanTurns: 0, stoppedByBudget: false }`로 7개 필드를 deep-equal 비교(spec Acceptance US1.1, US1.3, SC-002).
- [x] T008 [P] [US1] 같은 테스트 파일에 "반복 계획 + tool error" 테스트를 추가한다: 두 assistant 턴이 동일한 `toolCalls: [{ name: 'repo_grep' }]` 계획을 사용하고 한 `tool` 엔트리가 `error: true`를 갖는 입력에 대해 `repeatedToolPlanTurns === 1`, `toolErrorCalls === 1`을 검증한다(spec Acceptance US1.2).
- [x] T009 [P] [US1] 같은 테스트 파일에 `analyzeTranscriptFile(null)`가 `null`을 돌려주는지 검증하는 보강 테스트를 추가한다(spec FR-006 + Edge Case).

### Implementation for User Story 1

- [x] T010 [US1] `src/benchmark/transcript-metrics.mjs`에 `analyzeTranscriptEntries(entries)`를 구현한다. 빈 배열 입력에 대해 7개 필드를 모두 0/false로 채워 반환한다(Edge Case + SC-002).
- [x] T011 [US1] 같은 함수에서 `entries`를 한 번 순회하며 `assistant` 엔트리는 `assistantTurns`를 증가시키고 그 `toolCalls`(배열일 때만)를 모아 누적, `tool` 엔트리는 `toolCalls`를 증가시키고 `BROAD_SEARCH_TOOLS`/`READ_TOOLS` 멤버십에 따라 `broadSearchCalls`/`readCalls`를 증가, `error === true`이면 `toolErrorCalls`를 증가시키는 로직을 작성한다(spec FR-002, FR-003).
- [x] T012 [US1] 같은 함수에서 `repeatedToolPlanTurns` 계산을 추가한다. 각 `assistant` 엔트리의 `toolCalls`에서 도구 이름만 뽑아 `Array.from(...).filter(Boolean).sort().join('|')`로 정규화하고, 빈 문자열은 비교 대상에서 제외하며, 직전 turn의 정규화 결과와 동일하면 +1 한다(spec FR-004, plan Implementation Outline (b)).
- [x] T013 [US1] 같은 함수에서 `stoppedByBudget`을 가장 마지막에 등장한 `meta` 엔트리의 `stats.stoppedByBudget`로 결정한다. `entries.slice().reverse().find(e => e?.type === 'meta' && e.stats)` 형태로 마지막 우선 보장, 값은 boolean 캐스팅(spec FR-005, Edge Case "멀티 meta 마지막 우선").
- [x] T014 [US1] 같은 파일에 `analyzeTranscriptFile(filePath)`를 export한다. `filePath`가 falsy면 즉시 `null` 반환, 아니면 `node:fs/promises`의 `readFile`로 읽어 `\n` 분리 → 빈 줄 무시 → `JSON.parse` → `analyzeTranscriptEntries`에 위임한다(spec FR-006, plan Implementation Outline (a)).
- [x] T015 [US1] 두 함수를 `export` 한 뒤 T007~T009 테스트를 `node --test tests/benchmark-transcript-metrics.test.mjs`로 실행해 0 failures를 확인한다(spec SC-001).

Checkpoint: US1 단독으로 transcript 메트릭 모듈과 단위 테스트가 GREEN. 다른 스토리 없이도 운영자가 한 transcript 파일에 대한 요약을 받을 수 있다(spec SC-004).

---

## Phase 4: User Story 2 — Benchmark 보고서에 채택 신호 평균이 포함된다 (Priority: P2)

**Goal**: `scripts/run-benchmark.mjs`의 케이스 루프가 `result.transcriptPath`를 만나면 US1 모듈을 호출해 케이스별 `transcriptMetrics`를 채우고, 같은 파일의 `computeExtendedMetrics()`가 transcript 가진 케이스만 모아 `avgBroadSearchCalls`와 `avgRepeatedToolPlanTurns`를 반올림해 보고한다.

**Independent Test**: 합성 transcript 파일 두 개를 갖춘 더미 케이스 두 건의 `caseResults`를 `computeExtendedMetrics()`에 흘려보내면 두 신규 필드가 들어 있어야 하고, transcript가 하나도 없는 입력에서는 두 필드가 모두 `null`이어야 한다(spec SC-003, Acceptance US2.2).

### Implementation for User Story 2

- [x] T016 [US2] `scripts/run-benchmark.mjs` 상단의 import 블록에 `import { analyzeTranscriptFile } from '../src/benchmark/transcript-metrics.mjs';`를 추가한다(plan Implementation Outline (d)).
- [x] T017 [US2] 같은 파일의 케이스 루프(`const caseResult = { caseDefinition, evaluation, result, elapsedMs };` 직전)에서 `const transcriptMetrics = result.transcriptPath ? await analyzeTranscriptFile(result.transcriptPath).catch(() => null) : null;`을 추가하고, 이어지는 `caseResult` 객체에 `transcriptMetrics` 필드를 포함시킨다(spec FR-007, Acceptance US2.3, plan R2).
- [x] T018 [US2] 같은 파일의 `computeExtendedMetrics(caseResults)` 함수에 transcript 메트릭 가진 케이스만 필터링하는 라인을 추가한다 (`const transcriptCases = caseResults.filter(c => c.transcriptMetrics);`).
- [x] T019 [US2] 같은 함수에서 `transcriptCases`의 `broadSearchCalls` 합과 `repeatedToolPlanTurns` 합을 구해 평균을 계산하고, 반환 객체에 다음 두 필드를 추가한다: `avgBroadSearchCalls`, `avgRepeatedToolPlanTurns`. 케이스 수가 1 이상이면 `Math.round((sum / n) * 10) / 10` 로 소수 첫째 자리 반올림, 0이면 `null`을 반환한다(spec FR-008, Acceptance US2.1·US2.2).
- [x] T020 [US2] 같은 파일의 콘솔 요약 블록(현재 267~278라인 근처 `if (metrics) { ... }`)에 `avgBroadSearchCalls`와 `avgRepeatedToolPlanTurns` 두 줄을 추가해 운영자가 즉시 비교 가능하도록 표시한다(spec SC-005, plan Implementation Outline (e)).

Checkpoint: transcript가 활성화된 환경에서는 보고서 JSON과 콘솔 요약에 두 평균이 노출되고, 비활성 환경에서는 두 값이 자동으로 `null`로 떨어진다(spec SC-003).

---

## Phase 5: User Story 3 — Adoption 케이스에 구조화된 결과 신호를 추가한다 (Priority: P3)

**Goal**: `benchmarks/adoption.json`의 기존 케이스에 evidence 인용을 검증하는 `min_evidence_snippet_count` 체크를 추가하고, 케이스 내 체크 weight 합이 1을 넘지 않도록 주변 weight를 재조정한다.

**Independent Test**: `benchmarks/adoption.json`을 그대로 어돕션 평가기에 흘렸을 때 새 체크가 추가된 케이스에서 evidence 스니펫 보유 응답은 통과, 미보유 응답은 실패로 기록되고 다른 체크 점수는 그대로 유지된다(spec Acceptance US3.1·US3.2).

### Implementation for User Story 3

- [x] T021 [US3] `benchmarks/adoption.json`에서 evidence가 의미 있게 반환되는 워크플로 케이스(`map-change-impact`, `review-change-context` 등 plan Implementation Outline (f)가 언급하는 케이스 군)를 식별한다.
- [x] T022 [US3] 식별된 각 케이스의 `checks` 배열에 `{ "label": "Citations or evidence snippets present", "type": "min_evidence_snippet_count", "value": 1, "weight": 0.1 }` 항목을 추가한다(spec FR-009).
- [x] T023 [US3] 같은 케이스의 기존 체크 weight 합이 1을 넘지 않도록 주변 weight를 최소 변경(가장 큰 weight를 0.05 씩 감액)으로 재조정한다(plan Implementation Outline (f)).
- [x] T024 [US3] `min_citation_count` 류 체크는 본 작업에서 추가하지 않는다는 사실을 PR 설명/커밋 메시지에 명시하기 위한 짧은 메모를 남긴다(Task 3와의 경계 보존, spec FR-009 후단).

Checkpoint: 어돕션 점수 산출에 evidence 신호가 반영되고 transcript 신호와 함께 V2 채택 판단 근거가 강화된다.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: spec의 Edge Case 목록을 본문 모듈/스크립트의 가드 코드와 테스트로 마무리 점검한다.

- [x] T025 [P] `src/benchmark/transcript-metrics.mjs`의 `analyzeTranscriptEntries`에 `toolCalls`가 누락되거나 배열이 아닌 assistant 엔트리를 빈 plan으로 취급해 반복 카운트에 영향이 없도록 `Array.isArray` 가드를 점검한다(spec Edge Case + FR-004, plan R4).
- [x] T026 [P] 같은 파일의 `analyzeTranscriptFile`이 JSONL 줄 중 하나라도 `JSON.parse`에 실패하면 케이스 단위로 격리되도록 try/catch를 점검한다 — 파일 전체를 throw 하지 않고 호출부의 `.catch(() => null)`와 함께 케이스 단위 `null` 처리를 보장(spec Edge Case + Acceptance US2.3, plan R2).
- [x] T027 [P] `analyzeTranscriptEntries`가 여러 `meta` 엔트리 입력에서 마지막 `meta`의 `stats.stoppedByBudget`을 사용하는지 단위 테스트로 한 줄 추가 검증한다(spec Edge Case "멀티 meta 마지막 우선", plan R3).
- [x] T028 `npm test`를 실행해 다른 벤치마크/MCP 테스트가 transcript 인프라/보고서 변경으로 회귀하지 않았는지 확인한다(plan Test Strategy).
- [ ] T029 (옵션) `npm run benchmark`을 provider 키가 있는 환경에서 한 번 실행해 결과 JSON에 `avgBroadSearchCalls`/`avgRepeatedToolPlanTurns` 두 필드가 등장하고 transcript 비활성 환경에서는 두 값이 `null`인지 시각 점검한다(spec SC-003).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 의존성 없음 — 즉시 시작 가능.
- **Foundational (Phase 2)**: Setup 완료 후 시작. 모든 사용자 스토리를 BLOCK한다.
- **User Story 1 (Phase 3)**: Foundational 완료 후 시작. US2의 입력을 제공.
- **User Story 2 (Phase 4)**: Foundational + US1 모듈 export 완료 후 시작(`analyzeTranscriptFile`을 import).
- **User Story 3 (Phase 5)**: Foundational 완료 후 시작. US1/US2와 파일이 다르므로 독립 진행 가능.
- **Polish (Phase 6)**: 모든 사용자 스토리 완료 후 시작.

### User Story Dependencies

- **US1**: 모듈 + 단위 테스트로 독립 검증.
- **US2**: US1이 export하는 `analyzeTranscriptFile`에 의존. US1 미완 상태에서는 import가 깨진다.
- **US3**: `benchmarks/adoption.json` 한 파일만 손대므로 US1/US2와 독립적으로 진행 가능.

### Within Each User Story

- Tests를 먼저 작성하고 FAIL을 확인한 뒤 구현으로 GREEN을 만든다(US1 한정 필수).
- 도구 카테고리 상수(Phase 2) → 분석 함수(US1) → 케이스 루프/보고서 통합(US2) → adoption.json 보강(US3) 순서로 흐른다.
- 같은 파일에 동시에 손대지 않는다(특히 US1 모듈 파일은 한 사람만 편집).

### Parallel Opportunities

- Phase 1의 T001~T003은 모두 [P] — 동시 진행.
- Phase 2의 T004·T005는 같은 파일이라 순차, T006(주석)은 두 상수 정의 후 추가.
- Phase 3의 T007·T008·T009 테스트 작성은 [P] — 동시 진행 가능.
- US1 구현(T010~T014)은 같은 파일이라 순차 진행.
- US2(scripts/run-benchmark.mjs)와 US3(benchmarks/adoption.json)은 서로 다른 파일이라 두 명이 동시에 진행 가능.
- Phase 6의 T025·T026·T027은 같은 모듈이라 직렬 진행 권장, T028은 모든 변경 후 단독 실행.

---

## Parallel Example: User Story 1

```text
# US1 테스트 3종을 동시에 작성 (같은 파일 내 다른 it/test 블록):
Task: "tests/benchmark-transcript-metrics.test.mjs에 요약 시나리오 테스트 추가"
Task: "tests/benchmark-transcript-metrics.test.mjs에 반복 계획 + tool error 테스트 추가"
Task: "tests/benchmark-transcript-metrics.test.mjs에 analyzeTranscriptFile(null) null 반환 테스트 추가"

# 같은 파일이므로 실제로는 한 파일 한 PR로 묶어서 작성. [P] 마크는 머리 속에서의 병렬성을 표시.
```

---

## Implementation Strategy

### MVP First (US1만)

1. Phase 1 + Phase 2 완료(도구 카테고리 상수 확정).
2. Phase 3 (US1) 단독 완료 — 운영자가 한 transcript 파일에 대해 메트릭 요약을 받을 수 있다(spec SC-004).
3. STOP & VALIDATE: `node --test tests/benchmark-transcript-metrics.test.mjs` 0 failures.

### Incremental Delivery

1. US1 모듈/테스트 GREEN → 벤치마크에서 직접 호출은 안 되지만 함수로 검증 가능.
2. US2 통합 → run-benchmark 보고서에 두 평균 노출.
3. US3 → adoption.json에 evidence 신호 추가.
4. Polish → Edge Case 가드 점검 + npm test 회귀.

### Parallel Team Strategy

- Dev A: US1 모듈 + 단위 테스트(Phase 3 전체).
- Dev B: Phase 2 상수 확정 직후 US2 구조 작업(import 추가 / `caseResult` 필드 추가)을 stub `analyzeTranscriptFile` mock으로 먼저 진행 후 US1 export 완료 시점에 실제 함수로 교체.
- Dev C: US3(adoption.json) 독립 진행.

---

## Notes

- 본 작업은 코드 변경 작업이 아니라 **tasks.md 초안 작성**이다. 위 작업 항목은 실제 구현 단계에서의 가이드라인이며, 본 산출물에서는 어떤 소스 파일도 수정하지 않는다.
- 모든 경로는 저장소 루트 기준 상대 경로다.
- transcript 분석은 새 런타임 의존성을 도입하지 않으며 `node:fs/promises`, `node:test`만 사용한다(plan Constitution Check).
- `computeExtendedMetrics`는 plan.md 명시대로 `scripts/run-benchmark.mjs` 내부에 있다. `src/benchmark/report.mjs`는 본 작업 범위에서 수정하지 않는다(plan R6).
- `min_citation_count` 류 체크는 Task 3에서 다룬다 — 본 작업의 US3 범위 밖.
