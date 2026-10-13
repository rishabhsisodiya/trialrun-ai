import { z } from 'zod';
import {
  CODE_LANGUAGES,
  LEVELS,
  ROUND_TYPE_IDS,
  type CodeLanguage,
  type InterviewOptions,
  type InterviewTypeId,
  type RoundPlan,
  type StackChoice,
} from '../../../shared/types.ts';
import { CUSTOM_LIMITS, stackPreset } from '../catalog.ts';
import { badRequest } from '../errors.ts';

const roundPlanSchema = z.object({
  type: z.enum(ROUND_TYPE_IDS),
  minutes: z.number().int().min(CUSTOM_LIMITS.minMinutes).max(CUSTOM_LIMITS.maxMinutes),
});

export const createInterviewSchema = z.object({
  type: z.enum(['karat', 'ai', 'custom']),
  stack: z.union([
    z.object({ presetId: z.string().max(40) }),
    z.object({ name: z.string().trim().min(2).max(100) }),
  ]),
  language: z.enum(CODE_LANGUAGES).optional(),
  level: z.enum(LEVELS).optional(),
  engine: z.enum(['claude', 'codex']),
  options: z
    .object({ nextGen: z.boolean(), systemDesign: z.boolean(), workspace: z.enum(['browser', 'own']) })
    .partial()
    .optional(),
  rounds: z.array(roundPlanSchema).min(CUSTOM_LIMITS.minRounds).max(CUSTOM_LIMITS.maxRounds).optional(),
});

export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;

export function resolveOptions(input: CreateInterviewInput, engineHasAgent: boolean): InterviewOptions {
  return {
    nextGen: input.options?.nextGen ?? false,
    systemDesign: input.options?.systemDesign ?? false,
    workspace: engineHasAgent ? (input.options?.workspace ?? 'browser') : 'own',
  };
}

export function resolveStack(stack: CreateInterviewInput['stack'], language?: CodeLanguage): StackChoice {
  if ('presetId' in stack) {
    const preset = stackPreset(stack.presetId);
    if (!preset) throw badRequest(`Unknown stack "${stack.presetId}".`);
    return { id: preset.id, name: preset.name, topics: preset.topics, language: language ?? preset.language };
  }
  return { id: null, name: stack.name, topics: [], language: language ?? 'javascript' };
}

/** Karat is always one hour; system design takes its time from the other rounds. */
function karatRounds(options: InterviewOptions): RoundPlan[] {
  if (!options.systemDesign) {
    return [
      { type: 'intro', minutes: 5 },
      { type: 'knowledge', minutes: 15 },
      { type: 'coding', minutes: 40 },
    ];
  }
  return [
    { type: 'intro', minutes: 5 },
    { type: 'knowledge', minutes: 10 },
    { type: 'system_design', minutes: 20 },
    { type: 'coding', minutes: 25 },
  ];
}

export function planRounds(type: InterviewTypeId, options: InterviewOptions, custom?: RoundPlan[]): RoundPlan[] {
  if (type === 'karat') return karatRounds(options);
  if (type === 'ai') return [{ type: 'ai_task', minutes: 45 }];

  if (!custom || custom.length === 0) throw badRequest('A custom interview needs at least one round.');
  const total = custom.reduce((sum, round) => sum + round.minutes, 0);
  if (total > CUSTOM_LIMITS.maxTotalMinutes) {
    throw badRequest(`A custom interview can be at most ${CUSTOM_LIMITS.maxTotalMinutes} minutes; this one is ${total}.`);
  }
  // Each AI-agent task needs its own workspace; one per interview keeps that simple.
  if (custom.filter((round) => round.type === 'ai_task').length > 1) {
    throw badRequest('A custom interview can have one AI-agent task.');
  }
  return custom;
}
