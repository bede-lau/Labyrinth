"""Reduced edge heat model, version 2: the Python reference of tasks/10-heat-field/MODEL.md (D-027 §3, §5; D-031).

This is NOT a simulation of W7-X. Its edge temperatures and sheath-law inputs are physical orders of magnitude, its
transport, footprint, coil and tile parameters are illustrative, none is fitted to measurements, its four
diverters are schematic and its control coils are not a validated coil response. Every output is provenance `model`.

The renderer's TypeScript port reads every input from `artifacts/heatfield.json` and must reproduce the golden
checkpoints written here to `relativeTolerance`. So this module consumes its inputs exactly as they are written to the
artifact (`inputs_from_artifact` on the 7-significant-figure dict, see `artifact.py`), and follows MODEL.md literally:

* grid: theta_i = 2*pi*i/nTheta, phi_j = 2*pi*j/nPhi, dtheta = 2*pi/nTheta, dphi = 2*pi/nPhi; arrays have shape
  (nPhi, nTheta), so element [j, i] is cell c = j*nTheta + i; every index is periodic;
* inputs: B_s = surfaces[-1].B (LCFS |B|, T), iota = surfaces[-1].iota, phi_k = diverters.items[k].phi,
  theta_d = diverters.thetaCentre, every parameter = model.parameters[name].value;
* one step n -> n+1 (t_n = n*dt) evaluates steps 1-12 with every right-hand side at the state of t_n;
* the coils of step n are those of the coil-schedule entry with the largest fromStep <= n (they drive step n -> n+1
  and the diagnostics of the state after n steps).
"""
from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace

import numpy as np

TWO_PI = 2 * math.pi
N_DIVERTERS = 4

# name: (value, unit, symbol, description). MODEL.md's table (version 2, D-031). Only nSep and incidence are tuned
# (MODEL.md "Tuning", each inside its stated range; MODEL_MD_START holds the starting values). The heat flux follows the
# sheath heat-transmission law with two-point pressure balance; keV, amu and MW are unit conversions carried as data so
# that neither implementation holds a numeric constant of the model. At the starting values (4e19 m^-3, 2 deg) the
# coils-off peaks are ~4.4 MW/m^2 and ~450 degC: no diverter reaches the limit. Only the top of both ranges (6e19 m^-3,
# 4 deg: ~13 MW/m^2, above the 10 MW/m^2 W7-X target design load) meets the tuning rule. Tile temperatures are linear
# in n_u*sin(alpha) (deposition does not feed back into T), so the regime holds in a narrow band n_u*sin(alpha) >~ 0.93x
# the top value; the corner was chosen. The model is a high-power edge case, and says so (D-031).
PARAMETERS: dict[str, tuple[float, str, str, str]] = {
    "Tped": (0.1, "keV", "T_ped", "LCFS temperature the core supplies (no sinks); W7-X separatrix ~0.05-0.15 keV"),
    "Tcore0": (3.0, "keV", "T_0", "core temperature on axis (cross-sections only)"),
    "rhoBlend": (0.7, "–", "ρ_b", "inside ρ_b the cross-section shows the core profile only"),
    "tauE": (0.5, "s", "τ_E", "relaxation time towards T_ped"),
    "Dpar": (2.5, "rad²/s", "D_∥", "diffusivity along the field line (per radian of φ)"),
    "Dperp0": (0.2, "rad²/s", "D_⊥0", "cross-field (θ) diffusivity at B = B0"),
    "B0": (2.5, "T", "B_0", "reference field"),
    "tauDiv": (0.02, "s", "τ_div", "exhaust time at the centre of a diverter footprint"),
    "Ttarget": (0.02, "keV", "T_t", "plasma temperature at the target (attached divertor, ~10-30 eV)"),
    "sigmaPhi": (0.06, "rad", "σ_φ", "footprint width in φ"),
    "sigmaTheta": (0.12, "rad", "σ_θ", "footprint width in θ"),
    "sweepAmplitude": (0.30, "rad", "A_s", "strike-line excursion when a coil is on"),
    "sweepFrequency": (2.0, "Hz", "f", "coil (sweep) frequency"),
    "epsilon": (0.03, "–", "ε", "relative |B| perturbation of one coil at its centre"),
    "sigmaCoilPhi": (0.20, "rad", "σ_cφ", "coil envelope width in φ"),
    "sigmaCoilTheta": (0.60, "rad", "σ_cθ", "coil envelope width in θ"),
    "sheathGamma": (7.0, "–", "γ", "sheath heat-transmission coefficient (standard value ~7)"),
    "nSep": (6.0e19, "m⁻³", "n_u", "upstream (separatrix) density; tuned within 1e19-6e19 m⁻³ (top: high-power case)"),
    "ionMass": (1.0, "u", "m_i", "ion mass (hydrogen plasma)"),
    "incidence": (0.06981317, "rad", "α", "field-line incidence angle on the target (4°); tuned within 1-4° (top)"),
    "keV": (1.602176634e-16, "J", "keV", "one keV in joules (unit conversion)"),
    "amu": (1.66053906660e-27, "kg", "u", "atomic mass unit (unit conversion)"),
    "MW": (1.0e6, "W", "MW", "one megawatt in watts (unit conversion)"),
    "tileGain": (100.0, "°C per MW m⁻²", "K", "steady tile surface temperature rise per unit heat flux"),
    "Tcool": (30.0, "°C", "T_cool", "coolant / cold tile temperature"),
    "tauTile": (1.0, "s", "τ_tile", "tile thermal time constant"),
    "tileLimit": (1200.0, "°C", "T_lim", "illustrative tile surface limit"),
    "dt": (0.001, "s", "Δt", "time step"),
    "spinup": (3.0, "s", "t_spin", "the view starts from the state after this time with every coil off"),
}
MODEL_MD_START = {"nSep": 4.0e19, "incidence": 0.03490659}  # MODEL.md's starting values of the two tunable parameters
TUNED = ("nSep", "incidence")
TUNING_RANGES = {"nSep": (1.0e19, 6.0e19), "incidence": (0.01745329, 0.06981317)}

