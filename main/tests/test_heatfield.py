"""Task 10 heat & field, backend outcomes H1-H6 (tasks/10-heat-field/TASK.md, MODEL.md, D-027)."""
import copy
import json
import math
from functools import lru_cache

import jsonschema
import netCDF4
import numpy as np
import pytest
from referencing import Registry, Resource

from labyrinth_main import build_artifacts
from labyrinth_main.common import io, paths
from labyrinth_main.features.heatfield import artifact, grids, model

N_THETA, N_PHI = 48, 72
TAU = 2 * math.pi


@lru_cache(maxsize=1)
def built() -> dict:
    """The artifact as written to disk (after 7-significant-figure rounding)."""
    return json.loads(io.dumps(artifact.build()))


@lru_cache(maxsize=1)
def written_inputs() -> model.Inputs:
    return model.inputs_from_artifact(built())


def _validator() -> jsonschema.Draft202012Validator:
    resources = []
    for p in paths.CONTRACTS.glob("*.schema.json"):
        schema = json.loads(p.read_text(encoding="utf-8"))
        res = Resource.from_contents(schema)
        resources += [(p.name, res), (schema["$id"], res)]
    schema = json.loads((paths.CONTRACTS / artifact.SCHEMA).read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema, registry=Registry().with_resources(resources))


class _Raw:
    """Independent evaluation from the raw wout arrays: linear interpolation in s on the full grid (R, Z) and on the
    half grid (lambda, |B|, iota) with linear extrapolation beyond the first / last half-grid point (stella's choice).
    Shares no code with vmec.radial_weights / Surface / fieldline."""

    def __init__(self):
        with netCDF4.Dataset(paths.WOUT_W7X_KJM) as d:
            self.g = {k: np.array(d.variables[k][...], dtype=float) for k in
                      ("xm", "xn", "xm_nyq", "xn_nyq", "rmnc", "zmns", "lmns", "bmnc", "iotas")}
        ns = self.g["rmnc"].shape[0]
        self.s_full = np.arange(ns) / (ns - 1)
        self.s_half = (np.arange(1, ns) - 0.5) / (ns - 1)  # half-grid points of indices 1..ns-1

    @staticmethod
    def _lin(xs: np.ndarray, ys: np.ndarray, s: float) -> np.ndarray:
        k = int(np.clip(np.searchsorted(xs, s) - 1, 0, len(xs) - 2))
        t = (s - xs[k]) / (xs[k + 1] - xs[k])
        return ys[k] * (1 - t) + ys[k + 1] * t

    def at(self, s: float) -> dict:
        g = self.g
        return {"rmnc": self._lin(self.s_full, g["rmnc"], s), "zmns": self._lin(self.s_full, g["zmns"], s),
                "lmns": self._lin(self.s_half, g["lmns"][1:], s), "bmnc": self._lin(self.s_half, g["bmnc"][1:], s),
                "iota": float(self._lin(self.s_half, g["iotas"][1:], s))}

    def rzb(self, c: dict, theta, phi):
        g = self.g
        a = np.multiply.outer(theta, g["xm"]) - np.multiply.outer(phi, g["xn"])
        an = np.multiply.outer(theta, g["xm_nyq"]) - np.multiply.outer(phi, g["xn_nyq"])
        return np.cos(a) @ c["rmnc"], np.sin(a) @ c["zmns"], np.cos(an) @ c["bmnc"]

    def theta_from_theta_star(self, c: dict, theta_star: np.ndarray, phi: np.ndarray) -> np.ndarray:
        """Plain bisection of theta + lambda(theta, phi) = theta* (vectorised)."""
        g = self.g

        def f(t):
            return t + np.sin(np.multiply.outer(t, g["xm"]) - np.multiply.outer(phi, g["xn"])) @ c["lmns"] - theta_star

        lo, hi = theta_star - 1.0, theta_star + 1.0
        assert np.all(np.sign(f(lo)) != np.sign(f(hi)))
        for _ in range(60):
            mid = 0.5 * (lo + hi)
            left = np.sign(f(mid)) == np.sign(f(lo))
            lo, hi = np.where(left, mid, lo), np.where(left, hi, mid)
        return 0.5 * (lo + hi)


@lru_cache(maxsize=1)
def raw() -> _Raw:
    return _Raw()


def _grid_angles() -> tuple[np.ndarray, np.ndarray]:
    theta = TAU * np.arange(N_THETA) / N_THETA
    phi = TAU * np.arange(N_PHI) / N_PHI
    P, T = np.meshgrid(phi, theta, indexing="ij")
    return T.ravel(), P.ravel()


# ---- H1: surfaces ---------------------------------------------------------------------------------------------------
def test_H1_nine_surfaces_on_the_48_by_72_grid():
    a = built()
    assert a["grid"] == {"nTheta": 48, "nPhi": 72, "layout": "phi-major: c = j*nTheta + i", "angles": grids.ANGLES}
    srf = a["surfaces"]
    assert [s["rho"] for s in srf] == [m / 8 for m in range(9)]
    assert [s["s"] for s in srf] == pytest.approx([(m / 8) ** 2 for m in range(9)], abs=1e-12)
    for s in srf:
        for key in ("R", "Z", "B"):
            assert len(s[key]) == N_THETA * N_PHI, (s["rho"], key)
        assert min(s["B"]) > 0
        assert all(np.isfinite(s[k]).all() for k in ("R", "Z", "B"))
    # nested surfaces: on every plane the outboard-midplane R grows with rho
    r_out = np.array([np.array(s["R"]).reshape(N_PHI, N_THETA)[:, 0] for s in srf])
    assert np.all(np.diff(r_out, axis=0) > 0)
    # no float noise near zero anywhere in the emitted geometry (snapped to 0.0, byte-identical rebuilds)
    flat = np.concatenate([np.ravel(s[k]) for s in srf for k in ("R", "Z", "B")]
                          + [np.ravel(f[k]) for f in a["fieldLines"] for k in ("phi", "x", "y", "z", "B")])
    assert not np.any((flat != 0.0) & (np.abs(flat) < 1e-12))


