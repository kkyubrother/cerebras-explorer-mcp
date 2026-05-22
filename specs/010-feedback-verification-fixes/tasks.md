# Tasks: 피드백 검증 기반 5종 신뢰성 수정

**Input**: Design documents from `./specs/010-feedback-verification-fixes/`

**Prerequisites**: spec.md (필수), plan.md (필수), research.md, data-model.md, contracts/explore-repo-response.md, quickstart.md

**Tests**: Required. 본 작업은 5종 코드 변경을 단일 릴리스에 묶어 도입하며, 각 user story의 acceptance scenario는 신규 unit/통합 테스트로 1:1 검증한다(spec.md "Independent Test"; plan.md "Test Strategy"). 따라서 본 tasks는 test-first(또는 test-with-impl) 원칙을 따른다.

**Organization**: spec.md user story 우선순위 순(P1 → P5)으로 Phase를 구성한다. 각 Phase는 (a) 신규 테스트 추가 → 실패 확인 → (b) 코드 구현 → (c) 회귀 무결 확인 → (d) 해당 user story 한정 문서 업데이트 순으로 진행한다. 단일 변경 묶음을 위한 cross-cutting 문서/CHANGELOG 정리는 마지막 Phase 8에서 통합한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 건드리는 독립 작업이라 병렬 가능
- **[Story]**: US1=Spec-1 상태 계약, US2=Spec-2 targets/discoveredPaths, US3=Spec-3 redaction, US4=Spec-4 scope, US5=Spec-5 session/progress/sub-agent
- 경로는 저장소 루트 기준 상대 경로

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 본 작업은 기존 단일 패키지 ESM 프로젝트에 additive 변경을 도입한다. 신규 의존성/디렉토리 없음. 작업 트리 정합성 확인만 본 phase의 실질 작업이다.

- [x] T001 작업 트리(`src/explorer/`, `src/mcp/`, `tests/`, `README.md`, `DESIGN.md`, `AGENTS.md`, `CHANGELOG.md`)가 clean 상태인지 `git status`로 확인. 본 작업의 수정 영역이 plan.md "Project Structure"에 명시된 파일로 한정되도록 점검. 무관 변경이 섞이지 않게 한다(plan Risks "docs 확산").
- [x] T002 `node --version`이 ≥22인지, `npm test`(전체)가 현재 branch에서 baseline 통과(`exit 0`, failure 수 0)인지 확인. 이후 5개 Spec의 회귀 게이트 비교 기준이 된다(plan Test Strategy G2).

**Checkpoint**: 변경 시작 전 baseline 회귀가 0 failure로 통과함을 확인.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 본 작업의 5개 Spec은 서로 다른 모듈을 손대고 각자 envvar로 isolation되어 있어 별도의 foundational 공유 인프라가 필요하지 않다. 빈 phase를 채우기 위해 가짜 task를 만들지 않는다(plan Constitution Check).

> 본 phase에는 추가 task가 없다. 각 user story는 Phase 1 baseline 위에서 직접 시작한다.

**Checkpoint**: Phase 1 완료 후 곧장 Phase 3으로 진입.

---

## Phase 3: User Story 1 — 상태 계약 재정의 (Priority: P1)

**Goal**: `explore_repo`/wrapper 응답의 `status.complete`/`verification`/`failure.reason`/`nextAction`이 budget 소진이 아니라 evidence sufficiency를 1차 신호로 사용하도록 만든다(FR-001 ~ FR-011, SC-001 ~ SC-002).

**Independent Test**: spec.md US1 acceptance scenarios 4개. 모두 `tests/runtime.mock.test.mjs`에 신규 mock 시나리오로 검증.

### Tests for User Story 1 (Test-first)

- [x] T003 [P] [US1] `tests/runtime.mock.test.mjs`에 acceptance #1 케이스 추가: locate/symbol_trace task + exact grounded evidence 1 + 비어있지 않은 directAnswer + budget 마지막 turn 소진 → `status.complete=true`, `verification ∈ {verified, targeted_read_needed}`, `failure=null`, `searchCoverage.stoppedByBudget=true`. 케이스가 baseline 코드에서 **실패**하는지 먼저 확인.
- [x] T004 [P] [US1] 같은 파일에 acceptance #2 케이스 추가: path_explanation task + exact evidence 1개만 + budget 소진 → `complete=false`, `verification=follow_up_needed`, `failure.reason=budget_exhausted`. baseline에서 변동 없는지/원하는 의미로 동작하는지 확인.
- [x] T005 [P] [US1] 같은 파일에 acceptance #3 케이스 추가: 충분한 evidence 없음 + 모델 nextAction 없음 + `targets[]`에 read/reference 후보 있음 → `nextAction.type='explore_followup'`(기존은 `ask_user`). baseline에서 **실패** 확인.
- [x] T006 [P] [US1] 같은 파일에 acceptance #4 케이스 추가: `critic.status='fail'` 또는 `stats.stoppedByErrors=true` → evidence 수와 무관하게 `verification=broad_search_needed`, `complete=false`. baseline에서 통과해야 함(회귀 보호).

