// @vitest-environment node
// The shared live-status store (FE-4, FE-5), its poll back-off (task 09 finding 8), the danger rules
// (FE-1/FE-2/FE-3) and the /api/live/* calls (FE-8). No React and no DOM here: the store is driven directly.
import {
  createLiveStatusStore,
  fallbackCause,
  fetchSavedRun,
  isLive,
  liveDanger,
  modePills,
  playableSavedRunId,
  postLiveLaunch,
  postLiveTerminate,
  sessionMayBeBilling,
  terminationProblem,
  type LiveState,
  type LiveStatus,
  type SavedRun,
} from './liveStatus';

const snapshot = (mode: LiveStatus['mode'], extra: Partial<LiveStatus> = {}): LiveStatus => ({
  schemaVersion: 1,
  mode,
  reason: `mode ${mode}`,
  budget: { ceilingUsd: 40, billedUsd: 0, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true },
  workers: [],
  fallback: { active: false, label: '', savedRunId: null },
  ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const FAILED = 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing';
const PENDING = 'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs may still be billing';

/** A scripted backend: `next` decides each answer; `calls` counts requests to the status endpoint. */
function backend(first: () => Response | Promise<Response>) {
  const b = {
    next: first,
    calls: 0,
    fetch: (async (input: RequestInfo | URL) => {
      if (String(input) === '/api/live/status') b.calls += 1;
      return b.next();
    }) as unknown as typeof fetch,
  };
  return b;
}
const down = () => {
  throw new TypeError('Failed to fetch');
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/* ---- polling, back-off ----------------------------------------------------------------------- */

test('with no backend the store backs off (4 s doubling to a 60 s cap) instead of polling every interval', async () => {
  const b = backend(down);
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const stop = store.subscribe(() => {}, 2000);
  await advance(0);
  expect(store.getState()).toMatchObject({ status: 'unreachable', cause: 'network', message: 'Failed to fetch' });
  expect(b.calls).toBe(1);
  await advance(3_999); // a plain 2 s poller would have asked again at 2 s
  expect(b.calls).toBe(1);
  await advance(1); // 4 s after the first failure
  expect(b.calls).toBe(2);
  await advance(7_999); // next attempt is 8 s later, at 12 s
  expect(b.calls).toBe(2);
  await advance(1);
  expect(b.calls).toBe(3);
  await advance(16_000); // 28 s
  expect(b.calls).toBe(4);
  await advance(32_000); // 60 s
  expect(b.calls).toBe(5);
  await advance(59_999); // capped: the following gaps are 60 s, never longer, and it never gives up
  expect(b.calls).toBe(5);
  await advance(1); // 120 s
  expect(b.calls).toBe(6);
  await advance(60_000); // 180 s
  expect(b.calls).toBe(7);
  stop();
});

test('an HTML page answered with status 200 (static host) is a failure for the back-off, not a success', async () => {
  const b = backend(() => new Response('<!doctype html><html><body>app shell</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const stop = store.subscribe(() => {}, 2000);
  await advance(0);
  expect(store.getState()).toMatchObject({ status: 'unreachable', cause: 'invalid' });
  await advance(11_000); // 0 s, then 4 s; the old wrapper reset on any 2xx and asked every 2 s (6 requests by now)
  expect(b.calls).toBe(2);
  await advance(1_000); // 12 s
  expect(b.calls).toBe(3);
  stop();
});

test('a valid answer resets the back-off; a backend that comes up is picked up; refresh() does not wait', async () => {
  const b = backend(down);
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const stop = store.subscribe(() => {}, 2000);
  await advance(4_000); // attempts at 0 s and 4 s have failed; the next one is due at 12 s
  expect(b.calls).toBe(2);
  // refresh() (used after a POST) ignores the back-off.
  b.next = () => json(snapshot('idle'));
  await store.refresh();
  expect(b.calls).toBe(3);
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'idle' } });
  // Back to the normal pace: one request per interval.
  await advance(6_000);
  expect(b.calls).toBe(6);
  // The next outage starts again from the short delay (4 s), not from where the last one stopped.
  b.next = down;
  await advance(2_000); // fails at 12 s
  expect(b.calls).toBe(7);
  expect(store.getState().status).toBe('unreachable');
  await advance(4_000); // 16 s: first retry after 4 s
  expect(b.calls).toBe(8);
  stop();
});

test('no back-off while a session may be billing: after live -> unreachable the store keeps asking every interval', async () => {
  const b = backend(() => json(snapshot('live')));
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const stop = store.subscribe(() => {}, 2000);
  await advance(0);
  expect(isLive(store.getState())).toBe(true);
  b.next = down;
  await advance(2_000);
  const lost = store.getState();
  expect(lost).toMatchObject({ status: 'unreachable', lastKnown: { data: { mode: 'live' } } });
  expect(isLive(lost)).toBe(false);
  expect(liveDanger(lost)?.kind).toBe('connection-lost');
  await advance(10_000);
  expect(b.calls).toBe(7); // 0, 2, 4, … 12 s
  stop();
});

/* ---- timeout, ordering, staleness -------------------------------------------------------------- */

test('a request is aborted after a timeout shorter than the poll interval and the state becomes unreachable', async () => {
  const signals: AbortSignal[] = [];
  const hang = ((_: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init!.signal!);
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
  const store = createLiveStatusStore({ fetchImpl: hang, backoff: false });
  const stop = store.subscribe(() => {}, 2000);
  await advance(1_499);
  expect(store.getState().status).toBe('connecting');
  expect(signals[0]!.aborted).toBe(false);
  await advance(1);
  expect(store.getState()).toMatchObject({ status: 'unreachable', cause: 'timeout', message: '/api/live/status: no answer within 1500 ms' });
  expect(signals[0]!.aborted).toBe(true);
  // The timeout follows the fastest subscriber: 75 % of a 400 ms interval.
  const stopFast = store.subscribe(() => {}, 400);
  await advance(400); // next poll at the new pace
  expect(signals).toHaveLength(2);
  await advance(299);
  expect(signals[1]!.aborted).toBe(false);
  await advance(1);
  expect(signals[1]!.aborted).toBe(true);
  stopFast();
  stop();
});

test('answers are applied in request order only: an older answer that arrives late is dropped, success or failure', async () => {
  const waiting: ((r: Response | Error) => void)[] = [];
  const slow = (() =>
    new Promise<Response>((resolve, reject) => {
      waiting.push((r) => (r instanceof Error ? reject(r) : resolve(r)));
    })) as unknown as typeof fetch;
  const store = createLiveStatusStore({ fetchImpl: slow, backoff: false });
  const stop = store.subscribe(() => {}, 60_000); // request 1 is in flight
  const second = store.refresh(); // request 2
  waiting[1]!(json(snapshot('terminated')));
  await second;
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'terminated' } });
  waiting[0]!(json(snapshot('live'))); // request 1 answers late
  await advance(0);
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'terminated' } });
  expect(isLive(store.getState())).toBe(false);

  // A late failure does not replace a newer success either.
  const third = store.refresh();
  const fourth = store.refresh();
  waiting[3]!(json(snapshot('idle')));
  await fourth;
  waiting[2]!(new TypeError('Failed to fetch'));
  await third;
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'idle' } });
  stop();
});

