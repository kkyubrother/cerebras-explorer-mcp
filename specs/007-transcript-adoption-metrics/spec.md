# Feature Specification: Transcript-Based Adoption Metrics

**Feature Branch**: `007-transcript-adoption-metrics`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Task 7 (Add Transcript-Based Adoption Metrics). JSONL transcript에서 broad search·repeated reads·repeated plans 같은 V2 채택 판단 신호를 추출하는 메트릭 모듈을 추가한다. 원본 plan: docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md Task 7. 카테고리: P2. transcript 인프라는 이미 존재함."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Transcript에서 채택 신호를 정량화한다 (Priority: P2)

벤치마크를 돌리는 운영자는 V2 백엔드가 부모 에이전트의 행동 패턴을 실제로 개선하는지 판단해야 한다. 현재 transcript JSONL은 turn별 assistant 발화, tool 호출, 최종 stats를 기록하고 있지만 이 raw 기록만으로는 "broad search를 얼마나 자주 했는가", "같은 도구 계획을 반복했는가", "read 도구를 몇 번이나 다시 불렀는가" 같은 채택 신호를 빠르게 비교할 수 없다. 이 사용자는 transcript 파일 한 개를 받아 채택 신호를 요약한 객체를 돌려주는 분석 함수를 통해, 벤치마크 케이스마다 같은 형식의 수치를 얻는다.

**Why this priority**: V2 채택 판단을 위한 가시성 확보 단계이고, 기능 자체를 차단하는 P1 결함은 아니지만 운영자가 V2 전환 결정을 내리는 데 필요한 근거 자료를 만든다.

**Independent Test**: `src/benchmark/transcript-metrics.mjs`에 `analyzeTranscriptEntries`가 추가되고, 합성된 transcript 엔트리 배열을 입력으로 받아 `assistantTurns`, `toolCalls`, `broadSearchCalls`, `readCalls`, `toolErrorCalls`, `repeatedToolPlanTurns`, `stoppedByBudget` 필드를 가진 객체를 돌려주는지 단위 테스트로 검증할 수 있다.

**Acceptance Scenarios**:

1. **Given** assistant 두 턴과 broad search 한 번, read 두 번이 섞인 transcript 엔트리 배열이 있을 때, **When** `analyzeTranscriptEntries`를 호출하면, **Then** 반환 객체의 `assistantTurns`는 2, `broadSearchCalls`는 1, `readCalls`는 2, `repeatedToolPlanTurns`는 0이어야 한다.
2. **Given** 두 assistant 턴이 동일한 도구 계획(`repo_grep`)을 반복하고 한 tool 결과에 `error: true`가 있을 때, **When** 분석을 호출하면, **Then** `repeatedToolPlanTurns`는 1, `toolErrorCalls`는 1이어야 한다.
3. **Given** 마지막 `meta` 엔트리에 `stats.stoppedByBudget: true`가 기록된 transcript가 있을 때, **When** 분석을 호출하면, **Then** 반환 객체의 `stoppedByBudget`은 `true`여야 한다.

---

### User Story 2 - Benchmark 보고서에 채택 신호 평균이 포함된다 (Priority: P2)

벤치마크 스크립트 사용자는 케이스별 transcript 메트릭이 아니라 케이스 묶음에 대한 평균값으로 V2 채택 변화를 추적하고 싶다. `scripts/run-benchmark.mjs`는 각 케이스 실행 결과에 transcript 파일 경로(`result.transcriptPath`)가 있을 때 위 분석 함수를 호출하고, 모든 케이스에 대한 `avgBroadSearchCalls`와 `avgRepeatedToolPlanTurns`를 보고서 메트릭에 포함한다.

**Why this priority**: 단위 메트릭만 있고 종합 리포트가 없으면 운영자는 여전히 수기로 transcript를 뒤져야 한다. P1 메트릭 모듈에 의존하므로 이후 우선순위로 둔다.

**Independent Test**: 합성 transcript 파일이 주어진 더미 케이스 두 개를 run-benchmark의 `computeExtendedMetrics()`에 흘려보내 반환된 메트릭 객체가 두 신규 평균 필드를 포함하고, transcript가 하나도 없는 경우 두 값이 `null`인지 확인한다.

**Acceptance Scenarios**:

