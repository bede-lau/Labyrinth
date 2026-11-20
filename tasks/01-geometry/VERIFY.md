# Verify: 01-geometry

Two verifier runs are recorded here. Run 1 covered outcomes G1–G6 on a pre-commit working tree.
Run 2 covers the whole task (G1–G10) at commit 2b1607e and carries the verdict for the task (last line of this file).

## Run 1 — outcomes G1–G6 (2026-11-19, commit 0884d0b + working tree)
Verifier run: 2026-11-19, commit 0884d0b + working tree (geometry files uncommitted: `main/labyrinth_main/features/geometry/{vmec,fieldline,stella_reference,tubes,artifact}.py`, `main/tests/test_geometry.py`, `artifacts/geometry.json`)

**Scope.** This run covered outcomes G1–G6. The frontend outcomes (G7–G10) did not exist at the time
(only `renderer/src/features/geometry/GeometryView.tsx` existed, with no `G7…G10` tests) and were outside this run.
The verdict line of this run is for G1–G6. Run 2 below covers G7–G10.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| G1 | VMEC reader: nfp 5, ns 99; R/Z full grid, \|B\|/λ half grid | `test_vmec_reader_header`: header (nfp, ns, mnmax, lasym), a_ref/B_ref vs stella header, 1/ι(0.49) vs qinp 1.112, grid-point weights, Z=λ=0 at (0,0). Half-grid \|B\|/λ is not asserted here directly, but switching either to full grid makes the G3 test fail (mutations C1, C2) | Own netCDF4 reader: ns=99, nfp=5, mnmax_nyq=288; own half-grid ι(0.64)=0.9101565 = artifact `surface.iota` | PASS |
| G2 | Newton solve θ*=θ+λ, tol 1e-12 | `test_sfl_root_solve_roundtrip`: 200 random round-trips to 1e-11, traced points return α to 1e-11 | Own bisection solver (60 iterations, not Newton) gives θ, and from it \|B\|, bit-identical to the author's at all 25 test_2 points (max diff 0.00e+00). Mutations C6 (tol 1e-2) and C7 (ignore λ) make the test fail | PASS |
| G3 | stella test_2: all 25 `zeta` and `bmag` within half a unit in the 4th significant figure | `test_reproduces_stella_saved_bmag_to_printed_precision`: zips all 25 rows with `strict=True`, checks each zeta and bmag against its half-unit, checks round-to-4-s.f. equality, checks θ_vmec against `.vmec.geo` | (a) Own evaluator with **printed** `.vmec.geo` θ_vmec·nfp and the file's `zeta`, half-grid bmnc (j=48/49, w=0.48/0.52): max \|Δ\| 5.5e-4 (exact B_ref) / 6.9e-4 (B_ref 2.604); 5 samples land just outside the half-unit, and all of that is θ_vmec print rounding (re-rounding my own θ the way stella prints it reproduces those values to 0.0e+00; rounding moves \|B\| by up to 2.6e-4). (b) Own evaluator with own λ-solve: max \|Δ\| 4.868e-4, 0/25 outside the half-unit, 25/25 equal after rounding to 4 s.f. Identical to the author's values. Reference-file mutations M1–M5 (+1e-3 on one bmag in the middle, at a 5-decimal row, or on the last row; +1e-4 just past the half-unit; one row deleted) all make the test fail | PASS (worst sample is at 0.974 of the half-unit, a tight but real pass) |
| G4 | ρ 0.8 tubes: bean ζc 0, triangular ζc 36°, θ*∈[−π,π], 129 samples, centre θ*=0 at ζc, R Z x y z \|B\| | `test_artifact_tubes_129_samples_centered`: schema, 129 samples, α=−ιζc, endpoints ±π, monotone, centre θ*=0, ζ=ζc, Z=0, R=max of the cross-section, x/y/z, stellarator up-down symmetry. Mutations C4 (α sign), C5 (128 samples), C5b (ζc 30°) make it fail | From the artifact JSON: 129/129 samples, θ* from −3.1415930 to 3.1415930 (7 s.f.), monotone; centre ζ=0 / 0.6283185, Z=0 / 8e-19; max\|x²+y²−R²\| 1.1e-5 (7-s.f. rounding). Own λ-solve plus evaluation at 5 samples per tube (0, 40, 64, 100, 128): \|B\| agrees to ≤6.3e-7 and R, Z to ≤1e-6 | PASS |
| G5 | Gray mesh at s 0.64 and boundary cross-sections; bean outboard midplane R at ζ 0 in [6.05, 6.25], Z≈0 | `test_surface_and_bean_outboard_midplane` | len(positions)=21600=3·48·150. Bean outboard R=6.13248, Z=0 (mesh, cross-section and own evaluator agree). At φ index 0 and 37: 0/48 mesh points inside own s=0.63 section, 48/48 inside own s=0.65 section and inside own s=1 boundary; mesh vs own s=0.64 R,Z max diff 5e-7. Artifact boundary curves vs own wout[ns−1]: max diff 4.8e-7 | PASS |
| G6 | `acceptance129` = `blocked` with D-007 reason | `test_acceptance129_is_blocked_not_passed`. Mutation C3 (outcome "passed") makes it fail | Artifact `outcome: "blocked"`, reason cites D-007 and stella 6f60964d. Grep: the only assignment is the literal at `artifact.py:93`; no code path sets it to passed | PASS |
| — | Provenance honest | (part of G6 test: kind) | kind `derived`; all 3 source sha256 values equal the sha256 of the `data/raw` files; URLs pinned to stella 6f60964d; runtime marked "not recorded" | PASS (see finding 3) |
| G7–G10 | Frontend | — | — | absent at the time of Run 1; see Run 2 |

### Real output
```
$ python3 -m pytest -q main/tests/test_geometry.py -v      (exit 0)
collected 6 items
main/tests/test_geometry.py ......                                       [100%]
============================== 6 passed in 0.46s ===============================

$ python3 scripts/check_boundaries.py ; echo EXIT=$?
boundary: OK (63 files scanned)
EXIT=0
$ python3 scripts/validate_artifacts.py ; echo EXIT=$?
artifacts: schema-valid
EXIT=0

$ cd main && python3 -m labyrinth_main.build_artifacts --only geometry --out $SP/geo-rebuild
wrote geometry.json add126aac31f
$ cmp $SP/geo-rebuild/geometry.json ../artifacts/geometry.json ; echo CMP=$?
CMP=0
add126aac31f6c637e75f71d1e2dead92a5c6c68d622804220bd246d61763e57  .../geo-rebuild/geometry.json
add126aac31f6c637e75f71d1e2dead92a5c6c68d622804220bd246d61763e57  ../artifacts/geometry.json

$ bash scripts/verify.sh main ; echo VERIFY_EXIT=$?
VERIFY_EXIT=2
━━━ verify.sh summary (scope: main)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  scripts:tests (0s)
  FAIL  main:lint (0s)
  PASS  main:tests (1s)
  PASS  artifacts:schema (1s)
  PASS  artifacts:fresh (0s)
main:lint failures (both outside geometry):
F401 `labyrinth_main.features.live_gx.modal_backend.FUNCTION_NAME` imported but unused
  --> main/labyrinth_main/features/live_gx/modal_app.py:26:88
F401 `http.HTTPStatus` imported but unused
  --> main/labyrinth_main/server/app.py:19:18
$ python3 -m ruff check main/labyrinth_main/features/geometry main/tests/test_geometry.py
All checks passed!
(Also seen mid-run, from a PostToolUse hook: "main/tests/test_live_gx.py:28: cannot parse (invalid syntax)"
 — another agent's file that was being written at the time; the later check_boundaries run was OK.)

# Independent G3 probe (verifier's own numpy+netCDF4 code, no labyrinth_main imports)
ns=99 nfp=5 mnmax_nyq=288 half-grid j0=48 (s=0.484694) j1=49 (s=0.494898) w1=0.5200
theta_vmec as printed   : max|B/Bref - stella bmag| = 1.654e-01
theta_vmec*nfp          : max|B/Bref - stella bmag| = 6.894e-04
B_ref exact from wout = 2.604314 T (header prints 0.2604E+01)
max |mine(2.604)-stella| = 6.894e-04
max |mine(exact)-stella| = 5.516e-04     (samples 6,7,8,16,17,18 marginally outside half-unit: printed-theta rounding)
own theta rounded to printed precision: max|B - B(printed theta_vmec)| = 0.0e+00
bmag sensitivity to printed-theta rounding: max|B(own exact theta) - B(printed theta)| = 2.6e-04
-- own lambda solve (bisection) --
own zeta grid vs printed zeta: max|d| = 3.23e-04
iota(0.49)=0.898963  1/iota=1.11239 (stella qinp 1.112)
own theta/nfp vs .vmec.geo theta_vmec: max|d| = 3.59e-05
own-lambda-solve bmag vs stella: max|d| = 4.868e-04  #outside half-unit: 0 of 25
own rounded to 4 s.f. == stella printed: 25 of 25
-- vs author --
agent maxAbsError 0.0004867958313061749 maxAbsErrorZeta 0.000323189216295372 all True bRef 2.6043144343662177
max|agent - verifier(own lambda solve)| = 0.00e+00
max|agent - verifier(printed theta_vmec)| = 2.64e-04
zeta worst ratio |d|/halfunit = 0.9227026123492799
bmag worst ratio |d|/halfunit = 0.9735916626123498

# G3 reference-file mutations (scratch copy of main/, contracts/, data/raw/; PYTHONDONTWRITEBYTECODE=1)
== M1: row 13 (zeta 0) bmag 0.1091E+01 -> 0.1092E+01 (+1e-3)   1 failed
   E  AssertionError: (np.float64(1.0909534293323702), Printed(value=1.092, half_unit=0.0005))
== M2: row 3 bmag 0.9229E+00 -> 0.9239E+00 (+1e-3)             1 failed
== M3: last row bmag 0.1260E+01 -> 0.1261E+01 (+1e-3)           1 failed
== M4: row 3 bmag 0.9229E+00 -> 0.9230E+00 (+1e-4)             1 failed
== M5: delete one sample row                                    1 failed
== restored                                                     1 passed
# Code mutations (same scratch copy)
== baseline                                   6 passed
== C1: bmnc full-grid instead of half-grid    FAILED test_reproduces_stella_saved_bmag_to_printed_precision
== C2: lmns full-grid                         FAILED test_reproduces_stella_saved_bmag_to_printed_precision
== C2b: B_ref = 2.604 (rounded header)        FAILED test_reproduces_stella_saved_bmag_to_printed_precision
== C3: acceptance129 outcome "passed"         FAILED test_acceptance129_is_blocked_not_passed
== C4: tube alpha sign flipped                FAILED test_artifact_tubes_129_samples_centered
== C5: 128 samples                            FAILED test_artifact_tubes_129_samples_centered
== C5b: triangular zeta_c 30 deg              FAILED test_artifact_tubes_129_samples_centered
== C6: Newton tol 1e-2                        FAILED test_sfl_root_solve_roundtrip
== C7: ignore lambda (theta = theta*)         FAILED test_sfl_root_solve_roundtrip, test_reproduces_stella_...
== restored                                   6 passed

# G4/G5/G6 probe on artifacts/geometry.json (own evaluator)
bean       zc=0.0 n=129 nSamples=129 thetaStar[0]=-3.1415930 [-1]=3.1415930 monotone=True
   centre: thetaStar=0.00e+00 zeta=0.0000000 (zc=0.0000000) Z=0.00e+00 R=6.13248
   max|x^2+y^2-R^2|=1.08e-05  max|z-Z|=0.0e+00
   sample   0: bmag art=1.060369 own=1.060369 |d|=2.9e-07
   sample  40: bmag art=1.135750 own=1.135750 |d|=2.5e-07
   sample  64: bmag art=1.087593 own=1.087593 |d|=3.5e-07
   sample 100: bmag art=0.969442 own=0.969443 |d|=1.5e-07
triangular zc=36.0 n=129 nSamples=129 thetaStar[0]=-3.1415930 [-1]=3.1415930 monotone=True
   centre: thetaStar=0.00e+00 zeta=0.6283185 (zc=0.6283185) Z=8.05e-19 R=5.77941
   max|x^2+y^2-R^2|=1.07e-05
   sample   0: bmag art=1.067601 own=1.067600 |d|=6.3e-07
   sample  40: bmag art=0.999796 own=0.999796 |d|=4.3e-08
   sample 100: bmag art=1.167543 own=1.167543 |d|=8.7e-09
nTheta=48 nPhi=150 len(positions)=21600 3*nT*nP=21600
bean outboard midplane at zeta 0: mesh row0 theta0 R=6.13248 Z=0.0e+00; crossSection max R=6.13248 at Z=0.0e+00; own R(theta=0,zeta=0,s=.64)=6.13248
phi index 0: inside own s=0.63: 0/48; inside own s=0.65: 48/48; inside own boundary (s=1): 48/48; mesh vs own s=0.64 max|dR|=4.9e-07
phi index 37: inside own s=0.63: 0/48; inside own s=0.65: 48/48; inside own boundary (s=1): 48/48; mesh vs own s=0.64 max|dR|=5.0e-07
boundary[bean] n=129 vs own wout[ns-1] at zeta 0: max|dR|=4.8e-07; R 5.515..6.174 Z max 0.832
boundary[triangular] n=129 vs own wout[ns-1] at zeta 36: max|dR|=4.7e-07; R 4.612..5.928 Z max 0.457
acceptance129.outcome: "blocked"
kind: derived | verification: passed
  source data/raw/wout_w7x_kjm.nc: sha256 match=True
  source data/raw/stella_test2_vmec_geometry.geometry: sha256 match=True
$ grep -rn acceptance129 main renderer/src contracts scripts
main/tests/test_geometry.py:165/166 (test only)
main/labyrinth_main/features/geometry/artifact.py:93: "acceptance129": {"outcome": "blocked", ...}
contracts/geometry.schema.json:115 ($ref common verification; enum allows passed|failed|blocked|not-applicable)
```
Tree state: `git status --porcelain` before/after differs only by files other agents added or changed while
this ran (`main/labyrinth_main/server/__init__.py`, `renderer/package.json`, `main/tests/test_live_gx.py`,
`main/tests/test_server.py`, `renderer/scripts/`, `renderer/src/design/`). The verifier wrote only this file.
All mutations were made in the scratch copy.

