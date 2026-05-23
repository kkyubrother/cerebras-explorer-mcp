# Code-blind evaluator packet: trace_symbol

You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.

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
  "symbol": "createMcpRequestHandler"
}
```

### Response
```json
{
  "directAnswer": "createMcpRequestHandler is an exported function in src/mcp/server.mjs (lines 587-1010) that creates a Model Context Protocol (MCP) request handler. It returns { handleRequest, handleNotification } - two async functions that handle JSON-RPC requests and notifications for repository exploration tools. Parameters: logger (function), runtimeOptions (object), sendNotification (callback), sessionStore (defaults to globalSessionStore). Used 22 times: 21 in tests, once in src/mcp/server.mjs:1017.",
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
    "exactCount": 4,
    "partialCount": 1,
    "droppedCount": 0,
    "fileCount": 1,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 6 files read, 1 symbol lookups, 4/5 evidence items grounded. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "tests/**",
      "examples/**"
    ],
    "scopeLimited": true,
    "filesRead": 6,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 6 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_f6a51473a852d59b",
  "session": {
    "id": "sess_f6a51473a852d59b",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "Complete function definition with parameters, helpers, and return statement",
      "evidenceRefs": [],
      "startLine": 587,
      "endLine": 1010
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Return statement showing exported handlers",
      "evidenceRefs": [],
      "startLine": 1009,
      "endLine": 1009
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "Production usage creating handlers with options",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 1017,
      "endLine": 1020
    },
    {
      "path": "src/mcp/server.mjs",
      "startLine": 587,
      "endLine": 592,
      "role": "read",
      "reason": "Function signature with all parameters and default values",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "src/mcp/server.mjs",
      "startLine": 834,
      "endLine": 860,
      "role": "read",
      "reason": "handleRequest routing initialize, ping, tools/list, tools/call",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "src/mcp/server.mjs",
      "startLine": 990,
      "endLine": 1007,
      "role": "read",
      "reason": "handleNotification processing initialized/cancelled notifications",
      "evidenceRefs": [
        "E3"
      ]
    },
    {
      "path": "src/mcp/server.mjs",
      "startLine": 1009,
      "endLine": 1010,
      "role": "read",
      "reason": "Return statement exporting handleRequest and handleNotification",
      "evidenceRefs": [
        "E4"
      ]
    }
  ],
  "discoveredPathsCount": 2,
  "evidence": [
    {
      "id": "E1",
      "path": "src/mcp/server.mjs",
      "startLine": 587,
      "endLine": 592,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Function signature with all parameters and default values",
      "snippet": "587: export function createMcpRequestHandler({\n588:   logger = () => {},\n589:   runtimeOptions = {},\n590:   sendNotification = null,\n591:   sessionStore = globalSessionStore,\n592: } = {}) {"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 834,
      "endLine": 860,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "handleRequest routing initialize, ping, tools/list, tools/call",
      "snippet": "834:   async function handleRequest(message) {\n835:     switch (message.method) {\n836:       case 'initialize': {\n837:         const requestedVersion = message.params?.protocolVersion;\n838:         if (typeof requestedVersion === 'string' && requestedVersion.trim()) {\n839:           negotiatedProtocolVersion = requestedVersion;\n840:         }\n841:         const toolCount = buildToolList().length;\n842:         return {\n843:           protocolVersion: negotiatedProtocolVersion,\n844:           capabilities: { tools: { listChanged: false } },\n845:           serverInfo: SERVER_INFO,\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/mcp/server.mjs",
      "startLine": 990,
      "endLine": 1007,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "handleNotification processing initialized/cancelled notifications",
      "snippet": "990:   async function handleNotification(message) {\n991:     if (message.method === 'notifications/initialized') {\n992:       return;\n993:     }\n994:     if (message.method === 'notifications/cancelled') {\n995:       const requestId = message.params?.requestId;\n996:       if (requestId) {\n997:         const controller = activeAbortControllers.get(requestId);\n998:         if (controller) {\n999:           controller.abort();\n1000:           activeAbortControllers.delete(requestId);\n1001:           logger(`Cancelled exploration for request ${requestId}`);\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/mcp/server.mjs",
      "startLine": 1009,
      "endLine": 1010,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Return statement exporting handleRequest and handleNotification",
      "snippet": "1009:   return { handleRequest, handleNotification };\n1010: }"
    },
    {
      "id": "E5",
      "path": "src/mcp/server.mjs",
      "startLine": 1017,
      "endLine": 1020,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Production call passing logger, runtimeOptions, sendNotification",
      "snippet": "1017:   const { handleRequest, handleNotification } = createMcpRequestHandler({\n1018:     logger,\n1019:     runtimeOptions,\n1020:     sendNotification: (method, params) => transport?.sendNotification(method, params),"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 8,
    "toolCalls": 7,
    "filesRead": 6,
    "grepCalls": 0,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 7816,
    "totalTokens": 80652
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
  "symbol": "create_app"
}
```

### Response
```json
{
  "directAnswer": "create_app is a factory function defined in app/main.py (line 12) that creates and configures a FastAPI application. It takes no parameters and returns a FastAPI instance. The function initializes the app by loading settings, configuring logging and telemetry, creating the FastAPI app with title 'DeepResearch Demo Alpha API', registering error handlers, including four routers (tasks, plans, claims, sources), instrumenting for telemetry, and returning the configured app. It is called once at line 27 to create the module-level app variable.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 3,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 1,
    "warnings": [],
    "summary": "Verified: 2 files read, 1 grep searches, 1 symbol lookups, 3/3 evidence items grounded. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "app/**",
      "main.py",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 2,
    "grepCalls": 1,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 2 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_977ebcc76ecea8d5",
  "session": {
    "id": "sess_977ebcc76ecea8d5",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Contains the create_app function definition with its complete implementation",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 12,
      "endLine": 24
    },
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Shows where create_app is called to create the module-level app variable",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 27,
      "endLine": 27
    },
    {
      "path": "app/main.py",
      "role": "context",
      "reason": "Shows imports used by create_app function",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 1,
      "endLine": 10
    }
  ],
  "discoveredPathsCount": 2,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition of create_app function showing its signature, return type, and complete implementation",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/main.py",
      "startLine": 27,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Usage of create_app to create the app instance",
      "snippet": "27: app = create_app()"
    },
    {
      "id": "E3",
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 10,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Import statements showing dependencies used in create_app",
      "snippet": "1: from __future__ import annotations\n2: \n3: from fastapi import FastAPI\n4: \n5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app\n10: "
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 5,
    "toolCalls": 4,
    "filesRead": 2,
    "grepCalls": 1,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 4606,
    "totalTokens": 27366
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
  "symbol": "authMiddleware"
}
```

### Response
```json
{
  "directAnswer": "authMiddleware is a Socket.IO authentication middleware defined in websocket-server/src/middleware/auth.ts (lines 51-121). It validates JWT tokens and implements brute-force protection by blocking IPs after 10 failed attempts for 5 minutes. Extracts token from socket.handshake.auth.token or Authorization header, verifies with JWT_SECRET, validates payload contains userId and companyId, attaches user info to socket.data. Parameters: socket: Socket, next: (err?: Error) => void. Returns void. Used in websocket-server/src/index.ts line 146 as io.use(authMiddleware).",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 5,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 2,
    "warnings": [],
    "summary": "Verified: 2 files read, 1 grep searches, 1 symbol lookups, 5/5 evidence items grounded, cross-verified across 2 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
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
    "filesRead": 2,
    "grepCalls": 1,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 2 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_fa5e12b403baa5ae",
  "session": {
    "id": "sess_fa5e12b403baa5ae",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "read",
      "reason": "Definition of authMiddleware function with implementation",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 51,
      "endLine": 121
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "Imports, TokenPayload interface, JWT_SECRET, and constants",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 33
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "Helper function recordFailure for tracking auth failures",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 123,
      "endLine": 131
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "context",
      "reason": "Where authMiddleware is applied as Socket.IO middleware",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 146,
      "endLine": 146
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 1,
      "endLine": 12,
      "role": "read",
      "reason": "Imports and TokenPayload interface used by authMiddleware",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 33,
      "role": "read",
      "reason": "JWT_SECRET retrieval and brute force protection constants",
      "evidenceRefs": [
        "E3"
      ]
    }
  ],
  "discoveredPathsCount": 2,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Complete authMiddleware implementation with brute force protection",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 1,
      "endLine": 12,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Imports and TokenPayload interface used by authMiddleware",
      "snippet": "1: import { Socket } from 'socket.io'\n2: import jwt from 'jsonwebtoken'\n3: import { logger } from '../lib/logger'\n4: \n5: interface TokenPayload {\n6:   userId: string\n7:   companyId: string\n8:   role: string\n9:   name: string\n10:   iat?: number\n11:   exp?: number\n12: }"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 33,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT_SECRET retrieval and brute force protection constants",
      "snippet": "24: const JWT_SECRET: string = (() => {\n25:   const secret = process.env.JWT_SECRET\n26:   if (!secret) throw new Error('JWT_SECRET must be set')\n27:   return secret\n28: })()\n29: \n30: // 인증 실패 추적 (IP별 실패 횟수)\n31: const authFailures = new Map<string, { count: number; lastAttempt: number }>()\n32: const AUTH_BLOCK_THRESHOLD = 10 // 10회 실패 시 차단\n33: const AUTH_BLOCK_DURATION = 5 * 60_000 // 5분"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 123,
      "endLine": 131,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "recordFailure helper function for tracking auth failures per IP",
      "snippet": "123: function recordFailure(ip: string) {\n124:   const existing = authFailures.get(ip)\n125:   if (existing) {\n126:     existing.count++\n127:     existing.lastAttempt = Date.now()\n128:   } else {\n129:     authFailures.set(ip, { count: 1, lastAttempt: Date.now() })\n130:   }\n131: }"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/index.ts",
      "startLine": 146,
      "endLine": 146,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Where authMiddleware is applied as middleware to Socket.IO server",
      "snippet": "146: io.use(authMiddleware)"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 5,
    "toolCalls": 4,
    "filesRead": 2,
    "grepCalls": 1,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 6451,
    "totalTokens": 38688
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
  "symbol": "useStore"
}
```

### Response
```json
{
  "directAnswer": "useStore is a Zustand state management hook defined at src/store.tsx:30. It creates a global persisted store using Zustand's create() with persist middleware. The store manages app state across 6 slices: settings, currents, globals, search, ui, and auth. Exported as a const with no runtime parameters; returns a hook that accepts selector functions to access specific store parts. Persists only the settings slice to localStorage under key \"bible-app-storage\" and handles font-size rehydration on load.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 3,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 3,
    "warnings": [],
    "summary": "Verified: 3 files read, 1 symbol lookups, 3/3 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "functions/**",
      "scripts/**",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 3,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 3 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_7e27e143cd5e4ff8",
  "session": {
    "id": "sess_7e27e143cd5e4ff8",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "read",
      "reason": "Main definition of useStore with persistence configuration",
      "evidenceRefs": [
        "e0",
        "E1"
      ],
      "startLine": 30,
      "endLine": 58
    },
    {
      "path": "src/store/types.ts",
      "role": "read",
      "reason": "AppStore type definition showing StoreState & StoreActions",
      "evidenceRefs": [
        "e1",
        "E2"
      ],
      "startLine": 106,
      "endLine": 119
    },
    {
      "path": "src/store/createActions.ts",
      "role": "read",
      "reason": "Shows how store actions are composed from slices",
      "evidenceRefs": [
        "e2",
        "E3"
      ],
      "startLine": 10,
      "endLine": 21
    }
  ],
  "discoveredPathsCount": 23,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 58,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition of useStore showing Zustand store with persist middleware, initial state slices, localStorage configuration",
      "snippet": "30: export const useStore = create<AppStore>()(\n31:   persist(\n32:     (set, get, api) => ({\n33:       settings: INITIAL_SETTINGS,\n34:       currents: INITIAL_CURRENTS,\n35:       globals: INITIAL_GLOBALS,\n36:       search: INITIAL_SEARCH,\n37:       ui: INITIAL_UI,\n38:       auth: INITIAL_AUTH,\n39:       ...createStoreActions(set, get, api),\n40:     }),\n41:     {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/store/types.ts",
      "startLine": 106,
      "endLine": 119,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Type definitions showing StoreState contains 6 slices and StoreActions contains mutation methods",
      "snippet": "106: export interface StoreState {\n107:   settings: SettingsState;\n108:   currents: CurrentsState;\n109:   globals: {\n110:     books: BibleBook[];\n111:   };\n112:   search: SearchState;\n113:   ui: UiState;\n114:   auth: AuthState;\n115: }\n116: \n117: export type AppStore = StoreState & StoreActions;\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/store/createActions.ts",
      "startLine": 10,
      "endLine": 21,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows store actions composed from 6 slice creators (settings, currents, globals, search, ui, auth)",
      "snippet": "10: export const createStoreActions: AppStoreSlice<StoreActions> = (\n11:   set,\n12:   get,\n13:   api\n14: ) => ({\n15:   ...createSettingsSlice(set, get, api),\n16:   ...createCurrentsSlice(set, get, api),\n17:   ...createGlobalsSlice(set, get, api),\n18:   ...createSearchSlice(set, get, api),\n19:   ...createUiSlice(set, get, api),\n20:   ...createAuthSlice(set, get, api),\n21: });"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 5,
    "toolCalls": 4,
    "filesRead": 3,
    "grepCalls": 0,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 5150,
    "totalTokens": 38164
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
  "symbol": "scoped_tool"
}
```

### Response
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
