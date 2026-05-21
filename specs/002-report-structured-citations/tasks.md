# Tasks: Report-mode Structured Citations

**Input**: Design documents from `specs/002-report-structured-citations/`

**Prerequisites**: `specs/002-report-structured-citations/spec.md` (필수), `specs/002-report-structured-citations/plan.md` (필수)

**Tests**: Required — `tests/free-explore.test.mjs`, `tests/mcp-server.test.mjs`에 신규 단위/통합 테스트를 추가하고 `npm test`가 0 failure로 통과해야 함 (plan의 Test Strategy 및 AGENTS.md 테스트 가드 준수)

**Organization**: 작업은 user story 단위(US1 = runtime 반환 객체에 `citations[]` / `targets[]` 추가, US2 = MCP `structuredContent` 전파)로 묶여 있어 각 story가 독립적으로 구현·테스트·검증될 수 있다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 파일이 서로 다르고 선행 의존이 끝난 경우 병렬 실행 가능
- **[Story]**: 해당 task가 속한 user story (US1, US2). 두 story 공통 작업은 [Story] 라벨 생략하거나 [Foundation] 표기
- 모든 파일 경로는 저장소 루트 기준 상대 경로 (예: `src/explorer/runtime.mjs`)

## Path Conventions

- **Single project (Node.js ESM MCP 서버)**: `src/`, `tests/` 가 저장소 루트 바로 아래에 위치
- 본 feature가 건드리는 디렉터리: `src/explorer/`, `src/mcp/`, `tests/`
- 신규 디렉터리·신규 파일을 만들지 않는다 (plan의 Project Structure 결정)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 본 feature는 신규 패키지·디렉터리·툴체인 변경이 없으므로 Setup 단계는 비어 있다.

- (해당 없음) zero runtime deps 유지, 기존 `node:test`만 사용. Setup phase는 skip하고 곧바로 Foundational phase로 진입한다.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: US1·US2가 공통으로 의존하는 정규화/빌더 헬퍼를 먼저 도입한다. 두 story 모두 이 헬퍼의 안정된 출력에 기댄다.

**중요**: 본 phase가 끝나기 전까지 US1·US2 구현 task는 시작할 수 없다.

- [ ] T001 [Foundation] `src/explorer/runtime.mjs` 안에 `buildReportCitations(report)` 헬퍼를 모듈-로컬로 추가한다. 내부에서 `src/explorer/critic.mjs`의 `extractReportCitations`와 `extractGitCitations`를 호출하고, 각 원소를 다음 정규화된 shape으로 매핑한다: file 인용은 `{ type: 'file_range', path, startLine, endLine, raw }`, git 인용은 `{ type: item.type ?? 'git_commit', path?, startLine?, endLine?, sha?, raw }`(path·line 키는 존재할 때만 포함). 결과는 file-range → git 순서로 concat하며 빈 입력에서도 반드시 배열을 반환한다. 추출기 자체는 절대 수정하지 않는다 (FR-007). 헬퍼는 export하지 않고 파일 내부에서만 사용한다.
- [ ] T002 [Foundation] `src/explorer/runtime.mjs` 안에 `buildReportCitationTargets(citations)` 헬퍼를 추가한다. 입력 citation 배열을 순회하며 `(path, startLine, endLine)` 세 키 조합으로 dedupe하고, 각 entry를 `{ path, startLine?, endLine?, role: 'reference', reason: 'Markdown report citation', evidenceRefs: [] }` 형태로 변환한다. `path`가 없는 git citation(예: pure commit sha)은 target으로 승격하지 않는다. 빈 입력에서도 반드시 배열을 반환한다.

**Checkpoint**: 두 헬퍼가 module-local로 정의되어 있고 syntax error 없이 `runtime.mjs`가 로드되면, US1·US2 구현을 병렬로 시작할 수 있다.

---

## Phase 3: User Story 1 - 상위 에이전트가 Markdown 재파싱 없이 file:line 인용을 읽는다 (Priority: P1) MVP

