# Verify: 02-transport (backend T1–T7 only)
Verifier run: 2026-11-20 07:47–07:59 UTC, commit 4696675 + working tree. This is round 2, after the D-017 fix round.
The transport files are untracked in the working tree. Their sha256 prefixes were identical at the start and at the end of this run:
archive.py addb68f339ebbe8f · artifact.py 8c5bdc3aed1e3a16 · compare.py dcb3257d7ccae3f8 · stats.py ce015b1da2f5cb83 · units.py 083642e38a018a59 · test_transport.py 13da87580fc18d96 · artifacts/transport.json ae594c701e542a5a.

**Scope.** This file covers the backend half (T1–T7). The frontend (T8–T12) is being built concurrently and has **not been verified**. **Task 02 stays not-DONE** until the frontend outcomes are verified and recorded here, and the reviewer approves the diff.

## History
- **Round 1** (2026-11-19, commit 76b1908 + tree): backend PASS. It raised F1: `units.py` accepted truthy non-bools such as `"no"` for `identical_references`. Its claim gate then allowed claims at N_eff ≈ 5–17: stella 1500–1900, GENE 1500–1893.765 and GENE 300–400 were all "claim allowed". stella vs GENE on 1500–1893.765 came out "disagree" (z = −9.3).
- **Fix round** (D-017) changed the following:
  - Bias-corrected Sokal τ.
  - Claims need N_eff ≥ 20, taken at the one-sigma upper bound of τ.
  - Student-t intervals.
  - Stationarity uses max(τ_full, τ_residual), and indicative verdicts are serialised as `null`.
  - TOST `compare_window` with a ±10 % margin and an `inconclusive` verdict.
  - Coverage checks gaps at the window edges.
  - Shared dedup that refuses divergent restarts.
  - `identical_references is not True` (fixes F1).
- **Round 2** (this file): re-verified from scratch. All round-1 probes were rerun, and Monte-Carlo checks of the claim gate and of `compare_window` were added.

## Outcomes
| # | Expected outcome | Test(s) | Independent probe | Result |
|---|---|---|---|---|
| T1 | Traces from `compared/test5/{stella,GENE}/{t,Q}`, units `Q_i/Q_gB,i` vs `t v_th,i/a`, tgrad 3 / ngrad 1 in provenance | `test_T1_traces_read_from_pinned_h5_with_units_and_gradients`, `test_T1_divergent_restart_is_refused_not_silently_dropped` | My own h5py read: stella has 1441 raw samples, with time going backwards at idx 418 (606.19→601.85) and idx 602 (866.63→862.29). The 8 repeated t values all repeat identical Q. My `np.unique` dedup gives 1433 samples, equal to the artifact (t exact; Q within 5e-7 because the JSON keeps 7 significant figures). GENE: 1106 samples, strictly increasing. Raw stella with one repeat's Q edited (+0.1) is refused, giving "no claim" with reason "divergent restart repeats" | PASS |
| T2 | Edge-interpolated means reproduce 2.242 (stella 1500–1900) and 2.474 (GENE 1500–1893.765) | `test_T2_time_weighted_means_reproduce_fixtures`, `test_T2_window_mean_equals_analytic_integral_for_piecewise_linear_Q` | My exact segment-clipping integrator gives 2.24213 and 2.47386, equal to the artifact. Shifting Q by ±0.002 in an h5 copy makes T2 fail | PASS |
| T3 | Coverage, mean, autocorrelation-corrected stderr (method documented), stationarity, claim gate (covered ∧ stationary ∧ finite stderr; D-017 adds N_eff ≥ 20) | `test_T3_window_stats_coverage_stderr_stationarity_and_claim_gate`, `test_T3_edge_hole_window_not_covered`, `test_T3_claim_gate_and_stderr_calibration_monte_carlo`, `test_T3_stationarity_false_rejection_rate_at_small_n` | **stderr:** the finite stderrs are within 0.75–1.58× of batch means with 4–20 batches. **Own Monte-Carlo** on AR(1), oscillatory AR(2) and Gaussian-filtered noise: the t-interval covers the true mean 90–98 % of the time. The gate is almost shut at true N_eff ≈ 10–14 (2–9 % open) and open at true N_eff ≥ 145 (≥ 93 %). Without restricting to claims, the half-split test rejects stationary AR(1) data 4 % of the time and a step of 0.3 sd 86.5 % of the time. On the archive, no window allows a claim and every `stationary` value is `null` (D-017) | PASS (findings N1–N3) |
| T4 | Reduced Modal 5.79 on 300–400 vs archive 300–400 means; 2.55 and 2.68 reproduce; sample-span 2.674 recorded in the note | `test_T4_reduced_modal_run_against_archive_and_fixtures` | My values: stella 2.55454 (prints 2.55), GENE 2.67507 (prints 2.68), sample-span 2.67429 (in the note). `reducedModalRun.archive` is {stella 2.554537, GENE 2.675066}, equal to the window rows. 5.79 has `prd-reported`/`blocked`, `computed: null` | PASS (N5) |
| T5 | `gx_to_archive` gives (t·√2, Q/(2√2)) and raises unless the caller asserts identical references | `test_T5_gx_to_archive_converts_and_refuses_without_identical_references` | Exact on my inputs; round trip to 4e-16. Refuses `False`, `0`, `1`, `1.0`, `"no"`, `"True"`, `None` and `np.True_`; a missing keyword raises TypeError. The round-1 F1 is fixed, and mutating it back is caught by T5 | PASS |
| T6 | `compare_window` returns verdict + delta + combined uncertainty; "no claim" when either side is uncovered or non-stationary | `test_T6_compare_window_tost_verdicts_and_no_claim`, `test_T6_compare_window_dedups_repeats_and_refuses_divergent`, `test_T6_null_false_disagree_rate_near_nominal` | **Null Monte-Carlo** (my own generators and seeds): the false "disagree" rate among claims is 3.8–5.6 % at margins 0 and 0.10, against nominal 5 %. **Power** (+0.5 shift): 94 % disagree, 6 % no claim. **Synthetic GX-normalised traces** passed through `gx_to_archive`: Δ=0 → agree, Δ=0.3 (> 0.247 margin) → disagree. **Archive** (shifted GENE copies, stella vs GENE, time-shifted, truncated): all "no claim" with the correct reason | PASS (N4) |
| T7 | Triangular: published 2.22 over 1200–1500, `rawTraceStatus: unverified`, no triangular trace | `test_T7_triangular_published_mean_only` | Only `stella-bean` and `gene-bean` traces are emitted, both `tube: bean`. "triang" appears only in `triangular` and in the fixture (computed null). The source is now labelled "PRD-reported; not checked against the paper" | PASS |
| T8–T12 | Frontend | — | — | being built concurrently, not verified |

