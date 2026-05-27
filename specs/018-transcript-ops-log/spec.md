# Feature Specification: transcript를 운영 디버깅 채널로 재정의 (`_debug` 응답 표면 제거 보완)

**Feature Branch**: `018-transcript-ops-log` (작업은 master에서 진행)

**Created**: 2026-05-27

**Status**: Draft

**Input**: User description: "spec 017에서 응답의 `_debug` / `sessionId` / `session`을 제거했다. 운영 디버깅 채널이 필요하지만 응답 표면에 다시 박는 것은 사용자가 명시적으로 거부했다. 기존 transcript 메커니즘이 거의 같은 역할을 하므로 이를 운영 디버깅 채널로 재정의하고 적용 범위·옵트인 방식·보안 경계를 정리한다."

## Clarifications

### Session 2026-05-27

- **Q: 출력 채널** → **A: 기존 transcript 메커니즘 재사용 + 적용 범위 확장.** 새 ops log 채널을 만들지 않고 기존 transcript을 운영 디버깅 채널로 재정의한다.
- **Q: transcript 정체성** → **A: transcript 재정의 — LLM 메시지·tool calls·per-call summary 모두 한 JSONL에 유지.** `_debug` 응답 표면 대체 = transcript. 새 채널 없음.
- **Q: 옵트인 + envvar 이름** → **A: `CEREBRAS_EXPLORER_LOG_PATH` 신규 (path-implies-opt-in)**, 기존 `CEREBRAS_EXPLORER_TRANSCRIPT`/`CEREBRAS_EXPLORER_TRANSCRIPT_DIR`은 hidden alias (README/DESIGN 안내 제거, 코드는 받음), v0.7에서 완전 제거 예고.
- **Q: Redaction 정책** → **A: 응답과 동일 redaction을 기본 적용 + `CEREBRAS_EXPLORER_LOG_RAW=true` opt-in으로 raw 디버깅 모드 지원.**
- **Q: stderr 보조 채널** → **A: finalize 시 한 줄 요약을 stderr에 항상 출력** — `[cerebras-explorer] tool=... turns=... toolCalls=... stoppedByBudget=... elapsed=...s log=<path>?` (envvar 무관).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 운영자가 모든 explore 호출의 흐름을 transcript로 디버깅한다 (Priority: P1)

운영자가 `CEREBRAS_EXPLORER_LOG_PATH=/tmp/explorer-log`를 설정하면 `explore_repo`, 8개 도구 surface 어느 것을 호출하든 해당 디렉토리에 호출별 JSONL 파일이 자동 생성된다. 파일에는 LLM 메시지, tool 호출 인자/결과 요약, 그리고 finalize meta(turn 수, budget 상태, elapsed)가 함께 들어 있어 사용자가 `jq` / `grep`만으로 "이번 탐색이 왜 그렇게 진행됐는가"를 추적할 수 있다.

**Why this priority**: spec 017에서 응답에서 `_debug`가 사라진 직접적 영향이 "운영 디버깅이 안 된다"는 것이었다. P1로 가장 먼저 복원한다.

**Independent Test**: 임의의 explore 호출을 하나 한 뒤 `LOG_PATH` 디렉토리에 새 JSONL 파일이 생성됐는지, finalize meta record가 마지막 줄에 들어 있는지 확인하면 단독으로 검증된다.

**Acceptance Scenarios**:

1. **Given** `CEREBRAS_EXPLORER_LOG_PATH=/tmp/ops` 설정, **When** `explore_repo` 호출, **Then** `/tmp/ops/{ISO8601}_{UUID}.jsonl` 파일이 생성되고 record 첫 줄에 `type:"meta"` + `tool:"explore_repo"`가 들어 있다.
2. **Given** `CEREBRAS_EXPLORER_LOG_PATH=/tmp/ops` 설정, **When** 6개 wrapper 중 임의의 도구 호출, **Then** 동일하게 wrapper별 파일이 생성된다 (이전에는 `freeExploreV2`만 transcript 기록).
3. **Given** `LOG_PATH` 미설정, **When** explore 호출, **Then** transcript 파일이 생성되지 않고 호출 자체는 정상 완료된다.