### Findings
1. **verify.sh main exits 2, for reasons outside geometry.** The `main:lint` failures are in `main/labyrinth_main/features/live_gx/modal_app.py:26`
   (unused `FUNCTION_NAME`) and `main/labyrinth_main/server/app.py:19` (unused `HTTPStatus`), both owned by other agents.
   Ruff on the geometry files: clean. Every other stage passes, including `main:tests` and `artifacts:fresh`.
   Following the caller's scope, the backend verdict uses the geometry test file, boundaries, schema and the byte-identical rebuild.
   A full-repo PASS still needs those two lint errors fixed.
2. **The G3 pass is tight but real.** The worst bmag sample is at 0.974 of the half-unit (4.868e-4 vs 5e-4), and the worst zeta at 0.923.
   This holds only with the exact B_ref = 2.604314 T from the wout file, which is what stella computes. With the rounded header
   value 2.604, the test fails (mutation C2b). The artifact reports the error honestly (`maxAbsError` 4.868e-4).
3. **`provenance.verification.outcome` is `"passed"`** (`artifact.py:102`) because it describes the ρ 0.7 test_2 reproduction.
   Its `details` text says acceptance-129 is blocked, so nothing is hidden. But a UI that read only `provenance.verification.outcome`
   would show "passed". The G10 frontend must show `validation.acceptance129` (BLOCKED), not the provenance outcome.
4. **Weak spots in the tests (none fatal).** `test_vmec_reader_header` (`main/tests/test_geometry.py:41`) does not itself assert
   half-grid placement for |B|/λ. That coverage comes from the G3 test, which fails under mutations C1 and C2. In the G4 test,
   the |B| check (`0.5 < b.min() < b.max() < 1.6`, line ~137) is loose. The along-tube |B| values were confirmed independently
   here to ≤6.3e-7. The schema (`contracts/common.schema.json:22`) allows `passed` for acceptance129; only the G6 test enforces `blocked`.
5. **`.vmec.geo` θ_vmec is printed as θ/nfp.** I confirmed this independently: using the column as printed gives a 0.165 error,
   while θ·nfp reproduces bmag. The author's test relies on this (line ~95), and it is correct.
6. **Frontend G7–G10: absent at the time of Run 1.** Outside this run; they do not affect the G1–G6 verdict. See Run 2.

Verdict scope of Run 1: G1–G6.
Verdict: PASS

## Run 2 — whole task (2026-11-20, commit 2b1607e)
Verifier run: 2026-11-20, commit 2b1607e. The probe copy was taken while `git status --short` was empty, so it equals that commit.
During the run the maintainer committed c6244ec. `git diff --stat 2b1607e c6244ec` is empty for the geometry backend, `main/labyrinth_main/common`,
`main/tests/test_geometry.py`, `artifacts`, `contracts`, `data/raw`, `renderer/src` and the renderer build config, and `verify.sh all` was run once more on a fresh copy of c6244ec (exit 0).

**What was run, and where.**
- `verify.sh renderer` on the shared tree (exit 0).
- `verify.sh all` inside an isolated probe copy (`scripts/probe-copy.sh v01`): five runs on identical bytes, exit 2, 0, 2, 2, 0. The three red runs are explained in finding 10; none has a failing geometry test. One more run on a fresh copy of c6244ec: exit 0.
- Every mutation ran in a probe copy (`v01`, `v01b`). The shared tree was only read. Both copies are deleted.
- Independent probes are the verifier's own scripts (no project imports) and screenshots of the static build at `http://127.0.0.1:4173`.

**Editing note for Run 1.** Run 1's text is kept. Its three sub-headings were demoted one level, the title qualifier moved into the Run 1 heading, and the sentences that described G7–G10 as missing were reworded to say they were absent at that time (the docs gate, `scripts/check_docs.py:46`, reads the old wording as partial verification). No number, command, output or finding of Run 1 was changed.

**The backend changed after Run 1, so G1–G6 were verified again from scratch.** Run 1 checked uncommitted files; its artifact had sha256 `add126aac31f…`. The geometry backend was first committed in 80888d4 and the committed artifact is `3cd6a3d5cdb7…`. The differences visible from Run 1's text: the provenance outcome is now `blocked` (Run 1 finding 3), there is a float64 comparison with stella's `out.nc`, a bisection fallback in the root solve, run parameters parsed from the pinned `.in`, zero-snapping, and three more tests. `status.md` says a later verifier agreed with that state, but this file held no record of it. Since 80888d4 nothing has changed under the geometry backend, its test, the artifact, the contracts or `data/raw` (`git diff --stat 80888d4 HEAD` empty).

### Outcomes
| # | Expected outcome | Test (and which mutations turn it red) | Independent probe | Result |
|---|---|---|---|---|
| G1 | VMEC reader: nfp 5, ns 99; R, Z on the full grid, \|B\|, λ on the half grid, any s | `main/tests/test_geometry.py:87` `test_vmec_reader_header`: header, a_ref, B_ref, 1/ι(0.49), stella's radial weights with extrapolation, and R, Z, \|B\| at s 0.64 against an `np.interp` evaluation to 1e-12. Red for B01 (\|B\| on the full grid) and B03 (R on the half grid). λ on the full grid (B02) is caught by the G3 and G4 tests, not by this one | Own reader with own two-point weights: nfp 5, ns 99, 288 modes, B_ref 2.604314434 T, ι(0.64) 0.9101565 = artifact | PASS |
| G2 | Newton solve of θ* = θ + λ(θ, ζ), tol 1e-12 | `:127` `test_sfl_root_solve_roundtrip` and `:144` `test_sfl_root_solve_falls_back_to_bracketing`. Red for B05 (tol 1e-2) and B06 (λ ignored) | Own bisection solver (no Newton) reproduces stella's float64 bmag to 2.94e-13 and all 258 artifact samples (R, Z ≤ 1.3e-6 m, \|B\| ≤ 7.1e-7) | PASS |
| G3 | stella test_2 (ρ 0.7, 25 samples): every zeta and bmag within half a unit of the 4th significant figure | `:169` `test_reproduces_stella_saved_bmag_to_printed_precision` and `:193` `test_reproduces_stella_float64_bmag`. Red for B01, B02, B04 (B_ref 2.604) and B19 (one reference bmag moved by one unit in the last place) | Own evaluation: 0 of 25 outside the half-unit, worst ratio 0.9736 (bmag) and 0.9227 (zeta), 25 of 25 equal after rounding; against float64 `out.nc` max \|Δ\| 2.940e-13; own max abs and rel error 0.0004867958 and 0.0004266396, equal to the artifact | PASS (still a tight pass, as in Run 1) |
| G4 | ρ 0.8 tubes: bean ζc 0°, triangular ζc 36°, θ* ∈ [−π, π], 129 samples, centred on the outboard midplane, with R, Z, x, y, z and \|B\|/B_ref | `:211` `test_artifact_tubes_129_samples_centered`. Red for B07 (α sign), B08 (128 samples), B09 (ζc 30°), B10 (ρ 0.7), B17 (\|B\| left in tesla), B18 (half a turn) | All 129 samples of both tubes against own solve: max \|ΔR\| 1.3e-6 m, \|ΔZ\| 1.3e-6 m, \|Δbmag\| 7.1e-7, x, y, z 3.4e-6 m, α + ιζ − θ* 8.8e-7 (7-s.f. rounding). Sample 64: θ* 0, ζ = ζc, Z 0, R = max of the cross-section. α = −ιζc | PASS |
| G5 | Gray mesh at s 0.64; plasma-boundary (s 1) cross-sections at each ζc; bean outboard midplane R at ζ 0 in [6.05, 6.25] m, Z ≈ 0 | `:271` `test_surface_and_bean_outboard_midplane`. Red for B20 (θ-major ordering). **Not red** for B13, B14 (duplicated seam), B15 (mesh at s 0.5), B16 (boundary at s 0.9): finding 2 | All 7200 mesh vertices against own s 0.64 evaluation: max 5.0e-7 m, φ-major, φ_i = 2πi/150, θ_j = 2πj/48. Seam gap equals the interior step (rows 0.246–0.265 m, columns 0.033–0.091 m), 7200 distinct vertices. Boundaries against own s 1: max 4.8e-7 m, closed. Bean midplane R 6.13248 m, Z 0 | PASS (the outcome holds; the test is loose) |
| G6 | `validation.acceptance129` = `blocked` with the D-007 reason | `:298` `test_acceptance129_is_blocked_not_passed`. Red for B11 (acceptance `passed`) and B12 (provenance `passed`) | Artifact: outcome `blocked`; details cite D-007, stella 6f60964d and "not in this repo"; `provenance.verification.outcome` is also `blocked`; every source sha256 equals the file | PASS |
| G7 | Three.js scene: gray surface; selected tube coloured by \|B\|; other tube muted; start, centre, end markers | `renderer/src/features/geometry/GeometryView.test.tsx:52` `G7 scene: …`. Asserts closed-torus topology of `surfaceTriangles` on an 8×6 grid (every edge in exactly two triangles, V − E + F = 0, both wrap edges present), the scene model in both themes, the real artifact's index count and marker indices, and the colour-bar title. Red for 12 of 16 mutations (F01–F09, F11–F13). The Three.js adapter is replaced by a recorder at `:28`, so the test covers the scene *model*: finding 1 | (a) Own topology check of the 14400 triangles for the real 150×48 mesh. (b) Scene model against own colormap built from the token literals. (c) The real scene graph from `FluxScene.buildContent` with three r187. (d) Screenshots, both selections, light and dark | PASS |
| G8 | Bean/triangular selector (keyboard accessible) switches the scene, the \|B\|(θ*) plot and the inset | `:136` `G8 …`. Real `SegmentedControl`, focus then ArrowRight and ArrowLeft; checks radio state, focus, scene model, chart series and inset title. Red for F20–F24. Not red for F25 and F27: finding 6 | Real artifact in jsdom (ArrowRight) and in a browser (click): coloured tube, markers, colour-bar range 0.917–1.263 → 0.916–1.282, inset ζ 0° → 36°, chart series, centre R 6.132 → 5.779 m all switch | PASS |
| G9 | Cross-section inset (sampled surface, dashed plasma boundary) and \|B\|(θ*) Plotly chart with units | `:163` `G9 …`. Inset layout numbers, dashed and solid stroke attributes, axis labels with units, chart x and y arrays, summary text. Red for F30–F33 and F36–F38. Not red for F34 and F35: finding 6. The Plotly adapter is replaced by a recorder at `:34` | Artifact: 129 of 129 sampled-surface points inside the s 1 boundary, both tubes. Screenshot: solid curve inside the dashed one, 74 px per 0.5 m on both axes, chart axes "Field-line angle θ* (rad)" and "Field strength \|B\| (B_ref)". The chart summary numbers equal own min, max and centre from the artifact | PASS |
| G10 | Validation panel: stella reference result (samples, max error, pass/fail); acceptance-129 shown as BLOCKED with reason, never as passed | `:205` `G10 …`. Red for F40 (read from `provenance.verification`), F41 and F42 (pill hard-coded), F44–F47 (max error, sample count, reason, callout). Not red for F43 (pass/fail hard-coded to Verified): finding 3 | Real artifact: pill `blocked`, reason and unblock step shown, no "Verified" or "passed" in that section. Cross cases on a mutated artifact: A (acceptance `blocked`, provenance `passed`) → still Blocked; B (acceptance `passed`, provenance `blocked`) → shows Verified (finding 7); C (tracer check false) → Failed | PASS |
| — | Three.js is lazy-loaded | no test (F16 passes the whole renderer gate): finding 4 | `dist`: entry chunk 344 kB holds no three code and reaches it only through a dynamic `import()` of `./three.module-….js` inside an effect; three is a separate 743 kB chunk; `index.html` does not preload it. Browser: `#/budget` loads no three; switching to `#/locate` fetches it. Import site `FluxScene.tsx:147`; the other references (`:7-14`) are type-only | PASS |
| — | Provenance and verification state next to the numbers; nothing replayed shown as live | no test (F48–F50 pass): finding 3 | DOM with the real artifact: badge "Derived, Blocked" on the scene panel with the full record behind it, "Derived" on the chart panel, Verified and Blocked pills in the validation panel, eyebrow "Locate the tubes · replay", shell "Replay · $0"; no `[data-status="live"]` and the word "live" does not occur in the view. The inset panel has no mark of its own (finding 8) | PASS |
| — | Boundary rule | `boundary:self-test`, `boundary:scan` stages | `python3 scripts/check_boundaries.py` → `boundary: OK (142 files scanned)`, exit 0 | PASS |
| — | Honesty: PRD numbers that did not reproduce are visible | G6, G10 | The one PRD acceptance number of this task (129 saved stella samples) is shown as BLOCKED with its reason and the step that would unblock it. The ρ 0.7, 25-sample check is labelled as such and is not presented as the PRD acceptance. The view has no fixture list, so nothing is hidden in one | PASS |