PROBES: tuple[tuple[int, int], ...] = ((12, 0), (12, 18), (12, 36), (12, 54), (0, 0), (24, 9), (36, 27), (6, 45))
RELATIVE_TOLERANCE = 2e-6

SCENARIOS: tuple[dict, ...] = (
    {"id": "coils-off", "description": "Every coil off from step 0 (t = 0).",
     "coilSchedule": ({"fromStep": 0, "coils": (0, 0, 0, 0)},), "checkpoints": (250, 1000, 3000)},
    {"id": "coils-D1-D3", "description": "Coils at D1 and D3 on from step 0, D2 and D4 off.",
     "coilSchedule": ({"fromStep": 0, "coils": (1, 0, 1, 0)},), "checkpoints": (250, 1000, 3000)},
    {"id": "switch-at-1s", "description": "Every coil off from step 0, every coil on from step 1000 (t = 1 s).",
     "coilSchedule": ({"fromStep": 0, "coils": (0, 0, 0, 0)}, {"fromStep": 1000, "coils": (1, 1, 1, 1)}),
     "checkpoints": (1000, 1500, 3000)},
)
ALL_ON = ({"fromStep": 0, "coils": (1, 1, 1, 1)},)  # regime check (MODEL.md "Tuning"), not golden
ALL_OFF = SCENARIOS[0]["coilSchedule"]
REGIME_STEP = 3000


def wrap(x):
    """wrap(x) = x - 2*pi*floor(x/(2*pi) + 0.5), into [-pi, pi)."""
    return x - TWO_PI * np.floor(x / TWO_PI + 0.5)


def gauss(x, sigma: float):
    """g(x, sigma) = exp(-x^2/(2 sigma^2))."""
    return np.exp(-(x * x) / (2 * sigma * sigma))


def parameter_records() -> dict[str, dict]:
    return {name: {"value": v, "unit": u, "symbol": sym, "description": d} for name, (v, u, sym, d) in PARAMETERS.items()}


@dataclass(frozen=True)
class Inputs:
    """Everything the model reads, as written to the artifact."""

    n_theta: int
    n_phi: int
    b_lcfs: np.ndarray  # (nPhi, nTheta), T
    iota: float
    params: Mapping[str, float]
    theta_d: float
    phi_k: tuple[float, ...]
    probes: tuple[tuple[int, int], ...] = PROBES

    def with_params(self, **changes: float) -> Inputs:
        return replace(self, params={**self.params, **changes})


