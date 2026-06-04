# Feature Specification: `_debug` 필드와 세션 기능 완전 제거

**Feature Branch**: `017-remove-debug-and-session`

**Created**: 2026-05-26

**Status**: Implemented

**Input**: User description: "디버그 제거하고 세션 관련 내용도 제거해버리고 싶음."

## Clarifications

### Session 2026-05-26

- **Q: `_debug` 제거의 범위** → **A: 응답에서 완전 제거.** `_debug`는 MCP `structuredContent`에 들어가 parent agent에 보이긴 하지만, README.md:297이 명시한 대로 "explorer 동작 자체를 디버깅할 때만" 보는 운영 메타데이터다. control-plane 결정(`failure.retry`, `nextAction`, `evidenceQuality`, `critic.warnings`)은 모두 top-level 필드로 별도 노출되므로 parent agent 사용에 기능적 영향이 없다.
- **Q: 세션 기능 제거의 범위** → **A: 입력·응답·SessionStore 모두 제거.** 응답에서 `sessionId`/`session`만 빼고 입력 `session`을 남기면 parent agent가 sessionId를 받을 경로가 없어 입력이 동작 불가능한 흔적으로 남는다(spec 011이 auto-by-repo reuse를 이미 제거). multi-call 세션 연결 기능 자체를 접는다.
- **Q: 버전 전략** → **A: 단일 breaking — schemaVersion 2 + 다음 minor.** 단계별 deprecation은 하지 않는다. CHANGELOG에 breaking 명시.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - parent agent가 받는 응답이 운영 메타데이터 없이 단순해진다 (Priority: P1)

`explore_repo`/`explore` 및 6개 wrapper 호출의 MCP `structuredContent`에서 `_debug`, `sessionId`, `session` 필드가 모두 제거되어 control-plane 필드만 남는다. parent agent가 받는 contract는 `schemaVersion`, `directAnswer`, `status`, `targets`, `discoveredPaths`, `evidence`, `uncertainties`, `nextAction`, `evidenceQuality`, `searchCoverage`, `failure`로 좁혀진다.

**Why this priority**: 응답 surface 축소가 본 spec의 가장 큰 가치. parent agent의 토큰 비용 절감 + contract 명확화. P1.

**Independent Test**: `tests/mcp-server.test.mjs`에서 임의의 `explore_repo` 호출 응답을 받아 `result._debug === undefined`, `result.sessionId === undefined`, `result.session === undefined`를 확인. `result.schemaVersion === 2`를 확인.

**Acceptance Scenarios**:

1. **Given** valid `explore_repo` 호출, **When** MCP 응답을 받았을 때, **Then** `structuredContent._debug`, `structuredContent.sessionId`, `structuredContent.session`이 모두 부재한다.
2. **Given** valid `explore` 호출, **When** MCP 응답을 받았을 때, **Then** 동일하게 세 필드 모두 부재한다.
3. **Given** 6개 wrapper 도구 호출, **When** 응답을 받았을 때, **Then** 동일하게 세 필드 모두 부재한다.

---

### User Story 2 - 입력 schema에서 `session` 파라미터가 제거된다 (Priority: P1)

`explore_repo`, `explore`, 6개 wrapper의 입력 schema에서 `session` 키가 제거된다. `additionalProperties: false`이므로 `session`을 넘기면 schema validation 단계에서 거부된다.

**Why this priority**: 세션 기능을 완전히 접는다는 결정의 가시화. 잘못된 입력에 빠른 실패. P1.

**Independent Test**: `tests/schemas.test.mjs`에서 `EXPLORE_REPO_INPUT_SCHEMA.properties.session`이 `undefined`임을 확인. `validateExploreRepoArgs({ task: 'x', session: 'sess_abc' })`이 unknown-property 에러를 반환함을 확인.

**Acceptance Scenarios**:

1. **Given** `{ task: 'x', session: 'sess_abc' }` 입력, **When** schema 검증, **Then** "unknown property 'session'" 에러.
2. **Given** `{ task: 'x' }` 입력, **When** schema 검증, **Then** PASS (다른 정상 키는 영향 없음).

---

### User Story 3 - SessionStore 및 관련 런타임 코드가 제거된다 (Priority: P2)

`src/explorer/session.mjs` 파일 자체를 제거. `src/index.mjs`와 `src/explorer/runtime.mjs`에서 `SessionStore` import·생성·전파를 제거. runtime의 세션 라이프사이클 함수(`resolveSession`, `syncRemainingCallsStat`, fallback 분기)도 제거. `tests/session.test.mjs` 파일도 제거.

