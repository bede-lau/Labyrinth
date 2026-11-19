"""Builders for the shared `provenance` / `source` / `fixtureCheck` contract shapes."""
from __future__ import annotations

from pathlib import Path

from .io import sha256_file
from .paths import REPO_ROOT

STELLA_COMMIT = "6f60964da55e9c0207b2ed9912d8903440b6d68b"
STELLA_BLOB = f"https://github.com/stellaGK/stella/blob/{STELLA_COMMIT}"


def source(label: str, url: str, path: Path | None = None) -> dict:
    out = {"label": label, "url": url, "sha256": sha256_file(path) if path else "n/a"}
    if path is not None:
        out["path"] = str(path.relative_to(REPO_ROOT))
    return out


def provenance(kind: str, *, solver_revision: str, units: str, coverage: str, sources: list[dict],
               outcome: str, details: str, t_start: float | None = None, t_end: float | None = None,
               runtime: str = "unknown") -> dict:
    return {
        "kind": kind,
        "solverRevision": solver_revision,
        "units": units,
        "coverage": {"description": coverage, "tStart": t_start, "tEnd": t_end},
        "runtime": runtime,
        "verification": {"outcome": outcome, "details": details},
        "sources": sources,
    }


def fixture(fid: str, label: str, claimed: float, computed: float | None, decimals: int, note: str = "") -> dict:
    """PRD number vs recomputed number, compared at the PRD's printed precision."""
    matches = None if computed is None else round(computed, decimals) == round(claimed, decimals)
    out = {"id": fid, "label": label, "claimed": claimed, "computed": computed,
           "printedDecimals": decimals, "matches": matches}
    if note:
        out["note"] = note
    return out
