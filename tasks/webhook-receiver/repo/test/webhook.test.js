import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleWebhook } from '../src/webhook.js';
import { deps, signedRaw, signedRequest } from './helpers.js';

const shipped = { eventId: 'evt_1', orderId: 'ord_7', version: 3, status: 'shipped' };

test('applies a correctly signed event', () => {
  const d = deps();
  const response = handleWebhook(signedRequest(shipped), d);
  assert.equal(response.status, 200);
  assert.deepEqual(d.orders.get('ord_7'), { orderId: 'ord_7', version: 3, status: 'shipped' });
});

// ---- The tests below describe the new behaviour and fail until it is built. ----

test('rejects an event signed with the wrong secret', () => {
  const d = deps();
  const response = handleWebhook(signedRequest(shipped, { secret: 'not-the-secret' }), d);
  assert.equal(response.status, 401);
  assert.equal(d.orders.get('ord_7'), null);
});

test('rejects an event with no signature', () => {
  const d = deps();
  const request = signedRequest(shipped);
  delete request.headers['x-signature'];
  assert.equal(handleWebhook(request, d).status, 401);
});

test('rejects a body that was changed after signing', () => {
  const d = deps();
  const request = signedRequest(shipped);
  request.rawBody = request.rawBody.replace('shipped', 'refunded');
  assert.equal(handleWebhook(request, d).status, 401);
});

test('applies a redelivered event once and still answers 200', () => {
  const d = deps();
  assert.equal(handleWebhook(signedRequest(shipped), d).status, 200);
  assert.equal(handleWebhook(signedRequest(shipped), d).status, 200);
  assert.equal(d.orders.writes, 1);
});

test('answers 400 for a correctly signed body that is not JSON', () => {
  const d = deps();
  assert.equal(handleWebhook(signedRaw('{not json'), d).status, 400);
  assert.equal(d.orders.writes, 0);
});
