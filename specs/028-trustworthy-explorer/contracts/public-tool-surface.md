# Contract: Six Public Explorer Tools

## Registry

The public MCP surface is exactly:

1. `find_relevant_code`
2. `trace_symbol`
3. `map_change_impact`
4. `explain_code_path`
5. `collect_evidence`
6. `explore_repo`

Order is stable and recorded by provenance tests. No environment variable changes the registry.

## Dispatch rule for parents

- Need locations → `find_relevant_code`
- Know the symbol → `trace_symbol`
- Plan a change → `map_change_impact`
- Need an execution/data path → `explain_code_path`
- Need to verify one claim → `collect_evidence`
- Anything else → `explore_repo`

The initialization instructions contain this short rule once. Individual tool descriptions contain only that tool's positive trigger and one boundary, not the six-way list or repeated sibling comparisons.

## Distinctness contract

| Tool | Positive trigger | Distinct internal proof policy | Boundary |
|---|---|---|---|
| `find_relevant_code` | Locate unknown implementation/config/test/route positions. | Prove why each bounded implementation target is relevant and include a companion verification target only for a change-oriented request with a directly observed connection; not repository completeness. | Do not use when the exact location is already known. |
| `trace_symbol` | Explain a known function/class/type/variable and its usages. | Definition/meaning plus independent usage cross-check within the effective boundary. | Unknown symbol discovery belongs to locate/fallback. |
| `map_change_impact` | Identify blast radius before a planned change. | Cover actionable edit/read targets and requested dependency/test/config/docs categories; missing categories are gaps. | Not for a one-line known-file edit. |
| `explain_code_path` | Trace a request/event/job/CLI/data flow. | Ordered entry, every handoff, and terminal effect; a missing transition blocks completion. | Static single-symbol usage belongs to symbol trace. |
| `collect_evidence` | Support or refute an existing claim/hypothesis. | Semantic entailment/refutation and relevant counterevidence/absence policy. | Broad discovery without a claim belongs to fallback. |
| `explore_repo` | Any repository investigation not clearly covered above. | Planner-derived required sub-goals and matching proof policies. | General fallback, not a place for public strategy/budget knobs. |

Each retained tool must have at least one live/mock acceptance case that proves this policy differs from general evidence-count completion.

## Removed tools

### `review_change_context`

Removed because it currently adds `since`/`until`/`path` convenience and forces `git-guided` prompting, but has no distinct sufficiency branch. Change-review tasks use `explore_repo` with the time/path intent in natural language and `scope` when needed. Git intent classification and read-only git tools remain internal capabilities.

Migration example:

```json
{
  "tool": "explore_repo",
  "arguments": {
    "task": "Review changes since 2 weeks ago under src/auth/**. Explain what changed, current-source impact, and review risks.",
    "scope": ["src/auth/**", "tests/**"]
  }
}
```

After the wrapper is removed, delete its now-orphaned internal `change_review` taskMode. Internal text classification must continue to recognize review intent and auto-select git-guided exploration without exposing a mode or alias.

### `explore`

Removed because Markdown presentation is not a distinct repository proof policy. The parent receives structured verified claims and decides how much prose the user needs. Remove the public handler and report-only backend code after reference analysis; do not keep a hidden compatibility alias or enable flag.

The same removal applies to the direct-runtime report APIs: `freeExploreRepository` and `ExplorerRuntime.freeExplore` have no compatibility aliases. Direct callers migrate to `exploreRepository` and `ExplorerRuntime.explore`, respectively; both return the structured exploration result used to build the v3 parent handoff.

Migration example:

```json
{
  "tool": "explore_repo",
  "arguments": {
    "task": "Explain this repository architecture with the main components, execution flow, and cited source evidence."
  }
}
```

The parent may render the returned v3 evidence into Markdown if the user asked for a report.

## No public effort controls

None of the six tools accepts:

- budget or thoroughness;
- search strategy;
- turn/tool-call limits;
- depth or reasoning effort;
- sub-goal or repair configuration.

`explore_repo.hints.strategy` is removed from the public schema. Known anchors and hard `scope` remain useful task facts, not effort controls. Wrappers may still pass trusted internal task intents to the runtime; those values never become parent choices.

The old internal single-`deep` budget abstraction and report effort envvars are removed as well. Fixed provider/context/process safety limits remain implementation constants, are named for the exact constraint they protect, and cannot be selected or multiplied by the parent or operator. Reaching one affects only the proof state of goals it actually interrupted.

The fixed runtime configuration is exactly:

| Runtime key | Value | Limit observation when it interrupts proof |
|---|---:|---|
| `maxTurns` | 30 | `turn_limit` |
| `maxSearchResults` | 80 | `tool_result_limit` when the result is actually truncated |
| `maxReadLines` | 320 | `tool_result_limit` when a requested existing range is actually truncated |
| `maxDirectoryEntries` | 300 | `tool_result_limit` when the result is actually truncated |
| `maxWalkFiles` | 6000 | `walk_limit` |
| `maxCompletionTokens` | 16384 | `generation_output_limit` |
| `finalizeMaxCompletionTokens` | 16384 | `generation_output_limit` |
| `maxContextTokens` | 110000 | `context_limit` |

The internal safety-limit vocabulary is exactly `turn_limit`, `context_limit`, `generation_output_limit`, `walk_limit`, and `tool_result_limit`. These observations belong to the direct-runtime/transcript diagnostics; normal v3 output exposes only the affected requested gap, not configuration or usage telemetry.

## Addition/removal gate

A proposed public tool is rejected unless all are present:

1. observed parent usage or a measured workflow gap;
2. an independently testable parent scenario;
3. a proof/completion policy materially different from the six existing tools;
4. evidence that the benefit exceeds selection/documentation/maintenance cost.

An input convenience or output format alone is not sufficient. If a tool no longer passes the gate, remove it cleanly in a breaking pre-1.0 release rather than preserving an indefinite alias.

## Synchronization requirements

Changing this registry requires one change set covering:

- `src/mcp/server.mjs` registry, dispatch, instructions, provenance;
- retry vocabularies in runtime/schemas;
- active budget/config/stats/prompt terminology and operator effort envvars;
- README, DESIGN, AGENTS, TESTING, CHANGELOG;
- `examples/expected-response.json` when public schema changes concurrently;
- all integration allowlists/readmes/examples;
- adoption/trust benchmark manifests;
- MCP/schema/integration/redaction/cancellation tests;
- negative stale-name guards.
