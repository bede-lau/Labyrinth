# Verify: 04-budget
Run 1 (below) covers outcomes B1–B5 (`main/`). **Run 2 at the end of this file covers the whole task, B1–B7,
and its verdict is the last line of the file.** Editorial note from Run 2: the text of Run 1 is kept as
written, except that the title, the scope paragraph, the B6/B7 table rows and findings 6–7 were reworded,
because `scripts/check_docs.py:46` reads their original wording as a partial verification. Their meaning is
unchanged: Run 1 verified B1–B5 only, and B6–B7 did not exist then.

Verifier run (Run 1): 2026-11-19/20 (UTC), commits 76b1908 → fcf812d (HEAD moved during the run; other agents
committed status/geometry/contracts changes only) + uncommitted working tree.
Files under test (uncommitted): `main/labyrinth_main/features/budget/{pricing,model,artifact}.py`,
`main/tests/test_budget.py`, `artifacts/budget.json`.

**Scope of Run 1.** The Run 1 verdict covers only outcomes B1–B5 (`main/`). The frontend outcomes B6–B7
**did not exist at the time of Run 1** (`renderer/src/features/budget/` had no tests), so Run 1 did not
verify them. **Task 04 stayed not-DONE** until B6–B7 were built and verified by an external verifier, and
the reviewer approved. They are verified in Run 2 below.

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| B1 | $1.53 / $13.73 / $21.83 / remaining $18.17 of $40, recomputed, as fixtures | `test_B1_live_demo_ledger_recomputed_with_half_up_cents`: asserts the Decimal ledger (1.525→1.53, 12.20, 13.73, 21.83, 18.17, unrounded 13.725/21.825), all four fixtures `claimed == computed`, `matches is True`, live scenario `derived`/`passed` | Hand Decimal recompute from PRD text (no project import): slot 1.525 → half-up 1.53; 2×6.10+1.53 = 13.73; +8.10 = 21.83; 40−21.83 = 18.17. Artifact fixtures agree. Mutations M1 (rate 6.20), M4 (posted 8.00), M8 (HALF_EVEN), M10 (slot 20 min) all fail B1 | PASS |
| B2 | 161 h × 288 = 46,368 CPU-h | `test_B2_published_stella_cpu_hours` | 161*288 = 46368, artifact fixture 46368/46368 True, scenario `prd-reported`. Mutation M5 (288→256) fails B2 | PASS |
| B3 | 65,700 × 19 s at $9.15/h inside 14–15 d, $3,100–3,200; halved timestep inside 28–30 d, $6,200–6,400 | `test_B3_full_grid_days_and_dollars_inside_prd_ranges` (includes a negative case showing the range check can fail) | Decimal: 346.75 h = 14.447917 d, $3,172.7625 (in range); halved 131,400 steps = 693.5 h = 28.895833 d, $6,345.525 (in range). Mutations M2 (rate 9.50), M3 (19→21 s), M6 (65,700→64,000 steps) fail B3 | PASS |
| B4 | GX benchmark 28 min 1 GPU 4×8; 90 min 4 GPUs 8×16 as `prd-reported` context only | `test_B4_gx_benchmark_is_prd_reported_context_only`: kind `prd-reported`, headline text, moments, fixtures `computed is None`, `matches is None` | Artifact: scenario `gx-benchmark` kind `prd-reported`, outcome `not-applicable`, derivation "None: published figures"; fixtures `computed` null. Mutations M7 (28→30) and M9 (kind→`derived`) fail B4 | PASS |
| B5 | Pricing constants exported for the live budget guard | `test_B5_pricing_constants_exported_for_budget_guard` | Every constant matched against the PRD text (all 16 checks True, both URLs verbatim in PRD); `live_gx/budget_guard.py:19` imports `CEILING_USD, LIVE_RATE_USD_PER_H, LIVE_SLOT_MIN, REHEARSAL_H` from it. `git diff` of pricing.py shows additions only; existing names unchanged | PASS |
| B6 | Ledger bar (frontend) | none at the time of Run 1 | — | outside Run 1; see Run 2 |
| B7 | Scenario cards (frontend) | none at the time of Run 1 | — | outside Run 1; see Run 2 |

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
   instruction, this verdict covers outcomes B1–B5 of task 04, judged on their own tests, the
   byte-identical artifact rebuild, the boundary check, and the probes. The whole repo gate must be
   green before task 04 can be marked DONE.
7. B6–B7 did not exist at the time of Run 1. Task 04 remained not-DONE until the frontend was verified
   (see Run 2 below).

Verdict: PASS


(The line above is the Run 1 verdict and covers B1–B5. The verdict for the whole task is the last line of this file.)

## Run 2 — whole task (2026-11-20, commit 2b1607e)
Verifier run: 2026-11-20, commit 2b1607e. `git status --porcelain` was empty at the start, so the tree under
test equals the commit. By the end other agents had modified `main/labyrinth_main/features/live_gx/*`,
`main/labyrinth_main/server/__main__.py`, `scripts/*`, `status.md` and other tasks' VERIFY.md files. No file
of task 04 changed: the sha256 of every task file is the same at the start, at the end, and in the probe copy.

Where each thing ran:
- **Shared tree** `/mnt/d/Labyrinth` (read-only use): the task's own tests, `verify.sh renderer`,
  `check_boundaries.py`, the backend probe, read-only git.
- **Isolated copy** `/home/qqbot/.cache/labyrinth-probes/v0304` (from `scripts/probe-copy.sh v0304`, taken at
  the start): `verify.sh all`, every mutation, the guard probe and the verifier's own probe tests. Deleted at
  the end.
- **Built app** at `http://127.0.0.1:4173` (vite preview of `renderer/dist`): headless Edge screenshots at
  800, 1024, 1440 and 1920 px, and layout measurements in a real browser at 1440 px.

