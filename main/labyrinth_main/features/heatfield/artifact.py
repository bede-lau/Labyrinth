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

MODEL_NAME = "Illustrative edge heat model (MODEL.md version 1)"
MODEL_VERSION = 1
SUMMARY = (
    "Temperature on the last closed flux surface (LCFS) of the real W7-X VMEC equilibrium from an illustrative reduced "
    "model: diffusion along the field lines (pitch ι) and across them in θ with D⊥ ∝ (B_0/B)², relaxation towards a "
    "pedestal temperature the core supplies, exhaust at four schematic diverter footprints, and control coils that "
    "perturb |B| and sweep each strike line. The heat flux onto each diverter heats a lumped tile strip. Parameters are "
    "chosen for illustration, not fitted; this is not a simulation of W7-X and every number it gives is labelled model."
)
EQUATIONS = [
    {"id": "heat",
     "text": "∂T/∂t = D_∥ ∂²T/∂ℓ² + ∂/∂θ(D_⊥(B) ∂T/∂θ) + (T_ped − T)/τ_E − Σ_k g_k(θ, φ, t)·(T − T_t)/τ_div",
     "meaning": "Governing equation (used to predict how the heat moves): the LCFS temperature T diffuses along the field "
                "line and across it, relaxes towards the pedestal temperature the core supplies, and is exhausted at the "
                "four diverter footprints."},
    {"id": "parallel",
     "text": "∂/∂ℓ = ∂/∂φ + ι ∂/∂θ",
     "meaning": "Derivative along the field line: one toroidal radian advances ι poloidal radians (rotational transform of "
                "the LCFS; the VMEC stream function λ is neglected)."},
    {"id": "cross-field",
     "text": "D_⊥(B) = D_⊥0·(B_0/B)²",
     "meaning": "Cross-field diffusivity: a stronger field confines the heat better, so changing |B| changes where the "
                "heat flows."},
    {"id": "field",
     "text": "B = B_VMEC·(1 + ε Σ_k a_k(t) h_k(θ, φ)),  a_k(t) = c_k cos(2πft),  h_k = g(φ − φ_k, σ_cφ)·g(θ − θ_d, σ_cθ)",
     "meaning": "|B| of the VMEC equilibrium with the illustrative perturbation of control coil k at diverter k "
                "(c_k = 1 while its toggle is on); h_k is the coil's envelope."},
    {"id": "strike-line",
     "text": "θ_s,k(t) = θ_d + A_s·a_k(t)",
     "meaning": "A coil that is on sweeps its diverter's strike line up and down the target at frequency f."},
    {"id": "footprint",
     "text": "g_k(θ, φ, t) = g(φ − φ_k, σ_φ)·g(θ − θ_s,k(t), σ_θ),  g(x, σ) = exp(−x²/(2σ²))",
     "meaning": "Gaussian footprint of diverter k centred on its strike line (angles wrapped into [−π, π))."},
    {"id": "deposition",
     "text": "q_k = W_q·(B/B_0)·g_k·(T − T_t)/τ_div,  Q_k(θ) = ∫ q_k dφ/(√(2π)·σ_φ)",
     "meaning": "Heat flux onto diverter k (MW/m²) and its load along the target strip."},
    {"id": "tiles",
     "text": "τ_tile dT_tile,k/dt = T_cool + K·Q_k − T_tile,k",
     "meaning": "Lumped tile surface temperature of diverter k: relaxes to the coolant temperature plus a rise "
                "proportional to the load; compared with the illustrative tile limit T_lim."},
]


