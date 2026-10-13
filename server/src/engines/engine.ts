import { z } from 'zod';
import type { EngineId, EngineStatus } from '../../../shared/types.ts';

/** `fast` for questions and follow-ups, `strong` for scoring. Each engine maps these to its own models. */
export type ModelTier = 'fast' | 'strong';

export interface AskRequest<T> {
  /** The role the model plays. Replaces the engine's own instructions. */
  system: string;
  prompt: string;
  /** Shape of the answer. The reply is validated against it before it is returned. */
  schema: z.ZodType<T>;
  tier: ModelTier;
  timeoutMs?: number;
}

/** One request to a coding agent that may read and change files in a folder. */
export interface AgentRequest {
  /** The only folder the agent may touch. */
  cwd: string;
  prompt: string;
  /** Keeps the conversation together across requests. A UUID. */
  sessionId: string;
  /** False for the first request of a session, true after. */
  resume: boolean;
  /** Shell commands the agent may run, by prefix, e.g. "npm test". Everything else is refused. */
  allowedCommands: string[];
  timeoutMs?: number;
}

export type EngineErrorCode = 'not_installed' | 'timeout' | 'failed' | 'bad_output';

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/**
 * A coding agent CLI the user has installed and signed into.
 *
 * Engines only ever return text: they are run with their tools switched off, so
 * nothing an interview asks them can read or change files on this machine.
 */
export interface Engine {
  readonly id: EngineId;
  readonly name: string;
  status(): Promise<EngineStatus>;
  /** One question, one validated structured answer. */
  ask<T>(request: AskRequest<T>): Promise<T>;
  /**
   * Runs the engine as a coding agent confined to one folder, and returns what it said.
   * This is the one place an engine is given tools. Engines that cannot be confined leave it out.
   */
  agent?(request: AgentRequest): Promise<string>;
}

export const DEFAULT_ASK_TIMEOUT_MS = 120_000;
export const STATUS_TIMEOUT_MS = 10_000;
export const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60_000;

/** JSON Schema for an answer, without the `$schema` marker Zod adds, which Claude Code rejects. */
export function answerSchemaJson(schema: z.ZodType): string {
  const { $schema: _marker, ...jsonSchema } = z.toJSONSchema(schema);
  return JSON.stringify(jsonSchema);
}