### Implementation for User Story 1

- [x] T007 [US1] `src/explorer/runtime.mjs`에 helper 3개 신규 추가: `getGroundingCounts(result)` (FR-001), `isSimpleCompletionMode({ taskMode, task })` (FR-002), `evaluateEvidenceSufficiency(result, stats, { task, taskMode })` (FR-001 ~ FR-005). reason code는 data-model.md "StatusBlock → _debug.evidenceSufficiency" 표의 enum과 일치시킨다.
- [x] T008 [US1] `src/explorer/runtime.mjs/buildResultStatus(result, stats, { task, taskMode, sufficiency = null } = {})`를 변경: sufficiency가 주어지지 않으면 내부 계산. 결정 로직은 (a) critic fail/stoppedByErrors/stoppedByAbort → `broad_search_needed`, (b) `confidence='low'` → `follow_up_needed`, (c) edit target 있음/edit_planning → sufficient이면 `targeted_read_needed`, (d) critic caution 또는 stoppedByBudget → sufficient이면 `verified`, 아니면 `follow_up_needed` (FR-001, FR-006).
- [x] T009 [US1] `src/explorer/runtime.mjs/buildFailure()` 변경: `stats.stoppedByBudget && result.status?.complete !== true`일 때만 `failure.reason='budget_exhausted'` 생성. complete가 true이면 budget 사실은 `searchCoverage.stoppedByBudget`로만 유지 (FR-006, FR-007).
- [x] T010 [US1] `src/explorer/runtime.mjs/buildResultStatus()`에 budget+sufficient 시 `status.warnings`에 "budget exhausted after sufficient evidence" 낮은 severity 문구 추가 (FR-008).
- [x] T011 [US1] `src/explorer/runtime.mjs/buildNextAction()` 우선순위 재구성: (1) `failure.retry` 있으면 우선, (2) sufficient + no edit needed → `stop`, (3) sufficient + edit/read 필요 → `read_target`, (4) insufficient + cited target 있음 → `explore_followup`(query 채움), (5) 그 외 → `ask_user` (FR-009).
- [x] T012 [US1] `src/explorer/runtime.mjs` 호출부에서 sufficiency를 한 번 계산해 `normalized._debug.evidenceSufficiency`로 보존 + `buildResultStatus()`/`buildFailure()`로 전달 (FR-010).
- [x] T013 [US1] `src/explorer/schemas.mjs` 기존 `STATUS_SCHEMA`/`EXPLORE_REPO_OUTPUT_SCHEMA`가 변경되지 않았는지 확인. additive 정책 유지(FR-011, SC-010). `_debug`는 free object라 schema 변경 없음.
- [x] T014 [US1] T003 ~ T006 신규 케이스가 모두 PASS, `tests/mcp-server.test.mjs:L311-L324`(confidence/evidenceQuality linkage) 회귀 무결 확인.
- [x] T015 [US1] 본 phase 한정 문서 메모: README의 `failure` 설명 단락과 `status.complete` 의미 절을 (Phase 8 통합 문서 패스에 반영하도록) draft 형태로 plan.md Implementation Outline Spec-1에 명시된 변경 영역에 노트 남김.

**Checkpoint**: User Story 1 완료. `npm test` 전체 회귀 0 failure 유지. SC-001/SC-002 충족.

---

## Phase 4: User Story 2 — `targets[]` / `discoveredPaths[]` 분리, report dedupe (Priority: P2)

**Goal**: 응답에 신규 `discoveredPaths[]`를 도입하고 `targets[]`에서 discovery-only path 자동 승격을 제거. report citation target은 file-level merge(FR-012 ~ FR-019, SC-003 ~ SC-004).

**Independent Test**: spec.md US2 acceptance scenarios 4개. mock runtime + repo-tools 단위 + mcp-server structuredContent 회귀로 검증.

