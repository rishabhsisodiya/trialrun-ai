import { z } from 'zod';
import { EngineError } from '../engines/engine.ts';
import type { RoundAction, RoundView } from '../../../shared/types.ts';
import { badRequest } from '../errors.ts';
import { clamp, unsupported, type ActResult, type RoundContext, type RoundHandler, type RoundScore } from './handler.ts';
import { avoidList, describeInterview } from './prompts.ts';

const OPTION_COUNT = 4;

interface McqQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: string[];
  /** Index of the correct option. Hidden until the report. */
  answer: number;
  explanation: string;
  chosen: number | null;
}

export interface McqData {
  questions: McqQuestion[];
}

const mcqSchema = z.object({
  questions: z.array(
    z.object({
      topic: z.string(),
      prompt: z.string(),
      options: z.array(z.string()),
      answer: z.number().int(),
      explanation: z.string(),
    }),
  ),
});

export class McqHandler implements RoundHandler<McqData> {
  async start(ctx: RoundContext): Promise<McqData> {
    const count = clamp(Math.round(ctx.round.minutes / 1.5), 3, 20);
    const prompt = [
      `Write ${count} multiple-choice questions. ${describeInterview(ctx.interview)}`,
      `Each has exactly ${OPTION_COUNT} options with exactly one correct. Test understanding and the ability to predict behaviour, not memorised trivia; include short code snippets where useful.`,
      'Wrong options must be plausible. Vary which position is correct. answer is the zero-based index of the correct option. explanation says why it is right and why the tempting wrong option is wrong.',
      'Double-check every answer by working it through before you write it.',
      avoidList(ctx.alreadyAsked),
    ].join('\n');
    const result = await ctx.ask({ prompt, schema: mcqSchema, tier: 'strong', timeoutMs: 180_000 });
    const questions = result.questions
      .filter((question) => question.options.length === OPTION_COUNT && question.answer >= 0 && question.answer < OPTION_COUNT)
      .slice(0, count)
      .map((question, index) => ({ ...question, id: `q${index + 1}`, chosen: null }));
    if (questions.length === 0) throw new EngineError('bad_output', 'The engine returned no usable questions.');
    return { questions };
  }

  view(data: McqData): RoundView {
    return {
      mode: 'mcq',
      questions: data.questions.map(({ id, prompt, options, chosen }) => ({ id, prompt, options, chosen })),
    };
  }

  async act(_ctx: RoundContext, data: McqData, action: RoundAction): Promise<ActResult<McqData>> {
    if (action.kind !== 'choose') unsupported(action);
    const question = data.questions.find((candidate) => candidate.id === action.questionId);
    if (!question) throw badRequest('No such question.');
    if (action.choice < 0 || action.choice >= question.options.length) throw badRequest('No such option.');
    question.chosen = action.choice;
    return { data, complete: false };
  }

  /** Right or wrong is a fact here, so no model is asked. */
  async score(_ctx: RoundContext, data: McqData): Promise<RoundScore> {
    const total = data.questions.length;
    const correct = data.questions.filter((question) => question.chosen === question.answer);
    const wrong = data.questions.filter((question) => question.chosen !== question.answer);
    const score = Math.round((1 + (4 * correct.length) / total) * 10) / 10;
    const topicsOf = (questions: McqQuestion[]) => [...new Set(questions.map((question) => question.topic))].slice(0, 3);
    return {
      score,
      competencies: [
        {
          name: 'Accuracy',
          score: Math.round(score),
          reason: `${correct.length} of ${total} answered correctly.`,
          evidence: `${data.questions.filter((question) => question.chosen === null).length} left unanswered.`,
        },
      ],
      strengths: topicsOf(correct).map((topic) => `Correct on ${topic}`),
      gaps: topicsOf(wrong).map((topic) => `Missed a question on ${topic}`),
      practice: topicsOf(wrong).map((topic) => `Revise ${topic}`),
      summary: `You answered ${correct.length} of ${total} questions correctly.`,
      review: data.questions.map((question) => ({
        heading: question.prompt,
        lines: [
          `Your answer: ${question.chosen === null ? 'none' : question.options[question.chosen]}`,
          `Correct answer: ${question.options[question.answer]}`,
          question.explanation,
        ],
        code: null,
      })),
    };
  }

  asked(data: McqData): string[] {
    return data.questions.map((question) => question.prompt.slice(0, 160));
  }
}
