# Feature Specification: Wrapper Unknown-Key 회귀 매트릭스 확장

**Feature Branch**: `005-wrapper-unknown-key-matrix`

**Created**: 2026-05-21

**Status**: Implemented

**Input**: User description: "Task 5 (Expand Wrapper Unknown-Key Regression Coverage). 검증 로직(validatePublicToolArgs)은 이미 6개 wrapper 모두에 중앙 적용. 회귀 테스트만 trace_symbol에서 6개 wrapper 매트릭스로 확장. 원본 plan: docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md Task 5. 카테고리: P1, 저위험·고가치."

## Background *(context only)*

`src/mcp/server.mjs`의 `validatePublicToolArgs()`는 이미 6개 public wrapper(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`)와 `explore`/`explore_v2`/`explore_repo`까지 모든 dispatch 경로에서 알 수 없는 인자를 거부한다. 그러나 회귀 테스트(`tests/mcp-server.test.mjs`의 *MCP request handler rejects unknown wrapper arguments before runtime execution*)는 `trace_symbol` 한 케이스만 검증한다. 나머지 5개 wrapper가 미래 리팩터링 과정에서 우회 경로를 얻더라도 현재 테스트로는 잡아낼 수 없다. 본 작업의 본질은 **코드 변경 없이 테스트 매트릭스를 6개 wrapper 전부로 확장**해 회귀 안전망을 균일하게 까는 것이다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 6개 wrapper 전부에 unknown-key 회귀 안전망 보장 (Priority: P1)

MCP 서버 유지보수자가 wrapper dispatch나 schema를 수정할 때, 어떤 wrapper에서든 알 수 없는 인자가 런타임까지 흘러가는 회귀가 발생하면 즉시 테스트가 실패해야 한다. 현재는 `trace_symbol`을 건드릴 때만 안전망이 작동하고 나머지 5개 wrapper는 사각지대다. 매트릭스 테스트가 들어오면 단일 테스트 케이스가 6개 wrapper 모두를 동시에 보호한다.

**Why this priority**: P1. 검증 로직 자체는 이미 옳고 모든 wrapper에 적용되어 있어 코드 변경 위험은 0이다. 반면 회귀 사각지대 5개를 한 번에 닫는 가치는 크다. 저위험·고가치 작업이라 가장 먼저 처리해야 한다.

**Independent Test**: `tests/mcp-server.test.mjs`의 해당 매트릭스 테스트만 단독 실행(`node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"`)해도 6개 wrapper가 모두 unknown-key를 거부함을 확인할 수 있다. 다른 테스트나 라이브 Cerebras 호출에 의존하지 않는다.

**Acceptance Scenarios**:

1. **Given** 현재 main 체크아웃에서 `validatePublicToolArgs()`가 6개 wrapper 모두에 라우팅되어 있을 때, **When** 확장된 매트릭스 테스트를 실행하면, **Then** 6개 wrapper 케이스가 전부 PASS하며 ChatClient의 `createChatCompletion`은 단 한 번도 호출되지 않는다.
2. **Given** 어떤 wrapper(예: `collect_evidence`) dispatch 분기에서 `validatePublicToolArgs()` 호출이 누락되어 unknown 인자가 런타임으로 흘러가는 회귀가 발생했을 때, **When** 매트릭스 테스트를 실행하면, **Then** 해당 wrapper 케이스가 명확한 메시지(`Invalid arguments for <tool>` 및 `Unknown <tool> argument: <key>`)로 FAIL해 어떤 wrapper가 깨졌는지 즉시 식별된다.

### Edge Cases

- 어떤 wrapper에서 unknown 인자 자체는 거부되지만 에러 메시지가 일반화되어 어느 tool인지 식별 불가한 경우 → 메시지에 tool 이름과 키 이름이 모두 포함되어야 한다.
- wrapper dispatch가 unknown 인자를 거부는 하되 `structuredContent.failure`를 채우지 않는 경우 → `category: 'input'`, `reason: 'invalid_arguments'`가 반드시 채워져야 한다.
- ChatClient의 `createChatCompletion`이 실수로 호출되어 에러 메시지로 "runtime should not be invoked"가 새어 들어가는 경우 → 응답 본문은 이 문구를 절대 포함해서는 안 된다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `tests/mcp-server.test.mjs`는 기존 단일 wrapper 테스트(`MCP request handler rejects unknown wrapper arguments before runtime execution`)를 6개 wrapper(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`) 매트릭스로 교체해야 한다.
- **FR-002**: 매트릭스 테스트는 wrapper별 합법 필수 인자에 더해 정확히 하나의 unknown 키를 주입해야 하며, 모든 케이스에서 응답은 `isError: true`이고 본문 텍스트는 `Invalid arguments for <tool>` 및 `Unknown <tool> argument: <key>` 패턴을 모두 만족해야 한다.
- **FR-003**: 매트릭스 테스트는 ChatClient 더블이 `createChatCompletion` 호출 시 던지는 "runtime should not be invoked for invalid wrapper arguments" 문구가 응답 본문에 절대 노출되지 않음을 모든 wrapper 케이스에서 검증해야 한다.
- **FR-004**: 모든 wrapper 케이스의 응답 `structuredContent.failure`는 `category: 'input'` 및 `reason: 'invalid_arguments'`를 가져야 한다.
- **FR-005**: 매트릭스가 PASS하는 한 `src/mcp/server.mjs`는 변경하지 않는다. 매트릭스가 특정 wrapper에서 FAIL하면 해당 wrapper의 dispatch 분기에서 `validatePublicToolArgs()`를 호출하는 중앙 집중식 패턴만 사용해야 하며, 각 builder 내부에 일회성 destructuring 가드를 추가해서는 안 된다.
- **FR-006**: 매트릭스 테스트는 단일 `node --test` 호출 안에서 6개 wrapper를 모두 검증해야 하며, 외부 Cerebras API 호출이나 실제 저장소 fixture 없이 단독으로 실행 가능해야 한다.

### Key Entities

- **Wrapper 매트릭스 케이스**: `{ name, args, unknown }` 형태로 6개 wrapper 각각의 합법 필수 인자와 주입할 unknown 키를 표현한다.
- **ShouldNotRunChatClient 더블**: `createChatCompletion`이 호출되면 즉시 던지는 테스트 더블. 런타임이 unknown 인자에 도달했는지 검출하는 카나리아 역할을 한다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"` 명령은 현재 체크아웃에서 코드 변경 없이 PASS하며, 매트릭스 안에서 6개 wrapper 케이스가 모두 통과한다.
- **SC-002**: wrapper dispatch 6개 분기 중 임의의 한 곳에서 `validatePublicToolArgs()` 호출을 제거하는 일시적 회귀 실험을 하면, 해당 wrapper 케이스에서 정확히 FAIL이 발생해 어느 wrapper가 깨졌는지 테스트 출력만으로 즉시 식별 가능하다.
- **SC-003**: 전체 `npm test`는 본 작업 전후로 동일하게 PASS하며, 본 작업으로 인해 추가되는 런타임 의존성은 0이다.

## Assumptions

- `validatePublicToolArgs()`는 이미 6개 wrapper + `explore`/`explore_v2`/`explore_repo` 모든 dispatch 경로에 중앙 적용되어 있다(`src/mcp/server.mjs` 라인 305-331 인근). 따라서 본 작업은 회귀 안전망 확장이며 새 검증 로직을 추가하지 않는다.
- 6개 wrapper의 public schema는 각 wrapper의 합법 필수 인자(예: `find_relevant_code.query`, `trace_symbol.symbol`, `map_change_impact.change`, `explain_code_path.pathQuery`, `collect_evidence.claim`, `review_change_context.reviewGoal`)를 안정적으로 가지고 있어 매트릭스 케이스의 합법 인자는 schema 변경 없이 유효하다.
- 본 spec의 범위는 unknown-key 거부 회귀 매트릭스로 한정한다. 다른 종류의 인자 검증(타입 오류, 누락된 필수 인자 등) 회귀 확장은 본 작업 범위 밖이다.
- 테스트 매트릭스는 `createMcpRequestHandler`의 기존 주입 가능한 `runtimeOptions.chatClient` 훅을 그대로 사용하며, 새로운 테스트 헬퍼나 fixture를 도입하지 않는다.
