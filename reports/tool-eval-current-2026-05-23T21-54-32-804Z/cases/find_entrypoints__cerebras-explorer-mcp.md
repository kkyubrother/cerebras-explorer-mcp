# find_entrypoints on cerebras-explorer-mcp

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
  "repo_root": "/home/kyubr/IdeaProjects/cerebras-explorer-mcp",
  "scope": [
    "src/**",
    "tests/**",
    "examples/**"
  ],
  "entryKind": "mcp"
}
```

## Response Summary
```json
{
  "directAnswer": "Found 10 MCP tool registrations in src/mcp/server.mjs. Tools use constant-object pattern aggregated by buildToolList(). Groups: core (explore_repo, explore), specialized discovery (find_relevant_code, trace_symbol, find_entrypoints), impact analysis (map_change_impact, map_impact), evidence/context (explain_code_path, collect_evidence, review_change_context). Entry-point detection in find_entrypoints is regex-based; verify cited lines before acting.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 8,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 1,
    "warnings": [],
    "summary": "Verified: 3 files read, 5 grep searches, 8/8 evidence items grounded. All evidence grounded in inspected code."
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
    "filesRead": 3,
    "grepCalls": 5,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 3 file read(s), 5 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_88f85a452ca5893d",
  "session": {
    "id": "sess_88f85a452ca5893d",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Central registry: buildToolList() aggregates all tool registrations",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 277,
      "endLine": 290
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Core tool registration: EXPLORE_REPO_TOOL definition",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 33,
      "endLine": 46
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Specialized tool: FIND_RELEVANT_CODE_TOOL definition",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 50,
      "endLine": 72
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Specialized tool: TRACE_SYMBOL_TOOL definition",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 74,
      "endLine": 96
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Impact analysis tool: MAP_CHANGE_IMPACT_TOOL definition",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 98,
      "endLine": 119
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Discovery tool: FIND_ENTRYPOINTS_TOOL definition",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 224,
      "endLine": 246
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Core tool: EXPLORE_TOOL definition",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 250,
      "endLine": 273
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Handler uses buildToolList() for tools/list and dispatch",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 859,
      "endLine": 866
    }
  ],
  "discoveredPathsCount": 7,
  "evidence": [
    {
      "id": "E1",
      "path": "src/mcp/server.mjs",
      "startLine": 277,
      "endLine": 290,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "buildToolList() returns array of all 10 tool constants - central registration entry point",
      "snippet": "277: function buildToolList() {\n278:   return [\n279:     FIND_RELEVANT_CODE_TOOL,\n280:     TRACE_SYMBOL_TOOL,\n281:     MAP_CHANGE_IMPACT_TOOL,\n282:     MAP_IMPACT_TOOL,\n283:     EXPLAIN_CODE_PATH_TOOL,\n284:     COLLECT_EVIDENCE_TOOL,\n285:     REVIEW_CHANGE_CONTEXT_TOOL,\n286:     FIND_ENTRYPOINTS_TOOL,\n287:     EXPLORE_REPO_TOOL,\n288:     EXPLORE_TOOL,\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 33,
      "endLine": 46,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EXPLORE_REPO_TOOL constant with name, description, schemas, annotations",
      "snippet": "33: const EXPLORE_REPO_TOOL = {\n34:   name: 'explore_repo',\n35:   title: 'Autonomous repository explorer',\n36:   description:\n37:     'Use FIRST for read-only code discovery when the exact files are unknown, the task may span 3+ files, or you need cross-file evidence: ' +\n38:     'architecture, symbol usage, dependency/call tracing, bug root cause, change impact, config origin, or evidence collection. ' +\n39:     'Do NOT use for a single known file/range or when immediate editing is cheaper. ' +\n40:     'Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. ' +\n41:     'After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. ' +\n42:     'Omit budget and hints.strategy unless required by an advanced workflow. Pass sessionId as \"session\" for follow-up calls.',\n43:   inputSchema: EXPLO\n... [truncated 93 chars]"
    },
    {
      "id": "E3",
      "path": "src/mcp/server.mjs",
      "startLine": 50,
      "endLine": 72,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FIND_RELEVANT_CODE_TOOL constant definition",
      "snippet": "50: const FIND_RELEVANT_CODE_TOOL = {\n51:   name: 'find_relevant_code',\n52:   title: 'Find relevant code targets',\n53:   description:\n54:     'Use first when you need to locate the files and line ranges relevant to a feature, bug, config, route, or behavior before deciding what to read or edit. ' +\n55:     'Give the natural-language query plus any known anchors. Returns targets and cited evidence; read only returned edit/read targets afterward.',\n56:   inputSchema: {\n57:     type: 'object',\n58:     additionalProperties: false,\n59:     properties: {\n60:       query: { type: 'string', description: 'What code to locate and why.' },\n61:       repo_root: { type: 'string' },\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/mcp/server.mjs",
      "startLine": 74,
      "endLine": 96,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "TRACE_SYMBOL_TOOL constant definition",
      "snippet": "74: const TRACE_SYMBOL_TOOL = {\n75:   name: 'trace_symbol',\n76:   title: 'Trace a symbol',\n77:   description:\n78:     'Use when a known function, class, variable, or type needs definition plus usage/callsite context. ' +\n79:     'Returns grounded targets and evidence without requiring a manual grep-then-read loop.',\n80:   inputSchema: {\n81:     type: 'object',\n82:     additionalProperties: false,\n83:     properties: {\n84:       symbol: {\n85:         type: 'string',\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/mcp/server.mjs",
      "startLine": 98,
      "endLine": 119,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "MAP_CHANGE_IMPACT_TOOL constant definition",
      "snippet": "98: const MAP_CHANGE_IMPACT_TOOL = {\n99:   name: 'map_change_impact',\n100:   title: 'Map change impact',\n101:   description:\n102:     'Use before editing when you know the intended change but need blast-radius context: likely edit files, callers, tests, config, and risky dependent paths. ' +\n103:     'Do not use for a one-line known-file edit.',\n104:   inputSchema: {\n105:     type: 'object',\n106:     additionalProperties: false,\n107:     properties: {\n108:       change: { type: 'string', description: 'The intended change or suspected bug fix.' },\n109:       repo_root: { type: 'string' },\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/mcp/server.mjs",
      "startLine": 224,
      "endLine": 246,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FIND_ENTRYPOINTS_TOOL constant definition with regex detection warning in description",
      "snippet": "224: const FIND_ENTRYPOINTS_TOOL = {\n225:   name: 'find_entrypoints',\n226:   title: 'Find entry points',\n227:   description:\n228:     'Use to surface where execution starts in a repository: HTTP routes, CLI commands, cron handlers, MCP tools, or event handlers. ' +\n229:     'Faster than running find_relevant_code with manual regex hints. Detection is regex-based and may include false positives — verify cited lines before acting.',\n230:   inputSchema: {\n231:     type: 'object',\n232:     additionalProperties: false,\n233:     properties: {\n234:       entryKind: {\n235:         type: 'string',\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/mcp/server.mjs",
      "startLine": 250,
      "endLine": 273,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EXPLORE_TOOL constant definition",
      "snippet": "250: const EXPLORE_TOOL = {\n251:   name: 'explore',\n252:   title: 'Free-form repository exploration',\n253:   description:\n254:     'Use for a user-facing Markdown investigation report with inline file:line citations. ' +\n255:     'Best for architecture walkthroughs, onboarding explanations, code review context, or broad \"how does X work?\" answers. ' +\n256:     'Do NOT use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead. ' +\n257:     'Omit thoroughness in normal agent use unless an advanced workflow explicitly requires quick, normal, or deep.',\n258:   inputSchema: {\n259:     type: 'object',\n260:     additionalProperties: false,\n261:     properties: {\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/mcp/server.mjs",
      "startLine": 859,
      "endLine": 866,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "tools/list handler calls buildToolList() and validates exposed tool names",
      "snippet": "859:       case 'tools/list':\n860:         return { tools: buildToolList() };\n861:       case 'tools/call': {\n862:         const name = message.params?.name;\n863:         const args = message.params?.arguments ?? {};\n864:         const progressToken = message.params?._meta?.progressToken ?? null;\n865:         const requestId = message.id ?? null;\n866:         const exposedToolNames = new Set(buildToolList().map(tool => tool.name));"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 8,
    "filesRead": 3,
    "grepCalls": 5,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 8562,
    "totalTokens": 67813
  }
}
```

ElapsedMs: 8574
McpIsError: false
