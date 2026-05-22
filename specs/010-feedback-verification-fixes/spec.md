# Feature Specification: 피드백 검증 기반 5종 신뢰성 수정

**Feature Branch**: `010-feedback-verification-fixes`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description: "RAW.md — Cerebras Explorer MCP 피드백 검증 및 수정 구현 명세서. 외부 피드백 16개 클레임을 검증해 참 7, 부분참 8, 거짓 0, 검증불가 1로 판정한 뒤, 5개 신뢰성 수정 묶음(상태 계약 재정의 / targets·discoveredPaths 분리 / redaction 보정 / scope hard boundary 복구 / session·progress·sub-agent handoff 강화)을 단일 릴리스로 묶어 도입한다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 상태 계약을 evidence sufficiency 기준으로 재정의 (Priority: P1)

Parent agent가 `explore_repo`(및 6개 wrapper)를 자동화 루프에서 호출할 때, "충분히 답한 결과"인지 "더 탐색이 필요한 결과"인지를 한눈에 판단하고 싶다. 현재는 budget을 다 써서 loop가 종료되면 evidence가 충분해도 `complete:false`, `nextAction:ask_user`, `failure.reason:budget_exhausted`가 함께 붙어 불필요한 재호출과 사용자 질문을 유발한다. 새 계약은 "turn budget을 다 썼는가"가 아니라 "task에 비추어 grounded evidence가 충분한가"를 1차 신호로 사용한다.

**Why this priority**: parent automation 신뢰성의 핵심이다. `status`, `complete`, `nextAction`, `failure`는 외부 agent가 다음 행동을 분기하는 control-plane 필드라, 여기서 잘못된 신호가 나오면 다른 모든 수정의 효과가 희석된다. RAW.md C1·C3·C7·C13이 모두 이 한 가지 원인 계열이다.

**Independent Test**: 단일 symbol locate task (예: `trace_symbol`)에 대해 exact evidence 1개와 directAnswer가 있고 budget이 정확히 소진되도록 finalize되는 mock 시나리오를 실행했을 때, 응답이 `verification:verified`, `complete:true`, `failure:null`, `searchCoverage.stoppedByBudget:true`로 일관되게 나오는지를 확인하는 것만으로 완결적으로 검증할 수 있다.

**Acceptance Scenarios**:

1. **Given** locate/symbol_trace task에 exact grounded evidence 1개와 비어있지 않은 directAnswer가 있고 budget이 마지막 turn에서 소진된 상태, **When** `explore_repo`가 결과를 조립할 때, **Then** `status.complete=true`, `status.verification=verified` 또는 `targeted_read_needed`, `failure=null`, `searchCoverage.stoppedByBudget=true`가 함께 반환된다.
2. **Given** path_explanation task에 exact evidence 1개만 있고 budget이 소진된 상태, **When** 결과가 조립될 때, **Then** `status.complete=false`, `verification=follow_up_needed`, `failure.reason=budget_exhausted`로 반환되어 "복합 task는 더 높은 기준"이 적용된다.
3. **Given** 충분한 evidence가 없고 모델 nextAction도 없는 상태에서 `targets[]`에 read/reference 후보가 있음, **When** `buildNextAction()`이 실행될 때, **Then** `ask_user` 대신 `explore_followup`이 cited target을 가리키며 반환된다.
4. **Given** critic fail 또는 stoppedByErrors가 true인 상태, **When** 결과가 조립될 때, **Then** evidence 수와 무관하게 `verification=broad_search_needed`, `complete=false`로 유지된다.

---

### User Story 2 - actionable targets와 discovery 노이즈 분리 (Priority: P2)

Parent agent와 사용자가 `targets[]`를 "지금 읽거나 편집해야 할 핵심 대상"으로 신뢰할 수 있도록, `repo_list_dir`/`repo_find_files`/`git_diff` 등으로 발견된 path는 별도 `discoveredPaths[]`로 분리한다. 또한 `explore`/`explore_v2` Markdown report의 citation target이 같은 파일에 대해 여러 항목으로 부풀어 오르는 현상을 file-level merge로 정리한다.

