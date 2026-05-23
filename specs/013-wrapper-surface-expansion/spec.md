# Feature Specification: Surface 확장 — map_impact / find_entrypoints 두 wrapper 추가

**Feature Branch**: `013-wrapper-surface-expansion`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "extension-backlog #1(`map_impact`)과 #2(`find_entrypoints`)를 묶어서 한 번에 도입한다. spec 011의 \"공개 surface 영구 고정 8개\" 정책을 \"surface 영구 고정 10개\"로 명시적으로 갱신한다. minor 버전 bump(0.3.0 → 0.4.0)와 README/DESIGN/integrations 전체 동기화까지 release 단위로 한 번에 처리한다."

## Clarifications

### Session 2026-05-23

- **Q: Surface 정책** → **A: 8 → 10 (둘 다 신규 추가).** 기존 `map_change_impact`는 그대로 유지하고 `map_impact`/`find_entrypoints`를 신규 wrapper로 추가한다. spec 011의 surface 8 고정 정책을 surface 10 고정 정책으로 명시 갱신.
- **Q: `map_impact` vs `map_change_impact` 의미 차이** → **A: anchor 입력 유무로 차별화.** `map_change_impact`는 parent가 변경 *의도/설명*만 알 때 자연어 `change` 입력으로 빠른 blast radius를 산출하는 기존 동작을 유지한다. `map_impact`는 parent가 변경 대상의 구체적 *anchor*(파일 또는 심볼)를 이미 알 때 그 anchor를 출발점으로 깊은 reference chain + test/config target 가중치를 적용한다.
- **Q: `find_entrypoints`의 1차 spec 범위** → **A: JavaScript/TypeScript + Python + Go + 기본 cron**으로 한정. JS/TS는 Express/Fastify/NestJS/router, Python은 Flask/FastAPI/click/argparse, Go는 `net/http`/`chi`, cron은 `cron.schedule`/`setInterval`/`setTimeout` 패턴. Ruby, PHP, Java, Rust 같은 후속 언어와 Lambda/Queue/Pub-Sub handler는 별도 spec에서 확장한다.
- **Q: Release 단위** → **A: 단일 minor bump v0.4.0.** spec 013의 변경은 backwards-compatible(기존 8개 도구의 입출력 스키마와 동작은 변하지 않음, 환경변수도 그대로). 따라서 prerelease 플래그 없이 단일 tag로 릴리스한다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - `map_impact`: anchor 기반 깊은 의존성 추적 (Priority: P1)

Parent agent가 "이 파일/심볼을 수정하면 어디까지 영향이 가나"를 묻기 직전에 변경 대상의 구체적 anchor를 이미 알고 있다. 이 시점에는 변경 *설명*보다 anchor에서 시작하는 dependency chain이 더 유용하다. `map_impact`는 anchor를 입력의 1급 시민으로 받아, reference chase 깊이를 더 크게 설정하고 `targets[]`에 test/config role을 가진 항목의 가중치를 높여 blast radius를 더 자세히 보고한다.

**Why this priority**: 두 신규 wrapper 중 하나이고, 의도와 동작이 기존 `map_change_impact`와 의미적으로 겹치므로 차별화가 본 spec의 핵심 산출물이다. 차별화가 약하면 surface가 10으로 늘어나는 결정이 정당화되지 않는다.

**Independent Test**: `map_impact({ anchor: 'src/auth.js' })` 호출이 grounded `targets[]`를 반환하고, 그 중 적어도 하나는 `role: 'test'` 또는 `role: 'config'`이며, evidence chain 길이(고유 파일 수)가 `map_change_impact({ change: 'refactor src/auth.js' })`의 동일 입력 시나리오보다 같거나 더 길다. 또한 `map_impact({})`(anchor 누락)는 invalid_arguments error로 거부된다.

**Acceptance Scenarios**:

1. **Given** `map_impact({ anchor: 'src/auth.js' })` 호출, **When** runtime이 끝나면, **Then** 응답의 `targets[]`에 `src/auth.js` 자신과 그 직접/간접 의존 파일이 함께 포함되고, `targets[]` 중 최소 하나는 `role: 'test'` 또는 `role: 'config'`이다.
2. **Given** `map_impact({ anchor: 'requireAuth' })` 호출(심볼 anchor), **When** runtime이 끝나면, **Then** `directAnswer`가 anchor의 정의 위치와 caller chain을 명시하고, `evidence[]`에 정의 라인과 적어도 한 caller 라인이 포함된다.
3. **Given** `map_impact({})` 또는 `map_impact({ anchor: '' })` 호출, **When** input validation이 동작하면, **Then** `invalid_arguments` failure로 거부되고 runtime 호출은 발생하지 않는다.
4. **Given** `map_impact({ anchor: 'src/auth.js', changeType: 'remove' })` 호출, **When** runtime이 task를 구성하면, **Then** 내부 task 문자열에 "remove" 의미가 반영되어 evidence chain에 anchor를 *사용하는* 파일들이 우선 등장한다.
5. **Given** `map_impact({ anchor: '...', knownFiles: ['out-of-scope.js'] })` 호출과 본 호출의 `scope` 입력이 함께 주어진 경우, **When** wrapper builder가 hints를 구성하면, **Then** scope 밖 anchor는 runtime 단계에서 `omittedOutOfScopeFiles`로 가시화되고 builder 자체는 invalid_arguments를 던지지 않는다 (scope 검증은 RepoToolkit의 책임).

---

### User Story 2 - `find_entrypoints`: 다국어 entry point 자동 감지 (Priority: P1)

Parent agent가 처음 보는 저장소의 entry point(어디서 요청이 들어오고, 어디서 CLI 명령이 정의되고, 어떤 background job/cron이 등록되는지)를 한 번에 묻고 싶다. 현재는 `find_relevant_code` + 수동 정규식 hint를 조합해야 한다. `find_entrypoints`는 entry point 정규식 패턴 묶음을 내장 hint로 주입해서 같은 결과를 단일 wrapper 호출로 얻게 한다.

**Why this priority**: 두 신규 wrapper 중 하나이고, 의미 영역이 다른 어떤 wrapper와도 겹치지 않아 추가 정당성이 명확하다. 1차 spec은 JS/TS/Python/Go + 기본 cron으로 한정하며, 후속 언어/framework는 다른 spec에서 확장한다.

**Independent Test**: Express + Flask + click 같은 fixture 디렉토리에 대해 `find_entrypoints({ repo_root, entryKind: 'all' })`이 세 종류 entry point 모두를 `targets[]`로 보고하고, 각각 grounded `evidence[]`(라인 인용)를 가진다. `entryKind: 'http'` 필터 호출에서는 cli 카테고리 entry는 `targets[]`에 등장하지 않는다.

**Acceptance Scenarios**:

1. **Given** Express HTTP 라우트 + Flask `@app.route` + click `@click.command()`을 포함한 fixture 저장소에 대해 `find_entrypoints({ repo_root, entryKind: 'all' })` 호출, **When** runtime이 끝나면, **Then** `targets[]`에 세 entry 종류가 모두 포함되고 각각 grounded evidence 라인이 존재한다.
2. **Given** 동일 fixture에 대해 `find_entrypoints({ repo_root, entryKind: 'http' })` 호출, **When** runtime이 끝나면, **Then** `targets[]`에 Express 라우트만 포함되고 click 명령은 포함되지 않는다.
3. **Given** entry point가 전혀 없는 빈 fixture, **When** 호출이 끝나면, **Then** `status.complete=true`, `targets[]`는 빈 배열, `directAnswer`가 "no entry points detected" 같은 의미의 문장을 반환한다 (failure가 아니라 정상 결과).
4. **Given** `find_entrypoints({ entryKind: 'unknown_kind' })` 호출, **When** input validation이 동작하면, **Then** schema enum 검증이 거부한다 (runtime 호출 없음).

---

