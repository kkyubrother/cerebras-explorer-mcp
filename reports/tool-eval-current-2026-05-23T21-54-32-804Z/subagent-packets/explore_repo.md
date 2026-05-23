# Code-blind evaluator packet: explore_repo

You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.

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
  "task": "Explain the repository purpose and the main implementation path for MCP tool dispatch and evidence grounding. Return grounded targets that a parent coding agent should verify before editing."
}
```

### Response
```json
{
  "directAnswer": "cerebras-explorer-mcp is a Model Context Protocol server (v0.4.1) providing autonomous repository exploration tools. It returns structured JSON with grounded file:line evidence for code discovery (architecture, symbols, impact, evidence collection). Tool dispatch flows: src/index.mjs → src/mcp/server.mjs (handleRequest routes to tool wrappers) → src/explorer/runtime.mjs (ExplorerRuntime.explore manages LLM loop) → src/explorer/repo-tools.mjs (RepoToolkit.callTool dispatches to 13 repo_* tools). Evidence grounding tracks observedRanges/observedGit during tool execution, validates via src/explorer/critic.mjs, and redacts secrets via src/explorer/redact.mjs before output.",
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
    "fileCount": 6,
    "warnings": [],
    "summary": "Verified: 17 files read, 6 grep searches, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/explorer/runtime.mjs:1440-1582 before editing.",
    "target": {
      "path": "src/explorer/runtime.mjs",
      "role": "edit",
      "reason": "Exploration loop: executes LLM turns, calls repoToolkit.callTool, records evidence. Verify tracking.",
      "evidenceRefs": [],
      "startLine": 1440,
      "endLine": 1582
    }
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "tests/**",
      "examples/**"
    ],
    "scopeLimited": true,
    "filesRead": 17,
    "grepCalls": 6,
    "listDirCalls": 2,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 17 file read(s), 6 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_41936223855f3dee",
  "session": {
    "id": "sess_41936223855f3dee",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/index.mjs",
      "role": "context",
      "reason": "Entry point: starts MCP server and shutdown handler. Verify before changing bootstrap.",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 87,
      "endLine": 122
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "reference",
      "reason": "Request handler: routes tools/call to internal exploreRepository calls. Critical for dispatch.",
      "evidenceRefs": [],
      "startLine": 834,
      "endLine": 922
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "read",
      "reason": "ExplorerRuntime init: creates repoToolkit, builds tools via buildToolDefinitions. Core setup.",
      "evidenceRefs": [],
      "startLine": 1278,
      "endLine": 1342
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "edit",
      "reason": "Exploration loop: executes LLM turns, calls repoToolkit.callTool, records evidence. Verify tracking.",
      "evidenceRefs": [],
      "startLine": 1440,
      "endLine": 1582
    },
    {
      "path": "src/explorer/repo-tools.mjs",
      "role": "edit",
      "reason": "Tool dispatcher: callTool routes to repo_list_dir, repo_grep, repo_read_file with caching. Verify routing.",
      "evidenceRefs": [],
      "startLine": 1614,
      "endLine": 1682
    },
    {
      "path": "src/explorer/repo-tools.mjs",
      "role": "config",
      "reason": "Tool definitions: defines repo_* tool schemas for LLM. Verify before modifying interface.",
      "evidenceRefs": [],
      "startLine": 1371,
      "endLine": 1400
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "Evidence validation: checkEvidenceGrounding validates citations against observedRanges. Critical for integrity.",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 28,
      "endLine": 75
    },
    {
      "path": "src/explorer/redact.mjs",
      "role": "read",
      "reason": "Security: redacts API keys, tokens, JWTs, private keys from tool results. Verify before modifying rules.",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 4,
      "endLine": 17
    }
  ],
  "discoveredPathsCount": 57,
  "evidence": [
    {
      "id": "E1",
      "path": "src/index.mjs",
      "startLine": 87,
      "endLine": 122,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows main() function calling startMcpServer and shutdown handler setup.",
      "snippet": "87: export function main({\n88:   startServer = startMcpServer,\n89:   sessionStore = globalSessionStore,\n90:   logger = log,\n91:   processRef = process,\n92: } = {}) {\n93:   const transport = startServer({ logger });\n94:   logger('stdio MCP server started');\n95: \n96:   const shutdown = createShutdownHandler({\n97:     transport,\n98:     sessionStore,\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 834,
      "endLine": 878,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "handleRequest case 'tools/call' routes to callTool wrapper with validation.",
      "snippet": "834:   async function handleRequest(message) {\n835:     switch (message.method) {\n836:       case 'initialize': {\n837:         const requestedVersion = message.params?.protocolVersion;\n838:         if (typeof requestedVersion === 'string' && requestedVersion.trim()) {\n839:           negotiatedProtocolVersion = requestedVersion;\n840:         }\n841:         const toolCount = buildToolList().length;\n842:         return {\n843:           protocolVersion: negotiatedProtocolVersion,\n844:           capabilities: { tools: { listChanged: false } },\n845:           serverInfo: SERVER_INFO,\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1329,
      "endLine": 1331,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "_initExploreContext creates repoToolkit and builds tools via buildToolDefinitions.",
      "snippet": "1329:     await repoToolkit.initialize(effectiveScope);\n1330: \n1331:     const tools = repoToolkit.buildToolDefinitions();"
    },
    {
      "id": "E4",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1551,
      "endLine": 1582,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Executes tool calls via repoToolkit.callTool with TOOL_CONCURRENCY=8.",
      "snippet": "1551:       // Execute up to TOOL_CONCURRENCY tool calls in parallel\n1552:       const toolCallResults = await runWithConcurrency(\n1553:         completion.message.toolCalls,\n1554:         TOOL_CONCURRENCY,\n1555:         async (toolCall) => {\n1556:           let toolName = toolCall.function?.name ?? '(unknown)';\n1557:           let toolArgs = {};\n1558:           let toolResult;\n1559: \n1560:           // Validate tool name first — catch hallucinated tools early\n1561:           const validationError = validateToolName(toolName, knownToolNames);\n1562:           if (validationError) {\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1599,
      "endLine": 1650,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Records observedRanges from repo_read_file, repo_grep, repo_git_blame, repo_git_diff.",
      "snippet": "1599:         if (toolName === 'repo_read_file' && !safeToolResult?.error) {\n1600:           recordObservedRange(observedRanges, safeToolResult.path, safeToolResult.startLine, safeToolResult.endLine, 'read');\n1601:         }\n1602: \n1603:         if (toolName === 'repo_grep' && Array.isArray(safeToolResult?.matches)) {\n1604:           for (const match of safeToolResult.matches) {\n1605:             recordObservedRange(observedRanges, match.path, match.line, match.line, 'grep');\n1606:           }\n1607:         }\n1608: \n1609:         // Record blame lines as observed ranges\n1610:         if (toolName === 'repo_git_blame' && !safeToolResult?.error && Array.isArray(safeToolResult?.lines)) {\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/explorer/repo-tools.mjs",
      "startLine": 1614,
      "endLine": 1661,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "callTool switch dispatches to repo_list_dir, repo_find_files, repo_grep with caching.",
      "snippet": "1614:   async callTool(name, args) {\n1615:     let cacheKey;\n1616:     let ttlMs = null;\n1617: \n1618:     switch (name) {\n1619:       case 'repo_list_dir': {\n1620:         cacheKey = this._scopedCacheKey('list_dir', {\n1621:           dirPath: args?.dirPath ?? '.',\n1622:           depth: args?.depth ?? 2,\n1623:           maxEntries: args?.maxEntries ?? this.budgetConfig.maxDirectoryEntries,\n1624:         });\n1625:         const cached = this._cacheGet(cacheKey);\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/explorer/critic.mjs",
      "startLine": 28,
      "endLine": 75,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "checkEvidenceGrounding validates evidence against observedRanges with source-aware logic.",
      "snippet": "28: export function checkEvidenceGrounding(observedRanges, evidenceItem) {\n29:   const ranges = observedRanges.get(evidenceItem.path);\n30:   if (!ranges || ranges.length === 0) {\n31:     return { overlaps: false, partial: false };\n32:   }\n33: \n34:   const evidenceStart = evidenceItem.startLine;\n35:   const evidenceEnd = evidenceItem.endLine;\n36:   const evidenceLength = evidenceEnd - evidenceStart + 1;\n37:   let bestResult = { overlaps: false, partial: false };\n38: \n39:   for (const range of ranges) {\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/explorer/redact.mjs",
      "startLine": 4,
      "endLine": 17,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "REDACTION_RULES define patterns for API keys, tokens, JWTs, private keys.",
      "snippet": "4: const REDACTION_RULES = Object.freeze([\n5:   { id: 'aws-access-key', regex: /\\bAKIA[0-9A-Z]{16}\\b/g },\n6:   { id: 'github-token', regex: /\\bgh[pousr]_[A-Za-z0-9_]{36,}\\b/g },\n7:   { id: 'anthropic-api-key', regex: /\\bsk-ant-[A-Za-z0-9_-]{20,}\\b/g },\n8:   { id: 'openai-api-key', regex: /\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b/g },\n9:   { id: 'gcp-api-key', regex: /\\bAIza[0-9A-Za-z\\-_]{35}\\b/g },\n10:   { id: 'slack-token', regex: /\\bxox[baprs]-[0-9A-Za-z-]{10,}\\b/g },\n11:   { id: 'stripe-live-secret', regex: /\\bsk_live_[0-9a-zA-Z]{24,}\\b/g },\n12:   { id: 'jwt', regex: /\\beyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b/g },\n13:   {\n14:     id: 'private-key-block',\n15:     regex: /-----BEGIN ([A-Z0-9 -]*PRIVATE KEY)-----[\\s\\S]*?-----END \\1-----/g,\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 15,
    "toolCalls": 26,
    "filesRead": 17,
    "grepCalls": 6,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 19493,
    "totalTokens": 471612
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
  "task": "Explain the repository purpose and the main implementation path for FastAPI app, orchestration, provider, and repository wiring. Return grounded targets that a parent coding agent should verify before editing."
}
```

### Response
```json
{
  "directAnswer": "DeepResearch is an AI-powered research platform orchestrating multi-step verification workflows. Uses LangGraph for query understanding → planning → search → policy checks → fetching → parsing → evidence extraction → synthesis → citation validation. Tracks costs, sources, evidence, claims, producing markdown reports with validated citations.",
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
    "fileCount": 7,
    "warnings": [],
    "summary": "Verified: 12 files read, 8/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read app/repositories/base.py:12-43 before final verification.",
    "target": {
      "path": "app/repositories/base.py",
      "role": "read",
      "reason": "Generic repository base with CRUD and UnitOfWork.",
      "evidenceRefs": [
        "app/repositories/base.py:12-43",
        "8"
      ],
      "startLine": 12,
      "endLine": 43
    }
  },
  "searchCoverage": {
    "scope": [
      "app/**",
      "main.py",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 12,
    "grepCalls": 0,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 12 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_f69d901fce6f95bb",
  "session": {
    "id": "sess_f69d901fce6f95bb",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "context",
      "reason": "FastAPI factory with router registration - verify before editing.",
      "evidenceRefs": [
        "app/main.py:1-28",
        "1"
      ],
      "startLine": 1,
      "endLine": 28
    },
    {
      "path": "app/core/config.py",
      "role": "config",
      "reason": "Central settings (DB, Redis, S3, API keys) - verify defaults.",
      "evidenceRefs": [
        "app/core/config.py:1-39"
      ],
      "startLine": 1,
      "endLine": 39
    },
    {
      "path": "app/db/session.py",
      "role": "context",
      "reason": "SQLAlchemy async session factory - verify dependency injection.",
      "evidenceRefs": [
        "app/db/session.py:1-18"
      ],
      "startLine": 1,
      "endLine": 18
    },
    {
      "path": "app/orchestrator/graph.py",
      "role": "context",
      "reason": "LangGraph workflow with 8 nodes and budget gates.",
      "evidenceRefs": [
        "app/orchestrator/graph.py:1-92"
      ],
      "startLine": 1,
      "endLine": 92
    },
    {
      "path": "app/orchestrator/state.py",
      "role": "context",
      "reason": "ResearchState TypedDict defining workflow schema.",
      "evidenceRefs": [
        "app/orchestrator/state.py:92-110",
        "6"
      ],
      "startLine": 92,
      "endLine": 110
    },
    {
      "path": "app/providers/base.py",
      "role": "context",
      "reason": "Provider logging protocol - verify before adding providers.",
      "evidenceRefs": [
        "app/providers/base.py:57-90",
        "7"
      ],
      "startLine": 57,
      "endLine": 90
    },
    {
      "path": "app/repositories/base.py",
      "role": "read",
      "reason": "Generic repository base with CRUD and UnitOfWork.",
      "evidenceRefs": [
        "app/repositories/base.py:12-43",
        "8"
      ],
      "startLine": 12,
      "endLine": 43
    },
    {
      "path": "app/core/config.py",
      "startLine": 10,
      "endLine": 39,
      "role": "read",
      "reason": "Settings with database, Redis, S3, API keys, budgets.",
      "evidenceRefs": [
        "2"
      ]
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "1",
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FastAPI app factory with routers and error handlers.",
      "snippet": "1: from __future__ import annotations\n2: \n3: from fastapi import FastAPI\n4: \n5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app\n10: \n11: \n12: def create_app() -> FastAPI:\n... [snippet truncated]"
    },
    {
      "id": "2",
      "path": "app/core/config.py",
      "startLine": 10,
      "endLine": 39,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Settings with database, Redis, S3, API keys, budgets.",
      "snippet": "10: class Settings(BaseSettings):\n11:     model_config = SettingsConfigDict(env_file=\"[REDACTED:secret-path]\", env_file_encoding=\"utf-8\", extra=\"ignore\")\n12: \n13:     database_url: str = \"postgresql+asyncpg://dev:dev@localhost:5432/deepresearch\"\n14:     redis_url: str = \"redis://localhost:6379/0\"\n15: \n16:     s3_endpoint_url: AnyUrl | str = \"http://localhost:9000\"\n17:     s3_bucket: str = \"deepresearch-snapshots\"\n18:     s3_access_key: str = \"minio\"\n19:     s3_secret_key: SecretStr = SecretStr(\"miniodev\")\n20: \n21:     tavily_api_key: SecretStr | None = None\n... [snippet truncated]"
    },
    {
      "id": "3",
      "path": "app/db/session.py",
      "startLine": 11,
      "endLine": 17,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "SQLAlchemy async engine and session factory.",
      "snippet": "11: engine = create_async_engine(settings.database_url, pool_pre_ping=True)\n12: AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)\n13: \n14: \n15: async def get_session() -> AsyncIterator[AsyncSession]:\n16:     async with AsyncSessionLocal() as session:\n17:         yield session"
    },
    {
      "id": "4",
      "path": "app/orchestrator/graph.py",
      "startLine": 39,
      "endLine": 92,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "LangGraph with 8 nodes, budget gates, conditional edges.",
      "snippet": "39: def build_graph(\n40:     nodes: ResearchGraphNodes | None = None,\n41:     checkpointer: Any | None = None,\n42:     debug: bool = False,\n43: ):\n44:     graph_nodes = nodes or ResearchGraphNodes()\n45:     graph = StateGraph(ResearchState)\n46: \n47:     graph.add_node(\"query_understanding\", graph_nodes.query_understanding)\n48:     graph.add_node(\"planner\", graph_nodes.planner)\n49:     graph.add_node(\"plan_approval_gate\", plan_approval_gate)\n50:     graph.add_node(\"search\", graph_nodes.search)\n... [snippet truncated]"
    },
    {
      "id": "5",
      "path": "app/orchestrator/graph.py",
      "startLine": 95,
      "endLine": 123,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Plan approval gate with interrupt for human-in-the-loop.",
      "snippet": "95: async def plan_approval_gate(state: ResearchState) -> ResearchState:\n96:     if state.get(\"plan_approved\") is True:\n97:         return state\n98: \n99:     resume_value = interrupt(\n100:         {\n101:             \"task_id\": str(state[\"task_id\"]),\n102:             \"status\": ResearchStatus.WAITING_FOR_USER.value,\n103:             \"plan\": state.get(\"plan\"),\n104:         }\n105:     )\n106:     approved = _resume_approved(resume_value)\n... [snippet truncated]"
    },
    {
      "id": "6",
      "path": "app/orchestrator/state.py",
      "startLine": 92,
      "endLine": 110,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "ResearchState with search results, evidence, claims fields.",
      "snippet": "92: class ResearchState(TypedDict):\n93:     task_id: UUID\n94:     question: NotRequired[str]\n95:     language: NotRequired[str]\n96:     normalized_question: NotRequired[str]\n97:     search_queries: NotRequired[list[SearchQueryDraft]]\n98:     search_results: NotRequired[list[SearchResultDraft]]\n99:     allowed_search_results: NotRequired[list[SearchResultDraft]]\n100:     policy_decisions: NotRequired[list[PolicyDecisionDraft]]\n101:     source_snapshots: NotRequired[list[SourceSnapshotDraft]]\n102:     source_evaluations: NotRequired[list[SourceEvaluationDraft]]\n103:     evidence_spans: NotRequired[list[EvidenceSpanDraft]]\n... [snippet truncated]"
    },
    {
      "id": "7",
      "path": "app/providers/base.py",
      "startLine": 57,
      "endLine": 90,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "ProviderLogSink protocol for tool/cost/config logging.",
      "snippet": "57: class ProviderLogSink(Protocol):\n58:     async def record_tool_call(self, record: ToolCallAudit) -> None: ...\n59: \n60:     async def record_cost(self, record: CostAudit) -> None: ...\n61: \n62:     async def record_provider_config(self, record: ProviderConfigSnapshotAudit) -> None: ...\n63: \n64: \n65: class NullProviderLogSink:\n66:     async def record_tool_call(self, record: ToolCallAudit) -> None:\n67:         return None\n68: \n... [snippet truncated]"
    },
    {
      "id": "8",
      "path": "app/repositories/base.py",
      "startLine": 12,
      "endLine": 43,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Generic Repository[ModelT] with CRUD and UnitOfWork.",
      "snippet": "12: class Repository[ModelT: Base]:\n13:     def __init__(self, session: AsyncSession, model: type[ModelT]) -> None:\n14:         self.session = session\n15:         self.model = model\n16: \n17:     async def get(self, item_id: UUID) -> ModelT | None:\n18:         return await self.session.get(self.model, item_id)\n19: \n20:     async def list(self, limit: int = 100, offset: int = 0) -> Sequence[ModelT]:\n21:         result = await self.session.scalars(select(self.model).limit(limit).offset(offset))\n22:         return result.all()\n23: \n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "Migration schema not read - table structure unverified",
    "Celery worker config not read - async task wiring unverified",
    "Service layer not read - business logic unverified",
    "Orchestrator nodes not read - individual node logic unverified"
  ],
  "stats": {
    "turns": 5,
    "toolCalls": 15,
    "filesRead": 12,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 8265,
    "totalTokens": 67176
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
  "task": "Explain the repository purpose and the main implementation path for Next.js app auth, websocket auth, Lambda handlers, and Prisma data model. Return grounded targets that a parent coding agent should verify before editing."
}
```

### Response
```json
{
  "directAnswer": "aicc_manage is a multi-tenant AI Contact Center SaaS platform for managing AWS Lex chatbots, customer inquiries, schedules, support tickets, and billing. Uses Next.js with JWT session auth, WebSocket server for real-time features, AWS Lambda for backend services (Bedrock proxy, usage tracking, RDS metrics), and Prisma with PostgreSQL for data persistence.",
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
    "fileCount": 6,
    "warnings": [],
    "summary": "Verified: 22 files read, 1 grep searches, 8/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read prisma/schema.prisma:10-76 before final verification.",
    "target": {
      "path": "prisma/schema.prisma",
      "startLine": 10,
      "endLine": 76,
      "role": "read",
      "reason": "Company model with multi-tenant structure and AWS Lex integration",
      "evidenceRefs": [
        "E1"
      ]
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
    "filesRead": 22,
    "grepCalls": 1,
    "listDirCalls": 6,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 22 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_2cfc7781fa286b92",
  "session": {
    "id": "sess_2cfc7781fa286b92",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/middleware.ts",
      "role": "context",
      "reason": "Next.js middleware protecting routes with JWT verification and role-based access",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 1,
      "endLine": 170
    },
    {
      "path": "src/lib/auth/api-route-access.ts",
      "role": "context",
      "reason": "API route access control policy with multiple auth modes",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 341
    },
    {
      "path": "src/app/api/auth/login/route.ts",
      "role": "context",
      "reason": "Login API with rate limiting, account locking, and 2FA flow",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 365
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "WebSocket JWT authentication with brute force protection",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 132
    },
    {
      "path": "lambda/bedrock-proxy/index.mjs",
      "role": "context",
      "reason": "AWS Lambda proxy for Bedrock with API key authentication",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 1,
      "endLine": 88
    },
    {
      "path": "prisma/schema.prisma",
      "role": "context",
      "reason": "Complete Prisma schema with 40+ models and enums",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 1217
    },
    {
      "path": "prisma/schema.prisma",
      "startLine": 10,
      "endLine": 76,
      "role": "read",
      "reason": "Company model with multi-tenant structure and AWS Lex integration",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "prisma/schema.prisma",
      "startLine": 78,
      "endLine": 129,
      "role": "read",
      "reason": "User model with 2FA fields, account locking, and session relationships",
      "evidenceRefs": [
        "E2"
      ]
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "prisma/schema.prisma",
      "startLine": 10,
      "endLine": 76,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Company model with multi-tenant structure and AWS Lex integration",
      "snippet": "10: model Company {\n11:   id                    String                @id @default(dbgenerated(\"uuid_generate_v4()\")) @db.Uuid\n12:   companyCode           String                @unique @map(\"company_code\") @db.VarChar(50)\n13:   companyName           String                @map(\"company_name\") @db.VarChar(200)\n14:   businessNumber        String?               @map(\"business_number\") @db.VarChar(20)\n15:   representative        String?               @db.VarChar(100)\n16:   contactPhone          String?               @map(\"contact_phone\") @db.VarChar(20)\n17:   contactEmail          String?               @map(\"contact_email\") @db.VarChar(100)\n18:   address               String?\n19:   logoUrl               String?               @map(\"logo_url\") @db.VarChar(500)\n20:   isActive              Boolean?              @default(true) @map(\"is_active\")\n21:   settings              Json?                 @de\n... [truncated 35 chars]"
    },
    {
      "id": "E2",
      "path": "prisma/schema.prisma",
      "startLine": 78,
      "endLine": 129,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "User model with 2FA fields, account locking, and session relationships",
      "snippet": "78: model User {\n79:   id                          String                @id @default(dbgenerated(\"uuid_generate_v4()\")) @db.Uuid\n80:   companyId                   String                @map(\"company_id\") @db.Uuid\n81:   username                    String                @db.VarChar(50)\n82:   email                       String?               @db.VarChar(100)\n83:   passwordHash                String                @map(\"password_hash\") @db.VarChar(255)\n84:   name                        String                @db.VarChar(100)\n85:   phone                       String?               @db.VarChar(20)\n86:   role                        user_role?            @default(staff)\n87:   department                  String?               @db.VarChar(100)\n88:   profileImageUrl             String?               @map(\"profile_image_url\") @db.VarChar(500)\n89:   isActive                    Boolean?              @\n... [truncated 55 chars]"
    },
    {
      "id": "E3",
      "path": "prisma/schema.prisma",
      "startLine": 1022,
      "endLine": 1217,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "All enums for roles, statuses, notification types, billing, payment methods",
      "snippet": "1022: enum UserRole {\n1023:   super_admin\n1024:   admin\n1025:   manager\n1026:   staff\n1027: }\n1028: \n1029: enum InquiryStatus {\n1030:   pending\n1031:   in_progress\n1032:   scheduled\n1033:   completed\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/middleware.ts",
      "startLine": 1,
      "endLine": 170,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Route protection, JWT verification, admin routes, API rate limiting",
      "snippet": "1: import { NextResponse } from 'next/server'\n2: import type { NextRequest } from 'next/server'\n3: import { jwtVerify } from 'jose'\n4: import {\n5:   decideApiSessionHandling,\n6:   isApiPath,\n7:   matchesPathPrefix,\n8: } from '@/lib/auth/api-route-access'\n9: \n10: // 보호할 경로 (일반 사용자 - 인증 필요)\n11: const PROTECTED_ROUTES = [\n12:   '/dashboard',\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/lib/auth/api-route-access.ts",
      "startLine": 42,
      "endLine": 118,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Exact API access rules: public, session, widget-key, secret, etc.",
      "snippet": "42: export const EXACT_API_ACCESS_RULES: readonly ApiAccessRule[] = [\n43:   {\n44:     path: '/api/auth/login',\n45:     mode: 'public',\n46:     reason: 'Login entrypoint must stay outside middleware session enforcement.',\n47:   },\n48:   {\n49:     path: '/api/auth/logout',\n50:     mode: 'public',\n51:     reason: 'Logout must clear stale cookies even when no valid session remains.',\n52:   },\n53:   {\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/app/api/auth/login/route.ts",
      "startLine": 1,
      "endLine": 320,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Login with rate limiting, IP whitelist, account lockout, 2FA",
      "snippet": "1: import { NextResponse } from 'next/server'\n2: import bcrypt from 'bcryptjs'\n3: import { randomInt, randomUUID } from 'crypto'\n4: import prisma from '@/lib/db/prisma'\n5: import { loginSchema } from '@/lib/validations/auth'\n6: import { createToken, setSession } from '@/lib/auth'\n7: import {\n8:   TWO_FACTOR_PENDING_TOKEN_TTL_MINUTES,\n9:   getTwoFactorChallengeExpiresAt,\n10:   getTwoFactorCodeExpiresAt,\n11: } from '@/lib/auth/two-factor'\n12: import {\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT auth for WebSocket with IP-based brute force protection",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "lambda/bedrock-proxy/index.mjs",
      "startLine": 1,
      "endLine": 88,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bedrock proxy Lambda with x-api-key authentication and CORS",
      "snippet": "1: import {\n2:   BedrockRuntimeClient,\n3:   InvokeModelCommand,\n4: } from '@aws-sdk/client-bedrock-runtime';\n5: \n6: const client = new BedrockRuntimeClient({\n7:   region: process.env.AWS_BEDROCK_REGION || 'us-east-1',\n8: });\n9: \n10: const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';\n11: \n12: /**\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "Prisma schema is 1217 lines; reviewed key models but some edge-case constraints may exist",
    "WebSocket notification handlers not fully reviewed; assumed similar to chat handlers"
  ],
  "stats": {
    "turns": 10,
    "toolCalls": 29,
    "filesRead": 22,
    "grepCalls": 1,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 19228,
    "totalTokens": 335297
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
  "task": "Explain the repository purpose and the main implementation path for React reader state, Cloudflare Pages Functions auth, bookmarks, and exam APIs. Return grounded targets that a parent coding agent should verify before editing."
}
```

### Response
```json
{
  "directAnswer": "Bible reader web app (React + Cloudflare Pages + D1) with scripture reading, search, bookmarks, and exams. React reader state: Zustand store (src/store.tsx) with persist middleware managing settings, current passage, search, UI, and auth. Reader features in src/features/reader/ with controller hooks (useReaderController.ts, useBibleData.tsx). Cloudflare Pages Functions auth: Telegram login widget (functions/api/auth/telegram.ts) validates HMAC-SHA256 signatures, stores users in D1, and creates session tokens. Session management (functions/api/_lib/session.ts) uses HttpOnly cookies with hashed tokens. Bookmarks: Client-side bookmarks (src/features/bookmark/) sync via /api/bookmarks/sync to D1 with soft-delete support (migrations/0004_bookmarks.sql). Exam APIs: Exam system (src/features/exam/) with attempts and chapter progress syncing via /api/exam/local-sync, submissions to /api/exam/submit, history/stats endpoints. Local sync tracked in D1 (migrations/0003_exam_local_sync.sql).",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "1 evidence item(s) were removed because their line ranges were not inspected."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 7,
    "partialCount": 0,
    "droppedCount": 1,
    "fileCount": 7,
    "warnings": [
      "1 evidence item(s) were removed because their line ranges were not inspected."
    ],
    "summary": "Verified: 17 files read, 7/7 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/features/reader/hooks/useReaderController.ts:1-302 before final verification.",
    "target": {
      "path": "src/features/reader/hooks/useReaderController.ts",
      "role": "read",
      "reason": "Main reader controller orchestrating all reader interactions",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 302
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
    "filesRead": 17,
    "grepCalls": 0,
    "listDirCalls": 4,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 17 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_f73798d5c87c2a58",
  "session": {
    "id": "sess_f73798d5c87c2a58",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "context",
      "reason": "Root Zustand store with persist middleware managing app state",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 59
    },
    {
      "path": "src/features/reader/hooks/useReaderController.ts",
      "role": "read",
      "reason": "Main reader controller orchestrating all reader interactions",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 302
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "Telegram auth endpoint with HMAC-SHA256 verification",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 241
    },
    {
      "path": "functions/api/_lib/session.ts",
      "role": "read",
      "reason": "Session management utilities (create, authenticate, revoke)",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 134
    },
    {
      "path": "src/features/bookmark/types/bookmark.ts",
      "role": "context",
      "reason": "Bookmark type definitions including sync state",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 50
    },
    {
      "path": "functions/api/bookmarks/sync.ts",
      "role": "read",
      "reason": "Bookmark sync endpoint with validation and upsert logic",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 270
    },
    {
      "path": "src/features/exam/types/exam.ts",
      "role": "context",
      "reason": "Exam type definitions for attempts, progress, and sync",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 227
    },
    {
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 58,
      "role": "read",
      "reason": "Zustand store with persist middleware for settings to localStorage",
      "evidenceRefs": [
        "E1"
      ]
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 58,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Zustand store with persist middleware for settings to localStorage",
      "snippet": "30: export const useStore = create<AppStore>()(\n31:   persist(\n32:     (set, get, api) => ({\n33:       settings: INITIAL_SETTINGS,\n34:       currents: INITIAL_CURRENTS,\n35:       globals: INITIAL_GLOBALS,\n36:       search: INITIAL_SEARCH,\n37:       ui: INITIAL_UI,\n38:       auth: INITIAL_AUTH,\n39:       ...createStoreActions(set, get, api),\n40:     }),\n41:     {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/features/reader/hooks/useReaderController.ts",
      "startLine": 42,
      "endLine": 105,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Main reader controller orchestrating data, search, and navigation",
      "snippet": "42: export const useReaderController = ({\n43:   paramBookId,\n44:   paramChapter,\n45:   pathname,\n46:   locationState,\n47:   navigate,\n48:   t,\n49: }: UseReaderControllerParams) => {\n50:   const detectMobile = useMobileDetect();\n51:   const readerControllerState = useStore(selectReaderControllerState, shallow);\n52:   const {\n53:     language,\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Telegram auth verification using HMAC-SHA256 signature",
      "snippet": "65: async function verifyTelegramAuth(\n66:   data: TelegramUser,\n67:   botToken: string\n68: ): Promise<boolean> {\n69:   const { hash, ...userData } = data;\n70: \n71:   // Create data-check-string: sorted key=value pairs joined with \\n\n72:   const dataCheckString = Object.keys(userData)\n73:     .sort()\n74:     .map((key) => `${key}=${userData[key as keyof typeof userData]}`)\n75:     .join('\\n');\n76: \n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "functions/api/_lib/session.ts",
      "startLine": 80,
      "endLine": 111,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session authentication extracting and validating cookies",
      "snippet": "80: export const authenticateSession = async (\n81:   request: Request,\n82:   db: D1Database,\n83:   authSecret: string\n84: ): Promise<{ sessionId: string; userId: number } | null> => {\n85:   const sessionToken = parseCookies(request)[SESSION_COOKIE_NAME];\n86:   if (!sessionToken) return null;\n87: \n88:   const tokenHash = await hashSessionToken(sessionToken, authSecret);\n89:   const now = Math.floor(Date.now() / 1000);\n90: \n91:   const session = await db\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/features/bookmark/types/bookmark.ts",
      "startLine": 35,
      "endLine": 44,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark record structure with sync state and clientId",
      "snippet": "35: export interface BookmarkRecord {\n36:   clientId: string;\n37:   title: string;\n38:   blocks: BookmarkBlock[];\n39:   createdAt: string;\n40:   updatedAt: string;\n41:   schemaVersion: number;\n42:   syncState: BookmarkSyncState;\n43:   serverBookmarkId?: number | string | null;\n44: }"
    },
    {
      "id": "E6",
      "path": "functions/api/bookmarks/sync.ts",
      "startLine": 116,
      "endLine": 174,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark upsert logic with updatedAt conflict resolution",
      "snippet": "116: const upsertBookmark = async (\n117:   db: D1Database,\n118:   userId: number,\n119:   bookmark: NormalizedBookmark,\n120:   syncedAt: number\n121: ): Promise<number | null> => {\n122:   const existing = await db\n123:     .prepare(\n124:       `SELECT id, updated_at FROM bookmarks\n125:        WHERE user_id = ? AND client_id = ? LIMIT 1`\n126:     )\n127:     .bind(userId, bookmark.clientId)\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/features/exam/types/exam.ts",
      "startLine": 20,
      "endLine": 42,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Exam attempt record with sync state and chapter ranges",
      "snippet": "20: export interface ExamAttemptRecord {\n21:   clientId: string;\n22:   source: ExamAttemptSource;\n23:   scopeType: ExamAttemptScopeType;\n24:   bookId: number;\n25:   chapterStart: number;\n26:   chapterEnd: number;\n27:   verseStart?: number | null;\n28:   verseEnd?: number | null;\n29:   totalItems: number;\n30:   correctItems: number;\n31:   wrongItems: number;\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) were removed because their line ranges were not inspected.",
    "Some evidence items were dropped because they were not grounded in inspected line ranges."
  ],
  "stats": {
    "turns": 9,
    "toolCalls": 30,
    "filesRead": 17,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 11408,
    "totalTokens": 168335
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
  "task": "Explain the repository purpose and the main implementation path for backend MCP/FastAPI surface, frontend auth, extension capture, and ops scripts. Return grounded targets that a parent coding agent should verify before editing."
}
```

### Response
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
