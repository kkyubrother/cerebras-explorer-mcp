# Feature Specification: `find_entrypoints` 언어 확장 — Ruby / PHP / Java / Rust

**Feature Branch**: `015-find-entrypoints-language-expansion`

**Created**: 2026-05-24

**Status**: Implemented

**Input**: User description: "spec 013(`find_entrypoints` 1차 spec)이 JS/TS/Python/Go + 기본 cron으로 한정한 entry-point 정규식 패턴 묶음을 Ruby(Rails/Sinatra/Thor/whenever), PHP(Laravel/Symfony), Java(Spring), Rust(actix-web/rocket/clap) 네 언어로 확장한다. 신규 `entryKind` 카테고리는 추가하지 않으며 기존 http/cli/cron 카테고리에 정규식만 증분한다. Lambda handler / K8s CronJob YAML / Pub-Sub subscriber 같은 별도 의미 카테고리는 후속 spec에서 다룬다."

## Clarifications

### Session 2026-05-24

- **Q: 확장 범위** → **A: 4개 언어(Ruby, PHP, Java, Rust)** — 가장 자주 사용되는 server-side language. 1차 spec과 합쳐 총 7개 언어(JS/TS, Python, Go, Ruby, PHP, Java, Rust)를 cover.
- **Q: 새 `entryKind` 추가 여부** → **A: 추가 안 함.** spec 013의 `entryKind` enum(`http|cli|cron|mcp|event|all`)을 그대로 유지하고 기존 카테고리에 정규식만 증분. Lambda handler·job queue·Pub-Sub·GraphQL 같은 의미적으로 다른 카테고리는 별도 후속 spec(예: spec 017)에서 다룬다.
- **Q: backwards-compatibility** → **A: 완전 backwards-compatible.** 신규 패턴은 기존 패턴 위에 합쳐지므로 기존 카테고리 결과는 같거나 더 많아진다 (덜 매치되지는 않는다). version bump 없음.
- **Q: false positive 처리** → **A: spec 013과 동일.** `find_entrypoints`의 task 문장과 `searchCoverage.warnings`에 이미 "regex-based; verify before acting" 안내가 들어가 있으므로 추가 안내 없음.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ruby/PHP/Java/Rust 저장소에서 HTTP route 자동 감지 (Priority: P1)

Parent agent가 Ruby on Rails, Laravel, Spring 같은 흔한 server framework로 작성된 저장소를 처음 탐색할 때 `find_entrypoints({ entryKind: 'http' })`만 호출해서 HTTP route 정의를 한 번에 식별하고 싶다. spec 013의 1차 패턴은 JS/Python/Go에 한정되어 Ruby/PHP/Java/Rust 저장소에서는 거의 매치가 없다. 본 user story는 네 언어의 가장 흔한 HTTP route 패턴을 정규식 묶음에 추가한다.

**Why this priority**: HTTP route 감지는 `find_entrypoints`의 가장 많이 쓰이는 카테고리이고, 4개 언어 모두 server-side 시장에서 무시할 수 없는 비중을 차지한다. P1.

**Independent Test**: Rails routes 파일, Laravel routes 파일, Spring `@RestController`, Rust actix-web 핸들러를 각각 한 줄씩 담은 fixture에 대해 `buildFindEntrypointsArgs({ entryKind: 'http' })`가 만드는 `hints.regex` 배열이 네 패턴을 모두 포함하는지로 검증한다. 또한 `buildFindEntrypointsArgs({ entryKind: 'all' })`도 합집합을 정확히 포함하는지 확인한다.

**Acceptance Scenarios**:

1. **Given** `buildFindEntrypointsArgs({ entryKind: 'http' })` 호출, **When** 반환되는 `hints.regex` 배열을 확인, **Then** 다음 패턴 fragment를 포함한다 (정확한 정규식 문자열이 아니라 의미 단서):
   - Rails: `Rails\.application\.routes\.draw`, `\bresources\s+:`, `\b(get|post|put|patch|delete)\s+['"][/:]`
   - Laravel: `\bRoute::(get|post|put|delete|patch|any|match|resource)\s*\(`
   - Symfony: `#\[Route\s*\(`
   - Spring: `@(Get|Post|Put|Delete|Patch|Request)Mapping\b`, `@(Rest)?Controller\b`
   - Rust actix-web/rocket: `#\[(get|post|put|delete|patch)\s*\(`
2. **Given** `buildFindEntrypointsArgs({ entryKind: 'all' })` 호출, **When** 반환 배열을 확인, **Then** spec 013의 기존 http 패턴 + spec 015의 네 언어 패턴이 모두 합집합으로 포함된다.
3. **Given** `entryKind: 'cli'` 또는 `entryKind: 'cron'` 호출, **When** 반환 배열을 확인, **Then** http 카테고리에서 추가된 패턴은 포함되지 않는다 (카테고리 분리 유지).
4. **Given** 위 패턴 중 어느 하나도 매치하지 않는 저장소(예: 순수 JS-only 저장소), **When** `find_entrypoints` 호출이 끝나면, **Then** 결과는 spec 015 변경 이전과 동일하다 (추가 패턴이 false positive를 만들지 않음).

