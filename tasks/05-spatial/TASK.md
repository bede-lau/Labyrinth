# 05 · Inspect spatial parallelism (replay, separate Dommaschk geometry)

## Owner
backend: backend-engineer (`main/labyrinth_main/features/spatial/`) · frontend: frontend-engineer (`renderer/src/features/spatial/`)

## Expected outcome
- S1. Two ranks: rank 0 on GPU 0 owns planes 1–3, rank 1 on GPU 1 owns planes 4–6; MPI exchanges at the 3↔4 and 6↔1 (periodic) boundaries; field solve on CPU.
- S2. 4 controlled runs, 4 passed; CPU 184.69 s, GPU 145.44 s, speedup recomputed = 1.27 (fixture).
- S3. Provenance `prd-reported`; verification `blocked` because the checkpoints are not in this repo.
- S4. Independence note: the live W7-X tubes are independent (no exchange between GPU 0 and GPU 1).

Frontend:
- S5. Ring diagram of 6 toroidal planes coloured by rank, exchange arrows, CPU field-solve node; labelled "Dommaschk geometry — not W7-X".
- S6. Timing comparison (CPU vs GPU mean, 1.27×) and run tally; provenance badge shows PRD-reported/blocked.

## Tests
| # | Test |
|---|---|
| S1–S4 | `main/tests/test_spatial.py` |
| S5–S6 | `renderer/src/features/spatial/*.test.tsx` |

## Status
IN-PROGRESS

Backend S1–S4: verifier PASS + reviewer APPROVE. Frontend S5–S6: built with tests, unverified.