## Real output

### verify.sh
```
$ bash scripts/verify.sh main                     # 07:4x UTC
boundary self-test: OK (37 violations caught, 8 clean files passed)
11 passed in 0.66s
All checks passed!
105 passed in 26.36s
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (27s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
verify.sh: all stages passed.
exit=0

$ bash scripts/verify.sh all                      # 07:5x UTC
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (28s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (1s)
  PASS  renderer:typecheck (3s)
  PASS  renderer:tests (7s)
  PASS  renderer:build (3s)
verify.sh: all stages passed.
exit=0

$ python3 scripts/check_boundaries.py
boundary: OK (142 files scanned)
```
Renderer files and `tasks/03-forecast/VERIFY.md` changed during the run (`LiveView.tsx`, `SpatialView.tsx`, new `*.test.tsx`, `*.css`). Those are other agents. No transport file changed.

### Test file
```
$ python3 -m pytest -v -p no:cacheprovider main/tests/test_transport.py
test_T1_traces_read_from_pinned_h5_with_units_and_gradients PASSED
test_T1_divergent_restart_is_refused_not_silently_dropped PASSED
test_T2_time_weighted_means_reproduce_fixtures PASSED
test_T2_window_mean_equals_analytic_integral_for_piecewise_linear_Q PASSED
test_T3_window_stats_coverage_stderr_stationarity_and_claim_gate PASSED
test_T3_edge_hole_window_not_covered PASSED
test_T3_claim_gate_and_stderr_calibration_monte_carlo PASSED
test_T3_stationarity_false_rejection_rate_at_small_n PASSED
test_T4_reduced_modal_run_against_archive_and_fixtures PASSED
test_T5_gx_to_archive_converts_and_refuses_without_identical_references PASSED
test_T6_compare_window_tost_verdicts_and_no_claim PASSED
test_T6_compare_window_dedups_repeats_and_refuses_divergent PASSED
test_T6_null_false_disagree_rate_near_nominal PASSED
test_T7_triangular_published_mean_only PASSED
14 passed in 3.40s
```