def test_H1_the_axis_does_not_depend_on_theta():
    axis = built()["surfaces"][0]
    assert axis["rho"] == 0 and axis["s"] == 0
    R = np.array(axis["R"]).reshape(N_PHI, N_THETA)
    Z = np.array(axis["Z"]).reshape(N_PHI, N_THETA)
    assert np.all(R == R[:, :1]) and np.all(Z == Z[:, :1])  # exactly, not approximately
    # ... and it is the VMEC axis: the m = 0 modes of the first full-grid surface
    g = raw().g
    _, phi = _grid_angles()
    m0 = g["xm"] == 0
    R_axis = np.cos(-np.multiply.outer(phi, g["xn"][m0])) @ g["rmnc"][0][m0]
    Z_axis = np.sin(-np.multiply.outer(phi, g["xn"][m0])) @ g["zmns"][0][m0]
    np.testing.assert_allclose(R.ravel(), R_axis, atol=2e-6, rtol=0)
    np.testing.assert_allclose(Z.ravel(), Z_axis, atol=2e-6, rtol=0)
    # the axis goes round the torus: Z changes sign between planes, R spans the bean-to-triangle range
    assert R.min() > 5.0 and R.max() < 6.5 and Z.min() < -0.01 < 0.01 < Z.max()


def test_H1_axis_B_varies_with_theta_by_the_amount_the_provenance_states():
    """MODEL.md keeps stella's half-grid extrapolation at rho 0, so |B| on the axis is not single-valued: the m > 0 bmnc
    modes extrapolated linearly in s do not vanish at s = 0. The artifact must say so and by how much (RV-HF-B2)."""
    a = built()
    B = np.array(a["surfaces"][0]["B"]).reshape(N_PHI, N_THETA)
    spread = float((B.max(axis=1) - B.min(axis=1)).max())
    mean = float(B.mean())
    assert grids.axis_b_theta_spread(a["surfaces"][0]["B"]) == (spread, mean)
    assert 0.01 < spread < 0.05 and 2.6 < mean < 2.8  # measured 0.029 T at a mean of 2.69 T (about 1 %)
    details = a["geometryProvenance"]["verification"]["details"]
    assert f"varies with theta by up to {spread:.3f} T ({100 * spread / mean:.1f} % of its mean {mean:.2f} T)" in details
    assert "On the magnetic axis (rho 0) R and Z do not depend on theta, but |B| does" in details
    # its theta mean on each plane is the m = 0 part of the extrapolated |B| (exact on 48 points: every m_nyq < 48)
    g = raw().g
    assert g["xm_nyq"].max() < N_THETA
    c = raw().at(0.0)
    m0 = g["xm_nyq"] == 0
    phi = TAU * np.arange(N_PHI) / N_PHI
    b_m0 = np.cos(-np.multiply.outer(phi, g["xn_nyq"][m0])) @ c["bmnc"][m0]
    np.testing.assert_allclose(B.mean(axis=1), b_m0, rtol=1e-6, atol=0)
    # ... and every axis value is the full extrapolated |B| of the independent reader (the variation is its m > 0 part)
    theta = TAU * np.arange(N_THETA) / N_THETA
    _, _, B_full = raw().rzb(c, np.tile(theta, N_PHI), np.repeat(phi, N_THETA))
    np.testing.assert_allclose(B.ravel(), B_full, rtol=1e-6, atol=0)


def test_H1_surfaces_agree_with_an_independent_reader():
    a = built()
    theta, phi = _grid_angles()
    rng = np.random.default_rng(10)
    cells = np.unique(np.concatenate([rng.integers(0, N_THETA * N_PHI, 400), [0, 12, 36 * 48 + 12, N_THETA * N_PHI - 1]]))
    for srf in a["surfaces"]:
        c = raw().at(srf["s"])
        assert srf["iota"] == pytest.approx(c["iota"], rel=1e-6), srf["rho"]
        R, Z, B = raw().rzb(c, theta[cells], phi[cells])
        np.testing.assert_allclose(np.array(srf["R"])[cells], R, atol=2e-6, rtol=0, err_msg=f"R rho {srf['rho']}")
        np.testing.assert_allclose(np.array(srf["Z"])[cells], Z, atol=2e-6, rtol=0, err_msg=f"Z rho {srf['rho']}")
        np.testing.assert_allclose(np.array(srf["B"])[cells], B, rtol=1e-6, atol=0, err_msg=f"B rho {srf['rho']}")
    # |B| is absolute tesla (not normalised by B_ref ~2.6 T): W7-X's LCFS spans roughly 2.3-3.5 T
    lcfs_b = np.array(a["surfaces"][-1]["B"])
    assert 2.2 < lcfs_b.min() < 2.5 and 3.3 < lcfs_b.max() < 3.6
    # stella's half-grid extrapolation at both ends: iota(rho 1) is beyond the last half-grid value
    assert a["surfaces"][-1]["iota"] == pytest.approx(1.5 * raw().g["iotas"][-1] - 0.5 * raw().g["iotas"][-2], rel=1e-6)
    assert a["surfaces"][0]["iota"] == pytest.approx(1.5 * raw().g["iotas"][1] - 0.5 * raw().g["iotas"][2], rel=1e-6)


def test_H1_lcfs_agrees_with_geometry_plasma_boundary():
    """geometry.json's plasma boundary (s = 1) at zeta 0 (bean) and 36 deg (triangular), 129 points theta_k = 2 pi k/128.
    Our theta_i = 2 pi i/48 coincides with it at i = 3n, k = 8n. 36 deg is not one of our planes, but phi = 180 deg is,
    and with nfp = 5 (period 72 deg) 180 deg = 36 deg + 2*72 deg is the same cross-section."""
    a = built()
    geo = json.loads((paths.ARTIFACTS / "geometry.json").read_text(encoding="utf-8"))
    assert geo["equilibrium"]["source"]["sha256"] == a["equilibrium"]["source"]["sha256"]
    assert a["equilibrium"]["nfp"] == geo["equilibrium"]["nfp"] == 5
    R = np.array(a["surfaces"][-1]["R"]).reshape(N_PHI, N_THETA)
    Z = np.array(a["surfaces"][-1]["Z"]).reshape(N_PHI, N_THETA)
    n = np.arange(16)
    for tube, j in (("bean", 0), ("triangular", 36)):
        b = geo["surface"]["boundary"][tube]
        bR, bZ = np.array(b["R"])[8 * n], np.array(b["Z"])[8 * n]
        np.testing.assert_allclose(R[j, 3 * n], bR, atol=1.1e-6, rtol=0, err_msg=tube)
        np.testing.assert_allclose(Z[j, 3 * n], bZ, atol=1.1e-6, rtol=0, err_msg=tube)
        assert np.mean(R[j, 3 * n] == bR) > 0.8  # mostly the same 7-significant-figure number
    # the two cross-sections really differ (bean vs triangle), so the comparison is not trivially satisfied
    assert np.abs(R[0] - R[36]).max() > 0.1


