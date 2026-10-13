import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { EngineStatus } from '../../shared/types.ts';
import { EngineError, type AgentRequest, type AskRequest, type Engine } from '../src/engines/engine.ts';
import { EngineRegistry } from '../src/engines/registry.ts';
import { InterviewService } from '../src/interviews/service.ts';
import { createRoundHandlers } from '../src/rounds/registry.ts';
import { Store } from '../src/store.ts';
import { TaskLibrary } from '../src/tasks.ts';

const TWO_SUM = {
  title: 'Add two numbers',
  statement: 'Return the sum of a and b.',
  functionName: 'add',
  starterCode: 'function add(a, b) {\n}\n',
  referenceSolution: 'function add(a, b) {\n  return a + b;\n}\n',
  approach: 'Add them.',
  timeComplexity: 'O(1)',
  spaceComplexity: 'O(1)',
  tests: [
    { name: 'small', argsJson: '[1, 2]', expectedJson: '3', hidden: false },
    { name: 'zero', argsJson: '[0, 0]', expectedJson: '0', hidden: false },
    { name: 'negative', argsJson: '[-4, 1]', expectedJson: '-3', hidden: true },
    { name: 'large', argsJson: '[1000, 2000]', expectedJson: '3000', hidden: true },
  ],
};

/** Canned replies, chosen by what the prompt asks for. Each is checked against the real schema. */
function cannedReply(prompt: string): unknown {
  if (prompt.startsWith('Score the')) {
    return {
      competencies: [{ name: 'Accuracy', score: 4, reason: 'Mostly right.', evidence: 'The candidate said so.' }],
      strengths: ['Clear'],
      gaps: ['Shallow'],
      practice: ['Read more'],
      summary: 'You did fine.',
    };
  }
  if (prompt.includes('finished the AI-agent task')) return { questions: ['How does it work?', 'What would you check?', 'extra'] };
  if (prompt.includes('Decide whether to interrupt')) return { ask: true, question: 'Why that prompt?' };
  if (prompt.startsWith('Analyse the efficiency')) {
    const count = Number(/\((\d+) in total\)/.exec(prompt)?.[1] ?? 1);
    return { problems: Array.from({ length: count }, () => ({ yourTime: 'O(n^2)', yourSpace: 'O(1)', isOptimal: false, note: 'You loop twice.' })) };
  }
  if (prompt.startsWith('Write the answer sheet')) {
    const count = Number(/\((\d+) in total\)/.exec(prompt)?.[1] ?? 1);
    return { answers: Array.from({ length: count }, (_, index) => `Model answer ${index + 1}.`) };
  }
  if (prompt.startsWith("Give feedback on a candidate's self-introduction")) {
    return { summary: 'Short but clear.', strengths: ['Direct'], improvements: ['No concrete project'], practice: ['Rehearse it'], strongerVersion: 'I build APIs at [company].' };
  }
  if (prompt.includes('is explaining it')) {
    return { followUp: prompt.includes('CANDIDATE: vague') && !prompt.includes('CANDIDATE: clear'), message: 'And the complexity?' };
  }
  if (prompt.includes('multiple-choice')) {
    return {
      questions: [
        { topic: 'Types', prompt: 'typeof null?', options: ['null', 'object', 'undefined', 'number'], answer: 1, explanation: 'Historic quirk.' },
        { topic: 'Scope', prompt: 'let is?', options: ['block', 'function', 'global', 'module'], answer: 0, explanation: 'Block scoped.' },
        { topic: 'Broken', prompt: 'bad', options: ['only one'], answer: 0, explanation: 'Dropped: wrong option count.' },
      ],
    };
  }
  if (prompt.startsWith('Write coding problem') || prompt.startsWith('Write debugging exercise')) return TWO_SUM;
  if (prompt.includes('interview questions')) {
    return {
      questions: Array.from({ length: 10 }, (_, index) => ({
        topic: `Topic ${index + 1}`,
        question: `Question ${index + 1}?`,
        lookFor: [`secret point ${index + 1}`],
      })),
    };
  }
  if (prompt.includes('Decide what to say next')) {
    return { followUp: !prompt.includes('CANDIDATE: enough'), message: 'Can you go deeper?' };
  }
  if (prompt.includes('CANDIDATE:')) return { reply: 'Try a loop.' };
  throw new Error(`No canned reply for prompt: ${prompt.slice(0, 80)}`);
}

export class FakeEngine implements Engine {
  readonly id = 'claude' as const;
  readonly name = 'Fake';
  prompts: string[] = [];
  /** When set, the next call fails the way a plan limit does. */
  failNext = false;
  /** How many of the next problem-writing calls fail, leaving every other call alone. */
  failProblemWrites = 0;
  /** When set, problem writing waits for `release()`, as a slow model would. */
  holdProblems = false;
  private waiting: (() => void)[] = [];

  release(): void {
    this.holdProblems = false;
    for (const resume of this.waiting.splice(0)) resume();
  }
  state: EngineStatus['state'] = 'ready';

  async status(): Promise<EngineStatus> {
    return { id: this.id, name: this.name, state: this.state, version: '0', plan: null, detail: null, fix: 'Sign in.', verified: true };
  }

  agentRequests: AgentRequest[] = [];
  failAgent = false;

  async agent(request: AgentRequest): Promise<string> {
    this.agentRequests.push(request);
    if (this.failAgent) {
      this.failAgent = false;
      throw new EngineError('failed', 'Usage limit reached');
    }
    return `Done: ${request.prompt}`;
  }

  async ask<T>(request: AskRequest<T>): Promise<T> {
    this.prompts.push(request.prompt);
    if (this.holdProblems && request.prompt.startsWith('Write coding problem')) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    if (this.failProblemWrites > 0 && request.prompt.startsWith('Write coding problem')) {
      this.failProblemWrites -= 1;
      throw new EngineError('failed', 'Usage limit reached');
    }
    if (this.failNext) {
      this.failNext = false;
      throw new EngineError('failed', 'Usage limit reached');
    }
    return request.schema.parse(cannedReply(request.prompt));
  }
}

export async function createHarness() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'trialrun-test-'));
  const store = new Store(dataDir);
  await store.init();
  const engine = new FakeEngine();
  const service = new InterviewService(store, new EngineRegistry([engine]), createRoundHandlers(new TaskLibrary()));
  return { store, engine, service, dataDir };
}