**Goal**: report-mode runtime (`freeExplore`, `freeExploreV2`) 반환 객체에 `citations[]`와 citation-derived `targets[]`를 추가해, in-process 호출자가 구조화된 인용을 바로 읽을 수 있게 한다.

**Independent Test**: mock chat client로 `'Summary cites \`src/auth.js:L1-L3\` and \`src/routes/user.js:L2\`.'` 형태의 Markdown report를 반환시키고, runtime 반환 객체의 `citations[]`와 `targets[]`가 spec의 정규화된 shape과 dedup 규칙을 만족하는지 단위 테스트로 확인한다 (Markdown 재파싱 없이).

### Tests for User Story 1 (Required)

> **NOTE: 테스트는 구현보다 먼저 작성하고, 구현 전에 fail하는 것을 확인한 뒤 구현으로 진행한다.**

- [ ] T003 [P] [US1] `tests/free-explore.test.mjs`에 `freeExplore exposes report citations and citation targets` 테스트를 추가한다. mock client가 file 인용 두 건이 포함된 Markdown report를 반환하도록 설정하고, 반환 객체의 `citations[]`가 `{type:'file_range', path, startLine, endLine}` 항목 두 개를 (raw 제외 deep-equal로) 포함하며, `targets[]`가 동일 path/line 정보를 `role: 'reference'`와 함께 두 항목으로 노출하는지 검증한다.
- [ ] T004 [P] [US1] `tests/free-explore.test.mjs`에 `freeExplore returns empty citations and targets when report has no citations` 테스트를 추가한다. mock report가 file:line 인용을 전혀 포함하지 않을 때 `citations`와 `targets` 모두 `[]`로 노출되며 키 자체가 존재함을 검증한다 (FR-005, SC-003 의 빈 인용 case).
- [ ] T005 [P] [US1] `tests/free-explore.test.mjs`에 `freeExploreV2 exposes the same citation shape with transcriptPath preserved` 테스트를 추가한다. V2 경로에서도 동일 fixture로 `citations[]` / `targets[]`가 노출되며 기존 `transcriptPath`가 여전히 string으로 살아 있는지 함께 검증한다 (V2 contract regression 가드).
- [ ] T006 [P] [US1] `tests/free-explore.test.mjs`에 `freeExplore deduplicates citation-derived targets by (path, startLine, endLine)` 테스트를 추가한다. mock report가 동일 file:line range를 두 번 언급할 때, `citations[]`는 두 항목을 유지하지만 `targets[]`는 한 항목으로 dedupe됨을 검증한다 (Edge case "report mentions a path multiple times").

### Implementation for User Story 1

- [ ] T007 [US1] `src/explorer/runtime.mjs`의 `freeExplore` 종료부(critic 빌드 직후, return문 직전 — plan 기준 line 1889 근처)에서 `const citations = buildReportCitations(report);`, `const targets = buildReportCitationTargets(citations);`를 계산해 반환 객체에 추가한다. 반환 객체의 기존 필드(`report`, `filesRead`, `toolsUsed`, `stats`, `critic`, `searchCoverage`, `toolTrace`)는 이름·순서·타입 모두 그대로 유지하고, `report` 문자열은 어떤 경우에도 재가공하지 않는다 (SC-004).
- [ ] T008 [US1] `src/explorer/runtime.mjs`의 `freeExploreV2` 종료부(plan 기준 line 2372 근처, max-output-recovery 분기를 모두 거쳐 `report`가 최종 확정된 직후)에서 동일하게 `buildReportCitations` / `buildReportCitationTargets`를 한 번만 호출해 반환 객체에 `citations`, `targets`를 추가한다. 중간 단계 report에서는 절대 계산하지 않는다 (V2 max-output-recovery 중 stale citation 방지 — plan Risks 표 참조). 기존 `transcriptPath` 필드는 그대로 보존한다.

**Checkpoint**: 이 시점에서 US1 단위 테스트(T003–T006)가 모두 통과하면 in-process 호출자에 한해 report-mode 도구가 구조화된 인용을 노출한다. MCP 표면은 아직 검증되지 않았다.