The verifier wrote only this file and `tasks/03-forecast/VERIFY.md`.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| B1 | 15 min at $6.10/h → $1.53; two 1-h rehearsals + one slot → $13.73; + $8.10 posted → $21.83; remaining $18.17 of $40 | `test_B1_live_demo_ledger_recomputed_with_half_up_cents` (re-run, passed) | Decimal recompute typed from the PRD text, no project import: 1.525 → 1.53 (half-up), 12.20, 13.73, 21.83, 18.17. Artifact top level 40.0 / 8.1 / 21.83 / 18.17 agrees; the four fixtures have claimed = computed. BE-B1 (rate 6.20) goes red. `git log` on `main/labyrinth_main/features/budget`, `main/tests/test_budget.py`, `artifacts/budget.json`: last change is 80888d4, the commit that recorded the tree Run 1 verified; `git diff 80888d4 HEAD` on those paths is empty; `artifacts:fresh` rebuilds byte-identically | PASS |
| B2 | 161 h × 288 = 46,368 CPU-h | `test_B2_published_stella_cpu_hours` (passed) | 161 × 288 = 46368; fixture 46368 / 46368.0, `matches:true`; scenario `prd-reported` | PASS |
| B3 | Full grid inside 14–15 d and $3,100–3,200; halved timestep inside 28–30 d and $6,200–6,400 | `test_B3_full_grid_days_and_dollars_inside_prd_ranges` (passed) | Decimal: 346.75 h = 14.447917 d, $3,172.7625; halved 693.5 h = 28.895833 d, $6,345.5250. All four are inside their PRD range, and `claimed` is the midpoint in all four. BE-B2 (range fixture always matches) goes red | PASS |
| B4 | GX benchmark as `prd-reported` context only | `test_B4_gx_benchmark_is_prd_reported_context_only` (passed) | Artifact: `gx-1gpu-min` and `gx-4gpu-min` have `computed: null`, `matches: null`; scenario `prd-reported` / `not-applicable`. BE-B3 (a computed 28.0 invented) goes red | PASS |
| B5 | Pricing constants exported for the live budget guard | `test_B5_pricing_constants_exported_for_budget_guard` (passed) | `live_gx/budget_guard.py:19` imports them. The guard returns slot 2.65 and rehearsal 7.73, and posted + 2 rehearsals + slot = 26.21, as D-015 states | PASS |
| B6 | Ledger bar to the $40 ceiling: posted, planned, remaining | `renderer/src/features/budget/BudgetView.test.tsx` › "B6 ledger bar to the $40 ceiling: posted, planned, remaining; live guard estimate distinguished from PRD GPU-only". Real component and real artifact through a stubbed `fetch`; `/api/live/status` is served once as unreachable and once as answering. Not tautological. Passed alone | As rendered: "Modal ledger against the $40.00 ceiling: Posted earlier $8.10, Planned: 2 rehearsals + 1 live slot $13.73, Remaining $18.17. Planned total $21.83."; bar widths 20.25 / 34.325 / 45.425 %. It follows the data: with the artifact changed to 50 / 9.99 / 30.5 / 19.5 the bar reads $50.00, $9.99, $20.51, $19.50, $30.50 at 19.98 / 41.02 / 39 %. No PRD figure is hard-coded in `renderer/src/features/budget` (grep). With the guard answering (billed 36.00, pending 2.00, slot 3.11, fits false) the panel shows "Remaining after that slot $-1.11" and "Next slot does NOT fit — replay only". Screenshots at 800–1920 px: the ledger and guard panels are laid out correctly. Mutations BM5, BM14, BM16 red; **BM4, BM17, BM18 stay green** | PASS (finding 2) |
| B7 | Scenario cards with headline, derivation and interpretation; prd-reported vs derived distinguished | same file › "B7 scenario cards show headline, derivation and interpretation; PRD-reported vs derived; ranges never midpoints". Passed alone | Content is right: each of the 4 cards shows its headline, derivation and interpretation from the artifact, eyebrow "Derived estimate" / "PRD-reported context", a kind pill in the headline and a badge ("Derived, Verified" / "PRD-reported, Not applicable"); flipping a scenario's provenance in the artifact flips the card. BM8, BM11, BM12, BM13 red; BM10 green. **Layout is not right: in the built app at 1024, 1440 and 1920 px every fixture row inside the cards overlaps its own label, and the range rows' outcome is cut off** (finding 1). At 800 px, where the cards are one column, the same rows are clean | **FAIL** (finding 1) |
| PRD vs guard | The PRD's GPU-only plan ($1.53 / $13.73 / $21.83) and the guard's plan ($2.65 / $7.73 / $26.21, D-015) both shown and labelled, not conflated | part of the B6 test | Table headed "PRD (GPU time only)" and "Guard (incl. setup, idle, storage)": 15-min live slot $1.53 vs "$2.65 · decision.md · D-015"; one-hour rehearsal $6.10 vs "$7.73 · decision.md · D-015"; planned total incl. $8.10 posted $21.83 vs "$26.21 · decision.md · D-015". $13.73 is in the ledger. When the API answers, the slot cell reads "$3.11 · from /api/live/status". The three guard constants in `model.ts:81-88` equal the backend guard and D-015. BM6, BM6b red; **BM7, BM15 stay green** | PASS (findings 2, 4) |
| ranges | Range fixtures: the midpoint in `claimed` is never rendered as a PRD figure; the range comes from the label / note; `matches` means inside the range (interface.md §2 item 7) | part of the B7 test | As rendered: "PRD range 14–15 days, Computed 14.45 days, Inside PRD range"; "3,100–3,200 USD, 3,173 USD"; "28–30 days, 28.90 days"; "6,200–6,400 USD, 6,346 USD". The tokens 14.5, 3,150, 3150, 29.0, "29 days", 6,300 and 6300 occur nowhere in the page text or attributes. Mutated artifacts: `matches:false` with the computed value inside → "Outside PRD range … The match flag disagrees with the range test"; `matches:null` → "Not recomputable"; computed 15.2 → "Outside PRD range" whatever the flag says; computed null → "computed —". BM1, BM2a red; **BM2b, BM3, BM3b, BM3c stay green** | Logic PASS; display hit by finding 1; tests weak (finding 2) |
| prd-reported | Items with `prd-reported` provenance and `computed: null` show no invented computed value | last assertion of the B7 test | GX rows: "Not recomputable. Claimed 28 min, computed value not available", computed cell "—", Δ "—". Published stella: "Match. Claimed 46368 CPU-h, computed 46368 CPU-h" with the note "Arithmetic recomputed; inputs are PRD-reported". BM9 (computed invented from claimed) goes red | PASS |
| gate | `verify.sh` exits 0 | — | `verify.sh all` in the copy: first attempt exit 2, because vitest could not start 14 of 19 worker processes while the machine's load average was 27.9; no assertion failed, and the budget file was among the 5 that ran and passed. Re-run: **exit 0**, 11 stages PASS, 582 renderer tests, 105 backend tests. `verify.sh renderer` on the shared tree: **exit 0**, 19 files, 582 tests | PASS |
| boundary | `scripts/check_boundaries.py` | — | `boundary: OK (142 files scanned)` | PASS |

