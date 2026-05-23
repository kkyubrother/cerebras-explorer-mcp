# Code-blind evaluator packet: map_impact

You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.

## Tool Description
Use when the parent already knows the specific anchor (a file path or symbol name) that is about to change and wants a deeper dependency chain plus test/config blast radius. Differs from map_change_impact: this tool puts the anchor in front and runs a deeper reference chase; map_change_impact takes a natural-language change description.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "anchor": {
      "type": "string",
      "description": "A file path (e.g. \"src/auth.js\") or a symbol name (e.g. \"requireAuth\") that will change."
    },
    "changeType": {
      "type": "string",
      "enum": [
        "rename",
        "refactor",
        "remove",
        "add"
      ],
      "description": "Optional. The intended kind of change so the task statement reflects it (e.g. callers matter more for \"remove\")."
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
    "session": {
      "type": "string"
    }
  },
  "required": [
    "anchor"
  ]
}
```

## Case cerebras-explorer-mcp

### Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/cerebras-explorer-mcp",
  "scope": [
    "src/**",
    "tests/**",
    "examples/**"
  ],
  "anchor": "src/mcp/server.mjs",
  "changeType": "refactor",
  "knownSymbols": [
    "createMcpRequestHandler"
  ]
}
```

### Response
```json
{
  "directAnswer": "Traced dependency chain from src/mcp/server.mjs. Found 3 direct importers: src/index.mjs uses startMcpServer; tests/mcp-server.test.mjs (22 test cases) and tests/security/redact.test.mjs (2 cases) test createMcpRequestHandler. Internally, startMcpServer calls createMcpRequestHandler. No configuration entries directly reference this file.",
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
    "fileCount": 4,
    "warnings": [],
    "summary": "Verified: 4 files read, 4 grep searches, 4 symbol lookups, 8/8 evidence items grounded, cross-verified across 4 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/index.mjs:88-93 before editing.",
    "target": {
      "path": "src/index.mjs",
      "role": "edit",
      "reason": "Uses startMcpServer as parameter default and calls it to start the MCP server",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 88,
      "endLine": 93
    }
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "tests/**",
      "examples/**"
    ],
    "scopeLimited": true,
    "filesRead": 4,
    "grepCalls": 4,
    "listDirCalls": 0,
    "symbolCalls": 4,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 4 file read(s), 4 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_d92da12ef35b30c2",
  "session": {
    "id": "sess_d92da12ef35b30c2",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/index.mjs",
      "role": "read",
      "reason": "Direct import of startMcpServer from src/mcp/server.mjs",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 7,
      "endLine": 7
    },
    {
      "path": "src/index.mjs",
      "role": "edit",
      "reason": "Uses startMcpServer as parameter default and calls it to start the MCP server",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 88,
      "endLine": 93
    },
    {
      "path": "tests/mcp-server.test.mjs",
      "role": "test",
      "reason": "Imports createMcpRequestHandler and buildEntryPointRegexBundle for comprehensive testing",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 7,
      "endLine": 7
    },
    {
      "path": "tests/mcp-server.test.mjs",
      "role": "test",
      "reason": "Example test case calling createMcpRequestHandler (representative of 22 test cases)",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 154,
      "endLine": 154
    },
    {
      "path": "tests/security/redact.test.mjs",
      "role": "test",
      "reason": "Imports createMcpRequestHandler for security/redaction testing",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 9,
      "endLine": 9
    },
    {
      "path": "tests/security/redact.test.mjs",
      "role": "test",
      "reason": "Test case calling createMcpRequestHandler with runtimeOptions",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 167,
      "endLine": 167
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "edit",
      "reason": "Definition of createMcpRequestHandler - main export used across tests and internally",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 587,
      "endLine": 592
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "edit",
      "reason": "Definition of startMcpServer - calls createMcpRequestHandler and used by src/index.mjs",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 1012,
      "endLine": 1026
    }
  ],
  "discoveredPathsCount": 8,
  "evidence": [
    {
      "id": "E1",
      "path": "src/index.mjs",
      "startLine": 7,
      "endLine": 7,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Direct import of startMcpServer from src/mcp/server.mjs",
      "snippet": "7: import { startMcpServer } from './mcp/server.mjs';"
    },
    {
      "id": "E2",
      "path": "src/index.mjs",
      "startLine": 88,
      "endLine": 93,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Uses startMcpServer as parameter default and calls it to start MCP server",
      "snippet": "88:   startServer = startMcpServer,\n89:   sessionStore = globalSessionStore,\n90:   logger = log,\n91:   processRef = process,\n92: } = {}) {\n93:   const transport = startServer({ logger });"
    },
    {
      "id": "E3",
      "path": "tests/mcp-server.test.mjs",
      "startLine": 7,
      "endLine": 7,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Direct import of createMcpRequestHandler and buildEntryPointRegexBundle",
      "snippet": "7: import { createMcpRequestHandler, buildEntryPointRegexBundle } from '../src/mcp/server.mjs';"
    },
    {
      "id": "E4",
      "path": "tests/mcp-server.test.mjs",
      "startLine": 154,
      "endLine": 154,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test case calling createMcpRequestHandler",
      "snippet": "154:     const { handleRequest } = createMcpRequestHandler();"
    },
    {
      "id": "E5",
      "path": "tests/security/redact.test.mjs",
      "startLine": 9,
      "endLine": 9,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Direct import of createMcpRequestHandler",
      "snippet": "9: import { createMcpRequestHandler } from '../../src/mcp/server.mjs';"
    },
    {
      "id": "E6",
      "path": "tests/security/redact.test.mjs",
      "startLine": 167,
      "endLine": 167,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test case calling createMcpRequestHandler with runtimeOptions",
      "snippet": "167:   const { handleRequest } = createMcpRequestHandler({ runtimeOptions: { chatClient } });"
    },
    {
      "id": "E7",
      "path": "src/mcp/server.mjs",
      "startLine": 587,
      "endLine": 592,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition of createMcpRequestHandler function",
      "snippet": "587: export function createMcpRequestHandler({\n588:   logger = () => {},\n589:   runtimeOptions = {},\n590:   sendNotification = null,\n591:   sessionStore = globalSessionStore,\n592: } = {}) {"
    },
    {
      "id": "E8",
      "path": "src/mcp/server.mjs",
      "startLine": 1012,
      "endLine": 1026,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition of startMcpServer that calls createMcpRequestHandler internally",
      "snippet": "1012: export function startMcpServer({ logger = () => {}, runtimeOptions = {} } = {}) {\n1013:   // Use a lazy-binding closure so that sendNotification can reference `transport`\n1014:   // before it is assigned (transport is created after the handler).\n1015:   let transport;\n1016: \n1017:   const { handleRequest, handleNotification } = createMcpRequestHandler({\n1018:     logger,\n1019:     runtimeOptions,\n1020:     sendNotification: (method, params) => transport?.sendNotification(method, params),\n1021:   });\n1022: \n1023:   transport = new StdioJsonRpcServer({ logger, handleRequest, handleNotification });\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 14,
    "filesRead": 4,
    "grepCalls": 4,
    "symbolCalls": 4,
    "stoppedByBudget": false,
    "elapsedMs": 7858,
    "totalTokens": 68447
  }
}
```
## Case DeepResearch

### Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/DeepResearch",
  "scope": [
    "app/**",
    "main.py",
    "migrations/**"
  ],
  "anchor": "app/main.py",
  "changeType": "refactor",
  "knownSymbols": [
    "create_app"
  ]
}
```

### Response
```json
{
  "directAnswer": "anchor \"app/main.py\" has no direct callers, imports, tests, or configuration references within the codebase. The create_app() function is only called internally (line 27). It likely serves as an external ASGI/WSGI entry point (e.g., uvicorn app.main:app) rather than being imported by other modules.",
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
    "fileCount": 5,
    "warnings": [],
    "summary": "Verified: 2 files read, 6 grep searches, 2 symbol lookups, 8/8 evidence items grounded, cross-verified across 5 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read app/main.py:1-28 before final verification.",
    "target": {
      "path": "app/main.py",
      "role": "read",
      "reason": "Anchor file containing create_app() factory and FastAPI app instance",
      "evidenceRefs": [
        "app/main.py:1-28",
        "app/main.py:12-24",
        "app/main.py:27",
        "E1"
      ],
      "startLine": 1,
      "endLine": 28
    }
  },
  "searchCoverage": {
    "scope": [
      "app/**",
      "main.py",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 2,
    "grepCalls": 6,
    "listDirCalls": 2,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 2 file read(s), 6 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_2fb8d94cbab3effb",
  "session": {
    "id": "sess_2fb8d94cbab3effb",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Anchor file containing create_app() factory and FastAPI app instance",
      "evidenceRefs": [
        "app/main.py:1-28",
        "app/main.py:12-24",
        "app/main.py:27",
        "E1"
      ],
      "startLine": 1,
      "endLine": 28
    },
    {
      "path": "app/api/claims.py",
      "role": "read",
      "reason": "Dependency of app/main.py - claims router imported",
      "evidenceRefs": [
        "app/main.py:5",
        "E5"
      ],
      "startLine": 7,
      "endLine": 8
    },
    {
      "path": "app/api/plans.py",
      "role": "read",
      "reason": "Dependency of app/main.py - plans router imported",
      "evidenceRefs": [
        "app/main.py:5",
        "E6"
      ],
      "startLine": 7,
      "endLine": 8
    },
    {
      "path": "app/api/sources.py",
      "role": "read",
      "reason": "Dependency of app/main.py - sources router imported",
      "evidenceRefs": [
        "app/main.py:5",
        "E7"
      ],
      "startLine": 8,
      "endLine": 9
    },
    {
      "path": "app/api/tasks.py",
      "role": "read",
      "reason": "Dependency of app/main.py - tasks router imported",
      "evidenceRefs": [
        "app/main.py:5",
        "E8"
      ],
      "startLine": 12,
      "endLine": 14
    },
    {
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "role": "read",
      "reason": "create_app() definition - the main factory function that configures and returns FastAPI app",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "app/main.py",
      "startLine": 27,
      "endLine": 27,
      "role": "read",
      "reason": "Only call site of create_app() within the codebase - module-level instantiation",
      "evidenceRefs": [
        "E3"
      ]
    },
    {
      "path": "app/main.py",
      "startLine": 5,
      "endLine": 9,
      "role": "read",
      "reason": "Outgoing dependencies from app/main.py to routers and core modules",
      "evidenceRefs": [
        "E4"
      ]
    }
  ],
  "discoveredPathsCount": 51,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Anchor file containing create_app() factory function (lines 12-24) and app instantiation (line 27). Imports 4 routers and 3 core modules.",
      "snippet": "1: from __future__ import annotations\n2: \n3: from fastapi import FastAPI\n4: \n5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app\n10: \n11: \n12: def create_app() -> FastAPI:\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "create_app() definition - the main factory function that configures and returns FastAPI app",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "app/main.py",
      "startLine": 27,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Only call site of create_app() within the codebase - module-level instantiation",
      "snippet": "27: app = create_app()"
    },
    {
      "id": "E4",
      "path": "app/main.py",
      "startLine": 5,
      "endLine": 9,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Outgoing dependencies from app/main.py to routers and core modules",
      "snippet": "5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app"
    },
    {
      "id": "E5",
      "path": "app/api/claims.py",
      "startLine": 7,
      "endLine": 8,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Claims router - one of 4 routers imported by app/main.py",
      "snippet": "7: from app.api.errors import ApiError\n8: from app.services.claim_service import get_claim_evidence"
    },
    {
      "id": "E6",
      "path": "app/api/plans.py",
      "startLine": 7,
      "endLine": 8,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Plans router - one of 4 routers imported by app/main.py",
      "snippet": "7: from app.api.errors import ApiError\n8: from app.services.task_service import approve_task_plan, serialize_task"
    },
    {
      "id": "E7",
      "path": "app/api/sources.py",
      "startLine": 8,
      "endLine": 9,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Sources router - one of 4 routers imported by app/main.py",
      "snippet": "8: from app.api.errors import ApiError\n9: from app.services.source_registry import ("
    },
    {
      "id": "E8",
      "path": "app/api/tasks.py",
      "startLine": 12,
      "endLine": 14,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tasks router - one of 4 routers imported by app/main.py",
      "snippet": "12: from app.api.errors import ApiError\n13: from app.services.cost_service import aggregate_task_cost\n14: from app.services.task_service import ("
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 7,
    "toolCalls": 22,
    "filesRead": 2,
    "grepCalls": 6,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 8256,
    "totalTokens": 54668
  }
}
```
## Case aicc_manage

### Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/aicc_manage",
  "scope": [
    "src/**",
    "websocket-server/src/**",
    "lambda/**",
    "prisma/**",
    "scripts/**"
  ],
  "anchor": "websocket-server/src/middleware/auth.ts",
  "changeType": "refactor",
  "knownSymbols": [
    "authMiddleware"
  ]
}
```

