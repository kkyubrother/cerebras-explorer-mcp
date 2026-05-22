# Implementation Plan: 도구 표면 단순화와 옵션 정리

**Branch**: `011-consolidate-surface` | **Date**: 2026-05-22 | **Spec**: ./specs/011-consolidate-surface/spec.md

**Input**: Feature specification from `./specs/011-consolidate-surface/spec.md`

**Origin**: 010 후속 정리. 010의 두 옵트인 envvar(`AUTO_SESSION_BY_REPO`, `LEGACY_DISCOVERED_TARGETS`) migration window 종료 + 사용 빈도 낮은 envvar 8개와 `budget` 입력 파라미터, V1 explore 구현, `explore_v2` 도구 이름까지 정리.

## Summary

본 작업은 spec.md의 3개 user story(P1~P3)를 단일 릴리스에 묶어 도입한다.

- **US1 (P1)**: V1 `explore` 코드 경로를 제거하고 V2(`freeExploreV2`) 구현을 `freeExplore`(= MCP `explore`)로 승격. `EXPLORE_V2_TOOL` 정의와 `shouldUseV2ForExplore()` 라우터, `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2` envvar를 모두 제거. 결과적으로 `tools/list`는 항상 8개(`explore_repo` + 6 wrapper + `explore`).
- **US2 (P2)**: `EXPLORE_REPO_INPUT_SCHEMA`에서 `budget` 키 제거. `chooseAutoBudget()`과 `getBudgetConfig()`/`BUDGETS` 자료구조를 단일 deep config로 단순화. retry hint에서 budget label 권유 문구 제거. `_debug.stats`/응답 어디서도 사용자 선택 가능한 budget 신호를 노출하지 않음.
- **US3 (P3)**: 사용 빈도 낮은 envvar 10개를 코드/테스트/문서/integration manifest에서 일괄 제거(`CEREBRAS_MODEL`, `CEREBRAS_EXPLORER_MODEL_QUICK|NORMAL|DEEP`, `EXTRA_TOOLS`, `ENABLE_EXPLORE`, `ENABLE_EXPLORE_V2`, `AUTO_ROUTE`, `AUTO_SESSION_BY_REPO`, `LEGACY_DISCOVERED_TARGETS`). 010 legacy 분기와 auto session reuse 분기도 함께 제거.

기술 접근:
- 본 작업은 **두 가지 명시적 breaking change**를 포함한다: (a) `explore_repo` 입력에서 `budget` 키 제거 (b) `explore_v2` 도구 이름 제거. semver 측면에서 next minor에 함께 처리.
- 010의 다른 신뢰 동작(evidence sufficiency, discoveredPaths 분리, redaction env var 보존, scope hard boundary, progress/handoff instructions)은 손상시키지 않는다.
- 단일 runtime config는 010 시점의 `BUDGETS.deep` 값을 그대로 채택. 별도 튜닝은 본 작업 범위 밖.
- 테스트 시나리오: budget 입력을 받던 기존 테스트는 budget을 제거한 형태로 갱신. `_debug.stats.sessionSource='auto_repo'`를 검사하던 010 테스트는 삭제 또는 갱신. 그 외 회귀는 그대로 통과.

## Technical Context

**Language/Version**: Node.js ≥22 (`package.json` engines). ESM modules. 신규 런타임 의존성 없음.

**Primary Dependencies**: 기존 MCP stdio 서버 인프라(`src/mcp/server.mjs`), `ExplorerRuntime`(`src/explorer/runtime.mjs`), 010에서 정착된 단일 `freeExploreV2` 구현, `SessionStore`(`src/explorer/session.mjs`), `redactText`/`redactValue`(`src/explorer/redact.mjs`). 신규 외부 패키지 없음.

**Storage**: 해당 없음.

