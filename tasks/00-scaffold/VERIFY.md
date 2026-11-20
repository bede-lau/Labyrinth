# Verify: 00-scaffold (third run)
Verifier run: 2026-11-20, commit 86a5142 (the fix commit for run-2 findings). Main-tree HEAD is now 5030458;
`scripts/`, `.claude/` and this task folder are unchanged since 86a5142. Verified in an isolated `git worktree` at
`/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/verify-00c` with
`renderer/node_modules` symlinked from the main tree. `git status --porcelain` was `?? renderer/node_modules`
before and after every probe. Every mutation was reverted. The worktree was removed afterwards.

## History
- **Run 1 (1cdc976): FAIL, findings F1–F11.** 13 of 14 boundary bypass shapes got through, including a vite alias plus a template-literal `?raw` import that put `main/` source into `vite build` output. The DONE gate could be fooled, and the stop hook had gaps. Fixed in 408ce44.
- **Run 2 (0884d0b): FAIL, findings N1–N11.** F1–F11 were all fixed. Absolute and `/@fs/` import paths had regressed and leaked end to end (N1, blocking). Other gaps: cwd-relative test paths (N3), `tsconfig.*.json` not scanned (N4), a final `Verdict: FAIL — reason` line ignored (N9), false positives (N10), and a gate test that wrote into the live tree (N11). Fixed in 86a5142.
- **Run 3 (this run): PASS, with residual findings R1–R7 below.**

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| 1 | `main/` and `renderer/` exist; imports between them are rejected | `check_boundaries.py --self-test`: 34 violations caught, 7 clean files passed. `scripts/tests/test_gates.py`: self-test, each violation, hook in a temp repo. Mutations that drop the absolute branch, the cwd candidate, or `tsconfig.*.json` scanning each fail 2 tests | All 36 run-1 shapes re-run (b2, a bare `@backend/…` with no alias defined, is harmless and passes): scanner, Edit hook, Bash hook and full scan all exit 2. N1 shapes (absolute path, `/@fs/` path, absolute vite alias, `/@fs/` to data/raw) now exit 2 in all four. N3 and N4 shapes exit 2. 9 fresh plain attempts. **Remaining leaks need a deliberate traversal or `file://` spelling (R1)** | PASS (R1, R2 and R3 are low-medium, none accidental-shaped) |
| 2 | `verify.sh` stages; exit 2 on any failure or bad invocation | `test_verify_rejects_bad_invocations_with_2` | `verify.sh all` → 0 on clean HEAD. Unchanged since run 2, where every failing stage and bad argument gave 2 | PASS |
| 3 | PostToolUse boundary hook and Stop verify loop exit 2 on failure | `test_post_edit_hook_*` (temp repo, Edit + Bash payloads), `test_stop_hook_*` (3 tests) | The hook gives 2 on every caught shape for both payload kinds. Under strace, the whole `scripts/tests` run makes **0 writes** under the live `renderer/` or `main/` (N11 fixed). If the hook ignores `LABYRINTH_ROOT`, the hook test fails. `stop_verify.sh` is unchanged since run 2 (real runs passed there) | PASS (R5, low) |
| 4 | Pinned raw inputs with sha256 checks | `test_raw_inputs_match_pinned_sha256`, `test_every_raw_file_is_pinned` | Unchanged since run 2, where a 1-byte mutation and an unpinned file each gave 2 | PASS |
| 5 | Handoff docs and the DONE gate | `test_docs_gate_*` (2 tests, 4 new N9 cases). With fence stripping removed, the docs test fails | `Verdict: FAIL — reason` after a PASS line → 2. PASS inside a fenced block → 2. Second `## Status` → 2. Residual: the bare template line `Verdict: PASS \| FAIL` and a `~~~` fence count as PASS (R4) | PASS (R4, low-medium) |

## Real output

