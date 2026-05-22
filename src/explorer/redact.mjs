import { redactEnvVarNamesEnabled } from './config.mjs';
import { isSecretPath } from './security.mjs';

const REDACTION_RULES = Object.freeze([
  { id: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g },
  { id: 'anthropic-api-key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'openai-api-key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'gcp-api-key', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { id: 'slack-token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { id: 'stripe-live-secret', regex: /\bsk_live_[0-9a-zA-Z]{24,}\b/g },
  { id: 'jwt', regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  {
    id: 'private-key-block',
    regex: /-----BEGIN ([A-Z0-9 -]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
  },
]);

const GENERIC_HEX_RULE = Object.freeze({
  id: 'generic-hex-32',
  regex: /\b[0-9a-fA-F]{32,}\b/g,
});

// Token-bounded secret-path matcher. Requires a non-identifier character
// (or start of input) immediately before the path so that identifier
// expressions like `process.env.X` or `import.meta.env.X` are not redacted
// as if they were secret file paths. The bounded form preserves the
// surrounding context character in the replacement.
const SECRET_PATH_TOKEN_SOURCE =
  '([A-Za-z0-9_.-][A-Za-z0-9_./\\\\-]*\\/[A-Za-z0-9_./\\\\-]+|\\.env(?:\\.[A-Za-z0-9_.-]+)?|\\.envrc|\\.npmrc|\\.netrc|id_rsa(?:\\.pub)?|id_ed25519(?:\\.pub)?)';

const SECRET_PATH_MENTION_REGEX = new RegExp(
  `(^|[\\s"'\\[\\({,;])\`?${SECRET_PATH_TOKEN_SOURCE}(?::L?\\d+(?:-L?\\d+)?)?\`?(?=$|[\\s"'\\])},.:;])`,
  'g',
);

// Optional env-var identifier redaction (opt-in via
// CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1). Default behavior preserves
// env var names because they describe a public code interface.
const ENV_VAR_NAME_PATTERNS = Object.freeze([
  {
    id: 'env-var-name',
    regex: /\b(process|import\.meta)\.env\.([A-Z_][A-Z0-9_]*)\b/g,
    replace: (_raw, prefix) => `${prefix}.env.[REDACTED:env-var-name]`,
  },
  {
    id: 'env-var-name',
    regex: /\bDeno\.env\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\)/g,
    replace: () => 'Deno.env.get("[REDACTED:env-var-name]")',
  },
]);

function shouldRedactGenericHex(env = process.env) {
  return env.CEREBRAS_EXPLORER_REDACT_GENERIC_HEX === '1';
}

function unique(values) {
  return [...new Set(values)];
}

export function redactText(value, {
  includeGenericHex = shouldRedactGenericHex(),
  includeEnvVarNames = redactEnvVarNamesEnabled(),
} = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    return { text: value, redacted: false, redactions: [] };
  }

  let text = value;
  const redactions = [];
  const rules = includeGenericHex ? [...REDACTION_RULES, GENERIC_HEX_RULE] : REDACTION_RULES;

  for (const rule of rules) {
    let matched = false;
    text = text.replace(rule.regex, () => {
      matched = true;
      return `[REDACTED:${rule.id}]`;
    });
    if (matched) redactions.push(rule.id);
  }

  let secretPathMatched = false;
  text = text.replace(SECRET_PATH_MENTION_REGEX, (raw, prefix, relPath) => {
    if (!isSecretPath(relPath).matched) return raw;
    secretPathMatched = true;
    return `${prefix}[REDACTED:secret-path]`;
  });
  if (secretPathMatched) redactions.push('secret-path');

  if (includeEnvVarNames) {
    let envVarMatched = false;
    for (const rule of ENV_VAR_NAME_PATTERNS) {
      text = text.replace(rule.regex, (...args) => {
        envVarMatched = true;
        return rule.replace(...args);
      });
    }
    if (envVarMatched) redactions.push('env-var-name');
  }

  return {
    text,
    redacted: redactions.length > 0,
    redactions: unique(redactions),
  };
}

export function redactValue(value, options = {}) {
  if (typeof value === 'string') {
    const result = redactText(value, options);
    return {
      value: result.text,
      redacted: result.redacted,
      redactions: result.redactions,
    };
  }

  if (Array.isArray(value)) {
    const redactions = [];
    const next = value.map(item => {
      const result = redactValue(item, options);
      redactions.push(...result.redactions);
      return result.value;
    });
    return {
      value: next,
      redacted: redactions.length > 0,
      redactions: unique(redactions),
    };
  }

  if (value && typeof value === 'object') {
    const redactions = [];
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const result = redactValue(item, options);
      redactions.push(...result.redactions);
      next[key] = result.value;
    }
    return {
      value: next,
      redacted: redactions.length > 0,
      redactions: unique(redactions),
    };
  }

  return { value, redacted: false, redactions: [] };
}

export function redactEvidenceItem(item, options = {}) {
  const result = redactValue(item, options);
  const existingRedactions = Array.isArray(item?.redactions) ? item.redactions : [];
  const redactions = unique([...existingRedactions, ...result.redactions]);
  if (redactions.length === 0) {
    return result.value;
  }
  return {
    ...result.value,
    redacted: true,
    redactions,
  };
}

export function redactExploreResult(result, options = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return redactValue(result, options);
  }

  const redactions = [];
  const next = {};
  for (const [key, value] of Object.entries(result)) {
    if (key === 'evidence' && Array.isArray(value)) {
      next.evidence = value.map(item => {
        const redactedItem = redactEvidenceItem(item, options);
        if (Array.isArray(redactedItem.redactions)) redactions.push(...redactedItem.redactions);
        return redactedItem;
      });
      continue;
    }

    const redacted = redactValue(value, options);
    redactions.push(...redacted.redactions);
    next[key] = redacted.value;
  }

  return {
    value: next,
    redacted: redactions.length > 0,
    redactions: unique(redactions),
  };
}