---

## Phase 4: User Story 2 - MCP 클라이언트가 `structuredContent`로 인용을 받는다 (Priority: P1)

**Goal**: `src/mcp/server.mjs`의 `explore` / `explore_v2` 핸들러가 US1에서 추가된 `citations[]` / `targets[]`를 `structuredContent`로 전파하고, redaction 파이프라인이 두 표면(`content[0].text`와 `structuredContent`)에 일관되게 적용되도록 한다.

**Independent Test**: `createMcpRequestHandler()`로 받은 핸들러에 `{method:'tools/call', params:{name:'explore', ...}}` 요청을 보내고, 응답 envelope의 `content[0].text`가 mock Markdown과 byte-identical이며 `structuredContent.citations[]` / `structuredContent.targets[]`가 동일 정보를 노출하는지 통합 테스트로 검증한다. deny-listed path를 가진 fixture에서는 두 표면에서 동일 redacted 문자열이 보이는지 확인한다.

### Tests for User Story 2 (Required)

> **NOTE: 테스트는 구현보다 먼저 작성하고, 구현 전에 fail하는 것을 확인한 뒤 구현으로 진행한다.**

- [ ] T009 [P] [US2] `tests/mcp-server.test.mjs`에 `explore returns Markdown text plus structured citations` 테스트를 추가한다. mock client가 file:line 인용 두 건을 포함하는 Markdown을 반환할 때, MCP envelope의 `content[0].text`가 mock Markdown과 byte-identical이며 `structuredContent.citations[]`가 file_range entry를, `structuredContent.targets[0].role === 'reference'`임을 동시에 검증한다 (SC-004 + FR-004).
- [ ] T010 [P] [US2] `tests/mcp-server.test.mjs`에 `explore_v2 also exposes structured citations through structuredContent` 테스트를 추가한다. `name: 'explore_v2'` 요청에 대해서도 동일 shape이 노출됨을 검증한다.
- [ ] T011 [P] [US2] `tests/mcp-server.test.mjs`에 `explore redacts deny-listed paths consistently in both surfaces` 테스트를 추가한다. mock client가 deny-listed 토큰(예: `.env.production`)을 포함하는 인용을 가진 Markdown을 반환할 때, `content[0].text`와 `structuredContent.citations[0].path`가 같은 redacted 문자열로 마스킹되는지 검증한다 (FR-006, Edge case "deny-listed citation path"). 동시에 plain path를 가진 다른 인용은 변경 없이 통과해야 한다.
- [ ] T012 [P] [US2] `tests/mcp-server.test.mjs`에 `explore with empty-citation report exposes citations: [] in structuredContent` 테스트를 추가한다. citation을 전혀 포함하지 않는 Markdown fixture에서 `structuredContent.citations === []`와 `Array.isArray(structuredContent.targets) === true`가 동시에 성립함을 검증한다 (SC-003).

### Implementation for User Story 2

- [ ] T013 [US2] `src/mcp/server.mjs`의 `callFreeExploreTool` / `callFreeExploreV2Tool`이 이미 `redactValue(result).value` 전체를 `structuredContent`로 반환하는지 확인한다 (plan 기준 line 674–696, 698–717). runtime이 US1에서 `citations` / `targets`를 새 키로 추가했으므로 별도 코드 수정 없이 자동 전파된다. 본 task는 두 핸들러의 현재 코드를 읽어 (i) `content[0].text`가 여전히 `safeResult.report`로 채워지는지, (ii) `structuredContent` 직렬화 경로에 새 필드가 손실되거나 필터링되지 않는지, (iii) `redactValue` 호출이 반환 직전에 1회만 일어나는지를 확인하는 검증 단계이다. 코드 변경이 필요한 경우에만 최소한의 패치(예: structuredContent 화이트리스트가 있다면 `citations` / `targets` 추가)를 가한다.
- [ ] T014 [US2] `src/mcp/server.mjs`의 `explore` 라우터(plan에서 언급된 `shouldUseV2ForExplore` 분기)가 V1/V2 어느 쪽으로 가도 동일 envelope shape이 유지됨을 확인한다. 분기 코드의 시그니처와 envelope 직렬화 경로를 수정하지 않고, V1 결과·V2 결과가 모두 동일한 `citations[]` / `targets[]` 키를 갖는지 점검만 수행한다. 라우터 자체는 본 feature의 변경 범위 밖이다.

