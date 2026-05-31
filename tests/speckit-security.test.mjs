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

async function makeRepoWithSpeckit() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speckit-security-'));
  await fs.cp(path.join(ROOT, '.specify'), path.join(tempDir, '.specify'), { recursive: true });

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
    await fs.rm(tempDir, { recursive: true, force: true });
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
