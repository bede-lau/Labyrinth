# Verify: 03-forecast (backend half F1–F3 only)
Verifier run: 2026-11-20, commit 4696675 + working tree. The forecast files are uncommitted:
`main/labyrinth_main/features/forecast/{model,artifact}.py`, `main/tests/test_forecast.py`,
`artifacts/forecast.json`, and the shared `main/labyrinth_main/features/transport/stats.py`. None of them changed
while the probes ran (byte-compared at the end). Every mutation ran on a copy under
`/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/v03/repo`. The verifier
wrote only this file. `git status` changed during the run only in other agents' `renderer/src/features/{live-gx,spatial,transport}` files.

**Scope.** This file covers the backend only. Frontend outcomes F4–F5 are **not verified**: files exist in
`renderer/src/features/forecast/`, but another engineer is still building them. **Task 03 stays not-DONE
until F4–F5 are verified as well, whatever this verdict says.**

## History
- **Run 1 (2026-11-19, 76b1908 → fcf812d): FAIL.**
  - (a) `verify.sh all` exited 2. The cause was `renderer/src/design` (typecheck, then 2 tests), not forecast.
  - (b) A reproduction hunt over 4,765 definitions refuted the F3/D-008 premise ("no tested definition
    reproduces both"). A time-weighted sample-and-hold mean gives 0.044418 / 0.042332 → 0.0444 / 0.0423, but
    stella 300–400 = 2.5569 → "2.56" ≠ PRD 2.55.
  - (c) There was a small look-ahead: the forecaster's window mean interpolated Q at b using the first sample after b.
- **Fix round:** D-016 added and TASK.md F3 reworded. The fixture note was rewritten. Forecasts now use
  `window_mean(..., right_edge="hold")`. `METHOD` states that the persistence forecast can differ from the
  previous revealed observation by about 1e-4. A test documents the sample-and-hold result.
- **Run 2 (this run): PASS.** Every Run 1 finding is resolved. Details below.

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| F1 | Eight steps over [1500,1550) … [1850,1900), stella bean, initialised on [1450,1500) | `test_F1_eight_50_unit_steps_…`: checks the exact window list, the init window, the trace id, provenance coverage 1450–1900 and the partition of the integrals | Own h5py read (1441 raw → 1433 after dropping 8 duplicate (t,Q) pairs). The artifact has 8 windows at the right edges and init [1450,1500] | PASS |
| F2 | Persistence (previous completed window) and frozen (init mean) forecasts, with per-step absolute errors, MAE and an exact `method` | `test_F2_…`: recomputes each step (observed = interpolated edges, forecasts = held right edge), pins MAE 0.043968 / 0.041794 (±5e-7), checks `method` phrases including "last sample <= b", checks that changing the first sample after a window leaves that window's forecast alone, and that a constant signal gives MAE 0 | Own implementation gives MAE **0.04396792 / 0.04179437**, the same as the artifact (largest per-step difference 4.9e-7, from 7-significant-figure storage). Causality on the real trace: randomly scrambling **all** samples t > b (±100σ) leaves every forecast for steps ≤ k bit-identical, for all 8 window ends, while the observed mean of step k does change. The forecast differs from the previous revealed observation by at most 1.331e-4, matching METHOD's "about 1e-4". Mutations: observed shift → fail; edge back to interpolate → fail; persistence = previous observation → fail; persistence = current window → fail | PASS |
| F3 | Claimed 0.0444 / 0.0423 vs computed (D-013) ≈0.0440 / 0.0418, expected mismatch shown; note states that sample-and-hold reproduces both but breaks 2.55 (D-016) | `test_F3_prd_mae_fixtures_reported_as_mismatch` (claimed values, `matches is False` ×2, outcome `failed`, note contents and values); `test_F3_sample_and_hold_reproduces_…` (0.044418 / 0.042332, round-trip to the PRD values, stella 300–400 → 2.56, only that fixture misses) | Artifact: `matches:false` ×2, `verification.outcome: "failed"`. The note says the sample-and-hold mean "reproduces BOTH PRD scores (persistence 0.044418 → 0.0444, frozen 0.042332 → 0.0423) but gives stella 300–400 = 2.5569 (prints 2.56, PRD 2.55)". It also lists the half-open, sample-span and look-ahead alternates. My own sample-and-hold implementation gives 0.044418 / 0.042332 and stella 300–400 = 2.5569, which agrees. Mutations: claimed set to computed → fail; the 2.55 miss removed from the note → fail | PASS |
| gate | `bash scripts/verify.sh all` exits 0 | — | First run exit 2: 1 test in `renderer/src/features/spatial/SpatialView.test.tsx`, a concurrent spatial frontend edit, not forecast. Re-run: **exit 0**, all 11 stages pass | PASS |
| boundary | `scripts/check_boundaries.py` | — | `boundary: OK (139 files scanned)` | PASS |

## Real output
```
$ python3 -m pytest -v -p no:cacheprovider main/tests/test_forecast.py
main/tests/test_forecast.py::test_F1_eight_50_unit_steps_from_1500_to_1900_initialised_on_1450_1500 PASSED [ 25%]
main/tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae PASSED [ 50%]
main/tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch PASSED [ 75%]
main/tests/test_forecast.py::test_F3_sample_and_hold_reproduces_prd_mae_but_not_stella_300_400 PASSED [100%]
============================== 4 passed in 0.08s ===============================

$ bash scripts/verify.sh all        # first attempt
 FAIL  src/features/spatial/SpatialView.test.tsx > S5 ring of 6 toroidal planes coloured by rank, exchange arrows both ways, CPU field-solve node, "Dommaschk geometry — not W7-X"
      Tests  1 failed | 575 passed (576)
  FAIL  renderer:tests (8s)          (all other 10 stages PASS)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2

$ bash scripts/verify.sh all        # re-run, HEAD 4696675
105 passed in 27.86s
      Tests  576 passed (576)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (29s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (4s)
  PASS  renderer:tests (7s)
  PASS  renderer:build (2s)
verify.sh: all stages passed.
EXIT=0

$ python3 scripts/check_boundaries.py
boundary: OK (139 files scanned)

$ python3 probe2.py      # own h5py read, own dedupe, own integrals
raw 1441 dedup 1433
one-sided: init(hold) 2.2296875  MAE pers 0.04396792 frozen 0.04179437
max |forecast_k - observed_{k-1}| = 1.331e-04  |init hold - init interp| = 1.150e-04
artifact mae {'frozen': 0.04179437, 'persistence': 0.04396792}
max|obs-art| 4.643460500552976e-07 max|pers-art| 4.887642091055966e-07 max|frozen-art| 4.6477261728128383e-07
mae-persistence 0.0444 0.04396792 matches False
mae-frozen 0.0423 0.04179437 matches False
outcome failed
NOTE: Computed with the stated method and the time-weighted edge-interpolated window mean (D-013), forecasts held at the right edge (no look-ahead); not tuned to the PRD (D-008); the MAE fixtures do not match. A time-weighted sample-and-hold (zero-order hold, edge-clipped) window mean reproduces BOTH PRD scores (persistence 0.044418 → 0.0444, frozen 0.042332 → 0.0423) but gives stella 300–400 = 2.5569 (prints 2.56, PRD 2.55) for the transport fixtures, so no single tested definition reproduces all six PRD numbers. D-013 is kept for every window mean. Other definitions (persistence / frozen MAE): sample mean, half-open windows a<=t<b: 0.044667 / 0.041857; sample-span trapezoid (samples a<=t<=b, divided by t_last-t_first): 0.044037 / 0.041556; edge-interpolated for forecasts too (one-sample look-ahead): 0.043998 / 0.041794. Removing the look-ahead changes the MAE from 0.043998 / 0.041794 to 0.043968 / 0.041794.
same note both: True
ZOH (own impl): pers 0.044418 frozen 0.042332; stella 300-400 2.5569
perturb Q at t=1500.3 (+100): forecasts for steps 0..0 unchanged: True; observed step 0 changes: True
perturb Q at t=1550.9 (+100): forecasts for steps 0..1 unchanged: True; observed step 1 changes: True
...
perturb Q at t=1850.4 (+100): forecasts for steps 0..7 unchanged: True; observed step 7 changes: True

$ python3 probe3.py      # scramble ALL samples after each window end
all samples t>1500 scrambled: forecasts for steps 0..0 bit-identical: True
all samples t>1550 scrambled: forecasts for steps 0..1 bit-identical: True
...
all samples t>1850 scrambled: forecasts for steps 0..7 bit-identical: True
ALL CAUSAL: True

# Mutations (copy only; each reverted; baseline and restored both "4 passed")
=== M1 observed mean of [1650,1700] +0.01
FAILED tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
FAILED tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch
FAILED tests/test_forecast.py::test_F3_sample_and_hold_reproduces_prd_mae_but_not_stella_300_400
3 failed, 1 passed in 0.12s
=== M2 forecaster edge back to interpolate (look-ahead)
FAILED tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
1 failed, 3 passed in 0.13s
=== M3 persistence = previous revealed observation (interpolated)
FAILED tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
1 failed, 3 passed in 0.15s
=== M4 persistence = current window (gross look-ahead)
FAILED tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
1 failed, 3 passed in 0.19s
=== M5 claimed set to computed (hide mismatch)
FAILED tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch
1 failed, 3 passed in 0.11s
=== M6 note drops the 2.55 break
FAILED tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch
1 failed, 3 passed in 0.12s
=== restored
4 passed in 0.11s
```
For Run 1's reproduction-hunt tables (4,765 definitions) and its two-implementation sample-and-hold check, see
the History section and D-016. The scripts are `hunt.py` and `zoh.py` in the scratch folder above.

## Findings
1. **Resolved (Run 1 b).** D-016, TASK.md F3 and the fixture note now state the sample-and-hold result, with
   values, and its 2.55 miss. The computed values stay `matches:false` and the outcome stays `failed`, so
   nothing is hidden or tuned. The product-owner question (switch the forecast alone to sample-and-hold?)
   stays open in D-016.
2. **Resolved (Run 1 c).** Forecasts use only samples ≤ b. This is shown on the real trace by scrambling all
   later samples, and the test (`main/tests/test_forecast.py`, F2 causality block) catches the look-ahead
   coming back (M2).
3. **Info: frozen MAE did not change when the init edge became held.** It is 0.04179437 both ways, even
   though the init mean moved by 1.15e-4. This is a coincidence of the data, not a bug: 4 of the 8 observed
   means lie above the init mean and 4 below, so a small shift of the init mean cancels in the MAE.
4. **Info: test independence.** F1 and F2 recompute expected values with the shared `window_mean`. The pinned
   anchors (0.043968 / 0.041794 at ±5e-7) and this verifier's own implementation cover a shared bug.
   Mutations M1–M6 all fail, so the tests are not tautological.
5. **Info: the gate went red once** because of `renderer/src/features/spatial/SpatialView.test.tsx`, which
   another agent was editing at the time. It was green on the re-run. No forecast file was involved.

Verdict: PASS
