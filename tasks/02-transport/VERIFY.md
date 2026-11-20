# Verify: 02-transport
This file keeps every verifier run. Rounds 1–2 (backend outcomes T1–T7) come first, then Run 3 and Run 4 (whole task, T1–T12). **The last run in the file carries the current verdict.**

## Round 2 — backend outcomes T1–T7 (2026-11-20, commit 4696675 + working tree)
Verifier run: 2026-11-20 07:47–07:59 UTC, commit 4696675 + working tree. This is round 2, after the D-017 fix round.
The transport files are untracked in the working tree. Their sha256 prefixes were identical at the start and at the end of this run:
archive.py addb68f339ebbe8f · artifact.py 8c5bdc3aed1e3a16 · compare.py dcb3257d7ccae3f8 · stats.py ce015b1da2f5cb83 · units.py 083642e38a018a59 · test_transport.py 13da87580fc18d96 · artifacts/transport.json ae594c701e542a5a.

**Scope of round 2.** Round 2 covered the backend outcomes T1–T7. The frontend outcomes T8–T12 were still being built at that time and were not part of round 2; Run 3 at the end of this file covers them. (Run 3 reworded this paragraph, the title line and two status notes below, and added the "Round 2" heading. The round-2 evidence is unchanged.)

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
| T8–T12 | Frontend | — | — | being built concurrently, not part of round 2 (see Run 3) |

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
- **Task status (as of round 2):** backend T1–T7 are verified. Frontend T8–T12 were outside round 2. Task 02 is **not DONE** until the frontend is verified here and the reviewer approves. Superseded by Run 3 below.

Round-2 verdict (backend outcomes T1–T7, commit 4696675 + working tree):

Verdict: PASS

---

## Run 3 — whole task (2026-11-20, commit 2b1607e)
Verifier run: 2026-11-20 14:10–14:55 UTC, commit 2b1607e. Every transport path is identical to that commit: `git status --short` on `main/labyrinth_main/features/transport`, `main/tests/test_transport.py`, `artifacts/transport.json`, `contracts/transport.schema.json`, `renderer/src/features/transport`, `renderer/src/lib/liveStatus.ts` was empty at the start and at the end. Other agents' uncommitted edits elsewhere in the tree (`main/…/live_gx`, `scripts/`, other tasks' VERIFY.md) are not part of this run.

Scope: all twelve outcomes, T1–T12. T8–T12 had no external verification before this run.

**Where each thing ran**
- **Shared tree** `/mnt/d/Labyrinth`: `verify.sh renderer`, `check_boundaries.py`, `pytest main/tests/test_transport.py`, read-only git, my read-only Python probes.
- **Isolated copy** `~/.cache/labyrinth-probes/v02`, made by `scripts/probe-copy.sh v02` at 14:11 UTC. The transport frontend files and `lib/liveStatus.ts` had the same sha256 in the copy and in the shared tree. Ran there: `verify.sh all`, each T8–T12 test alone, my two probe test files, 35 mutations. The copy was restored after every mutation and deleted at the end.
- **Real browser**: headless Edge against the static build on `http://127.0.0.1:4173/#/transport` (no backend, so replay), and against the copy's build behind my own short-lived server that answered `/api/live/status` with a fake payload. Nothing was launched.

Commands ran from small `.sh` / `.py` / `.tsx` files in the scratch directory (D-020). The lines below are the commands those files executed and their output, ANSI colour codes removed.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| T1 | Traces from `compared/test5/{stella,GENE}/{t,Q}` of the pinned h5, units, tgrad 3 / ngrad 1 in provenance | `test_T1_traces_read_from_pinned_h5_with_units_and_gradients`, `test_T1_divergent_restart_is_refused_not_silently_dropped`: re-run, pass | Own h5py read with my own dedup: stella 1441 raw → 1433, GENE 1106, ends 2074.7 and 1893.765478748425. Equal to the artifact trace lengths. Source files byte-identical to round 2 | PASS |
| T2 | Edge-interpolated means reproduce 2.242 and 2.474 | `test_T2_time_weighted_means_reproduce_fixtures`, `test_T2_window_mean_equals_analytic_integral_for_piecewise_linear_Q`: pass | Own segment-clipping integrator on the h5: 2.2421269 and 2.4738618. Largest difference from the artifact over the six covered windows: 4.7e-07 (the artifact keeps 7 significant figures) | PASS |
| T3 | Coverage, mean, stderr, stationarity, claim gate per window | four `test_T3_*`: pass | Artifact: 7 rows, every `stationary` is `null`, every `saturatedClaimAllowed` is `false`. GENE 1500–1900 is `covered: false` with mean `null`; my integrator refuses it too. The Monte-Carlo calibration was not repeated (round-2 evidence; code byte-identical) | PASS |
| T4 | Reduced Modal 5.79 on 300–400 against archive means; 2.55 and 2.68 fixtures | `test_T4_reduced_modal_run_against_archive_and_fixtures`: pass | Own means 2.554537 → "2.55" and 2.675066 → "2.68". `reducedModalRun.archive` equals the two window rows. 5.79 has `computed: null`, `matches: null` | PASS |
| T5 | `gx_to_archive` = (t·√2, Q/2√2); refuses unless references asserted identical | `test_T5_gx_to_archive_converts_and_refuses_without_identical_references`: pass | Recomputed on four inputs with t × 1.4142135623730951 and Q ÷ 2.8284271247461903: identical. Refuses `False`, `None`, `0`, `1`, `1.0`, `'no'`, `'True'`, `np.True_`, `[True]`; a missing keyword raises TypeError | PASS |
| T6 | `compare_window`: verdict, delta, combined uncertainty, "no claim" | three `test_T6_*`: pass | stella − GENE on 1500–1893.765 by my integrator: −0.2333, the delta round 2 recorded from `compare_window`. No new Monte-Carlo (code byte-identical) | PASS |
| T7 | Triangular 2.22 over 1200–1500, `rawTraceStatus: unverified`, no trace | `test_T7_triangular_published_mean_only`: pass | Artifact has two traces, both `tube: bean`. `triangular` is 2.22, [1200, 1500], `unverified`. Its fixture has `matches: null` | PASS |
| T8 | Plotly overlay of stella and GENE bean traces, shared axes with units, bands 200–300 / 300–400 / 1500–1900 | `T8 overlays stella and GENE bean traces…` in `renderer/src/features/transport/TransportView.test.tsx`. Real artifact through a stubbed `fetch`; only `plotly.js-dist-min` is mocked. Passes alone. 5 of 6 mutations red | Probe P9: axis titles `Time t (a/v<sub>th,i</sub>)` and `Ion heat flux Q<sub>i</sub> (Q<sub>gB,i</sub>)`; bands are artifact windows; plotted arrays equal the artifact arrays; six mean segments equal the artifact means. Real Plotly render in headless Edge shows both traces, the three bands and both unit labels. Plotly is a separate 4.65 MB chunk behind `import()` | PASS (m1, m2, m3) |
| T9 | Window table: mean ± stderr, coverage, stationarity, explicit claim allowed / not allowed per row | `T9 window table…`. Passes alone. 6 of 9 mutations red. A hard-coded "Claim not allowed" survives | P1, P1b, P2, P3, Q4 and the screenshot. `null` renders "Undecidable…", `true` "Stationary", `false` "Not stationary". Every archive row says "Claim not allowed" and the N_eff ≥ 20 callout is present. One flipped row becomes the only "Claim allowed". `stderr: null` → "—"; approximate → "≈0.019" with spoken "a lower bound". **But four `null` rows read "Undecidable (test indicates stationary; indicative only)"** | **FAIL** (B1, M1) |
| T10 | Discrepancy card: 5.79 vs archive values with delta; fixture rows claimed vs computed, ✓/✗ | `T10 discrepancy card…`. Passes alone. 3 of 6 mutations red | P5, P6 and the screenshot. 5.79 carries a "PRD-reported" pill, archive means "Derived"; Δ +3.24 and +3.11 (my integrator: +3.2355, +3.1149). `matches: false` → cross icon + "Mismatch"; `null` → "Not recomputable"; a flag that disagrees with the printed values is treated as a mismatch | PASS (M3, m4, m5) |
| T11 | Triangular card separate from the bean plot, labelled published mean, raw trace unverified | `T11 triangular card…`. Passes alone. 2 of 4 mutations red | P6 and the screenshot. Label "Published mean 2.22 over 1200–1500 — PRD-reported, raw trace unverified."; no chart in the card. A triangular trace added to an artifact copy is not drawn | PASS (m6) |
| T12 | GX samples overlay in archive units with a LIVE label only when the live API reports them; otherwise no GX series | `T12 GX samples overlay…`. Passes alone. 4 of 8 mutations red in this file, a fifth red only in `src/lib/lib.test.tsx` | P7: twelve API states. GX series and LIVE label only for `mode: "live"` with bean samples; x and y equal the delivered samples. P7b: live → fallback removes both. Real browser with a fake status: `live` shows "LIVE · GX BEAN" and the series at the delivered t and Q; `fallback` with the same samples shows neither. Q1: a hung API keeps LIVE (M4) | PASS (M2, M4, m7) |

### Real output

