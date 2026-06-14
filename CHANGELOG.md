# Changelog

## v0.8.8 - 2026-06-14

### revert: secret deny-list matching back to case-sensitive

No public surface, tool schema, `schemaVersion` (2), or wire-protocol change.

- **Reverted (v0.8.7)**: the deny-list `globToRegExp` no longer carries the
  regex `i` flag — secret-path matching is case-sensitive again, as it was
  through v0.8.6. On case-sensitive filesystems (the primary deployment target)
  case-sensitive matching is strictly more precise: it does not skip ordinary
  files whose names merely case-fold onto a secret pattern (e.g. a `Secrets/`
  directory, a `Deck.KEY` Keynote file, `Credentials.JSON`). The case-variant
  bypass that v0.8.7 closed only applied on case-insensitive filesystems (macOS
  APFS, Windows NTFS), which are out of scope for this stdio/Linux deployment;
  the revert trades that narrow protection for precision and behavioral
  stability. The case-variant test added in v0.8.7 is removed with the revert.

## v0.8.7 - 2026-06-14

### case-insensitive secret deny-list matching

No public surface, tool schema, `schemaVersion` (2), or wire-protocol change.
Security hardening of an internal matcher.

- **Fixed (security)**: the secret deny-list compiled its glob patterns without
  the regex `i` flag, so case-variant secret paths (`.ENV`, `Secret.PEM`,
  `ID_RSA`) bypassed the deny-list. On case-insensitive filesystems (macOS
  APFS, Windows NTFS) such a variant still resolves to the real secret file, so
  a model-supplied case-variant path could surface a secret the canonical-case
  pattern was meant to block. `globToRegExp` in `src/explorer/security.mjs` now
  matches case-insensitively. The separate `globToRegExp` in `repo-tools.mjs`
  (scope / `findFiles` / ignore matching) intentionally stays case-sensitive to
  preserve search semantics on case-sensitive filesystems.
- **Added**: case-variant coverage in
  `tests/security/secret-deny-list.test.mjs` — positive cases for case-folded
  secret paths plus over-match negatives (`SecretsManager.ts`,
  `Account-Service.ts` stay allowed; patterns are segment-anchored, so
  case-folding does not over-match ordinary files).

## v0.8.6 - 2026-06-14

### adoption benchmark prompt-echo credit removal (spec 027)

No public surface, tool schema, `schemaVersion` (2), or runtime behavior
change. Benchmark-internal only.

- **Fixed (spec 027)**: the adoption benchmark (`benchmarks/adoption.json`) no
  longer awards keyword-group credit to answers that merely echo a case's own
  input args. The evaluator matches a group on any one token and awards
  `pointsEarned = coverage * weight` decoupled from the pass gate, so a group
  holding even one arg-derived token was earnable by pure echo (`trace-symbol`
  scored 0.15/1.0 for parroting the input symbol). 18 echo tokens across 8 cases
  were stripped; the all-echo `structured-output-contract` expectation was
  rewritten to located-file discovery groups. `trace-symbol` echo-only score is
  now 0.
- **Added (spec 027)**: `tests/adoption-suite-hygiene.test.mjs` — a
  deterministic guard asserting no scored expectation group contains an echo
  token (substring of the case args values) and every scored expectation keeps
  ≥1 group and ≥1 discovery group (an empty group list would otherwise score
  full vacuous credit). Reuses the evaluator's `normalizeText` (now exported)
  for parity; empty allowlist.
- **Changed**: README benchmark section documents that keyword scoring credits
  discovered facts, not input echo.
- **Dropped (backlog)**: automated parent-agent A/B measurement is removed from
  the extension backlog with a recorded reason (never-gating, npm-test-external,
  brittle against parent CLI format drift, zero-dep pressure); TESTING.md manual
  observation procedures §1–§2 remain the honest stand-in.

## v0.8.5 - 2026-06-12

### symbol_trace usage cross-check enforcement (spec 026)

The public 8-tool surface, input schemas, and `schemaVersion` (2) are
unchanged. All changes are additive to the `symbol_trace` / `trace_symbol`
path only; other five wrappers, direct `explore_repo`, and `explore`
produce byte-identical responses.