def inputs_from_artifact(art: Mapping) -> Inputs:
    """The model's inputs read from an artifact dict (normally the 7-significant-figure one), as the renderer does."""
    grid = art["grid"]
    n_theta, n_phi = int(grid["nTheta"]), int(grid["nPhi"])
    lcfs = art["surfaces"][-1]
    if lcfs["rho"] != 1:
        raise ValueError("the last surface must be the LCFS (rho 1)")
    b = np.asarray(lcfs["B"], dtype=float)
    if b.shape != (n_theta * n_phi,):
        raise ValueError(f"LCFS |B| has {b.size} values, expected nTheta*nPhi = {n_theta * n_phi}")
    div = art["diverters"]
    if [d["id"] for d in div["items"]] != ["D1", "D2", "D3", "D4"]:
        raise ValueError("expected diverters D1..D4")
    if n_phi % 4:
        raise ValueError("nPhi must be a multiple of 4 so that the diverters lie on grid planes")
    return Inputs(
        n_theta=n_theta,
        n_phi=n_phi,
        b_lcfs=b.reshape(n_phi, n_theta),
        iota=float(lcfs["iota"]),
        params={k: float(v["value"]) for k, v in art["model"]["parameters"].items()},
        theta_d=float(div["thetaCentre"]),
        phi_k=tuple(float(d["phi"]) for d in div["items"]),
        probes=tuple((int(i), int(j)) for i, j in art["model"]["probes"]),
    )


@dataclass(frozen=True)
class State:
    n: int  # steps taken from the initial condition; t_n = n*dt
    T: np.ndarray  # (nPhi, nTheta), keV
    tiles: np.ndarray  # (4, nTheta), degC: target strip of diverter k along theta, at phi_k