#### Gates
```
$ wsl.exe -e bash scripts/probe-copy.sh v02
/home/qqbot/.cache/labyrinth-probes/v02

$ cd ~/.cache/labyrinth-probes/v02 && bash scripts/verify.sh all      # isolated copy; start 2026-11-20T14:11:56Z, end 14:14:35Z
━━━ [boundary:self-test] $ python3 scripts/check_boundaries.py --self-test
boundary self-test: OK (37 violations caught, 8 clean files passed)
━━━ [boundary:scan] $ python3 scripts/check_boundaries.py
boundary: OK (142 files scanned)
━━━ [docs:handoff] $ python3 scripts/check_docs.py
docs: OK (10 task folders)
━━━ [scripts:tests] $ python3 -m pytest -q -p no:cacheprovider scripts/tests
19 passed in 0.98s
━━━ [main:lint] $ python3 -m ruff check main scripts
All checks passed!
━━━ [main:tests] $ python3 -m pytest -q main/tests
105 passed in 26.09s
━━━ [artifacts:schema] $ python3 scripts/validate_artifacts.py
artifacts: schema-valid
━━━ [artifacts:fresh] $ python3 scripts/validate_artifacts.py --check-fresh
artifacts: fresh (byte-identical rebuild)
━━━ [renderer:typecheck] $ npm --prefix renderer run -s typecheck
━━━ [renderer:tests] $ npm --prefix renderer run -s test
 Test Files  19 passed (19)
      Tests  582 passed (582)
━━━ [renderer:build] $ npm --prefix renderer run -s build
✓ built in 4.20s
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (1s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (26s)
  PASS  artifacts:schema (1s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (12s)
  PASS  renderer:tests (107s)
  PASS  renderer:build (11s)
verify.sh: all stages passed.
exit=0

$ wsl.exe -e bash scripts/dev.sh bash scripts/verify.sh renderer      # SHARED tree, head 2b1607e; start 14:43:51Z, end 14:48:14Z
boundary: OK (142 files scanned)
 Test Files  19 passed (19)
      Tests  582 passed (582)
✓ built in 2.48s
━━━ verify.sh summary (scope: renderer)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (43s)
  PASS  renderer:typecheck (19s)
  PASS  renderer:tests (197s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
exit=0

$ wsl.exe -e bash scripts/dev.sh python3 scripts/check_boundaries.py      # shared tree
boundary: OK (142 files scanned)
exit=0
```
`verify.sh all` was not run on the shared tree (`main/` is being edited by another agent). The maintainer runs it on the integrated tree.

#### Backend T1–T7: nothing changed since the verified run; tests re-run (shared tree)
```
### git log -- main/labyrinth_main/features/transport main/tests/test_transport.py artifacts/transport.json contracts/transport.schema.json
80888d4 2026-11-20T12:48:27+00:00 Backend data features: geometry, transport, forecast, budget, spatial (verified)
1cdc976 2026-11-19T21:53:01+00:00 Add shared pricing constants and GX unit conversion for parallel agents
ecf14d5 2026-11-19T21:52:18+00:00 Scaffold Labyrinth: process boundary, exit-2 verify loop, contracts, agents
### git status --short (transport backend paths)
(end status)
### git diff --stat 80888d4 HEAD (commit that added the verified backend -> HEAD)
(end diff)
### sha256 prefixes (round 2 recorded: archive addb68f339ebbe8f artifact 8c5bdc3aed1e3a16 compare dcb3257d7ccae3f8 stats ce015b1da2f5cb83 units 083642e38a018a59 test 13da87580fc18d96 transport.json ae594c701e542a5a)
addb68f339ebbe8f  main/labyrinth_main/features/transport/archive.py  crlf=0
8c5bdc3aed1e3a16  main/labyrinth_main/features/transport/artifact.py  crlf=0
dcb3257d7ccae3f8  main/labyrinth_main/features/transport/compare.py  crlf=0
ce015b1da2f5cb83  main/labyrinth_main/features/transport/stats.py  crlf=0
083642e38a018a59  main/labyrinth_main/features/transport/units.py  crlf=0
13da87580fc18d96  main/tests/test_transport.py  crlf=0
ae594c701e542a5a  artifacts/transport.json  crlf=0

$ python3 -m pytest -v -p no:cacheprovider main/tests/test_transport.py
main/tests/test_transport.py::test_T1_traces_read_from_pinned_h5_with_units_and_gradients PASSED [  7%]
main/tests/test_transport.py::test_T1_divergent_restart_is_refused_not_silently_dropped PASSED [ 14%]
main/tests/test_transport.py::test_T2_time_weighted_means_reproduce_fixtures PASSED [ 21%]
main/tests/test_transport.py::test_T2_window_mean_equals_analytic_integral_for_piecewise_linear_Q PASSED [ 28%]
main/tests/test_transport.py::test_T3_window_stats_coverage_stderr_stationarity_and_claim_gate PASSED [ 35%]
main/tests/test_transport.py::test_T3_edge_hole_window_not_covered PASSED [ 42%]
main/tests/test_transport.py::test_T3_claim_gate_and_stderr_calibration_monte_carlo PASSED [ 50%]
main/tests/test_transport.py::test_T3_stationarity_false_rejection_rate_at_small_n PASSED [ 57%]
main/tests/test_transport.py::test_T4_reduced_modal_run_against_archive_and_fixtures PASSED [ 64%]
main/tests/test_transport.py::test_T5_gx_to_archive_converts_and_refuses_without_identical_references PASSED [ 71%]
main/tests/test_transport.py::test_T6_compare_window_tost_verdicts_and_no_claim PASSED [ 78%]
main/tests/test_transport.py::test_T6_compare_window_dedups_repeats_and_refuses_divergent PASSED [ 85%]
main/tests/test_transport.py::test_T6_null_false_disagree_rate_near_nominal PASSED [ 92%]
main/tests/test_transport.py::test_T7_triangular_published_mean_only PASSED [100%]
============================== 14 passed in 6.82s ==============================
exit=0
```

#### Backend probes (own code, read-only: `backend_probe.py`)
```
== probe 1: window means, own integrator vs artifact ==
stella: raw n=1441 dedup n=1433 t0=0.0 tend=np.float64(2074.7)
GENE: raw n=1106 dedup n=1106 t0=0.0 tend=np.float64(1893.765478748425)
stella 200-300: mine=2.7155180 artifact=2.7155180 |d|=7.1e-09
stella 300-400: mine=2.5545375 artifact=2.5545370 |d|=4.7e-07
stella 1500-1900: mine=2.2421269 artifact=2.2421270 |d|=8.2e-08
GENE   200-300: mine=2.9260284 artifact=2.9260280 |d|=4.1e-07
GENE   300-400: mine=2.6750657 artifact=2.6750660 |d|=3.0e-07
GENE   1500-1900: mine=None artifact=None covered=False
GENE   1500-1893.77: mine=2.4738618 artifact=2.4738620 |d|=2.1e-07
max |mine - artifact| = 4.74e-07  (artifact keeps 7 significant figures)
fixture stella-bean-1500-1900: PRD 2.242  mine 2.242127 -> prints 2.242  same=True  artifact matches=True
fixture gene-bean-1500-1893.765: PRD 2.474  mine 2.473862 -> prints 2.474  same=True  artifact matches=True
fixture stella-bean-300-400: PRD 2.55  mine 2.554537 -> prints 2.55  same=True  artifact matches=True
fixture gene-bean-300-400: PRD 2.68  mine 2.675066 -> prints 2.68  same=True  artifact matches=True
stella - GENE on 1500-1893.765 (same window): -0.2333
GENE(1500-1893.765) - stella(1500-1900) (what the UI callout prints): +0.2317
reduced Modal 5.79 - stella 300-400 = +3.2355; - GENE 300-400 = +3.1149
ratios: 2.2666x stella, 2.1644x GENE

== probe 2: GX -> archive conversion ==
t: [0.0, 1.4142135623730951, 10.606601717798213, 141.4213562373095] expected [0.0, 1.4142135623730951, 10.606601717798213, 141.4213562373095]
Q: [0.0, 0.35355339059327373, 1.0, 5.65685424949238] expected [0.0, 0.35355339059327373, 1.0, 5.65685424949238]
identical_references: [('False', 'refused'), ('None', 'refused'), ('0', 'refused'), ('1', 'refused'), ('1.0', 'refused'), ("'no'", 'refused'), ("'True'", 'refused'), ('np.True_', 'refused'), ('[True]', 'refused')]
missing keyword -> TypeError: gx_to_archive() missing 1 required keyword-only argument: 'identical_r
artifact unitConversion: 1.414214 2.828427 | sqrt2 to 7 s.f.: 1.414214 2*sqrt2 to 7 s.f.: 2.828427
probe OK
```

#### Frontend: each named test alone (isolated copy)
```
$ npm --prefix renderer run -s test -- src/features/transport/TransportView.test.tsx -t 'T8 ' --reporter=verbose
 ✓ src/features/transport/TransportView.test.tsx > T8 overlays stella and GENE bean traces on shared, unit-labelled axes with the three window bands 261ms
      Tests  1 passed | 4 skipped (5)
exit=0
$ npm --prefix renderer run -s test -- src/features/transport/TransportView.test.tsx -t 'T9 ' --reporter=verbose
 ✓ src/features/transport/TransportView.test.tsx > T9 window table shows mean, stderr (— / ≈), coverage, stationarity and an explicit claim verdict per row 288ms
      Tests  1 passed | 4 skipped (5)
exit=0
$ npm --prefix renderer run -s test -- src/features/transport/TransportView.test.tsx -t 'T10 ' --reporter=verbose
 ✓ src/features/transport/TransportView.test.tsx > T10 discrepancy card: PRD-reported 5.79 vs archive 300–400 means with deltas; fixture rows with ✓/✗ 263ms
      Tests  1 passed | 4 skipped (5)
exit=0
$ npm --prefix renderer run -s test -- src/features/transport/TransportView.test.tsx -t 'T11 ' --reporter=verbose
 ✓ src/features/transport/TransportView.test.tsx > T11 triangular card is separate from the bean plot: published mean 2.22, PRD-reported, raw trace unverified 246ms
      Tests  1 passed | 4 skipped (5)
exit=0
$ npm --prefix renderer run -s test -- src/features/transport/TransportView.test.tsx -t 'T12 ' --reporter=verbose
 ✓ src/features/transport/TransportView.test.tsx > T12 GX samples overlay in archive units with a LIVE label only when the API reports live 275ms
      Tests  1 passed | 4 skipped (5)
exit=0
```
The test file reads the committed `artifacts/transport.json` from disk and serves it through a stubbed `fetch`. It renders the real `TransportView`, `model.ts` and design components. Only `plotly.js-dist-min` is replaced by a recorder, because jsdom has no canvas. The expectations are literals (1433, 1106, "2.242", "≈0.019", "+3.24", "+3.11", the band list, the axis titles), not values read back from the implementation. None of the five tests is tautological. Their gaps are in the mutation table and in the findings.