**Why this priority**: 응답·입력 표면을 줄이고 모듈까지 정리해야 dead code가 남지 않는다. P2 (P1보다 광범위한 코드 정리지만 외부 contract 변경의 결과물).

**Independent Test**: `npm test` 전체 0 failures. `Grep`으로 `SessionStore`, `sessionStore`, `sessionId` 식별자가 `src/` 하위에서 모두 제거됨을 확인.

**Acceptance Scenarios**:

1. **Given** `git ls-files src/explorer/session.mjs`, **When** 확인, **Then** 파일 없음.
2. **Given** `git ls-files tests/session.test.mjs`, **When** 확인, **Then** 파일 없음.
3. **Given** `grep -r 'SessionStore' src/`, **When** 실행, **Then** 매치 없음.
4. **Given** `npm test`, **When** 실행, **Then** 0 failures.

---

### User Story 4 - schemaVersion이 2로 올라가고 breaking change가 문서화된다 (Priority: P1)

`EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const`가 2로, `AGENT_FACING_SCHEMA_VERSION`이 2로 변경된다. 모든 응답이 `schemaVersion: 2`로 반환된다. CHANGELOG에 breaking 사항이 명시되고 README/DESIGN 문서가 갱신된다.

**Why this priority**: parent agent가 응답 contract 차이를 감지할 유일한 신호. P1.

**Independent Test**: `tests/schemas.test.mjs`의 `assert.equal(EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const, 2)`가 PASS. `tests/runtime.mock.test.mjs`의 `result.schemaVersion === 2` assertion이 PASS.

**Acceptance Scenarios**:

1. **Given** schema 정의, **When** `EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const` 확인, **Then** `2`.
2. **Given** runtime 모듈, **When** `AGENT_FACING_SCHEMA_VERSION` 확인, **Then** `2`.
3. **Given** 임의의 도구 호출 응답, **When** `schemaVersion` 확인, **Then** `2`.
4. **Given** `CHANGELOG.md`, **When** 확인, **Then** spec 017의 breaking 항목이 신규 release 라인에 기록되어 있다.

---

### Edge Cases

- **기존 JSONL transcript 파일** (`.cerebras-explorer/transcripts/*.jsonl`)은 schemaVersion 1로 저장된 레코드를 포함할 수 있다. read-only explorer이므로 transcript는 단순 기록이며 본 spec은 transcript 마이그레이션을 제공하지 않는다. transcript 사용자는 schemaVersion 필드로 1/2를 구분해야 한다.
- **benchmark 평가**: `src/benchmark/evaluator.mjs:13`이 `result?._debug?.stats ?? result?.stats`로 두 경로를 보고 있다. `_debug` 제거 후에도 runtime이 내부 raw result에 `stats`를 그대로 둘지, 아니면 `stats` 자체도 제거할지 결정해야 한다 — 본 spec은 **`stats`를 raw runtime result에 유지**(MCP 응답에서만 빼는 것)하고 benchmark fallback을 `result?.stats`로 단순화한다. critic/transcript도 동일하게 raw result의 `stats`를 그대로 사용한다.
- **stats 안의 sessionId/sessionStatus/remainingCalls** 같은 세션 파생 stat들도 같이 제거된다 (세션 기능 자체가 제거되므로).
- **integration-test 스크립트**가 session reuse 흐름을 검증한다면 해당 케이스를 제거하거나 단순 호출로 교체한다.

## Requirements *(mandatory)*

### Functional Requirements

#### `_debug` 제거

- **FR-001**: `src/mcp/server.mjs`의 `toAgentFacingResult()`에서 `_debug` 필드 빌더를 제거한다. 응답 객체에 `_debug` 키가 들어가지 않는다.
- **FR-002**: `src/mcp/server.mjs`의 failure-shape helper(라인 561 부근의 `_debug: {}`)에서도 `_debug` 키를 제거한다.
- **FR-003**: `src/explorer/runtime.mjs`의 `result._debug` 빌드 두 곳(라인 959, 1790 부근)을 제거한다. raw runtime result는 `_debug` 키를 갖지 않는다.
- **FR-004**: `src/explorer/schemas.mjs`의 `EXPLORE_REPO_OUTPUT_SCHEMA.properties`에서 `_debug` 키를 제거한다. 응답 envelope normalizer(라인 517 부근의 `safe._debug` 처리)도 제거한다.
- **FR-005**: `src/benchmark/evaluator.mjs:13`의 `result?._debug?.stats ?? result?.stats ?? {}`를 `result?.stats ?? {}`로 단순화한다.
- **FR-006**: runtime이 raw 결과에 갖는 `stats` 객체는 그대로 유지된다 (benchmark/critic/transcript의 입력이며 MCP 응답으로는 전파되지 않는다).

