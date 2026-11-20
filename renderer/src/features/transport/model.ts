// Pure data -> props logic for the transport view (tested without Plotly / WebGL).
import {
  axisTitle,
  font,
  formatNumber,
  formatSigned,
  formatWindow,
  meanSegment,
  plotLayout,
  seriesStyle,
  themes,
  typeScale,
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

export type PlotTrace = Record<string, unknown>;

export interface WindowDetail {
  /** stderr is a small-N estimate (biased low) — render with "≈". */
  stderrApproximate: boolean;
  /** The stationarity verdict is indicative only (small N_eff or fallback tau). */
  stationarityIndicative: boolean;
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
  return {
    stderrApproximate: /APPROXIMATE|stderr\s*~/.test(finding),
    stationarityIndicative: /indicative/i.test(finding),
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

/** The traces the bean plot draws and badges: archived stella and GENE on the bean tube, nothing else. */
export function beanArchiveTraces(a: TransportArtifact): TransportTrace[] {
  return a.traces.filter((t) => t.tube === 'bean' && (t.code === 'stella' || t.code === 'GENE'));
}

const sameWindow = (x: readonly number[], y: readonly number[]) => x[0] === y[0] && x[1] === y[1];

export function findWindow(a: TransportArtifact, code: string, window: readonly number[]): TransportWindow | undefined {
  return a.windows.find((w) => traceCode(a, w.traceId) === code && sameWindow(w.window, window));
}

/**
 * The analysis windows shaded on the bean plot, read from `windows[]` of the plotted traces. A window
 * that lies inside a longer one (GENE's 1500–1893.765, cut short where its trace ends, inside
 * 1500–1900) is drawn as part of that band, not as a second overlapping band.
 */
export function plotWindows(a: TransportArtifact): Window[] {
  const plotted = new Set(beanArchiveTraces(a).map((t) => t.id));
  const unique: Window[] = [];
  for (const w of a.windows) {
    if (plotted.has(w.traceId) && !unique.some((u) => sameWindow(u, w.window))) unique.push(w.window);
  }
  return unique
    .filter((w) => !unique.some((o) => o !== w && o[0] <= w[0] && o[1] >= w[1]))
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
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
  /** The artifact's flag says "allowed" but the row itself does not meet the gate. */
  claimInconsistent: boolean;
  detail: WindowDetail;
}

/**
 * Verdict word for the stationarity column. `null` is "Undecidable" and nothing more (interface.md §2
 * item 4): the backend's indicative test result stays in the collapsed detail, never in the verdict.
 */
export function stationarityText(w: TransportWindow, d: WindowDetail): string {
  if (!w.covered) return 'Not covered';
  if (w.stationary === null) return 'Undecidable';
  const base = w.stationary ? 'Stationary' : 'Not stationary';
  return d.stationarityIndicative ? `${base} (indicative)` : base;
}

export function stderrText(w: TransportWindow, d: WindowDetail, decimals = MEAN_DECIMALS): { text: string; spoken: string } {
  if (w.stderr === null || !Number.isFinite(w.stderr)) return { text: '—', spoken: 'not finite' };
  const v = formatNumber(w.stderr, decimals);
  return d.stderrApproximate ? { text: `≈${v}`, spoken: `approximately ${v}, a lower bound` } : { text: v, spoken: v };
}

export interface ClaimVerdict {
  allowed: boolean;
  reason: string | null;
  inconsistent: boolean;
}

/**
 * Saturated-agreement verdict for one row. The artifact's flag is necessary but not sufficient: a row
 * shown as "allowed" must itself be covered, stationary and carry a finite stderr (D-017), so an
 * inconsistent artifact can never put "Claim allowed" beside "Undecidable" or "—".
 */
export function claimVerdict(w: TransportWindow, d: WindowDetail): ClaimVerdict {
  const gaps: string[] = [];
  if (!w.covered) gaps.push('window not covered');
  else {
    if (w.stationary === null) gaps.push('stationarity undecidable');
    else if (!w.stationary) gaps.push('not stationary');
    if (w.stderr === null || !Number.isFinite(w.stderr)) gaps.push('sampling uncertainty not finite');
  }
  if (w.saturatedClaimAllowed && gaps.length === 0) return { allowed: true, reason: null, inconsistent: false };
  if (w.saturatedClaimAllowed) {
    return {
      allowed: false,
      inconsistent: true,
      reason: `artifact flag says allowed, but the row does not meet the gate (${gaps.join('; ')})`,
    };
  }
  return { allowed: false, inconsistent: false, reason: d.claimReason ?? (w.covered ? null : 'window not covered') };
}

export function windowRows(a: TransportArtifact): WindowRow[] {
  return a.windows.map((w) => {
    const d = parseWindowDetail(w.stationarityDetail);
    const code = traceCode(a, w.traceId);
    const trace = a.traces.find((t) => t.id === w.traceId);
    const se = stderrText(w, d);
    const verdict = claimVerdict(w, d);
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
      claimAllowed: verdict.allowed,
      claimText: verdict.allowed ? 'Claim allowed' : 'Claim not allowed',
      claimReason: verdict.reason,
      claimInconsistent: verdict.inconsistent,
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
  /** The reason most "not allowed" rows share (stated once, above the table), and how many share it. */
  commonReason: string | null;
  commonReasonCount: number;
}

export function claimSummary(a: TransportArtifact): ClaimSummary {
  const rows = windowRows(a);
  const ns = rows.map((r) => r.detail.nEff).filter((n): n is number => n !== null);
  const counts = new Map<string, number>();
  for (const r of rows) if (!r.claimAllowed && r.claimReason) counts.set(r.claimReason, (counts.get(r.claimReason) ?? 0) + 1);
  let commonReason: string | null = null;
  let commonReasonCount = 0;
  for (const [reason, n] of counts) {
    if (n > commonReasonCount) {
      commonReason = reason;
      commonReasonCount = n;
    }
  }
  // A reason held by a single row is not "common": it stays on that row.
  if (commonReasonCount < 2) {
    commonReason = null;
    commonReasonCount = 0;
  }
  return {
    total: rows.length,
    allowed: rows.filter((r) => r.claimAllowed).length,
    nEffMin: ns.length ? Math.min(...ns) : null,
    nEffMax: ns.length ? Math.max(...ns) : null,
    commonReason,
    commonReasonCount,
  };
}

export interface LateComparison {
  stella: TransportWindow;
  gene: TransportWindow;
  /** stella mean − GENE mean, each on its own window (interface.md §2 item 5: ≈ −0.23). */
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
  return { stella, gene, delta: stella.mean - gene.mean, sameWindow: sameWindow(stella.window, gene.window) };
}

export interface Discrepancy {
  value: number;
  window: Window;
  rows: { code: 'stella' | 'GENE'; archive: number; delta: number; deltaText: string; ratioText: string; window?: TransportWindow; detail?: WindowDetail }[];
}

/** Reduced Modal run minus each archive mean on the same window (the sign is "reduced run − archive"). */
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

export interface FluxClip {
  /** Upper end of the flux axis. */
  top: number;
  /** Series whose peak lies above `top`, with the peak and where it is. */
  clipped: { code: string; peak: number; t: number }[];
}

const ceilHalf = (v: number) => Math.ceil(v * 2 - 1e-9) / 2;

/**
 * Flux-axis range for the bean plot. An early peak before the first analysis window (the stella
 * start-up transient, 8.25 at t ≈ 133) would otherwise set the scale and squeeze the stella–GENE gap
 * that the view is about into a few pixels. The axis is sized to the analysed region instead
 * (everything from the first window on, plus headroom) and anything above it is reported, never
 * silently dropped. Live GX samples are never clipped: the axis grows to hold them.
 * Returns null when nothing would be clipped (the plot then autoranges from zero).
 */
export function fluxAxisClip(traces: readonly TransportTrace[], windows: readonly Window[], gx: readonly LiveSample[] | null): FluxClip | null {
  if (windows.length === 0 || traces.length === 0) return null;
  const tStart = Math.min(...windows.map((w) => w[0]));
  let analysed = 0;
  for (const tr of traces) tr.t.forEach((t, i) => t >= tStart && (analysed = Math.max(analysed, tr.Q[i] ?? 0)));
  if (analysed <= 0) return null;
  let top = ceilHalf(analysed * 1.4);
  if (gx && gx.length > 0) top = Math.max(top, ceilHalf(Math.max(...gx.map((p) => p.Q)) * 1.1));
  const clipped = traces
    .map((tr) => {
      let iMax = 0;
      tr.Q.forEach((q, i) => q > (tr.Q[iMax] ?? 0) && (iMax = i));
      return { code: tr.code as string, peak: tr.Q[iMax] ?? 0, t: tr.t[iMax] ?? 0 };
    })
    .filter((c) => c.peak > top);
  return clipped.length > 0 ? { top, clipped } : null;
}

export interface TransportFigure {
  data: PlotTrace[];
  layout: PlotLayout;
  summary: string;
  hasGx: boolean;
  /** The shaded analysis windows, in plot order. */
  windows: Window[];
}

export function buildTransportFigure(a: TransportArtifact, theme: ThemeName, gx: LiveSample[] | null): TransportFigure {
  const bean = beanArchiveTraces(a);
  const data: PlotTrace[] = [];
  const windows = plotWindows(a);
  // Adjacent bands (200–300, 300–400) overprint their labels on a narrow plot: alternate top and bottom.
  const shapes = windows.map((w, i) => {
    const s = windowShape(w, theme, formatWindow(w));
    return s.label && i % 2 === 1 ? { ...s, label: { ...s.label, textposition: 'bottom left' } } : s;
  });

  // Window means (with ±1σ band only where the backend reports a finite stderr; never invent one).
  for (const tr of bean) {
    for (const w of a.windows.filter((x) => x.traceId === tr.id && x.covered && x.mean !== null)) {
      const mean = w.mean as number;
      if (w.stderr !== null && Number.isFinite(w.stderr)) {
        const band = uncertaintyBand([w.window[0], w.window[1]], [mean, mean], w.stderr, tr.code as 'stella' | 'GENE', theme);
        // A stderr the backend flags approximate is a lower bound: the band says so wherever it is named.
        const approximate = parseWindowDetail(w.stationarityDetail).stderrApproximate;
        data.push(approximate ? { ...band, name: `${band.name} (approximate, lower bound)` } : band);
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

  const clip = fluxAxisClip(bean, windows, hasGx ? gx : null);
  const t = themes[theme];
  const annotations = (clip?.clipped ?? []).map((c) => ({
    xref: 'x',
    yref: 'paper',
    x: c.t,
    y: 1,
    xanchor: 'left',
    yanchor: 'top',
    xshift: 10,
    yshift: -20,
    align: 'left',
    showarrow: false,
    text: `↑ ${c.code} transient peak ${formatNumber(c.peak, 2)} clipped<br>double-click or Autoscale to see it`,
    font: { family: font.sans, size: typeScale['2xs'][0], color: t.color.text },
    // A small plate, so the band edges and grid lines behind it do not run through the words.
    bgcolor: t.plot.paper,
    bordercolor: t.color.border,
    borderwidth: 1,
    borderpad: 3,
  }));

  const tMax = Math.max(...bean.map((tr) => tr.t[tr.t.length - 1] ?? 0), ...(gx ?? []).map((p) => p.t));
  const layout = plotLayout(theme, {
    height: 360,
    xaxis: { title: { text: axisTitle('Time t', TIME_UNIT) }, range: [0, Math.ceil(tMax / 50) * 50] },
    yaxis: {
      title: { text: axisTitle('Ion heat flux Q_i', FLUX_UNIT) },
      ...(clip ? { range: [0, clip.top] as [number, number] } : { rangemode: 'tozero' }),
    },
    shapes,
    annotations,
  });

  const parts = bean.map((tr) => {
    const end = tr.t[tr.t.length - 1];
    return `${tr.code} bean trace (archive): ${tr.t.length} samples from t = 0 to ${formatTrim(end)}`;
  });
  const means = a.windows
    .filter((w) => w.covered && w.mean !== null && bean.some((b) => b.id === w.traceId))
    .map((w) => `${traceCode(a, w.traceId)} ${formatWindow(w.window)}: ${formatNumber(w.mean, MEAN_DECIMALS)}`);
  const anyApproximate = data.some((d) => /lower bound/.test(String(d.name)));
  const summary =
    `${parts.join('; ')}. Window means (Q in Q_gB,i): ${means.join(', ')}. ` +
    `Shaded windows: ${windows.map((w) => formatWindow(w)).join(', ')}. ` +
    (anyApproximate ? 'Shaded ±1σ bands around a mean use the reported stderr, which is approximate (a lower bound). ' : '') +
    (clip
      ? `Flux axis shown from 0 to ${formatTrimHalf(clip.top)}: ` +
        clip.clipped.map((c) => `the ${c.code} peak of ${formatNumber(c.peak, 2)} at t = ${formatTrim(c.t)} is above it`).join('; ') +
        ' (clipped on the plot; double-click the plot or use Autoscale in its toolbar to see it). '
      : '') +
    (hasGx && gx
      ? `GX live bean samples overlaid in archive units: ${gx.length} samples up to t = ${formatTrim(gx[gx.length - 1]?.t)}.`
      : 'No GX series: the live API does not report a live run.');
  return { data, layout, summary, hasGx, windows };
}

const formatTrimHalf = (v: number) => String(Number(v.toFixed(1)));

/** "200–300, 300–400 and 1500–1900" for accessible names. */
export function windowList(windows: readonly Window[]): string {
  const names = windows.map((w) => formatWindow(w));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
}
