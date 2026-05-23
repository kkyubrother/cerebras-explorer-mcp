# Implementation Plan: Report-mode Structured Citations

**Branch**: `002-report-structured-citations` | **Date**: 2026-05-21 | **Spec**: `specs/002-report-structured-citations/spec.md`

**Input**: Feature specification from `specs/002-report-structured-citations/spec.md` (002 브랜치 전용)

**원본 plan 참조**: `docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md`의 Task 2 섹션 ("Add Structured Citations to Report Tools").

## Summary

`explore` / `explore_v2` 의 report-mode 응답은 현재 Markdown report 텍스트와 `filesRead`, `toolsUsed`, `stats`, `critic`, `searchCoverage`, `toolTrace` (그리고 V2의 `transcriptPath`) 만 반환한다. 상위 에이전트가 file:line 인용을 얻으려면 동일한 정규식 작업을 Markdown 위에서 다시 돌려야 하는데, 이 일은 `src/explorer/critic.mjs`의 `extractReportCitations` / `extractGitCitations`가 이미 critic 경로에서 수행 중이다.

본 계획은 critic의 추출기 출력을 그대로 정규화해 두 report-mode 런타임 반환 객체에 `citations[]` 와 citation 파생 `targets[]` (role=`reference`)를 추가하고, `src/mcp/server.mjs`의 explore/explore_v2 핸들러가 `structuredContent`로 동일한 필드를 노출하도록 한다. 추출기 동작 자체는 변경하지 않고 (FR-007), redaction 파이프라인은 기존 `redactValue()` 흐름 안에서 자동으로 적용된다 (FR-006). Markdown(`content[0].text`)은 byte-identical 유지(SC-004).

## Technical Context

**Language/Version**: Node.js ESM (project은 zero runtime deps, AGENTS.md 불변 사항)

**Primary Dependencies**: 없음 — 표준 라이브러리와 기존 `src/explorer/critic.mjs` 헬퍼만 사용. 신규 패키지 추가 금지.

**Storage**: 해당 없음. 응답 객체와 MCP `structuredContent` in-memory만 변경.

**Testing**: 내장 `node:test`. 신규 테스트는 `tests/free-explore.test.mjs`(runtime 단위), `tests/mcp-server.test.mjs`(MCP 핸들러 통합)에 추가.

**Target Platform**: MCP JSON-RPC stdio 서버 (`src/mcp/server.mjs`), Cerebras `zai-glm-4.7` 백엔드. Public surface 8 tools 가운데 report-mode 2개(`explore`, opt-in `explore_v2`)의 응답 형태에만 영향.

**Project Type**: 단일 Node.js MCP 서버 패키지.

**Performance Goals**: 정규식 기반 추출은 critic 단계에서 이미 수행 중이며, runtime 반환부에서 1회 더 호출해도 사용자 체감 지연은 무시 가능. Report 길이에 선형 비례.

**Constraints**: zero-dep 유지, read-only 트러스트 경계 유지, redaction deny-list 통과, Markdown 본문 보존, 기존 필드 이름/타입 비파괴.

**Scale/Scope**: report-mode 호출 1건당 보통 인용 0–수십 개. `targets[]` 역할 필드는 compact `explore_repo`의 `targets[]`와 구분하기 위해 `role: 'reference'`로 명시.

## Constitution Check

`AGENTS.md` 가드레일에 대한 통과 진술:

- **Zero runtime deps**: 신규 의존성 0. 기존 `critic.mjs` 헬퍼만 import.
- **Read-only 파일 접근**: 추가되는 코드 경로는 추출/정규화/직렬화만 수행. 새 파일 시스템 쓰기 경로 없음.
- **Secret deny-list + redaction**: citations[]/targets[]는 기존 `redactValue()` 호출 안쪽에서 처리되므로 path가 deny-list에 걸리면 다른 필드와 동일한 규칙으로 마스킹됨. 별도 redaction 경로 도입 금지.
- **공개 도구 표면 8개 유지**: 신규 tool 없음. `explore`/`explore_v2` 응답 shape에 추가 필드(superset)만 발생 — backward-compatible.
- **공개 계약 필드명 규칙**: 새 필드는 `citations`, `targets` 둘 다 신규이며, 옛 deprecated 필드명(`answer`, `confidence`, `candidatePaths` 등)을 신설하지 않음. `targets[]` 의 `role: 'reference'`는 `explore_repo` compact `targets[]`의 역할 어휘와 구분되는 새 값.
- **문서 동기화 매트릭스**: 본 plan 범위는 `src/explorer/runtime.mjs`, `src/mcp/server.mjs`, `tests/*`. 매트릭스상 `src/mcp/server.mjs` 공개 도구 표면(도구 추가/삭제/이름 변경)은 변경하지 않으므로 integrations README 동기화 의무는 발생하지 않음. README/DESIGN 갱신은 별도 Task 9 범위.
- **테스트 가드**: 신규 노출 필드는 `tests/free-explore.test.mjs`와 `tests/mcp-server.test.mjs`의 새 assertion으로 보호되며, `npm test`가 0 fail을 유지해야 commit 가능.
- **`tests/integrations.test.mjs` snapshot**: 본 변경은 `examples/expected-response.json`이나 install ref 등 snapshot 가드 대상 산문/숫자를 건드리지 않음.