### Real output
```
$ wsl.exe -e bash scripts/dev.sh python3 --version
Python 3.12.3

# read-only git, shared tree (scratch script gitinfo.sh)
$ git rev-parse --short HEAD
2b1607e
$ git log --oneline -- main/labyrinth_main/features/budget main/tests/test_budget.py artifacts/budget.json
80888d4 Backend data features: geometry, transport, forecast, budget, spatial (verified)
1cdc976 Add shared pricing constants and GX unit conversion for parallel agents
ecf14d5 Scaffold Labyrinth: process boundary, exit-2 verify loop, contracts, agents
$ git log --oneline -- renderer/src/features/budget
407827f Frontend WIP: app shell and six feature views (UNVERIFIED, incomplete)
ecf14d5 Scaffold Labyrinth: process boundary, exit-2 verify loop, contracts, agents
$ git diff --stat 80888d4 HEAD -- main/labyrinth_main/features/forecast main/labyrinth_main/features/budget main/tests/test_forecast.py main/tests/test_budget.py artifacts/forecast.json artifacts/budget.json main/labyrinth_main/features/transport/stats.py
(no output)
$ git status --porcelain      (at the start)
(no output)

$ wsl.exe -e bash scripts/dev.sh python3 -m pytest -v -p no:cacheprovider main/tests/test_forecast.py main/tests/test_budget.py      (shared tree)
main/tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents PASSED [ 55%]
main/tests/test_budget.py::test_B2_published_stella_cpu_hours PASSED     [ 66%]
main/tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges PASSED [ 77%]
main/tests/test_budget.py::test_B4_gx_benchmark_is_prd_reported_context_only PASSED [ 88%]
main/tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard PASSED [100%]
============================== 9 passed in 0.60s ===============================
EXIT=0

$ wsl.exe -e bash scripts/dev.sh npm --prefix renderer run -s test -- src/features/forecast src/features/budget --reporter=verbose      (shared tree; colour codes removed)
 ✓ src/features/budget/BudgetView.test.tsx > B6 ledger bar to the $40 ceiling: posted, planned, remaining; live guard estimate distinguished from PRD GPU-only 458ms
 ✓ src/features/budget/BudgetView.test.tsx > B7 scenario cards show headline, derivation and interpretation; PRD-reported vs derived; ranges never midpoints 129ms
 Test Files  2 passed (2)
      Tests  4 passed (4)
EXIT=0

$ wsl.exe -e bash scripts/dev.sh python3 <scratch>/probe_backend.py      (Decimal, constants typed from the PRD text, no labyrinth_main import)
=== 04 budget: Decimal recomputation from PRD constants (typed here, not imported)
slot exact 1.525 -> 1.53 | rehearsals 12.20 | plan 13.73 | planned 21.83 | remaining 18.17
artifact top: 40.0 8.1 21.83 18.17
artifact top agrees with Decimal recompute: True
x1 hours 346.75 days 14.447917 usd 3172.7625
halved dt hours 693.5 days 28.895833 usd 6345.5250
cpu-h 46368
guard (D-015): slot = ceil_cent(6.10*(15+5+5)/60 + 0.10); rehearsal = ceil_cent(6.10*(60+2*5+5)/60 + 0.10)
 guard slot 2.65 guard rehearsal 7.73 guard planned 26.21
 fx live-slot-usd              claimed 1.53     computed 1.53       matches True  dp 2
 fx rehearsals-plus-slot-usd   claimed 13.73    computed 13.73      matches True  dp 2
 fx planned-usd                claimed 21.83    computed 21.83      matches True  dp 2
 fx remaining-usd              claimed 18.17    computed 18.17      matches True  dp 2
 fx stella-published-cpu-h     claimed 46368    computed 46368.0    matches True  dp 0
 fx full-grid-days             claimed 14.5     computed 14.44792   matches True  dp 0 | inside PRD range (14, 15): True | claimed is midpoint: True
 fx full-grid-usd              claimed 3150.0   computed 3172.763   matches True  dp 0 | inside PRD range (3100, 3200): True | claimed is midpoint: True
 fx halved-dt-days             claimed 29.0     computed 28.89583   matches True  dp 0 | inside PRD range (28, 30): True | claimed is midpoint: True
 fx halved-dt-usd              claimed 6300.0   computed 6345.525   matches True  dp 0 | inside PRD range (6200, 6400): True | claimed is midpoint: True
 fx gx-1gpu-min                claimed 28.0     computed None       matches None  dp 0
 fx gx-4gpu-min                claimed 90.0     computed None       matches None  dp 0
 sc live-demo          derived      passed          units=USD        | $1.53 for 15 minutes
 sc stella-published   prd-reported not-applicable  units=CPU-hours  | 161 hours on 288 processors, 46,368 CPU-hours
 sc full-grid-modal    derived      passed          units=days, USD  | 14.4 days, $3,173; halved timestep: 28.9 days, $6,346
 sc gx-benchmark       prd-reported not-applicable  units=minutes    | 28 minutes on one GPU (4 Laguerre × 8 Hermite); 90 minutes on four GPUs (8 × 16)

$ cd <copy>/main && PYTHONDONTWRITEBYTECODE=1 python3 <scratch>/guard_probe.py
backend guard: slot 2.65 | rehearsal 7.73 | posted + 2 rehearsals + slot = 26.21
renderer GUARD_PLAN_D015: {'slotUsd': 2.65, 'rehearsalUsd': 7.73, 'plannedUsd': 26.21}
decision.md D-015 mentions $2.65: True | $7.73: True | $26.21: True
agree: True
renderer tests that tie the constants to decision.md or the backend: []

$ python3 <scratch>/mutate_backend.py      (copy only; __pycache__ cleared and PYTHONDONTWRITEBYTECODE=1 for every run)
### control: (0, '4 passed in 0.11s') (0, '5 passed in 0.03s')
### BE-B1 live rate 6.10 -> 6.20 -> exit=1 RED (killed)
    FAILED main/tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents
    FAILED main/tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard
    2 failed, 3 passed in 0.04s
### BE-B2 range fixture always matches -> exit=1 RED (killed)
    FAILED main/tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges
    1 failed, 4 passed in 0.04s
### BE-B3 GX benchmark given a computed value -> exit=1 RED (killed)
    FAILED main/tests/test_budget.py::test_B4_gx_benchmark_is_prd_reported_context_only
    1 failed, 4 passed in 0.04s
restore check main/labyrinth_main/features/budget/artifact.py: copy 127fc2c3ceed shared 127fc2c3ceed same=True
restore check main/labyrinth_main/features/budget/pricing.py: copy 5babb3f5b0e8 shared 5babb3f5b0e8 same=True
### control after restore: (0, '4 passed in 0.11s') (0, '5 passed in 0.04s')

# Verifier's probe test (copied into the copy as renderer/src/features/budget/zz_probe.test.tsx, run, removed)
PROBE-B6 bar name: Modal ledger against the $40.00 ceiling: Posted earlier $8.10, Planned: 2 rehearsals + 1 live slot $13.73, Remaining $18.17. Planned total $21.83.
PROBE-B6 compare row: Item | PRD (GPU time only) | Guard (incl. setup, idle, storage)
PROBE-B6 compare row: 15-min live slot | $1.53 | $2.65 · decision.md · D-015
PROBE-B6 compare row: One-hour rehearsal | $6.10 | $7.73 · decision.md · D-015
PROBE-B6 compare row: Planned total incl. $8.10 posted | $21.83 | $26.21 · decision.md · D-015
PROBE-B6 mutated bar name: Modal ledger against the $50.00 ceiling: Posted earlier $9.99, Planned: 2 rehearsals + 1 live slot $20.51, Remaining $19.50. Planned total $30.50.
PROBE-B6 mutated widths: 19.98% 41.02% 39%
PROBE-B6 mutated compare row: Planned total incl. $9.99 posted | $30.50 | $26.21 · decision.md · D-015
PROBE-B6 live guard text: Billed (ledger)$36.00Pending$2.00Next live slot (guard estimate)$3.11Remaining after that slot$-1.11Next slot does NOT fit — replay only · hard timeout 1500 s
PROBE-B6 live compare row: 15-min live slot | $1.53 | $3.11 · from /api/live/status
PROBE-B6 live compare row: One-hour rehearsal | $6.10 | $7.73 · decision.md · D-015
PROBE-B6 live compare row: Planned total incl. $8.10 posted | $21.83 | $26.21 · decision.md · D-015
PROBE-B7 card [live-demo] ... | badge: Provenance of Live demo: Derived, Verified
PROBE-B7   row: Live slot, 15 min at $6.10/h: Match. Claimed 1.53 USD, computed 1.53 USD, difference 0.00
PROBE-B7   row: Remaining of the $40 ceiling after the plan: Match. Claimed 18.17 USD, computed 18.17 USD, difference 0.00 | text: Remaining of the $40 ceiling after the plan40.00 − 21.83; value from tasks/04-budget/TASK.md (the PRD implies it but does not print it).Claimed (PRD)18.17Computed18.17USDΔ0.00Match
PROBE-B7 card [stella-published] ... | badge: Provenance of Published full-resolution stella bean tube: PRD-reported, Not applicable
PROBE-B7   row: Published stella bean: 161 h × 288 processors: Match. Claimed 46368 CPU-h, computed 46368 CPU-h, difference 0
PROBE-B7 card [full-grid-modal] ... | badge: Provenance of Full-grid stella on Modal to normalized time 1900: Derived, Verified
PROBE-B7   row: Full-grid stella wall time: Inside PRD range. PRD range 14 to 15 days, computed 14.45 days | text: Full-grid stella wall timeThe PRD prints only a range; compared by range, not by rounding.PRD range14–15 daysComputed14.45 daysInside PRD range
PROBE-B7   row: Full-grid stella cost: Inside PRD range. PRD range 3,100 to 3,200 USD, computed 3,173 USD
PROBE-B7   row: Full-grid wall time, halved timestep: Inside PRD range. PRD range 28 to 30 days, computed 28.90 days
PROBE-B7   row: Full-grid cost, halved timestep: Inside PRD range. PRD range 6,200 to 6,400 USD, computed 6,346 USD
PROBE-B7 card [gx-benchmark] ... | badge: Provenance of Published GPU-native GX bean benchmark: PRD-reported, Not applicable
PROBE-B7   row: GX bean benchmark, 1 GPU, 4×8: Not recomputable. Claimed 28 min, computed value not available | text: ...Claimed (PRD)28Computed—minΔ—Not recomputable
PROBE-B7   row: GX bean benchmark, 4 GPUs, 8×16: Not recomputable. Claimed 90 min, computed value not available
PROBE-B7 midpoint-ish token "14.5" present anywhere: false
PROBE-B7 midpoint-ish token "3,150" present anywhere: false
PROBE-B7 midpoint-ish token "3150" present anywhere: false
PROBE-B7 midpoint-ish token "6,300" present anywhere: false
PROBE-B7 midpoint-ish token "6300" present anywhere: false
PROBE-B7 midpoint-ish token "29.0" present anywhere: false
PROBE-B7 midpoint-ish token "29 days" present anywhere: false
PROBE-B7 midpoint-ish token "15 days" present anywhere: true        <- from "14–15 days"
PROBE-B7 [range matches:false, computed inside] -> name="Full-grid stella wall time: Outside PRD range. PRD range 14 to 15 days, computed 14.45 days. The match flag disagrees with the range test." outcome=outside
PROBE-B7 [range matches:null, computed inside] -> name="Full-grid stella wall time: Not recomputable. PRD range 14 to 15 days, computed 14.45 days" outcome=unknown
PROBE-B7 [range computed 15.2 (outside), matches:false] -> name="Full-grid stella wall time: Outside PRD range. PRD range 14 to 15 days, computed 15.20 days" outcome=outside
PROBE-B7 [range computed 15.2 (outside) but matches:true] -> name="Full-grid stella wall time: Outside PRD range. PRD range 14 to 15 days, computed 15.20 days. The match flag disagrees with the range test." outcome=outside
PROBE-B7 [range computed 14.999, matches:true] -> name="Full-grid stella wall time: Inside PRD range. PRD range 14 to 15 days, computed 15.00 days" outcome=inside
PROBE-B7 [range computed null, matches null] -> name="Full-grid stella cost: Not recomputable. PRD range 3,100 to 3,200 USD, computed — USD" outcome=unknown
PROBE-B7 [range usd computed 3250.4 matches:false] -> name="Full-grid stella cost: Outside PRD range. PRD range 3,100 to 3,200 USD, computed 3,250 USD" outcome=outside
PROBE-B7 [range label loses the range text (note keeps it)] -> name="Full-grid wall time, halved timestep: Inside PRD range. PRD range 28 to 30 days, computed 28.90 days" outcome=inside
PROBE-B7 [range label AND note lose the range text] -> name="Full-grid wall time, halved timestep: Match. Claimed 29 days, computed 29 days, difference 0" outcome=match text="Full-grid wall time, halved timestepmidpointClaimed (PRD)29Computed29daysΔ0Match"
PROBE-B7 [ordinary fixture computed 1.52, matches:false] -> name="Live slot, 15 min at $6.10/h: Mismatch. Claimed 1.53 USD, computed 1.52 USD, difference minus 0.01" outcome=mismatch
PROBE-B7 [ordinary fixture computed 1.52 but matches:true] -> name="Live slot, 15 min at $6.10/h: Mismatch. Claimed 1.53 USD, computed 1.52 USD, difference minus 0.01. The match flag disagrees with the printed values." outcome=mismatch
PROBE-B7 [ordinary fixture matches:null] -> name="Planned incl. $8.10 posted: Not recomputable. Claimed 21.83 USD, computed 21.83 USD, difference 0.00" outcome=unknown
PROBE-B7 [gx computed 31, matches false] -> name="GX bean benchmark, 1 GPU, 4×8: Mismatch. Claimed 28 min, computed 31 min, difference +3" outcome=mismatch
PROBE-B7 [scenario kind flipped to derived/failed] -> ... | card data-kind=derived badge=Provenance of Published GPU-native GX bean benchmark: Derived, Failed header=Derived estimatePublished GPU-native GX bean benchmarkDerivedFailed...
 Test Files  2 passed (2)
      Tests  9 passed (9)
(Lines with "..." are shortened; everything else is verbatim.)

# Built app, real browser (Browser pane, http://127.0.0.1:4173/#/budget, viewport 1440 px): layout measurements
{"innerWidth":1440,"cards":[448,448,448,448],"fixtures":[
 {"name":"Live slot, 15 min at $6.10/h","rowW":406,"rowH":330,"labelW":0,"textOverlaps":3,"outcomeOverflowPx":9},
 {"name":"Two 1-h rehearsals + one live sl","rowW":406,"rowH":962,"labelW":0,"textOverlaps":2,"outcomeOverflowPx":9},
 {"name":"Planned incl. $8.10 posted","rowW":406,"rowH":978,"labelW":0,"textOverlaps":4,"outcomeOverflowPx":9},
 {"name":"Remaining of the $40 ceiling aft","rowW":406,"rowH":434,"labelW":0,"textOverlaps":3,"outcomeOverflowPx":9},
 {"name":"Published stella bean: 161 h × 2","rowW":406,"rowH":274,"labelW":0,"textOverlaps":2,"outcomeOverflowPx":9},
 {"name":"GX bean benchmark, 1 GPU, 4×8","rowW":406,"rowH":346,"labelW":0,"textOverlaps":4,"outcomeOverflowPx":9},
 {"name":"GX bean benchmark, 4 GPUs, 8×16","rowW":406,"rowH":346,"labelW":0,"textOverlaps":4,"outcomeOverflowPx":9}]}
{"innerWidth":1440,"docScrollW":1463,"ranges":[
 {"name":"Full-grid stella wall time","rangeText":"14–15 days","rangeRight":1212,"computedLeft":1243,"rangeOverlapsComputedPx":-30,"outcomeLeft":1343,"outcomeRight":1463,"outcomeWidthPx":120,"rowRight":1380,"cardRight":1401,"cardOverflow":"visible"},
 {"name":"Full-grid stella cost","rangeText":"3,100–3,200 USD","rangeRight":1248,"computedLeft":1243,"rangeOverlapsComputedPx":5,"outcomeLeft":1343,"outcomeRight":1463,"outcomeWidthPx":120,"rowRight":1380,"cardRight":1401,"cardOverflow":"visible"},
 {"name":"Full-grid wall time, halved timestep","rangeText":"28–30 days","rangeRight":1212,"computedLeft":1243,"rangeOverlapsComputedPx":-30,"outcomeLeft":1343,"outcomeRight":1463,"outcomeWidthPx":120,"rowRight":1380,"cardRight":1401,"cardOverflow":"visible"},
 {"name":"Full-grid cost, halved timestep","rangeText":"6,200–6,400 USD","rangeRight":1248,"computedLeft":1243,"rangeOverlapsComputedPx":5,"outcomeLeft":1343,"outcomeRight":1463,"outcomeWidthPx":120,"rowRight":1380,"cardRight":1401,"cardOverflow":"visible"}]}
(keys reordered for reading, values verbatim. labelW = width of the label column; textOverlaps = number of
 text rectangles of the claimed / computed / Δ / outcome cells that intersect a text rectangle of the label
 or note; outcomeRight 1463 > viewport 1440 > cardRight 1401 > rowRight 1380.)
Headless Edge screenshots (--window-size=1024 / 1440 / 1920): the same picture. Label and note break one word
per line, "Claimed (PRD)" and the claimed value are drawn on top of the note, the range rows end in
"Inside PRD r" (1440) or "Inside PRD" (1920), and "3,100–3,200 USD" runs into "3,173 USD". At 800 px the
cards are one column and all rows are clean.

# Mutations of the implementation (copy only). Each: apply, run BudgetView.test.tsx alone, restore.
$ python3 <scratch>/mutate.py budget
### control (unmutated copy) renderer/src/features/budget/BudgetView.test.tsx
exit=0
    ✓ src/features/budget/BudgetView.test.tsx > B6 ledger bar to the $40 ceiling: posted, planned, remaining; live guard estimate distinguished from PRD GPU-only 259ms
    ✓ src/features/budget/BudgetView.test.tsx > B7 scenario cards show headline, derivation and interpretation; PRD-reported vs derived; ranges never midpoints 77ms
### BM1 range path disabled: range fixtures rendered as claimed vs computed [renderer/src/features/budget/BudgetView.tsx:267] -> exit=1 RED (killed)
    TestingLibraryElementError: Unable to find an element by: [data-testid="range-full-grid-days"]
### BM2a midpoint added to every range row [renderer/src/features/budget/BudgetView.tsx:283] -> exit=1 RED (killed)
### BM2b midpoint added to the days range rows only [renderer/src/features/budget/BudgetView.tsx:283] -> exit=0 GREEN (SURVIVED)
### BM3 range outcome hard-coded to inside [renderer/src/features/budget/BudgetView.tsx:270] -> exit=0 GREEN (SURVIVED)
### BM3b inside ignores the range test (flag only) [renderer/src/features/budget/model.ts:121] -> exit=0 GREEN (SURVIVED)
### BM3c inside ignores the matches flag (range test only) [renderer/src/features/budget/model.ts:121] -> exit=0 GREEN (SURVIVED)
### BM4 posted hard-coded to 8.1 instead of the artifact [renderer/src/features/budget/model.ts:38] -> exit=0 GREEN (SURVIVED)
### BM5 remaining computed as ceiling - posted [renderer/src/features/budget/model.ts:40] -> exit=1 RED (killed)
### BM6 guard planned total replaced by the PRD planned total [renderer/src/features/budget/BudgetView.tsx:193] -> exit=1 RED (killed)
### BM6b PRD column shows the guard slot price [renderer/src/features/budget/BudgetView.tsx:175] -> exit=1 RED (killed)
    TestingLibraryElementError: Unable to find an element with the text: $1.53.
### BM7 PRD / Guard column headers swapped [renderer/src/features/budget/BudgetView.tsx:168] -> exit=0 GREEN (SURVIVED)
### BM8 scenario kind pill hard-coded to derived [renderer/src/features/budget/BudgetView.tsx:234] -> exit=1 RED (killed)
### BM9 computed invented for prd-reported fixtures (null -> claimed) [renderer/src/features/budget/BudgetView.tsx:267] -> exit=1 RED (killed)
    TestingLibraryElementError: Unable to find an accessible element with the role "group" and name `/^GX bean benchmark, 1 GPU, 4×8: Not recomputable/`
### BM10 scenario provenance badge (kind + verification outcome) removed [renderer/src/features/budget/BudgetView.tsx:230] -> exit=0 GREEN (SURVIVED)
### BM11 headline dropped [renderer/src/features/budget/BudgetView.tsx:235] -> exit=1 RED (killed)
### BM12 derivation dropped [renderer/src/features/budget/BudgetView.tsx:239] -> exit=1 RED (killed)
### BM13 interpretation dropped [renderer/src/features/budget/BudgetView.tsx:241] -> exit=1 RED (killed)
### BM14 bar scaled to a hard-coded 50 instead of the ceiling [renderer/src/features/budget/model.ts:35] -> exit=1 RED (killed)
    AssertionError: expected 80 to be close to 100, received difference is 20, but expected 5e-7
### BM15 D-015 slot figure labelled as coming from /api/live/status when the API is unreachable [renderer/src/features/budget/BudgetView.tsx:178] -> exit=0 GREEN (SURVIVED)
### BM16 planned total in the legend replaced by the ceiling [renderer/src/features/budget/BudgetView.tsx:119] -> exit=1 RED (killed)
### BM17 posted labelled derived instead of PRD-reported [renderer/src/features/budget/BudgetView.tsx:113] -> exit=0 GREEN (SURVIVED)
### BM18 ceiling in the title hard-coded [renderer/src/features/budget/BudgetView.tsx:86] -> exit=0 GREEN (SURVIVED)
### restore check (copy vs shared tree)
    renderer/src/features/budget/BudgetView.tsx: copy e51f0e70b489 shared e51f0e70b489 same=True
    renderer/src/features/budget/model.ts: copy 47909b5cd186 shared 47909b5cd186 same=True
### control after restore: exit=0
(12 of 22 red, 10 green: BM2b, BM3, BM3b, BM3c, BM4, BM7, BM10, BM15, BM17, BM18. The error lines are shortened; the mutation lines are verbatim.)

# Gates
$ cd /home/qqbot/.cache/labyrinth-probes/v0304 && bash scripts/verify.sh all      (copy, first attempt, load average 27.88)
Error: [vitest-pool]: Failed to start forks worker for test files /home/qqbot/.cache/labyrinth-probes/v0304/renderer/src/features/live-gx/LiveView.test.tsx.
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
   (the same for App, components, SpatialView, GeometryView, contracts, ArtifactGate, lib, noHardcodedColors, contrast, palette, themes, color, designDoc)
 ✓ src/features/budget/BudgetView.test.tsx (2 tests) 476ms
 Test Files  5 passed (5)
      Tests  15 passed (15)
  FAIL  renderer:tests (135s)          (the other 10 stages PASS)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2

$ cd /home/qqbot/.cache/labyrinth-probes/v0304 && bash scripts/verify.sh all      (copy, re-run, files identical)
boundary: OK (142 files scanned)
docs: OK (10 task folders)
19 passed in 0.94s
All checks passed!
105 passed in 26.69s
artifacts: schema-valid
artifacts: fresh (byte-identical rebuild)
 Test Files  19 passed (19)
      Tests  582 passed (582)
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (27s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (25s)
  PASS  renderer:tests (208s)
  PASS  renderer:build (3s)
verify.sh: all stages passed.
EXIT=0

$ cd /mnt/d/Labyrinth && bash scripts/verify.sh renderer      (shared tree, HEAD=2b1607e)
boundary: OK (142 files scanned)
 Test Files  19 passed (19)
      Tests  582 passed (582)
━━━ verify.sh summary (scope: renderer)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (23s)
  PASS  renderer:typecheck (12s)
  PASS  renderer:tests (145s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
EXIT=0

$ wsl.exe -e bash scripts/dev.sh python3 scripts/check_boundaries.py
boundary: OK (142 files scanned)
EXIT=0
```

