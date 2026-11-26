import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { ROUTES } from './routes';
import type { LiveStatus } from '../lib/liveStatus';

// The shell is tested on its own: each view is replaced by a marker so the shell's routing, the live-session bar
// and the header are what is exercised (the views have their own tests). `boom` lets a test make a view throw while
// rendering; the forecast marker also reads the shared live status to prove there is one poller for the shell and views.
const boom = vi.hoisted(() => ({ spatial: false, locate: false }));
vi.mock('../features/geometry/GeometryView', () => ({ GeometryView: () => { if (boom.locate) throw new Error('geometry unavailable'); return <p>view:locate</p>; } }));
vi.mock('../features/forecast/ForecastView', async () => {
  const { useLiveStatus } = await import('../lib/liveStatus');
  return {
    ForecastView: () => {
      const s = useLiveStatus(5000);
      return (
        <>
          <p>view:forecast</p>
          <p data-testid="view-live-probe">
            {s.status === 'ready' ? `ready:${s.data.mode}` : s.status === 'unreachable' ? `unreachable:${s.cause}` : s.status}
          </p>
        </>
      );
    },
  };
});
vi.mock('../features/validation/ValidationView', () => ({ ValidationView: () => <p>view:validation</p> }));
vi.mock('../features/spatial/SpatialView', () => ({
  SpatialView: () => {
    if (boom.spatial) throw new Error('runs[0].ranks is undefined');
    return <p>view:spatial</p>;
  },
}));

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

const navLinks = () => within(screen.getByRole('navigation', { name: 'Views' })).getAllByRole('link');
const navLabels = () => navLinks().map((l) => l.querySelector('.shell-nav__label')?.textContent);
/** The owner's live-session bar under the header: "Modal session active" with Terminate (launching or live, no danger). */
const sessionBar = () => screen.queryByText('Modal session active');
const probe = () => screen.getByTestId('view-live-probe');
beforeEach(() => {
  history.replaceState(null, '', '/');
  boom.spatial = false;
  boom.locate = false;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------------------------- A1 navigation

test('an unknown route opens geometry', async () => {
  history.replaceState(null, '', '#/unknown');
  render(<App />);
  await waitFor(() => expect(location.hash).toBe('#/locate'));
  expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('W7-X Model');
  expect(screen.queryByRole('contentinfo')).toBeNull();
});

test('A1 three keyboard-accessible views, current page and route announcements', async () => {
  const user = userEvent.setup();
  render(<App />);
  const links = within(screen.getByRole('navigation', {name: 'Views'})).getAllByRole('link');
  expect(navLabels()).toEqual(['W7-X Model', 'Validation', 'Forecast replay', 'Spatial parallelism']);
  for (const [i, route] of ROUTES.entries()) {
    links[i]!.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(links[i]).toHaveAttribute('aria-current', 'page'));
    expect(links[i]).toHaveFocus();
    expect(screen.getByRole('main')).toHaveAccessibleName(route.label);
  }
  screen.getByRole('main').focus();
  act(() => { location.hash = '#/forecast'; });
  await waitFor(() => expect(screen.getByTestId('route-announcer')).toHaveTextContent('Forecast replay view'));
  expect(screen.getByRole('main')).toHaveFocus();
});

test('A1 navigation reaches all three views by keyboard and the URL hash names the view', async () => {
  const user = userEvent.setup();
  render(<App />);

  // Empty hash is normalised to the default view.
  expect(location.hash).toBe('#/locate');
  expect(screen.getByText('view:locate')).toBeInTheDocument();

  const links = navLinks();
  expect(links.map((l) => l.getAttribute('href'))).toEqual(['#/locate', '#/validation', '#/forecast', '#/spatial']);
  expect(links.map((l) => l.getAttribute('href'))).toEqual(ROUTES.map((r) => `#/${r.id}`));
  expect(links[0]).toHaveAttribute('aria-current', 'page');
  // Keyboard: Tab past the skip link to the nav, then through each link + Enter.
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(r.label);
    expect(document.title).toBe(`${r.label} · Labyrinth`);
  }

  // Back/forward or a pasted URL: a hash change alone switches the view.
  act(() => {
    location.hash = '#/forecast';
  });
  await waitFor(() => expect(screen.getByText('view:forecast')).toBeInTheDocument());
  act(() => {
    location.hash = '#/spatial';
  });
  await waitFor(() => expect(screen.getByText('view:spatial')).toBeInTheDocument());

  // Unknown hash falls back to the default view and rewrites the URL.
  act(() => {
    location.hash = '#/nope';
  });
  await waitFor(() => expect(screen.getByText('view:locate')).toBeInTheDocument());
  expect(location.hash).toBe('#/locate');
});

