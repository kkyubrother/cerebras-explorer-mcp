# Tasks: `_debug` 필드와 세션 기능 완전 제거

**Branch**: `017-remove-debug-and-session` (or `master`)
**Spec**: `specs/017-remove-debug-and-session/spec.md`
**Plan**: `specs/017-remove-debug-and-session/plan.md`

각 task는 단독으로 진행 가능. Phase 단위로 묶어 commit하거나 전체 한 commit으로 묶어도 됨 (사용자는 단일 PR + 단일 commit 결정).

## Current status audit — 2026-05-27

- 실제 `master`/`origin/master` 기준으로 spec 017 제거 작업은 대부분 반영됨.
- `T-059`는 런타임 fallback 동작은 제거됐지만 benchmark 테스트 fixture에 legacy `_debug` 객체가 남아 있어 미완료로 둠.
- `T-094`는 선택 live API 검증이며 이번 audit에서는 실행하지 않았으므로 미체크로 둠.
- 확인 명령:
  - `npm test` → 372 tests, 369 pass, 3 skipped, 0 fail
  - `npm pack --dry-run --json` → `@kkyubrother/cerebras-explorer-mcp@0.6.1`, 82 files

## Phase 1 — Schema 변경

- [x] **T-001**: `src/explorer/schemas.mjs` `EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const`: 1 → 2.
- [x] **T-002**: `src/explorer/schemas.mjs` `EXPLORE_REPO_OUTPUT_SCHEMA.properties`에서 `_debug` 키 제거.
- [x] **T-003**: `src/explorer/schemas.mjs` `EXPLORE_REPO_OUTPUT_SCHEMA.properties`에서 `sessionId`, `session` 키 제거.
- [x] **T-004**: `src/explorer/schemas.mjs` `EXPLORE_REPO_INPUT_SCHEMA.properties`에서 `session` 키 제거.
- [x] **T-005**: `src/explorer/schemas.mjs` 응답 envelope normalizer에서 `safe._debug` 처리 제거 (라인 517 부근).
- [x] **T-006**: `src/explorer/schemas.mjs`에서 `SESSION_SCHEMA` 정의 제거. import 잔재 grep 확인.
- [x] **T-007**: 6 wrapper input schema(`FIND_RELEVANT_CODE_INPUT_SCHEMA`, `TRACE_SYMBOL_INPUT_SCHEMA`, `MAP_CHANGE_IMPACT_INPUT_SCHEMA`, `EXPLAIN_CODE_PATH_INPUT_SCHEMA`, `COLLECT_EVIDENCE_INPUT_SCHEMA`, `REVIEW_CHANGE_CONTEXT_INPUT_SCHEMA`) 각각에서 `session` 키 제거.
- [x] **T-008**: `validateExploreRepoArgs` 및 wrapper validator에서 `session` 관련 분기 제거.

## Phase 2 — Runtime 변경

- [x] **T-010**: `src/explorer/runtime.mjs` `AGENT_FACING_SCHEMA_VERSION`: 1 → 2.
- [x] **T-011**: `src/explorer/runtime.mjs` `result._debug` 빌드 제거 (라인 959 부근).
- [x] **T-012**: `src/explorer/runtime.mjs` `normalized._debug` 빌드 제거 (라인 1790 부근).
- [x] **T-013**: `src/explorer/runtime.mjs` `resolveSession` (또는 동등 함수, 라인 1127-1196 부근) 제거.
- [x] **T-014**: `src/explorer/runtime.mjs` `syncRemainingCallsStat` (라인 1198-1213) 제거.
- [x] **T-015**: `src/explorer/runtime.mjs` 메인 호출 경로의 sessionResolution 처리 제거 (라인 1314, 1319, 1339, 1357, 1417, 1854, 1859, 1931 부근).
- [x] **T-016**: `src/explorer/runtime.mjs` `sessionStore.update` 부수효과 호출 제거 (라인 1815-1817, 2290-2302).
- [x] **T-017**: `src/explorer/runtime.mjs` `stats` 객체에서 `sessionId`/`sessionStatus`/`sessionSource`/`remainingCalls` 부여 제거.
- [x] **T-018**: `src/explorer/runtime.mjs` `SessionStore` import 라인 제거.

## Phase 3 — MCP Server

- [x] **T-020**: `src/mcp/server.mjs` `toAgentFacingResult()`에서 `_debug` 빌더 제거 (라인 568, 590).
- [x] **T-021**: `src/mcp/server.mjs` `toAgentFacingResult()`에서 `sessionId`/`session` 빌더 제거 (라인 566, 588-589).
- [x] **T-022**: `src/mcp/server.mjs` `buildAgentSession` 함수 정의 제거.
- [x] **T-023**: `src/mcp/server.mjs` failure-shape helper에서 `_debug: {}` 제거 (라인 561).
- [x] **T-024**: `src/mcp/server.mjs` `schemaVersion ?? 1` → `?? 2` (라인 572).
- [x] **T-025**: `src/mcp/server.mjs` 6 wrapper의 sessionId echoing 코드 제거 (있다면).
- [x] **T-026**: `src/index.mjs`에서 `SessionStore` import 및 생성/주입 코드 제거.

## Phase 4 — Session 모듈 삭제

- [x] **T-030**: `git rm src/explorer/session.mjs`.
- [x] **T-031**: `git rm tests/session.test.mjs`.
- [x] **T-032**: `grep -r 'SessionStore' src/`이 0 매치인지 확인.
- [x] **T-033**: `grep -r 'session\.mjs' src/`이 0 매치인지 확인.

