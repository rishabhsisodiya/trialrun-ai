import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineStatus } from '../../shared/types.ts';
import { buildApp } from '../src/app.ts';
import type { Engine } from '../src/engines/engine.ts';
import { EngineRegistry } from '../src/engines/registry.ts';

function fakeEngine(id: 'claude' | 'codex', state: EngineStatus['state']): Engine {
  return {
    id,
    name: id,
    status: async () => ({ id, name: id, state, version: null, plan: null, detail: null, fix: null, verified: true }),
    ask: async () => {
      throw new Error('not used');
    },
  };
}

const local = { host: 'localhost:4477' };

test('setup is ready when any engine is ready', async () => {
  const app = await buildApp({
    engines: new EngineRegistry([fakeEngine('claude', 'ready'), fakeEngine('codex', 'not_installed')]),
  });
  const response = await app.inject({ url: '/api/setup', headers: local });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ready, true);
  assert.equal(response.json().engines.length, 2);
});

test('setup is not ready when no engine is', async () => {
  const app = await buildApp({ engines: new EngineRegistry([fakeEngine('claude', 'not_logged_in')]) });
  const response = await app.inject({ url: '/api/setup', headers: local });
  assert.equal(response.json().ready, false);
});

test('catalog lists the three interview types', async () => {
  const app = await buildApp({ engines: new EngineRegistry([]) });
  const response = await app.inject({ url: '/api/catalog', headers: local });
  const ids = response.json().interviewTypes.map((type: { id: string }) => type.id);
  assert.deepEqual(ids, ['karat', 'ai', 'custom']);
});

test('requests from another site are refused', async () => {
  const app = await buildApp({ engines: new EngineRegistry([]) });
  const response = await app.inject({ url: '/api/setup', headers: { host: 'evil.example' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'forbidden');
});

test('unknown endpoints answer with the error shape', async () => {
  const app = await buildApp({ engines: new EngineRegistry([]) });
  const response = await app.inject({ url: '/api/nope', headers: local });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'not_found');
});
