/**
 * Regex-based symbol extractor.
 *
 * Supports JavaScript, TypeScript, Python, Go, Rust, Java, and Ruby.
 * Falls back to a generic (limited) extractor for other languages.
 *
 * The primary goal is accuracy for the most common patterns. Unusual
 * constructs (computed property names, decorators-only classes, etc.)
 * may be missed — the caller should fall back to `repo_grep` for those.
 */

import path from 'node:path';

// Keywords that look like function calls but are control-flow — never symbols.
const CONTROL_FLOW_KW = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch', 'finally',
  'return', 'break', 'continue', 'throw', 'new', 'delete', 'typeof',
  'instanceof', 'in', 'of', 'yield', 'await', 'import', 'export',
  'from', 'as', 'default', 'static', 'super', 'this', 'void',
]);

const JS_IDENTIFIER = '[A-Za-z_$][\\w$]*';
const JS_MEMBER_IDENTIFIER = `#?${JS_IDENTIFIER}|constructor`;

// ─── Language detection ──────────────────────────────────────────────────────

const EXT_LANG_MAP = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java', kt: 'java',   // Kotlin shares many patterns with Java
  rb: 'ruby',
  php: 'php',
};

export function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return EXT_LANG_MAP[ext] ?? 'generic';
}

// ─── Per-line pattern sets ───────────────────────────────────────────────────
// Each pattern: { re, kind }
// The FIRST capturing group must be the symbol name.

