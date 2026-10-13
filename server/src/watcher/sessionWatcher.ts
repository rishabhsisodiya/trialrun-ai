import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../process.ts';

export interface ActivityEvent {
  at: string;
  kind: 'prompt' | 'tool';
  /** The candidate's prompt, or what the agent did ("Edit src/feed.js"). */
  text: string;
}

export interface Activity {
  /** False when no coding agent session was found for the workspace. */
  sessionFound: boolean;
  events: ActivityEvent[];
}

const MAX_PROMPT = 700;
const MAX_TARGET = 160;

function cut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/** Slash commands, tool output and injected reminders are not things the candidate asked for. */
function isCandidatePrompt(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.startsWith('<') && !trimmed.startsWith('[Image');
}

function parseLines(text: string): Record<string, any>[] {
  const records: Record<string, any>[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A session being written can end in a partial line.
    }
  }
  return records;
}

async function filesChangedSince(folder: string, since: Date, match: (name: string) => boolean): Promise<string[]> {
  const names = await readdir(folder).catch(() => [] as string[]);
  const kept: string[] = [];
  for (const name of names.filter(match)) {
    const file = path.join(folder, name);
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && info.mtime >= since) kept.push(file);
  }
  return kept;
}

/** Claude Code keeps one JSONL file per session under a folder named after the working directory. */
export function claudeProjectDir(workspace: string): string {
  const root = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
  return path.join(root, 'projects', workspace.replace(/[^a-zA-Z0-9]/g, '-'));
}

export function parseClaudeSession(text: string): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const record of parseLines(text)) {
    if (record.isSidechain || record.isMeta || typeof record.timestamp !== 'string') continue;
    const content = record.message?.content;
    if (record.type === 'user') {
      const texts = typeof content === 'string' ? [content] : (content ?? []).filter((block: any) => block.type === 'text').map((block: any) => block.text);
      for (const prompt of texts.filter(isCandidatePrompt)) {
        events.push({ at: record.timestamp, kind: 'prompt', text: cut(prompt, MAX_PROMPT) });
      }
    } else if (record.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const input = block.input ?? {};
        const target = input.file_path ?? input.command ?? input.pattern ?? input.description ?? '';
        events.push({ at: record.timestamp, kind: 'tool', text: cut(`${block.name} ${target}`, MAX_TARGET) });
      }
    }
  }
  return events;
}

/**
 * Codex sessions. NOT VERIFIED: written from the documented rollout format and never
 * run against a real Codex session. A mismatch means no events, never an error.
 */
export function parseCodexSession(text: string, workspace: string): ActivityEvent[] {
  const records = parseLines(text);
  const meta = records.find((record) => record.type === 'session_meta');
  if (meta?.payload?.cwd !== workspace) return [];
  const events: ActivityEvent[] = [];
  for (const record of records) {
    const payload = record.payload;
    if (record.type !== 'response_item' || !payload || typeof record.timestamp !== 'string') continue;
    if (payload.type === 'message' && payload.role === 'user') {
      for (const block of payload.content ?? []) {
        if (typeof block.text === 'string' && isCandidatePrompt(block.text)) {
          events.push({ at: record.timestamp, kind: 'prompt', text: cut(block.text, MAX_PROMPT) });
        }
      }
    } else if (payload.type === 'function_call' || payload.type === 'local_shell_call') {
      events.push({ at: record.timestamp, kind: 'tool', text: cut(`${payload.name ?? 'shell'} ${payload.arguments ?? ''}`, MAX_TARGET) });
    }
  }
  return events;
}

async function codexSessionFiles(since: Date): Promise<string[]> {
  const root = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions');
  const day = (date: Date) => path.join(root, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'));
  // A round can cross midnight, so look at the day it started and today.
  const folders = [...new Set([day(since), day(new Date())])];
  const files = await Promise.all(folders.map((folder) => filesChangedSince(folder, since, (name) => name.endsWith('.jsonl'))));
  return files.flat();
}

/** What the candidate asked their coding agent, and what the agent did, since `since`. Read-only. */
export async function readActivity(workspace: string, since: Date): Promise<Activity> {
  const resolved = await realpath(workspace).catch(() => workspace);
  const claudeFiles = await filesChangedSince(claudeProjectDir(resolved), since, (name) => name.endsWith('.jsonl'));
  const events: ActivityEvent[] = [];
  for (const file of claudeFiles) events.push(...parseClaudeSession(await readFile(file, 'utf8')));
  for (const file of await codexSessionFiles(since)) events.push(...parseCodexSession(await readFile(file, 'utf8'), resolved));
  const recent = events.filter((event) => event.at >= since.toISOString()).sort((a, b) => a.at.localeCompare(b.at));
  return { sessionFound: recent.length > 0, events: recent };
}

export interface WorkspaceDiff {
  filesChanged: number;
  /** Unified diff against the task's starting code. */
  text: string;
}

const IGNORED = ['node_modules', '.git', '__pycache__', '.DS_Store', '.pytest_cache', '.claude', '.codex'];

/** Compares the workspace with the task repo it was copied from. Needs no git. */
export async function diffWorkspace(baseline: string, workspace: string): Promise<WorkspaceDiff> {
  const args = ['-ruN', ...IGNORED.flatMap((name) => ['-x', name]), baseline, workspace];
  const result = await run('diff', args, { timeoutMs: 20_000 });
  // diff exits with 1 when the folders differ; only 2 and above mean it failed.
  if (result.code !== null && result.code > 1) throw new Error(result.stderr.trim() || 'diff failed');
  const text = result.stdout.replaceAll(`${baseline}/`, 'a/').replaceAll(`${workspace}/`, 'b/');
  const filesChanged = text.split('\n').filter((line) => line.startsWith('diff -ruN')).length;
  return { filesChanged, text };
}

/** The session as lines a model can read: `[12:40] CANDIDATE: …` and `[12:55] AGENT: Edit …`. */
export function formatActivity(events: ActivityEvent[], roundStart: Date, limit = 80): string {
  const lines = events.slice(-limit).map((event) => {
    const seconds = Math.max(0, Math.round((Date.parse(event.at) - roundStart.getTime()) / 1000));
    const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    return `[${clock}] ${event.kind === 'prompt' ? 'CANDIDATE' : 'AGENT'}: ${event.text}`;
  });
  const skipped = events.length - lines.length;
  return (skipped > 0 ? `(${skipped} earlier events omitted)\n` : '') + lines.join('\n');
}
