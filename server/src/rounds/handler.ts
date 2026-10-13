import { randomBytes } from 'node:crypto';
import type {
  Interview,
  Message,
  ReviewItem,
  RoundAction,
  RoundReport,
  RoundState,
  RoundView,
} from '../../../shared/types.ts';
import type { AgentRequest, AskRequest } from '../engines/engine.ts';
import { badRequest } from '../errors.ts';

export interface RoundContext {
  interview: Interview;
  round: RoundState;
  /** Asks the interview's engine. The interviewer persona is added for you. */
  ask<T>(request: Omit<AskRequest<T>, 'system'> & { system?: string }): Promise<T>;
  /**
   * Runs the engine as a coding agent inside this interview's workspace folder.
   * Absent when the engine cannot be confined to a folder.
   */
  agent?(request: Omit<AgentRequest, 'cwd'>): Promise<string>;
  /** What earlier interviews asked in this kind of round, so it is not repeated. */
  alreadyAsked: string[];
  /** Folder this interview may use for an AI-agent task. */
  workspaceDir: string;
}

export interface ActResult<D> {
  data: D;
  /** True when the round has nothing left to ask and should end now. */
  complete: boolean;
  /** Stop (true) or restart (false) the round's clock. Left out to leave it as it is. */
  holdClock?: boolean;
}

/** What a finished background job changes on the round. */
export type BackgroundOutcome = { complete?: boolean; holdClock?: boolean } | void;

/**
 * Slow work a round wants done without making the candidate wait, such as writing
 * the next problem. It runs outside the interview's lock and must not reject: it
 * resolves to a function that applies its result, or its failure, to the round's
 * data as it is by then.
 */
export type BackgroundJob<D> = () => Promise<(data: D) => BackgroundOutcome>;

/** What a handler contributes to a round's entry in the report. */
export type RoundScore = Pick<
  RoundReport,
  'score' | 'competencies' | 'strengths' | 'gaps' | 'practice' | 'summary' | 'review'
>;

/**
 * One kind of round. `D` is the round's private data: questions, hidden answers,
 * everything the candidate has done. Only `view` decides what the candidate sees.
 */
export interface RoundHandler<D = unknown> {
  /** Prepares the round's content. The clock starts when this resolves. */
  start(ctx: RoundContext): Promise<D>;
  view(data: D): RoundView;
  act(ctx: RoundContext, data: D, action: RoundAction): Promise<ActResult<D>>;
  score(ctx: RoundContext, data: D): Promise<RoundScore>;
  /**
   * The round's full answer sheet, when writing it costs model calls. It is written the
   * first time the candidate opens the sheet, not at scoring, so unread sheets cost nothing.
   * Rounds whose answers are free return them from `score` instead and leave this out.
   */
  answerSheet?(ctx: RoundContext, data: D): Promise<ReviewItem[]>;
  /** Advice for a round that is not scored. The score and competencies it returns are ignored. */
  feedback?(ctx: RoundContext, data: D): Promise<RoundScore>;
  /** Short labels for what was asked, remembered to avoid repeats later. */
  asked(data: D): string[];
  /**
   * Called after the round starts and after each action. May mark the data as having
   * work under way and return that work, which the service then runs in the background.
   */
  background?(ctx: RoundContext, data: D, trigger: 'start' | RoundAction['kind']): BackgroundJob<D> | null;
}

export function newMessage(from: Message['from'], text: string): Message {
  return { id: randomBytes(6).toString('hex'), from, text, at: new Date().toISOString() };
}

export function unsupported(action: RoundAction): never {
  throw badRequest(`This round does not accept "${action.kind}".`);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

/** Cuts long text for a prompt, keeping the start and saying that it was cut. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[... cut, ${text.length - max} more characters]`;
}
