"""Live comparison of this session's GX bean samples with the archived stella and GENE traces (D-024, cross-RX-2).

PRD "Check transport": compare time-weighted means on 200–300 and 300–400 when covered; claim saturated agreement
only for a covered stationary window with sampling uncertainty. Nothing here defines a statistic of its own:

* the live window fields are `transport.stats.window_stats` on the live trace after `drop_restart_repeats`
  (coverage, D-013 mean, Sokal stderr, N_eff and N_eff at the tau upper bound, half-split stationarity, claim gate);
* every verdict, delta and archive mean / stderr is `transport.compare.compare_window(live, archive, window)`
  unchanged (TOST equivalence, margin 0.10 x |archive mean|, D-017 gate on both sides);
* the archive is the committed traces (`transport.archive.load_trace`), read once; tests may inject their own.

The samples are already in archive units (the orchestrator converts GX t x sqrt(2), Q / 2 sqrt(2)). The result is
exactly the `comparison` object of contracts/live-status.schema.json: every number a finite Python float (or None),
every count a Python int, so a snapshot always serialises with `allow_nan=False`.

`live_comparison` never raises. Any error — divergent repeated live sample times, a malformed sample, a broken
archive mapping, a non-finite statistic — gives the same object with `windows: []`, `saturatedClaimAllowed: false`
and a reason that starts "Live comparison could not be computed:", so a status answer never fails because of it.

The top-level `saturatedClaimAllowed` is true ONLY when some window's verdict against some archive trace is
"agree" (which already requires both traces to pass the claim gate). With the committed archive that never
happens: its 200–300 and 300–400 windows are not shown stationary and their N_eff is not established, so the >= 20
gate is not met (D-017), and every verdict is
"no claim" whatever the live trace does, and the reason says so.
"""
from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from functools import cache
from types import MappingProxyType
from typing import Any

from ..transport.archive import load_trace
from ..transport.compare import DEFAULT_MARGIN_FRACTION, compare_window
from ..transport.stats import ALPHA, METHOD_SUMMARY, N_EFF_MIN, WindowStats, coverage, drop_restart_repeats, window_stats

WINDOWS: tuple[tuple[float, float], ...] = ((200.0, 300.0), (300.0, 400.0))
ARCHIVE_CODES: tuple[str, ...] = ("stella", "GENE")
TUBE = "bean"
MARGIN_FRACTION = DEFAULT_MARGIN_FRACTION
FAILED = "Live comparison could not be computed"
MAX_ERROR_CHARS = 300
METHOD = (
    "Live bean samples (archive units: GX t x sqrt(2), Q / 2 sqrt(2); restart repeats dropped) against the archived "
    "stella and GENE bean traces on 200–300 and 300–400. Per window, " + METHOD_SUMMARY + ". Verdict per archive trace "
    f"(transport.compare.compare_window): TOST equivalence — agree only if the {100 * (1 - 2 * ALPHA):.0f}% CI of "
    f"delta = live mean - archive mean lies within ±margin, margin = {MARGIN_FRACTION:g} x |archive mean| (alpha "
    f"{ALPHA:g} per one-sided test); disagree if not agree and the {100 * (1 - ALPHA):.0f}% CI excludes 0; otherwise "
    "inconclusive; no claim unless both traces are covered, stationary, with finite stderr and N_eff >= "
    f"{N_EFF_MIN:g} at the tau upper bound; Student-t with Welch–Satterthwaite df. A saturated-agreement claim needs "
    "an agree verdict."
)

ArchiveTraces = Mapping[str, tuple[Sequence[float], Sequence[float]]]


@cache
def committed_archive() -> Mapping[str, tuple[Any, Any]]:
    """The committed archive traces (read-only arrays, restart repeats dropped), loaded once: the archive is fixed."""
    return MappingProxyType({code: (load_trace(code).t, load_trace(code).q) for code in ARCHIVE_CODES})


def window_label(window: Sequence[float]) -> str:
    return f"{float(window[0]):g}–{float(window[1]):g}"


