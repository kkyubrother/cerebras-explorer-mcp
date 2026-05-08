import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extractSymbols, detectLanguage, categorizeReference, classifyReference } from '../src/explorer/symbols.mjs';
import { RepoToolkit } from '../src/explorer/repo-tools.mjs';
import { BUDGETS } from '../src/explorer/config.mjs';

// ─── detectLanguage ──────────────────────────────────────────────────────────

test('detectLanguage identifies JavaScript and TypeScript files', () => {
  assert.equal(detectLanguage('src/index.js'), 'javascript');
  assert.equal(detectLanguage('src/index.mjs'), 'javascript');
  assert.equal(detectLanguage('src/index.ts'), 'typescript');
  assert.equal(detectLanguage('src/App.tsx'), 'typescript');
});

test('detectLanguage identifies Python, Go, Rust, Java, Ruby', () => {
  assert.equal(detectLanguage('app.py'), 'python');
  assert.equal(detectLanguage('main.go'), 'go');
  assert.equal(detectLanguage('lib.rs'), 'rust');
  assert.equal(detectLanguage('Main.java'), 'java');
  assert.equal(detectLanguage('app.rb'), 'ruby');
});

test('detectLanguage returns "generic" for unknown extensions', () => {
  assert.equal(detectLanguage('file.lua'), 'generic');
  assert.equal(detectLanguage('file.sh'), 'generic');
});

// ─── extractSymbols — JavaScript ─────────────────────────────────────────────

const JS_SOURCE = `
export function requireAuth(req, res, next) {
  if (!req.user) throw new Error('unauthorized');
  next();
}

export class UserRouter {
  constructor(app) {
    this.app = app;
  }

  async getUser(id) {
    return this.app.db.findUser(id);
  }

  #refreshCache() {
    return true;
  }

  static create(app) {
    return new UserRouter(app);
  }
}

export const DEFAULT_TIMEOUT = 30000;

const internalHelper = (x) => x * 2;

export interface AuthConfig {
  secret: string;
}
`;

test('extractSymbols finds function declarations in JavaScript', () => {
  const symbols = extractSymbols(JS_SOURCE, 'auth.js');
  const fn = symbols.find(s => s.name === 'requireAuth');
  assert.ok(fn, 'requireAuth should be found');
  assert.equal(fn.kind, 'function');
  assert.equal(fn.exported, true);
  assert.ok(fn.line > 0, 'line must be positive');
  assert.ok(fn.endLine >= fn.line, 'endLine must be >= line');
});

test('extractSymbols finds class declarations in JavaScript', () => {
  const symbols = extractSymbols(JS_SOURCE, 'auth.js');
  const cls = symbols.find(s => s.name === 'UserRouter');
  assert.ok(cls, 'UserRouter class should be found');
  assert.equal(cls.kind, 'class');
  assert.equal(cls.exported, true);
});

test('extractSymbols finds class methods', () => {
  const symbols = extractSymbols(JS_SOURCE, 'auth.js');
  const method = symbols.find(s => s.name === 'getUser');
  assert.ok(method, 'getUser method should be found');
  assert.equal(method.kind, 'function');
});

test('extractSymbols annotates class methods and ignores indented calls', () => {
  const symbols = extractSymbols(JS_SOURCE, 'auth.js');
  assert.equal(symbols.some(s => s.name === 'next'), false, 'indented calls are not definitions');

  const method = symbols.find(s => s.name === 'getUser');
  assert.equal(method.containerName, 'UserRouter');
  assert.equal(method.containerKind, 'class');
  assert.equal(method.qualifiedName, 'UserRouter.getUser');
  assert.match(method.signature, /async getUser/);

  const privateMethod = symbols.find(s => s.name === '#refreshCache');
  assert.equal(privateMethod.qualifiedName, 'UserRouter.#refreshCache');
});

test('extractSymbols finds exported constants as variables', () => {
  const symbols = extractSymbols(JS_SOURCE, 'auth.js');
  const constant = symbols.find(s => s.name === 'DEFAULT_TIMEOUT');
  assert.ok(constant, 'DEFAULT_TIMEOUT should be found');
  assert.ok(['variable', 'function'].includes(constant.kind), 'kind should be variable or function');
});

