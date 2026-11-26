# Edge heat model, version 6: two-point scrape-off layer, energy conserved, conducting CFC tiles (D-027, D-031–D-035)

**What this is.** A reduced model of the owner's loop (heat map → predicted heat load → change the magnetic field →
new heat map) on the **real** W7-X geometry and |B| of `wout_w7x_kjm.nc`. Version 3 (D-032) replaces version 2's 2D
diffusion of the edge temperature with the textbook **two-point model** of the scrape-off layer at each divertor, fed by
a fixed heating power, so that **energy is conserved**: the power on the targets is the heating power less the radiated
part. The edge is **quasi-steady** (its time scales are microseconds, far below Δt); only the tiles evolve in time.
Version 4 (D-033) replaces the lumped tile (gain K, time constant τ_tile) with **heat conduction through the CFC
armour** of the W7-X target elements: 6 mm of NB31 with temperature-dependent conductivity and heat capacity, cooled at
its back through the copper heat sink by 30 °C water. The heating, transport, sheath and tile inputs are W7-X orders
of magnitude (the material fits are approximate); the footprint and coil-sweep parameters remain illustrative; nothing
is fitted to measurements. The operating point is a **high-power case** (below). It is
**not** a simulation of W7-X, its diverter positions are schematic (the owner's four; W7-X has ten divertor units, so
each one here carries about 2.5 times the power of a real one) and its "control coils" are not a validated coil
response (PRD: that remains a later milestone). Every number it produces is labelled `model`.

**Where it runs.** `main/labyrinth_main/features/heatfield/model.py` is the reference implementation; it writes
the parameters, the grids it reads and golden checkpoints into `artifacts/heatfield.json`.
`renderer/src/features/heatfield/model.ts` is a port that reads **everything** (grids, parameters, probes) from the
artifact and must reproduce every golden checkpoint to `model.golden.relativeTolerance`. The two must follow this
document exactly; a change here changes both implementations and the golden values together.

## Grid and inputs

- `nTheta = 48`, `nPhi = 72`. θ_i = 2πi/48 (VMEC θ; θ = π/2 is the top), φ_j = 2πj/72 (geometric toroidal angle).
  dθ = 2π/nTheta, dφ = 2π/nPhi. Every index is periodic: `i mod nTheta`, `j mod nPhi`. Flat index c = j·nTheta + i.
