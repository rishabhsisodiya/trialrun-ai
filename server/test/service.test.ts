import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import type { AiTaskView, CodeView, ConversationView, McqView } from '../../shared/types.ts';
import { HttpError } from '../src/errors.ts';
import { createInterviewSchema } from '../src/interviews/plan.ts';
import { TaskLibrary } from '../src/tasks.ts';
import { createHarness } from './helpers.ts';

const karat = createInterviewSchema.parse({ type: 'karat', stack: { presetId: 'node' }, engine: 'claude' });

/** Submits a problem and gives the interviewer a clear explanation, so the round moves on. */
async function solve(service: Awaited<ReturnType<typeof createHarness>>['service'], id: string, code: string, round = 2) {
  await service.act(id, round, { kind: 'submit_problem', code });
  return service.act(id, round, { kind: 'answer', text: 'clear' });
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof HttpError) return error.code;
    throw error;
  }
  return 'no error';
}

test('a Karat interview runs intro, knowledge and coding, then produces a report', async () => {
  const { service, engine } = await createHarness();
  const created = await service.create(karat);
  const id = created.interview.id;
  assert.deepEqual(created.interview.rounds.map((round) => `${round.type}:${round.minutes}`), ['intro:5', 'knowledge:15', 'coding:40']);

  // Intro: one canned question, no engine, ends after the answer.
  let view = await service.startRound(id, 0);
  assert.equal((view.current as ConversationView).transcript.length, 1);
  view = await service.act(id, 0, { kind: 'answer', text: 'I build APIs.' });
  assert.equal(view.interview.rounds[0]?.status, 'done');

  // Knowledge: a vague answer earns one follow-up, then the next question.
  view = await service.startRound(id, 1);
  assert.equal(JSON.stringify(view).includes('secret point'), false, 'model answers must not reach the candidate');
  view = await service.act(id, 1, { kind: 'answer', text: 'It depends.' });
  assert.equal((view.current as ConversationView).transcript.at(-1)?.text, 'Can you go deeper?');
  view = await service.act(id, 1, { kind: 'answer', text: 'More detail.' });
  assert.match((view.current as ConversationView).transcript.at(-1)?.text ?? '', /Question 2\?/);
  view = await service.submitRound(id, 1);
  assert.equal(view.interview.rounds[1]?.status, 'done');

  // Coding: hidden tests and the reference solution stay on the server.
  view = await service.startRound(id, 2);
  let code = view.current as CodeView;
  assert.equal(code.problemCount, 3);
  assert.deepEqual(code.problem.tests.map((test) => test.name), ['small', 'zero']);
  assert.equal(JSON.stringify(view).includes('return a + b'), false);

  view = await service.act(id, 2, { kind: 'run', code: 'function add(a, b) { return a - b; }' });
  code = view.current as CodeView;
  assert.deepEqual(code.lastRun?.results.map((result) => result.passed), [false, true]);

  assert.deepEqual(code.lastRun?.results[0], { name: 'small', args: 'add(1,2)', expected: '3', passed: false, actual: '-1', error: null });

  // The next problem was written while the candidate worked, so submitting moves on at once.
  await service.whenIdle();
  view = await solve(service, id, 'function add(a, b) { return a + b; }');
  code = view.current as CodeView;
  assert.equal(code.problemIndex, 1);
  assert.deepEqual(code.previous, { title: 'Add two numbers', passed: 4, total: 4 });
  view = await service.submitRound(id, 2);

  const scored = await service.finish(id);
  assert.deepEqual(scored.rounds.map((round) => round.answersPending), [false, true, true]);
  assert.deepEqual(scored.rounds.map((round) => round.review.length), [1, 0, 0], 'only the free answers exist after scoring');
  assert.equal(engine.prompts.some((prompt) => prompt.startsWith('Write the answer sheet') || prompt.startsWith('Analyse the efficiency')), false);
  assert.equal(scored.level, 'mid');

  // Opening the answer sheet is what writes it.
  const report = await service.answers(id);
  assert.deepEqual(report.rounds.map((round) => round.answersPending), [false, false, false]);
  const asks = engine.prompts.length;
  await service.answers(id);
  assert.equal(engine.prompts.length, asks, 'a written sheet is not written again');
  assert.equal(report.complete, true);
  assert.deepEqual(report.rounds.map((round) => round.status), ['unscored', 'scored', 'scored']);
  const intro = report.rounds[0]!;
  assert.equal(intro.score, null, 'the introduction gets advice, never a score');
  assert.deepEqual(intro.competencies, []);
  assert.deepEqual(intro.gaps, ['No concrete project']);
  assert.equal(intro.summary, 'This warm-up is not scored. Short but clear.');
  assert.deepEqual(intro.review[0]?.lines, ['Your answer: I build APIs.', 'Stronger version: I build APIs at [company].']);
  assert.equal(report.overall, 4);
  const knowledgeSheet = report.rounds[1]?.review[0]?.lines ?? [];
  assert.deepEqual(knowledgeSheet, ['Your answer: It depends. More detail.', 'Model answer: Model answer 1.', 'Key points: secret point 1']);
  const codingSheet = report.rounds[2]?.review ?? [];
  assert.match(codingSheet[0]?.heading ?? '', /your solution$/);
  assert.match(codingSheet[0]?.lines.join('\n') ?? '', /Your explanation: clear\n/);
  assert.match(codingSheet[0]?.lines.join('\n') ?? '', /Your complexity: time O\(n\^2\), space O\(1\)\.\nEfficiency: a better solution exists\. You loop twice\./);
  assert.match(codingSheet[1]?.lines[0] ?? '', /Best complexity: time O\(1\), space O\(1\)\./);
  assert.match(codingSheet[1]?.code ?? '', /return a \+ b/);
  assert.ok(report.rounds[2]?.competencies.length, 'coding is scored');
  assert.equal((await service.get(id)).interview.status, 'finished');
});

