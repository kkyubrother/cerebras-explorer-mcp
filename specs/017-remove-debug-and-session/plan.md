# Implementation Plan: `_debug` 필드와 세션 기능 완전 제거

**Branch**: `017-remove-debug-and-session` (or `master`) | **Date**: 2026-05-26 | **Spec**: `specs/017-remove-debug-and-session/spec.md`

## Summary

MCP `structuredContent` 응답에서 `_debug`, `sessionId`, `session` 세 필드를 제거하고, 입력 schema에서 `session` 파라미터를 제거하며, `SessionStore` 모듈과 관련 런타임/테스트 코드를 모두 정리한다. `schemaVersion`을 1에서 2로 올리고 단일 breaking change로 다음 minor release(0.6.0)에 묶어 출시한다.

raw runtime result의 `stats` 객체는 critic/transcript/benchmark의 입력으로 유지하되 MCP 응답으로는 전파되지 않는다. 세션 파생 stat(`sessionId`, `sessionStatus`, `sessionSource`, `remainingCalls`)만 stats에서도 제거된다.

## Technical Context

**Language/Version**: Node.js 22+ ESM.

**Primary Dependencies**: 변경 없음. zero dependencies 원칙 유지.

**Testing**: `npm test` 전체. 핵심 회귀:
- `node --test tests/schemas.test.mjs`
- `node --test tests/mcp-server.test.mjs`
- `node --test tests/runtime.mock.test.mjs`
- `node --test tests/integrations.test.mjs`

**Constraints**:
- 입력 schema는 `additionalProperties: false`이므로 입력에서 `session` 제거 시 기존 호출자가 `session`을 넘기면 즉시 reject된다.
- breaking change는 단일 PR + 단일 release로 처리. 단계별 deprecation 없음.
- transcript JSONL은 read-only 기록물이라 마이그레이션 제공 안 함. schemaVersion 1/2 혼재 가능.
- progress notification (`_meta.progressToken`) 기능은 세션과 독립이라 그대로 유지.

**Scale/Scope**:
- `src/` 변경 라인 ~150-200 (제거 위주)
- `src/explorer/session.mjs` 파일 삭제 (~250 lines)
- `tests/` 변경 라인 ~100, `tests/session.test.mjs` 삭제 (~600 lines)
- README/DESIGN 문서 변경 라인 ~50
- CHANGELOG에 새 release 라인 추가

## Constitution Check

- **FR-001~006 게이트** (_debug 제거): MCP envelope, runtime, schema, benchmark fallback 모두 일관 제거. critic/transcript는 raw result의 `stats`만 본다.
- **FR-010~021 게이트** (세션 제거): 모듈 삭제 + import 정리 + schema 정리 + 테스트 갱신. `grep -r SessionStore src/`가 0 매치여야 한다.
- **FR-030~033 게이트** (schemaVersion bump): const, 상수, fallback, 테스트 fixture 일관 갱신.
- **FR-040~044 게이트** (문서 갱신): README 9개 위치, DESIGN 3개 섹션, CHANGELOG, integration 예시.
- **FR-050~052 게이트** (회귀 가드): 새 schema-level 회귀 가드 + MCP envelope-level 회귀 가드.

게이트 평가: 위반 없음. 단일 breaking change로 일관 처리.

## Project Structure

```text
specs/017-remove-debug-and-session/
├── spec.md
├── plan.md
└── tasks.md
```

