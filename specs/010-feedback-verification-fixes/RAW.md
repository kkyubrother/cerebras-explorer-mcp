# Cerebras Explorer MCP 피드백 검증 및 수정 구현 명세서

## 1. 요약

* 검증 대상 클레임 16개: **참 7개, 부분참 8개, 거짓 0개, 검증불가 1개**.
* 코드 기준으로 가장 큰 문제는 `status/complete/nextAction/failure`가 **evidence sufficiency보다 budget exhaustion을 우선**해 좋은 답에도 `complete:false`가 되는 구조입니다.
* Top 5 수정 항목: **상태 계약 재정의**, **`targets[]`/`discoveredPaths[]` 분리와 dedupe**, **env var 이름 보존 redaction**, **git diff scope hard-boundary 보정**, **session/progress/sub-agent handoff 계약 강화**.
* Claude Code의 최우선 3개 제안은 모두 코드상 타당성이 있었고, 각각 Spec-2, Spec-3, Spec-1에 반영했습니다.
* 동적 실행 수치, 예: “47개 target”, “75초/80초”, “cache hit 4.9~6.0%”는 압축본 코드만으로는 재현 검증 불가이므로 구조적 원인만 분리 판정했습니다.

---

## 2. Phase 1 — 코드 사실 인벤토리

### 2.1 노출된 MCP 도구 목록과 개수

사실: 피드백에서 지목한 `src/mcp/server.mjs:17`은 실제로 read-only annotation 상수 시작 위치입니다.
근거: `src/mcp/server.mjs:L17-L22`

```js
const READ_ONLY_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
});
```

사실: 피드백에서 지목한 `src/mcp/server.mjs:33`은 실제로 `explore_repo` 도구 정의 시작 위치입니다.
근거: `src/mcp/server.mjs:L33-L45`

