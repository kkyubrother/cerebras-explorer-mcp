# v0.2.0 Implementation Checklist

기준 문서: `plan/v0.2.0-release-plan.md`
작성일: 2026-05-12 KST

이 체크리스트는 v0.2.0 release gate만 다룬다. `roots/list`, `resource_link`, provider alias/model fallback, `--doctor`, protocol whitelist, `_debug.usage` 표준화는 v0.2.x backlog로 둔다.

각 phase는 다음 순서를 따른다.

1. 구현한다.
2. 관련 테스트를 실행한다.
3. 실패한 테스트를 수정한다.
4. 관련 문서를 갱신한다.
5. 이 체크리스트에 체크 표시한다.
6. 커밋한다.

## Phase 0: Baseline Audit

- [x] 현재 `git status --short`가 의도한 변경만 보여주는지 확인한다.
- [x] `npm test`의 현재 실행 범위를 확인하고 nested test가 빠지는 문제를 기록한다.
- [x] `tools/list` 기본 8개, `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true` 최대 9개, `CEREBRAS_EXPLORER_EXTRA_TOOLS=false` 2개, `EXTRA_TOOLS=false + ENABLE_EXPLORE=false` 1개 노출 조합을 기준값으로 기록한다.
- [x] `.env` read/grep 노출 재현이 가능한지 fixture 또는 기존 재현 명령으로 확인한다.
- [x] README/DESIGN의 설계 제약을 기준으로 v0.2.0 범위가 맞는지 확인한다: read-only, zero dependencies, low-level repo tools 비노출, provider/failover 공개 계약화 회피.
- [x] 관련 문서 변경 필요 목록을 기록한다.
- [x] Phase 0 결과를 커밋한다.

Phase 0 evidence:

- `git status --short`: `plan/v0.2.0-release-plan.md` 수정, `plan/checklist.md` 신규만 존재.
- `npm test`: current script is `node --test ./tests/*.test.mjs`; result `259 tests / 258 pass / 0 fail / 1 skip`.
- `tools/list`: default 8, V2 enabled 9, extras disabled 2, extras disabled plus explore disabled 1.
- Secret baseline: fixture `.env` read contains an OpenAI-shaped fixture token; `grep` with `['**']` matches `.env`.
- README/DESIGN direction: v0.2.0 scope matches read-only, zero-dependency, parent one-delegation, low-level repo tools hidden, provider/failover not promoted to public contract.
- Related docs to update: README, DESIGN, integrations, CHANGELOG, plus `#main` cleanup in README and `integrations/opencode/README.md`.

## Phase 1: Test Runner And Tool Annotations