코드 변경:
```text
src/explorer/session.mjs              # 파일 삭제
src/explorer/runtime.mjs              # 세션 라이프사이클·_debug 빌드·stats 세션 필드 제거, AGENT_FACING_SCHEMA_VERSION 2
src/explorer/schemas.mjs              # input/output schema에서 _debug/sessionId/session 제거, schemaVersion const 2
src/explorer/critic.mjs               # raw stats 그대로 사용 — 변경 최소화
src/mcp/server.mjs                    # toAgentFacingResult/buildAgentSession 정리, _debug/sessionId/session 빌더 제거
src/index.mjs                         # SessionStore import 제거
src/benchmark/evaluator.mjs           # result._debug?.stats 경로 제거
src/benchmark/transcript-metrics.mjs  # _debug 의존 여부 확인 후 정리
tests/session.test.mjs                # 파일 삭제
tests/mcp-server.test.mjs             # session/_debug assertion 제거, schemaVersion 2
tests/schemas.test.mjs                # 회귀 가드 추가, schemaVersion 2
tests/runtime.mock.test.mjs           # session fixture 제거, schemaVersion 2
tests/integrations.test.mjs           # schemaVersion 2
tests/integration-script.test.mjs     # session 흐름 케이스 제거
tests/benchmark-evaluator.test.mjs    # _debug fallback 제거
tests/benchmark-transcript-metrics.test.mjs  # 영향 확인
scripts/integration-test.mjs          # session reuse 케이스 제거
CHANGELOG.md                          # breaking 항목 추가
README.md                             # 9개 위치 갱신
DESIGN.md                             # §5/§9/§11.7 갱신
package.json                          # version 0.6.0
src/mcp/server.mjs (SERVER_INFO)      # version 0.6.0
integrations/codex/AGENTS.md.example  # session 가이드 제거
```

## Implementation Outline

### Phase 1 — Schema 변경 (가장 안전한 분리 가능 단위)

(1) `src/explorer/schemas.mjs`:
- `EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const`: 1 → 2.
- `EXPLORE_REPO_OUTPUT_SCHEMA.properties`에서 `_debug`, `sessionId`, `session` 키 제거.
- `EXPLORE_REPO_INPUT_SCHEMA.properties`에서 `session` 키 제거.
- 응답 envelope normalizer(라인 517 부근의 `safe._debug` 처리)에서 `_debug` 처리 제거.
- `SESSION_SCHEMA` 정의 자체 제거 (다른 곳에서 import되지 않는지 확인).
- 6개 wrapper input schema에서도 `session` 제거 (각 wrapper schema는 동일 파일에 정의됨).

(2) `tests/schemas.test.mjs`:
- 회귀 가드 추가 (FR-051).
- 기존 `schemaVersion: 1` assertion → 2.

### Phase 2 — Runtime 변경

(3) `src/explorer/runtime.mjs`:
- `AGENT_FACING_SCHEMA_VERSION = 2`.
- `result._debug` 빌드 두 곳 제거 (라인 959, 1790 부근).
- 세션 라이프사이클 함수 제거:
  - `resolveSession` (또는 동등 함수, 라인 1127-1196 부근).
  - `syncRemainingCallsStat` (라인 1198-1213 부근).
  - sessionResolution 분기와 sessionId 전파 (라인 1314-1417, 1854-1931, 2290-2302 부근).
- `stats` 객체에서 `sessionId`, `sessionStatus`, `sessionSource`, `remainingCalls` 부여 제거.
- `SessionStore` import 제거.
- `args.session` 인자 처리 제거 (validateExploreRepoArgs 단계에서 이미 reject되지만 방어적으로).

### Phase 3 — MCP Server 변경

(4) `src/mcp/server.mjs`:
- `toAgentFacingResult()`에서 `_debug`, `sessionId`, `session` 빌더 제거 (라인 565-592).
- `buildAgentSession` 함수 정의 제거.
- failure-shape helper에서 `_debug: {}` 제거 (라인 561).
- `schemaVersion ?? 1` fallback → `?? 2` (라인 572).
- 6개 wrapper 도구의 input schema에서 `session` 키 제거. wrapper의 sessionId echoing 코드가 있다면 제거.

(5) `src/index.mjs`:
- `SessionStore` import 제거.
- `SessionStore` 생성/주입 코드 제거.

### Phase 4 — Session 모듈 삭제

(6) `src/explorer/session.mjs` 파일 삭제.

(7) `tests/session.test.mjs` 파일 삭제.

