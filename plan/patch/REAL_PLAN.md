# 실행 우선순위가 반영된 실제 작업 계획표 (Phase별)

이 프로젝트는 지금 **“기능을 더 늘리는 단계”보다 “이미 약속한 계약을 더 정직하게 만드는 단계”**에 가깝습니다.
그래서 실행 순서는 아래 원칙으로 잡는 게 가장 안전합니다.

## 먼저 확정할 방향

이번 사이클에서는 아래처럼 **결정부터 고정**하는 편이 좋습니다.

| 항목                             | 이번 사이클 결정                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Session 처리                     | **명시적 거부**를 기본값으로 채택. invalid / expired / exhausted / repo mismatch 시 새 세션 자동 회전하지 않음 |
| `repo_symbol_context.depth`    | **실구현하지 않음.** 일단 `effectiveDepth=1`로 정직하게 정리                                          |
| `find_similar_code.similarity` | **수치형 similarity 제거**. 자연어 설명 중심으로 유지                                                 |
| project config                 | `entryPoints`만 실제 기능에 연결. `languages`, `customSymbolPatterns`는 문서/주석에서 제외             |
| `explore` 도구                   | **코어(beta) 먼저**, 병렬 실행은 나중                                                            |
| 병렬 tool 실행                     | `explore` 도입과 분리해서 **공용 runtime 리팩터링 Phase**로 뒤로 배치                                   |

---

## 전체 순서 한눈에 보기

| Phase | 목표                                       | 성격               | 위험도 | 릴리즈 가치 |
| ----- | ---------------------------------------- | ---------------- | --- | ------ |
| 1     | Session semantics 고정                     | correctness fix  | 낮음  | 매우 높음  |
| 2     | Git confidence false-low 빠른 완화           | trust fix        | 중간  | 매우 높음  |
| 3     | Git evidence schema + scoring 분리         | 구조 개선            | 높음  | 높음     |
| 4     | 공개 계약 정리 (`depth`, `similarity`, config) | contract cleanup | 중간  | 높음     |
| 5     | `explore` 코어(beta) 도입                    | 기능 추가            | 중간  | 높음     |
| 6     | 공용 runtime 리팩터링 + 제한적 병렬화                | 성능/구조 개선         | 높음  | 중간     |
| 7     | docs / benchmark / examples 최종 정리        | release gate     | 중간  | 높음     |

---

## 공통 실행 규칙

모든 Phase에 아래 규칙을 적용하는 걸 권장합니다.

1. **테스트 먼저, 구현 나중**
   특히 `runtime.mjs`를 건드리는 작업은 regression test 없이 진행하지 않기.

2. **한 PR = 한 의미 변화**
   세션 의미론, git confidence, explorer mode, 병렬화는 각각 따로.

3. **문서 변경은 같은 PR에 포함**
   public contract가 바뀌면 README / DESIGN / tool description도 같이 수정.

4. **`runtime.mjs`는 직렬 작업**
   이 파일은 blast radius가 크므로 여러 기능을 동시에 얹지 않기.

---

# Phase 1. Session semantics hardening

## 목표

현재 `SessionStore.isExhausted()`는 존재하지만 `ExplorerRuntime.explore()` 경로에서 실제로 쓰이지 않습니다.
먼저 이 문제를 **명시적이고 예측 가능한 세션 계약**으로 고정해야 합니다.

## 이번 Phase에서 확정할 정책

`session` 파라미터가 **없을 때만** 새 세션 생성
`session` 파라미터가 **있을 때**는 아래 상태를 구분

| 상태                    | 처리    |
| --------------------- | ----- |
| 유효한 세션                | 재사용   |
| 존재하지 않음 / 만료됨         | 에러 반환 |
| exhausted             | 에러 반환 |
| 다른 `repo_root`에 묶인 세션 | 에러 반환 |

자동 회전(auto-rotate)은 이번 사이클에서는 넣지 않는 편이 좋습니다.
이 프로젝트는 “continuity를 정직하게 전달하는 것”이 더 중요하기 때문입니다.

## 작업 항목

### 1) runtime에 session resolution helper 추가

`src/explorer/runtime.mjs`

예상 흐름:

* `resolveSessionForExplore(sessionStore, requestedSessionId, repoRoot)`
* 반환:

   * `sessionId`
   * `sessionData`
   * `sessionStatus: created | reused`
