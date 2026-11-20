"""Task 01 geometry, backend outcomes G1-G6 (tasks/01-geometry/TASK.md)."""
import json
import math
from functools import lru_cache
from pathlib import Path

import jsonschema
import netCDF4
import numpy as np
import pytest
from referencing import Registry, Resource

from labyrinth_main.common import io, paths
from labyrinth_main.features.geometry import artifact, fieldline, stella_reference, tubes
from labyrinth_main.features.geometry.fieldline import solve_theta, trace
from labyrinth_main.features.geometry.vmec import VmecEquilibrium, radial_weights


@lru_cache(maxsize=1)
def eq() -> VmecEquilibrium:
    return VmecEquilibrium(paths.WOUT_W7X_KJM)


@lru_cache(maxsize=1)
def built() -> dict:
    """The artifact as written to disk (after 7-significant-figure rounding)."""
    return json.loads(io.dumps(artifact.build()))


def _validator() -> jsonschema.Draft202012Validator:
    registry = Registry()
    for p in Path(paths.CONTRACTS).glob("*.schema.json"):
        schema = json.loads(p.read_text())
        res = Resource.from_contents(schema)
        registry = registry.with_resources([(p.name, res), (schema["$id"], res)])
    schema = json.loads((paths.CONTRACTS / artifact.SCHEMA).read_text())
    return jsonschema.Draft202012Validator(schema, registry=registry)


class _Independent:
    """Direct evaluation from the raw wout arrays with np.interp radial interpolation: a code path
    independent of vmec.radial_weights / Surface, used to check the artifact's numbers."""

    def __init__(self, s: float):
        with netCDF4.Dataset(paths.WOUT_W7X_KJM) as d:
            g = {k: np.array(d.variables[k][...], dtype=float) for k in
                 ("xm", "xn", "xm_nyq", "xn_nyq", "rmnc", "zmns", "lmns", "bmnc", "bsupumnc", "bsupvmnc",
                  "iotas")}
        ns = g["rmnc"].shape[0]
        s_full = np.arange(ns) / (ns - 1)
        s_half = (np.arange(ns) - 0.5) / (ns - 1)

        def full(a):
            return np.array([np.interp(s, s_full, a[:, k]) for k in range(a.shape[1])])

        def half(a):
            return np.array([np.interp(s, s_half[1:], a[1:, k]) for k in range(a.shape[1])])

        self.g = g
        self.rmnc, self.zmns, self.lmns = full(g["rmnc"]), full(g["zmns"]), half(g["lmns"])
        self.bmnc, self.bsupu, self.bsupv = half(g["bmnc"]), half(g["bsupumnc"]), half(g["bsupvmnc"])
        self.iota = float(np.interp(s, s_half[1:], g["iotas"][1:]))

    def eval(self, theta: float, zeta: float) -> tuple[float, float, float]:
        a = self.g["xm"] * theta - self.g["xn"] * zeta
        an = self.g["xm_nyq"] * theta - self.g["xn_nyq"] * zeta
        return float(np.cos(a) @ self.rmnc), float(np.sin(a) @ self.zmns), float(np.cos(an) @ self.bmnc)

    def theta_from_theta_star(self, theta_star: float, zeta: float) -> float:
        lo, hi = theta_star - 1.0, theta_star + 1.0  # plain bisection on theta + lambda - theta*

        def f(t):
            return t + float(np.sin(self.g["xm"] * t - self.g["xn"] * zeta) @ self.lmns) - theta_star

        for _ in range(60):
            mid = 0.5 * (lo + hi)
            lo, hi = (mid, hi) if np.sign(f(mid)) == np.sign(f(lo)) else (lo, mid)
        return 0.5 * (lo + hi)

    def dtheta_dzeta(self, zeta: float, theta: float) -> float:
        """Field-line equation in VMEC coordinates: dtheta/dzeta = B^theta / B^zeta."""
        c = np.cos(self.g["xm_nyq"] * theta - self.g["xn_nyq"] * zeta)
        return float(c @ self.bsupu) / float(c @ self.bsupv)


