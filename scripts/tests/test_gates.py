"""Tests for the gates themselves.

Requirements under test: (1) imports between main/ and renderer/ are banned; (2) every gate failure and
every bad invocation exits exactly 2; (3) the Stop-hook loop; (4) a task is DONE only with an external
verifier's genuine, current PASS. Nothing here writes into the shared working tree: every unsafe case
runs in tmp_path, against copies or through the LABYRINTH_* test overrides.
"""
import ast
import importlib.util
import io
import json
import ntpath
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import check_boundaries
import check_docs
import pytest
import validate_artifacts

ROOT = Path(__file__).resolve().parents[2]
SYS_PATH = "/usr/bin:/bin:/usr/local/bin"
# The hook tests that run the real stop_verify.sh in this repo are about the counter and the exit codes, not
# about the repo's own git state: with GIT_DIR pointing nowhere git fails at once, so the last-green shortcut
# is off (the SC-1 rule) and the result does not depend on what other agents are doing to the tree. The
# shortcut itself is tested in throwaway repositories (StopRepo).
NO_GIT = "/nonexistent/labyrinth-gate-tests.git"


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=kw.pop("cwd", ROOT), capture_output=True, text=True, check=False, **kw)


def git(repo, *args):
    cmd = ["git", "-C", str(repo), "-c", "user.name=gate-test", "-c", "user.email=gate-test@example.invalid", "-c", "commit.gpgsign=false",
           "-c", "init.defaultBranch=main", "-c", "protocol.file.allow=always", *args]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()


# ============================== (1) boundary: check_boundaries.py ==============================

# The bypasses of review findings SC-2 / SC-3 / SC-4 / SC-11, by the corpus file that reproduces each one.
REVIEW_BYPASSES = {
    "SC-2 wildcard glob from vite's root": "renderer/src/sc2a.ts",
    "SC-2 wildcard above renderer/": "renderer/src/sc2b.ts",
    "SC-2 brace alternatives": "renderer/src/sc2c.ts",
    "SC-2 interpolated directory": "renderer/src/sc2d.ts",
    "SC-2 '/'-rooted path that climbs out": "renderer/src/sc2g.ts",
    "SC-2 repository root opened to the dev server": "renderer/vitest.config.ts",
    "SC-3 package.json script cd ../main": "renderer/package.json",
    "SC-3 package.json script -m labyrinth_main": "renderer/tools/pkg/package.json",
    "SC-3 execSync cd ../main": "renderer/src/sc3a.test.ts",
    "SC-3 subprocess npm --prefix ../renderer": "main/labyrinth_main/sc3f.py",
    "SC-3 os.system cd ../renderer": "main/labyrinth_main/sc3g.py",
    "SC-3 npm --prefix renderer (word boundary)": "main/labyrinth_main/sc3i.py",
    "SC-4 renderer/src/features/coverage/": "renderer/src/features/coverage/leak.ts",
    "SC-4 a dist/ directory deep in the source": "renderer/src/features/x/dist/leak.ts",
    "SC-4 main/labyrinth_main/dist/": "main/labyrinth_main/dist/p.py",
    "SC-4 renderer/src/test/setup.ts": "renderer/src/test/setup.ts",
    "SC-4 renderer/tools/gen.mjs": "renderer/tools/gen.mjs",
    "SC-4 .py under renderer/": "renderer/tools/gen.py",
    "SC-4 .sh under renderer/": "renderer/scripts/build.sh",
    "SC-4 .sh under main/": "main/tools/build.sh",
    "SC-4 .js under main/": "main/labyrinth_main/static.js",
    "SC-11 /@fs/ URL": "renderer/src/sc11a.ts",
    "SC-11 file:// URL": "renderer/src/sc11b.ts",
    "SC-11 UNC //wsl.localhost": "renderer/src/sc11c.ts",
    "SC-11 UNC with backslashes": "renderer/src/sc11d.ts",
    "SC-11 drive letter": "renderer/src/sc11e.ts",
    "SC-11 absolute path into the checkout": "renderer/src/sc11g.test.ts",
}


def test_boundary_self_test_catches_all_known_bypasses():
    assert check_boundaries.self_test() == 0
    assert len(check_boundaries.VIOLATIONS) >= 90 and len(check_boundaries.CLEAN) >= 20


def test_boundary_corpus_holds_every_review_bypass():
    for name, rel in REVIEW_BYPASSES.items():
        assert rel in check_boundaries.VIOLATIONS, name
        body = check_boundaries.VIOLATIONS[rel].replace("{ROOT}", "/mnt/d/Labyrinth")
        assert check_boundaries.scan_text(rel, body, "/mnt/d/Labyrinth"), name


def _write_corpus(root, corpus):
    for rel, body in corpus.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body.replace("{ROOT}", str(root)))


def test_boundary_each_violation_individually(tmp_path):
    root = tmp_path.resolve()
    _write_corpus(root, check_boundaries.VIOLATIONS)
    for rel in check_boundaries.VIOLATIONS:
        assert check_boundaries.run([root / rel], root) == 2, rel
    assert check_boundaries.run(None, root) == 2


def test_boundary_each_clean_shape_individually(tmp_path):
    root = tmp_path.resolve()
    _write_corpus(root, {**check_boundaries.CLEAN, **check_boundaries.SKIPPED})
    for rel in check_boundaries.CLEAN:
        assert check_boundaries.check_file(root / rel, root) == [], rel
    assert check_boundaries.run(None, root) == 0


def test_boundary_allow_list_admits_only_renderer_contracts_json_and_artifacts_json():
    scan = lambda rel, body: bool(check_boundaries.scan_text(rel, body, "/repo"))  # noqa: E731
    src = "renderer/src/a.ts"
    assert not scan(src, "import s from '../../contracts/common.schema.json';\n")
    assert not scan(src, "import a from '../../artifacts/geometry.json';\n")
    assert not scan(src, "const all = import.meta.glob('../../artifacts/*.json');\n")
    assert not scan(src, "import x from './lib/x';\nimport y from '../vite.config';\n")
    for outside in ("../../README.md", "../../contracts/x.ts", "../../contracts/sub/x.json", "../../artifacts/helper.ts",
                    "../../artifacts/sub/x.json", "../../scripts/verify.sh", "../../data/raw/x.h5", "../../main/x.py",
                    "../../tasks/00-scaffold/TASK.md", "../..", "../../", "../../../elsewhere/x.ts", "../../*", "../../**/*.json"):
        assert scan(src, f"import x from '{outside}';\n"), outside
    # The same token is judged by where it is used: a module specifier is file-relative, a bare path
    # string must also be valid from renderer/ (the cwd of npm scripts and vitest).
    deep = "renderer/src/features/x/y.test.ts"
    assert not scan(deep, "import f from '../fixtures/a';\n")
    assert not scan(deep, "const f = readFileSync(resolve(__dirname, '../fixtures/a.json'), 'utf8');\n")
    assert not scan(deep, "const f = new URL('../fixtures/a.json', import.meta.url);\n")
    assert scan(deep, "const f = readFileSync('../fixtures/a.json', 'utf8');\n")  # cwd-relative: <repo>/fixtures
    assert scan(deep, "const f = readFileSync('../main/pyproject.toml', 'utf8');\n")
    # '/x' is vite-root-relative in a specifier; in a test a plain '/../x' string is a request path under test.
    assert scan(deep, "const m = await import('/../main/x.py?raw');\n")
    assert scan("renderer/src/a.ts", "const p = '/../package.json';\n")
    assert not scan(deep, "expect(resolveArtifactRequest(root, '/../outside.json')).toBeNull();\n")
    assert not scan(deep, "for (const url of ['/../package.json', '/../../../etc/passwd', '/..%2f..%2fCLAUDE.md']) {}\n")
    assert scan(deep, "const leak = await request(plugin, '/../main/pyproject.toml');\n")  # ... but never one that names a backend tree
    assert scan(deep, "const leak = await request(plugin, '/../data/raw/x.h5');\n") and scan(deep, "const p = '/../*/x.toml';\n")
    assert scan("renderer/vite.config.ts", "export default { resolve: { alias: { '@b': '/../package.json' } } };\n")
    # Naming the backend package is data ('labyrinth_main 0.1.0') until it is a module or a command.
    assert not scan(src, "const rev = 'labyrinth_main 0.1.0';\n")
    assert scan(src, "const cmd = 'python3 -m labyrinth_main.server';\n")


def test_boundary_main_side_rules():
    scan = lambda body, rel="main/labyrinth_main/x.py": bool(check_boundaries.scan_text(rel, body, "/repo"))  # noqa: E731
    assert not scan('msg = "the renderer plays replay"\nname = "renderer.py"\nlog = "docs/renderer-notes.md"\n')
    assert not scan('"""Must never import from renderer/."""\n')
    assert scan('import subprocess\nsubprocess.run("npm --prefix ../renderer run build", shell=True)\n')
    assert scan('p = "../renderer"\n') and scan('p = b"../renderer/src"\n') and scan('p = f"{root}/renderer/dist"\n')
    assert scan('import runpy\nrunpy.run_module("renderer.tools.gen")\n')
    assert scan("def broken(:\n")  # unparsable Python cannot be verified
    assert scan("frontend: ../renderer/dist\n", "main/config.yaml") and scan("cd renderer && npm ci\n", "main/tools/x.sh")
    assert not scan("numpy==2.5.3\n# pip install -r main/requirements.txt\n", "main/requirements.txt")


def test_boundary_verdicts_do_not_depend_on_the_os(monkeypatch):
    # SC-11: the PostToolUse hook runs under native Windows Python, the gate under WSL. Same corpus, the
    # checkout spelled the way each OS spells it, and once more with the host forced to look like Windows.
    wsl = check_boundaries.corpus_verdicts("/mnt/d/Labyrinth")
    windows = check_boundaries.corpus_verdicts("D:\\Labyrinth")
    with monkeypatch.context() as m:
        m.setattr(check_boundaries.os, "name", "nt")
        m.setattr(check_boundaries.os, "sep", "\\")
        m.setattr(check_boundaries.os, "path", ntpath)
        forced_windows = check_boundaries.corpus_verdicts("D:\\Labyrinth")
        forced_wsl = check_boundaries.corpus_verdicts("/mnt/d/Labyrinth")
    assert wsl == windows == forced_windows == forced_wsl
    assert len(wsl) > len(check_boundaries.VIOLATIONS) + len(check_boundaries.CLEAN)  # {ROOT} entries expand per spelling
    for key, flagged in wsl.items():
        assert flagged == key.startswith("V "), key
    # One checkout, every spelling: all map to the same repo-relative path.
    for root in ("/mnt/d/Labyrinth", "D:\\Labyrinth", "d:/labyrinth"):
        for spelled in ("D:\\Labyrinth\\renderer\\src\\a.ts", "/mnt/d/Labyrinth/renderer/src/a.ts", "D:/Labyrinth/renderer/src/a.ts",
                        "//wsl.localhost/Ubuntu/mnt/d/Labyrinth/renderer/src/a.ts", "/cygdrive/d/Labyrinth/renderer/./src/a.ts"):
            assert check_boundaries.rel_of(spelled, root) == "renderer/src/a.ts", (root, spelled)
        assert check_boundaries.rel_of("/mnt/c/Labyrinth/renderer/a.ts", root) is None
    # A Linux-only checkout (CI) has one spelling and still flags absolute paths into itself.
    ci = "/home/runner/work/Labyrinth/Labyrinth"
    assert check_boundaries.scan_text("renderer/src/a.ts", f"import t from '{ci}/main/pyproject.toml?raw';\n", ci)
    assert not check_boundaries.scan_text("renderer/src/a.ts", "const u = '/usr/share/dict/words';\n", ci)


