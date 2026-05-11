# cerebras-explorer-mcp 기획서

## 1. 배경

요구사항은 단순한 “Cerebras 연동”이 아니라 다음과 같습니다.

- 메인 모델은 Claude Code 또는 Codex 그대로 유지한다.
- Cerebras는 **서브 개념**이어야 한다.
- 사용할 모델은 기본값 `zai-glm-4.7`이지만, 필요하면 환경 변수로 바꿀 수 있다.
- 목적은 코드 생성 보조가 아니라 **탐색(explorer)** 이다.
- 상위 모델이 여러 번 `Read/Grep/Glob`를 쓰지 않고, **한 번 위임**하면 explorer가 자율적으로 파일을 찾고 읽고 결론을 내야 한다.
- 그 결과로 Claude Code / Codex 사용량을 절감해야 한다.

이 기획서는 위 요구를 만족하는 MCP 기반 external explorer를 정의한다.

---

## 1.1 설계 제약

- zero dependencies 원칙을 유지한다. Node 표준 라이브러리를 우선하고, 새 패키지는 명확한 필요가 있을 때만 별도 결정한다.
- Node.js 22 이상을 기준 런타임으로 유지한다.
- read-only 원칙을 유지한다. explorer와 내부 repo tools는 저장소 파일을 수정하지 않는다.
- secret deny-list는 민감 파일을 traversal/read/grep/symbol/snippet 및 provider-facing tool message 경로에서 기본 차단한다. 비활성화 옵션은 로컬 디버깅 용도로만 둔다.
- redaction은 line reference를 유지하고 민감 문자열만 `[REDACTED:<rule>]`로 치환한다. redacted evidence에는 `redacted`와 `redactions`를 additive metadata로 붙인다.
- `explore_repo` 입출력 스키마는 기존 클라이언트를 깨지 않는 additive change 중심으로 확장한다.

---

## 2. 입력 근거

### 2.1 Claude Code 소스에서 가져온 방향

업로드된 Claude Code 소스 기준으로 다음 특징이 보인다.

1. built-in `Explore` agent는 **빠른 read-only 탐색기** 역할이다.
   - 파일 수정이 금지된다.
   - glob / grep / read 중심으로 탐색한다.
   - 최종 보고를 직접 메시지로 돌려준다.
   - 빠른 탐색을 위해 `CLAUDE.md`를 생략한다.

2. custom agent는 frontmatter로 제어할 수 있다.
   - `mcpServers`
   - `disallowedTools`
   - `model`
   - 기타 prompt / 도구 범위

3. skill은 `context: fork` + `agent:` 구조를 통해 분리된 하위 컨텍스트를 사용할 수 있다.

이것은 “탐색 전용 sub-agent”라는 개념이 Claude Code의 철학과 잘 맞는다는 뜻이다.

### 2.2 기존 `cerebras-code-mcp` 저장소에서 가져온 방향

업로드된 `cerebras-code-mcp`는 다음 형태다.

- MCP 서버 하나
- 고수준 도구 하나(`write`)
- 내부적으로 Cerebras chat completion 호출

가져올 점:

- **MCP tool 하나로 상위 모델의 복잡한 워크플로를 감춘다**는 점
- Cerebras 호출을 서버 내부 구현으로 숨긴다는 점

버릴 점:

- 쓰기 중심 설계
- `zai-glm-4.7` 기본값
- 코드 생성/수정 도구 중심 UX

결론적으로 이번 설계는 기존 `write` MCP를 `explore_repo`로 치환한 읽기 전용 구조다.

---

## 3. 핵심 목표

### 목표

- 상위 모델은 **한 번만 위임**한다.
- 자율 탐색 루프는 **MCP 서버 내부에서** 끝난다.
- 상위 모델 토큰을 아끼기 위해, low-level 파일 검색 도구는 부모에게 넘기지 않는다.
- 반환은 항상 구조화된 JSON이다.

### 비목표

- 코드 수정
- 테스트 실행
- 셸 명령 자동 실행

> **참고:** 런타임 모델 자동 라우팅(`CEREBRAS_EXPLORER_AUTO_ROUTE`)과 failover provider(`EXPLORER_FAILOVER`) 기능이 내부 구현으로 존재하지만, 공개 계약(제품 목표)은 **Cerebras 기반 explorer**에 한정한다. 해당 기능은 내부 구현 메모 수준이며, 지원을 약속하는 공개 기능이 아니다.

