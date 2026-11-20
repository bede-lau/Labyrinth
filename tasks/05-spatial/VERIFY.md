# Verify: 05-spatial

This file holds two external verifier runs.

- **Run 1** (2026-11-19/20) covered outcomes S1–S4 on the working tree of that day.
- **Run 2** (2026-11-20, commit `2b1607e`) covers the whole task, S1–S6. Its verdict is the last line of this file.

The text of run 1 is kept as written. Only its scope notes were reworded (each marked
"[reworded in run 2]"), because `scripts/check_docs.py` reads certain phrases as a partial verdict;
headings were moved one level down and its closing line is now labelled as the run-1 verdict.

## Run 1 — S1–S4 (2026-11-19/20, commits 76b1908 → fcf812d)

Verifier run: 2026-11-19/20 (UTC), commits 76b1908 → fcf812d (HEAD moved during the run; other agents
committed status/geometry/contracts changes only) + uncommitted working tree.
Files under test (uncommitted): `main/labyrinth_main/features/spatial/artifact.py`, `main/tests/test_spatial.py`,
`artifacts/spatial.json`.

**Scope.** [reworded in run 2] Run 1 covered outcomes S1–S4. At that time `renderer/src/features/spatial/`
had no tests, so S5–S6 were outside run 1. Run 2 below covers them.

### Outcomes (run 1)
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| S1 | rank 0/GPU 0 owns planes 1–3, rank 1/GPU 1 owns 4–6; MPI exchanges at 3↔4 and 6↔1 (periodic); field solve on CPU | `test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve`: exact ranks list, full coverage 1..6, exact exchanges list, `fieldSolve == {"device": "CPU"}` | Exchanges re-derived from the artifact's ownership over a periodic ring of 6 planes: `[(3, 4), (6, 1)]`, the same as the artifact. Mutations M11 (ownership 1–2/3–6), M12 (non-periodic ring), M16 (field solve on GPU) all fail S1 | PASS |
| S2 | 4 controlled runs, 4 passed; CPU 184.69 s, GPU 145.44 s, speedup recomputed = 1.27 | `test_S2_runs_and_speedup_recomputed`: runs dict, the three PRD values, `speedupRecomputed ≈ 184.69/145.44`, `round(recomputed, 2) == speedup` | 184.69/145.44 = 1.2698707… → 1.27 at the PRD's 2 dp; artifact `speedupRecomputed` 1.269871. Mutations M13 (GPU 150.00) and M17 (3 passed) fail S2 | PASS |
| S3 | Provenance `prd-reported`; verification `blocked` (checkpoints not in repo) | `test_S3_provenance_prd_reported_and_verification_blocked`: kind, outcome, "checkpoints"/"not in this repo" in details, "Dommaschk"/"not W7-X" in coverage | Artifact: kind `prd-reported`, outcome `blocked`; the details name the missing checkpoints and timing logs. Mutation M14 (outcome→`passed`) fails S3 | PASS |
| S4 | Independence note: live W7-X tubes independent, no exchange GPU 0 ↔ GPU 1 | `test_S4_independence_note_live_w7x_tubes_do_not_exchange` | Note text present in the artifact (quoted below). Mutation M15 ("with only occasional exchanges") fails S4 | PASS |
| S5 | Ring diagram (frontend) | none at the time of run 1 | — | outside run 1, see run 2 [reworded in run 2] |
| S6 | Timing comparison and provenance badge (frontend) | none at the time of run 1 | — | outside run 1, see run 2 [reworded in run 2] |

### Real output (run 1)

#### Full gate (see tasks/04-budget/VERIFY.md for the full transcript; the same runs apply here)
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

#### Task tests on their own, freshness, boundaries
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

#### Independent probe of artifacts/spatial.json (scratchpad/v045/probe_spatial.py, python3 -I, no project import)
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