**Checkpoint**: 이 시점에서 US1·US2 전용 테스트(T003–T012)가 모두 통과하면, in-process와 MCP 양쪽 표면 모두에서 구조화된 인용이 노출되고 redaction 정책이 일관되게 적용된다. MVP 완료.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 두 user story가 완성된 뒤, 전체 회귀와 edge case 통합 검증을 수행한다. 본 plan의 Constitution Check가 PASS이므로 README/DESIGN 같은 산문 동기화는 본 task 범위 밖(Task 9)이다.

- [ ] T015 저장소 루트에서 `npm test`를 한 번 실행해 전체 스위트가 0 failure로 종료되는지 확인한다 (AGENTS.md 테스트 가드). 신규 추가된 T003–T012가 모두 green이며, 기존 `tests/integrations.test.mjs` snapshot이나 `tests/mcp-server.test.mjs`의 기존 단정이 회귀 없이 통과하는지 검증한다.
- [ ] T016 `explore_repo` compact 응답이 본 feature의 변경으로 의도치 않게 `citations` / `targets`를 노출하지 않는지 회귀 검사한다. `tests/mcp-server.test.mjs`의 기존 compact response 단정(또는 필요 시 새 한 줄 단정)으로, `name: 'explore_repo'` 호출의 `structuredContent`에 `citations` 키가 등장하지 않음을 확인한다 (plan Risks 표 "Compact `explore_repo` 응답에 누수" 가드).
- [ ] T017 SC-004(Markdown byte-identical) 보강 확인: 동일 mock report fixture에 대해 본 변경 전·후 `content[0].text`가 동일한지 확인할 수 있도록, T009의 단정이 mock Markdown 원본과 byte-identical 비교(예: `assert.strictEqual`)를 사용하는지 점검한다. 필요 시 단정을 강화한다.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 본 feature에서는 비어 있음. 곧바로 Foundational 단계로 진입.
- **Foundational (Phase 2)**: T001 → T002 순서로 진행. 두 헬퍼가 모두 정의되기 전에는 US1·US2 구현을 시작하지 않는다.
- **User Story 1 (Phase 3)**: Foundational 완료 후 시작. 테스트(T003–T006)는 구현(T007–T008)보다 먼저 작성·검증한다.
- **User Story 2 (Phase 4)**: Foundational 완료 후 시작 가능. 단, T013에서 `structuredContent` 자동 전파를 확인하려면 US1 구현(T007–T008)이 끝나 runtime이 실제로 새 필드를 반환하고 있어야 한다. 따라서 실무적으로 US1 → US2 직렬이 안전하다.
- **Polish (Phase 5)**: 두 user story가 모두 완료된 뒤에만 실행한다.

### User Story Dependencies

- **User Story 1 (P1)**: Foundational(T001, T002) 이후 곧바로 시작. 다른 story에 의존하지 않는다.
- **User Story 2 (P1)**: Foundational(T001, T002) 이후 시작 가능하지만, T013/T014의 검증은 US1 구현(T007/T008)이 끝나야 의미 있는 envelope를 만들 수 있다. 단위 테스트(T009–T012)는 mock client 픽스처로 stub할 수 있어 US1 구현 전이라도 작성·실패 확인이 가능하다.

### Within Each User Story

- 테스트(T003–T006, T009–T012)는 구현 전에 작성하고, 구현 전 fail을 확인한 뒤 구현으로 진행한다.
- 헬퍼 → 호출자 순서: T001/T002(헬퍼) → T007/T008(`runtime.mjs` 반환부 통합).
- 같은 파일을 만지는 task끼리는 [P]를 부여하지 않는다 (T007과 T008은 같은 `src/explorer/runtime.mjs`를 만지므로 직렬이지만, 함수가 다르므로 한 PR로 합쳐도 충돌 없음 — 단 순차로 적용).

