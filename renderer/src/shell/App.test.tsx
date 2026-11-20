import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VERIFICATION_STATUS } from '../design';
import { App, DECISION_QUESTION } from './App';
import { modeView } from './ModeIndicator';
import { ROUTES, routeDef } from './routes';
import type { LiveState, LiveStatus } from '../lib/liveStatus';

// The shell is tested on its own: each view is replaced by a marker so the shell's routing,
// mode indicator and header are what is exercised (the views have their own tests).
// `boom` lets one test make a view throw while rendering; the budget marker also reads the shared
// live status the way a real view does (useLiveStatus), to prove there is one poller for all.
const boom = vi.hoisted(() => ({ advance: false, transport: false }));
vi.mock('../features/geometry/GeometryView', () => ({ GeometryView: () => <p>view:locate</p> }));
vi.mock('../features/live-gx/LiveView', () => ({
  LiveView: () => {
    if (boom.advance) throw new Error('phases[0].workers is undefined');
    return <p>view:advance</p>;
  },
}));
vi.mock('../features/transport/TransportView', () => ({
  TransportView: () => {
    if (boom.transport) throw new Error('windows[0].mean is undefined');
    return <p>view:transport</p>;
  },
}));
vi.mock('../features/forecast/ForecastView', () => ({ ForecastView: () => <p>view:forecast</p> }));
vi.mock('../features/spatial/SpatialView', () => ({ SpatialView: () => <p>view:spatial</p> }));
vi.mock('../features/budget/BudgetView', async () => {
  const { useLiveStatus } = await import('../lib/liveStatus');
  return {
    BudgetView: () => {
      const s = useLiveStatus(5000);
      return (
        <>
          <p>view:budget</p>
          <p data-testid="view-live-probe">{s.status === 'ready' ? `ready:${s.data.mode}` : s.status}</p>
        </>
      );
    },
  };
});

