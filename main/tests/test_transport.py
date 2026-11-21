"""02 · Check transport — backend outcomes T1–T7 (tasks/02-transport/TASK.md)."""
import math

import h5py
import numpy as np
import pytest

from labyrinth_main.common.paths import STELLA_BENCHMARK_H5
from labyrinth_main.features.transport import artifact, stats
from labyrinth_main.features.transport.archive import DivergentRestartError, clean_restarts, load_trace
from labyrinth_main.features.transport.compare import compare_window, equivalence_verdict
from labyrinth_main.features.transport.units import gx_to_archive


@pytest.fixture(scope="module")
def art():
    return artifact.build()


def _fx(art, fid):
    return next(f for f in art["fixtures"] if f["id"] == fid)


def _row(art, trace_id, window):
    return next(r for r in art["windows"] if r["traceId"] == trace_id and r["window"] == list(window))


def _ar1(rng, n, phi, mean=0.0):
    """Stationary AR(1); tau_int (samples) = (1+phi)/(2(1-phi)), Var = 1/(1-phi^2)."""
    e = rng.normal(size=n)
    x = np.empty(n)
    x[0] = e[0] / math.sqrt(1 - phi**2)
    for i in range(1, n):
        x[i] = phi * x[i - 1] + e[i]
    return x + mean


PHI_TAU7 = 13 / 15  # tau_int = 7 samples


# ------------------------------------------------------------------------------------------ T1
def test_T1_traces_read_from_pinned_h5_with_units_and_gradients(art):
    with h5py.File(STELLA_BENCHMARK_H5, "r") as f:
        raw = {c: (f[f"compared/test5/{c}/t"][()], f[f"compared/test5/{c}/Q"][()]) for c in ("stella", "GENE")}
    assert art["units"] == {"time": "t v_th,i/a", "heatFlux": "Q_i/Q_gB,i"}
    by_code = {tr["code"]: tr for tr in art["traces"]}
    assert set(by_code) == {"stella", "GENE"}
    for code, (t_raw, q_raw) in raw.items():
        tr = load_trace(code)
        assert np.all(np.diff(tr.t) > 0)
        assert np.isin(tr.t, t_raw).all() and np.isin(tr.q, q_raw).all()
        assert sorted(set(t_raw.tolist())) == tr.t.tolist()
        assert len(tr.t) + tr.n_dropped_duplicates == len(t_raw)
        assert tr.tgrad == 3 and tr.ngrad == 1
        prov = by_code[code]["provenance"]
        assert prov["kind"] == "archive"
        assert "tgrad=3" in prov["coverage"]["description"] and "ngrad=1" in prov["coverage"]["description"]
        assert "Q_i/Q_gB,i" in prov["units"] and "t v_th,i/a" in prov["units"]
        assert prov["coverage"]["tStart"] == 0.0 and prov["coverage"]["tEnd"] == pytest.approx(t_raw.max())
        assert prov["sources"][0]["path"].endswith("stella_benchmark_DOI_10_1017_S0022377822000393.h5")
        assert len(by_code[code]["t"]) == len(by_code[code]["Q"]) == len(tr.t)
    assert "6f60964d" in by_code["stella"]["provenance"]["solverRevision"]
    assert "unknown" in by_code["GENE"]["provenance"]["solverRevision"]
    # stella archive has two 4-sample restart overlaps whose t AND Q repeat earlier samples.
    assert load_trace("stella").n_dropped_duplicates == 8
    assert load_trace("GENE").n_dropped_duplicates == 0


def test_T1_divergent_restart_is_refused_not_silently_dropped():
    t = np.array([0.0, 1.0, 2.0, 3.0, 2.0, 3.0, 4.0])
    same = np.array([5.0, 6.0, 7.0, 8.0, 7.0, 8.0, 9.0])
    tt, qq, n = clean_restarts(t, same, "synthetic")
    assert n == 2 and tt.tolist() == [0, 1, 2, 3, 4] and qq.tolist() == [5, 6, 7, 8, 9]
    diverged = same.copy()
    diverged[4] = 7.5  # restart re-wrote t=2 with a different Q
    d = stats.drop_restart_repeats(t, diverged)
    assert d.n_dropped == 2 and d.n_divergent == 1 and "index 4" in d.detail
    with pytest.raises(DivergentRestartError):
        clean_restarts(t, diverged, "synthetic")
    off_grid = np.array([0.0, 1.0, 2.0, 1.5, 3.0])  # jumps back to a time never sampled
    assert stats.drop_restart_repeats(off_grid, np.arange(5.0)).n_divergent == 1


