# map_impact on bible

## Tool Description
Use when the parent already knows the specific anchor (a file path or symbol name) that is about to change and wants a deeper dependency chain plus test/config blast radius. Differs from map_change_impact: this tool puts the anchor in front and runs a deeper reference chase; map_change_impact takes a natural-language change description.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "anchor": {
      "type": "string",
      "description": "A file path (e.g. \"src/auth.js\") or a symbol name (e.g. \"requireAuth\") that will change."
    },
    "changeType": {
      "type": "string",
      "enum": [
        "rename",
        "refactor",
        "remove",
        "add"
      ],
      "description": "Optional. The intended kind of change so the task statement reflects it (e.g. callers matter more for \"remove\")."
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
    "anchor"
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
  "anchor": "src/store.tsx",
  "changeType": "refactor",
  "knownSymbols": [
    "useStore"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Traced dependency chain from src/store.tsx: 31 direct importers across shared, bookmark, exam, reader, search, and settings features. 2 type-only importers (store.selectors.ts, auth.ts). 1 documentation reference (AGENTS.md). No test coverage or configuration references found. Store uses Zustand with localStorage persistence (key: 'bible-app-storage').",
  "status": {
    "confidence": "medium",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "Model confidence was capped from high to medium.",
      "7 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "medium",
    "exactCount": 1,
    "partialCount": 7,
    "droppedCount": 0,
    "fileCount": 8,
    "warnings": [
      "Model confidence was capped from high to medium.",
      "7 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 1 files read, 3 grep searches, 2 symbol lookups, 1/8 evidence items grounded, cross-verified across 8 files. Evidence partially verified — results are reliable for most uses."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/store.selectors.ts:1-166 before editing.",
    "target": {
      "path": "src/store.selectors.ts",
      "role": "edit",
      "reason": "Type-only importer: 15+ selectors using AppStore type",
      "evidenceRefs": [
        "ev8",
        "E8"
      ],
      "startLine": 1,
      "endLine": 166
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
    "filesRead": 1,
    "grepCalls": 3,
    "listDirCalls": 1,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 1 file read(s), 3 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_cd7fbe5e8ff206b3",
  "session": {
    "id": "sess_cd7fbe5e8ff206b3",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "read",
      "reason": "Anchor file: defines useStore with Zustand persistence config",
      "evidenceRefs": [
        "ev1"
      ],
      "startLine": 1,
      "endLine": 59
    },
    {
      "path": "src/store.selectors.ts",
      "role": "edit",
      "reason": "Type-only importer: 15+ selectors using AppStore type",
      "evidenceRefs": [
        "ev8",
        "E8"
      ],
      "startLine": 1,
      "endLine": 166
    },
    {
      "path": "src/shared/hooks/useAuthSessionBootstrap.ts",
      "role": "edit",
      "reason": "Direct importer: uses useStore for auth session bootstrap",
      "evidenceRefs": [
        "ev2",
        "E2"
      ],
      "startLine": 6,
      "endLine": 22
    },
    {
      "path": "src/shared/hooks/useCopyActions.tsx",
      "role": "edit",
      "reason": "Direct importer: uses useStore for language settings",
      "evidenceRefs": [
        "ev3",
        "E3"
      ],
      "startLine": 6,
      "endLine": 45
    },
    {
      "path": "src/features/bookmark/pages/BookmarksPage.tsx",
      "role": "edit",
      "reason": "Direct importer: uses useStore for passage state",
      "evidenceRefs": [
        "ev4",
        "E4"
      ],
      "startLine": 16,
      "endLine": 40
    },
    {
      "path": "src/features/exam/pages/ExamPracticePage.tsx",
      "role": "edit",
      "reason": "Direct importer: uses useStore for exam auth state",
      "evidenceRefs": [
        "ev5",
        "E5"
      ],
      "startLine": 21,
      "endLine": 42
    },
    {
      "path": "src/features/reader/hooks/useReaderController.ts",
      "role": "edit",
      "reason": "Direct importer: uses useStore for reader controller",
      "evidenceRefs": [
        "ev6",
        "E6"
      ],
      "startLine": 6,
      "endLine": 51
    },
    {
      "path": "src/features/search/hooks/useSearchV4.tsx",
      "role": "edit",
      "reason": "Direct importer: uses useStore for search v4 state",
      "evidenceRefs": [
        "ev7",
        "E7"
      ],
      "startLine": 6,
      "endLine": 41
    }
  ],
  "discoveredPathsCount": 38,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 40,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition of useStore export with Zustand persistence config",
      "snippet": "30: export const useStore = create<AppStore>()(\n31:   persist(\n32:     (set, get, api) => ({\n33:       settings: INITIAL_SETTINGS,\n34:       currents: INITIAL_CURRENTS,\n35:       globals: INITIAL_GLOBALS,\n36:       search: INITIAL_SEARCH,\n37:       ui: INITIAL_UI,\n38:       auth: INITIAL_AUTH,\n39:       ...createStoreActions(set, get, api),\n40:     }),"
    },
    {
      "id": "E2",
      "path": "src/shared/hooks/useAuthSessionBootstrap.ts",
      "startLine": 6,
      "endLine": 22,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for auth bootstrap",
      "snippet": "6: import { useStore } from \"@/store\";\n7: \n8: const isIgnorableSessionRestoreError = (error: unknown): boolean => {\n9:   if (error instanceof DOMException && error.name === \"AbortError\") {\n10:     return true;\n11:   }\n12: \n13:   if (error instanceof TypeError) {\n14:     const message = error.message.toLowerCase();\n15:     return message.includes(\"failed to fetch\") || message.includes(\"networkerror\");\n16:   }\n17: \n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/shared/hooks/useCopyActions.tsx",
      "startLine": 6,
      "endLine": 45,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for language settings",
      "snippet": "6: import { useStore } from \"@/store\";\n7: import { copyToClipboard } from \"../utils/copy\";\n8: import {\n9:   createCopyTextType01,\n10:   createCopyTextType02,\n11:   verseNumbersToTextType01,\n12: } from \"../utils/text\";\n13: import type { BibleWordDataV3 } from \"@/features/reader/types/word.types\";\n14: \n15: type SelectableWord = BibleWordDataV3 & { line: string | number };\n16: \n17: interface UseCopyActionsParams {\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/features/bookmark/pages/BookmarksPage.tsx",
      "startLine": 16,
      "endLine": 40,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for passage state",
      "snippet": "16: import { useStore } from \"@/store\";\n17: import type { BookmarkDraft, BookmarkRecord } from \"../types/bookmark\";\n18: import { deleteBookmark, loadBookmarkDraft, loadBookmarks } from \"../utils/database\";\n19: import { useBookmarkSync } from \"../hooks/useBookmarkSync\";\n20: import {\n21:   countBookmarkDraftPassageBlocks,\n22:   countBookmarkNoteBlocks,\n23:   countBookmarkPassageBlocks,\n24:   getBookmarkDefaultTitle,\n25:   getBookmarkFirstNotePreview,\n26:   getBookmarkFirstPassageAddress,\n27:   getBookmarkPrimaryReferenceLabel,\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/features/exam/pages/ExamPracticePage.tsx",
      "startLine": 21,
      "endLine": 42,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for exam auth state",
      "snippet": "21: import { useStore } from \"@/store\";\n22: import { appendExamWrongNote } from \"../utils/database\";\n23: import { useExamVerseLoader } from \"../hooks/useExamVerseLoader\";\n24: import {\n25:   normalizeText,\n26:   getSmallMistakeChars,\n27:   tokenizeKo,\n28: } from \"../utils/examTextProcessing\";\n29: import { recordExamAttempt } from \"../utils/examPersistence\";\n30: import { makeClozePrompt, getInitials } from \"../utils/practiceTextUtils\";\n31: import type {\n32:   BookMeta,\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/features/reader/hooks/useReaderController.ts",
      "startLine": 6,
      "endLine": 51,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for reader controller",
      "snippet": "6: import { useStore } from \"@/store\";\n7: import { selectReaderControllerState } from \"@/store.selectors\";\n8: import { useMobileDetect } from \"@/shared/utils/device\";\n9: import { useBibleData } from \"./useBibleData\";\n10: import { useBookmarkActions } from \"@/features/bookmark/hooks/useBookmarkActions\";\n11: import { useChapterProgress } from \"./useChapterProgress\";\n12: import { useCopyActions } from \"@/shared/hooks/useCopyActions\";\n13: import { useDialogLink } from \"@/shared/hooks/useDialogLink\";\n14: import { useMainShortcuts } from \"@/shared/hooks/useMainShortcuts\";\n15: import { useReaderEffects } from \"./useReaderEffects\";\n16: import { useSearchMatchNavigation } from \"./useSearchMatchNavigation\";\n17: import { useReaderUiControls } from \"./useReaderUiControls\";\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/features/search/hooks/useSearchV4.tsx",
      "startLine": 6,
      "endLine": 41,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Import and usage of useStore for search v4 state",
      "snippet": "6: import { useStore } from \"@/store\";\n7: import { selectSearchV4State } from \"@/store.selectors\";\n8: import type { BibleBook } from \"@/shared/types/bible\";\n9: import type {\n10:   FlexSearchRawDoc,\n11:   SearchResultDoc,\n12:   SearchResultGroup,\n13:   SearchResultItem,\n14: } from \"../types/search\";\n15: import { parseSearchRawDoc } from \"../utils/searchParsing\";\n16: \n17: interface FlexSearchDocumentLike {\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/store.selectors.ts",
      "startLine": 1,
      "endLine": 166,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Type import from store with 15+ selectors using AppStore",
      "snippet": "1: import type { StoreActions, StoreState } from \"./store\";\n2: \n3: type AppStore = StoreState & StoreActions;\n4: \n5: export const selectReaderSettings = (state: AppStore) => ({\n6:   language: state.settings.language,\n7:   secondaryLanguage: state.settings.secondaryLanguage,\n8:   viewWithSecondaryLanguage: state.settings.viewWithSecondaryLanguage,\n9:   copyType: state.settings.copyType,\n10:   searchType: state.settings.searchType,\n11:   searchVersion: state.settings.searchVersion,\n12:   fontSize: state.settings.fontSize,\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "Model confidence was capped from high to medium.",
    "7 evidence item(s) are grounded only by grep, blame, or nearby line observations.",
    "Persistence key 'bible-app-storage' in localStorage - migration strategy needed if format changes",
    "No automated tests increase refactoring risk"
  ],
  "stats": {
    "turns": 7,
    "toolCalls": 14,
    "filesRead": 1,
    "grepCalls": 3,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 9770,
    "totalTokens": 87694
  }
}
```

ElapsedMs: 9782
McpIsError: false