**Why this priority**: 자동화 routing 품질에 직결되는 signal/noise 문제다. RAW.md의 Claude Code 최우선 fix 1번과 일치하고(C9·C10·C15), parent가 잘못된 reference target을 따라가서 budget을 낭비하는 회귀를 막는다.

**Independent Test**: 모델이 `repo_list_dir`로 `.github`, `.specify` 같은 항목을 발견하고 evidence는 `src/auth.js` 1개만 남기는 mock 시나리오에서, 응답의 `targets[]`에 `src/auth.js`만 있고 `discoveredPaths[]`에 listDir 항목이 들어가는지 확인하면 완결 검증된다. Report dedupe는 동일 파일 여러 line range citation이 file-level로 병합되는지로 검증한다.

**Acceptance Scenarios**:

1. **Given** `repo_list_dir`가 `.github`, `.specify/extensions.yml`, `docs/` 등을 반환했지만 evidence에는 `src/auth.js`만 있는 상태, **When** 결과가 조립될 때, **Then** `targets[]`는 evidence 기반 target만 포함하고 `discoveredPaths[]`에 listDir 항목이 `{kind, sourceTool, reason}`과 함께 들어간다.
2. **Given** `explore` report에 ``` `src/a.js:L1-L3` ```, ``` `src/a.js:L5-L8` ```, ``` `src/b.js:L2` ``` 세 citation이 있는 상태, **When** report target이 생성될 때, **Then** target 개수가 2개로 줄고 `src/a.js`는 `startLine:1, endLine:8`로 병합된다.
3. **Given** `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` 환경, **When** 동일 조건에서 호출, **Then** discovered path가 기존처럼 `role:reference`, `evidenceRefs:[]`로 `targets[]`에 승격되어 1 릴리스 migration window 동안의 하위 호환이 유지된다.
4. **Given** `EXPLORE_REPO_OUTPUT_SCHEMA`를 직접 validate하는 consumer, **When** 응답에 `discoveredPaths[]`가 있는 상태로 검증, **Then** additive field로 인식되어 검증이 통과한다.

---

### User Story 3 - code snippet의 환경변수 이름 보존 redaction (Priority: P3)

코드 인터페이스를 이해하려는 사용자에게 `process.env.CEREBRAS_API_KEY`, `import.meta.env.VITE_API_URL`, `Deno.env.get("TOKEN")` 같은 표현은 secret이 아니라 public한 호출 contract다. 현재는 secret-path mention regex가 snippet 문자열 안에서 `.env.X` 부분을 잡아 `[REDACTED:secret-path]`로 가려, snippet을 읽어도 어떤 env var가 쓰이는지 알 수 없다. 환경변수 이름은 보존하고 실제 secret 값과 secret file path는 그대로 가린다.

**Why this priority**: RAW.md Claude Code 최우선 fix 2번. 보안을 약화시키지 않으면서 코드 가독성을 크게 회복한다(C11). 다른 수정과 독립적이라 우선순위 P3로 분리.

**Independent Test**: `redactText('const key = process.env.CEREBRAS_API_KEY;')`가 원문 그대로 반환되고, `redactText('Read \`.env.production:L1-L3\` before debugging.')`는 path 부분만 `[REDACTED:secret-path]`로 가려지는지 두 단위 테스트만으로 검증 가능하다.

**Acceptance Scenarios**:

1. **Given** snippet text `"const key = process.env.CEREBRAS_API_KEY;"`, **When** `redactText`가 적용될 때, **Then** 반환된 text는 변경되지 않고 `redacted=false`이다.
2. **Given** snippet text `` "Read `.env.production:L1-L3` before debugging." ``, **When** `redactText`가 적용될 때, **Then** `.env.production:L1-L3` 부분만 `[REDACTED:secret-path]`로 치환되고 `redacted=true`이다.
3. **Given** snippet text `"process.env.OPENAI_API_KEY = \"sk-proj-...\""`, **When** `redactText`가 적용될 때, **Then** `process.env.OPENAI_API_KEY` 식별자는 보존되고 secret 값 `sk-proj-...`만 `[REDACTED:openai-api-key]`로 치환된다.
4. **Given** `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1` 옵트인 환경, **When** 동일 입력 처리, **Then** env var 이름도 마스킹되어 조직 정책에 맞출 수 있다.

