// The review page itself (verifier finding F9, design finding DS-21): what it shows must be what
// the system does, and its words must be the app's words.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import Gallery, { FORECAST_SPECIMEN, SPECIMEN, specimenFrame } from './Gallery';
import { formatNumber } from './format';
import { PALETTE_GATES, RAMP_SEPARATION_GATES, rampPairSeparation, seriesMinDeltaE } from './palette';
import { FORECAST_LABEL, FORECAST_LINES, SERIES_LABEL, axisTitle, forecastStyle } from './plotTheme';
import { SERIES_IDS, THEMES, themes } from './tokens';

const plotly = vi.hoisted(() => ({ react: vi.fn().mockResolvedValue(undefined) }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));
// jsdom has no WebGL: the scene must fall back to a labelled callout, not an empty box.
vi.mock('three', () => ({
  WebGLRenderer: class {
    constructor() {
      throw new Error('no WebGL in jsdom');
    }
  },
}));

type Trace = {
  name?: string;
  mode?: string;
  x?: (number | null)[];
  y?: (number | null)[];
  line?: { color?: string; dash?: string; width?: number };
  marker?: { symbol?: string; color?: string; size?: number | number[]; opacity?: number };
  showlegend?: boolean;
};
type Shape = { type: string; name?: string };
type Layout = {
  shapes: Shape[];
  showlegend?: boolean;
  paper_bgcolor?: string;
  xaxis?: { title?: { text?: string } };
  yaxis?: { title?: { text?: string } };
};
type PlotCall = [HTMLElement, Trace[], Layout];

/** The last Plotly call that drew into the figure named `name` (the gallery draws more than one chart). */
function callIn(name: RegExp): PlotCall {
  const figure = screen.getByRole('figure', { name });
  const call = [...plotly.react.mock.calls].reverse().find(([el]) => figure.contains(el as Node));
  if (!call) throw new Error(`Plotly has not drawn into the figure ${name}`);
  return call as unknown as PlotCall;
}
const TRANSPORT_FIGURE = /^Specimen chart: synthetic heat-flux traces/;
const FORECAST_FIGURE = /^Specimen forecast chart: synthetic Predicted .* and Actual /;

beforeEach(() => plotly.react.mockClear());

test('DS-21: the theme switch uses the app’s words — Auto / Light / Dark', () => {
  render(<Gallery />);
  const group = screen.getByRole('radiogroup', { name: 'Theme' });
  const words = within(group)
    .getAllByRole('radio')
    .map((r) => r.textContent);
  expect(words).toEqual(['Auto', 'Light', 'Dark']);
  expect(within(group).getByRole('radio', { name: 'Follow system theme' })).toHaveAttribute('aria-checked', 'true');
  // The same labels, in the same order, as the app's own switch.
  const shell = readFileSync(resolve(import.meta.dirname, '../shell/ThemeSwitch.tsx'), 'utf8');
  const appWords = [...shell.matchAll(/\blabel: '([^']+)'/g)].map((m) => m[1]);
  expect(appWords, 'labels in shell/ThemeSwitch.tsx').toEqual(words);
});

test('F9: the specimen chart draws GX with its markers, and lists the unsampled block before the windows', async () => {
  render(<Gallery />);
  const [, data, layout] = await waitFor(() => callIn(TRANSPORT_FIGURE));
  const lines = data.filter((d) => d.showlegend !== false);
  expect(lines.map((d) => [d.name, d.mode])).toEqual([
    ['stella', 'lines'],
    ['GENE', 'lines'],
    ['GX', 'lines+markers'],
  ]);
  expect(lines[2]?.marker?.symbol).toBe('diamond');
  const rects = layout.shapes.filter((s) => s.type === 'rect').map((s) => s.name);
  expect(rects.slice(0, 2)).toEqual(['unsampled', 'unsampled label']);
  expect(rects.slice(2).every((n) => /^window /.test(n ?? ''))).toBe(true);
  expect(rects.length).toBeGreaterThan(2);
});