# ---- H2: field lines ------------------------------------------------------------------------------------------------
def test_H2_eight_lcfs_field_lines_one_toroidal_turn():
    lines = built()["fieldLines"]
    assert len(lines) == 8
    assert [fl["alpha"] for fl in lines] == pytest.approx([TAU * m / 8 for m in range(8)], abs=1e-6)
    for fl in lines:
        n = len(fl["phi"])
        assert n == grids.FIELD_LINE_SAMPLES == 181
        assert all(len(fl[k]) == n for k in ("x", "y", "z", "B"))
        phi = np.array(fl["phi"])
        assert phi[0] == 0.0 and phi[-1] == pytest.approx(TAU, abs=1e-6) and np.all(np.diff(phi) > 0)
        x, y = np.array(fl["x"]), np.array(fl["y"])
        # x = R cos phi, y = R sin phi
        np.testing.assert_allclose(np.unwrap(np.arctan2(y, x)), phi, atol=2e-6, rtol=0)


def test_H2_every_field_line_point_lies_on_the_lcfs_with_the_readers_B():
    a = built()
    c = raw().at(1.0)
    lines = a["fieldLines"]
    alpha = np.concatenate([np.full(len(fl["phi"]), fl["alpha"]) for fl in lines])
    phi = np.concatenate([fl["phi"] for fl in lines])
    # stella: theta* = alpha + iota*zeta; VMEC theta solved independently by bisection
    theta = raw().theta_from_theta_star(c, alpha + c["iota"] * phi, phi)
    R, Z, B = raw().rzb(c, theta, phi)
    x = np.concatenate([fl["x"] for fl in lines])
    y = np.concatenate([fl["y"] for fl in lines])
    z = np.concatenate([fl["z"] for fl in lines])
    b = np.concatenate([fl["B"] for fl in lines])
    np.testing.assert_allclose(x, R * np.cos(phi), atol=5e-6, rtol=0)
    np.testing.assert_allclose(y, R * np.sin(phi), atol=5e-6, rtol=0)
    np.testing.assert_allclose(z, Z, atol=5e-6, rtol=0)
    np.testing.assert_allclose(b, B, rtol=2e-6, atol=0)
    # on the LCFS: R, Z of every point are those of the s = 1 surface at its (theta, phi), and not of the rho 7/8 one
    c_in = raw().at((7 / 8) ** 2)
    R_in, _, _ = raw().rzb(c_in, theta, phi)
    assert np.abs(np.hypot(x, y) - R_in).max() > 1e-2
    # the lines differ: eight distinct labels give eight distinct curves
    assert len({round(fl["z"][45], 4) for fl in lines}) == 8


# ---- H3: diverters --------------------------------------------------------------------------------------------------
def test_H3_four_schematic_diverters_at_quarter_turns():
    d = built()["diverters"]
    assert [it["id"] for it in d["items"]] == ["D1", "D2", "D3", "D4"]
    assert [it["phi"] for it in d["items"]] == pytest.approx([0, math.pi / 2, math.pi, 3 * math.pi / 2], abs=5e-7)
    assert [it["label"] for it in d["items"]] == ["D1 · 0 rad", "D2 · π/2 rad", "D3 · π rad", "D4 · 3π/2 rad"]
    assert d["thetaCentre"] == pytest.approx(math.pi / 2, abs=5e-7) and d["halfWidthTheta"] == 0.35
    for k, it in enumerate(d["items"]):  # on the grid planes j_k = k*nPhi/4
        assert it["phi"] * N_PHI / TAU == pytest.approx(k * N_PHI / 4, abs=1e-5)
    assert d["note"] == ("Schematic positions as specified by the owner (2026-11-21). W7-X has ten island-divertor units, "
                         "upper and lower in each of its five field periods; these four do not represent them.")


# ---- H4: the reference model ----------------------------------------------------------------------------------------
MODEL_MD_TABLE = {  # tasks/10-heat-field/MODEL.md "Parameters", version 6 (Pheat and wettedArea set the operating point)
    "Tcore0": (3.0, "keV"), "rhoBlend": (0.7, "–"), "B0": (2.5, "T"), "sigmaPhi": (0.06, "rad"),
    "sigmaTheta": (0.12, "rad"), "sweepAmplitude": (0.30, "rad"), "sweepFrequency": (2.0, "Hz"), "epsilon": (0.03, "–"),
    "sigmaCoilPhi": (0.20, "rad"), "sigmaCoilTheta": (0.60, "rad"), "shareShift": (0.3, "–"), "Pheat": (7.5, "MW"), "fRad": (0.3, "–"),
    "wettedArea": (0.1, "m²"), "connectionLength": (200.0, "m"), "kappa0": (6.324555e13, "W m⁻¹ keV⁻⁷ᐟ²"),
    "conductionExponent": (3.5, "–"), "twoPointIterations": (20.0, "–"), "sheathGamma": (7.0, "–"),
    "nSep": (4.0e19, "m⁻³"), "ionMass": (1.0, "u"), "incidence": (0.03490659, "rad"), "keV": (1.602177e-16, "J"),
    "amu": (1.660539e-27, "kg"), "MW": (1.0e6, "W"), "tileThickness": (0.006, "m"), "tileCells": (6.0, "–"),
    "tileDensity": (1900.0, "kg m⁻³"), "kRef": (350.0, "W m⁻¹ K⁻¹"), "kScale": (700.0, "°C"),
    "cpRef": (710.0, "J kg⁻¹ K⁻¹"), "cpHigh": (2000.0, "J kg⁻¹ K⁻¹"), "cpScale": (670.0, "°C"), "Tref": (20.0, "°C"),
    "sinkResistance": (4.5e-5, "m² K W⁻¹"), "Tcool": (30.0, "°C"), "tileLimit": (1200.0, "°C"), "dt": (0.001, "s"), "spinup": (3.0, "s"),
}


