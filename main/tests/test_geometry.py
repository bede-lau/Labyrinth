"""Task 01 geometry, backend outcomes G1-G6 (tasks/01-geometry/TASK.md)."""
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
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
    assert stella_reference.FLOAT64_TOLERANCE == 1e-10
    assert res["maxAbsErrorBmag"] < stella_reference.FLOAT64_TOLERANCE
    assert res["allWithinTolerance"] is True
    # relative error from the same arrays, recomputed here straight from the out.nc file
    with netCDF4.Dataset(paths.STELLA_TEST2_OUT_NC) as d:
        ref = np.array(d.variables["bmag"][...], dtype=float)[:, 0]
    assert 0 < res["maxRelErrorBmag"] <= res["maxAbsErrorBmag"] / np.abs(ref).min() * (1 + 1e-12)
    assert res["maxRelErrorBmag"] >= res["maxAbsErrorBmag"] / np.abs(ref).max() * (1 - 1e-12)
    # ceil_sig is a conservative (upward) rounding
    assert stella_reference.ceil_sig(2.937650123158164e-13, 2) == 3.0e-13
    assert stella_reference.ceil_sig(2.9e-13, 2) == 2.9e-13
    assert stella_reference.ceil_sig(1.2345e-4, 3) == 1.24e-4
    assert stella_reference.ceil_sig(0.0, 2) == 0.0


def _perturbed_out_nc(tmp_path: Path, var: str, index: tuple, delta: float) -> Path:
    """A copy of stella's float64 out.nc with one value of `var` ("bmag" at (zed, alpha) or "zed" at (zed,)) moved
    by `delta`: a real input for compare_out_nc, so its own verdict logic is exercised (no monkeypatched result)."""
    p = tmp_path / f"{var}-{'-'.join(map(str, index))}-{delta:g}.out.nc"
    shutil.copyfile(paths.STELLA_TEST2_OUT_NC, p)
    with netCDF4.Dataset(p, "r+") as d:
        v = d.variables[var]
        v[index] = float(v[index]) + delta
    return p


def _compare_with(out_nc: Path) -> dict:
    return stella_reference.compare_out_nc(eq(), paths.STELLA_TEST2_INPUT, out_nc)


def test_float64_comparison_flags_bmag_or_zed_outside_tolerance(tmp_path):
    """BE-DATA-2: allWithinTolerance is the comparison's own verdict on every bmag sample AND the zed grid, at
    FLOAT64_TOLERANCE (1e-10). One sample moved in stella's file decides it."""
    # half the tolerance on one bmag sample: still within, and that offset is now the max error
    half = _compare_with(_perturbed_out_nc(tmp_path, "bmag", (12, 0), 5e-11))
    assert half["allWithinTolerance"] is True
    assert half["maxAbsErrorBmag"] == pytest.approx(5e-11, rel=1e-2)
    # twice the tolerance on one bmag sample: outside (a tolerance loosened to e.g. 1e-6 would still say true)
    bmag_off = _compare_with(_perturbed_out_nc(tmp_path, "bmag", (12, 0), 2e-10))
    assert bmag_off["allWithinTolerance"] is False
    assert bmag_off["maxAbsErrorBmag"] == pytest.approx(2e-10, rel=1e-2)
    # the zed grid 2e-10 off at one sample, bmag untouched: the grid is part of the verdict too
    zed_off = _compare_with(_perturbed_out_nc(tmp_path, "zed", (12,), 2e-10))
    assert zed_off["maxAbsErrorBmag"] < 1e-12
    assert zed_off["maxAbsErrorZed"] == pytest.approx(2e-10, rel=1e-2)
    assert zed_off["allWithinTolerance"] is False


def test_float64_max_rel_error_is_relative_to_stella_bmag(tmp_path):
    """BE-DATA-2: maxRelErrorBmag = max(|ours - stella| / |stella|), not the absolute error."""
    params = stella_reference.run_parameters(paths.STELLA_TEST2_INPUT)
    _, fl = stella_reference.trace_run(eq(), params)
    ours = fl.B / eq().b_ref
    with netCDF4.Dataset(paths.STELLA_TEST2_OUT_NC) as d:
        ref = np.array(d.variables["bmag"][...], dtype=float)[:, 0]
    res = _compare_with(paths.STELLA_TEST2_OUT_NC)
    assert res["maxRelErrorBmag"] == float(np.max(np.abs(ours - ref) / np.abs(ref)))
    assert res["maxAbsErrorBmag"] == float(np.max(np.abs(ours - ref)))
    # a known error at the smallest |bmag| (0.923, sample 2): relative = 2e-10 / 0.923, 8 % above the absolute one
    i = int(np.argmin(np.abs(ref)))
    assert i == 2 and abs(ref[i]) < 0.93
    off = _compare_with(_perturbed_out_nc(tmp_path, "bmag", (i, 0), 2e-10))
    assert off["maxRelErrorBmag"] == pytest.approx(2e-10 / abs(ref[i]), rel=1e-2)
    assert off["maxAbsErrorBmag"] == pytest.approx(2e-10, rel=1e-2)