#### 세션 기능 제거

- **FR-010**: `src/explorer/session.mjs` 파일을 삭제한다.
- **FR-011**: `src/index.mjs`와 `src/explorer/runtime.mjs`에서 `SessionStore` import 및 생성 코드를 제거한다.
- **FR-012**: `src/explorer/runtime.mjs`의 세션 라이프사이클 함수(`resolveSession` 또는 동등명, `syncRemainingCallsStat`, fallback 분기)와 sessionId 전파 코드(라인 1314 부근의 sessionResolution 처리, 1417/1931의 `sessionId` 응답 빌드, 1800/2290의 `sessionStore.update` 호출 등)를 모두 제거한다.
- **FR-013**: `src/explorer/schemas.mjs`의 `EXPLORE_REPO_INPUT_SCHEMA.properties`에서 `session` 키를 제거한다. `additionalProperties: false`로 사용자가 `session`을 넘기면 거부된다.
- **FR-014**: `src/explorer/schemas.mjs`의 `EXPLORE_REPO_OUTPUT_SCHEMA.properties`에서 `sessionId`와 `session` 키를 제거한다.
- **FR-015**: `src/mcp/server.mjs`의 `toAgentFacingResult()`에서 `sessionId`/`session` 빌더(라인 566, 588-589, `buildAgentSession` 호출)를 제거한다. `buildAgentSession` 정의 자체도 제거한다.
- **FR-016**: 6개 wrapper 도구 schema에서도 `session` 입력 키와 `taskMode` 내부 키 외 세션 관련 필드를 제거한다.
- **FR-017**: runtime의 `stats` 객체에서 `sessionId`, `sessionStatus`, `sessionSource`, `remainingCalls` 파생 필드를 제거한다.
- **FR-018**: `validateExploreRepoArgs`와 wrapper validator에서 `session` 관련 검증 분기를 제거한다.
- **FR-019**: `tests/session.test.mjs` 파일을 삭제한다.
- **FR-020**: 다른 테스트 파일(`tests/mcp-server.test.mjs`, `tests/schemas.test.mjs`, `tests/runtime.mock.test.mjs`, `tests/integrations.test.mjs`, `tests/integration-script.test.mjs`)에서 `session`/`sessionId` 관련 assertion 및 fixture 입력을 제거한다.
- **FR-021**: `scripts/integration-test.mjs`에서 session reuse 흐름을 검증하는 케이스를 제거하거나 단순 호출로 교체한다.

#### schemaVersion bump

- **FR-030**: `src/explorer/schemas.mjs`의 `EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const`를 `1`에서 `2`로 변경한다.
- **FR-031**: `src/explorer/runtime.mjs`의 `AGENT_FACING_SCHEMA_VERSION` 상수를 `2`로 변경한다.
- **FR-032**: `src/mcp/server.mjs`의 `toAgentFacingResult()` fallback(라인 572 부근의 `result.schemaVersion ?? 1`)을 `?? 2`로 변경한다.
- **FR-033**: 모든 테스트 fixture/assertion에서 `schemaVersion: 1` 또는 `schemaVersion === 1`을 `2`로 갱신한다. 영향 위치: `tests/mcp-server.test.mjs:279, 599, 718`, `tests/integrations.test.mjs:38`, `tests/schemas.test.mjs:231`, `tests/runtime.mock.test.mjs:261, 684, 1589`.

#### 문서 갱신

- **FR-040**: `README.md`의 `_debug`/`sessionId`/`session` 언급 모두 제거 또는 갱신. 주요 위치(2026-05-26 기준):
  - README.md:169 (Compact 반환 계약의 `session`/`sessionId` 언급, `_debug.stats`/`_debug.toolTrace` 언급)
  - README.md:193 (control-plane 필드 목록의 `session/sessionId`)
  - README.md:213, 334 (입력 `session` 설명)
  - README.md:273-279 (응답 예시의 `sessionId`/`session`)
  - README.md:290 (`session.id` 설명 단락)
  - README.md:297, 301-310 (`_debug` 설명 및 예시 JSON 블록)
  - README.md:587 (Codex 가이드 안의 "Reuse `sessionId` as `session`")
  - README.md:707 (벤치마크 구조 체크 목록의 `sessionId`)
- **FR-041**: `DESIGN.md`의 `_debug`/`session` 언급 갱신. 주요 위치:
  - §5 MCP Server의 세션 enum 표 (DESIGN.md:550-570 부근) — §11.7과 함께 세션 기능 제거를 반영
  - §9 JSON envelope 예시의 `sessionId`/`session`/`_debug` 필드 제거
  - §11.7 Session/progress operational contract 단락 — 세션 기능 제거 사실 반영, progress notification 부분만 남김
  - §13 Runtime config 표는 그대로 (영향 없음)