test('a snapshot that outlived its freshness is not shown as current: at the next tick it becomes unreachable (stale)', async () => {
  let clock = 1_000_000;
  let answer: () => Response | Promise<Response> = () => json(snapshot('live'));
  const store = createLiveStatusStore({ fetchImpl: (async () => answer()) as unknown as typeof fetch, now: () => clock });
  const stop = store.subscribe(() => {}, 2000);
  await advance(0);
  expect(store.getState()).toEqual({ status: 'ready', data: snapshot('live'), receivedAt: 1_000_000, freshForMs: 5_500 });
  // The tab was suspended: a minute passes on the wall clock before the next tick runs, and the backend hangs.
  clock += 60_000;
  answer = () => new Promise<Response>(() => {});
  await advance(2_000);
  const stale = store.getState();
  expect(stale).toMatchObject({ status: 'unreachable', cause: 'stale', message: 'no fresh status for 60 s', lastKnown: { data: { mode: 'live' }, receivedAt: 1_000_000 } });
  expect(isLive(stale)).toBe(false);
  // While the request sent at that same tick is open this is "checking", not yet an alarm and never LIVE …
  expect(modePills(stale)).toEqual([{ status: 'replay', text: 'Checking status…' }]);
  expect(liveDanger(stale)).toBeNull();
  // … and when that request gets no answer either, it is a lost session.
  await advance(1_500);
  expect(store.getState()).toMatchObject({ status: 'unreachable', cause: 'timeout', lastKnown: { data: { mode: 'live' } } });
  expect(liveDanger(store.getState())?.kind).toBe('connection-lost');
  stop();
});

/* ---- one store for everyone -------------------------------------------------------------------- */

