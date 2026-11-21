# Labyrinth · decision log

Append-only. Each entry: context, decision, consequences. Reverse a decision with a new entry.

## D-001 · "main" and "renderer" are process names, not Electron
**Context.** The user asked for top-level `main/` and `renderer/` directories with imports banned
between them. The PRD specifies React/TS/Three.js/Plotly UI, Python data prep and Modal workers; it
never mentions a desktop shell. Electron would add a ~100 MB runtime and a download from GitHub
releases that this sandbox may not reach, for zero PRD value.
**Decision.** `main/` = backend process (Python: data pipeline, verification, live orchestration, HTTP
API). `renderer/` = browser UI (Vite + React). The boundary is a process boundary: JSON artifacts + HTTP.
**Consequences.** Replay ships as a static site ($0). If a desktop app is later required, an Electron
`main` would wrap `labyrinth_main.server` as a child process without changing either tree.

## D-002 · Contracts are JSON Schema in a neutral `contracts/` directory
**Decision.** The only shared thing is data: `contracts/*.schema.json`. Renderer may import those JSON
files; nothing else outside `renderer/`. Orchestrator owns `contracts/`.
**Consequences.** Both sides test against the same schema (jsonschema / ajv). No generated code to drift.

## D-003 · Exit code 2 for every gate
**Context.** User requirement: failures exit 2 so the invoking agent is forced back to fix them.
Claude Code hooks treat exit 2 as a blocking error and feed stderr to the agent.
**Decision.** `verify.sh`, `check_boundaries.py`, `validate_artifacts.py`, `check_docs.py` and both hooks
exit 2 on failure or bad invocation; 0 on success. No other non-zero codes.
**Consequences.** CI also fails on 2. The Stop hook has a safety valve (6 consecutive blocks) so an
external blocker cannot trap a session forever; it tells the agent to record the blocker in status.md.

## D-004 · Stop hook, not SubagentStop
**Context.** Backend and frontend agents run concurrently in one working tree. A SubagentStop hook
running the full suite would block agent A on agent B's half-finished work.
**Decision.** Hook the top-level Stop only. Subagents run scoped `verify.sh main|renderer` as their own
loop; the orchestrator runs `verify.sh all` and is blocked by the Stop hook until green.

## D-005 · Commit pinned raw data
**Decision.** Commit the 3 MB of upstream inputs in `data/raw/` with sha256 tests rather than fetching at
build time. Replay must be $0 and offline-capable; the upstream URLs are pinned to a commit anyway.

## D-006 · Deterministic artifacts are committed
**Decision.** Commit `artifacts/*.json`; `verify.sh` regenerates and requires byte equality.
**Consequences.** Renderer development and static deploys never need Python; drift is caught in CI.

## D-007 · The "129 saved stella samples" acceptance test is BLOCKED, not faked
**Context.** PRD acceptance for "Locate the tubes": bean |B| agrees with all 129 saved stella samples to
their printed precision. At the cited stella commit `6f60964d` the only saved W7-X VMEC geometry
outputs are at ρ = 0.7 (torflux 0.49) with 13–25 samples (test_2, test_5, test_7). No 129-sample ρ = 0.8
file exists there.
**Decision.** Validate the field-line tracer against the saved ρ = 0.7 stella geometry (25 samples,
4 significant figures). Record acceptance-129 as `blocked` in the artifact and show it as BLOCKED in UI.
**Unblock.** Provide the stella `.geometry` / `.out.nc` file holding the 129 samples; add it to
`data/raw/` and turn the blocked check into a real comparison.

## D-008 · Forecast fixture does not reproduce; show both
**Context.** Orchestrator pre-check on the pinned archive: the PRD's stated method (persistence forecast
of 50-unit local means, init 1450–1500, 8 windows to 1900) gives MAE ≈ 0.0447 (persistence) and
≈ 0.0419 (frozen) with sample means on half-open windows; trapezoidal means give 0.0443/0.0414. The PRD
claims 0.0444/0.0423. An expanding-mean forecaster happens to hit 0.0444 but its frozen score is still
0.0419 — no single tested definition reproduces both numbers.
**Decision.** Implement the method the PRD *describes* (persistence). Display computed and claimed
MAE side by side with a mismatch flag. Do not tune the method to hit the number.

