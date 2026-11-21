import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatNumber } from '../../design';
import { liveStatusStore, modePills, type LiveStatus, type LiveWorker } from '../../lib/liveStatus';
import { ForecastView } from './ForecastView';
import {
  INITIAL,
  advance,
  nextAction,
  runningMae,
  visibility,
  type ForecastArtifact,
  type Phase,
} from './model';

const ARTIFACT: ForecastArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/forecast.json'), 'utf8'));
const clone = (): ForecastArtifact => JSON.parse(JSON.stringify(ARTIFACT)) as ForecastArtifact;

/** One /api/live/status answer: a snapshot, a 404 (null) or no answer ('reject'). A list is answered in turn, its last repeated. */
type Api = LiveStatus | null | 'reject';
function serve(artifact: unknown = ARTIFACT, status = 200, live: Api | Api[] = null) {
  const answers = Array.isArray(live) ? live : [live];
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/artifacts/forecast.json') return new Response(JSON.stringify(artifact), { status });
      if (url === '/api/live/status') {
        const next = answers[Math.min(n++, answers.length - 1)];
        if (next === 'reject') throw new TypeError('network down');
        if (next) return new Response(JSON.stringify(next));
      }
      return new Response('nope', { status: 404 });
    }),
  );
}
beforeEach(() => serve());
afterEach(() => { vi.unstubAllGlobals(); plotly.react.mockClear(); });

const plotly = vi.hoisted(() => ({ react: vi.fn(async (..._args: unknown[]) => {}), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({default: plotly}));
type Trace = {name: string; x: number[]; y: number[]; customdata: string[]};
const traces = () => plotly.react.mock.lastCall?.[1] as Trace[];

test('the first view draws all saved series and switches to the two absolute errors', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  await waitFor(() => expect(traces()?.map(t => t.name)).toEqual(['Observed', 'Persistence', 'Frozen']));
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('heading', {name: /Final scores/})).toBeNull();
  for (const [idx, key] of (['observed', 'persistence', 'frozen'] as const).entries()) {
    expect(traces()[idx]!.y).toEqual(ARTIFACT.steps.map(s => s[key]));
    expect(traces()[idx]!.x).toEqual(ARTIFACT.steps.map(s => s.window[1]));
  }
  await user.click(screen.getByRole('button', {name: 'Absolute error'}));
  await waitFor(() => expect(traces().map(t => t.y)).toEqual(
    (['absErrPersistence', 'absErrFrozen'] as const).map(key => ARTIFACT.steps.map(s => s[key]))));
  expect(screen.getByRole('button', {name: 'Provenance of forecast replay: Derived, Failed'})).toBeInTheDocument();
});

test('step-through keeps observations and errors off the chart until reveal, scores each update and restores the overview', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', {name: 'Start replay'});
  primary.focus();
  let state = INITIAL;
  for (let i = 0; i < ARTIFACT.steps.length * 3; i++) {
    await user.keyboard('{Enter}');
    state = advance(state, ARTIFACT.steps.length);
    for (const [series, key] of (['observed', 'persistence', 'frozen'] as const).entries()) {
      const expected = ARTIFACT.steps.filter((_, j) => {
        const v = visibility(state, j);
        return key === 'observed' ? v.observed : v.forecasts;
      }).map(step => step[key]);
      await waitFor(() => expect(traces()[series]?.y).toEqual(expected));
    }
    if (i === 0) {
      await user.click(screen.getByRole('button', {name: 'Absolute error'}));
      await waitFor(() => expect(traces().map(t => t.y)).toEqual([[], []]));
      await user.click(screen.getByRole('button', {name: 'Heat flux'}));
      primary.focus();
    }
  }
  expect(primary).toHaveAccessibleName('Replay complete');
  expect(primary).toBeDisabled();
  const mae = runningMae(ARTIFACT.steps, ARTIFACT.steps.length)!;
  expect(mae.persistence).toBeCloseTo(ARTIFACT.mae.persistence, 6);
  expect(screen.getByLabelText('Mean absolute error')).toHaveTextContent(formatNumber(mae.frozen, 4));
  await user.click(screen.getByRole('button', {name: 'Show all windows'}));
  expect(primary).toHaveAccessibleName('Start replay');
  expect(primary).toHaveFocus();
});

test('F4 no peeking: visibility() for every window below, at and above the current one, in all three phases', () => {
  const n = 8;
  const phases: Phase[] = ['ready', 'predicted', 'revealed'];
  for (let index = 0; index <= n; index++) {
    for (const phase of index === n ? (['ready'] as Phase[]) : phases) {
      for (let i = 0; i < n; i++) {
        const want =
          i < index
            ? { forecasts: true, observed: true } // scored: everything shown
            : i > index
              ? { forecasts: false, observed: false } // future: nothing shown, not even its forecasts
              : { forecasts: phase !== 'ready', observed: phase === 'revealed' };
        expect(visibility({ index, phase }, i), `index ${index} ${phase}, row ${i}`).toEqual(want);
      }
    }
  }
  // A forecast is never visible without the window having been predicted, and observed never before its forecasts.
  for (const phase of phases) for (let i = 0; i < n; i++) {
    const v = visibility({ index: 3, phase }, i);
    expect(v.observed && !v.forecasts).toBe(false);
  }
});

