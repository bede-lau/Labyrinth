# Verify: 01-geometry (backend G1–G6 only)
Verifier run: 2026-11-19, commit 0884d0b + working tree (geometry files uncommitted: `main/labyrinth_main/features/geometry/{vmec,fieldline,stella_reference,tubes,artifact}.py`, `main/tests/test_geometry.py`, `artifacts/geometry.json`)

**Scope.** This file covers the backend half (G1–G6). The frontend half (G7–G10) is not yet built
(only `renderer/src/features/geometry/GeometryView.tsx` exists, with no `G7…G10` tests) and was not verified.
The verdict line below is for the backend only. **The task stays not-DONE until G7–G10 are built and verified.**

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| G1 | VMEC reader: nfp 5, ns 99; R/Z full grid, \|B\|/λ half grid | `test_vmec_reader_header`: header (nfp, ns, mnmax, lasym), a_ref/B_ref vs stella header, 1/ι(0.49) vs qinp 1.112, grid-point weights, Z=λ=0 at (0,0). Half-grid \|B\|/λ is not asserted here directly, but switching either to full grid makes the G3 test fail (mutations C1, C2) | Own netCDF4 reader: ns=99, nfp=5, mnmax_nyq=288; own half-grid ι(0.64)=0.9101565 = artifact `surface.iota` | PASS |
| G2 | Newton solve θ*=θ+λ, tol 1e-12 | `test_sfl_root_solve_roundtrip`: 200 random round-trips to 1e-11, traced points return α to 1e-11 | Own bisection solver (60 iterations, not Newton) gives θ, and from it \|B\|, bit-identical to the author's at all 25 test_2 points (max diff 0.00e+00). Mutations C6 (tol 1e-2) and C7 (ignore λ) make the test fail | PASS |
| G3 | stella test_2: all 25 `zeta` and `bmag` within half a unit in the 4th significant figure | `test_reproduces_stella_saved_bmag_to_printed_precision`: zips all 25 rows with `strict=True`, checks each zeta and bmag against its half-unit, checks round-to-4-s.f. equality, checks θ_vmec against `.vmec.geo` | (a) Own evaluator with **printed** `.vmec.geo` θ_vmec·nfp and the file's `zeta`, half-grid bmnc (j=48/49, w=0.48/0.52): max \|Δ\| 5.5e-4 (exact B_ref) / 6.9e-4 (B_ref 2.604); 5 samples land just outside the half-unit, and all of that is θ_vmec print rounding (re-rounding my own θ the way stella prints it reproduces those values to 0.0e+00; rounding moves \|B\| by up to 2.6e-4). (b) Own evaluator with own λ-solve: max \|Δ\| 4.868e-4, 0/25 outside the half-unit, 25/25 equal after rounding to 4 s.f. Identical to the author's values. Reference-file mutations M1–M5 (+1e-3 on one bmag in the middle, at a 5-decimal row, or on the last row; +1e-4 just past the half-unit; one row deleted) all make the test fail | PASS (worst sample is at 0.974 of the half-unit, a tight but real pass) |
| G4 | ρ 0.8 tubes: bean ζc 0, triangular ζc 36°, θ*∈[−π,π], 129 samples, centre θ*=0 at ζc, R Z x y z \|B\| | `test_artifact_tubes_129_samples_centered`: schema, 129 samples, α=−ιζc, endpoints ±π, monotone, centre θ*=0, ζ=ζc, Z=0, R=max of the cross-section, x/y/z, stellarator up-down symmetry. Mutations C4 (α sign), C5 (128 samples), C5b (ζc 30°) make it fail | From the artifact JSON: 129/129 samples, θ* from −3.1415930 to 3.1415930 (7 s.f.), monotone; centre ζ=0 / 0.6283185, Z=0 / 8e-19; max\|x²+y²−R²\| 1.1e-5 (7-s.f. rounding). Own λ-solve plus evaluation at 5 samples per tube (0, 40, 64, 100, 128): \|B\| agrees to ≤6.3e-7 and R, Z to ≤1e-6 | PASS |
| G5 | Gray mesh at s 0.64 and boundary cross-sections; bean outboard midplane R at ζ 0 in [6.05, 6.25], Z≈0 | `test_surface_and_bean_outboard_midplane` | len(positions)=21600=3·48·150. Bean outboard R=6.13248, Z=0 (mesh, cross-section and own evaluator agree). At φ index 0 and 37: 0/48 mesh points inside own s=0.63 section, 48/48 inside own s=0.65 section and inside own s=1 boundary; mesh vs own s=0.64 R,Z max diff 5e-7. Artifact boundary curves vs own wout[ns−1]: max diff 4.8e-7 | PASS |
| G6 | `acceptance129` = `blocked` with D-007 reason | `test_acceptance129_is_blocked_not_passed`. Mutation C3 (outcome "passed") makes it fail | Artifact `outcome: "blocked"`, reason cites D-007 and stella 6f60964d. Grep: the only assignment is the literal at `artifact.py:93`; no code path sets it to passed | PASS |
| — | Provenance honest | (part of G6 test: kind) | kind `derived`; all 3 source sha256 values equal the sha256 of the `data/raw` files; URLs pinned to stella 6f60964d; runtime marked "not recorded" | PASS (see finding 3) |
| G7–G10 | Frontend | — | — | not yet built |

## Real output
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

## Findings
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
6. **Frontend G7–G10: not yet built.** Not verified. They do not affect this backend verdict. The task stays not-DONE.

Verdict scope: backend G1–G6 only. Frontend G7–G10 are not yet built, so the task is not DONE.
Verdict: PASS
