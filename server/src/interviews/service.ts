import type {
  Interview,
  InterviewSummary,
  InterviewView,
  Report,
  WorkspaceFile,
  RoundAction,
  RoundReport,
  RoundState,
} from '../../../shared/types.ts';
import { DEFAULT_LEVEL, interviewTypeName, roundTypeOf } from '../catalog.ts';
import { EngineError } from '../engines/engine.ts';
import type { EngineRegistry } from '../engines/registry.ts';
import { conflict, HttpError, notFound } from '../errors.ts';
import { mean, type BackgroundJob, type RoundContext } from '../rounds/handler.ts';
import { INTERVIEWER_PERSONA } from '../rounds/prompts.ts';
import type { RoundHandlers } from '../rounds/registry.ts';
import type { Store } from '../store.ts';
import { listWorkspaceFiles, readWorkspaceFile } from '../workspace.ts';
import { planRounds, resolveOptions, resolveStack, type CreateInterviewInput } from './plan.ts';

/** Past interviews searched for questions to avoid repeating. */
const REPEAT_LOOKBACK = 12;
/** Waits shorter than this are not worth giving back to the candidate's clock. */
const CLOCK_CREDIT_FROM_MS = 1500;
/** Actions that are the candidate's own time, not the interviewer's. */
const CANDIDATE_TIME_ACTIONS: RoundAction['kind'][] = ['run', 'poll', 'choose', 'run_tests', 'save_file', 'agent'];

const EMPTY_SCORE = {
  score: null,
  competencies: [],
  strengths: [],
  gaps: [],
  practice: [],
  summary: '',
  review: [],
  answersPending: false,
  error: null,
};

function engineFailure(error: EngineError): HttpError {
  const status = error.code === 'not_installed' ? 424 : error.code === 'timeout' ? 504 : 502;
  return new HttpError(status, `engine_${error.code}`, error.message);
}

export class InterviewService {
  /** Per-interview queue: changes to one interview never interleave. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly scoring = new Set<string>();
  private readonly backgroundWork = new Set<Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly engines: EngineRegistry,
    private readonly handlers: RoundHandlers,
  ) {}

  private locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch(() => {});
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return next;
  }

  private async load(id: string): Promise<Interview> {
    const interview = await this.store.loadInterview(id);
    if (!interview) throw notFound('That interview');
    return interview;
  }

  /** Ends the active round if its time is up. Returns whether anything changed. */
  private expire(interview: Interview): boolean {
    const round = interview.rounds.find((candidate) => candidate.status === 'active');
    // A held clock is not running, so it cannot run out.
    if (!round?.endsAt || round.clockHeldAt || Date.now() < Date.parse(round.endsAt)) return false;
    round.status = 'done';
    round.endedAt = round.endsAt;
    return true;
  }

  /** Stops the round's clock, or restarts it and gives back the time it was stopped for. */
  private holdClock(round: RoundState, hold: boolean): void {
    if (hold && !round.clockHeldAt) {
      round.clockHeldAt = new Date().toISOString();
    } else if (!hold && round.clockHeldAt && round.endsAt) {
      round.endsAt = new Date(Date.parse(round.endsAt) + Date.now() - Date.parse(round.clockHeldAt)).toISOString();
      round.clockHeldAt = null;
    }
  }

  /**
   * Runs a round's slow work without holding the interview's lock, then applies the
   * result under the lock to whatever the round has become in the meantime.
   */
  private runInBackground(id: string, index: number, job: BackgroundJob<unknown>): void {
    const work = job()
      .then((apply) =>
        this.locked(id, async () => {
          const interview = await this.store.loadInterview(id);
          const round = interview?.rounds[index];
          if (!interview || !round || (round.status !== 'active' && round.status !== 'paused')) return;
          const data = await this.store.loadRound(id, index);
          if (!data) return;
          const outcome = apply(data) ?? {};
          if (outcome.holdClock !== undefined) this.holdClock(round, outcome.holdClock);
          if (outcome.complete) {
            round.status = 'done';
            round.endedAt = new Date().toISOString();
          }
          await this.store.saveRound(id, index, data);
          await this.store.saveInterview(interview);
        }),
      )
      .catch((error: unknown) => this.store.appendEvent(id, { kind: 'background_failed', round: index, message: String(error) }).catch(() => {}))
      .finally(() => this.backgroundWork.delete(work));
    this.backgroundWork.add(work);
  }

