# Labyrinth · status

> **Single source of truth for handoff. Read this first, then `interface.md`, `architecture.md`, `decision.md`.**
> Last updated: 2026-11-20 by the maintainer (Claude Code in the owner's checkout `D:\Labyrinth`, Windows + WSL), resuming after the hand-over.
> Branch **`main`**, pushed to `github.com/bede-lau/Labyrinth` (D-021). `claude/focused-cori-6s5ucw` on GitHub is the hand-over snapshot (`f0ca8e6`).
> **Environment changed:** every command runs inside WSL through `scripts/dev.sh` — see CLAUDE.md "Running commands on this machine" and D-020.

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
