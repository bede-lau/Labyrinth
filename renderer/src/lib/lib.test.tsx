import { act, renderHook, waitFor } from '@testing-library/react';
import { fetchArtifact, useArtifact, artifactUrl } from './artifacts';
import { fetchLiveStatus, isLive, liveStatusStoreFor, useLiveStatus, type LiveStatus } from './liveStatus';

const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const fail = (status: number) => (async () => new Response('nope', { status })) as unknown as typeof fetch;

test('artifactUrl points at /artifacts/<id>.json', () => {
  expect(artifactUrl('geometry')).toBe('/artifacts/geometry.json');
});

test('fetchArtifact rejects wrong schemaVersion and HTTP errors with the file name', async () => {
  await expect(fetchArtifact('budget', ok({ schemaVersion: 2 }))).rejects.toThrow(/budget\.json.*schemaVersion/);
  await expect(fetchArtifact('budget', fail(404))).rejects.toThrow(/budget\.json: HTTP 404/);
  await expect(fetchArtifact('budget', ok({ schemaVersion: 1, x: 1 }))).resolves.toEqual({ schemaVersion: 1, x: 1 });
});

test('useArtifact goes loading -> error naming the file (never blank)', async () => {
  const f = fail(500);
  const { result } = renderHook(() => useArtifact('spatial', f));
  expect(result.current.status).toBe('loading');
  await waitFor(() => expect(result.current).toMatchObject({ status: 'error', file: 'artifacts/spatial.json' }));
});

test('live status: unreachable backend is not live; only mode=live is live', async () => {
  const f = fail(502);
  const { result } = renderHook(() => useLiveStatus(60_000, f));
  await waitFor(() => expect(result.current.status).toBe('unreachable'));
  expect(isLive(result.current)).toBe(false);
  const base = { schemaVersion: 1, reason: '', budget: { ceilingUsd: 40, billedUsd: 0, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true }, workers: [], fallback: { active: false, label: '', savedRunId: null } };
  expect(isLive({ status: 'ready', data: { ...base, mode: 'fallback' } as never })).toBe(false);
  expect(isLive({ status: 'ready', data: { ...base, mode: 'live' } as never })).toBe(true);
  await expect(fetchLiveStatus(ok({ nope: 1 }))).rejects.toThrow(/bad payload/);
});

/* ---- fix round (status.md §4a FE-4, §4d task 09) ------------------------------------------- */
const snapshot = (mode: LiveStatus['mode'], extra: Partial<LiveStatus> = {}): LiveStatus => ({
  schemaVersion: 1,
  mode,
  reason: `mode ${mode}`,
  budget: { ceilingUsd: 40, billedUsd: 0, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true },
  workers: [],
  fallback: { active: false, label: '', savedRunId: null },
  ...extra,
});
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('fetchLiveStatus rejects partial and wrong-typed bodies as "bad payload" (they must never reach a render)', async () => {
  // The body that blanked the page (tasks/09-app-shell/VERIFY.md finding 2).
  await expect(fetchLiveStatus(ok({ schemaVersion: 1, mode: 'fallback' }))).rejects.toThrow(/bad payload.*reason/);
  await expect(fetchLiveStatus(ok({ schemaVersion: 1, mode: 'live' }))).rejects.toThrow(/bad payload/);
  const { fallback: _f, ...noFallback } = snapshot('fallback');
  await expect(fetchLiveStatus(ok(noFallback))).rejects.toThrow(/bad payload.*fallback/);
  await expect(fetchLiveStatus(ok(snapshot('LIVE' as never)))).rejects.toThrow(/bad payload.*mode/);
  await expect(fetchLiveStatus(ok({ ...snapshot('idle'), workers: null }))).rejects.toThrow(/bad payload.*workers/);
  await expect(fetchLiveStatus(ok({ ...snapshot('idle'), budget: { slotFits: 'yes' } }))).rejects.toThrow(/bad payload.*budget/);
  // HTML with status 200 (a static host answering with index.html) names the endpoint too.
  const html = (async () => new Response('<!doctype html><html></html>', { status: 200 })) as unknown as typeof fetch;
  await expect(fetchLiveStatus(html)).rejects.toThrow(/\/api\/live\/status/);
  // A complete snapshot still resolves unchanged.
  await expect(fetchLiveStatus(ok(snapshot('live')))).resolves.toEqual(snapshot('live'));
});

