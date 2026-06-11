# Data Model: trace_symbol usage cross-check enforcement

**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

이 기능은 영속 데이터가 없다. 모든 엔티티는 탐색 호출 1회의 수명을 갖는
런타임 내부 값이거나, 기존 공개 계약 안의 additive 항목이다.

## E1. UsageCrossCheckObservation (런타임 내부, 비공개)

탐색 루프가 도구 호출 **args**에서 수집하는 관측 사실. `observedRanges`/
`observedGit`과 같은 수명·소유권 (탐색 1회, runtime 내부).

| 필드 | 타입 | 수집 규칙 |
|---|---|---|
| `grepPatterns` | `string[]` (bounded, dedupe) | `repo_grep` 호출마다 `toolArgs.pattern` 추가. **결과가 0-match여도 기록** (attempt 기준 — spec edge case). |
| `referenceSymbols` | `string[]` (bounded, dedupe) | `repo_references` 호출마다 `toolArgs.symbol` 추가. |

- 수집 위치: compact explore tool loop만 (report 루프 비대상 — FR-007).
- `repo_symbol_context` 호출은 **기록하지 않는다** (gate 충족 불인정).
- 노출: 공개 `structuredContent`에는 절대 포함하지 않는다. `stats`에 요약
  플래그가 들어갈 경우 `_meta.ops`/transcript로만 흐른다 (additive, redaction
  경로 통과).

## E2. UsageCrossCheckGateInput (critic/판정 입력, 비공개)

```
{ required: boolean,   // taskMode === 'symbol_trace'
  observed: boolean,   // E1에 대해 매칭 규칙 충족 여부
  symbol: string }     // args.hints.symbols[0] (bare target symbol)
```

**매칭 규칙** (검증 술어): `observed = grepPatterns.some(p =>
p.includes(symbol)) || referenceSymbols.includes(symbol)`. 대소문자 구분.
scope 비교 없음 — base scope 안에서만 도구가 실행되므로 구조적으로 충족
(research R6).

**상태 전이** (gate 발화 시, `required && !observed`):

| 필드 | 전 | 후 | 규칙 |
|---|---|---|---|
| `status.verification` | `verified` | `targeted_read_needed` | verified로 확정된 경우에만 강등. critic fail(broad_search_needed)·low confidence(follow_up_needed) 경로가 먼저 걸리면 gate는 발화하지 않음 (이중 경고 금지). |
| `status.confidence` | `high` | `medium` | 기존 finalConfidence cap 메커니즘 재사용. **low로 내리지 않음** (FR-003 — low는 follow_up_needed로 뒤집힘). medium 이하면 무변경. |
| `critic.warnings` | — | +1 `usage_cross_check_missing` | E3 참조. confidence cap이 동반되면 기존 `confidence_downgraded`도 자동 발화. |
| `status.complete` | — | 기존 규칙 유지 | targeted_read_needed도 complete:true 가능 (기존 :1003 규칙). |
| `nextAction` | `stop` | `read_target` | 기존 buildNextAction 규칙의 자연 귀결 (sufficient + read 필요). |

## E3. `usage_cross_check_missing` warning (공개 계약, additive)

기존 critic warning 항목 shape 그대로 (DESIGN §11.3):

| 필드 | 값 |
|---|---|
| `type` | `"usage_cross_check_missing"` |
| `severity` | `"medium"` |
| `message` | 짧은 사실 서술 — "Usage tracing relied on a single symbol lookup; no grep or reference search for `<symbol>` was observed." |
| `target` | bare symbol name |
| `action` | 좁힌 후속 행동 — "Run one grep for the bare symbol name within the current scope (natively or via a follow-up trace_symbol/explore_repo with the same symbol and scope) before trusting the usage list as complete." scope 밖 검색을 암시하지 않는 문구. |

- 예산: 기존 최대 3개·severity 정렬·stable sort 규칙 안에서 경쟁. medium
  tier에서 `confidence_downgraded`보다 **앞 위치**에 push (research R5).
- 발화 횟수: gate 1회 평가이므로 호출당 최대 1개 (AC1 "exactly one").
- `schemaVersion` 불변 — 기존 warning 스키마는 type을 enum으로 제한하지 않음.

## E4. 벤치마크 check type `critic_warning_absent` (평가기, record-only)

evaluator check switch에 추가되는 선언형 check:

```json
{ "type": "critic_warning_absent", "warningType": "usage_cross_check_missing",
  "label": "...", "weight": 0.1 }
```

판정: `result.critic.warnings`에 해당 type이 **없으면** pass. 공개
`structuredContent`만 사용 (시그니처 확장 불필요). 새 케이스
`trace-symbol-cross-check`(symbol=`buildReportCritic`, 기대 target에
`src/explorer/runtime.mjs`)에서 사용. record-only — 점수는 게이트가 아니다.

## E5. 인덱서 절단 정책 (R2 fix의 내부 동작 변화)

`repo_symbol_context`의 caller 수집 (공개 스키마 무변경, 내부 정책만):

- 내부 grep cap: 40 → `budgetConfig.maxSearchResults` (80).
- `slice(0, 20)` 전 결정적 정렬: ① 코드 파일(`detectLanguage !== 'generic'`)
  우선 → ② relation 가중치 (`call`/`member_call`/`constructor` >
  `reference`) → ③ 파일당 상한 3개 round-robin → ④ (path, line) 안정 정렬.
- 반환 필드(`definition`, `callers[]`, `callerCount`, `truncated`)는 불변 —
  내용 구성만 결정적·다양성 보존으로 바뀐다.
