"""Window statistics for heat-flux traces (T2, T3, T6).

Definitions (all pure functions of ``t``, ``Q`` and a window ``[a, b]``):

* **Restart repeats.** ``drop_restart_repeats`` removes samples whose time does not increase.
  A dropped sample is accepted as a harmless restart repeat only if an earlier kept sample has
  exactly the same ``t`` (exact float equality, no tolerance) and the same ``Q`` (relative
  tolerance ``REPEAT_RTOL``); otherwise it is counted as *divergent* and callers refuse to use the
  trace (archive: raise; compare: no claim). A restart whose times differ only by round-off is
  therefore treated as divergent — the safe direction: no claim rather than a silent merge.

* **Coverage.** A window is *covered* only if the trace spans it (``t[0] <= a``,
  ``t[-1] >= b``), at least ``MIN_SAMPLES`` samples lie in ``[a, b]``, and no spacing between
  consecutive samples of the *bracketed* segment — from the last sample ``<= a`` to the first
  sample ``>= b`` — exceeds ``MAX_GAP_FACTOR`` times that segment's median spacing. Including
  the bracketing samples catches holes at the window edges.

* **Mean (time-weighted, edge-interpolated; decision D-013).**
  ``window_mean = (1/(b-a)) * integral_a^b Q(t) dt`` with ``Q`` the piecewise-linear
  interpolant of the samples (``Q`` linearly interpolated at ``a`` and ``b``; trapezoid rule over
  ``[a, samples strictly inside, b]``). Exact for piecewise-linear ``Q``. This single
  definition is used by every window, fixture, ``compare_window`` and the forecast.
  ``right_edge="hold"`` replaces the interpolated value at ``b`` by the last sample ``<= b``
  (zero-order hold; no look-ahead past ``b``), used by the forecaster for completed windows.
  ``sample_span_trapezoid_mean`` and ``sample_and_hold_mean`` are alternative definitions kept
  only to report definition sensitivity.

* **Sampling uncertainty (integrated autocorrelation time, Sokal windowing).** The trace is
  linearly resampled onto ``N`` uniform points over ``[a, b]`` (``N`` = samples in the window,
  ``dt = (b-a)/(N-1)``). ``rho_k`` is the FFT autocorrelation and
  ``tau_int(M) = 1/2 + sum_{k=1..M} rho_k``; the window is the first ``M < N/2`` with
  ``M >= C * tau_int(M)`` (Sokal, ``C = 5``). Convergence only at ``M >= N/2`` counts as NOT
  converged (``stderr`` is ``None``). Then ``tau = tau_int * dt`` (time units),
  ``N_eff = (b-a) / (2 tau)`` and ``stderr = s * sqrt(2 tau / (b-a))``. Confidence intervals use
  Student-t critical values with ``df = N_eff - 1``. Below ``N_EFF_MIN`` (20) effective samples
  the Sokal estimate is known to be biased low (≈40 % at N_eff≈5), so the stderr is flagged
  *approximate* and no saturated-agreement claim is allowed.

* **Stationarity (half-split t-test).** Split ``[a, b]`` at ``h``; ``m_1``, ``m_2`` are the
  window means of ``[a, h]`` and ``[h, b]``. ``sigma_r`` is the standard deviation of the
  residuals about each half's own mean on the uniform grid; ``tau`` is the larger of the Sokal
  ``tau_int`` of the full-window centred series and of those residuals (the residual estimate
  alone is biased low and over-rejects). ``se = sigma_r * sqrt(2 tau (1/T_1 + 1/T_2))``,
  ``t = (m_1 - m_2) / se`` compared with the two-sided ``1 - ALPHA`` Student-t critical value
  with ``df = N_eff - 2`` (two means estimated). Stationary iff ``|t| < t_crit``. Undecidable
  (``None``) if the full-window ``tau`` does not converge. When the test is only *indicative*
  (``N_eff < N_EFF_MIN``, the uncorrected-tau fallback was needed, or the window's own stderr
  is approximate) ``window_stats`` reports
  ``stationary = None`` (undecidable); the t statistic and the indicative verdict stay in the
  detail text.

* **Saturated-agreement claim** is allowed only if covered AND stationary AND stderr finite AND
  ``N_eff >= N_EFF_MIN``.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

SOKAL_C = 5.0
ALPHA = 0.05
N_EFF_MIN = 20.0
MAX_GAP_FACTOR = 10.0
MIN_SAMPLES = 8
REPEAT_RTOL = 1e-9
MIN_BIAS_DENOM = 0.5  # bias correction may at most double tau; beyond that the estimate is not trusted

METHOD_SUMMARY = (
    "mean: time-weighted (1/(b-a)) * integral_a^b Q dt with Q linearly interpolated at the window "
    "edges (trapezoid rule, D-013); "
    "stderr: integrated autocorrelation time with Sokal automatic windowing (C=5, converged only for "
    "M < N/2) on the trace resampled to a uniform grid over [a,b], stderr = s*sqrt(2*tau_int/(b-a)), "
    f"N_eff = (b-a)/(2*tau_int), approximate when N_eff < {N_EFF_MIN:g}; "
    "stationarity: half-split Student-t test (df = N_eff-2, two-sided alpha 0.05) with tau = max(tau of "
    "the full-window centred series, tau of residuals about each half's mean), indicative when "
    f"N_eff < {N_EFF_MIN:g}; saturated claim requires covered, stationary, finite stderr and "
    f"N_eff >= {N_EFF_MIN:g}"
)


# ---------------------------------------------------------------- Student-t (no scipy dependency)
def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the regularized incomplete beta (modified Lentz)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c if abs(1.0 + aa / c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c if abs(1.0 + aa / c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-14:
            break
    return h


def _betainc(a: float, b: float, x: float) -> float:
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    if x < (a + 1.0) / (a + b + 2.0):
        return math.exp(lbt) * _betacf(a, b, x) / a
    return 1.0 - math.exp(lbt) * _betacf(b, a, 1.0 - x) / b


def t_cdf(x: float, df: float) -> float:
    """Student-t CDF for real ``df > 0``."""
    tail = 0.5 * _betainc(df / 2.0, 0.5, df / (df + x * x))
    return 1.0 - tail if x >= 0 else tail


def t_ppf(p: float, df: float) -> float:
    """Student-t quantile (bisection on ``t_cdf``); ``df`` is clamped to at least 1."""
    if not 0.0 < p < 1.0:
        raise ValueError("p must be in (0, 1)")
    df = max(float(df), 1.0)
    if p < 0.5:
        return -t_ppf(1.0 - p, df)
    lo, hi = 0.0, 1.0
    while t_cdf(hi, df) < p:
        hi *= 2.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if t_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-12:
            break
    return 0.5 * (lo + hi)


def sig(x: float | None, n: int = 4) -> float | None:
    """Round to ``n`` significant figures (for serialised statistics; cross-version determinism)."""
    if x is None or x == 0 or not math.isfinite(x):
        return x
    return float(f"{x:.{n - 1}e}")


# ---------------------------------------------------------------- restart repeats
@dataclass(frozen=True)
class Dedup:
    t: np.ndarray
    q: np.ndarray
    n_dropped: int
    n_divergent: int
    detail: str


def drop_restart_repeats(t: Sequence[float], q: Sequence[float], rtol: float = REPEAT_RTOL) -> Dedup:
    """Drop non-increasing samples, verifying each one repeats an earlier kept sample in t AND Q.

    ``t`` is matched by exact float equality (dictionary lookup on the kept times); ``Q`` within
    ``rtol``. Round-off differences in ``t`` count as divergent, which makes callers refuse the
    trace (no claim) instead of merging it.
    """
    ta = np.asarray(t, dtype=float)
    qa = np.asarray(q, dtype=float)
    if ta.shape != qa.shape or ta.ndim != 1:
        raise ValueError("t and Q must be 1-D arrays of equal length")
    if len(ta) == 0:
        return Dedup(ta, qa, 0, 0, "empty trace")
    keep = [0]
    kept_q = {float(ta[0]): float(qa[0])}
    divergent = []
    for i in range(1, len(ta)):
        ti, qi = float(ta[i]), float(qa[i])
        if ti > ta[keep[-1]]:
            keep.append(i)
            kept_q[ti] = qi
            continue
        prev = kept_q.get(ti)
        if prev is None or not math.isclose(qi, prev, rel_tol=rtol, abs_tol=1e-300):
            divergent.append(i)
    n_dropped = len(ta) - len(keep)
    if divergent:
        i = divergent[0]
        detail = (f"{len(divergent)} of {n_dropped} non-increasing samples do not repeat an earlier sample "
                  f"(first: index {i}, t={ta[i]:.10g}, Q={qa[i]:.6g})")
    elif n_dropped:
        detail = f"{n_dropped} restart-repeat samples (identical t and Q) dropped"
    else:
        detail = "no repeats"
    return Dedup(ta[keep], qa[keep], n_dropped, len(divergent), detail)


# ---------------------------------------------------------------- coverage and means
def _as_arrays(t: Sequence[float], q: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
    ta = np.asarray(t, dtype=float)
    qa = np.asarray(q, dtype=float)
    if ta.shape != qa.shape or ta.ndim != 1:
        raise ValueError("t and Q must be 1-D arrays of equal length")
    if len(ta) > 1 and not np.all(np.diff(ta) > 0):
        raise ValueError("t must be strictly increasing (use drop_restart_repeats first)")
    return ta, qa


def _in_window(t: np.ndarray, a: float, b: float) -> np.ndarray:
    return (t >= a) & (t <= b)


def coverage(t: Sequence[float], window: Sequence[float]) -> tuple[bool, str]:
    """``(covered, reason)``; see the module docstring for the rule."""
    ta = np.asarray(t, dtype=float)
    a, b = float(window[0]), float(window[1])
    if len(ta) < 2 or ta[0] > a or ta[-1] < b:
        span = f"t={ta[0]:.10g}..{ta[-1]:.10g}" if len(ta) else "no samples"
        return False, f"not covered: trace spans {span}, window {a:.10g}-{b:.10g}"
    n = int(_in_window(ta, a, b).sum())
    if n < MIN_SAMPLES:
        return False, f"not covered: only {n} samples in {a:.10g}-{b:.10g} (minimum {MIN_SAMPLES})"
    i0 = int(np.searchsorted(ta, a, side="right")) - 1
    i1 = int(np.searchsorted(ta, b, side="left"))
    seg = ta[i0:i1 + 1]
    gaps = np.diff(seg)
    local = float(np.median(gaps))
    k = int(np.argmax(gaps))
    if gaps[k] > MAX_GAP_FACTOR * local:
        return False, (f"not covered: gap of {gaps[k]:.4g} between t={seg[k]:.10g} and t={seg[k + 1]:.10g} "
                       f"exceeds {MAX_GAP_FACTOR:g}x the local median spacing {local:.4g}")
    return True, "covered"


def window_covered(t: Sequence[float], window: Sequence[float]) -> bool:
    return coverage(t, window)[0]


def window_mean(t: Sequence[float], q: Sequence[float], window: Sequence[float], *,
                right_edge: str = "interpolate") -> float:
    """Time-weighted window mean: (1/(b-a)) * integral_a^b Q dt, Q linearly interpolated at the edges.

    The single window-mean definition of Labyrinth (D-013). ``right_edge="hold"`` uses the last
    sample ``<= b`` as the value at ``b`` (no look-ahead past ``b``).
    """
    ta, qa = _as_arrays(t, q)
    a, b = float(window[0]), float(window[1])
    if not b > a:
        raise ValueError(f"empty window {tuple(window)}")
    if len(ta) < 2 or ta[0] > a or ta[-1] < b:
        raise ValueError(f"window {tuple(window)} not covered by the trace")
    m = (ta > a) & (ta < b)
    qa_edge = float(np.interp(a, ta, qa))
    if right_edge == "interpolate":
        qb_edge = float(np.interp(b, ta, qa))
    elif right_edge == "hold":
        j = int(np.searchsorted(ta, b, side="right")) - 1
        if ta[j] < a:
            raise ValueError(f"no sample in window {tuple(window)} to hold")
        qb_edge = float(qa[j])
    else:
        raise ValueError(f"right_edge must be 'interpolate' or 'hold', not {right_edge!r}")
    tt = np.concatenate([[a], ta[m], [b]])
    qq = np.concatenate([[qa_edge], qa[m], [qb_edge]])
    return float(np.trapezoid(qq, tt) / (b - a))


def sample_span_trapezoid_mean(t: Sequence[float], q: Sequence[float], window: Sequence[float]) -> float:
    """Alternative (sensitivity only): trapezoid over samples with a<=t<=b / (t_last-t_first)."""
    ta, qa = _as_arrays(t, q)
    m = _in_window(ta, float(window[0]), float(window[1]))
    if m.sum() < 2:
        raise ValueError(f"fewer than 2 samples in window {tuple(window)}")
    tt, qq = ta[m], qa[m]
    return float(np.trapezoid(qq, tt) / (tt[-1] - tt[0]))


def sample_and_hold_mean(t: Sequence[float], q: Sequence[float], window: Sequence[float]) -> float:
    """Alternative (sensitivity only): time-weighted mean of the zero-order hold, clipped to [a, b].

    ``Q(t) = Q_i`` for ``t_i <= t < t_{i+1}``; the value at ``a`` is the last sample ``<= a``.
    """
    ta, qa = _as_arrays(t, q)
    a, b = float(window[0]), float(window[1])
    if not b > a or len(ta) < 1 or ta[0] > a or ta[-1] < b:
        raise ValueError(f"window {tuple(window)} not covered by the trace")
    m = (ta > a) & (ta < b)
    knots = np.concatenate([[a], ta[m], [b]])
    j0 = int(np.searchsorted(ta, a, side="right")) - 1
    vals = np.concatenate([[qa[j0]], qa[m]])
    return float(np.sum(vals * np.diff(knots)) / (b - a))


# ---------------------------------------------------------------- autocorrelation and stderr
def integrated_autocorr_time(x: Sequence[float], c: float = SOKAL_C, *,
                             bias_correct: bool = True) -> tuple[float, int, bool]:
    """Sokal-windowed integrated autocorrelation time in units of samples.

    Returns ``(tau_int, M, converged)`` with ``tau_hat(M) = 1/2 + sum_{k=1..M} rho_k``. With
    ``bias_correct`` the known bias from subtracting the sample mean (each ``rho_k`` is
    lowered by about ``2 tau / N`` and the variance by the factor ``1 - 2 tau / N``) is removed
    self-consistently: ``tau = tau_hat / (1 - 2 (M - tau_hat + 1/2) / N)``; the window test
    ``M >= c * tau`` uses the corrected value. If the correction would more than double
    ``tau`` (denominator < ``MIN_BIAS_DENOM``) the estimate is reported as not converged.
    Converged only if some ``M < N//2`` satisfies ``M >= c * tau_int(M)``; otherwise
    ``tau_int`` is the (lower-bound) value at ``M = N//2 - 1``.
    """
    xa = np.asarray(x, dtype=float)
    n = len(xa)
    if n < 4:
        return math.nan, 0, False
    xa = xa - xa.mean()
    f = np.fft.rfft(xa, 2 * n)
    acf = np.fft.irfft(f * np.conj(f))[:n]
    if acf[0] <= 0:
        return math.nan, 0, False
    acf = acf / acf[0]
    tau_hat = 0.5
    tau = tau_hat
    m_last = 0
    for m in range(1, n // 2):  # M < N//2: convergence at M = N//2 counts as not converged
        tau_hat += acf[m]
        m_last = m
        if bias_correct:
            denom = 1.0 - 2.0 * (m - tau_hat + 0.5) / n
            if denom < MIN_BIAS_DENOM:  # first-order correction no longer trustworthy: give up
                return float(tau), m_last, False
            tau = tau_hat / denom
        else:
            tau = tau_hat
        if m >= c * tau:
            return float(tau), m, True
    return float(tau), m_last, False


def _uniform_grid(ta: np.ndarray, qa: np.ndarray, a: float, b: float) -> tuple[np.ndarray, np.ndarray, float]:
    """Resample the trace onto N uniform points over [a, b], N = number of samples in [a, b]."""
    n = int(_in_window(ta, a, b).sum())
    grid = np.linspace(a, b, n)
    return grid, np.interp(grid, ta, qa), (b - a) / (n - 1)


@dataclass(frozen=True)
class SamplingError:
    stderr: float | None
    tau_time: float | None
    n_eff: float | None
    n_eff_lower: float | None
    std: float
    window_lag: int
    converged: bool
    corrected: bool = True

    @property
    def df(self) -> float | None:
        return None if self.n_eff is None else max(self.n_eff - 1.0, 1.0)

    @property
    def approximate(self) -> bool:
        return self.n_eff_lower is None or self.n_eff_lower < N_EFF_MIN


def sampling_error(t: Sequence[float], q: Sequence[float], window: Sequence[float]) -> SamplingError:
    ta, qa = _as_arrays(t, q)
    a, b = float(window[0]), float(window[1])
    if int(_in_window(ta, a, b).sum()) < MIN_SAMPLES or ta[0] > a or ta[-1] < b:
        return SamplingError(None, None, None, None, math.nan, 0, False)
    span = b - a
    _, x, dt = _uniform_grid(ta, qa, a, b)
    n = len(x)
    tau_int, lag, ok = integrated_autocorr_time(x)
    if ok and math.isfinite(tau_int) and 0 < tau_int and 2.0 * tau_int < n:
        corrected = True
    else:
        # Fallback: uncorrected Sokal. Its tau is biased low, so the stderr is only a lower bound;
        # it is reported as approximate and can never support a claim (n_eff_lower = None).
        lag_c = lag
        tau_int, lag, ok = integrated_autocorr_time(x, bias_correct=False)
        if not ok or not math.isfinite(tau_int) or tau_int <= 0 or 2.0 * tau_int >= n:
            # The Sokal criterion failed at every lag tried, so tau_int > M_last / C (lower bound).
            m = max(lag, lag_c)
            tau_lb = m / SOKAL_C * dt if m else None
            return SamplingError(None, tau_lb, None, None, float(np.std(x, ddof=1)), m, False, False)
        tau_time = tau_int * dt
        std = float(np.std(x, ddof=1))
        return SamplingError(float(std * math.sqrt(2.0 * tau_time / span)), float(tau_time),
                             float(span / (2.0 * tau_time)), None, std, lag, True, False)
    # Variance about the sample mean is biased low by (1 - 2 tau / N) for correlated data.
    std = float(np.sqrt(np.mean((x - x.mean()) ** 2) / (1.0 - 2.0 * tau_int / n)))
    tau_time = tau_int * dt
    stderr = std * math.sqrt(2.0 * tau_time / span)
    tau_upper = tau_time * (1.0 + math.sqrt(2.0 * (2 * lag + 1) / n))  # Madras-Sokal one-sigma
    return SamplingError(float(stderr), float(tau_time), float(span / (2.0 * tau_time)),
                         float(span / (2.0 * tau_upper)), std, lag, True, corrected)


@dataclass(frozen=True)
class Stationarity:
    stationary: bool | None
    t_stat: float | None
    t_crit: float | None
    df: float | None
    tau_time: float | None
    n_eff: float | None
    fallback: bool = False

    @property
    def indicative(self) -> bool:
        return self.fallback or self.n_eff is None or self.n_eff < N_EFF_MIN


def half_split_test(t: Sequence[float], q: Sequence[float], window: Sequence[float],
                    alpha: float = ALPHA) -> Stationarity:
    """Half-split stationarity t-test (see module docstring)."""
    ta, qa = _as_arrays(t, q)
    a, b = float(window[0]), float(window[1])
    none = Stationarity(None, None, None, None, None, None)
    if int(_in_window(ta, a, b).sum()) < MIN_SAMPLES or ta[0] > a or ta[-1] < b:
        return none
    h = 0.5 * (a + b)
    m1, m2 = window_mean(ta, qa, (a, h)), window_mean(ta, qa, (h, b))
    grid, x, dt = _uniform_grid(ta, qa, a, b)
    n = len(grid)
    left = grid <= h
    if left.sum() < MIN_SAMPLES // 2 or (~left).sum() < MIN_SAMPLES // 2:
        return none
    tau_full, _, ok_full = integrated_autocorr_time(x)
    fallback = False
    if not ok_full or not math.isfinite(tau_full) or tau_full <= 0:
        tau_full, _, ok_full = integrated_autocorr_time(x, bias_correct=False)
        fallback = True
        if not ok_full or not math.isfinite(tau_full) or tau_full <= 0:
            return none
    r = np.where(left, x - x[left].mean(), x - x[~left].mean())
    tau_res, _, ok_res = integrated_autocorr_time(r, bias_correct=False)
    tau_int = max(tau_full, tau_res) if ok_res and math.isfinite(tau_res) else tau_full
    tau_time = tau_int * dt
    sigma = float(np.sqrt(np.sum(r**2) / (n - 2)))
    se = math.sqrt(2.0 * tau_time * sigma**2 * (1.0 / (h - a) + 1.0 / (b - h)))
    if se <= 0:
        return none
    n_eff = (b - a) / (2.0 * tau_time)
    df = max(n_eff - 2.0, 1.0)
    t_crit = t_ppf(1.0 - alpha / 2.0, df)
    t_stat = (m1 - m2) / se
    return Stationarity(bool(abs(t_stat) < t_crit), float(t_stat), float(t_crit), float(df),
                        float(tau_time), float(n_eff), fallback)


# ---------------------------------------------------------------- per-window summary
@dataclass(frozen=True)
class WindowStats:
    window: tuple[float, float]
    covered: bool
    n_samples: int
    mean: float | None
    stderr: float | None
    tau: float | None
    n_eff: float | None
    n_eff_lower: float | None
    stationary: bool | None
    t_half: float | None
    half_means: tuple[float, float] | None
    detail: str

    @property
    def df(self) -> float | None:
        return None if self.n_eff is None else max(self.n_eff - 1.0, 1.0)

    @property
    def approximate(self) -> bool:
        return self.n_eff_lower is None or self.n_eff_lower < N_EFF_MIN

    @property
    def saturated_claim_allowed(self) -> bool:
        return bool(self.covered and self.stationary is True and self.stderr is not None
                    and math.isfinite(self.stderr) and self.n_eff_lower is not None
                    and self.n_eff_lower >= N_EFF_MIN)


def window_stats(t: Sequence[float], q: Sequence[float], window: Sequence[float]) -> WindowStats:
    ta, qa = _as_arrays(t, q)
    a, b = float(window[0]), float(window[1])
    n = int(_in_window(ta, a, b).sum())
    covered, why = coverage(ta, (a, b))
    if not covered:
        return WindowStats((a, b), False, n, None, None, None, None, None, None, None, None,
                           f"{why}; no mean, uncertainty or claim.")
    mean = window_mean(ta, qa, (a, b))
    err = sampling_error(ta, qa, (a, b))
    h = 0.5 * (a + b)
    m1, m2 = window_mean(ta, qa, (a, h)), window_mean(ta, qa, (h, b))
    st = half_split_test(ta, qa, (a, b))
    stationary = st.stationary
    if st.stationary is None:
        verdict = "undecidable (full-window Sokal tau did not converge, corrected or uncorrected)"
        t_txt = "t=n/a"
    else:
        verdict = "stationary" if st.stationary else "NOT stationary"
        if st.indicative or err.approximate:
            if st.fallback:
                why = "uncorrected-tau fallback"
            elif st.indicative:
                why = f"N_eff={st.n_eff:.3g} < {N_EFF_MIN:g}"
            else:
                why = "the window's sampling uncertainty is approximate (N_eff at the tau upper bound < 20)"
            verdict = f"undecidable — test result '{verdict}' is indicative only ({why})"
            stationary = None
        t_txt = (f"t={st.t_stat:+.2f} vs t_crit={st.t_crit:.3g} (df={st.df:.3g}, two-sided alpha {ALPHA:g}), "
                 f"tau={st.tau_time:.3g} time units")
    if err.stderr is None:
        lb = "" if err.tau_time is None else f"; tau_int > {err.tau_time:.3g} time units"
        err_txt = f"stderr not finite (Sokal window not reached{lb})"
    elif not err.corrected:
        err_txt = (f"tau_int={err.tau_time:.3g} time units from the UNCORRECTED Sokal fallback (the "
                   f"bias-corrected estimate did not converge, so tau is likely underestimated; lag "
                   f"{err.window_lag}), N_eff~{err.n_eff:.3g}, stderr~{err.stderr:.3g} — APPROXIMATE, a lower "
                   f"bound on the sampling uncertainty")
    else:
        flag = (f"APPROXIMATE (N_eff at the tau upper bound < {N_EFF_MIN:g}; Sokal stderr biased low at "
                f"small N_eff)" if err.approximate else f"reliable (N_eff at the tau upper bound >= {N_EFF_MIN:g})")
        err_txt = (f"tau_int={err.tau_time:.3g} time units (bias-corrected Sokal, C={SOKAL_C:g}, lag "
                   f"{err.window_lag}), N_eff={err.n_eff:.3g} (>= {err.n_eff_lower:.3g} at the one-sigma "
                   f"tau upper bound), stderr={err.stderr:.3g} — {flag}")
    claim = []
    if err.n_eff_lower is None or err.n_eff_lower < N_EFF_MIN:
        claim.append(f"N_eff (at the tau upper bound) below {N_EFF_MIN:g}")
    if stationary is not True:
        claim.append("not shown stationary")
    claim_txt = ("Saturated claim allowed." if not claim
                 else f"Saturated claim NOT allowed: {', '.join(claim)}.")
    detail = (f"Half-split test: mean[{a:.10g},{h:.10g}]={m1:.4f}, mean[{h:.10g},{b:.10g}]={m2:.4f}, {t_txt} "
              f"-> {verdict}. {err_txt}. {claim_txt}")
    return WindowStats((a, b), True, n, mean, err.stderr, err.tau_time, err.n_eff, err.n_eff_lower,
                       stationary, st.t_stat, (m1, m2), detail)