  /** Resolves once no background work is running. Lets tests and shutdown wait for it. */
  async whenIdle(): Promise<void> {
    while (this.backgroundWork.size > 0) await Promise.all(this.backgroundWork);
  }

  private roundAt(interview: Interview, index: number): RoundState {
    const round = interview.rounds[index];
    if (!round) throw notFound('That round');
    return round;
  }

  private async context(interview: Interview, round: RoundState): Promise<RoundContext> {
    const engine = this.engines.get(interview.engine);
    if (!engine) throw new HttpError(424, 'engine_not_installed', `No engine called ${interview.engine}.`);
    return {
      interview,
      round,
      ask: (request) => engine.ask({ system: INTERVIEWER_PERSONA, ...request }),
      agent: engine.agent ? (request) => engine.agent!({ ...request, cwd: this.store.workspaceDir(interview.id) }) : undefined,
      alreadyAsked: await this.alreadyAsked(interview.id, round),
      workspaceDir: this.store.workspaceDir(interview.id),
    };
  }

  private async alreadyAsked(currentId: string, round: RoundState): Promise<string[]> {
    const handler = this.handlers[round.type];
    const past = (await this.store.listInterviews()).filter((interview) => interview.id !== currentId).slice(0, REPEAT_LOOKBACK);
    const asked: string[] = [];
    for (const interview of past) {
      for (const other of interview.rounds.filter((candidate) => candidate.type === round.type)) {
        const data = await this.store.loadRound(interview.id, other.index);
        if (data) asked.push(...handler.asked(data));
      }
    }
    return asked;
  }

  private async toView(interview: Interview): Promise<InterviewView> {
    const round = interview.rounds.find((candidate) => candidate.status === 'active' || candidate.status === 'paused');
    const data = round ? await this.store.loadRound(interview.id, round.index) : null;
    return {
      interview,
      current: round && data ? this.handlers[round.type].view(data) : null,
      now: new Date().toISOString(),
    };
  }

  // ---------- Reading ----------

  async list(): Promise<InterviewSummary[]> {
    return (await this.store.listInterviews()).map((interview) => ({
      id: interview.id,
      type: interview.type,
      name: interview.name,
      stack: interview.stack.name,
      status: interview.status,
      createdAt: interview.createdAt,
      overall: interview.overall,
    }));
  }

  async get(id: string): Promise<InterviewView> {
    const interview = await this.load(id);
    if (!this.expire(interview)) return this.toView(interview);
    // The clock ran out since the last look: record that under the lock.
    return this.locked(id, async () => {
      const fresh = await this.load(id);
      if (this.expire(fresh)) await this.store.saveInterview(fresh);
      return this.toView(fresh);
    });
  }

  /** The files of the interview's AI-agent task workspace, for the page's editor. */
  async workspaceFiles(id: string): Promise<string[]> {
    await this.load(id);
    return listWorkspaceFiles(this.store.workspaceDir(id));
  }

  async workspaceFile(id: string, file: string): Promise<WorkspaceFile> {
    await this.load(id);
    return readWorkspaceFile(this.store.workspaceDir(id), file);
  }

  async report(id: string): Promise<Report> {
    await this.load(id);
    const report = await this.store.loadReport(id);
    if (!report) throw notFound('The report for that interview');
    return report;
  }

  // ---------- Lifecycle ----------

