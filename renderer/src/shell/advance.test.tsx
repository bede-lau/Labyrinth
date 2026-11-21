// FE2-1: since the owner's redesign (bbf2fc6) Terminate is in the live-session alert above every view, so a view
// that is broken or busy cannot take the control away while GPUs may be billing. The views are markers and Plotly
// is mocked (jsdom has no WebGL); everything else is the shipped code.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LiveStatus } from '../lib/liveStatus';
import { App } from './App';
import { ROUTES } from './routes';

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));
vi.mock('../features/geometry/GeometryView', () => ({ GeometryView: () => <p>view:locate</p> }));
vi.mock('../features/forecast/ForecastView', () => ({ ForecastView: () => <p>view:forecast</p> }));
vi.mock('../features/spatial/SpatialView', () => ({ SpatialView: () => <p>view:spatial</p> }));
vi.mock('../features/heatfield/HeatFieldView', () => ({ HeatFieldView: () => <p>view:heat</p> }));

const REASON =
  'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean) terminate unconfirmed after 4 attempts: RuntimeError: boom. GPU 1 (triangular) worker failed: CUDA error.';
const STATUS: LiveStatus = {
  schemaVersion: 1,
  mode: 'fallback',
  reason: REASON,
  qualified: true,
  budget: { ceilingUsd: 40, billedUsd: 8.1, pendingUsd: 2.65, slotEstimateUsd: 2.65, slotFits: false, hardTimeoutS: 1500 },
  workers: [],
  fallback: { active: true, label: 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null },
};

beforeEach(() => {
  history.replaceState(null, '', '#/advance');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('the billing-alert cases cover every route in the nav, Heat & field included', () => {
  expect(ROUTES.map((r) => r.id)).toEqual(['locate', 'forecast', 'spatial', 'heat']);
});

test.each(ROUTES.map((r) => r.id))('existing billing alert offers Terminate on %s', async route => {
  history.replaceState(null, '', '#/' + route);
  const posts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posts.push(url);
        return new Response(JSON.stringify({ ok: false, reason: REASON }), { status: 502 });
      }
      if (url === '/api/live/status') return new Response(JSON.stringify(STATUS));
      return new Response('', { status: 404 });
    }),
  );
  render(<App pollMs={60_000} />);
  const alert = await screen.findByRole('alert', { name: 'Danger: TERMINATE FAILED — GPUs may still be billing' });
  expect(screen.getByText(`view:${route}`)).toBeInTheDocument();
  const retry = within(alert).getByRole('button', { name: 'Retry terminate' });
  await userEvent.setup().click(retry);
  await waitFor(() => expect(posts).toEqual(['/api/live/terminate']));
});
