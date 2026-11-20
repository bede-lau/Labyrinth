# Verify: 04-budget (backend half only: B1–B5)
Verifier run: 2026-11-19/20 (UTC), commits 76b1908 → fcf812d (HEAD moved during the run; other agents
committed status/geometry/contracts changes only) + uncommitted working tree.
Files under test (uncommitted): `main/labyrinth_main/features/budget/{pricing,model,artifact}.py`,
`main/tests/test_budget.py`, `artifacts/budget.json`.

**Scope.** This verdict covers only the backend outcomes B1–B5. The frontend outcomes B6–B7 are
**not yet built** (`renderer/src/features/budget/` has no tests), so they are not verified. **Task 04
stays not-DONE** until B6–B7 are built and verified by an external verifier, and the reviewer approves.

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| B1 | $1.53 / $13.73 / $21.83 / remaining $18.17 of $40, recomputed, as fixtures | `test_B1_live_demo_ledger_recomputed_with_half_up_cents`: asserts the Decimal ledger (1.525→1.53, 12.20, 13.73, 21.83, 18.17, unrounded 13.725/21.825), all four fixtures `claimed == computed`, `matches is True`, live scenario `derived`/`passed` | Hand Decimal recompute from PRD text (no project import): slot 1.525 → half-up 1.53; 2×6.10+1.53 = 13.73; +8.10 = 21.83; 40−21.83 = 18.17. Artifact fixtures agree. Mutations M1 (rate 6.20), M4 (posted 8.00), M8 (HALF_EVEN), M10 (slot 20 min) all fail B1 | PASS |
| B2 | 161 h × 288 = 46,368 CPU-h | `test_B2_published_stella_cpu_hours` | 161*288 = 46368, artifact fixture 46368/46368 True, scenario `prd-reported`. Mutation M5 (288→256) fails B2 | PASS |
| B3 | 65,700 × 19 s at $9.15/h inside 14–15 d, $3,100–3,200; halved timestep inside 28–30 d, $6,200–6,400 | `test_B3_full_grid_days_and_dollars_inside_prd_ranges` (includes a negative case showing the range check can fail) | Decimal: 346.75 h = 14.447917 d, $3,172.7625 (in range); halved 131,400 steps = 693.5 h = 28.895833 d, $6,345.525 (in range). Mutations M2 (rate 9.50), M3 (19→21 s), M6 (65,700→64,000 steps) fail B3 | PASS |
| B4 | GX benchmark 28 min 1 GPU 4×8; 90 min 4 GPUs 8×16 as `prd-reported` context only | `test_B4_gx_benchmark_is_prd_reported_context_only`: kind `prd-reported`, headline text, moments, fixtures `computed is None`, `matches is None` | Artifact: scenario `gx-benchmark` kind `prd-reported`, outcome `not-applicable`, derivation "None: published figures"; fixtures `computed` null. Mutations M7 (28→30) and M9 (kind→`derived`) fail B4 | PASS |
| B5 | Pricing constants exported for the live budget guard | `test_B5_pricing_constants_exported_for_budget_guard` | Every constant matched against the PRD text (all 16 checks True, both URLs verbatim in PRD); `live_gx/budget_guard.py:19` imports `CEILING_USD, LIVE_RATE_USD_PER_H, LIVE_SLOT_MIN, REHEARSAL_H` from it. `git diff` of pricing.py shows additions only; existing names unchanged | PASS |
| B6 | Ledger bar (frontend) | none yet | — | not yet built |
| B7 | Scenario cards (frontend) | none yet | — | not yet built |

## Real output

