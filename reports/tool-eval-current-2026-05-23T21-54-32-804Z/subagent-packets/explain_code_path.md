# Code-blind evaluator packet: explain_code_path

You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.

## Tool Description
Use for route, middleware, request, event, job, or CLI flow tracing across files. Returns the verified path through the code and the targets worth reading next.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "pathQuery": {
      "type": "string",
      "description": "The runtime path or flow to explain."
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
    "entryPoint": {
      "type": "string"
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
    "pathQuery"
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
  "pathQuery": "tools/call request dispatch from createMcpRequestHandler into wrapper task builders and runtime callTool",
  "entryPoint": "src/mcp/server.mjs",
  "knownFiles": [
    "src/mcp/server.mjs"
  ],
  "knownSymbols": [
    "createMcpRequestHandler"
  ]
}
```

### Response
```json
{
  "directAnswer": "tools/call path: createMcpRequestHandler returns handleRequest (src/mcp/server.mjs:1009). handleRequest switches on message.method; for tools/call (line 861), it validates args via builders like buildFindRelevantCodeArgs (line 359), then calls callTool (line 881). callTool (line 792) invokes exploreRepository (line 796), imported from src/explorer/runtime.mjs (line 2).",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": [
      "2 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 5,
    "partialCount": 2,
    "droppedCount": 0,
    "fileCount": 1,
    "warnings": [
      "2 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 3 files read, 2 grep searches, 1 symbol lookups, 5/7 evidence items grounded. All evidence grounded in inspected code."
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
    "filesRead": 3,
    "grepCalls": 2,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 3 file read(s), 2 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_aca37b59effd6d89",
  "session": {
    "id": "sess_aca37b59effd6d89",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Factory definition: createMcpRequestHandler entry point",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 587,
      "endLine": 592
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Factory returns handleRequest/handleNotification",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1009,
      "endLine": 1009
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "tools/call dispatch: validation, builder, callTool",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 861,
      "endLine": 881
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "callTool wrapper: AbortController, exploreRepository call",
      "evidenceRefs": [],
      "startLine": 792,
      "endLine": 811
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Import of exploreRepository from runtime",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 2,
      "endLine": 2
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "Example builder: buildFindRelevantCodeArgs converts args",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 359,
      "endLine": 373
    },
    {
      "path": "src/mcp/server.mjs",
      "startLine": 792,
      "endLine": 800,
      "role": "read",
      "reason": "callTool invokes exploreRepository with built args",
      "evidenceRefs": [
        "E4"
      ]
    },
    {
      "path": "src/mcp/server.mjs",
      "startLine": 346,
      "endLine": 357,
      "role": "read",
      "reason": "Example builder: buildTraceSymbolArgs",
      "evidenceRefs": [
        "E7"
      ]
    }
  ],
  "discoveredPathsCount": 3,
  "evidence": [
    {
      "id": "E1",
      "path": "src/mcp/server.mjs",
      "startLine": 587,
      "endLine": 592,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Factory definition and entry point",
      "snippet": "587: export function createMcpRequestHandler({\n588:   logger = () => {},\n589:   runtimeOptions = {},\n590:   sendNotification = null,\n591:   sessionStore = globalSessionStore,\n592: } = {}) {"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 1009,
      "endLine": 1009,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Factory returns handleRequest/handleNotification",
      "snippet": "1009:   return { handleRequest, handleNotification };"
    },
    {
      "id": "E3",
      "path": "src/mcp/server.mjs",
      "startLine": 861,
      "endLine": 881,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "tools/call dispatch: validation, builder, callTool",
      "snippet": "861:       case 'tools/call': {\n862:         const name = message.params?.name;\n863:         const args = message.params?.arguments ?? {};\n864:         const progressToken = message.params?._meta?.progressToken ?? null;\n865:         const requestId = message.id ?? null;\n866:         const exposedToolNames = new Set(buildToolList().map(tool => tool.name));\n867: \n868:         try {\n869:           if (!exposedToolNames.has(name)) {\n870:             const error = new Error(`Unknown tool: ${name}`);\n871:             error.code = -32601;\n872:             throw error;\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/mcp/server.mjs",
      "startLine": 792,
      "endLine": 800,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "callTool invokes exploreRepository with built args",
      "snippet": "792:   async function callTool(exploreArgs, progressToken, requestId) {\n793:     const abortController = new AbortController();\n794:     if (requestId) activeAbortControllers.set(requestId, abortController);\n795:     try {\n796:       const result = await exploreRepository(exploreArgs, {\n797:         logger,\n798:         ...runtimeOptions,\n799:         onProgress: makeProgressCallback(progressToken),\n800:         sessionStore,"
    },
    {
      "id": "E5",
      "path": "src/mcp/server.mjs",
      "startLine": 2,
      "endLine": 2,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Import of exploreRepository from runtime",
      "snippet": "2: import { exploreRepository, freeExploreRepository } from '../explorer/runtime.mjs';"
    },
    {
      "id": "E6",
      "path": "src/mcp/server.mjs",
      "startLine": 359,
      "endLine": 373,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Example builder: buildFindRelevantCodeArgs",
      "snippet": "359: function buildFindRelevantCodeArgs(args) {\n360:   const { query, repo_root, scope, knownFiles, knownSymbols, knownText, session } = args;\n361:   if (!query || typeof query !== 'string' || !query.trim()) {\n362:     throw makeInvalidArgsError('find_relevant_code requires a non-empty \"query\" argument.');\n363:   }\n364:   const task = `Find the code most relevant to this task and return the smallest useful read/edit targets: ${query.trim()}.`;\n365:   return {\n366:     task,\n367:     repo_root,\n368:     scope,\n369:     session,\n370:     taskMode: 'locate',\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/mcp/server.mjs",
      "startLine": 346,
      "endLine": 357,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Example builder: buildTraceSymbolArgs",
      "snippet": "346: function buildTraceSymbolArgs(args) {\n347:   const { symbol, repo_root, scope, session } = args;\n348:   if (!symbol || typeof symbol !== 'string' || !symbol.trim()) {\n349:     throw makeInvalidArgsError('trace_symbol requires a non-empty \"symbol\" argument.');\n350:   }\n351:   const task = `Explain the symbol \"${symbol.trim()}\": where it is defined, what it does, its parameters/return type if applicable, and where it is called or used in the codebase.`;\n352:   return {\n353:     task, repo_root, scope, session,\n354:     taskMode: 'symbol_trace',\n355:     hints: { symbols: [symbol.trim()], strategy: 'symbol-first' },\n356:   };\n357: }"
    }
  ],
  "uncertainties": [
    "2 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 6,
    "filesRead": 3,
    "grepCalls": 2,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 6857,
    "totalTokens": 67102
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
  "pathQuery": "FastAPI app startup and API route registration through create_app",
  "entryPoint": "app/main.py",
  "knownFiles": [
    "app/main.py"
  ],
  "knownSymbols": [
    "create_app"
  ]
}
```

### Response
```json
{
  "directAnswer": "FastAPI app startup begins with module-level execution: `app = create_app()` at line 27 in `app/main.py`. The `create_app()` factory (lines 12-24) orchestrates initialization by loading settings, configuring logging/telemetry, creating the FastAPI instance, registering error handlers, attaching four API routers via `include_router()`, and instrumenting the app. Each router imports a module-level `APIRouter` instance defined in `app/api/` modules with a URL prefix and tags, then registers endpoints using `@router.{method}()` decorators.",
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
    "fileCount": 5,
    "warnings": [],
    "summary": "Verified: 6 files read, 1 grep searches, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 5 files. All evidence grounded in inspected code."
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
    "filesRead": 6,
    "grepCalls": 1,
    "listDirCalls": 2,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 6 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_877a0b1d5cbd7723",
  "session": {
    "id": "sess_877a0b1d5cbd7723",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Entry point: module-level create_app() call",
      "evidenceRefs": [
        "app/main.py:12-24",
        "E1"
      ],
      "startLine": 27,
      "endLine": 27
    },
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "create_app factory: app initialization and router registration",
      "evidenceRefs": [
        "app/main.py:27",
        "E2"
      ],
      "startLine": 12,
      "endLine": 24
    },
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Handoff points: app.include_router() calls",
      "evidenceRefs": [
        "app/main.py:12-24",
        "E3"
      ],
      "startLine": 19,
      "endLine": 22
    },
    {
      "path": "app/api/tasks.py",
      "role": "read",
      "reason": "Router definition: APIRouter with prefix/tags",
      "evidenceRefs": [
        "app/main.py:19",
        "E4"
      ],
      "startLine": 26,
      "endLine": 26
    },
    {
      "path": "app/api/plans.py",
      "role": "read",
      "reason": "Router definition confirmation (plans)",
      "evidenceRefs": [
        "app/main.py:20",
        "E5"
      ],
      "startLine": 10,
      "endLine": 10
    },
    {
      "path": "app/api/claims.py",
      "role": "read",
      "reason": "Router definition confirmation (claims)",
      "evidenceRefs": [
        "app/main.py:21",
        "E6"
      ],
      "startLine": 10,
      "endLine": 10
    },
    {
      "path": "app/api/sources.py",
      "role": "read",
      "reason": "Router definition confirmation (sources)",
      "evidenceRefs": [
        "app/main.py:22",
        "E7"
      ],
      "startLine": 17,
      "endLine": 17
    },
    {
      "path": "app/api/tasks.py",
      "role": "context",
      "reason": "Example endpoint using @router.post decorator",
      "evidenceRefs": [
        "app/api/tasks.py:26",
        "E8"
      ],
      "startLine": 39,
      "endLine": 50
    }
  ],
  "discoveredPathsCount": 29,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 27,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Entry point: module-level create_app() invocation when imported",
      "snippet": "27: app = create_app()"
    },
    {
      "id": "E2",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "create_app factory: initialization sequence and router registration",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "app/main.py",
      "startLine": 19,
      "endLine": 22,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Handoff points: include_router() calls attaching each router",
      "snippet": "19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)"
    },
    {
      "id": "E4",
      "path": "app/api/tasks.py",
      "startLine": 26,
      "endLine": 26,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Router instance: APIRouter with /tasks prefix and tags",
      "snippet": "26: router = APIRouter(prefix=\"/tasks\", tags=[\"tasks\"])"
    },
    {
      "id": "E5",
      "path": "app/api/plans.py",
      "startLine": 10,
      "endLine": 10,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Router instance: APIRouter with /tasks prefix and tags",
      "snippet": "10: router = APIRouter(prefix=\"/tasks\", tags=[\"plans\"])"
    },
    {
      "id": "E6",
      "path": "app/api/claims.py",
      "startLine": 10,
      "endLine": 10,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Router instance: APIRouter with /claims prefix and tags",
      "snippet": "10: router = APIRouter(prefix=\"/claims\", tags=[\"claims\"])"
    },
    {
      "id": "E7",
      "path": "app/api/sources.py",
      "startLine": 17,
      "endLine": 17,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Router instance: APIRouter with /sources prefix and tags",
      "snippet": "17: router = APIRouter(prefix=\"/sources\", tags=[\"sources\"])"
    },
    {
      "id": "E8",
      "path": "app/api/tasks.py",
      "startLine": 39,
      "endLine": 50,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Example endpoint: @router.post decorator pattern",
      "snippet": "39: @router.post(\"\", status_code=202)\n40: async def create_task_endpoint(request: CreateTaskRequest) -> dict:\n41:     record = create_task(\n42:         question=request.question,\n43:         language=request.language,\n44:         max_queries=request.max_queries,\n45:         max_sources=request.max_sources,\n46:         cost_budget_usd=request.cost_budget_usd,\n47:         timeout_seconds=request.timeout_seconds,\n48:         plan_wait_timeout_s=request.plan_wait_timeout_s,\n49:     )\n50:     return {\"task_id\": str(record.task_id), \"status\": \"queued\"}"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 10,
    "toolCalls": 14,
    "filesRead": 6,
    "grepCalls": 1,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 8870,
    "totalTokens": 74795
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
  "pathQuery": "websocket client connection authentication through authMiddleware into socket handlers",
  "entryPoint": "websocket-server/src/middleware/auth.ts",
  "knownFiles": [
    "websocket-server/src/middleware/auth.ts"
  ],
  "knownSymbols": [
    "authMiddleware"
  ]
}
```

### Response
```json
{
  "directAnswer": "WebSocket authentication flow: (1) Entry at websocket-server/src/index.ts:132-147 creates Socket.IO server and registers authMiddleware via io.use(authMiddleware). (2) authMiddleware (websocket-server/src/middleware/auth.ts:51-121) intercepts connections, applies IP-based brute-force protection, extracts JWT from handshake.auth.token or Authorization header, verifies token, populates socket.data with userId/companyId/role/name, and calls next() on success. (3) Post-auth, connection handler (websocket-server/src/index.ts:149-205) fires, adds user to onlineUsers map, joins company/user/admin rooms, wraps socket.on with rate limiting, and calls registerChatHandlers/registerNotificationHandlers. (4) Handlers access socket.data set by middleware (chat.ts:45-46, notification.ts:19-27). Handoff: authMiddleware.next() → io.on('connection') → handler registration with authenticated socket.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 6,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 4,
    "warnings": [],
    "summary": "Verified: 5 files read, 2 symbol lookups, 6/6 evidence items grounded, cross-verified across 4 files. All evidence grounded in inspected code."
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
    "filesRead": 5,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 5 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_09063df2b054b7b6",
  "session": {
    "id": "sess_09063df2b054b7b6",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/index.ts",
      "role": "read",
      "reason": "Server initialization and authMiddleware registration via io.use()",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 132,
      "endLine": 147
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "read",
      "reason": "Connection handler receives authenticated socket and registers handlers",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 149,
      "endLine": 205
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "read",
      "reason": "authMiddleware: token extraction, JWT verification, socket.data population",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 51,
      "endLine": 121
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "read",
      "reason": "TokenPayload interface, SocketData extension, IP helper, auth constants",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 1,
      "endLine": 49
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "read",
      "reason": "registerChatHandlers extracts socket.data and registers chat events",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 45,
      "endLine": 75
    },
    {
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "role": "read",
      "reason": "registerNotificationHandlers uses socket.data.userId",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 18,
      "endLine": 28
    }
  ],
  "discoveredPathsCount": 7,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/index.ts",
      "startLine": 132,
      "endLine": 147,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Socket.IO server creation and authMiddleware registration at line 146",
      "snippet": "132: const io = new Server(httpServer, {\n133:   cors: {\n134:     origin: allowedOrigins,\n135:     methods: ['GET', 'POST'],\n136:     credentials: true,\n137:   },\n138:   transports: ['websocket', 'polling'],\n139:   // Socket.IO 레벨 제한\n140:   maxHttpBufferSize: 1024 * 50, // 50KB (메시지 최대 크기)\n141:   pingTimeout: 20000,\n142:   pingInterval: 25000,\n143: })\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/index.ts",
      "startLine": 149,
      "endLine": 205,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Post-auth connection handler using socket.data and registering handlers",
      "snippet": "149: io.on('connection', (socket) => {\n150:   console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`)\n151:   console.log(`  User: ${socket.data.userId}, Company: ${socket.data.companyId}`)\n152: \n153:   // 동시 연결 수 제한 확인\n154:   if (!checkConnectionLimit(io, socket)) return\n155: \n156:   // 접속자 추적에 추가\n157:   onlineUsers.set(socket.id, {\n158:     userId: socket.data.userId,\n159:     companyId: socket.data.companyId,\n160:     name: socket.data.name,\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "authMiddleware implementation: IP protection, token extraction, JWT verify, socket.data set",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 1,
      "endLine": 49,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "TokenPayload, SocketData types, JWT_SECRET, auth failure constants, getSocketIp helper",
      "snippet": "1: import { Socket } from 'socket.io'\n2: import jwt from 'jsonwebtoken'\n3: import { logger } from '../lib/logger'\n4: \n5: interface TokenPayload {\n6:   userId: string\n7:   companyId: string\n8:   role: string\n9:   name: string\n10:   iat?: number\n11:   exp?: number\n12: }\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 45,
      "endLine": 75,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "registerChatHandlers destructures socket.data for user info",
      "snippet": "45: export function registerChatHandlers(io: Server, socket: Socket) {\n46:   const { userId, companyId, name, role } = socket.data\n47: \n48:   // 채팅 세션 참여\n49:   socket.on('join-session', async (data: JoinSessionData) => {\n50:     const { sessionId } = data\n51: \n52:     if (!isValidSessionId(sessionId)) {\n53:       socket.emit('error', { message: '유효하지 않은 세션 ID입니다.' })\n54:       return\n55:     }\n56: \n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "startLine": 18,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "registerNotificationHandlers accesses socket.data.userId",
      "snippet": "18: export function registerNotificationHandlers(io: Server, socket: Socket) {\n19:   // 클라이언트가 알림 읽음 처리 시 뱃지 갱신용\n20:   socket.on('notification-read', (data: { notificationId: string }) => {\n21:     console.log(`[Notification] Read: ${data.notificationId} by ${socket.data.userId}`)\n22:   })\n23: \n24:   // 모든 알림 읽음\n25:   socket.on('notifications-read-all', () => {\n26:     console.log(`[Notification] All read by ${socket.data.userId}`)\n27:   })\n28: }"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 9,
    "filesRead": 5,
    "grepCalls": 0,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 10020,
    "totalTokens": 72249
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
  "pathQuery": "Telegram auth Pages Function creates or authenticates a user session and exposes session state to the frontend",
  "entryPoint": "src/store.tsx",
  "knownFiles": [
    "src/store.tsx"
  ],
  "knownSymbols": [
    "useStore"
  ]
}
```

### Response
```json
{
  "directAnswer": "Telegram auth flow: User clicks TelegramLoginButton → POST /api/auth/telegram → backend validates HMAC-SHA256 signature, upserts user to DB, creates session via createSession(), sets cookie, returns user → frontend calls setAuthUser() to update Zustand store. On page load, useAuthSessionBootstrap calls /api/auth/me → authenticateSession() validates cookie → restores or clears auth state. Frontend exposes auth state via useStore hook with selectors (selectAuthSession, selectAuthBootstrap).",
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
    "summary": "Verified: 13 files read, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
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
    "filesRead": 13,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 13 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_7633d1a0632e0afe",
  "session": {
    "id": "sess_7633d1a0632e0afe",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/shared/components/TelegramLoginButton.tsx",
      "role": "read",
      "reason": "Entry point: handleTelegramAuth posts to /api/auth/telegram and calls setAuthUser",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 38,
      "endLine": 55
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "Backend auth: validates signature, upserts user, creates session, sets cookie",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 148,
      "endLine": 232
    },
    {
      "path": "functions/api/_lib/session.ts",
      "role": "read",
      "reason": "Session creation: generates token, hashes with HMAC-SHA256, stores in DB",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 57,
      "endLine": 78
    },
    {
      "path": "src/store/slices/auth.ts",
      "role": "read",
      "reason": "setAuthUser action: updates auth state with user and isAuthenticated flag",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 6,
      "endLine": 12
    },
    {
      "path": "src/shared/hooks/useAuthSessionBootstrap.ts",
      "role": "read",
      "reason": "Session restoration: calls fetchAuthSession on mount, then setAuthUser or logout",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 21,
      "endLine": 44
    },
    {
      "path": "functions/api/auth/me.ts",
      "role": "read",
      "reason": "Session validation: uses authenticateSession to verify cookie and return user",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 48,
      "endLine": 84
    },
    {
      "path": "src/store.selectors.ts",
      "role": "read",
      "reason": "Auth selectors: expose auth.user, isAuthenticated, and logout to components",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 41,
      "endLine": 56
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "role": "read",
      "reason": "Telegram HMAC-SHA256 signature verification implementation",
      "evidenceRefs": [
        "E3"
      ]
    }
  ],
  "discoveredPathsCount": 30,
  "evidence": [
    {
      "id": "E1",
      "path": "src/shared/components/TelegramLoginButton.tsx",
      "startLine": 38,
      "endLine": 55,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows entry point flow: POST to /api/auth/telegram, setAuthUser call on success",
      "snippet": "38:     const handleTelegramAuth = async (user: any) => {\n39:       console.log(\"Telegram auth received:\", user);\n40: \n41:       try {\n42:         // Send authentication data to backend for verification\n43:         const response = await fetch(\"/api/auth/telegram\", {\n44:           method: \"POST\",\n45:           headers: {\n46:             \"Content-Type\": \"application/json\",\n47:           },\n48:           body: JSON.stringify(user),\n49:         });\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 232,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Backend auth flow: signature validation (206), user upsert (216), session creation (218), cookie (229)",
      "snippet": "148: export const onRequestPost: PagesFunction<Env> = async (context) => {\n149:   const { request, env } = context;\n150: \n151:   // CORS headers\n152:   const corsHeaders = {\n153:     'Access-Control-Allow-Origin': '*',\n154:     'Access-Control-Allow-Methods': 'POST, OPTIONS',\n155:     'Access-Control-Allow-Headers': 'Content-Type',\n156:   };\n157: \n158:   // Handle OPTIONS request for CORS preflight\n159:   if (request.method === 'OPTIONS') {\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Telegram HMAC-SHA256 signature verification implementation",
      "snippet": "65: async function verifyTelegramAuth(\n66:   data: TelegramUser,\n67:   botToken: string\n68: ): Promise<boolean> {\n69:   const { hash, ...userData } = data;\n70: \n71:   // Create data-check-string: sorted key=value pairs joined with \\n\n72:   const dataCheckString = Object.keys(userData)\n73:     .sort()\n74:     .map((key) => `${key}=${userData[key as keyof typeof userData]}`)\n75:     .join('\\n');\n76: \n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "functions/api/_lib/session.ts",
      "startLine": 57,
      "endLine": 78,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session creation: generates token, hashes it, stores with 7-day expiry in auth_sessions",
      "snippet": "57: export const createSession = async (\n58:   db: D1Database,\n59:   userId: number,\n60:   authSecret: string\n61: ): Promise<string> => {\n62:   const now = Math.floor(Date.now() / 1000);\n63:   const expiresAt = now + SESSION_MAX_AGE_SECONDS;\n64:   const sessionId = crypto.randomUUID();\n65:   const rawToken = createRawSessionToken();\n66:   const tokenHash = await hashSessionToken(rawToken, authSecret);\n67: \n68:   await db\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/store/slices/auth.ts",
      "startLine": 6,
      "endLine": 12,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "setAuthUser action: sets auth.user and auth.isAuthenticated based on user != null",
      "snippet": "6:   setAuthUser: (user) =>\n7:     set(() => ({\n8:       auth: {\n9:         user,\n10:         isAuthenticated: user !== null,\n11:       },\n12:     })),"
    },
    {
      "id": "E6",
      "path": "src/shared/hooks/useAuthSessionBootstrap.ts",
      "startLine": 21,
      "endLine": 44,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session restoration: calls fetchAuthSession, then setAuthUser(session.user) or logout()",
      "snippet": "21: export const useAuthSessionBootstrap = () => {\n22:   const { logout, setAuthUser } = useStore(selectAuthBootstrap, shallow);\n23: \n24:   useEffect(() => {\n25:     let active = true;\n26:     const controller = new AbortController();\n27: \n28:     const restoreSession = async () => {\n29:       try {\n30:         const session = await fetchAuthSession(controller.signal);\n31:         if (!active) return;\n32: \n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "functions/api/auth/me.ts",
      "startLine": 48,
      "endLine": 84,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session validation: authenticateSession validates cookie, fetches user from DB",
      "snippet": "48:     const session = await authenticateSession(\n49:       context.request,\n50:       context.env.DB,\n51:       context.env.AUTH_SECRET\n52:     );\n53: \n54:     if (!session) {\n55:       return json({\n56:         success: true,\n57:         authenticated: false,\n58:         user: null,\n59:       });\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/store.selectors.ts",
      "startLine": 41,
      "endLine": 56,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Auth selectors exposing state.auth.user, isAuthenticated, and logout action",
      "snippet": "41: export const selectAuthSession = (state: AppStore) => ({\n42:   user: state.auth.user,\n43:   isAuthenticated: state.auth.isAuthenticated,\n44:   logout: state.logout,\n45: });\n46: \n47: export const selectExamAuth = (state: AppStore) => ({\n48:   isAuthenticated: state.auth.isAuthenticated,\n49:   language: state.settings.language,\n50:   logout: state.logout,\n51: });\n52: \n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 10,
    "toolCalls": 17,
    "filesRead": 13,
    "grepCalls": 0,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 14405,
    "totalTokens": 151715
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
  "pathQuery": "Firefox extension capture submission from apiClient through backend source intake or MCP surface",
  "entryPoint": "backend/mcp_server.py",
  "knownFiles": [
    "backend/mcp_server.py"
  ],
  "knownSymbols": [
    "scoped_tool"
  ]
}
```

### Response
```json
{
  "directAnswer": "Firefox extension captures flow: message listener (background.ts:184-188) → submitCapture → HTTP POST /api/v1/sources → FastAPI create_source (sources.py:345-416) → process_source domain command. MCP surface flows: stdio entry (mcp_server.py:40) → process_input tool (server.py:123-143) → tool_process_input → same process_source command. Both paths converge on backend/app/domains/source/commands.py::process_source.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 9,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 8,
    "warnings": [],
    "summary": "Verified: 12 files read, 5 grep searches, 4 symbol lookups, 9/9 evidence items grounded, cross-verified across 8 files. All evidence grounded in inspected code."
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
    "filesRead": 12,
    "grepCalls": 5,
    "listDirCalls": 0,
    "symbolCalls": 4,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 12 file read(s), 5 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_c1a56cffea6d47ff",
  "session": {
    "id": "sess_c1a56cffea6d47ff",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "role": "read",
      "reason": "Firefox extension message listener entry point",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 184,
      "endLine": 188
    },
    {
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "role": "read",
      "reason": "submitDraft calls dependencies.submit at line 114",
      "evidenceRefs": [],
      "startLine": 99,
      "endLine": 131
    },
    {
      "path": "extensions/firefox-inbox/src/shared/apiClient.ts",
      "role": "read",
      "reason": "submitCapture POSTs FormData to sourceApiUrl",
      "evidenceRefs": [],
      "startLine": 53,
      "endLine": 89
    },
    {
      "path": "extensions/firefox-inbox/src/shared/serviceUrl.ts",
      "role": "read",
      "reason": "sourceApiUrl constructs /api/v1/sources endpoint",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 42,
      "endLine": 44
    },
    {
      "path": "backend/app/api/v1/sources.py",
      "role": "read",
      "reason": "create_source POST endpoint calls process_source",
      "evidenceRefs": [],
      "startLine": 345,
      "endLine": 416
    },
    {
      "path": "backend/mcp_server.py",
      "role": "read",
      "reason": "MCP stdio transport entry point",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 40,
      "endLine": 40
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "process_input tool calls tool_process_input",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 123,
      "endLine": 143
    },
    {
      "path": "backend/app/mcp/tools/input_tools.py",
      "role": "read",
      "reason": "tool_process_input calls process_source command",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 45,
      "endLine": 53
    }
  ],
  "discoveredPathsCount": 38,
  "evidence": [
    {
      "id": "E1",
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "startLine": 184,
      "endLine": 188,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Firefox extension message listener entry point",
      "snippet": "184:   browser.runtime.onMessage.addListener((message: unknown) => {\n185:     if (!isExtensionRequest(message)) {\n186:       return false\n187:     }\n188:     return handleRequest(message)"
    },
    {
      "id": "E2",
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "startLine": 114,
      "endLine": 114,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "submitDraft calls dependencies.submit (submitCapture)",
      "snippet": "114:     const result = await dependencies.submit(settings, submittingDraft)"
    },
    {
      "id": "E3",
      "path": "extensions/firefox-inbox/src/shared/apiClient.ts",
      "startLine": 72,
      "endLine": 79,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST request to sourceApiUrl with headers/body",
      "snippet": "72:     response = await fetchImpl(sourceApiUrl(settings.serviceBaseUrl), {\n73:       method: 'POST',\n74:       headers: {\n75:         ...bearerHeaders(settings.apiKey),\n76:         'X-Studious-Client-Capture-Id': capture.clientCaptureId,\n77:       },\n78:       body: form,\n79:     })"
    },
    {
      "id": "E4",
      "path": "extensions/firefox-inbox/src/shared/serviceUrl.ts",
      "startLine": 42,
      "endLine": 44,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "sourceApiUrl returns /api/v1/sources endpoint",
      "snippet": "42: export function sourceApiUrl(serviceBaseUrl: string): string {\n43:   return `${normalizeServiceBaseUrl(serviceBaseUrl)}/api/v1/sources`\n44: }"
    },
    {
      "id": "E5",
      "path": "backend/app/api/v1/sources.py",
      "startLine": 401,
      "endLine": 416,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "create_source calls process_source domain command",
      "snippet": "401:         result = await process_source(\n402:             session=session,\n403:             raw_text=text,\n404:             images=validated_images,\n405:             source_url=source_url,\n406:             context_enrichment=context_enrichment,\n407:             web_search_enabled=web_search_enabled,\n408:             web_search_reason=web_search_reason,\n409:             web_search_disclosure_mode=web_search_disclosure_mode,\n410:             agent_thread_mode=agent_thread_mode,\n411:             agent_thread_id=agent_thread_id,\n412:             owner_id=owner_id,\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "backend/mcp_server.py",
      "startLine": 40,
      "endLine": 40,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "MCP stdio transport entry point",
      "snippet": "40:     mcp.run(transport=\"stdio\")"
    },
    {
      "id": "E7",
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 143,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "process_input tool with MEMORY_WRITE scope",
      "snippet": "123: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)\n124: async def process_input(\n125:     text: str | None = None,\n126:     image_base64: str | None = None,\n127:     image_mime: str | None = None,\n128:     context_enrichment: bool = False,\n129: ) -> dict:\n130:     \"\"\"주인님의 텍스트·이미지를 접수하여 AI 분석 후 지식·할일·일정으로 정리합니다.\n131: \n132:     Args:\n133:         text: 정리할 텍스트 또는 대화 기록\n134:         image_base64: Base64 인코딩된 이미지 데이터\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "backend/app/mcp/tools/input_tools.py",
      "startLine": 45,
      "endLine": 53,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "tool_process_input calls process_source domain command",
      "snippet": "45:         result = await process_source(\n46:             session=session,\n47:             raw_text=text,\n48:             images=incoming_images,\n49:             context_enrichment=context_enrichment,\n50:             owner_id=owner_id,\n51:             data_group_id=data_group_id,\n52:             access_context=access_context,\n53:         )"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 14,
    "toolCalls": 21,
    "filesRead": 12,
    "grepCalls": 5,
    "symbolCalls": 4,
    "stoppedByBudget": false,
    "elapsedMs": 18360,
    "totalTokens": 259963
  }
}
```
