/**
 * Applies a Northwind order webhook to our order store.
 *
 * @param {{ headers: Record<string, string>, rawBody: string }} request
 * @param {{ orders: import('./orders.js').OrderStore, secret: string, now: () => number }} deps
 * @returns {{ status: number, body: object }}
 */
export function handleWebhook(request, deps) {
  const event = JSON.parse(request.rawBody);

  deps.orders.save({ orderId: event.orderId, version: event.version, status: event.status });

  return { status: 200, body: { ok: true } };
}