#### Mutations (copy at scratchpad/v045/repo; PYTHONDONTWRITEBYTECODE=1, __pycache__ cleared before each)
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

### Findings (run 1)
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
   and exited 2 on the second. Every failure is in files outside task 05 (attributed above).
   [reworded in run 2] Per the orchestrator's instruction, run 1 judged outcomes S1–S4 of task 05.
   The whole repo gate must be green before task 05 can be marked DONE.
5. [reworded in run 2] S5–S6 were outside run 1. See run 2.

Run 1 verdict (S1–S4): PASS

## Run 2 — whole task (2026-11-20, commit 2b1607e)

Verifier run: 2026-11-20, commit `2b1607e` + working tree. `git status --short` was empty for every
path under test (`renderer/`, `artifacts/`, `contracts/`, `main/labyrinth_main/features/spatial/`,
`main/tests/test_spatial.py`) at the start and at the end of the run; other agents changed only
`main/labyrinth_main/features/live_gx/`, `main/labyrinth_main/server/`, two live tests, `scripts/dev.sh`,
`status.md` and `tasks/01-geometry/VERIFY.md`.

Where things ran (Windows + WSL, every command through `wsl.exe -e bash scripts/dev.sh …`):
- `verify.sh renderer`, the named tests and the read-only probes: the shared tree `D:\Labyrinth`.
- `verify.sh all`, every mutation and every probe test I wrote: isolated copies made with
  `scripts/probe-copy.sh v0509` (plus `v0509b/c/d` for parallel mutation runs, checked identical to
  the first copy with `diff -rq`). All copies were deleted at the end. The shared tree was never mutated.
- Screenshots: headless Edge 157 against the static build on `http://127.0.0.1:4173` (vite preview of
  `renderer/dist`, no API behind it).

### Outcomes (run 2)
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| S1 | rank 0/GPU 0 owns planes 1–3, rank 1/GPU 1 owns 4–6; MPI exchanges at 3↔4 and 6↔1 (periodic); field solve on CPU | `main/tests/test_spatial.py::test_S1_…`: exact ranks, coverage 1..6, exact four directed exchanges, CPU field solve, docstring does not overclaim | My own script (python3 -I, no project import) derives the exchanges from the ownership over a periodic ring: `[(0,1,1,6),(0,1,3,4),(1,0,4,3),(1,0,6,1)]`, equal to the artifact; both directions at each boundary. Mutations MP3 (non-periodic) and MP4 (one direction) go red | PASS |
| S2 | 4 controlled runs, 4 passed; CPU 184.69 s, GPU 145.44 s, speedup recomputed = 1.27 | `test_S2_runs_and_speedup_recomputed` | Decimal 184.69/145.44 = 1.26987073707… → 1.27 at 2 dp (half-up); artifact `speedupRecomputed` 1.269871 (7 significant figures). Mutation MP1 (GPU 150.00) goes red | PASS |
| S3 | Provenance `prd-reported`; verification `blocked` (checkpoints not in repo) | `test_S3_provenance_prd_reported_and_verification_blocked` | Artifact kind `prd-reported`, outcome `blocked`, details name the missing checkpoints and timing logs. Mutations MP2 (outcome `passed`) and MP5 (kind `derived`) go red | PASS |
| S4 | Independence note: live W7-X tubes independent, no exchange between GPU 0 and GPU 1 | `test_S4_independence_note_live_w7x_tubes_do_not_exchange` | Note text read from the artifact and found verbatim in the rendered view | PASS |
| S5 | Ring diagram of 6 toroidal planes coloured by rank, exchange arrows, CPU field-solve node; labelled "Dommaschk geometry — not W7-X" | `renderer/src/features/spatial/SpatialView.test.tsx` › "S5 ring of 6 toroidal planes…": real artifact through a fetch stub, real `SpatialView`; asserts 6 nodes with rank classes and rank shapes, four `data-exchange` arrows with arrowheads, both boundary labels, CPU node, text alternative, the visible label and the heading | My probe reads node centres and arrow paths from the DOM and checks each arrow starts at its sending plane and ends (arrowhead) at its receiving plane, with no arrow inside a rank; label appears 4 times; screenshot of `#/spatial` read by eye. 8 of 8 S5 mutations go red (MS1–MS6, MS14, MS20) | PASS |
| S6 | Timing comparison (CPU vs GPU mean, 1.27×) and run tally; provenance badge shows PRD-reported/blocked | same file › "S6 timing CPU 184.69 s vs GPU 145.44 s (1.27×)…": Stat groups for both means, the speedup fixture (claimed 1.27, computed 1.269871, match), tally 4 of 4, badge "PRD-reported, Blocked", three PRD-reported pills, no "Verified" pill, blocked callout text, independence note, mismatch when the claim is 1.3 | My probe feeds altered artifacts: ratio 2.0 → "Mismatch. Claimed 1.27, computed 2.00"; 3 of 4 → three pass marks; committed data → pills are exactly 3 × PRD-reported and 2 × Blocked, no Verified/Live/Derived pill, the words "as stated in the PRD" and "Only the ratio is recomputed. Both means are PRD-reported" present. 8 of 13 S6 mutations go red (MS7–MS11, MS13, MS15, MS16); the 5 survivors are in findings 1 and 2 | PASS |

