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
  stopUnconfirmed,
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

test('A2 with no backend the store backs off (4 s doubling to a 60 s cap) instead of polling every interval', async () => {
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

test('A2 an HTML page answered with status 200 (static host) is a failure for the back-off, not a success', async () => {
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

test('A2 a valid answer resets the back-off; a backend that comes up is picked up; refresh() does not wait', async () => {
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

test('A2 L9 no back-off while a session may be billing: after live -> unreachable the store keeps asking every interval', async () => {
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

test('A2 a request is aborted after a timeout shorter than the poll interval and the state becomes unreachable', async () => {
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

test('A2 requests never stack up: while one is in flight no poll sends another, even after a faster subscriber shortens the interval', async () => {
  const signals: AbortSignal[] = [];
  const hang = ((_: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init!.signal!);
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
  const store = createLiveStatusStore({ fetchImpl: hang, backoff: false });
  const stop = store.subscribe(() => {}, 2000); // request 1: 1500 ms timeout
  await advance(0);
  expect(signals).toHaveLength(1);
  const stopFast = store.subscribe(() => {}, 400); // polls every 400 ms from now on
  await advance(1_200); // ticks at 400, 800, 1200: request 1 is still open
  expect(signals).toHaveLength(1);
  await advance(300); // 1500 ms: request 1 times out
  expect(signals[0]!.aborted).toBe(true);
  expect(store.getState()).toMatchObject({ status: 'unreachable', cause: 'timeout' });
  await advance(100); // next tick (1600 ms) sends request 2
  expect(signals).toHaveLength(2);
  stopFast();
  stop();
});

test('A2 answers are applied in request order only: an older answer that arrives late is dropped, success or failure', async () => {
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

test('A2 a snapshot that outlived its freshness is not shown as current: at the next tick it becomes unreachable (stale)', async () => {
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

test('A2 subscribers share one poller at the fastest requested pace; the last one leaving stops and resets it', async () => {
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

test('L10 apply() takes a status from a POST answer (valid ones only) and lockLaunch() holds until another mode is reported', async () => {
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

test('L10 FA-4 launch lock: a 202 holds until a later snapshot reports another mode; a 409 or no answer is released by the next snapshot', async () => {
  const b = backend(() => json(snapshot('idle')));
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const stop = store.subscribe(() => {}, 2000);
  await advance(0);
  store.launchAnswered('accepted'); // nothing is locked: no-op
  expect(store.getState().launchLocked).toBeUndefined();

  // 202: idle snapshots after the answer (the session thread has not started yet) keep it locked.
  store.lockLaunch();
  expect(store.getState()).toMatchObject({ status: 'ready', launchLocked: true, launchPhase: 'sent' });
  store.launchAnswered('accepted');
  expect(store.apply(snapshot('idle', { reason: 'carried by the 202' }))).toBe(true);
  await advance(4_000);
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'idle' }, launchLocked: true, launchPhase: 'accepted' });
  b.next = () => json(snapshot('launching'));
  await store.refresh();
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'launching' } });
  expect(store.getState().launchLocked).toBeUndefined();
  expect(store.getState().launchPhase).toBeUndefined();

  // 409: nothing was launched. The status the refusal carries (applied after launchAnswered) releases it.
  b.next = () => json(snapshot('idle'));
  await store.refresh();
  store.lockLaunch();
  store.launchAnswered('refused');
  expect(store.getState()).toMatchObject({ launchLocked: true, launchPhase: 'refused' });
  expect(store.apply(snapshot('idle', { reason: 'carried by the 409' }))).toBe(true);
  expect(store.getState()).toMatchObject({ status: 'ready', data: { reason: 'carried by the 409' } });
  expect(store.getState().launchLocked).toBeUndefined();

  // No answer: the next snapshot requested after it says what is true, idle or not.
  store.lockLaunch();
  store.launchAnswered('unknown');
  expect(store.getState()).toMatchObject({ launchLocked: true, launchPhase: 'unknown' });
  b.next = down; // a failed poll decides nothing
  await store.refresh();
  expect(store.getState()).toMatchObject({ status: 'unreachable', launchLocked: true, launchPhase: 'unknown' });
  b.next = () => json(snapshot('idle'));
  await store.refresh();
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'idle' } });
  expect(store.getState().launchLocked).toBeUndefined();
  stop();
});

test('L10 FA-4 only a snapshot requested after the lock changed can release it: an older poll answering late cannot', async () => {
  const waiting: ((r: Response) => void)[] = [];
  const slow = (() => new Promise<Response>((resolve) => waiting.push(resolve))) as unknown as typeof fetch;
  const store = createLiveStatusStore({ fetchImpl: slow, backoff: false });
  const stop = store.subscribe(() => {}, 60_000);
  waiting[0]!(json(snapshot('idle')));
  await advance(0);
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'idle' } });

  // A poll sent before the POST answers after a "no answer" outcome: it predates the launch on the backend.
  const older = store.refresh();
  store.lockLaunch();
  store.launchAnswered('unknown');
  waiting[1]!(json(snapshot('idle', { reason: 'older' })));
  await older;
  expect(store.getState()).toMatchObject({ data: { reason: 'older' }, launchLocked: true, launchPhase: 'unknown' });
  const newer = store.refresh();
  waiting[2]!(json(snapshot('idle', { reason: 'newer' })));
  await newer;
  expect(store.getState()).toMatchObject({ data: { reason: 'newer' } });
  expect(store.getState().launchLocked).toBeUndefined();

  // The same for a 202: a non-idle answer to a request sent before the lock does not release it.
  const before = store.refresh();
  store.lockLaunch();
  store.launchAnswered('accepted');
  waiting[3]!(json(snapshot('unavailable')));
  await before;
  expect(store.getState()).toMatchObject({ data: { mode: 'unavailable' }, launchLocked: true, launchPhase: 'accepted' });
  stop();
});

test.each([
  ['sent', 'connection-lost'],
  ['accepted', 'connection-lost'],
  ['unknown', 'connection-lost'],
  ['refused', null],
] as const)('A2 L10 FA-4 launch %s, then the API stops answering after an idle snapshot: danger %s, polling stays at full pace while it may bill', async (phase, expected) => {
  const b = backend(() => json(snapshot('idle')));
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const stop = store.subscribe(() => {}, 2000);
  await advance(0);
  store.lockLaunch();
  if (phase !== 'sent') store.launchAnswered(phase);
  b.next = down;
  await store.refresh();
  const s = store.getState();
  expect(s).toMatchObject({ status: 'unreachable', lastKnown: { data: { mode: 'idle' } } });
  expect(liveDanger(s)?.kind ?? null).toBe(expected);
  expect((liveDanger(s)?.detail ?? '').includes('A launch request was sent from this page after that, and its outcome is not known.')).toBe(expected !== null);
  expect(modePills(s)[0]!.status).toBe(expected ? 'billing-risk' : 'replay');
  // 2 s later: a launch that may bill is polled at the normal pace; a refused one backs off (4 s).
  const calls = b.calls;
  await advance(2_000);
  expect(b.calls).toBe(calls + (expected ? 1 : 0));
  stop();
});

/* ---- danger rules ------------------------------------------------------------------------------ */

test('A2 L9 terminationProblem finds either marker anywhere in the reason, in every mode, and titles the alert from it', () => {
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

/* ---- FA-2: backend round-6 wording, assembled exactly as the backend assembles it ------------------
 * main/labyrinth_main/features/live_gx/orchestrator.py:56-62 (constants), :320-333 (`reason` = marker +
 * ": " + "GPU <i> (<tube>) <terminate_error>" + ". " + base; :561 joins the GPU clauses), :516 ("termination
 * pending: " + message), :502 ("terminate unconfirmed after <n> attempts: " + error), :523 (a
 * TerminationUnconfirmed message as is); modal_backend.py:181-184 (_no_call), :325-327 (pending message);
 * service.py:340-341, :348 and server/app.py:172 (launch refusals: "launch refused: " + reason). */
const BASE_FAILED_SPAWN =
  "GPU 0 (bean) worker failed: launch failed client-side (ConnectionError: reset) and a worker may have started; there is no call to cancel, only the run's kill switch can stop it.";
const NO_CALL = 'the spawn failed client-side (ConnectionError: reset) after it may have reached Modal, there is no call to cancel';
const ROUND6 = {
  // modal_backend.py:183 via orchestrator.py:523/:328 — the kill switch was raised, nothing could be cancelled.
  killSwitchOnly: `${FAILED}: GPU 0 (bean) kill switch raised, stop not confirmed: ${NO_CALL} and a worker that started stops only when it reads the switch. ${BASE_FAILED_SPAWN}`,
  // modal_backend.py:184 raised as RuntimeError, retried, then orchestrator.py:502 (1 + 4 backoff steps).
  killSwitchNotSet: `${FAILED}: GPU 0 (bean) terminate unconfirmed after 5 attempts: RuntimeError: ${NO_CALL} and the run kill switch could not be set: TimeoutError: Dict.put(abort) timed out. ${BASE_FAILED_SPAWN}`,
  // modal_backend.py:325,327 + orchestrator.py:516, pending only -> TERMINATE_PENDING (orchestrator.py:327-328).
  pendingRaised: `${PENDING}: GPU 1 (triangular) termination pending: spawn still in flight; it is cancelled the moment it returns; the run kill switch is raised. GPU 1 (triangular) worker failed: launch did not complete in time (Function.spawn did not return within 30 s); if the call still arrives it is cancelled at once.`,
  pendingNotSet: `${PENDING}: GPU 1 (triangular) termination pending: spawn still in flight; it is cancelled the moment it returns; the run kill switch could NOT be set (TimeoutError: Dict.put(abort) timed out); the next terminate retries it. GPU 1 (triangular) worker failed: launch did not complete in time (Function.spawn did not return within 30 s); if the call still arrives it is cancelled at once.`,
  // orchestrator.py:62 STOPPING + ". " + base, while the mode is still launching / live (orchestrator.py:331-332).
  stoppingLive: 'Stop requested; terminating workers — not confirmed yet. Both workers launched; streaming GX output (live).',
  stoppingLaunching: 'Stop requested; terminating workers — not confirmed yet. Launching GX workers (live); hard timeout 1500 s.',
  // service.py:378-379: a terminate answer (502) whose session thread did not stop in time.
  threadStillRunning:
    'Session thread still running after 30 s; termination unconfirmed. Stop requested; terminating workers — not confirmed yet. Launching GX workers (live); hard timeout 1500 s.',
  // service.py:340-341 and :348 behind server/app.py:172.
  refusedCost: 'launch refused: confirmCostUsd must equal the current slot estimate $2.65 to the cent (got 2.6).',
  refusedLedger: 'launch refused: The ledger could not be updated (OSError: [Errno 28] No space left on device); nothing reserved, nothing launched.',
  refusedLedgerKept:
    'launch refused: The ledger could not be updated (PermissionError: [Errno 13] Permission denied); the reservation was written and stays pending, nothing launched.',
} as const;

test.each([
  ['kill switch raised, stop not confirmed', ROUND6.killSwitchOnly],
  ['kill switch could not be set', ROUND6.killSwitchNotSet],
] as const)('A2 L9 FA-2 %s: TERMINATE FAILED in every mode, never terminated or replay', (_name, reason) => {
  expect(terminationProblem(reason)).toEqual({ marker: 'TERMINATE FAILED', title: 'TERMINATE FAILED — GPUs may still be billing', reason });
  // The marker leads the backend's text; the phrase alone (a reason that lost its marker) still means a failed stop.
  const bare = reason.slice(`${FAILED}: `.length);
  expect(terminationProblem(bare)?.marker).toBe('TERMINATE FAILED');
  for (const mode of ['unavailable', 'idle', 'launching', 'live', 'fallback', 'terminated'] as const) {
    const s: LiveState = { status: 'ready', data: snapshot(mode, { reason: bare }) };
    expect(liveDanger(s)).toMatchObject({ kind: 'terminate-failed', pill: 'TERMINATE FAILED', detail: bare });
    expect(sessionMayBeBilling(snapshot(mode, { reason: bare }))).toBe(true);
    const pills = modePills(s);
    expect(pills[0]).toEqual({ status: 'billing-risk', text: 'TERMINATE FAILED' });
    expect(pills.some((p) => p.status === 'replay')).toBe(false);
  }
});

test.each([
  ['the run kill switch is raised', ROUND6.pendingRaised],
  ['the run kill switch could NOT be set', ROUND6.pendingNotSet],
] as const)('A2 L9 FA-2 a pending cancel whose clause ends "%s" is TERMINATION PENDING (the backend\'s marker wins)', (_name, reason) => {
  expect(terminationProblem(reason)?.marker).toBe('TERMINATION PENDING');
  const s: LiveState = { status: 'ready', data: snapshot('fallback', { reason }) };
  expect(liveDanger(s)).toMatchObject({ kind: 'termination-pending', title: 'TERMINATION PENDING — GPUs may still be billing', detail: reason });
  expect(modePills(s)[0]).toEqual({ status: 'billing-risk', text: 'TERMINATION PENDING' });
});

test('A2 L9 FA-2 "Stop requested; terminating workers — not confirmed yet." is a danger of its own: LIVE stays, never replay or terminated', () => {
  for (const [mode, reason] of [
    ['live', ROUND6.stoppingLive],
    ['launching', ROUND6.stoppingLaunching],
  ] as const) {
    const data = snapshot(mode, { reason });
    const s: LiveState = { status: 'ready', data };
    expect(stopUnconfirmed(data)).toBe(true);
    expect(stopUnconfirmed(reason)).toBe(true);
    expect(terminationProblem(data)).toBeNull(); // not a failed or pending cancel: no cancel was sent yet
    expect(liveDanger(s)).toEqual({ kind: 'stop-unconfirmed', pill: 'Stop not confirmed', title: 'STOP NOT CONFIRMED — GPUs may still be billing', detail: reason });
    expect(sessionMayBeBilling(data)).toBe(true);
    const pills = modePills(s).map((p) => `${p.status}:${p.text}`);
    expect(pills[0]).toBe('billing-risk:Stop not confirmed');
    expect(pills.some((p) => p.startsWith('replay:'))).toBe(false);
    expect(pills).toContain(mode === 'live' ? 'live:LIVE · GPU 0 / GPU 1' : 'rehearsal:Launching…');
  }
  // Found anywhere and in any letter case (a terminate answer puts it after its own words: service.py:378-379),
  // and in a mode where it would make no sense it is still not taken as a clean state.
  expect(stopUnconfirmed(ROUND6.threadStillRunning)).toBe(true);
  expect(stopUnconfirmed(ROUND6.stoppingLive.toUpperCase())).toBe(true);
  expect(sessionMayBeBilling(snapshot('idle', { reason: ROUND6.stoppingLive }))).toBe(true);
  expect(liveDanger({ status: 'ready', data: snapshot('terminated', { reason: ROUND6.stoppingLive }) })?.kind).toBe('stop-unconfirmed');
  // A confirmed stop is not.
  for (const reason of ['Stopped on request; workers terminated.', 'Last session ended: Stopped on request; GPU 0 (bean) terminated; GPU 1 (triangular) never launched. Qualified.']) {
    expect(stopUnconfirmed(reason)).toBe(false);
    expect(liveDanger({ status: 'ready', data: snapshot('idle', { reason }) })).toBeNull();
  }
});

test('A2 L10 FA-2 launch refusals (409) are not billing dangers: nothing was launched', () => {
  for (const reason of [ROUND6.refusedCost, ROUND6.refusedLedger, ROUND6.refusedLedgerKept]) {
    expect(terminationProblem(reason)).toBeNull();
    expect(stopUnconfirmed(reason)).toBe(false);
    expect(liveDanger({ status: 'ready', data: snapshot('idle', { reason }) })).toBeNull();
    expect(sessionMayBeBilling(snapshot('idle', { reason }))).toBe(false);
  }
});

test('A2 L9 connection lost is a danger only when the last valid snapshot was not a clean idle one', () => {
  const lost = (data: LiveStatus): LiveState => ({ status: 'unreachable', message: '/api/live/status: HTTP 502', lastKnown: { data, receivedAt: 0 } });
  for (const mode of ['launching', 'live', 'fallback'] as const) {
    const d = liveDanger(lost(snapshot(mode)));
    expect(d).toMatchObject({ kind: 'connection-lost', pill: 'Connection lost', title: 'CONNECTION LOST — session state unknown' });
    expect(d!.detail).toContain(`mode "${mode}"`);
    expect(d!.detail).toContain('HTTP 502');
    expect(d!.detail).toContain('GPUs may still be billing');
    expect(modePills(lost(snapshot(mode)))).toEqual([{ status: 'billing-risk', text: 'Connection lost' }]);
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

test('A2 L9 mode pills: LIVE only for mode live; danger leads and removes "Replay · $0"; fallback text comes from the backend label', () => {
  const ready = (mode: LiveStatus['mode'], extra: Partial<LiveStatus> = {}): LiveState => ({ status: 'ready', data: snapshot(mode, extra) });
  const text = (s: LiveState) => modePills(s).map((p) => `${p.status}:${p.text}`);
  expect(text(ready('live'))).toEqual(['live:LIVE · GPU 0 / GPU 1']);
  // FA-1: every danger pill is the design system's billing-risk pill (DESIGN.md §5), never `failed`.
  expect(text(ready('live', { reason: `${FAILED}.` }))).toEqual(['billing-risk:TERMINATE FAILED', 'live:LIVE · GPU 0 / GPU 1']);
  expect(text(ready('idle', { reason: `${PENDING}.` }))).toEqual(['billing-risk:TERMINATION PENDING']);
  expect(text(ready('launching', { reason: `${PENDING}.` }))).toEqual(['billing-risk:TERMINATION PENDING', 'rehearsal:Launching…']);
  expect(text(ready('fallback', { reason: `${FAILED}.` }))).toEqual(['billing-risk:TERMINATE FAILED', 'failed:Fallback']);
  for (const mode of ['unavailable', 'idle', 'launching', 'fallback', 'terminated'] as const) {
    expect(modePills(ready(mode)).some((p) => p.status === 'live')).toBe(false);
    expect(modePills(ready(mode, { reason: `${FAILED}.` })).some((p) => p.status === 'live' || p.status === 'replay')).toBe(false);
  }
  const label = (l: string, savedRunId: string | null = null, qualified = true) =>
    snapshot('fallback', { qualified, fallback: { active: true, label: l, savedRunId } });
  const r1 = 'rehearsal-0123456789ab';
  expect(fallbackCause(label(`Worker failed — playing saved GX run ${r1}`, r1))).toBe('Worker failed');
  expect(fallbackCause(label('Hard timeout reached. No qualified GX rehearsal recorded — showing archived stella/GENE evidence'))).toBe('Hard timeout reached');
  expect(fallbackCause(label(''))).toBe('Fallback');
  expect(fallbackCause(label('x'.repeat(41)))).toBe('Fallback');
  // "Playing saved run" needs a run id, a qualified service and a well-formed id (SEED-fe-live-1: the server's own pattern).
  expect(playableSavedRunId(label(`Worker failed — playing saved GX run ${r1}`, r1))).toBe(r1);
  expect(playableSavedRunId(label('Worker failed.', null))).toBeNull();
  expect(playableSavedRunId(label(`Worker failed — playing saved GX run ${r1}`, r1, false))).toBeNull();
  for (const id of ['r 1', 'r1', 'run-1', 'rehearsal-0123456789AB']) {
    expect(playableSavedRunId(label(`Worker failed — playing saved GX run ${id}`, id)), id).toBeNull();
  }
});

/* ---- FE2-3: no "Replay · $0" while a launch from this page or a listed session may be billing ---------- */

test('FE2-3 modePills: a launch in flight, accepted or unknown, or an idle snapshot listing workers, never reads "Replay · $0"', () => {
  const text = (s: LiveState) => modePills(s).map((p) => `${p.status}:${p.text}`);
  const idle = snapshot('idle');
  const ready = (data: LiveStatus, extra: Partial<LiveState> = {}): LiveState => ({ status: 'ready', data, ...extra }) as LiveState;
  const pending = { gpuIndex: 0 as const, deviceId: '', tube: 'bean' as const, state: 'pending' as const, simTime: null, samples: [] };
  // The state before: plain replay.
  expect(text(ready(idle))).toEqual(['replay:Replay · $0']);
  // A launch POST from this page that may have started a session (FA-4 phases).
  expect(text(ready(idle, { launchLocked: true, launchPhase: 'sent' }))).toEqual(['rehearsal:Launching…']);
  expect(text(ready(idle, { launchLocked: true, launchPhase: 'accepted' }))).toEqual(['rehearsal:Launching…']);
  expect(text(ready(idle, { launchLocked: true, launchPhase: 'unknown' }))).toEqual(['replay:Checking status…']);
  // A refusal launched nothing: replay at $0 again.
  expect(text(ready(idle, { launchLocked: true, launchPhase: 'refused' }))).toEqual(['replay:Replay · $0']);
  // The 202 answer's own snapshot: a new session, still mode "idle", lists its pending workers.
  expect(text(ready(snapshot('idle', { workers: [pending, { ...pending, gpuIndex: 1, tube: 'triangular' }] })))).toEqual(['rehearsal:Launching…']);
  // Other modes that still list workers (the session thread has not finished): not known to be $0.
  for (const mode of ['terminated', 'unavailable'] as const) {
    expect(text(ready(snapshot(mode, { workers: [pending] }))), mode).toEqual(['replay:Checking status…']);
  }
  // A launch sent from a settled fallback (cross-RX-4): the cause stays, "Replay · $0" goes.
  const fb = snapshot('fallback', { fallback: { active: true, label: 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null } });
  expect(text(ready(fb))).toEqual(['failed:Worker failed', 'replay:Replay · $0']);
  expect(text(ready(fb, { launchLocked: true, launchPhase: 'sent' }))).toEqual(['failed:Worker failed', 'rehearsal:Launching…']);
  // Nothing of this kind anywhere: no pill text with "$0" while sessionMayBeBilling or launchMayBeRunning holds.
  for (const s of [ready(idle, { launchPhase: 'sent' }), ready(idle, { launchPhase: 'accepted' }), ready(idle, { launchPhase: 'unknown' }), ready(snapshot('idle', { workers: [pending] }))]) {
    expect(modePills(s).some((p) => p.text.includes('$0'))).toBe(false);
  }
});

/* ---- FE2-4: the store's epoch guard ------------------------------------------------------------------- */

test('FE2-4 a request from before a reset neither applies its answer nor clears the in-flight flag of the new epoch', async () => {
  const waiting: ((r: Response) => void)[] = [];
  const slow = (() => new Promise<Response>((resolve) => waiting.push(resolve))) as unknown as typeof fetch;
  const store = createLiveStatusStore({ fetchImpl: slow, backoff: false });
  const stopA = store.subscribe(() => {}, 2000); // request 1 (timeout 1500 ms), held
  await advance(0);
  expect(waiting).toHaveLength(1);
  stopA(); // the last subscriber leaves: reset (e.g. StrictMode's dev double mount)
  const stopB = store.subscribe(() => {}, 2000); // request 2, held
  await advance(0);
  expect(waiting).toHaveLength(2);
  const stopFast = store.subscribe(() => {}, 400); // ticks every 400 ms from now on, while request 2 is open
  waiting[0]!(json(snapshot('live'))); // request 1 answers late
  await advance(0);
  expect(store.getState()).toEqual({ status: 'connecting' }); // its answer is not applied
  await advance(400); // one tick: request 2 is still open, so nothing else may be sent
  expect(waiting).toHaveLength(2);
  await advance(400);
  expect(waiting).toHaveLength(2);
  // Request 2's answer is the one applied.
  waiting[1]!(json(snapshot('idle')));
  await advance(0);
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'idle' } });
  stopFast();
  stopB();
});

/* ---- cross-RX-4: a launch from a settled fallback keeps its lock ------------------------------------------ */

test('cross-RX-4 a launch locked from a fallback snapshot is not released by fallback snapshots that may predate it, only after the answer', async () => {
  const fb = snapshot('fallback', { reason: 'GPU 1 (triangular) worker failed: CUDA error. Other worker terminated.', fallback: { active: true, label: 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null } });
  const b = backend(() => json(fb));
  const store = createLiveStatusStore({ fetchImpl: b.fetch });
  const stop = store.subscribe(() => {}, 2000);
  await advance(0);
  store.lockLaunch();
  // While the POST is on its way the backend may still report the old fallback (the session is not replaced yet).
  await store.refresh();
  expect(store.getState()).toMatchObject({ status: 'ready', data: { mode: 'fallback' }, launchLocked: true, launchPhase: 'sent' });
  store.launchAnswered('accepted');
  // 202: the new session reads idle with its workers, then launching.
  const pending = { gpuIndex: 0 as const, deviceId: '', tube: 'bean' as const, state: 'pending' as const, simTime: null, samples: [] };
  b.next = () => json(snapshot('idle', { workers: [pending] }));
  await store.refresh();
  expect(store.getState()).toMatchObject({ launchLocked: true, launchPhase: 'accepted' });
  b.next = () => json(snapshot('launching'));
  await store.refresh();
  expect(store.getState().launchLocked).toBeUndefined();

  // A snapshot requested after a 202 is the new session's: its own fallback releases the lock.
  b.next = () => json(fb);
  await store.refresh();
  store.lockLaunch();
  store.launchAnswered('accepted');
  await store.refresh();
  expect(store.getState()).toMatchObject({ data: { mode: 'fallback' } });
  expect(store.getState().launchLocked).toBeUndefined();
  stop();
});

/* ---- /api/live/* calls (FE-8) ----------------------------------------------------------------- */

test('L10 postLiveLaunch / postLiveTerminate: ok only for a 2xx answer saying ok:true; the carried status is validated', async () => {
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

test('L9 fetchSavedRun validates the id, the HTTP status and the shape of the run', async () => {
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
  await expect(fetchSavedRun(run.savedRunId, serve({ ...run, savedRunId: 'rehearsal-aaaaaaaaaaaa' }))).rejects.toThrow(/answered with run rehearsal-aaaaaaaaaaaa/);
  // SEED-fe-live-1: an id the server can never answer for is not requested at all (the old pattern let these through).
  for (const id of ['abc', 'run-1', 'rehearsal-0123456789AB', 'live-0123456789ab\n']) {
    await expect(fetchSavedRun(id, serve(run)), id).rejects.toThrow(/not valid/);
  }
  expect(urls).toHaveLength(5);
});
