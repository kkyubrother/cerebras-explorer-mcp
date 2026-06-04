# Feature Specification: 도구 표면 단순화와 옵션 정리

**Feature Branch**: `011-consolidate-surface`

**Created**: 2026-05-22

**Status**: Implemented

**Input**: User description: "010 follow-up — 사용 빈도 낮은 환경변수 10개와 `explore_repo`의 `budget` 입력 파라미터를 모두 제거하고, V2(`explore_v2`)가 그대로 단일 `explore` 도구가 되도록 V1 explore 코드를 제거한다. 모든 호출은 기존 deep budget config 값을 단일 runtime config로 사용한다. 도구 surface는 8개로 고정(explore_repo + wrapper 6 + explore)."

## Clarifications

### Session 2026-05-22

- Q: 제거 범위 — envvar 7개만 vs envvar 7개 + budget 입력 → **A: envvar 7개 + budget 입력 파라미터 모두 제거**.
- Q: `explore_v2` 처리 → **A: `explore_v2`의 구현이 그대로 `explore` 자리로 승격, V1 explore 코드와 `explore_v2` 도구 이름은 제거**. (ENABLE_EXPLORE_V2 envvar도 함께 제거)
- Q: budget 제거 후 기본 동작 → **A: 기존 `deep` budget config 값(turn limit, finalize tokens, sampling 등)을 모든 호출의 단일 runtime config로 적용**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - V1/V2 분기 제거로 `explore` 한 가지로 일관 (Priority: P1)

Parent agent와 사용자는 "Markdown 보고서를 받는 경로"가 한 가지여야 한다. 현재는 `explore`(V1)와 `explore_v2`(opt-in)가 공존하고, `explore`가 broad/deep 프롬프트일 때 내부 라우터로 V2를 호출하는 분기까지 있어 입출력 동작과 truncation 처리에 차이가 생긴다. 본 user story는 V1 explore 코드를 제거하고 V2 구현이 그대로 `explore`가 되어, MCP client/agent가 어떤 프롬프트에서도 같은 동작을 기대할 수 있게 만든다.

**Why this priority**: 도구 surface 단순화의 핵심이다. V1/V2 분기는 RAW.md C6/C14의 "report가 V2일 때만 truncation 라벨이 나온다"는 문제와 직결되어 있고, 단일화하면 신뢰 가이드라인이 한 경로에만 적용된다. 다른 모든 정리(envvar/budget)는 이 변경 위에 자연스럽게 따라온다.

**Independent Test**: 임의의 `explore` 프롬프트(짧은 locate부터 broad/deep 보고까지)에 대해 호출 결과가 항상 V2 동작(tool result truncation 라벨, `structuredContent.citations[]`/`targets[]`, `critic.warnings`)을 보이는지로 검증. `explore_v2` 도구 이름이 더 이상 MCP `tools/list`에 나타나지 않는지도 함께 확인.

**Acceptance Scenarios**:

1. **Given** MCP `initialize` + `tools/list`, **When** 클라이언트가 도구 목록을 받으면, **Then** 정확히 8개 도구가 노출되고 그 중 1개가 `explore`이며 `explore_v2`는 어떤 환경에서도 노출되지 않는다.
2. **Given** 짧은 locate 성격의 `explore` 프롬프트, **When** 호출이 끝나면, **Then** 응답은 Markdown 본문과 `structuredContent.citations[]`/`targets[]`/`critic`/`searchCoverage`를 함께 노출한다(예전 V1만 호출되는 경로가 없다).
3. **Given** broad/deep 보고 프롬프트, **When** 호출이 끝나면, **Then** truncation 라벨, `searchCoverage.warnings`, `critic.warnings` 등 V2 신뢰 가이드라인이 동일하게 적용된다.
4. **Given** 기존 V1 explore 구현(`freeExplore`/V1 prompt builder/V1 finalize prompt 등) 호출 경로, **When** 회귀 테스트와 사용처를 점검하면, **Then** 더 이상 사용되는 곳이 없고 코드 검색에서도 V1 전용 심볼이 나타나지 않는다.

---

### User Story 2 - `budget` 입력 파라미터 제거와 단일 runtime config (Priority: P2)

