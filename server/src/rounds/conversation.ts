import { z } from 'zod';
import { EngineError } from '../engines/engine.ts';
import type { CodeArtifact, Message, ReviewItem, RoundAction, RoundTypeId, RoundView } from '../../../shared/types.ts';
import { roundTypeOf } from '../catalog.ts';
import {
  clamp,
  newMessage,
  unsupported,
  type ActResult,
  type RoundContext,
  type RoundHandler,
  type RoundScore,
} from './handler.ts';
import { avoidList, describeInterview, formatTranscript, languageName, scoreWithRubric } from './prompts.ts';

interface Question {
  topic: string;
  question: string;
  /** What a strong answer includes. Hidden until the report. */
  lookFor: string[];
  /** Index into the transcript where this question was asked. */
  askedAt: number | null;
}

export interface ConversationData {
  kind: RoundTypeId;
  questions: Question[];
  current: number;
  followUpsUsed: number;
  transcript: Message[];
  artifact: CodeArtifact | null;
  complete: boolean;
}

interface Prepared {
  questions: Omit<Question, 'askedAt'>[];
  artifact: CodeArtifact | null;
}

interface ConversationConfig {
  /** Follow-ups the interviewer may ask per question. */
  maxFollowUps(minutes: number): number;
  competencies: string[];
  prepare(ctx: RoundContext): Promise<Prepared>;
}

const questionListSchema = z.object({
  questions: z.array(z.object({ topic: z.string(), question: z.string(), lookFor: z.array(z.string()) })),
});

async function generateQuestions(ctx: RoundContext, count: number, brief: string): Promise<Prepared> {
  const prompt = [
    `Write ${count} interview questions. ${describeInterview(ctx.interview)}`,
    brief,
    'For each question give: topic (two or three words), question, and lookFor (two to four points a strong answer includes).',
    avoidList(ctx.alreadyAsked),
  ].join('\n');
  const result = await ctx.ask({ prompt, schema: questionListSchema, tier: 'fast' });
  const questions = result.questions.filter((question) => question.question.trim()).slice(0, count);
  if (questions.length === 0) throw new EngineError('bad_output', 'The engine returned no questions.');
  return { questions, artifact: null };
}

const codeReviewSchema = z.object({
  title: z.string(),
  code: z.string(),
  issues: z.array(z.string()),
});

const CONFIGS: Partial<Record<RoundTypeId, ConversationConfig>> = {
  intro: {
    maxFollowUps: () => 0,
    competencies: [],
    prepare: async (ctx) => ({
      questions: [
        {
          topic: 'Background',
          question: `Before we start, tell me briefly about your background and what you have been building recently with ${ctx.interview.stack.name}.`,
          lookFor: [],
        },
      ],
      artifact: null,
    }),
  },
  knowledge: {
    maxFollowUps: () => 1,
    competencies: ['Accuracy', 'Depth of understanding', 'Communication'],
    prepare: (ctx) =>
      generateQuestions(
        ctx,
        clamp(Math.round(ctx.round.minutes / 3), 2, 10),
        'These are rapid knowledge questions in the style of a Karat technical screen: each can be answered aloud in one to two minutes, tests understanding and practical trade-offs rather than trivia, and they rise in difficulty. Spread them across the stack.',
      ),
  },
  behavioural: {
    maxFollowUps: () => 1,
    competencies: ['Ownership', 'Collaboration', 'Structured answers', 'Self-awareness'],
    prepare: (ctx) =>
      generateQuestions(
        ctx,
        clamp(Math.round(ctx.round.minutes / 5), 1, 6),
        'These are behavioural questions for a software engineer ("Tell me about a time..."), covering ownership, conflict, failure and working with ambiguity. lookFor lists what a strong, specific answer in situation-task-action-result form includes.',
      ),
  },
  system_design: {
    maxFollowUps: (minutes) => clamp(Math.round(minutes / 3), 3, 8),
    competencies: ['Requirements and scoping', 'Architecture', 'Trade-offs', 'Communication'],
    prepare: (ctx) =>
      generateQuestions(
        ctx,
        1,
        `This is the single opening prompt of a ${ctx.round.minutes}-minute system design round: name a realistic system to design, relevant to the stack, with enough scale to force trade-offs. Ask the candidate to start with requirements. lookFor lists the areas a strong design covers.`,
      ),
  },
  code_review: {
    maxFollowUps: () => 2,
    competencies: ['Issue detection', 'Prioritisation', 'Feedback quality'],
    prepare: async (ctx) => {
      const language = languageName(ctx.interview.stack);
      const prompt = [
        `Write a code review exercise. ${describeInterview(ctx.interview)}`,
        `Produce 40 to 70 lines of realistic ${language} that a teammate might submit: it mostly works but contains four to six planted problems of mixed severity (for example a correctness bug, a security or data-safety issue, a performance problem, missing error handling, a readability issue).`,
        'Do not mark the problems with comments. title names the change. issues lists each planted problem in one sentence, most severe first.',
        avoidList(ctx.alreadyAsked),
      ].join('\n');
      const result = await ctx.ask({ prompt, schema: codeReviewSchema, tier: 'strong' });
      return {
        questions: [
          {
            topic: result.title,
            question:
              "Review this change as you would a teammate's pull request. Tell me what you would send back, most important first.",
            lookFor: result.issues,
          },
        ],
        artifact: { title: result.title, language: ctx.interview.stack.language, code: result.code },
      };
    },
  },
};

