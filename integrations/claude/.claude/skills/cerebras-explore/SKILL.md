---
name: cerebras-explore
description: Delegate broad read-only repository exploration to the external Cerebras explorer agent before spending many native read/grep/glob turns. Use for architecture lookup, symbol tracing, route or middleware tracing, config origin lookup, unfamiliar subsystem discovery, impact mapping before edits, repeated-pattern search, or git-guided change summaries.
context: fork
agent: cerebras-explorer
---

Delegate broad discovery to the `cerebras-explorer` agent.
Keep the parent agent focused on verification, synthesis, and any later edits.

Choose between the two open-ended entry points deliberately:
- Use `explore_repo` when the parent will inspect structured JSON fields such as `evidence`, `candidatePaths`, `followups`, or session-linked results before editing.
- Use `explore` when the parent mainly wants a cited Markdown report, architecture walkthrough, or user-facing explanation.

Send one well-shaped exploration request instead of a stream of micro-prompts.
- Keep the main question close to the user's wording.
- Mention the subsystem or directory when the scope is obvious.
- Mention any known anchor symbol, file path, or regex.
- For `explore_repo`, use `deep` for the first broad pass across an unfamiliar area.
- For `explore_repo`, use `normal` for follow-up exploration after the search space is narrowed.
- For `explore_repo`, use `quick` for file-level or otherwise narrow fact lookup.
- For `explore`, use `prompt` plus `thoroughness`, not `task` plus `budget`.
- For `explore`, use `deep` for a first broad overview, `normal` for scoped follow-up reporting, and `quick` for a short cited explanation of a narrow area.
- Remember that specialized tools currently behave like an internal `normal` pass.

Prefer delegation for:
- architecture and ownership questions
- "where is this defined / used?" investigations
- import or routing chain tracing
- config origin lookup
- impact mapping before edits
- similar-pattern or git-history exploration

Do not delegate by default when the relevant file is already known and one or two direct reads are cheaper, or when the task is mainly to modify code rather than discover it.

Use `explore_repo` evidence or `explore` citations to choose what the parent agent should inspect next.
Prefer targeted verification of cited paths or line ranges over fresh wide search.
Fall back to native wide search only if the delegated report is thin, contradictory, or clearly insufficient.
