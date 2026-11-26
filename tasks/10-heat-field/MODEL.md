# Edge heat model, version 8: two-point scrape-off layer with an edge-dependent footprint width, energy conserved, conducting CFC tiles (D-027, D-031–D-036, D-041)

**What this is.** A reduced model of the owner's loop (heat map → predicted heat load → change the magnetic field →
new heat map) on the **real** W7-X geometry and |B| of `wout_w7x_kjm.nc`. Version 3 (D-032) replaces version 2's 2D
diffusion of the edge temperature with the textbook **two-point model** of the scrape-off layer at each divertor, fed by
a fixed heating power, so that **energy is conserved**: the power on the targets is the heating power less the radiated
part. The edge is **quasi-steady** (its time scales are microseconds, far below Δt); only the tiles evolve in time.
Version 4 (D-033) replaces the lumped tile (gain K, time constant τ_tile) with **heat conduction through the CFC
armour** of the W7-X target elements: 6 mm of NB31 with temperature-dependent conductivity and heat capacity, cooled at
its back through the copper heat sink by 30 °C water. The heating, transport, sheath and tile inputs are W7-X orders
of magnitude (the material fits are approximate); the strip width and coil parameters remain illustrative; nothing
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
| Tcore0 | T_0 | 3.38133 | keV | core temperature on axis (cross-sections only), from energy confinement: the ISS04 stellarator scaling at P_heat gives the stored energy, hence the mean and axis temperature |
| majorRadius | R | 5.5 | m | W7-X major radius |
| minorRadius | a | 0.53 | m | W7-X effective minor radius |
| coreDensity | n̄ | 6e+19 | m⁻³ | line-averaged density (flat profile assumed; W7-X high-performance range) |
| densityUnit | n_unit | 1e+19 | m⁻³ | density unit of the ISS04 scaling (unit conversion) |
| iss04C | C | 0.134 | s | ISS04 coefficient: τ_E = C a^α_a R^α_R P^α_P (n̄/n_unit)^α_n B^α_B ι_2/3^α_ι |
| iss04A | α_a | 2.28 | – | ISS04 exponent of the minor radius (m) |
| iss04R | α_R | 0.64 | – | ISS04 exponent of the major radius (m) |
| iss04P | α_P | -0.61 | – | ISS04 exponent of the heating power (MW) |
| iss04N | α_n | 0.54 | – | ISS04 exponent of the line-averaged density (10¹⁹ m⁻³) |
| iss04B | α_B | 0.84 | – | ISS04 exponent of the field (T) |
| iss04Iota | α_ι | 0.41 | – | ISS04 exponent of the rotational transform at two-thirds of the minor radius |
| rhoBlend | ρ_b | 0.7 | – | inside ρ_b the cross-section shows the core profile only |
| B0 | B_0 | 2.5 | T | reference field |
| sigmaTheta | σ_θ | 0.12 | rad | width in θ of the target strip at B_0 and T_λ (illustrative) |
| widthExponent | e_λ | -1.25 | – | footprint width ∝ T_u^e_λ: λ_q = (χ_⊥ τ_∥)^½ with the conduction-limited parallel loss time τ_∥ ∝ L_c² n/(κ_0 T_u^(5/2)), χ_⊥ and n fixed (a modelling choice: the sheath-limited estimate gives −1/4, measured widths depend mainly on the poloidal field) |
| widthRefTu | T_λ | 0.216125 | keV | upstream temperature at which σ_θ and A_wet are given (the mean coils-off nominal T_u) |
| sweepAmplitude | A_s | 0.3 | rad | strike-line excursion when a coil is on (illustrative) |
| sweepFrequency | f | 2 | Hz | coil (sweep) frequency (illustrative) |
| epsilon | ε | 0.03 | – | relative |B| perturbation of one coil at its centre (illustrative) |
| sigmaCoilPhi | σ_cφ | 0.2 | rad | coil envelope width in φ (illustrative) |
| sigmaCoilTheta | σ_cθ | 0.6 | rad | coil envelope width in θ (illustrative) |
| shareShift | η | 0.3 | – | a coil fully on lowers its divertor's power weight by 1 − η (its static field moves the island); the shares are renormalised so the total is unchanged: D1 alone sheds ~24 % to the others, every coil on moves nothing (illustrative, no validated coil response) |
| Pheat | P_heat | 7.5 | MW | heating power crossing the LCFS (W7-X: ECRH up to ~8 MW, more with NBI) |
| fRad | f_rad | 0.3 | – | fraction of the heating power radiated before it reaches the targets |
| wettedArea | A_wet | 0.1 | m² | effective wetted target area per divertor at B_0 and T_λ |
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
| sinkResistance | R_sink | 4.5e-05 | m² K W⁻¹ | effective lumped resistance of the Cu interlayer, CuCrZr heat sink and water film per unit area (not calibrated; it puts the CFC/Cu interface at ~1000 °C at 22 MW m⁻², consistent with element tests in which the interlayer approached its ~1100 °C melting point above 22 MW m⁻²) |
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
5. (Removed in version 7: the LCFS no longer carries the footprints.)
6. Power (energy conservation): sectors s_k[j] = G_k[j]/Σ_m G_m[j], G_k[j] = g(wrap(φ_j − φ_k), π/N_div);
   u_k = mean_c(w[c]·s_k[j]), with w ≡ 1 (a renderer scenario may supply a relative heating density w[c](t); the
   golden runs use none). Coils redistribute (version 6, D-035): f_k = 1 − η·c_k, and
   P_k = P_heat·(1 − f_rad)·u_k·f_k·(Σ_m u_m)/(Σ_m u_m·f_m) (MW; sums in order m = 0…3). A coil that is on moves its
   island and lowers its divertor's weight by 1 − η; the renormalisation hands the difference to the others in
   proportion to their shares (D1 alone keeps (1 − η)·4/(4 − η) ≈ 0.757 of its share, so sheds ~24 %); with every coil
   off or every coil on nothing moves. Σ_k P_k = P_heat·(1 − f_rad) for any coils.
