# find_relevant_code on cerebras-explorer-mcp

## Tool Description
Use first when you need to locate the files and line ranges relevant to a feature, bug, config, route, or behavior before deciding what to read or edit. Give the natural-language query plus any known anchors. Returns targets and cited evidence; read only returned edit/read targets afterward.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {
      "type": "string",
      "description": "What code to locate and why."
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
    "knownText": {
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
    "query"
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
  "query": "Find the smallest useful files and line ranges for understanding MCP tool dispatch and evidence grounding.",
  "knownFiles": [
    "src/mcp/server.mjs"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "MCP tool dispatch routes tools/call messages via a switch in server.mjs to specialized task builders, then calls exploreRepository. After tool execution, finalizeAfterToolLoop extracts structured JSON output. Evidence grounding validates each evidence item: checkEvidenceGrounding verifies overlap with observedRanges tracked from tool results (reads, greps, git operations), groundEvidenceItem assigns groundingStatus (exact/partial) by evidenceType, and groundEvidenceList filters ungrounded items. The critic pass orchestrates validation and builds evidence quality metrics.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": [
      "5 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 3,
    "partialCount": 5,
    "droppedCount": 0,
    "fileCount": 3,
    "warnings": [
      "5 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 10 files read, 11 grep searches, 3/8 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
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
    "filesRead": 10,
    "grepCalls": 11,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 10 file read(s), 11 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_4501c5cc70f503c2",
  "session": {
    "id": "sess_4501c5cc70f503c2",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "Tools/call dispatch switch routes each tool name to its handler",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 861,
      "endLine": 921
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "callTool executes exploreRepository and formats result",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 792,
      "endLine": 811
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "read",
      "reason": "finalizeAfterToolLoop extracts structured JSON from model",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 2319,
      "endLine": 2380
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "checkEvidenceGrounding validates overlap with observedRanges",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 28,
      "endLine": 76
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "groundEvidenceItem assigns groundingStatus per evidenceType",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 83,
      "endLine": 111
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "groundEvidenceList filters and returns grounded evidence list",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 113,
      "endLine": 154
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "read",
      "reason": "runDeterministicCriticPass orchestrates validation and confidence",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 368,
      "endLine": 415
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "read",
      "reason": "Tool result tracking updates observedRanges from reads/greps/git",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 1597,
      "endLine": 1644
    }
  ],
  "discoveredPathsCount": 57,
  "evidence": [
    {
      "id": "E1",
      "path": "src/mcp/server.mjs",
      "startLine": 861,
      "endLine": 921,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tools/call dispatch switch routes each tool name to handler",
      "snippet": "861:       case 'tools/call': {\n862:         const name = message.params?.name;\n863:         const args = message.params?.arguments ?? {};\n864:         const progressToken = message.params?._meta?.progressToken ?? null;\n865:         const requestId = message.id ?? null;\n866:         const exposedToolNames = new Set(buildToolList().map(tool => tool.name));\n867: \n868:         try {\n869:           if (!exposedToolNames.has(name)) {\n870:             const error = new Error(`Unknown tool: ${name}`);\n871:             error.code = -32601;\n872:             throw error;\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 792,
      "endLine": 811,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "callTool executes exploreRepository and formats result",
      "snippet": "792:   async function callTool(exploreArgs, progressToken, requestId) {\n793:     const abortController = new AbortController();\n794:     if (requestId) activeAbortControllers.set(requestId, abortController);\n795:     try {\n796:       const result = await exploreRepository(exploreArgs, {\n797:         logger,\n798:         ...runtimeOptions,\n799:         onProgress: makeProgressCallback(progressToken),\n800:         sessionStore,\n801:         abortSignal: abortController.signal,\n802:       });\n803:       const agentResult = redactExploreResult(toAgentFacingResult(result)).value;\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/explorer/runtime.mjs",
      "startLine": 2319,
      "endLine": 2380,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "finalizeAfterToolLoop extracts structured JSON from model",
      "snippet": "2319:   async finalizeAfterToolLoop({ chatClient, messages, reasoningEffort, temperature, topP, budgetConfig, abortSignal = null }) {\n2320:     const maxCompletionTokens = budgetConfig?.finalizeMaxCompletionTokens ?? 2000;\n2321:     const completion = await chatClient.createChatCompletion({\n2322:       messages: [\n2323:         ...messages,\n2324:         { role: 'user', content: buildFinalizePrompt() },\n2325:       ],\n2326:       responseFormat: {\n2327:         type: 'json_schema',\n2328:         json_schema: EXPLORE_RESULT_JSON_SCHEMA,\n2329:       },\n2330:       reasoningEffort,\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/explorer/critic.mjs",
      "startLine": 28,
      "endLine": 76,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "checkEvidenceGrounding validates overlap with observedRanges",
      "snippet": "28: export function checkEvidenceGrounding(observedRanges, evidenceItem) {\n29:   const ranges = observedRanges.get(evidenceItem.path);\n30:   if (!ranges || ranges.length === 0) {\n31:     return { overlaps: false, partial: false };\n32:   }\n33: \n34:   const evidenceStart = evidenceItem.startLine;\n35:   const evidenceEnd = evidenceItem.endLine;\n36:   const evidenceLength = evidenceEnd - evidenceStart + 1;\n37:   let bestResult = { overlaps: false, partial: false };\n38: \n39:   for (const range of ranges) {\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/explorer/critic.mjs",
      "startLine": 83,
      "endLine": 111,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "groundEvidenceItem assigns groundingStatus per evidenceType",
      "snippet": "83: export function groundEvidenceItem(item, { observedRanges, observedGit }) {\n84:   const kind = item.evidenceType ?? 'file_range';\n85: \n86:   if (kind === 'git_commit') {\n87:     const sha = item.sha ?? item.commit ?? '';\n88:     return isObservedCommit(sha, observedGit) ? { ...item, groundingStatus: 'exact' } : null;\n89:   }\n90: \n91:   if (kind === 'git_blame') {\n92:     const blameKey = `${item.path}:${item.startLine}:${item.sha ?? ''}`;\n93:     const endKey = `${item.path}:${item.endLine}:${item.sha ?? ''}`;\n94:     return observedGit.blame.has(blameKey) || observedGit.blame.has(endKey)\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/explorer/critic.mjs",
      "startLine": 113,
      "endLine": 154,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "groundEvidenceList filters and returns grounded evidence list",
      "snippet": "113: export function groundEvidenceList({ evidence, observedRanges, observedGit }) {\n114:   let droppedUngrounded = 0;\n115:   let droppedMalformed = 0;\n116:   const grounded = [];\n117:   const partialTargets = [];\n118: \n119:   for (const rawItem of evidence ?? []) {\n120:     const item = {\n121:       ...rawItem,\n122:       path: typeof rawItem?.path === 'string' ? rawItem.path.replace(/^\\.\\//, '') : '',\n123:     };\n124: \n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/explorer/critic.mjs",
      "startLine": 368,
      "endLine": 415,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "runDeterministicCriticPass orchestrates validation and confidence",
      "snippet": "368: export function runDeterministicCriticPass({\n369:   normalized,\n370:   observedRanges,\n371:   observedGit,\n372:   stats,\n373:   taskKind,\n374:   maxWarnings = 3,\n375: }) {\n376:   const totalEvidenceBefore = normalized.evidence.length;\n377:   const grounding = groundEvidenceList({\n378:     evidence: normalized.evidence,\n379:     observedRanges,\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1597,
      "endLine": 1644,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Tool result tracking updates observedRanges from reads/greps/git",
      "snippet": "1597:         );\n1598: \n1599:         if (toolName === 'repo_read_file' && !safeToolResult?.error) {\n1600:           recordObservedRange(observedRanges, safeToolResult.path, safeToolResult.startLine, safeToolResult.endLine, 'read');\n1601:         }\n1602: \n1603:         if (toolName === 'repo_grep' && Array.isArray(safeToolResult?.matches)) {\n1604:           for (const match of safeToolResult.matches) {\n1605:             recordObservedRange(observedRanges, match.path, match.line, match.line, 'grep');\n1606:           }\n1607:         }\n1608: \n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "5 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 15,
    "toolCalls": 22,
    "filesRead": 10,
    "grepCalls": 11,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 18276,
    "totalTokens": 452229
  }
}
```

ElapsedMs: 18290
McpIsError: false