### Tests for User Story 2

- [x] T016 [P] [US2] `tests/runtime.mock.test.mjs`에 acceptance #1 케이스 추가: `repo_list_dir`가 `.github`, `.specify/extensions.yml`, `docs/`를 반환 + evidence는 `src/auth.js` 1개 → `targets[]`에 `src/auth.js`만, `discoveredPaths[]`에 listDir 항목 3개(각각 `{path, kind, sourceTool:'repo_list_dir', reason}`). baseline에서 **실패** 확인.
- [x] T017 [P] [US2] `tests/runtime.mock.test.mjs`에 acceptance #2 케이스 추가: report에 `src/a.js:L1-L3`, `src/a.js:L5-L8`, `src/b.js:L2` 세 citation → 결과 `targets`가 2개로 줄고 `src/a.js`는 `startLine=1, endLine=8`로 병합되며 `reason`에 "merged from 2 ranges" 문구. baseline에서 **실패** 확인.
- [x] T018 [P] [US2] `tests/runtime.mock.test.mjs`에 acceptance #3 케이스 추가: `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` 환경 → 기존처럼 `targets[]`에 `role:reference, evidenceRefs:[]` 항목이 들어가는 legacy 동작 유지. envvar off에서는 들어가지 않음.
- [x] T019 [P] [US2] `tests/repo-tools.test.mjs`에 `collectDiscoveredPathsFromToolResult('repo_list_dir', { entries:[{ path:'.github', kind:'dir' }, { path:'docs/x.md', kind:'file' }] })` → `[{ path:'.github', kind:'dir', sourceTool:'repo_list_dir', reason:'Listed during repository discovery.' }, { path:'docs/x.md', kind:'file', ... }]` 케이스 추가. `repo_find_files`/`repo_git_diff`/`repo_git_show`도 데이터 표(data-model.md "DiscoveredPathItem 수집 규칙")대로 매핑 확인.
- [x] T020 [P] [US2] `tests/mcp-server.test.mjs`에 acceptance #4 케이스 추가: 동일 시나리오 응답의 `structuredContent.discoveredPaths`가 redaction 후에도 보존되는지 확인. 또한 `EXPLORE_REPO_OUTPUT_SCHEMA` strict 검증이 통과하는지 함께 확인.
- [x] T021 [P] [US2] `tests/mcp-server.test.mjs:L397-L431` 기존 기대값(report targets 관련) 갱신 — file-level merge 후 기대 구조로 맞춤. baseline에서 기대값 mismatch를 먼저 관찰.

### Implementation for User Story 2

- [x] T022 [US2] `src/explorer/schemas.mjs`에 `DISCOVERED_PATH_SCHEMA` 신규 추가(data-model.md 정의). `EXPLORE_REPO_OUTPUT_SCHEMA.properties`에 `discoveredPaths: { type:'array', items: DISCOVERED_PATH_SCHEMA }`를 additive로 추가(required 미포함). `EXPLORE_RESULT_JSON_SCHEMA`(모델 출력)에는 추가하지 않음 (FR-019).
- [x] T023 [US2] `src/explorer/repo-tools.mjs`에 `collectDiscoveredPathsFromToolResult(toolName, result)` export 신규 추가(data-model.md 수집 규칙 표 기반). 기존 `collectTargetPathsFromToolResult`는 default fallback에서만 호출(`kind:'unknown'`) (FR-014).
- [x] T024 [US2] `src/explorer/config.mjs`에 `legacyDiscoveredTargetsEnabled()` envvar helper 신규 추가. 기본 off (FR-018).
- [x] T025 [US2] `src/explorer/runtime.mjs` import 교체: `collectTargetPathsFromToolResult` → `collectDiscoveredPathsFromToolResult`. `discoveredPaths` 자료구조를 string array → object array로 전환.
- [x] T026 [US2] `src/explorer/runtime.mjs`에 `mergeDiscoveredPaths(existing, next)` 신규 추가. path 기준 dedupe + `unknown` kind 병합 + cap 100 (FR-015).
- [x] T027 [US2] `src/explorer/runtime.mjs/buildTargets({ evidence })` 시그니처 변경(기존 `discoveredPaths` 매개변수 제거). discovered path → reference target 승격 코드 삭제. `legacyDiscoveredTargetsEnabled()`가 true일 때만 1 릴리스 동안 기존 동작 유지(FR-012, FR-018).
- [x] T028 [US2] `src/explorer/runtime.mjs` final result 조립부에서 `normalized.targets = mergeTargets(groundedModelTargets, buildTargets({ evidence: normalized.evidence }))` + `normalized.discoveredPaths = discoveredPaths`로 변경(FR-013).
- [x] T029 [US2] `src/explorer/runtime.mjs/buildReportCitationTargets(citations)`를 file-level merge로 재작성: `startLine`은 `Math.min`, `endLine`은 `Math.max`, `citationCount > 1`이면 `reason`에 "Markdown report citations merged from N ranges." (FR-016, FR-017).
- [x] T030 [US2] `src/mcp/server.mjs/toAgentFacingResult()`에 `discoveredPaths: Array.isArray(result.discoveredPaths) ? result.discoveredPaths : []` 패스스루 추가.
- [x] T031 [US2] T016 ~ T021 신규 케이스 모두 PASS. legacy envvar on/off 양쪽에서 기대 동작 확인. 기존 report citation 관련 테스트가 갱신된 기대값으로 통과하는지 확인.