def test_float64_reference_exposed_in_artifact():
    """D-023 §4: the float64 out.nc comparison is a structured field, not prose the UI has to scrape."""
    res = stella_reference.compare_out_nc(eq(), paths.STELLA_TEST2_INPUT, paths.STELLA_TEST2_OUT_NC)
    f64 = built()["validation"]["float64Reference"]
    assert set(f64) == {"samplesCompared", "tolerance", "maxAbsError", "maxRelError", "allWithinTolerance", "source"}
    assert f64["samplesCompared"] == res["samplesCompared"] == 25
    assert f64["tolerance"] == stella_reference.FLOAT64_TOLERANCE
    # published as upper bounds (BE-DATA-1): the computed error x FLOAT64_BOUND_HEADROOM, rounded UP to one
    # significant figure, so the bound can never read below the error the backend computed
    assert stella_reference.FLOAT64_BOUND_HEADROOM == 1.2
    for key, raw in (("maxAbsError", res["maxAbsErrorBmag"]), ("maxRelError", res["maxRelErrorBmag"])):
        assert f64[key] == stella_reference.publish_bound(raw), key
        assert raw * 1.2 <= f64[key] < raw * 2.4, key
        assert f64[key] == float(f"{f64[key]:.0e}"), key
    assert (f64["maxAbsError"], f64["maxRelError"]) == (4e-13, 4e-13)
    assert stella_reference.publish_bound(2.9e-13) == 4e-13 and stella_reference.publish_bound(3e-9) == 4e-9
    assert stella_reference.publish_bound(8.4e-13) == 2e-12 and stella_reference.publish_bound(0.0) == 0.0
    assert f64["maxAbsError"] < f64["tolerance"] and f64["allWithinTolerance"] is True
    assert f64["source"]["path"] == "data/raw/stella_test2_vmec_geometry.out.nc"
    assert f64["source"]["sha256"] == io.sha256_file(paths.STELLA_TEST2_OUT_NC)
    assert f64["source"]["url"].endswith("EXPECTED_OUTPUT.vmec_geometry.out.nc")
    v = _validator()
    v.validate(built())
    a = json.loads(json.dumps(built()))
    del a["validation"]["float64Reference"]
    assert not v.is_valid(a)
    a = json.loads(json.dumps(built()))
    a["validation"]["float64Reference"]["allWithinTolerance"] = "yes"
    assert not v.is_valid(a)


def test_float64_failure_fails_the_tracer_validation(tmp_path, monkeypatch):
    """BE-DATA-5: a real float64 failure (stella's float64 bmag 2e-10 off at one sample, while the 4-significant-figure
    check still passes) reads as a failure everywhere: the structured field, the provenance outcome and its prose."""
    bad = _perturbed_out_nc(tmp_path, "bmag", (12, 0), 2e-10)
    real = stella_reference.compare_out_nc
    monkeypatch.setattr(stella_reference, "compare_out_nc", lambda e, input_path, _out_nc: real(e, input_path, bad))
    a = artifact.build()
    v = a["validation"]
    assert v["stellaReference"]["allWithinPrintedPrecision"] is True
    f64 = v["float64Reference"]
    assert f64["allWithinTolerance"] is False
    assert f64["maxAbsError"] == stella_reference.publish_bound(real(eq(), paths.STELLA_TEST2_INPUT, bad)["maxAbsErrorBmag"])
    assert f64["maxAbsError"] == 3e-10
    prov = a["provenance"]["verification"]
    assert prov["outcome"] == "failed"
    assert "Tracer validated vs stella rho 0.7: FAILED" in prov["details"] and "passed" not in prov["details"]
    assert "every zeta and bmag within half a unit in the last printed place" in prov["details"]
    assert f"max |error| <= {f64['maxAbsError']:g}, max rel <= {f64['maxRelError']:g}, OUTSIDE tolerance 1e-10" \
        in prov["details"]
    assert a["validation"]["acceptance129"]["outcome"] == "blocked"


