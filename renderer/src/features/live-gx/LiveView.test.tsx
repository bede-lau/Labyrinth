import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveState, LiveStatus, LiveWorker, SavedRun } from '../../lib/liveStatus';
import { LiveView } from './LiveView';
import { canLaunch, canTerminate, clockAdvance, overlapClaim, savedRunQualified, trackClocks } from './model';

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

const TRANSPORT = readFileSync(resolve(__dirname, '../../../../artifacts/transport.json'), 'utf8');

function status(mode: LiveStatus['mode'], over: Partial<LiveStatus> = {}): LiveStatus {
  return {
    schemaVersion: 1,
    mode,
    reason: `mode ${mode}`,
    qualified: false,
    budget: { ceilingUsd: 40, billedUsd: 8.1, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true, hardTimeoutS: 1500 },
    workers: [],
    fallback: { active: false, label: '', savedRunId: null },
    ...over,
  };
}
const worker = (gpuIndex: 0 | 1, simTime: number, n: number, over: Partial<LiveWorker> = {}): LiveWorker => ({
  gpuIndex,
  deviceId: gpuIndex === 0 ? 'GPU-0a1b2c3d-bean' : 'GPU-9f8e7d6c-tri',
  tube: gpuIndex === 0 ? 'bean' : 'triangular',
  state: 'running',
  simTime,
  wallStart: '2026-11-20T10:00:00Z',
  samples: Array.from({ length: n }, (_, i) => ({ t: (i + 1) * 1.4, Q: 2 + i * 0.01 })),
  ...over,
});
const liveNow = (over: Partial<LiveStatus> = {}) =>
  status('live', { qualified: true, reason: 'Both workers launched; streaming GX output (live).', workers: [worker(0, 100, 4), worker(1, 98, 3)], ...over });

const SAVED: SavedRun = {
  savedRunId: 'rehearsal-0123456789ab',
  initVerified: true,
  continuationVerified: true,
  checks: { init: true, continuation: true, distinctDevices: true, overlap: true },
  phases: [
    status('live', { workers: [worker(0, 50, 3), worker(1, 48, 2)] }),
    status('live', { workers: [worker(0, 100, 3, { samples: [{ t: 60, Q: 2.4 }] }), worker(1, 96, 1)] }),
  ],
};

const FAILED = 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing';
const PENDING = 'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs may still be billing';

type Answer = { code: number; body: unknown } | 'network-error' | 'hang';
interface Server {
  status: LiveStatus | null | (() => LiveStatus | null);
  launch: Answer;
  terminate: Answer;
  savedRun: unknown;
  posts: { url: string; init: RequestInit }[];
}
let server: Server;

function answer(a: Answer): Promise<Response> | Response {
  if (a === 'network-error') throw new TypeError('Failed to fetch');
  if (a === 'hang') return new Promise<Response>(() => {});
  return new Response(JSON.stringify(a.body), { status: a.code });
}

