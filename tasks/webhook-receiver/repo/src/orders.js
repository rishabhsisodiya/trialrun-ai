// Our copy of the customer's orders. In production this is a database table.

export class OrderStore {
  #orders = new Map();

  /** How many times an order has been written. Lets tests spot a double write. */
  writes = 0;

  get(orderId) {
    return this.#orders.get(orderId) ?? null;
  }

  /** Creates or replaces an order. */
  save(order) {
    this.#orders.set(order.orderId, { ...order });
    this.writes += 1;
  }
}
