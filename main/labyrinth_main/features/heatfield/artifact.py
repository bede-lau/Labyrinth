"""Artifact ``heatfield.json`` (contract ``heatfield.schema.json``): Heat & field (task 10, D-027).

Real data (provenance kind ``derived``): VMEC surfaces, LCFS field lines. Model output (kind ``model``): the illustrative
edge heat model of tasks/10-heat-field/MODEL.md, its parameters and golden checkpoints. The model is run on its inputs
exactly as this artifact writes them (7 significant figures, ``common.io.normalize``), so the renderer's port starts from
identical numbers.
"""
from __future__ import annotations

from ... import __version__
from ...common import io, paths
from ...common.provenance import STELLA_COMMIT, provenance, source
from ..geometry.artifact import WOUT_URL
from ..geometry.vmec import VmecEquilibrium
from . import grids, model

ARTIFACT_ID = "heatfield"
SCHEMA = "heatfield.schema.json"

RUNTIME = "not recorded (artifact is byte-deterministic; no wall-clock values are stored)"
MODEL_SPEC = "tasks/10-heat-field/MODEL.md"

MODEL_NAME = "Two-point scrape-off layer and conducting CFC tiles, energy conserved (MODEL.md version 7)"
MODEL_VERSION = 8
SUMMARY = (
    "Edge heat model on the last closed flux surface (LCFS) of the real W7-X VMEC equilibrium. A fixed heating power "
    "(7.5 MW, 30 % radiated) crosses the LCFS and leaves through four schematic divertors: each takes the power of its "
    "toroidal sector, compressed by |B| at its strike line, onto its wetted target area, so the power on the targets is "
    "exactly the heating power less the radiated part. The textbook two-point model (Spitzer parallel conduction along "
    "the field lines, sheath at the target, pressure balance) gives each divertor's upstream and target temperature, "
    "and the LCFS sits at the upstream temperature while the plates show the target temperature. The core "
    "temperature follows from the ISS04 energy confinement time at the heating power. Control coils perturb |B| and "
    "sweep each strike "
    "line, spreading the load over the tile strip. Each tile is 6 mm of CFC armour that conducts the heat through its "
    "thickness, with temperature-dependent conductivity and heat capacity, into a water-cooled copper heat sink. The "
    "heating, transport, sheath and tile-material inputs are W7-X orders of magnitude; the strip width and coil-sweep "
    "parameters remain illustrative. The operating point is a high-power "
    "case (with every coil off the peak load passes the 10 MW/m² target design load at the two divertors with the "
    "higher |B|). Not fitted, not a simulation of W7-X, and every number it gives is labelled model."
)
EQUATIONS = [
    {"id": "power",
     "text": "P_k = P_heat·(1 − f_rad)·u_k·f_k·Σ_m u_m / Σ_m u_m·f_m,  u_k = mean(s_k),  f_k = 1 − η·c_k,  "
             "s_k(φ) = G_k / Σ_m G_m,  G_k = g(φ − φ_k, π/N_div)",
     "meaning": "Governing equation (used to predict how the heat moves): energy conservation. The heating power that "
                "is not radiated leaves through the divertors, each taking the share of its toroidal sector; a coil that "
                "is on moves the island and lowers its divertor's weight by 1 − η, and the shares are renormalised so "
                "the total never changes (one coil alone sheds ~24 %, every coil on moves nothing); the two-point "
                "model below turns each share into the target load and the edge temperatures."},
    {"id": "target-load",
     "text": "q_t,k = P_k·b_k/(A_wet·w_k),  Q_k(θ) = q_t,k·g(θ − θ_s,k(t), σ_θ·w_k/b_k),  b_k = B_k/B_0,  "
             "w_k = (T_u,k/T_λ)^e_λ  (e_λ = −5/4)",
     "meaning": "Peak heat flux on target k (MW/m²): its power on the wetted area, compressed with |B| at the strike "
                "line (a flux tube's cross-section shrinks as 1/B); spread along the tile strip around the strike line, "
                "narrowed as 1/B, so the strip deposits exactly P_k. The footprint width follows the edge (version 8): "
                "λ_q = (χ_⊥τ_∥)^½ with the conduction-limited drain time τ_∥ ∝ L_c²n/(κ_0T_u^(5/2)), so a hotter edge gives a "
                "narrower footprint and a higher peak (a modelling choice: measured widths depend mainly on the poloidal field); solved together with the two-point model (they depend on each "
                "other)."},
    {"id": "two-point",
     "text": "q_∥ = q_t/sin α,  T_u^ν = T_t^ν + ν·q_∥·L_c/κ_0  (ν = 7/2),  q_∥ = γ·n_t·e·T_t·c_s(T_t),  2·n_t·T_t = n_u·T_u",
     "meaning": "The two-point model of the scrape-off layer: Spitzer conduction along the connection length L_c sets the "
                "upstream temperature T_u, the sheath at the target sets the target temperature T_t, and pressure is "
                "balanced along the field line (c_s = √(2eT_t/m_i))."},
    {"id": "lcfs-map",
     "text": "T_LCFS(θ, φ) = T_u(φ) = Σ_k s_k(φ)·T_u,k",
     "meaning": "The LCFS sits at the upstream temperature of its toroidal sector. The island divertor's targets lie "
                "outside the LCFS, so the two-point drop to the target temperature T_t happens in the scrape-off layer "
                "and is shown on the diverter plates, not on this surface."},
    {"id": "field",
     "text": "B = B_VMEC·(1 + ε Σ_k a_k(t) h_k(θ, φ)),  a_k(t) = c_k cos(2πft),  h_k = g(φ − φ_k, σ_cφ)·g(θ − θ_d, σ_cθ)",
     "meaning": "|B| of the VMEC equilibrium with the illustrative perturbation of control coil k at diverter k "
                "(c_k = 1 while its toggle is on); h_k is the coil's envelope."},
    {"id": "strike-line",
     "text": "θ_s,k(t) = θ_d + A_s·a_k(t)",
     "meaning": "A coil that is on sweeps its diverter's strike line up and down the target at frequency f, spreading "
                "the load (strike-point sweeping)."},
    {"id": "core",
     "text": "τ_E = C·a^α_a·R^α_R·P_heat^α_P·(n̄/n_unit)^α_n·B_0^α_B·ι_2/3^α_ι,  τ_E·P_heat = 3·n̄·⟨T⟩·V,  "
             "T_0 = T_e + 3(⟨T⟩ − T_e)",
     "meaning": "Core temperature from energy confinement: the ISS04 stellarator scaling gives the energy confinement "
                "time, the stored energy is the heating power times it, and with a flat density the volume-mean "
                "temperature ⟨T⟩ follows (V = 2π²Ra²); the profile T_e + (T_0 − T_e)(1 − ρ²)² gives the axis "
                "temperature T_0 (cross-sections; T_e the mean upstream temperature). g(x, σ) = exp(−x²/(2σ²))."},
    {"id": "tiles",
     "text": "ρ·c(T)·∂T/∂t = ∂/∂z(k(T)·∂T/∂z), −k ∂T/∂z = Q·MW at z = 0, −k ∂T/∂z = (T − T_cool)/R_sink at z = d",
     "meaning": "Heat conduction through the CFC tile of diverter k (depth z, every θ cell of its strip): the load "
                "enters the surface, the water-cooled heat sink takes it away at the back; k(T) falls and c(T) rises "
                "with temperature as for NB31 CFC. The surface temperature is compared with the tile limit T_lim."},
]


