# cerebras-explorer-mcp 계획 분석 보고서

검토 범위는 `plan/roadmap.md`, `plan/explorer-mode.md`, `plan/git-history-confidence.md`와 함께, 실제 구현 경로인 `src/explorer/*`, `src/mcp/server.mjs`, `README.md`, `DESIGN.md`, 관련 테스트와 벤치마크 설정까지 포함했습니다. 로컬에서 `npm test`도 실행해 봤고, 현재 테스트는 통과하지만 세 계획 문서가 다루는 핵심 리스크들 중 일부는 아직 테스트로 보호되지 않는 상태였습니다.

먼저 총평을 한 문장으로 말하면 이렇습니다.

> **세 문서 모두 문제 인식은 대체로 정확하고 파일 타깃도 잘 짚고 있지만, “기능 확장 속도”가 “계약 정합성·신뢰도 검증·세션 의미론 정리”보다 앞서 가고 있습니다.**
> 지금 시점의 가장 중요한 일은 새 기능 추가 자체보다, 이미 약속한 인터페이스와 confidence 체계를 더 정직하게 만드는 것입니다.

---

# 1. `roadmap.md` — Active Backlog 분석

## 1.1 전체 backlog 요약 및 구조 파악

`roadmap.md`는 “큰 기능은 대부분 들어갔고, 이제 남은 것은 **동작 불일치**, **문서/스키마 정리**, **선택적 확장**”이라는 관점으로 backlog를 정리하고 있습니다. 이 framing 자체는 좋습니다. 실제 코드도 그런 상태에 가깝습니다. 즉, 기초 뼈대는 이미 있고, 지금 문제는 “없어서 못 쓰는 것”보다 “있는 줄 알았는데 완전히 맞지는 않는 것”에 더 가깝습니다.

### backlog 항목별 실제 문제를 평이한 언어로 풀면

| 항목                                            | 실제로 해결하려는 문제                                      | 제 판단                            |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| P1. Session exhaustion enforcement            | 세션이 최대 호출 수를 넘으면 막아야 하는데, 현재는 실제 런타임에서 안 막힘       | **진짜 P1**                       |
| P2. `repo_symbol_context.depth` 정합성           | API는 `depth`를 받지만, 실제로는 1단계만 동작함                  | **공개 계약 신뢰 문제**                 |
| P2. `find_similar_code` structured similarity | “유사도 점수”가 있는 것처럼 기대를 만들었는데 실제 계산 로직은 없음           | **가짜 정밀도(false precision) 리스크** |
| P3. Project config field cleanup              | 설정 파일에 있는 필드 몇 개가 문서에는 보이지만 실제 코드에서는 안 씀          | **죽은 설정(dead config) 정리 문제**    |
| P1. Explorer Mode                             | 현재 구조화 JSON 중심인데, 사람용 자연어 탐색 리포트 수요를 별도 도구로 풀려는 것 | **기능 확장**                       |
| P3. Public docs polish                        | README/예시/주석과 실제 구현의 틈을 줄이기                       | **오픈소스 신뢰도 유지**                 |

### 우선순위 분류(P1/P2/P3)는 합리적인가?

부분적으로는 합리적이지만, 그대로 받아들이기에는 아쉬움이 있습니다.

#### 합리적인 점

* **Session exhaustion enforcement를 P1로 둔 것**은 맞습니다.
  이건 “나중에 멋지게 개선하면 좋은 기능”이 아니라, 이미 존재하는 세션 개념의 **계약 위반(contract violation)** 입니다.
* **Project config cleanup을 P3로 둔 것**도 대체로 맞습니다.
  당장 결과 품질을 망가뜨리는 문제라기보다는, 축적되면 신뢰를 깎는 종류의 debt입니다.

#### 아쉬운 점

* **Explorer Mode를 P1로 둔 것은 제품 전략상 이해되지만, 기술적 우선순위로는 다소 공격적**입니다.
  지금 코드베이스에는 세션 의미론, `depth` 계약, git confidence 같은 “정확성/신뢰성” 이슈가 남아 있습니다. 이 상태에서 새 public tool을 추가하면, 사용자 관점에서는 기능은 늘었는데 핵심 신뢰도가 아직 흔들리는 모양새가 됩니다.
* **`repo_symbol_context.depth`는 P2이지만, 외부 계약 신뢰라는 관점에서는 P1에 가까운 P2**입니다.
  이미 tool schema가 `minimum:1, maximum:3`으로 depth를 광고하고 있기 때문입니다.
* **`find_similar_code` structured similarity는 지금 문서 상태에 따라 P2 또는 P3**입니다.
  만약 공개 문서가 수치형 similarity를 강하게 약속하고 있다면 P2가 맞고, 이미 README에서 미구현이라고 솔직히 적고 있다면 문서 정리만으로 우선순위를 낮출 수 있습니다.
* **git confidence 문제는 roadmap의 active backlog에 직접 링크돼 있지 않다는 점**이 눈에 띕니다. 별도 문서는 잘 써져 있지만, 사용자 신뢰에 미치는 영향만 보면 backlog 상에서도 최소 P2 이상으로 걸어 둘 만합니다.

제 관점에서의 실제 우선순위는 아래가 더 자연스럽습니다.

| 제안 우선순위      | 항목                                                    |
| ------------ | ----------------------------------------------------- |
| P1           | Session validity/exhaustion enforcement + repoRoot 검증 |
| P1~P2        | git confidence false-low 완화                           |
| P2           | `repo_symbol_context.depth` 계약 정리                     |
| P2           | Explorer Mode Phase A(코어)                             |
| P2~P3        | `find_similar_code` similarity 결정                     |
| P3           | config cleanup                                        |
| release gate | public docs polish                                    |

---

## 1.2 각 항목별 상세 분석

## 1.2.1 Session exhaustion enforcement

### 현재 상태

코드상 `SessionStore`에는 분명히 `isExhausted()`가 있습니다. 호출 수 제한도 존재합니다. 기본 `maxCalls`는 5입니다.
문제는 **실제 탐색 런타임(`ExplorerRuntime.explore`)이 이 값을 전혀 검사하지 않는다는 점**입니다.

현재 흐름은 사실상 아래와 같습니다.

```js
if (args.session) {
  sessionData = sessionStore.get(args.session);
}
if (!sessionData) {
  sessionId = sessionStore.create(repoRoot);
  sessionData = sessionStore.get(sessionId);
} else {
  sessionId = args.session;
}
```

즉,

* 세션 ID가 없으면 새 세션 생성
* 세션 ID가 있어도 `get()`이 실패하면 그냥 새 세션 생성
* **exhausted 여부는 확인하지 않음**
* 더 나쁜 점은 **세션이 다른 repo에 속해 있는지도 확인하지 않음**

이건 단순히 “maxCalls를 안 막는다” 수준이 아닙니다.
현재 구현은 **unknown session / expired session / exhausted session / repo mismatch**를 모두 사실상 “새 세션 silently 생성” 쪽으로 흘리기 쉽습니다.

### 어떻게 고쳐야 하나

핵심은 “세션 재사용 실패”를 하나의 경우로 뭉개지 말고, 상태를 나눠야 한다는 점입니다.

권장 상태 분류는 이 정도입니다.

| 상태                       | 현재         | 권장                         |
| ------------------------ | ---------- | -------------------------- |
| session 미지정              | 새 세션 생성    | 그대로 유지                     |
| session 존재 + 유효          | 재사용        | 그대로 유지                     |
| session 존재 + 만료(expired) | 새 세션 생성    | **명시적 오류 또는 명시적 회전 상태 반환** |
| session 존재 + exhausted   | 새 세션 생성 가능 | **기본은 거부**가 더 안전           |
| session 존재 + 다른 repoRoot | 검증 없음      | **반드시 거부**                 |

특히 `repoRoot` mismatch는 문서에 없지만, 실무적으로 매우 중요합니다.
`SessionStore.create(repoRoot)`는 이미 `repoRoot`를 저장하고 있습니다. 그런데 런타임이 그걸 재사용 시 검증하지 않습니다. 그러면 A 저장소에서 모은 `candidatePaths`, `summaries`가 B 저장소 탐색에 주입될 수 있습니다. 이건 작은 버그가 아니라 **cross-repo context contamination**입니다.

### 구현 방식: 에러 반환 vs 자동 회전(auto-rotate)

#### 1) 명확한 에러 반환

장점:

* 호출자 입장에서 상태가 명확합니다.
* 자동화된 상위 에이전트가 “왜 continuity가 끊겼는지”를 정확히 이해할 수 있습니다.
* 잘못된 세션 ID 오타와 정상적인 새 세션 시작이 구분됩니다.
* repo mismatch를 강하게 막을 수 있습니다.

단점:

* 인터랙티브 UX에서는 한 번 더 호출해야 할 수 있습니다.
* 단순 사용자는 “그냥 이어서 해줘” 기대와 어긋날 수 있습니다.

#### 2) 자동 회전(auto-rotate)

장점:

* 사용자는 실패를 덜 체감합니다.
* 인터랙티브 모드에서는 부드럽습니다.
* 세션 TTL이 짧을 때 편합니다.

단점:

* **continuity가 끊긴 사실이 가려집니다.**
* 상위 모델은 같은 세션이 이어졌다고 착각할 수 있습니다.
* 조사 결과 누락/중복 탐색의 원인이 추적하기 어려워집니다.
* repo mismatch와 섞이면 더 위험합니다.

### 어떤 선택이 더 나은가

이 프로젝트는 “상위 모델이 구조화된 도구 결과를 믿고 후속 호출을 이어가는” 아키텍처입니다.
그렇다면 **기본값은 에러 반환이 더 낫습니다.**

정확히 말하면:

* `session` 파라미터가 **없을 때만** 새 세션을 자동 생성
* `session` 파라미터가 **있을 때 실패하면** 기본은 거부
* 다만 선택적으로 `allowSessionRotate: true` 같은 opt-in을 나중에 추가할 수 있음

이 절충안이 가장 현실적입니다.
왜냐하면 “세션을 명시적으로 준 호출”은 사용자가 **continuity를 기대하고 있다**는 뜻이기 때문입니다. 이 기대를 silent rotate로 깨면 안 됩니다.

### 추천 구현

가장 좋은 형태는 단순 에러만이 아니라 **상태를 드러내는 additive 필드**를 함께 두는 것입니다.

예:

```json
{
  "stats": {
    "sessionId": "sess_xxx",
    "sessionResolution": "reused | created | expired | exhausted | repo_mismatch",
    "remainingCalls": 2
  }
}
```

또는 invalid session일 때는 JSON-RPC 에러를 주고, 설명 메시지에 “새 세션으로 다시 시작하라”를 포함하는 방식도 가능합니다.

### 결론

* **이 항목은 P1이 맞습니다.**
* 구현 시 **exhaustion만 보지 말고 repoRoot validation까지 같이 해야 합니다.**
* 기본 정책은 **invalid/exhausted session 재사용 거부**가 더 낫습니다.
* auto-rotate는 편하지만, 이 프로젝트의 신뢰 모델과는 잘 맞지 않습니다.

---

## 1.2.2 `repo_symbol_context.depth` 정합성

### 현재 어떤 상태인가

`repo_symbol_context`는 tool schema에서 `depth: 1..3`을 받습니다.
하지만 실제 구현은 `depth` 값을 받아도 **전혀 재귀 확장하지 않습니다.**

실제 함수는 대략 이렇게 동작합니다.

1. `grep`으로 심볼 출현 위치 탐색
2. 정의(definition)와 사용(callers) 분류
3. 정의 파일에 대해 `repo_symbols`로 범위 정교화
4. 정의 본문만 `readFile`
5. direct callers만 반환