7. Field compression at the strike line: j_k = round(φ_k/dφ) mod nPhi; x = θ_s,k/dθ, i₀ = floor(x), w = x − i₀;
   b_k = ((1 − w)·B[j_k, i₀] + w·B[j_k, i₀+1])/B_0 (indices mod nTheta).
8. Peak target load: q_t,k = P_k·b_k/(A_wet·w_k) (MW/m²): a flux tube's cross-section shrinks as 1/B.
8b. Footprint width (version 8, D-041): w_k = (T_u,k/T_λ)^e_λ (1 if T_u,k = 0). The width is λ_q = (χ_⊥ τ_∥)^½, the
   distance heat diffuses across the field while it drains along it. This scrape-off layer is conduction-limited
   (T_t ≪ T_u), so the drain time is Spitzer conduction, τ_∥ ∝ L_c² n/(κ_0 T_u^(5/2)), and with χ_⊥ and n fixed the
   width goes as T_u^(−5/4): a hotter edge drains faster along the field and the heat spreads less across it. (The
   sheath-limited estimate τ_∥ = L_c/c_s gives −1/4 instead, and measured widths depend mainly on the poloidal field:
   the exponent is a modelling choice, not a fit.) Steps 8, 8b and 10 depend on each other, so they are
   solved together in one loop: from w_k = 1 and step 10's start (T_u = X^(1/ν)), N_2pt passes, each updating T_t and
   T_u (step 10), then w_k (8b) and q_t,k and X with the new w_k (8). The width part contracts by |e_λ|·2/7 = 5/14 per
   pass (20 passes: converged to ~1e-9).
9. Strip load: Q_k[i] = q_t,k·g(wrap(θ_i − θ_s,k), σ_θ·w_k/b_k) (MW/m²). The flux tube narrows as 1/B and widens with
   w_k, and A_wet scales the same way, so with each radian of strip A_wet/(√(2π)·σ_θ) of target area the strip deposits
   exactly P_k (version 5, D-034).
10. Two-point model (T in keV): q_∥ = q_t,k·MW/sin α (W/m²; if q_∥ ≤ 0 then T_u = T_t = 0); X = ν·q_∥·L_c/κ_0;
    T_u = X^(1/ν); then N_2pt times: c = 2q_∥/(γ·n_u·keV·T_u), T_t = m_i·amu·c²/(2·keV), T_u = (T_t^ν + X)^(1/ν).
    This solves Spitzer conduction T_u^ν = T_t^ν + ν q_∥ L_c/κ_0 (ν = 7/2), the sheath q_∥ = γ n_t e T_t c_s(T_t),
    c_s = √(2eT_t/m_i) (T_e = T_i), and pressure balance 2 n_t T_t = n_u T_u. In version 8 this loop runs inside the
    joint loop of step 8b (each pass also updates w_k, q_t,k and X).

## One step, n → n+1

11. Tiles, from the loads at t_n with the coils of step n. For every strip cell k, i with S = S_k,i and q = Q_k[i]·MW
    (W/m²): dz = d/N_z, k(T) = k_ref/(1 + (T − T_ref)/T_k), c(T) = c_∞ − (c_∞ − c_ref)·exp(−(T − T_ref)/T_c), all from
    the old S. net[0] = q, every other net[z] = 0; for z = 0…N_z−2: G = 2k(S[z])k(S[z+1])/(dz(k(S[z]) + k(S[z+1]))),
    F = G·(S[z] − S[z+1]), net[z] −= F, net[z+1] += F; then net[N_z−1] −= (S[N_z−1] − T_cool)/(dz/(2k(S[N_z−1])) + R_sink).
    S[z] ← S[z] + Δt·net[z]/(ρ·c(S[z])·dz). The surface temperature is Tt_k[i] = S[0] + q·dz/(2k(S[0])) with the new
    S[0]. This is the finite-volume form of ρc(T)∂T/∂t = ∂_z(k(T)∂_zT) with the load entering the surface and the heat
    sink plus water film a thermal resistance R_sink at the back; energy is conserved cell by cell.
