import { render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveState, LiveStatus } from '../../lib/liveStatus';
import { buildTransportFigure, claimSummary, lateComparison, liveGxSamples, parseWindowDetail, plotWindows, windowRows } from './model';
import { TransportView } from './TransportView';
import type { TransportArtifact, TransportWindow } from './types';

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

// The committed artifact is the fixture (read from disk, served through a stubbed fetch — never imported).
const ARTIFACT: TransportArtifact = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../artifacts/transport.json'), 'utf8'),
);
const clone = (): TransportArtifact => JSON.parse(JSON.stringify(ARTIFACT)) as TransportArtifact;

/** Literal on purpose: the legend entry must keep the word LIVE whatever the implementation exports. */
const GX_LEGEND = 'GX · LIVE (archive units)';

type Samples = { t: number; Q: number }[];
function liveStatus(mode: LiveStatus['mode'], beanSamples: Samples = [], triangularSamples: Samples = []): LiveStatus {
  return {
    schemaVersion: 1,
    mode,
    reason: 'test',
    qualified: mode === 'live',
    budget: { ceilingUsd: 40, billedUsd: 8.1, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true, hardTimeoutS: 1500 },
    workers:
      mode === 'live' || beanSamples.length || triangularSamples.length
        ? [
            { gpuIndex: 0, deviceId: 'GPU-aaaa', tube: 'bean', state: 'running', simTime: 120, samples: beanSamples },
            { gpuIndex: 1, deviceId: 'GPU-bbbb', tube: 'triangular', state: 'running', simTime: 118, samples: triangularSamples },
          ]
        : [],
    fallback: { active: false, label: '', savedRunId: null },
  };
}