Parent agent는 `explore_repo`/wrapper를 호출할 때 더 이상 budget(`quick`/`normal`/`deep`)을 선택하지 않는다. 서버가 모든 호출에 기존 `deep` budget 값(turn limit, max search/read, finalize tokens, temperature/topP 등)을 단일 runtime config로 적용한다. 이는 도구 입력 schema 축소와 자동 라우팅 로직 제거를 의미한다.

**Why this priority**: budget 결정은 parent의 mental model을 불필요하게 무겁게 만들고, 잘못 선택하면 `budget_exhausted` 회귀가 발생한다. 항상 가장 여유로운 deep 값을 적용해 신뢰성을 우선한다. 010이 만든 evidence sufficiency 게이트와도 잘 맞물린다.

**Independent Test**: 임의의 `explore_repo`/wrapper 호출이 `budget` 입력 없이 (그리고 input schema가 그 키를 거부) 정상 동작하고, 내부 stats/turn limit이 항상 deep 값을 사용하는지 mock runtime으로 확인.

**Acceptance Scenarios**:

1. **Given** `explore_repo({ task, ... })` 호출, **When** input validation이 작동하면, **Then** `budget` 키 없이 호출이 성공하고 `budget: 'quick'`/`'normal'`/`'deep'` 어떤 값으로도 호출되지 않는다(입력 schema가 unknown key로 거부).
2. **Given** 모든 wrapper 6개와 `explore` 호출, **When** runtime이 시작되면, **Then** 내부 turn limit, max search results, finalize token 한도가 항상 기존 deep budget 값과 일치한다(다른 두 label은 코드에 더 이상 존재하지 않거나 deep로 alias).
3. **Given** `_debug.stats`와 응답 메타, **When** 결과를 보면, **Then** 더 이상 `budget`/`budgetSource`/`auto budget choice` 같은 label-기반 신호가 등장하지 않고(혹은 단일 "deep"으로 고정 표기되고), `searchCoverage` 요약 문구가 budget label에 의존하지 않는다.
4. **Given** 기존 `failure.reason='budget_exhausted'` 경로, **When** evidence sufficiency가 부족한 상태에서 turn이 모두 소진되면, **Then** 동일하게 `budget_exhausted`로 보고되되 retry hint에 "narrower task" 같은 일반 안내만 포함되고 "select a deeper budget" 같은 label 선택 권유가 없다.

---

### User Story 3 - 사용 빈도 낮은 환경변수 10개 일괄 제거 (Priority: P3)

다음 10개 환경변수가 모두 제거된다. 각각의 의미는 도구 surface 고정/단일 모델/단일 runtime config/legacy 미지원으로 변경되어 더 이상 옵션을 표면화할 이유가 없다.

- `CEREBRAS_MODEL`
- `CEREBRAS_EXPLORER_MODEL_QUICK`, `CEREBRAS_EXPLORER_MODEL_NORMAL`, `CEREBRAS_EXPLORER_MODEL_DEEP`
- `CEREBRAS_EXPLORER_EXTRA_TOOLS`
- `CEREBRAS_EXPLORER_ENABLE_EXPLORE`
- `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`
- `CEREBRAS_EXPLORER_AUTO_ROUTE`
- `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`
- `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS`

**Why this priority**: 코드/문서/integration manifest 일관성 정리 작업. P1/P2가 끝나면 자연스럽게 따라오지만, 운영 표면이 줄어들어 사용자가 설정해야 할 것이 명확해진다.

**Independent Test**: 위 10개 envvar 이름을 코드/테스트/문서/integration manifest에서 grep했을 때 0건이며, 같은 값을 설정해도 서버 동작에 영향이 없는지 확인.

**Acceptance Scenarios**:

1. **Given** 위 10개 envvar 중 어떤 것을 설정한 상태, **When** MCP 서버를 부팅하고 도구 목록과 호출 동작을 점검, **Then** 어떤 envvar도 동작을 바꾸지 않는다.
2. **Given** 코드/테스트/문서/integration 매니페스트 grep, **When** 위 10개 envvar 이름을 검색, **Then** **0건**(주석/changelog 회상은 예외 — 항목별 일관 처리).
3. **Given** README/DESIGN/AGENTS 문서, **When** Security Model, env var 표, Codex/agent instructions 섹션을 점검, **Then** 위 envvar 설명이 모두 사라지고, 남아 있는 envvar 표는 본 spec의 "남는 envvar 목록"과 일치한다.
4. **Given** 010에서 추가된 `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS` migration window, **When** 본 feature를 적용, **Then** legacy reference target 자동 승격 코드 경로 자체가 사라지고 새 동작이 영구 적용된다.