**Testing**: 저장소 표준 `node --test`(`npm test`). 본 작업의 테스트 변경 범위는 (a) `tests/runtime.mock.test.mjs`의 budget 입력/auto session/legacy 분기 케이스, (b) `tests/mcp-server.test.mjs`의 V2 enable envvar/tool surface 분기 케이스, (c) `tests/security/redact.test.mjs`는 변경 없음(010 envvar 그대로 유지), (d) `tests/repo-tools.test.mjs`는 변경 없음(scope hard boundary 그대로 유지), (e) `tests/session.test.mjs`의 `findReusableForRepo` 케이스 — 010 옵트인이 제거되므로 method 자체도 삭제 또는 테스트만 제거 결정 필요.

**Target Platform**: 로컬 개발자/운영자 머신(Windows, macOS, Linux)에서 stdio MCP 서버로 실행. CLI surface(`src/index.mjs`) 변경 없음.

**Project Type**: Single-package Node.js MCP 서버. 본 작업은 `src/`, `tests/`, `README.md`, `DESIGN.md`, `AGENTS.md`, `CHANGELOG.md`, `integrations/` 매니페스트를 수정 대상으로 한다.

**Performance Goals**: 단일 deep config로 통일되어도 turn 당 동작 latency에 의미 있는 증가가 없어야 한다. budget 결정 로직 제거로 entry latency가 미세하게 줄어들 가능성은 있으나 측정 목표는 아니다.

**Constraints**:
- 두 가지 breaking change(`budget` 입력 제거, `explore_v2` 도구 이름 제거)는 본 작업의 명시 범위 안. 그 외 schema 필드는 010 그대로 유지(`schemaVersion=1`, `STATUS_SCHEMA`, `discoveredPaths`, `omittedOutOfScopeFiles` 등).
- `SESSION_SCHEMA.status` enum 미변경.
- 010 evidence sufficiency 게이트, scope hard boundary, redaction env var 보존, progress/handoff instructions는 그대로 유지.

**Scale/Scope**: 변경 대상 코드 파일 ~6개(`config.mjs`, `runtime.mjs`, `schemas.mjs`, `server.mjs`, `session.mjs`, `prompt.mjs`), 테스트 파일 ~3개, 문서 4개, integration manifest 다수.

## Constitution Check

본 저장소의 `.specify/memory/constitution.md`는 placeholder 상태이므로, 본 plan은 010과 마찬가지로 저장소 invariant를 자체 게이트로 채택한다.

- **Read-only 회귀 없음**: 본 작업은 write/network 동작을 추가하지 않는다. `freeExplore`의 V1→V2 단일화는 보안 측면에서도 더 강한 truncation 라벨 적용이라 회귀 없음.
- **외부 계약 안정성**: 본 작업은 명시한 두 가지 외 일체의 schema 변경을 도입하지 않는다. `discoveredPaths[]`, `omittedOutOfScopeFiles` 등 010 additive 필드는 그대로 유지.
- **Secret deny-list / redaction**: 변경 없음. 010 env var 보존 동작 그대로.
- **테스트 게이트**: `npm test` 전체 0 failure(필요한 기대값 갱신 후) + 회귀 무결.
- **추적성**: CHANGELOG에 011의 두 가지 breaking change와 envvar 정리를 단일 묶음으로 기록. AGENTS.md의 invariant("공개 도구 8개", `explore_v2` 언급)를 본 작업의 새 surface와 일치하도록 갱신.

Constitution 게이트 위반 없음. `Complexity Tracking`은 비어 있다.

## Project Structure

### Documentation (this feature)

```text
specs/011-consolidate-surface/
├── spec.md                                    # 입력 (이미 작성)
├── plan.md                                    # 본 문서
├── research.md                                # 3개 user story 대안 분석
├── data-model.md                              # schema/config diff
├── contracts/
│   └── explore-repo-and-explore-response.md   # input/output contract 변경 요약
├── quickstart.md                              # 3개 user story 수동 검증 절차
└── tasks.md                                   # /speckit-tasks 산출물
```

### Repository Layout (touched files)