### Response
```json
{
  "directAnswer": "Traced complete dependency chain for websocket-server/src/middleware/auth.ts. The authMiddleware function is directly used only in websocket-server/src/index.ts (line 146) as a Socket.IO middleware. However, its output (socket.data with userId, companyId, name, role) is deeply used across the websocket server infrastructure. No dedicated test files exist for the websocket auth middleware itself.",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 7,
    "partialCount": 1,
    "droppedCount": 0,
    "fileCount": 6,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 9 files read, 7 grep searches, 1 symbol lookups, 7/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read websocket-server/src/index.ts:146-146 before editing.",
    "target": {
      "path": "websocket-server/src/index.ts",
      "role": "edit",
      "reason": "Direct caller - registers authMiddleware with Socket.IO server",
      "evidenceRefs": [
        "e1",
        "E2"
      ],
      "startLine": 146,
      "endLine": 146
    }
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "websocket-server/src/**",
      "lambda/**",
      "prisma/**",
      "scripts/**"
    ],
    "scopeLimited": true,
    "filesRead": 9,
    "grepCalls": 7,
    "listDirCalls": 2,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 9 file read(s), 7 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_8e342b965e8046e4",
  "session": {
    "id": "sess_8e342b965e8046e4",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "read",
      "reason": "Anchor file - authMiddleware function definition",
      "evidenceRefs": [
        "e0",
        "E1"
      ],
      "startLine": 51,
      "endLine": 121
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "edit",
      "reason": "Direct caller - registers authMiddleware with Socket.IO server",
      "evidenceRefs": [
        "e1",
        "E2"
      ],
      "startLine": 146,
      "endLine": 146
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "read",
      "reason": "Uses socket.data fields populated by authMiddleware for logging and rooms",
      "evidenceRefs": [
        "e2",
        "E3"
      ],
      "startLine": 149,
      "endLine": 184
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "read",
      "reason": "Destructures userId, companyId, name, role from socket.data",
      "evidenceRefs": [
        "e3",
        "E4"
      ],
      "startLine": 46,
      "endLine": 46
    },
    {
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "role": "read",
      "reason": "Uses socket.data.userId for notification read tracking",
      "evidenceRefs": [
        "e4"
      ],
      "startLine": 18,
      "endLine": 28
    },
    {
      "path": "websocket-server/src/middleware/security.ts",
      "role": "read",
      "reason": "Uses socket.data.userId for rate limiting and connection checks",
      "evidenceRefs": [
        "e5",
        "E6"
      ],
      "startLine": 91,
      "endLine": 111
    },
    {
      "path": "src/lib/auth/api-route-access.test.ts",
      "role": "test",
      "reason": "Only test file that manipulates JWT_SECRET for auth behavior",
      "evidenceRefs": [
        "e6",
        "E8"
      ],
      "startLine": 170,
      "endLine": 179
    },
    {
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "startLine": 21,
      "endLine": 26,
      "role": "read",
      "reason": "Uses socket.data.userId for notification read tracking",
      "evidenceRefs": [
        "E5"
      ]
    }
  ],
  "discoveredPathsCount": 59,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "authMiddleware function definition - validates JWT tokens and populates socket.data",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/index.ts",
      "startLine": 146,
      "endLine": 146,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Direct usage - io.use(authMiddleware) registers it as Socket.IO middleware",
      "snippet": "146: io.use(authMiddleware)"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/index.ts",
      "startLine": 149,
      "endLine": 184,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Uses all socket.data fields (userId, companyId, name, role) for logging and rooms",
      "snippet": "149: io.on('connection', (socket) => {\n150:   console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`)\n151:   console.log(`  User: ${socket.data.userId}, Company: ${socket.data.companyId}`)\n152: \n153:   // 동시 연결 수 제한 확인\n154:   if (!checkConnectionLimit(io, socket)) return\n155: \n156:   // 접속자 추적에 추가\n157:   onlineUsers.set(socket.id, {\n158:     userId: socket.data.userId,\n159:     companyId: socket.data.companyId,\n160:     name: socket.data.name,\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 46,
      "endLine": 46,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Destructures userId, companyId, name, role from socket.data for chat management",
      "snippet": "46:   const { userId, companyId, name, role } = socket.data"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "startLine": 21,
      "endLine": 26,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Uses socket.data.userId for notification read tracking",
      "snippet": "21:     console.log(`[Notification] Read: ${data.notificationId} by ${socket.data.userId}`)\n22:   })\n23: \n24:   // 모든 알림 읽음\n25:   socket.on('notifications-read-all', () => {\n26:     console.log(`[Notification] All read by ${socket.data.userId}`)"
    },
    {
      "id": "E6",
      "path": "websocket-server/src/middleware/security.ts",
      "startLine": 91,
      "endLine": 111,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Uses socket.data.userId for rate limit warnings and connection enforcement",
      "snippet": "91:       console.warn(`[Security] Socket rate limit exceeded: ${socket.id} (user: ${socket.data.userId}, event: ${eventName}, count: ${entry.count})`)\n92:       entry.warned = true\n93:     }\n94:     return false\n95:   }\n96: \n97:   return true\n98: }\n99: \n100: // ============================================================\n101: // 3. 동시 연결 수 제한\n102: // ============================================================\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Configuration requirement - JWT_SECRET environment variable must be set",
      "snippet": "24: const JWT_SECRET: string = (() => {\n25:   const secret = process.env.JWT_SECRET\n26:   if (!secret) throw new Error('JWT_SECRET must be set')\n27:   return secret\n28: })()"
    },
    {
      "id": "E8",
      "path": "src/lib/auth/api-route-access.test.ts",
      "startLine": 170,
      "endLine": 179,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Test coverage for JWT_SECRET handling - only test file related to JWT auth",
      "snippet": "170:   const originalJwtSecret = process.env.JWT_SECRET\n171:   t.after(() => {\n172:     if (originalJwtSecret === undefined) {\n173:       delete process.env.JWT_SECRET\n174:       return\n175:     }\n176:     process.env.JWT_SECRET = originalJwtSecret\n177:   })\n178: \n179:   process.env.JWT_SECRET = 'test-secret'"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) are grounded only by grep, blame, or nearby line observations.",
    "No dedicated test files found specifically testing websocket-server auth middleware",
    "WebSocket server appears to be embedded in main monorepo (no separate package.json found)"
  ],
  "stats": {
    "turns": 14,
    "toolCalls": 28,
    "filesRead": 9,
    "grepCalls": 7,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 14063,
    "totalTokens": 182182
  }
}
```
## Case bible

### Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "anchor": "src/store.tsx",
  "changeType": "refactor",
  "knownSymbols": [
    "useStore"
  ]
}
```

