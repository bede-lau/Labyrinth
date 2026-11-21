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
    assert art["fieldSolve"] == {"device": "CPU"}


def test_S2_runs_and_speedup_recomputed(art):
    assert art["runs"] == {"controlled": 4, "passedReference": 4}
    tm = art["timing"]
    assert (round(tm["cpuMeanS"], 2), round(tm["gpuMeanS"], 2), tm["speedup"]) == (184.69, 145.44, 1.27)
    assert tm["speedupRecomputed"] == pytest.approx(tm["cpuMeanS"] / tm["gpuMeanS"])
    assert round(tm["speedupRecomputed"], 2) == tm["speedup"]


def test_S3_provenance_derived_and_verified(art):
    prov = art["provenance"]
    assert prov["kind"] == "derived"
    assert prov["verification"]["outcome"] == "passed"
    assert "Checkpoint bounds" in prov["verification"]["details"]
    assert {s["label"] for s in prov["sources"]} >= {"checkpoint_1.nc", "checkpoint_2.nc", "controlled-results.json"}
    assert "Dommaschk" in prov["coverage"]["description"] and "not W7-X" in prov["coverage"]["description"]


def test_S4_independence_note_live_w7x_tubes_do_not_exchange(art):
    note = art["independenceNote"]
    assert "independent" in note and "W7-X" in note and "no exchange" in note


def _fx(art, fid):
    return next(f for f in art["fixtures"] if f["id"] == fid)


def test_S5_fixtures_recompute_from_saved_runs(art):
    expected = {"speedup": 1.27, "controlled-runs-passed": 4, "cpu-mean-s": 184.69, "gpu-mean-s": 145.44}
    assert [f["id"] for f in art["fixtures"]] == list(expected)
    for fid, claimed in expected.items():
        check = _fx(art, fid)
        assert check["claimed"] == claimed
        assert round(check["computed"], check["printedDecimals"]) == claimed
        assert check["matches"] is True and check["basis"] == "data"


def test_S5_failed_mms_data_changes_the_tally(tmp_path, monkeypatch):
    import json

    runs = json.loads(artifact.TIMINGS.read_text())
    runs[0]["actual_rows"][2][1] += 1
    changed = tmp_path / "changed.json"
    changed.write_text(json.dumps(runs))
    monkeypatch.setattr(artifact, "TIMINGS", changed)
    # Only this intentionally changed source is outside the repository.
    monkeypatch.setattr(artifact, "source", lambda label, url, path: {"label": label, "url": url})
    result = artifact.build()
    assert result["runs"]["passedReference"] == 3
    assert _fx(result, "controlled-runs-passed")["matches"] is False
    assert result["provenance"]["verification"]["outcome"] == "failed"