### `bash scripts/verify.sh all` at 86a5142 → EXIT=0
```
━━━ [boundary:self-test] $ python3 scripts/check_boundaries.py --self-test
boundary self-test: OK (34 violations caught, 7 clean files passed)
━━━ [boundary:scan] $ python3 scripts/check_boundaries.py
boundary: OK (34 files scanned)
━━━ [docs:handoff] $ python3 scripts/check_docs.py
docs: OK (10 task folders)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (0s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (2s)
  PASS  renderer:tests (1s)
  PASS  renderer:build (1s)
verify.sh: all stages passed.
EXIT=0
```
### `pytest scripts/tests`, `verify.sh boundary`, `verify.sh docs` (clean tree)
```
10 passed in 0.79s                       pytest EXIT=0
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  scripts:tests (1s)
verify.sh: all stages passed.            verify.sh boundary EXIT=0
  PASS  docs:handoff (0s)
verify.sh: all stages passed.            verify.sh docs EXIT=0
```

### Earlier probes re-run
Columns: `check_boundaries.py FILE`, hook with an Edit payload, hook with `{"tool_name":"Bash"}`, full scan.
```
c1–c13, p1–p5 (run-1 caught set)                         all  check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
b1,b3–b8, q1–q7, zz1–zz3 (run-1 bypass set)              all  check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
b2   import x from '@backend/common/io'  (no alias defined)    0 0 0 0   harmless alone; the alias definition is caught:
al-vt vite alias '@backend' -> resolve(dirname,'../main')       2 2 2 2  CAUGHT
n19  vite alias { '@backend': '<root>/main' }   (N1)            2 2 2 2  CAUGHT
n20  fetch('/@fs<root>/data/raw/wout_w7x_kjm.nc')  (N1)         2 2 2 2  CAUGHT
n08  import t from '/@fs<root>/main/pyproject.toml?raw'  (N1)   2 2 2 2  CAUGHT
n09  import t from '<root>/main/pyproject.toml?raw'  (N1)       2 2 2 2  CAUGHT
n06  readFileSync(resolve(process.cwd(), '../main/pyproject.toml'))  (N3)   2 2 2 2  CAUGHT
n07  readFileSync('../data/raw/wout_w7x_kjm.nc') in a test  (N3)           2 2 2 2  CAUGHT
n15  renderer/tsconfig.node.json paths ../main/*  (N4)                      2 2 2 2  CAUGHT
n01,n04,n10,n12,n18,p04,p08,p10,p11                                         2 2 2 2  CAUGHT
n05  path.join(__dirname,'..','..','..','main')  from src/      0 0 0 0  MISSED  (caught in run 2; R2)
n02,n03,n11,n13,n14,n16,n17, p01–p03,p05–p07,p09,p12,p13       0 0 0 0  MISSED  (obfuscation / low, see R7)
```

### Fresh attempts in this run (all plain spellings), e2e = `leaked` imported from `main.tsx`, then `npx vite build`
```
baseline bundle backend-text count: 0
spec=/../main/pyproject.toml?raw            boundary=0 hook(Edit)=0 hook(Bash)=0 | vite: ✓ built in 161ms | backend text in bundle: 1
spec=/src/../../main/pyproject.toml?raw     boundary=0 hook(Edit)=0 hook(Bash)=0 | vite: ✓ built in 175ms | backend text in bundle: 1
spec=file://<root>/main/pyproject.toml?raw  boundary=0 hook(Edit)=0 hook(Bash)=0 | vite: ✓ built in 153ms | backend text in bundle: 1
glob('/../main/*.toml')                     boundary=0 | vite: ✓ built in 164ms | bundle: 1
fp1 querySelector('main') + role:'main' (want 0)                     fullscan=0   (N10 fixed)
fp3 src/__fp/b.ts: import '../data/fixtures' (renderer/src/data exists; want 0)  fullscan=2
    - renderer/src/__fp/b.ts:1: renderer path '../data/fixtures' leaves renderer/ (resolves to data/fixtures)
fp4 import '../scripts/setup' from src/__fp (renderer/src/scripts; want 0)        fullscan=2
fp2 main: getLogger('renderer')                                      fullscan=2   (still flagged; R6)
n05b src/__r/x.test.ts join(__dirname,'..','..','main',…)            fullscan=0
violation present, no env: boundary EXIT=2
LABYRINTH_ROOT=<empty dir> verify.sh boundary:  boundary: OK (0 files scanned) … EXIT=0
LABYRINTH_ROOT=<empty dir> hook(Bash) EXIT=0
```