type Api = LiveStatus | null | 'reject';
function serve(live: Api, artifact: unknown = ARTIFACT, artifactStatus = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/artifacts/transport.json') return new Response(JSON.stringify(artifact), { status: artifactStatus });
    if (url === '/api/live/status') {
      if (live === 'reject') throw new TypeError('network down');
      return live ? new Response(JSON.stringify(live), { status: 200 }) : new Response('down', { status: 502 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const statusCalls = (f: ReturnType<typeof serve>) => f.mock.calls.filter((c) => String(c[0]) === '/api/live/status').length;

type Shape = { type: string; yref: string; x0: number; x1: number; y0: number; y1: number; name?: string; label?: { text?: string; textposition?: string } };
type Call = [HTMLElement, Record<string, unknown>[], Record<string, unknown>, unknown];
const lastPlot = () => plotly.react.mock.calls.at(-1) as Call;
const traceNames = () => lastPlot()[1].map((d) => String(d.name));
const bandsOf = (layout: { shapes?: unknown }) =>
  (layout.shapes as Shape[]).filter((s) => s.type === 'rect' && s.yref === 'paper').map((s) => [s.x0, s.x1]);

/** A window row that genuinely meets the gate (covered, stationary, finite stderr, N_eff ≥ 20). */
const ALLOWED_DETAIL =
  'Half-split test: mean[1500,1700]=2.4862, mean[1700,1893.765]=2.4615, t=+0.41 vs t_crit=2.01 -> stationary. ' +
  'tau_int=4.1 time units, N_eff=48.2, stderr=0.0110. Saturated claim allowed. Method: synthetic test row.';
const NOT_STATIONARY_DETAIL =
  'Half-split test: mean[200,250]=2.9853, mean[250,300]=2.5667, t=+5.10 vs t_crit=2.01 -> not stationary. ' +
  'tau_int=1.1 time units, N_eff=45.0, stderr=0.0120. Saturated claim NOT allowed: not stationary. Method: synthetic test row.';
const win = (a: TransportArtifact, traceId: string, w0: number, w1: number): TransportWindow =>
  a.windows.find((w) => w.traceId === traceId && w.window[0] === w0 && w.window[1] === w1)!;
const row = (key: string) => screen.getByTestId(`window-row-${key}`);
const cell = (key: string, label: string) => row(key).querySelector(`[data-label="${label}"]`) as HTMLElement;

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
  // The plotted numbers are the artifact's numbers, sample for sample (no rescaling on the way).
  const aStella = ARTIFACT.traces.find((t) => t.id === 'stella-bean')!;
  const aGene = ARTIFACT.traces.find((t) => t.id === 'gene-bean')!;
  expect(stella?.x).toEqual(aStella.t);
  expect(stella?.y).toEqual(aStella.Q);
  expect(gene?.x).toEqual(aGene.t);
  expect(gene?.y).toEqual(aGene.Q);
  expect((stella?.x as number[]).length).toBe(1433);
  expect((gene?.x as number[]).length).toBe(1106);
  expect(lines).toHaveLength(2);
  // One trace per code — single shared x/y axes (no secondary axes).
  expect(data.every((d) => d.xaxis === undefined && d.yaxis === undefined)).toBe(true);

  const xa = layout.xaxis as { title: { text: string } };
  const ya = layout.yaxis as { title: { text: string }; range: [number, number] };
  expect(xa.title.text).toBe('Time t (a/v<sub>th,i</sub>)');
  expect(ya.title.text).toBe('Ion heat flux Q<sub>i</sub> (Q<sub>gB,i</sub>)');

  expect(bandsOf(layout)).toEqual([
    [200, 300],
    [300, 400],
    [1500, 1900],
  ]);
  // Adjacent band labels alternate top / bottom so "200–300" and "300–400" cannot overprint on a narrow plot.
  const labelled = (layout.shapes as Shape[]).filter((s) => s.type === 'rect' && s.yref === 'paper');
  expect(labelled.map((s) => `${s.label?.text}@${s.label?.textposition}`)).toEqual([
    '200–300@top left',
    '300–400@bottom left',
    '1500–1900@top left',
  ]);
  expect(chart).toHaveAccessibleName(/with windows 200–300, 300–400 and 1500–1900 shaded/);

  // The stella start-up peak (8.25 at t ≈ 133) no longer sets the y range: the comparison region does, and
  // the plot says what was clipped and how to see it.
  expect(ya.range).toEqual([0, 4.5]);
  const notes = (layout.annotations as { text: string }[]).map((n) => n.text.replace(/<br>/g, ' '));
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatch(/stella .*peak 8\.25 clipped/);
  expect(notes[0]).toMatch(/double-click .*Autoscale/);
  // Text equivalent of the chart.
  expect(chart).toHaveAccessibleDescription(/stella bean trace \(archive\): 1433 samples/);
  expect(chart).toHaveAccessibleDescription(/Flux axis shown from 0 to 4\.5.*stella peak of 8\.25 at t = 133\.11 is above it/);
  // ±1σ bands drawn from an approximate stderr are named as lower bounds, not as plain ±1σ.
  const bands = data.filter((d) => d.fill === 'toself').map((d) => String(d.name));
  expect(bands).toHaveLength(4);
  expect(bands.every((n) => /±1σ \(approximate, lower bound\)$/.test(n))).toBe(true);
});

test('T8 window bands, the chart name and the clipped flux axis are read from the artifact, not typed in', () => {
  // Move one analysis window: the band moves with it.
  const moved = clone();
  for (const w of moved.windows) if (w.window[0] === 200 && w.window[1] === 300) w.window = [250, 350];
  expect(plotWindows(moved)).toEqual([
    [250, 350],
    [300, 400],
    [1500, 1900],
  ]);
  expect(bandsOf(buildTransportFigure(moved, 'light', null).layout)).toEqual([
    [250, 350],
    [300, 400],
    [1500, 1900],
  ]);
  // GENE's shortened 1500–1893.765 lies inside 1500–1900 and is drawn as part of that band.
  expect(plotWindows(ARTIFACT)).toEqual([
    [200, 300],
    [300, 400],
    [1500, 1900],
  ]);

  // No early peak above the comparison region: nothing is clipped and nothing claims to be.
  const flat = clone();
  for (const t of flat.traces) t.Q = t.Q.map((q) => Math.min(q, 3));
  const f = buildTransportFigure(flat, 'light', null);
  expect((f.layout.annotations ?? []).length).toBe(0);
  expect(f.summary).not.toMatch(/clipped|above it/);
  expect(f.layout.yaxis.range).toBeUndefined();
  expect(f.layout.yaxis.rangemode).toBe('tozero');

  // A live GX series is never clipped away: the axis grows to hold it.
  const tall = buildTransportFigure(ARTIFACT, 'light', [
    { t: 100, Q: 6.2 },
    { t: 110, Q: 6.4 },
  ]);
  expect((tall.layout.yaxis.range as number[])[1]).toBeGreaterThanOrEqual(6.4);
});

test('T9 window table shows mean, stderr (— / ≈), coverage, stationarity and an explicit claim verdict per row', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(ARTIFACT.windows.length);
  // D-017: every archive row is "not allowed" and says so.
  for (const r of rows) expect(within(r).getByText('Claim not allowed')).toBeInTheDocument();
  expect(within(table).queryByText('Claim allowed')).toBeNull();

  // interface.md §2 item 4: stationary null is shown as plain "Undecidable". The backend's indicative test
  // result ("test result 'stationary' is indicative only") must not reappear in the verdict column.
  expect(ARTIFACT.windows.every((w) => w.stationary === null)).toBe(true);
  const stationarity = Object.fromEntries(
    ARTIFACT.windows.map((w) => {
      const key = `${w.traceId}:${w.window[0]}-${w.window[1]}`;
      return [key, cell(key, 'Stationarity').textContent];
    }),
  );
  expect(stationarity).toEqual({
    'stella-bean:200-300': 'Undecidable',
    'stella-bean:300-400': 'Undecidable',
    'stella-bean:1500-1900': 'Undecidable',
    'gene-bean:200-300': 'Undecidable',
    'gene-bean:300-400': 'Undecidable',
    'gene-bean:1500-1900': 'Not covered',
    'gene-bean:1500-1893.765': 'Undecidable',
  });
  expect(windowRows(ARTIFACT).map((r) => r.stationarityText)).toEqual([
    'Undecidable',
    'Undecidable',
    'Undecidable',
    'Undecidable',
    'Undecidable',
    'Not covered',
    'Undecidable',
  ]);

  const stellaLate = row('stella-bean:1500-1900');
  expect(cell('stella-bean:1500-1900', 'Mean')).toHaveTextContent(/^2\.242/);
  expect(within(stellaLate).getByText('≈0.019')).toBeInTheDocument();
  expect(within(stellaLate).getByLabelText('stderr approximately 0.019, a lower bound')).toBeInTheDocument();
  expect(within(stellaLate).getByText('Covered · 277 samples')).toBeInTheDocument();
  expect(cell('stella-bean:1500-1900', 'Effective samples')).toHaveTextContent('≈12.3');

  const stellaMid = row('stella-bean:300-400');
  expect(within(stellaMid).getByLabelText('stderr not finite')).toHaveTextContent('—');

  const geneUncovered = row('gene-bean:1500-1900');
  expect(within(geneUncovered).getByText(/^Not covered \(trace ends at t = 1893\.765\)$/)).toBeInTheDocument();
  expect(within(geneUncovered).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  // A reason that differs from the common one stays on its row.
  expect(within(geneUncovered).getByText('window not covered')).toBeInTheDocument();

  // The reason is explained once, in the callout above the table, not hidden and not repeated per row.
  const callout = screen.getByRole('note', { name: /Saturated agreement claim: not allowed for any archive window/ });
  expect(callout).toHaveTextContent(/N\s*eff ≥ 20/);
  expect(callout).toHaveTextContent(/D-017/);
  expect(callout).toHaveTextContent(/reported N\s*eff ≈ 5\.9–14\.1/);
  expect(callout).toHaveTextContent(/Reason recorded for 6 of 7 windows: N\s*eff \(at the tau upper bound\) below 20, not shown stationary/);
  expect(within(table).queryByText(/below 20, not shown stationary/, { ignore: 'details *' })).toBeNull();
  // The key for "≈" and "—" sits under the table whatever the verdicts are.
  expect(screen.getByTestId('window-key')).toHaveTextContent(/“≈”.*lower bound.*“—”.*not finite/);

  // Model check: qualifiers parsed from the backend's detail text.
  const d = parseWindowDetail(win(ARTIFACT, 'gene-bean', 1500, 1893.765).stationarityDetail);
  expect(d).toMatchObject({ stderrApproximate: true, stationarityIndicative: true, nEff: 14.1 });
  expect(claimSummary(ARTIFACT)).toMatchObject({ total: 7, allowed: 0, commonReasonCount: 6 });
});

test('T9 claim verdict and stationarity follow the artifact in both directions (synthetic allowed / true / false rows)', async () => {
  const a = clone();
  // GENE 1500–1893.765: a row that meets the gate. GENE 200–300: tested and found not stationary.
  Object.assign(win(a, 'gene-bean', 1500, 1893.765), {
    stationary: true,
    stderr: 0.011,
    saturatedClaimAllowed: true,
    stationarityDetail: ALLOWED_DETAIL,
  });
  Object.assign(win(a, 'gene-bean', 200, 300), { stationary: false, stderr: 0.012, stationarityDetail: NOT_STATIONARY_DETAIL });
  // stella 1500–1900: backend says stationary but flags the verdict indicative (kept visible, never plain).
  win(a, 'stella-bean', 1500, 1900).stationary = true;
  // GENE 300–400: not stationary and flagged indicative.
  win(a, 'gene-bean', 300, 400).stationary = false;
  serve(null, a);
  render(<TransportView livePollMs={60_000} />);
  const table = await screen.findByRole('table');

  const texts = (label: string) =>
    Object.fromEntries(a.windows.map((w) => [`${w.traceId}:${w.window[0]}-${w.window[1]}`, cell(`${w.traceId}:${w.window[0]}-${w.window[1]}`, label).textContent]));
  expect(texts('Stationarity')).toEqual({
    'stella-bean:200-300': 'Undecidable',
    'stella-bean:300-400': 'Undecidable',
    'stella-bean:1500-1900': 'Stationary (indicative)',
    'gene-bean:200-300': 'Not stationary',
    'gene-bean:300-400': 'Not stationary (indicative)',
    'gene-bean:1500-1900': 'Not covered',
    'gene-bean:1500-1893.765': 'Stationary',
  });
  // Exactly one row is allowed, and it is the one the artifact allows.
  const verdicts = a.windows.map((w) => {
    const key = `${w.traceId}:${w.window[0]}-${w.window[1]}`;
    return `${key} ${within(row(key)).getByText(/^Claim (not )?allowed$/).textContent}`;
  });
  expect(verdicts).toEqual([
    'stella-bean:200-300 Claim not allowed',
    'stella-bean:300-400 Claim not allowed',
    'stella-bean:1500-1900 Claim not allowed',
    'gene-bean:200-300 Claim not allowed',
    'gene-bean:300-400 Claim not allowed',
    'gene-bean:1500-1900 Claim not allowed',
    'gene-bean:1500-1893.765 Claim allowed',
  ]);
  expect(within(table).getAllByText('Claim allowed')).toHaveLength(1);
  const allowedRow = row('gene-bean:1500-1893.765');
  expect(allowedRow.querySelector('.lab-pill[data-status="passed"]')).toHaveTextContent('Claim allowed');
  expect(row('stella-bean:200-300').querySelector('.lab-pill[data-status="blocked"]')).toHaveTextContent('Claim not allowed');
  // A finite stderr the backend does not flag approximate is printed plainly; N_eff likewise.
  expect(within(allowedRow).getByLabelText('stderr 0.011')).toHaveTextContent(/^0\.011$/);
  expect(cell('gene-bean:1500-1893.765', 'Effective samples')).toHaveTextContent(/^48\.2$/);
  expect(within(row('gene-bean:200-300')).getByText('not stationary')).toBeInTheDocument();

  // The callout and the verdict strip follow the count; the "not allowed for any" wording is gone.
  expect(screen.queryByRole('note', { name: /not allowed for any archive window/ })).toBeNull();
  expect(screen.getByRole('note', { name: /Saturated agreement claim allowed for 1 of 7 windows$/ })).toBeInTheDocument();
  const verdict = screen.getByRole('region', { name: /^Verdict/ });
  expect(within(verdict).getByText('Saturated claim allowed: 1 of 7 windows')).toBeInTheDocument();
  expect(within(verdict).queryByText('Saturated claim: not allowed')).toBeNull();
  // The ≈ / — key does not vanish once a claim is allowed.
  expect(screen.getByTestId('window-key')).toHaveTextContent(/“≈”.*lower bound.*“—”.*not finite/);
  expect(claimSummary(a)).toMatchObject({ total: 7, allowed: 1 });
});

test('T9 an artifact flag that contradicts its own row is never shown as an allowed claim', async () => {
  const a = clone();
  // Flag says allowed, but the row is undecidable with no finite stderr (schema-valid, backend-forbidden).
  win(a, 'stella-bean', 300, 400).saturatedClaimAllowed = true;
  serve(null, a);
  render(<TransportView livePollMs={60_000} />);
  await screen.findByRole('table');
  const r = row('stella-bean:300-400');
  expect(within(r).getByText('Claim not allowed')).toBeInTheDocument();
  expect(within(r).queryByText('Claim allowed')).toBeNull();
  expect(r).toHaveTextContent(/artifact flag says allowed, but the row does not meet the gate \(stationarity undecidable; sampling uncertainty not finite\)/);
  expect(claimSummary(a).allowed).toBe(0);
  expect(screen.getByRole('note', { name: /not allowed for any archive window/ })).toBeInTheDocument();
});

test('T10 discrepancy card: PRD-reported 5.79 vs archive 300–400 means with deltas; fixture rows with ✓/✗', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const card = await screen.findByRole('region', { name: /Reduced Modal stella run vs archives, 300–400/ });
  // The PRD-reported label sits on the 5.79 figure itself, and that figure is never called derived.
  const reduced = within(card).getByRole('group', { name: 'Reduced Modal stella run: 5.79 Q gB,i, window t 300 to 400 a/v th,i' });
  expect(reduced.querySelector('.lab-pill[data-status="prd-reported"]')).toHaveTextContent('PRD-reported');
  expect(reduced.querySelector('.lab-pill[data-status="derived"]')).toBeNull();
  expect(reduced).not.toHaveTextContent(/Derived|Archive|Verified/);
  // stella 300–400 has no finite stderr: no "±" at all (never ±0.00). GENE's is shown and flagged approximate.
  const stella = within(card).getByRole('group', { name: 'stella archive mean: 2.55 Q gB,i, window t 300 to 400 a/v th,i' });
  expect(stella).not.toHaveTextContent('±');
  const gene = within(card).getByRole('group', { name: 'GENE archive mean: 2.68 plus or minus 0.02 Q gB,i, window t 300 to 400 a/v th,i' });
  expect(gene).toHaveTextContent('± is approximate (lower bound)');
  // Each Δ sits with its archive value and states which minus which.
  expect(within(card).getByTestId('delta-stella')).toHaveTextContent(/Δ \(reduced run − stella\)\s*\+3\.24/);
  expect(within(card).getByTestId('delta-GENE')).toHaveTextContent(/Δ \(reduced run − GENE\)\s*\+3\.11/);
  expect(within(card).getByTestId('delta-stella')).toHaveTextContent('2.27× the archive');
  // The stella 300–400 reference window is itself not shown stationary (from windows[]).
  expect(within(card).getByTestId('delta-stella')).toHaveTextContent(/not shown stationary/);
  expect(within(card).getByTestId('delta-stella')).toHaveTextContent(/sampling uncertainty not finite/);

  const fixtures = screen.getByRole('region', { name: /PRD fixtures: claimed vs recomputed/ });
  expect(within(fixtures).getByRole('group', { name: /^stella bean mean, 1500–1900: Match\. Claimed 2\.242/ })).toBeInTheDocument();
  expect(within(fixtures).getByRole('group', { name: /^GENE archive mean, 300–400: Match\. Claimed 2\.68.*computed 2\.68/ })).toBeInTheDocument();
  expect(within(fixtures).getByRole('group', { name: /^Reduced Modal stella run mean, 300–400: Not recomputable/ })).toBeInTheDocument();
  expect(within(fixtures).getAllByText(/Definition sensitivity/).length).toBeGreaterThan(0);
  expect(within(fixtures).getAllByText('Match').length).toBe(4);
});

test('T10 a fixture the artifact marks as not matching is shown as a mismatch, and the deltas follow the artifact', async () => {
  const a = clone();
  const f = a.fixtures.find((x) => x.id === 'gene-bean-300-400')!;
  f.computed = 2.67429;
  f.matches = false;
  // The artifact's flag alone is enough: the printed values still agree, but `matches` is false.
  a.fixtures.find((x) => x.id === 'stella-bean-1500-1900')!.matches = false;
  // And a fixture that cannot be recomputed is never shown as matching, whatever the numbers print.
  a.fixtures.find((x) => x.id === 'stella-bean-300-400')!.matches = null;
  a.reducedModalRun.archive.stella = 3.0;
  serve(null, a);
  render(<TransportView livePollMs={60_000} />);
  const fixtures = await screen.findByRole('region', { name: /PRD fixtures: claimed vs recomputed/ });
  const bad = within(fixtures).getByRole('group', { name: /^GENE archive mean, 300–400: Mismatch\. Claimed 2\.68 Q gB,i, computed 2\.67 Q gB,i, difference minus 0\.01/ });
  expect(bad).toHaveAttribute('data-outcome', 'mismatch');
  const flagged = within(fixtures).getByRole('group', {
    name: /^stella bean mean, 1500–1900: Mismatch\. Claimed 2\.242 Q gB,i, computed 2\.242 Q gB,i, difference 0\.000\. The match flag disagrees with the printed values\.$/,
  });
  expect(flagged).toHaveAttribute('data-outcome', 'mismatch');
  expect(within(flagged).getByText('Mismatch')).toBeInTheDocument();
  expect(within(fixtures).getByRole('group', { name: /^stella archive mean, 300–400: Not recomputable\. Claimed 2\.55/ })).toHaveAttribute('data-outcome', 'unknown');
  expect(within(fixtures).getAllByText('Match').length).toBe(1);
  const card = screen.getByRole('region', { name: /Reduced Modal stella run vs archives, 300–400/ });
  expect(within(card).getByTestId('delta-stella')).toHaveTextContent('+2.79');
});

test('T10 the label on the 5.79 figure is the provenance kind in the artifact, and an artifact can never make it LIVE', async () => {
  const a = clone();
  a.reducedModalRun.provenance = { ...a.reducedModalRun.provenance, kind: 'live' };
  serve(null, a);
  render(<TransportView livePollMs={60_000} />);
  const card = await screen.findByRole('region', { name: /Reduced Modal stella run vs archives, 300–400/ });
  const verdict = screen.getByRole('region', { name: /^Verdict/ });
  for (const where of [card, verdict]) {
    const pill = within(where).getByRole('group', { name: /^Reduced Modal stella run: 5\.79/ }).querySelector('.lab-pill')!;
    expect(pill).toHaveAttribute('data-status', 'replay');
    expect(pill).toHaveTextContent('Recorded run');
  }
  expect(verdict).toHaveTextContent('The reduced run is Recorded run: no trace or uncertainty in this repo.');
  expect(document.querySelector('.lab-pill[data-status="live"]')).toBeNull();
  expect(screen.queryByText(/LIVE/)).toBeNull();
});

test('T10 stella and GENE are stated as not shown to agree, with the sign convention and both windows', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const note = await screen.findByRole('note', { name: /stella and GENE are not shown to agree with each other/ });
  expect(note).toHaveTextContent('No equivalence claim is made between them');
  // Δ = stella − GENE = 2.242 − 2.474 (interface.md §2 item 5: ≈ −0.23), with each mean's own window named.
  expect(note).toHaveTextContent(/stella − GENE = −0\.23/);
  expect(note).toHaveTextContent(/stella 1500–1900: 2\.242/);
  expect(note).toHaveTextContent(/GENE 1500–1893\.765: 2\.474/);
  expect(note).toHaveTextContent(/the windows are not identical/);
  expect(document.body).not.toHaveTextContent(/stella and GENE agree|are equivalent|in agreement with each other/i);
  const late = lateComparison(ARTIFACT)!;
  expect(late.delta).toBeCloseTo(2.242127 - 2.473862, 9);
  expect(late.sameWindow).toBe(false);
  // The sign follows the data, not a typed string.
  const flipped = clone();
  win(flipped, 'stella-bean', 1500, 1900).mean = 2.9;
  expect(lateComparison(flipped)!.delta).toBeCloseTo(2.9 - 2.473862, 9);
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
  const [, data, layout] = lastPlot();
  expect(traceNames().some((n) => /triangular/i.test(n))).toBe(false);
  // Nothing of the triangular tube is on the bean plot: no trace, no mean segment, no band over 1200–1500,
  // and no line at the published 2.22.
  const shapes = layout.shapes as Shape[];
  expect(shapes.some((s) => /triangular/i.test(String(s.name)))).toBe(false);
  expect(shapes.some((s) => s.x0 === 1200 && s.x1 === 1500)).toBe(false);
  expect(shapes.filter((s) => s.type === 'line').every((s) => s.y0 !== 2.22)).toBe(true);
  expect(shapes.filter((s) => s.type === 'line')).toHaveLength(6);
  expect(data).toHaveLength(6); // 4 uncertainty bands + stella + GENE

  // FE-9: the source is a repository file, not a page this app serves: shown as text, never as a link to it.
  expect(ARTIFACT.triangular.source.url).toBe('PRD.md');
  expect(card).toHaveTextContent(/Source: PRD\.md · Accuracy fixtures/);
  expect(within(card).queryByRole('link')).toBeNull();
  expect(card.querySelector('a')).toBeNull();
  // (The provenance popover of the design system still links its sources itself; that component is not this view's.)
  expect([...document.querySelectorAll('a[href="PRD.md"]')].filter((el) => !el.closest('.lab-prov'))).toEqual([]);
});

