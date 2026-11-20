"""03 · Forecast replay — backend outcomes F1–F3 (tasks/03-forecast/TASK.md)."""
import numpy as np
import pytest

from labyrinth_main.features.forecast import artifact, model
from labyrinth_main.features.transport.archive import load_trace
from labyrinth_main.features.transport.stats import sample_and_hold_mean, window_mean


@pytest.fixture(scope="module")
def art():
    return artifact.build()


def test_F1_eight_50_unit_steps_from_1500_to_1900_initialised_on_1450_1500(art):
    assert art["traceId"] == "stella-bean"
    assert art["initWindow"] == [1450.0, 1500.0] and art["windowWidth"] == 50.0
    assert [s["window"] for s in art["steps"]] == [[1500.0 + 50 * k, 1550.0 + 50 * k] for k in range(8)]
    tr = load_trace("stella")
    # Contiguous time-weighted windows partition [1450, 1900]: their integrals add up exactly.
    wins = [art["initWindow"]] + [s["window"] for s in art["steps"]]
    total = sum(window_mean(tr.t, tr.q, w) * (w[1] - w[0]) for w in wins)
    assert total == pytest.approx(window_mean(tr.t, tr.q, (1450, 1900)) * 450, rel=1e-12)
    prov = art["provenance"]
    assert prov["kind"] == "derived" and prov["coverage"]["tStart"] == 1450.0 and prov["coverage"]["tEnd"] == 1900.0
    assert "6f60964d" in prov["solverRevision"]


def test_F2_persistence_and_frozen_forecasts_errors_and_mae(art):
    tr = load_trace("stella")

    def causal(w):
        return window_mean(tr.t, tr.q, w, right_edge="hold")

    init = causal((1450, 1500))
    prev = init
    for s in art["steps"]:
        obs = window_mean(tr.t, tr.q, s["window"])
        assert s["observed"] == pytest.approx(obs, rel=1e-12)
        assert s["persistence"] == pytest.approx(prev, rel=1e-12)
        assert s["frozen"] == pytest.approx(init, rel=1e-12)
        assert s["absErrPersistence"] == pytest.approx(abs(obs - prev), rel=1e-12)
        assert s["absErrFrozen"] == pytest.approx(abs(obs - init), rel=1e-12)
        prev = causal(s["window"])
    assert art["mae"]["persistence"] == pytest.approx(np.mean([s["absErrPersistence"] for s in art["steps"]]))
    assert art["mae"]["frozen"] == pytest.approx(np.mean([s["absErrFrozen"] for s in art["steps"]]))
    assert art["mae"]["persistence"] == pytest.approx(0.043968, abs=5e-7)
    assert art["mae"]["frozen"] == pytest.approx(0.041794, abs=5e-7)
    for phrase in ("integral_a^b Q dt", "linearly interpolated at the window edges", "last sample <= b",
                   "previous completed window", "never updated", "[1450,1500]"):
        assert phrase in art["method"]
    # No look-ahead: changing the first sample after a window cannot change that window's forecast.
    t = np.arange(1400.0, 1950.0, 1.7)
    q = np.sin(t / 7.0) + 3.0
    base = model.run(t, q)
    j = int(np.searchsorted(t, 1550.0))  # first sample after the window [1500, 1550]
    q2 = q.copy()
    q2[j] += 10.0
    moved = model.run(t, q2)
    assert moved["steps"][1]["persistence"] == base["steps"][1]["persistence"]
    assert moved["init"] == base["init"]
    # Persistence on a constant signal is perfect; the model is not tied to the archive.
    flat = model.run(t, np.full_like(t, 3.0))
    assert flat["mae"] == {"persistence": 0.0, "frozen": 0.0}


def test_F3_prd_mae_fixtures_reported_as_mismatch(art):
    fx = {f["id"]: f for f in art["fixtures"]}
    p, f = fx["mae-persistence"], fx["mae-frozen"]
    assert (p["claimed"], f["claimed"]) == (0.0444, 0.0423)
    assert p["printedDecimals"] == f["printedDecimals"] == 4
    assert p["computed"] == art["mae"]["persistence"] and f["computed"] == art["mae"]["frozen"]
    # D-008/D-013: the stated method with the edge-interpolated mean does not reproduce the PRD.
    assert p["matches"] is False and f["matches"] is False
    assert art["provenance"]["verification"]["outcome"] == "failed"
    note = p["note"]
    assert "D-008" in note and "D-013" in note and "no single tested definition reproduces all six" in note
    # The PRD-reproducing alternative and the other alternates are listed with their values.
    assert "sample-and-hold" in note and "0.044418" in note and "0.042332" in note and "2.5569" in note
    assert "0.044667" in note and "0.041857" in note and "0.044037" in note and "0.041556" in note
    assert "0.043998" in note  # with the one-sample look-ahead


def test_F3_sample_and_hold_reproduces_prd_mae_but_not_stella_300_400():
    # Documents the forecast verifier's finding: the zero-order-hold window mean hits both PRD
    # MAE scores on the stated windows but misses the PRD's stella 300–400 archive mean.
    tr = load_trace("stella")
    sh = model.run(tr.t, tr.q, sample_and_hold_mean, forecast_mean=None)["mae"]
    assert sh["persistence"] == pytest.approx(0.044418, abs=5e-7)
    assert sh["frozen"] == pytest.approx(0.042332, abs=5e-7)
    assert round(sh["persistence"], 4) == 0.0444 and round(sh["frozen"], 4) == 0.0423
    stella_300_400 = sample_and_hold_mean(tr.t, tr.q, (300, 400))
    assert stella_300_400 == pytest.approx(2.5569, abs=5e-5) and round(stella_300_400, 2) == 2.56 != 2.55
    misses = [m for m in artifact.sample_and_hold_archive_means() if not m["matches"]]
    assert [(m["code"], m["window"]) for m in misses] == [("stella", (300.0, 400.0))]
