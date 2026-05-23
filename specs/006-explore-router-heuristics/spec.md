# Feature Specification: Strengthen Explore Router Heuristics

**Feature Branch**: `006-explore-router-heuristics`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Task 6 (Strengthen Explore Router Heuristics). explore 도구의 내부 V1/V2 라우팅을 prompt 길이·scope 폭·확장 키워드 기반으로 강화. 외부 도구 surface는 변경 없음. 원본 plan: docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md Task 6. 카테고리: P1."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 긴 프롬프트가 자동으로 V2 런타임으로 라우팅된다 (Priority: P1)

`explore` 도구를 호출하는 호스트(예: Claude Code, Codex CLI)는 별도의 옵션을 지정하지 않아도 프롬프트가 길고 보고서 분량이 큰 요청이면 내부 라우터가 V2 런타임을 사용해야 한다. 외부 도구 목록은 그대로 `explore`이며, V2 런타임 사용 여부는 사용자가 알 필요가 없다.

**Why this priority**: README L319-321이 약속한 "deep/large report로 보이면 내부적으로 V2 런타임 사용 가능" 동작을 실제로 이행한다. 현재 라우터는 `thoroughness === 'deep'` 또는 좁은 키워드 정규식만 본다. 긴 프롬프트는 V1 런타임이 응답 품질이 낮거나 잘림이 발생할 가능성이 높아 사용자가 가장 먼저 체감하는 회귀 지점이다.

**Independent Test**: 600자 이상의 프롬프트로 `tools/call name=explore`를 호출하고, 응답 보고서 본문이 V2 런타임 시스템 프롬프트(`Cerebras Explorer V2`)에서 생성된 결과인지 확인하면 단독 검증 가능하다.

**Acceptance Scenarios**:

1. **Given** `thoroughness`가 명시되지 않았고 `prompt + context` 길이 합이 1200자 이상인 호출이 들어왔을 때, **When** 라우터가 V1/V2 분기를 결정하면, **Then** V2 런타임 시스템 프롬프트로 채팅 클라이언트가 호출된다.
2. **Given** 짧은 프롬프트(`explain auth briefly`)와 `thoroughness: 'quick'` 호출이 들어왔을 때, **When** 라우터가 분기하면, **Then** V1 런타임이 그대로 사용된다.

---

### User Story 2 - 넓은 scope 또는 보고서 의도 키워드가 V2로 라우팅된다 (Priority: P1)

`scope` 배열이 6개 이상이거나 `.`, `**`, `**/*`, `*/**` 등 사실상 저장소 전체를 가리키는 패턴을 포함하는 경우, 그리고 프롬프트에 `architecture review`, `subsystem review`, `종합`, `아키텍처`, `흐름` 같은 보고서 의도 키워드가 포함된 경우 라우터는 V2를 선택해야 한다.

**Why this priority**: scope 폭과 보고서 의도 키워드는 출력 분량과 도구 호출 깊이를 가장 직접적으로 예측하는 신호이다. V1 런타임으로 처리하면 컨텍스트 절약을 위한 truncation이나 부분 응답이 발생해 호출자가 다시 `explore_v2`로 opt-in해야 하는 비효율이 생긴다.

**Independent Test**: scope를 `['src/**', 'tests/**', 'docs/**', 'integrations/**', 'benchmarks/**', 'scripts/**']`로 설정하거나 프롬프트에 `subsystem review across this repo`를 포함시켜 호출한 뒤, 라우터가 V2 시스템 프롬프트를 선택했는지 확인한다.

**Acceptance Scenarios**:

1. **Given** scope 배열 길이가 6 이상인 호출, **When** 라우터가 분기하면, **Then** V2 런타임이 선택된다.
2. **Given** scope 배열에 `.` 또는 `**` 또는 `**/*` 또는 `*/**` 형식 패턴이 하나라도 포함된 호출, **When** 라우터가 분기하면, **Then** V2 런타임이 선택된다.
3. **Given** 프롬프트에 확장 키워드(`architecture review`, `subsystem review`, `종합`, `아키텍처`, `흐름`) 중 하나가 포함된 호출, **When** 라우터가 분기하면, **Then** V2 런타임이 선택된다.

---

### User Story 3 - 외부 도구 표면은 변경되지 않는다 (Priority: P2)

`tools/list`가 반환하는 도구 목록과 각 도구의 입력 스키마는 본 변경 이전과 동일해야 한다. `explore_v2`는 여전히 환경 변수 기반 opt-in이며, 라우터 강화는 `explore` 도구 내부에서만 일어난다.

**Why this priority**: 외부 surface가 바뀌면 다운스트림 통합(README, DESIGN, integrations 문서, 벤치마크 스크립트)이 동시에 깨진다. 라우터 강화는 호환성을 유지하면서도 품질을 끌어올리는 변경이어야 한다.

**Independent Test**: 기본 환경에서 `tools/list`를 호출해 도구 이름·스키마가 기존 스냅샷과 동일한지, 그리고 `explore_v2`가 opt-in 플래그 없이는 노출되지 않는지 확인한다.

**Acceptance Scenarios**:

1. **Given** `CEREBRAS_EXPLORER_EXPLORE_V2`가 활성화되지 않은 기본 환경, **When** `tools/list`를 호출하면, **Then** 응답 도구 목록에 `explore_v2`가 포함되지 않는다.
2. **Given** 라우터 강화 전후의 `explore` 입력 스키마, **When** 두 스키마를 비교하면, **Then** 필드 이름·타입·필수 여부가 동일하다.

