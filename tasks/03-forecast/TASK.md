# 03 · Forecast replay

PRD: predict the next 50-unit local mean from the previous completed window, reveal the archived observations, update and repeat. Using 1450–1500 for initialization, stella MAE **0.0444** vs **0.0423** for a frozen forecast. Show both scores.

## Owner
backend: backend-engineer (`main/labyrinth_main/features/forecast/`) · frontend: frontend-engineer (`renderer/src/features/forecast/`)

## Expected outcome
- F1. Eight steps over [1500,1550) … [1850,1900) on the stella bean trace, initialised on [1450,1500).
- F2. Persistence forecast (previous completed window mean) and frozen forecast (initialisation mean) with per-step absolute errors and MAE; `method` states the exact window-mean definition.
- F3. Fixtures: claimed 0.0444 / 0.0423 vs computed. Window means use the shared edge-interpolated definition (D-013) → ≈0.0440 / 0.0418 — **expected mismatch**, shown in the artifact. The note must state that a sample-and-hold mean reproduces both PRD scores (0.0444 / 0.0423) but breaks the 2.55 archive fixture (D-016).

- F6. `errorStats` (owner requirement 2026-11-21, D-026): `definition` plus, for persistence and frozen, `n`, `mse`, `rmse`, `squaredErrorRange` ([min, max] of e_k²) and `errorRange` ([min, max] of e_k), with e_k = forecast_k − observed_k (predicted − actual) over the scored steps; equal to a recomputation from `steps`; all null when there are no steps.

Frontend:
- F4. The view opens on all eight saved windows. "Start replay" predicts the first window and starts the keyboard-operable Predict → Reveal observed → Update sequence. Observations stay hidden until Reveal, and only Update scores a window. "Run to end" applies the same sequence to each remaining window and disables at completion. "Show all windows" returns to the overview and moves focus to "Start replay".
- F5. Show MAE for both forecasters across all saved windows in the overview and across scored windows in replay. In the same panel, following the chart and statistics, show the PRD scores as claimed versus recomputed and flag any mismatch. A mismatch at the top of the panel links to that section without changing the route.
- F7. The primary chart shows two step lines over each 50-unit window, Predicted and Actual heat flux (Q_gB,i) against time (a/v_th,i). A keyboard-operable selector chooses persistence (default) or frozen for Predicted. The "Absolute error" toggle plots both forecasters' absolute errors and shows their signed error ranges over scored windows. The overview plots all eight saved windows. In replay, each prediction appears at Predict and the observation and absolute errors appear at Reveal. The chart has a text summary and comes before the statistics, PRD scores and steps table in reading and focus order. The table is available under a disclosure and follows the same visibility rules.
- F8. MSE, RMSE, the range of MSE (min–max of the squared errors) and the range of errors (min–max of predicted − actual) for the selected forecaster, with units: running over the scored windows (a window counts at its Update, like the running MAE), and equal to the artifact's `errorStats` once every window is scored. Squared quantities (MSE, range of MSE) print to 3 significant figures, RMSE and the range of errors to 4 decimals; "equal" means equal within the steps' 7-significant-figure rounding (on the committed artifact every printed value is identical).

## Tests
| # | Test |
|---|---|
| F1–F3, F6 | `main/tests/test_forecast.py::test_F1_*` … `test_F3_*`, `test_F6_*` |
| F4–F5, F7–F8 | `renderer/src/features/forecast/*.test.tsx` (tests for F7 and F8 named `F7 …`, `F8 …`) |

## Status
VERIFYING

The files listed in the verification record have changed since its last recorded run.

Independent verification passed at `9e017b6` on 2026-11-22. See the final run in [VERIFY.md](VERIFY.md).

Merged 2026-11-21: the owner's local graph redesign (bbf2fc6: the overview graphs all eight windows; replay reveals archived observations on request; the saved artifact retains its claimed and computed scores) combined with D-026 (predicted vs actual, MSE / RMSE / ranges). Reopened 2026-11-21 for the owner's requirement (D-026: predicted vs actual chart, MSE). Previously DONE: verified at commit 3faed3a (tasks/03-forecast/VERIFY.md, `Verdict: PASS`, external verifier, 2026-11-20).