@dataclass
class Model:
    inp: Inputs
    _periodic: dict = field(init=False, repr=False)

    def __post_init__(self) -> None:
        inp, p = self.inp, self.inp.params
        if len(inp.phi_k) != N_DIVERTERS:
            raise ValueError("the model has four diverters")
        n_t, n_p = inp.n_theta, inp.n_phi
        self.dtheta = TWO_PI / n_t
        self.dphi = TWO_PI / n_p
        self.theta = TWO_PI * np.arange(n_t) / n_t  # theta_i
        self.phi = TWO_PI * np.arange(n_p) / n_p  # phi_j
        self.b_s = np.asarray(inp.b_lcfs, dtype=float)
        # Step 2 (time independent): coil envelope h_k[c] = g(wrap(phi_j - phi_k), s_cphi) * g(wrap(theta_i - theta_d), s_ctheta)
        g_theta_d = gauss(wrap(self.theta - inp.theta_d), p["sigmaCoilTheta"])
        self.h = np.stack([gauss(wrap(self.phi - pk), p["sigmaCoilPhi"])[:, None] * g_theta_d[None, :] for pk in inp.phi_k])
        # Step 5, phi factor (time independent): g(wrap(phi_j - phi_k), sigma_phi)
        self.g_phi = np.stack([gauss(wrap(self.phi - pk), p["sigmaPhi"]) for pk in inp.phi_k])
        # Step 7: field-line pitch in cells, sigma = iota*dphi/dtheta, p = floor(sigma), w = sigma - p
        sigma = inp.iota * self.dphi / self.dtheta
        self.shift = math.floor(sigma)
        self.w = sigma - self.shift
        # Step 10: strip-load normalisation dphi/(sqrt(2 pi) sigma_phi)
        self.strip_factor = self.dphi / (math.sqrt(TWO_PI) * p["sigmaPhi"])

        def take(dj: int, di: int) -> np.ndarray:
            """Flat indices of T[(j + dj) mod nPhi, (i + di) mod nTheta] for every cell [j, i]."""
            j = (np.arange(n_p)[:, None] + dj) % n_p
            i = (np.arange(n_t)[None, :] + di) % n_t
            return j * n_t + i

        s = self.shift
        self._periodic = {"plus0": take(1, s), "plus1": take(1, s + 1), "minus0": take(-1, -s), "minus1": take(-1, -s - 1),
                          "east": take(0, 1), "west": take(0, -1)}

    # ---- steps 1-5, 10: coils, field, strike lines, footprints, heat flux ------------------------------------------
    def coil_drive(self, coils: Sequence[int], t: float) -> np.ndarray:
        """Step 1: a_k = c_k * cos(2 pi f t)."""
        c = math.cos(TWO_PI * self.inp.params["sweepFrequency"] * t)
        return np.array([ck * c for ck in coils], dtype=float)

    def field(self, a: np.ndarray) -> np.ndarray:
        """Step 3: B[c] = B_s[c] * (1 + eps * sum_k a_k h_k[c])."""
        pert = a[0] * self.h[0]
        for k in range(1, N_DIVERTERS):
            pert = pert + a[k] * self.h[k]
        return self.b_s * (1.0 + self.inp.params["epsilon"] * pert)

    def strike_lines(self, a: np.ndarray) -> np.ndarray:
        """Step 4: theta_s,k = theta_d + A_s * a_k."""
        return self.inp.theta_d + self.inp.params["sweepAmplitude"] * a

    def footprints(self, a: np.ndarray) -> np.ndarray:
        """Step 5: g_k[c] = g(wrap(phi_j - phi_k), sigma_phi) * g(wrap(theta_i - theta_s,k), sigma_theta); (4, nPhi, nTheta)."""
        ts = self.strike_lines(a)
        g_theta = np.stack([gauss(wrap(self.theta - tk), self.inp.params["sigmaTheta"]) for tk in ts])
        return self.g_phi[:, :, None] * g_theta[:, None, :]

    def sheath_factor(self) -> float:
        """Step 10, constant part: (gamma/2) n_u e c_s(T_t) sin(alpha) / MW, in MW m^-2 per keV of upstream temperature;
        c_s(T_t) = sqrt(2 T_t keV / (m_i amu)) (T_e = T_i at the target)."""
        p = self.inp.params
        c_s = math.sqrt(2 * p["Ttarget"] * p["keV"] / (p["ionMass"] * p["amu"]))
        return p["sheathGamma"] / 2 * p["nSep"] * p["keV"] * c_s * math.sin(p["incidence"]) / p["MW"]

    def strip_loads(self, T: np.ndarray, B: np.ndarray, g: np.ndarray) -> np.ndarray:
        """Step 10: q_k = (gamma/2) n_u e T c_s(T_t) sin(alpha) (B/B_0) g_k (MW/m^2); Q_k[i] = sum_j q_k[i, j] dphi/(sqrt(2 pi) sigma_phi)."""
        p = self.inp.params
        q = self.sheath_factor() * (B / p["B0"])[None, :, :] * g * T[None, :, :]
        return q.sum(axis=1) * self.strip_factor

    # ---- the step ---------------------------------------------------------------------------------------------------
    def initial_state(self) -> State:
        p = self.inp.params
        return State(0, np.full((self.inp.n_phi, self.inp.n_theta), p["Tped"]),
                     np.full((N_DIVERTERS, self.inp.n_theta), p["Tcool"]))

    def time(self, n: int) -> float:
        return n * self.inp.params["dt"]

    def step(self, st: State, coils: Sequence[int]) -> State:
        """One explicit step n -> n+1; every right-hand side uses the state at t_n."""
        p = self.inp.params
        T = st.T
        flat = T.ravel()
        t = self.time(st.n)
        a = self.coil_drive(coils, t)  # 1
        B = self.field(a)  # 2, 3
        g = self.footprints(a)  # 4, 5
        d_perp = p["Dperp0"] * (p["B0"] / B) ** 2  # 6
        w, ix = self.w, self._periodic
        t_plus = (1 - w) * flat[ix["plus0"]] + w * flat[ix["plus1"]]  # 7
        t_minus = (1 - w) * flat[ix["minus0"]] + w * flat[ix["minus1"]]
        par = p["Dpar"] * (t_plus - 2 * T + t_minus) / self.dphi**2
        dflat = d_perp.ravel()
        d_plus = (d_perp + dflat[ix["east"]]) / 2  # 8
        d_minus = (d_perp + dflat[ix["west"]]) / 2
        cross = (d_plus * (flat[ix["east"]] - T) - d_minus * (T - flat[ix["west"]])) / self.dtheta**2
        src = (p["Tped"] - T) / p["tauE"]  # 9
        excess = (T - p["Ttarget"]) / p["tauDiv"]
        sink = g[0] * excess
        for k in range(1, N_DIVERTERS):
            sink = sink + g[k] * excess
        loads = self.strip_loads(T, B, g)  # 10
        tiles = st.tiles + p["dt"] * (p["Tcool"] + p["tileGain"] * loads - st.tiles) / p["tauTile"]  # 11
        T_new = T + p["dt"] * (par + cross + src - sink)  # 12
        return State(st.n + 1, T_new, tiles)

    # ---- diagnostics ------------------------------------------------------------------------------------------------
    def heat_flux_loads(self, st: State, coils: Sequence[int]) -> np.ndarray:
        """Q_k[i] from the state and the coils at its time t_n (steps 1-5, 10); (4, nTheta)."""
        a = self.coil_drive(coils, self.time(st.n))
        return self.strip_loads(st.T, self.field(a), self.footprints(a))

    def diagnostics(self, st: State, coils: Sequence[int]) -> dict:
        return {
            "step": st.n,
            "t": self.time(st.n),
            "probesT": [float(st.T[j, i]) for i, j in self.inp.probes],
            "meanT": float(st.T.mean()),
            "peakTileC": [float(v) for v in st.tiles.max(axis=1)],
            "peakHeatFlux": [float(v) for v in self.heat_flux_loads(st, coils).max(axis=1)],
        }

    # ---- stability ---------------------------------------------------------------------------------------------------
    def stability_number(self) -> float:
        """dt*(2 D_par/dphi^2 + 2 max D_perp/dtheta^2 + 1/tau_E + max sum_k g_k/tau_div), the maximum over every coil state:
        |B| is lowest where every a_k = -1, i.e. B_s*(1 - eps*sum_k h_k), and the theta factor of g_k is at most 1."""
        p = self.inp.params
        b_min = self.b_s * (1.0 - p["epsilon"] * self.h.sum(axis=0))
        if not np.all(b_min > 0):
            raise ValueError("the coil perturbation drives |B| to zero")
        d_perp_max = float((p["Dperp0"] * (p["B0"] / b_min) ** 2).max())
        g_max = float(self.g_phi.sum(axis=0).max())
        return p["dt"] * (2 * p["Dpar"] / self.dphi**2 + 2 * d_perp_max / self.dtheta**2 + 1 / p["tauE"] + g_max / p["tauDiv"])

    def check_stability(self) -> float:
        """MODEL.md: every update weight is non-negative (monotone step). Raises if the parameters break it."""
        number = self.stability_number()
        if not number <= 1:
            raise ValueError(f"unstable parameters: stability number {number:.4g} > 1 (MODEL.md)")
        if not 0 < self.inp.params["dt"] <= self.inp.params["tauTile"]:
            raise ValueError("the tile update needs 0 < dt <= tauTile")
        if not 0 <= self.w < 1:
            raise ValueError("interpolation weight outside [0, 1)")
        return number


