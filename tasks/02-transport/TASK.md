# 02 · Check transport (replayed evidence; live overlay when qualified)

PRD: overlay new bean ion heat flux with public stella and GENE traces; show the triangular published mean separately; match geometry, gradients, units, time coverage; GX→archive units: t×√2, Q÷2√2; compare time-weighted means on 200–300 and 300–400 when covered; claim saturated agreement only for a covered stationary window with sampling uncertainty.

## Owner
backend: backend-engineer (`main/labyrinth_main/features/transport/`) · frontend: frontend-engineer (`renderer/src/features/transport/`)

## Expected outcome
- T1. Traces read from `compared/test5/{stella,GENE}/{t,Q}` of the pinned benchmark h5, units `Q_i/Q_gB,i` vs `t v_th,i/a`; gradients (tgrad 3, ngrad 1) recorded in provenance.
- T2. Time-weighted means ∫_a^b Q dt/(b−a), Q linearly interpolated at the window edges (D-013), reproduce fixtures **2.242** (stella 1500–1900) and **2.474** (GENE 1500–1893.765).
- T3. For each trace, windows 200–300, 300–400, 1500–1900 (and 1500–1893.765 for GENE): coverage, mean, autocorrelation-corrected stderr (batch means or integrated autocorrelation time — document which), stationarity test; `saturatedClaimAllowed` true only if covered ∧ stationary ∧ stderr finite.
- T4. Reduced Modal stella run **5.79** on 300–400 shown against archive 300–400 means; fixtures for PRD's "2.55" and "2.68" vs computed (edge-interpolated means reproduce both, D-013; record the sample-span value 2.674 in the note).
- T5. `gx_to_archive(t, Q)` returns (t·√2, Q/(2√2)); refuses (raises) unless the caller asserts identical dimensional references.
- T6. `compare_window(new, archive, window)` returns agreement verdict + delta + combined uncertainty, and returns "no claim" when either side is uncovered or non-stationary.
- T7. Triangular: published mean **2.22** over 1200–1500, `rawTraceStatus: unverified`, no triangular trace emitted.

Frontend:
- T8. Plotly overlay of stella and GENE bean traces (shared axes, labelled units), window bands for 200–300/300–400/1500–1900.
- T9. Window table: mean ± stderr, coverage, stationarity, and an explicit "saturated agreement: claim allowed / not allowed" per row.
- T10. Discrepancy card: reduced Modal 5.79 vs archive values with delta; fixture rows (claimed vs computed, ✓/✗).
- T11. Triangular card separate from the bean plot, labelled "published mean, raw trace unverified".
- T12. When the live API reports GX samples, they overlay in archive units with a LIVE label; otherwise no GX series is drawn.
- T13. Live comparison (D-024): only when a valid, fresh live-status snapshot has mode `live` and carries `comparison`, a "Live comparison" section shows per window (200–300, 300–400) the live coverage, mean ± stderr (approximate marked as a lower bound, "—" for null), N_eff vs the gate 20, stationarity ("Undecidable" for null), the live trace's own claim gate, and for stella and GENE the archive mean, the signed Δ and the verdict (Agree / Disagree / Inconclusive / No claim); "Saturated agreement: claim allowed" only when the backend flag is true **and** an `agree` verdict is present (a flag without one is shown as an inconsistency); empty `windows` shows "could not be computed" with the reason; nothing in any other state.

## Tests
| # | Test |
|---|---|
| T1–T7 | `main/tests/test_transport.py::test_T1_*` … `test_T7_*` |
| T8–T13 | `renderer/src/features/transport/*.test.tsx`, one `test('T8 …')` per outcome |

## Status
DONE

Verified at commit 77fd8b6 (D-024 live comparison, new outcome T13): tasks/02-transport/VERIFY.md run 5, `Verdict: PASS` (external verifier, 2026-11-21). Reviewer APPROVE of the D-024 change (2026-11-21). Previously DONE at 3faed3a.