* 실패:

   * `invalid_session`
   * `expired_session`
   * `exhausted_session`
   * `repo_mismatch`

### 2) `repoRoot` binding 검증 추가

현재 `SessionStore.create(repoRoot)`는 repoRoot를 저장하지만, 재사용 시 이 값을 검증하지 않습니다.
반드시 체크해야 합니다.

### 3) 결과 metadata에 session 상태 드러내기

`stats` 또는 top-level additive field에 아래 정보 추가 권장:

```json
{
  "stats": {
    "sessionId": "sess_xxx",
    "sessionStatus": "created | reused",
    "remainingCalls": 3
  }
}
```

### 4) MCP error surface 정리

`src/mcp/server.mjs`

invalid session은 그냥 “새 세션이 생김”이 아니라, 사용자/상위 모델이 이해할 수 있는 에러로 돌려야 합니다.

예시 메시지:

* `Invalid session: expired`
* `Invalid session: exhausted`
* `Invalid session: bound to a different repository root`

## 수정 파일

* `src/explorer/runtime.mjs`
* `src/explorer/session.mjs`
* `src/mcp/server.mjs`
* `tests/runtime.mock.test.mjs`
* `tests/session.test.mjs`

## 완료 기준

* exhausted session 재사용 시 새 세션이 silently 생성되지 않음
* repo mismatch session 재사용이 차단됨
* 유효한 세션은 정상 재사용됨
* `session` 없이 호출하면 새 세션 생성
* 관련 테스트가 모두 통과

## PR 분리 권장

**PR-1: Session enforcement only**

이 Phase는 작지만 가치가 큽니다.
독립 패치 릴리즈 후보로 삼아도 됩니다.

---

# Phase 2. Git confidence false-low fast-path stabilization

## 목표

git 기반 질문에서 구조적으로 `low`가 되는 현상을 먼저 줄입니다.
이 Phase에서는 **public evidence schema는 아직 바꾸지 않고**, 내부 grounding을 먼저 개선합니다.

## 핵심 아이디어

지금은 `observedRanges`가 사실상 `repo_read_file` / `repo_grep` 중심입니다.
이를 조금 넓혀서:

* `repo_git_blame` → line range 관측
* `repo_git_diff` / `repo_git_show` → diff hunk line range 관측
* `repo_git_log`만 사용된 경우 → unsupported evidence를 곧바로 hallucination처럼 취급하지 않음

으로 바꿉니다.

## 작업 항목

### 1) blame line 관측 추가

`src/explorer/runtime.mjs`

`repo_git_blame` 결과의 `lines[]`를 읽어 `observedRanges` 또는 별도 observed structure에 반영합니다.

예:

* path + line 단위 관측
* contiguous range merge 가능하면 더 좋음

### 2) diff/show hunk 파싱 추가

`src/explorer/repo-tools.mjs`

현재 `parseDiffOutput()`은 파일별 additions/deletions 카운트와 patch 문자열 위주입니다.
여기에 **hunk line range 추출**을 추가해야 합니다.

필요한 최소 정보:

* new file 기준 start/end range
* 가능하면 old/new range 모두 추출

이 Phase에서는 일단 **new-file range 기준 grounding**만 해도 충분합니다.

### 3) `repo_git_log` 전용 질문에 대한 confidence 완화

`src/explorer/schemas.mjs`의 `computeConfidenceScore()`

현재는 grounded evidence가 0이면 거의 자동으로 `score=0.1`로 떨어집니다.
이걸 그대로 두면 git log 중심 질문이 계속 손해를 봅니다.

이번 Phase에서는 다음 정도의 완화가 적절합니다.

* `gitLogCalls > 0` 이고
* `recentActivity`가 존재하며
* malformed evidence가 없고
* budget stop도 아니면

무조건 `low`로 고정되지 않게 floor를 완화

핵심은 **“file-range가 없었다”와 “근거가 부실했다”를 동일시하지 않는 것**입니다.

### 4) confidence factors에 git activity 힌트 추가

예:

```json
{
  "confidenceFactors": {
    "gitLogCalls": 1,
    "gitDiffCalls": 1,
    "gitBlameCalls": 0,
    "gitGroundingHint": true
  }
}
```

## 수정 파일

* `src/explorer/runtime.mjs`
* `src/explorer/repo-tools.mjs`
* `src/explorer/schemas.mjs`
* `tests/runtime.mock.test.mjs`
* `tests/repo-tools.test.mjs`