### Real output (run 2)

#### Gates
```
$ wsl.exe -e bash scripts/dev.sh bash scripts/verify.sh renderer ; echo EXIT=$?        (shared tree, HEAD 2b1607e)
 Test Files  19 passed (19)
      Tests  582 passed (582)
━━━ verify.sh summary (scope: renderer)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (35s)
  PASS  renderer:typecheck (16s)
  PASS  renderer:tests (199s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
EXIT=0

$ (cd ~/.cache/labyrinth-probes/v0509 && bash scripts/verify.sh all) ; echo EXIT=$?   (isolated copy taken at the start of the run)
boundary: OK (142 files scanned)
docs: OK (10 task folders)
19 passed in 0.93s
All checks passed!
105 passed in 26.34s
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
  PASS  renderer:typecheck (60s)
  PASS  renderer:tests (102s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
EXIT=0
```
`verify.sh all` was not run on the shared tree (another agent was editing `main/`); the maintainer's run
on the integrated tree is the final word.

#### S1–S4 re-check: history of the path, tests, independent probe, rebuild, boundary
```
$ git rev-parse --short HEAD
2b1607e
$ git log --format='%h %ad %s' --date=short -- main/labyrinth_main/features/spatial main/tests/test_spatial.py artifacts/spatial.json contracts/spatial.schema.json
80888d4 2026-11-20 Backend data features: geometry, transport, forecast, budget, spatial (verified)
ecf14d5 2026-11-19 Scaffold Labyrinth: process boundary, exit-2 verify loop, contracts, agents
$ git status --short -- <same paths>   (empty = unchanged since HEAD)
$ git diff --stat HEAD -- <same paths>   (empty = unchanged since HEAD)
$ git diff --stat 80888d4 HEAD -- <same paths>   (empty = unchanged since the commit that added the verified backend)
main/labyrinth_main/features/spatial/artifact.py: 80888d4 09e24ef6ef3f0fad | shared tree 09e24ef6ef3f0fad | probe copy 09e24ef6ef3f0fad | same
main/labyrinth_main/features/spatial/__init__.py: 80888d4 012a0dc1f8b2a271 | shared tree 012a0dc1f8b2a271 | probe copy 012a0dc1f8b2a271 | same
main/tests/test_spatial.py: 80888d4 e65cbc1c8ab6b103 | shared tree e65cbc1c8ab6b103 | probe copy e65cbc1c8ab6b103 | same
artifacts/spatial.json: 80888d4 af255d380559803d | shared tree af255d380559803d | probe copy af255d380559803d | same

$ python3 -m pytest -q -p no:cacheprovider -v main/tests/test_spatial.py     (shared tree)
collected 4 items
main/tests/test_spatial.py ....                                          [100%]
============================== 4 passed in 0.94s ===============================

$ python3 -I <scratch>/probe_spatial_artifact.py /mnt/d/Labyrinth
file sha256 af255d380559803d1efacb81431f081277c826ec41066bca4bf55448fe17ea06 bytes 1488 LF-terminated True CR bytes 0
manifest sha matches file: True | schema spatial.schema.json
geometry Dommaschk | code GENE-X | nPlanes 6
ranks [{'device': 'GPU 0', 'planes': [1, 2, 3], 'rank': 0}, {'device': 'GPU 1', 'planes': [4, 5, 6], 'rank': 1}]
exchanges derived independently: [(0, 1, 1, 6), (0, 1, 3, 4), (1, 0, 4, 3), (1, 0, 6, 1)]
exchanges in artifact          : [(0, 1, 1, 6), (0, 1, 3, 4), (1, 0, 4, 3), (1, 0, 6, 1)] | equal: True | count 4
boundaries: [(1, 6), (3, 4)] | each in both directions: True
fieldSolve {'device': 'CPU'}
runs {'controlled': 4, 'passedReference': 4} | timing {'cpuMeanS': 184.69, 'gpuMeanS': 145.44, 'speedup': 1.27, 'speedupRecomputed': 1.269871}
184.69/145.44 (Decimal) = 1.269870737073707370737073707 | at 2 dp (half-up): 1.27 | at 7 sig figs: 1.269871e+00 | artifact speedupRecomputed 1.269871
provenance kind prd-reported | outcome blocked
details: Saved GENE-X checkpoints and timing logs are not in this repo, so plane ownership, the 4/4 reference passes and the timings cannot be verified. Only the ratio is recomputed: 184.69/145.44 = 1.2699 (PRD prints 1.27).
coverage: 4 controlled runs on the separate Dommaschk geometry (not W7-X); 6 toroidal planes over 2 ranks
note: This GENE-X case couples toroidal planes across GPUs through MPI halo exchanges. The live W7-X tubes are independent: GPU 0 advances the bean tube and GPU 1 the triangular tube with no exchange between them.
top-level keys == schema.required: True | has fixtures key: False
PROBE OK

$ (rebuild spatial.build() through common.io.dumps in the copy, compare with the committed artifact)
rebuilt sha256 af255d380559803d | committed af255d380559803d | byte-identical: True

$ python3 scripts/validate_artifacts.py   (shared tree, jsonschema)
artifacts: schema-valid
$ python3 scripts/check_boundaries.py   (shared tree)
boundary: OK (142 files scanned)
exit=0
```
Backend mutations (isolated copy, `python3 -m pytest -q -p no:cacheprovider main/tests/test_spatial.py`, control `4 passed in 0.01s`):
```
=== [MP1] GPU mean 150.00                      artifact.py :: > PRD_GPU_MEAN_S = 150.00
    exit=1  FAILED main/tests/test_spatial.py::test_S2_runs_and_speedup_recomputed - assert (184.69, 150.0, 1.27) == (184.69, 145.44, 1.27)
=== [MP2] verification outcome passed          artifact.py :: > outcome="passed",
    exit=1  FAILED main/tests/test_spatial.py::test_S3_provenance_prd_reported_and_verification_blocked - AssertionError: assert 'passed' == 'blocked'
=== [MP3] non-periodic ring (drops 6<->1)      artifact.py :: > for p in range(1, N_PLANES):
    exit=1  FAILED main/tests/test_spatial.py::test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve
=== [MP4] one direction per boundary           artifact.py :: > (second out.append deleted)
    exit=1  FAILED main/tests/test_spatial.py::test_S1_two_ranks_plane_ownership_periodic_exchanges_cpu_field_solve
=== [MP5] provenance kind derived              artifact.py :: > "derived",
    exit=1  FAILED main/tests/test_spatial.py::test_S3_provenance_prd_reported_and_verification_blocked - AssertionError: assert 'derived' == 'prd-reported'
```

