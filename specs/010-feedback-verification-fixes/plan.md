# Implementation Plan: 피드백 검증 기반 5종 신뢰성 수정

**Branch**: `010-feedback-verification-fixes` | **Date**: 2026-05-22 | **Spec**: ./specs/010-feedback-verification-fixes/spec.md

**Input**: Feature specification from `./specs/010-feedback-verification-fixes/spec.md`

**Origin**: RAW.md — 16 external feedback claims에 대한 Phase 1~6 검증·우선순위·구현 명세

## Summary

본 작업은 외부 피드백 4종(Codex 3종 + Claude Code 1종, 총 16 클레임)을 코드 기준으로 재검증한 결과(참 7, 부분참 8, 거짓 0, 검증불가 1)에서 도출된 **5개 신뢰성 수정**을 단일 릴리스에 묶어 도입한다. 변경의 중심은 `src/explorer/runtime.mjs`의 상태 계약 재정의(Spec-1), `src/explorer/repo-tools.mjs`/`runtime.mjs`/`schemas.mjs`의 `targets[]`/`discoveredPaths[]` 분리(Spec-2), `src/explorer/redact.mjs`의 token boundary 보정(Spec-3), `src/explorer/repo-tools.mjs`의 `gitDiff` scope hard boundary 복구(Spec-4), `src/explorer/session.mjs`/`config.mjs`/`runtime.mjs`와 README/DESIGN/AGENTS 문서의 session·progress·sub-agent handoff 강화(Spec-5)다.

기술 접근:
- **계약은 additive only**. 모든 schema 변경은 신규 optional field 추가에 한정하고 기존 enum/required는 손대지 않는다(SC-010).
- **모든 동작 변경은 envvar로 보호**. `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS`(Spec-2), `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES`(Spec-3), `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`(Spec-5)로 1 릴리스 migration window를 확보한다.
- **각 Spec은 독립 검증 가능**. mock runtime / repo-tools 단위 테스트 / redaction unit 테스트로 user story별 acceptance scenario를 분리 검증한다(spec.md "Independent Test" 참조).
- **문서 회귀 금지**. README/DESIGN/AGENTS는 본 plan이 다룬 5개 영역만 손대고 그 외 문구(read-only annotation, redaction policy, install snippet 등)는 변경하지 않는다.

## Technical Context

**Language/Version**: Node.js ≥22 (package.json `engines.node`). ESM modules (`"type": "module"`). 본 작업은 신규 런타임 의존성을 추가하지 않는다.

**Primary Dependencies**: 기존 MCP stdio 서버 인프라(`src/mcp/server.mjs`), `ExplorerRuntime`(`src/explorer/runtime.mjs`), `RepoToolkit`(`src/explorer/repo-tools.mjs`), `SessionStore`(`src/explorer/session.mjs`), `redactText`/`redactValue`(`src/explorer/redact.mjs`), `globalRepoCache`(`src/explorer/cache.mjs`). 신규 외부 패키지 없음.

**Storage**: 해당 없음. session은 in-memory `Map`, repo cache는 LRU in-memory.

**Testing**: 저장소 표준 `node --test`(`npm test`). 본 작업은 (a) `tests/runtime.mock.test.mjs`, (b) `tests/repo-tools.test.mjs`, (c) `tests/security/redact.test.mjs`, (d) `tests/session.test.mjs`, (e) `tests/mcp-server.test.mjs`에 신규 단위/통합 케이스를 추가한다. 신규 의존성 없이 mock-based runtime 시나리오로 acceptance 검증.

**Target Platform**: 로컬 개발자/운영자 머신(Windows, macOS, Linux)에서 stdio MCP 서버로 실행. Windows 환경에서 `git` 미가용 시 일부 git-related test는 skip되며, 이는 본 작업의 게이트가 아니다.

**Project Type**: Single-package Node.js MCP 서버. 본 작업은 `src/`, `tests/`, `README.md`, `DESIGN.md`, `AGENTS.md`를 수정 대상으로 한다. CLI 표면(`src/index.mjs`)은 변경 없음.

**Performance Goals**: 본 작업은 신뢰성 fix이며 성능 목표를 추가하지 않는다. 단, `evaluateEvidenceSufficiency()`/`collectDiscoveredPathsFromToolResult()`/redaction regex 변경이 기존 호출당 latency를 의미 있게 증가시키지 않아야 한다(O(evidence + discoveredPaths) 선형, regex는 token boundary 추가 외 단계 증가 없음).