---

## 4. 왜 low-level MCP 도구를 직접 노출하지 않는가

잘못된 설계는 이런 형태다.

```text
Parent model
  -> repo_list_dir
  -> repo_grep
  -> repo_read_file
  -> repo_read_file
  -> repo_grep
  -> ...
```

이 구조에서는 탐색 orchestration을 부모 모델이 맡게 된다. 그러면 결국 Claude/Codex가 계속 탐색 토큰을 소비하게 되고, “Cerebras를 explorer로 써서 메인 사용량을 줄인다”는 목표가 약해진다.

따라서 바른 설계는 이 형태다.

```text
Parent model
  -> explore_repo(...)
    -> explorer runtime
      -> model-driven tool loop
      -> structured result
```

즉, `explore_repo`는 단순한 편의 함수가 아니라 **독립 실행형 explorer 서브시스템의 단일 진입점**이다.

---

## 5. 아키텍처

```text
Claude Code / Codex
  -> MCP: explore_repo
    -> ExplorerRuntime
      -> RepoToolkit
         - repo_list_dir
         - repo_find_files
         - repo_grep
         - repo_symbols
         - repo_references
         - repo_symbol_context
         - repo_read_file
         - repo_git_log
         - repo_git_blame
         - repo_git_diff
         - repo_git_show
      -> CerebrasChatClient
         - model: configurable via env (default zai-glm-4.7)
      -> final grounded JSON
```

### 5.1 컴포넌트 역할

#### `RepoToolkit`

저장소를 읽기 전용으로 탐색한다.

- 디렉터리 목록
- 파일 glob 검색
- 정규식 grep
- 심볼 정의 추출
- 심볼 사용처 추적
- 심볼 컨텍스트 매크로 호출
- 특정 파일 라인 범위 읽기
- git 이력 조회, blame, diff, show

#### `CerebrasChatClient`

Cerebras chat completion API에 직접 연결한다.

- 모델 기본값: `zai-glm-4.7`
- override: `CEREBRAS_EXPLORER_MODEL` 또는 `CEREBRAS_MODEL`
- tool calling 지원
- structured final JSON 유도

**Cerebras API 호환성 주의사항**

Cerebras는 OpenAI 호환 API를 제공하지만, 일부 OpenAI 전용 파라미터는 지원하지 않는다. 지원하지 않는 파라미터를 포함하면 `422 Unprocessable Entity` 에러가 발생한다.

| 파라미터 | OpenAI | Cerebras | 비고 |
|---------|--------|----------|------|
| `tools[].function.strict` | ✅ | ❌ | tool argument 스키마 강제 검증 (OpenAI 전용) |
| `clear_thinking` | ❌ | ✅ (GLM 4.7 전용) | multi-turn agent loop에서 이전 reasoning 보존 |
| `response_format.json_schema.strict` | ✅ | ✅ | structured output 스키마 강제 (지원됨) |
| `reasoning_effort` | ✅ | ✅ | GLM 4.7에서는 `"none"`만 사용해 reasoning을 끄고, 기본 reasoning은 파라미터를 생략해 유지 |
| assistant `reasoning` field | ❌ | ✅ | reasoning이 있는 assistant 메시지를 다음 turn에 다시 넘겨 preserved thinking을 유지 |

`tools[].function.strict`와 `response_format.json_schema.strict`는 이름이 같지만 위치와 역할이 다르다. 전자는 tool 인자 검증(OpenAI 전용), 후자는 응답 JSON 스키마 강제(Cerebras 지원)이다.

GLM 4.7 마이그레이션 기준으로 explorer runtime은 다음 원칙을 따른다.

- quick budget: `reasoning_effort="none"`
- normal/deep budget: reasoning 파라미터를 생략해 기본 reasoning 유지
- multi-turn tool loop: `clear_thinking=false` + assistant `reasoning` 재주입으로 preserved thinking 유지
- 샘플링 기본값: budget별 temperature (`quick`: 0.3, `normal`: 0.8, `deep`: 1.0), `top_p=0.95`

#### `ExplorerRuntime`

실제 autonomous loop를 담당한다.

- system/user prompt 구성
- budget 설정
- tool loop 실행
- evidence grounding
- 최종 결과 정규화

#### `MCP Server`

