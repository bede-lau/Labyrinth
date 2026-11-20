import { render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveStatus } from '../../lib/liveStatus';
import { GX_LIVE_NAME, buildTransportFigure, parseWindowDetail, windowRows } from './model';
import { TransportView } from './TransportView';
import type { TransportArtifact } from './types';

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

// The committed artifact is the fixture (read from disk, served through a stubbed fetch — never imported).
const ARTIFACT: TransportArtifact = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../artifacts/transport.json'), 'utf8'),
);

function liveStatus(mode: LiveStatus['mode'], beanSamples: { t: number; Q: number }[] = []): LiveStatus {
  return {
    schemaVersion: 1,
    mode,
    reason: 'test',
    qualified: mode === 'live',
    budget: { ceilingUsd: 40, billedUsd: 8.1, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true, hardTimeoutS: 1500 },
    workers:
      mode === 'live' || beanSamples.length
        ? [
            { gpuIndex: 0, deviceId: 'GPU-aaaa', tube: 'bean', state: 'running', simTime: 120, samples: beanSamples },
            { gpuIndex: 1, deviceId: 'GPU-bbbb', tube: 'triangular', state: 'running', simTime: 118, samples: [] },
          ]
        : [],
    fallback: { active: false, label: '', savedRunId: null },
  };
}

function serve(live: LiveStatus | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/artifacts/transport.json') return new Response(JSON.stringify(ARTIFACT), { status: 200 });
      if (url === '/api/live/status') {
        return live ? new Response(JSON.stringify(live), { status: 200 }) : new Response('down', { status: 502 });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

type Call = [HTMLElement, Record<string, unknown>[], Record<string, unknown>, unknown];
const lastPlot = () => plotly.react.mock.calls.at(-1) as Call;
const traceNames = () => lastPlot()[1].map((d) => String(d.name));

beforeEach(() => {
  plotly.react.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

test('T8 overlays stella and GENE bean traces on shared, unit-labelled axes with the three window bands', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const chart = await screen.findByRole('img', { name: /stella and GENE archives/ });
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  const [el, data, layout] = lastPlot();
  expect(el).toBe(chart);

  const lines = data.filter((d) => d.mode === 'lines' && !d.fill);
  const stella = lines.find((d) => String(d.name).startsWith('stella'));
  const gene = lines.find((d) => String(d.name).startsWith('GENE'));
  expect((stella?.x as number[]).length).toBe(1433);
  expect((gene?.x as number[]).length).toBe(1106);
  // One trace per code — single shared x/y axes (no secondary axes).
  expect(data.every((d) => d.xaxis === undefined && d.yaxis === undefined)).toBe(true);

  const xa = layout.xaxis as { title: { text: string } };
  const ya = layout.yaxis as { title: { text: string } };
  expect(xa.title.text).toBe('Time t (a/v<sub>th,i</sub>)');
  expect(ya.title.text).toBe('Ion heat flux Q<sub>i</sub> (Q<sub>gB,i</sub>)');

  const bands = (layout.shapes as { type: string; yref: string; x0: number; x1: number }[])
    .filter((s) => s.type === 'rect' && s.yref === 'paper')
    .map((s) => [s.x0, s.x1]);
  expect(bands).toEqual([
    [200, 300],
    [300, 400],
    [1500, 1900],
  ]);
  // Text equivalent of the chart.
  expect(chart).toHaveAccessibleDescription(/stella bean trace \(archive\): 1433 samples/);
});

test('T9 window table shows mean, stderr (— / ≈), coverage, stationarity and an explicit claim verdict per row', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(ARTIFACT.windows.length);
  // D-017: every archive row is "not allowed" and says so.
  for (const r of rows) expect(within(r).getByText('Claim not allowed')).toBeInTheDocument();

  const row = (key: string) => screen.getByTestId(`window-row-${key}`);
  const stellaLate = row('stella-bean:1500-1900');
  expect(within(stellaLate).getByText('2.242')).toBeInTheDocument();
  expect(within(stellaLate).getByText('≈0.019')).toBeInTheDocument();
  // Stationarity comes from the artifact: never shown as plain "Stationary" when the verdict is indicative/undecidable.
  const late = ARTIFACT.windows.find((w) => w.traceId === 'stella-bean' && w.window[0] === 1500)!;
  const lateText = within(stellaLate).getByText(/^(Undecidable|Stationary|Not stationary)/).textContent ?? '';
  if (late.stationary === null) expect(lateText).toMatch(/^Undecidable/);
  if (/indicative/.test(late.stationarityDetail ?? '')) expect(lateText).toMatch(/indicative/);
  expect(within(stellaLate).getByText('Covered · 277 samples')).toBeInTheDocument();

  const stellaMid = row('stella-bean:300-400');
  expect(within(stellaMid).getByLabelText('stderr not finite')).toHaveTextContent('—');
  expect(within(stellaMid).getByText(/^Undecidable/)).toBeInTheDocument();

  const geneUncovered = row('gene-bean:1500-1900');
  expect(within(geneUncovered).getByText(/^Not covered \(trace ends at t = 1893\.765\)$/)).toBeInTheDocument();
  expect(within(geneUncovered).getAllByText('—').length).toBeGreaterThanOrEqual(2);

  // The reason is explained, not hidden.
  const callout = screen.getByRole('note', { name: /Saturated agreement claim: not allowed for any archive window/ });
  expect(callout).toHaveTextContent(/N\s*eff ≥ 20/);
  expect(callout).toHaveTextContent(/D-017/);

  // Model check: qualifiers parsed from the backend's detail text.
  const d = parseWindowDetail(ARTIFACT.windows.find((w) => w.traceId === 'gene-bean' && w.window[1] === 1893.765)?.stationarityDetail);
  expect(d).toMatchObject({ stderrApproximate: true, stationarityIndicative: true, nEff: 14.1 });
  expect(windowRows(ARTIFACT).every((r) => r.claimText === 'Claim not allowed')).toBe(true);
});

test('T10 discrepancy card: PRD-reported 5.79 vs archive 300–400 means with deltas; fixture rows with ✓/✗', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const card = await screen.findByRole('region', { name: /Reduced Modal stella run vs archives, 300–400/ });
  expect(within(card).getByRole('group', { name: /^Reduced Modal stella run: 5\.79/ })).toBeInTheDocument();
  expect(within(card).getAllByText('PRD-reported').length).toBeGreaterThan(0);
  expect(within(card).getByRole('group', { name: /^stella archive mean: 2\.55/ })).toBeInTheDocument();
  expect(within(card).getByRole('group', { name: /^GENE archive mean: 2\.68/ })).toBeInTheDocument();
  expect(within(card).getByTestId('delta-stella')).toHaveTextContent('+3.24');
  expect(within(card).getByTestId('delta-GENE')).toHaveTextContent('+3.11');
  // The stella 300–400 reference window is itself not shown stationary (from windows[]).
  expect(within(card).getByTestId('delta-stella')).toHaveTextContent(/not shown stationary/);

  const fixtures = screen.getByRole('region', { name: /PRD fixtures: claimed vs recomputed/ });
  expect(within(fixtures).getByRole('group', { name: /^stella bean mean, 1500–1900: Match\. Claimed 2\.242/ })).toBeInTheDocument();
  expect(within(fixtures).getByRole('group', { name: /^GENE archive mean, 300–400: Match\. Claimed 2\.68.*computed 2\.68/ })).toBeInTheDocument();
  expect(within(fixtures).getByRole('group', { name: /^Reduced Modal stella run mean, 300–400: Not recomputable/ })).toBeInTheDocument();
  expect(within(fixtures).getAllByText(/Definition sensitivity/).length).toBeGreaterThan(0);
  expect(within(fixtures).getAllByText('Match').length).toBe(4);
});

test('T11 triangular card is separate from the bean plot: published mean 2.22, PRD-reported, raw trace unverified', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const card = await screen.findByRole('region', { name: /Triangular tube: published mean only/ });
  expect(within(card).getByTestId('triangular-label')).toHaveTextContent(
    'Published mean 2.22 over 1200–1500 — PRD-reported, raw trace unverified.',
  );
  expect(within(card).getByText('Raw trace unverified')).toBeInTheDocument();
  expect(within(card).queryByRole('img')).toBeNull();
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  expect(traceNames().some((n) => /triangular/i.test(n))).toBe(false);
});

