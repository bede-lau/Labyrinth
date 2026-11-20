# Verify: 03-forecast
Runs 1–2 (below) cover outcomes F1–F3 (`main/`). **Runs 3 and 4 cover the whole task, F1–F5; Run 4 is at the
end of this file and its verdict is the last line of the file.** Editorial note from Run 3: the text of Runs 1–2 is kept as
written, except that the title and the scope paragraph were reworded, because `scripts/check_docs.py:46` reads
their original wording as a partial verification. Nothing else in Runs 1–2 was changed.

Verifier run (Run 2): 2026-11-20, commit 4696675 + working tree. The forecast files are uncommitted:
`main/labyrinth_main/features/forecast/{model,artifact}.py`, `main/tests/test_forecast.py`,
`artifacts/forecast.json`, and the shared `main/labyrinth_main/features/transport/stats.py`. None of them changed
while the probes ran (byte-compared at the end). Every mutation ran on a copy under
`/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/v03/repo`. The verifier
wrote only this file. `git status` changed during the run only in other agents' `renderer/src/features/{live-gx,spatial,transport}` files.

**Scope of Runs 1–2.** These runs cover outcomes F1–F3 (`main/`). Frontend outcomes F4–F5 were **outside
their scope**: files existed in `renderer/src/features/forecast/`, but another engineer was still building
them. **Task 03 stayed not-DONE until F4–F5 were verified as well, whatever the Run 2 verdict said.** They
are verified in Run 3 below.

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

(The line above is the Run 2 verdict and covers F1–F3. The verdict for the whole task is the last line of this file.)

## Run 3 — whole task (2026-11-20, commit 2b1607e)
Verifier run: 2026-11-20, commit 2b1607e. `git status --porcelain` was empty at the start, so the tree under
test equals the commit. By the end other agents had modified `main/labyrinth_main/features/live_gx/*`,
`main/labyrinth_main/server/__main__.py`, `scripts/*`, `status.md` and other tasks' VERIFY.md files. No file
of task 03 changed: the sha256 of every task file is the same at the start, at the end, and in the probe copy.

Where each thing ran:
- **Shared tree** `/mnt/d/Labyrinth` (read-only use): the task's own tests, `verify.sh renderer`,
  `check_boundaries.py`, the backend probe, read-only git.
- **Isolated copy** `/home/qqbot/.cache/labyrinth-probes/v0304` (from `scripts/probe-copy.sh v0304`, taken at
  the start): `verify.sh all`, every mutation, and the verifier's own probe tests. Deleted at the end.
- **Built app** at `http://127.0.0.1:4173` (vite preview of `renderer/dist`): headless Edge screenshots at
  1440 px and 800 px, and a keyboard run in a real browser.

The verifier wrote only this file and `tasks/04-budget/VERIFY.md`.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| F1 | Eight steps over [1500,1550) … [1850,1900), stella bean, initialised on [1450,1500) | `test_F1_eight_50_unit_steps_…` (re-run, passed) | Own h5py read of the pinned h5: 1433 samples after dropping duplicate (t,Q) pairs, strictly increasing. The artifact has 8 windows [1500,1550] … [1850,1900] and init [1450,1500]. `git log` on `main/labyrinth_main/features/forecast`, `main/tests/test_forecast.py`, `artifacts/forecast.json` and `transport/stats.py`: last change is 80888d4, the commit that recorded the tree Run 2 verified; `git diff 80888d4 HEAD` on those paths is empty; `artifacts:fresh` rebuilds byte-identically | PASS |
| F2 | Persistence and frozen forecasts, per-step absolute errors, MAE, exact `method` | `test_F2_…` (re-run, passed) | Own integrals, no project import: MAE **0.04396792 / 0.04179437**, equal to the artifact; largest difference to any artifact step value 4.89e-7 (7-significant-figure storage). Mean of the artifact's own `absErr*` columns gives the same two numbers. Mutations BE-F1 (persistence = previous revealed observation) and BE-F2 (observed + 0.01) both go red | PASS |
| F3 | Claimed 0.0444 / 0.0423 vs computed ≈ 0.0440 / 0.0418, expected mismatch shown; D-016 note | `test_F3_prd_mae_fixtures_reported_as_mismatch`, `test_F3_sample_and_hold_…` (re-run, passed) | Artifact: claimed 0.0444 / 0.0423, computed 0.04396792 / 0.04179437, `matches:false` ×2, verification `failed`. My own values print 0.0440 / 0.0418 at 4 decimals, not the PRD's. The note carries the sample-and-hold statement (0.044418 → 0.0444, 0.042332 → 0.0423, stella 300–400 = 2.5569, prints 2.56, PRD 2.55) | PASS |
| F4 | Step-through replay Predict → Reveal → Update, keyboard operable, with a reset; observed values hidden until revealed | `renderer/src/features/forecast/ForecastView.test.tsx` › "F4 step-through Predict → Reveal → Update is keyboard operable, hides observed until revealed, and resets". It renders the real component with the real artifact through a stubbed `fetch` and drives it with `userEvent` Tab / Enter / Space. Not tautological, nothing under test is mocked. Passed alone | Verifier's walk of the real component through all 25 states (8 windows × ready / predicted / revealed, plus done): every table cell equals the verifier's own visibility rule, and no unrevealed observed value or absolute error occurs anywhere in the page text or in any attribute. An observation appears only in the state after its window's two forecasts were shown. Reset after 1, 2, 3, 10, 11 and 24 activations hides everything again and disables Reset. Past the end: the button is disabled, three more activations leave the DOM unchanged, and `advance` is a no-op at index 8. A one-step artifact (first step = last step) works. Built app in a real browser: Enter then Space on the focused button go Predict → Reveal → Update label, and the row reads `2.230, 2.230, hidden` before Reveal. Mutations: FM1, FM3, FM4, FM5, FM12, FM14 red; **FM2, FM2b, FM15 stay green** | PASS. The implementation is correct; the test has a hole (finding 1) |
| F5 | Running MAE for both forecasters, plus final claimed vs computed scores with mismatch flag | same file › "F5 running MAE for both forecasters and final computed vs claimed scores with mismatch flag". Passed alone | Running MAE compared with the verifier's own mean of the scored windows' errors in all 24 states before completion ("Not scored yet" before the first Update); the test pins the final 0.0440 / 0.0418. Final panel as rendered: "Mismatch. Claimed 0.0444 Q gB,i, computed 0.0440 Q gB,i, difference minus 0.0004" and "Mismatch. Claimed 0.0423 Q gB,i, computed 0.0418 Q gB,i, difference minus 0.0005". Header badge "Derived, Failed". D-016 callout shows 0.044418 → 0.0444, 0.042332 → 0.0423 and 2.5569 / 2.56 vs 2.55. Eight mutated artifacts: the rendering follows the data, and a `matches:true` flag over differing printed values is still shown as Mismatch and flagged. Screenshots at 1440 px and 800 px agree. Mutations FM6, FM7, FM8, FM9, FM10, FM16 red; **FM11, FM11b, FM13 stay green** | PASS (findings 2, 3) |
| wording | The UI never says the forecast literally equals the previous observed value (interface.md §2 item 6) | none | Grep of `renderer/src` and a scan of the rendered text and attributes: no such wording. The only sentence is `ForecastView.tsx:256-259` ("… so it can differ from that window's revealed observed mean in the last digits"), and the artifact's `method` ("it is not literally 'the previous observed value'") is shown under "Method (from the artifact)". In the artifact the persistence forecast of step k and the observation of step k−1 differ by up to 1.34e-4; at the 3 printed decimals all 7 pairs print the same digits | PASS (no test, finding 3) |
| later milestone | The PRD's "simulated magnetic corrections" are not presented as implemented | none | "magnetic", "coil", "divertor" and "later milestone" occur nowhere in `renderer/src` or in the rendered page. The sentence exists only in `PRD.md:18` | PASS |
| provenance | Provenance kind, units and verification outcome shown next to the numbers | none in this folder (FM11 / FM11b green) | Rendered: pills "Replay · $0", "Derived", "Failed" in the replay panel header; every Stat carries `Q gB,i` and its window `t 1500–1550 a/v th,i`; fixtures carry the unit on the computed value. FM16 (units dropped) goes red | PASS (finding 2) |
| gate | `verify.sh` exits 0 | — | `verify.sh all` in the copy: first attempt exit 2, because vitest could not start 14 of 19 worker processes while the machine's load average was 27.9; no assertion failed, and the forecast and budget files were among the 5 that ran and passed. Re-run: **exit 0**, 11 stages PASS, 582 renderer tests, 105 backend tests. `verify.sh renderer` on the shared tree: **exit 0**, 19 files, 582 tests | PASS |
| boundary | `scripts/check_boundaries.py` | — | `boundary: OK (142 files scanned)` | PASS |

