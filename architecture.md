# Labyrinth · architecture

> Companion docs: `interface.md` (every cross-boundary contract), `status.md` (state + next steps), `decision.md` (why).

Labyrinth lets a stellarator transport researcher judge whether a W7-X heat-flux estimate is accurate
enough to justify a longer simulation, by putting the sampled field line, the solver output and an
independent reference in one view. Replay costs $0; live GX is gated behind qualification and a $40 ceiling.

## Process boundary

```
 data/raw/ (pinned, sha256)            contracts/*.schema.json  (shared DATA, not code)
        │                                   ▲            ▲
        ▼                                   │ validates  │ validates
 ┌──────────────── main/ ────────────────┐  │            │  ┌──────────── renderer/ ─────────────┐
 │ labyrinth_main  (Python, "main")      │──┘            └──│ React + TS + Three.js + Plotly     │
 │  features/geometry   VMEC field lines │                  │  features/geometry   3D + inset    │
 │  features/transport  traces, windows  │   artifacts/     │  features/transport  overlay+table │
 │  features/forecast   forecast replay  │──*.json────────▶ │  features/forecast   step replay   │
 │  features/budget     cost model       │  (static, $0)    │  features/budget     ledger        │
 │  features/spatial    GENE-X replay    │                  │  features/spatial    rank diagram  │
 │  features/live_gx    Modal GX + guard │   HTTP /api/*    │  features/live-gx    live panel    │
 │  server/             stdlib HTTP API  │◀───────────────▶ │  shell/ design/ lib/               │
 └───────────────────────────────────────┘   (live only)    └────────────────────────────────────┘
```

* **No imports cross the boundary.** `scripts/check_boundaries.py`: every path-like token in any text file under `renderer/`
  (specifiers, globs, URLs, shell strings, CSS/HTML) must resolve inside `renderer/`, to `artifacts/` or to `contracts/`, and naming or
  running `labyrinth_main` is a violation; Python under `main/` may not import `renderer` or name its directory as a path or command target.
  Runs in `verify.sh` (with `--self-test`) and as a PostToolUse hook on every edit and shell command (exit 2).
* **Contract = JSON Schema (draft 2020-12).** main validates artifacts with `jsonschema` (`scripts/validate_artifacts.py`) and saved runs
  when it loads them; the renderer validates the same artifact files with `ajv` (`renderer/src/lib/contracts.test.ts`) and every live payload
  at runtime with validators (`lib/liveContract.ts`) that a test checks against the schemas. A schema drift fails both sides.
* **Artifacts are deterministic**: floats rounded to 7 significant figures, sorted keys, no timestamps.
  `verify.sh` rebuilds them into a temp dir and requires byte equality (`artifacts:fresh`).
* **Replay is static.** `vite build` copies `artifacts/` into `dist/artifacts/`; the app needs no backend.
  The API is only for live GX status/launch/terminate and saved rehearsal runs.

## Features (one folder per feature, each side)

| Feature | PRD row | Backend | Frontend | Artifact / API | Task |
|---|---|---|---|---|---|
| geometry | Locate the tubes · replay | `features/geometry` | `features/geometry` | `geometry.json` | 01 |
| transport | Check transport | `features/transport` | `features/transport` | `transport.json` + live samples | 02 |
| forecast | Forecast replay | `features/forecast` | `features/forecast` | `forecast.json` | 03 |
| budget | Budget figures | `features/budget` | `features/budget` | `budget.json` (+ live guard estimate) | 04 |
| spatial | Inspect spatial parallelism | `features/spatial` | `features/spatial` | `spatial.json` | 05 |
| live-gx | Advance plasma · live | `features/live_gx` | `features/live-gx` | `/api/live/*` | 06 |
| server | — | `server/` | — | `/api/*`, `/artifacts/*` | 07 |
| design system | — | — | `design/` | — | 08 |
| shell | — | — | `shell/`, `lib/` | — | 09 |
| heatfield | Owner requirement 2026-11-21 (D-027): Heat & field | `features/heatfield` | `features/heatfield` | `heatfield.json` (grids, field lines, model, golden) | 10 |

## Science pipeline (main)

* **Geometry.** VMEC `wout_w7x_kjm.nc` (W7-X high-mirror, nfp 5). R, Z on the full radial grid,
  |B| and λ on the half grid, interpolated to s = ρ² (ρ 0.8 → s 0.64). Field line at fixed
  α = θ* − ιζ; for each ζ solve θ* = θ + λ(s, θ, ζ) for VMEC θ (Newton). Validated against stella's
  saved `EXPECTED_OUTPUT.vmec_geometry.geometry` (ρ 0.7, 25 samples) to printed precision, and its bmag against
  the same run's float64 `out.nc` to 1e-10 (`validation.float64Reference`). The PRD’s 129-sample acceptance is recomputed against the saved Modal bean geometry at ρ 0.8 (D-029).