def test_boundary_walker_skips_only_top_level_build_dirs(tmp_path):
    root = tmp_path.resolve()
    leak_ts, leak_py = "import x from '@main/x';\n", "import renderer\n"
    skipped = ["renderer/node_modules/pkg/leak.js", "renderer/dist/assets/leak.js", "main/.venv/lib/leak.py", "main/__pycache__/leak.py"]
    scanned = ["renderer/src/dist/leak.ts", "renderer/src/node_modules/leak.ts", "renderer/src/features/coverage/leak.ts",
               "renderer/coverage/x/leak.ts", "renderer/.cache/x/leak.ts", "main/labyrinth_main/dist/leak.py", "main/labyrinth_main/.venv/leak.py",
               "main/labyrinth_main/__pycache__/leak.py", "main/build/lib/leak.py"]
    for rel in skipped + scanned:
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(leak_py if rel.endswith(".py") else leak_ts)
    walked = {check_boundaries.rel_of(str(p), str(root)) for p in check_boundaries.iter_files(root)}
    assert walked == set(scanned)
    for rel in scanned:
        assert check_boundaries.check_file(root / rel, root), rel
    for rel in skipped:
        assert check_boundaries.check_file(root / rel, root) is None, rel


def test_boundary_unreadable_source_is_reported_and_binary_assets_are_skipped(tmp_path):
    root = tmp_path.resolve()
    (root / "renderer/src").mkdir(parents=True)
    (root / "renderer/src/ok.ts").write_text("export const a = 1;\n")
    (root / "renderer/src/logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR ../../main/x")
    (root / "renderer/src/font.bin").write_bytes(b"\0\1\2\3 ../../main/x")
    assert check_boundaries.run(None, root) == 0
    (root / "renderer/src/utf16.ts").write_bytes("import x from '../../main/x';\n".encode("utf-16"))
    assert check_boundaries.run([root / "renderer/src/utf16.ts"], root) == 2
    (root / "renderer/src/utf16.ts").unlink()
    (root / "renderer/src/nul.ts").write_bytes(b"export const a = 1;\0\n")
    assert check_boundaries.run([root / "renderer/src/nul.ts"], root) == 2
    (root / "renderer/src/nul.ts").unlink()
    (root / "renderer/src/latin1.ts").write_bytes(b"// caf\xe9\nimport x from '../../main/x';\n")
    assert check_boundaries.run([root / "renderer/src/latin1.ts"], root) == 2


def test_boundary_symlink_out_of_the_tree_is_a_violation(tmp_path):
    root = tmp_path.resolve()
    for sub in ("renderer/src", "main/labyrinth_main", "artifacts"):
        (root / sub).mkdir(parents=True)
    (root / "renderer/src/a.ts").write_text("export const a = 1;\n")
    try:
        (root / "renderer/src/backend").symlink_to("../../main", target_is_directory=True)
    except OSError:
        pytest.skip("symlinks are not available here")
    assert check_boundaries.run(None, root) == 2
    (root / "renderer/src/backend").unlink()
    (root / "renderer/src/data").symlink_to("../../artifacts", target_is_directory=True)
    (root / "renderer/src/b.ts").symlink_to("a.ts")
    assert check_boundaries.run(None, root) == 0
    (root / "main/labyrinth_main/ui").symlink_to("../../renderer/src", target_is_directory=True)
    assert check_boundaries.run(None, root) == 2


def test_boundary_scan_has_no_pathological_input():
    huge = ("x" * 200_000 + "\n") * 5 + "const s = '" + "a/" * 100_000 + "';\n" + "(" * 20_000 + "'../x'" + "/" * 50_000 + "\n"
    start = time.perf_counter()
    check_boundaries.scan_text("renderer/src/big.ts", huge, "/repo")
    check_boundaries.scan_text("renderer/src/big.json", huge, "/repo")
    check_boundaries.scan_text("main/big.txt", huge, "/repo")
    assert time.perf_counter() - start < 10


def test_boundary_bad_invocations_exit_2(tmp_path):
    for args in (["--nope"], ["--self-test", "extra"], ["-h"], [str(tmp_path / "missing.ts")]):
        assert run([sys.executable, "scripts/check_boundaries.py", *args]).returncode == 2, args


def test_boundary_zero_file_scan_is_an_error(tmp_path):
    assert check_boundaries.run([], tmp_path) == 2
    assert check_boundaries.run(None, tmp_path) == 2
    env = {"PATH": SYS_PATH, "LABYRINTH_ROOT": str(tmp_path)}
    assert run([sys.executable, "scripts/check_boundaries.py"], env=env).returncode == 2


# ============================== hooks: PostToolUse ==============================

def _hook_tree(tmp_path):
    root = tmp_path.resolve() / "tree"
    for sub in ("renderer/src", "main/labyrinth_main"):
        (root / sub).mkdir(parents=True)
    bad = root / "renderer/src/bad.ts"
    bad.write_text("import x from '../../main/labyrinth_main/foo';\n")
    good = root / "renderer/src/good.ts"
    good.write_text("import React from 'react';\n")
    return root, bad, good


def _post_edit(root, payload):
    env = {"PATH": SYS_PATH, "LABYRINTH_ROOT": str(root)}
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return run([sys.executable, str(ROOT / "scripts/hooks/post_edit_boundary.py")], input=text, env=env)


def test_post_edit_hook_exits_2_on_violation_and_0_when_clean(tmp_path):
    # Runs against a throwaway repo (LABYRINTH_ROOT) so concurrent agents never see the planted file.
    root, bad, good = _hook_tree(tmp_path)
    r = _post_edit(root, {"tool_input": {"file_path": str(bad)}})
    assert r.returncode == 2 and "BOUNDARY VIOLATION" in r.stderr and "renderer/src/bad.ts:1" in r.stderr
    assert _post_edit(root, {"tool_input": {"file_path": str(good)}}).returncode == 0
    assert _post_edit(root, {"tool_name": "Edit", "tool_input": {"file_path": str(root / "notes.md")}}).returncode == 0
    assert _post_edit(root, {"tool_name": "Bash", "tool_input": {"command": "x"}}).returncode == 2
    bad.unlink()
    assert _post_edit(root, {"tool_name": "Bash", "tool_input": {"command": "x"}}).returncode == 0
    assert _post_edit(root, {"tool_name": "Write", "tool_input": {"file_path": str(bad)}}).returncode == 0  # file is gone


def test_post_edit_hook_rescans_on_powershell_edits(tmp_path):
    # On the Windows checkout shell edits arrive as tool_name "PowerShell", not "Bash" (D-020).
    root, bad, _ = _hook_tree(tmp_path)
    payload = {"tool_name": "PowerShell", "tool_input": {"command": "x"}}
    assert _post_edit(root, payload).returncode == 2
    bad.unlink()
    assert _post_edit(root, payload).returncode == 0


def test_post_edit_hook_fails_closed_on_input_it_cannot_read(tmp_path):
    root, bad, _ = _hook_tree(tmp_path)
    for payload in ("not json", "", "[]", '{"tool_name": "Edit"}', '{"tool_name": "Edit", "tool_input": {"file_path": 7}}'):
        r = _post_edit(root, payload)
        assert r.returncode == 2 and "BOUNDARY VIOLATION" in r.stderr, payload
    bad.unlink()
    for payload in ("not json", '{"tool_name": "Edit"}'):
        assert _post_edit(root, payload).returncode == 0, payload
    # An empty tree, or a root that does not exist: the scan cannot report OK.
    assert _post_edit(tmp_path / "nowhere", "not json").returncode == 2


def test_post_edit_hook_checks_every_editing_tool_and_any_letter_case_of_the_side(tmp_path):
    root, bad, good = _hook_tree(tmp_path)
    for tool in ("Edit", "Write", "MultiEdit"):
        r = _post_edit(root, {"tool_name": tool, "tool_input": {"file_path": str(bad)}})
        assert r.returncode == 2 and "renderer/src/bad.ts:1" in r.stderr, tool
        assert _post_edit(root, {"tool_name": tool, "tool_input": {"file_path": str(good)}}).returncode == 0, tool
    # RV-G4: on a case-insensitive disk (native Windows, DrvFs) these name renderer/ and main/ themselves
    for spelled in ("Renderer/src/bad.ts", "RENDERER\\SRC\\BAD.TS", "Main/labyrinth_main/x.py"):
        r = _post_edit(root, {"tool_name": "Edit", "tool_input": {"file_path": f"{root}/{spelled}"}})
        assert r.returncode == 2 and "renderer/src/bad.ts:1" in r.stderr, spelled
    bad.unlink()
    assert _post_edit(root, {"tool_name": "Edit", "tool_input": {"file_path": f"{root}/Renderer/src/bad.ts"}}).returncode == 0


# ============================== .claude/settings.json: the commands are executed for real ==============================

def _settings():
    return json.loads((ROOT / ".claude/settings.json").read_text())["hooks"]


def _both_launch_modes(tmp_path):
    """The hook command is started (a) from another directory with CLAUDE_PROJECT_DIR set, (b) from the repo without it."""
    return [(tmp_path, {"CLAUDE_PROJECT_DIR": str(ROOT)}), (ROOT, {})]


def test_settings_post_tool_use_matcher_covers_every_editing_tool():
    (entry,) = _settings()["PostToolUse"]
    for tool in ("Edit", "Write", "MultiEdit", "Bash", "PowerShell"):
        assert re.fullmatch(entry["matcher"], tool), f"PostToolUse matcher does not cover {tool}"
    assert not re.fullmatch(entry["matcher"], "Read")
    (hook,) = entry["hooks"]
    assert hook["type"] == "command" and 0 < hook["timeout"] <= 60


def test_settings_post_tool_use_command_runs_the_boundary_hook(tmp_path):
    command = _settings()["PostToolUse"][0]["hooks"][0]["command"]
    root, bad, _ = _hook_tree(tmp_path)
    payload = json.dumps({"tool_name": "PowerShell", "tool_input": {"command": "x"}})
    for cwd, extra in _both_launch_modes(tmp_path):
        env = {"PATH": SYS_PATH, "LABYRINTH_ROOT": str(root), **extra}
        r = subprocess.run(command, shell=True, cwd=cwd, env=env, input=payload, capture_output=True, text=True, check=False)
        assert r.returncode == 2 and "BOUNDARY VIOLATION" in r.stderr, (extra, r.stderr)
    bad.unlink()
    for cwd, extra in _both_launch_modes(tmp_path):
        env = {"PATH": SYS_PATH, "LABYRINTH_ROOT": str(root), **extra}
        r = subprocess.run(command, shell=True, cwd=cwd, env=env, input=payload, capture_output=True, text=True, check=False)
        assert r.returncode == 0, (extra, r.stderr)