test('subscribers share one poller at the fastest requested pace; the last one leaving stops and resets it', async () => {
  const b = backend(() => json(snapshot('idle')));
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const seenA: string[] = [];
  const seenB: string[] = [];
  const stopA = store.subscribe(() => seenA.push(store.getState().status), 5000); // e.g. the transport view
  const stopB = store.subscribe(() => seenB.push(store.getState().status), 2000); // e.g. the header
  await advance(0);
  expect(b.calls).toBe(1); // one request serves both
  expect(seenA).toEqual(['ready']);
  expect(seenB).toEqual(['ready']);
  await advance(4_000);
  expect(b.calls).toBe(3); // 2 s pace
  stopB();
  await advance(5_000);
  expect(b.calls).toBe(4); // 5 s pace now
  // A request is in flight when the last subscriber leaves: its answer must not resurrect the state.
  let release: (r: Response) => void = () => {};
  b.next = () => new Promise<Response>((r) => (release = r));
  await advance(5_000);
  expect(b.calls).toBe(5);
  stopA();
  expect(store.getState()).toEqual({ status: 'connecting' });
  release(json(snapshot('live')));
  await advance(60_000);
  expect(store.getState()).toEqual({ status: 'connecting' });
  expect(b.calls).toBe(5); // and nothing polls any more
});

test('apply() takes a status from a POST answer (valid ones only) and lockLaunch() holds until another mode is reported', async () => {
  const b = backend(() => json(snapshot('idle')));
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const stop = store.subscribe(() => {}, 2000);
  await advance(0);
  expect(store.getState().launchLocked).toBeUndefined();

  // Invalid snapshots are refused and change nothing.
  const before = store.getState();
  expect(store.apply({ schemaVersion: 1, mode: 'live' })).toBe(false);
  expect(store.apply(undefined)).toBe(false);
  expect(store.getState()).toBe(before);
  // A valid one replaces the state at once.
  expect(store.apply(snapshot('idle', { reason: 'from the POST answer' }))).toBe(true);
  expect(store.getState()).toMatchObject({ status: 'ready', data: { reason: 'from the POST answer' } });

  store.lockLaunch();
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'idle' }, launchLocked: true });
  await advance(6_000); // more idle snapshots: still locked
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'idle' }, launchLocked: true });
  b.next = down; // not reachable: still locked
  await advance(2_000);
  expect(store.getState()).toMatchObject({ status: 'unreachable', launchLocked: true });
  await store.refresh();
  b.next = () => json(snapshot('launching'));
  await store.refresh();
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'launching' } });
  expect(store.getState().launchLocked).toBeUndefined(); // the mode changed: unlocked
  b.next = () => json(snapshot('idle'));
  await store.refresh();
  expect(store.getState().launchLocked).toBeUndefined(); // and it stays unlocked back in idle
  stop();
});

/* ---- danger rules ------------------------------------------------------------------------------ */

test('terminationProblem finds either marker anywhere in the reason, in every mode, and titles the alert from it', () => {
  expect(terminationProblem(`${FAILED}: GPU 0 (bean) terminate unconfirmed.`)).toEqual({
    marker: 'TERMINATE FAILED',
    title: 'TERMINATE FAILED — GPUs may still be billing',
    reason: `${FAILED}: GPU 0 (bean) terminate unconfirmed.`,
  });
  expect(terminationProblem(`${PENDING}: GPU 1.`)?.title).toBe('TERMINATION PENDING — GPUs may still be billing');
  // Not only at the start (the old check was startsWith on one marker).
  expect(terminationProblem(`Session thread still running after 497 s; termination unconfirmed. ${PENDING}`)?.marker).toBe('TERMINATION PENDING');
  expect(terminationProblem('worker stopped; terminate failed for GPU 0')?.marker).toBe('TERMINATE FAILED');
  // FAILED outranks PENDING when both are present.
  expect(terminationProblem(`${PENDING}. Earlier: ${FAILED}`)?.marker).toBe('TERMINATE FAILED');
  for (const mode of ['unavailable', 'idle', 'launching', 'live', 'fallback', 'terminated'] as const) {
    const s = snapshot(mode, { reason: `${PENDING}: GPU 1 (triangular).` });
    expect(terminationProblem(s)?.marker).toBe('TERMINATION PENDING');
    expect(terminationProblem({ status: 'ready', data: s })?.marker).toBe('TERMINATION PENDING');
    expect(liveDanger({ status: 'ready', data: s })).toMatchObject({ kind: 'termination-pending', pill: 'TERMINATION PENDING' });
    expect(sessionMayBeBilling(s)).toBe(true);
  }
  // Ordinary reasons are not alerts.
  for (const reason of ['Both workers finished; output retrieved and workers terminated.', 'Stopped on request; workers terminated.', 'Qualified.', '']) {
    expect(terminationProblem(reason)).toBeNull();
    expect(liveDanger({ status: 'ready', data: snapshot('idle', { reason }) })).toBeNull();
  }
  expect(terminationProblem(null)).toBeNull();
  expect(terminationProblem({ status: 'connecting' })).toBeNull();
  expect(terminationProblem({ status: 'unreachable', message: FAILED })).toBeNull(); // an error text is not a status
});