**Constraints**:
- 신규 외부 도구/필드/환경변수의 **계약**은 모두 additive이며 기존 strict consumer를 깨지 않는다(SC-010).
- legacy 호환은 단일 릴리스 window 동안 envvar로만 제공된다.
- `EXPLORE_REPO_OUTPUT_SCHEMA`의 기존 `required`/enum은 변경하지 않는다.
- `SESSION_SCHEMA.status` enum은 변경하지 않는다(자동 reuse도 `reused`로 표시, 구분은 `_debug.stats.sessionSource`).
- 본 작업은 신규 도구 추가 또는 기존 도구 제거를 포함하지 않는다. 도구 surface(기본 8개, 최소 1개, 최대 9개)는 그대로 유지.

**Scale/Scope**: 변경 대상 코드 파일 ~7개(`runtime.mjs`, `schemas.mjs`, `repo-tools.mjs`, `redact.mjs`, `session.mjs`, `config.mjs`, `mcp/server.mjs`), 문서 4개(`README.md`, `DESIGN.md`, `AGENTS.md`, `CHANGELOG.md`), 테스트 5개 파일에 케이스 추가. 신규 schema 1개(`DISCOVERED_PATH_SCHEMA`), 신규 envvar 3개(legacy/redact/auto-session 모두 기본 off).

## Constitution Check

본 저장소의 `./.specify/memory/constitution.md`는 placeholder 상태이므로, 본 plan은 저장소가 일관적으로 운영해온 invariant를 자체 게이트로 채택한다.

- **Read-only repo toolkit 회귀 없음**: 본 작업은 신규 write 동작 또는 path 검증 약화를 도입하지 않는다. `_filterGitDiffFiles()` 기본값 변경은 보안 강화 방향(scope hard boundary 복구)이라 read-only/boundary 정책과 충돌하지 않는다.
- **외부 계약 안정성**: schema 변경은 모두 additive이며 기존 strict consumer가 `discoveredPaths`/`omittedOutOfScopeFiles` 등 신규 optional field를 무시해도 안전하다. `SESSION_SCHEMA.status` enum 미변경.
- **Secret deny-list 정책**: redaction 보정은 `process.env.X` 식별자만 보존하고 secret value/secret path는 기존대로 마스킹한다. 강한 마스킹이 필요한 조직은 `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1` 옵트인.
- **테스트 게이트**: 신규 5개 단위/통합 케이스 + 기존 `npm test` 회귀 0 failure가 본 작업의 머지 게이트다.
- **추적성**: CHANGELOG에 본 plan의 5개 Spec을 하나의 변경 묶음으로 기록한다.

Constitution 게이트 위반 사항 없음. `Complexity Tracking` 항목은 비어 있다.

## Project Structure

### Documentation (this feature)

```text
specs/010-feedback-verification-fixes/
├── spec.md                # 입력 (이미 작성)
├── plan.md                # 본 문서
├── research.md            # Phase 0: 대안 비교 및 결정 근거
├── data-model.md          # Phase 1: schema diff 및 신규 entity 정의
├── contracts/
│   └── explore-repo-response.md  # additive 응답 contract 변경 요약
├── quickstart.md          # 5개 Spec별 수동 검증 절차
└── tasks.md               # /speckit-tasks 산출물 (이 plan에서는 생성하지 않음)
```

### Repository Layout (touched files)

