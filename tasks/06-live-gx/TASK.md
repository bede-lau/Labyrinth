# 06 · Advance plasma (live, after qualification)

PRD: nonlinear GX on two A100s; GPU 0 advances the bean tube and GPU 1 the triangular tube. Rehearse from initialization and verify checkpoint continuation. Show both device IDs, overlapping solver execution, advancing simulation clocks and newly generated flux samples. If either worker fails, label and play the saved run. $40 cumulative Modal ceiling; reconcile billed + pending before each allocation; resource limits + hard timeout; terminate after retrieval.

## Owner
backend: backend-engineer (`main/labyrinth_main/features/live_gx/`) · frontend: frontend-engineer (`renderer/src/features/live-gx/`)

## Expected outcome
- L1. Budget guard: slot estimate = rate × (slot + setup + idle margin) + storage/egress allowance; refuses when billed + pending + estimate > $40; computes hard timeout; refuses when ledger is unreconciled.
- L2. Orchestrator with injected worker backend runs two workers concurrently (GPU 0 bean, GPU 1 triangular), records device IDs, wall-clock intervals that overlap, monotonically advancing simTime, new samples converted to archive units.
- L3. Either worker failing → mode `fallback`, label shown, `savedRunId` (null when no qualified rehearsal exists), error preserved; the other worker is terminated.
- L4. No Modal credentials or `modal` not installed → mode `unavailable`, zero network calls.
- L5. Checkpoint continuation: a run resumed from a checkpoint continues simTime from the checkpoint, not from 0.
- L6. Workers are always terminated after retrieval (also on exception).
- L7. Every status snapshot validates against `contracts/live-status.schema.json`.
- L8. `modal_app.py` defines the GX worker (A100-40GB, hard timeout, explicit launch only) and GX input generation for both tubes; it is never imported by tests or replay paths; marked UNREHEARSED.

Frontend:
- L9. Live panel polls `/api/live/status` (or SSE): unavailable/fallback states show an unmistakable label and play the replay; live shows both device IDs, both sim clocks advancing, sample counts.
- L10. Launch button only enabled when mode is `idle` and `budget.slotFits`; requires explicit confirmation showing the slot cost.

## Tests
| # | Test |
|---|---|
| L1–L8 | `main/tests/test_live_gx.py` |
| L9–L10 | `renderer/src/features/live-gx/*.test.tsx` |

## Status
IN-PROGRESS

Backend L1–L8: built, UNREHEARSED; reviewer round 4 CHANGES REQUESTED (rehearse CLI orphan-GPU test, startup_timeout test). Frontend L9–L10: built, unverified.