def test_settings_stop_command_runs_the_verify_loop(tmp_path):
    (entry,) = _settings()["Stop"]
    (hook,) = entry["hooks"]
    assert hook["type"] == "command" and hook["timeout"] >= 300
    for i, (cwd, extra) in enumerate(_both_launch_modes(tmp_path)):
        env = {"PATH": SYS_PATH, "HOME": str(tmp_path), "LABYRINTH_TOOLS": str(tmp_path / "none"), "LABYRINTH_STATE_DIR": str(tmp_path / f"state{i}"),
               "LABYRINTH_MAX_STOP_BLOCKS": "5", "LABYRINTH_VERIFY_CMD": "echo STAGE-FAILED; exit 2", "GIT_DIR": NO_GIT, **extra}
        payload = json.dumps({"session_id": "settings"})
        r = subprocess.run(hook["command"], shell=True, cwd=cwd, env=env, input=payload, capture_output=True, text=True, check=False)
        assert r.returncode == 2 and "STAGE-FAILED" in r.stderr and "attempt 1/5" in r.stderr, (extra, r.stderr)
        env["LABYRINTH_VERIFY_CMD"] = "true"
        r = subprocess.run(hook["command"], shell=True, cwd=cwd, env=env, input=payload, capture_output=True, text=True, check=False)
        assert r.returncode == 0, (extra, r.stderr)


def _default_verify_tree(tmp_path):
    """A throwaway checkout under a directory whose name has a space, holding the real Stop-hook scripts and a stub
    scripts/verify.sh that records its arguments and working directory, fails on its first run and passes after."""
    tree = tmp_path / "with space" / "checkout"
    (tree / "scripts/hooks").mkdir(parents=True)
    for rel in ("scripts/hooks/stop_verify.sh", "scripts/hooks/stop_launcher.py", "scripts/dev.sh"):
        shutil.copy(ROOT / rel, tree / rel)
    (tree / "scripts/verify.sh").write_text(
        '#!/usr/bin/env bash\nprintf "%s|%s\\n" "$*" "$PWD" >> "$VERIFY_LOG"\nn=$(wc -l < "$VERIFY_LOG")\n'
        'echo "STUB-VERIFY run $n"\nif [ "$n" -ge 2 ]; then exit 0; fi\nexit 2\n')
    return tree


def test_stop_hook_default_command_runs_verify_all_from_the_checkout_root(tmp_path):
    # RV-G17: every other Stop-hook test sets LABYRINTH_VERIFY_CMD, so a default that checks nothing passed them all.
    # RV-G14: the default used to be eval'd with the root unquoted - exit 127 in a checkout whose path has a space.
    tree = _default_verify_tree(tmp_path)
    log = tmp_path / "verify-calls.log"
    payload = json.dumps({"session_id": "default-command"})
    base = {"PATH": SYS_PATH, "HOME": str(tmp_path), "GIT_DIR": NO_GIT, "VERIFY_LOG": str(log), "LABYRINTH_MAX_STOP_BLOCKS": "5",
            "LABYRINTH_TOOLS": str(tmp_path / "none")}
    hook = ["bash", str(tree / "scripts/hooks/stop_verify.sh")]
    command = _settings()["Stop"][0]["hooks"][0]["command"]
    launches = [(hook, tmp_path, {}, False), (command, tmp_path, {"CLAUDE_PROJECT_DIR": str(tree)}, True), (command, tree, {}, True)]
    for i, (cmd, cwd, extra, shell) in enumerate(launches):
        log.write_text("")
        env = {**base, "LABYRINTH_STATE_DIR": str(tmp_path / f"state{i}"), **extra}
        first, second = (subprocess.run(cmd, shell=shell, cwd=cwd, env=env, input=payload, capture_output=True, text=True, check=False)
                         for _ in range(2))
        assert first.returncode == 2 and "STUB-VERIFY run 1" in first.stderr and "attempt 1/5" in first.stderr, (i, first.stderr)
        assert second.returncode == 0, (i, second.stderr)
        assert log.read_text().splitlines() == [f"all|{tree}"] * 2, i  # exactly `verify.sh all`, run from the checkout root


def test_settings_commands_name_scripts_that_exist():
    hooks = _settings()
    for command in (hooks["PostToolUse"][0]["hooks"][0]["command"], hooks["Stop"][0]["hooks"][0]["command"]):
        parts = re.search(r"os\.getcwd\(\),((?:'[^']+',?)+)\)", command)
        assert parts, command
        script = ROOT.joinpath(*re.findall(r"'([^']+)'", parts.group(1)))
        assert script.is_file(), script


# ============================== dev wrapper, launcher, setup, probe copies ==============================

def test_dev_wrapper_needs_a_command_and_passes_exit_codes_through():
    r = run(["bash", "scripts/dev.sh"])
    assert r.returncode == 2 and "expected a command" in r.stderr
    assert run(["bash", "scripts/dev.sh", "true"]).returncode == 0
    assert run(["bash", "scripts/dev.sh", "bash", "-c", "exit 2"]).returncode == 2
    assert run(["bash", "scripts/dev.sh", "bash", "-c", "echo hi"]).stdout == "hi\n"


def test_dev_wrapper_puts_the_local_toolchain_first_on_path(tmp_path):
    for sub in ("venv/bin", "node/bin"):
        (tmp_path / sub).mkdir(parents=True)
    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "LABYRINTH_TOOLS": str(tmp_path)}
    r = run(["bash", "scripts/dev.sh", "bash", "-c", 'echo "$PATH"'], env=env)
    assert r.stdout.strip() == f"{tmp_path}/node/bin:{tmp_path}/venv/bin:/usr/bin:/bin"


def test_scripts_without_home_exit_0_or_2_never_1(tmp_path):
    # RV-G20: `set -u` turned an unset HOME into exit 1, which the Stop launcher reads as "the gate did not run".
    env = {"PATH": "/usr/bin:/bin"}
    r = run(["bash", "scripts/dev.sh", "bash", "-c", "echo ran"], env=env)
    assert r.returncode == 0 and r.stdout == "ran\n", r.stderr
    for script in ("scripts/probe-copy.sh", "scripts/setup-dev.sh"):
        r = run(["bash", script, *(["nohome"] if "probe" in script else [])], env=env)
        assert r.returncode == 2 and "HOME is not set" in r.stderr, (script, r.returncode, r.stderr)


def test_setup_refuses_a_windows_python_that_does_not_run(tmp_path):
    # RV-G10: `command -v python3.exe` also finds the WindowsApps Store stub, which exits 9009 when no Python is
    # installed; the hooks would then fail open. Checked before anything is downloaded or installed.
    proc = tmp_path / "proc_version"
    proc.write_text("Linux version 6.6.87.2-microsoft-standard-WSL2\n")
    bindir = tmp_path / "bin"
    bindir.mkdir()
    env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(tmp_path), "LABYRINTH_TOOLS": str(tmp_path / "tools"),
           "LABYRINTH_PROC_VERSION": str(proc)}
    r = run(["bash", "scripts/setup-dev.sh"], env=env)
    assert r.returncode == 2 and "no python3.exe on PATH" in r.stderr, r.stderr
    stub = bindir / "python3.exe"
    stub.write_text("#!/bin/sh\necho 'Python was not found; run without arguments to install from the Microsoft Store' >&2\nexit 9009\n")
    stub.chmod(0o755)
    r = run(["bash", "scripts/setup-dev.sh"], env=env)
    assert r.returncode == 2 and "does not run Python 3.8+" in r.stderr, r.stderr
    assert not (tmp_path / "tools").exists()  # nothing was installed


def _stop_launcher(tmp_path, verify_cmd):
    env = {"PATH": SYS_PATH, "LABYRINTH_VERIFY_CMD": verify_cmd, "LABYRINTH_TOOLS": str(tmp_path / "none"), "GIT_DIR": NO_GIT,
           "LABYRINTH_STATE_DIR": str(tmp_path), "LABYRINTH_MAX_STOP_BLOCKS": "5", "HOME": str(tmp_path)}
    return run([sys.executable, "scripts/hooks/stop_launcher.py"], input=json.dumps({"session_id": "launcher"}), env=env)


def test_stop_launcher_blocks_with_2_and_passes_with_0(tmp_path):
    r = _stop_launcher(tmp_path, "echo STAGE-FAILED; exit 2")
    assert r.returncode == 2 and "FAILED (exit 2)" in r.stderr and "STAGE-FAILED" in r.stderr
    assert _stop_launcher(tmp_path, "exit 1").returncode == 2  # any failure is 2, never another code
    assert _stop_launcher(tmp_path, "true").returncode == 0