# ------------------------------------------------------------------------------------------ T2
def test_T2_time_weighted_means_reproduce_fixtures(art):
    s, g = load_trace("stella"), load_trace("GENE")
    assert stats.window_mean(s.t, s.q, (1500, 1900)) == pytest.approx(2.24213, abs=5e-5)
    assert stats.window_mean(g.t, g.q, (1500, 1893.765)) == pytest.approx(2.47386, abs=5e-5)
    assert round(stats.sample_span_trapezoid_mean(s.t, s.q, (1500, 1900)), 3) == 2.242
    assert round(stats.sample_span_trapezoid_mean(g.t, g.q, (1500, 1893.765)), 3) == 2.474
    for fid in ("stella-bean-1500-1900", "gene-bean-1500-1893.765"):
        fx = _fx(art, fid)
        assert fx["matches"] is True and fx["printedDecimals"] == 3
        assert fx["computed"] == stats.window_mean(*(
            (s.t, s.q, (1500, 1900)) if fid.startswith("stella") else (g.t, g.q, (1500, 1893.765))))
    with pytest.raises(ValueError):
        stats.window_mean(g.t, g.q, (1500, 1900))  # not covered: GENE ends at 1893.765


def test_T2_window_mean_equals_analytic_integral_for_piecewise_linear_Q():
    t = np.array([0.0, 1.0, 3.0, 4.0, 7.0])
    q = np.array([0.0, 2.0, 2.0, 5.0, -1.0])

    def Q(x):
        i = min(max(int(np.searchsorted(t, x, side="right")) - 1, 0), len(t) - 2)
        return q[i] + (q[i + 1] - q[i]) * (x - t[i]) / (t[i + 1] - t[i])

    def integral(a, b):
        pts = [a] + [x for x in t if a < x < b] + [b]
        return sum(0.5 * (Q(x0) + Q(x1)) * (x1 - x0) for x0, x1 in zip(pts[:-1], pts[1:], strict=True))

    # Hand-checked value for [0.5, 5.5]: 0.5-1: 0.75, 1-3: 4, 3-4: 3.5, 4-5.5 (Q 5→2): 5.25 → 13.5.
    assert integral(0.5, 5.5) == pytest.approx(13.5)
    for a, b in [(0.5, 5.5), (0.25, 0.75), (1.5, 6.9), (0.0, 7.0), (3.0, 4.0)]:
        assert stats.window_mean(t, q, (a, b)) == pytest.approx(integral(a, b) / (b - a), rel=1e-12)
    assert stats.window_mean(t, 2 * t + 1, (0.3, 6.1)) == pytest.approx(2 * 3.2 + 1)
    # One-sided right edge holds the last sample <= b: [0.5, 2.0] → Q(b) = 2 (held from t=1).
    assert stats.window_mean(t, q, (0.5, 5.5), right_edge="hold") == pytest.approx(
        (0.75 + 4 + 3.5 + 5 * 1.5) / 5)