**Checkpoint**: SC-003(`evidenceRefs.length===0` 자동 항목 0건), SC-004(report citation file-level merge) 충족.

---

## Phase 5: User Story 3 — Redaction 환경변수 이름 보존 (Priority: P3)

**Goal**: snippet/report 문자열의 `process.env.X`/`import.meta.env.X`/`Deno.env.get("X")`를 보존, secret value/secret file path는 그대로 마스킹(FR-020 ~ FR-025, SC-005).

**Independent Test**: spec.md US3 acceptance scenarios 4개. `tests/security/redact.test.mjs` 단위로 검증.

### Tests for User Story 3

- [x] T032 [P] [US3] `tests/security/redact.test.mjs`에 acceptance #1 케이스 추가: `redactText('const key = process.env.CEREBRAS_API_KEY;')` → `text` 변동 없음, `redacted=false`. baseline에서 **실패** 확인.
- [x] T033 [P] [US3] 같은 파일에 acceptance #2 케이스 추가: `redactText('Read \`.env.production:L1-L3\` before debugging.')` → `text`에 `[REDACTED:secret-path]`, `redacted=true`. baseline에서 통과해야 함(회귀 보호).
- [x] T034 [P] [US3] 같은 파일에 acceptance #3 케이스 추가: `redactText('process.env.OPENAI_API_KEY = "sk-proj-aaaa...aaaa";')` → 이름 보존 + 값만 `[REDACTED:openai-api-key]`. baseline에서 **실패** 확인.
- [x] T035 [P] [US3] 같은 파일에 acceptance #4 케이스 추가: `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1` 환경 → 이름까지 마스킹. envvar off에서는 이름 보존(T032 회귀).
- [x] T036 [P] [US3] `tests/security/redact.test.mjs`에 boundary 회귀 케이스 추가: backtick으로 감싼 `` `process.env.X` ``, 쉼표/마침표/콜론/따옴표 인접 형태, Windows path 형태 등 5종 이상.

### Implementation for User Story 3

- [x] T037 [US3] `src/explorer/redact.mjs/SECRET_PATH_MENTION_REGEX`를 token boundary 기반으로 재정의: 앞 boundary `(^|[\s"'\`([{,])`, 뒤 lookahead `(?=$|[\s"'\`\])},.:;])`. `SECRET_PATH_TOKEN`을 별도 const로 분리 (FR-022, FR-025).
- [x] T038 [US3] `src/explorer/redact.mjs`의 replace callback에서 prefix를 보존하도록 변경: `replace(re, (raw, prefix, relPath) => isSecretPath(relPath).matched ? \`${prefix}[REDACTED:secret-path]\` : raw)`.
- [x] T039 [US3] `src/explorer/config.mjs` 또는 `src/explorer/redact.mjs`에 `redactEnvVarNamesEnabled()` envvar helper 추가(기본 off). true일 때만 env var 이름까지 추가 마스킹하는 별도 분기를 redaction 파이프라인에 둠 (FR-024).
- [x] T040 [US3] (선택) `src/explorer/redact.mjs`에 `isEnvVarExpressionContext(text, matchIndex)` helper 추가하여 회귀 안전망 강화. boundary regex만으로 충분하지만 향후 회귀 방지용 optional layer.
- [x] T041 [US3] T032 ~ T036 신규 케이스 모두 PASS, `tests/mcp-server.test.mjs:L474-L501`(secret path citation redaction) 회귀 무결 확인.