즉, 지금의 `depth`는 사실상 **설계상의 미래 약속**이지, 현재 기능이 아닙니다.

### API 계약과 실제 구현이 어긋날 때의 신뢰 비용

이 문제의 본질은 “depth가 더 좋은 기능으로 동작하지 않는다”가 아니라, **도구 설명이 사용자의 mental model을 잘못 만든다**는 데 있습니다.

특히 이 프로젝트는 상위 에이전트가 tool schema를 읽고 도구를 선택합니다.
그러면 상위 모델은 `depth: 3`을 믿고 “한 번에 caller chain 3단계까지 오겠지”라고 기대할 수 있습니다. 실제로는 depth 1 결과만 받으면, 상위 모델은:

* 왜 정보가 부족한지 잘 모르고,
* 불필요한 후속 호출을 하거나,
* 잘못된 추론으로 빈칸을 메울 수 있습니다.

즉, 이건 사람 사용자보다 **도구를 사용하는 다른 LLM/agent에게 더 위험한 문서 거짓말**입니다.

### `depth > 1` 실제 구현의 기술적 복잡도

겉보기엔 단순히 재귀를 한 번 더 돌리면 될 것 같지만, 실제로는 생각보다 어렵습니다.

#### 왜 어려운가

현재 구현은 “심볼 이름이 이 줄에 있다” 정도는 알지만,
그 사용이 **어떤 함수/메서드/클래스의 문맥 안에서 발생했는지**를 정밀하게 알지 못합니다.

진짜 `depth > 1`을 구현하려면 최소한 아래가 필요합니다.

| 필요한 것                              | 현재 상태       |
| ---------------------------------- | ----------- |
| usage line이 속한 enclosing symbol 찾기 | 부분적으로만 가능   |
| caller symbol 이름을 안정적으로 추출         | 언어별/패턴별 불안정 |
| 재귀 확장 시 cycle detection            | 없음          |
| fan-out 제한                         | 없음          |
| depth별 결과 표현 구조                    | 없음          |
| 다국어/regex 기반 심볼 추출 품질 보정           | 제한적         |

즉, 지금 구조에서 `depth > 1`은 “한 줄 if문 추가”가 아니라 **caller graph 구축 문제**에 가깝습니다.

### 선택지 평가: 구현 vs 축소

#### A. `depth > 1` 실제 구현

장점:

* 문서/스키마와 실제 기능이 맞아집니다.
* symbol trace 계열 질문의 turn saving이 커질 수 있습니다.
* 미래 확장성은 좋아집니다.

단점:

* regex 기반 심볼 추출의 한계 때문에 결과 품질이 불균일할 가능성이 큽니다.
* 반환 스키마가 더 풍부해져야 할 수도 있습니다.
* 구현 난이도 대비 효익이 애매합니다.

#### B. 파라미터/문서를 depth=1 수준으로 축소

장점:

* 가장 정직합니다.
* 구현 복잡도를 즉시 줄입니다.
* 현재 macro tool의 역할(“2~4턴 절약”)에는 충분할 수 있습니다.

단점:

* 이미 공개된 인터페이스를 축소하는 셈입니다.
* 미래 기능 기대를 접어야 합니다.

### 제 추천

현 시점에서는 **정직한 축소가 더 낫습니다.**

정확히는:

* schema는 당장 제거 대신 **`depth`를 받아도 1로 clamp**하고,
* 결과에 `effectiveDepth: 1`, `depthHonored: false` 같은 additive 힌트를 넣거나,
* 최소한 description/README를 “currently only direct callers”로 명확히 바꾸는 편이 맞습니다.

완전한 `depth > 1`은 regex 기반 현재 아키텍처와 잘 맞지 않습니다.
정말 구현하려면 반환 형태도 다음처럼 edge/graph 중심으로 바꾸는 편이 맞습니다.

```json
{
  "symbol": "requireAuth",
  "definition": { ... },
  "edges": [
    { "from": "indexHandler", "to": "requireAuth", "depth": 1, "path": "src/index.js", "line": 10 },
    { "from": "serverStart", "to": "indexHandler", "depth": 2, "path": "src/server.js", "line": 22 }
  ],
  "truncated": false
}
```

그 정도 각오가 없다면, 지금은 **기능 축소가 더 좋은 엔지니어링**입니다.

---

## 1.2.3 `find_similar_code` structured similarity

### 현재 어떤 상태인가

`find_similar_code`는 현재 별도의 similarity engine이 아닙니다.
실제 `server.mjs`를 보면, 이 도구도 결국 `explore_repo` 호출 인자를 만들기 위한 wrapper입니다. 즉:

* 전용 검색 인덱스 없음
* 전용 유사도 계산기 없음
* 수치형 similarity 산식 없음
* LLM이 자연어로 “비슷하다”고 서술하는 수준

따라서 지금 숫자형 `similarity` 필드를 추가하면, 그 숫자는 거의 반드시 **가짜 정밀도**가 됩니다.

### similarity를 계산하는 방법 비교

| 방법                                        | 장점             | 단점                           | zero dependencies 적합성 | 제 판단                      |
| ----------------------------------------- | -------------- | ---------------------------- | --------------------- | ------------------------- |
| Embedding 기반                              | 의미적 유사도 품질이 좋음 | 외부 모델 비용, 재현성 낮음, latency 증가 | 낮음~중간                 | 품질은 좋지만 이 프로젝트 철학과 거리가 있음 |
| Heuristic lexical 기반                      | 결정적, 빠름, 설명 가능 | 의미적 유사도에 약함                  | 높음                    | 현실적인 1차 후보                |
| Structural fingerprint 기반                 | 중복 코드 탐지에 강함   | 의미적 유사도엔 약함                  | 높음                    | “유사”보다 “유사 패턴/복제”에 적합     |
| Hybrid (heuristic shortlist + LLM rerank) | 균형이 좋음         | 여전히 숫자 의미가 모호                | 중간                    | 숫자보다 rank/band가 나음        |

### 현실적인 산식 후보

#### 1) Heuristic score

예를 들면:

* identifier overlap
* import overlap
* file extension/language match
* normalized token shingles Jaccard
* function count / shape similarity

```text
score = 0.35 * identifier_overlap
      + 0.25 * import_overlap
      + 0.20 * normalized_token_overlap
      + 0.20 * structural_shape_overlap
```

장점:

* 재현 가능
* 테스트 가능
* zero dependencies 친화적

단점:

* “의미는 같은데 표현이 다른 코드”를 잘 못 잡음
* 언어별 편차 큼

#### 2) Embedding score

코드 조각이나 파일 요약을 embedding으로 바꿔 cosine similarity 계산.

장점:

* 더 semantic
* 비교적 robust

단점:

* 외부 서비스 의존
* 비용/속도 문제
* 숫자가 안정적이어도 왜 그 숫자인지 설명하기 어려움

#### 3) 숫자 대신 band

`0.83` 같은 정밀 수치 대신:

```json
{
  "similarityBand": "high",
  "reasons": ["shared provider abstraction", "same createChatCompletion shape"]
}
```

이게 오히려 이 프로젝트 철학에 맞습니다.

### 제거하는 편이 나은 경우

저는 현재 상태라면 **수치형 similarity를 문서에서 제거하는 편이 더 낫다**고 봅니다.

이유는 간단합니다.

1. 지금 구조는 similarity engine이 아니라 **탐색형 wrapper**다.
2. 숫자를 주려면 deterministic algorithm이 필요하다.
3. algorithm이 없으면 숫자는 LLM 서술을 포장한 가짜 precision이 된다.
4. 이 프로젝트는 evidence/grounding을 중시하는데, similarity 숫자는 오히려 그 철학을 해친다.

### 제안

가장 좋은 절충안은 아래 둘 중 하나입니다.

#### 보수적 안

* README에서 numeric similarity 기대를 제거
* 대신 “유사 이유(reasoned similarity)”를 강조
* benchmark도 qualitative match 중심 유지

#### 공격적 안

* heuristic score를 명시적으로 도입
* score 정의를 README/DESIGN에 공개
* `similarityMethod: "heuristic-v1"` 같이 버전 필드 추가

제 개인적 추천은 **지금은 제거**, 나중에 deterministic heuristic이 준비되면 다시 넣는 것입니다.

---

## 1.2.4 Project config field cleanup

### 현재 상태

`.cerebras-explorer.json` 관련 주석과 로더는 `languages`, `customSymbolPatterns`, `entryPoints`를 인정하는 것처럼 보입니다.
그런데 실제 정규화(`normalizeProjectConfig`)와 런타임 소비 경로를 보면:

* `entryPoints`는 정규화는 되지만 실질 소비 안 됨
* `languages`는 문서상 언급되지만 정규화/소비 안 됨
* `customSymbolPatterns`도 문서상 언급되지만 정규화/소비 안 됨

즉, 이 세 필드는 현재 **“있다고 적혀 있지만 실제로는 기능이 아님”** 상태입니다.

### 필드별 부가 가치

| 필드                     | 실제로 연결하면 생기는 가치                 | 지금 제거할 때의 장점 |
| ---------------------- | ------------------------------- | ------------ |
| `entryPoints`          | 아키텍처 질문/diagram/trace 시작점 품질 향상 | 간단해짐         |
| `languages`            | 도구 선택/프롬프트 힌트/심볼 추출 우선순위 개선     | 죽은 옵션 제거     |
| `customSymbolPatterns` | 지원 언어 밖 DSL/사내 규칙 확장 가능         | 유지보수 리스크 제거  |

### `entryPoints`를 연결할 경우

이건 세 필드 중 **가장 투자 대비 가치가 큰 항목**입니다.

왜냐하면 현재 `buildCodeMap()`은 파일명 패턴(`index`, `main`, `app`, `server`)으로 entry point를 추정하는데, 이건 꽤 거칩니다. `entryPoints`를 실제로 연결하면:

* diagram의 시작점 정확도 향상
* `trace_dependency` 질문의 초기 seed 개선
* breadth-first 구조 탐색의 초기 읽기 파일 선정 개선
* 구조 질문에서 “무엇이 진짜 시작 파일인가”를 더 repo-specific하게 다룰 수 있음

즉, `entryPoints`는 **실제로 탐색 품질을 올릴 수 있는 설정**입니다.

### `customSymbolPatterns`를 연결할 경우

가치는 분명 있습니다. 특히:

* shell script
* SQL migration
* proto
* custom DSL
* framework convention file

같은 데서 “정의”를 잡고 싶을 때 유용할 수 있습니다.

하지만 이건 생각보다 위험합니다.

* 사용자 제공 regex 검증 필요
* catastrophic backtracking 리스크
* 언어별 line range/endLine 계산 방식 일관성 문제
* 테스트 조합 폭발

즉, **가치는 높지만 설계가 필요**합니다. 지금 backlog의 “cleanup” 수준 항목으로 다루기엔 조금 무겁습니다.

### `languages`를 연결할 경우

이 필드는 정보적 힌트로는 쓸모가 있습니다.
예:

* 프롬프트에서 “이 repo는 TS/TSX 중심”이라 알려주기
* 심볼 도구를 우선 시도할지 grep을 우선 시도할지 조정
* 파일 필터링/우선순위 조정

하지만 현재 구조에서는 **직접적인 기능 개선 효과가 약합니다.**
그래서 이 필드는 지금 바로 연결하는 것보다, “정말 어디에 쓸지 정하고 넣을 때” 다시 도입하는 편이 낫습니다.

### 연결하지 않고 제거할 때의 득실

#### 득

* 문서 신뢰도 회복
* 설정 파일 단순화
* 테스트/지원 범위 축소

#### 실

* 미래 확장 여지 축소
* 고급 사용자의 repo-specific tuning 포인트 감소

### 제 추천

가장 실용적인 결정은 이것입니다.