### Phase 5 — Benchmark / Critic / Transcript

(8) `src/benchmark/evaluator.mjs:13`:
- `result?._debug?.stats ?? result?.stats ?? {}` → `result?.stats ?? {}`.

(9) `src/benchmark/transcript-metrics.mjs`:
- `_debug` 경로 의존 여부 확인. 의존하면 `stats` 직접 참조로 단순화.

(10) `src/explorer/critic.mjs`:
- `stats.sessionId` 등 세션 파생 필드 참조 제거. critic 본체는 다른 stats 필드만 보면 OK.

### Phase 6 — 테스트 갱신

(11) `tests/mcp-server.test.mjs`:
- `schemaVersion: 1` → 2 (3곳: 라인 279, 599, 718).
- session/sessionId assertion 제거.
- `_debug` assertion 제거.
- 회귀 가드 추가 (FR-052).

(12) `tests/runtime.mock.test.mjs`:
- `schemaVersion === 1` → 2 (3곳: 라인 261, 684, 1589).
- session fixture와 sessionId assertion 제거 (56건 grep으로 매핑).

(13) `tests/integrations.test.mjs`:
- `schemaVersion === 1` → 2 (라인 38).
- session 관련 fixture 정리.

(14) `tests/integration-script.test.mjs`:
- session 흐름 케이스 제거.

(15) `tests/benchmark-evaluator.test.mjs`, `tests/benchmark-transcript-metrics.test.mjs`:
- `_debug` fallback 의존 케이스 제거.

(16) `scripts/integration-test.mjs`:
- session reuse 검증 케이스 제거 또는 단순 호출로 교체.

### Phase 7 — 문서 갱신

(17) `README.md` 9개 위치 (spec FR-040 목록 참고):
- 169행: "Compact 반환 계약"에서 `session`, `sessionId`, `_debug.stats`, `_debug.toolTrace` 언급 제거. 갱신된 계약을 한 줄로.
- 193행: control-plane 필드 목록에서 `session/sessionId` 삭제.
- 213, 334행: 입력 `session` 설명 삭제.
- 273-279행: 응답 예시에서 `sessionId`/`session` 줄 삭제. `"schemaVersion": 1` → 2.
- 290행: `session.id` 단락 삭제.
- 297, 301-310행: `_debug` 설명 단락과 예시 JSON 블록 삭제.
- 587행: Codex 가이드의 "Reuse sessionId as session" 줄 삭제.
- 707행: 벤치마크 구조 체크 목록의 `sessionId` 삭제.

(18) `DESIGN.md`:
- §5 MCP Server 세션 enum 표 (DESIGN.md:550-570 부근) — 표 자체 삭제, 세션 기능 제거 사실 한 문장 명시.
- §9 JSON envelope 예시에서 `sessionId`/`session`/`_debug` 필드 삭제, `schemaVersion` 2로 갱신.
- §11.7 단락 — 세션 부분 삭제, progress notification 가이드만 남김.

(19) `CHANGELOG.md`:
- 새 release 라인(0.6.0) 추가.
- "BREAKING: response no longer includes `_debug`, `sessionId`, `session`; input `session` parameter removed; SessionStore module deleted; schemaVersion bumped to 2"를 핵심 항목으로.

(20) `integrations/codex/AGENTS.md.example`:
- `Reuse sessionId as session for follow-up calls.` 줄 제거. 다른 wrapper 가이드 줄은 유지.

### Phase 8 — 버전 bump 및 검증

(21) `package.json`: version 0.5.0 → 0.6.0.

(22) `src/mcp/server.mjs`의 `SERVER_INFO.version`: 0.6.0.

(23) `npm test` 전체 0 failures 확인.

(24) `npm pack --dry-run --json`으로 패키지 메타 확인.

(25) `CEREBRAS_API_KEY="..." node ./scripts/integration-test.mjs`로 라이브 통합 검증 (선택, 추후 PC에서).

