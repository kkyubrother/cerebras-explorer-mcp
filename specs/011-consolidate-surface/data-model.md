# Data Model: 도구 표면 단순화와 옵션 정리

본 문서는 본 feature가 도입/변경/제거하는 데이터 구조와 schema 변경을 정리한다. 두 가지 **명시 breaking change**가 있고, 그 외에는 010 schema 그대로 유지된다.

---

## 1. ExplorerRuntime Result (top-level)

`src/explorer/schemas.mjs/EXPLORE_REPO_OUTPUT_SCHEMA`. 010과 동일. 변경 없음.

본 작업은 응답 schema 자체를 변경하지 않는다. 단, derived 필드 중 다음 항목은 의미가 정리된다.

- `_debug.stats.budget` / `_debug.stats.budgetSource`: 사용자 선택 가능 신호로서의 의미를 잃음. 노출되더라도 항상 단일 'deep' 표기 또는 제거 중 후자를 권장.
- `_debug.stats.sessionSource`: enum에서 `'auto_repo'`가 사실상 사라짐(코드 분기 자체가 제거). `'explicit' | 'created' | 'reused'`만 남음.
- `searchCoverage.summary` / `evidenceQuality.summary`: budget label 언급 제거 또는 deep 고정 표기.

---

## 2. `explore_repo` Input Schema (BREAKING)

`src/explorer/schemas.mjs/EXPLORE_REPO_INPUT_SCHEMA`.

### As-is (010)

```jsonc
{
  "task": "string",
  "repo_root": "string?",
  "scope": ["string"]?,
  "hints": { "symbols": [...], "files": [...], "regex": [...] }?,
  "session": "string?",
  "language": "string?",
  "budget": "quick" | "normal" | "deep"?     // ← removed in 011
}
```

### To-be (011)

```jsonc
{
  "task": "string",
  "repo_root": "string?",
  "scope": ["string"]?,
  "hints": { "symbols": [...], "files": [...], "regex": [...] }?,
  "session": "string?",
  "language": "string?"
  // budget 키 제거. additionalProperties:false로 거부.
}
```

**Breaking impact**: `budget` 키를 보내던 기존 caller는 unknown property error를 받는다. CHANGELOG에 명시.

---

## 3. MCP Tool Surface (BREAKING)

`src/mcp/server.mjs/buildToolList()`.

### As-is (010)

| 환경 | 도구 수 | 노출 도구 |
|---|---|---|
| 기본 | 8 | `explore_repo` + 6 wrapper + `explore` |
| `ENABLE_EXPLORE_V2=true` | 9 | 위 + `explore_v2` |
| `EXTRA_TOOLS=false` | 2 | `explore_repo` + `explore` |
| `ENABLE_EXPLORE=false` | 7 | `explore_repo` + 6 wrapper |
| 둘 다 false | 1 | `explore_repo`만 |

### To-be (011)

| 환경 | 도구 수 | 노출 도구 |
|---|---|---|
| 모든 환경 (고정) | 8 | `explore_repo` + 6 wrapper + `explore` |

**Breaking impact**: `explore_v2`라는 도구 이름이 사라진다. `EXTRA_TOOLS=false`/`ENABLE_EXPLORE=false`로 surface를 줄이던 운영자는 별도 MCP gateway 필터링이 필요. CHANGELOG에 명시.

---

## 4. Budget Configuration

`src/explorer/config.mjs/BUDGETS`.

### As-is (010)

```js
export const BUDGETS = {
  quick:  { label: 'quick',  maxTurns: 10, maxSearchResults: 20, maxReadLines: 140, /* ... */ },
  normal: { label: 'normal', maxTurns: 20, maxSearchResults: 40, maxReadLines: 220, /* ... */ },
  deep:   { label: 'deep',   maxTurns: 30, maxSearchResults: 80, maxReadLines: 320, /* ... */ },
};

export function getBudgetConfig(label) {
  return BUDGETS[label] ?? BUDGETS.normal;
}

export function chooseAutoBudget({ task, scope, hints }) {
  // task 복잡도 + scope + hints로 'quick'|'normal'|'deep' 선택
}
```

### To-be (011)

```js
// 단일 deep config만 노출. 후속 spec에서 값 변경 가능.
export const BUDGETS = {
  deep: { label: 'deep', maxTurns: 30, maxSearchResults: 80, maxReadLines: 320, /* ... */ },
};

// label 인자 무시 — 단일 config 반환.
export function getBudgetConfig() {
  return BUDGETS.deep;
}

// 'deep' 고정 반환(또는 호출부 제거).
export function chooseAutoBudget() {
  return 'deep';
}
```

대안: `BUDGETS.quick`/`BUDGETS.normal`을 deep config로 alias하여 외부 import가 깨지지 않도록 유지하는 것도 가능. 본 작업은 호환성보다 단순화 우선이라 단일 entry 권장.

---

## 5. SessionStore API

`src/explorer/session.mjs/SessionStore`.

### As-is (010)

- `create(repoRoot)`, `get(id)`, `update(id, result)`, `validateForReuse(id, repoRoot)`, `findReusableForRepo(repoRoot)`, `getRemainingCalls(id)`, `isExhausted(id)`, `size()`, `prune()`

### To-be (011)

- `findReusableForRepo(repoRoot)` **제거**.
- 다른 API는 010 그대로.

