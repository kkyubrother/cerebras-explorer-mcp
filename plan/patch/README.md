# zai-glm-4.7 프롬프트/에이전트 설계 분석 보고서

`cerebras-explorer-mcp` 기준

아래 평가는 사용자가 첨부한 현재 프롬프트/파라미터 설명, GLM thinking-mode 발췌, GLM-4.7 안내 문서, 그리고 실제 업로드된 저장소 코드 점검을 함께 반영했습니다. 특히 이 프로젝트는 `api.cerebras.ai/v1`를 직접 호출하므로, **런타임 계약의 기준 문서는 Z.ai native 예시보다 Cerebras의 GLM-4.7 migration / chat completions / structured outputs 문서**로 두는 것이 맞습니다. 업로드된 공식 자료도 GLM-4.7이 agentic coding·tool use·preserved thinking을 핵심 강점으로 내세운다는 점을 분명히 보여줍니다.    ([Cerebras Inference][1])

## 총평

현재 설계는 이미 방향이 좋습니다.
특히 다음은 강점입니다.

* **read-only 탐색 에이전트**로 역할이 선명하다.
* **전략 힌트(symbol / reference / git / blame / breadth / pattern)**가 있어 불필요한 탐색을 줄이려는 의도가 분명하다.
* **evidence / candidatePaths / followups** 형태의 결과 스키마가 실무적으로 유용하다.
* `EXPLORE_RESULT_JSON_SCHEMA`가 이미 `strict: true`, `additionalProperties: false`로 잘 설계돼 있다.

하지만 품질을 크게 깎는 병목도 분명합니다.

1. **가장 큰 런타임 문제**: strict JSON finalize가 “항상” 적용되지 않습니다. 현재는 모델이 tool call 없이 바로 응답하면 `extractFirstJsonObject()`로 바로 수용하고, dedicated finalize는 주로 예산 소진 시점에만 호출됩니다.
2. **가장 큰 파라미터 문제**: `temperature: 0.1` 고정은 GLM-4.7 공식 권장과 정면으로 충돌합니다. Cerebras는 GLM-4.7에서 기본값 `temperature=1`, `top_p=0.95`를 권장하고, reasoning이 켜진 상태에서 `temperature < 0.8`은 품질을 떨어뜨릴 수 있다고 경고합니다. ([Cerebras Inference][1])
3. **가장 큰 멀티턴 문제**: `clear_thinking`이 빠져 있어 reasoning 연속성이 유지되지 않습니다. Cerebras는 `clear_thinking=false`를 agentic/coding workflow에 권장하며, chat completions 응답에는 `message.reasoning` 필드도 따로 제공합니다. ([Cerebras Inference][2])
4. **문서 계약 불일치**: 현재 `reasoningEffort: low|medium`를 GLM에 사용하고 있지만, Cerebras 문서에서는 GLM-4.7 쪽에 대해 명시적으로 노출된 값이 사실상 `none`(비활성화)이며, `low|medium|high`는 GPT-OSS 쪽으로 설명됩니다. 최소한 **문서화되지 않은 사용**입니다. ([Cerebras Inference][2])
5. **프롬프트 구조 문제**: 현재 system prompt의 정보 순서는 나쁘지 않지만, GLM-4.7이 특히 **프롬프트 앞부분**을 더 강하게 본다는 공식 가이드 기준으로는 아직 최적이 아닙니다. hard constraints, 출력 계약, 언어, stop 조건이 더 앞에 와야 합니다. ([Cerebras Inference][1])

**한 줄 결론**:
현재 시스템은 “아이디어는 맞지만, GLM-4.7/Cerebras가 기대하는 운영 계약과 샘플링 계약에 완전히 맞춰져 있지 않다”가 정확한 진단입니다.

---

# 챕터 1: 현재 프롬프트의 구조 분석

## 1-1. 시스템 프롬프트 구조 평가

현재 `buildExplorerSystemPrompt`는 대체로 다음 흐름입니다.

`역할 → 핵심 원칙 → 전략 가이드 → 도구 설명 → 프로젝트 컨텍스트 → JSON shape → budget`

이 구조는 인간이 읽기엔 자연스럽습니다.
또한 “Evidence-driven / Minimal footprint / Output discipline”이라는 3축은 코드 탐색 에이전트에 잘 맞습니다. 특히 “non-trivial task에서 confidence=high 전에 evidence 2개 이상”이라는 규칙은 실제로 좋은 품질 게이트입니다.

다만 **GLM-4.7 최적화 관점**에서는 순서가 약간 아쉽습니다.

### 좋은 점

* 역할이 명확합니다. “autonomous READ-ONLY repository exploration agent”는 GLM-4.7이 좋아하는 역할 프롬프트 형태입니다.
* MUST/SHOULD를 사용합니다.
* 전략 가이드가 비교적 구체적입니다.
* 예산 한도를 prompt에 넣어 “끝없는 탐색”을 억제하려는 의도가 있습니다.

### 약한 점

가장 중요한 규칙 몇 개가 **너무 뒤에 있거나 한 번만 등장**합니다.

예를 들어 실제로 가장 중요한 규칙은 아래입니다.

* final answer는 JSON only
* read-only
* evidence grounding
* stop early, but not too early
* default language
* tool order

그런데 현재는 이 규칙이 여러 구역에 분산돼 있고, JSON shape는 prompt 후반부에 한 번만 나타납니다. Cerebras 가이드는 GLM-4.7이 **system prompt 초반의 required rules를 더 강하게 반영**한다고 명시하고, MUST/REQUIRED/STRICTLY 같은 직접적 표현을 권장합니다. 또 multilingual 모델이라 **default language를 system prompt에서 명시**하라고 권합니다. ([Cerebras Inference][1])

즉, 지금 구조는 “좋은 문서형 prompt”이지, “GLM-4.7 최적의 hard-constraint prompt”는 아닙니다.

## 1-2. MUST / SHOULD 패턴 평가

현재 MUST/SHOULD 패턴은 전반적으로 괜찮습니다.
다만 중요도 분리가 더 명확해야 합니다.

예를 들어:

* `MUST use repo tools before answering`
* `MUST remain read-only`
* `MUST return plain JSON only`

이 셋은 사실상 **위반 시 실패**입니다.

반면

* `SHOULD gather at least two evidence points before confidence=high`

이건 quality heuristic입니다.

지금은 문장만 보면 둘의 위계가 보이지만, **실행 제약(hard failure) vs 품질 규칙(soft preference)**로 나누어 더 강하게 구조화하는 편이 낫습니다. GLM-4.7은 soft suggestion보다 explicit rule을 더 잘 따르며, front-loaded hard rules에 특히 민감합니다. ([Cerebras Inference][1])

실전적으로는 아래 두 층으로 나누는 것이 좋습니다.

* **HARD REQUIREMENTS**: 위반하면 실패로 간주
* **QUALITY TARGETS**: high confidence 조건, evidence 수, followups 품질 등

## 1-3. 정보 배치 순서 평가

현재 prompt의 핵심 문제는 “논리적으로는 맞는데, GLM용 배치로는 최적이 아님”입니다.

지금처럼 전략 가이드, git 도구, symbol 도구 설명이 길게 이어진 뒤 JSON shape가 나오면, 모델은 초반에 tool-use의 디테일을 많이 보고 **최종 출력 계약**은 상대적으로 뒤늦게 받습니다. GLM-4.7 migration guide는 중요한 지시를 system prompt의 시작 부분에 두라고 강조하고, 길어진 컨텍스트에서는 instruction-following이 약해질 수 있다고도 경고합니다. ([Cerebras Inference][1])

따라서 더 좋은 순서는 이렇습니다.

`역할 → 하드 규칙 → 출력 계약(JSON, language, read-only, grounding) → stop 조건 → tool-order decision policy → strategy catalog → project/session context`

이렇게 바꾸면 모델이 “나는 어떤 존재인가” 다음으로 곧바로 “절대로 깨면 안 되는 규칙”을 봅니다.

---

## 1-4. 유저 프롬프트 구조 평가

`buildExplorerUserPrompt`는 꽤 실용적입니다.