사실: 기본 도구 surface는 `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `explore_repo`, `explore`의 8개입니다. `explore_v2`는 opt-in입니다.
근거: `src/mcp/server.mjs:L298-L318`, `README.md:L98-L106`

사실: 환경변수별 도구 수는 “연속적인 1~9개”가 아니라, 현재 분기상 **1, 2, 3, 7, 8, 9개 조합**이 가능합니다. 기본은 8개, 최소는 1개, 최대는 9개입니다.
근거: `src/mcp/server.mjs:L246-L257`, `src/mcp/server.mjs:L292-L318`, `tests/mcp-server.test.mjs:L555-L623`

```js
function buildToolList() {
  const tools = [];
  if (extraToolsEnabled()) {
    tools.push(
      FIND_RELEVANT_CODE_TOOL,
      TRACE_SYMBOL_TOOL,
      MAP_CHANGE_IMPACT_TOOL,
      EXPLAIN_CODE_PATH_TOOL,
      COLLECT_EVIDENCE_TOOL,
      REVIEW_CHANGE_CONTEXT_TOOL,
    );
  }
  tools.push(EXPLORE_REPO_TOOL);
  if (exploreToolEnabled()) {
    tools.push(EXPLORE_TOOL);
  }
  if (exploreV2ToolEnabled()) {
    tools.push(EXPLORE_V2_TOOL);
  }
  return tools;
}
```

사실: `CEREBRAS_EXPLORER_EXTRA_TOOLS`가 unset이면 wrapper 6개가 켜지고, falsy이면 wrapper 6개가 빠집니다.
근거: `src/mcp/server.mjs:L292-L308`

사실: `CEREBRAS_EXPLORER_ENABLE_EXPLORE`가 unset이면 `explore`가 켜지고, falsy이면 `explore`가 빠집니다. `explore`가 꺼지면 `explore_v2`도 노출될 수 없습니다.
근거: `src/mcp/server.mjs:L246-L257`, `src/mcp/server.mjs:L311-L316`

사실: `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true`일 때만 `explore_v2`가 노출됩니다.
근거: `src/mcp/server.mjs:L252-L257`, `src/mcp/server.mjs:L314-L316`, `README.md:L102-L106`

---

### 2.2 도구 입력/출력 스키마와 주요 필드 정의·생성 위치

사실: 피드백에서 지목한 `src/explorer/schemas.mjs:1`은 실제로 `EXPLORE_REPO_INPUT_SCHEMA` 시작 위치입니다.
근거: `src/explorer/schemas.mjs:L1-L15`

사실: 피드백에서 지목한 `src/explorer/schemas.mjs:269`는 실제로 `EXPLORE_REPO_OUTPUT_SCHEMA` 시작 위치입니다.
근거: `src/explorer/schemas.mjs:L269-L298`

사실: `explore_repo`는 `EXPLORE_REPO_INPUT_SCHEMA`와 `EXPLORE_REPO_OUTPUT_SCHEMA`를 직접 사용합니다. wrapper 6개는 각자 좁은 input schema를 가지지만 output은 모두 `EXPLORE_REPO_OUTPUT_SCHEMA`입니다.
근거: `src/mcp/server.mjs:L33-L45`, `src/mcp/server.mjs:L50-L191`

사실: `explore`와 `explore_v2`는 Markdown report 도구이며, 도구 정의에 `outputSchema`가 없습니다. 대신 call handler가 runtime 결과 전체를 `structuredContent`로 반환합니다.
근거: `src/mcp/server.mjs:L195-L244`, `src/mcp/server.mjs:L699-L721`, `src/explorer/runtime.mjs:L1954-L1964`, `src/explorer/runtime.mjs:L2441-L2452`

사실: `status`는 `confidence`, `verification`, `complete`, `warnings`를 필수 필드로 갖고, `verification` enum은 `verified`, `targeted_read_needed`, `follow_up_needed`, `broad_search_needed`입니다.
근거: `src/explorer/schemas.mjs:L69-L82`

사실: `targets[]` item의 role enum은 `edit`, `read`, `test`, `config`, `context`, `reference`뿐입니다. `discovered` role은 현재 코드에 없습니다.
근거: `src/explorer/schemas.mjs:L84-L96`, `src/explorer/schemas.mjs:L399-L415`

사실: `nextAction.type` enum은 `stop`, `read_target`, `explore_followup`, `ask_user`입니다.
근거: `src/explorer/schemas.mjs:L98-L108`, `src/explorer/schemas.mjs:L437-L451`

사실: `failure.reason`에는 `budget_exhausted`, `tool_errors`, `aborted`, `invalid_session`, `repo_mismatch`, `invalid_arguments`, `provider_error`, `access_denied`, `invalid_final_response`가 포함됩니다.
근거: `src/explorer/schemas.mjs:L161-L184`

사실: `evidenceQuality`는 `level`, `exactCount`, `partialCount`, `droppedCount`, `fileCount`, `warnings`, `summary`를 필수 필드로 갖습니다. 생성 시 `level`은 `result.status.confidence`에서 가져옵니다.
근거: `src/explorer/schemas.mjs:L186-L199`, `src/explorer/runtime.mjs:L423-L440`

사실: `searchCoverage`는 scope, read/grep/listDir/symbol call count, truncation, stopped-by-budget, warnings, summary를 포함합니다. 생성 위치는 `buildSearchCoverage(stats)`입니다.
근거: `src/explorer/schemas.mjs:L212-L239`, `src/explorer/runtime.mjs:L442-L472`

사실: `evidence[]`는 file/git evidence를 표현하며, runtime은 모델이 준 snippet을 그대로 신뢰하지 않고 실제 파일에서 snippet을 다시 읽어 붙입니다.
근거: `src/explorer/schemas.mjs:L241-L267`, `src/explorer/runtime.mjs:L612-L626`

사실: `citations[]`는 `explore_repo` output schema에는 없고, report 도구인 `explore`/`explore_v2`의 runtime 반환값에 포함됩니다.
근거: `src/explorer/runtime.mjs:L474-L500`, `src/explorer/runtime.mjs:L1954-L1964`, `src/explorer/runtime.mjs:L2441-L2452`, `README.md:L178-L178`

사실: `sessionId`와 `session`은 `EXPLORE_REPO_OUTPUT_SCHEMA`에 optional property로 있고, MCP 응답 조립 시 `toAgentFacingResult()`가 붙입니다.
근거: `src/explorer/schemas.mjs:L293-L295`, `src/mcp/server.mjs:L650-L675`

사실: `_debug`는 output schema상 자유 객체이며, runtime은 confidence score/factors, stats, toolTrace, codeMap을 넣습니다.
근거: `src/explorer/schemas.mjs:L296-L296`, `src/explorer/runtime.mjs:L856-L866`

---

### 2.3 runtime 구조: budget, turn 한계, stopped_by_budget, retry/fallback

사실: budget 정의는 `quick`, `normal`, `deep` 3개이며 turn 한계는 각각 10, 20, 30입니다.
근거: `src/explorer/config.mjs:L155-L195`

사실: 자동 budget 선택은 anchor가 있거나 locate/find/definition 성격이면 `quick`, architecture/impact/root cause 등은 `normal`, 단일 scope도 `quick`입니다.
근거: `src/explorer/config.mjs:L345-L369`

사실: runtime 초기화는 인자 budget, project config default, auto budget 순으로 effective budget을 정합니다.
근거: `src/explorer/runtime.mjs:L1187-L1193`

사실: `explore_repo` 루프는 `turnIndex < budgetConfig.maxTurns` 동안만 실행됩니다.
근거: `src/explorer/runtime.mjs:L1328-L1335`

사실: final object 없이 loop가 끝나면 `stats.stoppedByBudget = true`가 되고, “Budget exhausted — synthesizing partial answer...” progress가 발생합니다.
근거: `src/explorer/runtime.mjs:L1597-L1619`

사실: `stats.stoppedByBudget`이면 `buildFailure()`는 `failure.reason='budget_exhausted'`를 만듭니다.
근거: `src/explorer/runtime.mjs:L526-L565`

사실: `buildResultStatus()`는 `stats.stoppedByBudget`만으로 `verification='follow_up_needed'`를 선택할 수 있으며, `complete`는 `verified` 또는 `targeted_read_needed`일 때만 true입니다.
근거: `src/explorer/runtime.mjs:L806-L828`

사실: retry hint는 `buildFailure()`에서 `failure.retry`에 들어갑니다. budget exhaustion retry는 “narrower scope or more specific task”를 제안합니다.
근거: `src/explorer/runtime.mjs:L554-L562`

---

### 2.4 세션 관리

사실: 세션 ID는 `sess_` + 8 random bytes hex입니다.
근거: `src/explorer/session.mjs:L18-L20`

사실: 세션 저장소는 `SessionStore` 인스턴스 내부의 in-memory `Map`입니다. 기본 TTL은 30분, 기본 최대 호출 수는 5회입니다.
근거: `src/explorer/session.mjs:L3-L7`, `src/explorer/session.mjs:L61-L69`

사실: 명시적 `session` 인자가 있으면 repoRoot 일치, TTL, exhaustion을 검사한 뒤 `reused` 또는 `fallback`/오류가 됩니다.
근거: `src/explorer/runtime.mjs:L1023-L1080`, `src/explorer/session.mjs:L195-L221`

사실: 명시적 `session` 인자가 없으면 같은 repoRoot라도 자동 재사용하지 않고 새 세션을 만듭니다.
근거: `src/explorer/runtime.mjs:L1070-L1080`

사실: feedback의 “cache hit rate”는 세션 재사용률이 아니라 `globalRepoCache.stats()`의 LRU cache hit/miss 통계입니다.
근거: `src/explorer/cache.mjs:L11-L18`, `src/explorer/cache.mjs:L76-L89`, `src/explorer/runtime.mjs:L1622-L1623`

---

### 2.5 MCP 서버: annotation, 등록, validation, redaction

사실: 모든 공개 MCP tool은 `readOnlyHint:true`, `destructiveHint:false`, `idempotentHint:true`, `openWorldHint:true` annotation을 붙입니다.
근거: `src/mcp/server.mjs:L17-L29`, `tests/mcp-server.test.mjs:L167-L174`, `tests/mcp-server.test.mjs:L555-L623`

사실: `validatePublicToolArgs()`는 public tool input schema 기준으로 required, unknown key, string/array/enum 검사를 수행합니다.
근거: `src/mcp/server.mjs:L330-L356`

사실: wrapper 도구 호출은 validate 후 builder로 `explore_repo` args를 만들고 `callTool()`로 들어갑니다.
근거: `src/mcp/server.mjs:L787-L809`

사실: `callTool()`은 `exploreRepository()` 실행 결과를 `toAgentFacingResult()`로 compact contract에 맞춘 뒤 `redactExploreResult()`를 적용합니다.
근거: `src/mcp/server.mjs:L650-L675`, `src/mcp/server.mjs:L678-L697`

사실: `explore`/`explore_v2` report 도구는 `redactValue(result)`로 전체 결과를 재귀 redaction한 뒤 Markdown text와 structuredContent를 반환합니다.
근거: `src/mcp/server.mjs:L699-L742`

---

### 2.6 wrapper 6개 + `explore` + `explore_repo` + 조건부 `explore_v2` call graph

사실: `find_relevant_code`는 `buildFindRelevantCodeArgs()`로 `taskMode:'locate'`를 붙여 `exploreRepository()`에 위임합니다.
근거: `src/mcp/server.mjs:L387-L401`, `src/mcp/server.mjs:L787-L790`, `src/explorer/runtime.mjs:L2531-L2535`

사실: `trace_symbol`은 `taskMode:'symbol_trace'`, `hints.strategy:'symbol-first'`, `hints.symbols:[symbol]`을 붙여 `exploreRepository()`에 위임합니다.
근거: `src/mcp/server.mjs:L374-L385`, `src/mcp/server.mjs:L791-L794`, `src/explorer/runtime.mjs:L2531-L2535`

사실: `map_change_impact`는 `taskMode:'edit_planning'`, `hints.strategy:'reference-chase'`를 붙입니다.
근거: `src/mcp/server.mjs:L403-L417`

사실: `explain_code_path`는 `taskMode:'path_explanation'`, `hints.strategy:'reference-chase'`를 붙입니다.
근거: `src/mcp/server.mjs:L419-L435`

사실: `collect_evidence`는 `taskMode:'evidence_verification'`을 붙입니다.
근거: `src/mcp/server.mjs:L437-L451`

사실: `review_change_context`는 `taskMode:'change_review'`, `hints.strategy:'git-guided'`를 붙입니다.
근거: `src/mcp/server.mjs:L453-L470`

사실: `explore`는 `shouldUseV2ForExplore()`가 true이면 내부적으로 `freeExploreRepositoryV2`, 아니면 `freeExploreRepository`를 호출합니다.
근거: `src/mcp/server.mjs:L699-L721`

사실: `explore_v2`는 공개 도구로 opt-in 노출될 때만 직접 `freeExploreRepositoryV2()`를 호출합니다.
근거: `src/mcp/server.mjs:L723-L742`, `src/mcp/server.mjs:L252-L257`

---

### 2.7 redaction 규칙

사실: redaction은 API key/PAT/JWT/private key block 등 값 패턴을 `[REDACTED:<rule>]`로 바꿉니다.
근거: `src/explorer/redact.mjs:L3-L16`, `src/explorer/redact.mjs:L33-L49`

사실: secret path mention regex는 `.env`, `.env.*`, `.envrc`, `.npmrc`, `.netrc`, `id_rsa`, `id_ed25519` 및 slash 포함 path-like token을 잡고, `isSecretPath()`와 매칭되면 `[REDACTED:secret-path]`로 바꿉니다.
근거: `src/explorer/redact.mjs:L23-L23`, `src/explorer/redact.mjs:L51-L57`, `src/explorer/security.mjs:L43-L110`, `src/explorer/security.mjs:L121-L137`

사실: object key 자체는 redaction하지 않고, object value만 재귀 redaction합니다. 따라서 환경변수 “키 필드명”이 아니라 snippet/report 문자열 안의 `process.env.X` 같은 텍스트가 secret path regex에 걸리는 문제가 발생합니다.
근거: `src/explorer/redact.mjs:L66-L106`

---

### 2.8 quoted line number 확인

사실: 외부 피드백의 라인 지목 중 `src/mcp/server.mjs:17`, `src/mcp/server.mjs:33`, `src/explorer/schemas.mjs:1`, `src/explorer/schemas.mjs:269`, `README.md:98`, `README.md:169`는 모두 압축본 내 실제 위치와 일치합니다.
근거: `src/mcp/server.mjs:L17-L22`, `src/mcp/server.mjs:L33-L45`, `src/explorer/schemas.mjs:L1-L15`, `src/explorer/schemas.mjs:L269-L298`, `README.md:L98-L106`, `README.md:L169-L178`

---

## 3. Phase 2 — 피드백 항목 분해

출처 표기:

* F1: 첫 번째 Codex 8개 도구 직접 호출 피드백
* F2: 두 번째 Codex sub-agent + `explore_repo` 피드백
* F3: 세 번째 Codex 7개 도구 피드백
* F4: 네 번째 Codex 부정적 종합 피드백
* F5: Claude Code 9개 경로 피드백

| ID  | 클레임 한 줄 요약                                                                                                                         | 출처             | 코드상 확인해야 할 파일/심볼                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `confidence=high`와 `verification=follow_up_needed`, `complete=false`, `nextAction=ask_user`가 함께 나올 수 있어 상태 의미가 충돌한다.               | F3, F4         | `runtime.mjs/buildResultStatus`, `buildNextAction`, `buildEvidenceQuality`; `schemas.mjs/STATUS_SCHEMA`                         |
| C2  | `trace_symbol`이 파일을 읽지 않고 symbol index만으로 끝나 `evidenceQuality=medium`에 머물 수 있다.                                                    | F3, F4, F5     | `server.mjs/buildTraceSymbolArgs`, `prompt.mjs`, `repo-tools.mjs/symbolContext`, `critic.mjs`                                   |
| C3  | `explain_code_path`가 quick budget을 소진하고 `budget_exhausted`로 끝날 수 있다.                                                               | F1, F3, F4, F5 | `config.mjs/BUDGETS`, `chooseAutoBudget`, `runtime.mjs/stoppedByBudget`, `buildFailure`                                         |
| C4  | wrapper 6개는 실질적으로 `explore_repo`에 위임되는 prompt/template layer다.                                                                     | F2, F3, F4     | `server.mjs/build*Args`, wrapper dispatch, README 공개 도구 설명                                                                      |
| C5  | `review_change_context`의 `scope`가 hard limit인지 hint인지 불명확하고, scope 밖 `specs/**`, `.specify/**`가 결과에 섞일 수 있다.                       | F3, F4         | `repo-tools.mjs` scope enforcement, `gitDiff`, `gitShow`, `DESIGN.md` scope contract                                            |
| C6  | `explore` Markdown report가 truncation/critic caution 상태에서도 그럴듯해 보여 위험하다.                                                           | F1, F3, F4, F5 | `server.mjs/callFreeExploreTool`, `runtime.mjs/freeExplore/freeExploreV2`, `critic.mjs/buildReportCritic`, `DESIGN.md` V2 gates |
| C7  | `nextAction`이 `ask_user`로 과다 fallback하거나 `read_target`이 너무 일반적이다.                                                                  | F3, F4         | `runtime.mjs/buildNextAction`                                                                                                   |
| C8  | 도구 surface가 환경변수에 따라 기본 8개, 최소 1개, 최대 9개로 바뀌어 agent mental model이 흔들린다.                                                            | F2, F4         | `server.mjs/exploreToolEnabled`, `exploreV2ToolEnabled`, `extraToolsEnabled`, `buildToolList`; README                           |
| C9  | `targets[]`에 `evidenceRefs:[]`인 discovered path가 다수 섞여 노이즈가 된다.                                                                    | F5             | `runtime.mjs/buildTargets`, `repo-tools.mjs/collectTargetPathsFromToolResult`, `schemas.mjs/TARGET_ITEM_SCHEMA`                 |
| C10 | `explore` report의 `targets[]`가 citation별로 중복 누적되어 같은 파일이 여러 번 들어갈 수 있다.                                                            | F5             | `runtime.mjs/buildReportCitationTargets`, `buildReportCitations`, report return path                                            |
| C11 | redaction이 과도해 환경변수 이름까지 `[REDACTED:secret-path]`로 가린다.                                                                            | F5             | `redact.mjs/SECRET_PATH_MENTION_REGEX`, `redactText`, `redactValue`, `security.mjs/isSecretPath`                                |
| C12 | 세션 재사용률이 낮고, `sessionId` 전달 없이는 자동 연결이 없다.                                                                                         | F2, F5         | `runtime.mjs/resolveSessionForExplore`, `session.mjs/SessionStore`, `cache.mjs/stats`, README session guidance                  |
| C13 | `complete:false` 기준이 turn budget 소진에 과도하게 묶여 evidence 충족도를 무시한다.                                                                   | F5, F4         | `runtime.mjs/buildResultStatus`, `buildFailure`, `critic.mjs/computeConfidenceScore`                                            |
| C14 | 70~80초 무거운 호출에서 `progressToken` 사용 가시성이 중요하다.                                                                                      | F5             | `server.mjs/makeProgressCallback`, initialize instructions, runtime progress calls, README/Codex instructions                   |
| C15 | `repo_list_dir` 결과가 자동 reference target에 들어가 `.gitignore`, `.github`, `.specify/extensions.yml` 같은 노이즈가 생길 수 있다.                   | F5             | `repo-tools.mjs/collectTargetPathsFromToolResult`, `runtime.mjs/buildTargets`, `config.mjs/DEFAULT_IGNORE_DIRS`                 |
| C16 | sub-agent 경로에서 `status.verification`, `evidenceQuality`, `searchCoverage`, `failure`, `session` 같은 구조화 메타데이터가 자연어 요약 중 누락될 위험이 있다. | F2, F5         | 직접 MCP result path, README agent instructions, AGENTS.md; sub-agent 구현 존재 여부                                                    |

---

## 4. Phase 3 — 클레임별 판정 카드

### C1

**판정: 참**

**근거 코드:** `src/explorer/runtime.mjs:L423-L440`, `src/explorer/runtime.mjs:L806-L854`

**근거 인용:**

```js
function buildEvidenceQuality(result, stats, grounding = {}) {
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const exactCount = evidence.filter(item => item.groundingStatus === 'exact').length;
  ...
  return {
    level: result.status?.confidence ?? 'low',
    exactCount,
    partialCount,
    droppedCount,
    fileCount,
    warnings,
    summary,
  };
}
```

```js
} else if (criticStatus === 'caution' || result.status?.confidence === 'low' || stats.stoppedByBudget) {
  verification = 'follow_up_needed';
}
...
return {
  confidence: result.status?.confidence ?? 'low',
  verification,
  complete: verification === 'verified' || verification === 'targeted_read_needed',
  warnings,
};
```

```js
if (verification === 'follow_up_needed' || verification === 'broad_search_needed') {
  const modelNextAction = result.nextAction?.type === 'explore_followup' || result.nextAction?.type === 'ask_user'
    ? result.nextAction
    : null;
  return {
    type: modelNextAction?.type ?? 'ask_user',
    reason: modelNextAction?.reason || 'The retained evidence is not sufficient for a complete answer.',
```

**판정 이유:** `evidenceQuality.level`은 `status.confidence`를 그대로 사용합니다. 반면 `verification`은 `criticStatus === 'caution'` 또는 `stats.stoppedByBudget`이면 `follow_up_needed`가 됩니다. 따라서 `confidence:'high'`, `evidenceQuality.level:'high'`, `verification:'follow_up_needed'`, `complete:false`, `nextAction.type:'ask_user'` 조합은 코드상 실제로 가능합니다.

**주의:** 이 충돌은 schema 정의의 문제가 아니라 runtime 조립 로직의 문제입니다. `STATUS_SCHEMA` 자체는 enum만 정의합니다. 근거: `src/explorer/schemas.mjs:L69-L82`

---

### C2

**판정: 부분참**

**근거 코드:** `src/mcp/server.mjs:L374-L385`, `src/explorer/prompt.mjs:L287-L302`, `src/explorer/repo-tools.mjs:L907-L964`

**근거 인용:**

```js
function buildTraceSymbolArgs(args) {
  ...
  return {
    task, repo_root, scope, session,
    taskMode: 'symbol_trace',
    hints: { symbols: [symbol.trim()], strategy: 'symbol-first' },
  };
}
```

```js
'symbol-first': 'Start with repo_symbol_context(symbol). If no result, fall back to repo_grep(symbol) → repo_read_file for top matches.',
```

```js
// Step 3: read definition body
try {
  const endLine = definition.endLine ?? definition.line + 60;
  const readResult = await this.readFile({
    path: definition.path,
    startLine: definition.line,
    endLine,
  });
  definition = { ...definition, content: readResult.content };
} catch { /* skip body read */ }
```

**판정 이유:** `trace_symbol`은 `symbol-first` 전략으로 시작하며, prompt는 `repo_symbol_context(symbol)`를 우선 호출하라고 지시합니다. `repo_symbol_context`는 definition을 찾으면 실제로 `readFile()`로 definition body를 읽습니다. 따라서 “trace_symbol은 구조상 파일을 읽지 않는다”는 말은 거짓입니다. 다만 fallback이나 모델 선택에 따라 `repo_symbols`/`repo_references` 중심으로 얕게 끝날 수 있고, runtime은 “최종 answer 전에 read_file이 반드시 있어야 한다”는 hard requirement를 두지 않습니다. 그래서 “그런 결과가 나올 수 있다”는 부분은 코드상 가능성이 있습니다.

**주의:** 피드백의 특정 실행 결과, 예: “파일 read 없이 symbol index만으로 끝났다”는 해당 실행의 `_debug.toolTrace`가 없으면 압축본 코드만으로 재현 검증할 수 없습니다.

---

### C3

**판정: 부분참**

**근거 코드:** `src/explorer/config.mjs:L155-L195`, `src/explorer/config.mjs:L345-L369`, `src/explorer/runtime.mjs:L1597-L1619`, `src/explorer/runtime.mjs:L526-L565`

**근거 인용:**

```js
quick: {
  label: 'quick',
  maxTurns: 10,
  maxSearchResults: 20,
  maxReadLines: 140,
  ...
},
normal: {
  label: 'normal',
  maxTurns: 20,
```

```js
if (hasAnchors) return 'quick';
...
if (Array.isArray(scope) && scope.length === 1 && typeof scope[0] === 'string' && scope[0].trim()) {
  return 'quick';
}
```

```js
stats.stoppedByBudget = !stats.stoppedByErrors && !stats.stoppedByAbort;
...
message: 'Budget exhausted — synthesizing partial answer...',
```

```js
if (stats.stoppedByBudget) {
  return makeFailure('execution', 'budget_exhausted', 'Exploration stopped at the turn budget before all follow-up checks were exhausted.', {
```

**판정 이유:** quick budget은 10턴이고, known anchors 또는 단일 scope가 있으면 auto budget이 quick으로 갈 수 있습니다. `explain_code_path`는 `reference-chase` wrapper라 복잡한 흐름에서는 10턴을 소진할 수 있고, 소진 시 `failure.reason='budget_exhausted'`가 붙는 로직도 실제로 있습니다.

**주의:** “이번 실행에서 explain_code_path가 budget_exhausted였다”는 동적 실행 결과이므로 코드만으로는 검증 불가입니다. 그러나 그 상태가 발생하는 정적 경로는 명확합니다.

---

### C4

**판정: 참**

**근거 코드:** `src/mcp/server.mjs:L374-L470`, `src/mcp/server.mjs:L787-L809`, `src/explorer/runtime.mjs:L2531-L2535`, `README.md:L169-L178`

**근거 인용:**

```js
if (name === 'trace_symbol') {
  validatePublicToolArgs(TRACE_SYMBOL_TOOL, args);
  return await callTool(buildTraceSymbolArgs(args), progressToken, requestId);
}
...
if (name === 'review_change_context') {
  validatePublicToolArgs(REVIEW_CHANGE_CONTEXT_TOOL, args);
  return await callTool(buildReviewChangeContextArgs(args), progressToken, requestId);
}
```

```js
export async function exploreRepository(args, options = {}) {
  const { onProgress, sessionStore, abortSignal, ...runtimeOptions } = options;
  const runtime = new ExplorerRuntime(runtimeOptions);
  return runtime.explore(args, { onProgress, sessionStore, abortSignal });
}
```

**판정 이유:** wrapper 6개는 각자 public input schema와 builder를 가진 뒤, 모두 `callTool()` → `exploreRepository()` → `ExplorerRuntime.explore()`로 들어갑니다. README도 “목적형 wrapper 6개는 모두 내부적으로 `explore_repo`에 위임”한다고 명시합니다. 근거: `README.md:L173-L174`

**주의:** “프롬프트 템플릿일 뿐”이라는 표현은 과장될 수 있습니다. wrapper는 input schema, taskMode, hints.strategy, known anchors를 다르게 구성합니다. 그러나 실행 엔진은 동일합니다.

---

### C5

**판정: 부분참**

**근거 코드:** `src/explorer/repo-tools.mjs:L556-L615`, `src/explorer/repo-tools.mjs:L1055-L1084`, `src/explorer/repo-tools.mjs:L1167-L1223`, `DESIGN.md:L523-L533`

**근거 인용:**

```js
if (!effectiveScope.mayContain(relativeDir)) {
  throw new Error(`Directory is outside current scope: ${relativeDir}`);
}
...
if (!effectiveScope.matches(relPosix)) {
  continue;
}
```

```js
_filterGitDiffFiles(files, { enforceScope = false } = {}) {
  return files
    .filter(file => {
      if (isSecretDiffFile(file)) return false;
      if (enforceScope && this.baseScopeRules.patterns?.length > 0) {
        return this.baseScopeRules.matches(file.path);
      }
      return true;
```

```js
const files = this._filterGitDiffFiles(parseDiffOutput(output));
return { from: safeFrom, to: safeTo, files };
...
const files = this._filterGitDiffFiles(parseDiffOutput(patchOutput), { enforceScope: true });
```

**판정 이유:** 대부분의 repo tools는 scope를 hard boundary로 enforce합니다. `listDirectory`, `readFile`, `symbols`, `gitShow`는 scope 밖을 막거나 필터링합니다. 그러나 `gitDiff()`는 `_filterGitDiffFiles()`를 `enforceScope:true` 없이 호출하므로, base scope가 있어도 diff files가 scope 밖을 포함할 수 있습니다. 따라서 “scope가 hint처럼 동작할 수 있다”는 피드백은 `repo_git_diff` 경로에 한해 타당합니다.

**주의:** 피드백이 “scope 전체가 hint다”라고 읽힌다면 틀립니다. DESIGN은 scope를 hard boundary로 문서화하고 있습니다. 근거: `DESIGN.md:L523-L533`

---

### C6

**판정: 참**

**근거 코드:** `src/mcp/server.mjs:L699-L721`, `src/explorer/runtime.mjs:L1899-L1964`, `src/explorer/runtime.mjs:L2253-L2257`, `src/explorer/critic.mjs:L507-L532`, `DESIGN.md:L511-L518`

**근거 인용:**

```js
const safeResult = redactValue(result).value;
return {
  content: [{ type: 'text', text: safeResult.report }],
  structuredContent: safeResult,
};
```

```js
const critic = buildReportCritic({ report, filesRead: reportFilesRead, stats });
const citations = buildReportCitations(report);
const targets = buildReportCitationTargets(citations);
...
return {
  report,
  citations,
  targets,
  filesRead: reportFilesRead,
  toolsUsed: [...toolsUsed],
  stats,
  critic,
  searchCoverage: buildSearchCoverage(stats),
```

```js
if (stats?.stoppedByBudget) {
  warnings.push({
    type: 'budget_exhausted',
    severity: 'medium',
    message: 'Exploration stopped at the configured turn budget.',
```

```js
if ((stats?.toolResultsTruncated ?? 0) > 0) {
  warnings.push({
    type: 'truncated_tool_results',
    severity: 'low',
```

**판정 이유:** report text는 그대로 `content[0].text`로 반환되고, caution/truncation/budget warning은 `structuredContent.critic`와 `searchCoverage`에 분리되어 있습니다. 사용자가 Markdown만 읽으면 caution signal을 놓칠 수 있습니다. V2는 tool result truncation을 stats에 기록하고 critic warning도 만들지만, Markdown 본문 자체가 자동으로 “불완전” 배지를 갖는 것은 아닙니다.

**주의:** “truncation 경고가 있었다”는 특정 실행 결과는 코드만으로 재현할 수 없지만, truncation/caution이 structuredContent에만 담기는 위험 구조는 코드상 확인됩니다.

---

### C7

**판정: 부분참**

**근거 코드:** `src/explorer/runtime.mjs:L830-L854`

**근거 인용:**

```js
if (verification === 'targeted_read_needed') {
  const target = (result.targets ?? []).find(item => item.role === 'edit') ??
    (result.targets ?? []).find(item => item.role === 'read') ??
    result.targets?.[0];
  const targetReason = target?.role === 'edit' ? 'before editing' : 'before final verification';
  return {
    type: 'read_target',
    reason: target ? `Read ${target.path}${target.startLine ? `:${target.startLine}-${target.endLine}` : ''} ${targetReason}.` : 'Read the cited target before editing.',
```

```js
if (verification === 'follow_up_needed' || verification === 'broad_search_needed') {
  const modelNextAction = result.nextAction?.type === 'explore_followup' || result.nextAction?.type === 'ask_user'
    ? result.nextAction
    : null;
  return {
    type: modelNextAction?.type ?? 'ask_user',
    reason: modelNextAction?.reason || 'The retained evidence is not sufficient for a complete answer.',
```

**판정 이유:** `follow_up_needed`/`broad_search_needed`에서 모델이 `explore_followup` 또는 `ask_user`를 주지 않으면 기본값은 무조건 `ask_user`입니다. `read_target`도 첫 edit/read target을 고르는 단순 heuristic입니다. 따라서 “ask_user fallback이 과하고 read_target이 일반적”이라는 사용성 문제는 코드 구조와 맞습니다.

**주의:** “항상 실용적이지 않다”는 품질 평가는 정량 지표가 없으므로 부분참으로 판정했습니다. 코드상 확인되는 것은 fallback 구조입니다.

---

### C8

**판정: 참**

**근거 코드:** `src/mcp/server.mjs:L246-L257`, `src/mcp/server.mjs:L292-L318`, `README.md:L98-L106`, `tests/mcp-server.test.mjs:L555-L623`

**근거 인용:**

```js
function exploreV2ToolEnabled() {
  if (!exploreToolEnabled()) return false;
  const v = process.env.CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2;
  if (v === undefined || v === null) return false;
  return isTruthyEnv(v);
}
```

```js
function extraToolsEnabled() {
  const v = process.env.CEREBRAS_EXPLORER_EXTRA_TOOLS;
  if (v === undefined || v === null) return true;
  return isTruthyEnv(v);
}
```

```md
| 기본값 | `explore_repo` + extras 6개 + `explore` | 8 |
| 최소 | `CEREBRAS_EXPLORER_EXTRA_TOOLS=false`와 `CEREBRAS_EXPLORER_ENABLE_EXPLORE=false` | 1 |
| 최대 | 기본값 + `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true` | 9 |
```

**판정 이유:** 도구 surface는 실제로 환경변수에 따라 달라집니다. README와 테스트도 기본/최소/최대 조합을 명시합니다. 이는 MCP client나 agent prompt가 고정 toolset을 가정하기 어렵게 할 수 있습니다.

**주의:** “1~9개”라는 표현이 모든 숫자 조합을 의미한다면 부정확합니다. 코드상 가능한 대표 조합은 1, 2, 3, 7, 8, 9개입니다.

---

### C9

**판정: 참**

**근거 코드:** `src/explorer/runtime.mjs:L691-L734`, `src/explorer/repo-tools.mjs:L1630-L1676`, `src/explorer/schemas.mjs:L84-L96`

**근거 인용:**

```js
for (const discoveredPath of discoveredPaths) {
  const normalizedDiscoveredPath = normalizeTargetPath(discoveredPath);
  if (!normalizedDiscoveredPath || evidencePaths.has(normalizedDiscoveredPath)) continue;
  addTarget({
    path: discoveredPath,
    role: 'reference',
    reason: 'Discovered path; read only if the cited evidence does not answer the edit or verification need.',
    evidenceRefs: [],
  });
}
```

```js
case 'repo_list_dir':
  return Array.isArray(result.entries) ? result.entries.map(entry => entry.path).filter(Boolean) : [];
...
case 'repo_git_diff':
case 'repo_git_show':
  return Array.isArray(result.files) ? result.files.map(f => f.path).filter(Boolean) : [];
```

**판정 이유:** `collectTargetPathsFromToolResult()`가 tool result에서 discovered paths를 모으고, runtime의 `buildTargets()`가 grounded evidence path가 아닌 discovered path를 `role:'reference'`, `evidenceRefs:[]` target으로 승격합니다. schema에는 이를 분리할 `discoveredPaths[]`가 없습니다.

**주의:** “9개 들어 있었다”는 특정 수량은 실행 trace가 없으므로 코드만으로 검증할 수 없습니다. 그러나 empty evidenceRefs reference target이 생기는 구조는 명확합니다.

---

### C10

**판정: 부분참**

**근거 코드:** `src/explorer/runtime.mjs:L474-L524`, `src/explorer/runtime.mjs:L1934-L1964`, `src/explorer/runtime.mjs:L2417-L2452`

**근거 인용:**

```js
function buildReportCitationTargets(citations = []) {
  const targets = [];
  const seen = new Set();

  for (const citation of citations) {
    if (!citation?.path) continue;
    const key = `${citation.path}:${citation.startLine ?? ''}:${citation.endLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
```

```js
const target = {
  path: citation.path,
  role: 'reference',
  reason: 'Markdown report citation',
  evidenceRefs: [],
};
if (Number.isInteger(citation.startLine)) target.startLine = citation.startLine;
if (Number.isInteger(citation.endLine)) target.endLine = citation.endLine;
targets.push(target);
```

**판정 이유:** report target은 `path:startLine:endLine` 단위로 dedupe합니다. 따라서 동일 파일이라도 다른 line range citation이 여러 개면 여러 target이 됩니다. “파일 단위 dedupe + range 병합이 없다”는 지적은 맞습니다.

**주의:** “47개까지 들어갔다”는 특정 개수는 실행 결과 없이는 검증 불가입니다. 또한 “dedupe가 전혀 없다”는 말은 부정확합니다. exact path+range dedupe는 있습니다.

---

### C11

**판정: 부분참**

**근거 코드:** `src/explorer/redact.mjs:L23-L64`, `src/explorer/redact.mjs:L66-L106`, `src/explorer/security.mjs:L43-L137`

**근거 인용:**

```js
const SECRET_PATH_MENTION_REGEX = /`?([A-Za-z0-9_.-][A-Za-z0-9_./\\-]*\/[A-Za-z0-9_./\\-]+|\.env(?:\.[A-Za-z0-9_.-]+)?|\.envrc|\.npmrc|\.netrc|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?)(?::L?\d+(?:-L?\d+)?)?`?/g;
```

```js
text = text.replace(SECRET_PATH_MENTION_REGEX, (raw, relPath) => {
  if (!isSecretPath(relPath).matched) return raw;
  secretPathMatched = true;
  return '[REDACTED:secret-path]';
});
```

```js
for (const [key, item] of Object.entries(value)) {
  const result = redactValue(item, options);
  redactions.push(...result.redactions);
  next[key] = result.value;
}
```

**판정 이유:** object key는 redaction하지 않습니다. 따라서 “환경변수 이름 필드 자체를 가린다”는 말은 부정확합니다. 그러나 snippet/report 문자열 안의 `process.env.CEREBRAS_API_KEY`는 `.env.CEREBRAS_API_KEY` 부분이 secret path regex의 `.env(?:...)` 대안에 걸릴 수 있으므로, 코드 인터페이스인 env var 접근 텍스트가 `[REDACTED:secret-path]`로 사라지는 문제는 실제로 코드상 존재합니다.

**주의:** 이 문제는 value redaction과 path mention redaction 경계가 섞인 버그입니다. secret value redaction을 완화하자는 뜻은 아닙니다.

---

### C12

**판정: 부분참**

**근거 코드:** `src/explorer/runtime.mjs:L1023-L1080`, `src/explorer/session.mjs:L61-L97`, `src/explorer/session.mjs:L195-L221`, `src/explorer/cache.mjs:L76-L89`, `README.md:L275-L276`, `README.md:L591-L591`

**근거 인용:**

```js
if (trimmedId) {
  // Explicit session requested — validate it
  const validation = sessionStore.validateForReuse(trimmedId, repoRoot);
  ...
  return {
    ok: true,
    sessionId: trimmedId,
    sessionData: validation.session,
    sessionStatus: 'reused',
    remainingCalls: validation.remainingCalls,
  };
}
...
// No session requested — create a new one
const newId = sessionStore.create(repoRoot);
```

```js
stats() {
  const total = this.hits + this.misses;
  return {
    cacheHits: this.hits,
    cacheMisses: this.misses,
    cacheHitRate: total > 0 ? Math.round((this.hits / total) * 1000) / 1000 : 0,
```

**판정 이유:** 명시적 `session`이 없으면 같은 repoRoot라도 새 세션을 생성합니다. 따라서 “sessionId 전달 없이는 자동 연결 부재”는 참입니다. 그러나 피드백의 “cache hit rate 4.9~6.0%”를 세션 재사용률로 해석한 부분은 코드상 맞지 않습니다. cache hit rate는 LRU repo tool cache 통계입니다.

**주의:** 세션 재사용률을 측정하려면 `stats.sessionStatus` 또는 `session.status`의 `created/reused/fallback` 비율을 별도로 집계해야 합니다.

---

### C13

**판정: 참**

**근거 코드:** `src/explorer/runtime.mjs:L806-L828`, `src/explorer/runtime.mjs:L526-L565`, `src/explorer/critic.mjs:L160-L245`

**근거 인용:**

```js
} else if (criticStatus === 'caution' || result.status?.confidence === 'low' || stats.stoppedByBudget) {
  verification = 'follow_up_needed';
}
...
complete: verification === 'verified' || verification === 'targeted_read_needed',
```

```js
if (stats.stoppedByBudget) {
  return makeFailure('execution', 'budget_exhausted', 'Exploration stopped at the turn budget before all follow-up checks were exhausted.', {
```

**판정 이유:** `stats.stoppedByBudget`가 true이면 evidence가 충분한지와 무관하게 `verification='follow_up_needed'`, `complete:false`가 됩니다. `buildFailure()`도 budget exhaustion failure를 만듭니다. confidence scoring에는 evidence count, file count, search usage 등이 반영되지만, 최종 complete 판정은 budget flag에 의해 뒤집힙니다.

**주의:** critic confidence가 budget penalty를 받긴 하지만, 충분한 exact evidence가 있으면 여전히 high가 될 수 있습니다. 따라서 C1의 상태 충돌과 C13은 같은 원인 계열입니다.

---

### C14

**판정: 부분참**

**근거 코드:** `src/mcp/server.mjs:L485-L498`, `src/mcp/server.mjs:L744-L764`, `src/explorer/runtime.mjs:L1431-L1439`, `src/explorer/runtime.mjs:L1601-L1607`, `README.md:L576-L595`

**근거 인용:**

```js
function makeProgressCallback(progressToken) {
  if ((progressToken === null || progressToken === undefined) || !sendNotification) return null;
  return ({ progress, total, message }) => {
    try {
      sendNotification('notifications/progress', { progressToken, progress, total, message });
```

```js
'All tools accept a "session" parameter for multi-call continuity — pass sessionId from one call to the next. ' +
'Pass _meta.progressToken to receive turn-by-turn progress updates.',
```

```js
onProgress({
  progress: turnIndex + 1,
  total: budgetConfig.maxTurns,
  message: `Turn ${turnIndex + 1}/${budgetConfig.maxTurns}: ${toolDesc}`,
});
```

**판정 이유:** progressToken 기능은 이미 있습니다. `_meta.progressToken`이 있고 `sendNotification`이 연결되어야 progress가 나갑니다. 따라서 “진행률 가시성이 필요하다”는 제품 피드백은 타당하지만, “기능이 없다”는 의미라면 틀립니다.

**주의:** 실제 70~80초 duration은 실행 결과가 없으면 코드만으로 검증할 수 없습니다. 코드상 확인되는 문제는 README/Codex agent guidance가 progressToken을 강하게 operational rule로 만들지 않는다는 점입니다.

---

### C15

**판정: 참**

**근거 코드:** `src/explorer/repo-tools.mjs:L1630-L1676`, `src/explorer/runtime.mjs:L1474-L1487`, `src/explorer/runtime.mjs:L691-L734`, `src/explorer/config.mjs:L94-L116`

**근거 인용:**

```js
case 'repo_list_dir':
  return Array.isArray(result.entries) ? result.entries.map(entry => entry.path).filter(Boolean) : [];
```

```js
const discoveredFromTool = collectTargetPathsFromToolResult(toolName, safeToolResult);
discoveredPaths = mergeTargetPaths(discoveredPaths, discoveredFromTool);
```

```js
addTarget({
  path: discoveredPath,
  role: 'reference',
  reason: 'Discovered path; read only if the cited evidence does not answer the edit or verification need.',
  evidenceRefs: [],
});
```

**판정 이유:** `repo_list_dir` 결과의 모든 entry path가 `discoveredPaths`로 들어가고, grounded evidence path가 아니면 reference target으로 승격됩니다. 기본 ignore dir 목록에는 `.git`은 있지만 `.github`나 `.specify`는 없습니다. `.gitignore`는 파일이므로 기본 ignore dir로도 빠지지 않습니다. 근거: `src/explorer/config.mjs:L94-L116`

**주의:** 특정 실행에서 `.specify/extensions.yml`이 들어갔는지는 실행 trace가 필요하지만, 코드 구조상 그 경로가 repo_list_dir entry라면 target화될 수 있습니다.

---

### C16

**판정: 검증불가**

**근거 코드:** `src/mcp/server.mjs:L650-L675`, `README.md:L167-L178`, `README.md:L576-L595`, `AGENTS.md:L17-L25`

**근거 인용:**

```js
return {
  schemaVersion: result.schemaVersion ?? 1,
  directAnswer: result.directAnswer || '',
  status: result.status ?? {
    confidence: 'low',
    verification: 'broad_search_needed',
    complete: false,
    warnings: [],
  },
  targets: Array.isArray(result.targets) ? result.targets : [],
  evidence: Array.isArray(result.evidence) ? result.evidence : [],
  uncertainties: Array.isArray(result.uncertainties) ? result.uncertainties : [],
  nextAction: result.nextAction ?? { type: 'stop', reason: '' },
  evidenceQuality: result.evidenceQuality ?? defaultEvidenceQuality(result.trustSummary),
  searchCoverage: result.searchCoverage ?? defaultSearchCoverage(),
  failure: result.failure ?? null,
```

```md
- **Compact 반환 계약**: MCP `structuredContent`는 `schemaVersion`, `directAnswer`, `status`, `targets`, snippet 포함 `evidence`, `uncertainties`, `nextAction`, `evidenceQuality`, nullable `failure`, `session`, `sessionId` 중심의 compact 계약을 사용합니다.
```

**판정 이유:** 직접 MCP tool path는 구조화 메타데이터를 보존합니다. 그러나 “sub-agent가 자연어 요약 중 누락한다”는 현상은 이 repo의 runtime/server 코드가 아니라 외부 agent orchestration 동작입니다. 압축본에는 해당 sub-agent 요약 구현이 없으므로 실제 누락 여부는 검증할 수 없습니다.

**주의:** README의 Codex agent instructions는 `sessionId` 재사용과 targets/citations 검증을 말하지만, `status`, `evidenceQuality`, `searchCoverage`, `failure`, `session`을 반드시 포함하라는 sub-agent output template은 없습니다. 근거: `README.md:L576-L595`

---

## 5. Phase 4 — 우선순위와 트레이드오프

### 5.1 우선순위 매트릭스

| 수정 난이도 \ 영향도                       | High                                                                                                                                                                  | Medium                                                                                                                                                     | Low                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Low — 문서/상수/가이드 보강                 | C14 — progress 기능은 있으나 agent 사용 규칙이 약해 heavy call에서 hang처럼 보일 수 있음.                                                                                                   | C16 — 직접 도구는 구조화 필드를 보존하지만 sub-agent template 문서가 약함.                                                                                                      | C4/C8 일부 — wrapper 선택 기준과 env surface 안내를 문서로 보강 가능. |
| Medium — runtime 로직/정규식/도구 필터 수정   | C1/C7/C13 — parent automation 신뢰성 핵심. budget flag가 상태 계약을 뒤집는 구조라 영향 High. C5 — scope hard boundary 문서와 `gitDiff` 구현이 불일치. C11 — env var 이름이 snippet에서 사라져 코드 이해를 방해. | C12 — 자동 session reuse는 옵션으로 넣으면 개선되나, cross-client state risk가 있어 기본값 결정 필요. C2/C3 — simple symbol/path task의 completion threshold와 budget routing 보정 필요. | 없음                                                   |
| High — schema/additive contract 변경 | C9/C15 — `targets[]`에서 discovered path를 분리하려면 output schema와 consumer migration 필요. C10 — report targets file-level merge/dedupe는 report structuredContent 계약 변화.     | C8 full fix — tool surface를 완전히 안정화하려면 env 정책 또는 exposed metadata contract 재설계 필요.                                                                         | 없음                                                   |

### 5.2 Top 5 수정 우선순위

1. **Spec-1 — 상태 계약 재정의: evidence sufficiency 기반 `status/complete/nextAction/failure`**

    * 연관: C1, C3, C7, C13, C2 일부.
    * 이유: parent agent가 “다음 행동을 해도 되는가”를 판단하는 핵심 계약입니다.

2. **Spec-2 — `targets[]`와 `discoveredPaths[]` 분리, listDir 노이즈 차단, report target dedupe**

    * 연관: C9, C10, C15.
    * 이유: Claude Code의 최우선 fix 1번과 일치하며, parent routing의 signal/noise를 직접 개선합니다.

3. **Spec-3 — redaction 규칙 보정: env var 이름은 보존하고 secret value/path만 마스킹**

    * 연관: C11.
    * 이유: Claude Code의 최우선 fix 2번과 일치하며, 코드 인터페이스 이해를 방해하는 회귀입니다.

4. **Spec-4 — `scope` hard boundary와 git-guided review 일관성 복구**

    * 연관: C5.
    * 이유: DESIGN은 scope를 hard boundary로 문서화했는데 `repo_git_diff`가 예외 경로입니다.

5. **Spec-5 — session/progress/sub-agent handoff 운영 계약 강화**

    * 연관: C12, C14, C16, C4, C8.
    * 이유: runtime 신뢰성 자체보다 parent/sub-agent 사용성 문제지만, 자동화 품질과 디버깅 가능성에 영향이 큽니다.

Claude Code 최우선 3개 검토 결과:

| Claude Code 제안                                              | 코드 검증 결과                                                                                                     | Top 5 반영 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| `targets[]`에서 `evidenceRefs:[]` 항목을 `discoveredPaths[]`로 분리 | `buildTargets()`가 실제로 discovered path를 reference target으로 승격함. 참. 근거: `src/explorer/runtime.mjs:L721-L730`   | Spec-2   |
| redaction 완화 — env var 이름 노출                                | object key는 안 가리지만 snippet 문자열의 `process.env.X`는 regex상 가려질 수 있음. 부분참. 근거: `src/explorer/redact.mjs:L23-L57` | Spec-3   |
| 단일 심볼/단순 locate 작업의 자가평가 임계 완화                              | budget flag가 evidence 충족도보다 우선해 `complete:false`가 됨. 참. 근거: `src/explorer/runtime.mjs:L806-L828`             | Spec-1   |

---

## 6. Phase 5 — 상세 구현 명세서

---

### Spec-1: 상태 계약 재정의 — evidence sufficiency 기반 `status/complete/nextAction/failure`

#### 0. 연관 클레임

C1, C2 일부, C3, C7, C13

#### 1. 현재 동작 As-Is

* 코드 위치: `src/explorer/runtime.mjs:L806-L828`
* 동작 설명: `buildResultStatus()`는 `stats.stoppedByBudget`가 true이면 evidence 충족도와 무관하게 `verification='follow_up_needed'`를 선택합니다.
* 문제: 충분한 exact evidence와 high confidence가 있어도 `complete:false`, `nextAction:ask_user`, `failure.reason='budget_exhausted'`가 함께 나와 parent agent가 불필요하게 재호출할 수 있습니다.

현재 코드:

```js
} else if (criticStatus === 'caution' || result.status?.confidence === 'low' || stats.stoppedByBudget) {
  verification = 'follow_up_needed';
}
...
complete: verification === 'verified' || verification === 'targeted_read_needed',
```

* 코드 위치: `src/explorer/runtime.mjs:L830-L854`

* 동작 설명: `verification`이 `follow_up_needed` 또는 `broad_search_needed`이면 모델이 usable nextAction을 주지 않는 한 `ask_user`로 fallback합니다.

* 문제: 자동 workflow에서는 사용자를 물어보기보다 더 좁은 follow-up이나 stop을 선택해야 하는 경우가 많습니다.

* 코드 위치: `src/explorer/runtime.mjs:L526-L565`

* 동작 설명: `stats.stoppedByBudget`이면 `failure.reason='budget_exhausted'`를 생성합니다.

* 문제: “budget을 다 썼지만 충분히 답했다”와 “budget을 다 쓰고도 evidence 부족”을 구분하지 않습니다.

#### 2. 목표 동작 To-Be

* `stoppedByBudget`는 **불완전성 신호 중 하나**이지, `complete:false`를 강제하는 단일 조건이 아니어야 합니다.
* 단일 symbol/locate task는 다음 조건이면 `complete:true`가 될 수 있어야 합니다.

    * directAnswer가 비어 있지 않음
    * exact grounded evidence가 1개 이상 있음
    * critic fail/tool error/abort가 없음
    * evidence가 directAnswer의 핵심 claim을 최소 1개 file range로 지지함
* complex path/impact task는 더 높은 기준을 적용합니다.

    * exact evidence 2개 이상 또는 distinct file 2개 이상
    * path_explanation은 entry/transition/end 중 최소 2단계 evidence
    * edit_planning은 edit/read/test/config target 중 최소 1개 이상
* `failure.reason='budget_exhausted'`는 evidence sufficiency가 false일 때만 붙입니다.
* `searchCoverage.stoppedByBudget`는 기존처럼 true를 유지해 budget 사실은 숨기지 않습니다.
* `status.warnings`에는 budget warning을 남기되, `complete:true`인 경우 “budget exhausted after sufficient evidence” 식의 낮은 severity 문구로 둡니다.
* `nextAction`은 다음 우선순위를 가집니다.

    1. `failure.retry`가 있으면 parent는 failure.retry 우선
    2. sufficient + no edit needed: `stop`
    3. sufficient + edit/read verification needed: `read_target`
    4. insufficient + concrete retry possible: `explore_followup`
    5. insufficient + missing user intent: `ask_user`

#### 3. 변경 지점

**파일: `src/explorer/runtime.mjs`**

1. 새 함수 추가:

```js
function getGroundingCounts(result) {
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const exactCount = evidence.filter(item => item.groundingStatus === 'exact').length;
  const partialCount = evidence.filter(item => item.groundingStatus === 'partial').length;
  const fileCount = new Set(evidence.map(item => item.path).filter(Boolean)).size;
  return { exactCount, partialCount, fileCount };
}
```

2. 새 함수 추가:

```js
function isSimpleCompletionMode({ taskMode, task } = {}) {
  if (taskMode === 'locate' || taskMode === 'symbol_trace') return true;
  const text = String(task ?? '').toLowerCase();
  return /어디\s|찾아|위치|선언|정의\s|defined|where\s|find\s|locate|definition/.test(text);
}
```

3. 새 함수 추가:

```js
function evaluateEvidenceSufficiency(result, stats, { task, taskMode } = {}) {
  const criticStatus = result.critic?.status ?? 'caution';
  if (criticStatus === 'fail' || stats.stoppedByErrors || stats.stoppedByAbort) {
    return { sufficient: false, reason: 'critic_or_execution_failure' };
  }

  const { exactCount, partialCount, fileCount } = getGroundingCounts(result);
  const hasDirectAnswer = typeof result.directAnswer === 'string' && result.directAnswer.trim().length > 0;
  const hasEvidence = exactCount + partialCount > 0;
  if (!hasDirectAnswer || !hasEvidence) {
    return { sufficient: false, reason: 'missing_answer_or_evidence' };
  }

  if (isSimpleCompletionMode({ taskMode, task })) {
    return exactCount >= 1
      ? { sufficient: true, reason: 'simple_task_exact_evidence' }
      : { sufficient: false, reason: 'simple_task_needs_exact_evidence' };
  }

  if (taskMode === 'evidence_verification') {
    return exactCount >= 1
      ? { sufficient: true, reason: 'claim_has_grounded_evidence' }
      : { sufficient: false, reason: 'claim_needs_exact_evidence' };
  }

  if (taskMode === 'path_explanation') {
    return exactCount >= 2 || fileCount >= 2
      ? { sufficient: true, reason: 'path_has_multi_step_evidence' }
      : { sufficient: false, reason: 'path_needs_more_steps' };
  }

  if (taskMode === 'edit_planning') {
    const hasActionableTarget = (result.targets ?? []).some(target =>
      ['edit', 'read', 'test', 'config'].includes(target.role)
    );
    return hasActionableTarget && exactCount >= 1
      ? { sufficient: true, reason: 'edit_plan_has_actionable_target' }
      : { sufficient: false, reason: 'edit_plan_needs_actionable_target' };
  }

  return exactCount >= 2 || fileCount >= 2
    ? { sufficient: true, reason: 'general_multi_evidence' }
    : { sufficient: false, reason: 'general_needs_more_evidence' };
}
```

4. `buildResultStatus()` signature와 로직 변경.

Before:

```js
function buildResultStatus(result, stats, { task, taskMode } = {}) {
```

After:

```js
function buildResultStatus(result, stats, { task, taskMode, sufficiency = null } = {}) {
```

변경 로직:

```js
const evidenceSufficiency = sufficiency ?? evaluateEvidenceSufficiency(result, stats, { task, taskMode });

if (!hasEvidence || criticStatus === 'fail' || stats.stoppedByErrors || stats.stoppedByAbort) {
  verification = 'broad_search_needed';
} else if (result.status?.confidence === 'low') {
  verification = 'follow_up_needed';
} else if (hasEditTarget || editPlanning) {
  verification = evidenceSufficiency.sufficient ? 'targeted_read_needed' : 'follow_up_needed';
} else if (criticStatus === 'caution' || stats.stoppedByBudget) {
  verification = evidenceSufficiency.sufficient ? 'verified' : 'follow_up_needed';
}
```

5. `buildFailure()`에서 budget failure 조건 변경.

Before:

```js
if (stats.stoppedByBudget) {
```

After:

```js
if (stats.stoppedByBudget && result.status?.complete !== true) {
```

6. `buildNextAction()` 개선.

Before: follow_up/broad default `ask_user`.

After:

```js
if (verification === 'follow_up_needed' || verification === 'broad_search_needed') {
  const modelNextAction = ['explore_followup', 'ask_user'].includes(result.nextAction?.type)
    ? result.nextAction
    : null;

  if (modelNextAction) return modelNextAction;

  const firstTarget = (result.targets ?? []).find(item => item.role === 'read' || item.role === 'reference');
  if (firstTarget) {
    return {
      type: 'explore_followup',
      reason: 'Run a narrower follow-up around the cited target before asking the user.',
      query: `${firstTarget.path}${firstTarget.startLine ? `:${firstTarget.startLine}-${firstTarget.endLine}` : ''}`,
    };
  }

  return {
    type: 'ask_user',
    reason: 'The explorer lacks enough concrete evidence and no narrower follow-up target is available.',
  };
}
```

7. 호출부 변경.

현재:

```js
normalized.status = buildResultStatus(normalized, stats, {
  task: args.task,
  taskMode: args.taskMode,
});
normalized.nextAction = buildNextAction(normalized);
```

변경:

```js
const sufficiency = evaluateEvidenceSufficiency(normalized, stats, {
  task: args.task,
  taskMode: args.taskMode,
});
normalized._debug = {
  ...(normalized._debug ?? {}),
  evidenceSufficiency: sufficiency,
};
normalized.status = buildResultStatus(normalized, stats, {
  task: args.task,
  taskMode: args.taskMode,
  sufficiency,
});
normalized.nextAction = buildNextAction(normalized);
```

**파일: `src/explorer/schemas.mjs`**

필수 schema 변경은 없습니다. `_debug` 아래에 `evidenceSufficiency`를 넣으면 output schema additive 변경 없이 가능합니다.

선택적 schema 개선을 한다면 다음 optional field를 `status`에 추가할 수 있습니다. 단, strict consumer를 고려해 1차 구현에서는 `_debug`에만 둡니다.

```diff
 const STATUS_SCHEMA = {
   ...
   properties: {
     confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
     verification: { ... },
     complete: { type: 'boolean' },
+    completionReason: { type: 'string' },
     warnings: { type: 'array', items: { type: 'string' } },
   },
```

#### 4. 하위 호환성

* 기존 field는 제거하지 않습니다.
* `status.verification`과 `complete` 값이 더 긍정적으로 바뀔 수 있습니다. parent agent가 기존에 `stoppedByBudget`만 보고 재호출하던 흐름은 줄어듭니다.
* `failure`가 budget exhaustion 상황에서도 null이 될 수 있습니다. 단 `searchCoverage.stoppedByBudget`는 유지하므로 budget fact는 계속 관찰 가능합니다.
* `_debug.evidenceSufficiency`는 diagnostic field라 consumer가 무시해도 됩니다.

#### 5. 검증 방법

추가 단위 테스트:

1. `tests/runtime.mock.test.mjs`

    * 입력: locate task, exact evidence 1개, finalObject가 maxTurns 이후 finalize로 생성되어 `stats.stoppedByBudget=true`.
    * 기대: `status.verification='verified'`, `complete=true`, `failure=null`, `searchCoverage.stoppedByBudget=true`.

2. `tests/runtime.mock.test.mjs`

    * 입력: path_explanation task, exact evidence 1개뿐, budget exhausted.
    * 기대: `verification='follow_up_needed'`, `complete=false`, `failure.reason='budget_exhausted'`.

3. `tests/mcp-server.test.mjs`

    * wrapper `trace_symbol` mocked response: exact evidence 1개.
    * 기대: 단일 symbol trace는 `complete=true`.

수동 검증 명령:

```bash
npm test
node src/index.mjs
```

회귀 위험 테스트:

* `tests/mcp-server.test.mjs:L311-L324`는 confidence/evidenceQuality linkage를 확인합니다.
* `tests/runtime.mock.test.mjs`의 budget retry 관련 테스트, 특히 `failure.retry.args` 기대값이 있는 테스트를 확인해야 합니다.

#### 6. 문서 업데이트

* `README.md`

    * `failure` 설명절 `README.md:L267-L273`에 “budget exhausted가 항상 failure는 아니며, evidence sufficiency가 충족되면 `searchCoverage.stoppedByBudget=true`만 남을 수 있다” 추가.
    * `status` 사용법에 `complete`는 “turn을 다 쓰지 않음”이 아니라 “요청 task에 충분한 grounded evidence 확보” 의미라고 명시.
* `DESIGN.md`

    * agent control precedence `DESIGN.md:L402-L408`에 sufficiency gate 추가.
    * deterministic critic 절 `DESIGN.md:L455-L510` 뒤에 evidence sufficiency decision 추가.
* `AGENTS.md`

    * schema/status 변경 시 README/DESIGN/examples 동시 갱신 규칙 유지. 근거: `AGENTS.md:L17-L25`

#### 7. 리스크 / 미해결 결정

* “충분한 evidence” 판정은 task별 heuristic입니다. 완벽한 semantic coverage 판정은 아닙니다.
* false-negative claim 검증, 예: “X는 없다”는 exact evidence 1개로 충분하지 않을 수 있습니다. `evidence_verification`에서 negative finding 기준을 별도 확장할지 결정이 필요합니다.
* `status.completionReason`을 public schema에 추가할지, `_debug.evidenceSufficiency`로만 둘지 결정해야 합니다.

---

### Spec-2: `targets[]`와 `discoveredPaths[]` 분리, listDir 노이즈 차단, report target dedupe

#### 0. 연관 클레임

C9, C10, C15

#### 1. 현재 동작 As-Is

* 코드 위치: `src/explorer/repo-tools.mjs:L1630-L1676`

* 동작 설명: `repo_list_dir`, `repo_find_files`, `repo_grep`, `repo_read_file`, `repo_git_diff`, `repo_git_show`, `repo_symbols`, `repo_references`, `repo_symbol_context` 결과에서 path를 수집합니다.

* 코드 위치: `src/explorer/runtime.mjs:L1474-L1487`

* 동작 설명: tool result마다 `collectTargetPathsFromToolResult()`로 paths를 모아 `discoveredPaths`에 merge합니다.

* 코드 위치: `src/explorer/runtime.mjs:L721-L730`

* 동작 설명: evidence에 없는 discovered path는 `targets[]`의 `role:'reference'`, `evidenceRefs:[]` 항목으로 승격됩니다.

현재 코드:

```js
addTarget({
  path: discoveredPath,
  role: 'reference',
  reason: 'Discovered path; read only if the cited evidence does not answer the edit or verification need.',
  evidenceRefs: [],
});
```

* 문제: parent agent가 `targets[]`를 “읽을/edit할 핵심 대상”으로 사용할 때, listDir에서 발견된 README, docs, `.github`, `.specify` 같은 경로가 노이즈로 섞입니다.
* report 도구는 `buildReportCitationTargets()`에서 path+line range 단위로만 dedupe하므로 같은 파일의 여러 citation이 여러 target으로 남습니다. 근거: `src/explorer/runtime.mjs:L502-L524`

#### 2. 목표 동작 To-Be

* `targets[]`는 **actionable target**만 포함합니다.

    * grounded evidence에서 나온 read target
    * 모델이 제안한 edit/test/config/context target 중 grounded evidence path와 연결된 target
    * report citation target 중 file-level merge된 target
* discovery-only path는 새 top-level `discoveredPaths[]`에 둡니다.
* `discoveredPaths[]`는 parent agent가 필요할 때만 참고하는 map입니다.
* `repo_list_dir` 결과는 기본적으로 `targets[]`에 자동 승격하지 않습니다.
* report tools의 citation targets는 같은 파일 기준으로 line range를 병합합니다.

#### 3. 변경 지점

**파일: `src/explorer/schemas.mjs`**

새 schema 추가:

```js
const DISCOVERED_PATH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    kind: { type: 'string', enum: ['file', 'dir', 'unknown'] },
    sourceTool: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['path', 'kind', 'sourceTool', 'reason'],
};
```

`EXPLORE_REPO_OUTPUT_SCHEMA.properties`에 추가:

```diff
 properties: {
   schemaVersion: { type: 'integer', const: 1 },
   directAnswer: { type: 'string' },
   status: STATUS_SCHEMA,
   targets: { type: 'array', items: TARGET_ITEM_SCHEMA },
+  discoveredPaths: { type: 'array', items: DISCOVERED_PATH_SCHEMA },
   evidence: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
```

`EXPLORE_RESULT_JSON_SCHEMA`에는 추가하지 않습니다. 이유: model output이 아니라 runtime-derived field입니다.

**파일: `src/explorer/repo-tools.mjs`**

기존 `collectTargetPathsFromToolResult()`를 유지하되, 새 함수 추가:

```js
export function collectDiscoveredPathsFromToolResult(toolName, result) {
  if (!result || typeof result !== 'object') return [];

  switch (toolName) {
    case 'repo_list_dir':
      return Array.isArray(result.entries)
        ? result.entries
            .map(entry => ({
              path: entry.path,
              kind: entry.kind === 'dir' ? 'dir' : entry.kind === 'file' ? 'file' : 'unknown',
              sourceTool: toolName,
              reason: 'Listed during repository discovery.',
            }))
            .filter(item => item.path)
        : [];

    case 'repo_find_files':
      return Array.isArray(result.matches)
        ? result.matches.map(path => ({
            path,
            kind: 'file',
            sourceTool: toolName,
            reason: 'Matched file discovery query.',
          }))
        : [];

    case 'repo_git_diff':
    case 'repo_git_show':
      return Array.isArray(result.files)
        ? result.files.map(file => ({
            path: file.path,
            kind: 'file',
            sourceTool: toolName,
            reason: 'Changed file discovered from git metadata.',
          })).filter(item => item.path)
        : [];

    default:
      return collectTargetPathsFromToolResult(toolName, result).map(path => ({
        path,
        kind: 'unknown',
        sourceTool: toolName,
        reason: 'Discovered from tool result.',
      }));
  }
}
```

**파일: `src/explorer/runtime.mjs`**

1. import 변경:

```diff
-import { collectTargetPathsFromToolResult, mergeTargetPaths, RepoToolkit } from './repo-tools.mjs';
+import { collectDiscoveredPathsFromToolResult, mergeTargetPaths, RepoToolkit } from './repo-tools.mjs';
```

2. `discoveredPaths` 자료구조를 string array에서 object array로 변경.

Before:

```js
let discoveredPaths = [];
...
const discoveredFromTool = collectTargetPathsFromToolResult(toolName, safeToolResult);
discoveredPaths = mergeTargetPaths(discoveredPaths, discoveredFromTool);
```

After:

```js
let discoveredPaths = [];
...
const discoveredFromTool = collectDiscoveredPathsFromToolResult(toolName, safeToolResult);
discoveredPaths = mergeDiscoveredPaths(discoveredPaths, discoveredFromTool);
```

새 함수:

```js
function mergeDiscoveredPaths(existing = [], next = []) {
  const byPath = new Map();
  for (const item of [...existing, ...next]) {
    const path = normalizeTargetPath(item?.path);
    if (!path) continue;
    const current = byPath.get(path);
    if (!current) {
      byPath.set(path, { ...item, path });
    } else if (current.kind === 'unknown' && item.kind && item.kind !== 'unknown') {
      byPath.set(path, { ...current, ...item, path });
    }
  }
  return [...byPath.values()].slice(0, 100);
}
```

3. `buildTargets()`에서 discovered path 승격 제거.

Before:

```js
function buildTargets({ evidence = [], discoveredPaths = [] } = {}) {
```

After:

```js
function buildTargets({ evidence = [] } = {}) {
```

삭제:

```diff
- const evidencePaths = new Set(evidence.map(item => normalizeTargetPath(item.path)).filter(Boolean));
- for (const discoveredPath of discoveredPaths) {
-   ...
-   addTarget({ path: discoveredPath, role: 'reference', ... evidenceRefs: [] });
- }
```

4. final result 조립부 변경.

Before:

```js
normalized.targets = mergeTargets(
  groundedModelTargets,
  buildTargets({ evidence: normalized.evidence, discoveredPaths }),
);
```

After:

```js
normalized.targets = mergeTargets(
  groundedModelTargets,
  buildTargets({ evidence: normalized.evidence }),
);
normalized.discoveredPaths = discoveredPaths;
```

5. `toAgentFacingResult()` 수정.

**파일: `src/mcp/server.mjs`**

Before:

```js
targets: Array.isArray(result.targets) ? result.targets : [],
```

After:

```js
targets: Array.isArray(result.targets) ? result.targets : [],
discoveredPaths: Array.isArray(result.discoveredPaths) ? result.discoveredPaths : [],
```

**파일: `src/explorer/runtime.mjs` report target dedupe**

현재:

```js
const key = `${citation.path}:${citation.startLine ?? ''}:${citation.endLine ?? ''}`;
```

변경: file-level merge.

```js
function buildReportCitationTargets(citations = []) {
  const byPath = new Map();

  for (const citation of citations) {
    if (!citation?.path) continue;
    const existing = byPath.get(citation.path) ?? {
      path: citation.path,
      role: 'reference',
      reason: 'Markdown report citation',
      evidenceRefs: [],
      citationCount: 0,
    };

    if (Number.isInteger(citation.startLine)) {
      existing.startLine = Number.isInteger(existing.startLine)
        ? Math.min(existing.startLine, citation.startLine)
        : citation.startLine;
    }
    if (Number.isInteger(citation.endLine)) {
      existing.endLine = Number.isInteger(existing.endLine)
        ? Math.max(existing.endLine, citation.endLine)
        : citation.endLine;
    }

    existing.citationCount += 1;
    byPath.set(citation.path, existing);
  }

  return [...byPath.values()].map(({ citationCount, ...target }) => ({
    ...target,
    reason: citationCount > 1
      ? `Markdown report citations merged from ${citationCount} ranges.`
      : target.reason,
  }));
}
```

**환경변수**

하위 호환성을 위해 1 릴리스 동안 legacy mode 제공:

```js
function legacyDiscoveredTargetsEnabled() {
  return process.env.CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS === '1';
}
```

* 기본값: `false`
* `true`일 때만 기존처럼 discovered paths를 reference targets에도 넣습니다.

#### 4. 하위 호환성

* 새 `discoveredPaths[]`는 additive field입니다.
* `targets[]`에서 empty `evidenceRefs` reference path가 줄어드는 것은 observable change입니다.
* migration:

    * 1 릴리스 동안 `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` 지원.
    * README에 “actionable target은 `targets[]`, discovery map은 `discoveredPaths[]`”라고 명시.
    * parent agent는 `targets[].evidenceRefs.length === 0`인 항목에 의존하지 말고 `discoveredPaths[]`를 사용하도록 변경.

#### 5. 검증 방법

추가 테스트:

1. `tests/runtime.mock.test.mjs`

    * 모델이 `repo_list_dir`를 호출하고 evidence는 `src/auth.js` 1개만 반환.
    * 기대: `targets[]`에는 `src/auth.js`만 있고, listDir entries는 `discoveredPaths[]`에 있음.

2. `tests/repo-tools.test.mjs`

    * `collectDiscoveredPathsFromToolResult('repo_list_dir', { entries:[{path:'.github',kind:'dir'}] })`
    * 기대: `{ path: '.github', kind:'dir', sourceTool:'repo_list_dir' }`

3. `tests/mcp-server.test.mjs`

    * `structuredContent.discoveredPaths`가 redaction 후에도 존재하는지 확인.

4. report dedupe 테스트:

    * report: `` `src/a.js:L1-L3` `src/a.js:L5-L8` `src/b.js:L2` ``
    * 기대: targets 2개, `src/a.js`는 `startLine:1`, `endLine:8`.

수동 검증:

```bash
npm test
```

회귀 위험:

* `tests/mcp-server.test.mjs:L397-L431`은 report targets를 확인합니다. 기대값 변경 필요.
* 기존 parent consumer가 `reference` target을 broad follow-up 대상으로 쓰고 있다면 migration 필요.

#### 6. 문서 업데이트

* `README.md:L167-L178` compact 반환 계약에 `discoveredPaths[]` 추가.
* `README.md:L299-L304` recommended use에 `targets[]`와 `discoveredPaths[]` 차이를 명시.
* `DESIGN.md:L331-L400` return schema에 `discoveredPaths[]` 추가.
* `AGENTS.md:L17-L25` schema update matrix에 따라 examples/expected response 갱신.

#### 7. 리스크 / 미해결 결정

* `discoveredPaths[]`가 너무 많아질 수 있습니다. 기본 cap 100이 적절한지 결정 필요.
* `repo_grep` match path를 discovered로만 둘지, evidence로 이어진 경우 target으로 둘지 구분이 필요합니다. 위 명세는 evidence에 있는 path만 actionable target으로 둡니다.
* report target file-level range merge는 넓은 line range를 만들 수 있습니다. parent가 좁은 citation별 range를 원하면 `citations[]`를 사용해야 합니다.

---

### Spec-3: redaction 보정 — env var 이름은 보존하고 secret value/path만 마스킹

#### 0. 연관 클레임

C11

#### 1. 현재 동작 As-Is

* 코드 위치: `src/explorer/redact.mjs:L23-L64`
* 동작 설명: `SECRET_PATH_MENTION_REGEX`가 `.env`와 `.env.*`를 path mention으로 잡고, `isSecretPath()`와 매칭되면 `[REDACTED:secret-path]`로 치환합니다.
* 문제: snippet/report 문자열에 `process.env.CEREBRAS_API_KEY`가 있으면 `.env.CEREBRAS_API_KEY` 부분이 path mention처럼 인식될 수 있습니다. 환경변수 이름은 secret value가 아니라 public code interface인데 가려집니다.

현재 코드:

```js
const SECRET_PATH_MENTION_REGEX = /`?([A-Za-z0-9_.-][A-Za-z0-9_./\\-]*\/[A-Za-z0-9_./\\-]+|\.env(?:\.[A-Za-z0-9_.-]+)?|\.envrc|\.npmrc|\.netrc|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?)(?::L?\d+(?:-L?\d+)?)?`?/g;
```

* 코드 위치: `src/explorer/redact.mjs:L66-L106`
* 동작 설명: object key는 보존하고 value만 redaction합니다.
* 문제: issue는 key redaction이 아니라 code snippet string redaction입니다.

#### 2. 목표 동작 To-Be

* `process.env.CEREBRAS_API_KEY`, `import.meta.env.VITE_API_URL`, `Deno.env.get("TOKEN")` 같은 env var **이름**은 보존합니다.
* 실제 secret value는 기존 규칙대로 마스킹합니다.
* `.env`, `.env.production`, `secrets/.env`, `.npmrc`, `.netrc`, `id_rsa` 같은 secret path mention은 계속 마스킹합니다.
* file citation path가 secret deny-list에 걸리면 계속 `[REDACTED:secret-path]`로 마스킹합니다.

#### 3. 변경 지점

**파일: `src/explorer/redact.mjs`**

1. regex를 “경계 있는 path mention”으로 변경합니다.

Before:

```js
const SECRET_PATH_MENTION_REGEX = /`?([A-Za-z0-9_.-][A-Za-z0-9_./\\-]*\/[A-Za-z0-9_./\\-]+|\.env(?:\.[A-Za-z0-9_.-]+)?|\.envrc|\.npmrc|\.netrc|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?)(?::L?\d+(?:-L?\d+)?)?`?/g;
```

After:

```js
const SECRET_PATH_TOKEN =
  '([A-Za-z0-9_.-][A-Za-z0-9_./\\\\-]*\\/[A-Za-z0-9_./\\\\-]+|\\.env(?:\\.[A-Za-z0-9_.-]+)?|\\.envrc|\\.npmrc|\\.netrc|id_rsa(?:\\.pub)?|id_ed25519(?:\\.pub)?)';

const SECRET_PATH_MENTION_REGEX = new RegExp(
  `(^|[\\s"'\\\`([{,])\\\`?${SECRET_PATH_TOKEN}(?::L?\\d+(?:-L?\\d+)?)?\\\`?(?=$|[\\s"'\\\`\\])},.:;])`,
  'g',
);
```

2. replacement callback에서 prefix를 보존합니다.

Before:

```js
text = text.replace(SECRET_PATH_MENTION_REGEX, (raw, relPath) => {
  if (!isSecretPath(relPath).matched) return raw;
  secretPathMatched = true;
  return '[REDACTED:secret-path]';
});
```

After:

```js
text = text.replace(SECRET_PATH_MENTION_REGEX, (raw, prefix, relPath) => {
  if (!isSecretPath(relPath).matched) return raw;
  secretPathMatched = true;
  return `${prefix}[REDACTED:secret-path]`;
});
```

3. env var expression 보호 helper 추가를 고려합니다.

```js
function isEnvVarExpressionContext(text, matchIndex) {
  const before = text.slice(Math.max(0, matchIndex - 16), matchIndex);
  return /(?:process|import\.meta|Deno)\.$/.test(before) || /(?:process\.|import\.meta\.)$/.test(before);
}
```

단, 위 boundary regex만으로 `process.env.X` 내부 `.env` match는 대부분 차단됩니다. helper는 회귀 방지용으로 optional입니다.

**파일: `tests/security/redact.test.mjs`**

추가 테스트:

```js
test('redactText preserves environment variable names in code snippets', () => {
  const result = redactText('const key = process.env.CEREBRAS_API_KEY;');
  assert.equal(result.text, 'const key = process.env.CEREBRAS_API_KEY;');
  assert.equal(result.redacted, false);
});
```

```js
test('redactText still redacts secret env file paths', () => {
  const result = redactText('Read `.env.production:L1-L3` before debugging.');
  assert.match(result.text, /\[REDACTED:secret-path\]/);
  assert.equal(result.redacted, true);
});
```

```js
test('redactText redacts secret values but not variable identifiers', () => {
  const result = redactText('process.env.OPENAI_API_KEY = "sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";');
  assert.match(result.text, /process\.env\.OPENAI_API_KEY/);
  assert.match(result.text, /\[REDACTED:openai-api-key\]/);
});
```

#### 4. 하위 호환성

* secret file path redaction은 유지됩니다.
* 더 이상 `process.env.X`가 `[REDACTED:secret-path]`로 바뀌지 않으므로 snippet text가 더 informative해집니다.
* 보안 관점에서 env var 이름 노출이 우려된다면 별도 opt-in mask가 필요합니다. 기본은 노출입니다.

환경변수 선택지:

```js
function redactEnvVarNamesEnabled() {
  return process.env.CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES === '1';
}
```

* 기본값: `false`
* true일 때만 env var 이름까지 마스킹하는 별도 규칙을 적용합니다.
* 현재 명세에서는 기본 false를 권장합니다.

#### 5. 검증 방법

명령:

```bash
npm test tests/security/redact.test.mjs
npm test
```

회귀 위험:

* `tests/mcp-server.test.mjs:L474-L501`는 secret path citation redaction을 검증합니다. 이 테스트는 계속 통과해야 합니다.
* `.env.production:L1` 같은 standalone path mention은 계속 redaction되어야 합니다.

#### 6. 문서 업데이트

* `README.md:L110-L113` Security Model에 “env var names in code snippets are not considered secrets; values and secret files are redacted” 추가.
* `DESIGN.md:L18-L25` design constraints의 redaction 설명에 env var name/value 구분 추가.
* `AGENTS.md:L17-L25`에 redaction deny-list 변경 시 tests/security 문서 동기화 유지.

#### 7. 리스크 / 미해결 결정

* 일부 조직은 env var 이름도 민감한 interface로 볼 수 있습니다. 이 경우 `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1` opt-in이 필요합니다.
* regex boundary가 Windows path, backtick citation, punctuation 조합에서 회귀할 수 있으므로 redaction test matrix를 넓혀야 합니다.

---

### Spec-4: `scope` hard boundary와 git-guided review 일관성 복구

#### 0. 연관 클레임

C5

#### 1. 현재 동작 As-Is

* 코드 위치: `src/explorer/repo-tools.mjs:L556-L615`
* 동작 설명: `listDirectory()`는 base scope를 hard boundary로 enforce합니다.
* 코드 위치: `src/explorer/repo-tools.mjs:L1055-L1084`
* 동작 설명: `_filterGitDiffFiles(files, { enforceScope=false })`는 기본값이 false입니다.
* 코드 위치: `src/explorer/repo-tools.mjs:L1167-L1195`
* 동작 설명: `gitDiff()`는 `_filterGitDiffFiles(parseDiffOutput(output))`를 호출하므로 base scope filtering을 하지 않습니다.
* 문제: DESIGN은 scope를 hard boundary로 설명하지만, `review_change_context`의 git-guided 전략이 `repo_git_diff`를 호출하면 scope 밖 changed file이 결과에 섞일 수 있습니다.

현재 코드:

```js
const files = this._filterGitDiffFiles(parseDiffOutput(output));
return { from: safeFrom, to: safeTo, files };
```

반면 `gitShow()`:

```js
const files = this._filterGitDiffFiles(parseDiffOutput(patchOutput), { enforceScope: true });
```

#### 2. 목표 동작 To-Be

* base scope가 있으면 모든 git file output도 scope 밖 file을 제외합니다.
* scope 밖 file이 제외된 사실은 `omittedOutOfScopeFiles` 또는 warning으로 표시합니다.
* `review_change_context`는 scope 밖 file을 절대 actionable target으로 만들지 않습니다.
* 사용자가 scope를 hint로 쓰고 싶다면 별도 option을 써야 합니다. 현재 public schema에는 그런 option이 없으므로 기본은 hard boundary입니다.

#### 3. 변경 지점

**파일: `src/explorer/repo-tools.mjs`**

1. `_filterGitDiffFiles()` return 형태 확장.

Before:

```js
_filterGitDiffFiles(files, { enforceScope = false } = {}) {
  return files
    .filter(file => {
      if (isSecretDiffFile(file)) return false;
      if (enforceScope && this.baseScopeRules.patterns?.length > 0) {
        return this.baseScopeRules.matches(file.path);
      }
      return true;
    })
    .map(({ oldPath, ...file }) => file);
}
```

After:

```js
_filterGitDiffFiles(files, { enforceScope = true } = {}) {
  let omittedOutOfScopeFiles = 0;
  let omittedSecretPaths = 0;

  const filtered = files
    .filter(file => {
      if (isSecretDiffFile(file)) {
        omittedSecretPaths += 1;
        return false;
      }
      if (enforceScope && this.baseScopeRules.patterns?.length > 0 && !this.baseScopeRules.matches(file.path)) {
        omittedOutOfScopeFiles += 1;
        return false;
      }
      return true;
    })
    .map(({ oldPath, ...file }) => file);

  return { files: filtered, omittedOutOfScopeFiles, omittedSecretPaths };
}
```

2. `gitDiff()` patch path 변경.

Before:

```js
const files = this._filterGitDiffFiles(parseDiffOutput(output));
return { from: safeFrom, to: safeTo, files };
```

After:

```js
const filtered = this._filterGitDiffFiles(parseDiffOutput(output), { enforceScope: true });
return {
  from: safeFrom,
  to: safeTo,
  files: filtered.files,
  ...(filtered.omittedOutOfScopeFiles > 0 ? { omittedOutOfScopeFiles: filtered.omittedOutOfScopeFiles } : {}),
  ...(filtered.omittedSecretPaths > 0 ? { omittedSecretPaths: filtered.omittedSecretPaths } : {}),
};
```

3. `gitShow()` 변경.

Before:

```js
const files = this._filterGitDiffFiles(parseDiffOutput(patchOutput), { enforceScope: true });
...
files,
```

After:

```js
const filtered = this._filterGitDiffFiles(parseDiffOutput(patchOutput), { enforceScope: true });
...
files: filtered.files,
...(filtered.omittedOutOfScopeFiles > 0 ? { omittedOutOfScopeFiles: filtered.omittedOutOfScopeFiles } : {}),
...(filtered.omittedSecretPaths > 0 ? { omittedSecretPaths: filtered.omittedSecretPaths } : {}),
```

4. `gitDiff({ stat:true })` 처리.

현재 stat path는 raw stat string을 `filterGitStatOutput()`로 secret path만 제거합니다. 근거: `src/explorer/repo-tools.mjs:L1182-L1191`

변경 옵션:

```js
if (stat) {
  const filteredStat = filterGitStatOutput(output.trim());
  const scopedStat = this.baseScopeRules.patterns?.length > 0
    ? filterGitStatByScope(filteredStat.text, this.baseScopeRules)
    : { text: filteredStat.text, omittedOutOfScopeFiles: 0 };

  const redactedStat = redactText(scopedStat.text);
  return {
    from: safeFrom,
    to: safeTo,
    stat: redactedStat.text,
    ...(filteredStat.omittedSecretPaths > 0 ? { omittedSecretPaths: filteredStat.omittedSecretPaths } : {}),
    ...(scopedStat.omittedOutOfScopeFiles > 0 ? { omittedOutOfScopeFiles: scopedStat.omittedOutOfScopeFiles } : {}),
    ...(redactedStat.redacted ? { redacted: true, redactions: redactedStat.redactions } : {}),
  };
}
```

새 helper:

```js
function filterGitStatByScope(statText, scopeRules) {
  const lines = String(statText ?? '').split('\n');
  const kept = [];
  let omittedOutOfScopeFiles = 0;

  for (const line of lines) {
    const match = line.match(/^\s*(.+?)\s+\|\s+/);
    if (!match) {
      kept.push(line);
      continue;
    }
    const filePath = sanitizeRelativePath(match[1]);
    if (scopeRules.matches(filePath)) kept.push(line);
    else omittedOutOfScopeFiles += 1;
  }

  return { text: kept.join('\n'), omittedOutOfScopeFiles };
}
```

**파일: `src/explorer/repo-tools.mjs` tests**

추가 테스트:

```js
test('RepoToolkit gitDiff filters changed files to current scope', { skip: !hasGit() }, async () => {
  const root = await makeGitRepoFixture();
  // commit touches hello.js and docs/README.md
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: getBudgetConfig('normal') });
  await toolkit.initialize(['docs/**']);

  const diff = await toolkit.gitDiff({ from: 'HEAD~1', to: 'HEAD' });
  assert.ok(!diff.files.some(f => f.path === 'hello.js'));
  assert.ok(diff.files.some(f => f.path.startsWith('docs/')));
  assert.ok(diff.omittedOutOfScopeFiles > 0);
});
```

#### 4. 하위 호환성

* 기존에 scope 밖 git files를 참고하던 caller는 더 이상 받지 못합니다.
* 이는 DESIGN의 hard boundary와 일치하므로 bug fix로 간주합니다.
* scope 밖 파일이 필요하면 caller는 scope를 넓혀 재호출해야 합니다.
* `omittedOutOfScopeFiles`는 additive field입니다.

#### 5. 검증 방법

명령:

```bash
npm test tests/repo-tools.test.mjs
npm test
```

회귀 위험:

* `tests/repo-tools.test.mjs:L622-L642`의 `gitShow` scope test는 계속 통과해야 합니다.
* `collectTargetPathsFromToolResult('repo_git_diff')`는 `files`만 보는 구조라 additive metadata에 영향받지 않아야 합니다. 근거: `src/explorer/repo-tools.mjs:L1645-L1647`

#### 6. 문서 업데이트

* `DESIGN.md:L523-L533` scope hard boundary 절에 “gitDiff/gitShow also filter changed files by base scope” 추가.
* `README.md` Safety Boundary 절 `README.md:L653-L663`에 git-guided review도 scope 밖 파일을 제외한다고 명시.
* `README.md` `review_change_context` 설명에 “scope 밖 변경은 omitted count로만 표시” 추가.

#### 7. 리스크 / 미해결 결정

* `git diff --stat` path parsing은 rename/copy/stat formatting에 취약할 수 있습니다. 가능하면 stat mode에서도 `--name-only`를 별도로 실행해 scope filtering 기준을 얻는 방식이 더 안정적입니다.
* scope 밖 file을 “out-of-scope but git-relevant”로 표시할지 완전 제외할지 결정이 필요합니다. DESIGN 기준은 완전 제외입니다.

---

### Spec-5: session/progress/sub-agent handoff 운영 계약 강화

#### 0. 연관 클레임

C12, C14, C16, C4, C8

#### 1. 현재 동작 As-Is

* 코드 위치: `src/explorer/runtime.mjs:L1023-L1080`
* 동작 설명: explicit `session`이 없으면 새 session을 생성합니다. repoRoot가 같아도 자동 재사용하지 않습니다.
* 문제: parent가 `sessionId`를 매번 전달하지 않으면 continuity가 약합니다.

현재 코드:

```js
// No session requested — create a new one
const newId = sessionStore.create(repoRoot);
const newData = sessionStore.get(newId);
return {
  ok: true,
  sessionId: newId,
  sessionData: newData,
  sessionStatus: 'created',
```

* 코드 위치: `src/mcp/server.mjs:L485-L498`

* 동작 설명: progress notification은 `_meta.progressToken`이 있고 `sendNotification`이 있을 때만 동작합니다.

* 문제: README/Codex agent instructions에는 progressToken이 initialize instructions보다 약하게 노출되어 있어 heavy call에서 parent가 hang처럼 느낄 수 있습니다.

* 코드 위치: `README.md:L576-L595`

* 동작 설명: agent instructions는 tool selection, sessionId reuse, targets/citations 검증을 말하지만 `status`, `evidenceQuality`, `searchCoverage`, `failure`, `session`을 반드시 요약하라는 template은 없습니다.

* 문제: sub-agent natural-language summary에서 구조화 metadata가 빠질 수 있습니다. 이 실제 누락은 repo 코드만으로 검증 불가이지만, 문서상 방지 장치가 약합니다.

#### 2. 목표 동작 To-Be

* 기본은 explicit session reuse 유지.
* 옵션으로 repoRoot 기반 자동 session 재사용을 제공합니다.
* progressToken 사용을 heavy tools의 권장 호출 규칙으로 문서화합니다.
* sub-agent 출력 template에 구조화 품질 지표를 필수 포함합니다.
* wrapper tool selection decision rule을 README/AGENTS에 간단히 고정해 tool surface 변동으로 인한 혼란을 줄입니다.

#### 3. 변경 지점

**파일: `src/explorer/session.mjs`**

새 method 추가:

```js
findReusableForRepo(repoRoot = '') {
  let best = null;
  for (const session of this._sessions.values()) {
    if (session.repoRoot !== repoRoot) continue;
    if (Date.now() - session.lastUsedAt > this._ttlMs) continue;
    if (session.calls >= this._maxCalls) continue;
    if (!best || session.lastUsedAt > best.lastUsedAt) best = session;
  }
  if (!best) return null;
  return {
    ok: true,
    session: best,
    remainingCalls: this._maxCalls - best.calls,
  };
}
```

**파일: `src/explorer/config.mjs`**

새 env helper 추가:

```js
export function autoSessionByRepoEnabled(env = process.env) {
  return env.CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO === '1';
}
```

기본값: false

**파일: `src/explorer/runtime.mjs`**

import 추가:

```diff
-import { ... } from './config.mjs';
+import { autoSessionByRepoEnabled, ... } from './config.mjs';
```

`resolveSessionForExplore()` 변경.

Before:

```js
// No session requested — create a new one
const newId = sessionStore.create(repoRoot);
```

After:

```js
if (autoSessionByRepoEnabled() && typeof sessionStore.findReusableForRepo === 'function') {
  const reusable = sessionStore.findReusableForRepo(repoRoot);
  if (reusable?.ok) {
    return {
      ok: true,
      sessionId: reusable.session.id,
      sessionData: reusable.session,
      sessionStatus: 'reused',
      remainingCalls: reusable.remainingCalls,
      sessionSource: 'auto_repo',
    };
  }
}

// No session requested — create a new one
const newId = sessionStore.create(repoRoot);
```

`stats`에 diagnostic 추가:

```js
sessionSource: sessionResolution.sessionSource ?? (session ? 'explicit' : 'created'),
```

`SESSION_SCHEMA.status`는 기존 enum `created|reused|fallback` 유지. 자동 재사용도 `reused`로 표시하고 `_debug.stats.sessionSource='auto_repo'`로 구분합니다.

**파일: `README.md`**

1. env vars 절에 추가:

```md
| `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO` | Optional. `1`이면 explicit `session`이 없을 때 같은 `repo_root`의 최신 reusable session을 자동 재사용합니다. 기본값은 off입니다. multi-client 환경에서는 explicit session 전달을 권장합니다. |
```

2. Codex agent instructions `README.md:L576-L595`에 추가:

```md
For heavy calls or broad report/path/impact tools, pass `_meta.progressToken`.
When summarizing a tool result or sub-agent result, preserve these fields explicitly:
`status.verification`, `status.complete`, `evidenceQuality`, `searchCoverage`, `failure`, `session/sessionId`, and any `critic.warnings`.
```

3. 공개 MCP 도구 절 `README.md:L169-L178`에 decision rule 추가:

```md
Decision rule:
- automation/edit planning/follow-up verification: `explore_repo`
- known symbol/location/claim/change review: narrow wrapper
- human-facing narrative: `explore`
- advanced broad report only: opt-in `explore_v2`
```

**파일: `DESIGN.md`**

* Session contract `DESIGN.md:L235-L241`에 auto session option과 risk 추가.
* Progress section `DESIGN.md:L216-L225`에 parent agents should pass progressToken for potentially long calls 추가.

**파일: `AGENTS.md`**

* public tool surface 변경 문서 matrix 유지.
* 새 invariant 추가:

```md
Sub-agent summaries must preserve control-plane fields: status, evidenceQuality, searchCoverage, failure, session/sessionId, critic warnings.
```

#### 4. 하위 호환성

* 기본값 off이므로 session behavior는 바뀌지 않습니다.
* `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1`에서만 explicit session 없이 reused가 나올 수 있습니다.
* `session.status` enum은 그대로 유지합니다.
* `_debug.stats.sessionSource`는 optional diagnostic입니다.

#### 5. 검증 방법

추가 테스트:

1. `tests/session.test.mjs`

    * `findReusableForRepo()`가 최신 reusable session을 반환.
    * expired/exhausted session은 반환하지 않음.

2. `tests/runtime.mock.test.mjs`

    * env `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1`
    * 같은 repoRoot로 두 번 호출, 두 번째 호출에 `session` 인자 없음.
    * 기대: `session.status='reused'`, `_debug.stats.sessionSource='auto_repo'`.

3. `tests/mcp-server.test.mjs`

    * initialize instructions에 progressToken 문구 유지.
    * README string은 테스트하지 않아도 되지만 integration docs snapshot이 있으면 갱신.

수동 검증:

```bash
CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1 npm test tests/runtime.mock.test.mjs
npm test
```

회귀 위험:

* multi-client MCP server에서 같은 repoRoot session이 의도치 않게 공유될 수 있습니다. 기본 off로 완화합니다.
* maxCalls exhaustion과 fallback semantics가 바뀌지 않아야 합니다. 기존 테스트: `tests/mcp-server.test.mjs:L347-L395`

#### 6. 문서 업데이트

* `README.md:L483-L498` env var table에 auto session 추가.
* `README.md:L576-L595` Codex agent instructions에 progressToken 및 structured metadata preservation 추가.
* `DESIGN.md:L235-L241`, `DESIGN.md:L216-L225` 갱신.
* `AGENTS.md:L17-L25` matrix에 session/progress docs 변경 시 테스트/README 동기화 강조.

#### 7. 리스크 / 미해결 결정

* 자동 session reuse는 convenience와 isolation 사이의 trade-off가 있습니다. 기본 off가 안전합니다.
* sub-agent template은 문서로만 강제하면 외부 agent가 무시할 수 있습니다. 향후 integration package에 machine-readable template을 제공할지 결정해야 합니다.
* progressToken은 MCP client capability에 의존합니다. server만으로 모든 client UI에 progress 표시를 강제할 수 없습니다.

---

## 7. Phase 6 — 타당하지 않거나 부분적으로만 맞는 피드백 반박표

| 클레임                                                            | 반박 또는 보정                                                                                                                                                      | 반증/보정 근거                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| C2: `trace_symbol`은 파일을 읽지 않고 symbol index만으로 끝난다              | 구조상 `trace_symbol`은 `repo_symbol_context` 우선이며, `symbolContext()`는 definition을 찾으면 `readFile()`로 body를 읽습니다. 다만 모델/fallback에 따라 얕게 끝날 수 있어 부분참입니다.            | `src/mcp/server.mjs:L374-L385`, `src/explorer/prompt.mjs:L287-L302`, `src/explorer/repo-tools.mjs:L955-L964`                  |
| C3: `explain_code_path`는 quick budget 때문에 항상 budget_exhausted다 | quick 10턴과 budget_exhausted 경로는 맞지만, 명시 budget이나 auto budget 결과에 따라 normal/deep도 가능합니다. 특정 실행 결과는 tool trace 없이는 검증 불가입니다.                                    | `src/explorer/config.mjs:L155-L195`, `src/explorer/config.mjs:L345-L369`, `src/explorer/runtime.mjs:L1187-L1193`              |
| C5: scope는 전체적으로 hint에 가깝다                                     | 대부분의 도구는 scope를 hard boundary로 enforce합니다. 문제는 `gitDiff()`가 `_filterGitDiffFiles()`를 `enforceScope:true` 없이 호출하는 예외 경로입니다.                                    | `src/explorer/repo-tools.mjs:L556-L615`, `src/explorer/repo-tools.mjs:L1055-L1084`, `src/explorer/repo-tools.mjs:L1194-L1195` |
| C8: 도구 수가 1~9개로 임의 변동한다                                        | 기본/최소/최대는 맞지만, 현재 분기상 가능한 개수는 1, 2, 3, 7, 8, 9개 조합입니다. 모든 숫자가 가능한 것은 아닙니다.                                                                                    | `src/mcp/server.mjs:L246-L257`, `src/mcp/server.mjs:L292-L318`, `tests/mcp-server.test.mjs:L555-L623`                         |
| C10: report targets에 dedupe가 없다                                | exact `path:startLine:endLine` dedupe는 있습니다. 부족한 것은 file-level merge와 range 병합입니다.                                                                            | `src/explorer/runtime.mjs:L502-L524`                                                                                          |
| C11: redaction이 환경변수 이름 필드까지 가린다                               | object key는 redaction하지 않습니다. 문제는 snippet/report 문자열 안의 `process.env.X`가 `.env.*` path regex에 걸리는 것입니다.                                                       | `src/explorer/redact.mjs:L66-L106`, `src/explorer/redact.mjs:L23-L57`                                                         |
| C12: cache hit rate 4.9~6.0%는 session reuse rate다              | 코드상 cache hit rate는 `globalRepoCache`의 LRU hit/miss 통계입니다. 세션 재사용은 `session.status`나 `stats.sessionStatus`로 봐야 합니다.                                           | `src/explorer/cache.mjs:L76-L89`, `src/explorer/runtime.mjs:L1023-L1080`                                                      |
| C14: progress visibility 기능이 없다                                | progress notification 기능은 이미 있습니다. `_meta.progressToken`과 `sendNotification`이 필요하고, 문서/agent 규칙이 더 강해야 하는 문제입니다.                                              | `src/mcp/server.mjs:L485-L498`, `src/mcp/server.mjs:L756-L762`, `src/explorer/runtime.mjs:L1431-L1439`                        |
| C16: sub-agent 경로에서 구조화 metadata가 누락된다                         | 직접 MCP result는 metadata를 보존합니다. sub-agent natural summary는 이 repo에 구현이 없어서 실제 누락 여부는 검증 불가입니다. 다만 README의 sub-agent/agent instruction에는 필수 보존 template이 없습니다. | `src/mcp/server.mjs:L650-L675`, `README.md:L576-L595`                                                                         |

---

## 8. 부록 — 피드백에는 없지만 코드 읽기 중 발견한 이슈

### A1. `searchCoverage`는 output schema required가 아니지만 실제 MCP agent-facing result는 항상 채우는 방향입니다

사실: `EXPLORE_REPO_OUTPUT_SCHEMA.required`에는 `searchCoverage`가 없습니다.
근거: `src/explorer/schemas.mjs:L269-L298`

사실: `toAgentFacingResult()`는 `searchCoverage`가 없으면 `defaultSearchCoverage()`를 넣습니다.
근거: `src/mcp/server.mjs:L650-L675`

영향: public schema와 실제 compact contract/README 설명이 약간 불일치합니다. README는 compact 계약에 `searchCoverage`를 중요 필드로 설명합니다. 근거: `README.md:L173-L178`, `README.md:L277-L280`

권장: `searchCoverage`를 required에 추가할지, optional이지만 “server always emits”로 문서화할지 결정해야 합니다. strict schema consumer를 고려하면 “optional schema, always emitted by server” 문구가 안전합니다.

### A2. `targets[]` role enum에 `discovered`가 없는데 runtime reason은 discovered semantics를 표현합니다

사실: role enum에는 `reference`까지만 있고 `discovered`가 없습니다.
근거: `src/explorer/schemas.mjs:L84-L96`

사실: runtime은 discovered path를 `reference` role로 승격하며 reason 문자열에 “Discovered path”라고 씁니다.
근거: `src/explorer/runtime.mjs:L721-L730`

영향: consumer는 `role:'reference'`만 보고 이것이 report citation인지 discovery-only path인지 구분할 수 없습니다. Spec-2의 `discoveredPaths[]` 분리가 이 문제를 해결합니다.

### A3. README/DESIGN은 scope hard boundary를 강하게 말하지만 `repo_git_diff` 테스트가 없습니다

사실: `gitShow` scope filtering test는 있습니다.
근거: `tests/repo-tools.test.mjs:L622-L642`

사실: `gitDiff`가 base scope를 filter하는 테스트는 검색 결과상 없습니다. 반대로 `gitDiff()` 구현은 scope enforce를 하지 않습니다.
근거: `src/explorer/repo-tools.mjs:L1167-L1195`

권장: Spec-4 테스트를 추가해 문서/구현/테스트를 맞춰야 합니다.
