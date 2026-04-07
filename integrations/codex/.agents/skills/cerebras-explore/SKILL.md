---
name: cerebras-explore
description: Use the external Cerebras explorer for broad repository discovery before spending many native search/read turns.
---

When a task is mostly exploration, first spawn or use the `cerebras_explorer` agent.
Delegate the question with a single `explore_repo` call.
Only fall back to native repository search if the returned evidence is insufficient.