### User Story 3 - Surface 정책 갱신과 release 단위 동기화 (Priority: P2)

spec 011은 "공개 surface 영구 고정 8개"를 정책으로 박아 두었다. 본 spec은 이 정책을 "공개 surface 영구 고정 10개"로 명시적으로 갱신하고, README/DESIGN/integrations 7개/CHANGELOG/package.json 버전/server version을 한 release 단위로 동기화한다. minor bump(0.3.0 → 0.4.0)로 릴리스한다.

**Why this priority**: 두 wrapper 자체의 동작(US1/US2)은 코드 변경으로 검증되지만, surface 정책을 갱신하지 않으면 spec 011의 선언과 spec 013의 결과가 충돌해 다음 변경자가 정책을 어느 쪽으로 읽어야 하는지 혼란을 겪는다. release 단위 동기화도 v0.3.0 릴리스 때 사용했던 메모리 정책(`release-procedure`, `release-policy`)을 그대로 따른다.

**Independent Test**: MCP `tools/list` 응답이 정확히 10개의 도구를 반환하고, README/DESIGN에서 "surface 8" 표기가 모두 "surface 10"으로 갱신되었으며, 7개 integrations 예시 모두에 `map_impact`와 `find_entrypoints`가 enabled_tools 또는 동등 키에 포함된다. CHANGELOG에 `## v0.4.0` 헤더가 있고 package.json `version`은 `0.4.0`이며 SERVER_INFO.version도 동일하다.

**Acceptance Scenarios**:

1. **Given** MCP `initialize` + `tools/list`, **When** 클라이언트가 도구 목록을 받으면, **Then** 정확히 10개 도구가 노출된다 (`explore_repo`, 6개 기존 wrapper + 2개 신규 wrapper + `explore`).
2. **Given** README의 "노출 도구 구성" 표, **When** 독자가 표를 보면, **Then** `map_impact`와 `find_entrypoints`가 별도 row로 등재되어 있고 "surface는 항상 10개로 고정"이라는 명시가 한 곳에 존재한다.
3. **Given** Codex `config.toml.example`, **When** 사용자가 예시를 그대로 복사해 등록하면, **Then** `enabled_tools` 배열에 두 신규 도구가 포함된다.
4. **Given** `package.json` + `src/mcp/server.mjs` + CHANGELOG의 헤더, **When** 셋의 버전 표기를 비교하면, **Then** 모두 `0.4.0`으로 일치하고 CHANGELOG에 사용자 영향(두 wrapper 추가 + surface 정책 갱신)이 외부 독자가 식별 가능하게 기록되어 있다.
5. **Given** `npm test` 전체 실행, **When** 회귀 검증이 끝나면, **Then** 0 failures로 종료하고 기존 8개 도구의 입출력 스키마/동작 단위 테스트가 모두 그대로 통과한다.

---

### Edge Cases

