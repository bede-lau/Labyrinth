// @vitest-environment node
// H14 (DZ-5): the |B| against φ chart's markers stay visible at 0° and their labels never sit on top of each other.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { themes } from '../../design';
import {
  FIELD_UIREVISION,
  LABEL_CLASH_DEG,
  LABEL_LEFT_FROM_DEG,
  NOW_NAME,
  PHI_PAD_DEG,
  PHI_TICKS,
  curveRange,
  fieldChartLayout,
  fieldChartSpec,
  fieldCurve,
  markerLabelAnchors,
  staggerLabels,
  strikeIndex,
  type FieldChartInput,
} from './chart';
import { modelFor, spunUpState } from './model';
import type { HeatfieldArtifact } from './types';

const ART = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')) as HeatfieldArtifact;
const model = modelFor(ART);
const start = spunUpState(model);
const iS = strikeIndex(model);
const DIVERTERS = ART.diverters.items.map((d) => ({ id: d.id, deg: (d.phi * 180) / Math.PI }));

const spec = (over: Partial<FieldChartInput> = {}) =>
  fieldChartSpec({
    curve: fieldCurve(model, model.field([0, 0, 0, 0], start.n), iS),
    snapshot: null,
    t: 0,
    sliceDeg: 0,
    hoverDeg: null,
    diverters: DIVERTERS,
    thetaDeg: (360 * iS) / model.nTheta,
    yRange: curveRange(model, iS),
    theme: 'light',
    ...over,
  });
const shape = (s: ReturnType<typeof spec>, name: string) => s.layout.shapes!.find((x) => x.name === name)!;

test('H14 the φ axis is padded past 0° and 360°, so the D1 and slice markers at 0° are not hidden on the y axis line (DZ-5)', () => {
  const s = spec();
  const range = s.layout.xaxis.range as [number, number];
  expect(range).toEqual([-PHI_PAD_DEG, 360 + PHI_PAD_DEG]);
  expect(PHI_PAD_DEG).toBeGreaterThanOrEqual(4);
  // Both markers of the default state sit at 0°, inside the plot and clear of its left edge.
  expect(shape(s, 'diverter D1').x0).toBe(0);
  expect(shape(s, 'cross-section slice').x0).toBe(0);
  expect(shape(s, 'diverter D1').x0).toBeGreaterThan(range[0]);
  // Ticks still read 0° … 360° and the curve still closes the turn at 360°.
  expect(s.layout.xaxis.tickvals).toEqual([0, 45, 90, 135, 180, 225, 270, 315, 360]);
  expect((s.data[0] as { x: number[] }).x.at(-1)).toBe(360);
  // The dotted diverter line is drawn after (over) the solid slice line, so at the same angle both show.
  const names = s.layout.shapes!.map((x) => x.name);
  expect(names.indexOf('diverter D1')).toBeGreaterThan(names.indexOf('cross-section slice'));
});

test('H14 the slice label moves to the bottom of its line when the slice is at a diverter angle, and stays at the top elsewhere (DZ-5)', () => {
  const pos = (s: ReturnType<typeof spec>, name: string) => shape(s, name).label?.textposition;
  // Default state: slice at D1 (0°). D1's label keeps the top, the slice label goes to the bottom.
  let s = spec();
  expect(pos(s, 'diverter D1')).toBe('end');
  expect(pos(s, 'cross-section slice')).toBe('start');
  // Away from every diverter the slice label is at the top like the others.
  s = spec({ sliceDeg: 45 });
  expect(pos(s, 'cross-section slice')).toBe('end');
  DIVERTERS.forEach((d) => expect(pos(s, `diverter ${d.id}`)).toBe('end'));
  // Within the clash window of D2 (5° off) it still moves; the pointer on the same angle takes the middle.
  s = spec({ sliceDeg: 95, hoverDeg: 90 });
  expect(pos(s, 'diverter D2')).toBe('end');
  expect(pos(s, 'cross-section slice')).toBe('start');
  expect(pos(s, 'pointer')).toBe('middle');
  // The pointer alone away from the rest keeps the top.
  expect(pos(spec({ sliceDeg: 45, hoverDeg: 135 + 2 * LABEL_CLASH_DEG }), 'pointer')).toBe('end');
});