- **Added (spec 026, US1)**: deterministic usage cross-check gate for
  `trace_symbol` — when a `symbol_trace` exploration reaches `verified`
  without an observed `repo_grep` or `repo_references` for the target
  symbol, the runtime downgrades `status.verification` to
  `targeted_read_needed`, caps `confidence` at medium, and emits a new
  additive `usage_cross_check_missing` critic warning (severity: medium).
  The gate is suppressed on critic-fail / abort / no-evidence / low-confidence
  precedence routes, and is satisfied by any scope-aware grep attempt
  (including 0-match results) or a `repo_references({symbol})` call.
- **Added (spec 026, US1)**: `usage_cross_check_missing` critic warning type
  — shape `{type, severity, message, target, action}` per the compact critic
  contract; competes within the existing 3-warning budget.
- **Fixed (spec 026, US2)**: deterministic, diversity-preserving caller
  truncation in `symbolContext` — the internal grep cap is raised from 40 to
  `budgetConfig.maxSearchResults` (80), and the `callers.slice(0,20)`
  selection now applies a deterministic priority sort: code files before
  generic, call/member_call/constructor relations before reference, per-file
  round-robin cap of 3, then stable (path, line) order. Identical inputs
  now always produce identical outputs; the production callsite is included
  deterministically even when non-code matches exceed the budget.
- **Added (spec 026, US3)**: symbol-first strategy prompt cross-check
  instruction — the `symbol-first` approach now instructs the explorer to
  run one scope-wide `repo_grep` for the bare symbol name after confirming
  the definition and before finalizing, with `truncated: true` as an
  additional fallback trigger. This reduces gate-firing frequency as a
  cost-saving layer complementary to US1.
- **Added (spec 026, Polish)**: `critic_warning_absent` benchmark check type
  in the declarative suite evaluator — passes when the named `warningType`
  is absent from `result.critic.warnings[]`; record-only benchmark policy
  (spec 021) maintained.
- **Added (spec 026, Polish)**: new `trace-symbol-cross-check` benchmark case
  in `benchmarks/adoption.json` — traces `buildReportCritic` expecting
  definition + `src/explorer/runtime.mjs` production callsite in targets,
  grounded evidence, and absence of the `usage_cross_check_missing` warning.
  The existing `trace-symbol` case is unchanged for trend continuity.

## v0.8.4 - 2026-06-10

### Benchmark effect measurement (spec 025)

The public 8-tool `structuredContent` contract and `schemaVersion` are
unchanged. `_meta.ops` is operational metadata, not part of the answer payload.

- **Added (spec 025)**: the benchmark records deterministic effect metrics —
  response payload tokens vs cited-source tokens (a conservative lower bound of
  parent context savings) and an independent `citationAccuracy` computed by
  re-reading cited files instead of trusting self-reported `groundingStatus`.
- **Added (spec 025)**: `explore_repo` and the six wrappers now return the same
  `_meta.ops` side-channel (`stats`, `transcriptPath`) the `explore` tool
  already had, fulfilling the spec 017 follow-up promise of a local ops
  channel.
- **Fixed (spec 025)**: dead benchmark metrics no longer fabricate values —
  `avgToolTurns`/`noToolExitRate` read real ops data (previously always
  `0`/`100%`), `budgetExhaustionRate` reads `searchCoverage`, transcript
  metrics run again via an auto-enabled temporary transcript directory
  (`--keep-transcripts` to retain), and the spec-011-dead
  `deepBudgetAvgTotalTokens` metric is deleted. Metrics without a source print
  `n/a`.
- **Fixed (spec 025)**: transcript record appends are serialized through a
  per-recorder write chain, so `finalize()` guarantees a complete, in-order
  JSONL before the benchmark (or any reader) consumes it.

## v0.8.3 - 2026-06-10

### Execution provenance (spec 022) & doc hygiene

The public 8-tool surface and `schemaVersion` are unchanged. Provenance is
operational/evaluation envelope metadata and is not added to the MCP
`structuredContent` contract.

- **Added (spec 022)**: transcript JSONL initial `meta` records and benchmark
  JSON reports now carry execution provenance — server name/version, package
  version, compact schema version, git SHA (when resolvable), public tool
  registry hash, and the exposed tool count/name list — so a transcript or
  benchmark verdict can be attributed to the exact executor build.
