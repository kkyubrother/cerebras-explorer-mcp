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

export function buildExplorerSystemPrompt({ repoRoot, budgetConfig }) {
  return [
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
    'Available git tools (use when history or authorship context is needed):',
    '- repo_git_log: commit history for the repo or a specific file. Use to find "what changed recently".',
    '- repo_git_blame: line-level author/commit for a file range. Use to find "who wrote this and why".',
    '- repo_git_diff: diff between two refs. Use stat=true first for overview, then full diff for details.',
    '- repo_git_show: full details of a single commit (message + patch). Use after git_log to inspect a specific change.',
    '',
    'Final JSON shape:',
    '{',
    '  "answer": "string",',
    '  "summary": "string",',
    '  "confidence": "low|medium|high",',
    '  "evidence": [',
    '    {"path": "relative/path", "startLine": 1, "endLine": 10, "why": "why this evidence matters"}',
    '  ],',
    '  "candidatePaths": ["relative/path"],',
    '  "followups": ["optional remaining questions or next checks"]',
    '}',
    '',
    'Repository root:',
    repoRoot,
    '',
    `Exploration budget: ${budgetConfig.label} (maxTurns=${budgetConfig.maxTurns}, maxReadLinesPerCall=${budgetConfig.maxReadLines}, maxSearchResults=${budgetConfig.maxSearchResults}).`,
  ].join('\n');
}

export function buildExplorerUserPrompt({ task, scope, budget, hints }) {
  return [
    'Delegated exploration request:',
    task.trim(),
    '',
    `Requested budget: ${budget}`,
    `Scope: ${formatScope(scope)}`,
    'Hints:',
    formatHintBlock(hints),
    '',
    'Work plan:',
    '1. Discover likely relevant files.',
    '2. Read only the smallest ranges needed to answer.',
    '3. Stop once evidence is sufficient.',
    '4. Return the final JSON result.',
  ].join('\n');
}

export function buildFinalizePrompt() {
  return [
    'Produce the final exploration result now.',
    'Return valid JSON only.',
    'Do not call any tools.',
    'Ground every evidence item in files and line ranges already inspected.',
  ].join('\n');
}
