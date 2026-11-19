# 01 · Locate the tubes (replay)

PRD: High-mirror W7-X geometry at normalized radius 0.8. Select the bean or triangular field line. Unsampled regions stay gray. **Acceptance:** the bean field strength agrees with all 129 saved stella samples to their printed precision.

## Owner
backend: backend-engineer (`main/labyrinth_main/features/geometry/`) · frontend: frontend-engineer (`renderer/src/features/geometry/`)

## Expected outcome
Backend (artifact `artifacts/geometry.json`, contract `contracts/geometry.schema.json`):
- G1. VMEC reader loads `data/raw/wout_w7x_kjm.nc` (nfp 5, ns 99) and evaluates R, Z, |B|, λ at any s by radial interpolation (full-grid R/Z, half-grid |B|/λ, as stella does).
- G2. Straight-field-line tracer: given s, α and ζ-range, solve θ* = θ + λ(θ, ζ) for θ (Newton, tol 1e-12) and return samples.
- G3. **Tracer reproduces stella's saved geometry**: `data/raw/stella_test2_vmec_geometry.geometry` (torflux 0.49, nfield_periods 6.073867, nzed 24 → 25 samples, α 0). Every `zeta` and `bmag` agrees to the printed 4 significant figures (|Δ| ≤ half a unit in the last printed place). If not achievable, report max error honestly and set `allWithinPrintedPrecision: false`.
- G4. Artifact at ρ 0.8 (s 0.64): bean (ζc 0°) and triangular (ζc 36°), each centred on the outboard midplane (θ* 0 at ζc), one poloidal turn (θ* ∈ [−π, π]), 129 samples (nzed 128), with R, Z, x, y, z and |B|/B_ref.
- G5. Gray surface mesh at s 0.64 and plasma-boundary (s 1) cross-sections at each ζc; bean outboard midplane R at ζ 0 is within [6.05, 6.25] m and Z ≈ 0.
- G6. `validation.acceptance129` = `blocked` with the reason: the 129 saved stella samples at ρ 0.8 are not in the repo or at the cited stella commit (see decision D-007).

Frontend:
- G7. Three.js scene: gray surface; selected tube coloured by |B|; other tube muted; start/centre/end markers.
- G8. Bean/triangular selector (keyboard accessible) switches the scene, the |B|(θ*) plot and the cross-section inset.
- G9. Cross-section inset (sampled surface + dashed plasma boundary) and |B|(θ*) Plotly chart with units.
- G10. Validation panel: stella reference result (samples, max error, pass/fail) and acceptance-129 status shown as BLOCKED with reason — never as passed.

## Tests
| # | Test |
|---|---|
| G1 | `main/tests/test_geometry.py::test_vmec_reader_header` |
| G2 | `main/tests/test_geometry.py::test_sfl_root_solve_roundtrip` |
| G3 | `main/tests/test_geometry.py::test_reproduces_stella_saved_bmag_to_printed_precision` |
| G4 | `main/tests/test_geometry.py::test_artifact_tubes_129_samples_centered` |
| G5 | `main/tests/test_geometry.py::test_surface_and_bean_outboard_midplane` |
| G6 | `main/tests/test_geometry.py::test_acceptance129_is_blocked_not_passed` |
| G7–G10 | `renderer/src/features/geometry/*.test.tsx` (one `test()` per outcome, named `G7 …` … `G10 …`) |

## Status
TODO