  async create(input: CreateInterviewInput): Promise<InterviewView> {
    const engine = this.engines.get(input.engine);
    const status = await engine?.status();
    if (status?.state !== 'ready') {
      throw new HttpError(424, 'engine_not_ready', `${status?.name ?? input.engine} is not ready. ${status?.fix ?? ''}`.trim());
    }
    const running = (await this.store.listInterviews()).find((interview) => interview.status === 'in_progress');
    if (running) {
      throw conflict('interview_in_progress', 'Another interview is in progress. Finish or delete it before starting a new one.');
    }

    // The built-in assistant needs an engine that can be confined to the workspace folder.
    const options = resolveOptions(input, Boolean(engine?.agent));
    const interview: Interview = {
      id: this.store.newId(),
      type: input.type,
      name: interviewTypeName(input.type),
      stack: resolveStack(input.stack, input.language),
      level: input.level ?? DEFAULT_LEVEL,
      engine: input.engine,
      options,
      rounds: planRounds(input.type, options, input.rounds).map((plan, index) => ({
        index,
        type: plan.type,
        minutes: plan.minutes,
        status: 'pending',
        startedAt: null,
        endsAt: null,
        endedAt: null,
        pausedRemainingMs: null,
        clockHeldAt: null,
      })),
      status: 'in_progress',
      createdAt: new Date().toISOString(),
      finishedAt: null,
      overall: null,
    };
    await this.store.createInterview(interview);
    await this.store.appendEvent(interview.id, { kind: 'created', type: interview.type, stack: interview.stack.name });
    return this.toView(interview);
  }

  startRound(id: string, index: number): Promise<InterviewView> {
    return this.locked(id, async () => {
      const interview = await this.load(id);
      if (this.expire(interview)) await this.store.saveInterview(interview);
      const round = this.roundAt(interview, index);
      if (interview.status !== 'in_progress') throw conflict('interview_finished', 'This interview is finished.');
      if (round.status !== 'pending') throw conflict('round_already_started', 'This round has already been started.');
      const earlier = interview.rounds.slice(0, index).find((other) => other.status !== 'done' && other.status !== 'skipped');
      if (earlier) throw conflict('round_out_of_order', `Finish the ${roundTypeOf(earlier.type).name} round first.`);

      const handler = this.handlers[round.type];
      const ctx = await this.context(interview, round);
      let data: unknown;
      try {
        data = await handler.start(ctx);
      } catch (error) {
        await this.store.appendEvent(id, { kind: 'round_start_failed', round: index, message: String(error) });
        throw error instanceof EngineError ? engineFailure(error) : error;
      }
      // The clock starts only once the content exists.
      const now = Date.now();
      round.status = 'active';
      round.startedAt = new Date(now).toISOString();
      round.endsAt = new Date(now + round.minutes * 60_000).toISOString();
      const job = handler.background?.(ctx, data, 'start') ?? null;
      await this.store.saveRound(id, index, data);
      await this.store.saveInterview(interview);
      await this.store.appendEvent(id, { kind: 'round_started', round: index, type: round.type });
      if (job) this.runInBackground(id, index, job);
      return this.toView(interview);
    });
  }

