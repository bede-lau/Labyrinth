# 10 · Heat & field (owner requirement 2026-11-21, D-027)

Owner requirement: `design-artifacts/requirements-2026-11-21/` (transcription in its README.md). A 3D interactive model of
W7-X with a temperature heat map (red hottest → yellow coldest), hover read-outs, a cross-section with an angle slider,
four diverters at 0, π/2, π, 3π/2 with a temperature side panel, magnetic-field adjustment toggles that show how the
heat flow moves, a moving |B|-against-angle graph linked to the 3D model with a frozen snapshot, |B| colour-coded dark
blue (strongest) → green (weakest), the loop "heat map → predict → change field → new heat map", and the equation used
to predict heat movement. Geometry and |B| are real (VMEC); temperatures, heat fluxes and tile temperatures come from
the illustrative model in `MODEL.md` and are labelled `model` everywhere.

## Owner
backend: backend-engineer (`main/labyrinth_main/features/heatfield/`) · frontend: frontend-engineer (`renderer/src/features/heatfield/`) · model specification: maintainer (`tasks/10-heat-field/MODEL.md`)

## Expected outcome
Backend (artifact `artifacts/heatfield.json`, contract `contracts/heatfield.schema.json`):
- H1. Surfaces ρ = m/8 (m = 0…8) on 48 θ × 72 φ with R, Z (m) and |B| (T) from the existing VMEC reader; the axis R and Z do not depend on θ (its |B| varies with θ by the amount `geometryProvenance` states: stella's half-grid extrapolation, D-028 §4); the LCFS agrees with the reader at independent points and with `geometry.json`'s plasma-boundary cross-sections at ζ 0° and 36° (same equilibrium, within the 7-significant-figure rounding).
- H2. Eight field lines on the LCFS (α = 2πm/8), one toroidal turn each, traced with the existing straight-field-line tracer; every point lies on the LCFS and its |B| equals the reader's at that point.
- H3. Exactly four schematic diverters D1…D4 at φ = 0, π/2, π, 3π/2 with the note that W7-X has ten divertor units.
- H4. The reference model implements MODEL.md (version 7, D-036) step by step (`test_H4_one_step_is_model_md_transcribed_literally`); tested properties: energy is conserved, the divertors' powers sum to P_heat(1 − f_rad) and the load on each wetted area de-compressed to B_0 is its power and each strip, narrowed as 1/B, deposits exactly that power, with no heating no load and no plasma (`test_H4_energy_is_conserved_power_in_equals_power_on_the_targets`); the two-point solution satisfies Spitzer conduction, the sheath with pressure balance, and lies at ~0.2 keV upstream and ~0.03 keV at the targets (`test_H4_the_two_point_solution_satisfies_conduction_sheath_and_pressure_balance`); the LCFS sits at each plane's upstream temperature, never as cold as a target (`test_H4_the_lcfs_sits_at_the_upstream_temperature`); the core temperature follows from ISS04 energy confinement (`test_H4_the_core_temperature_follows_from_iss04_energy_confinement`); the tile conducts heat through its CFC thickness into the water-cooled sink, conserving energy every step, reaches the closed-form steady state with k(T), and its material fits match NB31 at 800 °C (`test_H4_the_tile_conducts_and_conserves_energy`); the tile conduction is stable (Δt·2k_ref/(ρ·c_ref·dz²) ≤ 1) and the two-point iteration converged at the operating loads (`test_H4_stability_is_the_tile_conduction`); a coil moves the strike line by A_s·cos(2πft) and changes |B| by ε at its centre; sweeping lowers the peak tile temperature; runs are deterministic.
- H5. Golden checkpoints for the three MODEL.md scenarios are in the artifact; the regime requirements hold (coils off at 3 s: at least one diverter above the tile limit and one below; all coils on from 0 s: all below at 3 s).
- H6. `geometryProvenance` is kind `derived` (VMEC source with sha256) and `provenance` is kind `model` with verification `not-applicable` and details saying it is an illustrative model, not a W7-X simulation; the artifact is deterministic (byte-identical rebuild) and schema-valid; the manifest lists it.

Frontend (route `#/heat`, nav label "Heat & field"):
- H7. The view loads `artifacts/heatfield.json` through the artifact gate with a validator (grid sizes, every array length, four diverters, probes inside the grid); a broken artifact shows an error naming the file.
- H8. The TypeScript model reads every grid value and parameter from the artifact (no duplicated constants) and reproduces every golden checkpoint to `relativeTolerance`.
- H9. 3D scene: the LCFS coloured by temperature (red hottest → yellow coldest) or by |B| (dark blue strongest → green weakest), black diverter plates at the four angles, optional field lines coloured by |B|, optional heat-flow arrows, colour bars with units; WebGL failure falls back to the text summary.
- H10. Hovering the 3D surface or the cross-section shows a text box with temperature (keV, labelled model), |B| (T) and the angles of that point; the same read-out is reachable without a mouse (slider + focusable cross-section cells or a text summary).
- H11. Cross-section panel: a toroidal-angle slider (5° steps, keyboard operable, jump-to-diverter buttons) shows the poloidal slice coloured by temperature or |B|, with the diverter plate drawn when the slice is at a diverter angle.
- H12. Diverter panel: for D1…D4 the peak tile temperature (°C), peak heat flux (MW/m²), status against the tile limit (text + icon, never colour alone) and a field-adjustment toggle (`aria-pressed`); an "all off" control.
- H13. Playback: play / pause / reset and speed; no autoplay under `prefers-reduced-motion`; the model time is shown; pausing freezes every display (snapshot).
- H14. |B| against toroidal angle at the strike-line θ, redrawn as the coils sweep; markers for the slider angle, the diverters and the hovered angle link it to the 3D view; "Freeze snapshot" keeps a dashed copy of the curve for comparison.
- H15. Control loop: 1 Current heat map → 2 Predict (model run ahead with the coils unchanged) → 3 Adjust field (diverters predicted above the limit are suggested; the user can change any toggle) → 4 New heat map (model run ahead with the adjusted field) → back to 1; predicted and achieved peak tile temperatures are shown side by side.
- H16. The governing equation and the parameter table (symbols, values, units) are shown; every model number carries the `model` status; the view states that the model is illustrative and not a W7-X simulation, that the diverter positions are schematic, and that the prediction is this reduced model (not the GENE-X spatial-parallel run, D-027 §6).

## Tests
| # | Test |
|---|---|
| H1–H6 | `main/tests/test_heatfield.py` (one or more `test_H<n>_…` per outcome) |
| H7–H16 | `renderer/src/features/heatfield/*.test.ts(x)` (one or more tests per outcome, names starting `H<n> `) |

## Status
VERIFYING

The files listed in the verification record have changed since its last recorded run.

Verified at commit ca1871b: tasks/10-heat-field/VERIFY.md, `Verdict: PASS` (external verifier, 2026-11-21; independent numpy re-implementation of MODEL.md reproduces every golden checkpoint to 3.75e-7). Reviewed: backend, heat frontend and design areas (2026-11-21 review rounds, status.md session 4). Lives on branch `heat-field` until it is merged with `origin/main` (status.md).
