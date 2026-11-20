"""Straight-field-line tracer (stella convention).

On a flux surface a field line is labelled by ``alpha = theta* - iota*zeta`` with the PEST angle
``theta* = theta + lambda(s, theta, zeta)`` (``theta`` = VMEC poloidal angle, ``zeta`` = VMEC
geometric toroidal angle). For each ``zeta`` we know ``theta* = alpha + iota*zeta`` and solve
``theta + lambda(theta, zeta) = theta*`` for ``theta`` with Newton's method. stella does the same
with a bracketing Brent solver (``calculate_theta``); both converge to the same unique root because
``1 + d(lambda)/d(theta) > 0`` on a nested-surface equilibrium. Newton is guarded on that condition
and falls back to bracketing + bisection wherever it fails.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .vmec import Surface

NEWTON_TOL = 1e-12
NEWTON_MAXITER = 50


def _residual(surf: Surface, theta, zeta, theta_star) -> np.ndarray:
    return theta + surf.lam(theta, zeta) - theta_star


def _newton(surf: Surface, theta_star, zeta, tol: float, maxiter: int) -> tuple[np.ndarray, np.ndarray]:
    """Vectorised Newton. Returns (theta, ok); ok is False where 1 + dlambda/dtheta <= 0 was met,
    the iteration did not converge, or the result is not a root."""
    theta = theta_star.copy()
    ok = np.ones(theta.shape, dtype=bool)
    converged = np.zeros(theta.shape, dtype=bool)
    for _ in range(maxiter):
        fp = 1.0 + surf.dlam_dtheta(theta, zeta)
        ok &= fp > 0  # monotone residual guard: a Newton step through fp <= 0 is meaningless
        step = np.where(ok, _residual(surf, theta, zeta, theta_star) / np.where(ok, fp, 1.0), 0.0)
        theta = theta - step
        converged |= np.abs(step) < tol
        if np.all(converged | ~ok):
            break
    ok &= converged & np.isfinite(theta)
    ok &= np.abs(_residual(surf, theta, zeta, theta_star)) < 10 * tol
    return theta, ok


def _bracket(surf: Surface, theta_star, zeta, tol: float) -> np.ndarray:
    """stella-style fallback: bracket the root in theta* +- 0.3, widening by 0.3 up to 10 times
    (``get_root`` in geometry_vmec_read_netCDF_file.f90), then bisect to ``tol``."""
    a, b = theta_star - 0.3, theta_star + 0.3
    fa, fb = _residual(surf, a, zeta, theta_star), _residual(surf, b, zeta, theta_star)
    for _ in range(10):
        bad = np.sign(fa) == np.sign(fb)
        if not np.any(bad):
            break
        a, b = np.where(bad, a - 0.3, a), np.where(bad, b + 0.3, b)
        fa, fb = _residual(surf, a, zeta, theta_star), _residual(surf, b, zeta, theta_star)
    if np.any(np.sign(fa) == np.sign(fb)):
        raise RuntimeError("could not bracket the VMEC theta root")
    while np.max(b - a) > tol:
        m = 0.5 * (a + b)
        fm = _residual(surf, m, zeta, theta_star)
        left = np.sign(fm) == np.sign(fa)
        a, fa = np.where(left, m, a), np.where(left, fm, fa)
        b = np.where(left, b, m)
    return 0.5 * (a + b)


def solve_theta(surf: Surface, theta_star, zeta, tol: float = NEWTON_TOL,
                maxiter: int = NEWTON_MAXITER) -> np.ndarray:
    """VMEC theta such that theta + lambda(theta, zeta) = theta_star.

    Newton first; any point where Newton is unsafe (1 + dlambda/dtheta <= 0) or does not converge
    within ``maxiter`` is re-solved by bracketing + bisection, as stella's Brent solver would.
    """
    theta_star = np.asarray(theta_star, dtype=float)
    zeta = np.broadcast_to(np.asarray(zeta, dtype=float), theta_star.shape)
    theta, ok = _newton(surf, theta_star, zeta, tol, maxiter)
    if not np.all(ok):
        bad = ~ok
        theta = theta.copy()
        theta[bad] = _bracket(surf, theta_star[bad], zeta[bad], tol)
    return theta


@dataclass(frozen=True)
class FieldLine:
    s: float
    iota: float
    alpha: float
    zeta: np.ndarray
    theta_star: np.ndarray
    theta: np.ndarray
    R: np.ndarray
    Z: np.ndarray
    B: np.ndarray  # tesla

    @property
    def x(self) -> np.ndarray:
        return self.R * np.cos(self.zeta)

    @property
    def y(self) -> np.ndarray:
        return self.R * np.sin(self.zeta)


def trace(surf: Surface, alpha: float, zeta) -> FieldLine:
    """Sample the field line ``alpha`` (theta* = alpha + iota*zeta) at the given toroidal angles."""
    zeta = np.asarray(zeta, dtype=float)
    theta_star = alpha + surf.iota * zeta
    theta = solve_theta(surf, theta_star, zeta)
    return FieldLine(s=surf.s, iota=surf.iota, alpha=alpha, zeta=zeta, theta_star=theta_star,
                     theta=theta, R=surf.R(theta, zeta), Z=surf.Z(theta, zeta), B=surf.B(theta, zeta))


def stella_zeta_grid(nfp: int, nfield_periods: float, nzed: int, zeta_center: float = 0.0) -> np.ndarray:
    """stella's VMEC zeta grid: zeta_center + pi*j*nfield_periods/(nfp*nzgrid), j = -nzgrid..nzgrid."""
    nzgrid = nzed // 2
    j = np.arange(-nzgrid, nzgrid + 1)
    return zeta_center + np.pi * j * nfield_periods / (nfp * nzgrid)
