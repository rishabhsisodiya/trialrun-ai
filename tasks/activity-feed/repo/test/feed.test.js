import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listEvents } from '../src/feed.js';
import { EventStore, seededStore } from '../src/store.js';

function storeWith(times) {
  const store = new EventStore();
  times.forEach((createdAt, index) => store.add({ type: 'login', actor: 'asha', message: `m${index + 1}`, createdAt }));
  return store;
}

test('returns the newest events first', () => {
  const store = storeWith(['2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-02T00:00:00.000Z']);
  const { events } = listEvents(store);
  assert.deepEqual(events.map((event) => event.message), ['m2', 'm3', 'm1']);
});

test('honours the limit', () => {
  const { events } = listEvents(seededStore(), { limit: 5 });
  assert.equal(events.length, 5);
});

// ---- The tests below describe the new behaviour and fail until it is built. ----

test('pages through the whole feed without repeating or skipping an event', () => {
  const store = seededStore();
  const seen = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = listEvents(store, { limit: 7, cursor });
    seen.push(...result.events.map((event) => event.id));
    cursor = result.nextCursor;
    if (cursor === null) break;
  }
  assert.equal(cursor, null, 'the last page must have a null nextCursor');
  assert.equal(seen.length, 60);
  assert.equal(new Set(seen).size, 60, 'no event may appear twice');
});

test('filters by type', () => {
  const { events } = listEvents(seededStore(), { type: 'deploy', limit: 100 });
  assert.equal(events.length, 20);
  assert.ok(events.every((event) => event.type === 'deploy'));
});

test('listing does not change what the store considers the latest event', () => {
  const store = storeWith(['2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z']);
  listEvents(store);
  assert.equal(store.latest().message, 'm2');
});