test('visited tabs retain their mounted view until the shell is reloaded', async () => {
  const user = userEvent.setup();
  const first = render(<App />);
  expect(screen.queryByText('view:spatial')).toBeNull();
  const markers = new Map<string, HTMLElement>();

  for (const { id, label } of ROUTES) {
    await user.click(screen.getByRole('link', { name: label }));
    const view = await screen.findByText('view:' + id);
    expect(view).toBeVisible();
    markers.set(id, view);
  }
  for (const { id, label } of ROUTES) {
    await user.click(screen.getByRole('link', { name: label }));
    await waitFor(() => expect(markers.get(id)).toBeVisible());
    expect(screen.getByText('view:' + id)).toBe(markers.get(id));
    for (const [other, view] of markers) {
      if (other !== id) expect(view).not.toBeVisible();
    }
  }

  first.unmount();
  render(<App />);
  expect(screen.getByText('view:spatial')).not.toBe(markers.get('spatial'));
  expect(screen.queryByText('view:locate')).toBeNull();
  expect(screen.queryByText('view:forecast')).toBeNull();
});

test('A1 a route change is announced and moves focus to the view, unless the keyboard is in the nav (FE-12)', async () => {
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
  links[3]!.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(announcer).toHaveTextContent('Spatial parallelism view'));
  expect(screen.getByText('view:spatial')).toBeInTheDocument();
  expect(links[3]).toHaveFocus();
});

test('DS-5 the active nav tab is centred inside the nav scroller (the page is never scrolled) and hidden edges are flagged', async () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  render(<App pollMs={60_000} />);
  const scroller = screen.getByRole('navigation', { name: 'Views' }).querySelector<HTMLElement>('.shell-nav__scroll')!;
  expect(scroller).not.toBeNull();
  const links = navLinks();
  // Four 122 px tabs inside a 215 px scroller.
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 215 });
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 488 });
  scroller.getBoundingClientRect = () => ({ left: 0, width: 215 }) as DOMRect;
  links.forEach((l, i) => {
    l.getBoundingClientRect = () => ({ left: i * 122 - scroller.scrollLeft, width: 122 }) as DOMRect;
  });

  const go = async (id: string) => {
    act(() => {
      location.hash = `#/${id}`;
    });
    await waitFor(() => expect(screen.getByText(`view:${id}`)).toBeInTheDocument());
  };
  // The edge cue is state set from the scroll effect: it lands one render after the view (waited for, not raced).
  await go('validation'); // 122 − (215 − 122) / 2
  expect(scroller.scrollLeft).toBe(76);
  await waitFor(() => expect(scroller).toHaveAttribute('data-fade', 'both'));
  await go('spatial'); // 366 − (215 − 122) / 2, clamped to 488 − 215
  expect(scroller.scrollLeft).toBe(273);
  await waitFor(() => expect(scroller).toHaveAttribute('data-fade', 'start'));
  await go('locate'); // first tab: back at 0, only the end is hidden
  expect(scroller.scrollLeft).toBe(0);
  await waitFor(() => expect(scroller).toHaveAttribute('data-fade', 'end'));
  // A manual swipe updates the edge cue as well.
  scroller.scrollLeft = 100;
  act(() => {
    scroller.dispatchEvent(new Event('scroll'));
  });
  expect(scroller).toHaveAttribute('data-fade', 'both');
  expect(scrollIntoView).not.toHaveBeenCalled();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; // jsdom has none: leave it as it was
});

// --------------------------------------------------------------------------------------------- A2 global mode

test('A2 no backend reachable: the app runs fully in replay, with no session bar, no alert and nothing marked live', async () => {
  history.replaceState(null, '', '#/forecast');
  const f = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
  render(<App pollMs={60_000} />);
  await waitFor(() => expect(probe()).toHaveTextContent('unreachable:network'));
  expect(f).toHaveBeenCalledWith('/api/live/status', expect.anything());
  expect(sessionBar()).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.querySelector('[data-status="live"]')).toBeNull();
  expect(within(screen.getByRole('banner')).queryByRole('status', { name: /^Mode:/ })).toBeNull();
  expect(screen.getByRole('main').textContent).not.toMatch(/\bLIVE\b/);
  // Replay still works: the view and the whole nav render.
  expect(screen.getByText('view:forecast')).toBeInTheDocument();
  expect(navLinks()).toHaveLength(ROUTES.length);
});