---

### User Story 4 - scope를 git-guided 도구 전체에서 hard boundary로 복구 (Priority: P4)

`review_change_context` 같은 git-guided 흐름이 scope 밖 변경 파일을 결과에 섞지 않도록 `repo_git_diff`(file 모드와 stat 모드 모두)와 `repo_git_show`가 base scope를 hard boundary로 일관 적용한다. scope 밖에서 제외된 파일 수는 응답에 `omittedOutOfScopeFiles`로 표시해 정보 손실을 가시화한다.

**Why this priority**: DESIGN.md와 README가 모두 scope를 hard boundary로 명시하는데 `gitDiff()`가 기본 false로 호출되는 단일 예외 경로다. 보안/명세 일관성 측면에서 중요하지만 영향 표면이 좁아 P4로 둔다(C5).

**Independent Test**: scope `['docs/**']`인 RepoToolkit이 `hello.js`와 `docs/README.md`를 둘 다 건드린 commit에 대해 `gitDiff({from:'HEAD~1', to:'HEAD'})`를 호출했을 때, 결과 `files`에 `hello.js`가 없고 `docs/*`만 있으며 `omittedOutOfScopeFiles>0`인지로 완결 검증된다.

**Acceptance Scenarios**:

1. **Given** base scope `['docs/**']`인 RepoToolkit과 `hello.js` + `docs/README.md`를 변경한 commit, **When** `gitDiff({from:'HEAD~1', to:'HEAD'})` 호출, **Then** `files`는 `docs/*`만 포함하고 `omittedOutOfScopeFiles ≥ 1`이 반환된다.
2. **Given** 동일 scope와 동일 변경, **When** `gitDiff({stat:true})` 호출, **Then** stat text의 scope 밖 라인은 제거되고 `omittedOutOfScopeFiles`가 함께 표시된다.
3. **Given** `gitShow` 기존 scope test, **When** 변경 후 회귀 실행, **Then** 기존 동작이 유지된다.
4. **Given** `review_change_context` wrapper 호출, **When** 결과가 조립될 때, **Then** scope 밖 git file은 `targets[]`, `discoveredPaths[]` 어느 쪽으로도 노출되지 않는다.

---

### User Story 5 - session/progress/sub-agent handoff 운영 계약 강화 (Priority: P5)

Heavy 호출(70~80초 수준)이나 sub-agent 거치는 호출에서도 parent가 진행률과 control-plane metadata를 잃지 않도록, 다음을 추가한다: (a) 옵트인 자동 session reuse(`CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`), (b) heavy 도구에서 `_meta.progressToken` 사용을 권장 규칙으로 명문화, (c) sub-agent 요약에서 `status.verification`, `status.complete`, `evidenceQuality`, `searchCoverage`, `failure`, `session/sessionId`, `critic.warnings`를 필수 보존 필드로 문서화, (d) wrapper 선택 decision rule 추가.

**Why this priority**: 개별 호출의 정확도보다 multi-call 운영 품질에 영향을 주는 변경이라 P5. 대부분 문서/옵션 추가라 위험도가 낮고, 기본값이 off이므로 기존 동작이 바뀌지 않는다(C12·C14·C16·C4·C8).

