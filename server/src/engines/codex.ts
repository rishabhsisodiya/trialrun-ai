import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { z } from 'zod';
import type { EngineStatus } from '../../../shared/types.ts';
import {
  answerSchemaJson,
  DEFAULT_ASK_TIMEOUT_MS,
  EngineError,
  STATUS_TIMEOUT_MS,
  type AskRequest,
  type Engine,
} from './engine.ts';
import { CommandNotFoundError, CommandTimeoutError, run } from '../process.ts';

const COMMAND = 'codex';

/**
 * Codex CLI on the user's ChatGPT plan.
 *
 * NOT VERIFIED: written against the Codex CLI documentation and never run, because
 * Codex was not installed where this was built. `verified: false` tells the UI to say so.
 * The model is left to the CLI's default so the plan decides what is available.
 */
export class CodexEngine implements Engine {
  readonly id = 'codex' as const;
  readonly name = 'Codex';

  constructor(private readonly cwd: string) {}

  async status(): Promise<EngineStatus> {
    const base = { id: this.id, name: this.name, version: null, plan: null, detail: null, fix: null, verified: false };
    try {
      const version = await run(COMMAND, ['--version'], { timeoutMs: STATUS_TIMEOUT_MS });
      const versionText = version.stdout.trim().split(/\s+/).pop() || null;
      const login = await run(COMMAND, ['login', 'status'], { timeoutMs: STATUS_TIMEOUT_MS });
      if (login.code !== 0) {
        return { ...base, version: versionText, state: 'not_logged_in', fix: 'Run `codex login` in a terminal.' };
      }
      return { ...base, version: versionText, state: 'ready' };
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return { ...base, state: 'not_installed', fix: 'Install the Codex CLI, then run `codex login`.' };
      }
      const detail = error instanceof Error ? error.message : String(error);
      return { ...base, state: 'error', detail, fix: 'Check that `codex` runs in a terminal.' };
    }
  }

  async ask<T>(request: AskRequest<T>): Promise<T> {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'trialrun-codex-'));
    const schemaFile = path.join(scratch, 'schema.json');
    const answerFile = path.join(scratch, 'answer.json');
    try {
      await writeFile(schemaFile, answerSchemaJson(request.schema));
      const result = await run(
        COMMAND,
        [
          'exec',
          '--skip-git-repo-check',
          // Codex has no switch that removes its tools, so it is confined instead.
          '--sandbox', 'read-only',
          '--output-schema', schemaFile,
          '--output-last-message', answerFile,
          '-',
        ],
        {
          cwd: this.cwd,
          // Codex takes no separate system prompt, so the role leads the message.
          input: `${request.system}\n\n${request.prompt}`,
          timeoutMs: request.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS,
        },
      );
      if (result.code !== 0) {
        throw new EngineError('failed', result.stderr.trim() || `Codex exited with code ${result.code}`);
      }
      return parseAnswer(await readFile(answerFile, 'utf8').catch(() => ''), request.schema);
    } catch (error) {
      if (error instanceof CommandNotFoundError) throw new EngineError('not_installed', error.message);
      if (error instanceof CommandTimeoutError) throw new EngineError('timeout', error.message);
      throw error;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

function parseAnswer<T>(text: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EngineError('bad_output', 'Codex did not return JSON');
  }
  const answer = schema.safeParse(raw);
  if (!answer.success) throw new EngineError('bad_output', 'Codex answered in the wrong shape');
  return answer.data;
}
