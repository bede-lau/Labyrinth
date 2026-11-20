# Verify: 02-transport (backend T1–T7 only)
Verifier run: 2026-11-19/20 (UTC), commit 76b1908 at start, fcf812d at end (both commits touch only status/contracts/geometry), + working tree.
Transport files are untracked in the working tree and were not changed during the run (mtimes 21:46–22:07 UTC, all before the first green `verify.sh main` at 22:09 UTC). sha256 prefixes:
archive.py 3671aea54b04584c · artifact.py 38943a9a82279b1f · compare.py 9113ffcf951ed2db · stats.py 93c517f02d8cd9ef · units.py 49346bbcffa51536 · test_transport.py 93d4a7aad908a945 · artifacts/transport.json c72c1cdcfc794843.

**Scope.** This file verifies the backend half (T1–T7). The frontend (T8–T12) is **not yet built**. **Task 02 stays not-DONE** until the frontend outcomes have been verified and this file has been updated to cover them.

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| T1 | Traces from `compared/test5/{stella,GENE}/{t,Q}`, units `Q_i/Q_gB,i` vs `t v_th,i/a`, tgrad 3 / ngrad 1 in provenance | `test_T1_traces_read_from_pinned_h5_with_units_and_gradients`: compares against the raw h5, units, gradients in the provenance text, and `n_dropped_duplicates == 8/0` | My own h5py read: tgrad=3, ngrad=1. stella has 1441 raw samples and non-increasing steps at idx 418 (606.19→601.85) and 602 (866.63→862.29). The 8 repeated t values (601.85…606.19 and 862.29…866.63) all repeat identical Q. My `np.unique` dedup gives 1433 samples, the same as the artifact's (t exact, Q within 5e-7 because JSON stores 7 significant figures). GENE has 1106 samples, strictly increasing, t_end=1893.765478748425 | PASS |
| T2 | Edge-interpolated time-weighted means reproduce 2.242 (stella 1500–1900) and 2.474 (GENE 1500–1893.765) | `test_T2_time_weighted_means_reproduce_fixtures` (abs 5e-5) and `test_T2_window_mean_equals_analytic_integral_for_piecewise_linear_Q` (hand-checked exact integral) | My segment-clipping integrator gives stella 2.24213 and GENE 2.47386, identical to the artifact. Both print as the PRD values. Mutation (+0.002 on stella Q / −0.002 on GENE Q in a copied h5) makes T2 fail, see below | PASS |
| T3 | Per-window coverage, mean, autocorrelation-corrected stderr (documented method), stationarity, claim gate | `test_T3_window_stats_coverage_stderr_stationarity_and_claim_gate`, `test_T3_stderr_estimator_is_calibrated_on_synthetic_ar1` (AR(1) with known τ_int; a step is rejected) | Batch means with 4–20 batches: the artifact's Sokal stderr is within 0.75–2.03× of every batch size. Linear-trend drift is 5.6–6.2 stderr on the windows flagged non-stationary (stella 200–300 and 300–400, GENE 200–300) and 0.4–1.6 stderr on those flagged stationary. GENE 1500–1900 is uncovered (mean null, no claim). The method is documented in `stats.py` and in every row's `stationarityDetail` | PASS |
| T4 | Reduced Modal 5.79 on 300–400 vs archive 300–400 means; 2.55 / 2.68 fixtures reproduce; sample-span 2.674 in the note | `test_T4_reduced_modal_run_against_archive_and_fixtures` | Mine: stella 300–400 = 2.55454 (prints 2.55), GENE 300–400 = 2.67507 (prints 2.68), sample-span 2.67429 (prints 2.67). `reducedModalRun.archive` = {stella 2.554537, GENE 2.675066}, equal to the window rows. 5.79 has `kind: prd-reported`, `outcome: blocked`, `computed: null`, `matches: null` | PASS |
| T5 | `gx_to_archive` gives (t·√2, Q/(2√2)) and raises unless identical references are asserted | `test_T5_gx_to_archive_converts_and_refuses_without_identical_references` | My inputs: t [0,1,10]→[0,√2,10√2] and Q [1,2√2,8]→[1/(2√2),1,8/(2√2)], exact. Round trip GENE→GX→archive: max\|ΔQ\|=4.4e-16. `False`/`0` raise ValueError and a missing keyword raises TypeError. Minor finding F1 below | PASS (minor finding) |
| T6 | `compare_window` returns verdict, delta and combined uncertainty; "no claim" if either side is uncovered or non-stationary | `test_T6_compare_window_verdict_delta_uncertainty_and_no_claim` | Synthetic GENE+δ vs GENE on 1500–1893.765 (combined stderr 0.0205): δ=0, 0.01, 0.03, 0.04 → agree (z ≤ 1.95); δ=0.05, 0.08, 0.5 → disagree. A GX-normalised resampled copy run through `gx_to_archive` agrees unshifted and disagrees at +0.06 (z=2.93). A time-shifted copy, a truncated copy, GENE vs GENE 200–300, stella vs GENE 300–400 and a ramped copy all give "no claim" with the right reason | PASS |
| T7 | Triangular: published 2.22 over 1200–1500, `rawTraceStatus: unverified`, no triangular trace | `test_T7_triangular_published_mean_only` | Artifact traces are only `stella-bean` and `gene-bean`, both with `tube: bean`. "triang" appears only in the `triangular` object and in fixture `triangular-published-1200-1500` (computed null) | PASS |
| T8–T12 | Frontend | — | — | not yet built |

