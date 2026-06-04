# Feature Specification: TESTING.md 고정 테스트 수치 제거 및 Drift 가드

**Feature Branch**: `004-testing-md-drift-guard`

**Created**: 2026-05-21

**Status**: Implemented

**Input**: User description: "Task 4 (Remove Fixed Test Totals From TESTING.md). TESTING.md에서 고정 테스트 합계 숫자(320 tests, 5/5, 8개 도구 등)를 제거하고 명령+합격 기준 형식으로 전환. 통합 테스트 표와 stdio smoke 표기 포함. drift 방지 가드 테스트도 추가. 원본 plan은 docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md Task 4. 카테고리: P2. plan 정규식이 통합 테스트 표를 누락하므로 spec에서 범위를 확장한다."

> 상태: tool-quality-improvements 플랜의 Task 4 초안입니다. 원본 plan의 정규식이 단위 테스트 단락만 다루지만, 현재 `TESTING.md`에는 통합 테스트 표(`5/5 통과`)와 stdio smoke 표기(`기본 공개 도구 8개`)에도 고정 수치가 남아 있어 spec에서 적용 범위를 확장합니다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 릴리스 검증자가 고정된 숫자를 신뢰 기준으로 오해하지 않는다 (Priority: P1)

릴리스 검증자가 `TESTING.md`를 열어 통과 여부를 확인할 때, 문서에 박혀 있는 `320 tests`, `319 pass`, `1 skipped`, `5/5 통과`, `기본 공개 도구 8개` 같은 과거 관측값을 현재 합격 기준으로 오해하지 않아야 합니다. 문서는 "어떤 명령을 실행하면 무엇을 보고 통과로 판정하는가"만 남기고, 새 테스트 추가나 OS 환경 변화로 즉시 낡아 버리는 절대 수치는 제거합니다.

**Why this priority**: 잘못된 수치는 릴리스 직전 "테스트가 줄었으니 회귀인가?" 같은 헛된 의심을 유발하고, 반대로 실제 회귀가 들어왔는데도 "문서대로 320이면 되겠지" 식으로 무시될 위험도 있습니다. P1은 신뢰성 직결 항목입니다.

**Independent Test**: 새 검증자가 `TESTING.md`만 읽고 `npm test`와 통합 테스트, stdio smoke의 합격/실패 판정 기준을 1분 이내에 진술할 수 있고, 그 기준에 어떤 절대 숫자도 포함되지 않는지 확인합니다.

**Acceptance Scenarios**:

1. **Given** 검증자가 `TESTING.md`를 처음 읽는 상태, **When** "단위 테스트가 통과한다는 것의 정의가 무엇인가?"를 답해 보라고 했을 때, **Then** "`npm test`가 `0 fail`로 종료되는 것"이라고만 답하고 특정 테스트 총수를 인용하지 않는다.
2. **Given** 통합 테스트 섹션을 읽은 상태, **When** "몇 개 케이스가 통과해야 합격인가?"라고 물었을 때, **Then** `5/5` 같은 고정 분수가 아니라 "스크립트가 보고하는 전체 케이스가 모두 통과"라는 형태로 답한다.
3. **Given** stdio smoke 섹션을 읽은 상태, **When** "`tools/list` 응답에서 무엇을 확인해야 하는가?"라고 물었을 때, **Then** `8개`라는 고정 개수가 아니라 "공개 도구 목록이 누락 없이 반환되는 것"으로 진술된다.

---

### User Story 2 - Drift 가드가 향후 고정 수치 재유입을 자동으로 차단한다 (Priority: P2)

`TESTING.md`를 한 번 정리한 뒤에도, 차후 누군가 새 관측값을 "참고삼아" 다시 박아 넣을 위험이 있습니다. CI에서 실행되는 테스트 한 건이 `TESTING.md`를 읽어 금지 패턴(절대 테스트 수, 고정 분수, 고정 도구 개수)을 검사하고, 패턴이 다시 들어오면 즉시 실패시킵니다.

**Why this priority**: 1회성 청소만으로는 같은 문제가 반복됩니다. 자동 가드는 P1 효과를 영속화하는 장치라 P2로 둡니다(가드가 없어도 1회 정리 가치는 살아 있으므로 P1은 아님).

**Independent Test**: 가드 테스트만 실행해 통과를 확인한 뒤, `TESTING.md`에 임의로 `320 tests` 문구를 다시 추가한 더미 변경을 만들면 같은 테스트가 빨갛게 떨어지는 것을 보입니다.

**Acceptance Scenarios**:

1. **Given** 정리된 `TESTING.md`와 새 가드 테스트가 있는 상태, **When** `node --test tests/integrations.test.mjs --test-name-pattern "TESTING.md"`를 실행하면, **Then** 0 fail로 통과한다.
2. **Given** 누군가 `TESTING.md`에 `320 tests`, `5/5 통과`, `도구 8개` 중 어느 하나라도 다시 넣은 상태, **When** 같은 가드 테스트를 실행하면, **Then** 해당 패턴을 명시하며 실패한다.

---

### Edge Cases

