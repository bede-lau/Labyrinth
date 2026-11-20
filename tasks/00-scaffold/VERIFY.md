# Verify: 00-scaffold (re-verification)
Verifier run: 2026-11-19, commit 0884d0b (HEAD; includes fix commit 408ce44), clean, verified in an isolated
`git worktree` at `/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/verify-00b`
with `renderer/node_modules` symlinked from the main tree. `git status --porcelain` was `?? renderer/node_modules`
(the symlink) before and after every probe. Every mutation was reverted. The worktree was removed afterwards.

## Previous run: FAIL (findings F1–F11)
The run at 1cdc976 found 13 of 14 boundary bypass shapes getting through, including an end-to-end leak of
`main/` source into the `vite build` output (F1–F4). It also found a DONE gate that could be fooled (F5),
stop-hook gaps (F6–F8) and three low-severity items (F9–F11). Commit 408ce44 addressed them.
**This run: every F1–F11 item is fixed.** All 14 old bypass shapes, the tsconfig/vite alias and the old
end-to-end leak now exit 2 in the scanner, in the Edit hook and in the Bash hook. However, a fresh, plain
(non-obfuscated) shape still leaks end to end: an **absolute-path import** (N1 below). It worked as a ban
in the old checker and was lost in the rewrite.

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| 1 | `main/` and `renderer/` exist; imports between them are rejected | `check_boundaries.py --self-test`: 28 violations caught, 7 clean files passed. `scripts/tests/test_gates.py`: self-test, per-violation, hook. A mutation that drops template-literal scanning makes 2 tests fail | 37 old shapes (18 old-caught, 15 old-bypass, 3 old sys.path shapes, plus `@backend` usage) re-run: every real violation now exits 2 in the scanner, the Edit hook, the Bash hook and the full scan. The tsconfig `paths` alias and the vite alias are caught. The old e2e leak: `verify.sh all` exits 2. Of 33 fresh attempts, 13 were caught, 20 missed. **2 plain shapes leak to `dist/`: an absolute path and `/@fs/`** | **FAIL**: absolute-path and `/@fs/` specifiers are not resolved (N1, medium; a regression from 1cdc976). The other misses are obfuscation, deliberate symlinks/config, or low-severity |
| 2 | `verify.sh` runs boundary → docs → lint → tests → artifacts → typecheck → tests → build; exits 2 on any failure or bad invocation | `test_verify_rejects_bad_invocations_with_2` | Clean `all` → 0. `''` → 2, `main extra` → 2, `nope` → 2 (F11 fixed). The boundary violation (e2e leak) → `all` 2. An unpinned raw file → `main` 2 | PASS |
| 3 | PostToolUse boundary hook and Stop verify loop both exit 2 on failure | `test_post_edit_hook_*`, `test_stop_hook_*` (3 tests). A mutation to a shared counter fails `test_stop_hook_counters_are_per_session` | The hook exits 2 on Edit payloads and on `{"tool_name":"Bash"}` payloads for every caught shape (F8 fixed). Stop hook, real runs: committed-broken HEAD with a clean tree → 2 (F6 fixed). Counters A and B are independent; A is released after MAX, B is unaffected (F7 fixed). Green HEAD skip 0.04 s | PASS |
| 4 | Pinned raw inputs with sha256 checks | `pytest main/tests/test_common.py -k "sha256 or pinned"`: 6 passed | The README digest now ends in `…602d`, matching `sha256sum` (F9 fixed). Planting `data/raw/zz_unpinned.bin` → `test_every_raw_file_is_pinned` FAILED, `verify.sh main` 2 (F10 fixed) | PASS |
| 5 | Handoff docs exist and the DONE gate is sound | `test_docs_gate_*` (2 tests). A substring-check mutation fails `test_docs_gate_requires_final_verdict_line` | The template line, `FAIL (supersedes … PASS)`, PASS-then-FAIL, `` `DONE` ``, `Done`, `- DONE` and `DONE ✅` all → 2 (F5 fixed). Residual: a final `Verdict: FAIL — reason` line is not counted as a verdict (N9, low-medium) | PASS (low findings) |

## Real output

### Baseline at HEAD: `bash scripts/verify.sh all` → EXIT=0
```
━━━ [boundary:self-test] $ python3 scripts/check_boundaries.py --self-test
boundary self-test: OK (28 violations caught, 7 clean files passed)
━━━ [boundary:scan] $ python3 scripts/check_boundaries.py
boundary: OK (34 files scanned)
━━━ [docs:handoff] $ python3 scripts/check_docs.py
docs: OK (10 task folders)
...
✓ built in 140ms
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (0s)
  PASS  artifacts:schema (1s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (1s)
  PASS  renderer:tests (1s)
  PASS  renderer:build (1s)
verify.sh: all stages passed.
EXIT=0
```

