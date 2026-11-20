# Labyrinth · status

> Single source of truth for handoff. Read this first. Update it whenever a task changes state.
> Last updated by: orchestrator, 2026-11-19 (wave 1 in flight).

## Where things stand
| Task | Owner | State | Verify | Review | Notes |
|---|---|---|---|---|---|
| 00 scaffold | orchestrator | VERIFYING: run 3 PASS; R1/R3/R4/R5 fixed after; awaiting reviewer | PASS (run 3) | — | |
| 01 geometry | backend-engineer / frontend A | IN-PROGRESS: backend cleared; frontend A building | backend PASS | backend APPROVE | UI must show acceptance-129 BLOCKED |
| 02 transport | backend-engineer / frontend B | IN-PROGRESS: backend fix round done (TOST compare, N_eff≥20 gate, D-017: no archive window permits a claim); frontend B building | re-verify running | re-review running | |
| 03 forecast | backend-engineer / frontend B | IN-PROGRESS: backend fix done (one-sided edge; sample-and-hold note, D-016); frontend B building | re-verify running | re-review running | |
| 04 budget | backend-engineer / frontend B | IN-PROGRESS: backend minors fixed; frontend B building | backend PASS | re-review running | |
| 05 spatial | backend-engineer / frontend A | IN-PROGRESS: backend minors fixed; frontend A building | backend PASS | re-review running | |
| 06 live-gx | backend-engineer / frontend B | IN-PROGRESS: backend fix round done (shutdown terminates GPUs, Modal cap = guard, saved-run route D-018); frontend B building | re-verify running | re-review running | UNREHEARSED |
| 07 server | backend-engineer | VERIFYING: fix round done | re-verify running | re-review running | |
| 08 design system | design-lead | VERIFYING: D1–D5 built, 553 tests | verifier pending | review pending | |
| 09 app shell | frontend A | IN-PROGRESS | — | — | |

States: TODO → IN-PROGRESS → VERIFYING → DONE (needs VERIFY.md `Verdict: PASS` + reviewer APPROVE) · BLOCKED.

## Interruption log
- 2026-11-20: account usage limit (429) killed 8 background agents mid-run (design-lead, 6 verifiers/reviewers). All resumed after reset via SendMessage with their context. If this happens again and you are a NEW session: the agents' transcripts are gone — re-dispatch each in-flight row above with the matching `.claude/agents/*.md` and its TASK.md.

- 2026-11-20 (second hit, resets 07:40 UTC): usage limit killed the frontend wave and the backend re-verification round mid-run. In flight when killed — resume each (same session: SendMessage "continue"; new session: re-dispatch with the agent file + brief):
  - frontend A (`frontend-engineer`): 09 shell A1–A5, 01 geometry G7–G10, 05 spatial S5–S6. Barely started.
  - frontend B (`frontend-engineer`): 02 transport T8–T12, 03 forecast F4–F5, 04 budget B6–B7, 06 live L9–L10.
  - verifier 02 transport (re-verify after stats/compare rewrite, D-017); verifier 03 forecast (re-verify, D-016); verifier 06+07 (re-verify after live fix round, D-018).
  - reviewer data backends (re-review fix round); reviewer live+server (re-review fix round).
  - Not yet started: verifier + reviewer for 08 design system; reviewer for 00 scaffold; design-lead screenshot review of the full app.
  - Uncommitted on purpose: backend feature code (all of main/labyrinth_main/features/*, server/, main/tests/*), renderer/src/design/*, artifacts/*. `verify.sh all` was green before the hit. Commit backend + artifacts together once re-review approves (manifest spans all features).

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
