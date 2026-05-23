# Code-blind evaluator packet: find_relevant_code

You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.

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
  "query": "Find the smallest useful files and line ranges for understanding MCP tool dispatch and evidence grounding.",
  "knownFiles": [
    "src/mcp/server.mjs"
  ]
}
```

### Response
```json
{
  "directAnswer": "MCP tool dispatch routes tools/call messages via a switch in server.mjs to specialized task builders, then calls exploreRepository. After tool execution, finalizeAfterToolLoop extracts structured JSON output. Evidence grounding validates each evidence item: checkEvidenceGrounding verifies overlap with observedRanges tracked from tool results (reads, greps, git operations), groundEvidenceItem assigns groundingStatus (exact/partial) by evidenceType, and groundEvidenceList filters ungrounded items. The critic pass orchestrates validation and builds evidence quality metrics.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": [
      "5 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 3,
    "partialCount": 5,
    "droppedCount": 0,
    "fileCount": 3,
    "warnings": [
      "5 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 10 files read, 11 grep searches, 3/8 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
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
    "filesRead": 10,
    "grepCalls": 11,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 10 file read(s), 11 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_4501c5cc70f503c2",
  "session": {
    "id": "sess_4501c5cc70f503c2",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "Tools/call dispatch switch routes each tool name to its handler",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 861,
      "endLine": 921
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "callTool executes exploreRepository and formats result",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 792,
      "endLine": 811
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "read",
      "reason": "finalizeAfterToolLoop extracts structured JSON from model",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 2319,
      "endLine": 2380
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "checkEvidenceGrounding validates overlap with observedRanges",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 28,
      "endLine": 76
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "groundEvidenceItem assigns groundingStatus per evidenceType",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 83,
      "endLine": 111
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "groundEvidenceList filters and returns grounded evidence list",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 113,
      "endLine": 154
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "runDeterministicCriticPass orchestrates validation and confidence",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 368,
      "endLine": 415
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "read",
      "reason": "Tool result tracking updates observedRanges from reads/greps/git",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 1597,
      "endLine": 1644
    }
  ],
  "discoveredPathsCount": 57,
  "evidence": [
    {
      "id": "E1",
      "path": "src/mcp/server.mjs",
      "startLine": 861,
      "endLine": 921,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tools/call dispatch switch routes each tool name to handler",
      "snippet": "861:       case 'tools/call': {\n862:         const name = message.params?.name;\n863:         const args = message.params?.arguments ?? {};\n864:         const progressToken = message.params?._meta?.progressToken ?? null;\n865:         const requestId = message.id ?? null;\n866:         const exposedToolNames = new Set(buildToolList().map(tool => tool.name));\n867: \n868:         try {\n869:           if (!exposedToolNames.has(name)) {\n870:             const error = new Error(`Unknown tool: ${name}`);\n871:             error.code = -32601;\n872:             throw error;\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 792,
      "endLine": 811,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "callTool executes exploreRepository and formats result",
      "snippet": "792:   async function callTool(exploreArgs, progressToken, requestId) {\n793:     const abortController = new AbortController();\n794:     if (requestId) activeAbortControllers.set(requestId, abortController);\n795:     try {\n796:       const result = await exploreRepository(exploreArgs, {\n797:         logger,\n798:         ...runtimeOptions,\n799:         onProgress: makeProgressCallback(progressToken),\n800:         sessionStore,\n801:         abortSignal: abortController.signal,\n802:       });\n803:       const agentResult = redactExploreResult(toAgentFacingResult(result)).value;\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/explorer/runtime.mjs",
      "startLine": 2319,
      "endLine": 2380,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "finalizeAfterToolLoop extracts structured JSON from model",
      "snippet": "2319:   async finalizeAfterToolLoop({ chatClient, messages, reasoningEffort, temperature, topP, budgetConfig, abortSignal = null }) {\n2320:     const maxCompletionTokens = budgetConfig?.finalizeMaxCompletionTokens ?? 2000;\n2321:     const completion = await chatClient.createChatCompletion({\n2322:       messages: [\n2323:         ...messages,\n2324:         { role: 'user', content: buildFinalizePrompt() },\n2325:       ],\n2326:       responseFormat: {\n2327:         type: 'json_schema',\n2328:         json_schema: EXPLORE_RESULT_JSON_SCHEMA,\n2329:       },\n2330:       reasoningEffort,\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/explorer/critic.mjs",
      "startLine": 28,
      "endLine": 76,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "checkEvidenceGrounding validates overlap with observedRanges",
      "snippet": "28: export function checkEvidenceGrounding(observedRanges, evidenceItem) {\n29:   const ranges = observedRanges.get(evidenceItem.path);\n30:   if (!ranges || ranges.length === 0) {\n31:     return { overlaps: false, partial: false };\n32:   }\n33: \n34:   const evidenceStart = evidenceItem.startLine;\n35:   const evidenceEnd = evidenceItem.endLine;\n36:   const evidenceLength = evidenceEnd - evidenceStart + 1;\n37:   let bestResult = { overlaps: false, partial: false };\n38: \n39:   for (const range of ranges) {\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/explorer/critic.mjs",
      "startLine": 83,
      "endLine": 111,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "groundEvidenceItem assigns groundingStatus per evidenceType",
      "snippet": "83: export function groundEvidenceItem(item, { observedRanges, observedGit }) {\n84:   const kind = item.evidenceType ?? 'file_range';\n85: \n86:   if (kind === 'git_commit') {\n87:     const sha = item.sha ?? item.commit ?? '';\n88:     return isObservedCommit(sha, observedGit) ? { ...item, groundingStatus: 'exact' } : null;\n89:   }\n90: \n91:   if (kind === 'git_blame') {\n92:     const blameKey = `${item.path}:${item.startLine}:${item.sha ?? ''}`;\n93:     const endKey = `${item.path}:${item.endLine}:${item.sha ?? ''}`;\n94:     return observedGit.blame.has(blameKey) || observedGit.blame.has(endKey)\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/explorer/critic.mjs",
      "startLine": 113,
      "endLine": 154,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "groundEvidenceList filters and returns grounded evidence list",
      "snippet": "113: export function groundEvidenceList({ evidence, observedRanges, observedGit }) {\n114:   let droppedUngrounded = 0;\n115:   let droppedMalformed = 0;\n116:   const grounded = [];\n117:   const partialTargets = [];\n118: \n119:   for (const rawItem of evidence ?? []) {\n120:     const item = {\n121:       ...rawItem,\n122:       path: typeof rawItem?.path === 'string' ? rawItem.path.replace(/^\\.\\//, '') : '',\n123:     };\n124: \n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/explorer/critic.mjs",
      "startLine": 368,
      "endLine": 415,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "runDeterministicCriticPass orchestrates validation and confidence",
      "snippet": "368: export function runDeterministicCriticPass({\n369:   normalized,\n370:   observedRanges,\n371:   observedGit,\n372:   stats,\n373:   taskKind,\n374:   maxWarnings = 3,\n375: }) {\n376:   const totalEvidenceBefore = normalized.evidence.length;\n377:   const grounding = groundEvidenceList({\n378:     evidence: normalized.evidence,\n379:     observedRanges,\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1597,
      "endLine": 1644,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Tool result tracking updates observedRanges from reads/greps/git",
      "snippet": "1597:         );\n1598: \n1599:         if (toolName === 'repo_read_file' && !safeToolResult?.error) {\n1600:           recordObservedRange(observedRanges, safeToolResult.path, safeToolResult.startLine, safeToolResult.endLine, 'read');\n1601:         }\n1602: \n1603:         if (toolName === 'repo_grep' && Array.isArray(safeToolResult?.matches)) {\n1604:           for (const match of safeToolResult.matches) {\n1605:             recordObservedRange(observedRanges, match.path, match.line, match.line, 'grep');\n1606:           }\n1607:         }\n1608: \n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "5 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 15,
    "toolCalls": 22,
    "filesRead": 10,
    "grepCalls": 11,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 18276,
    "totalTokens": 452229
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
  "query": "Find the smallest useful files and line ranges for understanding FastAPI app, orchestration, provider, and repository wiring.",
  "knownFiles": [
    "app/main.py"
  ]
}
```

### Response
```json
{
  "directAnswer": "FastAPI app uses app factory pattern with router registration, error handlers, and telemetry. Orchestration uses LangGraph with nodes wired through build_graph() and invoked from workers. Providers follow base protocol with log_sink injection via singleton service. Repositories use generic base class with AsyncSession dependency injection.",
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
    "summary": "Verified: 18 files read, 4 grep searches, 8/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
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
    "filesRead": 18,
    "grepCalls": 4,
    "listDirCalls": 2,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 18 file read(s), 4 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_0f94322d9ca2ec8c",
  "session": {
    "id": "sess_0f94322d9ca2ec8c",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "FastAPI app factory with router registration, error handlers, telemetry wiring",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 28
    },
    {
      "path": "app/orchestrator/graph.py",
      "role": "read",
      "reason": "LangGraph build_graph with node registration and edge routing",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 100
    },
    {
      "path": "app/workers/tasks.py",
      "role": "read",
      "reason": "Shows graph invocation from Celery worker with checkpointer",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 60
    },
    {
      "path": "app/providers/base.py",
      "role": "read",
      "reason": "ProviderLogSink protocol, audit dataclasses, error handling base",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 108
    },
    {
      "path": "app/providers/anthropic.py",
      "role": "read",
      "reason": "Provider __init__ showing log_sink dependency injection pattern",
      "evidenceRefs": [],
      "startLine": 37,
      "endLine": 53
    },
    {
      "path": "app/repositories/base.py",
      "role": "read",
      "reason": "Generic Repository base class with CRUD and UnitOfWork pattern",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 43
    },
    {
      "path": "app/db/session.py",
      "role": "read",
      "reason": "Database session factory and get_session() dependency function",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 18
    },
    {
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "role": "read",
      "reason": "FastAPI app factory wiring routers, error handlers, telemetry",
      "evidenceRefs": [
        "E1"
      ]
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FastAPI app factory wiring routers, error handlers, telemetry",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/orchestrator/graph.py",
      "startLine": 39,
      "endLine": 92,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "LangGraph build_graph function with node and edge wiring",
      "snippet": "39: def build_graph(\n40:     nodes: ResearchGraphNodes | None = None,\n41:     checkpointer: Any | None = None,\n42:     debug: bool = False,\n43: ):\n44:     graph_nodes = nodes or ResearchGraphNodes()\n45:     graph = StateGraph(ResearchState)\n46: \n47:     graph.add_node(\"query_understanding\", graph_nodes.query_understanding)\n48:     graph.add_node(\"planner\", graph_nodes.planner)\n49:     graph.add_node(\"plan_approval_gate\", plan_approval_gate)\n50:     graph.add_node(\"search\", graph_nodes.search)\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "app/orchestrator/graph.py",
      "startLine": 22,
      "endLine": 36,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "ResearchGraphNodes dataclass defining orchestration nodes",
      "snippet": "22: @dataclass(frozen=True)\n23: class ResearchGraphNodes:\n24:     query_understanding: ResearchNode = query_understanding_node\n25:     planner: ResearchNode = planner_node\n26:     search: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"search\"))\n27:     policy_guard: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"policy_guard\"))\n28:     fetcher: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"fetcher\"))\n29:     parser: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"parser\"))\n30:     evidence_extractor: ResearchNode = field(\n31:         default_factory=lambda: _unconfigured_node(\"evidence_extractor\")\n32:     )\n33:     synthesizer: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"synthesizer\"))\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "app/workers/tasks.py",
      "startLine": 30,
      "endLine": 38,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Graph invocation pattern from worker with checkpointer",
      "snippet": "30:     graph = build_graph(checkpointer=InMemorySaver())\n31:     result = await graph.ainvoke(\n32:         {\n33:             \"task_id\": task_uuid,\n34:             \"question\": record.question,\n35:             \"language\": record.language,\n36:         },\n37:         config={\"configurable\": {\"thread_id\": str(task_uuid)}},\n38:     )"
    },
    {
      "id": "E5",
      "path": "app/providers/base.py",
      "startLine": 57,
      "endLine": 73,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "ProviderLogSink protocol defining provider interface",
      "snippet": "57: class ProviderLogSink(Protocol):\n58:     async def record_tool_call(self, record: ToolCallAudit) -> None: ...\n59: \n60:     async def record_cost(self, record: CostAudit) -> None: ...\n61: \n62:     async def record_provider_config(self, record: ProviderConfigSnapshotAudit) -> None: ...\n63: \n64: \n65: class NullProviderLogSink:\n66:     async def record_tool_call(self, record: ToolCallAudit) -> None:\n67:         return None\n68: \n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "app/providers/anthropic.py",
      "startLine": 38,
      "endLine": 53,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Provider __init__ showing log_sink dependency injection",
      "snippet": "38:     def __init__(\n39:         self,\n40:         api_key: str,\n41:         model: str,\n42:         temperature: float,\n43:         http_client: httpx.AsyncClient | None = None,\n44:         log_sink: ProviderLogSink | None = None,\n45:         base_url: str = \"https://api.anthropic.com\",\n46:     ) -> None:\n47:         self.api_key = api_key\n48:         self.model = model\n49:         self.temperature = temperature\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "app/repositories/base.py",
      "startLine": 12,
      "endLine": 32,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Repository base class with session-based CRUD operations",
      "snippet": "12: class Repository[ModelT: Base]:\n13:     def __init__(self, session: AsyncSession, model: type[ModelT]) -> None:\n14:         self.session = session\n15:         self.model = model\n16: \n17:     async def get(self, item_id: UUID) -> ModelT | None:\n18:         return await self.session.get(self.model, item_id)\n19: \n20:     async def list(self, limit: int = 100, offset: int = 0) -> Sequence[ModelT]:\n21:         result = await self.session.scalars(select(self.model).limit(limit).offset(offset))\n22:         return result.all()\n23: \n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "app/db/session.py",
      "startLine": 11,
      "endLine": 18,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session factory and get_session() dependency function",
      "snippet": "11: engine = create_async_engine(settings.database_url, pool_pre_ping=True)\n12: AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)\n13: \n14: \n15: async def get_session() -> AsyncIterator[AsyncSession]:\n16:     async with AsyncSessionLocal() as session:\n17:         yield session\n18: "
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 10,
    "toolCalls": 24,
    "filesRead": 18,
    "grepCalls": 4,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 10473,
    "totalTokens": 138783
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
  "query": "Find the smallest useful files and line ranges for understanding Next.js app auth, websocket auth, Lambda handlers, and Prisma data model.",
  "knownFiles": [
    "websocket-server/src/middleware/auth.ts"
  ]
}
```

### Response
```json
{
  "directAnswer": "Found the smallest useful files for Next.js app auth, WebSocket auth, Lambda handlers, and Prisma data models. Key auth files: middleware.ts for route protection, auth/jwt.ts and auth/session.ts for token management, auth/api-route-access.ts for API policy, and login/route.ts for login flow. WebSocket auth: middleware/auth.ts with JWT and rate limiting. Lambda: bedrock-proxy/index.mjs shows API key auth. Prisma: User model has 2FA fields, Company model has settings.",
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
    "fileCount": 8,
    "warnings": [],
    "summary": "Verified: 15 files read, 1 grep searches, 8/8 evidence items grounded, cross-verified across 8 files. All evidence grounded in inspected code."
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
    "filesRead": 15,
    "grepCalls": 1,
    "listDirCalls": 5,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 15 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_e86cbe084ddb100c",
  "session": {
    "id": "sess_e86cbe084ddb100c",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/middleware.ts",
      "role": "context",
      "reason": "Next.js middleware with JWT verification, protected routes, and 2FA handling",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 1,
      "endLine": 170
    },
    {
      "path": "src/lib/auth/jwt.ts",
      "role": "read",
      "reason": "JWT token creation and verification utilities with payload types",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1,
      "endLine": 77
    },
    {
      "path": "src/lib/auth/session.ts",
      "role": "read",
      "reason": "Session cookie management (get, set, clear) with configuration",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 1,
      "endLine": 54
    },
    {
      "path": "src/lib/auth/api-route-access.ts",
      "role": "read",
      "reason": "API route access rules: public, session, widget-key, secret modes",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 42,
      "endLine": 118
    },
    {
      "path": "src/app/api/auth/login/route.ts",
      "role": "read",
      "reason": "Login API with rate limiting, IP whitelist, and account lockout",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 23,
      "endLine": 95
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "read",
      "reason": "WebSocket JWT auth with brute-force protection and rate limiting",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 51,
      "endLine": 121
    },
    {
      "path": "lambda/bedrock-proxy/index.mjs",
      "role": "read",
      "reason": "Lambda handler with x-api-key header authentication example",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 30,
      "endLine": 36
    },
    {
      "path": "prisma/schema.prisma",
      "role": "read",
      "reason": "User model with 2FA fields and account lockout tracking",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 78,
      "endLine": 104
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "src/middleware.ts",
      "startLine": 1,
      "endLine": 170,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows Next.js middleware auth flow with JWT verification and protected routes",
      "snippet": "1: import { NextResponse } from 'next/server'\n2: import type { NextRequest } from 'next/server'\n3: import { jwtVerify } from 'jose'\n4: import {\n5:   decideApiSessionHandling,\n6:   isApiPath,\n7:   matchesPathPrefix,\n8: } from '@/lib/auth/api-route-access'\n9: \n10: // 보호할 경로 (일반 사용자 - 인증 필요)\n11: const PROTECTED_ROUTES = [\n12:   '/dashboard',\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/lib/auth/jwt.ts",
      "startLine": 1,
      "endLine": 77,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT token creation/verification with payload types",
      "snippet": "1: import { SignJWT, jwtVerify, type JWTPayload } from 'jose'\n2: import type { UserRole } from '@/types'\n3: \n4: // JWT 페이로드 타입\n5: export interface JWTTokenPayload extends JWTPayload {\n6:   userId: string\n7:   companyId: string\n8:   companyCode?: string\n9:   role: UserRole\n10:   name?: string\n11:   pending2FA?: boolean\n12:   twoFactorChallengeId?: string\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/lib/auth/session.ts",
      "startLine": 1,
      "endLine": 54,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session cookie utilities for Next.js auth",
      "snippet": "1: import { cookies } from 'next/headers'\n2: import { verifyToken, type JWTTokenPayload } from './jwt'\n3: \n4: // 세션 쿠키 이름\n5: export const SESSION_COOKIE_NAME = 'session-token'\n6: \n7: // 세션 쿠키 옵션 (기본값)\n8: export const SESSION_COOKIE_OPTIONS = {\n9:   httpOnly: true,\n10:   secure: process.env.NODE_ENV === 'production',\n11:   sameSite: 'lax' as const,\n12:   maxAge: 60 * 60 * 24, // 24시간 (기본값)\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/lib/auth/api-route-access.ts",
      "startLine": 42,
      "endLine": 118,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Defines exact API route access rules for public/session/widget/secret modes",
      "snippet": "42: export const EXACT_API_ACCESS_RULES: readonly ApiAccessRule[] = [\n43:   {\n44:     path: '/api/auth/login',\n45:     mode: 'public',\n46:     reason: 'Login entrypoint must stay outside middleware session enforcement.',\n47:   },\n48:   {\n49:     path: '/api/auth/logout',\n50:     mode: 'public',\n51:     reason: 'Logout must clear stale cookies even when no valid session remains.',\n52:   },\n53:   {\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/app/api/auth/login/route.ts",
      "startLine": 23,
      "endLine": 95,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Login implementation with rate limiting and IP whitelist checks",
      "snippet": "23: export async function POST(request: Request) {\n24:   try {\n25:     // IP 기반 Rate Limiting\n26:     const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'\n27:     const rateLimit = checkRateLimit(ip, AUTH_RATE_LIMIT)\n28:     if (!rateLimit.allowed) {\n29:       return NextResponse.json(\n30:         { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },\n31:         { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1000)) } }\n32:       )\n33:     }\n34: \n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "WebSocket auth with JWT verification and IP-based rate limiting",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "lambda/bedrock-proxy/index.mjs",
      "startLine": 30,
      "endLine": 36,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Lambda authentication using x-api-key header against API_KEY env var",
      "snippet": "30:   const apiKey = event.headers?.['x-api-key'];\n31:   if (process.env.API_KEY && apiKey !== process.env.API_KEY) {\n32:     return {\n33:       statusCode: 401,\n34:       headers,\n35:       body: JSON.stringify({ error: 'Unauthorized' }),\n36:     };"
    },
    {
      "id": "E8",
      "path": "prisma/schema.prisma",
      "startLine": 78,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "User model fields: twoFactorEnabled, twoFactorMethod, failedLoginAttempts, lockedUntil",
      "snippet": "78: model User {\n79:   id                          String                @id @default(dbgenerated(\"uuid_generate_v4()\")) @db.Uuid\n80:   companyId                   String                @map(\"company_id\") @db.Uuid\n81:   username                    String                @db.VarChar(50)\n82:   email                       String?               @db.VarChar(100)\n83:   passwordHash                String                @map(\"password_hash\") @db.VarChar(255)\n84:   name                        String                @db.VarChar(100)\n85:   phone                       String?               @db.VarChar(20)\n86:   role                        user_role?            @default(staff)\n87:   department                  String?               @db.VarChar(100)\n88:   profileImageUrl             String?               @map(\"profile_image_url\") @db.VarChar(500)\n89:   isActive                    Boolean?              @\n... [truncated 55 chars]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 7,
    "toolCalls": 21,
    "filesRead": 15,
    "grepCalls": 1,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 11114,
    "totalTokens": 177513
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
  "query": "Find the smallest useful files and line ranges for understanding React reader state, Cloudflare Pages Functions auth, bookmarks, and exam APIs.",
  "knownFiles": [
    "src/store.tsx"
  ]
}
```

### Response
```json
{
  "directAnswer": "Found smallest useful files and line ranges: React reader state uses Zustand (src/store/slices/currents.ts). Cloudflare Pages Functions auth uses Telegram login with HMAC-SHA256 session tokens (functions/api/_lib/session.ts, telegram.ts). Bookmarks support delta sync via client_id (list.ts, sync.ts). Exam APIs track results/stats/history for authenticated users (submit.ts, stats.ts, history.ts). Security middleware protects mutating API requests.",
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
    "fileCount": 6,
    "warnings": [],
    "summary": "Verified: 14 files read, 8/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
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
    "filesRead": 14,
    "grepCalls": 0,
    "listDirCalls": 6,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 14 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_62c1b0b262e05fb5",
  "session": {
    "id": "sess_62c1b0b262e05fb5",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store/slices/currents.ts",
      "role": "read",
      "reason": "Reader state actions: setCurrentPassage, updateBookId, updateChapter, updateMode",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 81
    },
    {
      "path": "functions/api/_lib/session.ts",
      "role": "read",
      "reason": "Session creation and authentication with HMAC-SHA256 token hashing",
      "evidenceRefs": [],
      "startLine": 57,
      "endLine": 111
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "Telegram auth verification using HMAC-SHA256 and user upsert logic",
      "evidenceRefs": [],
      "startLine": 65,
      "endLine": 146
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "Telegram auth handler: validation, verification, session cookie setting",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 148,
      "endLine": 232
    },
    {
      "path": "functions/api/auth/me.ts",
      "role": "read",
      "reason": "Session inspection endpoint to restore authenticated user from cookie",
      "evidenceRefs": [],
      "startLine": 38,
      "endLine": 84
    },
    {
      "path": "functions/api/bookmarks/sync.ts",
      "role": "read",
      "reason": "Bookmark sync: upsert by client_id with conflict resolution, soft-delete",
      "evidenceRefs": [],
      "startLine": 176,
      "endLine": 269
    },
    {
      "path": "functions/api/exam/submit.ts",
      "role": "read",
      "reason": "Exam submit: validates fields, inserts result with authenticated user_id",
      "evidenceRefs": [],
      "startLine": 27,
      "endLine": 116
    },
    {
      "path": "src/store/slices/currents.ts",
      "startLine": 16,
      "endLine": 80,
      "role": "read",
      "reason": "Reader state actions for book/chapter/mode selection",
      "evidenceRefs": [
        "E1"
      ]
    }
  ],
  "discoveredPathsCount": 88,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store/slices/currents.ts",
      "startLine": 16,
      "endLine": 80,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Reader state actions for book/chapter/mode selection",
      "snippet": "16: export const createCurrentsSlice: AppStoreSlice<CurrentsActions> = (set) => ({\n17:   setCurrentPassage: (bookId, chapter) =>\n18:     set((state) => ({\n19:       currents: {\n20:         ...state.currents,\n21:         currentBookId: bookId,\n22:         currentChapter: chapter,\n23:       },\n24:     })),\n25:   updateBookId: (bookId) =>\n26:     set((state) => ({\n27:       currents: {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "functions/api/_lib/session.ts",
      "startLine": 57,
      "endLine": 78,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session creation with token hashing",
      "snippet": "57: export const createSession = async (\n58:   db: D1Database,\n59:   userId: number,\n60:   authSecret: string\n61: ): Promise<string> => {\n62:   const now = Math.floor(Date.now() / 1000);\n63:   const expiresAt = now + SESSION_MAX_AGE_SECONDS;\n64:   const sessionId = crypto.randomUUID();\n65:   const rawToken = createRawSessionToken();\n66:   const tokenHash = await hashSessionToken(rawToken, authSecret);\n67: \n68:   await db\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "functions/api/_lib/session.ts",
      "startLine": 80,
      "endLine": 111,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session authentication logic",
      "snippet": "80: export const authenticateSession = async (\n81:   request: Request,\n82:   db: D1Database,\n83:   authSecret: string\n84: ): Promise<{ sessionId: string; userId: number } | null> => {\n85:   const sessionToken = parseCookies(request)[SESSION_COOKIE_NAME];\n86:   if (!sessionToken) return null;\n87: \n88:   const tokenHash = await hashSessionToken(sessionToken, authSecret);\n89:   const now = Math.floor(Date.now() / 1000);\n90: \n91:   const session = await db\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Telegram auth verification using HMAC-SHA256",
      "snippet": "65: async function verifyTelegramAuth(\n66:   data: TelegramUser,\n67:   botToken: string\n68: ): Promise<boolean> {\n69:   const { hash, ...userData } = data;\n70: \n71:   // Create data-check-string: sorted key=value pairs joined with \\n\n72:   const dataCheckString = Object.keys(userData)\n73:     .sort()\n74:     .map((key) => `${key}=${userData[key as keyof typeof userData]}`)\n75:     .join('\\n');\n76: \n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 232,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Telegram auth handler with session creation",
      "snippet": "148: export const onRequestPost: PagesFunction<Env> = async (context) => {\n149:   const { request, env } = context;\n150: \n151:   // CORS headers\n152:   const corsHeaders = {\n153:     'Access-Control-Allow-Origin': '*',\n154:     'Access-Control-Allow-Methods': 'POST, OPTIONS',\n155:     'Access-Control-Allow-Headers': 'Content-Type',\n156:   };\n157: \n158:   // Handle OPTIONS request for CORS preflight\n159:   if (request.method === 'OPTIONS') {\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "functions/api/auth/me.ts",
      "startLine": 48,
      "endLine": 84,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session inspection endpoint",
      "snippet": "48:     const session = await authenticateSession(\n49:       context.request,\n50:       context.env.DB,\n51:       context.env.AUTH_SECRET\n52:     );\n53: \n54:     if (!session) {\n55:       return json({\n56:         success: true,\n57:         authenticated: false,\n58:         user: null,\n59:       });\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "functions/api/bookmarks/sync.ts",
      "startLine": 116,
      "endLine": 174,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark upsert with conflict resolution",
      "snippet": "116: const upsertBookmark = async (\n117:   db: D1Database,\n118:   userId: number,\n119:   bookmark: NormalizedBookmark,\n120:   syncedAt: number\n121: ): Promise<number | null> => {\n122:   const existing = await db\n123:     .prepare(\n124:       `SELECT id, updated_at FROM bookmarks\n125:        WHERE user_id = ? AND client_id = ? LIMIT 1`\n126:     )\n127:     .bind(userId, bookmark.clientId)\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "functions/api/exam/submit.ts",
      "startLine": 49,
      "endLine": 99,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Exam result insertion with user_id",
      "snippet": "49:     const session = await authenticateSession(request, env.DB, env.AUTH_SECRET);\n50:     if (!session) {\n51:       return new Response(\n52:         JSON.stringify({ error: 'Unauthorized' }),\n53:         { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }\n54:       );\n55:     }\n56: \n57:     const body = await request.json<ExamResult>();\n58: \n59:     // Validate required fields\n60:     if (\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 20,
    "filesRead": 14,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 9379,
    "totalTokens": 102282
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
  "query": "Find the smallest useful files and line ranges for understanding backend MCP/FastAPI surface, frontend auth, extension capture, and ops scripts.",
  "knownFiles": [
    "backend/mcp_server.py"
  ]
}
```

### Response
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