```text
src/explorer/runtime.mjs       # Spec-1: evidence sufficiency, buildResultStatus/Failure/NextAction
                                # Spec-2: discoveredPaths 분리, buildTargets 변경, report dedupe
                                # Spec-5: resolveSessionForExplore 자동 reuse 분기
src/explorer/schemas.mjs       # Spec-2: DISCOVERED_PATH_SCHEMA 추가, OUTPUT_SCHEMA additive
src/explorer/repo-tools.mjs    # Spec-2: collectDiscoveredPathsFromToolResult
                                # Spec-4: _filterGitDiffFiles 기본 enforceScope, gitDiff/gitShow/stat 보정
src/explorer/redact.mjs        # Spec-3: SECRET_PATH_MENTION_REGEX boundary, env var preservation
src/explorer/session.mjs       # Spec-5: findReusableForRepo
src/explorer/config.mjs        # Spec-5: autoSessionByRepoEnabled
                                # Spec-2: legacyDiscoveredTargetsEnabled (해당 위치 또는 redact 인접)
src/mcp/server.mjs             # Spec-2: toAgentFacingResult에 discoveredPaths 패스스루
                                # Spec-5: initialize instructions 유지/보강

tests/runtime.mock.test.mjs    # Spec-1, Spec-2, Spec-5 acceptance 시나리오
tests/repo-tools.test.mjs      # Spec-2 collectDiscoveredPathsFromToolResult, Spec-4 scope filtering
tests/security/redact.test.mjs # Spec-3 env var preservation, secret path 회귀
tests/session.test.mjs         # Spec-5 findReusableForRepo
tests/mcp-server.test.mjs      # Spec-2 discoveredPaths in structuredContent, Spec-5 instructions

README.md                       # Spec-2: discoveredPaths 설명
                                # Spec-3: env var 보존 정책
                                # Spec-4: gitDiff/gitShow scope hard boundary 명시
                                # Spec-5: progressToken 권장, sub-agent 보존 필드, wrapper decision rule
                                # Spec-5: 신규 envvar 3개 docs
DESIGN.md                       # Spec-1: agent control precedence에 sufficiency gate
                                # Spec-2: return schema에 discoveredPaths
                                # Spec-4: scope hard boundary 절에 gitDiff/gitShow 포함
                                # Spec-5: session contract, progress section 보강
AGENTS.md                       # Spec-5: sub-agent invariant 추가
CHANGELOG.md                    # 본 plan의 5개 Spec을 단일 변경 묶음으로 기록
```

**Structure Decision**: 단일 패키지 ESM 프로젝트 구조 그대로 유지. 새 모듈을 만들지 않고 기존 모듈에 함수를 추가하거나 분기를 보강하는 방식이다. 5개 Spec은 같은 `src/explorer/` 트리에 영향을 주지만 각각 호출 경로가 분리되어 있어 독립 테스트 가능하다.

## Implementation Outline

본 작업은 5개 Spec을 user story 우선순위 순(P1 → P5)으로 진행한다. 각 Spec은 (a) 코드 변경, (b) 테스트 추가, (c) 문서 갱신으로 구성된다. 모든 Spec이 코드/테스트까지 완료된 뒤 문서 한 묶음을 마지막 단계로 통합한다.

### Spec-1 — 상태 계약 재정의 (P1, FR-001 ~ FR-011)

코드 변경 핵심:
1. `src/explorer/runtime.mjs`에 신규 helper 3개 추가
   - `getGroundingCounts(result)` → `{ exactCount, partialCount, fileCount }`
   - `isSimpleCompletionMode({ taskMode, task })` → locate/symbol_trace + 자연어 패턴 판정
   - `evaluateEvidenceSufficiency(result, stats, { task, taskMode })` → task별 sufficiency 판정 (`simple_task_exact_evidence` / `path_has_multi_step_evidence` / `edit_plan_has_actionable_target` / `claim_has_grounded_evidence` / `general_multi_evidence` 등 reason code 반환)
2. `buildResultStatus(result, stats, { task, taskMode, sufficiency = null })` 시그니처/로직 변경. `stats.stoppedByBudget` 단독으로 `verification='follow_up_needed'`를 강제하지 않고 sufficiency 결과를 함께 본다.
3. `buildFailure()`에서 `stats.stoppedByBudget && result.status?.complete !== true`일 때만 `failure.reason='budget_exhausted'`를 생성.
4. `buildNextAction()`에서 `follow_up_needed`/`broad_search_needed`일 때 cited target이 있으면 `explore_followup`을 우선, 없을 때만 `ask_user`.
5. 호출부에서 sufficiency를 한 번 계산해 `_debug.evidenceSufficiency`로 보존 + `buildResultStatus`로 전달.

테스트:
- `tests/runtime.mock.test.mjs`에 (a) locate task + exact evidence 1 + budget exhausted → `complete:true`, (b) path_explanation + exact 1 + budget exhausted → `complete:false`, `failure.reason:budget_exhausted`, (c) follow_up_needed에서 read/reference target 있음 → `explore_followup` next action, (d) critic fail → `broad_search_needed` 강제 시나리오 추가.
- `tests/mcp-server.test.mjs:L311-L324`(confidence/evidenceQuality linkage) 회귀 무결 확인.

### Spec-2 — `targets[]` / `discoveredPaths[]` 분리, report dedupe (P2, FR-012 ~ FR-019)