### Real output
```
$ wsl.exe -e bash scripts/dev.sh python3 --version
Python 3.12.3

# read-only git, shared tree (scratch script gitinfo.sh)
$ git rev-parse --short HEAD
2b1607e
$ git log --oneline -- main/labyrinth_main/features/forecast main/tests/test_forecast.py artifacts/forecast.json
80888d4 Backend data features: geometry, transport, forecast, budget, spatial (verified)
ecf14d5 Scaffold Labyrinth: process boundary, exit-2 verify loop, contracts, agents
$ git log --oneline -- main/labyrinth_main/features/transport/stats.py
80888d4 Backend data features: geometry, transport, forecast, budget, spatial (verified)
$ git log --oneline -- renderer/src/features/forecast
407827f Frontend WIP: app shell and six feature views (UNVERIFIED, incomplete)
ecf14d5 Scaffold Labyrinth: process boundary, exit-2 verify loop, contracts, agents
$ git diff --stat 80888d4 HEAD -- main/labyrinth_main/features/forecast main/labyrinth_main/features/budget main/tests/test_forecast.py main/tests/test_budget.py artifacts/forecast.json artifacts/budget.json main/labyrinth_main/features/transport/stats.py
(no output)
$ git status --porcelain      (at the start)
(no output)

$ wsl.exe -e bash scripts/dev.sh python3 -m pytest -v -p no:cacheprovider main/tests/test_forecast.py main/tests/test_budget.py      (shared tree)
main/tests/test_forecast.py::test_F1_eight_50_unit_steps_from_1500_to_1900_initialised_on_1450_1500 PASSED [ 11%]
main/tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae PASSED [ 22%]
main/tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch PASSED [ 33%]
main/tests/test_forecast.py::test_F3_sample_and_hold_reproduces_prd_mae_but_not_stella_300_400 PASSED [ 44%]
main/tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents PASSED [ 55%]
main/tests/test_budget.py::test_B2_published_stella_cpu_hours PASSED     [ 66%]
main/tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges PASSED [ 77%]
main/tests/test_budget.py::test_B4_gx_benchmark_is_prd_reported_context_only PASSED [ 88%]
main/tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard PASSED [100%]
============================== 9 passed in 0.60s ===============================
EXIT=0

$ wsl.exe -e bash scripts/dev.sh npm --prefix renderer run -s test -- src/features/forecast src/features/budget --reporter=verbose      (shared tree; colour codes removed)
 ✓ src/features/budget/BudgetView.test.tsx > B6 ledger bar to the $40 ceiling: posted, planned, remaining; live guard estimate distinguished from PRD GPU-only 458ms
 ✓ src/features/budget/BudgetView.test.tsx > B7 scenario cards show headline, derivation and interpretation; PRD-reported vs derived; ranges never midpoints 129ms
 ✓ src/features/forecast/ForecastView.test.tsx > F4 step-through Predict → Reveal → Update is keyboard operable, hides observed until revealed, and resets 301ms
 ✓ src/features/forecast/ForecastView.test.tsx > F5 running MAE for both forecasters and final computed vs claimed scores with mismatch flag 300ms
 Test Files  2 passed (2)
      Tests  4 passed (4)
EXIT=0

$ wsl.exe -e bash scripts/dev.sh python3 <scratch>/probe_backend.py      (own h5py read, own integrals, no labyrinth_main import)
=== 03 forecast: from the artifact's own steps
n steps 8 windows [1500.0, 1550.0] ... [1850.0, 1900.0] init [1450.0, 1500.0]
MAE persistence from |obs-pers| : 0.04396788   from absErrPersistence: 0.04396792   artifact mae: 0.04396792
MAE frozen      from |obs-frozen|: 0.04179450   from absErrFrozen:      0.04179437   artifact mae: 0.04179437
max |absErr - |obs-forecast||: pers 4.60e-07 frozen 9.20e-07
printed 4dp: persistence 0.0440 (PRD 0.0444)  frozen 0.0418 (PRD 0.0423)
frozen constant across steps: True | step0 persistence == frozen: True
|persistence_k - observed_{k-1}| per step: ['7.00e-06', '3.10e-05', '7.00e-05', '0.00e+00', '1.12e-04', '4.00e-06', '1.34e-04'] max 1.340e-04
same at 3 dp? [True, True, True, True, True, True, True]
 fixture mae-persistence claimed 0.0444 computed 0.04396792 matches False dp 4
 fixture mae-frozen claimed 0.0423 computed 0.04179437 matches False dp 4
 verification: failed | kind: derived | units: Q_i/Q_gB,i vs t v_th,i/a
=== 03 forecast: own recomputation from the raw h5 (own dedupe, own integrals)
samples after dropping duplicate (t,Q): 1433 strictly increasing: True
own MAE persistence 0.04396792  frozen 0.04179437   | max abs diff vs artifact steps 4.89e-07
own printed 4dp: 0.0440 / 0.0418  -> equals PRD 0.0444/0.0423? False / False

$ python3 <scratch>/mutate_backend.py      (copy only; __pycache__ cleared and PYTHONDONTWRITEBYTECODE=1 for every run)
### control: (0, '4 passed in 0.11s') (0, '5 passed in 0.03s')
### BE-F1 persistence = previous revealed observation (interpolated edge) -> exit=1 RED (killed)
    FAILED main/tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
    1 failed, 3 passed in 0.12s
### BE-F2 observed means shifted by +0.01 -> exit=1 RED (killed)
    FAILED main/tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
    FAILED main/tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch
    FAILED main/tests/test_forecast.py::test_F3_sample_and_hold_reproduces_prd_mae_but_not_stella_300_400
    3 failed, 1 passed in 0.13s
restore check main/labyrinth_main/features/forecast/model.py: copy 52db915aaee6 shared 52db915aaee6 same=True
### control after restore: (0, '4 passed in 0.11s') (0, '5 passed in 0.04s')

# Verifier's probe test (copied into the copy as renderer/src/features/forecast/zz_probe.test.tsx, run, removed)
$ npm --prefix renderer run -s test -- src/features/forecast/zz_probe.test.tsx src/features/budget/zz_probe.test.tsx --reporter=verbose
PROBE-F4 states checked: 25 | button labels: ["Predict 1500–1550","Reveal observed 1500–1550","Update forecasts → 1550–1600","Predict 1550–1600", ... ,"Predict 1850–1900","Reveal observed 1850–1900","Update forecasts (score last window)"]
PROBE-F4 past-the-end: DOM unchanged after 3 extra activations: true
PROBE-F4 state machine: 0r:predict 0p:reveal 0r:update 1r:predict 1p:reveal 1r:update 2r:predict 2p:reveal 2r:update 3r:predict 3p:reveal 3r:update 4r:predict 4p:reveal 4r:update 5r:predict 5p:reveal 5r:update 6r:predict 6p:reveal 6r:update 7r:predict 7p:reveal 7r:update 8r:done 8r:done 8r:done 8r:done 8r:done
 ✓ src/features/forecast/zz_probe.test.tsx > PROBE-F4 no peeking in any of the 25 states; first step, last step, past the end 584ms
PROBE-F4 reset after 1,2,3,10,11,24 activations: all values hidden again, Reset disabled
 ✓ src/features/forecast/zz_probe.test.tsx > PROBE-F4 reset from every phase hides everything again 620ms
PROBE-F5 fixture group: stella MAE, persistence forecast: Mismatch. Claimed 0.0444 Q gB,i, computed 0.0440 Q gB,i, difference minus 0.0004
PROBE-F5 fixture group: stella MAE, frozen forecast: Mismatch. Claimed 0.0423 Q gB,i, computed 0.0418 Q gB,i, difference minus 0.0005
PROBE-F5 fixture outcome attr: mismatch | claimed 0.0444 | computed 0.0440QgB,i
PROBE-F5 fixture outcome attr: mismatch | claimed 0.0423 | computed 0.0418QgB,i
PROBE-F5 callout: Warning: The PRD scores reproduce only under a different window-mean definitionA time-weighted sample-and-hold window mean gives persistence 0.044418 → 0.0444 and frozen 0.042332 → 0.0423, matching the PRD, but it breaks the archive fixture (stella 300–400 = 2.5569, prints 2.56 vs PRD 2.55). Labyrinth keeps one edge-interpolated definition everywhere (D-013, D-016), so these scores are shown as mismatches rather than tuned to the claim.
PROBE-F5 provenance badge name: Provenance of forecast replay: Derived, Failed | visible text: DerivedFailed
PROBE-F5 note under table: Means in QgB,i. Persistence forecasts the mean of the previous completed window, computed without look-ahead (its right edge is held at the last sample inside the window), so it can differ from that window's revealed observed mean in the last digits. Frozen keeps the 1450–1500 initialisation mean for every window.
PROBE-F5 banned pattern /forecast\s*(=|equals|is)\s*(the\s*)?previous(ly)?\s*(revealed\s*)?observ/i present: false
PROBE-F5 banned pattern /same as the previous(ly)? (revealed )?observ/i present: false
PROBE-F5 banned pattern /identical to the previous/i present: false
PROBE-F5 banned pattern /magnetic/i present: false
PROBE-F5 banned pattern /coil/i present: false
PROBE-F5 banned pattern /divertor/i present: false
PROBE-F5 banned pattern /later milestone/i present: false
PROBE-F5 0.0444 shown: true | 0.0440 shown: true | 0.0423 shown: true | 0.0418 shown: true
PROBE-F5 units on stats (first panel text has Q gB,i): true
PROBE-F5 [matches:true but computed still 0.04396792] -> ["stella MAE, persistence forecast: Mismatch. Claimed 0.0444 Q gB,i, computed 0.0440 Q gB,i, difference minus 0.0004. The match flag disagrees with the printed values.", ...] | badge: Provenance of forecast replay: Derived, Failed
PROBE-F5 [computed 0.04441 and matches:true] -> ["stella MAE, persistence forecast: Match. Claimed 0.0444 Q gB,i, computed 0.0444 Q gB,i, difference 0.0000", ...]
PROBE-F5 [computed 0.04441 and matches:false] -> ["stella MAE, persistence forecast: Mismatch. Claimed 0.0444 Q gB,i, computed 0.0444 Q gB,i, difference 0.0000. The match flag disagrees with the printed values.", ...]
PROBE-F5 [computed null, matches null] -> ["stella MAE, persistence forecast: Not recomputable. Claimed 0.0444 Q gB,i, computed value not available", ...]
PROBE-F5 [computed 0.05 matches false] -> [..., "stella MAE, frozen forecast: Mismatch. Claimed 0.0423 Q gB,i, computed 0.0500 Q gB,i, difference +0.0077"]
PROBE-F5 [verification passed] -> [...] | badge: Provenance of forecast replay: Derived, Verified
PROBE-F5 [note without sample-and-hold numbers] -> [...] | callout: Warning: The PRD scores reproduce only under a different window-mean definitionNo single tested window-mean definition reproduces every PRD number; one definition is kept everywhere (D-013, D-016).
PROBE-F5 [step 0 observed 9.999, errors 7.7777/6.6666] -> [...] | before reveal 9.999 present: false | after predict 9.999 present: false 7.7777 present: false | after reveal row0: ["2.230","2.230","9.999","7.7777","6.6666"] | running: Running MAE · persistence7.7777QgB,iafter 1 of 8 windowsRunning MAE · frozen6.6666QgB,iafter 1 of 8 windows
 Test Files  2 passed (2)
      Tests  9 passed (9)

# second probe file, schema-valid edge artifacts (copy only)
PROBE2-F4 one step labels: ["Predict 1500–1550","Reveal observed 1500–1550","Update forecasts (score last window)","Replay complete [disabled]","Replay complete [disabled]"] | announce: Replay complete. All 1 windows scored.
PROBE2-F4 zero steps -> thrown: "" | console.error count: 0 | first: "" | body text length: 0
TypeError: Cannot read properties of undefined (reading 'window')
 ❯ ForecastBody src/features/forecast/ForecastView.tsx:112:112

# Built app, real browser (Browser pane, http://127.0.0.1:4173/#/forecast, 1440 px), focus on the primary button
[key Return] {"announce":"Window 1 of 8, t 1500–1550: persistence forecast 2.230, frozen forecast 2.230; observed hidden.","btn":"Reveal observed 1500–1550","current":"Persistence forecast\n2.230\nQgB,i\nt 1500–1550 a/vth,i\nFrozen forecast\n2.230\nQgB,i\nt 1500–1550 a/vth,i\nObserved (archive)\nHidden until revealed","row0":["2.230","2.230","hidden","—","—"],"row1":["—","—","—","—","—"]}
[key space]  {"announce":"Window 1 of 8, t 1500–1550: observed 2.216; absolute errors 0.0140 persistence, 0.0140 frozen.","btn":"Update forecasts → 1550–1600","mae":"Running MAE · persistence\nNot scored yet (first Update)\nRunning MAE · frozen\nNot scored yet (first Update)","row0":["2.230","2.230","2.216","0.0140","0.0140"],"row1":["—","—","—","—","—"]}

# Mutations of the implementation (copy only). Each: apply, run ForecastView.test.tsx alone, restore.
$ python3 <scratch>/mutate.py forecast
### control (unmutated copy) renderer/src/features/forecast/ForecastView.test.tsx
exit=0
    ✓ src/features/forecast/ForecastView.test.tsx > F4 step-through Predict → Reveal → Update is keyboard operable, hides observed until revealed, and resets 245ms
    ✓ src/features/forecast/ForecastView.test.tsx > F5 running MAE for both forecasters and final computed vs claimed scores with mismatch flag 267ms
### FM1 observed visible already in the predicted phase (peek) [renderer/src/features/forecast/model.ts:66] -> exit=1 RED (killed)
    × F4 …   TestingLibraryElementError: Unable to find an element with the text: hidden.
### FM2 future windows show observed + errors [renderer/src/features/forecast/model.ts:65] -> exit=0 GREEN (SURVIVED)
### FM2b future windows show their forecasts (persistence k+1 ~ observed k) [renderer/src/features/forecast/model.ts:65] -> exit=0 GREEN (SURVIVED)
### FM3 Predict skips straight to revealed [renderer/src/features/forecast/model.ts:45] -> exit=1 RED (killed)
### FM4 advance can step past the end [renderer/src/features/forecast/model.ts:44] -> exit=1 RED (killed)
    AssertionError: expected { index: 8, phase: 'predicted' } to be { index: 8, phase: 'ready' } // Object.is equality
### FM5 Reset is a no-op [renderer/src/features/forecast/ForecastView.tsx:151] -> exit=1 RED (killed)
### FM6 running MAE includes the current, unscored window [renderer/src/features/forecast/model.ts:71] -> exit=1 RED (killed)
    × F5 …   Unable to find an accessible element with the role "group" and name `/^Running MAE · persistence: not scored yet/`
### FM7 running MAE persistence/frozen swapped [renderer/src/features/forecast/model.ts:74] -> exit=1 RED (killed)
### FM8 persistence fixture forced into agreement with the PRD [renderer/src/features/forecast/ForecastView.tsx:270] -> exit=1 RED (killed)
    × F5 …   Unable to find an accessible element with the role "group" and name `/^stella MAE, persistence forecast: Mismatch\. Claimed 0\.0444.*computed 0\.0440/`
### FM9 frozen fixture not rendered [renderer/src/features/forecast/ForecastView.tsx:271] -> exit=1 RED (killed)
### FM10 D-016 sample-and-hold numbers dropped from the callout [renderer/src/features/forecast/ForecastView.tsx:81] -> exit=1 RED (killed)
### FM11 provenance badge (kind + verification outcome) removed [renderer/src/features/forecast/ForecastView.tsx:116] -> exit=0 GREEN (SURVIVED)
### FM11b verification outcome shown as passed [renderer/src/features/forecast/ForecastView.tsx:116] -> exit=0 GREEN (SURVIVED)
### FM12 primary control removed from the tab order [renderer/src/features/forecast/ForecastView.tsx:141] -> exit=1 RED (killed)
    × F4 …   TestTimeoutError: Test timed out in 5000ms.
### FM13 copy says forecast = previous observed value [renderer/src/features/forecast/ForecastView.tsx:256] -> exit=0 GREEN (SURVIVED)
### FM14 current-window block shows observed as soon as forecasts are shown [renderer/src/features/forecast/ForecastView.tsx:191] -> exit=1 RED (killed)
### FM15 live region speaks the observed value in the predicted phase [renderer/src/features/forecast/ForecastView.tsx:102] -> exit=0 GREEN (SURVIVED)
### FM16 units dropped from the table note and MAE stats [renderer/src/features/forecast/ForecastView.tsx:30] -> exit=1 RED (killed)
### restore check (copy vs shared tree)
    renderer/src/features/forecast/ForecastView.tsx: copy 42fea3938156 shared 42fea3938156 same=True
    renderer/src/features/forecast/model.ts: copy 4785b5da0a49 shared 4785b5da0a49 same=True
### control after restore: exit=0
(12 of 18 red, 6 green: FM2, FM2b, FM11, FM11b, FM13, FM15. Lines marked "× F4 …" / "× F5 …" are shortened; the mutation lines are verbatim.)

# Gates
$ cd /home/qqbot/.cache/labyrinth-probes/v0304 && bash scripts/verify.sh all      (copy, first attempt, load average 27.88)
Error: [vitest-pool]: Failed to start forks worker for test files /home/qqbot/.cache/labyrinth-probes/v0304/renderer/src/features/live-gx/LiveView.test.tsx.
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
   (the same for App, components, SpatialView, GeometryView, contracts, ArtifactGate, lib, noHardcodedColors, contrast, palette, themes, color, designDoc)
 ✓ src/features/budget/BudgetView.test.tsx (2 tests) 476ms
 ✓ src/features/forecast/ForecastView.test.tsx (2 tests) 645ms
 Test Files  5 passed (5)
      Tests  15 passed (15)
  PASS  main:tests (27s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (12s)
  FAIL  renderer:tests (135s)
  PASS  renderer:build (7s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2

$ cd /home/qqbot/.cache/labyrinth-probes/v0304 && bash scripts/verify.sh all      (copy, re-run, files identical)
boundary: OK (142 files scanned)
docs: OK (10 task folders)
19 passed in 0.94s
All checks passed!
105 passed in 26.69s
artifacts: schema-valid
artifacts: fresh (byte-identical rebuild)
 Test Files  19 passed (19)
      Tests  582 passed (582)
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (27s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (25s)
  PASS  renderer:tests (208s)
  PASS  renderer:build (3s)
verify.sh: all stages passed.
EXIT=0

$ cd /mnt/d/Labyrinth && bash scripts/verify.sh renderer      (shared tree, HEAD=2b1607e)
boundary: OK (142 files scanned)
 Test Files  19 passed (19)
      Tests  582 passed (582)
━━━ verify.sh summary (scope: renderer)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (23s)
  PASS  renderer:typecheck (12s)
  PASS  renderer:tests (145s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
EXIT=0

$ wsl.exe -e bash scripts/dev.sh python3 scripts/check_boundaries.py
boundary: OK (142 files scanned)
EXIT=0
```