const JS_PATTERNS = [
  // export (default)? declare? async? function* name<T>(
  { re: new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${JS_IDENTIFIER})\\s*(?:<[^>{}();=]*>)?\\s*\\(`), kind: 'function' },
  // export (default)? class Name
  { re: new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+(${JS_IDENTIFIER})(?:\\s|\\{|<)`), kind: 'class', containerKind: 'class' },
  // export? const/let/var name = async? function
  { re: new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+(${JS_IDENTIFIER})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?function`), kind: 'function' },
  // export? const/let/var name: Type = async? (...) =>   (arrow with parens)
  { re: new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+(${JS_IDENTIFIER})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>`), kind: 'function' },
  // export? const/let/var name = async? <T>(...) =>   (generic arrow)
  { re: new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+(${JS_IDENTIFIER})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?<[^>]+>\\s*\\([^)]*\\)\\s*=>`), kind: 'function' },
  // export? const/let/var name = async? ident =>   (arrow without parens)
  { re: new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+(${JS_IDENTIFIER})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?${JS_IDENTIFIER}\\s*=>`), kind: 'function' },
  // export? const/let/var name = value  (non-function — checked after function patterns)
  { re: new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+(${JS_IDENTIFIER})\\s*(?::[^=]+)?=`), kind: 'variable' },
  // class method (2+ spaces indent): modifiers? get? set? name<T>(...) {
  {
    re: new RegExp(`^\\s{2,}(?:(?:public|private|protected|readonly|override|abstract|static|async)\\s+)*(?:get\\s+|set\\s+)?(${JS_MEMBER_IDENTIFIER})\\s*(?:<[^>{}();=]*>)?\\s*\\([^)]*\\)(?:[ \t]*:[ \t]*[^\\s;]+(?:[ \t]+[^\\s;]+)*)?[ \t]*(?:\\{|$)`),
    kind: 'function',
    requiresContainer: ['class'],
  },
];

const TS_PATTERNS = [
  ...JS_PATTERNS,
  // interface Name
  { re: /^(?:export\s+)?interface\s+(\w+)/, kind: 'type' },
  // type Name =
  { re: /^(?:export\s+)?type\s+(\w+)\s*(?:=|<)/, kind: 'type' },
  // enum Name
  { re: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/, kind: 'type' },
];

const PY_PATTERNS = [
  // async def name(  (any indent level)
  { re: /^(\s*)async\s+def\s+(\w+)\s*\(/, kind: 'function', nameGroup: 2 },
  // def name(  (any indent level)
  { re: /^(\s*)def\s+(\w+)\s*\(/, kind: 'function', nameGroup: 2 },
  // class Name
  { re: /^class\s+(\w+)(?:\s|\(|:)/, kind: 'class' },
  // NAME = value  (module-level assignment — top-level variables)
  { re: /^([A-Z_][A-Z0-9_]*)\s*=/, kind: 'variable' },  // UPPER_CASE only to reduce noise
];

const GO_PATTERNS = [
  // func (receiver) Name(
  { re: /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/, kind: 'function' },
  // type Name struct/interface
  { re: /^type\s+(\w+)\s+(?:struct|interface)/, kind: 'class' },
  // type Name = OtherType
  { re: /^type\s+(\w+)\s+=/, kind: 'type' },
  // var/const name
  { re: /^(?:var|const)\s+(\w+)\s/, kind: 'variable' },
];

const RUST_PATTERNS = [
  // pub? async? fn name
  { re: /^(?:\s*)(?:pub\s+(?:\([^)]+\)\s+)?)?(?:async\s+)?fn\s+(\w+)/, kind: 'function' },
  // pub? struct/enum/trait Name
  { re: /^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/, kind: 'class' },
  // pub? type Name
  { re: /^(?:pub\s+)?type\s+(\w+)\s*=/, kind: 'type' },
  // const/static NAME: type = value
  { re: /^(?:pub\s+)?(?:const|static)\s+(\w+)\s*:/, kind: 'variable' },
  // impl Name  (not really a symbol but useful context)
  { re: /^impl(?:<[^>]+>)?\s+(\w+)/, kind: 'class' },
];

const JAVA_PATTERNS = [
  // public|private|protected? static? returnType methodName(
  { re: /^\s+(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*(?:\w+(?:<[^>]+>)?(?:\[\])*\s+)(\w+)\s*\(/, kind: 'function' },
  // constructor: public/private/protected ClassName(  (no return type)
  { re: /^\s+(?:(?:public|private|protected)\s+)?([A-Z]\w+)\s*\(/, kind: 'function' },
  // class/interface/enum Name
  { re: /^(?:(?:public|private|protected|abstract|final)\s+)*(?:class|interface|enum)\s+(\w+)/, kind: 'class' },
  // record Name
  { re: /^(?:(?:public|private|protected)\s+)?record\s+(\w+)/, kind: 'class' },
];

const RUBY_PATTERNS = [
  // def name or def self.name
  { re: /^\s*def\s+(?:self\.)?(\w+(?:[?!])?)/, kind: 'function' },
  // class/module Name
  { re: /^\s*(?:class|module)\s+(\w+)/, kind: 'class' },
  // NAME = value (constant)
  { re: /^\s*([A-Z][A-Z0-9_]*)\s*=/, kind: 'variable' },
];

const PHP_PATTERNS = [
  { re: /^\s*(?:public|private|protected|static|abstract|final)?\s*function\s+(\w+)\s*\(/, kind: 'function' },
  { re: /^\s*(?:abstract\s+)?class\s+(\w+)/, kind: 'class' },
  { re: /^\s*interface\s+(\w+)/, kind: 'type' },
];

const GENERIC_PATTERNS = [
  // Common function-like: keyword name(
  { re: /^(?:function|def|fn|func)\s+(\w+)\s*\(/, kind: 'function' },
  { re: /^(?:class|struct|interface|trait)\s+(\w+)/, kind: 'class' },
];

const LANG_PATTERNS = {
  javascript: JS_PATTERNS,
  typescript: TS_PATTERNS,
  python: PY_PATTERNS,
  go: GO_PATTERNS,
  rust: RUST_PATTERNS,
  java: JAVA_PATTERNS,
  ruby: RUBY_PATTERNS,
  php: PHP_PATTERNS,
  generic: GENERIC_PATTERNS,
};

function escapeRegex(input) {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function compactSignature(line) {
  return line
    .trim()
    .replace(/\s*\{\s*$/, '')
    .replace(/\s+/g, ' ');
}

function createSymbolRecord({ name, kind, line, endLine, exported, lang, rawLine, container }) {
  const symbol = {
    name,
    kind,
    line,
    endLine,
    exported,
    signature: compactSignature(rawLine),
    language: lang,
  };

  if (container) {
    symbol.containerName = container.name;
    symbol.containerKind = container.kind;
    symbol.qualifiedName = `${container.name}.${name}`;
  }

  return symbol;
}

function matchesRequiredContainer(pattern, activeContainer) {
  if (!pattern.requiresContainer) return true;
  if (!activeContainer) return false;
  return pattern.requiresContainer.includes(activeContainer.kind);
}

function trimExpiredContainers(activeContainers, lineNum) {
  while (activeContainers.length > 0 && activeContainers.at(-1).endLine < lineNum) {
    activeContainers.pop();
  }
}

function shouldTrackContainer(lang, pattern, rawLine) {
  if (pattern.containerKind === 'class') return true;
  if ((lang === 'javascript' || lang === 'typescript') && pattern.kind === 'variable') {
    return /=\s*\{/.test(rawLine);
  }
  return false;
}

// ─── endLine estimation ──────────────────────────────────────────────────────

/**
 * Estimate the end line of a symbol by counting brace depth (JS/TS/Java/Go/Rust).
 * Returns startLine (1-based) as fallback if the block cannot be determined.
 */
function estimateEndLineBraces(lines, startIndex) {
  let depth = 0;
  let opened = false;
  let inSingleLineString = false;
  let inTemplateLiteral = false;

  for (let i = startIndex; i < Math.min(lines.length, startIndex + 600); i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      // Simplified string skip (doesn't handle all edge-cases, but good enough)
      if ((c === '"' || c === "'") && !inTemplateLiteral) {
        j++;
        while (j < line.length && line[j] !== c) {
          if (line[j] === '\\') j++;
          j++;
        }
        continue;
      }
      if (c === '`') {
        inTemplateLiteral = !inTemplateLiteral;
        continue;
      }
      if (c === '/' && line[j + 1] === '/') break; // line comment
      if (c === '{') { depth++; opened = true; }
      if (c === '}') {
        depth--;
        if (opened && depth === 0) return i + 1; // 1-based
      }
    }
  }
  return startIndex + 1; // fallback: same line as start
}