**Independent Test**: `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 환경에서 같은 repoRoot로 explicit session 없이 두 번 호출하면 두 번째 응답이 `session.status=reused`, `_debug.stats.sessionSource=auto_repo`인지로 검증된다. 문서 변경은 README/AGENTS/DESIGN의 해당 단락이 sub-agent 필수 필드와 progressToken 규칙을 포함하는지로 검증된다.

**Acceptance Scenarios**:

1. **Given** `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1`와 같은 repoRoot의 reusable session 1개, **When** explicit `session` 인자 없이 호출, **Then** `session.status=reused`, `_debug.stats.sessionSource=auto_repo`로 반환된다.
2. **Given** TTL/maxCalls 초과 session만 남은 같은 repoRoot, **When** 옵트인 자동 reuse 시도, **Then** 신규 session이 생성되고 `sessionStatus=created`가 된다.
3. **Given** 기본 환경(옵트인 off), **When** explicit session 없이 두 번 호출, **Then** 매번 새 session이 생성되어 기존 동작과 동일하다.
4. **Given** README의 Codex agent instructions와 AGENTS.md의 sub-agent invariant, **When** 변경 후 docs lint/snapshot 검사, **Then** "Pass `_meta.progressToken` for heavy calls" 문구와 "Sub-agent summaries must preserve control-plane fields: ..." 문구가 존재한다.
5. **Given** initialize instructions 문자열, **When** MCP client가 server를 initialize할 때, **Then** progressToken·sessionId·structured metadata 보존 안내가 instructions에 포함되어 있다.

---

### Edge Cases

- locate/symbol_trace task인데 exact evidence가 0개, partial만 1개인 상태 → `complete:false`, `verification:follow_up_needed`로 남는다(false-positive 완료를 막는다).
- `evidence_verification` task가 "X는 없다"는 negative finding을 결론으로 갖는 경우, exact evidence 1개만으로 충분하다고 판정되는지 결정 필요(현재 명세는 충분하다고 봄, 리스크 항목 유지).
- `repo_list_dir` 결과가 매우 길어 `discoveredPaths[]`가 cap을 넘는 경우, 최신/최근 100개로 절단된다.
- env var name이지만 backtick으로 감싸진 형태(`` `process.env.X` ``)에서 boundary regex가 일관되게 동작해야 한다.
- `git diff --stat` 출력에서 rename/copy(`old => new`) 라인의 path parsing이 scope filter와 함께 안정적이어야 한다.
- 자동 session reuse가 다중 MCP client 동시 호출 환경에서 의도치 않은 state 공유로 이어질 위험 → 기본 off로 완화하고 docs에 multi-client 권고 추가.
- 강한 redaction을 원하는 조직이 `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1`를 켰을 때, 기존 secret value/path redaction이 함께 작동해야 한다.
- 기존 parent consumer가 `targets[].evidenceRefs.length === 0` 항목을 broad follow-up 대상으로 사용하던 경우, legacy env var로 1 릴리스 동안 호환을 유지하면서 README/AGENTS migration 안내가 명시되어야 한다.

## Requirements *(mandatory)*

### Functional Requirements

#### 상태 계약 (User Story 1)

- **FR-001**: System MUST evidence sufficiency를 `status.complete`, `status.verification`, `failure.reason`을 결정하는 1차 신호로 사용해야 한다. `stats.stoppedByBudget`은 보조 신호다.
- **FR-002**: System MUST locate/symbol_trace 및 자연어 패턴(`어디|찾아|위치|defined|where|find|locate|definition` 등)으로 식별되는 simple task에 대해, exact grounded evidence 1개와 비어있지 않은 directAnswer가 있고 critic fail/error/abort가 없으면 `complete:true`를 허용해야 한다.
- **FR-003**: System MUST `path_explanation` task에 대해 exact evidence 2개 이상 또는 distinct file 2개 이상이라는 더 높은 기준을 적용해야 한다.
- **FR-004**: System MUST `edit_planning` task에 대해 edit/read/test/config role을 가진 actionable target과 exact evidence 1개 이상을 함께 요구해야 한다.
- **FR-005**: System MUST `evidence_verification` task에 대해 exact grounded evidence 1개 이상을 요구해야 한다.
- **FR-006**: System MUST `failure.reason='budget_exhausted'`를 evidence sufficiency가 false인 경우에만 생성해야 한다. sufficiency가 true이면 `failure`는 null이다.
- **FR-007**: System MUST `searchCoverage.stoppedByBudget`을 budget 소진 사실 그대로 유지해 budget 사실을 숨기지 않아야 한다.
- **FR-008**: System MUST `complete:true`임에도 budget이 소진된 경우 `status.warnings`에 낮은 severity의 "budget exhausted after sufficient evidence" 메시지를 남겨야 한다.
- **FR-009**: System MUST `buildNextAction()`에서 다음 우선순위를 적용해야 한다: (1) `failure.retry`가 있으면 우선, (2) sufficient + no edit needed → `stop`, (3) sufficient + edit/read verification needed → `read_target`, (4) insufficient + concrete retry possible → `explore_followup`, (5) insufficient + missing user intent → `ask_user`.
- **FR-010**: System MUST `_debug.evidenceSufficiency` 필드에 `{ sufficient: boolean, reason: string }`를 기록해 진단 가능하게 해야 한다.
- **FR-011**: System MUST `EXPLORE_REPO_OUTPUT_SCHEMA`의 기존 enum/required 필드를 제거하지 않고 additive로만 변경해야 한다(strict consumer 보호).

#### Targets/DiscoveredPaths 분리 (User Story 2)

- **FR-012**: System MUST `targets[]`에는 grounded evidence에서 도출되었거나 evidence path와 연결된 모델 제안 target만 포함해야 한다. discovery-only path는 포함하지 않는다.
- **FR-013**: System MUST 새 top-level `discoveredPaths[]`를 응답에 추가하고 각 항목은 `{ path, kind: 'file'|'dir'|'unknown', sourceTool, reason }` 형태여야 한다.
- **FR-014**: System MUST `repo_list_dir`, `repo_find_files`, `repo_git_diff`, `repo_git_show` 등의 결과에서 discovered path를 수집해 `discoveredPaths[]`로 라우팅해야 한다(`targets[]`로 자동 승격 금지).
- **FR-015**: System MUST `discoveredPaths[]`를 path 기준으로 dedupe하고 같은 path는 더 구체적인 `kind`로 병합하며 기본 cap 100개로 제한해야 한다.
- **FR-016**: System MUST report 도구(`explore`/`explore_v2`)의 citation target을 file path 기준으로 병합하고, `startLine`은 최소값, `endLine`은 최대값으로 range 병합해야 한다.
- **FR-017**: System MUST 동일 파일의 citation이 2개 이상 병합된 경우 target `reason`에 "Markdown report citations merged from N ranges." 식 문구를 남겨 사용자가 병합을 인지할 수 있게 해야 한다.
- **FR-018**: System MUST `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` 환경변수가 켜진 경우 1 릴리스 동안 기존(reference target 승격) 동작을 그대로 유지해야 한다. 기본값은 off이다.
- **FR-019**: System MUST `EXPLORE_REPO_OUTPUT_SCHEMA.properties`에 `discoveredPaths` 항목을 additive로 추가해야 한다. `EXPLORE_RESULT_JSON_SCHEMA`(모델 출력 schema)에는 추가하지 않는다.

#### Redaction (User Story 3)

- **FR-020**: System MUST snippet/report 문자열 안의 `process.env.<NAME>`, `import.meta.env.<NAME>`, `Deno.env.get("<NAME>")` 같은 환경변수 식별자 표현을 기본 redaction 규칙에서 보존해야 한다.
- **FR-021**: System MUST secret value pattern(API key/PAT/JWT/private key block 등)에 대한 기존 redaction을 유지해야 한다.
- **FR-022**: System MUST `.env`, `.env.<suffix>`, `.envrc`, `.npmrc`, `.netrc`, `id_rsa`, `id_ed25519`, slash 포함 secret path mention을 단어 boundary 기준으로 식별해 `[REDACTED:secret-path]`로 마스킹해야 한다.
- **FR-023**: System MUST file citation path가 deny-list에 매칭되면 기존처럼 secret-path로 마스킹해야 한다.
- **FR-024**: System MUST `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1` 옵트인 환경변수가 켜진 경우에만 env var 이름까지 추가 마스킹해야 한다. 기본값은 off이다.
- **FR-025**: System MUST boundary regex가 backtick, 쉼표, 마침표, 콜론, 따옴표 등 인접 문자와 함께 안정적으로 동작해야 한다.

#### Scope Hard Boundary (User Story 4)

- **FR-026**: System MUST `_filterGitDiffFiles()` 기본값을 `enforceScope:true`로 변경하고, base scope가 있으면 `gitDiff()`/`gitShow()` 모두에서 scope 밖 file을 결과 `files`에서 제외해야 한다.
- **FR-027**: System MUST scope 밖에서 제외된 file 수를 응답에 `omittedOutOfScopeFiles`로 표시해야 한다. secret path로 제외된 수는 `omittedSecretPaths`로 표시한다(둘 다 0보다 클 때만 포함).
- **FR-028**: System MUST `gitDiff({stat:true})` 경로에서도 scope 밖 라인을 stat text에서 제거하고 `omittedOutOfScopeFiles` count를 함께 반환해야 한다.
- **FR-029**: System MUST scope 밖 git file이 `targets[]`, `discoveredPaths[]` 어느 쪽으로도 노출되지 않도록 모든 수집 경로에서 일관되게 차단해야 한다.
- **FR-030**: System MUST `omittedOutOfScopeFiles`/`omittedSecretPaths`를 additive field로 추가해야 한다(기존 consumer를 깨지 않는다).

#### Session/Progress/Sub-agent (User Story 5)

- **FR-031**: System MUST `SessionStore`에 `findReusableForRepo(repoRoot)` method를 추가하고, TTL/maxCalls 조건을 통과한 최신 reusable session을 반환해야 한다.
- **FR-032**: System MUST `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 옵트인 환경에서 explicit `session` 인자가 없을 때 같은 repoRoot의 최신 reusable session을 자동 재사용하고, 그 사실을 `session.status='reused'`, `_debug.stats.sessionSource='auto_repo'`로 표시해야 한다. 기본값은 off이다.
- **FR-033**: System MUST `SESSION_SCHEMA.status` enum(`created`/`reused`/`fallback`)을 변경하지 않아야 한다.
- **FR-034**: README, DESIGN, AGENTS는 (a) `_meta.progressToken`을 heavy/report/path/impact 호출에서 권장하는 규칙, (b) sub-agent summary가 반드시 보존해야 할 control-plane 필드 목록(`status.verification`, `status.complete`, `evidenceQuality`, `searchCoverage`, `failure`, `session/sessionId`, `critic.warnings`), (c) wrapper 선택 decision rule(자동화/known symbol/human narrative/opt-in v2)을 명시해야 한다.
- **FR-035**: MCP `initialize` instructions 문자열은 progressToken·sessionId·structured metadata 보존 안내를 계속 포함해야 한다.

