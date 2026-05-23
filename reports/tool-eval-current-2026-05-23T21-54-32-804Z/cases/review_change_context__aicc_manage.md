# review_change_context on aicc_manage

## Tool Description
Use for PR/review preparation or recent-change analysis when you need what changed, why it matters, and which files deserve review attention. Combines git-guided discovery with grounded code evidence.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "reviewGoal": {
      "type": "string",
      "description": "What to review or validate."
    },
    "since": {
      "type": "string"
    },
    "until": {
      "type": "string"
    },
    "path": {
      "type": "string"
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
  },
  "required": [
    "reviewGoal"
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
  "reviewGoal": "Review recent auth and websocket-related changes for security or behavior risk.",
  "path": "websocket-server/src/middleware/auth.ts"
}
```

## Response Summary
```json
{
  "directAnswer": "Recent WebSocket auth changes address critical security vulnerabilities: (1) Removed JWT_SECRET fallback to 'your-secret-key' which allowed auth bypass, (2) Removed query parameter token extraction to prevent log/referrer exposure, (3) Added tenant authorization validating companyId+sessionId against database for all chat events, (4) Added role-based authorization restricting agent-only operations. Broader auth fixes include: 2FA email send failure now invalidates challenges, replaced Math.random() with crypto.randomInt() for OTP/temp passwords, fixed fail-open CRON_SECRET validation to fail-closed structure. All changes are defensive security improvements.",
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
    "exactCount": 6,
    "partialCount": 2,
    "droppedCount": 0,
    "fileCount": 6,
    "warnings": [
      "2 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 4 files read, 6/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
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
    "filesRead": 4,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 4 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_51772e8c68b2fa6f",
  "session": {
    "id": "sess_51772e8c68b2fa6f",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "JWT_SECRET strict validation - IIFE throws at startup if not set, preventing auth bypass from default secret",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 24,
      "endLine": 28
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "Token extraction removed query parameter support to prevent token exposure in logs/referrers",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 67,
      "endLine": 70
    },
    {
      "path": "websocket-server/src/lib/db.ts",
      "role": "read",
      "reason": "New tenant authorization helper - validates sessionId belongs to user's companyId before granting access",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 28,
      "endLine": 44
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "context",
      "reason": "join-session handler now validates tenant ownership via findChatSession before allowing room join",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 49,
      "endLine": 61
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "context",
      "reason": "accept-chat handler adds both tenant validation and agent role check",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 160,
      "endLine": 175
    },
    {
      "path": "src/app/api/auth/login/route.ts",
      "role": "read",
      "reason": "2FA email send failure handling - invalidates challenge and returns 503 to prevent stuck state",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 276,
      "endLine": 285
    },
    {
      "path": "src/lib/utils/password.ts",
      "role": "read",
      "reason": "Cryptographically secure random generation - replaced Math.random() with crypto.randomInt()",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 1,
      "endLine": 16
    },
    {
      "path": "src/app/api/cron/data-retention/route.ts",
      "role": "read",
      "reason": "Fail-closed CRON_SECRET validation - requires super_admin session when CRON_SECRET not set",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 9,
      "endLine": 23
    }
  ],
  "discoveredPathsCount": 11,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT_SECRET validation change from commit 350728c2 - IIFE ensures startup failure if not set",
      "snippet": "24: const JWT_SECRET: string = (() => {\n25:   const secret = process.env.JWT_SECRET\n26:   if (!secret) throw new Error('JWT_SECRET must be set')\n27:   return secret\n28: })()"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 67,
      "endLine": 70,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Token extraction simplified to auth/header only, query token removed per commit 350728c2",
      "snippet": "67:     // 토큰 추출 (auth 또는 헤더에서만 — query는 로그 노출 위험으로 제외)\n68:     const token =\n69:       socket.handshake.auth.token ||\n70:       socket.handshake.headers.authorization?.replace('Bearer ', '')"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/lib/db.ts",
      "startLine": 28,
      "endLine": 44,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "New findChatSession function added in commit cae48b88 for tenant authorization",
      "snippet": "28: export async function findChatSession(\n29:   sessionId: string,\n30:   companyId: string\n31: ): Promise<ChatSessionRow | null> {\n32:   const client = await getPool().connect()\n33:   try {\n34:     const { rows } = await client.query<ChatSessionRow>(\n35:       `SELECT id, assigned_to, status\n36:        FROM chat_sessions\n37:        WHERE id = $1 AND company_id = $2\n38:        LIMIT 1`,\n39:       [sessionId, companyId]\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 49,
      "endLine": 61,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "join-session handler added tenant check in commit cae48b88",
      "snippet": "49:   socket.on('join-session', async (data: JoinSessionData) => {\n50:     const { sessionId } = data\n51: \n52:     if (!isValidSessionId(sessionId)) {\n53:       socket.emit('error', { message: '유효하지 않은 세션 ID입니다.' })\n54:       return\n55:     }\n56: \n57:     const chatSession = await findChatSession(sessionId, companyId)\n58:     if (!chatSession) {\n59:       socket.emit('error', { message: '권한이 없는 세션입니다.' })\n60:       return\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 160,
      "endLine": 175,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "accept-chat handler added tenant validation and agent role restriction in commit cae48b88",
      "snippet": "160:   socket.on('accept-chat', async (data: JoinSessionData) => {\n161:     const { sessionId } = data\n162: \n163:     if (!isValidSessionId(sessionId)) return\n164: \n165:     // 상담원 role만 허용\n166:     if (!AGENT_ROLES.has(role)) {\n167:       socket.emit('error', { message: '상담원 권한이 필요합니다.' })\n168:       return\n169:     }\n170: \n171:     const chatSession = await findChatSession(sessionId, companyId)\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/app/api/auth/login/route.ts",
      "startLine": 276,
      "endLine": 285,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "2FA email send failure handling added in commit 78785c12",
      "snippet": "276:           await sendTwoFactorCode(user.email, code)\n277:         } catch (emailError) {\n278:           console.error('2FA email send error:', emailError)\n279:           // 발송 실패 시 생성한 코드를 무효화하고 에러 반환\n280:           await prisma.twoFactorCode.updateMany({\n281:             where: { userId: user.id, used: false },\n282:             data: { used: true },\n283:           })\n284:           return NextResponse.json(\n285:             { error: '인증 코드 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' },"
    },
    {
      "id": "E7",
      "path": "src/lib/utils/password.ts",
      "startLine": 1,
      "endLine": 16,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "crypto.randomInt replaced Math.random for secure RNG in commit 7d0f1599",
      "snippet": "1: import bcrypt from 'bcryptjs'\n2: import { randomInt } from 'crypto'\n3: \n4: // 임시 비밀번호 생성 (8자리 영문+숫자)\n5: export function generateTempPassword(): string {\n6:   const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'\n7:   let password = ''\n8:   for (let i = 0; i < 8; i++) {\n9:     password += chars.charAt(randomInt(0, chars.length))\n10:   }\n11:   return password\n12: }\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/app/api/cron/data-retention/route.ts",
      "startLine": 9,
      "endLine": 23,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Fail-closed CRON_SECRET validation fixed in commit f894b841",
      "snippet": "9:     const authHeader = request.headers.get('authorization')\n10:     const cronSecret = process.env.CRON_SECRET\n11: \n12:     if (cronSecret) {\n13:       // CRON_SECRET 설정됨: Bearer 토큰 일치 여부만 확인\n14:       if (authHeader !== `Bearer ${cronSecret}`) {\n15:         return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })\n16:       }\n17:     } else {\n18:       // CRON_SECRET 미설정: 수동 실행 경로 → super_admin 세션 필수\n19:       const { getSession } = await import('@/lib/auth')\n20:       const session = await getSession()\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "2 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 7,
    "toolCalls": 12,
    "filesRead": 4,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 8573,
    "totalTokens": 98967
  }
}
```

ElapsedMs: 8585
McpIsError: false