## 완료 기준

* blame 기반 질문에서 line evidence retain 비율이 올라감
* diff/show 기반 질문에서 patch-derived line evidence가 grounding됨
* log-only history 질문이 구조적 이유만으로 자동 `low`가 되지 않음
* 기존 file-range 질문 confidence 동작은 유지

## 주의사항

이 Phase는 **임시 완화책**입니다.
여기서 멈추면 안 되고, 반드시 다음 Phase의 schema 확장으로 이어져야 합니다.

---

# Phase 3. Git evidence schema 확장 + scoring 분리

## 목표

git evidence를 file-range에 억지로 끼워 맞추지 않고, **first-class evidence type**으로 승격합니다.

이 Phase가 끝나야 git confidence 문제를 “근본적으로” 해결했다고 말할 수 있습니다.

## 이번 Phase에서 채택할 스키마 방향

`evidence[]`는 유지하되, 각 item에 `kind`를 추가하는 additive 확장으로 갑니다.

추천 형태:

```json
{
  "kind": "file_range | git_commit | git_diff_hunk | git_blame_line",
  "path": "optional",
  "startLine": 10,
  "endLine": 18,
  "commit": "optional",
  "author": "optional",
  "oldPath": "optional",
  "newPath": "optional",
  "oldStartLine": 1,
  "oldEndLine": 5,
  "newStartLine": 10,
  "newEndLine": 14,
  "why": "..."
}
```

## 작업 항목

### 1) `EXPLORE_RESULT_JSON_SCHEMA` 확장

`src/explorer/schemas.mjs`

중요한 점은 **backward compatibility**입니다.

권장 방식:

* legacy file-range evidence도 계속 허용
* `kind`가 없으면 normalize 단계에서 `file_range`로 간주
* strict schema는 유지하되, git 필드들을 optional로 추가

### 2) `normalizeExploreResult()` kind-aware 처리

현재는 evidence를 무조건 `path/startLine/endLine/why`로 정규화합니다.
이걸 아래처럼 바꿔야 합니다.

* legacy evidence → `kind: file_range`
* `git_commit` → `commit`, `path?`, `why`
* `git_blame_line` → `path`, `line`, `commit`, `author?`, `why`
* `git_diff_hunk` → old/new range 계열 허용

### 3) runtime grounding 분기

`src/explorer/runtime.mjs`

`checkEvidenceGrounding()`를 단일 함수로 두지 말고, kind별 함수로 나누는 게 좋습니다.

예:

* `groundFileRangeEvidence`
* `groundGitCommitEvidence`
* `groundGitDiffHunkEvidence`
* `groundGitBlameLineEvidence`

### 4) confidence drop reason 분리

`computeConfidenceScore()`를 아래처럼 재구성합니다.

```json
{
  "droppedUnsupported": 0,
  "droppedUngrounded": 1,
  "droppedMalformed": 0
}
```

필요하면 추가로:

* `droppedOutOfScope`
* `droppedRepoMismatch`

도 고려할 수 있습니다.

### 5) prompt contract 정리

`src/explorer/prompt.mjs`

이 Phase 안에서 같이 정리하는 편이 좋습니다.
이제 모델은 “git evidence type도 정당한 근거”라는 걸 명시적으로 알아야 합니다.

지시 예시:

* history 질문에서는 commit/hash/diff hunk/blame line을 evidence로 써도 됨
* current code semantics를 주장할 때는 file read로 보강 권장

## 수정 파일

* `src/explorer/schemas.mjs`
* `src/explorer/runtime.mjs`
* `src/explorer/prompt.mjs`
* 필요 시 `src/explorer/repo-tools.mjs`
* `tests/runtime.mock.test.mjs`
* `tests/benchmark-evaluator.test.mjs`

## 완료 기준

* git evidence가 structural reason만으로 drop되지 않음
* evidence drop reason이 설명 가능하게 metadata에 남음
* file-only 질문의 scoring regression 없음
* git-guided / blame-guided 회귀 테스트 통과

## PR 분리 권장

이 Phase는 가능하면 둘로 나누는 게 좋습니다.

* **PR-3A:** schema + normalize + grounding
* **PR-3B:** scoring + prompt contract

한 PR에 다 몰면 리뷰가 어려워집니다.

---