### Real output
```
<scratch> = C:\Users\admin\AppData\Local\Temp\claude\cab28ef23558f274\9a7f397a-27eb-4e8c-9851-59a90e804ccb\scratchpad\v01
Every command was started as   wsl.exe -e bash scripts/dev.sh bash <scratch>/<script>.sh
The line after "$" is what that script ran inside WSL. Lines starting with "#" are the verifier's notes, not output.

# ------------------------------------------------------------------ gates
$ cd /mnt/d/Labyrinth && bash scripts/verify.sh renderer      # shared tree, HEAD=2b1607e, 14:16:28Z, git status --short empty
 Test Files  19 passed (19)
      Tests  582 passed (582)
━━━ verify.sh summary (scope: renderer)
  PASS  boundary:self-test (1s)
  PASS  boundary:scan (28s)
  PASS  renderer:typecheck (14s)
  PASS  renderer:tests (76s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
VERIFY_RENDERER_SHARED_EXIT=0

$ cd ~/.cache/labyrinth-probes/v01 && bash scripts/verify.sh all      # run A1, copy of 2b1607e, 14:13Z; 1-minute load average 31.59 at 14:16:28Z, just after it ended
Error: [vitest-pool]: Failed to start forks worker for test files /home/qqbot/.cache/labyrinth-probes/v01/renderer/src/design/components/components.test.tsx.
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
# the same error for src/design/themes.test.ts, src/design/color.test.ts and src/design/designDoc.test.ts
 ✓ src/features/geometry/GeometryView.test.tsx (4 tests) 384ms
 Test Files  15 passed (15)
      Tests  491 passed (491)
     Errors  4 errors
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (26s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (14s)
  FAIL  renderer:tests (136s)
  PASS  renderer:build (7s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
VERIFY_ALL_COPY_EXIT=2

$ (same command, same copy)                                           # run A2, 14:19:29Z, load 10.59; tree hash 89e286b07eaa…
19 passed in 1.07s
105 passed in 27.15s
artifacts: schema-valid
artifacts: fresh (byte-identical rebuild)
 Test Files  19 passed (19)
      Tests  582 passed (582)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (28s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (21s)
  PASS  renderer:tests (177s)
  PASS  renderer:build (3s)
verify.sh: all stages passed.
VERIFY_ALL_COPY_EXIT=0

$ (same command, same copy, started detached by the verifier: setsid nohup bash … &)      # runs A3 14:49:45Z and A4 14:57:20Z (A4 on an idle machine)
FAILED main/tests/test_server.py::test_H1_signal_terminates_running_workers_before_exit[SIGINT]
FAILED main/tests/test_server.py::test_H1_shutdown_during_in_flight_launch[spawn-outlives-shutdown]
FAILED main/tests/test_server.py::test_H1_shutdown_during_in_flight_launch[late-spawn-cancelled]
3 failed, 102 passed in 114.80s (0:01:54)
 Test Files  19 passed (19)
      Tests  582 passed (582)
  FAIL  main:tests (115s)
# every other stage PASS. Output shown is A4; A3 failed the same three tests (3 failed, 102 passed in 114.75s)
VERIFY_ALL_COPY_EXIT=2
# cause (sig_probe.sh): the signal dispositions a gate inherits under the two launch modes
attached (as runs A1, A2, A5):
{'SIGINT': '<built-in function default_int_handler>', 'SIGTERM': '0', 'SIGHUP': '0', 'SIGQUIT': '0'}
detached with 'setsid nohup bash … &' (as runs A3, A4):
{'SIGINT': '1', 'SIGTERM': '0', 'SIGHUP': '1', 'SIGQUIT': '1'}
copy A test_server.py has the SIGINT reset line: 0   shared working tree: 1   HEAD: 0

$ (same command, same copy, attached)                                 # run A5, 15:05Z, after every probe; tree hash 89e286b07eaa… unchanged
19 passed in 0.77s
105 passed in 25.38s
 Test Files  19 passed (19)
      Tests  582 passed (582)
  PASS  main:tests (26s)
  PASS  renderer:tests (136s)
verify.sh: all stages passed.
VERIFY_ALL_COPY_EXIT=0

$ bash scripts/probe-copy.sh v01 && cd <copy> && bash scripts/verify.sh all && rm -rf <copy>      # fresh copy of HEAD=c6244ec, 15:10Z
21 passed in 0.85s
127 passed in 25.28s
 Test Files  19 passed (19)
      Tests  582 passed (582)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (25s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (1s)
  PASS  renderer:typecheck (10s)
  PASS  renderer:tests (150s)
  PASS  renderer:build (3s)
verify.sh: all stages passed.
VERIFY_ALL_HEAD_COPY_EXIT=0

# ------------------------------------------------------------------ named tests, each on its own (shared tree, HEAD=2b1607e, 14:28:48Z)
$ python3 scripts/check_boundaries.py
boundary: OK (142 files scanned)
EXIT=0
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_geometry.py -v
collected 9 items
main/tests/test_geometry.py .........                                    [100%]
============================== 9 passed in 3.42s ===============================
EXIT=0
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_geometry.py::test_vmec_reader_header
1 passed in 1.83s
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_geometry.py::test_sfl_root_solve_roundtrip
1 passed in 1.65s
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_geometry.py::test_reproduces_stella_saved_bmag_to_printed_precision
1 passed in 2.31s
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_geometry.py::test_artifact_tubes_129_samples_centered
1 passed in 2.72s
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_geometry.py::test_surface_and_bean_outboard_midplane
1 passed in 2.12s
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_geometry.py::test_acceptance129_is_blocked_not_passed
1 passed in 2.05s
$ npm --prefix renderer run -s test -- src/features/geometry/GeometryView.test.tsx -t "G7 " --reporter=verbose
 ✓ src/features/geometry/GeometryView.test.tsx > G7 scene: gray closed surface (seam wrapped), selected tube coloured by |B|, other muted, start/centre/end markers 206ms
      Tests  1 passed | 3 skipped (4)
EXIT=0
$ npm --prefix renderer run -s test -- src/features/geometry/GeometryView.test.tsx -t "G8 " --reporter=verbose
 ✓ src/features/geometry/GeometryView.test.tsx > G8 bean/triangular selector is keyboard accessible and switches the scene, the |B| plot and the inset 225ms
      Tests  1 passed | 3 skipped (4)
EXIT=0
$ npm --prefix renderer run -s test -- src/features/geometry/GeometryView.test.tsx -t "G9 " --reporter=verbose
 ✓ src/features/geometry/GeometryView.test.tsx > G9 cross-section inset (solid sampled surface, dashed boundary) and |B|(θ*) chart with units 160ms
      Tests  1 passed | 3 skipped (4)
EXIT=0
$ npm --prefix renderer run -s test -- src/features/geometry/GeometryView.test.tsx -t "G10 " --reporter=verbose
 ✓ src/features/geometry/GeometryView.test.tsx > G10 validation panel: stella reference result, and acceptance-129 shown as BLOCKED with its reason, never passed 221ms
      Tests  1 passed | 3 skipped (4)
EXIT=0
$ npm --prefix renderer run -s test -- src/features/geometry
 ✓ src/features/geometry/GeometryView.test.tsx (4 tests) 354ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
EXIT=0

# ------------------------------------------------------------------ git (read-only)
$ git log -1 --format="%h %ad %s" --date=iso 0884d0b
0884d0b 2026-11-19 22:03:32 +0000 status: 00 re-verify, 01 backend built and under verification
$ git ls-tree -r --name-only 0884d0b -- main/labyrinth_main/features/geometry main/tests/test_geometry.py artifacts/geometry.json
main/labyrinth_main/features/geometry/__init__.py
$ git log --format="%h %ad %s" --date=iso -- main/labyrinth_main/features/geometry
80888d4 2026-11-20 12:48:27 +0000 Backend data features: geometry, transport, forecast, budget, spatial (verified)
ecf14d5 2026-11-19 21:52:18 +0000 Scaffold Labyrinth: process boundary, exit-2 verify loop, contracts, agents
$ git diff --stat 80888d4 HEAD -- main/labyrinth_main/features/geometry main/tests/test_geometry.py artifacts/geometry.json contracts/geometry.schema.json contracts/common.schema.json data/raw
(end of diff --stat; empty = identical)
$ git show 80888d4:artifacts/geometry.json | sha256sum
3cd6a3d5cdb797edef8be1259b72a1047d8224d3ded3489bec4b90672b819d9c  -
$ git log --format="%h %ad %s" --date=iso 2b1607e..HEAD
c6244ec 2026-11-20 15:07:01 +0000 Wave 1: live-GX stop safety fixed and tested; whole-task verifier runs; review findings recorded
$ git diff --stat 2b1607e HEAD -- main/labyrinth_main/features/geometry main/labyrinth_main/common main/tests/test_geometry.py artifacts contracts data/raw renderer/src renderer/package.json renderer/package-lock.json renderer/vite.config.ts renderer/tsconfig.json
(end; empty = no change on these paths)

# ------------------------------------------------------------------ backend probe (probe_backend.py: own netCDF reader, own weights, own bisection; no labyrinth_main import)
G1 own reader: nfp=5 ns=99 mnmax=288 mnmax_nyq=288
   B_ref=2.604314434 T  a=0.494417 m
G3 input: torflux=0.49 nfield_periods=6.073867 nzed=24
   reference rows: 25; own samples: 25
   own bmag vs printed: worst |d|/half-unit = 0.9736; outside half-unit: 0/25; equal after rounding to 4 s.f.: 25/25
   own zeta vs printed: worst |d|/half-unit = 0.9227
   max |own bmag - printed| = 4.8680e-04
   own bmag vs stella float64 out.nc: max |d| = 2.940e-13 over 25 samples; own zed vs out.nc zed max |d| = 4.441e-16
   artifact stellaReference: samplesCompared=25 maxAbsError=0.0004867958 maxRelError=0.0004266396 allWithinPrintedPrecision=True
   own maxAbsError=0.0004867958 own maxRelError=0.0004266396
G4 own iota(0.64)=0.9101565 artifact surface.iota=0.9101565 rho=0.8 s=0.64
   tube ids: ['bean', 'triangular']
   bean       zc=0.0 nSamples=129 len=129 thetaStar[0]=-3.1415930 [-1]=3.1415930 monotone=True alpha=0.0000000 own -iota*zc=-0.0000000
      centre[64]: thetaStar=0.0 zeta=0.0000000 (zc=0.0000000) R=6.132478 Z=0.0; max crossSection R=6.132478
      all 129 samples vs own solve: max|dR|=1.13e-06 max|dZ|=6.77e-07 max|d bmag|=7.06e-07 max|d x,y,z|=2.85e-06 max|alpha+iota*zeta-thetaStar|=8.42e-07
      bmag min=0.9170504 max=1.2630680 bmagRange=[0.9170504, 1.263068]; dzeta span=6.9034120 own 2pi/iota=6.9034123
      crossSection: n=129 closed=True
   triangular zc=36.0 nSamples=129 len=129 thetaStar[0]=-3.1415930 [-1]=3.1415930 monotone=True alpha=-0.5718682 own -iota*zc=-0.5718682
      centre[64]: thetaStar=0.0 zeta=0.6283185 (zc=0.6283185) R=5.779406 Z=0.0; max crossSection R=5.779406
      all 129 samples vs own solve: max|dR|=1.28e-06 max|dZ|=1.29e-06 max|d bmag|=6.33e-07 max|d x,y,z|=3.40e-06 max|alpha+iota*zeta-thetaStar|=8.82e-07
      bmag min=0.9159186 max=1.2820820 bmagRange=[0.9159186, 1.282082]; dzeta span=6.9034130 own 2pi/iota=6.9034123
      crossSection: n=129 closed=True
G5 nTheta=48 nPhi=150 len(positions)=21600 expected=21600
   all 7200 mesh vertices vs own s=0.64 evaluation (phi-major, phi_i=2pi i/nPhi, theta_j=2pi j/nTheta): max|d|=5.00e-07
   seam not duplicated: |row0-row(nPhi-1)| min=0.2461 max=0.2646 m (interior row step min=0.2461 max=0.2646);
                        |col0-col(nTheta-1)| min=0.0327 max=0.0906 m (interior col step min=0.0327 max=0.0906)
   distinct vertices: 7200 of 7200
   bean outboard midplane (phi 0, theta 0): R=6.13248 Z=0.0 y=0.0
   boundary[bean] n=129 closed=True vs own s=1: max|d|=4.78e-07; R 5.515..6.174 Zmax 0.832
   boundary[triangular] n=129 closed=True vs own s=1: max|d|=4.75e-07; R 4.612..5.928 Zmax 0.457
G6 validation.acceptance129.outcome='blocked'
   details: BLOCKED (decision D-007): the PRD acceptance test compares bean |B| with 129 saved stella samples at rho 0.8, but those samples are not in this repo or at the cited stella commit 6f60964d (only rho 0.7 W7-X VMEC outputs with 13-25 samples exist there: test_2, test_5, test_7). The tracer is instead validated against stella's saved rho 0.7 geometry (25 samples). Unblock: add the stella .geometry/.out.nc file holding the 129 samples to data/raw/.
   provenance.kind='derived' provenance.verification.outcome='blocked'
   source data/raw/wout_w7x_kjm.nc: sha256 matches file = True
   source data/raw/stella_test2_vmec_geometry.geometry: sha256 matches file = True
   source data/raw/stella_test2_vmec_geometry.out.nc: sha256 matches file = True
artifact sha256: 3cd6a3d5cdb797edef8be1259b72a1047d8224d3ded3489bec4b90672b819d9c
PROBE_EXIT=0

# ------------------------------------------------------------------ backend mutations (mutate.py backend; probe copy; python3 -m pytest -q -p no:cacheprovider main/tests/test_geometry.py)
BASELINE rc=0 -> [] 9 passed in 0.52s
  RED      B01 [G1/G3] |B| read on the full grid
  RED      B02 [G1/G3] lambda read on the full grid
  RED      B03 [G1] R read on the half grid
  RED      B04 [G3] B_ref = 2.604 (rounded header value)
  RED      B05 [G2] Newton tolerance 1e-2
  RED      B06 [G2] tracer ignores lambda (theta = theta*)
  RED      B07 [G4] alpha sign flipped
  RED      B08 [G4] 128 samples
  RED      B09 [G4] triangular tube centred at 30 deg
  RED      B10 [G4] rho 0.7
  RED      B11 [G6] acceptance129 outcome passed
  RED      B12 [G6] provenance outcome passed
  SURVIVED B13 [G5] surface mesh duplicates the phi seam (linspace incl. endpoint)
  SURVIVED B14 [G5] surface mesh duplicates the theta seam
  SURVIVED B15 [G5] surface mesh built at s 0.5 instead of 0.64
  SURVIVED B16 [G5] boundary cross-sections at s 0.9 instead of 1
  RED      B17 [G4] bmag left in tesla (not divided by B_ref)
  RED      B18 [G4] tube spans half a poloidal turn
  RED      B19 [G3] reference file: one printed bmag changed by one unit in the last place
  RED      B20 [G5] surface mesh theta-major (phi and theta loops swapped)
RESTORED rc=0 -> [] 9 passed in 0.47s
restored sha256 identical to pristine: True
# which tests went red, three examples
B01 failed=['test_acceptance129_is_blocked_not_passed', 'test_artifact_tubes_129_samples_centered', 'test_reproduces_stella_float64_bmag', 'test_reproduces_stella_saved_bmag_to_printed_precision', 'test_vmec_reader_header']
B11 failed=['test_acceptance129_is_blocked_not_passed']
B20 failed=['test_surface_and_bean_outboard_midplane']

# ------------------------------------------------------------------ frontend probes (zzprobe.test.tsx ran in the probe copy; analyze_frontend.py is the verifier's own check of what it dumped)
== surface triangulation produced by model.surfaceTriangles(150, 48)
  [ok] index count = 6 * nPhi * nTheta — 43200 indices, 14400 triangles (expected 14400)
  [ok] index range 0..V-1 — min 0 max 7199
  [ok] every vertex used, each exactly 6 times (regular closed grid) — 7200 of 7200 vertices used; valence set [6]
  [ok] no index-degenerate triangle
  [ok] no zero-area triangle on the real positions — area min 3.405e-03 max 1.163e-02 m^2, total 104.36 m^2
  [ok] every edge shared by exactly 2 triangles (closed surface, no boundary edge) — 21600 edges; multiplicities {2: 21600}
  [ok] consistent winding (each directed edge once, its reverse once)
  [ok] Euler characteristic V - E + F = 0 (torus) — 7200 - 21600 + 14400 = 0
  [ok] one connected component
  [ok] every edge joins periodic grid neighbours (no long edge across the torus) — 0 bad edges
  [ok] each of the nPhi*nTheta periodic cells is covered by exactly 2 triangles on its 4 corners — 7200 cells
  [ok] phi seam closed: 2*nTheta triangles join row nPhi-1 to row 0 — 96 (expected 96)
  [ok] theta seam closed: 2*nPhi triangles join column nTheta-1 to column 0 — 300 (expected 300)
  [ok] longest triangle edge is a grid step or cell diagonal (< 0.30 m), not a chord across the surface — edge length min 0.0269 max 0.2823 m
  (contrast: a non-wrapping triangulation would have 14006 triangles and 392 boundary edges)
== wireframe produced by model.surfaceWire(150, 48)
  [ok] segment count = 50 poloidal circles * 48 + 24 toroidal curves * 150 — 6000 (expected 6000)
  [ok] every wire curve is closed (all wire vertices have even degree) — degrees {4: 1200, 2: 3600}
  [ok] wire includes the wrap segments in both directions
== scene model (model.buildSceneModel) vs own computation from the artifact + token literals
  [ok] bean/light: selected tube has per-sample colours = colormap((|B|-min)/(max-min)) — max |d| 2.73e-08; |B|/B_ref 0.9171..1.2631; bmagRange in artifact [0.9170504, 1.263068]
  [ok] bean/light: other tube (triangular) has NO |B| colours, is muted (opacity < 1) and thinner — opacity 0.35 radius 0.028 vs selected 0.044800000000000006 colour #a8482a
  [ok] bean/light: markers start/centre/end at samples 0 / 64 (theta*=0) / 128 of the selected tube
  [ok] bean/light: surface colours are the gray tokens and independent of the selection — line #b8c6cc fill #eef2f4 (HLS saturation 0.16, 0.21; channel spread 0.078)
  [ok] triangular/dark: selected tube has per-sample colours = colormap((|B|-min)/(max-min)) — max |d| 2.90e-08; |B|/B_ref 0.9159..1.2821; bmagRange in artifact [0.9159186, 1.282082]
  [ok] triangular/dark: surface colours are the gray tokens and independent of the selection — line #3c4d55 fill #162228 (HLS saturation 0.17, 0.29; channel spread 0.098)
  [ok] selection changes what is highlighted (coloured tube and markers differ; surface identical)
# the same checks pass for triangular/light and bean/dark
== real Three.js scene graph from FluxScene.buildContent (three r187, light theme)
  bean: children = [('Mesh', 'BufferGeometry'), ('LineSegments', 'BufferGeometry'), ('Mesh', 'TubeGeometry'), ('Mesh', 'TubeGeometry'), ('Mesh', 'BoxGeometry'), ('Mesh', 'BoxGeometry'), ('Mesh', 'SphereGeometry'), ('Mesh', 'SphereGeometry'), ('Mesh', 'ConeGeometry'), ('Mesh', 'ConeGeometry')]
  [ok] bean: surface fill mesh = 7200 vertices, 43200 indices, gray token colour, no vertex colours — colour #eef2f4 opacity 0.35
  [ok] bean: surface wireframe = LineSegments, 12000 indices, gray token colour, no vertex colours — colour #b8c6cc
  [ok] bean: bean tube follows the artifact samples — 513 rings; max distance of a ring centre from the sample polyline 7.32 mm
  [ok] bean: SELECTED tube (bean) carries per-vertex colours that equal colormap(|B|) at the nearest point of the field line (criterion: < 0.02 sRGB within 0.6 of one sample spacing, and > 20x below a 4-sample displacement) — max sRGB |d| 0.0128 allowing a shift of <= 0.6 sample (largest shift needed 0.20); 0.0404 with no shift allowed; 0.0002 when the neighbouring samples' colours (not |B|) are interpolated; contrast: displaced by 4 samples 0.62; 513 rings; within-ring spread 0.0e+00; opacity 1
  [ok] bean: UNSELECTED tube (triangular) has no vertex colours, flat identity colour, transparent — colour #a8482a opacity 0.35
  [ok] bean: markers = box (start, sample 0), sphere (centre, sample 64), cone (end, sample 128), each with a halo, on the SELECTED tube — [('BoxGeometry', 1), ('BoxGeometry', 1.45), ('SphereGeometry', 1), ('SphereGeometry', 1.45), ('ConeGeometry', 1), ('ConeGeometry', 1.45)]
  [ok] triangular: SELECTED tube (triangular) carries per-vertex colours that equal colormap(|B|) at the nearest point of the field line (criterion: < 0.02 sRGB within 0.6 of one sample spacing, and > 20x below a 4-sample displacement) — max sRGB |d| 0.0163 allowing a shift of <= 0.6 sample (largest shift needed 0.26); 0.0302 with no shift allowed; 0.0002 when the neighbouring samples' colours (not |B|) are interpolated; contrast: displaced by 4 samples 0.59; 513 rings; within-ring spread 0.0e+00; opacity 1
  [ok] triangular: UNSELECTED tube (bean) has no vertex colours, flat identity colour, transparent — colour #0b7f80 opacity 0.35
== DOM rendered by the real GeometryView (adapters recorded), real artifact
  -- real artifact, bean (default)
     provenance badge: Provenance of field-line geometry: Derived, Blocked
     pills: [('derived', 'Derived', 'Field lines on the ρ = 0.8 flux surface'), ('blocked', 'Blocked', 'Field lines on the ρ = 0.8 flux surface'), ('derived', 'Derived', 'Field strength along the line, |B|(θ*)'), ('passed', 'Verified', 'Tracer vs stella saved geometry (ρ 0.7)'), ('blocked', 'Blocked', 'PRD acceptance: bean |B| vs all 129 saved stella samples (ρ 0.8)')]
     acceptance129 pill: blocked / 'Blocked'
     live pill present: False; word 'live' in text: False; eyebrows: ['Locate the tubes · replay', 'Bean tube', 'Bean tube', 'Locate the tubes']
     colour bar: Colour bar: Bean (ζ = 0°) coloured by |B| / B_ref from 0.917 (dark) to 1.263 (light) | text '|B| / Bref0.9171.0901.263'
     stats: ['Centre R: 6.132 m', 'Centre Z: 0.000 m', 'Field-line label α: 0.0000 rad', 'Samples: 129', 'Samples compared: 25', 'Max |Δ| in |B|: 0.000487 B ref', 'Max relative Δ: 0.0427 %']
  props bean: {"sceneSelected": "bean", "colouredTube": ["bean"], "mutedTube": ["triangular@0.35"], "chartSeries": "Bean (ζ = 0°): |B| at 129 samples", "chartN": 129, "chartY0": 1.060369, "chartAxes": ["Field-line angle θ* (rad)", "Field strength |B| (B<sub>ref</sub>)"]}
  -- real artifact, triangular (keyboard ArrowRight)
     colour bar: Colour bar: Triangular (ζ = 36°) coloured by |B| / B_ref from 0.916 (dark) to 1.282 (light) | text '|B| / Bref0.9161.0991.282'
     stats: ['Centre R: 5.779 m', 'Centre Z: 0.000 m', 'Field-line label α: minus 0.5719 rad', 'Samples: 129', 'Samples compared: 25', 'Max |Δ| in |B|: 0.000487 B ref', 'Max relative Δ: 0.0427 %']
  props triangular: {"sceneSelected": "triangular", "colouredTube": ["triangular"], "mutedTube": ["bean@0.35"], "chartSeries": "Triangular (ζ = 36°): |B| at 129 samples", "chartN": 129, "chartY0": 1.067601, "chartAxes": ["Field-line angle θ* (rad)", "Field strength |B| (B<sub>ref</sub>)"]}
  -- CASE A: validation.acceptance129=blocked, provenance.verification.outcome=passed
     provenance badge: Provenance of field-line geometry: Derived, Verified
     acceptance129 pill: blocked / 'Blocked'
  -- CASE B: validation.acceptance129=passed, provenance.verification.outcome=blocked
     provenance badge: Provenance of field-line geometry: Derived, Blocked
     acceptance129 pill: passed / 'Verified'
     acceptance129 text: PRD acceptance: bean |B| vs all 129 saved stella samples (ρ 0.8)VerifiedBLOCKED (decision D-007): the PRD acceptance test compares bean |B| with 129 saved stella samples at rho 0.8, but those samples are not in this repo or at the cited stella commit 6f60964d 
  -- CASE C: stellaReference.allWithinPrintedPrecision=false
     pills: [('derived', 'Derived', 'Field lines on the ρ = 0.8 flux surface'), ('blocked', 'Blocked', 'Field lines on the ρ = 0.8 flux surface'), ('derived', 'Derived', 'Field strength along the line, |B|(θ*)'), ('failed', 'Failed', 'Tracer vs stella saved geometry (ρ 0.7)'), ('blocked', 'Blocked', 'PRD acceptance: bean |B| vs all 129 saved stella samples (ρ 0.8)')]
FRONTEND PROBE: ALL CHECKS OK
ANALYZE_EXIT=0
$ python3 -I <scratch>/probe_inset.py /mnt/d/Labyrinth
bean       zetaDeg=0.0 sampled-surface points inside the s=1 boundary: 129/129; closed polylines: True, True; tube centre (sample 64: R 6.132478, Z 0.0) lies on the sampled curve within 0.0e+00 m; R range sampled 5.649..6.132, boundary 5.515..6.174
           chart: 129 samples, theta* -3.142..3.142; |B| min 0.9171 at theta* -2.847, max 1.2631 at theta* -2.209; centre 1.0876
triangular zetaDeg=36.0 sampled-surface points inside the s=1 boundary: 129/129; closed polylines: True, True; tube centre (sample 64: R 5.779406, Z 0.0) lies on the sampled curve within 0.0e+00 m; R range sampled 4.721..5.779, boundary 4.612..5.928
           chart: 129 samples, theta* -3.142..3.142; |B| min 0.9159 at theta* -2.258, max 1.2821 at theta* -2.847; centre 0.9833
# UI text for the same numbers (browser, static build):
#   Bean (ζ = 0°): 129 samples over θ* −3.142 to 3.142 rad. |B| ranges from 0.9171 B_ref (θ* −2.847 rad) to 1.2631 B_ref (θ* −2.209 rad); centre (θ* 0) 1.0876 B_ref.
#   Triangular (ζ = 36°): 129 samples over θ* −3.142 to 3.142 rad. |B| ranges from 0.9159 B_ref (θ* −2.258 rad) to 1.2821 B_ref (θ* −2.847 rad); centre (θ* 0) 0.9833 B_ref.

# ------------------------------------------------------------------ frontend mutations (mutate.py frontend; probe copies; npm --prefix renderer run -s test -- src/features/geometry/GeometryView.test.tsx --reporter=json)
BASELINE rc=0 -> {'G7': 'passed', 'G8': 'passed', 'G9': 'passed', 'G10': 'passed'}
# The harness ran as three pieces: a first attached run (stopped by the verifier after F01, then restarted detached) and two
# detached streams in the copies v01 and v01b. The F01 line is rewritten in the summary format; its log line was
#   F01 [G7] no phi wrap in surfaceTriangles (open seam between last and first phi row)  -> RED (target test red) rc=1 failed=['G7']
# The other 42 lines are the two streams' SUMMARY lines, merged in id order.
  RED      F01 [G7] no phi wrap in surfaceTriangles (open seam between last and first phi row)
  RED      F02 [G7] no theta wrap in surfaceTriangles (open seam between last and first theta column)
  RED      F03 [G7] gridIndex does not wrap theta (flat index runs into the next phi row)
  RED      F04 [G7] gridIndex clamps phi instead of wrapping (degenerate seam triangles)
  RED      F05 [G7] selected tube gets no |B| colours
  RED      F06 [G7] both tubes coloured by |B| (other tube not muted)
  RED      F07 [G7] unselected tube opacity 1
  RED      F08 [G7] |B| colour normalised by a fixed [0, 2] instead of the tube's bmagRange
  RED      F09 [G7] surface wireframe takes the bean series colour instead of gray
  SURVIVED F10 [G7] surface FILL takes the bean series colour instead of gray
  RED      F11 [G7] centre marker placed at sample 0
  RED      F12 [G7] markers taken from the unselected tube
  RED      F13 [G7] colour bar loses its |B| / B_ref title
  SURVIVED F14 [G7] colour bar loses its numeric ticks (unlabelled scale)
  SURVIVED F15 [G7] FluxScene adapter paints the surface fill in a tube colour (adapter is mocked in tests)
  SURVIVED F16 [G7] three imported statically (no lazy load)
  RED      F20 [G8] selector onChange is a no-op
  RED      F21 [G8] |B| chart always shows the bean tube
  RED      F22 [G8] cross-section inset always shows the bean tube
  RED      F23 [G8] scene model always built for bean
  RED      F24 [G8] SegmentedControl ignores the keyboard
  SURVIVED F25 [G8] inset plasma boundary stays the bean boundary after switching
  SURVIVED F27 [G8] colour-bar range stays the bean range after switching
  RED      F30 [G9] plasma boundary not dashed
  RED      F31 [G9] |B| axis loses its unit
  RED      F32 [G9] theta* axis loses its unit
  RED      F33 [G9] chart plots R instead of |B|
  SURVIVED F34 [G9] inset Z axis drawn at half scale (unequal aspect)
  SURVIVED F35 [G9] inset draws the boundary curve in place of the sampled surface
  RED      F36 [G9] inset R axis loses its unit
  RED      F37 [G9] inset boundary path built from the sampled surface
  RED      F38 [G9] chart x axis uses zeta instead of theta*
  RED      F40 [G10] acceptance-129 read from provenance.verification instead of validation.acceptance129
  RED      F41 [G10] acceptance-129 pill hard-coded to blocked
  RED      F42 [G10] acceptance-129 pill hard-coded to passed
  SURVIVED F43 [G10] stella-reference pill hard-coded to Verified (ignores allWithinPrintedPrecision)
  RED      F44 [G10] max error shown as 0
  RED      F45 [G10] samples compared shown as 129
  RED      F46 [G10] blocked reason text dropped
  RED      F47 [G10] blocked callout not rendered for a blocked outcome
  SURVIVED F48 [G10] provenance badge removed from the scene panel
  SURVIVED F49 [G10] scene panel eyebrow says live instead of replay
  SURVIVED F50 [G10] chart panel shows a LIVE pill on replayed data
RESTORED rc=0 -> {'G7': 'passed', 'G8': 'passed', 'G9': 'passed', 'G10': 'passed'}
restored sha256 identical to pristine: True
# how three of them failed
F01 G7: AssertionError: expected false to be true // Object.is equality
F03 G7: AssertionError: expected 48 to be 47 // Object.is equality
F41 G10: AssertionError: expected null not to be null
# all 12 survivors applied together (type-clean variants; F14 as reversed tick labels), then the whole renderer gate, probe copy v01b, 15:01:42Z
$ bash scripts/verify.sh renderer
 ✓ src/features/geometry/GeometryView.test.tsx (4 tests) 222ms
 Test Files  19 passed (19)
      Tests  582 passed (582)
dist/assets/index-CwJbStGj.js             1,087.43 kB │ gzip:   296.24 kB
dist/assets/plotly.min-Cm9H_uKN.js        4,651.96 kB │ gzip: 1,422.29 kB
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  renderer:typecheck (10s)
  PASS  renderer:tests (142s)
  PASS  renderer:build (3s)
verify.sh: all stages passed.
VERIFY_RENDERER_MUTANT_EXIT=0
mutant entry chunk: index-CwJbStGj.js 1087431 bytes; THREE.* message strings inside: 4; files named three*: 0
# a first attempt at 14:48:31Z exited 2 because the shared renderer/node_modules was being reinstalled (14:49:49–14:50:37Z):
Error: Cannot find module '/mnt/d/Labyrinth/renderer/node_modules/vitest/suppress-warnings.cjs'

# ------------------------------------------------------------------ lazy loading of three
$ ls -l renderer/dist/assets          # bytes, shared dist; the probe-copy builds produced the same file names
10528 Gallery-FHFM4YrV.js
3795 Gallery-HuXzu4Bj.css
61442 index-2hdb9thG.css
344213 index-D6civ2KJ.js
4651969 plotly.min-CDaxrom7.js
599 rolldown-runtime-WkwZ5CU-.js
742801 three.module-CeVBJVoU.js
== import( occurrences in entry
      1 import(`./Gallery-FHFM4YrV.js`)
      2 import(`./plotly.min-CDaxrom7.js`)
      1 import(`./three.module-CeVBJVoU.js`)
== library-body signatures (strings that exist only inside three itself)
index-D6civ2KJ.js: THREE.* message strings=0  isWebGLRenderer/gl_Position occurrences=0
three.module-CeVBJVoU.js: THREE.* message strings=4  isWebGLRenderer/gl_Position occurrences=15
== modulepreload links
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-WkwZ5CU-.js">
# browser pane, fresh tab, performance.getEntriesByType('resource') after loading http://127.0.0.1:4173/#/budget
"/assets/index-D6civ2KJ.js script","/assets/rolldown-runtime-WkwZ5CU-.js other","/assets/index-2hdb9thG.css link","/artifacts/budget.json fetch","/api/live/status fetch","/api/live/status fetch"
# then after switching the same tab to #/locate
…,"/artifacts/geometry.json fetch","/assets/plotly.min-CDaxrom7.js script","/assets/three.module-CeVBJVoU.js script"],"canvases":["803x438 in geo-scene__canvas"]

# ------------------------------------------------------------------ screenshots
Start-Process -FilePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList @("--headless=new","--no-first-run","--hide-scrollbars","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--user-data-dir=<scratch>\profile","--window-size=1440,2400","--virtual-time-budget=15000","--screenshot=<scratch>\locate_bean.png","http://127.0.0.1:4173/#/locate") -Wait -NoNewWindow
326462 bytes written to file <scratch>\locate_bean.png
# served artifact: sha256 3cd6a3d5cdb797edef8be1259b72a1047d8224d3ded3489bec4b90672b819d9c (same as the committed one)
# WebGL rendered (software). Seen: closed gray wireframe torus; bean line coloured dark blue to yellow, triangular line faint;
# square, circle and triangle markers; colour bar "|B| / B_ref" 0.917, 1.090, 1.263; pills Derived and Blocked beside the title;
# inset with a solid curve inside a dashed one; chart with both axis titles and units; validation panel: Verified (25, 0.000487 B_ref,
# 0.0427 %, 2.9 × 10^-13) and Blocked with the D-007 reason and "To unblock: …". Header: "Replay · $0".
# Triangular selection and the dark theme were looked at in the browser pane (click on the radio; prefers-color-scheme emulation).

# ------------------------------------------------------------------ tree state at the end
$ git status --short
 M tasks/01-geometry/VERIFY.md
probe copies left that belong to this verifier: 0
```