def test_stop_launcher_without_a_shell_blocks_once_then_releases(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("stop_launcher", ROOT / "scripts/hooks/stop_launcher.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    def call(payload, behaviour):
        monkeypatch.setattr(mod.subprocess, "run", behaviour)
        monkeypatch.setattr(mod.sys, "stdin", io.TextIOWrapper(io.BytesIO(payload)))
        return mod.main()

    def no_shell(*_a, **_k):
        raise FileNotFoundError("wsl.exe")

    def crashes(*_a, **_k):
        raise ValueError("embedded null byte")

    def exits(code):
        return lambda *_a, **_k: subprocess.CompletedProcess([], code)

    first, again = b'{"session_id":"x"}', b'{"session_id":"x","stop_hook_active":true}'
    # The gate's own verdicts pass straight through and are never released.
    assert call(first, exits(0)) == 0
    assert call(first, exits(2)) == 2
    assert call(again, exits(2)) == 2
    # The gate did not run at all (no shell, broken WSL = 4294967295, script not found = 127, killed, launcher error):
    # block once, release on the retry so a machine without a working WSL cannot trap a session (SC-12).
    for broken in (no_shell, crashes, exits(4294967295), exits(127), exits(1), exits(-9)):
        assert call(first, broken) == 2
        assert call(b"not json", broken) == 2
        assert call(again, broken) == 0


def test_setup_pins_versions_and_digests_and_installs_nothing_unchecked():
    text = (ROOT / "scripts/setup-dev.sh").read_text()
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert "sudo" not in code
    assert not re.search(r"\|\s*(ba|da|z)?sh\b", code)  # no piped installers
    assert "latest" not in code                          # no floating versions
    for tool in ("UV", "NODE"):
        assert re.search(rf'^{tool}_VERSION="v?\d+\.\d+\.\d+"$', code, re.M), tool
        assert re.search(rf'^{tool}_SHA256="[0-9a-f]{{64}}"$', code, re.M), tool
    # every download goes through fetch(), and fetch() fails on a digest mismatch
    assert code.count("curl ") == 1 and "sha256sum -c -" in code and 'fail "sha256 mismatch' in code


def _fake_repo(tmp_path):
    """A throwaway repo holding a copy of probe-copy.sh: the unsafe cases run against it, never against ROOT."""
    repo = tmp_path / "fakerepo"
    (repo / "scripts").mkdir(parents=True)
    (repo / "scripts/probe-copy.sh").write_bytes((ROOT / "scripts/probe-copy.sh").read_bytes())
    (repo / "keep.txt").write_text("precious\n")
    (repo / "renderer/node_modules/pkg").mkdir(parents=True)
    (repo / "renderer/node_modules/pkg/index.js").write_text("module.exports = 1;\n")
    (repo / "renderer/node_modules/.bin").mkdir()
    (repo / "renderer/src").mkdir()
    (repo / "renderer/src/a.ts").write_text("export const a = 1;\n")
    return repo


def _probe(repo, tmp_path, probe_dir, *names, cwd=None):
    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "LABYRINTH_PROBE_DIR": str(probe_dir)}
    return subprocess.run(["bash", str(repo / "scripts/probe-copy.sh"), *names], cwd=cwd or repo, env=env,
                          capture_output=True, text=True, check=False)


def test_probe_copy_rejects_bad_names_and_makes_an_isolated_copy(tmp_path):
    repo = _fake_repo(tmp_path)
    probes = tmp_path / "probes"
    for bad in ([], ["a", "b"], [".."], ["."], ["a/b"], ["-rf"], [""]):
        assert _probe(repo, tmp_path, probes, *bad).returncode == 2, bad
    r = _probe(repo, tmp_path, probes, "t1")
    assert r.returncode == 0, r.stderr
    copy = Path(r.stdout.strip())
    assert copy == probes / "t1"
    assert (copy / "keep.txt").read_text() == "precious\n" and (copy / "renderer/src/a.ts").exists()
    assert (copy / check_docs.PROBE_MARKER).is_file()  # check_docs.py recognises a probe copy by this marker
    (copy / "keep.txt").write_text("mutated\n")  # mutating the copy must not touch the repo
    assert (repo / "keep.txt").read_text() == "precious\n"
    # a second run replaces a copy this script made (it carries the marker)
    assert _probe(repo, tmp_path, probes, "t1").returncode == 0
    assert (copy / "keep.txt").read_text() == "precious\n"


def test_probe_copy_never_deletes_the_repo_or_anything_it_did_not_create(tmp_path):
    repo = _fake_repo(tmp_path)
    # destination == repo, destination inside the repo, repo inside the destination (SC-10)
    assert _probe(repo, tmp_path, tmp_path, "fakerepo").returncode == 2
    assert _probe(repo, tmp_path, repo, "renderer").returncode == 2
    assert _probe(repo, tmp_path, ".", "renderer", cwd=repo).returncode == 2
    nested = tmp_path / "outer" / "inner"
    nested.mkdir(parents=True)
    inner_repo = _fake_repo(nested)
    assert _probe(inner_repo, tmp_path, tmp_path, "outer").returncode == 2
    for survivor in (repo / "keep.txt", repo / "renderer/src/a.ts", inner_repo / "keep.txt"):
        assert survivor.exists(), survivor
    # an existing directory without the marker is somebody else's: refuse, leave it alone
    other = tmp_path / "probes" / "mine"
    other.mkdir(parents=True)
    (other / "notes.txt").write_text("keep me\n")
    r = _probe(repo, tmp_path, tmp_path / "probes", "mine")
    assert r.returncode == 2 and "was not created by probe-copy.sh" in r.stderr
    assert (other / "notes.txt").read_text() == "keep me\n"
    # a symlink at the destination is refused, its target untouched
    (tmp_path / "probes" / "link").symlink_to(repo)
    assert _probe(repo, tmp_path, tmp_path / "probes", "link").returncode == 2
    assert (repo / "keep.txt").exists()


def test_probe_copy_decides_overlap_before_creating_anything_and_in_any_letter_case(tmp_path):
    repo = _fake_repo(tmp_path)
    # a destination inside the repo that does not exist yet: refused, and nothing is created in the repo (N16)
    r = _probe(repo, tmp_path, repo / "newdir" / "deeper", "p1")
    assert r.returncode == 2 and "is the repo or inside it" in r.stderr, r.stderr
    assert not (repo / "newdir").exists()
    # RV-G19: /mnt/c and /mnt/d are case-insensitive, so FAKEREPO/tmp is inside the repo there (refused on every disk)
    for spelled in (tmp_path / "FAKEREPO" / "tmp", tmp_path / "FakeRepo" / "renderer" / "x"):
        r = _probe(repo, tmp_path, spelled, "p2")
        assert r.returncode == 2 and "is the repo or inside it" in r.stderr, (spelled, r.stderr)
    r = _probe(repo, tmp_path, tmp_path / "FAKEREPO", "x")
    assert r.returncode == 2
    assert not (tmp_path / "FAKEREPO").exists() and not (tmp_path / "FakeRepo").exists()
    # the repo inside the destination, spelled in another case
    r = _probe(repo, tmp_path, tmp_path, "FAKEREPO")
    assert r.returncode == 2 and "refusing" in r.stderr
    assert (repo / "keep.txt").read_text() == "precious\n"


def test_probe_copy_node_modules_survives_npm_ci_in_the_copy(tmp_path):
    repo = _fake_repo(tmp_path)
    copy = Path(_probe(repo, tmp_path, tmp_path / "probes", "nm").stdout.strip())
    nm = copy / "renderer/node_modules"
    assert nm.is_dir() and not nm.is_symlink()
    assert (nm / "pkg").is_symlink() and (nm / ".bin").is_symlink()
    assert (nm / "pkg/index.js").read_text() == "module.exports = 1;\n"
    subprocess.run(["rm", "-rf", str(nm)], check=True)  # what `npm ci` does first
    assert (repo / "renderer/node_modules/pkg/index.js").exists()


def test_text_files_are_lf_only():
    # A CRLF checkout breaks bash gates, artifacts:fresh byte equality and sha256 pins (D-020).
    attrs = (ROOT / ".gitattributes").read_text()
    assert "* text=auto eol=lf" in attrs
    gates = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "scripts").rglob("*") if p.suffix in {".sh", ".py"})
    assert len(gates) >= 10
    for rel in [*gates, "artifacts/manifest.json", ".github/workflows/ci.yml", ".github/workflows/claude-review.yml"]:
        assert b"\r\n" not in (ROOT / rel).read_bytes(), rel


# ============================== (2) verify.sh: stages, exit codes ==============================

PY_STAGE = {
    "boundary:self-test": "scripts/check_boundaries.py --self-test",
    "boundary:scan": "scripts/check_boundaries.py",
    "docs:handoff": "scripts/check_docs.py",
    "scripts:tests": "-m pytest -q -p no:cacheprovider scripts/tests",
    "main:lint": "-m ruff check main scripts",
    "main:tests": "-m pytest -q main/tests",
    "artifacts:schema": "scripts/validate_artifacts.py",
    "artifacts:fresh": "scripts/validate_artifacts.py --check-fresh",
}
NPM_STAGE = {
    "renderer:install": "--prefix renderer ci --no-audit --no-fund",
    "renderer:typecheck": "--prefix renderer run -s typecheck",
    "renderer:tests": "--prefix renderer run -s test",
    "renderer:build": "--prefix renderer run -s build",
}
_BOUNDARY = ["boundary:self-test", "boundary:scan"]
_RENDERER = ["renderer:typecheck", "renderer:tests", "renderer:build"]
# The documented stage list of every scope (verify.sh header, interface.md section 8), in execution order.
SCOPE_STAGES = {
    "boundary": [*_BOUNDARY, "scripts:tests"],
    "docs": ["docs:handoff"],
    "artifacts": ["artifacts:schema", "artifacts:fresh"],
    "main": [*_BOUNDARY, "scripts:tests", "main:lint", "main:tests", "artifacts:schema", "artifacts:fresh"],
    "renderer": [*_BOUNDARY, *_RENDERER],
    "all": [*_BOUNDARY, "docs:handoff", "scripts:tests", "main:lint", "main:tests", "artifacts:schema", "artifacts:fresh", *_RENDERER],
}
STUB = """#!/bin/bash
# Stand-in for python3 / npm: answers verify.sh's interpreter check, records every other call, fails on request.
tool="$(basename "$0")"
if [ "$tool" = python3 ] && [ "$1" = "-c" ]; then exec "$REAL_PYTHON" "$@"; fi
echo "$tool $*" >> "$STUB_LOG"
if [ "$tool $*" = "${STUB_FAIL:-}" ]; then exit "${STUB_FAIL_CODE:-1}"; fi
exit 0
"""


def _stub_verify(tmp_path, *args, fail=None, code=1, script="scripts/verify.sh"):
    """Run the real verify.sh (or a copy of it) with stub tools: nothing is checked, so the real tree is never touched or needed."""
    bindir = tmp_path / "stub-bin"
    bindir.mkdir(exist_ok=True)
    for tool in ("python3", "npm"):
        (bindir / tool).write_text(STUB)
        (bindir / tool).chmod(0o755)
    log = tmp_path / "stub.log"
    log.write_text("")
    env = {"PATH": f"{bindir}:/usr/bin:/bin", "PYTHON": str(bindir / "python3"), "REAL_PYTHON": sys.executable, "STUB_LOG": str(log),
           "STUB_FAIL": fail or "", "STUB_FAIL_CODE": str(code)}
    r = run(["bash", str(script), *args], env=env)
    summary = re.findall(r"^  (PASS|FAIL)  (\S+) \(\d+s\)$", r.stdout.split("verify.sh summary")[-1], re.M)
    commands = dict(re.findall(r"^━━━ \[([^\]]+)\] \$ (.*)$", r.stdout, re.M))
    return r, summary, commands, log.read_text().splitlines()


def _expected(scope):
    stages = list(SCOPE_STAGES[scope])
    if "renderer:typecheck" in stages and not (ROOT / "renderer/node_modules").is_dir():
        stages.insert(stages.index("renderer:typecheck"), "renderer:install")
    return stages


def _stub_call(stage):
    return f"python3 {PY_STAGE[stage]}" if stage in PY_STAGE else f"npm {NPM_STAGE[stage]}"


def test_verify_runs_exactly_the_documented_stages_for_each_scope(tmp_path):
    assert set(SCOPE_STAGES["all"]) | {"renderer:install"} == set(PY_STAGE) | set(NPM_STAGE)
    assert len(SCOPE_STAGES["all"]) == 11
    for scope, args in [(s, [s]) for s in SCOPE_STAGES] + [("all", [])]:
        r, summary, commands, calls = _stub_verify(tmp_path, *args)
        expected = _expected(scope)
        assert r.returncode == 0 and "verify.sh: all stages passed." in r.stdout, (scope, r.stderr)
        assert summary == [("PASS", s) for s in expected], scope
        assert f"verify.sh summary (scope: {scope})" in r.stdout
        # each stage really runs its gate command, in order, exactly once
        assert calls == [_stub_call(s) for s in expected], scope
        for s in expected:
            assert commands[s].endswith(_stub_call(s).split(" ", 1)[1]), (scope, s, commands[s])


def test_verify_installs_renderer_deps_only_when_node_modules_is_missing(tmp_path):
    # P8: _expected() only expects renderer:install when the real tree lacks node_modules - never on a dev machine or in CI.
    mini = tmp_path / "mini"
    (mini / "scripts").mkdir(parents=True)
    shutil.copy(ROOT / "scripts/verify.sh", mini / "scripts/verify.sh")
    for scope in ("renderer", "all"):
        r, summary, _, calls = _stub_verify(tmp_path, scope, script=mini / "scripts/verify.sh")
        expected = list(SCOPE_STAGES[scope])
        expected.insert(expected.index("renderer:typecheck"), "renderer:install")
        assert r.returncode == 0 and summary == [("PASS", s) for s in expected], (scope, r.stdout)
        assert calls == [_stub_call(s) for s in expected], scope
    (mini / "renderer/node_modules").mkdir(parents=True)
    r, summary, _, calls = _stub_verify(tmp_path, "renderer", script=mini / "scripts/verify.sh")
    assert summary == [("PASS", s) for s in SCOPE_STAGES["renderer"]] and _stub_call("renderer:install") not in calls