const status = (mode: LiveStatus['mode'], extra: Partial<LiveStatus> = {}): LiveStatus => ({
  schemaVersion: 1,
  mode,
  reason: `reason for ${mode}`,
  budget: { ceilingUsd: 40, billedUsd: 0, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true },
  workers: [],
  fallback:
    mode === 'fallback'
      ? { active: true, label: 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null }
      : { active: false, label: '', savedRunId: null },
  ...extra,
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const f = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', f);
  return f;
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const serveStatus = (body: unknown) => stubFetch((url) => (url === '/api/live/status' ? json(body) : new Response('', { status: 404 })));
const statusCalls = (f: ReturnType<typeof stubFetch>) => f.mock.calls.filter((c) => String(c[0]) === '/api/live/status').length;

const banner = () => screen.getByRole('banner');
const modeBox = () => screen.getByRole('status', { name: /^Mode:/ });
const navLinks = () => within(screen.getByRole('navigation', { name: 'Views' })).getAllByRole('link');
const headerPills = () => [...banner().querySelectorAll<HTMLElement>('.shell-mode .lab-pill')].map((p) => `${p.dataset.status}:${p.textContent}`);

beforeEach(() => {
  history.replaceState(null, '', '/');
  boom.advance = false;
  boom.transport = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

test('A1 a route change is announced and moves focus to the view, unless the keyboard is in the nav (FE-12)', async () => {
  stubFetch(() => new Response('not found', { status: 404 }));
  const user = userEvent.setup();
  render(<App pollMs={60_000} />);
  const main = screen.getByRole('main');
  const announcer = screen.getByTestId('route-announcer');
  expect(announcer).toHaveAttribute('aria-live', 'polite');

  // Initial load: nothing is announced and focus is not stolen.
  expect(announcer).toBeEmptyDOMElement();
  expect(document.body).toHaveFocus();

  // Back/Forward or an edited URL (focus is not in the nav): focus lands on the new view.
  act(() => {
    location.hash = '#/forecast';
  });
  await waitFor(() => expect(main).toHaveFocus());
  expect(main).toHaveAccessibleName('Forecast replay');
  expect(announcer).toHaveTextContent('Forecast replay view');

  // Keyboard on a nav link: the announcement is made and focus stays on the link (Tab continues along the nav).
  const links = navLinks();
  links[5]!.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(announcer).toHaveTextContent('Budget view'));
  expect(screen.getByText('view:budget')).toBeInTheDocument();
  expect(links[5]).toHaveFocus();
});

test('DS-5 the active nav tab is centred inside the nav scroller (the page is never scrolled) and hidden edges are flagged', async () => {
  stubFetch(() => new Response('not found', { status: 404 }));
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  render(<App pollMs={60_000} />);
  const scroller = screen.getByRole('navigation', { name: 'Views' }).querySelector<HTMLElement>('.shell-nav__scroll')!;
  expect(scroller).not.toBeNull();
  const links = navLinks();
  // A 390 px phone: six 122 px tabs (732 px) inside a 390 px scroller.
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 390 });
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 732 });
  scroller.getBoundingClientRect = () => ({ left: 0, width: 390 }) as DOMRect;
  links.forEach((l, i) => {
    l.getBoundingClientRect = () => ({ left: i * 122 - scroller.scrollLeft, width: 122 }) as DOMRect;
  });

  const go = async (id: string) => {
    act(() => {
      location.hash = `#/${id}`;
    });
    await waitFor(() => expect(screen.getByText(`view:${id}`)).toBeInTheDocument());
  };
  await go('transport'); // tab 2: centre = 244 − (390 − 122) / 2
  expect(scroller.scrollLeft).toBe(110);
  expect(scroller).toHaveAttribute('data-fade', 'both');
  await go('budget'); // last tab: clamped to the end, only the start is hidden
  expect(scroller.scrollLeft).toBe(342);
  expect(scroller).toHaveAttribute('data-fade', 'start');
  await go('locate'); // first tab: back at 0, only the end is hidden
  expect(scroller.scrollLeft).toBe(0);
  expect(scroller).toHaveAttribute('data-fade', 'end');
  // A manual swipe updates the edge cue as well.
  scroller.scrollLeft = 200;
  act(() => {
    scroller.dispatchEvent(new Event('scroll'));
  });
  expect(scroller).toHaveAttribute('data-fade', 'both');
  expect(scrollIntoView).not.toHaveBeenCalled();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; // jsdom has none: leave it as it was
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
  expect(within(banner()).queryByRole('alert')).toBeNull();
  // Replay still works: the view renders.
  expect(screen.getByText('view:locate')).toBeInTheDocument();
  unmount();

  // Backend reports live: the only path to the LIVE indicator.
  stubFetch((url) => (url === '/api/live/status' ? json(status('live')) : new Response('', { status: 404 })));
  const live = render(<App pollMs={60_000} />);
  await waitFor(() => expect(screen.getByText('LIVE · GPU 0 / GPU 1')).toBeInTheDocument());
  expect(document.querySelector('.shell-mode [data-status="live"]')).not.toBeNull();
  expect(within(banner()).queryByRole('alert')).toBeNull(); // a healthy live session is not an alert
  live.unmount();

  // The mapping for every mode (DESIGN.md §5).
  const ready = (m: LiveStatus['mode'], extra: Partial<LiveStatus> = {}): LiveState => ({ status: 'ready', data: status(m, extra) });
  const pills = (s: LiveState) => modeView(s).pills.map((p) => `${p.status}:${p.text}`);
  expect(pills({ status: 'connecting' })).toEqual(['replay:Replay · $0']);
  expect(pills({ status: 'unreachable', message: 'x' })).toEqual(['replay:Replay · $0']);
  expect(pills(ready('unavailable'))).toEqual(['replay:Replay · $0']);
  expect(pills(ready('idle'))).toEqual(['replay:Replay · $0']);
  expect(pills(ready('terminated'))).toEqual(['replay:Replay · $0']);
  expect(pills(ready('launching'))).toEqual(['rehearsal:Launching…']);
  expect(pills(ready('live'))).toEqual(['live:LIVE · GPU 0 / GPU 1']);
  for (const m of ['unavailable', 'idle', 'launching', 'fallback', 'terminated'] as const) {
    expect(modeView(ready(m)).pills.some((p) => p.status === 'live')).toBe(false);
  }

  // Fallback: the first pill is the backend's own cause; "Playing saved run" needs a saved run to exist.
  const saved = { active: true, label: 'Worker failed — playing saved GX run rehearsal-0123456789ab', savedRunId: 'rehearsal-0123456789ab' };
  expect(pills(ready('fallback', { qualified: true, fallback: saved }))).toEqual(['failed:Worker failed', 'replay:Playing saved run']);
  expect(pills(ready('fallback'))).toEqual(['failed:Worker failed', 'replay:Replay · $0']); // savedRunId: null
  expect(pills(ready('fallback', { qualified: false, fallback: saved }))).toEqual(['failed:Worker failed', 'replay:Replay · $0']);
  const timeout = { active: true, label: 'Hard timeout reached — playing saved GX run rehearsal-0123456789ab', savedRunId: 'rehearsal-0123456789ab' };
  expect(pills(ready('fallback', { qualified: true, fallback: timeout }))).toEqual(['failed:Hard timeout reached', 'replay:Playing saved run']);
  const timeoutNoRun = { active: true, label: 'Hard timeout reached. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', savedRunId: null };
  expect(pills(ready('fallback', { fallback: timeoutNoRun }))).toEqual(['failed:Hard timeout reached', 'replay:Replay · $0']);
});

