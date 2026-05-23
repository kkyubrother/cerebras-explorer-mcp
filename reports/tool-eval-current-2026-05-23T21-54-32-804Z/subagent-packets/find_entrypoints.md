# Code-blind evaluator packet: find_entrypoints

You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.

## Tool Description
Use to surface where execution starts in a repository: HTTP routes, CLI commands, cron handlers, MCP tools, or event handlers. Faster than running find_relevant_code with manual regex hints. Detection is regex-based and may include false positives — verify cited lines before acting.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "entryKind": {
      "type": "string",
      "enum": [
        "http",
        "cli",
        "cron",
        "mcp",
        "event",
        "all"
      ],
      "description": "Optional. Restrict detection to one entry kind. Defaults to \"all\"."
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
      "type": "string"
    }
  }
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
  "entryKind": "mcp"
}
```

### Response
```json
{
  "directAnswer": "Found 10 MCP tool registrations in src/mcp/server.mjs. Tools use constant-object pattern aggregated by buildToolList(). Groups: core (explore_repo, explore), specialized discovery (find_relevant_code, trace_symbol, find_entrypoints), impact analysis (map_change_impact, map_impact), evidence/context (explain_code_path, collect_evidence, review_change_context). Entry-point detection in find_entrypoints is regex-based; verify cited lines before acting.",
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
    "fileCount": 1,
    "warnings": [],
    "summary": "Verified: 3 files read, 5 grep searches, 8/8 evidence items grounded. All evidence grounded in inspected code."
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
    "grepCalls": 5,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 3 file read(s), 5 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_88f85a452ca5893d",
  "session": {
    "id": "sess_88f85a452ca5893d",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Central registry: buildToolList() aggregates all tool registrations",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 277,
      "endLine": 290
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Core tool registration: EXPLORE_REPO_TOOL definition",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 33,
      "endLine": 46
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Specialized tool: FIND_RELEVANT_CODE_TOOL definition",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 50,
      "endLine": 72
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Specialized tool: TRACE_SYMBOL_TOOL definition",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 74,
      "endLine": 96
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Impact analysis tool: MAP_CHANGE_IMPACT_TOOL definition",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 98,
      "endLine": 119
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Discovery tool: FIND_ENTRYPOINTS_TOOL definition",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 224,
      "endLine": 246
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Core tool: EXPLORE_TOOL definition",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 250,
      "endLine": 273
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Handler uses buildToolList() for tools/list and dispatch",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 859,
      "endLine": 866
    }
  ],
  "discoveredPathsCount": 7,
  "evidence": [
    {
      "id": "E1",
      "path": "src/mcp/server.mjs",
      "startLine": 277,
      "endLine": 290,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "buildToolList() returns array of all 10 tool constants - central registration entry point",
      "snippet": "277: function buildToolList() {\n278:   return [\n279:     FIND_RELEVANT_CODE_TOOL,\n280:     TRACE_SYMBOL_TOOL,\n281:     MAP_CHANGE_IMPACT_TOOL,\n282:     MAP_IMPACT_TOOL,\n283:     EXPLAIN_CODE_PATH_TOOL,\n284:     COLLECT_EVIDENCE_TOOL,\n285:     REVIEW_CHANGE_CONTEXT_TOOL,\n286:     FIND_ENTRYPOINTS_TOOL,\n287:     EXPLORE_REPO_TOOL,\n288:     EXPLORE_TOOL,\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 33,
      "endLine": 46,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EXPLORE_REPO_TOOL constant with name, description, schemas, annotations",
      "snippet": "33: const EXPLORE_REPO_TOOL = {\n34:   name: 'explore_repo',\n35:   title: 'Autonomous repository explorer',\n36:   description:\n37:     'Use FIRST for read-only code discovery when the exact files are unknown, the task may span 3+ files, or you need cross-file evidence: ' +\n38:     'architecture, symbol usage, dependency/call tracing, bug root cause, change impact, config origin, or evidence collection. ' +\n39:     'Do NOT use for a single known file/range or when immediate editing is cheaper. ' +\n40:     'Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. ' +\n41:     'After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. ' +\n42:     'Omit budget and hints.strategy unless required by an advanced workflow. Pass sessionId as \"session\" for follow-up calls.',\n43:   inputSchema: EXPLO\n... [truncated 93 chars]"
    },
    {
      "id": "E3",
      "path": "src/mcp/server.mjs",
      "startLine": 50,
      "endLine": 72,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FIND_RELEVANT_CODE_TOOL constant definition",
      "snippet": "50: const FIND_RELEVANT_CODE_TOOL = {\n51:   name: 'find_relevant_code',\n52:   title: 'Find relevant code targets',\n53:   description:\n54:     'Use first when you need to locate the files and line ranges relevant to a feature, bug, config, route, or behavior before deciding what to read or edit. ' +\n55:     'Give the natural-language query plus any known anchors. Returns targets and cited evidence; read only returned edit/read targets afterward.',\n56:   inputSchema: {\n57:     type: 'object',\n58:     additionalProperties: false,\n59:     properties: {\n60:       query: { type: 'string', description: 'What code to locate and why.' },\n61:       repo_root: { type: 'string' },\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/mcp/server.mjs",
      "startLine": 74,
      "endLine": 96,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "TRACE_SYMBOL_TOOL constant definition",
      "snippet": "74: const TRACE_SYMBOL_TOOL = {\n75:   name: 'trace_symbol',\n76:   title: 'Trace a symbol',\n77:   description:\n78:     'Use when a known function, class, variable, or type needs definition plus usage/callsite context. ' +\n79:     'Returns grounded targets and evidence without requiring a manual grep-then-read loop.',\n80:   inputSchema: {\n81:     type: 'object',\n82:     additionalProperties: false,\n83:     properties: {\n84:       symbol: {\n85:         type: 'string',\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/mcp/server.mjs",
      "startLine": 98,
      "endLine": 119,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "MAP_CHANGE_IMPACT_TOOL constant definition",
      "snippet": "98: const MAP_CHANGE_IMPACT_TOOL = {\n99:   name: 'map_change_impact',\n100:   title: 'Map change impact',\n101:   description:\n102:     'Use before editing when you know the intended change but need blast-radius context: likely edit files, callers, tests, config, and risky dependent paths. ' +\n103:     'Do not use for a one-line known-file edit.',\n104:   inputSchema: {\n105:     type: 'object',\n106:     additionalProperties: false,\n107:     properties: {\n108:       change: { type: 'string', description: 'The intended change or suspected bug fix.' },\n109:       repo_root: { type: 'string' },\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/mcp/server.mjs",
      "startLine": 224,
      "endLine": 246,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FIND_ENTRYPOINTS_TOOL constant definition with regex detection warning in description",
      "snippet": "224: const FIND_ENTRYPOINTS_TOOL = {\n225:   name: 'find_entrypoints',\n226:   title: 'Find entry points',\n227:   description:\n228:     'Use to surface where execution starts in a repository: HTTP routes, CLI commands, cron handlers, MCP tools, or event handlers. ' +\n229:     'Faster than running find_relevant_code with manual regex hints. Detection is regex-based and may include false positives — verify cited lines before acting.',\n230:   inputSchema: {\n231:     type: 'object',\n232:     additionalProperties: false,\n233:     properties: {\n234:       entryKind: {\n235:         type: 'string',\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/mcp/server.mjs",
      "startLine": 250,
      "endLine": 273,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EXPLORE_TOOL constant definition",
      "snippet": "250: const EXPLORE_TOOL = {\n251:   name: 'explore',\n252:   title: 'Free-form repository exploration',\n253:   description:\n254:     'Use for a user-facing Markdown investigation report with inline file:line citations. ' +\n255:     'Best for architecture walkthroughs, onboarding explanations, code review context, or broad \"how does X work?\" answers. ' +\n256:     'Do NOT use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead. ' +\n257:     'Omit thoroughness in normal agent use unless an advanced workflow explicitly requires quick, normal, or deep.',\n258:   inputSchema: {\n259:     type: 'object',\n260:     additionalProperties: false,\n261:     properties: {\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/mcp/server.mjs",
      "startLine": 859,
      "endLine": 866,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "tools/list handler calls buildToolList() and validates exposed tool names",
      "snippet": "859:       case 'tools/list':\n860:         return { tools: buildToolList() };\n861:       case 'tools/call': {\n862:         const name = message.params?.name;\n863:         const args = message.params?.arguments ?? {};\n864:         const progressToken = message.params?._meta?.progressToken ?? null;\n865:         const requestId = message.id ?? null;\n866:         const exposedToolNames = new Set(buildToolList().map(tool => tool.name));"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 8,
    "filesRead": 3,
    "grepCalls": 5,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 8562,
    "totalTokens": 67813
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
  "entryKind": "http"
}
```

### Response
```json
{
  "directAnswer": "Found 13 HTTP routes in this FastAPI application using decorator patterns (@app.get|post, @router.get|post). **CAVEAT**: Entry-point detection is regex-based — verify each cited line is an actual route before acting.\n\n**By Entry Kind:**\n\n1. Root Application Routes (main.py): GET / (line 6), GET /hello/{name} (line 11)\n\n2. API Router Routes (app/api/):\n   - Claims (prefix=/claims): GET /claims/{claim_id}/evidence (line 13)\n   - Plans (prefix=/tasks): POST /tasks/{task_id}/plan/approve (line 13)\n   - Sources (prefix=/sources): GET /sources (line 20), GET /sources/{source_id} (line 41)\n   - Tasks (prefix=/tasks): POST /tasks (line 39), GET /tasks/{task_id} (line 53), GET /tasks/{task_id}/events (line 61), POST /tasks/{task_id}/pause (line 77), POST /tasks/{task_id}/retry (line 89), POST /tasks/{task_id}/cancel (line 101), GET /tasks/{task_id}/report (line 113), GET /tasks/{task_id}/cost (line 125)",
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
    "summary": "Verified: 6 files read, 7 grep searches, 8/8 evidence items grounded, cross-verified across 5 files. All evidence grounded in inspected code."
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
    "grepCalls": 7,
    "listDirCalls": 2,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 6 file read(s), 7 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_4794439a0572191f",
  "session": {
    "id": "sess_4794439a0572191f",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "main.py",
      "role": "read",
      "reason": "Root application GET routes",
      "evidenceRefs": [],
      "startLine": 6,
      "endLine": 13
    },
    {
      "path": "app/api/claims.py",
      "role": "read",
      "reason": "Claims router with GET route",
      "evidenceRefs": [],
      "startLine": 10,
      "endLine": 18
    },
    {
      "path": "app/api/plans.py",
      "role": "read",
      "reason": "Plans router with POST route",
      "evidenceRefs": [],
      "startLine": 10,
      "endLine": 18
    },
    {
      "path": "app/api/sources.py",
      "role": "read",
      "reason": "Sources router with 2 GET routes",
      "evidenceRefs": [],
      "startLine": 17,
      "endLine": 46
    },
    {
      "path": "app/api/tasks.py",
      "role": "read",
      "reason": "Tasks router with 7 routes",
      "evidenceRefs": [],
      "startLine": 26,
      "endLine": 135
    },
    {
      "path": "main.py",
      "startLine": 6,
      "endLine": 6,
      "role": "read",
      "reason": "Root GET / route decorator",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "main.py",
      "startLine": 11,
      "endLine": 11,
      "role": "read",
      "reason": "GET /hello/{name} route decorator",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "app/api/claims.py",
      "startLine": 10,
      "endLine": 13,
      "role": "read",
      "reason": "Claims router prefix and GET route",
      "evidenceRefs": [
        "E3"
      ]
    }
  ],
  "discoveredPathsCount": 29,
  "evidence": [
    {
      "id": "E1",
      "path": "main.py",
      "startLine": 6,
      "endLine": 6,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Root GET / route decorator",
      "snippet": "6: @app.get(\"/\")"
    },
    {
      "id": "E2",
      "path": "main.py",
      "startLine": 11,
      "endLine": 11,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "GET /hello/{name} route decorator",
      "snippet": "11: @app.get(\"/hello/{name}\")"
    },
    {
      "id": "E3",
      "path": "app/api/claims.py",
      "startLine": 10,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Claims router prefix and GET route",
      "snippet": "10: router = APIRouter(prefix=\"/claims\", tags=[\"claims\"])\n11: \n12: \n13: @router.get(\"/{claim_id}/evidence\")"
    },
    {
      "id": "E4",
      "path": "app/api/plans.py",
      "startLine": 10,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Plans router prefix and POST route",
      "snippet": "10: router = APIRouter(prefix=\"/tasks\", tags=[\"plans\"])\n11: \n12: \n13: @router.post(\"/{task_id}/plan/approve\")"
    },
    {
      "id": "E5",
      "path": "app/api/sources.py",
      "startLine": 17,
      "endLine": 20,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Sources router prefix and GET list route",
      "snippet": "17: router = APIRouter(prefix=\"/sources\", tags=[\"sources\"])\n18: \n19: \n20: @router.get(\"\")"
    },
    {
      "id": "E6",
      "path": "app/api/sources.py",
      "startLine": 41,
      "endLine": 41,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Sources GET detail route decorator",
      "snippet": "41: @router.get(\"/{source_id}\")"
    },
    {
      "id": "E7",
      "path": "app/api/tasks.py",
      "startLine": 26,
      "endLine": 39,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tasks router prefix and POST route",
      "snippet": "26: router = APIRouter(prefix=\"/tasks\", tags=[\"tasks\"])\n27: \n28: \n29: class CreateTaskRequest(BaseModel):\n30:     question: str = Field(min_length=5, max_length=2000)\n31:     language: str = Field(min_length=2, max_length=5)\n32:     max_queries: int = Field(default=8, ge=1, le=30)\n33:     max_sources: int = Field(default=10, ge=1, le=30)\n34:     cost_budget_usd: float = Field(default=2.0, ge=0.1, le=20.0)\n35:     timeout_seconds: int = Field(default=1500, ge=60, le=3600)\n36:     plan_wait_timeout_s: int = Field(default=1800, ge=60, le=3600)\n37: \n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "app/api/tasks.py",
      "startLine": 53,
      "endLine": 61,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tasks GET routes for task and events",
      "snippet": "53: @router.get(\"/{task_id}\")\n54: async def get_task_endpoint(task_id: UUID) -> dict:\n55:     record = get_task(task_id)\n56:     if record is None:\n57:         raise ApiError(\"not_found\", \"Task not found\", status_code=404)\n58:     return serialize_task(record)\n59: \n60: \n61: @router.get(\"/{task_id}/events\")"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 16,
    "filesRead": 6,
    "grepCalls": 7,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 7560,
    "totalTokens": 56698
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
  "entryKind": "event"
}
```

### Response
```json
{
  "directAnswer": "Found 58 event handler entry points across 14 files. Entry kinds:\n\n**Socket.io Listeners (.on)** - 26 entries in websocket-server/src (connection, disconnect, SIGINT/SIGTERM) and src/lib/hooks (connect, new-message, user-joined, etc.)\n\n**DOM Listeners (addEventListener)** - 14 entries: window (resize, scroll, keydown, storage), document (visibilitychange, keydown, mousedown), service worker messages, media query changes\n\n**Node.js Listeners** - 6 entries: child process exit, HTTP request stream (data/end/error), net server one-time listeners\n\n**Event Emitters (.emit)** - 32 entries on both client and server sides\n\n⚠️ CAVEAT: Regex-based detection. Verify each line before acting; patterns can appear in strings/comments.",
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
    "exactCount": 7,
    "partialCount": 1,
    "droppedCount": 0,
    "fileCount": 7,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 3 files read, 8 grep searches, 7/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
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
    "filesRead": 3,
    "grepCalls": 8,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 3 file read(s), 8 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_6f260e52cae5b6b1",
  "session": {
    "id": "sess_6f260e52cae5b6b1",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/index.ts",
      "role": "context",
      "reason": "Main Socket.io connection handler entry point",
      "evidenceRefs": [],
      "startLine": 149,
      "endLine": 149
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "context",
      "reason": "Process SIGINT handler for graceful shutdown",
      "evidenceRefs": [],
      "startLine": 250,
      "endLine": 250
    },
    {
      "path": "src/lib/hooks/use-chat-socket.ts",
      "role": "context",
      "reason": "New message event handler on client",
      "evidenceRefs": [],
      "startLine": 124,
      "endLine": 124
    },
    {
      "path": "src/components/layout/dashboard-layout.tsx",
      "role": "context",
      "reason": "Window storage event listener",
      "evidenceRefs": [],
      "startLine": 61,
      "endLine": 61
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "context",
      "reason": "Join session socket event handler",
      "evidenceRefs": [],
      "startLine": 49,
      "endLine": 49
    },
    {
      "path": "scripts/dev-safe.mjs",
      "role": "context",
      "reason": "Child process exit event handler",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 61,
      "endLine": 61
    },
    {
      "path": "websocket-server/src/index.ts",
      "startLine": 148,
      "endLine": 151,
      "role": "read",
      "reason": "Verified Socket.io io.on('connection') handler",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "src/lib/hooks/use-chat-socket.ts",
      "startLine": 103,
      "endLine": 106,
      "role": "read",
      "reason": "Verified client socket.on('connect') handler",
      "evidenceRefs": [
        "E2"
      ]
    }
  ],
  "discoveredPathsCount": 24,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/index.ts",
      "startLine": 148,
      "endLine": 151,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Verified Socket.io io.on('connection') handler",
      "snippet": "148: // 연결 처리\n149: io.on('connection', (socket) => {\n150:   console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`)\n151:   console.log(`  User: ${socket.data.userId}, Company: ${socket.data.companyId}`)"
    },
    {
      "id": "E2",
      "path": "src/lib/hooks/use-chat-socket.ts",
      "startLine": 103,
      "endLine": 106,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Verified client socket.on('connect') handler",
      "snippet": "103:       socketRef.current.on('connect', () => {\n104:         console.log('[WebSocket] Connected:', socketRef.current?.id)\n105:         setIsConnected(true)\n106:         setConnectionError(null)"
    },
    {
      "id": "E3",
      "path": "src/components/layout/dashboard-layout.tsx",
      "startLine": 60,
      "endLine": 63,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Verified window.addEventListener('storage')",
      "snippet": "60: function subscribe(callback: () => void) {\n61:   window.addEventListener('storage', callback)\n62:   return () => window.removeEventListener('storage', callback)\n63: }"
    },
    {
      "id": "E4",
      "path": "scripts/dev-safe.mjs",
      "startLine": 61,
      "endLine": 61,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": ".on('exit') child process handler from grep",
      "snippet": "61: child.on('exit', (code, signal) => {"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/middleware/security.ts",
      "startLine": 165,
      "endLine": 176,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "req.on('data','end','error') stream handlers",
      "snippet": "165:     req.on('data', (chunk: Buffer) => {\n166:       size += chunk.length\n167:       if (size > MAX_HTTP_BODY_SIZE) {\n168:         req.destroy()\n169:         reject(new Error('Request body too large'))\n170:         return\n171:       }\n172:       body += chunk\n173:     })\n174: \n175:     req.on('end', () => resolve(body))\n176:     req.on('error', reject)"
    },
    {
      "id": "E6",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 97,
      "endLine": 97,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": ".on('send-message') from grep results",
      "snippet": "97:   socket.on('send-message', async (data: MessageData) => {"
    },
    {
      "id": "E7",
      "path": "src/lib/hooks/use-idle-timer.ts",
      "startLine": 127,
      "endLine": 129,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Multiple window activity listeners from grep",
      "snippet": "127:       window.addEventListener(event, handleActivity, { passive: true })\n128:     })\n129:     document.addEventListener('visibilitychange', handleVisibilityChange)"
    },
    {
      "id": "E8",
      "path": "websocket-server/src/index.ts",
      "startLine": 178,
      "endLine": 178,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": ".emit('user-online') from grep results",
      "snippet": "178:   socket.to(`company:${socket.data.companyId}`).emit('user-online', {"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) are grounded only by grep, blame, or nearby line observations.",
    "Regex patterns may match event handlers in strings/comments - manual verification required",
    "Dynamic event listeners in forEach loops need runtime verification",
    "No EventEmitter class usage found in scoped directories"
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 12,
    "filesRead": 3,
    "grepCalls": 8,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 12920,
    "totalTokens": 130061
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
  "entryKind": "http"
}
```

### Response
```json
{
  "directAnswer": "Found 13 HTTP route entries across 8 API endpoints using Cloudflare Pages Functions export pattern (onRequest{Method}). File paths map to URL paths under /api/.\n\n**POST (5):** /api/auth/logout, /api/auth/telegram, /api/bookmarks/sync, /api/exam/local-sync, /api/exam/submit\n**GET (5):** /api/auth/me, /api/bookmarks/list, /api/exam/history, /api/exam/local-sync, /api/exam/stats\n**OPTIONS (3 CORS):** /api/auth/me, /api/bookmarks/list, /api/bookmarks/sync\n**Middleware (1):** Catch-all for all routes\n\nRegex detection caveat: verify each cited line before acting.",
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
    "summary": "Verified: 4 files read, 17 grep searches, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 8 files. All evidence grounded in inspected code."
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
    "filesRead": 4,
    "grepCalls": 17,
    "listDirCalls": 3,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 4 file read(s), 17 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_f591e5096914a2d3",
  "session": {
    "id": "sess_f591e5096914a2d3",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "functions/_middleware.ts",
      "role": "context",
      "reason": "Catch-all middleware for all routes",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 31,
      "endLine": 31
    },
    {
      "path": "functions/api/auth/logout.ts",
      "role": "read",
      "reason": "POST /api/auth/logout handler export",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 13,
      "endLine": 13
    },
    {
      "path": "functions/api/auth/me.ts",
      "role": "read",
      "reason": "GET /api/auth/me handler export",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 38,
      "endLine": 38
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "POST /api/auth/telegram handler export",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 148,
      "endLine": 148
    },
    {
      "path": "functions/api/bookmarks/list.ts",
      "role": "read",
      "reason": "GET /api/bookmarks/list handler export",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 43,
      "endLine": 43
    },
    {
      "path": "functions/api/bookmarks/sync.ts",
      "role": "read",
      "reason": "POST /api/bookmarks/sync handler export",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 176,
      "endLine": 176
    },
    {
      "path": "functions/api/exam/submit.ts",
      "role": "read",
      "reason": "POST /api/exam/submit handler export",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 27,
      "endLine": 27
    },
    {
      "path": "functions/api/exam/stats.ts",
      "role": "read",
      "reason": "GET /api/exam/stats handler export",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 13,
      "endLine": 13
    }
  ],
  "discoveredPathsCount": 52,
  "evidence": [
    {
      "id": "E1",
      "path": "functions/_middleware.ts",
      "startLine": 31,
      "endLine": 31,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Middleware export intercepts all requests",
      "snippet": "31: export const onRequest: PagesFunction = async (context) => {"
    },
    {
      "id": "E2",
      "path": "functions/api/auth/logout.ts",
      "startLine": 13,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST /api/auth/logout handler export",
      "snippet": "13: export const onRequestPost: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E3",
      "path": "functions/api/auth/me.ts",
      "startLine": 38,
      "endLine": 38,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "GET /api/auth/me handler export",
      "snippet": "38: export const onRequestGet: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E4",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 148,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST /api/auth/telegram handler export",
      "snippet": "148: export const onRequestPost: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E5",
      "path": "functions/api/bookmarks/list.ts",
      "startLine": 43,
      "endLine": 43,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "GET /api/bookmarks/list handler export",
      "snippet": "43: export const onRequestGet: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E6",
      "path": "functions/api/bookmarks/sync.ts",
      "startLine": 176,
      "endLine": 176,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST /api/bookmarks/sync handler export",
      "snippet": "176: export const onRequestPost: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E7",
      "path": "functions/api/exam/submit.ts",
      "startLine": 27,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST /api/exam/submit handler export",
      "snippet": "27: export const onRequestPost: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E8",
      "path": "functions/api/exam/stats.ts",
      "startLine": 13,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "GET /api/exam/stats handler export",
      "snippet": "13: export const onRequestGet: PagesFunction<Env> = async (context) => {"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 10,
    "toolCalls": 26,
    "filesRead": 4,
    "grepCalls": 17,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 12365,
    "totalTokens": 89709
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
  "entryKind": "mcp"
}
```

### Response
```json
{
  "directAnswer": "All MCP tool registrations centralized in backend/app/mcp/server.py. 42 tools via @scoped_tool() wrapper calling @mcp.tool() at line 81, 7 resources via @scoped_resource() wrapper calling @mcp.resource() at line 112. No registrations in frontend, extensions, scripts, or android. ⚠️ Regex-based detection: verify cited lines before acting.",
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
    "fileCount": 1,
    "warnings": [],
    "summary": "Verified: 5 files read, 9 grep searches, 8/8 evidence items grounded. All evidence grounded in inspected code."
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
    "grepCalls": 9,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 5 file read(s), 9 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_4cbc9182a4cbae1d",
  "session": {
    "id": "sess_4cbc9182a4cbae1d",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "FastMCP server instance creation",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 76,
      "endLine": 76
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "scoped_tool decorator wrapper definition",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 79,
      "endLine": 89
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Core @mcp.tool() registration call",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 81,
      "endLine": 81
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "Custom list_tools method override",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 107,
      "endLine": 107
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "context",
      "reason": "scoped_resource decorator wrapper definition",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 110,
      "endLine": 120
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Core @mcp.resource() registration call",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 112,
      "endLine": 112
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Example: process_input tool registration",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 123,
      "endLine": 143
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Example: master-profile resource registration",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 842,
      "endLine": 847
    }
  ],
  "discoveredPathsCount": 36,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/app/mcp/server.py",
      "startLine": 76,
      "endLine": 76,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "MCP server instance creation with FastMCP",
      "snippet": "76: mcp = FastMCP(\"MaidBot\")"
    },
    {
      "id": "E2",
      "path": "backend/app/mcp/server.py",
      "startLine": 79,
      "endLine": 89,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Decorator wrapper calling @mcp.tool() internally",
      "snippet": "79: def scoped_tool(*required_scopes: str):\n80:     def _decorator(func: Callable[..., Any]):\n81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})\n82:         @wraps(func)\n83:         async def _wrapped(*args: Any, **kwargs: Any):\n84:             require_mcp_scopes(*required_scopes)\n85:             return await func(*args, **kwargs)\n86: \n87:         return _wrapped\n88: \n89:     return _decorator"
    },
    {
      "id": "E3",
      "path": "backend/app/mcp/server.py",
      "startLine": 81,
      "endLine": 81,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Actual @mcp.tool() registration call",
      "snippet": "81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})"
    },
    {
      "id": "E4",
      "path": "backend/app/mcp/server.py",
      "startLine": 107,
      "endLine": 107,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Custom list_tools override for scope filtering",
      "snippet": "107: mcp.list_tools = _list_tools_for_current_scope  # type: ignore[method-assign]"
    },
    {
      "id": "E5",
      "path": "backend/app/mcp/server.py",
      "startLine": 110,
      "endLine": 120,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Decorator wrapper calling @mcp.resource() internally",
      "snippet": "110: def scoped_resource(uri: str, *required_scopes: str):\n111:     def _decorator(func: Callable[..., Any]):\n112:         @mcp.resource(uri)\n113:         @wraps(func)\n114:         async def _wrapped(*args: Any, **kwargs: Any):\n115:             require_mcp_scopes(*required_scopes)\n116:             return await func(*args, **kwargs)\n117: \n118:         return _wrapped\n119: \n120:     return _decorator"
    },
    {
      "id": "E6",
      "path": "backend/app/mcp/server.py",
      "startLine": 112,
      "endLine": 112,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Actual @mcp.resource() registration call",
      "snippet": "112:         @mcp.resource(uri)"
    },
    {
      "id": "E7",
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 143,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tool registration: process_input via @scoped_tool()",
      "snippet": "123: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)\n124: async def process_input(\n125:     text: str | None = None,\n126:     image_base64: str | None = None,\n127:     image_mime: str | None = None,\n128:     context_enrichment: bool = False,\n129: ) -> dict:\n130:     \"\"\"주인님의 텍스트·이미지를 접수하여 AI 분석 후 지식·할일·일정으로 정리합니다.\n131: \n132:     Args:\n133:         text: 정리할 텍스트 또는 대화 기록\n134:         image_base64: Base64 인코딩된 이미지 데이터\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "backend/app/mcp/server.py",
      "startLine": 842,
      "endLine": 847,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Resource registration via @scoped_resource()",
      "snippet": "842: @scoped_resource(\"resource://master-profile/current\", MCP_SCOPE_MEMORY_READ)\n843: async def resource_master_profile_current() -> str:\n844:     \"\"\"현재 Master Profile 컨텍스트 (JSON).\"\"\"\n845:     import json\n846:     result = await tool_get_master_context()\n847:     return json.dumps(result, ensure_ascii=False, indent=2)"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 11,
    "toolCalls": 15,
    "filesRead": 5,
    "grepCalls": 9,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 14831,
    "totalTokens": 276718
  }
}
```
