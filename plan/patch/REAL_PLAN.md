# 실행 우선순위가 반영된 실제 작업 계획표

아래 순서는 “무엇이 가장 중요하냐”보다 **무엇을 먼저 고쳐야 다음 개선이 제대로 측정되느냐**를 기준으로 잡았습니다.
즉, **코드 착수 1순위는 출력 계약 단일화**, **설정만 빨리 바꿀 1순위는 temperature/top_p 정렬**입니다. GLM-4.7/Cerebras 문서 기준으로는 GLM-4.7은 reasoning이 기본 활성화되어 있고, agentic workflow에는 `clear_thinking: false`가 권장되며, 기본 샘플링은 `temperature=1.0`, `top_p=0.95`입니다. 또한 required rules는 프롬프트 앞쪽에 배치하고, 언어를 명시적으로 고정하는 편이 더 안정적입니다. ([Cerebras Inference][1])

현재 코드 기준으로는 no-tool 종료 시 strict finalize를 항상 거치지 않고, freeform 응답에서 첫 JSON object를 추출해 종료하는 경로가 있습니다. 또한 Cerebras client는 `temperature: 0.1` 중심으로 설계되어 있고 `top_p`, `clear_thinking`, `message.reasoning` round-trip이 빠져 있습니다. [runtime.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/runtime.mjs) · [cerebras-client.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/cerebras-client.mjs) · [config.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/config.mjs)

## 전체 실행 순서 요약

| Phase   | 우선순위 | 핵심 목표                          | 손대는 파일                                             | 기대 효과                      | 난이도   |
| ------- | ---- | ------------------------------ | -------------------------------------------------- | -------------------------- | ----- |
| Phase 0 | P0   | 회귀 방지용 기준선 확보                  | tests, benchmark script                            | 이후 개선 효과를 비교 가능            | 낮음    |
| Phase 1 | P0   | 최종 출력 경로를 strict finalize로 단일화 | runtime, prompt, config, tests                     | JSON 안정성 즉시 상승             | 낮음~중간 |
| Phase 2 | P0   | GLM-4.7/Cerebras 파라미터 계약 정렬    | config, cerebras-client, runtime, providers, tests | reasoning/agent loop 품질 상승 | 중간    |
| Phase 3 | P1   | 프롬프트 구조 재배치 + 전략 유연화           | prompt, runtime, tests                             | tool 선택 안정화, 언어 혼용 감소      | 낮음~중간 |
| Phase 4 | P1   | 멀티턴 안정화 장치 추가                  | runtime, prompt, tests                             | deep 탐색 품질 상승              | 중간    |
| Phase 5 | P2   | evidence/schema/context 고도화    | schemas, runtime, session                          | git/blame형 질문 품질 상승        | 중간~높음 |

---

## Phase 0 — 기준선/안전망 먼저 만들기

### 목표

지금 상태를 **비교 가능한 숫자**로 고정합니다. 이 단계를 먼저 해야 Phase 1~5에서 “좋아졌는지”를 말할 수 있습니다.

### 작업

`tests/runtime.mock.test.mjs`, `tests/cerebras-client.test.mjs`, `scripts/run-benchmark.mjs`에 아래를 추가합니다.

* JSON parse 성공률
* strict schema 적합률
* 평균 tool turns
* budget exhaustion 비율
* grounded evidence 개수
* no-tool 종료 경로 비율
* deep budget에서 평균 total tokens

### 완료 기준

* 현재 main 브랜치 결과를 1회 저장
* 이후 각 PR마다 같은 케이스로 비교 가능

### 메모

이 단계는 품질 개선이 아니라 **측정 인프라**입니다. 작지만 꼭 먼저 두는 게 좋습니다.

---

## Phase 1 — 최종 출력 경로 단일화

### 왜 1순위인가

지금은 no-tool 종료 시 바로 `extractFirstJsonObject()`로 빠지는 경로가 있어서, **strict schema를 이미 정의해 놓고도 항상 활용하지 못합니다.** Structured Outputs의 strict mode는 valid JSON, 스키마 준수, 타입 안정성을 보장하도록 설계되어 있습니다. ([Cerebras Inference][2])

### 대상 파일

[runtime.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/runtime.mjs)
[prompt.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/prompt.mjs)
[config.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/config.mjs)
[schemas.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/schemas.mjs)

### 작업 항목

1. `toolCalls.length === 0`일 때도 **항상** `finalizeAfterToolLoop()`를 거치게 변경
2. `finalizeAfterToolLoop()`의 `maxCompletionTokens: 2500` 하드코딩 제거
3. budget별 `finalizeMaxCompletionTokens` 추가
4. `buildFinalizePrompt()` 강화

    * exactly one JSON object
    * no markdown
    * no extra text
    * grounded evidence only
    * no tools
5. `extractFirstJsonObject()`는 **최후 fallback**으로만 남기기

### 바로 적용할 코드 방향