### Full gate, first run (HEAD 76b1908)
```
$ bash scripts/verify.sh all ; echo EXIT=$?
━━━ [main:tests] $ python3 -m pytest -q main/tests
65 passed in 6.01s
━━━ [artifacts:schema] $ python3 scripts/validate_artifacts.py
artifacts: schema-valid
━━━ [artifacts:fresh] $ python3 scripts/validate_artifacts.py --check-fresh
artifacts: fresh (byte-identical rebuild)
━━━ [renderer:typecheck] $ npm --prefix renderer run -s typecheck
src/design/components/FixtureCheck.tsx(5,8): error TS2882: Cannot find module or type declarations for side-effect import of './components.css'.
src/design/components/Panel.tsx(2,8): error TS2882: ...
src/design/components/ProvenanceBadge.tsx(7,8): error TS2882: ...
src/design/components/Stat.tsx(4,8): error TS2882: ...
src/design/components/StatusPill.tsx(5,8): error TS2882: ...
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (7s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  FAIL  renderer:typecheck (2s)
  PASS  renderer:tests (2s)
  PASS  renderer:build (0s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2

$ bash scripts/verify.sh main ; echo EXIT=$?      (same tree)
  PASS  boundary:self-test / boundary:scan / scripts:tests / main:lint / main:tests / artifacts:schema / artifacts:fresh
verify.sh: all stages passed.
main EXIT=0
```

### Full gate, second run (HEAD fcf812d, after other agents' edits)
```
$ bash scripts/verify.sh all ; echo EXIT=$?
66 passed in 6.06s                                   (main:tests)
 FAIL  src/design/color.test.ts > CVD simulation matrices > every row sums to ~1, so neutrals stay neutral
AssertionError: expected 6.940973112410856 to be less than 1.5
  PASS  renderer:typecheck (2s)
  FAIL  renderer:tests (2s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2

$ bash scripts/verify.sh main ; echo EXIT=$?      (later still: another agent is mid-edit on geometry)
FAILED main/tests/test_geometry.py::test_reproduces_stella_saved_bmag_to_printed_precision
FAILED main/tests/test_geometry.py::test_artifact_tubes_129_samples_centered
FAILED main/tests/test_geometry.py::test_surface_and_bean_outboard_midplane
FAILED main/tests/test_geometry.py::test_acceptance129_is_blocked_not_passed
E       TypeError: compare() missing 1 required positional argument: 'input_path'
main/labyrinth_main/features/geometry/artifact.py:35: TypeError
  FAIL  main:tests (6s)
  FAIL  artifacts:fresh (1s)      <- same geometry TypeError aborts the full rebuild
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
```
Attribution: every gate failure is in files outside task 04: `renderer/src/design/components/*.tsx`,
`renderer/src/design/color.test.ts` (design-lead, concurrent), and `main/labyrinth_main/features/geometry/*`
with `common/paths.py` (task 01, concurrent). No failure touches `features/budget/` or `test_budget.py`.

### Task tests on their own, and budget.json freshness checked separately
```
$ python3 -m pytest -v -p no:cacheprovider main/tests/test_budget.py main/tests/test_spatial.py
main/tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents PASSED [ 11%]
main/tests/test_budget.py::test_B2_published_stella_cpu_hours PASSED     [ 22%]
main/tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges PASSED [ 33%]
main/tests/test_budget.py::test_B4_gx_benchmark_is_prd_reported_context_only PASSED [ 44%]
main/tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard PASSED [ 55%]
...
============================== 9 passed in 0.03s ===============================
(re-run at HEAD fcf812d with PYTHONDONTWRITEBYTECODE=1: 9 passed in 0.02s)

$ (rebuild budget.build() with common.io.write_json into scratchpad, compare to artifacts/budget.json)
budget.json byte-identical rebuild: True | manifest sha matches file: True

$ python3 scripts/check_boundaries.py
boundary: OK (92 files scanned)
```

