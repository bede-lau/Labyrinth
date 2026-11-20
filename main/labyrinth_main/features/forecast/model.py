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


# Each variant uses one definition for both observation and forecast.
VARIANTS: dict[str, MeanFn] = {
    "time-weighted sample-and-hold (zero-order hold, edge-clipped)": sample_and_hold_mean,
    "sample mean, half-open windows a<=t<b": sample_mean_half_open,
    "sample-span trapezoid (samples a<=t<=b, divided by t_last-t_first)": sample_span_trapezoid_mean,
    "edge-interpolated for forecasts too (one-sample look-ahead)": window_mean,
}