### Docs gate (worktree TASK.md and VERIFY.md mutated, then restored)
```
final PASS line                                               -> EXIT=0
N9: line-start PASS, final 'Verdict: FAIL — reason'           -> EXIT=2
N9: PASS only inside a backtick fence                         -> EXIT=2
PASS only inside an indented fence / a 4-backtick fence       -> EXIT=2 / 2
PASS, then unclosed fence, then final FAIL                    -> EXIT=2
second ## Status heading                                      -> EXIT=2
committed VERIFY.md (run-2 FAIL)                              -> EXIT=2
PASS only inside a ~~~ fence                                  -> EXIT=0   <- R4
template line 'Verdict: PASS | FAIL' at line start            -> EXIT=0   <- R4 (was 2 in run 2)
'Verdict: PASS (outcome 1 FAIL …)'                            -> EXIT=0   (prefix match, by design)
restored                                                      -> EXIT=0
```

### N11 and mutations
```
$ strace -f -e trace=openat,creat,unlink,unlinkat,rename python3 -m pytest -q -p no:cacheprovider scripts/tests
10 passed in 2.99s
writes/unlinks under <worktree>/renderer/ or <worktree>/main/ (excluding __pycache__): 0     (198 O_CREAT elsewhere, in tmp)

FAILED test_post_edit_hook_exits_2_on_violation_and_0_when_clean        ^ mutant: hook ignores LABYRINTH_ROOT
FAILED test_boundary_self_test_catches_all_known_bypasses / _each_violation_individually   ^ mutant: no cwd-relative candidate (N3)
FAILED test_boundary_self_test_catches_all_known_bypasses / _each_violation_individually   ^ mutant: absolute paths ignored (N1)
FAILED test_docs_gate_requires_final_verdict_line                       ^ mutant: fence stripping removed (N9)
FAILED test_boundary_self_test_catches_all_known_bypasses / _each_violation_individually   ^ mutant: tsconfig.*.json unscanned (N4)
```

## Findings
Run-2 findings N1, N3, N4, N9, N10 (renderer side) and N11 are fixed, and each was re-probed and mutation-checked above.
The residual findings are below. None is a shape an agent would write by accident.

- **R1 (low-medium): root-relative paths that climb out of `renderer/`, and `file://` URLs, still leak.**
  - For specs starting with `/`, `scripts/check_boundaries.py:84` resolves only the literal filesystem path. Vite treats `/x` as relative to its project root (`renderer/`).
  - So `/../main/…`, `/src/../../main/…`, `import.meta.glob('/../main/*')` and `file://<root>/main/…` pass, and the e2e build put backend text in `dist/`.
  - These need a deliberate `..` after the root, or a hand-built `file://` URL.
  - Fix (two lines): for `/` specs, also add `((renderer / spec.lstrip('/')).resolve(), False)`; strip a `file://` prefix like `/@fs`.
- **R2 (low-medium, a regression from run 2): segmented `path.join` from `src/` is missed.**
  - `join(__dirname, '..', '..', 'main', …)` in a renderer test now passes (n05, n05b). Each `'..'` stays inside `renderer/`, and the bare `'main'` is no longer flagged because of the N10 fix.
  - This is node-side test coupling, not a bundle import. In `vite.config.ts` the same idiom is still caught (n04).