_REAL_COMPARE_OUT_NC = stella_reference.compare_out_nc


def _build_with_out_nc(monkeypatch, out_nc: Path) -> dict:
    """artifact.build() with stella's out.nc replaced by `out_nc` (safe to call more than once per test)."""
    monkeypatch.setattr(stella_reference, "compare_out_nc",
                        lambda e, input_path, _out_nc: _REAL_COMPARE_OUT_NC(e, input_path, out_nc))
    return artifact.build()


def test_float64_published_rel_bound_is_the_relative_error(tmp_path, monkeypatch):
    """BE-DATA-6: at the smallest |bmag| (0.923, sample 2) a 2.4e-10 offset gives different absolute and relative
    bounds (3e-10 vs 4e-10), so the published maxRelError and the prose's "max rel <=" can only come from the
    relative error."""
    bad = _perturbed_out_nc(tmp_path, "bmag", (2, 0), 2.4e-10)
    raw = _compare_with(bad)
    a = _build_with_out_nc(monkeypatch, bad)
    f64 = a["validation"]["float64Reference"]
    assert f64["maxAbsError"] == stella_reference.publish_bound(raw["maxAbsErrorBmag"]) == 3e-10
    assert f64["maxRelError"] == stella_reference.publish_bound(raw["maxRelErrorBmag"]) == 4e-10
    assert "max |error| <= 3e-10, max rel <= 4e-10, OUTSIDE tolerance 1e-10" in a["provenance"]["verification"]["details"]


def test_float64_failure_names_its_cause(tmp_path, monkeypatch):
    """BE-DATA-9: allWithinTolerance covers bmag AND the zed grid, so the prose names which one is outside the
    tolerance. A zed-grid-only failure must not print bmag bounds 250x below the tolerance as "OUTSIDE tolerance"."""
    zed = _build_with_out_nc(monkeypatch, _perturbed_out_nc(tmp_path, "zed", (12,), 2e-10))
    assert zed["validation"]["float64Reference"]["allWithinTolerance"] is False
    assert zed["provenance"]["verification"]["outcome"] == "failed"
    details = zed["provenance"]["verification"]["details"]
    assert "max rel <= 4e-13, every bmag sample within tolerance 1e-10 but the zed grid OUTSIDE it " \
        "(max zed offset <= 3e-10))." in details
    assert "max rel <= 4e-13, OUTSIDE" not in details
    bmag = _build_with_out_nc(monkeypatch, _perturbed_out_nc(tmp_path, "bmag", (12, 0), 2e-10))
    assert "OUTSIDE tolerance 1e-10 on bmag (the zed grid within it))." in bmag["provenance"]["verification"]["details"]
    both = _perturbed_out_nc(tmp_path, "zed", (12,), 2e-10)
    with netCDF4.Dataset(both, "r+") as d:
        d.variables["bmag"][12, 0] = float(d.variables["bmag"][12, 0]) + 2e-10
    details = _build_with_out_nc(monkeypatch, both)["provenance"]["verification"]["details"]
    assert "OUTSIDE tolerance 1e-10 on bmag and on the zed grid (max zed offset <= 3e-10))." in details


def _scaled_float64_errors(monkeypatch, factor: float) -> None:
    real = stella_reference.compare_out_nc

    def scaled(*a, **kw):
        out = real(*a, **kw)
        return {**out, "maxAbsErrorBmag": out["maxAbsErrorBmag"] * factor,
                "maxRelErrorBmag": out["maxRelErrorBmag"] * factor}

    monkeypatch.setattr(stella_reference, "compare_out_nc", scaled)


def test_float64_noise_does_not_change_the_artifact(monkeypatch):
    """BE-DATA-1: geometry.json must rebuild byte-identically on every CPU / BLAS kernel (artifacts:fresh, D-006). The raw
    float64 errors (~3e-13) move in their 3rd digit between kernels (maxRelError 2.9954e-13 with OpenBLAS's AVX2
    kernels, 3.0011e-13 with its Prescott kernel). The artifact (numbers and prose) must not move when they are 10 %
    lower or higher: ~50x the kernel-to-kernel difference seen."""
    base = io.dumps(artifact.build())
    for factor in (0.9, 1.1):
        _scaled_float64_errors(monkeypatch, factor)
        assert io.dumps(artifact.build()) == base, factor


