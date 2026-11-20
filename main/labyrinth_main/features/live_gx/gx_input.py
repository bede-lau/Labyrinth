"""GX input generation for the bean and triangular W7-X flux tubes (pure; UNREHEARSED).

PRD (Check transport): match geometry, gradients, units and time coverage with the archive.

* Geometry: the pinned high-mirror VMEC `wout_w7x_kjm.nc`, normalised toroidal flux s = rho^2 = 0.64
  (rho = 0.8). Tubes per D-010: centred on the outboard midplane (theta* = 0) at zeta_c (bean 0 deg,
  triangular 36 deg), one poloidal turn, alpha = -iota * zeta_c.
* Gradients: a/L_T and a/L_n are read from the benchmark archive (`compared/test5/{tgrad,ngrad}`),
  not typed in. Adiabatic electrons, T_i = T_e (benchmark setup).
* Units: GX normalises to v_t = sqrt(T/m); the archive to v_th = sqrt(2T/m). With the same wout and
  the same reference length/field (IDENTICAL_REFERENCES) `transport.units.gx_to_archive` applies.

GX parameter names follow GX's TOML input format; they have not been run (no rehearsal, D-011).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from ...common.paths import STELLA_BENCHMARK_H5, WOUT_W7X_KJM

GX_GIT_URL = "https://bitbucket.org/gyrokinetics/gx.git"
TORFLUX = 0.64            # s = rho^2 at rho = 0.8
IDENTICAL_REFERENCES = True
RESUME_FILE = "resume_from.nc"   # local copy of the checkpoint a resumed worker reads (never its restart_to file)
IDENTICAL_REFERENCES_BASIS = ("Both GX and the archive read the same wout_w7x_kjm.nc and use its minor radius and "
                              "reference field; asserted by construction, to be confirmed by the rehearsal.")


@dataclass(frozen=True)
class TubeSpec:
    name: str
    gpu_index: int
    zeta_center: float  # rad


TUBES = {
    "bean": TubeSpec("bean", 0, 0.0),
    "triangular": TubeSpec("triangular", 1, math.radians(36.0)),
}


@dataclass(frozen=True)
class Resolution:
    """Velocity resolution of the published single-GPU GX bean benchmark (4 Laguerre x 8 Hermite)."""
    ntheta: int = 128
    nx: int = 128
    ny: int = 64
    nhermite: int = 8
    nlaguerre: int = 4
    y0: float = 20.0
    t_max_raw: float = 2000.0
    nwrite: int = 100
    nsave: int = 200   # small: a restart file exists even when the guard's deadline stops GX early


def iota_at(s: float, wout: Path = WOUT_W7X_KJM) -> float:
    """Rotational transform at normalised toroidal flux s (linear in s on VMEC's full grid)."""
    import netCDF4
    import numpy as np

    with netCDF4.Dataset(wout) as d:
        iotaf = np.asarray(d["iotaf"][:], dtype=float)
    grid = np.linspace(0.0, 1.0, iotaf.size)
    return float(np.interp(s, grid, iotaf))


def benchmark_gradients(h5: Path = STELLA_BENCHMARK_H5) -> tuple[float, float]:
    """(a/L_T, a/L_n) of the archived nonlinear bean benchmark."""
    import h5py

    with h5py.File(h5, "r") as f:
        return float(f["compared/test5/tgrad"][()]), float(f["compared/test5/ngrad"][()])


def _toml_value(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    raise TypeError(type(v))


def render(tube: str, *, iota: float, tprim: float, fprim: float, vmec_file: str, restart_from: str | None = None,
           restart_to: str = "restart.nc", res: Resolution | None = None) -> str:
    """GX TOML input for one tube. Deterministic for fixed arguments."""
    spec = TUBES[tube]
    res = res or Resolution()
    if restart_from is not None and Path(restart_from).name == Path(restart_to).name:
        raise ValueError("restart_from_file and restart_to_file must differ, or GX overwrites its own checkpoint")
    alpha = -iota * spec.zeta_center
    header = (f"# Labyrinth GX input — {tube} tube, GPU {spec.gpu_index}. UNREHEARSED (D-011).\n"
              f"# W7-X high-mirror, s = {TORFLUX}, zeta_c = {math.degrees(spec.zeta_center):.1f} deg, "
              f"alpha = -iota*zeta_c, iota = {iota:.6f}\n")
    sections = [
        ("Dimensions", {"ntheta": res.ntheta, "nx": res.nx, "ny": res.ny,
                        "nhermite": res.nhermite, "nlaguerre": res.nlaguerre, "nspecies": 1}),
        ("Domain", {"y0": res.y0, "boundary": "linked"}),
        ("Physics", {"beta": 0.0, "nonlinear_mode": True}),
        ("Time", {"t_max": res.t_max_raw, "scheme": "rk3", "cfl": 0.9}),
        ("Initialization", {"ikpar_init": 0, "init_field": "density", "init_amp": 1.0e-3,
                            "init_electrons_only": False}),
        ("Geometry", {"geo_option": "vmec", "vmec_file": vmec_file, "torflux": TORFLUX, "npol": 1.0,
                      "alpha": alpha}),
        ("species", {"z": [1.0], "mass": [1.0], "dens": [1.0], "temp": [1.0], "tprim": [tprim],
                     "fprim": [fprim], "vnewk": [0.0], "type": ["ion"]}),
        ("Boltzmann", {"add_Boltzmann_species": True, "Boltzmann_type": "electrons", "tau_fac": 1.0}),
        ("Dissipation", {"closure_model": "none", "hypercollisions": True, "hyper": True, "D_hyper": 0.05}),
        ("Restart", {"restart": restart_from is not None, "save_for_restart": True, "nsave": res.nsave,
                     "restart_to_file": restart_to, **({"restart_from_file": restart_from} if restart_from else {})}),
        ("Diagnostics", {"nwrite": res.nwrite, "fluxes": True, "fields": False, "moments": False}),
    ]
    return header + "\n" + _toml(sections)


def _toml(sections: list[tuple[str, dict]]) -> str:
    out = []
    for name, body in sections:
        out.append(f"[{name}]")
        for k, v in body.items():
            val = "[ " + ", ".join(_toml_value(x) for x in v) + " ]" if isinstance(v, list) else _toml_value(v)
            out.append(f"  {k} = {val}")
        out.append("")
    return "\n".join(out)


def build_inputs(*, vmec_file: str = "/inputs/wout_w7x_kjm.nc", restart_from: dict[str, str] | None = None,
                 res: Resolution | None = None) -> dict[str, str]:
    """Inputs for both tubes from the pinned data (iota from the wout, gradients from the archive)."""
    iota = iota_at(TORFLUX)
    tprim, fprim = benchmark_gradients()
    restart_from = restart_from or {}
    return {t: render(t, iota=iota, tprim=tprim, fprim=fprim, vmec_file=vmec_file, restart_from=restart_from.get(t),
                      restart_to=f"{t}.restart.nc", res=res) for t in TUBES}