### Findings
1. **Major — the F4 test does not protect "no peeking" outside the current row.**
   `renderer/src/features/forecast/ForecastView.test.tsx:30-31, 39-42, 54-56, 63` assert hidden-until-revealed
   only for the row being worked on (`step-0`, then `step-1`). Three peeking mutations leave both tests green:
   - FM2, `model.ts:65`: future windows return `observed: true`. Seven of the eight archive observations and
     their errors are on screen before the first Predict.
   - FM2b, `model.ts:65`: future windows show their forecasts. The persistence forecast of window k+1 prints
     the same three decimals as the observation of window k, so this leaks it as well.
   - FM15, `ForecastView.tsx:102`: the `aria-live` region speaks the observed value in the predicted phase.

   The implementation is correct today (25-state probe above), so this is a hole in the gate, not a defect in
   the product. Fix: assert every row in every phase, or unit-test `visibility(s, i)` for i below, at and above
   the index in all three phases, and assert that the page text holds no unrevealed observed value.
2. **Minor — "verification failed" is displayed but not pinned by a test.** Removing the provenance badge
   (FM11, `ForecastView.tsx:116`) or forcing its outcome to `passed` (FM11b) leaves both tests green. Fix:
   assert `getByRole('button', { name: 'Provenance of forecast replay: Derived, Failed' })` in F5.
