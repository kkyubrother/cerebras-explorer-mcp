# Code-blind evaluator packet: collect_evidence

You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.

## Tool Description
Use when you already have a claim, hypothesis, or review point and need a compact bundle of grounded file:line evidence with snippets. Best for verifying facts before replying or reviewing a change.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "claim": {
      "type": "string",
      "description": "The claim or hypothesis to verify."
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
    "claim"
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
  "claim": "explore_repo rejects a public budget input and all public tools are read-only annotated",
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
  "directAnswer": "Both claims verified. (1) explore_repo rejects 'budget' as unknown argument per spec 011—confirmed by schema (no budget property), validation logic (throws error), and test assertions. (2) All 10 public MCP tools use read-only annotations (readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true).",
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
    "summary": "Verified: 8 files read, 4 grep searches, 8/8 evidence items grounded, cross-verified across 5 files. All evidence grounded in inspected code."
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
    "filesRead": 8,
    "grepCalls": 4,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 8 file read(s), 4 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_4fe1ba236d8bdc84",
  "session": {
    "id": "sess_4fe1ba236d8bdc84",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/explorer/schemas.mjs",
      "role": "config",
      "reason": "EXPLORE_REPO_INPUT_SCHEMA lacks 'budget' property; only allows task, repo_root, scope, hints, session, language",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 1,
      "endLine": 57
    },
    {
      "path": "src/explorer/schemas.mjs",
      "role": "config",
      "reason": "validateExploreRepoArgs throws 'Unknown explore_repo argument: budget' for unrecognized keys",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 344,
      "endLine": 354
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "READ_ONLY_TOOL_ANNOTATIONS constant defines all read-only hint flags",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 17,
      "endLine": 29
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "EXPLORE_REPO_TOOL uses readOnlyToolAnnotations and description says 'Omit budget'",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 33,
      "endLine": 46
    },
    {
      "path": "tests/runtime.mock.test.mjs",
      "role": "test",
      "reason": "Test '011 US2' confirms explore_repo rejects budget input with error message",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 2319,
      "endLine": 2332
    },
    {
      "path": "tests/mcp-server.test.mjs",
      "role": "test",
      "reason": "Assertion confirms budget property is undefined per spec 011",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 221,
      "endLine": 223
    },
    {
      "path": "tests/schemas.test.mjs",
      "role": "test",
      "reason": "Test asserts budget input was removed in spec 011",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 167,
      "endLine": 172
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "buildToolList confirms all 10 public tools are exposed via MCP",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 277,
      "endLine": 291
    }
  ],
  "discoveredPathsCount": 57,
  "evidence": [
    {
      "id": "E1",
      "path": "src/explorer/schemas.mjs",
      "startLine": 1,
      "endLine": 57,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EXPLORE_REPO_INPUT_SCHEMA does not define 'budget' property",
      "snippet": "1: export const EXPLORE_REPO_INPUT_SCHEMA = {\n2:   type: 'object',\n3:   additionalProperties: false,\n4:   properties: {\n5:     task: {\n6:       type: 'string',\n7:       description:\n8:         'Natural-language exploration request. Be specific for best results: ' +\n9:         '\"How does the auth middleware validate JWT tokens and where is it applied?\" ' +\n10:         'is better than \"explain auth\".',\n11:     },\n12:     repo_root: {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/explorer/schemas.mjs",
      "startLine": 344,
      "endLine": 354,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "validateExploreRepoArgs throws error for unrecognized arguments including 'budget'",
      "snippet": "344: export function validateExploreRepoArgs(args, { allowInternal = false } = {}) {\n345:   if (!args || typeof args !== 'object') {\n346:     throw new Error('Arguments must be an object.');\n347:   }\n348:   const allowedKeys = new Set(Object.keys(EXPLORE_REPO_INPUT_SCHEMA.properties));\n349:   if (allowInternal) allowedKeys.add('taskMode');\n350:   for (const key of Object.keys(args)) {\n351:     if (!allowedKeys.has(key)) {\n352:       throw new Error(`Unknown explore_repo argument: ${key}`);\n353:     }\n354:   }"
    },
    {
      "id": "E3",
      "path": "src/mcp/server.mjs",
      "startLine": 17,
      "endLine": 29,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "READ_ONLY_TOOL_ANNOTATIONS defines readOnlyHint: true, destructiveHint: false",
      "snippet": "17: const READ_ONLY_TOOL_ANNOTATIONS = Object.freeze({\n18:   readOnlyHint: true,\n19:   destructiveHint: false,\n20:   idempotentHint: true,\n21:   openWorldHint: true,\n22: });\n23: \n24: function readOnlyToolAnnotations(title) {\n25:   return {\n26:     title,\n27:     ...READ_ONLY_TOOL_ANNOTATIONS,\n28:   };\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/mcp/server.mjs",
      "startLine": 33,
      "endLine": 46,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EXPLORE_REPO_TOOL uses readOnlyToolAnnotations and description omits budget",
      "snippet": "33: const EXPLORE_REPO_TOOL = {\n34:   name: 'explore_repo',\n35:   title: 'Autonomous repository explorer',\n36:   description:\n37:     'Use FIRST for read-only code discovery when the exact files are unknown, the task may span 3+ files, or you need cross-file evidence: ' +\n38:     'architecture, symbol usage, dependency/call tracing, bug root cause, change impact, config origin, or evidence collection. ' +\n39:     'Do NOT use for a single known file/range or when immediate editing is cheaper. ' +\n40:     'Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. ' +\n41:     'After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. ' +\n42:     'Omit budget and hints.strategy unless required by an advanced workflow. Pass sessionId as \"session\" for follow-up calls.',\n43:   inputSchema: EXPLO\n... [truncated 93 chars]"
    },
    {
      "id": "E5",
      "path": "tests/runtime.mock.test.mjs",
      "startLine": 2319,
      "endLine": 2332,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test showing explore_repo throws 'Unknown explore_repo argument: budget'",
      "snippet": "2319: test('011 US2 — explore_repo rejects budget input as unknown property', async () => {\n2320:   class StubClient {\n2321:     constructor() { this.model = 'zai-glm-4.7'; }\n2322:     async createChatCompletion() {\n2323:       return { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, message: { content: '', toolCalls: [] } };\n2324:     }\n2325:   }\n2326:   const root = await makeRepoFixture();\n2327:   const runtime = new ExplorerRuntime({ chatClient: new StubClient() });\n2328:   await assert.rejects(\n2329:     runtime.explore({ task: '테스트', repo_root: root, budget: 'quick' }),\n2330:     /Unknown explore_repo argument: budget/,\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "tests/mcp-server.test.mjs",
      "startLine": 221,
      "endLine": 223,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test assertion confirms budget input was removed in spec 011",
      "snippet": "221:   // spec 011: budget input was removed; every call runs against the single deep runtime config.\n222:   assert.equal(exploreRepoTool.inputSchema.properties.budget, undefined, 'budget input was removed in spec 011');\n223:   assert.ok(exploreRepoTool.outputSchema.properties.targets, 'explore_repo must expose outputSchema targets');"
    },
    {
      "id": "E7",
      "path": "tests/schemas.test.mjs",
      "startLine": 167,
      "endLine": 172,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test asserts EXPLORE_REPO_INPUT_SCHEMA.properties.budget is undefined",
      "snippet": "167: test('agent-facing strategy hint stays advanced only and budget input was removed in spec 011', () => {\n168:   assert.equal(\n169:     EXPLORE_REPO_INPUT_SCHEMA.properties.budget,\n170:     undefined,\n171:     'spec 011: budget input was removed',\n172:   );"
    },
    {
      "id": "E8",
      "path": "src/mcp/server.mjs",
      "startLine": 277,
      "endLine": 291,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "buildToolList lists all 10 public tools that use readOnlyToolAnnotations",
      "snippet": "277: function buildToolList() {\n278:   return [\n279:     FIND_RELEVANT_CODE_TOOL,\n280:     TRACE_SYMBOL_TOOL,\n281:     MAP_CHANGE_IMPACT_TOOL,\n282:     MAP_IMPACT_TOOL,\n283:     EXPLAIN_CODE_PATH_TOOL,\n284:     COLLECT_EVIDENCE_TOOL,\n285:     REVIEW_CHANGE_CONTEXT_TOOL,\n286:     FIND_ENTRYPOINTS_TOOL,\n287:     EXPLORE_REPO_TOOL,\n288:     EXPLORE_TOOL,\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 13,
    "filesRead": 8,
    "grepCalls": 4,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 12915,
    "totalTokens": 134595
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
  "claim": "create_app is the main FastAPI application factory and wires API routers or middleware",
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
  "directAnswer": "Claim VERIFIED: create_app in app/main.py is the FastAPI factory, includes 4 routers (tasks, plans, claims, sources), and wires middleware via instrument_fastapi_app.",
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
    "summary": "Verified: 4 files read, 1 grep searches, 1 symbol lookups, 3/3 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
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
    "filesRead": 4,
    "grepCalls": 1,
    "listDirCalls": 1,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 4 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_6d1fcef993fbc335",
  "session": {
    "id": "sess_6d1fcef993fbc335",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Full create_app factory showing FastAPI instantiation, router wiring, and middleware setup",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 12,
      "endLine": 24
    },
    {
      "path": "app/core/telemetry.py",
      "role": "read",
      "reason": "Shows instrument_fastpi_app adds OpenTelemetry instrumentation middleware",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 15,
      "endLine": 16
    },
    {
      "path": "app/api/errors.py",
      "role": "read",
      "reason": "Shows register_error_handlers adds exception handlers, not middleware",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 28,
      "endLine": 38
    }
  ],
  "discoveredPathsCount": 96,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Proves create_app creates FastAPI app, wires 4 routers via include_router, and calls instrumentation middleware",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/core/telemetry.py",
      "startLine": 15,
      "endLine": 16,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows instrument_fastapi_app uses FastAPIInstrumentor which adds ASGI middleware for tracing",
      "snippet": "15: def instrument_fastapi_app(app: object) -> None:\n16:     FastAPIInstrumentor.instrument_app(app)"
    },
    {
      "id": "E3",
      "path": "app/api/errors.py",
      "startLine": 28,
      "endLine": 38,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows register_error_handlers uses @app.exception_handler decorator, not middleware",
      "snippet": "28: def register_error_handlers(app: FastAPI) -> None:\n29:     @app.exception_handler(ApiError)\n30:     async def handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:\n31:         return JSONResponse(\n32:             status_code=exc.status_code,\n33:             content=ErrorResponse(\n34:                 code=exc.code,\n35:                 message=exc.message,\n36:                 details=exc.details,\n37:             ).model_dump(),\n38:         )"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 5,
    "toolCalls": 7,
    "filesRead": 4,
    "grepCalls": 1,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 5886,
    "totalTokens": 36485
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
  "claim": "websocket-server authenticates Socket.IO connections with authMiddleware before registering chat or notification handlers",
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
  "directAnswer": "Verified: websocket-server applies authMiddleware via io.use(authMiddleware) at line 146, then executes the connection handler at line 149, and finally registers chat/notification handlers at lines 201 and 204—ensuring authentication occurs before handler registration. Both handler functions depend on socket.data populated by authMiddleware.",
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
    "fileCount": 4,
    "warnings": [],
    "summary": "Verified: 5 files read, 1 grep searches, 3 symbol lookups, 5/5 evidence items grounded, cross-verified across 4 files. All evidence grounded in inspected code."
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
    "grepCalls": 1,
    "listDirCalls": 2,
    "symbolCalls": 3,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 5 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_baf9d0b55dc6b255",
  "session": {
    "id": "sess_baf9d0b55dc6b255",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/index.ts",
      "role": "context",
      "reason": "Shows authMiddleware applied at line 146, connection handler at line 149, and handler registrations at lines 201 and 204",
      "evidenceRefs": [],
      "startLine": 145,
      "endLine": 204
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "Defines authMiddleware that validates JWT tokens and populates socket.data with user info",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 51,
      "endLine": 105
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "context",
      "reason": "registerChatHandlers destructures socket.data which is set by authMiddleware",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 45,
      "endLine": 46
    },
    {
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "role": "context",
      "reason": "registerNotificationHandlers accesses socket.data.userId which is set by authMiddleware",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 18,
      "endLine": 27
    },
    {
      "path": "websocket-server/src/index.ts",
      "startLine": 145,
      "endLine": 146,
      "role": "read",
      "reason": "Shows authMiddleware applied globally with io.use(authMiddleware) before connection handler",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "websocket-server/src/index.ts",
      "startLine": 149,
      "endLine": 204,
      "role": "read",
      "reason": "Connection handler executes after middleware; chat/notification handlers registered at lines 201 and 204 inside handler",
      "evidenceRefs": [
        "E2"
      ]
    }
  ],
  "discoveredPathsCount": 43,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/index.ts",
      "startLine": 145,
      "endLine": 146,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows authMiddleware applied globally with io.use(authMiddleware) before connection handler",
      "snippet": "145: // 인증 미들웨어 적용\n146: io.use(authMiddleware)"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/index.ts",
      "startLine": 149,
      "endLine": 204,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Connection handler executes after middleware; chat/notification handlers registered at lines 201 and 204 inside handler",
      "snippet": "149: io.on('connection', (socket) => {\n150:   console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`)\n151:   console.log(`  User: ${socket.data.userId}, Company: ${socket.data.companyId}`)\n152: \n153:   // 동시 연결 수 제한 확인\n154:   if (!checkConnectionLimit(io, socket)) return\n155: \n156:   // 접속자 추적에 추가\n157:   onlineUsers.set(socket.id, {\n158:     userId: socket.data.userId,\n159:     companyId: socket.data.companyId,\n160:     name: socket.data.name,\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 105,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "authMiddleware validates JWT token and populates socket.data; calls next() on success",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 45,
      "endLine": 46,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "registerChatHandlers destructures socket.data which is set by authMiddleware",
      "snippet": "45: export function registerChatHandlers(io: Server, socket: Socket) {\n46:   const { userId, companyId, name, role } = socket.data"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "startLine": 18,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "registerNotificationHandlers accesses socket.data.userId which is set by authMiddleware",
      "snippet": "18: export function registerNotificationHandlers(io: Server, socket: Socket) {\n19:   // 클라이언트가 알림 읽음 처리 시 뱃지 갱신용\n20:   socket.on('notification-read', (data: { notificationId: string }) => {\n21:     console.log(`[Notification] Read: ${data.notificationId} by ${socket.data.userId}`)\n22:   })\n23: \n24:   // 모든 알림 읽음\n25:   socket.on('notifications-read-all', () => {\n26:     console.log(`[Notification] All read by ${socket.data.userId}`)\n27:   })"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 11,
    "filesRead": 5,
    "grepCalls": 1,
    "symbolCalls": 3,
    "stoppedByBudget": false,
    "elapsedMs": 7264,
    "totalTokens": 65477
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
  "claim": "Telegram authentication uses a Cloudflare Pages Function and session helper rather than only client-side state",
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
  "directAnswer": "VERIFIED: Telegram authentication uses a Cloudflare Pages Function (functions/api/auth/telegram.ts) and session helper (functions/api/_lib/session.ts), NOT just client-side state. Server validates Telegram auth, creates database-backed sessions with HttpOnly cookies, and client-side store only caches user info after server verification.",
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
    "fileCount": 4,
    "warnings": [],
    "summary": "Verified: 9 files read, 2 grep searches, 8/8 evidence items grounded, cross-verified across 4 files. All evidence grounded in inspected code."
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
    "filesRead": 9,
    "grepCalls": 2,
    "listDirCalls": 2,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 9 file read(s), 2 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_61d0b976194fa26f",
  "session": {
    "id": "sess_61d0b976194fa26f",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "context",
      "reason": "Cloudflare Pages Function validating Telegram auth and creating server sessions",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 241
    },
    {
      "path": "functions/api/_lib/session.ts",
      "role": "context",
      "reason": "Session helper library with createSession, authenticateSession, cookie utilities",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 134
    },
    {
      "path": "src/shared/components/TelegramLoginButton.tsx",
      "role": "context",
      "reason": "Client sends auth data to server endpoint, stores user after server success",
      "evidenceRefs": [],
      "startLine": 38,
      "endLine": 70
    },
    {
      "path": "migrations/0002_auth_sessions.sql",
      "role": "context",
      "reason": "Database schema for server-side session storage with token_hash",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 18
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 240,
      "role": "read",
      "reason": "Cloudflare Pages Function handler validates auth, upserts user, creates session, sets HttpOnly cookie",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "role": "read",
      "reason": "Server-side verification of Telegram auth using HMAC-SHA256 (not client-side only)",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "functions/api/_lib/session.ts",
      "startLine": 1,
      "endLine": 6,
      "role": "read",
      "reason": "Session helper utilities specifically for Cloudflare Pages Functions",
      "evidenceRefs": [
        "E3"
      ]
    },
    {
      "path": "functions/api/_lib/session.ts",
      "startLine": 51,
      "endLine": 55,
      "role": "read",
      "reason": "Session cookie builder creates HttpOnly, Secure, SameSite=Lax cookie (not accessible to client JS)",
      "evidenceRefs": [
        "E4"
      ]
    }
  ],
  "discoveredPathsCount": 51,
  "evidence": [
    {
      "id": "E1",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 240,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Cloudflare Pages Function handler validates auth, upserts user, creates session, sets HttpOnly cookie",
      "snippet": "148: export const onRequestPost: PagesFunction<Env> = async (context) => {\n149:   const { request, env } = context;\n150: \n151:   // CORS headers\n152:   const corsHeaders = {\n153:     'Access-Control-Allow-Origin': '*',\n154:     'Access-Control-Allow-Methods': 'POST, OPTIONS',\n155:     'Access-Control-Allow-Headers': 'Content-Type',\n156:   };\n157: \n158:   // Handle OPTIONS request for CORS preflight\n159:   if (request.method === 'OPTIONS') {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Server-side verification of Telegram auth using HMAC-SHA256 (not client-side only)",
      "snippet": "65: async function verifyTelegramAuth(\n66:   data: TelegramUser,\n67:   botToken: string\n68: ): Promise<boolean> {\n69:   const { hash, ...userData } = data;\n70: \n71:   // Create data-check-string: sorted key=value pairs joined with \\n\n72:   const dataCheckString = Object.keys(userData)\n73:     .sort()\n74:     .map((key) => `${key}=${userData[key as keyof typeof userData]}`)\n75:     .join('\\n');\n76: \n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "functions/api/_lib/session.ts",
      "startLine": 1,
      "endLine": 6,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session helper utilities specifically for Cloudflare Pages Functions",
      "snippet": "1: /**\n2:  * Session authentication utilities for Cloudflare Pages Functions.\n3:  */\n4: \n5: const SESSION_COOKIE_NAME = \"bible_session\";\n6: const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;"
    },
    {
      "id": "E4",
      "path": "functions/api/_lib/session.ts",
      "startLine": 51,
      "endLine": 55,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session cookie builder creates HttpOnly, Secure, SameSite=Lax cookie (not accessible to client JS)",
      "snippet": "51: export const buildSessionCookie = (token: string): string =>\n52:   `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;\n53: \n54: export const buildClearSessionCookie = (): string =>\n55:   `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;"
    },
    {
      "id": "E5",
      "path": "functions/api/_lib/session.ts",
      "startLine": 57,
      "endLine": 78,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "createSession function stores session in database with HMAC-SHA256 token hash",
      "snippet": "57: export const createSession = async (\n58:   db: D1Database,\n59:   userId: number,\n60:   authSecret: string\n61: ): Promise<string> => {\n62:   const now = Math.floor(Date.now() / 1000);\n63:   const expiresAt = now + SESSION_MAX_AGE_SECONDS;\n64:   const sessionId = crypto.randomUUID();\n65:   const rawToken = createRawSessionToken();\n66:   const tokenHash = await hashSessionToken(rawToken, authSecret);\n67: \n68:   await db\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "functions/api/_lib/session.ts",
      "startLine": 80,
      "endLine": 111,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "authenticateSession function validates session from cookie against database",
      "snippet": "80: export const authenticateSession = async (\n81:   request: Request,\n82:   db: D1Database,\n83:   authSecret: string\n84: ): Promise<{ sessionId: string; userId: number } | null> => {\n85:   const sessionToken = parseCookies(request)[SESSION_COOKIE_NAME];\n86:   if (!sessionToken) return null;\n87: \n88:   const tokenHash = await hashSessionToken(sessionToken, authSecret);\n89:   const now = Math.floor(Date.now() / 1000);\n90: \n91:   const session = await db\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "migrations/0002_auth_sessions.sql",
      "startLine": 4,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Database table schema for server-side session storage with token_hash, expires_at, revoked_at",
      "snippet": "4: CREATE TABLE IF NOT EXISTS auth_sessions (\n5:   id TEXT PRIMARY KEY,\n6:   user_id INTEGER NOT NULL,\n7:   token_hash TEXT NOT NULL UNIQUE,\n8:   expires_at INTEGER NOT NULL,\n9:   created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),\n10:   revoked_at INTEGER,\n11:   last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),\n12:   FOREIGN KEY (user_id) REFERENCES users(id)\n13: );"
    },
    {
      "id": "E8",
      "path": "src/shared/components/TelegramLoginButton.tsx",
      "startLine": 38,
      "endLine": 56,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Client sends auth data to /api/auth/telegram endpoint, stores user in Zustand only after server success",
      "snippet": "38:     const handleTelegramAuth = async (user: any) => {\n39:       console.log(\"Telegram auth received:\", user);\n40: \n41:       try {\n42:         // Send authentication data to backend for verification\n43:         const response = await fetch(\"/api/auth/telegram\", {\n44:           method: \"POST\",\n45:           headers: {\n46:             \"Content-Type\": \"application/json\",\n47:           },\n48:           body: JSON.stringify(user),\n49:         });\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 13,
    "filesRead": 9,
    "grepCalls": 2,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 7412,
    "totalTokens": 78027
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
  "claim": "MCP tools are registered through scoped_tool or equivalent wrappers in backend/mcp_server.py",
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
  "directAnswer": "The claim is PARTIALLY CORRECT but contains a critical file path error. MCP tools ARE registered through the `scoped_tool` wrapper, but the correct file is `backend/app/mcp/server.py`, NOT `backend/mcp_server.py`. The file `backend/mcp_server.py` is only a 41-line stdio transport entry point that imports and runs the MCP server - it contains no tool registration code.",
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
    "fileCount": 2,
    "warnings": [],
    "summary": "Verified: 5 files read, 3 grep searches, 2 symbol lookups, 6/6 evidence items grounded, cross-verified across 2 files. All evidence grounded in inspected code."
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
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 5 file read(s), 3 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_e5bf7a10b2679dfa",
  "session": {
    "id": "sess_e5bf7a10b2679dfa",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/mcp_server.py",
      "role": "context",
      "reason": "Full file showing it's only an entry point with no tool registration",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 1,
      "endLine": 41
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "scoped_tool wrapper definition that wraps @mcp.tool() decorator",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 79,
      "endLine": 91
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "scoped_resource wrapper (equivalent wrapper for resources)",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 110,
      "endLine": 120
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Example of tool registration using @scoped_tool decorator",
      "evidenceRefs": [],
      "startLine": 123,
      "endLine": 143
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Another example of tool registration using @scoped_tool",
      "evidenceRefs": [],
      "startLine": 146,
      "endLine": 174
    },
    {
      "path": "backend/app/mcp/server.py",
      "startLine": 81,
      "endLine": 81,
      "role": "read",
      "reason": "Shows scoped_tool calls @mcp.tool() for actual registration",
      "evidenceRefs": [
        "E3"
      ]
    },
    {
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 123,
      "role": "read",
      "reason": "Example: process_input tool uses @scoped_tool wrapper",
      "evidenceRefs": [
        "E5"
      ]
    },
    {
      "path": "backend/app/mcp/server.py",
      "startLine": 146,
      "endLine": 146,
      "role": "read",
      "reason": "Example: orchestrate_input tool uses @scoped_tool wrapper",
      "evidenceRefs": [
        "E6"
      ]
    }
  ],
  "discoveredPathsCount": 26,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/mcp_server.py",
      "startLine": 1,
      "endLine": 41,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows this file is only an entry point with no tool registration",
      "snippet": "1: \"\"\"Stdio transport entry point for MCP clients that don't support HTTP.\"\"\"\n2: \n3: import os\n4: import subprocess\n5: import sys\n6: \n7: \n8: def _run_migrations() -> None:\n9:     \"\"\"Run Alembic migrations before starting the stdio server.\"\"\"\n10:     from app.config import ensure_runtime_directories\n11: \n12:     ensure_runtime_directories()\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "backend/app/mcp/server.py",
      "startLine": 79,
      "endLine": 91,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Defines scoped_tool wrapper using @mcp.tool() internally",
      "snippet": "79: def scoped_tool(*required_scopes: str):\n80:     def _decorator(func: Callable[..., Any]):\n81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})\n82:         @wraps(func)\n83:         async def _wrapped(*args: Any, **kwargs: Any):\n84:             require_mcp_scopes(*required_scopes)\n85:             return await func(*args, **kwargs)\n86: \n87:         return _wrapped\n88: \n89:     return _decorator\n90: \n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "backend/app/mcp/server.py",
      "startLine": 81,
      "endLine": 81,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows scoped_tool calls @mcp.tool() for actual registration",
      "snippet": "81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})"
    },
    {
      "id": "E4",
      "path": "backend/app/mcp/server.py",
      "startLine": 110,
      "endLine": 120,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Defines scoped_resource wrapper - equivalent for resources",
      "snippet": "110: def scoped_resource(uri: str, *required_scopes: str):\n111:     def _decorator(func: Callable[..., Any]):\n112:         @mcp.resource(uri)\n113:         @wraps(func)\n114:         async def _wrapped(*args: Any, **kwargs: Any):\n115:             require_mcp_scopes(*required_scopes)\n116:             return await func(*args, **kwargs)\n117: \n118:         return _wrapped\n119: \n120:     return _decorator"
    },
    {
      "id": "E5",
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 123,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Example: process_input tool uses @scoped_tool wrapper",
      "snippet": "123: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)"
    },
    {
      "id": "E6",
      "path": "backend/app/mcp/server.py",
      "startLine": 146,
      "endLine": 146,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Example: orchestrate_input tool uses @scoped_tool wrapper",
      "snippet": "146: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)"
    }
  ],
  "uncertainties": [
    "The claim mentions 'equivalent wrappers' - I confirmed scoped_resource for resources, but other wrappers may exist in files outside backend/mcp_server.py scope"
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 10,
    "filesRead": 5,
    "grepCalls": 3,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 67008,
    "totalTokens": 92446
  }
}
```
