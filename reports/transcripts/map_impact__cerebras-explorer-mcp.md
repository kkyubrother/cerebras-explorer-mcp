# Test: map_impact on cerebras-explorer-mcp (via direct invocation; MCP server registration has 8/10 tools)

## Request
```json
{"anchor": "src/explorer/runtime.mjs", "changeType": "refactor", "repo_root": "/home/kyubr/IdeaProjects/cerebras-explorer-mcp"}
```

## Response
- **directAnswer**: "src/explorer/runtime.mjs exports ExplorerRuntime class (line 1278) and three functions: exploreRepository, freeExploreRepository, freeExploreRepositoryV2 (lines 2395-2411). Called by src/mcp/server.mjs (production), examples/direct-runtime.mjs, scripts/integration-test.mjs, and 4 test files. No config files directly reference it; configuration flows through internal config.mjs imports."
- **status**: confidence=high, verification=targeted_read_needed, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=7
- **8 evidence items, all exact** spanning runtime.mjs definitions + 7 callers (mcp/server.mjs, direct-runtime example, integration-test, 4 test files)
- **searchCoverage**: filesRead=8, grepCalls=8, symbolCalls=1
- **Cost**: turns=7, toolCalls=20, elapsedMs=13664, totalTokens=487993

## Notable
- Correctly identifies 3 exported functions (exploreRepository, freeExploreRepository, freeExploreRepositoryV2) and 1 class
- Identifies that "configuration flows through internal config.mjs imports" rather than via direct config references — non-obvious detail
