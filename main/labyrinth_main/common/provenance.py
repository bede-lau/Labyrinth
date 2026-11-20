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


BASES = ("data", "arithmetic")
CLAIM_SOURCES = ("prd", "task")


def _finish(out: dict, note: str, basis: str | None, claim_source: str | None = None) -> dict:
    """Optional `basis` (contract: absent means "data"), `claimSource` (absent means "prd") and `note`.
    `basis="arithmetic"` marks a check that only re-does arithmetic on PRD-reported inputs, so it must have computed
    something. `claim_source="task"` marks a claim that the feature's tasks/<NN>/TASK.md prints and PRD.md does not."""
    if basis is not None:
        if basis not in BASES:
            raise ValueError(f"fixture basis must be one of {BASES}, got {basis!r}")
        if basis == "arithmetic" and out["computed"] is None:
            raise ValueError(f"fixture {out['id']!r}: an arithmetic re-check needs a computed value")
        out["basis"] = basis
    if claim_source is not None:
        if claim_source not in CLAIM_SOURCES:
            raise ValueError(f"fixture claim source must be one of {CLAIM_SOURCES}, got {claim_source!r}")
        out["claimSource"] = claim_source
    if note:
        out["note"] = note
    return out


def fixture(fid: str, label: str, claimed: float, computed: float | None, decimals: int, note: str = "", *,
            basis: str | None = None, claim_source: str | None = None) -> dict:
    """PRD number vs recomputed number, compared at the PRD's printed precision. A claim that only the task's
    TASK.md prints passes ``claim_source="task"`` (BE-DATA-3), so it is never shown as a PRD figure."""
    if claimed is None:
        raise ValueError(f"fixture {fid!r}: the PRD claim is missing; a PRD range goes through range_fixture()")
    matches = None if computed is None else round(computed, decimals) == round(claimed, decimals)
    out = {"id": fid, "label": label, "claimed": claimed, "computed": computed,
           "printedDecimals": decimals, "matches": matches}
    return _finish(out, note, basis, claim_source)


def range_fixture(fid: str, label: str, claimed_range: tuple[float, float], computed: float | None, decimals: int,
                  note: str = "", *, basis: str | None = None, claim_source: str | None = None) -> dict:
    """PRD range [lo, hi] vs recomputed number (D-023): `claimed` is null because the PRD prints no single value,
    `claimedRange` holds the range and `matches` is lo <= computed <= hi, with no rounding. `decimals` is the
    precision the range is printed at."""
    lo, hi = (float(v) for v in claimed_range)
    if not lo <= hi:
        raise ValueError(f"fixture {fid!r}: range [{lo}, {hi}] is empty")
    matches = None if computed is None else bool(lo <= computed <= hi)
    out = {"id": fid, "label": label, "claimed": None, "claimedRange": [lo, hi], "computed": computed,
           "printedDecimals": decimals, "matches": matches}
    return _finish(out, note, basis, claim_source)
