# Implementation Plan: `find_entrypoints` 언어 확장 — Ruby / PHP / Java / Rust

**Branch**: `master` | **Date**: 2026-05-24 | **Spec**: `specs/015-find-entrypoints-language-expansion/spec.md`

## Summary

spec 013의 `ENTRY_POINT_REGEX_BY_KIND`에 Ruby / PHP / Java / Rust 패턴을 증분 추가한다. 신규 entry kind는 만들지 않고 기존 `http`/`cli`/`cron` 카테고리에 정규식만 합쳐 spec 013의 enum과 wrapper builder 시그니처를 그대로 유지한다. backwards-compatible — 추가 패턴이 기존 결과를 줄이지 않으며 false positive는 spec 013의 일반 안내(task 문장 + `searchCoverage.warnings`)로 cover된다.

## Technical Context

**Language/Version**: Node.js ESM. 추가 의존성 없음.

**Primary Dependencies**: 변경 없음.

**Testing**: `npm test` 전체. 핵심 회귀는 `node --test tests/mcp-server.test.mjs`.

**Constraints**: `entryKind` enum 변경 금지. 환경변수 추가 금지. spec 013의 wrapper builder 시그니처 불변.

**Scale/Scope**: `src/mcp/server.mjs`의 `ENTRY_POINT_REGEX_BY_KIND` ~20 라인 추가, `tests/mcp-server.test.mjs` ~50 라인 신규 테스트, README ~3 라인 갱신, backlog 1 라인.

## Constitution Check

- **FR-001 ~ FR-003 게이트**: ENTRY_POINT_REGEX_BY_KIND에 패턴 증분. 정규식 fragment 정확한 escape는 구현 시점에 결정.
- **FR-004 / FR-005 게이트**: enum 불변. `buildEntryPointRegexBundle('all')` Set-기반 중복 제거가 그대로 작동.
- **FR-006 ~ FR-008 게이트**: 단위 테스트 3종 + `all` 합집합 회귀 + spec 013 카테고리 분리 회귀.
- **FR-009 게이트**: README 한 줄 갱신 + backlog 표시.
- **FR-010 게이트**: `npm test` 0 failures.

게이트 평가 결과: 위반 없음.

## Project Structure

```text
specs/015-find-entrypoints-language-expansion/
├── spec.md
├── plan.md
└── tasks.md
```

코드 변경:
```text
src/mcp/server.mjs              # ENTRY_POINT_REGEX_BY_KIND 패턴 증분
tests/mcp-server.test.mjs       # buildFindEntrypointsArgs 단위 테스트 4개 추가
README.md                       # find_entrypoints 설명에서 1차 spec 한정 문구 갱신
plan/extension-backlog.md       # spec 015 진행 표시
```

## Implementation Outline

(a) **`ENTRY_POINT_REGEX_BY_KIND.http` 증분**: spec.md FR-001의 패턴 fragment를 raw regex 문자열로 추가. 정확한 escape 형식은 spec 013 패턴 스타일에 맞춘다 (`\\b...\\b`, `\\(...\\)`, double escape — `\\\\` 같은 백슬래시 처리). 추가 패턴 11개:
   - Rails 3개 (`Rails.application.routes.draw`, `resources :`, `get|post|put|patch|delete '/'`)
   - Laravel 1개 (`Route::(method)(`)
   - Symfony 1개 (`#[Route(`)
   - Spring 2개 (`@(...)Mapping`, `@(Rest)?Controller`)
   - Rust 1개 (`#[(method)(`)
   - 총 8개 (정렬상 일부 통합 가능).

(b) **`ENTRY_POINT_REGEX_BY_KIND.cli` 증분**: spec.md FR-002. Ruby Thor 2개, PHP Symfony Console 1개, Java picocli 1개, Rust clap 2개. 총 6개.

(c) **`ENTRY_POINT_REGEX_BY_KIND.cron` 증분**: spec.md FR-003. Ruby whenever 1개, Laravel scheduler 1개, Spring `@Scheduled` 1개. 총 3개.

(d) **`buildEntryPointRegexBundle('all')`은 그대로** — Set 기반 중복 제거. 신규 패턴이 기존과 중복되지 않으므로 단순히 합집합 크기 증가.

(e) **단위 테스트**: `tests/mcp-server.test.mjs`에 4개 추가:
   1. `buildFindEntrypointsArgs({ entryKind: 'http' })`이 본 spec 패턴 fragment를 포함.
   2. `entryKind: 'cli'` 동일.
   3. `entryKind: 'cron'` 동일.
   4. `entryKind: 'all'`이 spec 013 + spec 015 패턴을 모두 포함하고, `entryKind: 'cli'`에는 http-only 패턴이 들어가지 않음 (카테고리 분리 회귀).

(f) **README 갱신**: `find_entrypoints` 설명에서 "1차 spec은 JS/TS/Python/Go + 기본 cron 패턴에 한정" 문구 → "spec 013 + 015 패턴은 JS/TS, Python, Go, Ruby, PHP, Java, Rust를 cover한다" 한 줄.

(g) **`plan/extension-backlog.md`의 spec 015 진행 표시**: backlog #2 (`find_entrypoints` 추가) 옆이나 별도 줄에 "→ spec 015로 언어 확장(Ruby/PHP/Java/Rust)" 추가.

(h) **검증**: `npm test` 전체 0 failures. 8개 wrapper unknown-key 매트릭스가 그대로 PASS함도 확인.

(i) **커밋**: 단일 commit. 메시지: `feat(spec-015): expand find_entrypoints regex bundle to Ruby/PHP/Java/Rust`.

## Complexity Tracking

- **정규식 escape 형식 일치**: spec 013에서 ENTRY_POINT_REGEX_BY_KIND의 패턴은 `JavaScript string literal에서 \\는 한 번의 \`로 해석됨. 따라서 raw regex `\b`를 표현하려면 string 안에 `\\b`로 작성. 본 spec 추가 패턴도 같은 escape 정책 따라야 한다 — 구현 단계에서 한 번 검토.
- **False positive 우려**: Rust `Command::new`는 `clap::Command::new` 외에도 일반 child_process spawn 등에 사용 가능. 본 spec은 false positive를 받아들이며, `find_entrypoints`의 일반 안내("regex-based, verify before acting")로 cover한다. 더 정밀한 매칭은 후속 spec.
- **Java `@(Rest)?Controller`**: `?`는 정규식 quantifier로 작동. JavaScript `RegExp(string)` 컴파일 시 그대로 인식됨. 별도 escape 불필요.
- **카테고리 분리 회귀 가드**: spec 015 변경이 잘못해서 cli 패턴을 http 배열에 넣지 않도록 단위 테스트 (e)#4에서 강제 검증.