test('extractSymbols kind filter works', () => {
  const symbols = extractSymbols(JS_SOURCE, 'auth.js', 'class');
  const classes = symbols.filter(s => s.kind === 'class');
  const nonClasses = symbols.filter(s => s.kind !== 'class');
  assert.ok(classes.length > 0, 'should find at least one class');
  assert.equal(nonClasses.length, 0, 'should not return non-class symbols when kind=class');
});

// ─── extractSymbols — TypeScript ─────────────────────────────────────────────

const TS_SOURCE = `
export interface UserConfig {
  id: string;
  name: string;
}

export type UserId = string;

export enum Role {
  Admin = 'admin',
  User = 'user',
}

export abstract class UserRepository<T> {
  protected async load<TOut>(id: UserId): Promise<TOut> {
    return null as TOut;
  }
}

export declare function resolveUser<T extends UserConfig>(config: T): UserId;

export const parseUser: Parser<UserConfig> = (input) => input as UserConfig;

const identity = <T>(value: T) => value;

export async function createUser(config: UserConfig): Promise<void> {
  // implementation
}
`;

test('extractSymbols finds TypeScript interface, type alias, and enum', () => {
  const symbols = extractSymbols(TS_SOURCE, 'user.ts');
  const names = symbols.map(s => s.name);
  assert.ok(names.includes('UserConfig'), 'interface UserConfig');
  assert.ok(names.includes('UserId'), 'type UserId');
  assert.ok(names.includes('Role'), 'enum Role');
});

test('extractSymbols handles TypeScript generics, typed arrows, and method containers', () => {
  const symbols = extractSymbols(TS_SOURCE, 'user.ts');
  const names = symbols.map(s => s.name);
  assert.ok(names.includes('UserRepository'), 'abstract generic class');
  assert.ok(names.includes('resolveUser'), 'declare generic function');
  assert.ok(names.includes('parseUser'), 'typed arrow function');
  assert.ok(names.includes('identity'), 'generic arrow function');

  const load = symbols.find(s => s.name === 'load');
  assert.equal(load.containerName, 'UserRepository');
  assert.equal(load.qualifiedName, 'UserRepository.load');
});

// ─── extractSymbols — Python ─────────────────────────────────────────────────

const PY_SOURCE = `
def handle_request(request):
    return process(request)

class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    def process_request(self, request):
        if not request.user:
            raise PermissionError

MAX_RETRIES = 5
`;

test('extractSymbols finds Python functions and classes', () => {
  const symbols = extractSymbols(PY_SOURCE, 'views.py');
  const names = symbols.map(s => s.name);
  assert.ok(names.includes('handle_request'), 'handle_request function');
  assert.ok(names.includes('AuthMiddleware'), 'AuthMiddleware class');
  assert.ok(names.includes('process_request'), 'process_request method');
});

// ─── categorizeReference ─────────────────────────────────────────────────────

test('categorizeReference identifies import lines', () => {
  assert.equal(categorizeReference('import { requireAuth } from "./auth.js";', 'requireAuth', 'routes.js'), 'import');
  assert.equal(categorizeReference('const auth = require("./auth");', 'auth', 'app.js'), 'import');
});

test('categorizeReference identifies definition lines', () => {
  assert.equal(categorizeReference('export function requireAuth(req, res, next) {', 'requireAuth', 'auth.js'), 'definition');
  assert.equal(categorizeReference('export class UserRouter {', 'UserRouter', 'router.js'), 'definition');
});

test('categorizeReference identifies usage lines', () => {
  assert.equal(categorizeReference('  app.use(requireAuth);', 'requireAuth', 'routes.js'), 'usage');
  assert.equal(categorizeReference('  const router = new UserRouter(app);', 'UserRouter', 'main.js'), 'usage');
});

test('classifyReference adds relation details without changing legacy type', () => {
  assert.deepEqual(
    classifyReference('export { requireAuth, manager };', 'requireAuth', 'index.js'),
    { type: 'usage', relation: 'export' },
  );
  assert.deepEqual(
    classifyReference('  const router = new UserRouter(app);', 'UserRouter', 'main.ts'),
    { type: 'usage', relation: 'constructor' },
  );
  assert.deepEqual(
    classifyReference('  requireAuth(req, res, next);', 'requireAuth', 'routes.js'),
    { type: 'usage', relation: 'call' },
  );
  assert.deepEqual(
    classifyReference('const selected: UserConfig = input as UserConfig;', 'UserConfig', 'user.ts'),
    { type: 'usage', relation: 'type_reference' },
  );
});