Constitution Check: **PASS**. Complexity Tracking 항목 비움.

## Project Structure

### Documentation (this feature)

```text
specs/002-report-structured-citations/
├── spec.md              # 본 plan의 입력 (002 브랜치)
└── plan.md              # 본 문서 (초안: .specify/.spec-drafts/task-2-plan-draft.md)
```

### Source Code (repository root) — 본 feature가 건드리는 영역

```text
src/
├── explorer/
│   ├── runtime.mjs          # freeExplore / freeExploreV2 반환 객체에 citations[], targets[] 추가
│   └── critic.mjs           # extractReportCitations / extractGitCitations 재사용 (변경 최소화, 필요 시 normalization helper export만 추가)
└── mcp/
    └── server.mjs           # callFreeExploreTool / callFreeExploreV2Tool 의 structuredContent에 citations[], targets[] 전파 확인

tests/
├── free-explore.test.mjs    # report-mode runtime이 citations[]/targets[]를 정확히 노출하는지 fixture 검증
└── mcp-server.test.mjs      # explore/explore_v2의 MCP envelope에서 content[0].text 보존 + structuredContent.citations 노출 + redaction 일관성
```

**Structure Decision**: 단일 Node.js ESM 패키지의 기존 `src/explorer` 와 `src/mcp` 모듈만 수정한다. 새 디렉터리·새 파일은 만들지 않는다. 추출기는 `src/explorer/critic.mjs` 단일 출처를 유지하고, 정규화(공개 응답 shape 변환)는 `src/explorer/runtime.mjs` 안에서 수행한다.

## Implementation Outline

### (a) 정규화 헬퍼 도입 (citations[]/citation-derived targets[] 빌더)

`src/explorer/runtime.mjs`에 두 개의 모듈-로컬 헬퍼를 추가한다.

- `buildReportCitations(report)`:
  - `extractReportCitations(report)`의 결과를 `{ type: 'file_range', path, startLine, endLine, raw }` 형태로 매핑.
  - `extractGitCitations(report)`의 결과를 `{ type: item.type ?? 'git_commit', path?, startLine?, endLine?, sha?, raw }` 형태로 매핑 (path/line 존재 시에만 키 포함).
  - 두 배열을 file-range → git 순으로 concat. 빈 배열도 항상 배열로 반환 (FR-005).
- `buildReportCitationTargets(citations)`:
  - `(path, startLine, endLine)` 키로 dedupe.
  - 각 entry는 `{ path, startLine?, endLine?, role: 'reference', reason: 'Markdown report citation', evidenceRefs: [] }`.
  - `path` 없는 git citation(예: pure commit sha)은 target으로 승격하지 않음.

기존 `critic.mjs` 추출기는 변경하지 않는다. 만약 normalization이 critic 내부에서도 재사용 가치가 있다고 판단되면 `critic.mjs`에 `buildReportCitations` 만 한정적으로 export 하는 선택지를 두지만, 기본 결정은 runtime-local helper 유지(스코프 최소화).

### (b) `freeExplore` 반환에 추가

`runtime.mjs:1889` 근처의 `freeExplore` 종료부에서 critic 빌드 직후 다음을 계산하고 반환 객체에 추가한다:

```js
const citations = buildReportCitations(report);
const targets = buildReportCitationTargets(citations);
return {
  report,
  citations,
  targets,
  filesRead: reportFilesRead,
  toolsUsed: [...toolsUsed],
  stats,
  critic,
  searchCoverage: buildSearchCoverage(stats),
  toolTrace: toolTrace.toJSON(),
};
```

기존 필드 순서/이름은 유지. `citations`와 `targets`만 추가. `report` 문자열 자체는 어떤 경우에도 재가공하지 않는다(SC-004).

