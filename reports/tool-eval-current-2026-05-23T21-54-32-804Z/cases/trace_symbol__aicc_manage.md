# trace_symbol on aicc_manage

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
  "repo_root": "/home/kyubr/IdeaProjects/aicc_manage",
  "scope": [
    "src/**",
    "websocket-server/src/**",
    "lambda/**",
    "prisma/**",
    "scripts/**"
  ],
  "symbol": "authMiddleware"
}
```

## Response Summary
```json
{
  "directAnswer": "authMiddleware is a Socket.IO authentication middleware defined in websocket-server/src/middleware/auth.ts (lines 51-121). It validates JWT tokens and implements brute-force protection by blocking IPs after 10 failed attempts for 5 minutes. Extracts token from socket.handshake.auth.token or Authorization header, verifies with JWT_SECRET, validates payload contains userId and companyId, attaches user info to socket.data. Parameters: socket: Socket, next: (err?: Error) => void. Returns void. Used in websocket-server/src/index.ts line 146 as io.use(authMiddleware).",
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
    "fileCount": 2,
    "warnings": [],
    "summary": "Verified: 2 files read, 1 grep searches, 1 symbol lookups, 5/5 evidence items grounded, cross-verified across 2 files. All evidence grounded in inspected code."
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
    "filesRead": 2,
    "grepCalls": 1,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 2 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_fa5e12b403baa5ae",
  "session": {
    "id": "sess_fa5e12b403baa5ae",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "read",
      "reason": "Definition of authMiddleware function with implementation",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 51,
      "endLine": 121
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "Imports, TokenPayload interface, JWT_SECRET, and constants",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 33
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "Helper function recordFailure for tracking auth failures",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 123,
      "endLine": 131
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "context",
      "reason": "Where authMiddleware is applied as Socket.IO middleware",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 146,
      "endLine": 146
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 1,
      "endLine": 12,
      "role": "read",
      "reason": "Imports and TokenPayload interface used by authMiddleware",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 33,
      "role": "read",
      "reason": "JWT_SECRET retrieval and brute force protection constants",
      "evidenceRefs": [
        "E3"
      ]
    }
  ],
  "discoveredPathsCount": 2,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Complete authMiddleware implementation with brute force protection",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 1,
      "endLine": 12,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Imports and TokenPayload interface used by authMiddleware",
      "snippet": "1: import { Socket } from 'socket.io'\n2: import jwt from 'jsonwebtoken'\n3: import { logger } from '../lib/logger'\n4: \n5: interface TokenPayload {\n6:   userId: string\n7:   companyId: string\n8:   role: string\n9:   name: string\n10:   iat?: number\n11:   exp?: number\n12: }"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 33,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT_SECRET retrieval and brute force protection constants",
      "snippet": "24: const JWT_SECRET: string = (() => {\n25:   const secret = process.env.JWT_SECRET\n26:   if (!secret) throw new Error('JWT_SECRET must be set')\n27:   return secret\n28: })()\n29: \n30: // 인증 실패 추적 (IP별 실패 횟수)\n31: const authFailures = new Map<string, { count: number; lastAttempt: number }>()\n32: const AUTH_BLOCK_THRESHOLD = 10 // 10회 실패 시 차단\n33: const AUTH_BLOCK_DURATION = 5 * 60_000 // 5분"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 123,
      "endLine": 131,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "recordFailure helper function for tracking auth failures per IP",
      "snippet": "123: function recordFailure(ip: string) {\n124:   const existing = authFailures.get(ip)\n125:   if (existing) {\n126:     existing.count++\n127:     existing.lastAttempt = Date.now()\n128:   } else {\n129:     authFailures.set(ip, { count: 1, lastAttempt: Date.now() })\n130:   }\n131: }"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/index.ts",
      "startLine": 146,
      "endLine": 146,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Where authMiddleware is applied as middleware to Socket.IO server",
      "snippet": "146: io.use(authMiddleware)"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 5,
    "toolCalls": 4,
    "filesRead": 2,
    "grepCalls": 1,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 6451,
    "totalTokens": 38688
  }
}
```

ElapsedMs: 6461
McpIsError: false
