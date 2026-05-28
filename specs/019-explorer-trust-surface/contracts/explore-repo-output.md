# Contract: `explore_repo` Compact Output

The structured MCP result for `explore_repo` and its wrapper tools keeps the compact answer contract:

- `schemaVersion`
- `directAnswer`
- `status`
- `targets`
- `discoveredPaths`
- `evidence`
- `evidenceQuality`
- `searchCoverage`
- `critic`
- `failure`

## Required Control-Plane Fields

- `status.verification`
- `status.complete`
- `evidenceQuality`
- `searchCoverage`
- `failure`
- `critic.warnings`

These fields must be preserved when summarizing or handing off a result.

## Surface Rules

- `evidence[].snippet` may appear in structured content but default display text must not repeat every snippet in full.
- `discoveredPaths` is bounded to a compact list.
- `searchCoverage.omittedDiscoveredPaths` reports omitted discovered path candidates.
- `searchCoverage.warnings` reports truncation, budget, scope, and discovery omission caveats.
- `critic.warnings` is the canonical deterministic warning list; compatibility copies may remain in `status.warnings` and `evidenceQuality.warnings`.

## Non-Goals

- Do not add `budget` to the `explore_repo` input.
- Do not add public write/delete repository tools.
- Do not expose raw transcript logs, full provider internals, or debug traces as default answer fields.