- **FR-042**: `CHANGELOG.md`에 spec 017의 breaking 변경을 새 release 라인에 명시한다 (예: "BREAKING: response no longer includes `_debug`, `sessionId`, `session`; input `session` parameter removed; schemaVersion bumped to 2").
- **FR-043**: 6개 integration 예시(`integrations/codex/AGENTS.md.example` 등)에서 session 관련 가이드를 제거한다.
- **FR-044**: `plan/extension-backlog.md`와 같은 backlog 문서는 본 spec과 무관하므로 손대지 않는다. 단, README의 "다음 확장 포인트" 단락(README.md:761-)에 세션 기능 제거 사실이 반영될 필요는 없다.

#### 회귀 가드

- **FR-050**: `npm test` 전체 0 failures.
- **FR-051**: `tests/schemas.test.mjs`에 회귀 가드 추가:
  - `EXPLORE_REPO_OUTPUT_SCHEMA.properties._debug === undefined`
  - `EXPLORE_REPO_OUTPUT_SCHEMA.properties.sessionId === undefined`
  - `EXPLORE_REPO_OUTPUT_SCHEMA.properties.session === undefined`
  - `EXPLORE_REPO_INPUT_SCHEMA.properties.session === undefined`
  - `EXPLORE_REPO_OUTPUT_SCHEMA.required`에 `schemaVersion` 그대로 포함.
- **FR-052**: `tests/mcp-server.test.mjs`에 회귀 가드 추가: 임의의 호출 응답에서 `structuredContent._debug`, `structuredContent.sessionId`, `structuredContent.session` 모두 부재.

### Key Entities

- **AGENT_FACING_SCHEMA_VERSION** 상수: 응답 contract 버전. 본 spec에서 1 → 2.
- **EXPLORE_REPO_OUTPUT_SCHEMA**: 응답 envelope 스키마. `_debug`, `sessionId`, `session` 키 제거.
- **EXPLORE_REPO_INPUT_SCHEMA**: 입력 스키마. `session` 키 제거.
- **SessionStore**: 본 spec에서 모듈 자체 제거.
- **`stats` raw object**: runtime이 critic/transcript/benchmark용으로 raw result에 두는 객체. MCP 응답으로 전파되지 않음. 세션 파생 필드(`sessionId` 등)만 제거되고 나머지(`toolCalls`, `stoppedByBudget` 등)는 그대로.

## Success Criteria *(mandatory)*

- **SC-001**: `npm test` 전체 0 failures.
- **SC-002**: 임의의 MCP 도구 호출 응답에서 `_debug`, `sessionId`, `session` 세 필드 모두 부재.
- **SC-003**: 임의의 MCP 도구 입력에 `session` 키를 포함하면 schema validation 에러.
- **SC-004**: `EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const === 2`.
- **SC-005**: `git ls-files src/explorer/session.mjs tests/session.test.mjs`가 빈 결과.
- **SC-006**: `grep -r 'SessionStore' src/`이 매치 없음.
- **SC-007**: README/DESIGN의 `_debug`, `sessionId`, `session` 잔존 언급이 grep으로 0건 (혹은 본 spec/CHANGELOG의 "제거되었다" 맥락 안에서만 등장).
- **SC-008**: `CHANGELOG.md` 새 release 라인에 breaking 명시.

## Assumptions

- 본 spec은 명시적 **breaking change**다. semver 0.x에서도 schemaVersion bump로 명확히 알린다. 다음 릴리즈는 0.6.0 또는 합의된 minor bump로 끊는다.
- 외부 사용자가 session multi-call 기능을 production에서 사용 중이라면 본 release로 그 기능을 잃는다. CHANGELOG와 README의 breaking 안내로 충분히 고지한다.
- benchmark/transcript는 runtime raw result의 `stats`를 직접 사용하도록 단순화한다. MCP 응답에는 `stats`도 전파되지 않는다.
- `failover` provider 같은 다른 운영 기능은 본 spec 범위 밖이며 영향 받지 않는다.
- 본 spec은 P0/P1 작업을 차단하지 않는다. 단일 PR로 처리하되 commit은 Phase 단위 5개로 끊어 bisect/rollback 단위를 작게 가져간다 (plan.md "Commit 단위" 표 참고).
- 본 spec 완료 직후 spec 018(로컬 운영 로그 채널 — `_debug` 응답 제거의 운영 디버깅 대체 수단)을 별도로 시작한다. 본 spec은 spec 018을 차단하지 않으며 surface도 겹치지 않는다.
