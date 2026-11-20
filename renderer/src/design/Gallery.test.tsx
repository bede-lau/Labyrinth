// The review page itself (verifier finding F9, design finding DS-21): what it shows must be what
// the system does, and its words must be the app's words.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import Gallery, { SPECIMEN, specimenFrame } from './Gallery';
import { PALETTE_GATES, seriesMinDeltaE } from './palette';
import { SERIES_LABEL } from './plotTheme';
import { SERIES_IDS } from './tokens';

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

type Trace = { name?: string; mode?: string; marker?: { symbol?: string }; showlegend?: boolean };
type Shape = { type: string; name?: string };

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
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  const [, data, layout] = plotly.react.mock.calls.at(-1) as [HTMLElement, Trace[], { shapes: Shape[] }];
  const lines = data.filter((d) => d.showlegend !== false);
  expect(lines.map((d) => [d.name, d.mode])).toEqual([
    ['stella', 'lines'],
    ['GENE', 'lines'],
    ['GX', 'lines+markers'],
  ]);
  expect(lines[2]?.marker?.symbol).toBe('diamond');
  const rects = layout.shapes.filter((s) => s.type === 'rect').map((s) => s.name);
  expect(rects[0]).toBe('unsampled');
  expect(rects.slice(1).every((n) => /^window /.test(n ?? ''))).toBe(true);
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
