import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, DECISION_QUESTION } from './App';
import { modeView } from './ModeIndicator';
import { ROUTES } from './routes';
import type { LiveState, LiveStatus } from '../lib/liveStatus';

// The shell is tested on its own: each view is replaced by a marker so the shell's routing,
// mode indicator and header are what is exercised (the views have their own tests).
vi.mock('../features/geometry/GeometryView', () => ({ GeometryView: () => <p>view:locate</p> }));
vi.mock('../features/live-gx/LiveView', () => ({ LiveView: () => <p>view:advance</p> }));
vi.mock('../features/transport/TransportView', () => ({ TransportView: () => <p>view:transport</p> }));
vi.mock('../features/forecast/ForecastView', () => ({ ForecastView: () => <p>view:forecast</p> }));
vi.mock('../features/spatial/SpatialView', () => ({ SpatialView: () => <p>view:spatial</p> }));
vi.mock('../features/budget/BudgetView', () => ({ BudgetView: () => <p>view:budget</p> }));

const status = (mode: LiveStatus['mode'], extra: Partial<LiveStatus> = {}): LiveStatus => ({
  schemaVersion: 1,
  mode,
  reason: `reason for ${mode}`,
  budget: { ceilingUsd: 40, billedUsd: 0, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true },
  workers: [],
  fallback: { active: mode === 'fallback', label: 'No saved GX rehearsal run exists', savedRunId: null },
  ...extra,
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const f = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', f);
  return f;
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('A1 navigation reaches all six views by keyboard and the URL hash names the view', async () => {
  stubFetch(() => new Response('not found', { status: 404 }));
  const user = userEvent.setup();
  render(<App />);

  // Empty hash is normalised to the default view.
  expect(location.hash).toBe('#/locate');
  expect(screen.getByText('view:locate')).toBeInTheDocument();

  const nav = screen.getByRole('navigation', { name: 'Views' });
  const links = within(nav).getAllByRole('link');
  expect(links.map((l) => l.querySelector('.shell-nav__label')?.textContent)).toEqual([
    'Locate the tubes',
    'Advance plasma',
    'Check transport',
    'Forecast replay',
    'Spatial parallelism',
    'Budget',
  ]);
  expect(links.map((l) => l.getAttribute('href'))).toEqual(ROUTES.map((r) => `#/${r.id}`));
  expect(links[0]).toHaveAttribute('aria-current', 'page');

  // Keyboard: Tab past the skip link and header controls to the nav, then through each link + Enter.
  for (let n = 0; n < 6 && document.activeElement !== links[0]; n++) await user.tab();
  for (const [i, r] of ROUTES.entries()) {
    if (i > 0) await user.tab();
    expect(links[i]).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(location.hash).toBe(`#/${r.id}`));
    await waitFor(() => expect(screen.getByText(`view:${r.id}`)).toBeInTheDocument());
    expect(links[i]).toHaveAttribute('aria-current', 'page');
    expect(links.filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveAccessibleName(r.label);
    expect(document.title).toBe(`${r.label} · Labyrinth`);
  }

  // Back/forward or a pasted URL: a hash change alone switches the view.
  act(() => {
    location.hash = '#/forecast';
  });
  await waitFor(() => expect(screen.getByText('view:forecast')).toBeInTheDocument());

  // Unknown hash falls back to the default view and rewrites the URL.
  act(() => {
    location.hash = '#/nope';
  });
  await waitFor(() => expect(screen.getByText('view:locate')).toBeInTheDocument());
  expect(location.hash).toBe('#/locate');
});

test('A2 global mode: REPLAY ($0) unless /api/live/status reports live; no backend => full replay', async () => {
  // No backend: every request fails.
  const f = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
  const { unmount } = render(<App pollMs={60_000} />);
  const mode = screen.getByRole('status', { name: /^Mode:/ });
  expect(within(mode).getByText('Replay · $0')).toBeInTheDocument();
  await waitFor(() => expect(mode).toHaveTextContent(/No live backend reachable/));
  expect(f).toHaveBeenCalledWith('/api/live/status', expect.anything());
  expect(document.querySelector('[data-status="live"]')).toBeNull();
  expect(screen.getByRole('banner').textContent).not.toMatch(/LIVE/);
  // Replay still works: the view renders.
  expect(screen.getByText('view:locate')).toBeInTheDocument();
  unmount();

  // Backend reports live: the only path to the LIVE indicator.
  stubFetch((url) => (url === '/api/live/status' ? json(status('live')) : new Response('', { status: 404 })));
  const live = render(<App pollMs={60_000} />);
  await waitFor(() => expect(screen.getByText('LIVE · GPU 0 / GPU 1')).toBeInTheDocument());
  expect(document.querySelector('.shell-mode [data-status="live"]')).not.toBeNull();
  live.unmount();

  // The mapping for every mode (DESIGN.md §5).
  const ready = (m: LiveStatus['mode']): LiveState => ({ status: 'ready', data: status(m) });
  const pills = (s: LiveState) => modeView(s).pills.map((p) => `${p.status}:${p.text}`);
  expect(pills({ status: 'connecting' })).toEqual(['replay:Replay · $0']);
  expect(pills({ status: 'unreachable', message: 'x' })).toEqual(['replay:Replay · $0']);
  expect(pills(ready('unavailable'))).toEqual(['replay:Replay · $0']);
  expect(pills(ready('idle'))).toEqual(['replay:Replay · $0']);
  expect(pills(ready('terminated'))).toEqual(['replay:Replay · $0']);
  expect(pills(ready('launching'))).toEqual(['rehearsal:Launching…']);
  expect(pills(ready('fallback'))).toEqual(['failed:Worker failed', 'replay:Playing saved run']);
  expect(pills(ready('live'))).toEqual(['live:LIVE · GPU 0 / GPU 1']);
  for (const m of ['unavailable', 'idle', 'launching', 'fallback', 'terminated'] as const) {
    expect(modeView(ready(m)).pills.some((p) => p.status === 'live')).toBe(false);
  }
});

test('A4 header states the user decision and a global provenance legend is shown', () => {
  stubFetch(() => new Response('', { status: 404 }));
  render(<App pollMs={60_000} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?',
  );
  expect(DECISION_QUESTION).toBe('Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?');
  const legend = screen.getByRole('region', { name: 'Provenance legend' });
  for (const label of ['Replay', 'Archive', 'Derived', 'PRD-reported', 'Rehearsal', 'Verified', 'Unverified', 'Blocked', 'Mismatch', 'Failed']) {
    expect(within(legend).getByText(label, { selector: '.lab-pill__text' })).toBeInTheDocument();
  }
  // Every pill is explained in words, and the legend never draws a LIVE pill.
  expect(within(legend).getByText('Stated in PRD.md; no underlying data in this repo.')).toBeInTheDocument();
  expect(legend.querySelector('[data-status="live"]')).toBeNull();
});
