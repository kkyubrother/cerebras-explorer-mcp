# explain_code_path on studious-memory

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
  "repo_root": "/home/kyubr/IdeaProjects/studious-memory",
  "scope": [
    "backend/**",
    "frontend/src/**",
    "extensions/firefox-inbox/src/**",
    "scripts/**",
    "android/**"
  ],
  "pathQuery": "Firefox extension capture submission from apiClient through backend source intake or MCP surface",
  "entryPoint": "backend/mcp_server.py",
  "knownFiles": [
    "backend/mcp_server.py"
  ],
  "knownSymbols": [
    "scoped_tool"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Firefox extension captures flow: message listener (background.ts:184-188) → submitCapture → HTTP POST /api/v1/sources → FastAPI create_source (sources.py:345-416) → process_source domain command. MCP surface flows: stdio entry (mcp_server.py:40) → process_input tool (server.py:123-143) → tool_process_input → same process_source command. Both paths converge on backend/app/domains/source/commands.py::process_source.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 9,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 8,
    "warnings": [],
    "summary": "Verified: 12 files read, 5 grep searches, 4 symbol lookups, 9/9 evidence items grounded, cross-verified across 8 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "backend/**",
      "frontend/src/**",
      "extensions/firefox-inbox/src/**",
      "scripts/**",
      "android/**"
    ],
    "scopeLimited": true,
    "filesRead": 12,
    "grepCalls": 5,
    "listDirCalls": 0,
    "symbolCalls": 4,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 12 file read(s), 5 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_c1a56cffea6d47ff",
  "session": {
    "id": "sess_c1a56cffea6d47ff",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "role": "read",
      "reason": "Firefox extension message listener entry point",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 184,
      "endLine": 188
    },
    {
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "role": "read",
      "reason": "submitDraft calls dependencies.submit at line 114",
      "evidenceRefs": [],
      "startLine": 99,
      "endLine": 131
    },
    {
      "path": "extensions/firefox-inbox/src/shared/apiClient.ts",
      "role": "read",
      "reason": "submitCapture POSTs FormData to sourceApiUrl",
      "evidenceRefs": [],
      "startLine": 53,
      "endLine": 89
    },
    {
      "path": "extensions/firefox-inbox/src/shared/serviceUrl.ts",
      "role": "read",
      "reason": "sourceApiUrl constructs /api/v1/sources endpoint",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 42,
      "endLine": 44
    },
    {
      "path": "backend/app/api/v1/sources.py",
      "role": "read",
      "reason": "create_source POST endpoint calls process_source",
      "evidenceRefs": [],
      "startLine": 345,
      "endLine": 416
    },
    {
      "path": "backend/mcp_server.py",
      "role": "read",
      "reason": "MCP stdio transport entry point",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 40,
      "endLine": 40
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "process_input tool calls tool_process_input",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 123,
      "endLine": 143
    },
    {
      "path": "backend/app/mcp/tools/input_tools.py",
      "role": "read",
      "reason": "tool_process_input calls process_source command",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 45,
      "endLine": 53
    }
  ],
  "discoveredPathsCount": 38,
  "evidence": [
    {
      "id": "E1",
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "startLine": 184,
      "endLine": 188,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Firefox extension message listener entry point",
      "snippet": "184:   browser.runtime.onMessage.addListener((message: unknown) => {\n185:     if (!isExtensionRequest(message)) {\n186:       return false\n187:     }\n188:     return handleRequest(message)"
    },
    {
      "id": "E2",
      "path": "extensions/firefox-inbox/src/background/background.ts",
      "startLine": 114,
      "endLine": 114,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "submitDraft calls dependencies.submit (submitCapture)",
      "snippet": "114:     const result = await dependencies.submit(settings, submittingDraft)"
    },
    {
      "id": "E3",
      "path": "extensions/firefox-inbox/src/shared/apiClient.ts",
      "startLine": 72,
      "endLine": 79,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST request to sourceApiUrl with headers/body",
      "snippet": "72:     response = await fetchImpl(sourceApiUrl(settings.serviceBaseUrl), {\n73:       method: 'POST',\n74:       headers: {\n75:         ...bearerHeaders(settings.apiKey),\n76:         'X-Studious-Client-Capture-Id': capture.clientCaptureId,\n77:       },\n78:       body: form,\n79:     })"
    },
    {
      "id": "E4",
      "path": "extensions/firefox-inbox/src/shared/serviceUrl.ts",
      "startLine": 42,
      "endLine": 44,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "sourceApiUrl returns /api/v1/sources endpoint",
      "snippet": "42: export function sourceApiUrl(serviceBaseUrl: string): string {\n43:   return `${normalizeServiceBaseUrl(serviceBaseUrl)}/api/v1/sources`\n44: }"
    },
    {
      "id": "E5",
      "path": "backend/app/api/v1/sources.py",
      "startLine": 401,
      "endLine": 416,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "create_source calls process_source domain command",
      "snippet": "401:         result = await process_source(\n402:             session=session,\n403:             raw_text=text,\n404:             images=validated_images,\n405:             source_url=source_url,\n406:             context_enrichment=context_enrichment,\n407:             web_search_enabled=web_search_enabled,\n408:             web_search_reason=web_search_reason,\n409:             web_search_disclosure_mode=web_search_disclosure_mode,\n410:             agent_thread_mode=agent_thread_mode,\n411:             agent_thread_id=agent_thread_id,\n412:             owner_id=owner_id,\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "backend/mcp_server.py",
      "startLine": 40,
      "endLine": 40,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "MCP stdio transport entry point",
      "snippet": "40:     mcp.run(transport=\"stdio\")"
    },
    {
      "id": "E7",
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 143,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "process_input tool with MEMORY_WRITE scope",
      "snippet": "123: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)\n124: async def process_input(\n125:     text: str | None = None,\n126:     image_base64: str | None = None,\n127:     image_mime: str | None = None,\n128:     context_enrichment: bool = False,\n129: ) -> dict:\n130:     \"\"\"주인님의 텍스트·이미지를 접수하여 AI 분석 후 지식·할일·일정으로 정리합니다.\n131: \n132:     Args:\n133:         text: 정리할 텍스트 또는 대화 기록\n134:         image_base64: Base64 인코딩된 이미지 데이터\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "backend/app/mcp/tools/input_tools.py",
      "startLine": 45,
      "endLine": 53,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "tool_process_input calls process_source domain command",
      "snippet": "45:         result = await process_source(\n46:             session=session,\n47:             raw_text=text,\n48:             images=incoming_images,\n49:             context_enrichment=context_enrichment,\n50:             owner_id=owner_id,\n51:             data_group_id=data_group_id,\n52:             access_context=access_context,\n53:         )"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 14,
    "toolCalls": 21,
    "filesRead": 12,
    "grepCalls": 5,
    "symbolCalls": 4,
    "stoppedByBudget": false,
    "elapsedMs": 18360,
    "totalTokens": 259963
  }
}
```

ElapsedMs: 18375
McpIsError: false
