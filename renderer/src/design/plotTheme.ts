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
  label?: { text?: string; font?: PlotFont; textposition?: string; textangle?: number | 'auto'; padding?: number };
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
/**
 * What `plotLayout` accepts as overrides. Themed objects may be given partially: the keys you pass
 * win, the themed keys you leave out are kept (`{ margin: { r: 40 } }` keeps l, t and b).
 */
export type PlotLayoutOverrides = Omit<
  Partial<PlotLayout>,
  'font' | 'margin' | 'xaxis' | 'yaxis' | 'legend' | 'hoverlabel' | 'title' | 'modebar'
> & {
  font?: PlotFont;
  margin?: Partial<PlotLayout['margin']>;
  xaxis?: PlotAxis;
  yaxis?: PlotAxis;
  legend?: Record<string, unknown>;
  hoverlabel?: Partial<PlotLayout['hoverlabel']>;
  title?: PlotLayout['title'];
  modebar?: Partial<PlotLayout['modebar']>;
};

export interface PlotLayoutOptions {
  /**
   * Lay the chart out for a narrow container: the legend moves under the plot, so the hover
   * modebar (about 216px wide) has the top margin to itself. Default: follows the viewport
   * (`NARROW_CHART_QUERY`). Pass `true` for a chart in a narrow card on a wide screen.
   */
  narrow?: boolean;
}

/** Viewports this narrow get the narrow chart layout unless `plotLayout` is told otherwise. */
export const NARROW_CHART_QUERY = '(max-width: 640px)';

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

/** The two lines of the forecast chart (D-026): heat flux against time, predicted and actual. */
export const FORECAST_LINES = ['predicted', 'actual'] as const;
export type ForecastLine = (typeof FORECAST_LINES)[number];

/** Legend names of the forecast lines, as the owner wrote them. */
export const FORECAST_LABEL: Record<ForecastLine, string> = { predicted: 'Predicted', actual: 'Actual' };

/**
 * Actual is the archived stella window mean, so it keeps the stella colour and stella's solid line
 * and circle (the trace is stella's wherever it is drawn). Predicted is a forecast: its own token
 * (`plot.predicted`, a vermilion that is ≥ 40 ΔE00 from stella's cobalt in every simulated
 * dichromacy), a dashed line and a marker no series uses.
 */
