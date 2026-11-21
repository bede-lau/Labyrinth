# Labyrinth · status

> **Single source of truth for handoff. Read "Current state" first, then `interface.md`, `architecture.md`, `decision.md`.**
> Last updated: 2026-11-21 by the maintainer's live-comparison session (D-024) (Claude Code in the owner's checkout `D:\Labyrinth`, Windows + WSL).
> Branch **`main`**. Everything below "Current state" is history, newest first.
> Every command runs inside WSL through `scripts/dev.sh` — CLAUDE.md "Running commands on this machine" (D-020).

## Current state

**Seven of ten tasks are `DONE`; 02, 06, 09 are back in VERIFYING for D-024 (live comparison) until their verifiers re-run.** Before D-024 each had a final external-verifier run at commit `3faed3a` ending in `Verdict: PASS`, with a `PASS` row for every outcome
(`tasks/<NN>/VERIFY.md`), and the code passed the 2026-11-20 review round with all six areas approved. `scripts/check_docs.py` enforces this (D-022): any
later change to a task's owned files reopens it until a verifier runs again. `verify.sh all` at `3faed3a`: exit 0, 11/11 stages — boundary self-test
134 violation shapes, 71 gate tests, 331 backend tests, artifacts schema-valid and byte-fresh, tsc clean, 1350 frontend tests, vite build.

| # | Task | State | Verified at |
|---|---|---|---|
| 00 | scaffold, boundary, gates | DONE | `3faed3a` |
| 01 | geometry | DONE (acceptance-129 BLOCKED by design, D-007) | `3faed3a` |
| 02 | transport | VERIFYING (D-024: T13 live comparison) | was `3faed3a` |
| 03 | forecast | DONE (PRD MAE mismatch shown, D-016) | `3faed3a` |
| 04 | budget | DONE | `3faed3a` |
| 05 | spatial | DONE (PRD-reported/blocked: no checkpoints in repo) | `3faed3a` |
| 06 | live GX | VERIFYING (D-024: L11 comparison) against fakes — **never run on Modal** (§6 runbook) | was `3faed3a` |
| 07 | HTTP server | DONE | `3faed3a` |
| 08 | design system | DONE | `3faed3a` |
| 09 | app shell | VERIFYING (D-024: `liveContract.ts` validator) | was `3faed3a` |

**GitHub:** `origin/main` = `03bd626` (pushed 2026-11-20 on the owner's "Push to main"; fast-forward from `f0ca8e6`). The live-comparison work runs
in a separate session in this checkout and commits locally; push it only after its review and verification, and ask the owner first.

**Open, not blocking DONE** (details in the Session 3 log below and in each VERIFY.md "Findings"):
- **Live comparison (cross-RX-2) closed by D-024, awaiting re-verification:** live-status `comparison` (schema, `live_gx/comparison.py`, orchestrator
  snapshot, Check transport "Live comparison" panel, live-panel summary line, `liveContract.ts` validator); docs and TASK.md outcomes T13 / L11. Reviewer
  APPROVE (one round; minors RV-024-1/2/3/4/7 fixed by the maintainer, each fix probed). `verify.sh all` green. Committed locally, **not pushed**.
  Next: verifiers for 02, 06, 09 at that commit → DONE. With the committed archive every live verdict is "no claim" (D-017) — by design.
  Open: RV-024-6 (owner's call) — the comparison disappears when the session leaves `live`; option: keep the last session's comparison labelled "session
  ended". CLAUDE.md "Current stage" still names this PRD gap (left for the owner to edit).
- Minors from the final reviews (FR-FE-LIVE-1/2, design-r3-N1, RV-G21/22/23, RV-G5 part, be-live-r4-1) and the verifiers' minors (2–3 per task, mostly
  test wording and doc lines).

**Needs a human:** §5 owner decisions (D-016 forecast definition, D-015 allowances) and §6 blockers (129 stella samples, Modal credentials and the
first rehearsal, GENE-X checkpoints, `ANTHROPIC_API_KEY` for PR review in CI).

**How work is run here (lessons from sessions 2–3):** one engineer per territory, one external verifier per task, one focused reviewer per area;
the owner found multi-round adversarial panels redundant. Every agent prompt states the owner's standing authorisation (mid-run chat questions were
read by agents as a new, narrower request). Never message a running workflow agent by id (it starts a duplicate).

## Session 3 (2026-11-20, maintainer on Opus) — live log, newest first

- **Verification complete: 10/10 tasks PASS** (workflow `labyrinth-verify-all-tasks`, run `wf_19902763-abc`, 10 verifiers, 12 min, short checks as the
  owner asked: targeted test runs, one independent probe per outcome, ≤ 5 mutations per task). All ten `TASK.md` set to `DONE`; docs gate OK.
  Verifier minors: TASK.md wording (00 test rows and stage list — fixed; 01 status line — replaced), G3 printed-precision margin 0.9736 of the half-unit
  (information only; float64 agreement 2.9e-13), and per-task notes in each VERIFY.md.
- **Review round complete: all six areas APPROVED** (workflow `labyrinth-final-fix-and-review`, run `wf_293e54ad-a02`, 11 agents, 23 min).
  49 of the 50 open confirmed findings fixed (fe-features 18, gates 19, be-data 6, be-live 5, design 1); `verify.sh all` exit 0 (71 gate, 331 backend,
  1349 frontend tests; boundary self-test now 134 violation shapes). Final reviewers found no blocker/major. **Open, accepted as minor / follow-up:**
  | Item | Area | What |
  |---|---|---|
  | cross-RX-2 | be-live + fe + contract | **PRD gap:** the live comparison of new GX samples with the archive (200–300 / 300–400 means, stationarity, saturated-agreement gate) is not computed; the backend says so in `reason`. Needs a live-status contract field (decision first). interface.md §10 |
  | FR-FE-LIVE-1 | fe-live | if the Advance view crashes during an ordinary live session (no danger marker), the header offers no Terminate; the backend hard timeout (1500 s) still caps cost |
  | FR-FE-LIVE-2 | fe-live | worker-list `SectionBoundary resetKey={data}` retries and warns every poll on a persistent render error |
  | design-r3-N1 | design | DESIGN.md says Alert body/action changes "are not announced" (nested `aria-live="off"`); WebKit/VoiceOver may still announce them |
  | RV-G21, RV-G22 | gates | boundary scanner: a cwd built by a call, and `$1`/`$@`/`%~dp0` heads before `..`, are not treated as dynamic (narrow, obfuscation-adjacent) |
  | RV-G23, RV-G5 (part) | gates | test gaps: probe-copy `-ef` identity walk and setup-dev version check can be removed with tests green; ci.yml is line-checked, not YAML-parsed (no PyYAML) |
  | be-live-r4-1 | be-live | no test for the running-session branch of the unusable-ledger reason (cross-RX-7) |