# Phase 4. 공개 계약 정리 (`depth`, `similarity`, config)

## 목표

이 Phase는 “작동하는 것만 약속한다”를 문서와 코드에 반영하는 단계입니다.
새 기능보다 사용자 신뢰 회복이 목적입니다.

---

## 4-1. `repo_symbol_context.depth`

### 이번 사이클 결정

**`depth > 1` 구현하지 않음**

대신:

* 입력은 당장 깨지지 않게 계속 받되
* 내부에서는 `effectiveDepth = 1`로 clamp
* description / README / DESIGN에 “현재 direct callers만 지원” 명시

### 이유

완전한 `depth > 1`은 단순 반복 호출이 아니라 caller graph 추출 문제에 가깝고, 지금 아키텍처의 regex 기반 심볼 분석과 잘 맞지 않습니다.

### 작업

* `src/explorer/repo-tools.mjs`
* `README.md`
* `DESIGN.md`

가능하면 반환에 additive field 추가:

```json
{
  "effectiveDepth": 1
}
```

---

## 4-2. `find_similar_code.similarity`

### 이번 사이클 결정

**수치형 similarity 기대 제거**

### 이유

현재 구현은 dedicated similarity engine이 아니라 `explore_repo` wrapper입니다.
지금 숫자를 붙이면 가짜 precision이 됩니다.

### 작업

* README 예시에서 numeric similarity 제거
* DESIGN의 future item과 current behavior 구분
* 필요 시 tool description에 “natural-language reasoning-based similarity” 성격 명시

수치형 score는 나중에 별도 RFC로 분리:

* heuristic-v1
* embedding-based
* hybrid rank only

이번 사이클에는 넣지 않는 것이 맞습니다.

---

## 4-3. Project config cleanup

### 이번 사이클 결정

* `entryPoints` → **실제 기능 연결**
* `languages` → 문서/주석에서 제거
* `customSymbolPatterns` → 문서/주석에서 제거

### `entryPoints` 연결 방식

`buildCodeMap()`과 architecture 질문 힌트에 활용합니다.

예:

* codeMap entry point 추정 시 filename heuristic보다 config 우선
* diagram 생성 시 configured entryPoints 우선 표시
* breadth-first 탐색 초기에 entry file seed로 사용 가능

### 작업

* `src/explorer/config.mjs`
* `src/explorer/runtime.mjs`
* `tests/project-config.test.mjs`
* `README.md`
* `DESIGN.md`

## 완료 기준

* README/DESIGN/주석/실제 behavior가 일치
* `depth`와 `similarity`에 대해 사용자 기대치가 과장되지 않음
* `entryPoints`가 실제 output/codeMap에 반영됨

## 이 Phase의 위치가 중요한 이유

이 정리가 끝나야 `explore`라는 새 public tool을 추가해도 “문서만 멋지고 실제는 다름” 상태를 반복하지 않게 됩니다.

---

# Phase 5. `explore` 코어(beta) 도입

## 목표

자유형 탐색 도구를 도입하되, **공유 runtime 대수술 없이** 먼저 코어 기능만 안정적으로 넣습니다.

핵심은:

* natural-language report
* same repository toolset
* same read-only boundary
* no parallel runtime refactor yet

## 이번 Phase에서 꼭 반영할 설계

### 1) 입력 스키마에 `language`와 `context`를 처음부터 넣기

기획 문서 초안에는 빠져 있지만, 실제로는 초기에 넣는 편이 맞습니다.

추천 input:

* `prompt`
* `thoroughness`
* `scope`
* `repo_root`
* `session`
* `language`
* `context`

### 2) output은 `report` + `structuredContent` 병행

권장 형태:

```json
{
  "content": [{ "type": "text", "text": "<markdown report>" }],
  "structuredContent": {
    "report": "<same markdown report>",
    "filesRead": ["..."],
    "toolsUsed": 12,
    "elapsedMs": 8500,
    "sessionId": "sess_xxx",
    "stats": { ... }
  }
}
```

`filesExamined`보다는 **`filesRead`** 또는 `pathsTouched`가 더 정직합니다.

### 3) `freeExplore()`는 public 메서드로 분리하되, 내부 공통 조각은 공유

좋은 방향:

* public method는 분리
* 내부 repo init / message loop / stats 수집은 helper로 공유

### 4) beta feature flag 권장

공개 노출 전 아래 같은 환경변수로 beta gate를 거는 편이 좋습니다.

