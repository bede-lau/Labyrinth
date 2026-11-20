"""Read the archived bean-tube heat-flux traces from the pinned benchmark h5 (T1).

Layout: ``compared/test5/{stella,GENE}/{t,Q}`` plus scalar ``compared/test5/{tgrad,ngrad}``.
Units: ion heat flux ``Q_i/Q_gB,i`` against time ``t v_th,i/a`` (benchmark normalisation).

The stella time vector contains two exact restart overlaps (four samples each, at t~602 and
t~862) where already-written samples are repeated with identical Q. They are dropped with the
shared ``stats.drop_restart_repeats`` (first occurrence kept), which verifies that every dropped
sample repeats an earlier kept sample in both t and Q; a divergent restart raises
``DivergentRestartError`` instead of being silently discarded.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import cache

import h5py
import numpy as np

from labyrinth_main.common.paths import STELLA_BENCHMARK_H5
from labyrinth_main.common.provenance import STELLA_BLOB, STELLA_COMMIT, provenance, source

from .stats import drop_restart_repeats

H5_GROUP = "compared/test5"
CODES = ("stella", "GENE")
UNITS_TIME = "t v_th,i/a"
UNITS_HEAT_FLUX = "Q_i/Q_gB,i"
UNITS = f"{UNITS_HEAT_FLUX} vs {UNITS_TIME}"
BENCHMARK_DOI_URL = "https://doi.org/10.1017/S0022377822000393"
ARCHIVE_URL = f"{STELLA_BLOB}/AUTOMATIC_TESTS/quick_benchmarks/DOI_10_1017_S0022377822000393.h5"

SOLVER_REVISION = {
    "stella": (f"stella as published in González-Jerez et al., J. Plasma Phys. 88 (2022), "
               f"doi:10.1017/S0022377822000393; trace archived at stella commit {STELLA_COMMIT[:8]}"),
    "GENE": ("GENE revision unknown (not recorded in the archive); published in González-Jerez et al., "
             "J. Plasma Phys. 88 (2022), doi:10.1017/S0022377822000393"),
}
RUNTIME = {
    "stella": ("unknown for this archived trace (PRD reports 161 h on 288 processors for the published "
               "full-resolution stella bean tube; not confirmed to be the run behind this trace)"),
    "GENE": "unknown (not recorded in the archive)",
}


@dataclass(frozen=True)
class Trace:
    code: str
    t: np.ndarray
    q: np.ndarray
    n_raw: int
    n_dropped_duplicates: int
    tgrad: float
    ngrad: float

    @property
    def id(self) -> str:
        return f"{self.code.lower()}-bean"


class DivergentRestartError(ValueError):
    """A non-increasing sample does not repeat an earlier sample (t and Q)."""


def clean_restarts(t: np.ndarray, q: np.ndarray, label: str) -> tuple[np.ndarray, np.ndarray, int]:
    d = drop_restart_repeats(t, q)
    if d.n_divergent:
        raise DivergentRestartError(f"{label}: {d.detail}")
    return d.t, d.q, d.n_dropped


@cache
def load_trace(code: str) -> Trace:
    if code not in CODES:
        raise ValueError(f"unknown code {code!r}; expected one of {CODES}")
    with h5py.File(STELLA_BENCHMARK_H5, "r") as f:
        g = f[H5_GROUP]
        t_raw = np.asarray(g[code]["t"][()], dtype=float)
        q_raw = np.asarray(g[code]["Q"][()], dtype=float)
        tgrad = float(g["tgrad"][()])
        ngrad = float(g["ngrad"][()])
    t, q, _ = clean_restarts(t_raw, q_raw, f"{H5_GROUP}/{code}")
    t.setflags(write=False)
    q.setflags(write=False)
    return Trace(code=code, t=t, q=q, n_raw=len(t_raw), n_dropped_duplicates=len(t_raw) - len(t),
                 tgrad=tgrad, ngrad=ngrad)


def archive_source() -> dict:
    return source("stella benchmark trace archive (h5)", ARCHIVE_URL, STELLA_BENCHMARK_H5)


def benchmark_paper_source() -> dict:
    return source("González-Jerez et al., J. Plasma Phys. 88 (2022)", BENCHMARK_DOI_URL)


def trace_provenance(tr: Trace) -> dict:
    dup = (f"; {tr.n_dropped_duplicates} restart-overlap samples (repeated t and Q) dropped"
           if tr.n_dropped_duplicates else "")
    return provenance(
        "archive",
        solver_revision=SOLVER_REVISION[tr.code],
        units=UNITS,
        coverage=(f"{tr.code} bean tube (compared/test5), tgrad={tr.tgrad:g}, ngrad={tr.ngrad:g}; "
                  f"{len(tr.t)} samples t={tr.t[0]:.10g}..{tr.t[-1]:.10g}{dup}"),
        t_start=float(tr.t[0]),
        t_end=float(tr.t[-1]),
        runtime=RUNTIME[tr.code],
        sources=[archive_source(), benchmark_paper_source()],
        outcome="passed",
        details=(f"Read from {H5_GROUP}/{tr.code}/{{t,Q}} of the pinned h5 (sha256-checked in "
                 f"test_common); gradients tgrad={tr.tgrad:g}, ngrad={tr.ngrad:g} read from the same file."),
    )