### `python3 -m pytest -q -p no:cacheprovider scripts/tests`, `verify.sh boundary`, `verify.sh docs` (clean tree)
```
..........                                                               [100%]
10 passed in 0.64s
pytest EXIT=0

━━━ [boundary:scan] $ python3 scripts/check_boundaries.py
boundary: OK (34 files scanned)
━━━ [scripts:tests] $ python3 -m pytest -q -p no:cacheprovider scripts/tests
10 passed in 0.62s
━━━ verify.sh summary (scope: boundary)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  scripts:tests (1s)
verify.sh: all stages passed.
verify.sh boundary EXIT=0

━━━ [docs:handoff] $ python3 scripts/check_docs.py
docs: OK (10 task folders)
━━━ verify.sh summary (scope: docs)
  PASS  docs:handoff (0s)
verify.sh docs EXIT=0
```

### Previous probes re-run
Harness: write a file, then run `check_boundaries.py FILE`, the hook with `{"tool_name":"Edit","tool_input":{"file_path":…}}`, the hook with `{"tool_name":"Bash",…}`, and a full scan. Then revert.
```
c1     renderer/src/__probe/c1_rel.ts             check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
c2 … c13 (dq, dyn, require, export-from, multiline, side-effect, export*, bare labyrinth_main,
   absolute …/main/labyrinth_main/…, scripts/, import=require, contracts/*.ts)         all   2 2 2 2  CAUGHT
p1 … p5 (from renderer, sys.path '../renderer', import os, renderer.src, nested import, multi-line append)  all 2 2 2 2 CAUGHT
b1     renderer/src/__probe/b1_template.ts        check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
b2     renderer/src/__probe/b2_alias.ts           check=0 hook(Edit)=0 hook(Bash)=0 fullscan=0  MISSED   (bare '@backend/…' alone; the alias *definition* is the violation, caught below)
b3     renderer/src/__probe/b3_concat.ts          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
b4     renderer/src/__probe/b4_tripleslash.ts     check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
b5     renderer/src/__probe/b5_globimport.ts      check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
b6     renderer/src/__probe/b6_newurl.ts          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
b7     renderer/src/__probe/b7_comment.ts         check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
b8     renderer/src/__probe/b8_vue.vue            check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
q1     main/labyrinth_main/__probe/q1.py          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT   importlib.import_module("renderer.src")
q2     main/labyrinth_main/__probe/q2.py          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
q3     main/labyrinth_main/__probe/q3.py          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
q4     main/labyrinth_main/__probe/q4.py          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
q5     main/labyrinth_main/__probe/q5.py          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
q6     main/labyrinth_main/__probe/q6.py          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
q7     main/labyrinth_main/__probe/q7.py          check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
zz1    main/labyrinth_main/__probe/zz1.py         check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
zz2    main/labyrinth_main/__probe/zz2.py         check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT   os.path.join(dirname(__file__),"..","..","renderer")
zz3    main/labyrinth_main/__probe/zz3.py         check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT
al-vt  renderer/vite.config.ts                    check=2 hook(Edit)=2 hook(Bash)=2 fullscan=2  CAUGHT   vite resolve.alias -> ../main
```
The tsconfig `paths` alias `"@be/*": ["../main/labyrinth_main/*"]` plus `import x from '@be/common/io'`:
```
  - renderer/tsconfig.json:28: renderer references backend module/path '../main/labyrinth_main/*'
fullscan EXIT=2
hook(tsconfig) EXIT=2
```
The old end-to-end leak: a `resolve.alias '@backend' → ../main` in vite.config.ts, plus `leak.ts` with `@backend/pyproject.toml?raw` and a template-literal `import()`:
```
  - renderer/vite.config.ts:35: renderer path '../main' leaves renderer/ (resolves to main)
  - renderer/src/leak.ts:4: renderer references backend module/path '../../main/labyrinth_main/build_artifacts.py?raw'
boundary EXIT=2
hook(Edit vite.config.ts) EXIT=2
hook(Edit leak.ts) EXIT=2
hook(Bash) EXIT=2
verify.sh boundary EXIT=2
verify.sh all EXIT=2   (FAIL  boundary:scan; every other stage PASS)
```
(Running `vite build` on its own still bundles the text: Vite does not know about the gate. The gate is what fails.)

