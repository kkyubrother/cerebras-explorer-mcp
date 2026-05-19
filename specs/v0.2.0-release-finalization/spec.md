# v0.2.0 Release Finalization Spec

Created: 2026-05-19 KST

## Goal

Finalize the already implemented v0.2.0 release gate so the package metadata, MCP server metadata, changelog, install snippets, and tests all describe the same releasable version.

## Requirements

- The npm package version must be `0.2.0`.
- The MCP `initialize` server info must report `0.2.0`.
- User-facing install snippets must point at `github:kkyubrother/cerebras-explorer-mcp#v0.2.0`.
- The changelog must have a dated v0.2.0 entry instead of `Unreleased`.
- Existing integration tests must assert the final v0.2.0 install ref.
- No new runtime dependency may be added.

## Acceptance Criteria

- `npm test` passes.
- `npm ls --depth=0 --json` shows no runtime dependency tree entries.
- `rg 'cerebras-explorer-mcp#v0.1.0' README.md integrations tests plan` returns no active install snippet references.
- `rg 'Unreleased|version: .0.1.0.|"version": "0.1.0"' CHANGELOG.md package.json src tests` returns no v0.2.0 release metadata leftovers.
- `git status --short` shows only intentional release finalization changes.
