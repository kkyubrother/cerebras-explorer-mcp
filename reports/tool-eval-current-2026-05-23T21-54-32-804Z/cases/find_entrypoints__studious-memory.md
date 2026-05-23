# find_entrypoints on studious-memory

## Tool Description
Use to surface where execution starts in a repository: HTTP routes, CLI commands, cron handlers, MCP tools, or event handlers. Faster than running find_relevant_code with manual regex hints. Detection is regex-based and may include false positives — verify cited lines before acting.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "entryKind": {
      "type": "string",
      "enum": [
        "http",
        "cli",
        "cron",
        "mcp",
        "event",
        "all"
      ],
      "description": "Optional. Restrict detection to one entry kind. Defaults to \"all\"."
    },
    "repo_root": {
      "type": "string"
    },
    "scope": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "session": {
      "type": "string"
    }
  }
}
```

## Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/studious-memory",
  "scope": [
    "backend/**",
    "frontend/src/**",
    "extensions/firefox-inbox/src/**",
    "scripts/**",
    "android/**"
  ],
  "entryKind": "mcp"
}
```

## Response Summary
```json
{
  "directAnswer": "All MCP tool registrations centralized in backend/app/mcp/server.py. 42 tools via @scoped_tool() wrapper calling @mcp.tool() at line 81, 7 resources via @scoped_resource() wrapper calling @mcp.resource() at line 112. No registrations in frontend, extensions, scripts, or android. ⚠️ Regex-based detection: verify cited lines before acting.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 8,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 1,
    "warnings": [],
    "summary": "Verified: 5 files read, 9 grep searches, 8/8 evidence items grounded. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "backend/**",
      "frontend/src/**",
      "extensions/firefox-inbox/src/**",
      "scripts/**",
      "android/**"
    ],
    "scopeLimited": true,
    "filesRead": 5,
    "grepCalls": 9,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 5 file read(s), 9 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_4cbc9182a4cbae1d",
  "session": {
    "id": "sess_4cbc9182a4cbae1d",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "FastMCP server instance creation",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 76,
      "endLine": 76
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "scoped_tool decorator wrapper definition",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 79,
      "endLine": 89
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Core @mcp.tool() registration call",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 81,
      "endLine": 81
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "Custom list_tools method override",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 107,
      "endLine": 107
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "scoped_resource decorator wrapper definition",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 110,
      "endLine": 120
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Core @mcp.resource() registration call",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 112,
      "endLine": 112
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Example: process_input tool registration",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 123,
      "endLine": 143
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Example: master-profile resource registration",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 842,
      "endLine": 847
    }
  ],
  "discoveredPathsCount": 36,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/app/mcp/server.py",
      "startLine": 76,
      "endLine": 76,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "MCP server instance creation with FastMCP",
      "snippet": "76: mcp = FastMCP(\"MaidBot\")"
    },
    {
      "id": "E2",
      "path": "backend/app/mcp/server.py",
      "startLine": 79,
      "endLine": 89,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Decorator wrapper calling @mcp.tool() internally",
      "snippet": "79: def scoped_tool(*required_scopes: str):\n80:     def _decorator(func: Callable[..., Any]):\n81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})\n82:         @wraps(func)\n83:         async def _wrapped(*args: Any, **kwargs: Any):\n84:             require_mcp_scopes(*required_scopes)\n85:             return await func(*args, **kwargs)\n86: \n87:         return _wrapped\n88: \n89:     return _decorator"
    },
    {
      "id": "E3",
      "path": "backend/app/mcp/server.py",
      "startLine": 81,
      "endLine": 81,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Actual @mcp.tool() registration call",
      "snippet": "81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})"
    },
    {
      "id": "E4",
      "path": "backend/app/mcp/server.py",
      "startLine": 107,
      "endLine": 107,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Custom list_tools override for scope filtering",
      "snippet": "107: mcp.list_tools = _list_tools_for_current_scope  # type: ignore[method-assign]"
    },
    {
      "id": "E5",
      "path": "backend/app/mcp/server.py",
      "startLine": 110,
      "endLine": 120,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Decorator wrapper calling @mcp.resource() internally",
      "snippet": "110: def scoped_resource(uri: str, *required_scopes: str):\n111:     def _decorator(func: Callable[..., Any]):\n112:         @mcp.resource(uri)\n113:         @wraps(func)\n114:         async def _wrapped(*args: Any, **kwargs: Any):\n115:             require_mcp_scopes(*required_scopes)\n116:             return await func(*args, **kwargs)\n117: \n118:         return _wrapped\n119: \n120:     return _decorator"
    },
    {
      "id": "E6",
      "path": "backend/app/mcp/server.py",
      "startLine": 112,
      "endLine": 112,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Actual @mcp.resource() registration call",
      "snippet": "112:         @mcp.resource(uri)"
    },
    {
      "id": "E7",
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 143,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tool registration: process_input via @scoped_tool()",
      "snippet": "123: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)\n124: async def process_input(\n125:     text: str | None = None,\n126:     image_base64: str | None = None,\n127:     image_mime: str | None = None,\n128:     context_enrichment: bool = False,\n129: ) -> dict:\n130:     \"\"\"주인님의 텍스트·이미지를 접수하여 AI 분석 후 지식·할일·일정으로 정리합니다.\n131: \n132:     Args:\n133:         text: 정리할 텍스트 또는 대화 기록\n134:         image_base64: Base64 인코딩된 이미지 데이터\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "backend/app/mcp/server.py",
      "startLine": 842,
      "endLine": 847,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Resource registration via @scoped_resource()",
      "snippet": "842: @scoped_resource(\"resource://master-profile/current\", MCP_SCOPE_MEMORY_READ)\n843: async def resource_master_profile_current() -> str:\n844:     \"\"\"현재 Master Profile 컨텍스트 (JSON).\"\"\"\n845:     import json\n846:     result = await tool_get_master_context()\n847:     return json.dumps(result, ensure_ascii=False, indent=2)"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 11,
    "toolCalls": 15,
    "filesRead": 5,
    "grepCalls": 9,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 14831,
    "totalTokens": 276718
  }
}
```

ElapsedMs: 14844
McpIsError: false