* **Transport.** Benchmark h5 `compared/test5/{stella,GENE}`. Means are edge-interpolated time integrals on
  closed windows (D-013). Uncertainty is autocorrelation-aware (τ_int floored at ½ sample, so N_eff never exceeds the
  samples in the window, D-025). "Saturated agreement" is only claimed for a covered, stationary window with finite uncertainty and N_eff ≥ 20.
* **Units.** GX raw → archive: t × √2, Q ÷ 2√2, only with identical dimensional references.
* **Forecast.** Persistence (previous window) vs frozen (initialisation window) on 50-unit windows; `errorStats` (D-026): MSE, RMSE,
  min–max of the squared errors and of the signed errors (predicted − actual) per forecaster, shown with the predicted-vs-actual chart.
* **Heat & field (D-027, `tasks/10-heat-field/MODEL.md`).** Real: R, Z, |B| (T) on ρ = 0…1 (9 surfaces) × 48 θ × 72 φ from the same VMEC reader,
  eight LCFS field lines from the same tracer. Illustrative (provenance kind `model`, not a W7-X simulation): an explicit edge heat model on the
  LCFS (diffusion along the field-line pitch and across with D⊥ ∝ (B0/B)², relaxation to a pedestal, Gaussian sinks at four schematic diverters,
  a coil perturbation that sweeps the strike line, lumped tile temperatures). The Python model is the reference and writes golden checkpoints;
  the renderer runs a TypeScript port (interactive) that reads every input from the artifact and must reproduce the golden values.
* **Budget.** PRD figures recomputed in exact decimals (`pricing.py` is the single source of PRD constants); PRD ranges are
  `claimedRange` fixtures, never midpoints; `guardPlan` is priced by calling the live budget guard itself (D-023).

## Live GX (main/features/live_gx)

`server/` → `service.LiveService` (status / guarded launch / terminate / shutdown; ledger, qualification and saved runs under `$LABYRINTH_STATE_DIR`)
→ `orchestrator.Orchestrator` (state machine over two workers, GPU 0 bean / GPU 1 triangular; backend injected via the `WorkerBackend` Protocol)
→ `modal_backend` (the only module importing `modal`, lazily; every client call bounded by 20 s) → `modal_app` (two Modal functions, `gx_worker_live` /
`gx_worker_rehearsal`, A100-40GB, `retries=0`, deployed by hand; never imported by the server, replay or the test process).
`rehearse` (CLI) qualifies live mode through the same guard and orchestrator: phase 1 from initialization, phase 2 from its checkpoints.
Qualification is checked per deployment from its saved rehearsal record. The owner's previous local qualification is recorded in `status.md`.
`comparison.live_comparison` (D-024) compares the session's bean samples (archive units) with the archived stella and GENE traces on 200–300 and 300–400
using the transport statistics unchanged (`transport.stats`, `transport.compare`); every session snapshot carries the result as live-status `comparison`, and
Check transport shows it only while live. With the committed archive every verdict is "no claim" (on its 100-unit windows N_eff is not established, so the ≥ 20 gate is not met, D-017).
`budget_guard` approves every allocation: ledger reconciled, billed + pending + estimate ≤ $40, exact-cent confirmation; each launch reserves its
estimate under an O_EXCL ledger lock and marks the ledger unreconciled again. Time is priced in stages: Modal `startup_timeout` (300 s) + execution
(planned − 300 s) = the orchestrator's hard timeout, so billed time per container ≤ planned.
**Safety invariants (each came from a review finding and has a test):**
* *Terminated means a cancel succeeded.* A launched worker — its spawn returned, or `LaunchInFlight`: the spawn outlived its bound or failed client-side
  after it may have reached Modal — counts as terminated only when `FunctionCall.cancel(terminate_containers=True)` of its call succeeded (or a queued
  cancel settled as confirmed). A kill-switch-only stop (no call to cancel) is TERMINATE FAILED for good: 502, exit 2, no new launch. While any launched
  worker is unconfirmed the mode never becomes `terminated`, no reason says "terminated", and every later terminate calls the backend again; a worker
  that was never launched is never called terminated.
* *The reason is read off the worker records, never written ahead.* A fallback carries `TERMINATION PENDING — terminating workers…` from the instant its
  mode is set (same lock) until its terminate round's verdict.