# ---- runs ---------------------------------------------------------------------------------------------------------------
def coils_at(schedule: Sequence[Mapping], n: int) -> tuple[int, ...]:
    """Coils of step n: the schedule entry with the largest fromStep <= n."""
    entries = sorted(schedule, key=lambda e: e["fromStep"])
    if not entries or entries[0]["fromStep"] != 0:
        raise ValueError("a coil schedule starts at step 0")
    current = entries[0]
    for e in entries:
        if e["fromStep"] <= n:
            current = e
    return tuple(int(c) for c in current["coils"])


def run(model: Model, schedule: Sequence[Mapping], checkpoints: Sequence[int],
        observe: Callable[[State], None] | None = None) -> tuple[list[dict], State]:
    """Diagnostics of the states after each checkpoint step, and the final state. `observe` sees every state."""
    wanted = sorted(set(int(c) for c in checkpoints))
    last = wanted[-1]
    st = model.initial_state()
    out = []
    while True:
        if observe is not None:
            observe(st)
        if st.n in wanted:
            out.append(model.diagnostics(st, coils_at(schedule, st.n)))
        if st.n == last:
            return out, st
        st = model.step(st, coils_at(schedule, st.n))


def golden(model: Model) -> list[dict]:
    """The three MODEL.md scenarios with their checkpoints (artifact `model.golden.scenarios`)."""
    out = []
    for sc in SCENARIOS:
        checkpoints, _ = run(model, sc["coilSchedule"], sc["checkpoints"])
        out.append({"id": sc["id"], "description": sc["description"],
                    "coilSchedule": [{"fromStep": e["fromStep"], "coils": list(e["coils"])} for e in sc["coilSchedule"]],
                    "checkpoints": checkpoints})
    return out


def regime(model: Model, golden_scenarios: Sequence[Mapping] | None = None) -> dict:
    """MODEL.md "Tuning": peak tile temperatures at step 3000 with every coil off and with every coil on from step 0."""
    limit = model.inp.params["tileLimit"]
    off = None
    for sc in golden_scenarios or ():
        if sc["id"] == "coils-off":
            off = next(c["peakTileC"] for c in sc["checkpoints"] if c["step"] == REGIME_STEP)
    if off is None:
        off = run(model, ALL_OFF, [REGIME_STEP])[0][0]["peakTileC"]
    on = run(model, ALL_ON, [REGIME_STEP])[0][0]["peakTileC"]
    return {"limit": limit, "off": off, "on": on,
            "ok": any(v > limit for v in off) and any(v < limit for v in off) and all(v < limit for v in on)}