#### S5–S6: the named tests on their own (shared tree)
```
$ npm --prefix renderer run -s test -- src/features/spatial src/shell src/lib --reporter=verbose
 ✓ src/features/spatial/SpatialView.test.tsx > S5 ring of 6 toroidal planes coloured by rank, exchange arrows both ways, CPU field-solve node, "Dommaschk geometry — not W7-X" 203ms
 ✓ src/features/spatial/SpatialView.test.tsx > S6 timing CPU 184.69 s vs GPU 145.44 s (1.27×), run tally 4/4, provenance PRD-reported / blocked, independence note 50ms
 Test Files  6 passed (6)
      Tests  12 passed (12)
exit=0
```
Reading the tests: neither is tautological. Both render the real `SpatialView` with the committed artifact
served through a stubbed `fetch`; nothing under test is mocked. S5 also asserts the pure layout (`ring.ts`)
against literal expectations, and S6 asserts `speedupFixture` against the literal 1.269871.

#### S5–S6 mutations (isolated copy; each line: mutated source line, exit code of `npm --prefix renderer run -s test -- src/features/spatial/SpatialView.test.tsx`, first failing assertion)
```
--- control (unmutated copy): exit=0   Tests  2 passed (2)
=== [MS1] label loses '— not W7-X'                  SpatialView.tsx :: > export const GEOMETRY_LABEL = 'Dommaschk geometry';
    exit=1  × S5  AssertionError: expected 'Dommaschk geometry' to be 'Dommaschk geometry — not W7-X'
=== [MS2] visible geometry label paragraph removed  SpatialView.tsx :: > (deleted)
    exit=1  × S5  TestingLibraryElementError: Unable to find an element by: [data-testid="geometry-label"]
=== [MS3] nodes coloured by plane parity, not rank  SpatialView.tsx :: > className={`sp-node sp-rank--${nd.plane % 2}`}
    exit=1  × S5  AssertionError: expected [ '1:sp-node sp-rank--1', …(5) ] to deeply equal [ '1:sp-node sp-rank--0', …(5) ]
=== [MS4] only one exchange direction drawn         SpatialView.tsx :: > {L.arrows.filter((ar) => ar.fromRank < ar.toRank).map((ar) => (
    exit=1  × S5  AssertionError: expected [ '3->4', '1->6' ] to deeply equal [ '3->4', '4->3', '6->1', '1->6' ]
=== [MS5] arrowheads at the wrong end               ring.ts :: > d: arcPath(cx, cy, tr, a0 + d - s * pad, a0 + s * pad),
    exit=1  × S5  AssertionError: expected [ '0', '1', '0', '1' ] to deeply equal [ '1', '0', '1', '0' ]
=== [MS6] field-solve node says GPU                 SpatialView.tsx :: > GPU
    exit=1  × S5  Error: expect(element).toHaveTextContent()
=== [MS7] speedup 'computed' is the PRD claim itself (not speedupRecomputed)   SpatialView.tsx :: > computed: t.speedup,
    exit=1  × S6  AssertionError: expected { id: 'spatial-speedup', …(6) } to match object { claimed: 1.27, …(3) }
=== [MS8] speedup fixture always matches            SpatialView.tsx :: > matches: true,
    exit=1  × S6  AssertionError: expected true to be false // Object.is equality
=== [MS9] provenance badge shows Verified           SpatialView.tsx :: > …verification: { ...prov.verification, outcome: 'passed' }…
    exit=1  × S6  TestingLibraryElementError: Unable to find an accessible element with the role "button" and name `/^Provenance of GENE-X spatial-parallelism replay: PRD-reported, Blocked$/`
=== [MS10] timing/tally panels labelled Derived     SpatialView.tsx :: > const prd = <StatusPill status="derived" />;
    exit=1  × S6  AssertionError: expected 1 to be greater than or equal to 3
=== [MS11] CPU mean shows the GPU value             SpatialView.tsx :: > <Stat label="CPU mean" value={t.gpuMeanS} unit="s" decimals={2} />
    exit=1  × S6  TestingLibraryElementError: Unable to find an accessible element with the role "group" and name "CPU mean: 184.69 s"
=== [MS12] tally always shows N of N (ignores passedReference)   SpatialView.tsx :: > value={a.runs.controlled}
    exit=0  GREEN — MUTATION SURVIVED     Tests  2 passed (2)
=== [MS13] verification panel pill says Verified    SpatialView.tsx :: > status={<StatusPill status="passed" />}
    exit=1  × S6  AssertionError: expected <span …(3)>…(2)</span> to be null
=== [MS14] plane ownership wrong in the layout      ring.ts :: > …rankOf.set(p, { rank: p <= 2 ? 0 : 1, device: rk.device });
    exit=1  × S5  AssertionError: expected [ '1:0', '2:0', '3:1', '4:1', …(2) ] to deeply equal [ '1:0', '2:0', '3:0', '4:1', …(2) ]
=== [MS15] independence note removed                SpatialView.tsx :: > (deleted)
    exit=1  × S6  TestingLibraryElementError: Unable to find an accessible element with the role "note" and name `/The live W7-X tubes are independent/`
=== [MS16] blocked callout claims verification      SpatialView.tsx :: > <p>Verified against the saved checkpoints.</p>
    exit=1  × S6  Error: expect(element).toHaveTextContent()
=== [MS17] sentence 'Only the ratio is recomputed. Both means are PRD-reported' removed   SpatialView.tsx :: > (deleted)
    exit=0  GREEN — MUTATION SURVIVED     Tests  2 passed (2)
=== [MS18] timing subtitle claims the means are recomputed from timing logs
    SpatialView.tsx :: > subtitle="Mean wall-clock time per controlled run, recomputed from the saved timing logs."
    exit=0  GREEN — MUTATION SURVIVED     Tests  2 passed (2)
=== [MS19] panel eyebrow says 'live' instead of 'replay'   SpatialView.tsx :: > eyebrow={`${VIEW} · live`}
    exit=0  GREEN — MUTATION SURVIVED     Tests  2 passed (2)
=== [MS20] boundary label one-directional (→ instead of ↔)   SpatialView.tsx :: > {`planes ${b.planes[0]} → ${b.planes[1]}`}
    exit=1  × S5  Error: expect(element).toHaveTextContent()
=== [MS21] tally panel title claims verification    SpatialView.tsx :: > title="Verified runs" subtitle="All runs verified here against the GENE-X reference."
    exit=0  GREEN — MUTATION SURVIVED     Tests  2 passed (2)
```
16 of 21 red. Survivors: MS12, MS17, MS18, MS19, MS21 (findings 1 and 2).