## Real output

### verify.sh
```
$ bash scripts/verify.sh main          # 2026-11-19 22:09 UTC
━━━ [main:tests] $ python3 -m pytest -q main/tests
65 passed in 6.03s
━━━ [artifacts:schema] $ python3 scripts/validate_artifacts.py
artifacts: schema-valid
━━━ [artifacts:fresh] $ python3 scripts/validate_artifacts.py --check-fresh
artifacts: fresh (byte-identical rebuild)
━━━ verify.sh summary (scope: main)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (6s)
  PASS  artifacts:schema (1s)
  PASS  artifacts:fresh (0s)
verify.sh: all stages passed.
exit=0

$ bash scripts/verify.sh all           # same time; renderer stage belongs to other agents
src/design/components/FixtureCheck.tsx / Panel.tsx / ProvenanceBadge.tsx / Stat.tsx / StatusPill.tsx:
  error TS2882: Cannot find module or type declarations for side-effect import of './components.css'.
  FAIL  renderer:typecheck (2s)          <- renderer/src/design (design-lead, in flight), not transport
  (all other stages PASS)
exit=2
```
Later re-runs of `verify.sh main` failed because of other agents' in-flight edits. Neither failure touches a transport file:
```
# 2026-11-20 02:4x UTC, run 2
FAILED main/tests/test_common.py::test_every_raw_file_is_pinned
E  AssertionError: unpinned or missing raw files: {'stella_test2_vmec_geometry.out.nc'}
1 failed, 64 passed                      <- new untracked data/raw file from the geometry agent; passed (66 passed) on immediate re-run
# run 3
FAILED main/tests/test_geometry.py::{test_reproduces_stella_saved_bmag_to_printed_precision, test_artifact_tubes_129_samples_centered,
       test_surface_and_bean_outboard_midplane, test_acceptance129_is_blocked_not_passed}
E  TypeError: compare() missing 1 required positional argument: 'input_path'   (features/geometry/artifact.py:35)
4 failed, 62 passed ; artifacts:fresh FAIL (build_artifacts crashes in geometry/artifact.py:35)
```
Transport checked in isolation at the end of the run:
```
$ python3 -m pytest -q main/tests/test_transport.py
9 passed in 0.20s
$ python3 -m labyrinth_main.build_artifacts --out <scratch>/rebuild --only transport && cmp <scratch>/rebuild/transport.json artifacts/transport.json
wrote transport.json c72c1cdcfc79
transport.json byte-identical rebuild
(jsonschema Draft 2020-12 vs contracts/transport.schema.json) transport.json schema-valid
$ python3 scripts/check_boundaries.py
boundary: OK (90 files scanned)
```