### Findings
1. **Blocker — at desktop widths the fixture rows inside the scenario cards are not legible (B7).**
   In the built app at 1024, 1440 and 1920 px the cards sit two to four across and are roughly 450–480 px
   wide (measured at 1440 px: 448 px, 406 px inside). In that space (measurements at 1440 px):
   - All 7 claimed-vs-computed rows: the label column is 0 px wide, so the label and note break one word per
     line (rows up to 978 px tall) and are painted underneath "Claimed (PRD)" and the claimed value.
   - All 4 range rows: "Inside PRD range" starts at x = 1343 and ends at 1463, while its row ends at 1380, its
     card at 1401 and the viewport at 1440. The reader sees "Inside PRD r", and the page gains a horizontal
     overflow (`scrollWidth` 1463).
   - The two USD range rows: "3,100–3,200 USD" runs 5 px into "3,173 USD" (the same for 6,200–6,400 / 6,346).

   So the range, the computed value and the range verdict required by interface.md §2 item 7, and the
   claimed-vs-computed rows required by the honesty rules, are in the DOM but not readable at the widths the
   app is normally viewed at. At 800 px (cards one column) the same rows are clean, and the jsdom tests
   cannot see layout, which is why the gate is green.
   Cause: `renderer/src/features/budget/budget.css:6` makes cards as narrow as 420 px;
   `renderer/src/design/components/components.css:221` gives the fixture grid fixed tracks of
   3 × 68 px + 132 px + 4 gaps + padding, more than 406 px, so its `minmax(0, 1fr)` label column collapses,
   and its only fallback (`components.css:275`) is a *viewport* media query; `budget.css:109` gives `.bg-range`
   10rem + 6rem + 6rem + max-content, again wider than the card, with a viewport-only fallback at `budget.css:130`.
   Fix: make both grids respond to their container (`container-type: inline-size` on `.bg-fixtures`, then
   `@container (max-width: 640px)` with the stacked layout the ≤ 640 px rule already defines), or stack the
   label above the values inside cards. Add a real-browser check (screenshot or an overlap assertion like the
   one above) so this cannot come back unseen.