test('T11 a triangular trace present in the artifact is still never drawn or badged on the bean plot', async () => {
  const a = clone();
  const bean = a.traces.find((t) => t.id === 'stella-bean')!;
  a.traces.push({ ...bean, id: 'stella-triangular', tube: 'triangular', t: [1200, 1350, 1500], Q: [2.2, 2.25, 2.21] });
  a.windows.push({ ...win(a, 'stella-bean', 1500, 1900), traceId: 'stella-triangular', window: [1200, 1500], mean: 2.22 });
  serve(null, a);
  render(<TransportView livePollMs={60_000} />);
  await screen.findByRole('img', { name: /stella and GENE archives/ });
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  const [, data, layout] = lastPlot();
  expect(data.filter((d) => d.mode === 'lines' && !d.fill).map((d) => (d.x as number[]).length)).toEqual([1433, 1106]);
  expect(traceNames().some((n) => /triangular/i.test(n))).toBe(false);
  expect(bandsOf(layout)).toEqual([
    [200, 300],
    [300, 400],
    [1500, 1900],
  ]);
  expect((layout.shapes as Shape[]).some((s) => s.x0 === 1200)).toBe(false);
  expect(screen.queryByRole('button', { name: /Provenance of stella triangular trace/ })).toBeNull();
});

