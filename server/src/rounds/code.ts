import { z } from 'zod';
import type {
  CodeLanguage,
  Message,
  ReviewItem,
  RoundAction,
  RoundView,
  RunView,
  TestResultView,
} from '../../../shared/types.ts';
import { roundTypeOf } from '../catalog.ts';
import { EngineError } from '../engines/engine.ts';
import { badRequest } from '../errors.ts';
import { isIdentifier, runFunction, sameValue } from '../runner/codeRunner.ts';
import {
  clamp,
  newMessage,
  truncate,
  unsupported,
  type ActResult,
  type BackgroundJob,
  type BackgroundOutcome,
  type RoundContext,
  type RoundHandler,
  type RoundScore,
} from './handler.ts';
import { avoidList, describeInterview, formatTranscript, languageName, scoreWithRubric } from './prompts.ts';

type Variant = 'coding' | 'debugging';

interface TestCase {
  name: string;
  args: unknown[];
  expected: unknown;
  hidden: boolean;
}

interface Problem {
  title: string;
  statement: string;
  functionName: string;
  starterCode: string;
  /** Hidden until the report, with the three fields after it. */
  referenceSolution: string;
  approach: string;
  timeComplexity: string;
  spaceComplexity: string;
  tests: TestCase[];
}

interface FailedTest {
  name: string;
  call: string;
  expected: string;
  /** What came back, or the error that was raised. */
  got: string;
}

interface Submission {
  code: string;
  passed: number;
  total: number;
  hiddenPassed: number;
  hiddenTotal: number;
  /** The first few failing tests, hidden ones included, for the answer sheet. */
  failures: FailedTest[];
}

export interface CodeData {
  variant: Variant;
  language: CodeLanguage;
  problemCount: number;
  problems: Problem[];
  current: number;
  /** Latest code seen per problem, submitted or not. */
  drafts: (string | null)[];
  submissions: (Submission | null)[];
  runs: number[];
  lastRun: RunView | null;
  assistant: Message[] | null;
  /** For each assistant message, the problem it was sent during. */
  assistantProblem: number[];
  /** The next problem, written ahead of time while the candidate works on this one. */
  next: Problem | null;
  /** When the next problem started being written; null when nothing is under way. */
  preparingSince: string | null;
  prepareError: string | null;
  /** True after a submit that found the next problem not ready yet. */
  waitingForNext: boolean;
  /** Per problem, the interviewer's questions about the submitted solution and the answers. */
  explanations: Message[][];
  /** True between submitting a problem and finishing the talk about it. */
  explaining: boolean;
  complete: boolean;
}

const MIN_TESTS = 4;
const MINUTES_PER_PROBLEM = 12;
const MAX_PROBLEMS = 3;
const MAX_REPORTED_FAILURES = 6;
/** Follow-ups the interviewer may ask about a submitted solution. */
const MAX_EXPLAIN_FOLLOW_UPS = 1;
/** A preparation older than this was lost (for example to a restart) and may be started again. */
const PREPARE_STALE_MS = 10 * 60_000;

const problemSchema = z.object({
  title: z.string(),
  statement: z.string(),
  functionName: z.string(),
  starterCode: z.string(),
  referenceSolution: z.string(),
  approach: z.string(),
  timeComplexity: z.string(),
  spaceComplexity: z.string(),
  tests: z.array(
    z.object({ name: z.string(), argsJson: z.string(), expectedJson: z.string(), hidden: z.boolean() }),
  ),
});
type RawProblem = z.infer<typeof problemSchema>;

const LANGUAGE_RULES: Record<CodeLanguage, string> = {
  javascript: 'Modern JavaScript with a camelCase function declared with the `function` keyword. No imports.',
  typescript:
    'TypeScript with a camelCase function declared with the `function` keyword and typed parameters. It runs under Node type stripping, so no enums, namespaces or parameter properties. No imports.',
  python: 'Python 3 with a snake_case function. Standard library only.',
};

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

/**
 * Checks a generated problem by running it, and returns the tests that hold up.
 *
 * A model can write a statement, a solution and expected values that disagree. The
 * reference solution is run on every test, and a test survives only when the reference
 * returns exactly what the test expects. For debugging, the starter code must also fail.
 */