#### S5–S6 probes (my own test file `probe_spatial.test.tsx`, run only inside the copy)
```
$ (cd ~/.cache/labyrinth-probes/v0509 && npm --prefix renderer run -s test -- src/__probe__/probe_spatial.test.tsx)
PROBE|S5-ARROWS|
3->4: start is 35.4 from plane 3, 137.7 from plane 4; head is 35.4 from plane 4, 137.7 from plane 3; large-arc=0
4->3: start is 36.4 from plane 4, 102.2 from plane 3; head is 36.4 from plane 3, 102.2 from plane 4; large-arc=0
6->1: start is 36.4 from plane 6, 102.2 from plane 1; head is 36.4 from plane 1, 102.2 from plane 6; large-arc=0
1->6: start is 35.4 from plane 1, 137.7 from plane 6; head is 35.4 from plane 6, 137.7 from plane 1; large-arc=0
PROBE|S5-LABEL|"Dommaschk geometry — not W7-X" appears 4 times in the view
PROBE|S6-PILLS|["prd-reported:PRD-reported","blocked:Blocked","prd-reported:PRD-reported","prd-reported:PRD-reported","blocked:Blocked"]
PROBE|S6-TIMING-PANEL|Dommaschk geometry — not W7-XCPU vs GPU runtimeMean wall-clock time per controlled run, as stated in the PRD.PRD-reportedCPU mean184.69sGPU mean145.44sSpeedup (CPU ÷ GPU)Recomputed: 184.69 s ÷ 145.44 s = 1.2699PRD (×)1.27Computed1.27Δ0.00MatchOnly the ratio is recomputed. Both means are PRD-reported (dashed outlines): no timing logs are in this repo.
PROBE|S6-TALLY-PANEL|Dommaschk geometry — not W7-XControlled runsRuns compared against the GENE-X reference.PRD-reportedPassed the reference4of 4 runs1234
PROBE|S6-MISMATCH|Speedup (CPU ÷ GPU): Mismatch. Claimed 1.27, computed 2.00, difference +0.73 | data-outcome=mismatch | Speedup (CPU ÷ GPU)Recomputed: 200.00 s ÷ 100.00 s = 2.0000PRD (×)1.27Computed2.00Δ+0.73Mismatch
PROBE|S6-INCONSISTENT|Speedup (CPU ÷ GPU): Mismatch. Claimed 1.27, computed 1.31, difference +0.04 | Speedup (CPU ÷ GPU)Recomputed: 184.69 s ÷ 145.44 s = 1.3100PRD (×)1.27Computed1.31Δ+0.04Mismatch
PROBE|S6-TALLY|3 of 4 -> pass marks 3 of 4; arrows 2
PROBE|S6-HARDCODED|artifact says derived/passed -> pills ["derived:Derived","passed:Verified","prd-reported:PRD-reported","prd-reported:PRD-reported","blocked:Blocked"]
 ✓ src/__probe__/probe_spatial.test.tsx (3 tests) 378ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
exit=0
```
The probe also asserts (all passed): planes 1–3 carry `data-rank="0"` and 4–6 `data-rank="1"`, taken from
the artifact and not from the layout code; no arrow joins two planes of one rank; every arrow has
`marker-end` and no `marker-start`, and the marker it points at exists; the ring's text never mentions the
bean or triangular tube; no pill of status passed, live, derived, archive or rehearsal is in the view; the
view text never contains "Verified" or "LIVE".