---

### User Story 2 - Ruby/PHP/Java/Rust CLI 명령 자동 감지 (Priority: P2)

Ruby Thor, PHP Symfony Console, Java picocli, Rust clap 같은 흔한 CLI framework로 작성된 저장소에서 `find_entrypoints({ entryKind: 'cli' })`이 CLI 명령 정의를 식별할 수 있어야 한다.

**Why this priority**: HTTP만큼 압도적으로 자주 묻지는 않지만, 본 spec에서 함께 다루는 게 자연스럽다 (같은 4개 언어, 같은 정규식 묶음 패턴). P2.

**Independent Test**: `buildFindEntrypointsArgs({ entryKind: 'cli' })`가 만드는 `hints.regex` 배열이 네 framework의 대표 패턴(Thor `class \w+ < Thor`, Symfony Console `extends Command`, picocli `@picocli.CommandLine.Command`, Rust clap `Command::new` 또는 `#[derive(...Parser...)]`)을 포함하는지 검증.

**Acceptance Scenarios**:

1. **Given** `buildFindEntrypointsArgs({ entryKind: 'cli' })` 호출, **When** 반환 배열 확인, **Then** 다음 fragment 포함:
   - Ruby Thor: `class\s+\w+\s*<\s*Thor\b`, `\bdesc\s+['"]`
   - PHP Symfony Console: `extends\s+Command\b`
   - Java picocli: `@picocli\.CommandLine\.Command\b`
   - Rust clap: `\bCommand::new\b`, `#\[derive\s*\([^)]*Parser[^)]*\)\]`
2. **Given** `entryKind: 'all'`, **When** 반환 배열, **Then** cli 카테고리 spec 013 + spec 015 패턴이 모두 합집합에 포함.

---

### User Story 3 - Ruby whenever / PHP Laravel scheduler / Java @Scheduled / cron 패턴 보강 (Priority: P3)

Ruby whenever gem, Laravel `schedule->`, Spring `@Scheduled` 같은 흔한 scheduler 패턴도 cron 카테고리에 추가한다. Rust scheduler 패턴은 false positive가 크고(예: `tokio::spawn`이 cron이 아닌 일반 비동기 작업에 사용됨) 본 spec에서는 추가하지 않는다.

**Why this priority**: 사용 빈도가 낮고 false positive 가능성이 있어 P3. 패턴 추가 자체는 단순하므로 본 spec에서 함께 처리한다.

**Independent Test**: `buildFindEntrypointsArgs({ entryKind: 'cron' })`이 만드는 배열이 Ruby whenever (`\bevery\s+\d+\.(seconds|minutes|hours|days)\b`), Laravel scheduler (`->\s*(daily|hourly|weekly|monthly|cron|everyMinute)\b`), Spring (`@Scheduled\b`)을 포함.

**Acceptance Scenarios**:

1. **Given** `buildFindEntrypointsArgs({ entryKind: 'cron' })` 호출, **When** 반환 배열, **Then** 위 3개 fragment가 포함된다.
2. **Given** `entryKind: 'all'`, **When** 반환 배열, **Then** cron 카테고리 spec 013 + spec 015 패턴이 모두 합집합에 포함.

---

### Edge Cases

- Rust `#[get("/path")]`은 actix-web과 rocket 두 framework가 동일 어노테이션 형태를 쓰므로 패턴 하나로 둘 다 cover. 다른 attribute 기반 framework가 추가되면 별도 패턴 필요.
- PHP attribute `#[Route(...)]`는 Symfony 6+의 신규 syntax. 구 docblock `@Route("/...")` 어노테이션은 본 spec 범위 밖 (frequency도 줄어드는 추세).
- Java `@RequestMapping`은 클래스 레벨과 메서드 레벨 모두에 붙을 수 있다. 본 spec은 단순히 어노테이션 매치만 하고 위치(클래스 vs 메서드)는 구분하지 않는다.
- Rails `resources :users`는 RESTful 7개 endpoint를 한 줄로 정의한다. 본 spec은 그 한 줄만 매치할 뿐 7개 endpoint로 분해하지 않는다 (regex 한계).
- Spring `@Controller`와 `@RestController`는 클래스 레벨 어노테이션이라 클래스 안의 개별 메서드는 매치하지 않는다 — 그 위치에서 `@GetMapping` 등이 별도로 매치된다.
- Lambda handler, K8s CronJob YAML, Pub-Sub subscriber 같은 의미적으로 다른 entry kind는 본 spec 범위 밖. 후속 spec에서 별도 `entryKind` 카테고리를 추가하거나 `event`에 묶을지 결정한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `src/mcp/server.mjs`의 `ENTRY_POINT_REGEX_BY_KIND.http`에 다음 정규식 fragment를 추가한다 (정확한 escape는 구현 시점에 확정):
  - Rails: `\bRails\.application\.routes\.draw\b`, `\bresources\s+:[a-z_]+`, `\b(get|post|put|patch|delete)\s+['"][/:]`
  - Laravel: `\bRoute::(get|post|put|delete|patch|any|match|resource)\s*\(`
  - Symfony: `#\[Route\s*\(`
  - Spring: `@(Get|Post|Put|Delete|Patch|Request)Mapping\b`, `@(Rest)?Controller\b`
  - Rust actix-web/rocket: `#\[(get|post|put|delete|patch)\s*\(`