---

### Edge Cases

- 외부 사용자가 여전히 `budget: 'quick'`을 입력으로 보내는 경우 → 입력 schema가 unknown key로 거부하므로 명확한 에러 메시지를 받는다.
- 외부 사용자가 `CEREBRAS_MODEL`만 설정하고 `CEREBRAS_EXPLORER_MODEL`을 비워 둔 환경 → 더 이상 fallback되지 않으므로 server가 기본 모델 또는 명확한 "set CEREBRAS_EXPLORER_MODEL" 안내로 동작.
- 외부 사용자가 `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true`를 설정한 상태 → envvar는 무시되고 `explore`는 어차피 V2 backend를 항상 사용하므로 동작이 동일.
- V2 구현이 V1과 다르게 동작하던 edge case(예: V1만 fallback 경로, V1만 보호하던 token budget 등)는 V2 동작으로 통일되어, 일부 회귀 시나리오 기대값이 달라질 수 있다.
- `failure.reason='budget_exhausted'`는 deep runtime config 한계에서도 발생 가능하므로 retry hint는 "narrower task"만 안내하고 budget label 선택을 권유하지 않는다.
- 010에서 의도적으로 두었던 `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` 옵트인 사용자는 본 릴리스 후 신 동작만 받게 된다(migration window 종료를 명시).
- 010에서 두었던 `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 사용자는 더 이상 자동 reuse를 받지 못하므로 explicit `session` 전달로 회귀.
- `_debug.stats`에 노출되던 `budget`/`budgetSource`/`sessionSource: auto_repo` 같은 필드는 의미를 잃거나 일관 표기로 통일된다.
- `searchCoverage.summary`/`evidenceQuality.summary` 문구의 "budget" 단어가 사라지거나 한 가지 표현으로 통일된다.
- README/DESIGN/AGENTS의 wrapper decision rule에서 "opt-in `explore_v2`" 항목이 사라지고 explore 한 줄로 단순화된다.

## Requirements *(mandatory)*

### Functional Requirements

#### 도구 surface와 explore 단일화 (User Story 1)

- **FR-001**: System MUST `tools/list`에 정확히 8개의 도구만 노출해야 한다: `explore_repo`, `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `explore`. `explore_v2`라는 이름의 도구는 어떤 환경에서도 노출되지 않는다.
- **FR-002**: System MUST `explore` 도구의 실행 백엔드를 010 시점의 `freeExploreV2` 구현으로 고정해야 한다. 즉, V2가 그대로 `explore`가 된다.
- **FR-003**: System MUST V1 explore 전용 구현(`freeExplore` V1 본문, V1 prompt builder, V1 finalize prompt, V1 router 분기 등)을 더 이상 호출되지 않도록 정리해야 한다(코드 path 제거 또는 V2 구현으로 alias).
- **FR-004**: System MUST `explore` 응답이 모든 프롬프트 유형에서 V2 신뢰 가이드라인(structuredContent.citations[]/targets[], critic.warnings, searchCoverage.warnings, tool-result truncation 라벨)을 적용해야 한다.
- **FR-005**: System MUST V1 vs V2를 구분하던 라우터(예: `shouldUseV2ForExplore()`)와 그 결정 로직을 제거해야 한다.

#### `budget` 입력 제거와 단일 runtime config (User Story 2)

- **FR-006**: System MUST `EXPLORE_REPO_INPUT_SCHEMA`에서 `budget` 속성을 제거하고, `budget` 키를 가진 입력은 unknown property로 거부해야 한다.
- **FR-007**: System MUST `chooseAutoBudget()`/`auto budget choice` 결정 로직을 제거하거나 단일 "deep" 라벨로 고정 반환하도록 단순화해야 한다.
- **FR-008**: System MUST 모든 explore 호출(`explore_repo`, wrapper 6, `explore`)에 010 시점 `BUDGETS.deep` 값(`maxTurns`, `maxSearchResults`, `maxReadLines`, `finalizeMaxCompletionTokens`, sampling 등)을 단일 runtime config로 적용해야 한다.
- **FR-009**: System MUST `failure.reason='budget_exhausted'` 메시지와 retry hint가 budget label 선택(예: "select deep budget")을 더 이상 권유하지 않고, "narrower task / more specific anchors" 같은 일반 안내만 포함해야 한다.
- **FR-010**: System MUST `_debug.stats`/`searchCoverage`/`evidenceQuality.summary`/응답 어디에도 `budget`/`budgetSource`/`budget label` 같은 사용자 선택 신호를 노출하지 않아야 한다(단일 runtime config라는 사실이 명시되거나 모두 deep로 통일 표기).

