---
name: cerebras-explore
description: Delegate broad read-only repository exploration to the external Cerebras explorer agent before spending many native read/grep/glob turns. Use for architecture lookup, symbol tracing, route or middleware tracing, config origin lookup, unfamiliar subsystem discovery, impact mapping before edits, repeated-pattern search, or git-guided change summaries.
context: fork
agent: cerebras-explorer
---

Delegate broad discovery to the `cerebras-explorer` agent.
Keep the parent agent focused on verification, synthesis, and any later edits.

Choose between the two open-ended entry points deliberately:
- Use `explore_repo` when the parent will inspect compact structured JSON fields such as `directAnswer`, `status`, `targets`, `discoveredPaths`, `evidence`, `evidenceQuality`, `searchCoverage`, `critic.warnings`, `failure`, or `nextAction` before editing.
- Use `explore` when the parent mainly wants a cited Markdown report, architecture walkthrough, or user-facing explanation.

Send one well-shaped exploration request instead of a stream of micro-prompts.
- Keep the main question close to the user's wording.
- Mention the subsystem or directory when the scope is obvious.
- Mention any known anchor symbol, file path, or literal text.
- Exploration depth is fixed server-side; the removed `budget` (spec 011) and `explore.thoroughness` (spec 023) inputs are rejected if sent.
- Start each call from the current prompt context; `session`/`sessionId` were removed in spec 017.

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

Compact contract signals:
- `evidenceQuality.level` indicates how grounded the result is.
- `failure` is non-null when the explorer could not answer; use `failure.retry.tool`/`failure.retry.args` for the guided retry.
- `searchCoverage` shows whether scope or budget limits were hit.
- `critic.warnings` is the canonical deterministic warning list to preserve during handoff.