현재는 [runtime.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/runtime.mjs) 에서 “tool call 없음 → freeform JSON 추출 → 종료” 흐름입니다. 이것을 “tool call 없음 → dedicated strict finalize → 종료”로 바꿉니다.

### 완료 기준

* 성공 경로 100%가 strict finalize를 통과
* markdown fence / 앞뒤 설명문이 섞인 응답이 더 이상 main path에서 통과하지 않음
* 관련 테스트 추가:

    * no-tool 종료도 strict finalize 사용
    * finalize prompt가 툴 호출 없이 끝남
    * malformed freeform assistant content가 있어도 최종 JSON은 스키마 준수

### 기대 효과

가장 빠르게 체감되는 개선입니다. 이후 파라미터 튜닝 결과도 훨씬 깨끗하게 비교됩니다.

---

## Phase 2 — Cerebras/GLM-4.7 실행 파라미터 정렬

### 왜 바로 다음인가

GLM-4.7 문서상 기본 샘플링은 `temperature=1.0`, `top_p=0.95`이고, thinking이 켜진 상태에서 `temperature < 0.8`은 품질 저하를 유발할 수 있으니 이런 경우 reasoning도 꺼야 한다고 안내합니다. 또 agentic workflow에는 `clear_thinking: false`가 권장되며, `clear_thinking` 기본값은 `true`입니다. `max_completion_tokens`는 reasoning tokens까지 포함합니다. ([Cerebras Inference][1])

### 대상 파일

[config.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/config.mjs)
[cerebras-client.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/cerebras-client.mjs)
[runtime.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/runtime.mjs)
[providers/abstract.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/providers/abstract.mjs)
[providers/openai-compat.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/providers/openai-compat.mjs)

### 작업 항목

1. `reasoningEffort: low|medium` 제거 또는 내부 정책 플래그로 전환

    * 문서상 GLM-4.7은 reasoning enabled by default이고, documented disable knob는 `none`입니다. ([Cerebras Inference][3])
2. budget를 아래처럼 재정의

    * quick: reasoning off, `temperature 0.3`, `top_p 0.95`
    * normal: reasoning on, `temperature 0.8`, `top_p 0.95`, `clear_thinking false`
    * deep: reasoning on, `temperature 1.0`, `top_p 0.95`, `clear_thinking false`
3. `cerebras-client.mjs`에 `top_p`, `clear_thinking`, `reasoning` 필드 처리 추가
4. assistant 응답의 `message.reasoning` 추출
5. reasoning이 있는 assistant turn은 다음 요청에 그대로 다시 전달

    * Cerebras 문서는 reasoning이 포함된 assistant message를 다시 넘기라고 명시합니다. ([Cerebras Inference][3])
6. `openai-compat` provider에서는 해당 필드를 무시하되 인터페이스는 받아들일 수 있게 정리

### 권장 budget 설정

* quick: `reasoning_effort="none"`, `temperature=0.3`, `top_p=0.95`, `maxCompletionTokens=4000`
* normal: reasoning on, `temperature=0.8`, `top_p=0.95`, `clear_thinking=false`, `maxCompletionTokens=8000`
* deep: reasoning on, `temperature=1.0`, `top_p=0.95`, `clear_thinking=false`, `maxCompletionTokens=12000~14000`

### 완료 기준

* Cerebras payload에 `top_p`가 포함됨
* normal/deep에서 `clear_thinking:false`
* quick에서 reasoning off
* assistant reasoning이 턴 간 round-trip됨
* `tests/cerebras-client.test.mjs`에 payload 검증 추가

### 실무 팁

“설정만 빨리 바꾸는 핫픽스” 1개를 고르라면 이 Phase에서 **normal/deep temperature + top_p**만 먼저 바꿔도 됩니다. 다만 **정식 착수 순서**는 Phase 1이 먼저입니다.

---

## Phase 3 — 프롬프트 구조 재배치 + 전략 유연화

### 왜 여기서 하나

파라미터 정렬까지 끝내야 prompt 개편 효과를 제대로 볼 수 있습니다. GLM-4.7은 required rules를 system prompt 앞쪽에 두고, MUST/REQUIRED 같은 직접적인 표현과 default language 명시를 권장합니다. ([Cerebras Inference][1])

### 대상 파일

[prompt.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/prompt.mjs)
[runtime.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/runtime.mjs)

### 작업 항목

1. system prompt 순서를 재배치

    * 역할
    * HARD REQUIREMENTS
    * FINAL OUTPUT CONTRACT
    * LANGUAGE RULE
    * TOOL ORDER POLICY
    * STRATEGY CATALOG
    * PROJECT CONTEXT
2. user prompt의 `Follow the {strategy} strategy above.`를 완화

    * “initial strategy suggestion”으로 낮춤
    * 첫 tool result 후 1회 전략 전환 허용
3. default language를 system prompt에서도 다시 고정
4. tool-order를 자연어 선호가 아니라 decision policy로 변경

    * symbol question → `repo_symbol_context`
    * history question → `repo_git_log`
    * ambiguous → `repo_grep` / `repo_find_files`
    * `repo_read_file`은 정밀 확인 단계

