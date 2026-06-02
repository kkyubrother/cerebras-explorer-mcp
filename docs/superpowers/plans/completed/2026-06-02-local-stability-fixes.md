# Local Stability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a small, coupled stability cleanup; do not use subagents unless execution uncovers a separate independent failure.

**Goal:** Restore local `npm test` reliability on Windows and align the active Spec Kit plan pointer after the v0.8.0/spec 024 landing.

**Architecture:** Keep the product runtime untouched. Fix the Windows-only local failure in the test harness by making temporary repository cleanup tolerate short-lived file locks, and fix the documentation drift by pointing `AGENTS.md` at the same active plan as `CLAUDE.md`.

**Tech Stack:** Node.js 22 ESM, `node:test`, Node standard library only, PowerShell/Git/Bash for verification.

---

## Current Evidence

- `npm test` currently fails in `tests/speckit-security.test.mjs` with `EBUSY: resource busy or locked, rmdir '<temp>/speckit-security-*'`.
- Re-running only `node --test tests\speckit-security.test.mjs` reproduces the same `EBUSY` failure.
- The test assertion itself reaches the `finally` cleanup block; the failure is at `await fs.rm(tempDir, { recursive: true, force: true });`.
- After a short delay, the leftover `speckit-security-*` temp directories can be removed manually, which points to a transient Windows file-handle release issue rather than a product/runtime regression.
- During execution, fixing cleanup exposed a second Windows fixture issue: copied `.specify/**/*.sh` files can have CRLF in the working tree even when git stores them as LF, so the temp fixture must normalize shell scripts before invoking `bash`.
- `CLAUDE.md` points to `specs/024-context-window-safety/plan.md`; `AGENTS.md` still points to `specs/023-prompt-contract-hygiene/plan.md`.

## File Structure

- Modify `tests/speckit-security.test.mjs`: normalize copied shell scripts to LF, add a small retry helper for temp-directory removal, and use it in the existing `finally` block.
- Modify `AGENTS.md`: update only the SPECKIT managed link from spec 023 to spec 024.
- Do not modify runtime code, MCP schemas, package metadata, release notes, or public docs.

## Success Criteria

- `node --test tests\speckit-security.test.mjs` passes locally.
- `npm test` passes locally with 0 failures.
- `AGENTS.md` and `CLAUDE.md` both point to `specs/024-context-window-safety/plan.md`.
- `git status --short --branch` shows only the intended plan/test/doc changes before commit.
- No dependency fields are added to `package.json`.

### Task 1: Stabilize Speckit Security Temp Cleanup

**Files:**
- Modify: `tests/speckit-security.test.mjs`

- [x] **Step 1: Reproduce the current failing test**

Run:

```powershell
node --test tests\speckit-security.test.mjs
```

Expected before the fix:

```text
fail 1
EBUSY: resource busy or locked, rmdir
```

- [x] **Step 2: Add a retrying cleanup helper**

In `tests/speckit-security.test.mjs`, add this shell-script normalization helper after `read(relPath)`:

```js
async function normalizeShellScripts(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await normalizeShellScripts(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.sh')) {
      const content = await fs.readFile(entryPath, 'utf8');
      const normalized = content.replace(/\r\n?/g, '\n');
      if (normalized !== content) {
        await fs.writeFile(entryPath, normalized);
      }
    }
  }
}
```

Then call it in `makeRepoWithSpeckit()` immediately after copying `.specify`:

```js
  await fs.cp(path.join(ROOT, '.specify'), path.join(tempDir, '.specify'), { recursive: true });
  await normalizeShellScripts(path.join(tempDir, '.specify'));
```

Add these cleanup retry helper functions after `makeRepoWithSpeckit()`:

```js
function isRetryableRmError(error) {
  return error?.code === 'EBUSY' || error?.code === 'ENOTEMPTY' || error?.code === 'EPERM';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rmTempDirWithRetries(tempDir) {
  const retryDelaysMs = [25, 75, 150, 300, 600];
  let lastError;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) {
      await delay(retryDelaysMs[attempt - 1]);
    }

    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetryableRmError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}
```

Reasoning:

- Retry only known Windows/transient removal errors: `EBUSY`, `ENOTEMPTY`, `EPERM`.
- Preserve fail-fast behavior for unexpected filesystem errors.
- Keep the helper local to this test file because no production code needs it.
- Use only Node standard library APIs to preserve the zero-dependency invariant.

- [x] **Step 3: Use the helper in the existing cleanup block**

Replace:

```js
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
```