```text
src/explorer/config.mjs        # US2: BUDGETS 단일 deep config로 단순화, chooseAutoBudget 제거 또는 'deep' 고정
                                # US3: legacyDiscoveredTargetsEnabled / autoSessionByRepoEnabled / extraToolsEnabled / exploreToolEnabled / exploreV2ToolEnabled / model alias / budget-specific model 함수 제거
src/explorer/runtime.mjs       # US1: V1 freeExplore 본문 제거, freeExploreV2를 freeExplore로 이름 변경
                                # US2: budget 결정 로직 제거, sessionSource auto_repo 분기 제거
                                # US3: discoveredPaths legacy 승격 분기 제거
src/explorer/schemas.mjs       # US2: EXPLORE_REPO_INPUT_SCHEMA에서 budget 키 제거
src/explorer/prompt.mjs        # US1: V1 prompt builder(buildFreeExploreSystemPrompt / buildFreeExploreUserPrompt / buildFreeExploreFinalizePrompt) 제거
src/explorer/session.mjs       # US3: findReusableForRepo 제거 (auto_repo 의존 없음)
src/mcp/server.mjs             # US1: EXPLORE_V2_TOOL 정의 제거, shouldUseV2ForExplore 라우터 제거, EXPLORE_TOOL이 freeExploreRepositoryV2 호출
                                # US2: tool-call handler에서 budget 인자 forwarding 제거
                                # US3: buildToolList 환경변수 분기 제거(항상 8개)
                                # initialize instructions의 V2/budget 관련 언급 정리

tests/runtime.mock.test.mjs    # budget 인자/auto_repo/legacy 사용 케이스 정리
tests/mcp-server.test.mjs      # tool surface 분기/EXPLORE_V2 노출 케이스 정리
tests/session.test.mjs         # findReusableForRepo 케이스 정리

README.md                       # envvar 표, 도구 섹션, decision rule, Security Model 갱신
DESIGN.md                       # §11.4(sufficiency)/§11.7(session/progress) 본문에서 v2/budget 언급 정리
AGENTS.md                       # 공개 도구 8개 + explore_v2 opt-in 문구 정리
CHANGELOG.md                    # 011 단일 묶음 기록(두 breaking change + envvar 10개 제거 + V1 explore 코드 제거)
integrations/*/README.md, *.json.example  # explore_v2/제거 envvar 언급 제거
```

**Structure Decision**: 단일 패키지 ESM 그대로 유지. 신규 모듈 없음. 본 작업은 코드 추가보다 **제거/단순화**가 중심이라 변경 라인 비율이 010보다 낮을 것으로 예상.

## Implementation Outline

본 작업은 3개 user story를 P1 → P3 순서로 진행한다. 각 Phase는 (a) 신규/갱신 테스트 → 실패 또는 무결 확인 → (b) 코드 변경 → (c) 회귀 무결 → (d) user story 한정 문서 메모 순. Cross-cutting 문서/CHANGELOG는 마지막 Phase 7에서 통합.

### Spec-1 (US1, P1) — `explore`/`explore_v2` 단일화

코드 변경:
1. `src/mcp/server.mjs/EXPLORE_TOOL`은 그대로 두되, `callFreeExploreTool()` 내부에서 항상 `freeExploreRepositoryV2`(또는 그 단일 후속)를 호출하도록 변경.
2. `EXPLORE_V2_TOOL` 정의, `exploreV2ToolEnabled()` 호출, `buildToolList()`의 V2 추가 분기를 제거.
3. `shouldUseV2ForExplore()` 라우터와 그 인자 처리 제거.
4. `src/explorer/runtime.mjs`에서 `freeExplore` V1 메서드 본문을 제거하고, `freeExploreV2`를 그대로 `freeExplore`로 rename(또는 V1을 V2 호출 alias로 단축).
5. `src/explorer/prompt.mjs`에서 V1 전용 prompt builder(`buildFreeExploreSystemPrompt`/`buildFreeExploreUserPrompt`/`buildFreeExploreFinalizePrompt`)를 제거 또는 V2 builder로 alias.
6. MCP `initialize` instructions 문자열에서 "advanced opt-in `explore_v2`" 같은 문구 정리.

