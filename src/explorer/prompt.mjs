const STRATEGY_DESCRIPTIONS = {
  'symbol-first':    'Find where a symbol is defined. Start with repo_grep(symbol) → repo_read_file.',
  'reference-chase': 'Find all callers/usages. Start with repo_grep(symbol) → read each caller.',
  'git-guided':      'Understand recent changes. Start with repo_git_log → repo_git_diff → repo_read_file.',
  'breadth-first':   'Understand project structure. Start with repo_list_dir(depth:3) → read key files.',
  'blame-guided':    'Trace a bug to its origin. Start with repo_grep → repo_git_blame → repo_git_show.',
  'pattern-scan':    'Analyze a pattern across the codebase. Start with repo_grep → read multiple files.',
};

export function detectStrategy(task) {
  const t = task.toLowerCase();
  if (/누가|언제|변경|커밋|commit|changed|who\s|when\s|recent|이력|history|수정/.test(t)) return 'git-guided';
  if (/정의|어디|위치|defined|where\s|definition|located|선언|구현/.test(t)) return 'symbol-first';
  if (/호출|사용|참조|called|used by|references|callers|import/.test(t)) return 'reference-chase';
  if (/구조|아키텍처|개요|structure|architecture|overview|전체|레이아웃/.test(t)) return 'breadth-first';
  if (/버그|원인|왜\s|bug|cause|why\s|blame|문제/.test(t)) return 'blame-guided';
  if (/패턴|모든|전부|pattern|all\s|every\s|similar|비교/.test(t)) return 'pattern-scan';
  return null;
}

function formatHintBlock(hints = {}) {
  const lines = [];
  if (Array.isArray(hints.symbols) && hints.symbols.length) {
    lines.push(`- symbols: ${hints.symbols.join(', ')}`);
  }
  if (Array.isArray(hints.files) && hints.files.length) {
    lines.push(`- files: ${hints.files.join(', ')}`);
  }
  if (Array.isArray(hints.regex) && hints.regex.length) {
    lines.push(`- regex: ${hints.regex.join(', ')}`);
  }
  if (!lines.length) {
    return '- none';
  }
  return lines.join('\n');
}

function formatScope(scope = []) {
  if (!Array.isArray(scope) || scope.length === 0) {
    return 'entire repository';
  }
  return scope.join(', ');
}

/**
 * Build the system prompt for the explorer agent.
 *
 * @param {object} opts
 * @param {string}   opts.repoRoot
 * @param {object}   opts.budgetConfig
 * @param {string}   [opts.projectContext] - Injected from .cerebras-explorer.json
 * @param {string[]} [opts.previousSummaries] - Summaries from prior session calls
 * @param {string[]} [opts.keyFiles] - Key files from project config (prioritise these)
 */
