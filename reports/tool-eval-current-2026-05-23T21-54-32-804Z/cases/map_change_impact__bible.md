# map_change_impact on bible

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
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "change": "refactor reader selection state and bookmark sync without breaking Cloudflare Functions APIs",
  "knownFiles": [
    "src/store.tsx"
  ],
  "knownSymbols": [
    "useStore"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Refactoring reader selection and bookmark sync requires modifying the zustand store. The store's persist middleware only saves 'settings'; 'currents' (reader state) and 'ui.bookmarkDraftCount' are not persisted. Key risks: 20+ components use useStore directly; setCurrentPassage is called from 22 locations; bookmark sync depends on auth.isAuthenticated. Cloudflare Functions APIs (/api/bookmarks/list, /api/bookmarks/sync) use session auth and will not break. E2E tests in scripts/e2e-bookmark-playwright.sh validate the bookmark workflow.",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "1 evidence item(s) were removed because their line ranges were not inspected."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 7,
    "partialCount": 0,
    "droppedCount": 1,
    "fileCount": 7,
    "warnings": [
      "1 evidence item(s) were removed because their line ranges were not inspected."
    ],
    "summary": "Verified: 15 files read, 2 symbol lookups, 7/7 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/store.tsx:30-58 before editing.",
    "target": {
      "path": "src/store.tsx",
      "role": "edit",
      "reason": "Main store with persist middleware and partialize—needs refactoring for state persistence",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 30,
      "endLine": 58
    }
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "functions/**",
      "scripts/**",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 15,
    "grepCalls": 0,
    "listDirCalls": 4,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 15 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_ce484288e810a5fa",
  "session": {
    "id": "sess_ce484288e810a5fa",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "edit",
      "reason": "Main store with persist middleware and partialize—needs refactoring for state persistence",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 30,
      "endLine": 58
    },
    {
      "path": "src/store/types.ts",
      "role": "edit",
      "reason": "CurrentsState defines reader selection state (currentBookId, chapter, wordIds)",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 27,
      "endLine": 34
    },
    {
      "path": "src/store/types.ts",
      "role": "edit",
      "reason": "UiState contains bookmarkDraftCount used in sync—may need restructuring",
      "evidenceRefs": [],
      "startLine": 47,
      "endLine": 54
    },
    {
      "path": "src/features/bookmark/hooks/useBookmarkSync.ts",
      "role": "read",
      "reason": "Bookmark sync hook depends on auth.isAuthenticated—key dependency",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 96
    },
    {
      "path": "src/features/reader/hooks/useReaderController.ts",
      "role": "read",
      "reason": "Reader controller uses currents state and setBookmarkDraftCount—high dependency",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 51,
      "endLine": 78
    },
    {
      "path": "src/features/bookmark/hooks/useBookmarkSync.ts",
      "startLine": 17,
      "endLine": 17,
      "role": "read",
      "reason": "Bookmark sync hook depends on auth.isAuthenticated from store—shows dependency chain",
      "evidenceRefs": [
        "E3"
      ]
    },
    {
      "path": "functions/api/bookmarks/list.ts",
      "startLine": 43,
      "endLine": 52,
      "role": "read",
      "reason": "Bookmark list API uses authenticateSession—independent of client store, no breaking risk",
      "evidenceRefs": [
        "E5"
      ]
    },
    {
      "path": "functions/api/bookmarks/sync.ts",
      "startLine": 176,
      "endLine": 185,
      "role": "read",
      "reason": "Bookmark sync API uses authenticateSession—independent of client store, no breaking risk",
      "evidenceRefs": [
        "E6"
      ]
    }
  ],
  "discoveredPathsCount": 59,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 58,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Main store with persist middleware only persists 'settings', not currents or ui state—key refactoring scope",
      "snippet": "30: export const useStore = create<AppStore>()(\n31:   persist(\n32:     (set, get, api) => ({\n33:       settings: INITIAL_SETTINGS,\n34:       currents: INITIAL_CURRENTS,\n35:       globals: INITIAL_GLOBALS,\n36:       search: INITIAL_SEARCH,\n37:       ui: INITIAL_UI,\n38:       auth: INITIAL_AUTH,\n39:       ...createStoreActions(set, get, api),\n40:     }),\n41:     {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/store/types.ts",
      "startLine": 27,
      "endLine": 34,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "CurrentsState defines reader selection state—target for refactoring",
      "snippet": "27: export interface CurrentsState {\n28:   currentBookId: number;\n29:   currentChapter: number;\n30:   currentMode: number;\n31:   currentSideOpen: boolean;\n32:   currentSelectedWordIds: Array<number | string>;\n33:   currentSearch: string;\n34: }"
    },
    {
      "id": "E3",
      "path": "src/features/bookmark/hooks/useBookmarkSync.ts",
      "startLine": 17,
      "endLine": 17,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark sync hook depends on auth.isAuthenticated from store—shows dependency chain",
      "snippet": "17:   const isAuthenticated = useStore((state) => state.auth.isAuthenticated);"
    },
    {
      "id": "E4",
      "path": "src/features/reader/hooks/useReaderController.ts",
      "startLine": 51,
      "endLine": 78,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Reader controller uses currents state and setBookmarkDraftCount—high dependency on refactored state",
      "snippet": "51:   const readerControllerState = useStore(selectReaderControllerState, shallow);\n52:   const {\n53:     language,\n54:     secondaryLanguage,\n55:     viewWithSecondaryLanguage,\n56:     copyType,\n57:     searchType,\n58:     searchVersion,\n59:     fontSize,\n60:     updateFontSize,\n61:     books,\n62:     currentBookId,\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "functions/api/bookmarks/list.ts",
      "startLine": 43,
      "endLine": 52,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark list API uses authenticateSession—independent of client store, no breaking risk",
      "snippet": "43: export const onRequestGet: PagesFunction<Env> = async (context) => {\n44:   const { request, env } = context;\n45: \n46:   try {\n47:     if (!env.AUTH_SECRET) {\n48:       return json({ error: 'Server auth is not configured' }, 500);\n49:     }\n50: \n51:     const session = await authenticateSession(request, env.DB, env.AUTH_SECRET);\n52:     if (!session) return json({ error: 'Unauthorized' }, 401);"
    },
    {
      "id": "E6",
      "path": "functions/api/bookmarks/sync.ts",
      "startLine": 176,
      "endLine": 185,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark sync API uses authenticateSession—independent of client store, no breaking risk",
      "snippet": "176: export const onRequestPost: PagesFunction<Env> = async (context) => {\n177:   const { request, env } = context;\n178: \n179:   try {\n180:     if (!env.AUTH_SECRET) {\n181:       return json({ error: 'Server auth is not configured' }, 500);\n182:     }\n183: \n184:     const session = await authenticateSession(request, env.DB, env.AUTH_SECRET);\n185:     if (!session) return json({ error: 'Unauthorized' }, 401);"
    },
    {
      "id": "E7",
      "path": "scripts/e2e-bookmark-playwright.sh",
      "startLine": 289,
      "endLine": 320,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "E2E test validates bookmark workflow—must pass after refactor",
      "snippet": "289: log \"Scenario 1/1: multi-passage draft -> detail view -> append to saved bookmark -> delete\"\n290: BOOKMARK_TITLE=\"Playwright 북마크 상세 검증\"\n291: NOTE_TEXT=\"상세 화면 메모 검증\"\n292: \n293: run_js \"$(cat <<EOF\n294: async (page) => {\n295:   const dismissGuideIfPresent = async () => {\n296:     const closeButton = page.getByRole('button', { name: /팝업 닫기/i });\n297:     if (await closeButton.count()) {\n298:       await closeButton.first().click();\n299:     }\n300:   };\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) were removed because their line ranges were not inspected.",
    "Some evidence items were dropped because they were not grounded in inspected line ranges."
  ],
  "stats": {
    "turns": 12,
    "toolCalls": 26,
    "filesRead": 15,
    "grepCalls": 0,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 15719,
    "totalTokens": 233894
  }
}
```

ElapsedMs: 15732
McpIsError: false