예:

* `CEREBRAS_EXPLORER_ENABLE_EXPLORE=true`

초기 배포에서는 기본 off도 고려할 만합니다.

## 작업 항목

### 1) 새 스키마/출력 스키마 정의

`src/explorer/schemas.mjs` 또는 별도 `explore-report-schema`

### 2) 새 프롬프트 추가

`src/explorer/prompt.mjs`

주의:

* 사실 / 해석 / 불확실성 구분
* 주요 주장에 file path/line 또는 git artifact 근거 요구
* “더 읽어야 결론이 바뀔 가능성이 낮으면 멈추라”는 stop rule 포함

### 3) runtime 메서드 추가

`src/explorer/runtime.mjs`

`freeExplore()` 구현:

* thoroughness → budget mapping
* freeform prompt builder
* final answer는 text report 추출
* structuredContent metadata 구성

### 4) SessionStore를 mode-neutral packet으로 최소 정리

현재 `SessionStore.update()`는 structured explore 결과 shape에 기대고 있습니다.
`explore`를 넣기 전에 아래처럼 중립화하는 게 좋습니다.

예:

```js
sessionStore.update(id, {
  candidatePaths,
  sourcePaths,
  summary,
  followups,
  mode
});
```

`explore`는 `report`를 요약한 짧은 summary만 session memory에 넣으면 충분합니다.

### 5) MCP server 등록

`src/mcp/server.mjs`

툴 설명에서 반드시 역할을 분리:

* `explore_repo`: structured JSON for automation
* `explore`: human-readable report

## 수정 파일

* `src/explorer/runtime.mjs`
* `src/explorer/prompt.mjs`
* `src/explorer/schemas.mjs`
* `src/explorer/session.mjs`
* `src/mcp/server.mjs`
* `tests/mcp-server.test.mjs`
* `tests/runtime.mock.test.mjs`

## 완료 기준

* `explore`가 markdown report를 정상 반환
* `structuredContent.report`와 text content가 일관됨
* 세션 연속성은 최소 수준으로 작동
* 기존 `explore_repo`는 회귀 없음
* 문서에 beta 성격과 tool selection 가이드가 포함됨

## 이번 Phase에서 **하지 않을 것**

* 병렬 tool 실행
* 복잡한 auto-thoroughness
* 고급 format 옵션
* `explore_repo`와 공용 loop 대수술

---

# Phase 6. 공용 runtime 리팩터링 + 제한적 병렬화

## 목표

이 Phase는 **Explorer Mode 고도화가 아니라 core runtime refactor**입니다.
위험도가 가장 높으므로, `explore` 코어가 안정된 뒤로 미루는 것이 맞습니다.

## 권장 접근

### 6-A. 먼저 공용 orchestration 추출

`runtime.mjs`에서 아래 공용 부분을 helper로 분리:

* repo init
* tool loop
* stats
* candidate path tracking
* observed artifact tracking

이걸 먼저 하지 않으면 `explore()`와 `freeExplore()`가 서서히 drift합니다.

### 6-B. 병렬화는 bounded concurrency로 시작

처음부터 무제한 `Promise.all`은 피하는 게 좋습니다.

권장:

* concurrency cap 3~4
* `Promise.allSettled`
* 원래 tool call 순서대로 messages append
* duplicate file read dedupe
* 부분 실패 허용

### 6-C. 병렬화 대상은 “안전한 도구”부터

중요한 현실 체크:
현재 git/grep 일부는 sync subprocess 기반이어서, 코드를 병렬처럼 바꿔도 실제 이득이 제한될 수 있습니다.

그래서 1차 병렬화는 다음 같은 도구부터 시작하는 것이 현실적입니다.

* `repo_read_file`
* `repo_list_dir`
* 일부 cached lookup
* 독립적인 symbol lookup

git 계열까지 진짜 병렬 이득을 보려면 이후 async subprocess 전환이 필요할 수 있습니다.

## 작업 항목

* 공용 tool loop helper 추출
* message ordering 보존
* in-flight dedupe
* partial failure policy
* progress notification 정합성 유지
* parallel stats 추가 가능

## 수정 파일

* `src/explorer/runtime.mjs`
* `src/explorer/repo-tools.mjs`
* 필요 시 `src/explorer/cache.mjs`
* `tests/runtime.mock.test.mjs`