테스트:
- `tests/mcp-server.test.mjs`의 `explore_v2 exposed when env enabled` 케이스 제거.
- `tests/runtime.mock.test.mjs`의 freeExplore 시나리오들이 V2 동작으로 일관되게 통과하는지 확인.
- 신규: `tools/list`가 항상 8개를 반환, `explore_v2`가 어떤 환경에서도 없음을 확인하는 케이스 1개.

### Spec-2 (US2, P2) — `budget` 입력 제거 + 단일 deep config

코드 변경:
1. `src/explorer/schemas.mjs/EXPLORE_REPO_INPUT_SCHEMA`에서 `budget` 속성 제거.
2. `src/explorer/config.mjs/BUDGETS`를 deep 단일로 단순화하거나, `BUDGETS.quick`/`BUDGETS.normal`을 `BUDGETS.deep`으로 alias(코드 단순화 우선).
3. `chooseAutoBudget()` 함수 본문을 deep 고정 반환으로 단순화 또는 호출부 제거.
4. `getBudgetConfig(label)`는 deep config를 반환하는 단일 호출로 단순화.
5. `src/explorer/runtime.mjs`의 budget 결정 분기 정리(`budgetLabel`/`budgetSource` 결정 코드 제거 또는 'deep' 고정).
6. `buildFailure()`의 budget retry hint에서 budget label 권유 문구 제거.
7. `searchCoverage.summary`/`evidenceQuality.summary`의 budget label 언급 제거 또는 deep 고정.

테스트:
- `tests/runtime.mock.test.mjs`의 `BudgetRetryScopeClient`, `TokenBudgetRepairClient` 등 budget 인자를 명시 사용하던 케이스를 budget 제거 형태로 갱신.
- 신규: `explore_repo({ budget: 'quick', ... })` 호출이 schema validation 단계에서 거부되는지 확인 1개.

### Spec-3 (US3, P3) — envvar 10개 제거 + 010 legacy/auto-session 분기 제거

코드 변경:
1. `src/explorer/config.mjs`에서 다음 helper와 envvar 처리 제거:
   - `legacyDiscoveredTargetsEnabled`, `autoSessionByRepoEnabled`, `extraToolsEnabled`, `exploreToolEnabled`, `exploreV2ToolEnabled`(US1과 중복)
   - `getModelForBudget`의 budget-specific override 부분, `CEREBRAS_MODEL` alias fallback
   - `chooseAutoBudget`의 `CEREBRAS_EXPLORER_AUTO_ROUTE` 분기(이미 budget이 제거되므로 더 강한 의미)
2. `src/explorer/runtime.mjs`의 legacy reference target 승격 분기 코드 제거. 010 `if (useLegacyDiscoveredTargets)` 분기를 그대로 들어낸다.
3. `src/explorer/runtime.mjs/resolveSessionForExplore`의 `autoSessionByRepoEnabled()` 분기 제거. `sessionSource='auto_repo'` 케이스도 동시에 사라짐.
4. `src/explorer/session.mjs/findReusableForRepo` 제거(외부 사용처 없음).
5. `src/mcp/server.mjs/buildToolList`의 `extraToolsEnabled()`/`exploreToolEnabled()` 분기 제거 → 항상 8개 surface.

테스트:
- `tests/session.test.mjs`의 010 신규 케이스(`findReusableForRepo returns most-recent`, `rejects expired and exhausted`) 제거.
- `tests/runtime.mock.test.mjs`의 010 신규 케이스(`AUTO_SESSION_BY_REPO=1 reuses session`, `without opt-in always creates new`, `LEGACY_DISCOVERED_TARGETS=1 restores reference promotion`) 제거.
- `tests/mcp-server.test.mjs`의 `EXTRA_TOOLS=false`/`ENABLE_EXPLORE=false` tool-surface 케이스 정리.

### 통합 단계 (Phase 7)