#### Frontend probes (own test files `zzprobe.test.tsx`, `zzprobe2.test.tsx`; real view and model, modified artifact copies; isolated copy)
```
$ PROBE_OUT=probe_fe.log npm --prefix renderer run -s test -- src/features/transport/zzprobe.test.tsx --reporter=verbose
 ✓ P1 stationary null / true / false render distinctly (model) 16ms
 × P1b STRICT: on the committed artifact no null-verdict row contains the word "stationary" at all 246ms
   → expected [ …(4) ] to deeply equal []
 ✓ P2 claim verdict is data-driven per row; N_eff explanation present 202ms
 ✓ P3 stderr null -> em dash; approximate -> marked as lower bound; plain when not approximate 79ms
 ✓ P4 stella and GENE are never presented as agreeing 68ms
 ✓ P5 fixtures: outcome comes from `matches` (false -> Mismatch + cross, null -> Not recomputable) 72ms
 ✓ P6 reduced Modal card is PRD-reported and data-driven; triangular card separate, no triangular trace 60ms
 ✓ P7 T12 matrix: GX series + LIVE label only for mode "live" with bean samples 979ms
 ✓ P7b a LIVE series disappears when the next poll reports fallback 148ms
 ✓ P7c model: liveGxSamples is null for every non-live state 3ms
 × P8 an artifact trace with code GX / provenance kind "live" must not produce a live indicator in replay 87ms
   → expected [ 'Live' ] to deeply equal []
 ✓ P9 plot: units on both axes, window bands vs artifact windows, mean segments 13ms
      Tests  2 failed | 10 passed (12)
exit=1
```
The two red probes are strict checks I wrote on purpose. They are findings B1 and m11.

What the probes printed (`probe_fe.log`, shortened only where marked `…`):
```
P1 stationary=null artifact-detail -> "Undecidable (test indicates stationary; indicative only)"
P1 stationary=null clean-detail -> "Undecidable"
P1 stationary=true artifact-detail -> "Stationary (indicative)"
P1 stationary=true clean-detail -> "Stationary"
P1 stationary=false artifact-detail -> "Not stationary (indicative)"
P1 stationary=false clean-detail -> "Not stationary"
P1b row stella 200–300 | stationarity cell: "Undecidable" | artifact stationary = null
P1b row stella 300–400 | stationarity cell: "Undecidable" | artifact stationary = null
P1b row stella 1500–1900 | stationarity cell: "Undecidable (test indicates stationary; indicative only)" | artifact stationary = null
P1b row GENE 200–300 | stationarity cell: "Undecidable (test indicates stationary; indicative only)" | artifact stationary = null
P1b row GENE 300–400 | stationarity cell: "Undecidable (test indicates stationary; indicative only)" | artifact stationary = null
P1b row GENE 1500–1900 | stationarity cell: "Not covered" | artifact stationary = null
P1b row GENE 1500–1893.765 | stationarity cell: "Undecidable (test indicates stationary; indicative only)" | artifact stationary = null
P2a callout: Warning: Saturated agreement claim: not allowed for any archive windowA claim needs a covered, stationary window with finite sampling uncertainty and at least 20 effective samples (Neff ≥ 20, D-017). The archive's autocorrelation time leaves every window below that (reported Neff ≈ 5.9–14.1), so means are reported but agreement is not claimed. "≈" marks a small-sample stderr that is a lower bound; "—" means the stderr is not finite.
P2b ["stella 200–300 -> Claim not allowed","stella 300–400 -> Claim not allowed","stella 1500–1900 -> Claim not allowed","GENE 200–300 -> Claim not allowed","GENE 300–400 -> Claim not allowed","GENE 1500–1900 -> Claim not allowed","GENE 1500–1893.765 -> Claim allowed"]
P2b callout: Note: Saturated agreement claim allowed for 1 of 7 windowsOnly rows marked "Claim allowed" meet the covered, stationary, finite-uncertainty, Neff ≥ 20 gate.
P3 stella 200–300 | artifact stderr null | cell "—" | aria-label "stderr not finite"
P3 stella 300–400 | artifact stderr null | cell "—" | aria-label "stderr not finite"
P3 stella 1500–1900 | artifact stderr 0.01922 | cell "≈0.019" | aria-label "stderr approximately 0.019, a lower bound"
P3 GENE 200–300 | artifact stderr 0.01 | cell "0.010" | aria-label "stderr 0.010"          <- row I edited: finite stderr, no APPROXIMATE flag
P3 GENE 300–400 | artifact stderr 0.02076 | cell "≈0.021" | aria-label "stderr approximately 0.021, a lower bound"
P3 GENE 1500–1900 | artifact stderr null | cell "—" | aria-label "stderr not finite"
P3 GENE 1500–1893.765 | artifact stderr 0.01657 | cell "≈0.017" | aria-label "stderr approximately 0.017, a lower bound"
P4 callout: Note: stella and GENE are not shown to agree with each otherLate-window means differ by +0.23 QgB,i (GENE 1500–1893.765: 2.474; stella 1500–1900: 2.242; the windows are not identical). No equivalence claim is made between them; read them as two independent references.
P5 "stella bean mean, 1500–1900: Mismatch. Claimed 2.242 Q gB,i, computed 2.242 Q gB,i, difference 0.000. The match flag disagrees with the printed values" | outcome mismatch | icon cross | text Mismatch      <- matches set to false
P5 "GENE bean mean, 1500–1893.765: Mismatch. Claimed 2.474 Q gB,i, computed 2.480 Q gB,i, difference +0.006. The match flag disagrees with the printed val…" | outcome mismatch | icon cross | text Mismatch      <- computed changed, flag left true
P5 "stella archive mean, 300–400: Not recomputable. Claimed 2.55 Q gB,i, computed 2.55 Q gB,i, difference 0.00" | outcome unknown | icon dash | text Not recomputable      <- matches set to null
P5 "GENE archive mean, 300–400: Mismatch. Claimed 2.68 Q gB,i, computed 2.67 Q gB,i, difference minus 0.01" | outcome mismatch | icon cross | text Mismatch      <- sample-span value 2.67429, matches false
P5 "Reduced Modal stella run mean, 300–400: Not recomputable. Claimed 5.79 Q gB,i, computed value not available" | outcome unknown | icon dash | text Not recomputable
P5 "Triangular published mean, 1200–1500: Not recomputable. Claimed 2.22 Q gB,i, computed value not available" | outcome unknown | icon dash | text Not recomputable
P6 stats: ["Reduced Modal stella run: 5.79 Q gB,i, window t 300 to 400 a/v th,i","stella archive mean: 3.00 Q gB,i, window t 300 to 400 a/v th,i","GENE archive mean: 2.68 plus or minus 0.02 Q gB,i, window t 300 to 400 a/v th,i"]      <- archive.stella set to 3.0: delta follows (+2.79)
P6 triangular card: Triangular tubeTriangular tube: published mean onlyShown separately from the bean plot. No triangular trace is drawn.PRD-reportedRaw trace unverifiedTriangular published mean2.22QgB,iPRD-reportedt 1200–1500 a/vth,iPublished mean 2.22 over 1200–1500 — PRD-reported, raw trace unverified.Source: PRD.md · Accuracy fixtures — …
P6 plot trace names with a triangular trace present in the artifact: ["stella ±1σ","GENE ±1σ","GENE ±1σ","GENE ±1σ","stella (archive, bean)","GENE (archive, bean)"]
P7 unreachable (HTTP 502)                               | GX traces 0 | LIVE texts [] | live pills 0
P7 fetch rejects                                        | GX traces 0 | LIVE texts [] | live pills 0
P7 bad payload (schemaVersion 2, mode live, samples)    | GX traces 0 | LIVE texts [] | live pills 0
P7 unavailable + samples                                | GX traces 0 | LIVE texts [] | live pills 0
P7 idle + samples                                       | GX traces 0 | LIVE texts [] | live pills 0
P7 launching + samples                                  | GX traces 0 | LIVE texts [] | live pills 0
P7 fallback + samples                                   | GX traces 0 | LIVE texts [] | live pills 0
P7 terminated + samples                                 | GX traces 0 | LIVE texts [] | live pills 0
P7 mode "LIVE" (wrong case) + samples                   | GX traces 0 | LIVE texts [] | live pills 0
P7 live + no samples                                    | GX traces 0 | LIVE texts [] | live pills 0
P7 live + only triangular samples                       | GX traces 0 | LIVE texts [] | live pills 0
P7 live + bean samples                                  | GX traces 1 | LIVE texts ["LIVE · GX bean"] | live pills 1 | aria true | summary tail "ve bean samples overlaid in archive units: 3 samples up to t = 144.25."
P7b after fallback: trace names ["stella ±1σ","GENE ±1σ","GENE ±1σ","GENE ±1σ","stella (archive, bean)","GENE (archive, bean)"] | LIVE texts 0
P7c {"connecting":null,"unreachable":null,"unavailable":null,"idle":null,"launching":null,"fallback":null,"terminated":null,"live":[{"t":1,"Q":1}]}
P8 trace names ["stella ±1σ","GENE ±1σ","GENE ±1σ","GENE ±1σ","stella (archive, bean)","GENE (archive, bean)"] | live-styled pills ["Live"] | badge buttons ["Provenance of stella bean trace: Archive, Verified","Provenance of GENE bean trace: Archive, Verified","Provenance of GX bean trace: Live, Verified","Provenance of reduced Modal stella run: PRD-reported, Blocked"]
P9 x title {"text":"Time t (a/v<sub>th,i</sub>)"} | y title {"text":"Ion heat flux Q<sub>i</sub> (Q<sub>gB,i</sub>)"} | x range [0,2100]
P9 bands [[200,300],[300,400],[1500,1900]] | artifact windows (unique) [[200,300],[300,400],[1500,1900],[1500,1893.765]]
P9 mean segments ["stella mean 200-300 @ 2.715518","stella mean 300-400 @ 2.554537","stella mean 1500-1900 @ 2.242127","GENE mean 200-300 @ 2.926028","GENE mean 300-400 @ 2.675066","GENE mean 1500-1893.765 @ 2.473862"]
P9 traces ["stella ±1σ [4] band","GENE ±1σ [4] band","GENE ±1σ [4] band","GENE ±1σ [4] band","stella (archive, bean) [1433]","GENE (archive, bean) [1106]"]
P9 bands after moving the artifact window 200-300 to 250-350: [[200,300],[300,400],[1500,1900]] (unchanged => bands are hard-coded, not read from windows[])
```
In P7 the live case also asserts `x` and `y` of the GX trace equal the delivered `t` and `Q` exactly (141.4213562, 2.05, …), so there is no second √2 or 2√2. The backend converts once (`main/labyrinth_main/features/live_gx/orchestrator.py:189`, outside this task).
```
$ PROBE_OUT=probe2_fe.log npm --prefix renderer run -s test -- src/features/transport/zzprobe2.test.tsx --reporter=verbose
 ✓ Q1 live, then the API hangs (requests never answer): is LIVE still shown? 515ms
 ✓ Q2 live, then the API becomes unreachable (HTTP 502): LIVE must go 226ms
 ✓ Q3 source links rendered by the transport view 55ms
 ✓ Q4 inconsistent artifact row (claim allowed but stationary null / stderr null): what is shown? 47ms
      Tests  4 passed (4)
exit=0
Q1 after 400 ms (16 unanswered polls at 25 ms): LIVE labels 1 | GX series true | status requests issued 17
Q2 after 502: LIVE labels 0 | GX series false
Q3 triangular source href PRD.md
Q4 row ["stella","300–400","Covered · 68 samples","2.555","—","—","Undecidable","Claim allowedDetail for stella 300–400Half-split test: mean["]
```
Q1 and Q4 only record behaviour; they assert no direction.

