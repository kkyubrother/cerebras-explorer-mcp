# Phase 4: 멀티 모델 & 확장성 (Scalability) — 구현 메모 (2026-04-08)

> 이 문서는 코드베이스에 존재하는 확장성 관련 구현 메모다.
> 문서화된 제품 목표와 공개 계약은 Cerebras 기반 explorer이며, provider abstraction은 현재 내부 구현으로만 취급한다.
> 4.1, 4.2, 4.3 구현 상태는 아래에 정리한다.

## 4.1 모델 라우팅 — P3

**목표:** 질문 복잡도에 따라 최적 모델 자동 선택

### 라우팅 규칙

```
질문 분류기 (경량, rule-based):
├── 단순 위치 질문 ("X는 어디?")       → 가장 빠른/저렴한 모델
├── 분석 질문 ("X의 아키텍처는?")       → 중간 모델 (현재 zai-glm-4.7)
└── 복잡한 추론 ("이 버그의 원인은?")   → 고성능 모델 (reasoning 활성화)
```

### 환경변수 설정

```bash
# budget별 모델 지정
CEREBRAS_EXPLORER_MODEL_QUICK="zai-glm-4.7"
CEREBRAS_EXPLORER_MODEL_NORMAL="zai-glm-4.7"
CEREBRAS_EXPLORER_MODEL_DEEP="zai-glm-4.7-reasoning"

# 또는 자동 분류 사용
CEREBRAS_EXPLORER_AUTO_ROUTE=true
```

### 자동 분류 키워드

| 복잡도 | 키워드 | 모델 |
|--------|--------|------|
| simple | "어디", "찾아", "위치", "정의" | quick 모델 |
| moderate | "구조", "아키텍처", "패턴", "설명" | normal 모델 |
| complex | "원인", "왜", "버그", "보안", "성능" | deep 모델 |

### ✅ 구현 결과 (4.1)

- **`getModelForBudget(budget)`** (`config.mjs`): `CEREBRAS_EXPLORER_MODEL_QUICK/NORMAL/DEEP` 환경변수 조회 → 없으면 `CEREBRAS_EXPLORER_MODEL` 글로벌 폴백
- **`classifyTaskComplexity(task)`** (`config.mjs`): 한/영 regex로 simple/moderate/complex 분류
  - simple: "어디", "찾아", "위치", "defined", "where", "find", "locate" 등
  - complex: "원인", "왜", "버그", "보안", "성능", "security", "vulnerability", "performance" 등
  - moderate: 그 외 모든 경우 (기본값)
- **`resolveModelBudget(task, budget)`** (`runtime.mjs`): `CEREBRAS_EXPLORER_AUTO_ROUTE=true`일 때 복잡도 기반으로 modelBudget 오버라이드 (탐색 budget maxTurns 등은 불변)
- **`ExplorerRuntime` lazy chatClient**: `chatClient` 파라미터 없으면 `explore()` 호출 시 `createChatClient({ budget: modelBudget })`로 생성 → 기존 테스트 호환 유지

---

## 4.2 다중 MCP 도구 노출 — P2

**목표:** `explore_repo` 외에 특화된 고수준 도구 추가

### 새로운 MCP 도구

현재 철학("하나의 고수준 도구")을 유지하되, 특화 도구를 선택적으로 노출:

#### `explain_symbol`
```json
{
  "name": "explain_symbol",
  "description": "특정 심볼(함수/클래스/타입)의 정의, 사용처, 문맥을 종합 설명",
  "parameters": {
    "symbol": "string (required)",
    "repo_root": "string (optional)",
    "scope": ["string array (optional)"]
  },
  "returns": {
    "definition": {...},
    "usage": [...],
    "explanation": "...",
    "relatedSymbols": [...]
  }
}
```

#### `trace_dependency`
```json
{
  "name": "trace_dependency",
  "description": "모듈 간 의존성 체인 추적 (A imports B imports C)",
  "parameters": {
    "entryPoint": "string (required) — 시작 파일",
    "direction": "downstream|upstream|both",
    "maxDepth": "number (default: 3)"
  },
  "returns": {
    "graph": {
      "nodes": [{"path": "...", "exports": [...]}],
      "edges": [{"from": "...", "to": "...", "symbols": [...]}]
    },
    "diagram": "mermaid graph..."
  }
}
```

