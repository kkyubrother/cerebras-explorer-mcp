# Contract Change: 011 surface consolidation

본 문서는 011이 도입하는 MCP `explore_repo` 입력 / `tools/list` 출력 / 응답 derived 필드 변경을 외부 consumer 관점에서 요약한다.

---

## 1. 변경 요약

| 변경 | 종류 | 영향 |
|---|---|---|
| `EXPLORE_REPO_INPUT_SCHEMA`에서 `budget` 키 제거 | **breaking** | `budget`을 전달하던 caller는 unknown property error를 받음. |
| `explore_v2` 도구 이름이 `tools/list`에서 사라짐 | **breaking** | 도구 이름 직접 호출 client는 `explore`로 변경 필요. |
| 8개 도구 surface 고정(어떤 환경변수로도 변경 불가) | breaking for minimal-surface ops | 가벼운 surface가 필요하면 별도 MCP gateway 필터링. |
| 10개 envvar가 더 이상 인식되지 않음 | observable | data-model.md §6 표 참조. |
| 010 두 옵트인 동작(legacy targets / auto session)이 영구 제거 | observable | data-model.md §8 표 참조. |
| `_debug.stats.sessionSource` enum에서 `'auto_repo'` 제거 | observable | 010 이전 분류 그대로. |
| `searchCoverage.summary`/`evidenceQuality.summary`의 budget label 언급 정리 | observable | 단일 'deep' 표기 또는 제거. |
| `failure.reason='budget_exhausted'` retry hint에서 budget label 권유 제거 | observable | "narrower task" 등 일반 안내만. |
| `EXPLORE_REPO_OUTPUT_SCHEMA` 자체 | 무변경 | 010 schema 그대로. `discoveredPaths[]`, `omittedOutOfScopeFiles` 등 유지. |

---

## 2. 입력 schema diff

```diff
 EXPLORE_REPO_INPUT_SCHEMA = {
   type: 'object',
   additionalProperties: false,
   required: ['task'],
   properties: {
     task: { type: 'string' },
     repo_root: { type: 'string' },
     scope: { type: 'array', items: { type: 'string' } },
     hints: { ... },
     session: { type: 'string' },
     language: { type: 'string' },
-    budget: { type: 'string', enum: ['quick', 'normal', 'deep'] },
   },
 };
```

---

## 3. `tools/list` 응답 diff

```diff
 [
   { "name": "explore_repo",            ... },
   { "name": "find_relevant_code",      ... },
   { "name": "trace_symbol",            ... },
   { "name": "map_change_impact",       ... },
   { "name": "explain_code_path",       ... },
   { "name": "collect_evidence",        ... },
   { "name": "review_change_context",   ... },
   { "name": "explore",                 ... },
-  { "name": "explore_v2",              ... }    // 환경변수와 무관하게 더 이상 노출되지 않음
 ]
```

도구 수는 환경변수와 무관하게 항상 정확히 8개.

---

## 4. Migration Guide

### `budget` 입력을 보내던 caller

**Before** (010):
```js
await callTool('explore_repo', { task: '...', budget: 'deep' });
```

**After** (011):
```js
await callTool('explore_repo', { task: '...' });  // budget 키 제거
```

서버는 모든 호출에 deep config 한도를 자동 적용한다.

### `explore_v2`를 직접 호출하던 client

**Before** (010, 환경변수 켰을 때):
```js
await callTool('explore_v2', { prompt: '...', thoroughness: 'deep' });
```

**After** (011):
```js
await callTool('explore', { prompt: '...', thoroughness: 'deep' });
```

`explore`가 010 시점의 V2 동작을 그대로 수행한다.

### `EXTRA_TOOLS=false` 또는 `ENABLE_EXPLORE=false`로 surface 축소 운영자

**Before**: envvar로 도구를 1~2개로 줄여 사용.

**After**: 환경변수가 무시되므로 8개 surface 모두 노출. 도구 일부만 허용하려면 client 측 화이트리스트 또는 MCP gateway 필터링 적용.

### `CEREBRAS_MODEL` 사용자

**Before**: `CEREBRAS_MODEL`만 설정해도 fallback으로 동작.

**After**: `CEREBRAS_EXPLORER_MODEL`로 명시 설정 필요.

### `CEREBRAS_EXPLORER_MODEL_DEEP` 등 budget별 모델 운영자

**Before**: deep 호출만 더 큰 모델 사용.

**After**: 단일 모델. 비용 분리가 필요하면 server 인스턴스를 둘로 분리하고 각각 다른 `CEREBRAS_EXPLORER_MODEL` 사용.

### `AUTO_SESSION_BY_REPO=1` opt-in 사용자

**Before**: 같은 repoRoot 자동 reuse.

**After**: explicit `session` 전달로 변경 필요.

### `LEGACY_DISCOVERED_TARGETS=1` opt-in 사용자

**Before**: discovered path가 `targets[]`에 `role:'reference'`로 자동 승격.

**After**: 010 신 동작(targets vs discoveredPaths 분리)이 영구 적용. parent는 `discoveredPaths[]`를 사용.

---

## 5. Schema Validation Notes

- 본 feature는 `EXPLORE_REPO_OUTPUT_SCHEMA.required`/enum을 변경하지 않는다.
- `EXPLORE_REPO_INPUT_SCHEMA`에서 `budget`만 제거. `additionalProperties:false`로 unknown key 거부.
- `SESSION_SCHEMA.status` enum 변경 없음.
- `EXPLORE_RESULT_JSON_SCHEMA`(모델 출력) 변경 없음.

---

## 6. 명시 Breaking Change 정책

본 작업은 010 schema additive 정책의 의도된 예외다. CHANGELOG에서 두 breaking change를 별도 항목으로 강조하고, README/integration manifest에서도 migration 안내를 명시한다.

semver 측면에서 next minor에 함께 처리해 사용자가 한 번에 migration할 수 있도록 한다.