def test_H4_parameters_are_the_model_md_table():
    params = built()["model"]["parameters"]
    assert set(params) == set(MODEL_MD_TABLE)
    for name, (value, unit) in MODEL_MD_TABLE.items():
        rec = params[name]
        assert set(rec) == {"value", "unit", "symbol", "description"} and rec["symbol"] and rec["description"], name
        assert rec["unit"] == unit, name
        assert rec["value"] == value, name
    for n in model.TUNED:  # the operating point lies inside the stated ranges
        lo, hi = model.TUNING_RANGES[n]
        assert lo <= params[n]["value"] <= hi, n
    assert model.MODEL_MD_START == {n: MODEL_MD_TABLE[n][0] for n in model.TUNED}
    # kappa0 is Spitzer's 2000 W m^-1 eV^-7/2 in keV units, nu is 7/2
    assert params["kappa0"]["value"] == pytest.approx(2000 * 1000**3.5, rel=1e-6)
    assert params["conductionExponent"]["value"] == 3.5


def test_H4_the_model_consumes_the_inputs_as_written():
    a = built()
    inp = written_inputs()
    np.testing.assert_array_equal(inp.b_lcfs.ravel(), a["surfaces"][-1]["B"])
    assert inp.theta_d == a["diverters"]["thetaCentre"]
    assert inp.phi_k == tuple(it["phi"] for it in a["diverters"]["items"])
    assert inp.params == {k: v["value"] for k, v in a["model"]["parameters"].items()}
    # the written values are 7-significant-figure numbers, not the raw doubles (e.g. pi/2 is 1.570796)
    assert inp.theta_d == 1.570796 != math.pi / 2


def _literal_step(inp: model.Inputs, slab: np.ndarray, n: int, coils) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """MODEL.md steps 1-12, transcribed literally with explicit loops (independent of model.Model): the new tile cells
    and surface temperatures from the loads at t_n, and the LCFS temperature at t_(n+1)."""
    p = inp.params
    n_t, n_p = inp.n_theta, inp.n_phi
    dth, dph = TAU / n_t, TAU / n_p
    th = [TAU * i / n_t for i in range(n_t)]
    ph = [TAU * j / n_p for j in range(n_p)]

    def wrap(x):
        return x - TAU * math.floor(x / TAU + 0.5)

    def g(x, s):
        return math.exp(-x * x / (2 * s * s))

    sector = [[0.0] * n_p for _ in range(4)]
    for j in range(n_p):
        G = [g(wrap(ph[j] - inp.phi_k[k]), math.pi / 4) for k in range(4)]  # 6
        for k in range(4):
            sector[k][j] = G[k] / sum(G)
    u = [sum(sector[k]) * n_t / (n_t * n_p) for k in range(4)]
    f = [1 - p["shareShift"] * coils[k] for k in range(4)]
    shares = [p["Pheat"] * (1 - p["fRad"]) * u[k] * f[k] * sum(u) / sum(u[q] * f[q] for q in range(4)) for k in range(4)]

    def solve(m):
        t = m * p["dt"]
        a = [ck * math.cos(TAU * p["sweepFrequency"] * t) for ck in coils]  # 1
        ts = [inp.theta_d + p["sweepAmplitude"] * a[k] for k in range(4)]  # 4
        out = []
        for k in range(4):
            j = round(inp.phi_k[k] / dph) % n_p  # 7

            def B(i):
                ii = i % n_t
                h = [g(wrap(ph[j] - inp.phi_k[q]), p["sigmaCoilPhi"]) * g(wrap(th[ii] - inp.theta_d), p["sigmaCoilTheta"])
                     for q in range(4)]  # 2
                return inp.b_lcfs[j, ii] * (1 + p["epsilon"] * sum(a[q] * h[q] for q in range(4)))  # 3
            x = ts[k] / dth
            i0 = math.floor(x)
            w = x - i0
            b = ((1 - w) * B(i0) + w * B(i0 + 1)) / p["B0"]
            q_t = shares[k] * b / p["wettedArea"]  # 8
            q_par = q_t * p["MW"] / math.sin(p["incidence"])  # 10
            nu = p["conductionExponent"]
            X = nu * q_par * p["connectionLength"] / p["kappa0"]
            tu = X ** (1 / nu)
            tt = 0.0
            for _ in range(int(p["twoPointIterations"])):
                c = 2 * q_par / (p["sheathGamma"] * p["nSep"] * p["keV"] * tu)
                tt = p["ionMass"] * p["amu"] * c * c / (2 * p["keV"])
                tu = (tt ** nu + X) ** (1 / nu)
            out.append((ts[k], q_t, tu, tt, b))
        return out

    now = solve(n)
    Q = np.array([[now[k][1] * g(wrap(th[i] - now[k][0]), p["sigmaTheta"] / now[k][4]) for i in range(n_t)]
                  for k in range(4)])  # 9
    n_z = int(p["tileCells"])
    dz = p["tileThickness"] / n_z

    def k_of(T):
        return p["kRef"] / (1 + (T - p["Tref"]) / p["kScale"])

    def c_of(T):
        return p["cpHigh"] - (p["cpHigh"] - p["cpRef"]) * math.exp(-(T - p["Tref"]) / p["cpScale"])

    slab_new = np.empty_like(slab)
    tiles_new = np.empty((4, n_t))
    for k in range(4):  # 11
        for i in range(n_t):
            S = [float(v) for v in slab[k, i]]
            q = Q[k, i] * p["MW"]
            net = [0.0] * n_z
            net[0] = q
            for z in range(n_z - 1):
                kz, kn = k_of(S[z]), k_of(S[z + 1])
                F = 2 * kz * kn / (dz * (kz + kn)) * (S[z] - S[z + 1])
                net[z] -= F
                net[z + 1] += F
            net[-1] -= (S[-1] - p["Tcool"]) / (dz / (2 * k_of(S[-1])) + p["sinkResistance"])
            new = [S[z] + p["dt"] * net[z] / (p["tileDensity"] * c_of(S[z]) * dz) for z in range(n_z)]
            slab_new[k, i] = new
            tiles_new[k, i] = new[0] + q * dz / (2 * k_of(new[0]))
    nxt = solve(n + 1)
    nu = p["conductionExponent"]
    T = np.empty((n_p, n_t))
    for j in range(n_p):
        t_up = sum(sector[k][j] * nxt[k][2] for k in range(4))
        for i in range(n_t):
            gk = [g(wrap(ph[j] - inp.phi_k[k]), p["sigmaPhi"]) * g(wrap(th[i] - nxt[k][0]), p["sigmaTheta"]) for k in range(4)]
            T[j, i] = (max(0.0, 1 - sum(gk)) * t_up ** nu + sum(gk[k] * nxt[k][3] ** nu for k in range(4))) ** (1 / nu)  # 12
    return T, slab_new, tiles_new