#### 사용 빈도 낮은 환경변수 10개 제거 (User Story 3)

- **FR-011**: System MUST 다음 10개 환경변수를 코드에서 인식하지 않아야 한다: `CEREBRAS_MODEL`, `CEREBRAS_EXPLORER_MODEL_QUICK`, `CEREBRAS_EXPLORER_MODEL_NORMAL`, `CEREBRAS_EXPLORER_MODEL_DEEP`, `CEREBRAS_EXPLORER_EXTRA_TOOLS`, `CEREBRAS_EXPLORER_ENABLE_EXPLORE`, `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`, `CEREBRAS_EXPLORER_AUTO_ROUTE`, `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`, `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS`.
- **FR-012**: System MUST 010에서 추가된 legacy reference target 자동 승격 코드 경로 자체를 제거해, 신 동작(targets vs discoveredPaths 분리)만 영구 적용해야 한다.
- **FR-013**: System MUST 010에서 추가된 같은 repoRoot session 자동 reuse 분기를 제거하고, explicit `session` 인자에만 의존해야 한다(`_debug.stats.sessionSource='auto_repo'` 값도 더 이상 발생하지 않는다).
- **FR-014**: System MUST 모델 선택을 단일 환경변수 `CEREBRAS_EXPLORER_MODEL`에만 의존하도록 통일해야 한다(미설정 시에는 코드 기본값).
- **FR-015**: System MUST README/DESIGN/AGENTS/CHANGELOG/integration 매니페스트에서 제거된 10개 환경변수 설명을 모두 삭제하고, "남는 envvar 목록"이 본 spec과 일치하도록 갱신해야 한다.

#### 공통 (모든 user story)

- **FR-016**: System MUST `explore_repo` 응답의 기존 schema 필드(`schemaVersion`, `status`, `targets`, `discoveredPaths`, `evidence`, `nextAction`, `evidenceQuality`, `searchCoverage`, `failure`, `session`, `_debug`)를 그대로 유지해야 한다(`budget` 관련 derived 필드 외에는 변경 없음).
- **FR-017**: System MUST integration 예시(`integrations/*/README.md`, `*.json.example`)를 갱신해 더 이상 제거되는 envvar/플래그를 권유하지 않아야 한다.
- **FR-018**: System MUST AGENTS.md의 도구 불변 문구(공개 도구 8개, opt-in `explore_v2` 언급)를 본 spec의 새 surface와 일치하도록 갱신해야 한다.

### Key Entities *(include if feature involves data)*