// Every state that is not "the API itself reports live", each with GX samples present in the payload.
const NOT_LIVE: [string, Api][] = [
  ['mode unavailable', liveStatus('unavailable', [{ t: 10, Q: 1 }])],
  ['mode idle', liveStatus('idle', [{ t: 10, Q: 1 }])],
  ['mode launching', liveStatus('launching', [{ t: 10, Q: 1 }])],
  ['mode fallback', liveStatus('fallback', [{ t: 10, Q: 1 }])],
  ['mode terminated', liveStatus('terminated', [{ t: 10, Q: 1 }])],
  ['an unreachable API (HTTP 502)', null],
  ['an unreachable API (network error)', 'reject'],
  ['mode live with no bean samples', liveStatus('live', [])],
  ['mode live with triangular samples only', liveStatus('live', [], [{ t: 10, Q: 1 }])],
];

test.each(NOT_LIVE)('T12 no GX series and no LIVE label for %s', async (_name, api) => {
  const f = serve(api);
  render(<TransportView livePollMs={60_000} />);
  await screen.findByRole('img', { name: /stella and GENE archives/ });
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  await waitFor(() => expect(statusCalls(f)).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 30));
  await waitFor(() => {
    expect(traceNames().filter((n) => /GX|LIVE/i.test(n))).toEqual([]);
    expect(screen.queryByText(/LIVE/)).toBeNull();
    expect(document.querySelector('.lab-pill[data-status="live"]')).toBeNull();
  });
  expect(lastPlot()[1]).toHaveLength(6);
  expect(screen.getByRole('img', { name: /stella and GENE archives/ })).toHaveAccessibleDescription(/No GX series: the live API does not report a live run\./);
});