// ─── RepoToolkit: repo_symbols tool ──────────────────────────────────────────

async function makeJsFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-symbols-'));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(
    path.join(root, 'src', 'auth.js'),
    [
      'export function requireAuth(req, res, next) {',
      '  if (!req.user) throw new Error("unauthorized");',
      '  next();',
      '}',
      '',
      'export class SessionManager {',
      '  constructor() { this.sessions = new Map(); }',
      '  #touch() { return Date.now(); }',
      '  create(userId) { this.#touch(); return this.sessions.set(userId, Date.now()); }',
      '}',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(root, 'src', 'index.js'),
    [
      'import { requireAuth } from "./auth.js";',
      'import { SessionManager } from "./auth.js";',
      '',
      'const manager = new SessionManager();',
      'export { requireAuth, manager };',
    ].join('\n'),
  );
  return root;
}

test('repo_symbols extracts function and class definitions', async () => {
  const root = await makeJsFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: BUDGETS.normal });
  await toolkit.initialize([]);

  const result = await toolkit.callTool('repo_symbols', { path: 'src/auth.js' });
  assert.equal(result.path, 'src/auth.js');
  assert.ok(Array.isArray(result.symbols));
  const names = result.symbols.map(s => s.name);
  assert.ok(names.includes('requireAuth'), 'must find requireAuth');
  assert.ok(names.includes('SessionManager'), 'must find SessionManager');
});

test('repo_symbols kind filter returns only requested kind', async () => {
  const root = await makeJsFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: BUDGETS.normal });
  await toolkit.initialize([]);

  const result = await toolkit.callTool('repo_symbols', { path: 'src/auth.js', kind: 'class' });
  const nonClass = result.symbols.filter(s => s.kind !== 'class');
  assert.equal(nonClass.length, 0, 'all symbols must be classes when kind=class');
});

test('repo_references finds symbol definition and usages across files', async () => {
  const root = await makeJsFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: BUDGETS.normal });
  await toolkit.initialize([]);

  const result = await toolkit.callTool('repo_references', { symbol: 'requireAuth' });
  assert.equal(result.symbol, 'requireAuth');
  // Should find definition in auth.js and import in index.js
  const allPaths = [
    result.definition?.path,
    ...result.references.map(r => r.path),
  ].filter(Boolean);
  assert.ok(allPaths.some(p => p.includes('auth')), 'definition must be in auth.js');
  assert.ok(allPaths.some(p => p.includes('index')), 'usage must be in index.js');
  const reexport = result.references.find(ref => ref.context.startsWith('export {'));
  assert.equal(reexport.relation, 'export');
});

test('repo_references handles JavaScript private symbol names', async () => {
  const root = await makeJsFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: BUDGETS.normal });
  await toolkit.initialize([]);

  const result = await toolkit.callTool('repo_references', { symbol: '#touch' });
  assert.equal(result.definition?.context, '#touch() { return Date.now(); }');
  assert.ok(result.references.some(ref => ref.relation === 'member_call'));
});

test('repo_symbol_context returns definition body and callers', async () => {
  const root = await makeJsFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: BUDGETS.normal });
  await toolkit.initialize([]);

  const result = await toolkit.callTool('repo_symbol_context', { symbol: 'requireAuth' });
  assert.equal(result.symbol, 'requireAuth');
  assert.ok(result.definition, 'definition must be present');
  assert.ok(result.definition.path.includes('auth'), 'definition must be in auth.js');
  assert.ok(typeof result.definition.line === 'number', 'definition must have a line number');
  assert.ok(Array.isArray(result.callers), 'callers must be an array');
  assert.equal(
    result.callers.some(caller => caller.context.startsWith('export {')),
    false,
    're-export lines are not callers',
  );
});

test('repo_grep with contextLines includes surrounding lines', async () => {
  const root = await makeJsFixture();
  const toolkit = new RepoToolkit({ repoRoot: root, budgetConfig: BUDGETS.normal });
  await toolkit.initialize([]);

  const result = await toolkit.callTool('repo_grep', { pattern: 'requireAuth', contextLines: 2 });
  assert.ok(Array.isArray(result.matches), 'matches must be an array');
  // Matches with contextLines should have a context field
  const withContext = result.matches.filter(m => m.context);
  assert.ok(withContext.length > 0, 'at least one match should have context');
  // Context should contain multiple lines
  assert.ok(withContext[0].context.includes('\n'), 'context should span multiple lines');
});