- **Tool surface (MCP)**: `explore_repo`, 6 wrappers, `explore`. 정확히 8개. `explore_v2`는 더 이상 존재하지 않음.
- **`explore_repo` input schema**: 기존 속성에서 `budget` 제거. `additionalProperties:false` 정책 그대로.
- **Runtime config**: 단일 deep config (`maxTurns`, `maxSearchResults`, `maxReadLines`, `finalizeMaxCompletionTokens`, sampling 등). 다른 label은 제거 또는 deep로 alias.
- **Removed envvars**: 10개 목록(위 FR-011 참조).
- **남는 envvar (운영 가시)**: `CEREBRAS_EXPLORER_MODEL`, `CEREBRAS_API_KEY`, `CEREBRAS_API_BASE_URL`, `CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS`, `CEREBRAS_EXPLORER_TEMPERATURE`, `CEREBRAS_EXPLORER_TOP_P`, `CEREBRAS_EXPLORER_REASONING_FORMAT`, `CEREBRAS_EXPLORER_CLEAR_THINKING`, `CEREBRAS_EXPLORER_REDACT_GENERIC_HEX`, `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES`, `CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST`, `CEREBRAS_EXPLORER_TRANSCRIPT`, `CEREBRAS_EXPLORER_TRANSCRIPT_DIR`, `EXPLORER_PROVIDER`/`EXPLORER_FAILOVER` 등 provider 관련(내부 옵션 그대로 유지). `CEREBRAS_EXPLORER_V2_*` 튜닝 envvar는 V2가 단일 runtime이 되므로 단순 explore 튜닝 envvar로 의미 유지.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `tools/list` 응답이 환경변수 설정과 무관하게 항상 정확히 8개 도구를 노출하고, 그 안에 `explore_v2`라는 이름이 0건이다.
- **SC-002**: `explore` 호출 결과가 모든 프롬프트 유형(짧은 locate, broad, deep 등)에서 V2 동작 5종(structuredContent.citations[]/targets[], critic, searchCoverage, tool-result truncation 라벨)을 100% 제공한다(예전 V1만 갖던 동작 차이가 0).
- **SC-003**: `explore_repo`/wrapper 호출에서 `budget` 키를 포함한 입력이 100% 거부되고, `budget` 키 없는 호출은 100% 정상 처리된다.
- **SC-004**: 모든 explore 호출의 내부 stats에서 turn limit/max search/max read/finalize token 한도가 010 시점 deep budget 값과 일치한다.
- **SC-005**: 응답 어디에도 사용자 선택 가능한 `budget` 신호가 노출되지 않는다(`_debug.stats.budget` 등에 단일 라벨이 표기되더라도 사용자 입력으로 변경할 수 없는 derived 정보임이 명확).
- **SC-006**: 코드/테스트/문서/integration 매니페스트 grep에서 제거되는 10개 envvar 이름이 모두 0건이다(CHANGELOG의 변경 항목 회상만 예외).
- **SC-007**: `failure.reason='budget_exhausted'` retry hint와 메시지에서 "deep budget 선택" 같은 label 권유 문구가 0건이다.
- **SC-008**: README/DESIGN/AGENTS의 envvar 표가 본 spec의 "남는 envvar 목록"과 1:1로 일치하고, wrapper decision rule에서 `explore_v2` 항목이 사라진다.
- **SC-009**: 기존 `npm test` 전체 회귀가 0 failure로 통과한다(필요한 기대값 갱신 후).
- **SC-010**: MCP `initialize` 응답의 instructions 문자열에 `explore_v2` 언급, `budget` 안내, 제거되는 envvar 언급이 모두 0건이고, 010에서 추가된 progressToken/control-plane 보존 안내는 유지된다.

## Assumptions

- 010 시점의 `BUDGETS.deep` 값이 단일 runtime config 기준값이다. 본 작업은 그 값을 그대로 채택하며 별도 튜닝은 하지 않는다(이후 별도 spec에서 조정 가능).
- 본 작업은 010 schema additive 정책의 후속으로 **사용자 입력 schema 축소(`budget` 제거)와 도구 이름 제거(`explore_v2`)** 라는 명시적 breaking change를 1회 수반한다. semver 측면에서 next minor에서 함께 처리한다고 가정한다.
- 010에서 도입한 두 옵트인 envvar(`AUTO_SESSION_BY_REPO`, `LEGACY_DISCOVERED_TARGETS`)는 1-릴리스 migration window를 마치고 본 작업에서 영구 제거된다.
- 모델 선택은 단일 `CEREBRAS_EXPLORER_MODEL`로 통일된다. budget 별 모델 분리 사용 사례가 있는 사용자는 운영 환경에서 별도 wrapper 또는 다중 server를 두는 방식으로 우회한다고 가정한다.
- `CEREBRAS_EXPLORER_V2_TURN_MULTIPLIER`/`MAX_EXTRA_TURNS`/`MAX_COMPACTIONS` 같은 V2 내부 튜닝 envvar는 본 작업에서 제거하지 않는다(V2가 단일 explore가 된 뒤에도 그대로 단일 explore 튜닝 envvar로 의미가 유지된다).
- `EXPLORER_PROVIDER`/`EXPLORER_FAILOVER` 같은 provider 내부 옵션도 본 작업의 범위 밖이다(010 AGENTS 정책에 따라 사용자용 1급 시민으로 다루지 않으나 코드 옵션은 유지).
- 회귀 게이트는 `npm test` 전체 0 failure이며, 본 작업은 010이 도입한 evidence sufficiency/scope hard boundary/discoveredPaths 분리 동작을 손상시키지 않는다.
- `_debug.stats`의 `sessionSource='auto_repo'` 값은 더 이상 발생하지 않으므로, 그 값을 검사하던 010 신규 테스트는 본 작업에서 삭제 또는 갱신된다.