# ------------------------------------------------------------------------------------------ T3
def test_T3_window_stats_coverage_stderr_stationarity_and_claim_gate(art):
    expected = {("stella-bean", w) for w in [(200, 300), (300, 400), (1500, 1900)]} | \
               {("gene-bean", w) for w in [(200, 300), (300, 400), (1500, 1900), (1500, 1893.765)]}
    assert {(r["traceId"], tuple(r["window"])) for r in art["windows"]} == expected
    for r in art["windows"]:
        tr = load_trace("stella" if r["traceId"].startswith("stella") else "GENE")
        ws = stats.window_stats(tr.t, tr.q, r["window"])
        finite = r["stderr"] is not None and math.isfinite(r["stderr"]) and r["stderr"] > 0
        gate = r["covered"] and r["stationary"] is True and finite and ws.n_eff_lower is not None \
            and ws.n_eff_lower >= stats.N_EFF_MIN
        assert r["saturatedClaimAllowed"] == gate
        assert "Sokal" in r["stationarityDetail"] and "half-split" in r["stationarityDetail"].lower()
        if r["stderr"] is not None:  # serialised to 4 significant figures (item 13)
            assert r["stderr"] == float(f"{r['stderr']:.3e}")
        if r["covered"] and ws.approximate and r["stderr"] is not None:
            assert "APPROXIMATE" in r["stationarityDetail"]
    gene_long = _row(art, "gene-bean", (1500, 1900))
    assert gene_long["covered"] is False and gene_long["mean"] is None and not gene_long["saturatedClaimAllowed"]
    # On the archive, the autocorrelation time (10–20 time units) leaves at most ~15 effective
    # samples per window: no window reaches N_eff >= 20, so no saturated claim is allowed.
    assert not any(r["saturatedClaimAllowed"] for r in art["windows"])
    # An indicative stationarity test (N_eff < 20 or uncorrected-tau fallback) is serialised as
    # undecidable (null), never as a boolean; the t statistic stays in the detail text.
    for r in art["windows"]:
        if "indicative" in r["stationarityDetail"]:
            assert r["stationary"] is None and "t=" in r["stationarityDetail"]
    g = _row(art, "gene-bean", (1500, 1893.765))
    assert g["stationary"] is None and "indicative" in g["stationarityDetail"]
    # The early GENE transient (half means 2.985 vs 2.867) must not ship as stationary.
    assert _row(art, "gene-bean", (200, 300))["stationary"] is not True


def test_T3_edge_hole_window_not_covered():
    s = load_trace("stella")
    assert stats.window_covered(s.t, (200, 300)) is True
    keep = ~((s.t > 195) & (s.t < 285))
    t, q = s.t[keep], s.q[keep]
    assert ((t >= 200) & (t <= 300)).sum() >= stats.MIN_SAMPLES  # enough samples remain inside
    ok, why = stats.coverage(t, (200, 300))
    assert ok is False and "gap" in why
    ws = stats.window_stats(t, q, (200, 300))
    assert ws.covered is False and ws.mean is None and not ws.saturated_claim_allowed


def test_T3_claim_gate_and_stderr_calibration_monte_carlo():
    # Small N (N=68, tau=7 samples, true N_eff≈4.9): the Sokal stderr is biased low here, so the
    # gate must (almost) never allow a claim.
    rng = np.random.default_rng(20261120)
    t = np.arange(68, dtype=float)
    claims = sum(stats.window_stats(t, _ar1(rng, 68, PHI_TAU7), (0, 67)).saturated_claim_allowed
                 for _ in range(1000))
    assert claims / 1000 <= 0.02
    # Large N (N=2000, phi=0.8, tau=4.5, true N_eff≈222): claims allowed, and the t-interval
    # mean ± t(0.975, N_eff-1)·stderr covers the true mean at close to the nominal 95 %.
    rng = np.random.default_rng(20261121)
    t = np.arange(2000, dtype=float)
    covered = allowed = 0
    reps = 300
    for _ in range(reps):
        ws = stats.window_stats(t, _ar1(rng, 2000, 0.8), (0, 1999))
        allowed += ws.saturated_claim_allowed
        covered += abs(ws.mean) <= stats.t_ppf(0.975, ws.df) * ws.stderr
    assert allowed / reps >= 0.9
    assert 0.91 <= covered / reps <= 0.985
    # The Student-t quantiles used for the intervals are correct.
    assert stats.t_ppf(0.975, 10) == pytest.approx(2.228139, abs=1e-5)
    assert stats.t_ppf(0.975, 1e6) == pytest.approx(1.959964, abs=1e-5)


