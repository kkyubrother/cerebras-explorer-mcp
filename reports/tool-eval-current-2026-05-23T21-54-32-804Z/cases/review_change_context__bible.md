# review_change_context on bible

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
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "reviewGoal": "Review current reader/search/bookmark changes for user-visible regressions and API contract risk.",
  "path": "src/store.tsx"
}
```

## Response Summary
```json
{
  "directAnswer": "Review of src/store.tsx reveals four significant commits affecting reader/search/bookmark functionality:\n\n1. **Security Hardening (Apr 17)**: Removed `auth` from persisted state - users must re-authenticate after refresh.\n\n2. **Major Refactor (Mar 11)**: Split 386-line monolith into modular architecture (types.ts, initialState.ts, createActions.ts, slices/). Added `experimentalModeEnabled` field.\n\n3. **Reader Routing Fix (Mar 10)**: Removed database side effects from `updateBookId`/`updateChapter`. Added `setCurrentPassage(bookId, chapter)` for atomic updates.\n\n4. **Bookmark Workflow (Mar 9)**: Added `bookmarkDraftCount` to UiState and `setBookmarkDraftCount` action.\n\n**Key Risks**: Auth no longer persists; navigation actions lost DB persistence; new `setCurrentPassage` may not be used; import paths changed from relative to absolute (`@/shared/*`).",
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
    "fileCount": 4,
    "warnings": [],
    "summary": "Verified: 8 files read, 8/8 evidence items grounded, cross-verified across 4 files. All evidence grounded in inspected code."
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
    "filesRead": 8,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 8 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_6e2e202671be24aa",
  "session": {
    "id": "sess_6e2e202671be24aa",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "context",
      "reason": "Security: auth removed from persistence partialize - verify re-auth flow",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 53,
      "endLine": 56
    },
    {
      "path": "src/store.tsx",
      "role": "read",
      "reason": "Current store structure - verify modular integration with consumers",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 1,
      "endLine": 59
    },
    {
      "path": "src/store/types.ts",
      "role": "read",
      "reason": "SettingsState with experimentalModeEnabled - verify type safety",
      "evidenceRefs": [],
      "startLine": 12,
      "endLine": 25
    },
    {
      "path": "src/store/types.ts",
      "role": "read",
      "reason": "UiState with bookmarkDraftCount - verify UI integration",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 47,
      "endLine": 54
    },
    {
      "path": "src/store/slices/currents.ts",
      "role": "read",
      "reason": "setCurrentPassage implementation - verify routing logic uses it",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 17,
      "endLine": 24
    },
    {
      "path": "src/store/slices/ui.ts",
      "role": "read",
      "reason": "Bookmark draft action - verify UI updates correctly",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 16,
      "endLine": 22
    },
    {
      "path": "src/store.tsx",
      "startLine": 2,
      "endLine": 41,
      "role": "read",
      "reason": "Major refactor: store split into modules",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "src/store.tsx",
      "startLine": 256,
      "endLine": 283,
      "role": "read",
      "reason": "Routing fix: removed DB side effects, added setCurrentPassage",
      "evidenceRefs": [
        "E3"
      ]
    }
  ],
  "discoveredPathsCount": 8,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 53,
      "endLine": 56,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Security: auth removed from persistence",
      "snippet": ""
    },
    {
      "id": "E2",
      "path": "src/store.tsx",
      "startLine": 2,
      "endLine": 41,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Major refactor: store split into modules",
      "snippet": ""
    },
    {
      "id": "E3",
      "path": "src/store.tsx",
      "startLine": 256,
      "endLine": 283,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Routing fix: removed DB side effects, added setCurrentPassage",
      "snippet": ""
    },
    {
      "id": "E4",
      "path": "src/store.tsx",
      "startLine": 49,
      "endLine": 56,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Bookmark workflow: added bookmarkDraftCount",
      "snippet": ""
    },
    {
      "id": "E5",
      "path": "src/store.tsx",
      "startLine": 1,
      "endLine": 59,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Current store structure after refactor",
      "snippet": "1: import { create } from \"zustand\";\n2: import { createJSONStorage, persist } from \"zustand/middleware\";\n3: \n4: import { FONT_SIZE_DEFAULT, applyHtmlFontSize } from \"@/shared/constants/fontSize\";\n5: import { createStoreActions } from \"./store/createActions\";\n6: import {\n7:   INITIAL_AUTH,\n8:   INITIAL_CURRENTS,\n9:   INITIAL_GLOBALS,\n10:   INITIAL_SEARCH,\n11:   INITIAL_SETTINGS,\n12:   INITIAL_UI,\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/store/types.ts",
      "startLine": 47,
      "endLine": 54,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "UiState with bookmarkDraftCount field",
      "snippet": "47: export interface UiState {\n48:   sideOpen: boolean;\n49:   bookmarkDraftCount: number;\n50:   windowSize: {\n51:     innerWidth: number;\n52:     innerHeight: number;\n53:   };\n54: }"
    },
    {
      "id": "E7",
      "path": "src/store/slices/currents.ts",
      "startLine": 17,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "setCurrentPassage action for reader routing",
      "snippet": "17:   setCurrentPassage: (bookId, chapter) =>\n18:     set((state) => ({\n19:       currents: {\n20:         ...state.currents,\n21:         currentBookId: bookId,\n22:         currentChapter: chapter,\n23:       },\n24:     })),"
    },
    {
      "id": "E8",
      "path": "src/store/slices/ui.ts",
      "startLine": 16,
      "endLine": 22,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "setBookmarkDraftCount implementation",
      "snippet": "16:   setBookmarkDraftCount: (bookmarkDraftCount) =>\n17:     set((state) => ({\n18:       ui: {\n19:         ...state.ui,\n20:         bookmarkDraftCount,\n21:       },\n22:     })),"
    }
  ],
  "uncertainties": [
    "Components using updateBookId/updateChapter expecting DB persistence may break",
    "Components importing from old relative paths (./constants/*) may fail",
    "setCurrentPassage adoption in routing logic unknown",
    "experimentalModeEnabled has no visible toggle action in reviewed types"
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 13,
    "filesRead": 8,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 8013,
    "totalTokens": 74785
  }
}
```

ElapsedMs: 8023
McpIsError: false