- **Review run `labyrinth-review-to-approval` (wf_7a2a8d29-81f) was stopped at the owner's request** ("too redundant, shorten it") after ~2 h / 257 agents.
  Cross review: 11 findings (3 major). 42 confirmed findings were fixed. Cause of the redundancy: the owner's mid-run chat question ("why is there a
  budget plan") was relayed to the running fixers as "the user request", and most fixers (gates ×4 rounds, fe-features ×4, be-data r1/r3/r4, be-live r1)
  refused to edit, so reviewers re-raised the same findings each round. The loop also only stopped when a round had nothing to fix, so minors kept it going.
  The maintainer fixed one item directly: saved-run id pattern in both contracts (D-023 item 7).
- **Owner asked to shorten the process (2026-11-20 ~21:50):** no more skeptic panels or multi-round loops; one short fix+review round, then one verifier
  per task with at most one fix round.

- **Wave 3 done (workflow `labyrinth-wave3-leftovers`), committed locally, NOT reviewed yet.** `verify.sh all` exit 0: 59 gate, 274 backend,
  1164 frontend tests; the renderer suite now takes ~35 s (was ~150 s: vitest `vmThreads`, F13).
  | Agent | Result |
  |---|---|
  | backend data + contracts | D-023 items 1–6 implemented and tested (contracts, producers, regenerated artifacts; ajv and jsonschema agree) |
  | backend live-GX | LV-1…LV-10 closed: "terminated" wording follows the round-6 invariant everywhere; signal-test race fixed (30/30 ×2 loops); tests robust to an inherited SIG_IGN; R14/R15/S02/S04–S06/S09 killed; every 409 carries status; 405 + `Allow`; shutdown print/exit race; idle shutdown immediate |
  | design-lead | danger primitive (`billing-risk` status + `Alert`), text-only non-http sources, `Unit` in badge, unsampled label above the grid (`unsampledShapes`), `FixtureCheck` for ranges/basis (24-combination matrix); 26/26 mutants killed |
  | frontend A | FA-1…FA-9: `Alert` for every billing-risk state on every route, round-6 strings classified, `live` badge prop, launch lock (`launchPhase`; 409 re-enables on the next snapshot), vitest pool, closed saved-run validator; 96/96 mutants killed |
  | frontend B | FB-1…FB-8: D-023 consumed (ranges via `FixtureCheck`, `guardPlan` from the artifact, `basis` from data, spatial fixtures drive pills/tallies, geometry `float64Reference`); 43/43 mutants killed |
  | docs | interface.md §1–§10 and architecture.md rewritten against the code |
  Known open, carried into the review round: saved-run id pattern is stricter on the server (`^(rehearsal|live)-[0-9a-f]{12}$`) than in `live-run.schema.json` /
  `live-status.schema.json` / `renderer/src/lib/liveContract.ts` `SAVED_RUN_ID` (`^[A-Za-z0-9_.-]{1,80}$`); DESIGN.md §5 says stop-unconfirmed is "not in the store yet" (it is)
  and lacks the panel-only "LAUNCH NOT CONFIRMED" alert; `POST /api/live/runs/*` answers 404 (since fixed: 405 `Allow: GET` for a served id).
  Process note: messaging a running workflow agent by id started a duplicate copy; it was stopped (memory note added).
- **Decided this session:** D-023 (contract tightenings, closes interface.md §10). Launch after a 409 re-enables on the next fresh snapshot that allows
  launching (nothing was launched); after a 202 it stays disabled until the mode changes.
- **Plan after the workflow:** maintainer `verify.sh all` + commit → review workflow (frontend shell/lib/live, frontend features, design system,
  scripts/gates, backend live-GX, backend data/contracts; each finding adversarially verified; fix → re-review until APPROVE) → push to `main` (D-021)
  → verification workflow (every task 00–09 on the committed tree, D-022 format) → mark DONE → commit, push.

## History — session 2 hand-over (superseded by "Current state")

The owner stopped session 2 because the usage budget was nearly exhausted. **Nothing is half-dispatched: no agent is running.** No task is `DONE`.
**`verify.sh all` exits 0 at the wave-2 commit** (11/11 stages: 59 gate tests, 205 backend tests, 1017 frontend tests, artifacts byte-identical, build OK) — green gates are
not verification: wave 2 has had **no reviewer and no verifier** yet.

**Where the code is.** `origin/main` = `f0ca8e6` (the hand-over snapshot). Everything from session 2 is in **local commits on `main`, not pushed**
(`2b1607e` environment, `c6244ec` wave 1, then the wave-2 commit at HEAD — `git log --oneline -5`). They are unpushed because D-021 says "push only after
green gates **and** reviewer approval" and the wave-2 re-reviews have not run. **Ask the owner before pushing unreviewed work**, or finish step 1–3 below and push then.

**What session 2 did.** Fixed the Windows checkout (D-020). Wave 1: 9 agents (results table in §0). Wave 2 fix round: see "Wave 2 results" just below.
All open findings are tabulated in §4a (frontend review), §4b (design review), §4c (scaffold review), §4d (verifier findings), §4e (backend review round 5).

**Next steps, in order** (each is one agent; briefs can be written straight from the tables named):
1. **Finish what wave 2 left open** — the "NOT done" lists in "Wave 2 results" below. Engineers: frontend A (`renderer/src/{shell,lib,features/live-gx}`), frontend B
   (`renderer/src/features/{transport,forecast,budget,spatial,geometry}`), backend (`main/`). The design system and the gates are finished.