### Probe 1: raw h5 and the duplicate samples (own h5py)
```
stella n 1441 t0 0.0 tend 2074.7 nonincreasing idx [418, 602]
GENE n 1106 t0 0.0 tend 1893.765478748425 nonincreasing idx []
repeated t values: 8 [601.85 603.3  604.75 606.19 862.29 863.74 865.19 866.63]
  t=601.850000 Q values [2.50893368 2.50893368] identical True
  ... (all 8 identical True)
stella deduped n 1433 dropped 8
stella-bean bean 1433 max|dt| 0.0 max|dQ| 4.998711142789602e-07
gene-bean bean 1106 max|dt| 0.000498880492614262 max|dQ| 4.994405524705314e-07
```

### Probe 2: window means (own exact integrator) vs artifact vs PRD
```
code    window            mine_edge   artifact       span      PRD prints
stella  1500-1900           2.24213    2.24213    2.24216    2.242 True
GENE    1500-1893.765       2.47386    2.47386    2.47426    2.474 True
stella  200-300             2.71552    2.71552    2.71510     None None
stella  300-400             2.55454    2.55454    2.55225     2.55 True
GENE    200-300             2.92603    2.92603    2.92496     None None
GENE    300-400             2.67507    2.67507    2.67429     2.68 True
```

### Probe 3: artifact window rows; stderr vs batch means; linear trend (own code)
```
stella-bean [200,300]   n 69  mean 2.715518 se None    stat None claim False  (Sokal not reached; tau_int > 9.71)
stella-bean [300,400]   n 68  mean 2.554537 se None    stat None claim False  (Sokal not reached; tau_int > 9.85)
stella-bean [1500,1900] n 277 mean 2.242127 se 0.01922 stat None claim False  (t=+0.69 vs 2.22, uncorrected-tau fallback, N_eff~12.3)
gene-bean   [200,300]   n 60  mean 2.926028 se 0.0352  stat None claim False  (t=+2.39 vs 2.79, indicative 'stationary', fallback, N_eff~5.94)
gene-bean   [300,400]   n 59  mean 2.675066 se 0.02076 stat None claim False  (t=-0.35 vs 2.31, fallback, N_eff~9.96)
gene-bean   [1500,1900] covered False (trace ends 1893.765479) mean None claim False
gene-bean   [1500,1893.765] n 224 mean 2.473862 se 0.01657 stat None claim False (bias-corrected tau 14, N_eff 14.1, >= 7.56 at tau upper bound)

stella 1500-1900: batch-means stderr {4: 0.0256, 5: 0.0186, 8: 0.0181, 10: 0.0154, 16: 0.0139, 20: 0.0133}  ratio artifact/BM 0.75..1.45  drift/stderr -1.6
GENE 1500-1893.765: batch-means {4: 0.0107, 5: 0.0131, 8: 0.0123, 10: 0.0123, 16: 0.0125, 20: 0.0105}  ratio 1.26..1.58  drift/stderr -0.4
GENE 200-300: batch-means {4: 0.0365, 5: 0.031, 8: 0.0272, 10: 0.0259, 16: 0.021, 20: 0.0188}  ratio 0.96..1.88  drift -0.1982 (drift/stderr -5.6)
GENE 300-400: batch-means {4: 0.0202, 5: 0.022, 8: 0.021, 10: 0.0196, 16: 0.0161, 20: 0.0144}  ratio 0.94..1.44  drift/stderr -1.1
stella 200-300: batch-means {4: 0.0569, 5: 0.0501, 8: 0.0402, ...}  linear drift +0.2831 (≈5–6 batch-means stderr)
stella 300-400: batch-means {4: 0.0464, 5: 0.0439, 8: 0.0339, ...}  linear drift -0.2678 (≈5–6 batch-means stderr)
```

