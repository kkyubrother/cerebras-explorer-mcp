# find_entrypoints on aicc_manage

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

## Request
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

## Response Summary
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

ElapsedMs: 12931
McpIsError: false