### (c) `freeExploreV2` 반환에 추가

`runtime.mjs:2372` 근처의 V2 종료부에서 동일하게 `buildReportCitations(report)` / `buildReportCitationTargets(citations)` 를 호출하고 다음을 반환:

```js
return {
  report,
  citations,
  targets,
  filesRead: reportFilesRead,
  toolsUsed: [...toolsUsed],
  stats,
  critic,
  searchCoverage: buildSearchCoverage(stats),
  transcriptPath: transcript.filePath,
  toolTrace: toolTrace.toJSON(),
};
```

`transcriptPath` 보존. V2의 max-output-recovery 경로에서 `report`가 갱신되더라도 citations은 **최종 `report` 문자열** 기준으로 한 번만 계산한다(중간 단계 인용은 commit하지 않음).

### (d) MCP `structuredContent` 로 노출

`src/mcp/server.mjs`의 `callFreeExploreTool`(line 674–696) 과 `callFreeExploreV2Tool`(line 698–717)는 이미 `redactValue(result).value` 전체를 `structuredContent` 로 그대로 반환한다. runtime이 새 필드를 추가한 시점부터 자동 전파된다. 별도 핸들러 수정은 불요.

확인 항목:
- `content[0].text` 는 `safeResult.report` 그대로 — Markdown 본문 보존 (SC-004, FR-004).
- `structuredContent.citations` 와 `structuredContent.targets` 가 array로 노출 — 빈 보고서도 `[]`(FR-005, SC-003).
- explore 라우터(`shouldUseV2ForExplore`)가 V1/V2를 어느 쪽으로 분기하든 동일 shape이므로 라우터 변경 불요.

### (e) Redaction 통합 확인

두 핸들러 모두 반환 직전에 `redactValue(result)` 를 통과시킨다(서버 line 688, 709). `redactValue`는 객체 트리 전체를 재귀 순회하므로 `citations[].path`, `citations[].raw`, `targets[].path`, `targets[].reason` 등 모든 문자열 필드가 deny-list 규칙을 동일하게 받는다. 추가 옵트인 코드 없음. 본 plan에서는 다음을 단위 테스트로 강제한다:

- deny-listed path("secret"-계열)를 포함한 Markdown 픽스처를 모델 출력으로 흘려보내고, 같은 redaction 토큰이 (i) `content[0].text` 와 (ii) `structuredContent.citations[].path` 양쪽에 일관되게 적용되는지 검사 (Edge case "deny-listed citation path", FR-006, SC-002).

### (f) 단위 테스트 추가

테스트 전략 섹션에서 구체화. 신규 테스트는 모두 mock chat client + `makeRepoFixture()` 패턴을 따른다 (저장소의 기존 테스트 컨벤션).

---

## Risks & Mitigations

| Risk | Detail | Mitigation |
|---|---|---|
| 빈 citations 처리 | 모델이 file:line 인용 없이 산문만 반환하면 downstream 가 `undefined`를 만나면 분기 로직이 깨질 수 있음. | `buildReportCitations`는 항상 array를 반환하고, runtime 반환부도 항상 `citations: [], targets: []` 형태로 키를 노출(FR-005, SC-003). 단위 테스트로 "citation 0건" 케이스를 명시 검증. |
| Redacted path 노출 | citation `path` 가 deny-listed 토큰을 포함할 때 Markdown은 redact되는데 structuredContent에는 raw가 남으면 secret leak. | `structuredContent`는 `redactValue(result).value` 를 통과한 결과만 노출하므로 동일한 deny-list 규칙이 적용됨. mcp-server 테스트에서 두 표면의 redacted 문자열 일치성을 assert. 별도 redaction 우회 경로 추가 금지. |
| 기존 `explore_repo` compact `targets[]` 와의 혼동 | 같은 `targets[]` 이름이지만 의미가 다름 — compact는 LLM이 emit한 후속 작업 후보, report-mode는 인용 derived. 상위 에이전트가 같은 키로 가정하면 잘못된 자동화가 가능. | citation-derived `targets[]` 의 모든 entry는 `role: 'reference'` 마커를 가짐(FR-003). 단위 테스트에서 `role` 값까지 assert. spec.md "Citation-derived target" 엔터티로 어휘 차이를 문서화. README/DESIGN 갱신은 별도 Task 9에서. |
| Compact `explore_repo` 응답에 누수 | 새 helper가 `explore_repo` 경로에서도 호출되면 compact contract에 unexpected `citations` 가 추가됨. | helper 호출은 `freeExplore` / `freeExploreV2` 반환부에만 배치. `explore_repo` 경로(`callTool`)에는 어떤 호출도 추가하지 않음. mcp-server 테스트의 기존 compact response snapshot이 무변동인지 확인. |
| V2 max-output-recovery 중 인용 변화 | recovery 단계에서 `report` 가 여러 번 갱신될 때 citation을 중간 단계에서 미리 캐시하면 stale. | citation은 **최종 확정된 `report`** 직후, return 직전에 단일 계산. 중간 변수 캐싱 금지. |
| Critic 추출기 동작 변경 유혹 | 정규식 엣지(인용 형식 변형, backtick 변종)에서 누락이 발견되면 추출기 자체를 손대고 싶어짐 — 본 spec 범위 밖. | 본 plan의 변경은 normalization layer만. 추출기 동작 변경은 별도 spec/plan으로. 테스트 픽스처는 기존 추출기가 이미 인식하는 형태(`` `path:Lstart-Lend` ``, `` `path:Ln` ``)만 사용. |