export function buildExplorerSystemPrompt({ repoRoot, budgetConfig, projectContext, previousSummaries, keyFiles }) {
  const parts = [
    'You are Cerebras Explorer, an autonomous READ-ONLY repository exploration agent.',
    'You MUST use repo tools to inspect the repository before answering unless the answer is already obvious from prior tool results.',
    'You MUST remain read-only. Never suggest writing files, running mutating shell commands, or making direct edits.',
    'You MUST narrow the search before reading many files: prefer repo_find_files and repo_grep, then repo_read_file.',
    'You MUST read the smallest relevant ranges possible.',
    'You SHOULD gather at least two evidence points before using confidence=high when the task is non-trivial.',
    'You MUST stop exploring once you have enough evidence to answer.',
    'You MUST answer in the same natural language as the delegated task unless the task explicitly asks for another language.',
    'You MUST return plain JSON only when you give the final answer. No markdown fences.',
    '',
    'Strategy selection guide (choose the best starting point to minimize turns):',
    '- symbol-first:    "where is X defined?" → repo_symbol_context(symbol) [or repo_symbols(file) → repo_read_file]',
    '- reference-chase: "where is X used/called?" → repo_symbol_context(symbol) [or repo_references(symbol)]',
    '- git-guided:      "what changed recently?" → repo_git_log → repo_git_diff → repo_read_file',
    '- breadth-first:   "project structure/overview?" → repo_list_dir(depth:3) → read key files',
    '- blame-guided:    "why does this bug exist?" → repo_grep → repo_git_blame → repo_git_show',
    '- pattern-scan:    "how is X done across codebase?" → repo_grep → read multiple files',
    'Follow the suggested strategy if one is provided in the user prompt.',
    '',
    'Available git tools (use when history or authorship context is needed):',
    '- repo_git_log: commit history for the repo or a specific file. Use to find "what changed recently".',
    '- repo_git_blame: line-level author/commit for a file range. Use to find "who wrote this and why".',
    '- repo_git_diff: diff between two refs. Use stat=true first for overview, then full diff for details.',
    '- repo_git_show: full details of a single commit (message + patch). Use after git_log to inspect a specific change.',
    '',
    'Symbol analysis tools (prefer these over grep+read for symbol tasks):',
    '- repo_symbol_context(symbol): MACRO — definition body + callers in one call. Use FIRST for symbol-first/reference-chase tasks.',
    '- repo_symbols(path, kind?): list all definitions in a file. Use to navigate a file without reading it.',
    '- repo_references(symbol, scope?): all imports + usages + definition, categorised. Use when you need a full reference map.',
    '- repo_grep(pattern, contextLines?): text search. Set contextLines=2-3 to include surrounding code.',
  ];

  // Project context from .cerebras-explorer.json
  if (typeof projectContext === 'string' && projectContext.trim()) {
    parts.push('', 'Project context:', projectContext.trim());
  }

  // Key files to check early for architecture questions
  if (Array.isArray(keyFiles) && keyFiles.length > 0) {
    parts.push('', `Key files (check these first for structural questions): ${keyFiles.join(', ')}`);
  }

  // Previous session summaries for continuity
  if (Array.isArray(previousSummaries) && previousSummaries.length > 0) {
    parts.push('', 'Findings from previous exploration in this session (do not re-examine already-confirmed facts):');
    for (const summary of previousSummaries) {
      parts.push(`- ${summary}`);
    }
  }

  parts.push(
    '',
    'Final JSON shape:',
    '{',
    '  "answer": "string — direct answer to the task",',
    '  "summary": "string — short synthesis of key findings",',
    '  "confidence": "low|medium|high — your assessment of answer reliability",',
    '  "evidence": [',
    '    {"path": "relative/path", "startLine": 1, "endLine": 10, "why": "why this evidence matters"}',
    '  ],',
    '  "candidatePaths": ["relative/path — files relevant to the task"],',
    '  "followups": [',
    '    {',
    '      "description": "what to investigate next",',
    '      "priority": "recommended|optional",',
    '      "suggestedCall": {',
    '        "task": "natural-language task for next explore_repo call",',
    '        "scope": ["path/pattern"],',
    '        "budget": "quick|normal|deep",',
    '        "hints": {"symbols": ["SymbolName"], "strategy": "symbol-first"}',
    '      }',
    '    }',
    '  ]',
    '}',
    '',
    'followups rules:',
    '- Use "recommended" priority when follow-up is essential for a complete answer.',
    '- Use "optional" for interesting but non-critical next steps.',
    '- suggestedCall.hints.symbols should list the most useful starting symbols.',
    '- suggestedCall.hints.strategy should be one of the six strategies above.',
    '- Use an empty array [] for followups when no further investigation is needed.',
    '',
    'Repository root:',
    repoRoot,
    '',
    `Exploration budget: ${budgetConfig.label} (maxTurns=${budgetConfig.maxTurns}, maxReadLinesPerCall=${budgetConfig.maxReadLines}, maxSearchResults=${budgetConfig.maxSearchResults}).`,
  );

  return parts.join('\n');
}

export function buildExplorerUserPrompt({ task, scope, budget, hints, sessionCandidatePaths }) {
  const strategy = hints?.strategy ?? detectStrategy(task);
  const strategyLine = strategy
    ? `Strategy: ${strategy} — ${STRATEGY_DESCRIPTIONS[strategy]}`
    : 'Strategy: auto (no dominant pattern detected — start with repo_list_dir or repo_grep)';

  const lines = [
    'Delegated exploration request:',
    task.trim(),
    '',
    `Requested budget: ${budget}`,
    `Scope: ${formatScope(scope)}`,
    strategyLine,
    'Hints:',
    formatHintBlock(hints),
  ];

  // Inject paths from a previous session call as context
  if (Array.isArray(sessionCandidatePaths) && sessionCandidatePaths.length > 0) {
    lines.push(
      '',
      `Files found in prior session calls (likely relevant — check these early): ${sessionCandidatePaths.slice(0, 15).join(', ')}`,
    );
  }

  lines.push(
    '',
    'Work plan:',
    '1. Discover likely relevant files using the suggested strategy above.',
    '2. Read only the smallest ranges needed to answer.',
    '3. Stop once evidence is sufficient.',
    '4. Return the final JSON result.',
  );

  return lines.join('\n');
}

export function buildFinalizePrompt() {
  return [
    'Produce the final exploration result now.',
    'Return valid JSON only — no markdown fences.',
    'Do not call any tools.',
    'Ground every evidence item in files and line ranges already inspected.',
    '',
    'For followups, use the structured object format:',
    '  {"description": "...", "priority": "recommended|optional", "suggestedCall": {"task": "...", "scope": [], "budget": "normal", "hints": {"symbols": [], "strategy": "symbol-first"}}}',
    'Use an empty array [] if no further investigation is needed.',
  ].join('\n');
}