## 완료 기준

* `explore_repo`와 `explore`가 같은 core loop를 공유
* 순서가 뒤섞이지 않음
* 중복 읽기 감소
* 일부 tool 실패가 전체 턴 실패로 번지지 않음
* 병렬화로 기존 회귀가 생기지 않음

## 이 Phase를 뒤로 미루는 이유

이 작업은 `runtime.mjs`의 blast radius가 가장 큽니다.
세션/신뢰도/새 도구 도입이 안정되기 전에 먼저 하면 디버깅이 매우 어려워집니다.

---

# Phase 7. docs / benchmark / examples 최종 정리

## 목표

앞선 모든 변경이 외부 사용자에게 **정확하게 보이도록** 마무리합니다.

## 작업 항목

### 1) README / DESIGN 최종 동기화

반드시 반영할 것:

* session invalid/exhausted semantics
* `repo_symbol_context.depth` 실제 동작
* `find_similar_code`가 score를 주지 않는다는 점
* project config에서 실제 지원하는 필드
* `explore`와 `explore_repo`의 역할 차이
* `explore`가 beta인지 여부

### 2) examples 갱신

* `examples/expected-response.json`
* `examples/explore-request.json`
* 새 `explore` 예시 필요 시 추가

### 3) benchmark 강화

추가 권장 케이스:

* git-guided false-low regression
* blame-guided grounding
* diff/show evidence retention
* `explore` smoke benchmark는 정답 비교보다 format/sanity 위주

### 4) tool description 재점검

`server.mjs`의 설명문은 MCP 클라이언트가 그대로 보고 tool selection에 활용할 가능성이 큽니다.
설명문을 아주 명확히 써야 합니다.

## 수정 파일

* `README.md`
* `DESIGN.md`
* `benchmarks/core.json`
* `scripts/run-benchmark.mjs`
* `tests/benchmark-evaluator.test.mjs`
* `examples/*`
* `src/mcp/server.mjs`

## 완료 기준

* 문서/예시/스키마/실제 동작이 일치
* benchmark가 git confidence 회귀를 잡음
* `explore` / `explore_repo` 선택 기준이 명확함

---

# 권장 PR 순서

실제로는 아래처럼 끊는 게 가장 관리하기 쉽습니다.

| PR    | 내용                                                            |
| ----- | ------------------------------------------------------------- |
| PR-1  | Session enforcement + repoRoot validation + tests             |
| PR-2  | Git confidence fast-path stabilization + tests                |
| PR-3A | Git evidence schema expansion + normalize/grounding           |
| PR-3B | Confidence scoring split + prompt contract update             |
| PR-4  | Contract cleanup (`depth`, `similarity`, config/entryPoints`) |
| PR-5  | `explore` core(beta)                                          |
| PR-6  | Shared runtime refactor + bounded parallel execution          |
| PR-7  | Docs / benchmark / examples final sweep                       |

---

# 병렬 진행 가능 / 불가

## 병렬 진행 비권장

아래는 같은 시점에 진행하지 않는 편이 좋습니다.

* Phase 2 ↔ Phase 5
  둘 다 `runtime.mjs`를 깊게 건드립니다.
* Phase 3 ↔ Phase 6
  evidence/grounding과 shared loop refactor가 서로 얽힙니다.
* Phase 5 ↔ Phase 6
  `explore` core가 안정되기 전에 병렬화하면 원인 추적이 어려워집니다.

## 부분 병렬 가능

* Phase 4의 문서 정리는 Phase 3 후반부터 초안 작성 가능
* benchmark 케이스 설계는 Phase 2부터 병행 가능
* `entryPoints` 테스트 작성은 Phase 3 후반과 병행 가능

---

# 최종 추천 순서 한 줄 요약

> **Session 고정 → Git 신뢰도 정상화 → 공개 계약 정리 → `explore` 코어(beta) → 공용 runtime 병렬화 → 최종 문서/벤치마크 정리**

이 순서가 좋은 이유는 단순합니다.
지금 이 프로젝트의 가장 큰 리스크는 “기능이 부족한 것”이 아니라 **도구 계약과 신뢰도 신호가 어긋나는 것**이기 때문입니다.

원하시면 다음 단계로 바로 이어서
**각 Phase를 GitHub Issue / 체크리스트 형태로 쪼갠 실행용 TODO 문서**로 바꿔드리겠습니다.
