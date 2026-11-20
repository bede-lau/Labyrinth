# Labyrinth · status

> Single source of truth for handoff. Read this first. Update it whenever a task changes state.
> Last updated by: orchestrator, 2026-11-19 (wave 1 in flight).

## Where things stand
| Task | Owner | State | Verify | Review | Notes |
|---|---|---|---|---|---|
| 00 scaffold | orchestrator | VERIFYING | run1 FAIL (13 bypasses) → run2 FAIL (absolute paths N1, verdict parse N9) → fixed 86a5142; run 3 running | — | |
| 01 geometry | backend-engineer / frontend-engineer | IN-PROGRESS: backend cleared (verifier PASS + reviewer APPROVE after fix round; float64 stella match 2.9e-13); frontend TODO | backend PASS | backend APPROVE | UI must show acceptance-129 BLOCKED |
| 02 transport | backend-engineer / frontend-engineer | IN-PROGRESS: backend fix round (reviewer blockers: small-N stderr, stationarity over-rejection, no equivalence margin in compare) | backend PASS | CHANGES REQUESTED | stella vs GENE disagree on 1500–1893.8 (z≈−9): UI must not imply they agree |
| 03 forecast | backend-engineer / frontend-engineer | IN-PROGRESS: backend fix round (note: sample-and-hold reproduces PRD MAE, breaks 2.55) | backend FAIL (premise) | CHANGES REQUESTED | D-016 pending |
| 04 budget | backend-engineer / frontend-engineer | IN-PROGRESS: backend minors in fix round | backend PASS | CHANGES REQUESTED (minor) | range fixtures: never render midpoint as a PRD figure |
| 05 spatial | backend-engineer / frontend-engineer | IN-PROGRESS: backend minors in fix round | backend PASS | CHANGES REQUESTED (minor) | |
| 06 live-gx | backend-engineer / frontend-engineer | IN-PROGRESS: backend fix round (B1 Ctrl-C leaves GPUs running; M1 Modal cap vs guard; M2–M6; L3 malformed poll) | backend FAIL (L3) | CHANGES REQUESTED | UNREHEARSED |
| 07 server | backend-engineer | VERIFYING: fix round (SIGINT/SIGTERM shutdown, terminate result) | PASS | CHANGES REQUESTED (via 06) | |
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
