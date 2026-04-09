---
name: cerebras-explore
description: Delegate broad read-only repository exploration to the external Cerebras explorer before spending many native read/grep steps. Use when Codex needs architecture lookup, symbol tracing, dependency or route/middleware tracing, config origin lookup, unfamiliar subsystem discovery, impact mapping before edits, repeated-pattern search, or git-guided change summaries in a repo that has the `cerebras-explorer` MCP server installed.
---

Use this skill to offload the wide search/read loop, not the final engineering judgment.

If the `cerebras_explorer` role is installed, use it for read-only discovery.
If the role is not installed, call the `cerebras-explorer` MCP tools directly.

Prefer the narrowest explorer entry point that matches the request:
- `explain_symbol` for definition, purpose, and callsite questions about a known symbol
- `trace_dependency` for upstream/downstream import tracing from a known file
- `summarize_changes` for "what changed and why" across a branch, commit, or time range
- `find_similar_code` for duplication, convention hunting, or "where else do we do this?"
- `explore_repo` for structured JSON output you want to inspect, chain into follow-up calls, or use before editing
- `explore` for a human-readable Markdown report with inline citations when you want an architecture overview, narrative explanation, or user-facing summary

Shape the delegation before calling:
- Keep the task close to the user's wording.
- Add `scope` only when the subsystem or directory is already obvious.
- Use `explore_repo` when you need explicit budget control.
- For `explore_repo`, use `budget: deep` for the first broad pass across an unfamiliar area.
- For `explore_repo`, use `budget: normal` for follow-up exploration once the subsystem or range is already narrowed.
- For `explore_repo`, use `budget: quick` for file-level or otherwise narrow fact lookup.
- For `explore`, use `prompt` instead of `task`, and `thoroughness` instead of `budget`.
- For `explore`, use `thoroughness: deep` for the first broad overview, `normal` for scoped follow-up reporting, and `quick` for a short cited explanation of a narrow area.
- Remember that the specialized tools do not expose `budget`; they currently route through an internal `normal` pass. If budget choice matters, prefer `explore_repo`.
- Add `hints.symbols`, `hints.files`, or `hints.regex` only when already known.
- Reuse `stats.sessionId` as `session` when continuing the same investigation.

Do not delegate by default when one or two direct native reads are cheaper, when the task is primarily to edit code, or when the user explicitly wants raw local verification first.

For `explore_repo`, treat the returned evidence array as the working map.
For `explore`, treat the cited paths and narrative structure as the orientation map.
Read only the cited files or line ranges needed to verify, resolve ambiguity, or prepare edits.
Escalate to native wide search only when the explorer result is thin, conflicting, or insufficient.

Example calls:
- `trace_dependency({ entryPoint: "src/index.mjs", direction: "downstream", maxDepth: 3 })`
- `explore_repo({ task: "Trace how auth middleware is applied to API routes", scope: ["src/**"], budget: "normal", hints: { symbols: ["requireAuth"], strategy: "reference-chase" } })`
- `explore({ prompt: "Give me a concise architecture overview of the auth subsystem with inline file:line citations", scope: ["src/auth/**", "src/routes/**"], thoroughness: "deep" })`
