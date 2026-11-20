import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { liveStatusStore, type LiveState, type LiveStatus, type LiveWorker, type SavedRun } from '../../lib/liveStatus';
import { LiveView } from './LiveView';
import { canLaunch, canTerminate, clockAdvance, launchBlockedReason, overlapClaim, provenanceIsLive, savedRunQualified, trackClocks } from './model';

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));
// `crash.playback` makes the replay player throw while rendering (FE2-1: a data-dependent part fails).
const crash = vi.hoisted(() => ({ playback: false }));
vi.mock('./Playback', async (importOriginal) => {
  const real = await importOriginal<typeof import('./Playback')>();
  return {
    Playback: (props: Parameters<typeof real.Playback>[0]) => {
      if (crash.playback) throw new Error("Cannot read properties of undefined (reading 'length')");
      return <real.Playback {...props} />;
    },
  };
});

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
  /** null = 502; a function is called per request and may return a promise (an answer the test releases). */
  status: LiveStatus | null | (() => LiveStatus | null | Promise<LiveStatus | null>);
  /** A function runs when the request arrives (to change what the backend reports from then on). */
  launch: Answer | (() => Answer);
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
  crash.playback = false;
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
        if (url === '/api/live/launch') return answer(typeof server.launch === 'function' ? server.launch() : server.launch);
        if (url === '/api/live/terminate') return answer(server.terminate);
      }
      if (url === '/artifacts/transport.json') return new Response(TRANSPORT, { status: 200 });
      if (url === '/api/live/status') {
        const s = typeof server.status === 'function' ? await server.status() : server.status;
        return s ? new Response(JSON.stringify(s)) : new Response('Bad gateway', { status: 502 });
      }
      if (url === `/api/live/runs/${SAVED.savedRunId}`) return new Response(JSON.stringify(server.savedRun));
      return new Response(JSON.stringify({ ok: false, reason: 'not found' }), { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const pills = () => screen.getByTestId('mode-pills');
// The mode pills only (the provenance badge sits in the same row and draws pills of its own).
const pillList = () =>
  [...pills().querySelectorAll<HTMLElement>(':scope > .lab-pill')].map((p) => `${p.dataset.status}:${p.textContent}`);
const launchButton = () => screen.getByRole('button', { name: /^Launch/ });
const postsTo = (url: string) => server.posts.filter((p) => p.url === url);
const settle = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
/** A "GPUs may still be billing" alert: the design system's Alert, found by its spoken name. */
const dangerAlert = (title: string | RegExp) =>
  screen.findByRole('alert', { name: typeof title === 'string' ? `Danger: ${title}` : new RegExp(`^Danger: ${title.source}`) });
/** It is the design system's danger primitive (DESIGN.md §5), not ad-hoc markup, and quotes the reason verbatim. */
function expectDangerPrimitive(alert: HTMLElement, reason: string) {
  expect(alert).toHaveClass('lab-alert');
  expect(alert).toHaveAttribute('data-status', 'billing-risk');
  expect(alert.querySelector('svg[data-icon]')?.getAttribute('data-icon')).toBe('danger');
  expect(alert.querySelector('.lab-alert__reason')?.textContent).toBe(reason);
}
/** A deferred status answer the test releases. */
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const PROVENANCE = {
  kind: 'live' as const,
  solverRevision: 'GX abc123',
  units: 'archive units',
  coverage: { description: 'Flux samples generated by this session.', tStart: 1.4, tEnd: null },
  runtime: '12.0 s wall',
  verification: { outcome: 'not-applicable' as const, details: 'Qualified by a recorded rehearsal.' },
  sources: [{ label: 'GX', url: 'https://example.invalid/gx', sha256: 'n/a' }],
};

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
  // The backend's own fallback label is part of the state label, not only of the player.
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('No qualified GX rehearsal recorded — showing archived stella/GENE evidence');
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
  expect(screen.getByTestId('mode-banner')).toHaveTextContent(`Worker failed — playing saved GX run ${SAVED.savedRunId}`);
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
  // Two readings stamped in the same millisecond (a POST answer and a poll), or out of order, span no time: no claim.
  expect(clockAdvance({ latest: { simTime: 9, at: 5_000 }, previous: { simTime: 7.5, at: 5_000 } })).toBeNull();
  expect(clockAdvance({ latest: { simTime: 9, at: 4_000 }, previous: { simTime: 7.5, at: 5_000 } })).toBeNull();

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
] as const)('L9 mode %s whose reason contains %s is a danger alert titled from the marker, never just a badge (FA-1)', async (mode, marker, reason) => {
  server.status = status(mode, {
    qualified: true,
    reason,
    workers: [worker(0, 300, 9, { state: 'done' }), worker(1, 290, 9, { state: 'done' })],
    fallback: { active: mode === 'fallback', label: mode === 'fallback' ? 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence' : '', savedRunId: null },
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const alert = await dangerAlert(`${marker} — GPUs may still be billing`);
  expectDangerPrimitive(alert, reason);
  expect(alert).toHaveTextContent('check the Modal dashboard');
  expect(screen.getAllByRole('alert')).toEqual([alert]); // one alert, not one per marker
  // The pills lead with the billing-risk pill; "Replay · $0" is never shown beside it.
  expect(pillList()[0]).toBe(`billing-risk:${marker}`);
  expect(pillList().some((p) => p.startsWith('replay:'))).toBe(false);
  expect(pillList().filter((p) => p.startsWith('live:'))).toHaveLength(mode === 'live' ? 1 : 0);
  // The Terminate control is the alert's action (DESIGN.md §5): "Retry terminate" after a failure, "Terminate" while pending.
  const action = within(alert).getByRole('button', { name: marker === 'TERMINATE FAILED' ? 'Retry terminate' : 'Terminate' });
  expect(action).toBeEnabled();
  expect(screen.getAllByRole('button', { name: /terminate/i })).toEqual([action]);
  expect(screen.getByTestId('mode-banner')).toHaveTextContent(`TERMINATION NOT CONFIRMED — the API reports mode "${mode}"`);
  expect(launchButton()).toBeDisabled();
  // The archived replay still plays, but no "$0" pill anywhere while GPUs may be billing.
  await waitFor(() => expect(screen.queryByTestId('playback-label') !== null).toBe(mode !== 'live'));
  expect(screen.queryByText('Replay · $0')).toBeNull();
  expect(screen.queryAllByText('Replay', { selector: '.lab-pill__text' })).toHaveLength(mode === 'live' ? 0 : 1);
});

test('L9 FA-1 a requested stop that is not confirmed yet (orchestrator.py:62) is a billing-risk alert; LIVE stays while the API reports live', async () => {
  const reason = 'Stop requested; terminating workers — not confirmed yet. Both workers launched; streaming GX output (live).';
  server.status = liveNow({ reason });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const alert = await dangerAlert('STOP NOT CONFIRMED — GPUs may still be billing');
  expectDangerPrimitive(alert, reason);
  expect(pillList()).toEqual(['billing-risk:Stop not confirmed', 'live:LIVE · GPU 0 / GPU 1']);
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('STOP NOT CONFIRMED — the API reports mode "live"');
  expect(screen.getByTestId('mode-banner')).not.toHaveTextContent(/REPLAY|terminated|\$0/);
  expect(within(alert).getByRole('button', { name: 'Terminate' })).toBeEnabled();
  expect(launchButton()).toBeDisabled();
});

test('L10 FA-2 a Terminate answer that says ok but carries a not-confirmed reason is never shown as terminated', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  // A kill-switch-only stop (modal_backend.py:183) is never ok:true on the backend; if an answer ever says so, the words win.
  const reason = 'GPU 0 (bean) kill switch raised, stop not confirmed: the spawn failed client-side (ConnectionError: reset) after it may have reached Modal, there is no call to cancel and a worker that started stops only when it reads the switch.';
  server.terminate = { code: 200, body: { ok: true, reason } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await user.click(await screen.findByRole('button', { name: 'Terminate' }));
  const alert = await dangerAlert('TERMINATE FAILED — GPUs may still be billing');
  expectDangerPrimitive(alert, reason);
  expect(screen.queryByText(/Terminate confirmed/)).toBeNull();
  expect(within(alert).getByRole('button', { name: 'Retry terminate' })).toBeEnabled();
});

test('L9 a live session that stops answering reads "connection lost — session state unknown", keeps Terminate enabled and drops LIVE', async () => {
  server.status = liveNow();
  render(<LiveView pollMs={40} autoPlay={false} />);
  expect(await screen.findByText('LIVE · GPU 0 / GPU 1')).toBeInTheDocument();
  server.status = null; // the API goes away mid-session
  const alert = await dangerAlert(/CONNECTION LOST — session state unknown/);
  expect(alert).toHaveClass('lab-alert');
  expect(alert).toHaveAttribute('data-status', 'billing-risk');
  expect(alert).toHaveTextContent(/mode "live"/);
  expect(alert).toHaveTextContent('GPUs may still be billing');
  expect(pillList()).toEqual(['billing-risk:Connection lost']);
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

test('L9 FA-3 the provenance badge reads Live only for a fresh, valid mode "live" snapshot; otherwise "Recorded run"', async () => {
  // A live answer: the badge takes the live treatment.
  server.status = liveNow({ provenance: PROVENANCE });
  const a = render(<LiveView pollMs={60_000} autoPlay={false} />);
  const liveBadge = await screen.findByRole('button', { name: /^Provenance of live GX status: Live,/ });
  expect(liveBadge.querySelector('[data-status="live"]')).not.toBeNull();
  // The same snapshot, drawn again ten minutes later (no poll has run since): no longer fresh, so not Live.
  const later = Date.now() + 600_000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
  a.rerender(<LiveView pollMs={60_000} autoPlay />);
  const stale = screen.getByRole('button', { name: /^Provenance of live GX status: / });
  clock.mockRestore();
  expect(stale).toHaveAccessibleName(/^Provenance of live GX status: Recorded run,/);
  a.unmount();

  // The same provenance (kind "live") on a fallback snapshot: a record of an earlier session, never LIVE.
  server.status = status('fallback', {
    qualified: true,
    reason: 'GPU 1 (triangular) worker failed: CUDA error. Other worker terminated.',
    provenance: PROVENANCE,
    fallback: { active: true, label: 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null },
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const recorded = await screen.findByRole('button', { name: /^Provenance of live GX status: Recorded run,/ });
  expect(recorded.querySelector('[data-status="live"]')).toBeNull();
  expect(document.querySelector('[data-status="live"]')).toBeNull();

  // Pure rule: valid (the store keeps validated snapshots only), mode "live" and fresh.
  const at = 1_000_000;
  const ready = (data: LiveStatus, receivedAt = at): LiveState => ({ status: 'ready', data, receivedAt, freshForMs: 5_500 });
  expect(provenanceIsLive(ready(liveNow()), at + 5_500)).toBe(true);
  expect(provenanceIsLive(ready(liveNow()), at + 5_501)).toBe(false); // too old to vouch for "now"
  expect(provenanceIsLive({ status: 'ready', data: liveNow() }, at)).toBe(false); // freshness unknown
  for (const mode of ['unavailable', 'idle', 'launching', 'fallback', 'terminated'] as const) {
    expect(provenanceIsLive(ready(status(mode, { provenance: PROVENANCE })), at)).toBe(false);
  }
  expect(provenanceIsLive({ status: 'unreachable', message: 'x', lastKnown: { data: liveNow(), receivedAt: at } }, at)).toBe(false);
  expect(provenanceIsLive({ status: 'connecting' }, at)).toBe(false);
});

test('A3 L9 a missing transport artifact on Advance plasma names the file instead of a blank replay panel', async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) =>
    String(input) === '/artifacts/transport.json' ? new Response('not found', { status: 404 }) : new Response('Bad gateway', { status: 502 }),
  );
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByRole('note', { name: /artifacts\/transport\.json failed to load/ })).toHaveTextContent('/artifacts/transport.json: HTTP 404');
  expect(screen.queryByTestId('playback-label')).toBeNull();
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('REPLAY — live API unreachable');
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
  ['mode fallback while a termination is unconfirmed', status('fallback', { qualified: true, reason: `${PENDING}: GPU 1 (triangular). GPU 0 (bean) worker failed.` }), /termination is unconfirmed/],
  ['mode fallback while a requested stop is unconfirmed', status('fallback', { qualified: true, reason: 'Stop requested; terminating workers — not confirmed yet. GPU 0 (bean) worker failed.' }), /termination is unconfirmed/],
  ['mode fallback and the service is not qualified', status('fallback', { qualified: false }), /needs a qualified service/],
  ['mode terminated', status('terminated'), /the API reports "terminated"/],
  ['idle but the budget guard refuses the slot', status('idle', { budget: { ...status('idle').budget, slotFits: false } }), /The budget guard refuses this slot/],
  ['idle but a termination is unconfirmed', status('idle', { reason: `${PENDING}: GPU 0 (bean).` }), /termination is unconfirmed/],
  ['idle but a kill-switch-only stop is unconfirmed', status('idle', { reason: 'GPU 0 (bean) kill switch raised, stop not confirmed: no call to cancel.' }), /termination is unconfirmed/],
  ['idle but a requested stop is unconfirmed', status('idle', { reason: 'Stop requested; terminating workers — not confirmed yet. Ready.' }), /termination is unconfirmed/],
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
  for (const mode of ['unavailable', 'launching', 'live', 'terminated'] as const) {
    expect(canLaunch(ready(status(mode, { qualified: true })), at)).toBe(false);
  }
  // cross-RX-4: a settled fallback (no termination or stop marker) of a qualified service, under the guard's approval.
  const settled = status('fallback', { qualified: true, reason: 'GPU 0 (bean) worker failed: CUDA error. Other worker terminated.', workers: [worker(0, 4, 1, { state: 'failed' }), worker(1, 9, 2, { state: 'done' })] });
  expect(canLaunch(ready(settled), at)).toBe(true);
  expect(canLaunch(ready(settled), at + 5_501)).toBe(false); // stale
  expect(canLaunch(ready({ ...settled, qualified: false }), at)).toBe(false);
  expect(canLaunch(ready({ ...settled, budget: { ...settled.budget, slotFits: false } }), at)).toBe(false);
  expect(canLaunch(ready({ ...settled, reason: `${FAILED}: GPU 0 (bean). ${settled.reason}` }), at)).toBe(false);
  expect(canLaunch(ready(settled, { launchLocked: true, launchPhase: 'accepted' }), at)).toBe(false);
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

test('L10 while a launch request is in flight Launch stays disabled, even when the mode changes and comes back to idle meanwhile', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true });
  server.status = idle;
  server.launch = 'hang'; // the POST never answers
  render(<LiveView pollMs={40} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  // Another session's life passes on the backend: launching (releases the lock), then a clean idle again.
  server.status = status('launching', { qualified: true });
  await waitFor(() => expect(screen.getByTestId('mode-banner')).toHaveTextContent(/^LAUNCHING — not live until both workers report/));
  server.status = idle;
  await waitFor(() => expect(screen.getByTestId('mode-banner')).toHaveTextContent('REPLAY — qualified and idle'));
  await settle(120);
  expect(launchButton()).toBeDisabled();
  expect(launchButton()).toHaveTextContent('Launching…');
  expect(postsTo('/api/live/launch')).toHaveLength(1);
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

// Launch after a refusal (FA-4, maintainer decision 2026-11-20): a 409 launched nothing, so the refusal is shown and
// Launch comes back with the next fresh snapshot that allows launching; a 202 stays disabled until the mode changes
// (above); a request with no answer is unknown — disabled until a fresh snapshot shows the mode.
const COST_REFUSAL = 'launch refused: confirmCostUsd must equal the current slot estimate $2.70 to the cent (got 2.65).'; // service.py:340-341 via app.py:172

test('L10 FA-4 after a 409 the refusal is shown and Launch comes back with the snapshot the refusal carries, when it allows launching', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true });
  server.status = idle;
  const updated = { ...idle, reason: 'Qualified. Estimate updated.', budget: { ...idle.budget, slotEstimateUsd: 2.7 } };
  server.launch = { code: 409, body: { ok: false, reason: COST_REFUSAL, status: updated } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  const refused = await screen.findByText(/^Launch refused:/);
  expect(refused).toHaveAttribute('role', 'alert');
  expect(refused).toHaveTextContent('Launch refused: confirmCostUsd must equal the current slot estimate $2.70 to the cent (got 2.65).');
  // The status carried by the answer is on screen (no stale idle snapshot from before the POST) …
  expect(screen.getByTestId('budget-line')).toHaveTextContent('next slot $2.70');
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('Estimate updated.');
  // … and it allows launching: nothing was launched, so Launch is back, at the new cost.
  await waitFor(() => expect(launchButton()).toBeEnabled());
  expect(screen.queryByRole('alert', { name: /^Danger:/ })).toBeNull(); // a refusal is not a billing risk
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeDisabled();
  await user.click(launchButton());
  expect(within(screen.getByRole('dialog')).getByTestId('confirm-cost')).toHaveTextContent('$2.70');
  expect(postsTo('/api/live/launch')).toHaveLength(1);
});

test('L10 FA-4 after a 409 Launch stays disabled while the snapshots do not allow launching, and returns with the first one that does', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true });
  server.status = idle;
  const full = { ...idle, budget: { ...idle.budget, pendingUsd: 30, slotFits: false } };
  // service.py:348 via app.py:172: the ledger could not be written; the answer carries no status at all, and from
  // then on the pending reservation leaves no room for a slot.
  server.launch = () => {
    server.status = full;
    return { code: 409, body: { ok: false, reason: 'launch refused: The ledger could not be updated (OSError: [Errno 28] No space left on device); the reservation was written and stays pending, nothing launched.' } };
  };
  render(<LiveView pollMs={40} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  expect(await screen.findByText(/^Launch refused: The ledger could not be updated/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('budget-line')).toHaveTextContent('next slot refused by the budget guard'));
  await settle(150);
  expect(launchButton()).toBeDisabled();
  expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent(/The budget guard refuses this slot/);
  server.status = idle;
  await waitFor(() => expect(launchButton()).toBeEnabled());
  expect(postsTo('/api/live/launch')).toHaveLength(1);
});

test('L10 FA-4 a launch request with no answer is unknown: alert and disabled until a fresh snapshot shows the mode', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true });
  server.status = idle;
  server.launch = 'network-error';
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  // The status request sent after the failure is held: until it answers, nobody knows whether a session started.
  const answer = deferred<LiveStatus | null>();
  server.status = () => answer.promise;
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  const alert = await dangerAlert('LAUNCH NOT CONFIRMED — a session may have started');
  expectDangerPrimitive(alert, 'No response from /api/live/launch (Failed to fetch)');
  expect(within(alert).getByRole('button', { name: 'Terminate' })).toBeEnabled();
  expect(launchButton()).toBeDisabled();
  expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent(/no usable answer/);
  // The fresh snapshot shows the mode: idle, nothing running. The outcome is known now; Launch is allowed again.
  answer.resolve(idle);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  expect(screen.queryByRole('alert', { name: /^Danger:/ })).toBeNull();
  expect(screen.getByText(/^Launch outcome unknown/)).toHaveTextContent('Launch outcome unknown (No response from /api/live/launch (Failed to fetch)); the status received since reports mode "idle".');
  expect(postsTo('/api/live/launch')).toHaveLength(1);
});