const SESSION_CASES = ROUTES.flatMap((r) => (['launching', 'live'] as const).map((mode) => [mode, r.id] as const));

test.each(SESSION_CASES)('A2 a %s session shows "Modal session active" with Terminate on #/%s, never an alert, "Replay" or a zero price', async (mode, route) => {
  history.replaceState(null, '', `#/${route}`);
  serveStatus(status(mode));
  render(<App pollMs={60_000} />);
  const bar = await screen.findByText('Modal session active');
  expect(bar).toHaveAttribute('role', 'status');
  expect(within(bar).getByRole('button', { name: 'Terminate' })).toBeEnabled();
  expect(bar.textContent).not.toMatch(/\$0|Replay/);
  expect(screen.queryByRole('alert')).toBeNull(); // a healthy session is not an alert
  expect(screen.getByText(`view:${route}`)).toBeInTheDocument();
});

test.each(['idle', 'unavailable', 'terminated', 'fallback'] as const)('A2 mode %s with no danger shows no session bar and no alert', async (mode) => {
  history.replaceState(null, '', '#/forecast');
  serveStatus(status(mode));
  render(<App pollMs={60_000} />);
  await waitFor(() => expect(probe()).toHaveTextContent(`ready:${mode}`));
  expect(sessionBar()).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.querySelector('[data-status="live"]')).toBeNull();
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

test('A2 the danger cases cover every route', () => {
  expect(new Set(DANGER_CASES.map((c) => c[2]))).toEqual(new Set(ROUTES.map((r) => r.id)));
});

test.each(DANGER_CASES)(
  'A2 danger: mode %s with %s in the reason is a loud alert with Terminate on #/%s, never a session bar, "Replay" or a zero price',
  async (mode, marker, route) => {
    history.replaceState(null, '', `#/${route}`);
    serveStatus(status(mode, { reason: TERM_REASONS[marker] }));
    render(<App pollMs={60_000} />);
    const alert = await screen.findByRole('alert', { name: `Danger: ${marker} — GPUs may still be billing` });
    // FA-1: the design system's danger primitive, spoken as a danger, quoting the backend's own words in full.
    expect(alert).toHaveClass('lab-alert');
    expect(alert).toHaveAttribute('data-status', 'billing-risk');
    expect(alert.querySelector('.lab-alert__reason')?.textContent).toBe(TERM_REASONS[marker]);
    expect(alert).toHaveTextContent('Check the Modal dashboard until both workers are confirmed stopped.');
    expect(screen.getByText(`view:${route}`)).toBeInTheDocument();
    // Terminate is right there, on every route (the owner's redesign): "Retry" after a failed stop.
    expect(within(alert).getByRole('button', { name: marker === 'TERMINATE FAILED' ? 'Retry terminate' : 'Terminate' })).toBeEnabled();
    expect(alert.textContent).not.toMatch(/\$0|Replay/);
    // The danger wins over the healthy-session bar.
    expect(sessionBar()).toBeNull();
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
  expect(await screen.findByRole('alert')).toHaveTextContent('TERMINATE FAILED — GPUs may still be billing');
  a.unmount();

  serveStatus(status('terminated', { reason: 'Stopped; termination pending for GPU 1 (cancel queued).' }));
  render(<App pollMs={60_000} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('TERMINATION PENDING — GPUs may still be billing');
});

// FA-1 / FA-2: the round-6 stop states, in the backend's words (orchestrator.py:61-62, :320-333; modal_backend.py:183),
// on every route: never terminated, never "Replay · $0".
const ROUND6_STATES = [
  [
    'a kill-switch-only stop',
    'fallback',
    "TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean) kill switch raised, stop not confirmed: the spawn failed client-side (ConnectionError: reset) after it may have reached Modal, there is no call to cancel and a worker that started stops only when it reads the switch. GPU 0 (bean) worker failed: launch failed client-side (ConnectionError: reset) and a worker may have started; there is no call to cancel, only the run's kill switch can stop it.",
    'TERMINATE FAILED — GPUs may still be billing',
    'Retry terminate',
  ],
  [
    'a requested stop while live',
    'live',
    'Stop requested; terminating workers — not confirmed yet. Both workers launched; streaming GX output (live).',
    'STOP NOT CONFIRMED — GPUs may still be billing',
    'Terminate',
  ],
  [
    'a requested stop while launching',
    'launching',
    'Stop requested; terminating workers — not confirmed yet. Launching GX workers (live); hard timeout 1500 s.',
    'STOP NOT CONFIRMED — GPUs may still be billing',
    'Terminate',
  ],
] as const;
const ROUND6_CASES = ROUND6_STATES.flatMap(([name, mode, reason, title, button]) =>
  ROUTES.map((r) => [name, r.id, mode, reason, title, button] as const),
);

test.each(ROUND6_CASES)('A2 FA-1 %s is the billing-risk alert on #/%s', async (_name, route, mode, reason, title, button) => {
  history.replaceState(null, '', `#/${route}`);
  serveStatus(status(mode, { reason }));
  render(<App pollMs={60_000} />);
  const alert = await screen.findByRole('alert', { name: `Danger: ${title}` });
  expect(alert).toHaveAttribute('data-status', 'billing-risk');
  expect(alert.querySelector('.lab-alert__reason')?.textContent).toBe(reason);
  expect(alert.textContent).not.toMatch(/\$0|Replay|terminated\./);
  expect(within(alert).getByRole('button', { name: button })).toBeEnabled();
  expect(sessionBar()).toBeNull();
  expect(screen.getByText(`view:${route}`)).toBeInTheDocument();
});

test('A2 a live session is not sticky: when it stops answering, the alert says the session state is unknown', async () => {
  let answer: LiveStatus | null = status('live', { reason: 'Both workers launched; streaming GX output (live).' });
  stubFetch((url) => {
    if (url !== '/api/live/status') return new Response('', { status: 404 });
    if (!answer) throw new TypeError('Failed to fetch');
    return json(answer);
  });
  render(<App pollMs={30} />);
  await waitFor(() => expect(sessionBar()).not.toBeNull());
  answer = null;
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/CONNECTION LOST — session state unknown/);
  expect(alert).toHaveTextContent('The live API stopped answering (Failed to fetch)'); // from the failed poll itself
  expect(alert).toHaveTextContent(/mode "live"/);
  expect(alert).toHaveTextContent('GPUs may still be billing');
  expect(alert).toHaveAccessibleName('Danger: CONNECTION LOST — session state unknown');
  expect(within(alert).getByRole('button', { name: 'Terminate' })).toBeEnabled();
  expect(alert.textContent).not.toMatch(/\$0|Replay/);
  expect(sessionBar()).toBeNull();
  // The backend answers again with a clean idle status: the alert goes away and nothing is left behind.
  answer = status('idle');
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(sessionBar()).toBeNull();
});

test('A2 an idle backend that goes away is plain replay, not an alert', async () => {
  history.replaceState(null, '', '#/forecast');
  let up = true;
  stubFetch((url) => {
    if (url !== '/api/live/status') return new Response('', { status: 404 });
    if (!up) return new Response('Bad gateway', { status: 502 });
    return json(status('idle'));
  });
  render(<App pollMs={30} />);
  await waitFor(() => expect(probe()).toHaveTextContent('ready:idle'));
  up = false;
  await waitFor(() => expect(probe()).toHaveTextContent('unreachable:http'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(sessionBar()).toBeNull();
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
    history.replaceState(null, '', '#/forecast');
    serveStatus(body);
    const r = render(<App pollMs={60_000} />);
    await waitFor(() => expect(probe()).toHaveTextContent('unreachable:invalid'));
    // A rejected "live" body never claims a session.
    expect(sessionBar()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[data-status="live"]')).toBeNull();
    expect(navLinks()).toHaveLength(ROUTES.length);
    expect(screen.getByText('view:forecast')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Forecast replay');
    r.unmount();
  }
});

test('FE-5 the session bar and the views read one shared status store: one poller, one answer for all', async () => {
  history.replaceState(null, '', '#/forecast');
  const f = serveStatus(status('live', { reason: 'Both workers launched; streaming GX output (live).' }));
  render(<App pollMs={60_000} />);
  await waitFor(() => expect(sessionBar()).not.toBeNull());
  // The view got the same snapshot at the same time, from the same single request.
  expect(probe()).toHaveTextContent('ready:live');
  expect(statusCalls(f)).toBe(1);
  // Changing the view does not start another poller or drop the state.
  act(() => {
    location.hash = '#/spatial';
  });
  await waitFor(() => expect(screen.getByText('view:spatial')).toBeInTheDocument());
  expect(sessionBar()).not.toBeNull();
  act(() => {
    location.hash = '#/forecast';
  });
  await waitFor(() => expect(probe()).toHaveTextContent('ready:live'));
  expect(statusCalls(f)).toBe(1);
});

// --------------------------------------------------------------------------------------------- A3 view failures

test('A3 a view that throws shows the named error panel inside the shell, and navigating away recovers', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  boom.locate = true;
  boom.spatial = true;
  history.replaceState(null, '', '#/locate');
  render(<App pollMs={60_000} />);
  expect(screen.getByRole('heading', { name: 'Could not load artifacts/geometry.json' })).toBeInTheDocument();
  expect(screen.getByText('geometry unavailable')).toBeInTheDocument();
  // The shell survives: nav and view title are still there.
  expect(navLinks()).toHaveLength(ROUTES.length);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('W7-X Model');

  // The boundary is per route: the next view renders instead of the stale error.
  act(() => {
    location.hash = '#/forecast';
  });
  await waitFor(() => expect(screen.getByText('view:forecast')).toBeInTheDocument());
  expect(screen.queryByRole('heading', { name: /^Could not load/ })).toBeNull();

  act(() => {
    location.hash = '#/spatial';
  });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Could not load artifacts/spatial.json' })).toBeInTheDocument());
  // Every route names the file its view reads.
  expect(ROUTES.map((r) => [r.id, r.files])).toEqual([
    ['locate', ['artifacts/geometry.json']],
    ['validation', ['artifacts/geometry.json', 'artifacts/transport.json']],
    ['forecast', ['artifacts/forecast.json']],
    ['spatial', ['artifacts/spatial.json']],
  ]);
});

test('FE2-1 a view that fails to render during a billing risk leaves the Terminate above it working', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const user = userEvent.setup();
  const reason = TERM_REASONS['TERMINATE FAILED'];
  const posts: string[] = [];
  let terminateAnswer: { code: number; body: unknown } = { code: 502, body: { ok: false, reason, status: status('fallback', { reason }) } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posts.push(url);
        return new Response(JSON.stringify(terminateAnswer.body), { status: terminateAnswer.code });
      }
      return url === '/api/live/status' ? json(status('fallback', { reason })) : new Response('', { status: 404 });
    }),
  );
  boom.locate = true;
  history.replaceState(null, '', '#/locate');
  render(<App pollMs={60_000} />);
  const alert = await screen.findByRole('alert', { name: 'Danger: TERMINATE FAILED — GPUs may still be billing' });
  expect(screen.getByRole('heading', { name: 'Could not load artifacts/geometry.json' })).toBeInTheDocument();
  // The alert sits above the view, outside it: the failed view cannot take the control away.
  expect(screen.getByRole('main').contains(alert)).toBe(false);
  const retry = within(alert).getByRole('button', { name: 'Retry terminate' });
  await user.click(retry);
  await waitFor(() => expect(posts).toEqual(['/api/live/terminate']));
  expect(await within(alert).findByRole('status', { name: 'Terminate answer' })).toHaveTextContent(`Terminate not confirmed: ${reason}`);
  expect(alert).toHaveAccessibleName('Danger: TERMINATE FAILED — GPUs may still be billing');
  // A confirmed stop whose status is clean ends the danger: the alert goes.
  terminateAnswer = { code: 200, body: { ok: true, reason: 'Workers terminated.', status: status('idle') } };
  await user.click(within(alert).getByRole('button', { name: 'Retry terminate' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(posts).toHaveLength(2);
  expect(sessionBar()).toBeNull();
});

test.each(['transport', 'advance', 'budget'])('retired route %s returns to Locate', async (id) => {
  history.replaceState(null, '', '#/' + id);
  render(<App />);
  await waitFor(() => expect(location.hash).toBe('#/locate'));
  expect(screen.getByText('view:locate')).toBeInTheDocument();
});

test('the shared header strip and provenance legend are absent on each tab', async () => {
  render(<App />);
  for (const { id, label } of ROUTES) {
    act(() => { location.hash = '#/' + id; });
    await waitFor(() => expect(screen.getByRole('main')).toHaveAccessibleName(label));
    expect(screen.queryByText('Provenance legend')).toBeNull();
    expect(screen.queryByText(/Is this W7-X heat-flux estimate/)).toBeNull();
    expect(within(screen.getByRole('banner')).queryByRole('status', { name: /^Mode:/ })).toBeNull();
  }
});