---

### User Story 2 - 운영자가 옵트인 없이 한 줄 요약으로 호출 결과를 즉시 확인한다 (Priority: P1)

운영자가 `LOG_PATH`를 설정하지 않아도 호출이 끝날 때 stderr에 한 줄 요약(`[cerebras-explorer] tool=... turns=... toolCalls=... stoppedByBudget=... elapsed=...s`)이 항상 출력된다. `LOG_PATH`가 설정되어 있을 때는 같은 라인 끝에 `log=<path>`가 붙어 사용자가 어느 파일을 봐야 하는지 즉시 알 수 있다. MCP 프로토콜 채널인 stdout는 영향 받지 않는다.

**Why this priority**: 옵트인 파일이 없어도 즉시 운영 신호를 얻는 가장 가벼운 디버깅 표면. P1.

**Independent Test**: explore 호출을 stderr 캡처(`2> out.log`)한 뒤 캡처 파일에 한 줄 요약이 들어 있는지, stdout(JSON-RPC frame)은 오염되지 않았는지 단독 검증.

**Acceptance Scenarios**:

1. **Given** stderr 캡처, **When** 임의의 explore 호출, **Then** stderr 마지막 줄에 `[cerebras-explorer]` 접두어로 시작하는 한 줄 요약이 들어 있다.
2. **Given** `LOG_PATH` 설정, **When** 호출, **Then** 요약 끝에 `log=<path>` 토큰이 포함된다.
3. **Given** `LOG_PATH` 미설정, **When** 호출, **Then** 요약 끝에 `log=` 토큰이 포함되지 않는다.
4. **Given** stdout JSON-RPC 캡처, **When** 호출, **Then** stdout에는 한 줄 요약 문자열이 포함되지 않는다 (stdio purity).

---

### User Story 3 - 운영자가 새 envvar로 옵트인하고, 기존 envvar 사용자는 영향 없이 동작한다 (Priority: P1)

`CEREBRAS_EXPLORER_LOG_PATH`만 설정한 사용자는 별도 enable 플래그 없이 transcript이 자동으로 켜진다. 동시에 v0.5.x 이전에 `CEREBRAS_EXPLORER_TRANSCRIPT=true` + `CEREBRAS_EXPLORER_TRANSCRIPT_DIR=...`로 설정해둔 사용자는 코드가 같은 디렉토리·동작을 그대로 유지한다. 두 envvar 그룹이 동시에 설정되면 `LOG_PATH`가 우선한다.

**Why this priority**: breaking 영향을 줄이면서 새 이름을 1순위로 끌어올린다. P1.

**Independent Test**: 4개 envvar 조합(LOG_PATH only / TRANSCRIPT only / 둘 다 / 둘 다 없음)에서 각각 기대 동작을 단위 테스트로 검증.

**Acceptance Scenarios**:

1. **Given** `LOG_PATH=/a`만 설정, **When** 호출, **Then** `/a` 아래에 파일이 생성된다 (enable 플래그 불필요).
2. **Given** `TRANSCRIPT=true` + `TRANSCRIPT_DIR=/b`만 설정, **When** 호출, **Then** `/b` 아래에 파일이 생성된다 (backward-compat).
3. **Given** `LOG_PATH=/a` + `TRANSCRIPT_DIR=/b` 둘 다, **When** 호출, **Then** `/a` 아래에 파일이 생성된다 (`LOG_PATH` 우선).
4. **Given** `LOG_PATH` `TRANSCRIPT` 모두 미설정, **When** 호출, **Then** 파일 생성 안 됨 (기본은 off).
5. **Given** README/DESIGN, **When** grep `CEREBRAS_EXPLORER_TRANSCRIPT`, **Then** 사용자 안내 문서에서는 매치되지 않고 CHANGELOG의 deprecation 안내 한 곳만 매치된다.

---

### User Story 4 - 운영자가 transcript을 공유할 때 secret이 자동 마스킹된다 (Priority: P1)

