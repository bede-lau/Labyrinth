// Plotly theme built from tokens. No colour literals here — every colour comes from tokens.ts
// (enforced by noHardcodedColors.test.ts).
//
// Usage:
//   const theme = useResolvedTheme();
//   Plotly.react(el, [ ...traces ], plotLayout(theme, { xaxis: { title: { text: axisTitle('Time', 'a/v_{th,i}') } } }), plotConfig());

import { withAlpha } from './color';
import { plotlyUnit, spokenWindow } from './format';
import { font, themes, typeScale, type SeriesId, type ThemeName } from './tokens';

/* Minimal structural types for the parts of Plotly we style (plotly.js-dist-min ships no types). */
export interface PlotFont {
  family?: string;
  size?: number;
  color?: string;
  weight?: number;
}
export interface PlotAxis {
  title?: { text?: string; font?: PlotFont; standoff?: number };
  showline?: boolean;
  linecolor?: string;
  linewidth?: number;
  showgrid?: boolean;
  gridcolor?: string;
  gridwidth?: number;
  zeroline?: boolean;
  zerolinecolor?: string;
  ticks?: '' | 'outside' | 'inside';
  ticklen?: number;
  tickwidth?: number;
  tickcolor?: string;
  tickfont?: PlotFont;
  automargin?: boolean;
  range?: [number, number];
  hoverformat?: string;
  separatethousands?: boolean;
  exponentformat?: string;
  [key: string]: unknown;
}
export interface PlotShape {
  type: 'rect' | 'line';
  xref?: string;
  yref?: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  fillcolor?: string;
  line?: { color?: string; width?: number; dash?: string };
  layer?: 'below' | 'above';
  label?: { text?: string; font?: PlotFont; textposition?: string; padding?: number };
  name?: string;
}
export interface PlotLayout {
  font: PlotFont;
  paper_bgcolor: string;
  plot_bgcolor: string;
  colorway: string[];
  margin: { l: number; r: number; t: number; b: number; pad?: number };
  xaxis: PlotAxis;
  yaxis: PlotAxis;
  legend: Record<string, unknown>;
  hoverlabel: { bgcolor: string; bordercolor: string; font: PlotFont; align?: string };
  hovermode: 'x unified' | 'closest' | 'x' | false;
  separators: string;
  title?: { text?: string; font?: PlotFont; x?: number; xanchor?: string };
  shapes?: PlotShape[];
  annotations?: Record<string, unknown>[];
  modebar: { bgcolor: string; color: string; activecolor: string; orientation?: string };
  dragmode?: string;
  [key: string]: unknown;
}
export interface SeriesStyle {
  name: string;
  line: { color: string; width: number; dash: 'solid' | 'dash' | 'dot' | 'dashdot' | 'longdash' };
  marker: { color: string; symbol: string; size: number; line: { color: string; width: number } };
}

/** Display names; the legend never shows internal ids. */
export const SERIES_LABEL: Record<SeriesId, string> = {
  stella: 'stella',
  GENE: 'GENE',
  GX: 'GX',
  bean: 'Bean tube',
  triangular: 'Triangular tube',
};

/**
 * Redundant (non-colour) encoding per series so no chart relies on hue alone:
 * archives get distinct dashes and markers; GX — the new run — is the solid, heaviest line.
 */
const SERIES_SHAPE: Record<SeriesId, { dash: SeriesStyle['line']['dash']; symbol: string; width: number }> = {
  stella: { dash: 'solid', symbol: 'circle', width: 1.5 },
  GENE: { dash: 'dash', symbol: 'square', width: 1.5 },
  GX: { dash: 'solid', symbol: 'diamond', width: 2.25 },
  bean: { dash: 'solid', symbol: 'hexagon', width: 2 },
  triangular: { dash: 'dashdot', symbol: 'triangle-up', width: 2 },
};

/** Axis title with its unit (`_x` / `_{..}` become subscripts in both). A unit is mandatory; pass 'dimensionless' when there is none. */
export function axisTitle(quantity: string, unit: string): string {
  if (!unit.trim()) throw new Error(`axisTitle("${quantity}"): a unit is required (use 'dimensionless')`);
  const q = plotlyUnit(quantity);
  return unit === 'dimensionless' ? `${q} (–)` : `${q} (${plotlyUnit(unit)})`;
}

const baseAxis = (theme: ThemeName): PlotAxis => {
  const t = themes[theme];
  return {
    showline: true,
    linecolor: t.plot.axis,
    linewidth: 1,
    showgrid: true,
    gridcolor: t.plot.grid,
    gridwidth: 1,
    zeroline: false,
    zerolinecolor: t.plot.zero,
    ticks: 'outside',
    ticklen: 4,
    tickwidth: 1,
    tickcolor: t.plot.axis,
    tickfont: { family: font.sans, size: typeScale.xs[0], color: t.color.textMuted },
    title: { font: { family: font.sans, size: typeScale.xs[0], color: t.color.textMuted }, standoff: 8 },
    automargin: true,
    exponentformat: 'power',
  };
};

