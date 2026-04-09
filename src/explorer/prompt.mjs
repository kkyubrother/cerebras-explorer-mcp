import path from 'node:path';

const STRATEGY_DESCRIPTIONS = {
  'symbol-first':    'Find where a symbol is defined. Start with repo_symbol_context(symbol); fall back to repo_grep → repo_read_file.',
  'reference-chase': 'Find all callers/usages. Start with repo_symbol_context(symbol); fall back to repo_references(symbol) → read each caller.',
  'git-guided':      'Understand recent changes. Start with repo_git_log → repo_git_diff → repo_read_file.',
  'breadth-first':   'Understand project structure. Start with repo_list_dir(depth:3) → read key files.',
  'blame-guided':    'Trace a bug to its origin. Start with repo_grep → repo_git_blame → repo_git_show.',
  'pattern-scan':    'Analyze a pattern across the codebase. Start with repo_grep → read multiple files.',
};

/**
 * Detect one or more relevant exploration strategies from the task string.
 *
 * Returns:
 *   null         — no dominant pattern detected
 *   string       — single matching strategy label
 *   string[]     — compound strategy (multiple labels matched)
 */
export function detectStrategy(task) {
  const t = task.toLowerCase();
  const matches = [];
  if (/누가|언제|변경|커밋|commit|changed|who\s|when\s|recent|이력|history|수정/.test(t)) matches.push('git-guided');
  if (/정의|어디|위치|defined|where\s|definition|located|선언|구현/.test(t)) matches.push('symbol-first');
  if (/호출|사용|참조|called|used by|references|callers|import/.test(t)) matches.push('reference-chase');
  if (/구조|아키텍처|개요|structure|architecture|overview|전체|레이아웃/.test(t)) matches.push('breadth-first');
  if (/버그|원인|왜\s|bug|cause|why\s|blame|문제/.test(t)) matches.push('blame-guided');
  if (/패턴|모든|전부|pattern|all\s|every\s|similar|비교/.test(t)) matches.push('pattern-scan');
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return matches;
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

function formatRepoLabel(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    return 'repository';
  }
  return path.basename(path.resolve(repoRoot)) || 'repository';
}

/**
 * Build the system prompt for the explorer agent.
 *
 * @param {object} opts
 * @param {string}   opts.repoRoot
 * @param {object}   opts.budgetConfig
 * @param {string}   [opts.language]        - Task response language (passed through for explicit rule)
 * @param {string}   [opts.projectContext]  - Injected from .cerebras-explorer.json
 * @param {string[]} [opts.previousSummaries] - Summaries from prior session calls
 * @param {string[]} [opts.keyFiles]        - Key files from project config (prioritise these)
 */