async function verifyProblem(raw: RawProblem, language: CodeLanguage, variant: Variant): Promise<{ problem: Problem | null; faults: string[] }> {
  if (!isIdentifier(raw.functionName)) return { problem: null, faults: [`functionName "${raw.functionName}" is not a plain identifier`] };

  const faults: string[] = [];
  const candidates: TestCase[] = [];
  for (const test of raw.tests) {
    const args = parseJson(test.argsJson);
    const expected = parseJson(test.expectedJson);
    if (!args.ok || !Array.isArray(args.value) || !expected.ok) {
      faults.push(`test "${test.name}": argsJson must be a JSON array and expectedJson valid JSON`);
      continue;
    }
    candidates.push({ name: test.name, args: args.value, expected: expected.value, hidden: test.hidden });
  }

  const reference = await runFunction(language, raw.referenceSolution, raw.functionName, candidates);
  if (reference.error) return { problem: null, faults: [`referenceSolution does not run: ${reference.error}`] };

  const tests = candidates.filter((test, index) => {
    const outcome = reference.cases[index];
    if (outcome?.error) faults.push(`test "${test.name}": referenceSolution threw ${outcome.error}`);
    else if (!sameValue(outcome?.actual, test.expected)) {
      faults.push(`test "${test.name}": referenceSolution returned ${show(outcome?.actual)} but expectedJson is ${show(test.expected)}`);
    } else return true;
    return false;
  });

  if (tests.length < MIN_TESTS) faults.push(`only ${tests.length} tests are consistent; at least ${MIN_TESTS} are needed`);
  if (!tests.some((test) => !test.hidden)) faults.push('at least one test must be visible');

  if (variant === 'debugging' && tests.length > 0) {
    const buggy = await runFunction(language, raw.starterCode, raw.functionName, tests);
    const failing = buggy.error ? 0 : tests.filter((test, index) => !sameValue(buggy.cases[index]?.actual, test.expected)).length;
    if (buggy.error) faults.push(`starterCode must run, but: ${buggy.error}`);
    else if (failing === 0) faults.push('starterCode passes every test, so there is no bug to find');
  }

  const usable = tests.length >= MIN_TESTS && tests.some((test) => !test.hidden) && !faults.some((fault) => fault.startsWith('starterCode'));
  const problem = usable ? { ...raw, tests } : null;
  return { problem, faults };
}

function problemPrompt(ctx: RoundContext, data: Pick<CodeData, 'variant' | 'language' | 'problems' | 'problemCount'>): string {
  const number = data.problems.length + 1;
  const earlier = data.problems.map((problem, index) => `Problem ${index + 1}: ${problem.title}\n${problem.statement}`).join('\n\n');
  const shape =
    data.variant === 'coding'
      ? [
          number === 1
            ? 'Problem 1 is a warm-up a competent engineer solves in about ten minutes.'
            : 'This problem must be harder than the previous one and, where natural, extend the same scenario with a new requirement.',
          'starterCode is the function signature with an empty body.',
        ]
      : [
          'This is a debugging exercise: starterCode is a realistic 25 to 50 line implementation containing one or two subtle bugs (off-by-one, wrong comparison, unintended mutation, missed edge case). Do not mark the bugs with comments.',
          'The statement describes the intended behaviour without revealing the bugs. At least two tests must fail against starterCode.',
        ];
  return [
    `Write ${data.variant === 'coding' ? 'coding problem' : 'debugging exercise'} ${number} of ${data.problemCount}. ${describeInterview(ctx.interview)}`,
    ...shape,
    `Language rules: ${LANGUAGE_RULES[data.language]}`,
    'The function is pure: it takes JSON-serialisable arguments and returns a JSON-serialisable value (number, string, boolean, null, array, or object with string keys). No input/output, randomness, dates or timers.',
    'The return value must be uniquely determined by the arguments. Where order could vary, the statement must fix the order.',
    'statement is plain text: what the function receives and returns, the constraints, and one worked example.',
    'referenceSolution is a complete, correct implementation that defines the same function name, using the best time complexity you know for the problem.',
    'approach explains the idea behind referenceSolution in two or three sentences. timeComplexity and spaceComplexity are its big-O bounds with the variables named, for example "O(n log n), n = number of entries".',
    'tests: eight to ten cases. name is a short description; argsJson is a JSON array of the arguments in order; expectedJson is the JSON of the return value; hidden is true for about half of them, the edge cases.',
    'Work each expected value out by tracing referenceSolution; they are checked by running it.',
    earlier ? `\nEarlier problems in this round:\n${earlier}` : '',
    avoidList(ctx.alreadyAsked),
  ].join('\n');
}

