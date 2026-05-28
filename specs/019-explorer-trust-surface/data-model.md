# Data Model: Explorer Trust and Surface Hygiene

## Evidence Item

- `path`: Repository-relative file path.
- `startLine`: Positive integer start line. Invalid, missing, or inverted ranges are malformed and must be dropped by deterministic criticism.
- `endLine`: Positive integer end line greater than or equal to `startLine`.
- `why`: Short reason the cited range supports the answer.
- `evidenceType`: `file_range`, `git_commit`, `git_diff`, or `git_blame`.
- `groundingStatus`: `exact`, `partial`, or `unverified` after deterministic criticism.
- `snippet`: Optional redacted excerpt retained in structured content, not duplicated in full display text.

## Critic Summary

- `warnings`: Canonical deterministic warning list for handoff preservation.
- `droppedEvidence`: Count of malformed or ungrounded evidence removed from the final compact result.
- `partialEvidence`: Count of retained evidence downgraded to partial grounding.

The public structured result exposes only the compact fields needed by parent agents; internal scoring factors remain implementation details.

## Evidence Quality

- `level`: `high`, `medium`, `low`, or `unknown`.
- `exactCount`: Retained exact evidence count.
- `partialCount`: Retained partial evidence count.
- `droppedCount`: Dropped model-proposed evidence count.
- `fileCount`: Distinct retained file count.
- `warnings`: Compatibility warning list mirroring deterministic caution signals.
- `summary`: Human-readable trust summary with caveats for dropped evidence, truncation, or stopped budget.

## Search Coverage

- `scope`: Scope filters used for the exploration.
- `scopeLimited`: Whether scope filters were active.
- `filesRead`, `grepCalls`, `listDirCalls`, `symbolCalls`: Tool breadth counters.
- `toolResultsTruncated`: Number of tool results truncated by the runtime.
- `stoppedByBudget`: Whether the runtime stopped because the configured execution budget was exhausted.
- `omittedDiscoveredPaths`: Number of discovered path candidates omitted from the surfaced bounded list.
- `warnings`: Coverage and truncation warnings.
- `summary`: Compact human-readable coverage statement.

## Discovered Path

- `path`: Repository-relative candidate path.
- `kind`: `file`, `dir`, or `unknown`.
- `sourceTool`: Tool that discovered the path.
- `reason`: Short discovery reason.

The surfaced list is bounded; omissions are represented in `searchCoverage.omittedDiscoveredPaths` rather than extra sentinel path rows.

## Operational Diagnostic

- `tool`: Tool name.
- `turn`: Runtime turn number.
- `args`: Compact redacted argument summary.
- `result`: Compact redacted result summary.
- `error`: Optional redacted error message.
- `resultChars`: Approximate serialized result size.

Diagnostics are local/transcript-oriented and are not part of default answer structured content.

## Provider Attempt

- `providerIndex`: Zero-based failover provider index.
- `model`: Model name reported by the successful provider.
- `success`: Whether the provider produced the completion.
- `error`: Redacted failure message for failed attempts where recorded.

Provider attempt data is diagnostic metadata, not a public answer contract.