2. **Major — the B6 / B7 tests only exercise the committed artifact, so "follows the data" and several labels
   are unpinned.** Ten of 22 mutations leave both tests green:
   - Range logic: BM3 (`BudgetView.tsx:270`, outcome hard-coded to "inside"), BM3b and BM3c (`model.ts:121`,
     the range test or the flag ignored). No test ever shows an "Outside PRD range" or "Not recomputable"
     range row.
   - Midpoint: BM2b (`BudgetView.tsx:283`) prints "(PRD midpoint 14.5)" in the days rows and passes, because
     `BudgetView.test.tsx:88` looks for `'14.5 '` with a trailing space and `halved-dt-days` is not checked.
   - Hard-coding: BM4 (`model.ts:38`, posted fixed to 8.1) and BM18 (`BudgetView.tsx:86`, "$40.00" typed in).
   - Labels: BM7 (`BudgetView.tsx:168-169`, "PRD" and "Guard" column headers swapped), BM15
     (`BudgetView.tsx:178`, the D-015 figure labelled "from /api/live/status" while the API is unreachable),
     BM17 (`BudgetView.tsx:113`, posted shown as Derived), BM10 (`BudgetView.tsx:230`, provenance badge removed).

   The implementation is correct on all of these today (probes above). Fix: one more test that serves a
   modified artifact (different ceiling and posted; one range fixture outside its range; one with
   `matches:false`; one with `matches:null`) and asserts the rendered text, plus assertions on the two column
   headers, on `guard-slot` in the unreachable case, on each card's badge name, and `not.toHaveTextContent(/14\.5|\b29\b/)`
   for both days rows.