1. **Given** transcript 파일을 갖춘 케이스 두 건이 각각 `broadSearchCalls` 2와 0을 반환할 때, **When** 벤치마크 보고서를 만들면, **Then** `avgBroadSearchCalls`는 소수 첫째 자리로 반올림된 `1.0`이어야 한다.
2. **Given** transcript가 비활성화되어 케이스에 transcript 메트릭이 하나도 없는 경우, **When** 보고서를 만들면, **Then** `avgBroadSearchCalls`와 `avgRepeatedToolPlanTurns`는 `null`이어야 한다.
3. **Given** transcript 파일을 읽다가 JSON 파싱 오류가 발생하는 경우, **When** run-benchmark가 해당 케이스를 처리하면, **Then** 그 케이스의 transcript 메트릭은 `null`로 떨어지고 다른 케이스 분석은 중단되지 않아야 한다.

---

### User Story 3 - Adoption 케이스에 구조화된 결과 신호를 추가한다 (Priority: P3)

운영자는 transcript 외에도 V2가 산출한 응답 자체에 evidence 인용이 포함되는지를 채택 신호의 일부로 보고 싶다. `benchmarks/adoption.json`은 기존 케이스에 evidence 스니펫 최소 1건을 요구하는 체크를 추가해 채택 기준을 보강한다.

**Why this priority**: transcript 메트릭이 핵심이고 adoption 체크는 보조 신호다. 또한 기존 체크 항목 확장이라 변경 범위가 가장 작다.

**Independent Test**: `benchmarks/adoption.json`에 새 체크가 추가되어 있고 기존 적용 도구로 평가 시 weight가 합산에 반영되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** evidence 스니펫이 반환된 V2 응답이 있을 때, **When** adoption 평가를 실행하면, **Then** 새 체크가 통과하여 점수가 더해진다.
2. **Given** evidence 스니펫이 없는 응답이 있을 때, **When** adoption 평가를 실행하면, **Then** 해당 체크는 실패로 기록되고 다른 체크 점수는 그대로 유지된다.

---

### Edge Cases

- transcript 엔트리가 빈 배열인 경우 모든 카운터는 0, `stoppedByBudget`은 `false`로 안전하게 반환된다.
- `toolCalls` 필드가 누락되거나 배열이 아닌 assistant 엔트리는 도구 계획 비교에서 빈 계획으로 취급해 잘못된 반복 카운트를 만들지 않는다.
- `meta` 엔트리가 여러 번 등장하는 경우, 마지막에 등장한 `stats`를 기준으로 한다.
- transcript 파일 경로가 비어 있거나 `null`인 케이스는 `analyzeTranscriptFile`이 `null`을 돌려주어 보고서 평균 계산에서 자동 제외된다.
- transcript 파일이 존재하지만 깨진 줄(JSON 파싱 실패)을 포함할 때, 케이스 단위로 메트릭을 `null` 처리하고 벤치마크 전체 실행은 계속한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 `src/benchmark/transcript-metrics.mjs` 모듈을 제공해야 하며 `analyzeTranscriptEntries(entries)`와 `analyzeTranscriptFile(filePath)` 두 함수를 export해야 한다.
- **FR-002**: `analyzeTranscriptEntries`는 입력 엔트리 배열로부터 `assistantTurns`, `toolCalls`, `broadSearchCalls`, `readCalls`, `toolErrorCalls`, `repeatedToolPlanTurns`, `stoppedByBudget` 키를 가진 단일 평면 객체를 반환해야 한다.
- **FR-003**: broad search 분류는 `repo_grep`, `repo_find_files`, `repo_list_dir` 세 도구를 포함해야 하며, read 분류는 `repo_read_file`, `repo_symbol_context`, `repo_symbols`, `repo_references` 네 도구를 포함해야 한다.
- **FR-004**: `repeatedToolPlanTurns`는 어시스턴트가 직전 턴과 정렬된 동일 도구 집합을 반복할 때만 1씩 증가해야 하며, 빈 도구 계획은 비교에서 제외해야 한다.
- **FR-005**: `stoppedByBudget`은 가장 마지막에 등장한 `meta` 엔트리의 `stats.stoppedByBudget` 값을 boolean으로 캐스팅해 반환해야 한다.
- **FR-006**: `analyzeTranscriptFile`은 JSONL 파일을 줄 단위로 파싱해 빈 줄을 무시하고 `analyzeTranscriptEntries`에 위임해야 하며, `filePath`가 falsy인 경우 `null`을 반환해야 한다.
- **FR-007**: `scripts/run-benchmark.mjs`는 각 케이스 실행 후 `result.transcriptPath`가 있으면 `analyzeTranscriptFile`을 호출해 `caseResult.transcriptMetrics`로 저장해야 하고, 호출 실패 시 `null`로 떨어지되 전체 실행을 중단하지 않아야 한다.
- **FR-008**: 벤치마크 보고서의 `computeExtendedMetrics()`는 transcript 메트릭이 있는 케이스만 모아 `avgBroadSearchCalls`와 `avgRepeatedToolPlanTurns`를 계산해야 하며, 두 값은 소수 첫째 자리까지 반올림하고 transcript가 하나도 없을 때 `null`로 보고해야 한다.
- **FR-009**: `benchmarks/adoption.json`에는 evidence 인용을 검증하는 체크 항목(`min_evidence_snippet_count` 등)이 추가되어야 하며, Task 3에서 추가되는 report-mode 케이스는 `min_citation_count`로 별도 검증한다.
- **FR-010**: `tests/benchmark-transcript-metrics.test.mjs`는 P1 플랜과 동일한 두 단위 테스트(요약, 반복 계획)를 포함해야 하며, `node --test`로 실행 시 0 failures로 통과해야 한다.