`LOG_PATH` 디렉토리의 파일을 운영자가 동료에게 첨부할 때, API key / PAT / JWT / private key 패턴이 `[REDACTED:<rule>]`로 마스킹되어 있어야 한다. `.env`, `.ssh/**`, `credentials.json` 같은 deny-list 경로의 파일 본문이 raw로 기록되어서도 안 된다. 응답 표면에 적용되는 secret 정책이 transcript에도 동일하게 적용된다. 디버깅 목적으로 raw 데이터가 필요한 경우에만 `CEREBRAS_EXPLORER_LOG_RAW=true`로 명시적 opt-in한다.

**Why this priority**: spec 017이 응답 표면을 줄인 보안 일관성 결정과 같은 경계를 transcript에 적용한다. P1.

**Independent Test**: 합성 secret 패턴(예: 가짜 OpenAI API key 형식)을 포함한 fixture를 explorer가 읽게 만든 뒤, transcript 파일에서 그 secret이 `[REDACTED:*]`로 치환됐는지 grep으로 단독 검증. `LOG_RAW=true` 설정 시에는 raw로 남는지 별도 검증.

**Acceptance Scenarios**:

1. **Given** fixture에 가짜 API key 패턴 포함, **When** explorer가 그 파일을 읽고 LOG_PATH에 기록, **Then** transcript에는 `[REDACTED:api-key]`로 치환되어 있다.
2. **Given** fixture에 `.env` 파일 존재, **When** explorer가 `repo_read_file`로 그것을 시도, **Then** transcript에 그 파일 본문이 raw로 들어가지 않는다 (deny-list 우선).
3. **Given** `CEREBRAS_EXPLORER_LOG_RAW=true` + 동일 fixture, **When** 호출, **Then** transcript에 raw secret이 남는다 (디버깅 모드 opt-in).
4. **Given** `LOG_RAW=true` 설정, **When** stderr 한 줄 요약, **Then** `raw=true` 토큰이 요약 라인에 포함되어 운영자가 raw 모드임을 즉시 인지한다.

---

### Edge Cases

- `LOG_PATH`가 쓰기 권한 없는 디렉토리를 가리킬 때: 첫 record가 실패해도 explorer 호출 자체는 실패하지 않는다(fire-and-forget). stderr 한 줄 요약은 그대로 출력되고 `log=` 토큰은 생략된다.
- `LOG_PATH`가 존재하지 않는 디렉토리: lazy mkdir 시도. 실패 시 위 경우와 동일하게 silent fail.
- 동시 호출 다수: 파일명에 timestamp + UUID가 있어 충돌 없음.
- 호출이 abort/cancellation으로 중단: 그때까지의 buffer는 flush, finalize meta는 `aborted:true` 마커와 함께 기록.
- 매우 긴 LLM 메시지: 기존 transcript의 `truncateString` / `compactValue` 정책을 그대로 유지한다.
- `LOG_RAW=true`인데 `LOG_PATH` 미설정: stderr 한 줄 요약에만 `raw=true`가 표시되고 파일은 만들어지지 않는다 (raw 모드는 파일 채널에 적용되는 정책).
- `LOG_PATH`가 절대경로 vs 상대경로: 절대경로는 그대로 사용, 상대경로는 `process.cwd()` 기준으로 resolve. 둘 다 허용.

## Requirements *(mandatory)*

### Functional Requirements

#### 적용 범위 확장

- **FR-001**: `src/explorer/runtime.mjs`의 `ExplorerRuntime.explore()`도 `freeExploreV2`와 동일하게 `createTranscriptRecorder`를 통해 transcript를 기록한다.
- **FR-002**: 6개 wrapper 도구는 내부적으로 `explore_repo`에 위임하므로 자동으로 transcript 기록 대상에 포함된다 (FR-001의 자연 귀결).
- **FR-003**: `system`/`user`/`assistant`/`tool`/`meta` record 타입 정의는 현행 `transcript.mjs`를 그대로 사용한다 (스키마 추가 변경 없음).

#### envvar surface

