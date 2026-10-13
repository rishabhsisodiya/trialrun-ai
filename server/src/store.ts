import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Interview, Report } from '../../shared/types.ts';

const ID_PATTERN = /^[a-z0-9-]{8,40}$/;

/** True for ids this store issued. Anything else must never reach a file path. */
export function isInterviewId(id: string): boolean {
  return ID_PATTERN.test(id);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Writes through a temporary file so a crash never leaves half a document behind. */
async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}

/**
 * Everything the app remembers, as files:
 *
 *   interviews/<id>/interview.json   state the candidate may see
 *   interviews/<id>/round-<n>.json   round content, including hidden answers
 *   interviews/<id>/report.json      scores
 *   interviews/<id>/events.jsonl     append-only log of what happened
 *   workspaces/<id>/                 repo copy for an AI-agent task
 */
export class Store {
  private readonly interviewsDir: string;
  private readonly workspacesDir: string;

  constructor(dataDir: string) {
    this.interviewsDir = path.join(dataDir, 'interviews');
    this.workspacesDir = path.join(dataDir, 'workspaces');
  }

  async init(): Promise<void> {
    await mkdir(this.interviewsDir, { recursive: true });
    await mkdir(this.workspacesDir, { recursive: true });
  }

  newId(): string {
    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `${day}-${randomBytes(4).toString('hex')}`;
  }

  workspaceDir(id: string): string {
    return path.join(this.workspacesDir, id);
  }

  private dir(id: string): string {
    return path.join(this.interviewsDir, id);
  }

  async createInterview(interview: Interview): Promise<void> {
    await mkdir(this.dir(interview.id), { recursive: true });
    await this.saveInterview(interview);
  }

  saveInterview(interview: Interview): Promise<void> {
    return writeJson(path.join(this.dir(interview.id), 'interview.json'), interview);
  }

  loadInterview(id: string): Promise<Interview | null> {
    return readJson<Interview>(path.join(this.dir(id), 'interview.json'));
  }

  /** Newest first. */
  async listInterviews(): Promise<Interview[]> {
    const ids = (await readdir(this.interviewsDir)).filter(isInterviewId);
    const interviews = await Promise.all(ids.map((id) => this.loadInterview(id)));
    return interviews
      .filter((interview): interview is Interview => interview !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  saveRound(id: string, index: number, data: unknown): Promise<void> {
    return writeJson(path.join(this.dir(id), `round-${index}.json`), data);
  }

  loadRound<T>(id: string, index: number): Promise<T | null> {
    return readJson<T>(path.join(this.dir(id), `round-${index}.json`));
  }

  saveReport(report: Report): Promise<void> {
    return writeJson(path.join(this.dir(report.interviewId), 'report.json'), report);
  }

  loadReport(id: string): Promise<Report | null> {
    return readJson<Report>(path.join(this.dir(id), 'report.json'));
  }

  async appendEvent(id: string, event: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    await appendFile(path.join(this.dir(id), 'events.jsonl'), `${line}\n`);
  }

  async deleteInterview(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
    await rm(this.workspaceDir(id), { recursive: true, force: true });
  }
}
