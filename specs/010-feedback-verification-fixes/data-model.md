# Data Model: 피드백 검증 기반 5종 신뢰성 수정

본 문서는 본 feature가 도입/수정하는 데이터 구조와 schema 변경을 정리한다. 모든 변경은 **additive**이며 기존 strict consumer를 깨지 않는다.

---

## 1. ExplorerRuntime Result (top-level)

`src/explorer/schemas.mjs/EXPLORE_REPO_OUTPUT_SCHEMA`에 대한 additive 변경 요약.

### As-is (변경 없음)

```jsonc
{
  "schemaVersion": 1,
  "directAnswer": "string",
  "status": StatusBlock,
  "targets": [TargetItem],
  "evidence": [EvidenceItem],
  "uncertainties": ["string"],
  "nextAction": NextAction,
  "evidenceQuality": EvidenceQuality,
  "searchCoverage": SearchCoverage,
  "failure": Failure | null,
  "session": SessionRef | null,
  "sessionId": "string" | null,
  "_debug": { /* free object */ }
}
```

### To-be (additive)

```jsonc
{
  // 기존 필드 모두 그대로
  "discoveredPaths": [DiscoveredPathItem]  // 신규 optional
}
```

- **신규 필드**: `discoveredPaths` (optional array, default `[]`)
- **변경 없는 필드**: 위 As-is의 모든 enum/required
- **runtime 동작 변경**: `targets[]`에서 evidenceRefs 빈 reference path 자동 승격이 사라짐(legacy envvar로 1 릴리스 호환).

---

## 2. StatusBlock

`src/explorer/schemas.mjs/STATUS_SCHEMA`.

### As-is (변경 없음)

```jsonc
{
  "confidence": "low" | "medium" | "high",
  "verification": "verified" | "targeted_read_needed" | "follow_up_needed" | "broad_search_needed",
  "complete": boolean,
  "warnings": ["string"]
}
```

### To-be (변경 없음 — 의미만 재정의)

- `complete`의 **의미**가 "turn budget을 다 쓰지 않음"이 아니라 "**충분한 grounded evidence 확보**"로 재정의된다.
- `verification`의 결정 로직이 `stats.stoppedByBudget` 단독에서 evidence sufficiency 우선으로 변경된다.
- schema 정의 자체는 변경 없음. strict consumer 무영향.

### 진단 필드 (`_debug` 하위, 비스키마)

```jsonc
{
  "_debug": {
    "evidenceSufficiency": {
      "sufficient": boolean,
      "reason": "simple_task_exact_evidence" | "path_has_multi_step_evidence"
              | "edit_plan_has_actionable_target" | "claim_has_grounded_evidence"
              | "general_multi_evidence" | "simple_task_needs_exact_evidence"
              | "path_needs_more_steps" | "edit_plan_needs_actionable_target"
              | "claim_needs_exact_evidence" | "general_needs_more_evidence"
              | "missing_answer_or_evidence" | "critic_or_execution_failure"
    },
    "stats": {
      "sessionSource": "explicit" | "created" | "reused" | "auto_repo"  // Spec-5 신규
    }
  }
}
```

- `_debug`는 free object이므로 schema 변경 없음. consumer가 무시해도 안전.

---

## 3. TargetItem

`src/explorer/schemas.mjs/TARGET_ITEM_SCHEMA`.

### As-is

```jsonc
{
  "path": "string",
  "role": "edit" | "read" | "test" | "config" | "context" | "reference",
  "reason": "string",
  "evidenceRefs": ["string"],
  "startLine": integer?,
  "endLine": integer?
}
```

### To-be (변경 없음)

- schema 미변경.
- **runtime 의미 변경**: `role:'reference' + evidenceRefs:[]` 항목이 더 이상 자동 생성되지 않는다(Spec-2). `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` 옵트인 시 기존 동작 유지.

### Report citation merge 변경

- `buildReportCitationTargets(citations)`가 file-level로 병합:
  - 같은 `path`의 citation은 1 target으로 합침
  - `startLine` 최소, `endLine` 최대
  - `citationCount > 1`이면 `reason: "Markdown report citations merged from N ranges."`

---

## 4. DiscoveredPathItem (신규)