- **Fixed (integrations)**: the Claude agent/skill and Codex role TOML/skill
  prose no longer describe the removed `budget` (spec 011) and
  `explore.thoroughness` (spec 023) inputs as settable in advanced workflows;
  both are rejected inputs. A new drift guard in `tests/integrations.test.mjs`
  rejects settable-parameter phrasing for removed inputs.
- **Docs**: `CLAUDE.md`/`AGENTS.md` no longer point at the closed spec 024 plan
  as the current plan; the extension backlog header reflects that all four
  candidates were consumed (specs 012–015); the release procedure now covers
  the hardcoded tag/version pins under `tests/`; `TESTING.md` observations
  refreshed (2026-06-10 run).

## v0.8.2 - 2026-06-05

### Evidence integrity

The public 8-tool surface and `schemaVersion` are unchanged; this adds one
additive critic warning type.

- **Fixed (report critic)**: report-mode (`explore`) git citations
  (`commit:<sha>`, `blame:<path>:L<n>`) are now grounded against the git tool
  calls actually observed during exploration. A cited commit or blame line that
  was never inspected raises a new `git_citation_gap` critic warning — symmetric
  to `citation_line_gap` for file-range citations. Previously git citations were
  counted toward the citation total but never verified, so a fabricated
  `commit:` reference could pass the report critic unflagged.

## v0.8.1 - 2026-06-04

### Security & robustness (audit remediation)

Fixes from a tool-behavior audit (live exploration of real repos + deterministic
probes). The public 8-tool surface and `schemaVersion` are unchanged.

- **Fixed (security, F1)**: the explorer could leak a committed private key
  verbatim through evidence snippets. The `private-key-block` redaction required
  a complete `BEGIN…END` block, but snippet truncation routinely cut off the
  `END` marker; and the deny-list did not cover service-account credential JSON.
  Added an unclosed/truncated private-key fallback redaction and deny
  `*service-account*.json` / `*service_account*.json` by name.
- **Fixed (security, F6)**: `repo_git_diff` `stat:true` could leak a secret path
  when a rename used git's `prefix/{old => new}` form — the shared prefix was
  dropped from the new side, so a path-deny-listed secret (e.g. `.git/config`)
  was missed. Rename paths are now reconstructed before the deny-list check.
- **Fixed (robustness, F3)**: the JS grep fallback (base-scope greps / no
  ripgrep) ran model-supplied regexes with no time budget, so a nested-quantifier
  pattern could block the event loop (ReDoS). Such patterns are now rejected on
  the fallback path with an actionable error; the linear-time ripgrep path is
  unchanged.
- **Fixed (F2)**: the `explore` report loop now recognizes Korean/CJK
  intent-only preambles ("…보고서를 작성하겠습니다") as non-reports, so a
  degenerate preamble is reported as "could not produce a report" instead of
  being surfaced as the report body.
- **Fixed (F5)**: a malformed `Content-Length` frame no longer wedges the
  Content-Length transport path — the bad header is skipped and the stream
  resynced instead of throwing and dropping every subsequent framed message.
