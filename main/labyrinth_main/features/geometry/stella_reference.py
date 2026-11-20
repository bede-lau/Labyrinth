"""Compare the tracer against stella's saved ``.geometry`` output at printed precision (outcome G3).

Reference: stella @ 6f60964d ``AUTOMATIC_TESTS/numerical_tests/test_2_geometry/
EXPECTED_OUTPUT.vmec_geometry.geometry`` produced by ``vmec_geometry.in``. The run parameters
(torflux, nfield_periods, nzed) are parsed from the pinned input file; alpha0 and zeta_center are
stella's defaults (0, 0) because the input does not set them. Values are printed as ``0.1260E+01``
(4 significant figures); a computed value matches when it lies within half a unit in the last
printed place. The same run's ``EXPECTED_OUTPUT.vmec_geometry.out.nc`` holds float64 ``bmag``
for a much tighter check (:func:`compare_out_nc`).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal
from pathlib import Path

import numpy as np

from .fieldline import stella_zeta_grid, trace
from .vmec import VmecEquilibrium

STELLA_DEFAULTS = {"alpha0": 0.0, "zeta_center": 0.0}  # namelist_geometry.f90 defaults
_NAMELIST = re.compile(r"^\s*&(\w+)\s*$(.*?)^\s*/\s*$", re.M | re.S)
PRINTED_SIG_FIGS = 4
FLOAT64_TOLERANCE = 1e-10  # absolute, on bmag = |B|/B_ref, vs stella's float64 out.nc
_NUM = re.compile(r"^-?\d\.(\d+)E([+-]\d+)$")

GEOMETRY_COLUMNS = ["alpha", "zed", "zeta", "bmag", "bdot_grad_z", "gds2", "gds21", "gds22", "gds23",
                    "gds24", "gbdrift", "cvdrift", "gbdrift0", "bmag_psi0"]


@dataclass(frozen=True)
class Printed:
    value: float
    half_unit: float  # half a unit in the last printed place


def parse_printed(token: str) -> Printed:
    m = _NUM.match(token)
    if not m:
        raise ValueError(f"unexpected number format: {token!r}")
    ndig, exp = len(m.group(1)), int(m.group(2))
    return Printed(float(token), 0.5 * 10.0 ** (exp - ndig))


def read_namelists(path: Path) -> dict[str, dict[str, str]]:
    """Minimal Fortran namelist reader: {group: {key: raw value string}} (comments stripped)."""
    text = "\n".join(ln.split("!", 1)[0] for ln in Path(path).read_text().splitlines())
    groups: dict[str, dict[str, str]] = {}
    for m in _NAMELIST.finditer(text):
        body = {}
        for ln in m.group(2).splitlines():
            if "=" in ln:
                k, v = ln.split("=", 1)
                body[k.strip().lower()] = v.strip().strip("'\"")
        groups[m.group(1).lower()] = body
    return groups


def run_parameters(input_path: Path) -> dict:
    """torflux, nfield_periods, nzed from the stella input; alpha0/zeta_center default unless set."""
    nml = read_namelists(input_path)
    vm, zg = nml["geometry_vmec"], nml["z_grid"]
    return {
        "torflux": float(vm["torflux"]),
        "nfield_periods": float(vm["nfield_periods"]),
        "nzed": int(zg["nzed"]),
        "alpha0": float(vm.get("alpha0", STELLA_DEFAULTS["alpha0"])),
        "zeta_center": float(vm.get("zeta_center", STELLA_DEFAULTS["zeta_center"])),
    }


def trace_run(eq: VmecEquilibrium, params: dict):
    surf = eq.surface(params["torflux"])
    zeta = stella_zeta_grid(eq.nfp, params["nfield_periods"], params["nzed"], params["zeta_center"])
    return surf, trace(surf, params["alpha0"], zeta)


def ceil_sig(x: float, sig: int) -> float:
    """``x >= 0`` rounded UP to ``sig`` significant figures (a conservative bound for an error to publish)."""
    if x < 0 or not np.isfinite(x):
        raise ValueError(f"expected a finite non-negative error, got {x}")
    if x == 0:
        return 0.0
    d = Decimal(repr(float(x)))
    return float(d.quantize(Decimal(1).scaleb(d.adjusted() - sig + 1), rounding=ROUND_CEILING))


def compare_out_nc(eq: VmecEquilibrium, input_path: Path, out_nc_path: Path) -> dict:
    """Max |bmag error| against stella's float64 ``bmag(zed, alpha)`` from the same run's out.nc.

    ``allWithinTolerance``: every sample's bmag within FLOAT64_TOLERANCE (absolute, bmag = |B|/B_ref) on a zed
    grid that agrees with stella's to the same tolerance."""
    import netCDF4

    params = run_parameters(input_path)
    _, fl = trace_run(eq, params)
    with netCDF4.Dataset(out_nc_path) as d:
        zed = np.array(d.variables["zed"][...], dtype=float)
        bmag_ref = np.array(d.variables["bmag"][...], dtype=float)[:, 0]
    zed_ours = fl.zeta * eq.nfp / params["nfield_periods"]  # stella: zed = zeta*nfp/nfield_periods
    bmag = fl.B / eq.b_ref
    err = np.abs(bmag - bmag_ref)
    err_zed = float(np.max(np.abs(zed_ours - zed)))
    return {"samplesCompared": len(zed), "tolerance": FLOAT64_TOLERANCE,
            "maxAbsErrorBmag": float(np.max(err)), "maxRelErrorBmag": float(np.max(err / np.abs(bmag_ref))),
            "maxAbsErrorZed": err_zed,
            "allWithinTolerance": bool(np.all(err <= FLOAT64_TOLERANCE) and err_zed <= FLOAT64_TOLERANCE)}