2. **Maintainer:** `verify.sh all` must exit 0; commit. Update `interface.md` §3/§5 and `architecture.md` "Live GX" from the stale-docs list at the end of §4e and from the engineers' API notes.
3. **Re-review** (reviewer agent, read-only): (a) frontend diff `c6244ec..HEAD -- renderer/src/{shell,lib,features}`; (b) design system diff `-- renderer/src/design`;
   (c) `scripts/` + `.github/` diff (scaffold round 2, SC-1…SC-9 and the maintainer's SC-10…SC-13); (d) live-GX backend round 6 `-- main/`. Fix rounds until each says `APPROVE`.
4. **Push to `main`** once (2) is green and (3) approved.
5. **Verify** (verifier agent, one per task, on the **committed** tree — the docs gate now checks the commit, see below): 02, 04, 08, 09 failed in wave 1 and need a full new run;
   06 needs its first whole-task run (L1–L10); 07 a run on the round-6 backend; 01, 03, 05 passed in wave 1 but their owned files changed in wave 2, so they need a new run too (the gate's currency rule);
   00 needs a run after the scaffold re-review.
6. For each task with a current whole-task `Verdict: PASS` **and** reviewer `APPROVE`: set `## Status` to `DONE` in `tasks/<NN>/TASK.md`, update §2, commit, push.
7. Owner decisions still open: §5 (D-016 forecast definition, D-015 allowances) and the `claimedRange` / `acceptance129: const blocked` contract tightenings in `interface.md` §10
   (each needs a `decision.md` entry before `contracts/` is touched). Blockers needing a human: §6 (129 stella samples, Modal rehearsal, GENE-X checkpoints, `ANTHROPIC_API_KEY`).

**Docs gate changed in wave 2 (decision D-022) — verifiers must write VERIFY.md in this shape or `DONE` is refused:**
a line `Verifier run: <date>, commit <sha>` naming the **committed** tree that was verified; an outcomes table whose header ends in `| Result |` with one row per outcome ID in TASK.md,
each Result cell starting with `PASS`; and the file's last non-blank line exactly `Verdict: PASS`. The task's owned files (backticked paths under `## Owner`) must be unchanged between that commit and the working tree.
`.claude/agents/verifier.md` describes the format.

**How to run things here** — CLAUDE.md "Running commands on this machine". Traps that cost time in session 2:
- The project's named agents (`backend-engineer`, `verifier`, …) had **no shell tool** in a session started before their `tools:` line gained `PowerShell`. Probe one first
  ("list your tools"); if it says no shell, dispatch `general-purpose` agents told to act as `.claude/agents/<role>.md` (that is how every agent in session 2 ran).
- **The Stop hook runs `verify.sh all` on the shared tree.** While several agents are testing, it fails with "Failed to start forks worker" (CPU contention, zero failing tests) and adds load.
  Do not end the turn while a wave is running: stay in the turn and wait for the agents' reports. `scripts/dev.sh` caps `VITEST_MAX_WORKERS` at 4 for the same reason.
- Never run `npm ci` or `scripts/setup-dev.sh --force`-style reinstalls while agents are testing: it empties `renderer/node_modules` under them (`setup-dev.sh` now skips it when current).
- Verifiers and reviewers mutate only an isolated copy: `wsl.exe -e bash scripts/probe-copy.sh <name>`. Engineers own disjoint folders in the shared tree.
- Commit with a message **file** (`git commit -F <file>`): PowerShell mangles quotes in `-m` here-strings. `git` for commits/pushes is GitHub Desktop's
  (`%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`); a push that needs a new sign-in must run in the owner's terminal.
- Headless screenshots: Edge (`msedge.exe --headless=new --screenshot=…`); a true 390 px layout needs DevTools device emulation (plain `--window-size=390` lays out at ~500 px).
  Serve the build with `wsl.exe -e bash scripts/dev.sh npm --prefix renderer run preview -- --host 127.0.0.1 --port 4173`.

### Wave 2 results (fix round on top of `c6244ec`)

| Agent | Result |
|---|---|
| gates engineer (`scripts/**`, `.github/`) | **done.** SC-1…SC-9 closed; `test_gates.py` 19 → 59 tests; all 12 reviewer mutations + 14 more go red. Boundary scanner rewritten as an allow-list (98 violation shapes, 25 clean shapes; OS-independent; full scan 0.36 s native / 1.1 s WSL, was 51 s). New DONE rules = D-022. `ci.yml` `fetch-depth: 0`; `claude-review.yml` valid. **Not re-reviewed.** Residuals: main side is still a `renderer`-name rule; variable/concatenation obfuscation (R7) unchanged; "every change reviewed" has no mechanical gate under D-021 |
| design-lead (`renderer/src/design/**`) | **done**, `verify.sh renderer` exit 0. 08 findings F1–F12 and DS-1, DS-7, DS-13, DS-14, DS-17, DS-18, DS-21 (gallery) fixed, each with a test; 49/49 mutations red. Contrast now: text 4.81 light / 4.77 dark, non-text 3.14 / 3.10; min CVD ΔE00 16.42 / 15.50. **Not re-verified, not re-reviewed.** Open: F13 (vitest worker flake; `vite.config.ts` is engineer A's), a gridline can cross the vertical "unsampled" label, badge "Units" line prints raw `Q_gB` |
| frontend A (`shell/`, `lib/`, `features/live-gx/`, `main.tsx`, `vite.config.ts`) | **done, wrapped up early.** FE-1…FE-8, FE-10, FE-12, FE-11 (live-gx + ModeIndicator), every 09 row of §4d, DS-5, DS-10, DS-21 (Advance). Tests carry the IDs ("A2 danger…", "FE-5…", "L9…", "L10…"). **Open:** mutation proof cut off (37 mutants red; LiveView/model and vite mutants never ran; the sticky-LIVE test in `lib.test.tsx` was rewritten after its mutant survived and not re-checked); after a refused launch (409) Launch stays disabled until the mode changes (reload to retry) — confirm that is wanted; `LiveView.tsx:169` must pass `ProvenanceBadge`'s new `live` prop; no danger pill/alert primitive exists in the design system; `DESIGN.md` §5 and `interface.md` §3–4 need the new API. `shell/liveFetch.ts` was deleted (backoff moved into the store) |
| frontend B (five feature folders) | **done, wrapped up early.** All 02/03/04/05 rows of §4d, FE-9, FE-11, A3 error branches, DS-1/2/3/4/6/8/9/11/12/13/15/16/19/20, and the six geometry test gaps from the 01 verifier (real `three` in `FluxScene.test.tsx`, lazy-load guards). 78 of 88 mutants run, all red. **Open:** `budget/model.ts` `GUARD_PLAN_D015` still constants (flagged when the live estimate differs; removal needs a contract field); `geometry/model.ts` `float64Match` still parses prose (no artifact field); `claimedRange` contract untouched (a missing range shows "unavailable"); `design/components/ProvenanceBadge.tsx:130` still links `PRD.md` (design-lead's file) |
| backend round 6 (`main/`) | **done.** BE-1…BE-7 fixed, each seen failing under mutation; 205 backend tests. Invariant: "terminated" only after a cancel that succeeded; **a kill-switch-only stop is never `ok: true`** — 502, exit 2, unconfirmed until the server restarts. Contract untouched; new/changed `reason` strings: `kill switch raised, stop not confirmed: …`, `… kill switch could not be set: …` (under `TERMINATE FAILED`), pending reasons ending `the run kill switch is raised` / `could NOT be set (…)`, prefix `Stop requested; terminating workers — not confirmed yet.`; launch 409s `…to the cent (got …)` and `The ledger could not be updated (…)`. **Not re-reviewed.** |
| verifier 06 (L1–L8) + 07, on `c6244ec` (before round 6) | **07 FAIL (H5)**, **06 FAIL (L6; L9–L10 not checked)** — both for BE-1, which round 6 has since fixed. L1–L5, L7, L8 and H1–H4, H6 pass. 163 mutations: 126 red, 13 by hang, 24 survived. **Findings that round 6 was not asked to fix** (give them to the backend engineer): `orchestrator.py:325-326,432` says "terminated" before any cancel returns (check against the new invariant); flaky signal tests `test_server.py:545-548`, `:338-341` (loop 29/30) and three tests that fail when SIGINT is inherited as ignored (`test_server.py:496-524`); weak tests with surviving mutants R14, R15, S02, S04, S05, S06, S09 (`rehearse.py:87,90`, `service.py:86-91,203,254`); 409 without `status` (`app.py:148-152`); 501 instead of 405 (`app.py:161`); exit-status race and unguarded print (`server/__main__.py:54-58`); `budget_guard.py:115`; idle 507 s shutdown (`service.py:284-297`) |

**Design-system changes the frontend engineers must absorb (from the design-lead's report):**
- `ProvenanceBadge`: kind `live` renders "Recorded run" (replay pill) unless the caller passes the new `live` prop. **`features/live-gx/LiveView.tsx:169` must pass it**, or its badge reads "Recorded run" even when live.
- `FixtureCheck`: notes moved from `.lab-fixture__label` to `.lab-fixture__notes` after the outcome; long notes get `data-clamped` + a "Show full note" button; root gains `data-basis`; new `basis="arithmetic"` prop
  (use it for arithmetic-only checks on PRD-reported inputs: Spatial 1.27×, Budget 46,368 — DS-13 call sites are engineer B's); no unit after "—".
- `plotLayout`: overrides deep-merge; optional third argument `{narrow}`; at ≤ 640 px the legend sits below the plot.
- `.lab-panel__body` is a container-query container; `.lab-seg` wraps instead of scrolling. `plot.windowEdge` is now hex; new `plot.unsampledAlpha`, icon `equals`, export `provenanceStatus`.
- `npm run tokens` also rewrites `DESIGN.md` §12.

## 0. Resume log (newest first — if a session dies, the next agent continues from the top entry)

- **2026-11-20, session 2 (maintainer).** Pushed the hand-over branch, fast-forwarded `main`. Fixed the Windows checkout (LF line endings,
  WSL toolchain, cross-platform hooks, `scripts/dev.sh`, `setup-dev.sh`, `probe-copy.sh`; D-020/D-021). `verify.sh all` green in WSL.
  **Wave 1 finished** (9 agents; results in the table below, findings in §4a–4d and each `tasks/<NN>/VERIFY.md`).
  **Wave 2 in flight (fix round; every agent is re-dispatchable from §4a–4d):** frontend-engineer A (`shell/`, `lib/`, `features/live-gx/`: FE-1…8, FE-12,
  09 findings, DS-5, DS-10) · frontend-engineer B (`features/{transport,forecast,budget,spatial,geometry}`: 02/03/04 findings, FE-9, FE-11, feature-side DS items) ·
  design-lead (`design/**`: 08 findings F1–F13, DS-1, DS-7, DS-13, DS-14, DS-17, DS-18) · gates engineer (`scripts/**`: SC-1…SC-8) ·
  reviewer on the live-GX backend round 5 · verifiers on 06 backend outcomes and on 07.
  **After wave 2:** maintainer runs `verify.sh all`, commits, pushes; then delta re-verification of 02, 04, 08, 09, whole-task 06, re-review of the frontend and of `scripts/`.

  | Wave 1 | Result |
  |---|---|
  | backend-engineer §4.1 | done, `verify.sh main` exit 0, 127 tests. **R1 was not actually fixed** (a signal during a spawn RPC dropped the handle: exit in 0.02 s, call never cancelled) — now cooperative stop flags; also fixed: double signal on the server skipped `shutdown()`, SIGHUP killed both entrypoints, kill switch not raised for a client-side spawn error, `WORST_CASE_STOP_S` 255 → 497 s. 24 in-place mutations all went red |
  | verifier 01 geometry | still running at the time of writing |
  | verifier 02 transport | **FAIL — T9 only** (T1–T8, T10–T12 pass; 21/35 mutations red) |
  | verifier 03 forecast | **PASS** (weak tests on F4–F5; 12/18 mutations red) |
  | verifier 04 budget | **FAIL — B7** (fixture rows illegible at 1024–1920 px = DS-1) |
  | verifier 05 spatial | **PASS** |
  | verifier 08 design system | **FAIL — D2** (Plotly modebar focus ring 1.20:1 in dark); D1, D3, D4, D5 pass with test gaps |
  | verifier 09 app shell | **FAIL — A2, A4** |
  | reviewer frontend | CHANGES REQUESTED (§4a) |
  | reviewer 00 scaffold + `2b1607e` | CHANGES REQUESTED on both (§4c); SC-10, SC-12, SC-13 and the setup half of SC-11 already fixed by the maintainer |
  | design-lead review | FIX FIRST (§4b) |

## History — build state at the session-1 hand-over (sections 1–4 below are historical; everything in them is closed or listed in "Current state")

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
- Gates themselves are tested (`scripts/tests/test_gates.py`; the boundary self-test plants every known violation shape — counts are printed by the `scripts:tests` and `boundary:self-test` stages, not repeated here).

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

### 4a. Open review findings — frontend round 1 (reviewer, 2026-11-20: **CHANGES REQUESTED**; all confirmed with probes)

Fix owner: frontend-engineer. Each fix needs a test that fails without it. Not started until the wave-1 verifiers finish (they are testing this tree).

| # | Sev | Where | Defect → fix |
|---|---|---|---|
| FE-1 | **blocker** | `features/live-gx/model.ts:87-90`, `LiveView.tsx:173-184` | `statusTerminateFailure` only matches `startsWith('TERMINATE FAILED')`; backend also sends `TERMINATION PENDING — … GPUs may still be billing` (mode `fallback`/`live`) → no alert. Match both markers with `includes`, title the alert from the marker, test both in live and fallback |
| FE-2 | major | `shell/ModeIndicator.tsx:19-46` | no danger state in the global indicator: `live` + `TERMINATE FAILED` shows a plain LIVE pill; non-live + marker shows "Replay · $0". Add a danger pill + `role="alert"` in the shell whenever either marker is present |
| FE-3 | major | `live-gx/model.ts:92-93`, `LiveView.tsx:124,186-194` | `canTerminate` false whenever status isn't `ready`: after a 502 and one failed poll "Retry terminate" is disabled; live→unreachable silently reads "Replay · $0". Keep Terminate enabled from the last known non-idle snapshot / failed terminate; on ready→unreachable show "connection lost, session state unknown" |
| FE-4 | major | `lib/liveStatus.ts:43-59` | no timeout/abort/in-flight guard/ordering: a hung backend leaves LIVE on frozen data forever and stacks requests; a slow older answer overwrites a newer one. `AbortController` timeout < interval → `unreachable`; drop out-of-order responses |
| FE-5 | major | `shell/App.tsx:37-38`, `shell/liveFetch.ts:22-26`, `LiveView.tsx:105`, `TransportView.tsx:45`, `BudgetView.tsx:37` | four independent pollers, only the header backs off (60 s) → header says Replay while Advance shows idle and allows launch. One shared status store |
| FE-6 | major | `live-gx/model.ts:110-124`, `LiveView.tsx:343-349,377-383` | clock/overlap claims not evidence-based: frozen worker still reads "Clock advancing"; "executing concurrently" derived from `state` alone (counts `initializing`) and shown beside the same-device warning; empty `deviceId` before first poll → false "same device" warning. Timestamp readings per poll; claim overlap only for two `running` workers with distinct non-empty IDs. `LiveView.test.tsx:141-142` locks in the clock defect |
| FE-7 | major | `LiveView.tsx:123,127-141,236-238,317` | launch not guarded after POST or in the dialog: button re-enables on the stale `idle` snapshot (second POST possible; backend answers 409); dialog stays confirmable after `slotFits:false`. Apply the response `status` / refetch, stay disabled until mode changes, close the dialog when `!canLaunch` |
| FE-8 | minor | `LiveView.tsx:68,90` | raw `fetch` to `/api/live/{runs,launch,terminate}` outside `lib/liveStatus.ts`; saved run cast unvalidated → move to lib with shape checks |
| FE-9 | minor | `TransportView.tsx:281` | `href="PRD.md"` resolves to the app shell → render non-http sources as text |
| FE-10 | minor | `vite.config.ts:20-23` | `startsWith(ARTIFACTS)` admits sibling `artifacts-*`; `GET /artifacts/` pipes a directory (EISDIR) → `path.relative` check, `isFile()`, stream error handler |
| FE-11 | minor | `ForecastView.tsx:278`, `SpatialView.tsx:74,231-234`, `live-gx/model.ts:56-59`, `ModeIndicator.tsx:36`, `budget/model.ts:81-88` | hard-coded narrative the data cannot change (mismatch callout, PRD-reported pills and "4/4", "Worker failed" for a hard timeout, D-015 constants beside a live estimate) → derive from data |
| FE-12 | minor | `shell/App.tsx:42-44` | route change moves no focus and announces nothing |

Test gaps named by the reviewer: A2 (no danger/backoff case), A3 (transport/forecast/budget error branches), G7/G9 (adapters fully mocked), T9 (only one direction; assertions behind `if`), L9 (no TERMINATION PENDING / stalled clock / live→unreachable), L10 (no double-submit / stale dialog; `launching`/`terminated` missing).
Checked and fine: seam wrap, acceptance-129 source, `stationary:null` → "Undecidable", data-driven claim text, no range midpoints, no double conversion, forecast wording, Plotly/Three cleanup, no `dangerouslySetInnerHTML`, `savedRunId` validated.

### 4b. Open design findings — first design review of the integrated app (design-lead, 2026-11-20: **FIX FIRST**)

56 screenshots (7 pages × 1440/390 × light/dark, headless Edge with device emulation; WebGL rendered in software). Fix owner: design-lead for
`renderer/src/design/**` and `shell/*.css`, frontend-engineer for feature views. Fixes marked *(tested)* were tried by CSS injection.

| # | Sev | Page / viewport | Defect → fix |
|---|---|---|---|
| DS-1 | major | Budget 1440 (also Spatial "Speedup") | `FixtureCheck` and `.bg-range` collapse inside 453 px cards (labels one word per line, overprint, 33 px h-scroll, page 5,516 px tall) → `design/components/components.css` + `features/budget/budget.css`: `.lab-panel__body{container-type:inline-size}` and turn the `@media (max-width:640px/560px)` blocks into `@container` *(tested: 3,090 px, no overflow)* |
| DS-2 | major | Transport 390 | page scrolls sideways (scrollWidth 661): `.lab-visually-hidden` spans escape `.tr-table-wrap` → `transport.css`: `.tr-table-wrap{position:relative}` *(tested)*; same for `.fc-table-wrap` |
| DS-3 | major | Transport both | no verdict above the fold ("claim not allowed" at y≈1060, 5.79 vs 2.55/2.68 at y≈1930) → `TransportView.tsx`: open with a Stat strip (stella 2.242, GENE 2.474, Δ, 5.79 PRD-reported beside 2.55/2.68 with Δ, blocked pill "Saturated claim: not allowed"); move `.tr-grid` above Window statistics |
| DS-4 | major | Forecast both | first viewport is a table of dashes; MAE mismatch at y≥973 → `ForecastView.tsx`: render "Final scores" first |
| DS-5 | major | Shell nav 390 | active tab off-screen on Forecast/Spatial/Budget, no scroll cue → `shell/App.tsx`: `scrollIntoView({inline:'center',block:'nearest'})` on `[aria-current=page]` on route change; `shell.css`: edge-fade mask on `.shell-nav` |
| DS-6 | major | Transport table 390 | 788 px table in a 322 px well hides Stationarity and claim columns → `transport.css` ≤640 px: `thead{display:none}`, each `tr` a two-column grid, claim cell first, `td::before{content:attr(data-label)}` |
| DS-7 | major | Fixture rows 390 (Forecast, Transport) | ~30 lines of note precede the numbers, duplicated in both mismatch rows → `components.css` narrow layout `.lab-fixture__label{order:2}`; `FixtureCheck.tsx`: note inside `<details>` |
| DS-8 | major | Locate both | acceptance-129 BLOCKED sits at y≈1331/2729; above the fold only an unlabelled "Blocked" pill → `GeometryView.tsx:62`: `<StatusPill status="blocked">129-sample acceptance blocked</StatusPill>` plus a `passed` pill "ρ 0.7 check verified" |
| DS-9 | minor | Transport chart 390 | window labels "200–300"/"300–400" overprint → `transport/model.ts:256`: alternate `label.textposition` top left / bottom left |
| DS-10 | minor | Header | 212 px at 1440, 266 px at 390 (32 % of viewport) → `shell.css`: `max-width:none` on `.shell-header__question`, `__sub`, `.shell-mode__detail`; ≤760 px hide `.shell-mode__detail` |
| DS-11 | minor | Transport chart | the 8.2 transient sets the y-range, the 0.23 stella–GENE gap is ~6 px → `model.ts:289`: `range:[0,4.5]` + annotation "transient peak 8.2 clipped; double-click to autoscale" |
| DS-12 | minor | Discrepancy panel | 5.79 / 2.55 / 2.68 wrap 2+1, deltas are prose → `transport.css`: `.tr-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}`, each Δ under its archive Stat |
| DS-13 | minor | Honest states | arithmetic-only checks on PRD-reported inputs (Spatial 1.27, Budget 46,368) get the same green "✓ Match" as data-backed ones → `FixtureCheck.tsx`: `basis="arithmetic"` prop → "Arithmetic consistent", dashed neutral edge |
| DS-14 | minor | All charts | axis titles 14 px with no standoff: `plotLayout` in `design/plotTheme.ts` shallow-merges `xaxis`/`yaxis`, dropping `title.font` and `standoff` → merge `title` one level deeper |
| DS-15 | minor | Cross-section inset | SVG text scales with width (14 px at 1440, 11 px at 390) → `geometry.css`: `.geo-inset__svg{max-width:320px}` |
| DS-16 | minor | Transport pills | `.tr-claim` is a hand-rolled pill, same reason in six rows; two "Archive ✓ Verified ›" badges unlabelled → use `StatusPill`, state the reason once in the callout, prefix each badge with its series name |
| DS-17 | minor | Typography | captions/callouts/fixture notes >200 chars per line at 1440; raw `N_eff`, `Q_gB,i`, `B_ref` in visible text → `max-width:100ch` on `.tr-figure__summary`, `.lab-callout__body`, `.lab-fixture__note`, `.lab-panel__footer`; route strings through `Unit` |
| DS-18 | minor | Accessibility | `<summary>` targets 16 px tall; SegmentedControl focus ring clipped by `.lab-seg{overflow-x:auto}` → `summary{min-height:24px;display:inline-flex;align-items:center}`; `.lab-seg{overflow:visible}` + `outline-offset:2px` *(tested)* |
| DS-19 | polish | Budget | fourth card orphaned (`minmax(min(100%,560px),1fr)` in `.bg-grid`); money columns left-aligned (`text-align:right` in `.bg-compare__row`) |
| DS-20 | polish | Spatial | ranks use `--lab-series-stella/gene` (`spatial.css:6–7`) and read as stella/GENE → neutral rank tokens |
| DS-21 | polish | Advance / Gallery | replay banner has no icon; "Replay · $0" twice in one panel; "latest Q" has no unit; Gallery switch says "System" where the app says "Auto" |

Do not regress: the state language (dashed = not backed by data, LIVE is the only solid pill, "Replay · $0" global and per panel); the dark theme
(charts, 3D scene, tints, focus rings follow tokens); blocked/mismatch callouts that name the missing input and the unblock step.

### 4c. Open review findings — 00 scaffold + commit `2b1607e` (reviewer, 2026-11-20: **CHANGES REQUESTED** on both; every item reproduced in a probe copy)

Fix owner: maintainer (`scripts/` is orchestrator-owned). Holding and fine: R1 literal spellings, R3 non-test files, R4, R5; `verify.sh all` = 11 stages; `ci.yml`; `.gitattributes`.

| # | Sev | Where | Defect → fix |
|---|---|---|---|
| SC-1 | major | `scripts/hooks/stop_verify.sh:33-42` | Stop gate switches itself off when git fails (HEAD `none`, tree "clean"): after one green run a failing verify exits 0 forever → on git failure skip the shortcut and never write `last_green_head` |
| SC-2 | major | `scripts/check_boundaries.py:94-109` | deny-list beaten by a wildcard: `import.meta.glob('/../*/pyproject.toml',{query:'?raw',eager:true})` in `renderer/src` passes scan, hook, tsc and `vite build`, and backend text lands in the bundle → strict allow-list for any `/`-rooted or cwd path leaving `renderer/` |
| SC-3 | major | `check_boundaries.py:43-44,98,157` | running the other side is invisible: `"prebuild": "cd ../main && python3 -m labyrinth_main.build_artifacts"` in a renderer `package.json`; `subprocess.run("npm --prefix ../renderer run build", shell=True)` / `os.system("cd ../renderer && …")` in main → match path tokens inside strings, flag `labyrinth_main.`, end `RENDERER_PATH` on a word boundary |
| SC-4 | major | `check_boundaries.py:37-39,64-69,177` | unscanned files: `SKIP_DIRS` applies at any depth (`renderer/src/features/coverage/leak.ts`, `…/dist/leak.ts`, `main/labyrinth_main/dist/p.py`); `readFileSync('../main/…')` in `renderer/src/test/setup.ts` or `renderer/tools/gen.mjs`; `.sh`/`.py` under renderer and `.js`/`.sh` under main → skip only top-level build dirs, scan every text file, cwd-resolve node-side files |
| SC-5 | major | `scripts/check_docs.py:45-49` | DONE without a genuine final PASS: after an older `Verdict: PASS`, a final `Verdict: FAILED`, `**Verdict: FAIL**`, `Verdict: PARTIAL` or `- Verdict: FAIL` passes; verdicts that predate later fix rounds pass; "Frontend not verified" dodges the phrase list → any `Verdict` line that is not exactly PASS fails; record the verified commit and fail when the task's files changed since |
| SC-6 | major | `scripts/tests/test_gates.py` | 12 of 12 mutations survive (e.g. `FAILED=1` deleted from `verify.sh`, final `exit 2`→`1`, `boundary:scan` / `artifacts:fresh` stage deleted, sha256 comparison removed, settings.json Stop path misspelt, `PowerShell` matcher removed) → test a failing stage (`PYTHON=false verify.sh docs` → 2), the stage list, `validate_artifacts.py`, the last-green shortcut, and execute the settings.json commands |
| SC-7 | minor | `validate_artifacts.py:43,56`, `check_docs.py`, `verify.sh:21` | exit codes other than 2: truncated manifest/artifact → 1; non-UTF-8 VERIFY.md → 1; `check_docs.py --bogus` → 0; `PYTHON=true verify.sh boundary` with a planted violation → 0 |
| SC-8 | minor | `validate_artifacts.py:68-69` | `artifacts/sub/handmade.json` and `artifacts/helper.ts` pass schema and fresh, and `copyArtifacts` ships them → compare recursive file sets; `.json` only |
| SC-9 | minor | `.github/workflows/claude-review.yml:9` | `secrets` in a job-level `if` is not allowed by GitHub; under D-021 (no PRs) it never triggers — "every change reviewed" has no mechanical gate |
| SC-10 | major | `scripts/probe-copy.sh:19-22` | `rm -rf "$DEST"` has no containment check: `LABYRINTH_PROBE_DIR=<repo parent> probe-copy.sh <repo dir>` wipes the repo; `npm ci` inside a copy empties the shared `node_modules` through the symlink → refuse a DEST overlapping ROOT, delete only marker-stamped dirs, link packages individually |
| SC-11 | minor | `.claude/settings.json:9,20` | both hooks need a native Windows `python3`; without it the Stop command exits 1 (non-blocking) and setup never checks. The native PostToolUse hook misses WSL-absolute shapes (`/mnt/…/main/…`, `/@fs`, `file://`) that the WSL gate catches |
| SC-12 | minor | `scripts/hooks/stop_launcher.py:33-43` | release only on `OSError`; a broken WSL returns 4294967295 → 2 forever |
| SC-13 | minor | `scripts/setup-dev.sh:24-26,42-49` | uv is an unpinned, unchecked `curl \| sh` and wrote `~/.config/uv/uv-receipt.json` outside the tools dir; Node checksum comes from the tarball's own origin and `latest-v22.x` floats; an interrupted extract leaves `bin/node` so re-runs skip Node → pinned versions + pinned hashes, extract then `mv` |
| SC-14 | minor | docs | stale counts: §3 "11 tests" (now 19), `tasks/00-scaffold/TASK.md` "6 planted violations" (37) |

### 4d. Open verifier findings — wave 1 (details, real output and mutation lists are in each `tasks/<NN>/VERIFY.md`)

| Task | Sev | Where | Defect → fix |
|---|---|---|---|
| 02 | **blocker** | `features/transport/model.ts:106` | four `stationary:null` rows render "Undecidable (test indicates stationary; indicative only)" (against interface.md §2 item 4) → plain "Undecidable"; assert exact cell text |
| 02 | major | `TransportView.test.tsx:98,127,135,165-173`, `TransportView.tsx:107-116` | claim verdict only ever seen as "not allowed" (add synthetic allowed/true/false rows); not-live case is `idle` only (parametrise all modes + unreachable); "PRD-reported" accepted anywhere in the card (scope to the 5.79 group); "not shown to agree" callout untested |
| 02 | minor | `TransportView.test.tsx:66-70,136,159-161`, `model.ts:25-29,176-185`, `PlotlyChart.tsx:17`, `TransportView.tsx:145-146`, `ProvenanceBadge.tsx:74` | plotted Q unasserted; "±0.00" passes; triangular segment on the bean plot passes; bands hard-coded; Δ sign and mixed windows unstated; no gate protects lazy loading; ≈/— key vanishes once a claim is allowed; latent "Live" pill from artifact provenance |
| 03 | major | `ForecastView.test.tsx:30-63` | no-peeking asserted only for the current row → assert every row in every phase or unit-test `visibility()` (mutations FM2/FM2b at `model.ts:65` and FM15 at `ForecastView.tsx:102` survive) |
| 03 | minor | `ForecastView.tsx:112,116,256` | crashes on `steps: []` (schema allows it) → empty state; "Failed" badge and "can differ" wording unpinned |
| 04 | **blocker** | `budget.css:6,109,130`, `design/components/components.css:221,275` | = DS-1 (label column 0 px inside cards at 1024–1920 px) |
| 04 | major | `BudgetView.test.tsx` (e.g. `:88`) | only the committed artifact is exercised → test with a modified artifact (outside range, `matches:false`/`null`) + header and badge assertions (BM7: PRD/Guard headers swapped survives) |
| 04 | minor | `BudgetView.tsx:199-203,267-269`, `budget/model.ts:81-88` | "Both plans stay inside" is fixed text; $18.17 under "Claimed (PRD)" (`claimedLabel`); midpoint rendered if the range text disappears (`claimedRange` contract field, interface.md §10); guard plan duplicated from D-015 |
| 05 | minor | `spatial/SpatialView.test.tsx:64-93`, `SpatialView.tsx:74,231` | test ignores honesty wording and a 3-of-4 tally; pills hard-coded (= FE-11) |
| 08 | **blocker** | `design/plotTheme.ts:164`, `tokens.ts:406` | Plotly modebar focus ring stays `1px #000`, 1.20:1 in dark, on every chart → themed `.modebar-btn:focus-visible` rule + test |
| 08 | major | `components/components.test.tsx:94`, `noHardcodedColors.test.ts:19,22` | "not colour alone" test passes when `failed` renders "✓ Verified" (assert unique label + icon per kind); colour scan covers only `src/design` and no named colours (walk `renderer/src`) |
| 08 | minor | `designDoc.test.ts:39`, `tokens.ts:152,181,222,254`, `components.css:221-222,291,315`, `plotTheme.ts:143,271`, `Gallery.tsx:139`, `gallery.css:42-47`, `DESIGN.md:151,237`, `vite.config.ts:55` | doc test checks 7 of 17 tokens one way; dark LIVE fill 2.70–2.90:1 on hover/raised, window edge 1.90/2.68, dashed borders 1.86:1; segment focus ring clipped (= DS-18); FixtureCheck columns/baselines misaligned; "unsampled" label clipped, modebar over legend at 390; gallery-only layout; doc inaccuracies; untested ArrowUp/Down, outside-click, tabular uncertainty; vitest worker flake |
| 09 | **blocker** | `shell/ModeIndicator.tsx:20-22`, `live-gx/model.ts:87-90` | = FE-1/FE-2 → shared `terminationProblem()` in `lib/liveStatus.ts`, failed pill + `role="alert"` on every route |
| 09 | major | `lib/liveStatus.ts:37,39,50`, `ModeIndicator.tsx:37,39`, `main.tsx:10`, `shell/ProvenanceLegend.tsx:4-7`, `App.test.tsx:136` | body `{"schemaVersion":1,"mode":"fallback"}` blanks the whole page (validate the full payload; error boundary around the header); legend lacks `not-applicable` although `#/budget` draws it (derive the test from the contract enums); sticky LIVE after a failed poll and non-2xx accepted both stay green; "Playing saved run" with `savedRunId: null` |
| 09 | minor | `liveStatus.ts:47-51`, `App.tsx:82`, `routes.ts:20`, `shell/liveFetch.ts:29-30`, `main.tsx:8` | late answer re-shows LIVE for one poll; boundary and `key={route}` untested; `#/advance` names `/api/live/status` for a bad transport artifact; backoff reset by a 200-HTML answer, no test; gallery stays on screen after Back |

### 4e. Open review findings — live-GX backend round 5 (reviewer on `2b1607e..c6244ec`, 2026-11-20: **CHANGES REQUESTED**)

R1 and R2 confirmed fixed and guarded (20 targeted mutants killed, signal tests 10/10 over 10 loops, budget guard / server / test hooks checked with no finding).
Fix owner: backend-engineer (round 6). Then reviewer round 6 and a delta verifier run for 06 (L1–L8) and 07.

| # | Sev | Where | Defect → fix |
|---|---|---|---|
| BE-1 | **major** | `live_gx/modal_backend.py:186-191`, `:256-263` | a spawn that outlives the client bound and then errors client-side is settled as confirmed ("nothing was started") even when the kill-switch put failed; `terminate()` drops `abort_error` when raising `TerminationPending` → CLI prints "workers terminated", `/api/live/terminate` answers 200, server exits 0, nothing cancelled, no switch raised. Keep the abort result on the handle, settle `(False, …)` when it failed so the next terminate retries the put; add the failed-put case beside `test_L6_late_spawn_that_errors_settles_as_nothing_started` (`test_live_gx.py:786`, which never asserts the switch) |
| BE-2 | minor | `live_gx/service.py:53-54`, `orchestrator.py:337,425` | 497 s is not an upper bound: a poll failure in the stop round runs the terminate round twice (910 s on a virtual clock) → skip the `finally` round when `_fallback` already ran one, or count two; test with a virtual clock (the current test re-derives the formula) |
| BE-3 | minor | `live_gx/rehearse.py:156`, `service.py:285,297` | when a cancel fails hard with nothing pending both exit paths sleep the whole confirmation wait (507 s) without retrying, print nothing until the end, and `/api/live/status` + `/api/health` time out meanwhile (UI falls to "REPLAY $0" while GPUs may bill) → print the warning before waiting; wait only while something is pending, or retry during the wait; keep status answering |
| BE-4 | minor | `live_gx/modal_backend.py:265-268` | kill-switch-only stop is reported as "terminated" unqualified (no cancel exists; the worker stops only if it reads the switch; `modal_app.py:94-99` treats a failed read as not aborted) → word it "kill switch raised, stop not confirmed" in `/terminate` and the exit line |
| BE-5 | minor | `live_gx/service.py:164,253-264` | two launch refusals crash the handler instead of answering 409: a ledger write `OSError`, and a 400-digit integer `confirmCostUsd` (`OverflowError`) → catch, return 409 |
| BE-6 | minor | `live_gx/service.py:166` | "exact-cent" confirmation accepts ±0.5 cent (2.6549 → 202 for $2.65) → require equality at two decimals |
| BE-7 | major (test) | `main/tests/test_geometry.py:271-294` | from the 01 verifier: G5 test is loose (mutations B13–B16 survive: duplicated seams, mesh at s 0.5, boundary at s 0.9) → compare all vertices and boundaries with an independent evaluation, assert no seam |

Cannot be verified without a real Modal (unchanged, needs the rehearsal): `inspect.signature(App.function)` exposing `startup_timeout` on modal 1.6.4; modal not touching signal handlers;
`cancel(terminate_containers=True)` ⇒ billing stopped; which client-side spawn errors prove nothing started; Dict put visible within `POLL_S`; `startup_timeout`/`timeout` semantics with `retries=0`.
Stale docs to fix after round 6 (maintainer): interface.md §3/§5 and architecture.md "Live GX" — kill-switch-only path vs "never reported confirmed until a cancel succeeded"; `LaunchInFlight` also raised for client-side failure;
SIGHUP + cooperative stop; `modal_app` executed by one subprocess test against a stub; abort key raised first on every terminate; `request_stop`/`stop_and_terminate`/`StopRequest`, test hooks, `POLL_INTERVAL_S`, 497 s;
run-id pattern `^(rehearsal|live)-[0-9a-f]{12}$`; "409 for any refusal".

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