def discretization(stability: float) -> str:
    return (
        "LCFS grid of `grid` (nTheta θ × nPhi φ; every index periodic, i mod nTheta and j mod nPhi; cell c = j·nTheta + i), "
        "θ_i = 2πi/nTheta, φ_j = 2πj/nPhi, dθ = 2π/nTheta, dφ = 2π/nPhi. Inputs exactly as written in this artifact: "
        "B_s = surfaces[last].B (LCFS |B|, T), φ_k = diverters.items[k].phi, θ_d = diverters.thetaCentre, every parameter "
        "= model.parameters[name].value. wrap(x) = x − 2π·floor(x/(2π) + 0.5); g(x, σ) = exp(−x²/(2σ²)). t_n = n·Δt with n "
        "counted from the initial condition; the coils c_k of step n are those of the coil-schedule entry with the "
        "largest fromStep ≤ n. The edge is quasi-steady (its time scales, microseconds, are far below Δt): at t_n and for "
        "coils c: (1) a_k = c_k·cos(2πf·t_n); (2) h_k[c] = g(wrap(φ_j − φ_k), σ_cφ)·g(wrap(θ_i − θ_d), σ_cθ); "
        "(3) B[c] = B_s[c]·(1 + ε·Σ_k a_k·h_k[c]); (4) θ_s,k = θ_d + A_s·a_k; "

        "(6) s_k[j] = G_k[j]/Σ_m G_m[j], G_k[j] = g(wrap(φ_j − φ_k), π/N_div), u_k = mean_c s_k, f_k = 1 − η·c_k, "
        "P_k = P_heat·(1 − f_rad)·u_k·f_k·(Σ_m u_m)/(Σ_m u_m·f_m) (MW, sums in order m = 0…3); "
        "(7) j_k = round(φ_k/dφ) mod nPhi, x = θ_s,k/dθ, i₀ = floor(x), w = x − i₀, "
        "B_k = (1 − w)·B[j_k, i₀] + w·B[j_k, i₀+1], b_k = B_k/B_0; (8) q_t,k = P_k·b_k/(A_wet·w_k) (MW/m²); "
        "(8b) w_k = (T_u,k/T_λ)^e_λ (1 with no plasma); (9) Q_k[i] = q_t,k·g(wrap(θ_i − θ_s,k), σ_θ·w_k/b_k); "
        "(10) q_∥ = q_t,k·MW/sin α (W/m²; no power: q_t = T_u = T_t = 0, w = 1), X = ν·q_∥·L_c/κ_0, T_u = X^(1/ν) "
        "from w_k = 1, then N_2pt times: c = 2·q_∥/(γ·n_u·keV·T_u), T_t = m_i·amu·c²/(2·keV), "
        "T_u = (T_t^ν + X)^(1/ν) (keV), then w_k (8b), q_t,k (8), q_∥ and X with the new w_k (8, 8b, 10 solved together). One step n → n+1: (11) every strip cell k, i holds N_z tile cells "
        "S[z] (°C, z = 0 at the surface), dz = d/N_z, k(T) = k_ref/(1 + (T − T_ref)/T_k), "
        "c(T) = c_∞ − (c_∞ − c_ref)·exp(−(T − T_ref)/T_c), q = Q_k[i]·MW (W/m²) with Q_k at t_n and the coils of step n; "
        "G_z = 2·k_z·k_(z+1)/(dz·(k_z + k_(z+1))), F_z = G_z·(S[z] − S[z+1]), sink = (S[N_z−1] − T_cool)/(dz/(2k_(N_z−1)) + "
        "R_sink); net[0] = q, net[z] −= F_z, net[z+1] += F_z, net[N_z−1] −= sink (in that order); "
        "S[z] ← S[z] + Δt·net[z]/(ρ·c(S[z])·dz), with k and c of the old S; the surface temperature "
        "Tt_k[i] = S[0] + q·dz/(2·k(S[0])) from the new S[0]; (12) the new state's LCFS temperature at t_(n+1) with the same coils, "
        "T[c] = T_u[j] = Σ_k s_k[j]·T_u,k (the LCFS at the upstream temperature). The initial state: "
        "every tile cell and surface T_cool, T from (12) at t_0 with every coil off. "
        "Diagnostics of the state after n steps (golden checkpoints): t = n·Δt; probesT = T at each model.probes [i, j]; "
        "meanT = arithmetic mean of T over all cells; peakTileC[k] = max_i Tt_k[i]; peakHeatFlux[k] = max_i Q_k[i] at t_n "
        "with the coils of step n. Stability: the only explicit update is the tile conduction, monotone when "
        "Δt·max(2k_ref/dz, k_ref/dz + 1/(dz/(2k_ref) + R_sink))/(ρ·c_ref·dz) ≤ 1 (inner and back cell; k and c at T_ref "
        f"bound every cell above T_ref ≤ T_cool); here {stability:.4f}."
    )