const turnSchema = z.object({ followUp: z.boolean(), message: z.string() });

const modelAnswerSchema = z.object({ answers: z.array(z.string()) });

const introFeedbackSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  practice: z.array(z.string()),
  strongerVersion: z.string(),
});

const MODEL_ANSWER_STYLE: Partial<Record<RoundTypeId, string>> = {
  knowledge: 'Each answer is what you would say aloud in one to two minutes: 80 to 150 words, the direct answer first, then the reasoning and one practical consequence.',
  behavioural:
    'Each answer shows the shape of a strong reply in situation, task, action, result form, using a short illustrative example, in 120 to 180 words. Say plainly that the example is illustrative and the candidate should use their own.',
  system_design:
    'The answer is a worked design in 250 to 350 words: clarified requirements and scale, the main components and data flow, the data model, and the two or three trade-offs that matter most with the choice you would make.',
  code_review:
    'The answer is the review a senior engineer would send back: each problem in the code, most severe first, with why it matters and how to fix it.',
};

/** Rounds that are a spoken exchange: the interviewer asks, the candidate answers, the interviewer may probe. */
export class ConversationHandler implements RoundHandler<ConversationData> {
  private readonly config: ConversationConfig;

  constructor(private readonly kind: RoundTypeId) {
    const config = CONFIGS[kind];
    if (!config) throw new Error(`${kind} is not a conversation round`);
    this.config = config;
  }

  async start(ctx: RoundContext): Promise<ConversationData> {
    const prepared = await this.config.prepare(ctx);
    const questions = prepared.questions.map((question) => ({ ...question, askedAt: null as number | null }));
    const first = questions[0]!;
    first.askedAt = 0;
    return {
      kind: this.kind,
      questions,
      current: 0,
      followUpsUsed: 0,
      transcript: [newMessage('interviewer', first.question)],
      artifact: prepared.artifact,
      complete: false,
    };
  }

  view(data: ConversationData): RoundView {
    return { mode: 'conversation', transcript: data.transcript, artifact: data.artifact, complete: data.complete };
  }

  async act(ctx: RoundContext, data: ConversationData, action: RoundAction): Promise<ActResult<ConversationData>> {
    if (action.kind !== 'answer') unsupported(action);
    if (data.complete) return { data, complete: true };

    const question = data.questions[data.current]!;
    data.transcript.push(newMessage('candidate', action.text));

    let acknowledgement = '';
    if (data.followUpsUsed < this.config.maxFollowUps(ctx.round.minutes)) {
      const turn = await this.decideTurn(ctx, data, question);
      if (turn.followUp) {
        data.followUpsUsed += 1;
        data.transcript.push(newMessage('interviewer', turn.message));
        return { data, complete: false };
      }
      acknowledgement = turn.message.trim();
    }

    data.current += 1;
    data.followUpsUsed = 0;
    const next = data.questions[data.current];
    if (!next) {
      data.complete = true;
      data.transcript.push(newMessage('interviewer', 'That is everything for this round. Thank you.'));
      return { data, complete: true };
    }
    next.askedAt = data.transcript.length;
    data.transcript.push(newMessage('interviewer', [acknowledgement, next.question].filter(Boolean).join(' ')));
    return { data, complete: false };
  }

  private decideTurn(ctx: RoundContext, data: ConversationData, question: Question) {
    const exchange = data.transcript.slice(question.askedAt ?? 0);
    const prompt = [
      `You are in the "${roundTypeOf(this.kind).name}" round. ${describeInterview(ctx.interview)}`,
      data.artifact ? `Code under discussion:\n${data.artifact.code}\n` : '',
      `Current question: ${question.question}`,
      `A strong answer includes: ${question.lookFor.join('; ') || 'a clear, specific answer'}.`,
      '',
      'Exchange so far:',
      formatTranscript(exchange),
      '',
      'Decide what to say next.',
      '- If the last answer is vague, incomplete, or wrong in a way worth exploring, or there is an important area not yet covered, set followUp to true and put ONE short follow-up question in message. Do not hint at the answer and do not say whether the answer was right.',
      '- Otherwise set followUp to false and put a neutral one-sentence acknowledgement in message, with no evaluation and no praise.',
    ].join('\n');
    return ctx.ask({ prompt, schema: turnSchema, tier: 'fast' });
  }

  /** The slice of the transcript that belongs to each question that was reached. */
  private exchanges(data: ConversationData): { question: Question; messages: Message[] }[] {
    const reached = data.questions.filter((question) => question.askedAt !== null);
    return reached.map((question, index) => ({
      question,
      messages: data.transcript.slice(question.askedAt ?? 0, reached[index + 1]?.askedAt ?? data.transcript.length),
    }));
  }

