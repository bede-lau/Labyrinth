// Forecast replay state machine and derived numbers (pure; tested without the DOM).
import { fixtureOutcome, formatNumber, formatSigned, formatWindow, type FixtureCheckData, type Provenance } from '../../design';
import { REPLAY_PILL, modePills, type LiveState } from '../../lib/liveStatus';

/**
 * The text of the replay panel's pill: "Replay · $0" only while the header's mode pills show it (DESIGN.md §5,
 * REPLAY_PILL), otherwise plain "Replay": $0 is not known while GPUs may be billing.
 */
export function replayPillText(s: LiveState): string {
  return modePills(s).some((p) => p.status === REPLAY_PILL.status && p.text === REPLAY_PILL.text) ? REPLAY_PILL.text : 'Replay';
}

export type Window = [number, number];

/** Units as the design system writes them (`_{..}` is a subscript). */
export const FLUX_UNIT = 'Q_{gB,i}';
/** Unit of a squared flux error (MSE and the range of MSE). */
export const FLUX_SQ_UNIT = 'Q_{gB,i}²';
export const TIME_UNIT = 'a/v_{th,i}';

export interface ForecastStep {
  window: Window;
  observed: number;
  persistence: number;
  frozen: number;
  absErrPersistence: number;
  absErrFrozen: number;
}

/**
 * D-026 statistics of e_k = forecast_k − observed_k (predicted minus actual) over n windows. TS mirror of
 * contracts/forecast.schema.json#/$defs/errorStat: with n = 0 every value is null.
 */
export interface ErrorStat {
  n: number;
  /** Mean of e_k² (Q_gB,i²). */
  mse: number | null;
  /** √MSE (Q_gB,i). */
  rmse: number | null;
  /** "Range of MSE": [min, max] of the per-window squared errors e_k² (Q_gB,i²). */
  squaredErrorRange: Window | null;
  /** "Range of errors": [min, max] of the signed e_k (Q_gB,i). */
  errorRange: Window | null;
}

export interface ErrorStats {
  definition: string;
  persistence: ErrorStat;
  frozen: ErrorStat;
}

/** TS mirror of contracts/forecast.schema.json. */
export interface ForecastArtifact {
  schemaVersion: 1;
  traceId: string;
  initWindow: Window;
  windowWidth: number;
  method: string;
  steps: ForecastStep[];
  mae: { persistence: number; frozen: number };
  errorStats: ErrorStats;
  fixtures: FixtureCheckData[];
  provenance: Provenance;
}

/** The two forecasters; the chart draws the selected one as its Predicted line (D-026). */
export const FORECASTERS = ['persistence', 'frozen'] as const;
export type Forecaster = (typeof FORECASTERS)[number];
export const FORECASTER_LABEL: Record<Forecaster, string> = { persistence: 'Persistence', frozen: 'Frozen' };

/**
 * `index` = the step being worked on; `phase` = what has been shown for it.
 *   ready     -> nothing for this step yet (next: Predict)
 *   predicted -> both forecasts shown, observed hidden (next: Reveal)
 *   revealed  -> observed + absolute errors shown (next: Update, which scores the step and moves on)
 * `index === steps.length` means the replay is complete.
 */
export type Phase = 'ready' | 'predicted' | 'revealed';
export interface ReplayState {
  index: number;
  phase: Phase;
}

export const INITIAL: ReplayState = { index: 0, phase: 'ready' };

export function advance(s: ReplayState, nSteps: number): ReplayState {
  if (s.index >= nSteps) return s;
  if (s.phase === 'ready') return { index: s.index, phase: 'predicted' };
  if (s.phase === 'predicted') return { index: s.index, phase: 'revealed' };
  return { index: s.index + 1, phase: 'ready' };
}

export type NextAction = 'predict' | 'reveal' | 'update' | 'done';
export function nextAction(s: ReplayState, nSteps: number): NextAction {
  if (s.index >= nSteps) return 'done';
  return s.phase === 'ready' ? 'predict' : s.phase === 'predicted' ? 'reveal' : 'update';
}

/**
 * "Run to end" (DZ-9): every state from `s` to the completed replay, in order. It is the step button pressed
 * until the replay is complete (`advance`, nothing else), so each remaining window goes Predict → Reveal →
 * Update and its observed mean is shown only in a later state than its forecasts. [] when `s` is complete.
 */
export function runToEndStates(s: ReplayState, nSteps: number): ReplayState[] {
  const out: ReplayState[] = [];
  for (let cur = s; nextAction(cur, nSteps) !== 'done'; ) {
    cur = advance(cur, nSteps);
    out.push(cur);
  }
  return out;
}