- [x] `npm test`가 nested tests까지 실행하도록 test runner를 보정하거나 신규 테스트를 `tests/*.test.mjs` 최상위에 둔다.
- [x] 모든 exposed tool에 `annotations`를 추가한다.
- [x] annotations가 보안 경계가 아니라 클라이언트 UX hint임을 문서에 명시한다.
- [x] `tools/list` 테스트를 추가한다: 기본 8개.
- [x] `tools/list` 테스트를 추가한다: V2 활성화 시 9개.
- [x] `tools/list` 테스트를 추가한다: `CEREBRAS_EXPLORER_EXTRA_TOOLS=false` 시 2개.
- [x] `tools/list` 테스트를 추가한다: `CEREBRAS_EXPLORER_EXTRA_TOOLS=false`와 `CEREBRAS_EXPLORER_ENABLE_EXPLORE=false` 시 1개.
- [x] 각 조합의 모든 tool이 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`를 갖는지 검증한다.
- [x] 관련 테스트를 실행하고 실패를 수정한다.
- [x] README/DESIGN의 공개 도구 설명과 annotations 설명을 갱신한다.
- [x] 체크 표시 후 Phase 1 결과를 커밋한다.

Phase 1 evidence:

- `package.json` test script now runs `node --test "tests/**/*.test.mjs"`.
- `src/mcp/server.mjs` adds read-only annotations to all default, extra, `explore`, and `explore_v2` tools.
- `tests/mcp-server.test.mjs` verifies 1/2/8/9 exposed tool shapes and annotations.
- `node --test tests/mcp-server.test.mjs`: 7 tests / 7 pass.
- `npm test`: 260 tests / 259 pass / 0 fail / 1 skip.

## Phase 2: Stdio Purity

- [x] `src/index.mjs`에 stdio guard를 추가해 console 출력이 stderr로 향하게 한다.
- [x] NDJSON handshake 중 stdout이 JSON-RPC frame만 포함하는지 검증하는 테스트를 추가한다.
- [x] Content-Length handshake 중 stdout이 JSON-RPC frame만 포함하는지 검증하는 테스트를 추가한다.
- [x] `MCP_STDIO_GUARD=0` opt-out 동작을 문서화하거나 테스트한다.
- [x] 관련 테스트를 실행하고 실패를 수정한다.
- [x] README/DESIGN의 stdio framing 설명이 구현과 맞는지 갱신한다.
- [x] 체크 표시 후 Phase 2 결과를 커밋한다.

Phase 2 evidence:

- `src/index.mjs` installs a stdio guard for `console.log`, `console.info`, `console.debug`, and `console.warn`, with `MCP_STDIO_GUARD=0` opt-out.
- `tests/integration/stdio-purity.test.mjs` verifies NDJSON and Content-Length handshakes.
- Initial Content-Length test failure exposed a byte-length parsing bug in the test; parser now uses `Buffer` offsets.
- `node --test tests/integration/stdio-purity.test.mjs`: 2 tests / 2 pass.
- `npm test`: 262 tests / 261 pass / 0 fail / 1 skip.

## Phase 3: Secret Deny-list

- [x] 새 runtime dependency 없이 secret path matcher를 구현한다.
- [x] 기본 deny-list에 `.env`, `.env.local`, `.env.*`, `.envrc`를 포함한다.
- [x] 기본 deny-list에 `.npmrc`, `.netrc`, `.pypirc`를 포함한다.
- [x] 기본 deny-list에 `.ssh/**`, `id_rsa`, `id_ed25519`, `.gnupg/**`를 포함한다.
- [x] 기본 deny-list에 `.aws/credentials`, `.aws/config`, `.azure/**`, cloud credential 패턴을 포함한다.
- [x] 기본 deny-list에 `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/**`, `**/credentials.json`을 포함한다.
- [x] deny-list를 `walkFiles`와 `listDirectory`에 적용한다.
- [x] deny-list를 ripgrep fast path의 `--glob` exclude에 적용한다.
- [x] deny-list를 fallback grep에 적용한다.
- [x] deny-list를 `RepoToolkit.readFile`에 적용한다.
- [x] deny-list를 `symbols`, `references`, `symbolContext`, context enrichment 경로에 적용한다.
- [x] deny-list를 `runtime.mjs`의 `readEvidenceSnippet()`에 적용한다.
- [x] provider-facing tool message에 deny-listed 파일 원문이 들어가지 않는지 mock provider 테스트를 추가한다.
- [x] `CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST=1`을 제공한다면 위험 경고와 함께 문서화한다.
- [x] 관련 테스트를 실행하고 실패를 수정한다.
- [x] README/DESIGN Security model을 갱신한다.
- [x] 체크 표시 후 Phase 3 결과를 커밋한다.

Phase 3 evidence:

- `src/explorer/security.mjs` implements default secret deny patterns and matcher without new dependencies.
- `RepoToolkit` applies deny-list policy to traversal, directory listing, ripgrep excludes, fallback grep, read, symbols, git path validation, and context enrichment.
- `runtime.mjs` blocks deny-listed evidence snippet reads.
- `tests/security/secret-deny-list.test.mjs` covers `.env`, `.env.local`, `.npmrc`, `.ssh/id_rsa`, `.aws/credentials`, `secrets/app.pem`, `src/credentials.json`, disable env, and provider-facing tool messages.
- `node --test tests/security/secret-deny-list.test.mjs`: 4 tests / 4 pass.
- `npm test`: 266 tests / 265 pass / 0 fail / 1 skip.

## Phase 4: Secret Redaction

- [x] 새 runtime dependency 없이 redaction 모듈을 구현한다.
- [x] AWS access key, GitHub PAT, OpenAI key, GCP API key, Slack token, Anthropic key, Stripe live secret, JWT, private key block 패턴을 포함한다.
- [x] generic 32+ hex redaction은 false positive 위험 때문에 기본 off 또는 별도 옵션으로 둔다.
- [x] redaction 치환 문자열은 ASCII `[REDACTED:<rule>]` 형태를 사용한다.
- [x] line reference는 유지하고 민감 문자열만 치환한다.
- [x] `structuredContent.evidence`에 additive `redacted`/`redactions` metadata를 보존한다.
- [x] `content[0].text`와 `structuredContent`에 redaction을 적용한다.
- [x] `explore` Markdown과 `explore_v2` Markdown에 redaction을 적용한다.
- [x] evidence snippet에 redaction을 적용한다.
- [x] git diff/show patch에 redaction을 적용한다.
- [x] `_debug` 문자열 필드에 redaction을 적용한다.
- [x] provider-facing tool message에 redaction을 적용한다.
- [x] redaction fixture 테스트를 추가한다.
- [x] 관련 테스트를 실행하고 실패를 수정한다.
- [x] README/DESIGN의 반환 스키마와 evidence 예시를 갱신한다.
- [x] 체크 표시 후 Phase 4 결과를 커밋한다.

Phase 4 evidence:

- `src/explorer/redact.mjs` implements recursive redaction without new dependencies.
- Runtime redacts provider-facing tool messages and assistant messages before any repair/follow-up provider call.
- MCP server redacts `content[0].text`, `structuredContent`, `explore`, and `explore_v2` outputs.
- `RepoToolkit` redacts git diff/show patch and commit message surfaces.
- `EXPLORE_REPO_OUTPUT_SCHEMA` allows additive `redacted` and `redactions` evidence metadata.
- `tests/security/redact.test.mjs` covers secret patterns, recursive object redaction, provider-facing messages, MCP content/structured output, Markdown tools, evidence metadata, and git patch redaction.
- `node --test tests/security/redact.test.mjs`: 5 tests / 5 pass.
- `npm test`: 271 tests / 270 pass / 0 fail / 1 skip.

## Phase 5: Integrations And README/DESIGN Sync

- [x] `integrations/gemini/settings.json.example`을 추가한다.
- [x] `integrations/gemini/README.md`를 추가한다.
- [x] Gemini CLI env sanitization을 문서화하고 `CEREBRAS_API_KEY`가 config `env`에 들어가도록 예시를 둔다.
- [x] Gemini CLI command와 settings JSON 예시를 함께 제공한다.
- [x] Codex example을 npx-based로 갱신한다.
- [x] Codex `enabled_tools`/`disabled_tools` 예시를 추가한다.
- [x] README 첫 화면을 슬림화한다.
- [x] README에 기본 8개, 최대 9개, 최소 1개 tool 노출 구성을 명시한다.
- [x] README에 Security model을 추가한다: read-only, allowed root, realpath, symlink 거부, secret deny-list/redaction, provider API egress 제한.
- [x] README에 annotations는 UX hint이며 보안 경계가 아님을 명시한다.
- [x] README와 integrations에서 `#main` 불일치를 제거한다.
- [x] DESIGN에 secret deny-list, redaction metadata, evidence grounding 유지 정책을 additive contract로 반영한다.
- [x] CHANGELOG를 작성한다.
- [x] example JSON/TOML/YAML 파일을 파싱 또는 문법 검토한다.
- [x] 관련 테스트를 실행하고 실패를 수정한다.
- [x] 체크 표시 후 Phase 5 결과를 커밋한다.

