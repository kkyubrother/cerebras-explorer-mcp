# Test: trace_symbol on studious-memory

## Request
```json
{"symbol": "scoped_tool", "repo_root": "/home/kyubr/IdeaProjects/studious-memory"}
```

## Response
- **directAnswer**: "scoped_tool is a decorator defined in backend/app/mcp/server.py (lines 79-89) that enforces scope-based authorization for MCP tools. It accepts variable scope strings (e.g., MCP_SCOPE_MEMORY_WRITE), wraps the function with @mcp.tool registration, and calls require_mcp_scopes() at runtime to verify permissions before execution. It returns the wrapped async function. Used extensively (39+ callers) to protect tools like process_input and search."
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=4, partialCount=0, fileCount=1 (cross-verified=false)
- **4 evidence items**:
  - E1: server.py:79-89 — full decorator definition
  - E2: server.py:1-19 — imports (Callable, wraps, MCP scope constants)
  - E3: server.py:123-124 — `@scoped_tool(MCP_SCOPE_MEMORY_WRITE)` + `async def process_input(`
  - E4: server.py:177-178 — `@scoped_tool(MCP_SCOPE_MEMORY_READ)` + `async def search(`
- **searchCoverage**: filesRead=4, grepCalls=0, symbolCalls=1

## Notable
- "39+ callers" claim from symbol_context (callers=39, observedRanges=21) - only 2 callers actually shown in evidence
- fileCount=1 but symbol_context reported 21 distinct ranges
- All evidence is within one file (the definition file)

## Cost
- turns=4, toolCalls=5, elapsedMs=3315, totalTokens=26146