/** The state "Run to end" leaves: the last of `runToEndStates` (`s` itself when already complete). */
export function runToEnd(s: ReplayState, nSteps: number): ReplayState {
  return runToEndStates(s, nSteps).at(-1) ?? s;
}

/** Number of steps scored so far (Update commits a step). */
export const scoredCount = (s: ReplayState) => s.index;

export interface StepVisibility {
  forecasts: boolean;
  observed: boolean;
}
export function visibility(s: ReplayState, i: number): StepVisibility {
  if (i < s.index) return { forecasts: true, observed: true };
  if (i > s.index) return { forecasts: false, observed: false };
  return { forecasts: s.phase !== 'ready', observed: s.phase === 'revealed' };
}

/** Running MAE over the scored steps, or null before the first Update. */
export function runningMae(steps: readonly ForecastStep[], scored: number): { persistence: number; frozen: number } | null {
  const done = steps.slice(0, scored);
  if (done.length === 0) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { persistence: mean(done.map((s) => s.absErrPersistence)), frozen: mean(done.map((s) => s.absErrFrozen)) };
}

/* ---- D-026: predicted vs actual -------------------------------------------------------------------- */

/** Signed errors e_k = forecast_k − observed_k (predicted minus actual) of the first `scored` windows. */
export function windowErrors(steps: readonly ForecastStep[], scored: number, f: Forecaster): number[] {
  return steps.slice(0, Math.max(0, scored)).map((st) => st[f] - st.observed);
}

const EMPTY_STAT: ErrorStat = { n: 0, mse: null, rmse: null, squaredErrorRange: null, errorRange: null };

/**
 * MSE, RMSE, range of MSE (min–max of e_k²) and range of errors (min–max of e_k) for forecaster `f` over the
 * windows scored so far: the same timing as the running MAE (a window counts after its Update). The same
 * definition as the artifact's `errorStats` (D-026), so after the last Update it equals that, up to the
 * 7-significant-figure rounding of the steps it is computed from. Every value is null before the first Update.
 */
export function runningErrorStat(steps: readonly ForecastStep[], scored: number, f: Forecaster): ErrorStat {
  const e = windowErrors(steps, scored, f);
  if (e.length === 0) return EMPTY_STAT;
  const sq = e.map((x) => x * x);
  const mse = sq.reduce((acc, x) => acc + x, 0) / sq.length;
  return {
    n: e.length,
    mse,
    rmse: Math.sqrt(mse),
    squaredErrorRange: [Math.min(...sq), Math.max(...sq)],
    errorRange: [Math.min(...e), Math.max(...e)],
  };
}

/* ---- printing the statistics ------------------------------------------------------------------------ */

/**
 * Significant figures of the squared quantities (MSE and the range of MSE, Q_gB,i²). e² spans decades (here
 * 6.32e-6 to 0.0161), so a fixed number of decimals would leave the smallest with one significant figure.
 */
export const SQ_SIG_FIGS = 3;
/** Decimals of the quantities in Q_gB,i (RMSE and the range of errors), as the MAE prints them. */
export const FLUX_ERR_DP = 4;

/** Decimals that print v to `sig` significant figures (6.322e-6 → 8 → "0.00000632", 0.01608 → 4 → "0.0161"). */
export function sigDecimals(v: number, sig: number): number {
  if (!Number.isFinite(v) || v === 0) return sig - 1;
  // The exponent after rounding to `sig` figures, so 0.009996 counts as 0.0100 (3 figures), not 0.00999|6.
  const exp = Number(Math.abs(v).toExponential(sig - 1).split('e')[1]);
  return Math.max(0, sig - 1 - exp);
}

/** The four statistics shown for a forecaster (keys of ErrorStat). */
export type StatKey = 'mse' | 'rmse' | 'squaredErrorRange' | 'errorRange';
export const STAT_NAME: Record<StatKey, string> = { mse: 'MSE', rmse: 'RMSE', squaredErrorRange: 'range of MSE', errorRange: 'range of errors' };

/** Decimals statistic `key` is printed with at value v: SQ_SIG_FIGS significant figures when squared, else FLUX_ERR_DP. */
export function statDecimals(key: StatKey, v: number): number {
  return key === 'mse' || key === 'squaredErrorRange' ? sigDecimals(v, SQ_SIG_FIGS) : FLUX_ERR_DP;
}

/** One value of statistic `key` as the view prints it; the signed errors carry an explicit sign (+0.0676, −0.1268). */
export function formatStat(key: StatKey, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return key === 'errorRange' ? formatSigned(v, statDecimals(key, v)) : formatNumber(v, statDecimals(key, v));
}