test('DL-6: the gallery shows the danger pill and alerts, range fixtures and both bases', () => {
  const { container } = render(<Gallery />);
  // The danger kind is in the status list, and the live-session panel shows the pills A's store produces.
  expect(container.querySelector('.gal-status [data-status="billing-risk"]')).not.toBeNull();
  const danger = screen.getByRole('region', { name: 'GPUs may still be billing' });
  const pills = Array.from(danger.querySelectorAll('[data-status="billing-risk"]')).map((p) => p.textContent);
  expect(pills).toEqual(expect.arrayContaining(['TERMINATE FAILED', 'TERMINATION PENDING', 'Stop not confirmed', 'Connection lost']));
  const alerts = within(danger).getAllByRole('alert');
  expect(alerts.length).toBeGreaterThanOrEqual(2);
  expect(within(danger).getByRole('alert', { name: /^Danger: TERMINATE FAILED/ })).toHaveTextContent('kill switch raised, stop not confirmed');
  expect(within(danger).getByRole('button', { name: 'Retry terminate' })).toBeInTheDocument();
  // D-023 fixtures: a range inside (data), a range inside (arithmetic), a range outside; and the point bases.
  expect(screen.getByRole('group', { name: /: Inside PRD range\. PRD range / })).toHaveAttribute('data-basis', 'data');
  expect(screen.getByRole('group', { name: /: Arithmetic in PRD range\. PRD range / })).toHaveAttribute('data-basis', 'arithmetic');
  expect(screen.getByRole('group', { name: /: Outside PRD range\. PRD range / })).toHaveAttribute('data-outcome', 'mismatch');
  expect(screen.getByRole('group', { name: /: Arithmetic consistent\./ })).toHaveAttribute('data-basis', 'arithmetic');
  expect(screen.getByRole('group', { name: /: Match\./ })).toHaveAttribute('data-basis', 'data');
});

test('F9: the palette table has whole headers, one row per series, and the measured minima with their gates', () => {
  render(<Gallery />);
  const table = screen.getByRole('table');
  const plain = (s: string | null) => (s ?? '').replace(/­/g, '');
  expect(within(table).getAllByRole('columnheader').map((h) => plain(h.textContent))).toEqual(['Series', 'Normal', 'Deuteranopia', 'Protanopia']);
  const rowHeads = within(table).getAllByRole('rowheader').map((h) => h.textContent);
  expect(rowHeads).toEqual([...SERIES_IDS.map((id) => SERIES_LABEL[id]), 'Min ΔE00', 'Gate']);
  const cellsOf = (name: string) => within(within(table).getByRole('row', { name: new RegExp(`^${name}`) })).getAllByRole('cell').map((c) => c.textContent);
  // jsdom has no matchMedia: the gallery renders the light theme.
  expect(cellsOf('Min ΔE00')).toEqual((['normal', 'deuteranopia', 'protanopia'] as const).map((v) => seriesMinDeltaE('light', v).toFixed(1)));
  expect(cellsOf('Gate')).toEqual([`≥ ${PALETTE_GATES.normal}`, `≥ ${PALETTE_GATES.cvd}`, `≥ ${PALETTE_GATES.cvd}`]);
});

// D6 (D-027): the review page shows what the owner asked for, in the system's words.
test('D6: the Heat & field panel shows both colour bars with their ends, the model pill, the measured separations and the diverter plates', () => {
  const { container } = render(<Gallery />);
  const panel = screen.getByRole('region', { name: 'Temperature and |B| colormaps, diverter plates' });
  const heat = panel.querySelector('.gal-colorbar[data-ramp="heat"]') as HTMLElement;
  const field = panel.querySelector('.gal-colorbar[data-ramp="field"]') as HTMLElement;
  expect(heat).toHaveTextContent(/Temperature \(keV\).*coldest.*hottest/);
  expect(field).toHaveTextContent(/\|B\| \(T\).*weakest.*strongest/);
  // The temperature bar is labelled model; |B| (VMEC) is not.
  expect(heat.querySelector('[data-status="model"]')).toHaveTextContent('Model');
  expect(field.querySelector('[data-status]')).toBeNull();
  // Three colormaps under three kinds of vision.
  const rows = Array.from(panel.querySelectorAll('.gal-ramps__row')).map((r) => `${r.getAttribute('data-vision')}/${r.getAttribute('data-ramp')}`);
  expect(rows).toEqual(['normal', 'deuteranopia', 'protanopia'].flatMap((v) => ['heat', 'field', 'bmag'].map((r) => `${v}/${r}`)));
  // jsdom renders the light theme; the numbers are palette.ts's, with their gates.
  expect(panel.querySelector('[data-measure="field/heat"]')).toHaveTextContent(rampPairSeparation('field/heat', 'light').toFixed(1));
  expect(panel.querySelector('[data-measure="field/bmag"]')).toHaveTextContent(rampPairSeparation('field/bmag', 'light').toFixed(1));
  expect(panel.querySelector('[data-measure="heat/bmag"]')).toHaveTextContent(rampPairSeparation('heat/bmag', 'light').toFixed(1));
  expect(panel).toHaveTextContent(`gate ≥ ${RAMP_SEPARATION_GATES['field/heat']}`);
  expect(panel).toHaveTextContent(`gate ≥ ${RAMP_SEPARATION_GATES['heat/bmag']}; they never share a view`);
  expect(within(panel).getByRole('list', { name: 'Diverter plate on its hardest grounds' }).querySelectorAll('.gal-diverters__plate')).toHaveLength(4);
  // The model status is in the status list too, with its meaning.
  const model = container.querySelector('.gal-status [data-status="model"]');
  expect(model).toHaveTextContent('Model');
  expect(model?.closest('li')).toHaveTextContent(/not fitted to measurements/);
});

