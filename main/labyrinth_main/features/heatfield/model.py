"""Edge heat model, version 3: the Python reference of tasks/10-heat-field/MODEL.md (D-027 §3, §5; D-031; D-032).

This is NOT a simulation of W7-X. The scrape-off layer at each divertor is the textbook two-point model (Spitzer
parallel conduction, sheath, pressure balance), fed by a fixed heating power, so the power that reaches the targets
is exactly the heating power less the radiated fraction (energy is conserved by construction). The physics inputs are
W7-X orders of magnitude; the footprint, coil-sweep and tile parameters are illustrative; nothing is fitted to
measurements; the four diverters are schematic and the control coils are not a validated coil response. Every output
is provenance `model`.

The renderer's TypeScript port reads every input from `artifacts/heatfield.json` and must reproduce the golden
checkpoints written here to `relativeTolerance`. So this module consumes its inputs exactly as they are written to the
artifact (`inputs_from_artifact` on the 7-significant-figure dict, see `artifact.py`), and follows MODEL.md literally:

* grid: theta_i = 2*pi*i/nTheta, phi_j = 2*pi*j/nPhi, dtheta = 2*pi/nTheta, dphi = 2*pi/nPhi; arrays have shape
  (nPhi, nTheta), so element [j, i] is cell c = j*nTheta + i; every index is periodic;
* inputs: B_s = surfaces[-1].B (LCFS |B|, T), phi_k = diverters.items[k].phi, theta_d = diverters.thetaCentre, every
  parameter = model.parameters[name].value;
* one step n -> n+1 (t_n = n*dt) updates the tiles from the loads at t_n; the LCFS temperature of a state is the
  quasi-steady two-point solution at its own time with the coils that drove the step into it (coils off at step 0);
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

# name: (value, unit, symbol, description). MODEL.md's table (version 3, D-032). The operating point (Pheat 6 MW,
# fRad 0.3, wettedArea 0.1 m^2) was chosen so that, with every coil off, the two diverters whose strike lines sit at
# the higher |B| (D1, D4: field compression ~1.23) pass the tile limit and the other two (D2, D3: ~1.02) do not. The
# four schematic diverters carry the power W7-X's ten units share. Spitzer's exponent and the fixed iteration count of
# the two-point solve are data, so that neither implementation holds a numeric constant of the model.
PARAMETERS: dict[str, tuple[float, str, str, str]] = {
    "Tcore0": (3.0, "keV", "T_0", "core temperature on axis (cross-sections only)"),
    "rhoBlend": (0.7, "–", "ρ_b", "inside ρ_b the cross-section shows the core profile only"),
    "B0": (2.5, "T", "B_0", "reference field"),
    "sigmaPhi": (0.06, "rad", "σ_φ", "footprint width in φ on the LCFS map (illustrative)"),
    "sigmaTheta": (0.12, "rad", "σ_θ", "footprint and strike-line width in θ (illustrative)"),
    "sweepAmplitude": (0.30, "rad", "A_s", "strike-line excursion when a coil is on (illustrative)"),
    "sweepFrequency": (2.0, "Hz", "f", "coil (sweep) frequency (illustrative)"),
    "epsilon": (0.03, "–", "ε", "relative |B| perturbation of one coil at its centre (illustrative)"),
    "sigmaCoilPhi": (0.20, "rad", "σ_cφ", "coil envelope width in φ (illustrative)"),
    "sigmaCoilTheta": (0.60, "rad", "σ_cθ", "coil envelope width in θ (illustrative)"),
    "shareShift": (0.3, "–", "η", "a coil fully on lowers its divertor's power weight by 1 − η (its static field moves "
                  "the island); the shares are renormalised so the total is unchanged: D1 alone sheds ~24 % to the "
                  "others, every coil on moves nothing (illustrative, no validated coil response)"),
    "Pheat": (7.5, "MW", "P_heat", "heating power crossing the LCFS (W7-X: ECRH up to ~8 MW, more with NBI)"),
    "fRad": (0.3, "–", "f_rad", "fraction of the heating power radiated before it reaches the targets"),
    "wettedArea": (0.1, "m²", "A_wet", "effective wetted target area per divertor at B_0"),
    "connectionLength": (200.0, "m", "L_c", "parallel connection length, upstream to target (island divertor)"),
    "kappa0": (6.324555e13, "W m⁻¹ keV⁻⁷ᐟ²", "κ_0", "Spitzer parallel conductivity coefficient (2000 W m⁻¹ eV⁻⁷ᐟ²)"),
    "conductionExponent": (3.5, "–", "ν", "Spitzer exponent: q_∥ L_c = (κ_0/ν)(T_u^ν − T_t^ν), ν = 7/2"),
    "twoPointIterations": (20.0, "–", "N_2pt", "fixed iteration count of the two-point solve"),
    "sheathGamma": (7.0, "–", "γ", "sheath heat-transmission coefficient"),
    "nSep": (4.0e19, "m⁻³", "n_u", "upstream (separatrix) density"),
    "ionMass": (1.0, "u", "m_i", "ion mass (hydrogen plasma)"),
    "incidence": (0.03490659, "rad", "α", "field-line incidence angle on the target (2°)"),
    "keV": (1.602176634e-16, "J", "keV", "one keV in joules (unit conversion)"),
    "amu": (1.66053906660e-27, "kg", "u", "atomic mass unit (unit conversion)"),
    "MW": (1.0e6, "W", "MW", "one megawatt in watts (unit conversion)"),
    "tileThickness": (0.006, "m", "d", "CFC armour thickness (W7-X target elements: NB31 tiles, ~6 mm machined)"),
    "tileCells": (6.0, "–", "N_z", "conduction cells through the tile thickness"),
    "tileDensity": (1900.0, "kg m⁻³", "ρ", "CFC NB31 density"),
    "kRef": (350.0, "W m⁻¹ K⁻¹", "k_ref", "CFC conductivity through the thickness at T_ref (approximate NB31 fit)"),
    "kScale": (700.0, "°C", "T_k", "k(T) = k_ref/(1 + (T − T_ref)/T_k): ~170 W m⁻¹ K⁻¹ at 800 °C (approximate fit)"),
    "cpRef": (710.0, "J kg⁻¹ K⁻¹", "c_ref", "graphite specific heat at T_ref"),
    "cpHigh": (2000.0, "J kg⁻¹ K⁻¹", "c_∞", "high-temperature limit of the graphite specific heat"),
    "cpScale": (670.0, "°C", "T_c", "c(T) = c_∞ − (c_∞ − c_ref)·exp(−(T − T_ref)/T_c): ~1600 at 800 °C (approximate fit)"),
    "Tref": (20.0, "°C", "T_ref", "reference temperature of the material fits"),
    "sinkResistance": (4.5e-5, "m² K W⁻¹", "R_sink",
                       "effective lumped resistance of the Cu interlayer, CuCrZr heat sink and water film per unit area (not "
                       "calibrated; it puts the CFC/Cu interface at ~1000 °C at 22 MW m⁻², consistent with element tests "
                       "in which the interlayer approached its ~1100 °C melting point above 22 MW m⁻²)"),
    "Tcool": (30.0, "°C", "T_cool", "cooling-water temperature (W7-X design inlet 30 °C)"),
    "tileLimit": (1200.0, "°C", "T_lim", "tile surface temperature limit (operational, illustrative)"),
    "dt": (0.001, "s", "Δt", "time step"),
    "spinup": (3.0, "s", "t_spin", "the view starts from the state after this time with every coil off"),
}
MODEL_MD_START = {"Pheat": 7.5, "wettedArea": 0.1}  # MODEL.md's values of the two operating-point parameters
TUNED = ("Pheat", "wettedArea")
TUNING_RANGES = {"Pheat": (2.0, 8.0), "wettedArea": (0.1, 0.2)}

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
    tiles: np.ndarray  # (4, nTheta), degC: surface temperature of the target strip of diverter k along theta, at phi_k
    slab: np.ndarray  # (4, nTheta, N_z), degC: cell temperatures through the tile thickness (index 0 at the surface)


@dataclass
class Model:
    inp: Inputs
    _cache: dict = field(init=False, repr=False)

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
        # Step 6: toroidal sectors s_k(phi_j) = G_k / sum_m G_m, G_k = g(wrap(phi_j - phi_k), pi/nDiv)
        big = np.stack([gauss(wrap(self.phi - pk), math.pi / N_DIVERTERS) for pk in inp.phi_k])
        self.sector = big / big.sum(axis=0)[None, :]
        # Step 7: the divertor planes j_k = round(phi_k/dphi) mod nPhi
        self.j_k = tuple(int(round(pk / self.dphi)) % n_p for pk in inp.phi_k)
        self._cache = {}

    # ---- steps 1-5: coils, field, strike lines, footprints --------------------------------------------------------
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

    # ---- steps 6-10: power, compression, target load, two-point model --------------------------------------------
    def power_shares(self, coils: Sequence[float] = (0,) * N_DIVERTERS) -> np.ndarray:
        """Step 6: u_k = mean_c(s_k[c]); a coil on lowers its divertor's weight by 1 - eta (renormalised below),
        f_k = 1 - eta c_k, P_k = P_heat (1 - f_rad) u_k f_k (sum_m u_m) / (sum_m u_m f_m) (MW), uniform heating.
        The sum over k is P_heat (1 - f_rad) whatever the coils."""
        p = self.inp.params
        u = [float(self.sector[k].mean()) for k in range(N_DIVERTERS)]
        f = [1 - p["shareShift"] * float(coils[k]) for k in range(N_DIVERTERS)]
        total = u[0]
        weighted = u[0] * f[0]
        for k in range(1, N_DIVERTERS):
            total = total + u[k]
            weighted = weighted + u[k] * f[k]
        if not weighted > 0:  # no heating reaches the edge: nothing to share
            return np.zeros(N_DIVERTERS)
        return np.array([p["Pheat"] * (1 - p["fRad"]) * u[k] * f[k] * total / weighted for k in range(N_DIVERTERS)])

    def compression(self, B: np.ndarray, a: np.ndarray) -> np.ndarray:
        """Step 7: b_k = |B| at the strike line on plane j_k (linear in theta between grid nodes) / B_0."""
        ts = self.strike_lines(a)
        out = []
        for k in range(N_DIVERTERS):
            x = ts[k] / self.dtheta
            i0 = math.floor(x)
            fr = x - i0
            row = B[self.j_k[k]]
            out.append(((1 - fr) * row[i0 % self.inp.n_theta] + fr * row[(i0 + 1) % self.inp.n_theta]) / self.inp.params["B0"])
        return np.array(out)

    def target_loads(self, shares: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Step 8: peak target heat flux q_t,k = P_k b_k / A_wet (MW/m^2)."""
        return shares * b / self.inp.params["wettedArea"]

    def strip_loads(self, q_t: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Step 9: Q_k[i] = q_t,k * g(wrap(theta_i - theta_s,k), sigma_theta / b_k) (MW/m^2); (4, nTheta). The flux tube
        narrows as 1/B, so the strip deposits exactly P_k: sum_i Q_k[i] dtheta * A_wet / (sqrt(2 pi) sigma_theta)."""
        ts = self.strike_lines(a)
        s = self.inp.params["sigmaTheta"]
        return np.stack([q_t[k] * gauss(wrap(self.theta - ts[k]), s / b[k]) for k in range(N_DIVERTERS)])

    def two_point(self, q_t: float) -> tuple[float, float]:
        """Step 10: (T_u, T_t) in keV from the peak target load q_t (MW/m^2): q_par = q_t MW / sin(alpha),
        X = nu q_par L_c / kappa_0, T_u = X^(1/nu), then N_2pt times: c = 2 q_par / (gamma n_u keV T_u),
        T_t = m_i amu c^2 / (2 keV), T_u = (T_t^nu + X)^(1/nu). No power, no plasma: (0, 0)."""
        p = self.inp.params
        q_par = q_t * p["MW"] / math.sin(p["incidence"])
        if not q_par > 0:
            return 0.0, 0.0
        nu = p["conductionExponent"]
        x = nu * q_par * p["connectionLength"] / p["kappa0"]
        t_u = x ** (1 / nu)
        t_t = 0.0
        for _ in range(int(p["twoPointIterations"])):
            c = 2 * q_par / (p["sheathGamma"] * p["nSep"] * p["keV"] * t_u)
            t_t = p["ionMass"] * p["amu"] * c * c / (2 * p["keV"])
            t_u = (t_t ** nu + x) ** (1 / nu)
        return t_u, t_t

    def solve(self, n: int, coils: Sequence[int]) -> dict:
        """Steps 1-10 at t_n for these coils (cached per (n, coils))."""
        key = (n, tuple(float(c) for c in coils))
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        a = self.coil_drive(coils, self.time(n))
        B = self.field(a)
        b = self.compression(B, a)
        q_t = self.target_loads(self.power_shares(coils), b)
        tp = [self.two_point(float(q)) for q in q_t]
        out = {"a": a, "B": B, "b": b, "q_t": q_t, "Tu": np.array([u for u, _ in tp]), "Tt": np.array([t for _, t in tp])}
        if len(self._cache) > 64:
            self._cache.clear()
        self._cache[key] = out
        return out

    def lcfs_temperature(self, n: int, coils: Sequence[int]) -> np.ndarray:
        """Step 12: T_u(c) = sum_k s_k(phi_j) T_u,k; along a conducting field line T^nu falls linearly to the target, so
        T(c) = (max(0, 1 - sum_k g_k[c]) T_u(c)^nu + sum_k g_k[c] T_t,k^nu)^(1/nu): upstream away from the footprints,
        the target temperature at their centre."""
        sol = self.solve(n, coils)
        nu = self.inp.params["conductionExponent"]
        g = self.footprints(sol["a"])
        t_up = (self.sector * sol["Tu"][:, None]).sum(axis=0)[:, None] * np.ones((1, self.inp.n_theta))
        g_sum = g[0]
        cold = g[0] * sol["Tt"][0] ** nu
        for k in range(1, N_DIVERTERS):
            g_sum = g_sum + g[k]
            cold = cold + g[k] * sol["Tt"][k] ** nu
        return (np.maximum(1.0 - g_sum, 0.0) * t_up ** nu + cold) ** (1 / nu)

    # ---- the step ---------------------------------------------------------------------------------------------------
    def initial_state(self) -> State:
        p = self.inp.params
        off = (0,) * N_DIVERTERS
        n_z = int(p["tileCells"])
        return State(0, self.lcfs_temperature(0, off), np.full((N_DIVERTERS, self.inp.n_theta), p["Tcool"]),
                     np.full((N_DIVERTERS, self.inp.n_theta, n_z), p["Tcool"]))

    def time(self, n: int) -> float:
        return n * self.inp.params["dt"]

    def step(self, st: State, coils: Sequence[int]) -> State:
        """One step n -> n+1: tiles from the loads at t_n (step 11); T of the new state at t_(n+1) (step 12)."""
        p = self.inp.params
        sol = self.solve(st.n, coils)
        loads = self.strip_loads(sol["q_t"], sol["a"], sol["b"])
        slab, tiles = self.conduct(st.slab, loads)  # 11
        return State(st.n + 1, self.lcfs_temperature(st.n + 1, coils), tiles, slab)

    # ---- step 11: the tiles ---------------------------------------------------------------------------------------
    def conductivity(self, T):
        """k(T) = k_ref / (1 + (T - T_ref)/T_k) (W m^-1 K^-1)."""
        p = self.inp.params
        return p["kRef"] / (1 + (T - p["Tref"]) / p["kScale"])

    def heat_capacity(self, T):
        """c(T) = c_inf - (c_inf - c_ref) exp(-(T - T_ref)/T_c) (J kg^-1 K^-1)."""
        p = self.inp.params
        return p["cpHigh"] - (p["cpHigh"] - p["cpRef"]) * np.exp(-(T - p["Tref"]) / p["cpScale"])

    def conduct(self, slab: np.ndarray, loads: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Step 11: one explicit conduction step through the tile thickness, cell-centred, dz = d/N_z. The load
        q = Q MW (W/m^2) enters cell 0; neighbours exchange G (T_j - T_j+1), G = 2 k_j k_j+1 / (dz (k_j + k_j+1));
        the last cell loses (T - T_cool) / (dz/(2k) + R_sink) to the water; each cell rho c(T) dz dT/dt = net.
        Returns the new slab and the surface temperature T_0 + q dz / (2 k(T_0)) of the new slab."""
        p = self.inp.params
        dz = p["tileThickness"] / p["tileCells"]
        q = loads * p["MW"]
        k = self.conductivity(slab)
        g = 2 * k[..., :-1] * k[..., 1:] / (dz * (k[..., :-1] + k[..., 1:]))
        flux = g * (slab[..., :-1] - slab[..., 1:])
        sink = (slab[..., -1] - p["Tcool"]) / (dz / (2 * k[..., -1]) + p["sinkResistance"])
        net = np.zeros_like(slab)
        net[..., 0] = q
        net[..., :-1] = net[..., :-1] - flux
        net[..., 1:] = net[..., 1:] + flux
        net[..., -1] = net[..., -1] - sink
        new = slab + p["dt"] * net / (p["tileDensity"] * self.heat_capacity(slab) * dz)
        surface = new[..., 0] + q * dz / (2 * self.conductivity(new[..., 0]))
        return new, surface

    def sink_flux(self, slab: np.ndarray) -> np.ndarray:
        """Heat flux into the water (W/m^2) per strip cell."""
        p = self.inp.params
        dz = p["tileThickness"] / p["tileCells"]
        return (slab[..., -1] - p["Tcool"]) / (dz / (2 * self.conductivity(slab[..., -1])) + p["sinkResistance"])

    # ---- diagnostics ------------------------------------------------------------------------------------------------
    def heat_flux_loads(self, st: State, coils: Sequence[int]) -> np.ndarray:
        """Q_k[i] from the coils at the state's time t_n (steps 1-9); (4, nTheta)."""
        sol = self.solve(st.n, coils)
        return self.strip_loads(sol["q_t"], sol["a"], sol["b"])

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
        """The explicit conduction step's number: dt * (largest total outflow conductance of a cell) / (rho c dz),
        with k and c at T_ref (k falls and c rises with temperature, so above T_ref this bounds every cell). An inner
        cell has 2k/dz, the back cell k/dz + 1/(dz/(2k) + R_sink); the update is monotone while the number is <= 1."""
        p = self.inp.params
        dz = p["tileThickness"] / p["tileCells"]
        inner = 2 * p["kRef"] / dz
        back = p["kRef"] / dz + 1 / (dz / (2 * p["kRef"]) + p["sinkResistance"])
        return p["dt"] * max(inner, back) / (p["tileDensity"] * p["cpRef"] * dz)

    def check_stability(self) -> float:
        """The tile update is monotone when its number is <= 1; the coil perturbation must keep |B| positive."""
        p = self.inp.params
        b_min = self.b_s * (1.0 - p["epsilon"] * self.h.sum(axis=0))
        if not np.all(b_min > 0):
            raise ValueError("the coil perturbation drives |B| to zero")
        number = self.stability_number()
        if not 0 < number <= 1:
            raise ValueError(f"unstable parameters: conduction number {number:.4g} not in (0, 1] (MODEL.md)")
        if not (p["Tcool"] >= p["Tref"] and p["tileCells"] >= 2 and float(p["tileCells"]).is_integer()):
            raise ValueError("the tiles need T_cool >= T_ref (the stability bound) and a whole number (>= 2) of cells")
        if not 0 <= p["shareShift"] < 1:
            raise ValueError("shareShift must lie in [0, 1): a coil cannot shed all of its divertor's power")
        if not p["sinkResistance"] >= 0:
            raise ValueError("the heat-sink resistance must not be negative")
        # The fixed N_2pt iterations converge while the layer is conduction-limited (the map's slope -2(T_t/T_u)^nu
        # stays small); far beyond, they oscillate. Check the result at the operating loads, every coil off and every
        # coil on: the sheath with pressure balance must hold, q_par = gamma n_t keV T_t c_s(T_t), to 1e-6.
        for coils in ((0,) * N_DIVERTERS, (1,) * N_DIVERTERS):
            sol = self.solve(0, coils)
            for q_t, t_u, t_t in zip(sol["q_t"], sol["Tu"], sol["Tt"], strict=True):
                if not t_u > 0:
                    continue
                q_par = q_t * p["MW"] / math.sin(p["incidence"])
                c_s = math.sqrt(2 * t_t * p["keV"] / (p["ionMass"] * p["amu"]))
                sheath = p["sheathGamma"] * (p["nSep"] * t_u / (2 * t_t)) * p["keV"] * t_t * c_s
                if not abs(sheath / q_par - 1) < 1e-6:
                    raise ValueError("two-point iteration not converged at the operating loads (sheath residual)")
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