#### Mutations (isolated copy; implementation mutated, `TransportView.test.tsx` run after each; `lib.test.tsx` or `components.test.tsx` added where the mutated code lives there)
35 mutations: 21 red, 14 survived. Every red is an assertion failure, not a timeout. The lines are my runner's summary lines; the test title after `red:` is shortened to its outcome number and the notes in brackets are mine.
```
=== T8a_x_axis_without_unit: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T8
=== T8b_band_1500_1800: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T8
=== T8c_drop_GENE_trace: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T8
=== T8d_GENE_on_secondary_axis: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T8
=== T8e_plotted_Q_doubled: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T8f_y_axis_wrong_unit: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T8
=== T9a_null_renders_Stationary: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T9      (expected 'Stationary' to match /^Undecidable/)
=== T9b_claim_hardcoded_not_allowed: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T9c_claim_hardcoded_allowed: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T9
=== T9d_null_stderr_prints_zero: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T9
=== T9e_approx_mark_dropped: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T9
=== T9f_lower_bound_wording_dropped: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T9g_neff_explanation_dropped: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T9
=== T9h_uncovered_shown_as_covered: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T9
=== T9i_indicative_true_as_plain_Stationary: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T10a_delta_sign_flipped: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T10
=== T10b_579_labelled_Derived: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T10c_fixture_ignores_matches_flag: exit=0 SURVIVED (all green) | Tests 39 passed (39) | TransportView.test.tsx components.test.tsx
=== T10d_reported_fixtures_hidden: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T10
=== T10e_delta_vs_late_means: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T10
=== T10f_stella_stderr_shown_as_zero: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T11a_unverified_wording_dropped: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T11
=== T11b_triangular_mean_segment_on_bean_plot: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T11c_triangular_trace_on_bean_plot: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T11
=== T11d_any_tube_drawn: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T12a_mode_ignored: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T12      (idle + samples drew 'GX · LIVE (archive units)')
=== T12b_double_conversion: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T12      (expected … to match object { x: [ 100, 101.4 ], y: [ 2.1, 2.3 ] })
=== T12c_LIVE_pill_always: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T12
=== T12d_LIVE_pill_never: exit=1 RED | Tests 1 failed | 4 passed (5) | red: T12
=== T12e_fallback_drawn_as_live: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T12f_isLive_true_unless_idle: exit=1 RED | Tests 1 failed | 8 passed (9) | TransportView.test.tsx lib.test.tsx | red: live status: unreachable backend is not live; only mode=live      (T12 itself stayed green)
=== T12g_series_not_named_live: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== T12h_triangular_worker_plotted: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== S5_callout_claims_agreement: exit=0 SURVIVED (all green) | Tests 5 passed (5)
=== LZ_plotly_static_import: exit=0 SURVIVED (all green) | Tests 5 passed (5)
### restored copy to pristine: dirty=0
```
What each survivor changed:
- `T8e`: `model.ts` `traceLine` plots `trace.Q.map((v) => v * 2)`.
- `T9b`: `model.ts:140-141` returns `claimAllowed: false, claimText: 'Claim not allowed'` for every row.
- `T9f`: "a lower bound" removed from the spoken stderr and from the callout.
- `T9i`: `model.ts:109` returns plain "Stationary" for a `true` verdict whose detail says indicative.
- `T10b`: the 5.79 `Stat` in `TransportView.tsx:227` gets `StatusPill status="derived"`.
- `T10c`: `FixtureCheck.tsx:16` becomes `if (same)`, ignoring `matches`.
- `T10f`: `TransportView.tsx:237` passes `uncertainty={r.window?.stderr ?? 0}`, so stella reads "2.55 ±0.00".
- `T11b`: `meanSegment(a.triangular.window, a.triangular.publishedMean, 'triangular', theme)` pushed onto the bean plot's shapes.
- `T11d`: the `t.tube === 'bean'` filter removed at `model.ts:254`.
- `T12e`: `model.ts:226` also accepts `mode === 'fallback'`, so fallback samples get the GX series and the LIVE pill.
- `T12g`: `GX_LIVE_NAME = 'GX'`.
- `T12h`: `model.ts:227` picks `workers.find((w) => w.samples.length > 0)`, any tube.
- `S5`: callout title "stella and GENE agree with each other", body "They are equivalent."
- `LZ`: `PlotlyChart.tsx` imports `plotly.js-dist-min` statically.

S5 and LZ were first run at 14:49 UTC and failed to start (`vitest: not found`, `Cannot find dependency 'jsdom'`): the shared `renderer/node_modules`, which the copy links to, was briefly being reinstalled by another agent. Both were repeated once it was back; the lines above are the repeats.

#### Plotly lazy loading
```
### dist: /home/qqbot/.cache/labyrinth-probes/v02/renderer/dist      (built by verify.sh all in the copy; same chunk names as the build served on :4173)
10528 Gallery-FHFM4YrV.js
3795 Gallery-HuXzu4Bj.css
61442 index-2hdb9thG.css
344213 index-D6civ2KJ.js
4651969 plotly.min-CDaxrom7.js
599 rolldown-runtime-WkwZ5CU-.js
742801 three.module-CeVBJVoU.js
### index.html script/link tags
<script type="module" crossorigin src="/assets/index-D6civ2KJ.js">
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-WkwZ5CU-.js">
<link rel="stylesheet" crossorigin href="/assets/index-2hdb9thG.css">
static imports at the top of the main chunk:
import{n as e,t}from"./rolldown-runtime-WkwZ5CU-.js";
dynamic import sites in the main chunk that mention plotly:
n=!1,clearInterval(a)}},[e,t]),n}var Xt=null;function P(){Xt??=Nt(()=>import(`./plotly.min-CDaxrom7.js`).then(t=>e(t.default,1)).then(e=>e.default??e),__vite__map
modulepreload of plotly in index.html: 0

### LZ: static import of plotly.js-dist-min in PlotlyChart.tsx, then the three renderer gate stages
$ npm --prefix renderer run -s typecheck
exit=0
$ npm --prefix renderer run -s build
exit=0
dist/assets/Gallery-gZOsarib.js          10.46 kB │ gzip:     4.40 kB
dist/assets/three.module-CeVBJVoU.js    742.80 kB │ gzip:   187.70 kB
dist/assets/index-CTEZZAWT.js         4,997.30 kB │ gzip: 1,531.54 kB
```
Import site: `renderer/src/features/transport/PlotlyChart.tsx:17`, `import('plotly.js-dist-min')` inside `loadPlotly()`. Plotly is lazy today. No gate would notice if it stopped being lazy (m3).

