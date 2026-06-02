import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relPath) {
  return fs.readFile(path.join(ROOT, relPath), 'utf8');
}

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

async function makeRepoWithSpeckit() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speckit-security-'));
  await fs.cp(path.join(ROOT, '.specify'), path.join(tempDir, '.specify'), { recursive: true });
  await normalizeShellScripts(path.join(tempDir, '.specify'));

  await execFileAsync('git', ['init', '-q'], { cwd: tempDir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: tempDir });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir });
  await fs.writeFile(path.join(tempDir, 'README.md'), 'fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: tempDir });
  await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: tempDir });

  const marker = path.join(tempDir, 'executed-marker');
  const evilSsh = path.join(tempDir, 'evil_ssh.sh');
  await fs.writeFile(evilSsh, `#!/usr/bin/env bash\necho ssh >> ${JSON.stringify(marker)}\nexit 1\n`);
  await fs.chmod(evilSsh, 0o755);
  await execFileAsync('git', ['config', 'core.sshCommand', evilSsh], { cwd: tempDir });
  await execFileAsync('git', ['remote', 'add', 'origin', 'ssh://example.invalid/repo.git'], { cwd: tempDir });

  const hook = path.join(tempDir, '.git', 'hooks', 'post-checkout');
  await fs.writeFile(hook, `#!/usr/bin/env bash\necho hook >> ${JSON.stringify(marker)}\n`);
  await fs.chmod(hook, 0o755);

  return { tempDir, marker };
}

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

async function assertScriptDoesNotRunRemoteConfigOrCheckoutHook(scriptRelPath, shortName) {
  const { tempDir, marker } = await makeRepoWithSpeckit();

  try {
    const { stdout } = await execFileAsync(
      'bash',
      [scriptRelPath, '--json', '--short-name', shortName, `Add ${shortName} feature`],
      { cwd: tempDir },
    );
    const result = JSON.parse(stdout);

    assert.match(result.BRANCH_NAME, new RegExp(`^001-${shortName}$`));
    await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  } finally {
    await rmTempDirWithRetries(tempDir);
  }
}

test('Speckit feature scripts do not contact remotes or enable checkout hooks', async () => {
  await assertScriptDoesNotRunRemoteConfigOrCheckoutHook(
    '.specify/extensions/git/scripts/bash/create-new-feature.sh',
    'extension-safe',
  );
  await assertScriptDoesNotRunRemoteConfigOrCheckoutHook(
    '.specify/scripts/bash/create-new-feature.sh',
    'core-safe',
  );
});

test('Speckit feature scripts avoid remote fetch/ls-remote and disable checkout hooks', async () => {
  const scripts = [
    '.specify/extensions/git/scripts/bash/create-new-feature.sh',
    '.specify/scripts/bash/create-new-feature.sh',
    '.specify/extensions/git/scripts/powershell/create-new-feature.ps1',
  ];

  for (const relPath of scripts) {
    const source = await read(relPath);
    assert.doesNotMatch(source, /git\s+fetch|git\s+ls-remote/);
    assert.match(source, /core\.hooksPath=\/dev\/null/);
  }
});
