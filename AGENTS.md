# AGENTS.md

이 파일은 본 레포에서 작업하는 코딩 에이전트(Codex, Claude Code 등)가 따라야 할 **규칙**을 선언한다. 프로젝트의 무엇을·어떻게는 `README.md`/`DESIGN.md`가 권위 있는 출처다. 이 파일은 **문서-코드 드리프트를 막기 위한 행동 규칙**만 다룬다.

## 프로젝트 불변(invariants) — 깨지 말 것

- **Zero runtime dependencies**. `package.json`에 `dependencies`/`devDependencies` 둘 다 비어 있어야 한다.
- **Read-only 파일 접근**. 탐색기는 코드를 읽기만 한다. 쓰기·삭제 경로를 추가하지 말 것.
- **Secret deny-list + redaction**은 항상 활성. `src/explorer/redact.mjs` 참조. snippet 안의 `process.env.X`/`import.meta.env.X`/`Deno.env.get("X")` 같은 env var 식별자는 public 인터페이스로 간주해 기본적으로 보존하고, secret 값/secret file path만 마스킹한다.
- **공개 도구 표면은 8개로 고정** (spec 011): `explore_repo`, 6개 wrapper(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`), `explore`(Markdown 보고서). `explore_v2` 도구 이름과 `_ENABLE_EXPLORE_V2` / `_EXTRA_TOOLS` / `_ENABLE_EXPLORE` envvar는 모두 제거되었다.
- **`explore_repo` 입력에 `budget`이 없다** (spec 011). 모든 호출은 단일 deep runtime config로 실행된다. budget 인자를 추가하지 말 것.
- **Scope는 모든 도구에서 hard boundary**. `repo_list_dir`/`repo_read_file`/`repo_grep`/`repo_symbols`뿐 아니라 `repo_git_diff`/`repo_git_show`/`repo_git_diff({stat:true})`도 scope 밖 파일을 결과에서 제외하고, 제외 수는 `omittedOutOfScopeFiles`로만 가시화한다.
- **Sub-agent / parent-agent handoff**: 결과를 자연어로 요약하거나 다른 agent에 인계할 때 다음 control-plane 필드를 반드시 보존하라 — `status.verification`, `status.complete`, `evidenceQuality`, `searchCoverage`, `failure`, `session/sessionId`, `critic.warnings`. heavy 호출에서는 `_meta.progressToken`을 함께 전달한다.
- `EXPLORER_PROVIDER` / `EXPLORER_FAILOVER` 경로는 **내부 구현이며 공개 계약 아님**. 사용자용 문서에서 1급 시민처럼 다루지 말 것.

## 문서-코드 동기화 매트릭스

좌측을 변경하면 같은 PR에서 우측을 함께 갱신해야 한다. `tests/integrations.test.mjs`가 일부를 snapshot으로 강제한다 — **commit 전에 반드시 `npm test`를 실행하라.**

| 변경한 것 | 같이 갱신할 것 |
|---|---|
| `src/explorer/schemas.mjs` (JSON Schema) | `README.md` compact response schema 섹션, `DESIGN.md`, `examples/expected-response.json` |
| `src/explorer/runtime.mjs`의 사용자 노출 문자열 (예: `"Discovered path; ..."`) | `examples/expected-response.json` |
| `src/mcp/server.mjs`의 공개 도구 표면 (도구 추가/삭제/이름 변경) | `README.md` 공개 MCP 도구 섹션, `DESIGN.md`, 모든 `integrations/*/README.md` 및 `*.json.example` |
| `package.json`의 `version` | `CHANGELOG.md`, 모든 `integrations/*` install ref(`#v0.X.Y`), `README.md` install snippet |
| 공개 환경 변수 (`CEREBRAS_EXPLORER_*`, `EXPLORER_*` 중 공개분) | `README.md` 설정 섹션, `DESIGN.md` |
| `src/explorer/redact.mjs` deny-list | `README.md` Security Model 섹션, `DESIGN.md` |
| `src/benchmark/evaluator.mjs` 벤치마크 스키마 | `benchmarks/adoption.json` |

## Plan 종료(closure) 규칙

`docs/superpowers/plans/<plan>.md`의 모든 task가 commit으로 landed되면 **반드시** 다음 중 하나를 수행한다:

1. 모든 `[ ]` → `[x]`로 갱신 후 `git mv`로 `docs/superpowers/plans/completed/`로 이동, **또는**
2. `plan/README.md` 정책대로 `git rm`으로 삭제.

체크박스가 미체크인 채로 plan 파일을 방치하지 말 것. `tests/integrations.test.mjs`가 과거에 완료되었던 plan 3개의 재유입을 명시적으로 차단한다.

## 테스트 규칙

- **모든 commit 전 `npm test` 통과 필수.** 이미 8개 이상의 doc-snapshot 가드(`examples/`, install refs, `recentActivity` 부재, plan closure, CHANGELOG 버전)가 통합되어 있다.
- `src/explorer/runtime.mjs`의 추론 경로를 건드린 경우, `CEREBRAS_API_KEY`가 있으면 `node scripts/integration-test.mjs`도 실행. (API 비용 발생하므로 `npm test`에는 포함되지 않음.)
- **새로 노출되는 표면**(필드/도구/환경변수)은 `tests/integrations.test.mjs`에 그에 대응하는 assertion을 동반해야 한다. 가드 없는 노출은 다음 드리프트의 원인이 된다.

## CHANGELOG 규칙

- `CHANGELOG.md`의 최상단 버전 헤딩이 `package.json`의 `version`과 일치해야 한다.
- 형식: 릴리즈된 버전은 `## v<X.Y.Z> - <YYYY-MM-DD>`, 아직 출하 전이면 `## v<X.Y.Z> - Unreleased`.
- `package.json` `version`을 올렸는데 CHANGELOG 헤딩이 없거나 여전히 "Unreleased"인 상태는 test 실패다.

## 하지 말 것 (anti-patterns)

- **메인 에이전트에 raw filesystem 도구**(Read/Glob/Grep) 노출 금지. 그건 본 MCP 서버의 존재 의의를 무효화한다.
- 새 코드/문서에서 **옛 top-level 필드명** 사용 금지: `answer`, `confidence`, `confidenceLevel`, `confidenceScore`, `candidatePaths`, `recentActivity`. 현행 compact contract만 사용: `directAnswer`, `status.confidence`, `targets[].path`, `evidenceQuality`.
- **`dependencies` / `devDependencies` 추가 금지**. zero-dep는 구조적 제약이지 우연이 아니다. 추가가 필요하다면 owner와 별도 합의.
- **`src/` 변경 후 동기화 매트릭스 확인 없이 commit 금지.** 어떤 docs를 갱신해야 할지 불확실하면 일단 `npm test` — 실패 메시지가 어느 파일이 drift했는지 가리킨다.

## 다중 에이전트 협업 주의

본 레포는 Codex Cloud 태스크 PR과 Claude Code 세션이 병렬로 작업하는 환경이다. 한 에이전트가 본 컨텍스트가 다른 에이전트로 자동 인계되지 않는다. 따라서:

- 다른 에이전트가 만든 변경을 따라잡는 docs commit을 만들 때는 **현 코드를 먼저 검증**하고, 자신이 기억하는 옛 스키마가 아니라 **실제 파일 내용**을 신뢰하라.
- 본 파일(AGENTS.md)을 모든 코딩 에이전트가 자동으로 읽는다고 가정하지 말 것. prompt에서 명시적으로 참조해야 안전하다.

## Quick reference

- Mission / quickstart: `README.md`
- Architecture: `DESIGN.md`
- Test status: `TESTING.md`
- Release history: `CHANGELOG.md`
- 과거 plan / audit: `plan/README.md`, `plan/legacy-audit.md`
- Local pre-commit hook 설치: `bash scripts/install-hooks.sh` (한 번만)

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
[`specs/020-transcript-envvar-removal/plan.md`](./specs/020-transcript-envvar-removal/plan.md)
<!-- SPECKIT END -->
