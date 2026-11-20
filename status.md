# Labyrinth · status

> **Single source of truth for handoff. Read this first, then `interface.md`, `architecture.md`, `decision.md`.**
> Last updated: 2026-11-20 by the maintainer (Claude Code in the owner's checkout `D:\Labyrinth`, Windows + WSL), resuming after the hand-over.
> Branch **`main`**, pushed to `github.com/bede-lau/Labyrinth` (D-021). `claude/focused-cori-6s5ucw` on GitHub is the hand-over snapshot (`f0ca8e6`).
> **Environment changed:** every command runs inside WSL through `scripts/dev.sh` — see CLAUDE.md "Running commands on this machine" and D-020.

## 0. Resume log (newest first — if a session dies, the next agent continues from the top entry)

- **2026-11-20, session 2 (maintainer).** Pushed the hand-over branch, fast-forwarded `main`. Fixed the Windows checkout (LF line endings,
  WSL toolchain, cross-platform hooks, `scripts/dev.sh`, `setup-dev.sh`, `probe-copy.sh`; D-020/D-021). `verify.sh all` green in WSL.
  **In flight (wave 1, all agents re-dispatchable from §4):** backend-engineer on §4.1 (live-GX safety tests); verifiers on the frontend
  halves of 01, 02, 03+04, 05+09 and on 08; reviewers on `renderer/src/{shell,features}` and on 00 scaffold + the D-020 scripts.
  Not started: §4.3 design review with screenshots; 06/07 re-review and re-verify (wait for §4.1).

## 1. Where the build stands (one paragraph)

The PRD is built end to end *in code*: five replay features (geometry, transport, forecast, budget, spatial) produce
deterministic, schema-valid artifacts; a live-GX orchestrator + guarded HTTP API exist (never run against Modal); the
frontend has a design system, an app shell and all six views with a test per expected outcome. **`bash scripts/verify.sh all`
exits 0 (11/11 stages) at the last code commit.** What is *not* done: external verification and review of the whole frontend and
of the design system, two open money-safety items on the live backend, and nothing live has been rehearsed. No task is `DONE`.

## 2. Task table

States: TODO → IN-PROGRESS → VERIFYING → DONE. `DONE` requires `tasks/<NN>/VERIFY.md` ending in `Verdict: PASS` that covers the whole
task (enforced by `scripts/check_docs.py`) **and** a reviewer `APPROVE`.

| # | Task | State | Backend | Frontend | Evidence / gaps |
|---|---|---|---|---|---|
| 00 | scaffold, boundary, gates | VERIFYING | n/a | n/a | Verifier run 3 **PASS** (runs 1–2 FAIL, fixed). Fixes R1/R3/R4/R5 landed *after* run 3 (commit `86a5142`+) and were not re-verified. **Reviewer never ran.** Residuals R2/R6/R7 (obfuscation-only, accepted) listed in `tasks/00-scaffold/VERIFY.md` |
| 01 | geometry | IN-PROGRESS | **PASS + APPROVE** (float64 match to stella 2.9e-13; independent verifier agreed) | built (G7–G10 tests), **unverified, unreviewed** | acceptance-129 is BLOCKED by design (D-007) |
| 02 | transport | IN-PROGRESS | **PASS (round 2) + APPROVE** | built (T8–T12 tests), **unverified, unreviewed** | all 4 PRD archive means reproduce (D-013); no window permits a claim (D-017) |
| 03 | forecast | IN-PROGRESS | **PASS (round 2) + APPROVE** | built (F4–F5 tests), **unverified** | PRD MAE not reproduced (D-008/D-016) |
| 04 | budget | IN-PROGRESS | **PASS + APPROVE** | built (B6–B7 tests), **unverified** | range fixtures carry a midpoint (interface.md §10) |
| 05 | spatial | IN-PROGRESS | **PASS + APPROVE** | built (S5–S6 tests), **unverified** | prd-reported/blocked: no checkpoints in repo |
| 06 | live GX | IN-PROGRESS | built, 58+ tests; **reviewer round 4: CHANGES REQUESTED (1 blocker, 1 major)** | built (L9–L10 tests), **unverified** | see §4 — **UNREHEARSED, never run on Modal** |
| 07 | HTTP server | VERIFYING | verifier **PASS** (round 1, before fix rounds 2–4); re-verification was cut off | n/a | re-verify after §4 |
| 08 | design system | VERIFYING | n/a | built, 553 tests; **verifier run was cut off** | screenshots in the scratchpad were reviewed by the author only |
| 09 | app shell | IN-PROGRESS | n/a | built (A1–A5 tests), **unverified** | |

Frontend outcome → test coverage: every ID A1–A5, G7–G10, S5–S6, T8–T12, F4–F5, B6–B7, L9–L10 has a named test
(`renderer/src/**/*.test.tsx`). "Has a test" ≠ verified: no external verifier has attacked any of them yet.

## 3. What was verified and how (so you can trust or re-check it)

- Backend halves of 01–05 and 07 (round 1): independent verifier re-implemented the maths in its own code (VMEC evaluator with bisection, window means, MAE, budget in Decimal), ran mutation tests on copies, and wrote `tasks/<NN>/VERIFY.md` with real output.
- Statistical gate for transport: reviewer Monte-Carlo (AR(1) at N=68/277/1000/2000): claims open only at N_eff ≳ 20, false stationarity rejections 2–4 %, TOST false-disagree ≈ 4–6 %. Result: no archive window may claim saturated agreement (D-017) — this is correct, not a bug.
- Gates themselves are tested (`scripts/tests/`, 11 tests; boundary self-test has 37 violation shapes).

## 4. Open work, in priority order (the next agent starts here)

1. **Live GX backend — close two money-safety items, then re-review and re-verify (06, 07).** Reviewer round 4 findings, *code is in, tests and re-review are not*:
   - **R1 (blocker):** `rehearse.py` must never exit with a spawned GPU call un-cancelled. Code now maps SIGTERM→KeyboardInterrupt, ignores signals while terminating, waits `wait_terminated(WORST_CASE_STOP_S+10)` per phase, prints "NOT confirmed terminated — check Modal dashboard", exits 2. **Missing: a subprocess test running the rehearse entrypoint with a late-spawn stub for SIGINT and SIGTERM** (model it on `test_H1_shutdown_during_in_flight_launch` in `main/tests/test_server.py`).
   - **R2 (major):** `modal_app.py` now raises `RuntimeError` at deploy if `startup_timeout` isn't accepted. **Missing: an AST/behaviour test for that branch.**
   - Minors with code but no tests: run-level kill switch (`progress["<run_id>/abort"]`, worker checks at start and every loop; test with a stub Dict), orchestrator hard timeout on `time.monotonic` (test with a backwards wall-clock jump), docs for a hung spawn RPC (done in `service.py` docstring).
   - Then: reviewer re-review (`.claude/agents/reviewer.md`), verifier for 06 + 07 (`.claude/agents/verifier.md`). Rules for those agents: no `modal` install, no credentials, no network, state dir under the scratchpad.
2. **Verify and review the frontend.** One verifier per task (01 G7–G10, 02 T8–T12, 03 F4–F5, 04 B6–B7, 05 S5–S6, 06 L9–L10, 09 A1–A5, 08 D1–D5), each writing the *whole-task* VERIFY.md (backend + frontend; keep the history of earlier runs). Then a reviewer on `renderer/src/{shell,features}`. Things to attack: acceptance-129 rendered BLOCKED (not passed); `stationary:null` rendered "undecidable"; every transport row says claim "not allowed" with the N_eff explanation; LIVE only when `mode==="live"`; `TERMINATE FAILED/PENDING` shown as danger even when mode is live; forecast never says "forecast = previous observed"; stella vs GENE not shown as agreeing; budget range midpoint never shown as a PRD figure; mesh seam wrapped; Plotly/Three lazy-loaded.
3. **Design review with screenshots** (`.claude/agents/design-lead.md`): build, serve `renderer/dist`, Playwright at 1440×900 and 390×844, light + dark, all six routes + `#gallery`; frontend B was in the middle of a mobile-overflow check on `#/transport` when cut off; frontend A had screenshots in the scratchpad `frontA/`. No design review of the integrated app has happened.
4. **Reviewer for 00 scaffold** and a final check that `86a5142`+ fixes hold (`verify.sh boundary`, `docs`).
5. When a task has full-task `Verdict: PASS` **and** reviewer `APPROVE`: set its `## Status` to `DONE` in `tasks/<NN>/TASK.md` and update §2.

## 5. Decisions waiting on the product owner

- **D-016 (forecast definition).** The PRD averages two ways: a sample-and-hold mean reproduces the PRD forecast scores (0.0444/0.0423) but breaks the 2.55 archive fixture; the edge-interpolated mean reproduces all four archive means but not the forecast scores. We kept one definition (D-013) and show the mismatch. If the forecast scores are the acceptance criterion, switch the forecast feature only.
- **D-017 consequence.** With archive-length windows the app never allows a "saturated agreement" claim. A live run needs ~3–5× the archive's τ-normalised window before any claim is possible.
- **D-015 guard allowances** (5 min setup, 5 min idle, $0.10 storage/egress) are assumptions; planned spend is $26.21, not the PRD's $21.83 (GPU time only). Replace with measured values after the first rehearsal.

## 6. Blockers needing a human

| Blocker | Impact | Action |
|---|---|---|
| ~~GitHub push → 403~~ **resolved 2026-11-20** | — | The owner signed in through Git Credential Manager; the maintainer pushes to `main` with the git bundled in GitHub Desktop (`%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`; `git` is not on the Windows PATH) |
| 129 saved stella samples at ρ 0.8 | PRD acceptance for "Locate the tubes" stays BLOCKED (D-007) | provide the stella `.geometry`/`.out.nc` holding them; add to `data/raw/`, pin sha256, turn the blocked check into a real comparison, tighten the schema |
| Modal credentials + GX rehearsal | live mode stays `unavailable`; fallback plays archive | follow "Live rehearsal runbook" below |
| Dommaschk GENE-X checkpoints | spatial replay stays prd-reported/blocked | provide the checkpoints |
| `ANTHROPIC_API_KEY` repo secret | `.github/workflows/claude-review.yml` is skipped; PRs are not auto-reviewed in CI | add the secret |

### Live rehearsal runbook (human; nothing here has ever been run)
1. `pip install modal==1.6.4 && modal token new`. 2. Check billed + pending on Modal's usage page, write `~/.labyrinth/ledger.json` `{"billedUsd":X,"pendingUsd":Y,"reconciled":true}`.
3. `cd main && LABYRINTH_GX_REF=<GX commit sha> modal deploy -m labyrinth_main.features.live_gx.modal_app` — **fails loudly if `startup_timeout` isn't supported; the GX image build is unrehearsed and may need fixes.**
4. `python3 -m labyrinth_main.features.live_gx.rehearse` prints the estimate (**$7.73**, hard timeout 4500 s) and launches nothing. 5. `… rehearse --confirm-cost-usd 7.73` runs init then checkpoint-continuation.
6. Reconcile the ledger again; `python3 -m labyrinth_main.server` should report `idle`; a slot is `POST /api/live/launch {"confirmCostUsd": 2.65}`. Planned total 8.10 + 2×7.73 + 2.65 = **$26.21** of the $40 ceiling. **Do this only after §4.1 is closed.**
Unverified against an installed modal 1.6.4: `cancel(terminate_containers=True)`, `startup_timeout`, `(request, limit)` tuples, `scaledown_window`, `Image.env`, `modal.is_local()`, GX TOML parameter names and build commands.

## 7. How to resume

```
# Windows checkout (this machine): everything runs in WSL, from the repo root
wsl.exe -e bash scripts/setup-dev.sh                        # once; user-local toolchain, no sudo
wsl.exe -e bash scripts/dev.sh bash scripts/verify.sh all   # must exit 0 before you start (≈2.5 min)
# Linux / CI
pip install -r main/requirements.txt && npm --prefix renderer ci && bash scripts/verify.sh
```
- **Parallel agents share one working tree.** Engineers own disjoint folders; verifiers/reviewers never mutate the tree — they
  mutate a copy from `scripts/probe-copy.sh <name>`. Only the maintainer runs `verify.sh all` as the final word, commits and pushes.
- **Agents** (`.claude/agents/`): `backend-engineer` (main/), `frontend-engineer` (renderer/), `design-lead` (design system + screenshot review), `verifier` (adversarial, writes VERIFY.md, never fixes), `reviewer` (read-only diff review). The loop that worked: engineer → `verify.sh <scope>` until exit 0 → verifier → reviewer → fix round → re-verify.
- **Always give a verifier an isolated probe plan** (own code, mutation tests on copies, real output) — every FAIL so far was found that way (13 boundary bypasses, a spoofable DONE gate, a wrong "PRD error", a 40 % stderr bias, an orphaned-GPU path).
- **Usage limits:** two limit hits killed all background agents mid-run. Agents' transcripts do not survive a *new* session — re-dispatch from §4 briefs, not from memory.
- **Stop-hook friction:** the Stop hook runs `verify.sh all` on the *shared working tree*, so parallel agents' half-finished files block the orchestrator (decision D-014 below: "wave mode" was proposed and **not adopted**). Either run agents sequentially/in git worktrees, or wait for their loops to go green.
- Never commit generated artifacts without rebuilding (`artifacts:fresh`), never edit `contracts/` without a decision entry (interface.md §9).

## 8. Interruption log

- 2026-11-20 ×2: account usage limit (HTTP 429) killed all background agents mid-run; all were resumed once, then the third interruption ended the session's build stage.
- Final in-flight work at hand-over: frontend A (shell/geometry/spatial) and B (transport/forecast/budget/live) had reached the screenshot-review stage; live backend fix round 4 (code landed, tests pending); design verifier (08) just started; no reviewer assigned to 00/08/frontend.

## 9. Commit map (local; oldest first, after the scaffold)

`80888d4` verified data backends · `b0d02a2` live GX + server (**UNVERIFIED**) · `27f77ea` design system (verification pending) ·
`407827f` frontend WIP (**UNVERIFIED**) · then this docs commit. Earlier commits: scaffold, gate hardening (3 rounds), decisions D-013…D-018, contracts incl. `live-run`.
