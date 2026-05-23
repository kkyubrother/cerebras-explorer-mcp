# Test: trace_symbol on cerebras-explorer-mcp

## Request
```json
{"symbol": "exploreRepository", "repo_root": "/home/kyubr/IdeaProjects/cerebras-explorer-mcp"}
```

## Response
- **directAnswer**: "exploreRepository is an exported async function in src/explorer/runtime.mjs (line 2395) that orchestrates repository exploration. It accepts args (task, repo_root, scope, hints, etc.) and options (onProgress, sessionStore, abortSignal, logger, chatClient). It creates an ExplorerRuntime instance and delegates to runtime.explore(). Called by MCP server (src/mcp/server.mjs:796), tests (tests/security/secret-deny-list.test.mjs:166), and examples (examples/direct-runtime.mjs:5)."
- **status**: confidence=high, verification=follow_up_needed, complete=false (budget exhausted)
- **evidenceQuality**: level=high, exactCount=6, partialCount=0, fileCount=4
- **failure**: budget_exhausted (retry hints provided)
- **6 evidence items, all exact grounding**:
  - E1: runtime.mjs:2395-2399 — `export async function exploreRepository(args, options = {}) { ... new ExplorerRuntime(...).explore(args, ...) }`
  - E2: runtime.mjs:1351-1365 — `async explore(args, ...) { validateExploreRepoArgs(...) ... }`
  - E3: server.mjs:796-802 — caller in MCP handler
  - E4: examples/direct-runtime.mjs:5-12 — usage example
  - E5: tests/security/secret-deny-list.test.mjs:166-169 — test caller
  - E6: runtime.mjs:1278-1287 — ExplorerRuntime class constructor
- **searchCoverage**: filesRead=8, grepCalls=2, symbolCalls=2, stoppedByBudget=true
- 12 discoveredPaths returned as `reference` role (not actionable)

## Cost
- turns=10, toolCalls=12, elapsedMs=5580, totalTokens=70817, model=zai-glm-4.7