**Checkpoint**: SC-005 충족(env var 이름 보존 + secret 값/secret 파일 경로 마스킹 100%).

---

## Phase 6: User Story 4 — `gitDiff`/`gitShow` scope hard boundary 복구 (Priority: P4)

**Goal**: base scope가 있으면 `gitDiff()`/`gitShow()`/`gitDiff({stat:true})` 모두에서 scope 밖 file을 결과에서 제외하고 omitted count를 additive로 노출(FR-026 ~ FR-030, SC-006).

**Independent Test**: spec.md US4 acceptance scenarios 4개. `tests/repo-tools.test.mjs`에 git fixture 기반 케이스 추가.

### Tests for User Story 4

- [x] T042 [P] [US4] `tests/repo-tools.test.mjs`에 acceptance #1 케이스 추가: scope `['docs/**']` + `hello.js` + `docs/README.md` 동시 변경 commit → `gitDiff({from:'HEAD~1', to:'HEAD'})`의 `files`에 `hello.js` 없음, `docs/*`만 있음, `omittedOutOfScopeFiles ≥ 1`. baseline에서 **실패** 확인 (git 가용 환경에서만 실행, 미가용 시 skip).
- [x] T043 [P] [US4] 같은 파일에 acceptance #2 케이스 추가: 동일 setup + `gitDiff({stat:true})` → stat text의 scope 밖 라인 제거, `omittedOutOfScopeFiles` 동봉. baseline에서 **실패** 확인.
- [x] T044 [P] [US4] 같은 파일에 acceptance #3 회귀 케이스 추가: 기존 `gitShow` scope test(`tests/repo-tools.test.mjs:L622-L642`)가 변경 후에도 통과.
- [x] T045 [P] [US4] 같은 파일에 acceptance #4 케이스 추가(통합 성격): `review_change_context` wrapper 호출 결과의 `targets[]`/`discoveredPaths[]`에 scope 밖 path가 없는지 검증.

### Implementation for User Story 4

- [x] T046 [US4] `src/explorer/repo-tools.mjs/_filterGitDiffFiles(files, { enforceScope = true } = {})` 기본값 변경. 반환 객체를 `{ files, omittedOutOfScopeFiles, omittedSecretPaths }`로 확장 (FR-026, FR-030).
- [x] T047 [US4] `src/explorer/repo-tools.mjs/gitDiff()` patch path를 위 객체 인터페이스로 정렬. 0보다 큰 count만 응답 객체에 spread (FR-027).
- [x] T048 [US4] `src/explorer/repo-tools.mjs/gitShow()`도 같은 형태로 정렬(이미 `enforceScope: true`이므로 반환 구조만 통일).
- [x] T049 [US4] `src/explorer/repo-tools.mjs/gitDiff({ stat: true })` 경로에 `filterGitStatByScope(statText, scopeRules)` helper 신규 추가. `^\s*(.+?)\s+\|\s+` 라인 매칭으로 file path 추출 후 scope 검사. 매칭 안 되는 라인(summary, rename/copy 등)은 그대로 통과 (FR-028).
- [x] T050 [US4] stat 응답에 `omittedOutOfScopeFiles`/`omittedSecretPaths`/`redacted`/`redactions` 모두 0/false일 때는 제외, 그 외 spread.
- [x] T051 [US4] `collectDiscoveredPathsFromToolResult('repo_git_diff'/'repo_git_show', result)`가 위 filtered `files`만 보고 path를 모으는지 확인 — Spec-2에서 추가한 함수가 이미 그렇게 동작하므로 scope 밖 file이 자동 차단됨 (FR-029).
- [x] T052 [US4] T042 ~ T045 신규 케이스 모두 PASS (git 가용 환경). git 미가용 환경에서는 skip되지만 게이트 아님(plan Test Strategy G2 정책).

**Checkpoint**: SC-006 충족(scope 밖 path가 결과에 0건 노출, omitted count 동봉).

---

## Phase 7: User Story 5 — Session / Progress / Sub-agent handoff (Priority: P5)

**Goal**: 옵트인 자동 session reuse + heavy 호출의 progressToken 권장 + sub-agent 필수 보존 필드 + wrapper decision rule을 코드/문서로 정착(FR-031 ~ FR-035, SC-007 ~ SC-009).