/** A statistic as printed: one number, or "min to max" for a range. */
function printedStat(s: ErrorStat, key: StatKey): string {
  const v = s[key];
  if (Array.isArray(v)) return `${formatStat(key, v[0])} to ${formatStat(key, v[1])}`;
  return formatStat(key, v as number | null);
}

/* ---- comparing with errorStats ---------------------------------------------------------------------- */

/**
 * Half a unit in the 7th significant figure of v: the most the artifacts' rounding (7 significant figures,
 * main/ common/io.py) can have moved a written value.
 */
export function half7(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return 0;
  return 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(v))) - 6);
}

/** How far a statistic recomputed from the written steps can lie from main/'s unrounded one (see errorStatTolerance). */
export interface ErrorStatTolerance {
  /** On each e_k, so on either end of the range of errors (Q_gB,i). */
  e: number;
  /** On each e_k², so on either end of the range of MSE (Q_gB,i²). */
  sq: number;
  /** On the MSE (Q_gB,i²). */
  mse: number;
}

/**
 * main/ computes `errorStats` from the unrounded window means; the steps the replay reads are written to 7
 * significant figures. So each e_k recomputed here can be off by d_k = half7(forecast_k) + half7(observed_k),
 * each e_k² by 2|e_k|·d_k + d_k², the MSE by the mean of those, and a min or max by the largest of them.
 */
export function errorStatTolerance(steps: readonly ForecastStep[], scored: number, f: Forecaster): ErrorStatTolerance {
  const done = steps.slice(0, Math.max(0, scored));
  if (done.length === 0) return { e: 0, sq: 0, mse: 0 };
  const d = done.map((st) => half7(st[f]) + half7(st.observed));
  const dSq = done.map((st, k) => 2 * Math.abs(st[f] - st.observed) * d[k]! + d[k]! ** 2);
  return { e: Math.max(...d), sq: Math.max(...dSq), mse: dSq.reduce((acc, x) => acc + x, 0) / dSq.length };
}

/**
 * The statistics of `computed` (recomputed from the steps) that differ from the artifact's `errorStats` by more
 * than rounding explains: more than `tol` (the steps' 7-significant-figure rounding) plus half7 of the written
 * value (its own rounding), with a floating-point allowance; n is compared exactly, and a value missing on one
 * side only counts as a disagreement. [] when they agree. A value near a printed rounding boundary can print
 * one unit differently on the two sides without being a disagreement (see errorStatPrintDifferences).
 */
export function errorStatDisagreements(computed: ErrorStat, artifact: ErrorStat | null | undefined, tol: ErrorStatTolerance): string[] {
  if (!artifact) return ['errorStats missing'];
  const out: string[] = [];
  if (computed.n !== artifact.n) out.push('n');
  const far = (c: number | null | undefined, a: number | null | undefined, t: number): boolean => {
    if (c === null || c === undefined || a === null || a === undefined) return (c ?? null) !== (a ?? null);
    return Math.abs(c - a) > t + half7(a) + 1e-12 * Math.max(Math.abs(c), Math.abs(a));
  };
  const farRange = (c: Window | null | undefined, a: Window | null | undefined, t: number): boolean => {
    if (!c || !a) return !c !== !a;
    return far(c[0], a[0], t) || far(c[1], a[1], t);
  };
  if (far(computed.mse, artifact.mse, tol.mse)) out.push(STAT_NAME.mse);
  // |√x − √y| = |x − y| / (√x + √y) ≤ √|x − y|, with y ≥ the written MSE less its rounding.
  const rmseTol = (() => {
    if (computed.mse === null) return 0;
    const a = artifact.mse ?? null;
    const den = Math.sqrt(computed.mse) + (a === null ? 0 : Math.sqrt(Math.max(0, a - half7(a))));
    return den > 0 ? Math.min(Math.sqrt(tol.mse), tol.mse / den) : Math.sqrt(tol.mse);
  })();
  if (far(computed.rmse, artifact.rmse, rmseTol)) out.push(STAT_NAME.rmse);
  if (farRange(computed.squaredErrorRange, artifact.squaredErrorRange, tol.sq)) out.push(STAT_NAME.squaredErrorRange);
  if (farRange(computed.errorRange, artifact.errorRange, tol.e)) out.push(STAT_NAME.errorRange);
  return out;
}

/**
 * The statistics that print differently from the artifact's `errorStats` (at the view's precision), each with
 * the artifact's printed value; [] when every printed value is the same.
 */
export function errorStatPrintDifferences(computed: ErrorStat, artifact: ErrorStat): { name: string; artifact: string }[] {
  return (['mse', 'rmse', 'squaredErrorRange', 'errorRange'] as const)
    .filter((k) => printedStat(computed, k) !== printedStat(artifact, k))
    .map((k) => ({ name: STAT_NAME[k], artifact: printedStat(artifact, k) }));
}

