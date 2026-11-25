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
MODEL_MD_TABLE = {  # tasks/10-heat-field/MODEL.md "Parameters", version 2 (nSep and incidence are tunable)
    "Tped": (0.1, "keV"), "Tcore0": (3.0, "keV"), "rhoBlend": (0.7, "–"), "tauE": (0.5, "s"), "Dpar": (2.5, "rad²/s"),
    "Dperp0": (0.2, "rad²/s"), "B0": (2.5, "T"), "tauDiv": (0.02, "s"), "Ttarget": (0.02, "keV"), "sigmaPhi": (0.06, "rad"),
    "sigmaTheta": (0.12, "rad"), "sweepAmplitude": (0.30, "rad"), "sweepFrequency": (2.0, "Hz"), "epsilon": (0.03, "–"),
    "sigmaCoilPhi": (0.20, "rad"), "sigmaCoilTheta": (0.60, "rad"), "sheathGamma": (7.0, "–"), "nSep": (4.0e19, "m⁻³"),
    "ionMass": (1.0, "u"), "incidence": (0.03490659, "rad"), "keV": (1.602177e-16, "J"), "amu": (1.660539e-27, "kg"),
    "MW": (1.0e6, "W"),
    "tileGain": (100.0, "°C per MW m⁻²"), "Tcool": (30.0, "°C"), "tauTile": (1.0, "s"), "tileLimit": (1200.0, "°C"),
    "dt": (0.001, "s"), "spinup": (3.0, "s"),
}


def test_H4_parameters_are_the_model_md_table_except_the_two_tunable_ones():
    params = built()["model"]["parameters"]
    assert set(params) == set(MODEL_MD_TABLE)
    for name, (value, unit) in MODEL_MD_TABLE.items():
        rec = params[name]
        assert set(rec) == {"value", "unit", "symbol", "description"} and rec["symbol"] and rec["description"], name
        assert rec["unit"] == unit, name
        if name not in model.TUNED:
            assert rec["value"] == value, name
    assert {n: params[n]["value"] for n in model.TUNED} == {"nSep": 6.0e19, "incidence": 0.06981317}
    for n in model.TUNED:  # inside the stated ranges
        lo, hi = model.TUNING_RANGES[n]
        assert lo <= params[n]["value"] <= hi, n
    assert model.MODEL_MD_START == {n: MODEL_MD_TABLE[n][0] for n in model.TUNED}


def test_H4_the_model_consumes_the_inputs_as_written():
    a = built()
    inp = written_inputs()
    np.testing.assert_array_equal(inp.b_lcfs.ravel(), a["surfaces"][-1]["B"])
    assert inp.iota == a["surfaces"][-1]["iota"] and inp.theta_d == a["diverters"]["thetaCentre"]
    assert inp.phi_k == tuple(it["phi"] for it in a["diverters"]["items"])
    assert inp.params == {k: v["value"] for k, v in a["model"]["parameters"].items()}
    # the written values are 7-significant-figure numbers, not the raw doubles (e.g. pi/2 is 1.570796)
    assert inp.theta_d == 1.570796 != math.pi / 2