**Independent Test**: spec.md US5 acceptance scenarios 5개. session 단위 + runtime 통합 + initialize instructions 회귀 + docs grep으로 검증.

### Tests for User Story 5

- [x] T053 [P] [US5] `tests/session.test.mjs`에 `findReusableForRepo()` 3개 케이스 추가: (a) reusable session 반환, (b) TTL 만료 session 미반환, (c) maxCalls 초과 session 미반환. baseline에서 **실패**(method 없음) 확인.
- [x] T054 [P] [US5] `tests/runtime.mock.test.mjs`에 acceptance #1 케이스 추가: `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` + 같은 repoRoot로 explicit session 없이 2회 호출 → 2회차 응답이 `session.status='reused'`, `_debug.stats.sessionSource='auto_repo'`. baseline에서 **실패** 확인.
- [x] T055 [P] [US5] 같은 파일에 acceptance #2 케이스 추가: TTL/maxCalls 초과 session만 남은 같은 repoRoot에서 옵트인 자동 reuse 시도 → 새 session 생성, `sessionStatus='created'`.
- [x] T056 [P] [US5] 같은 파일에 acceptance #3 회귀 케이스 추가: 옵트인 off 기본 환경 → 매번 새 session(`created`). baseline에서 통과(회귀 보호).
- [x] T057 [P] [US5] `tests/mcp-server.test.mjs`의 initialize instructions snapshot에 progressToken/sessionId/structured metadata 보존 안내 문구가 포함되는지 acceptance #5 케이스 추가(FR-035).

### Implementation for User Story 5

- [x] T058 [US5] `src/explorer/session.mjs/SessionStore.findReusableForRepo(repoRoot)` method 신규 추가. 같은 repoRoot의 TTL/maxCalls 통과 session 중 `lastUsedAt`이 가장 큰 것을 `{ ok, session, remainingCalls }`로 반환. 없으면 null (FR-031).
- [x] T059 [US5] `src/explorer/config.mjs/autoSessionByRepoEnabled(env = process.env)` envvar helper 신규 추가(기본 off) (FR-032).
- [x] T060 [US5] `src/explorer/runtime.mjs/resolveSessionForExplore()`에 자동 reuse 분기 추가: explicit `session` 없음 + envvar on + sessionStore가 method 있음 → 자동 reuse, 성공 시 `sessionStatus='reused'`, `sessionSource='auto_repo'` 반환. 실패 시 fall-through to create (FR-032).
- [x] T061 [US5] `src/explorer/runtime.mjs` stats 조립부에서 `sessionSource` 진단 필드를 `_debug.stats.sessionSource`로 노출(`'explicit' | 'created' | 'reused' | 'auto_repo'`). `SESSION_SCHEMA.status` enum은 변경하지 않음(FR-033).
- [x] T062 [US5] `src/mcp/server.mjs`의 MCP initialize instructions 문자열을 검토. 현재 progressToken/sessionId 안내가 있는지 확인하고 누락된 항목(예: "preserve control-plane fields" 안내)이 있으면 추가. T057 acceptance #5와 정합되도록 (FR-035).
- [x] T063 [US5] T053 ~ T057 신규 케이스 모두 PASS, `tests/mcp-server.test.mjs:L347-L395`(session create/fallback) 회귀 무결 확인.

**Checkpoint**: SC-007 충족(옵트인 on/off 동작 확인). docs 변경은 Phase 8에서 통합.

---

## Phase 8: Polish — 통합 문서 패스 + CHANGELOG + Smoke (Cross-Cutting)

**Purpose**: 5개 user story의 코드/테스트가 완료된 뒤 cross-cutting 문서(`README.md`, `DESIGN.md`, `AGENTS.md`), CHANGELOG, manual smoke를 한 번에 통합. plan.md Risks의 "docs 확산" 위험을 막기 위해 본 phase에서만 문서를 일괄 갱신한다.

### Documentation Pass