def test_H4_one_step_is_model_md_transcribed_literally():
    inp = written_inputs()
    m = model.Model(inp)
    rng = np.random.default_rng(4)
    p = inp.params
    for n, coils in ((137, (1, 0, 1, 1)), (0, (0, 0, 0, 0)), (2501, (0, 1, 0, 1))):
        slab = rng.uniform(p["Tcool"], 1500.0, (4, N_THETA, int(p["tileCells"])))
        got = m.step(model.State(n, np.zeros((N_PHI, N_THETA)), slab[..., 0], slab), coils)
        want_T, want_slab, want_tiles = _literal_step(inp, slab, n, coils)
        assert got.n == n + 1
        np.testing.assert_allclose(got.T, want_T, rtol=1e-12, atol=0)
        np.testing.assert_allclose(got.slab, want_slab, rtol=1e-12, atol=0)
        np.testing.assert_allclose(got.tiles, want_tiles, rtol=1e-12, atol=0)


def test_H4_the_tile_conducts_and_conserves_energy():
    inp = written_inputs()
    p = inp.params
    m = model.Model(inp)
    n_z = int(p["tileCells"])
    dz = p["tileThickness"] / n_z
    # energy: what enters the surface either stays in the tile (rho c dT dz) or goes to the water, every step
    st = m.initial_state()
    for _ in range(400):
        loads = m.heat_flux_loads(st, (0, 0, 0, 0))
        nxt = m.step(st, (0, 0, 0, 0))
        stored = (p["tileDensity"] * m.heat_capacity(st.slab) * dz * (nxt.slab - st.slab)).sum(axis=-1) / p["dt"]
        np.testing.assert_allclose(stored + m.sink_flux(st.slab), loads * p["MW"], rtol=1e-9, atol=1e-3)
        st = nxt
    # the material fits: k falls, c rises with temperature (NB31: ~170 W/m/K and ~1600 J/kg/K at 800 C)
    assert m.conductivity(800.0) == pytest.approx(170, rel=0.05) and m.heat_capacity(800.0) == pytest.approx(1600, rel=0.05)
    # steady state under a uniform load: the closed form with k(T) (Kirchhoff transform) and the sink resistance
    q_mw = 10.0
    slab = np.full((1, 1, n_z), p["Tcool"])
    for _ in range(20000):
        slab, surf = m.conduct(slab, np.array([[q_mw]]))
    q = q_mw * p["MW"]
    t_back = p["Tcool"] + q * p["sinkResistance"]
    a = p["kRef"] * p["kScale"]
    want = p["Tref"] + p["kScale"] * ((1 + (t_back - p["Tref"]) / p["kScale"]) * math.exp(q * p["tileThickness"] / a) - 1)
    assert float(surf[0, 0]) == pytest.approx(want, rel=0.02)
    assert float(m.sink_flux(slab)[0, 0]) == pytest.approx(q, rel=1e-6)
    # the effective sink resistance is consistent with element tests (interlayer approaching ~1100 C above 22 MW/m^2)
    assert p["Tcool"] + 22e6 * p["sinkResistance"] == pytest.approx(1100, rel=0.1)


def test_H4_energy_is_conserved_power_in_equals_power_on_the_targets():
    inp = written_inputs()
    p = inp.params
    m = model.Model(inp)
    shares = m.power_shares()
    assert shares.sum() == pytest.approx(p["Pheat"] * (1 - p["fRad"]), rel=1e-12)
    assert np.allclose(shares, shares[0], rtol=1e-6)  # four equal sectors (phi_k written to 7 significant figures)
    for coils in ((0, 0, 0, 0), (1, 1, 1, 1)):
        for n in (0, 77, 250):
            sol = m.solve(n, coils)
            b = m.compression(sol["B"], sol["a"])
            # what lands on the wetted area (de-compressed to B_0) is exactly the divertor's power
            np.testing.assert_allclose(sol["q_t"] * p["wettedArea"] / b, shares, rtol=1e-12)
            # the strip deposits exactly that power: it narrows as 1/B, each radian of strip is A_wet/(sqrt(2pi) s_theta)
            Q = m.strip_loads(sol["q_t"], sol["a"], sol["b"])
            area_per_rad = p["wettedArea"] / (math.sqrt(TAU) * p["sigmaTheta"])
            # (a grid sum of the Gaussian: ~4e-5 off its integral at the narrowest width, sigma_theta/1.23 < dtheta)
            np.testing.assert_allclose(Q.sum(axis=1) * m.dtheta * area_per_rad, shares, rtol=1e-4)
    # the coils move power between divertors (the field moves the islands) but never create or lose any
    total = p["Pheat"] * (1 - p["fRad"])
    for coils in ((1, 0, 1, 0), (1, 0, 0, 0), (0.5, 1, 0, 0.25), (1, 1, 1, 1)):
        moved = m.power_shares(coils)
        assert moved.sum() == pytest.approx(total, rel=1e-12)
        sol = m.solve(31, coils)
        np.testing.assert_allclose(sol["q_t"] * p["wettedArea"] / sol["b"], moved, rtol=1e-12)
    one = m.power_shares((1, 0, 0, 0))
    eta = p["shareShift"]
    assert one[0] == pytest.approx(total / 4 * (1 - eta) * 4 / (4 - eta), rel=1e-6)  # D1 sheds, the others gain equally
    assert np.allclose(one[1:], total / 4 * 4 / (4 - eta), rtol=1e-6)
    np.testing.assert_allclose(m.power_shares((1, 1, 1, 1)), shares, rtol=1e-12)  # every coil on: nothing moves
    with pytest.raises(ValueError, match="shareShift"):
        model.Model(inp.with_params(shareShift=1.0)).check_stability()
    # no heating, no load and no plasma: the tiles stay at the coolant temperature
    cold = model.Model(inp.with_params(Pheat=0.0))
    _, st = model.run(cold, model.ALL_OFF, [200])
    assert np.all(st.tiles == p["Tcool"]) and np.all(st.slab == p["Tcool"]) and np.all(st.T == 0)


