# Test: find_entrypoints on cerebras-explorer-mcp (via direct invocation; with strategy:'auto' bug worked around)

## Request
```json
{"entryKind": "mcp", "repo_root": "/home/kyubr/IdeaProjects/cerebras-explorer-mcp"}
```

> ⚠️ **Implementation bug noted**: The wrapper's `buildFindEntrypointsArgs` in `src/mcp/server.mjs:573` sets `hints.strategy = 'auto'`, but the schema validator at `schemas.mjs:391-394` only accepts `symbol-first|reference-chase|git-guided|breadth-first|blame-guided|pattern-scan`. **If this wrapper were exposed via MCP, every call would fail with "hints.strategy must be one of..."**. The direct-invocation harness used here removes the strategy field to work around this.

## Response (with strategy bug worked around)
- **directAnswer**: Identifies 10 MCP tool definitions with file:line citations (L33-L290), tool registry, and JSON-RPC handlers
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=1
- **8 evidence items, all exact** for L33-L290 tool definitions, buildToolList, tools/list handler, tools/call dispatcher, arg builders
- **searchCoverage**: filesRead=6, grepCalls=7
- **Cost**: turns=7, toolCalls=13, elapsedMs=11208, totalTokens=141635

## Notable
- Correctly cites the "Caveat: Regex-based detection — verify before acting" disclaimer in the directAnswer
- Enumerates all 10 tools with their tool names and line ranges precisely
- 1 fileCount because all citations are in server.mjs
