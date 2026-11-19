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