3. **Minor — a conclusion is written as fixed text.** `BudgetView.tsx:199-203` always says "Both plans stay
   inside the $40.00 ceiling", whatever the artifact's ceiling and planned total are. True for the committed
   data (21.83 and 26.21 < 40). Fix: derive the sentence from `plannedUsd`, the guard plan and `ceilingUsd`.
4. **Minor — the guard's plan is duplicated in the renderer.** `model.ts:81-88` holds 2.65 / 7.73 / 26.21 as
   constants labelled "decision.md · D-015". They equal the backend guard today (guard probe), but nothing
   fails if the guard's allowances change, which D-015 says will happen after the first rehearsal. When the
   API answers with another slot estimate (probe: $3.11) the rehearsal and planned-total cells still show the
   D-015 constants. Fix: carry the guard plan in the budget artifact or in `/api/live/status` (contract change,
   needs a decision), or add a renderer test that reads `decision.md` and compares.
5. **Minor — $18.17 is shown under "Claimed (PRD)".** The PRD does not print it (`PRD.md:26-31`); it comes
   from TASK.md, and the row's note says so. The column head is the default of `FixtureCheck.tsx:38`,
   applied at `BudgetView.tsx:267`. Fix: pass `claimedLabel="Claimed (TASK.md)"` for `remaining-usd`.
6. **Minor — the midpoint guard depends on prose.** A range fixture is recognised by the text
   "PRD range [lo, hi]" in its label or note (`model.ts:105-110`). If both lose it, `BudgetView.tsx:267-269`
   falls back to "Claimed (PRD) 29 … Match", the midpoint as a PRD figure (probe). Today the backend test
   pins the label and B7 pins the range rows, so the committed artifact is safe. The real fix is the
   `claimedRange` contract field already listed in interface.md §10.
7. **Minor — presentation.** A null computed value prints "— min" with the unit after the dash
   (`FixtureCheck.tsx:76-79`); a negative remainder prints "$-1.11" (`model.ts:44-45`); 46368 is printed
   without a thousands separator while the headline says 46,368.
8. **Info — gate.** The first `verify.sh all` in the copy exited 2 because vitest worker processes timed out
   at start-up under a load average of 27.9 (seven other agents were running suites). No assertion failed.
   The re-run on byte-identical files exited 0, and `verify.sh renderer` on the shared tree exited 0. The
   maintainer's `verify.sh all` on the integrated tree remains the final word.

Could not check: the guard panel against a running main process (the API was stubbed in jsdom and absent in
the static build), and widths below 800 px.

Verdict: FAIL — B7: at 1024–1920 px the fixture rows inside the scenario cards overlap their own labels and the range outcome is cut off ("Inside PRD r"), so claimed, computed, PRD range and outcome are not legibly shown (finding 1); the B1–B6 outcomes pass

## Run 3 — whole task
Verifier run: 2026-11-20, commit 3faed3a
Scope: B1–B7 at commit 3faed3a, kept short at the owner's request: the task's own tests, one independent probe per
outcome, three mutations, and a real-browser layout check of the Run 2 blocker. `git status --short` at the start
showed only ` M status.md`, so no file owned by task 04 differed from the commit. Since Run 2 (2b1607e) the owned
files changed (`git diff --stat 2b1607e HEAD`: 7 files, +1363 / −262), with D-023 (`claimedRange`, `basis`,
`guardPlan`).
Gate: not re-run here (the orchestrator said not to run `verify.sh all` while nine verifiers share the machine).
The maintainer ran `verify.sh all` at 3faed3a on this tree: exit 0, 11/11 stages (boundary self-test 134 shapes,
scripts 71 passed, ruff clean, main 331 passed, artifacts schema + fresh, tsc clean, vitest 1350 passed, vite
build OK). That run is quoted, not reproduced.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| B1 | 15 min at $6.10/h → $1.53; 2 rehearsals + slot → $13.73; + $8.10 → $21.83; remaining $18.17 of $40 | `test_B1_live_demo_ledger_recomputed_with_half_up_cents` and `test_B1_live_fixture_mismatch_drives_scenario_verdict` (rate 6.20 makes the fixture and scenario go red); `test_B8_every_claim_is_printed_by_the_source_it_names` (18.17 sourced to TASK.md). Passed | Decimal recompute from PRD constants typed in the probe (no project import): 1.53 / 13.73 / 21.83 / 18.17; artifact top level 40.0 / 8.1 / 21.83 / 18.17 and all four fixtures agree | PASS |
| B2 | 161 h × 288 = 46,368 CPU-h | `test_B2_published_stella_cpu_hours`. Passed | 161 × 288 = 46368; fixture claimed 46368, computed 46368.0, matches true | PASS |
| B3 | Full grid inside 14–15 d and $3,100–3,200; halved timestep inside 28–30 d and $6,200–6,400 | `test_B3_full_grid_days_and_dollars_inside_prd_ranges` (claimed null, `claimedRange`, basis arithmetic, a negative case) and `test_B3_range_fixture_drives_scenario_verdict` (step time ×1.1 goes outside). Passed | Decimal: 346.75 h = 14.447917 d, $3,172.7625; halved 693.5 h = 28.895833 d, $6,345.5250, all inside; artifact range fixtures have claimed null and the PRD ranges in `claimedRange`. Mutation BE-M1 killed | PASS |
| B4 | GX benchmark (28 min 1 GPU 4×8; 90 min 4 GPUs 8×16) as `prd-reported` context only | `test_B4_gx_benchmark_is_prd_reported_context_only`. Passed | Artifact: both GX fixtures computed null, matches null, no basis; scenario prd-reported / not-applicable; the PRD prints "28 minutes" and "90 minutes" | PASS |
| B5 | Pricing constants exported for the live budget guard | `test_B5_pricing_constants_exported_for_budget_guard`; `test_B7_guard_plan_*` (3 tests: guardPlan equals the guard's own answers, is recomputed when the guard's allowances or posted change, and says when it does not fit). Passed | `live_gx/budget_guard.py` imports `CEILING_USD, LIVE_RATE_USD_PER_H, LIVE_SLOT_MIN, REHEARSAL_H` from `budget.pricing`; D-015 recomputed by hand: slot 2.65, rehearsal 7.73, planned 26.21 = artifact `guardPlan` and decision.md | PASS |
| B6 | Ledger bar to the $40 ceiling: posted, planned, remaining | `BudgetView.test.tsx` four "B6 …" tests: committed artifact, a modified artifact (ceiling 50 / posted 9.99; ceilings 25, 20, 27), provenance pills following the data, live estimate vs plan. Passed | Built app in a real browser (1920 px): bar label "Modal ledger against the $40.00 ceiling: Posted earlier $8.10, Planned: 2 rehearsals + 1 live slot $13.73, Remaining $18.17. Planned total $21.83.", widths 20.25 / 34.325 / 45.425 %. Mutations FE-M1 (posted hard-coded 8.1) and FE-M2 (PRD / Guard headers swapped), both survivors in Run 2, are now killed | PASS |
| B7 | Scenario cards with headline, derivation and interpretation; prd-reported vs derived distinguished | `BudgetView.test.tsx` "B7 scenario cards …", "B7 range rows follow a modified artifact …", "FB-1 …", "B7 … kind live …", "DS-1 / DS-19 …". Passed | Run 2 blocker re-checked in the built app (real browser, all 11 fixture rows): at 1024 px (cards 431 px), 1440 px (639 px) and 1920 px (879 px) no two text boxes overlap, nothing is cut off, no text leaves its card, and the page has no horizontal scroll. Range rows read e.g. "PRD range 14–15 days, Computed 14.45 days, Δ to range 0.00, Arithmetic in PRD range". The 4 committed cards are prd-reported; the kind switch is exercised by the modified-artifact test | PASS |

