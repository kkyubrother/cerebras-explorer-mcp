# map_change_impact on aicc_manage

## Tool Description
Use before editing when you know the intended change but need blast-radius context: likely edit files, callers, tests, config, and risky dependent paths. Do not use for a one-line known-file edit.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "change": {
      "type": "string",
      "description": "The intended change or suspected bug fix."
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
    "change"
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
  "change": "tighten websocket authentication and internal secret validation without breaking notification pushes",
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
  "directAnswer": "Impact mapping complete. Primary edit targets: websocket-server/src/middleware/auth.ts (JWT_SECRET validation at lines 24-28, authMiddleware at 51-121) and websocket-server/src/middleware/security.ts (validateInternalSecret at 138-153, weak secrets at 142-145). Critical path: /api/notify endpoint (index.ts 65-89) protected by validateInternalSecret, used by notification creation (src/lib/notifications/create.ts 105-126). Client connections via use-notification-socket.ts and use-chat-socket.ts use JWT tokens. No websocket-specific tests found - testing gap.",
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
    "summary": "Verified: 7 files read, 7 grep searches, 3 symbol lookups, 8/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read websocket-server/src/middleware/auth.ts:24-28 before editing.",
    "target": {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "edit",
      "reason": "JWT_SECRET config lacks weak secret validation",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 24,
      "endLine": 28
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
    "filesRead": 7,
    "grepCalls": 7,
    "listDirCalls": 0,
    "symbolCalls": 3,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 7 file read(s), 7 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_62fc8f75f36dd93b",
  "session": {
    "id": "sess_62fc8f75f36dd93b",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "edit",
      "reason": "JWT_SECRET config lacks weak secret validation",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 24,
      "endLine": 28
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "edit",
      "reason": "authMiddleware may need stricter payload validation",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 51,
      "endLine": 121
    },
    {
      "path": "websocket-server/src/middleware/security.ts",
      "role": "edit",
      "reason": "validateInternalSecret has basic weak secret blocklist",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 138,
      "endLine": 153
    },
    {
      "path": "websocket-server/src/middleware/security.ts",
      "role": "edit",
      "reason": "Weak secrets list may need expansion",
      "evidenceRefs": [],
      "startLine": 142,
      "endLine": 145
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "context",
      "reason": "Single caller: io.use(authMiddleware) for all sockets",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 146,
      "endLine": 146
    },
    {
      "path": "websocket-server/src/index.ts",
      "role": "context",
      "reason": "/api/notify endpoint - critical notification push path",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 65,
      "endLine": 89
    },
    {
      "path": "src/lib/notifications/create.ts",
      "role": "read",
      "reason": "Notification push sends INTERNAL_API_SECRET header",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 105,
      "endLine": 126
    },
    {
      "path": "src/lib/auth/jwt.ts",
      "role": "read",
      "reason": "Token creation uses HS256 with 24h expiration",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 29,
      "endLine": 45
    }
  ],
  "discoveredPathsCount": 30,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT_SECRET config: direct env read without weak check",
      "snippet": "24: const JWT_SECRET: string = (() => {\n25:   const secret = process.env.JWT_SECRET\n26:   if (!secret) throw new Error('JWT_SECRET must be set')\n27:   return secret\n28: })()"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "authMiddleware function: JWT validation logic",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/middleware/security.ts",
      "startLine": 138,
      "endLine": 153,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "validateInternalSecret: weak secret blocklist",
      "snippet": "138: export function validateInternalSecret(secret: string | undefined): boolean {\n139:   const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET\n140: \n141:   // 기본값이거나 너무 짧은 시크릿 차단\n142:   const WEAK_SECRETS = ['aicc-internal-secret', 'secret', 'test', '']\n143:   if (!INTERNAL_API_SECRET || WEAK_SECRETS.includes(INTERNAL_API_SECRET)) {\n144:     console.error('[Security] INTERNAL_API_SECRET is weak or not set. Set a strong secret in [REDACTED:secret-path]')\n145:     return false\n146:   }\n147: \n148:   if (!secret || secret !== INTERNAL_API_SECRET) {\n149:     return false\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/index.ts",
      "startLine": 146,
      "endLine": 146,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "authMiddleware usage: single caller for all sockets",
      "snippet": "146: io.use(authMiddleware)"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/index.ts",
      "startLine": 65,
      "endLine": 89,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "/api/notify endpoint: protected by validateInternalSecret",
      "snippet": "65:   // 내부 알림 푸시 API\n66:   if (req.method === 'POST' && req.url === '/api/notify') {\n67:     const secret = req.headers['x-internal-secret'] as string | undefined\n68:     if (!validateInternalSecret(secret)) {\n69:       res.writeHead(401, { 'Content-Type': 'application/json' })\n70:       res.end(JSON.stringify({ error: 'Unauthorized' }))\n71:       return\n72:     }\n73: \n74:     try {\n75:       const body = await collectBody(req)\n76:       const data = JSON.parse(body)\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/lib/notifications/create.ts",
      "startLine": 105,
      "endLine": 126,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Notification creation: sends INTERNAL_API_SECRET header",
      "snippet": "105:       fetch(`${wsUrl}/api/notify`, {\n106:         method: 'POST',\n107:         headers: {\n108:           'Content-Type': 'application/json',\n109:           'X-Internal-Secret': process.env.INTERNAL_API_SECRET || '',\n110:         },\n111:         body: JSON.stringify({\n112:           userId: params.userId,\n113:           notification: {\n114:             id: notification.id,\n115:             type: notification.type,\n116:             title: notification.title,\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/lib/auth/jwt.ts",
      "startLine": 29,
      "endLine": 45,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "createToken function: HS256, 24h expiration",
      "snippet": "29: export async function createToken(\n30:   payload: Omit<JWTTokenPayload, 'iat' | 'exp'>,\n31:   sessionTimeoutMinutes?: number\n32: ): Promise<string> {\n33:   const secret = getJwtSecret()\n34:   const expiration = sessionTimeoutMinutes\n35:     ? `${sessionTimeoutMinutes}m`\n36:     : '24h'\n37: \n38:   const token = await new SignJWT(payload)\n39:     .setProtectedHeader({ alg: 'HS256' })\n40:     .setIssuedAt()\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/lib/hooks/use-notification-socket.ts",
      "startLine": 52,
      "endLine": 63,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Client connection: sends token via auth field",
      "snippet": "52:   const connect = useCallback(() => {\n53:     if (!token || socketRef.current?.connected) return\n54: \n55:     socketRef.current = io(url, {\n56:       auth: { token },\n57:       transports: ['websocket', 'polling'],\n58:       reconnection: true,\n59:       reconnectionAttempts: 5,\n60:       reconnectionDelay: 3000,\n61:       reconnectionDelayMax: 15000,\n62:       timeout: 10000,\n63:     })"
    }
  ],
  "uncertainties": [
    "No websocket-specific unit tests found - testing gap",
    "Environment config files not found in search scope",
    "Token refresh flow impact not fully traced"
  ],
  "stats": {
    "turns": 8,
    "toolCalls": 20,
    "filesRead": 7,
    "grepCalls": 7,
    "symbolCalls": 3,
    "stoppedByBudget": false,
    "elapsedMs": 13327,
    "totalTokens": 197533
  }
}
```

ElapsedMs: 13338
McpIsError: false