  act(id: string, index: number, action: RoundAction): Promise<InterviewView> {
    return this.locked(id, async () => {
      const interview = await this.load(id);
      const expired = this.expire(interview);
      const round = this.roundAt(interview, index);
      if (round.status !== 'active') {
        if (expired) await this.store.saveInterview(interview);
        // A background poll that arrives late is not an error worth showing.
        if (action.kind === 'poll') return this.toView(interview);
        if (round.status === 'paused') throw conflict('round_paused', 'The round is paused. Resume it to continue.');
        throw conflict('round_locked', 'Time is up for this round.');
      }

      const handler = this.handlers[round.type];
      const data = await this.store.loadRound(id, index);
      if (!data) throw notFound('The content of that round');
      const startedAt = Date.now();
      try {
        const ctx = await this.context(interview, round);
        const result = await handler.act(ctx, data, action);
        const waited = Date.now() - startedAt;
        // Time the candidate spent waiting for the interviewer is given back.
        if (waited >= CLOCK_CREDIT_FROM_MS && !CANDIDATE_TIME_ACTIONS.includes(action.kind) && round.endsAt) {
          round.endsAt = new Date(Date.parse(round.endsAt) + waited).toISOString();
        }
        if (result.holdClock !== undefined) this.holdClock(round, result.holdClock);
        if (result.complete) {
          round.status = 'done';
          round.endedAt = new Date().toISOString();
        }
        const job = result.complete ? null : (handler.background?.(ctx, result.data, action.kind) ?? null);
        await this.store.saveRound(id, index, result.data);
        await this.store.saveInterview(interview);
        if (action.kind !== 'poll' && action.kind !== 'save_file') await this.store.appendEvent(id, { kind: 'action', round: index, action: action.kind });
        if (job) this.runInBackground(id, index, job);
        return this.toView(interview);
      } catch (error) {
        if (!(error instanceof EngineError)) throw error;
        // Often a plan limit. Stop the clock so no interview time is lost to it.
        this.holdClock(round, false);
        round.status = 'paused';
        round.pausedRemainingMs = Math.max(0, Date.parse(round.endsAt ?? '') - startedAt);
        await this.store.saveInterview(interview);
        await this.store.appendEvent(id, { kind: 'paused', round: index, message: error.message });
        throw engineFailure(error);
      }
    });
  }

  resumeRound(id: string, index: number): Promise<InterviewView> {
    return this.locked(id, async () => {
      const interview = await this.load(id);
      const round = this.roundAt(interview, index);
      if (round.status !== 'paused') throw conflict('round_not_paused', 'This round is not paused.');
      round.status = 'active';
      round.endsAt = new Date(Date.now() + (round.pausedRemainingMs ?? 0)).toISOString();
      round.pausedRemainingMs = null;
      await this.store.saveInterview(interview);
      await this.store.appendEvent(id, { kind: 'resumed', round: index });
      return this.toView(interview);
    });
  }

  /** Ends a round before its time is up. */
  submitRound(id: string, index: number): Promise<InterviewView> {
    return this.locked(id, async () => {
      const interview = await this.load(id);
      this.expire(interview);
      const round = this.roundAt(interview, index);
      if (round.status === 'active' || round.status === 'paused') {
        round.clockHeldAt = null;
        round.status = 'done';
        round.endedAt = new Date().toISOString();
        await this.store.appendEvent(id, { kind: 'round_submitted', round: index });
      } else if (round.status === 'pending') {
        throw conflict('round_not_started', 'This round has not been started.');
      }
      await this.store.saveInterview(interview);
      return this.toView(interview);
    });
  }

  async delete(id: string): Promise<void> {
    if (this.scoring.has(id)) throw conflict('scoring_in_progress', 'This interview is being scored. Try again in a moment.');
    await this.locked(id, async () => {
      await this.load(id);
      await this.store.deleteInterview(id);
    });
  }

  // ---------- Scoring ----------