코드 변경 핵심:
1. `src/explorer/schemas.mjs`에 `DISCOVERED_PATH_SCHEMA` 추가, `EXPLORE_REPO_OUTPUT_SCHEMA.properties`에 `discoveredPaths` 항목 추가(required 미포함, additive). `EXPLORE_RESULT_JSON_SCHEMA`(모델 출력) 미변경.
2. `src/explorer/repo-tools.mjs`에 `collectDiscoveredPathsFromToolResult(toolName, result)` 신규 export. `repo_list_dir`/`repo_find_files`/`repo_git_diff`/`repo_git_show` 별로 `{ path, kind, sourceTool, reason }` 매핑.
3. `src/explorer/runtime.mjs`에서 기존 `collectTargetPathsFromToolResult` import를 `collectDiscoveredPathsFromToolResult`로 교체. `discoveredPaths` 자료구조를 string array → object array로 전환. 신규 `mergeDiscoveredPaths()` 함수로 path 기준 dedupe + kind 병합, cap 100.
4. `buildTargets({ evidence })` 시그니처 변경. discovered path 승격 로직 제거.
5. `legacyDiscoveredTargetsEnabled()` envvar helper 추가. `true`이면 기존 reference target 승격 로직 1 릴리스 동안 유지.
6. `src/mcp/server.mjs`의 `toAgentFacingResult()`에 `discoveredPaths: Array.isArray(result.discoveredPaths) ? result.discoveredPaths : []` 패스스루 추가.
7. `src/explorer/runtime.mjs`의 `buildReportCitationTargets(citations)`를 file-level merge로 재작성: `startLine` 최소, `endLine` 최대, `citationCount > 1`이면 reason에 "Markdown report citations merged from N ranges." 명시.

테스트:
- `tests/runtime.mock.test.mjs`: listDir에 `.github`, `.specify` 항목 + evidence는 `src/auth.js` 1개 → `targets[]`에 `src/auth.js`만, `discoveredPaths[]`에 listDir 항목 (FR-012, FR-014).
- `tests/repo-tools.test.mjs`: `collectDiscoveredPathsFromToolResult('repo_list_dir', { entries:[{path:'.github', kind:'dir'}] })` → `{ path:'.github', kind:'dir', sourceTool:'repo_list_dir' }`.
- `tests/mcp-server.test.mjs`: `structuredContent.discoveredPaths`가 redaction 후에도 존재.
- report dedupe: 동일 파일 3 citation → file-level 1 target, range 병합.
- legacy envvar: `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` → 기존 동작 유지 확인.
- 기존 `tests/mcp-server.test.mjs:L397-L431` 기대값 갱신.

### Spec-3 — Redaction 환경변수 이름 보존 (P3, FR-020 ~ FR-025)

