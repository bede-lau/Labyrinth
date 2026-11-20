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