test('T12 GX samples overlay in archive units with a LIVE label only when the API reports live', async () => {
  // Not live (idle, and even with samples present): no GX series, no LIVE label.
  serve(liveStatus('idle', [{ t: 10, Q: 1 }]));
  const { unmount } = render(<TransportView livePollMs={60_000} />);
  await screen.findByRole('img', { name: /stella and GENE archives/ });
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(traceNames()).not.toContain(GX_LIVE_NAME);
  expect(screen.queryByText(/LIVE/)).toBeNull();
  unmount();

  // Live: GX bean samples (already in archive units per the contract) drawn and labelled LIVE.
  plotly.react.mockClear();
  serve(liveStatus('live', [{ t: 100, Q: 2.1 }, { t: 101.4, Q: 2.3 }]));
  render(<TransportView livePollMs={60_000} />);
  expect(await screen.findByText('LIVE · GX bean')).toBeInTheDocument();
  await waitFor(() => expect(traceNames()).toContain(GX_LIVE_NAME));
  const gx = lastPlot()[1].find((d) => d.name === GX_LIVE_NAME);
  expect(gx).toMatchObject({ x: [100, 101.4], y: [2.1, 2.3] });

  // Pure model: no samples -> no GX series even when called directly.
  expect(buildTransportFigure(ARTIFACT, 'light', null).hasGx).toBe(false);
});