# ---- G1 --------------------------------------------------------------------
def test_vmec_reader_header():
    e = eq()
    assert (e.nfp, e.ns, e.mnmax, e.lasym) == (5, 99, 288, False)
    # stella's reference normalisation, printed in the saved test_2 header (aref 0.4944, bref 2.604)
    assert e.l_ref == pytest.approx(0.4944, abs=5e-5)
    assert e.b_ref == pytest.approx(2.604, abs=5e-4)
    # half-grid iota interpolation: stella's qinp at s 0.49 is printed 0.1112E+01
    assert 1 / e.iota(0.49) == pytest.approx(1.112, abs=5e-4)
    assert e.iota(0.64) == pytest.approx(0.9102, abs=1e-4)
    # radial interpolation weights (stella get_chosen_flux_surface), 0-based indices
    i0, i1, w0, w1 = radial_weights(10 / 98, 99, "full")
    assert (i0, i1, w0, w1) == (10, 11, 1.0, 0.0)
    assert radial_weights(1.0, 99, "full") == (97, 98, 0.0, 1.0)
    i0, i1, w0, w1 = radial_weights(9.5 / 98, 99, "half")
    assert (i0, i1) == (10, 11) and w0 == pytest.approx(1.0) and w1 == pytest.approx(0.0, abs=1e-12)
    # below the first half-grid point (0.5/98): linear extrapolation from half-grid indices 1, 2
    i0, i1, w0, w1 = radial_weights(0.002, 99, "half")
    assert (i0, i1) == (1, 2) and w0 == pytest.approx(1.5 - 0.002 * 98) and w0 + w1 == pytest.approx(1.0)
    # exactly the last half-grid point (97.5/98) and beyond it: indices 97, 98
    assert radial_weights(97.5 / 98, 99, "half") == (97, 98, 0.0, 1.0)
    i0, i1, w0, w1 = radial_weights(0.999, 99, "half")
    assert (i0, i1) == (97, 98) and w0 == pytest.approx(97.5 - 0.999 * 98) and w0 < 0
    assert w0 + w1 == pytest.approx(1.0)
    with pytest.raises(ValueError):
        radial_weights(1.01, 99, "full")
    surf = e.surface(10 / 98)
    np.testing.assert_array_equal(surf.rmnc, e.rmnc[10])
    # R, Z, |B|, lambda at an arbitrary s agree with an independent np.interp evaluation
    s64, ind = e.surface(0.64), _Independent(0.64)
    for th, ze in ((0.3, 0.1), (-2.0, 1.0), (2.5, -0.7)):
        R, Z, B = ind.eval(th, ze)
        assert float(s64.R(th, ze)) == pytest.approx(R, abs=1e-12)
        assert float(s64.Z(th, ze)) == pytest.approx(Z, abs=1e-12)
        assert float(s64.B(th, ze)) == pytest.approx(B, abs=1e-12)
    # stellarator symmetry: Z(0,0) = lambda(0,0) = 0
    assert float(s64.Z(0.0, 0.0)) == pytest.approx(0.0, abs=1e-12)
    assert float(s64.lam(0.0, 0.0)) == pytest.approx(0.0, abs=1e-12)


# ---- G2 --------------------------------------------------------------------
def test_sfl_root_solve_roundtrip():
    surf = eq().surface(0.64)
    rng = np.random.default_rng(0)
    theta_true = rng.uniform(-math.pi, math.pi, 200)
    zeta = rng.uniform(-math.pi, math.pi, 200)
    theta_star = theta_true + surf.lam(theta_true, zeta)
    theta, ok = fieldline._newton(surf, theta_star, zeta, fieldline.NEWTON_TOL, fieldline.NEWTON_MAXITER)
    assert ok.all()  # Newton is safe everywhere on this surface: 1 + dlambda/dtheta > 0
    assert np.all(1.0 + surf.dlam_dtheta(theta, zeta) > 0)
    np.testing.assert_allclose(solve_theta(surf, theta_star, zeta), theta_true, atol=1e-11, rtol=0)
    # traced samples lie on the requested field line alpha = theta* - iota*zeta
    alpha = -0.3
    fl = trace(surf, alpha, np.linspace(-2, 2, 33))
    recovered = fl.theta + surf.lam(fl.theta, fl.zeta) - surf.iota * fl.zeta
    np.testing.assert_allclose(recovered, alpha, atol=1e-11, rtol=0)