test('connection lost is a danger only when the last valid snapshot was not a clean idle one', () => {
  const lost = (data: LiveStatus): LiveState => ({ status: 'unreachable', message: '/api/live/status: HTTP 502', lastKnown: { data, receivedAt: 0 } });
  for (const mode of ['launching', 'live', 'fallback'] as const) {
    const d = liveDanger(lost(snapshot(mode)));
    expect(d).toMatchObject({ kind: 'connection-lost', pill: 'Connection lost', title: 'CONNECTION LOST — session state unknown' });
    expect(d!.detail).toContain(`mode "${mode}"`);
    expect(d!.detail).toContain('HTTP 502');
    expect(d!.detail).toContain('GPUs may still be billing');
    expect(modePills(lost(snapshot(mode)))).toEqual([{ status: 'failed', text: 'Connection lost' }]);
  }
  expect(liveDanger(lost(snapshot('idle', { reason: `${FAILED}.` })))?.kind).toBe('connection-lost');
  const worker = { gpuIndex: 0 as const, deviceId: '', tube: 'bean' as const, state: 'pending' as const, simTime: null, samples: [] };
  expect(liveDanger(lost(snapshot('idle', { workers: [worker] })))?.kind).toBe('connection-lost');
  for (const mode of ['idle', 'unavailable', 'terminated'] as const) {
    expect(liveDanger(lost(snapshot(mode)))).toBeNull();
    expect(sessionMayBeBilling(snapshot(mode))).toBe(false);
    expect(modePills(lost(snapshot(mode)))).toEqual([{ status: 'replay', text: 'Replay · $0' }]);
  }
  expect(liveDanger({ status: 'unreachable', message: 'x' })).toBeNull(); // never saw a backend
  expect(liveDanger({ status: 'connecting' })).toBeNull();
});

test('mode pills: LIVE only for mode live; danger leads and removes "Replay · $0"; fallback text comes from the backend label', () => {
  const ready = (mode: LiveStatus['mode'], extra: Partial<LiveStatus> = {}): LiveState => ({ status: 'ready', data: snapshot(mode, extra) });
  const text = (s: LiveState) => modePills(s).map((p) => `${p.status}:${p.text}`);
  expect(text(ready('live'))).toEqual(['live:LIVE · GPU 0 / GPU 1']);
  expect(text(ready('live', { reason: `${FAILED}.` }))).toEqual(['failed:TERMINATE FAILED', 'live:LIVE · GPU 0 / GPU 1']);
  expect(text(ready('idle', { reason: `${PENDING}.` }))).toEqual(['failed:TERMINATION PENDING']);
  expect(text(ready('launching', { reason: `${PENDING}.` }))).toEqual(['failed:TERMINATION PENDING', 'rehearsal:Launching…']);
  for (const mode of ['unavailable', 'idle', 'launching', 'fallback', 'terminated'] as const) {
    expect(modePills(ready(mode)).some((p) => p.status === 'live')).toBe(false);
    expect(modePills(ready(mode, { reason: `${FAILED}.` })).some((p) => p.status === 'live' || p.status === 'replay')).toBe(false);
  }
  const label = (l: string, savedRunId: string | null = null, qualified = true) =>
    snapshot('fallback', { qualified, fallback: { active: true, label: l, savedRunId } });
  expect(fallbackCause(label('Worker failed — playing saved GX run r1', 'r1'))).toBe('Worker failed');
  expect(fallbackCause(label('Hard timeout reached. No qualified GX rehearsal recorded — showing archived stella/GENE evidence'))).toBe('Hard timeout reached');
  expect(fallbackCause(label(''))).toBe('Fallback');
  expect(fallbackCause(label('x'.repeat(41)))).toBe('Fallback');
  // "Playing saved run" needs a run id, a qualified service and a well-formed id.
  expect(playableSavedRunId(label('Worker failed — playing saved GX run r1', 'r1'))).toBe('r1');
  expect(playableSavedRunId(label('Worker failed.', null))).toBeNull();
  expect(playableSavedRunId(label('Worker failed — playing saved GX run r1', 'r1', false))).toBeNull();
  expect(playableSavedRunId(label('Worker failed — playing saved GX run r 1', 'r 1'))).toBeNull();
});