### Test file, verbose
```
test_T1_traces_read_from_pinned_h5_with_units_and_gradients PASSED
test_T2_time_weighted_means_reproduce_fixtures PASSED
test_T2_window_mean_equals_analytic_integral_for_piecewise_linear_Q PASSED
test_T3_window_stats_coverage_stderr_stationarity_and_claim_gate PASSED
test_T3_stderr_estimator_is_calibrated_on_synthetic_ar1 PASSED
test_T4_reduced_modal_run_against_archive_and_fixtures PASSED
test_T5_gx_to_archive_converts_and_refuses_without_identical_references PASSED
test_T6_compare_window_verdict_delta_uncertainty_and_no_claim PASSED
test_T7_triangular_published_mean_only PASSED
9 passed in 0.15s
```

### Probe 1: raw h5 and the duplicate samples (own h5py code)
```
keys ['GENE', 'ngrad', 'stella', 'tgrad'] tgrad 3 ngrad 1
stella n 1441 t0 0.0 tend 2074.7 nonincreasing idx [418, 602]
  at i=418 t[i]=606.190000 t[i+1]=601.850000
  at i=602 t[i]=866.630000 t[i+1]=862.290000
GENE n 1106 t0 0.0 tend 1893.765478748425 nonincreasing idx []
repeated t values: 8 [601.85 603.3  604.75 606.19 862.29 863.74 865.19 866.63]
  t=601.850000 Q values [2.50893368 2.50893368] identical True
  ... (all 8 identical True)
stella deduped n 1433 dropped 8
artifact vs my dedup: stella-bean 1433 max|dt| 0.0 max|dQ| 5.0e-07 ; gene-bean 1106 max|dt| 5.0e-04 max|dQ| 5.0e-07   (JSON stores 7 significant figures)
```
The overlaps are at t≈602 and t≈862, well outside every analysis window, so the dedup cannot change any window mean. It is still needed: without it `t` is not monotonic and the code raises (mutation `no_dedup` below).

### Probe 2: window means (own exact segment integrator)
```
code    window            mine_edge   artifact       span      PRD prints
stella  1500-1900           2.24213    2.24213    2.24216    2.242 True
GENE    1500-1893.765       2.47386    2.47386    2.47426    2.474 True
stella  200-300             2.71552    2.71552    2.71510     None None
stella  300-400             2.55454    2.55454    2.55225     2.55 True
GENE    200-300             2.92603    2.92603    2.92496     None None
GENE    300-400             2.67507    2.67507    2.67429     2.68 True
```

### Probe 3: stderr by batch means, and linear-trend stationarity check (own code)
```
stella 1500-1900: artifact stderr=0.0192 stationary=True claim=True
   batch-means stderr {4: 0.0256, 5: 0.0186, 8: 0.0181, 10: 0.0154, 16: 0.0139, 20: 0.0133}  ratio artifact/BM 0.75..1.45
   linear fit drift over window=-0.0303, drift/stderr=-1.6
GENE   1500-1893.765: artifact stderr=0.0145 stationary=True claim=True
   batch-means stderr {4: 0.0107, 5: 0.0131, 8: 0.0123, 10: 0.0123, 16: 0.0125, 20: 0.0105}  ratio 1.11..1.39
   drift=-0.0063, drift/stderr=-0.4
stella 200-300: artifact stderr=0.0489 stationary=False claim=False
   batch-means {4: 0.0569, 5: 0.0501, 8: 0.0402, 10: 0.0357, 16: 0.0282, 20: 0.0251}  ratio 0.86..1.94
   drift=+0.2831, drift/stderr=+5.8      half-split z=-2.70 -> NOT stationary
stella 300-400: artifact stderr=0.0431 stationary=False claim=False
   batch-means {4: 0.0464, 5: 0.0439, 8: 0.0339, 10: 0.0303, 16: 0.0238, 20: 0.0213}  ratio 0.93..2.03
   drift=-0.2678, drift/stderr=-6.2      half-split z=+2.34 -> NOT stationary
GENE   200-300: artifact stderr=0.0352 stationary=False claim=False
   batch-means {4: 0.0365, 5: 0.031, 8: 0.0272, 10: 0.0259, 16: 0.021, 20: 0.0188}  ratio 0.96..1.88
   drift=-0.1982, drift/stderr=-5.6      half-split z=+3.77 -> NOT stationary
GENE   300-400: artifact stderr=0.0208 stationary=True claim=True
   batch-means {4: 0.0202, 5: 0.022, 8: 0.021, 10: 0.0196, 16: 0.0161, 20: 0.0144}  ratio 0.95..1.44
   drift=-0.0229, drift/stderr=-1.1
```
The largest ratios (about 2) come from 20 batches of 5 time units, which is shorter than τ_int ≈ 10. Batch means with batches shorter than the correlation time are known to underestimate the stderr. With ≤ 8 batches, every ratio is 0.75–1.45. Every artifact stderr is within a factor 2 of batch means, and the non-stationary verdicts agree with a clear linear trend (|drift| > 5 stderr).

