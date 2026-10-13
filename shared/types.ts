// Contracts shared by the server and the web app. Types only: nothing here runs.

// ---------- Engines ----------

export type EngineId = 'claude' | 'codex';

export type EngineState = 'ready' | 'not_logged_in' | 'not_installed' | 'error';

export interface EngineStatus {
  id: EngineId;
  name: string;
  state: EngineState;
  version: string | null;
  /** Subscription the CLI is signed into, when it reports one. */
  plan: string | null;
  /** What went wrong, for the `error` state. */
  detail: string | null;
  /** What the user should do next, when the engine is not ready. */
  fix: string | null;
  /** False for engines written against documentation and never run end to end. */
  verified: boolean;
}

export interface SetupResponse {
  engines: EngineStatus[];
  /** True when at least one engine can run an interview. */
  ready: boolean;
}

// ---------- Catalog ----------

export type InterviewTypeId = 'karat' | 'ai' | 'custom';

export const ROUND_TYPE_IDS = [
  'intro',
  'mcq',
  'knowledge',
  'coding',
  'debugging',
  'code_review',
  'system_design',
  'ai_task',
  'behavioural',
] as const;
export type RoundTypeId = (typeof ROUND_TYPE_IDS)[number];

export const LEVELS = ['junior', 'mid', 'senior'] as const;
/** How experienced the candidate is. Sets how hard the questions are and the bar they are scored against. */
export type Level = (typeof LEVELS)[number];

export interface LevelOption {
  id: Level;
  name: string;
  summary: string;
}

export const CODE_LANGUAGES = ['javascript', 'typescript', 'python'] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export interface RoundPlan {
  type: RoundTypeId;
  minutes: number;
}

export interface InterviewType {
  id: InterviewTypeId;
  name: string;
  summary: string;
  /** Default rounds. Empty for Custom, where the user picks them. */
  rounds: RoundPlan[];
  /** False until the type can be started. */
  available: boolean;
}

export interface RoundType {
  id: RoundTypeId;
  name: string;
  summary: string;
  scored: boolean;
  defaultMinutes: number;
}

export interface StackPreset {
  id: string;
  name: string;
  topics: string[];
  language: CodeLanguage;
}

/** Limits the server enforces on a custom interview, so the form can show them. */
export interface CustomLimits {
  minRounds: number;
  maxRounds: number;
  minMinutes: number;
  maxMinutes: number;
  maxTotalMinutes: number;
}

export interface CatalogResponse {
  interviewTypes: InterviewType[];
  roundTypes: RoundType[];
  stacks: StackPreset[];
  levels: LevelOption[];
  limits: CustomLimits;
}

// ---------- Interviews ----------

export interface StackChoice {
  /** Preset id, or null for a stack the user typed. */
  id: string | null;
  name: string;
  topics: string[];
  language: CodeLanguage;
}

export type WorkspaceMode = 'browser' | 'own';

export interface InterviewOptions {
  /** Karat NextGen: an AI assistant is available in coding rounds. */
  nextGen: boolean;
  /** Karat: swap part of the hour for a system design round. */
  systemDesign: boolean;
  /**
   * AI-agent task: `browser` gives an editor and an AI assistant on the page;
   * `own` leaves the candidate in their own editor with their own coding agent.
   */
  workspace: WorkspaceMode;
}

export type RoundStatus = 'pending' | 'active' | 'paused' | 'done' | 'skipped';

export interface RoundState {
  index: number;
  type: RoundTypeId;
  minutes: number;
  status: RoundStatus;
  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  /** Time left when the round was paused by an engine failure. */
  pausedRemainingMs: number | null;
  /** Set while the clock is stopped because the interviewer is preparing something. */
  clockHeldAt: string | null;
}

export type InterviewStatus = 'in_progress' | 'finished';

export interface Interview {
  id: string;
  type: InterviewTypeId;
  name: string;
  stack: StackChoice;
  level: Level;
  engine: EngineId;
  options: InterviewOptions;
  rounds: RoundState[];
  status: InterviewStatus;
  createdAt: string;
  finishedAt: string | null;
  /** Mean round score from 1 to 5, once the report exists. */
  overall: number | null;
}

export interface CreateInterviewRequest {
  type: InterviewTypeId;
  stack: { presetId: string } | { name: string };
  /** Overrides the preset's language; required in effect for a typed stack. */
  language?: CodeLanguage;
  /** Defaults to mid-level. */
  level?: Level;
  engine: EngineId;
  options?: Partial<InterviewOptions>;
  /** Custom interviews only. */
  rounds?: RoundPlan[];
}

// ---------- Rounds as the candidate sees them ----------

export interface Message {
  id: string;
  from: 'interviewer' | 'candidate' | 'assistant';
  text: string;
  at: string;
}

export interface CodeArtifact {
  title: string;
  language: string;
  code: string;
}

export interface ConversationView {
  mode: 'conversation';
  transcript: Message[];
  /** Code under discussion, for code review rounds. */
  artifact: CodeArtifact | null;
  complete: boolean;
}

