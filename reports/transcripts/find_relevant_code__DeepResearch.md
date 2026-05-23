# Test: find_relevant_code on DeepResearch

## Request
```json
{
  "query": "find where the LangGraph orchestrator wires Anthropic and Tavily providers into the research task graph",
  "repo_root": "/home/kyubr/IdeaProjects/DeepResearch"
}
```

## Response (key fields)
```json
{
  "schemaVersion": 1,
  "directAnswer": "The LangGraph orchestrator wires providers through dependency injection: build_graph() accepts a ResearchGraphNodes dataclass (lines 23-36) where nodes like search, evidence_extractor, and synthesizer are configurable. The search node uses make_search_node(provider) (search.py:25-58) which accepts any SearchProvider protocol implementation. Tavily is wired via TavilySearchProvider (tavily.py:44-72). Anthropic is wired via AnthropicProvider.complete_with_tool() (anthropic.py:58-140) used by LLM-dependent nodes. Currently, app/workers/tasks.py:30 calls build_graph() with default nodes, leaving providers unconfigured.",
  "status": {"confidence": "high", "verification": "follow_up_needed", "complete": false, "warnings": ["Model confidence was capped from medium to high.", "Exploration stopped at the configured turn budget."]},
  "targets": [
    {"path": "app/orchestrator/graph.py", "role": "read", "reason": "Core graph wiring with ResearchGraphNodes injection point", "evidenceRefs": ["ev1", "ev2"], "startLine": 23, "endLine": 92},
    {"path": "app/orchestrator/nodes/search.py", "role": "read", "reason": "Search node factory accepting SearchProvider protocol", "evidenceRefs": ["ev3"], "startLine": 25, "endLine": 58},
    {"path": "app/providers/tavily.py", "role": "read", "reason": "Tavily provider implementing SearchProvider protocol", "evidenceRefs": ["ev4"], "startLine": 44, "endLine": 72},
    {"path": "app/providers/anthropic.py", "role": "read", "reason": "Anthropic provider with tool_call interface for LLM nodes", "evidenceRefs": ["ev5"], "startLine": 58, "endLine": 140},
    {"path": "app/workers/tasks.py", "role": "read", "reason": "Entry point calling build_graph() - shows wiring gap", "evidenceRefs": ["ev6"], "startLine": 30, "endLine": 38},
    {"path": "app/orchestrator/nodes/evidence_extractor.py", "role": "read", "reason": "Evidence extractor node factory pattern for LLM provider", "evidenceRefs": ["ev7"], "startLine": 41, "endLine": 97},
    {"path": "app/orchestrator/nodes/synthesizer.py", "role": "read", "reason": "Synthesizer node factory pattern for LLM provider", "evidenceRefs": ["ev8"], "startLine": 32, "endLine": 79}
  ],
  "evidence": [
    {"id": "ev1", "path": "app/orchestrator/graph.py", "startLine": 23, "endLine": 36, "groundingStatus": "exact", "snippet": "23: class ResearchGraphNodes:\n24:     query_understanding: ResearchNode = query_understanding_node\n25:     planner: ResearchNode = planner_node\n26:     search: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"search\"))\n... truncated"},
    {"id": "ev2", "path": "app/orchestrator/graph.py", "startLine": 39, "endLine": 92, "groundingStatus": "exact"},
    {"id": "ev3", "path": "app/orchestrator/nodes/search.py", "startLine": 25, "endLine": 58, "groundingStatus": "exact"},
    {"id": "ev4", "path": "app/providers/tavily.py", "startLine": 44, "endLine": 72, "groundingStatus": "exact"},
    {"id": "ev5", "path": "app/providers/anthropic.py", "startLine": 58, "endLine": 140, "groundingStatus": "exact"},
    {"id": "ev6", "path": "app/workers/tasks.py", "startLine": 30, "endLine": 38, "groundingStatus": "exact", "snippet": "30:     graph = build_graph(checkpointer=InMemorySaver())\n... truncated"},
    {"id": "ev7", "path": "app/orchestrator/nodes/evidence_extractor.py", "startLine": 41, "endLine": 97, "groundingStatus": "exact"},
    {"id": "ev8", "path": "app/orchestrator/nodes/synthesizer.py", "startLine": 32, "endLine": 79, "groundingStatus": "exact"}
  ],
  "uncertainties": ["Actual provider instantiation code not found - may be in unexplored test files or not yet implemented", "Evidence extractor and synthesizer node factories reference protocols but actual Anthropic wiring not located"],
  "nextAction": {"type": "ask_user", "reason": "The retained evidence is not sufficient for a complete answer."},
  "evidenceQuality": {"level": "high", "exactCount": 8, "partialCount": 0, "droppedCount": 0, "fileCount": 7, "warnings": ["Exploration stopped at the configured turn budget."], "summary": "Verified: 11 files read, 5 grep searches, 6 symbol lookups, 8/8 evidence items grounded, cross-verified across 7 files."},
  "searchCoverage": {"scopeLimited": false, "filesRead": 11, "grepCalls": 5, "stoppedByBudget": true},
  "failure": {"category": "execution", "reason": "budget_exhausted", "message": "Exploration stopped at the turn budget before all follow-up checks were exhausted.", "retry": {"tool": "explore_repo", "hints": ["Retry with a narrower scope or a more specific task."]}},
  "sessionId": "sess_8152f49e74891d8c",
  "stats": {"model": "zai-glm-4.7", "turns": 10, "toolCalls": 24, "elapsedMs": 8868, "totalTokens": 167983}
}
```

## Summary signals
- confidence=high but verification=follow_up_needed, complete=false
- budget exhausted (turn 10 limit)
- 8 exact evidence items across 7 files
- uncertainty: actual provider instantiation NOT found (acknowledged)
- failure object present with retry guidance