### Probe 4: Monte-Carlo of the claim gate and interval coverage (own generators, seed 424242)
```
  AR1 phi=.8      tau_true= 3.47 N=  277 trueNeff=  39.9  stderr finite 300/300  gate open 54.0%  CI cover(all finite) 95.3%  cover|claim 92.0%
  AR1 phi=.8      tau_true= 3.47 N= 1000 trueNeff= 144.0  stderr finite 300/300  gate open 93.3%  CI cover(all finite) 94.3%  cover|claim 94.6%
  AR1 phi=.8      tau_true= 3.47 N= 4000 trueNeff= 575.8  stderr finite 150/150  gate open 95.3%  CI cover(all finite) 97.3%  cover|claim 97.2%
  AR1 tau~11      tau_true=13.80 N=  277 trueNeff=  10.0  stderr finite 300/300  gate open  8.7%  CI cover(all finite) 90.3%  cover|claim 57.7%
  AR1 tau~11      tau_true=13.80 N= 1000 trueNeff=  36.2  stderr finite 300/300  gate open 84.3%  CI cover(all finite) 94.3%  cover|claim 93.7%
  AR1 tau~11      tau_true=13.80 N= 4000 trueNeff= 145.0  stderr finite 150/150  gate open 95.3%  CI cover(all finite) 92.7%  cover|claim 92.3%
  AR2 osc         tau_true= 1.92 N=  277 trueNeff=  72.3  stderr finite 300/300  gate open 90.0%  CI cover(all finite) 95.7%  cover|claim 95.2%
  AR2 osc         tau_true= 1.92 N= 1000 trueNeff= 261.0  stderr finite 300/300  gate open 97.3%  CI cover(all finite) 97.7%  cover|claim 97.6%
  AR2 osc         tau_true= 1.92 N= 4000 trueNeff=1044.2  stderr finite 150/150  gate open 95.3%  CI cover(all finite) 96.7%  cover|claim 96.5%
  Gauss-filt s=6  tau_true= 9.97 N=  277 trueNeff=  13.9  stderr finite 300/300  gate open  2.0%  CI cover(all finite) 93.7%  cover|claim 83.3%
  Gauss-filt s=6  tau_true= 9.97 N= 1000 trueNeff=  50.1  stderr finite 300/300  gate open 82.7%  CI cover(all finite) 94.7%  cover|claim 93.5%
  Gauss-filt s=6  tau_true= 9.97 N= 4000 trueNeff= 200.5  stderr finite 150/150  gate open 94.0%  CI cover(all finite) 94.0%  cover|claim 94.3%

Stationarity test, N=4000 AR1 phi=.8 (seed 777, 200 reps):
  null                  : stationary True/False/None = 192/8/0    claims 192/200
  linear drift 0.15 sd  : stationary True/False/None = 181/19/0   claims 181/200
  linear drift 0.5 sd   : stationary True/False/None = 49/151/0   claims 49/200
  step 0.3 sd at half   : stationary True/False/None = 27/173/0   claims 27/200
```

### Probe 5: compare_window under the null, and its power (own generators)
```
  AR1 phi=.8 N=2000 margin=0.00: {'no claim': 14, 'inconclusive': 177, 'disagree': 9}  false-disagree rate among claims 4.8%
  AR1 phi=.8 N=2000 margin=0.10: {'agree': 27, 'disagree': 7, 'inconclusive': 146, 'no claim': 20}  false-disagree rate among claims 3.9%
  AR1 phi=.8 N=6000 margin=0.00: {'inconclusive': 177, 'no claim': 14, 'disagree': 9}  false-disagree rate among claims 4.8%
  AR1 phi=.8 N=6000 margin=0.10: {'agree': 162, 'no claim': 22, 'disagree': 9, 'inconclusive': 7}  false-disagree rate among claims 5.1%
  AR2 osc    N=2000 margin=0.00: {'inconclusive': 175, 'no claim': 18, 'disagree': 7}  false-disagree rate among claims 3.8%
  AR2 osc    N=2000 margin=0.10: {'inconclusive': 179, 'no claim': 13, 'disagree': 8}  false-disagree rate among claims 4.3%
  AR2 osc    N=6000 margin=0.00: {'inconclusive': 176, 'no claim': 14, 'disagree': 10}  false-disagree rate among claims 5.4%
  AR2 osc    N=6000 margin=0.10: {'inconclusive': 169, 'disagree': 10, 'no claim': 21}  false-disagree rate among claims 5.6%
power, AR1 phi=.8, N=6000, margin 10% (=0.3):
  delta=0.05: {'agree': 66, 'inconclusive': 8, 'disagree': 12, 'no claim': 14}
  delta=0.2: {'disagree': 58, 'agree': 26, 'no claim': 6, 'inconclusive': 10}
  delta=0.5: {'disagree': 94, 'no claim': 6}
```