### Key Entities *(include if feature involves data)*

- **ExplorerRuntime result**: `schemaVersion`, `directAnswer`, `status`, `targets[]`, `discoveredPaths[]`(신규), `evidence[]`, `uncertainties[]`, `nextAction`, `evidenceQuality`, `searchCoverage`, `failure?`, `session?`, `sessionId?`, `_debug`. 본 feature는 `status`/`failure`/`nextAction` 결정 로직과 `discoveredPaths[]` 추가에 변경이 집중된다.
- **StatusBlock**: `confidence`, `verification`, `complete`, `warnings[]`(기존), `_debug.evidenceSufficiency`(신규 진단). `complete`의 의미가 "충분한 grounded evidence 확보"로 재정의된다.
- **TargetItem**: `path`, `role`(`edit`/`read`/`test`/`config`/`context`/`reference`), `reason`, `evidenceRefs[]`, `startLine?`, `endLine?`. `role:reference + evidenceRefs:[]` 항목이 더 이상 자동 생성되지 않는다(legacy mode 제외).
- **DiscoveredPathItem (신규)**: `path`, `kind`, `sourceTool`, `reason`. runtime이 채우는 derived field.
- **GitDiffResult**: `from`, `to`, `files[]`, `omittedOutOfScopeFiles?`(신규), `omittedSecretPaths?`(신규).
- **SessionRecord**: `id`, `repoRoot`, `calls`, `lastUsedAt`, `createdAt`. `findReusableForRepo(repoRoot)`이 추가 entry point.
- **RedactionResult**: `text`, `redacted`, `redactions[]`. env var name 보존 규칙이 token boundary와 함께 새로 적용된다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 단일 symbol/locate 시나리오에서, exact grounded evidence 1개 이상이 있고 budget이 소진된 mock 호출의 100%가 `status.complete=true`, `failure=null`로 반환된다.
- **SC-002**: path_explanation/edit_planning 등 복합 task의 mock 시나리오에서, evidence가 부족한 경우 100%가 `complete=false`, `failure.reason=budget_exhausted` 또는 다른 명시 reason으로 반환된다(false-positive 완료 0건).
- **SC-003**: 기본 환경(legacy off, auto session off)에서 응답의 `targets[]`에 `evidenceRefs.length===0`인 항목이 0개다(report citation merge 결과의 reference target 제외).
- **SC-004**: `explore` Markdown report citation 중복 시나리오에서, file 단위로 병합되어 target 개수가 citation path 고유 개수와 동일하다.
- **SC-005**: redaction 회귀 테스트 묶음에서, `process.env.X`/`import.meta.env.X`/`Deno.env.get("X")` 패턴을 포함한 모든 케이스가 식별자를 보존하면서 secret 값/secret 파일 경로 마스킹은 100% 유지한다.
- **SC-006**: scope=`['docs/**']` 시나리오에서 scope 밖 변경 파일을 건드린 commit에 대한 `gitDiff()`/`gitShow()`/`gitDiff({stat:true})` 호출 결과의 `files`/stat text에 scope 밖 path가 0건 노출되고 `omittedOutOfScopeFiles>0`이 함께 표시된다.
- **SC-007**: `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 옵트인 환경에서 같은 repoRoot로 explicit session 없이 두 번 연속 호출 시, 두 번째 호출의 `session.status=reused`, `_debug.stats.sessionSource=auto_repo`이며 옵션 off일 때는 항상 `created`이다.
- **SC-008**: 기존 `npm test` 전체 회귀 묶음이 100% 통과한다(필요한 기대값 갱신 후).
- **SC-009**: README/DESIGN/AGENTS 문서 검사에서 (a) progressToken 권장 문구, (b) sub-agent 필수 보존 필드 목록, (c) wrapper decision rule, (d) `discoveredPaths[]` 설명, (e) redaction env var 보존 정책, (f) git diff/show scope hard boundary 명시가 모두 발견된다.
- **SC-010**: `EXPLORE_REPO_OUTPUT_SCHEMA`의 기존 required/enum 값이 변경되지 않아 strict schema consumer의 검증이 회귀 없이 통과한다(`discoveredPaths`/optional `omittedOutOfScopeFiles`/`omittedSecretPaths`는 모두 additive).

## Assumptions

- Cerebras Explorer MCP의 단일 next 릴리스에 5종 수정을 함께 묶어 배포한다. 단계적 릴리스는 본 spec 범위 밖이다.
- Strict schema consumer를 깨지 않기 위해 모든 schema 변경은 additive다. 새 필드는 optional이며 기존 enum/required는 변경하지 않는다.
- Legacy 호환은 단일 릴리스 window 동안 환경변수로만 제공한다(`CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS`).
- 자동 session reuse와 env var name 강한 마스킹은 모두 기본 off이며, 멀티 클라이언트/조직 정책에 따라 옵트인할 수 있다.
- `_debug.evidenceSufficiency`, `_debug.stats.sessionSource`는 진단용 derived field로, 외부 consumer가 무시해도 안전하다.
- 코드 위치 기반 변경 지점(`src/explorer/runtime.mjs`, `src/explorer/schemas.mjs`, `src/explorer/repo-tools.mjs`, `src/explorer/redact.mjs`, `src/explorer/session.mjs`, `src/explorer/config.mjs`, `src/mcp/server.mjs`, README/DESIGN/AGENTS)은 RAW.md Phase 5의 As-Is/To-Be 분석에 따라 변경된다.
- 본 spec은 신규 도구 추가 또는 기존 도구 제거를 포함하지 않으며, 도구 surface 자체는 기존 8개 기본/9개 최대를 유지한다.
- 평가용 동적 수치(예: "47개 target", "70~80초 호출")는 본 spec의 성공 지표가 아니며, 구조적 회귀 방지가 평가 기준이다.