test('the gallery shows the states this round added: arithmetic basis, a clamped note, a recorded run', () => {
  const { container } = render(<Gallery />);
  expect(screen.getByRole('group', { name: /^Published stella bean.*: Arithmetic consistent\./ })).toHaveAttribute('data-basis', 'arithmetic');
  expect(screen.getByRole('button', { name: 'Show full note' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Provenance of saved GX specimen run: Recorded run, Not applicable' })).toBeInTheDocument();
  // LIVE appears exactly once on the page: the specimen pill in the status list, never on a badge.
  const live = container.querySelectorAll('[data-status="live"]');
  expect(live).toHaveLength(1);
  expect(live[0]?.closest('.gal-status')).not.toBeNull();
  expect(container.querySelector('.lab-prov [data-status="live"]')).toBeNull();
});

// design-r1-R6: /#gallery renders without the app shell and never asks /api/live/status, so it cannot
// know that $0 is true. It shows no global mode indicator; the replay pill appears only as a specimen.
test('the gallery claims no mode: no "Replay · $0" and no status pill in its header', () => {
  const { container } = render(<Gallery />);
  expect(screen.queryByText('Replay · $0')).toBeNull();
  const header = container.querySelector('.gal-header') as HTMLElement;
  expect(header).not.toBeNull();
  expect(header.querySelector('.lab-pill')).toBeNull();
  expect(header.textContent).not.toContain('$0');
  // the replay treatment is still shown, in the status list, as a labelled specimen
  expect(container.querySelector('.gal-status [data-status="replay"]')).not.toBeNull();
});

// design-r1-R9: the children of role="img" are presentational, and Plotly puts focusable modebar
// buttons inside the element it draws into. The chart is named on its figure instead.
test('each specimen chart is a named figure; the element Plotly draws into is not role="img"', async () => {
  const { container } = render(<Gallery />);
  await waitFor(() => [TRANSPORT_FIGURE, FORECAST_FIGURE].map(callIn));
  for (const name of [TRANSPORT_FIGURE, FORECAST_FIGURE]) {
    const [el] = callIn(name);
    expect(el).toHaveClass('gal-chart');
    expect(el.closest('[role="img"]')).toBeNull();
    expect(screen.getByRole('figure', { name })).toContainElement(el);
  }
  expect(container.querySelectorAll('[role="img"] .gal-chart, .gal-chart[role="img"]')).toHaveLength(0);
});

// DZ3-10: DESIGN.md §6 defines the forecast chart's pair; the review page shows it, built from the design
// system's own exports, in whichever theme is in effect.
describe('DZ3-10: the forecast specimen draws Predicted and Actual as §6 defines them', () => {
  // Unmount first: the gallery follows data-theme, and a theme change after the test would update it outside act().
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-theme');
  });

  test.each([...THEMES])('%s theme: two step lines with their legend names, in the tokens’ colours and dashes', async (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    render(<Gallery />);
    const [, data, layout] = await waitFor(() => callIn(FORECAST_FIGURE));
    const t = themes[theme];
    // Two lines, both in the legend, in FORECAST_LINES order and named by FORECAST_LABEL: "Predicted", "Actual".
    expect(data.map((d) => d.name)).toEqual(['Predicted', 'Actual']);
    expect(data.map((d) => d.name)).toEqual(FORECAST_LINES.map((l) => FORECAST_LABEL[l]));
    expect(data.every((d) => d.showlegend === true)).toBe(true);
    expect(layout.showlegend).toBe(true);
    // The tokens' colours: Predicted is plot.predicted, Actual is stella's series colour; dash, width and marker as §6.
    const [predicted, actual] = data as [Trace, Trace];
    expect(predicted.line).toEqual({ color: t.plot.predicted, dash: 'dash', width: 2 });
    expect(actual.line).toEqual({ color: t.series.stella, dash: 'solid', width: 2 });
    expect([predicted.marker?.symbol, predicted.marker?.color, predicted.marker?.opacity]).toEqual(['triangle-down', t.plot.predicted, 1]);
    expect([actual.marker?.symbol, actual.marker?.color, actual.marker?.opacity]).toEqual(['circle', t.series.stella, 1]);
    // Exactly what forecastStyle gives the forecast view, and never the colour of a series that is not drawn.
    FORECAST_LINES.forEach((line, i) => expect(data[i]?.line, line).toEqual(forecastStyle(line, theme).line));
    expect([t.series.GENE, t.series.triangular, t.series.GX]).not.toContain(predicted.line?.color);
    // Steps: each window's value held flat across it (risers where windows meet), the marker at its midpoint only.
    const n = FORECAST_SPECIMEN.windows.length;
    FORECAST_LINES.forEach((line, i) => {
      const d = data[i] as Trace;
      expect(d.mode).toBe('lines+markers');
      expect(d.x).toHaveLength(3 * n);
      FORECAST_SPECIMEN.windows.forEach((w, k) => {
        const [a, b] = w.window;
        expect(d.x?.slice(3 * k, 3 * k + 3), `${line} ${a}`).toEqual([a, (a + b) / 2, b]);
        expect(d.y?.slice(3 * k, 3 * k + 3), `${line} ${a}`).toEqual([w[line], w[line], w[line]]);
        expect((d.marker?.size as number[]).slice(3 * k, 3 * k + 3), `${line} ${a}`).toEqual([0, forecastStyle(line, theme).marker.size, 0]);
      });
    });
    // Predicted is the persistence forecast: the previous window's Actual.
    FORECAST_SPECIMEN.windows.slice(1).forEach((w, k) => expect(w.predicted).toBe(FORECAST_SPECIMEN.windows[k]?.actual));
    // The theme's layout, units in both axis titles.
    expect(layout.paper_bgcolor).toBe(t.plot.paper);
    expect(layout.xaxis?.title?.text).toBe(axisTitle('Time t', 'a/v_{th,i}'));
    expect(layout.yaxis?.title?.text).toBe(axisTitle('Ion heat flux Q_i', 'Q_{gB,i}'));
  });

  test('the error statistics beside it are Stats computed from the plotted values, with their units', async () => {
    render(<Gallery />);
    const [, data] = await waitFor(() => callIn(FORECAST_FIGURE));
    const panel = screen.getByRole('region', { name: 'Predicted vs actual heat flux' });
    expect(panel).toContainElement(screen.getByRole('figure', { name: FORECAST_FIGURE }));
    // e = Predicted − Actual at each window's midpoint, as drawn.
    const mids = (d: Trace) => (d.y ?? []).filter((_, i) => i % 3 === 1) as number[];
    const p = mids(data[0] as Trace);
    const a = mids(data[1] as Trace);
    const mse = p.reduce((s, v, i) => s + (v - (a[i] as number)) ** 2, 0) / p.length;
    expect(mse).toBeGreaterThan(0);
    expect(within(panel).getByRole('group', { name: /^MSE: / })).toHaveAccessibleName(
      `MSE: ${formatNumber(mse, 4)} Q gB,i², window t 1500 to 1900`,
    );
    expect(within(panel).getByRole('group', { name: /^RMSE: / })).toHaveAccessibleName(
      `RMSE: ${formatNumber(Math.sqrt(mse), 3)} Q gB,i, window t 1500 to 1900`,
    );
    expect(panel).toHaveTextContent(/Specimen data/);
  });

  test('the design system imports nothing from outside it: no feature, shell or lib module (the specimen is its own)', () => {
    const DESIGN = resolve(import.meta.dirname);
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? sources(resolve(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [resolve(dir, e.name)] : [],
      );
    const files = sources(DESIGN);
    expect(files.map((f) => relative(DESIGN, f).replace(/\\/g, '/'))).toContain('Gallery.tsx');
    const outside: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
        const spec = m[1] as string;
        if (!spec.startsWith('.')) continue; // a package (react, three, plotly.js-dist-min)
        const target = relative(DESIGN, resolve(dirname(f), spec));
        if (target.startsWith('..')) outside.push(`${relative(DESIGN, f)} -> ${spec}`);
      }
    }
    expect(outside).toEqual([]);
  });
});