### Probe 6: T5, and T6 on the archive and on converted synthetic GX traces
```
T5 refused 'no' / 1 / 1.0 / np.True_ / 'True' / None ; refused False, 0 (ValueError); missing kwarg -> TypeError
T5 t: [0.0, 1.4142135623730951, 14.142135623730951]   q: [0.35355339059327373, 1.0, 2.82842712474619]   (exact)
T5 round-trip max|dt| 0.0 max|dQ| 4.440892098500626e-16
T6 GENE+0.0 vs GENE (1500.0, 1893.765): verdict=no claim delta=0.0 comb=0.0234 | new trace not shown stationary ...; archive trace not shown stationary ...
T6 GENE+0.05 / +0.5 vs GENE: verdict=no claim (same reason)
T6 stella vs GENE 1500-1893.765: verdict=no claim delta=-0.2333 comb=0.0263
T6 stella vs GENE 300-400: verdict=no claim delta=-0.1205 comb=None
T6 GENE time-shifted -200: verdict=no claim delta=None | new trace does not cover 1500-1893.765; ...
T6 raw stella (with repeats) vs GENE: verdict=no claim delta=-0.2333 comb=0.0263      (dedup inside compare_window; same as clean)
T6 raw stella with a divergent repeat: verdict=no claim delta=None | new trace has divergent restart repeats: 1 of 8 non-increasing samples do not repeat an earlier sample (first: index 420, t=603.3, Q=2.62732)
T6 synthetic GX run (archive delta 0.0) converted vs synthetic archive: verdict=agree delta=-0.0011 comb=0.0026 | 90% CI of delta [-0.00532, 0.003136] lies within ±0.2471
T6 synthetic GX run (archive delta 0.1) converted vs synthetic archive: verdict=agree delta=0.0977 comb=0.0025 | 90% CI [0.09361, 0.1019] lies within ±0.2471
T6 synthetic GX run (archive delta 0.3) converted vs synthetic archive: verdict=disagree delta=0.3006 comb=0.0026 | 95% CI [0.2954, 0.3058] excludes 0 and equivalence within ±0.2471 is not shown
```

### Probe 7: T7 and honesty (artifact JSON)
```
traces: [('stella-bean', 'bean', 1433), ('gene-bean', 'bean', 1106)]
triangular: {"publishedMean": 2.22, "rawTraceStatus": "unverified", "source": {"label": "PRD.md · Accuracy fixtures — triangular published mean 2.22 over 1200–1500. PRD-reported; not checked against the paper (González-Jerez et al. 2022, doi:10.1017/S0022377822000393)", "sha256": "n/a", "url": "PRD.md"}, "window": [1200.0, 1500.0]}
triang occurrences: 5 keys with triang: ['fixtures', 'triangular']
reducedModalRun: 5.79 [300.0, 400.0] {'GENE': 2.675066, 'stella': 2.554537} prd-reported blocked
 fx stella-bean-1500-1900 2.242 2.242127 True | ... stderr 0.0192 (approximate) ... sample-span 2.24216
 fx gene-bean-1500-1893.765 2.474 2.473862 True | ... stderr 0.0166 (approximate) ... sample-span 2.47426
 fx stella-bean-300-400 2.55 2.554537 True | ... stderr not finite (autocorrelation time not resolved in this window) ... sample-span 2.55225
 fx gene-bean-300-400 2.68 2.675066 True | ... stderr 0.0208 (approximate) ... gives 2.67429 (prints as 2.67). This fixture is definition-sensitive ...
 fx reduced-modal-stella-300-400 5.79 None None | PRD-reported; the reduced Modal run's trace is not in this repo, so it cannot be recomputed.
 fx triangular-published-1200-1500 2.22 None None | PRD-reported; not checked against the paper (...). The raw triangular trace is unverified and not emitted.
any claim allowed: False  stationary values: ['None']
```

### Mutation tests (copies only, under scratchpad/v02/mut; repo h5 sha256 8560015e04a44819… unchanged)
The test file was copied, and a conftest redirected `STELLA_BENCHMARK_H5` to an h5 copy with the original file name, or monkeypatched the code.
```
=== control (unmodified copy)                    14 passed
=== stella Q + 0.002
E       assert 2.244126917812878 == 2.24213 ± 5.0e-05
E       assert 2.556537474199908 == 2.55454 ± 5.0e-05
FAILED test_T2_time_weighted_means_reproduce_fixtures ; FAILED test_T4_...      2 failed, 12 passed
=== GENE Q − 0.002
E       assert 2.471861787389729 == 2.47386 ± 5.0e-05
E       assert 2.6730656983869774 == 2.67507 ± 5.0e-05
FAILED test_T2_time_weighted_means_reproduce_fixtures ; FAILED test_T4_...      2 failed, 12 passed
=== span_mean (window_mean := sample-span)       FAILED T2 x2, T4                          3 failed
=== neff_min_5 (claim gate N_eff >= 5)           FAILED T3 gate, T3 MC gate, T3 stationarity  3 failed
=== no_indicative_mask                           FAILED T3 gate, T3 stationarity, T6 tost     3 failed
=== stderr_x0.6                                  FAILED T3 MC calibration, T6 null rate       2 failed
=== residual_tau_only (biased-low stationarity)  FAILED T3 MC, T3 stationarity, T6 dedup, T6 null  4 failed
=== margin_1.0                                   FAILED T6 tost                               1 failed
=== z_test_compare (TOST removed)                FAILED T6 tost, T6 null rate                 2 failed
=== truthy_refs (round-1 F1 reintroduced)        FAILED T5                                    1 failed
=== no_divergent_check                           FAILED T1 divergent, T6 dedup/divergent       2 failed
=== no_bias_correction                           14 passed      <- survives (N1)
```

