"""Compare a new heat-flux trace with an archived one on a time window (T6).

Pure function, no I/O: the live GX feature calls it with GX samples already converted to
archive units (``units.gx_to_archive``). Both traces must be in the same units.

Verdicts (equivalence testing, TOST):

* ``no claim`` — either side has divergent restart repeats, is not covered, not shown
  stationary, has no finite stderr, or has N_eff (at the tau upper bound) below 20.
* ``agree`` — the ``1 - 2*alpha`` confidence interval of ``delta = mean_new - mean_archive``
  lies inside ``(-margin, +margin)``, i.e. both one-sided tests at level ``alpha`` reject a
  difference of at least ``margin`` (``margin`` defaults to 10 % of ``|mean_archive|``).
* ``disagree`` — not ``agree`` and the two-sided ``1 - alpha`` interval excludes 0.
* ``inconclusive`` — neither: the uncertainty is too large to show equivalence or difference.

Intervals use Student-t critical values with Welch–Satterthwaite degrees of freedom from the
two sides' ``N_eff - 1``.
"""
from __future__ import annotations

import math
from collections.abc import Sequence

from .stats import ALPHA, N_EFF_MIN, WindowStats, drop_restart_repeats, t_ppf, window_stats

DEFAULT_MARGIN_FRACTION = 0.10

TraceLike = tuple[Sequence[float], Sequence[float]]


def _stats_dict(s: WindowStats | None) -> dict | None:
    if s is None:
        return None
    return {"covered": s.covered, "nSamples": s.n_samples, "mean": s.mean, "stderr": s.stderr,
            "nEff": s.n_eff, "nEffLower": s.n_eff_lower, "stationary": s.stationary,
            "saturatedClaimAllowed": s.saturated_claim_allowed, "detail": s.detail}


def welch_df(se1: float, df1: float, se2: float, df2: float) -> float:
    num = (se1**2 + se2**2) ** 2
    den = se1**4 / df1 + se2**4 / df2
    return num / den if den > 0 else math.inf


def equivalence_verdict(delta: float, se: float, df: float, margin: float,
                        alpha: float = ALPHA) -> dict:
    """TOST equivalence + two-sided difference test on ``delta`` with standard error ``se``."""
    t_one = t_ppf(1.0 - alpha, df)
    t_two = t_ppf(1.0 - alpha / 2.0, df)
    ci_equiv = (delta - t_one * se, delta + t_one * se)
    ci_diff = (delta - t_two * se, delta + t_two * se)
    if -margin < ci_equiv[0] and ci_equiv[1] < margin:
        verdict = "agree"
        why = (f"{100 * (1 - 2 * alpha):.0f}% CI of delta [{ci_equiv[0]:.4g}, {ci_equiv[1]:.4g}] lies within "
               f"±{margin:.4g} (TOST, alpha {alpha:g})")
    elif ci_diff[0] > 0 or ci_diff[1] < 0:
        verdict = "disagree"
        why = (f"{100 * (1 - alpha):.0f}% CI of delta [{ci_diff[0]:.4g}, {ci_diff[1]:.4g}] excludes 0 and "
               f"equivalence within ±{margin:.4g} is not shown")
    else:
        verdict = "inconclusive"
        why = (f"{100 * (1 - alpha):.0f}% CI of delta [{ci_diff[0]:.4g}, {ci_diff[1]:.4g}] includes 0 but the "
               f"{100 * (1 - 2 * alpha):.0f}% CI [{ci_equiv[0]:.4g}, {ci_equiv[1]:.4g}] is not within "
               f"±{margin:.4g}: uncertainty too large")
    return {"verdict": verdict, "reason": why, "ciEquivalence": list(ci_equiv), "ciDifference": list(ci_diff),
            "df": df}


def compare_window(new: TraceLike, archive: TraceLike, window: Sequence[float], *,
                   margin_fraction: float = DEFAULT_MARGIN_FRACTION, alpha: float = ALPHA) -> dict:
    """Verdict for two ``(t, Q)`` traces on ``window`` (see module docstring).

    Returns ``verdict`` in {"agree", "disagree", "inconclusive", "no claim"}, ``delta``,
    ``combinedStderr``, ``margin``, ``df``, confidence intervals, a ``reason`` and both sides'
    window statistics. Restart repeats are removed first; divergent repeats give "no claim".
    """
    w = (float(window[0]), float(window[1]))
    out = {"window": list(w), "verdict": "no claim", "delta": None, "combinedStderr": None, "margin": None,
           "marginFraction": margin_fraction, "df": None, "ciEquivalence": None, "ciDifference": None,
           "reason": "", "new": None, "archive": None}
    sides = {}
    problems = []
    for label, tr in (("new", new), ("archive", archive)):
        d = drop_restart_repeats(tr[0], tr[1])
        if d.n_divergent:
            problems.append(f"{label} trace has divergent restart repeats: {d.detail}")
            continue
        sides[label] = window_stats(d.t, d.q, w)
    if problems:
        out["reason"] = "; ".join(problems)
        out["new"], out["archive"] = _stats_dict(sides.get("new")), _stats_dict(sides.get("archive"))
        return out
    sn, sa = sides["new"], sides["archive"]
    out["new"], out["archive"] = _stats_dict(sn), _stats_dict(sa)
    if sn.mean is not None and sa.mean is not None:
        out["delta"] = sn.mean - sa.mean
        out["margin"] = margin_fraction * abs(sa.mean)
    if sn.stderr is not None and sa.stderr is not None:
        out["combinedStderr"] = math.hypot(sn.stderr, sa.stderr)

    for label, s in (("new", sn), ("archive", sa)):
        if not s.covered:
            problems.append(f"{label} trace does not cover {w[0]:.10g}-{w[1]:.10g}")
        elif s.stationary is not True:
            problems.append(f"{label} trace not shown stationary on {w[0]:.10g}-{w[1]:.10g}")
        elif s.stderr is None:
            problems.append(f"{label} trace has no finite sampling uncertainty")
        elif not s.saturated_claim_allowed:
            neff = ("not established (uncorrected-tau fallback)" if s.n_eff_lower is None
                    else f"{s.n_eff_lower:.3g} < {N_EFF_MIN:g}")
            problems.append(f"{label} trace N_eff at the tau upper bound is {neff}: "
                            "uncertainty too approximate for a claim")
    if problems:
        out["reason"] = "; ".join(problems)
        return out
    df = welch_df(sn.stderr, sn.df, sa.stderr, sa.df)
    res = equivalence_verdict(out["delta"], out["combinedStderr"], df, out["margin"], alpha)
    out.update(verdict=res["verdict"], df=df, ciEquivalence=res["ciEquivalence"],
               ciDifference=res["ciDifference"],
               reason=f"{res['reason']}; margin = {margin_fraction:g} x |archive mean| = {out['margin']:.4g}")
    return out
