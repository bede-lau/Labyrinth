import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveStatus, LiveWorker } from '../../lib/liveStatus';
import { LiveView } from './LiveView';
import { canLaunch, savedRunQualified, trackClocks, type SavedRun } from './model';

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

interface Server {
  status: LiveStatus | null;
  terminate: { code: number; body: unknown };
  posts: { url: string; init: RequestInit }[];
}
let server: Server;

beforeEach(() => {
  plotly.react.mockClear();
  server = { status: null, terminate: { code: 200, body: { ok: true, reason: 'Workers terminated.' } }, posts: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        server.posts.push({ url, init });
        if (url === '/api/live/launch') return new Response(JSON.stringify({ ok: true, reason: 'Launched live-abc; $2.65 reserved as pending.' }), { status: 202 });
        if (url === '/api/live/terminate') return new Response(JSON.stringify(server.terminate.body), { status: server.terminate.code });
      }
      if (url === '/artifacts/transport.json') return new Response(TRANSPORT, { status: 200 });
      if (url === '/api/live/status') {
        return server.status ? new Response(JSON.stringify(server.status)) : new Response('Bad gateway', { status: 502 });
      }
      if (url === `/api/live/runs/${SAVED.savedRunId}`) return new Response(JSON.stringify(SAVED));
      return new Response(JSON.stringify({ ok: false, reason: 'not found' }), { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const pills = () => screen.getByTestId('mode-pills');

test('L9 unreachable / unavailable / fallback show an unmistakable label and play the replay (never LIVE)', async () => {
  // 1. API unreachable (static replay build).
  const a = render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByText('REPLAY — live API unreachable')).toBeInTheDocument();
  expect(within(pills()).getByText('Replay · $0')).toBeInTheDocument();
  expect(await screen.findByTestId('playback-label')).toHaveTextContent('Playing: archived stella/GENE evidence');
  expect(screen.queryByText(/^LIVE/)).toBeNull();
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
    reason: 'GPU 1 worker failed: CUDA error',
    workers: [worker(0, 80, 5, { state: 'done' }), worker(1, 40, 2, { state: 'failed', error: 'CUDA error' })],
    fallback: { active: true, label: `Worker failed — playing saved GX run ${SAVED.savedRunId}`, savedRunId: SAVED.savedRunId },
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  expect(await screen.findByText('FALLBACK — a GX worker failed; playing saved evidence')).toBeInTheDocument();
  expect(within(pills()).getByText('Worker failed')).toBeInTheDocument();
  expect(within(pills()).getByText('Playing saved run')).toBeInTheDocument();
  expect(await screen.findByTestId('playback-label')).toHaveTextContent(`Playing: saved GX rehearsal run ${SAVED.savedRunId}`);
  expect(screen.getByText('Worker error: CUDA error')).toBeInTheDocument();
  expect(screen.queryByText(/^LIVE/)).toBeNull();
  expect(savedRunQualified({ ...SAVED, checks: { ...SAVED.checks, overlap: false } })).toBe(false);
});

test('L9 live shows both device IDs, GPU 0 = bean / GPU 1 = triangular, advancing sim clocks and sample counts', async () => {
  server.status = status('live', { qualified: true, reason: 'Live.', workers: [worker(0, 100, 4), worker(1, 98, 3)] });
  render(<LiveView pollMs={40} autoPlay={false} />);
  expect(await screen.findByText('LIVE · GPU 0 / GPU 1')).toBeInTheDocument();
  const g0 = screen.getByTestId('worker-0');
  const g1 = screen.getByTestId('worker-1');
  expect(g0).toHaveAccessibleName('GPU 0, bean tube');
  expect(g1).toHaveAccessibleName('GPU 1, triangular tube');
  expect(within(g0).getByTestId('device-0')).toHaveTextContent('GPU-0a1b2c3d-bean');
  expect(within(g1).getByTestId('device-1')).toHaveTextContent('GPU-9f8e7d6c-tri');
  expect(within(g0).getByRole('group', { name: /^GPU 0 flux samples: 4/ })).toBeInTheDocument();
  expect(within(g1).getByRole('group', { name: /^GPU 1 flux samples: 3/ })).toBeInTheDocument();
  expect(screen.getByTestId('overlap')).toHaveTextContent('Both solvers are executing concurrently');
  expect(screen.queryByTestId('playback-label')).toBeNull(); // live: no replay is presented as current

  // Next polls: both clocks advance and new samples arrive.
  server.status = status('live', { qualified: true, reason: 'Live.', workers: [worker(0, 112.5, 6), worker(1, 109, 5)] });
  await waitFor(() => expect(screen.getByTestId('clock-0')).toHaveTextContent('Clock advancing: +12.5'));
  expect(screen.getByTestId('clock-1')).toHaveTextContent('Clock advancing: +11.0');
  expect(within(screen.getByTestId('worker-0')).getByRole('group', { name: /^GPU 0 sim clock: 112\.5/ })).toBeInTheDocument();
  expect(within(screen.getByTestId('worker-1')).getByRole('group', { name: /^GPU 1 flux samples: 5/ })).toBeInTheDocument();

  // Pure: identical snapshots do not fake an advance.
  const c1 = trackClocks({}, [worker(0, 5, 1)]);
  expect(trackClocks(c1, [worker(0, 5, 1)])).toEqual(c1);
});

test('L9 live mode whose reason is TERMINATE FAILED surfaces a danger alert, not just a LIVE badge', async () => {
  server.status = status('live', {
    qualified: true,
    reason: 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing',
    workers: [worker(0, 300, 9, { state: 'done' }), worker(1, 290, 9, { state: 'done' })],
  });
  render(<LiveView pollMs={60_000} autoPlay={false} />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('TERMINATE FAILED — GPUs may still be billing');
  expect(alert).toHaveTextContent('check Modal dashboard');
  expect(screen.getByRole('button', { name: 'Retry terminate' })).toBeEnabled();
});

test('L10 Launch is enabled only when mode is idle and budget.slotFits', async () => {
  const cases: [LiveStatus | null, boolean][] = [
    [null, false],
    [status('unavailable'), false],
    [status('idle', { budget: { ...status('idle').budget, slotFits: false } }), false],
    [status('live', { workers: [worker(0, 1, 1), worker(1, 1, 1)] }), false],
    [status('fallback'), false],
    [status('idle', { qualified: true }), true],
  ];
  for (const [s, enabled] of cases) {
    server.status = s;
    const r = render(<LiveView pollMs={60_000} autoPlay={false} />);
    await screen.findByTestId('mode-banner');
    await waitFor(() => expect(screen.queryByText(/connecting to the live API/)).toBeNull());
    const btn = screen.getByRole('button', { name: 'Launch live slot…' });
    if (enabled) expect(btn).toBeEnabled();
    else {
      expect(btn).toBeDisabled();
      expect(screen.getByText(/^Launch disabled:/)).toBeInTheDocument();
    }
    expect(canLaunch(s ? { status: 'ready', data: s } : { status: 'unreachable', message: 'x' })).toBe(enabled);
    r.unmount();
  }
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

test('L10 Terminate POSTs and a failed termination (ok:false) shows a loud TERMINATE FAILED alert', async () => {
  const user = userEvent.setup();
  server.status = status('live', { qualified: true, reason: 'Live.', workers: [worker(0, 10, 1), worker(1, 10, 1)] });
  server.terminate = { code: 502, body: { ok: false, reason: 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing' } };
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