test('T12 GX samples overlay in archive units with a LIVE label only when the API reports live', async () => {
  // Live: GX bean samples (already in archive units per the contract) drawn as delivered and labelled LIVE.
  serve(liveStatus('live', [{ t: 100, Q: 2.1 }, { t: 101.4, Q: 2.3 }], [{ t: 55, Q: 9 }]));
  render(<TransportView livePollMs={60_000} />);
  expect(await screen.findByText('LIVE · GX bean')).toBeInTheDocument();
  await waitFor(() => expect(traceNames()).toContain(GX_LEGEND));
  const gx = lastPlot()[1].find((d) => d.name === GX_LEGEND);
  expect(gx).toMatchObject({ x: [100, 101.4], y: [2.1, 2.3] });
  expect(screen.getByRole('img', { name: /with the live GX run/ })).toHaveAccessibleDescription(
    /GX live bean samples overlaid in archive units: 2 samples up to t = 101\.4\./,
  );

  // Pure model: only a ready snapshot whose mode is "live" yields samples, and only the bean worker's.
  const states: [string, LiveState][] = [
    ['connecting', { status: 'connecting' }],
    ['unreachable', { status: 'unreachable', message: 'HTTP 502' }],
    ...(['unavailable', 'idle', 'launching', 'fallback', 'terminated', 'live'] as const).map(
      (m): [string, LiveState] => [m, { status: 'ready', data: liveStatus(m, [{ t: 1, Q: 1 }], [{ t: 2, Q: 2 }]) }],
    ),
  ];
  expect(Object.fromEntries(states.map(([k, s]) => [k, liveGxSamples(s)]))).toEqual({
    connecting: null,
    unreachable: null,
    unavailable: null,
    idle: null,
    launching: null,
    fallback: null,
    terminated: null,
    live: [{ t: 1, Q: 1 }],
  });
  expect(buildTransportFigure(ARTIFACT, 'light', null).hasGx).toBe(false);
});

