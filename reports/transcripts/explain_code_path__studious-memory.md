# Test: explain_code_path on studious-memory

## Request
```json
{"pathQuery": "An MCP client calls the search tool — explain how the request is authenticated by scope and dispatched to the search service", "repo_root": "/home/kyubr/IdeaProjects/studious-memory"}
```

## Response
- **directAnswer**: "MCP client calls search → HTTP mount at `/` (main.py:763-773) or stdio entry (mcp_server.py:26-40) → FastMCP server → scoped_tool decorator checks MCP_SCOPE_MEMORY_READ via require_mcp_scopes() (server.py:79-89; authz.py:59-67) → tool_search() calls execute_mcp_capability() (query_tools.py:168-185) → capability registry re-checks scopes and dispatches to executor (registry.py:553-566) → execute_search() calls search service (misc_handlers.py:11-26). Handoff points: transport → MCP server → tool decorator → capability registry → search service."
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=7
- **8 evidence items, all exact** spanning main.py, mcp_server.py, server.py, authz.py, query_tools.py, registry.py, misc_handlers.py
- **searchCoverage**: filesRead=15, grepCalls=8

## Notable
- ⭐ Identified **double scope check**: once at @scoped_tool, again at execute_mcp_capability — a non-obvious architectural detail
- Distinguishes HTTP mount and stdio entry as alternative transports
- Trace through 7 distinct files connecting auth, decorator, registry, executor, and service

## Cost: turns=14, toolCalls=27, elapsedMs=79180, totalTokens=355549