def _num(x: Any) -> float | None:
    """A finite Python float, or None (None, a bool, or a value that is not finite): for statistics whose null means
    "not finite / not established" (stderr, N_eff)."""
    if x is None or isinstance(x, bool):
        return None
    x = float(x)
    return x if math.isfinite(x) else None


def _value(x: Any, what: str) -> float | None:
    """A finite Python float, or None for None. A mean or delta is null only when it does not exist (window not
    covered): one that overflowed is an error, so the whole comparison says it could not be computed."""
    if x is None:
        return None
    x = float(x)
    if not math.isfinite(x):
        raise ValueError(f"{what} is not finite ({x!r})")
    return x


def _header(samples: Any) -> dict:
    """tube / nSamples / tStart / tEnd / marginFraction / method; never raises (also used on the error path)."""
    try:
        n = len(samples)
    except Exception:  # noqa: BLE001 - the error path must answer whatever it was given
        n = 0
    t_start = t_end = None
    if n:
        try:
            t_start, t_end = _num(samples[0]["t"]), _num(samples[-1]["t"])
        except Exception:  # noqa: BLE001
            t_start = t_end = None
    return {"tube": TUBE, "nSamples": int(n), "tStart": t_start, "tEnd": t_end, "marginFraction": float(MARGIN_FRACTION),
            "method": METHOD}


def _neff_text(n_eff_lower: float | None) -> str:
    if n_eff_lower is None:
        return "N_eff not established"
    return f"N_eff {n_eff_lower:.3g} < {N_EFF_MIN:g}" if n_eff_lower < N_EFF_MIN else f"N_eff {n_eff_lower:.3g}"


UNCOVERED = "does not cover the window"


def _gate_problem(s: dict | None) -> tuple[str, str | None] | None:
    """Why one side's window statistics (compare_window's `new` / `archive` dict) keep the claim gate shut, as
    (problem, qualifier or None), or None when that side passes the gate. Checked in compare_window's order:
    coverage, stationarity, stderr, N_eff at the tau upper bound."""
    if s is None:
        return "has divergent restart repeats", None
    if not s["covered"]:
        return UNCOVERED, None
    if s["stationary"] is False:
        return "not stationary", "half-split test"
    if s["stationary"] is None:
        n = s["nEffLower"]
        return "not shown stationary", ("stationarity test indicative only" if n is not None and n >= N_EFF_MIN
                                         else _neff_text(n))
    if s["stderr"] is None:
        return "has no finite sampling uncertainty", None
    if not s["saturatedClaimAllowed"]:
        return f"has {_neff_text(s['nEffLower'])} at the tau upper bound", None
    return None


def _phrase(problem: str, qualifiers: list[str]) -> str:
    return f"{problem} ({'; '.join(qualifiers)})" if qualifiers else problem


def _live_stats_dict(ws: WindowStats) -> dict:
    return {"covered": ws.covered, "stationary": ws.stationary, "stderr": ws.stderr, "nEffLower": ws.n_eff_lower,
            "saturatedClaimAllowed": ws.saturated_claim_allowed}


def _window_reason(label: str, live_t: Any, window: Sequence[float], ws: WindowStats,
                   results: list[tuple[str, dict]]) -> str:
    """One window's part of the top-level "no claim" reason: what keeps each side's gate shut, else the verdicts."""
    parts = []
    live = _gate_problem(_live_stats_dict(ws))
    if live is not None:
        problem, qualifier = live
        if problem == UNCOVERED:
            qualifier = coverage(live_t, window)[1].removeprefix("not covered: ")
        parts.append("live trace " + _phrase(problem, [qualifier] if qualifier else []))
    by_problem: dict[tuple[str, str | None], list[str]] = {}
    for code, res in results:
        problem = _gate_problem(res["archive"])
        if problem is not None:
            by_problem.setdefault(problem, []).append(code)
    for (problem, qualifier), codes in by_problem.items():
        parts.append(f"archive {' and '.join(codes)} " + _phrase(problem, [q for q in (qualifier, "D-017 gate") if q]))
    if not parts:  # both sides pass the gate: the verdicts themselves say why there is no agreement
        parts = [f"{res['verdict']} vs {code}" for code, res in results]
    return f"{label}: " + "; ".join(parts)