  /** One model answer per question reached, for the answer sheet. */
  private async modelAnswers(ctx: RoundContext, data: ConversationData, questions: Question[]): Promise<string[]> {
    const prompt = [
      `Write the answer sheet for the "${roundTypeOf(this.kind).name}" round of a mock interview. ${describeInterview(ctx.interview)}`,
      `Give one model answer per question, in order (${questions.length} in total): what a strong candidate would actually say.`,
      MODEL_ANSWER_STYLE[this.kind] ?? '',
      'Be accurate and specific. Plain text, no markdown.',
      data.artifact ? `\nCode under review:\n${data.artifact.code}` : '',
      '',
      ...questions.map((question, index) => `QUESTION ${index + 1}: ${question.question}\nPoints to cover: ${question.lookFor.join('; ')}`),
    ].join('\n');
    const result = await ctx.ask({ prompt, schema: modelAnswerSchema, tier: 'strong', timeoutMs: 180_000 });
    return result.answers;
  }

  async score(ctx: RoundContext, data: ConversationData): Promise<RoundScore> {
    const exchanges = this.exchanges(data);
    const material = [
      data.artifact ? `Code the candidate was asked to review:\n${data.artifact.code}\n` : '',
      ...exchanges.map(({ question, messages }, index) =>
        [
          `QUESTION ${index + 1} (${question.topic})`,
          `A strong answer includes: ${question.lookFor.join('; ')}`,
          formatTranscript(messages),
          '',
        ].join('\n'),
      ),
      `Questions planned: ${data.questions.length}. Questions reached before time ran out: ${exchanges.length}.`,
    ].join('\n');

    const scored = await scoreWithRubric(ctx, { roundName: roundTypeOf(this.kind).name, competencies: this.config.competencies, material });
    return { ...scored, review: [] };
  }

  /** Each question with what the candidate said, a model answer and the key points. */
  async answerSheet(ctx: RoundContext, data: ConversationData): Promise<ReviewItem[]> {
    const exchanges = this.exchanges(data);
    const answers = await this.modelAnswers(ctx, data, exchanges.map((exchange) => exchange.question));
    return exchanges.map(({ question, messages }, index) => {
      const said = messages.filter((message) => message.from === 'candidate').map((message) => message.text);
      return {
        heading: question.question,
        lines: [
          `Your answer: ${said.join(' ') || 'none given'}`,
          ...(answers[index] ? [`Model answer: ${answers[index]}`] : []),
          ...(question.lookFor.length > 0 ? [`Key points: ${question.lookFor.join('; ')}`] : []),
        ],
        code: null,
      };
    });
  }

  /** The introduction is a warm-up with no score, but how you introduce yourself can still be improved. */
  async feedback(ctx: RoundContext, data: ConversationData): Promise<RoundScore> {
    const none = { score: null, competencies: [] };
    const question = data.questions[0]!.question;
    const said = data.transcript.filter((message) => message.from === 'candidate').map((message) => message.text).join(' ').trim();
    if (!said) {
      return {
        ...none,
        strengths: [],
        gaps: ['You did not introduce yourself before the round ended.'],
        practice: ['Prepare a 60 to 90 second introduction: who you are, what you have built recently, and what you want next.'],
        summary: 'This warm-up is not scored. You did not give an introduction.',
        review: [],
      };
    }
    const prompt = [
      `Give feedback on a candidate's self-introduction at the start of a mock interview. ${describeInterview(ctx.interview)}`,
      `The interviewer asked: ${question}`,
      `The candidate said: ${said}`,
      '',
      'This round is not scored, so give no score. Address the candidate as "you".',
      '- summary: two sentences on how the introduction came across.',
      '- strengths: up to three things that worked.',
      '- improvements: up to three specific things to change, each tied to what they actually said (for example: no concrete project, no scale or outcome, too long, no link to the role).',
      '- practice: up to three concrete things to do before the next interview.',
      '- strongerVersion: their own introduction rewritten as it could be said aloud in 60 to 90 seconds. Use ONLY facts the candidate gave; never invent employers, projects, numbers or years. Where a detail is needed but was not given, put a placeholder in square brackets such as [name the project] or [the result].',
    ].join('\n');
    const result = await ctx.ask({ prompt, schema: introFeedbackSchema, tier: 'strong' });
    return {
      ...none,
      strengths: result.strengths.slice(0, 3),
      gaps: result.improvements.slice(0, 3),
      practice: result.practice.slice(0, 3),
      summary: `This warm-up is not scored. ${result.summary}`,
      review: [{ heading: question, lines: [`Your answer: ${said}`, `Stronger version: ${result.strongerVersion}`], code: null }],
    };
  }

  asked(data: ConversationData): string[] {
    return data.questions.filter((question) => question.askedAt !== null).map((question) => question.question);
  }
}