test('fetchLiveStatus never accepts a non-2xx answer, even when it carries a valid live body', async () => {
  for (const code of [404, 409, 500, 502]) {
    const f = (async () => respond(snapshot('live'), code)) as unknown as typeof fetch;
    await expect(fetchLiveStatus(f)).rejects.toThrow(new RegExp(`/api/live/status: HTTP ${code}`));
  }
});

test('LIVE is never sticky: a failed poll after a live one is unreachable, not live', async () => {
  let up = true;
  const f = (async () => {
    if (!up) throw new TypeError('Failed to fetch');
    return respond(snapshot('live'));
  }) as unknown as typeof fetch;
  const { result } = renderHook(() => useLiveStatus(60_000, f));
  await waitFor(() => expect(isLive(result.current)).toBe(true));
  // The very next poll fails: LIVE is gone with that answer (not later, through the staleness rule),
  // and the last snapshot is kept so the app can say what was running.
  up = false;
  await act(() => liveStatusStoreFor(f).refresh());
  expect(isLive(result.current)).toBe(false);
  expect(result.current).toMatchObject({ status: 'unreachable', cause: 'network', message: 'Failed to fetch', lastKnown: { data: { mode: 'live' } } });
});

test('a slow older answer never overwrites a newer one (no LIVE from a stale response)', async () => {
  let releaseFirst: (r: Response) => void = () => {};
  let calls = 0;
  const f = (async () => {
    calls += 1;
    if (calls === 1) return new Promise<Response>((res) => (releaseFirst = res));
    return respond(snapshot('terminated'));
  }) as unknown as typeof fetch;
  // The first poll is still waiting when a second request (as after a POST) is sent and answered.
  const { result } = renderHook(() => useLiveStatus(60_000, f));
  expect(calls).toBe(1);
  await act(() => liveStatusStoreFor(f).refresh());
  expect(calls).toBe(2);
  expect(result.current).toMatchObject({ status: 'ready', data: { mode: 'terminated' } });
  // Now the first request answers "live": it is older than what is on screen and must be dropped.
  await act(async () => {
    releaseFirst(respond(snapshot('live')));
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(isLive(result.current)).toBe(false);
  expect(result.current).toMatchObject({ status: 'ready', data: { mode: 'terminated' } });
});

test('a hung backend becomes unreachable within the abort timeout and requests do not stack up', async () => {
  let pending = 0;
  let maxPending = 0;
  const f = ((_input: RequestInfo | URL, init?: RequestInit) => {
    pending += 1;
    maxPending = Math.max(maxPending, pending);
    init?.signal?.addEventListener('abort', () => (pending -= 1));
    return new Promise<Response>(() => {}); // never answers
  }) as unknown as typeof fetch;
  const { result, unmount } = renderHook(() => useLiveStatus(40, f));
  await waitFor(() => expect(result.current.status).toBe('unreachable'));
  expect(result.current).toMatchObject({ cause: 'timeout', message: expect.stringMatching(/no answer within 30 ms/) });
  expect(maxPending).toBe(1);
  unmount();

  // The dangerous case: the backend answered "live" once and then hangs. LIVE must not stay on frozen
  // data, polling continues at the normal pace (the session may be billing), and requests never pile up.
  pending = 0;
  maxPending = 0;
  let calls = 0;
  const liveThenHang = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return calls === 1 ? Promise.resolve(respond(snapshot('live'))) : f(input, init);
  }) as unknown as typeof fetch;
  const second = renderHook(() => useLiveStatus(40, liveThenHang));
  await waitFor(() => expect(isLive(second.result.current)).toBe(true));
  await waitFor(() => expect(second.result.current.status).toBe('unreachable'));
  expect(second.result.current).toMatchObject({ cause: 'timeout', lastKnown: { data: { mode: 'live' } } });
  const seen = calls;
  await waitFor(() => expect(calls).toBeGreaterThanOrEqual(seen + 3));
  expect(maxPending).toBe(1);
  expect(isLive(second.result.current)).toBe(false);
});