#### Real browser (headless Edge, real Plotly)
- `http://127.0.0.1:4173/#/transport`, 1440 × 3500. `/api/live/status` answers 502 there, so the app is in replay. The header shows "Replay · $0". The plot draws stella (solid) and GENE (dashed) to t ≈ 2075 and 1894, with shaded bands labelled 200–300, 300–400 and 1500–1900, x title "Time t (a/v_th,i)" and y title "Ion heat flux Q_i (Q_gB,i)". No GX series, no LIVE label. The table, the discrepancy card, the triangular card and the six fixture rows match the probe output above: four "Match", two "Not recomputable".
- Fake status `mode: "live"` with 40 bean samples (t 400–985, Q 3.6–4.4, already in archive units): the panel shows a solid "LIVE · GX BEAN" pill, the legend gains "GX · LIVE (archive units)", and the series runs from t = 400 to 985 at Q ≈ 4. That is where the samples were delivered; a second conversion would have put it at t ≈ 566–1393, Q ≈ 1.4.
- Same samples with `mode: "fallback"`: no LIVE pill in the panel and no GX series.
```
live: status 200 body[0..70]={"schemaVersion": 1, "mode": "live", "reason": "verifier probe (fake s
131182 bytes written to file …\scratchpad\v02\t12_live.png
fallback: status 200 body[0..70]={"schemaVersion": 1, "mode": "fallback", "reason": "verifier probe (fa
123155 bytes written to file …\scratchpad\v02\t12_fallback.png
```

#### End state
```
2026-11-20T14:54:10Z
### git status --short -- <every transport path>
(end)
### sha256 prefixes, shared tree
1626d40ca33f87f0  renderer/src/features/transport/TransportView.tsx
b0debf7dcd8f854f  renderer/src/features/transport/model.ts
f2ad993837ea064b  renderer/src/features/transport/PlotlyChart.tsx
4f54edf882f89efc  renderer/src/features/transport/types.ts
067ca70c238f8fc1  renderer/src/features/transport/TransportView.test.tsx
da90e187deb42c6f  renderer/src/lib/liveStatus.ts
ae594c701e542a5a  artifacts/transport.json
probe copy removed
```

### Findings

**Honesty check.** All four archive PRD means reproduce at printed precision, by my own integrator as well as by the artifact (2.242, 2.474, 2.55, 2.68). 5.79 and 2.22 are shown as PRD-reported and "Not recomputable". No PRD number in this task fails to reproduce, so there is no mismatch to hide; P5 shows that a mismatch would be displayed with a cross and the word "Mismatch". The definition sensitivity of 2.68 (sample-span 2.67429 → 2.67) is printed in the fixture note. stella and GENE are never presented as agreeing.