기본적으로 상위 모델에게 8개의 도구를 노출한다: `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `explore_repo`, `explore`.

- `CEREBRAS_EXPLORER_EXTRA_TOOLS=false`로 설정하면 목적형 wrapper 6개가 비활성화된다.
- `explore_v2`는 advanced 도구이며 `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true`일 때만 노출된다.
- `CEREBRAS_EXPLORER_ENABLE_EXPLORE=false`로 설정하면 `explore`가 비활성화된다.

모든 공개 MCP 도구는 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true` annotations를 선언한다. 이 annotations는 클라이언트 UX와 승인 정책을 돕는 hint이며, 실제 보안 경계는 read-only repo toolkit, path 검증, secret policy에서 제공한다.

#### 동시 요청 처리

`StdioJsonRpcServer`(`src/mcp/jsonrpc-stdio.mjs`)는 요청을 **병렬**로 처리한다.

- `processBuffer()`는 버퍼에서 메시지를 파싱한 즉시 `dispatchMessage()`를 fire-and-forget으로 실행한다. 탐색 한 건(15~30초)이 진행 중이어도 다음 요청이 즉시 시작된다.
- `send()` 메서드 내부에 `_sendQueue` promise chain을 두어 stdout 쓰기를 직렬화한다. 동시에 응답이 완료되어도 JSON 메시지가 뒤섞여 스트림이 오염되지 않는다.
- stdio 모드에서 console 출력은 stderr로 라우팅한다. stdout에는 NDJSON 또는 Content-Length JSON-RPC frame만 기록되어야 한다.
- `notifications/cancelled`를 수신하면 `AbortController.abort()` 직후 Map에서도 즉시 제거하여 완료된 요청의 컨트롤러가 잔류하지 않는다.

> **설계 이유**: 탐색 요청은 외부 Cerebras API를 반복 호출하는 비동기 작업이다. 직렬 처리는 한 요청이 수십 초를 점유하는 동안 나머지 모든 요청을 큐에 묶어두므로, 상위 모델이 두 도구를 동시에 호출하는 일반적인 사용 패턴에서 두 번째 요청이 hang처럼 보였다.

| 도구 | 반환 형식 | 적합한 상황 |
|------|----------|-----------|
| `explore_repo` | 구조화된 JSON | 자동화, 파이프라인, 후처리 |
| `explore` | Markdown 보고서 | 아키텍처 개요, 광범위한 질문 |
| `explore_v2` | Markdown 보고서 (강화) | 넓은 탐색 범위, 컨텍스트 오버플로 위험이 있는 deep 탐색 |

`explore`와 `explore_v2`는 같은 `_initExploreContext()` 인프라를 공유하며, 세션도 호환된다. `explore_v2`는 LLM 기반 대화 요약, 도구 결과 예산 관리, 최대 출력 복구 기능을 추가로 제공한다.

#### 세션 계약

- MCP `structuredContent`에서는 세션이 top-level `sessionId`로 반환되며, 다음 호출에서 `session` 파라미터로 전달하면 재사용된다.
- runtime raw result에는 backward compatibility를 위해 `stats.sessionId`도 남긴다.
- 명시적으로 요청된 세션이 invalid 또는 repo_mismatch인 경우 에러를 반환한다.
- 명시적으로 요청된 세션이 expired 또는 exhausted인 경우 새 세션으로 fallback하고, `stats.sessionStatus`에 `fallback`을 표시한다.
- `stats.sessionStatus`가 `created`, `reused`, `fallback` 중 하나를 표시하고, `stats.remainingCalls`가 남은 호출 수를 표시한다.
---

## 6. 독립성 정의

여기서 “main과 독립적인 explorer”는 다음 의미다.

1. 부모는 내부 탐색 단계를 모르고, 안 알아도 된다.
2. explorer는 자신의 도구 루프를 스스로 결정한다.
3. 부모는 결과만 받고 필요한 경우 일부 evidence만 재검증한다.
4. explorer 컨텍스트는 부모 대화와 분리된다.

즉, 이 explorer는 Claude Code 내장 Explore와 비슷한 역할을 하지만, **외부 MCP 뒤에서 선택된 Cerebras 모델로 돌아간다**는 점이 다르다.

---

## 7. 모델 정책