1. **`entryPoints`는 실제 기능에 연결**
2. **`languages`, `customSymbolPatterns`는 일단 문서/주석에서 제거**
3. 나중에 별도 설계 문서가 생기면 재도입

즉, “셋 다 살릴지 버릴지”가 아니라 **유효한 것부터 살리고, 애매한 것은 과감히 숨기는 전략**이 맞습니다.

---

## 1.2.5 Explorer Mode (roadmap 상 간략 기재)와 `explorer-mode.md`의 일관성

### 일관적인 부분

roadmap의 요약은 `explorer-mode.md`와 큰 방향에서 잘 맞습니다.

* 별도 MCP tool `explore`
* 자연어 프롬프트 → 자연어 리포트
* thoroughness 기반 깊이 제어
* 전략 미지정
* 병렬 도구 실행

즉, 한 줄짜리 backlog 항목이 실제 상세 기획 문서와 **방향성 측면에서는 일치**합니다.

### 미묘하게 어긋나는 부분

하지만 세부 구현 위험은 roadmap 요약에 충분히 드러나지 않습니다.

#### 1) 병렬 실행은 “새 기능”이면서 동시에 “기존 공유 루프 리팩터링”

`explorer-mode.md`는 병렬 실행이 `explore_repo`에도 적용 가능하다고 적고 있습니다.
즉, 이건 Explorer mode 전용 enhancement가 아니라 **공용 runtime loop 변경**입니다.

roadmap의 한 줄 설명만 보면 독립 기능 추가처럼 보이지만, 실제론 blast radius가 큽니다.

#### 2) 세션 연속성은 생각보다 복잡

`explorer-mode.md`는 기존 `SessionStore` 재사용을 말하지만, 현재 `SessionStore.update()`는 다음 필드를 기대합니다.

* `candidatePaths`
* `evidence`
* `summary`
* `followups`

그런데 `explore`의 planned output은 `report`, `filesExamined`, `toolsUsed`, `elapsedMs`, `sessionId`, `stats`입니다.
즉, 그대로 재사용하면:

* summary는 누적되지 않음
* evidencePaths는 축적되지 않음
* followups는 갱신되지 않거나 이전 값이 남을 수 있음
* `filesExamined`는 `candidatePaths`와 의미가 다름

이건 roadmap 요약만 봐서는 잘 드러나지 않는 **숨은 의존성**입니다.

#### 3) `filesExamined` 정의가 부정확할 수 있음

기획 문서 예시에서는 `filesExamined: [...observedRanges.keys()]`처럼 제안하는데, 이건 실제로는 “읽거나 grep line이 기록된 파일”만 잡습니다.
`repo_list_dir`, `repo_find_files`, `repo_symbols`, `repo_git_log`, 일부 `repo_git_show`는 탐색에 활용돼도 `observedRanges`에 안 들어갈 수 있습니다.

즉, 이 이름은 실제론 `filesRead`에 가깝고, `filesExamined`로 부르면 과장될 수 있습니다.

### 판단

* **방향 일관성은 좋다**
* 그러나 **실제 구현 복잡도와 공유 코드 영향 범위가 roadmap 요약보다 훨씬 크다**

따라서 backlog 항목에 한 줄 더 있었으면 좋았겠습니다.

예:

* “shared runtime loop refactor 가능성 있음”
* “SessionStore 재사용 방식 별도 검토 필요”

---

## 1.2.6 Public docs polish

### 문서와 실제 동작 불일치가 오픈소스 프로젝트에서 가지는 실질 리스크

이 프로젝트에서 문서 불일치는 일반적인 오픈소스보다 더 위험합니다.

왜냐하면 이 프로젝트의 사용자 중 상당수는 사람이 아니라 **상위 LLM/agent**일 가능성이 높기 때문입니다.
즉, README와 tool description은 단순한 홍보 문구가 아니라, **다른 모델이 이 시스템을 어떻게 사용할지 결정하는 운영 계약서**에 가깝습니다.

실질 리스크는 다음과 같습니다.

| 리스크           | 설명                                   |
| ------------- | ------------------------------------ |
| 잘못된 tool 선택   | 상위 모델이 `depth=3`을 믿고 한 번만 호출하는 식의 오판 |
| 잘못된 후처리       | 존재하지 않는 `similarity` 필드를 기대          |
| 과도한 신뢰/과도한 불신 | confidence 의미를 잘못 이해                 |
| 이슈 증가         | “문서에는 되는데 왜 안 되냐” 유형의 issue 발생       |
| 유지보수 비용 증가    | 코드보다 문서 설명과 기대치가 문제를 확대              |

### 이 프로젝트에서 특히 중요한 이유

이 프로젝트는 스스로를 “read-only grounded explorer”로 포지셔닝합니다.
즉, 사용자가 기대하는 핵심 가치는 화려한 기능 수보다 **정직한 contract**입니다.

그런 관점에서 문서 불일치는 단순 polish가 아닙니다.
이건 브랜드 신뢰와 직결됩니다.

### 좋은 점도 있음

공정하게 말하면, README는 이미 몇 가지 미구현 항목을 제한 사항으로 솔직하게 적고 있습니다.
예를 들어 `repo_symbol_context.depth > 1`, `find_similar_code.similarity`가 미구현이라는 점을 숨기지 않습니다. 이건 좋습니다.

문제는:

* 문서 일부는 솔직한데,
* 설정 필드나 세션 semantics처럼 **아직 완전히 드러나지 않은 틈**이 남아 있다는 점입니다.

### 결론

`Public docs polish`를 P3로 두는 건 이해되지만, 실제 운영상으로는 **각 기능 수정과 함께 바로 갱신해야 하는 release gate**에 가깝습니다.
특히:

* session semantics
* `depth`
* `similarity`
* config fields
* 새 `explore` 도구 설명

이 다섯 가지는 문서와 함께 움직여야 합니다.

---

## 1.3 Constraints 분석

roadmap의 네 가지 원칙은 모두 타당합니다. 다만 구현 방식에 꽤 직접적인 제약을 줍니다.

| 제약                     | 구현에 미치는 영향                                                     | 특히 영향 큰 항목                               |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| zero dependencies      | tree-sitter, fancy diff parser, embedding stack 같은 선택이 어려워짐    | `depth`, similarity, git diff grounding  |
| read-only              | bash fallback이나 edit-type 확장은 제한, 하지만 이 프로젝트의 안전성에는 유리         | Explorer Mode, git tooling               |
| Node 18.17+            | 최신 but not bleeding edge. async subprocess, worker_threads는 가능 | 병렬 도구 실행                                 |
| additive schema change | 기존 클라이언트 안 깨뜨려야 함                                              | git evidence schema, session metadata 확장 |

### zero dependencies

이 원칙은 이 프로젝트의 장점이기도 하고 족쇄이기도 합니다.

#### 장점

* 설치 단순
* 배포 단순
* 유지보수성 높음

#### 제약

* `repo_symbol_context.depth`를 tree-sitter 없이 정밀하게 구현하기 어려움
* similarity를 embedding 없이 semantic하게 계산하기 어려움
* git diff hunk parser도 직접 써야 함
* customSymbolPatterns 같은 기능을 robust하게 다듬기 어려움

결론적으로 zero dependencies는 **기능을 못 하게 만드는 제약**이 아니라,
“애매한 고급 기능은 과감히 포기하고, 단순하고 정직한 기능만 남기라”는 압력으로 작용합니다.

### read-only

이 제약은 세 backlog 항목에는 크게 방해되지 않습니다. 오히려 정체성 강화에 가깝습니다.

다만 Explorer Mode에서 Claude Code의 Bash-style 자유 탐색을 흉내 내고 싶어질 때, 이 원칙 때문에:

* mutate command 금지
* 임시 파일 생성/정리 금지
* 외부 툴 체인 확장 제한

이 생깁니다.
그래서 Explorer Mode는 “자유형”이더라도 **같은 RepoToolkit 도구 세트 안에서만 자유로워야** 합니다. 이건 좋은 제약입니다.

### Node 18.17+

이 제약은 겉보기엔 약하지만, 병렬 도구 실행에 꽤 중요합니다.

현재 repo tool 중 git/grep 일부는 `execFileSync` 기반입니다.
즉, 단순히 `Promise.all`을 쓴다고 진짜 병렬이 되지 않을 수 있습니다. event loop를 막기 때문입니다.

따라서 Node 18.17+에서 병렬화를 하려면:

* `execFile` async화
* bounded concurrency
* 또는 worker/thread 분리

중 하나가 필요합니다.
즉, “Node 버전은 충분하지만, 현재 구현 방식은 병렬화 친화적이지 않다”가 정확합니다.

### additive schema change

이건 특히 `git-history-confidence.md`와 직접 연결됩니다.

* `explore_repo`의 output schema는 이미 소비자들이 있을 수 있음
* evidence item에 `kind`를 추가하는 건 additive이지만,
* 실제 consumer가 `evidence[].path`만 본다면 동작 의미가 달라질 수 있음

즉, additive change는 단순히 “필드만 추가하면 된다”가 아닙니다.
**기존 필드 의미를 보존하면서 새 의미 체계를 겹쳐야 한다**는 뜻입니다.

이 제약은 아주 중요합니다.
그래서 git evidence는 “clean redesign”보다 “legacy 보존 + kind branching” 쪽으로 갈 가능성이 높습니다.

---

## 1.4 전체 backlog의 구현 순서 제안

## 제안 순서

| 단계 | 작업                                                       | 이유                                    |
| -- | -------------------------------------------------------- | ------------------------------------- |
| 1  | Session enforcement + repoRoot validation + runtime test | correctness bug, blast radius 작고 가치 큼 |
| 2  | `repo_symbol_context.depth` 결정(구현 or 축소)                 | public contract 정리                    |
| 3  | `find_similar_code` 결정(점수 도입 or 문서 기대 제거)                | 가짜 정밀도 제거                             |
| 4  | Project config cleanup (`entryPoints` 우선 연결)             | 구조 질문 품질 향상                           |
| 5  | Explorer Mode Phase A만 도입                                | shared contract가 정리된 뒤 추가             |
| 6  | Public docs polish                                       | release gate                          |

## 독립적으로 작업 가능한 항목

상대적으로 독립적인 것:

* Session enforcement
* `depth` 계약 정리
* `find_similar_code` 문서 기대치 정리
* config cleanup

상대적으로 의존성이 큰 것:

* Explorer Mode
* docs polish

## 숨은 의존성

### 1) Explorer Mode ↔ Session semantics

새 `explore` 도구는 세션을 재사용하고 싶어 하지만, 현재 SessionStore는 structured exploration 결과 형식에 맞춰져 있습니다.
즉, Explorer Mode는 backlog 상 독립 기능처럼 보이지만, 사실상 session contract를 먼저 정리해야 안전합니다.

### 2) Explorer Mode ↔ shared runtime loop

병렬 실행, progress, fallback, tool result ordering은 `explore_repo`와 충돌 가능한 공용 경로입니다.

### 3) config `entryPoints` ↔ Explorer Mode

explore-style architecture report는 entry point 힌트를 특히 잘 활용할 수 있습니다.
즉, `entryPoints`를 먼저 연결하면 Explorer Mode의 품질이 좋아질 수 있습니다.

### 4) `find_similar_code` ↔ benchmark

numeric similarity를 도입하면 benchmark도 따라와야 합니다. 현재 benchmark는 similarity 수치를 검증하지 않습니다.

### 최종 제안

roadmap만 놓고 보면 **기능 추가보다 계약 정리를 먼저** 하는 편이 맞습니다.
제일 좋은 순서는 이렇게 압축됩니다.

> **세션 정리 → 공개 계약(`depth`, `similarity`) 정리 → 설정/문서 정리 → 새 `explore` 도구 추가**

