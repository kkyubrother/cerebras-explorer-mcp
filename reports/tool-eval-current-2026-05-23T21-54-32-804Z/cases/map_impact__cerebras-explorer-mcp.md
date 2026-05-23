# map_impact on cerebras-explorer-mcp

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

## Request
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

## Response Summary
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

ElapsedMs: 7870
McpIsError: false
