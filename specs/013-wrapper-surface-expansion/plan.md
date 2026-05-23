# Implementation Plan: Wrapper Surface Expansion (map_impact / find_entrypoints, v0.4.0)

**Branch**: `master` (직접 작업, 솔로 유지보수) | **Date**: 2026-05-23 | **Spec**: `specs/013-wrapper-surface-expansion/spec.md`

**Input**: Feature specification from `specs/013-wrapper-surface-expansion/spec.md`

## Summary

`map_impact`(anchor 기반 깊은 의존성 추적)와 `find_entrypoints`(다국어 entry point 자동 감지) 두 신규 wrapper를 추가해 공개 surface를 8 → 10으로 확장한다. 두 wrapper 모두 기존 `explore_repo` 출력 스키마를 그대로 사용하고, 입력만 좁힌 task-mode shortcut으로 구현한다. spec 011의 "surface 영구 고정 8개" 정책을 "surface 영구 고정 10개"로 명시 갱신하고, README/DESIGN/integrations 7개/CHANGELOG/package.json/server version/install spec(~15 파일)을 한 release 단위로 동기화해 v0.4.0으로 릴리스한다.

기술 접근은 spec 011 이후 정착된 wrapper 패턴을 그대로 따른다. (1) `src/mcp/server.mjs`에 `MAP_IMPACT_TOOL` / `FIND_ENTRYPOINTS_TOOL` 객체 정의, (2) `buildToolList()` 확장, (3) `tools/call` 분기 추가, (4) `buildMapImpactArgs` / `buildFindEntrypointsArgs` 함수 추가, (5) `tests/mcp-server.test.mjs`의 wrapper matrix 8 행 → 10 행 확장 + 신규 builder/validation 단위 테스트, (6) README/DESIGN/integrations 동기화, (7) CHANGELOG/version bump 단일 release 커밋.

`map_impact`와 `map_change_impact`의 의미 차이는 anchor 입력 유무라는 단순 규칙으로 표현한다. `map_impact`는 anchor를 task 문자열의 1급 시민으로 박고 `hints.symbols`/`hints.files`에 자동 push하며 `taskMode: 'impact_analysis'`로 reference chase strategy를 명시한다. `map_change_impact`는 변경 *설명* 자연어를 그대로 받아 reference-chase strategy로 보내는 기존 동작을 유지한다.

`find_entrypoints`의 entry point 패턴은 1차 spec에서 JS/TS(Express, Fastify, NestJS, router), Python(Flask, FastAPI, click, argparse), Go(`net/http`, `chi`), cron(`cron.schedule`, `node-cron`, `setInterval`)로 한정한다. `entryKind` 옵션이 enum이라 schema 검증으로 unknown kind를 거부할 수 있어 spec 005 unknown-key 회귀 가드 구조에 자연스럽게 들어간다.

## Technical Context

**Language/Version**: Node.js (ES modules, `.mjs`), 저장소 기본 런타임을 따른다.

**Primary Dependencies**: 추가 의존성 없음 (`node:test`, `node:assert/strict`만 사용).

**Storage**: N/A (코드 + 문서 + release metadata)

**Testing**: `npm test` 전체, 핵심 회귀는 `node --test tests/mcp-server.test.mjs`, `tests/schemas.test.mjs`(있을 경우), `tests/integrations.test.mjs`(install spec drift 가드).

**Target Platform**: Node.js 런타임 (저장소 CI 매트릭스 기본값).

**Project Type**: MCP 서버 라이브러리. 본 작업은 wrapper 코드 + 단위 테스트 + 문서 + release metadata.

**Performance Goals**: 신규 wrapper는 기존 wrapper와 동일한 latency 특성을 보인다 (둘 다 내부적으로 `explore_repo`에 위임). 단위 테스트는 ms 단위.

**Constraints**:
- spec 011의 surface 정책을 새로 정의(10 고정). README/DESIGN/integrations에 일관 반영 필수.
- 기존 8개 도구의 입출력 스키마와 단위 테스트가 그대로 PASS해야 한다 (backwards-compatible).
- 두 신규 wrapper도 `validatePublicToolArgs` 매트릭스에 포함되어 unknown-key를 거부한다 (spec 005 정책).
- 환경변수는 추가하지 않는다 (spec 011 envvar 최소화 정책 계승).

**Scale/Scope**: `src/mcp/server.mjs` ~120 라인 추가, `tests/mcp-server.test.mjs` ~80 라인 추가, README ~25 라인 갱신, DESIGN ~10 라인, integrations 7개 각각 ~5 라인, CHANGELOG 1 새 섹션, version 갱신 ~15 파일.

## Constitution Check

본 저장소는 별도 constitution을 두지 않으므로 spec의 FR/SC와 spec 011·005·release-procedure 메모리를 게이트로 적용한다.