def discretization(stability: float) -> str:
    return (
        "Explicit (forward Euler) finite differences on the LCFS grid of `grid` (nTheta θ × nPhi φ; every index periodic, "
        "i mod nTheta and j mod nPhi; cell c = j·nTheta + i), θ_i = 2πi/nTheta, φ_j = 2πj/nPhi, dθ = 2π/nTheta, dφ = 2π/nPhi. "
        "Inputs exactly as written in this artifact: B_s = surfaces[last].B (LCFS |B|, T), ι = surfaces[last].iota, "
        "φ_k = diverters.items[k].phi, θ_d = diverters.thetaCentre, every parameter = model.parameters[name].value. "
        "wrap(x) = x − 2π·floor(x/(2π) + 0.5); g(x, σ) = exp(−x²/(2σ²)). State: T[c] (keV), initially T_ped everywhere; "
        "tile strips Tt_k[i] (°C, along θ at φ_k), initially T_cool; t_n = n·Δt with n counted from the initial condition. "
        "The coils c_k of step n are those of the coil-schedule entry with the largest fromStep ≤ n. "
        "One step n → n+1, every right-hand side at the state of t_n: "
        "(1) a_k = c_k·cos(2πf·t_n); "
        "(2) h_k[c] = g(wrap(φ_j − φ_k), σ_cφ)·g(wrap(θ_i − θ_d), σ_cθ); "
        "(3) B[c] = B_s[c]·(1 + ε·Σ_k a_k·h_k[c]); "
        "(4) θ_s,k = θ_d + A_s·a_k; "
        "(5) g_k[c] = g(wrap(φ_j − φ_k), σ_φ)·g(wrap(θ_i − θ_s,k), σ_θ); "
        "(6) D⊥[c] = D_⊥0·(B_0/B[c])²; "
        "(7) σ = ι·dφ/dθ (cells), p = floor(σ), w = σ − p; T₊[i,j] = (1−w)·T[i+p, j+1] + w·T[i+p+1, j+1], "
        "T₋[i,j] = (1−w)·T[i−p, j−1] + w·T[i−p−1, j−1]; P = D_∥·(T₊ − 2T + T₋)/dφ² (λ neglected); "
        "(8) D⁺ = (D⊥[i,j] + D⊥[i+1,j])/2, D⁻ = (D⊥[i,j] + D⊥[i−1,j])/2, "
        "X = (D⁺·(T[i+1,j] − T[i,j]) − D⁻·(T[i,j] − T[i−1,j]))/dθ²; "
        "(9) S = (T_ped − T)/τ_E, L = Σ_k g_k·(T − T_t)/τ_div; "
        "(10) q_k = W_q·(B/B_0)·g_k·(T − T_t)/τ_div (MW/m²), Q_k[i] = Σ_j q_k[i,j]·dφ/(√(2π)·σ_φ); "
        "(11) Tt_k[i] ← Tt_k[i] + Δt·(T_cool + K·Q_k[i] − Tt_k[i])/τ_tile; "
        "(12) T ← T + Δt·(P + X + S − L). "
        "Diagnostics of the state after n steps (golden checkpoints): t = n·Δt; probesT = T at each model.probes [i, j]; "
        "meanT = arithmetic mean of T over all cells; peakTileC[k] = max_i Tt_k[i]; peakHeatFlux[k] = max_i Q_k[i] with "
        "Q_k evaluated from that state and the coils of step n at t_n (steps 1–5 and 10). "
        "Stability: every update weight is non-negative (the step is monotone, so T stays between T_t and T_ped) when "
        "Δt·(2D_∥/dφ² + 2·max D⊥/dθ² + 1/τ_E + max Σ_k g_k/τ_div) ≤ 1, the maximum taken over every coil state "
        f"(|B| lowest where every a_k = −1); for these parameters it is {stability:.4f}."
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
        "Illustrative reduced model, not a simulation of W7-X: its parameters are chosen for illustration and are not "
        "fitted to measurements, and it is not verified against measurements or a W7-X simulation (this repo holds no "
        "measured or simulated W7-X temperature, divertor-load or coil-response data). The geometry and |B| are real "
        "(VMEC wout_w7x_kjm.nc); temperatures, heat fluxes and tile temperatures are model output. The four diverters are "
        "schematic positions from the owner's sketch; W7-X has ten island-divertor units. The control-coil response is not "
        "validated: ε, the sweep amplitude, frequency and envelope are illustrative (the PRD keeps a validated coil "
        "response, state transfer across equilibria and matched divertor and core-energy measurements for a later "
        "milestone). The parallel derivative follows the field-line pitch ι in VMEC θ with the stream function λ "
        "neglected, and cross-field transport is diffusion in θ only. The prediction is this reduced model run ahead from "
        "the current state, not the GENE-X spatial-parallel run (D-027 §6). "
        f"Tuning (MODEL.md, only heatFluxScale and tileGain may change): {tuned}. With every coil off, at "
        f"{model.REGIME_STEP * params['dt']:g} s (the view's starting state) the peak tile temperatures are "
        f"{_tiles(reg['off'])}: {', '.join(above) or 'none'} above the illustrative {limit:g} °C tile limit and "
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
            details=("Illustrative model, not a W7-X simulation: parameters chosen for illustration, not fitted to "
                     "measurements, and not verified against measurements or a simulation of W7-X (none exist in this "
                     "repo). Its only check is internal: the renderer's TypeScript port is checked against the golden "
                     f"checkpoints of this Python reference to relativeTolerance {model.RELATIVE_TOLERANCE:g}."),
            runtime=RUNTIME,
        ),
    }
