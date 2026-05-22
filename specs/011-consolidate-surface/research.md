# Research: 도구 표면 단순화와 옵션 정리

본 문서는 plan.md의 3개 user story 각각에서 채택한 접근의 대안과 결정 근거를 기록한다.

---

## R-1. `explore`/`explore_v2` 단일화 (US1)

### Decision
V1 `explore` 코드 경로를 제거하고 010 시점의 `freeExploreV2` 구현을 단일 `explore` 백엔드로 승격. `EXPLORE_V2_TOOL` 도구 이름과 `shouldUseV2ForExplore()` 라우터, `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2` envvar를 모두 제거.

### Rationale
- 010의 5종 신뢰 가이드라인(truncation 라벨, structuredContent.citations/targets, critic warnings, scope hard boundary, evidence sufficiency)이 V2 구현 위에 정착되어 있다. V1 분기를 유지하면 같은 가이드라인을 두 경로에서 일관되게 유지해야 한다 — 단일화하면 한 경로만 유지하면 됨.
- `shouldUseV2ForExplore()` 라우터는 broad/deep 프롬프트일 때만 V2로 보내는 분기인데, 본 spec FR-001은 모든 프롬프트에서 V2 동작을 요구한다. 라우터 자체가 무용해진다.
- `explore_v2` opt-in은 010 시점의 안전망이었다. V2가 default가 되면 도구 이름도 단일화하는 것이 surface 정합성에 좋다.

### Alternatives Considered

| Alternative | 채택하지 않은 이유 |
|---|---|
| V1을 default, V2를 deprecated 별칭으로 유지 | 본 작업의 목표는 "단일 explore"이고, 011 첫 round의 사용자 명시 의도("기존 explore는 제거")와 정확히 반대. |
| `explore_v2` 도구 이름은 유지(alias)하되 구현만 V2로 통합 | tools/list에 동일 backend의 두 이름이 노출되면 외부 client mental model이 더 복잡해진다. 깔끔한 단일 이름 선택. |
| V2 prompt builder에 V1 호환 모드 추가 | V1 prompt가 V2와 의미 있게 다르지 않음. alias 또는 직접 호출이 더 단순. |
| envvar로 V1/V2 전환을 유지 | 단일화의 목표와 충돌. 운영 표면을 줄이는 게 010 follow-up의 핵심. |

### Open Risk
- V1만 갖고 있던 token budget 보호 또는 finalize 경로가 V2에 부족할 수 있다. 회귀 테스트로 가시화하고 부족한 보호는 V2 본문에 추가.
- 외부 통합(클라이언트 manifest)이 `explore_v2`를 직접 호출 중이면 도구 이름 제거가 깨진다. CHANGELOG breaking note + integration manifest 정리로 완화.

---

## R-2. `budget` 입력 제거와 단일 deep config (US2)

### Decision
`explore_repo` 입력에서 `budget` 키를 제거하고 모든 호출에 deep config(010 시점의 `BUDGETS.deep`)를 단일 runtime config로 적용. `chooseAutoBudget()`과 `getBudgetConfig(label)`을 deep 고정 반환으로 단순화.

### Rationale
- budget label은 사용자가 정확히 고르기 어렵고 잘못 고르면 `budget_exhausted` 회귀가 발생한다(010 RAW.md C3).
- 010 evidence sufficiency 게이트가 budget 소진을 "충분한 evidence가 있으면 complete:true"로 처리하므로, 항상 가장 여유로운 deep 값을 적용해도 false-positive 완료가 줄어든다.
- 단일 config는 prompt template/test fixture/문서 표면을 절반 가까이 줄이는 효과를 가진다.

### Alternatives Considered

| Alternative | 채택하지 않은 이유 |
|---|---|
| `budget`을 advanced/internal 키로 남기되 input schema에서만 숨김 | unknown key 거부 정책과 모순. test/operations에서도 우회 사용이 가능해져 단순화 목표 미달. |
| deep 대신 normal을 default로 | 빠른 quick task에서도 더 넓은 search 한도가 필요할 수 있고, deep는 010 시점의 가장 안정적인 한도. 신뢰성 우선. |
| budget 결정을 task 복잡도 기반으로 자동화(`AUTO_ROUTE` 영구 적용) | 본 작업이 그 자동화 envvar를 제거 대상에 포함. 결정 자체가 무용해지는 방향이 spec 의도. |