- **FR-002**: `ENTRY_POINT_REGEX_BY_KIND.cli`에 다음을 추가:
  - Ruby Thor: `class\s+\w+\s*<\s*Thor\b`, `\bdesc\s+['"]`
  - PHP Symfony Console: `extends\s+Command\b`
  - Java picocli: `@picocli\.CommandLine\.Command\b`
  - Rust clap: `\bCommand::new\b`, `#\[derive\s*\([^)]*Parser[^)]*\)\]`
- **FR-003**: `ENTRY_POINT_REGEX_BY_KIND.cron`에 다음을 추가:
  - Ruby whenever: `\bevery\s+\d+\.(seconds|minutes|hours|days)\b`
  - Laravel scheduler: `->\s*(daily|hourly|weekly|monthly|cron|everyMinute)\b`
  - Spring: `@Scheduled\b`
- **FR-004**: 신규 `entryKind` enum 값은 추가하지 않는다. spec 013의 enum(`http|cli|cron|mcp|event|all`)이 그대로 유지된다.
- **FR-005**: `buildEntryPointRegexBundle('all')`은 다섯 카테고리 합집합을 반환하며 중복 패턴은 자동 제거한다 (`Set` 기반). 본 spec의 추가 패턴이 기존 spec 013 패턴과 중복되지 않으므로 합집합 크기는 정확히 spec 013 패턴 수 + spec 015 추가 수.
- **FR-006**: `tests/mcp-server.test.mjs`에 신규 단위 테스트 3개를 추가한다 (User Story 1/2/3 각각): `buildFindEntrypointsArgs({ entryKind: 'http' / 'cli' / 'cron' })`이 반환하는 `hints.regex` 배열이 본 spec의 패턴 fragment를 포함하는지 substring 검증.
- **FR-007**: `tests/mcp-server.test.mjs`에 `entryKind: 'all'`이 spec 013 + spec 015 패턴을 모두 포함하는지 검증하는 회귀 테스트를 추가한다.
- **FR-008**: spec 013의 기존 단위 테스트(있다면)와 카테고리 분리 (`http` 카테고리 호출이 cli 패턴을 포함하지 않음)는 그대로 PASS해야 한다.
- **FR-009**: `README.md`의 `find_entrypoints` 설명에서 "1차 spec은 JS/TS/Python/Go + 기본 cron 패턴에 한정" 문구를 갱신해 새 4개 언어를 명시한다. backlog의 #2 항목 옆에 spec 015 진행 표시를 추가한다.
- **FR-010**: `npm test` 전체가 0 failures로 종료한다.

### Key Entities

- **Entry-point regex 카테고리**: `http | cli | cron | mcp | event`. 본 spec은 `http`/`cli`/`cron` 세 카테고리에만 패턴을 증분한다.
- **Spec 015 패턴 fragment**: FR-001/002/003에 명시된 정규식. `buildGitignoreMatcher`/`globToRegExp`와 무관하게 raw regex 문자열로 hints.regex 배열에 들어간다 (spec 013 동작 그대로).

## Success Criteria *(mandatory)*

- **SC-001**: `npm test` 전체 0 failures.
- **SC-002**: User Story 1/2/3 단위 테스트가 모두 PASS — 신규 패턴이 적절한 카테고리에 들어감을 검증.
- **SC-003**: spec 013의 기존 entry-point 단위 테스트와 spec 013의 wrapper matrix 회귀 가드가 본 spec 변경 이후에도 PASS.
- **SC-004**: README의 1차 spec 한정 문구가 갱신됨을 grep으로 확인 가능 — Ruby/PHP/Java/Rust가 언급되어야 한다.

## Assumptions

- 본 spec은 완전 backwards-compatible이다. 기존 카테고리에 패턴이 추가될 뿐이므로 spec 013 사용자 호출의 결과는 같거나 더 많은 entry point를 보고한다.
- 신규 entry kind(Lambda handler, K8s CronJob YAML, Pub-Sub subscriber, GraphQL, job queue 등)는 별도 후속 spec에서 다룬다.
- Rust scheduler 패턴(`tokio::spawn` + `interval`)은 false positive가 커서 본 spec에서 추가하지 않는다.
- minor/patch bump는 추가하지 않는다. 다음 release에 묶어 v0.4.1 또는 v0.5.0의 한 항목으로 정리한다.
