// The forecast chart (D-026, F7), in its two metrics (the owner's toggle): heat flux against time, Predicted and
// Actual, and the absolute error |predicted − actual| of both forecasters. Markers represent the means of each
// 50-unit window. Pure: state in, Plotly spec out (tested without Plotly or the DOM).
import {
  FORECAST_LABEL,
  axisTitle,
  font,
  forecastStyle,
  formatNumber,
  formatWindow,
  plotLayout,
  spokenUnit,
  themes,
  typeScale,
  windowShape,
  type ForecastLine,
  type PlotLayout,
  type SeriesStyle,
  type ThemeName,
} from '../../design';
import { percentErrors } from './accuracy';
import {
  FLUX_UNIT,
  FORECASTERS,
  FORECASTER_LABEL,
  TIME_UNIT,
  nextAction,
  plottedWindows,
  windowMidpoints,
  type ForecastArtifact,
  type Forecaster,
  type PlottedWindow,
  type ReplayState,
} from './model';

export type PlotTrace = Record<string, unknown>;

/** The chart's two views (the owner's "Comparison metric" toggle). */
export type ChartMetric = 'flux' | 'error';

/** A run of the chart's visible caption: plain text, or a unit the adapter typesets with `Unit` (DZ3-8). */
export type CaptionPart = string | { unit: string };

/** The caption as words, each unit spoken (`spokenUnit`: "Q gB,i"): what assistive technology reads. */
export function spokenCaption(parts: readonly CaptionPart[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : spokenUnit(p.unit))).join('');
}

export interface ForecastChartSpec {
  data: PlotTrace[];
  layout: PlotLayout;
  /** Accessible name of the figure. */
  label: string;
  /**
   * Text equivalent of what is plotted, units spoken as words: the figure's accessible description. Lists only
   * values already predicted or revealed. Always `spokenCaption(caption)`.
   */
  summary: string;
  /** The same text as shown in the figcaption, with each unit typeset (Q with subscript gB,i), never spelled out. */
  caption: CaptionPart[];
}

const MEAN_DP = 3;

/** What each line is, in words (hover text, summary, accessible name). */
export function lineMeaning(line: ForecastLine, f: Forecaster): string {
  return line === 'predicted' ? `${f} forecast` : 'archived observed window mean';
}

/**
 * A line with nothing drawn yet is one null point: Plotly leaves a trace without points out of the legend,
 * and a null point draws nothing but keeps the line, with its marker, named in the legend.
 */
const NOTHING_YET = { x: [null], y: [null], window: [null] };

/** Smallest flux span shown (Q_gB,i), so one value does not fill the axis with identical tick labels. */
const MIN_SPAN = 0.1;
/** Smallest absolute-error axis shown (Q_gB,i). */
const MIN_ERR_TOP = 0.01;

/**
 * The flux axis range, from the drawn values only (it never hints at a hidden one): their min–max, at least
 * MIN_SPAN wide, with room above for the current-window label. [0, 1] while nothing is drawn.
 */
export function fluxRange(drawn: readonly number[]): [number, number] {
  if (drawn.length === 0) return [0, 1];
  const lo = Math.min(...drawn);
  const hi = Math.max(...drawn);
  const span = Math.max(hi - lo, MIN_SPAN);
  const mid = (lo + hi) / 2;
  return [Math.min(lo, mid - span / 2) - 0.1 * span, Math.max(hi, mid + span / 2) + 0.25 * span];
}

/**
 * The absolute-error axis range: from 0 to a quarter above the largest drawn |e| (room for the current-window
 * label), at least MIN_ERR_TOP. From the drawn values only, like `fluxRange`; [0, 1] while nothing is drawn.
 */
export function absErrorRange(drawn: readonly number[]): [number, number] {
  if (drawn.length === 0) return [0, 1];
  return [0, Math.max(...drawn, MIN_ERR_TOP) * 1.25];
}

/**
 * Style of a forecaster's absolute-error line. Both are errors of a forecast, so both take Predicted's token
 * colour at full opacity (≥ 3:1 on the plot, never a series colour they are not): the forecaster drawn as
 * Predicted keeps Predicted's dashed line and downward triangle, the other is dotted with squares.
 */
export function errorLineStyle(fc: Forecaster, selected: Forecaster, theme: ThemeName): SeriesStyle {
  const p = forecastStyle('predicted', theme);
  const name = FORECASTER_LABEL[fc];
  return fc === selected ? { ...p, name } : { name, line: { ...p.line, dash: 'dot' }, marker: { ...p.marker, symbol: 'square' } };
}