test('L10 FA-4 a launch with no answer whose next snapshot shows a session stays disabled by that mode, with Terminate available', async () => {
  const user = userEvent.setup();
  server.status = status('idle', { qualified: true });
  server.launch = 'network-error';
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  // The request did reach the backend: the next snapshot reports the session it started.
  server.status = status('launching', { qualified: true, reason: 'Launching GX workers (live); hard timeout 1500 s.', workers: [worker(0, 0, 0, { state: 'initializing', deviceId: '' }), worker(1, 0, 0, { state: 'pending', deviceId: '' })] });
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  await waitFor(() => expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent(/the API reports "launching"/));
  expect(launchButton()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeEnabled();
  expect(pillList()).toEqual(['rehearsal:Launching…']);
  expect(screen.getByText(/^Launch outcome unknown/)).toHaveTextContent('the status received since reports mode "launching".');
});

test('L10 FA-4 a launch with no answer and no status either is a lost connection: alert, Terminate, Launch disabled', async () => {
  const user = userEvent.setup();
  server.status = status('idle', { qualified: true });
  server.launch = 'network-error';
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  server.status = null; // the backend went away with the request
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  const alert = await dangerAlert(/CONNECTION LOST — session state unknown/);
  expect(alert).toHaveTextContent('A launch request was sent from this page after that, and its outcome is not known.');
  expect(pillList()).toEqual(['billing-risk:Connection lost']);
  expect(within(alert).getByRole('button', { name: 'Terminate' })).toBeEnabled();
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
  expect(screen.getByRole('status', { name: 'Launch confirmation closed' })).toHaveTextContent(/The budget guard refuses this slot/);
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
  const alert = await dangerAlert('TERMINATE FAILED — GPUs may still be billing');
  expectDangerPrimitive(alert, FAILED);
  expect(pillList()).toEqual(['billing-risk:TERMINATE FAILED', 'live:LIVE · GPU 0 / GPU 1']);
  expect(server.posts.map((p) => p.url)).toEqual(['/api/live/terminate']);
  // Retry is offered and succeeds -> confirmation, alert cleared. (The status read after it shows the ended
  // session: a later snapshot that still reported live would make "Terminate confirmed" false, FE2-2.)
  server.terminate = { code: 200, body: { ok: true, reason: 'Workers terminated.' } };
  server.status = status('terminated', { qualified: true, reason: 'Stopped on request; workers terminated.' });
  await user.click(within(alert).getByRole('button', { name: 'Retry terminate' }));
  expect(await screen.findByText('Terminate confirmed: Workers terminated.')).toBeInTheDocument();
  expect(screen.queryByRole('alert', { name: /^Danger:/ })).toBeNull();
});

test('L10 a 502 TERMINATION PENDING answer is titled from its marker, and Retry stays enabled after the API stops answering (FE-3)', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  const reason = `${PENDING}: GPU 1 (triangular) termination pending: spawn still in flight; it is cancelled the moment it returns; the run kill switch is raised.`;
  server.terminate = { code: 502, body: { ok: false, reason } };
  render(<LiveView pollMs={40} autoPlay={false} />);
  await user.click(await screen.findByRole('button', { name: 'Terminate' }));
  const alert = await dangerAlert('TERMINATION PENDING — GPUs may still be billing');
  expectDangerPrimitive(alert, reason);
  // One failed poll later (the old code disabled the button here).
  server.status = null;
  const lost = await dangerAlert(/CONNECTION LOST/);
  const retry = screen.getByRole('button', { name: 'Retry terminate' });
  expect(retry).toBeEnabled();
  expect(within(lost).queryByRole('button')).toBeNull(); // one Terminate control, in the first alert
  expect(screen.getByRole('alert', { name: /^Danger: TERMINATION PENDING/ })).toContainElement(retry);
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

/* ============================== fix round 1 (fe-live) ========================================= */

const SETTLED_FALLBACK = () =>
  status('fallback', {
    qualified: true,
    reason: 'GPU 0 (bean) worker failed: CUDA error. Other worker terminated.',
    workers: [worker(0, 40, 2, { state: 'failed', error: 'CUDA error' }), worker(1, 80, 5, { state: 'running' })],
    fallback: { active: true, label: 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null },
  });
const IDLE_AFTER_STOP = () =>
  status('idle', { qualified: true, reason: 'Last session ended: Stopped on request; workers terminated. Qualified. Launch requires explicit confirmation of the slot cost.' });
const PENDING_WORKERS = () => [worker(0, 0, 0, { state: 'pending', deviceId: '', simTime: null as unknown as number }), worker(1, 0, 0, { state: 'pending', deviceId: '', simTime: null as unknown as number })];

test('cross-RX-4 after a settled fallback (every termination confirmed) Launch is allowed again and the fallback label stays', async () => {
  const user = userEvent.setup();
  server.status = SETTLED_FALLBACK();
  // The 202 carries the new session's snapshot: still mode "idle", with its pending workers (orchestrator.py:282).
  server.launch = { code: 202, body: { ok: true, reason: 'Launched live-abc; $2.65 reserved as pending.', status: status('idle', { qualified: true, workers: PENDING_WORKERS() }) } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByText('FALLBACK — Worker failed')).toBeInTheDocument();
  await waitFor(() => expect(launchButton()).toBeEnabled());
  expect(screen.queryByText(/^Launch disabled:/)).toBeNull();
  expect(pillList()).toEqual(['failed:Worker failed', 'replay:Replay · $0']);
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('Worker failed. No qualified GX rehearsal recorded');
  await user.click(launchButton());
  const dialog = screen.getByRole('dialog', { name: 'Launch a live GX slot?' });
  await user.click(within(dialog).getByRole('button', { name: 'Confirm launch — $2.65' }));
  await waitFor(() => expect(postsTo('/api/live/launch')).toHaveLength(1));
  expect(JSON.parse(String(postsTo('/api/live/launch')[0]!.init.body))).toEqual({ confirmCostUsd: 2.65 });
  expect(await screen.findByText(/^Launch accepted:/)).toBeInTheDocument();
  // The new session lists workers while it reads idle: Launch stays disabled, Terminate is available.
  await waitFor(() => expect(launchButton()).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeEnabled();
  expect(pillList()).toEqual(['rehearsal:Launching…']);

  // A fallback whose termination is not confirmed stays blocked (the marker is the backend's word for it).
  expect(launchBlockedReason({ status: 'ready', data: { ...SETTLED_FALLBACK(), reason: `${PENDING}: GPU 1 (triangular). GPU 0 (bean) worker failed.` }, receivedAt: 1, freshForMs: 10 }, 1)).toMatch(/termination is unconfirmed/);
});

test('cross-RX-5 a guard refusal reads as the guard refusing the slot and quotes its clause; it is not called a ceiling fit', async () => {
  const clause = "Budget guard refused: ledger not reconciled (billed $1.00, pending $0.00). Check both against Modal's usage page and record them before any allocation.";
  server.status = status('idle', {
    qualified: true,
    reason: `Qualified. Launch requires explicit confirmation of the slot cost. ${clause}`,
    budget: { ceilingUsd: 40, billedUsd: 1, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: false, hardTimeoutS: 1500 },
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(screen.getByTestId('budget-line')).toHaveTextContent('next slot refused by the budget guard'));
  expect(launchButton()).toBeDisabled();
  const why = screen.getByText(/^Launch disabled:/);
  expect(why).toHaveTextContent(`Launch disabled: The budget guard refuses this slot: "${clause}"`);
  expect(why).not.toHaveTextContent(/fit/);
  expect(screen.getByTestId('budget-line')).not.toHaveTextContent(/fit/);
  // Without a clause in the reason, the refusal is still the guard's, never a ceiling claim.
  const bare = status('idle', { qualified: true, reason: 'Qualified.', budget: { ...status('idle').budget, slotFits: false } });
  expect(launchBlockedReason({ status: 'ready', data: bare, receivedAt: 1, freshForMs: 10 }, 1)).toBe('The budget guard refuses this slot (the API gives no reason).');
});

test.each([
  ['launching', status('launching', { qualified: true, reason: 'Launching GX workers (live); hard timeout 1500 s.', workers: PENDING_WORKERS() }), 'rehearsal:Launching…'],
  ['idle (the 202 snapshot)', status('idle', { qualified: true, workers: PENDING_WORKERS() }), 'rehearsal:Launching…'],
  ['terminated', status('terminated', { workers: [worker(0, 9, 1, { state: 'done' }), worker(1, 9, 1, { state: 'done' })] }), 'not-applicable:terminated'],
  ['fallback', SETTLED_FALLBACK(), 'failed:Worker failed'],
] as const)('cross-RX-10 the Workers panel never wears the replay pill while workers are listed: mode %s', async (_name, s, pill) => {
  server.status = s;
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const panel = await screen.findByRole('region', { name: `Workers (${s.mode}, not live)` });
  const pills = [...panel.querySelectorAll<HTMLElement>('.lab-panel__header .lab-pill')].map((p) => `${p.dataset.status}:${p.textContent}`);
  expect(pills).toEqual([pill]);
});

test('cross-RX-11 the archive replay subtitle says why no GX run plays: none recorded, could not be loaded, or not qualified', async () => {
  const replaySubtitle = async () => {
    const region = await screen.findByRole('region', { name: 'Replay: archived stella and GENE bean traces' });
    return region.querySelector('.lab-panel__subtitle')?.textContent ?? '';
  };
  const named = status('idle', { qualified: true, reason: 'Qualified.', fallback: { active: false, label: '', savedRunId: SAVED.savedRunId } });

  // 1. A qualified saved run is named, and GET /api/live/runs/<id> fails.
  server.status = named;
  server.savedRun = { savedRunId: SAVED.savedRunId, initVerified: true };
  const a = render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByRole('note', { name: new RegExp(`Saved run ${SAVED.savedRunId} could not be loaded`) })).toBeInTheDocument();
  expect(await replaySubtitle()).toBe(`Saved evidence played back at $0. No GX run is shown: none is live, and saved run ${SAVED.savedRunId} could not be loaded.`);
  a.unmount();

  // 2. The run is served but did not pass every check.
  server.savedRun = { ...SAVED, checks: { ...SAVED.checks, overlap: false } };
  const b = render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByRole('note', { name: new RegExp(`Saved run ${SAVED.savedRunId} did not pass every check`) })).toBeInTheDocument();
  expect(await replaySubtitle()).toBe(`Saved evidence played back at $0. No GX run is shown: none is live, and saved run ${SAVED.savedRunId} did not pass every check.`);
  b.unmount();

  // 3. None is recorded.
  server.status = status('idle', { qualified: true, reason: 'Qualified.' });
  const c = render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(async () => expect(await replaySubtitle()).toBe('Saved evidence played back at $0. No GX run is shown: none is live, and no qualified GX rehearsal is recorded.'));
  c.unmount();

  // 4. No status at all: nothing is known about a recording, and nothing is claimed.
  server.status = null;
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(async () => expect(await replaySubtitle()).toBe('Saved evidence played back at $0. No GX run is shown: none is live, and the live API names no saved run.'));
});

test('FE2-1 a render error in the replay (wrong-shaped transport artifact) leaves the alert and Terminate up while GPUs may be billing', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const reason = `${FAILED}: GPU 0 (bean) terminate unconfirmed after 4 attempts: boom. GPU 1 (triangular) worker failed.`;
  server.status = status('fallback', { qualified: true, reason, fallback: { active: true, label: 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null } });
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      server.posts.push({ url, init });
      return new Response(JSON.stringify({ ok: false, reason }), { status: 502 });
    }
    if (url === '/artifacts/transport.json') return new Response(JSON.stringify({ schemaVersion: 1 }));
    return new Response(JSON.stringify(server.status));
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const alert = await dangerAlert('TERMINATE FAILED — GPUs may still be billing');
  // The replay names what is wrong with the file instead of taking the panel down.
  expect(await screen.findByRole('note', { name: /artifacts\/transport\.json has an unexpected shape/ })).toBeInTheDocument();
  const retry = within(alert).getByRole('button', { name: 'Retry terminate' });
  expect(retry).toBeEnabled();
  await userEvent.setup().click(retry);
  await waitFor(() => expect(postsTo('/api/live/terminate')).toHaveLength(1));
  vi.restoreAllMocks();
});