test('without WebGL the scene says so', async () => {
  render(<Gallery />);
  expect(await screen.findByRole('note', { name: 'Warning: WebGL unavailable' })).toHaveTextContent('no WebGL in jsdom');
});

test('F9: the specimen surface fits the canvas at every panel width (it was cropped at 390 px)', () => {
  const outer = SPECIMEN.majorRadius + SPECIMEN.minorRadius;
  const distance = Math.hypot(...SPECIMEN.camera);
  const halfFov = Math.tan(((SPECIMEN.fovDeg / 2) * Math.PI) / 180);
  for (const width of [240, 276, 316, 390, 600, 646, 900]) {
    const { height, aspect, fit } = specimenFrame(width);
    expect(height).toBeGreaterThanOrEqual(180);
    expect(height).toBeLessThanOrEqual(300);
    // Half-width of the view at the centre of the surface must clear the surface's outer radius with a margin.
    const visibleHalfWidth = distance * fit * halfFov * aspect;
    expect(visibleHalfWidth, `width ${width}`).toBeGreaterThan(outer * 1.2);
  }
  expect(specimenFrame(600)).toEqual({ height: 300, aspect: 2, fit: 1 });
  // The old framing: a 276 px canvas 300 px tall, camera not moved.
  expect(distance * halfFov * (276 / 300)).toBeLessThan(outer);
});
