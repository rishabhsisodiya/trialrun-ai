import { cp, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CodeLanguage } from '../../shared/types.ts';

const manifestSchema = z.object({
  id: z.string(),
  title: z.string(),
  language: z.enum(['javascript', 'python']),
  roles: z.array(z.string()),
  /** What a strong solution and a strong process look like. Never shown before the report. */
  rubric: z.array(z.string()),
  test: z.object({ command: z.string(), args: z.array(z.string()) }),
});

export type TaskManifest = z.infer<typeof manifestSchema>;

export interface Task extends TaskManifest {
  /** The repo the candidate starts from. Also the baseline their changes are compared with. */
  repoDir: string;
  brief: string;
}

const DEFAULT_TASKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tasks');

/**
 * Hand-written task repos for the AI-agent round, in `tasks/<id>/`:
 * `task.json` is the manifest and `repo/` is the starting code, with the brief in `repo/TASK.md`.
 */
export class TaskLibrary {
  constructor(private readonly tasksDir: string = DEFAULT_TASKS_DIR) {}

  async all(): Promise<Task[]> {
    const entries = await readdir(this.tasksDir, { withFileTypes: true }).catch(() => []);
    const tasks = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.load(entry.name).catch(() => null)),
    );
    return tasks.filter((task): task is Task => task !== null);
  }

  private async load(id: string): Promise<Task> {
    const folder = path.join(this.tasksDir, id);
    const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(folder, 'task.json'), 'utf8')));
    const repoDir = path.join(folder, 'repo');
    return { ...manifest, repoDir, brief: await readFile(path.join(repoDir, 'TASK.md'), 'utf8') };
  }

  async get(id: string): Promise<Task | null> {
    return (await this.all()).find((task) => task.id === id) ?? null;
  }

  /** A task in the stack's language, preferring ones the candidate has not done. */
  async pick(language: CodeLanguage, usedIds: string[]): Promise<Task | null> {
    const family = language === 'python' ? 'python' : 'javascript';
    const matching = (await this.all()).filter((task) => task.language === family);
    if (matching.length === 0) return null;
    const timesUsed = (task: Task) => usedIds.filter((id) => id === task.id).length;
    const fewest = Math.min(...matching.map(timesUsed));
    const fresh = matching.filter((task) => timesUsed(task) === fewest);
    return fresh[Math.floor(Math.random() * fresh.length)]!;
  }

  async copyTo(task: Task, workspace: string): Promise<void> {
    await cp(task.repoDir, workspace, { recursive: true, errorOnExist: false });
  }
}