def test_T3_n_eff_never_exceeds_the_samples_in_the_window_so_a_sparse_trace_cannot_claim():
    """D-025 (06 verifier F4-1): a few noisy samples can give a negative lag-1 autocorrelation and a Sokal tau_int below
    half a sample; unfloored, N_eff exceeded the sample count (up to ~250x) and 12-25 white-noise samples opened the
    N_eff >= 20 claim gate in 13-38 of 200 seeds. tau_int is floored at 1/2 sample: N_eff <= N - 1, never a claim."""
    finite = floored_seen = 0
    for n in (12, 14, 15, 20, 25):
        for seed in range(200):
            rng = np.random.default_rng(seed)
            t = np.linspace(299.0, 401.0, n + 2)  # n samples inside [300, 400], one bracketing sample each side
            q = 2.5 + 0.1 * rng.standard_normal(n + 2)
            err = stats.sampling_error(t, q, (300.0, 400.0))
            ws = stats.window_stats(t, q, (300.0, 400.0))
            st = stats.half_split_test(t, q, (300.0, 400.0))
            assert ws.n_samples == n and ws.saturated_claim_allowed is False, (n, seed)
            assert st.n_eff is None or st.n_eff <= n - 1 + 1e-9, (n, seed, st.n_eff)
            assert (err.n_eff is None) == (err.stderr is None)  # a Sokal window that was never reached: no N_eff at all
            if err.n_eff is not None:
                finite += 1
                assert err.n_eff <= n - 1 + 1e-9, (n, seed, err.n_eff)
                assert err.n_eff_lower is None or err.n_eff_lower < err.n_eff
                s = float(np.std(np.interp(np.linspace(300, 400, n), t, q), ddof=1))
                assert err.stderr >= s / math.sqrt(n - 1) - 1e-12  # never below the independent-samples stderr
            if err.floored:
                floored_seen += 1
                assert "raised to the floor of 0.5 sample" in ws.detail and "D-025" in ws.detail
                assert err.tau_time == pytest.approx(stats.TAU_INT_MIN * 100.0 / (n - 1))
    assert finite > 800 and floored_seen > 100  # both paths are exercised (the raw estimate was often below 1/2 sample)
    # A converged estimate <= 0 (alternating samples: lag-1 correlation -1) is floored too, not reported as "Sokal window
    # not reached"; the Madras-Sokal bound of a floored tau uses the window the floor needs, M = 3, not the raw lag 1.
    n, dt = 12, 100.0 / 11
    t = 300.0 + dt * np.arange(-1, n + 1)  # 12 samples exactly on [300, 400], one bracketing sample each side
    q = 2.5 + 0.1 * (-1.0) ** np.arange(n + 2)
    err = stats.sampling_error(t, q, (300.0, 400.0))
    assert (err.floored, err.converged, err.window_lag) == (True, True, 1)
    assert err.n_eff == pytest.approx(n - 1) and err.tau_time == pytest.approx(0.5 * dt)
    assert err.n_eff_lower == pytest.approx(100.0 / (2 * 0.5 * dt * (1 + math.sqrt(2 * (2 * 3 + 1) / n))))
    assert "raised to the floor of 0.5 sample" in stats.window_stats(t, q, (300.0, 400.0)).detail
    # Long traces are unaffected: an AR(1) with tau ~4.5 samples keeps its N_eff and its claim.
    t = np.arange(2000, dtype=float)
    ws = stats.window_stats(t, _ar1(np.random.default_rng(20261121), 2000, 0.8), (0, 1999))
    assert ws.saturated_claim_allowed and not stats.sampling_error(t, _ar1(np.random.default_rng(20261121), 2000, 0.8),
                                                                    (0, 1999)).floored
    assert "1/2 sample (D-025" in stats.METHOD_SUMMARY


