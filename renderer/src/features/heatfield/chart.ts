// Pure spec for the |B| against toroidal angle chart (H14): |B| on the LCFS at the strike-line θ, as the coils
// sweep, with markers that link it to the 3D view and an optional frozen snapshot.
import { axisTitle, formatNumber, plotLayout, themes, type PlotLayout, type PlotShape, type ThemeName } from '../../design';
import type { HeatModel } from './model';

export interface FieldCurve {
  /** Toroidal angle (degrees), 0…360 (the first plane repeated at 360 to close the turn). */
  phiDeg: number[];
  /** |B| (T). */
  B: number[];
}

export interface Snapshot extends FieldCurve {
  /** Model time of the snapshot (s, since the spun-up start). */
  t: number;
  coils: number[];
}

/** θ index nearest the strike-line θ_d (diverters.thetaCentre). */
export function strikeIndex(model: HeatModel): number {
  return ((Math.round(model.thetaD / model.dTheta) % model.nTheta) + model.nTheta) % model.nTheta;
}

/** |B| at θ index i for every plane, closed at 360°. */
export function fieldCurve(model: HeatModel, B: Float64Array, i = strikeIndex(model)): FieldCurve {
  const phiDeg: number[] = [];
  const out: number[] = [];
  for (let j = 0; j <= model.nPhi; j++) {
    phiDeg.push((360 * j) / model.nPhi);
    out.push(B[(j % model.nPhi) * model.nTheta + i]!);
  }
  return { phiDeg, B: out };
}

/** Fixed y range: the curve over every coil state (|B|·(1 ± ε Σ h)), so the axis does not jump as coils sweep. */
export function curveRange(model: HeatModel, i = strikeIndex(model)): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < model.nPhi; j++) {
    const c = j * model.nTheta + i;
    let hs = 0;
    for (const h of model.h) hs += h[c]!;
    lo = Math.min(lo, model.Bs[c]! * (1 - model.params.epsilon * hs));
    hi = Math.max(hi, model.Bs[c]! * (1 + model.params.epsilon * hs));
  }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

export interface FieldChartInput {
  curve: FieldCurve;
  snapshot: Snapshot | null;
  /** Model time now (s). */
  t: number;
  /** Cross-section slider angle (degrees). */
  sliceDeg: number;
  /** Toroidal angle under the pointer in the 3D view (degrees), if any. */
  hoverDeg: number | null;
  diverters: { id: string; deg: number }[];
  thetaDeg: number;
  yRange: [number, number];
  theme: ThemeName;
  /** A narrow chart (a phone): five φ ticks instead of nine, and the narrow legend (DZ3-6). */
  narrow?: boolean;
}

/** What the layout depends on: the markers, the axes and the theme, never the curve or the model time (HF3-1). */
export type FieldLayoutInput = Pick<FieldChartInput, 'sliceDeg' | 'hoverDeg' | 'diverters' | 'thetaDeg' | 'yRange' | 'theme' | 'narrow'>;

/**
 * Plotly keeps the user's zoom, pan and legend state across Plotly.react calls while this stays the same (HF3-1):
 * the curve is redrawn on every frame while playing, and without it each redraw reset the zoom.
 */
export const FIELD_UIREVISION = 'hf-field';
/** Legend name of the running curve: fixed, so the legend does not re-lay out every frame (the time is in the summary). */
export const NOW_NAME = '|B| now';
/** φ ticks (degrees) on a wide and on a narrow chart (DZ3-6: at 375 px nine ticks rotate and lose 360°). */
export const PHI_TICKS = { wide: [0, 45, 90, 135, 180, 225, 270, 315, 360], narrow: [0, 90, 180, 270, 360] } as const;

export interface ChartSpec {
  data: Record<string, unknown>[];
  layout: PlotLayout;
  ariaLabel: string;
  summary: string;
}

const deg = (v: number) => `${formatNumber(v, 0)}°`;

