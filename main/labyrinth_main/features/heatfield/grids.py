"""Real data of the Heat & field view (D-027 §2, task 10 H1-H3): VMEC surfaces, LCFS field lines, schematic diverters.

* Surfaces rho_m = m/8, m = 0..8 (s = rho^2), on theta_i = 2*pi*i/48 (VMEC theta) x phi_j = 2*pi*j/72 (geometric
  toroidal angle), flat index c = j*nTheta + i. R, Z (m) and |B| (T, absolute VMEC bmnc) come from the existing reader
  (`geometry/vmec.py`, stella's radial interpolation: at rho 0 and rho 1 the half-grid |B| and iota are extrapolated
  as stella does). rho 0 is the magnetic axis: R and Z do not depend on theta there (VMEC stores no m > 0 axis modes).
  |B| on the axis does depend on theta a little (about 0.03 T, 1 %, on this equilibrium): stella's linear-in-s
  extrapolation of the half-grid m > 0 bmnc modes does not vanish at s = 0. MODEL.md keeps that extrapolation, so it is
  kept here and stated, with its measured size (`axis_b_theta_spread`), in the geometry provenance.
* Eight field lines on the LCFS, alpha = 2*pi*m/8, one toroidal turn, from the straight-field-line tracer
  (`geometry/fieldline.py`, stella's theta* = alpha + iota*zeta).
* Four schematic diverters at phi = 0, pi/2, pi, 3*pi/2 (the owner's sketch; W7-X has ten divertor units).

|values| below 1e-12 are written as exactly 0.0 (`tubes.snap`) so the artifact rebuilds byte-identically.
"""
from __future__ import annotations

import math

import numpy as np

from ..geometry.fieldline import trace
from ..geometry.tubes import snap
from ..geometry.vmec import VmecEquilibrium

N_THETA = 48
N_PHI = 72
N_RADIAL = 8  # surfaces rho = m / N_RADIAL, m = 0..N_RADIAL
LAYOUT = "phi-major: c = j*nTheta + i"
ANGLES = (
    "theta_i = 2*pi*i/nTheta, i = 0..nTheta-1 (VMEC poloidal angle; theta = 0 outboard midplane, theta = pi/2 top, Z > 0); "
    "phi_j = 2*pi*j/nPhi, j = 0..nPhi-1 (geometric toroidal angle; x = R cos phi, y = R sin phi, z = Z); both periodic, "
    "no duplicated seam; flat index c = j*nTheta + i"
)
AXIS_TOLERANCE = 1e-9  # m: the axis R, Z may not vary with theta by more than this before it is made exact

N_FIELD_LINES = 8
FIELD_LINE_SAMPLES = 181  # phi in [0, 2*pi], 2 degree spacing, both ends included

THETA_CENTRE = math.pi / 2  # VMEC theta of the plate centre and of the unswept strike line (the top)
HALF_WIDTH_THETA = 0.35  # rad, drawing only
DIVERTER_LABELS = ("0", "π/2", "π", "3π/2")
DIVERTER_NOTE = (
    "Schematic positions as specified by the owner (2026-11-21). W7-X has ten island-divertor units, upper and lower "
    "in each of its five field periods; these four do not represent them."
)


def angles(n_theta: int = N_THETA, n_phi: int = N_PHI) -> tuple[np.ndarray, np.ndarray]:
    """(theta_i, phi_j) of the shared grid."""
    return 2 * math.pi * np.arange(n_theta) / n_theta, 2 * math.pi * np.arange(n_phi) / n_phi


def mesh(n_theta: int = N_THETA, n_phi: int = N_PHI) -> tuple[np.ndarray, np.ndarray]:
    """(THETA, PHI), each of shape (nPhi, nTheta): row j is the plane phi_j, so ravel() gives c = j*nTheta + i."""
    theta, phi = angles(n_theta, n_phi)
    P, T = np.meshgrid(phi, theta, indexing="ij")
    return T, P


def surface_record(eq: VmecEquilibrium, m: int) -> dict:
    """Surface rho = m/8 on the grid: rho, s, iota and flat R, Z (m) and |B| (T)."""
    rho = m / N_RADIAL
    s = rho * rho
    surf = eq.surface(s)
    T, P = mesh()
    R, Z, B = surf.R(T, P), surf.Z(T, P), surf.B(T, P)
    if m == 0:
        spread = max(float(np.abs(R - R[:, :1]).max()), float(np.abs(Z - Z[:, :1]).max()))
        if spread > AXIS_TOLERANCE:
            raise ValueError(f"the magnetic axis depends on theta by {spread:g} m; the equilibrium has m > 0 axis modes")
        R = np.broadcast_to(R[:, :1], R.shape)
        Z = np.broadcast_to(Z[:, :1], Z.shape)
    if not np.all(B > 0):
        raise ValueError(f"|B| must be positive on rho {rho}")
    return {"rho": rho, "s": s, "iota": surf.iota, "R": snap(R).ravel(), "Z": snap(Z).ravel(), "B": snap(B).ravel()}


def surfaces(eq: VmecEquilibrium) -> list[dict]:
    return [surface_record(eq, m) for m in range(N_RADIAL + 1)]


def axis_b_theta_spread(b_axis, n_theta: int = N_THETA, n_phi: int = N_PHI) -> tuple[float, float]:
    """(largest per-plane max - min of |B| over theta, mean |B|) in T, of the flat |B| of the axis surface (rho 0)."""
    B = np.asarray(b_axis, dtype=float).reshape(n_phi, n_theta)
    return float((B.max(axis=1) - B.min(axis=1)).max()), float(B.mean())


def field_line_alphas() -> list[float]:
    return [2 * math.pi * m / N_FIELD_LINES for m in range(N_FIELD_LINES)]


def field_line_phi() -> np.ndarray:
    return np.linspace(0.0, 2 * math.pi, FIELD_LINE_SAMPLES)


def field_lines(eq: VmecEquilibrium) -> list[dict]:
    """Eight LCFS field lines, one toroidal turn each (theta* = alpha + iota*phi, stella convention)."""
    lcfs = eq.surface(1.0)
    phi = field_line_phi()
    out = []
    for alpha in field_line_alphas():
        fl = trace(lcfs, alpha, phi)
        out.append({"alpha": alpha, "phi": snap(phi), "x": snap(fl.x), "y": snap(fl.y), "z": snap(fl.Z),
                    "B": snap(fl.B)})
    return out


def diverters() -> dict:
    items = [{"id": f"D{k + 1}", "phi": k * math.pi / 2, "label": f"D{k + 1} · {DIVERTER_LABELS[k]} rad"}
             for k in range(4)]
    return {"note": DIVERTER_NOTE, "thetaCentre": THETA_CENTRE, "halfWidthTheta": HALF_WIDTH_THETA, "items": items}