async function generateProblem(ctx: RoundContext, data: Pick<CodeData, 'variant' | 'language' | 'problems' | 'problemCount'>): Promise<Problem> {
  const base = problemPrompt(ctx, data);
  let faults: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt =
      faults.length === 0
        ? base
        : `${base}\n\nYour previous attempt was rejected when it was run:\n${faults.slice(0, 8).map((fault) => `- ${fault}`).join('\n')}\nWrite a corrected problem.`;
    const raw = await ctx.ask({ prompt, schema: problemSchema, tier: 'strong', timeoutMs: 240_000 });
    const checked = await verifyProblem(raw, data.language, data.variant);
    if (checked.problem) return checked.problem;
    faults = checked.faults;
  }
  throw new EngineError('bad_output', 'The engine could not produce a problem whose tests agree with its own solution. Try again.');
}

const assistantSchema = z.object({ reply: z.string() });

const explainTurnSchema = z.object({ followUp: z.boolean(), message: z.string() });

const EXPLAIN_QUESTION: Record<Variant, string> = {
  coding: 'Walk me through your approach, and tell me its time and space complexity.',
  debugging: 'What was wrong with the code, how did you find it, and why does your change fix it?',
};

const complexitySchema = z.object({
  problems: z.array(
    z.object({
      yourTime: z.string(),
      yourSpace: z.string(),
      isOptimal: z.boolean(),
      note: z.string(),
    }),
  ),
});

function callOf(problem: Problem, test: TestCase): string {
  return `${problem.functionName}(${show(test.args).slice(1, -1)})`;
}

interface Execution {
  results: TestResultView[];
  passed: boolean[];
  stdout: string;
  error: string | null;
}

export class CodeHandler implements RoundHandler<CodeData> {
  constructor(private readonly variant: Variant) {}

  async start(ctx: RoundContext): Promise<CodeData> {
    const seed = {
      variant: this.variant,
      language: ctx.interview.stack.language,
      problemCount: clamp(Math.floor(ctx.round.minutes / MINUTES_PER_PROBLEM), 1, MAX_PROBLEMS),
      problems: [] as Problem[],
    };
    const first = await generateProblem(ctx, seed);
    return {
      ...seed,
      problems: [first],
      current: 0,
      drafts: [null],
      submissions: [null],
      runs: [0],
      lastRun: null,
      // The AI assistant belongs to Karat NextGen coding; debugging is always unaided.
      assistant: this.variant === 'coding' && ctx.interview.options.nextGen ? [] : null,
      assistantProblem: [],
      next: null,
      preparingSince: null,
      prepareError: null,
      waitingForNext: false,
      explanations: [[]],
      explaining: false,
      complete: false,
    };
  }

  /**
   * Writes the next problem while the candidate is still on the current one, so that
   * submitting moves on at once instead of waiting a minute for a model.
   */
  background(ctx: RoundContext, data: CodeData, trigger: 'start' | RoundAction['kind']): BackgroundJob<CodeData> | null {
    if (data.complete || data.next || data.problems.length >= data.problemCount) return null;
    const underWay = data.preparingSince !== null && Date.now() - Date.parse(data.preparingSince) < PREPARE_STALE_MS;
    if (underWay) return null;
    // After a failure, try again only when the candidate is waiting and asks for it.
    const asked = trigger === 'submit_problem' || trigger === 'retry_next' || trigger === 'answer';
    if (data.prepareError && !(data.waitingForNext && asked)) return null;

    data.preparingSince = new Date().toISOString();
    data.prepareError = null;
    const snapshot = { variant: data.variant, language: data.language, problemCount: data.problemCount, problems: [...data.problems] };
    return async () => {
      try {
        const problem = await generateProblem(ctx, snapshot);
        return (fresh) => this.receiveNext(fresh, problem);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return (fresh) => {
          fresh.preparingSince = null;
          fresh.prepareError = message;
        };
      }
    };
  }

