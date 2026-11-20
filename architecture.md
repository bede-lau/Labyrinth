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

* **No imports cross the boundary.** `scripts/check_boundaries.py` rejects: renderer specifiers that
  resolve outside `renderer/` (except `contracts/*.json`), bare `main`/`labyrinth_main` specifiers,
  absolute imports; Python imports of `renderer` or `sys.path` hacks. Runs in `verify.sh` and as a
  PostToolUse hook on every edit (exit 2).
* **Contract = JSON Schema (draft 2020-12).** main validates artifacts with `jsonschema`
  (`scripts/validate_artifacts.py`); renderer validates the same files with `ajv`
  (`renderer/src/lib/contracts.test.ts`). A schema drift fails both sides.
* **Artifacts are deterministic**: floats rounded to 7 significant figures, sorted keys, no timestamps.
  `verify.sh` rebuilds them into a temp dir and requires byte equality (`artifacts:fresh`).
* **Replay is static.** `vite build` copies `artifacts/` into `dist/artifacts/`; the app needs no backend.
  The API is only for live GX status/launch.

## Features (one folder per feature, each side)

| Feature | PRD row | Backend | Frontend | Artifact / API | Task |
|---|---|---|---|---|---|
| geometry | Locate the tubes · replay | `features/geometry` | `features/geometry` | `geometry.json` | 01 |
| transport | Check transport | `features/transport` | `features/transport` | `transport.json` + live samples | 02 |
| forecast | Forecast replay | `features/forecast` | `features/forecast` | `forecast.json` | 03 |
| budget | Budget figures | `features/budget` | `features/budget` | `budget.json` | 04 |
| spatial | Inspect spatial parallelism | `features/spatial` | `features/spatial` | `spatial.json` | 05 |
| live-gx | Advance plasma · live | `features/live_gx` | `features/live-gx` | `/api/live/*` | 06 |
| server | — | `server/` | — | `/api/*`, `/artifacts/*` | 07 |
| design system | — | — | `design/` | — | 08 |
| shell | — | — | `shell/`, `lib/` | — | 09 |

## Science pipeline (main)

* **Geometry.** VMEC `wout_w7x_kjm.nc` (W7-X high-mirror, nfp 5). R, Z on the full radial grid,
  |B| and λ on the half grid, interpolated to s = ρ² (ρ 0.8 → s 0.64). Field line at fixed
  α = θ* − ιζ; for each ζ solve θ* = θ + λ(s, θ, ζ) for VMEC θ (Newton). Validated against stella's
  saved `EXPECTED_OUTPUT.vmec_geometry.geometry` (ρ 0.7, 25 samples) to printed precision.
* **Transport.** Benchmark h5 `compared/test5/{stella,GENE}`. Means are trapezoidal time-weighted on
  closed windows. Uncertainty is autocorrelation-aware. "Saturated agreement" is only claimed for a
  covered, stationary window with finite uncertainty.
* **Units.** GX raw → archive: t × √2, Q ÷ 2√2, only with identical dimensional references.
* **Forecast.** Persistence (previous window) vs frozen (initialisation window) on 50-unit windows.

## Live GX (main/features/live_gx) — UNVERIFIED, UNREHEARSED

`service.LiveService` (status / guarded launch / terminate / shutdown; ledger + qualification + saved runs under `$LABYRINTH_STATE_DIR`)
→ `orchestrator.Orchestrator` (pure state machine; backend injected via the `WorkerBackend` Protocol)
→ `modal_backend` (the only module importing `modal`, lazily) → `modal_app` (two Modal functions, `gx_worker_live` /
`gx_worker_rehearsal`, A100-40GB, `retries=0`, never imported by tests/server/replay).
`budget_guard` approves every allocation: billed + pending + estimate ≤ $40, ledger reconciled, exact-cent confirmation;
each launch reserves its estimate and marks the ledger unreconciled again. Time is priced in stages: Modal `startup_timeout`
(300 s) + execution (planned − 300 s) = the orchestrator's hard timeout, so billed time per container ≤ planned.
**Safety invariants (each came from a review finding):** termination is never reported confirmed until a cancel succeeded;
a spawn that outlives its client bound is cancelled on arrival (`LaunchInFlight`/`TerminationPending`); SIGINT/SIGTERM on the server
*and* the rehearse CLI terminate workers before exit (exit 2 + "NOT confirmed terminated" otherwise); a run-level abort key in the progress
Dict stops workers whose handle was lost; hard timeout uses a monotonic clock; qualification requires a saved rehearsal run that validates
against `contracts/live-run.schema.json`. Without credentials the mode is `unavailable` and the UI plays replay.

## Frontend layout (renderer/src)

`shell/` (hash router, mode indicator, artifact gate, provenance legend, theme switch) · `lib/` (`artifacts.ts`, `liveStatus.ts` — the only data access) ·
`design/` (tokens → generated CSS, Plotly/Three themes, primitives, `Gallery`, `DESIGN.md`) · `features/<name>/` (view + `model.ts` data→props logic + thin WebGL/Plotly adapters, lazy-loaded).

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
                 claude-review.yml reviews every PR (needs ANTHROPIC_API_KEY secret)
```

## Directory map

```
main/          backend (Python package labyrinth_main, tests/)
renderer/      frontend (Vite app; src/{shell,design,lib,features/*})
contracts/     JSON Schemas shared by both sides
artifacts/     generated, committed, deterministic JSON consumed by renderer
data/raw/      pinned upstream inputs (+ README provenance)
scripts/       verify.sh, check_boundaries.py, validate_artifacts.py, check_docs.py, hooks/
tasks/         one folder per feature: TASK.md (+ VERIFY.md after verification)
.claude/       settings.json (hooks), agents/ (backend, frontend, design-lead, verifier, reviewer)
```
