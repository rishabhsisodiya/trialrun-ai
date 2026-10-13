import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HttpError } from '../src/errors.ts';
import { listWorkspaceFiles, MAX_FILE_BYTES, readWorkspaceFile, writeWorkspaceFile } from '../src/workspace.ts';

async function workspace() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'trialrun-ws-'));
  const root = path.join(base, 'ws');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.js'), 'one\n');
  await writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'dep\n');
  await writeFile(path.join(base, 'secret.txt'), 'secret\n');
  return { base, root };
}

async function refused(work: Promise<unknown>): Promise<boolean> {
  try {
    await work;
    return false;
  } catch (error) {
    return error instanceof HttpError && error.statusCode < 500;
  }
}

test('lists, reads and writes files inside the workspace', async () => {
  const { root } = await workspace();
  assert.deepEqual(await listWorkspaceFiles(root), ['src/a.js']);
  assert.equal((await readWorkspaceFile(root, 'src/a.js')).content, 'one\n');
  await writeWorkspaceFile(root, 'src/new/b.js', 'two\n');
  assert.deepEqual(await listWorkspaceFiles(root), ['src/a.js', 'src/new/b.js']);
});

test('refuses every way out of the workspace', async () => {
  const { base, root } = await workspace();
  await symlink(base, path.join(root, 'up'));
  await symlink(path.join(base, 'secret.txt'), path.join(root, 'src', 'link.txt'));
  for (const file of ['../secret.txt', 'src/../../secret.txt', path.join(base, 'secret.txt'), 'up/secret.txt', 'src/link.txt', '', 'node_modules/dep/index.js']) {
    assert.equal(await refused(readWorkspaceFile(root, file)), true, `read ${file}`);
    assert.equal(await refused(writeWorkspaceFile(root, file, 'x')), true, `write ${file}`);
  }
});

test('refuses files too large for the editor', async () => {
  const { root } = await workspace();
  assert.equal(await refused(writeWorkspaceFile(root, 'big.txt', 'x'.repeat(MAX_FILE_BYTES + 1))), true);
});