- 기본 모델: `zai-glm-4.7`
- override: `CEREBRAS_EXPLORER_MODEL` 또는 `CEREBRAS_MODEL`
- budget별 모델 지정: `CEREBRAS_EXPLORER_MODEL_QUICK`, `CEREBRAS_EXPLORER_MODEL_NORMAL`, `CEREBRAS_EXPLORER_MODEL_DEEP`

이 프로젝트의 문서화된 계약은 Cerebras provider 기준이다. 모델 이름은 바꿀 수 있지만, 부모 모델이 아닌 explorer 내부 모델만 교체한다.

내부 구현에는 `EXPLORER_PROVIDER` 및 `EXPLORER_FAILOVER` 환경변수를 통한 provider 전환/failover 기능이 존재하나, 이는 공개 계약이 아닌 내부 구현이다.

---

## 8. 내부 도구 설계

### 8.1 `repo_list_dir`

저장소 구조 감잡기용.

### 8.2 `repo_find_files`

파일명/패턴 기반 후보 압축용.

### 8.3 `repo_grep`

심볼, 라우트, 설정 키, 문자열 흔적 찾기용.

- `contextLines` 옵션으로 전후 문맥을 함께 반환할 수 있다.

### 8.4 `repo_symbols`

파일 안의 함수, 클래스, 변수, 타입 정의를 추출한다.

- 현재 구현은 tree-sitter가 아니라 **regex 기반 경량 심볼 인덱서**다.
- 지원 언어별 패턴으로 `{name, kind, line, endLine, exported}`를 만든다.

### 8.5 `repo_references`

특정 심볼의 사용처를 코드베이스 전역에서 찾는다.

- 각 매치를 `import`, `definition`, `usage`로 분류한다.
- 정확한 semantic reference resolver가 아니라 grep + 분류기 기반이다.

### 8.6 `repo_symbol_context`

심볼 하나에 대해 정의 본문과 호출자 정보를 한 번에 반환하는 매크로 도구다.

- symbol-first, reference-chase 질문에서 첫 진입점으로 사용한다.
- `depth` 파라미터는 인터페이스상 1–3을 허용하지만, 실질적으로 `effectiveDepth = 1`로 고정된다 (직접 호출자만 반환).
- 반환값에 `effectiveDepth: 1` 필드가 포함되어 실제 동작을 투명하게 표시한다.

### 8.7 `repo_read_file`

필요한 라인 범위만 읽기용.

### 8.8 `repo_git_log`

특정 파일/디렉터리 또는 전체 저장소의 최근 커밋 흐름을 본다.

### 8.9 `repo_git_blame`

파일의 특정 라인 범위에 대한 작성자와 커밋 정보를 본다.

### 8.10 `repo_git_diff`

두 ref 사이 변경 파일과 patch 또는 diffstat을 본다.

### 8.11 `repo_git_show`

특정 커밋의 메시지와 변경 파일을 본다.

이 도구 집합으로 구조 탐색, 심볼 추적, 코드 읽기, 변경 이력 분석까지 모두 처리한다.

---

## 9. 반환 스키마

runtime raw result는 내부 실행과 디버깅을 위해 풍부한 필드를 유지한다. MCP `structuredContent`는 상위 agent가 바로 읽는 compact contract로 변환한다.

MCP agent-facing contract:

```json
{
  "directAnswer": "string",
  "status": {
    "confidence": "low|medium|high",
    "verification": "verified|targeted_read_needed|follow_up_needed|broad_search_needed",
    "complete": true,
    "warnings": []
  },
  "targets": [
    {
      "path": "relative/path",
      "startLine": 1,
      "endLine": 10,
      "role": "edit|read|test|config|context|reference",
      "reason": "why this target matters",
      "evidenceRefs": ["E1"]
    }
  ],
  "evidence": [
    {
      "id": "E1",
      "path": "relative/path",
      "startLine": 1,
      "endLine": 10,
      "why": "why it matters",
      "snippet": "1: cited source line",
      "evidenceType": "file_range|git_commit|git_blame|git_diff_hunk",
      "groundingStatus": "exact|partial",
      "redacted": "optional — true when secret redaction touched this evidence",
      "redactions": "optional — redaction rule ids applied to this evidence",
      "sha": "optional — commit hash for git evidence",
      "author": "optional — for git_blame/git_commit"
    }
  ],
  "uncertainties": [],
  "nextAction": {
    "type": "stop|read_target|explore_followup|ask_user",
    "reason": "what the parent should do next"
  },
  "sessionId": "sess_...",
  "_debug": {
    "stats": {},
    "confidenceScore": 0.0,
    "confidenceFactors": {}
  }
}
```

