# Top-Level Session Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact top-level `session` object to agent-facing `explore_repo` output so upper AI agents can see session reuse, fallback, and remaining calls without reading `_debug.stats`.

**Architecture:** Keep the internal model contract unchanged. Add `SESSION_SCHEMA` to the public MCP output schema, derive the runtime/MCP `session` object from existing `sessionId`, `sessionStatus`, and `remainingCalls` stats, and keep top-level `sessionId` for compatibility.

**Tech Stack:** Node.js ESM, built-in `node:test`, MCP JSON schema objects, existing `SessionStore`.

---

### Task 1: Add Public Session Schema

**Files:**
- Modify: `tests/schemas.test.mjs`
- Modify: `src/explorer/schemas.mjs`

- [ ] **Step 1: Write the failing schema test**

In `tests/schemas.test.mjs`, update `agent-facing output schema is compact and exposes directAnswer, status, targets, snippets, sessionId, and debug`:

```js
  assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.session);
  assert.deepEqual(
    EXPLORE_REPO_OUTPUT_SCHEMA.properties.session.properties.status.enum,
    ['created', 'reused', 'fallback'],
  );
  assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.properties.session.required, [
    'id',
    'status',
    'remainingCalls',
  ]);
```

- [ ] **Step 2: Run the schema test and verify red**

Run:

```bash
node --test tests/schemas.test.mjs
```

Expected: FAIL because `EXPLORE_REPO_OUTPUT_SCHEMA.properties.session` is missing.

- [ ] **Step 3: Add `SESSION_SCHEMA` to output schema**

In `src/explorer/schemas.mjs`, after `EVIDENCE_QUALITY_SCHEMA`, add:

```js
const SESSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['created', 'reused', 'fallback'] },
    remainingCalls: { type: 'integer', minimum: 0 },
  },
  required: ['id', 'status', 'remainingCalls'],
};
```

Do not add top-level `session` to `EXPLORE_REPO_OUTPUT_SCHEMA.required`, because handled errors before session creation may omit it. Add this property near `sessionId`:

```js
    session: SESSION_SCHEMA,
```

- [ ] **Step 4: Run schema test and verify green**

Run:

```bash
node --test tests/schemas.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/explorer/schemas.mjs tests/schemas.test.mjs
git commit -m "feat: add session output schema"
```

---

### Task 2: Expose Session In MCP Structured Content

**Files:**
- Modify: `tests/mcp-server.test.mjs`
- Modify: `src/mcp/server.mjs`

- [ ] **Step 1: Write failing success-path assertions**

In `tests/mcp-server.test.mjs`, inside `MCP request handler exposes explore_repo and returns structuredContent`, after the `sessionId` assertion, add:

```js
  assert.deepEqual(called.structuredContent.session, {
    id: called.structuredContent.sessionId,
    status: 'created',
    remainingCalls: 4,
  });
```

- [ ] **Step 2: Run MCP test and verify red**

Run:

```bash
node --test tests/mcp-server.test.mjs
```

Expected: FAIL because `structuredContent.session` is missing.

- [ ] **Step 3: Add a server-side session builder**

In `src/mcp/server.mjs`, add this helper near `defaultEvidenceQuality()`:

```js
  function buildAgentSession(result) {
    const stats = result.stats ?? result._debug?.stats ?? {};
    const id = result.sessionId ?? stats.sessionId ?? null;
    const status = result.session?.status ?? stats.sessionStatus ?? null;
    const remainingCalls = result.session?.remainingCalls ?? stats.remainingCalls;
    if (!id || !['created', 'reused', 'fallback'].includes(status) || !Number.isInteger(remainingCalls) || remainingCalls < 0) {
      return null;
    }
    return { id, status, remainingCalls };
  }
```

- [ ] **Step 4: Include `session` in `toAgentFacingResult()`**

In `toAgentFacingResult()`, compute:

```js
    const session = buildAgentSession(result);
```

and include:

```js
      ...(session ? { session } : {}),
```

next to the existing `sessionId` spread.

- [ ] **Step 5: Run MCP test and verify green**

Run:

```bash
node --test tests/mcp-server.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/mcp/server.mjs tests/mcp-server.test.mjs
git commit -m "feat: expose session contract in mcp output"
```

---

### Task 3: Cover Session Fallback At MCP Boundary

**Files:**
- Modify: `tests/mcp-server.test.mjs`

- [ ] **Step 1: Add MCP fallback regression test**

In `tests/mcp-server.test.mjs`, add a new test after the main `explore_repo` structuredContent test:

```js
test('MCP request handler exposes fallback session when supplied session is exhausted', async () => {
  const repoRoot = await makeRepoFixture();
  const { SessionStore } = await import('../src/explorer/session.mjs');
  const sessionStore = new SessionStore({ maxCalls: 1 });
  const { handleRequest } = createMcpRequestHandler({
    sessionStore,
    runtimeOptions: {
      chatClient: new MockChatClient(),
    },
  });

  const first = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: '첫 번째 호출',
        repo_root: repoRoot,
        scope: ['src/**'],
        budget: 'quick',
      },
    },
  });

  const exhaustedId = first.structuredContent.session.id;

  const second = await handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'explore_repo',
      arguments: {
        task: '두 번째 호출',
        repo_root: repoRoot,
        scope: ['src/**'],
        budget: 'quick',
        session: exhaustedId,
      },
    },
  });

  assert.equal(second.structuredContent.session.status, 'fallback');
  assert.notEqual(second.structuredContent.session.id, exhaustedId);
  assert.equal(second.structuredContent.session.id, second.structuredContent.sessionId);
  assert.equal(second.structuredContent.session.remainingCalls, 0);
});
```

- [ ] **Step 2: Run MCP test and verify green**

Run:

```bash
node --test tests/mcp-server.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add tests/mcp-server.test.mjs
git commit -m "test: cover mcp session fallback contract"
```

---

### Task 4: Document Session Contract

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Update README compact contract text and example**

In `README.md`, add `session` to the compact contract bullet and return example:

```json
  "failure": null,
  "sessionId": "sess_abc123",
  "session": {
    "id": "sess_abc123",
    "status": "created",
    "remainingCalls": 4
  }
```

Add one paragraph:

```md
`session` is the preferred control-plane field for follow-up calls. `session.id`
matches `sessionId`; pass either value as the next call's `session` input. If
`session.status` is `fallback`, the supplied session was expired or exhausted
and the returned `session.id` is the new session to use.
```

- [ ] **Step 2: Update DESIGN return schema**

In `DESIGN.md`, add the same `session` object to the structured return example
and clarify that `_debug.stats.sessionStatus` remains diagnostic compatibility,
not the primary agent-facing control field.

- [ ] **Step 3: Run documentation checks**

Run:

```bash
rg -n "session\"|session.status|fallback|remainingCalls" README.md DESIGN.md
git diff --check
```

Expected: `rg` shows the new README/DESIGN text and `git diff --check` exits 0.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md DESIGN.md
git commit -m "docs: document top-level session contract"
```

---

### Task 5: Final Verification And Review

**Files:**
- Verify only unless review finds a defect.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --test tests/schemas.test.mjs tests/mcp-server.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: exit 0.

- [ ] **Step 4: Request review**

Ask Claude or a reviewer to inspect the implementation for contract drift:

```bash
git log --oneline -6
git diff HEAD~4..HEAD
```

Expected: no Critical or Important issue. Fix any valid issue before final.

---

## Self-Review

- Spec coverage: Tasks 1-4 cover schema, MCP output, fallback behavior, and docs from the design spec.
- Red-flag scan: The plan has no open-marker or fill-in steps.
- Type consistency: The session object consistently uses `id`, `status`, and `remainingCalls`; valid statuses are `created`, `reused`, and `fallback`.