/** One window's value as the chart draws it. */
export interface PlottedWindow {
  window: Window;
  value: number;
}

/**
 * What the chart may draw in replay state `s` (F7): Predicted = forecaster `f`'s forecast of every window
 * already predicted, Actual = the archived observed mean of every window already revealed. A window that
 * is not yet predicted or revealed is absent: hidden values are never handed to the chart at all.
 */
export function plottedWindows(
  steps: readonly ForecastStep[],
  s: ReplayState,
  f: Forecaster,
): { predicted: PlottedWindow[]; actual: PlottedWindow[] } {
  const predicted: PlottedWindow[] = [];
  const actual: PlottedWindow[] = [];
  steps.forEach((st, i) => {
    const v = visibility(s, i);
    if (v.forecasts) predicted.push({ window: st.window, value: st[f] });
    if (v.observed) actual.push({ window: st.window, value: st.observed });
  });
  return { predicted, actual };
}

/** Points of a step line, ready for a Plotly scatter trace. */
export interface StepLine {
  x: (number | null)[];
  y: (number | null)[];
  /** True at each window's midpoint, the one point per window that carries a marker. */
  mid: boolean[];
  /** The window of each point ("1500–1550"), for hover text; null at a gap. */
  window: (string | null)[];
}

/**
 * A value held constant over each window [a, b]: the points (a, v), ((a + b)/2, v), (b, v). Contiguous
 * windows join with a vertical riser at the shared edge (a step); a null point breaks the line where a
 * window does not start at the previous one's end, so nothing is drawn across a gap.
 */
export function stepLine(ws: readonly PlottedWindow[]): StepLine {
  const out: StepLine = { x: [], y: [], mid: [], window: [] };
  let prevEnd: number | null = null;
  for (const { window: [a, b], value } of ws) {
    if (prevEnd !== null && prevEnd !== a) {
      out.x.push(null);
      out.y.push(null);
      out.mid.push(false);
      out.window.push(null);
    }
    const name = formatWindow([a, b]);
    for (const [x, isMid] of [
      [a, false],
      [(a + b) / 2, true],
      [b, false],
    ] as const) {
      out.x.push(x);
      out.y.push(value);
      out.mid.push(isMid);
      out.window.push(name);
    }
    prevEnd = b;
  }
  return out;
}

/**
 * The PRD scores shown as a mismatch: the same rule as the FixtureCheck rows above the callout (the
 * `matches` flag and the printed values together), so the count always equals the rows marked Mismatch.
 * A score that cannot be recomputed (`matches: null`) is not a mismatch. The mismatch narrative in the
 * view exists only while this list is non-empty.
 */
export function mismatchedScores(a: ForecastArtifact): FixtureCheckData[] {
  return a.fixtures.filter((f) => fixtureOutcome(f).outcome === 'mismatch');
}

/**
 * True when the sample-and-hold values printed in the note are exactly what the PRD prints for both scores
 * (each printed value equal to the claim at the fixture's printed precision). Only then may the view say
 * the alternative definition reproduces them.
 */
export function sampleAndHoldMatchesPrd(sah: SampleAndHold, a: ForecastArtifact): boolean {
  const printedClaim = (id: string) => {
    const f = a.fixtures.find((x) => x.id === id);
    return f && f.claimed !== null ? formatNumber(f.claimed, f.printedDecimals) : null;
  };
  const p = printedClaim('mae-persistence');
  const f = printedClaim('mae-frozen');
  return p !== null && f !== null && sah.persistence[1] === p && sah.frozen[1] === f;
}

export interface SampleAndHold {
  persistence: [string, string];
  frozen: [string, string];
  archive: { value: string; printed: string; claimed: string } | null;
}

/** Extract the D-016 sample-and-hold numbers from the fixture note (the artifact is the only source). */
export function parseSampleAndHold(note: string | undefined): SampleAndHold | null {
  if (!note) return null;
  const m = /persistence\s+([0-9.]+)\s*→\s*([0-9.]+),\s*frozen\s+([0-9.]+)\s*→\s*([0-9.]+)/.exec(note);
  if (!m) return null;
  const a = /300–400\s*=\s*([0-9.]+)\s*\(prints\s+([0-9.]+),\s*PRD\s+([0-9.]+)\)/.exec(note);
  return {
    persistence: [m[1] as string, m[2] as string],
    frozen: [m[3] as string, m[4] as string],
    archive: a ? { value: a[1] as string, printed: a[2] as string, claimed: a[3] as string } : null,
  };
}
