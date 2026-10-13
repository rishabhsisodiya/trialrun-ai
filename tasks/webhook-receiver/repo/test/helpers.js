import { createHmac } from 'node:crypto';
import { OrderStore } from '../src/orders.js';

export const SECRET = 'whsec_test_northwind';
export const NOW = 1_767_225_600_000;

/** Signs a raw body exactly as Northwind's system does. */
export function signedRaw(rawBody, { secret = SECRET, timestamp = Math.floor(NOW / 1000) } = {}) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return {
    headers: { 'x-timestamp': String(timestamp), 'x-signature': `sha256=${signature}` },
    rawBody,
  };
}

export function signedRequest(event, options) {
  return signedRaw(JSON.stringify(event), options);
}

export function deps() {
  return { orders: new OrderStore(), secret: SECRET, now: () => NOW };
}