Real browser (headless Edge, `http://127.0.0.1:4173/#/spatial`, 1440 px, screenshot read by eye; DOM dumped with `--dump-dom`):
```
#/spatial: title='Spatial parallelism · Labyrinth' aria-current=['#/spatial'] mode='Replay · $0 | No live backend reachable: every view plays saved evidence.'
   main text 2844 chars; headings: […, 'GENE-X on Dommaschk geometry — not W7-X', 'CPU vs GPU runtime', 'Controlled runs', 'Why this is not verified here', 'Provenance legend']
   canvas=0 svg-in-main=21 plotly-plots=0 error-panel-phrases=[] LIVE-pill=False
```
In the screenshot: rank 0 is three blue circles (planes 1–3, right half), rank 1 three ochre squares
(planes 4–6, left half); two arrows with heads at each of the 6↔1 (top) and 3↔4 (bottom) boundaries,
pointing opposite ways; "Field solve / CPU" box in the centre; the dashed "Dommaschk geometry — not W7-X"
chip above the ring; the "The live W7-X tubes are independent" callout below it; dashed timing bars
(184.69 s full width, 145.44 s shorter, both from zero); "Speedup … PRD (×) 1.27 · Computed 1.27 · Match";
"4 of 4 runs" under a PRD-reported pill; a violet Blocked panel "Plane ownership, the 4/4 passes and the
timings cannot be checked". With a scripted backend that reports `mode: "live"` the header shows LIVE while
this view still says "Spatial parallelism · replay" and draws no LIVE pill (DOM dump: one `data-status="live"`
element on the page, in the header).

