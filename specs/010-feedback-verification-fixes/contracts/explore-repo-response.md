# Contract Change: `explore_repo` / wrapper 응답 구조

본 문서는 본 feature가 도입하는 MCP `structuredContent` 변경을 외부 consumer 관점에서 요약한다. 모든 변경은 **additive optional**이며 기존 필드의 enum/required는 변경되지 않는다.

---

## 1. 변경 요약 (외부 consumer 관점)

| 변경 | 종류 | 영향 |
|---|---|---|
| `discoveredPaths[]` 신규 top-level optional 필드 | additive | 무시해도 안전. parent agent가 follow-up routing에 사용 가능. |
| `targets[]`에서 evidenceRefs 빈 reference path 자동 생성 제거 | observable | parent가 reference target을 broad follow-up 대상으로 의존했다면 `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1`로 1 릴리스 호환. |
| `status.complete`/`verification`/`failure.reason` 결정 로직 변경(budget 소진 단독으로 `complete:false` 강제 안 함) | observable | parent가 `failure.reason='budget_exhausted'`를 그대로 재시도 신호로 쓰던 경우, 이제 evidence sufficiency가 false일 때만 등장. `searchCoverage.stoppedByBudget`은 그대로 유지되므로 budget 사실은 계속 관찰 가능. |
| Report 도구(`explore`/`explore_v2`)의 citation target file-level 병합 | observable | 같은 파일의 여러 line range citation이 1 target으로 줄어듦. citation별 range가 필요하면 `citations[]`(report 응답에 이미 존재) 사용. |
| `gitDiff()`/`gitShow()`/`gitDiff({stat:true})` 결과의 `files`/stat text가 base scope 안으로 한정. optional `omittedOutOfScopeFiles`/`omittedSecretPaths` 노출 | observable | scope 밖 파일을 보던 caller는 scope를 넓혀 재호출 필요. DESIGN의 hard boundary와 일치(보안 강화). |
| `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 옵트인에서 explicit session 없이 같은 repoRoot의 reusable session 자동 재사용 | additive opt-in | 기본 off. multi-client에서는 explicit session 권장. |
| Redaction에서 `process.env.X`/`import.meta.env.X`/`Deno.env.get("X")` env var 이름 보존 | observable | snippet 가독성 회복. secret value/secret file path 마스킹은 그대로. 강한 마스킹 원하면 `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1`. |

---

## 2. 응답 구조 diff

### `explore_repo` (및 6 wrapper) 정상 응답

```jsonc
{
  "schemaVersion": 1,
  "directAnswer": "...",
  "status": {
    "confidence": "low" | "medium" | "high",
    "verification": "verified" | "targeted_read_needed" | "follow_up_needed" | "broad_search_needed",
    "complete": boolean,           // 의미 재정의: "충분한 grounded evidence 확보"
    "warnings": ["string"]         // budget+sufficient 시 낮은 severity 문구 추가 가능
  },
  "targets": [                     // discovery-only path 제거(기본)
    {
      "path": "string",
      "role": "edit"|"read"|"test"|"config"|"context"|"reference",
      "reason": "string",
      "evidenceRefs": ["string"],
      "startLine": integer?,
      "endLine": integer?
    }
  ],
  "discoveredPaths": [             // ← 신규 optional
    {
      "path": "string",
      "kind": "file" | "dir" | "unknown",
      "sourceTool": "string",      // repo_list_dir 등
      "reason": "string"
    }
  ],
  "evidence": [...],               // 변경 없음
  "uncertainties": [...],          // 변경 없음
  "nextAction": {
    "type": "stop" | "read_target" | "explore_followup" | "ask_user",
    "reason": "string",
    "query": "string"?             // explore_followup의 새 후보
  },
  "evidenceQuality": {...},        // 변경 없음
  "searchCoverage": {
    "stoppedByBudget": boolean,    // budget 사실 그대로 유지(complete:true여도)
    ...
  },
  "failure": {                     // budget+sufficient이면 null
    "reason": "budget_exhausted" | ... ,
    "retry": {...}
  } | null,
  "session": {...} | null,
  "sessionId": "string" | null,
  "_debug": {
    "evidenceSufficiency": {       // ← 신규 진단
      "sufficient": boolean,
      "reason": "string"
    },
    "stats": {
      "sessionSource": "explicit" | "created" | "reused" | "auto_repo"  // ← 신규 진단
    }
  }
}
```

### `gitDiff()` / `gitShow()` 결과 (모델에 전달되는 tool result)

```jsonc
{
  "from": "string",
  "to": "string",
  "files": [{ "path": "string", "status": "string", ... }],
  "omittedOutOfScopeFiles": integer?,  // ← 신규 optional (0보다 클 때만)
  "omittedSecretPaths": integer?        // ← 신규 optional (0보다 클 때만)
}
```

### `gitDiff({stat:true})` 결과

```jsonc
{
  "from": "string",
  "to": "string",
  "stat": "string",
  "omittedOutOfScopeFiles": integer?,   // ← 신규 optional
  "omittedSecretPaths": integer?,
  "redacted": boolean?,
  "redactions": [...]?
}
```

### Report 도구(`explore`/`explore_v2`) `structuredContent.targets`

- 같은 파일 path의 citation은 1 target으로 병합
- `startLine` 최소, `endLine` 최대
- `citationCount > 1`이면 `reason: "Markdown report citations merged from N ranges."`

---

## 3. Migration Guide

### Parent agent가 `targets[].evidenceRefs.length===0`로 follow-up routing 하던 경우

**전**:
```js
const followUpCandidates = result.targets.filter(t => t.evidenceRefs.length === 0);
```

**후**:
```js
const followUpCandidates = result.discoveredPaths ?? [];
// 또는 1 릴리스 동안 envvar로 기존 동작 유지:
//   CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1
```

### Parent agent가 `failure.reason==='budget_exhausted'`로 자동 retry 하던 경우

**전**:
```js
if (result.failure?.reason === 'budget_exhausted') retry();
```

**후**:
```js
// budget+sufficient이면 failure가 null이므로 자동 통과.
// budget 정보가 필요하면 searchCoverage.stoppedByBudget 사용:
if (result.searchCoverage?.stoppedByBudget && !result.status.complete) retry();
```

### Parent가 `gitDiff()`에서 scope 밖 파일을 받던 경우

**전**: scope `['docs/**']`로 호출했지만 `gitDiff()`는 모든 파일 반환

**후**: scope를 넓혀 재호출하거나, omitted count를 시각화에 사용
```js
if (result.omittedOutOfScopeFiles > 0) {
  console.warn(`${result.omittedOutOfScopeFiles} files omitted by scope`);
}
```

### Sub-agent / parent agent summary 작성 시

**보존 필수 필드** (README/AGENTS docs에 명문화):
- `status.verification`
- `status.complete`
- `evidenceQuality`
- `searchCoverage`
- `failure`
- `session` / `sessionId`
- `critic.warnings` (report 도구의 경우 `structuredContent.critic`)

---

## 4. Schema Validation Notes

- 본 feature는 `EXPLORE_REPO_OUTPUT_SCHEMA.required`를 변경하지 않는다.
- 신규 `DISCOVERED_PATH_SCHEMA`는 별도 ref로 추가되며, `additionalProperties: false`이므로 strict.
- `discoveredPaths` 자체는 optional이라 기존 응답에 없는 경우에도 validation 통과.
- `SESSION_SCHEMA.status` enum(`created`/`reused`/`fallback`)은 변경되지 않는다.
- `EXPLORE_RESULT_JSON_SCHEMA`(모델 출력)에는 `discoveredPaths`를 추가하지 않는다. runtime이 derive한다.

---

## 5. Backward-incompatible 가능성 점검

본 feature의 모든 변경은 다음 의미에서 backward-compatible로 간주한다:

- schema는 strict 정의에서 additive
- 동작 변경은 모두 envvar로 1 릴리스 호환 제공
- legacy/redact/auto-session 3개 envvar 모두 기본 off

다만 **observable behavior**는 변한다(targets 구성, failure 발생 빈도, scope-out 파일 제외 등). 본 contract 문서가 그 변화를 기록하는 단일 출처다.