### Findings
No product defect was found: every outcome holds on the committed artifact and in the running build. The findings are about what the tests would not notice, and about the gates.

**Major (test gaps)**
1. **The Three.js and Plotly adapters are never executed by a test.** `GeometryView.test.tsx:28-39` replaces `./FluxScene` and `./PlotlyChart` with recorders, `renderer/src/shell/App.test.tsx:10` replaces the whole view, and no other test imports this folder. So `FluxScene.tsx:28-112` (`buildContent`: materials, the per-ring \|B\| colour mapping, marker shapes) and `PlotlyChart.tsx:21-59` have no coverage. F15 (the adapter paints the surface in a tube colour) passes the full renderer gate. The G7 test is a real test of the scene model (12 mutations turn it red), but that the model becomes the right Three.js objects rests on probe (c) and the screenshots of this run. Fix: export `buildContent` and add a node-environment test that builds it with real `three`, as probe (c) does, asserting gray materials, vertex colours on the selected tube only and six marker meshes; mock `three` and `plotly.js-dist-min` at the library level, as the transport view does, instead of the adapter modules.
2. **The G5 backend test does not pin what G5 states.** `main/tests/test_geometry.py:271-294`: four of five G5 mutations pass all nine tests — a duplicated φ seam (B13), a duplicated θ seam (B14), the mesh built at s 0.5 (B15), the boundary taken at s 0.9 (B16). The renderer's triangulation depends on the no-seam convention (`contracts/geometry.schema.json:33`). The committed artifact is right (probe above), and `artifacts:fresh` only proves that the artifact equals the code. Fix: compare every mesh vertex with `_Independent(0.64)` and both boundary curves with `_Independent(1.0)`; assert that row nPhi−1 differs from row 0, column nTheta−1 from column 0, and that row 1 sits at φ = 2π/nPhi.
3. **Nothing tests the failing branch of the tracer check or the honesty labels of this view.** These pass every test: F43 (pill hard-coded to Verified whatever `allWithinPrintedPrecision` says, `ValidationPanel.tsx:35-43`), F48 (provenance badge removed, `GeometryView.tsx:62`), F49 (eyebrow says live, `GeometryView.tsx:59`), F50 (a LIVE pill on the replayed chart, `GeometryView.tsx:129`). The code is right today: case C renders Failed, there is no live pill, the eyebrow says replay. Fix: in G10 render a fixture with `allWithinPrintedPrecision: false` and expect Failed; assert the provenance badge's accessible name, the replay eyebrow and the absence of `[data-status="live"]`.