## D-009 · Archive 300–400 GENE mean is 2.67, PRD says 2.68 — SUPERSEDED by D-013
**Context.** Trapezoidal 300–400 mean of the GENE trace = 2.674 (sample mean 2.675); the PRD prints 2.68.
stella 300–400 = 2.552 → "2.55" matches.
**Decision.** Show computed values with a fixture mismatch flag on the 2.68 claim. Do not round up.

## D-010 · Bean and triangular tube definitions at ρ = 0.8
**Context.** PRD names the tubes by their central cross-section (bean ζ = 0°, triangular ζ = 36°) and
the attached images. The exact stella inputs for the 129-sample run are not in the repo.
**Decision.** Each tube is centred on the outboard midplane (θ* = 0) at ζc, spans one poloidal turn
θ* ∈ [−π, π] (Δζ = 2π/ι), 129 samples. α = −ι·ζc. Revisit when the original stella inputs are provided.

## D-011 · Live GX is code-complete but UNREHEARSED
**Context.** No Modal credentials in this environment; GX must be built for CUDA; the PRD says
feasibility, runtime and accuracy await rehearsal.
**Decision.** Ship orchestrator + budget guard + Modal app definition with a fake backend for tests.
Without credentials the API reports `unavailable` and the UI plays replay. There is no saved GX
rehearsal run, so the fallback label says so and plays the archived stella/GENE evidence instead.
**Unblock.** Modal token + one rehearsal under the budget guard; record its run as the saved run.

## D-012 · PR review
**Decision.** Every task's diff is reviewed by the `reviewer` agent before it is marked DONE. CI runs
`verify.sh` on every push and PR. `.github/workflows/claude-review.yml` adds an automated Claude review
on every PR once the repo owner adds an `ANTHROPIC_API_KEY` secret (not available to this session).

