---
description: "Task list for spec 015 — find_entrypoints language expansion (Ruby/PHP/Java/Rust)"
---

# Tasks: `find_entrypoints` 언어 확장

**Input**: Design documents from `specs/015-find-entrypoints-language-expansion/`

**Tests**: Required. 신규 패턴이 적절한 카테고리에 들어가는지 + spec 013 카테고리 분리 회귀를 단위 테스트로 가드.

## Format: `[ID] [P?] [Story] Description`

- US1 = http 확장, US2 = cli 확장, US3 = cron 확장
- 경로는 저장소 루트 기준.

## Phase 1: Setup

- [x] T001 master 작업 트리 깨끗 확인 (`git status` clean). spec 013 wrapper 단위 테스트가 0 failures인지 baseline 확인 (`node --test tests/mcp-server.test.mjs`).

## Phase 2: User Story 1 — http 확장 (P1)

- [x] T002 [US1] `src/mcp/server.mjs`의 `ENTRY_POINT_REGEX_BY_KIND.http` 배열에 다음 raw regex 문자열을 추가한다 (escape 정책은 spec 013 기존 패턴과 동일):
  - `\\bRails\\.application\\.routes\\.draw\\b`
  - `\\bresources\\s+:[a-z_]+`
  - `\\b(get|post|put|patch|delete)\\s+['"][/:]`
  - `\\bRoute::(get|post|put|delete|patch|any|match|resource)\\s*\\(`
  - `#\\[Route\\s*\\(`
  - `@(Get|Post|Put|Delete|Patch|Request)Mapping\\b`
  - `@(Rest)?Controller\\b`
  - `#\\[(get|post|put|delete|patch)\\s*\\(`

- [x] T003 [US1] `tests/mcp-server.test.mjs`에 단위 테스트 추가: `buildFindEntrypointsArgs({ entryKind: 'http' })`이 반환하는 `hints.regex` 배열에 위 8개 fragment의 substring이 모두 포함됨을 검증 (`assert.ok(regex.includes(...))` 또는 `assert.ok(regex.some(p => p.includes('Rails.application.routes.draw')))` 패턴).

- [x] T004 [US1] `node --test tests/mcp-server.test.mjs --test-name-pattern "spec 015|find_entrypoints"` 단독 실행으로 신규 http 테스트가 PASS함을 확인.

## Phase 3: User Story 2 — cli 확장 (P2)

- [x] T005 [US2] `ENTRY_POINT_REGEX_BY_KIND.cli` 배열에 다음 추가:
  - `\\bclass\\s+\\w+\\s*<\\s*Thor\\b`
  - `\\bdesc\\s+['"]`
  - `\\bextends\\s+Command\\b`
  - `@picocli\\.CommandLine\\.Command\\b`
  - `\\bCommand::new\\b`
  - `#\\[derive\\s*\\([^)]*Parser[^)]*\\)\\]`

- [x] T006 [US2] `tests/mcp-server.test.mjs`에 단위 테스트 추가: `buildFindEntrypointsArgs({ entryKind: 'cli' })`이 반환하는 `hints.regex` 배열에 위 6개 fragment의 substring이 모두 포함됨.

- [x] T007 [US2] cli 테스트 PASS 확인.

## Phase 4: User Story 3 — cron 확장 (P3)

- [x] T008 [US3] `ENTRY_POINT_REGEX_BY_KIND.cron` 배열에 다음 추가:
  - `\\bevery\\s+\\d+\\.(seconds|minutes|hours|days)\\b`
  - `->\\s*(daily|hourly|weekly|monthly|cron|everyMinute)\\b`
  - `@Scheduled\\b`

- [x] T009 [US3] `tests/mcp-server.test.mjs`에 단위 테스트 추가: `buildFindEntrypointsArgs({ entryKind: 'cron' })`이 반환하는 배열에 위 3개 fragment 포함.

- [x] T010 [US3] cron 테스트 PASS 확인.

## Phase 5: All 합집합 + 카테고리 분리 회귀

- [x] T011 `tests/mcp-server.test.mjs`에 단위 테스트 추가:
  - `buildFindEntrypointsArgs({ entryKind: 'all' })`이 spec 013 패턴 (예: `app\\.(get|post...)`)과 spec 015 패턴(예: `Rails.application.routes.draw`)을 모두 합집합으로 포함.
  - `buildFindEntrypointsArgs({ entryKind: 'cli' })`이 http-only 패턴(`app\\.(get|post...)`)을 *포함하지 않음* (카테고리 분리 가드).

- [x] T012 `node --test tests/mcp-server.test.mjs` 전체 실행으로 spec 013 wrapper unknown-key 매트릭스가 그대로 PASS함을 확인.

## Phase 6: 문서 + backlog

- [x] T013 `README.md`의 `find_entrypoints` 설명에서 "1차 spec은 JS/TS/Python/Go + 기본 cron"을 "spec 013 + 015 패턴은 JS/TS, Python, Go, Ruby, PHP, Java, Rust를 cover합니다 (Lambda handler/K8s CronJob/Pub-Sub 같은 별도 의미 카테고리는 후속 spec)"로 갱신.

- [x] T014 `plan/extension-backlog.md`의 #2 항목 옆에 "→ spec 015로 Ruby/PHP/Java/Rust 패턴 확장 완료" 한 줄 추가.

## Phase 7: Wrap-up

- [x] T015 `npm test` 전체 0 failures 확인.

- [x] T016 변경분을 단일 commit으로 묶는다. 메시지: `feat(spec-015): expand find_entrypoints regex bundle to Ruby/PHP/Java/Rust`. 변경 파일: `src/mcp/server.mjs`, `tests/mcp-server.test.mjs`, `README.md`, `plan/extension-backlog.md`, `specs/015-find-entrypoints-language-expansion/`.