**Minor**
4. **Lazy loading of three has no guard.** F16 (static import, `FluxScene.tsx:147`) passes typecheck, all 582 tests and the build; the entry chunk grows from 344 kB to 1087 kB. Fix: a build test that fails when the entry chunk contains a three-only string or exceeds a size budget.
5. **G7 does not assert the surface fill colour or the colour-bar ticks.** F10 (`model.ts:167`) and F14 (`ColorBar.tsx:14-18`) pass; reversed tick labels pass too. The test checks only `surface.line` (`GeometryView.test.tsx:84`) and the bar's title and gradient (`:130-132`). Fix: assert `surface.fill` against the token and the three tick texts against `bmagRange`.
6. **G8 and G9 do not look at the curves or the scale after a switch.** These pass: F25 (dashed boundary stays the bean one, `GeometryView.tsx:115`), F27 (colour-bar range stays the bean one, `GeometryView.tsx:53`), F34 (Z drawn at half scale although the subtitle says "equal R and Z scale", `model.ts:368`), F35 (the component draws the boundary path as the sampled surface, `CrossSectionInset.tsx:56`). The fixture gives both tubes the same \|B\| values (`fixture.ts:13`), so a stale range could not be seen even if it were asserted. Fix: give the fixture tubes different \|B\|; after ArrowRight assert the colour-bar label and the two path `d` attributes against `insetLayout` for the triangular tube; assert `Y` scale = `X` scale.
7. **The view shows whatever outcome the artifact carries for acceptance-129.** With `validation.acceptance129.outcome: "passed"` the panel shows a Verified pill beside details that still begin with BLOCKED (case B; `ValidationPanel.tsx:18-19,71-83`). It reads the right field and ignores `provenance.verification.outcome` (case A), as `interface.md` §2 asks. Only the backend test stops `passed` (B11); the schema allows it (`contracts/geometry.schema.json:115-118`, already listed in `interface.md` §10). Fix: tighten the schema to `const: "blocked"` by a decision entry until the 129 samples exist.
8. **Two provenance marks are weaker than the rule "next to every number".** The chart panel's pill is the literal `derived` (`GeometryView.tsx:129`), not `g.provenance.kind`. The inset panel (`GeometryView.tsx:108-122`) shows four numbers with no mark in that panel. Fix: pass `g.provenance.kind` and add the badge or a pill to the inset panel.
9. **The float64 figure is scraped from prose.** `model.ts:397-402` reads "2.9e-13 over 25 samples" out of `provenance.verification.details` with a regex; G10 checks the regex against fixture text only (`GeometryView.test.tsx:207`, `fixture.ts:70-72`). If the backend rewords the sentence the line disappears without a failing test. Fix: assert `float64Match(real.provenance.verification.details)` is not null in the part of G7 that loads the real artifact, or add a structured field by a contract change.
10. **Gate runs that were red (none in a geometry test).** A1: four vitest worker forks failed to start while seven agents had the load average near 30; all 491 tests that ran passed; exit 2. A3, A4: three `main/tests/test_server.py::test_H1_*` tests timed out because the verifier started those two runs detached, which hands the gate an ignored SIGINT; the test file at 2b1607e does not reset it, the one at c6244ec does (`main/tests/test_server.py:440`). The same bytes are green when started normally (A2, A5), and so is c6244ec. For the maintainer: `verify.sh` can go red under heavy parallel load with no failing assertion.
11. **Record keeping.** Until this run, this file described a pre-commit state of the backend (artifact `add126aac31f…`) while `status.md` and the TASK status line called G1–G6 verified at the committed state (`3cd6a3d5cdb7…`).