### 완료 기준

* system prompt 앞 20~30줄 안에 hard rule이 모두 배치
* strategy mis-detection 시 1회 override 가능
* 한국어 task에서 `answer/summary/why` 언어 혼합 빈도 감소

### 기대 효과

* 불필요한 `repo_read_file` 선호 감소
* 한국어/영어 혼용 감소
* wrong strategy 고착 완화

---

## Phase 4 — 멀티턴 안정화 장치

### 왜 필요한가

GLM-4.7은 interleaved thinking / preserved thinking을 agentic 작업에 맞춰 강화했고, `clear_thinking:false`는 과거 tool-calling reasoning이 미래 tool call에 도움이 될 때 권장됩니다. ([Cerebras Inference][1])

### 대상 파일

[runtime.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/runtime.mjs)
[prompt.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/prompt.mjs)

### 작업 항목

1. **Checkpoint message** 삽입

    * 4~5턴마다
    * “지금까지 근거로 답 가능한가?”
    * “불가능하면 가장 가치 높은 다음 tool 1개만 선택”
2. **critic-lite verify pass** 추가

    * finalize 직전 1회
    * unsupported claim이 있으면 confidence를 낮추게 함
3. **evidence ledger** 규칙 추가

    * 탐색 중 `path/start/end/why` 후보를 내부적으로 관리하도록 프롬프트에 명시
4. too-early stop 방지 규칙 추가

    * why/bug/root-cause 질문은 2개 이상의 독립 근거 권장
    * trivial locate/define 질문은 1개 근거 허용

### 완료 기준

* deep budget에서 budget exhaustion 비율 감소
* high confidence인데 grounded evidence 1개뿐인 케이스 감소
* why/bug 질문의 followup 품질 향상

### 기대 효과

깊은 탐색의 “흔들림”을 줄입니다. Phase 2의 preserved thinking과 같이 들어가면 체감이 큽니다.

---

## Phase 5 — evidence/schema/context 고도화

### 왜 마지막인가

이건 가장 가치가 있지만 구조 변경 범위가 큽니다. 앞 단계가 정리된 뒤 해야 리스크가 낮습니다.

### 대상 파일

[schemas.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/schemas.mjs)
[runtime.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/runtime.mjs)
[session.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/session.mjs)

### 작업 항목

1. evidence를 union type으로 확장

    * `file_range`
    * `git_commit`
    * `git_blame`
2. `sessionCandidatePaths`를 단순 문자열 배열에서 구조화

    * `{ path, why }`
3. 오래된 tool result compaction 도입

    * raw tool JSON을 계속 쌓지 말고 checkpoint summary로 축약
4. strategy별 동적 tool 노출 검토

    * deep/context-heavy 세션에서 prompt token 절약

### 완료 기준

* git/blame 중심 질문에서도 evidence가 자연스럽게 표현됨
* deep 세션에서 컨텍스트 증가 속도 완화
* session 재사용 시 relevance hint 품질 상승

### 기대 효과

“무엇이 바뀌었나”, “왜 생겼나”, “누가/언제 건드렸나” 같은 질문 품질이 올라갑니다.

---

## PR 단위로 쪼개면 이렇게 가는 게 좋습니다

### PR-1

Phase 0 + Phase 1
출력 안정화 전용 PR

### PR-2

Phase 2
Cerebras 파라미터/Preserved Thinking 정렬 PR

### PR-3

Phase 3
Prompt refactor PR

### PR-4

Phase 4
Checkpoint / critic-lite / evidence ledger PR

### PR-5

Phase 5
Schema/context 확장 PR

---

## 딱 하나만 먼저 한다면

**코드 착수 1순위:**
`runtime.mjs`에서 **모든 종료 경로를 dedicated strict finalize로 통일**하세요. [runtime.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/runtime.mjs) · [schemas.mjs](sandbox:/mnt/data/repo/cerebras-explorer-mcp-master/src/explorer/schemas.mjs)

**설정 핫픽스 1순위:**
`normal/deep`의 `temperature: 0.1`을 버리고 `top_p: 0.95`를 명시하세요. GLM-4.7은 일반적으로 `temperature=1.0`, instruction-following에선 `0.8` 수준을 권장하고, thinking이 켜진 상태에서 `temperature < 0.8`은 품질 저하 가능성이 있다고 안내합니다. ([Cerebras Inference][1])

원하면 다음 답변에서 이 계획표를 바로 **PR 체크리스트 형식**이나 **diff 순서 형식**으로 바꿔서 적어드리겠습니다.

[1]: https://inference-docs.cerebras.ai/resources/glm-47-migration "Migrate to GLM 4.7 - Cerebras Inference"
[2]: https://inference-docs.cerebras.ai/capabilities/structured-outputs "Structured Outputs - Cerebras Inference"
[3]: https://inference-docs.cerebras.ai/api-reference/chat-completions "Chat Completions - Cerebras Inference"
