import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AiTaskView, Message, RoundAction, RoundView, WorkspaceMode } from '../../../shared/types.ts';
import { EngineError } from '../engines/engine.ts';
import { badRequest, HttpError } from '../errors.ts';
import { CommandNotFoundError, CommandTimeoutError, run } from '../process.ts';
import type { Task, TaskLibrary } from '../tasks.ts';
import { diffWorkspace, formatActivity, readActivity, type Activity } from '../watcher/sessionWatcher.ts';
import { writeWorkspaceFile } from '../workspace.ts';
import {
  newMessage,
  truncate,
  unsupported,
  type ActResult,
  type BackgroundJob,
  type RoundContext,
  type RoundHandler,
  type RoundScore,
} from './handler.ts';
import { describeInterview, formatTranscript, scoreWithRubric } from './prompts.ts';

export interface AiTaskData {
  taskId: string;
  title: string;
  brief: string;
  workspace: string;
  transcript: Message[];
  phase: AiTaskView['phase'];
  /** True while an interviewer question is waiting for the candidate. */
  awaitingAnswer: boolean;
  checkIns: number;
  lastCheckInAt: string;
  /** Session events already seen at the last check-in, so the next one needs new activity. */
  eventsAtLastCheckIn: number;
  closingQuestions: string[];
  closingAsked: number;
  testResult: { passed: boolean; output: string } | null;
  activity: AiTaskView['activity'];
  /** Where the candidate works. Rounds from before this existed are `own`. */
  workspaceMode: WorkspaceMode;
  /** The built-in assistant's conversation, and the session that keeps it together. */
  assistant: Message[];
  agentSessionId: string;
  agentTurns: number;
  /** The request the assistant has been given and not yet answered. */
  agentRequest: string | null;
  agentBusySince: string | null;
  agentError: string | null;
  agentSteps: string[];
  /** Files the candidate saved by hand in the page's editor, with how many times. */
  manualEdits: Record<string, number>;
  testRuns: number;
  lastTest: { passed: boolean; output: string } | null;
}

const FIRST_CHECK_IN_MS = 5 * 60_000;
const CHECK_IN_EVERY_MS = 6 * 60_000;
const MAX_CHECK_INS = 4;
const TEST_TIMEOUT_MS = 90_000;
/** An assistant request older than this was lost (for example to a restart). */
const AGENT_STALE_MS = 12 * 60_000;
const STEPS_SHOWN = 5;
const OUTPUT_LINES_KEPT = 60;

/** Keeps the start and the end of long test output: the list of tests and the failure details. */
function trimOutput(text: string): string {
  const lines = text.trim().split('\n');
  if (lines.length <= 2 * OUTPUT_LINES_KEPT) return lines.join('\n');
  const cut = lines.length - 2 * OUTPUT_LINES_KEPT;
  return [...lines.slice(0, OUTPUT_LINES_KEPT), `[... ${cut} lines cut ...]`, ...lines.slice(-OUTPUT_LINES_KEPT)].join('\n');
}

const checkInSchema = z.object({ ask: z.boolean(), question: z.string() });
const closingSchema = z.object({ questions: z.array(z.string()) });

/** The round where the candidate works in their own editor with their own coding agent. */
export class AiTaskHandler implements RoundHandler<AiTaskData> {
  constructor(private readonly tasks: TaskLibrary) {}

  async start(ctx: RoundContext): Promise<AiTaskData> {
    // `asked` records task ids, so what was "already asked" is the tasks already done.
    const task = await this.tasks.pick(ctx.interview.stack.language, ctx.alreadyAsked);
    if (!task) {
      throw new HttpError(422, 'no_task', `There is no AI-agent task for ${ctx.interview.stack.language} yet.`);
    }
    const existing = await readdir(ctx.workspaceDir).catch(() => []);
    // A retried start must not overwrite work already done in the folder.
    if (existing.length === 0) {
      await mkdir(ctx.workspaceDir, { recursive: true });
      await this.tasks.copyTo(task, ctx.workspaceDir);
    }
    const workspaceMode: WorkspaceMode = ctx.interview.options.workspace === 'browser' && ctx.agent ? 'browser' : 'own';
    const opening =
      workspaceMode === 'browser'
        ? 'The task is in TASK.md. You have an editor and an AI assistant here: use the assistant however you normally would, and edit by hand whenever you like. I will check in now and then to ask about your decisions. Tell me when you are done.'
        : 'The task is in TASK.md in the workspace. Use your coding agent however you normally would. I will check in now and then to ask about your decisions. Tell me when you are done.';
    return {
      taskId: task.id,
      title: task.title,
      brief: task.brief,
      workspace: ctx.workspaceDir,
      transcript: [newMessage('interviewer', opening)],
      phase: 'working',
      awaitingAnswer: false,
      checkIns: 0,
      lastCheckInAt: new Date().toISOString(),
      eventsAtLastCheckIn: 0,
      closingQuestions: [],
      closingAsked: 0,
      testResult: null,
      activity: { sessionFound: false, prompts: 0, toolCalls: 0, filesChanged: 0 },
      workspaceMode,
      assistant: [],
      agentSessionId: randomUUID(),
      agentTurns: 0,
      agentRequest: null,
      agentBusySince: null,
      agentError: null,
      agentSteps: [],
      manualEdits: {},
      testRuns: 0,
      lastTest: null,
    };
  }