def _literal_step(inp: model.Inputs, T: np.ndarray, tiles: np.ndarray, n: int, coils) -> tuple[np.ndarray, np.ndarray]:
    """MODEL.md "One step", transcribed literally with explicit loops over every cell (independent of model.Model)."""
    p = inp.params
    n_t, n_p = inp.n_theta, inp.n_phi
    dth, dph = TAU / n_t, TAU / n_p
    th = [TAU * i / n_t for i in range(n_t)]
    ph = [TAU * j / n_p for j in range(n_p)]

    def wrap(x):
        return x - TAU * math.floor(x / TAU + 0.5)

    def g(x, s):
        return math.exp(-x * x / (2 * s * s))

    t = n * p["dt"]
    a = [ck * math.cos(TAU * p["sweepFrequency"] * t) for ck in coils]  # 1
    ts = [inp.theta_d + p["sweepAmplitude"] * a[k] for k in range(4)]  # 4
    B = np.empty((n_p, n_t))
    G = np.empty((4, n_p, n_t))
    for j in range(n_p):
        for i in range(n_t):
            h = [g(wrap(ph[j] - inp.phi_k[k]), p["sigmaCoilPhi"]) * g(wrap(th[i] - inp.theta_d), p["sigmaCoilTheta"])
                 for k in range(4)]  # 2
            B[j, i] = inp.b_lcfs[j, i] * (1 + p["epsilon"] * sum(a[k] * h[k] for k in range(4)))  # 3
            for k in range(4):
                G[k, j, i] = g(wrap(ph[j] - inp.phi_k[k]), p["sigmaPhi"]) * g(wrap(th[i] - ts[k]), p["sigmaTheta"])  # 5
    D = p["Dperp0"] * (p["B0"] / B) ** 2  # 6
    sigma = inp.iota * dph / dth  # 7
    s_p = math.floor(sigma)
    w = sigma - s_p
    T_new = np.empty_like(T)
    Q = np.zeros((4, n_t))
    for j in range(n_p):
        for i in range(n_t):
            c = T[j, i]
            jp, jm = (j + 1) % n_p, (j - 1) % n_p
            t_plus = (1 - w) * T[jp, (i + s_p) % n_t] + w * T[jp, (i + s_p + 1) % n_t]
            t_minus = (1 - w) * T[jm, (i - s_p) % n_t] + w * T[jm, (i - s_p - 1) % n_t]
            P = p["Dpar"] * (t_plus - 2 * c + t_minus) / dph**2
            ip, im = (i + 1) % n_t, (i - 1) % n_t
            d_plus, d_minus = (D[j, i] + D[j, ip]) / 2, (D[j, i] + D[j, im]) / 2  # 8
            X = (d_plus * (T[j, ip] - c) - d_minus * (c - T[j, im])) / dth**2
            S = (p["Tped"] - c) / p["tauE"]  # 9
            L = sum(G[k, j, i] * (c - p["Ttarget"]) / p["tauDiv"] for k in range(4))
            c_s = math.sqrt(2 * p["Ttarget"] * p["keV"] / (p["ionMass"] * p["amu"]))
            for k in range(4):  # 10: sheath law with two-point pressure balance
                q = (p["sheathGamma"] / 2 * p["nSep"] * p["keV"] * c_s * math.sin(p["incidence"]) / p["MW"]
                     * (B[j, i] / p["B0"]) * G[k, j, i] * c)
                Q[k, i] += q * dph / (math.sqrt(TAU) * p["sigmaPhi"])
            T_new[j, i] = c + p["dt"] * (P + X + S - L)  # 12
    tiles_new = tiles + p["dt"] * (p["Tcool"] + p["tileGain"] * Q - tiles) / p["tauTile"]  # 11
    return T_new, tiles_new


def test_H4_one_step_is_model_md_transcribed_literally():
    inp = written_inputs()
    m = model.Model(inp)
    rng = np.random.default_rng(4)
    p = inp.params
    for n, coils in ((137, (1, 0, 1, 1)), (0, (0, 0, 0, 0)), (2501, (0, 1, 0, 1))):
        T = rng.uniform(p["Ttarget"], p["Tped"], (N_PHI, N_THETA))
        tiles = rng.uniform(p["Tcool"], 1500.0, (4, N_THETA))
        got = m.step(model.State(n, T, tiles), coils)
        want_T, want_tiles = _literal_step(inp, T, tiles, n, coils)
        assert got.n == n + 1
        np.testing.assert_allclose(got.T, want_T, rtol=1e-12, atol=0)
        np.testing.assert_allclose(got.tiles, want_tiles, rtol=1e-12, atol=0)


def test_H4_uniform_pedestal_without_sinks_or_coils_stays_exactly_uniform():
    # No exhaust (tau_div infinite) and no deposition (n_u = 0: the sheath law is not energy-coupled to the sink).
    inp = written_inputs().with_params(tauDiv=math.inf, nSep=0.0)
    m = model.Model(inp)
    _, st = model.run(m, model.ALL_OFF, [400])
    assert np.all(st.T == inp.params["Tped"])  # exactly, every cell
    assert np.all(st.tiles == inp.params["Tcool"])
    # with the diverter sinks (the real parameters) it does not stay uniform
    _, st = model.run(model.Model(written_inputs()), model.ALL_OFF, [400])
    assert st.T.min() < 0.9 * written_inputs().params["Tped"]


def test_H4_temperature_stays_between_target_and_pedestal():
    inp = written_inputs()
    p = inp.params
    m = model.Model(inp)
    seen = {"min": math.inf, "max": -math.inf, "n": 0}

    def observe(st):
        seen["min"] = min(seen["min"], float(st.T.min()))
        seen["max"] = max(seen["max"], float(st.T.max()))
        seen["n"] += 1

    model.run(m, model.SCENARIOS[2]["coilSchedule"], [3000], observe)
    assert seen["n"] == 3001
    assert p["Ttarget"] <= seen["min"] and seen["max"] <= p["Tped"]
    # from a rough initial state that touches both bounds, with every coil sweeping: still inside (the update is a convex
    # combination of T values, T_ped and T_t; 1e-12 allows for floating-point rounding of that combination)
    rng = np.random.default_rng(7)
    T = rng.choice([p["Ttarget"], p["Tped"]], size=(N_PHI, N_THETA))
    st = model.State(0, T, np.full((4, N_THETA), p["Tcool"]))
    for _ in range(300):
        st = m.step(st, (1, 1, 1, 1))
        assert p["Ttarget"] - 1e-12 <= st.T.min() and st.T.max() <= p["Tped"] + 1e-12