test('H14 marker labels are anchored inside the plot: on the right of their line (clear of the y axis at 0°), ending at the top or starting at the bottom (clear of the tick labels) (DZ-5)', () => {
  const anchors = (s: ReturnType<typeof spec>, name: string) => {
    const l = shape(s, name).label as { xanchor?: string; yanchor?: string; textposition?: string };
    return [l.textposition, l.xanchor, l.yanchor];
  };
  // Default state, both at 0°: D1's label ends at the top, the slice's starts at the bottom, both right of the line.
  let s = spec();
  expect(anchors(s, 'diverter D1')).toEqual(['end', 'right', 'top']);
  expect(anchors(s, 'cross-section slice')).toEqual(['start', 'left', 'top']);
  expect(anchors(spec({ sliceDeg: 95, hoverDeg: 90 }), 'pointer')).toEqual(['middle', 'center', 'top']);
  // Near the right end of the axis the label goes on the left of the line instead.
  expect(LABEL_LEFT_FROM_DEG).toBeLessThan(360);
  s = spec({ sliceDeg: 355 });
  expect(anchors(s, 'cross-section slice')).toEqual(['end', 'right', 'bottom']);
  expect(markerLabelAnchors(LABEL_LEFT_FROM_DEG - 5, 'end')).toEqual({ xanchor: 'right', yanchor: 'top' });
  expect(markerLabelAnchors(LABEL_LEFT_FROM_DEG, 'start')).toEqual({ xanchor: 'left', yanchor: 'bottom' });
});

test('H14 per model step only the traces change: the layout keeps one uirevision (Plotly keeps the user’s zoom and pan) and the running curve one legend name (HF3-1)', () => {
  const a = spec({ t: 0 });
  const later = spec({ t: 1.25, curve: fieldCurve(model, model.field([1, 1, 0, 0], start.n + 1250), iS) });
  expect(a.layout.uirevision).toBe(FIELD_UIREVISION);
  expect(later.layout.uirevision).toBe(FIELD_UIREVISION);
  // Same layout for a new time and a new curve; the time lives in the summary and the accessible name.
  expect(JSON.stringify(later.layout)).toBe(JSON.stringify(a.layout));
  expect((a.data.at(-1) as { name: string }).name).toBe(NOW_NAME);
  expect((later.data.at(-1) as { name: string }).name).toBe(NOW_NAME);
  expect(later.summary).toContain('at t = 1.25 s');
  expect(later.ariaLabel).toContain('at model time 1.25 s');
  // The layout is a function of the markers, axes and theme alone.
  const input ={ sliceDeg: 0, hoverDeg: null, diverters: DIVERTERS, thetaDeg: (360 * iS) / model.nTheta, yRange: curveRange(model, iS), theme: 'light' as const };
  expect(JSON.stringify(fieldChartLayout(input))).toBe(JSON.stringify(a.layout));
  // A marker that moves does change it, and keeps the uirevision.
  const moved = fieldChartLayout({ ...input, hoverDeg: 135 });
  expect(moved.shapes!.some((s) => s.name === 'pointer')).toBe(true);
  expect(moved.uirevision).toBe(FIELD_UIREVISION);
});

test('H14 a narrow chart (a phone) gets five φ ticks, 0° to 360°, instead of nine (DZ3-6)', () => {
  expect(PHI_TICKS.wide).toEqual([0, 45, 90, 135, 180, 225, 270, 315, 360]);
  expect(PHI_TICKS.narrow).toEqual([0, 90, 180, 270, 360]);
  expect(spec({ narrow: true }).layout.xaxis.tickvals).toEqual([0, 90, 180, 270, 360]);
  expect(spec({ narrow: false }).layout.xaxis.tickvals).toEqual([0, 45, 90, 135, 180, 225, 270, 315, 360]);
  // Both still end on 360°, and the narrow layout moves the legend under the plot (plotLayout's narrow option).
  expect((spec({ narrow: true }).layout.xaxis.tickvals as number[]).at(-1)).toBe(360);
  expect(spec({ narrow: true }).layout.legend.yref).toBe('container');
  expect(spec({ narrow: false }).layout.legend.yref).toBeUndefined();
});

test('H14 staggerLabels: the first free position of top, bottom, middle among markers closer than the clash window', () => {
  expect(staggerLabels([0, 90, 180, 270, 0])).toEqual(['end', 'end', 'end', 'end', 'start']);
  expect(staggerLabels([0, 90, 180, 270, 45, 47])).toEqual(['end', 'end', 'end', 'end', 'end', 'start']);
  expect(staggerLabels([90, 90 + LABEL_CLASH_DEG - 1, 90 + 1])).toEqual(['end', 'start', 'middle']);
  expect(staggerLabels([90, 90 + LABEL_CLASH_DEG])).toEqual(['end', 'end']);
  // The chart colours are untouched by the stagger.
  expect(shape(spec(), 'cross-section slice').line?.color).toBe(themes.light.color.accent);
});