반환을 자연어가 아니라 JSON으로 고정한 이유:

- evidence grounding contract는 additive하게 확장한다. redaction이 적용되어도 `path`, `startLine`, `endLine`, `why`, `evidenceType`, `groundingStatus`는 유지하고, `redacted`/`redactions` metadata만 추가한다.

- Claude Code / Codex가 후처리하기 쉽다.
- UI / 로그 / 캐싱이 쉬워진다.
- evidence 재검증이 쉬워진다.

---

## 10. evidence grounding 정책

탐색형 agent의 가장 큰 문제는 “읽지 않은 파일을 안 읽은 척 결론에 넣는 것”이다.

이를 줄이기 위해 구현은 다음 규칙을 갖는다.

- `repo_read_file`로 실제 읽은 line range를 기록한다.
- `repo_grep`로 실제 일치한 line을 기록한다.
- `repo_git_blame`로 조회한 line을 기록한다.
- `repo_git_diff`/`repo_git_show`에서 추출한 hunk range를 기록한다.
- 최종 evidence는 **kind별로 다르게 grounding**한다:
  - `file_range` (기본): 기록된 line range와 겹치는 항목만 유지
  - `git_commit`: git tool 결과로부터 생성된 것이므로 자동 grounded
  - `git_blame`: git tool 결과로부터 생성된 것이므로 자동 grounded
  - `git_diff_hunk`: hunk range 매칭 또는 sha 존재 시 grounded
- 누락된 evidence가 있으면 confidence를 낮추며, `droppedUngrounded`/`droppedMalformed`로 분류한다.

이 정책 덕분에 “탐색은 했다고 하는데 근거가 빈약한” 출력을 줄일 수 있다.

---

## 11. deterministic critic pass

Cerebras Explorer의 제품 목표는 상위 AI가 정확한 판단을 내릴 수 있도록 필요한 코드 근거를 빠르게 수집하고, 적은 컨텍스트로 전달하는 것이다. 따라서 최종 답변을 그대로 통과시키는 것보다, 런타임이 이미 관측한 근거와 통계로 한 번 더 판정해 상위 AI가 어떤 부분을 신뢰하거나 조심해야 하는지 알려주는 critic pass가 필요하다.

### 11.1 왜 필요한가

- 모델이 `confidence: high`를 반환해도 실제 근거가 하나뿐이거나 일부 근거가 관측 범위 밖이면 상위 AI는 그 차이를 알아야 한다.
- 단순히 warning 개수만 반환하면 상위 AI가 답변 전체를 불신하고 다시 파일을 읽을 가능성이 커진다.
- warning에는 사유와 행동 지침이 있어야 한다. 예를 들어 “grep-only partial evidence이므로 해당 range는 약한 근거로 취급”처럼 범위를 좁혀 알려주면 추가 탐색을 줄일 수 있다.
- LLM critic을 기본값으로 두면 추가 모델 호출, 편향, false positive 위험이 생긴다. 첫 구현은 런타임 관측값을 사용하는 deterministic critic으로 둔다.

### 11.2 현재 형태로 좁혀진 과정

초기 아이디어는 별도 critic 모델이 최종 답변을 다시 검토하는 방식이었다. 그러나 이 프로젝트의 철학은 빠른 탐색과 낮은 컨텍스트 비용이므로, 기본 critic이 다시 전체 transcript를 읽거나 두 번째 보고서를 작성하는 방식은 맞지 않는다.

현재 런타임에는 이미 다음 재료가 있다.

- 실제 읽거나 grep/git 도구로 관측한 라인 범위
- git log/blame/show에서 관측한 commit hash
- grounded evidence 필터링 결과
- confidence score와 confidence reconciliation
- budget/error stop 여부

따라서 critic pass는 이 재료를 순수 함수로 평가하는 post-processing layer로 구현한다. `EXPLORE_RESULT_JSON_SCHEMA`는 모델이 생성해야 하는 최소 출력 계약으로 유지하고, critic은 런타임 enrichment로 추가한다.

### 11.3 최종 형태

기본 반환은 compact해야 한다.