def test_verify_exits_2_when_any_single_stage_fails_and_still_runs_the_rest(tmp_path):
    expected = _expected("all")
    for failing in expected:
        for code in (1, 2, 3, 127):
            r, summary, _, calls = _stub_verify(tmp_path, "all", fail=_stub_call(failing), code=code)
            assert r.returncode == 2, (failing, code, r.returncode)
            assert summary == [("FAIL" if s == failing else "PASS", s) for s in expected], (failing, code)
            assert "verify.sh: FAILED" in r.stderr and "all stages passed" not in r.stdout
            assert len(calls) == len(expected)
            if failing != expected[0]:
                break  # the exit-code sweep once is enough; every stage still gets its own failing run


def test_verify_rejects_bad_invocations_with_2(tmp_path):
    for args in (["nope"], [""], ["main", "extra"], ["--help"], ["ALL"]):
        assert run(["bash", "scripts/verify.sh", *args]).returncode == 2, args
        r, summary, _, calls = _stub_verify(tmp_path, *args)
        assert r.returncode == 2 and summary == [] and calls == [], args


def test_verify_refuses_an_interpreter_that_is_not_python(tmp_path):
    # SC-7: with PYTHON=true every Python stage would "pass" having checked nothing.
    old = tmp_path / "python2ish"
    old.write_text("#!/bin/sh\necho labyrinth-python-too-old\n")
    old.chmod(0o755)
    liar = tmp_path / "liar"
    liar.write_text("#!/bin/sh\nexit 0\n")
    liar.chmod(0o755)
    for scope in ("boundary", "docs", "artifacts", "main", "renderer", "all"):
        for fake in ("true", "false", "/nonexistent/python3", "echo", str(old), str(liar)):
            r = run(["bash", "scripts/verify.sh", scope], env={"PATH": SYS_PATH, "PYTHON": fake})
            assert r.returncode == 2 and "is not a working Python" in r.stderr and "summary" not in r.stdout, (scope, fake)


def _mini_repo(tmp_path):
    """verify.sh + the docs gate in a throwaway repo: a real stage, really failing, without touching ROOT."""
    mini = tmp_path / "mini"
    (mini / "scripts").mkdir(parents=True)
    for name in ("verify.sh", "check_docs.py"):
        shutil.copy(ROOT / "scripts" / name, mini / "scripts" / name)
    return mini


def test_verify_exits_2_when_a_real_stage_fails_and_ignores_the_test_overrides(tmp_path):
    mini = _mini_repo(tmp_path)
    env = {"PATH": SYS_PATH, "PYTHON": sys.executable, "LABYRINTH_ROOT": "/nonexistent", "LABYRINTH_ARTIFACTS": "/nonexistent"}
    r = run(["bash", str(mini / "scripts/verify.sh"), "docs"], env=env, cwd=tmp_path)
    assert r.returncode == 2 and "FAIL  docs:handoff" in r.stdout and "DOCS ERROR: status.md missing or empty" in r.stderr
    for f in check_docs.REQUIRED:
        (mini / f).write_text("x\n")
    (mini / "tasks/01-x").mkdir(parents=True)
    (mini / "tasks/01-x/TASK.md").write_text(TASK.format(status="TODO"))
    r = run(["bash", str(mini / "scripts/verify.sh"), "docs"], env=env, cwd=tmp_path)
    assert r.returncode == 0 and "PASS  docs:handoff" in r.stdout, r.stderr  # LABYRINTH_ROOT=/nonexistent was unset by verify.sh
    (mini / "tasks/01-x/TASK.md").write_text(TASK.format(status="DONE"))
    r = run(["bash", str(mini / "scripts/verify.sh"), "docs"], env=env, cwd=tmp_path)
    assert r.returncode == 2 and "FAIL  docs:handoff" in r.stdout


def test_every_gate_maps_an_internal_error_to_exit_2(monkeypatch, capsys):
    def boom(*_a, **_k):
        raise RuntimeError("boom")

    for module in (check_boundaries, check_docs, validate_artifacts):
        monkeypatch.setattr(module, "main", boom)
        assert module.cli([]) == 2, module.__name__
        assert "internal error" in capsys.readouterr().err
        monkeypatch.setattr(module, "main", lambda *_a: 1)  # a stray non-zero code is still 2
        assert module.cli([]) == 2
        monkeypatch.setattr(module, "main", lambda *_a: 0)
        assert module.cli([]) == 0
    for script in ("check_boundaries.py", "check_docs.py", "validate_artifacts.py"):
        assert "sys.exit(cli(sys.argv[1:]))" in (ROOT / "scripts" / script).read_text(), script


def test_every_gate_rejects_unknown_flags_with_2():
    for script in ("check_boundaries.py", "check_docs.py", "validate_artifacts.py"):
        for args in (["--bogus"], ["-x"], ["extra"], ["--check-fresh", "extra"]):
            r = run([sys.executable, f"scripts/{script}", *args])
            assert r.returncode == 2 and "Traceback" not in r.stderr, (script, args)


# ============================== (2) validate_artifacts.py ==============================

def _artifacts(tmp_path):
    dst = tmp_path / "artifacts"
    shutil.copytree(ROOT / "artifacts", dst)
    return dst


def _validate(art, *args):
    r = run([sys.executable, "scripts/validate_artifacts.py", *args], env={"PATH": SYS_PATH, "LABYRINTH_ARTIFACTS": str(art)})
    assert "Traceback" not in r.stderr, r.stderr
    assert r.returncode in (0, 2)
    return r


def _restamp(art, name):
    """Make the manifest's sha256 match `name` again, so only the defect under test is left."""
    manifest = json.loads((art / "manifest.json").read_text())
    for entry in manifest["artifacts"]:
        if entry["path"] == name:
            entry["sha256"] = validate_artifacts.hashlib.sha256((art / name).read_bytes()).hexdigest()
    (art / "manifest.json").write_text(json.dumps(manifest))


def test_artifacts_committed_set_is_valid(tmp_path):
    r = _validate(_artifacts(tmp_path))
    assert r.returncode == 0 and "artifacts: schema-valid" in r.stdout, r.stderr


def test_artifacts_schema_failure_exits_2(tmp_path):
    art = _artifacts(tmp_path)
    data = json.loads((art / "budget.json").read_text())
    data["schemaVersion"] = "one"
    (art / "budget.json").write_text(json.dumps(data))
    _restamp(art, "budget.json")
    r = _validate(art)
    assert r.returncode == 2 and "ARTIFACT ERROR: budget.json: $.schemaVersion" in r.stderr and "sha256" not in r.stderr
    art2 = _artifacts(tmp_path / "second")
    manifest = json.loads((art2 / "manifest.json").read_text())
    manifest["generator"]["name"] = "someone-else"
    (art2 / "manifest.json").write_text(json.dumps(manifest))
    r = _validate(art2)
    assert r.returncode == 2 and "manifest.json: $.generator.name" in r.stderr


def test_artifacts_manifest_sha_mismatch_exits_2(tmp_path):
    art = _artifacts(tmp_path)
    (art / "spatial.json").write_bytes((art / "spatial.json").read_bytes() + b"\n")  # still valid JSON, still schema-valid
    r = _validate(art)
    assert r.returncode == 2 and "ARTIFACT ERROR: spatial.json: sha256 does not match the manifest" in r.stderr
    assert r.stderr.count("ARTIFACT ERROR") == 1


