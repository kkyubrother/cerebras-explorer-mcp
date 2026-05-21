# Tasks: Wrapper Unknown-Key 회귀 매트릭스 확장

**Input**: Design documents from `specs/005-wrapper-unknown-key-matrix/`

**Prerequisites**: `specs/005-wrapper-unknown-key-matrix/spec.md`, `specs/005-wrapper-unknown-key-matrix/plan.md`

**Tests**: REQUIRED — 본 feature 자체가 회귀 테스트 매트릭스 확장이다. 작업 산출물의 본체가 테스트 코드이며, 별도 production 코드 변경은 금지된다(FR-005, plan Implementation Outline).

**Organization**: 단일 user story(US1)로 구성. P1 한 건으로 모든 acceptance 기준이 닫힌다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일·서로 의존성 없는 작업에만 부여. 본 feature는 단일 파일(`tests/mcp-server.test.mjs`) 안에서 작업이 직렬화되므로 [P] 표시가 거의 등장하지 않는다.
- **[Story]**: `US1`만 사용한다.
- 모든 경로는 저장소 루트 기준 상대 경로다.

## Path Conventions

- 단일 패키지(Node.js MCP 서버) 구조.
- 변경 허용 파일: `tests/mcp-server.test.mjs` 단 하나.
- 변경 금지 파일: `src/mcp/server.mjs` 전체(FR-005, plan Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 매트릭스 작성을 시작하기 전 사전 정합성 확인. 코드 변경 없음.

- [x] T001 현재 체크아웃이 `005-wrapper-unknown-key-matrix` 브랜치이며 `src/mcp/server.mjs`, `tests/mcp-server.test.mjs`가 둘 다 워킹 트리에서 깨끗한 상태(`git status` clean)임을 확인한다.
- [x] T002 `node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"`를 한 번 실행해 **기존 단일 wrapper 테스트가 PASS**하는 베이스라인을 기록한다(이후 매트릭스 교체 후의 비교 기준).
- [x] T003 `npm test`를 한 번 실행해 전체 베이스라인이 PASS임을 확인한다(SC-003 비교 기준).

**Checkpoint**: 베이스라인 PASS 확보. 매트릭스 교체 작업을 시작할 수 있다.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 매트릭스를 작성하기 전에 한 번만 결정해 두면 되는 사실 확인. 코드 작성은 아직 없다.

- [x] T004 [US1] `tests/mcp-server.test.mjs` 라인 468~504의 기존 `MCP request handler rejects unknown wrapper arguments before runtime execution` 테스트를 정독하고, `ShouldNotRunChatClient` 더블의 시그니처(`model = 'zai-glm-4.7'`, `createChatCompletion()`이 `'runtime should not be invoked for invalid wrapper arguments'`를 던짐)를 그대로 재사용할 수 있음을 확인한다. 새 더블/모듈/헬퍼는 도입하지 않는다(plan Implementation Outline (b)).
- [x] T005 [US1] `src/mcp/server.mjs`의 wrapper builder 6개에서 각 builder가 합법으로 받는 **최소 필수 인자**가 다음과 일치함을 확인한다(builder 본문이 비어 있을 때 throw하는 인자만 채운다, plan Implementation Outline (a)):
  - `find_relevant_code` → `query`
  - `trace_symbol` → `symbol`
  - `map_change_impact` → `change`
  - `explain_code_path` → `pathQuery`
  - `collect_evidence` → `claim`
  - `review_change_context` → `reviewGoal`
- [x] T006 [US1] 매트릭스에서 사용할 unknown 키 이름을 wrapper마다 서로 다르게 확정한다(우연 통과 방지, plan 위험 표 “더블이 너무 generic이면” 항목 및 위험 표 마지막 행). 초안:
  - `find_relevant_code` → `extraneousField`
  - `trace_symbol` → `context`
  - `map_change_impact` → `unexpected`
  - `explain_code_path` → `flowType`
  - `collect_evidence` → `priority`
  - `review_change_context` → `severity`
- [x] T007 [US1] 매트릭스 데이터 구조를 `{ tool, args, unknownKey }` 단일 형태로 고정한다(spec Key Entities). 각 케이스의 `args`는 T005 결과의 최소 필수 인자 + T006의 unknown 키 단 하나만 포함한다.

**Checkpoint**: 매트릭스 6개 케이스의 입력 정의가 완성됨. 이제 실제 테스트 코드를 작성할 수 있다.

---

## Phase 3: User Story 1 — 6개 wrapper 전부에 unknown-key 회귀 안전망 보장 (Priority: P1) 🎯 MVP

**Goal**: 단일 부모 테스트 + 6개 서브테스트 매트릭스로 6개 wrapper 모두의 unknown-key 거부 동작을 한 번에 검증하고, 어느 한 분기가 깨졌을 때 정확히 어느 wrapper인지 출력만 보고 식별 가능하게 만든다.

**Independent Test**: `node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"` 단독 실행으로 부모 테스트와 6개 서브테스트가 모두 PASS함을 확인한다(SC-001, FR-006).

### Tests for User Story 1 (이 feature의 본체)

> 본 feature는 테스트 자체가 산출물이므로 “테스트를 먼저 작성하고 FAIL 확인 후 구현” 패턴은 적용되지 않는다. 대신 “매트릭스 작성 → 베이스라인에서 PASS 확인 → SC-002 회귀 실험으로 시그널 품질 확인”의 순서를 따른다.

- [x] T008 [US1] `tests/mcp-server.test.mjs` 라인 468~504의 기존 단일 wrapper 테스트를 **부모 테스트 + 매트릭스 골격**으로 교체한다. 부모 테스트 이름은 기존과 동일하게 `MCP request handler rejects unknown wrapper arguments before runtime execution`을 유지한다(SC-001의 `--test-name-pattern "unknown wrapper arguments"`가 그대로 부모를 매치해 자식 서브테스트를 모두 끌어오도록, plan 위험 표 “서브테스트 패턴이 단독 실행 패턴을 깨뜨림” 항목).
- [x] T009 [US1] 부모 테스트 함수 시그니처를 `async (t) => { ... }` 형태로 바꿔 `t.test(...)` 서브테스트 API를 쓸 수 있게 한다(plan Implementation Outline (c)).
- [x] T010 [US1] 부모 테스트 본문 최상단에 기존 `ShouldNotRunChatClient` 클래스 정의를 그대로 두되, 인스턴스는 **각 서브테스트마다 새로 생성**해 케이스 간 상호 오염을 차단한다(plan Implementation Outline (b)). 부모 테스트 외부로는 노출하지 않는다.
- [x] T011 [US1] 부모 테스트 본문에 Phase 2 T007에서 정의한 매트릭스 배열을 `const WRAPPER_MATRIX = [{ tool, args, unknownKey }, ...]` 형태로 6개 케이스 인라인 선언한다. 합법 인자는 T005 결과를 그대로 사용한다.
- [x] T012 [US1] `for (const [index, { tool, args, unknownKey }] of WRAPPER_MATRIX.entries()) { await t.test(...) }` 루프를 작성한다. 서브테스트 이름은 `` `rejects unknown ${tool} argument: ${unknownKey}` ``로 한다(SC-002에서 출력만 보고 wrapper를 식별할 수 있게).
- [x] T013 [US1] 각 서브테스트 내부에서 `createMcpRequestHandler({ runtimeOptions: { chatClient: new ShouldNotRunChatClient() } })`를 새로 만들어 `handleRequest({ jsonrpc: '2.0', id: 100 + index, method: 'tools/call', params: { name: tool, arguments: { ...args, [unknownKey]: 'rejected-by-validator' } } })`를 호출한다(plan Implementation Outline (c)).
- [x] T014 [US1] 각 서브테스트의 응답에 다음 다섯 어서션을 모두 적용한다(spec FR-002 ~ FR-004, plan Implementation Outline (d), (e)):
  - (a) `assert.equal(response.isError, true);`
  - (b) `assert.match(response.content[0].text, new RegExp(\`Invalid arguments for ${tool}\`));`
  - (c) `assert.match(response.content[0].text, new RegExp(\`Unknown ${tool} argument: ${unknownKey}\`));`
  - (d) `assert.equal(response.structuredContent.failure.category, 'input');` 및 `assert.equal(response.structuredContent.failure.reason, 'invalid_arguments');`
  - (e) `assert.doesNotMatch(response.content[0].text, /runtime should not be invoked/);` — ChatClient 카나리아 미호출 검증(spec FR-003).
- [x] T015 [US1] 어서션 (b), (c)의 정규식이 wrapper 이름·키 이름 모두 `[A-Za-z_]+`만 포함하는 매트릭스(T005, T006)에서는 escape가 불필요함을 다시 확인한다. 만약 차후 unknown 키에 특수문자가 들어오면 `String.prototype.includes`로 전환할 수 있게 어서션 위에 한 줄짜리 의도 주석(`// keep names ASCII so RegExp escape is unnecessary`)을 남긴다(plan 위험 표 마지막 행).
- [x] T016 [US1] `node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"`를 실행해 부모 1개 + 서브테스트 6개가 모두 PASS함을 확인한다(SC-001). 한 케이스라도 FAIL이면 T005/T006/T011/T014의 입력 또는 어서션을 점검한다. `src/mcp/server.mjs`는 절대 건드리지 않는다.
- [x] T017 [US1] `npm test`를 실행해 본 작업 전후로 동일하게 전체 PASS임을 확인한다(SC-003). 추가 런타임 의존성이 0임도 같이 확인(`package.json` 변경 없음).

**Checkpoint**: US1 완료. 6개 wrapper unknown-key 회귀 안전망이 단일 테스트 호출로 동작한다.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 매트릭스가 “정말로 깨지는 것을 잡는다”는 시그널 품질을 회귀 실험으로 확증하고, 변경 범위를 닫는다. 본 feature는 P2/P3 user story가 없으므로 곧바로 Polish로 진입한다.

- [x] T018 [US1] **단독 실행 확인**: `node --test tests/mcp-server.test.mjs --test-name-pattern "unknown wrapper arguments"`만 실행해도 외부 fixture(`makeRepoFixture` 등) 없이 PASS함을 다시 한 번 확인한다(FR-006, plan Test Strategy 단독성 검증).
- [x] T019 [US1] **회귀 실험 1 (collect_evidence 분기)**: 로컬에서만 `src/mcp/server.mjs`의 `collect_evidence` dispatch 분기에서 `validatePublicToolArgs(...)` 호출 한 줄을 일시적으로 제거한다. 매트릭스 재실행 시 정확히 `rejects unknown collect_evidence argument: priority` 서브테스트 1개만 FAIL하고 나머지 5개는 PASS인지, 그리고 그 FAIL의 본문에 `runtime should not be invoked` 문구가 등장해 어서션 (e)가 깨지는지를 확인한다(SC-002).
- [x] T020 [US1] **복구 1**: 즉시 `git restore src/mcp/server.mjs`로 원복하고 `git status`가 clean인지, 매트릭스가 다시 전부 PASS인지 확인한다. 회귀 실험은 절대 커밋하지 않는다.
- [x] T021 [US1] **회귀 실험 2 (find_relevant_code 또는 review_change_context 분기 중 하나)**: T019와 동일한 절차로 다른 wrapper 분기 한 곳에 대해 spot check를 1회 더 수행하고 같은 패턴의 시그널이 나오는지 확인한다. plan Test Strategy의 “6개 전수 회귀 실험은 불필요” 방침을 따른다.
- [x] T022 [US1] **복구 2**: T020과 동일하게 `git restore src/mcp/server.mjs`로 즉시 복구하고 `git status` clean 확인.
- [x] T023 [US1] **변경 범위 닫기**: `git diff --name-only`가 `tests/mcp-server.test.mjs` 단일 파일만 보여주는지 확인한다. 그 외 파일(특히 `src/mcp/server.mjs`, `package.json`, `package-lock.json`)이 등장하면 작업이 잘못된 것이므로 원인을 찾는다(FR-005).
- [x] T024 [US1] **최종 회귀**: `npm test`를 한 번 더 실행해 전체 PASS, `0 fail`임을 확인한다(SC-003).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 의존성 없음. 즉시 시작 가능.
- **Phase 2 (Foundational)**: Phase 1 완료 필요. US1의 매트릭스 입력 정의를 확정하므로 US1을 막는다.
- **Phase 3 (US1)**: Phase 2 완료 필요. 본 feature의 유일한 user story.
- **Phase 5 (Polish)**: Phase 3 완료 필요. 회귀 실험으로 시그널 품질을 확증하고 변경 범위를 닫는다.

### Within User Story 1

- T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015 순으로 직렬. 모두 `tests/mcp-server.test.mjs` 동일 파일·동일 테스트 함수 안에서 진행되므로 [P] 병렬화는 불가능하다.
- T016, T017은 T015까지 완료된 후에만 의미 있는 결과를 낸다.
- Polish 단계의 회귀 실험(T019/T021)은 T017 완료 후 차례로 수행한다. 두 실험 사이에는 반드시 T020(복구)이 들어가 한 번에 두 분기를 동시에 제거하지 않는다(어떤 분기에서 시그널이 나는지 모호해지는 것 방지).

### Parallel Opportunities

- 본 feature는 단일 파일·단일 테스트 함수 안의 작업이라 `[P]` 표시 대상이 거의 없다. 예외적으로 T002와 T003은 명령 실행 순서만 무관하므로 동시 실행 가능하지만 단일 개발자 작업에서는 굳이 병렬화할 가치가 없다.
- 팀 작업 시에도 본 task는 1인이 직렬로 진행하는 편이 가장 안전하다(매트릭스 어서션 일관성 보장).

---

## Notes

- 모든 경로는 저장소 루트 기준 상대 경로다(`tests/mcp-server.test.mjs`, `src/mcp/server.mjs`).
- 변경 파일은 끝까지 `tests/mcp-server.test.mjs` 한 개로 유지한다. 어떤 이유로든 `src/mcp/server.mjs`를 수정해야 한다고 느끼면, 그 시점에서 본 task가 아니라 별도 feature로 분기해야 한다(FR-005, SC-002의 회귀 실험 신뢰성 보장).
- 회귀 실험(T019, T021)은 **로컬 워킹 트리에서만** 일시적으로 수행하고 즉시 `git restore`로 복구한다. 절대 커밋·푸시하지 않는다.
- 본 feature는 추가 런타임/테스트 의존성을 0으로 유지한다. `package.json`은 변경되지 않는다.
- 매트릭스의 unknown 키 이름은 wrapper마다 서로 다르게 잡혀 있어 “모든 케이스가 동일 키 하나에만 반응”하는 우연 통과를 차단한다.
- 부모 테스트 이름은 기존 단일 테스트와 동일한 `MCP request handler rejects unknown wrapper arguments before runtime execution`을 유지해 외부에서 참조되는 `--test-name-pattern "unknown wrapper arguments"`가 그대로 작동한다.
