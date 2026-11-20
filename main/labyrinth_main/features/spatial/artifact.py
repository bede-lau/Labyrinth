"""spatial.json: GENE-X spatial parallelism on the separate Dommaschk geometry (S1–S4, replay).

Everything here is PRD-reported: the saved GENE-X checkpoints and timing logs are not in this
repo, so verification is ``blocked``. The plane ownership (planes 1–3 on rank 0, 4–6 on rank 1)
and the exchange boundaries (3↔4 and the periodic 6↔1) are taken from the PRD and
tasks/05-spatial/TASK.md; ``exchanges()`` only lists them in both directions from that ownership
and checks nothing. The one recomputed number is the speedup ratio CPU mean / GPU mean.

``fixtures`` (D-023) holds the PRD numbers this artifact reports: the speedup is ``basis: "arithmetic"`` (it only
re-divides the PRD-reported means); the 4-of-4 controlled runs and the two means cannot be recomputed without the
checkpoints and timing logs, so they are ``computed: null`` / ``matches: null`` with no basis.
"""
from __future__ import annotations

from labyrinth_main.common.provenance import fixture, provenance, source

ARTIFACT_ID = "spatial"
SCHEMA = "spatial.schema.json"

N_PLANES = 6
RANKS = (
    {"rank": 0, "device": "GPU 0", "planes": [1, 2, 3]},
    {"rank": 1, "device": "GPU 1", "planes": [4, 5, 6]},
)
PRD_CONTROLLED_RUNS = 4
PRD_PASSED_RUNS = 4
PRD_CPU_MEAN_S = 184.69
PRD_GPU_MEAN_S = 145.44
PRD_SPEEDUP = 1.27
INDEPENDENCE_NOTE = (
    "This GENE-X case couples toroidal planes across GPUs through MPI halo exchanges. The live W7-X "
    "tubes are independent: GPU 0 advances the bean tube and GPU 1 the triangular tube with no "
    "exchange between them."
)


def owner_of(plane: int) -> int:
    return next(r["rank"] for r in RANKS if plane in r["planes"])


def exchanges() -> list[dict]:
    """Halo exchanges at every (periodic) neighbour boundary whose planes belong to different ranks.

    A halo exchange is bidirectional, so each boundary yields two directed entries; ``planes`` is
    ``[sending plane, receiving neighbour plane]``.
    """
    out = []
    for p in range(1, N_PLANES + 1):
        nxt = p % N_PLANES + 1
        a, b = owner_of(p), owner_of(nxt)
        if a != b:
            out.append({"fromRank": a, "toRank": b, "planes": [p, nxt]})
            out.append({"fromRank": b, "toRank": a, "planes": [nxt, p]})
    return out


def speedup_recomputed() -> float:
    return PRD_CPU_MEAN_S / PRD_GPU_MEAN_S


NOT_IN_REPO = "the saved GENE-X checkpoints and timing logs are not in this repo, so it cannot be recomputed here."


def fixtures() -> list[dict]:
    sp = speedup_recomputed()
    return [
        fixture("speedup", "GPU speedup over CPU (CPU mean / GPU mean)", PRD_SPEEDUP, sp, 2,
                f"{PRD_CPU_MEAN_S} s / {PRD_GPU_MEAN_S} s = {sp:.5f}; only the division is redone, both means are "
                "PRD-reported.", basis="arithmetic"),
        fixture("controlled-runs-passed", f"Controlled runs that passed the reference ({PRD_PASSED_RUNS} of "
                f"{PRD_CONTROLLED_RUNS})", PRD_PASSED_RUNS, None, 0, f"PRD-reported tally; {NOT_IN_REPO}"),
        fixture("cpu-mean-s", "CPU mean wall-clock per run", PRD_CPU_MEAN_S, None, 2, f"PRD-reported; {NOT_IN_REPO}"),
        fixture("gpu-mean-s", "GPU mean wall-clock per run", PRD_GPU_MEAN_S, None, 2, f"PRD-reported; {NOT_IN_REPO}"),
    ]


def build() -> dict:
    return {
        "schemaVersion": 1,
        "geometry": "Dommaschk",
        "code": "GENE-X",
        "nPlanes": N_PLANES,
        "ranks": [dict(r, planes=list(r["planes"])) for r in RANKS],
        "exchanges": exchanges(),
        "fieldSolve": {"device": "CPU"},
        "runs": {"controlled": PRD_CONTROLLED_RUNS, "passedReference": PRD_PASSED_RUNS},
        "timing": {"cpuMeanS": PRD_CPU_MEAN_S, "gpuMeanS": PRD_GPU_MEAN_S, "speedup": PRD_SPEEDUP,
                   "speedupRecomputed": speedup_recomputed()},
        "independenceNote": INDEPENDENCE_NOTE,
        "fixtures": fixtures(),
        "provenance": provenance(
            "prd-reported",
            solver_revision="GENE-X revision unknown (not stated in PRD; checkpoints not in repo)",
            units="seconds (mean wall-clock per run)",
            coverage=(f"{PRD_CONTROLLED_RUNS} controlled runs on the separate Dommaschk geometry (not W7-X); "
                      "6 toroidal planes over 2 ranks"),
            runtime=f"CPU mean {PRD_CPU_MEAN_S} s, GPU mean {PRD_GPU_MEAN_S} s (PRD-reported)",
            sources=[source("PRD.md · Inspect spatial parallelism", "PRD.md")],
            outcome="blocked",
            details=(f"Saved GENE-X checkpoints and timing logs are not in this repo, so plane ownership, the "
                     f"{PRD_PASSED_RUNS}/{PRD_CONTROLLED_RUNS} reference passes and the timings cannot be "
                     f"verified. Only the ratio is recomputed: {PRD_CPU_MEAN_S}/{PRD_GPU_MEAN_S} = "
                     f"{speedup_recomputed():.4f} (PRD prints {PRD_SPEEDUP})."),
        ),
    }
