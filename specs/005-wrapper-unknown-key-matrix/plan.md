# Implementation Plan: Wrapper Unknown-Key 회귀 매트릭스 확장

**Branch**: `005-wrapper-unknown-key-matrix` | **Date**: 2026-05-21 | **Spec**: `specs/005-wrapper-unknown-key-matrix/spec.md`

**Input**: Feature specification from `specs/005-wrapper-unknown-key-matrix/spec.md`

**원본 plan(참고)**: `docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md` Task 5 (Expand Wrapper Unknown-Key Regression Coverage)

## Summary

`src/mcp/server.mjs`의 `validatePublicToolArgs()`는 이미 6개 public wrapper(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`) dispatch 분기에 중앙 집중식으로 적용되어 있다(라인 762~785). 그러나 `tests/mcp-server.test.mjs`의 unknown-key 회귀 테스트는 `trace_symbol` 한 케이스만 검증한다. 본 작업은 **`src/` 코드를 한 줄도 건드리지 않고** `tests/mcp-server.test.mjs`의 단일 테스트를 6개 wrapper 매트릭스로 확장해, 어느 wrapper에서든 dispatch 회귀가 발생하면 정확히 어느 케이스가 깨졌는지 즉시 식별되게 만든다. 기존 `ShouldNotRunChatClient` 더블 패턴을 재사용하고, 외부 의존성 추가는 0이다.

## Technical Context

**Language/Version**: Node.js (ES Modules, `.mjs`). 기존 테스트 파일이 사용 중인 런타임 그대로.

**Primary Dependencies**: 표준 `node:test`와 `node:assert/strict`. 별도 testing 라이브러리 도입 없음.

**Storage**: N/A (메모리 내 fake chat client + 합법 인자 매트릭스).

**Testing**: `node --test tests/mcp-server.test.mjs`. 단독 실행 패턴은 `--test-name-pattern "unknown wrapper arguments"`.

**Target Platform**: 로컬 개발 환경 및 CI(Windows/macOS/Linux). 네트워크/실파일시스템 의존성 없음.

**Project Type**: 단일 패키지(Node.js MCP 서버). `src/mcp/server.mjs` + `tests/mcp-server.test.mjs` 구조 유지.

**Performance Goals**: 매트릭스 6개 케이스 합계 추가 실행 시간 100ms 미만(현재 단일 케이스 < 20ms 기준).

**Constraints**:
- `src/mcp/server.mjs` 변경 금지. 본 작업이 PASS하는 동안 production code는 not modified여야 한다(FR-005).
- 새 테스트 헬퍼/fixture/모듈 추가 금지. 기존 `createMcpRequestHandler` + `runtimeOptions.chatClient` 훅만 사용.
- 매트릭스 케이스는 합법 필수 인자만 사용(미래 schema 추가 인자에 stale되지 않도록).
- ChatClient는 절대 호출되어선 안 된다(카나리아).

**Scale/Scope**: 단일 테스트 함수 1개를 6개 케이스 매트릭스로 확장. 추가/변경 LOC ≈ 60~80줄, 삭제 LOC ≈ 40줄(기존 단일 테스트 본문).

## Constitution Check

*GATE: 본 저장소에 별도 헌법 파일이 없으므로 통상의 spec-kit 가드만 점검.*

- **테스트 우선/회귀 안전망**: 본 작업의 본질이 회귀 안전망 확장이며, 코드는 그대로 둔 채 테스트만 강화한다. 정합.
- **단일 책임/변경 범위 최소화**: 변경 파일은 `tests/mcp-server.test.mjs` 단 1개. 정합.
- **외부 의존성/네트워크 호출 도입 없음**: 더블만 사용. 정합.
- **결정성**: 매트릭스 실행 순서는 정의된 배열 순서로 고정. flakiness 없음. 정합.

위반 사항 없음 → Complexity Tracking 표는 채우지 않는다.

## Project Structure

### Documentation (this feature)

```text
specs/005-wrapper-unknown-key-matrix/
├── spec.md              # 기존
├── plan.md              # 본 문서 (초안 위치: .specify/.spec-drafts/task-5-plan-draft.md)
└── tasks.md             # /speckit-tasks가 생성 (본 작업 범위 밖)
```

### Source Code (repository root)

```text
src/
└── mcp/
    └── server.mjs       # 변경 금지. validatePublicToolArgs는 이미 6개 wrapper에 라우팅됨(라인 762~785).

tests/
└── mcp-server.test.mjs  # 본 작업의 유일한 변경 대상.
                         # 기존 "MCP request handler rejects unknown wrapper arguments
                         # before runtime execution" 테스트를 6개 wrapper 매트릭스로 교체.
```

**Structure Decision**: 단일 패키지 Node.js 프로젝트. 본 작업은 `tests/mcp-server.test.mjs` 한 파일만 수정한다. `src/` 트리는 의도적으로 동결한다(FR-005, SC-002의 회귀 실험 신뢰성 확보를 위해).

## Implementation Outline

### (a) 6개 wrapper의 합법 인자 매트릭스 정의

테스트 파일 내부에 단일 배열 상수를 두고, 각 항목은 `{ tool, args, unknownKey }` 모양으로 한다. 합법 필수 인자만 채워 schema가 미래에 선택 인자를 추가/제거해도 stale되지 않도록 최소 인자만 유지한다. (필수 인자는 각 builder가 비어 있을 때 throw하는 인자 — `src/mcp/server.mjs` 라인 349~445에서 확인.)

| `tool`                  | 합법 필수 인자                            | 주입할 `unknownKey` 예시 |
|-------------------------|------------------------------------------|--------------------------|
| `find_relevant_code`    | `{ query: 'where is auth applied' }`     | `extraneousField`        |
| `trace_symbol`          | `{ symbol: 'requireAuth' }`              | `context`                |
| `map_change_impact`     | `{ change: 'rename requireAuth' }`       | `unexpected`             |
| `explain_code_path`     | `{ pathQuery: 'login request flow' }`    | `flowType`               |
| `collect_evidence`      | `{ claim: 'tokens are revoked on logout' }` | `priority`            |
| `review_change_context` | `{ reviewGoal: 'audit auth refactor' }`  | `severity`               |

unknown 키 이름은 wrapper마다 다르게 잡아 “모든 wrapper가 같은 키 하나에만 반응” 같은 우연한 통과를 막는다. 각 케이스의 unknown 값은 단순 문자열로 충분하다(validator는 키 존재만 본다).

### (b) `ShouldNotRunChatClient` 더블 재사용

현재 라인 469~477에 존재하는 클래스 정의를 그대로 유지하되 위치를 매트릭스 테스트 본문 최상단에 두어 6개 케이스가 동일 인스턴스 클래스를 공유하도록 한다. 인스턴스는 각 케이스마다 새로 만들어 상호 오염을 차단한다. 이 더블이 다른 테스트(`MockChatClient`, `ThrowingChatClient`)와 이름 충돌하지 않도록 기존 이름을 유지한다(파일 스코프 내 클래스가 아니라 테스트 함수 스코프 내 클래스이므로 충돌 위험 자체가 없다).

`model` 필드는 `'zai-glm-4.7'`로 유지한다(현재 spec과 동일). `createChatCompletion`은 호출되면 "runtime should not be invoked for invalid wrapper arguments"를 던진다 — 이 문구가 응답에 새어 나오면 (e)의 카나리아 단계가 실패한다.

### (c) `for...of` 매트릭스 실행

`node --test`의 서브테스트 `t.test(name, fn)`를 사용한다. 단일 `test('MCP request handler rejects unknown wrapper arguments before runtime execution', async (t) => { ... })` 안에서 매트릭스 배열을 순회하며 각 케이스를 `await t.test(\`rejects unknown ${tool} argument\`, async () => { ... })`로 실행한다. 이렇게 하면:

- 단일 `--test-name-pattern "unknown wrapper arguments"`로 전체 매트릭스를 단독 실행할 수 있다(SC-001).
- 한 wrapper가 깨졌을 때 서브테스트 이름이 출력에 그대로 찍혀 어느 wrapper인지 즉시 식별된다(SC-002).
- 케이스 간 독립성을 위해 매 케이스마다 `createMcpRequestHandler({ runtimeOptions: { chatClient: new ShouldNotRunChatClient() } })`를 새로 만든다.

요청 id는 케이스마다 다르게 부여(예: `100 + index`)해 progress/logging 추적을 단순화한다.

### (d) 각 응답에서 검증할 어서션

각 케이스마다 다음 5개 어서션을 적용한다(현재 라인 498~503의 검증 집합을 매트릭스화):

1. `assert.equal(response.isError, true);`
2. `assert.match(response.content[0].text, new RegExp(\`Invalid arguments for ${tool}\`));`
3. `assert.match(response.content[0].text, new RegExp(\`Unknown ${tool} argument: ${unknownKey}\`));`
4. `assert.equal(response.structuredContent.failure.category, 'input');`
5. `assert.equal(response.structuredContent.failure.reason, 'invalid_arguments');`

정규식 작성 시 unknown 키와 tool 이름은 모두 `[A-Za-z_]+` 문자만 사용하도록 매트릭스를 잡았으므로 별도 escape는 불필요하다. 만약 향후 키에 특수문자가 들어가면 `escapeRegexLiteral` 패턴(server.mjs 라인 333)을 테스트 파일 안에 미러링하거나 더 안전하게 `assert.ok(text.includes(...))`로 전환하는 옵션이 있으나, 본 작업 범위에서는 정규식이 더 시그널이 분명하다.

### (e) ChatClient 미호출 카나리아 검증

매트릭스 안 모든 케이스에서:

```text
assert.doesNotMatch(response.content[0].text, /runtime should not be invoked/);
```

`ShouldNotRunChatClient.createChatCompletion`이 만약 호출되면 그 에러 메시지가 dispatch catch 분기를 통해 응답 본문에 노출된다. 이 어서션이 6개 케이스에서 모두 통과해야 “unknown 인자가 런타임에 도달하지 않음”이라는 본질이 보장된다. 추가로 호출 카운터를 더블에 두는 옵션도 검토했으나, 던지기만 해도 결과적으로 같은 신호를 주므로 더블의 단순함을 유지한다.

## Risks & Mitigations

| 위험 | 가능성 | 영향 | 완화 |
|------|--------|------|------|
| **합법 인자 매트릭스 stale** — 미래에 `find_relevant_code` 등의 schema에 새 필수 인자가 추가되면 매트릭스의 합법 인자만으로는 builder가 throw해 unknown-key 메시지가 아니라 다른 에러가 나올 수 있다. | 중 | 중 | 매트릭스 케이스의 합법 인자는 **현재 builder가 명시적으로 throw하는 단일 필수 인자만** 채운다(예: `find_relevant_code.query`). 미래에 새 필수 인자가 생기면 builder throw 메시지가 어서션 (2)와 다르게 떨어지면서 곧바로 FAIL → 의도된 시그널. 매트릭스 케이스마다 unknown 키 이름을 wrapper별로 다르게 잡아 “모든 케이스가 동일 키를 거부” 같은 우연 통과를 차단. |
| **더블이 너무 generic이면 다른 테스트와 충돌** | 낮음 | 낮음 | `ShouldNotRunChatClient`는 매트릭스 테스트 함수 **스코프 내부**에 정의해 모듈 전역으로 노출하지 않는다. 기존 `MockChatClient`, `ThrowingChatClient`와 이름·범위가 모두 분리. |
| **서브테스트 패턴이 단독 실행 패턴(SC-001)을 깨뜨림** | 낮음 | 중 | 부모 테스트 이름 `MCP request handler rejects unknown wrapper arguments before runtime execution`을 그대로 유지. `--test-name-pattern "unknown wrapper arguments"`는 부모만 매치해도 자식 서브테스트가 함께 실행됨. 작성 후 실제 명령으로 검증. |
| **회귀 실험 시 다른 wrapper도 같이 깨져 식별 어려움** | 낮음 | 중 | 케이스마다 독립 handler 인스턴스를 만들고, 서브테스트 이름에 wrapper 이름을 박는다. SC-002의 “정확한 케이스만 FAIL” 기준 만족. |
| **정규식 escape 누락으로 인한 거짓 매치** | 낮음 | 낮음 | 매트릭스의 tool/unknown 이름을 `[A-Za-z_]+`로 한정. 향후 다른 문자가 필요해지면 `String.prototype.includes`로 전환하거나 escape 헬퍼를 테스트 로컬에 미러링. |

## Test Strategy

### 정상 시그널 (FR-001 ~ FR-004, SC-001)

1. 현재 main(코드 무변경)에서 다음 명령을 실행:
   - `node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"`
2. 기대: 부모 테스트 + 6개 서브테스트 PASS, `createChatCompletion` 0회 호출.
3. 동시에 `npm test` 전체도 본 작업 전후로 동일하게 PASS(SC-003).

### 회귀 시그널 (SC-002)

다음 회귀 실험을 **로컬에서만 일시적으로** 수행해 시그널 품질을 확인한다(커밋 금지):

- `src/mcp/server.mjs`의 특정 한 분기(예: 라인 779 `collect_evidence` 케이스)에서 `validatePublicToolArgs(COLLECT_EVIDENCE_TOOL, args);` 한 줄만 삭제 → 매트릭스 재실행 → **정확히 `collect_evidence` 서브테스트 1개만** FAIL, 다른 5개는 PASS, ChatClient는 한 번도 호출되지 않아야 한다(그 케이스의 응답에 "runtime should not be invoked" 문구가 나타나야 어서션 (e)가 깨짐).
- 위 회복 실험은 6개 wrapper 중 무작위로 1~2개에 대해 spot check만 수행. 6개를 전수 회귀 실험할 필요는 없다(검증 로직이 중앙 집중이라 한 분기가 통하면 동일 패턴의 다른 분기도 통한다는 신뢰가 충분하다).
- 실험 후 즉시 `git restore src/mcp/server.mjs`로 복구.

### Negative test for the negative test (선택)

향후 schema가 변해 매트릭스의 합법 필수 인자가 부족해지는 회귀를 빠르게 잡으려면, 매트릭스 케이스의 “합법 인자 only” 분기(unknown 키 제거 버전)를 한 케이스만 sanity check로 두는 옵션이 있다. 그러나 본 spec(FR-006: 단독 실행 + 외부 의존성 0)과 범위(Assumptions: 다른 종류 검증 회귀는 범위 밖)를 따라 **본 작업에서는 포함하지 않는다**. 매트릭스가 어서션 (2)에서 깨지면 자연스럽게 schema drift 신호가 잡힌다.

### 단독성 검증

- `node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"` 가 외부 fixture(`makeRepoFixture` 등) 없이 PASS함을 확인 → FR-006 만족.
- 네트워크/파일시스템 mock 누락으로 인한 우연한 통과가 아닌지, 더블의 `createChatCompletion`이 던질 때 응답이 카나리아 어서션 (e)로 명확히 깨지는지를 회귀 실험 단계에서 동시에 검증.