test('T12 a GX trace with live provenance inside the artifact produces no live indicator in replay', async () => {
  const a = clone();
  const bean = a.traces.find((t) => t.id === 'stella-bean')!;
  a.traces.push({ ...bean, id: 'gx-bean', code: 'GX', t: [0, 50, 100], Q: [0, 2, 2.4], provenance: { ...bean.provenance, kind: 'live' } });
  const f = serve(null, a);
  render(<TransportView livePollMs={60_000} />);
  await screen.findByRole('img', { name: /stella and GENE archives/ });
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  await waitFor(() => expect(statusCalls(f)).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 30));
  expect(document.querySelectorAll('.lab-pill[data-status="live"]')).toHaveLength(0);
  expect(screen.queryByText(/^live$/i)).toBeNull();
  expect(traceNames().filter((n) => /GX/.test(n))).toEqual([]);
  // The provenance badges are those of the traces the figure draws, each named by its series.
  expect(screen.getAllByRole('button', { name: /^Provenance of .* bean trace/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
    'Provenance of stella bean trace: Archive, Verified',
    'Provenance of GENE bean trace: Archive, Verified',
  ]);
  expect(screen.getAllByTestId('trace-badge-name').map((b) => b.textContent)).toEqual(['stella', 'GENE']);
});

test('DS-3 the view opens with the verdict: late means, Δ, the PRD-reported 5.79 beside 2.55 / 2.68, and the claim gate', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const verdict = await screen.findByRole('region', { name: /^Verdict/ });
  // The gate verdict is a visible pill in the first panel, with its reason in one sentence.
  expect(verdict.querySelector('.lab-pill[data-status="blocked"]')).toHaveTextContent('Saturated claim: not allowed');
  expect(verdict).toHaveTextContent(/No window meets the claim gate.*N\s*eff ≥ 20.*reported N\s*eff ≈ 5\.9–14\.1/);
  expect(within(verdict).getByRole('group', { name: 'stella late-window mean: 2.242 plus or minus 0.019 Q gB,i, window t 1500 to 1900 a/v th,i' })).toBeInTheDocument();
  expect(within(verdict).getByRole('group', { name: 'GENE late-window mean: 2.474 plus or minus 0.017 Q gB,i, window t 1500 to 1893.765 a/v th,i' })).toBeInTheDocument();
  expect(within(verdict).getByRole('group', { name: 'Δ = stella − GENE: minus 0.23 Q gB,i' })).toBeInTheDocument();
  expect(verdict).toHaveTextContent(/not shown to agree/);
  const reduced = within(verdict).getByRole('group', { name: /^Reduced Modal stella run: 5\.79 Q gB,i/ });
  expect(reduced.querySelector('.lab-pill[data-status="prd-reported"]')).toHaveTextContent('PRD-reported');
  expect(within(verdict).getByRole('group', { name: /^stella archive mean: 2\.55 Q gB,i/ })).toHaveTextContent('Δ +3.24');
  expect(within(verdict).getByRole('group', { name: /^GENE archive mean: 2\.68 plus or minus 0\.02 Q gB,i/ })).toHaveTextContent('Δ +3.11');

  // Reading order: verdict, plot, discrepancy + triangular cards, window statistics, fixtures.
  const titles = screen.getAllByRole('region').filter((r) => r.classList.contains('lab-panel')).map((r) => within(r).getAllByRole('heading')[0]!.textContent);
  expect(titles).toEqual([
    'Verdict: what the archived evidence supports',
    'Bean tube ion heat flux: stella and GENE archives',
    'Reduced Modal stella run vs archives, 300–400',
    'Triangular tube: published mean only',
    'Window statistics',
    'PRD fixtures: claimed vs recomputed',
  ]);
});