  private receiveNext(data: CodeData, problem: Problem): BackgroundOutcome {
    data.preparingSince = null;
    if (data.complete || data.next) return;
    data.next = problem;
    if (!data.waitingForNext) return;
    this.advance(data);
    // The candidate was waiting with the clock stopped; it runs again now.
    return { holdClock: false };
  }

  private advance(data: CodeData): void {
    data.problems.push(data.next!);
    data.next = null;
    data.waitingForNext = false;
    data.current += 1;
    data.drafts.push(null);
    data.submissions.push(null);
    data.runs.push(0);
    data.explanations.push([]);
    data.lastRun = null;
  }

  view(data: CodeData): RoundView {
    const problem = data.problems[data.current]!;
    // While waiting, the problem on screen is the one just submitted.
    const previousIndex = data.waitingForNext ? data.current : data.current - 1;
    const previous = data.submissions[previousIndex];
    return {
      mode: 'code',
      variant: data.variant,
      language: data.language,
      problemIndex: data.current,
      problemCount: data.problemCount,
      problem: {
        title: problem.title,
        statement: problem.statement,
        functionName: problem.functionName,
        starterCode: problem.starterCode,
        tests: problem.tests
          .filter((test) => !test.hidden)
          .map((test) => ({ name: test.name, args: show(test.args), expected: show(test.expected) })),
      },
      code: data.drafts[data.current] ?? null,
      lastRun: data.lastRun,
      assistant: data.assistant,
      discussion: data.explaining ? (data.explanations[data.current] ?? []) : null,
      previous: previous ? { title: data.problems[previousIndex]!.title, passed: previous.passed, total: previous.total } : null,
      preparingNext: Boolean(data.waitingForNext),
      nextError: data.waitingForNext ? (data.prepareError ?? null) : null,
      complete: data.complete,
    };
  }

  async act(ctx: RoundContext, data: CodeData, action: RoundAction): Promise<ActResult<CodeData>> {
    if (data.complete) return { data, complete: true };
    // Rounds started before explanations existed have no list for them yet.
    data.explanations ??= data.problems.map(() => []);
    if (action.kind === 'retry_next') {
      if (!data.waitingForNext) throw badRequest('There is no problem waiting to be prepared.');
      // `background` sees the request and starts the preparation again.
      return { data, complete: false };
    }
    if (data.waitingForNext) throw badRequest('The next problem is still being prepared.');
    if (data.explaining) {
      if (action.kind !== 'answer') throw badRequest('Answer the interviewer about your solution first.');
      return this.explain(ctx, data, action.text);
    }
    switch (action.kind) {
      case 'run':
        return this.runVisible(data, action.code);
      case 'submit_problem':
        return this.submit(data, action.code);
      case 'assistant':
        return this.askAssistant(ctx, data, action.message, action.code);
      default:
        return unsupported(action);
    }
  }

  private async execute(data: CodeData, code: string, tests: TestCase[]): Promise<Execution> {
    const problem = data.problems[data.current]!;
    const outcome = await runFunction(data.language, code, problem.functionName, tests);
    const passed = tests.map((test, index) => {
      const row = outcome.cases[index];
      return !outcome.error && !!row && !row.error && sameValue(row.actual, test.expected);
    });
    const results = tests.map((test, index) => {
      const row = outcome.cases[index];
      return {
        name: test.name,
        args: callOf(problem, test),
        expected: show(test.expected),
        passed: passed[index]!,
        actual: row && !row.error ? show(row.actual) : null,
        error: row?.error ?? null,
      };
    });
    return { results, passed, stdout: outcome.stdout, error: outcome.error };
  }