- `map_impact`의 anchor가 scope 밖이면 runtime 단계에서 evidence가 비고 `omittedOutOfScopeFiles`로 가시화된다. wrapper builder는 scope 검증을 시도하지 않는다 (RepoToolkit 책임).
- `find_entrypoints`가 false positive(예: 라우트가 아닌 미들웨어 등록)를 evidence로 포함할 가능성이 있다. 이는 정규식 기반 한계이므로 `searchCoverage.warnings`에 "entry point detection is regex-based and may include false positives" 안내를 한 번 띄운다.
- `find_entrypoints({ entryKind: 'all' })`이 zero entry point repo에서 정상 종료한다(failure 아님). `status.complete=true`, `targets[]`는 빈 배열.
- `map_impact`와 `map_change_impact` 둘 다 호출되는 워크플로(parent가 둘 다 시도하는 경우)는 본 spec 범위 밖이다. parent agent 가이드는 README의 wrapper decision rule에 짧게 추가한다.
- `find_entrypoints`의 entry kind 카테고리는 1차 spec에서 `http`/`cli`/`cron`/`mcp`/`event`/`all` 6개로 고정한다. Lambda handler, Kubernetes CronJob YAML, Pub-Sub subscriber 같은 후속 카테고리는 별도 spec에서 추가한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `map_impact` wrapper 추가. `inputSchema`는 `anchor`(필수 string), `changeType`(옵션 enum: `'rename'|'refactor'|'remove'|'add'`), `repo_root`, `scope`, `knownFiles`, `knownSymbols`, `session`을 받는다. unknown key는 spec 005 정책에 따라 거부한다.
- **FR-002**: `map_impact` wrapper builder는 `taskMode: 'impact_analysis'`와 `hints.strategy: 'reference-chase'`를 명시적으로 주입한다. anchor를 `knownFiles` 또는 `knownSymbols`에 자동 push해서 reference chain의 출발점으로 사용한다.
- **FR-003**: `find_entrypoints` wrapper 추가. `inputSchema`는 `entryKind`(옵션 enum: `'http'|'cli'|'cron'|'mcp'|'event'|'all'`, default `'all'`), `repo_root`, `scope`, `session`을 받는다.
- **FR-004**: `find_entrypoints` wrapper builder는 entryKind에 따라 정규식 패턴 묶음을 `hints.regex`에 자동 주입한다. 1차 spec의 패턴 집합:
  - `http`: `app\.(get|post|put|delete|patch)\b`, `router\.(get|post|put|delete|patch)\b`, `@app\.route\b`, `@(Get|Post|Put|Delete|Patch)\b`(NestJS), `func\s+\w+\(\w+\s+http\.ResponseWriter` 같은 Go 패턴, `@\w+\.(get|post|put|delete|patch)` 같은 FastAPI 데코레이터
  - `cli`: `program\.command\b`, `\.argument\b`, `@click\.command\b`, `argparse\.ArgumentParser\b`, `cobra\.Command\b`, `process\.argv\b`
  - `cron`: `cron\.schedule\b`, `node-cron`, `setInterval\b`, `setTimeout\b`(주의: false positive 가능, 별도 hint로만), `@scheduled\b`
  - `mcp`: `tools/list\b`, `mcpServer\.tool\b`, `registerTool\b`
  - `event`: `\.on\(['"]`, `addEventListener\b`, `EventEmitter\b`, `\.emit\(['"]`
  - `all`: 위 다섯 카테고리 합집합
- **FR-005**: `find_entrypoints` wrapper는 응답의 `searchCoverage.warnings`에 "entry point detection is regex-based and may include false positives — verify before acting" 한 번 추가한다 (별도 옵트인 envvar 없이 기본 동작).
- **FR-006**: 두 신규 wrapper는 spec 005의 unknown-key 거부 매트릭스 회귀 테스트에 포함된다. `tests/mcp-server.test.mjs`의 wrapper matrix는 8 행에서 10 행으로 확장한다.
- **FR-007**: `src/mcp/server.mjs`의 `buildToolList()`는 두 신규 wrapper를 포함해 정확히 10개를 반환한다. `tools/call` switch에도 두 신규 분기가 추가된다.
- **FR-008**: README는 (a) "노출 도구 구성" 표에 두 신규 wrapper row 추가, (b) "spec 011 이후 도구 surface는 환경변수와 무관하게 항상 8개로 고정" 표기를 "spec 013 이후 항상 10개로 고정"으로 명시 갱신, (c) "왜 이렇게 설계했나"와 "공개 MCP 도구" 본문의 wrapper 6개 언급을 8개로 갱신, (d) Decision rule for parent agents에 `map_impact`와 `find_entrypoints` 사용 시점 안내 한 줄씩 추가.
- **FR-009**: DESIGN.md의 도구 surface 관련 단락이 8개 → 10개로 갱신되고, surface 정책의 갱신 이유(spec 013)를 한 줄 명시한다.
- **FR-010**: `integrations/codex/AGENTS.md.example`와 `integrations/codex/config.toml.example`의 `enabled_tools` 배열에 `map_impact`와 `find_entrypoints`가 포함된다. 다른 6개 integrations(`claude`, `claude-desktop`, `opencode`, `cursor`, `continue`, `gemini`)도 도구 화이트리스트가 있는 곳은 모두 두 신규 도구를 포함한다 (없는 곳은 변경 없음).
- **FR-011**: `CHANGELOG.md`에 `## v0.4.0 - 2026-05-23` 헤더 아래 본 spec의 사용자 영향(두 wrapper 추가, surface 8 → 10, 정규식 기반 entry point 감지의 한계 안내)을 사용자 관점에서 짧게 정리한다. 기존 v0.3.0 항목은 변경하지 않는다.
- **FR-012**: `package.json`의 `version`이 `0.4.0`, `src/mcp/server.mjs`의 `SERVER_INFO.version`이 `0.4.0`, README와 integrations의 `npx -y github:kkyubrother/cerebras-explorer-mcp#v0.3.0` 같은 install spec이 모두 `#v0.4.0`으로 일괄 갱신된다 (메모리 `release-procedure` 정책: ~15 파일).
- **FR-013**: `npm test` 전체가 0 failures로 종료한다. 본 spec의 신규 단위 테스트는 두 wrapper의 validation + builder + dispatch + tools/list 응답 확장을 cover한다.
- **FR-014**: `plan/extension-backlog.md`의 #1 / #2 항목 옆에 "→ spec 013으로 완료"를 명시한다.

