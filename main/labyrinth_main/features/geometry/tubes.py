"""Bean and triangular flux tubes at rho 0.8, the gray surface mesh and cross-sections (G4, G5).

Tube definition (decision D-010), in stella's convention ``alpha = theta* - iota*zeta``
(``calculate_theta``: theta_pest_target = alpha + iota*zeta):

* centred on the outboard midplane at ``zeta_c``: theta* = 0 at zeta = zeta_c, hence
  ``alpha = -iota*zeta_c`` (same sign as D-010 because stella uses theta* = alpha + iota*zeta);
* one poloidal turn, theta* in [-pi, pi], i.e. zeta = zeta_c + theta*/iota
  (equivalent to stella with zeta_center = zeta_c, nfield_periods = nfp/iota, nzed = 128,
  so stella's ``zed`` equals theta*);
* 129 samples (nzed 128), |B| normalised by stella's B_ref = 2|Phi_edge/2pi|/a^2.

By stellarator symmetry lambda vanishes at theta = 0 for zeta = 0 and zeta = pi/nfp (36 deg), so the
tube centres sit on the VMEC theta = 0 outboard midplane with Z = 0.
"""
from __future__ import annotations

import math

import numpy as np

from .fieldline import FieldLine, trace
from .vmec import Surface, VmecEquilibrium

RHO = 0.8
N_SAMPLES = 129
TUBES = (
    {"id": "bean", "label": "Bean (ζ = 0°)", "zetaCenterDeg": 0.0},
    {"id": "triangular", "label": "Triangular (ζ = 36°)", "zetaCenterDeg": 36.0},
)
SURFACE_N_THETA = 48
SURFACE_N_PHI = 150
CROSS_SECTION_POINTS = 129  # closed polyline: first point repeated at the end
SNAP = 1e-12  # |v| below this (m or rad) is written as exactly 0.0, so rebuilds do not depend on libm


def snap(a) -> np.ndarray:
    """Replace floating-point noise around zero (e.g. Z = 1e-16 on the midplane) by 0.0."""
    a = np.asarray(a, dtype=float)
    return np.where(np.abs(a) < SNAP, 0.0, a)


def tube_alpha(iota: float, zeta_center: float) -> float:
    return -iota * zeta_center


def trace_tube(surf: Surface, zeta_center_deg: float, n_samples: int = N_SAMPLES) -> FieldLine:
    zc = math.radians(zeta_center_deg)
    theta_star = np.linspace(-math.pi, math.pi, n_samples)
    zeta = zc + theta_star / surf.iota
    return trace(surf, tube_alpha(surf.iota, zc), zeta)


def cross_section(surf: Surface, zeta: float, n: int = CROSS_SECTION_POINTS) -> tuple[np.ndarray, np.ndarray]:
    """R, Z of the surface at fixed toroidal angle, VMEC theta in [0, 2pi] (closed polyline)."""
    theta = np.linspace(0.0, 2 * math.pi, n)
    zeta_arr = np.full_like(theta, zeta)
    return snap(surf.R(theta, zeta_arr)), snap(surf.Z(theta, zeta_arr))


def surface_mesh(surf: Surface, n_theta: int = SURFACE_N_THETA, n_phi: int = SURFACE_N_PHI) -> np.ndarray:
    """Flat [x, y, z, ...] over a periodic (phi, theta) grid, row-major in phi, no duplicated seam.

    phi_i = 2*pi*i/n_phi (full torus), theta_j = 2*pi*j/n_theta (VMEC theta).
    """
    phi = 2 * math.pi * np.arange(n_phi) / n_phi
    theta = 2 * math.pi * np.arange(n_theta) / n_theta
    P, T = np.meshgrid(phi, theta, indexing="ij")
    R, Z = surf.R(T, P), surf.Z(T, P)
    xyz = np.stack([R * np.cos(P), R * np.sin(P), Z], axis=-1)
    return snap(xyz.reshape(-1))


def tube_record(eq: VmecEquilibrium, surf: Surface, spec: dict) -> dict:
    fl = trace_tube(surf, spec["zetaCenterDeg"])
    bmag = fl.B / eq.b_ref
    xs_R, xs_Z = cross_section(surf, math.radians(spec["zetaCenterDeg"]))
    samples = [
        {"thetaStar": float(ts), "zeta": float(z), "bmag": float(b), "R": float(r), "Z": float(zz),
         "x": float(x), "y": float(y), "z": float(zz)}
        for ts, z, b, r, zz, x, y in zip(snap(fl.theta_star), snap(fl.zeta), bmag, snap(fl.R), snap(fl.Z),
                                         snap(fl.x), snap(fl.y), strict=True)
    ]
    return {
        "id": spec["id"],
        "label": spec["label"],
        "zetaCenterDeg": spec["zetaCenterDeg"],
        "alpha": fl.alpha,
        "nSamples": len(samples),
        "bmagRange": [float(bmag.min()), float(bmag.max())],
        "samples": samples,
        "crossSection": {"zetaDeg": spec["zetaCenterDeg"], "R": xs_R, "Z": xs_Z},
    }