### Response
```json
{
  "directAnswer": "Traced dependency chain from src/store.tsx: 31 direct importers across shared, bookmark, exam, reader, search, and settings features. 2 type-only importers (store.selectors.ts, auth.ts). 1 documentation reference (AGENTS.md). No test coverage or configuration references found. Store uses Zustand with localStorage persistence (key: 'bible-app-storage').",
  "status": {
    "confidence": "medium",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "Model confidence was capped from high to medium.",
      "7 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "medium",
    "exactCount": 1,
    "partialCount": 7,
    "droppedCount": 0,
    "fileCount": 8,
    "warnings": [
      "Model confidence was capped from high to medium.",
      "7 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 1 files read, 3 grep searches, 2 symbol lookups, 1/8 evidence items grounded, cross-verified across 8 files. Evidence partially verified — results are reliable for most uses."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/store.selectors.ts:1-166 before editing.",
    "target": {
      "path": "src/store.selectors.ts",
      "role": "edit",
      "reason": "Type-only importer: 15+ selectors using AppStore type",
      "evidenceRefs": [
        "ev8",
        "E8"
      ],
      "startLine": 1,
      "endLine": 166
    }
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "functions/**",
      "scripts/**",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 1,
    "grepCalls": 3,
    "listDirCalls": 1,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 1 file read(s), 3 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_cd7fbe5e8ff206b3",
  "session": {
    "id": "sess_cd7fbe5e8ff206b3",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "read",
      "reason": "Anchor file: defines useStore with Zustand persistence config",
      "evidenceRefs": [
        "ev1"
      ],
      "startLine": 1,
      "endLine": 59
    },
    {
      "path": "src/store.selectors.ts",
      "role": "edit",
      "reason": "Type-only importer: 15+ selectors using AppStore type",
      "evidenceRefs": [
        "ev8",
        "E8"
      ],
      "startLine": 1,
      "endLine": 166
    },
    {
      "path": "src/shared/hooks/useAuthSessionBootstrap.ts",
      "role": "edit",
      "reason": "Direct importer: uses useStore for auth session bootstrap",
      "evidenceRefs": [
        "ev2",
        "E2"
      ],
      "startLine": 6,
      "endLine": 22
    },
    {
      "path": "src/shared/hooks/useCopyActions.tsx",
      "role": "edit",
      "reason": "Direct importer: uses useStore for language settings",
      "evidenceRefs": [
        "ev3",
        "E3"
      ],
      "startLine": 6,
      "endLine": 45
    },
    {
      "path": "src/features/bookmark/pages/BookmarksPage.tsx",
      "role": "edit",
      "reason": "Direct importer: uses useStore for passage state",
      "evidenceRefs": [
        "ev4",
        "E4"
      ],
      "startLine": 16,
      "endLine": 40
    },
    {
      "path": "src/features/exam/pages/ExamPracticePage.tsx",
      "role": "edit",
      "reason": "Direct importer: uses useStore for exam auth state",
      "evidenceRefs": [
        "ev5",
        "E5"
      ],
      "startLine": 21,
      "endLine": 42
    },
    {
      "path": "src/features/reader/hooks/useReaderController.ts",
      "role": "edit",
      "reason": "Direct importer: uses useStore for reader controller",
      "evidenceRefs": [
        "ev6",
        "E6"
      ],
      "startLine": 6,
      "endLine": 51
    },
    {
      "path": "src/features/search/hooks/useSearchV4.tsx",
      "role": "edit",
      "reason": "Direct importer: uses useStore for search v4 state",
      "evidenceRefs": [
        "ev7",
        "E7"
      ],
      "startLine": 6,
      "endLine": 41
    }
  ],
  "discoveredPathsCount": 38,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 40,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition of useStore export with Zustand persistence config",
      "snippet": "30: export const useStore = create<AppStore>()(\n31:   persist(\n32:     (set, get, api) => ({\n33:       settings: INITIAL_SETTINGS,\n34:       currents: INITIAL_CURRENTS,\n35:       globals: INITIAL_GLOBALS,\n36:       search: INITIAL_SEARCH,\n37:       ui: INITIAL_UI,\n38:       auth: INITIAL_AUTH,\n39:       ...createStoreActions(set, get, api),\n40:     }),"
    },
    {
      "id": "E2",
      "path": "src/shared/hooks/useAuthSessionBootstrap.ts",
      "startLine": 6,
      "endLine": 22,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for auth bootstrap",
      "snippet": "6: import { useStore } from \"@/store\";\n7: \n8: const isIgnorableSessionRestoreError = (error: unknown): boolean => {\n9:   if (error instanceof DOMException && error.name === \"AbortError\") {\n10:     return true;\n11:   }\n12: \n13:   if (error instanceof TypeError) {\n14:     const message = error.message.toLowerCase();\n15:     return message.includes(\"failed to fetch\") || message.includes(\"networkerror\");\n16:   }\n17: \n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/shared/hooks/useCopyActions.tsx",
      "startLine": 6,
      "endLine": 45,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for language settings",
      "snippet": "6: import { useStore } from \"@/store\";\n7: import { copyToClipboard } from \"../utils/copy\";\n8: import {\n9:   createCopyTextType01,\n10:   createCopyTextType02,\n11:   verseNumbersToTextType01,\n12: } from \"../utils/text\";\n13: import type { BibleWordDataV3 } from \"@/features/reader/types/word.types\";\n14: \n15: type SelectableWord = BibleWordDataV3 & { line: string | number };\n16: \n17: interface UseCopyActionsParams {\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/features/bookmark/pages/BookmarksPage.tsx",
      "startLine": 16,
      "endLine": 40,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for passage state",
      "snippet": "16: import { useStore } from \"@/store\";\n17: import type { BookmarkDraft, BookmarkRecord } from \"../types/bookmark\";\n18: import { deleteBookmark, loadBookmarkDraft, loadBookmarks } from \"../utils/database\";\n19: import { useBookmarkSync } from \"../hooks/useBookmarkSync\";\n20: import {\n21:   countBookmarkDraftPassageBlocks,\n22:   countBookmarkNoteBlocks,\n23:   countBookmarkPassageBlocks,\n24:   getBookmarkDefaultTitle,\n25:   getBookmarkFirstNotePreview,\n26:   getBookmarkFirstPassageAddress,\n27:   getBookmarkPrimaryReferenceLabel,\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/features/exam/pages/ExamPracticePage.tsx",
      "startLine": 21,
      "endLine": 42,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for exam auth state",
      "snippet": "21: import { useStore } from \"@/store\";\n22: import { appendExamWrongNote } from \"../utils/database\";\n23: import { useExamVerseLoader } from \"../hooks/useExamVerseLoader\";\n24: import {\n25:   normalizeText,\n26:   getSmallMistakeChars,\n27:   tokenizeKo,\n28: } from \"../utils/examTextProcessing\";\n29: import { recordExamAttempt } from \"../utils/examPersistence\";\n30: import { makeClozePrompt, getInitials } from \"../utils/practiceTextUtils\";\n31: import type {\n32:   BookMeta,\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/features/reader/hooks/useReaderController.ts",
      "startLine": 6,
      "endLine": 51,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for reader controller",
      "snippet": "6: import { useStore } from \"@/store\";\n7: import { selectReaderControllerState } from \"@/store.selectors\";\n8: import { useMobileDetect } from \"@/shared/utils/device\";\n9: import { useBibleData } from \"./useBibleData\";\n10: import { useBookmarkActions } from \"@/features/bookmark/hooks/useBookmarkActions\";\n11: import { useChapterProgress } from \"./useChapterProgress\";\n12: import { useCopyActions } from \"@/shared/hooks/useCopyActions\";\n13: import { useDialogLink } from \"@/shared/hooks/useDialogLink\";\n14: import { useMainShortcuts } from \"@/shared/hooks/useMainShortcuts\";\n15: import { useReaderEffects } from \"./useReaderEffects\";\n16: import { useSearchMatchNavigation } from \"./useSearchMatchNavigation\";\n17: import { useReaderUiControls } from \"./useReaderUiControls\";\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/features/search/hooks/useSearchV4.tsx",
      "startLine": 6,
      "endLine": 41,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for search v4 state",
      "snippet": "6: import { useStore } from \"@/store\";\n7: import { selectSearchV4State } from \"@/store.selectors\";\n8: import type { BibleBook } from \"@/shared/types/bible\";\n9: import type {\n10:   FlexSearchRawDoc,\n11:   SearchResultDoc,\n12:   SearchResultGroup,\n13:   SearchResultItem,\n14: } from \"../types/search\";\n15: import { parseSearchRawDoc } from \"../utils/searchParsing\";\n16: \n17: interface FlexSearchDocumentLike {\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/store.selectors.ts",
      "startLine": 1,
      "endLine": 166,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Type import from store with 15+ selectors using AppStore",
      "snippet": "1: import type { StoreActions, StoreState } from \"./store\";\n2: \n3: type AppStore = StoreState & StoreActions;\n4: \n5: export const selectReaderSettings = (state: AppStore) => ({\n6:   language: state.settings.language,\n7:   secondaryLanguage: state.settings.secondaryLanguage,\n8:   viewWithSecondaryLanguage: state.settings.viewWithSecondaryLanguage,\n9:   copyType: state.settings.copyType,\n10:   searchType: state.settings.searchType,\n11:   searchVersion: state.settings.searchVersion,\n12:   fontSize: state.settings.fontSize,\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "Model confidence was capped from high to medium.",
    "7 evidence item(s) are grounded only by grep, blame, or nearby line observations.",
    "Persistence key 'bible-app-storage' in localStorage - migration strategy needed if format changes",
    "No automated tests increase refactoring risk"
  ],
  "stats": {
    "turns": 7,
    "toolCalls": 14,
    "filesRead": 1,
    "grepCalls": 3,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 9770,
    "totalTokens": 87694
  }
}
```
## Case studious-memory