/** One window series as a Plotly trace: the style's line, one marker per window at its midpoint, hover text. */
function windowTrace(style: SeriesStyle, ws: readonly PlottedWindow[], hover: string, dp: number): PlotTrace {
  const pts = ws.length > 0 ? windowMidpoints(ws) : NOTHING_YET;
  return {
    type: 'scatter',
    mode: 'lines+markers',
    name: style.name,
    x: pts.x,
    y: pts.y,
    connectgaps: false,
    line: style.line,
    // One marker per window, at its midpoint: the line's shape (dash) and the marker both tell the lines apart.
    // Opacity is explicit: with per-point sizes Plotly would default to a bubble chart's 0.7.
    marker: {
      ...style.marker,
      opacity: 1,
      size: pts.x.map((x) => (x !== null || !ws.length ? style.marker.size : 0)),
      line: { ...style.marker.line, width: pts.x.map((x) => (x !== null || !ws.length ? style.marker.line.width : 0)) },
    },
    customdata: pts.window,
    hovertemplate: `${hover}, t %{customdata}: %{y:.${dp}f}<extra></extra>`,
    showlegend: true,
  };
}

function trace(line: ForecastLine, ws: readonly PlottedWindow[], f: Forecaster, theme: ThemeName): PlotTrace {
  const style = forecastStyle(line, theme);
  const result = windowTrace(style, ws, `${style.name} (${lineMeaning(line, f)})`, MEAN_DP);
  result.line = { ...style.line, dash: 'solid', shape: 'spline', smoothing: 0.55 };
  return result;
}

const list = (ws: readonly PlottedWindow[], dp: number) =>
  ws.map((w) => `${formatWindow(w.window)} ${formatNumber(w.value, dp)}`).join(', ');

/** The time axis (the replay's windows, known in advance) and the current window, shared by both metrics. */
function frame(a: ForecastArtifact, s: ReplayState) {
  const n = a.steps.length;
  const t0 = a.steps[0]?.window[0] ?? a.initWindow[1];
  const t1 = a.steps[n - 1]?.window[1] ?? t0;
  const current = nextAction(s, n) === 'done' ? null : a.steps[s.index];
  return { n, t0, t1, span: formatWindow([t0, t1]), current };
}

/** Layout shared by both metrics: time axis, the current-window band, closest-point hover, an empty-state note. */
function layoutFor(
  a: ForecastArtifact,
  s: ReplayState,
  theme: ThemeName,
  yTitle: string,
  yRange: [number, number],
  tickformat: string,
  emptyNote: string | null,
): PlotLayout {
  const { t0, t1, current } = frame(a, s);
  const t = themes[theme];
  return plotLayout(theme, {
    showlegend: true,
    // Each window's value is a step (three points): the closest point, not every point at one time.
    hovermode: 'closest',
    xaxis: { title: { text: axisTitle('Time t', TIME_UNIT) }, range: [t0, t1] },
    yaxis: {
      title: { text: axisTitle(yTitle, FLUX_UNIT) },
      range: yRange,
      ...(emptyNote ? { showticklabels: false } : { tickformat }),
    },
    shapes: current ? [windowShape(current.window, theme, 'current window')] : [],
    annotations: emptyNote
      ? [
          {
            xref: 'paper',
            yref: 'paper',
            x: 0.5,
            y: 0.5,
            showarrow: false,
            text: emptyNote,
            font: { family: font.sans, size: typeScale.sm[0], color: t.color.textMuted },
          },
        ]
      : [],
  });
}

/**
 * Heat flux for replay state `s` with forecaster `f` as Predicted. Both traces are always present (so the
 * legend names both lines), but each holds only the windows `plottedWindows` allows: nothing (one null point) before Predict,
 * the forecast after Predict, the observed mean only after Reveal. The time axis spans the replay's windows
 * (known in advance); the flux axis is set from the plotted values only (`fluxRange`), so it never hints at a hidden one.
 * The overview (every saved window) is the complete state (`completeState`).
 */
export function forecastChartSpec(a: ForecastArtifact, s: ReplayState, f: Forecaster, theme: ThemeName): ForecastChartSpec {
  const { n, span } = frame(a, s);
  const { predicted, actual } = plottedWindows(a.steps, s, f);
  const empty = predicted.length === 0 && actual.length === 0;

  const layout = layoutFor(
    a,
    s,
    theme,
    'Ion heat flux Q_i',
    fluxRange([...predicted, ...actual].map((w) => w.value)),
    '.2f',
    empty ? 'No points yet' : null,
  );

  // The accessible name and description speak units as words (spokenUnit: "Q gB,i"), as the statistics' names
  // do; the screen-reader caption typesets them (DZ3-8). Never raw "_" markup in either (FC-R5).
  const label =
    `Chart: ion heat flux ${spokenUnit('Q_i')} in ${spokenUnit(FLUX_UNIT)} against time t in ${spokenUnit(TIME_UNIT)}, ${span}, ` +
    `${FORECAST_LABEL.predicted} (${lineMeaning('predicted', f)}) ` +
    `and ${FORECAST_LABEL.actual} (${lineMeaning('actual', f)}) for the stella bean trace, points at the centres of each ${formatNumber(a.windowWidth, 0)}-unit window`;

  const caption: CaptionPart[] = empty
    ? [
        `Nothing plotted yet. ${FORECAST_LABEL.predicted} (${lineMeaning('predicted', f)}) appears for a window after Predict, ` +
          `${FORECAST_LABEL.actual} (${lineMeaning('actual', f)}) after Reveal; Run to end does both for all ${n} windows from ${span}, in that order.`,
      ]
    : [
        `${FORECAST_LABEL.predicted} (${lineMeaning('predicted', f)}), ${predicted.length} of ${n} windows: ${list(predicted, MEAN_DP)}. ` +
          (actual.length > 0
            ? `${FORECAST_LABEL.actual} (${lineMeaning('actual', f)}), ${actual.length} of ${n} windows: ${list(actual, MEAN_DP)}. `
            : `${FORECAST_LABEL.actual} (${lineMeaning('actual', f)}): none revealed yet. `) +
          (actual.length < n ? 'Later windows are not plotted until they are predicted or revealed. ' : '') +
          'Heat flux in ',
        { unit: FLUX_UNIT },
        '.',
      ];

  return {
    data: [trace('predicted', predicted, f, theme), trace('actual', actual, f, theme)],
    layout,
    label,
    summary: spokenCaption(caption),
    caption,
  };
}