def test_sfl_root_solve_falls_back_to_bracketing():
    surf = eq().surface(0.64)
    rng = np.random.default_rng(1)
    theta_true = rng.uniform(-math.pi, math.pi, 50)
    zeta = rng.uniform(-math.pi, math.pi, 50)
    theta_star = theta_true + surf.lam(theta_true, zeta)
    # (a) Newton not allowed to converge (one iteration) -> every point re-solved by bisection
    _, ok = fieldline._newton(surf, theta_star, zeta, fieldline.NEWTON_TOL, 1)
    assert not ok.any()
    np.testing.assert_allclose(solve_theta(surf, theta_star, zeta, maxiter=1), theta_true, atol=1e-11, rtol=0)

    # (b) the guard 1 + dlambda/dtheta > 0 fails -> Newton refuses, bracketing still finds the root
    class BadDerivative:
        def lam(self, theta, zeta):
            return surf.lam(theta, zeta)

        def dlam_dtheta(self, theta, zeta):
            return np.full(np.shape(theta), -2.0)

    _, ok = fieldline._newton(BadDerivative(), theta_star, zeta, fieldline.NEWTON_TOL, 50)
    assert not ok.any()
    np.testing.assert_allclose(solve_theta(BadDerivative(), theta_star, zeta), theta_true, atol=1e-11, rtol=0)


# ---- G3 --------------------------------------------------------------------
def test_reproduces_stella_saved_bmag_to_printed_precision():
    params = stella_reference.run_parameters(paths.STELLA_TEST2_INPUT)
    assert params == {"torflux": 0.49, "nfield_periods": 6.073867, "nzed": 24, "alpha0": 0.0, "zeta_center": 0.0}
    ref = stella_reference.read_geometry_file(paths.STELLA_TEST2_GEOMETRY)
    assert len(ref["rows"]) == params["nzed"] + 1
    res = stella_reference.compare(eq(), paths.STELLA_TEST2_GEOMETRY, paths.STELLA_TEST2_INPUT)
    assert res["samplesCompared"] == 25
    for row, z, b in zip(ref["rows"], res["computedZeta"], res["computedBmag"], strict=True):
        assert abs(z - row["zeta"].value) <= row["zeta"].half_unit, (z, row["zeta"])
        assert abs(b - row["bmag"].value) <= row["bmag"].half_unit, (b, row["bmag"])
        # rounding our value to 4 significant figures gives exactly stella's printed value
        assert float(f"{b:.3e}") == row["bmag"].value
    assert res["allWithinPrintedPrecision"] is True
    # cross-check the debug companion file: theta_vmec (printed as theta/nfp)
    geo = [ln.split() for ln in paths.STELLA_TEST2_VMEC_GEO.read_text().splitlines()
           if ln.strip() and not ln.lstrip().startswith("#") and len(ln.split()) == 17]
    theta_ref = np.array([float(r[14]) for r in geo])
    np.testing.assert_allclose(res["computedTheta"] / 5, theta_ref, atol=5e-5, rtol=0)
    v = built()["validation"]["stellaReference"]
    assert v["samplesCompared"] == 25 and v["printedSignificantFigures"] == 4
    assert v["allWithinPrintedPrecision"] is True
    assert v["maxAbsError"] <= 5e-4