test('rounds must be taken in order and only one interview runs at a time', async () => {
  const { service } = await createHarness();
  const { interview } = await service.create(karat);
  assert.equal(await codeOf(service.startRound(interview.id, 1)), 'round_out_of_order');
  assert.equal(await codeOf(service.create(karat)), 'interview_in_progress');
  await service.delete(interview.id);
  assert.equal(await codeOf(service.get(interview.id)), 'not_found');
  await service.create(karat);
});

test('an engine that is not signed in cannot start an interview', async () => {
  const { service, engine } = await createHarness();
  engine.state = 'not_logged_in';
  assert.equal(await codeOf(service.create(karat)), 'engine_not_ready');
});

test('when time runs out the round locks and later answers are refused', async () => {
  const { service, store } = await createHarness();
  const { interview } = await service.create(karat);
  await service.startRound(interview.id, 0);
  const saved = (await store.loadInterview(interview.id))!;
  saved.rounds[0]!.endsAt = new Date(Date.now() - 1000).toISOString();
  await store.saveInterview(saved);

  assert.equal(await codeOf(service.act(interview.id, 0, { kind: 'answer', text: 'late' })), 'round_locked');
  const view = await service.get(interview.id);
  assert.equal(view.interview.rounds[0]?.status, 'done');
  assert.equal(view.current, null);
});

test('an engine failure pauses the clock, and resuming gives the time back', async () => {
  const { service, engine } = await createHarness();
  const { interview } = await service.create(karat);
  await service.startRound(interview.id, 0);
  await service.act(interview.id, 0, { kind: 'answer', text: 'hello' });
  await service.startRound(interview.id, 1);

  engine.failNext = true;
  assert.equal(await codeOf(service.act(interview.id, 1, { kind: 'answer', text: 'It depends.' })), 'engine_failed');
  let view = await service.get(interview.id);
  assert.equal(view.interview.rounds[1]?.status, 'paused');
  assert.equal((view.current as ConversationView).transcript.length, 1, 'the failed answer is not recorded');
  assert.equal(await codeOf(service.act(interview.id, 1, { kind: 'answer', text: 'again' })), 'round_paused');

  view = await service.resumeRound(interview.id, 1);
  const round = view.interview.rounds[1]!;
  assert.equal(round.status, 'active');
  assert.ok(Date.parse(round.endsAt!) - Date.now() > 14 * 60_000);
});

test('a round that fails to score is reported, and finishing again retries only that round', async () => {
  const { service, engine } = await createHarness();
  const { interview } = await service.create(karat);
  await service.startRound(interview.id, 0);
  await service.act(interview.id, 0, { kind: 'answer', text: 'hello' });
  await service.startRound(interview.id, 1);
  await service.submitRound(interview.id, 1);

  // One model call fails while scoring. The rounds are scored side by side, so which
  // of the two it hits is not fixed; what matters is that exactly one is lost and retried.
  engine.failNext = true;
  const first = await service.finish(interview.id);
  assert.equal(first.complete, false);
  assert.equal(first.rounds.filter((round) => round.status === 'error').length, 1);
  assert.equal(first.rounds[2]?.status, 'skipped');

  const asksBefore = engine.prompts.length;
  const second = await service.finish(interview.id);
  assert.equal(second.complete, true);
  assert.deepEqual(second.rounds.map((round) => round.status), ['unscored', 'scored', 'skipped']);
  assert.equal(second.overall, 4);
  assert.equal(engine.prompts.length, asksBefore + 1, 'only the failed round is asked about again');
});