### Fresh bypass attempts (33)
```
n01  '../../../ma' + 'in/x'                                  CAUGHT   (the first half already leaves renderer/)
n02  '..' + '/../../main/x'                                  MISSED   obfuscation
n03  ['..','..','..','ma'+'in','x'].join('/')                MISSED   obfuscation
n04  vite.config: path.join(dirname, '..', 'main')           CAUGHT
n05  src: path.join(__dirname,'..','..','..','main')         CAUGHT   (bare 'main' is flagged)
n06  test: readFileSync(resolve(process.cwd(), '../main/pyproject.toml'))   MISSED   N3 (resolved relative to file, not cwd)
n07  test: readFileSync('../data/raw/wout_w7x_kjm.nc')        MISSED   N3
n08  import t from '/@fs<abs>/main/pyproject.toml?raw'        MISSED   N1, leaks to dist/
n09  import t from '<abs>/main/pyproject.toml?raw'            MISSED   N1, leaks to dist/
n10  import.meta.resolve('../../../main/x.js')               CAUGHT
n11  CSS @import url(../../../main/x.css)  (unquoted)        MISSED   N6
n12  CSS @import '../../../main/x.css'                       CAUGHT
n13  /* don't */ import x from '../../../main/x';            MISSED   N5 (an apostrophe shifts quote pairing)
n14  <p>Don't</p>; import('../../../main/x')  (same line)    MISSED   N5
n15  renderer/tsconfig.node.json with paths ../main/*        MISSED   N4 (file not scanned)
n16  <script type=module src=../../../main/x.js>  (unquoted) MISSED   N6
n17  '..\\..\\..\\main\\x' (backslashes)                     MISSED   out of scope (does not resolve on Linux)
n18  new Worker(new URL('../../../main/w.js', import.meta.url))      CAUGHT
n19  vite alias { '@backend': '/home/user/Labyrinth/main' }  MISSED   N1
n20  fetch('/@fs/home/user/Labyrinth/data/raw/…')            MISSED   N1
p01  getattr(importlib, 'import_module')('renderer.src')     MISSED   N7
p02  exec('import renderer')                                 MISSED   obfuscation
p03  runpy.run_module('renderer.app')                        MISSED   N7
p04  runpy.run_path('../renderer/x.py')                      CAUGHT
p05  Path('..') / ('rend' + 'erer')                          MISSED   obfuscation
p06  sys.path.insert(0, os.environ['RENDERER_DIR'])          MISSED   out of scope (runtime config)
p07  MODULE = 'renderer.app'; importlib.import_module(MODULE)  MISSED N7
p08  importlib.import_module('.src', package='renderer')     CAUGHT
p09  b'../renderer'.decode()                                 MISSED   obfuscation
p10  spec_from_file_location('r', '/repo/renderer/x.py')     CAUGHT
p11  f'{ROOT}/renderer/src'                                  CAUGHT
p12  pkgutil.resolve_name('renderer.src:app')                MISSED   N7
p13  '../front' + 'end'                                      MISSED   obfuscation
s1   symlink renderer/src/be -> ../../main + import './be/pyproject.toml?raw'   CAUGHT (resolve() follows the link)
s2   same symlink + import.meta.glob('./**/*.toml', {query:'?raw'})  MISSED  N2, leaks to dist/ (count 1)
s3   file symlink renderer/src/cfg.toml -> main/pyproject.toml + import         CAUGHT
s4   package.json "labyrinth-main": "file:../main" + 'labyrinth-main/…'          MISSED  N8
s5   main/pyproject.toml pythonpath = ["../renderer"]                             MISSED  N8 (only .py is scanned in main/)
fp1  renderer: document.querySelector('main')       -> fullscan=2  FALSE POSITIVE (N10)
fp2  main: logging.getLogger('renderer')             -> fullscan=2  FALSE POSITIVE (N10)
```
N1 end to end (`leaked` imported from `main.tsx`, then `npx vite build`):
```
spec=<worktree>/main/pyproject.toml?raw boundary EXIT=0
✓ built in 141ms
backend text in bundle: 1
spec=/@fs<worktree>/main/pyproject.toml?raw boundary EXIT=0
✓ built in 143ms
backend text in bundle: 1
```
Regression check: the 1cdc976 checker rejects the same files, and HEAD accepts them.
```
  - renderer/src/__p/abs.ts:1: absolute import '<worktree>/main/pyproject.toml?raw' is banned in renderer/
  - renderer/src/__p/abs2.ts:1: absolute import '/home/user/Labyrinth/main/pyproject.toml?raw' is banned in renderer/
old(1cdc976) EXIT=2
boundary: OK (2 files scanned)
new(HEAD) EXIT=0
```