### Independent recomputation (scratchpad/v045/probe_budget.py, Decimal, PRD text only)
```
slot exact 1.525 half-up 1.53 half-even 1.52
float round(6.10*15/60,2) = 1.52 repr 1.525 float(1.525) exact = 1.524999999999999911182158029987476766109466552734375
plan: per-item rounded 13.73 | exact 13.725 -> half-up 13.73 half-even 13.72
planned: 21.83 | exact 21.825 -> half-up 21.83 half-even 21.82
remaining 18.17
float round(21.825,2) = 21.82  float(21.825) exact = 21.824999999999999289457264239899814128875732421875
cpu-h 46368
x1: steps 65700 hours 346.75 days 14.447917 usd 3172.7625 | in days range True in usd range True
x2: steps 131400 hours 693.5 days 28.895833 usd 6345.5250 | in days range True in usd range True
artifact top: {'ceilingUsd': 40.0, 'postedUsd': 8.1, 'plannedUsd': 21.83, 'remainingAfterPlanUsd': 18.17}
  fx live-slot-usd 1.53 1.53 True
  fx rehearsals-plus-slot-usd 13.73 13.73 True
  fx planned-usd 21.83 21.83 True
  fx remaining-usd 18.17 18.17 True
  fx stella-published-cpu-h 46368 46368.0 True
  fx full-grid-days 14.5 14.44792 True
  fx full-grid-usd 3150.0 3172.763 True
  fx halved-dt-days 29.0 28.89583 True
  fx halved-dt-usd 6300.0 6345.525 True
  fx gx-1gpu-min 28.0 None None
  fx gx-4gpu-min 90.0 None None
  sc live-demo derived passed | $1.53 for 15 minutes
  sc stella-published prd-reported not-applicable | 161 hours on 288 processors, 46,368 CPU-hours
  sc full-grid-modal derived passed | 14.4 days, $3,173; halved timestep: 28.9 days, $6,346
  sc gx-benchmark prd-reported not-applicable | 28 minutes on one GPU (4 Laguerre × 8 Hermite); 90 minutes on four GPUs (8 × 16)
```

### Pricing constants vs PRD text
```
{'CEILING $40': True, 'POSTED $8.10': True, 'LIVE $6.10/hour': True, 'FULL $9.15/hour': True, '15 minutes': True,
 'two one-hour rehearsals': True, '65,700 steps': True, '19 s/step': True, 'time 1900': True, '161 hours on 288': True,
 '28 minutes one GPU': True, '90 minutes four': True, 'PRICING_URL in PRD': True, 'GX_URL in PRD': True,
 'live resources': True, 'full resources': True}
(40.0, 8.1, 6.1, 9.15, 15, 1.0, 2, 65700, 19.0, 1900, 161, 288, 28, 90)
$ grep -rn pricing main/labyrinth_main (outside budget/)
main/labyrinth_main/features/live_gx/budget_guard.py:19:from ..budget.pricing import CEILING_USD, LIVE_RATE_USD_PER_H, LIVE_SLOT_MIN, REHEARSAL_H
main/labyrinth_main/features/live_gx/service.py:22:from ..budget.pricing import POSTED_USD
main/labyrinth_main/features/live_gx/rehearse.py:21:from ..budget.pricing import REHEARSAL_H
```

