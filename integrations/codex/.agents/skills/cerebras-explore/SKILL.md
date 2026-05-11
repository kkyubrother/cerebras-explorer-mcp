---
name: cerebras-explore
description: Use first for broad read-only code discovery when exact files are unknown, 3+ files may be needed, or cross-file symbol/path/impact evidence is required. Call with query and known anchors only; do not choose budget.
---

Use this skill to offload the wide search/read loop, not the final engineering judgment.

If the `cerebras_explorer` role is installed, use it for read-only discovery.
If the role is not installed, call the `cerebras-explorer` MCP tools directly.

Prefer the narrowest explorer entry point that matches the request:
- `find_relevant_code` for locating relevant files and line targets before deciding what to read or edit
- `trace_symbol` for definition, purpose, and callsite questions about a known symbol
- `map_change_impact` before edits when blast radius, likely edit files, callers, tests, or config are unknown
- `explain_code_path` for route, middleware, request, event, job, or CLI flow tracing
- `collect_evidence` for verifying a claim or review point with grounded snippets
- `review_change_context` for PR/recent-change review context
- `explore_repo` for structured JSON output you want to inspect, chain into follow-up calls, or use before editing
- `explore` for a human-readable Markdown report with inline citations when you want an architecture overview, narrative explanation, or user-facing summary

Default call shape:
- Keep the query or task close to the user's wording.
- Add known files, symbols, or literal text anchors only when already known.
- Use regex only in advanced `explore_repo.hints.regex` workflows.
- Add `scope` only when the subsystem or directory is already obvious.
- Do not set `budget`, `thoroughness`, `hints.strategy`, or `language` unless an advanced workflow explicitly requires it.
- For `explore`, use `prompt` instead of `task`.
- Reuse `sessionId` as `session` when continuing the same investigation.

Do not delegate by default when one or two direct native reads are cheaper, when the task is primarily to edit code, or when the user explicitly wants raw local verification first.

For `explore_repo` and wrapper tools, treat returned `targets` as the working map.
For `explore`, treat the cited paths and narrative structure as the orientation map.
Read only `targets` with role `read` or `edit` to verify, resolve ambiguity, or prepare edits.
Escalate to native wide search only when the explorer result is thin, conflicting, or insufficient.

Example calls:
- `find_relevant_code({ query: "Where is auth middleware applied to API routes?", knownSymbols: ["requireAuth"] })`
- `map_change_impact({ change: "Change auth middleware behavior for API routes", knownSymbols: ["requireAuth"] })`
- `explore_repo({ task: "Trace how auth middleware is applied to API routes", scope: ["src/**"], hints: { symbols: ["requireAuth"] } })`
- `explore({ prompt: "Give me a concise architecture overview of the auth subsystem with inline file:line citations", scope: ["src/auth/**", "src/routes/**"] })`