현재 구조:

`task → budget → scope → strategy → hints → response language → prior candidate paths`

### 장점

* delegated task가 선명합니다.
* budget/scope가 함께 있어 불필요한 repo 전역 탐색을 줄일 수 있습니다.
* strategy 설명까지 함께 넣어서 시작 branching을 줄입니다.
* hints(symbols/files/regex)가 있으면 초반 탐색 효율이 좋아집니다.
* `sessionCandidatePaths`는 매우 좋은 **저비용 세션 메모리**입니다.

### 한계

#### 1) 전략 자동 감지가 너무 regex 중심

현재 `detectStrategy(task)`는 한국어/영어 키워드 정규식으로 6개 전략 중 하나를 고릅니다. 이 방식은 단일 의도 질문엔 효과적이지만, 복합 질문에 약합니다.

예를 들어:

* “왜 auth middleware가 특정 route에서만 빠지는지 보고, 최근 변경도 같이 확인해줘”
* “이 함수 어디서 정의되고 최근 누가 바꿨는지도 봐줘”

이런 질문은 `blame-guided + git-guided`, 또는 `symbol-first + git-guided`가 섞여야 합니다. 지금 방식은 **한 전략만 강제**하므로, 잘못 걸리면 탐색 출발이 비효율적입니다.

#### 2) override 여지가 없음

현재 user prompt는 사실상
`Follow the {strategy} strategy above.`
라고 말합니다.

즉 모델이 첫 tool result를 본 뒤 “이 전략이 잘못됐다”고 판단해도, prompt 구조상 전략을 바꾸기 어렵습니다. agent loop는 첫 1~2턴의 방향 전환 능력이 중요한데, 현재 구조는 그 유연성이 약합니다.

#### 3) `sessionCandidatePaths`는 좋지만 설명 정보가 부족

지금은 파일 경로만 주입됩니다. 이건 충분히 유용하지만, 다음 형태면 더 좋습니다.

```json
[
  {"path":"src/explorer/runtime.mjs","why":"finalization flow"},
  {"path":"src/explorer/cerebras-client.mjs","why":"chat completion payload"}
]
```

즉, 단순 경로 나열보다 **경로 + relevance hint**가 더 강력한 압축 메모리입니다.

---

## 1-5. Finalize 프롬프트 평가

현재 finalize prompt는 짧고 깔끔하지만, GLM-4.7용으로는 너무 약합니다.

```txt
Produce the final exploration result now.
Do not call any tools.
Ground every evidence item in files and line ranges already inspected.
Use an empty array [] for followups if no further investigation is needed.
```

### 문제 1: 출력 계약이 약함

이 프롬프트에는 “정확히 하나의 JSON object만 출력하라”, “schema와 정확히 일치하라”, “markdown 금지”, “여분 텍스트 금지”가 없습니다.

현재 dedicated finalize path에서는 `response_format: json_schema`가 있기 때문에 그나마 안전하지만, prompt 자체는 약합니다. Cerebras structured outputs는 `strict=true`일 때 token-level constrained decoding으로 스키마 위반을 막아줍니다. 즉 **문법 안정성은 response_format이 맡고**, prompt는 **semantic self-check**를 맡아야 합니다. 현재 finalize prompt는 그 semantic self-check도 약합니다. ([Cerebras Inference][3])

### 문제 2: 실제 코드상 main success path가 finalize를 우회

이게 더 큽니다.

실제 runtime을 보면:

* tool call이 더 이상 없으면
* 모델 응답에서 `extractFirstJsonObject(lastAssistantContent)`를 시도
* parse되면 바로 finalObject로 채택

즉 **정상 종료 경로에서는 dedicated finalize를 거치지 않을 수 있습니다.**
이 경우 strict schema, stronger finalize prompt, no-tools rule이 모두 적용되지 않습니다.

이건 prompt 문제를 넘어 **제어 흐름 문제**입니다.

### 문제 3: grounding 지시가 너무 늦게 나옴

“Ground every evidence item…”이 finalize 시점에만 나타납니다.
하지만 좋은 grounding은 finalize 때 갑자기 생기는 게 아니라, 탐색 중부터 **evidence ledger**처럼 관리되어야 합니다.

현재는 후처리에서 observed range와 evidence overlap을 검사해 증거를 드롭합니다. 이건 방어적으로는 좋지만, 모델 입장에서는 “탐색 중 어떤 항목을 나중에 evidence로 쓸지”를 미리 관리하도록 유도받지 못합니다.

---

# 챕터 2: API 파라미터 설정 분석

## 2-1. `temperature: 0.1` 고정값 분석

이 부분은 매우 중요합니다.

Cerebras GLM-4.7 migration guide는 기본 sampling으로 `temperature=1.0`, `top_p=0.95`를 권장하고, instruction-following 쪽은 `temperature=0.8` 수준을 제시합니다. 특히 **thinking이 켜진 상태에서는 `temperature < 0.8`을 피하라**고 명시합니다. 더 deterministic한 결과가 필요해 `temperature < 0.8`을 쓰려면 **thinking도 꺼라**고 합니다. ([Cerebras Inference][1])

즉 현재 설정은 다음과 같이 해석됩니다.

* quick: reasoning off + temp 0.1 → 문서와 완전히 충돌하지는 않음
* normal: reasoning on(또는 적어도 off 아님) + temp 0.1 → 공식 경고 구간
* deep: reasoning on + temp 0.1 → 공식 경고 구간

### 낮은 temperature의 장점

자율 탐색 에이전트에서는 낮은 temperature가 다음 장점이 있습니다.

* 같은 task에서 tool call 패턴이 더 재현 가능
* 불필요한 브랜치 탐색 감소
* JSON 형식 흔들림 감소 가능

### 낮은 temperature의 단점

하지만 repo exploration agent는 단순 추출기가 아니라 **부분 관찰에서 다음 탐색을 결정**하는 정책 모델입니다.
너무 낮은 temperature는:

* 처음 떠오른 전략에 과도하게 고착
* grep → read → refine 같은 대안 경로를 덜 시도
* 애매한 task에서 탐색 다양성이 부족
* thinking이 켜져 있어도 reasoning이 경직돼 “한 번 잘못 잡은 계획”을 수정하기 어려움

으로 이어질 수 있습니다.

### 현재 설정이 특히 나쁜 이유

핵심은 “0.1이 낮다” 자체보다 **reasoning과의 조합**입니다.
Cerebras 가이드가 바로 그 조합을 경고합니다. ([Cerebras Inference][1])

### budget별 권장안

| budget |  현재 |        권장 |
| ------ | --: | --------: |
| quick  | 0.1 | 0.2 ~ 0.4 |
| normal | 0.1 |       0.8 |
| deep   | 0.1 | 0.9 ~ 1.0 |

설명:

* **quick**: reasoning을 끄면 low temp 유지 가능. 다만 0.1은 지나치게 경직될 수 있어 0.2~0.4가 더 무난합니다.
* **normal/deep**: GLM-4.7 reasoning을 살리려면 0.8 이상이 맞습니다.

---

## 2-2. `reasoningEffort` 설정 분석

현재 매핑:

* quick = `"none"`
* normal = `"low"`
* deep = `"medium"`

여기엔 두 층의 문제가 있습니다.

### 1) 개념적 타당성

탐색 에이전트에서 reasoning이 실제로 도움이 되는 구간은 분명 있습니다.

도움이 되는 국면:

* 여러 후보 파일 중 다음 읽을 파일 선택
* “이 정도면 답할 수 있는가?” sufficiency 판단
* 여러 파일/커밋 정보를 종합해 원인 설명
* followups 우선순위화
* git / blame / symbol / grep 결과를 하나의 서사로 연결

오히려 방해가 되는 국면:

* 단순 “어디 정의됐나?”
* 단순 “어디서 import되나?”
* 명백한 grep 기반 사실 확인
* 예산이 빡빡한 quick 질의

따라서 **quick=none**은 좋은 방향입니다.
문제는 normal/deep가 “low/medium reasoning effort”라는 API knob로 정말 GLM에서 의도대로 동작하느냐입니다.