이유: `findReusableForRepo`는 `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 분기에서만 호출되었고, 본 작업이 그 분기를 제거하므로 method 자체도 dead code.

---

## 6. Removed Environment Variables (10개)

| Name | 도입 시점 | 010에서의 역할 | 011 이후 |
|---|---|---|---|
| `CEREBRAS_MODEL` | pre-010 | `CEREBRAS_EXPLORER_MODEL` alias fallback | 인식되지 않음. `CEREBRAS_EXPLORER_MODEL` 단일 사용. |
| `CEREBRAS_EXPLORER_MODEL_QUICK` | pre-010 | quick budget 전용 모델 override | budget 자체가 사라져 무용. 제거. |
| `CEREBRAS_EXPLORER_MODEL_NORMAL` | pre-010 | normal budget 전용 모델 override | 동일. |
| `CEREBRAS_EXPLORER_MODEL_DEEP` | pre-010 | deep budget 전용 모델 override | 동일. |
| `CEREBRAS_EXPLORER_EXTRA_TOOLS` | pre-010 | wrapper 6 노출 토글 | 항상 노출. |
| `CEREBRAS_EXPLORER_ENABLE_EXPLORE` | pre-010 | explore 노출 토글 | 항상 노출. |
| `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2` | pre-010 | explore_v2 opt-in | V2가 단일 explore가 되므로 무용. |
| `CEREBRAS_EXPLORER_AUTO_ROUTE` | pre-010 | task 복잡도 기반 budget 선택 | budget 자체가 사라져 무용. |
| `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO` | 010 | 같은 repoRoot 자동 reuse 옵트인 | 1 릴리스 migration window 종료. 제거. |
| `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS` | 010 | 기존 reference target 승격 호환 | 동일. 제거. |

---

## 7. Retained Environment Variables (운영 가시)

본 작업에서 유지되는 envvar 목록(README envvar 표 기준).

| Name | 역할 |
|---|---|
| `CEREBRAS_API_KEY` | provider 인증 (필수) |
| `CEREBRAS_API_BASE_URL` | provider endpoint override |
| `CEREBRAS_EXPLORER_MODEL` | 단일 모델 ID |
| `CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS` | HTTP timeout |
| `CEREBRAS_EXPLORER_TEMPERATURE` | direct client/budget override 없는 경로의 fallback |
| `CEREBRAS_EXPLORER_TOP_P` | 동일 |
| `CEREBRAS_EXPLORER_REASONING_FORMAT` | reasoning output 형식 |
| `CEREBRAS_EXPLORER_CLEAR_THINKING` | reasoning clear hint |
| `CEREBRAS_EXPLORER_REDACT_GENERIC_HEX` | generic hex redaction 옵션 |
| `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES` | 010 — env var 이름 강한 마스킹 |
| `CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST` | 로컬 디버깅 |
| `CEREBRAS_EXPLORER_TRANSCRIPT` | transcript JSONL 기록 |
| `CEREBRAS_EXPLORER_TRANSCRIPT_DIR` | transcript 디렉토리 |
| `CEREBRAS_EXPLORER_V2_TURN_MULTIPLIER` | explore 튜닝 |
| `CEREBRAS_EXPLORER_V2_MAX_EXTRA_TURNS` | explore 튜닝 |
| `CEREBRAS_EXPLORER_V2_MAX_COMPACTIONS` | explore 튜닝 |
| `EXPLORER_PROVIDER` | provider 종류 override (내부) |
| `EXPLORER_FAILOVER` | provider failover (내부) |
| `EXPLORER_OPENAI_*` | OpenAI-compatible 설정 |

---

## 8. Backward Compatibility Matrix

| Consumer 유형 | 영향 |
|---|---|
| `explore_repo({ budget: '...' })` caller | **Breaking**. unknown property error. budget 키 제거 필요. |
| `explore_v2`를 직접 호출하는 client | **Breaking**. 도구 이름 없음. `explore`로 변경 필요. |
| `EXTRA_TOOLS=false`로 minimal surface 운영자 | **Behavior change**. 8개 도구 모두 노출. 별도 MCP gateway 필터링으로 우회. |
| `ENABLE_EXPLORE=false`로 explore 비활성 운영자 | **Behavior change**. explore 항상 노출. 동일 우회. |
| `ENABLE_EXPLORE_V2=true` opt-in 사용자 | 무영향. 어차피 단일 explore가 V2 동작. |
| `AUTO_SESSION_BY_REPO=1` opt-in 사용자 | **Behavior change**. explicit `session` 전달로 회귀. |
| `LEGACY_DISCOVERED_TARGETS=1` opt-in 사용자 | **Behavior change**. 신 동작(targets vs discoveredPaths) 영구 적용. |
| `CEREBRAS_MODEL`만 설정한 운영자 | **Behavior change**. `CEREBRAS_EXPLORER_MODEL`로 변경 필요. |
| `CEREBRAS_EXPLORER_MODEL_DEEP` 등으로 budget별 모델 운영자 | **Behavior change**. 단일 모델로 통일. 별도 server 인스턴스로 우회. |
| `EXPLORE_REPO_OUTPUT_SCHEMA` strict validator | 무영향. 응답 schema 동일. |
| `discoveredPaths[]`/`omittedOutOfScopeFiles` consumer | 무영향. 010 그대로. |
| `_debug.stats.sessionSource='auto_repo'`을 보던 consumer | **Behavior change**. 더 이상 발생하지 않음. |
