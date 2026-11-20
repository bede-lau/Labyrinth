# Verify: 05-spatial (backend half only: S1–S4)
Verifier run: 2026-11-19/20 (UTC), commits 76b1908 → fcf812d (HEAD moved during the run; other agents
committed status/geometry/contracts changes only) + uncommitted working tree.
Files under test (uncommitted): `main/labyrinth_main/features/spatial/artifact.py`, `main/tests/test_spatial.py`,
`artifacts/spatial.json`.

**Scope.** This verdict covers only the backend outcomes S1–S4. The frontend outcomes S5–S6 are
**not yet built** (`renderer/src/features/spatial/` has no tests), so they are not verified. **Task 05
stays not-DONE** until S5–S6 are built and verified by an external verifier, and the reviewer approves.

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| S1 | rank 0/GPU 0 owns planes 1–3, rank 1/GPU 1 owns 4–6; MPI exchanges at 3↔4 and 6↔1 (periodic); field solve on CPU | `test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve`: exact ranks list, full coverage 1..6, exact exchanges list, `fieldSolve == {"device": "CPU"}` | Exchanges re-derived from the artifact's ownership over a periodic ring of 6 planes: `[(3, 4), (6, 1)]`, the same as the artifact. Mutations M11 (ownership 1–2/3–6), M12 (non-periodic ring), M16 (field solve on GPU) all fail S1 | PASS |
| S2 | 4 controlled runs, 4 passed; CPU 184.69 s, GPU 145.44 s, speedup recomputed = 1.27 | `test_S2_runs_and_speedup_recomputed`: runs dict, the three PRD values, `speedupRecomputed ≈ 184.69/145.44`, `round(recomputed, 2) == speedup` | 184.69/145.44 = 1.2698707… → 1.27 at the PRD's 2 dp; artifact `speedupRecomputed` 1.269871. Mutations M13 (GPU 150.00) and M17 (3 passed) fail S2 | PASS |
| S3 | Provenance `prd-reported`; verification `blocked` (checkpoints not in repo) | `test_S3_provenance_prd_reported_and_verification_blocked`: kind, outcome, "checkpoints"/"not in this repo" in details, "Dommaschk"/"not W7-X" in coverage | Artifact: kind `prd-reported`, outcome `blocked`; the details name the missing checkpoints and timing logs. Mutation M14 (outcome→`passed`) fails S3 | PASS |
| S4 | Independence note: live W7-X tubes independent, no exchange GPU 0 ↔ GPU 1 | `test_S4_independence_note_live_w7x_tubes_do_not_exchange` | Note text present in the artifact (quoted below). Mutation M15 ("with only occasional exchanges") fails S4 | PASS |
| S5 | Ring diagram (frontend) | none yet | — | not yet built |
| S6 | Timing comparison and provenance badge (frontend) | none yet | — | not yet built |

## Real output

### Full gate (see tasks/04-budget/VERIFY.md for the full transcript; the same runs apply here)
```
$ bash scripts/verify.sh all ; echo EXIT=$?     (HEAD 76b1908)
  PASS  main:tests (7s)          65 passed in 6.01s
  PASS  artifacts:schema / artifacts:fresh (byte-identical rebuild)
  FAIL  renderer:typecheck       src/design/components/{FixtureCheck,Panel,ProvenanceBadge,Stat,StatusPill}.tsx: error TS2882 ... './components.css'
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2
$ bash scripts/verify.sh main ; echo EXIT=$?    (same tree)
verify.sh: all stages passed.
main EXIT=0

$ bash scripts/verify.sh all ; echo EXIT=$?     (HEAD fcf812d)
 FAIL  src/design/color.test.ts > CVD simulation matrices > every row sums to ~1, so neutrals stay neutral
  FAIL  renderer:tests (2s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT=2
$ bash scripts/verify.sh main                  (later; another agent mid-edit on geometry)
FAILED main/tests/test_geometry.py::... (4 tests)  TypeError: compare() missing 1 required positional argument: 'input_path'
  FAIL  main:tests   FAIL  artifacts:fresh   (geometry build aborts the full rebuild)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
```
Attribution: the failures are in `renderer/src/design/*` (design-lead, concurrent) and
`main/labyrinth_main/features/geometry/*` with `common/paths.py` (task 01, concurrent). None touches
`features/spatial/` or `test_spatial.py`.

### Task tests on their own, freshness, boundaries
```
$ python3 -m pytest -v -p no:cacheprovider main/tests/test_budget.py main/tests/test_spatial.py
main/tests/test_spatial.py::test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve PASSED [ 66%]
main/tests/test_spatial.py::test_S2_runs_and_speedup_recomputed PASSED   [ 77%]
main/tests/test_spatial.py::test_S3_provenance_prd_reported_and_verification_blocked PASSED [ 88%]
main/tests/test_spatial.py::test_S4_independence_note_live_w7x_tubes_do_not_exchange PASSED [100%]
============================== 9 passed in 0.03s ===============================
(re-run at HEAD fcf812d with PYTHONDONTWRITEBYTECODE=1: 9 passed in 0.02s)

$ (rebuild spatial.build() with common.io.write_json into scratchpad, compare to artifacts/spatial.json)
spatial.json byte-identical rebuild: True | manifest sha matches file: True

$ python3 scripts/check_boundaries.py
boundary: OK (92 files scanned)
```