(26) commit & tag & push (README의 "새 버전 릴리즈" 절차에 따라).

## Complexity Tracking

- **runtime의 세션 라이프사이클 제거**: `resolveSession`이 호출되는 모든 분기를 명확히 찾아 함께 제거해야 한다. `sessionStore.update(sessionId, normalized)` 같은 부수효과 호출도 다 사라져야 한다 (라인 1815-1817, 2290-2302). grep으로 `sessionStore.`/`sessionId` 식별자가 src/에서 0건이 되는지 확인.
- **stats 객체 구조**: critic.mjs:10건의 stats. 접근이 `stats.toolCalls` 류만 보고 세션 파생 필드를 안 보는지 확인. 안 본다면 critic은 변경 최소화로 끝남.
- **MCP server의 wrapper 6개**: 각 wrapper가 자기 input schema에서 `session`을 따로 정의했는지, 아니면 공용 schema fragment를 참조하는지 확인. 공용이면 한 번에 정리, 개별 정의면 6번 정리.
- **transcript JSONL backward compatibility**: schemaVersion 1로 기록된 과거 transcript가 분석 도구에서 깨지는지 확인. read-only이므로 신규 record만 schemaVersion 2가 들어간다. 분석 도구가 schemaVersion을 보고 분기하지 않는다면 영향 없음.
- **외부 사용자의 session 의존**: 본인 외 사용자가 session multi-call을 production에서 쓰는지는 불명. CHANGELOG와 README breaking 안내로 고지.
- **`failover` provider 등 다른 운영 기능**: 본 spec과 독립. 영향 없음.
- **plan 자체에 대한 reversibility**: 본 spec은 명백한 breaking이다. 되돌리려면 또 다른 spec이 필요. 사용자 결정에 따라 Phase 단위 5 commit으로 끊어 rollback/bisect 단위를 작게 가져간다 (아래 "Commit 단위" 표 참고).

## Commit 단위 (확정)

| Commit | 범위 | 메시지 prefix |
|---|---|---|
| C1 | Phase 1+2+3 (schemas + runtime + mcp server) | `refactor(spec-017): drop _debug, session, and sessionId from response/input contracts` |
| C2 | Phase 4+5 (session.mjs 삭제, benchmark/critic 정리) | `refactor(spec-017): remove SessionStore module and benchmark fallbacks` |
| C3 | Phase 6 (테스트 갱신) | `test(spec-017): align tests with schemaVersion 2 contract` |
| C4 | Phase 7 (README/DESIGN/CHANGELOG/integrations) | `docs(spec-017): document breaking change and remove session/_debug references` |
| C5 | Phase 8 (버전 bump + tag + push) | `chore: release v0.6.0` |

C1을 한 덩어리로 가는 이유: schema와 runtime/server가 어긋나면 모든 테스트가 깨진다. C2부터는 surface가 정합 상태라 단독으로 끊어도 빌드/테스트 통과해야 한다. 각 commit 끝에 `npm test`로 0 failures 확인 후 다음 commit으로 넘어간다 (C4 문서 commit은 코드 영향 없으므로 검증 생략 가능).

## Out of Scope

- progress notification (`_meta.progressToken`) 흐름 — 그대로 유지.
- `failover` provider 기능 — 그대로 유지.
- `_debug` 같은 운영 메타데이터를 응답에 다시 노출하는 envvar 옵트인 — 추가 안 함. parent agent는 어차피 `_debug`를 사람에게 보여주지 않으므로 응답 채널은 운영 디버깅 용도로 부적합. **로컬 운영 로그(stderr 또는 파일)는 후속 spec 018에서 별도 채널로 도입**한다 (본 spec과 독립).
- transcript schemaVersion 1 → 2 자동 마이그레이션 — 제공 안 함.
- explore의 markdown 본문 contract — 변경 없음. `citations[]`/`targets[]`는 그대로.
- 6 wrapper 도구 자체의 surface — 그대로 8개 고정.
