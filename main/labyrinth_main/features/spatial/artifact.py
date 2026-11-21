"""Replay GENE-X partition and timing evidence on the Dommaschk geometry."""
from __future__ import annotations

import json
import math
from statistics import mean

import netCDF4
import numpy as np

from labyrinth_main.common.paths import RAW
from labyrinth_main.common.provenance import fixture, provenance, source

ARTIFACT_ID = "spatial"
SCHEMA = "spatial.schema.json"

EVIDENCE = RAW / "genex-dommaschk"
CHECKPOINTS = tuple(EVIDENCE / f"checkpoint_{i}.nc" for i in (1, 2))
TIMINGS = EVIDENCE / "controlled-results.json"
HOST = EVIDENCE / "controlled-host.json"
GPU_TRACE = EVIDENCE / "traced-gpu-results.json"
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


def checkpoint_ranks(trace: dict) -> list[dict]:
    ranks = []
    for rank, checkpoint in enumerate(CHECKPOINTS):
        with netCDF4.Dataset(checkpoint) as data:
            # GENE-X writes bounds in RZ, phi, v_par, mu, species order.
            lower = int(data["lb_stripped"][1])
            upper = int(data["ub_stripped"][1])
            if upper - lower + 1 != len(data.dimensions["dim_phi"]):
                raise ValueError(f"inconsistent toroidal partition bounds in {checkpoint.name}")
        devices = trace["notifications"][str(rank)]["non_probe_device_counts"]
        if len(devices) != 1 or next(iter(devices.values())) <= 0:
            raise ValueError(f"rank {rank} lacks an unambiguous solver GPU trace")
        ranks.append({"rank": rank, "device": f"GPU {next(iter(devices))}", "planes": list(range(lower, upper + 1))})
    devices = {r["device"] for r in ranks}
    if len(devices) != len(ranks):
        raise ValueError("saved ranks used the same GPU")
    return ranks


def exchanges(ranks: list[dict], n_planes: int) -> list[dict]:
    """Halo exchanges at every (periodic) neighbour boundary whose planes belong to different ranks.

    A halo exchange is bidirectional, so each boundary yields two directed entries; ``planes`` is
    ``[sending plane, receiving neighbour plane]``.
    """
    out = []
    owners = {p: r["rank"] for r in ranks for p in r["planes"]}
    for p in range(1, n_planes + 1):
        nxt = p % n_planes + 1
        a, b = owners[p], owners[nxt]
        if a != b:
            out.append({"fromRank": a, "toRank": b, "planes": [p, nxt]})
            out.append({"fromRank": b, "toRank": a, "planes": [nxt, p]})
    return out


def mms_passed(run: dict, reference: np.ndarray) -> bool:
    actual = np.asarray(run["actual_rows"], dtype=float)
    return (run["exit_code"] == 0 and not run["timed_out"] and run["simulation_finished"]
            and run["upstream_raw_exit_code"] == 0 and np.array_equal(run["reference_rows"], reference)
            and actual.shape == reference.shape and np.isfinite(actual).all()
            and bool(np.allclose(actual, reference, rtol=1e-4, atol=1e-14)))


def build() -> dict:
    trace = json.loads(GPU_TRACE.read_text())
    ranks = checkpoint_ranks(trace)
    planes = sorted(p for rank in ranks for p in rank["planes"])
    if planes != list(range(1, 7)):
        raise ValueError("saved partitions must cover each of the six toroidal planes once")

    runs = json.loads(TIMINGS.read_text())
    reference = np.asarray(trace["reference_rows"], dtype=float)
    if reference.shape != (3, 13) or not np.isfinite(reference).all():
        raise ValueError("expected three finite 13-column GENE-X reference rows")
    if [run["mode"] for run in runs] != ["cpu", "acc", "acc", "cpu"]:
        raise ValueError("expected four controlled GENE-X runs in CPU–GPU–GPU–CPU order")
    seconds = [float(r["wall_seconds"]) for r in runs]
    if any(not math.isfinite(t) or t <= 0 for t in seconds):
        raise ValueError("controlled timings must be positive and finite")
    cpu = mean([seconds[0], seconds[3]])
    gpu = mean(seconds[1:3])
    passed = sum(mms_passed(r, reference) for r in runs)
    speedup = cpu / gpu
    checks = [
        fixture("speedup", "GPU speedup over CPU (CPU mean / GPU mean)", PRD_SPEEDUP, speedup, 2,
                "Ratio of mean wall times from the four controlled runs.", basis="data"),
        fixture("controlled-runs-passed", f"Controlled runs that passed the reference ({PRD_PASSED_RUNS} of "
                f"{PRD_CONTROLLED_RUNS})", PRD_PASSED_RUNS, passed, 0,
                "Rechecked three MMS rows per run against the saved reference.", basis="data"),
        fixture("cpu-mean-s", "CPU mean wall-clock per run", PRD_CPU_MEAN_S, cpu, 2,
                "Mean of the two CPU runs.", basis="data"),
        fixture("gpu-mean-s", "GPU mean wall-clock per run", PRD_GPU_MEAN_S, gpu, 2,
                "Mean of the two OpenACC runs.", basis="data"),
    ]
    host = json.loads(HOST.read_text())
    revision = host["source_commit"]["stdout"].strip()
    return {
        "schemaVersion": 1,
        "geometry": "Dommaschk",
        "code": "GENE-X",
        "nPlanes": len(planes),
        "ranks": ranks,
        "exchanges": exchanges(ranks, len(planes)),
        "fieldSolve": {"device": "CPU"},
        "runs": {"controlled": len(runs), "passedReference": passed},
        "timing": {"cpuMeanS": cpu, "gpuMeanS": gpu, "speedup": round(speedup, 2), "speedupRecomputed": speedup},
        "independenceNote": INDEPENDENCE_NOTE,
        "fixtures": checks,
        "provenance": provenance(
            "derived",
            solver_revision=f"GENE-X {revision}",
            units="seconds (mean wall-clock per run)",
            coverage="Four controlled runs on the separate Dommaschk geometry (not W7-X), six planes on two MPI ranks.",
            runtime=f"CPU mean {cpu:.3f} s, GPU mean {gpu:.3f} s from saved wall times",
            sources=[source(path.name, f"data/raw/genex-dommaschk/{path.name}", path)
                     for path in (*CHECKPOINTS, GPU_TRACE, TIMINGS, HOST)],
            outcome="passed" if all(check["matches"] for check in checks) else "failed",
            details=("Checkpoint bounds and the separate traced run establish rank ownership and GPU mapping. "
                     f"{passed}/{len(runs)} controlled runs passed all 39 saved MMS values and the upstream comparison. "
                     "The arrows depict periodic boundaries implied by the checkpoint ownership. "
                     "Timings use the untraced CPU–GPU–GPU–CPU sequence."),
        ),
    }