def test_H4_the_two_point_solution_satisfies_conduction_sheath_and_pressure_balance():
    inp = written_inputs()
    p = inp.params
    m = model.Model(inp)
    nu = p["conductionExponent"]
    for q_t in (1.0, 5.0, 12.94, 20.0):
        tu, tt = m.two_point(q_t)
        q_par = q_t * p["MW"] / math.sin(p["incidence"])
        # Spitzer conduction along L_c
        assert tu ** nu - tt ** nu == pytest.approx(nu * q_par * p["connectionLength"] / p["kappa0"], rel=1e-9)
        # sheath with pressure balance n_t T_t = n_u T_u / 2, c_s = sqrt(2 e T_t / m_i)
        n_t = p["nSep"] * tu / (2 * tt)
        c_s = math.sqrt(2 * tt * p["keV"] / (p["ionMass"] * p["amu"]))
        assert p["sheathGamma"] * n_t * tt * p["keV"] * c_s == pytest.approx(q_par, rel=1e-6)
        assert tt < tu
    # at the operating point: upstream ~0.2 keV, target ~0.025-0.035 keV (attached, high power)
    sol = m.solve(0, (0, 0, 0, 0))
    assert np.all((0.15 < sol["Tu"]) & (sol["Tu"] < 0.25)) and np.all((0.015 < sol["Tt"]) & (sol["Tt"] < 0.05))
    assert m.two_point(0.0) == (0.0, 0.0)


def test_H4_the_lcfs_map_runs_from_target_to_upstream_temperature():
    inp = written_inputs()
    m = model.Model(inp)
    sol = m.solve(0, (0, 0, 0, 0))
    T = m.lcfs_temperature(0, (0, 0, 0, 0))
    assert T.min() >= sol["Tt"].min() * (1 - 1e-9) and T.max() <= sol["Tu"].max() * (1 + 1e-9)
    # at each footprint centre (theta_12 = theta_d up to rounding, plane j_k) the target temperature
    for k in range(4):
        assert T[m.j_k[k], 12] == pytest.approx(sol["Tt"][k], rel=1e-5)
    # far from every divertor the upstream temperature of the sector
    j_mid = N_PHI // 8
    assert T[j_mid, 36] == pytest.approx(float((m.sector[:, j_mid] * sol["Tu"]).sum()), rel=1e-6)


def test_H4_stability_is_the_tile_conduction():
    inp = written_inputs()
    p = inp.params
    m = model.Model(inp)
    dz = p["tileThickness"] / p["tileCells"]
    number = p["dt"] * 2 * p["kRef"] / (p["tileDensity"] * p["cpRef"] * dz * dz)  # inner cells bind here
    assert m.check_stability() == number and 0 < number <= 1
    # without a sink resistance the back cell binds (k/dz + 2k/dz): 1.5 times the inner number
    bare = model.Model(inp.with_params(sinkResistance=0.0))
    assert bare.stability_number() == pytest.approx(1.5 * number, rel=1e-12)
    with pytest.raises(ValueError, match="unstable"):
        model.Model(inp.with_params(sinkResistance=0.0, dt=p["dt"] / number * 0.9)).check_stability()
    with pytest.raises(ValueError, match="whole number"):
        model.Model(inp.with_params(tileCells=6.5)).check_stability()
    assert f"here {number:.4f}" in built()["model"]["discretization"]
    with pytest.raises(ValueError, match="unstable"):
        model.Model(inp.with_params(dt=2.0)).check_stability()
    # the two-point iteration is checked converged at the operating loads (conduction-limited: T_t << T_u)...
    sol = m.solve(0, (0, 0, 0, 0))
    assert np.all((sol["Tt"] / sol["Tu"]) ** p["conductionExponent"] < 0.01)
    # ... and an operating point whose loads it cannot converge (10x the heating, ~130 MW/m^2) is refused
    with pytest.raises(ValueError, match="not converged"):
        model.Model(inp.with_params(Pheat=60.0)).check_stability()


def test_H4_a_coil_moves_the_strike_line_and_changes_B_by_epsilon_at_its_centre():
    inp = written_inputs()
    p = inp.params
    m = model.Model(inp)
    for t in (0.0, 0.1, 0.125, 0.25, 0.4, 1.0):
        drive = math.cos(TAU * p["sweepFrequency"] * t)
        for k in range(4):
            coils = tuple(int(q == k) for q in range(4))
            a = m.coil_drive(coils, t)
            assert a[k] == pytest.approx(drive, abs=1e-15) and all(a[q] == 0 for q in range(4) if q != k)
            ts = m.strike_lines(a)
            assert ts[k] - inp.theta_d == pytest.approx(p["sweepAmplitude"] * drive, abs=1e-15)
            assert all(ts[q] == inp.theta_d for q in range(4) if q != k)
            # |B| at the coil centre (plane j_k, theta_12 = pi/2) changes by epsilon*a_k
            j, i = k * N_PHI // 4, 12
            B = m.field(a)
            assert B[j, i] / inp.b_lcfs[j, i] - 1 == pytest.approx(p["epsilon"] * drive, abs=1e-12)
            # ... and nowhere by more
            assert np.abs(B / inp.b_lcfs - 1).max() <= p["epsilon"] * abs(drive) + 1e-12
            # the footprint follows: its theta centroid on plane j_k sits at the swept strike line
            g = m.footprints(a)[k, j]
            off = np.array([model.wrap(th - inp.theta_d) for th in TAU * np.arange(N_THETA) / N_THETA])
            assert float(g @ off / g.sum()) == pytest.approx(p["sweepAmplitude"] * drive, abs=1e-6)
    # a coil that is off leaves the field exactly as VMEC gives it
    np.testing.assert_array_equal(m.field(m.coil_drive((0, 0, 0, 0), 0.3)), inp.b_lcfs)


