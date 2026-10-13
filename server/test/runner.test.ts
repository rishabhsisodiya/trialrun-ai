import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runFunction, sameValue } from '../src/runner/codeRunner.ts';

const cases = [{ name: 'one', args: [2, 3] }];

test('runs a JavaScript function and reports what it returned', async () => {
  const outcome = await runFunction('javascript', 'function add(a, b) { console.log("hi"); return a + b; }', 'add', cases);
  assert.equal(outcome.error, null);
  assert.deepEqual(outcome.cases, [{ name: 'one', actual: 5, error: null }]);
  assert.match(outcome.stdout, /hi/);
});

test('runs TypeScript without a compiler', async () => {
  const outcome = await runFunction('typescript', 'function add(a: number, b: number): number { return a + b; }', 'add', cases);
  assert.deepEqual(outcome.cases[0], { name: 'one', actual: 5, error: null });
});

test('runs Python and turns tuples into JSON arrays', async () => {
  const outcome = await runFunction('python', 'def pair(a, b):\n    return (a, b)\n', 'pair', cases);
  assert.deepEqual(outcome.cases[0], { name: 'one', actual: [2, 3], error: null });
});

test('reports an exception per case, a missing function, and a syntax error', async () => {
  const thrown = await runFunction('javascript', 'function add() { throw new Error("boom"); }', 'add', cases);
  assert.equal(thrown.cases[0]?.error, 'boom');
  const missing = await runFunction('python', 'x = 1\n', 'add', cases);
  assert.match(missing.cases[0]?.error ?? '', /not defined/);
  const broken = await runFunction('javascript', 'function add( {', 'add', cases);
  assert.equal(broken.cases.length, 0);
  assert.ok(broken.error);
});

test('stops an infinite loop', async () => {
  const outcome = await runFunction('javascript', 'function add() { while (true) {} }', 'add', cases, 500);
  assert.match(outcome.error ?? '', /Timed out/);
});

test('refuses a function name that is not an identifier', async () => {
  await assert.rejects(runFunction('javascript', '', 'add; process.exit()', cases));
});

test('compares JSON data, forgiving float noise but not shape', () => {
  assert.equal(sameValue(0.1 + 0.2, 0.3), true);
  assert.equal(sameValue({ a: [1, 2] }, { a: [1, 2] }), true);
  assert.equal(sameValue([1, 2], [2, 1]), false);
  assert.equal(sameValue({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(sameValue(null, 0), false);
  assert.equal(sameValue([], {}), false);
});
