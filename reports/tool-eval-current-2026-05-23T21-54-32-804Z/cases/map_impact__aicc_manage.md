# map_impact on aicc_manage

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
  "repo_root": "/home/kyubr/IdeaProjects/aicc_manage",
  "scope": [
    "src/**",
    "websocket-server/src/**",
    "lambda/**",
    "prisma/**",
    "scripts/**"
  ],
  "anchor": "websocket-server/src/middleware/auth.ts",
  "changeType": "refactor",
  "knownSymbols": [
    "authMiddleware"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Traced complete dependency chain for websocket-server/src/middleware/auth.ts. The authMiddleware function is directly used only in websocket-server/src/index.ts (line 146) as a Socket.IO middleware. However, its output (socket.data with userId, companyId, name, role) is deeply used across the websocket server infrastructure. No dedicated test files exist for the websocket auth middleware itself.",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
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
    "fileCount": 6,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 9 files read, 7 grep searches, 1 symbol lookups, 7/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read websocket-server/src/index.ts:146-146 before editing.",
    "target": {
      "path": "websocket-server/src/index.ts",
      "role": "edit",
      "reason": "Direct caller - registers authMiddleware with Socket.IO server",
      "evidenceRefs": [
        "e1",
        "E2"
      ],
      "startLine": 146,
      "endLine": 146
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
    "filesRead": 9,
    "grepCalls": 7,
    "listDirCalls": 2,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 9 file read(s), 7 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_8e342b965e8046e4",
  "session": {
    "id": "sess_8e342b965e8046e4",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "read",
      "reason": "Anchor file - authMiddleware function definition",
      "evidenceRefs": [
        "e0",
        "E1"
      ],
      "startLine": 51,
      "endLine": 121
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "edit",
      "reason": "Direct caller - registers authMiddleware with Socket.IO server",
      "evidenceRefs": [
        "e1",
        "E2"
      ],
      "startLine": 146,
      "endLine": 146
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "read",
      "reason": "Uses socket.data fields populated by authMiddleware for logging and rooms",
      "evidenceRefs": [
        "e2",
        "E3"
      ],
      "startLine": 149,
      "endLine": 184
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "read",
      "reason": "Destructures userId, companyId, name, role from socket.data",
      "evidenceRefs": [
        "e3",
        "E4"
      ],
      "startLine": 46,
      "endLine": 46
    },
    {
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "role": "read",
      "reason": "Uses socket.data.userId for notification read tracking",
      "evidenceRefs": [
        "e4"
      ],
      "startLine": 18,
      "endLine": 28
    },
    {
      "path": "websocket-server/src/middleware/security.ts",
      "role": "read",
      "reason": "Uses socket.data.userId for rate limiting and connection checks",
      "evidenceRefs": [
        "e5",
        "E6"
      ],
      "startLine": 91,
      "endLine": 111
    },
    {
      "path": "src/lib/auth/api-route-access.test.ts",
      "role": "test",
      "reason": "Only test file that manipulates JWT_SECRET for auth behavior",
      "evidenceRefs": [
        "e6",
        "E8"
      ],
      "startLine": 170,
      "endLine": 179
    },
    {
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "startLine": 21,
      "endLine": 26,
      "role": "read",
      "reason": "Uses socket.data.userId for notification read tracking",
      "evidenceRefs": [
        "E5"
      ]
    }
  ],
  "discoveredPathsCount": 59,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "authMiddleware function definition - validates JWT tokens and populates socket.data",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/index.ts",
      "startLine": 146,
      "endLine": 146,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Direct usage - io.use(authMiddleware) registers it as Socket.IO middleware",
      "snippet": "146: io.use(authMiddleware)"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/index.ts",
      "startLine": 149,
      "endLine": 184,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Uses all socket.data fields (userId, companyId, name, role) for logging and rooms",
      "snippet": "149: io.on('connection', (socket) => {\n150:   console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`)\n151:   console.log(`  User: ${socket.data.userId}, Company: ${socket.data.companyId}`)\n152: \n153:   // 동시 연결 수 제한 확인\n154:   if (!checkConnectionLimit(io, socket)) return\n155: \n156:   // 접속자 추적에 추가\n157:   onlineUsers.set(socket.id, {\n158:     userId: socket.data.userId,\n159:     companyId: socket.data.companyId,\n160:     name: socket.data.name,\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 46,
      "endLine": 46,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Destructures userId, companyId, name, role from socket.data for chat management",
      "snippet": "46:   const { userId, companyId, name, role } = socket.data"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/socket-handlers/notification.ts",
      "startLine": 21,
      "endLine": 26,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Uses socket.data.userId for notification read tracking",
      "snippet": "21:     console.log(`[Notification] Read: ${data.notificationId} by ${socket.data.userId}`)\n22:   })\n23: \n24:   // 모든 알림 읽음\n25:   socket.on('notifications-read-all', () => {\n26:     console.log(`[Notification] All read by ${socket.data.userId}`)"
    },
    {
      "id": "E6",
      "path": "websocket-server/src/middleware/security.ts",
      "startLine": 91,
      "endLine": 111,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Uses socket.data.userId for rate limit warnings and connection enforcement",
      "snippet": "91:       console.warn(`[Security] Socket rate limit exceeded: ${socket.id} (user: ${socket.data.userId}, event: ${eventName}, count: ${entry.count})`)\n92:       entry.warned = true\n93:     }\n94:     return false\n95:   }\n96: \n97:   return true\n98: }\n99: \n100: // ============================================================\n101: // 3. 동시 연결 수 제한\n102: // ============================================================\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Configuration requirement - JWT_SECRET environment variable must be set",
      "snippet": "24: const JWT_SECRET: string = (() => {\n25:   const secret = process.env.JWT_SECRET\n26:   if (!secret) throw new Error('JWT_SECRET must be set')\n27:   return secret\n28: })()"
    },
    {
      "id": "E8",
      "path": "src/lib/auth/api-route-access.test.ts",
      "startLine": 170,
      "endLine": 179,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Test coverage for JWT_SECRET handling - only test file related to JWT auth",
      "snippet": "170:   const originalJwtSecret = process.env.JWT_SECRET\n171:   t.after(() => {\n172:     if (originalJwtSecret === undefined) {\n173:       delete process.env.JWT_SECRET\n174:       return\n175:     }\n176:     process.env.JWT_SECRET = originalJwtSecret\n177:   })\n178: \n179:   process.env.JWT_SECRET = 'test-secret'"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) are grounded only by grep, blame, or nearby line observations.",
    "No dedicated test files found specifically testing websocket-server auth middleware",
    "WebSocket server appears to be embedded in main monorepo (no separate package.json found)"
  ],
  "stats": {
    "turns": 14,
    "toolCalls": 28,
    "filesRead": 9,
    "grepCalls": 7,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 14063,
    "totalTokens": 182182
  }
}
```

ElapsedMs: 14074
McpIsError: false