@lru_cache(maxsize=1)
def all_on_at_3s() -> dict:
    return model.run(model.Model(written_inputs()), model.ALL_ON, [3000])[0][0]


def _golden(scenario: str, step: int) -> dict:
    sc = next(s for s in built()["model"]["golden"]["scenarios"] if s["id"] == scenario)
    return next(c for c in sc["checkpoints"] if c["step"] == step)


def test_H4_sweeping_lowers_the_peak_tile_temperature():
    off = _golden("coils-off", 3000)["peakTileC"]
    on = all_on_at_3s()["peakTileC"]
    assert all(o < f for o, f in zip(on, off, strict=True)), (on, off)
    # D1 and D3 on, D2 and D4 off: the swept diverters cool, and the power they shed heats the other two (version 6)
    d13 = _golden("coils-D1-D3", 3000)["peakTileC"]
    assert d13[0] < off[0] and d13[2] < off[2]
    assert d13[1] > off[1] * 1.1 and d13[3] > off[3] * 1.1
    # without the share shift only the swept diverters change
    m = model.Model(written_inputs().with_params(shareShift=0.0))
    still = model.run(m, model.SCENARIOS[1]["coilSchedule"], [3000])[0][0]["peakTileC"]
    assert still[1] == pytest.approx(off[1], rel=0.01) and still[3] == pytest.approx(off[3], rel=0.01)


def test_H4_runs_are_deterministic():
    m1, m2 = model.Model(written_inputs()), model.Model(written_inputs())
    for sc in model.SCENARIOS:
        a, sa = model.run(m1, sc["coilSchedule"], [700])
        b, sb = model.run(m2, sc["coilSchedule"], [700])
        assert a == b
        np.testing.assert_array_equal(sa.T, sb.T)
        np.testing.assert_array_equal(sa.tiles, sb.tiles)


# ---- H5: golden checkpoints and regimes -----------------------------------------------------------------------------
def test_H5_golden_scenarios_as_model_md_specifies():
    m = built()["model"]
    assert m["probes"] == [[12, 0], [12, 18], [12, 36], [12, 54], [0, 0], [24, 9], [36, 27], [6, 45]]
    golden = m["golden"]
    assert golden["relativeTolerance"] == 2e-6
    sc = {s["id"]: s for s in golden["scenarios"]}
    assert list(sc) == ["coils-off", "coils-D1-D3", "switch-at-1s"]
    assert sc["coils-off"]["coilSchedule"] == [{"fromStep": 0, "coils": [0, 0, 0, 0]}]
    assert sc["coils-D1-D3"]["coilSchedule"] == [{"fromStep": 0, "coils": [1, 0, 1, 0]}]
    assert sc["switch-at-1s"]["coilSchedule"] == [{"fromStep": 0, "coils": [0, 0, 0, 0]},
                                                  {"fromStep": 1000, "coils": [1, 1, 1, 1]}]
    steps = {"coils-off": [250, 1000, 3000], "coils-D1-D3": [250, 1000, 3000], "switch-at-1s": [1000, 1500, 3000]}
    for sid, s in sc.items():
        assert [c["step"] for c in s["checkpoints"]] == steps[sid]
        for c in s["checkpoints"]:
            assert c["t"] == pytest.approx(c["step"] * 0.001, abs=1e-12)
            assert len(c["probesT"]) == 8 and len(c["peakTileC"]) == 4 and len(c["peakHeatFlux"]) == 4
            assert all(0.01 <= v <= 0.3 for v in c["probesT"] + [c["meanT"]])  # keV: 10-300 eV edge
            assert all(v > 30 for v in c["peakTileC"]) and all(v > 0 for v in c["peakHeatFlux"])
    # before the switch the two schedules are identical, so are the states (the LCFS temperature of state 1000 is
    # evaluated with the coils that drove step 999, off in both)
    assert _golden("switch-at-1s", 1000)["probesT"] == _golden("coils-off", 1000)["probesT"]
    assert _golden("switch-at-1s", 1000)["peakTileC"] == _golden("coils-off", 1000)["peakTileC"]
    # ... but the heat flux at step 1000 is evaluated with the coils of step 1000 (on, a_k = cos(4 pi) = 1)
    assert _golden("switch-at-1s", 1000)["peakHeatFlux"] != _golden("coils-off", 1000)["peakHeatFlux"]
    assert model.coils_at(sc["switch-at-1s"]["coilSchedule"], 999) == (0, 0, 0, 0)
    assert model.coils_at(sc["switch-at-1s"]["coilSchedule"], 1000) == (1, 1, 1, 1)


def test_H5_golden_values_equal_a_fresh_run_on_the_written_inputs():
    """What the renderer does: read the artifact, run the model, compare. With the same (written) inputs the Python
    reference reproduces its own golden values exactly once rounded the same way."""
    a = built()
    fresh = io.normalize(model.golden(model.Model(model.inputs_from_artifact(a))))
    assert fresh == a["model"]["golden"]["scenarios"]
    # and within relativeTolerance of the unrounded run (the rounding is the only difference)
    tol = a["model"]["golden"]["relativeTolerance"]
    raw_run = model.golden(model.Model(model.inputs_from_artifact(a)))
    for w, r in zip(a["model"]["golden"]["scenarios"], raw_run, strict=True):
        for cw, cr in zip(w["checkpoints"], r["checkpoints"], strict=True):
            for key in ("probesT", "peakTileC", "peakHeatFlux"):  # 7 significant figures: <= 5e-7 relative
                np.testing.assert_allclose(cw[key], cr[key], rtol=tol / 3, atol=0)
            assert cw["meanT"] == pytest.approx(cr["meanT"], rel=tol / 3)


def test_H5_regime_requirements_hold():
    p = built()["model"]["parameters"]
    limit = p["tileLimit"]["value"]
    off = _golden("coils-off", 3000)["peakTileC"]
    assert any(v > limit for v in off) and any(v < limit for v in off), off
    on = all_on_at_3s()["peakTileC"]
    assert all(v < limit for v in on), on
    assert p["spinup"]["value"] == 3.0 == _golden("coils-off", 3000)["t"]  # the view's starting state
    lim = built()["model"]["limitations"]
    assert "both kept at MODEL.md's starting values" in lim
    assert "high-power case" in lim and "Energy is conserved by construction" in lim
    assert "D1, D4 above the 1200 °C tile limit and D2, D3 below it" in lim
    assert "all below the limit" in lim
    assert model.regime(model.Model(written_inputs()), built()["model"]["golden"]["scenarios"])["ok"] is True