- [x] T064 [P] [Polish] `./README.md` 갱신:
  - "compact 반환 계약" 절(plan.md "Project Structure")에 `discoveredPaths[]` 신규 필드 설명 추가(US2).
  - "recommended use" 절에 `targets[]`(actionable) vs `discoveredPaths[]`(discovery map) 구분 안내(US2).
  - Security Model 절에 "env var names in code snippets are not redacted by default; secret values and secret file paths are redacted" 추가(US3).
  - Safety Boundary 절에 git-guided review가 scope 밖 파일을 omitted count로만 표시한다는 안내 추가(US4).
  - envvar 표에 `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS`(US2), `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES`(US3), `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`(US5) 3개 추가.
  - Codex/agent instructions 절에 `_meta.progressToken` 권장 + 보존 필드 7개 명시(US5).
  - 공개 MCP 도구 절에 wrapper decision rule(자동화/known symbol/human narrative/opt-in v2) 추가(US5).
  - `failure` 설명 단락에 "budget exhausted가 항상 failure는 아니며 evidence sufficiency 충족 시 `searchCoverage.stoppedByBudget=true`만 남는다" 추가(US1).
  - `status.complete` 의미가 "충분한 grounded evidence 확보"로 재정의됨을 명시(US1).
- [x] T065 [P] [Polish] `./DESIGN.md` 갱신:
  - agent control precedence 절에 evidence sufficiency gate 추가(US1).
  - deterministic critic 절 뒤에 evidence sufficiency decision 추가(US1).
  - return schema 절에 `discoveredPaths[]` 추가(US2).
  - scope hard boundary 절에 "gitDiff/gitShow also filter changed files by base scope" 추가(US4).
  - Session contract 절에 auto session option/risk 추가(US5).
  - Progress 절에 heavy 호출에 progressToken 전달 권장 추가(US5).
- [x] T066 [P] [Polish] `./AGENTS.md` 갱신:
  - sub-agent invariant 1줄 추가: "Sub-agent summaries must preserve control-plane fields: status.verification, status.complete, evidenceQuality, searchCoverage, failure, session/sessionId, critic.warnings." (US5)
  - schema/status 변경 시 README/DESIGN/examples/tests 동시 갱신 규칙 유지 확인.

### CHANGELOG

- [x] T067 [Polish] `./CHANGELOG.md`에 본 plan의 5개 Spec을 단일 변경 묶음으로 기록. `### Changed`/`### Added`로 적절히 분배:
  - Added: `discoveredPaths[]` optional field, `omittedOutOfScopeFiles`/`omittedSecretPaths` optional fields, 3개 신규 envvar.
  - Changed: status contract evidence sufficiency 기반 재정의, report citation target file-level merge, redaction boundary regex, gitDiff/gitShow scope hard boundary.
  - Documentation: wrapper decision rule, sub-agent 보존 필드, progressToken 권장.
  - Migration 안내: 1 릴리스 동안 `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1`로 기존 동작 호환.

### Verification

- [x] T068 [Polish] `npm test` 전체 회귀: 종료 코드 0, failure 수 0. skip 수는 환경 의존이며 게이트 아님(plan Test Strategy G2).
- [x] T069 [Polish] 문서 lint(SC-009): README/DESIGN/AGENTS에 6개 필수 문구(progressToken, control-plane fields, Decision rule, discoveredPaths, env var (preservation), scope hard boundary)가 각각 grep으로 발견되는지 확인.
- [x] T070 [Polish] Manual smoke: `node src/index.mjs`로 stdio MCP 서버 boot 후 1회 explore_repo 호출(또는 단순 ping)로 정상 응답에 `discoveredPaths`(빈 배열이라도) 키가 포함되는지 확인. CTRL+C로 종료.
- [x] T071 [Polish] git status로 변경 파일이 plan.md "Project Structure"에 명시된 영역으로 한정되었는지 셀프 리뷰. 무관 영역(예: `benchmarks/`, `scripts/`, `src/index.mjs`) 변경이 섞이지 않았는지 확인(plan Risks "docs 확산").

**Checkpoint**: SC-008 ~ SC-010 충족. 본 작업 머지 준비 완료.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 즉시 시작. Baseline 회귀 확인이 게이트.
- **Phase 2 (Foundational)**: 비어 있음. Phase 1 이후 곧장 Phase 3.
- **Phase 3 (US1, P1)**: Phase 1 이후 시작. US2~US5와 서로 다른 영역이지만 같은 `src/explorer/runtime.mjs`를 손대므로 직렬 권장(같은 파일 충돌).
- **Phase 4 (US2, P2)**: Phase 3과 같은 `src/explorer/runtime.mjs`/`src/mcp/server.mjs`를 손대므로 Phase 3 완료 후 시작 권장. `src/explorer/schemas.mjs`/`src/explorer/repo-tools.mjs`는 US2 전용.
- **Phase 5 (US3, P3)**: `src/explorer/redact.mjs`/`src/explorer/config.mjs`만 손댐. Phase 3/4와 독립이라 병렬 가능(다른 개발자 또는 같은 개발자 별도 commit).
- **Phase 6 (US4, P4)**: `src/explorer/repo-tools.mjs`를 손대므로 Phase 4 완료 후 권장(`collectDiscoveredPathsFromToolResult` import 추가가 같은 파일 영향). Phase 5와 병렬 가능.
- **Phase 7 (US5, P5)**: `src/explorer/session.mjs`/`src/explorer/config.mjs`/`src/explorer/runtime.mjs`/`src/mcp/server.mjs`를 손댐. `runtime.mjs`/`server.mjs`가 Phase 3, 4와 겹치므로 Phase 3/4 이후 순서 권장.
- **Phase 8 (Polish)**: 모든 user story 완료 후 시작.

