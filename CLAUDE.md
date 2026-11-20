# Labyrinth — agent operating rules

**Start every session by reading `status.md` (state + next steps), then `interface.md` (every contract), `architecture.md` and `decision.md`.**
`status.md` is the single source of truth for what is done, in flight, and blocked. Update it when
you finish anything. If you run out of budget mid-task, write where you stopped in `status.md` first.

## Layout
- `main/` — backend ("main process"): Python. `renderer/` — frontend ("renderer process"): React/TS.
- **Imports between `main/` and `renderer/` are banned.** They communicate only through
  `artifacts/*.json` (validated by `contracts/*.schema.json`) and the HTTP API (`/api/...`).
  Enforced by `scripts/check_boundaries.py` (verify stage + PostToolUse hook, exit 2).
- One folder per feature on each side, plus `tasks/<NN-feature>/` holding TASK.md (expected outcomes,
  one test each) and VERIFY.md (external verifier's real output and verdict).
- `contracts/` is owned by the orchestrator. Changing it requires a decision.md entry and updating both sides.

## The loop
build → `bash scripts/verify.sh [scope]` → fix → repeat. verify.sh exits **2** on any failure;
the Stop hook runs it and blocks with exit 2 until it is green (safety valve after 6 attempts).
A task is DONE only when a separate verifier agent writes `Verdict: PASS` in its VERIFY.md and a
reviewer agent has approved the diff. `scripts/check_docs.py` enforces the VERIFY.md rule.

## Agents (`.claude/agents/`)
backend-engineer (main/), frontend-engineer (renderer/), design-lead (renderer/src/design/ + design
review), verifier (external verification, writes VERIFY.md), reviewer (read-only code review).

## Current stage
Build stage handed over on 2026-11-20 with **nothing marked DONE**: backends of 01–05 are verified+approved; live GX (06/07), the design system (08),
the shell (09) and all frontend views are built but **not** externally verified. `status.md` §4 is the work queue.

## Honesty rules (non-negotiable)
- Never present replayed or PRD-reported numbers as live or as recomputed.
- Every PRD number is a fixture: claimed vs computed at printed precision; mismatches are displayed.
- Live GX spend is gated by the budget guard against the $40 ceiling; nothing launches implicitly.

## Commands
```
pip install -r main/requirements.txt && npm --prefix renderer ci
bash scripts/verify.sh                               # everything
cd main && python3 -m labyrinth_main.build_artifacts # regenerate artifacts/
npm --prefix renderer run dev                        # UI on :5173 (replay)
cd main && python3 -m labyrinth_main.server          # API on :8787 (live status)
```