### 2) 문서 계약 문제

현재 Cerebras chat completions / reasoning 문서를 보면 `reasoning_effort`는 모델별 지원값이 다르고, GLM-4.7은 **reasoning enabled by default**이며 문서상 명시적으로 노출된 제어는 `none`(비활성화)입니다. 반면 `low|medium|high`는 GPT-OSS 쪽으로 기술됩니다. 즉 지금의 `low`/`medium` 사용은 적어도 **문서화된 GLM-4.7 사용법은 아닙니다.** ([Cerebras Inference][2])

실무적으로는 다음 중 하나일 수 있습니다.

* 서버가 무시한다
* 내부적으로 허용하지만 비권장/미문서 상태다
* 지금은 동작하지만 향후 바뀔 수 있다

따라서 이건 “최적화 논점”이 아니라 먼저 **호환성 리스크**로 봐야 합니다.

### `"high"` reasoning을 고려할 상황?

Cerebras GLM-4.7 문서 계약만 보면, `high`를 GLM에서 신뢰하고 쓰는 것은 추천하기 어렵습니다.
더 깊은 reasoning이 필요하면 다음 방식이 안전합니다.

* reasoning은 켠다 (`reasoning_effort`를 생략)
* prompt에 “Think step by step” / “Break the problem down logically”를 deep budget에서만 넣는다
* preserved thinking + checkpoint + critic pass로 깊이를 얻는다

이 방식은 migration guide와도 일치합니다. ([Cerebras Inference][1])

---

## 2-3. `clear_thinking` 미설정 문제

이건 현재 설계의 핵심 약점 중 하나입니다.

Cerebras chat completions 문서는 `clear_thinking`의 기본값이 `true`이며, `false`일 때 이전 thinking이 preserved되고 agentic workflows에 권장된다고 설명합니다. Z.ai thinking-mode 문서도 coding/agent 시나리오에서 preserved thinking이 reasoning continuity, performance, cache hit에 도움이 된다고 밝히며, `clear_thinking=false`와 함께 **이전 reasoning을 원형 그대로 되돌려 보내야 한다**고 명시합니다. ([Cerebras Inference][2])

현재 코드의 문제는 두 겹입니다.

### 1) `clear_thinking`을 아예 보내지 않음

즉 기본값 `true`.

### 2) 응답의 reasoning을 보존하지 않음

Cerebras chat completions 응답에는 `message.reasoning` 필드가 있고, reasoning guide는 prior reasoning을 넘길 때 이를 포함하라고 설명합니다. 현재 client는 `message.content`와 `tool_calls`만 꺼내고 `message.reasoning`을 버립니다. ([Cerebras Inference][2])

### 멀티턴 tool loop에 주는 영향

* 초반 가설이 중간에 사라짐
* “왜 이 파일을 보고 있었는가”가 약해짐
* stop condition 판단이 매 턴 새로 흔들릴 수 있음
* deep budget에서 계획 drift가 늘어남

### `clear_thinking:false`로 바꾸면 기대 효과

* 다턴 일관성 향상
* tool result 기반 reasoning continuity 향상
* 복합 탐색에서 mid-course correction 개선
* prompt caching / cache hit 측면 이점 가능

### 주의사항

단순히 `clear_thinking:false`만 넣어서는 불완전합니다.

**반드시 같이 해야 할 것**

1. `message.reasoning` 추출
2. assistant message에 reasoning을 다시 실어 보냄
3. reasoning을 수정/요약/재정렬하지 않음

또한 Cerebras reasoning 문서는 `raw` reasoning format이 `json_schema`와 호환되지 않는다고 명시합니다. structured finalization을 유지할 생각이면 reasoning format은 `parsed` 계열로 다루는 편이 안전합니다. ([Cerebras Inference][4])

---

## 2-4. `maxCompletionTokens` 설정 분석

Cerebras는 `max_completion_tokens`가 **reasoning tokens를 포함**한다고 명시합니다. 즉 “보이는 답변”만이 아니라 hidden/parsed reasoning도 이 예산을 먹습니다. ([Cerebras Inference][2])

현재 설정:

* quick 4000
* normal 6000
* deep 8000

### 판단

* **quick 4000**: reasoning을 끄면 충분할 가능성이 큽니다.
* **normal 6000**: reasoning이 켜져 있고 evidence/followups가 길면 꽤 타이트합니다.
* **deep 8000**: multi-file evidence, followups, summary가 길어지면 빠듯할 수 있습니다.

더 큰 문제는 **finalizeAfterToolLoop가 2500으로 하드코딩**돼 있다는 점입니다.
실제 final JSON은 다음을 동시에 담습니다.

* answer
* summary
* confidence
* evidence 배열
* candidatePaths 배열
* followups 배열

여기에 reasoning까지 포함되면 2500은 작을 수 있습니다.

### 권장안

| 경로          |                     권장 |
| ----------- | ---------------------: |
| quick main  |             4000 유지 가능 |
| normal main |                   8000 |
| deep main   |          12000 ~ 16000 |
| finalize    | 최소 4000, deep는 6000 이상 |

모델 최대 output이 40k이므로, 지금은 headroom이 충분합니다. 중요한 것은 “무조건 크게”가 아니라, **reasoning + structured final answer가 함께 들어갈 수 있는 여지**를 주는 것입니다. ([Cerebras Inference][1])

---

# 챕터 3: 프롬프트 내용의 약점 분석

## 3-1. JSON 출력 신뢰성 문제

현재 system prompt의 핵심 지시는:

> MUST return plain JSON only when you give the final answer. No markdown fences.

이 정도만으로는 GLM-4.7이 항상 순수 JSON만 내보낸다고 보기 어렵습니다.
특히 모델이 도중에:

