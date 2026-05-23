# explain_code_path on aicc_manage

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

## Response Summary
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

ElapsedMs: 10030
McpIsError: false