/**
 * The φ axis runs a little past 0° and 360° (DZ-5): a marker at 0° (D1, and the slice in the default state) would
 * otherwise sit on the y axis line and vanish into it.
 */
export const PHI_PAD_DEG = 6;
/** Two marker labels closer than this (degrees) take different ends of their lines (DZ-5). */
export const LABEL_CLASH_DEG = 10;
const LABEL_POSITIONS = ['end', 'start', 'middle'] as const;
export type MarkerLabelPosition = (typeof LABEL_POSITIONS)[number];

/**
 * Where each marker's label sits on its vertical line, in priority order: the first position (top, bottom, middle)
 * not already taken by a marker within LABEL_CLASH_DEG. Diverters first, then the slice, then the pointer, so the
 * slice's label moves to the bottom when the slice is at a diverter's angle.
 */
export function staggerLabels(angles: readonly number[]): MarkerLabelPosition[] {
  const placed: { at: number; pos: MarkerLabelPosition }[] = [];
  return angles.map((at) => {
    const taken = new Set(placed.filter((p) => Math.abs(p.at - at) < LABEL_CLASH_DEG).map((p) => p.pos));
    const pos = LABEL_POSITIONS.find((p) => !taken.has(p)) ?? 'middle';
    placed.push({ at, pos });
    return pos;
  });
}

/** A shape label with Plotly's anchors (the design system's PlotShape type does not list them). */
type ShapeLabel = NonNullable<PlotShape['label']> & { xanchor: 'left' | 'center' | 'right'; yanchor: 'top' | 'bottom' };

/** Markers past this angle (degrees) put their label on the left of the line, so it stays inside the plot. */
export const LABEL_LEFT_FROM_DEG = 360 - 4 * PHI_PAD_DEG;

/**
 * Where a vertical marker's label sits against its line, inside the plot (DZ-5). Plotly writes it along the line
 * (reading upwards). `yanchor` is across the line in the text's frame: 'top' puts the text on the right of the line,
 * 'bottom' (Plotly's default) on its left, where a label at 0° runs into the y axis line. `xanchor` is along it:
 * 'left' starts the text at the bottom end and runs it upwards, 'right' ends it at the top end; Plotly's default
 * runs the text out past the line's end, where a label at the bottom crosses the tick labels.
 */
export function markerLabelAnchors(at: number, pos: MarkerLabelPosition): Pick<ShapeLabel, 'xanchor' | 'yanchor'> {
  return {
    xanchor: pos === 'start' ? 'left' : pos === 'end' ? 'right' : 'center',
    yanchor: at < LABEL_LEFT_FROM_DEG ? 'top' : 'bottom',
  };
}

export function fieldChartSpec(x: FieldChartInput): ChartSpec {
  return { data: fieldChartData(x), layout: fieldChartLayout(x), ...fieldChartText(x) };
}

/** The traces: the running curve and the frozen snapshot. Rebuilt on every model step. */
export function fieldChartData(x: Pick<FieldChartInput, 'curve' | 'snapshot' | 'theme'>): Record<string, unknown>[] {
  const field = themes[x.theme].scene.field;
  const hover = 'φ %{x:.0f}°<br>|B| %{y:.4f} T<extra></extra>';
  const data: Record<string, unknown>[] = [];
  if (x.snapshot) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: x.snapshot.phiDeg,
      y: x.snapshot.B,
      name: `Snapshot at t = ${formatNumber(x.snapshot.t, 2)} s`,
      line: { color: field[5], width: 2, dash: 'dash' },
      hovertemplate: `snapshot · ${hover}`,
    });
  }
  data.push({
    type: 'scatter',
    mode: 'lines',
    x: x.curve.phiDeg,
    y: x.curve.B,
    name: NOW_NAME,
    line: { color: field[field.length - 1], width: 2.25, dash: 'solid' },
    hovertemplate: hover,
  });
  return data;
}