/** A complete Plotly layout for the theme. `overrides` are shallow-merged (axes merged one level). */
export function plotLayout(theme: ThemeName, overrides: Partial<PlotLayout> = {}): PlotLayout {
  const t = themes[theme];
  const { xaxis, yaxis, ...rest } = overrides;
  const base: PlotLayout = {
    font: { family: font.sans, size: typeScale.xs[0], color: t.color.textMuted },
    autosize: true,
    paper_bgcolor: t.plot.paper,
    plot_bgcolor: t.plot.plot,
    colorway: seriesColorway(theme),
    margin: { l: 56, r: 16, t: 36, b: 44, pad: 0 },
    xaxis: { ...baseAxis(theme), ...xaxis },
    yaxis: { ...baseAxis(theme), ...yaxis },
    legend: {
      orientation: 'h',
      x: 0,
      xanchor: 'left',
      y: 1.02,
      yanchor: 'bottom',
      bgcolor: t.plot.paper,
      borderwidth: 0,
      font: { family: font.sans, size: typeScale.xs[0], color: t.color.text },
      itemsizing: 'constant',
      itemwidth: 40,
    },
    hoverlabel: {
      bgcolor: t.color.surfaceRaised,
      bordercolor: t.color.borderStrong,
      font: { family: font.sans, size: typeScale.xs[0], color: t.color.text },
      align: 'left',
    },
    hovermode: 'x unified',
    separators: '.,',
    title: { font: { family: font.sans, size: typeScale.md[0], color: t.color.text, weight: 600 }, x: 0, xanchor: 'left' },
    modebar: { bgcolor: t.plot.paper, color: t.color.textSubtle, activecolor: t.color.accent, orientation: 'h' },
    dragmode: 'zoom',
  };
  return { ...base, ...rest };
}

/** Plotly config: no logo, no cloud export, responsive. */
export function plotConfig() {
  return {
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toggleSpikelines', 'sendDataToCloud'],
    toImageButtonOptions: { format: 'svg' as const, scale: 1 },
  };
}

export function seriesColorway(theme: ThemeName): string[] {
  const s = themes[theme].series;
  return [s.stella, s.GENE, s.GX, s.bean, s.triangular];
}

/** Line + marker style for a named series (colour, dash, marker, width). */
export function seriesStyle(series: SeriesId, theme: ThemeName): SeriesStyle {
  const t = themes[theme];
  const color = t.series[series];
  const shape = SERIES_SHAPE[series];
  return {
    name: SERIES_LABEL[series],
    line: { color, width: shape.width, dash: shape.dash },
    marker: { color, symbol: shape.symbol, size: 6, line: { color: t.plot.paper, width: 1 } },
  };
}

/**
 * ±1σ sampling-uncertainty band as one closed polygon trace (put it *before* its line trace).
 * `sigma` may be a scalar (constant band, e.g. a window mean ± stderr) or per-point.
 */
export function uncertaintyBand(
  x: readonly number[],
  center: readonly number[],
  sigma: number | readonly number[],
  series: SeriesId,
  theme: ThemeName,
) {
  const t = themes[theme];
  const sig = (i: number) => (typeof sigma === 'number' ? sigma : (sigma[i] ?? 0));
  const upper = center.map((c, i) => c + sig(i));
  const lower = center.map((c, i) => c - sig(i));
  return {
    type: 'scatter' as const,
    mode: 'lines' as const,
    x: [...x, ...[...x].reverse()],
    y: [...upper, ...lower.reverse()],
    fill: 'toself' as const,
    fillcolor: withAlpha(t.series[series], t.plot.bandAlpha),
    line: { width: 0, color: withAlpha(t.series[series], 0) },
    hoverinfo: 'skip' as const,
    showlegend: false,
    name: `${SERIES_LABEL[series]} ±1σ`,
  };
}

/** Shaded analysis window (e.g. 300–400) spanning the plot height, labelled at the top. */
export function windowShape(
  window: readonly [number, number],
  theme: ThemeName,
  label?: string,
): PlotShape {
  const t = themes[theme];
  return {
    type: 'rect',
    xref: 'x',
    yref: 'paper',
    x0: window[0],
    x1: window[1],
    y0: 0,
    y1: 1,
    fillcolor: t.plot.windowShade,
    line: { color: t.plot.windowEdge, width: 1, dash: 'dot' },
    layer: 'below',
    name: `window ${spokenWindow(window)}`,
    label: label
      ? {
          text: label,
          textposition: 'top left',
          padding: 4,
          font: { family: font.sans, size: typeScale['2xs'][0], color: t.color.textMuted },
        }
      : undefined,
  };
}

/** Gray block marking a range with no samples (gray = unsampled, everywhere). */
export function unsampledShape(range: readonly [number, number], theme: ThemeName): PlotShape {
  const t = themes[theme];
  return {
    type: 'rect',
    xref: 'x',
    yref: 'paper',
    x0: range[0],
    x1: range[1],
    y0: 0,
    y1: 1,
    fillcolor: withAlpha(t.plot.unsampled, 0.35),
    line: { width: 0 },
    layer: 'below',
    name: 'unsampled',
    label: {
      text: 'unsampled',
      textposition: 'bottom center',
      padding: 4,
      font: { family: font.sans, size: typeScale['2xs'][0], color: t.color.textSubtle },
    },
  };
}

/** Horizontal segment for a published/claimed mean over a window (e.g. triangular 2.22 on 1200–1500). */
export function meanSegment(
  window: readonly [number, number],
  value: number,
  series: SeriesId,
  theme: ThemeName,
): PlotShape {
  const style = seriesStyle(series, theme);
  return {
    type: 'line',
    xref: 'x',
    yref: 'y',
    x0: window[0],
    x1: window[1],
    y0: value,
    y1: value,
    line: { color: style.line.color, width: 2.5, dash: style.line.dash },
    layer: 'above',
    name: `${SERIES_LABEL[series]} mean`,
  };
}