def test_H5_model_text_states_what_the_model_is():
    m = built()["model"]
    assert m["version"] == 6 and m["name"] and m["summary"]
    ids = [e["id"] for e in m["equations"]]
    assert ids == ["power", "target-load", "two-point", "lcfs-map", "field", "strike-line", "footprint", "tiles"]
    assert all(e["text"] and e["meaning"] for e in m["equations"])
    assert m["equations"][0]["text"].startswith("P_k = P_heat·(1 − f_rad)")
    for phrase in ("wrap(x) = x − 2π·floor(x/(2π) + 0.5)", "quasi-steady", "largest fromStep ≤ n",
                   "φ_k = diverters.items[k].phi", "θ_d = diverters.thetaCentre", "B_s = surfaces[last].B",
                   "T_u = (T_t^ν + X)^(1/ν)", "N_2pt times"):
        assert phrase in m["discretization"], phrase
    lim = m["limitations"]
    for phrase in ("Reduced model, not a simulation of W7-X", "not fitted to measurements", "schematic",
                   "ten island-divertor units", "coil response is not validated", "later milestone",
                   "not a 2D transport solution", "no detachment", "2.5 times the power",
                   "not the GENE-X spatial-parallel run", "remain illustrative"):
        assert phrase in lim, phrase
    assert "two-point model" in m["summary"] and "not a simulation of W7-X" in m["summary"]
    assert "remain illustrative" in m["summary"] and "high-power case" in m["summary"]
    assert "high-power case" in m["summary"]


# ---- H6: provenance, determinism, schema, manifest ------------------------------------------------------------------
def test_H6_provenance_geometry_derived_and_model_model():
    a = built()
    geo = a["geometryProvenance"]
    assert geo["kind"] == "derived"
    src = geo["sources"][0]
    assert src["sha256"] == io.sha256_file(paths.WOUT_W7X_KJM) and src["path"] == "data/raw/wout_w7x_kjm.nc"
    assert src["url"].endswith("wout_w7x_kjm.nc") and a["equilibrium"]["source"] == src
    assert "in T" in geo["units"] and "not normalised" in geo["units"] and "in m" in geo["units"]
    for phrase in ("9 flux surfaces", "48 VMEC theta x 72 phi", "8 field lines", "181 samples"):
        assert phrase in geo["coverage"]["description"], phrase
    assert geo["verification"]["outcome"] == "not-applicable"
    prov = a["provenance"]
    assert prov["kind"] == "model"
    assert prov["verification"]["outcome"] == "not-applicable"
    details = prov["verification"]["details"]
    assert "Reduced model, not a W7-X simulation" in details and "not fitted to measurements" in details
    assert "golden checkpoints" in details and "2e-06" in details
    assert prov["coverage"]["tStart"] == 0.0 and prov["coverage"]["tEnd"] == 3.0
    for p in (geo, prov):
        assert p["runtime"].startswith("not recorded") and "byte-deterministic" in p["runtime"]
    assert "MODEL.md" in prov["solverRevision"]


def test_H6_artifact_is_schema_valid_and_byte_identical_on_rebuild():
    a = built()
    v = _validator()
    v.validate(a)
    data = io.dumps(artifact.build())
    assert data == io.dumps(a)  # rebuild: byte-identical (no timestamps, no randomness)
    assert len(data) < 1_500_000
    # the contract rejects what it must
    for bad in (lambda x: x.pop("model"), lambda x: x["diverters"]["items"].pop(),
                lambda x: x["provenance"].update(kind="measured"), lambda x: x.update(extra=1),
                lambda x: x["model"]["parameters"].pop("kRef"), lambda x: x["surfaces"][0]["B"].__setitem__(0, 0.0),
                lambda x: x["model"]["golden"]["scenarios"][0]["coilSchedule"][0]["coils"].append(1)):
        doc = copy.deepcopy(a)
        bad(doc)
        assert not v.is_valid(doc)
    # the on-disk artifact validates against the tightened contract too
    v.validate(json.loads((paths.ARTIFACTS / "heatfield.json").read_text(encoding="utf-8")))
    # both provenance kinds are pinned (model output can never be labelled as data; the VMEC geometry is derived):
    # every other kind of the shared enum - which that enum alone would accept - is rejected, and only at <field>.kind
    common = json.loads((paths.CONTRACTS / "common.schema.json").read_text(encoding="utf-8"))
    kinds = common["$defs"]["provenance"]["properties"]["kind"]["enum"]
    for field, pinned, named in (("provenance", "model", {"derived", "live"}),
                                 ("geometryProvenance", "derived", {"model", "archive"})):
        assert a[field]["kind"] == pinned
        others = [k for k in kinds if k != pinned]
        assert named <= set(others) and len(others) == len(kinds) - 1
        for wrong in others:
            doc = copy.deepcopy(a)
            doc[field]["kind"] = wrong
            errors = list(v.iter_errors(doc))
            assert errors, (field, wrong)
            assert all(list(e.absolute_path) == [field, "kind"] for e in errors), (field, wrong)


def test_H6_manifest_lists_heatfield():
    assert build_artifacts.FEATURES[-1] == "heatfield"
    schema = json.loads((paths.CONTRACTS / "manifest.schema.json").read_text(encoding="utf-8"))
    assert "heatfield" in schema["properties"]["artifacts"]["items"]["properties"]["id"]["enum"]
    manifest = json.loads((paths.ARTIFACTS / "manifest.json").read_text(encoding="utf-8"))
    entry = next(e for e in manifest["artifacts"] if e["id"] == "heatfield")
    assert entry["path"] == "heatfield.json" and entry["schema"] == "heatfield.schema.json"
    assert entry["sha256"] == io.sha256_file(paths.ARTIFACTS / "heatfield.json")
    assert (artifact.ARTIFACT_ID, artifact.SCHEMA) == ("heatfield", "heatfield.schema.json")
