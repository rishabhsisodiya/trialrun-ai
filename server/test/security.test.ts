import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalRequest } from '../src/security.ts';

test('accepts requests addressed to this machine', () => {
  assert.equal(isLocalRequest({ host: 'localhost:4477' }), true);
  assert.equal(isLocalRequest({ host: '127.0.0.1:4477' }), true);
  assert.equal(isLocalRequest({ host: '[::1]:4477' }), true);
  assert.equal(isLocalRequest({ host: 'localhost:4477', origin: 'http://localhost:5173' }), true);
});

test('rejects a rebound host name', () => {
  assert.equal(isLocalRequest({ host: 'evil.example:4477' }), false);
  assert.equal(isLocalRequest({ host: 'localhost.evil.example' }), false);
  assert.equal(isLocalRequest({}), false);
});

test('rejects a request sent by another website', () => {
  assert.equal(isLocalRequest({ host: 'localhost:4477', origin: 'https://evil.example' }), false);
  assert.equal(isLocalRequest({ host: 'localhost:4477', origin: 'null' }), false);
});
