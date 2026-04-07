---
name: cerebras-explore
description: Delegate broad repository exploration to the external Cerebras explorer before spending many native read/grep/glob turns.
context: fork
agent: cerebras-explorer
---

When the task is primarily exploration:
- architecture lookup
- symbol tracing
- route / middleware tracing
- config origin lookup
- unfamiliar subsystem discovery
- impact mapping before edits

Delegate to the `cerebras-explorer` agent first.
Use the returned evidence to decide what the parent agent should inspect next.