test('DS-6 every table cell carries its column label, so the narrow card layout stays readable without the header row', async () => {
  serve(null);
  render(<TransportView livePollMs={60_000} />);
  const table = await screen.findByRole('table');
  const head = within(table).getAllByRole('columnheader').map((h) => h.textContent);
  expect(head).toEqual(['Trace', 'Window (t)', 'Coverage', 'Mean (QgB,i)', '± stderr', 'Neff', 'Stationarity', 'Saturated agreement claim']);
  const labels = [...row('stella-bean:1500-1900').querySelectorAll('td')].map((td) => td.getAttribute('data-label'));
  expect(labels).toEqual(['Window (t)', 'Coverage', 'Mean', '± stderr', 'Effective samples', 'Stationarity', 'Saturated agreement claim']);
  const css = readFileSync(resolve(__dirname, 'transport.css'), 'utf8');
  // DS-2: the visually hidden caption and "Detail for …" spans must stay inside the scrolling well.
  expect(css).toMatch(/\.tr-table-wrap\s*\{[^}]*position:\s*relative/);
  // DS-6: the card layout follows the width of the well (a container query on our own wrapper).
  expect(css).toMatch(/\.tr-table-wrap\s*\{[^}]*container-type:\s*inline-size/);
  expect(css).toMatch(/td::before\s*\{[^}]*content:\s*attr\(data-label\)/);
});

test('A3 transport: a missing or invalid artifact shows an error naming the file, never a blank view', async () => {
  serve(null, { error: 'gone' }, 404);
  const first = render(<TransportView livePollMs={60_000} />);
  expect(screen.getByRole('heading', { name: 'Loading transport evidence…' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Transport evidence could not be loaded' })).toBeInTheDocument();
  const note = screen.getByRole('note', { name: /artifacts\/transport\.json failed to load/ });
  expect(note).toHaveTextContent('/artifacts/transport.json: HTTP 404');
  expect(screen.queryByRole('table')).toBeNull();
  expect(plotly.react).not.toHaveBeenCalled();
  first.unmount();

  // Wrong schema version: rejected by the loader, reported with the file name.
  serve(null, { ...ARTIFACT, schemaVersion: 2 });
  render(<TransportView livePollMs={60_000} />);
  const bad = await screen.findByRole('note', { name: /artifacts\/transport\.json failed to load/ });
  expect(bad).toHaveTextContent('unexpected schemaVersion');
});
