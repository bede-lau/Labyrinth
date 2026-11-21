"""03 · Forecast replay — backend outcomes F1–F3 and F6 (tasks/03-forecast/TASK.md)."""
import json
import math
import re

import jsonschema
import numpy as np
import pytest
from referencing import Registry, Resource

from labyrinth_main.common import io
from labyrinth_main.common.paths import CONTRACTS
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


# ---- F6 (D-026): errorStats -----------------------------------------------------------------------------------------
def _recompute(steps: list[dict], forecaster: str) -> dict:
    """Independent recomputation from `steps` with plain Python (no numpy), e_k = predicted - actual."""
    e = [s[forecaster] - s["observed"] for s in steps]
    sq = [x * x for x in e]
    mse = math.fsum(sq) / len(sq)
    return {"n": len(e), "mse": mse, "rmse": math.sqrt(mse), "squaredErrorRange": [min(sq), max(sq)],
            "errorRange": [min(e), max(e)]}


def test_F6_error_stats_equal_a_recomputation_from_steps(art):
    stats = art["errorStats"]
    assert set(stats) == {"definition", "persistence", "frozen"}
    for name in ("persistence", "frozen"):
        got, want = stats[name], _recompute(art["steps"], name)
        assert set(got) == {"n", "mse", "rmse", "squaredErrorRange", "errorRange"}
        assert got["n"] == want["n"] == len(art["steps"]) == 8
        assert got["mse"] == pytest.approx(want["mse"], rel=1e-12)
        assert got["rmse"] == pytest.approx(want["rmse"], rel=1e-12)
        assert got["rmse"] == pytest.approx(math.sqrt(got["mse"]), rel=1e-15)
        assert got["squaredErrorRange"] == pytest.approx(want["squaredErrorRange"], rel=1e-12)
        assert got["errorRange"] == pytest.approx(want["errorRange"], rel=1e-12)
        # the squared errors are the absolute errors the MAE already uses, squared
        abs_err = [s["absErrPersistence" if name == "persistence" else "absErrFrozen"] for s in art["steps"]]
        assert got["mse"] == pytest.approx(np.mean(np.square(abs_err)), rel=1e-12)
        assert got["squaredErrorRange"] == pytest.approx([min(abs_err) ** 2, max(abs_err) ** 2], rel=1e-12)
        # RMSE >= MAE (Jensen); both from the same steps
        assert got["rmse"] >= art["mae"][name] > 0
    # the MAE, steps and fixtures are unchanged by D-026
    assert art["mae"]["persistence"] == pytest.approx(0.043968, abs=5e-7)
    assert art["mae"]["frozen"] == pytest.approx(0.041794, abs=5e-7)


def test_F6_errors_are_predicted_minus_actual_and_ranges_are_ordered(art):
    steps = art["steps"]
    frozen = art["errorStats"]["frozen"]
    # every frozen forecast is the same initialisation mean, so its signed errors are init - observed_k exactly
    init = steps[0]["frozen"]
    assert frozen["errorRange"] == pytest.approx([init - max(s["observed"] for s in steps),
                                                  init - min(s["observed"] for s in steps)], rel=1e-12)
    # a forecaster that over-predicts every step has positive errors; one that under-predicts, negative ones
    synthetic = [{"observed": 1.0, "persistence": 1.5, "frozen": 0.25}, {"observed": 2.0, "persistence": 2.1, "frozen": 1.0}]
    s = model.error_stats(synthetic)
    assert s["persistence"]["errorRange"] == pytest.approx([0.1, 0.5])
    assert s["frozen"]["errorRange"] == pytest.approx([-1.0, -0.75])
    assert s["persistence"]["squaredErrorRange"] == pytest.approx([0.01, 0.25])
    assert s["frozen"]["squaredErrorRange"] == pytest.approx([0.5625, 1.0])
    assert s["frozen"]["mse"] == pytest.approx((0.5625 + 1.0) / 2)
    for name in ("persistence", "frozen"):
        for stats in (art["errorStats"][name], s[name]):
            lo, hi = stats["errorRange"]
            assert lo <= hi
            slo, shi = stats["squaredErrorRange"]
            assert 0 <= slo <= stats["mse"] <= shi
            assert shi == pytest.approx(max(lo * lo, hi * hi), rel=1e-12)
    # the written artifact (7 significant figures) keeps the order
    written = json.loads(io.dumps(art))["errorStats"]
    for name in ("persistence", "frozen"):
        assert written[name]["errorRange"][0] <= written[name]["errorRange"][1]
        assert written[name]["squaredErrorRange"][0] <= written[name]["squaredErrorRange"][1]
    d = art["errorStats"]["definition"]
    for phrase in ("e_k = forecast_k - observed_k", "predicted minus actual", "MSE = (1/n) * sum_k e_k^2",
                   "RMSE = sqrt(MSE)", "squaredErrorRange = [min_k e_k^2, max_k e_k^2]", "errorRange = [min_k e_k, max_k e_k]",
                   "D-026", "null"):
        assert phrase in d, phrase