3개 user story의 코드/테스트가 완료된 뒤:
1. README envvar 표/도구 섹션/decision rule/Security Model 갱신.
2. DESIGN.md §11.4 evidence sufficiency 본문에서 budget 언급, §11.7 session/progress에서 auto_repo 언급 정리.
3. AGENTS.md invariant(`explore_v2` opt-in 언급, 도구 8개 정의) 갱신.
4. CHANGELOG에 011 단일 묶음으로 기록.
5. `integrations/*/README.md`, `*.json.example`에서 제거된 envvar/플래그 제거.
6. `npm test` 전체 회귀 0 failure 확인.
7. `node src/index.mjs` smoke boot.
8. git status로 plan.md "Project Structure"에 명시된 영역 외 변경이 없는지 확인.

## Risks & Mitigations

| 위험 | 시나리오 | 완화 |
|---|---|---|
| 외부 사용자가 여전히 `budget` 입력을 보냄 | parent agent prompt나 manifest에서 `budget: 'quick'` 같은 기본값을 사용 중일 수 있다 | input schema가 unknown key로 명확히 거부 + CHANGELOG에 breaking change 명시. README/integration 예시도 갱신. |
| V1 explore의 일부 fallback 경로 부재로 회귀 | V1만 갖고 있던 특정 token budget 보호 또는 finalize 경로가 사라질 수 있다 | freeExploreV2 회귀 케이스가 V1 시나리오를 충분히 커버하는지 점검. 부족하면 V2 본문에 동일한 보호 로직을 추가하거나 테스트로 가시화. |
| `EXTRA_TOOLS=false`로 도구를 최소화하던 운영자 | 1개 도구만 노출하던 minimal 환경이 8개 surface로 강제 확대된다 | CHANGELOG/README에 명시. 사용자는 별도 MCP gateway에서 도구 필터링하도록 안내. |
| `CEREBRAS_EXPLORER_MODEL_DEEP`로 deep 호출에만 비용 큰 모델을 쓰던 운영자 | 단일 모델로 통일되어 quick 호출에도 동일 모델 비용 발생 가능 | README/CHANGELOG에 명시. 사용자는 별도 server 인스턴스를 띄워 다른 모델 사용 권장. |
| `AUTO_SESSION_BY_REPO=1`을 켜둔 운영자 | 같은 repoRoot의 자동 reuse가 사라져 매번 새 세션 생성, 이전 호출 context 잃음 | README/CHANGELOG에 명시. 사용자는 explicit `session` 전달로 전환 권장. |
| 010 schema additive 약속 위반 우려 | `budget` 키 제거와 `explore_v2` 도구 이름 제거가 strict consumer를 깰 수 있다 | CHANGELOG에서 두 breaking change를 명시적으로 강조 + next minor에서 일괄 처리(010 schema 정책의 의도된 예외)임을 본 spec/plan에 명시. |
| 010에서 만든 진단 신호 회귀 | `_debug.stats.sessionSource='auto_repo'`를 검증하던 코드/문서가 잘못된 기대를 갖게 됨 | 본 작업의 테스트 갱신 task에서 명시적으로 정리. 회귀 게이트는 `npm test`. |

## Test Strategy

- **G1 — User Story별 갱신/신규 테스트**: spec의 acceptance scenarios가 모두 통과.
- **G2 — 전체 `npm test`**: 종료 코드 0, failure 0. skip 수는 환경 의존.
- **G3 — Initialize instructions**: `explore_v2`/`budget`/제거되는 envvar 언급 0건이며, 010 progressToken/control-plane 보존 안내는 유지.
- **R1 — Docs lint (기록 단계, 게이트 아님)**: 제거된 10개 envvar 이름이 README/DESIGN/AGENTS/integration 매니페스트에서 0건(CHANGELOG 회상 예외).

판정 규칙:
- G1, G2, G3 모두 통과해야 머지.
- R1 실패는 docs 후속 PR로 보정 가능.

수동 검증:
- `node src/index.mjs`로 stdio MCP 서버 boot 후 `tools/list` 호출(또는 단순 ping)로 도구 수 8개 확인.
- `explore_repo({ task, budget: 'quick' })` 입력이 schema validation에서 거부되는지 확인.

## Complexity Tracking

본 작업은 Constitution 게이트 위반이 없으므로 비어 있다.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (없음) | (해당 없음) | (해당 없음) |
