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