## Test Strategy

신규 테스트 모두 mock `chatClient.createChatCompletion`을 사용한 결정론적 케이스. `makeRepoFixture()` 와 `createMcpRequestHandler()` 패턴 재사용.

### `tests/free-explore.test.mjs`

1. **`freeExplore exposes report citations and citation targets`**
   - Mock client가 한 번의 호출에서 `'Summary cites \`src/auth.js:L1-L3\` and \`src/routes/user.js:L2\`.'` 반환.
   - `result.citations` 가 `[{type:'file_range', path:'src/auth.js', startLine:1, endLine:3}, {type:'file_range', path:'src/routes/user.js', startLine:2, endLine:2}]` 형태 (raw 제외 deep-equal).
   - `result.targets` 가 `[{path:'src/auth.js', startLine:1, endLine:3, role:'reference'}, {path:'src/routes/user.js', startLine:2, endLine:2, role:'reference'}]` 형태.

2. **`freeExplore returns empty citations and targets when report has no citations`**
   - Mock client가 `'No file references here.'` 반환.
   - `result.citations` 와 `result.targets` 모두 `[]` (key 자체는 존재, FR-005 / SC-003).

3. **`freeExploreV2 exposes the same citation shape with transcriptPath preserved`**
   - V2 경로에서도 동일한 픽스처로 `citations[]` / `targets[]` 검증 + `transcriptPath` 가 여전히 string 으로 노출되는지 확인 (V2 contract regression 가드).

4. **`freeExplore deduplicates citation-derived targets by (path, startLine, endLine)`**
   - Report가 동일 file:line range를 두 번 언급하는 경우 `citations[]` 는 2개 entry지만 `targets[]` 는 1개로 dedupe (Edge case "report mentions a path multiple times").

### `tests/mcp-server.test.mjs`

1. **`explore returns Markdown text plus structured citations`**
   - `handleRequest({method:'tools/call', params:{name:'explore', ...}})` 호출.
   - `called.content[0].text` 가 mock Markdown 본문과 byte-identical (SC-004).
   - `called.structuredContent.citations` 가 file_range entry 노출.
   - `called.structuredContent.targets[0].role === 'reference'`.

2. **`explore_v2 also exposes structured citations through structuredContent`**
   - `name: 'explore_v2'` 호출에서 동일 shape 검증.

3. **`explore redacts deny-listed paths consistently in both surfaces`**
   - Mock client가 deny-listed 토큰(예: `'See `.env.production:L1`.'` 같은 redaction 대상 픽스처)을 반환.
   - `called.content[0].text` 와 `called.structuredContent.citations[0].path` 가 동일한 redacted 문자열로 마스킹 (FR-006).
   - Plain path를 가진 다른 인용은 변경 없이 통과.

4. **`explore with empty-citation report exposes citations: [] in structuredContent`**
   - `structuredContent.citations === []` 그리고 `Array.isArray(structuredContent.targets) === true` (SC-003).

전 테스트는 `node --test tests/free-explore.test.mjs tests/mcp-server.test.mjs --test-name-pattern "citations|structured citations|deny-listed"` 로 한 번에 실행 가능해야 하며, 전체 `npm test` 도 0 fail 유지해야 commit 가능 (AGENTS.md 테스트 규칙).

## Complexity Tracking

> Constitution Check가 PASS이므로 비움.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (없음) | — | — |
