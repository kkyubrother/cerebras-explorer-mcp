# explore on bible

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
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "prompt": "Give a concise architecture report for React reader state, Cloudflare Pages Functions auth, bookmarks, and exam APIs. Include inline file:line citations and flag uncertainty.",
  "language": "en"
}
```

## Response Summary
```json
{
  "reportPreview": "Now I have sufficient evidence to produce a comprehensive architecture report. Let me compile the findings.\n\n# Architecture Report: Bible Reader App\n\n## Summary\n\nThis React Bible reader application uses a **local-first architecture** with Zustand state management and Cloudflare Pages Functions for server APIs. The reader state is managed entirely client-side with selective localStorage persistence, while auth, bookmarks, and exam data sync to a D1 database via authenticated APIs. Authentication is Telegram-based with HMAC-SHA256 verification and session cookies.\n\n---\n\n## 1. React Reader State Architecture\n\n### Store Structure (Zustand)\n\nThe application uses **Zustand** with the `persist` middleware for state management (`src/store.tsx:L30-L58`). The store is composed of multiple slices:\n\n```typescript\nexport const useStore = create<AppStore>()(\n  persist(\n    (set, get, api) => ({\n      settings: INITIAL_SETTINGS,\n      currents: INITIAL_CURRENTS,\n      globals: INITIAL_GLOBALS,\n      search: INITIAL_SEARCH,\n      ui: INITIAL_UI,\n      auth: INITIAL_AUTH,\n      ...createStoreActions(set, get, api),\n    }),\n    {\n      name: \"bible-app-storage\",\n      storage: createJSONStorage(() => localStorage),\n      partialize: (state) => ({ settings: state.settings }),\n    }\n  )\n);\n```\n\n**Only `settings` slice is persisted to localStorage** (`src/store.tsx:L53-L55`). Runtime state (`currents`, `globals`, `search`, `ui`, `auth`) is memory-only.\n\n### Reader State Slice (`currents`)\n\nThe core reader state lives in the `currents` slice (`src/store/slices/currents.ts:L1-L81`):\n\n```typescript\nexport interface CurrentsState {\n  currentBookId: number;      // Currently selected book (1-66)\n  currentChapter: number;     // Currently selected chapter\n  currentMode: number;        // Current view mode (LOADING, READER, SEARCH, etc.)\n  currentSideOpen: boolean;   // Sidebar state\n  currentSelectedWordIds: Array<number | string>;  // Selected verse/word IDs\n  currentSearch: string;      // Search query\n}\n```\n\n**Initial values** (`src/store/initialState.ts:L32-L39`):\n```typescript\nexport const INITIAL_CURRENTS: CurrentsState = {\n  currentBookId: 1,\n  currentChapter: 1,\n  currentMode: MODE.LOADING,\n  currentSideOpen: false,\n  currentSelectedWordIds: [],\n  currentSearch: \"\",\n};\n```\n\n### Actions\n\nReader state is updated through actions in the `currents` slice (`src/store/slices/currents.ts:L16-L80`):\n- `setCurrentPassage(bookId, chapter)` - Updates both book and chapter atomically\n- `updateBookId(bookId)` - Updates book only\n- `updateChapter(chapter)` - Updates chapter only\n- `updat\n... [truncated 12722 chars]",
  "citations": [
    {
      "type": "file_range",
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 58,
      "raw": "`src/store.tsx:L30-L58`"
    },
    {
      "type": "file_range",
      "path": "src/store.tsx",
      "startLine": 53,
      "endLine": 55,
      "raw": "`src/store.tsx:L53-L55`"
    },
    {
      "type": "file_range",
      "path": "src/store/slices/currents.ts",
      "startLine": 1,
      "endLine": 81,
      "raw": "`src/store/slices/currents.ts:L1-L81`"
    },
    {
      "type": "file_range",
      "path": "src/store/initialState.ts",
      "startLine": 32,
      "endLine": 39,
      "raw": "`src/store/initialState.ts:L32-L39`"
    },
    {
      "type": "file_range",
      "path": "src/store/slices/currents.ts",
      "startLine": 16,
      "endLine": 80,
      "raw": "`src/store/slices/currents.ts:L16-L80`"
    },
    {
      "type": "file_range",
      "path": "src/features/reader/hooks/useReaderController.ts",
      "startLine": 1,
      "endLine": 302,
      "raw": "`src/features/reader/hooks/useReaderController.ts:L1-L302`"
    },
    {
      "type": "file_range",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 240,
      "raw": "`functions/api/auth/telegram.ts:L148-L240`"
    },
    {
      "type": "file_range",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "raw": "`functions/api/auth/telegram.ts:L65-L104`"
    },
    {
      "type": "file_range",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 109,
      "endLine": 113,
      "raw": "`functions/api/auth/telegram.ts:L109-L113`"
    },
    {
      "type": "file_range",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 118,
      "endLine": 146,
      "raw": "`functions/api/auth/telegram.ts:L118-L146`"
    },
    {
      "type": "file_range",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 218,
      "endLine": 232,
      "raw": "`functions/api/auth/telegram.ts:L218-L232`"
    },
    {
      "type": "file_range",
      "path": "functions/api/_lib/session.ts",
      "startLine": 51,
      "endLine": 52,
      "raw": "`functions/api/_lib/session.ts:L51-L52`"
    }
  ],
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "reference",
      "reason": "Markdown report citations merged from 2 ranges.",
      "evidenceRefs": [],
      "startLine": 30,
      "endLine": 58
    },
    {
      "path": "src/store/slices/currents.ts",
      "role": "reference",
      "reason": "Markdown report citations merged from 2 ranges.",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 81
    },
    {
      "path": "src/store/initialState.ts",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 32,
      "endLine": 39
    },
    {
      "path": "src/features/reader/hooks/useReaderController.ts",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 302
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "reference",
      "reason": "Markdown report citations merged from 5 ranges.",
      "evidenceRefs": [],
      "startLine": 65,
      "endLine": 240
    },
    {
      "path": "functions/api/_lib/session.ts",
      "role": "reference",
      "reason": "Markdown report citations merged from 4 ranges.",
      "evidenceRefs": [],
      "startLine": 33,
      "endLine": 111
    },
    {
      "path": "functions/api/auth/me.ts",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 38,
      "endLine": 84
    },
    {
      "path": "functions/_middleware.ts",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 31,
      "endLine": 53
    }
  ],
  "filesRead": [
    "src/store.tsx",
    "functions/_middleware.ts",
    "src/store/types.ts",
    "src/store/slices/currents.ts",
    "src/store/slices/auth.ts",
    "src/api/auth.ts",
    "src/api/bookmark.ts",
    "src/api/exam.ts",
    "functions/api/auth/telegram.ts",
    "functions/api/bookmarks/list.ts",
    "functions/api/bookmarks/sync.ts",
    "functions/api/exam/submit.ts",
    "functions/api/exam/history.ts",
    "functions/api/exam/stats.ts",
    "functions/api/exam/local-sync.ts",
    "functions/api/_lib/session.ts",
    "migrations/0001_initial.sql",
    "migrations/0002_auth_sessions.sql",
    "functions/api/auth/me.ts",
    "src/features/reader/hooks/useReaderController.ts",
    "src/store/initialState.ts",
    "migrations/0004_bookmarks.sql",
    "migrations/0003_exam_local_sync.sql",
    "src/store.selectors.ts"
  ],
  "toolsUsed": [
    "repo_list_dir",
    "repo_read_file",
    "repo_find_files"
  ],
  "critic": {
    "status": "caution",
    "warnings": [
      {
        "type": "truncated_tool_results",
        "severity": "low",
        "message": "5 tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing.",
        "action": "Use a narrower follow-up query or read specific ranges before relying on missing evidence."
      }
    ]
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "functions/**",
      "scripts/**",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 25,
    "grepCalls": 0,
    "listDirCalls": 7,
    "symbolCalls": 0,
    "toolResultsTruncated": 5,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**",
      "5 tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing."
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 25 file read(s), 0 grep search(es)."
  },
  "stats": {
    "turns": 11,
    "toolCalls": 34,
    "filesRead": 25,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 14056,
    "totalTokens": 180235
  }
}
```

ElapsedMs: 14067
McpIsError: false