### Request
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
  "anchor": "backend/mcp_server.py",
  "changeType": "refactor",
  "knownSymbols": [
    "scoped_tool"
  ]
}
```

### Response
```json
{
  "directAnswer": "Traced dependency chain for backend/mcp_server.py. Anchor resolves to two files: entry point (backend/mcp_server.py, 41 lines) and implementation (backend/app/mcp/server.py, 947 lines). Found 4 direct importers, 14 test files, configuration with 25+ MCP settings, and 2 script dependencies.",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 7,
    "partialCount": 1,
    "droppedCount": 0,
    "fileCount": 7,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 10 files read, 6 grep searches, 3 symbol lookups, 7/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read backend/mcp_server.py:1-41 before final verification.",
    "target": {
      "path": "backend/mcp_server.py",
      "role": "read",
      "reason": "Stdio transport entry point that imports and runs mcp with stdio transport",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 41
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
    "filesRead": 10,
    "grepCalls": 6,
    "listDirCalls": 0,
    "symbolCalls": 3,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 10 file read(s), 6 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_cbf020d1de6951a7",
  "session": {
    "id": "sess_cbf020d1de6951a7",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/mcp_server.py",
      "role": "read",
      "reason": "Stdio transport entry point that imports and runs mcp with stdio transport",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 41
    },
    {
      "path": "backend/main.py",
      "role": "read",
      "reason": "FastAPI main app imports mcp from app.mcp.server",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 42,
      "endLine": 42
    },
    {
      "path": "backend/tests/auth/test_mcp_scope_enforcement.py",
      "role": "test",
      "reason": "Primary test file imports server and tests orchestrate_input, tool functions",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 213
    },
    {
      "path": "backend/tests/mcp/test_mcp_stdio_smoke.py",
      "role": "test",
      "reason": "Stdio lifecycle test runs mcp_server.py as subprocess",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 88
    },
    {
      "path": "backend/app/config.py",
      "role": "config",
      "reason": "Defines 25+ MCP_* settings for auth modes, OAuth, and connection limits",
      "evidenceRefs": [],
      "startLine": 231,
      "endLine": 434
    },
    {
      "path": "scripts/generate_contract_snapshot.py",
      "role": "read",
      "reason": "Script references scoped_tool decorator for AST analysis",
      "evidenceRefs": [],
      "startLine": 160,
      "endLine": 175
    },
    {
      "path": "scripts/idea_run_mcp.sh",
      "role": "read",
      "reason": "Shell script executes mcp_server.py entry point",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 18,
      "endLine": 18
    },
    {
      "path": "backend/mcp_server.py",
      "startLine": 32,
      "endLine": 40,
      "role": "read",
      "reason": "Entry point imports mcp from app.mcp.server and runs with stdio transport",
      "evidenceRefs": [
        "E1"
      ]
    }
  ],
  "discoveredPathsCount": 35,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/mcp_server.py",
      "startLine": 32,
      "endLine": 40,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Entry point imports mcp from app.mcp.server and runs with stdio transport",
      "snippet": "32:     from app.mcp.server import mcp\n33: \n34:     set_mcp_owner_id(settings.DEFAULT_OWNER_ID)\n35:     set_mcp_auth_context(\n36:         auth_type=\"stdio\",\n37:         scopes=list(SUPPORTED_MCP_OAUTH_SCOPES),\n38:         subject=\"local-stdio\",\n39:     )\n40:     mcp.run(transport=\"stdio\")"
    },
    {
      "id": "E2",
      "path": "backend/main.py",
      "startLine": 42,
      "endLine": 42,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FastAPI main app imports mcp from app.mcp.server",
      "snippet": "42: from app.mcp.server import mcp"
    },
    {
      "id": "E3",
      "path": "backend/tests/auth/test_mcp_scope_enforcement.py",
      "startLine": 8,
      "endLine": 8,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test file imports server as mcp_server",
      "snippet": "8: from app.mcp import server as mcp_server"
    },
    {
      "id": "E4",
      "path": "backend/tests/auth/test_mcp_scope_enforcement.py",
      "startLine": 84,
      "endLine": 84,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test calls mcp_server.orchestrate_input()",
      "snippet": "84:         asyncio.run(mcp_server.orchestrate_input(text=\"내일 오전 9시에 약 복용 알려줘\", execute=True))"
    },
    {
      "id": "E5",
      "path": "backend/tests/mcp/test_mcp_stdio_smoke.py",
      "startLine": 32,
      "endLine": 32,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test runs mcp_server.py as subprocess",
      "snippet": "32:         args=[\"mcp_server.py\"],"
    },
    {
      "id": "E6",
      "path": "backend/app/config.py",
      "startLine": 231,
      "endLine": 293,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Config defines MCP_ALLOW_QUERY_KEY, MCP_PUBLIC_AUTH_MODE, MCP_OAUTH_*, MCP_MAX_*",
      "snippet": "231:     MCP_ALLOW_QUERY_KEY: bool = False  # allow ?studious-api-key= on MCP paths (dev only)\n232:     MCP_ALLOW_QUERY_KEY_UNSAFE_OVERRIDE: bool = False\n233:     MCP_PUBLIC_AUTH_MODE: str = \"api_key\"  # api_key, oauth, or dual\n234:     MCP_ALLOW_API_KEY_AUTH: bool = True\n235:     MCP_OAUTH_RESOURCE: str = \"\"\n236:     MCP_OAUTH_AUTHORIZATION_SERVERS: str = \"\"\n237:     MCP_OAUTH_ISSUER: str = \"\"\n238:     MCP_OAUTH_AUDIENCE: str = \"\"\n239:     MCP_OAUTH_JWKS_URL: str = \"\"\n240:     MCP_OAUTH_ALLOWED_SUBJECTS: str = \"\"\n241:     MCP_OAUTH_OWNER_ID: str = \"\"\n242:     MCP_OAUTH_ACCESS_PROFILE: str = \"\"\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "scripts/generate_contract_snapshot.py",
      "startLine": 166,
      "endLine": 166,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Script references scoped_tool decorator for AST analysis",
      "snippet": "166:             if isinstance(func, ast.Name) and func.id == \"scoped_tool\":"
    },
    {
      "id": "E8",
      "path": "scripts/idea_run_mcp.sh",
      "startLine": 18,
      "endLine": 18,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shell script executes mcp_server.py entry point",
      "snippet": "18: exec uv run --frozen python mcp_server.py"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 21,
    "filesRead": 10,
    "grepCalls": 6,
    "symbolCalls": 3,
    "stoppedByBudget": false,
    "elapsedMs": 10791,
    "totalTokens": 108617
  }
}
```
