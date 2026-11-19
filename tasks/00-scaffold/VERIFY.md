# Verify: 00-scaffold
Verifier run: 2026-11-19, commit 1cdc976 (HEAD, clean) verified in an isolated `git worktree` at
`/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/verify-00`, with
`renderer/node_modules` symlinked from the main tree. The main working tree was not used, because other
agents are editing it at the same time. Every mutation was reverted, and `git status --porcelain` was
`?? renderer/node_modules` (the symlink) before and after each probe. The worktree was removed afterwards.

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| 1 | `main/` and `renderer/` exist; imports between them are rejected | `check_boundaries.py --self-test`: 6 planted / 2 clean (6 violations caught, 2 clean files passed) | 18 planted violations in the real tree were all caught by the scanner and the hook, each exiting 2. **14 bypass shapes were tried and 13 got through.** One bypass was shown end to end: a `vite.config.ts` alias plus a template-literal `import()` put backend source into `renderer/dist` while `boundary: OK` | **FAIL**: holds for quoted static, dynamic, require and export-from imports and for Python `import` statements; does not hold for template-literal `import()`, path aliases, `importlib`/`__import__`, or a `sys.path` hack with a `)` before "renderer" |
| 2 | `verify.sh` runs boundary → docs → lint → tests → artifact schema/freshness → typecheck → tests → build; exits 2 on any failure or bad invocation | `bash scripts/verify.sh nope` → 2 | Clean `all` → 0. Each of these exits 2: bad scope, failing pytest, ruff F401, stale manifest, schema-invalid manifest, extra uncommitted artifact, TS type error, failing vitest, tampered raw file | PASS (low: `verify.sh ''` is accepted as `all`) |
| 3 | PostToolUse boundary hook and Stop verify loop both exit 2 on failure | none automated (TASK says "see VERIFY.md") | Post-edit hook, fed hook JSON: exits 2 on all 18 planted violations. `stop_verify.sh`: clean tree → 0 (skips verify, 0.011 s); dirty tree with green verify → 0; failing pytest → 2, 2, then 0 (released) with `LABYRINTH_MAX_STOP_BLOCKS=2`; after the fix → 0 and the counter resets | PASS (findings F6–F8) |
| 4 | Pinned raw inputs with sha256 checks | `pytest main/tests/test_common.py -k sha256` (5 passed) | `sha256sum data/raw/*` matches all 5 pins. Appending 1 byte to `stella_test2_vmec_geometry.in` makes the test fail and `verify.sh main` exit 2 | PASS (low: README digest typo, F9; no check for unpinned new files, F10) |
| 5 | Handoff docs exist: status, architecture, decision, CLAUDE, tasks/*/TASK.md | `python3 scripts/check_docs.py` → OK (10 task folders) | Each of these exits 2: missing decision.md, empty status.md, missing `## Tests`, `DONE` with no VERIFY.md, `DONE` with VERIFY "Verdict: FAIL" | PASS (medium: F5, the DONE gate can be fooled) |

## Real output

### Baseline: `bash scripts/verify.sh all` in the worktree → EXIT=0
```
━━━ [boundary:self-test] $ python3 scripts/check_boundaries.py --self-test
boundary self-test: OK (6 violations caught, 2 clean files passed)
━━━ [boundary:scan] $ python3 scripts/check_boundaries.py
boundary: OK (35 files scanned)
━━━ [docs:handoff] $ python3 scripts/check_docs.py
docs: OK (10 task folders)
━━━ [main:lint] $ python3 -m ruff check main scripts
All checks passed!
━━━ [main:tests] $ python3 -m pytest -q main/tests
9 passed in 0.07s
━━━ [artifacts:schema] $ python3 scripts/validate_artifacts.py
artifacts: schema-valid
━━━ [artifacts:fresh] $ python3 scripts/validate_artifacts.py --check-fresh
artifacts: fresh (byte-identical rebuild)
...
 Test Files  2 passed (2)
      Tests  2 passed (2)
...
✓ built in 140ms
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  main:lint (0s)
  PASS  main:tests (0s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (1s)
  PASS  renderer:typecheck (1s)
  PASS  renderer:tests (1s)
  PASS  renderer:build (1s)
verify.sh: all stages passed.
EXIT=0
```

### Boundary: planted violations that must be caught (scanner per file, then the hook fed `{"tool_input":{"file_path":"<abs>"}}`)
The files were in `renderer/src/__probe/` and `main/labyrinth_main/__probe/`:
c1 `import x from '../../../main/…'`; c2 the same with double quotes; c3 `await import('../../../main/…')`;
c4 `require("../../../main/x")`; c5 `export { z } from '…main…'`; c6 a multi-line `import {\n a,\n b,\n} from '…main…'`;
c7 side-effect `import '…main…'`; c8 `export * from "…main…"`; c9 `import y from 'labyrinth_main/common'`;
c10 an absolute `/home/user/Labyrinth/main/…`; c11 `../../../scripts/check_docs`; c12 `import fs = require('…main…')`;
c13 `../../../contracts/foo.ts` (not JSON); p1 `from renderer.src import app`; p2 `sys.path.insert(0, '../renderer')`;
p3 `import os, renderer.src as r`; p4 `import renderer` inside a function; p5 a multi-line `sys.path.append(\n "../../renderer/src"\n)`.
```
c10_abs.ts             check=2 hook=2
c11_scripts.ts         check=2 hook=2
c12_tsimporteq.ts      check=2 hook=2
c13_contracts_ts.ts    check=2 hook=2
c1_rel.ts              check=2 hook=2
c2_dq.ts               check=2 hook=2
c3_dyn.ts              check=2 hook=2
c4_req.js              check=2 hook=2
c5_exportfrom.ts       check=2 hook=2
c6_multiline.ts        check=2 hook=2
c7_sideeffect.ts       check=2 hook=2
c8_exportstar.ts       check=2 hook=2
c9_bare.ts             check=2 hook=2
p1.py                  check=2 hook=2
p2.py                  check=2 hook=2
p3.py                  check=2 hook=2
p4.py                  check=2 hook=2
p5.py                  check=2 hook=2
```
Full scan with the probes present: `python3 scripts/check_boundaries.py` → `BOUNDARY VIOLATION … (18 lines)` `full scan EXIT=2`.
The hook prints the violation on stderr:
```
BOUNDARY VIOLATION: main/ and renderer/ must never import each other.
Exchange data through artifacts/ (JSON validated by contracts/) or the HTTP API instead.
  - renderer/src/__probe/c2_dq.ts:1: renderer imports '../../../main/labyrinth_main/common/io' which leaves renderer/ (resolves to main/labyrinth_main/common/io)
hook EXIT=2
```
`renderer/vite.config.ts` with `import x from '../main/labyrinth_main/foo.json'` appended → `vite.config direct EXIT=2` (caught).

### Boundary: bypass attempts (check=0 means the violation was NOT detected)
```
b1_template.ts         check=0 hook=0    const m = await import(`../../../main/labyrinth_main/x`);
b2_alias.ts            check=0 hook=0    import x from '@backend/common/io';
b3_concat.ts           check=0 hook=0    const p = '../../../ma' + 'in/x'; await import(p);
b4_tripleslash.ts      check=0 hook=0    /// <reference path="../../../main/labyrinth_main/types.d.ts" />
b5_globimport.ts       check=0 hook=0    import.meta.glob('../../../main/**/*.py', { as: 'raw' })
b6_newurl.ts           check=0 hook=0    new URL('../../../main/labyrinth_main/x.py', import.meta.url)
b7_comment.ts          check=2 hook=2    import /* c */ x from '../../../main/x';   (caught)
b8_vue.vue             check=0 hook=0    <script setup>import x from '../../../main/x'</script>
q1.py                  check=0 hook=0    importlib.import_module("renderer.src")
q2.py                  check=0 hook=0    sys.path.insert(0, str(Path(__file__).parents[3] / "renderer"))
q3.py                  check=0 hook=0    sys.path += ["../renderer"]
q4.py                  check=0 hook=0    __import__("renderer")
q5.py                  check=0 hook=0    site.addsitedir("../renderer")
q6.py                  check=0 hook=0    RENDERER = "../renderer"; sys.path.insert(0, RENDERER)
q7.py                  check=0 hook=0    from \<newline> renderer import app
```
Shapes of the `sys.path` hack:
```
zz1 check=2 :: sys.path.insert(0, str(ROOT / "renderer"))
zz2 check=0 :: sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "renderer"))
zz3 check=0 :: sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "renderer"))
```
Path alias in tsconfig: with `"paths": {"@be/*": ["../main/labyrinth_main/*"]}` and `import x from '@be/common/io'`, the result was
`boundary: OK (36 files scanned)` `EXIT=0`. A hook run on the edited `renderer/tsconfig.json` gave `hook(tsconfig) EXIT=0`
(the hook does not check JSON config). The alias was only caught when the specifier itself contained `labyrinth_main`.

End-to-end leak. I added `resolve: { alias: { '@backend': resolve(import.meta.dirname, '../main') } }` to
`renderer/vite.config.ts` and created `renderer/src/leak.ts` with
`import viaAlias from '@backend/pyproject.toml?raw'` and ``import(`../../main/labyrinth_main/build_artifacts.py?raw`)``,
then imported it from `main.tsx`. Result:
```
boundary: OK (36 files scanned)
boundary EXIT=0
hook(vite.config.ts) EXIT=0
dist/assets/build_artifacts-CHcqJRNj.js    2.20 kB │ gzip:  1.04 kB
dist/assets/index--ZlVQTfi.js            221.77 kB │ gzip: 69.58 kB
✓ built in 156ms
$ grep -l 'Labyrinth backend' renderer/dist/assets/*.js
renderer/dist/assets/index--ZlVQTfi.js            <- main/pyproject.toml text inside the renderer bundle
```
(Under vitest, Vite's dev-server `fs.allow` refused the same import with `Error: Denied ID …/main/pyproject.toml?raw`.
That block comes from Vite, not from the project gate, and `vite build` does not apply it.)

### verify.sh exit codes
```
$ bash scripts/verify.sh nope; echo $?
verify.sh: unknown scope 'nope' (expected all|main|renderer|boundary|artifacts|docs)
EXIT=2

$ bash scripts/verify.sh ''     -> runs every stage (scope: all) ... empty-scope EXIT=0

# planted main/tests/test_zz_probe.py: assert 1 == 2
$ bash scripts/verify.sh main
FAILED main/tests/test_zz_probe.py::test_probe_fails - assert 1 == 2
1 failed, 9 passed in 0.08s
  FAIL  main:tests (1s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
failing-pytest EXIT=2

# artifacts/manifest.json rewritten with generator.version "0.0.9" (still schema-valid)
$ bash scripts/verify.sh artifacts
artifacts: schema-valid
ARTIFACT ERROR: artifacts/manifest.json: stale or non-deterministic — regenerate with `cd main && python3 -m labyrinth_main.build_artifacts`
  PASS  artifacts:schema (0s)
  FAIL  artifacts:fresh (0s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
stale-manifest EXIT=2

# manifest schemaVersion "one"
ARTIFACT ERROR: manifest.json: $.schemaVersion: 1 was expected
  FAIL  artifacts:schema (0s)
  FAIL  artifacts:fresh (1s)
schema-invalid EXIT=2

# extra artifacts/extra.json
ARTIFACT ERROR: artifacts/extra.json: committed but no longer generated
uncommitted-extra EXIT=2

clean artifacts EXIT=0

# main/labyrinth_main/zz_lint_probe.py = "import os"
F401 [*] `os` imported but unused
  FAIL  main:lint (0s)
lint EXIT=2
# renderer/src/zz_type_probe.ts = export const n: number = 'str';
src/zz_type_probe.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
  FAIL  renderer:typecheck (1s)
typecheck EXIT=2
# renderer/src/zz.test.ts = expect(1).toBe(2)
 FAIL  src/zz.test.ts > x
  FAIL  renderer:tests (1s)
vitest EXIT=2
```

### stop_verify.sh
```
porcelain: []
clean-tree(skip) EXIT=0        real 0m0.011s   (verify not run)
porcelain: [?? renderer/node_modules]
dirty-but-green EXIT=0         counter=0
# planted failing pytest, LABYRINTH_MAX_STOP_BLOCKS=2
failing attempt 1 EXIT=2 counter=1
failing attempt 2 EXIT=2 counter=2
failing attempt 3 EXIT=0 counter=0
  stderr(1): scripts/verify.sh FAILED (exit 2) — attempt 1/2. Fix these before stopping:
             FAILED main/tests/test_zz_probe.py::test_probe_fails - assert 1 == 2
               FAIL  main:tests (0s)
  stderr(3): stop_verify: verify.sh still failing after 2 attempts; releasing the stop. Record the blocker in status.md.
after-fix EXIT=0 counter=0
```

### Raw data sha256
```
$ python3 -m pytest main/tests/test_common.py -k sha256 -v
... 5 PASSED ...
======================= 5 passed, 4 deselected in 0.02s ========================
$ sha256sum data/raw/* | grep -v README
8560015e04a44819d1fdf596b7597f1d7f32254f494c3daa04e0f701bc6f9d4a  data/raw/stella_benchmark_DOI_10_1017_S0022377822000393.h5
5c156224ded135408879aa7ddec09a66ec99a354b469f9e5ad3967188425602d  data/raw/stella_test2_vmec_geometry.geometry
ea741f75e855d26238496e0c2594421526dc6e93e467ed009724124745cd011d  data/raw/stella_test2_vmec_geometry.in
efccb0d34a3d5ba9489e5d0cce9f1c1136909730e52a38e4689e9064bf2dd491  data/raw/stella_test2_vmec_geometry.vmec.geo
a811669f3eb50e2a7aa006afc591dc7d5b58d6b66b72ba2a5e5933088810fbf6  data/raw/wout_w7x_kjm.nc
# mutation: printf 'x' >> data/raw/stella_test2_vmec_geometry.in
FAILED main/tests/test_common.py::test_raw_inputs_match_pinned_sha256[stella_test2_vmec_geometry.in-ea741f…]
1 failed, 4 passed, 4 deselected in 0.02s
verify main EXIT=2
```

### check_docs.py
```
docs: OK (10 task folders)                         clean EXIT=0
DOCS ERROR: decision.md missing or empty           no decision.md EXIT=2
DOCS ERROR: status.md missing or empty             empty status.md EXIT=2
DOCS ERROR: tasks/00-scaffold/TASK.md: missing section '## Tests'                   EXIT=2
DOCS ERROR: … Status DONE but tasks/00-scaffold/VERIFY.md lacks 'Verdict:<sp>PASS' …   DONE without VERIFY EXIT=2
DOCS ERROR: … (VERIFY.md = "Verdict: FAIL")                                          EXIT=2
docs: OK   DONE + VERIFY.md "Verdict:<sp>PASS | FAIL" (the verifier.md template line)   EXIT=0   <- should be 2
docs: OK   DONE + VERIFY.md "Verdict: FAIL (supersedes earlier Verdict:<sp>PASS)"       EXIT=0   <- should be 2
docs: OK   Status "`DONE`" (backticks), no VERIFY.md                                  EXIT=0   <- should be 2
```

## Findings
- **F1 (medium): the boundary checker does not see template-literal dynamic imports.** In `scripts/check_boundaries.py:32-34`, `JS_SPEC` only matches `'` and `"` quotes, so ``import(`../../main/…`)`` passes. Vite resolves it, and the e2e probe above put backend source into the production bundle.
- **F2 (medium): path aliases bypass the boundary.** A `resolve.alias` in `renderer/vite.config.ts` or `compilerOptions.paths` in `renderer/tsconfig.json` that points into `../main` is not checked. A specifier like `@backend/…` is caught only if it contains `main/`, starts with `main`/`@main`, or contains `labyrinth_main` (`check_boundaries.py:67`). The hook skips `tsconfig.json`, and the scanner does not look inside call expressions such as `resolve(import.meta.dirname, '../main')`.
- **F3 (medium): common `sys.path` hacks are missed.** In `check_boundaries.py:36`, `PY_PATH_HACK` stops at the first `)`, so `sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "renderer"))` and `…str(Path(__file__).parents[2] / "renderer")` both pass. The first is the usual idiom. `sys.path += […]`, `site.addsitedir(…)` and passing the path through a variable are also missed.
- **F4 (low): other Python and JS forms are missed.** These pass: `importlib.import_module("renderer…")`, `__import__("renderer")` and a backslash-continued `from \ renderer import` (`check_boundaries.py:35`); `import.meta.glob`, `/// <reference path>` and `new URL(…, import.meta.url)`; and any non-JS file in renderer such as `.vue`, `.svelte` or `index.html` (`check_boundaries.py:28,87-92`). String concatenation in `import(p)` cannot be caught by any static check.
- **F5 (medium): the DONE gate in `check_docs.py` can be fooled.** (In this file, `<sp>` stands for a single space. The literal string is spelled out nowhere here, so that this FAIL report cannot satisfy the gate it describes.) At `scripts/check_docs.py:39` it accepts any VERIFY.md that contains the substring `Verdict:<sp>PASS`, including the template line `Verdict:<sp>PASS | FAIL` from `.claude/agents/verifier.md` and `Verdict: FAIL (supersedes … Verdict:<sp>PASS)`. At `:35`, a status written as `` `DONE` `` (backticks) or `Done` is not recognised, so the VERIFY requirement is skipped. Suggested fix: match `^Verdict:<sp>PASS\s*$` on the last verdict line.
- **F6 (low): committing broken code skips the Stop verify loop.** `scripts/hooks/stop_verify.sh:20` skips verification when `git status --porcelain` is empty. An agent that commits a failing change and then stops is never verified.
- **F7 (low): concurrent agents share one Stop counter.** `stop_verify.sh:14` keeps a single counter at `.claude/state/stop_blocks`. One agent's green run resets another agent's count, and failures from several agents add up toward the release threshold.
- **F8 (low): edits made through Bash skip the PostToolUse hook.** The matcher at `.claude/settings.json:5` is `Edit|Write|MultiEdit`, so `cat > file` or `sed -i` via Bash is not checked at edit time. The Stop hook's `boundary:scan` still catches it later. There is no automated regression test for either hook or for verify.sh's exit codes; only the checker's own self-test exists.
- **F9 (low): wrong digest in the data README.** `data/raw/README.md:10` shows the `.geometry` digest as `5c156224…a4d`. The real and pinned value ends in `…425602d`. The test uses the correct full value.
- **F10 (low): new raw files are never checked.** `main/tests/test_common.py:10-16` checks a fixed dictionary. A new unpinned file in `data/raw/` is never hashed. Suggested fix: assert that the set of files equals `PINNED.keys() | {"README.md"}`.
- **F11 (low): an empty scope runs everything.** `scripts/verify.sh:17` uses `${1:-all}`, so `verify.sh ''` runs every stage and exits 0 instead of rejecting the empty scope. Extra arguments are silently ignored.

Verdict: FAIL — outcomes 2–5 hold and the full gate is green at HEAD (`verify.sh all` exit 0). Outcome 1, "imports between them are rejected", does not fully hold: a template-literal `import()` plus a path alias put `main/` source into the renderer production build while `check_boundaries.py` and the post-edit hook both exited 0 (F1, F2). The idiomatic `os.path.join(os.path.dirname(__file__), …, "renderer")` sys.path hack also passes (F3). These are the same kinds of case the self-test claims to cover ("dynamic import", "sys.path hack"). F5 is also a gate weakness that matters for later tasks.
