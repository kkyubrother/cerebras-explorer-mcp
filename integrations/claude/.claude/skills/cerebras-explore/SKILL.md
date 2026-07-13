---
name: cerebras-explore
description: Delegate broad read-only repository exploration to the external Cerebras explorer agent before spending many native read/grep/glob turns. Use for architecture lookup, symbol tracing, route or middleware tracing, config origin lookup, unfamiliar subsystem discovery, impact mapping before edits, repeated-pattern search, or git-guided change summaries.
context: fork
agent: cerebras-explorer
---

Delegate broad discovery to the `cerebras-explorer` agent.
Keep the parent agent focused on verification, synthesis, and any later edits.

Prefer the narrowest public entry point in this stable order:
- `find_relevant_code` for unknown implementation, configuration, test, or route locations
- `trace_symbol` for a known symbol's definition and usages
- `map_change_impact` for the blast radius of a planned change
- `explain_code_path` for an ordered request, event, job, CLI, or data flow
- `collect_evidence` for supporting or refuting an existing claim
- `explore_repo` for open-ended, architecture, or git-history questions not covered above

Send one well-shaped exploration request instead of a stream of micro-prompts.
- Keep the main question close to the user's wording.
- Mention the subsystem or directory when the scope is obvious.
- Mention any known anchor symbol, file path, or literal text.

Prefer delegation for:
- architecture and ownership questions
- "where is this defined / used?" investigations
- import or routing chain tracing
- config origin lookup
- impact mapping before edits
- similar-pattern or git-history exploration

Do not delegate by default when the relevant file is already known and one or two direct reads are cheaper, or when the task is mainly to modify code rather than discover it.

Use the returned evidence to choose what the parent agent should inspect next.
Prefer targeted verification of cited paths or line ranges over fresh wide search.
Fall back to native wide search only if the delegated result is thin, contradictory, or clearly insufficient.

Read the schema-v3 parent handoff through its `state`:
- `complete`: use the supported `directAnswer` and `evidence`.
- `verify_targets`: read only the returned `targets`, then continue the requested work.
- `incomplete`: use only supported partial facts, inspect `gaps`, and run `followUp` only when useful.
- `failed`: retry only when `failure.retry` is present; otherwise stop.