const TERM_REASONS = {
  'TERMINATE FAILED':
    'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean) terminate unconfirmed after 4 attempts: RuntimeError: boom. Stopped on request; workers terminated.',
  'TERMINATION PENDING':
    'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs may still be billing: GPU 1 (triangular) termination pending: late spawn. Both workers launched; streaming GX output (live).',
} as const;
const MODES = ['live', 'fallback', 'launching', 'terminated', 'idle', 'unavailable'] as const;
const DANGER_CASES = MODES.flatMap((mode, i) =>
  (Object.keys(TERM_REASONS) as (keyof typeof TERM_REASONS)[]).map((marker, j) => [mode, marker, ROUTES[(i + j) % ROUTES.length]!.id] as const),
);

test.each(DANGER_CASES)(
  'A2 danger: mode %s with %s in the reason is a loud alert on #/%s, never a plain LIVE or Replay pill',
  async (mode, marker, route) => {
    history.replaceState(null, '', `#/${route}`);
    serveStatus(status(mode, { reason: TERM_REASONS[marker] }));
    render(<App pollMs={60_000} />);
    const alert = await within(banner()).findByRole('alert');
    expect(alert).toHaveTextContent(`${marker} — GPUs may still be billing`);
    expect(alert).toHaveTextContent(TERM_REASONS[marker]); // the backend's own words, in full
    expect(screen.getByText(`view:${route}`)).toBeInTheDocument();
    // The indicator leads with a failed pill naming the marker; "Replay · $0" would be a false comfort.
    const pills = headerPills();
    expect(pills[0]).toBe(`failed:${marker}`);
    expect(pills.some((p) => p.startsWith('replay:'))).toBe(false);
    expect(`${modeBox().textContent} ${alert.textContent}`).not.toMatch(/\$0|Replay/);
    expect(pills.filter((p) => p.startsWith('live:'))).toHaveLength(mode === 'live' ? 1 : 0);
    expect(modeBox()).toHaveAccessibleName(new RegExp(`^Mode: ${marker}`));
    // From any other view the alert links to the Terminate control.
    const link = within(alert).queryByRole('link', { name: /Advance plasma/ });
    expect(link?.getAttribute('href') ?? null).toBe(route === 'advance' ? null : '#/advance');
  },
);