def read_geometry_file(path: Path) -> dict:
    """Parse stella's ``.geometry`` file: header scalars and the per-sample table (as Printed)."""
    lines = [ln for ln in Path(path).read_text().splitlines() if ln.strip()]
    header_names = lines[0].lstrip("#").split()
    header_values = (float(t) for t in lines[1].lstrip("#").split())
    header = dict(zip(header_names, header_values, strict=True))
    rows = []
    for ln in lines[2:]:
        if ln.lstrip().startswith("#"):
            continue
        toks = ln.split()
        if len(toks) != len(GEOMETRY_COLUMNS):
            raise ValueError(f"bad geometry row: {ln!r}")
        rows.append({c: parse_printed(t) for c, t in zip(GEOMETRY_COLUMNS, toks, strict=True)})
    return {"header": header, "rows": rows}


def compare(eq: VmecEquilibrium, geometry_path: Path, input_path: Path) -> dict:
    """Recompute stella test_2 with our tracer and compare zeta and bmag sample by sample."""
    ref = read_geometry_file(geometry_path)
    params = run_parameters(input_path)
    rhoc = ref["header"]["rhoc"]
    if abs(rhoc**2 - params["torflux"]) > 1e-4:  # rhoc printed to 4 significant figures
        raise ValueError(f"geometry header rhoc^2 = {rhoc**2} does not match input torflux {params['torflux']}")
    surf, fl = trace_run(eq, params)
    zeta = fl.zeta
    bmag = fl.B / eq.b_ref
    rows = ref["rows"]
    if len(rows) != len(zeta):
        raise ValueError(f"reference has {len(rows)} samples, expected {len(zeta)}")

    ok = True
    abs_err_b, rel_err_b, abs_err_z = [], [], []
    for r, zc, bc in zip(rows, zeta, bmag, strict=True):
        dz, db = abs(zc - r["zeta"].value), abs(bc - r["bmag"].value)
        ok &= dz <= r["zeta"].half_unit * (1 + 1e-9) and db <= r["bmag"].half_unit * (1 + 1e-9)
        abs_err_z.append(dz)
        abs_err_b.append(db)
        rel_err_b.append(db / abs(r["bmag"].value))
    return {
        "samplesCompared": len(rows),
        "printedSignificantFigures": PRINTED_SIG_FIGS,
        "maxAbsError": float(max(abs_err_b)),
        "maxRelError": float(max(rel_err_b)),
        "maxAbsErrorZeta": float(max(abs_err_z)),
        "allWithinPrintedPrecision": bool(ok),
        "header": ref["header"],
        "iota": surf.iota,
        "bRef": eq.b_ref,
        "aRef": eq.l_ref,
        "computedBmag": np.asarray(bmag),
        "computedZeta": zeta,
        "computedTheta": fl.theta,
        "params": params,
    }