def test_F6_no_steps_gives_null_statistics():
    empty = model.error_stats([])
    for name in ("persistence", "frozen"):
        assert empty[name] == {"n": 0, "mse": None, "rmse": None, "squaredErrorRange": None, "errorRange": None}
    assert empty["definition"] == model.ERROR_STATS_DEFINITION
    # the definition names no particular step count, so it never contradicts the n beside it (RV-FC-B1); it does say
    # what n = 0 means
    assert not re.search(r"\bn\s*=\s*[1-9]", model.ERROR_STATS_DEFINITION), model.ERROR_STATS_DEFINITION
    assert "With n = 0 every value is null" in empty["definition"]
    with pytest.raises(ValueError):
        model.error_stat([1.0, 2.0], [1.0])


def _forecast_validator() -> jsonschema.Draft202012Validator:
    resources = []
    for p in CONTRACTS.glob("*.schema.json"):
        schema = json.loads(p.read_text(encoding="utf-8"))
        res = Resource.from_contents(schema)
        resources += [(p.name, res), (schema["$id"], res)]
    schema = json.loads((CONTRACTS / artifact.SCHEMA).read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema, registry=Registry().with_resources(resources))


def test_F6_artifact_with_error_stats_validates(art):
    v = _forecast_validator()
    written = json.loads(io.dumps(art))
    v.validate(written)
    # errorStats is required, closed, and n = 0 with nulls is a valid shape
    assert not v.is_valid({k: val for k, val in written.items() if k != "errorStats"})
    assert not v.is_valid({**written, "errorStats": {**written["errorStats"], "extra": 1}})
    assert v.is_valid({**written, "errorStats": json.loads(io.dumps(model.error_stats([])))})
    no_mse = {k: val for k, val in written["errorStats"]["frozen"].items() if k != "mse"}
    assert not v.is_valid({**written, "errorStats": {**written["errorStats"], "frozen": no_mse}})
    # errorStat ties the values to n (if/then/else): n = 0 <=> every statistic is null; n > 0 => numbers and windows
    null_stat = {"n": 0, "mse": None, "rmse": None, "squaredErrorRange": None, "errorRange": None}
    stats_fields = ("mse", "rmse", "squaredErrorRange", "errorRange")
    for name in ("persistence", "frozen"):
        real = written["errorStats"][name]
        assert real["n"] == 8 and all(real[f] is not None for f in stats_fields)

        def with_stat(stat: dict, name: str = name) -> dict:
            return {**written, "errorStats": {**written["errorStats"], name: stat}}

        assert v.is_valid(with_stat(real))
        assert v.is_valid(with_stat(dict(null_stat)))  # the n = 0 all-null shape is accepted
        assert not v.is_valid(with_stat({**null_stat, "n": 8}))  # n = 8 with every value null
        assert not v.is_valid(with_stat({**real, "n": 0}))  # n = 0 with every value numeric
        for f in stats_fields:
            assert not v.is_valid(with_stat({**real, f: None})), (name, f)  # n = 8 with one null (e.g. mse null)
            assert not v.is_valid(with_stat({**null_stat, f: real[f]})), (name, f)  # n = 0 with one numeric value