3. **Minor — the wording rule of interface.md §2 item 6 has no test.** FM13 replaces the caveat at
   `ForecastView.tsx:256` with "Persistence forecast = the previous observed value" and both tests stay
   green. Fix: assert the note contains "can differ" and that the page does not match `/=\s*the previous observed/i`.
4. **Minor — a schema-valid artifact can blank the view.** `contracts/forecast.schema.json:14` has no
   `minItems`; with `steps: []`, `ForecastView.tsx:112` (`a.steps[0]!.window[0]`) throws
   `TypeError: Cannot read properties of undefined (reading 'window')` and nothing is rendered. The committed
   artifact cannot trigger it (backend F1 pins 8 steps). Fix: an empty-state branch, or `minItems: 1` in the
   contract (needs a decision.md entry).
5. **Info — the final scores are visible before the replay starts.** The "Final scores" panel shows the
   8-window MAE (0.0440 / 0.0418) from the first render. That is an aggregate, not any window's observation,
   and it keeps the mismatch permanently visible, which the honesty rules require. Recorded so that it is a
   decision and not an accident.
6. **Info — the "Failed" pill sits in the replay panel's header; the "Final scores" panel carries only
   "Derived"** (`ForecastView.tsx:267`). The two Mismatch rows are in that panel, so the failure is not hidden.