def geometry_details(axis_b_spread: float, axis_b_mean: float) -> str:
    return (
        "No external reference for these grids exists in this repo. They are evaluated with the VMEC reader and "
        "straight-field-line tracer that geometry.json validates against stella's saved rho 0.7 output (stella's radial "
        "interpolation; |B| and iota at rho 0 and rho 1 use its half-grid extrapolation). On the magnetic axis (rho 0) R "
        "and Z do not depend on theta, but |B| does: that extrapolation leaves the m > 0 |B| modes non-zero at s = 0, so "
        f"within one phi plane the axis |B| varies with theta by up to {axis_b_spread:.3f} T "
        f"({100 * axis_b_spread / axis_b_mean:.1f} % of its mean {axis_b_mean:.2f} T); its theta mean on each plane is "
        "the m = 0 part. The diverter positions are schematic (the owner's four), not W7-X data."
    )


def _tiles(values) -> str:
    return ", ".join(f"D{k + 1} {v:.0f} °C" for k, v in enumerate(values))


def limitations(reg: dict, params: dict) -> str:
    limit = reg["limit"]
    above = [f"D{k + 1}" for k, v in enumerate(reg["off"]) if v > limit]
    below = [f"D{k + 1}" for k, v in enumerate(reg["off"]) if v < limit]
    changed = [n for n in model.TUNED if params[n] != model.MODEL_MD_START[n]]
    kept = [n for n in model.TUNED if n not in changed]
    tuned = ("; ".join(f"{n} changed from MODEL.md's starting value {model.MODEL_MD_START[n]:g} to {params[n]:g}" for n in changed)
             or "both kept at MODEL.md's starting values")
    if changed and kept:
        tuned += "; " + ", ".join(f"{n} kept at {params[n]:g}" for n in kept)
    return (
        "Reduced model, not a simulation of W7-X. The heating power, radiated fraction, wetted area, connection length, "
        "Spitzer coefficient, sheath coefficient, separatrix density and incidence angle are W7-X orders of magnitude; "
        "the tile armour (6 mm CFC NB31) and the 30 °C cooling water follow the W7-X target elements, the material fits "
        "are approximate and the heat-sink resistance is an effective lumped value, not calibrated; the strip width at T_λ and the coil perturbation and sweep remain illustrative (since version 8 the width follows the edge temperature as T_u^(−5/4), a conduction-limited scrape-off layer with a fixed cross-field diffusivity; measured widths depend mainly on the poloidal field). "
        "The parameters are not fitted to measurements, and the model is not verified against measurements or a W7-X "
        "simulation (this repo holds no measured or simulated W7-X temperature, divertor-load or coil-response data). "
        "The geometry and |B| are real (VMEC wout_w7x_kjm.nc); temperatures, heat fluxes and tile temperatures are model "
        "output. Energy is conserved by construction: the power on the targets is the heating power less the radiated "
        "fraction, and the target strip narrows as 1/B with the compression so that it deposits exactly its divertor's "
        "power (each radian of strip is A_wet/(√(2π)·σ_θ) of target area). The narrowed strip (σ_θ/b_k ≈ 0.1 rad) is "
        "finer than the θ grid (0.13 rad): while a strike line sits between nodes the sampled peak heat flux reads up "
        "to ~20–25 % below q_t (the deposited power is unaffected). "
        "The two-point model is a textbook simplification: no volume losses along the field line other than "
        "the single radiated fraction, no momentum or particle losses (no detachment), electrons only in the conduction "
        "and T_e = T_i at the sheath; the iteration is run a fixed number of times, converged while the scrape-off layer "
        "is conduction-limited (the build checks the sheath balance to 1e-6 at the operating loads; loads beyond "
        "~50 MW/m² would not converge). The power is shared between the four "
        "divertors by toroidal sector; W7-X has ten island-divertor units, so each schematic divertor here carries "
        "about 2.5 times the power of a real one. The LCFS temperature is each sector's upstream temperature: no 2D "
        "transport across the surface and no poloidal variation (the edge is quasi-steady; only the tiles evolve). The "
        "core temperature uses the ISS04 empirical scaling (renormalisation 1) with a flat density and a fixed profile "
        "shape; it is steady (W = τ_E·P_heat, no core energy dynamics in the heat view), the scaling scatters by ~15 % rms, "
        "n_i = n_e (no Z_eff dilution), and T_e is the mean upstream temperature with every coil off, not each plane's. The control-coil response is not validated: ε, the share shift η, the sweep amplitude, "
        "frequency and envelope are illustrative (the PRD keeps a validated coil response, state transfer across "
        "equilibria and matched divertor and core-energy measurements for a later milestone). Each tile cell conducts only "
        "through its depth (1D: no lateral conduction along the strip, no erosion, no radiation from the surface); the "
        "heat sink and water film are one thermal resistance without heat capacity, and the CFC fits k(T), c(T) are "
        "approximations to published NB31 data; the surface temperature extrapolates with k at the first cell's centre "
        "(a few °C below the Kirchhoff form at 16 MW/m²). The prediction is this model run ahead from the current state, not the GENE-X "
        "spatial-parallel run (D-027 §6). "
        f"Operating point (MODEL.md, Pheat and wettedArea within their stated ranges, chosen so that two divertors "
        f"pass the tile limit): {tuned}. It is a high-power case: "
        "at 6 MW or with a larger wetted area no diverter reaches the tile limit; the two divertors whose strike lines "
        "sit at the higher |B| (field compression ~1.23 against ~1.02) pass it, above the 10 MW/m² design load of the W7-X targets. With every coil off, at "
        f"{model.REGIME_STEP * params['dt']:g} s (the view's starting state) the peak tile temperatures are "
        f"{_tiles(reg['off'])}: {', '.join(above) or 'none'} above the {limit:g} °C tile limit and "
        f"{', '.join(below) or 'none'} below it. With every coil on from 0 s they are {_tiles(reg['on'])} at the same "
        f"time, {'all below the limit' if all(v < limit for v in reg['on']) else 'NOT all below the limit'}."
    )