beforeEach(() => {
  plotly.react.mockClear();
  server = {
    status: null,
    launch: { code: 202, body: { ok: true, reason: 'Launched live-abc; $2.65 reserved as pending.' } },
    terminate: { code: 200, body: { ok: true, reason: 'Workers terminated.' } },
    savedRun: SAVED,
    posts: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        server.posts.push({ url, init });
        if (url === '/api/live/launch') return answer(server.launch);
        if (url === '/api/live/terminate') return answer(server.terminate);
      }
      if (url === '/artifacts/transport.json') return new Response(TRANSPORT, { status: 200 });
      if (url === '/api/live/status') {
        const s = typeof server.status === 'function' ? server.status() : server.status;
        return s ? new Response(JSON.stringify(s)) : new Response('Bad gateway', { status: 502 });
      }
      if (url === `/api/live/runs/${SAVED.savedRunId}`) return new Response(JSON.stringify(server.savedRun));
      return new Response(JSON.stringify({ ok: false, reason: 'not found' }), { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const pills = () => screen.getByTestId('mode-pills');
const pillList = () => [...pills().querySelectorAll<HTMLElement>('.lab-pill')].map((p) => `${p.dataset.status}:${p.textContent}`);
const launchButton = () => screen.getByRole('button', { name: /^Launch/ });
const postsTo = (url: string) => server.posts.filter((p) => p.url === url);
const settle = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

/* ============================== L9 ============================================================ */

test('L9 unreachable / unavailable / fallback show an unmistakable label and play the replay (never LIVE)', async () => {
  // 1. API unreachable (static replay build).
  const a = render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByText('REPLAY — live API unreachable')).toBeInTheDocument();
  expect(within(pills()).getByText('Replay · $0')).toBeInTheDocument();
  expect(await screen.findByTestId('playback-label')).toHaveTextContent('Playing: archived stella/GENE evidence');
  expect(screen.queryByText(/^LIVE/)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull(); // no session was ever seen: nothing to be alarmed about
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeDisabled();
  a.unmount();

  // 2. unavailable: reason and fallback label shown; archived evidence plays.
  server.status = status('unavailable', {
    reason: 'No Modal credentials. Live GX is UNREHEARSED (D-011).',
    fallback: { active: true, label: 'No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null },
  });
  const b = render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByText('REPLAY — live GX unavailable')).toBeInTheDocument();
  expect(screen.getByText(/No Modal credentials/)).toBeInTheDocument();
  expect(await screen.findByTestId('playback-label')).toHaveTextContent('No qualified GX rehearsal recorded');
  expect(screen.queryByText(/^LIVE/)).toBeNull();
  b.unmount();

  // 3. fallback with a qualified saved run: fetched and labelled as a saved rehearsal (not live).
  server.status = status('fallback', {
    qualified: true,
    reason: 'GPU 1 (triangular) worker failed: CUDA error. Other worker terminated.',
    workers: [worker(0, 80, 5, { state: 'done' }), worker(1, 40, 2, { state: 'failed', error: 'CUDA error' })],
    fallback: { active: true, label: `Worker failed — playing saved GX run ${SAVED.savedRunId}`, savedRunId: SAVED.savedRunId },
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByText('FALLBACK — Worker failed')).toBeInTheDocument();
  expect(pillList()).toEqual(['failed:Worker failed', 'replay:Playing saved run']);
  expect(await screen.findByTestId('playback-label')).toHaveTextContent(`Playing: saved GX rehearsal run ${SAVED.savedRunId}`);
  expect(screen.getByText('Worker error: CUDA error')).toBeInTheDocument();
  expect(screen.queryByText(/^LIVE/)).toBeNull();
  expect(savedRunQualified({ ...SAVED, checks: { ...SAVED.checks, overlap: false } })).toBe(false);
});

test('L9 fallback shows the cause the backend reports (a hard timeout is not "Worker failed"), and no saved run is claimed when none exists', async () => {
  server.status = status('fallback', {
    qualified: true,
    reason: 'Hard timeout reached: 1500 s elapsed before both workers finished; workers terminated.',
    workers: [worker(0, 80, 5), worker(1, 40, 2)],
    fallback: { active: true, label: `Hard timeout reached — playing saved GX run ${SAVED.savedRunId}`, savedRunId: SAVED.savedRunId },
  });
  const a = render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByText('FALLBACK — Hard timeout reached')).toBeInTheDocument();
  expect(pillList()).toEqual(['failed:Hard timeout reached', 'replay:Playing saved run']);
  expect(screen.queryByText(/Worker failed/)).toBeNull();
  // The timed-out workers still read "running" (their last report): that is not evidence of execution.
  expect(screen.getByTestId('overlap')).toHaveTextContent('Concurrent execution not shown: the session is not live');
  expect(screen.getByTestId('overlap')).not.toHaveTextContent(/executing concurrently/);
  a.unmount();

  server.status = status('fallback', {
    reason: 'GPU 0 (bean) worker failed: launch failed. Other worker terminated.',
    fallback: { active: true, label: 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null },
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByText('FALLBACK — Worker failed')).toBeInTheDocument();
  expect(pillList()).toEqual(['failed:Worker failed', 'replay:Replay · $0']);
  expect(screen.queryByText('Playing saved run')).toBeNull();
  expect(await screen.findByTestId('playback-label')).toHaveTextContent('Playing: archived stella/GENE evidence');
});

test('L9 live shows both device IDs, GPU 0 = bean / GPU 1 = triangular, advancing sim clocks and sample counts', async () => {
  let n = 0;
  // Every poll is a new reading: both clocks move by a fixed step and one more sample arrives.
  server.status = () => {
    n += 1;
    return liveNow({ workers: [worker(0, 100 + 12.5 * n, 4 + n), worker(1, 98 + 11 * n, 3 + n)] });
  };
  render(<LiveView pollMs={40} autoPlay={false} />);
  expect(await screen.findByText('LIVE · GPU 0 / GPU 1')).toBeInTheDocument();
  const g0 = screen.getByTestId('worker-0');
  const g1 = screen.getByTestId('worker-1');
  expect(g0).toHaveAccessibleName('GPU 0, bean tube');
  expect(g1).toHaveAccessibleName('GPU 1, triangular tube');
  expect(within(g0).getByTestId('device-0')).toHaveTextContent('GPU-0a1b2c3d-bean');
  expect(within(g1).getByTestId('device-1')).toHaveTextContent('GPU-9f8e7d6c-tri');
  expect(within(g0).getByRole('group', { name: /^GPU 0 flux samples: \d+/ })).toBeInTheDocument();
  expect(within(g1).getByRole('group', { name: /^GPU 1 flux samples: \d+/ })).toBeInTheDocument();
  expect(screen.getByTestId('overlap')).toHaveTextContent('Both solvers are executing concurrently on separate devices.');
  expect(screen.queryByTestId('playback-label')).toBeNull(); // live: no replay is presented as current

  // Two timestamped readings later: both clocks are advancing, by the step between the readings.
  await waitFor(() => expect(screen.getByTestId('clock-0')).toHaveTextContent(/^Clock advancing: \+12\.5 .* between two readings \d+\.\d s apart/));
  expect(screen.getByTestId('clock-0')).toHaveAttribute('data-advancing', 'true');
  expect(screen.getByTestId('clock-1')).toHaveTextContent(/^Clock advancing: \+11\.0 /);
  // The sim clock and the sample count on screen follow the newest reading (the first one was 112.5 / 5 samples).
  const clock = () => within(screen.getByTestId('worker-0')).getByRole('group', { name: /^GPU 0 sim clock/ });
  const samples = () => within(screen.getByTestId('worker-0')).getByRole('group', { name: /^GPU 0 flux samples/ });
  await waitFor(() => expect(Number(/sim clock: ([\d.]+)/.exec(clock().getAttribute('aria-label') ?? '')?.[1])).toBeGreaterThanOrEqual(137.5));
  expect(Number(/flux samples: (\d+)/.exec(samples().getAttribute('aria-label') ?? '')?.[1])).toBeGreaterThanOrEqual(7);
});

test('L9 a stalled worker is not reported as advancing: the claim needs two successive readings that differ', async () => {
  let n = 0;
  let frozen = false;
  server.status = () => {
    if (!frozen) n += 1;
    return liveNow({ workers: [worker(0, 100 + 12.5 * n, 4), worker(1, 98 + 11 * n, 3)] });
  };
  render(<LiveView pollMs={40} autoPlay={false} />);
  await waitFor(() => expect(screen.getByTestId('clock-0')).toHaveTextContent(/^Clock advancing: \+12\.5/));
  // The backend keeps answering, but the solver clocks stop.
  frozen = true;
  await waitFor(() => expect(screen.getByTestId('clock-0')).toHaveTextContent(/^Clock not advancing: unchanged/));
  expect(screen.getByTestId('clock-0')).toHaveAttribute('data-advancing', 'false');
  expect(screen.getByTestId('clock-1')).toHaveTextContent(/^Clock not advancing/);
  expect(screen.queryByText(/Clock advancing/)).toBeNull();
  // And it stays that way over further polls (the old code kept the last positive step forever).
  await settle(150);
  expect(screen.getByTestId('clock-0')).toHaveTextContent(/^Clock not advancing/);
});

test('L9 clock and overlap claims are evidence-based (pure): timestamps per reading, running + distinct non-empty device IDs', () => {
  // One reading proves nothing.
  const c1 = trackClocks({}, [worker(0, 5, 1)], 1_000);
  expect(clockAdvance(c1[0])).toBeNull();
  // The same snapshot processed twice (same timestamp) is still one reading.
  expect(trackClocks(c1, [worker(0, 5, 1)], 1_000)).toEqual(c1);
  // A later reading with a larger clock: advancing, by the difference, over the time between the readings.
  const c2 = trackClocks(c1, [worker(0, 7.5, 2)], 3_000);
  expect(clockAdvance(c2[0])).toEqual({ delta: 2.5, overMs: 2_000 });
  // A later reading with the same clock: stalled (delta 0), not the old +2.5.
  const c3 = trackClocks(c2, [worker(0, 7.5, 2)], 5_000);
  expect(clockAdvance(c3[0])).toEqual({ delta: 0, overMs: 2_000 });
  // A worker with no clock yet gives no claim either way.
  const c4 = trackClocks(c3, [worker(0, null as unknown as number, 0)], 7_000);
  expect(clockAdvance(c4[0])).toBeNull();

  const two = (a: Partial<LiveWorker>, b: Partial<LiveWorker>, live = true) => overlapClaim([worker(0, 1, 1, a), worker(1, 1, 1, b)], live);
  expect(two({}, {})).toMatchObject({ concurrent: true, sameDevice: false });
  // Outside a live session the states are only the last ones reported: no claim (a worker terminated
  // by a fallback can still read "running").
  expect(two({}, {}, false)).toMatchObject({ concurrent: false, sameDevice: false });
  expect(two({}, {}, false).text).toMatch(/^Concurrent execution not shown: the session is not live/);
  // `initializing` is not executing.
  expect(two({}, { state: 'initializing' })).toMatchObject({ concurrent: false, sameDevice: false });
  expect(two({ state: 'done' }, {})).toMatchObject({ concurrent: false });
  // No device ID yet: neither a concurrency claim nor a same-device warning.
  expect(two({ deviceId: '' }, { deviceId: '' })).toMatchObject({ concurrent: false, sameDevice: false });
  expect(two({}, { deviceId: '' })).toMatchObject({ concurrent: false, sameDevice: false });
  // The same real device twice: a warning, and never "concurrently on separate devices".
  expect(two({ deviceId: 'GPU-same' }, { deviceId: 'GPU-same' })).toMatchObject({ concurrent: false, sameDevice: true });
  expect(overlapClaim([worker(0, 1, 1)], true)).toMatchObject({ concurrent: false, sameDevice: false });
});

test('L9 overlap text: no "executing concurrently" for an initializing worker, and no same-device warning before both IDs exist', async () => {
  server.status = liveNow({ workers: [worker(0, 10, 1), worker(1, 0, 0, { state: 'initializing', deviceId: '' })] });
  const a = render(<LiveView pollMs={60_000} autoPlay={false} />);
  const overlap = await screen.findByTestId('overlap');
  expect(overlap).toHaveTextContent('Concurrent execution not shown: 1 of 2 workers running');
  expect(overlap).not.toHaveTextContent(/executing concurrently/);
  expect(overlap).not.toHaveTextContent(/same device/);
  expect(screen.getByTestId('device-1')).toHaveTextContent('not reported yet');
  a.unmount();

  // Both running, both IDs still empty: the old code warned "same device ID" here.
  server.status = liveNow({ workers: [worker(0, 10, 1, { deviceId: '' }), worker(1, 9, 1, { deviceId: '' })] });
  const b = render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByTestId('overlap')).toHaveTextContent('Concurrent execution not shown: device ID not reported yet');
  expect(screen.getByTestId('overlap')).not.toHaveTextContent(/same device|executing concurrently/);
  b.unmount();

  // Both running on one reported device: the warning, and no concurrency claim beside it.
  server.status = liveNow({ workers: [worker(0, 10, 1, { deviceId: 'GPU-same' }), worker(1, 9, 1, { deviceId: 'GPU-same' })] });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByTestId('overlap')).toHaveTextContent('Warning: both workers report the same device ID.');
  expect(screen.getByTestId('overlap')).not.toHaveTextContent(/executing concurrently/);
});

test.each([
  ['live', 'TERMINATE FAILED', `${FAILED}: GPU 0 (bean) terminate unconfirmed after 4 attempts: boom. Stopped on request.`],
  ['live', 'TERMINATION PENDING', `${PENDING}: GPU 1 (triangular) termination pending: late spawn. Both workers launched.`],
  ['fallback', 'TERMINATE FAILED', `${FAILED}: GPU 0 (bean) terminate unconfirmed after 4 attempts: boom. GPU 1 worker failed.`],
  ['fallback', 'TERMINATION PENDING', `${PENDING}: GPU 1 (triangular) termination pending: late spawn. GPU 0 worker failed.`],
  ['terminated', 'TERMINATION PENDING', `Session thread still running after 497 s; termination unconfirmed. ${PENDING}: GPU 1 (triangular).`],
] as const)('L9 mode %s whose reason contains %s is a danger alert titled from the marker, never just a badge', async (mode, marker, reason) => {
  server.status = status(mode, {
    qualified: true,
    reason,
    workers: [worker(0, 300, 9, { state: 'done' }), worker(1, 290, 9, { state: 'done' })],
    fallback: { active: mode === 'fallback', label: mode === 'fallback' ? 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence' : '', savedRunId: null },
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const alert = await screen.findByTestId('terminate-failed');
  expect(alert).toHaveAttribute('role', 'alert');
  expect(alert).toHaveTextContent(`${marker} — GPUs may still be billing`);
  expect(alert).toHaveTextContent(reason);
  expect(alert).toHaveTextContent('check the Modal dashboard');
  // The pills lead with the danger; "Replay · $0" is never shown beside it.
  expect(pillList()[0]).toBe(`failed:${marker}`);
  expect(pillList().some((p) => p.startsWith('replay:'))).toBe(false);
  expect(pillList().filter((p) => p.startsWith('live:'))).toHaveLength(mode === 'live' ? 1 : 0);
  expect(screen.getByRole('button', { name: 'Retry terminate' })).toBeEnabled();
  expect(launchButton()).toBeDisabled();
});

test('L9 a live session that stops answering reads "connection lost — session state unknown", keeps Terminate enabled and drops LIVE', async () => {
  server.status = liveNow();
  render(<LiveView pollMs={40} autoPlay={false} />);
  expect(await screen.findByText('LIVE · GPU 0 / GPU 1')).toBeInTheDocument();
  server.status = null; // the API goes away mid-session
  const alert = await screen.findByTestId('connection-lost');
  expect(alert).toHaveAttribute('role', 'alert');
  expect(alert).toHaveTextContent(/CONNECTION LOST — session state unknown/);
  expect(alert).toHaveTextContent(/mode "live"/);
  expect(alert).toHaveTextContent('GPUs may still be billing');
  expect(pillList()).toEqual(['failed:Connection lost']);
  expect(screen.queryByText(/^LIVE/)).toBeNull();
  expect(screen.getByTestId('mode-banner')).not.toHaveTextContent(/REPLAY|\$0/);
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeEnabled();
  expect(launchButton()).toBeDisabled();
  expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent(/session state is unknown/);
  // Terminate can still be sent, and its confirmed answer is shown.
  await userEvent.setup().click(screen.getByRole('button', { name: 'Terminate' }));
  expect(await screen.findByText('Terminate confirmed: Workers terminated.')).toBeInTheDocument();
  expect(postsTo('/api/live/terminate')).toHaveLength(1);
});

test('L9 a saved run with a broken shape is rejected by the loader and archived evidence plays instead (FE-8)', async () => {
  const fallback = status('fallback', {
    qualified: true,
    reason: 'GPU 1 (triangular) worker failed: CUDA error. Other worker terminated.',
    fallback: { active: true, label: `Worker failed — playing saved GX run ${SAVED.savedRunId}`, savedRunId: SAVED.savedRunId },
  });
  for (const broken of [
    { savedRunId: SAVED.savedRunId, initVerified: true }, // partial: used to crash the view
    { ...SAVED, phases: [{ schemaVersion: 1, mode: 'live' }] }, // phases must be full status snapshots
    { ...SAVED, checks: { ...SAVED.checks, overlap: 'yes' } },
    { ...SAVED, savedRunId: 'another-run' }, // not the run that was asked for
  ]) {
    server.status = fallback;
    server.savedRun = broken;
    const r = render(<LiveView pollMs={60_000} autoPlay={false} />);
    expect(await screen.findByRole('note', { name: new RegExp(`Saved run ${SAVED.savedRunId} could not be loaded`) })).toBeInTheDocument();
    expect(await screen.findByTestId('playback-label')).toHaveTextContent('Playing: archived stella/GENE evidence');
    expect(screen.queryByText(/saved GX rehearsal run/)).toBeNull();
    r.unmount();
  }
});

test('DS-21 replay panel: one "Replay · $0" pill, an icon on the mode banner, and "latest Q" carries its unit', async () => {
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await screen.findByTestId('playback-label');
  const replay = screen.getByRole('region', { name: 'Replay: archived stella and GENE bean traces' });
  expect(within(replay).getAllByText('Replay · $0')).toHaveLength(1);
  expect(screen.getByTestId('mode-banner').querySelector('svg[data-icon="replay"]')).not.toBeNull();
  const notes = [...replay.querySelectorAll('.lab-stat__note')].filter((n) => /latest Q/.test(n.textContent ?? ''));
  expect(notes).toHaveLength(2); // stella and GENE
  for (const note of notes) {
    expect(note.textContent).toMatch(/latest Q = \d+\.\d{3}\sQgB,i$/);
    expect(note.querySelector('sub')).toHaveTextContent('gB,i');
  }
});

/* ============================== L10 =========================================================== */

test.each([
  ['the API is unreachable', null, /not reachable/],
  ['mode unavailable', status('unavailable'), /Launch needs mode "idle"; the API reports "unavailable"/],
  ['mode launching', status('launching'), /the API reports "launching"/],
  ['mode live', liveNow(), /the API reports "live"/],
  ['mode fallback', status('fallback'), /the API reports "fallback"/],
  ['mode terminated', status('terminated'), /the API reports "terminated"/],
  ['idle but the slot does not fit', status('idle', { budget: { ...status('idle').budget, slotFits: false } }), /does not fit under the budget ceiling/],
  ['idle but a termination is unconfirmed', status('idle', { reason: `${PENDING}: GPU 0 (bean).` }), /termination is unconfirmed/],
  ['idle but a session object still holds workers', status('idle', { workers: [worker(0, 0, 0, { state: 'pending', deviceId: '' })] }), /still lists workers/],
] as const)('L10 Launch is disabled when %s', async (_name, s, why) => {
  server.status = s;
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await screen.findByTestId('mode-banner');
  await waitFor(() => expect(screen.queryByText(/connecting to the live API/)).toBeNull());
  expect(launchButton()).toBeDisabled();
  expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent(why);
  await userEvent.setup().click(launchButton());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(server.posts).toHaveLength(0);
});

test('L10 Launch is enabled only for mode idle with budget.slotFits on a fresh snapshot', async () => {
  server.status = status('idle', { qualified: true });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  expect(screen.queryByText(/^Launch disabled:/)).toBeNull();

  // Pure rule, including freshness: the same idle snapshot stops permitting a launch once it is old.
  const idle = status('idle', { qualified: true });
  const at = 1_000_000;
  const ready = (data: LiveStatus, extra: Partial<Extract<LiveState, { status: 'ready' }>> = {}): LiveState => ({
    status: 'ready',
    data,
    receivedAt: at,
    freshForMs: 5_500,
    ...extra,
  });
  expect(canLaunch(ready(idle), at + 5_500)).toBe(true);
  expect(canLaunch(ready(idle), at + 5_501)).toBe(false); // stale
  expect(canLaunch({ status: 'ready', data: idle }, at)).toBe(false); // no timestamp: freshness unknown
  expect(canLaunch(ready(idle, { launchLocked: true }), at)).toBe(false); // a launch was already posted
  expect(canLaunch(ready({ ...idle, budget: { ...idle.budget, slotFits: false } }), at)).toBe(false);
  expect(canLaunch(ready({ ...idle, budget: { ...idle.budget, slotFits: 'true' as unknown as boolean } }), at)).toBe(false);
  for (const mode of ['unavailable', 'launching', 'live', 'fallback', 'terminated'] as const) {
    expect(canLaunch(ready(status(mode)), at)).toBe(false);
  }
  expect(canLaunch({ status: 'unreachable', message: 'x', lastKnown: { data: idle, receivedAt: at } }, at)).toBe(false);
  expect(canLaunch({ status: 'connecting' }, at)).toBe(false);
});

test('L10 launch requires an explicit confirmation showing the slot cost and POSTs confirmCostUsd as JSON', async () => {
  const user = userEvent.setup();
  server.status = status('idle', { qualified: true, reason: 'Qualified.' });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const launch = await screen.findByRole('button', { name: 'Launch live slot…' });
  await waitFor(() => expect(launch).toBeEnabled());

  // Cancel (Escape) sends nothing and returns focus.
  await user.click(launch);
  let dialog = screen.getByRole('dialog', { name: 'Launch a live GX slot?' });
  expect(within(dialog).getByTestId('confirm-cost')).toHaveTextContent('$2.65');
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(launch).toHaveFocus();
  expect(server.posts).toHaveLength(0);

  // Confirm (keyboard): one POST with the exact slot estimate.
  await user.keyboard('{Enter}');
  dialog = screen.getByRole('dialog', { name: 'Launch a live GX slot?' });
  expect(dialog).toHaveTextContent('Billed $8.10 + pending $0.00 + this slot $2.65 = $10.75 of the $40.00 ceiling.');
  await user.tab();
  expect(within(dialog).getByRole('button', { name: 'Confirm launch — $2.65' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(server.posts).toHaveLength(1));
  const post = server.posts[0]!;
  expect(post.url).toBe('/api/live/launch');
  expect((post.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  expect(JSON.parse(String(post.init.body))).toEqual({ confirmCostUsd: 2.65 });
  expect(await screen.findByText(/Launch accepted:/)).toBeInTheDocument();
});

test('L10 the confirmation shows the exact number it sends, even when the estimate is not a whole cent', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true });
  server.status = { ...idle, budget: { ...idle.budget, slotEstimateUsd: 2.654 } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByTestId('confirm-cost')).toHaveTextContent(/^\$2\.654$/);
  await user.click(within(dialog).getByRole('button', { name: 'Confirm launch — $2.654' }));
  await waitFor(() => expect(server.posts).toHaveLength(1));
  expect(JSON.parse(String(server.posts[0]!.init.body))).toEqual({ confirmCostUsd: 2.654 });
});

test('L10 no double submit: two confirm clicks in one frame send one POST', async () => {
  const user = userEvent.setup();
  server.status = status('idle', { qualified: true });
  server.launch = 'hang'; // the request stays in flight
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm launch — $2.65' });
  // Both clicks are dispatched before React re-renders (a real double click).
  act(() => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  await settle(30);
  expect(postsTo('/api/live/launch')).toHaveLength(1);
  // While the request is in flight nothing more can be sent, and Terminate is available.
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(launchButton()).toBeDisabled();
  expect(launchButton()).toHaveTextContent('Launching…');
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeEnabled();
});

test('L10 after an accepted POST the control stays disabled while the API still reads idle, until the mode changes', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true, reason: 'Qualified.' });
  server.status = idle;
  // The backend answers 202 while its status still reads idle (the session thread has not started the workers yet).
  server.launch = { code: 202, body: { ok: true, reason: 'Launched live-abc; $2.65 reserved as pending.', status: idle } };
  render(<LiveView pollMs={40} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  expect(await screen.findByText(/Launch accepted:/)).toBeInTheDocument();
  // Several fresh idle snapshots later the button is still disabled: no second POST is possible.
  await settle(200);
  expect(launchButton()).toBeDisabled();
  expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent(/already sent/);
  await user.click(launchButton());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(postsTo('/api/live/launch')).toHaveLength(1);
  // An accepted launch may hold GPUs: Terminate is available even though the status still says idle.
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeEnabled();

  // The mode changes (launching -> live): still disabled, now because of the mode.
  server.status = status('launching', { qualified: true });
  await waitFor(() => expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent(/the API reports "launching"/));
  expect(launchButton()).toBeDisabled();
  // Back to a clean idle after the session: the lock is released with the mode change.
  server.status = idle;
  await waitFor(() => expect(launchButton()).toBeEnabled());
});

test('L10 after a refused POST (409) the control also stays disabled; the refusal is shown and its status applied', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true });
  server.status = idle;
  const reason = 'confirmCostUsd must equal the current slot estimate $2.70 (got 2.65).';
  server.launch = { code: 409, body: { ok: false, reason, status: { ...idle, reason: 'Qualified. Estimate updated.', budget: { ...idle.budget, slotEstimateUsd: 2.7 } } } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  const refused = await screen.findByText(/Launch refused:/);
  expect(refused).toHaveAttribute('role', 'alert');
  expect(refused).toHaveTextContent(reason);
  // The status carried by the answer is on screen (no stale idle snapshot from before the POST).
  expect(screen.getByTestId('budget-line')).toHaveTextContent('next slot $2.70');
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('Estimate updated.');
  expect(launchButton()).toBeDisabled();
  expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent(/already sent/);
  expect(postsTo('/api/live/launch')).toHaveLength(1);
});

test('L10 a launch request with no answer leaves the session state unknown: alert, Terminate enabled, no second launch', async () => {
  const user = userEvent.setup();
  server.status = status('idle', { qualified: true });
  server.launch = 'network-error';
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  const alert = await screen.findByTestId('launch-unknown');
  expect(alert).toHaveAttribute('role', 'alert');
  expect(alert).toHaveTextContent(/No response from \/api\/live\/launch/);
  expect(alert).toHaveTextContent(/a session may have started/);
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeEnabled();
  expect(launchButton()).toBeDisabled();
});

test('L10 the confirmation closes itself when launching stops being allowed or the cost changes; nothing is sent', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true });
  server.status = idle;
  render(<LiveView pollMs={40} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());

  // 1. The slot stops fitting while the dialog is open.
  await user.click(launchButton());
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  server.status = { ...idle, budget: { ...idle.budget, pendingUsd: 30, slotFits: false } };
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status', { name: 'Launch confirmation closed' })).toHaveTextContent(/does not fit under the budget ceiling/);
  expect(launchButton()).toBeDisabled();

  // 2. Allowed again, then the estimate changes under the open dialog: the shown cost is no longer the cost.
  server.status = idle;
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  expect(within(screen.getByRole('dialog')).getByTestId('confirm-cost')).toHaveTextContent('$2.65');
  server.status = { ...idle, budget: { ...idle.budget, slotEstimateUsd: 2.8 } };
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status', { name: 'Launch confirmation closed' })).toHaveTextContent(/changed from \$2\.65 to \$2\.80/);

  // 3. The API goes away while the dialog is open.
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  expect(within(screen.getByRole('dialog')).getByTestId('confirm-cost')).toHaveTextContent('$2.80');
  server.status = null;
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(server.posts).toHaveLength(0);
});

test('L10 Terminate POSTs and a failed termination (ok:false) shows a loud TERMINATE FAILED alert', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  server.terminate = { code: 502, body: { ok: false, reason: FAILED } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const term = await screen.findByRole('button', { name: 'Terminate' });
  await waitFor(() => expect(term).toBeEnabled());
  await user.click(term);
  const alert = await screen.findByTestId('terminate-failed');
  expect(alert).toHaveAttribute('role', 'alert');
  expect(alert).toHaveTextContent('TERMINATE FAILED — GPUs may still be billing');
  expect(server.posts.map((p) => p.url)).toEqual(['/api/live/terminate']);
  // Retry is offered and succeeds -> confirmation, alert cleared.
  server.terminate = { code: 200, body: { ok: true, reason: 'Workers terminated.' } };
  await user.click(screen.getByRole('button', { name: 'Retry terminate' }));
  expect(await screen.findByText('Terminate confirmed: Workers terminated.')).toBeInTheDocument();
  expect(screen.queryByTestId('terminate-failed')).toBeNull();
});

test('L10 a 502 TERMINATION PENDING answer is titled from its marker, and Retry stays enabled after the API stops answering (FE-3)', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  server.terminate = { code: 502, body: { ok: false, reason: `${PENDING}: GPU 1 (triangular) termination pending: late spawn.` } };
  render(<LiveView pollMs={40} autoPlay={false} />);
  await user.click(await screen.findByRole('button', { name: 'Terminate' }));
  const alert = await screen.findByTestId('terminate-failed');
  expect(alert).toHaveTextContent('TERMINATION PENDING — GPUs may still be billing');
  expect(alert).toHaveTextContent('late spawn');
  // One failed poll later (the old code disabled the button here).
  server.status = null;
  await screen.findByTestId('connection-lost');
  const retry = screen.getByRole('button', { name: 'Retry terminate' });
  expect(retry).toBeEnabled();
  expect(screen.getByTestId('terminate-failed')).toBeInTheDocument();
  await user.click(retry);
  await waitFor(() => expect(postsTo('/api/live/terminate')).toHaveLength(2));
});