test('a custom MCQ round hides the answers and is scored without a model', async () => {
  const { service, engine } = await createHarness();
  const custom = createInterviewSchema.parse({
    type: 'custom',
    stack: { name: 'Go services' },
    language: 'python',
    engine: 'claude',
    rounds: [{ type: 'mcq', minutes: 10 }],
  });
  const { interview } = await service.create(custom);
  assert.equal(interview.stack.language, 'python');

  let view = await service.startRound(interview.id, 0);
  const mcq = view.current as McqView;
  assert.equal(mcq.questions.length, 2, 'the question with the wrong number of options is dropped');
  assert.equal(JSON.stringify(view).includes('Historic quirk'), false);

  view = await service.act(interview.id, 0, { kind: 'choose', questionId: 'q1', choice: 1 });
  view = await service.act(interview.id, 0, { kind: 'choose', questionId: 'q2', choice: 3 });
  await service.submitRound(interview.id, 0);

  const promptsBefore = engine.prompts.length;
  const report = await service.finish(interview.id);
  assert.equal(engine.prompts.length, promptsBefore);
  assert.equal(report.rounds[0]?.score, 3);
  assert.match(report.rounds[0]?.review[0]?.lines.join(' ') ?? '', /Historic quirk/);
});

test('custom interviews are validated', () => {
  const base = { type: 'custom', stack: { presetId: 'node' }, engine: 'claude' };
  assert.equal(createInterviewSchema.safeParse({ ...base, rounds: [{ type: 'mcq', minutes: 2 }] }).success, false);
  assert.equal(createInterviewSchema.safeParse({ ...base, rounds: [{ type: 'nope', minutes: 10 }] }).success, false);
  assert.equal(createInterviewSchema.safeParse({ ...base, rounds: [] }).success, false);
  assert.equal(createInterviewSchema.safeParse({ ...base, stack: { name: 'x' } }).success, false);
});