---

# 2. `explorer-mode.md` — 자유형 탐색 도구 `explore` 기획 분석

## 2.1 기획 의도 해설

### 왜 `explore_repo`와 별도로 `explore`가 필요한가

이 기획의 출발점은 타당합니다.

현재 `explore_repo`는:

* 구조화 JSON 고정
* `answer`, `summary`, `confidence`, `evidence`, `followups`
* 상위 모델이 후처리하기 쉬움

반면 어떤 작업은 이 구조가 오히려 답답합니다.

예:

* “plan 문서를 다 읽고 구현과 대조해 상세한 리뷰 리포트를 써라”
* “테스트 전략의 약점을 사람에게 설명하라”
* “아키텍처를 서술형으로 분석하라”

이런 작업은 결과가 본질적으로 **서술형(report-like)** 입니다.
JSON 필드에 억지로 넣으면:

* nuance가 줄고
* 긴 분석이 잘리고
* “중간 판단/불확실성/권고”가 부자연스러워집니다

즉, `explore_repo`는 **machine-friendly**, `explore`는 **human-friendly**라는 분리가 가능합니다.

### 이원화 전략이 MCP 생태계에서 가지는 의미

MCP 관점에서 보면 이건 꽤 흥미로운 선택입니다.

MCP에서는 도구가 discovery되고, 클라이언트는 여러 서버의 도구를 합쳐 registry로 노출하며, 모델은 name/title/description/inputSchema를 보고 어떤 도구를 부를지 결정합니다. 따라서 같은 서버 안에서도 “기계 친화적인 structured tool”과 “사람 친화적인 report tool”을 나눠 제공하는 전략은 충분히 의미가 있습니다. ([모델 컨텍스트 프로토콜][1])

이 프로젝트의 차별점 자체가 “low-level repo tools를 상위 모델에게 직접 주지 않고, 내부에 탐색 sub-agent를 숨긴다”는 데 있는데, `explore_repo`와 `explore`의 이원화는 그 전략을 더 분명하게 만듭니다.

* `explore_repo`: orchestration-friendly tool
* `explore`: analyst-friendly tool

### 다만 주의할 점

이원화가 성공하려면 두 도구의 **역할 경계가 아주 선명해야** 합니다.
그렇지 않으면 사용자는 물론 상위 모델도 “둘 중 뭐 쓰지?” 상태가 됩니다.

제 결론은:

* **기획 의도는 매우 타당**
* 하지만 **도구 경계 설명과 session/output contract 정리 없이는 혼란이 커질 수 있음**

---

## 2.2 입력 스키마 (`explore` 도구) 분석

## 2.2.1 `thoroughness` 레벨과 maxTurns 매핑의 적절성

기획안의 매핑은 이렇습니다.

| thoroughness | maxTurns | maxReadLines | maxSearchResults |
| ------------ | -------: | -----------: | ---------------: |
| quick        |        3 |          200 |               30 |
| medium       |        6 |          300 |               50 |
| thorough     |       12 |          500 |               80 |

### 좋은 점

* 사람 입장에서 이해하기 쉽습니다.
* `budget: normal/deep`보다 “thoroughness”가 리포트형 탐색엔 더 자연스럽습니다.
* quick/medium/thorough라는 단어는 사람이 기대치를 조절하기 좋습니다.

### 아쉬운 점

* `medium=6`, `thorough=12`는 turn 수만 보면 합리적이지만, **tool-call 수나 토큰량 제어와는 직접 연결되지 않습니다.**
* 현재 구현은 한 turn 안에서 여러 tool call이 나올 수 있는데, 병렬화가 들어가면 `12 turns`가 꽤 무거워질 수 있습니다.
* 기존 `budget` 체계와 새로운 `thoroughness` 체계가 **의미는 비슷하지만 이름이 다른 이중 budget system**이 됩니다.

### 제 판단

* quick=3, medium=6은 적절
* thorough=12도 가능은 하지만, **진짜 comprehensive mode**로 동작하려면 turn 외에 별도 guardrail이 필요합니다.

예:

* max total tool calls
* max total read lines across session
* max report length
* max parallel reads per turn

즉, 단순 turn mapping만으로는 충분하지 않습니다.

## 2.2.2 `scope`, `session`, `repo_root` 설계의 완성도

### `scope`

좋습니다. 기존 도구와 일관성이 있습니다.
자유형 탐색일수록 scope가 더 중요합니다. 안 그러면 “리포트형 도구”가 과도하게 넓게 헤매기 쉽습니다.

### `repo_root`

필수는 아니어도 있어야 합니다.
다만 session과 같이 쓸 때는 반드시 repoRoot binding 검증이 필요합니다. 지금 기존 runtime에도 그 검증이 없기 때문에, Explorer Mode를 추가하기 전에 고쳐야 합니다.

### `session`

표면적으로는 맞는 설계지만, 실제로는 가장 덜 완성돼 있습니다.

이유:

1. 현재 SessionStore는 structured mode 결과를 전제로 설계돼 있음
2. `explore`는 `report` 중심이라 summary/evidence/followups 갱신 방식이 다름
3. invalid/exhausted session 처리 정책도 아직 정해지지 않음

즉, `session` 필드는 기획서 표면만 보면 완성돼 있지만, **실제로는 의미론이 미완성**입니다.

## 2.2.3 빠진 파라미터

제가 보기엔 최소 3개가 부족합니다.

### 1) `language` 또는 `response_language`

현재 `explore_repo`는 language 힌트를 받을 수 있습니다.
`explore`는 자연어 report가 핵심이므로, 오히려 이 필드가 더 중요합니다.

예:

* prompt는 영어지만 결과는 한국어로 받고 싶을 수 있음
* parent model이 cross-lingual orchestration을 할 수 있음

### 2) `context`

specialized tools에는 이미 `context` 개념이 있습니다.
자유형 탐색에서는 더더욱 유용합니다.

예:

* “코드 스타일이 아니라 아키텍처 관점만 봐라”
* “성능보다 테스트 커버리지에 집중해라”

prompt에 전부 집어넣을 수도 있지만, `context`가 있으면 parent model이 더 깔끔하게 제어할 수 있습니다.

### 3) `maxReportLength` 또는 `reportStyle`

자연어 리포트는 길이 폭주 위험이 있습니다.
특히 `thorough` 모드에서는 “많이 읽었으니 많이 써야 한다”로 흐르기 쉽습니다.

예:

```json
{
  "reportStyle": "concise | balanced | detailed"
}
```

혹은

```json
{
  "maxReportLength": 3000
}
```

이런 제어점이 있으면 훨씬 실전적입니다.

### 추가로 고려할 수 있는 것

* `format: markdown | plain` (문서에도 Phase C로 있음)
* `focus: architecture | tests | git | symbols` 같은 soft hint
* `continueOnError`는 굳이 public 파라미터일 필요는 없어 보입니다

### 총평

입력 스키마는 **초안으로는 괜찮지만, public tool로 내놓기엔 아직 한두 군데 비어 있는 느낌**입니다.
특히 `language`는 Phase C가 아니라 초기에 넣는 편이 맞습니다.

---

## 2.3 출력 형식 분석

## 2.3.1 `report` 단일 자연어 필드 vs `explore_repo` 구조

### `report` 단일 자연어 필드의 장점

* 사람이 읽기 좋음
* 분석 맥락과 권고를 자연스럽게 담을 수 있음
* 복잡한 질문을 한 번에 서술하기 좋음

### 한계

* 후처리 난이도 높음
* benchmark 만들기 어려움
* session continuity에 필요한 structured memory 추출이 어려움
* “어떤 사실이 관찰이고 어떤 것이 해석인지” 경계가 흐려질 수 있음

### `explore_repo` 구조의 장점

* 자동화 친화적
* evidence 재검증 용이
* confidence pipeline과 연동 가능
* follow-up chaining이 쉬움

### 한계

* 사람에게 보여주는 긴 리뷰에는 부자연스러울 수 있음
* 출력이 schema에 과도하게 종속됨
* narrative nuance가 희생됨

### 사용 시나리오를 정리하면

| 시나리오                        | 더 적합한 도구             |
| --------------------------- | -------------------- |
| 상위 모델이 다음 tool call을 계획해야 함 | `explore_repo`       |
| UI에서 사람이 긴 분석 리포트를 읽을 것     | `explore`            |
| 벤치마크/회귀 테스트                 | `explore_repo` 쪽이 유리 |
| 감사/리뷰/설계 해설                 | `explore`가 자연스러움     |

즉, 둘은 경쟁 관계라기보다 **출력 소비자 타입이 다른 도구**입니다.

## 2.3.2 `structuredContent`로 메타데이터를 분리하는 방식의 MCP 표준 적합성

이 방향은 MCP와 잘 맞습니다. MCP 도구 결과는 텍스트 `content`와 JSON `structuredContent`를 함께 가질 수 있고, `outputSchema`도 둘 수 있습니다. 공식 spec도 structured content를 반환할 때는 backward compatibility를 위해 텍스트 블록에도 직렬화된 정보를 함께 실어 두는 방식을 권장합니다. ([모델 컨텍스트 프로토콜][2])

그래서 기획 문서의 방향 자체는 맞습니다.
다만 지금 제안된 형태는 **절반만 맞습니다.**

현재 제안:

```json
{
  "content": [{ "type": "text", "text": result.report }],
  "structuredContent": {
    "filesExamined": [...],
    "toolsUsed": 12,
    "elapsedMs": 8500,
    "sessionId": "abc123"
  }
}
```

### 문제점 1) structuredContent에 `report`가 없음

structuredContent를 주는 이유가 “machine-readable metadata”라면, `report`도 사실 그 구조 안에 있어야 더 일관적입니다.

추천:

```json
{
  "report": "...",
  "filesRead": [...],
  "toolsUsed": 12,
  "elapsedMs": 8500,
  "sessionId": "abc123",
  "stats": { ... }
}
```

그리고 `content`에는 `report` 텍스트를 그대로 넣으면 됩니다.

### 문제점 2) `sessionId`가 텍스트에 없으면 일부 클라이언트가 follow-up을 못 할 수 있음

일부 MCP 클라이언트/브리지/로그 시스템은 `content`만 보여 주거나 저장할 수 있습니다.
그 경우 structuredContent에만 `sessionId`가 있으면 다음 호출에 쓰기 어렵습니다.

### 문제점 3) `filesExamined`라는 이름이 과장될 수 있음

앞서 말했듯 `observedRanges.keys()` 기준이면 실제론 “읽은 파일/grep 매치가 있던 파일”에 가깝습니다.
따라서:

* `filesRead`
* `artifactsInspected`
* `pathsTouched`

중 하나가 더 정직합니다.

### 제 추천 출력 형태

```json
{
  "content": [
    { "type": "text", "text": "<markdown report>" }
  ],
  "structuredContent": {
    "report": "<same markdown report>",
    "filesRead": ["src/a.js", "src/b.js"],
    "candidatePaths": ["src/a.js", "src/c.js"],
    "toolsUsed": 12,
    "elapsedMs": 8500,
    "sessionId": "sess_123",
    "stats": { ... }
  }
}
```

그리고 tool definition에 `outputSchema`도 붙이는 편이 좋습니다.
이게 MCP 생태계에서 더 예측 가능하게 작동합니다. ([모델 컨텍스트 프로토콜][2])

---

## 2.4 시스템 프롬프트(`buildExploreSystemPrompt`) 분석

## 2.4.1 강점

기획된 프롬프트의 좋은 점은 명확합니다.

* read-only 원칙을 분명히 둠
* search/read 순서를 강제함
* git/symbol/list 도구 활용 힌트가 있음
* 충분하면 멈추라고 함
* 자연어 report를 markdown으로 쓰게 함
* 같은 언어로 답하라고 함

