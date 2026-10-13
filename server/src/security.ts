const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostnameOf(hostHeader: string): string {
  // "[::1]:4477" and "localhost:4477" both lose only the port.
  return hostHeader.replace(/:\d+$/, '').toLowerCase();
}

/**
 * True when a request was addressed to this machine by a page served from this machine.
 *
 * Binding to loopback is not enough on its own: a website the user visits can still
 * send requests to localhost, and a DNS rebinding attack can make them same-origin.
 * Checking Host stops rebinding, checking Origin stops cross-site requests.
 */
export function isLocalRequest(headers: { host?: string; origin?: string }): boolean {
  if (!headers.host || !LOCAL_HOSTNAMES.has(hostnameOf(headers.host))) return false;
  if (headers.origin === undefined) return true;
  try {
    return LOCAL_HOSTNAMES.has(new URL(headers.origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}
