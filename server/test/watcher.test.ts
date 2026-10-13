import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { claudeProjectDir, diffWorkspace, formatActivity, parseClaudeSession } from '../src/watcher/sessionWatcher.ts';

const line = (record: object) => JSON.stringify(record);

test('reads the prompts and tool calls out of a Claude Code session', () => {
  const session = [
    line({ type: 'user', timestamp: '2026-01-01T10:00:05.000Z', message: { content: 'Add pagination to the feed' } }),
    line({ type: 'user', timestamp: '2026-01-01T10:00:06.000Z', message: { content: '<command-name>/clear</command-name>' } }),
    line({ type: 'user', timestamp: '2026-01-01T10:00:07.000Z', isMeta: true, message: { content: 'injected' } }),
    line({
      type: 'assistant',
      timestamp: '2026-01-01T10:00:20.000Z',
      message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Edit', input: { file_path: 'src/feed.js' } }] },
    }),
    line({ type: 'user', timestamp: '2026-01-01T10:00:21.000Z', message: { content: [{ type: 'tool_result', content: 'done' }] } }),
    '{"type":"assistant","timestamp":"2026-01-01T10:00:30.000Z","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}',
    '{"type":"user","timest',
  ].join('\n');

  const events = parseClaudeSession(session);
  assert.deepEqual(events.map((event) => `${event.kind}:${event.text}`), [
    'prompt:Add pagination to the feed',
    'tool:Edit src/feed.js',
    'tool:Bash npm test',
  ]);
  assert.equal(
    formatActivity(events, new Date('2026-01-01T10:00:00.000Z')),
    '[00:05] CANDIDATE: Add pagination to the feed\n[00:20] AGENT: Edit src/feed.js\n[00:30] AGENT: Bash npm test',
  );
});

test('names the Claude Code session folder the way Claude Code does', () => {
  assert.match(claudeProjectDir('/Users/me/.trialrun-ai/workspaces/2026-ab'), /projects\/-Users-me--trialrun-ai-workspaces-2026-ab$/);
});

test('diffs a workspace against its starting code, ignoring dependencies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trialrun-diff-'));
  const baseline = path.join(root, 'baseline');
  const workspace = path.join(root, 'workspace');
  for (const folder of [baseline, workspace]) await mkdir(path.join(folder, 'src'), { recursive: true });
  await writeFile(path.join(baseline, 'src', 'a.js'), 'one\n');
  await writeFile(path.join(workspace, 'src', 'a.js'), 'two\n');
  await writeFile(path.join(workspace, 'src', 'new.js'), 'added\n');
  await mkdir(path.join(workspace, 'node_modules'));
  await writeFile(path.join(workspace, 'node_modules', 'x.js'), 'ignored\n');

  const diff = await diffWorkspace(baseline, workspace);
  assert.equal(diff.filesChanged, 2);
  assert.match(diff.text, /-one\n\+two/);
  assert.equal(diff.text.includes('ignored'), false);
  assert.equal(diff.text.includes(root), false);

  assert.equal((await diffWorkspace(baseline, baseline)).filesChanged, 0);
});