- Surfaces ρ_m = m/8, m = 0…8 (s = ρ²), R, Z (m) and |B| (T) on the grid from the existing VMEC reader
  (`geometry/vmec.py`, stella's radial interpolation; ρ = 0 is the axis, ρ = 1 the LCFS; |B| at both ends uses the
  reader's half-grid extrapolation, as stella does).
- The model lives on the LCFS (m = 8). **B_s[c]** is its |B| (and **ι** its iota, used only for the heat-flow arrows) **exactly as written to the artifact**
  (7 significant figures, `common/io.py`); the reference model must consume those rounded values, so both
  implementations start from identical inputs. Parameters are likewise used as written.
- Diverters k = 0…3 (D1…D4) at φ_k = kπ/2, i.e. on grid planes j_k = k·nPhi/4.

## Parameters (artifact `model.parameters`; the artifact writes every value to 7 significant figures, e.g. keV 1.602177e-16)

| Name | Symbol | Value | Unit | Meaning |
|---|---|---|---|---|
| Tcore0 | T_0 | 3 | keV | core temperature on axis (cross-sections only) |
| rhoBlend | ρ_b | 0.7 | – | inside ρ_b the cross-section shows the core profile only |
| B0 | B_0 | 2.5 | T | reference field |
| sigmaPhi | σ_φ | 0.06 | rad | footprint width in φ on the LCFS map (illustrative) |
| sigmaTheta | σ_θ | 0.12 | rad | footprint and strike-line width in θ (illustrative) |
| sweepAmplitude | A_s | 0.3 | rad | strike-line excursion when a coil is on (illustrative) |
| sweepFrequency | f | 2 | Hz | coil (sweep) frequency (illustrative) |
| epsilon | ε | 0.03 | – | relative |B| perturbation of one coil at its centre (illustrative) |
| sigmaCoilPhi | σ_cφ | 0.2 | rad | coil envelope width in φ (illustrative) |
| sigmaCoilTheta | σ_cθ | 0.6 | rad | coil envelope width in θ (illustrative) |
| Pheat | P_heat | 7.5 | MW | heating power crossing the LCFS (W7-X: ECRH up to ~8 MW, more with NBI) |
| fRad | f_rad | 0.3 | – | fraction of the heating power radiated before it reaches the targets |
| wettedArea | A_wet | 0.1 | m² | effective wetted target area per divertor at B_0 |
| connectionLength | L_c | 200 | m | parallel connection length, upstream to target (island divertor) |
| kappa0 | κ_0 | 6.32456e+13 | W m⁻¹ keV⁻⁷ᐟ² | Spitzer parallel conductivity coefficient (2000 W m⁻¹ eV⁻⁷ᐟ²) |
| conductionExponent | ν | 3.5 | – | Spitzer exponent: q_∥ L_c = (κ_0/ν)(T_u^ν − T_t^ν), ν = 7/2 |
| twoPointIterations | N_2pt | 20 | – | fixed iteration count of the two-point solve |
| sheathGamma | γ | 7 | – | sheath heat-transmission coefficient |
| nSep | n_u | 4e+19 | m⁻³ | upstream (separatrix) density |
| ionMass | m_i | 1 | u | ion mass (hydrogen plasma) |
| incidence | α | 0.0349066 | rad | field-line incidence angle on the target (2°) |
| keV | keV | 1.60218e-16 | J | one keV in joules (unit conversion) |
| amu | u | 1.66054e-27 | kg | atomic mass unit (unit conversion) |
| MW | MW | 1e+06 | W | one megawatt in watts (unit conversion) |
| tileThickness | d | 0.006 | m | CFC armour thickness (W7-X target elements: NB31 tiles, ~6 mm machined) |
| tileCells | N_z | 6 | – | conduction cells through the tile thickness |
| tileDensity | ρ | 1900 | kg m⁻³ | CFC NB31 density |
| kRef | k_ref | 350 | W m⁻¹ K⁻¹ | CFC conductivity through the thickness at T_ref (approximate NB31 fit) |
| kScale | T_k | 700 | °C | k(T) = k_ref/(1 + (T − T_ref)/T_k): ~170 W m⁻¹ K⁻¹ at 800 °C (approximate fit) |
| cpRef | c_ref | 710 | J kg⁻¹ K⁻¹ | graphite specific heat at T_ref |
| cpHigh | c_∞ | 2000 | J kg⁻¹ K⁻¹ | high-temperature limit of the graphite specific heat |
| cpScale | T_c | 670 | °C | c(T) = c_∞ − (c_∞ − c_ref)·exp(−(T − T_ref)/T_c): ~1600 at 800 °C (approximate fit) |
| Tref | T_ref | 20 | °C | reference temperature of the material fits |
| sinkResistance | R_sink | 4.5e-05 | m² K W⁻¹ | Cu interlayer, CuCrZr heat sink and water film per unit area (CFC/Cu interface ~1000 °C at 22 MW m⁻², near the ~1100 °C seen in W7-X element tests) |
| Tcool | T_cool | 30 | °C | cooling-water temperature (W7-X design inlet 30 °C) |
| tileLimit | T_lim | 1200 | °C | tile surface temperature limit (operational, illustrative) |
| dt | Δt | 0.001 | s | time step |
| spinup | t_spin | 3 | s | the view starts from the state after this time with every coil off |

`diverters.thetaCentre` = θ_d = π/2 (the strike line's unswept θ; the top), `diverters.halfWidthTheta` = 0.35 rad
(drawing only). The θ_d used by the model is the artifact value.

## State and initial condition

- Tile cells: for each diverter k and θ index i (the target strip along θ at φ_k), N_z cells S_k,i[z] (°C) through the
  tile thickness, z = 0 at the plasma-facing surface; initially T_cool.
- Tile surface temperatures Tt_k[i] (°C), from step 11; initially T_cool.
- T[c] (keV) on the LCFS grid: not evolved, but the quasi-steady map of step 12 at the state's own time, with the coils
  that drove the step into it (every coil off for the initial state).
- Coil switches c_k ∈ {0, 1} (amplitudes in [0, 1] while a ramp runs); t_n = n·Δt, n counted from the initial
  condition. The coils of step n are those of the coil-schedule entry with the largest `fromStep` ≤ n; they drive step
  n → n+1 and the heat-flux diagnostics of the state after n steps.

## The edge at time t_n for coils c (steps 1–10, quasi-steady)

Let `wrap(x) = x − 2π·floor(x/(2π) + 0.5)` and `g(x, σ) = exp(−x²/(2σ²))`.

1. Coil drive: a_k = c_k·cos(2π f t_n).
2. Coil envelope: h_k[c] = g(wrap(φ_j − φ_k), σ_cφ)·g(wrap(θ_i − θ_d), σ_cθ).
3. Field: B[c] = B_s[c]·(1 + ε Σ_k a_k h_k[c]).
4. Strike line: θ_s,k = θ_d + A_s·a_k.
5. Footprint on the LCFS map: g_k[c] = g(wrap(φ_j − φ_k), σ_φ)·g(wrap(θ_i − θ_s,k), σ_θ).
6. Power (energy conservation): sectors s_k[j] = G_k[j]/Σ_m G_m[j], G_k[j] = g(wrap(φ_j − φ_k), π/N_div);
   u_k = mean_c(w[c]·s_k[j]), with w ≡ 1 (a renderer scenario may supply a relative heating density w[c](t); the
   golden runs use none). Coils redistribute (version 6, D-035): f_k = 1 − η·c_k, and
   P_k = P_heat·(1 − f_rad)·u_k·f_k·(Σ_m u_m)/(Σ_m u_m·f_m) (MW; sums in order m = 0…3). A coil that is on moves its
   island and lowers its divertor's weight by 1 − η; the renormalisation hands the difference to the others in
   proportion to their shares (D1 alone keeps (1 − η)·4/(4 − η) ≈ 0.757 of its share, so sheds ~24 %); with every coil
   off or every coil on nothing moves. Σ_k P_k = P_heat·(1 − f_rad) for any coils.
7. Field compression at the strike line: j_k = round(φ_k/dφ) mod nPhi; x = θ_s,k/dθ, i₀ = floor(x), w = x − i₀;
   b_k = ((1 − w)·B[j_k, i₀] + w·B[j_k, i₀+1])/B_0 (indices mod nTheta).
8. Peak target load: q_t,k = P_k·b_k/A_wet (MW/m²): a flux tube's cross-section shrinks as 1/B.
9. Strip load: Q_k[i] = q_t,k·g(wrap(θ_i − θ_s,k), σ_θ/b_k) (MW/m²). The flux tube narrows as 1/B, so with each
   radian of strip A_wet/(√(2π)·σ_θ) of target area the strip deposits exactly P_k (version 5, D-034).
10. Two-point model (T in keV): q_∥ = q_t,k·MW/sin α (W/m²; if q_∥ ≤ 0 then T_u = T_t = 0); X = ν·q_∥·L_c/κ_0;
    T_u = X^(1/ν); then N_2pt times: c = 2q_∥/(γ·n_u·keV·T_u), T_t = m_i·amu·c²/(2·keV), T_u = (T_t^ν + X)^(1/ν).
    This solves Spitzer conduction T_u^ν = T_t^ν + ν q_∥ L_c/κ_0 (ν = 7/2), the sheath q_∥ = γ n_t e T_t c_s(T_t),
    c_s = √(2eT_t/m_i) (T_e = T_i), and pressure balance 2 n_t T_t = n_u T_u.

## One step, n → n+1

11. Tiles, from the loads at t_n with the coils of step n. For every strip cell k, i with S = S_k,i and q = Q_k[i]·MW
    (W/m²): dz = d/N_z, k(T) = k_ref/(1 + (T − T_ref)/T_k), c(T) = c_∞ − (c_∞ − c_ref)·exp(−(T − T_ref)/T_c), all from
    the old S. net[0] = q, every other net[z] = 0; for z = 0…N_z−2: G = 2k(S[z])k(S[z+1])/(dz(k(S[z]) + k(S[z+1]))),
    F = G·(S[z] − S[z+1]), net[z] −= F, net[z+1] += F; then net[N_z−1] −= (S[N_z−1] − T_cool)/(dz/(2k(S[N_z−1])) + R_sink).
    S[z] ← S[z] + Δt·net[z]/(ρ·c(S[z])·dz). The surface temperature is Tt_k[i] = S[0] + q·dz/(2k(S[0])) with the new
    S[0]. This is the finite-volume form of ρc(T)∂T/∂t = ∂_z(k(T)∂_zT) with the load entering the surface and the heat
    sink plus water film a thermal resistance R_sink at the back; energy is conserved cell by cell.
12. The new state's LCFS map at t_(n+1) with the same coils: T_u[c] = Σ_k s_k[j]·T_u,k;
    T[c] = (max(0, 1 − Σ_k g_k[c])·T_u[c]^ν + Σ_k g_k[c]·T_t,k^ν)^(1/ν): upstream away from the divertors, the target
    temperature at each footprint centre, interpolated in T^ν as along a conducting field line. The footprint g_k keeps the width σ_θ (the strip of step 9 narrows; the map is an illustration). This map only shows
    where the two-point drop lies; it is not a 2D transport solution.

Stability: the only explicit update is step 11, monotone when Δt·G_max/(ρ·c_ref·dz) ≤ 1 with G_max the larger of an
inner cell's outflow conductance 2k_ref/dz and the back cell's k_ref/dz + 1/(dz/(2k_ref) + R_sink) (here the inner
cells bind: 0.5189; with R_sink = 0 the back cell would bind at 1.5 times that). Above T_ref k falls and c rises, so the
number at T_ref bounds every cell (the build requires T_cool ≥ T_ref and a whole number N_z ≥ 2). The surface
temperature extrapolates with k at the first cell's centre, a few °C below the Kirchhoff form at 16 MW/m².
The fixed N_2pt iterations of step 10 converge while the layer is conduction-limited; the build checks the sheath
balance to 1e-6 at the operating loads (loads beyond ~50 MW/m² would not converge).

## Diagnostics (functions of a state and its time t)

- `meanT` = arithmetic mean of T over all cells.
- `peakTileC[k]` = max_i Tt_k[i] (the surface temperature).
- `peakHeatFlux[k]` = max_i Q_k[i] at t_n with the coils of step n (steps 1–9). The narrowed strip (σ_θ/b_k ≈ 0.1 rad)
  is finer than dθ ≈ 0.13 rad, so while a strike line sits between nodes this grid-sampled peak reads up to ~20 % below
  q_t,k; the deposited power is unaffected.
- Heat-flow vector (renderer only, not golden): conduction along the field lines, F_φ = −T^(ν−1)·(T₊ − T₋)/(2dφ) with
  T± the field-line neighbours (pitch ι), F_θ = ι·F_φ, in angle space; mapped to 3D with the grid tangents.

## Cross-section fields (renderer; from the same state)

At plane j, surface m (ρ_m), with T_e = T_u[j] the plane's upstream temperature: T_xs = T_core(ρ_m) + w(ρ_m)·(T[i,j] − T_e),
T_core(ρ) = T_e + (T_0 − T_e)(1 − ρ²)², w(ρ) = (max(0, (ρ − ρ_b)/(1 − ρ_b)))². |B|_xs = B_m[c]·(1 + ρ_m² ε Σ_k a_k h_k[c]).
At ρ = 1 both equal the LCFS values.

## Golden checkpoints (artifact `model.golden`)

Probes [i, j]: [12, 0], [12, 18], [12, 36], [12, 54], [0, 0], [24, 9], [36, 27], [6, 45].
Scenarios (all from the initial condition, step 0):
- `coils-off`: coils [0,0,0,0]; checkpoints at steps 250, 1000, 3000.
- `coils-D1-D3`: coils [1,0,1,0]; checkpoints at steps 250, 1000, 3000.
- `switch-at-1s`: [0,0,0,0] from step 0, [1,1,1,1] from step 1000; checkpoints at steps 1000, 1500, 3000.
Each checkpoint records `step`, `t`, `probesT`, `meanT`, `peakTileC`, `peakHeatFlux` of the state after `step` steps.
`relativeTolerance` = 2e-6 (the artifact rounds to 7 significant figures); a renderer test reproduces all of them.

## Operating point (backend, once; then frozen)

The view must show both regimes, so `Pheat` (2–8 MW) and `wettedArea` (0.1–0.2 m²) set the operating point, each only
within its stated range. Requirements, checked by tests and recorded in `model.limitations`:
- `coils-off` at step 3000 (= the view's starting state): at least one diverter's peak tile temperature is above
  `tileLimit` and at least one is below it.
- all coils on from step 0 (a test scenario, not necessarily golden): every peak tile temperature is below
  `tileLimit` at step 3000.
- The stability condition above holds.

Outcome (D-033/D-034): `Pheat` 7.5 MW, `fRad` 0.3, `wettedArea` 0.1 m². The field compression at the strike lines is ~1.23
at D1 and D4 and ~1.02 at D2 and D3, so with every coil off at 3 s the peak loads are 16.2, 13.5, 13.4, 16.1 MW/m²
(above the 10 MW/m² design load of the W7-X targets) and the tile surfaces D1 1346, D2 1089, D3 1074, D4 1337 °C; all
coils on from 0 s: D1 499, D2 443, D3 425, D4 497 °C (version 5's narrower strip; version 4: 549/451/427/545). The two-point model gives T_u ≈ 0.21–0.22 keV upstream and
T_t ≈ 0.034–0.045 keV at the targets. At 6 MW (D1 1035 °C) or with a larger wetted area no diverter reaches the limit,
so this is a high-power case, and the model says so. The tile values follow the W7-X target elements: NB31 CFC ~6 mm
thick on a CuCrZr heat sink, 30 °C inlet water, designed for 10 MW/m². R_sink is an effective lumped value, not
calibrated: it puts the CFC/Cu interface at ~1000 °C at 22 MW/m², consistent with element tests in which the interlayer
approached its ~1100 °C melting point above 22 MW/m². The CFC fits k(T) and c(T) are approximate.
Version 3 (D-032): lumped tile, `tileGain` 100 °C per MW m⁻², `tauTile` 1 s, `Pheat` 6 MW.
Version 2 (D-031): sheath-law deposition from a 2D diffusion edge, `nSep` 6e19, `incidence` 4°, not energy-conserving.
Version 1 (D-028): `tileGain` 165, `heatFluxScale` 0.2, T_ped 1 keV, T_t 0.01 keV.