**Run 1 findings, status now.** 1 (lint errors outside geometry): gone, `main:lint` passes. 2 (tight G3 pass): unchanged, 0.9736 of the half-unit. 3 (provenance outcome `passed`): fixed, `main/labyrinth_main/features/geometry/artifact.py:110`, asserted at `main/tests/test_geometry.py:307-308`. 4 (weak spots): the G1 test now catches \|B\| on the wrong grid (B01) and the G4 test re-derives every 8th sample; the schema still allows `passed` (finding 7). 5: unchanged and correct.

**A note on probe (c).** The first criterion for the tube colours (0.03 sRGB with no shift allowed) failed at 0.040 and 0.030. The spline parameter is not arc length inside a segment, so the adapter's colour sits up to 0.26 of one sample spacing away from the chord projection used by the probe. Allowing 0.6 of a spacing gives 0.013 and 0.016, against 0.62 and 0.59 for a displacement of four samples, and 0.0002 when the two neighbouring samples' colours are interpolated, which is what the adapter does (`FluxScene.tsx:71-76`). The criterion was changed after seeing the first result; the numbers are given so the reader can judge.

**Not checked.** WebGL on a real GPU and in browsers other than Chromium-based ones (software rendering was used). Pointer-drag orbit; keyboard orbit only through `orbitForKey` in the G7 test. Plotly hover text. Screen-reader output. The 129 saved stella samples themselves (blocked, D-007).

**Basis of the verdict.** `verify.sh renderer` on the shared tree exits 0, and `verify.sh all` exits 0 on the verified bytes (A2, A5) and on c6244ec. Three other runs on the same bytes exited 2 with no failing geometry test: one under a load average near 30 (A1) and two that the verifier started with SIGINT ignored (A3, A4); see finding 10. Each of G1–G10 has a named test that asserts the outcome and goes red when the outcome is broken (47 of 63 mutations). The independent probes agree with every outcome. Findings 1–3 are gaps in what the tests cover, not failures of the outcomes.

Verdict: PASS

## Run 3 — whole task
Verifier run: 2026-11-20, commit 3faed3a

**Scope (short, as the owner asked).** `git status --short` showed no change under the owned paths (`main/labyrinth_main/features/geometry/`, `renderer/src/features/geometry/`), `main/tests/test_geometry.py`, `artifacts/geometry.json` or `contracts/geometry.schema.json`; only `status.md` and other tasks' VERIFY.md files were modified in the shared tree. The gate evidence is the maintainer's `verify.sh all` at 3faed3a on this tree: exit 0, 11 of 11 stages (boundary self-test 134 shapes, scripts 71 passed, ruff clean, main 331 passed, artifacts schema + fresh, tsc clean, vitest 1350 passed, vite build OK). This run did not repeat it. It re-ran this task's tests, made one independent probe per outcome group and spent five mutations on the five Run 2 gaps that matter for the outcomes (B15, B13, F15, F25, F43 survived in Run 2).