test('F4 an artifact with no steps shows an empty state instead of crashing', async () => {
  serve({ ...clone(), steps: [] });
  render(<ForecastView />);
  const empty = await screen.findByRole('note', { name: /No forecast windows in artifacts\/forecast\.json/ });
  expect(empty).toHaveTextContent(/No saved windows/i);
  expect(screen.queryByRole('button', { name: /Start replay/ })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('region', { name: /Final scores/ })).toBeNull();
  expect(runningMae([], 0)).toBeNull();
  expect(nextAction(INITIAL, 0)).toBe('done');
});

test('A3 forecast: a missing or invalid artifact shows an error naming the file, never a blank view', async () => {
  serve({ error: 'gone' }, 404);
  const first = render(<ForecastView />);
  expect(screen.getByRole('heading', { name: 'Loading forecast replay…' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Forecast replay could not be loaded' })).toBeInTheDocument();
  expect(screen.getByRole('note', { name: /artifacts\/forecast\.json failed to load/ })).toHaveTextContent('/artifacts/forecast.json: HTTP 404');
  expect(screen.queryByRole('button', { name: /Start replay/ })).toBeNull();
  first.unmount();

  serve({ ...ARTIFACT, schemaVersion: 3 });
  render(<ForecastView />);
  expect(await screen.findByRole('note', { name: /artifacts\/forecast\.json failed to load/ })).toHaveTextContent('unexpected schemaVersion');
});

/* ---- the replay pill never prints "$0" while the header withholds it (cross-RX-1, FF-1) ------------ */
const LIVE_BASE: LiveStatus = {
  schemaVersion: 1,
  mode: 'idle',
  reason: 'Qualified. Launch requires explicit confirmation of the slot cost.',
  qualified: true,
  budget: { ceilingUsd: 40, billedUsd: 8.1, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true, hardTimeoutS: 1500 },
  workers: [],
  fallback: { active: false, label: '', savedRunId: null },
};
const worker = (gpuIndex: 0 | 1, state: LiveWorker['state'] = 'running'): LiveWorker => ({
  gpuIndex,
  deviceId: `GPU-${gpuIndex}aaaa`,
  tube: gpuIndex === 0 ? 'bean' : 'triangular',
  state,
  simTime: 12,
  samples: [],
});
const RUNNING = [worker(0), worker(1)];
const snap = (mode: LiveStatus['mode'], reason: string, workers: LiveWorker[] = [], extra: Partial<LiveStatus> = {}): LiveStatus => ({
  ...LIVE_BASE,
  mode,
  reason,
  workers,
  ...extra,
});
const FALLBACK = { active: true, label: 'Worker failed — GPU 0 (bean)', savedRunId: null };
const replayPill = () =>
  screen.getByRole('region', { name: /50-unit mean heat flux/ }).querySelector('.lab-panel__header .lab-pill[data-status="replay"]');

test.each([
  ['mode live with two running workers', [snap('live', 'Live: both workers running.', RUNNING)]],
  ['a fallback with TERMINATE FAILED', [snap('fallback', 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean).', [worker(0, 'failed')], { fallback: FALLBACK })]],
  ['a fallback with TERMINATION PENDING', [snap('fallback', 'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs may still be billing.', [worker(1)], { fallback: FALLBACK })]],
  ['a stop that is not confirmed', [snap('live', 'Stop requested; terminating workers — not confirmed yet', RUNNING)]],
  ['mode idle with workers listed', [snap('idle', 'Session created; workers starting.', [worker(0, 'pending'), worker(1, 'pending')])]],
  ['mode launching', [snap('launching', 'Launching both workers.', [worker(0, 'initializing')])]],
  ['a connection lost after mode live', [snap('live', 'Live: both workers running.', RUNNING), 'reject']],
] as [string, Api[]][])('FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for %s, as the header does', async (_name, api) => {
  serve(ARTIFACT, 200, api);
  render(<ForecastView livePollMs={api.length > 1 ? 60 : 60_000} />);
  await screen.findByRole('button', { name: /Start replay/ });
  const settled = api.length > 1 ? 'unreachable' : 'ready';
  await waitFor(() => expect(liveStatusStore.getState().status).toBe(settled));
  expect(modePills(liveStatusStore.getState()).map((p) => p.text)).not.toContain('Replay · $0');
  expect(replayPill()).toHaveTextContent(/^Replay$/);
  expect(document.body).not.toHaveTextContent('Replay · $0');
});

test('FF-1 the forecast replay pill keeps "$0" where the header does, and drops it once a launch from this page is accepted', async () => {
  // Static replay build (no API answer) and an empty artifact: the empty-state panel follows the same rule.
  serve({ ...clone(), steps: [] });
  const first = render(<ForecastView livePollMs={60_000} />);
  await screen.findByRole('note', { name: /No forecast windows/ });
  await waitFor(() => expect(liveStatusStore.getState().status).toBe('unreachable'));
  const empty = screen.getByRole('region', { name: /50-unit mean heat flux/ });
  expect(empty.querySelector('.lab-panel__header .lab-pill[data-status="replay"]')).toHaveTextContent(/^Replay · \$0$/);
  first.unmount();

  serve(ARTIFACT, 200, LIVE_BASE);
  render(<ForecastView livePollMs={60_000} />);
  await screen.findByRole('button', { name: /Start replay/ });
  await waitFor(() => expect(liveStatusStore.getState().status).toBe('ready'));
  expect(replayPill()).toHaveTextContent(/^Replay · \$0$/);
  act(() => {
    liveStatusStore.lockLaunch();
    liveStatusStore.launchAnswered('accepted');
  });
  expect(replayPill()).toHaveTextContent(/^Replay$/);
});