export function buildExplorerSystemPrompt({ repoRoot, budgetConfig, language, projectContext, previousSummaries, keyFiles }) {
  const parts = [
    'You are Cerebras Explorer, an autonomous READ-ONLY repository exploration agent.',
    '',
    // ── HARD REQUIREMENTS (placed first — must appear within first 30 lines) ──
    '## HARD REQUIREMENTS',
    'These rules are non-negotiable. Violating any of them causes the response to be rejected.',
    '1. READ-ONLY: Never write files, run mutating commands, or suggest direct edits.',
    '2. FINAL ANSWER FORMAT: Output exactly one JSON object — no markdown fences, no prose outside it.',
    '3. GROUNDED EVIDENCE ONLY: Every evidence item must reference a file path and line range you actually inspected. Git evidence (commits, blame, diff hunks) from tool results is also valid.',
    '4. NO FABRICATION: Never invent or assume facts not confirmed by tool results.',
    '',
    // ── FINAL OUTPUT CONTRACT ──
    '## FINAL OUTPUT CONTRACT',
    '{',
    '  "answer": "string — direct answer to the task",',
    '  "summary": "string — short synthesis of key findings",',
    '  "confidence": "low|medium|high",',
    '  "evidence": [{"path": "relative/path", "startLine": 1, "endLine": 10, "why": "relevance", "evidenceType": "file_range|git_commit|git_blame|git_diff_hunk"}],',
    '  "candidatePaths": ["relative/path"],',
    '  "followups": [{"description": "...", "priority": "recommended|optional", "suggestedCall": {...}}]',
    '}',
    '- followups: use "recommended" when follow-up is essential; "optional" for non-critical next steps.',
    '- Use [] for followups when no further investigation is needed.',
    '',
    // ── LANGUAGE RULE ──
    '## LANGUAGE RULE',
    typeof language === 'string' && language.trim()
      ? `Answer in ${language.trim()} (explicitly requested). This applies to answer, summary, and followup descriptions.`
      : 'Answer in the same natural language as the delegated task. This applies to answer, summary, and followup descriptions.',
    '',
    // ── TOOL ORDER POLICY ──
    '## TOOL ORDER POLICY',
    'Choose the first tool by the nature of the task — this minimises unnecessary turns:',
    '- Symbol definition/callers? → repo_symbol_context(symbol) [macro: definition + callers in one call]',
    '- Recent changes / git history? → repo_git_log → repo_git_diff → repo_read_file',
    '- Ambiguous pattern / unknown location? → repo_grep or repo_find_files first, then repo_read_file',
    '- Precise file access (known path + lines)? → repo_read_file(path, startLine, endLine)',
    '- All definitions in a file? → repo_symbols(path) before reading the whole file',
    '- Full reference map? → repo_references(symbol, scope?)',
    '',
    // ── QUALITY TARGETS (soft goals) ──
    '## QUALITY TARGETS',
    'These improve answer quality but are not hard failures:',
    '- Gather at least 2 independent evidence points before using confidence=high on a non-trivial task.',
    '- Read the smallest relevant line ranges possible.',
    '- Stop exploring once evidence is sufficient — do not over-explore.',
    '',
    // ── EVIDENCE LEDGER ──
    '## EVIDENCE LEDGER',
    'As you explore, mentally track each confirmed piece of evidence as:',
    '  { path, startLine, endLine, why, evidenceType }',
    'evidenceType values: file_range (default), git_commit (from git_log/git_show), git_blame (from git_blame), git_diff_hunk (from git_diff/git_show).',
    'For git evidence: include "sha" for commits/blame, "author" for blame. For diff hunks: optionally include newStartLine/newEndLine.',
    'For history/git questions, commit/blame/diff hunk evidence is legitimate grounding — you do not need file reads to justify it.',
    'For current code semantics claims, file_range evidence with actual file reads is strongly preferred.',
    'Only include evidence you actually inspected via tool results. Do not invent evidence.',
    '',
    // ── STOP CONDITIONS ──
    '## STOP CONDITIONS',
    '- "why / bug / root-cause" tasks: gather at least 2 independent pieces of evidence before stopping.',
    '- "locate / define" tasks: 1 confirmed evidence item is sufficient to stop.',
    '- If you have enough evidence, stop immediately — do not make unnecessary additional tool calls.',
    '',
    // ── STRATEGY CATALOG ──
    '## STRATEGY CATALOG',
    'Use the strategy that best fits the task (you may switch once if evidence warrants it):',
    '- symbol-first:    "where is X defined?" → repo_symbol_context(symbol)',
    '- reference-chase: "where is X used/called?" → repo_symbol_context(symbol) or repo_references(symbol)',
    '- git-guided:      "what changed recently?" → repo_git_log → repo_git_diff → repo_read_file',
    '- breadth-first:   "project structure/overview?" → repo_list_dir(depth:3) → read key files',
    '- blame-guided:    "why does this bug exist?" → repo_grep → repo_git_blame → repo_git_show',
    '- pattern-scan:    "how is X done across codebase?" → repo_grep → read multiple files',
  ];

  // Project context from .cerebras-explorer.json
  if (typeof projectContext === 'string' && projectContext.trim()) {
    parts.push('', '## Project Context', projectContext.trim());
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
    `Repository: ${formatRepoLabel(repoRoot)} (tool paths are relative to the repo root).`,
    `Exploration budget: ${budgetConfig.label} (maxTurns=${budgetConfig.maxTurns}, maxReadLinesPerCall=${budgetConfig.maxReadLines}, maxSearchResults=${budgetConfig.maxSearchResults}).`,
  );

  return parts.join('\n');
}

function formatStrategyLine(strategy) {
  if (!strategy) {
    return 'Strategy: auto (no dominant pattern detected — start with repo_list_dir or repo_grep)';
  }
  if (Array.isArray(strategy)) {
    const labels = strategy.join('+');
    const descs = strategy.map(s => `${s}: ${STRATEGY_DESCRIPTIONS[s] ?? s}`).join('; ');
    return `Strategy: ${labels} (compound) — ${descs}`;
  }
  return `Strategy: ${strategy} — ${STRATEGY_DESCRIPTIONS[strategy] ?? strategy}`;
}

export function buildExplorerUserPrompt({ task, scope, budget, hints, sessionCandidatePaths, language }) {
  const strategy = hints?.strategy ?? detectStrategy(task);

  const lines = [
    'Delegated exploration request:',
    task.trim(),
    '',
    `Requested budget: ${budget}`,
    `Scope: ${formatScope(scope)}`,
    formatStrategyLine(strategy),
    'Hints:',
    formatHintBlock(hints),
  ];

  if (typeof language === 'string' && language.trim()) {
    lines.push(`Response language: ${language.trim()}`);
  }

  // Inject paths from a previous session call as context.
  // Accepts both string[] (legacy) and { path, why }[] (Phase 5 enriched format).
  if (Array.isArray(sessionCandidatePaths) && sessionCandidatePaths.length > 0) {
    const isEnriched = typeof sessionCandidatePaths[0] === 'object' && sessionCandidatePaths[0] !== null;
    const sample = sessionCandidatePaths.slice(0, 15);
    if (isEnriched) {
      const formatted = sample
        .map(e => `${e.path}${e.why ? ` (${e.why})` : ''}`)
        .join('; ');
      lines.push('', `Files from prior session with context (check these early):\n  ${formatted}`);
    } else {
      lines.push(
        '',
        `Files found in prior session calls (likely relevant — check these early): ${sample.join(', ')}`,
      );
    }
  }

  if (strategy) {
    const label = Array.isArray(strategy) ? strategy.join('+') : strategy;
    lines.push(
      '',
      `Initial strategy suggestion: ${label}. You may switch to a complementary strategy once if the evidence requires it. Stop as soon as evidence is sufficient.`,
    );
  }

  return lines.join('\n');
}

