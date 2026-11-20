// Polling a backend that is not there (static replay build) should not hammer the network every
// two seconds. This wraps fetch for useLiveStatus: after a failure it backs off (doubling, capped),
// answering with the last error without a request until the next attempt is due. A success resets
// it, so a backend that comes up is picked up within `maxDelayMs`. It never fabricates a status.
export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
}

export function backoffFetch(inner: () => typeof fetch, opts: BackoffOptions = {}): typeof fetch {
  const base = opts.baseDelayMs ?? 4_000;
  const max = opts.maxDelayMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());
  let failures = 0;
  let nextAttempt = 0;
  let lastError: Error | null = null;

  const fail = (err: Error) => {
    failures += 1;
    lastError = err;
    nextAttempt = now() + Math.min(max, base * 2 ** (failures - 1));
  };

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (failures > 0 && now() < nextAttempt && lastError) throw lastError;
    try {
      const res = await inner()(input, init);
      if (!res.ok) fail(new Error(`${String(input)}: HTTP ${res.status}`));
      else failures = 0;
      return res;
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  };
  return wrapped as typeof fetch;
}
