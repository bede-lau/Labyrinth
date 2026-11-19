# Labyrinth · status

> Single source of truth for handoff. Read this first. Update it whenever a task changes state.
> Last updated by: orchestrator, 2026-11-19 (wave 1 in flight).

## Where things stand
| Task | Owner | State | Verify | Review | Notes |
|---|---|---|---|---|---|
| 00 scaffold | orchestrator | VERIFYING | run 1 FAIL (13 boundary bypasses, spoofable DONE gate) → fixed in 408ce44; re-verify running | — | boundary, verify loop, hooks, contracts, raw data, docs |
| 01 geometry | backend-engineer / frontend-engineer | IN-PROGRESS: backend G1–G6 built (stella ρ0.7 reproduced: max |ΔB| 4.9e-4 ≤ 5e-4 printed), frontend TODO | backend verifier running | backend reviewer running | acceptance-129 BLOCKED (D-007) |
| 02 transport | backend-engineer / frontend-engineer | IN-PROGRESS (backend/design wave 1) | — | — | backend T1–T7 built; switching to edge-interpolated means (D-013: 2.68 reproduces) |
| 03 forecast | backend-engineer / frontend-engineer | IN-PROGRESS (backend/design wave 1) | — | — | backend F1–F3 built; MAE fixtures do not reproduce (D-008) |
| 04 budget | backend-engineer / frontend-engineer | IN-PROGRESS (backend/design wave 1) | — | — | |
| 05 spatial | backend-engineer / frontend-engineer | IN-PROGRESS (backend/design wave 1) | — | — | checkpoints not in repo → prd-reported |
| 06 live-gx | backend-engineer / frontend-engineer | IN-PROGRESS (backend/design wave 1) | — | — | UNREHEARSED, no Modal creds (D-011) |
| 07 server | backend-engineer | IN-PROGRESS (backend/design wave 1) | — | — | |
| 08 design system | design-lead | IN-PROGRESS (backend/design wave 1) | — | — | |
| 09 app shell | frontend-engineer | TODO | — | — | |

States: TODO → IN-PROGRESS → VERIFYING → DONE (needs VERIFY.md `Verdict: PASS` + reviewer APPROVE) · BLOCKED.

## Execution plan
1. Wave 1 (parallel): backend geometry · backend data (transport, forecast, budget, spatial) · backend live (live_gx, server) · design-lead (design system).
2. Wave 2 (parallel, after wave 1 artifacts + design system): frontend shell+geometry+spatial · frontend transport+forecast+budget+live.
3. After each task: external verifier → VERIFY.md; reviewer on diff; fix loop until PASS/APPROVE.
4. Final: design review screenshots, full `verify.sh all`, push.

## Blockers needing a human
- **GitHub push is blocked (403):** the Claude GitHub App lacks write access to bede-lau/Labyrinth. All commits are local on `claude/focused-cori-6s5ucw` until access is fixed.
- **129 saved stella samples at ρ 0.8** (PRD acceptance for Locate the tubes) — not in repo or at the cited stella commit. Provide the file. (D-007)
- **Modal credentials + GX rehearsal** for live mode. (D-011)
- **Dommaschk GENE-X checkpoints** to turn the spatial-parallelism replay from PRD-reported into verified. (05)
- **ANTHROPIC_API_KEY repo secret** to enable automated PR review in CI. (D-012)

## Resume instructions for the next agent
1. `pip install -r main/requirements.txt && npm --prefix renderer ci`
2. `bash scripts/verify.sh` — must exit 0 before you start.
3. Pick the first task above not DONE; read its `tasks/<NN>/TASK.md`; follow the matching `.claude/agents/*.md`.