코드 변경 핵심:
1. `src/explorer/redact.mjs`의 `SECRET_PATH_MENTION_REGEX`를 word boundary 기반으로 재정의. 앞뒤 token boundary(`\s`, `"`, `'`, ``` ` ```, `(`, `[`, `{`, `,`, `.`, `:`, `;`, `]`, `)`, `}`)를 명시적으로 잡고 replacement에서 prefix를 보존.
2. (선택) `isEnvVarExpressionContext(text, matchIndex)` helper로 회귀 방지(`process.env.X`/`import.meta.env.X` 컨텍스트 추가 검사).
3. `redactEnvVarNamesEnabled()` envvar helper 추가. `true`이면 env var 이름까지 추가 마스킹(기본 off).

테스트:
- `tests/security/redact.test.mjs`에 3개 신규 케이스(FR-020/FR-021/FR-022 acceptance scenario 그대로) 추가.
- `tests/mcp-server.test.mjs:L474-L501` secret path citation redaction 회귀 무결 확인.
- backtick + path mention + Windows path 경계 회귀 케이스 추가.

### Spec-4 — `scope` hard boundary 복구 (P4, FR-026 ~ FR-030)

코드 변경 핵심:
1. `src/explorer/repo-tools.mjs`의 `_filterGitDiffFiles()` 기본값을 `enforceScope: true`로 변경. 반환을 `{ files, omittedOutOfScopeFiles, omittedSecretPaths }` 객체로 확장.
2. `gitDiff()` patch path가 위 객체를 받아 `files`/optional counts를 응답에 패스스루.
3. `gitDiff({ stat: true })` 경로에 신규 helper `filterGitStatByScope(statText, scopeRules)` 도입. 라인 단위로 scope 밖 path 제거, count 누적, redaction 적용.
4. `gitShow()`는 이미 `enforceScope: true`이므로 반환 구조만 정렬.

테스트:
- `tests/repo-tools.test.mjs`에 `RepoToolkit gitDiff filters changed files to current scope` 케이스 추가(scope `['docs/**']`, commit이 `hello.js` + `docs/README.md` 모두 변경, 기대: `files`에 `hello.js` 없음, `omittedOutOfScopeFiles>0`).
- `gitDiff({stat:true})` scope 필터링 케이스 추가.
- 기존 `gitShow` scope test(`tests/repo-tools.test.mjs:L622-L642`) 무결 확인.

### Spec-5 — Session / Progress / Sub-agent 운영 계약 (P5, FR-031 ~ FR-035)

코드 변경 핵심:
1. `src/explorer/session.mjs`에 `findReusableForRepo(repoRoot)` 추가. TTL/maxCalls 통과 후 가장 최근 reusable session 반환.
2. `src/explorer/config.mjs`에 `autoSessionByRepoEnabled(env = process.env)` 추가(기본 off).
3. `src/explorer/runtime.mjs`의 `resolveSessionForExplore()`에서 explicit session이 없을 때 위 envvar가 켜져 있고 sessionStore가 method를 가지면 자동 reuse 시도. 성공 시 `sessionStatus='reused'`, `sessionSource='auto_repo'`로 표시.
4. `stats.sessionSource` 진단 필드 추가(`_debug.stats`로 노출).

문서 변경 핵심:
- `README.md`: envvar 표에 `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO` 추가; Codex agent instructions 절에 progressToken 권장 + 보존 필드 목록(`status.verification`, `status.complete`, `evidenceQuality`, `searchCoverage`, `failure`, `session/sessionId`, `critic.warnings`); 공개 도구 절에 wrapper decision rule(자동화/known symbol/human narrative/opt-in v2).
- `DESIGN.md`: Session contract 절에 auto session option/risk; Progress 절에 parent agent가 heavy 호출에 progressToken 전달 권장.
- `AGENTS.md`: sub-agent invariant 한 줄 추가 — "Sub-agent summaries must preserve control-plane fields: status, evidenceQuality, searchCoverage, failure, session/sessionId, critic warnings."

테스트:
- `tests/session.test.mjs`에 `findReusableForRepo()` reusable/expired/exhausted 케이스 3개 추가.
- `tests/runtime.mock.test.mjs`에 `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 시나리오 2개(reuse / fall-through to create).
- `tests/mcp-server.test.mjs`의 initialize instructions 문자열에 progressToken/sessionId 안내 유지(snapshot 갱신).
- README/AGENTS docs lint: 필수 문구 5개(progressToken 권장, sub-agent 보존 필드, wrapper decision rule, discoveredPaths 설명, env var 보존 정책) grep 검사 + 본 plan의 spec.md SC-009와 1:1 매핑.

### 통합 단계

5개 Spec의 코드/테스트가 모두 통과한 뒤 다음을 수행:
1. CHANGELOG에 단일 변경 묶음으로 기록(5개 Spec, 3개 신규 envvar, additive schema).
2. `npm test` 전체 회귀 0 failure 확인.
3. `node src/index.mjs`로 stdio 서버가 정상 boot되는지 manual smoke 1회.
4. README/DESIGN/AGENTS 변경이 본 plan의 5개 영역으로 한정되었는지 git diff로 셀프 리뷰.

## Risks & Mitigations

| 위험 | 발생 시나리오 | 완화 |
|---|---|---|
| Strict schema consumer 회귀 | `discoveredPaths`/`omittedOutOfScopeFiles` 신규 필드를 unknown property로 거부하는 consumer가 있을 수 있다. | 모든 신규 필드는 optional이며 `EXPLORE_REPO_OUTPUT_SCHEMA`의 `additionalProperties`를 false로 강제하지 않는다(현재 schema 정책 유지). CHANGELOG와 README에 additive임을 명시. |
| Parent agent가 `targets[].evidenceRefs.length===0` 항목에 의존 | 기존 consumer가 reference target을 broad follow-up 대상으로 사용 중이라면 Spec-2 이후 동작이 변한다. | 1 릴리스 동안 `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` 옵트인으로 기존 동작 유지. README/AGENTS migration 안내 문구 추가. |
| Redaction boundary regex 회귀 | 새 regex가 Windows path, 따옴표 조합, 다국어 식별자 등에서 다르게 동작할 수 있다. | redaction test matrix 확장(backtick, comma, period, colon, single/double quote, Windows path, secret path standalone). 기존 secret path citation 테스트(`tests/mcp-server.test.mjs:L474-L501`) 무결 확인. |
| 자동 session reuse가 multi-client에서 의도치 않은 state 공유 | 같은 MCP server를 여러 client가 공유할 때 repoRoot 일치만으로 session이 재사용되면 conversation 격리가 깨질 수 있다. | 기본 off, README envvar 설명에 multi-client에서는 explicit session 권장 명시. session.status enum은 변경하지 않고 진단은 `_debug.stats.sessionSource`로만 노출. |
| Budget exhaustion completion false-positive | "충분한 evidence"가 task별 heuristic이라 일부 복잡 task에서 잘못 `complete:true`가 될 수 있다. | path_explanation/edit_planning/evidence_verification에 더 높은 기준 적용(spec FR-003/FR-004/FR-005). critic fail/abort는 evidence 수와 무관하게 `broad_search_needed`로 유지(spec acceptance #4). 추가 시나리오는 본 plan의 Risk 로그에 보관하고 후속 spec에서 negative finding 임계 별도 정의. |
| docs 변경이 본 plan 외 영역으로 확산 | 단일 PR에서 무관한 README/DESIGN 문구를 함께 손대면 회귀 추적이 어려워진다. | 본 plan의 Implementation Outline에 명시한 위치만 손대고 다른 문구는 회귀 금지 정책을 유지. CHANGELOG는 본 plan의 5개 Spec만 묶음으로 기록. |
| `git diff --stat` parsing이 rename/copy에서 실패 | stat path parsing이 `old => new` 라인이나 truncation에 취약하면 scope filter가 잘못 동작한다. | filterGitStatByScope는 `^\s*(.+?)\s+\|\s+` 기준으로 file name segment를 추출하고 매칭되지 않는 라인은 그대로 통과시킨다(summary line 보존). rename/copy 케이스는 후속 보강 대상으로 Risk에 기록. |

## Test Strategy

본 작업의 "테스트"는 신규 unit/통합 케이스 + 기존 회귀 무결을 모두 게이트로 사용한다.

게이트 정의:

- **G1 — Spec별 신규 unit/통합 케이스**: 각 Spec의 acceptance scenario를 1:1 매핑한 케이스가 모두 통과한다. 실패 시 해당 Spec의 코드/테스트를 함께 보정한다.
- **G2 — 전체 `npm test`**: 종료 코드 0, failure 수 0. skip 수는 환경(Windows/git 가용성) 의존이며 게이트가 아니다. 변경된 기대값(`tests/mcp-server.test.mjs:L397-L431`, report citation linkage 등)은 본 plan의 acceptance scenario에 정합하도록 갱신한다.
- **G3 — Initialize instructions 무결**: MCP `initialize` 응답의 instructions 문자열에 progressToken/sessionId/structured metadata 보존 안내 문구가 계속 포함된다.
- **R1 — Docs lint (기록 단계, 게이트 아님)**: README/DESIGN/AGENTS에 spec.md SC-009의 5개 필수 문구가 grep으로 발견된다. 본 단계는 docs PR description 또는 동등 머지 기록에 결과를 남긴다.

판정 규칙:
- G1, G2, G3 모두 통과 시에만 `master` 머지.
- G1이 실패하면 해당 Spec의 helper 함수 또는 envvar 분기를 우선 의심하고 fix. 다른 Spec은 영향받지 않으므로 부분 머지 가능(단, 본 plan은 5개를 하나의 변경 묶음으로 릴리스).
- R1이 실패하면 docs 갱신을 다시 작업하지만 코드 머지는 별도 진행 가능(docs는 회귀 시 다음 PR에서 보강).

수동 검증:
- `node src/index.mjs`로 stdio MCP 서버 boot 후 1회 explore_repo 호출로 응답에 `discoveredPaths[]`가 포함되는지 확인.
- `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1`로 환경변수 켠 뒤 두 번 호출, `session.status` 변화 확인.

## Complexity Tracking

본 작업은 Constitution 게이트 위반이 없으므로 본 섹션은 비어 있다.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (없음) | (해당 없음) | (해당 없음) |