- **Changed (F4)**: the context-management prompt now names the truncation
  markers the runtime actually emits (`"[truncated…]"`, "summarized to save
  context") instead of literals (`"[summarized]"`) that never appear.
- **Changed (F7)**: handled failures now mirror the machine-readable
  `failure.reason` into the error text, so MCP clients that surface only the
  text on `isError` still see the reason.

## v0.8.0 - 2026-06-02

### Context-window safety (spec 024)

Behavior fixes to the explorer runtime's context management and evidence
grounding (spec 023 was wording-only; these are split out as behavior changes).
The public 8-tool surface and `schemaVersion` are unchanged.

- **Fixed (spec 024)**: the report-loop compaction fallback now fires at the 70%
  threshold instead of 100%, so simple truncation actually runs in the 70–100%
  band when LLM-summary compaction is unavailable (previously a no-op).
- **Changed (spec 024)**: the compact (`explore`) loop now compacts proactively
  at 70% of the context window (matching the report loop) and re-injects a
  deterministic evidence ledger (verified `path:Lx-Ly` ranges) so grounded
  anchors survive tool-result truncation.
- **Changed (spec 024)**: token estimation now weights non-ASCII (CJK) text more
  heavily than the flat chars/4 heuristic, reducing under-counting that delayed
  compaction on Korean/CJK-heavy contexts.
- **Added (spec 024)**: report citations are now line-range grounded — a
  `citation_line_gap` critic warning is emitted when a cited range overlaps no
  inspected range (previously only path-level "was this file read" grounding).
- **Changed (spec 024)**: the report system prompt no longer claims `[truncated]`
  markers preserve key information; it advises re-reading a narrower range when
  evidence seems missing.

## v0.7.1 - 2026-05-31

### Prompt & contract hygiene (spec 023)

The public 8-tool surface and `schemaVersion` are unchanged; this pass aligns
tool descriptions, prompt contracts, and runtime configuration names with what
the runtime actually does.

- **Changed (spec 023)**: `explore_repo` is now described as the general
  fallback (not "Use first") so the six purpose tools are the front door; the
  stale `budget` mention is dropped (it is a rejected input); the
  `repo_references` "all usages" description is corrected to match runtime
  behavior; sibling-defer hints were added to
  `trace_symbol`/`explain_code_path`/`collect_evidence`.
- **Changed (spec 023)**: the explorer system prompts now explicitly permit
  identifying candidate `role:edit` targets (while still forbidding mutation
  and patches) and add an untrusted-content / prompt-injection hard requirement
  that treats repository content and tool output as data, not instructions.
- **Added (spec 023)**: `explain_code_path` joins the retry-tool vocabulary
  (`RETRY_SCHEMA` enum + runtime `RETRY_TOOLS`) for contract symmetry; a test
  pins the two lists set-equal.
- **Changed (spec 023)**: removed the stale V1/V2 free-explore prompt split from the
  public contract. The remaining `buildFreeExploreSystemPrompt` /
  `buildFreeExploreFinalizePrompt` functions are the live single report-backend
  builders.
- **Removed (spec 023)**: inert `explore.thoroughness` input and the old
  `CEREBRAS_EXPLORER_V2_TURN_MULTIPLIER`,
  `CEREBRAS_EXPLORER_V2_MAX_EXTRA_TURNS`,
  `CEREBRAS_EXPLORER_V2_MAX_COMPACTIONS` tuning envvar names. Use
  `CEREBRAS_EXPLORER_TURN_MULTIPLIER`,
  `CEREBRAS_EXPLORER_MAX_EXTRA_TURNS`, and
  `CEREBRAS_EXPLORER_MAX_COMPACTIONS`.
- **Out of scope (spec 023)**: wrapper output-language preservation (results
  are consumed by an upstream agent that controls language) and
  `repo_symbol_context` depth disclosure (already documented at the param level).

## v0.7.0 - 2026-05-31

### BREAKING: remove legacy transcript env aliases (spec 020)

The deprecated hidden aliases from the spec 018 transcript work are removed.
Transcript logging is now controlled solely by `CEREBRAS_EXPLORER_LOG_PATH`
(opt-in by path), with `CEREBRAS_EXPLORER_LOG_RAW` as the raw-mode escape hatch.

- **BREAKING (spec 020)**: `CEREBRAS_EXPLORER_TRANSCRIPT` and `CEREBRAS_EXPLORER_TRANSCRIPT_DIR` are removed. Setting them no longer enables transcript recording or selects the output directory — they are silently ignored.
- **Migration**: replace `CEREBRAS_EXPLORER_TRANSCRIPT=true` plus `CEREBRAS_EXPLORER_TRANSCRIPT_DIR=<dir>` with a single `CEREBRAS_EXPLORER_LOG_PATH=<dir>`. The path implies opt-in, so no separate enable flag is needed.

## v0.6.2 - 2026-05-30

### Trust surface tightening (spec 019) + citation and finalization fixes

Backwards-compatible bundle. The public 8-tool surface, input schemas, and
`schemaVersion` (2) are unchanged; structured output gains stronger trust
signals, plus two correctness fixes and a tool-description refresh.

- **Changed (spec 019)**: evidence grounding is stricter — `grep`/`blame`
  anchors count as `exact` only when the full claimed line range was actually
  observed, and malformed evidence ranges are dropped instead of being coerced
  to line 1.
- **Added (spec 019)**: trust caveats now surface when evidence was dropped, a
  tool result was truncated, or the turn budget stopped the run. `critic` and
  `searchCoverage` are always present in structured output (additive for
  consumers), and `searchCoverage.omittedDiscoveredPaths` signals when the
  `discoveredPaths` list was capped.
- **Changed (spec 019)**: the Markdown `explore` answer is separated from
  operational diagnostics, default snippet duplication is reduced, stderr log
  paths are sanitized, and successful failover completions attribute the
  provider/model actually used.
- **Fixed (#21)**: dotfile citations such as `.github/PULL_REQUEST_TEMPLATE.md`
  no longer lose their leading dot in `extractReportCitations`, which had caused
  a false-positive `citation_gap` warning on otherwise grounded reports.
- **Fixed (#19)**: short intent-only `explore` responses are routed through the
  final report synthesis path instead of being treated as a finished report.
- **Changed (#22)**: refined the `explore_repo`, `explore`, `find_relevant_code`,
  and `map_change_impact` tool descriptions for clearer routing — description
  text only; schemas and runtime behavior are unchanged.
- **Internal**: added the Codex Speckit integration and dropped obsolete
  QUESTION.md handoff notes.
- **Migration**: none. All changes are backwards-compatible.

## v0.6.1 - 2026-05-27

### Transcript ops log channel (spec 018)

- **Added**: `CEREBRAS_EXPLORER_LOG_PATH` enables per-call transcript JSONL
  files for `explore_repo`, all six wrappers, and `explore`.
- **Added**: transcript filenames and every JSONL record now include a shared
  UUID `callId`; final meta records include whether the file was redacted.
- **Added**: every explore call emits a single stderr operational summary with
  tool name, turns, tool calls, budget stop state, elapsed time, optional
  `log=<path>`, and optional `raw=true`.
- **Security**: transcript records use the same redaction policy as responses
  by default. `CEREBRAS_EXPLORER_LOG_RAW=true` is the explicit raw-mode escape
  hatch for local debugging only.
- **Planned breaking (v0.7.0)**: `CEREBRAS_EXPLORER_TRANSCRIPT` and `CEREBRAS_EXPLORER_TRANSCRIPT_DIR` are deprecated hidden aliases and will be removed; use `CEREBRAS_EXPLORER_LOG_PATH` instead.

## v0.6.0 - 2026-05-27

### BREAKING: remove `_debug` and session features from the response/input contract (spec 017)

The MCP `structuredContent` contract is now a strict compact envelope with no
operational metadata or session control-plane. `schemaVersion` bumps from `1`
to `2`.

- **BREAKING (spec 017)**: `_debug`, `sessionId`, and `session` are removed
  from every MCP response (`explore_repo`, the six purpose wrappers, and
  `explore`). Parent agents never surfaced `_debug` to a human, so it could
  not function as an operational debugging channel; the session fields are
  removed alongside it for consistency.
- **BREAKING (spec 017)**: the `session` input parameter is removed from
  `explore_repo`, `explore`, and all six wrapper tools. Schema validation
  (`additionalProperties: false`) rejects requests that still pass `session`.
- **BREAKING (spec 017)**: `SessionStore` (`src/explorer/session.mjs`) and
  `tests/session.test.mjs` are deleted. Multi-call session continuity is no
  longer supported; every call starts a fresh exploration.
- **BREAKING (spec 017)**: `schemaVersion` bumps from `1` to `2`. The
  `EXPLORE_REPO_OUTPUT_SCHEMA` no longer lists `_debug`, `sessionId`, or
  `session`. The `invalid_session` failure reason is removed from the
  `FAILURE_SCHEMA` enum.
- **Changed**: benchmark/evaluator/transcript code paths now read raw
  `result.stats` directly; the `_debug.stats` fallback is gone. Live-API
  benchmark extended metrics (`avgToolTurns`, `budgetExhaustionRate`,
  `noToolExitRate`, `deepBudgetAvgTotalTokens`) will degrade to zero/null
  for cases that run through the MCP envelope until a follow-up spec adds
  a local ops log channel.
- **Migration**: drop any `session` arguments from your MCP calls and stop
  reading `_debug` / `sessionId` / `session` from responses. If you relied
  on session multi-call continuity, expect every call to start fresh.
  Operational debugging belongs in stderr ops summaries and
  `CEREBRAS_EXPLORER_LOG_PATH` transcript JSONL files.

## v0.5.0 - 2026-05-25

### Public surface contraction to spec 011 8-tool contract (2026-05-25)

Breaking public MCP surface cleanup. The server again exposes exactly 8 tools:
`explore_repo`, six purpose wrappers (`find_relevant_code`, `trace_symbol`,
`map_change_impact`, `explain_code_path`, `collect_evidence`,
`review_change_context`), and `explore`.

- **Removed**: `map_impact` and `find_entrypoints` from the public MCP tool
  registry, tool schemas, dispatch path, integration allowlists, and current
  evaluation harnesses.
- **Changed**: README, DESIGN, and integrations now describe the fixed 8-tool
  surface. Calls to the removed names are rejected by the existing unknown-tool
  guard.
- **Migration**: Use `map_change_impact` when planning a change from a natural
  language description plus known file or symbol anchors. Use `find_relevant_code`
  or `explain_code_path` for route, CLI, job, MCP, or event entry-point discovery.

## v0.4.1 - 2026-05-24

### repo-specific ignore + find_entrypoints language expansion + classifier precision (2026-05-24)

세 가드 묶음. 모두 backwards-compatible(또는 internal 정확도 패치)이라 단일
patch bump v0.4.1로 묶어 release. 공개 도구 surface(10개)와 입출력 스키마는
변경 없음.

- **Added (spec 014)**: `.cerebras-explorer.json`의 `extraIgnorePatterns` 키
  신설. 저장소 루트 기준 path glob 배열로 추가 ignore 규칙을 지정할 수 있다.
  `extraIgnoreDirs`는 기존 동작 그대로.
- **Changed (spec 014)**: `RepoToolkit`이 traversal 도중 발견하는 nested
  `.gitignore`를 prefix-bounded matcher로 build해 해당 서브디렉토리 안에서만
  적용한다. 모노레포의 `packages/foo/.gitignore` 같은 일반 케이스에서 자연
  스럽게 동작한다. 부정 규칙(`!keep`)은 현재 매처가 line-precedence override
  의미를 모델링하지 않으므로 silently dropped — DESIGN.md에 명시.
- **Changed (spec 014)**: `shouldIgnorePath`의 평가 순서를 명시 — symlink →
  secret deny-list → ignoreDirs → DEFAULT_IGNORE_FILE_SUFFIXES → root
  `.gitignore` → nested `.gitignore` → `extraIgnorePatterns` → keep. 보안
  경계인 symlink·secret·scope는 항상 다른 ignore 정책보다 강하다.
- **Added (spec 015)**: `find_entrypoints` 정규식 패턴 묶음을 네 언어로 확장.
  Ruby(Rails/Sinatra/Thor/whenever), PHP(Laravel/Symfony Console), Java
  (Spring/picocli), Rust(actix-web/rocket/clap). 신규 `entryKind` 카테고리는
  추가하지 않고 기존 http/cli/cron 카테고리에 정규식만 합쳤다. Lambda
  handler·K8s CronJob YAML·Pub-Sub subscriber 같은 별도 의미 카테고리는 후속
  spec.
- **Changed (spec 016)**: parser-free 분류기(`classifyReference` /
  `relationForUsage`)의 세 false positive 패치.
  - 공백 멤버 호출(`obj . method ()`)이 `call`이 아니라 `member_call`로 분류.
  - 다중 패턴 라인(`[new Foo(), foo()]`)의 두 번째 심볼이 `type_reference`
    false positive 대신 `call`로 분류.
  - `.tsx`/`.jsx` 파일의 JSX 태그가 `type_reference` 또는 `reference`로
    비일관 분류되던 것을 `reference`로 통일.
- **Migration**: 별도 변경 불필요. parent agent가 `relation` 값에 의존하는
  드문 경우(분류 결과를 strict 라벨로 비교하는 코드)에는 위 세 케이스의
  라벨 변경이 영향을 줄 수 있으나, parser-free 분류기는 LSP 수준의 정확도를
  주장한 적이 없고 호출자가 라인 범위를 별도 검증하도록 README/DESIGN에
  안내되어 있다.

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
