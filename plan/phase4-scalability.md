# Phase 4: 멀티 모델 & 확장성 (Scalability)

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

---

## 4.3 프로바이더 추상화 — P3

**목표:** Cerebras 외 다른 추론 백엔드 지원

### 아키텍처

```
CerebrasChatClient → AbstractChatClient (interface)
                      ├── CerebrasProvider      — 현재 구현
                      ├── OpenAICompatProvider   — Groq, Together, Fireworks 등
                      └── OllamaProvider         — 로컬 모델
```

### 환경변수

```bash
# 프로바이더 선택
EXPLORER_PROVIDER=cerebras          # default
# EXPLORER_PROVIDER=openai-compat
# EXPLORER_PROVIDER=ollama

# Cerebras (기존)
CEREBRAS_API_KEY="sk-..."
CEREBRAS_API_BASE_URL="https://api.cerebras.ai/v1"
CEREBRAS_EXPLORER_MODEL="zai-glm-4.7"

# OpenAI-compatible
EXPLORER_OPENAI_API_KEY="..."
EXPLORER_OPENAI_BASE_URL="https://api.groq.com/openai/v1"
EXPLORER_OPENAI_MODEL="llama-3.3-70b-versatile"

# Ollama
EXPLORER_OLLAMA_BASE_URL="http://localhost:11434"
EXPLORER_OLLAMA_MODEL="qwen2.5-coder:32b"
```

### Failover 설정 (선택)

```bash
# 자동 failover 체인
EXPLORER_FAILOVER="cerebras,openai-compat,ollama"
EXPLORER_FAILOVER_TIMEOUT_MS=5000
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
- Cerebras 장애 시 자동 failover
- 로컬 모델로 오프라인/에어갭 환경 지원
- 사용자가 선호하는 모델/프로바이더 선택 가능