- 통합 테스트 표가 향후 케이스 수가 늘어나 `7/7`로 갱신되더라도, 가드는 "`N/N 통과`" 형태의 고정 분수를 일괄 거부해야 한다(특정 숫자만 막으면 우회가 쉬움).
- 단위 테스트 단락에 회귀 추적용으로 `0 fail`은 남겨야 하므로, 가드는 "테스트 총수/통과수/skip 수"만 거부하고 "0 fail"은 허용한다.
- stdio smoke의 "공개 도구 N개" 표기는 도구 추가/제거 시마다 낡으므로, 가드는 `\d+\s*개\s*(공개\s*)?도구` 형태도 차단한다.
- API 에러 코드 표(400, 401 등)는 외부 사양에서 온 식별자이므로 가드 대상이 아니며, 가드 정규식은 "N tests/pass/skipped" 같이 테스트 결과 단어와 결합된 경우에만 매칭한다.
- 최근 확인 환경의 날짜(`2026-05-21`)는 관측 메타데이터이므로 유지한다. 가드는 날짜를 차단하지 않는다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `TESTING.md`의 단위 테스트 섹션은 "성공 기준 = `npm test`가 `0 fail`로 종료"만 명시하고, `\d+ tests`, `\d+ pass`, `\d+ skipped` 형태의 절대 수치를 포함하지 않는다.
- **FR-002**: `TESTING.md`의 통합 테스트 섹션은 케이스별 통과 여부 표를 유지하더라도, `5/5 통과`처럼 전체 케이스 수를 박은 합계 문장을 포함하지 않으며, 합격 기준은 "스크립트가 0 fail로 종료" 형태로 진술한다.
- **FR-003**: `TESTING.md`의 stdio smoke 섹션은 `tools/list` 응답에서 확인해야 할 항목을 "공개 도구 목록이 누락 없이 반환됨"으로 기술하고, `8개`처럼 도구 개수를 박은 문장을 포함하지 않는다.
- **FR-004**: `TESTING.md`는 "이 문서의 숫자는 마지막 관측값이며 실제 기준은 항상 현재 checkout에서의 `npm test` 결과"라는 디스클레이머를 단위/통합/smoke 어느 섹션을 읽어도 1회는 만나도록 유지한다.
- **FR-005**: `tests/integrations.test.mjs`(또는 동등한 doc-drift 가드용 테스트 파일)에 새 테스트가 추가되어, `TESTING.md` 본문을 읽어 다음 패턴이 존재하지 않는지 단언한다:
  - `\b\d+\s+tests\b`, `\b\d+\s+pass\b`, `\b\d+\s+skipped\b` (단위 테스트 합계)
  - `\b\d+\s*/\s*\d+\s*통과\b` (통합 테스트 고정 분수)
  - `\b\d+\s*개\s*(공개\s*)?도구\b` (stdio smoke 도구 개수)
- **FR-006**: 같은 가드 테스트는 `TESTING.md` 본문에 `npm test` 명령 표기와 `0 fail`(또는 `0 failures`) 문구가 살아 있는지 양성 단언으로 함께 확인하여, 청소 과정에서 합격 기준 자체가 사라지는 사고를 차단한다.
- **FR-007**: 가드 테스트 실패 메시지는 어떤 금지 패턴이 어디에 매칭되었는지 식별 가능해야 하며, 정규식 이름이나 매칭된 부분 문자열을 어서션 메시지에 포함한다.

### Key Entities

- **TESTING.md**: 단위 테스트, 통합 테스트, stdio smoke, API 에러 코드 참조 섹션을 가진 한국어 검증 문서. 본 작업의 편집 대상.
- **Doc-drift 가드 테스트**: `tests/integrations.test.mjs`의 새 `test(...)` 블록. `fs.readFile`로 `TESTING.md`를 읽고 금지/필수 패턴을 어서션한다.
- **원본 plan**: `docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md`의 Task 4. 본 spec은 그 plan의 정규식 범위(단위 테스트 단락만 커버)를 통합 테스트 표와 stdio smoke 표기까지 확장한 상위 계약이다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `node --test tests/integrations.test.mjs --test-name-pattern "TESTING.md"` 실행 시 추가된 drift 가드 테스트가 0 fail로 통과한다.
- **SC-002**: 정리 후 `TESTING.md`에 대해 `\b\d+\s+tests\b`, `\b\d+\s+pass\b`, `\b\d+\s+skipped\b`, `\b\d+\s*/\s*\d+\s*통과\b`, `\b\d+\s*개\s*(공개\s*)?도구\b` 다섯 정규식의 매칭 건수가 모두 0이다.
- **SC-003**: 정리 후 `TESTING.md`에 `npm test` 표기와 `0 fail`(또는 `0 failures`) 문구가 각각 최소 1회 이상 등장한다.
- **SC-004**: 임의로 `TESTING.md`에 `320 tests` 또는 `5/5 통과` 또는 `공개 도구 8개`를 다시 삽입한 더미 변경에 대해 같은 가드 테스트가 실패하며, 실패 메시지에 위반 패턴이 식별 가능한 형태로 포함된다.

## Assumptions

- `TESTING.md`는 계속 한국어로 유지된다. 영문 번역본 동기화는 본 작업 범위 밖이다.
- 가드 테스트는 `tests/integrations.test.mjs`에 추가한다. 이 파일은 이미 통합 산출물(README, integrations/) drift 검증을 담는 위치이며, `TESTING.md` 가드도 같은 목적을 따른다. 별도 파일로 분리할 합리적 이유가 생기면 분리는 허용한다.
- 통합 테스트 케이스별 결과 표 자체(케이스 이름과 "통과/실패" 마커)는 운영 정보로 가치가 있으므로 유지한다. 본 작업은 "전체 합계 분수"만 제거한다.
- API 에러 코드 표의 숫자(400, 429 등)는 외부 사양에서 온 식별자라 가드 대상 외이며, 정규식은 "테스트 결과 단어"와 결합된 형태만 매칭하도록 좁힌다.
- 본 작업은 문서/테스트 변경에 한정되며 런타임 코드(`src/**`) 변경을 요구하지 않는다.