test('FE2-1 a part of the view that throws while rendering is contained: the control panel, its alert and Terminate stay', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  crash.playback = true;
  const reason = `${PENDING}: GPU 1 (triangular) termination pending: late spawn. GPU 0 (bean) worker failed.`;
  server.status = status('terminated', { qualified: true, reason, workers: [worker(0, 9, 1, { state: 'done' }), worker(1, 9, 1, { state: 'done' })] });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const alert = await dangerAlert('TERMINATION PENDING — GPUs may still be billing');
  expect(within(alert).getByRole('button', { name: 'Terminate' })).toBeEnabled();
  const broken = await screen.findByRole('note', { name: /^Warning: The replay could not be displayed/ });
  expect(broken).toHaveTextContent("Cannot read properties of undefined (reading 'length')");
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('TERMINATION NOT CONFIRMED');
  expect(screen.getByTestId('worker-0')).toBeInTheDocument(); // the sibling sections are unaffected
  warn.mockRestore();
  err.mockRestore();
});

test('FE2-2 a failed Terminate answered to this page blocks Launch while shown, and goes once a later snapshot shows a clean, confirmed end', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  // The 502 carries a clean idle snapshot: that is the snapshot it answered with, not a later one.
  server.terminate = { code: 502, body: { ok: false, reason: FAILED, status: IDLE_AFTER_STOP() } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await user.click(await screen.findByRole('button', { name: 'Terminate' }));
  const alert = await dangerAlert('TERMINATE FAILED — GPUs may still be billing');
  expectDangerPrimitive(alert, FAILED);
  await waitFor(() => expect(screen.getByTestId('mode-banner')).toHaveTextContent('Last session ended'));
  expect(pillList()[0]).toBe('billing-risk:TERMINATE FAILED');
  expect(launchButton()).toBeDisabled();
  expect(screen.getByText(/^Launch disabled:/)).toHaveTextContent('The last Terminate sent from this page was not confirmed; GPUs may still be billing.');
  await user.click(launchButton());
  expect(screen.queryByRole('dialog')).toBeNull();

  // A later snapshot (the next poll) reports the clean, confirmed end: the local failure is dropped.
  act(() => {
    liveStatusStore.apply(IDLE_AFTER_STOP());
  });
  await waitFor(() => expect(screen.queryByRole('alert', { name: /^Danger:/ })).toBeNull());
  expect(pillList()).toEqual(['replay:Replay · $0']);
  expect(screen.getByTestId('mode-banner')).not.toHaveTextContent(/TERMINATION NOT CONFIRMED/);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Terminate' })).toBeDisabled();
  expect(postsTo('/api/live/launch')).toHaveLength(0);
});