### Open Risk
- deep config는 quick 호출에도 더 많은 turn/검색 한도를 부여하므로 API 비용이 증가할 가능성이 있다. 비용에 민감한 운영자는 별도 server 인스턴스 + 더 가벼운 모델 조합을 사용하도록 안내(README/CHANGELOG).
- 응답 메타에서 budget label이 사라지면 `_debug.stats.budget`을 grep하던 외부 도구가 깨질 수 있다 — derived 필드는 단일 표기('deep' 고정) 또는 제거 중 선택. 본 spec은 후자(노출하지 않음)를 권장.

---

## R-3. 환경변수 10개 제거 (US3)

### Decision
다음 10개 envvar를 코드/테스트/문서/integration 매니페스트에서 모두 제거. 동시에 010이 도입한 두 옵트인 동작(legacy targets 승격, auto session reuse)의 코드 경로 자체를 제거.

- `CEREBRAS_MODEL` (alias)
- `CEREBRAS_EXPLORER_MODEL_QUICK|NORMAL|DEEP` (budget별 모델 override)
- `CEREBRAS_EXPLORER_EXTRA_TOOLS` (wrapper 토글)
- `CEREBRAS_EXPLORER_ENABLE_EXPLORE` (explore 토글)
- `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2` (V2 opt-in — US1과 함께 제거)
- `CEREBRAS_EXPLORER_AUTO_ROUTE` (budget 자동 결정)
- `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO` (010 옵트인)
- `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS` (010 migration window)

### Rationale
- 사용 빈도가 낮고, 대부분 010 follow-up에서 surface를 단순화하면 의미가 사라진다.
- 010이 의도적으로 1-릴리스 migration window를 둔 두 envvar(`LEGACY_DISCOVERED_TARGETS`, `AUTO_SESSION_BY_REPO`)는 본 작업으로 종료된다 — 사용자에게 충분한 알림 기간을 준 뒤 정리하는 정석.
- 모델 선택을 단일 `CEREBRAS_EXPLORER_MODEL`로 통일하면 운영자 mental model이 가벼워진다. budget별 모델 운영이 필요한 사용자는 별도 server 인스턴스 + wrapper를 두는 우회를 사용할 수 있다.

### Alternatives Considered

| Alternative | 채택하지 않은 이유 |
|---|---|
| 010 옵트인 두 envvar는 1 릴리스 더 유지 | 010 RAW.md/plan.md가 이미 "1 릴리스 migration window"라고 명시. 011은 그 다음 릴리스이므로 종료가 자연스러움. |
| envvar 이름은 유지하되 값을 무시(no-op) | 운영자가 효과 없는 설정을 계속 적용 → 디버깅 혼란 유발. 제거가 더 깔끔. |
| `EXTRA_TOOLS=false`로 도구 surface 최소화 옵션은 유지 | minimal surface가 필요하면 별도 MCP gateway에서 필터링하는 것이 더 깨끗한 분리. 본 server는 표준 surface 유지. |
| 모델 alias `CEREBRAS_MODEL` 유지(deprecated warning) | warning 출력 자체가 stdout/stderr 노이즈. 단순 제거가 더 명확. |

### Open Risk
- minimal surface 운영자는 별도 gateway로 우회해야 함. CHANGELOG/README에 명시 필요.
- 010 옵트인 사용자(특히 `AUTO_SESSION_BY_REPO=1`)는 explicit `session` 전달로 코드를 바꿔야 함. CHANGELOG에 명시 필요.

---

## 공통 결정

### 두 가지 명시 breaking change를 단일 minor에 묶음
- `explore_repo` 입력에서 `budget` 키 제거
- `explore_v2` 도구 이름 제거

010 schema additive 정책의 의도된 예외임을 spec/plan/CHANGELOG에 명시. 두 변경이 한 묶음으로 들어가야 surface 정합성(8개 도구 + budget 없는 input schema)이 한 번에 깔끔하게 정리된다.

### Reason
- 010은 5개 신뢰 fix를 묶었고, 011은 그 follow-up으로 정리를 묶는다. 두 작업이 같은 정신("단일 묶음으로 외부 contract를 정리")으로 일관성을 유지.
- 분할하면 release overhead만 키운다.

### Alternative Rejected
- 두 breaking change를 별도 릴리스로 분할 — 사용자가 두 번의 migration 부담을 짊어지게 됨. 한 번에 처리하는 것이 운영 비용 면에서도 더 낫다.
