# trace_symbol on cerebras-explorer-mcp

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

## Request
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

## Response Summary
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

ElapsedMs: 7827
McpIsError: false