  view(data: AiTaskData): RoundView {
    return {
      mode: 'ai_task',
      title: data.title,
      brief: data.brief,
      workspace: data.workspace,
      transcript: data.transcript,
      phase: data.phase,
      workspaceMode: data.workspaceMode ?? 'own',
      assistant: data.assistant ?? [],
      assistantBusy: Boolean(data.agentBusySince),
      assistantSteps: data.agentBusySince ? (data.agentSteps ?? []) : [],
      assistantError: data.agentError ?? null,
      lastTest: data.lastTest ?? null,
      activity: data.activity,
    };
  }

  async act(ctx: RoundContext, data: AiTaskData, action: RoundAction): Promise<ActResult<AiTaskData>> {
    if (data.phase === 'complete') return { data, complete: true };
    if (data.agentBusySince && Date.now() - Date.parse(data.agentBusySince) > AGENT_STALE_MS) {
      data.agentBusySince = null;
      data.agentRequest = null;
      data.agentError = 'The assistant stopped responding. Ask it again.';
    }
    switch (action.kind) {
      case 'agent':
        return this.askAgent(ctx, data, action.message);
      case 'save_file':
        return this.saveFile(data, action.path, action.content);
      case 'run_tests':
        return this.runTestsNow(data);
      case 'poll':
        return this.poll(ctx, data);
      case 'answer':
        return this.answer(data, action.text);
      case 'finish_work':
        return this.beginClosing(ctx, data);
      default:
        return unsupported(action);
    }
  }

  /** Records a request for the built-in assistant. `background` then runs it. */
  private async askAgent(ctx: RoundContext, data: AiTaskData, message: string): Promise<ActResult<AiTaskData>> {
    if (data.workspaceMode !== 'browser' || !ctx.agent) throw badRequest('This round has no built-in assistant.');
    if (data.phase !== 'working') throw badRequest('The assistant is not available during the wrap-up.');
    if (data.agentBusySince) throw badRequest('The assistant is still working on your last request.');
    data.assistant.push(newMessage('candidate', message));
    data.agentRequest = message;
    data.agentBusySince = new Date().toISOString();
    data.agentError = null;
    data.agentSteps = [];
    return { data, complete: false };
  }