### Real output
```
$ wsl.exe -e bash scripts/dev.sh python3 --version
Python 3.12.3
$ wsl.exe -e git status --short          (start)
 M status.md
$ git rev-parse --short HEAD
3faed3a
$ git diff --stat 2b1607e HEAD -- main/labyrinth_main/features/budget main/tests/test_budget.py artifacts/budget.json renderer/src/features/budget
 artifacts/budget.json                            |   2 +-
 main/labyrinth_main/features/budget/artifact.py  | 123 +++-
 main/tests/test_budget.py                        | 151 ++++-
 renderer/src/features/budget/BudgetView.test.tsx | 723 +++++++++++++++++++++--
 renderer/src/features/budget/BudgetView.tsx      | 352 ++++++++---
 renderer/src/features/budget/budget.css          |  66 +--
 renderer/src/features/budget/model.ts            | 208 +++++--
 7 files changed, 1363 insertions(+), 262 deletions(-)

$ wsl.exe -e bash scripts/dev.sh python3 -m pytest -v -p no:cacheprovider main/tests/test_budget.py
main/tests/test_budget.py::test_B1_live_demo_ledger_recomputed_with_half_up_cents PASSED [  7%]
main/tests/test_budget.py::test_B1_live_fixture_mismatch_drives_scenario_verdict PASSED [ 15%]
main/tests/test_budget.py::test_B9_no_budget_scenario_claims_archive_derivation PASSED [ 23%]
main/tests/test_budget.py::test_B2_published_stella_cpu_hours PASSED     [ 30%]
main/tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges PASSED [ 38%]
main/tests/test_budget.py::test_B3_range_fixture_drives_scenario_verdict PASSED [ 46%]
main/tests/test_budget.py::test_B6_fixture_basis_marks_arithmetic_only_checks PASSED [ 53%]
main/tests/test_budget.py::test_B8_every_claim_is_printed_by_the_source_it_names PASSED [ 61%]
main/tests/test_budget.py::test_B7_guard_plan_comes_from_the_live_budget_guard PASSED [ 69%]
main/tests/test_budget.py::test_B7_guard_plan_is_recomputed_not_a_literal PASSED [ 76%]
main/tests/test_budget.py::test_B7_guard_plan_says_when_it_does_not_fit PASSED [ 84%]
main/tests/test_budget.py::test_B4_gx_benchmark_is_prd_reported_context_only PASSED [ 92%]
main/tests/test_budget.py::test_B5_pricing_constants_exported_for_budget_guard PASSED [100%]
============================== 13 passed in 0.82s ==============================
EXIT=0

$ wsl.exe -e bash scripts/dev.sh npm --prefix renderer run -s test -- src/features/budget --reporter=verbose      (colour codes removed)
 ✓ src/features/budget/BudgetView.test.tsx > B6 ledger bar to the $40 ceiling: posted, planned, remaining; live guard estimate distinguished from PRD GPU-only 643ms
 ✓ src/features/budget/BudgetView.test.tsx > B6 the ledger, its title and the plan-versus-ceiling statement follow a modified artifact 211ms
 ✓ src/features/budget/BudgetView.test.tsx > B6 the ledger provenance pills follow the live-demo scenario kind in the artifact, never a hard-coded "derived" 136ms
 ✓ src/features/budget/BudgetView.test.tsx > B6 a live guard estimate that differs from the artifact guard plan marks the plan figures as possibly out of date 106ms
 ✓ src/features/budget/BudgetView.test.tsx > B7 scenario cards show headline, derivation and interpretation; PRD-reported vs derived; ranges never midpoints 112ms
 ✓ src/features/budget/BudgetView.test.tsx > B7 range rows follow a modified artifact: outside the range, matches false, matches null, and a flag that disagrees 59ms
 ✓ src/features/budget/BudgetView.test.tsx > FB-1 a range is read from claimedRange only: no range and no claim shows "—", prose is never parsed, an old midpoint is never shown 88ms
 ✓ src/features/budget/BudgetView.test.tsx > B7 a scenario whose provenance kind is "live" is shown as a recorded run: an artifact can never earn the LIVE pill 48ms
 ✓ src/features/budget/BudgetView.test.tsx > A3 budget: a missing or invalid artifact shows an error naming the file, never a blank view 17ms
 (… 11 FF-1 / FF-8 / cross-RX-6 / FF-11 / FF-10 lines, all ✓ …)
 ✓ src/features/budget/BudgetView.test.tsx > DS-1 / DS-19 fixture rows reflow by the width of their card, and the scenario grid never orphans a card 8ms
 Test Files  1 passed (1)
      Tests  21 passed (21)
EXIT=0

$ wsl.exe -e bash scripts/dev.sh python3 -I <scratch>/probe_backend.py      (Decimal, PRD constants typed in the probe, reads artifacts/budget.json)
B1 slot 1.53 plan 13.73 planned 21.83 remaining 18.17
B1 artifact top 40.0 8.1 21.83 18.17
  live-slot-usd              claimed 1.53 computed 1.53 matches True agree True
  rehearsals-plus-slot-usd   claimed 13.73 computed 13.73 matches True agree True
  planned-usd                claimed 21.83 computed 21.83 matches True agree True
  remaining-usd              claimed 18.17 computed 18.17 matches True agree True
B2 161*288 = 46368 | fixture 46368 46368.0 True
B3 x1: hours 346.75 days 14.447917 usd 3172.7625 in-days True in-usd True
  full-grid-days  claimed None claimedRange [14.0, 15.0] computed 14.44792 matches True basis arithmetic
  full-grid-usd   claimed None claimedRange [3100.0, 3200.0] computed 3172.763 matches True basis arithmetic
B3 halved: hours 693.5 days 28.895833 usd 6345.5250 in-days True in-usd True
  halved-dt-days  claimed None claimedRange [28.0, 30.0] computed 28.89583 matches True basis arithmetic
  halved-dt-usd   claimed None claimedRange [6200.0, 6400.0] computed 6345.525 matches True basis arithmetic
B4 gx-1gpu-min claimed 28.0 computed None matches None basis None
B4 gx-4gpu-min claimed 90.0 computed None matches None basis None
B4 scenario prd-reported not-applicable | 28 minutes on one GPU (4 Laguerre × 8 Hermite); 90 minutes on four GPUs (8 × 16)
B4 PRD prints 28 minutes / 90 minutes: True True
B5 guard D-015 recompute slot 2.65 rehearsal 7.73 planned 26.21
B5 artifact guardPlan {'plannedTotalUsd': 26.21, 'rehearsalEstimateUsd': 7.73, 'rehearsalHardTimeoutS': 4500, 'slotEstimateUsd': 2.65, 'slotHardTimeoutS': 1500}
B5 decision.md mentions $2.65 $7.73 $26.21: True True True
B5 budget_guard imports from budget.pricing: ['from ..budget.pricing import CEILING_USD, LIVE_RATE_USD_PER_H, LIVE_SLOT_MIN, REHEARSAL_H']
scenario kinds: {'live-demo': ('prd-reported', 'not-applicable'), 'stella-published': ('prd-reported', 'not-applicable'), 'full-grid-modal': ('prd-reported', 'not-applicable'), 'gx-benchmark': ('prd-reported', 'not-applicable')}
EXIT=0

# Built app: renderer/dist (built from the committed tree; dist/artifacts/budget.json byte-identical to
# artifacts/budget.json; CSS bundle has ".bg-fixtures{...container-type:inline-size}" and no ".bg-range"),
# copied to scratch and served by python3 -m http.server on 127.0.0.1; Browser pane at #/budget.
# Per fixture row: element boxes of every text leaf compared pairwise; text wider than its box; text past the card.
1024 px: {"innerWidth":1024,"docScrollW":1009,"cards":[431,431,431,431], 11 rows, every row "boxOverlaps":0,"cut":[],"outRowPx":0,"outCardPx":0}
         range rows: "Full-grid stella wall time PRD range 14–15days Computed 14.45days Δ to range 0.00 Arithmetic in PRD range …"
                     "Full-grid stella cost PRD range 3100–3200USD Computed 3172.76USD Δ to range 0.00 Arithmetic in PRD range …"
1440 px: {"innerWidth":1440,"docScrollW":1425,"cards":[639,639,639,639], 11 rows, "textOutsideRowPx":0,"textOutsideCardPx":0}
         (a text-range measure counted the 2-line-clamped note's hidden 3rd line under "Show full note" in two rows;
          element boxes do not overlap: note 454–486 px, button from 486 px; the screenshot shows both legible)
1920 px: {"innerWidth":1920,"docScrollW":1905,"cards":[879,879,879,879],"rows":11,"overlaps":0,"outCardPx":0,"cut":0}
1920 px ledger: "Modal ledger against the $40.00 ceiling: Posted earlier $8.10, Planned: 2 rehearsals + 1 live slot $13.73, Remaining $18.17. Planned total $21.83." widths ["20.25%","34.325%","45.425%"]
         plan-vs-ceiling: "Both plans stay inside the $40.00 ceiling: PRD GPU-only plan $21.83, Guard plan $26.21."

# Mutations: probe copy from scripts/probe-copy.sh vt-04-budget, each applied, tested, restored; copy deleted after
$ python3 -I <scratch>/mutate.py      (PYTHONDONTWRITEBYTECODE=1, __pycache__ cleared; vitest colour codes removed)
### BE-M1 range check always inside [main/labyrinth_main/features/budget/artifact.py] -> exit=1 RED (killed)
    FAILED main/tests/test_budget.py::test_B3_full_grid_days_and_dollars_inside_prd_ranges
    1 failed, 12 passed in 0.09s
    restore: copy f1b6833f5ea6 shared f1b6833f5ea6 same=True
### FE-M1 posted hard-coded to 8.1 [renderer/src/features/budget/model.ts] -> exit=1 RED (killed)
    Tests  1 failed | 20 passed (21)
    FAIL  src/features/budget/BudgetView.test.tsx > B6 the ledger, its title and the plan-versus-ceiling statement follow a modified artifact
    restore: copy b92a05782719 shared b92a05782719 same=True
### FE-M2 PRD / Guard column headers swapped [renderer/src/features/budget/BudgetView.tsx] -> exit=1 RED (killed)
    Tests  1 failed | 20 passed (21)
    FAIL  src/features/budget/BudgetView.test.tsx > B6 ledger bar to the $40 ceiling: posted, planned, remaining; live guard estimate distinguished from PRD GPU-only
    restore: copy 3602a060dfcc shared 3602a060dfcc same=True
### control after restore (py): (0, ['13 passed in 0.10s'])
$ wsl.exe -e git status --short          (end; the two VERIFY.md files belong to other verifiers)
 M status.md
 M tasks/00-scaffold/VERIFY.md
 M tasks/07-server/VERIFY.md
```