test('an AI-agent task copies a repo, watches the workspace, and wraps up with two questions', async () => {
  const { service, store } = await createHarness();
  const ai = createInterviewSchema.parse({ type: 'ai', stack: { presetId: 'python-ai' }, engine: 'claude' });
  const { interview } = await service.create(ai);

  let view = await service.startRound(interview.id, 0);
  let task = view.current as AiTaskView;
  assert.equal(task.workspace, store.workspaceDir(interview.id));
  assert.match(await readFile(path.join(task.workspace, 'TASK.md'), 'utf8'), /^# Task/);
  // Whichever Python task was picked, its rubric must stay on the server.
  const picked = (await store.loadRound<{ taskId: string }>(interview.id, 0))!.taskId;
  const rubric = (await new TaskLibrary().get(picked))!.rubric;
  assert.ok(rubric.every((point) => !JSON.stringify(view).includes(point.slice(0, 40))), 'the rubric stays hidden');

  await writeFile(path.join(task.workspace, 'notes.py'), '# added\n');
  view = await service.act(interview.id, 0, { kind: 'poll' });
  task = view.current as AiTaskView;
  assert.deepEqual(task.activity, { sessionFound: false, prompts: 0, toolCalls: 0, filesChanged: 1 });
  assert.equal(task.transcript.length, 1, 'no check-in without agent activity');

  view = await service.act(interview.id, 0, { kind: 'finish_work' });
  task = view.current as AiTaskView;
  assert.equal(task.phase, 'closing');
  assert.equal(task.transcript.at(-1)?.text, 'How does it work?');
  view = await service.act(interview.id, 0, { kind: 'answer', text: 'Like this.' });
  assert.equal((view.current as AiTaskView).transcript.at(-1)?.text, 'What would you check?');
  view = await service.act(interview.id, 0, { kind: 'answer', text: 'The edge cases.' });
  assert.equal(view.interview.rounds[0]?.status, 'done');

  const report = await service.finish(interview.id);
  const headings = report.rounds[0]?.review.map((item) => item.heading);
  assert.deepEqual(headings, ['What a strong performance looks like', 'Task tests: failing']);
  assert.match(report.rounds[0]?.review[1]?.lines[0] ?? '', /No coding agent session/);
});

test('the AI assistant exists only in NextGen coding rounds and its use is tied to the problem', async () => {
  const { service, engine } = await createHarness();
  const nextGen = createInterviewSchema.parse({ ...karat, options: { nextGen: true } });
  const { interview } = await service.create(nextGen);
  await service.startRound(interview.id, 0);
  await service.act(interview.id, 0, { kind: 'answer', text: 'hello' });
  await service.startRound(interview.id, 1);
  await service.submitRound(interview.id, 1);
  let view = await service.startRound(interview.id, 2);
  assert.deepEqual((view.current as CodeView).assistant, []);

  view = await service.act(interview.id, 2, { kind: 'assistant', message: 'How do I start?', code: '' });
  assert.equal((view.current as CodeView).assistant?.at(-1)?.text, 'Try a loop.');
  await service.whenIdle();
  await solve(service, interview.id, 'function add(a, b) { return a + b; }');
  await service.submitRound(interview.id, 2);
  await service.finish(interview.id);

  const scoring = engine.prompts.filter((prompt) => prompt.startsWith('Score the "Coding"')).at(-1) ?? '';
  const [first, second] = scoring.split('PROBLEM 2');
  assert.match(first ?? '', /CANDIDATE: How do I start\?/);
  assert.match(second ?? '', /the assistant was not used on this problem/);
});

test('every task in the library is well formed and each language has more than one', async () => {
  const tasks = await new TaskLibrary().all();
  assert.equal(tasks.length, 4);
  for (const language of ['javascript', 'python']) {
    assert.ok(tasks.filter((task) => task.language === language).length >= 2, `${language} needs at least two tasks`);
  }
  for (const task of tasks) {
    assert.match(task.brief, /^# Task/);
    assert.ok(task.rubric.length >= 5);
  }
});

async function reachCoding(service: Awaited<ReturnType<typeof createHarness>>['service']) {
  const { interview } = await service.create(karat);
  await service.startRound(interview.id, 0);
  await service.act(interview.id, 0, { kind: 'answer', text: 'hello' });
  await service.startRound(interview.id, 1);
  await service.submitRound(interview.id, 1);
  await service.startRound(interview.id, 2);
  return interview.id;
}

const SOLVED = 'function add(a, b) { return a + b; }';

test('submitting before the next problem is ready waits with the clock stopped, and nothing is blocked', async () => {
  const { service, engine } = await createHarness();
  const first = await service.create(karat);
  await service.startRound(first.interview.id, 0);
  await service.act(first.interview.id, 0, { kind: 'answer', text: 'hello' });
  await service.startRound(first.interview.id, 1);
  await service.submitRound(first.interview.id, 1);
  const id = first.interview.id;
  await service.startRound(id, 2);
  await service.whenIdle();
  // Problem 2 is ready; problem 3 will be slow.
  engine.holdProblems = true;
  await solve(service, id, SOLVED);

  let view = await solve(service, id, 'function add(a, b) { return 0; }');
  let code = view.current as CodeView;
  assert.equal(code.preparingNext, true);
  assert.equal(code.problemIndex, 1, 'still showing the problem just submitted');
  assert.deepEqual(code.previous, { title: 'Add two numbers', passed: 1, total: 4 });
  const heldAt = view.interview.rounds[2]?.clockHeldAt;
  assert.ok(heldAt, 'the clock is stopped');
  const endsBefore = Date.parse(view.interview.rounds[2]!.endsAt!);

  // The interview stays responsive while the problem is being written.
  assert.equal(await codeOf(service.act(id, 2, { kind: 'run', code: SOLVED })), 'bad_request');
  assert.equal((await service.get(id)).interview.rounds[2]?.status, 'active');

  await new Promise((resolve) => setTimeout(resolve, 30));
  engine.release();
  await service.whenIdle();
  view = await service.get(id);
  code = view.current as CodeView;
  assert.equal(code.preparingNext, false);
  assert.equal(code.problemIndex, 2);
  assert.equal(view.interview.rounds[2]?.clockHeldAt, null);
  assert.ok(Date.parse(view.interview.rounds[2]!.endsAt!) >= endsBefore + 30, 'the wait is given back');
});

test('a round can be ended while the next problem is still being written', async () => {
  const { service, engine } = await createHarness();
  engine.holdProblems = false;
  const id = await reachCoding(service);
  await service.whenIdle();
  engine.holdProblems = true;
  await solve(service, id, SOLVED);
  await solve(service, id, SOLVED);

  const view = await service.submitRound(id, 2);
  assert.equal(view.interview.rounds[2]?.status, 'done');
  engine.release();
  await service.whenIdle();
  assert.equal((await service.get(id)).interview.rounds[2]?.status, 'done');
  const report = await service.finish(id);
  assert.equal(report.rounds[2]?.status, 'scored');
});

test('a held clock cannot run out, and a failed preparation can be retried', async () => {
  const { service, engine, store } = await createHarness();
  const id = await reachCoding(service);
  await service.whenIdle();

  // Writing problem 3 fails, as on a usage limit, while the candidate is on problem 2.
  engine.failProblemWrites = 1;
  await solve(service, id, SOLVED);
  await service.whenIdle();
  let view = await service.get(id);
  assert.equal((view.current as CodeView).nextError, null, 'not shown while the candidate is still working');

  // Finishing problem 2 tries again by itself; that attempt fails too, and now it is shown.
  engine.failProblemWrites = 1;
  await solve(service, id, SOLVED);
  await service.whenIdle();
  view = await service.get(id);
  assert.equal((view.current as CodeView).preparingNext, true);
  assert.equal((view.current as CodeView).nextError, 'Usage limit reached');

  const interview = (await store.loadInterview(id))!;
  interview.rounds[2]!.endsAt = new Date(Date.now() - 60_000).toISOString();
  await store.saveInterview(interview);
  assert.equal((await service.get(id)).interview.rounds[2]?.status, 'active', 'time does not pass while the clock is held');
  interview.rounds[2]!.endsAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await store.saveInterview(interview);

  await service.act(id, 2, { kind: 'retry_next' });
  await service.whenIdle();
  view = await service.get(id);
  assert.equal((view.current as CodeView).problemIndex, 2);
  assert.equal((view.current as CodeView).nextError, null);
  assert.equal(view.interview.rounds[2]?.clockHeldAt, null);
});

test('after a submit the interviewer asks for the approach, probes once, and only then moves on', async () => {
  const { service } = await createHarness();
  const id = await reachCoding(service);
  await service.whenIdle();

  let view = await service.act(id, 2, { kind: 'submit_problem', code: SOLVED });
  let code = view.current as CodeView;
  assert.equal(code.problemIndex, 0, 'still on the submitted problem');
  assert.match(code.discussion?.[0]?.text ?? '', /time and space complexity/);
  assert.equal(code.lastRun?.hidden?.total, 2, 'the submission result is shown while explaining');
  assert.equal(await codeOf(service.act(id, 2, { kind: 'run', code: SOLVED })), 'bad_request');

  view = await service.act(id, 2, { kind: 'answer', text: 'vague' });
  code = view.current as CodeView;
  assert.equal(code.discussion?.at(-1)?.text, 'And the complexity?');

  // One follow-up at most: the second answer always moves on.
  view = await service.act(id, 2, { kind: 'answer', text: 'vague again' });
  code = view.current as CodeView;
  assert.equal(code.problemIndex, 1);
  assert.equal(code.discussion, null);
});

test('an empty submission skips the explanation', async () => {
  const { service } = await createHarness();
  const id = await reachCoding(service);
  await service.whenIdle();
  const starter = ((await service.get(id)).current as CodeView).problem.starterCode;
  const view = await service.act(id, 2, { kind: 'submit_problem', code: starter });
  assert.equal((view.current as CodeView).problemIndex, 1);
  assert.equal((view.current as CodeView).discussion, null);
});

test('the level is carried into what the model is asked and how it scores', async () => {
  const { service, engine } = await createHarness();
  const senior = createInterviewSchema.parse({ ...karat, level: 'senior' });
  const { interview } = await service.create(senior);
  assert.equal(interview.level, 'senior');
  await service.startRound(interview.id, 0);
  await service.act(interview.id, 0, { kind: 'answer', text: 'hello' });
  await service.startRound(interview.id, 1);
  await service.submitRound(interview.id, 1);
  const report = await service.finish(interview.id);
  assert.equal(report.level, 'senior');
  const generation = engine.prompts.find((prompt) => prompt.includes('interview questions')) ?? '';
  assert.match(generation, /Candidate level: Senior/);
  const scoring = engine.prompts.find((prompt) => prompt.startsWith('Score the')) ?? '';
  assert.match(scoring, /3 = meets the bar for a senior engineer/);
  assert.equal(createInterviewSchema.safeParse({ ...karat, level: 'principal' }).success, false);
});

test('an answer sheet that fails to write stays pending and keeps what did get written', async () => {
  const { service, engine } = await createHarness();
  const id = await reachCoding(service);
  await service.whenIdle();
  await solve(service, id, SOLVED);
  await service.submitRound(id, 2);
  await service.finish(id);

  engine.failNext = true;
  assert.equal(await codeOf(service.answers(id)), 'answers_failed');
  const partial = await service.report(id);
  assert.equal(partial.rounds.filter((round) => round.answersPending).length, 1, 'one of the two sheets was written');

  const full = await service.answers(id);
  assert.equal(full.rounds.some((round) => round.answersPending), false);
});

test('in the browser workspace the candidate can use the assistant, edit files and run the tests', async () => {
  const { service, engine, store } = await createHarness();
  const ai = createInterviewSchema.parse({ type: 'ai', stack: { presetId: 'node' }, engine: 'claude' });
  const { interview } = await service.create(ai);
  assert.equal(interview.options.workspace, 'browser', 'the default when the engine can be confined');
  const id = interview.id;

  let view = await service.startRound(id, 0);
  let task = view.current as AiTaskView;
  assert.equal(task.workspaceMode, 'browser');
  const files = await service.workspaceFiles(id);
  assert.ok(files.includes('TASK.md') && files.includes('package.json'));
  assert.match((await service.workspaceFile(id, 'TASK.md')).content, /^# Task/);

  // The assistant works in the background: the request returns at once and the page stays usable.
  view = await service.act(id, 0, { kind: 'agent', message: 'Add pagination' });
  task = view.current as AiTaskView;
  assert.equal(task.assistantBusy, true);
  assert.equal(task.assistant.at(-1)?.text, 'Add pagination');
  await service.whenIdle();
  task = (await service.get(id)).current as AiTaskView;
  assert.equal(task.assistantBusy, false);
  assert.equal(task.assistant.at(-1)?.text, 'Done: Add pagination');
  assert.equal(engine.agentRequests[0]?.cwd, store.workspaceDir(id));
  assert.equal(engine.agentRequests[0]?.resume, false);
  assert.ok(engine.agentRequests[0]?.allowedCommands.includes('node --test'));

  await service.act(id, 0, { kind: 'agent', message: 'Again' });
  await service.whenIdle();
  assert.equal(engine.agentRequests[1]?.resume, true, 'later requests continue the same session');
  assert.equal(engine.agentRequests[1]?.sessionId, engine.agentRequests[0]?.sessionId);

  // A failure is shown, and the candidate can simply ask again.
  engine.failAgent = true;
  await service.act(id, 0, { kind: 'agent', message: 'Third' });
  await service.whenIdle();
  task = (await service.get(id)).current as AiTaskView;
  assert.equal(task.assistantError, 'Usage limit reached');
  assert.equal(task.assistantBusy, false);

  // Hand edits and test runs.
  await service.act(id, 0, { kind: 'save_file', path: 'src/notes.js', content: '// mine\n' });
  assert.equal((await service.workspaceFile(id, 'src/notes.js')).content, '// mine\n');
  for (const escape of ['../outside.js', '/etc/hosts', 'src/../../x.js', 'node_modules/x.js']) {
    assert.equal(await codeOf(service.act(id, 0, { kind: 'save_file', path: escape, content: 'x' })), 'bad_request', escape);
    assert.equal(await codeOf(service.workspaceFile(id, escape)), 'bad_request', escape);
  }
  view = await service.act(id, 0, { kind: 'run_tests' });
  task = view.current as AiTaskView;
  assert.equal(task.lastTest?.passed, false, 'the task ships with failing tests');
  assert.match(task.lastTest?.output ?? '', /✖ /, 'whichever task was picked, its failing tests are listed');
});

test('choosing your own editor, or an engine with no agent, leaves the round as before', async () => {
  const { service } = await createHarness();
  const own = createInterviewSchema.parse({ type: 'ai', stack: { presetId: 'node' }, engine: 'claude', options: { workspace: 'own' } });
  const { interview } = await service.create(own);
  const view = await service.startRound(interview.id, 0);
  assert.equal((view.current as AiTaskView).workspaceMode, 'own');
  assert.equal(await codeOf(service.act(interview.id, 0, { kind: 'agent', message: 'hi' })), 'bad_request');
  assert.equal(await codeOf(service.act(interview.id, 0, { kind: 'save_file', path: 'a.js', content: '' })), 'bad_request');
});
