// Pure data -> props logic for the transport view (tested without Plotly / WebGL).
import {
  axisTitle,
  formatNumber,
  formatSigned,
  formatWindow,
  meanSegment,
  plotLayout,
  seriesStyle,
  uncertaintyBand,
  windowShape,
  type PlotLayout,
  type ThemeName,
} from '../../design';
import { isLive, type LiveSample, type LiveState } from '../../lib/liveStatus';
import type { TransportArtifact, TransportTrace, TransportWindow, Window } from './types';

/** Display units for the archive normalisation in `artifact.units` ("Q_i/Q_gB,i vs t v_th,i/a"). */
export const FLUX_UNIT = 'Q_{gB,i}';
export const TIME_UNIT = 'a/v_{th,i}';
/** Decimals for window means and their stderr in tables (PRD prints the late means to 3 dp). */
export const MEAN_DECIMALS = 3;

/** The analysis windows drawn on the bean plot (PRD: 200–300, 300–400; fixtures: 1500–1900). */
export const PLOT_WINDOWS: readonly Window[] = [
  [200, 300],
  [300, 400],
  [1500, 1900],
];

export type PlotTrace = Record<string, unknown>;

export interface WindowDetail {
  /** stderr is a small-N estimate (biased low) — render with "≈". */
  stderrApproximate: boolean;
  /** The stationarity verdict is indicative only (small N_eff or fallback tau). */
  stationarityIndicative: boolean;
  /** A test result the backend reports as indicative only (e.g. 'stationary' while the verdict is undecidable). */
  indicativeResult: string | null;
  /** Effective sample count, when the backend reports one. */
  nEff: number | null;
  /** Why a saturated claim is not allowed, in the backend's words. */
  claimReason: string | null;
  /** Why stderr is not finite, if so. */
  stderrNotFiniteReason: string | null;
  /** Window-specific finding (before "Method:"). */
  finding: string;
  /** Shared method statement (after "Method:"). */
  method: string;
}

/** Read the qualifiers the backend writes into `stationarityDetail` (the contract has no separate fields). */
export function parseWindowDetail(detail: string | undefined): WindowDetail {
  const text = detail ?? '';
  const cut = text.indexOf('Method:');
  const finding = (cut >= 0 ? text.slice(0, cut) : text).trim();
  const method = cut >= 0 ? text.slice(cut + 'Method:'.length).trim() : '';
  const nEffMatch = /N_eff\s*[~=]\s*([0-9]+(?:\.[0-9]+)?)/.exec(finding);
  const reason = /Saturated claim NOT allowed:\s*(.*?)\.?\s*$/.exec(finding);
  const notFinite = /stderr not finite \(([^)]*)\)/.exec(finding);
  const indicative = /test result '([^']+)' is indicative only/.exec(finding);
  return {
    stderrApproximate: /APPROXIMATE|stderr\s*~/.test(finding),
    stationarityIndicative: /indicative/i.test(finding),
    indicativeResult: indicative?.[1] ?? null,
    nEff: nEffMatch ? Number(nEffMatch[1]) : null,
    claimReason: reason?.[1]?.trim() || null,
    stderrNotFiniteReason: notFinite?.[1] ?? null,
    finding,
    method,
  };
}

export function traceCode(a: TransportArtifact, traceId: string): string {
  return a.traces.find((t) => t.id === traceId)?.code ?? traceId;
}

const sameWindow = (x: readonly number[], y: readonly number[]) => x[0] === y[0] && x[1] === y[1];

export function findWindow(a: TransportArtifact, code: string, window: readonly number[]): TransportWindow | undefined {
  return a.windows.find((w) => traceCode(a, w.traceId) === code && sameWindow(w.window, window));
}

export interface WindowRow {
  key: string;
  code: string;
  windowText: string;
  window: Window;
  covered: boolean;
  coverageText: string;
  mean: number | null;
  meanText: string;
  stderrText: string;
  stderrSpoken: string;
  nEffText: string;
  stationarityText: string;
  claimAllowed: boolean;
  claimText: 'Claim allowed' | 'Claim not allowed';
  claimReason: string | null;
  detail: WindowDetail;
}

export function stationarityText(w: TransportWindow, d: WindowDetail): string {
  if (!w.covered) return 'Not covered';
  if (w.stationary === null) {
    return d.indicativeResult ? `Undecidable (test indicates ${d.indicativeResult}; indicative only)` : 'Undecidable';
  }
  const base = w.stationary ? 'Stationary' : 'Not stationary';
  return d.stationarityIndicative ? `${base} (indicative)` : base;
}

