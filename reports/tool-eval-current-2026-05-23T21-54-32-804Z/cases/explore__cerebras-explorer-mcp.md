# explore on cerebras-explorer-mcp

## Tool Description
Use for a user-facing Markdown investigation report with inline file:line citations. Best for architecture walkthroughs, onboarding explanations, code review context, or broad "how does X work?" answers. Do NOT use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead. Omit thoroughness in normal agent use unless an advanced workflow explicitly requires quick, normal, or deep.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "prompt": {
      "type": "string",
      "description": "What to explore — a natural-language question or task."
    },
    "thoroughness": {
      "type": "string",
      "enum": [
        "quick",
        "normal",
        "deep"
      ],
      "description": "Advanced only. Omit for normal agent use; defaults to normal report depth."
    },
    "scope": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional path prefixes to focus on."
    },
    "repo_root": {
      "type": "string",
      "description": "Repository root path."
    },
    "session": {
      "type": "string",
      "description": "Session ID from a previous call."
    },
    "language": {
      "type": "string",
      "description": "BCP-47 language tag for the report (e.g. \"ko\", \"en\")."
    },
    "context": {
      "type": "string",
      "description": "Optional additional context from the parent agent."
    }
  },
  "required": [
    "prompt"
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
  "prompt": "Give a concise architecture report for MCP tool dispatch and evidence grounding. Include inline file:line citations and flag uncertainty.",
  "language": "en"
}
```

## Response Summary
```json
{
  "reportPreview": "Now I have sufficient evidence to produce the architecture report.\n\n---\n\n# Architecture Report: MCP Tool Dispatch and Evidence Grounding\n\n## Summary\n\nThe cerebras-explorer-mcp server implements a JSON-RPC-based MCP tool dispatch architecture with a two-layer grounding system. The `StdioJsonRpcServer` handles transport protocol (Content-Length framing or NDJSON), while `ExplorerRuntime` orchestrates LLM-driven exploration by dispatching repository tools through `RepoToolkit`. Evidence grounding is implemented via runtime observation tracking (`observedRanges` Map) and post-processing validation through `critic.mjs`, which validates LLM-generated citations against actually-executed tool results.\n\n## Findings\n\n### 1. MCP Tool Dispatch Architecture\n\n#### 1.1 Transport Layer (`src/mcp/jsonrpc-stdio.mjs`)\n- **Dual protocol support**: Auto-detects and handles both Content-Length framed JSON-RPC and newline-delimited JSON (NDJSON) `src/mcp/jsonrpc-stdio.mjs:L59-L124`\n- **Fire-and-forget dispatch**: Messages are processed concurrently; stdout ordering is serialized via a promise chain `_sendQueue` to prevent interleaving `src/mcp/jsonrpc-stdio.mjs:L80-L84,L169-L181`\n- **Request routing**: `dispatchMessage()` routes requests with an `id` field to `handleRequest()`, notifications to `handleNotification()` `src/mcp/jsonrpc-stdio.mjs:L128-L160`\n\n#### 1.2 Tool Registration (`src/mcp/server.mjs`)\n- **Tool definitions**: Seven high-level tools are registered: `explore_repo`, `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `map_impact` `src/mcp/server.mjs:L33-L472`\n- **Tool mapping**: Each high-level tool maps to the same `exploreRepository()` runtime but with different `taskMode` and constructed task text `src/mcp/server.mjs:L346-L442`\n- **Read-only enforcement**: All tools carry `readOnlyHint: true`, `destructiveHint: false` annotations `src/mcp/server.mjs:L17-L29`\n\n#### 1.3 Runtime Orchestration (`src/explorer/runtime.mjs`)\n- **ExplorerRuntime class**: Main orchestrator initialized with chat client and logger `src/explorer/runtime.mjs:L1278-L1287`\n- **Context initialization**: `_initExploreContext()` creates RepoToolkit, resolves sessions, loads project config, and builds tool definitions `src/explorer/runtime.mjs:L1294-L1342`\n- **Turn-based execution**: `explore()` method runs LLM conversation loops, executing tool calls in parallel with concurrency limit `TOOL_CONCURRENCY=8` `src/explorer/runtime.mjs:L1351-L1400,L1552-L1582`\n\n#### 1.4 Tool Execution (`src/explorer/repo-tools.mjs`)\n- **Tool \n... [truncated 6284 chars]",
  "citations": [
    {
      "type": "file_range",
      "path": "src/mcp/jsonrpc-stdio.mjs",
      "startLine": 59,
      "endLine": 124,
      "raw": "`src/mcp/jsonrpc-stdio.mjs:L59-L124`"
    },
    {
      "type": "file_range",
      "path": "src/mcp/jsonrpc-stdio.mjs",
      "startLine": 80,
      "endLine": 84,
      "raw": "`src/mcp/jsonrpc-stdio.mjs:L80-L84"
    },
    {
      "type": "file_range",
      "path": "src/mcp/jsonrpc-stdio.mjs",
      "startLine": 128,
      "endLine": 160,
      "raw": "`src/mcp/jsonrpc-stdio.mjs:L128-L160`"
    },
    {
      "type": "file_range",
      "path": "src/mcp/server.mjs",
      "startLine": 33,
      "endLine": 472,
      "raw": "`src/mcp/server.mjs:L33-L472`"
    },
    {
      "type": "file_range",
      "path": "src/mcp/server.mjs",
      "startLine": 346,
      "endLine": 442,
      "raw": "`src/mcp/server.mjs:L346-L442`"
    },
    {
      "type": "file_range",
      "path": "src/mcp/server.mjs",
      "startLine": 17,
      "endLine": 29,
      "raw": "`src/mcp/server.mjs:L17-L29`"
    },
    {
      "type": "file_range",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1278,
      "endLine": 1287,
      "raw": "`src/explorer/runtime.mjs:L1278-L1287`"
    },
    {
      "type": "file_range",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1294,
      "endLine": 1342,
      "raw": "`src/explorer/runtime.mjs:L1294-L1342`"
    },
    {
      "type": "file_range",
      "path": "src/explorer/runtime.mjs",
      "startLine": 1351,
      "endLine": 1400,
      "raw": "`src/explorer/runtime.mjs:L1351-L1400"
    },
    {
      "type": "file_range",
      "path": "src/explorer/repo-tools.mjs",
      "startLine": 1371,
      "endLine": 1450,
      "raw": "`src/explorer/repo-tools.mjs:L1371-L1450`"
    },
    {
      "type": "file_range",
      "path": "src/explorer/repo-tools.mjs",
      "startLine": 1614,
      "endLine": 1720,
      "raw": "`src/explorer/repo-tools.mjs:L1614-L1720`"
    },
    {
      "type": "file_range",
      "path": "src/explorer/repo-tools.mjs",
      "startLine": 1615,
      "endLine": 1696,
      "raw": "`src/explorer/repo-tools.mjs:L1615-L1696`"
    }
  ],
  "targets": [
    {
      "path": "src/mcp/jsonrpc-stdio.mjs",
      "role": "reference",
      "reason": "Markdown report citations merged from 3 ranges.",
      "evidenceRefs": [],
      "startLine": 59,
      "endLine": 160
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "reference",
      "reason": "Markdown report citations merged from 3 ranges.",
      "evidenceRefs": [],
      "startLine": 17,
      "endLine": 472
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "reference",
      "reason": "Markdown report citations merged from 16 ranges.",
      "evidenceRefs": [],
      "startLine": 1209,
      "endLine": 1669
    },
    {
      "path": "src/explorer/repo-tools.mjs",
      "role": "reference",
      "reason": "Markdown report citations merged from 4 ranges.",
      "evidenceRefs": [],
      "startLine": 1371,
      "endLine": 1720
    },
    {
      "path": "src/explorer/critic.mjs",
      "role": "reference",
      "reason": "Markdown report citations merged from 6 ranges.",
      "evidenceRefs": [],
      "startLine": 28,
      "endLine": 200
    },
    {
      "path": "src/explorer/schemas.mjs",
      "role": "reference",
      "reason": "Markdown report citations merged from 2 ranges.",
      "evidenceRefs": [],
      "startLine": 247,
      "endLine": 305
    }
  ],
  "filesRead": [
    "src/mcp/server.mjs",
    "src/mcp/jsonrpc-stdio.mjs",
    "src/explorer/runtime.mjs",
    "src/index.mjs",
    "src/explorer/repo-tools.mjs",
    "src/explorer/schemas.mjs",
    "src/explorer/critic.mjs",
    "src/explorer/transcript.mjs"
  ],
  "toolsUsed": [
    "repo_list_dir",
    "repo_read_file",
    "repo_grep"
  ],
  "critic": {
    "status": "caution",
    "warnings": [
      {
        "type": "truncated_tool_results",
        "severity": "low",
        "message": "7 tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing.",
        "action": "Use a narrower follow-up query or read specific ranges before relying on missing evidence."
      }
    ]
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "tests/**",
      "examples/**"
    ],
    "scopeLimited": true,
    "filesRead": 16,
    "grepCalls": 11,
    "listDirCalls": 3,
    "symbolCalls": 0,
    "toolResultsTruncated": 7,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**",
      "7 tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing."
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 16 file read(s), 11 grep search(es)."
  },
  "stats": {
    "turns": 14,
    "toolCalls": 30,
    "filesRead": 16,
    "grepCalls": 11,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 18118,
    "totalTokens": 370837
  }
}
```

ElapsedMs: 18129
McpIsError: false