  private async runVisible(data: CodeData, code: string): Promise<ActResult<CodeData>> {
    const visible = data.problems[data.current]!.tests.filter((test) => !test.hidden);
    const outcome = await this.execute(data, code, visible);
    data.drafts[data.current] = code;
    data.runs[data.current] = (data.runs[data.current] ?? 0) + 1;
    data.lastRun = { results: outcome.results, stdout: outcome.stdout, error: outcome.error, hidden: null };
    return { data, complete: false };
  }

  private async submit(data: CodeData, code: string): Promise<ActResult<CodeData>> {
    const tests = data.problems[data.current]!.tests;
    const outcome = await this.execute(data, code, tests);
    const hiddenTotal = tests.filter((test) => test.hidden).length;
    const hiddenPassed = tests.filter((test, index) => test.hidden && outcome.passed[index]).length;
    data.drafts[data.current] = code;
    data.submissions[data.current] = {
      code,
      passed: outcome.passed.filter(Boolean).length,
      total: tests.length,
      hiddenPassed,
      hiddenTotal,
      failures: outcome.results
        .filter((result) => !result.passed)
        .slice(0, MAX_REPORTED_FAILURES)
        .map((result) => ({
          name: result.name,
          call: result.args,
          expected: result.expected,
          got: outcome.error ?? result.error ?? result.actual ?? 'nothing',
        })),
    };
    // What the candidate may see of a submission: their visible tests and a count of the hidden ones.
    data.lastRun = {
      results: outcome.results.filter((_, index) => !tests[index]!.hidden),
      stdout: outcome.stdout,
      error: outcome.error,
      hidden: { passed: hiddenPassed, total: hiddenTotal },
    };

    // An empty function leaves nothing to talk about.
    if (!this.finalCode(data, data.current)) return this.moveOn(data);
    data.explaining = true;
    data.explanations[data.current] = [newMessage('interviewer', EXPLAIN_QUESTION[data.variant])];
    return { data, complete: false };
  }

  /** The candidate explains the solution they just submitted; the interviewer may probe once. */
  private async explain(ctx: RoundContext, data: CodeData, text: string): Promise<ActResult<CodeData>> {
    const talk = data.explanations[data.current]!;
    talk.push(newMessage('candidate', text));
    const followUpsUsed = talk.filter((message) => message.from === 'interviewer').length - 1;
    if (followUpsUsed < MAX_EXPLAIN_FOLLOW_UPS) {
      const problem = data.problems[data.current]!;
      const prompt = [
        `The candidate has just submitted a solution in the "${roundTypeOf(data.variant).name}" round and is explaining it. ${describeInterview(ctx.interview)}`,
        `Problem: ${problem.title}\n${problem.statement}`,
        `Their code:\n${truncate(this.finalCode(data, data.current) ?? '', 12_000)}`,
        `Best known solution: time ${problem.timeComplexity}, space ${problem.spaceComplexity}.`,
        `\nExchange so far:\n${formatTranscript(talk)}`,
        '\nDecide what to say next.',
        '- If the explanation is vague, misstates what the code does, gets the complexity wrong or leaves it out, or the code is slower than the best known solution and they have not said how they would improve it, set followUp to true and put ONE short question in message. Do not reveal the answer or say whether they were right.',
        '- Otherwise set followUp to false and put a neutral one-sentence acknowledgement in message.',
      ].join('\n');
      const turn = await ctx.ask({ prompt, schema: explainTurnSchema, tier: 'fast' });
      if (turn.followUp && turn.message.trim()) {
        talk.push(newMessage('interviewer', turn.message.trim()));
        return { data, complete: false };
      }
    }
    data.explaining = false;
    return this.moveOn(data);
  }

  /** After a problem is dealt with: end the round, show the next problem, or wait for it. */
  private moveOn(data: CodeData): ActResult<CodeData> {
    if (data.current + 1 >= data.problemCount) {
      data.complete = true;
      return { data, complete: true };
    }
    if (data.next) {
      this.advance(data);
      return { data, complete: false };
    }
    // The next problem is not written yet. Wait for it with the clock stopped.
    data.waitingForNext = true;
    return { data, complete: false, holdClock: true };
  }

