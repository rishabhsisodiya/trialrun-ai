// Makes one real call on the signed-in Claude plan. Run with `npm run test:live`.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { ClaudeEngine } from '../../src/engines/claude.ts';

test('Claude Code returns a validated structured answer', async () => {
  const engine = new ClaudeEngine(await mkdtemp(path.join(os.tmpdir(), 'trialrun-live-')));
  const answer = await engine.ask({
    system: 'You write interview questions. Reply only with the structured output.',
    prompt: 'Two short knowledge questions for a Node.js backend interview.',
    schema: z.object({ questions: z.array(z.object({ topic: z.string(), question: z.string() })).length(2) }),
    tier: 'fast',
  });
  assert.equal(answer.questions.length, 2);
  console.log(answer.questions);
});