즉, 기본적인 “탐색 에이전트의 태도”는 잘 잡았습니다.

## 2.4.2 약점

하지만 `explore_repo`의 현재 structured prompt에 비해, hallucination 억제와 종료 기준은 확실히 약합니다.

### 약점 1) “충분히 읽었다”의 기준이 너무 추상적

현재 문구는:

* plan your investigation
* gather information
* stop as soon as you can answer

정도입니다.

이건 사람한테는 괜찮지만, 모델은 여기서 흔들립니다.

* 어떤 질문은 2개 파일만 읽어도 충분
* 어떤 질문은 10개 파일을 봐야 충분
* 어떤 경우는 하나 더 읽으면 중요한 모순을 발견

즉, stop criterion이 없습니다.

### 약점 2) 사실과 해석을 구분시키지 않음

자연어 report에서는 특히 다음 구분이 중요합니다.

* observed fact
* plausible inference
* unresolved uncertainty

이 구분이 없으면 보고서는 그럴듯하지만, 근거가 어디까지 직접 관찰인지 흐려집니다.

### 약점 3) source citation discipline이 약함

“file paths and line numbers where relevant” 정도로는 약합니다.
적어도 주요 주장마다 출처 표시를 유도해야 합니다.

### 약점 4) error recovery가 너무 낙관적

“directory read fails → repo_list_dir” 같은 예시는 좋지만,

* fallback loop 방지
* 같은 실패 반복 방지
* 너무 많은 grep 결과 축소 규칙

이 더 필요합니다.

## 2.4.3 모델이 “충분히 읽었다”고 판단하는 기준을 얼마나 잘 유도하는가

현재 프롬프트만으로는 **충분히 잘 유도하지 못합니다.**

제가 추천하는 exit checklist는 이렇습니다.

```text
Before finishing, check:
1. Have you answered every major sub-question in the prompt?
2. Does each major conclusion cite at least one inspected artifact?
3. Is there one obvious missing check that would likely change the conclusion?
4. If uncertainty remains, state it explicitly instead of guessing.
```

이 정도는 들어가야 모델이 불필요한 과탐색과 섣부른 종료 사이에서 균형을 잡습니다.

## 2.4.4 할루시네이션 억제 전략이 충분한가

현재는 **불충분**합니다.

왜냐하면 `explore_repo`는 최종적으로 evidence grounding과 confidence scoring이 있지만, `explore`는 설계상 그것을 약화시키는 방향이기 때문입니다.

자연어 보고서 모드에서 hallucination을 억제하려면 적어도 아래 중 하나는 있어야 합니다.

### 옵션 A: 보고서 내 source marker 강제

예:

* `src/foo.ts:10-22`
* `commit abc1234`
* `plan/roadmap.md`

### 옵션 B: 보고서와 별도로 간단한 structured provenance metadata 유지

예:

```json
{
  "sourceRefs": [
    { "kind": "file_range", "path": "src/foo.ts", "startLine": 10, "endLine": 22 },
    { "kind": "git_commit", "commit": "abc1234" }
  ]
}
```

### 옵션 C: “모르는 건 모른다고 말하라”를 더 강하게 지시

현재도 간접적으로는 있지만, 명시도가 약합니다.

## 2.4.5 개선 제안

제가 추천하는 prompt 보강은 세 가지입니다.

### 1) claim discipline 추가

```text
Do not summarize unread files as facts.
Separate direct observations from inferences.
When uncertain, say what is missing.
```

### 2) source discipline 추가

```text
For every major claim, cite at least one inspected file path and line range, or a specific git artifact.
```

### 3) stop discipline 추가

```text
Stop when one more tool call is unlikely to materially change the answer.
```

### 총평

현재 기획 프롬프트는 “좋은 초안”입니다.
하지만 `explore_repo` 수준의 신뢰도를 유지하려면, 자유형이라고 해서 provenance discipline까지 느슨해지면 안 됩니다.

---

## 2.5 `ExplorerRuntime.freeExplore()` 구현 계획 분석

## 2.5.1 기존 `explore()`에서 분기하지 않고 별도 메서드로 분리하는 결정의 타당성

문서의 직관은 맞습니다.
`explore()` 안에 mode 분기를 잔뜩 넣으면 복잡해질 가능성이 큽니다.

하지만 “public method는 분리”와 “내부 루프도 복제”는 다른 이야기입니다.

### 제가 추천하는 구조

* public API는 분리

  * `explore()`
  * `freeExplore()`

* 내부 orchestration은 공유

  * `_runExplorationLoop(modeConfig)`

즉:

```js
async explore(args, opts) {
  return this._runExplorationLoop(structuredModeConfig);
}

async freeExplore(args, opts) {
  return this._runExplorationLoop(reportModeConfig);
}
```

이유는 간단합니다.
두 모드는 이미 다음을 공유합니다.

* repoRoot resolution
* project config loading
* session loading
* tool definitions
* tool loop
* progress reporting
* candidate path tracking
* observed range tracking
* elapsed/stats 계산

이걸 복제하면 향후 drift가 생깁니다.
따라서 “별도 메서드”는 맞지만, “별도 구현”은 위험합니다.

## 2.5.2 현재 순차 실행 → 병렬 도구 실행 전환 시 고려할 동시성 이슈

이 기획 문서는 병렬화를 약간 가볍게 보고 있습니다. 실제론 꽤 많은 이슈가 있습니다.

### 먼저 짚을 사실

현재 runtime은 모델 호출 시 이미 `parallelToolCalls: true`를 넘기고 있습니다.
즉, 모델은 한 턴에 여러 tool call을 낼 수 있는 상태입니다. 다만 실행 루프가 순차로 돌 뿐입니다.

이건 말하자면 **모델은 병렬 의도를 표현하고 있는데, 런타임이 직렬로 소화 중인 상태**입니다.

### 실제 고려해야 할 이슈

| 이슈                  | 설명                                                | 대응                                     |
| ------------------- | ------------------------------------------------- | -------------------------------------- |
| 동일 파일 중복 읽기         | 같은 턴에 같은 파일 여러 범위 읽기 요청 가능                        | in-flight dedupe, range merge          |
| 순서 안정성              | 병렬 완료 순서가 원래 요청 순서와 다를 수 있음                       | 결과는 원래 tool call 순서대로 messages에 append |
| 부분 실패               | 하나 실패했다고 전체 턴 실패하면 안 됨                            | `Promise.allSettled` 스타일               |
| sync subprocess 문제  | 일부 tool은 `execFileSync`라 Promise.all만으로 진짜 병렬 안 됨 | async subprocess로 전환 or bounded worker |
| cache stampede      | 같은 key를 여러 call이 동시에 조회                           | cache에 in-flight promise 저장            |
| rate/latency 폭주     | 턴당 너무 많은 읽기가 나가면 비용 증가                            | concurrency cap                        |
| error recovery 상호작용 | 실패한 call의 fallback을 다음 턴 힌트에 어떻게 넣을지              | 실패 이유를 구조화해 누적                         |

### 특히 중요한 한 가지

현재 git/grep 일부 구현은 sync subprocess입니다.
따라서 문서의 예시처럼 `Promise.all([...repoToolkit.callTool(...)])`만 쓰면 **코드가 병렬처럼 보여도 실제 성능 이점이 제한적일 수 있습니다.**

이건 Explorer Mode 기획에서 가장 과소평가된 기술 포인트 중 하나입니다.

### 추천

초기에는:

* **bounded concurrency (예: 3~4)**
* **append 순서 보존**
* **duplicate read dedupe**
* **allSettled**
* **진짜 병렬이 필요한 tool만 async 전환**

정도가 현실적입니다.

---

## 2.6 구현 Phase A/B/C 검토

| Phase | 작업 성격                                                  | 예상 난이도 | 위험도 | 평가               |
| ----- | ------------------------------------------------------ | -----: | --: | ---------------- |
| A     | 새 input schema, prompt, freeExplore, server 등록, 기본 테스트 |     중간 |  중간 | 현실적              |
| B     | 병렬화, fallback, session continuity, progress            |     높음 |  높음 | 실제 핵심 리팩터링       |
| C     | 자동 thoroughness, format, benchmark                     |     중간 |  중간 | polish지만 생각보다 넓음 |

## 2.6.1 Phase A 평가

좋습니다. 다만 “기본 테스트”는 단순 happy path로 끝나면 안 됩니다.

최소한 있어야 할 테스트:

* `explore` returns report text
* structuredContent에 sessionId/stats 포함
* invalid session 처리
* report-only 결과가 SessionStore에 어떤 영향을 주는지
* progress notification path

즉, Core라고 해도 session semantics는 Phase A에서 피해 갈 수 없습니다.

## 2.6.2 Phase B 평가

이 문서에서 가장 무거운 Phase입니다.

특히 7번 “병렬 도구 실행 — `freeExplore()`와 `explore()` 모두에 적용”은 사실상 다음을 의미합니다.

* `runtime.mjs`의 공용 툴 루프 리팩터링
* stats, observedRanges, candidatePaths 수집 로직 재검증
* ordering semantics 재검증
* 기존 `explore_repo` 회귀 테스트 재실행

즉, 이건 Explorer mode enhancement가 아니라 **core runtime refactor**입니다.

제 생각에는 이 작업은 Explorer Mode Phase B 안에 넣기보다, **독립 backlog 항목**으로 빼는 편이 더 맞습니다.

## 2.6.3 Phase C 평가

겉보기엔 polish지만, 각각 생각보다 가볍지 않습니다.

### thoroughness 자동 감지

이미 코드베이스에 task complexity classifier가 있는 만큼 재사용은 가능해 보입니다.
하지만 자동 상향 조정은 latency 예측 가능성을 해칩니다.

### format 옵션

나쁘지 않지만, 실제론 `markdown`만 있어도 초기엔 충분할 가능성이 큽니다.

### benchmark

필수입니다. 오히려 benchmark는 Phase C가 아니라 더 앞에 와야 할 수도 있습니다.
새 public tool인데 회귀 기준 없이 넣는 것은 좋지 않습니다.

### 총평

* Phase A: 타당
* Phase B: 실제로 제일 위험
* Phase C: polish 같지만 평가 체계까지 묶이면 중요

---

## 2.7 `explore` vs `explore_repo` 공존 전략 평가

### 혼용 시 발생할 수 있는 혼란

가장 큰 혼란은 “둘 다 비슷하게 들린다”는 점입니다.

* `explore_repo`
* `explore`

사람에게도 비슷하고, 모델에게도 비슷합니다.
게다가 MCP 클라이언트는 여러 서버의 도구를 한 registry에 합쳐 모델에게 노출합니다. tool의 name/title/description/inputSchema는 실제 선택 품질에 직접 영향을 줍니다. ([모델 컨텍스트 프로토콜][1])

이 맥락에서 `explore`는 너무 일반적인 이름일 수 있습니다.
다른 서버에도 흔히 있을 법한 이름이기 때문입니다. MCP spec도 tool name uniqueness는 서버 내부 범위일 뿐이고, 여러 서버를 합치면 충돌 가능성이 있다고 설명합니다. ([모델 컨텍스트 프로토콜][2])

### 권장 가이드라인

#### `explore_repo` 설명에는 반드시 넣어야 할 문구

* structured JSON output
* evidence/confidence/followups returned
* use for programmatic chaining and automation

#### `explore` 설명에는 반드시 넣어야 할 문구

* human-readable report
* not intended for strict programmatic parsing
* confidence/evidence are narrative unless otherwise noted
* best for audits, reviews, and broad investigations

### 이름 자체도 고민해볼 만함

솔직히 말하면, `explore`보다는 아래가 더 명확합니다.

* `explore_report`
* `freeform_explore`
* `analyze_repo_report`