test('A2 danger: the marker is found anywhere in the reason, in any letter case', async () => {
  serveStatus(
    status('fallback', {
      reason:
        'Session thread still running after 497 s; termination unconfirmed. TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean) terminate failed.',
    }),
  );
  const a = render(<App pollMs={60_000} />);
  expect(await within(banner()).findByRole('alert')).toHaveTextContent('TERMINATE FAILED — GPUs may still be billing');
  expect(headerPills()[0]).toBe('failed:TERMINATE FAILED');
  a.unmount();

  serveStatus(status('terminated', { reason: 'Stopped; termination pending for GPU 1 (cancel queued).' }));
  render(<App pollMs={60_000} />);
  expect(await within(banner()).findByRole('alert')).toHaveTextContent('TERMINATION PENDING — GPUs may still be billing');
});

test('A2 LIVE is not sticky: when a live session stops answering, the header says the session state is unknown', async () => {
  let answer: LiveStatus | null = status('live', { reason: 'Both workers launched; streaming GX output (live).' });
  stubFetch((url) => {
    if (url !== '/api/live/status') return new Response('', { status: 404 });
    if (!answer) throw new TypeError('Failed to fetch');
    return json(answer);
  });
  render(<App pollMs={30} />);
  await waitFor(() => expect(screen.getByText('LIVE · GPU 0 / GPU 1')).toBeInTheDocument());
  answer = null;
  const alert = await within(banner()).findByRole('alert');
  expect(alert).toHaveTextContent(/CONNECTION LOST — session state unknown/);
  expect(alert).toHaveTextContent('The live API stopped answering (Failed to fetch)'); // from the failed poll itself
  expect(alert).toHaveTextContent(/mode "live"/);
  expect(alert).toHaveTextContent('GPUs may still be billing');
  expect(document.querySelector('[data-status="live"]')).toBeNull();
  expect(headerPills()).toEqual(['failed:Connection lost']);
  expect(`${modeBox().textContent} ${alert.textContent}`).not.toMatch(/\$0|Replay/);
  // The backend answers again with a clean idle status: the alert goes away.
  answer = status('idle');
  await waitFor(() => expect(within(banner()).queryByRole('alert')).toBeNull());
  expect(headerPills()).toEqual(['replay:Replay · $0']);
});

test('A2 an idle backend that goes away is plain replay, not an alert', async () => {
  let up = true;
  stubFetch((url) => {
    if (url !== '/api/live/status') return new Response('', { status: 404 });
    if (!up) return new Response('Bad gateway', { status: 502 });
    return json(status('idle'));
  });
  render(<App pollMs={30} />);
  await waitFor(() => expect(modeBox()).toHaveTextContent('reason for idle'));
  up = false;
  await waitFor(() => expect(modeBox()).toHaveTextContent(/No live backend reachable/));
  expect(within(banner()).queryByRole('alert')).toBeNull();
  expect(headerPills()).toEqual(['replay:Replay · $0']);
});

