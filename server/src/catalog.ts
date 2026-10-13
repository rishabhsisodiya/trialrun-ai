import type {
  CatalogResponse,
  Interview,
  Level,
  LevelOption,
  CustomLimits,
  InterviewType,
  RoundType,
  RoundTypeId,
  StackPreset,
} from '../../shared/types.ts';

const roundTypes: RoundType[] = [
  { id: 'intro', name: 'Introduction', summary: 'A short warm-up about your background.', scored: false, defaultMinutes: 5 },
  { id: 'mcq', name: 'Technical MCQ', summary: 'Multiple-choice questions on your stack.', scored: true, defaultMinutes: 10 },
  { id: 'knowledge', name: 'Knowledge discussion', summary: 'Rapid questions answered in your own words, with follow-ups.', scored: true, defaultMinutes: 15 },
  { id: 'coding', name: 'Coding', summary: 'Progressive problems in an editor with tests.', scored: true, defaultMinutes: 40 },
  { id: 'debugging', name: 'Debugging', summary: 'Find and fix the fault in code that almost works.', scored: true, defaultMinutes: 20 },
  { id: 'code_review', name: 'Code review', summary: 'Review a change and say what you would send back.', scored: true, defaultMinutes: 15 },
  { id: 'system_design', name: 'System design', summary: 'Design a system and defend the trade-offs.', scored: true, defaultMinutes: 25 },
  { id: 'ai_task', name: 'AI-agent task', summary: 'Solve a task in a real repo with your own coding agent.', scored: true, defaultMinutes: 45 },
  { id: 'behavioural', name: 'Behavioural', summary: 'Situational questions about how you work.', scored: true, defaultMinutes: 15 },
];

const interviewTypes: InterviewType[] = [
  {
    id: 'karat',
    name: 'Karat interview',
    summary: 'A hard 60 minutes: quick intro, rapid knowledge questions, then progressive coding problems.',
    rounds: [
      { type: 'intro', minutes: 5 },
      { type: 'knowledge', minutes: 15 },
      { type: 'coding', minutes: 40 },
    ],
    available: true,
  },
  {
    id: 'ai',
    name: 'AI interview',
    summary: 'One task in a real repo, solved with your own coding agent while the interviewer questions your decisions.',
    rounds: [{ type: 'ai_task', minutes: 45 }],
    available: true,
  },
  {
    id: 'custom',
    name: 'Custom interview',
    summary: 'Pick the rounds, their order and the time for each.',
    rounds: [],
    available: true,
  },
];

const stacks: StackPreset[] = [
  { id: 'mern', name: 'MERN full stack', topics: ['JavaScript', 'React', 'Node.js', 'Express', 'MongoDB'], language: 'javascript' },
  { id: 'react', name: 'React frontend', topics: ['JavaScript', 'TypeScript', 'React', 'Browser APIs', 'CSS'], language: 'typescript' },
  { id: 'node', name: 'Node.js backend', topics: ['JavaScript', 'Node.js', 'REST APIs', 'SQL', 'Caching'], language: 'javascript' },
  { id: 'python-backend', name: 'Python backend', topics: ['Python', 'FastAPI', 'Django', 'SQL', 'Async'], language: 'python' },
  { id: 'python-ai', name: 'Python AI engineering', topics: ['Python', 'LLMs', 'RAG', 'Agents', 'Evals'], language: 'python' },
];

const levels: LevelOption[] = [
  { id: 'junior', name: 'Junior', summary: '0 to 2 years. Fundamentals and clear thinking; easy problems.' },
  { id: 'mid', name: 'Mid-level', summary: '2 to 5 years. Practical depth and trade-offs; easy-medium to medium problems.' },
  { id: 'senior', name: 'Senior', summary: '5+ years. Depth, scale, edge cases and trade-offs; medium to hard problems.' },
];

export const CUSTOM_LIMITS: CustomLimits = {
  minRounds: 1,
  maxRounds: 8,
  minMinutes: 5,
  maxMinutes: 90,
  maxTotalMinutes: 180,
};

export const catalog: CatalogResponse = { interviewTypes, roundTypes, stacks, levels, limits: CUSTOM_LIMITS };

export const DEFAULT_LEVEL: Level = 'mid';

/** The interview's level. Interviews saved before levels existed are mid-level. */
export function levelOf(interview: Interview): LevelOption {
  return levels.find((level) => level.id === (interview.level ?? DEFAULT_LEVEL))!;
}

const roundTypeById = new Map(roundTypes.map((round) => [round.id, round]));

export function roundTypeOf(id: RoundTypeId): RoundType {
  // Every id in the union has an entry above.
  return roundTypeById.get(id)!;
}

export function interviewTypeName(id: InterviewType['id']): string {
  return interviewTypes.find((type) => type.id === id)!.name;
}

export function stackPreset(id: string): StackPreset | undefined {
  return stacks.find((stack) => stack.id === id);
}