- **FR-010**: 새 envvar `CEREBRAS_EXPLORER_LOG_PATH`를 도입한다. 절대경로 또는 상대경로 문자열을 받는다. 설정되면 그 경로를 transcript 디렉토리로 사용하고 동시에 transcript 기능을 enable한다 (path-implies-opt-in).
- **FR-011**: 기존 `CEREBRAS_EXPLORER_TRANSCRIPT` 및 `CEREBRAS_EXPLORER_TRANSCRIPT_DIR`은 backward-compat alias로 코드가 계속 받는다. 동작 변경 없음.
- **FR-012**: 둘 다 설정된 경우 우선순위는 `CEREBRAS_EXPLORER_LOG_PATH` > `CEREBRAS_EXPLORER_TRANSCRIPT_DIR`. enable 신호는 `LOG_PATH` 존재 또는 `TRANSCRIPT` truthy 값 중 어느 하나라도 만족하면 true.
- **FR-013**: README, DESIGN.md, integrations/ 문서에서 `CEREBRAS_EXPLORER_TRANSCRIPT*` 사용자 안내를 모두 제거하고 `CEREBRAS_EXPLORER_LOG_PATH`로 교체한다.
- **FR-014**: CHANGELOG에 `CEREBRAS_EXPLORER_TRANSCRIPT` / `CEREBRAS_EXPLORER_TRANSCRIPT_DIR`을 v0.7에서 제거 예정으로 명시한다.

#### Redaction

- **FR-020**: transcript에 기록되기 직전 모든 record는 redact를 통과한다. 적용되는 정책은 응답 표면에 적용되는 것과 동일하다 (secret deny-list 경로의 파일 본문 차단, API key/PAT/JWT/private key 패턴 → `[REDACTED:<rule>]`).
- **FR-021**: `CEREBRAS_EXPLORER_LOG_RAW=true`(truthy)일 때만 redaction을 우회한다. 기본은 redaction on.
- **FR-022**: redaction 적용 여부는 finalize meta record의 `redacted` 필드(boolean)로 명시한다.

#### stderr 한 줄 요약

- **FR-030**: explore 호출이 정상/abort/error 어느 경로로든 끝나면 stderr에 `[cerebras-explorer] tool=<name> turns=<n> toolCalls=<n> stoppedByBudget=<bool> elapsed=<n>s` 형태의 한 줄 요약을 항상 출력한다.
- **FR-031**: `LOG_PATH`가 설정되었고 transcript 파일이 정상 생성되면 라인 끝에 ` log=<path>`를 덧붙인다.
- **FR-032**: `CEREBRAS_EXPLORER_LOG_RAW=true`일 때는 라인 끝에 ` raw=true`를 덧붙인다.
- **FR-033**: stderr 출력은 stdout JSON-RPC 채널을 침범하지 않는다. 기존 `MCP_STDIO_GUARD` 정책과 호환된다.
- **FR-034**: 한 줄 요약 출력은 envvar로 비활성화할 수 있는 별도 토글을 제공하지 않는다 (디버깅 시그널은 항상 켜져 있어야 한다는 결정).

#### 회귀 가드

- **FR-040**: `npm test` 전체 0 failures.
- **FR-041**: `tests/transcript.test.mjs`(신규 또는 기존 확장)가 `LOG_PATH`-implies-opt-in, alias backward-compat, redaction 일관성, `LOG_RAW` 우회를 모두 단위 검증한다.
- **FR-042**: `tests/mcp-server.test.mjs` 또는 `tests/runtime.mock.test.mjs`에 회귀 가드: explore_repo가 transcript 파일을 만든다 (현재는 freeExploreV2만).
- **FR-043**: `tests/integrations.test.mjs`에 회귀 가드: README/DESIGN/integrations 문서에서 `CEREBRAS_EXPLORER_TRANSCRIPT*` 사용자 안내가 grep 0 매치 (CHANGELOG의 deprecation 안내 한 곳만 허용).

### Key Entities

