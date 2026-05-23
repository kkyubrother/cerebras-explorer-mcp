# trace_symbol on bible

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
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "symbol": "useStore"
}
```

## Response Summary
```json
{
  "directAnswer": "useStore is a Zustand state management hook defined at src/store.tsx:30. It creates a global persisted store using Zustand's create() with persist middleware. The store manages app state across 6 slices: settings, currents, globals, search, ui, and auth. Exported as a const with no runtime parameters; returns a hook that accepts selector functions to access specific store parts. Persists only the settings slice to localStorage under key \"bible-app-storage\" and handles font-size rehydration on load.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 3,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 3,
    "warnings": [],
    "summary": "Verified: 3 files read, 1 symbol lookups, 3/3 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "functions/**",
      "scripts/**",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 3,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 3 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_7e27e143cd5e4ff8",
  "session": {
    "id": "sess_7e27e143cd5e4ff8",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "read",
      "reason": "Main definition of useStore with persistence configuration",
      "evidenceRefs": [
        "e0",
        "E1"
      ],
      "startLine": 30,
      "endLine": 58
    },
    {
      "path": "src/store/types.ts",
      "role": "read",
      "reason": "AppStore type definition showing StoreState & StoreActions",
      "evidenceRefs": [
        "e1",
        "E2"
      ],
      "startLine": 106,
      "endLine": 119
    },
    {
      "path": "src/store/createActions.ts",
      "role": "read",
      "reason": "Shows how store actions are composed from slices",
      "evidenceRefs": [
        "e2",
        "E3"
      ],
      "startLine": 10,
      "endLine": 21
    }
  ],
  "discoveredPathsCount": 23,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 58,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition of useStore showing Zustand store with persist middleware, initial state slices, localStorage configuration",
      "snippet": "30: export const useStore = create<AppStore>()(\n31:   persist(\n32:     (set, get, api) => ({\n33:       settings: INITIAL_SETTINGS,\n34:       currents: INITIAL_CURRENTS,\n35:       globals: INITIAL_GLOBALS,\n36:       search: INITIAL_SEARCH,\n37:       ui: INITIAL_UI,\n38:       auth: INITIAL_AUTH,\n39:       ...createStoreActions(set, get, api),\n40:     }),\n41:     {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/store/types.ts",
      "startLine": 106,
      "endLine": 119,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Type definitions showing StoreState contains 6 slices and StoreActions contains mutation methods",
      "snippet": "106: export interface StoreState {\n107:   settings: SettingsState;\n108:   currents: CurrentsState;\n109:   globals: {\n110:     books: BibleBook[];\n111:   };\n112:   search: SearchState;\n113:   ui: UiState;\n114:   auth: AuthState;\n115: }\n116: \n117: export type AppStore = StoreState & StoreActions;\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/store/createActions.ts",
      "startLine": 10,
      "endLine": 21,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows store actions composed from 6 slice creators (settings, currents, globals, search, ui, auth)",
      "snippet": "10: export const createStoreActions: AppStoreSlice<StoreActions> = (\n11:   set,\n12:   get,\n13:   api\n14: ) => ({\n15:   ...createSettingsSlice(set, get, api),\n16:   ...createCurrentsSlice(set, get, api),\n17:   ...createGlobalsSlice(set, get, api),\n18:   ...createSearchSlice(set, get, api),\n19:   ...createUiSlice(set, get, api),\n20:   ...createAuthSlice(set, get, api),\n21: });"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 5,
    "toolCalls": 4,
    "filesRead": 3,
    "grepCalls": 0,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 5150,
    "totalTokens": 38164
  }
}
```

ElapsedMs: 5161
McpIsError: false