7. **Info — the D-016 numbers are parsed out of the fixture note's prose** (`model.ts:84-94`). If the backend
   rewords the note, the callout falls back to a sentence without numbers (probe "note without sample-and-hold
   numbers"). F5 reads the real artifact and goes red in that case, so the coupling is guarded.
8. **Info — gate.** The first `verify.sh all` in the copy exited 2 because vitest worker processes timed out
   at start-up under a load average of 27.9 (seven other agents were running suites). No assertion failed.
   The re-run on byte-identical files exited 0, and `verify.sh renderer` on the shared tree exited 0. The
   maintainer's `verify.sh all` on the integrated tree remains the final word.

Could not check: the view in a screen reader (the live region was read through the DOM only), and widths
below 800 px.

Verdict: PASS

## Run 4 — whole task
Verifier run: 2026-11-20, commit 3faed3a
Scope, kept short at the owner's request: the task's own tests, one independent probe per side, and five
targeted mutations aimed at the holes Run 3 found. `verify.sh all` was **not** re-run here; the maintainer ran it
at 3faed3a on this tree (quoted below). `git status --short` at the start and at the end shows no change under
`main/labyrinth_main/features/forecast/` or `renderer/src/features/forecast/` (only `status.md` and other tasks'
VERIFY.md files, edited by other agents). Since Run 3 (2b1607e) only the four frontend files changed; the
backend, `main/tests/test_forecast.py`, `artifacts/forecast.json` and `contracts/forecast.schema.json` are
unchanged. Mutations ran in `/home/qqbot/.cache/labyrinth-probes/vt-03-forecast` (from `scripts/probe-copy.sh`),
deleted at the end. Besides appending this run, the verifier changed only the pointer sentence at the top of this
file (Run 3 to Runs 3 and 4).

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| F1 | Eight steps [1500,1550) … [1850,1900), stella bean, init [1450,1500) | `test_F1_eight_50_unit_steps_…` (re-run, passed); it pins the window list, the init window, the trace id and the provenance coverage | Own h5py read of the pinned h5 (sha256 equals the provenance), own dedupe 1441 to 1433 strictly increasing samples; artifact windows, init [1450,1500], traceId `stella-bean`, 8 steps all agree | PASS |
| F2 | Persistence and frozen forecasts, per-step abs errors, MAE, exact `method` | `test_F2_…` (re-run, passed): recomputes every step, pins MAE 0.043968 / 0.041794, checks causality and the `method` phrases | Own integrals (edge-interpolated observed, right edge held at the last sample at or before b for forecasts): MAE 0.04396792 / 0.04179437, equal to the artifact; largest per-step difference 4.89e-7 (7 significant figures in storage). `method` states the held edge and the time-weighted mean. Backend mutations not repeated: code unchanged since Runs 2–3, whose 8 backend mutations were all red | PASS |
| F3 | Claimed 0.0444 / 0.0423 vs computed ≈0.0440 / 0.0418 shown as mismatch; note on sample-and-hold and the 2.55 break (D-016) | `test_F3_prd_mae_fixtures_reported_as_mismatch`, `test_F3_sample_and_hold_…` (re-run, passed) | Artifact: `matches:false` twice, verification `failed`, own values print 0.0440 / 0.0418. Own sample-and-hold implementation gives 0.044418 / 0.042332 and stella 300–400 = 2.5569, the numbers the note states | PASS |
| F4 | Predict, Reveal, Update; keyboard operable; reset; observed hidden until revealed | `ForecastView.test.tsx:51` (keyboard Tab / Enter / Space, reset), `:99` (`visibility()` for rows below, at and above the index in all phases), `:122` (every row, the current-window block and the live region in all 25 states), `:330` (no steps). Real component, real artifact, only `fetch` stubbed. All passed | Own probe test in the copy, with its own state rule and own number formatting and no import of `model.ts`: drives all 24 activations by keyboard alone (Enter and Space alternating, focus stays on the primary button), and in all 25 states finds no unrevealed observed value or abs error anywhere in the document text or any attribute; a keyboard Reset after 13 activations hides every value again and disables Reset. Mutations MU1 (future observed shown), MU2 (live region speaks the observed value early) both red; these are the two leak kinds that survived in Run 3 | PASS |
| F5 | Running MAE for both forecasters; final claimed vs computed with mismatch flag | `ForecastView.test.tsx:188` (running MAE after 1 and 8 windows, both Mismatch rows, D-016 note), `:222` (Failed pill, Mismatch rows first, wording rule), `:276`, `:357`, `:371`, `:385` (the mismatch follows the data). All passed | Own running MAE in every state (scored windows only) equals the rendered value: 0.0140/0.0140, 0.0160/0.0230, … 0.0440/0.0418 after 8. Final panel shows claimed 0.0444 / 0.0423, computed 0.0440 / 0.0418, Mismatch, Failed, 2.56 vs 2.55. Mutations MU3 (verification pill forced to passed), MU4 (note says forecast = previous observed value), MU5 (computed set to the claim) all red | PASS |
| gate | `verify.sh all` exits 0 | — | Quoted from the maintainer at 3faed3a, not re-run here: exit 0, 11 of 11 stages (boundary self-test 134 shapes, scripts 71 passed, ruff clean, main 331 passed, artifacts schema and fresh, tsc clean, vitest 1350 passed, vite build OK) | PASS (quoted) |

### Real output
```
$ wsl.exe -e bash scripts/dev.sh python3 --version
Python 3.12.3

$ wsl.exe -e git status --short; git rev-parse --short HEAD      (start)
 M status.md
3faed3a
$ wsl.exe -e git diff --stat 2b1607e 3faed3a -- main/labyrinth_main/features/forecast renderer/src/features/forecast main/tests/test_forecast.py artifacts/forecast.json contracts/forecast.schema.json main/labyrinth_main/features/transport/stats.py
 .../src/features/forecast/ForecastView.test.tsx    | 396 ++++++++++++++++-
 renderer/src/features/forecast/ForecastView.tsx    | 469 ++++++++++++---------
 renderer/src/features/forecast/forecast.css        |   6 +-
 renderer/src/features/forecast/model.ts            |  36 +-
 4 files changed, 705 insertions(+), 202 deletions(-)

$ wsl.exe -e bash scripts/dev.sh python3 -m pytest -v -p no:cacheprovider main/tests/test_forecast.py
main/tests/test_forecast.py::test_F1_eight_50_unit_steps_from_1500_to_1900_initialised_on_1450_1500 PASSED [ 25%]
main/tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae PASSED [ 50%]
main/tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch PASSED [ 75%]
main/tests/test_forecast.py::test_F3_sample_and_hold_reproduces_prd_mae_but_not_stella_300_400 PASSED [100%]
============================== 4 passed in 0.82s ===============================
EXIT=0

$ wsl.exe -e bash scripts/dev.sh npm --prefix renderer run -s test -- src/features/forecast --reporter=verbose --no-color
 ✓ src/features/forecast/ForecastView.test.tsx > F4 step-through Predict → Reveal → Update is keyboard operable, hides observed until revealed, and resets 310ms
 ✓ src/features/forecast/ForecastView.test.tsx > F4 no peeking: visibility() for every window below, at and above the current one, in all three phases 4ms
 ✓ src/features/forecast/ForecastView.test.tsx > F4 no peeking in the view: every row, the current-window block and the live region, in all 25 states 395ms
 ✓ src/features/forecast/ForecastView.test.tsx > F5 running MAE for both forecasters and final computed vs claimed scores with mismatch flag 267ms
 ✓ src/features/forecast/ForecastView.test.tsx > F5 the failed verification and the mismatch are the first thing on the page, and the wording never equates forecast and observation 21ms
 ✓ src/features/forecast/ForecastView.test.tsx > FB-3 what a score match is backed by is the fixture basis (D-023): arithmetic reads as such, never softens a mismatch 19ms
 ✓ src/features/forecast/ForecastView.test.tsx > F5 the mismatch narrative follows the artifact: it goes away when both scores match and stays when one does not 59ms
 ✓ src/features/forecast/ForecastView.test.tsx > F5 an artifact whose provenance kind is "live" is shown as a recorded run: replayed scores never earn the LIVE pill 16ms
 ✓ src/features/forecast/ForecastView.test.tsx > F4 an artifact with no steps shows an empty state instead of crashing 13ms
 ✓ src/features/forecast/ForecastView.test.tsx > A3 forecast: a missing or invalid artifact shows an error naming the file, never a blank view 12ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-14 the mismatch count follows the rows: a flag that disagrees with the printed values counts as a mismatch 14ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-7 a score that cannot be recomputed (matches null) is not a mismatch: no callout, a "Not recomputable" row 12ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-9 the sample-and-hold callout says "matching the PRD" only when its printed values are the PRD claims 29ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for mode live with two running workers, as the header does 17ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for a fallback with TERMINATE FAILED, as the header does 14ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for a fallback with TERMINATION PENDING, as the header does 13ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for a stop that is not confirmed, as the header does 18ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for mode idle with workers listed, as the header does 19ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for mode launching, as the header does 17ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for a connection lost after mode live, as the header does 116ms
 ✓ src/features/forecast/ForecastView.test.tsx > FF-1 the forecast replay pill keeps "$0" where the header does, and drops it once a launch from this page is accepted 39ms
 ✓ src/features/forecast/ForecastView.test.tsx > DS-2 the steps table keeps its visually hidden caption inside the scrolling well 6ms
 Test Files  1 passed (1)
      Tests  22 passed (22)
EXIT=0

$ wsl.exe -e bash scripts/dev.sh python3 -I <scratch>/probe_backend.py      (own h5py read, own dedupe and integrals, no labyrinth_main import)
h5 sha256 matches provenance: True
raw 1441 kept 1433 strictly increasing True
F1 artifact windows True | init [1450.0, 1500.0] | traceId stella-bean | n 8
F2 own MAE persistence 0.04396792 frozen 0.04179437 | artifact 0.04396792 0.04179437 | max |own - artifact| per step 4.89e-07
F2 method mentions 'last sample <= b': True | 'time-weighted mean': True
F3 mae-persistence claimed 0.0444 computed 0.04396792 matches False | own printed 0.0440
F3 mae-frozen claimed 0.0423 computed 0.04179437 matches False | own printed 0.0418
F3 note has sample-and-hold 0.044418 -> 0.0444, 0.042332 -> 0.0423, 2.5569 / PRD 2.55: True
F3 verification outcome: failed
F3 own sample-and-hold MAE persistence 0.044418 frozen 0.042332 | stella 300-400 2.5569
EXIT=0

$ python3 <scratch>/mutate.py probe      (verifier's zz_probe.test.tsx copied into the probe copy, run, removed)
PROBE states 25 | running MAE (scored/phase:pers,frozen)  1/0:0.0140,0.0140 2/0:0.0160,0.0230 3/0:0.0530,0.0469 4/0:0.0500,0.0486 5/0:0.0405,0.0501 6/0:0.0410,0.0438 7/0:0.0448,0.0454 8/0:0.0440,0.0418
PROBE final panel text: Forecast replayFinal scores: recomputed vs PRD claimMAE over all 8 windows, at the PRD's printed precision.DerivedFailedstella MAE, persistence forecastClaimed (PRD)0.0444Computed0.0440QgB,iΔ−0.0004MismatchComputed with the stated method and the time-weighted edge-interpolated window mean (D-013), forecasts held at the right edge (no look-ahead); not tuned to the PRD (D-008); the MAE fixtures do n
 ✓ src/features/forecast/zz_probe.test.tsx > PROBE whole-document no-peek, running MAE and keyboard over every state; keyboard reset mid-run 680ms
PROBE after keyboard reset: observed values on page 0 | Reset disabled true
 ✓ src/features/forecast/zz_probe.test.tsx > PROBE keyboard reset after 13 activations hides everything again 205ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
exit=0

$ python3 <scratch>/mutate.py mutate      (copy only; each mutation applied, ForecastView.test.tsx run alone, original restored)
### MU1 future windows' observed values shown in the table (view only) [renderer/src/features/forecast/ForecastView.tsx:378] -> exit=1 RED (killed)
    × F4 no peeking in the view: every row, the current-window block and the live region, in all 25 states 37ms
    Tests  1 failed | 21 passed (22)
### MU2 live region speaks the observed value in the predicted phase [renderer/src/features/forecast/ForecastView.tsx:234] -> exit=1 RED (killed)
    × F4 no peeking in the view: every row, the current-window block and the live region, in all 25 states 57ms
    Tests  1 failed | 21 passed (22)
### MU3 final-scores verification pill forced to passed [renderer/src/features/forecast/ForecastView.tsx:120] -> exit=1 RED (killed)
    × F5 the failed verification and the mismatch are the first thing on the page, and the wording never equates forecast and observation 29ms
    Tests  1 failed | 21 passed (22)
### MU4 note says the forecast equals the previous observed value [renderer/src/features/forecast/ForecastView.tsx:388] -> exit=1 RED (killed)
    × F5 the failed verification and the mismatch are the first thing on the page, and the wording never equates forecast and observation 34ms
    Tests  1 failed | 21 passed (22)
### MU5 final scores rendered as the PRD claim (computed := claimed, matches := true) [renderer/src/features/forecast/ForecastView.tsx:126] -> exit=1 RED (killed)
    × F5 running MAE for both forecasters and final computed vs claimed scores with mismatch flag 265ms
    × F5 the failed verification and the mismatch are the first thing on the page, and the wording never equates forecast and observation 25ms
    × FB-3 what a score match is backed by is the fixture basis (D-023): arithmetic reads as such, never softens a mismatch 20ms
    × F5 the mismatch narrative follows the artifact: it goes away when both scores match and stays when one does not 39ms
    × FF-14 the mismatch count follows the rows: a flag that disagrees with the printed values counts as a mismatch 18ms
    × FF-7 a score that cannot be recomputed (matches null) is not a mismatch: no callout, a "Not recomputable" row 32ms
    Tests  6 failed | 16 passed (22)
### restore check (copy vs shared tree)
    renderer/src/features/forecast/ForecastView.tsx: copy 18331d36181d shared 18331d36181d same=True
    renderer/src/features/forecast/model.ts: copy 366945ed3761 shared 366945ed3761 same=True
    renderer/src/features/forecast/ForecastView.test.tsx: copy 2b193bf6c544 shared 2b193bf6c544 same=True
### 5 of 5 red
(The "FAIL src/..." summary lines vitest repeats under each mutation are left out; the lines shown are verbatim.)

$ rm -rf /home/qqbot/.cache/labyrinth-probes/vt-03-forecast      (after checking its marker file)
deleted
$ wsl.exe -e git status --short; git rev-parse --short HEAD      (end)
 M status.md
 M tasks/00-scaffold/VERIFY.md
 M tasks/04-budget/VERIFY.md
 M tasks/07-server/VERIFY.md
 M tasks/08-design-system/VERIFY.md
3faed3a

# Gate: not re-run (owner's instruction). Maintainer's bash scripts/verify.sh all at 3faed3a, as reported to
# this verifier: exit 0, 11/11 stages (boundary self-test 134 shapes, scripts 71 passed, ruff clean,
# main 331 passed, artifacts schema + fresh, tsc clean, vitest 1350 passed, vite build OK).
```

### Findings
1. **Resolved since Run 3: the four test holes.**
   - Run 3 finding 1 (no-peek only checked on the current row): now covered by `ForecastView.test.tsx:99-120`
     (unit test of `visibility()`) and `:122-186` (every row, the current-window block and the live region in
     all 25 states). MU1 and MU2 go red. These are the leak kinds of the earlier FM2 and FM15.
   - Run 3 finding 2 (verification outcome not pinned): `:232-236` pins the Failed pill and the badge name. MU3 goes red.
   - Run 3 finding 3 (wording rule untested): `:249-257`. MU4 goes red.
   - Run 3 finding 4 (`steps: []` blanked the view): `ForecastView.tsx:69` now renders `NoSteps`, tested at
     `:330-341`. The contract still has no `minItems` (`contracts/forecast.schema.json` unchanged), so the view
     handles that case instead.
2. **Info: shared state rule in the 25-state test.** `ForecastView.test.tsx:138,180` takes the next expected
   state from `nextAction` / `advance` in `model.ts`, the code under test, but codes the expected cell contents
   on its own and also checks the button labels. The verifier's probe used its own state rule and its own
   formatting, and scanned all text and attributes in the document, and it agrees.
3. **Info: the final scores are shown before the replay starts.** This is now deliberate and tested
   (`ForecastView.test.tsx:222-247`, DS-4). It is the 8-window aggregate, not any window's observation.
4. **Info: not checked in this run.** The built app in a real browser, a screen reader and narrow widths. Run 3
   covered the browser at 1440 px and 800 px on the earlier frontend. The keyboard was checked here in jsdom
   only, with `userEvent`. The backend was not mutation-tested again because its code is unchanged since the
   runs that did.

Verdict: PASS