## D-013 · Window means are edge-interpolated time integrals (supersedes D-009)
**Context.** D-009 was based on the orchestrator's pre-check, which averaged with a trapezoid over only
the samples inside [a, b] and divided by their span. The transport agent showed that the proper
time-weighted mean, ∫_a^b Q dt / (b − a) with Q linearly interpolated at the window edges, gives
GENE 300–400 = 2.675 → "2.68", and reproduces all four PRD archive means (2.242, 2.474, 2.55, 2.68).
The PRD was right; the pre-check definition was wrong.
**Decision.** One shared window-mean definition, edge-interpolated, for transport windows, fixtures,
live comparison and forecast. The sample-span value is kept in the fixture note so the sensitivity
(0.0008, ~25× below that window's stderr) stays visible.
**Consequences.** The 2.68 fixture matches. The forecast MAE fixtures (D-008) still do not reproduce
under any tested definition (edge-interpolated ≈ 0.0440 / 0.0418 vs claimed 0.0444 / 0.0423).

## D-015 · Live budget guard prices setup, idle and storage on top of GPU time
**Context.** PRD: "$1.53 for 15 minutes" and "two one-hour rehearsals plus one live slot cost about
$13.73" price GPU time only; the same PRD requires allowing "for setup, idle time, storage and egress"
before each allocation.
**Decision.** The guard estimates rate × (slot + 5 min setup per launch + 5 min idle margin) + $0.10
storage/egress, rounded up to the cent: live slot **$2.65** (hard timeout 1500 s), rehearsal **$7.73**
(4500 s). The allowances are assumptions, not PRD numbers. Worker resources are 4 CPU / 16 GiB each so
the pair matches the priced 8 cores / 32 GiB. Mode stays `unavailable` until a rehearsal is recorded.
Ledger lives outside the repo (`~/.labyrinth/ledger.json`); every launch marks it unreconciled.
**Consequences.** Planned total with the guard: 8.10 + 2 × 7.73 + 2.65 = **$26.21** (PRD's GPU-only plan:
$21.83). Still inside $40. Replace the assumptions with measured values after the first rehearsal.

## D-016 · The PRD used two different window-mean definitions; we keep one (refines D-008, D-013)
**Context.** The 03 forecast verifier tested 4,765 definitions. A time-weighted *sample-and-hold*
(zero-order hold, edge-clipped) window mean reproduces both PRD forecast scores on the stated windows
(persistence 0.044418 → 0.0444, frozen 0.042332 → 0.0423; frozen is only 1.8e-5 from the rounding
edge), but gives stella 300–400 = 2.557 → "2.56" ≠ PRD "2.55". The edge-interpolated mean (D-013)
reproduces all four archive means but neither forecast score. No single definition reproduces all
six PRD numbers. D-008's statement "no tested definition reproduces both" was wrong.
**Decision.** Keep one definition everywhere (edge-interpolated, D-013): consistency across the app beats
matching one number. The forecast fixtures stay `matches: false`, and the fixture note states that the
PRD scores reproduce under sample-and-hold, with values. A test documents the sample-and-hold result.
**Open for the product owner.** If the forecast scores are the acceptance criterion, switch the forecast
feature alone to sample-and-hold and accept that the forecast and transport views then average differently.

## D-017 · Stricter claim gate: no archive window currently permits a saturated-agreement claim
**Context.** Data review found the original gate allowed claims at N_eff ≈ 5, where the stderr is ~40%
low and the stationarity test falsely rejects ~27% of stationary windows. Fixed: Sokal τ with
mean-subtraction bias correction, N_eff evaluated at the one-sigma upper bound of τ, claims need
N_eff ≥ 20, Student-t intervals, stationarity via max(τ_full, τ_residual), and `compare_window` is a
TOST equivalence test (agree only if the 90% CI of the difference lies within ±10% of the archive mean;
otherwise disagree / inconclusive / no claim).
**Consequence.** The archive's autocorrelation time is ~10–20 time units, so even 400-unit windows hold
~12–14 effective samples: every archive window shows "saturated claim: not allowed", and stella vs
GENE on 1500–1893.765 is "no claim". This is the honest answer for these trace lengths, and it is what
the PRD's "claim saturated agreement only for a covered stationary window with sampling uncertainty"
implies. A live GX run would need a longer covered window than the archive's 100-unit PRD windows.
**Why not lower the N_eff threshold.** Reviewer Monte-Carlo: at N=277/τ=11 samples the gate opens in ~6.7%
of runs, and coverage *given* a claim is only 62.5% — the estimator opens exactly when it has underestimated
τ. Conditional coverage reaches 88% at N≈600 and 94% at N≈1000, so a live run needs roughly 3–5× the archive's
τ-normalised window length before any saturated-agreement claim. Indicative stationarity verdicts are
serialised as `null` (undecidable), never `true`.

## D-018 · Saved rehearsal runs have a contract
`contracts/live-run.schema.json` describes `GET /api/live/runs/<savedRunId>`; phases are live-status
snapshots. The "playing saved GX run" label is only used when such a run exists and qualified.

## D-020 · The maintainer's machine is Windows; every gate runs inside WSL, line endings are LF
**Context.** The build moved from a Linux container to the owner's Windows 11 checkout (2026-11-20). Findings on arrival:
(1) git's `core.autocrlf=true` checked every text file out as CRLF, which breaks the bash gates, the byte-equality check
`artifacts:fresh` and anything sha256-pinned; (2) Windows had no Node, no Python deps, no native `bash`, and `git` only inside
GitHub Desktop; (3) the hook commands used `$CLAUDE_PROJECT_DIR`, which PowerShell expands to nothing, so the PostToolUse hook
failed on every edit and the Stop hook silently did nothing; (4) the live-GX safety tests send real SIGINT/SIGTERM, which Windows
cannot deliver to a handler. Porting the gates to Windows would have meant skipping exactly the money-safety tests.
**Decision.** Keep one execution environment, the same as CI (Ubuntu): WSL. `.gitattributes` forces LF on every OS.
`scripts/setup-dev.sh` installs a user-local toolchain in WSL (uv, venv with the pinned deps, Node 22, sha256-checked, no sudo,
nothing on Windows). `scripts/dev.sh <cmd>` puts it on PATH and is a transparent wrapper elsewhere. Hooks are launched through
`python3 -c` (valid in bash and PowerShell); `scripts/hooks/stop_launcher.py` runs `stop_verify.sh` in WSL on Windows and maps every
failure to exit 2 (D-003). The PostToolUse hook also matches `PowerShell`. `scripts/probe-copy.sh <name>` gives verifiers an isolated
copy for mutation tests, so parallel agents never mutate the shared tree (this replaces the unadopted D-014 idea).
**Consequences.** Commands are prefixed `wsl.exe -e bash scripts/dev.sh …` on this machine and unchanged on Linux/CI. Hook edits
in `.claude/settings.json` only load in a new session; a session started before the fix still sees the old PostToolUse error
("can't open file …post_edit_boundary.py") — ignore it and run `scripts/check_boundaries.py` through the wrapper instead.
Python is 3.12 in WSL vs 3.13 in CI (both ≥ the required 3.11); Node is 22 in both.

## D-021 · Commits go straight to `main`, after green gates and reviewer approval
**Context.** The first push (owner's GitHub sign-in, 2026-11-20) published the hand-over branch and fast-forwarded `main`.
The owner chose "straight to main" over branch-then-main and over GitHub pull requests (no `gh` CLI on this machine).
**Decision.** The maintainer commits and pushes to `main` only. Before each push: `verify.sh all` exits 0 and the `reviewer`
agent has approved that change (D-012 still holds; the review happens on the working tree / local commits instead of on a PR).
Engineers, verifiers and reviewers never commit. `claude/focused-cori-6s5ucw` stays on GitHub as the hand-over snapshot.
**Consequences.** `main` can carry tasks that are not `DONE`; `status.md` §2, not the branch, says what is verified.

## D-022 · A task is DONE only on a genuine, whole-task, current PASS (replaces the phrase list in `check_docs.py`)
**Context.** Scaffold review SC-5: the DONE gate accepted a final `Verdict: FAILED` / `**Verdict: FAIL**` / `Verdict: PARTIAL` after an older PASS,
accepted verdicts that predated later fix rounds, and its "partial verification" phrase list was trivially dodged.
**Decision.** `scripts/check_docs.py` requires, for a task whose Status is DONE:
1. *Verdict.* The last line with "verdict" among its first three words must be exactly `Verdict: PASS` and must be the last non-blank line of `VERIFY.md`.
2. *Coverage.* The final run (everything after the last `Verifier run` line) has an outcome table (header ending `| Result |`) with a row for every outcome ID
   under TASK.md "## Expected outcome", each Result cell starting with `PASS`.
3. *Currency.* The last `Verifier run: <date>, commit <sha>` line names the verified commit; the files the task owns (backticked paths under TASK.md `## Owner`,
   at least one, each must exist) are identical in that commit and in the working tree, with no untracked file under them. So the final run is always on a committed tree.
4. *No history.* `.git` present but git cannot answer (missing, shallow, unknown sha) → exit 2 (`ci.yml` now checks out with `fetch-depth: 0`). No `.git` in a
   `scripts/probe-copy.sh` copy (marker `.labyrinth-probe-copy`) → stderr warning, rules 1–2 still decide. No `.git` anywhere else → exit 2.
**Consequences.** Any change to a task's owned files after its verified commit reopens the task until a verifier runs again: a passing task that a later fix round
touches is no longer DONE-able (01, 03, 05 after wave 2). Every TASK.md needs backticked owned paths under `## Owner`. Verifiers follow the format in `.claude/agents/verifier.md`.

## D-023 · Contract tightenings: ranges, check basis, spatial fixtures, blocked acceptance, float64 check, guard plan
**Context.** `interface.md` §10 listed known contract gaps, and the wave-2 frontend engineers had to work around them with constants and
prose parsing: budget range fixtures overloaded `claimed` with a midpoint the PRD never printed (a renderer could show it as a PRD figure);
spatial had no `fixtures` array, so its pills and "4/4" tally were hard-coded; the geometry schema *permitted* `acceptance129: passed`;
the float64 stella comparison existed only as prose (the UI regex-scraped it); the live guard's plan (D-015: $2.65 / $7.73 / $26.21) was
duplicated as renderer constants; which fixtures are arithmetic-only re-checks of PRD-reported inputs was hard-coded at call sites; and
`live-run.schema.json` had no top-level `additionalProperties: false`.
**Decision.** One coordinated contract change (both sides and the artifacts in the same commit; `schemaVersion` stays `1` because no
deployed consumer exists and the renderer and artifacts always ship together):
1. `common.fixtureCheck` gains optional `claimedRange: [lo, hi]` (the `window` shape) and optional `basis: "data" | "arithmetic"`.
   `claimed` becomes `number | null`; **when `claimedRange` is present `claimed` must be `null`** (schema `if/then`), and `matches` means
   `lo ≤ computed ≤ hi`. `basis: "arithmetic"` marks a check that only re-does arithmetic on PRD-reported inputs (no data in the repo);
   absent means `"data"`. The renderer renders the range when present and takes the basis from the artifact, never from a call-site list.
2. `spatial` gains a required `fixtures` array (`common.fixtureCheck`): at least the 1.27× speedup (basis arithmetic) and the 4-of-4
   controlled runs (`matches: null`: not recomputable here). Pills and tallies in the spatial view come from these and from `runs`.
3. `geometry.validation.acceptance129.outcome` is `const "blocked"` until the 129 stella samples exist (D-007). Unblocking it is a
   schema change with its own decision entry.
4. `geometry.validation` gains a required `float64Reference` object: `samplesCompared`, `tolerance`, `maxAbsError`, `maxRelError`,
   `allWithinTolerance`, `source` — the float64 `EXPECTED_OUTPUT…out.nc` comparison that the backend already performs.
5. `budget` gains a required `guardPlan` object produced by the backend from the live budget guard (single source, D-015):
   `slotEstimateUsd`, `rehearsalEstimateUsd`, `slotHardTimeoutS`, `rehearsalHardTimeoutS`, `plannedTotalUsd`, `assumptions` (string).
   The renderer drops its D-015 constants and still compares against the live snapshot's estimate when a backend is reachable.
6. `live-run.schema.json` gets top-level `additionalProperties: false`.
7. (Follow-up, review round.) Saved-run ids in `live-run.schema.json` and `live-status.schema.json` `fallback.savedRunId` match what the
   server creates and serves: `^(rehearsal|live)-[0-9a-f]{12}$` (was `^[A-Za-z0-9_.-]{1,80}$` and unchecked).
**Consequences.** `interface.md` §10's list becomes empty except the known PRD-side mismatches. Every producer and consumer test changes
with the contract (interface.md §9). The 129-sample acceptance can no longer be marked passed by an artifact alone.

## D-024 · The live comparison with the archive is computed by the backend and carried in live-status `comparison` (closes cross-RX-2)
**Context.** PRD "Check transport": "Compare time-weighted means on 200–300 and 300–400 when covered. Claim saturated agreement only for a
covered stationary window with sampling uncertainty." New GX bean samples were converted to archive units and overlaid, but nothing compared
them with the archive; the live provenance said "Live comparison NOT computed". The statistics already exist and are verified (D-013 window
mean, D-017 gate: Sokal stderr, half-split stationarity, N_eff ≥ 20 at the τ upper bound, TOST `compare_window`).
**Decision.**
1. `contracts/live-status.schema.json` gains an optional, closed `comparison` object. Every snapshot of a session (the orchestrator's) carries it;
   the gate's snapshot with no session omits it. Fields: `tube` (`"bean"`), `nSamples`, `tStart`/`tEnd` (the bean samples' span in archive units,
   null without samples), `marginFraction` (0.10, the TOST margin as a fraction of |archive mean|), `method`, `saturatedClaimAllowed`, `reason`, `windows`.
2. `windows` holds exactly the two PRD windows, 200–300 then 300–400, or is empty when the comparison could not be computed (`reason` says why;
   a status answer never fails because of it). Each window: `window`, `covered`, `nSamples`, `mean`, `stderr`, `stderrApproximate`, `nEff`,
   `nEffLower` (N_eff at the one-sigma τ upper bound: the gate's value), `stationary` (`true | false | null`, null = undecidable, as in
   transport `windows[]`), `saturatedClaimAllowed` (the live trace's own gate on that window: covered ∧ stationary ∧ finite stderr ∧ nEffLower ≥ 20,
   the same meaning as transport `windows[].saturatedClaimAllowed`), `detail` (the `window_stats` text) and `archive`: exactly two entries,
   `stella` then `GENE`, each `{code, mean, stderr, delta, verdict, reason}` where `delta` = live mean − archive mean (null when either is missing)
   and `verdict` ∈ `agree | disagree | inconclusive | no claim` is `transport.compare.compare_window(live, archive, window)` unchanged.
   Schema `if/then`: a window with `covered: false` has `mean`, `stderr`, `nEff`, `nEffLower`, `stationary` null and `saturatedClaimAllowed` false.
3. Top-level `saturatedClaimAllowed` is true **only** when at least one window has verdict `agree` against at least one archive trace (`agree` already
   requires both sides to pass the gate). Consumers show a claim only when the flag is true **and** an `agree` verdict is present; a flag that
   disagrees with the verdicts is shown as an inconsistency, never as a claim.
4. The backend computes it from every bean sample received in the session (already converted, t×√2, Q÷2√2), against the committed archive
   traces (`transport.archive.load_trace`), with `transport.stats` and `transport.compare` only — no second definition. It is recomputed when the
   bean sample count changes and cached otherwise. The provenance's "Live comparison NOT computed" sentence is removed.
5. The renderer shows the comparison only when `isLive` (a valid, fresh snapshot with `mode === "live"`), with the archive table's honesty rules:
   "undecidable" for null stationarity, "not covered" and "—" for nulls, approximate stderr marked as a lower bound, the claim "not allowed" with its
   reason, signed deltas, and stella and GENE never shown as agreeing with each other.
**Consequences.** With the committed archive no verdict can be `agree`: every archive 200–300 / 300–400 window is undecidable and its N_eff is not
established (the bias-corrected Sokal estimate does not converge; GENE's uncorrected fallback gives only N_eff ≈ 6 and 10), so the ≥ 20 gate is
not met (D-017): `compare_window` answers "no claim" whatever the live trace does, and `saturatedClaimAllowed` stays false. That is the honest answer
for 100-unit archive windows, and the reason is shown. The live mean, its uncertainty, its own gate and the deltas to both archive means are still
shown. Tests drive the other verdicts with injected synthetic archive traces. `schemaVersion` stays 1 (optional field; saved runs written before
this decision stay valid). The renderer's validator in `renderer/src/lib/liveContract.ts` changes, so tasks 02, 06 and 09 are re-verified.

## D-025 · N_eff never exceeds the samples in the window: τ_int is floored at half a sample (refines D-017)
**Context.** The 06 verifier (finding F4-1, 2026-11-21) showed that with a few noisy samples the bias-corrected Sokal estimate can
converge at lag 1 with a negative lag-1 autocorrelation, giving τ_int below the white-noise value of ½ sample. N_eff = (N − 1)/(2 τ_int)
then exceeded the number of samples in the window (up to ~250×), the stderr fell below s/√(N − 1), and the N_eff ≥ 20 claim gate opened on
12–25 white-noise samples in 13–38 of 200 seeds; 14 live samples gave "agree" against an archive at the live mean in 19 of 200 seeds. The
archive never showed it (its 200–400 windows never establish N_eff), but D-024 made it reachable: a sparse live GX trace could claim
saturated agreement.
**Decision.** `transport.stats.sampling_error` floors τ_int at `TAU_INT_MIN` = ½ sample once the Sokal window is accepted (bias-corrected path
and uncorrected fallback; a converged estimate ≤ 0, i.e. lag-1 correlation ≤ −0.5, is floored too instead of being reported as "window not
reached"). So N_eff ≤ N − 1 and the stderr is never below the independent-samples value. For a floored τ the Madras–Sokal upper bound uses the
window the floor itself needs (M = ⌈5 × ½⌉ = 3), not the raw lag. The gate (N_eff at the τ upper bound ≥ 20) then needs ≈ 34+ white-noise samples.
`half_split_test` caps only its reported N_eff (and the df taken from it) at N − 1; its se keeps the unfloored τ, because flooring it widened se
and dropped the white-noise false-rejection rate from ≈ 5 % to ≈ 1 % at N = 40, letting more drifting windows pass as stationary (review R1).
A floored estimate is named in the window's detail text ("raised to the floor of 0.5 sample … D-025") and in `METHOD_SUMMARY`. Anti-correlated
traces whose true N_eff exceeds N are treated conservatively; heat-flux turbulence gives no reason to credit that.
**Consequences.** No archive number, fixture or verdict changes (every archive estimate is above the floor): only text in the seven
`stationarityDetail` strings of `transport.json` changes (METHOD clause; "no usable full-window Sokal tau … not converged, or not positive").
Large-N behaviour is unchanged (the AR(1) N = 2000 calibration test is not floored and still claims). Tests: `test_T3_n_eff_never_exceeds_…`
(1000 white-noise windows of 12–25 samples, the alternating case, the M = 3 bound), `test_T3_half_split_keeps_its_level_on_short_white_noise`
(3000 windows, false rejection 0.039) and `test_L11_a_sparse_live_trace_never_claims_…`; 7/7 mutants caught. Task 02 is re-verified (its owned
`transport/stats.py` changed); task 06's owned files are unchanged. Still open (D-017 limit, unchanged): positively correlated sparse traces can
open the gate below 20 true effective samples (AR(1) τ = 2 samples, N = 60: ≈ 11 % of runs).

## D-014 · (not adopted) "Wave mode" for the orchestrator's Stop hook
**Context.** With parallel agents editing one working tree, the Stop hook (`verify.sh all` on the shared tree)
repeatedly blocked the orchestrator on files it must not touch. A proposal to verify committed HEAD in a clean
temporary worktree while a wave was in flight was **declined by the permission system and not applied**; the number
D-014 was never used for a real change. Workaround used: wait in-turn for agents' loops to go green.
**Open.** Options for the next orchestrator: run agents sequentially, give each agent its own `git worktree`, or adopt wave mode with the owner's approval.

## D-019 · Build stage ended early at the owner's request; unverified work committed with labels
**Context.** After repeated usage-limit interruptions the owner asked to wrap up, write `interface.md` and hand over
(2026-11-20). Until then the rule was "commit only after verifier PASS + reviewer APPROVE".
**Decision.** Everything was committed, in separate, explicitly labelled commits (verified backends / live GX UNVERIFIED /
design system pending / frontend WIP UNVERIFIED). `status.md` §2 is the truth about what is verified. No task is marked `DONE`.
**Consequence.** Do not read the presence of code in `main/` or `renderer/` as verification: check the VERIFY.md and status table.