### Story Dependencies

- US1 → 같은 `runtime.mjs`를 손대므로 US2/US5보다 먼저.
- US2 → `runtime.mjs`(US1과 충돌), `schemas.mjs`(독립), `repo-tools.mjs`(US4와 충돌 가능), `server.mjs`(US5와 충돌 가능).
- US3 → `redact.mjs`/`config.mjs`만. 독립.
- US4 → `repo-tools.mjs`. US2의 `collectDiscoveredPathsFromToolResult` 변경 이후가 안전.
- US5 → `session.mjs`/`config.mjs`/`runtime.mjs`/`server.mjs`. US1/US2 이후.

### Within Each User Story

- 테스트 추가 → baseline에서 실패/통과 확인 → 코드 변경 → 케이스 PASS → 회귀 무결 확인 → 다음 task.
- `[P]` 표시된 테스트는 다른 파일을 손대므로 병렬 가능.
- 실패해야 할 케이스가 baseline에서 통과한다면 케이스 설계를 재검토.

### Parallel Opportunities

- 테스트 추가 task(`[P]`)는 동일 파일이라도 서로 다른 `test()` 블록이라 작성 자체는 병렬. 단, 한 파일을 동시에 편집하면 merge 충돌 가능 → 한 사람이 한 파일을 한 번에 처리.
- US3(Phase 5)는 다른 모든 story와 독립이라 별도 개발자에게 위임 가능.
- T064/T065/T066(Polish 문서)은 서로 다른 파일이라 병렬 가능.

---

## Implementation Strategy

### MVP First (User Story 1 + 2)

1. Phase 1 baseline 확인
2. Phase 3 (US1, P1) — 상태 계약 재정의
3. Phase 4 (US2, P2) — discoveredPaths 분리
4. **STOP and VALIDATE**: `npm test` + spec.md US1/US2 acceptance scenarios 통과
5. 본 두 user story만으로도 parent automation 신뢰성의 핵심 회복 효과(MVP)

### Incremental Delivery

1. MVP 완료(US1 + US2) → 별도 커밋/PR
2. US3 redaction → 별도 커밋
3. US4 scope hard boundary → 별도 커밋
4. US5 session/progress/sub-agent → 별도 커밋
5. Phase 8 통합 문서 + CHANGELOG → 마지막 커밋

단, 본 spec은 5개를 단일 릴리스 묶음으로 정의하므로 최종 머지는 5개 모두 완료된 시점.

### Parallel Team Strategy

- Developer A: US1 + US2 (runtime.mjs 중심)
- Developer B: US3 (redact.mjs/config.mjs)
- Developer C: US4 (repo-tools.mjs)
- Developer D: US5 + Phase 8 통합 문서 (session.mjs + docs)

Phase 8은 모든 user story 완료 후 단일 PR로 통합.

---

## Notes

- `[P]` tasks = 다른 파일을 손대므로 병렬 작성 가능. 같은 파일 동시 편집은 피한다.
- `[Story]` 라벨로 traceability 유지. 각 task는 spec.md FR-### 또는 plan.md Implementation Outline 단락과 1:1 매핑.
- 실패해야 할 테스트는 baseline에서 실제로 실패하는지 먼저 확인(test-first 무결성).
- task 단위 또는 user story 단위로 commit. `git commit -m "feat(spec-1): evidence sufficiency-based status contract (T007-T014)"` 식.
- 각 checkpoint에서 stop 가능. user story가 끝날 때마다 `npm test`로 회귀 확인.
- 회피: 모호한 task, 같은 파일 동시 편집, 다른 user story로 분리된 변경의 cross-cutting commit.
