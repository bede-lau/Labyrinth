"""05 · Inspect spatial parallelism — backend outcomes S1–S4 (tasks/05-spatial/TASK.md)."""
import pytest

from labyrinth_main.features.spatial import artifact


@pytest.fixture(scope="module")
def art():
    return artifact.build()


def test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve(art):
    assert art["geometry"] == "Dommaschk" and art["code"] == "GENE-X" and art["nPlanes"] == 6
    assert art["ranks"] == [{"rank": 0, "device": "GPU 0", "planes": [1, 2, 3]},
                            {"rank": 1, "device": "GPU 1", "planes": [4, 5, 6]}]
    owned = sorted(p for r in art["ranks"] for p in r["planes"])
    assert owned == list(range(1, 7))
    # Halo exchanges are bidirectional: both directions at the 3↔4 and periodic 6↔1 boundaries.
    assert art["exchanges"] == [{"fromRank": 0, "toRank": 1, "planes": [3, 4]},
                                {"fromRank": 1, "toRank": 0, "planes": [4, 3]},
                                {"fromRank": 1, "toRank": 0, "planes": [6, 1]},
                                {"fromRank": 0, "toRank": 1, "planes": [1, 6]}]
    # Ownership and boundaries are PRD/TASK inputs, not recomputed; the docstring must not overclaim.
    doc = " ".join(artifact.__doc__.split())
    assert "taken from the PRD and tasks/05-spatial/TASK.md" in doc
    assert "The one recomputed number is the speedup ratio" in doc
    assert art["fieldSolve"] == {"device": "CPU"}


def test_S2_runs_and_speedup_recomputed(art):
    assert art["runs"] == {"controlled": 4, "passedReference": 4}
    tm = art["timing"]
    assert (tm["cpuMeanS"], tm["gpuMeanS"], tm["speedup"]) == (184.69, 145.44, 1.27)
    assert tm["speedupRecomputed"] == pytest.approx(184.69 / 145.44)
    assert round(tm["speedupRecomputed"], 2) == tm["speedup"]


def test_S3_provenance_prd_reported_and_verification_blocked(art):
    prov = art["provenance"]
    assert prov["kind"] == "prd-reported"
    assert prov["verification"]["outcome"] == "blocked"
    assert "checkpoints" in prov["verification"]["details"] and "not in this repo" in prov["verification"]["details"]
    assert "Dommaschk" in prov["coverage"]["description"] and "not W7-X" in prov["coverage"]["description"]


def test_S4_independence_note_live_w7x_tubes_do_not_exchange(art):
    note = art["independenceNote"]
    assert "independent" in note and "W7-X" in note and "no exchange" in note


def _fx(art, fid):
    return next(f for f in art["fixtures"] if f["id"] == fid)


def test_S5_fixtures_speedup_is_arithmetic_and_runs_not_recomputable(art):
    """D-023 §2: the PRD numbers this artifact reports are fixtures, so the view needs no hard-coded pills."""
    ids = [f["id"] for f in art["fixtures"]]
    assert ids == ["speedup", "controlled-runs-passed", "cpu-mean-s", "gpu-mean-s"]
    sp = _fx(art, "speedup")
    assert sp["claimed"] == 1.27 and sp["printedDecimals"] == 2
    assert sp["computed"] == pytest.approx(184.69 / 145.44) and sp["computed"] == art["timing"]["speedupRecomputed"]
    assert sp["matches"] is True and sp["basis"] == "arithmetic"
    assert "184.69" in sp["note"] and "145.44" in sp["note"]
    runs = _fx(art, "controlled-runs-passed")
    assert runs["claimed"] == 4 and runs["computed"] is None and runs["matches"] is None
    assert "basis" not in runs and "4 of 4" in runs["label"] and "not in this repo" in runs["note"]
    for fid, claimed in (("cpu-mean-s", 184.69), ("gpu-mean-s", 145.44)):
        f = _fx(art, fid)
        assert (f["claimed"], f["computed"], f["matches"], f["printedDecimals"]) == (claimed, None, None, 2)
        assert "basis" not in f
    for f in art["fixtures"]:
        assert "claimedRange" not in f


def test_S5_speedup_fixture_is_recomputed_not_copied(monkeypatch):
    """The speedup fixture follows the timing inputs (a PRD 1.27 with other means would be flagged)."""
    monkeypatch.setattr(artifact, "PRD_GPU_MEAN_S", 120.0)
    sp = _fx(artifact.build(), "speedup")
    assert sp["computed"] == pytest.approx(184.69 / 120.0) and sp["matches"] is False
    assert sp["claimed"] == 1.27