- **FR-001 ~ FR-007 게이트**: wrapper 정의/builder/dispatch/단위 테스트가 spec 005 unknown-key 매트릭스에 자연스럽게 들어간다.
- **FR-008 / FR-009 게이트**: README/DESIGN에서 "surface 8" 표기를 모두 "surface 10"으로 갱신.
- **FR-010 게이트**: 7개 integrations 모두 확인. enabled_tools 화이트리스트가 있는 곳만 갱신.
- **FR-011 게이트**: CHANGELOG에 v0.4.0 헤더 + 사용자 영향 항목.
- **FR-012 게이트**: version refs 15개 모두 동기화 (메모리 release-procedure에 명시된 sed 한 줄로 일괄 처리).
- **FR-013 게이트**: `npm test` 전체 0 failures.
- **FR-014 게이트**: backlog 문서 갱신.
- **범위 게이트**: backwards-compatible minor bump. prerelease 플래그 없음 (메모리 release-policy의 "breaking change에만 prerelease" 정책 적용).

게이트 평가 결과: 위반 없음.

## Project Structure

### Documentation (this feature)

```text
specs/013-wrapper-surface-expansion/
├── spec.md              # 본 feature의 요구사항/시나리오
├── plan.md              # 본 문서
└── tasks.md             # 작업 단계
```

### Source Code (repository root)

```text
src/mcp/server.mjs             # 두 신규 wrapper 정의 + dispatch + tools/list 확장 + SERVER_INFO.version 0.4.0
tests/mcp-server.test.mjs      # 두 wrapper validation + builder + dispatch + tools/list 단위 테스트
tests/integrations.test.mjs    # install spec drift 가드 (v0.3.0 → v0.4.0 갱신)
README.md                      # 노출 도구 구성 표 + surface 10 명시 + decision rule 행 추가 + install spec 갱신
DESIGN.md                      # surface 정책 단락 갱신
CHANGELOG.md                   # v0.4.0 항목
package.json                   # version 0.4.0
integrations/codex/AGENTS.md.example, config.toml.example  # enabled_tools 두 도구 추가
integrations/{claude,claude-desktop,opencode,cursor,continue,gemini}/  # 화이트리스트 있는 곳만 갱신
plan/extension-backlog.md      # #1 / #2 진행 완료 표시
```

**Structure Decision**: 단일 프로젝트, 신규 디렉터리/모듈 없음. wrapper 정의와 builder 함수는 `src/mcp/server.mjs` 안에 추가(기존 6개 wrapper와 같은 위치). entry-point 정규식 패턴은 builder 함수 안에 inline으로 둔다 (별도 모듈 분리는 후속 spec에서 패턴이 더 늘어날 때).

## Implementation Outline

(a) **두 wrapper 정의 객체 추가**: `src/mcp/server.mjs`의 기존 wrapper 정의 6개 다음 위치(`REVIEW_CHANGE_CONTEXT_TOOL` 아래)에 `MAP_IMPACT_TOOL`과 `FIND_ENTRYPOINTS_TOOL` 두 객체를 spec.md FR-001/FR-003 입력 스키마 그대로 추가한다. `outputSchema`는 `EXPLORE_REPO_OUTPUT_SCHEMA` 그대로 재사용.

(b) **`buildToolList()` 확장**: 기존 8 항목 배열에 두 신규 wrapper를 끼워 넣는다. 순서: `find_relevant_code, trace_symbol, map_change_impact, map_impact, explain_code_path, collect_evidence, review_change_context, find_entrypoints, explore_repo, explore`. (map_impact는 map_change_impact 직후, find_entrypoints는 위치 자유 — explore_repo 직전이 가장 자연스러움)

(c) **`tools/call` 분기 추가**: switch 같은 if 체인에 두 신규 `if (name === ...)` 분기 추가. validation → builder → callTool 흐름은 기존 패턴과 동일.

(d) **Builder 함수 두 개 추가**:
   - `buildMapImpactArgs({ anchor, changeType, repo_root, scope, knownFiles, knownSymbols, session })`: anchor가 파일 경로처럼 보이면(슬래시 또는 `.` 확장자) `knownFiles`에 push, 그렇지 않으면 `knownSymbols`에 push. task 문자열에 changeType의 의미를 자연어로 반영("intended remove of X" 등). `taskMode: 'impact_analysis'`, `hints.strategy: 'reference-chase'`.
   - `buildFindEntrypointsArgs({ entryKind = 'all', repo_root, scope, session })`: entryKind에 따라 FR-004의 정규식 패턴 집합을 `hints.regex`에 자동 주입. task 문자열은 "Find entry points (HTTP routes / CLI commands / cron handlers / MCP tools / event handlers)" 형태. `taskMode: 'entry_point_discovery'`. `searchCoverage.warnings`에 false positive 안내가 들어가도록 runtime에 신호 전달.

(e) **`SERVER_INFO.version` 갱신**: `'0.3.0'` → `'0.4.0'`. server description의 "Purpose shortcuts" 문구에 두 신규 도구 이름 추가.

