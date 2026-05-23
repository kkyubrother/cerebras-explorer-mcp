# explore on studious-memory

## Tool Description
Use for a user-facing Markdown investigation report with inline file:line citations. Best for architecture walkthroughs, onboarding explanations, code review context, or broad "how does X work?" answers. Do NOT use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead. Omit thoroughness in normal agent use unless an advanced workflow explicitly requires quick, normal, or deep.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "prompt": {
      "type": "string",
      "description": "What to explore — a natural-language question or task."
    },
    "thoroughness": {
      "type": "string",
      "enum": [
        "quick",
        "normal",
        "deep"
      ],
      "description": "Advanced only. Omit for normal agent use; defaults to normal report depth."
    },
    "scope": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional path prefixes to focus on."
    },
    "repo_root": {
      "type": "string",
      "description": "Repository root path."
    },
    "session": {
      "type": "string",
      "description": "Session ID from a previous call."
    },
    "language": {
      "type": "string",
      "description": "BCP-47 language tag for the report (e.g. \"ko\", \"en\")."
    },
    "context": {
      "type": "string",
      "description": "Optional additional context from the parent agent."
    }
  },
  "required": [
    "prompt"
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
  "prompt": "Give a concise architecture report for backend MCP/FastAPI surface, frontend auth, extension capture, and ops scripts. Include inline file:line citations and flag uncertainty.",
  "language": "en"
}
```

## Response Summary
```json
{
  "reportPreview": "# Architecture Report: Studious Memory\n\n## Summary\n\nStudious Memory is a privacy-focused personal knowledge system with a **FastAPI/MCP backend**, **React frontend**, **Firefox browser extension** for content capture, **Android app** for mobile access, and a comprehensive **ops suite** for deployment and maintenance. The backend exposes both REST API endpoints and MCP (Model Context Protocol) tools with OAuth-based scope authorization. The frontend uses session-based authentication with optional TOTP 2FA. The Firefox extension captures web content and submits it to the backend via API key authentication. Operations are automated through bash scripts with encrypted backups, health monitoring, and container deployment.\n\n---\n\n## Findings\n\n### 1. Backend MCP/FastAPI Surface\n\n#### Entry Points\n- **Main FastAPI App**: `backend/main.py` serves as the primary HTTP server entry point\n  - MCP sub-app mounted at `/mcp` via `mcp.streamable_http_app()` (backend/main.py:L74)\n  - Comprehensive middleware stack for auth, rate limiting, logging, IP blocking\n  - Background loop supervisors for digest, reminders, notifications, proactive engine\n- **MCP Stdio Transport**: `backend/mcp_server.py` provides stdio transport entry for MCP clients\n  - Runs Alembic migrations before startup (backend/mcp_server.py:L8-L23)\n  - Sets default owner ID and auth context for local stdio clients (backend/mcp_server.py:L34-L39)\n\n#### API Structure\n- **Router**: `backend/app/api/router.py` aggregates 53 v1 endpoint modules organized by domain\n  - Core routes: auth, agent, chat, sources, orchestrator, approvals, security\n  - Knowledge routes: knowledge, memory, diaries, todos, schedules, reminders\n  - Operations routes: admin, audit_logs, ai_config, ai_logs, notification_*\n  - External routes: openai_compat, proactive, relationships, search\n- **Auth Endpoints**: `backend/app/api/v1/auth.py` implements authentication\n  - `POST /auth/session` - Password login with optional TOTP 2FA (backend/app/api/v1/auth.py:L69-L83)\n  - `POST /auth/session/2fa` - Complete 2FA verification (backend/app/api/v1/auth.py:L86-L88)\n  - Session tokens include owner_id, role, scopes, access_profile_id (backend/app/api/v1/auth.py:L157-L194)\n  - Profile switching between \"full\" and \"work_safe\" modes (backend/app/api/v1/auth.py:L91-L92)\n\n#### MCP Server\n- **Server Setup**: `backend/app/mcp/server.py` uses FastMCP framework with scoped tools\n  - All tools decorated with `@scoped_tool()` requiring specific OAuth scopes (backend/app/mcp/server.py:L79-L89)\n  - Dynamic tool listing filtered by granted scopes (backend/app/mcp/\n... [truncated 17023 chars]",
  "citations": [
    {
      "type": "file_range",
      "path": "backend/main.py",
      "startLine": 74,
      "endLine": 74,
      "raw": "backend/main.py:L74"
    },
    {
      "type": "file_range",
      "path": "backend/mcp_server.py",
      "startLine": 8,
      "endLine": 23,
      "raw": "backend/mcp_server.py:L8-L23"
    },
    {
      "type": "file_range",
      "path": "backend/mcp_server.py",
      "startLine": 34,
      "endLine": 39,
      "raw": "backend/mcp_server.py:L34-L39"
    },
    {
      "type": "file_range",
      "path": "backend/app/api/v1/auth.py",
      "startLine": 69,
      "endLine": 83,
      "raw": "backend/app/api/v1/auth.py:L69-L83"
    },
    {
      "type": "file_range",
      "path": "backend/app/api/v1/auth.py",
      "startLine": 86,
      "endLine": 88,
      "raw": "backend/app/api/v1/auth.py:L86-L88"
    },
    {
      "type": "file_range",
      "path": "backend/app/api/v1/auth.py",
      "startLine": 157,
      "endLine": 194,
      "raw": "backend/app/api/v1/auth.py:L157-L194"
    },
    {
      "type": "file_range",
      "path": "backend/app/api/v1/auth.py",
      "startLine": 91,
      "endLine": 92,
      "raw": "backend/app/api/v1/auth.py:L91-L92"
    },
    {
      "type": "file_range",
      "path": "backend/app/mcp/server.py",
      "startLine": 79,
      "endLine": 89,
      "raw": "backend/app/mcp/server.py:L79-L89"
    },
    {
      "type": "file_range",
      "path": "backend/app/mcp/server.py",
      "startLine": 95,
      "endLine": 107,
      "raw": "backend/app/mcp/server.py:L95-L107"
    },
    {
      "type": "file_range",
      "path": "backend/app/mcp/authz.py",
      "startLine": 5,
      "endLine": 24,
      "raw": "backend/app/mcp/authz.py:L5-L24"
    },
    {
      "type": "file_range",
      "path": "backend/app/mcp/authz.py",
      "startLine": 27,
      "endLine": 37,
      "raw": "backend/app/mcp/authz.py:L27-L37"
    },
    {
      "type": "file_range",
      "path": "backend/app/middleware/auth.py",
      "startLine": 66,
      "endLine": 77,
      "raw": "backend/app/middleware/auth.py:L66-L77"
    }
  ],
  "targets": [
    {
      "path": "backend/main.py",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 74,
      "endLine": 74
    },
    {
      "path": "backend/mcp_server.py",
      "role": "reference",
      "reason": "Markdown report citations merged from 2 ranges.",
      "evidenceRefs": [],
      "startLine": 8,
      "endLine": 39
    },
    {
      "path": "backend/app/api/v1/auth.py",
      "role": "reference",
      "reason": "Markdown report citations merged from 4 ranges.",
      "evidenceRefs": [],
      "startLine": 69,
      "endLine": 194
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "reference",
      "reason": "Markdown report citations merged from 4 ranges.",
      "evidenceRefs": [],
      "startLine": 79,
      "endLine": 107
    },
    {
      "path": "backend/app/mcp/authz.py",
      "role": "reference",
      "reason": "Markdown report citations merged from 2 ranges.",
      "evidenceRefs": [],
      "startLine": 5,
      "endLine": 37
    },
    {
      "path": "backend/app/middleware/auth.py",
      "role": "reference",
      "reason": "Markdown report citations merged from 3 ranges.",
      "evidenceRefs": [],
      "startLine": 18,
      "endLine": 77
    },
    {
      "path": "frontend/src/api.ts",
      "role": "reference",
      "reason": "Markdown report citations merged from 17 ranges.",
      "evidenceRefs": [],
      "startLine": 11,
      "endLine": 450
    },
    {
      "path": "frontend/src/pages/Login.tsx",
      "role": "reference",
      "reason": "Markdown report citations merged from 4 ranges.",
      "evidenceRefs": [],
      "startLine": 13,
      "endLine": 92
    }
  ],
  "filesRead": [
    "backend/main.py",
    "backend/mcp_server.py",
    "backend/app/api/router.py",
    "backend/app/api/v1/auth.py",
    "backend/app/mcp/server.py",
    "extensions/firefox-inbox/src/background/captureDraft.ts",
    "extensions/firefox-inbox/src/background/background.ts",
    "frontend/src/api.ts",
    "frontend/src/pages/Login.tsx",
    "backend/app/mcp/authz.py",
    "extensions/firefox-inbox/src/shared/apiClient.ts",
    "scripts/setup-ubuntu-24.04.sh",
    "scripts/deploy-prx-lxc.sh",
    "android/app/src/main/java/com/studiousmemory/android/MainActivity.kt",
    "scripts/backup-sqlite.sh",
    "backend/app/middleware/auth.py"
  ],
  "toolsUsed": [
    "repo_list_dir",
    "repo_read_file",
    "repo_find_files",
    "repo_grep"
  ],
  "critic": {
    "status": "caution",
    "warnings": [
      {
        "type": "truncated_tool_results",
        "severity": "low",
        "message": "6 tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing.",
        "action": "Use a narrower follow-up query or read specific ranges before relying on missing evidence."
      }
    ]
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
    "filesRead": 19,
    "grepCalls": 1,
    "listDirCalls": 8,
    "symbolCalls": 0,
    "toolResultsTruncated": 6,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**",
      "6 tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing."
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 19 file read(s), 1 grep search(es)."
  },
  "stats": {
    "turns": 14,
    "toolCalls": 34,
    "filesRead": 19,
    "grepCalls": 1,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 23093,
    "totalTokens": 288682
  }
}
```

ElapsedMs: 23106
McpIsError: false