  private async askAssistant(ctx: RoundContext, data: CodeData, message: string, code: string): Promise<ActResult<CodeData>> {
    if (!data.assistant) throw badRequest('This round has no AI assistant.');
    const problem = data.problems[data.current]!;
    const prompt = [
      `Problem: ${problem.title}\n${problem.statement}`,
      `\nThe candidate's current ${languageName(ctx.interview.stack)} code:\n${truncate(code, 12_000)}`,
      data.assistant.length > 0 ? `\nConversation so far:\n${formatTranscript(data.assistant)}` : '',
      `\nCANDIDATE: ${message}`,
    ].join('\n');
    const answer = await ctx.ask({
      system:
        'You are an AI coding assistant available to a candidate during a technical interview, like the assistant in an editor. Do what the candidate asks, as well as you can: explain, suggest, write or fix code. Be concise. Use plain text; put code on its own lines. Reply only with the structured output.',
      prompt,
      schema: assistantSchema,
      tier: 'strong',
    });
    data.drafts[data.current] = code;
    data.assistant.push(newMessage('candidate', message), newMessage('assistant', answer.reply));
    data.assistantProblem.push(data.current, data.current);
    return { data, complete: false };
  }

  private finalCode(data: CodeData, index: number): string | null {
    const code = data.submissions[index]?.code ?? data.drafts[index] ?? null;
    return code && code.trim() !== data.problems[index]!.starterCode.trim() ? code : null;
  }

  /** Works out the time and space complexity of what the candidate wrote, problem by problem. */
  private async analyseComplexity(ctx: RoundContext, data: CodeData) {
    const sections = data.problems.map((problem, index) =>
      [
        `PROBLEM ${index + 1}: ${problem.title}`,
        problem.statement,
        `Reference solution (time ${problem.timeComplexity ?? 'unknown'}, space ${problem.spaceComplexity ?? 'unknown'}):\n${problem.referenceSolution}`,
        `Candidate's code:\n${truncate(this.finalCode(data, index) ?? '(nothing written)', 12_000)}`,
      ].join('\n'),
    );
    const prompt = [
      `Analyse the efficiency of a candidate's code. ${describeInterview(ctx.interview)}`,
      `Return one entry per problem, in order (${data.problems.length} in total).`,
      "yourTime and yourSpace are the big-O time and extra-space complexity of the candidate's code as written, with the variables named. If nothing was written, say \"not written\".",
      'isOptimal is true only when the candidate matches the reference solution in both time and space, or beats it.',
      'note says, in one or two sentences addressed to the candidate as "you", what makes their code slower or heavier than it needs to be and what change would fix it; or, when it is optimal, that it is. Analyse the code as it is, even if it is incorrect.',
      '',
      sections.join('\n\n'),
    ].join('\n');
    const result = await ctx.ask({ prompt, schema: complexitySchema, tier: 'strong', timeoutMs: 180_000 });
    return result.problems;
  }

