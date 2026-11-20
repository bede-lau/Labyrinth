# 00 · Scaffold, process boundary, verify loop

## Owner
orchestrator

## Expected outcome
1. Top-level `main/` (backend) and `renderer/` (frontend); imports between them are rejected.
2. `scripts/verify.sh` runs boundary → lint → tests → artifact schema/freshness → typecheck → tests → build and exits **2** on any failure or bad invocation.
3. Claude Code hooks: PostToolUse boundary check and Stop-hook verify loop, both exit 2 on failure.
4. Pinned raw inputs in `data/raw/` with sha256 checks.
5. Handoff docs exist: status.md, architecture.md, decision.md, CLAUDE.md, tasks/*/TASK.md.

## Tests
| # | Test | Command |
|---|---|---|
| 1 | boundary self-test catches 6 planted violations, passes 2 clean files | `python3 scripts/check_boundaries.py --self-test` |
| 2 | verify.sh exits 2 on bad scope | `bash scripts/verify.sh nope; echo $?` → `2` |
| 3 | post-edit hook exits 2 on a violating file | see tasks/00-scaffold/VERIFY.md |
| 4 | raw data sha256 | `pytest main/tests/test_common.py -k sha256` |
| 5 | docs gate | `python3 scripts/check_docs.py` |

## Status
VERIFYING

Verifier run 3 PASS; later fixes R1/R3/R4/R5 not re-verified; no reviewer yet. See status.md §2.
