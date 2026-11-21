"""Forecast replay on the stella bean trace (F1, F2).

PRD: "Predict the next 50-unit local mean from the previous completed window, reveal the
archived observations, update and repeat. Using 1450–1500 for initialization ..."

Definitions used here (no tuning towards the PRD's numbers, decisions D-008 and D-013):

* Window ``k`` is ``[1500 + 50k, 1550 + 50k]``, ``k = 0..7`` (to 1900); the initialisation
  window is ``[1450, 1500]``. Adjacent windows share only an edge, which has zero weight.
* The *observed* local mean of a window is the shared time-weighted window mean
  ``transport.stats.window_mean``: ``(1/(b-a)) * integral_a^b Q dt`` with ``Q`` linearly
  interpolated at the window edges (D-013).
* A *forecast* may only use data up to the end of the completed window. Interpolating ``Q`` at
  the right edge ``b`` would use the first sample after ``b`` (a one-sample look-ahead), so the
  forecaster's window means use ``right_edge="hold"``: the value at ``b`` is the last sample
  ``<= b``. Everything else is identical to the observed mean.
* *Persistence*: the forecast for window ``k`` is the forecaster's mean of window ``k-1`` (the
  initialisation window for ``k = 0``); it is updated after each reveal.
* *Frozen*: every forecast is the forecaster's initialisation-window mean, never updated.
* Absolute error ``|observed - forecast|`` per step; MAE is the mean over the 8 steps.

``VARIANTS`` holds alternative window-mean definitions (used for both observation and forecast)
solely to report how sensitive the MAE is to the definition.
"""
from __future__ import annotations

import math
from collections.abc import Callable, Sequence

import numpy as np

from labyrinth_main.features.transport.stats import (
    sample_and_hold_mean,
    sample_span_trapezoid_mean,
    window_mean,
)

MeanFn = Callable[[Sequence[float], Sequence[float], Sequence[float]], float]

INIT_WINDOW = (1450.0, 1500.0)
WIDTH = 50.0
N_STEPS = 8

METHOD = (
    "Windows: initialisation [1450,1500]; steps k=0..7 on [1500+50k, 1550+50k], i.e. [1500,1550] ... "
    "[1850,1900]. Observed local mean = time-weighted mean (1/(b-a)) * integral_a^b Q dt of the archived "
    "stella bean trace, with Q linearly interpolated at the window edges (trapezoid rule; restart-overlap "
    "duplicates removed; D-013). Forecaster's mean of a completed window = the same integral but with the "
    "value at the right edge b held at the last sample <= b, so no sample after the window is used. "
    "Persistence forecast for step k = forecaster's mean of the previous completed window (the "
    "initialisation window for k=0), updated after each reveal. Frozen forecast = forecaster's "
    "initialisation-window mean for every step, never updated. Because of the held edge, the persistence "
    "forecast for step k can differ from the revealed observation of window k-1 (interpolated edge), by up "
    "to about 1e-4 on the archived stella trace; it is not literally 'the previous observed value'. Error = |observed - forecast|; "
    "MAE = mean over the 8 steps."
)


def causal_window_mean(t: Sequence[float], q: Sequence[float], window: Sequence[float]) -> float:
    """Forecaster's window mean: D-013 integral with the right edge held (no look-ahead)."""
    return window_mean(t, q, window, right_edge="hold")


def sample_mean_half_open(t: Sequence[float], q: Sequence[float], window: Sequence[float]) -> float:
    ta, qa = np.asarray(t, dtype=float), np.asarray(q, dtype=float)
    m = (ta >= window[0]) & (ta < window[1])
    if not m.any():
        raise ValueError(f"no samples in window {tuple(window)}")
    return float(qa[m].mean())


def step_windows() -> list[tuple[float, float]]:
    start = INIT_WINDOW[1]
    return [(start + WIDTH * k, start + WIDTH * (k + 1)) for k in range(N_STEPS)]


def run(t: Sequence[float], q: Sequence[float], mean: MeanFn = window_mean,
        forecast_mean: MeanFn | None = causal_window_mean) -> dict:
    """Replay both forecasters. ``forecast_mean=None`` uses ``mean`` for the forecasts too."""
    fmean = mean if forecast_mean is None else forecast_mean
    init = fmean(t, q, INIT_WINDOW)
    prev = init
    steps = []
    for w in step_windows():
        obs = mean(t, q, w)
        steps.append({"window": list(w), "observed": obs, "persistence": prev, "frozen": init,
                      "absErrPersistence": abs(obs - prev), "absErrFrozen": abs(obs - init)})
        prev = fmean(t, q, w)
    mae = {"persistence": float(np.mean([s["absErrPersistence"] for s in steps])),
           "frozen": float(np.mean([s["absErrFrozen"] for s in steps]))}
    return {"init": init, "steps": steps, "mae": mae}


# D-026 (owner requirement 2026-11-21): predicted vs actual error statistics over the scored steps.
ERROR_STATS_DEFINITION = (
    "D-026. Over the n scored steps k of `steps` (n is given with each forecaster's statistics), e_k = forecast_k - "
    "observed_k, i.e. predicted minus "
    "actual (Q_gB,i), where forecast_k is that step's persistence or frozen forecast and observed_k its archived "
    "observed window mean (the same values the MAE uses; window means unchanged, D-013). MSE = (1/n) * sum_k e_k^2 "
    "(Q_gB,i^2). RMSE = sqrt(MSE) (Q_gB,i). squaredErrorRange = [min_k e_k^2, max_k e_k^2] (Q_gB,i^2): the 'range of "
    "MSE', read as the spread of the per-step squared errors the MSE averages (interpretation recorded in D-026 sec. 2). "
    "errorRange = [min_k e_k, max_k e_k] (Q_gB,i): the range of the signed predicted - actual differences. With n = 0 "
    "every value is null."
)


def error_stat(forecasts: Sequence[float], observed: Sequence[float]) -> dict:
    """D-026 statistics of e_k = forecast_k - observed_k (predicted minus actual); every value null when n = 0."""
    f = np.asarray(forecasts, dtype=float)
    o = np.asarray(observed, dtype=float)
    if f.shape != o.shape or f.ndim != 1:
        raise ValueError(f"forecasts and observations must be 1-D and aligned, got {f.shape} and {o.shape}")
    n = int(f.size)
    if n == 0:
        return {"n": 0, "mse": None, "rmse": None, "squaredErrorRange": None, "errorRange": None}
    e = f - o
    sq = e * e
    mse = float(np.mean(sq))
    return {"n": n, "mse": mse, "rmse": math.sqrt(mse), "squaredErrorRange": [float(sq.min()), float(sq.max())],
            "errorRange": [float(e.min()), float(e.max())]}


def error_stats(steps: Sequence[dict]) -> dict:
    """`errorStats` of forecast.json, from the same steps the artifact holds."""
    observed = [s["observed"] for s in steps]
    return {"definition": ERROR_STATS_DEFINITION,
            "persistence": error_stat([s["persistence"] for s in steps], observed),
            "frozen": error_stat([s["frozen"] for s in steps], observed)}


# Each variant uses one definition for both observation and forecast.
VARIANTS: dict[str, MeanFn] = {
    "time-weighted sample-and-hold (zero-order hold, edge-clipped)": sample_and_hold_mean,
    "sample mean, half-open windows a<=t<b": sample_mean_half_open,
    "sample-span trapezoid (samples a<=t<=b, divided by t_last-t_first)": sample_span_trapezoid_mean,
    "edge-interpolated for forecasts too (one-sample look-ahead)": window_mean,
}