  async score(ctx: RoundContext, data: CodeData): Promise<RoundScore> {
    const name = roundTypeOf(this.variant).name;
    const coding = data.variant === 'coding';
    const sections = data.problems.map((problem, index) => {
      const submission = data.submissions[index];
      const result = submission
        ? `Submitted. Tests passed: ${submission.passed} of ${submission.total} (hidden edge cases: ${submission.hiddenPassed} of ${submission.hiddenTotal}).`
        : 'Not submitted before time ran out.';
      return [
        `PROBLEM ${index + 1}: ${problem.title}`,
        problem.statement,
        coding ? '' : `Buggy code the candidate was given:\n${problem.starterCode}`,
        `Best known solution: time ${problem.timeComplexity ?? 'unknown'}, space ${problem.spaceComplexity ?? 'unknown'}.`,
        `Times the candidate ran the tests: ${data.runs[index] ?? 0}. ${result}`,
        `Candidate's code:\n${truncate(this.finalCode(data, index) ?? '(nothing written)', 12_000)}`,
        `The candidate explaining this solution to the interviewer:\n${formatTranscript(data.explanations?.[index] ?? []) || '(no explanation was given)'}`,
        data.assistant ? `Their conversation with the AI assistant during this problem:\n${this.assistantTalk(data, index)}` : '',
        '',
      ].join('\n');
    });
    const competencies = coding
      ? ['Correctness', 'Problem solving', 'Time and space efficiency', 'Code quality', 'Explaining the solution', ...(data.assistant ? ['Working with the AI assistant'] : [])]
      : ['Diagnosis', 'Fix correctness', 'Code quality', 'Explaining the fix'];
    const material = [
      ...sections,
      `Problems planned: ${data.problemCount}. Problems reached: ${data.problems.length}.`,
      coding ? 'For "Time and space efficiency", compare the complexity of the candidate\'s code with the best known solution given for each problem.' : '',
      data.assistant ? 'The candidate had an AI assistant. Judge how well they directed it and checked its output.' : '',
    ].join('\n');

    const scored = await scoreWithRubric(ctx, { roundName: name, competencies, material });
    return { ...scored, review: [] };
  }

  /** Every problem with the candidate's solution analysed and the best solution beside it. */
  async answerSheet(ctx: RoundContext, data: CodeData): Promise<ReviewItem[]> {
    // Only coding is judged on efficiency; a debugging fix is right or wrong.
    const complexity = data.variant === 'coding' ? await this.analyseComplexity(ctx, data) : [];
    return data.problems.flatMap((problem, index) => this.problemEntries(data, index, complexity[index]));
  }

  /** Two entries per problem: what the candidate did, then the best solution to compare it with. */
  private problemEntries(data: CodeData, index: number, analysis?: z.infer<typeof complexitySchema>['problems'][number]): ReviewItem[] {
    const problem = data.problems[index]!;
    const submission = data.submissions[index];
    const written = this.finalCode(data, index);
    const bestEntry = {
      heading: `Problem ${index + 1}: ${problem.title} — ${data.variant === 'coding' ? 'best solution' : 'corrected code'}`,
      lines: [
        ...(problem.timeComplexity ? [`Best complexity: time ${problem.timeComplexity}, space ${problem.spaceComplexity}.`] : []),
        ...(problem.approach ? [`Approach: ${problem.approach}`] : []),
      ],
      code: problem.referenceSolution,
    };
    if (!written) {
      // Nothing to analyse: failed tests and complexity of an empty function would only be noise.
      return [{ heading: `Problem ${index + 1}: ${problem.title} — your solution`, lines: ['Result: you did not write a solution for this problem.'], code: null }, bestEntry];
    }
    const yours: string[] = [
      submission
        ? `Result: passed ${submission.passed} of ${submission.total} tests, including ${submission.hiddenPassed} of ${submission.hiddenTotal} hidden edge cases.`
        : 'Result: not submitted before the round ended.',
    ];
    for (const failure of submission?.failures ?? []) {
      yours.push(`Failed test: ${failure.name}. ${failure.call} should return ${failure.expected}, but gave ${failure.got}`);
    }
    const explained = (data.explanations?.[index] ?? []).filter((message) => message.from === 'candidate').map((message) => message.text);
    if (explained.length > 0) yours.push(`Your explanation: ${explained.join(' ')}`);
    if (analysis) {
      yours.push(`Your complexity: time ${analysis.yourTime}, space ${analysis.yourSpace}.`);
      yours.push(`${analysis.isOptimal ? 'Efficiency: optimal.' : 'Efficiency: a better solution exists.'} ${analysis.note}`);
    }
    return [{ heading: `Problem ${index + 1}: ${problem.title} — your solution`, lines: yours, code: written }, bestEntry];
  }

  private assistantTalk(data: CodeData, problemIndex: number): string {
    const messages = (data.assistant ?? []).filter((_, index) => data.assistantProblem[index] === problemIndex);
    return formatTranscript(messages) || '(the assistant was not used on this problem)';
  }

  asked(data: CodeData): string[] {
    return data.problems.map((problem) => problem.title);
  }
}
