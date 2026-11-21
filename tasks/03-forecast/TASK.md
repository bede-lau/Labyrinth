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
- F4. Step-through replay: Predict → Reveal → Update, keyboard operable, with a reset; observed values are hidden until revealed. A "Run to end" control (D-028) presses the step button through every remaining window in the same order (never revealing a window before its forecast) and disables once the replay is complete.
- F5. Running MAE for both forecasters, plus final claimed vs computed scores with mismatch flag.
- F7. The steps table is replaced as the primary display by a chart of heat flux (Q_gB,i) against time (a/v_th,i) with two lines, Predicted (persistence by default; a keyboard-operable selector switches to frozen) and Actual (the archived observed window means), drawn as steps over each 50-unit window. A value appears only once it is predicted or revealed (hidden values are never plotted). The table stays available under a disclosure, and the chart has a text summary. The replay panel with the chart comes before the final scores in the DOM (reading and focus order); while a PRD score is a mismatch, the replay panel's first line points to it (DS-4 kept).
- F8. MSE, RMSE, the range of MSE (min–max of the squared errors) and the range of errors (min–max of predicted − actual) for the selected forecaster, with units: running over the scored windows (a window counts at its Update, like the running MAE), and equal to the artifact's `errorStats` once every window is scored. Squared quantities (MSE, range of MSE) print to 3 significant figures, RMSE and the range of errors to 4 decimals; "equal" means equal within the steps' 7-significant-figure rounding (on the committed artifact every printed value is identical).

## Tests
| # | Test |
|---|---|
| F1–F3, F6 | `main/tests/test_forecast.py::test_F1_*` … `test_F3_*`, `test_F6_*` |
| F4–F5, F7–F8 | `renderer/src/features/forecast/*.test.tsx` (tests for F7 and F8 named `F7 …`, `F8 …`) |

## Status
VERIFYING

Merged 2026-11-21: the owner's local graph redesign (bbf2fc6: the overview graphs all eight windows; replay reveals archived observations on request; the saved artifact retains its claimed and computed scores) combined with D-026 (predicted vs actual, MSE / RMSE / ranges). Reopened 2026-11-21 for the owner's requirement (D-026: predicted vs actual chart, MSE). Previously DONE: verified at commit 3faed3a (tasks/03-forecast/VERIFY.md, `Verdict: PASS`, external verifier, 2026-11-20).