### Independent probe of artifacts/spatial.json (scratchpad/v045/probe_spatial.py, python3 -I, no project import)
```
geometry Dommaschk code GENE-X nPlanes 6
ranks [{'device': 'GPU 0', 'planes': [1, 2, 3], 'rank': 0}, {'device': 'GPU 1', 'planes': [4, 5, 6], 'rank': 1}]
independent exchanges [(3, 4), (6, 1)] artifact [(3, 4), (6, 1)]
fieldSolve {'device': 'CPU'} runs {'controlled': 4, 'passedReference': 4}
timing {'cpuMeanS': 184.69, 'gpuMeanS': 145.44, 'speedup': 1.27, 'speedupRecomputed': 1.269871} 184.69/145.44 = 1.2698707370737075 round2 1.27
prov kind prd-reported | outcome blocked
details: Saved GENE-X checkpoints and timing logs are not in this repo, so plane ownership, the 4/4 reference passes and the timings cannot be verified. Only the ratio is recomputed: 184.69/145.44 = 1.2699 (PRD prints 1.27).
coverage: 4 controlled runs on the separate Dommaschk geometry (not W7-X); 6 toroidal planes over 2 ranks
note: This GENE-X case couples toroidal planes across GPUs through MPI halo exchanges. The live W7-X tubes are independent: GPU 0 advances the bean tube and GPU 1 the triangular tube with no exchange between them.
```
PRD source (PRD.md:14): "Saved checkpoints assign planes 1–3 and 4–6 to different ranks. All four controlled
runs passed the reference. CPU averaged 184.69 s and GPU 145.44 s (1.27×). The live W7-X tubes are independent."
Every value in the artifact matches.

### Mutations (copy at scratchpad/v045/repo; PYTHONDONTWRITEBYTECODE=1, __pycache__ cleared before each)
```
=== [M11] spatial/artifact.py :: >     {"rank": 0, "device": "GPU 0", "planes": [1, 2]},   (and rank 1 -> [3, 4, 5, 6])
FAILED tests/test_spatial.py::test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve
1 failed, 3 passed in 0.04s
=== [M12] spatial/artifact.py :: >     for p in range(1, N_PLANES):   (non-periodic: drops the 6<->1 boundary)
FAILED tests/test_spatial.py::test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve
1 failed, 3 passed in 0.03s
=== [M13] spatial/artifact.py :: > PRD_GPU_MEAN_S = 150.00
FAILED tests/test_spatial.py::test_S2_runs_and_speedup_recomputed - assert (1...
1 failed, 3 passed in 0.03s
=== [M14] spatial/artifact.py :: >             outcome="passed",
E       AssertionError: assert 'passed' == 'blocked'
FAILED tests/test_spatial.py::test_S3_provenance_prd_reported_and_verification_blocked
1 failed, 3 passed in 0.03s
=== [M15] spatial/artifact.py :: >     "...GPU 1 the triangular tube with only occasional "
FAILED tests/test_spatial.py::test_S4_independence_note_live_w7x_tubes_do_not_exchange
1 failed, 3 passed in 0.03s
=== [M16] spatial/artifact.py :: >         "fieldSolve": {"device": "GPU"},
FAILED tests/test_spatial.py::test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve
1 failed, 3 passed in 0.04s
=== [M17] spatial/artifact.py :: > PRD_PASSED_RUNS = 3
E         {'passedReference': 3} != {'passedReference': 4}
FAILED tests/test_spatial.py::test_S2_runs_and_speedup_recomputed - Assertion...
1 failed, 3 passed in 0.03s
--- control (unmutated copy):
9 passed in 0.05s
```
The live tree was never mutated.

## Findings
1. Minor wording inconsistency: the module docstring says the rank-boundary exchanges and the ratio
   are recomputed (`main/labyrinth_main/features/spatial/artifact.py:4-5`). The provenance details
   say "Only the ratio is recomputed" (`artifact.py:74`). The exchanges are in fact derived from the
   ownership plus a periodic-ring assumption. That assumption comes from TASK.md S1: the PRD
   (PRD.md:14) names neither the 3↔4 / 6↔1 boundaries nor the rank-0 = GPU 0 mapping. Not a value
   error. Suggest the details also say the exchanges are inferred from ownership.
2. The speedup is not in the shared `fixtureCheck` shape: there is no `matches` flag. It is carried
   as `timing.speedup` + `timing.speedupRecomputed`, which is what `contracts/spatial.schema.json`
   allows (additionalProperties false). The test checks the 2-dp agreement. The frontend (S6) has to
   do the claimed-vs-computed comparison itself. Changing the contract is the orchestrator's call.
3. Tests are not tautological: each one fails under a targeted mutation (M11–M17).
4. Gate status: `verify.sh all` exited 2 on both runs, and `verify.sh main` passed on the first run
   and exited 2 on the second. Every failure is in files outside task 05 (attributed above). Per the
   orchestrator's instruction, this verdict covers the task-05 backend only. The whole repo gate
   must be green before task 05 can be marked DONE.
5. S5–S6 are not yet built. Task 05 remains not-DONE until the frontend is verified.

Verdict: PASS