def test_float64_reference_identical_under_another_blas_kernel():
    """BE-DATA-1, as observed: rebuilt under OpenBLAS's generic Prescott kernel (what it picks on older x86 CPUs),
    geometry.json is byte-identical to the default build."""
    code = ("import hashlib, json; from labyrinth_main.common import io; "
            "from labyrinth_main.features.geometry import artifact; a = artifact.build(); "
            "print(json.dumps({'sha256': hashlib.sha256(io.dumps(a)).hexdigest(), "
            "'float64Reference': a['validation']['float64Reference'], "
            "'details': a['provenance']['verification']['details']}))")
    env = {**os.environ, "OPENBLAS_CORETYPE": "Prescott", "PYTHONDONTWRITEBYTECODE": "1"}
    proc = subprocess.run([sys.executable, "-c", code], cwd=paths.REPO_ROOT / "main", env=env, capture_output=True,
                          text=True, timeout=300, check=False)
    assert proc.returncode == 0, proc.stderr
    other = json.loads(proc.stdout.strip().splitlines()[-1])
    a = artifact.build()
    assert other["float64Reference"] == json.loads(json.dumps(a["validation"]["float64Reference"]))
    assert other["details"] == a["provenance"]["verification"]["details"]
    assert other["sha256"] == hashlib.sha256(io.dumps(a)).hexdigest()


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
def _surface_rz(s: float, theta: np.ndarray, zeta: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """R, Z of the flux surface `s` at (theta, zeta) pairs, summed directly from the raw wout Fourier arrays
    (np.interp in s): independent of vmec.Surface, tubes.surface_mesh and tubes.cross_section."""
    ind = _Independent(s)
    angle = np.multiply.outer(theta, ind.g["xm"]) - np.multiply.outer(zeta, ind.g["xn"])
    return np.cos(angle) @ ind.rmnc, np.sin(angle) @ ind.zmns


def test_surface_and_bean_outboard_midplane():
    a = built()
    srf = a["surface"]
    n_theta, n_phi = srf["nTheta"], srf["nPhi"]
    assert (n_theta, n_phi) == (tubes.SURFACE_N_THETA, tubes.SURFACE_N_PHI) == (48, 150)
    assert len(srf["positions"]) == 3 * n_phi * n_theta
    pos = np.array(srf["positions"]).reshape(n_phi, n_theta, 3)
    tol = 2e-6  # the artifact carries 7 significant figures: <= 5e-7 m on |x| < 10 m

    # EVERY vertex against an independent evaluation at the right surface (rho 0.8 = s 0.64) on the periodic,
    # phi-major grid phi_i = 2 pi i / nPhi, theta_j = 2 pi j / nTheta — both end points excluded
    phi = 2 * math.pi * np.arange(n_phi) / n_phi
    theta = 2 * math.pi * np.arange(n_theta) / n_theta
    P, T = (g.ravel() for g in np.meshgrid(phi, theta, indexing="ij"))
    R, Z = _surface_rz(0.64, T, P)
    expected = np.stack([R * np.cos(P), R * np.sin(P), Z], axis=-1).reshape(n_phi, n_theta, 3)
    np.testing.assert_allclose(pos, expected, atol=tol, rtol=0)
    # ... and it is nowhere near the neighbouring surfaces a wrong radius would give (s 0.5 is centimetres away)
    R_wrong, Z_wrong = _surface_rz(0.5, T, P)
    assert np.abs(np.hypot(pos[..., 0], pos[..., 1]).ravel() - R_wrong).max() > 1e-2 or np.abs(pos[..., 2].ravel() - Z_wrong).max() > 1e-2

    # no duplicated seam in either index: the step from the last row / column back to the first is a full grid
    # step like every other one (a repeated seam would make it 0), and no vertex occurs twice
    for axis, name in ((0, "phi"), (1, "theta")):
        step = np.linalg.norm(np.roll(pos, -1, axis=axis) - pos, axis=-1)  # index -1 along `axis` is the wrap-around
        wrap, interior = np.take(step, -1, axis=axis), np.delete(step, -1, axis=axis)
        assert wrap.min() > 0.9 * interior.min() > 1e-2, (name, wrap.min(), interior.min())
        assert wrap.max() < 1.1 * interior.max(), (name, wrap.max(), interior.max())
    assert len(np.unique(pos.reshape(-1, 3), axis=0)) == n_phi * n_theta

    # row-major over (phi, theta): first row is the zeta 0 cross-section (y = 0, snapped exactly)
    assert np.all(pos[0, :, 1] == 0.0)
    R0 = np.hypot(pos[0, :, 0], pos[0, :, 1])
    assert 6.05 <= R0[0] <= 6.25 and pos[0, 0, 2] == 0.0  # theta 0 = outboard midplane
    # no float noise near zero anywhere in the emitted geometry
    flat = np.concatenate([pos.ravel()] + [np.ravel(b[k]) for b in srf["boundary"].values() for k in ("R", "Z")])
    assert not np.any((flat != 0.0) & (np.abs(flat) < 1e-12))

    # EVERY cross-section and boundary point: closed polylines of 129 points in VMEC theta at each tube's centre,
    # the cross-section on the rho 0.8 surface (s 0.64) and the plasma boundary on the last surface (s 1)
    theta_x = np.linspace(0.0, 2 * math.pi, tubes.CROSS_SECTION_POINTS)
    assert tubes.CROSS_SECTION_POINTS == 129 and set(srf["boundary"]) == {"bean", "triangular"}
    for t in a["tubes"]:
        zeta_c = np.full_like(theta_x, math.radians(t["zetaCenterDeg"]))
        for what, s, curve in (("crossSection", 0.64, t["crossSection"]), ("boundary", 1.0, srf["boundary"][t["id"]])):
            R, Z = _surface_rz(s, theta_x, zeta_c)
            assert len(curve["R"]) == len(curve["Z"]) == 129, (t["id"], what)
            np.testing.assert_allclose(curve["R"], R, atol=tol, rtol=0, err_msg=f"{t['id']} {what} R")
            np.testing.assert_allclose(curve["Z"], Z, atol=tol, rtol=0, err_msg=f"{t['id']} {what} Z")
            assert (curve["R"][0], curve["Z"][0]) == (pytest.approx(curve["R"][-1], abs=tol), pytest.approx(curve["Z"][-1], abs=tol))
        # ... a boundary taken at s 0.9 instead would sit centimetres inside the real one
        R_inner, _ = _surface_rz(0.9, theta_x, zeta_c)
        assert np.abs(np.array(srf["boundary"][t["id"]]["R"]) - R_inner).max() > 1e-2

    bean = next(t for t in a["tubes"] if t["id"] == "bean")
    xs = bean["crossSection"]
    assert xs["zetaDeg"] == 0.0
    i = int(np.argmax(xs["R"]))
    assert 6.05 <= xs["R"][i] <= 6.25 and abs(xs["Z"][i]) < 1e-3
    assert 6.05 <= bean["samples"][64]["R"] <= 6.25
    # bean boundary spans the design image (R 5.55-6.17, Z +-0.83) and encloses the rho 0.8 surface
    bR, bZ = np.array(srf["boundary"]["bean"]["R"]), np.array(srf["boundary"]["bean"]["Z"])
    assert 5.45 < bR.min() < 5.65 and 6.1 < bR.max() < 6.3 and 0.75 < bZ.max() < 0.95
    assert bR.max() > max(xs["R"]) and bR.min() < min(xs["R"])
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
    details = prov["verification"]["details"]
    assert "Tracer validated vs stella rho 0.7: passed" in details
    # BE-DATA-1/5: the prose states the float64 verdict and prints the same published bounds as float64Reference
    f64 = a["validation"]["float64Reference"]
    assert f"vs stella's float64 out.nc bmag over 25 samples: max |error| <= {f64['maxAbsError']:g}, max rel <= " \
        f"{f64['maxRelError']:g}, every sample and the zed grid within tolerance 1e-10)." in details
    assert "OUTSIDE" not in details and "FAILED" not in details


def test_acceptance129_schema_rejects_passed():
    """D-023 §3: the contract itself, not only this backend, forbids acceptance129 other than blocked (D-007)."""
    v = _validator()
    assert v.is_valid(built())
    for outcome in ("passed", "failed", "not-applicable", "BLOCKED", None):
        a = json.loads(json.dumps(built()))
        a["validation"]["acceptance129"]["outcome"] = outcome
        assert not v.is_valid(a), outcome
    # it keeps the verification shape: details required, nothing extra
    a = json.loads(json.dumps(built()))
    del a["validation"]["acceptance129"]["details"]
    assert not v.is_valid(a)
    a = json.loads(json.dumps(built()))
    a["validation"]["acceptance129"]["extra"] = 1
    assert not v.is_valid(a)