### Probe 4: T5 and T6 (calls the functions under test on my own inputs)
```
T5 t: [0.0, 1.4142135623730951, 14.142135623730951] expect [0, 1.4142135623730951, 14.142135623730951]
T5 q: [0.35355339059327373, 1.0, 2.82842712474619] expect [0.35355339059327373, 1.0, 2.82842712474619]
T5 refused {'identical_references': False} ValueError refusing GX->archive conversion: dimensional references not asserted identical
T5 refused {'identical_references': 0} ValueError ...
T5 refused {} TypeError gx_to_archive() missing 1 required keyword-only argument: 'identical_references'
T5 accepted string 'no' -> ([1.4142135623730951], [0.35355339059327373])        <- F1
T5 round-trip max|dt| 0.0 max|dQ| 4.440892098500626e-16
T6 GENE+0.0   on (1500.0, 1893.765): verdict=agree     delta=+0.0000 comb=0.0205 z=+0.00
T6 GENE+0.01  ...: verdict=agree     delta=+0.0100 comb=0.0205 z=+0.49
T6 GENE+0.03  ...: verdict=agree     delta=+0.0300 comb=0.0205 z=+1.46
T6 GENE+0.04  ...: verdict=agree     delta=+0.0400 comb=0.0205 z=+1.95
T6 GENE+0.05  ...: verdict=disagree  delta=+0.0500 comb=0.0205 z=+2.44
T6 GENE+0.08  ...: verdict=disagree  delta=+0.0800 comb=0.0205 z=+3.90
T6 GENE+0.5   ...: verdict=disagree  delta=+0.5000 comb=0.0205 z=+24.37
T6 resampled GX copy +0.06 archive units: disagree 0.06 2.93 |delta|/combined stderr = 2.93 (> 2)
T6 resampled GX copy unshifted: agree 0.0 0.0
T6 time-shifted (ends 1693.8): no claim | new trace does not cover 1500-1893.765 | delta None
T6 truncated new: no claim | new trace does not cover 1500-1893.765
T6 GENE vs GENE 200-300: no claim | new trace not shown stationary on 200-300; archive trace not shown stationary on 200-300 | delta 0.0
T6 stella vs GENE 300-400: no claim | new trace not shown stationary on 300-400 | delta -0.1205
T6 ramp new: no claim | new trace not shown stationary on 1500-1893.765
T6 stella vs GENE 1500-1893.765: disagree -0.2333 0.0251 -9.3
```

### Probe 5: T7 and honesty (artifact JSON)
```
trace ids/tubes: [('stella-bean', 'bean', 1433), ('gene-bean', 'bean', 1106)]
triangular: {"publishedMean": 2.22, "rawTraceStatus": "unverified", "source": {..."url": "https://doi.org/10.1017/S0022377822000393"}, "window": [1200.0, 1500.0]}
occurrences of triang: only in `triangular` and fixtures[5] triangular-published-1200-1500
reducedModalRun: 5.79 [300.0, 400.0] {'GENE': 2.675066, 'stella': 2.554537} prd-reported {'outcome': 'blocked', 'details': "Number stated in PRD.md; the run's output is not in this repo so it cannot be recomputed. Archive values beside it are recomputed time-weighted window means (D-013)."}
300-400 window rows: 2.554537 2.675066
fixtures: 2.242→2.242127 ✓, 2.474→2.473862 ✓, 2.55→2.554537 ✓, 2.68→2.675066 ✓, 5.79→null (matches null), 2.22→null (matches null)
gene-bean-300-400 note: "... sample-span trapezoid ... gives 2.67429 (prints as 2.67). This fixture is definition-sensitive ..."
```

