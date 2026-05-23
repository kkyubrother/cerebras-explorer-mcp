# Test: trace_symbol on DeepResearch

## Request
```json
{"symbol": "build_graph", "repo_root": "/home/kyubr/IdeaProjects/DeepResearch"}
```

## Response
- **directAnswer**: "build_graph is defined in app/orchestrator/graph.py:39. It constructs a LangGraph StateGraph for a research workflow with 18 nodes (query_understanding, planner, search, fetcher, parser, evidence_extractor, synthesizer, citation_validator, finalize, failure, and budget gates). Parameters: nodes (ResearchGraphNodes|None), checkpointer (Any|None), debug (bool). Returns a compiled graph. Called in app/workers/tasks.py:30 and tests (test_orchestrator_graph.py:29,81; test_budget_exceeded.py:42)."
- **status**: confidence=medium (capped from high), verification=follow_up_needed, complete=false
- **status.warnings**: ["Model confidence was capped from high to medium.", "5 evidence item(s) are grounded only by grep, blame, or nearby line observations."]
- **evidenceQuality**: level=medium, exactCount=0, **partialCount=5**, droppedCount=0, fileCount=4
- **5 evidence items, ALL partial grounding**:
  - E1 (partial): graph.py:39-92 — `def build_graph(nodes: ResearchGraphNodes | None = None, checkpointer: Any | None = None, debug: bool = False): ... graph.add_node("query_understanding", ...)`
  - E2 (partial): app/workers/tasks.py:30 — `graph = build_graph(checkpointer=InMemorySaver())`
  - E3 (partial): test_orchestrator_graph.py:29 — `graph = build_graph(`
  - E4 (partial): test_orchestrator_graph.py:81 — `graph = build_graph(`
  - E5 (partial): test_budget_exceeded.py:42 — `graph = build_graph(`
- **searchCoverage**: filesRead=2, grepCalls=0, symbolCalls=1, stoppedByBudget=false
- **failure**: null

## Concerns
- DirectAnswer claims "18 nodes" but evidence snippet (partial) shows only the first ~10 add_node calls; that count may be exact or overcounted
- All evidence is partial grounding — symbol-found-by-grep-only, not exact-read confirmation of the call sites
- 5 callers' line snippets are all 1-line excerpts (`graph = build_graph(`) - no surrounding context confirms parameter passing

## Cost
- turns=4, toolCalls=3, elapsedMs=3329, totalTokens=22715, model=zai-glm-4.7
