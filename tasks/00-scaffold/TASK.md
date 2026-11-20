# 00 · Scaffold, process boundary, verify loop

## Owner
maintainer (orchestrator): `scripts/`, `.claude/settings.json`, `.github/workflows/`, `.gitattributes`

## Expected outcome
1. Top-level `main/` (backend) and `renderer/` (frontend); imports between them are rejected.
2. `scripts/verify.sh` runs boundary → lint → tests → artifact schema/freshness → typecheck → tests → build and exits **2** on any failure or bad invocation.
3. Claude Code hooks: PostToolUse boundary check and Stop-hook verify loop, both exit 2 on failure.
4. Pinned raw inputs in `data/raw/` with sha256 checks.
5. Handoff docs exist: status.md, architecture.md, decision.md, CLAUDE.md, tasks/*/TASK.md.

## Tests
| # | Test | Command |
|---|---|---|
| 1 | boundary self-test catches every planted violation shape and passes every clean shape (the stage prints both counts) | `python3 scripts/check_boundaries.py --self-test` |
| 2 | verify.sh exits 2 on bad scope | `bash scripts/verify.sh nope; echo $?` → `2` |
| 3 | post-edit hook exits 2 on a violating file | see tasks/00-scaffold/VERIFY.md |
| 4 | raw data sha256 | `pytest main/tests/test_common.py -k sha256` |
| 5 | docs gate | `python3 scripts/check_docs.py` |

## Status
VERIFYING

Verifier run 3 PASS (old). Reviewer 2026-11-20: CHANGES REQUESTED (status.md §4c); SC-1…SC-13 fixed in wave 2, not yet re-reviewed or re-verified. See status.md HANDOVER.