`src/explorer/schemas.mjs`에 추가될 `DISCOVERED_PATH_SCHEMA`.

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "path": { "type": "string" },
    "kind": { "type": "string", "enum": ["file", "dir", "unknown"] },
    "sourceTool": { "type": "string" },
    "reason": { "type": "string" }
  },
  "required": ["path", "kind", "sourceTool", "reason"]
}
```

### 수집 규칙

| sourceTool | path | kind | reason |
|---|---|---|---|
| `repo_list_dir` | `entry.path` | `entry.kind` (`file`/`dir`)→정규화, 외 `unknown` | "Listed during repository discovery." |
| `repo_find_files` | `matches[i]` | `file` | "Matched file discovery query." |
| `repo_git_diff` | `files[i].path` | `file` | "Changed file discovered from git metadata." |
| `repo_git_show` | `files[i].path` | `file` | (동일) |
| 기타 | `collectTargetPathsFromToolResult` legacy | `unknown` | "Discovered from tool result." |

### Dedupe 정책

- `path` 기준 dedupe
- 같은 path의 `kind`가 `unknown`이면 더 구체적인 `kind`로 병합
- 기본 cap 100개

---

## 5. GitDiffResult / GitShowResult

`src/explorer/repo-tools.mjs`의 `gitDiff()`/`gitShow()` 반환 객체. JSON schema는 없으며 tool result로 모델에 전달된다.

### As-is

```jsonc
{
  "from": "string",
  "to": "string",
  "files": [{ "path": "string", "status": "string", ... }]
}
```

### To-be (additive)

```jsonc
{
  "from": "string",
  "to": "string",
  "files": [{ "path": "string", ... }],
  "omittedOutOfScopeFiles": integer,  // optional, 0보다 클 때만 포함
  "omittedSecretPaths": integer        // optional, 0보다 클 때만 포함
}
```

### Stat mode 결과

```jsonc
{
  "from": "string",
  "to": "string",
  "stat": "string (filtered)",
  "omittedOutOfScopeFiles": integer?,
  "omittedSecretPaths": integer?,
  "redacted": boolean?,
  "redactions": [...]?
}
```

---

## 6. SessionRecord

`src/explorer/session.mjs`의 in-memory `Map` value.

### As-is

```jsonc
{
  "id": "sess_xxxxxxxx",
  "repoRoot": "absolute path",
  "calls": integer,
  "lastUsedAt": milliseconds,
  "createdAt": milliseconds
}
```

### To-be (변경 없음 — 새 entry point만 추가)

- **신규 method**: `SessionStore.findReusableForRepo(repoRoot)` → `{ ok: true, session, remainingCalls } | null`
- **새 분기**: `resolveSessionForExplore()`에서 `autoSessionByRepoEnabled()` && explicit session 없음 → 최신 reusable session 자동 reuse
- `session.status` enum(`created`/`reused`/`fallback`) 변경 없음. 자동 reuse도 `reused`로 표시, 구분은 `_debug.stats.sessionSource='auto_repo'`.

---

## 7. RedactionResult

`src/explorer/redact.mjs`의 `redactText()`/`redactValue()` 반환.

### As-is (변경 없음)

```jsonc
{
  "text": "string",
  "redacted": boolean,
  "redactions": [{ "rule": "string", "match": "string" }]
}
```

### Boundary regex 변경

- `SECRET_PATH_MENTION_REGEX`를 token boundary 기반으로 재정의.
- 매칭 시 prefix 보존: `replace(re, (raw, prefix, relPath) => \`${prefix}[REDACTED:secret-path]\`)`.
- env var name 마스킹은 `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1` 옵트인에서만 활성화.

---

## 8. Environment Variables (신규/유지)

| Name | Spec | Default | 의미 |
|---|---|---|---|
| `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS` | Spec-2 | `off` | `1`이면 1 릴리스 동안 discovered path를 기존처럼 `targets[]`에 `role:reference, evidenceRefs:[]`로 승격. |
| `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES` | Spec-3 | `off` | `1`이면 env var 이름도 추가 마스킹. 조직 정책 옵트인. |
| `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO` | Spec-5 | `off` | `1`이면 explicit session 없을 때 같은 repoRoot의 최신 reusable session을 자동 reuse. |
| `CEREBRAS_EXPLORER_EXTRA_TOOLS` | 기존 | `on` | wrapper 6개 노출 토글. |
| `CEREBRAS_EXPLORER_ENABLE_EXPLORE` | 기존 | `on` | `explore` 노출 토글. |
| `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2` | 기존 | `off` | `explore_v2` 노출 토글. |

---

## 9. Backward Compatibility Matrix

| Consumer 유형 | 영향 |
|---|---|
| `EXPLORE_REPO_OUTPUT_SCHEMA` strict validator | `discoveredPaths` optional이라 통과. `additionalProperties:false` 가정시에도 schema에 명시되므로 통과. |
| `targets[]`에서 `evidenceRefs.length===0` 항목을 follow-up 대상으로 사용 | 기본 동작에서 사라짐. `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1`로 1 릴리스 호환. |
| `redactText`로 snippet을 redact 후 시각 검사하던 사용자 | env var 이름이 보존됨 → 가독성 회복. secret value/path 마스킹은 그대로. |
| `gitDiff()`로 scope 밖 changed file을 받던 caller | 더 이상 받지 못함. scope를 넓혀 재호출 필요. DESIGN의 hard boundary와 일치. |
| `session` 인자 없이 호출하던 caller | 기본 동작 동일(매번 새 session). `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 옵트인 시에만 자동 reuse. |
| `SESSION_SCHEMA.status` enum 검사 consumer | 변경 없음(`created`/`reused`/`fallback` 유지). |
