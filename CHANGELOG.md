# Changelog

## v0.2.0 - 2026-05-19

### Tool Quality Follow-up (2026-05-21)

Docs-only bundle for `docs/superpowers/plans/2026-05-19-tool-quality-improvements.md`.

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