지금 이름이 절대 틀린 건 아니지만, MCP 다중 서버 환경에서는 generic name이 손해일 수 있습니다.

### 가장 좋은 공존 전략

* 기본 general-purpose structured tool은 여전히 `explore_repo`
* `explore`는 사람이 읽는 리포트가 필요한 경우에만 선택
* specialized tools(`explain_symbol`, `trace_dependency`, `summarize_changes`, `find_similar_code`)도 계속 별도 존재

즉, 선택 우선순위를 문서/description에 아주 명시적으로 써줘야 합니다.

예:

1. narrow task면 specialized tool
2. automation이면 `explore_repo`
3. human report면 `explore`

---

## 2.8 제안자가 예상하지 못했을 리스크 및 개선 포인트

이 문서의 가장 큰 맹점은 **새 도구의 출력 형식보다, 그 출력이 기존 세션/평가/공용 runtime에 어떻게 녹아드는지**를 덜 보고 있다는 점입니다.

### 맹점 1) SessionStore와 결과 shape 불일치

이미 설명했듯 현재 SessionStore는 `summary/evidence/followups/candidatePaths` 기반입니다.
`report` 하나만 반환하면 기존 세션 기억이 제대로 작동하지 않습니다.

### 맹점 2) `filesExamined` 정의 부정확

현재 제안 방식이면 실제론 `filesRead`에 가깝습니다. 이건 작은 naming issue가 아니라 **사용자 신뢰 문제**입니다.

### 맹점 3) 병렬화가 생각보다 공용 리팩터링

explore mode enhancement처럼 써 있지만 실제론 `explore_repo`에 큰 영향을 줍니다.

### 맹점 4) report mode의 provenance 약화

`explore_repo`가 가진 구조화 evidence discipline을 잃는 대가를 충분히 다루지 않았습니다.

### 맹점 5) 평가 체계 부재

자유형 리포트는 예쁜 예시 하나 만들기는 쉽지만, regression benchmark가 훨씬 어렵습니다.

### 개선 포인트

제가 제안하는 개선은 다음 다섯 가지입니다.

1. `freeExplore()`를 만들되 내부 공용 루프는 분리 추출
2. `outputSchema`와 `structuredContent.report`를 함께 설계
3. session memory packet을 mode-agnostic하게 재설계
4. `explore` report에도 최소 provenance discipline 유지
5. 병렬화는 Explorer Mode와 분리된 공용 runtime 프로젝트로 별도 추적

### 총평

이 기획은 **제품적으로 매력적이고 방향도 좋다**는 점에서 높은 점수를 줄 수 있습니다.
하지만 구현 난이도는 문서가 암시하는 것보다 분명히 높습니다.
특히 **Phase A는 쉬워 보이지만, Phase B가 사실상 핵심 난관**입니다.

---

# 3. `git-history-confidence.md` — Git Confidence 저하 문제 분석

## 3.1 문제 현상 해설

이 문서는 세 계획 중에서 **문제 진단 정확도**가 가장 높습니다. 실제 코드와 거의 정확히 맞물립니다.

### 비전공자도 이해할 수 있게 설명하면

현재 시스템은 “무엇을 실제로 읽었는가”를 기준으로 답변의 confidence를 깎거나 올립니다.
그런데 이 “읽음”의 기준이 거의 파일 라인 범위 중심입니다.

문제는 git 질문에서는 근거가 꼭 파일 라인 범위가 아니라는 점입니다.

예:

* 어떤 커밋이 언제 들어왔는지
* 누가 이 줄을 마지막으로 바꿨는지
* 어떤 diff hunk가 버그 원인이었는지

이런 건 git log / blame / diff / show가 근거인데, 현재 평가지표는 그 근거를 잘 받아주지 못합니다.

비유하면 이렇습니다.

> **탐정은 분명히 CCTV와 통화기록을 확인했는데, 판사는 “종이 문서 몇 쪽 읽었는지만 증거로 인정한다”고 하는 상황**입니다.

그래서 모델이 git 도구를 써서 꽤 괜찮은 답을 해도, 시스템은 “파일 라인 evidence가 부족하네?”라고 보고 confidence를 낮춰 버립니다.

### 사용자 경험에 미치는 실질적 영향

이건 꽤 큽니다.

* history 질문에서 자꾸 `low`가 뜨면, 사용자는 “이 도구는 git 쪽은 약한가 보다”라고 느낍니다.
* 상위 에이전트는 low confidence를 보고 불필요하게 추가 탐색을 시도할 수 있습니다.
* 실제로 맞는 답인데도 “신뢰도 낮음” 딱지가 붙으면, 도구 전체의 credibility가 떨어집니다.

즉, 이 문제는 단순 scoring bug가 아니라 **프로젝트의 핵심 가치인 ‘grounded structured answer’에 금이 가는 문제**입니다.

---

## 3.2 5가지 Root Cause 각각의 심층 분석

## 3.2.1 Observed range 수집이 file-read 중심

### 왜 이런 설계가 처음에 선택됐는가

이 설계는 사실 매우 자연스러운 출발이었습니다.

* `repo_read_file`은 line range가 명확함
* `repo_grep`도 match line이 명확함
* file path + line range는 grounding하기 쉬움
* hallucination 방지 효과가 큼

즉, MVP 단계에서 “읽은 파일 범위만 믿는다”는 정책은 좋은 선택이었습니다.

### 한계는 무엇인가

문제는 git 정보는 본질적으로 다른 shape를 가진다는 점입니다.

* `git log`는 commit timeline
* `git blame`은 line + author + commit
* `git diff`는 old/new hunk
* `git show`는 commit patch + message

이들은 “file line range”로 일부는 환원될 수 있지만, 일부는 환원되면 의미가 손실됩니다.

현재 런타임은 실제로 `observedRanges`를 아래 경우에만 기록합니다.

* `repo_read_file`
* `repo_grep`

그래서 파이프라인은 사실상 이렇게 됩니다.

```text
git tool 사용
   ↓
유용한 사실 확보
   ↓
observedRanges에는 안 남음
   ↓
final evidence가 file-range와 안 맞음
   ↓
drop
   ↓
confidence low
```

즉, 설계의 출발은 합리적이었지만, 기능 범위가 git으로 넓어진 뒤 verifier가 따라오지 못한 전형적인 사례입니다.

---

## 3.2.2 Evidence schema의 표현력 부족

현재 evidence schema는 사실상 이것뿐입니다.

```json
{
  "path": "relative/path",
  "startLine": 1,
  "endLine": 10,
  "why": "reason"
}
```

이건 file-range evidence에는 아주 좋습니다.
하지만 git evidence에는 부족합니다.

### 왜 새 kind가 필요한가

#### `git_commit`

“이 변경은 commit `abc1234`에서 들어왔다”는 게 핵심 근거인 경우가 있습니다.
이건 path/line으로 줄이면 commit identity가 사라집니다.

#### `git_diff_hunk`

버그 원인이 특정 hunk일 수 있습니다.
그런데 diff는 old/new line range를 함께 가질 수 있고, path rename도 있을 수 있습니다.

#### `git_blame_line`

“이 줄은 누가 언제 바꿨는가”는 blame 고유 근거입니다.
author/commit/line 정보가 같이 있어야 합니다.

### schema 레벨에서 시각적으로 보면

#### 현재

```json
evidence[] = {
  path, startLine, endLine, why
}
```

#### 필요한 방향

```json
evidence[] = one of:
- { kind: "file_range", path, startLine, endLine, why }
- { kind: "git_commit", commit, path?, why }
- { kind: "git_diff_hunk", oldPath?, newPath?, oldStartLine?, newStartLine?, commit?, why }
- { kind: "git_blame_line", path, line, commit, author?, why }
```

### 문서의 proposed schema에 대한 보완 의견

문서 안의 초안:

```json
{
  "kind": "file_range | git_commit | git_diff_hunk | git_blame_line",
  "path": "...",
  "startLine": 10,
  "endLine": 18,
  "commit": "abc1234",
  "author": "...",
  "why": "..."
}
```

이건 첫걸음으로는 좋습니다.
하지만 특히 `git_diff_hunk`에는 약간 부족합니다.

왜냐하면 diff hunk는 보통:

* old path / new path
* old range / new range
* sometimes rename only
* deletion or addition only

을 가질 수 있기 때문입니다.

즉, `startLine/endLine` 하나만 두면 **이 range가 old file 기준인지 new file 기준인지 모호**합니다.
그래서 `git_diff_hunk`는 최소한 old/new 쌍을 고려해야 합니다.

---

## 3.2.3 Confidence penalty 미분화

현재 구조의 핵심 문제는 이것입니다.

> **지원되지 않는 근거(unsupported evidence)** 와
> **실제로 부정확하거나 날조된 근거(ungrounded/fabricated evidence)** 를
> 거의 같은 방향으로 처벌한다.

현재 `computeConfidenceScore()`는 대략:

* evidenceDropped > 0 이면 -0.30
* grounded evidence 0이면 score=0.1
* dropped가 있으면 최종 confidence를 low로 강등

이 구조입니다.

### 억울하게 처벌받는 케이스

#### 케이스 1) `repo_git_log` 중심 질문

질문: “최근 어떤 변화가 있었나?”
모델은 `git log`를 보고 요약을 잘함.
하지만 file-range evidence가 없으면 grounded evidence가 빈약해 보입니다.

이건 “답이 나쁨”이 아니라 **현재 schema가 그 근거를 잘 못 담음**에 가깝습니다.

#### 케이스 2) `repo_git_show` patch 기반 질문

모델이 patch를 충분히 읽고 “이 함수의 인증 조건이 여기서 추가되었다”고 답했는데, 추가로 `repo_read_file`를 하지 않았다는 이유로 evidence가 drop될 수 있습니다.

#### 케이스 3) `repo_git_blame` 기반 질문

누가 바꿨는지는 blame이 가장 직접 근거인데, 평가 기준이 file read 중심이면 오히려 blame answer가 손해 봅니다.

### false positive 패널티 문제

현재 `evidenceDropped` 하나로만 보면 시스템은 이런 판단을 못 합니다.

* “지원되지 않는 좋은 evidence”
* “형식이 틀린 evidence”
* “실제로 읽지 않은 파일을 인용한 evidence”

이 셋은 성격이 완전히 다릅니다.
하지만 지금은 모두 “drop”입니다.

이건 scoring system으로서 설명 가능성이 떨어집니다.

---

## 3.2.4 Prompt-runtime 계약 불일치

이건 문서가 정확히 짚었습니다.

프롬프트는:

* git-guided 써라
* blame-guided 써라
* git tools 활용해라

라고 합니다.

그런데 finalize prompt는:

* inspected 된 file/line range에 grounding하라

고 합니다.

즉, 모델에게는 “git로 찾아라”라고 해 놓고, 채점기는 “결국 file line range로 가져와야 인정”하는 구조입니다.

### 이런 불일치는 왜 생기는가

이건 굉장히 흔한 성장통입니다.

1. 처음엔 file-based explorer로 출발
2. 이후 git tool 추가
3. prompt는 빨리 확장
4. verifier/schema/confidence는 늦게 확장
5. 기능은 늘었는데 채점 기준은 옛날 것

즉, 기능 레이어와 검증 레이어의 진화 속도가 어긋난 결과입니다.

### 추가로 한 가지 더

현재 최종 confidence 병합 로직은 runtime이 계산한 confidence가 더 낮을 때만 모델 confidence를 낮춥니다.
반대로 모델이 `low`라고 썼는데 runtime score가 `medium`이어도 **상향하지 않습니다**.

이 말은 곧, git 질문에서 모델이 prompt의 압박 때문에 스스로 low를 내면, runtime scoring을 고쳐도 `confidence`가 low로 남을 수 있다는 뜻입니다.

