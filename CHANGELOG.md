# Changelog

## v0.4.0 - 2026-05-23

### Surface Expansion — map_impact / find_entrypoints (2026-05-23)

`specs/013-wrapper-surface-expansion/` 산출물. spec 011이 영구 고정해 둔
8-tool surface를 두 wrapper(`map_impact`, `find_entrypoints`)로 명시적으로
10-tool surface로 확장한다. backwards-compatible — 기존 8개 도구의 입출력
스키마와 동작은 변하지 않으며, 환경변수 변경도 없다. minor bump 한 release.

- **Added**: `map_impact` wrapper. parent agent가 변경 대상의 구체적
  *anchor*(파일 경로 또는 심볼 이름)를 이미 알고 있을 때 사용. anchor를
  knownFiles 또는 knownSymbols에 자동으로 push하고 `reference-chase`
  strategy로 deep dependency chain + test/config target 가중치를 적용한다.
  `map_change_impact`와의 차이는 anchor 입력의 유무: `map_change_impact`는
  자연어 change 설명만 받아 빠른 blast radius를 산출하고, `map_impact`는
  anchor를 1급 시민으로 받아 더 깊게 따라간다.
- **Added**: `find_entrypoints` wrapper. HTTP routes(Express/Fastify/NestJS/
  Flask/FastAPI/Go `net/http` & `chi`), CLI commands(commander/click/argparse/
  cobra), cron/schedule handlers(`cron.schedule`/`node-cron`/`setInterval`),
  MCP tool registrations, event handlers를 정규식 기반으로 자동 감지한다.
  `entryKind` enum(`http|cli|cron|mcp|event|all`, default `all`)으로 카테고리
  필터링 가능. 1차 spec은 JS/TS/Python/Go + 기본 cron 패턴에 한정한다 —
  Ruby/PHP/Java/Rust + Lambda/K8s CronJob/Pub-Sub 같은 후속 카테고리는 별도
  spec에서 확장한다.
- **Changed**: 공개 도구 surface 정책이 spec 011의 "영구 고정 8개"에서
  "영구 고정 10개"로 갱신되었다. README/DESIGN/integrations 7개 모두 새
  wrapper 두 개를 포함하도록 동기화되었다.
- **Caveat**: `find_entrypoints`의 entry-point 감지는 regex 기반이므로
  false positive(예: 라우트가 아닌 미들웨어 등록)를 evidence로 포함할
  가능성이 있다. parent agent는 인용된 라인을 그대로 신뢰하기보다 한 번 더
  검증해야 한다.
- **Migration**: 기존 사용자는 별도 변경 불필요. 신규 도구를 사용하려면
  MCP client의 도구 화이트리스트에 `map_impact`와 `find_entrypoints`를
  추가하면 된다 (`integrations/` 예시 갱신됨).

## v0.3.0 - 2026-05-23

### Surface Consolidation (2026-05-22)

010 follow-up cleanup bundle for `specs/011-consolidate-surface/`. Removes the
budget input knob and the `explore_v2` tool name, fixes the public tool
surface at 8, and drops ten low-use environment variables. Two intentional
breaking changes are bundled into this next minor.

- **Breaking — Removed**: `explore_repo` no longer accepts a `budget` key.
  Every call runs against the single deep runtime config (maxTurns 30,
  maxSearchResults 80, maxReadLines 320, temperature 1.0, top_p 0.95).
- **Breaking — Removed**: the `explore_v2` tool name is gone. Its V2
  backend implementation is now the only `explore` implementation, so
  every prompt receives the same truncation labels, structured citations,
  critic warnings, and tool-result truncation handling.
- **Removed**: environment variables `CEREBRAS_MODEL`,
  `CEREBRAS_EXPLORER_MODEL_QUICK|NORMAL|DEEP`,
  `CEREBRAS_EXPLORER_EXTRA_TOOLS`,
  `CEREBRAS_EXPLORER_ENABLE_EXPLORE`,
  `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`,
  `CEREBRAS_EXPLORER_AUTO_ROUTE`,
  `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`,
  `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS`. None of them are
  honored anymore — the runtime ignores them entirely.
- **Removed**: the 010 opt-in branches behind those last two envvars.
  Auto repo-keyed session reuse is gone (`SessionStore.findReusableForRepo`
  was deleted; `_debug.stats.sessionSource='auto_repo'` no longer
  appears). The 010 migration window for legacy reference-target
  promotion is closed; discoveries surface only via top-level
  `discoveredPaths[]`.