test('L10 Terminate is never disabled while a session may be billing, not even while a terminate request is in flight', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  server.terminate = 'hang';
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await user.click(await screen.findByRole('button', { name: 'Terminate' }));
  const again = await screen.findByRole('button', { name: /^Terminating…/ });
  expect(again).toBeEnabled();
  await user.click(again);
  expect(postsTo('/api/live/terminate')).toHaveLength(2);

  // Pure rule: which states keep the control available.
  const at = 1;
  const ready = (data: LiveStatus): LiveState => ({ status: 'ready', data, receivedAt: at, freshForMs: 5_000 });
  const none = { terminateFailed: false, launchUnconfirmed: false };
  for (const mode of ['launching', 'live', 'fallback'] as const) expect(canTerminate(ready(status(mode)), none)).toBe(true);
  expect(canTerminate(ready(status('idle', { reason: `${PENDING}.` })), none)).toBe(true);
  expect(canTerminate(ready(status('terminated', { workers: [worker(0, 1, 1)] })), none)).toBe(true);
  expect(canTerminate({ status: 'unreachable', message: 'x', lastKnown: { data: liveNow(), receivedAt: at } }, none)).toBe(true);
  expect(canTerminate({ status: 'unreachable', cause: 'stale', message: 'x', lastKnown: { data: liveNow(), receivedAt: at } }, none)).toBe(true);
  expect(canTerminate({ status: 'unreachable', message: 'x' }, { terminateFailed: true, launchUnconfirmed: false })).toBe(true);
  expect(canTerminate(ready(status('idle')), { terminateFailed: false, launchUnconfirmed: true })).toBe(true);
  // Nothing was ever seen running: there is nothing to terminate.
  expect(canTerminate(ready(status('idle')), none)).toBe(false);
  expect(canTerminate(ready(status('unavailable')), none)).toBe(false);
  expect(canTerminate({ status: 'unreachable', message: 'x' }, none)).toBe(false);
  expect(canTerminate({ status: 'unreachable', message: 'x', lastKnown: { data: status('idle'), receivedAt: at } }, none)).toBe(false);
  expect(canTerminate({ status: 'connecting' }, none)).toBe(false);
});
