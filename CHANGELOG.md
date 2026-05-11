# Changelog

## v0.2.0 - Unreleased

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