const FORECAST_SHAPE: Record<ForecastLine, { dash: SeriesStyle['line']['dash']; symbol: string; width: number }> = {
  predicted: { dash: 'dash', symbol: 'triangle-down', width: 2 },
  actual: { dash: 'solid', symbol: 'circle', width: 2 },
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

/** Axis override on top of the themed axis: `title` (and its `font`) and `tickfont` merge key by key. */
function mergeAxis(base: PlotAxis, over: PlotAxis | undefined): PlotAxis {
  if (!over) return base;
  const merged: PlotAxis = { ...base, ...over };
  if (base.title || over.title)
    merged.title = { ...base.title, ...over.title, font: { ...base.title?.font, ...over.title?.font } };
  if (base.tickfont || over.tickfont) merged.tickfont = { ...base.tickfont, ...over.tickfont };
  return merged;
}

/** True when the viewport matches NARROW_CHART_QUERY. False wherever that cannot be asked (tests, SSR). */
function viewportIsNarrow(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  const mq = globalThis.matchMedia(NARROW_CHART_QUERY);
  // A real MediaQueryList echoes the query it was asked; a blanket test stub does not.
  return Boolean(mq) && mq.media === NARROW_CHART_QUERY && mq.matches === true;
}

/** A partial font over a themed one: the keys given win, the themed family, size, colour and weight stay. */
const mergeFont = (base: unknown, over: unknown): PlotFont => ({ ...(base as PlotFont | undefined), ...(over as PlotFont | undefined) });

/**
 * A complete Plotly layout for the theme.
 *
 * `overrides` are merged, not swapped in: axes key by key (with `title`, `title.font` and
 * `tickfont` one level deeper, so passing only `title.text` keeps the themed title font and
 * standoff), and `font`, `margin`, `legend`, `hoverlabel`, `title` and `modebar` key by key, with
 * the `font` inside `title`, `legend` and `hoverlabel` one level deeper too.
 * Everything else (height, shapes, annotations, hovermode, …) replaces the themed value.
 *
 * On a narrow chart (`options.narrow`, default: the viewport matches NARROW_CHART_QUERY) the
 * legend is anchored to the bottom of the figure, where Plotly reserves room for it.
 */
export function plotLayout(theme: ThemeName, overrides: PlotLayoutOverrides = {}, options: PlotLayoutOptions = {}): PlotLayout {
  const t = themes[theme];
  const { xaxis, yaxis, font: fontOver, margin, legend, hoverlabel, title, modebar, ...rest } = overrides;
  const narrow = options.narrow ?? viewportIsNarrow();
  const base: PlotLayout = {
    font: { family: font.sans, size: typeScale.xs[0], color: t.color.textMuted },
    autosize: true,
    paper_bgcolor: t.plot.paper,
    plot_bgcolor: t.plot.plot,
    colorway: seriesColorway(theme),
    margin: { l: 56, r: 16, t: 36, b: 44, pad: 0 },
    xaxis: baseAxis(theme),
    yaxis: baseAxis(theme),
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
  const mergedLegend: Record<string, unknown> = { ...base.legend, ...legend, font: mergeFont(base.legend.font, legend?.font) };
  return {
    ...base,
    ...rest,
    font: { ...base.font, ...fontOver },
    margin: { ...base.margin, ...margin },
    xaxis: mergeAxis(base.xaxis, xaxis),
    yaxis: mergeAxis(base.yaxis, yaxis),
    // Narrow: under the plot, anchored to the figure (not the plot area), so Plotly reserves the
    // room below the axis title however many rows the legend wraps to.
    legend: narrow ? { ...mergedLegend, yref: 'container', y: 0, yanchor: 'bottom' } : mergedLegend,
    hoverlabel: { ...base.hoverlabel, ...hoverlabel, font: mergeFont(base.hoverlabel.font, hoverlabel?.font) },
    title: { ...base.title, ...title, font: mergeFont(base.title?.font, title?.font) },
    modebar: { ...base.modebar, ...modebar },
  };
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
 * Line + marker style for a forecast-chart line (D-026), the counterpart of `seriesStyle`:
 * `forecastStyle('actual', theme)` (stella colour, solid, circles) and `forecastStyle('predicted', theme)`
 * (`plot.predicted`, dashed, downward triangles). The legend name is in `name`.
 */
export function forecastStyle(line: ForecastLine, theme: ThemeName): SeriesStyle {
  const t = themes[theme];
  const color = line === 'actual' ? t.series.stella : t.plot.predicted;
  const shape = FORECAST_SHAPE[line];
  return {
    name: FORECAST_LABEL[line],
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

/**
 * A range with no samples (gray = unsampled, everywhere), as two shapes: spread them into `shapes`.
 *
 * 1. `unsampled`: the gray block. Layer "below", so it sits under the grid and the data like the
 *    analysis windows. List it BEFORE any `windowShape` it overlaps, so the window's dotted edge is
 *    drawn on top of the gray and keeps its contrast.
 * 2. `unsampled label`: a transparent, unstroked rect over the same range that carries the word.
 *    Plotly draws a shape that is not "above" and refers to the paper under the grid, label and all,
 *    so a grid line would cut through the word; this one is "above". It adds nothing but the word
 *    over the data, and the top layer takes no pointer events, so hover still reaches the traces.
 *
 * The label runs up the inside of the block's left edge. Plotly clips shape labels at the plot
 * edge, so a horizontal word is cut as soon as the block is narrower than the word (46px at 390px
 * wide); vertical text needs one line height. Plotly places the text before it rotates it, so the
 * padding is what moves the rotated glyphs inside the block: 12px puts the baseline 12px in and
 * the tallest ascender 4px in.
 */
export function unsampledShapes(range: readonly [number, number], theme: ThemeName): PlotShape[] {
  const t = themes[theme];
  const span = { type: 'rect', xref: 'x', yref: 'paper', x0: range[0], x1: range[1], y0: 0, y1: 1 } as const;
  return [
    {
      ...span,
      fillcolor: withAlpha(t.plot.unsampled, t.plot.unsampledAlpha),
      line: { width: 0 },
      layer: 'below',
      name: 'unsampled',
    },
    {
      ...span,
      fillcolor: withAlpha(t.plot.unsampled, 0),
      line: { width: 0 },
      layer: 'above',
      name: 'unsampled label',
      label: {
        text: 'unsampled',
        textangle: -90,
        textposition: 'bottom left',
        padding: 12,
        font: { family: font.sans, size: typeScale['2xs'][0], color: t.color.textMuted },
      },
    },
  ];
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