즉, 이 문제는 scoring만의 문제가 아니라 **prompt contract 정리 없이는 완전히 해소되지 않습니다.**

---

## 3.2.5 테스트 공백

문서 진단이 맞습니다. 현재 테스트는 주로:

* recentActivity가 생기는지
* crash 없이 끝나는지

를 봅니다.

하지만 핵심 버그를 잡으려면 필요한 테스트는 다른 종류입니다.

### 처음부터 이 버그를 잡을 수 있었던 테스트

#### 1) git-guided end-to-end mock test

* 모델이 `repo_git_log` 호출
* commit 기반 answer/evidence 생성
* 결과가 구조적으로 `low`에 고정되지 않는지 확인

#### 2) blame retention test

* `repo_git_blame`를 쓴 뒤 line-level evidence가 유지되는지

#### 3) diff hunk grounding test

* `repo_git_diff` 또는 `repo_git_show` patch를 읽고
* 해당 hunk 근거가 retained 되는지

#### 4) mixed evidence test

* file-range + git evidence가 섞인 경우
* 둘 다 적절히 점수에 반영되는지

#### 5) legacy regression test

* 순수 file-range 질문의 confidence 동작은 그대로인지

현재 테스트 공백은 단순히 “케이스가 부족하다”가 아니라,
**confidence architecture가 어떤 종류의 근거를 인정해야 하는지에 대한 테스트가 없었다**는 뜻입니다.

---

## 3.3 5개 Phase 구현 계획 평가

## 3.3.1 Phase 1 — fast-path stabilization

### 가치

높습니다.
특히 false-low를 빨리 줄인다는 점에서 사용자 체감 개선이 큽니다.

### 좋은 점

* schema 대수술 없이 완화 가능
* blame/diff/show 계열의 부당한 low를 먼저 줄일 수 있음
* “지원 못하는 evidence”와 “hallucination”을 덜 혼동하게 만들 수 있음

### 하지만 임시 방편으로 남을 위험

아주 큽니다.

왜냐하면 fast-path는 결국 file-range 중심 체계를 유지한 채 git를 억지로 끼워 맞추는 방식이기 때문입니다.

예:

* diff hunk를 억지로 line range로 환원
* git log는 별도 hint로만 보정
* commit-level semantics는 여전히 비주류

이러면 당장은 좋아져도, 나중에 “굳이 schema 확장까지 해야 하나?” 분위기가 생겨 임시 방편이 굳어질 수 있습니다.

### 추가 비판

문서가 Phase 1을 꽤 가볍게 보지만, 실제로는 `repo_git_diff`/`repo_git_show`에서 hunk line parsing을 하려면 현재 `parseDiffOutput()` 수준보다 훨씬 정교한 파서가 필요합니다. 지금 구현은 파일별 additions/deletions 카운트와 patch 텍스트 정도만 다룹니다. 즉, Phase 1조차도 생각보다 작은 작업은 아닙니다.

---

## 3.3.2 Phase 2 — evidence schema 확장

### `kind` 필드 도입의 장점

* 개념적으로 가장 정직합니다.
* git evidence를 first-class citizen으로 대우하게 됩니다.
* prompt/runtime/scoring을 한 언어로 정리할 수 있습니다.

### 하위 호환성 위험

문서도 언급하지만, 생각보다 넓습니다.

외부 consumer뿐 아니라 내부 코드도 영향을 받습니다.

예:

* `normalizeExploreResult()`는 현재 legacy shape만 남기고 나머지를 버림
* `SessionStore.update()`는 `evidence[].path`를 모아 evidencePaths를 만듦
* benchmark evaluator는 `evidence_paths` 중심
* README/examples/tests가 다 file-range를 전제

즉, 이건 schema 한 줄 추가가 아니라 **내부 consumer migration**입니다.

### 마이그레이션 전략 제안

#### 전략 A: 단일 `evidence[]` + `kind`

가장 개념적으로 깔끔합니다.
하지만 strict schema와 conditional field 조합이 복잡해질 수 있습니다.

#### 전략 B: legacy `evidence[]` 유지 + `gitEvidence[]` 추가

더 안전하지만, 의미가 두 배열로 갈라집니다.

### 제 판단

장기적으로는 `kind` 기반 단일 배열이 맞습니다.
다만 초기 migration은 아래처럼 가는 게 현실적입니다.

1. legacy shape 유지
2. `kind` optional 추가
3. git kind에 필요한 필드를 점진 추가
4. internal consumer를 순차적으로 kind-aware하게 변경
5. 문서와 benchmark evaluator를 함께 업데이트

### 한 가지 더

strict structured output JSON schema를 계속 쓸 거라면, `oneOf` 같은 복잡한 schema는 provider/model compliance를 해칠 수 있습니다. 그래서 초기엔 완전한 이상형보다 **조금 느슨한 additive schema + runtime validation**이 더 실용적일 수 있습니다.

---

## 3.3.3 Phase 3 — confidence scoring 분리

문서 방향은 좋습니다.
`droppedUnsupported / droppedUngrounded / droppedMalformed`는 아주 좋은 출발입니다.

### 설계 완성도 평가

상당히 좋지만, 여기에 몇 가지를 더 생각해볼 수 있습니다.

#### 추가 고려할 분류

* `droppedOutOfScope`: scope 밖 파일이라 버림
* `droppedRepoMismatch`: session 오염 등으로 다른 repo path가 들어옴
* `retainedPartial`: 부분 grounding
* `supportedByGitMetadata`: git evidence로는 인정되지만 file-range는 아님

### 패널티 차등의 예시

* unsupported type: 0 또는 아주 약한 패널티
* malformed: 강한 패널티
* ungrounded: 중간~강한 패널티
* fabricated-looking external path: 매우 강한 패널티

이렇게 나뉘면 결과 설명력이 훨씬 좋아집니다.

### 중요한 추가 포인트

confidence는 단순 숫자만이 아니라, **사용자에게 “왜 낮은가”를 말할 수 있어야** 합니다.
이 문서의 방향은 그 점에서 맞습니다.

---

## 3.3.4 Phase 4 — prompt contract 정리

### 실현 가능성

높습니다. 하지만 **Phase 2와 강하게 연결**됩니다.

모델이 git result를 근거로 써도 된다는 걸 알려주려면:

* schema가 그걸 표현할 수 있어야 하고
* runtime이 그걸 grounding할 수 있어야 하며
* scoring이 그걸 낮게 보지 않아야 합니다

즉, prompt만 먼저 바꿔 봐야 효과가 제한적입니다.

### 추천 프롬프트 전략

* history 질문에서는 commit/hash/hunk/blame을 정당한 evidence로 인정
* 단, 가능하면 file read로 보강하라고 지시
* “git result만으로 답한 경우”와 “file read까지 보강한 경우”를 구분해 쓰게 함

예:

```text
For history questions, git commits, diff hunks, and blame lines are valid evidence.
If the answer depends on current code semantics, supplement git evidence with file reads.
```

이 정도면 runtime 계약과 잘 맞출 수 있습니다.

---

## 3.3.5 Phase 5 — 테스트 및 벤치마크

### 제안된 테스트의 충분성

좋은 출발입니다. 하지만 아직 조금 더 필요합니다.

추가로 필요한 것:

* mixed evidence regression
* legacy file-only confidence regression
* malformed git evidence penalty test
* unsupported kind graceful handling
* benchmark evaluator가 git evidence kind를 해석하는지

### benchmark 관점

현재 `benchmarks/core.json`은 confidence pipeline을 보긴 하지만, git-guided false-low를 직접 재현하는 케이스가 없습니다.
이건 꼭 추가돼야 합니다.

예:

* `summarize_changes` 시나리오
* blame-guided root cause 시나리오
* log-only history summary 시나리오

### 총평

Phase 5는 “마지막에 붙이는 품질 개선”이 아니라, 이 문서 전체의 성공 여부를 결정하는 핵심입니다.

---

## 3.4 구현 순서 재평가

문서 제안 순서:

1. Phase 1
2. Phase 5
3. Phase 2
4. Phase 3
5. Phase 4
6. benchmark

이 순서는 **대체로 합리적**입니다.
특히 “false low를 먼저 줄이고, 그 다음 테스트를 깐다”는 의도는 이해됩니다.

### 하지만 제가 더 선호하는 순서

저는 다음이 더 낫다고 봅니다.

1. **최소 failing regression test 하나 먼저 작성**
2. Phase 1 fast-path stabilization
3. 테스트 확대(Phase 5의 일부)
4. Phase 2 schema 확장
5. internal consumer migration
6. Phase 4 prompt contract 정리
7. Phase 3 scoring calibration
8. benchmark 보강

### 왜 이렇게 보나

* 테스트를 완전히 Phase 1 뒤로 미루면, “무엇이 버그였는지”를 정확히 고정하지 못할 수 있습니다.
* prompt contract는 scoring과 분리돼 있지 않습니다. 실제 모델 출력이 달라져야 scoring calibration도 안정됩니다.
* benchmark는 맨 끝 full sweep으로 두되, 최소 1개 케이스는 중간부터 넣는 게 좋습니다.

### 결론

문서 순서는 **크게 틀리진 않지만**, 실제 구현에서는 테스트를 더 앞당기고, prompt contract를 scoring calibration보다 약간 앞에 두는 편이 더 안정적입니다.

---

## 3.5 Risks 섹션 보충

문서에 적힌 세 가지 리스크는 타당합니다. 여기에 몇 가지를 더 추가하겠습니다.

## 추가 리스크 1) diff hunk schema 자체가 모호할 수 있음

앞서 말했듯 old/new range 구분이 없으면 `git_diff_hunk`가 충분히 표현되지 않습니다.

## 추가 리스크 2) 내부 consumer migration 누락

외부 클라이언트보다 오히려 내부 코드가 먼저 깨질 수 있습니다.

* session evidencePaths 누적
* benchmark evaluator
* docs/example/tests

## 추가 리스크 3) `repo_git_log` 과대평가 위험

반대로 scoring을 너무 느슨하게 하면, “git tool 썼다”는 이유만으로 confidence가 올라가 버릴 수 있습니다.
즉, **git 사용 여부**와 **git evidence 품질**를 구분해야 합니다.

## 추가 리스크 4) 모델 self-confidence가 계속 low일 수 있음

앞서 말한 one-way merge 때문에 prompt contract 정리가 늦으면 runtime만 고쳐도 `confidence` low가 남을 수 있습니다.

## 특히 diff hunk line parsing edge case 구체 열거

이건 문서보다 더 구체적으로 적어 두는 게 좋습니다.

* rename-only diff
* copy diff
* file deletion (`/dev/null`)
* new file addition
* mode-only change (`chmod`)
* binary patch / `Binary files differ`
* merge commit combined diff (`diff --cc`, `@@@`)
* submodule diff
* quoted path / space / unicode path
* `\ No newline at end of file`
* very large patch truncation
* abbreviated commit hash ambiguity
* old/new path가 다른 rename + hunk 혼합

이 중 몇 개는 “지원 안 함”으로 명시해도 괜찮습니다.
중요한 건 **의도적으로 지원 범위를 적는 것**입니다.

---

## 3.6 Success Criteria 평가

문서의 success criteria는 방향은 좋지만, 몇 개는 더 측정 가능하게 바꾸면 좋겠습니다.

### 현재 기준 평가

#### “git-guided / blame-guided 질문이 구조적 이유만으로 low에 고정되지 않는다”

좋은 목표입니다.
하지만 자동화하려면 더 명시적이어야 합니다.

예:

* curated git scenarios N개에서
* 충분한 git evidence가 있을 때
* `confidenceLevel !== low`
* 그리고 `droppedUnsupported`가 설명 가능하게 기록

