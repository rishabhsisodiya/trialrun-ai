import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { parseClaudeResult } from '../src/engines/claude.ts';
import { answerSchemaJson, EngineError } from '../src/engines/engine.ts';

const schema = z.object({ question: z.string() });

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  return 'no error';
}

test('returns the structured answer', () => {
  const stdout = JSON.stringify({ is_error: false, result: '{}', structured_output: { question: 'Why?' } });
  assert.deepEqual(parseClaudeResult(stdout, schema), { question: 'Why?' });
});

test('reports an engine failure with its message', () => {
  const stdout = JSON.stringify({ is_error: true, result: 'Usage limit reached' });
  assert.throws(() => parseClaudeResult(stdout, schema), /Usage limit reached/);
  assert.equal(codeOf(() => parseClaudeResult(stdout, schema)), 'failed');
});

test('rejects output that is not the requested shape', () => {
  const wrongShape = JSON.stringify({ is_error: false, structured_output: { question: 7 } });
  const missing = JSON.stringify({ is_error: false, result: 'plain text' });
  assert.equal(codeOf(() => parseClaudeResult(wrongShape, schema)), 'bad_output');
  assert.equal(codeOf(() => parseClaudeResult(missing, schema)), 'bad_output');
  assert.equal(codeOf(() => parseClaudeResult('not json', schema)), 'bad_output');
});

test('answer schema omits the marker Claude Code rejects', () => {
  const json = JSON.parse(answerSchemaJson(schema));
  assert.equal('$schema' in json, false);
  assert.deepEqual(json.required, ['question']);
});