**What changed since Run 2 (2b1607e).** The tracer code (`vmec.py`, `fieldline.py`, `tubes.py`) is unchanged. `artifact.py` and `stella_reference.py` gained the structured float64 check `validation.float64Reference` (D-023 §4). The contract fixes `acceptance129.outcome` at `const "blocked"` (`contracts/geometry.schema.json:130-134`, D-023 §3). `FluxScene.tsx` only exports `buildContent` and gained comments. The tests were extended for Run 2 findings 1–9. Run 2's 20 backend mutations of the tracer were not repeated: the tracer code is unchanged and the assertions that caught them are still in the tests.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| G1 | VMEC reader: nfp 5, ns 99; R and Z on the full grid, bmag and lambda on the half grid, at any s | `main/tests/test_geometry.py:92` `test_vmec_reader_header`: header, a_ref, B_ref, 1/iota(0.49), stella radial weights including extrapolation, and R, Z, bmag at s 0.64 against an np.interp evaluation to 1e-12. Passed | Own netCDF reader: nfp 5, ns 99, 288 modes, B_ref 2.604314434 T, a 0.494417 m. Own iota(0.64) 0.9101565, the same as the artifact | PASS |
| G2 | Newton solve of theta* = theta + lambda, tol 1e-12, returning samples | `:132` `test_sfl_root_solve_roundtrip` and `:149` `test_sfl_root_solve_falls_back_to_bracketing`. Passed. Code unchanged; Run 2 turned them red with B05 and B06 | Own vectorised bisection (no Newton) matches stella's float64 bmag to 2.94e-13 and all 258 artifact samples (G4 row) | PASS |
| G3 | stella test_2 (rho 0.7, 25 samples): every zeta and bmag within half a unit in the last printed place | `:174` `test_reproduces_stella_saved_bmag_to_printed_precision`, `:198` `test_reproduces_stella_float64_bmag`, and the float64 tests `:233` to `:402` (tolerance 1e-10 checked on perturbed copies of out.nc, published bounds, a byte-identical rebuild under another BLAS kernel). All passed | Own evaluation: 0 of 25 outside the half-unit. The worst sample uses 0.9736 of the half-unit for bmag and 0.9227 for zeta. Max abs error 4.868e-4, the same as the artifact's 0.0004867958. Against float64 out.nc: 2.940e-13 abs and 2.998e-13 rel, below the published 4e-13 bounds | PASS (tight: 0.9736 of the half-unit) |
| G4 | rho 0.8 tubes: bean at zeta_c 0, triangular at 36 deg, theta* in [-pi, pi], 129 samples, centred on the outboard midplane, with R, Z, x, y, z and bmag/B_ref | `:415` `test_artifact_tubes_129_samples_centered`: schema, iota, alpha = -iota zeta_c, ends at -pi and pi, uniform zeta, sample 64 at theta* 0 with Z 0 and the cross-section's max R, every 8th sample re-derived, RK4 along B. Passed | All 129 samples of both tubes against own solve: R 1.3e-6 m, Z 1.3e-6 m, bmag 7.1e-7, x/y/z 3.4e-6 m, alpha + iota zeta - theta* 8.8e-7. Sample 64: theta* 0, Z 0, R 6.132478 and 5.779406 m, each its cross-section's max. alpha 0 and -0.5718682, equal to -iota zeta_c | PASS |
| G5 | Gray mesh at s 0.64; plasma-boundary (s 1) cross-sections at each zeta_c; bean outboard-midplane R in [6.05, 6.25] m with Z about 0 | `:483` `test_surface_and_bean_outboard_midplane`. It now checks every vertex and every boundary point against an independent evaluation, plus the seam steps and distinct vertices. Passed. M1 (mesh at s 0.5) and M2 (duplicated phi seam) turn it red | Every one of the 7200 vertices against own s 0.64: 5.0e-7 m. 7200 distinct vertices. Seam gaps 0.246 m (phi) and 0.033 m (theta). Boundaries against own s 1: 4.8e-7 m. Bean midplane R 6.13248 m, Z 0 | PASS |
| G6 | `validation.acceptance129` = blocked, with the D-007 reason | `:551` `test_acceptance129_is_blocked_not_passed` and `:571` `test_acceptance129_schema_rejects_passed`. The schema refuses passed, failed, not-applicable, BLOCKED and null. Passed | Artifact: outcome blocked, and the details cite D-007, 129 and "not in this repo". Schema outcome is `const "blocked"`. Provenance outcome blocked. All three source sha256 equal their files | PASS |
| G7 | Three.js scene: gray surface; selected tube coloured by bmag; other tube muted; start, centre and end markers | `GeometryView.test.tsx:56` tests the scene model. `FluxScene.test.tsx:57`, `:150` and `:197` use real three with only WebGLRenderer replaced. `lazyLoad.test.ts:32` and `:47` guard the lazy import. Passed. M3 (adapter paints the fill in a tube colour) turns `FluxScene.test.tsx:57` red | Real three `buildContent` on the real artifact, both selections: 10 children (fill, wireframe, 2 tubes, 6 markers). Fill eef2f4 and wireframe b8c6cc equal the surface tokens. 7200 vertices, 14400 triangles. The selected tube has vertex colours (135 and 149 distinct); the other tube has none and opacity 0.35. Markers sit exactly at samples 0, 64 and 128 | PASS |
| G8 | Bean/triangular selector (keyboard accessible) switches the scene, the bmag(theta*) plot and the inset | `GeometryView.test.tsx:154`: focus, then ArrowRight and ArrowLeft; checks that the colour-bar ticks, both inset paths and the centre dot follow the switch. Passed. M4 (inset boundary stays the bean one) turns it red | Real artifact in jsdom, ArrowRight: the checked radio and focus move to Triangular. The scene model is triangular, the chart's y values equal the triangular bmag samples exactly, the inset heading shows 36 deg. Ticks change from 0.917, 1.090, 1.263 to 0.916, 1.099, 1.282 (the bmagRange) | PASS |
| G9 | Cross-section inset (sampled surface, dashed plasma boundary) and bmag(theta*) Plotly chart with units | `GeometryView.test.tsx:207`, plus `PlotlyChart.test.tsx:19` and `:63` with Plotly mocked at the library level. Passed | Real artifact: both inset curves have 129 points. The boundary has dash "4 3" and the sampled curve is solid. Pixels per metre are equal in R and Z: 112.69 and 112.69 (bean), 177.71 and 177.72 (triangular). Axis titles: field-line angle in rad, and field strength in B_ref | PASS |
| G10 | Validation panel: stella reference result (samples, max error, pass/fail); acceptance-129 shown as BLOCKED with its reason, never as passed | `GeometryView.test.tsx:273`, `:323`, `:345` and `:418`. Passed. M5 (tracer pill hard-coded to Verified) turns `:323` red | Real artifact: tracer pill "passed" reads Verified, with 25 samples. The float64 line gives bounds of 4.0e-13 and says every sample is within tolerance. The acceptance pill reads Blocked, with the D-007 reason and the unblock step, and no Verified or passed text. No live pill. The two summary pills at the top read "ρ 0.7 check verified" and "129-sample acceptance blocked" | PASS |