### Stop hook, real runs (`LABYRINTH_VERIFY_CMD="bash scripts/verify.sh main"`, MAX=2, separate state dir, symlink removed so the tree is clean)
```
1 clean tree, no last_green -> verify runs, green       EXIT=0  1.83s  counter(A)=0 last_green=0884d0b
2 clean tree, HEAD==last_green -> skip                  EXIT=0  0.04s  counter(A)=0 last_green=0884d0b
committed broken HEAD=cf6e4c8 porcelain: []
3 committed-broken, clean tree, HEAD moved -> verify    EXIT=2  1.81s  counter(A)=1 last_green=0884d0b
4 session A again                                       EXIT=2  1.74s  counter(A)=2 last_green=0884d0b
5 session B (independent counter)                       EXIT=2  1.80s  counter(B)=1 last_green=0884d0b
6 session A third -> released (MAX=2)                   EXIT=0  1.72s  counter(A)=0 last_green=0884d0b
stop_verify: verify still failing after 2 attempts; releasing the stop. Record the blocker in status.md.
7 session B second                                      EXIT=2  1.79s  counter(B)=2 last_green=0884d0b
reset HEAD=0884d0b
8 fixed (back to green HEAD) session B                  EXIT=0  0.05s  counter(B)=0 last_green=0884d0b
```
(The probe commit lived only on the worktree's detached HEAD and was reset away.)

### Docs gate (F5); TASK.md/VERIFY.md mutated in the worktree, then restored
```
DONE + final verdict PASS line                                  -> EXIT=0
DONE + template 'Verdict: PASS | FAIL'                          -> EXIT=2
DONE + 'Verdict: FAIL (supersedes earlier Verdict: PASS)'       -> EXIT=2
DONE + PASS line then bare FAIL line                            -> EXIT=2
DONE + line-start PASS line, final 'Verdict: FAIL — reason'     -> EXIT=0   <- N9
DONE + PASS line only inside a ``` fence                        -> EXIT=0   <- N9
DONE + previous FAIL report                                     -> EXIT=2
Status `DONE` / Done / DONE ✅ (with FAIL VERIFY)                -> EXIT=2 each
Status '- DONE'                                                 -> EXIT=2 (found '?')
second '## Status' heading saying DONE (first says VERIFYING)   -> EXIT=0   <- N9 (low)
restored                                                        -> EXIT=0
```

### F9/F10/F11 and mutations
```
data/raw/README.md:10 … | `5c156224…602d` |      sha256sum: 5c156224…425602d   (F9 fixed)
FAILED main/tests/test_common.py::test_every_raw_file_is_pinned   verify main with unpinned file EXIT=2   (F10 fixed)
verify.sh: empty scope argument                          empty EXIT=2
verify.sh: expected at most one scope argument, got 2    extra-arg EXIT=2
verify.sh: unknown scope 'nope' (…)                      nope EXIT=2                      (F11 fixed)

mutant: STRING without template literals -> self-test EXIT=2
  self-test FAIL: missed violation in renderer/src/v08.ts …   v09.ts …
  FAILED test_boundary_self_test_catches_all_known_bypasses, test_boundary_each_violation_individually
mutant: shared stop counter      -> FAILED test_stop_hook_counters_are_per_session
mutant: substring verdict check  -> FAILED test_docs_gate_requires_final_verdict_line
```

## Findings
Previous F1–F11: all fixed. Each was re-probed above.

- **N1 (medium, blocking): absolute and `/@fs/` specifiers are not resolved.** In `scripts/check_boundaries.py:79`, only `./`, `../`, `.` and `..` are resolved. A spec starting with `/` is skipped unless it contains `labyrinth_main` (`:43`). `import t from '/home/user/Labyrinth/main/pyproject.toml?raw'`, the `/@fs/…` form, and a vite alias with an absolute `replacement` all pass with `boundary: OK`. Probes n08 and n09 put `main/` text into the `vite build` bundle. This is one plain line of code, not obfuscation, and it is a **regression**: the 1cdc976 checker banned absolute imports in renderer. Agents in this environment see absolute paths in every tool result, so this is a realistic accidental shape. Fix: strip a leading `/@fs`. For any spec starting with `/`, resolve it as an absolute filesystem path when that path (or its parent directory) exists, and otherwise as relative to `renderer/`. Apply the same inside/contracts/artifacts rule. Add n08, n09 and n19 to `VIOLATIONS`.
- **N2 (low): a symlink inside renderer/ to main/ is not flagged by itself.** Explicit imports through it are caught (s1, s3), because `resolve()` follows links. But `import.meta.glob('./**/*.toml')` through `renderer/src/be -> ../../main` leaked into `dist/` (s2). Creating that symlink is a deliberate act. Fix: in `iter_files` (`:152`), flag any symlink under `renderer/` or `main/` that resolves to the other side or to `data/`/`scripts/`.
- **N3 (low-medium): fs paths that are relative to cwd are resolved relative to the file.** `readFileSync('../data/raw/…')` or `resolve(process.cwd(), '../main/…')` in a renderer test resolves, for the checker, to `renderer/src/…` and passes (n06, n07). At runtime the cwd is `renderer/`, so the read reaches `data/raw` or `main`. This is test-time coupling, not bundle coupling. Possible fix: also flag `../<main|data|scripts>/` when resolved against `renderer/` itself.
- **N4 (low): only `tsconfig.json`, `jsconfig.json` and `package.json` are scanned among JSON files** (`:38`). The `tsconfig.app.json` and `tsconfig.node.json` from the Vite template, and any `tsconfig.*.json`, are skipped (n15). TS `paths` alone does not change Vite resolution unless `vite-tsconfig-paths` is added. Fix: scan `renderer/**/tsconfig*.json`.
- **N5 (low): the quote tokenizer is not comment- or JSX-aware.** An apostrophe outside a string on the same line (`/* don't */ import …`, `<p>Don't</p>; import(…)`) pairs with the specifier's opening quote, so the path is never seen (n13, n14). A lone backtick in a comment would swallow lines up to the next backtick in the same way. Prettier-formatted code rarely puts these on one line.
- **N6 (low): unquoted CSS `url(…)` and unquoted HTML attributes are not strings, so they are not seen** (n11, n16).
- **N7 (low): Python dotted module names are only checked as direct `import_module`/`__import__` arguments** (`:128`, `:44`). `runpy.run_module('renderer.app')`, `pkgutil.resolve_name`, a module name in a variable, or `getattr(importlib,'import_module')` pass. The impact is small: `renderer/` contains no Python, so these cannot load anything today. Fix: flag any string constant matching `^renderer(\.|:|$)`.
- **N8 (low): non-source config is out of scan.** A package.json dependency `"file:../main"` (the value does not start with `../`) plus a bare `labyrinth-main/…` passes (s4). `main/pyproject.toml` `pythonpath = ["../renderer"]` passes, because only `.py` files in main/ are scanned (`:142`).
- **N9 (low-medium): the DONE gate's verdict parsing.** In `scripts/check_docs.py:42`, only `^Verdict: (PASS|FAIL)\s*$` counts. A final `Verdict: FAIL — reason` (the format `.claude/agents/verifier.md` asks for: "FAIL with the exact reason") is ignored, so an earlier line-start PASS line, for example quoted output, decides the result. A PASS line inside a code fence also counts. Only the first `## Status` heading is read (`:36`). Fix: take the last line matching `^Verdict:` and require it to be exactly `Verdict: PASS`.
- **N10 (low, false positives): legitimate strings are flagged.** The bare string `'main'` in renderer (`document.querySelector('main')`, ARIA `role: 'main'`) and the string `'renderer'` in main (`logging.getLogger('renderer')`, argparse choices) both fail the gate (fp1, fp2). This will cause friction once real UI or server code lands.
- **N11 (low): a gate test writes into the real tree.** `scripts/tests/test_gates.py:38` creates `renderer/src/__gate_test_violation.ts` in the repo. With concurrent agents in the main tree, another agent's boundary scan or Bash-hook run that overlaps the test sees a transient violation. Use `tmp_path` with a copied hook ROOT instead.
- Out of scope (string-level obfuscation or runtime configuration, which no static lint can reasonably stop): n02, n03, n17, p02, p05, p06, p09, p13. These matter only against an adversarial author, not against accidental coupling.

Outcomes 2–5 hold, and every previous finding F1–F11 is fixed and covered by mutation-checked tests. Outcome 1 still fails for one realistic, non-obfuscated shape: a single absolute-path (or `/@fs/`) import line or vite alias puts `main/` source into the renderer production build while `check_boundaries.py`, both hook payloads and `verify.sh all` stay green (N1, a regression from 1cdc976). Fix N1, and preferably N9, then re-verify.

Verdict: FAIL