/* ---- /api/live/* calls (FE-8) ----------------------------------------------------------------- */

test('postLiveLaunch / postLiveTerminate: ok only for a 2xx answer saying ok:true; the carried status is validated', async () => {
  vi.useRealTimers();
  const calls: { url: string; init: RequestInit }[] = [];
  const answer = (res: () => Response) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init! });
      return res();
    }) as unknown as typeof fetch;

  const accepted = await postLiveLaunch(2.65, answer(() => json({ ok: true, reason: 'Launched live-abc.', status: snapshot('launching') }, 202)));
  expect(accepted).toEqual({ ok: true, httpStatus: 202, reason: 'Launched live-abc.', status: snapshot('launching') });
  expect(calls[0]!.url).toBe('/api/live/launch');
  expect(calls[0]!.init.method).toBe('POST');
  expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  expect(calls[0]!.init.body).toBe('{"confirmCostUsd":2.65}');

  const refused = await postLiveLaunch(2.65, answer(() => json({ ok: false, reason: 'A session is still running.', status: { schemaVersion: 1, mode: 'live' } }, 409)));
  expect(refused).toEqual({ ok: false, httpStatus: 409, reason: 'A session is still running.', status: null }); // partial status dropped
  // ok:true inside a non-2xx answer, or a 2xx answer without ok:true, is not a confirmation.
  expect((await postLiveTerminate(answer(() => json({ ok: true, reason: 'x' }, 502)))).ok).toBe(false);
  expect((await postLiveTerminate(answer(() => json({ reason: 'x' }, 200)))).ok).toBe(false);
  expect((await postLiveTerminate(answer(() => new Response('<html>', { status: 200 })))).ok).toBe(false);
  const pending = await postLiveTerminate(answer(() => json({ ok: false, reason: `${PENDING}: GPU 1.` }, 502)));
  expect(pending).toEqual({ ok: false, httpStatus: 502, reason: `${PENDING}: GPU 1.`, status: null });
  expect(calls.at(-1)!.url).toBe('/api/live/terminate');
  expect((await postLiveTerminate(answer(() => json({ ok: true, reason: 'Workers terminated.' })))).ok).toBe(true);
  // No answer at all: the outcome is unknown, and says so.
  const none = await postLiveLaunch(2.65, (async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch);
  expect(none).toEqual({ ok: false, httpStatus: null, reason: 'No response from /api/live/launch (Failed to fetch)', status: null });
});

test('fetchSavedRun validates the id, the HTTP status and the shape of the run', async () => {
  vi.useRealTimers();
  const run: SavedRun = {
    savedRunId: 'rehearsal-0123456789ab',
    initVerified: true,
    continuationVerified: true,
    checks: { init: true, continuation: true, distinctDevices: true, overlap: true },
    phases: [snapshot('live')],
  };
  const urls: string[] = [];
  const serve = (body: unknown, status = 200) =>
    (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json(body, status);
    }) as unknown as typeof fetch;
  await expect(fetchSavedRun(run.savedRunId, serve(run))).resolves.toEqual(run);
  expect(urls).toEqual(['/api/live/runs/rehearsal-0123456789ab']);
  // A malformed id is never sent.
  await expect(fetchSavedRun('a/b', serve(run))).rejects.toThrow(/not valid/);
  expect(urls).toHaveLength(1);
  await expect(fetchSavedRun(run.savedRunId, serve({ ok: false }, 404))).rejects.toThrow(/HTTP 404/);
  await expect(fetchSavedRun(run.savedRunId, serve({ savedRunId: run.savedRunId, initVerified: true }))).rejects.toThrow(/bad payload.*continuationVerified/);
  await expect(fetchSavedRun(run.savedRunId, serve({ ...run, phases: [{ schemaVersion: 1, mode: 'live' }] }))).rejects.toThrow(/bad payload.*phases\[0\]/);
  await expect(fetchSavedRun(run.savedRunId, serve({ ...run, savedRunId: 'another-run' }))).rejects.toThrow(/answered with run another-run/);
});