#### `summarize_changes`
```json
{
  "name": "summarize_changes",
  "description": "특정 기간/브랜치의 변경사항 요약",
  "parameters": {
    "since": "string (optional) — '1 week ago', 커밋 해시, 브랜치명",
    "until": "string (optional)",
    "path": "string (optional) — 특정 경로 필터"
  },
  "returns": {
    "summary": "...",
    "filesByCategory": {
      "added": [...],
      "modified": [...],
      "deleted": [...]
    },
    "keyChanges": [
      {"description": "...", "files": [...], "commits": [...]}
    ]
  }
}
```

#### `find_similar_code`
```json
{
  "name": "find_similar_code",
  "description": "유사한 코드 패턴 검색 (중복 코드, 반복 패턴 발견)",
  "parameters": {
    "reference": "string — 파일 경로 또는 코드 스니펫",
    "startLine": "number (optional)",
    "endLine": "number (optional)",
    "scope": ["string array (optional)"]
  },
  "returns": {
    "matches": [
      {"path": "...", "startLine": 0, "endLine": 0, "similarity": 0.85, "preview": "..."}
    ]
  }
}
```

### 구현 노트
- 각 도구는 내부적으로 같은 ExplorerRuntime을 사용하되, 프롬프트와 전략이 다름
- `explore_repo`는 범용 도구로 유지 — 새 도구들은 특화된 shortcuts
- MCP `tools/list`에서 선택적 노출 (환경변수로 on/off)

### ✅ 구현 결과 (4.2)

- **4개 특화 도구 추가** (`src/mcp/server.mjs`): `explain_symbol`, `trace_dependency`, `summarize_changes`, `find_similar_code`
- 각 도구는 `exploreRepository`를 미리 구성된 task/hints/strategy로 호출하는 wrapper
  - `explain_symbol`: `symbol-first` 전략, budget=normal
  - `trace_dependency`: `reference-chase` 전략, direction(downstream/upstream/both), maxDepth 지원
  - `summarize_changes`: `git-guided` 전략, since/until/path 모두 optional
  - `find_similar_code`: `pattern-scan` 전략, 파일 경로 또는 코드 스니펫 입력
- **`CEREBRAS_EXPLORER_EXTRA_TOOLS=false`**: 4개 도구 비활성화 (기본: 활성화)
- 반환값: 기존 `explore_repo`와 동일한 구조화 응답 (answer, evidence, codeMap 등 포함)
- `find_similar_code.returns.similarity` 필드는 현재 미구현 (LLM이 자연어로 유사도 설명)

---

## 4.3 프로바이더 추상화 — P3

**목표:** Cerebras 외 다른 추론 백엔드 지원

> 현재 코드에는 관련 구현이 존재하지만, 이것을 공개 지원 계약으로 보지는 않는다.

### 아키텍처

```
CerebrasChatClient → AbstractChatClient (interface)
                      ├── CerebrasProvider      — 현재 구현
                      ├── OpenAICompatProvider   — Groq, Together, Fireworks 등
                      └── OllamaProvider         — 로컬 모델
```

### 프로바이더 인터페이스

```javascript
class AbstractChatClient {
  /**
   * @param {Object} opts
   * @param {Array} opts.messages
   * @param {Array} opts.tools
   * @param {number} opts.temperature
   * @param {number} opts.maxTokens
   * @param {Object} opts.responseFormat (optional)
   * @returns {{content: string, toolCalls: Array, usage: Object}}
   */
  async createChatCompletion(opts) {
    throw new Error('Not implemented');
  }
}
```

### 가치
- 내부 실험이나 구조 분리에 활용 가능
- 클라이언트 추상화 경계를 코드 차원에서 분리 가능

### ✅ 구현 결과 (4.3)

파일 구조: `src/explorer/providers/`
- `abstract.mjs`: `AbstractChatClient` — `createChatCompletion(opts)` 인터페이스 + JSDoc
- provider abstraction 및 failover 관련 구현 파일들이 존재
- `index.mjs` 팩토리가 chat client 생성을 담당
- 현재 공개 문서에서는 Cerebras 이외 provider를 지원 계약으로 설명하지 않음

계획 대비 차이:
- provider abstraction은 코드에 존재하지만, 프로젝트 목표와 공개 문서에서는 비목표로 유지
