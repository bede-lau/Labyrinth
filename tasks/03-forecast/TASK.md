# 03 · Forecast replay

PRD: predict the next 50-unit local mean from the previous completed window, reveal the archived observations, update and repeat. Using 1450–1500 for initialization, stella MAE **0.0444** vs **0.0423** for a frozen forecast. Show both scores.

## Owner
backend: backend-engineer (`main/labyrinth_main/features/forecast/`) · frontend: frontend-engineer (`renderer/src/features/forecast/`)

## Expected outcome
- F1. Eight steps over [1500,1550) … [1850,1900) on the stella bean trace, initialised on [1450,1500).
- F2. Persistence forecast (previous completed window mean) and frozen forecast (initialisation mean) with per-step absolute errors and MAE; `method` states the exact window-mean definition.
- F3. Fixtures: claimed 0.0444 / 0.0423 vs computed. Window means use the shared edge-interpolated definition (D-013) → ≈0.0440 / 0.0418 — **expected mismatch**, shown in the artifact. The note must state that a sample-and-hold mean reproduces both PRD scores (0.0444 / 0.0423) but breaks the 2.55 archive fixture (D-016).

Frontend:
- F4. Step-through replay: Predict → Reveal → Update, keyboard operable, with a reset; observed values are hidden until revealed.
- F5. Running MAE for both forecasters, plus final claimed vs computed scores with mismatch flag.

## Tests
| # | Test |
|---|---|
| F1–F3 | `main/tests/test_forecast.py::test_F1_*` … `test_F3_*` |
| F4–F5 | `renderer/src/features/forecast/*.test.tsx` |

## Status
DONE

Verified at commit 3faed3a: tasks/03-forecast/VERIFY.md final run, `Verdict: PASS` (external verifier, 2026-11-20). Reviewer APPROVE in the 2026-11-20 review round (status.md, Session 3).