* *Kill switch first.* Every terminate raises the run's kill switch (`<run_id>/abort` in the progress Dict, read by every worker) before the cancel; a failed
  put is reported and retried by the next terminate. A spawn still in flight gets its cancel queued (TERMINATION PENDING) and is cancelled the moment it returns.
* *Cooperative stop, one round.* `request_stop()` only sets flags (safe inside a signal handler) and is forwarded to the backend, which then sends no spawn.
  The session checks it before every spawn and poll, ends its step and runs one terminate round (every worker's first cancel before any retry; backoff
  0.5/1/2/4 s). That bounds a stop by `WORST_CASE_STOP_S` = 489.5 s.
* *Signals.* SIGINT, SIGTERM and SIGHUP make the server and the rehearse CLI stop and terminate before exit; later signals are no-ops (the handler stays
  installed until exit; a signal ignored at start-up stays ignored). An unconfirmed stop is announced before any wait, the wait lasts only while a cancel is
  queued, and the exit code is 2 with "NOT confirmed terminated". The API keeps answering during the shutdown; a dead stdout never changes the exit code.
* *Hard timeout* runs on a monotonic clock and is checked before every poll and between the two spawns.
* *Refusals are total.* Every refused launch is a 409 carrying the status and launches nothing; a malformed ledger can only make the guard refuse.
* *Qualification.* Live is `unavailable` unless credentials and `modal` exist **and** `qualification.json` names a saved run that validates against
  `contracts/live-run.schema.json` with exactly its keys, every check true and two phases. Without it the UI plays replay.

## Frontend layout (renderer/src)

`shell/` (hash router, mode indicator + danger alert, artifact gate and error boundaries, provenance legend, theme switch, `#gallery` switch) ·
`lib/` (`artifacts.ts`, `liveContract.ts`, `liveStatus.ts` — the only data access) · `design/` (tokens → generated CSS, Plotly/Three themes, primitives incl.
`Alert`, `Gallery`, `DESIGN.md`) · `features/<name>/` (view + `model.ts` data→props logic + thin WebGL/Plotly adapters that lazy-import `three` / `plotly.js-dist-min`).
**Invariants the code enforces:**
* One live-status store (`lib/liveStatus.ts`) feeds the header and every view; all `/api/live/*` calls live there, and no payload reaches a component
  before it validates against the contract.
* LIVE (pill, `ProvenanceBadge live`, live traces) only while a valid, fresh snapshot reports `mode === "live"`; unreachable, invalid or stale → replay ($0).
  A provenance record of kind `live` alone never produces LIVE.
* While GPUs may be billing (terminate failed or pending, kill-switch-only stop, unconfirmed stop request, or the API lost during a session) every route
  shows the billing-risk pill and an `Alert` quoting the backend's reason verbatim, and "Replay · $0" is withheld.
* Launch POSTs exactly the confirmed cost and stays locked while in flight; after a 202 until the mode changes, after a 409 or no answer until the next snapshot.
* Ranges, fixture basis, spatial pills, geometry float64/acceptance verdicts and the budget guard plan come from the artifacts (D-023), never from
  constants, call-site lists or prose; an artifact missing a required field is a named error, not a half-drawn view.

## Quality loop

```
agent builds ─▶ scripts/verify.sh (exit 2 on fail) ─▶ fix ─┐
     ▲                                                     │ green
     └──────────────── Stop hook (exit 2) ◀────────────────┘
                                │
                     external verifier agent ─▶ tasks/NN/VERIFY.md (real output, Verdict)
                                │
                        reviewer agent (diff) ─▶ APPROVE / CHANGES REQUESTED
                                │
                 CI (.github/workflows/ci.yml) runs verify.sh on every push/PR;
                 claude-review.yml reviews PRs only (needs ANTHROPIC_API_KEY); pushes to main (D-021)
                 rely on the reviewer agent's approval before the push
```

## Directory map

```
main/              backend (Python package labyrinth_main, tests/)
renderer/          frontend (Vite app; src/{shell,design,lib,features/*})
contracts/         JSON Schemas shared by both sides
artifacts/         generated, committed, deterministic JSON consumed by renderer
data/raw/          pinned upstream inputs (+ README provenance)
design-artifacts/  reference images (flux-tube renders)
scripts/           verify.sh, check_boundaries.py, validate_artifacts.py, check_docs.py, dev.sh, setup-dev.sh, probe-copy.sh, hooks/, tests/
tasks/             one folder per feature: TASK.md (+ VERIFY.md after verification)
.claude/           settings.json (hooks), agents/ (backend-engineer, frontend-engineer, design-lead, verifier, reviewer), state/ (Stop-hook state)
```