* ` ```json ` fence
* JSON 앞뒤 설명 문장
* 한국어/영어 메타 설명
* JSON 비슷한 객체 + 후행 텍스트

를 섞는 실패 패턴은 충분히 현실적입니다.

그런데 더 큰 문제는 현재 runtime이 이를 **강하게 금지하지 않고 수습**한다는 점입니다. `extractFirstJsonObject()`는 입력 문자열 안에서 첫 번째 balanced object를 찾아 parse합니다. 즉, “순수 JSON only”가 아니어도 통과될 수 있습니다. 이건 복구 장치로는 유용하지만, **형식 discipline을 학습시키는 방향과는 반대**입니다.

Cerebras structured outputs는 `response_format={type:"json_schema", strict:true}`를 쓰면 invalid output을 불가능하게 만들 수 있습니다. 따라서 GLM-4.7에서 순수 JSON 안정성을 얻는 가장 확실한 방법은 “더 세게 말하기”가 아니라 **최종 응답 경로를 전부 strict schema로 통일**하는 것입니다. ([Cerebras Inference][3])

### 더 강하게 강제하는 기법

우선순위 순서로 정리하면:

1. **모든 final answer를 strict `json_schema`로 통일**
2. finalize prompt에 “exactly one JSON object / no extra text” 추가
3. schema description 추가
4. nested field descriptions 강화
5. 필요 시 짧은 few-shot exemplar 추가

Z.ai structured output best practices도 **간단한 schema부터 시작하고, key field에는 description/example를 주고, fallback schema와 validation을 준비**하라고 권합니다. ([Z.AI][5])

---

## 3-2. 전략 자동 감지의 한계

정규식 기반 전략 감지는 구현 비용이 낮고 시작점으로는 좋습니다.
하지만 한계가 명확합니다.

### 취약한 경우

* 복합 질문
* 맥락 의존 질문
* 한국어/영어 혼합 표현
* 간접 표현
* “원인 + 최근 변경 + 호출 경로”처럼 다층 의도

또한 현재 감지는 **단 하나의 dominant strategy**만 선택합니다.
하지만 실제 좋은 탐색은 종종 다음과 같습니다.

* 1턴: breadth/symbol로 좁히기
* 2턴: grep or references
* 3턴: git/blame로 원인 확인
* 4턴: finalize

즉 전략은 label 하나보다 **초기 priors**에 가깝습니다.

### 구조적 문제

현재 prompt는 감지된 전략을 사실상 고정해 버립니다.
모델이 첫 결과를 본 뒤 “전략을 바꾸는 편이 싸다”고 판단해도, 프롬프트가 이를 허용하지 않습니다.

### fallback의 충분성

`auto (start with repo_list_dir or repo_grep)`는 나쁘지 않지만 약합니다.
미감지 시 fallback도 다음처럼 더 구체적이어야 합니다.

* 구조 질문이면 `repo_list_dir(depth:3)`
* symbol/hint 있으면 `repo_symbol_context`
* 나머지는 `repo_grep` with small context
* file read는 2차 단계

---

## 3-3. 도구 사용 우선순위 지시의 모호성

현재 system prompt 안에는 약간의 긴장 관계가 있습니다.

* 한쪽에서는 `prefer repo_find_files and repo_grep, then repo_read_file`
* 다른 쪽에서는 symbol analysis tools를 grep+read보다 먼저 쓰라고 함

즉 모델 입장에서는
“무조건 grep 먼저인가?”
“symbol task면 symbol_context 먼저인가?”
가 완전히 정리돼 있지 않습니다.

이 모호성은 특히 low temperature에서 더 나쁩니다.
모델이 첫 해석에 고착되면 불필요하게 `repo_read_file`로 먼저 가거나, 반대로 symbol task인데도 grep으로 우회할 수 있습니다.

### 더 좋은 방식

자연어 preference가 아니라 **decision tree**가 필요합니다.

예:

* symbol 정의/호출 질문 → `repo_symbol_context`
* 최근 변경/저자 질문 → `repo_git_log`
* 구조 질문 → `repo_list_dir(depth:3)`
* ambiguous question → `repo_grep` or `repo_find_files`
* `repo_read_file`은 항상 2차 정밀 확인 단계

이렇게 하면 tool choice가 훨씬 안정됩니다.

---

## 3-4. evidence grounding 지시의 약점

현재 grounding 규칙은 finalize prompt에서만 강하게 드러납니다.
하지만 실제로는 탐색 중에 아래가 필요합니다.

* 어떤 read range를 봤는가
* 나중에 evidence로 쓸 후보가 무엇인가
* 그 후보가 file evidence인지 git evidence인지
* 아직 부족한 근거가 무엇인가

즉 finalize 시점이 아니라 **exploration 시점에서 evidence ledger를 누적**해야 합니다.

좋은 점은 현재 runtime이 `observedRanges`를 수집하고, 후처리에서 overlap 기반 grounding filter를 거는 것입니다.
하지만 이건 사후 보정입니다.
더 좋은 구조는 모델에게도 다음을 명시하는 것입니다.

> “탐색 중, 나중에 evidence로 쓸 수 있는 항목을 내부적으로 path/start/end/why 형태로 기록하라.”

### git evidence의 구조적 문제

현재 evidence 스키마는 file range만 표현합니다.

```json
{"path":"...","startLine":1,"endLine":10,"why":"..."}
```

그래서 아래 같은 근거를 예쁘게 담기 어렵습니다.

* 특정 commit 메시지
* git blame 결과의 author/commit
* diff between refs
* recent history pattern

즉 git-guided / blame-guided 전략의 핵심 증거가 스키마상 2급 시민입니다.

---

## 3-5. 멀티턴 일관성 문제

10~16턴 탐색에서 에이전트 품질을 결정하는 것은 “한 번에 똑똑함”보다 **계획 유지 + 중간 수정 + 조기 종료 판단**입니다.

현재는 다음 이유로 일관성이 약해질 수 있습니다.

* preserved thinking 미사용
* 전략 override 불가
* sufficiency checkpoint 없음
* finalization이 항상 dedicated path가 아님

### “Stop as soon as evidence is sufficient”의 양면성

이 지시는 좋지만 위험합니다.

좋은 점:

* 과탐색 방지
* 토큰 절약
* 빠른 답변

나쁜 점:

* 충분성 기준이 불명확하면 너무 일찍 멈춤
* 특히 low temp에서 “처음 plausible한 답”에 고착될 수 있음

그래서 조기 종료 규칙은 다음과 같이 더 구체화돼야 합니다.

* trivial task: 1 evidence 가능
* non-trivial task: 2 independent evidence 필요
* causal claim / why question: code evidence + history/reference evidence 권장
* uncertainty가 남으면 low confidence로 종료

---

## 3-6. 언어 혼용 문제

현재 system prompt는 영어이고, user task는 한국어일 수 있으며, language는 user prompt 후반부의 `Response language: ko`로 들어갑니다.

Cerebras migration guide는 GLM-4.7이 multilingual이라 **default language를 system prompt에서 명시하지 않으면 언어 전환이 발생할 수 있다**고 말합니다. Z.ai thinking docs도 reasoning/tool-use 과정에서 thinking continuity를 강조합니다. 따라서 현재처럼 language control이 user prompt 후반부에만 있는 구조는, 최종 답변 언어는 어느 정도 유도해도 **reasoning 언어와 JSON 값의 언어 일관성까지 강하게 보장하지는 못한다**고 보는 편이 안전합니다. 이 부분은 문서와 현재 구조를 근거로 한 추론입니다. ([Cerebras Inference][1])

실제로 나타날 수 있는 패턴:

* `answer`는 한국어, `summary`는 영어 섞임
* `why` 필드가 한국어/영어 혼합
* followups description만 영어로 남음

---

# 챕터 4: 개선 방향 제안

아래는 **바로 적용 가능한 수준**으로 적겠습니다.

---

## 4-1. 시스템 프롬프트 재구성

### 핵심 원칙

Cerebras 가이드에 맞춰 다음을 맨 앞으로 당깁니다.

1. 역할
2. hard rules
3. final output contract
4. language
5. tool-order policy
6. stop 조건
7. strategy catalog
8. project/session context

### 변경 전

현재는 “Core Principles → Strategy guide → Tool catalog → JSON shape” 순입니다.

### 변경 후 예시

```js
export function buildExplorerSystemPrompt({
  repoRoot,
  budgetConfig,
  projectContext,
  previousSummaries,
  keyFiles,
  defaultLanguage,
}) {
  const lines = [
    'You are Cerebras Explorer, a READ-ONLY repository exploration agent.',
    '',
    'HARD REQUIREMENTS:',
    '- REQUIRED: Use repo tools before answering unless the answer is already directly supported by prior tool results in this session.',
    '- REQUIRED: Remain strictly read-only. Never propose edits, writes, or mutating shell commands.',
    '- REQUIRED: Final output must be exactly one JSON object matching the required schema. No markdown fences. No prose before or after the JSON object.',
    `- REQUIRED: Final JSON text must use ${defaultLanguage || 'the delegated task language'}. Keep code identifiers, paths, and symbols unchanged.`,
    '- REQUIRED: Never cite files or line ranges you did not inspect in this session.',
    '- REQUIRED: For non-trivial tasks, do not use confidence="high" unless at least two independent evidence items support the answer.',
    '- REQUIRED: Stop as soon as the answer is sufficiently grounded. Do not continue exploring once further tool calls are unlikely to change the answer.',
    '',
    'TOOL ORDER POLICY:',
    '- Symbol definition / usage question -> repo_symbol_context first.',
    '- History / authorship / recent change question -> repo_git_log first, then repo_git_diff / repo_git_show / repo_git_blame.',
    '- Architecture / overview question -> repo_list_dir(depth:3) first, then read only key files.',
    '- Ambiguous question -> repo_grep or repo_find_files before any repo_read_file.',
    '- repo_read_file is a precision tool: use it after narrowing.',
    '',
    'EVIDENCE LEDGER:',
    '- While exploring, internally track candidate evidence as (path, startLine, endLine, why).',
    '- Only include evidence items that come from inspected ranges.',
    '- If evidence is insufficient, either continue exploring or lower confidence.',
    '',
    'STRATEGY CATALOG:',
    '- symbol-first: repo_symbol_context -> repo_read_file',
    '- reference-chase: repo_symbol_context or repo_references -> repo_read_file',
    '- git-guided: repo_git_log -> repo_git_diff -> repo_read_file',
    '- breadth-first: repo_list_dir -> read key files',
    '- blame-guided: repo_grep -> repo_git_blame -> repo_git_show',
    '- pattern-scan: repo_grep -> read multiple files',
  ];

  if (projectContext) {
    lines.push('', 'PROJECT CONTEXT:', projectContext.trim());
  }
  if (keyFiles?.length) {
    lines.push('', `KEY FILES: ${keyFiles.join(', ')}`);
  }
  if (previousSummaries?.length) {
    lines.push('', 'PRIOR FINDINGS:');
    for (const s of previousSummaries) lines.push(`- ${s}`);
  }

  lines.push(
    '',
    'FINAL RESULT FIELDS:',
    '- answer: direct answer',
    '- summary: short synthesis',
    '- confidence: low|medium|high',
    '- evidence: grounded inspected file ranges only',
    '- candidatePaths: likely relevant files',
    '- followups: only when further investigation is useful',
    '',
    `Repository root: ${repoRoot}`,
    `Budget: ${budgetConfig.label} (maxTurns=${budgetConfig.maxTurns}, maxReadLines=${budgetConfig.maxReadLines}, maxSearchResults=${budgetConfig.maxSearchResults})`,
  );

  return lines.join('\n');
}
```

### 왜 더 좋은가

* GLM-4.7이 더 강하게 보는 prompt 앞부분에 규칙을 몰아넣습니다. ([Cerebras Inference][1])
* default language를 system prompt 차원에서 명시합니다. ([Cerebras Inference][1])
* tool-order ambiguity를 decision policy로 바꿉니다.
* evidence grounding을 탐색 중 규칙으로 승격합니다.

---

## 4-2. Finalize 프롬프트 강화

### 현재 문제

현재 finalize prompt는 너무 짧고 semantic self-check가 약합니다.

### 권장안

```js
export function buildFinalizePrompt() {
  return [
    'Return the final exploration result now.',
    'You MUST NOT call any tools.',
    'Output MUST be exactly one JSON object that matches the provided response schema.',
    'Do not output markdown fences or any extra text before or after the JSON object.',
    'Before answering, verify internally that every evidence item refers only to files and line ranges already inspected in this session.',
    'If any claim is only partially supported, lower confidence and explain the gap in summary instead of inventing evidence.',
    'Use [] for followups when no further investigation is needed.',
    'Internal self-check: schema-valid, no extra keys, grounded evidence only, language consistent, no markdown.',
  ].join('\n');
}
```

### self-check를 넣는 이유

Cerebras는 critic agents와 validation pass를 권장합니다. 별도 critic agent를 두지 않더라도, finalize prompt 안에 self-check를 심으면 **single-agent critic-lite**가 됩니다. ([Cerebras Inference][1])

### few-shot 예시를 넣을까?

제 의견은 이렇습니다.

* **문법 안정성**을 위해서는 굳이 few-shot이 필요 없습니다. strict `json_schema`가 이미 invalid JSON을 막아주기 때문입니다. ([Cerebras Inference][3])
* **semantic 품질**(예: evidence를 얼마나 잘 쓰는가)을 위해서만 아주 짧은 exemplar가 도움이 될 수 있습니다.
* 토큰 비용은 적지만, 매 턴 누적되므로 **finalize prompt에 1개 초미니 예시만** 넣는 것이 상한선입니다.

예:

```txt
Example shape:
{"answer":"...","summary":"...","confidence":"medium","evidence":[{"path":"src/x.ts","startLine":10,"endLine":18,"why":"..."}],"candidatePaths":["src/x.ts"],"followups":[]}
```

추천은:

* 먼저 strict schema + stronger prompt만 적용
* 그래도 evidence/followups 품질이 흔들리면 mini exemplar 추가

---

## 4-3. API 파라미터 최적화 제안

### 권장 budget 테이블

| budget | reasoning             | temperature | top_p | clear_thinking | maxCompletionTokens |
| ------ | --------------------- | ----------: | ----: | -------------- | ------------------: |
| quick  | `none`                |  0.25 ~ 0.4 |  0.95 | 의미 없음/생략       |                4000 |
| normal | reasoning on(파라미터 생략) |         0.8 |  0.95 | false          |                8000 |
| deep   | reasoning on(파라미터 생략) |   0.9 ~ 1.0 |  0.95 | false          |         12000~16000 |

이 표는 Cerebras가 권장하는 GLM-4.7 sampling과 reasoning 계약에 맞춘 것입니다. reasoning이 필요한 경우 temperature를 너무 낮추지 말고, deterministic이 필요하면 reasoning을 끄는 방향이 공식 가이드와 일치합니다. ([Cerebras Inference][1])

### `config.mjs` 권장 예시

```js
export const BUDGETS = {
  quick: {
    label: 'quick',
    maxTurns: 6,
    maxSearchResults: 20,
    maxReadLines: 140,
    reasoningEnabled: false,
    preserveThinking: false,
    temperature: 0.3,
    topP: 0.95,
    maxCompletionTokens: 4000,
    finalizeMaxCompletionTokens: 3500,
  },
  normal: {
    label: 'normal',
    maxTurns: 10,
    maxSearchResults: 40,
    maxReadLines: 220,
    reasoningEnabled: true,
    preserveThinking: true,
    temperature: 0.8,
    topP: 0.95,
    maxCompletionTokens: 8000,
    finalizeMaxCompletionTokens: 4500,
  },
  deep: {
    label: 'deep',
    maxTurns: 16,
    maxSearchResults: 80,
    maxReadLines: 320,
    reasoningEnabled: true,
    preserveThinking: true,
    temperature: 1.0,
    topP: 0.95,
    maxCompletionTokens: 14000,
    finalizeMaxCompletionTokens: 6500,
  },
};
```

### 왜 `reasoningEffort` enum을 버리라고 하나

현재 Cerebras GLM-4.7 문서상 믿을 수 있는 knob는 사실상:

* reasoning on: 파라미터 생략
* reasoning off: `reasoning_effort="none"`

입니다. 따라서 `low|medium`은 GLM용 정책 knob로 유지하지 않는 편이 낫습니다. ([Cerebras Inference][2])

### `clear_thinking: false` 도입 시 구현 예시

```js
async createChatCompletion({
  messages,
  tools,
  responseFormat,
  reasoningEffort,
  temperature = 1.0,
  topP = 0.95,
  maxCompletionTokens = 4000,
  parallelToolCalls = true,
  clearThinking,
  reasoningFormat = 'parsed',
  seed,
}) {
  const payload = {
    model: this.model,
    messages,
    temperature,
    top_p: topP,
    max_completion_tokens: maxCompletionTokens,
    parallel_tool_calls: parallelToolCalls,
    stream: false,
    reasoning_format: reasoningFormat,
  };

  if (reasoningEffort !== undefined) payload.reasoning_effort = reasoningEffort;
  if (clearThinking !== undefined) payload.clear_thinking = clearThinking;
  if (responseFormat) payload.response_format = responseFormat;
  if (Array.isArray(tools) && tools.length) payload.tools = tools;
  if (seed !== undefined) payload.seed = seed;

  // ...
  return {
    usage: parsed.usage ?? null,
    message: {
      role: message.role || 'assistant',
      content: extractMessageText(message.content),
      rawContent: message.content,
      reasoning: typeof message.reasoning === 'string' ? message.reasoning : '',
      toolCalls: Array.isArray(message.tool_calls) ? ... : [],
    },
  };
}
```

Cerebras는 `message.reasoning`을 응답에 담고, `seed`도 best-effort deterministic 용도로 지원합니다. ([Cerebras Inference][2])

### runtime 반영 예시

```js
const reasoningEffort = budgetConfig.reasoningEnabled ? undefined : 'none';
const clearThinking = budgetConfig.reasoningEnabled && budgetConfig.preserveThinking
  ? false
  : undefined;
