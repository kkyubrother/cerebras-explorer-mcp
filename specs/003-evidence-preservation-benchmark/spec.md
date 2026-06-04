# Feature Specification: Evidence Preservation Benchmark Coverage

**Feature Branch**: `003-evidence-preservation-benchmark`

**Created**: 2026-05-21

**Status**: Implemented

**Input**: User description: "Task 3 (Add Evidence Preservation Benchmark Coverage). 원본 plan의 Task 3 섹션 참조. report-mode 도구의 citation 보존을 측정하는 별도 벤치마크 suite를 추가한다. 카테고리: P1. 의존성: Task 2(citations[]) 선행 필수."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - report-mode 도구의 citation 보존을 회귀 없이 측정 (Priority: P1)

벤더(저장소 운영자)는 explore / explore_v2 와 같이 Markdown report를 반환하는 도구가 deep 또는 broad 모드로 동작할 때도 기계가 읽을 수 있는 citation을 충분히 보존하는지를 자동으로 측정하고 싶다. 기존 adoption suite는 explore_repo 류의 구조화된 응답(`evidence[]`)만 검증하므로, report-mode 응답에서 인용이 누락되거나 가공 과정에서 사라져도 회귀 신호가 잡히지 않는다. 별도 벤치마크 suite와 평가 체크를 추가해 report-mode 응답이 일정 수 이상의 citation, 일정 수 이상의 서로 다른 cited 파일을 가지며 truncation이나 citation gap warning이 발생하지 않았음을 확인할 수 있어야 한다.

**Why this priority**: report-mode 도구는 LLM 에이전트가 후속 행동을 결정할 때 가장 자주 인용하는 산출물이다. citation이 사라지면 에이전트는 "어디서 왔는지 알 수 없는 주장"을 그대로 신뢰하게 되고, 이는 도구 품질 플랜 전체의 신뢰성 목표를 직접 무너뜨린다. 따라서 P1.

**Independent Test**: `benchmarks/evidence-preservation.json` suite를 단독으로 평가했을 때 (1) 신규 체크 타입이 모두 동작하고 (2) citation 보존이 잘 된 mock result는 통과, 누락된 mock result는 실패하는지를 evaluator 테스트만으로 검증할 수 있다. 실제 provider 호출 없이도 suite 파일과 평가기 로직이 독립적으로 가치를 전달함.

**Acceptance Scenarios**:

1. **Given** citation 2개 이상과 서로 다른 cited 파일 2개 이상을 포함하고 truncation/citation gap warning이 없는 report-mode 결과가 주어졌을 때, **When** 신규 evidence preservation 벤치마크 케이스가 평가되면, **Then** 모든 신규 체크가 통과하고 케이스의 종합 점수가 pass 임계값을 넘는다.
2. **Given** report 본문에는 파일 경로가 언급되지만 구조화된 citation 배열이 비어 있는 결과가 주어졌을 때, **When** 동일 케이스가 평가되면, **Then** citation 개수/파일 수 체크가 실패하고 케이스 전체가 회귀 신호로 보고된다.
3. **Given** 결과의 검색 통계나 coverage 메트릭이 도구 결과 truncation을 표시했거나 critic warning에 citation gap이 포함된 경우, **When** 동일 케이스가 평가되면, **Then** truncation/citation gap 체크가 명시적으로 실패로 표기되어 원인을 식별할 수 있다.

---

### User Story 2 - 신규 suite를 기존 워크플로에 충돌 없이 실행 (Priority: P2)

저장소 운영자는 새 suite를 기존 `benchmark` 스크립트나 adoption suite와 분리해서 독립적으로 실행할 수 있어야 한다. 기존 회귀 흐름(예: CI 또는 수동 실행)에 영향을 주지 않으면서, evidence preservation만 따로 측정하고 싶을 때 단일 명령으로 호출할 수 있어야 한다.

**Why this priority**: 신규 suite가 기존 명령을 변경하거나 기본 동작에 끼어들면 운영자가 도입을 망설이고 회귀가 누적된다. 별도 진입점을 통한 분리는 도입 비용을 낮추지만, P1(체크 자체의 존재)이 없이는 의미가 없으므로 P2.

**Independent Test**: 새 npm 스크립트만 단독으로 실행해도 suite 파일이 정상적으로 파싱되고, 기존 `benchmark` 스크립트는 변경 없이 동작하는지 비교 검증할 수 있다.

**Acceptance Scenarios**:

1. **Given** 저장소에 evidence preservation suite 파일과 신규 스크립트가 추가된 상태일 때, **When** 운영자가 신규 스크립트를 호출하면, **Then** suite 파일이 파싱되고 케이스 목록이 비어 있지 않은 형태로 로드된다.
2. **Given** 동일 상태에서 기존 adoption 벤치마크 스크립트를 호출했을 때, **When** 실행하면, **Then** 기존 suite의 평가 흐름과 출력 형식이 그대로 유지된다.

---

### Edge Cases

