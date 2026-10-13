# Task: paginate the activity feed

Shipway is a small admin tool. Its activity feed (`GET /events`) returns the newest
events first, but only ever the first page. Admins have asked to scroll back through
history, and support has a bug report: "the same event sometimes shows up twice".

You have about 40 minutes. Use your coding agent however you normally would.

## What to build

1. `listEvents(store, { limit, cursor, type })` in `src/feed.js` returns
   `{ events, nextCursor }`.
   - Newest first.
   - `nextCursor` is a string to pass back as `cursor` for the next page, or `null`
     when there are no more events.
   - Several events can share the same `createdAt`. Paging through the whole feed
     must return every event exactly once.
2. `type` (optional) keeps only events of that type, for example `deploy`.
3. `limit` defaults to 20 and may be at most 100. A limit that is not a whole number
   from 1 to 100, or a cursor that is not one this API produced, must throw
   `InvalidQueryError` (already exported from `src/feed.js`).
4. `GET /events?limit=&cursor=&type=` in `src/server.js` exposes all of this and
   answers `400` with `{ "error": "<message>" }` for an `InvalidQueryError`.

## Ground rules

- No new dependencies. Node's standard library only.
- `npm test` must pass. Some tests in `test/feed.test.js` fail today; they describe
  part of the behaviour above, not all of it.
- Leave the code better than you found it, but keep the change focused.

Run the tests with `npm test` and the server with `npm start`.
