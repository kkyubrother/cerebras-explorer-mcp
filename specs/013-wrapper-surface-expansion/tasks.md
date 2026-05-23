---
description: "Task list for spec 013 — Wrapper Surface Expansion (map_impact / find_entrypoints, v0.4.0)"
---

# Tasks: Wrapper Surface Expansion (map_impact / find_entrypoints, v0.4.0)

**Input**: Design documents from `specs/013-wrapper-surface-expansion/`

**Prerequisites**: `specs/013-wrapper-surface-expansion/spec.md`, `specs/013-wrapper-surface-expansion/plan.md`

**Tests**: Required. 두 wrapper의 validation/builder/dispatch/tools/list 동작은 신규 단위 테스트로 cover한다. release 단위 작업이므로 `npm test` 전체가 0 failures여야 한다.

**Organization**: User story 단위 + release 작업 묶음.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 만지고 선행 의존성이 없으면 병렬 가능
- **[Story]**: US1 = `map_impact`, US2 = `find_entrypoints`, US3 = surface 정책 갱신 + release
- 모든 경로는 저장소 루트 기준 상대 경로.

## Path Conventions

- 단일 프로젝트, 신규 디렉터리 없음.
- 코드 변경: `src/mcp/server.mjs`, `tests/mcp-server.test.mjs`, `tests/integrations.test.mjs`(install drift).
- 문서 변경: `README.md`, `DESIGN.md`, `CHANGELOG.md`, `package.json`, `integrations/**`.
- 메타 변경: `plan/extension-backlog.md`.

---

## Phase 1: Setup

- [x] T001 master 브랜치에서 시작, 작업 트리가 깨끗한지 확인 (`git status` clean). 기존 8개 도구 단위 테스트가 0 failures로 PASS함을 `npm test`로 한 번 확인 (회귀 baseline).

---

## Phase 2: User Story 1 — `map_impact` wrapper (P1)

**Purpose**: anchor 입력의 1급 시민 wrapper로 deep reference chain + test/config target 가중치를 제공한다.

- [x] T002 [US1] `src/mcp/server.mjs`에 `MAP_IMPACT_TOOL` 객체를 `REVIEW_CHANGE_CONTEXT_TOOL` 다음 위치에 추가. inputSchema는 spec.md FR-001 그대로. outputSchema는 `EXPLORE_REPO_OUTPUT_SCHEMA` 재사용. annotations는 readOnlyToolAnnotations.

- [x] T003 [US1] `src/mcp/server.mjs`에 `buildMapImpactArgs(args)` 함수를 추가. anchor가 슬래시 또는 `.` 확장자를 포함하면 `knownFiles`에 push, 그렇지 않으면 `knownSymbols`에 push. task 문자열에 changeType 의미 자연어 반영. `taskMode: 'impact_analysis'`, `hints.strategy: 'reference-chase'`.

- [x] T004 [US1] `src/mcp/server.mjs`의 `tools/call` switch에 `if (name === 'map_impact')` 분기 추가. validatePublicToolArgs → buildMapImpactArgs → callTool 흐름.

- [x] T005 [US1] `tests/mcp-server.test.mjs`에 신규 테스트 5개 추가: (i) `map_impact` validation rejects unknown key (spec 005 매트릭스 행 추가), (ii) anchor가 파일 경로 anchor일 때 `knownFiles`에 들어가는지, (iii) anchor가 심볼 이름일 때 `knownSymbols`에 들어가는지, (iv) anchor 누락 시 invalid_arguments error, (v) changeType=remove가 task 문자열에 반영되는지. mock chat client로 dispatch 까지 검증.

- [x] T006 [US1] `node --test tests/mcp-server.test.mjs` 단독 실행으로 신규 5개 테스트가 모두 PASS함을 확인.

**Checkpoint**: User Story 1만으로 `map_impact`가 단위 테스트로 검증된 채 master에 들어갈 수 있다.

---

## Phase 3: User Story 2 — `find_entrypoints` wrapper (P1)

**Purpose**: HTTP/CLI/cron/MCP/event 같은 entry point를 단일 wrapper 호출로 자동 감지.

- [x] T007 [US2] `src/mcp/server.mjs`에 `FIND_ENTRYPOINTS_TOOL` 객체를 `MAP_IMPACT_TOOL` 다음 위치에 추가. inputSchema는 spec.md FR-003 그대로. entryKind는 enum 검증으로 unknown kind 거부.

- [x] T008 [US2] `src/mcp/server.mjs`에 `buildFindEntrypointsArgs(args)` 함수를 추가. entryKind에 따라 spec.md FR-004의 정규식 패턴 묶음을 `hints.regex`에 자동 주입. `entryKind: 'all'`이면 다섯 카테고리 모두 합집합. task 문자열은 "Find entry points (HTTP routes / CLI commands / cron handlers / MCP tools / event handlers)" 형태. `taskMode: 'entry_point_discovery'`. task 끝에 false positive 안내 한 문장 추가 ("Entry-point detection is regex-based; verify each evidence line before acting.").

- [x] T009 [US2] `src/mcp/server.mjs`의 `tools/call` switch에 `if (name === 'find_entrypoints')` 분기 추가.