- **Changed**: tool surface is now fixed at 8 regardless of any
  environment variable: `explore_repo`, the six wrappers, and `explore`.
- **Changed**: `CEREBRAS_EXPLORER_MODEL` is the single source of truth
  for model selection. Operators who previously used budget-specific
  model overrides should run a second server instance with a different
  `CEREBRAS_EXPLORER_MODEL` if they need that cost split.
- **Migration**:
  - Drop the `budget` key from every `explore_repo` / wrapper invocation.
  - Replace `explore_v2` tool-name calls with `explore`.
  - Stop relying on the removed env vars; the runtime ignores them.
  - Use explicit `session` arguments instead of
    `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`.
  - If you need a minimal tool surface, filter at the MCP gateway.

## v0.2.1 - 2026-05-22

### Feedback Verification Fixes (2026-05-22)

Docs + runtime bundle for `specs/010-feedback-verification-fixes/`. Externally
verified feedback (16 claims) collapsed into 5 reliability fixes; every schema
change is additive and every behavior change is guarded by a default-off env
var so existing consumers can opt into the prior behavior for one release.

- **Changed**: `status.complete`/`verification`/`failure.reason`/`nextAction`
  now use evidence sufficiency as the primary signal instead of budget
  exhaustion alone. Budget-exhausted runs with enough grounded evidence stay
  `complete:true`, keep `searchCoverage.stoppedByBudget=true`, and surface
  "budget exhausted after sufficient evidence" in `status.warnings`.
- **Added**: Top-level `discoveredPaths[]` (`path`/`kind`/`sourceTool`/`reason`)
  separates discovery noise (list_dir, find_files, git diff/show) from the
  actionable `targets[]`. Report tools merge same-file citations at file level
  with min/max line ranges. Legacy promotion is available via
  `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` for one release.
- **Changed**: Redaction preserves `process.env.X`/`import.meta.env.X`/
  `Deno.env.get("X")` identifiers as a public code interface; secret values and
  secret file paths still mask. Strict masking remains available via
  `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1`.
- **Changed**: `repo_git_diff` (file + stat) and `repo_git_show` now enforce
  the base scope as a hard boundary like every other repo tool. Omitted file
  counts surface as additive optional `omittedOutOfScopeFiles` /
  `omittedSecretPaths` fields.
- **Added**: Opt-in `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` makes
  `resolveSessionForExplore` auto-reuse the most-recently-used reusable session
  for the same repoRoot when no explicit `session` argument is provided.
  `session.status` enum is unchanged; auto reuse is exposed via the
  `_debug.stats.sessionSource='auto_repo'` diagnostic.
- **Documentation**: README/DESIGN/AGENTS now describe the wrapper decision
  rule, `_meta.progressToken` recommendation for heavy calls, the
  control-plane fields agents must preserve when handing off a result, and the
  three new opt-in env vars.

## v0.2.0 - 2026-05-19

### Tool Quality Follow-up (2026-05-21)

Docs-only bundle for `docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md`.

- **Changed**: Clarified V2 tool-result truncation wording so callers understand truncation happens before model synthesis and must be treated as an evidence-limit signal.
- **Changed**: Expanded the `explore` router heuristics for broad/deep report prompts while keeping `explore_v2` as an opt-in tool surface.
- **Added**: Exposed report-mode `citations[]` and citation-derived `targets[]` in `structuredContent` for `explore`/`explore_v2`.
- **Added**: Added the `benchmark:evidence` suite for citation/evidence preservation checks.
- **Added**: Added transcript-based adoption metrics for broad-search and repeated-plan signals, plus adoption-suite evidence snippet checks.

### Added

- Declared read-only MCP tool annotations for every exposed tool.
- Added a stdio guard and regression coverage for NDJSON and Content-Length framing.
- Added Gemini CLI integration examples and documented environment variable sanitization.
- Updated Codex CLI examples to use `npx` with `enabled_tools` and `disabled_tools`.

### Security

- Added a default secret path deny-list for `.env*`, SSH/GPG material, cloud credentials, package manager credentials, key/certificate files, and common `secrets/**` paths.
- Added response and provider-facing redaction for common API keys, PATs, JWTs, private key blocks, and optionally generic hex tokens.
- Preserved evidence grounding fields while adding redaction metadata as an additive contract.

### Documentation

- Reworked the README first screen around quickstart, supported clients, tool exposure, and security model.
- Removed stale `#main` GitHub refs from documented install snippets.