### Real output
```
<scratch> = C:\Users\admin\AppData\Local\Temp\claude\cab28ef23558f274\9a7f397a-27eb-4e8c-9851-59a90e804ccb\scratchpad\vt-01-geometry
Every command ran as  wsl.exe -e bash scripts/dev.sh <command>  from D:\Labyrinth. Lines starting with "#" are the verifier's notes.

$ python3 --version
Python 3.12.3
$ git log --oneline -1
3faed3a Review round: all six areas approved; 91 confirmed findings fixed
$ git status --short -- main/labyrinth_main/features/geometry renderer/src/features/geometry main/tests/test_geometry.py artifacts/geometry.json contracts/geometry.schema.json
(end)
$ git diff --stat 2b1607e 3faed3a -- main/labyrinth_main/features/geometry main/tests/test_geometry.py renderer/src/features/geometry artifacts/geometry.json contracts/geometry.schema.json
 artifacts/geometry.json                            |   2 +-
 contracts/geometry.schema.json                     |  23 +-
 main/labyrinth_main/features/geometry/artifact.py  |  43 ++-
 .../features/geometry/stella_reference.py          |  41 ++-
 main/tests/test_geometry.py                        | 290 ++++++++++++++++++++-
 renderer/src/features/geometry/FluxScene.test.tsx  | 205 +++++++++++++++
 renderer/src/features/geometry/FluxScene.tsx       |  11 +-
 ...
 16 files changed, 1127 insertions(+), 89 deletions(-)

# ---- task tests, shared tree, HEAD 3faed3a
$ python3 -m pytest -p no:cacheprovider -v main/tests/test_geometry.py
test_geometry.py::test_vmec_reader_header PASSED
test_geometry.py::test_sfl_root_solve_roundtrip PASSED
test_geometry.py::test_sfl_root_solve_falls_back_to_bracketing PASSED
test_geometry.py::test_reproduces_stella_saved_bmag_to_printed_precision PASSED
test_geometry.py::test_reproduces_stella_float64_bmag PASSED
test_geometry.py::test_float64_comparison_flags_bmag_or_zed_outside_tolerance PASSED
test_geometry.py::test_float64_max_rel_error_is_relative_to_stella_bmag PASSED
test_geometry.py::test_float64_reference_exposed_in_artifact PASSED
test_geometry.py::test_float64_failure_fails_the_tracer_validation PASSED
test_geometry.py::test_float64_published_rel_bound_is_the_relative_error PASSED
test_geometry.py::test_float64_failure_names_its_cause PASSED
test_geometry.py::test_float64_noise_does_not_change_the_artifact PASSED
test_geometry.py::test_float64_reference_identical_under_another_blas_kernel PASSED
test_geometry.py::test_stella_reference_rejects_mismatched_input PASSED
test_geometry.py::test_artifact_tubes_129_samples_centered PASSED
test_geometry.py::test_surface_and_bean_outboard_midplane PASSED
test_geometry.py::test_acceptance129_is_blocked_not_passed PASSED
test_geometry.py::test_acceptance129_schema_rejects_passed PASSED
============================== 18 passed in 6.77s ==============================
$ npm --prefix renderer run -s test -- src/features/geometry --reporter=verbose
 ✓ src/features/geometry/lazyLoad.test.ts > G7 three stays lazy-loaded: no static import of three anywhere in renderer/src 1572ms
 ✓ src/features/geometry/lazyLoad.test.ts > G7 the lazy-load guard recognises every static import form and ignores type-only and dynamic ones 3ms
 ✓ src/features/geometry/FluxScene.test.tsx > G7 buildContent turns the scene model into real Three.js objects: closed gray surface, |B|-coloured selected tube, muted other tube, six marker meshes 25ms
 ✓ src/features/geometry/FluxScene.test.tsx > G7 FluxScene mounts the model through three, rebuilds it on selection, answers the keyboard and cleans up 189ms
 ✓ src/features/geometry/FluxScene.test.tsx > G7 FluxScene says so when WebGL cannot start, and points at the text equivalents 15ms
 ✓ src/features/geometry/PlotlyChart.test.tsx > G9 the |B|(θ*) spec reaches Plotly unchanged, on a labelled image, and is purged on unmount 226ms
 ✓ src/features/geometry/PlotlyChart.test.tsx > G9 a chart that cannot be drawn says so instead of leaving an empty box 25ms
 ✓ src/features/geometry/GeometryView.test.tsx > G7 scene: gray closed surface (seam wrapped), selected tube coloured by |B|, other muted, start/centre/end markers 200ms
 ✓ src/features/geometry/GeometryView.test.tsx > G8 bean/triangular selector is keyboard accessible and switches the scene, the |B| plot and the inset 105ms
 ✓ src/features/geometry/GeometryView.test.tsx > G9 cross-section inset (solid sampled surface, dashed boundary) and |B|(θ*) chart with units 43ms
 ✓ src/features/geometry/GeometryView.test.tsx > G10 validation panel: stella reference result, and acceptance-129 shown as BLOCKED with its reason, never passed 68ms
 ✓ src/features/geometry/GeometryView.test.tsx > G10 the tracer check follows the artifact: a failing stella reference is shown as Failed, never as Verified 40ms
 ✓ src/features/geometry/GeometryView.test.tsx > G10 honesty labels: both checks named above the fold, provenance badge, replay eyebrow, kind from the artifact, no live pill 77ms
 ✓ src/features/geometry/GeometryView.test.tsx > FF-6 the scene footer links the equilibrium source only when it is a web address; a repository path is named, not linked 41ms
 ✓ src/features/geometry/GeometryView.test.tsx > FB-5 the float64 check is validation.float64Reference: its numbers, its verdict, its source; the prose is not read 21ms
 ✓ src/features/geometry/GeometryView.test.tsx > DS-15 the cross-section inset is capped at its drawn size, so its labels keep their type size 6ms
 Test Files  4 passed (4)
      Tests  16 passed (16)
VITEST_EXIT=0
$ python3 scripts/check_boundaries.py
boundary: OK (167 files scanned)
EXIT=0

# ---- backend probe: python3 -I <scratch>/probe_backend.py /mnt/d/Labyrinth (own netCDF read, own np.interp, own bisection; no labyrinth_main import)
G1 own reader: nfp=5 ns=99 modes=288 B_ref=2.604314434 T a=0.494417 m
G3 rows=25 own bmag vs printed: worst |d|/half-unit=0.9736 outside=0/25; zeta worst=0.9227 outside=0/25; max|d bmag|=4.8680e-04
   own vs float64 out.nc: max|d bmag|=2.940e-13 max rel=2.998e-13 max|d zed|=6.7e-16
   artifact stellaReference: n=25 maxAbs=0.0004867958 allWithin=True
   artifact float64Reference: n=25 maxAbs<=4e-13 maxRel<=4e-13 tol=1e-10 allWithin=True; own error below the published bound: True
G4 rho=0.8 s=0.64 artifact iota=0.9101565 own iota=0.9101565
   bean       zc=0.0 n=129/129 th*[0]=-3.1415930 th*[-1]=3.1415930 alpha=0.0000000 own -iota*zc=-0.0000000
      centre[64]: th*=0.0 zeta-zc=0.0e+00 Z=0.0 R=6.132478 max xsec R=6.132478
      vs own: max|dR|=1.1e-06 |dZ|=6.8e-07 |d bmag|=7.1e-07 |dx|=2.9e-06 |dy|=2.7e-06 |dz|=6.8e-07 |alpha+iota*zeta-th*|=8.4e-07
   triangular zc=36.0 n=129/129 th*[0]=-3.1415930 th*[-1]=3.1415930 alpha=-0.5718682 own -iota*zc=-0.5718682
      centre[64]: th*=0.0 zeta-zc=-3.1e-08 Z=0.0 R=5.779406 max xsec R=5.779406
      vs own: max|dR|=1.3e-06 |dZ|=1.3e-06 |d bmag|=6.3e-07 |dx|=3.0e-06 |dy|=3.4e-06 |dz|=1.3e-06 |alpha+iota*zeta-th*|=8.8e-07
G5 mesh 150x48: max|d| vs own s=0.64 = 5.0e-07 m; distinct vertices 7200/7200; |row0-rowLast| min 0.246 m; |col0-colLast| min 0.033 m
   boundary[bean] n=129 vs own s=1: max|d|=4.8e-07 m
   boundary[triangular] n=129 vs own s=1: max|d|=4.7e-07 m
   bean outboard midplane (phi 0, theta 0): R=6.13248 Z=0.0
G6 acceptance129.outcome='blocked'; mentions D-007=True, 129=True
   details: BLOCKED (decision D-007): the PRD acceptance test compares bean |B| with 129 saved stella samples at rho 0.8, but those samples are not in this repo o...
   schema acceptance129.properties.outcome = {'const': 'blocked'}
   provenance kind='derived' verification.outcome='blocked'
   source data/raw/wout_w7x_kjm.nc: sha256 matches file = True
   source data/raw/stella_test2_vmec_geometry.geometry: sha256 matches file = True
   source data/raw/stella_test2_vmec_geometry.out.nc: sha256 matches file = True
artifact sha256: 1df0e9d5bdfd752a18065caac43d0d037f5d42beb91e97aac75cd9f35517e992
PROBE_EXIT=0
# (a first run printed zeta worst=nan: the probe's half-unit used log10 of the printed 0.0000E+00; fixed to read the printed exponent, rerun above)

# ---- frontend probe: <scratch>/zzverify.test.tsx copied into the probe copy (scripts/probe-copy.sh vt-01-geometry), run, removed
# real artifact; real three for buildContent; real GeometryView with FluxScene and PlotlyChart recorded
$ npm --prefix renderer run -s test -- src/features/geometry/zzverify.test.tsx
 ✓ src/features/geometry/zzverify.test.tsx (1 test) 249ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
FE_PROBE_EXIT=0
G7_bean: children Mesh:BufferGeometry, LineSegments:BufferGeometry, Mesh:TubeGeometry x2, Mesh:BoxGeometry x2, Mesh:SphereGeometry x2, Mesh:ConeGeometry x2
         fillHex eef2f4 (token eef2f4) fillVertexColors false; wireHex b8c6cc (token b8c6cc); surfaceVertices 7200 triangles 14400
         tubes: bean vertexColors true colorAttr true opacity 1; triangular vertexColors false colorAttr false a8482a opacity 0.35
         selectedDistinctColours 135; markerMaxErr 0
G7_triangular: same children and surface; bean vertexColors false 0b7f80 opacity 0.35; triangular vertexColors true opacity 1; distinct 149; markerMaxErr 0
G8_initial:        checked ["Bean · ζ 0°:true","Triangular · ζ 36°:false"] scene bean; chart "Bean (ζ = 0°): |B| at 129 samples", y = artifact bmag: true
                   inset "Cross-section at ζ = 0°"; ticks 0.917 1.090 1.263 (bmagRange 0.9170504, 1.263068)
                   inset sampled n 129 sx 112.6896 sy 112.6862; boundary n 129 sx 112.6932 sy 112.6893; boundary dash "4 3", sampled dash null
G8_afterArrowRight: checked ["Bean · ζ 0°:false","Triangular · ζ 36°:true"] scene triangular; chart "Triangular (ζ = 36°): |B| at 129 samples", y = artifact bmag: true
                   inset "Cross-section at ζ = 36°"; ticks 0.916 1.099 1.282 (bmagRange 0.9159186, 1.282082)
                   inset sampled n 129 sx 177.7119 sy 177.7205; boundary n 129 sx 177.7005 sy 177.7054; boundary dash "4 3", sampled dash null
G8_focus: "Triangular · ζ 36°"
chartX: ["Field-line angle θ* (rad)","Field strength |B| (B<sub>ref</sub>)"]
G10: stellaPill passed:Verified
     stellaText "All 25 saved samples agree to their printed 4 significant figures (within half a unit in the last printed place)."
     float64 "Against stella’s float64 output (out.nc): max |Δ| in |B| ≤ 4.0 × 10−13 Bref, relative ≤ 4.0 × 10−13, over 25 samples. Tolerance 1.0 × 10−10 Bref: every sample is within it."
     accPill blocked:Blocked; accSaysPassedOrVerified false; livePills 0
     accText "PRD acceptance: bean |B| vs all 129 saved stella samples (ρ 0.8)BlockedBlocked: Not checked: the 129 saved samples are not availableBLOCKED (decision D-007): the PRD acceptance test compares bean |B| with 129 saved stella samples at rho 0.8, but those samples "
     verdictPills ["passed:ρ 0.7 check verified","blocked:129-sample acceptance blocked"]
# (the JSON dump is condensed here, values unchanged)

# ---- mutations: python3 -I <scratch>/mutate.py <probe copy>; one at a time, target test file only, restored after each
RED      M1 [G5] surface mesh built at s 0.5 instead of 0.64  rc=1 ['1 failed, 17 passed in 3.13s']
           failed: test_surface_and_bean_outboard_midplane
RED      M2 [G5] surface mesh duplicates the phi seam (linspace with the end point)  rc=1 ['1 failed, 17 passed in 3.14s']
           failed: test_surface_and_bean_outboard_midplane
RED      M3 [G7] Three.js adapter paints the surface fill in the first tube's colour  rc=1 ['Test Files  1 failed (1)', 'Tests  1 failed | 2 passed (3)']
           failed: G7 buildContent turns the scene model into real Three.js objec
RED      M4 [G8] inset plasma boundary stays the bean one after switching  rc=1 ['Test Files  1 failed (1)', 'Tests  1 failed | 8 passed (9)']
           failed: G8 bean/triangular selector is keyboard accessible and switche
RED      M5 [G10] tracer pill hard-coded to Verified  rc=1 ['Test Files  1 failed (1)', 'Tests  2 failed | 7 passed (9)']
           failed: G10 the tracer check follows the artifact: a failing stella ref
all five files restored to their original sha256: True
MUTATE_EXIT=0
# M5 turned two tests red. The harness names only tests whose title starts with "G<n>", so the second one is not named.
# mutation sites: M1 main/labyrinth_main/features/geometry/artifact.py:116, M2 tubes.py:66, M3 renderer/src/features/geometry/FluxScene.tsx:46,
#                 M4 GeometryView.tsx:152, M5 ValidationPanel.tsx:56
$ rm -rf ~/.cache/labyrinth-probes/vt-01-geometry; ls ~/.cache/labyrinth-probes | grep -c vt-01-geometry
0
```

### Findings
No product defect found. All ten outcomes hold on the committed artifact, and each has a named test that asserts it. The five mutations aimed at Run 2's surviving gaps all turn the target test red.

**Run 2 findings, status at 3faed3a**
1. Adapters never run in a test: fixed. `renderer/src/features/geometry/FluxScene.test.tsx:17-35` runs the adapter against real three with only WebGLRenderer replaced (M3 turns it red). `PlotlyChart.test.tsx:9` mocks `plotly.js-dist-min` at the library level.
2. The G5 test did not pin the mesh: fixed. `main/tests/test_geometry.py:492-535` checks every vertex and boundary point against an independent evaluation, plus the seam (M1 and M2 turn it red).
3. No test of a failing tracer result or of the honesty labels: fixed. See `GeometryView.test.tsx:323` (M5 turns it red) and `:345`.
4. Lazy loading: now guarded at the source level by `renderer/src/features/geometry/lazyLoad.test.ts:32-45`. It reads import sites rather than the built chunk. This run did not mutate it.
5. Fill colour and colour-bar ticks: now asserted at `GeometryView.test.tsx:90` and `:149`.
6. G8 and G9 curves and scale: fixed. `GeometryView.test.tsx:177-204` covers the switch (M4 turns it red) and `:225-241` the equal R and Z scale. The fixture tubes now have different bmag ranges (`:181`).
7. The schema allowed `passed`: fixed by D-023 §3. See `contracts/geometry.schema.json:130-134`, `main/tests/test_geometry.py:571`, and the renderer refusal at `renderer/src/features/geometry/types.ts:87-88`, tested at `GeometryView.test.tsx:304-315`.
8. Provenance marks: the chart and inset panels now carry the artifact's kind (`GeometryView.test.tsx:359-362`, `:379-380`).
9. Float64 figure scraped from prose: fixed by the structured `validation.float64Reference` (D-023 §4), tested at `GeometryView.test.tsx:418` and `main/tests/test_geometry.py:269`.
10. Gate runs: the maintainer's `verify.sh all` at 3faed3a exits 0. This run did not rerun it.

**Minor**
- G3 still passes by a narrow margin: one bmag sample sits at 0.9736 of the half-unit (`main/tests/test_geometry.py:183`). This is unchanged since Run 1. The float64 comparison (2.94e-13) shows the margin comes from stella's 4-figure printing, not from tracer error.
- `tasks/01-geometry/TASK.md:37` still says frontend G7–G10 are "unverified/unreviewed". That status line is out of date after Run 2 and this run. It is bookkeeping for the maintainer, not an owned file.

**Not checked in this run.** WebGL rendering in a browser and screenshots. Run 2 did both at 2b1607e; since then `FluxScene.tsx` changed only by exporting `buildContent` and adding comments. The G1–G4 and G6 mutation sets of Run 2 were not repeated, because the tracer code is unchanged. The 129 saved stella samples are not available (blocked by design, D-007).

Verdict: PASS
