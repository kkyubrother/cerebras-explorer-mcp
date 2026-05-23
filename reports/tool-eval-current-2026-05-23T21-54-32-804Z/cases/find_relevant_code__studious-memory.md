# find_relevant_code on studious-memory

## Tool Description
Use first when you need to locate the files and line ranges relevant to a feature, bug, config, route, or behavior before deciding what to read or edit. Give the natural-language query plus any known anchors. Returns targets and cited evidence; read only returned edit/read targets afterward.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {
      "type": "string",
      "description": "What code to locate and why."
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
    "knownFiles": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "knownSymbols": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "knownText": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "session": {
      "type": "string"
    }
  },
  "required": [
    "query"
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
  "query": "Find the smallest useful files and line ranges for understanding backend MCP/FastAPI surface, frontend auth, extension capture, and ops scripts.",
  "knownFiles": [
    "backend/mcp_server.py"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Identified key files: backend MCP surface (mcp_server.py, main.py, app/mcp/server.py), frontend auth (api.ts), extension capture (captureDraft.ts), and ops scripts (backup-sqlite.sh, setup-ubuntu-24.04.sh). Selected smallest useful line ranges showing initialization, routing, session management, capture logic, and backup/setup workflows.",
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
    "fileCount": 7,
    "warnings": [],
    "summary": "Verified: 10 files read, 8/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
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
    "filesRead": 10,
    "grepCalls": 0,
    "listDirCalls": 8,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 10 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_9eaf60837d960830",
  "session": {
    "id": "sess_9eaf60837d960830",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/mcp_server.py",
      "role": "read",
      "reason": "Stdio transport entry point: runs migrations, sets MCP auth context, starts server",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 1,
      "endLine": 41
    },
    {
      "path": "backend/main.py",
      "role": "read",
      "reason": "FastAPI app creation with middleware stack: auth, correlation, IP block, rate limit",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1,
      "endLine": 85
    },
    {
      "path": "backend/main.py",
      "role": "read",
      "reason": "MCP HTTP sub-app mounting with concurrency limiter and request logger",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 757,
      "endLine": 783
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "FastMCP server initialization, scoped_tool decorator, scope-based filtering",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 1,
      "endLine": 120
    },
    {
      "path": "backend/app/api/router.py",
      "role": "read",
      "reason": "API router composition showing all v1 endpoints included",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 1,
      "endLine": 55
    },
    {
      "path": "frontend/src/api.ts",
      "role": "read",
      "reason": "Session token storage, change events, and bootstrapSession validation",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 11,
      "endLine": 172
    },
    {
      "path": "extensions/firefox-inbox/src/background/captureDraft.ts",
      "role": "read",
      "reason": "Draft capture creation, state management, and text length validation",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 22,
      "endLine": 82
    },
    {
      "path": "scripts/backup-sqlite.sh",
      "role": "read",
      "reason": "SQLite backup: integrity check, tar creation, age encryption, cleanup",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 98,
      "endLine": 174
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/mcp_server.py",
      "startLine": 1,
      "endLine": 41,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows stdio MCP server entry point with migration runner and auth context setup",
      "snippet": "1: \"\"\"Stdio transport entry point for MCP clients that don't support HTTP.\"\"\"\n2: \n3: import os\n4: import subprocess\n5: import sys\n6: \n7: \n8: def _run_migrations() -> None:\n9:     \"\"\"Run Alembic migrations before starting the stdio server.\"\"\"\n10:     from app.config import ensure_runtime_directories\n11: \n12:     ensure_runtime_directories()\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "backend/main.py",
      "startLine": 1,
      "endLine": 85,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows FastAPI app with AuthMiddleware, CorrelationIdMiddleware, IPBlockMiddleware, RateLimitMiddleware",
      "snippet": "1: import asyncio\n2: from contextlib import asynccontextmanager\n3: from datetime import datetime\n4: import json\n5: import logging\n6: import os\n7: from pathlib import Path\n8: import subprocess\n9: import sys\n10: import time\n11: \n12: import uvicorn\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "backend/main.py",
      "startLine": 757,
      "endLine": 783,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows MCP HTTP sub-app mounting with McpRequestLogger and McpConcurrencyLimiter",
      "snippet": "757: # MCP server: streamable_http_app() uses internal path /mcp.\n758: # Mounted last at \"/\" so all /mcp requests reach the MCP sub-app.\n759: # Starlette evaluates routes in order; explicit routes above match first.\n760: # Wrapped with concurrency limiter (separate from chat streams) and access logger.\n761: _mcp_rpc_semaphore = asyncio.Semaphore(settings.MCP_MAX_RPC_CONNECTIONS)\n762: _mcp_sse_semaphore = asyncio.Semaphore(settings.MCP_MAX_SSE_CONNECTIONS)\n763: app.mount(\n764:     \"/\",\n765:     McpRequestLogger(\n766:         McpConcurrencyLimiter(\n767:             _mcp_http_app,\n768:             rpc_semaphore=_mcp_rpc_semaphore,\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "backend/app/mcp/server.py",
      "startLine": 1,
      "endLine": 120,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows FastMCP server initialization, scoped_tool decorator, and tool filtering",
      "snippet": "1: from collections.abc import Callable\n2: from functools import wraps\n3: from typing import Any\n4: \n5: from mcp.server.fastmcp import FastMCP\n6: \n7: from app.mcp.authz import (\n8:     MCP_SCOPE_APPROVAL_READ,\n9:     MCP_SCOPE_LOOP_WRITE,\n10:     MCP_SCOPE_MEMORY_READ,\n11:     MCP_SCOPE_MEMORY_WRITE,\n12:     MCP_SCOPE_NAVER_AGENT,\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "backend/app/api/router.py",
      "startLine": 1,
      "endLine": 55,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows all v1 API routers included in main API router",
      "snippet": "1: from fastapi import APIRouter\n2: \n3: from app.api.v1 import access_profiles, actions, activity, admin, agent, ai_config, ai_logs, api_keys, approvals, assistant, audit_logs, auth, chat, config, data_groups, diaries, diary_templates, digest, entities, feedback_events, home, identity, insights, knowledge, loops, master_profile, memory, notification_channels, notification_logs, notification_settings, notification_templates, openai_compat, orchestrator, people, proactive, refinement, relationships, reminders, review_inbox, routine_candidates, runs, schedules, scheduling, search, security, sources, todos\n4: \n5: api_router = APIRouter()\n6: \n7: api_router.include_router(auth.router)\n8: api_router.include_router(agent.router)\n9: api_router.include_router(actions.router)\n10: api_router.include_router(chat.router)\n11: api_router.include_router(config.router)\n12: api_router.include_router(home.r\n... [truncated 30 chars]"
    },
    {
      "id": "E6",
      "path": "frontend/src/api.ts",
      "startLine": 11,
      "endLine": 172,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows session token storage, events, and bootstrapSession validation",
      "snippet": "11: const LEGACY_API_KEY_STORAGE = 'studious_api_key'\n12: const LEGACY_SESSION_MARKER_STORAGE = 'studious_session_active'\n13: const SESSION_TOKEN_STORAGE = 'studious_session_token'\n14: const SESSION_CHANGE_EVENT = 'studious:session-change'\n15: const SESSION_INFO_CHANGE_EVENT = 'studious:session-info-change'\n16: const DEFAULT_API_BASE_URL = '/api/v1'\n17: const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL\n18: \n19: type QueryParams = Record<string, string | number | boolean | null | undefined>\n20: export type SessionBootstrapState = 'authenticated' | 'unauthenticated' | 'unknown'\n21: export type SessionBootstrapReason = 'rate_limited' | 'unknown'\n22: type SessionChangeDetail = { active: boolean; session?: AuthSessionInfo | null }\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "extensions/firefox-inbox/src/background/captureDraft.ts",
      "startLine": 22,
      "endLine": 82,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows createCaptureDraft function with state and length validation",
      "snippet": "22: export function createCaptureDraft(input: DraftInput): BrowserCapture {\n23:   const selectedText = (input.selectedText ?? '').trim()\n24:   const fallbackNote = (input.fallbackNote ?? '').trim()\n25:   const receivedClientAt = (input.now ?? new Date()).toISOString()\n26:   return {\n27:     clientCaptureId: input.clientCaptureId ?? createClientCaptureId(input.randomId),\n28:     pageUrl: input.pageUrl,\n29:     pageTitle: input.pageTitle?.trim() || null,\n30:     selectedText,\n31:     fallbackNote,\n32:     inputChannel: INPUT_CHANNEL,\n33:     originPackage: ORIGIN_PACKAGE,\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "scripts/backup-sqlite.sh",
      "startLine": 98,
      "endLine": 174,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows SQLite integrity check, tar creation, age encryption, manifest, cleanup",
      "snippet": "98: mkdir -p \"${BACKUP_DIR}\" \"${STORAGE_ROOT}\"\n99: \n100: echo \"[backup] ${TIMESTAMP} - 백업 시작\"\n101: \n102: if ! sqlite3 \"${DB_PATH}\" \".backup '${BACKUP_DB}'\"; then\n103:     healthcheck_ping \"/fail\"\n104:     notify \"$(printf '%s\\n%s\\n%s' \\\n105:         '[backup] FAIL: SQLite .backup failed' \\\n106:         \"조사: sqlite3 ${DB_PATH} 'PRAGMA integrity_check;'\" \\\n107:         '문서: docs/ops/incident-playbook.md (DB 연결 실패)')\"\n108:     exit 1\n109: fi\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 7,
    "toolCalls": 18,
    "filesRead": 10,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 10956,
    "totalTokens": 149809
  }
}
```

ElapsedMs: 10971
McpIsError: false
