# explore_repo on cerebras-explorer-mcp

## Tool Description
Use FIRST for read-only code discovery when the exact files are unknown, the task may span 3+ files, or you need cross-file evidence: architecture, symbol usage, dependency/call tracing, bug root cause, change impact, config origin, or evidence collection. Do NOT use for a single known file/range or when immediate editing is cheaper. Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. Omit budget and hints.strategy unless required by an advanced workflow. Pass sessionId as "session" for follow-up calls.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "task": {
      "type": "string",
      "description": "Natural-language exploration request. Be specific for best results: \"How does the auth middleware validate JWT tokens and where is it applied?\" is better than \"explain auth\"."
    },
    "repo_root": {
      "type": "string",
      "description": "Repository root path. Defaults to the current working directory of the MCP server process."
    },
    "scope": {
      "type": "array",
      "description": "Path prefixes or glob patterns to focus exploration. Example: [\"src/api/**\", \"lib/auth/\"]. Omit to search the entire repo.",
      "items": {
        "type": "string"
      }
    },
    "hints": {
      "type": "object",
      "additionalProperties": false,
      "description": "Starting hints to accelerate exploration. Provide known symbols, file paths, or regex patterns so the explorer skips broad scanning.",
      "properties": {
        "symbols": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Known symbol names to start with (e.g. [\"handleAuth\", \"JwtValidator\"])."
        },
        "files": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Known file paths to examine first (e.g. [\"src/middleware/auth.ts\"])."
        },
        "regex": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Advanced only. Prefer wrapper knownText for literal anchors; use regex only when the caller already knows an exact pattern."
        },
        "strategy": {
          "type": "string",
          "enum": [
            "symbol-first",
            "reference-chase",
            "git-guided",
            "breadth-first",
            "blame-guided",
            "pattern-scan"
          ],
          "description": "Advanced only. Omit for normal agent use; strategy is auto-detected from the task and known anchors."
        }
      }
    },
    "session": {
      "type": "string",
      "description": "Optional session ID returned by a previous explore_repo call. When provided, the explorer carries over discovered file paths and prior summaries to accelerate follow-up exploration."
    },
    "language": {
      "type": "string",
      "description": "Advanced/optional. Omit for normal agent use; the explorer infers response language from the task text. Use only when a workflow must force a BCP-47 language tag such as \"ko\", \"en\", or \"ja\"."
    }
  },
  "required": [
    "task"
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
  "task": "Explain the repository purpose and the main implementation path for MCP tool dispatch and evidence grounding. Return grounded targets that a parent coding agent should verify before editing."
}
```

## Response Summary
```json
{
  "directAnswer": "cerebras-explorer-mcp is a Model Context Protocol server (v0.4.1) providing autonomous repository exploration tools. It returns structured JSON with grounded file:line evidence for code discovery (architecture, symbols, impact, evidence collection). Tool dispatch flows: src/index.mjs → src/mcp/server.mjs (handleRequest routes to tool wrappers) → src/explorer/runtime.mjs (ExplorerRuntime.explore manages LLM loop) → src/explorer/repo-tools.mjs (RepoToolkit.callTool dispatches to 13 repo_* tools). Evidence grounding tracks observedRanges/observedGit during tool execution, validates via src/explorer/critic.mjs, and redacts secrets via src/explorer/redact.mjs before output.",
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
    "summary": "Verified: 17 files read, 6 grep searches, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/explorer/runtime.mjs:1440-1582 before editing.",
    "target": {
      "path": "src/explorer/runtime.mjs",
      "role": "edit",
      "reason": "Exploration loop: executes LLM turns, calls repoToolkit.callTool, records evidence. Verify tracking.",
      "evidenceRefs": [],
      "startLine": 1440,
      "endLine": 1582
    }
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "tests/**",
      "examples/**"
    ],
    "scopeLimited": true,
    "filesRead": 17,
    "grepCalls": 6,
    "listDirCalls": 2,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 17 file read(s), 6 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_41936223855f3dee",
  "session": {
    "id": "sess_41936223855f3dee",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/index.mjs",
      "role": "context",
      "reason": "Entry point: starts MCP server and shutdown handler. Verify before changing bootstrap.",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 87,
      "endLine": 122
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "reference",
      "reason": "Request handler: routes tools/call to internal exploreRepository calls. Critical for dispatch.",
      "evidenceRefs": [],
      "startLine": 834,
      "endLine": 922
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "read",
      "reason": "ExplorerRuntime init: creates repoToolkit, builds tools via buildToolDefinitions. Core setup.",
      "evidenceRefs": [],
      "startLine": 1278,
      "endLine": 1342
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "edit",
      "reason": "Exploration loop: executes LLM turns, calls repoToolkit.callTool, records evidence. Verify tracking.",
      "evidenceRefs": [],
      "startLine": 1440,
      "endLine": 1582
    },
    {
      "path": "src/explorer/repo-tools.mjs",
      "role": "edit",
      "reason": "Tool dispatcher: callTool routes to repo_list_dir, repo_grep, repo_read_file with caching. Verify routing.",
      "evidenceRefs": [],
      "startLine": 1614,
      "endLine": 1682
    },
    {
      "path": "src/explorer/repo-tools.mjs",
      "role": "config",
      "reason": "Tool definitions: defines repo_* tool schemas for LLM. Verify before modifying interface.",
      "evidenceRefs": [],
      "startLine": 1371,
      "endLine": 1400
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "Evidence validation: checkEvidenceGrounding validates citations against observedRanges. Critical for integrity.",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 28,
      "endLine": 75
    },
    {
      "path": "src/explorer/redact.mjs",
      "role": "read",
      "reason": "Security: redacts API keys, tokens, JWTs, private keys from tool results. Verify before modifying rules.",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 4,
      "endLine": 17
    }
  ],
  "discoveredPathsCount": 57,
  "evidence": [
    {
      "id": "E1",
      "path": "src/index.mjs",
      "startLine": 87,
      "endLine": 122,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows main() function calling startMcpServer and shutdown handler setup.",
      "snippet": "87: export function main({\n88:   startServer = startMcpServer,\n89:   sessionStore = globalSessionStore,\n90:   logger = log,\n91:   processRef = process,\n92: } = {}) {\n93:   const transport = startServer({ logger });\n94:   logger('stdio MCP server started');\n95: \n96:   const shutdown = createShutdownHandler({\n97:     transport,\n98:     sessionStore,\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 834,
      "endLine": 878,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "handleRequest case 'tools/call' routes to callTool wrapper with validation.",
      "snippet": "834:   async function handleRequest(message) {\n835:     switch (message.method) {\n836:       case 'initialize': {\n837:         const requestedVersion = message.params?.protocolVersion;\n838:         if (typeof requestedVersion === 'string' && requestedVersion.trim()) {\n839:           negotiatedProtocolVersion = requestedVersion;\n840:         }\n841:         const toolCount = buildToolList().length;\n842:         return {\n843:           protocolVersion: negotiatedProtocolVersion,\n844:           capabilities: { tools: { listChanged: false } },\n845:           serverInfo: SERVER_INFO,\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1329,
      "endLine": 1331,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "_initExploreContext creates repoToolkit and builds tools via buildToolDefinitions.",
      "snippet": "1329:     await repoToolkit.initialize(effectiveScope);\n1330: \n1331:     const tools = repoToolkit.buildToolDefinitions();"
    },
    {
      "id": "E4",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1551,
      "endLine": 1582,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Executes tool calls via repoToolkit.callTool with TOOL_CONCURRENCY=8.",
      "snippet": "1551:       // Execute up to TOOL_CONCURRENCY tool calls in parallel\n1552:       const toolCallResults = await runWithConcurrency(\n1553:         completion.message.toolCalls,\n1554:         TOOL_CONCURRENCY,\n1555:         async (toolCall) => {\n1556:           let toolName = toolCall.function?.name ?? '(unknown)';\n1557:           let toolArgs = {};\n1558:           let toolResult;\n1559: \n1560:           // Validate tool name first — catch hallucinated tools early\n1561:           const validationError = validateToolName(toolName, knownToolNames);\n1562:           if (validationError) {\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1599,
      "endLine": 1650,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Records observedRanges from repo_read_file, repo_grep, repo_git_blame, repo_git_diff.",
      "snippet": "1599:         if (toolName === 'repo_read_file' && !safeToolResult?.error) {\n1600:           recordObservedRange(observedRanges, safeToolResult.path, safeToolResult.startLine, safeToolResult.endLine, 'read');\n1601:         }\n1602: \n1603:         if (toolName === 'repo_grep' && Array.isArray(safeToolResult?.matches)) {\n1604:           for (const match of safeToolResult.matches) {\n1605:             recordObservedRange(observedRanges, match.path, match.line, match.line, 'grep');\n1606:           }\n1607:         }\n1608: \n1609:         // Record blame lines as observed ranges\n1610:         if (toolName === 'repo_git_blame' && !safeToolResult?.error && Array.isArray(safeToolResult?.lines)) {\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/explorer/repo-tools.mjs",
      "startLine": 1614,
      "endLine": 1661,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "callTool switch dispatches to repo_list_dir, repo_find_files, repo_grep with caching.",
      "snippet": "1614:   async callTool(name, args) {\n1615:     let cacheKey;\n1616:     let ttlMs = null;\n1617: \n1618:     switch (name) {\n1619:       case 'repo_list_dir': {\n1620:         cacheKey = this._scopedCacheKey('list_dir', {\n1621:           dirPath: args?.dirPath ?? '.',\n1622:           depth: args?.depth ?? 2,\n1623:           maxEntries: args?.maxEntries ?? this.budgetConfig.maxDirectoryEntries,\n1624:         });\n1625:         const cached = this._cacheGet(cacheKey);\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/explorer/critic.mjs",
      "startLine": 28,
      "endLine": 75,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "checkEvidenceGrounding validates evidence against observedRanges with source-aware logic.",
      "snippet": "28: export function checkEvidenceGrounding(observedRanges, evidenceItem) {\n29:   const ranges = observedRanges.get(evidenceItem.path);\n30:   if (!ranges || ranges.length === 0) {\n31:     return { overlaps: false, partial: false };\n32:   }\n33: \n34:   const evidenceStart = evidenceItem.startLine;\n35:   const evidenceEnd = evidenceItem.endLine;\n36:   const evidenceLength = evidenceEnd - evidenceStart + 1;\n37:   let bestResult = { overlaps: false, partial: false };\n38: \n39:   for (const range of ranges) {\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/explorer/redact.mjs",
      "startLine": 4,
      "endLine": 17,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "REDACTION_RULES define patterns for API keys, tokens, JWTs, private keys.",
      "snippet": "4: const REDACTION_RULES = Object.freeze([\n5:   { id: 'aws-access-key', regex: /\\bAKIA[0-9A-Z]{16}\\b/g },\n6:   { id: 'github-token', regex: /\\bgh[pousr]_[A-Za-z0-9_]{36,}\\b/g },\n7:   { id: 'anthropic-api-key', regex: /\\bsk-ant-[A-Za-z0-9_-]{20,}\\b/g },\n8:   { id: 'openai-api-key', regex: /\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b/g },\n9:   { id: 'gcp-api-key', regex: /\\bAIza[0-9A-Za-z\\-_]{35}\\b/g },\n10:   { id: 'slack-token', regex: /\\bxox[baprs]-[0-9A-Za-z-]{10,}\\b/g },\n11:   { id: 'stripe-live-secret', regex: /\\bsk_live_[0-9a-zA-Z]{24,}\\b/g },\n12:   { id: 'jwt', regex: /\\beyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b/g },\n13:   {\n14:     id: 'private-key-block',\n15:     regex: /-----BEGIN ([A-Z0-9 -]*PRIVATE KEY)-----[\\s\\S]*?-----END \\1-----/g,\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 15,
    "toolCalls": 26,
    "filesRead": 17,
    "grepCalls": 6,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 19493,
    "totalTokens": 471612
  }
}
```

ElapsedMs: 19518
McpIsError: false
