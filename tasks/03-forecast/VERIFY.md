# Verify: 03-forecast (backend half F1–F3 only)
Verifier run: 2026-11-19/20, commit 76b1908 at start, fcf812d at end (HEAD moved because other agents committed;
the forecast files did not change during the run) + working tree. The forecast files are uncommitted:
`main/labyrinth_main/features/forecast/{model,artifact}.py`, `main/tests/test_forecast.py`,
`artifacts/forecast.json`, and the shared `main/labyrinth_main/features/transport/stats.py`.
Every mutation ran on a copy under
`/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/v03/repo`. The verifier
wrote nothing in the repo except this file. `git status` changed during the run only because of other agents'
files (`data/raw/README.md`, `common/paths.py`, `tests/test_common.py`, `tasks/00-scaffold/VERIFY.md`,
`data/raw/stella_test2_vmec_geometry.out.nc`).

**Scope.** This file covers the backend only. The frontend outcomes F4–F5 are **not yet built**
(`renderer/src/features/forecast/` does not exist), so they were not verified. **Task 03 stays not-DONE until
the frontend half is verified as well, whatever this verdict says.**

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| F1 | Eight steps over [1500,1550) … [1850,1900), stella bean, initialised on [1450,1500) | `test_F1_eight_50_unit_steps_…`: checks the exact window list, the init window, the trace id, provenance coverage 1450–1900 and that the window integrals add up | My own h5py read of `compared/test5/stella` (1441 raw samples, 8 duplicate (t,Q) pairs dropped, 1433 left). The artifact has 8 windows at the right edges, init [1450,1500], traceId `stella-bean` | PASS |
| F2 | Persistence (previous completed window) and frozen (init mean) forecasts, with per-step absolute errors, MAE and an exact `method` | `test_F2_persistence_and_frozen_…`: recomputes every step from `window_mean`, pins MAE to 0.04400 / 0.04179 (±5e-6), checks phrases in `method`, and checks that a constant signal gives MAE 0 | My own edge-interpolated integral gives init 2.2298025 and MAE **0.04399776 / 0.04179437**, the same as the artifact (largest per-step difference 4.9e-7, from the artifact's 7-significant-figure rounding). Mutations: obs[3]+0.01 → F2 (and F3) fail; persistence = current obs (look-ahead) → F2 fails; frozen updated each step → F2 fails. No look-ahead at window level: the forecast for step k is `prev` = the observation of window k−1, assigned before window k's observation (`model.py` `run`). One small sample-level leak exists (Finding 2) | PASS |
| F3 | Fixtures claimed 0.0444 / 0.0423 vs computed ≈0.0440 / 0.0418 under D-013; "no tested definition reproduces both claims — expected mismatch"; the artifact shows it | `test_F3_prd_mae_fixtures_reported_as_mismatch`: claimed values, `matches is False` on both, the note names D-008, the alternate values appear in the note, outcome `failed`. Mutation: setting the claimed values to the computed ones → F3 fails | The artifact behaves as specified: `matches:false` ×2, `verification.outcome: "failed"`, and the note lists both alternates (half-open sample mean 0.04467/0.04186; sample-span trapezoid 0.04404/0.04156). **But the premise does not hold up.** A single, reasonable definition reproduces **both** PRD scores on the exact stated windows: the time-weighted mean of the sample-and-hold (zero-order-hold, "previous value") interpolant. It gives 0.044418 → **0.0444** and 0.042332 → **0.0423** (Finding 1) | **FAIL**: the F3 statement "no tested definition reproduces both", and its basis in D-008/D-013, are refuted by the probe |
| gate | `bash scripts/verify.sh all` exits 0 | — | Exit **2** on both runs. The failing stages are in `renderer/src/design/` (other agents' concurrent work), not in forecast files. `verify.sh main` exits 0 | **FAIL** (not attributable to forecast) |
| boundary | `scripts/check_boundaries.py` | — | `boundary: OK (82 files scanned)`, exit 0 | PASS |

## Real output
```
$ bash scripts/verify.sh all          # run 1, HEAD 76b1908
━━━ [main:tests] $ python3 -m pytest -q main/tests
65 passed in 6.07s
━━━ [artifacts:fresh] $ python3 scripts/validate_artifacts.py --check-fresh
artifacts: fresh (byte-identical rebuild)
━━━ [renderer:typecheck] $ npm --prefix renderer run -s typecheck
src/design/components/Panel.tsx(2,8): error TS2882: Cannot find module or type declarations for side-effect import of './components.css'.
src/design/components/ProvenanceBadge.tsx(7,8): error TS2882: ...
src/design/components/Stat.tsx(4,8): error TS2882: ...
src/design/components/StatusPill.tsx(5,8): error TS2882: ...
  FAIL  renderer:typecheck (2s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2

$ bash scripts/verify.sh all          # run 2, HEAD fcf812d
66 passed in 6.06s
 FAIL  src/design/color.test.ts > CVD simulation matrices > every row sums to ~1, so neutrals stay neutral
 FAIL  src/design/palette.test.ts > |B| colormap — light theme > lightness strictly increases and every step is visible under protanopia (vienot1999)
      Tests  2 failed | 443 passed (445)
  PASS  renderer:typecheck (3s)
  FAIL  renderer:tests (3s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2

$ bash scripts/verify.sh main
  PASS  boundary:self-test / boundary:scan / scripts:tests / main:lint / main:tests / artifacts:schema / artifacts:fresh
verify.sh: all stages passed.
EXIT_MAIN=0

$ python3 -m pytest -v -p no:cacheprovider main/tests/test_forecast.py
main/tests/test_forecast.py::test_F1_eight_50_unit_steps_from_1500_to_1900_initialised_on_1450_1500 PASSED [ 33%]
main/tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae PASSED [ 66%]
main/tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch PASSED [100%]
3 passed in 0.11s

$ python3 scripts/check_boundaries.py
boundary: OK (82 files scanned)

$ python3 probe.py        # independent h5py probe, own dedupe + own edge-interpolated integral
raw stella n 1441 range 0.0 2074.7
deduped n 1433 dropped 8
init 2.2298025
obs ['2.2156788', '2.1976051', '2.3244255', '2.2831617', '2.2856761', '2.2424219', '2.1748455', '2.2132008']
MAE persistence 0.04399776 frozen 0.04179437
artifact mae {'frozen': 0.04179437, 'persistence': 0.04399776}
max |obs-artifact| 4.643460500552976e-07
max |pers-artifact| 4.947574003821842e-07
frozen all init: True
mae-persistence claimed 0.0444 computed 0.04399776 matches False
mae-frozen claimed 0.0423 computed 0.04179437 matches False
verification outcome: failed

$ python3 hunt.py         # reproduction hunt: 4765 definitions
total definitions tested: 4765
HITS (both round to 0.0444 and 0.0423): 3
   ('stella left rnd=None persist to1900', 0.04441811739804735, 0.042331754336687955)
   ('stella span persist shift +2.00', 0.044357637850052645, 0.042308938694072595)
   ('stella left persist shift +0.00', 0.04441811739804735, 0.042331754336687955)   # same as the first hit
persistence-only hits: 20  frozen-only hits: 14
  (P = persistence rounds to 0.0444, F = frozen rounds to 0.0423)
  -- stella edge rnd=None persist to1900                          pers 0.04400 frozen 0.04179
  -- stella edge rnd=3 persist to1900                             pers 0.04388 frozen 0.04162
  -- stella edge rnd=2 persist to1900                             pers 0.04500 frozen 0.04125
  -- stella span rnd=None persist to1900                          pers 0.04404 frozen 0.04156
  -- stella sm_ho rnd=None persist to1900                         pers 0.04467 frozen 0.04186
  P- stella sm_ho rnd=None expanding to1900                       pers 0.04438 frozen 0.04186
  -- stella sm_ho rnd=3 persist to1900                            pers 0.04450 frozen 0.04187
  -- stella med_ho rnd=None persist to1900                        pers 0.04810 frozen 0.07002
  PF stella left rnd=None persist to1900                          pers 0.04442 frozen 0.04233
  -- stella right rnd=None persist to1900                         pers 0.04365 frozen 0.04127
  -- stella uniform rnd=None persist to1900                       pers 0.04430 frozen 0.04216
  -- stella edge rnd=None persist to1950                          pers 0.05472 frozen 0.05092
  -- GENE edge rnd=None persist to1900                            pers 0.04417 frozen 0.02825
  P- GENE sm_ho rnd=None persist to1900                           pers 0.04444 frozen 0.02847
  -- stella edge persist init-as-step(init 1400-1450, 9 steps)    pers 0.05053 frozen 0.09180
  -- stella edge persist 9-divisor(init err 0)                    pers 0.03911 frozen 0.03715
  -- stella edge persist 7 steps 1500-1850                        pers 0.04480 frozen 0.04539
  -- stella raw-with-dups sm_ho                                   pers 0.04467 frozen 0.04186

$ python3 zoh.py          # the hit, checked with two independent implementations
ZOH fine-grid            init 2.23472 obs [2.2155 2.1958 2.3234 2.2835 2.2856 2.2441 2.1751 2.2115] MAE pers 0.044418 -> 0.0444  frozen 0.042332 -> 0.0423
ZOH exact                init 2.23472 obs [2.2155 2.1958 2.3234 2.2835 2.2856 2.2441 2.1751 2.2115] MAE pers 0.044418 -> 0.0444  frozen 0.042332 -> 0.0423
dt-weighted unclipped    init 2.22847 ... MAE pers 0.044039 -> 0.0440  frozen 0.041858 -> 0.0419
edge-interp (artifact)   init 2.22980 ... MAE pers 0.043998 -> 0.0440  frozen 0.041794 -> 0.0418
--- PRD archive means under ZOH vs edge-interp (PRD: stella 1500-1900 2.242, GENE 1500-1893.765 2.474, 300-400 stella 2.55 GENE 2.68)
  stella 1500-1900     ZOH 2.2418  edge 2.2421
  GENE 1500-1893.765   ZOH 2.4739  edge 2.4739
  stella 300-400       ZOH 2.5569  edge 2.5545
  GENE 300-400         ZOH 2.6763  edge 2.6751
--- ZOH sensitivity to small grid shifts (persistence, frozen)
  shift -0.10: 0.04450 0.04241
  shift +0.00: 0.04442 0.04233
  shift +0.10: 0.04434 0.04225

$ python3 leak.py         # edge interpolation at window end b reads the first sample after b
window [1450,1500]: last sample <=b 1498.8, first sample >b used by edge interp 1500.3
window [1500,1550]: last sample <=b 1549.5, first sample >b used by edge interp 1550.9
...
artifact (edge interp at b uses sample after b): MAE pers 0.043998 frozen 0.041794
causal forecast (held value at b): MAE pers 0.043968 frozen 0.041794; max |forecast change| 1.33e-04

# Mutations (copy only; each reverted before the next)
=== M1 shift obs[3] +0.01
E           assert 2.2931616808403232 == 2.2831616808403234 ± 2.3e-12
FAILED tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
FAILED tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch
2 failed, 1 passed in 0.11s
=== M2 look-ahead persistence=obs
FAILED tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
1 failed, 2 passed in 0.10s
=== M3 frozen updated
FAILED tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
1 failed, 2 passed in 0.10s
=== M4 claimed set to computed (hide mismatch)
FAILED tests/test_forecast.py::test_F2_persistence_and_frozen_forecasts_errors_and_mae
FAILED tests/test_forecast.py::test_F3_prd_mae_fixtures_reported_as_mismatch
2 failed, 1 passed in 0.15s
=== M5 on-disk JSON observed[3] edited
ARTIFACT ERROR: artifacts/forecast.json: stale or non-deterministic — regenerate with `cd main && python3 -m labyrinth_main.build_artifacts`
```
(M5: in the scratch copy, `manifest.json` also reports stale both before and after the edit. That comes from the
copy, which does not include the whole repo. Only the `forecast.json` line is caused by the mutation.)

## Findings
1. **The PRD forecast scores are reproducible. The mismatch comes from a choice of definition, not an error in
   the PRD (high; it decides the premise of F3).** Take the stated method exactly: init [1450,1500], 8 windows
   [1500+50k, 1550+50k], persistence = previous completed window, frozen = init mean, MAE over the 8 steps.
   Use as the local mean the time-weighted mean of the **sample-and-hold** interpolant: each sample's Q holds
   until the next sample, so it is a left-Riemann ∫Q dt/(b−a) clipped at the window edges. The result is
   **0.044418 → 0.0444** and **0.042332 → 0.0423**. Both PRD values reproduce, and two independent
   implementations agree. The frozen value sits 1.8e-5 below the rounding boundary 0.04235, and a grid shift
   of ±0.1 breaks the match. The same definition also gives 2.242, 2.474 and 2.68 for the PRD archive means,
   but stella 300–400 = 2.5569 → "2.56", not the PRD's "2.55". So no single definition reproduces all six PRD
   numbers: D-013 (edge-interpolated) gets the four archive means, and sample-and-hold gets both forecast
   scores plus 3 of the 4 archive means. The one other "hit" in the hunt (sample-span trapezoid with the whole
   grid shifted +2.0) is not a reasonable reading. Readings that do **not** reproduce both:
   edge-interpolated, sample-span, half-open / closed sample means, medians, right-Riemann, uniform
   resampling, rounding observations to 2 or 3 decimals first, an expanding-mean forecaster (persistence
   0.04438 hits, frozen 0.04186 does not), 9 windows to 1950, the init window counted as a step or as a
   ninth zero, 7 steps, GENE (frozen ≈0.028), and keeping the restart duplicates.
   Consequences, each a decision for the orchestrator, not a code fix the verifier can make:
   - The F3 wording in `tasks/03-forecast/TASK.md` ("no tested definition reproduces both claims") is false.
   - The D-008 and D-013 Consequences in `decision.md` ("still do not reproduce under any tested definition")
     are false.
   - The fixture note in `artifacts/forecast.json` (built at `main/labyrinth_main/features/forecast/artifact.py:33-38`)
     is literally true for the two variants it lists ("none reproduces both"). Read alone, it still implies
     the PRD numbers cannot be reproduced. It should name the sample-and-hold definition that does reproduce
     them, so that the displayed mismatch reads as "D-013 single definition chosen over the PRD's apparent
     sample-and-hold mean".
   Keeping D-013 and showing `matches:false` stays honest. Switching the forecast to sample-and-hold to hit
   the numbers would break D-013's single-definition rule and the D-008 "do not tune" rule. Either way, the
   decision records must be corrected.
2. **Small sample-level look-ahead in persistence forecasts (low).** `transport/stats.py` `window_mean`
   interpolates Q at the window end b using the first sample after b (for example 1550.9 for the window
   ending at 1550; `stats.py:126-127`). So the forecast for step k reads the first sample of window k, which
   had not happened yet at forecast time. The effect is at most 1.33e-4 on a forecast and 3e-5 on the
   persistence MAE (0.043998 vs 0.043968 with the value held at b), which does not change the printed
   0.0440. The window-level ordering is correct: the forecast for k uses only windows < k. Mutation M2 shows
   the test catches real look-ahead. Fix by documenting it in `model.METHOD` or by using a causal
   end-edge value for forecasts.
3. **Test independence (info).** F1 and F2 recompute expected values with the same shared `window_mean`
   (`main/tests/test_forecast.py:7,31-41`), so a bug in `stats.py` would pass both. The hard-coded anchors
   0.04400 / 0.04179 (`test_forecast.py:44-45`) and this verifier's own implementation cover that gap. The
   tests are not tautological: mutations M1–M4 all fail.
4. **Precision (info).** The artifact stores 7 significant figures (`observed` etc.), so values re-derived
   from the JSON differ from full precision by up to 5e-7. That is harmless at 4-decimal fixtures.
5. **Gate (blocking, not forecast's fault).** `verify.sh all` exits 2. Run 1 failed on a typecheck error in
   `renderer/src/design/components/*.tsx` (missing `./components.css` declaration). Run 2 failed on 2 tests in
   `renderer/src/design/color.test.ts` and `renderer/src/design/palette.test.ts`. Both are design-lead's
   concurrent work. No forecast file is involved, and `verify.sh main` exits 0.

To turn this into PASS (backend): `verify.sh all` must exit 0, and the orchestrator must correct the F3
premise, D-008/D-013 and the fixture note in light of Finding 1. Task 03 stays not-DONE until F4–F5
(frontend) are built and verified.

Verdict: FAIL
