// The forecast replay chart (D-026, F7): heat flux against time, Predicted and Actual, each drawn as a step
// held over its 50-unit window. Pure: state in, Plotly spec out (tested without Plotly or the DOM).
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
  type ThemeName,
} from '../../design';
import {
  FLUX_UNIT,
  TIME_UNIT,
  nextAction,
  plottedWindows,
  stepLine,
  type ForecastArtifact,
  type Forecaster,
  type PlottedWindow,
  type ReplayState,
} from './model';

export type PlotTrace = Record<string, unknown>;

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
const NOTHING_YET = { x: [null], y: [null], mid: [true], window: [null] };

/** Smallest flux span shown (Q_gB,i), so one value does not fill the axis with identical tick labels. */
const MIN_SPAN = 0.1;

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

function trace(line: ForecastLine, ws: readonly PlottedWindow[], f: Forecaster, theme: ThemeName): PlotTrace {
  const style = forecastStyle(line, theme);
  const pts = ws.length > 0 ? stepLine(ws) : NOTHING_YET;
  return {
    type: 'scatter',
    mode: 'lines+markers',
    name: style.name,
    x: pts.x,
    y: pts.y,
    connectgaps: false,
    line: style.line,
    // One marker per window, at its midpoint: the line's shape (dash) and the marker both tell the two apart.
    // Opacity is explicit: with per-point sizes Plotly would default to a bubble chart's 0.7.
    marker: {
      ...style.marker,
      opacity: 1,
      size: pts.mid.map((m) => (m ? style.marker.size : 0)),
      line: { ...style.marker.line, width: pts.mid.map((m) => (m ? style.marker.line.width : 0)) },
    },
    customdata: pts.window,
    hovertemplate: `${style.name} (${lineMeaning(line, f)}), t %{customdata}: %{y:.${MEAN_DP}f}<extra></extra>`,
    showlegend: true,
  };
}

const list = (ws: readonly PlottedWindow[]) => ws.map((w) => `${formatWindow(w.window)} ${formatNumber(w.value, MEAN_DP)}`).join(', ');

/**
 * The chart for replay state `s` with forecaster `f` as Predicted. Both traces are always present (so the
 * legend names both lines), but each holds only the windows `plottedWindows` allows: nothing (one null point) before Predict,
 * the forecast after Predict, the observed mean only after Reveal. The time axis spans the replay's windows
 * (known in advance); the flux axis is set from the plotted values only (`fluxRange`), so it never hints at a hidden one.
 */
export function forecastChartSpec(a: ForecastArtifact, s: ReplayState, f: Forecaster, theme: ThemeName): ForecastChartSpec {
  const n = a.steps.length;
  const t0 = a.steps[0]?.window[0] ?? a.initWindow[1];
  const t1 = a.steps[n - 1]?.window[1] ?? t0;
  const { predicted, actual } = plottedWindows(a.steps, s, f);
  const empty = predicted.length === 0 && actual.length === 0;
  const current = nextAction(s, n) === 'done' ? null : a.steps[s.index];
  const t = themes[theme];

  const layout = plotLayout(theme, {
    height: 320,
    showlegend: true,
    xaxis: { title: { text: axisTitle('Time t', TIME_UNIT) }, range: [t0, t1] },
    yaxis: {
      title: { text: axisTitle('Ion heat flux Q_i', FLUX_UNIT) },
      range: fluxRange([...predicted, ...actual].map((w) => w.value)),
      ...(empty ? { showticklabels: false } : { tickformat: '.2f' }),
    },
    shapes: current ? [windowShape(current.window, theme, 'current window')] : [],
    annotations: empty
      ? [
          {
            xref: 'paper',
            yref: 'paper',
            x: 0.5,
            y: 0.5,
            showarrow: false,
            // Two lines, so it is no wider than before on a phone.
            text: 'Nothing plotted yet: Predict draws the first forecast,<br>Run to end draws all windows',
            font: { family: font.sans, size: typeScale.sm[0], color: t.color.textMuted },
          },
        ]
      : [],
  });

  const span = formatWindow([t0, t1]);
  // The accessible name and description speak units as words (spokenUnit: "Q gB,i"), as the statistics' names
  // do; the visible caption typesets them (DZ3-8). Never raw "_" markup in either (FC-R5).
  const label =
    `Chart: ion heat flux ${spokenUnit('Q_i')} in ${spokenUnit(FLUX_UNIT)} against time t in ${spokenUnit(TIME_UNIT)}, ${span}, ` +
    `${FORECAST_LABEL.predicted} (${lineMeaning('predicted', f)}) ` +
    `and ${FORECAST_LABEL.actual} (${lineMeaning('actual', f)}) for the stella bean trace, each held over its ${formatNumber(a.windowWidth, 0)}-unit window`;

  const caption: CaptionPart[] = empty
    ? [
        `Nothing plotted yet. ${FORECAST_LABEL.predicted} (${lineMeaning('predicted', f)}) appears for a window after Predict, ` +
          `${FORECAST_LABEL.actual} (${lineMeaning('actual', f)}) after Reveal; Run to end does both for all ${n} windows from ${span}, in that order.`,
      ]
    : [
        `${FORECAST_LABEL.predicted} (${lineMeaning('predicted', f)}), ${predicted.length} of ${n} windows: ${list(predicted)}. ` +
          (actual.length > 0
            ? `${FORECAST_LABEL.actual} (${lineMeaning('actual', f)}), ${actual.length} of ${n} windows: ${list(actual)}. `
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