## Phase 5 — Benchmark / Critic

- [x] **T-040**: `src/benchmark/evaluator.mjs:13` `result?._debug?.stats ?? result?.stats ?? {}` → `result?.stats ?? {}`.
- [x] **T-041**: `src/benchmark/transcript-metrics.mjs`에서 `_debug` 의존 확인 후 정리.
- [x] **T-042**: `src/explorer/critic.mjs`에서 `stats.sessionId` 등 세션 파생 필드 참조 제거.

## Phase 6 — 테스트 갱신

- [x] **T-050**: `tests/schemas.test.mjs` `schemaVersion === 1` → 2 (라인 231).
- [x] **T-051**: `tests/schemas.test.mjs` 회귀 가드 추가 (spec FR-051).
- [x] **T-052**: `tests/mcp-server.test.mjs` `schemaVersion: 1` → 2 (3곳: 279, 599, 718).
- [x] **T-053**: `tests/mcp-server.test.mjs` session/sessionId/`_debug` assertion 제거.
- [x] **T-054**: `tests/mcp-server.test.mjs` 회귀 가드 추가 (spec FR-052).
- [x] **T-055**: `tests/runtime.mock.test.mjs` `schemaVersion === 1` → 2 (3곳: 261, 684, 1589).
- [x] **T-056**: `tests/runtime.mock.test.mjs` session/sessionId fixture 및 assertion 56건 제거.
- [x] **T-057**: `tests/integrations.test.mjs` `schemaVersion === 1` → 2 (라인 38), session fixture 정리.
- [x] **T-058**: `tests/integration-script.test.mjs` session 흐름 케이스 제거.
- [ ] **T-059**: `tests/benchmark-evaluator.test.mjs`, `tests/benchmark-transcript-metrics.test.mjs`에서 `_debug` fallback 케이스 제거. 부분 완료: fallback 동작은 제거됐고, legacy `_debug` 객체가 negative/stale fixture로만 남아 있음.
- [x] **T-060**: `scripts/integration-test.mjs`에서 session reuse 케이스 제거 또는 단순 호출로 교체.

## Phase 7 — 문서 갱신

- [x] **T-070**: `README.md:169` Compact 반환 계약 단락 갱신.
- [x] **T-071**: `README.md:193` control-plane 필드 목록에서 `session/sessionId` 삭제.
- [x] **T-072**: `README.md:213, 334` 입력 `session` 설명 삭제.
- [x] **T-073**: `README.md:273-279` 응답 예시에서 `sessionId`/`session` 줄 삭제, `schemaVersion` 2로.
- [x] **T-074**: `README.md:290` `session.id` 단락 삭제.
- [x] **T-075**: `README.md:297, 301-310` `_debug` 설명 단락 및 예시 JSON 블록 삭제.
- [x] **T-076**: `README.md:587` Codex 가이드의 "Reuse sessionId as session" 줄 삭제.
- [x] **T-077**: `README.md:707` 벤치마크 구조 체크 목록의 `sessionId` 삭제.
- [x] **T-078**: `DESIGN.md §5` 세션 enum 표 삭제, 세션 기능 제거 사실 한 문장 명시.
- [x] **T-079**: `DESIGN.md §9` JSON envelope 예시에서 `sessionId`/`session`/`_debug` 필드 삭제, `schemaVersion` 2로.
- [x] **T-080**: `DESIGN.md §11.7` 단락의 세션 부분 삭제, progress notification 가이드만 남김.
- [x] **T-081**: `CHANGELOG.md`에 새 release(0.6.0) 라인 추가, breaking 명시.
- [x] **T-082**: `integrations/codex/AGENTS.md.example`에서 "Reuse sessionId as session for follow-up calls." 줄 제거.

## Phase 8 — 버전 bump 및 검증

- [x] **T-090**: `package.json` version 0.5.0 → 0.6.0. 현재 checkout은 후속 release로 0.6.1.
- [x] **T-091**: `src/mcp/server.mjs` `SERVER_INFO.version` 0.6.0. 현재 checkout은 후속 release로 0.6.1.
- [x] **T-092**: `npm test` 전체 0 failures.
- [x] **T-093**: `npm pack --dry-run --json`으로 패키지 메타 확인.
- [ ] **T-094**: (선택) `CEREBRAS_API_KEY="..." node ./scripts/integration-test.mjs` 라이브 검증.
- [x] **T-095**: commit, tag (`v0.6.0`), push (README의 "새 버전 릴리즈" 절차).
- [x] **T-096**: `grep -rn 'github:kkyubrother/cerebras-explorer-mcp#v0.5.0' README.md integrations/`로 옛 tag를 모두 v0.6.0으로 sed 치환.

## 회귀 가드 요약

- [x] `npm test` 0 failures.
- [x] `EXPLORE_REPO_OUTPUT_SCHEMA.properties._debug === undefined`.
- [x] `EXPLORE_REPO_OUTPUT_SCHEMA.properties.sessionId === undefined`.
- [x] `EXPLORE_REPO_OUTPUT_SCHEMA.properties.session === undefined`.
- [x] `EXPLORE_REPO_INPUT_SCHEMA.properties.session === undefined`.
- [x] `EXPLORE_REPO_OUTPUT_SCHEMA.properties.schemaVersion.const === 2`.
- [x] `grep -r 'SessionStore' src/` 0 매치.
- [x] `grep -r '_debug' src/` 결과가 (a) 의도된 잔존(예: 주석)만, (b) 또는 0건.
- [x] `git ls-files src/explorer/session.mjs tests/session.test.mjs`가 빈 결과.