- **R3 (medium friction, fails closed): false positive from the cwd candidate.**
  - At `check_boundaries.py:90`, a normal file-relative import `'../data/…'` or `'../scripts/…'` from one level under `renderer/src/` is rejected when the folder is `renderer/src/data`. A folder named `data` is a very common React layout (fp3, fp4).
  - The gate fails closed, so this is not a bypass, but it will block legitimate frontend code.
  - Suggested fix: apply the cwd candidate only in `*.test.*` and config files, or only when the file-relative target does not exist.
- **R4 (low-medium, a partial F5 regression): the verdict regex at `scripts/check_docs.py:45` accepts some non-verdicts.**
  - `^Verdict:[ \t]*(PASS|FAIL)\b.*$` accepts the unfilled template line `Verdict: PASS | FAIL` from `.claude/agents/verifier.md` as PASS. Run 2 rejected it. Gate test case `b` puts the template mid-line, so it does not catch this.
  - `~~~` fences are not stripped.
  - Fix: reject a verdict line that contains both PASS and FAIL; strip `~~~` fences too.
- **R5 (low): `LABYRINTH_ROOT` silently redirects the gate.**
  - The test-only override at `check_boundaries.py:36` and `post_edit_boundary.py:13` is honoured by `verify.sh` and the hooks.
  - Pointing it at an empty directory gives `boundary: OK (0 files scanned)` and exit 0 while a violation exists.
  - This needs the variable in the hook's or Stop hook's environment, which counts as env-driven, out of scope. Still worth closing: `verify.sh` can `unset LABYRINTH_ROOT`, and a full scan of 0 files should exit 2.
- **R6 (low): the main-side false positive from N10 remains.** `logging.getLogger('renderer')` is still flagged by `RENDERER_PATH` (`:44`). Only the renderer-side `'main'` false positive was fixed.
- **R7 (low, obfuscation or deliberate config; carried from run 2):**
  - N2: a symlink to main inside renderer, used through `import.meta.glob`.
  - N5: quote confusion from an apostrophe in a comment or JSX on the same line (n13, n14).
  - N6: unquoted CSS `url()` and unquoted HTML attributes (n11, n16).
  - N7: dotted Python module names via `runpy`, `pkgutil` or a variable (p03, p07, p12).
  - N8: a `file:../main` package.json dependency, and `pythonpath` in `main/pyproject.toml`.
  - String concatenation or `join` with split words (n02, n03, p05, p13), `exec`, a bytes literal, `getattr(importlib, …)`, `os.environ`-driven paths, and backslash separators.
  - A static checker cannot reasonably stop these. They matter only against an adversarial author.

Outcomes 1–5 hold for realistic, non-obfuscated coupling. Every plain import, alias, absolute, `/@fs/`, cwd-relative or tsconfig spelling that reaches `main/`, `scripts/` or `data/` makes `check_boundaries.py`, both hook payloads and `verify.sh` exit 2. The remaining gaps (R1–R7) need a deliberate traversal, a non-import fs idiom, an environment override or obfuscation. R1, R3 and R4 are cheap to close and should be fixed before frontend work starts.

Verdict: PASS