### Mutation tests (copies only, in scratchpad/v02/mut; repo h5 sha256 8560015e…9d4a unchanged)
The test file was copied. A conftest redirects `STELLA_BENCHMARK_H5` to an h5 copy with Q shifted by ±0.002, or monkeypatches the code.
```
=== MUT_H5=control.h5 (unmodified copy)
2 passed, 7 deselected
=== MUT_H5=stella_p002.h5 (stella Q + 0.002)
E       assert 2.244126917812878 == 2.24213 ± 5.0e-05
E       assert 2.556537474199908 == 2.55454 ± 5.0e-05
FAILED test_T1_... (artifact source sha/path)  FAILED test_T2_time_weighted_means_reproduce_fixtures  FAILED test_T4_...
3 failed, 6 passed
=== MUT_H5=gene_m002.h5 (GENE Q − 0.002)
E       assert 2.471861787389729 == 2.47386 ± 5.0e-05
E       assert 2.6730656983869774 == 2.67507 ± 5.0e-05
FAILED test_T1_...  FAILED test_T2_time_weighted_means_reproduce_fixtures  FAILED test_T4_...
3 failed, 6 passed
=== CODE_MUT=span_mean (window_mean := sample-span trapezoid)
FAILED test_T2_time_weighted_means_reproduce_fixtures / test_T2_window_mean_equals_analytic_integral... / test_T4_...
3 failed, 6 passed
=== CODE_MUT=z_inf (stationarity threshold 1e9)
FAILED test_T3_window_stats_... / test_T3_stderr_estimator_is_calibrated_on_synthetic_ar1 / test_T6_...
3 failed, 6 passed
=== CODE_MUT=stderr_x3
FAILED test_T3_window_stats_... / test_T3_stderr_estimator_is_calibrated_on_synthetic_ar1
2 failed, 7 passed
=== CODE_MUT=no_dedup
FAILED test_T6_...   1 failed, 2 passed, 6 errors
```

## Findings
- **F1 (minor, non-blocking)** `main/labyrinth_main/features/transport/units.py:18` checks `if not identical_references:`. Any truthy value, for example the string `"no"`, passes and the conversion proceeds. The refusal works for `False`, `0` and a missing argument. Suggest `if identical_references is not True:`.
- **F2 (observation)** `main/tests/test_transport.py:58` uses tolerance abs 5e-5 on stella 1500–1900. That cannot tell the edge-interpolated mean (2.24213) from the sample-span mean (2.24216). The definition is still pinned by the analytic test and by the T4 GENE 300–400 assertion: the `span_mean` mutation fails 3 tests.
- **F3 (observation, honest and displayed)** The GENE 300–400 match is 7e-5 above the rounding boundary (2.67507 vs 2.675). The note shows the sensitivity to the mean definition (sample-span 2.67429 prints 2.67), as D-013 requires.
- **F4 (for the frontend, T10)** The stella 300–400 archive value (2.5545) is from a window flagged **not stationary** (z=+2.34, drift −0.27). `reducedModalRun` does not carry that flag itself, so the discrepancy card must join it from `windows[]`. The 5.79 run is a single PRD number with no trace, so `compare_window` cannot be applied to it.
- **F5 (informational)** stella vs GENE on 1500–1893.765 gives `disagree` (Δ=−0.233, z=−9.3). This is a real code-to-code difference in the archive. Any UI must not imply that the two archive traces agree.
- **verify.sh attribution.** `verify.sh main` exited 0 at 22:09 UTC with the transport files in their final state. Later reds are outside transport: `main/tests/test_common.py` with the unpinned `data/raw/stella_test2_vmec_geometry.out.nc`, then `main/labyrinth_main/features/geometry/artifact.py:35` (TypeError in `compare()`, which also breaks `artifacts:fresh`). The `verify.sh all` renderer:typecheck failure is in `renderer/src/design/components/*.tsx` (missing `components.css` module declaration). In isolation, transport passes its tests, rebuilds byte-identically and is schema-valid.
- **Task status.** Backend T1–T7 are verified. T8–T12 are not yet built. Task 02 is **not DONE** until the frontend is verified here, the reviewer approves, and `verify.sh all` is green.

Verdict: PASS