**Blocker**
- **B1 (T9).** `renderer/src/features/transport/model.ts:106` (regex at `:61`, rendered at `TransportView.tsx:188`). When `stationary` is `null` and the backend detail contains "test result 'stationary' is indicative only", the Stationarity cell reads **"Undecidable (test indicates stationary; indicative only)"**. That is four of the seven archive rows: stella 1500–1900, GENE 200–300, GENE 300–400, GENE 1500–1893.765.
  - `interface.md:54` says: show "undecidable", not "stationary". Round-2 finding N3 in this file says the frontend should display only "undecidable", never the indicative word, and names GENE 200–300 as the reason: it is a transient (half means 2.985 vs 2.867) that `main/tests/test_transport.py:151-152` forbids shipping as stationary. D-017 serialises indicative verdicts as `null` so that they are not read as verdicts.
  - The verdict word is right ("Undecidable") and no claim follows from it: every row says "Claim not allowed … not shown stationary". The defect is the parenthesis, which puts the suppressed indicative result back into the verdict column.
  - The T9 test allows it: `TransportView.test.tsx:106-108` asserts only `^Undecidable` and then requires the word "indicative".
  - Fix: return plain `'Undecidable'` at `model.ts:106` (the backend's own sentence stays available in the collapsed Detail), and make T9 assert the exact cell text for `null` rows.

**Major**
- **M1 (T9 test).** `TransportView.test.tsx:98` and `:127` only ever see "Claim not allowed". A hard-coded `'Claim not allowed'` at `model.ts:140-141` passes (mutation T9b). The `true` and `false` stationarity branches (`model.ts:108-109`) are never rendered by a test (T9i), and the `null` assertion sits behind `if` (`:107-108`). The implementation is data-driven (P2). Fix: one test with a synthetic row `stationary: true, saturatedClaimAllowed: true` and one with `false`, asserting exact cell texts and that only that row says "Claim allowed". The reviewer named the same gap (status.md §4a, "T9 only one direction").
- **M2 (T12 test).** `TransportView.test.tsx:165-173` covers a single not-live case, `idle`. Drawing `fallback` samples with the LIVE pill passes every test (T12e); so does plotting any worker's samples as the bean series (T12h; the fixture at `:28` gives the triangular worker none). The implementation is correct for all twelve states I tried (P7). Fix: parametrise the negative case over unavailable, idle, launching, fallback, terminated and an unreachable API, each with samples present, and add live with triangular-only samples.
- **M3 (T10 test).** `TransportView.test.tsx:135` accepts "PRD-reported" anywhere in the card. Labelling the 5.79 figure "Derived" (`TransportView.tsx:227`) passes, because the header badge still says PRD-reported (T10b). This is the honesty rule "never present PRD-reported numbers as recomputed" with no test behind it. Fix: assert the pill inside the `Reduced Modal stella run: 5.79` group and that the group contains no "Derived".
- **M4 (T12 behaviour; reviewer finding FE-4, still open).** `renderer/src/lib/liveStatus.ts:43-59`, used at `TransportView.tsx:45`. After a live snapshot, if later status requests never answer, the "LIVE · GX bean" pill and the GX series stay on the frozen samples indefinitely (Q1: 17 requests issued, none answered, label still shown). An HTTP error or a rejected fetch clears them at the next poll (Q2, P7). Fix: abort each request after less than one poll interval and treat that as unreachable.
- **M5 (interface.md §2 item 5, no test).** `TransportView.tsx:107-116`. No test reads the "stella and GENE are not shown to agree with each other" callout. Rewriting it to "stella and GENE agree with each other … They are equivalent." passes every test (S5). Fix: assert the callout title, "No equivalence claim" and the 0.23 difference.

**Minor**
- **m1 (T8 test).** `TransportView.test.tsx:66-70` checks sample counts only; plotting 2 × Q passes (T8e). Fix: assert the plotted `x` and `y` equal the artifact arrays (P9 does).
- **m2 (T8).** The bands are a constant, `model.ts:25-29`, and the chart's accessible name hard-codes the same windows, `TransportView.tsx:104`. They are not read from `windows[]`: moving an artifact window leaves the bands where they were (P9). Today they equal the artifact's 200–300, 300–400 and 1500–1900, which is what TASK.md asks for.
- **m3 (T8).** Nothing guards lazy loading. A static Plotly import passes typecheck, all tests and the build, and yields a 4,997 kB entry chunk (LZ). `renderer/vite.config.ts:54` sets the chunk warning limit to 5000 kB. Fix: a build test that requires a separate plotly chunk or caps the entry chunk.
- **m4 (T10 test).** `TransportView.test.tsx:136` is a prefix match, so "stella archive mean: 2.55 plus or minus 0.00" passes (T10f). Round-2 N5 asked that the null stella stderr never be shown as ±0. The implementation is right: no ± and the note "sampling uncertainty not finite".
- **m5 (T10).** No test pins that the tick or cross follows `matches` when the printed values agree: `renderer/src/design/components/FixtureCheck.tsx:16` reduced to `if (same)` passes the transport and the component tests (T10c). The implementation is right (P5).
- **m6 (T11 test).** `TransportView.test.tsx:159-161` checks trace names only. Drawing the triangular 2.22 as a segment on the bean plot (T11b) or dropping the tube filter at `model.ts:254` (T11d) passes. Fix: assert that no shape or trace covers 1200–1500, and feed an artifact copy that contains a triangular trace (P6 does).
- **m7 (T12 test).** `TransportView.test.tsx:5,171,180` import `GX_LIVE_NAME` from the implementation, so the legend entry can lose the word LIVE unnoticed (T12g). Fix: compare with a literal.
- **m8 (T9).** `TransportView.tsx:145-146`: the key for "≈" (lower bound) and "—" (not finite) exists only in the callout shown when no claim is allowed. As soon as one row allows a claim the callout at `:149-151` replaces it and the table shows "≈" and "—" with no visible key (P2b). The words "lower bound" are also unpinned by tests (T9f).
- **m9 (T8/T9).** `model.ts:262-264` draws ±1σ bands on the plot from stderr values that the backend flags approximate (lower bounds). The bands are named "… ±1σ" (`renderer/src/design/plotTheme.ts:222`) with no qualifier and are absent from the legend and from the text summary.
- **m10 (interface.md §2 item 5).** `model.ts:176-185`, `TransportView.tsx:109-112`. The callout prints "+0.23" = GENE(1500–1893.765) − stella(1500–1900), on two different windows, without saying which minus which. interface.md gives Δ ≈ −0.23 as stella − GENE on 1500–1893.765 (my integrator: −0.2333; the callout's own quantity: +0.2317). The callout does say the windows differ. Fix: compare on the common window and state the sign convention.
- **m11 (latent, LIVE rule).** `TransportView.tsx:74,88-90` renders a provenance badge for every bean trace in the artifact, including a `code: "GX"` trace that the figure does not draw (`model.ts:254`). If such a trace carries `provenance.kind: "live"` (schema-valid), `renderer/src/design/components/ProvenanceBadge.tsx:74` shows a solid "Live" pill with the API unreachable (P8). Today's artifact has no such trace. Fix: use the figure's filter for the badges, and never use the live pill for artifact provenance.
- **m12 (defensive).** `model.ts:140-142` trusts `saturatedClaimAllowed` alone. An inconsistent row (allowed `true`, `stationary: null`, `stderr: null`) reads "Claim allowed" beside "Undecidable" and "—" (Q4). The backend test T3 guarantees consistency today.
- **m13 (reviewer finding FE-9, confirmed).** `TransportView.tsx:281` and the reduced-run provenance source render `href="PRD.md"`. On the static build `GET /PRD.md` returns the app shell (200, text/html).
- **Carried from round 2, backend unchanged:** N1 (bias correction unpinned), N2 (gate can open near true N_eff ≈ 10; no archive window affected), N4 ("disagree" semantics), F2, F3. N3 is now B1. N5 is implemented correctly but unpinned (m4).

**Outside task 02, noticed in passing**
- `renderer/src/shell/ModeIndicator.tsx:37` shows "Playing saved run" for `mode: "fallback"` even when `fallback.savedRunId` is `null` (my fake-fallback screenshot). interface.md §3 allows that wording only when a qualified saved run exists. Task 09.

**Not checked in this run**
- The Monte-Carlo calibration of the claim gate and of `compare_window` (round-2 evidence; the code is byte-identical).
- Dark theme and narrow viewports.
- A real GX run. No credentials were used; the live path was exercised with fake status payloads only.
- `verify.sh all` on the shared tree (see Gates).

**Why FAIL.** Both gates exit 0, T1–T8 and T10–T12 hold, and every one of the five frontend tests can fail. T9 does not hold as specified: four rows whose verdict is `null` display the word "stationary" as a test indication, against `interface.md:54` and round-2 N3, and the T9 test cannot tell a data-driven claim verdict from a hard-coded one. The fix is one line plus tests (B1, M1). M2–M5 should go in the same round.

Verdict: FAIL — T9: four null-stationarity rows render "Undecidable (test indicates stationary; indicative only)" where interface.md §2 item 4 and round-2 N3 require "undecidable" only, and the T9 test cannot detect a hard-coded claim verdict; T1–T8 and T10–T12 pass

---

## Run 4 — whole task
Verifier run: 2026-11-20, commit 3faed3a

Scope: all twelve outcomes, T1–T12, after the fix round for run 3. At the owner's request this run is short:
- `verify.sh all` was not rerun. The maintainer's run at 3faed3a is quoted below.
- The task's own tests ran once each.
- One read-only backend probe and one T6 probe.
- Two probe tests against the real view.
- Five mutations, aimed at run 3's blocker and at the mutants that survived run 3.

Tree state:
- At the start, `git status --short` showed only ` M status.md`. Nothing under the owned paths (`main/labyrinth_main/features/transport/`, `renderer/src/features/transport/`) had changed, and neither had `main/tests/test_transport.py` or `artifacts/transport.json`. The same was true at the end.
- `git diff --stat 2b1607e HEAD` on the transport paths: the backend, `test_transport.py` and `artifacts/transport.json` are unchanged since run 3. The frontend changed in `TransportView.tsx`, `TransportView.test.tsx`, `model.ts` and `transport.css`, plus a new `lazyLoad.test.ts`. The shared files `lib/liveStatus.ts`, `FixtureCheck.tsx` and `ProvenanceBadge.tsx` also changed.

Where each step ran:
- Shared tree (read-only): the tests and the Python probes.
- Isolated copy from `scripts/probe-copy.sh vt-02-transport`: the probe tests and the mutations. The copy was restored after each mutation and deleted at the end.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| T1 | Traces from `compared/test5/{stella,GENE}/{t,Q}` of the pinned h5, units, tgrad 3 / ngrad 1 in provenance | `test_T1_traces_read_from_pinned_h5_with_units_and_gradients`, `test_T1_divergent_restart_is_refused_not_silently_dropped`: pass | My own h5py read and dedup give stella 1441 raw → 1433 and GENE 1106, equal to the artifact trace lengths. Artifact units are `Q_i/Q_gB,i` and `t v_th,i/a`. Both trace provenances carry "tgrad=3, ngrad=1" | PASS |
| T2 | Edge-interpolated means reproduce 2.242 (stella 1500–1900) and 2.474 (GENE 1500–1893.765) | two `test_T2_*`: pass | My segment-clipping integrator gives 2.2421269 and 2.4738618. Over the six covered windows, the largest difference from the artifact is 4.7e-07 | PASS |
| T3 | Coverage, mean, autocorrelation-corrected stderr, stationarity, claim gate per window | four `test_T3_*`: pass | The artifact has 7 rows. Every `stationary` is null and every `saturatedClaimAllowed` is false. GENE 1500–1900 is `covered: false`, and my integrator refuses it too. The Monte-Carlo calibration was not repeated: the backend is byte-identical to round 2 and run 3, where it was done | PASS |
| T4 | Reduced Modal 5.79 on 300–400 against archive means; 2.55 / 2.68 fixtures; sample-span 2.674 note | `test_T4_reduced_modal_run_against_archive_and_fixtures`: pass | My means: 2.554537 → 2.55 and 2.675066 → 2.68. `reducedModalRun.archive` equals the window rows. 5.79 is `prd-reported` with computed null. Δ is +3.2355 against stella and +3.1149 against GENE | PASS |
| T5 | `gx_to_archive` = (t·√2, Q/(2√2)); raises unless identical references are asserted | `test_T5_gx_to_archive_converts_and_refuses_without_identical_references`: pass | Exact on four inputs. It raises ValueError for False, None, 0, 1, 1.0, 'no', 'True' and np.True_ | PASS |
| T6 | `compare_window` returns agreement, delta and combined uncertainty, and "no claim" when uncovered or non-stationary | three `test_T6_*`: pass | Archive: stella vs GENE on 1500–1893.765 gives no claim, Δ −0.2333, combined uncertainty 0.0263. GENE vs itself on 300–400 gives no claim. An uncovered side gives no claim with delta None. My own AR(1) pair gives agree at shift 0 and disagree at shift 0.6 (margin 0.25) | PASS |
| T7 | Triangular 2.22 over 1200–1500, `rawTraceStatus: unverified`, no triangular trace | `test_T7_triangular_published_mean_only`: pass | The artifact has two traces, both `tube: bean`. `triangular` is 2.22, [1200, 1500], `unverified`. Its fixture has computed null | PASS |
| T8 | Plotly overlay of stella and GENE bean traces, shared axes with units, bands 200–300 / 300–400 / 1500–1900 | two T8 tests in `TransportView.test.tsx` and two in `lazyLoad.test.ts`: pass | The test now asserts that the plotted x and y equal the artifact arrays, and my own h5 read reproduces those arrays. Bands are read from `windows[]`. Every `plotly.js-dist-min` import in `renderer/src` is a dynamic `import()` (my grep). V1 renders the real view on the committed artifact | PASS |
| T9 | Window table: mean ± stderr, coverage, stationarity, explicit claim allowed / not allowed per row | three T9 tests plus FF-15 and FF-2: pass | V1: all seven Stationarity cells read "Undecidable" or "Not covered", and none contains "stationary" or "indicative". Every row reads "Claim not allowed". Mutation B1 (run 3's blocker put back) is red, and so is T9b (hard-coded "Claim not allowed", which survived run 3) | PASS (run-3 B1 and M1 resolved) |
| T10 | Discrepancy card: 5.79 vs archive values with delta; fixture rows claimed vs computed with ✓/✗ | three T10 tests plus FF-3 and FB-3: pass | My Δ values (+3.2355, +3.1149) match the asserted +3.24 and +3.11. Mutation T10c (fixture outcome ignores the `matches` flag, which survived run 3) is now red | PASS |
| T11 | Triangular card separate from the bean plot, labelled published mean, raw trace unverified | two T11 tests: pass | Mutation T11b (the triangular 2.22 drawn as a mean segment on the bean plot, which survived run 3) is now red in both T11 tests | PASS |
| T12 | When the live API reports GX samples, they overlay in archive units with a LIVE label; otherwise no GX series | nine parametrised not-live cases plus two T12 tests: pass | V2 sends a live payload, and the GX series is drawn at the delivered x [141.42,150] and y [2.05,2.2], so there is no second conversion. When the API then hangs, the LIVE label and the GX series are gone after about 54 ms (run-3 M4 resolved). Mutation T12e (fallback drawn as live, which survived run 3) is now red. The live comparison is a documented gap (interface.md §10) and is outside T12's wording | PASS |

### Real output
ANSI colour codes are removed. Commands ran through `scripts/dev.sh` in WSL, or from small scripts in my scratch directory.

#### Gate evidence: maintainer run, not repeated (owner asked for short checks)
```
verify.sh all at commit 3faed3a, this exact tree (maintainer): exit 0, 11/11 stages:
boundary self-test 134 shapes, scripts 71 passed, ruff clean, main 331 passed,
artifacts schema + fresh, tsc clean, vitest 1350 passed, vite build OK
```

#### Tree state
```
$ wsl.exe -e git status --short
 M status.md
$ wsl.exe -e git status --short -- main/labyrinth_main/features/transport main/tests/test_transport.py renderer/src/features/transport artifacts/transport.json renderer/src/lib/liveStatus.ts
(empty)
$ wsl.exe -e git diff --stat 2b1607e HEAD -- main/labyrinth_main/features/transport main/tests/test_transport.py renderer/src/features/transport artifacts/transport.json renderer/src/lib/liveStatus.ts renderer/src/design/components/FixtureCheck.tsx renderer/src/design/components/ProvenanceBadge.tsx
 renderer/src/design/components/FixtureCheck.tsx    | 271 +++++++--
 renderer/src/design/components/ProvenanceBadge.tsx |  47 +-
 .../src/features/transport/TransportView.test.tsx  | 648 +++++++++++++++++++--
 renderer/src/features/transport/TransportView.tsx  | 442 ++++++++++----
 renderer/src/features/transport/lazyLoad.test.ts   |  69 +++
 renderer/src/features/transport/model.ts           | 270 ++++++++-
 renderer/src/features/transport/transport.css      | 113 +++-
 renderer/src/lib/liveStatus.ts                     | 623 ++++++++++++++++++--
 8 files changed, 2151 insertions(+), 332 deletions(-)
```

#### Backend tests (shared tree)
```
$ wsl.exe -e bash scripts/dev.sh python3 -m pytest -v -p no:cacheprovider main/tests/test_transport.py
main/tests/test_transport.py::test_T1_traces_read_from_pinned_h5_with_units_and_gradients PASSED [  7%]
main/tests/test_transport.py::test_T1_divergent_restart_is_refused_not_silently_dropped PASSED [ 14%]
main/tests/test_transport.py::test_T2_time_weighted_means_reproduce_fixtures PASSED [ 21%]
main/tests/test_transport.py::test_T2_window_mean_equals_analytic_integral_for_piecewise_linear_Q PASSED [ 28%]
main/tests/test_transport.py::test_T3_window_stats_coverage_stderr_stationarity_and_claim_gate PASSED [ 35%]
main/tests/test_transport.py::test_T3_edge_hole_window_not_covered PASSED [ 42%]
main/tests/test_transport.py::test_T3_claim_gate_and_stderr_calibration_monte_carlo PASSED [ 50%]
main/tests/test_transport.py::test_T3_stationarity_false_rejection_rate_at_small_n PASSED [ 57%]
main/tests/test_transport.py::test_T4_reduced_modal_run_against_archive_and_fixtures PASSED [ 64%]
main/tests/test_transport.py::test_T5_gx_to_archive_converts_and_refuses_without_identical_references PASSED [ 71%]
main/tests/test_transport.py::test_T6_compare_window_tost_verdicts_and_no_claim PASSED [ 78%]
main/tests/test_transport.py::test_T6_compare_window_dedups_repeats_and_refuses_divergent PASSED [ 85%]
main/tests/test_transport.py::test_T6_null_false_disagree_rate_near_nominal PASSED [ 92%]
main/tests/test_transport.py::test_T7_triangular_published_mean_only PASSED [100%]
============================== 14 passed in 5.09s ==============================
exit=0
```

#### Frontend tests (shared tree)
```
$ wsl.exe -e bash scripts/dev.sh npm --prefix renderer run -s test -- src/features/transport --reporter=verbose
 ✓ src/features/transport/lazyLoad.test.ts > T8 Plotly stays lazy-loaded: no static import of plotly.js-dist-min anywhere in renderer/src 1204ms
 ✓ src/features/transport/lazyLoad.test.ts > T8 the lazy-load guard recognises every static import form and ignores type-only and dynamic ones 2ms
 ✓ src/features/transport/TransportView.test.tsx > T8 overlays stella and GENE bean traces on shared, unit-labelled axes with the three window bands 206ms
 ✓ src/features/transport/TransportView.test.tsx > T8 window bands, the chart name and the clipped flux axis are read from the artifact, not typed in 8ms
 ✓ src/features/transport/TransportView.test.tsx > T9 window table shows mean, stderr (— / ≈), coverage, stationarity and an explicit claim verdict per row 148ms
 ✓ src/features/transport/TransportView.test.tsx > T9 claim verdict and stationarity follow the artifact in both directions (synthetic allowed / true / false rows) 102ms
 ✓ src/features/transport/TransportView.test.tsx > T9 an artifact flag that contradicts its own row is never shown as an allowed claim 65ms
 ✓ src/features/transport/TransportView.test.tsx > FF-15 T9 a row that reports N_eff below 20 never shows "Claim allowed", whatever the artifact flag says 61ms
 ✓ src/features/transport/TransportView.test.tsx > FF-2 the "not allowed" callout blames the autocorrelation time only when every covered window reports N_eff below 20 47ms
 ✓ src/features/transport/TransportView.test.tsx > FF-3 the discrepancy callout weighs the gap against the reported stderr, from the numbers 124ms
 ✓ src/features/transport/TransportView.test.tsx > FF-4 the late-window note says ± is approximate only when a late stderr is flagged approximate 107ms
 ✓ src/features/transport/TransportView.test.tsx > T10 discrepancy card: PRD-reported 5.79 vs archive 300–400 means with deltas; fixture rows with ✓/✗ 42ms
 ✓ src/features/transport/TransportView.test.tsx > T10 a fixture the artifact marks as not matching is shown as a mismatch, and the deltas follow the artifact 40ms
 ✓ src/features/transport/TransportView.test.tsx > FB-3 what a fixture match is backed by comes from the fixture basis (D-023), data when absent 39ms
 ✓ src/features/transport/TransportView.test.tsx > T10 the label on the 5.79 figure is the provenance kind in the artifact, and an artifact can never make it LIVE 46ms
 ✓ src/features/transport/TransportView.test.tsx > T10 stella and GENE are stated as not shown to agree, with the sign convention and both windows 57ms
 ✓ src/features/transport/TransportView.test.tsx > T11 triangular card is separate from the bean plot: published mean 2.22, PRD-reported, raw trace unverified 51ms
 ✓ src/features/transport/TransportView.test.tsx > T11 a triangular trace present in the artifact is still never drawn or badged on the bean plot 46ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for mode unavailable 90ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for mode idle 97ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for mode launching 83ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for mode fallback 87ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for mode terminated 94ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for an unreachable API (HTTP 502) 82ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for an unreachable API (network error) 86ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for mode live with no bean samples 83ms
 ✓ src/features/transport/TransportView.test.tsx > T12 no GX series and no LIVE label for mode live with triangular samples only 77ms
 ✓ src/features/transport/TransportView.test.tsx > T12 GX samples overlay in archive units with a LIVE label only when the API reports live 36ms
 ✓ src/features/transport/TransportView.test.tsx > T12 a GX trace with live provenance inside the artifact produces no live indicator in replay 80ms
 ✓ src/features/transport/TransportView.test.tsx > DS-3 the view opens with the verdict: late means, Δ, the PRD-reported 5.79 beside 2.55 / 2.68, and the claim gate 49ms
 ✓ src/features/transport/TransportView.test.tsx > DS-6 every table cell carries its column label, so the narrow card layout stays readable without the header row 59ms
 ✓ src/features/transport/TransportView.test.tsx > A3 transport: a missing or invalid artifact shows an error naming the file, never a blank view 14ms
 Test Files  2 passed (2)
      Tests  32 passed (32)
exit=0
```
The test file reads the committed artifact from disk and serves it through a stubbed `fetch`. Only `plotly.js-dist-min` is mocked. The expectations are literals: exact Stationarity texts per row, "+3.24", "+3.11", the band list, the axis titles and the legend name `GX · LIVE (archive units)`.

#### Backend probe (`backend_probe.py`: my own h5py read and integrator; read-only)
```
h5 /mnt/d/Labyrinth/data/raw/stella_benchmark_DOI_10_1017_S0022377822000393.h5
artifact traces: [('stella-bean', 'stella', 'bean', 1433), ('gene-bean', 'GENE', 'bean', 1106)]
artifact units: {'heatFlux': 'Q_i/Q_gB,i', 'time': 't v_th,i/a'}
stella: raw n=1441 dedup n=1433 artifact n=1433 tend=2074.7
GENE: raw n=1106 dedup n=1106 artifact n=1106 tend=1893.765478748425
stella [200.0, 300.0]: mine=2.715518 artifact=2.715518 covered=True stationary=None claim=False stderr=None
stella [300.0, 400.0]: mine=2.5545375 artifact=2.554537 covered=True stationary=None claim=False stderr=None
stella [1500.0, 1900.0]: mine=2.2421269 artifact=2.242127 covered=True stationary=None claim=False stderr=0.01922
GENE   [200.0, 300.0]: mine=2.9260284 artifact=2.926028 covered=True stationary=None claim=False stderr=0.0352
GENE   [300.0, 400.0]: mine=2.6750657 artifact=2.675066 covered=True stationary=None claim=False stderr=0.02076
GENE   [1500.0, 1900.0]: mine=None artifact=None covered=False stationary=None claim=False stderr=None
GENE   [1500.0, 1893.765]: mine=2.4738618 artifact=2.473862 covered=True stationary=None claim=False stderr=0.01657
max |mine - artifact| = 4.74e-07
fixture stella-bean-1500-1900 claimed 2.242 computed 2.242127 matches True
fixture gene-bean-1500-1893.765 claimed 2.474 computed 2.473862 matches True
fixture stella-bean-300-400 claimed 2.55 computed 2.554537 matches True
fixture gene-bean-300-400 claimed 2.68 computed 2.675066 matches True
fixture reduced-modal-stella-300-400 claimed 5.79 computed None matches None
fixture triangular-published-1200-1500 claimed 2.22 computed None matches None
reducedModalRun 5.79 [300.0, 400.0] {'GENE': 2.675066, 'stella': 2.554537} prd-reported
triangular 2.22 [1200.0, 1500.0] unverified
5.79 - stella 300-400 = +3.2355; 5.79 - GENE 300-400 = +3.1149
stella 1500-1900 - GENE 1500-1893.765 = -0.2317
T5 t [0.0, 1.4142135623730951, 10.606601717798213, 141.4213562373095] expected [0.0, 1.4142135623730951, 10.606601717798213, 141.4213562373095]
T5 Q [0.0, 0.35355339059327373, 1.0, 5.65685424949238] expected [0.0, 0.35355339059327373, 1.0, 5.65685424949238]
T5 refusals [('False', 'ValueError'), ('None', 'ValueError'), ('0', 'ValueError'), ('1', 'ValueError'), ('1.0', 'ValueError'), ("'no'", 'ValueError'), ("'True'", 'ValueError'), ('np.True_', 'ValueError')]
exit=0

provenance (stella-bean, gene-bean): '{"coverage": {"description": "stella bean tube (compared/test5), tgrad=3, ngrad=1' ... ' gradients tgrad=3, ngrad=1 read from the same file'
```

#### T6 probe (`t6_probe.py`: archive traces plus my own AR(1) traces, seed 20261120)
```
stella vs GENE (1500, 1893.765): verdict=no claim delta=-0.2333 combinedStderr=0.026343331312566134 | new trace not shown stationary on 1500-1893.765; archive trace not shown stationary on 1500-1893.765
GENE vs GENE (300, 400): verdict=no claim delta=0.0 combinedStderr=0.029364411562408765 | new trace not shown stationary on 300-400; archive trace not shown stationary on 300-400
stella vs GENE (GENE uncovered) (1500, 1900): verdict=no claim delta=None combinedStderr=None | new trace not shown stationary on 1500-1900; archive trace does not cover 1500-1900
synthetic AR1 shift 0.0: verdict=agree delta=-0.0040 combinedStderr=0.0085 margin=0.250
synthetic AR1 shift 0.6: verdict=disagree delta=+0.6014 combinedStderr=0.0083 margin=0.250
exit=0
```

#### Frontend probe tests (`zzverify.test.tsx`, real view and model, isolated copy)
```
$ npm --prefix renderer run -s test -- src/features/transport/zzverify.test.tsx --reporter=verbose
PROBE window-row-stella-bean:200-300 | stat="Undecidable" | claim="Claim not allowed"
PROBE window-row-stella-bean:300-400 | stat="Undecidable" | claim="Claim not allowed"
PROBE window-row-stella-bean:1500-1900 | stat="Undecidable" | claim="Claim not allowed"
PROBE window-row-gene-bean:200-300 | stat="Undecidable" | claim="Claim not allowed"
PROBE window-row-gene-bean:300-400 | stat="Undecidable" | claim="Claim not allowed"
PROBE window-row-gene-bean:1500-1900 | stat="Not covered" | claim="Claim not allowedwindow not covered"
PROBE window-row-gene-bean:1500-1893.765 | stat="Undecidable" | claim="Claim not allowed"
PROBE live GX x [141.42,150] y [2.05,2.2]
 ✓ src/features/transport/zzverify.test.tsx > V1 committed artifact: stationarity and claim cells, no indicative word outside the collapsed detail 218ms
PROBE after hang: LIVE gone after ~54 ms, status requests 3, GX series drawn: false
 ✓ src/features/transport/zzverify.test.tsx > V2 live once, then the API hangs: LIVE and the GX series go away (old M4) 125ms
      Tests  2 passed (2)
exit=0
```
V1 also asserts that the page never says "stella and GENE agree" or "are equivalent". V2 polls every 40 ms: the first status request answers `mode: "live"` with bean samples, and every later request never answers.

#### Mutations (`mutate.py`, isolated copy; whole transport test directory run after each; file restored from the shared tree after each)
```
=== B1_null_shows_indicative: exit=1 RED | Tests  1 failed | 31 passed (32)
    red: T9 window table shows mean, stderr (— / ≈), coverage, stationarity and an explicit claim verdict per row
    first error: AssertionError: expected { …(7) } to deeply equal { …(7) }
=== T9b_claim_hardcoded_not_allowed: exit=1 RED | Tests  1 failed | 31 passed (32)
    red: T9 claim verdict and stationarity follow the artifact in both directions (synthetic allowed / true / false row
    first error: AssertionError: expected [ …(7) ] to deeply equal [ …(7) ]
=== T12e_fallback_drawn_as_live: exit=1 RED | Tests  2 failed | 30 passed (32)
    red: T12 GX samples overlay in archive units with a LIVE label only when the API reports live
    red: T12 no GX series and no LIVE label for mode fallback
    first error: AssertionError: expected [ 'GX · LIVE (archive units)' ] to deeply equal []
=== T11b_triangular_mean_segment_on_bean_plot: exit=1 RED | Tests  2 failed | 30 passed (32)
    red: T11 a triangular trace present in the artifact is still never drawn or badged on the bean plot
    red: T11 triangular card is separate from the bean plot: published mean 2.22, PRD-reported, raw trace unverified
    first error: AssertionError: expected true to be false // Object.is equality
=== T10c_fixture_ignores_matches_flag: exit=1 RED | Tests  1 failed | 31 passed (32)
    red: T10 a fixture the artifact marks as not matching is shown as a mismatch, and the deltas follow the artifact
    first error: TestingLibraryElementError: Unable to find an accessible element with the role "group" and name `/^stella bean mean, 1500–1900: Mismatch\. Claimed 2\.242 Q gB,i, computed 2\.242 Q gB,i, difference 0\.
### restored copy byte-identical to the shared tree: True
```
What each mutation changed:
- B1: `model.ts:124`, a null verdict with an indicative detail returns "Undecidable (test indicates stationary; indicative only)". This is run 3's blocker, put back.
- T9b: `model.ts:193-194` hard-codes `claimAllowed: false` and "Claim not allowed".
- T12e: `model.ts:348` also accepts `mode === 'fallback'`.
- T11b: `model.ts:435` pushes `meanSegment(triangular.window, 2.22)` onto the bean plot's shapes.
- T10c: `renderer/src/design/components/FixtureCheck.tsx:74` becomes `if (agrees)`, ignoring `matches`.

Four of the five (T9b, T12e, T11b, T10c) survived in run 3. All five are now red, and each fails on an assertion, not on a timeout.

#### End state
```
probe copy removed
3faed3a
### git status --short (owned paths)
(end)
```

### Findings
**Honesty check.** The four archive PRD means reproduce at printed precision, both by my own integrator and in the artifact: 2.242, 2.474, 2.55 and 2.68. 5.79 and 2.22 are PRD-reported and shown as "Not recomputable". No PRD number in this task fails to reproduce, so there is no mismatch to hide. The T10 test shows that a `matches: false` fixture is displayed as "Mismatch".

**Run-3 findings**
- Confirmed resolved by a probe or a mutation in this run:
  - B1 (V1 and mutation B1).
  - M1 (mutation T9b).
  - M2 (mutation T12e, and the nine-case `NOT_LIVE` list at `renderer/src/features/transport/TransportView.test.tsx:584-594`).
  - M4 (V2: a hung API drops LIVE through the real view; `renderer/src/lib/liveStatus.ts:474-489` aborts each request).
  - m5 (mutation T10c).
  - m6 (mutation T11b).
- Resolved by reading the tests, without a mutation:
  - M3: `TransportView.test.tsx:424-427` checks the pill inside the 5.79 group.
  - M5: `:511-521` checks the agreement callout and the sign convention.
  - m1: `:104-107` checks the plotted x and y.
  - m2: `:149-162` checks that the bands come from `windows[]`.
  - m3: `lazyLoad.test.ts` guards the lazy Plotly import.
  - m4: `:430` checks that stella 300–400 shows no "±".
  - m7: `:29` compares the legend name with a literal.
  - m8: `:249`, `:316` check the "≈"/"—" key.
  - m9: `:144-146` checks the "approximate, lower bound" band names.
  - m10: `:517` checks the sign convention.
  - m11: `:645-664` checks the provenance badges.
  - m12: `:320-333` checks a contradictory artifact flag.
  - m13: `:552-559` checks that the source is shown as text, not a link.

**Notes (non-blocking)**
- **n1, open gap by design.** `interface.md:260-263`: nothing computes the PRD's live comparison for GX samples. T12 asks only for the overlay and the LIVE label, and both hold. The view's text for the GX series says only "overlaid in archive units" (`renderer/src/features/transport/model.ts:504`) and implies no comparison.
- **n2.** The UI's late-window Δ "stella − GENE = −0.23" (`model.ts:268-277`) compares two different windows. My integrator gives −0.2317 on those windows and −0.2333 (via `compare_window`) on the common 1500–1893.765 window. Both print as −0.23, and the view states that the windows are not identical. No action needed.
- **Carried from round 2, backend byte-identical since then:** N1 (bias correction not pinned by a test), N2 (the gate can open near a true N_eff of about 10; no archive window is affected), N4 ("disagree" semantics), F2 and F3. None blocks.

**Not checked in this run (kept short at the owner's request)**
- `verify.sh all` and `check_boundaries.py`; the maintainer's run at 3faed3a is quoted instead.
- The Monte-Carlo calibrations, because the backend is unchanged since they were run.
- A real-browser render, dark theme and narrow viewports.
- `lib.test.tsx` on its own; V2 checks the same behaviour through the view.
- A real GX run. No credentials and no network were used.

**Why PASS.** The maintainer's gates exit 0 at 3faed3a. All 14 backend tests and 32 frontend transport tests pass. Each outcome has a test that can fail: five of five mutations went red, including four that survived run 3. My probes agree with the artifact and with the view.

Verdict: PASS