/** Colour of each forecaster in the accuracy charts: persistence takes Predicted's token, frozen the teal series colour. */
export function forecasterColor(f: Forecaster, theme: ThemeName): string {
  return f === 'persistence' ? themes[theme].plot.predicted : themes[theme].series.bean;
}

/**
 * Percentage error per revealed window, 100·|predicted − actual| / actual, both forecasters as grouped bars at the
 * window midpoints, each with a dashed line at its mean (MAPE). Computed here from the archived window means.
 */
export function errorChartSpec(a: ForecastArtifact, s: ReplayState, _f: Forecaster, theme: ThemeName): ForecastChartSpec {
  const { n, span, t0, t1 } = frame(a, s);
  const pct = percentErrors(a.steps, s);
  const shown = pct.persistence.length;
  const empty = shown === 0;
  const top = empty ? 1 : Math.max(...FORECASTERS.flatMap((fc) => pct[fc].map((w) => w.abs)), 0.5) * 1.25;
  const layout = layoutFor(a, s, theme, 'Percentage error |predicted − actual| / actual', [0, top], '.1f', empty ? 'No points yet' : null);
  layout.yaxis = { ...layout.yaxis, title: { ...layout.yaxis.title, text: 'Percentage error (%)' }, ticksuffix: '%' };
  layout.barmode = 'group';
  layout.bargap = 0.35;
  layout.hovermode = 'x unified';
  if (!empty) {
    layout.shapes = [
      ...(layout.shapes ?? []),
      ...FORECASTERS.map((fc) => {
        const m = pct[fc].reduce((sum, w) => sum + w.abs, 0) / shown;
        return { type: 'line' as const, xref: 'x', yref: 'y', x0: t0, x1: t1, y0: m, y1: m, line: { color: forecasterColor(fc, theme), width: 1.5, dash: 'dash' } };
      }),
    ];
  }
  const data = FORECASTERS.map((fc) => ({
    type: 'bar',
    name: `${FORECASTER_LABEL[fc]}`,
    x: pct[fc].length ? pct[fc].map((w) => (w.window[0] + w.window[1]) / 2) : [null],
    y: pct[fc].length ? pct[fc].map((w) => w.abs) : [null],
    customdata: pct[fc].map((w) => formatWindow(w.window)),
    marker: { color: forecasterColor(fc, theme), line: { width: 0 } },
    hovertemplate: `${FORECASTER_LABEL[fc]}: %{y:.2f}%<extra></extra>`,
  }));
  const label =
    `Chart: percentage error of the persistence and frozen forecasts against time t in ${spokenUnit(TIME_UNIT)}, ${span}, ` +
    'one pair of bars per revealed window, dashed lines at each mean';
  const caption: CaptionPart[] = empty
    ? [`Nothing plotted yet. A window's percentage errors appear after its Reveal; Run to end does all ${n} windows from ${span}, in order.`]
    : [
        `Percentage error per window, ${shown} of ${n} windows. ` +
          FORECASTERS.map((fc) => `${FORECASTER_LABEL[fc]}: ${pct[fc].map((w) => `${formatWindow(w.window)} ${w.abs.toFixed(2)}%`).join(', ')}.`).join(' ') +
          (shown < n ? ' Later windows are not plotted until they are revealed.' : ''),
      ];
  return { data, layout, label, summary: spokenCaption(caption), caption };
}

/** The spec of `metric` (the owner's toggle) for state `s`. */
export function chartSpec(metric: ChartMetric, a: ForecastArtifact, s: ReplayState, f: Forecaster, theme: ThemeName): ForecastChartSpec {
  return metric === 'flux' ? forecastChartSpec(a, s, f, theme) : errorChartSpec(a, s, f, theme);
}