def test_T3_half_split_keeps_its_level_on_short_white_noise():
    """D-025 review R1: where a tau floor would bind (white noise, 40-60 samples) the half-split test must keep its 5 %
    level. Its se uses the unfloored tau; flooring it widened se and dropped the false-rejection rate to ~1 %, which
    let more drifting windows pass as stationary (and reach a claim). The reported N_eff is still capped at N - 1."""
    rejected = decided = total = 0
    for n in (40, 50, 60):
        t = np.arange(float(n))
        rng = np.random.default_rng(20261123)
        for _ in range(1000):
            st = stats.half_split_test(t, rng.standard_normal(n), (0.0, n - 1.0))
            assert st.n_eff is None or st.n_eff <= n - 1  # None: no usable tau (undecidable), never a rejection
            decided += st.stationary is not None
            rejected += st.stationary is False
            total += 1
    assert decided > 0.9 * total
    assert 0.025 <= rejected / total <= 0.075, rejected / total  # measured 0.039 (nominal alpha 0.05)


def test_T3_stationarity_false_rejection_rate_at_small_n():
    rng = np.random.default_rng(20261122)
    t = np.arange(68, dtype=float)
    reps = 1000
    # The raw test decision (before window_stats masks indicative results as undecidable).
    rejected = sum(stats.half_split_test(t, _ar1(rng, 68, PHI_TAU7), (0, 67)).stationary is False
                   for _ in range(reps))
    assert rejected / reps <= 0.07
    # window_stats never reports a boolean from such an indicative test.
    assert stats.window_stats(t, _ar1(rng, 68, PHI_TAU7), (0, 67)).stationary is None
    # ... and the test still has power: a step between the halves of a long trace is rejected.
    t = np.arange(2000, dtype=float)
    x = _ar1(np.random.default_rng(5), 2000, 0.8)
    assert stats.window_stats(t, x, (0, 1999)).stationary is True
    ws = stats.window_stats(t, x + np.where(t > 1000, 1.0, 0.0), (0, 1999))
    assert ws.stationary is False and ws.saturated_claim_allowed is False


# ------------------------------------------------------------------------------------------ T4
def test_T4_reduced_modal_run_against_archive_and_fixtures(art):
    rm = art["reducedModalRun"]
    assert rm["value"] == 5.79 and rm["window"] == [300.0, 400.0]
    assert rm["provenance"]["kind"] == "prd-reported" and rm["provenance"]["verification"]["outcome"] == "blocked"
    assert rm["archive"]["stella"] == pytest.approx(2.55454, abs=5e-5)
    assert rm["archive"]["GENE"] == pytest.approx(2.67507, abs=5e-5)
    st, ge = _fx(art, "stella-bean-300-400"), _fx(art, "gene-bean-300-400")
    assert st["claimed"] == 2.55 and st["matches"] is True
    assert ge["claimed"] == 2.68 and ge["matches"] is True
    assert "2.67429" in ge["note"] and "definition-sensitive" in ge["note"]
    assert _fx(art, "reduced-modal-stella-300-400")["matches"] is None


# ------------------------------------------------------------------------------------------ T5
def test_T5_gx_to_archive_converts_and_refuses_without_identical_references(art):
    t, q = gx_to_archive([1.0, 2.0], [2.0 * math.sqrt(2), 4.0], identical_references=True)
    assert t == pytest.approx([math.sqrt(2), 2 * math.sqrt(2)])
    assert q == pytest.approx([1.0, math.sqrt(2)])
    for bad in (False, None, 1, "yes", "True", [True]):  # only the literal True is accepted
        with pytest.raises(ValueError):
            gx_to_archive([1.0], [1.0], identical_references=bad)
    uc = art["unitConversion"]
    assert uc["timeMultiplier"] == pytest.approx(math.sqrt(2))
    assert uc["heatFluxDivisor"] == pytest.approx(2 * math.sqrt(2))
    assert "identical" in uc["validity"] or "equal" in uc["validity"]


