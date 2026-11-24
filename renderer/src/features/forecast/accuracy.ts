// Forecast accuracy in percent, computed here from the archived window means of the revealed windows (never
// from PRD numbers). Small, plain statistics: mean absolute percentage error with a 95% confidence interval,
// bias, a paired t-test between the two forecasters, and the flux's own window-to-window variability.
import { FORECASTERS, visibility, type ForecastStep, type Forecaster, type ReplayState } from './model';

export interface PercentWindow {
  window: [number, number];
  /** 100·|forecast − observed| / observed */
  abs: number;
  /** 100·(forecast − observed) / observed: positive = over-forecast */
  signed: number;
}

export function percentErrors(steps: readonly ForecastStep[], s: ReplayState): Record<Forecaster, PercentWindow[]> {
  const out: Record<Forecaster, PercentWindow[]> = { persistence: [], frozen: [] };
  steps.forEach((st, i) => {
    if (!visibility(s, i).observed) return;
    for (const f of FORECASTERS) {
      const signed = (100 * (st[f] - st.observed)) / st.observed;
      out[f].push({ window: st.window, abs: Math.abs(signed), signed });
    }
  });
  return out;
}

const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: readonly number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

// Regularised incomplete beta I_x(a, b) (continued fraction, Numerical Recipes), for the Student t CDF.
function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const k of c) ser += k / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a: number, b: number, x: number): number {
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    for (const aa of [(m * (b - m) * x) / ((a + m2 - 1) * (a + m2)), (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))]) {
      d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
      c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-12) break;
  }
  return h;
}
function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(a, b, x)) / a : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a t statistic with `df` degrees of freedom. */
export function tPValue(t: number, df: number): number {
  return incBeta(df / (df + t * t), df / 2, 0.5);
}

/** t such that P(|T| > t) = 1 − level, by bisection. */
export function tCritical(df: number, level = 0.95): number {
  let lo = 0, hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tPValue(mid, df) > 1 - level) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface ForecasterAccuracy {
  n: number;
  /** Mean absolute percentage error (%) */
  mape: number;
  /** 95% confidence interval of the MAPE (%), null with fewer than 2 windows */
  ci: [number, number] | null;
  /** Mean signed error (%) and its two-sided p-value against zero */
  bias: number;
  biasP: number | null;
  worst: number;
}

export interface Accuracy {
  n: number;
  forecasters: Record<Forecaster, ForecasterAccuracy>;
  /** Paired test of |%| errors, persistence − frozen */
  paired: { diff: number; p: number | null };
  /** Coefficient of variation of the observed window means (%): the flux's own window-to-window wiggle */
  variability: number | null;
}

export function accuracy(steps: readonly ForecastStep[], s: ReplayState): Accuracy | null {
  const pct = percentErrors(steps, s);
  const n = pct.persistence.length;
  if (n === 0) return null;
  const stat = (f: Forecaster): ForecasterAccuracy => {
    const abs = pct[f].map((w) => w.abs);
    const signed = pct[f].map((w) => w.signed);
    const mape = mean(abs);
    if (n < 2) return { n, mape, ci: null, bias: mean(signed), biasP: null, worst: Math.max(...abs) };
    const half = (tCritical(n - 1) * sd(abs)) / Math.sqrt(n);
    const sdSigned = sd(signed);
    const biasP = sdSigned > 0 ? tPValue(mean(signed) / (sdSigned / Math.sqrt(n)), n - 1) : null;
    return { n, mape, ci: [Math.max(0, mape - half), mape + half], bias: mean(signed), biasP, worst: Math.max(...abs) };
  };
  const d = pct.persistence.map((w, k) => w.abs - pct.frozen[k]!.abs);
  const sdD = n > 1 ? sd(d) : 0;
  const observed = steps.filter((_, i) => visibility(s, i).observed).map((st) => st.observed);
  return {
    n,
    forecasters: { persistence: stat('persistence'), frozen: stat('frozen') },
    paired: { diff: mean(d), p: n > 1 && sdD > 0 ? tPValue(mean(d) / (sdD / Math.sqrt(n)), n - 1) : null },
    variability: n > 1 ? (100 * sd(observed)) / mean(observed) : null,
  };
}

const pct = (v: number) => v.toFixed(2) + '%';
const pText = (p: number) => (p < 0.001 ? 'p < 0.001' : 'p = ' + p.toFixed(2));

/** What the numbers mean, in plain sentences. */
export function significance(a: Accuracy): string[] {
  const { persistence: P, frozen: F } = a.forecasters;
  const out = [
    `Persistence misses by ${pct(P.mape)} on average and frozen by ${pct(F.mape)}` +
      (P.ci && F.ci ? ` (95% confidence: ${pct(P.ci[0])}–${pct(P.ci[1])} and ${pct(F.ci[0])}–${pct(F.ci[1])}).` : '.'),
  ];
  if (a.variability !== null) {
    const typical = Math.max(P.mape, F.mape);
    out.push(
      `The flux itself varies by ${pct(a.variability)} from window to window, so errors of about ${pct(typical)} are ` +
        (typical <= a.variability * 1.2 ? 'no larger than the flux’s own natural wiggle.' : 'larger than the flux’s own natural wiggle.'),
    );
  }
  if (a.paired.p !== null) {
    const better = a.paired.diff > 0 ? 'Frozen' : 'Persistence';
    out.push(
      `${better} is ahead by ${Math.abs(a.paired.diff).toFixed(2)} percentage points; with ${a.n} windows that difference is ` +
        (a.paired.p < 0.05 ? `statistically significant (${pText(a.paired.p)}).` : `not statistically significant (${pText(a.paired.p)}): the two forecasters cannot be told apart.`),
    );
  }
  if (P.biasP !== null) {
    out.push(
      P.biasP < 0.05
        ? `Persistence is biased: it ${P.bias > 0 ? 'over' : 'under'}-forecasts by ${pct(Math.abs(P.bias))} on average (${pText(P.biasP)}).`
        : `Neither direction dominates for persistence: its mean signed error ${P.bias >= 0 ? '+' : '−'}${pct(Math.abs(P.bias))} is consistent with zero (${pText(P.biasP)}).`,
    );
  }
  if (a.n < 10) out.push(`Only ${a.n} windows are scored, so the confidence intervals are wide; treat these as indicative.`);
  return out;
}
