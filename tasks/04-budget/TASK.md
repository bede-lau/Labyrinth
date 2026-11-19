# 04 · Budget and presentation figures

## Owner
backend: backend-engineer (`main/labyrinth_main/features/budget/`) · frontend: frontend-engineer (`renderer/src/features/budget/`)

## Expected outcome
- B1. Live demo: 15 min at $6.10/h → $1.53; two 1-h rehearsals + one slot → $13.73; + $8.10 posted → $21.83 planned; remaining $18.17 of $40 (all recomputed, fixtures).
- B2. Published stella bean: 161 h × 288 processors = 46,368 CPU-h.
- B3. Full-grid stella on Modal: 65,700 steps × 19 s/step at $9.15/h → days and dollars inside the PRD ranges (14–15 d, $3,100–3,200); halved timestep inside (28–30 d, $6,200–6,400).
- B4. GX published benchmark (28 min 1 GPU 4×8; 90 min 4 GPUs 8×16) as `prd-reported` context only.
- B5. Pricing constants exported for the live budget guard (`features/budget/pricing.py`).

Frontend:
- B6. Ledger bar to the $40 ceiling: posted, planned, remaining.
- B7. Scenario cards with headline, derivation and interpretation; prd-reported vs derived distinguished.

## Tests
| # | Test |
|---|---|
| B1–B5 | `main/tests/test_budget.py` |
| B6–B7 | `renderer/src/features/budget/*.test.tsx` |

## Status
TODO