## Findings
None of these blocks the backend verdict.
- **N1 (weak test)** `stats.py` `integrated_autocorr_time(..., bias_correct=True)` has no test that pins the bias correction. Disabling it everywhere still passes all 14 tests. The effect is modest. With AR(1) at N=277 and true τ≈14 (archive-like), 400 reps:

  | | gate open | coverage given a claim |
  |---|---|---|
  | with correction | 7.8 % | 77.4 % |
  | without correction | 11.2 % | 68.9 % |

  At N=1000 the two are indistinguishable. Suggest a test that asserts the corrected τ on a short AR(1) is closer to the truth than the uncorrected one.
- **N2 (known limitation, documented in D-017)** The gate can still open when the true N_eff is about 10, and those claims are poorly covered. My Monte-Carlo at N=277, τ_true=13.8 gives the gate open 8.7 % of the time, with coverage given a claim of 57.7 %. D-017 reports 6.7 % and 62.5 %. No archive window is affected (no claims). A live GX run should be judged with this in mind: claims are reliable from true N_eff of roughly ≥ 36, where coverage given a claim is ≥ 92 %.
- **N3 (information loss, conservative)** Every archive window now serialises `stationary: null`. That includes stella 200–300 and 300–400, which have clear linear drifts of +0.28 and −0.27 (about 5–6 batch-means stderr), and GENE 200–300 (drift −0.20, 5.6σ). Round 1 called all three "NOT stationary". This cannot produce a false claim. However, the detail text for GENE 200–300 reads `test result 'stationary' is indicative only` (`stats.py` `window_stats` verdict text) for an obvious transient. The frontend (T9) should display only "undecidable", never the indicative word.
- **N4 (semantics to label carefully in the UI)** `compare_window` reports "disagree" when the 95 % CI excludes 0 and equivalence is not shown (`compare.py` `equivalence_verdict`). A true Δ inside the ±10 % margin can therefore come out "disagree": Δ=0.2 with margin 0.3 gave 58 % disagree. A precisely measured Δ=0.1 comes out "agree". This matches the docstring and D-017, but "disagree" should be worded as "difference resolved; equivalence not shown".
- **N5 (for T10)** The stella 300–400 archive value (2.5545) now has `stderr: null` because the Sokal window was not reached (τ > 9.85). The discrepancy card for 5.79 therefore has no archive uncertainty on the stella side. It must say so rather than show ±0.
- **F2 (carried over)** `main/tests/test_transport.py` uses tolerance abs 5e-5 on stella 1500–1900 (2.24213). That cannot separate the edge-interpolated mean from sample-span (2.24216). The definition is pinned by the analytic test and by T4 (`span_mean` mutation: 3 failures).
- **F3 (carried over, displayed honestly)** GENE 300–400 = 2.67507 matches 2.68 by only 7e-5 above the rounding boundary. The note shows sample-span 2.67429 → 2.67.
- **Resolved:** round-1 F1 (`units.py` now checks `identical_references is not True`; reintroducing the old check is caught by T5). Round-1 F5 (stella vs GENE "disagree" at z=−9.3) is now "no claim" because neither side is shown stationary with N_eff ≥ 20 (D-017).
- **Harness note:** an h5 copy with a different file name fails only T1's `path.endswith(<pinned filename>)` assertion. Copies saved under the original file name pass all 14 tests.
- **Task status:** backend T1–T7 are verified. Frontend T8–T12 are not verified. Task 02 is **not DONE** until the frontend is verified here and the reviewer approves.

Verdict: PASS