/** The layout: axes, markers and theme. Built only when one of those changes, never per model step (HF3-1). */
export function fieldChartLayout(x: FieldLayoutInput): PlotLayout {
  const t = themes[x.theme];
  const vline = (at: number, color: string, dash: string, width: number, label: string, name: string, pos: MarkerLabelPosition): PlotShape => {
    const shapeLabel: ShapeLabel = {
      text: label,
      textposition: pos,
      ...markerLabelAnchors(at, pos),
      font: { size: 11, color: t.color.textMuted },
      padding: 2,
    };
    return {
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: at,
      x1: at,
      y0: 0,
      y1: 1,
      line: { color, width, dash },
      layer: 'above',
      name,
      label: shapeLabel,
    };
  };
  const pos = staggerLabels([...x.diverters.map((d) => d.deg), x.sliceDeg, ...(x.hoverDeg !== null ? [x.hoverDeg] : [])]);
  const nDiv = x.diverters.length;
  // Drawn slice first, then the dotted diverter lines over it: at a diverter's angle both stay visible.
  const shapes: PlotShape[] = [
    vline(x.sliceDeg, t.color.accent, 'solid', 1.5, 'slice', 'cross-section slice', pos[nDiv]!),
    ...x.diverters.map((d, k) => vline(d.deg, t.color.text, 'dot', 1, d.id, `diverter ${d.id}`, pos[k]!)),
  ];
  if (x.hoverDeg !== null) shapes.push(vline(x.hoverDeg, t.color.textMuted, 'dash', 1, 'pointer', 'pointer', pos[nDiv + 1]!));

  return plotLayout(
    x.theme,
    {
      height: 300,
      margin: { l: 64, r: 16, t: 36, b: 48 },
      hovermode: 'x unified',
      uirevision: FIELD_UIREVISION,
      xaxis: {
        title: { text: axisTitle('Toroidal angle φ', '°') },
        range: [-PHI_PAD_DEG, 360 + PHI_PAD_DEG],
        tickvals: [...(x.narrow ? PHI_TICKS.narrow : PHI_TICKS.wide)],
        ticksuffix: '°',
      },
      yaxis: { title: { text: axisTitle(`|B| at θ = ${formatNumber(x.thetaDeg, 0)}°`, 'T') }, range: x.yRange, tickformat: '.2f' },
      shapes,
    },
    x.narrow === undefined ? {} : { narrow: x.narrow },
  );
}

/** The figure's accessible name and its text equivalent (with the model time). */
export function fieldChartText(x: FieldChartInput): { ariaLabel: string; summary: string } {
  const ys = x.curve.B;
  let lo = 0;
  let hi = 0;
  ys.forEach((v, k) => {
    if (v < ys[lo]!) lo = k;
    if (v > ys[hi]!) hi = k;
  });
  const snap = x.snapshot
    ? ` A frozen snapshot from t = ${formatNumber(x.snapshot.t, 2)} s is drawn dashed for comparison.`
    : '';
  return {
    ariaLabel: `Line chart: |B| in tesla on the last closed flux surface at θ = ${formatNumber(x.thetaDeg, 0)}° against toroidal angle φ in degrees, at model time ${formatNumber(x.t, 2)} s`,
    summary:
      `|B| at the strike-line θ (${formatNumber(x.thetaDeg, 0)}°) at t = ${formatNumber(x.t, 2)} s ranges from ${formatNumber(ys[lo]!, 3)} T ` +
      `(φ ${deg(x.curve.phiDeg[lo]!)}) to ${formatNumber(ys[hi]!, 3)} T (φ ${deg(x.curve.phiDeg[hi]!)}). ` +
      `Markers: diverters ${x.diverters.map((d) => `${d.id} ${deg(d.deg)}`).join(', ')}; slice ${deg(x.sliceDeg)}` +
      `${x.hoverDeg !== null ? `; pointer ${deg(x.hoverDeg)}` : ''}.${snap}`,
  };
}