(f) **`validatePublicToolArgs` 확장 확인**: 기존 함수가 schema-driven이므로 신규 도구 객체만 추가하면 enum 검증 등이 자동으로 작동. 별도 코드 변경 불필요. spec 005 unknown-key 매트릭스 회귀 테스트만 8 → 10 행으로 확장.

(g) **단위 테스트 추가**: `tests/mcp-server.test.mjs`의 wrapper matrix를 8 → 10 행으로 확장하고, 두 신규 wrapper에 대해 (i) validation reject unknown key, (ii) builder가 만든 task 문자열이 anchor/entryKind를 정확히 반영하는지, (iii) tools/call dispatch가 정상 동작, (iv) entryKind enum 거부, (v) tools/list 응답이 정확히 10개를 반환하는지를 단위 수준에서 검증. spec 005 매트릭스가 8 → 10 행으로 확장됨도 검증.

(h) **`tests/integrations.test.mjs`의 install spec drift 가드 갱신**: 기존 v0.3.0 ref 검증을 v0.4.0으로 갱신. README/integrations의 install spec drift도 동일.

(i) **README 갱신**:
   - "노출 도구 구성" 표에 두 신규 wrapper row 추가.
   - "spec 011 이후 도구 surface는 ... 항상 8개로 고정" → "spec 011/013 이후 도구 surface는 ... 항상 10개로 고정"으로 갱신.
   - "공개 MCP 도구" 본문의 wrapper 6개 표기 → 8개로 갱신.
   - Decision rule for parent agents에 `map_impact`(anchor가 있는 영향 분석), `find_entrypoints`(entry point 자동 감지) 사용 시점 한 줄씩 추가.
   - `npx -y github:kkyubrother/cerebras-explorer-mcp#v0.3.0` 모든 인스턴스를 `#v0.4.0`으로 sed 일괄 치환.

(j) **DESIGN.md 갱신**: 도구 surface 정책 단락에서 "8개 고정" 표기를 "10개 고정"으로 갱신하고 본 spec(013)을 갱신 사유로 한 줄 명시.

(k) **integrations 7개 동기화**: codex(`AGENTS.md.example`, `config.toml.example`)의 `enabled_tools` 배열에 `map_impact`와 `find_entrypoints` 추가. 다른 integrations(claude, claude-desktop, opencode, cursor, continue, gemini)는 도구 화이트리스트가 있는 곳만 동일 갱신. README install spec sed 치환과 동일한 sed로 v0.3.0 → v0.4.0 일괄 처리.

(l) **CHANGELOG에 v0.4.0 항목 추가**: 기존 v0.3.0 헤더 위에 `## v0.4.0 - 2026-05-23` 헤더 + Added/Changed 섹션. 사용자 영향: 두 wrapper 추가, surface 8 → 10, entry point 감지의 정규식 한계 안내.

(m) **`package.json` version 갱신**: `0.3.0` → `0.4.0` (`npm version 0.4.0 --no-git-tag-version` 한 줄).

(n) **`plan/extension-backlog.md` 갱신**: #1 / #2 옆에 "→ spec 013으로 완료" 표시.

(o) **검증**: `npm test` 전체 0 failures. (CEREBRAS_API_KEY가 있을 때만) `node ./scripts/integration-test.mjs`도 통과하는지 확인. spec 008/012의 기존 단위 테스트도 그대로 PASS.

(p) **커밋 + tag + push**: spec 011 패턴(단일 release commit) 또는 다중 commit(spec/code/docs 분리) 중 선택. 작업량을 고려해 단일 release commit으로 진행: `feat(spec-013): add map_impact and find_entrypoints wrappers, raise surface to 10 (v0.4.0)`. tag `v0.4.0` 생성 후 push.

## Complexity Tracking

- **Surface 정책 갱신의 파급력**: spec 011이 "surface 8 영구 고정"이라고 못박았기 때문에 본 spec은 그 정책을 명시적으로 갱신해야 한다. README/DESIGN 외에 CHANGELOG에도 "spec 013에서 surface가 10으로 확장됨" 한 줄을 박는다.
- **map_impact vs map_change_impact 의미 차이**: 단순 규칙(anchor 유무)이지만 README의 wrapper decision rule이 이를 한 문장으로 표현해야 한다. plan Step (i)의 decision rule 갱신이 핵심.
- **find_entrypoints의 정규식 false positive**: spec.md Edge Cases에 명시된 대로 `searchCoverage.warnings`에 한 번 안내. runtime은 wrapper에서 주입한 hint를 그대로 처리하므로 추가 runtime 변경 없이 wrapper 단계에서 warning 메시지를 명시한다. (runtime 측 hint 처리 코드가 warning을 자동 추가하지 않으면 wrapper builder가 task 문자열에 self-check 안내 한 문장을 박는 것으로 대체.)
- **15 파일 version sed**: 메모리 release-procedure의 정책을 따라 sed 한 줄로 일괄 치환. drift 가드(`tests/integrations.test.mjs`)가 자동으로 확인.