```json
{
  "critic": {
    "status": "pass|caution|fail",
    "warnings": [
      {
        "type": "partial_evidence",
        "severity": "low",
        "message": "1 evidence item is grounded only by grep or nearby line observations.",
        "target": "src/auth.js:12-18",
        "action": "Treat this specific evidence item as weaker than an exact file read."
      }
    ]
  }
}
```

규칙:

- 정상 결과는 `status: "pass", warnings: []`로 작게 유지한다.
- warning은 기본 최대 3개만 반환한다.
- 각 warning은 `type`, `severity`, 짧은 `message`, 선택적 `target`, `action`을 포함한다.
- critic은 answer를 재작성하지 않는다. 대신 `confidence`, `trustSummary`, `critic.warnings`로 상위 AI의 판단을 돕는다.
- 상세 진단과 전체 evidence manifest는 기본 반환하지 않는다.

`explore_repo`는 구조화 evidence가 있으므로 strongest critic을 적용한다. `explore`와 `explore_v2`는 Markdown report이므로 citation 존재 여부, cited path와 `filesRead`의 관계, budget/truncation/output recovery 같은 가벼운 report critic을 별도로 적용한다.

---

## 12. 경계 강화 정책

초기 `scope`는 advisory가 아니라 **hard boundary**로 취급한다.

- `repo_find_files`와 `repo_grep`의 추가 `scope`는 초기 범위를 **더 좁히기만** 할 수 있다.
- `repo_list_dir`는 현재 scope 밖 디렉터리를 나열하지 않는다.
- 디렉터리 순회는 scope와 무관한 하위 트리를 큐에 넣지 않는다.
- symlink 항목은 순회 결과에서 숨기고, 직접 읽으려 해도 거부한다.
- 실제 경로는 `realpath`로 확인해 repo root 밖 탈출을 막는다.

즉, scope 확장과 symlink 탈출을 모두 막아서, explorer가 부모가 준 저장소 경계를 넘지 못하게 한다.

---

## 13. budget 정책

### `quick`

- 빠른 1차 탐색
- 얕은 검색
- 토큰 절감 우선

### `normal`

- 대부분의 기본 동작

### `deep`

- 더 많은 반복 탐색 허용
- 넓은 후보군 탐색 가능

이 budget은 runtime 내부 제어값이다. 상위 agent-facing workflow에서는 기본적으로 노출하지 않으며, `budget`은 advanced workflow에서만 명시적으로 사용한다.

일반 Codex/Claude Code 사용에서는 wrapper query와 known anchors만 전달하고 서버가 task, scope, hints를 바탕으로 depth를 선택한다.

---

## 14. Claude Code 통합 방식

Claude Code에서는 두 층으로 붙인다.

### A. MCP 서버 등록

Claude는 `explore_repo`를 하나의 외부 고수준 도구로 본다.

### B. 얇은 sub-agent / skill

- custom agent: 외부 explorer를 우선 사용하도록 지시
- skill: 탐색형 과제에서 그 agent를 부르도록 유도

핵심은 Claude의 native `Read/Grep/Glob`를 먼저 쓰지 않고, **외부 explorer를 먼저 호출**하게 만드는 것이다.

---

## 15. Codex 통합 방식

Codex도 동일하다.

- MCP 서버 등록
- read-only custom agent 정의
- skill 또는 AGENTS.md 규칙으로 explorer 우선 위임

즉, 공용 핵심은 MCP 서버이고, 각 도구별 glue는 얇다.

---

## 16. 구현 범위

### 포함

- MCP stdio 서버 (Content-Length 방식 + NDJSON 방식 자동 감지)
- `explore_repo`
- 내부 repo toolkit
- Cerebras API 클라이언트
- autonomous tool loop
- 심볼/참조 추적용 경량 regex 기반 인덱서
- git 메타데이터 기반 탐색
- 세션 기반 후속 탐색
- MCP progress notification
- 기본 테스트
- Claude/Codex integration 예시

### 제외

- 공식 MCP SDK 의존성
- tree-sitter/LSP 기반 정밀 semantic 분석
- 병렬 repo 샤딩 탐색
- write-back agent

---

## 17. 추후 확장

### Phase 2

- `trace_symbol`
- `map_impact`
- `find_entrypoints`
- nested `.gitignore` / `.ignore` 지원
- `repo_symbol_context.depth > 1` 확장
- `repo_grep.includeSymbol`