test('A2 a partial or malformed status body never blanks the page: it is rejected and the app stays in replay', async () => {
  const bodies: unknown[] = [
    { schemaVersion: 1, mode: 'fallback' }, // blanked the whole page before (VERIFY.md finding 2)
    { schemaVersion: 1, mode: 'fallback', reason: '' },
    { schemaVersion: 1, mode: 'live' }, // used to show LIVE from a body with no workers, budget or reason
    { ...status('live'), workers: 'two' },
    { ...status('live'), mode: 'LIVE' },
    { ...status('fallback'), fallback: null },
  ];
  for (const body of bodies) {
    serveStatus(body);
    const r = render(<App pollMs={60_000} />);
    await waitFor(() => expect(modeBox()).toHaveTextContent(/invalid status/));
    expect(headerPills()).toEqual(['replay:Replay · $0']);
    expect(document.querySelector('[data-status="live"]')).toBeNull();
    expect(navLinks()).toHaveLength(6);
    expect(screen.getByText('view:locate')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(DECISION_QUESTION);
    r.unmount();
  }
});

test('FE-5 the header and the views read one shared status store: one poller, one answer for all', async () => {
  history.replaceState(null, '', '#/budget');
  const f = serveStatus(status('idle', { reason: 'Qualified. Launch requires explicit confirmation of the slot cost.' }));
  render(<App pollMs={60_000} />);
  await waitFor(() => expect(modeBox()).toHaveTextContent('Qualified.'));
  // The view got the same snapshot at the same time, from the same single request.
  expect(screen.getByTestId('view-live-probe')).toHaveTextContent('ready:idle');
  expect(statusCalls(f)).toBe(1);
  // Changing the view does not start another poller or drop the state.
  act(() => {
    location.hash = '#/spatial';
  });
  await waitFor(() => expect(screen.getByText('view:spatial')).toBeInTheDocument());
  act(() => {
    location.hash = '#/budget';
  });
  await waitFor(() => expect(screen.getByTestId('view-live-probe')).toHaveTextContent('ready:idle'));
  expect(statusCalls(f)).toBe(1);
});

test('A3 a view that throws shows the named error panel inside the shell, and navigating away recovers', async () => {
  stubFetch(() => new Response('not found', { status: 404 }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  boom.transport = true;
  boom.advance = true;
  history.replaceState(null, '', '#/transport');
  render(<App pollMs={60_000} />);
  expect(screen.getByRole('heading', { name: 'Could not load artifacts/transport.json' })).toBeInTheDocument();
  expect(screen.getByText('windows[0].mean is undefined')).toBeInTheDocument();
  // The shell survives: header, nav and legend are still there.
  expect(navLinks()).toHaveLength(6);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(DECISION_QUESTION);
  expect(screen.getByRole('region', { name: 'Provenance legend' })).toBeInTheDocument();

  // The boundary is per route: the next view renders instead of the stale error.
  act(() => {
    location.hash = '#/forecast';
  });
  await waitFor(() => expect(screen.getByText('view:forecast')).toBeInTheDocument());
  expect(screen.queryByRole('heading', { name: /^Could not load/ })).toBeNull();

  // Advance plasma reads the live API and artifacts/transport.json: its panel names both.
  act(() => {
    location.hash = '#/advance';
  });
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Could not load /api/live/status, artifacts/transport.json' })).toBeInTheDocument(),
  );
  expect(routeDef('advance').files).toEqual(['/api/live/status', 'artifacts/transport.json']);
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

test('A4 the legend explains every provenance kind and verification outcome defined in contracts/common.schema.json', () => {
  const defs = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/common.schema.json'), 'utf8')).$defs;
  const kinds: string[] = defs.provenance.properties.kind.enum;
  const outcomes: (keyof typeof VERIFICATION_STATUS)[] = defs.verification.properties.outcome.enum;
  expect(kinds).toEqual(expect.arrayContaining(['archive', 'derived', 'prd-reported', 'live', 'rehearsal']));
  expect(outcomes).toEqual(expect.arrayContaining(['passed', 'failed', 'blocked', 'not-applicable']));

  stubFetch(() => new Response('', { status: 404 }));
  render(<App pollMs={60_000} />);
  const legend = screen.getByRole('region', { name: 'Provenance legend' });
  const explained = (statusKind: string) => {
    const pill = legend.querySelector(`dt [data-status="${statusKind}"]`);
    return pill?.closest('.shell-legend__item')?.querySelector('dd')?.textContent?.trim() ?? null;
  };
  // Every kind except `live` has a pill with a sentence; `live` is described in words and never drawn.
  for (const kind of kinds.filter((k) => k !== 'live')) {
    expect(explained(kind), `kind ${kind}`).toMatch(/\w+ \w+/);
  }
  expect(legend.querySelector('[data-status="live"]')).toBeNull();
  expect(legend).toHaveTextContent(/LIVE indicator appears in the header only while the live backend reports/);
  // Every outcome, through the design system's own outcome -> status mapping.
  for (const outcome of outcomes) {
    expect(explained(VERIFICATION_STATUS[outcome]), `outcome ${outcome}`).toMatch(/\w+ \w+/);
  }
  expect(explained('not-applicable')).toBe('No verification applies.');
});