test('FE2-2 a failed Terminate stays while later snapshots still show a session (live, then a lost connection)', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  server.terminate = { code: 502, body: { ok: false, reason: FAILED } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await user.click(await screen.findByRole('button', { name: 'Terminate' }));
  await dangerAlert('TERMINATE FAILED — GPUs may still be billing');
  act(() => {
    liveStatusStore.apply(liveNow({ reason: 'Both workers launched; streaming GX output (live). A later poll.' }));
  });
  await waitFor(() => expect(screen.getByTestId('mode-banner')).toHaveTextContent(/TERMINATION NOT CONFIRMED/));
  expect(screen.getByRole('alert', { name: 'Danger: TERMINATE FAILED — GPUs may still be billing' })).toBeInTheDocument();
  expect(pillList()[0]).toBe('billing-risk:TERMINATE FAILED');
});

test('FE2-2 a confirmed Terminate is not shown beside a later session: cleared by the next launch, and by a session reported later', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const term = await screen.findByRole('button', { name: 'Terminate' });
  server.status = IDLE_AFTER_STOP(); // what the refresh after the answer reads
  await user.click(term);
  expect(await screen.findByText('Terminate confirmed: Workers terminated.')).toBeInTheDocument();
  await waitFor(() => expect(launchButton()).toBeEnabled());
  // Launch from this page: the old confirmation goes with the new request.
  server.launch = { code: 202, body: { ok: true, reason: 'Launched live-abc; $2.65 reserved as pending.', status: status('launching', { qualified: true, workers: PENDING_WORKERS() }) } };
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  await waitFor(() => expect(postsTo('/api/live/launch')).toHaveLength(1));
  expect(screen.queryByText(/Terminate confirmed/)).toBeNull();
  act(() => {
    liveStatusStore.apply(liveNow());
  });
  expect(await screen.findByText('LIVE — GX running on two GPUs')).toBeInTheDocument();
  expect(screen.queryByText(/Terminate confirmed/)).toBeNull();
});

