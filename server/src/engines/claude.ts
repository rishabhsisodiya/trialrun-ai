import { z } from 'zod';
import type { EngineStatus } from '../../../shared/types.ts';
import {
  answerSchemaJson,
  DEFAULT_AGENT_TIMEOUT_MS,
  DEFAULT_ASK_TIMEOUT_MS,
  EngineError,
  STATUS_TIMEOUT_MS,
  type AgentRequest,
  type AskRequest,
  type Engine,
  type ModelTier,
} from './engine.ts';
import { CommandNotFoundError, CommandTimeoutError, run } from '../process.ts';

const COMMAND = 'claude';

const MODELS: Record<ModelTier, string> = { fast: 'haiku', strong: 'sonnet' };

const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  subscriptionType: z.string().nullish(),
});

const AGENT_BRIEF =
  "You are the AI coding assistant in a candidate's interview workspace. The task is described in TASK.md. Do what the candidate asks, no more: they are being assessed on how they direct you. Keep replies short and say what you changed. Reply in plain text without markdown formatting.";

const resultSchema = z.object({
  is_error: z.boolean(),
  result: z.string().nullish(),
  structured_output: z.unknown().optional(),
});

/** Reads the single JSON object `claude --print --output-format json` writes. */
export function parseClaudeResult<T>(stdout: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new EngineError('bad_output', 'Claude Code did not return JSON');
  }
  const envelope = resultSchema.safeParse(raw);
  if (!envelope.success) throw new EngineError('bad_output', 'Claude Code returned an unexpected reply');
  if (envelope.data.is_error) {
    throw new EngineError('failed', envelope.data.result?.trim() || 'Claude Code reported an error');
  }
  const answer = schema.safeParse(envelope.data.structured_output);
  if (!answer.success) throw new EngineError('bad_output', 'Claude Code answered in the wrong shape');
  return answer.data;
}

export class ClaudeEngine implements Engine {
  readonly id = 'claude' as const;
  readonly name = 'Claude Code';

  /** @param cwd an empty folder, so no project's instructions are picked up. */
  constructor(private readonly cwd: string) {}

  async status(): Promise<EngineStatus> {
    const base = { id: this.id, name: this.name, version: null, plan: null, detail: null, fix: null, verified: true };
    try {
      const version = await run(COMMAND, ['--version'], { timeoutMs: STATUS_TIMEOUT_MS });
      const versionText = version.stdout.trim().split(/\s+/)[0] || null;
      const auth = await run(COMMAND, ['auth', 'status'], { timeoutMs: STATUS_TIMEOUT_MS });
      const parsed = authStatusSchema.safeParse(safeJson(auth.stdout));
      if (!parsed.success) {
        return { ...base, version: versionText, state: 'error', detail: 'Could not read the sign-in status.', fix: 'Update Claude Code, then check again.' };
      }
      if (!parsed.data.loggedIn) {
        return { ...base, version: versionText, state: 'not_logged_in', fix: 'Run `claude` in a terminal and sign in.' };
      }
      return { ...base, version: versionText, state: 'ready', plan: parsed.data.subscriptionType ?? null };
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return { ...base, state: 'not_installed', fix: 'Install Claude Code, then sign in with `claude`.' };
      }
      return { ...base, state: 'error', detail: messageOf(error), fix: 'Check that `claude` runs in a terminal.' };
    }
  }

  async ask<T>(request: AskRequest<T>): Promise<T> {
    const args = [
      '--print',
      '--output-format', 'json',
      '--model', MODELS[request.tier],
      // No tools: the model can only answer. Safe mode keeps the user's own
      // instructions, skills and hooks out of the interview.
      '--tools', '',
      '--safe-mode',
      '--no-session-persistence',
      '--system-prompt', request.system,
      '--json-schema', answerSchemaJson(request.schema),
    ];
    try {
      const result = await run(COMMAND, args, {
        cwd: this.cwd,
        input: request.prompt,
        timeoutMs: request.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS,
      });
      if (!result.stdout.trim()) {
        throw new EngineError('failed', result.stderr.trim() || `Claude Code exited with code ${result.code}`);
      }
      return parseClaudeResult(result.stdout, request.schema);
    } catch (error) {
      if (error instanceof CommandNotFoundError) throw new EngineError('not_installed', error.message);
      if (error instanceof CommandTimeoutError) throw new EngineError('timeout', error.message);
      throw error;
    }
  }

  async agent(request: AgentRequest): Promise<string> {
    const args = [
      '--print',
      '--output-format', 'json',
      '--model', MODELS.strong,
      // The candidate's own instructions, skills and hooks stay out of the interview.
      '--safe-mode',
      // Confinement: edits are accepted inside the working folder only, and anything that
      // would need a person's approval (other folders, the network, other commands) is refused.
      '--permission-mode', 'acceptEdits',
      '--permission-prompts', 'none',
      '--tools', 'Read,Edit,Write,Glob,Grep,Bash',
      '--allowedTools', ...request.allowedCommands.map((command) => `Bash(${command}:*)`),
      request.resume ? '--resume' : '--session-id', request.sessionId,
      '--append-system-prompt', AGENT_BRIEF,
    ];
    try {
      const result = await run(COMMAND, args, {
        cwd: request.cwd,
        input: request.prompt,
        timeoutMs: request.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
      });
      if (!result.stdout.trim()) {
        throw new EngineError('failed', result.stderr.trim() || `Claude Code exited with code ${result.code}`);
      }
      return parseClaudeReply(result.stdout);
    } catch (error) {
      if (error instanceof CommandNotFoundError) throw new EngineError('not_installed', error.message);
      if (error instanceof CommandTimeoutError) throw new EngineError('timeout', error.message);
      throw error;
    }
  }
}

/** Reads the text reply out of `claude --print --output-format json`. */
export function parseClaudeReply(stdout: string): string {
  const envelope = resultSchema.safeParse(safeJson(stdout));
  if (!envelope.success) throw new EngineError('bad_output', 'Claude Code returned an unexpected reply');
  if (envelope.data.is_error) throw new EngineError('failed', envelope.data.result?.trim() || 'Claude Code reported an error');
  return envelope.data.result?.trim() || '(The assistant finished without saying anything.)';
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