---

### Edge Cases

- `prompt` 또는 `context`가 `undefined`/비문자열로 들어오는 경우 라우터는 길이 합계 계산에서 안전하게 0으로 처리해야 하며 예외를 던지지 않아야 한다.
- `scope`가 배열이 아닐 때(예: 문자열 단일 값, `null`, `undefined`) 라우터는 broad scope 신호를 켜지 않고 V1을 기본으로 사용해야 한다.
- 프롬프트 길이가 정확히 1200자 경계선상일 때 동작은 `>= 1200` 기준으로 명확히 V2를 선택해야 한다.
- 키워드 매칭은 대소문자 무관(소문자 변환 후 매칭)이어야 하고, 한국어 키워드는 입력 그대로 매칭되어야 한다.
- `thoroughness: 'deep'`이 명시되면 다른 신호와 무관하게 V2가 선택되어야 한다(기존 동작 유지).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `explore` 도구의 내부 라우터(`shouldUseV2ForExplore`)는 `thoroughness === 'deep'`인 경우 V2를 선택해야 한다(기존 동작 유지).
- **FR-002**: 라우터는 `prompt` 길이와 `context` 길이의 합이 1200자 이상인 경우 V2를 선택해야 한다.
- **FR-003**: 라우터는 `scope` 배열 길이가 6 이상인 경우 V2를 선택해야 한다.
- **FR-004**: 라우터는 `scope` 배열 원소 중 하나라도 `.`, `./`, `**`, `**/*`, 또는 `/**`로 끝나는 패턴인 경우 V2를 선택해야 한다.
- **FR-005**: 라우터의 키워드 정규식은 다음 토큰을 모두 포함해야 한다 — `deep dive`, `comprehensive`, `entire codebase`, `large architecture`, `end-to-end`, `architecture review`, `subsystem review`, `전체`, `대규모`, `심층`, `종합`, `아키텍처`, `흐름`. 영어 토큰은 소문자 변환 후 매칭한다.
- **FR-006**: 위 어떤 신호도 일치하지 않으면 라우터는 V1 런타임을 선택해야 한다.
- **FR-007**: `tools/list`가 반환하는 도구 surface(도구 이름·설명·입력 스키마)는 본 변경으로 인해 바뀌지 않아야 한다.
- **FR-008**: `explore_v2` 도구의 opt-in 정책(환경 변수 기반 노출, README L319-321 및 DESIGN L206에 명시된 설명)은 그대로 유지되어야 한다.
- **FR-009**: 라우터는 `prompt`, `context`, `scope`가 `undefined`·`null`·비기대 타입일 때 예외 없이 안전한 기본값(빈 문자열·빈 배열)으로 동작해야 한다.

### Key Entities

- **Explore Router Decision**: 단일 분기 함수가 반환하는 boolean. 입력은 `{ thoroughness, prompt, context, scope }`이며 출력은 V2 사용 여부.
- **Broad Scope Pattern Set**: V2 사용을 트리거하는 정적 패턴 집합 — `.`, `./`, `**`, `**/*`, `*/**` 접미사.
- **Report Intent Keyword Set**: V2 사용을 트리거하는 키워드 정적 집합(영문 소문자 7종 + 한글 6종).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `tests/mcp-server.test.mjs`의 신규 라우터 테스트(`explore router uses V2 for long or broad report prompts`)가 PASS한다.
- **SC-002**: 동일 테스트 파일에 포함된 기존 라우터 테스트(짧은 프롬프트 + `thoroughness: 'quick'` → V1) 회귀가 발생하지 않는다.
- **SC-003**: `npm test` 전체가 PASS하며, `tools/list` 스냅샷 또는 contract 테스트(있다면)가 변경 없이 통과한다.
- **SC-004**: `CEREBRAS_EXPLORER_EXPLORE_V2`를 활성화하지 않은 상태에서 `tools/list` 응답에 `explore_v2`가 포함되지 않는다.
- **SC-005**: `prompt + context >= 1200`, `scope.length >= 6`, broad scope 패턴, 확장 키워드 각 신호별로 독립 테스트 케이스가 존재하며 모두 V2 라우팅을 확인한다.

## Assumptions

- 라우터 입력은 MCP `tools/call` 요청의 `params.arguments`에서 그대로 전달되며, 호출자(예: Claude Code, Codex)는 `prompt`를 사람이 작성한 자연어 문자열로 보낸다.
- `prompt + context` 길이 1200자 임계값은 V1 런타임이 안정적으로 처리 가능한 분량의 보수적 상한으로 가정한다(추후 벤치마크로 재조정 가능).
- scope 배열 길이 6 이상을 "broad"로 보는 기준은 README의 통합 가이드가 권장하는 좁은 scope(보통 1-3개 글롭) 패턴을 기준으로 한 휴리스틱이다.
- `explore_v2`의 opt-in 환경 변수와 README/DESIGN 약속은 본 작업과 무관하게 그대로 유지된다.
- 외부 도구 표면 회귀를 막는 기존 contract/snapshot 테스트가 이미 존재하거나, 없다면 본 변경에서 추가하지 않고 별도 작업으로 다룬다.
