# Labyrinth — agent operating rules

**Start every session by reading `status.md` (state + next steps), then `interface.md` (every contract), `architecture.md` and `decision.md`.**
`status.md` is the single source of truth for what is done, in flight, and blocked. Update it when
you finish anything. If you run out of budget mid-task, write where you stopped in `status.md` first.

## Maintainer
From 2026-11-20 the code is kept and updated by Claude Code working in the owner's checkout
(`D:\Labyrinth`, Windows 11 + WSL Ubuntu). The maintainer orchestrates the agents below, owns
`contracts/`, `scripts/`, the docs and every commit, and **commits and pushes to `main` on
`github.com/bede-lau/Labyrinth`** — only when `verify.sh` is green and the reviewer agent has approved
that change. Engineers, verifiers and reviewers never commit.

## Running commands on this machine (Windows + WSL) — decision D-020
The gates are bash scripts with POSIX-signal tests and CI is Ubuntu, so **everything runs inside WSL**.
Native Windows has no Node, no Python deps and no usable `bash`/`git` on PATH.
- One-time setup (already done here): `wsl.exe -e bash scripts/setup-dev.sh` — installs uv, a venv and
  Node 22 under `~/.local/share/labyrinth` in WSL (no sudo, nothing on Windows) and runs `npm ci`.
- Run anything through the wrapper, from the repo root (WSL starts in the same directory):
  `wsl.exe -e bash scripts/dev.sh bash scripts/verify.sh main` ·
  `wsl.exe -e bash scripts/dev.sh python3 -m pytest -q main/tests/test_server.py` ·
  `wsl.exe -e bash scripts/dev.sh npm --prefix renderer run -s test`
- Anything with quotes, pipes or `cd`: write a small `.sh` file to your scratch directory and run
  `wsl.exe -e bash scripts/dev.sh bash /mnt/c/.../your.sh` (Windows `C:\x` is `/mnt/c/x`, the repo is `/mnt/d/Labyrinth`).
  Do not try to quote shell one-liners through PowerShell.
- git: use WSL git for read-only commands (`wsl.exe -e git status`, `git diff`, `git log`).
  Only the maintainer commits and pushes.
- Line endings are LF on every OS (`.gitattributes`). Never save a tracked file with CRLF.
- On Linux/CI the same commands work without `wsl.exe -e`; `scripts/dev.sh` is then a transparent wrapper.

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
