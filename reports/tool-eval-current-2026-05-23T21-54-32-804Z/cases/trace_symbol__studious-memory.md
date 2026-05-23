# trace_symbol on studious-memory

## Tool Description
Use when a known function, class, variable, or type needs definition plus usage/callsite context. Returns grounded targets and evidence without requiring a manual grep-then-read loop.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "symbol": {
      "type": "string",
      "description": "The symbol name to explain (function, class, variable, type, etc.)."
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
      "type": "string",
      "description": "Optional session ID for continuity."
    }
  },
  "required": [
    "symbol"
  ]
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
  "symbol": "scoped_tool"
}
```

## Response Summary
```json
{
  "directAnswer": "scoped_tool is a decorator factory defined in backend/app/mcp/server.py (lines 79-91) that adds scope-based authorization to MCP tool functions. It accepts *required_scopes: str, returns a decorator, registers the function as an MCP tool with scope metadata, validates authorization via require_mcp_scopes() before execution, and uses scope constants defined in backend/app/mcp/authz.py (lines 5-13).",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 5,
    "partialCount": 1,
    "droppedCount": 0,
    "fileCount": 3,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 5 files read, 3 grep searches, 1 symbol lookups, 5/6 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
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
    "grepCalls": 3,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 5 file read(s), 3 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_ad05f770839640c3",
  "session": {
    "id": "sess_ad05f770839640c3",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "Complete definition of scoped_tool decorator factory",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 79,
      "endLine": 91
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "Imports showing dependencies (Callable, wraps, require_mcp_scopes)",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1,
      "endLine": 19
    },
    {
      "path": "backend/app/mcp/authz.py",
      "role": "context",
      "reason": "Scope constant definitions (MCP_SCOPE_MEMORY_READ, MEMORY_WRITE, etc.)",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 5,
      "endLine": 13
    },
    {
      "path": "backend/app/mcp/authz.py",
      "role": "context",
      "reason": "require_mcp_scopes implementation for authorization checking",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 59,
      "endLine": 67
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Example usage: @scoped_tool(MCP_SCOPE_MEMORY_WRITE) on process_input",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 123,
      "endLine": 130
    },
    {
      "path": "scripts/generate_contract_snapshot.py",
      "role": "read",
      "reason": "Script references scoped_tool as an AST node identifier",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 166,
      "endLine": 166
    }
  ],
  "discoveredPathsCount": 4,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/app/mcp/server.py",
      "startLine": 79,
      "endLine": 91,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition: decorator factory accepting *required_scopes, wrapping with require_mcp_scopes check",
      "snippet": "79: def scoped_tool(*required_scopes: str):\n80:     def _decorator(func: Callable[..., Any]):\n81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})\n82:         @wraps(func)\n83:         async def _wrapped(*args: Any, **kwargs: Any):\n84:             require_mcp_scopes(*required_scopes)\n85:             return await func(*args, **kwargs)\n86: \n87:         return _wrapped\n88: \n89:     return _decorator\n90: \n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "backend/app/mcp/server.py",
      "startLine": 1,
      "endLine": 19,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Import statements showing Callable, wraps, Any, and require_mcp_scopes dependencies",
      "snippet": "1: from collections.abc import Callable\n2: from functools import wraps\n3: from typing import Any\n4: \n5: from mcp.server.fastmcp import FastMCP\n6: \n7: from app.mcp.authz import (\n8:     MCP_SCOPE_APPROVAL_READ,\n9:     MCP_SCOPE_LOOP_WRITE,\n10:     MCP_SCOPE_MEMORY_READ,\n11:     MCP_SCOPE_MEMORY_WRITE,\n12:     MCP_SCOPE_NAVER_AGENT,\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "backend/app/mcp/authz.py",
      "startLine": 5,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Defines 9 scope constants used by scoped_tool (MEMORY_READ, MEMORY_WRITE, etc.)",
      "snippet": "5: MCP_SCOPE_MEMORY_READ = \"maidbot.memory.read\"\n6: MCP_SCOPE_MEMORY_WRITE = \"maidbot.memory.write\"\n7: MCP_SCOPE_TODO_WRITE = \"maidbot.todo.write\"\n8: MCP_SCOPE_REMINDER_WRITE = \"maidbot.reminder.write\"\n9: MCP_SCOPE_SCHEDULE_WRITE = \"maidbot.schedule.write\"\n10: MCP_SCOPE_LOOP_WRITE = \"maidbot.loop.write\"\n11: MCP_SCOPE_APPROVAL_READ = \"maidbot.approval.read\"\n12: MCP_SCOPE_WEB_SEARCH = \"maidbot.web.search\"\n13: MCP_SCOPE_NAVER_AGENT = \"maidbot.naver.agent\""
    },
    {
      "id": "E4",
      "path": "backend/app/mcp/authz.py",
      "startLine": 59,
      "endLine": 67,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "require_mcp_scopes validates scopes, expands granted scopes, raises McpScopeError on failure",
      "snippet": "59: def require_mcp_scopes(*required_scopes: str) -> None:\n60:     required = tuple(scope for scope in required_scopes if isinstance(scope, str) and scope.strip())\n61:     if not required:\n62:         return\n63: \n64:     granted = expand_mcp_scopes(get_mcp_scopes())\n65:     missing = tuple(scope for scope in required if scope not in granted)\n66:     if missing:\n67:         raise McpScopeError(missing)"
    },
    {
      "id": "E5",
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 130,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows scoped_tool usage as decorator requiring MCP_SCOPE_MEMORY_WRITE",
      "snippet": "123: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)\n124: async def process_input(\n125:     text: str | None = None,\n126:     image_base64: str | None = None,\n127:     image_mime: str | None = None,\n128:     context_enrichment: bool = False,\n129: ) -> dict:\n130:     \"\"\"주인님의 텍스트·이미지를 접수하여 AI 분석 후 지식·할일·일정으로 정리합니다."
    },
    {
      "id": "E6",
      "path": "scripts/generate_contract_snapshot.py",
      "startLine": 166,
      "endLine": 166,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "AST node check referencing scoped_tool identifier in code generation",
      "snippet": "166:             if isinstance(func, ast.Name) and func.id == \"scoped_tool\":"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 9,
    "filesRead": 5,
    "grepCalls": 3,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 7022,
    "totalTokens": 45658
  }
}
```

ElapsedMs: 7033
McpIsError: false
