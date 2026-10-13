// In-memory event store. In production this is a database table.

export class EventStore {
  #events = [];
  #nextId = 1;

  /** Adds an event and returns it. Events are kept in the order they arrived. */
  add({ type, actor, message, createdAt }) {
    const event = { id: this.#nextId++, type, actor, message, createdAt };
    this.#events.push(event);
    return event;
  }

  /** Every event, in arrival order. */
  all() {
    return this.#events;
  }

  /** The most recently added event, used by the "latest activity" badge. */
  latest() {
    return this.#events[this.#events.length - 1] ?? null;
  }
}

/** A store with enough history to try the feed by hand. */
export function seededStore() {
  const store = new EventStore();
  const actors = ['asha', 'ben', 'chen'];
  const types = ['deploy', 'login', 'settings'];
  for (let i = 0; i < 60; i += 1) {
    // Batches of three events share one timestamp, as bulk imports do in production.
    const minute = String(Math.floor(i / 3)).padStart(2, '0');
    store.add({
      type: types[i % types.length],
      actor: actors[i % actors.length],
      message: `event ${i + 1}`,
      createdAt: `2026-03-01T10:${minute}:00.000Z`,
    });
  }
  return store;
}
