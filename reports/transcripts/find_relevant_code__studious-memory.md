# Test: find_relevant_code on studious-memory

## Request
```json
{
  "query": "find how the MCP server in backend/mcp_server.py registers tools and connects to the FastAPI app",
  "repo_root": "/home/kyubr/IdeaProjects/studious-memory"
}
```

## Response (key fields)
```json
{
  "schemaVersion": 1,
  "directAnswer": "The MCP server registers tools using FastMCP's decorator pattern and connects to FastAPI via app.mount(). Tools are registered with @scoped_tool() decorator (which wraps @mcp.tool()) in backend/app/mcp/server.py, and the MCP HTTP sub-app is mounted at root '/' in backend/main.py (lines 763-773).",
  "status": {"confidence": "high", "verification": "verified", "complete": true, "warnings": []},
  "targets": [
    {"path": "backend/app/mcp/server.py", "role": "read", "reason": "FastMCP instance, scoped_tool decorator wrapping @mcp.tool", "startLine": 76, "endLine": 107},
    {"path": "backend/app/mcp/server.py", "role": "read", "reason": "Example tool registrations using @scoped_tool decorator pattern", "startLine": 123, "endLine": 186},
    {"path": "backend/main.py", "role": "read", "reason": "Creates MCP HTTP sub-app using mcp.streamable_http_app()", "evidenceRefs": ["E4"], "startLine": 73, "endLine": 74},
    {"path": "backend/main.py", "role": "read", "reason": "Mounts MCP sub-app at root '/' with middleware wrappers", "startLine": 757, "endLine": 773},
    {"path": "backend/app/mcp/server.py", "startLine": 76, "endLine": 87, "role": "read", "reason": "FastMCP instance creation and scoped_tool decorator", "evidenceRefs": ["E1"]},
    {"path": "backend/app/mcp/server.py", "startLine": 92, "endLine": 107, "role": "read", "reason": "Scope-based tool filtering via list_tools override", "evidenceRefs": ["E2"]},
    {"path": "backend/app/mcp/server.py", "startLine": 123, "endLine": 143, "role": "read", "reason": "Example tool registration with MEMORY_WRITE scope", "evidenceRefs": ["E3"]},
    {"path": "backend/main.py", "startLine": 763, "endLine": 773, "role": "read", "reason": "Mounts MCP sub-app with middleware", "evidenceRefs": ["E5"]}
  ],
  "evidence": [
    {"id": "E1", "path": "backend/app/mcp/server.py", "startLine": 76, "endLine": 87, "groundingStatus": "exact", "snippet": "76: mcp = FastMCP(\"MaidBot\")\n77: \n78: \n79: def scoped_tool(*required_scopes: str):\n80:     def _decorator(func: Callable[..., Any]):\n81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})\n82:         @wraps(func)\n... truncated"},
    {"id": "E2", "path": "backend/app/mcp/server.py", "startLine": 92, "endLine": 107, "groundingStatus": "exact"},
    {"id": "E3", "path": "backend/app/mcp/server.py", "startLine": 123, "endLine": 143, "groundingStatus": "exact", "snippet": "123: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)\n124: async def process_input(\n... truncated"},
    {"id": "E4", "path": "backend/main.py", "startLine": 73, "endLine": 74, "groundingStatus": "exact", "snippet": "73: # Build the MCP ASGI sub-app once at module level\n74: _mcp_http_app = mcp.streamable_http_app()"},
    {"id": "E5", "path": "backend/main.py", "startLine": 763, "endLine": 773, "groundingStatus": "exact", "snippet": "763: app.mount(\n764:     \"/\",\n765:     McpRequestLogger(\n766:         McpConcurrencyLimiter(\n767:             _mcp_http_app,\n... truncated"}
  ],
  "uncertainties": [],
  "nextAction": {"type": "stop", "reason": "Explorer result is complete."},
  "evidenceQuality": {"level": "high", "exactCount": 5, "partialCount": 0, "droppedCount": 0, "fileCount": 2, "warnings": [], "summary": "Verified: 8 files read, 4 grep searches, 5/5 evidence items grounded, cross-verified across 2 files."},
  "searchCoverage": {"scopeLimited": false, "filesRead": 8, "grepCalls": 4, "stoppedByBudget": false},
  "failure": null,
  "sessionId": "sess_1f4bef4ea8bf1c49",
  "stats": {"model": "zai-glm-4.7", "turns": 9, "toolCalls": 13, "elapsedMs": 6794, "totalTokens": 122832}
}
```

## Notable
- Correctly identifies FastMCP + scope-based filtering + mount pattern
- Snippets show actual decorator/mount code
- Cross-verified across 2 files (server.py + main.py)