- 결과의 citation 배열이 `null` 또는 비배열 값인 경우에도 평가기는 예외 없이 0으로 처리되어야 한다.
- 동일 파일을 가리키는 citation이 여러 개일 때, 파일 수 체크는 중복을 제거한 고유 파일 수로 측정해야 한다.
- 결과에 검색 coverage 메트릭이 아예 없거나 critic warning 구조가 누락된 경우에도 신규 체크는 "truncation/warning 없음"으로 안전하게 해석되어야 한다.
- suite 파일에 새 체크 타입이 등장하지만 결과에는 해당 필드가 없을 때, 평가기는 의미 있는 실패 사유와 함께 결과를 남겨야 한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 벤치마크 평가기는 report-mode 결과의 구조화된 인용 항목 개수를 기준으로 최소 인용 수 체크를 수행할 수 있어야 한다.
- **FR-002**: 벤치마크 평가기는 인용 항목들이 가리키는 서로 다른 파일의 개수(중복 제거 후)를 기준으로 최소 파일 다양성 체크를 수행할 수 있어야 한다.
- **FR-003**: 벤치마크 평가기는 결과의 검색 coverage 또는 통계 영역에서 보고된 도구 결과 truncation 발생 여부에 대한 동등성 체크(`tool_results_truncated_equals`)를 지원해야 한다.
- **FR-004**: 벤치마크 평가기는 결과의 critic warning 목록에 citation gap 종류 경고가 포함되었는지에 대한 동등성 체크(`citation_gap_warning_equals`)를 지원해야 한다.
- **FR-005**: `benchmarks/` 아래에 evidence preservation 전용 suite 파일이 존재하고, 해당 파일은 report-mode 도구(예: explore)를 호출하는 하나 이상의 케이스를 포함해야 한다.
- **FR-006**: 새 suite 파일은 신규 체크 타입(인용 수, 파일 다양성, truncation 동등성, citation gap warning 동등성) 각각을 최소 한 번 이상 사용해, 모든 체크가 실제 케이스에서 실행 경로를 갖도록 해야 한다.
- **FR-007**: 저장소는 evidence preservation suite를 기존 adoption 벤치마크와 충돌 없이 단독 실행할 수 있는 별도 npm 스크립트 진입점을 제공해야 한다.
- **FR-008**: 기존 `benchmark` 스크립트, 기존 adoption suite, 기존 체크 타입(`min_grounded_evidence_count` 등)의 동작과 결과 포맷은 변경되지 않아야 한다(회귀 금지).

### Key Entities *(include if feature involves data)*

- **Evidence Preservation Suite**: report-mode 도구 응답의 citation 보존 품질을 측정하는 벤치마크 케이스 묶음. 이름/설명/기본 통과 점수/케이스 목록을 가진다.
- **Citation Check**: 결과의 구조화된 인용 배열에서 도출되는 측정치(개수, 고유 파일 수)를 임계값과 비교하는 체크 항목.
- **Truncation/Warning Equality Check**: 결과의 검색 coverage·통계·critic warning 신호를 불리언으로 환원해 기대값과 일치하는지 비교하는 체크 항목.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 신규 체크 타입(인용 수, 인용 파일 다양성, truncation 동등성, citation gap warning 동등성) 4종 모두에 대해, 통과/실패 두 방향을 검증하는 평가기 단위 테스트가 존재하고 0 failure로 통과한다.
- **SC-002**: `benchmarks/` 디렉터리에 evidence preservation suite 파일이 존재하며, suite 파일을 JSON으로 파싱한 결과가 1개 이상의 케이스 배열을 포함한다(파일 부재 또는 빈 케이스 배열이면 실패).
- **SC-003**: 신규 suite를 위한 단독 npm 스크립트 진입점이 추가되고, 기존 `benchmark` 스크립트는 그대로 유지되어 동일 명령으로 adoption suite 실행 결과가 변하지 않는다.
- **SC-004**: 전체 테스트 스위트(`npm test`) 실행 시 evidence preservation 관련 테스트 포함 후에도 0 failure로 종료된다.

## Assumptions

- Task 2(공통 citations 배열 도입)가 본 작업보다 먼저 완료되어 있어야 한다. 신규 체크는 결과 객체의 구조화된 `citations[]` 필드를 직접 읽으므로, 해당 필드가 존재하지 않는 상태에서는 의미 있는 회귀 신호를 생성할 수 없다.
- report-mode 도구는 결과 객체에 검색 coverage 통계(`searchCoverage`)와 critic warning 목록을 노출하는 기존 관행을 유지한다. 본 작업은 이 노출 표면 자체를 새로 만들지 않고, 그 위에 평가 체크만 추가한다.
- 신규 suite는 실제 provider 호출 없이도 suite 파일 파싱과 평가기 로직만으로 독립적인 회귀 신호를 줄 수 있어야 한다. provider를 호출하는 풀 실행은 별도 운영 결정으로, 본 spec의 통과 조건은 아니다.
- 기존 evidence 관련 체크(`min_grounded_evidence_count`, `min_evidence_snippet_count`)는 explore_repo 류 구조화 응답을 위한 것이며, 본 작업은 이를 대체하지 않고 report-mode를 위한 별도 차원을 추가한다.
- 본 작업의 범위는 평가기 로직과 suite 파일 추가, 그리고 단독 진입점 노출까지로 한정한다. report 본문에서 citation을 실제로 더 많이 만들어내도록 도구 자체의 합성 전략을 바꾸는 것은 범위 밖이다.