  /**
   * Scores the interview and writes the report. Rounds that were never started are
   * skipped. Safe to call again: only rounds that failed to score are retried.
   */
  async finish(id: string): Promise<Report> {
    if (this.scoring.has(id)) throw conflict('scoring_in_progress', 'This interview is already being scored.');
    this.scoring.add(id);
    try {
      const interview = await this.locked(id, async () => {
        const fresh = await this.load(id);
        this.expire(fresh);
        if (fresh.rounds.some((round) => round.status === 'active' || round.status === 'paused')) {
          throw conflict('round_in_progress', 'Submit the current round before finishing the interview.');
        }
        for (const round of fresh.rounds) if (round.status === 'pending') round.status = 'skipped';
        await this.store.saveInterview(fresh);
        return fresh;
      });

      const previous = await this.store.loadReport(id);
      const rounds = await Promise.all(
        interview.rounds.map((round) => {
          const earlier = previous?.rounds.find((entry) => entry.index === round.index);
          return earlier && earlier.status !== 'error' ? earlier : this.scoreRound(interview, round);
        }),
      );
      const report: Report = {
        interviewId: id,
        level: interview.level ?? DEFAULT_LEVEL,
        overall: mean(rounds.flatMap((round) => (round.score === null ? [] : [round.score]))),
        rounds,
        complete: rounds.every((round) => round.status !== 'error'),
        generatedAt: new Date().toISOString(),
      };
      await this.store.saveReport(report);
      await this.locked(id, async () => {
        const fresh = await this.load(id);
        fresh.status = 'finished';
        fresh.finishedAt = fresh.finishedAt ?? new Date().toISOString();
        fresh.overall = report.overall;
        await this.store.saveInterview(fresh);
      });
      await this.store.appendEvent(id, { kind: 'scored', overall: report.overall, complete: report.complete });
      return report;
    } finally {
      this.scoring.delete(id);
    }
  }

  /**
   * Writes the answer sheet for every round that still lacks one, and returns the report.
   * Called when the candidate first opens the sheet. Rounds that fail stay pending, so
   * calling again retries only those.
   */
  async answers(id: string): Promise<Report> {
    if (this.scoring.has(id)) throw conflict('scoring_in_progress', 'This interview is being scored. Try again in a moment.');
    this.scoring.add(id);
    try {
      const interview = await this.load(id);
      const report = await this.store.loadReport(id);
      if (!report) throw notFound('The report for that interview');

      const failures: string[] = [];
      await Promise.all(
        report.rounds
          .filter((entry) => entry.answersPending)
          .map(async (entry) => {
            const round = this.roundAt(interview, entry.index);
            try {
              const data = await this.store.loadRound(id, round.index);
              if (!data) throw new Error('The content of this round is missing.');
              entry.review = await this.handlers[round.type].answerSheet!(await this.context(interview, round), data);
              entry.answersPending = false;
            } catch (error) {
              failures.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }),
      );
      // Save what was written even if another round failed, so it is not paid for twice.
      await this.store.saveReport(report);
      if (failures.length > 0) {
        throw new HttpError(502, 'answers_failed', `The answer sheet could not be written for ${failures.join('; ')}`);
      }
      return report;
    } finally {
      this.scoring.delete(id);
    }
  }

  private async scoreRound(interview: Interview, round: RoundState): Promise<RoundReport> {
    const type = roundTypeOf(round.type);
    const base = { index: round.index, type: round.type, name: type.name, ...EMPTY_SCORE };
    if (round.status === 'skipped') return { ...base, status: 'skipped', summary: 'This round was not started.' };
    const handler = this.handlers[round.type];
    const unscored = { ...base, status: 'unscored' as const, summary: 'This round is a warm-up and is not scored.' };
    if (!type.scored && !handler.feedback) return unscored;
    try {
      const data = await this.store.loadRound(interview.id, round.index);
      if (!data) throw new Error('The content of this round is missing.');
      const ctx = await this.context(interview, round);
      if (!type.scored) {
        // Advice only: whatever the handler returns, an unscored round carries no score.
        const advice = await handler.feedback!(ctx, data);
        return { ...unscored, ...advice, score: null, competencies: [] };
      }
      const score = await handler.score(ctx, data);
      return { ...base, ...score, status: 'scored', answersPending: Boolean(handler.answerSheet) };
    } catch (error) {
      // One round failing to score must not cost the candidate the rest of the report.
      const message = error instanceof Error ? error.message : String(error);
      return { ...base, status: 'error', error: message, summary: 'This round could not be scored.' };
    }
  }
}
