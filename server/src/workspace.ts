import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceFile } from '../../shared/types.ts';
import { badRequest, notFound } from './errors.ts';

const IGNORED = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', '.pytest_cache', '.claude', '.codex']);
const MAX_FILES = 400;
export const MAX_FILE_BYTES = 200_000;

/**
 * Turns a path sent by the browser into a real path inside the workspace, or refuses.
 *
 * The browser is not trusted with file paths: "../" and absolute paths are rejected,
 * and the real location is checked too, so a symlink cannot lead out of the workspace.
 */
async function resolveInside(root: string, relative: string): Promise<string> {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative)) throw badRequest('That is not a file in the workspace.');
  const parts = relative.split(/[\\/]/);
  if (parts.some((part) => part === '..' || IGNORED.has(part))) throw badRequest('That is not a file in the workspace.');

  const realRoot = await realpath(root);
  const target = path.resolve(realRoot, relative);
  // A file being created does not exist yet, so check the deepest folder that does.
  let existing = target;
  while (existing !== realRoot) {
    const found = await realpath(existing).catch(() => null);
    if (found) {
      if (found !== realRoot && !found.startsWith(realRoot + path.sep)) throw badRequest('That is not a file in the workspace.');
      break;
    }
    existing = path.dirname(existing);
  }
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) throw badRequest('That is not a file in the workspace.');
  return target;
}

/** Every editable file in the workspace, as paths relative to it, sorted. */
export async function listWorkspaceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(folder: string, prefix: string): Promise<void> {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (IGNORED.has(entry.name) || found.length >= MAX_FILES) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), relative);
      else if (entry.isFile()) found.push(relative);
    }
  }
  await walk(root, '');
  return found;
}

export async function readWorkspaceFile(root: string, relative: string): Promise<WorkspaceFile> {
  const target = await resolveInside(root, relative);
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) throw notFound('That file');
  if (info.size > MAX_FILE_BYTES) throw badRequest('That file is too large to open here.');
  return { path: relative, content: await readFile(target, 'utf8') };
}

export async function writeWorkspaceFile(root: string, relative: string, content: string): Promise<void> {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw badRequest('That file is too large to save here.');
  const target = await resolveInside(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
