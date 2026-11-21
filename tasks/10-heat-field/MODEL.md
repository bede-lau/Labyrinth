# Illustrative edge heat model, version 1 (D-027)

**What this is.** A reduced model chosen to illustrate the owner's loop (heat map → predicted heat movement → change
the magnetic field → new heat map) on the **real** W7-X geometry and |B| of `wout_w7x_kjm.nc`. Its parameters are
chosen for illustration, not fitted to measurements. It is **not** a simulation of W7-X, its diverter positions are
schematic (the owner's four; W7-X has ten divertor units) and its "control coils" are not a validated coil response
(PRD: that remains a later milestone). Every number it produces is labelled `model`.

**Where it runs.** `main/labyrinth_main/features/heatfield/model.py` is the reference implementation; it writes
the parameters, the grids it reads and golden checkpoints into `artifacts/heatfield.json`.
`renderer/src/features/heatfield/model.ts` is a port that reads **everything** (grids, ι, parameters, probes) from the
artifact and must reproduce every golden checkpoint to `model.golden.relativeTolerance`. The two must follow this
document exactly; a change here changes both implementations and the golden values together.

## Grid and inputs

- `nTheta = 48`, `nPhi = 72`. θ_i = 2πi/48 (VMEC θ; θ = π/2 is the top), φ_j = 2πj/72 (geometric toroidal angle).
  dθ = 2π/nTheta, dφ = 2π/nPhi. Every index is periodic: `i mod nTheta`, `j mod nPhi`. Flat index c = j·nTheta + i.
- Surfaces ρ_m = m/8, m = 0…8 (s = ρ²), R, Z (m) and |B| (T) on the grid from the existing VMEC reader
  (`geometry/vmec.py`, stella's radial interpolation; ρ = 0 is the axis, ρ = 1 the LCFS; |B| at both ends uses the
  reader's half-grid extrapolation, as stella does).
- The model lives on the LCFS (m = 8). **B_s[c]** is its |B| and **ι** its iota **exactly as written to the artifact**
  (7 significant figures, `common/io.py`); the reference model must consume those rounded values, so both
  implementations start from identical inputs. Parameters are likewise used as written.
- Diverters k = 0…3 (D1…D4) at φ_k = kπ/2, i.e. on grid planes j_k = k·nPhi/4.

## Parameters (artifact `model.parameters`; values are the starting point, see "Tuning")

| Name | Symbol | Value | Unit | Meaning |
|---|---|---|---|---|
| Tped | T_ped | 1.0 | keV | edge temperature the core supplies (no sinks) |
| Tcore0 | T_0 | 3.0 | keV | core temperature on axis (cross-sections only) |
| rhoBlend | ρ_b | 0.7 | – | inside ρ_b the cross-section shows the core profile only |
| tauE | τ_E | 0.5 | s | relaxation time towards T_ped |
| Dpar | D_∥ | 2.5 | rad²/s | diffusivity along the field line (per radian of φ) |
| Dperp0 | D_⊥0 | 0.2 | rad²/s | cross-field (θ) diffusivity at B = B0 |
| B0 | B_0 | 2.5 | T | reference field |
| tauDiv | τ_div | 0.02 | s | exhaust time at the centre of a diverter footprint |
| Ttarget | T_t | 0.01 | keV | plasma temperature at the target |
| sigmaPhi | σ_φ | 0.06 | rad | footprint width in φ |
| sigmaTheta | σ_θ | 0.12 | rad | footprint width in θ |
| sweepAmplitude | A_s | 0.30 | rad | strike-line excursion when a coil is on |
| sweepFrequency | f | 2.0 | Hz | coil (sweep) frequency |
| epsilon | ε | 0.03 | – | relative |B| perturbation of one coil at its centre |
| sigmaCoilPhi | σ_cφ | 0.20 | rad | coil envelope width in φ |
| sigmaCoilTheta | σ_cθ | 0.60 | rad | coil envelope width in θ |
| heatFluxScale | W_q | 0.2 | MW m⁻² per keV s⁻¹ | converts exhaust rate into target heat flux |
| tileGain | K | 100 (tuned: 165, D-028) | °C per MW m⁻² | steady tile temperature rise per unit heat flux |
| Tcool | T_cool | 30 | °C | coolant / cold tile temperature |
| tauTile | τ_tile | 1.0 | s | tile thermal time constant |
| tileLimit | T_lim | 1200 | °C | illustrative tile surface limit |
| dt | Δt | 0.001 | s | time step |
| spinup | t_spin | 3.0 | s | the view starts from the state after this time with every coil off |

`diverters.thetaCentre` = θ_d = π/2 (the strike line's unswept θ; the top), `diverters.halfWidthTheta` = 0.35 rad
(drawing only). The θ_d used by the model is the artifact value.

## State and initial condition

- T[c] (keV) on the LCFS grid; initial T = T_ped everywhere.
- Tile strips: for each diverter k, Tt_k[i] (°C), i = 0…nTheta−1 (the target strip along θ at φ_k); initial T_cool.
- Coil switches c_k ∈ {0, 1}; time t_n = n·Δt, n counted from the initial condition (the coil phase uses this t).
- Coil state at step n (D-028): the coil-schedule entry with the largest `fromStep` ≤ n. It drives step n → n+1 and is also the coil
  state for the diagnostics of the state after n steps. φ_k is `diverters.items[k].phi` as written in the artifact.

## One step, n → n+1 (every right-hand side uses the state at t_n)

Let `wrap(x) = x − 2π·floor(x/(2π) + 0.5)` and `g(x, σ) = exp(−x²/(2σ²))`.

1. Coil drive: a_k = c_k·cos(2π f t_n).
2. Coil envelope: h_k[c] = g(wrap(φ_j − φ_k), σ_cφ)·g(wrap(θ_i − θ_d), σ_cθ).
3. Field: B[c] = B_s[c]·(1 + ε Σ_k a_k h_k[c]).
4. Strike line: θ_s,k = θ_d + A_s·a_k.
5. Footprint: g_k[c] = g(wrap(φ_j − φ_k), σ_φ)·g(wrap(θ_i − θ_s,k), σ_θ).
6. Cross-field diffusivity: D⊥[c] = D_⊥0·(B_0/B[c])².
7. Parallel term (field-line pitch ι, λ neglected): σ = ι·dφ/dθ (cells), p = floor(σ), w = σ − p.
   T₊[i,j] = (1−w)·T[i+p, j+1] + w·T[i+p+1, j+1]; T₋[i,j] = (1−w)·T[i−p, j−1] + w·T[i−p−1, j−1];
   P[c] = D_∥·(T₊ − 2T + T₋)/dφ².
8. Cross-field term (conservative): D⁺ = (D⊥[i,j] + D⊥[i+1,j])/2, D⁻ = (D⊥[i,j] + D⊥[i−1,j])/2;
   X[c] = (D⁺·(T[i+1,j] − T[i,j]) − D⁻·(T[i,j] − T[i−1,j]))/dθ².
9. Source S[c] = (T_ped − T[c])/τ_E; sink L[c] = Σ_k g_k[c]·(T[c] − T_t)/τ_div.
10. Heat flux onto diverter k: q_k[c] = W_q·(B[c]/B_0)·g_k[c]·(T[c] − T_t)/τ_div (MW/m²);
    strip load Q_k[i] = Σ_j q_k[i,j]·dφ/(√(2π)·σ_φ).
11. Tiles: Tt_k[i] ← Tt_k[i] + Δt·(T_cool + K·Q_k[i] − Tt_k[i])/τ_tile.
12. Plasma: T[c] ← T[c] + Δt·(P + X + S − L)[c].

The continuous equation this discretises (shown in the view):

∂T/∂t = D_∥ ∂²T/∂ℓ² + ∂/∂θ(D_⊥(B) ∂T/∂θ) + (T_ped − T)/τ_E − Σ_k g_k(θ, φ, t)·(T − T_t)/τ_div,
with ∂/∂ℓ = ∂/∂φ + ι ∂/∂θ, D_⊥(B) = D_⊥0·(B_0/B)², B = B_VMEC·(1 + ε Σ_k a_k(t) h_k), a_k = c_k cos(2πft),
θ_s,k(t) = θ_d + A_s a_k(t); tiles τ_tile dT_tile/dt = T_cool + K·Q_k − T_tile.

Stability: every update weight is non-negative (the step is monotone, so T stays between T_t and T_ped) when
Δt·(2D_∥/dφ² + 2·max D⊥/dθ² + 1/τ_E + max Σ_k g_k/τ_div) ≤ 1. With the table's values this is ≈ 0.74; the reference
asserts it for the chosen parameters (max over the coil-perturbed field).

## Diagnostics (functions of a state and its time t)

- `meanT` = arithmetic mean of T over all cells.
- `peakTileC[k]` = max_i Tt_k[i].
- `peakHeatFlux[k]` = max_i Q_k[i], with Q_k evaluated from the state and the coils at that t (steps 1–5, 10).
- Heat-flow vector (renderer only, not golden): F_φ = −D_∥·(T₊ − T₋)/(2dφ), F_θ = ι·F_φ − D⊥·(T[i+1] − T[i−1])/(2dθ),
  in angle space; mapped to 3D with the grid tangents ∂r/∂φ, ∂r/∂θ.

## Cross-section fields (renderer; from the same state)

At plane j, surface m (ρ_m): T_xs = T_core(ρ_m) + w(ρ_m)·(T[i,j] − T_ped), T_core(ρ) = T_ped + (T_0 − T_ped)(1 − ρ²)²,
w(ρ) = (max(0, (ρ − ρ_b)/(1 − ρ_b)))². |B|_xs = B_m[c]·(1 + ρ_m² ε Σ_k a_k h_k[c]). At ρ = 1 both equal the LCFS values.

## Golden checkpoints (artifact `model.golden`)

Probes [i, j]: [12, 0], [12, 18], [12, 36], [12, 54], [0, 0], [24, 9], [36, 27], [6, 45].
Scenarios (all from the initial condition, step 0):
- `coils-off`: coils [0,0,0,0]; checkpoints at steps 250, 1000, 3000.
- `coils-D1-D3`: coils [1,0,1,0]; checkpoints at steps 250, 1000, 3000.
- `switch-at-1s`: [0,0,0,0] from step 0, [1,1,1,1] from step 1000; checkpoints at steps 1000, 1500, 3000.
Each checkpoint records `step`, `t`, `probesT`, `meanT`, `peakTileC`, `peakHeatFlux` of the state after `step` steps.
`relativeTolerance` = 2e-6 (the artifact rounds to 7 significant figures); a renderer test reproduces all of them.

## Tuning (backend, once; then frozen)

The illustration must show both regimes, so `heatFluxScale` and `tileGain` (only these two) may be changed from the
values above. Requirements, checked by tests and recorded in `model.limitations`:
- `coils-off` at step 3000 (= the view's starting state): at least one diverter's peak tile temperature is above
  `tileLimit` and at least one is below it.
- all coils on from step 0 (a test scenario, not necessarily golden): every peak tile temperature is below
  `tileLimit` at step 3000.
- The stability condition above holds (≤ 1).
The chosen values are written to the artifact; MODEL.md's table is the starting point, the artifact is the truth.
Outcome (D-028): `tileGain` 165, `heatFluxScale` 0.2. Coils off at 3 s: D1 1320, D2 1115, D3 1106, D4 1315 °C; all coils on
from 0 s: D1 575, D2 486, D3 473, D4 573 °C. Stability number 0.7355.