  /**
   * The assistant is Claude Code running in the workspace, which can take minutes.
   * It runs outside the interview's lock so the page, the editor and the interviewer stay usable.
   */
  background(ctx: RoundContext, data: AiTaskData, trigger: 'start' | RoundAction['kind']): BackgroundJob<AiTaskData> | null {
    if (trigger !== 'agent' || !data.agentRequest || !ctx.agent) return null;
    const request = { prompt: data.agentRequest, sessionId: data.agentSessionId, resume: data.agentTurns > 0 };
    data.agentRequest = null;
    const agent = ctx.agent;
    return async () => {
      const task = await this.tasks.get(data.taskId);
      const testCommand = task ? [task.test.command, ...task.test.args].join(' ') : 'npm test';
      try {
        const reply = await agent({ ...request, allowedCommands: [...new Set([testCommand, 'npm test'])] });
        return (fresh) => {
          fresh.agentBusySince = null;
          fresh.agentTurns += 1;
          fresh.assistant.push(newMessage('assistant', reply));
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return (fresh) => {
          fresh.agentBusySince = null;
          fresh.agentError = message;
          // A first request that failed may have left a half-made session behind; start a clean one.
          if (fresh.agentTurns === 0) fresh.agentSessionId = randomUUID();
        };
      }
    };
  }

  private async saveFile(data: AiTaskData, file: string, content: string): Promise<ActResult<AiTaskData>> {
    if (data.workspaceMode !== 'browser') throw badRequest('Files are edited in your own editor in this round.');
    await writeWorkspaceFile(data.workspace, file, content);
    data.manualEdits[file] = (data.manualEdits[file] ?? 0) + 1;
    return { data, complete: false };
  }

  private async runTestsNow(data: AiTaskData): Promise<ActResult<AiTaskData>> {
    const task = await this.tasks.get(data.taskId);
    if (!task) throw new HttpError(500, 'task_missing', `Task ${data.taskId} is no longer in the task library.`);
    data.lastTest = await this.runTests(task, data.workspace);
    data.testRuns = (data.testRuns ?? 0) + 1;
    return { data, complete: false };
  }

  private roundStart(ctx: RoundContext): Date {
    return new Date(ctx.round.startedAt ?? Date.now());
  }

  private async observe(ctx: RoundContext, data: AiTaskData): Promise<{ task: Task; activity: Activity; diff: string }> {
    const task = await this.tasks.get(data.taskId);
    if (!task) throw new HttpError(500, 'task_missing', `Task ${data.taskId} is no longer in the task library.`);
    const [activity, diff] = await Promise.all([
      readActivity(data.workspace, this.roundStart(ctx)),
      diffWorkspace(task.repoDir, data.workspace),
    ]);
    data.activity = {
      sessionFound: activity.sessionFound,
      prompts: activity.events.filter((event) => event.kind === 'prompt').length,
      toolCalls: activity.events.filter((event) => event.kind === 'tool').length,
      filesChanged: diff.filesChanged,
    };
    // Shown to the candidate while the assistant works, so paths are made relative to the workspace.
    const insideWorkspace = new RegExp(`\\S*${path.basename(data.workspace)}/`, 'g');
    data.agentSteps = activity.events
      .filter((event) => event.kind === 'tool')
      .slice(-STEPS_SHOWN)
      .map((event) => event.text.replace(insideWorkspace, ''));
    return { task, activity, diff: diff.text };
  }

  /** Called every few seconds by the page. Refreshes the activity counts and, now and then, asks a question. */
  private async poll(ctx: RoundContext, data: AiTaskData): Promise<ActResult<AiTaskData>> {
    const { activity, diff } = await this.observe(ctx, data);
    const now = Date.now();
    const sinceLast = now - Date.parse(data.lastCheckInAt);
    const due = sinceLast >= (data.checkIns === 0 ? FIRST_CHECK_IN_MS : CHECK_IN_EVERY_MS);
    const hasNews = activity.events.length > data.eventsAtLastCheckIn;
    if (data.phase !== 'working' || data.awaitingAnswer || data.checkIns >= MAX_CHECK_INS || !due || !hasNews) {
      return { data, complete: false };
    }

    const prompt = [
      `You are observing a candidate in the AI-agent task round. ${describeInterview(ctx.interview)}`,
      `Task brief:\n${truncate(data.brief, 3000)}`,
      `\nWhat the candidate asked their coding agent and what the agent did (minutes:seconds into the round):\n${formatActivity(activity.events, this.roundStart(ctx))}`,
      `\nChanges so far:\n${truncate(diff, 6000) || '(no files changed yet)'}`,
      data.transcript.length > 1 ? `\nYour conversation so far:\n${formatTranscript(data.transcript)}` : '',
      '\nDecide whether to interrupt with ONE short question about a specific decision you can see above: why they framed a prompt that way, why they accepted or rejected something, how they know a change is correct, what they would check next.',
      'Set ask to false if nothing specific is worth asking yet, or if you would repeat an earlier question. Never give advice or hints.',
    ].join('\n');
    data.lastCheckInAt = new Date(now).toISOString();
    data.eventsAtLastCheckIn = activity.events.length;
    // A check-in is optional. If the engine fails here the candidate keeps working
    // undisturbed, and the next one is tried after the usual gap.
    const decision = await ctx.ask({ prompt, schema: checkInSchema, tier: 'fast' }).catch((error: unknown) => {
      if (error instanceof EngineError) return null;
      throw error;
    });
    if (decision?.ask && decision.question.trim()) {
      data.checkIns += 1;
      data.awaitingAnswer = true;
      data.transcript.push(newMessage('interviewer', decision.question.trim()));
    }
    return { data, complete: false };
  }

  private async answer(data: AiTaskData, text: string): Promise<ActResult<AiTaskData>> {
    data.transcript.push(newMessage('candidate', text));
    data.awaitingAnswer = false;
    if (data.phase !== 'closing') return { data, complete: false };

    const next = data.closingQuestions[data.closingAsked];
    if (next) {
      data.closingAsked += 1;
      data.awaitingAnswer = true;
      data.transcript.push(newMessage('interviewer', next));
      return { data, complete: false };
    }
    data.phase = 'complete';
    data.transcript.push(newMessage('interviewer', 'That is everything for this round. Thank you.'));
    return { data, complete: true };
  }

  private async runTests(task: Task, workspace: string): Promise<AiTaskData['testResult']> {
    try {
      // Node's test runner behaves as a silent child when it finds this variable, which our
      // own test suite sets; the task's tests must always run as a top-level run.
      const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
      const result = await run(task.test.command, task.test.args, { cwd: workspace, env, timeoutMs: TEST_TIMEOUT_MS });
      const output = trimOutput(`${result.stdout}\n${result.stderr}`);
      return { passed: result.code === 0, output };
    } catch (error) {
      if (error instanceof CommandTimeoutError || error instanceof CommandNotFoundError) {
        return { passed: false, output: error.message };
      }
      throw error;
    }
  }

  private async beginClosing(ctx: RoundContext, data: AiTaskData): Promise<ActResult<AiTaskData>> {
    if (data.phase !== 'working') throw badRequest('The wrap-up has already started.');
    const { task, activity, diff } = await this.observe(ctx, data);
    const testResult = await this.runTests(task, data.workspace);
    const prompt = [
      `The candidate says they have finished the AI-agent task. ${describeInterview(ctx.interview)}`,
      `Task brief:\n${truncate(data.brief, 3000)}`,
      `\nSession with their coding agent:\n${formatActivity(activity.events, this.roundStart(ctx)) || '(no agent session was found)'}`,
      `\nTheir changes:\n${truncate(diff, 10_000) || '(no files changed)'}`,
      `\nThe task's tests ${testResult?.passed ? 'pass' : 'do not pass'}.`,
      `\nConversation so far:\n${formatTranscript(data.transcript)}`,
      '\nWrite exactly two closing questions that test whether they understand and own what was built: one about a specific part of the change (how it works, or an edge case it may miss), one about what they would do differently or check before shipping. Refer to concrete details above. Do not repeat earlier questions.',
    ].join('\n');
    const closing = await ctx.ask({ prompt, schema: closingSchema, tier: 'fast' });
    const questions = closing.questions.map((question) => question.trim()).filter(Boolean).slice(0, 2);

    data.testResult = testResult;
    data.phase = 'closing';
    data.closingQuestions = questions;
    data.closingAsked = 1;
    data.awaitingAnswer = true;
    data.transcript.push(newMessage('interviewer', questions[0] ?? 'Walk me through what you changed and how you know it works.'));
    return { data, complete: false };
  }

  async score(ctx: RoundContext, data: AiTaskData): Promise<RoundScore> {
    const { task, activity, diff } = await this.observe(ctx, data);
    // If the candidate ran out of time before the wrap-up, the tests were never run.
    const testResult = data.testResult ?? (await this.runTests(task, data.workspace));
    const material = [
      `Task brief:\n${truncate(data.brief, 4000)}`,
      `\nWhat a strong performance looks like:\n${task.rubric.map((point) => `- ${point}`).join('\n')}`,
      activity.sessionFound
        ? `\nSession with their coding agent (minutes:seconds into the round):\n${formatActivity(activity.events, this.roundStart(ctx), 150)}`
        : '\nNo coding agent session was found for the workspace. Score how they used the agent as 1 and say that no session was found; judge everything else from the code changes and the conversation.',
      `\nTheir changes against the starting code:\n${truncate(diff, 20_000) || '(no files changed)'}`,
      `\nThe task's tests ${testResult?.passed ? 'PASS' : 'FAIL'}:\n${truncate(testResult?.output ?? '', 2500)}`,
      `\nConversation with the interviewer:\n${formatTranscript(data.transcript)}`,
      data.workspaceMode === 'browser'
        ? `\nThe candidate worked in the browser with the built-in AI assistant. Files they edited by hand: ${Object.keys(data.manualEdits ?? {}).join(', ') || 'none'}. Times they ran the tests themselves: ${data.testRuns ?? 0}.`
        : '',
      data.phase === 'working' ? '\nThe candidate ran out of time before the wrap-up questions.' : '',
    ].join('\n');
    const scored = await scoreWithRubric(ctx, {
      roundName: 'AI-agent task',
      competencies: ['Problem framing', 'Steering the agent', 'Verifying AI output', 'Result quality', 'Judgment under questioning'],
      material,
    });
    return {
      ...scored,
      review: [
        { heading: 'What a strong performance looks like', lines: task.rubric.map((point) => `- ${point}`), code: null },
        {
          heading: `Task tests: ${testResult?.passed ? 'passing' : 'failing'}`,
          lines: activity.sessionFound ? [] : ['No coding agent session was found, so this round was scored from your code changes and answers only.'],
          code: testResult?.output || null,
        },
      ],
    };
  }

  asked(data: AiTaskData): string[] {
    return [data.taskId];
  }
}
