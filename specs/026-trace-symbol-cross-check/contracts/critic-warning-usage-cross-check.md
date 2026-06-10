# Contract: `usage_cross_check_missing` (additive critic warning)

**Spec**: [../spec.md](../spec.md) | 공개 표면 변경의 전부가 이 문서다.

## 불변 (surface freeze — FR-007)

- 공개 도구 8개, 입력 스키마, 환경변수: **무변경**.
- `structuredContent` 필드 집합, `schemaVersion`(2): **무변경**.
- 비-`symbol_trace` 경로(다른 wrapper 5개, 직접 `explore_repo`, report 모드
  `explore`): 응답 **byte-identical**.

## 추가되는 것 (additive)

### 1. critic warning type

`taskMode='symbol_trace'`(= `trace_symbol` wrapper) 탐색이 대상 심볼에 대한
usage cross-check(해당 심볼을 포함하는 `repo_grep` 패턴 또는 해당 심볼로의
`repo_references` 호출) 없이 `verified`에 도달했을 때, 응답은 다음을 갖는다:

```json
{
  "status": { "verification": "targeted_read_needed", "confidence": "<= medium" },
  "critic": {
    "status": "caution",
    "warnings": [
      {
        "type": "usage_cross_check_missing",
        "severity": "medium",
        "message": "Usage tracing relied on a single symbol lookup; no grep or reference search for `<symbol>` was observed.",
        "target": "<symbol>",
        "action": "Run one repo_grep for the bare symbol name (within the current scope) before trusting the usage list as complete."
      }
    ]
  }
}
```

소비자 규칙 (parent agent):
- 이 경고를 받으면 usage 목록을 **불완전 가능**으로 취급하고, action의 후속
  1회(grep)로 신뢰를 복원한다 — 전체 재탐색은 불필요 (DESIGN §11.1 철학).
- 경고는 기존 최대 3개 예산 안에서 경쟁하며, confidence cap이 동반되면
  `confidence_downgraded` 경고가 함께 나타날 수 있다.
- cross-check가 관측된 호출에서는 이 경고가 절대 나타나지 않고 기존 판정이
  그대로 유지된다.

### 2. 벤치마크 check type (운영/평가 계약, record-only)

`critic_warning_absent` — 선언형 suite의 `checks[]`에서 사용:

```json
{ "type": "critic_warning_absent", "warningType": "usage_cross_check_missing", "weight": 0.1 }
```

`result.critic.warnings[].type`에 `warningType`이 없으면 pass. 벤치마크는
record-only이며 릴리즈 게이트가 아니다 (spec 021 정책 유지).