Phase 5 evidence:

- `integrations/gemini/settings.json.example` adds `cerebras-explorer` with `npx`, pinned `#v0.1.0`, `CEREBRAS_API_KEY` in `env`, and a narrow `includeTools` allowlist.
- `integrations/gemini/README.md` documents global/project settings paths, env sanitization, alias naming, `includeTools`/`excludeTools`, CLI registration, and `gemini mcp list` verification.
- `integrations/codex/config.toml.example` now uses `npx`, startup/tool timeouts, `enabled_tools`, optional `disabled_tools`, and env config.
- README first screen now contains quickstart, seven-client matrix, default/min/max tool exposure, annotations hint warning, and Security Model.
- DESIGN records redaction metadata as an additive evidence grounding contract.
- `CHANGELOG.md` records v0.2.0 unreleased additions/security/docs.
- `tests/integrations.test.mjs` parses JSON examples and reviews Codex TOML, Continue YAML, Gemini docs, and stale `#main` refs.
- `node --test tests/integrations.test.mjs`: 5 tests / 5 pass.
- `npm test`: 276 tests / 275 pass / 0 fail / 1 skip.

## Phase 6: Release Verification

- [ ] `npm test`를 실행하고 신규 annotations/stdio/security/redaction 테스트가 포함됐는지 확인한다.
- [ ] `npm ls --depth=0 --json`으로 신규 runtime dependency가 없는지 확인한다.
- [ ] `tools/list` env 조합 1/2/8/9개를 수동 또는 테스트로 재확인한다.
- [ ] NDJSON handshake smoke를 실행한다.
- [ ] Content-Length handshake smoke를 실행한다.
- [ ] `rg '#main' README.md integrations`가 의도한 결과만 반환하는지 확인한다.
- [ ] README, DESIGN, plan, checklist의 release gate가 서로 모순되지 않는지 확인한다.
- [ ] `git status --short`가 release verification 변경만 보여주는지 확인한다.
- [ ] 실패 또는 불일치가 있으면 수정하고 관련 테스트를 다시 실행한다.
- [ ] 체크 표시 후 Phase 6 결과를 커밋한다.