### Phase 3 — 의존성 최소화 심볼 엔진 정밀도 향상

현재 `symbols.mjs`는 외부 parser나 language server 없이 regex/syntax-lite 방식으로
심볼을 추출한다. 이 방향을 기본 설계로 유지한다. LSP/tree-sitter는 언어별 설치,
서버 lifecycle, native dependency, 프로젝트별 설정 비용이 있어 agent adoption
관점에서 기본 경로에 넣지 않는다.

**구현 계획:**

1. **내장 symbol provider 경계 정리**
   - `src/explorer/symbols.mjs`의 built-in extractor를 기본 provider로 유지
   - symbol record에 `signature`, `language`, `containerName`, `qualifiedName` 같은
     parser-free metadata를 보강
   - 기존 `name/kind/line/endLine/exported` 계약은 유지

2. **언어별 fixture 기반 정확도 개선**
   - JS/TS: generic function, typed arrow, class method/private method, re-export 분류
   - Python/Go/Rust/Java: fixture를 늘려 false positive를 줄이는 방식으로 개선
   - 새 npm dependency나 외부 binary는 추가하지 않음

3. **참조 분류 신뢰도 개선**
   - `repo_references`는 legacy `type: import|definition|usage`를 유지
   - 추가 relation(`call`, `constructor`, `export`, `type_reference`)으로 caller 잡음 감소
   - `repo_symbol_context`는 re-export/type-only reference를 caller에서 제외

4. **기존 Phase 3 항목 유지:**
   - import graph / call graph는 관측된 grep/symbol/read 결과로만 edge 기록
   - repo fingerprint 기반 warm-start

### Phase 4 — 런타임 고도화

Claude Code 소스 분석에서 도출된 아키텍처 개선 항목들.

**API 스트리밍 (#16) — 우선순위 낮음**
- Cerebras API는 `stream: true`를 완전히 지원 (SSE, `for await (const chunk of stream)`)
- 그러나 현재 우선순위가 낮은 이유:
  1. Cerebras 추론 속도가 이미 매우 빠름 (TTFT 체감 이득 적음)
  2. Explorer는 완성된 `tool_calls` 배열이 필요 — 청크 누적 후 실행이므로 스트리밍 이점 감소
  3. 구현 복잡도: SSE 파싱, 도구 호출 인자 청크 누적, 인터페이스 변경 필요
- 대신 적용 완료된 대안:
  - **gzip 압축**: 4KB 이상 페이로드 자동 압축 (최대 ~98% 크기 감소, `cerebras-client.mjs`)
  - **프롬프트 캐시 최적화**: static→dynamic 순서 재배치로 캐시 히트율 극대화 (`prompt.mjs`)
- Cerebras 참고 문서: `/capabilities/streaming`, `/capabilities/payload-optimization`

**대규모 레포 최적화 (#6)**
- 현재: `walkFiles()`가 순차 디렉토리 탐색, 100K+ 파일에서 느림
- 목표: ripgrep(`rg --files`) 기반 파일 목록 수집으로 대체
- Claude Code 참조: `Glob` 도구가 ripgrep 기반
- 효과: 파일 탐색 10-100x 속도 향상 (이미 grep에서는 rg 사용 중)

**텔레메트리/관측성 (#18)**
- 현재: `stats` 객체만 반환, 도구별 시간 소비 추적 없음
- 목표: 구조화된 이벤트 로깅 시스템
- Claude Code 참조: `analytics/index.ts`의 `logEvent` 패턴
- 구현:
  - 도구별 호출 횟수 + 소요 시간 추적
  - API retry 이벤트 기록
  - 캐시 히트율 per-exploration 기록
  - 선택적 파일 출력 (`CEREBRAS_EXPLORER_TELEMETRY=true`)

---

## 18. 한 줄 결론

이 설계의 핵심은 다음 문장으로 요약된다.

> **Claude/Codex의 subagent 기능을 직접 메인으로 쓰는 것이 아니라, `zai-glm-4.7` 기반의 외부 autonomous explorer를 MCP 뒤에 숨기고, 메인 모델은 그 explorer에게 한 번만 위임하게 만든다.**

이것이 “main과 독립적인 explorer 기능을 갖춘 MCP sub-agent” 요구에 가장 가깝다.