Honesty check: every PRD number of this task reproduces (1.27 = 184.69/145.44 at 2 dp). Nothing is shown
as recomputed except the ratio, and nothing is shown as live or verified.

### Findings (run 2), ranked
No blocker and no major finding for task 05.

1. **Minor, weak test (honesty wording).** `renderer/src/features/spatial/SpatialView.test.tsx:64-93` does
   not look at the sentences that say where the numbers come from. Four mutations that would break the
   honesty rule stay green: the timing subtitle changed to "recomputed from the saved timing logs"
   (`SpatialView.tsx:188`, MS18), the eyebrow changed to "· live" (`SpatialView.tsx:80`, MS19), the tally
   panel renamed "Verified runs … verified here" (`SpatialView.tsx:212`, MS21) and the sentence "Only the
   ratio is recomputed. Both means are PRD-reported" deleted (`SpatialView.tsx:207-209`, MS17). The shipped
   text is honest (probe above). Fix: assert "as stated in the PRD", "Only the ratio is recomputed",
   "· replay" and that the panel text never matches `/recomputed from|verified here|live ·/i`.
2. **Minor, weak test.** The run tally is only tested with 4 of 4, so `value={a.runs.controlled}`
   (MS12, `SpatialView.tsx:216`) passes. My probe with 3 of 4 shows the view is data-driven. Fix: one
   assertion with `passedReference: 3`.