export interface McqQuestionView {
  id: string;
  prompt: string;
  options: string[];
  chosen: number | null;
}

export interface McqView {
  mode: 'mcq';
  questions: McqQuestionView[];
}

export interface TestCaseView {
  name: string;
  /** Arguments and expected value as JSON text. */
  args: string;
  expected: string;
}

export interface TestResultView {
  name: string;
  /** The call that was made and the value it should return, as text. */
  args: string;
  expected: string;
  passed: boolean;
  actual: string | null;
  error: string | null;
}

export interface RunView {
  results: TestResultView[];
  stdout: string;
  /** Set when the code could not run at all (syntax error, timeout). */
  error: string | null;
  /** Hidden tests passed and total; only after a problem is submitted. */
  hidden: { passed: number; total: number } | null;
}

export interface CodeView {
  mode: 'code';
  variant: 'coding' | 'debugging';
  language: CodeLanguage;
  problemIndex: number;
  problemCount: number;
  problem: {
    title: string;
    statement: string;
    functionName: string;
    starterCode: string;
    tests: TestCaseView[];
  };
  /** Code last sent to the server for this problem, or null if none yet. */
  code: string | null;
  lastRun: RunView | null;
  /** AI assistant transcript, or null when the round has no assistant. */
  assistant: Message[] | null;
  /**
   * The interviewer's questions about the problem just submitted, and the answers so far.
   * Null when the candidate is coding, not explaining.
   */
  discussion: Message[] | null;
  /** How the problem before this one went, once it has been submitted. */
  previous: { title: string; passed: number; total: number } | null;
  /** True after a submit while the next problem is still being written. The clock is stopped. */
  preparingNext: boolean;
  /** Why the next problem could not be written, if it failed. */
  nextError: string | null;
  complete: boolean;
}

export interface AiTaskView {
  mode: 'ai_task';
  title: string;
  brief: string;
  /** Folder to open in the editor and start the coding agent in. */
  workspace: string;
  transcript: Message[];
  phase: 'working' | 'closing' | 'complete';
  workspaceMode: WorkspaceMode;
  /** The built-in AI assistant's conversation. Empty in `own` mode. */
  assistant: Message[];
  /** True while the assistant is working on the last request. */
  assistantBusy: boolean;
  /** What the assistant has just done ("Edit src/feed.js"), newest last, while it works. */
  assistantSteps: string[];
  assistantError: string | null;
  /** The last run of the task's tests from the page. */
  lastTest: { passed: boolean; output: string } | null;
  activity: {
    sessionFound: boolean;
    prompts: number;
    toolCalls: number;
    filesChanged: number;
  };
}

export type RoundView = ConversationView | McqView | CodeView | AiTaskView;

export type RoundAction =
  | { kind: 'answer'; text: string }
  | { kind: 'choose'; questionId: string; choice: number }
  | { kind: 'run'; code: string }
  | { kind: 'submit_problem'; code: string }
  | { kind: 'retry_next' }
  | { kind: 'assistant'; message: string; code: string }
  | { kind: 'agent'; message: string }
  | { kind: 'save_file'; path: string; content: string }
  | { kind: 'run_tests' }
  | { kind: 'finish_work' }
  | { kind: 'poll' };

export interface InterviewView {
  interview: Interview;
  /** The round in play (active or paused), without anything the candidate must not see. */
  current: RoundView | null;
  /** Server clock, so the browser's timer does not depend on its own. */
  now: string;
}

export interface InterviewSummary {
  id: string;
  type: InterviewTypeId;
  name: string;
  stack: string;
  status: InterviewStatus;
  createdAt: string;
  overall: number | null;
}

/** A text file in an AI-agent task's workspace, by its path relative to the workspace. */
export interface WorkspaceFile {
  path: string;
  content: string;
}

// ---------- Report ----------

export interface CompetencyScore {
  name: string;
  /** 1 (no evidence) to 5 (exceptional). */
  score: number;
  reason: string;
  evidence: string;
}

/** Something to study after the interview: a model answer, an explanation, a reference solution. */
export interface ReviewItem {
  heading: string;
  lines: string[];
  code: string | null;
}

export interface RoundReport {
  index: number;
  type: RoundTypeId;
  name: string;
  status: 'scored' | 'unscored' | 'skipped' | 'error';
  score: number | null;
  competencies: CompetencyScore[];
  strengths: string[];
  gaps: string[];
  practice: string[];
  summary: string;
  review: ReviewItem[];
  /** True when this round's answer sheet has not been written yet; it is written when first opened. */
  answersPending: boolean;
  /** Why scoring failed, for the `error` status. */
  error: string | null;
}

export interface Report {
  interviewId: string;
  level: Level;
  overall: number | null;
  rounds: RoundReport[];
  /** False when a round could not be scored; finishing again retries those rounds. */
  complete: boolean;
  generatedAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