12. The new state's LCFS temperature at t_(n+1) with the same coils (version 7, D-036): T[c] = T_u[j] =
    Σ_k s_k[j]·T_u,k, the upstream temperature of the plane. The island divertor's targets lie outside the LCFS, so the
    two-point drop to T_t is in the scrape-off layer; the renderer colours each diverter plate by its T_t,k. No 2D
    transport across the surface and no poloidal variation.

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
  is finer than dθ ≈ 0.13 rad, so while a strike line sits between nodes this grid-sampled peak reads up to ~20–25 % below
  q_t,k; the deposited power is unaffected.
- Heat-flow vector (renderer only, not golden): conduction along the field lines, F_φ = −T^(ν−1)·(T₊ − T₋)/(2dφ) with
  T± the field-line neighbours (pitch ι), F_θ = ι·F_φ, in angle space; mapped to 3D with the grid tangents.

## Cross-section fields (renderer; from the same state)

At plane j, surface m (ρ_m), with T_e = T_u[j] the plane's upstream temperature: T_xs = T_core(ρ_m) + w(ρ_m)·(T[i,j] − T_e),
T_core(ρ) = T_e + (T_0 − T_e)(1 − ρ²)², w(ρ) = (max(0, (ρ − ρ_b)/(1 − ρ_b)))². |B|_xs = B_m[c]·(1 + ρ_m² ε Σ_k a_k h_k[c]).
At ρ = 1 both equal the LCFS values.

T_0 (`Tcore0`) follows from energy confinement (version 7, D-036; the build checks the written value to 1e-6): the
ISS04 stellarator scaling τ_E = C·a^α_a·R^α_R·P_heat^α_P·(n̄/n_unit)^α_n·B_0^α_B·ι_2/3^α_ι (ι_2/3 linear between the
written surfaces at ρ = 2/3), stored energy W = τ_E·P_heat·MW, volume V = 2π²Ra², flat density and T_e = T_i so
W = 3·n̄·⟨T⟩·keV·V, and with the profile above (volume mean T_e + (T_0 − T_e)/3, T_e the mean upstream temperature with
every coil off) T_0 = T_e + 3(⟨T⟩ − T_e). At 7.5 MW: τ_E 0.149 s, W 1.12 MJ, ⟨T⟩ 1.27 keV, T_0 3.38 keV.

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

Outcome (D-033/D-034, version 8 D-041): `Pheat` 7.5 MW, `fRad` 0.3, `wettedArea` 0.1 m². The field compression at the
strike lines is ~1.23 at D1 and D4 and ~1.02 at D2 and D3, so with every coil off at 3 s the edge-dependent widths are
w ≈ 0.95, 1.05, 1.06, 0.95 (the hotter edge narrower), the peak loads 17.0, 12.9, 12.6, 16.9 MW/m² (above the 10 MW/m²
design load of the W7-X targets) and the tile surfaces D1 1434, D2 1029, D3 1007, D4 1419 °C; all coils on from 0 s:
D1 526, D2 436, D3 409, D4 522 °C (version 5: 1346/1089/1074/1337 and 499/443/425/497; version 4 all on:
549/451/427/545). The two-point model gives T_u ≈ 0.21–0.23 keV upstream and T_t ≈ 0.03–0.05 keV at the targets (up to ~0.07 keV with a coil on). At
6 MW (D1 951 °C) or with a larger wetted area no diverter reaches the limit,
so this is a high-power case, and the model says so. The tile values follow the W7-X target elements: NB31 CFC ~6 mm
thick on a CuCrZr heat sink, 30 °C inlet water, designed for 10 MW/m². R_sink is an effective lumped value, not
calibrated: it puts the CFC/Cu interface at ~1000 °C at 22 MW/m², consistent with element tests in which the interlayer
approached its ~1100 °C melting point above 22 MW/m². The CFC fits k(T) and c(T) are approximate.
Version 3 (D-032): lumped tile, `tileGain` 100 °C per MW m⁻², `tauTile` 1 s, `Pheat` 6 MW.
Version 2 (D-031): sheath-law deposition from a 2D diffusion edge, `nSep` 6e19, `incidence` 4°, not energy-conserving.
Version 1 (D-028): `tileGain` 165, `heatFluxScale` 0.2, T_ped 1 keV, T_t 0.01 keV.