/**
 * Estimate end line of a Python def/class by tracking indentation.
 */
function estimateEndLinePython(lines, startIndex) {
  const startLine = lines[startIndex] ?? '';
  const bodyIndent = (startLine.match(/^(\s*)/)?.[1]?.length ?? 0) + 1;

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent <= bodyIndent - 1) {
      return i; // 1-based exclusive (caller gets the line before)
    }
  }
  return lines.length;
}

// ─── Core extraction ─────────────────────────────────────────────────────────

/**
 * Extract symbol definitions from file content.
 *
 * @param {string}  content   - Raw file text
 * @param {string}  filePath  - Used for language detection
 * @param {string}  [kind]    - 'function'|'class'|'variable'|'type'|'all'
 * @returns {Array<{name:string, kind:string, line:number, endLine:number, exported:boolean}>}
 */
export function extractSymbols(content, filePath, kind = 'all') {
  const lang = detectLanguage(filePath);
  const patterns = LANG_PATTERNS[lang] ?? GENERIC_PATTERNS;
  const lines = content.split('\n');
  const results = [];
  const seen = new Set(); // deduplicate name+line combos
  const activeContainers = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const hashComment = !['javascript', 'typescript'].includes(lang) && trimmed.startsWith('#');
    if (!trimmed || trimmed.startsWith('//') || hashComment) continue;
    const lineNum = i + 1; // 1-based
    trimExpiredContainers(activeContainers, lineNum);
    const activeContainer = activeContainers.at(-1) ?? null;

    for (const pat of patterns) {
      if (!matchesRequiredContainer(pat, activeContainer)) continue;

      const match = line.match(pat.re);
      if (!match) continue;

      // Name is in capturing group: pat.nameGroup (default 1)
      const nameGroup = pat.nameGroup ?? 1;
      const name = match[nameGroup];
      if (!name || CONTROL_FLOW_KW.has(name)) continue;

      const exported = /^(?:export)\s/.test(line.trim());

      let endLine;
      if (lang === 'python') {
        endLine = estimateEndLinePython(lines, i);
      } else {
        endLine = estimateEndLineBraces(lines, i);
      }

      if (kind === 'all' || kind === pat.kind) {
        const key = `${name}:${lineNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          const container = pat.requiresContainer ? activeContainer : null;
          results.push(createSymbolRecord({
            name,
            kind: pat.kind,
            line: lineNum,
            endLine,
            exported,
            lang,
            rawLine: line,
            container,
          }));
        }
      }

      if (shouldTrackContainer(lang, pat, line) && endLine >= lineNum) {
        activeContainers.push({
          name,
          kind: pat.containerKind ?? 'object',
          line: lineNum,
          endLine,
        });
      }

      break; // one symbol match per line
    }
  }

  return results;
}

function isImportLine(trimmed, lang) {
  return (
    /^import\s/.test(trimmed) ||
    /require\s*\(/.test(trimmed) ||
    (lang === 'python' && /^from\s|^import\s/.test(trimmed)) ||
    (lang === 'go' && /^import\s/.test(trimmed))
  );
}

function isDefinitionLine(line, symbol, lang) {
  const patterns = LANG_PATTERNS[lang] ?? GENERIC_PATTERNS;
  for (const pat of patterns) {
    const m = line.match(pat.re);
    if (m) {
      const nameGroup = pat.nameGroup ?? 1;
      if (m[nameGroup] === symbol) return true;
    }
  }
  return false;
}

function symbolBoundaryRegex(symbol) {
  const escaped = escapeRegex(symbol);
  return new RegExp(`(^|[^\\w$#])${escaped}(?=[^\\w$#]|$)`);
}

function hasSymbol(line, symbol) {
  return symbolBoundaryRegex(symbol).test(line);
}

function relationForUsage(trimmed, symbol, lang) {
  const escaped = escapeRegex(symbol);

  if ((lang === 'javascript' || lang === 'typescript') && /^export\s/.test(trimmed)) {
    return 'export';
  }

  if (
    lang === 'typescript' &&
    new RegExp(`(?:[:<|&,]|\\b(?:as|satisfies|implements|extends)\\s+)\\s*[^=;(){}]*\\b${escaped}\\b`).test(trimmed)
  ) {
    return 'type_reference';
  }

  if (new RegExp(`\\bnew\\s+${escaped}\\s*(?:<[^>]+>)?\\s*\\(`).test(trimmed)) {
    return 'constructor';
  }

  if (new RegExp(`(?:^|[^.\\w$#])${escaped}\\s*(?:<[^>]+>)?\\s*\\(`).test(trimmed)) {
    return 'call';
  }

  if (new RegExp(`\\.${escaped}\\s*\\(`).test(trimmed)) {
    return 'member_call';
  }

  if (new RegExp(`\\b${escaped}\\s*:`).test(trimmed)) {
    return 'property';
  }

  return 'reference';
}

/**
 * Classify a reference line while preserving the legacy type contract.
 *
 * `type` remains one of 'import', 'definition', or 'usage'. `relation`
 * gives callers a lower-noise hint such as 'export', 'call', or
 * 'type_reference' without requiring an external parser.
 *
 * @param {string} line     - The source line
 * @param {string} symbol   - The symbol being searched
 * @param {string} filePath - Used for language detection
 */
export function classifyReference(line, symbol, filePath) {
  const lang = detectLanguage(filePath);
  const trimmed = line.trim();

  if (isImportLine(trimmed, lang)) {
    return { type: 'import', relation: /^import\s+type\b/.test(trimmed) ? 'type_import' : 'import' };
  }

  if (isDefinitionLine(line, symbol, lang)) {
    return { type: 'definition', relation: 'definition' };
  }

  const relation = hasSymbol(line, symbol)
    ? relationForUsage(trimmed, symbol, lang)
    : 'reference';

  return { type: 'usage', relation };
}

/**
 * Categorize a reference line as 'import', 'definition', or 'usage'.
 *
 * @param {string} line     - The source line
 * @param {string} symbol   - The symbol being searched
 * @param {string} filePath - Used for language detection
 */
export function categorizeReference(line, symbol, filePath) {
  return classifyReference(line, symbol, filePath).type;
}