3. **Minor.** Three status pills are hard-coded: `SpatialView.tsx:74` (PRD-reported on the timing and tally
   panels) and `SpatialView.tsx:231` (Blocked). They agree with today's artifact, but if the checkpoints
   arrive and the artifact becomes derived/passed, the badge will say "Derived, Verified" while the panels
   still say PRD-reported and Blocked (probe S6-HARDCODED). Fix: derive them from `provenance.kind` and
   `provenance.verification.outcome`.
4. **Minor.** The note under the speedup prints the artifact's `speedupRecomputed` after an equals sign
   without dividing (`SpatialView.tsx:42`). With an inconsistent artifact it would print
   "184.69 s ÷ 145.44 s = 1.3100" (probe S6-INCONSISTENT). interface.md §2 item 8 makes the artifact the
   source and `test_S2` pins it, so this cannot happen with a fresh artifact. Fix (optional): compute the
   quotient in the note, or flag a difference from `cpuMeanS / gpuMeanS`.
5. **Minor, design.** (a) Rank colours reuse the series tokens of the W7-X archive codes,
   `--lab-series-stella` and `--lab-series-gene` (`spatial.css:6-7`); a neutral pair would keep this view
   visually apart from the stella/GENE traces. (b) At 1440 px the label column of the speedup fixture wraps
   into six short lines (screenshot). (c) The 4/4 tally uses check marks; they are neutral and dashed and
   sit under a PRD-reported pill, so this is a judgement call for the design review.
6. **Note on run 1.** `artifact.py` was edited after run 1 and before commit `80888d4`: the module docstring
   now says the ownership and boundaries are taken from the PRD and TASK.md (run-1 finding 1), and
   `test_S1` asserts that wording. The file is unchanged since `80888d4`; run 2 re-verified the current
   content (tests, five mutations, byte-identical rebuild).
7. **Outside task 05.** The app shell around this view has defects when the live backend reports a
   failed or pending termination or a partial status body. See `tasks/09-app-shell/VERIFY.md`.

Could not check: the view against real GENE-X checkpoints (none in the repo; that is why verification is
`blocked`), other browsers than headless Edge, and assistive technology.

Verdict: PASS