export function stderrText(w: TransportWindow, d: WindowDetail, decimals = MEAN_DECIMALS): { text: string; spoken: string } {
  if (w.stderr === null || !Number.isFinite(w.stderr)) return { text: '—', spoken: 'not finite' };
  const v = formatNumber(w.stderr, decimals);
  return d.stderrApproximate ? { text: `≈${v}`, spoken: `approximately ${v}, a lower bound` } : { text: v, spoken: v };
}

export function windowRows(a: TransportArtifact): WindowRow[] {
  return a.windows.map((w) => {
    const d = parseWindowDetail(w.stationarityDetail);
    const code = traceCode(a, w.traceId);
    const trace = a.traces.find((t) => t.id === w.traceId);
    const se = stderrText(w, d);
    const coverageText = w.covered
      ? `Covered · ${w.nSamples} samples`
      : `Not covered${trace ? ` (trace ends at t = ${formatTrim(trace.t[trace.t.length - 1])})` : ''}`;
    return {
      key: `${w.traceId}:${w.window[0]}-${w.window[1]}`,
      code,
      window: w.window,
      windowText: formatWindow(w.window),
      covered: w.covered,
      coverageText,
      mean: w.mean,
      meanText: formatNumber(w.mean, MEAN_DECIMALS),
      stderrText: se.text,
      stderrSpoken: se.spoken,
      nEffText: d.nEff === null ? '—' : `${d.stderrApproximate || d.stationarityIndicative ? '≈' : ''}${formatNumber(d.nEff, 1)}`,
      stationarityText: stationarityText(w, d),
      claimAllowed: w.saturatedClaimAllowed,
      claimText: w.saturatedClaimAllowed ? 'Claim allowed' : 'Claim not allowed',
      claimReason: w.saturatedClaimAllowed ? null : (d.claimReason ?? (w.covered ? null : 'window not covered')),
      detail: d,
    };
  });
}

const formatTrim = (v: number | undefined) => (v === undefined ? '—' : String(Number(v.toFixed(3))));

export interface ClaimSummary {
  total: number;
  allowed: number;
  /** Range of reported N_eff over windows that report one. */
  nEffMin: number | null;
  nEffMax: number | null;
}

export function claimSummary(a: TransportArtifact): ClaimSummary {
  const ns = a.windows.map((w) => parseWindowDetail(w.stationarityDetail).nEff).filter((n): n is number => n !== null);
  return {
    total: a.windows.length,
    allowed: a.windows.filter((w) => w.saturatedClaimAllowed).length,
    nEffMin: ns.length ? Math.min(...ns) : null,
    nEffMax: ns.length ? Math.max(...ns) : null,
  };
}

export interface LateComparison {
  stella: TransportWindow;
  gene: TransportWindow;
  delta: number;
  sameWindow: boolean;
}

/** stella vs GENE on their late (≥ 1500) covered windows — shown so the UI never implies they agree. */
export function lateComparison(a: TransportArtifact): LateComparison | null {
  const late = (code: string) =>
    a.windows
      .filter((w) => traceCode(a, w.traceId) === code && w.covered && w.mean !== null && w.window[0] >= 1500)
      .sort((x, y) => y.window[1] - y.window[0] - (x.window[1] - x.window[0]))[0];
  const stella = late('stella');
  const gene = late('GENE');
  if (!stella || !gene || stella.mean === null || gene.mean === null) return null;
  return { stella, gene, delta: gene.mean - stella.mean, sameWindow: sameWindow(stella.window, gene.window) };
}

export interface Discrepancy {
  value: number;
  window: Window;
  rows: { code: 'stella' | 'GENE'; archive: number; delta: number; deltaText: string; ratioText: string; window?: TransportWindow; detail?: WindowDetail }[];
}

export function discrepancy(a: TransportArtifact): Discrepancy {
  const r = a.reducedModalRun;
  const rows = (['stella', 'GENE'] as const).map((code) => {
    const archive = r.archive[code];
    const w = findWindow(a, code, r.window);
    return {
      code,
      archive,
      delta: r.value - archive,
      deltaText: formatSigned(r.value - archive, 2),
      ratioText: `${formatNumber(r.value / archive, 2)}×`,
      window: w,
      detail: w ? parseWindowDetail(w.stationarityDetail) : undefined,
    };
  });
  return { value: r.value, window: r.window, rows };
}