test('FE2-2 a confirmed Terminate is dropped when a later snapshot reports a session started elsewhere', async () => {
  const user = userEvent.setup();
  server.status = liveNow();
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const term = await screen.findByRole('button', { name: 'Terminate' });
  server.status = IDLE_AFTER_STOP();
  await user.click(term);
  expect(await screen.findByText('Terminate confirmed: Workers terminated.')).toBeInTheDocument();
  act(() => {
    liveStatusStore.apply(liveNow({ reason: 'Both workers launched; streaming GX output (live). Launched from another tab.' }));
  });
  expect(await screen.findByText('LIVE — GX running on two GPUs')).toBeInTheDocument();
  expect(screen.queryByText(/Terminate confirmed/)).toBeNull();
});

test('FE2-3 while a launch from this page may be running the panel never reads "Replay · $0" or "nothing is running"', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true, reason: 'Qualified.' });
  server.status = idle;
  server.launch = 'hang';
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('REPLAY — qualified and idle; nothing is running');
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  // Sent, no answer yet; the API still reads idle.
  await waitFor(() => expect(pillList()).toEqual(['rehearsal:Launching…']));
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('LAUNCHING — a launch request is on its way; the API still reports idle');
  expect(screen.getByTestId('mode-banner')).not.toHaveTextContent(/nothing is running/);
  expect(screen.queryByText('Replay · $0')).toBeNull();
  expect(screen.getByRole('region', { name: 'Replay: archived stella and GENE bean traces' })).not.toHaveTextContent(/\$0/);
});

test('FE2-3 an accepted launch whose status still reads idle is titled as a launch, not as an idle replay', async () => {
  const user = userEvent.setup();
  const idle = status('idle', { qualified: true, reason: 'Qualified.' });
  server.status = idle;
  server.launch = { code: 202, body: { ok: true, reason: 'Launched live-abc; $2.65 reserved as pending.', status: idle } };
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  await waitFor(() => expect(launchButton()).toBeEnabled());
  await user.click(launchButton());
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirm launch/ }));
  expect(await screen.findByText(/^Launch accepted:/)).toBeInTheDocument();
  expect(pillList()).toEqual(['rehearsal:Launching…']);
  expect(screen.getByTestId('mode-banner')).toHaveTextContent('LAUNCHING — launch accepted; the API still reports idle');
  expect(screen.queryByText('Replay · $0')).toBeNull();
});