#### “git evidence가 drop되는 이유가 결과에 설명 가능하게 나타난다”

좋습니다.
이건 `confidenceFactors`나 결과 metadata에 reason code를 넣으면 측정 가능합니다.

#### “새로운 테스트가 현재 버그를 재현하고, 수정 후 통과한다”

아주 좋습니다. 반드시 있어야 합니다.

#### “기존 file-range 중심 탐색의 confidence 동작은 유지된다”

매우 중요합니다.
이 항목이 없으면 git 개선이 전체 scoring 체계를 무너뜨릴 수 있습니다.

### 자동화된 검증 방식 제안

제가 추천하는 자동화 기준은 아래와 같습니다.

| 검증 항목                       | 방식                                              |
| --------------------------- | ----------------------------------------------- |
| false-low rate              | git fixture 질문 세트에서 `confidenceLevel=low` 비율 측정 |
| retained git evidence count | kind별 retained 수 집계                             |
| drop reason explainability  | `confidenceFactors`에 reason code 존재 확인          |
| legacy no-regression        | 기존 confidence benchmark 유지                      |
| mixed evidence robustness   | file+git 혼합 케이스에서 expected level 확인             |

특히 첫 번째 목표는 이렇게 구체화할 수 있습니다.

> “지원되는 git evidence만 사용한 fixture 질문 세트에서, budget stop이 아니고 malformed evidence가 없는 경우 `confidenceLevel`이 구조적 이유만으로 `low`가 되지 않는다.”

이 정도면 훨씬 자동화 친화적입니다.

---

# 4. 세 계획 문서를 아우르는 종합 평가

## 4.1 계획들 간의 상호 의존성

세 문서는 서로 독립적이면서도, 실제 코드 레벨에서는 꽤 많이 겹칩니다.

### 충돌 가능한 코드 영역

| 파일                            | roadmap 관련                | explorer-mode 관련           | git-confidence 관련                          | 충돌도   |
| ----------------------------- | ------------------------- | -------------------------- | ------------------------------------------ | ----- |
| `src/explorer/runtime.mjs`    | session semantics         | freeExplore, parallel loop | observed git evidence, confidence pipeline | 매우 높음 |
| `src/explorer/prompt.mjs`     | docs/contract 일부          | explore prompt             | git evidence contract                      | 높음    |
| `src/explorer/schemas.mjs`    | contract 정리               | explore input schema       | evidence schema 확장                         | 높음    |
| `src/explorer/repo-tools.mjs` | `depth` 정합성               | 병렬화 영향 간접                  | diff/blame parsing                         | 높음    |
| `src/explorer/session.mjs`    | exhaustion                | session continuity         | 간접 영향                                      | 중간    |
| `src/mcp/server.mjs`          | public docs/tool exposure | `explore` tool 등록          | 간접                                         | 중간    |
| `README.md` / `DESIGN.md`     | docs polish               | 새 tool 문서                  | git confidence schema 설명                   | 높음    |

### `explorer-mode.md`와 `git-history-confidence.md`가 동시에 진행될 경우

가장 위험한 충돌은 `runtime.mjs`입니다.

* Explorer Mode는 tool loop, result extraction, session integration을 건드립니다.
* Git confidence는 observedRanges, evidence grounding, confidence scoring을 건드립니다.

둘 다 “탐색 루프의 중앙”을 만집니다.
따라서 동시에 다른 브랜치에서 작업하면 merge conflict뿐 아니라 **논리 충돌**도 큽니다.

예:

* 병렬 tool execution 리팩터링 중
* git evidence capture 훅을 어디에 꽂을지 바뀜
* result ordering semantics가 달라지면 grounding logic도 재검증 필요

### roadmap backlog 항목 중 연결되는 것들

* **Explorer Mode** ↔ `explorer-mode.md` 직접 대응
* **Public docs polish** ↔ 두 기획 문서의 최종 릴리즈 전제
* **Session exhaustion enforcement** ↔ Explorer Mode session continuity와 연결
* **`repo_symbol_context.depth`** ↔ Explorer Mode 자유형 탐색 품질에도 간접 영향
* **config cleanup (`entryPoints`)** ↔ Explorer Mode architecture report 품질 향상 가능

즉, 세 문서는 따로 써도 실제 작업 순서상으론 꽤 얽혀 있습니다.

---

## 4.2 프로젝트 전체 아키텍처 관점에서의 평가

## 장점

### 1) 고수준 wrapper 전략이 명확하다

이 프로젝트의 핵심 차별점은 low-level repo tools를 상위 모델에게 그대로 노출하는 대신, 내부에 별도 explorer agent를 두고 `explore_repo` 같은 고수준 도구로 감싼다는 점입니다.
이건 비용 절감과 turn 절감 측면에서 분명한 장점입니다.

### 2) read-only 경계가 강하다

MCP는 tool safety와 사용자 통제를 강조하는데, read-only 경계를 강하게 가져가는 것은 이 생태계에서 신뢰를 쌓기 좋은 방향입니다. 공식 문서도 tool invocation과 데이터 접근에 대해 명시적 사용자 통제와 주의가 필요하다고 강조합니다. ([모델 컨텍스트 프로토콜][3])

### 3) zero dependencies는 배포와 유지보수에 유리하다

설치가 단순하고, 라이브러리 drift에 덜 흔들립니다.

### 4) 테스트와 benchmark 문화가 이미 있다

이건 매우 좋습니다. 모든 오픈소스가 이 정도 기반을 갖고 있지는 않습니다.

## 한계

### 1) regex 기반 심볼 분석의 천장

현재 아키텍처는 빠르고 가볍지만, 깊은 semantic graph에는 한계가 있습니다.
`depth > 1` 문제도 결국 여기서 옵니다.

### 2) sync subprocess 기반 도구 실행

git/grep 일부가 sync라서, “병렬 실행”의 이득이 생각보다 작고 event loop blocking 리스크가 있습니다.

### 3) prompt와 runtime contract 결합도 높음

기능을 하나 추가할 때:

* prompt
* schema
* runtime
* scoring
* tests
* docs

가 같이 움직여야 합니다.
이건 품질을 높이는 구조이기도 하지만, 변화 비용이 큽니다.

### 4) session store가 아직 mode-agnostic하지 않음

structured mode에는 맞지만, future explore mode까지 포괄하려면 일반화가 필요합니다.

## 장기 유지 가능성 평가

현재 설계는 **소~중규모 프로젝트에는 충분히 유지 가능**합니다.
다만 규모가 커지면 아래 병목이 생길 가능성이 높습니다.

| 규모 증가 축          | 예상 병목                                          |
| ---------------- | ---------------------------------------------- |
| 더 큰 repo         | grep/read/git latency                          |
| 더 많은 동시 클라이언트    | single-process shared cache/session contention |
| 더 많은 모델/provider | provider abstraction 관리 복잡도                    |
| 더 많은 tool mode   | prompt/runtime/schema drift                    |
| 더 다양한 언어         | regex symbol precision 한계                      |

즉, 지금 설계는 “날렵한 1세대 설계”로는 좋지만, 성공해서 사용량이 늘면 **인덱싱/비동기화/세션 추상화** 쪽 투자가 필요해질 가능성이 큽니다.

---

## 4.3 이 프로젝트가 MCP 생태계에서 가지는 차별점과 한계

MCP 아키텍처에서는 호스트가 여러 MCP 서버에 연결하고, 도구들을 discovery해서 하나의 registry처럼 모델에 노출합니다. 이 프로젝트는 그 위에서 low-level filesystem/git tool 묶음을 그대로 내놓기보다, 내부 자율 탐색 루프를 감싼 “고수준 탐색 도구”를 제공한다는 점이 분명한 차별점입니다. 즉, MCP의 tool primitive 위에 또 하나의 작은 specialist agent를 올린 형태라고 볼 수 있습니다. ([모델 컨텍스트 프로토콜][1])

### 차별점

* parent model의 turn 소모를 줄임
* repo-specific 탐색 전략을 서버 내부에 캡슐화
* evidence/confidence/followups 같은 구조화 산출물을 제공
* read-only grounded explorer라는 포지셔닝이 명확

### 한계

* 내부 sub-agent가 opaque해져서 디버깅이 더 어려울 수 있음
* high-level tool이 실패하면 parent model이 세밀하게 개입하기 어려움
* schema evolution 비용이 큼
* low-level precise control이 필요한 사용자는 답답할 수 있음

즉, 이 프로젝트는 “MCP tool server”이면서 동시에 “MCP 안의 mini-agent”입니다.
그게 장점이자 한계입니다.

---

## 4.4 전체적으로 가장 시급히 해결해야 할 것과 그 이유

하나만 꼽으라면 저는 **git confidence false-low 문제**를 먼저 꼽겠습니다.

### 이유

이 프로젝트의 핵심 약속은 단순 요약이 아니라 **grounded exploration with trust signals**입니다.
그런데 git/history 질문이라는 꽤 중요한 카테고리에서, 구조적 이유만으로 confidence가 낮아지는 건 그 약속 자체를 흔듭니다.

사용자 입장에서는:

* 답이 맞아 보여도 low confidence
* 그러면 도구를 덜 믿게 됨
* 특히 “최근 변경”, “누가 바꿨나”, “왜 바뀌었나”는 실제 현업에서 자주 묻는 질문

즉, 이건 눈에 보이는 신뢰 저하입니다.

### 다만 같은 sprint에서 꼭 같이 처리했으면 하는 것

**Session exhaustion enforcement + repoRoot validation** 입니다.
이건 난이도 대비 효과가 큰 correctness bug라서, git confidence보다 구현은 쉽고 위험도는 낮습니다.

### 최종 우선순위 제안

1. **Session validity/exhaustion/repoRoot semantics 정리**
2. **git confidence false-low 완화 + 회귀 테스트**
3. **`repo_symbol_context.depth` 계약 정리**
4. **Explorer Mode는 Phase A만 신중히 도입**
5. **config/doc polish**

---

# 최종 총평

세 문서를 통틀어 보면, 제안자는 프로젝트를 꽤 잘 이해하고 있습니다.
특히 `git-history-confidence.md`는 실제 코드의 병목을 정확히 짚고 있고, `explorer-mode.md`도 제품 방향성 자체는 설득력이 있습니다.

하지만 세 문서에 공통으로 보이는 패턴이 하나 있습니다.

> **“새 capability를 추가하는 감각”은 좋지만, 그것이 기존 contract·session semantics·confidence verifier와 어떻게 맞물리는지에 대한 보수성이 조금 부족합니다.**

이 프로젝트는 일반적인 오픈소스보다 **정직한 계약**이 더 중요합니다.
왜냐하면 이 도구를 읽고 사용하는 쪽이 사람뿐 아니라 다른 LLM/agent이기 때문입니다.

그래서 제가 내리는 최종 평가는 이렇습니다.

* **좋은 점**: 문제 인식 정확, 구현 파일 타깃 적절, 확장 방향 명확
* **아쉬운 점**: contract drift와 shared runtime blast radius를 다소 가볍게 봄
* **가장 중요한 다음 단계**: 새 기능보다 먼저, 이미 약속한 것들을 더 정직하게 만들 것

원하시면 제가 이 분석을 바탕으로 바로 이어서
**“실행 우선순위가 반영된 실제 작업 계획표(1주/2주/Phase별)”** 형태로 다시 정리해드릴 수 있습니다.

[1]: https://modelcontextprotocol.io/docs/learn/architecture "https://modelcontextprotocol.io/docs/learn/architecture"
[2]: https://modelcontextprotocol.io/specification/draft/server/tools "https://modelcontextprotocol.io/specification/draft/server/tools"
[3]: https://modelcontextprotocol.io/specification/2025-11-25 "https://modelcontextprotocol.io/specification/2025-11-25"