## Run 4 — whole task
Verifier run: 2026-11-20, commit 3faed3a
Scope: the whole task at 3faed3a, after the wave-2 fixes (SC-1 to SC-13) and the review round. Before the run,
`git status --short` showed only ` M status.md`, so every owned path (`scripts/`, `.claude/settings.json`,
`.github/workflows/`, `.gitattributes`) matched the commit. The gate evidence is the maintainer's `verify.sh all` at
3faed3a, quoted below and not re-run here (nine other verifiers were running, and the owner asked for short checks).
The task's own tests were run in the shared tree, read-only. The probes and 5 mutations ran in a
`scripts/probe-copy.sh vt-00-scaffold` copy, which was removed afterwards.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| 1 | `main/` and `renderer/` exist; imports between them are rejected | `check_boundaries.py --self-test`: 134 violation shapes caught, 25 clean files passed, 3 OS flavours agree. The 13 `test_boundary_*` tests in `scripts/tests/test_gates.py` write the corpus to tmp_path and assert exit 2 for each violation and exit 0 for each clean file | I planted 6 fresh shapes: a re-export, a template `import()`, `/../main/…?raw`, `new URL` into `data/raw`, Python `parents[2] / "renderer"`, and `cwd="../renderer"`. For each one, `check_boundaries.py FILE`, the hook's Edit payload and the full scan all exit 2. The old R3 false-positive shape (`../data/fixtures` from `src/__fp/`) and an artifacts JSON import exit 0. Mutant (the vite `/@fs/` rule returns None) is caught by 3 tests | PASS |
| 2 | `verify.sh` runs the stages in order and exits 2 on any failure or bad invocation | 6 `test_verify_*` tests. They run the real verify.sh with stub tools: each of the 11 stages failing in turn (codes 1, 2, 3, 127) gives 2, bad scopes give 2, a fake Python gives 2, and a real failing docs stage gives 2 | `verify.sh nope`, `''`, `ALL` and `main extra` each exit 2. In the probe copy, `verify.sh docs` exits 0, then exits 2 once task 00 is set DONE and VERIFY.md ends in a failing line. Mutant (the failed-stage `exit 2` changed to `exit 1`) is caught by 2 tests. The maintainer's `verify.sh all` at 3faed3a: exit 0, 11/11 stages | PASS |
| 3 | PostToolUse boundary hook and Stop-hook verify loop, both exit 2 on failure | `test_post_edit_hook_*` (4). `test_settings_*` (4), which run the commands from `.claude/settings.json` for real. `test_stop_hook_*` (7) and `test_stop_launcher_*` (2) | The real `post_edit_boundary.py` gives 2 for each of the 6 planted files (Edit payload) and for a PowerShell payload. The real `stop_verify.sh` gives 2 with a verify command of `exit 1` or `exit 3`, and 0 with `true`. `stop_launcher.py` passes the 2 through. Mutants: the hook returns 0 for the edited file (caught by 2 tests); the final `exit 2` of stop_verify.sh changed to `exit 1` (caught by 6 of the 7 stop-hook tests) | PASS |
| 4 | Pinned raw inputs in `data/raw/` with sha256 checks | `test_raw_inputs_match_pinned_sha256` (6 params) and `test_every_raw_file_is_pinned` in `main/tests/test_common.py`: 7 passed | I ran my own hashlib over every file in `data/raw/`: all 6 match the PINNED table, and the files present equal the pinned set. Git attributes mark them binary. Mutant (one byte of `stella_test2_vmec_geometry.in` changed in the copy) is caught by its sha256 test; 7 passed after the revert | PASS |
| 5 | Handoff docs exist: status.md, architecture.md, decision.md, CLAUDE.md, tasks/*/TASK.md | 11 `test_docs_*` tests and `test_verifier_instructions_match_the_docs_gate`. They cover the D-022 rules: the last line must be exactly the PASS line, every outcome needs a row, and the run must match the verified commit | `check_docs.py` on the tree prints `docs: OK (10 task folders)`, exit 0. The four files exist and are non-empty (352, 143, 224 and 67 lines), and there are 10 `tasks/*/TASK.md`. The DONE-gate probe under outcome 2 gives 2 with the exact reason | PASS |

### Real output
The gate evidence, quoted from the maintainer and not re-run by this verifier:
```
bash scripts/verify.sh all at 3faed3a -> exit 0, 11/11 stages
boundary self-test 134 shapes, scripts 71 passed, ruff clean, main 331 passed,
artifacts schema + fresh, tsc clean, vitest 1350 passed, vite build OK
```
The task's own tests, shared tree, through `scripts/dev.sh`:
```
$ python3 scripts/check_boundaries.py --self-test
boundary self-test: OK (134 violations caught, 25 clean files passed, 3 OS flavours agree)
EXIT=0
$ python3 scripts/check_boundaries.py
boundary: OK (167 files scanned)
EXIT=0
$ bash scripts/verify.sh nope; echo $?
verify.sh: unknown scope 'nope' (expected all|main|renderer|boundary|artifacts|docs)
EXIT=2
$ python3 -m pytest -q -p no:cacheprovider scripts/tests
71 passed in 41.28s
EXIT=0
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_common.py -k "sha256 or pinned"
7 passed, 7 deselected in 0.49s
EXIT=0
$ python3 scripts/check_docs.py
docs: OK (10 task folders)
EXIT=0
status.md 352 lines / architecture.md 143 lines / decision.md 224 lines / CLAUDE.md 67 lines / 10 tasks/*/TASK.md
```
Probes in the probe copy:
```
=== O1: fresh violation shapes of my own (check_boundaries.py FILE / hook Edit payload / full scan)
renderer/src/vt_d.ts           check=2 hook(Edit)=2   const s = new Worker(new URL('../../../data/raw/wout_w7x_kjm.nc', import.meta.url));
main/labyrinth_main/vt_e.py    check=2 hook(Edit)=2   SRC = Path(__file__).resolve().parents[2] / "renderer" / "src" / "App.tsx"
renderer/src/vt_c.ts           check=2 hook(Edit)=2   import t from '/../main/pyproject.toml?raw';
renderer/src/vt_a.ts           check=2 hook(Edit)=2   export * from '../../main/labyrinth_main/server';
renderer/src/vt_b.ts           check=2 hook(Edit)=2   const m = await import(`../../main/labyrinth_main/${name}.py`);
main/labyrinth_main/vt_f.py    check=2 hook(Edit)=2   subprocess.run(["npm", "run", "build"], cwd="../renderer")
full scan with all six planted: 2
hook PowerShell payload:        2
clean shapes (want 0): vt_ok.ts=0 __fp/b.ts=0 vt_clean.ts=0
full scan after removal: boundary: OK (170 files scanned) EXIT=0
=== O2: verify.sh invocations and a real failing stage
verify.sh 'nope' -> 2
verify.sh '' -> 2
verify.sh 'ALL' -> 2
verify.sh 'main extra' -> 2
verify.sh docs (copy, untouched) -> 0
verify.sh docs with 00 DONE + final 'Verdict: FAIL — probe' -> 2
v.out:  FAIL  docs:handoff (0s)
v.err:DOCS ERROR: tasks/00-scaffold/TASK.md: Status DONE but tasks/00-scaffold/VERIFY.md final verdict line (line 160) is 'Verdict: FAIL — probe', not exactly 'Verdict: PASS'
=== O3: Stop hook and launcher, real scripts
stop_verify.sh with verify cmd 'exit 1' -> 2
stop_verify.sh with verify cmd 'exit 3' -> 2
stop_verify.sh with verify cmd 'true' -> 0
stop_launcher.py with failing verify -> 2
=== O4: independent sha256sum vs the PINNED table
stella_benchmark_DOI_10_1017_S0022377822000393.h5          356008 B  match
stella_test2_vmec_geometry.geometry                          4680 B  match
stella_test2_vmec_geometry.in                                3306 B  match
stella_test2_vmec_geometry.out.nc                          384387 B  match
stella_test2_vmec_geometry.vmec.geo                          5501 B  match
wout_w7x_kjm.nc                                           2325276 B  match
files present == pinned set: True
data/raw/wout_w7x_kjm.nc: binary: set
```
Mutations, each reverted right after:
```
--- mutant scripts/check_boundaries.py: 303s/return "is a vite \/@fs\/ raw-filesystem URL"/return None/
FAILED scripts/tests/test_gates.py::test_boundary_self_test_catches_all_known_bypasses
FAILED scripts/tests/test_gates.py::test_boundary_corpus_holds_every_review_bypass
FAILED scripts/tests/test_gates.py::test_boundary_each_violation_individually
3 failed, 68 deselected in 0.34s
--- mutant scripts/hooks/post_edit_boundary.py: s/    return cb.run(\[Path(target)\], cb.ROOT)/    return 0/
FAILED scripts/tests/test_gates.py::test_post_edit_hook_exits_2_on_violation_and_0_when_clean
FAILED scripts/tests/test_gates.py::test_post_edit_hook_checks_every_editing_tool_and_any_letter_case_of_the_side
2 failed, 2 passed, 67 deselected in 0.49s
--- mutant scripts/hooks/stop_verify.sh: $s/^exit 2$/exit 1/
FAILED scripts/tests/test_gates.py::test_stop_hook_blocks_with_2_then_releases_after_max
FAILED scripts/tests/test_gates.py::test_stop_hook_counters_are_per_session
FAILED scripts/tests/test_gates.py::test_stop_hook_maps_every_verify_exit_code_to_0_or_2
FAILED scripts/tests/test_gates.py::test_stop_hook_skips_verify_only_for_a_clean_tree_at_the_last_green_commit
FAILED scripts/tests/test_gates.py::test_stop_hook_never_takes_the_shortcut_when_git_fails
6 failed, 1 passed, 64 deselected in 0.55s
--- mutant scripts/verify.sh: /verify.sh: FAILED/{n;s/exit 2/exit 1/}
FAILED scripts/tests/test_gates.py::test_verify_exits_2_when_any_single_stage_fails_and_still_runs_the_rest
FAILED scripts/tests/test_gates.py::test_verify_exits_2_when_a_real_stage_fails_and_ignores_the_test_overrides
2 failed, 69 deselected in 0.16s
--- mutant data/raw/stella_test2_vmec_geometry.in: byte 10 -> 'X'
FAILED tests/test_common.py::test_raw_inputs_match_pinned_sha256[stella_test2_vmec_geometry.in-ea741f75e855d26238496e0c2594421526dc6e93e467ed009724124
1 failed, 6 passed, 7 deselected in 0.03s
after revert: 7 passed, 7 deselected in 0.01s
probe copy removed: yes
```
(The stop-hook mutant's output was cut to 6 lines, so only 5 of its 6 FAILED names are shown. The summary line counts 6.)

### Findings
No blocking or major defects.
- Residual findings from run 3, re-checked:
  - R1 is closed. `/../main/pyproject.toml?raw` now exits 2 (vt_c). `file://` is in the corpus at `scripts/check_boundaries.py:768` and `:827`.
  - R3 is closed. `__fp/b.ts` importing `../data/fixtures` exits 0.
  - R4 is closed. The template line and `~~~` fences are now rejected, and the tests assert this (`scripts/tests/test_gates.py:1176`, `:1186`).
  - R5 is closed. `scripts/verify.sh:26` unsets `LABYRINTH_ROOT`, and a zero-file scan is an error (`scripts/tests/test_gates.py:251`).
  - R2 has corpus entries (`scripts/check_boundaries.py:765`). R6 and R7 were not re-probed in this short run.
- Minor (docs): Tests row 3 at `tasks/00-scaffold/TASK.md:18` says "see tasks/00-scaffold/VERIFY.md" instead of naming the real tests. Those are `pytest scripts/tests -k "post_edit_hook or stop_hook or stop_launcher or settings"`.
- Minor (docs): row 4 at `tasks/00-scaffold/TASK.md:19` runs `-k sha256`, which skips `test_every_raw_file_is_pinned` (`main/tests/test_common.py:90`). `-k "sha256 or pinned"` runs both tests.
- Minor (docs): outcome 2 at `tasks/00-scaffold/TASK.md:8` gives the order as "boundary → lint → tests → …". `scripts/verify.sh:12-13` also runs docs:handoff and scripts:tests before main:lint. The test enforces the verify.sh header list (`scripts/tests/test_gates.py:647-654`), so the code is consistent and only the TASK.md wording is out of date.
- Not reproduced here: `verify.sh all` itself. It is quoted from the maintainer's run at 3faed3a, as instructed.
- By design, not a defect: after 6 consecutive blocks the Stop hook releases with 0 (D-003, `scripts/hooks/stop_verify.sh:78-81`).

Verdict: PASS
