# explain_code_path on cerebras-explorer-mcp

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

## Request
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

## Response Summary
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

ElapsedMs: 6869
McpIsError: false