def test_artifacts_truncated_or_undecodable_json_exits_2(tmp_path):
    for i, (name, mutate) in enumerate([
        ("transport.json", lambda b: b[: len(b) // 2]),
        ("manifest.json", lambda b: b[: len(b) // 2]),
        ("manifest.json", lambda b: b""),
        ("forecast.json", lambda b: b"\xff\xfe" + b),
        ("manifest.json", lambda b: b"[]"),
        ("manifest.json", lambda b: b'{"artifacts": 7}'),
    ]):
        art = _artifacts(tmp_path / str(i))
        (art / name).write_bytes(mutate((art / name).read_bytes()))
        r = _validate(art)
        assert r.returncode == 2 and f"ARTIFACT ERROR: {name}" in r.stderr, (name, r.stderr)


def test_artifacts_directory_must_equal_the_manifest_set(tmp_path):
    cases = {
        "extra json": (lambda a: (a / "handmade.json").write_text("{}"), "handmade.json: in artifacts/ but not listed"),
        "subdirectory": (lambda a: ((a / "sub").mkdir(), (a / "sub/handmade.json").write_text("{}")), "sub/: subdirectories are not allowed"),
        "empty subdirectory": (lambda a: (a / "empty").mkdir(), "empty/: subdirectories are not allowed"),
        "not json": (lambda a: (a / "helper.ts").write_text("export {}"), "helper.ts: only .json files are allowed"),
        "missing": (lambda a: (a / "spatial.json").unlink(), "spatial.json: listed in the manifest but missing"),
        "no manifest": (lambda a: (a / "manifest.json").unlink(), "manifest.json missing"),
    }
    for i, (name, (mutate, message)) in enumerate(cases.items()):
        art = _artifacts(tmp_path / str(i))
        mutate(art)
        r = _validate(art)
        assert r.returncode == 2 and message in r.stderr, (name, r.stderr)
    # a manifest entry may only name a plain file inside artifacts/
    art = _artifacts(tmp_path / "escape")
    manifest = json.loads((art / "manifest.json").read_text())
    manifest["artifacts"][0]["path"] = "../contracts/common.schema.json"
    (art / "manifest.json").write_text(json.dumps(manifest))
    r = _validate(art)
    assert r.returncode == 2 and "must be a plain <name>.json file name" in r.stderr


def test_artifacts_manifest_cannot_choose_what_is_checked(tmp_path):
    def gate(i, mutate):
        art = _artifacts(tmp_path / str(i))
        manifest = json.loads((art / "manifest.json").read_text())
        mutate(art, manifest)
        (art / "manifest.json").write_text(json.dumps(manifest))
        return _validate(art)

    def entry(manifest, artifact_id):
        return next(e for e in manifest["artifacts"] if e["id"] == artifact_id)

    def empty_budget_as_common(art, manifest):  # RV-G15: {} is valid against common.schema.json
        (art / "budget.json").write_text("{}")
        entry(manifest, "budget").update(schema="common.schema.json", sha256=validate_artifacts.hashlib.sha256(b"{}").hexdigest())

    def drop_budget(art, manifest):
        (art / "budget.json").unlink()
        manifest["artifacts"] = [e for e in manifest["artifacts"] if e["id"] != "budget"]

    def budget_twice(art, manifest):
        manifest["artifacts"].append(dict(entry(manifest, "geometry"), id="budget"))

    def missing_contract(art, manifest):  # P14: a schema that is not a contracts/ file is an error, never a skip
        entry(manifest, "spatial")["schema"] = "spatial-v2.schema.json"

    cases = [(empty_budget_as_common, "artifact 'budget' must be budget.json validated against budget.schema.json"),
             (drop_budget, "artifact id 'budget' is listed 0 times"),
             (budget_twice, "artifact id 'budget' is listed 2 times"),
             (missing_contract, "spatial.json: schema 'spatial-v2.schema.json' is not a file in contracts/")]
    for i, (mutate, message) in enumerate(cases):
        r = gate(i, mutate)
        assert r.returncode == 2 and message in r.stderr, (mutate.__name__, r.stderr)


def test_artifacts_symlinked_artifact_is_rejected(tmp_path):
    # P15: a symlink in artifacts/ could point anywhere; the build copies what it points to.
    art = _artifacts(tmp_path)
    real = tmp_path / "elsewhere.json"
    real.write_bytes((art / "spatial.json").read_bytes())
    (art / "spatial.json").unlink()
    try:
        (art / "spatial.json").symlink_to(real)
    except OSError:
        pytest.skip("symlinks are not available here")
    r = _validate(art)
    assert r.returncode == 2 and "spatial.json: not a regular file" in r.stderr, r.stderr


def test_artifacts_stale_missing_and_leftover_files_fail_the_freshness_check(tmp_path):
    art = _artifacts(tmp_path)
    data = json.loads((art / "budget.json").read_text())
    data["ceilingUsd"] = data["ceilingUsd"] + 1
    (art / "budget.json").write_text(json.dumps(data))
    _restamp(art, "budget.json")
    (art / "spatial.json").unlink()
    (art / "legacy.json").write_text("{}")
    r = _validate(art, "--check-fresh")
    assert r.returncode == 2
    assert "artifacts/budget.json: stale or non-deterministic" in r.stderr
    assert "artifacts/spatial.json: generated but not committed" in r.stderr
    assert "artifacts/legacy.json: committed but no longer generated" in r.stderr
    assert "artifacts/geometry.json" not in r.stderr and "artifacts/manifest.json: stale" in r.stderr  # the re-stamped manifest differs too


# ============================== (3) Stop hook ==============================

def _stop(tmp_path, verify_cmd, session="s1", max_blocks="2"):
    env = {"PATH": SYS_PATH, "LABYRINTH_VERIFY_CMD": verify_cmd, "GIT_DIR": NO_GIT,
           "LABYRINTH_STATE_DIR": str(tmp_path), "LABYRINTH_MAX_STOP_BLOCKS": max_blocks, "HOME": str(tmp_path)}
    return run(["bash", "scripts/hooks/stop_verify.sh"], input=json.dumps({"session_id": session}), env=env)


def test_stop_hook_blocks_with_2_then_releases_after_max(tmp_path):
    assert _stop(tmp_path, "false").returncode == 2
    assert _stop(tmp_path, "false").returncode == 2
    assert _stop(tmp_path, "false").returncode == 0  # safety valve
    assert _stop(tmp_path, "false").returncode == 2  # counter reset after release


def test_stop_hook_counters_are_per_session(tmp_path):
    assert _stop(tmp_path, "false", session="a", max_blocks="1").returncode == 2
    assert _stop(tmp_path, "false", session="b", max_blocks="1").returncode == 2


def test_stop_hook_passes_when_verify_green(tmp_path):
    assert _stop(tmp_path / "state", "true").returncode == 0


def test_stop_hook_maps_every_verify_exit_code_to_0_or_2(tmp_path):
    for i, code in enumerate((1, 2, 3, 126, 127, 130, 255)):
        r = _stop(tmp_path / str(i), f"exit {code}")
        assert r.returncode == 2 and f"FAILED (exit {code})" in r.stderr, code


class StopRepo:
    """A throwaway checkout holding a copy of stop_verify.sh, with a verify command that records each run."""

    def __init__(self, tmp_path, with_git=True):
        self.repo = tmp_path / "checkout"
        self.state = tmp_path / "state"
        self.log = tmp_path / "verify-runs.log"
        (self.repo / "scripts/hooks").mkdir(parents=True)
        shutil.copy(ROOT / "scripts/hooks/stop_verify.sh", self.repo / "scripts/hooks/stop_verify.sh")
        (self.repo / "code.txt").write_text("one\n")
        self.log.write_text("")
        self.path = SYS_PATH
        if with_git:
            git(self.repo, "init", "-q")
            self.commit("first")

    def commit(self, message):
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", message)
        return git(self.repo, "rev-parse", "HEAD")

    def stop(self, verify_exit):
        env = {"PATH": self.path, "HOME": str(self.state), "LABYRINTH_STATE_DIR": str(self.state), "LABYRINTH_MAX_STOP_BLOCKS": "50",
               "LABYRINTH_VERIFY_CMD": f"echo ran >> '{self.log}'; exit {verify_exit}"}
        r = subprocess.run(["bash", str(self.repo / "scripts/hooks/stop_verify.sh")], input=json.dumps({"session_id": "shortcut"}),
                           env=env, cwd=self.repo, capture_output=True, text=True, check=False)
        return r.returncode

    @property
    def runs(self):
        return len(self.log.read_text().splitlines())

    @property
    def last_green(self):
        f = self.state / "last_green_head"
        return f.read_text().strip() if f.exists() else None


def test_stop_hook_skips_verify_only_for_a_clean_tree_at_the_last_green_commit(tmp_path):
    s = StopRepo(tmp_path)
    head = git(s.repo, "rev-parse", "HEAD")
    assert s.stop(2) == 2 and s.runs == 1 and s.last_green is None      # red: nothing recorded
    assert s.stop(0) == 0 and s.runs == 2 and s.last_green == head      # green on a clean tree: recorded
    assert s.stop(2) == 0 and s.runs == 2                               # clean + last green: verify is skipped
    (s.repo / "code.txt").write_text("two\n")                           # dirty tree: verify runs again
    assert s.stop(2) == 2 and s.runs == 3
    assert s.stop(0) == 0 and s.runs == 4 and s.last_green == head      # green but dirty: HEAD is not re-recorded
    head2 = s.commit("second")                                          # HEAD moved, tree clean: verify runs
    assert head2 != head
    assert s.stop(2) == 2 and s.runs == 5 and s.last_green == head
    assert s.stop(0) == 0 and s.runs == 6 and s.last_green == head2
    assert s.stop(2) == 0 and s.runs == 6
    (s.repo / "new-untracked.txt").write_text("x\n")                    # an untracked file is a dirty tree
    assert s.stop(2) == 2 and s.runs == 7
    # A commit that was only ever green with uncommitted fixes on top is not a green commit.
    (s.repo / "code.txt").write_text("broken\n")
    head3 = s.commit("third: broken")
    (s.repo / "code.txt").write_text("fixed, not committed\n")
    assert s.stop(0) == 0 and s.runs == 8 and s.last_green == head2     # green, but the tree is dirty: head3 is not recorded
    git(s.repo, "checkout", "-q", "--", "code.txt")                     # drop the fix: clean tree at head3
    assert git(s.repo, "status", "--porcelain") == "" and git(s.repo, "rev-parse", "HEAD") == head3
    assert s.stop(2) == 2 and s.runs == 9


def _bin_without_git(tmp_path, fake_git=None):
    """A PATH holding the tools the hook needs and either no git at all or a git that fails."""
    bindir = tmp_path / ("bin-fake-git" if fake_git else "bin-no-git")
    bindir.mkdir()
    for tool in ("bash", "sh", "cat", "mkdir", "grep", "tail", "dirname", "python3", "env"):
        (bindir / tool).symlink_to(shutil.which(tool, path=SYS_PATH))
    if fake_git:
        (bindir / "git").write_text(fake_git)
        (bindir / "git").chmod(0o755)
    return str(bindir)


def test_stop_hook_never_takes_the_shortcut_when_git_fails(tmp_path):
    # SC-1: outside a repository HEAD used to read "none" and the tree "clean": one green run switched the gate off.
    s = StopRepo(tmp_path / "not-a-repo", with_git=False)
    assert s.stop(0) == 0 and s.runs == 1 and s.last_green is None
    assert s.stop(2) == 2 and s.runs == 2
    assert s.stop(0) == 0 and s.stop(2) == 2 and s.runs == 4 and s.last_green is None
    # A real repository at its last green commit, but git is not installed / is broken: the gate still runs
    # and a green run records nothing.
    for name, fake in (("missing", None), ("fails", "#!/bin/sh\necho 'fatal: broken' >&2\nexit 128\n"), ("lies", "#!/bin/sh\nexit 0\n")):
        s = StopRepo(tmp_path / name)
        head = git(s.repo, "rev-parse", "HEAD")
        assert s.stop(0) == 0 and s.last_green == head and s.stop(2) == 0 and s.runs == 1  # shortcut works with real git
        s.path = _bin_without_git(tmp_path / name, fake)
        assert s.stop(2) == 2 and s.runs == 2, name
        (s.state / "last_green_head").unlink()
        assert s.stop(0) == 0 and s.runs == 3 and s.last_green is None, name
        assert s.stop(2) == 2 and s.runs == 4, name


# ============================== (4) check_docs.py: DONE needs a genuine, whole-task, current PASS ==============================

TASK = """# 01 x
## Owner
engineer (`src/x/`) and reviewer (`lib/y.py`)
## Expected outcome
Backend:
- X1. does a
- X2. does b

Frontend:
- X3. shows c
## Tests
one per outcome
## Status
{status}
"""
VERIFY = """# Verify: 01-x
Verifier run: 2026-11-20, commit {sha}
## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| X1 | does a | t | p | PASS |
| X2 | does b | t | p | PASS (tight, see finding 1) |
| X3 | shows c | t | p | **PASS** |
## Real output
```
3 passed
Verdict: FAIL  (inside a fence: quoted output, not a verdict)
```
## Findings
1. minor
Verdict: PASS
"""


class DocsRepo:
    def __init__(self, tmp_path, status="DONE", with_git=True):
        self.root = tmp_path / "docs-repo"
        (self.root / "tasks/01-x").mkdir(parents=True)
        (self.root / "src/x").mkdir(parents=True)
        (self.root / "lib").mkdir()
        for f in check_docs.REQUIRED:
            (self.root / f).write_text("x\n")
        (self.root / "src/x/code.py").write_text("a = 1\n")
        (self.root / "lib/y.py").write_text("b = 1\n")
        (self.root / "unrelated.txt").write_text("u\n")
        self.task = self.root / "tasks/01-x/TASK.md"
        self.verify = self.root / "tasks/01-x/VERIFY.md"
        self.task.write_text(TASK.format(status=status))
        self.sha = "0000000"
        if with_git:
            git(self.root, "init", "-q")
            self.sha = self.commit("verified state")
        self.verify.write_text(VERIFY.format(sha=self.sha))

    def commit(self, message):
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", message)
        return git(self.root, "rev-parse", "--short=7", "HEAD")

    def gate(self):
        check_docs.ROOT = self.root
        try:
            return check_docs.main()
        finally:
            check_docs.ROOT = ROOT

    def with_verify(self, text):
        self.verify.write_text(text.format(sha=self.sha))
        return self.gate()


def test_docs_done_passes_only_with_a_complete_current_pass(tmp_path, capsys):
    d = DocsRepo(tmp_path)
    assert d.gate() == 0
    assert "docs: OK (1 task folders)" in capsys.readouterr().out
    d.verify.unlink()
    assert d.gate() == 2
    assert "VERIFY.md does not exist" in capsys.readouterr().err


def test_docs_the_last_verdict_line_decides_and_must_be_exactly_pass(tmp_path):
    d = DocsRepo(tmp_path)
    body = VERIFY.rsplit("Verdict: PASS\n", 1)[0]
    assert d.with_verify(body + "Verdict: PASS\n") == 0
    assert d.with_verify(body + "Verdict: PASS  \n\n\n") == 0
    assert d.with_verify(body + "Verdict: FAIL — earlier run\nfixed, re-run:\nVerdict: PASS\n") == 0  # history, then the final PASS
    not_pass = ["Verdict: FAIL", "Verdict: FAILED", "Verdict: PARTIAL", "**Verdict: FAIL**", "- Verdict: FAIL", "> Verdict: FAIL", "## Verdict: FAIL",
                "Verdict: FAIL — boundary bypass N1", "Final verdict: FAIL", "Overall verdict - PARTIAL", "VERDICT: FAIL", "Verdict (run 4): FAIL",
                "Verdict: PASS | FAIL", "Verdict: PASS — all outcomes hold", "Verdict: PASS (outcome 1 FAIL)", "**Verdict: PASS**", "- Verdict: PASS",
                " Verdict: PASS", "verdict: pass", "Verdict:PASS", "Verdict: PASSED", "Verdict: PASS.", "Verdict:", "Verdict: PASS FAIL"]
    for line in not_pass:
        assert d.with_verify(body + line + "\n") == 2, line                                   # as the only verdict
        assert d.with_verify(body + "Verdict: PASS\n\nlater re-run\n" + line + "\n") == 2, line  # after an older PASS
    # Nothing may follow the verdict: not prose, not a fenced block, not a table.
    for tail in ("Note: X2 failed when re-run on Tuesday.\n", "```\nX2 FAILED\n```\n", "| X2 | FAIL |\n", "<!-- provisional -->\n"):
        assert d.with_verify(body + "Verdict: PASS\n" + tail) == 2, tail
    # A PASS inside a fence is quoted output, never a verdict.
    plain = body.replace("Verdict: FAIL  (inside a fence: quoted output, not a verdict)\n", "")
    for fenced in ("```\nVerdict: PASS\n```\n", "~~~\nVerdict: PASS\n~~~\n", "````\nVerdict: PASS\n````\n", "   ```text\nVerdict: PASS\n   ```\n",
                   "```\nVerdict: PASS\n", "~~~~\n```\nVerdict: PASS\n```\n~~~~\n"):
        assert d.with_verify(plain + fenced) == 2, fenced
    assert d.with_verify("template: Verdict: PASS | FAIL\n") == 2
    assert d.with_verify("") == 2


def test_docs_the_final_run_must_pass_every_outcome_of_the_task(tmp_path, capsys):
    d = DocsRepo(tmp_path)
    assert d.with_verify(VERIFY) == 0
    row = "| X3 | shows c | t | p | **PASS** |\n"
    assert row in VERIFY
    capsys.readouterr()
    assert d.with_verify(VERIFY.replace(row, "")) == 2  # the frontend outcome was never verified, whatever the prose says
    assert "no result row for outcome(s) X3" in capsys.readouterr().err
    assert d.with_verify(VERIFY.replace(row, "Frontend not verified (deferred).\n")) == 2
    for result in ("FAIL", "**FAIL** (B1, M1)", "PARTIAL", "not verified", "NOT VERIFIED", "n/a", "", "PASS/FAIL", "FAIL (was PASS)", "PASSED?", "pass",
                   "PASS for content; FAIL for layout", "PASS (PARTIAL: backend only)", "PASS-ish", "~PASS", "PASS**FAIL**"):
        assert d.with_verify(VERIFY.replace(row, f"| X3 | shows c | t | p | {result} |\n")) == 2, result
    for result in ("PASS", "**PASS**", "PASS (R4, low-medium)", "**PASS** (m1, m2)", "PASS. The implementation is correct; the test is weak",
                   "PASS; gaps F2, F6", "PASS, tight"):
        assert d.with_verify(VERIFY.replace(row, f"| X3 | shows c | t | p | {result} |\n")) == 0, result
    assert d.with_verify(VERIFY.replace(row, row + "| X3 | shows c, second probe | t | p | FAIL |\n")) == 2
    # the table of an earlier run does not count for the final run
    table = VERIFY.split("## Outcomes\n")[1].split("## Real output")[0]
    earlier = VERIFY.replace("## Real output", "## Run 2\nVerifier run: 2026-11-21, commit {sha}\nRe-ran the suite; nothing else.\n## Real output")
    assert d.with_verify(earlier) == 2
    assert d.with_verify(earlier.replace("Re-ran the suite; nothing else.\n", table)) == 0
    assert d.with_verify(VERIFY.replace(table, "All three outcomes pass.\n")) == 2
    # a task without outcome IDs cannot be covered
    d.task.write_text(TASK.format(status="DONE").replace("- X1. does a\n- X2. does b\n", "").replace("- X3. shows c\n", "prose only\n"))
    assert d.with_verify(VERIFY) == 2


def test_docs_done_fails_when_owned_files_changed_after_the_verified_commit(tmp_path, capsys):
    d = DocsRepo(tmp_path)
    assert d.gate() == 0
    (d.root / "unrelated.txt").write_text("changed\n")             # not owned by the task
    (d.root / "tasks/01-x/notes.md").write_text("n\n")
    assert d.gate() == 0
    (d.root / "src/x/code.py").write_text("a = 2\n")               # owned, uncommitted
    capsys.readouterr()
    assert d.gate() == 2
    assert f"changed after the verified commit {d.sha}: src/x/code.py" in capsys.readouterr().err
    new_sha = d.commit("fix round after the verdict")              # owned, committed: HEAD moved past the verdict
    assert d.gate() == 2
    d.sha = new_sha                                                # re-verified at the new commit
    assert d.with_verify(VERIFY) == 0
    (d.root / "src/x/new_module.py").write_text("c = 3\n")         # owned, untracked
    assert d.gate() == 2
    (d.root / "src/x/new_module.py").unlink()
    (d.root / "lib/y.py").unlink()                                 # second owned path, deleted
    assert d.gate() == 2
    git(d.root, "checkout", "-q", "--", "lib/y.py")
    assert d.gate() == 0
    # the commit must be named, singular, and exist
    for run_line in ("Verifier run: 2026-11-20", "Verifier run: 2026-11-20, commits 76b1908 → fcf812d", "Verified on 2026-11-20, commit {sha}",
                     "Verifier run: 2026-11-20, commit deadbeefdeadbeef", "Verifier run: 2026-11-20, commit HEAD"):
        assert d.with_verify(VERIFY.replace("Verifier run: 2026-11-20, commit {sha}", run_line)) == 2, run_line
    assert d.with_verify(VERIFY.replace("commit {sha}", "commit `{sha}` + working tree")) == 0


def test_docs_done_needs_owned_paths_that_exist(tmp_path, capsys):
    d = DocsRepo(tmp_path)
    owner = "engineer (`src/x/`) and reviewer (`lib/y.py`)"
    for bad in ("orchestrator", "engineer (`src/typo/`)", "engineer (`src/x/`, `../elsewhere`)", "engineer (`/etc`)", "engineer (src/x/)"):
        d.task.write_text(TASK.format(status="DONE").replace(owner, bad))
        assert d.gate() == 2, bad
    # an absolute or climbing Owner path is refused as such (it would otherwise reach git diff, or exist outside the repo)
    for bad in ("`/etc`", "`../elsewhere`", "`C:/Windows`"):
        d.task.write_text(TASK.format(status="DONE").replace(owner, f"engineer (`src/x/`, {bad})"))
        capsys.readouterr()
        assert d.gate() == 2 and "must be relative to the repository root" in capsys.readouterr().err, bad
    d.task.write_text(TASK.format(status="DONE"))
    assert d.gate() == 0


def test_docs_owner_and_outcomes_count_as_they_were_at_the_verified_commit(tmp_path, capsys):
    # RV-G6: dropping a changed path from Owner in the same edit that flips the status made a stale verdict current.
    d = DocsRepo(tmp_path / "owner")
    assert d.gate() == 0
    (d.root / "lib/y.py").write_text("b = 2\n")
    d.task.write_text(TASK.format(status="DONE").replace(" and reviewer (`lib/y.py`)", ""))
    capsys.readouterr()
    assert d.gate() == 2 and "changed after the verified commit" in capsys.readouterr().err
    d.commit("drop lib/y.py from Owner")
    assert d.gate() == 2
    # ... and an outcome dropped after the verdict still needs its PASS row from that verdict
    d = DocsRepo(tmp_path / "outcome")
    row = "| X3 | shows c | t | p | **PASS** |\n"
    d.task.write_text(TASK.format(status="DONE").replace("- X3. shows c\n", ""))
    capsys.readouterr()
    assert d.with_verify(VERIFY.replace(row, "")) == 2 and "no result row for outcome(s) X3" in capsys.readouterr().err
    assert d.with_verify(VERIFY) == 0
    # a TASK.md that did not exist at the verified commit cannot have been verified there
    (d.root / "tasks/02-y").mkdir()
    (d.root / "tasks/02-y/TASK.md").write_text(TASK.format(status="DONE"))
    (d.root / "tasks/02-y/VERIFY.md").write_text(VERIFY.format(sha=d.sha))
    capsys.readouterr()
    assert d.gate() == 2 and "tasks/02-y/TASK.md cannot be read at the verified commit" in capsys.readouterr().err


def test_docs_gate_needs_at_least_one_task_and_a_git_that_can_diff(tmp_path, monkeypatch, capsys):
    empty = tmp_path / "empty"
    (empty / "tasks").mkdir(parents=True)
    for f in check_docs.REQUIRED:
        (empty / f).write_text("x\n")
    check_docs.ROOT = empty
    try:
        assert check_docs.main() == 2 and "no tasks/<feature>/TASK.md files found" in capsys.readouterr().err  # P36
    finally:
        check_docs.ROOT = ROOT
    d = DocsRepo(tmp_path / "repo")
    assert d.gate() == 0
    real_git = shutil.which("git", path=SYS_PATH)
    fake = f"#!/bin/sh\ncase \" $* \" in *' diff '*) echo 'fatal: diff broke' >&2; exit 1;; esac\nexec {real_git} \"$@\"\n"
    with monkeypatch.context() as m:
        m.setenv("PATH", _bin_without_git(tmp_path / "repo", fake))
        capsys.readouterr()
        assert d.gate() == 2 and "git could not compare the task's files" in capsys.readouterr().err
    assert d.gate() == 0


def test_verifier_instructions_match_the_docs_gate(tmp_path):
    text = (ROOT / ".claude/agents/verifier.md").read_text()
    # RV-G11: mutation probes run in a probe copy, never in the shared working tree
    step_c = text.split("   c. ", 1)[1].split("\n4. ", 1)[0]
    assert "probe-copy.sh" in step_c and "Revert" not in step_c and "git status" not in step_c
    # RV-G7: three things a verifier writes in good faith that block a genuine PASS are documented, and really block it
    d = DocsRepo(tmp_path)
    row = "| X2 | does b | t | p | PASS (tight, see finding 1) |\n"
    shapes = {
        "PASS (was FAIL in run 1)": VERIFY.replace(row, "| X2 | does b | t | p | PASS (was FAIL in run 1) |\n"),
        'beginning "Verifier run': VERIFY.replace("1. minor\n", "Verifier run 1 missed the fence case.\n"),
        "(`\\|` still splits the cell)": VERIFY.replace(row, "| X2 | does b | t | p | PASS (a \\| b) |\n"),
    }
    for documented, verify in shapes.items():
        assert documented in text, documented
        assert d.with_verify(verify) == 2, documented
    assert d.with_verify(VERIFY) == 0


def test_docs_done_when_git_or_history_is_unavailable(tmp_path, monkeypatch, capsys):
    # no .git and not a probe copy: fail
    plain = DocsRepo(tmp_path / "plain", with_git=False)
    assert plain.gate() == 2
    assert "not a git checkout" in capsys.readouterr().err
    # no .git in a probe copy (scripts/probe-copy.sh leaves the marker): a loud warning, the other rules still decide
    (plain.root / check_docs.PROBE_MARKER).write_text("")
    assert plain.gate() == 0
    captured = capsys.readouterr()
    assert "DOCS WARNING" in captured.err and "NOT checked" in captured.err and "docs: OK" in captured.out
    assert plain.with_verify(VERIFY.replace("Verdict: PASS\n", "Verdict: FAIL\n")) == 2
    assert plain.with_verify(VERIFY.replace("| X3 | shows c | t | p | **PASS** |\n", "")) == 2
    # a shallow clone (CI with fetch-depth: 1) does not hold the verified commit: fail
    full = DocsRepo(tmp_path / "full")
    (full.root / "unrelated.txt").write_text("later commit\n")
    full.commit("docs only")
    assert full.gate() == 0
    shallow = tmp_path / "shallow"
    git(tmp_path, "clone", "-q", "--depth", "1", f"file://{full.root}", str(shallow))
    shutil.copy(full.verify, shallow / "tasks/01-x/VERIFY.md")
    check_docs.ROOT = shallow
    try:
        assert check_docs.main() == 2
        assert "fetch-depth: 0" in capsys.readouterr().err
    finally:
        check_docs.ROOT = ROOT
    # .git exists but git is not installed, or fails: fail
    for name, fake in (("missing", None), ("fails", "#!/bin/sh\necho 'fatal: broken' >&2\nexit 128\n")):
        (tmp_path / name).mkdir()
        with monkeypatch.context() as m:
            m.setenv("PATH", _bin_without_git(tmp_path / name, fake))
            assert full.gate() == 2, name
    assert full.gate() == 0


def test_docs_gate_only_applies_the_verify_rules_to_done_tasks(tmp_path):
    for i, status in enumerate(("TODO", "IN-PROGRESS", "VERIFYING", "BLOCKED")):
        d = DocsRepo(tmp_path / str(i), status=status, with_git=False)
        assert d.with_verify("backend half only\nVerdict: FAIL\n") == 0, status
        d.verify.unlink()
        assert d.gate() == 0, status


def test_docs_gate_status_parsing_is_not_bypassable(tmp_path):
    for i, (status, expected) in enumerate([("`DONE`", 2), ("Done", 2), ("**DONE**", 2), ("done", 2), ("FINISHED", 2), ("", 2), ("TODO", 0), ("`TODO`", 0)]):
        d = DocsRepo(tmp_path / str(i), status=status, with_git=False)
        d.verify.unlink()
        assert d.gate() == expected, status
    d = DocsRepo(tmp_path / "twice", status="TODO", with_git=False)
    d.task.write_text(TASK.format(status="TODO") + "## Status\nDONE\n")
    assert d.gate() == 2
    d.task.write_text(TASK.format(status="TODO").replace("## Tests\n", ""))
    assert d.gate() == 2
    d.task.write_text(TASK.format(status="TODO"))
    (d.root / "status.md").write_text("  \n")
    assert d.gate() == 2


def test_docs_gate_exits_2_on_undecodable_files_and_unknown_flags(tmp_path):
    def gate(root, *args):
        r = run([sys.executable, "scripts/check_docs.py", *args], env={"PATH": SYS_PATH, "LABYRINTH_ROOT": str(root)})
        assert "Traceback" not in r.stderr, r.stderr
        return r

    d = DocsRepo(tmp_path)
    assert gate(d.root).returncode == 0
    assert gate(d.root, "--bogus").returncode == 2
    d.verify.write_bytes(b"\xff\xfe Verdict: PASS\n")
    r = gate(d.root)
    assert r.returncode == 2 and "VERIFY.md: not valid UTF-8" in r.stderr
    d.verify.write_text(VERIFY.format(sha=d.sha))
    (d.root / "status.md").write_bytes(b"\xff\xfe\n")
    assert gate(d.root).returncode == 2
    (d.root / "status.md").write_text("x\n")
    d.task.write_bytes(b"\xff## Status\nTODO\n")
    assert gate(d.root).returncode == 2
    assert gate(tmp_path / "nowhere").returncode == 2


# ============================== CI workflows ==============================

def _workflow(name):
    text = (ROOT / ".github/workflows" / name).read_text()
    return [line for line in text.splitlines() if not line.lstrip().startswith("#")]


def test_review_workflow_is_valid_and_keeps_the_secret_away_from_pr_code():
    lines = _workflow("claude-review.yml")
    code = "\n".join(lines)
    # SC-9: `secrets` is not available in `if:` (job or step level); the job maps it to an env flag instead.
    assert not [line for line in lines if re.match(r"\s*(?:-\s+)?if:", line) and "secrets" in line]
    assert "HAVE_KEY: ${{ secrets.ANTHROPIC_API_KEY != '' }}" in code
    steps = code.split("steps:", 1)[1]
    assert steps.count("if: env.HAVE_KEY == 'true'") == 3 and steps.count("- uses:") == 2 and "if: env.HAVE_KEY != 'true'" in steps
    # forks never see the secret; nothing in the job runs code from the pull request
    assert "pull_request_target" not in code and "pull_request:" in code
    assert "github.event.pull_request.head.repo.full_name == github.repository" in code
    assert code.count("secrets.") == 2 and "anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}" in code
    assert steps.count("run:") == 2 and "echo" in steps and not re.search(r"\b(npm|pip|pytest|bash|node|python3?)\b", steps)
    assert "persist-credentials: false" in steps  # the checkout leaves no token in .git/config
    # RV-G8: Claude Code would load the PR's own .claude/settings.json (hooks run scripts/hooks/*.py from the PR) and
    # .mcp.json in a job holding the key; they are deleted from the checkout before the action starts.
    drop = steps.index("run: rm -f .claude/settings.json .claude/settings.local.json .mcp.json")
    assert steps.index("actions/checkout@") < drop < steps.index("anthropics/claude-code-action@")


def test_ci_checks_out_full_history_and_runs_the_whole_gate():
    lines = _workflow("ci.yml")
    code = "\n".join(lines)
    assert "fetch-depth: 0" in code  # check_docs.py needs the commits VERIFY.md files name
    # every push and every pull request, with no branch or path filter
    on = code.split("\non:\n", 1)[1].split("\njobs:", 1)[0]
    assert [line.strip() for line in on.splitlines() if line.strip()] == ["push:", "pull_request:"]
    # the last step is exactly the whole gate, and nothing turns its failure into a success
    runs = [line.strip() for line in lines if re.match(r"\s*(?:-\s+)?run:", line)]
    assert runs[-1].lstrip("- ") == "run: bash scripts/verify.sh all"
    assert "continue-on-error" not in code and "||" not in code and "set +e" not in code and "if:" not in code


# ============================== live GX danger wording: backend vs renderer classifier ==============================
# cross-RX-9: renderer/src/lib/liveStatus.ts decides money safety (TERMINATE FAILED, TERMINATION PENDING, stop not
# confirmed) by substrings of the backend's free-text `reason`, and each side pins only its own copy. Only a gate
# under scripts/ may read both trees; it reads them as text (ast for Python) and never imports across.

LIVE_GX = ROOT / "main/labyrinth_main/features/live_gx"
LIVE_STATUS_TS = ROOT / "renderer/src/lib/liveStatus.ts"
# The classifier statements _renderer_danger_kind mirrors; if one changes, the mirror must change with it.
TS_CLASSIFIER = (
    "const upper = reason.toUpperCase();",
    "TERMINATION_MARKERS.find((m) => upper.includes(m)) ??",
    "(KILL_SWITCH_UNCONFIRMED.some((p) => upper.includes(p)) ? 'TERMINATE FAILED' : undefined);",
    "reason.toUpperCase().includes(STOP_REQUESTED.toUpperCase())",
    "kind: problem.marker === 'TERMINATE FAILED' ? 'terminate-failed' : 'termination-pending',",
    "if (s.status === 'ready' && stopUnconfirmed(s.data)) {",
)


def _backend_strings(path):
    """(module-level NAME = "..." constants, every other non-docstring string literal) of a backend file, via ast."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    consts = {t.id: n.value.value for n in tree.body if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant)
              and isinstance(n.value.value, str) for t in n.targets if isinstance(t, ast.Name)}
    docstrings = check_boundaries._docstring_nodes(tree)
    strings = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings]
    return consts, strings


def _ts_strings(text, name):
    m = re.search(rf"\bconst {name}\b[^=]*=\s*(\[[^\]]*\]|'[^'\n]*')", text)
    assert m, f"liveStatus.ts no longer declares {name}: update this gate together with the classifier"
    return re.findall(r"'([^'\n]*)'", m.group(1))


def _renderer_danger_kind(reason, ts):
    """Python mirror of liveStatus.ts terminationProblem + stopUnconfirmed + liveDanger for a ready snapshot's reason."""
    upper = reason.upper()
    marker = next((m for m in ts["TERMINATION_MARKERS"] if m in upper), None)
    if marker is None and any(p in upper for p in ts["KILL_SWITCH_UNCONFIRMED"]):
        marker = "TERMINATE FAILED"
    if marker:
        return "terminate-failed" if marker == "TERMINATE FAILED" else "termination-pending"
    return "stop-unconfirmed" if ts["STOP_REQUESTED"][0].upper() in upper else None


def test_renderer_classifies_every_backend_danger_wording():
    ts_text = LIVE_STATUS_TS.read_text(encoding="utf-8")
    flat = re.sub(r"\s+", "", ts_text)
    for statement in TS_CLASSIFIER:
        assert re.sub(r"\s+", "", statement) in flat, f"liveStatus.ts classifier changed ({statement}): update _renderer_danger_kind"
    ts = {name: _ts_strings(ts_text, name) for name in ("TERMINATION_MARKERS", "KILL_SWITCH_UNCONFIRMED", "STOP_REQUESTED")}
    orch, _ = _backend_strings(LIVE_GX / "orchestrator.py")
    _, modal = _backend_strings(LIVE_GX / "modal_backend.py")
    names = {"TERMINATE_FAILED": "terminate-failed", "TERMINATE_PENDING": "termination-pending", "TERMINATING": "termination-pending",
             "KILL_SWITCH_ONLY": "terminate-failed", "STOPPING": "stop-unconfirmed"}
    for name in names:
        assert name in orch, f"orchestrator.py no longer defines {name}: classify its replacement in liveStatus.ts and here"
    expected = {orch[name]: kind for name, kind in names.items()}
    # modal_backend.py: a kill switch that could not be set is never a confirmed stop (both wordings it writes)
    unset = [s for s in modal if re.search(r"kill switch could not be set", s, re.I)]
    assert len(unset) >= 2, unset
    expected.update({s.strip(" :("): "terminate-failed" for s in unset})
    for reason, kind in expected.items():
        assert _renderer_danger_kind(reason, ts) == kind, (reason, kind)
        # inside a reason as the orchestrator assembles it (the clause, then the failure and the rest)
        assert _renderer_danger_kind(f"{reason}: GPU 0 (bean) terminate unconfirmed. Session fell back to replay.", ts) == kind, reason
    # no marker the renderer looks for is one the backend never sends
    sent = [v.upper() for v in [*orch.values(), *modal]]
    for marker in [*ts["TERMINATION_MARKERS"], *ts["KILL_SWITCH_UNCONFIRMED"], *ts["STOP_REQUESTED"]]:
        assert any(marker.upper() in s for s in sent), f"liveStatus.ts matches {marker!r}, which no backend string contains"
    # and a settled reason is not a danger
    assert _renderer_danger_kind(orch["NO_REHEARSAL_LABEL"], ts) is None