def build() -> dict:
    eq = VmecEquilibrium(paths.WOUT_W7X_KJM)
    wout_src = source("W7-X high-mirror VMEC equilibrium wout_w7x_kjm.nc (stella test_5_fluxtube)", WOUT_URL,
                      paths.WOUT_W7X_KJM)
    # Everything the model reads, rounded exactly as the artifact writes it (common/io.py, 7 significant figures).
    data = io.normalize({
        "grid": {"nTheta": grids.N_THETA, "nPhi": grids.N_PHI, "layout": grids.LAYOUT, "angles": grids.ANGLES},
        "surfaces": grids.surfaces(eq),
        "fieldLines": grids.field_lines(eq),
        "diverters": grids.diverters(),
        "parameters": model.parameter_records(),
        "probes": [list(p) for p in model.PROBES],
    })
    inputs = model.inputs_from_artifact({**data, "model": {"parameters": data["parameters"], "probes": data["probes"]}})
    m = model.Model(inputs)
    stability = m.check_stability()
    scenarios = model.golden(m)
    reg = model.regime(m, scenarios)
    if not reg["ok"]:
        raise ValueError(f"MODEL.md regime requirements not met: coils off {reg['off']}, all on {reg['on']}, "
                         f"limit {reg['limit']}")
    dt = inputs.params["dt"]
    t_end = max(c["t"] for sc in scenarios for c in sc["checkpoints"])
    return {
        "schemaVersion": 1,
        "equilibrium": {"name": "wout_w7x_kjm", "configuration": "W7-X high-mirror (KJM)", "nfp": eq.nfp,
                        "source": wout_src},
        "grid": data["grid"],
        "surfaces": data["surfaces"],
        "fieldLines": data["fieldLines"],
        "diverters": data["diverters"],
        "model": {
            "name": MODEL_NAME,
            "version": MODEL_VERSION,
            "summary": SUMMARY,
            "equations": EQUATIONS,
            "discretization": discretization(stability),
            "parameters": data["parameters"],
            "probes": data["probes"],
            "golden": {"relativeTolerance": model.RELATIVE_TOLERANCE, "scenarios": scenarios},
            "limitations": limitations(reg, inputs.params),
        },
        "geometryProvenance": provenance(
            "derived",
            solver_revision=(f"labyrinth_main {__version__} VMEC reader and straight-field-line tracer "
                             f"(stella {STELLA_COMMIT[:8]} conventions)"),
            units=("R, Z, x, y, z in m; B = |B| in T (absolute VMEC bmnc, not normalised by B_ref); rho, s and iota "
                   "dimensionless; theta, phi and alpha in rad"),
            coverage=(f"{grids.N_RADIAL + 1} flux surfaces rho = m/{grids.N_RADIAL}, m = 0..{grids.N_RADIAL} (s = rho^2; "
                      "rho 0 the magnetic axis, rho 1 the last closed flux surface), each on "
                      f"{grids.N_THETA} VMEC theta x {grids.N_PHI} phi over the whole torus (phi-major, periodic, no "
                      f"duplicated seam); {grids.N_FIELD_LINES} field lines on the last closed flux surface, alpha = "
                      f"2 pi m/{grids.N_FIELD_LINES}, one toroidal turn phi in [0, 2 pi] with {grids.FIELD_LINE_SAMPLES} "
                      "samples each (stella convention theta* = alpha + iota*zeta)"),
            sources=[wout_src],
            outcome="not-applicable",
            details=geometry_details(*grids.axis_b_theta_spread(data["surfaces"][0]["B"])),
            runtime=RUNTIME,
        ),
        "provenance": provenance(
            "model",
            solver_revision=(f"labyrinth_main {__version__} heatfield reference model version {MODEL_VERSION} "
                             f"({MODEL_SPEC}), explicit Euler, dt = {dt:g} s"),
            units=("T (plasma temperature) in keV; tile temperatures in °C; heat flux q and strip load Q in MW/m^2; "
                   "|B| in T; t in s; angles in rad"),
            coverage=(f"last closed flux surface, {inputs.n_theta} theta x {inputs.n_phi} phi; golden scenarios "
                      f"{', '.join(sc['id'] for sc in scenarios)} from t = 0 to {t_end:g} s (steps of {dt:g} s); "
                      "regime check with every coil on to the same time"),
            t_start=0.0,
            t_end=t_end,
            sources=[wout_src, source(f"Model specification {MODEL_SPEC} (version {MODEL_VERSION}, D-027)", MODEL_SPEC)],
            outcome="not-applicable",
            details=("Reduced model, not a W7-X simulation: physics inputs are W7-X orders of magnitude, strip width, "
                     "coil and tile parameters illustrative; parameters not fitted to measurements, and not verified against measurements or a simulation of W7-X (none exist in this "
                     "repo). Its only check is internal: the renderer's TypeScript port is checked against the golden "
                     f"checkpoints of this Python reference to relativeTolerance {model.RELATIVE_TOLERANCE:g}."),
            runtime=RUNTIME,
        ),
    }
