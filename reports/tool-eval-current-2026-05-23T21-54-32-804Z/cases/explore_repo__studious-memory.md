# explore_repo on studious-memory

## Tool Description
Use FIRST for read-only code discovery when the exact files are unknown, the task may span 3+ files, or you need cross-file evidence: architecture, symbol usage, dependency/call tracing, bug root cause, change impact, config origin, or evidence collection. Do NOT use for a single known file/range or when immediate editing is cheaper. Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. Omit budget and hints.strategy unless required by an advanced workflow. Pass sessionId as "session" for follow-up calls.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "task": {
      "type": "string",
      "description": "Natural-language exploration request. Be specific for best results: \"How does the auth middleware validate JWT tokens and where is it applied?\" is better than \"explain auth\"."
    },
    "repo_root": {
      "type": "string",
      "description": "Repository root path. Defaults to the current working directory of the MCP server process."
    },
    "scope": {
      "type": "array",
      "description": "Path prefixes or glob patterns to focus exploration. Example: [\"src/api/**\", \"lib/auth/\"]. Omit to search the entire repo.",
      "items": {
        "type": "string"
      }
    },
    "hints": {
      "type": "object",
      "additionalProperties": false,
      "description": "Starting hints to accelerate exploration. Provide known symbols, file paths, or regex patterns so the explorer skips broad scanning.",
      "properties": {
        "symbols": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Known symbol names to start with (e.g. [\"handleAuth\", \"JwtValidator\"])."
        },
        "files": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Known file paths to examine first (e.g. [\"src/middleware/auth.ts\"])."
        },
        "regex": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Advanced only. Prefer wrapper knownText for literal anchors; use regex only when the caller already knows an exact pattern."
        },
        "strategy": {
          "type": "string",
          "enum": [
            "symbol-first",
            "reference-chase",
            "git-guided",
            "breadth-first",
            "blame-guided",
            "pattern-scan"
          ],
          "description": "Advanced only. Omit for normal agent use; strategy is auto-detected from the task and known anchors."
        }
      }
    },
    "session": {
      "type": "string",
      "description": "Optional session ID returned by a previous explore_repo call. When provided, the explorer carries over discovered file paths and prior summaries to accelerate follow-up exploration."
    },
    "language": {
      "type": "string",
      "description": "Advanced/optional. Omit for normal agent use; the explorer infers response language from the task text. Use only when a workflow must force a BCP-47 language tag such as \"ko\", \"en\", or \"ja\"."
    }
  },
  "required": [
    "task"
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
  "task": "Explain the repository purpose and the main implementation path for backend MCP/FastAPI surface, frontend auth, extension capture, and ops scripts. Return grounded targets that a parent coding agent should verify before editing."
}
```

## Response Summary
```json
{
  "directAnswer": "Repository: 'Personal external memory service using Vision AI' — an AI-powered personal knowledge management system. Main implementation paths:\n\n1. Backend MCP/FastAPI surface: FastAPI app (main.py) with MCP server (mcp_server.py, app/mcp/server.py) using FastMCP. Provides scoped tools via stdio/HTTP transport, integrated through AuthMiddleware.\n\n2. Frontend auth: Password-based + TOTP 2FA (Login.tsx, api.ts). Uses createSessionWithPassword → completeSessionWith2FA flow with JWT session tokens.\n\n3. Extension capture: Firefox extension (firefox-inbox/background.ts, content/getSelection.ts) captures page URL/title/selected text and submits to backend.\n\n4. Ops scripts: deploy-prx-lxc.sh (system deps, service user, migrations); backup-sqlite.sh (SQLite .backup, age encryption, integrity checks).",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 8,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 8,
    "warnings": [],
    "summary": "Verified: 17 files read, 8/8 evidence items grounded, cross-verified across 8 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read backend/main.py:1-80 before editing.",
    "target": {
      "path": "backend/main.py",
      "role": "edit",
      "reason": "FastAPI entry point with MCP integration, middleware stack, and background loops",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1,
      "endLine": 80
    }
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
    "filesRead": 17,
    "grepCalls": 0,
    "listDirCalls": 7,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 17 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_20afcbf704eeff63",
  "session": {
    "id": "sess_20afcbf704eeff63",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/main.py",
      "role": "edit",
      "reason": "FastAPI entry point with MCP integration, middleware stack, and background loops",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1,
      "endLine": 80
    },
    {
      "path": "backend/mcp_server.py",
      "role": "edit",
      "reason": "MCP stdio transport entry point that runs migrations and starts MCP server",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 1,
      "endLine": 41
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "edit",
      "reason": "FastMCP server definition with scoped_tool decorator for MCP tools",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 1,
      "endLine": 120
    },
    {
      "path": "frontend/src/pages/Login.tsx",
      "role": "edit",
      "reason": "Login component with password and TOTP 2FA flows",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 1,
      "endLine": 100
    },
    {
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "role": "edit",
      "reason": "Background script handles captureCurrentPage and retryLastCapture logic",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 1,
      "endLine": 100
    },
    {
      "path": "scripts/deploy-prx-lxc.sh",
      "role": "edit",
      "reason": "Deployment script installs system packages, creates service user, runs migrations",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 1,
      "endLine": 100
    },
    {
      "path": "backend/pyproject.toml",
      "startLine": 5,
      "endLine": 9,
      "role": "read",
      "reason": "Project name and description: 'Personal external memory service using Vision AI'",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "frontend/src/api.ts",
      "startLine": 1,
      "endLine": 120,
      "role": "read",
      "reason": "Frontend API client with session token storage and auth functions",
      "evidenceRefs": [
        "E5"
      ]
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/pyproject.toml",
      "startLine": 5,
      "endLine": 9,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Project name and description: 'Personal external memory service using Vision AI'",
      "snippet": "5: [project]\n6: name = \"studious-memory\"\n7: version = \"0.63.0\"\n8: description = \"Personal external memory service using Vision AI\"\n9: requires-python = \">=3.14\""
    },
    {
      "id": "E2",
      "path": "backend/main.py",
      "startLine": 1,
      "endLine": 80,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FastAPI app with MCP integration, middleware stack, and background loop initialization",
      "snippet": "1: import asyncio\n2: from contextlib import asynccontextmanager\n3: from datetime import datetime\n4: import json\n5: import logging\n6: import os\n7: from pathlib import Path\n8: import subprocess\n9: import sys\n10: import time\n11: \n12: import uvicorn\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "backend/mcp_server.py",
      "startLine": 1,
      "endLine": 41,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "MCP stdio transport entry point with migration runner and auth context setup",
      "snippet": "1: \"\"\"Stdio transport entry point for MCP clients that don't support HTTP.\"\"\"\n2: \n3: import os\n4: import subprocess\n5: import sys\n6: \n7: \n8: def _run_migrations() -> None:\n9:     \"\"\"Run Alembic migrations before starting the stdio server.\"\"\"\n10:     from app.config import ensure_runtime_directories\n11: \n12:     ensure_runtime_directories()\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "backend/app/mcp/server.py",
      "startLine": 1,
      "endLine": 120,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FastMCP server using FastMCP('MaidBot') with scoped_tool decorator pattern",
      "snippet": "1: from collections.abc import Callable\n2: from functools import wraps\n3: from typing import Any\n4: \n5: from mcp.server.fastmcp import FastMCP\n6: \n7: from app.mcp.authz import (\n8:     MCP_SCOPE_APPROVAL_READ,\n9:     MCP_SCOPE_LOOP_WRITE,\n10:     MCP_SCOPE_MEMORY_READ,\n11:     MCP_SCOPE_MEMORY_WRITE,\n12:     MCP_SCOPE_NAVER_AGENT,\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "frontend/src/api.ts",
      "startLine": 1,
      "endLine": 120,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Frontend API client with session token storage and auth functions",
      "snippet": "1: import axios, { AxiosError } from 'axios'\n2: import { localizeCurrent } from './i18n'\n3: import type { AuthSessionInfo } from './shared/api/contracts'\n4: import { ApiContractError } from './shared/api/contractError'\n5: import { parseAuthSession, parseChatMessages } from './shared/api/schemas/contracts'\n6: import {\n7:   promptSudo,\n8:   setSudoStatusSnapshot,\n9: } from './features/sudo/sudoController'\n10: \n11: const LEGACY_API_KEY_STORAGE = 'studious_api_key'\n12: const LEGACY_SESSION_MARKER_STORAGE = 'studious_session_active'\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "frontend/src/pages/Login.tsx",
      "startLine": 1,
      "endLine": 100,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Login component with password mode and TOTP mode, calling auth API",
      "snippet": "1: import type { FormEvent } from 'react'\n2: import { useState } from 'react'\n3: import { Link, useNavigate } from 'react-router-dom'\n4: import {\n5:   completeSessionWith2FA,\n6:   createSessionWithPassword,\n7:   getApiErrorMessage,\n8: } from '../api'\n9: import { maidImages } from '../assets/maid'\n10: import AuthArtworkPanel, { AuthCompactInfo } from '../components/AuthArtworkPanel'\n11: import { useI18n } from '../i18n'\n12: \n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "startLine": 1,
      "endLine": 100,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Background script with captureCurrentPage, page policy evaluation, draft saving",
      "snippet": "1: import { submitCapture, SourceIntakeError } from '../shared/apiClient'\n2: import { safeErrorMessage } from '../shared/errors'\n3: import { isExtensionRequest, type ExtensionRequest, type ExtensionResponse } from '../shared/messages'\n4: import { evaluatePagePolicy } from '../shared/pagePolicy'\n5: import {\n6:   clearCaptureDraft,\n7:   loadCaptureDraft,\n8:   loadConnectionSettings,\n9:   saveCaptureDraft,\n10:   toSafeSettings,\n11: } from '../shared/storage'\n12: import type { BrowserCapture, CaptureSubmissionResult, ExtensionConnectionSettings, ExtensionErrorCode } from '../shared/types'\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "scripts/deploy-prx-lxc.sh",
      "startLine": 1,
      "endLine": 100,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Deployment script: OS packages, service user, state directories, env file",
      "snippet": "1: #!/usr/bin/env bash\n2: set -euo pipefail\n3: \n4: if [[ \"${EUID}\" -ne 0 ]]; then\n5:   echo \"This script must be run as root.\" >&2\n6:   exit 1\n7: fi\n8: \n9: SCRIPT_DIR=\"$(cd -- \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"\n10: APP_DIR=\"$(cd -- \"${SCRIPT_DIR}/..\" && pwd)\"\n11: BACKEND_DIR=\"${APP_DIR}/backend\"\n12: \n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 7,
    "toolCalls": 24,
    "filesRead": 17,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 9946,
    "totalTokens": 170209
  }
}
```

ElapsedMs: 9959
McpIsError: false