def test_reproduces_stella_float64_bmag():
    """Same run, stella's float64 bmag(zed, alpha) from EXPECTED_OUTPUT.vmec_geometry.out.nc."""
    res = stella_reference.compare_out_nc(eq(), paths.STELLA_TEST2_INPUT, paths.STELLA_TEST2_OUT_NC)
    assert res["samplesCompared"] == 25
    assert res["maxAbsErrorZed"] < 1e-12
    assert res["maxAbsErrorBmag"] < 1e-10


def test_stella_reference_rejects_mismatched_input(tmp_path):
    text = paths.STELLA_TEST2_INPUT.read_text().replace("torflux = 0.49", "torflux = 0.5")
    assert text != paths.STELLA_TEST2_INPUT.read_text()
    bad = tmp_path / "bad.in"
    bad.write_text(text)
    with pytest.raises(ValueError, match="torflux"):
        stella_reference.compare(eq(), paths.STELLA_TEST2_GEOMETRY, bad)


# ---- G4 --------------------------------------------------------------------
def test_artifact_tubes_129_samples_centered():
    a = built()
    _validator().validate(a)
    assert a["surface"]["rho"] == 0.8 and a["surface"]["s"] == pytest.approx(0.64)
    ind = _Independent(0.64)
    assert a["surface"]["iota"] == pytest.approx(ind.iota, rel=1e-6)
    by_id = {t["id"]: t for t in a["tubes"]}
    assert [t["id"] for t in a["tubes"]] == ["bean", "triangular"]
    for tid, zc_deg in (("bean", 0.0), ("triangular", 36.0)):
        t = by_id[tid]
        smp = t["samples"]
        assert t["zetaCenterDeg"] == zc_deg and t["crossSection"]["zetaDeg"] == zc_deg
        assert t["nSamples"] == 129 and len(smp) == 129
        zc = math.radians(zc_deg)
        assert t["alpha"] == pytest.approx(-ind.iota * zc, abs=1e-6)  # D-010
        ts = np.array([p["thetaStar"] for p in smp])
        zeta = np.array([p["zeta"] for p in smp])
        # one poloidal turn: theta* from -pi to pi, i.e. delta zeta = 2 pi / iota (iota evaluated independently)
        assert ts[0] == pytest.approx(-math.pi, abs=1e-6) and ts[-1] == pytest.approx(math.pi, abs=1e-6)
        assert zeta[-1] - zeta[0] == pytest.approx(2 * math.pi / ind.iota, rel=1e-6)
        np.testing.assert_allclose(np.diff(zeta), (zeta[-1] - zeta[0]) / 128, atol=2e-6, rtol=0)
        # centred on the outboard midplane at zeta_c
        mid = smp[64]
        assert mid["thetaStar"] == 0.0 and mid["zeta"] == pytest.approx(zc, abs=1e-6)
        assert mid["Z"] == 0.0
        assert mid["R"] == pytest.approx(max(t["crossSection"]["R"]), abs=1e-6)
        # every 8th sample re-derived independently: bisection for theta, direct Fourier sums for R, Z, |B|
        for p in smp[::8]:
            th = ind.theta_from_theta_star(p["thetaStar"], p["zeta"])
            R, Z, B = ind.eval(th, p["zeta"])
            assert p["R"] == pytest.approx(R, abs=2e-6)
            assert p["Z"] == pytest.approx(Z, abs=2e-6)
            assert p["bmag"] == pytest.approx(B / eq().b_ref, rel=2e-6)
            # zeta is rounded to 7 significant figures (|dzeta| <= 5e-7), so x, y carry up to ~3e-6 m
            assert (p["x"], p["y"]) == (pytest.approx(R * math.cos(p["zeta"]), abs=5e-6),
                                        pytest.approx(R * math.sin(p["zeta"]), abs=5e-6))
        # the samples really follow the magnetic field: integrate dtheta/dzeta = B^theta/B^zeta (RK4,
        # from VMEC bsupu/bsupv, no lambda) out from the centre and compare the VMEC theta it reaches
        thetas = {i: ind.theta_from_theta_star(smp[i]["thetaStar"], smp[i]["zeta"]) for i in (0, 32, 96, 128)}
        for end in (0, 32, 96, 128):
            th, z = 0.0, zc
            n = 400
            h = (smp[end]["zeta"] - zc) / n
            for _ in range(n):
                k1 = ind.dtheta_dzeta(z, th)
                k2 = ind.dtheta_dzeta(z + h / 2, th + h / 2 * k1)
                k3 = ind.dtheta_dzeta(z + h / 2, th + h / 2 * k2)
                k4 = ind.dtheta_dzeta(z + h, th + h * k3)
                th, z = th + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4), z + h
            assert th == pytest.approx(thetas[end], abs=5e-4), (tid, end)
        b = np.array([p["bmag"] for p in smp])
        assert 0.5 < b.min() < b.max() < 1.6
        assert t["bmagRange"][0] <= b.min() and t["bmagRange"][1] >= b.max()
    # stellarator symmetry: the bean tube centred at zeta 0 is up-down symmetric
    bean = by_id["bean"]["samples"]
    np.testing.assert_allclose([p["bmag"] for p in bean], [p["bmag"] for p in bean[::-1]], atol=1e-6)
    np.testing.assert_allclose([p["Z"] for p in bean], [-p["Z"] for p in bean[::-1]], atol=1e-6)