### Key Entities

- **`map_impact` wrapper 입력**: `anchor`(필수, 파일 경로 또는 심볼 이름), `changeType`(옵션 enum), 공통 `repo_root`/`scope`/`session`/`knownFiles`/`knownSymbols`. 출력은 기존 `EXPLORE_REPO_OUTPUT_SCHEMA`를 그대로 사용.
- **`find_entrypoints` wrapper 입력**: `entryKind`(옵션 enum), 공통 `repo_root`/`scope`/`session`. 출력은 기존 `EXPLORE_REPO_OUTPUT_SCHEMA` 사용.
- **Entry point 패턴 묶음**: FR-004의 카테고리별 정규식 패턴 집합. wrapper builder가 `hints.regex`에 자동 주입.

## Success Criteria *(mandatory)*

- **SC-001**: `npm test` 전체 0 failures로 종료, 신규 단위 테스트가 두 wrapper의 4 acceptance scenario 묶음을 모두 cover.
- **SC-002**: MCP `tools/list` 응답이 10개 도구를 반환, 기존 8개 동작은 입출력 스키마와 단위 테스트가 그대로 PASS.
- **SC-003**: README/DESIGN/integrations 7개/CHANGELOG/package.json/SERVER_INFO/install spec 표기가 모두 `0.4.0` + surface 10으로 일관.
- **SC-004**: `git tag v0.4.0` 후 push까지 정상 완료. release 단위 작업이 단일 또는 다중 commit으로 묶이되 commit log에서 본 spec 산출물을 식별 가능.

## Assumptions

- 본 spec은 backwards-compatible이다 (기존 8개 도구의 동작 변경 없음, 환경변수 변경 없음). 따라서 prerelease 플래그 없이 minor bump.
- 1차 spec의 entry point 패턴 집합은 JS/TS/Python/Go + 기본 cron에 한정한다. Ruby/PHP/Java/Rust + Lambda/Kubernetes/Pub-Sub은 후속 spec에서 확장한다.
- `map_impact`와 `map_change_impact`의 의미 차이는 anchor 입력 유무라는 단순 규칙으로 표현 가능하다. 더 복잡한 차별화(strategy 자체를 다르게)가 필요하다는 신호가 나오면 별도 spec에서 재정의한다.
- spec 011의 surface 정책 변경은 README 본문 한 문장 갱신과 CHANGELOG 한 항목으로 충분하다. spec 011 자체 문서는 historical로 두고 손대지 않는다.
- 본 작업은 P0/P1 작업을 차단하지 않는다 (release 단위 변경이지만 backwards-compatible).
