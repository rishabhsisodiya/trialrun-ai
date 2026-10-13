# Task: harden the Northwind webhook integration

You are the engineer embedded with a customer, Northwind. Their order system sends
us a webhook whenever an order changes, and `src/webhook.js` applies it to our copy
of their orders. It was written for a demo and goes live for them next week.

Northwind's security team has sent their requirements, and our own on-call has seen
two problems in the pilot: orders occasionally flip back to an older status, and
some updates are applied twice when Northwind retries a delivery.

You have about 40 minutes. Use your coding agent however you normally would.

## What Northwind sends

    POST /webhooks/northwind
    x-timestamp: 1767225600                (seconds since the epoch)
    x-signature: sha256=<hex digest>
    body: {"eventId":"evt_1","orderId":"ord_7","version":3,"status":"shipped"}

The signature is HMAC-SHA256, keyed with the shared secret, over the string
`<x-timestamp>.<raw request body>`.

## What to build

`handleWebhook({ headers, rawBody }, deps)` returns `{ status, body }`.
`deps` is `{ orders, secret, now }` where `now()` returns the current time in
milliseconds.

1. Reject a request whose signature is missing or wrong with status `401`.
2. Reject a request whose timestamp is more than five minutes away from `now()`
   with status `401`, so a captured request cannot be replayed later.
3. If the same `eventId` is delivered again, do not apply it twice, and answer `200`
   so Northwind stops retrying.
4. Each order carries a `version` that only goes up. An event with a version that is
   not newer than the one we hold must not change the order.
5. A body that is not valid JSON, or is missing a field, is a `400`.

## Ground rules

- No new dependencies. Node's standard library only.
- `npm test` must pass. Some tests fail today; they cover part of the list above,
  not all of it.
- `test/helpers.js` shows how Northwind signs a request.
