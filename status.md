# Labyrinth · status

> Single source of truth for handoff. Read this first. Update it whenever a task changes state.
> Last updated by: orchestrator, 2026-11-19 (wave 1 in flight).

## Where things stand
| Task | Owner | State | Verify | Review | Notes |
|---|---|---|---|---|---|
| 00 scaffold | orchestrator | VERIFYING | run 1 FAIL (13 boundary bypasses, spoofable DONE gate) → fixed in 408ce44; re-verify running | — | boundary, verify loop, hooks, contracts, raw data, docs |
| 01 geometry | backend-engineer / frontend-engineer | IN-PROGRESS: backend fix round (reviewer CHANGES REQUESTED: provenance outcome must be `blocked` while acceptance-129 is blocked; float-noise snap; pin stella float64 reference; parse test_2 .in; real G4 tests; Newton fallback); frontend TODO | backend PASS (tasks/01-geometry/VERIFY.md) | CHANGES REQUESTED (1 major, 6 minor) | frontend must show `validation.acceptance129` as BLOCKED, not provenance outcome |
| 02 transport | backend-engineer / frontend-engineer | IN-PROGRESS: backend T1–T7 built (all 4 PRD archive means reproduce, D-013); frontend TODO | backend verifier running | data reviewer running | stella trace has 8 duplicate restart samples (dropped, recorded) |
| 03 forecast | backend-engineer / frontend-engineer | IN-PROGRESS: backend F1–F3 built; frontend TODO | backend verifier running | data reviewer running | MAE 0.0440/0.0418 vs PRD 0.0444/0.0423 — no definition reproduces (D-008) |
| 04 budget | backend-engineer / frontend-engineer | IN-PROGRESS: backend B1–B5 built; frontend TODO | backend verifier running | data reviewer running | half-up cent rounding per item (PRD convention) |
| 05 spatial | backend-engineer / frontend-engineer | IN-PROGRESS: backend S1–S4 built; frontend TODO | backend verifier running | data reviewer running | prd-reported; checkpoints not in repo → blocked |
| 06 live-gx | backend-engineer / frontend-engineer | IN-PROGRESS: backend L1–L8 built (UNREHEARSED); frontend TODO | backend verifier running | live reviewer running | guard: slot $2.65, rehearsal $7.73, plan $26.21 (D-015) |
| 07 server | backend-engineer | VERIFYING: H1–H6 built | verifier running | live reviewer running | loopback-only, no CORS → UI uses Vite proxy |
| 08 design system | design-lead | IN-PROGRESS (resumed after usage limit; tokens.css/tokens.ts agreement test failing mid-work) | — | — | |
| 09 app shell | frontend-engineer | TODO | — | — | |

States: TODO → IN-PROGRESS → VERIFYING → DONE (needs VERIFY.md `Verdict: PASS` + reviewer APPROVE) · BLOCKED.

## Interruption log
- 2026-11-20: account usage limit (429) killed 8 background agents mid-run (design-lead, 6 verifiers/reviewers). All resumed after reset via SendMessage with their context. If this happens again and you are a NEW session: the agents' transcripts are gone — re-dispatch each in-flight row above with the matching `.claude/agents/*.md` and its TASK.md.

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