### Mutations (on a copy at scratchpad/v045/repo; PYTHONDONTWRITEBYTECODE=1, __pycache__ cleared before each)
A first pass reused stale `.pyc` files: same-size edits made within one second share an mtime, so
Python did not recompile them. That pass is discarded. The rerun with bytecode disabled is below.
```
=== [M1] pricing.py :: > LIVE_RATE_USD_PER_H = 6.20
FAILED tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents
FAILED tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard
2 failed, 3 passed in 0.05s
=== [M2] pricing.py :: > FULL_GRID_RATE_USD_PER_H = 9.50
FAILED tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges
FAILED tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard
2 failed, 3 passed in 0.05s
=== [M3] pricing.py :: > FULL_GRID_S_PER_STEP = 21.0
FAILED tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges
1 failed, 4 passed in 0.05s
=== [M4] pricing.py :: > POSTED_USD = 8.00
FAILED tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents
FAILED tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard
2 failed, 3 passed in 0.05s
=== [M5] pricing.py :: > STELLA_PUBLISHED_PROCESSORS = 256
FAILED tests/test_budget.py::test_B2_published_stella_cpu_hours - assert 4121...
1 failed, 4 passed in 0.05s
=== [M6] pricing.py :: > FULL_GRID_STEPS = 64_000
FAILED tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges
1 failed, 4 passed in 0.05s
=== [M7] pricing.py :: > GX_BENCH_1GPU_MIN = 30
FAILED tests/test_budget.py::test_B4_gx_benchmark_is_prd_reported_context_only
1 failed, 4 passed in 0.05s
=== [M8] model.py :: >     return x.quantize(CENT, rounding="ROUND_HALF_EVEN")
FAILED tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents
1 failed, 4 passed in 0.05s
=== [M9] artifact.py :: >  "derived", solver_revision="GX (published benchmark, §6.2)", units="minutes",
FAILED tests/test_budget.py::test_B4_gx_benchmark_is_prd_reported_context_only
1 failed, 4 passed in 0.05s
=== [M10] pricing.py :: > LIVE_SLOT_MIN = 20
FAILED tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents
FAILED tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard
2 failed, 3 passed in 0.05s
--- control (unmutated copy):
9 passed in 0.05s
```
The live tree was never mutated. Apart from this VERIFY.md, `git status` changed during the run only
through other agents' concurrent edits (`tasks/00-scaffold/VERIFY.md`, `common/paths.py`,
`data/raw/*`, `test_common.py`).

## Findings
1. **Rounding claim: right on half-up, overstated on "per-item"** (`main/labyrinth_main/features/budget/model.py:3-9`,
   `artifact.py:22`). The PRD's $1.53 for an exact 1.525 does establish **half-up** over half-even and
   over binary-float `round()`. Both `round(1.525, 2)` and `round(21.825, 2)` really do give 1.52 and
   21.82, because float(1.525) = 1.52499999…; confirmed above. But the PRD does not show that rounding
   happens **per item before summing**. Rounding the exact totals once, half-up, gives the same
   13.725 → 13.73 and 21.825 → 21.83. "The PRD's own convention" holds for half-up only. Per-item
   rounding is the author's choice, consistent with the PRD but not shown by it. The numbers are not
   affected. Suggest rewording.
2. `remaining-usd` 18.17 comes from TASK.md B1, not from the PRD. The PRD only says "within the remaining $40"
   (PRD.md:31). The artifact discloses this honestly (`artifact.py:15`, fixture note), so this is
   not a defect.
3. Range fixtures put the PRD range's **midpoint** in `claimed` (`artifact.py:39`). The label and
   note say so, but the frontend (B7) must not show 14.5 d / $3,150 as a PRD-printed number.
4. `full-grid-modal` is labelled `derived` (`artifact.py:132`). Its arithmetic is recomputed, but its
   inputs (65,700 steps, 19 s/step) are PRD-reported estimates. The interpretation text says so.
   Acceptable.
5. Weak assertion (does not block): `test_budget.py:80` compares the artifact's `rateUsdPerH` with the
   same constant it was built from, so it is close to tautological. B5 is still covered by the
   literal pins on lines 75–79, and mutations M1/M2/M4/M10 confirm they fail.
6. Gate status: `verify.sh all` exited 2 on both runs, and `verify.sh main` passed on the first run
   and exited 2 on the second. Every failure is in files outside task 04 (attributed above).
   verifier.md's strict rule says PASS requires verify.sh to exit 0. Per the orchestrator's
   instruction, this verdict covers the task-04 backend only, judged on its own tests, its
   byte-identical artifact rebuild, the boundary check, and the probes. The whole repo gate must be
   green before task 04 can be marked DONE.
7. B6–B7 are not yet built. Task 04 remains not-DONE until the frontend is verified.

Verdict: PASS
