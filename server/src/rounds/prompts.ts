import { z } from 'zod';
import type { Interview, Message, StackChoice } from '../../../shared/types.ts';
import { levelOf } from '../catalog.ts';
import { mean, type RoundContext, type RoundScore } from './handler.ts';

export const INTERVIEWER_PERSONA = [
  'You are a senior engineer running a mock technical interview.',
  'You are fair, specific and concise, and you never give away answers during the interview.',
  'Write plain text without markdown formatting.',
  'Reply only with the structured output.',
].join(' ');

const LANGUAGE_NAMES = { javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python' } as const;

export function languageName(stack: StackChoice): string {
  return LANGUAGE_NAMES[stack.language];
}

export function describeStack(stack: StackChoice): string {
  const topics = stack.topics.length > 0 ? ` (${stack.topics.join(', ')})` : '';
  return `Tech stack: ${stack.name}${topics}. Coding language: ${languageName(stack)}.`;
}

export function describeInterview(interview: Interview): string {
  const level = levelOf(interview);
  return `Interview format: ${interview.name}. ${describeStack(interview.stack)} Candidate level: ${level.name} (${level.summary}) Pitch everything at this level.`;
}

export function avoidList(alreadyAsked: string[]): string {
  if (alreadyAsked.length === 0) return '';
  const recent = alreadyAsked.slice(0, 40).map((item) => `- ${item}`).join('\n');
  return `\nThe candidate has already been asked these; do not repeat or closely paraphrase them:\n${recent}\n`;
}

export function formatTranscript(messages: Message[]): string {
  const names = { interviewer: 'INTERVIEWER', candidate: 'CANDIDATE', assistant: 'AI ASSISTANT' } as const;
  return messages.map((message) => `${names[message.from]}: ${message.text}`).join('\n');
}

const scoreSchema = z.object({
  competencies: z.array(
    z.object({
      name: z.string(),
      score: z.number().int().min(1).max(5),
      reason: z.string(),
      evidence: z.string(),
    }),
  ),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  practice: z.array(z.string()),
  summary: z.string(),
});

export interface RubricRequest {
  roundName: string;
  competencies: string[];
  /** Everything the candidate did in the round, plus what a strong performance looks like. */
  material: string;
}

/** Scores a round against named competencies. Shared by every round a model has to judge. */
export async function scoreWithRubric(ctx: RoundContext, request: RubricRequest): Promise<Omit<RoundScore, 'review'>> {
  const prompt = [
    `Score the "${request.roundName}" round of a mock interview. ${describeInterview(ctx.interview)}`,
    '',
    `Competencies to score, in this order: ${request.competencies.join('; ')}.`,
    '',
    'For each competency give:',
    `- score: 1 to 5, where 1 = no evidence or wrong, 2 = below the bar, 3 = meets the bar for a ${levelOf(ctx.interview).name.toLowerCase()} engineer, 4 = strong, 5 = exceptional.`,
    "- reason: one or two sentences explaining the score.",
    "- evidence: a short quote or close paraphrase of the candidate's own words or work. If there is none, say so and score 1.",
    '',
    'Be honest and calibrated. Do not inflate scores to be kind; this is practice and an accurate score is what helps.',
    'Judge only what is in the material. Work that was never reached because time ran out counts as not done.',
    'Then give up to three strengths, up to three gaps, up to three concrete things to practise next, and a two-sentence summary addressed to the candidate as "you".',
    '',
    '--- ROUND MATERIAL ---',
    request.material,
  ].join('\n');

  const result = await ctx.ask({ prompt, schema: scoreSchema, tier: 'strong', timeoutMs: 180_000 });
  const competencies = result.competencies.slice(0, request.competencies.length + 1);
  return {
    score: mean(competencies.map((competency) => competency.score)),
    competencies,
    strengths: result.strengths.slice(0, 3),
    gaps: result.gaps.slice(0, 3),
    practice: result.practice.slice(0, 3),
    summary: result.summary,
  };
}