### Findings
1. The Run 2 blocker (finding 1 there: fixture rows overlapping their labels, range outcome cut off at 1024–1920 px)
   is fixed. `renderer/src/features/budget/budget.css` makes `.bg-fixtures` a size container and the hand-built
   `.bg-range` row is gone; in the built app no fixture row overlaps or overflows at 1024, 1440 or 1920 px (above).
2. Weak test, does not block: `renderer/src/features/budget/BudgetView.test.tsx:739-750` (DS-1 / DS-19) checks the
   CSS source text for `container-type: inline-size` and the grid rule. jsdom has no layout, so it cannot see an
   overlap; it only guards against the old rules returning. The layout itself is backed only by the browser check
   above. Suggest a real-browser overlap assertion (Playwright or similar) if layout regressions matter.
3. Information: in `main/labyrinth_main/features/budget/artifact.py:62` the local `inside` only words the note;
   `matches` for range fixtures is computed by the shared `prov.range_fixture` helper (outside this task's files).
   BE-M1 was therefore caught by the note assertion at `main/tests/test_budget.py:97`, and the range test of
   `matches` itself is covered at `main/tests/test_budget.py:108`.
4. Information: since D-023 / cross-RX-3 every committed budget scenario is `prd-reported` / `not-applicable`
   (arithmetic re-checks of PRD inputs are not "derived"). B7's "prd-reported vs derived distinguished" is therefore
   shown by the renderer following the artifact's kind, which `BudgetView.test.tsx:407-455` exercises with a scenario
   switched to derived.
5. Run 2 findings 2–6 are addressed in this commit: the surviving mutations of Run 2 that were re-tried here (BM4
   as FE-M1, BM7 as FE-M2) are now killed; the plan-versus-ceiling sentence is derived from the data
   (`BudgetView.test.tsx:184-213`); the renderer's D-015 constants are replaced by the artifact's `guardPlan`
   (D-023 §5); $18.17 is labelled "Claimed (TASK.md)" from `claimSource`; range fixtures use `claimedRange`, not
   prose. Not re-tried this run: the other Run 2 survivors (BM2b, BM3, BM3b, BM3c, BM10, BM15, BM17, BM18); the
   new tests at `BudgetView.test.tsx:122-131`, `:244-297`, `:338-456` assert the behaviour each of them changed.
6. Could not check: the guard panel against a running main process (API stubbed in jsdom, absent from the static
   build), and widths below 1024 px.

Verdict: PASS

## Run 4 — whole task
Verifier run: 2026-11-22, commit a9b12b2

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| B1 | Live-demo ledger arithmetic | `test_B1_*` | Rebuilt artifact had $21.83 planned and $18.17 remaining. | PASS |
| B2 | Published stella CPU-hour arithmetic | `test_B2_published_stella_cpu_hours` | Production model returned 46,368 CPU-hours. | PASS |
| B3 | Full-grid estimates stay in printed ranges | `test_B3_*` | Artifact printed 14.4 days/$3,173 and 28.9 days/$6,346. | PASS |
| B4 | GX benchmark is PRD-reported context | `test_B4_gx_benchmark_is_prd_reported_context_only` | Rebuilt scenario kind was `prd-reported`. | PASS |
| B5 | Shared pricing drives budget and guard | `test_B5_pricing_constants_exported_for_budget_guard` | Guard plan was $2.65 live/$7.73 rehearsal/$26.21 total. | PASS |
| B6 | Ledger bar states posted, planned and remaining | `BudgetView.test.tsx` | Chromium at 1024/1440/1920 px had the complete $40 ledger label and no page overflow. | PASS |
| B7 | Scenario cards distinguish PRD figures and arithmetic | `BudgetView.test.tsx` | Chromium rendered all four cards at 1024/1440/1920 px with `PRD base estimate`. | PASS |

### Real output
```
$ bash scripts/verify.sh all at 9e017b6
PASS: all 11 stages, 378 main tests, 1736 renderer tests.
$ python3 -m pytest -q main/tests/test_budget.py
13 passed in 0.01s
$ npm --prefix renderer run -s test -- src/features/budget/BudgetView.test.tsx
Test Files 1 passed; Tests 21 passed
$ python3 scripts/check_boundaries.py
boundary: OK (208 files scanned)
$ git diff --stat 9e017b6 a9b12b2
tasks/06-live-gx/TASK.md changed only; no task 04 owner path changed.
```

### Findings
The earlier layout finding is covered by the offline Chromium viewport probes above.

Verdict: PASS
