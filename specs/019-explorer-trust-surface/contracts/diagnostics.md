# Contract: Local Diagnostics

Diagnostics are for local operator debugging. They must be useful without expanding the default Codex-facing answer surface.

## Transcript Tool Records

Tool records may include:

- `turn`
- `tool`
- `args`
- `result`
- `error`
- `resultChars`

`args`, `result`, and `error` must be compact and redacted by default.

## Markdown `explore` MCP Structured Content

Default structured content should contain answer-oriented fields:

- `report`
- `citations`
- `targets`
- `searchCoverage`
- `critic`
- `failure`

Operational fields such as stats, transcript path, and tool trace should be omitted from default structured content or placed under MCP `_meta.ops` where supported.

## Stderr Ops Summary

The ops summary may mention that a transcript log exists, but it should avoid printing a full local path by default. A basename or home-relative path is sufficient for normal operation.

## Provider Attribution

When failover succeeds on a fallback provider, local stats/transcript diagnostics must identify the provider/model that actually produced the completion. This metadata is diagnostic and should not be documented as a stable user-facing provider override contract.