- **Transcript 파일**: per-call JSONL. 파일명 `{ISO8601-with-dashes}_{tool}_{4byte-hex}.jsonl` (현행 유지) 또는 `{ISO8601}_{UUID}.jsonl` (plan 단계에서 확정). 위치는 `LOG_PATH` 또는 `TRANSCRIPT_DIR`.
- **transcript record 타입**: `meta`(시작/종료/stats), `system`/`user`/`assistant`(LLM 메시지), `tool`(tool 호출과 결과 요약).
- **finalize meta record**: 호출 끝에 기록되는 1개 line. 필드 후보 — `tool`, `turns`, `toolCalls`, `stoppedByBudget`, `elapsedMs`, `model`, `scope`, `evidenceSufficiency`, `redacted`. 정확한 필드 목록은 plan 단계에서 확정.
- **stderr 한 줄 요약**: `[cerebras-explorer] tool=... turns=... toolCalls=... stoppedByBudget=... elapsed=...s` (+`log=<path>`, +`raw=true`).
- **`CEREBRAS_EXPLORER_LOG_PATH` envvar**: 새 1차 envvar. path-implies-opt-in.
- **`CEREBRAS_EXPLORER_LOG_RAW` envvar**: 새 보조 envvar. truthy일 때 redaction 우회.
- **`CEREBRAS_EXPLORER_TRANSCRIPT` / `CEREBRAS_EXPLORER_TRANSCRIPT_DIR`**: deprecated alias, v0.7 제거 예정.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 임의의 `explore_repo` / 6 wrapper / `explore` 호출에서 `LOG_PATH`만 설정하면 100% 케이스에서 transcript 파일이 생성된다 (현재 `explore_repo`는 0%).
- **SC-002**: `LOG_PATH` 미설정 호출 100%에서 stderr에 한 줄 요약이 출력된다.
- **SC-003**: 합성 secret 패턴이 들어간 fixture를 explore가 읽었을 때, 기본 모드에서는 transcript에서 100% 마스킹된다 (deny-list 경로 + 패턴 양쪽).
- **SC-004**: `CEREBRAS_EXPLORER_LOG_RAW=true`로 명시적 opt-in한 경우에만 raw secret이 transcript에 보존된다 (회귀 가드).
- **SC-005**: README / DESIGN / integrations 문서에서 사용자가 새로 발견할 수 있는 envvar 이름은 `CEREBRAS_EXPLORER_LOG_PATH`와 `CEREBRAS_EXPLORER_LOG_RAW` 두 개뿐이다 (기존 envvar는 grep 0 매치 + CHANGELOG의 deprecation 안내 1개만 예외).
- **SC-006**: `npm test` 전체 0 failures.
- **SC-007**: 운영자가 임의의 explore 호출 후 30초 이내에 (a) stderr 한 줄 요약을 읽거나 (b) `LOG_PATH` 파일을 열어 핵심 디버깅 신호(turn 수, tool 호출 수, budget 상태)에 접근할 수 있다.

## Assumptions

- 본 spec은 명시적 **non-breaking** 변경이다. 기존 envvar 사용자는 v0.6.x 동안 영향 없이 동작하고, v0.7에서 alias 제거 시 CHANGELOG로 사전 안내한다.
- transcript 파일은 lazy mkdir + fire-and-forget 정책을 그대로 유지한다 — 파일 시스템 에러가 explorer 호출 실패로 전파되지 않는다.
- stderr 한 줄 요약은 cost가 미미하므로 envvar로 끄는 토글을 제공하지 않는다. 운영 시그널 차단 위험이 더 크다고 판단.
- 파일명 정확한 포맷(현행 vs 신규 UUID)은 plan 단계에서 결정한다. 사용자가 처음 제안한 `{ISO8601}_{UUID}.jsonl`은 후보 1, 현행 `{ISO8601}_{tool}_{4byte-hex}.jsonl`은 후보 2.
- finalize meta record의 정확한 필드 목록도 plan 단계에서 확정한다.
- benchmark/transcript-metrics는 본 spec에서 다루지 않는다. 별도 follow-up이 필요할 수 있다 (spec 017이 _debug 의존 fallback을 제거한 부수효과).
- spec 017의 `evidenceSufficiency`가 raw `stats`에 들어 있으므로 transcript의 finalize meta에 자연스럽게 포함된다 (추가 작업 불필요).
- 본 spec은 P0/P1 작업을 차단하지 않는다.
