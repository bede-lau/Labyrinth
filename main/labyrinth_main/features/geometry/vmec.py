"""VMEC wout reader and Fourier evaluation, following stella's conventions exactly.

stella reference (commit 6f60964d, STELLA_CODE/geometry/geometry_vmec_read_netCDF_file.f90):

* Fourier angle is ``m*theta - n*zeta`` with ``xn`` already multiplied by nfp.
* R, Z (``rmnc``, ``zmns``) live on the full radial grid s_j = j/(ns-1).
* lambda (``lmns``), |B| (``bmnc`` on the ``_nyq`` modes) and iota (``iotas``) live on the
  half grid s_j = (j-1/2)/(ns-1); index 0 of every half-grid array is unused.
* A quantity at arbitrary s is the linear two-point interpolation of
  ``get_chosen_flux_surface`` (``radial_interpolation``), reproduced in :func:`radial_weights`,
  including stella's linear extrapolation beyond the last half-grid point.
* ``B_ref = 2*|phi(ns)/(2*pi)| / Aminor_p**2`` and ``L_ref = Aminor_p`` (GIST choice).

Only stellarator-symmetric equilibria (``lasym = 0``) are supported; the pinned file is one.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np


def radial_weights(s: float, ns: int, grid: str) -> tuple[int, int, float, float]:
    """(i0, i1, w0, w1) such that Q(s) = Q[i0]*w0 + Q[i1]*w1 (0-based), as stella computes them."""
    if not 0.0 <= s <= 1.0:
        raise ValueError(f"s must lie in [0, 1], got {s}")
    x = s * (ns - 1)
    if grid == "full":
        if s == 1.0:
            i0, w0 = ns - 2, 0.0
        else:
            i0 = math.floor(x)
            w0 = i0 + 1 - x
        return i0, i0 + 1, w0, 1.0 - w0
    if grid != "half":
        raise ValueError("grid must be 'full' or 'half'")
    # half-grid value Q[j] (j >= 1) sits at s = (j - 1/2)/(ns - 1)
    s_half_first = 0.5 / (ns - 1)
    s_half_last = (ns - 1.5) / (ns - 1)
    if s < s_half_first:  # extrapolate towards the axis (stella warns)
        i0 = 1
        w0 = (1.5 / (ns - 1) - s) * (ns - 1)
    elif s >= s_half_last:  # last half point or beyond: extrapolate towards the LCFS
        i0 = ns - 2
        w0 = 0.0 if s == s_half_last else (s_half_last - s) * (ns - 1)
    else:
        i0 = max(math.floor(x + 0.5), 1)
        w0 = i0 + 0.5 - x
    return i0, i0 + 1, w0, 1.0 - w0


def _interp(arr: np.ndarray, s: float, grid: str) -> np.ndarray:
    i0, i1, w0, w1 = radial_weights(s, arr.shape[0], grid)
    return arr[i0] * w0 + arr[i1] * w1


@dataclass(frozen=True)
class Surface:
    """Fourier coefficients of one flux surface, interpolated to s exactly as stella does."""

    s: float
    iota: float
    xm: np.ndarray
    xn: np.ndarray
    rmnc: np.ndarray
    zmns: np.ndarray
    lmns: np.ndarray
    xm_nyq: np.ndarray
    xn_nyq: np.ndarray
    bmnc: np.ndarray

    def _angle(self, m: np.ndarray, n: np.ndarray, theta, zeta) -> np.ndarray:
        theta = np.asarray(theta, dtype=float)[..., None]
        zeta = np.asarray(zeta, dtype=float)[..., None]
        return m * theta - n * zeta

    def R(self, theta, zeta) -> np.ndarray:
        return np.cos(self._angle(self.xm, self.xn, theta, zeta)) @ self.rmnc

    def Z(self, theta, zeta) -> np.ndarray:
        return np.sin(self._angle(self.xm, self.xn, theta, zeta)) @ self.zmns

    def lam(self, theta, zeta) -> np.ndarray:
        return np.sin(self._angle(self.xm, self.xn, theta, zeta)) @ self.lmns

    def dlam_dtheta(self, theta, zeta) -> np.ndarray:
        return np.cos(self._angle(self.xm, self.xn, theta, zeta)) @ (self.xm * self.lmns)

    def B(self, theta, zeta) -> np.ndarray:
        return np.cos(self._angle(self.xm_nyq, self.xn_nyq, theta, zeta)) @ self.bmnc


class VmecEquilibrium:
    """Minimal reader for a VMEC ``wout_*.nc`` file (stellarator-symmetric)."""

    def __init__(self, path: Path):
        import netCDF4

        with netCDF4.Dataset(path) as d:
            v = d.variables

            def get(name: str) -> np.ndarray:
                return np.array(v[name][...], dtype=float)

            self.path = Path(path)
            self.nfp = int(v["nfp"][...])
            self.ns = int(v["ns"][...])
            self.mnmax = int(v["mnmax"][...])
            self.mnmax_nyq = int(v["mnmax_nyq"][...])
            self.lasym = bool(int(v["lasym__logical__"][...]))
            self.signgs = int(v["signgs"][...])
            self.aminor = float(v["Aminor_p"][...])
            self.rmajor = float(v["Rmajor_p"][...])
            self.xm, self.xn = get("xm"), get("xn")
            self.xm_nyq, self.xn_nyq = get("xm_nyq"), get("xn_nyq")
            self.rmnc, self.zmns, self.lmns = get("rmnc"), get("zmns"), get("lmns")
            self.bmnc = get("bmnc")
            self.iotas, self.iotaf = get("iotas"), get("iotaf")
            self.phi = get("phi")
        if self.lasym:
            raise NotImplementedError("stellarator-asymmetric (lasym) equilibria are not supported")
        # stella: edge_toroidal_flux_over_2pi = phi(ns)/(2 pi) * isigng; Bref = 2|...|/a^2
        self.edge_toroidal_flux_over_2pi = self.phi[-1] / (2 * math.pi) * self.signgs
        self.b_ref = 2 * abs(self.edge_toroidal_flux_over_2pi) / self.aminor**2
        self.l_ref = self.aminor

    def iota(self, s: float) -> float:
        """iota at s from the half-grid ``iotas`` (as stella's calculate_quantities_on_fluxsurface)."""
        return float(_interp(self.iotas, s, "half"))

    def surface(self, s: float) -> Surface:
        return Surface(
            s=s,
            iota=self.iota(s),
            xm=self.xm,
            xn=self.xn,
            rmnc=_interp(self.rmnc, s, "full"),
            zmns=_interp(self.zmns, s, "full"),
            lmns=_interp(self.lmns, s, "half"),
            xm_nyq=self.xm_nyq,
            xn_nyq=self.xn_nyq,
            bmnc=_interp(self.bmnc, s, "half"),
        )