export function buildFinalizePrompt() {
  return [
    'Produce the final exploration result now.',
    'HARD REQUIREMENTS — violations will cause the response to be rejected:',
    '  • Output exactly one JSON object. No markdown fences, no prose before or after.',
    '  • Do not call any tools.',
    '  • Every evidence item must be grounded in a file path and line range already inspected.',
    '  • Use only information gathered during this session — no fabricated claims.',
    'SCHEMA REQUIREMENTS:',
    '  • Required fields: answer, summary, confidence (low|medium|high), evidence[], candidatePaths[], followups[]',
    '  • evidence items: { path, startLine, endLine, why, evidenceType? } — evidenceType defaults to file_range',
    '  • followups items: { description, priority (recommended|optional), suggestedCall? }',
    '  • Use an empty array [] for followups if no further investigation is needed.',
  ].join('\n');
}

// ── Phase 5: Free Explore prompts ──────────────────────────────────────────

/**
 * Build system prompt for freeExplore() — human-readable markdown report mode.
 */
export function buildFreeExploreSystemPrompt({ repoRoot, budgetConfig, language, projectContext, previousSummaries, keyFiles }) {
  const parts = [
    'You are Cerebras Explorer, an autonomous READ-ONLY repository exploration agent.',
    'Your output is a **human-readable Markdown report** — not JSON.',
    '',
    '## HARD REQUIREMENTS',
    '1. READ-ONLY: Never write files, run mutating commands, or suggest direct edits.',
    '2. FINAL ANSWER FORMAT: Output a Markdown report. No JSON, no code fences wrapping the entire output.',
    '3. GROUNDED CLAIMS: Every major claim must cite a file path and line range or git artifact you actually inspected.',
    '4. NO FABRICATION: Never invent or assume facts not confirmed by tool results.',
    '',
    '## REPORT STRUCTURE',
    'Your final report must follow this structure:',
    '1. **Summary** — 2-3 sentence overview of findings.',
    '2. **Findings** — detailed analysis with file path:line citations.',
    '3. **Uncertainty** — clearly flag anything you are unsure about.',
    '4. **Suggestions** — optional next steps or areas to investigate further.',
    '',
    '## EVIDENCE CITATION',
    'Cite evidence inline using `path/to/file:L10-L20` notation.',
    'For git evidence, use `commit:abc1234` or `blame:path:L5` notation.',
    'Distinguish facts (confirmed by tool output) from interpretation.',
    '',
    '## STOP RULE',
    'Stop exploring once further reads are unlikely to change your conclusions.',
    '',
    `Repository: ${formatRepoLabel(repoRoot)} (tool paths are relative to the repo root).`,
    `Turn budget: ${budgetConfig.maxTurns} turns.`,
  ];

  // Language rule
  if (typeof language === 'string' && language.trim()) {
    parts.push('', `Write the report in ${language.trim()} (explicitly requested).`);
  } else {
    parts.push('', 'Write the report in the same natural language as the user prompt.');
  }

  if (projectContext) {
    parts.push('', '## PROJECT CONTEXT', projectContext);
  }

  if (keyFiles && keyFiles.length > 0) {
    parts.push('', `Key files to prioritise: ${keyFiles.join(', ')}`);
  }

  if (previousSummaries && previousSummaries.length > 0) {
    parts.push('', '## PRIOR SESSION CONTEXT');
    previousSummaries.forEach((s, i) => parts.push(`[Call ${i + 1}] ${s}`));
  }

  return parts.join('\n');
}

/**
 * Build user prompt for freeExplore().
 */
export function buildFreeExploreUserPrompt({ prompt, scope, budget, context }) {
  const parts = [`Explore this repository and produce a report:\n${prompt}`];

  if (scope && scope.length > 0) {
    parts.push(`\nScope: focus on ${scope.join(', ')}`);
  }

  parts.push(`\nBudget: ${budget}. Use your turns wisely — stop when you have enough evidence.`);

  if (context) {
    parts.push(`\nAdditional context from the parent agent:\n${context}`);
  }

  return parts.join('\n');
}

/**
 * Build finalize prompt for freeExplore() — used when budget is exhausted before the model stops.
 */
export function buildFreeExploreFinalizePrompt() {
  return [
    'Budget exhausted. Produce your final Markdown report now based on what you have gathered so far.',
    'Do not call any more tools. Write the report directly.',
    'Structure: Summary → Findings (with citations) → Uncertainty → Suggestions.',
  ].join('\n');
}