- [x] T010 [US2] `tests/mcp-server.test.mjs`에 신규 테스트 4개 추가: (i) `find_entrypoints` validation rejects unknown key, (ii) `entryKind: 'http'`가 HTTP 패턴만 hints.regex에 넣는지, (iii) `entryKind: 'all'`이 다섯 카테고리 합집합을 넣는지, (iv) `entryKind: 'unknown_kind'`가 enum 검증으로 거부되는지.

- [x] T011 [US2] `node --test tests/mcp-server.test.mjs` 단독 실행으로 신규 4개 테스트가 모두 PASS함을 확인.

**Checkpoint**: User Story 2만으로 `find_entrypoints` 단위 가드 완성.

---

## Phase 4: User Story 3 — surface 정책 갱신 + release 단위 동기화 (P2)

**Purpose**: spec 011의 surface 8 정책을 surface 10으로 명시 갱신하고, README/DESIGN/integrations/CHANGELOG/package.json/SERVER_INFO/install spec을 v0.4.0으로 일관 동기화한다.

- [x] T012 [US3] `src/mcp/server.mjs`의 `buildToolList()`를 8 항목 → 10 항목으로 확장. 순서: `find_relevant_code, trace_symbol, map_change_impact, map_impact, explain_code_path, collect_evidence, review_change_context, find_entrypoints, explore_repo, explore`. SERVER_INFO.version도 `'0.4.0'`으로 갱신. server description의 "Purpose shortcuts" 문구에 두 신규 도구 이름 추가.

- [x] T013 [US3] `tests/mcp-server.test.mjs`에 tools/list 응답이 정확히 10 항목을 반환하는지 검증하는 단위 테스트를 추가 또는 기존 같은 성격의 테스트를 8 → 10으로 갱신.

- [x] T014 [US3] `tests/integrations.test.mjs`의 install spec drift 가드에서 `v0.3.0` → `v0.4.0`으로 갱신. CHANGELOG/package.json/SERVER_INFO 일관성 가드도 v0.4.0 헤더가 존재하도록 갱신.

- [x] T015 [US3] `README.md`를 갱신: (a) "노출 도구 구성" 표에 `map_impact`/`find_entrypoints` row 두 개 추가, (b) "spec 011 이후 도구 surface는 ... 항상 8개로 고정" → "spec 011/013 이후 항상 10개로 고정"으로 명시 갱신, (c) "공개 MCP 도구" 본문의 wrapper 6개 표기를 8개로 갱신, (d) Decision rule for parent agents에 두 신규 도구 사용 시점 한 줄씩 추가, (e) `npx -y github:kkyubrother/cerebras-explorer-mcp#v0.3.0` 인스턴스를 sed로 일괄 `#v0.4.0`로 치환.

- [x] T016 [US3] `DESIGN.md`의 도구 surface 정책 단락에서 "8개 고정" 표기를 "10개 고정"으로 갱신하고 갱신 사유(spec 013)를 한 줄 명시.

- [x] T017 [US3] `integrations/codex/AGENTS.md.example`와 `integrations/codex/config.toml.example`의 `enabled_tools` 배열에 `map_impact`와 `find_entrypoints` 추가. README/integrations 다른 6개에 install spec ref가 v0.3.0인 곳을 모두 v0.4.0으로 sed 치환. 화이트리스트가 없는 곳은 변경 없음.

- [x] T018 [US3] `CHANGELOG.md` 최상단에 `## v0.4.0 - 2026-05-23` 헤더 + 사용자 영향(두 wrapper 추가, surface 8 → 10, 정규식 기반 entry point 감지의 false positive 안내) 정리. 기존 v0.3.0/v0.2.x 항목은 변경하지 않는다.

- [x] T019 [US3] `package.json`의 `version`을 `0.3.0` → `0.4.0`으로 갱신 (`npm version 0.4.0 --no-git-tag-version`).

- [x] T020 [US3] `plan/extension-backlog.md`의 #1 (`map_impact`) / #2 (`find_entrypoints`) 항목 옆에 "→ spec 013으로 완료"를 한 줄씩 추가.

---

## Phase 5: Wrap-up

- [x] T021 `npm test` 전체 실행으로 0 failures 확인. 신규 9개 단위 테스트 + 기존 도구 전체 회귀가 함께 통과해야 한다.

- [x] T022 (선택, CEREBRAS_API_KEY가 있을 때만) `node ./scripts/integration-test.mjs` 실행. 두 신규 wrapper도 실제 API와 연결되는지 sanity check. 실패 시 wrapper builder의 task 문자열을 재검토.

- [x] T023 변경분을 단일 release commit으로 묶는다. 메시지: `feat(spec-013): add map_impact and find_entrypoints wrappers, raise surface to 10 (v0.4.0)`. 변경 파일: `src/mcp/server.mjs`, `tests/mcp-server.test.mjs`, `tests/integrations.test.mjs`, `README.md`, `DESIGN.md`, `CHANGELOG.md`, `package.json`, `integrations/**`, `plan/extension-backlog.md`, `specs/013-wrapper-surface-expansion/`.

- [x] T024 `git tag v0.4.0`. push는 사용자 확인 후 (`git push origin master && git push origin v0.4.0`).
