export class InvalidQueryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

/** Returns the newest events first. */
export function listEvents(store, { limit = 20 } = {}) {
  const events = store.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { events: events.slice(0, limit) };
}