def test_H4_stability_condition_holds_for_the_coil_perturbed_field():
    inp = written_inputs()
    p = inp.params
    m = model.Model(inp)
    number = m.check_stability()
    # recomputed: |B| lowest with every coil at a_k = -1 (the four envelopes do not overlap)
    b_low = np.min([m.field(np.array(a, dtype=float)) for a in ((-1, -1, -1, -1), (0, 0, 0, 0))], axis=0)
    d_perp_max = (p["Dperp0"] * (p["B0"] / b_low) ** 2).max()
    dphi, dtheta = TAU / N_PHI, TAU / N_THETA
    expected = p["dt"] * (2 * p["Dpar"] / dphi**2 + 2 * d_perp_max / dtheta**2 + 1 / p["tauE"] + 1 / p["tauDiv"])
    assert number == pytest.approx(expected, rel=1e-9)
    assert 0.7 < number <= 1  # MODEL.md: ~0.74 with the table's values
    unperturbed = p["dt"] * (2 * p["Dpar"] / dphi**2 + 2 * (p["Dperp0"] * (p["B0"] / inp.b_lcfs) ** 2).max() / dtheta**2
                             + 1 / p["tauE"] + 1 / p["tauDiv"])
    assert number > unperturbed  # the coil-perturbed field is the binding case
    assert f"for these parameters it is {number:.4f}" in built()["model"]["discretization"]
    with pytest.raises(ValueError, match="unstable"):
        model.Model(inp.with_params(dt=0.002)).check_stability()


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
    # only the swept diverters cool: D1 and D3 on, D2 and D4 off
    d13 = _golden("coils-D1-D3", 3000)["peakTileC"]
    assert d13[0] < off[0] and d13[2] < off[2]
    assert d13[1] == pytest.approx(off[1], rel=0.01) and d13[3] == pytest.approx(off[3], rel=0.01)


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
            assert all(0.01 <= v <= 1.0 for v in c["probesT"] + [c["meanT"]])
            assert all(v > 30 for v in c["peakTileC"]) and all(v > 0 for v in c["peakHeatFlux"])
    # before the switch the two schedules are identical, so are the states
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
    assert "nSep changed from MODEL.md's starting value 4e+19 to 6e+19" in lim
    assert "incidence changed from MODEL.md's starting value 0.0349066 to 0.0698132" in lim
    assert "high-power case" in lim and "10 MW/m² W7-X target design load" in lim
    assert "D1, D4 above the illustrative 1200 °C tile limit and D2, D3 below it" in lim
    assert "all below the limit" in lim
    assert model.regime(model.Model(written_inputs()), built()["model"]["golden"]["scenarios"])["ok"] is True


def test_H5_model_text_states_what_the_model_is():
    m = built()["model"]
    assert m["version"] == 2 and m["name"] and m["summary"]
    ids = [e["id"] for e in m["equations"]]
    assert ids == ["heat", "parallel", "cross-field", "field", "strike-line", "footprint", "deposition", "tiles"]
    assert all(e["text"] and e["meaning"] for e in m["equations"])
    assert m["equations"][0]["text"].startswith("∂T/∂t = D_∥ ∂²T/∂ℓ²")
    for phrase in ("wrap(x) = x − 2π·floor(x/(2π) + 0.5)", "every right-hand side at the state of t_n",
                   "largest fromStep ≤ n", "φ_k = diverters.items[k].phi", "θ_d = diverters.thetaCentre",
                   "B_s = surfaces[last].B", "T₊[i,j] = (1−w)·T[i+p, j+1] + w·T[i+p+1, j+1]", "λ neglected"):
        assert phrase in m["discretization"], phrase
    lim = m["limitations"]
    for phrase in ("Reduced model, not a simulation of W7-X", "not fitted to measurements", "schematic",
                   "ten island-divertor units", "coil response is not validated", "later milestone",
                   "stream function λ neglected", "not the GENE-X spatial-parallel run"):
        assert phrase in lim, phrase
    assert "sheath heat-transmission law" in m["summary"] and "not a simulation of W7-X" in m["summary"]
    assert "remain illustrative" in m["summary"] and "remain illustrative" in m["limitations"]
    assert "cold edge (T = T_t) deposits" in m["limitations"]
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
                lambda x: x["model"]["parameters"].pop("tileGain"), lambda x: x["surfaces"][0]["B"].__setitem__(0, 0.0),
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