### Parallel Opportunities

- T001 → T002는 같은 파일 안에서 순차로 도입한다 (병렬 불가, 동일 파일 충돌).
- T003, T004, T005, T006은 모두 `tests/free-explore.test.mjs`에 추가되지만 서로 다른 `test('...')` 블록을 독립적으로 작성·실행하는 단위라 [P]로 표기. 단, 같은 파일을 만지므로 실제 머지 시 한 PR로 모으는 것을 권장.
- T009, T010, T011, T012는 모두 `tests/mcp-server.test.mjs`에 추가되며 동일하게 [P]로 표기.
- T007과 T013은 서로 다른 파일(`src/explorer/runtime.mjs` vs `src/mcp/server.mjs`)이므로 병렬 진행 가능. 단, T013의 검증 결과를 의미 있게 만들려면 T007이 먼저 끝나야 한다.

---

## Parallel Example: User Story 1 Tests

```bash
# US1 단위 테스트는 모두 tests/free-explore.test.mjs 안에서 작성되지만
# 서로 다른 test() 블록이라 동시에 작성/리뷰할 수 있다:
Task: "Add `freeExplore exposes report citations and citation targets` test in tests/free-explore.test.mjs"
Task: "Add `freeExplore returns empty citations and targets when report has no citations` test in tests/free-explore.test.mjs"
Task: "Add `freeExploreV2 exposes the same citation shape with transcriptPath preserved` test in tests/free-explore.test.mjs"
Task: "Add `freeExplore deduplicates citation-derived targets by (path, startLine, endLine)` test in tests/free-explore.test.mjs"
```

---

## Implementation Strategy

### MVP First (User Story 1 → User Story 2)

1. Phase 2(Foundational) 완료: 두 헬퍼 도입.
2. Phase 3(US1) 완료: runtime 반환 객체에 `citations[]` / `targets[]` 노출. 단위 테스트 4종 통과.
3. **STOP and VALIDATE**: in-process 호출자(예: benchmark, 내부 호출) 관점에서 인용 노출이 동작하는지 확인.
4. Phase 4(US2) 완료: MCP `structuredContent` 전파 검증 + redaction 일관성 + 빈 인용 case. 단위 테스트 4종 통과.
5. Phase 5: `npm test` 전체 회귀 + compact 누수 가드 + Markdown byte-identical 단정 강화.

### Incremental Delivery

본 feature는 두 P1 story가 묶여 동작해야 사용자 가치가 완성되지만, US1 단독으로도 in-process 호출자(향후 Task 3 evidence-preservation benchmark)에는 즉시 가치가 있다. 따라서:

1. T001–T002 → T003–T008 머지: in-process citation API 노출.
2. T009–T014 머지: MCP 표면 검증 및 redaction 가드 추가.
3. T015–T017 머지: 회귀 + edge 가드.

각 단계는 backward-compatible — 기존 필드를 제거하거나 이름을 바꾸지 않으므로, 어떤 단계에서 멈춰도 기존 통합은 회귀하지 않는다.

---

## Notes

- [P] task = 서로 다른 파일이거나 동일 파일이라도 독립적인 `test()` 블록으로 충돌 없음
- [Story] 라벨은 US1·US2로 traceability를 제공
- 본 feature는 코드 변경이 매우 좁다: 두 헬퍼 + 두 호출자 + MCP 핸들러 자동 전파 확인. 테스트가 변경 표면보다 더 무겁다.
- 추출기 동작(`extractReportCitations`, `extractGitCitations`)은 본 task 범위 밖. 그쪽을 수정하고 싶다면 별도 spec/plan으로.
- `targets[].role: 'reference'`는 compact `explore_repo`의 `targets[]`와의 어휘 구분을 위해 반드시 명시. 테스트에서도 `role` 값까지 단정한다.
- 모든 task 완료 후 commit하기 전에 `npm test`로 0 failure를 확인한다 (AGENTS.md 테스트 가드).