/** Plain-language state of an archive reference window (used in the discrepancy card). */
export function referenceWindowNote(w: TransportWindow | undefined, d: WindowDetail | undefined): string {
  if (!w || !d) return 'No archive window statistics recorded for this window.';
  const parts: string[] = [];
  if (!w.covered) parts.push('not covered');
  else if (w.stationary === false) parts.push(d.stationarityIndicative ? 'non-stationary (indicative)' : 'non-stationary');
  else if (w.stationary === null) parts.push('not shown stationary (stationarity test undecidable)');
  else parts.push(d.stationarityIndicative ? 'stationary (indicative only)' : 'stationary');
  if (w.stderr === null) parts.push('sampling uncertainty not finite');
  else if (d.stderrApproximate) parts.push('sampling uncertainty approximate');
  return parts.join('; ');
}

/** GX bean samples to overlay — only when the API itself reports mode "live" and has samples. */
export function liveGxSamples(state: LiveState): LiveSample[] | null {
  if (!isLive(state) || state.status !== 'ready') return null;
  const bean = state.data.workers.find((w) => w.tube === 'bean');
  return bean && bean.samples.length > 0 ? bean.samples : null;
}

export const GX_LIVE_NAME = 'GX · LIVE (archive units)';

function traceLine(trace: TransportTrace, theme: ThemeName): PlotTrace {
  const s = seriesStyle(trace.code, theme);
  return {
    type: 'scatter',
    mode: 'lines',
    x: trace.t,
    y: trace.Q,
    name: `${s.name} (archive, ${trace.tube})`,
    line: s.line,
    hovertemplate: `${s.name}: %{y:.3f}<extra></extra>`,
  };
}

export interface TransportFigure {
  data: PlotTrace[];
  layout: PlotLayout;
  summary: string;
  hasGx: boolean;
}

export function buildTransportFigure(a: TransportArtifact, theme: ThemeName, gx: LiveSample[] | null): TransportFigure {
  const bean = a.traces.filter((t) => t.tube === 'bean' && (t.code === 'stella' || t.code === 'GENE'));
  const data: PlotTrace[] = [];
  const shapes = PLOT_WINDOWS.map((w) => windowShape(w, theme, formatWindow(w)));

  // Window means (with ±1σ band only where the backend reports a finite stderr; never invent one).
  for (const tr of bean) {
    for (const w of a.windows.filter((x) => x.traceId === tr.id && x.covered && x.mean !== null)) {
      const mean = w.mean as number;
      if (w.stderr !== null && Number.isFinite(w.stderr)) {
        data.push(uncertaintyBand([w.window[0], w.window[1]], [mean, mean], w.stderr, tr.code as 'stella' | 'GENE', theme));
      }
      shapes.push(meanSegment(w.window, mean, tr.code as 'stella' | 'GENE', theme));
    }
  }
  for (const tr of bean) data.push(traceLine(tr, theme));

  const hasGx = gx !== null && gx.length > 0;
  if (hasGx && gx) {
    const s = seriesStyle('GX', theme);
    data.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: gx.map((p) => p.t),
      y: gx.map((p) => p.Q),
      name: GX_LIVE_NAME,
      line: s.line,
      marker: { ...s.marker, size: 5 },
      hovertemplate: 'GX (live): %{y:.3f}<extra></extra>',
    });
  }

  const tMax = Math.max(...bean.map((t) => t.t[t.t.length - 1] ?? 0), ...(gx ?? []).map((p) => p.t));
  const layout = plotLayout(theme, {
    height: 360,
    xaxis: { title: { text: axisTitle('Time t', TIME_UNIT) }, range: [0, Math.ceil(tMax / 50) * 50] },
    yaxis: { title: { text: axisTitle('Ion heat flux Q_i', FLUX_UNIT) }, rangemode: 'tozero' },
    shapes,
  });

  const parts = bean.map((t) => {
    const end = t.t[t.t.length - 1];
    return `${t.code} bean trace (archive): ${t.t.length} samples from t = 0 to ${formatTrim(end)}`;
  });
  const means = a.windows
    .filter((w) => w.covered && w.mean !== null && bean.some((b) => b.id === w.traceId))
    .map((w) => `${traceCode(a, w.traceId)} ${formatWindow(w.window)}: ${formatNumber(w.mean, MEAN_DECIMALS)}`);
  const summary =
    `${parts.join('; ')}. Window means (Q in Q_gB,i): ${means.join(', ')}. ` +
    `Shaded windows: ${PLOT_WINDOWS.map((w) => formatWindow(w)).join(', ')}. ` +
    (hasGx && gx
      ? `GX live bean samples overlaid in archive units: ${gx.length} samples up to t = ${formatTrim(gx[gx.length - 1]?.t)}.`
      : 'No GX series: the live API does not report a live run.');
  return { data, layout, summary, hasGx };
}