const reasoningFormat = budgetConfig.reasoningEnabled && budgetConfig.preserveThinking
  ? 'parsed'
  : 'hidden';

const completion = await chatClient.createChatCompletion({
  messages,
  tools,
  reasoningEffort,
  clearThinking,
  reasoningFormat,
  temperature: budgetConfig.temperature,
  topP: budgetConfig.topP,
  maxCompletionTokens: budgetConfig.maxCompletionTokens,
  parallelToolCalls: shouldAllowParallel(args.hints?.strategy),
});
```

---

## 4-4. 전략 지시 구조 개선

### 현재

* strategy를 감지해 user prompt에 박아넣음
* follow 강제
* override 불가

### 개선

“확인 가능한 전략 제안”으로 낮추는 게 맞습니다.

```js
const strategyLine = strategy
  ? `Initial strategy suggestion: ${strategy} — ${STRATEGY_DESCRIPTIONS[strategy]}`
  : 'Initial strategy suggestion: auto';

lines.push(
  strategyLine,
  'You may keep this strategy or switch once after the first tool result if another strategy would reduce turns or improve evidence quality.',
  'Prefer the smallest set of tool calls that can establish grounded evidence.'
);
```

### 전략별 numbered steps 예시

#### symbol-first

```txt
SYMBOL-FIRST STEPS:
1. Use repo_symbol_context(symbol) first.
2. If unresolved, use repo_references(symbol) or repo_grep.
3. Read only the smallest relevant ranges.
4. Finalize as soon as the answer is grounded.
```

#### git-guided

```txt
GIT-GUIDED STEPS:
1. Use repo_git_log first to identify candidate commits or hot files.
2. Use repo_git_diff(stat=true) or repo_git_show to narrow the change.
3. Read only the affected file ranges needed to explain the change.
4. If the task is causal, connect git evidence to current code evidence before finalizing.
```

#### blame-guided

```txt
BLAME-GUIDED STEPS:
1. Use repo_grep to find the suspicious code path.
2. Use repo_git_blame on the smallest relevant range.
3. Use repo_git_show only for the most relevant commit(s).
4. Finalize only when you can connect the blamed change to the observed code behavior.
```

이렇게 단계화를 주면 GLM-4.7이 plan drift를 덜 일으킵니다. complex task를 작은 substep으로 나누라는 Cerebras 가이드와도 맞습니다. ([Cerebras Inference][1])

---

## 4-5. JSON 출력 안정성 강화 기법

### 가장 효과적인 방법

**Cerebras strict structured outputs를 최종 응답 경로 전체에 강제하는 것**입니다.

지금 좋은 점은 이미 `EXPLORE_RESULT_JSON_SCHEMA`가 잘 설계돼 있다는 점입니다.
문제는 이 스키마를 항상 쓰지 않는다는 것입니다.

### 반드시 바꿔야 할 부분

현재:

```js
if (completion.message.toolCalls.length === 0) {
  finalObject = extractFirstJsonObject(lastAssistantContent);
  break;
}
```

권장:

```js
if (completion.message.toolCalls.length === 0) {
  const finalized = await this.finalizeAfterToolLoop({
    chatClient,
    messages,
    reasoningEffort,
    clearThinking,
    maxCompletionTokens: budgetConfig.finalizeMaxCompletionTokens,
  });
  finalObject = finalized.result;
  Object.assign(stats, summarizeUsage(stats, finalized.usage));
  break;
}
```

즉 **“tool loop 종료”와 “final JSON generation”을 분리**해야 합니다.

### structured output 설명 강화

Cerebras `response_format.json_schema`에는 `description` 필드가 있고, 이 설명이 모델의 출력 생성에 쓰입니다. 따라서 지금 schema 객체에 짧고 강한 설명을 넣는 것이 좋습니다. ([Cerebras Inference][2])

```js
responseFormat: {
  type: 'json_schema',
  json_schema: {
    name: 'explore_repo_result',
    description: 'Final grounded repository exploration result. Every evidence item must cite only inspected file ranges from this session.',
    strict: true,
    schema: EXPLORE_RESULT_JSON_SCHEMA.schema,
  },
}
```

### Z.ai/Cerebras structured output 조사 결과를 반영한 팁

* schema는 가능하면 단순하게 유지
* key field에 description 보강
* fallback simplified schema 준비
* post-validate/logging 유지
  이건 Z.ai structured output best practice와도 일치합니다. ([Z.AI][5])

---

## 4-6. 에이전트 루프 전반의 품질 향상 전략

## A. tool call 직후 “다음 단계 계획” 유도

ReAct는 reasoning과 action을 interleave할 때 reasoning trace가 다음 행동 계획을 업데이트하는 데 도움이 된다고 보여줍니다. GLM-4.7도 interleaved thinking을 agent/tool-use 강점으로 내세웁니다. 따라서 각 tool result 뒤에 모델이 짧은 next-step plan을 내부적으로 유지하게 하는 것이 좋습니다. ([arXiv][6])

실무 적용은 두 가지입니다.

### 방법 1: hidden reasoning에 맡기기

preserved thinking을 켜고 reasoning을 보존하면 된다.

### 방법 2: 짧은 visible planning sentence 허용

예:

```txt
Before each tool call, briefly state the next step in one sentence.
```

다만 이 프로젝트는 중간 출력이 사용자에게 바로 보이는 UX가 아니라 MCP 내부 루프이므로, 저는 **visible sentence보다 parsed reasoning 보존**을 추천합니다.

---

## B. critic 패턴 도입

Cerebras migration guide는 critic agents를 권장합니다. 꼭 멀티에이전트일 필요는 없습니다. 단일 에이전트 안에서도 2-pass로 만들 수 있습니다. ([Cerebras Inference][1])

### 단일 에이전트 critic-lite 예시

1. explore loop
2. verify pass (no tools)
3. strict finalize

검증 프롬프트 예:

```txt
Verification pass:
- Check whether every claim in the draft answer is supported by inspected evidence.
- Identify any unsupported or weakly supported claim internally.
- If evidence is insufficient, lower confidence and keep followups.
- Do not call tools.
- Do not output anything except the final JSON object.
```

---

## C. 중간 체크포인트 삽입

5턴마다 아래를 넣으면 좋습니다.

```js
if ((turnIndex + 1) % 5 === 0) {
  messages.push({
    role: 'user',
    content: [
      'Checkpoint:',
      '- Decide whether the answer is already sufficiently grounded.',
      '- If yes, finalize on the next turn.',
      '- If no, choose exactly one highest-value next tool call.',
    ].join('\n'),
  });
}
```

이건 “Stop as soon as evidence is sufficient”를 추상 규칙이 아니라 **주기적 의사결정 루틴**으로 바꾸는 장치입니다.

---

## D. evidence schema 개선

현재 스키마의 가장 큰 구조적 약점은 git evidence를 잘 담지 못하는 점입니다.

### 권장 schema 방향

```js
evidence: {
  type: 'array',
  items: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'file_range' },
          path: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          why: { type: 'string' },
        },
        required: ['kind', 'path', 'startLine', 'endLine', 'why'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'git_commit' },
          commit: { type: 'string' },
          path: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['kind', 'commit', 'path', 'why'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'git_blame' },
          path: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          commit: { type: 'string' },
          author: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['kind', 'path', 'startLine', 'endLine', 'commit', 'author', 'why'],
      }
    ]
  }
}
```

Cerebras structured outputs는 `anyOf`와 nested schema를 지원하지만, strict mode에는 schema 길이/복잡도 제한도 있으므로 너무 과도하게 키우지는 말아야 합니다. ([Cerebras Inference][2])

---

# 챕터 5: 컨텍스트 창 및 토큰 예산 분석

## 5-1. 131,072 token 컨텍스트 창의 실질적 활용

Cerebras GLM-4.7 기준 컨텍스트는 약 131k, output 상한은 40k입니다. 하지만 migration guide는 instruction-following 품질이 보통 이 최대치보다 훨씬 짧은 길이에서 가장 좋고, 최대치에 가까워질수록 약해질 수 있다고 경고합니다. ([Cerebras Inference][1])

### 전형적 세션의 대략적 토큰 추정

아래는 추정치입니다.

| 구성 요소                                   |       대략 토큰 |
| --------------------------------------- | ----------: |
| system prompt + project/session context |  900 ~ 1600 |
| tool schema 묶음                          | 1200 ~ 2500 |
| user prompt                             |   150 ~ 350 |
| grep 결과 1회                              |   150 ~ 700 |
| read_file 1회                            |  250 ~ 1200 |
| git_diff / git_show 1회                  |  300 ~ 2000 |
| assistant visible text 1턴               |    50 ~ 200 |
| reasoning 1턴(보존 시)                      | 150 ~ 1000+ |

### 실제 의미

* normal 10턴은 쉽게 **15k~40k**
* deep 16턴은 **40k~90k**
* 여기에 preserved thinking과 큰 git payload가 섞이면 **100k+**도 충분히 갈 수 있습니다.

즉 131k는 넓지만, “깊은 tool loop + raw tool JSON 누적”에서는 결코 무한대가 아닙니다.

---

## 5-2. 컨텍스트가 차오를 때의 문제

Claude Code 문서는 context window가 빨리 차고, 차오를수록 성능이 떨어지며, 이전 지시를 잊거나 실수가 늘어날 수 있다고 설명합니다. LangChain도 agent reliability의 핵심이 “right information and tools in the right format”이라고 정리합니다. ([Anthropic][7])

현재 구조에서 이 위험이 커지는 이유는:

* tool result 원문 JSON을 모두 message history에 계속 넣음
* grep/read/git 결과가 누적됨
* dedicated compaction 없음
* preserved thinking을 켜면 reasoning까지 더해짐

따라서 대응은 필수입니다.

### 권장 대응

1. 오래된 raw tool 결과를 영구 저장하지 말고, session summary로 압축
2. `candidatePaths`, `observedRanges`, `recentActivity`, `evidence ledger`는 구조화 state로 보존
3. tool JSON 원문은 필요한 일부만 남김
4. breadth-first에서 overview를 만든 뒤 raw directory listing은 drop 가능
5. git는 `stat=true` 또는 commit shortlist로 좁힌 뒤 상세 diff 읽기

---

## 5-3. Preserved Thinking의 토큰 비용

Cerebras는 reasoning tokens가 `max_completion_tokens`에 포함되고, hidden이어도 생성/과금/예산에 포함된다고 설명합니다. reasoning guide도 prior reasoning을 넘기려면 reasoning을 다시 포함해야 한다고 말합니다. ([Cerebras Inference][2])

즉 `clear_thinking:false`는 공짜가 아닙니다.

### 장점

* reasoning continuity
* 장기 tool loop 안정성
* better multi-turn coherence

### 비용

* 컨텍스트 누적
* completion budget 소모
* deep session에서 맥락 압박 증가

### 현실적 균형점

제가 추천하는 균형은 이렇습니다.

* **quick**: reasoning off
* **normal**: task/strategy 기반 조건부 on
* **deep**: reasoning on + preserved thinking on
* **checkpoint 이후** 오래된 raw tool 결과는 압축

즉 preserved thinking은 “항상 켜기”보다 **multi-hop 탐색에서만 켜기**가 좋습니다.

---

## 5-4. 도구 결과 크기 제어

현재 `maxReadLines`, `maxSearchResults`는 꽤 합리적입니다.
문제는 숫자 자체보다 **누적 방식**입니다.

### 지금 설정의 의미

* quick/normal/deep가 점진적으로 커짐
* 한 번에 repo 전체를 읽는 일은 방지
* search/read 폭주를 어느 정도 막음

### 추가 권장 전략

#### grep

* 기본 `contextLines=1~2`
* path + line + snippet만 유지
* 동일 파일 다중 hit는 묶어서 요약

#### read_file

* 항상 hit 주변 window 읽기
* 2단계 read 허용: 작은 read → 필요 시 확장 read

#### git

* `repo_git_log` 소수 커밋 shortlist
* `repo_git_diff(stat=true)` 우선
* full diff는 매우 선별적으로

#### tool set 자체

Cerebras chat completions 문서는 **too many tools consume prompt tokens and may hurt performance or context length**라고 명시합니다. 현재 tool set이 아주 과도하지는 않지만, 전략별로 불필요한 툴을 감추는 것도 고려할 만합니다. ([Cerebras Inference][2])

---

# 챕터 6: 참고 자료 기반 외부 best practice 정리

## 6-1. GLM 계열 모델의 instruction following 특성

Cerebras의 GLM-4.7 migration guide 핵심은 네 가지입니다.

1. **front-load instructions**
2. **clear/direct rules**
3. **default language 명시**
4. **role prompt 명시**

또한 complex tasks에는 “Think step by step” 같은 reasoning directive를 넣고, simple tasks에는 reasoning을 최소화하라고 권장합니다. GLM-4.7은 coding/agentic workflows를 핵심 사용처로 잡고 있습니다. ([Cerebras Inference][1])

적용 인사이트:

* prompt를 “좋은 설명문”이 아니라 “앞부분이 강한 operating contract”로 바꿔야 함
* language directive는 system prompt에서 강하게
* reasoning은 예산이 아니라 task complexity에 따라 켜고 꺼야 함

---

## 6-2. 에이전트 루프 프롬프트 설계 best practice

### ReAct

ReAct는 reasoning trace와 action을 interleave하면, reasoning이 action plan을 유도·업데이트하고 예외를 다루는 데 도움이 되며, action은 외부 정보원을 통해 추가 정보를 얻도록 만든다고 설명합니다. 이건 repo exploration tool loop와 매우 잘 맞습니다. ([arXiv][6])

적용:

* tool result 뒤 reasoning continuity가 중요
* preserved thinking이 특히 가치 있음
* “다음 단계”를 짧게라도 유지하는 설계가 유리

### Reflexion

Reflexion은 언어적 feedback과 episodic memory buffer가 후속 시도에서 더 나은 결정을 돕는다고 보여줍니다. ([arXiv][8])

적용:

* `previousSummaries`
* `sessionCandidatePaths`
* checkpoint feedback
* dropped evidence에 대한 self-correction

이런 구조는 사실상 Reflexion-lite입니다.

### SWE-agent

SWE-agent는 agent-computer interface(ACI) 설계가 repo navigation과 task execution 성능에 큰 영향을 준다고 말합니다. ([arXiv][9])

적용:

* tool descriptions와 selection policy는 단순 부가 정보가 아니라 성능 요소
* `repo_symbol_context`, `repo_git_*`, `repo_grep`의 역할 구분이 중요
* strategy별 툴 노출/우선순위 최적화가 성능에 직접 영향

---

## 6-3. 구조화 JSON 출력 강제 기법

Cerebras structured outputs는 `json_schema + strict=true`일 때 constrained decoding으로 schema 위반을 막습니다. 또한 strict mode에서는 모든 object에 `additionalProperties:false`가 필요합니다. 현재 프로젝트 스키마는 이 요구를 이미 잘 지키고 있습니다. ([Cerebras Inference][3])

적용 인사이트:

* final answer는 **무조건 strict schema**
* `json_object`는 legacy fallback
* schema description/property descriptions 보강
* parse-repair보다 schema-constrained finalization이 우선

---

## 6-4. 멀티턴 에이전트 컨텍스트 관리 전략

LangChain은 model context를 **instructions, messages, tools, model, response format**의 묶음으로 보며, 이 결정들이 reliability와 cost를 직접 좌우한다고 설명합니다. 또한 오래된 대화를 summary로 대체하는 summarization middleware를 대표적 lifecycle pattern으로 제시합니다. ([LangChain Docs][10])

Claude Code 문서는 context가 차오를수록 성능이 떨어지고, 이전 지시를 잊거나 실수가 늘 수 있으며, compaction/summarization이 중요하다고 설명합니다. 또한 subagent는 별도 context window를 써서 연구/탐색을 메인 대화에서 격리할 수 있습니다. ([Anthropic][7])

적용:

* 오래된 tool 결과를 summary message로 압축
* main loop와 finalizer/critic를 분리
* 추후에는 explorer 서브에이전트를 별도 context window로 운영하는 구조도 고려 가능

---

## 6-5. 코드 탐색 에이전트 사례

### OpenHands

OpenHands planning agent 예시는 **read-only tools로 plan을 만들고, 이후 execution agent가 실행**하는 2단계 구조를 보여줍니다. custom tool set, custom system prompt, testing/validation structure를 강조합니다. ([OpenHands Docs][11])

적용:

* 현재 explorer는 이미 read-only planner 성격이 강함
* 그 다음 단계로 “verify/finalize critic”를 붙이면 OpenHands식 분업에 가까워짐

### Aider

Aider는 repo map을 사용해 전체 저장소의 핵심 클래스/함수/시그니처를 압축 제공하고, irrelevant files를 많이 넣으면 LLM이 혼란스러워진다고 명시합니다. 또한 복잡한 변경은 먼저 계획하고, 목표를 작은 단계로 쪼개라고 조언합니다. ([Aider][12])

적용:

* `candidatePaths`를 단순 리스트에서 mini repo map으로 강화 가능
* breadth-first 전략에 repo map/entry point summary가 특히 효과적
* “관련 없는 파일을 많이 읽지 말라”는 현재 minimal footprint 철학이 맞다

---

# 챕터 7: 우선순위별 개선 로드맵

## 7-1. 즉시 적용 가능한 것

| 항목                                                 | 예상 효과                        | 난이도   |    |
| -------------------------------------------------- | ---------------------------- | ----- | -- |
| normal/deep의 `temperature:0.1` 제거, GLM 권장 영역으로 조정  | 매우 큼                         | 낮음    |    |
| GLM에서 `reasoningEffort: low                        | medium`제거,`none` 또는 생략으로 재설계 | 큼     | 낮음 |
| 최종 응답을 항상 strict `json_schema` finalize로 통일        | 매우 큼                         | 낮음~중간 |    |
| `clear_thinking` + `message.reasoning` plumbing 추가 | 매우 큼                         | 중간    |    |
| system/finalize prompt front-load 강화               | 큼                            | 낮음    |    |

### 제가 지목하는 “첫 번째 개선”

**가장 낮은 비용으로 가장 큰 품질 향상을 기대할 수 있는 첫 개선은**
`normal/deep에서 temperature 0.1 고정을 없애고, GLM-4.7 권장 reasoning 계약에 맞추는 것`입니다.

이유:

* 코드 수정량이 가장 작음
* 모든 normal/deep 호출에 즉시 적용됨
* 공식 문서와의 충돌을 바로 해소함
* 현재 품질 저하 가능성이 가장 넓게 퍼져 있는 설정임 ([Cerebras Inference][1])

**바로 뒤이은 2순위**는
“final answer를 항상 strict json_schema finalize로 통일”입니다.

---

## 7-2. 단기 개선

| 항목                                                  | 예상 효과 | 난이도 |
| --------------------------------------------------- | ----- | --- |
| strategy를 “제안”으로 낮추고 first-result 이후 override 허용    | 큼     | 낮음  |
| strategy별 numbered step 가이드 추가                      | 큼     | 낮음  |
| checkpoint prompt(예: 5턴마다 sufficiency 판단)           | 중간~큼  | 낮음  |
| evidence ledger 지시 추가                               | 큼     | 낮음  |
| finalize schema description / field descriptions 보강 | 중간    | 낮음  |
| finalize max tokens 상향                              | 중간    | 낮음  |

---

## 7-3. 중장기 개선

| 항목                                         | 예상 효과 | 난이도   |
| ------------------------------------------ | ----- | ----- |
| git evidence를 담는 union schema 도입           | 중간~큼  | 중간    |
| raw tool result compaction / summarization | 매우 큼  | 중간~높음 |
| mini repo map / symbol summary 주입          | 큼     | 중간    |
| critic pass 또는 explorer/validator 2-pass   | 매우 큼  | 중간    |
| strategy별 tool exposure 조정 / dynamic tools | 중간    | 중간    |
| benchmark harness + seed 기반 ablation       | 큼     | 중간    |

---

## 7-4. 추천 실행 순서

### 1단계: 오늘 바로 바꿀 것

1. `temperature` 재설정
2. `reasoningEffort low/medium` 제거
3. `top_p: 0.95` 명시
4. final answer를 항상 strict finalize로 통일
5. finalize prompt 강화

### 2단계: 이번 주에 바꿀 것

1. `clear_thinking: false` + `message.reasoning` 보존
2. strategy override 허용
3. checkpoint prompt 삽입
4. finalize token 상향

### 3단계: 다음 스프린트

1. evidence schema 확장
2. tool history compaction
3. critic pass
4. repo map / symbol summary 압축 주입

---

# 최종 제안 요약

## 가장 중요한 진단 5개

1. **현재 프롬프트는 나쁘지 않지만, GLM-4.7이 선호하는 front-loaded hard-constraint 구조로는 덜 다듬어져 있습니다.** ([Cerebras Inference][1])
2. **`temperature:0.1` 고정은 normal/deep에서 공식 권장과 충돌합니다.** GLM-4.7 reasoning을 살릴 생각이면 0.8 이하를 피해야 합니다. ([Cerebras Inference][1])
3. **`clear_thinking` 미사용 + `message.reasoning` 미보존 때문에 멀티턴 탐색의 강점을 스스로 버리고 있습니다.** ([Cerebras Inference][2])
4. **strict JSON schema는 이미 잘 만들어져 있는데, main success path에서 항상 사용되지 않는 것이 가장 큰 출력 안정성 손실입니다.** ([Cerebras Inference][3])
5. **전략 자동 감지는 시작점으로는 좋지만, override 불가와 git evidence 스키마 부족 때문에 깊은 질문에서 병목이 생깁니다.**

## 제가 이 프로젝트에 바로 적용하라고 권하는 최소 패치

* `temperature`: quick 0.3 / normal 0.8 / deep 1.0
* `reasoning_effort`: quick만 `"none"`, 나머지는 생략
* `top_p: 0.95` 추가
* `clear_thinking:false` + `message.reasoning` 보존
* final answer는 항상 `json_schema strict:true` dedicated finalize
* system prompt를 front-load 구조로 재배치
* finalize prompt에 self-check와 exact-one-JSON 규칙 추가

이 6개만 해도, 현재 설계의 품질은 꽤 크게 올라갈 가능성이 높습니다.

원하시면 다음 답변에서 제가 바로 `prompt.mjs`, `config.mjs`, `cerebras-client.mjs`, `runtime.mjs` 기준으로 **실제 패치 초안(diff 스타일)**까지 적어드릴 수 있습니다.

[1]: https://inference-docs.cerebras.ai/resources/glm-47-migration "https://inference-docs.cerebras.ai/resources/glm-47-migration"
[2]: https://inference-docs.cerebras.ai/api-reference/chat-completions "https://inference-docs.cerebras.ai/api-reference/chat-completions"
[3]: https://inference-docs.cerebras.ai/capabilities/structured-outputs "https://inference-docs.cerebras.ai/capabilities/structured-outputs"
[4]: https://inference-docs.cerebras.ai/capabilities/reasoning "https://inference-docs.cerebras.ai/capabilities/reasoning"
[5]: https://docs.z.ai/guides/capabilities/struct-output "https://docs.z.ai/guides/capabilities/struct-output"
[6]: https://arxiv.org/abs/2210.03629 "https://arxiv.org/abs/2210.03629"
[7]: https://www.anthropic.com/engineering/claude-code-best-practices "https://www.anthropic.com/engineering/claude-code-best-practices"
[8]: https://arxiv.org/abs/2303.11366 "https://arxiv.org/abs/2303.11366"
[9]: https://arxiv.org/abs/2405.15793 "https://arxiv.org/abs/2405.15793"
[10]: https://docs.langchain.com/oss/python/langchain/context-engineering "https://docs.langchain.com/oss/python/langchain/context-engineering"
[11]: https://docs.openhands.dev/sdk/guides/agent-custom "https://docs.openhands.dev/sdk/guides/agent-custom"
[12]: https://aider.chat/docs/repomap.html "https://aider.chat/docs/repomap.html"