# ---- G5 --------------------------------------------------------------------
def test_surface_and_bean_outboard_midplane():
    a = built()
    srf = a["surface"]
    assert (srf["nTheta"], srf["nPhi"]) == (tubes.SURFACE_N_THETA, tubes.SURFACE_N_PHI)
    pos = np.array(srf["positions"]).reshape(srf["nPhi"], srf["nTheta"], 3)
    # row-major over (phi, theta): first row is the zeta 0 cross-section (y = 0, snapped exactly)
    assert np.all(pos[0, :, 1] == 0.0)
    R0 = np.hypot(pos[0, :, 0], pos[0, :, 1])
    assert 6.05 <= R0[0] <= 6.25 and pos[0, 0, 2] == 0.0  # theta 0 = outboard midplane
    # no float noise near zero anywhere in the emitted geometry
    flat = np.concatenate([pos.ravel()] + [np.ravel(b[k]) for b in srf["boundary"].values() for k in ("R", "Z")])
    assert not np.any((flat != 0.0) & (np.abs(flat) < 1e-12))
    bean = next(t for t in a["tubes"] if t["id"] == "bean")
    xs = bean["crossSection"]
    assert xs["zetaDeg"] == 0.0
    i = int(np.argmax(xs["R"]))
    assert 6.05 <= xs["R"][i] <= 6.25 and abs(xs["Z"][i]) < 1e-3
    assert 6.05 <= bean["samples"][64]["R"] <= 6.25
    # plasma boundary at each tube centre; bean boundary spans the design image (R 5.55-6.17, Z +-0.83)
    assert set(srf["boundary"]) == {"bean", "triangular"}
    bR, bZ = np.array(srf["boundary"]["bean"]["R"]), np.array(srf["boundary"]["bean"]["Z"])
    assert 5.45 < bR.min() < 5.65 and 6.1 < bR.max() < 6.3 and 0.75 < bZ.max() < 0.95
    assert bR.max() > max(xs["R"]) and bR.min() < min(xs["R"])  # boundary encloses the rho 0.8 surface
    assert len(io.dumps(a)) < 600_000


# ---- G6 --------------------------------------------------------------------
def test_acceptance129_is_blocked_not_passed():
    a = built()
    acc = a["validation"]["acceptance129"]
    assert acc["outcome"] == "blocked"
    assert "129" in acc["details"] and "D-007" in acc["details"]
    assert "not in this repo" in acc["details"]
    prov = a["provenance"]
    assert prov["kind"] == "derived"
    # the overall badge must never read "passed" while the PRD acceptance is blocked
    assert prov["verification"]["outcome"] != "passed"
    assert prov["verification"]["outcome"] == "blocked"
    assert "Tracer validated vs stella rho 0.7: passed" in prov["verification"]["details"]