### Key Entities *(include if feature involves data)*

- **Transcript Entry**: JSONL 한 줄로 표현되는 기록 단위. `type`(`assistant` | `tool` | `meta`), `turn`, `tool`, `toolCalls`, `error`, `stats` 등의 부분 필드를 갖는다. 분석 모듈은 이 형태에 추가 필드가 들어와도 알려진 키만 사용해 결과를 만든다.
- **Transcript Metrics**: 한 transcript 파일에 대한 요약 객체. assistant 턴 수, 도구 호출 합계, broad search·read 카운트, tool error 카운트, 반복 도구 계획 턴 수, 예산 초과 종료 여부의 7개 스칼라 필드로 구성된다.
- **Benchmark Case Result**: 한 케이스 실행 결과 묶음. 기존 `caseDefinition`, `evaluation`, `result`, `elapsedMs`에 더해 신규 `transcriptMetrics`(`null` 또는 위 요약 객체)를 포함한다.
- **Adoption Check**: `benchmarks/adoption.json`의 케이스별 체크 항목. evidence 인용/citation 최소 개수 등을 평가하며 가중치를 통해 최종 채택 점수에 기여한다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `node --test tests/benchmark-transcript-metrics.test.mjs`가 0 failures로 통과한다.
- **SC-002**: 동일한 transcript 입력에 대해 `analyzeTranscriptEntries`는 항상 동일한 7개 스칼라 필드를 가진 객체를 반환하며 누락 필드가 없다.
- **SC-003**: 벤치마크 결과 JSON에 `avgBroadSearchCalls`와 `avgRepeatedToolPlanTurns` 두 필드가 항상 존재하고, transcript가 비활성화된 실행에서는 두 값이 `null`로 보고된다.
- **SC-004**: transcript 파일 1개를 별도로 던졌을 때 운영자가 보조 스크립트 없이 한 번의 함수 호출만으로 채택 신호 요약을 얻을 수 있다.
- **SC-005**: V2와 V1을 같은 케이스로 비교 실행했을 때, 두 백엔드의 채택 신호(broad search 평균, 반복 도구 계획 평균) 차이가 보고서에서 즉시 식별 가능하다.

## Assumptions

- `src/explorer/transcript.mjs`의 `createTranscriptRecorder`가 이미 JSONL을 기록하고 있으며, `CEREBRAS_EXPLORER_TRANSCRIPT` 환경 변수로 opt-in되는 인프라를 그대로 사용한다.
- `src/explorer/runtime.mjs`가 작성하는 transcript 엔트리는 `type: 'assistant' | 'tool' | 'meta'`와 plan 가정 스키마(`toolCalls`, `tool`, `error`, `stats`)를 만족한다는 사전 검증 결과를 신뢰한다.
- 본 작업은 새 런타임 의존성을 도입하지 않으며 Node 표준 `node:fs/promises`와 `node:test`만 사용한다.
- transcript 분석은 단일 transcript 파일 단위로 동작하며 멀티 세션 집계는 본 스코프 밖이다.
- adoption.json 체크 추가는 평가기(evaluator)가 이미 지원하는 체크 타입(`min_evidence_snippet_count`, `min_citation_count`)을 재사용한다는 전제이며, 새로운 평가 타입을 추가하지 않는다.