# ------------------------------------------------------------------------------------------ T6
def test_T6_compare_window_tost_verdicts_and_no_claim():
    rng = np.random.default_rng(7)
    t = np.arange(20000, dtype=float)
    x = _ar1(rng, 20000, 0.8, mean=3.0)
    same = compare_window((t, x), (t, x), (0, 19999))
    assert same["verdict"] == "agree" and same["delta"] == 0.0
    assert same["margin"] == pytest.approx(0.1 * abs(same["archive"]["mean"]))
    assert "margin = 0.1 x |archive mean|" in same["reason"]
    assert same["combinedStderr"] == pytest.approx(math.sqrt(2) * stats.window_stats(t, x, (0, 19999)).stderr)
    assert compare_window((t, x + 1.0), (t, x), (0, 19999))["verdict"] == "disagree"
    tight = compare_window((t, x), (t, x), (0, 19999), margin_fraction=0.001)
    assert tight["verdict"] == "inconclusive" and tight["marginFraction"] == 0.001
    # Huge uncertainty: 3.54 vs 2.24 with stderr 0.77 can neither show equivalence nor difference.
    huge = equivalence_verdict(3.54 - 2.24, 0.77, 30.0, 0.1 * 2.24)
    assert huge["verdict"] == "inconclusive"
    assert huge["ciDifference"][0] < 0 < huge["ciDifference"][1]
    # Archive: every window has N_eff < 20 → no claim; uncovered → no claim.
    s, g = load_trace("stella"), load_trace("GENE")
    arch = compare_window((s.t, s.q), (g.t, g.q), (1500, 1893.765))
    assert arch["verdict"] == "no claim" and "not shown stationary" in arch["reason"]
    assert arch["delta"] == pytest.approx(arch["new"]["mean"] - arch["archive"]["mean"])
    unc = compare_window((s.t, s.q), (g.t, g.q), (1500, 1900))
    assert unc["verdict"] == "no claim" and "cover" in unc["reason"]
    short = compare_window((s.t[:50], s.q[:50]), (s.t, s.q), (300, 400))
    assert short["verdict"] == "no claim"


def test_T6_compare_window_dedups_repeats_and_refuses_divergent():
    rng = np.random.default_rng(8)
    t = np.arange(20000, dtype=float)
    x = _ar1(rng, 20000, 0.8, mean=3.0)
    i = 10000
    t_rep = np.concatenate([t[:i], t[i - 5:i], t[i:]])  # restart repeats 5 samples
    x_rep = np.concatenate([x[:i], x[i - 5:i], x[i:]])
    ref = compare_window((t, x), (t, x), (0, 19999))
    rep = compare_window((t_rep, x_rep), (t, x), (0, 19999))  # no exception; identical result
    assert rep["verdict"] == ref["verdict"] == "agree" and rep["delta"] == 0.0
    x_div = x_rep.copy()
    x_div[i + 2] += 0.5  # a repeated sample whose Q differs from the original
    div = compare_window((t_rep, x_div), (t, x), (0, 19999))
    assert div["verdict"] == "no claim" and "divergent restart" in div["reason"]


def test_T6_null_false_disagree_rate_near_nominal():
    rng = np.random.default_rng(20261123)
    t = np.arange(2000, dtype=float)
    # margin 0: equivalence can never be shown, so the two-sided difference test alone decides
    # between "disagree" and "inconclusive"; under the null "disagree" should be ~5 %.
    verdicts = [compare_window((t, _ar1(rng, 2000, 0.8, 3.0)), (t, _ar1(rng, 2000, 0.8, 3.0)), (0, 1999),
                               margin_fraction=0.0)["verdict"] for _ in range(300)]
    claims = [v for v in verdicts if v != "no claim"]
    assert len(claims) >= 240 and "agree" not in claims
    assert 0.01 <= sum(v == "disagree" for v in claims) / len(claims) <= 0.09


# ------------------------------------------------------------------------------------------ T7
def test_T7_triangular_published_mean_only(art):
    tri = art["triangular"]
    assert tri["publishedMean"] == 2.22 and tri["window"] == [1200.0, 1500.0]
    assert tri["rawTraceStatus"] == "unverified"
    assert tri["source"]["url"] == "PRD.md"
    assert "PRD-reported; not checked against the paper" in tri["source"]["label"]
    assert all(tr["tube"] == "bean" for tr in art["traces"])
    fx = _fx(art, "triangular-published-1200-1500")
    assert fx["matches"] is None and "not checked against the paper" in fx["note"]