With:

```js
  } finally {
    await rmTempDirWithRetries(tempDir);
  }
```

- [x] **Step 4: Verify the targeted test passes**

Run:

```powershell
node --test tests\speckit-security.test.mjs
```

Expected after the fix:

```text
pass 2
fail 0
```

If the test still fails with `EBUSY`, increase the last delay from `600` to `1000` and rerun the same targeted test. Do not change product code.

### Task 2: Align Active Spec Kit Plan Pointer

**Files:**
- Modify: `AGENTS.md`

- [x] **Step 1: Confirm the pointer drift**

Run:

```powershell
rg -n "specs/023-prompt-contract-hygiene|specs/024-context-window-safety" AGENTS.md CLAUDE.md specs\024-context-window-safety\plan.md
```

Expected before the fix:

```text
AGENTS.md:77:[`specs/023-prompt-contract-hygiene/plan.md`](./specs/023-prompt-contract-hygiene/plan.md)
CLAUDE.md:4:[`specs/024-context-window-safety/plan.md`](./specs/024-context-window-safety/plan.md)
```

- [x] **Step 2: Update the AGENTS.md SPECKIT link only**

In `AGENTS.md`, replace:

```markdown
[`specs/023-prompt-contract-hygiene/plan.md`](./specs/023-prompt-contract-hygiene/plan.md)
```

With:

```markdown
[`specs/024-context-window-safety/plan.md`](./specs/024-context-window-safety/plan.md)
```

Do not edit the project invariants, sync matrix, anti-pattern list, or quick reference text.

- [x] **Step 3: Verify both agent docs point to spec 024**

Run:

```powershell
node -e "const fs=require('fs'); const agents=fs.readFileSync('AGENTS.md','utf8'); const claude=fs.readFileSync('CLAUDE.md','utf8'); if (!agents.includes('specs/024-context-window-safety/plan.md')) process.exit(1); if (!claude.includes('specs/024-context-window-safety/plan.md')) process.exit(1); if (agents.includes('specs/023-prompt-contract-hygiene/plan.md')) process.exit(1); console.log('spec pointers aligned')"
```

Expected:

```text
spec pointers aligned
```

### Task 3: Full Verification and Commit

**Files:**
- Verify: `tests/speckit-security.test.mjs`
- Verify: `AGENTS.md`
- Verify: `package.json`

- [x] **Step 1: Run the full test suite**

Run:

```powershell
npm test
```

Expected:

```text
fail 0
```

- [x] **Step 2: Verify package contents still build without adding dependencies**

Run:

```powershell
$env:NPM_CONFIG_CACHE = Join-Path (Get-Location) '.npm-cache'
npm pack --dry-run --json
```

Expected:

```text
"version": "0.8.0"
"entryCount"
```

- [x] **Step 3: Remove the temporary npm cache created by the package check**

Run:

```powershell
$workspace = (Resolve-Path '.').Path
$cache = Join-Path $workspace '.npm-cache'
if (Test-Path -LiteralPath $cache) {
  $resolved = (Resolve-Path -LiteralPath $cache).Path
  if ($resolved.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -eq '.npm-cache') {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  } else {
    throw "Refusing to remove unexpected path: $resolved"
  }
}
```

Expected:

```text
no output
```

- [x] **Step 4: Confirm the final diff is scoped**

Run:

```powershell
git status --short --branch
git diff -- tests\speckit-security.test.mjs AGENTS.md docs\superpowers\plans\2026-06-02-local-stability-fixes.md
```

Expected changed files:

```text
AGENTS.md
docs/superpowers/plans/2026-06-02-local-stability-fixes.md
tests/speckit-security.test.mjs
```

- [x] **Step 5: Commit after verification**

Run:

```powershell
git add AGENTS.md tests\speckit-security.test.mjs docs\superpowers\plans\2026-06-02-local-stability-fixes.md
git commit -m "test: stabilize local speckit cleanup"
```

Expected:

```text
[master <sha>] test: stabilize local speckit cleanup
```

## Self-Review

- Spec coverage: The plan covers both observed instability items: local Windows `EBUSY` test failure and stale `AGENTS.md` Spec Kit pointer.
- Placeholder scan: No deferred implementation placeholders are present; each edit step includes exact paths and code.
- Type consistency: The helper names used in the replacement block match the helper definitions: `rmTempDirWithRetries`, `isRetryableRmError`, and `delay`.
- Scope control: Runtime files, public MCP schemas, package version, CHANGELOG, README, and integrations stay untouched.