def _archive_entry(code: str, label: str, res: dict) -> dict:
    stats = res["archive"] or {}
    return {"code": code, "mean": _value(stats.get("mean"), f"{code} archive mean on {label}"),
            "stderr": _num(stats.get("stderr")), "delta": _value(res["delta"], f"live - {code} mean on {label}"),
            "verdict": str(res["verdict"]), "reason": str(res["reason"])}


def _window_entry(window: Sequence[float], ws: WindowStats, results: list[tuple[str, dict]]) -> dict:
    stationary = None if ws.stationary is None else bool(ws.stationary)
    label = window_label(window)
    return {
        "window": [float(window[0]), float(window[1])],
        "covered": bool(ws.covered),
        "nSamples": int(ws.n_samples),
        "mean": _value(ws.mean, f"live mean on {label}"),
        "stderr": _num(ws.stderr),
        "stderrApproximate": bool(ws.approximate),
        "nEff": _num(ws.n_eff),
        "nEffLower": _num(ws.n_eff_lower),
        "stationary": stationary,
        "saturatedClaimAllowed": bool(ws.saturated_claim_allowed),
        "detail": str(ws.detail),
        "archive": [_archive_entry(code, label, res) for code, res in results],
    }


def _compute(samples: Sequence[dict], archive: ArchiveTraces | None) -> dict:
    t = [s["t"] for s in samples]
    q = [s["Q"] for s in samples]
    live = drop_restart_repeats(t, q)
    if live.n_divergent:
        raise ValueError(f"the live bean trace has divergent repeated sample times: {live.detail}")
    traces = committed_archive() if archive is None else archive
    arch = {code: (traces[code][0], traces[code][1]) for code in ARCHIVE_CODES}
    windows, agrees, others, reasons = [], [], [], []
    for w in WINDOWS:
        label = window_label(w)
        ws = window_stats(live.t, live.q, w)
        results = [(code, compare_window((live.t, live.q), arch[code], w, margin_fraction=MARGIN_FRACTION))
                   for code in ARCHIVE_CODES]
        windows.append(_window_entry(w, ws, results))
        for code, res in results:
            (agrees if res["verdict"] == "agree" else others).append(f"{label} vs {code}" + (
                "" if res["verdict"] == "agree" else f": {res['verdict']}"))
        reasons.append(_window_reason(label, live.t, w, ws, results))
    if agrees:
        reason = (f"Saturated-agreement claim allowed for {', '.join(agrees)}: both traces are covered, stationary and "
                  f"have N_eff >= {N_EFF_MIN:g}, and the {100 * (1 - 2 * ALPHA):.0f}% CI of live - archive mean lies within "
                  f"±{MARGIN_FRACTION:g} x |archive mean| (TOST). Other verdicts: {'; '.join(others) or 'none'}.")
    else:
        reason = "No saturated-agreement claim. " + ". ".join(reasons) + "."
    return {"saturatedClaimAllowed": bool(agrees), "reason": reason, "windows": windows}


def live_comparison(samples: Sequence[dict], *, archive: ArchiveTraces | None = None) -> dict:
    """The live-status `comparison` object for `samples` (``[{"t", "Q"}, ...]`` in archive units, in arrival order).

    `archive` maps each of ARCHIVE_CODES to a ``(t, Q)`` trace (tests); default: the committed archive. Never raises.
    """
    out = _header(samples)
    try:
        out.update(_compute(samples, archive))
        json.dumps(out, allow_nan=False)  # every value JSON can carry: a snapshot must always serialise
    except Exception as e:  # noqa: BLE001 - a status answer never fails because of the comparison (D-024)
        try:
            message = f"{type(e).__name__}: {e}"
        except Exception:  # noqa: BLE001 - an exception whose text cannot be rendered
            message = type(e).__name__
        if len(message) > MAX_ERROR_CHARS:
            message = message[:MAX_ERROR_CHARS] + "…"
        out = _header(samples)
        out.update(saturatedClaimAllowed=False, reason=f"{FAILED}: {message}", windows=[])
    return out
