"""Tests for the gates themselves: every failure path must exit exactly 2."""
import json
import subprocess
import sys
from pathlib import Path

import check_boundaries
import check_docs

ROOT = Path(__file__).resolve().parents[2]


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False, **kw)


def test_boundary_self_test_catches_all_known_bypasses():
    assert check_boundaries.self_test() == 0
    assert len(check_boundaries.VIOLATIONS) >= 28


def test_boundary_each_violation_individually(tmp_path):
    root = tmp_path.resolve()
    for sub in ("renderer/src", "main/labyrinth_main", "contracts", "artifacts"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    for rel, body in check_boundaries.VIOLATIONS.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body.replace("{ROOT}", str(root)))
        assert check_boundaries.run([p], root) == 2, rel


def test_boundary_bad_flag_exits_2():
    assert run([sys.executable, "scripts/check_boundaries.py", "--nope"]).returncode == 2


def test_post_edit_hook_exits_2_on_violation_and_0_when_clean(tmp_path):
    # Runs against a throwaway repo (LABYRINTH_ROOT) so concurrent agents never see the planted file.
    root = tmp_path.resolve()
    for sub in ("renderer/src", "main/labyrinth_main"):
        (root / sub).mkdir(parents=True)
    bad = root / "renderer/src/bad.ts"
    bad.write_text("import x from '../../main/labyrinth_main/foo';\n")
    good = root / "renderer/src/good.ts"
    good.write_text("import React from 'react';\n")
    env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "LABYRINTH_ROOT": str(root)}
    hook = [sys.executable, str(ROOT / "scripts/hooks/post_edit_boundary.py")]
    r = run(hook, input=json.dumps({"tool_input": {"file_path": str(bad)}}), env=env)
    assert r.returncode == 2 and "BOUNDARY VIOLATION" in r.stderr
    assert run(hook, input=json.dumps({"tool_input": {"file_path": str(good)}}), env=env).returncode == 0
    r = run(hook, input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "x"}}), env=env)
    assert r.returncode == 2
    bad.unlink()
    assert run(hook, input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "x"}}), env=env).returncode == 0


def test_post_edit_hook_rescans_on_powershell_edits(tmp_path):
    # On the Windows checkout shell edits arrive as tool_name "PowerShell", not "Bash" (D-020).
    root = tmp_path.resolve()
    for sub in ("renderer/src", "main/labyrinth_main"):
        (root / sub).mkdir(parents=True)
    bad = root / "renderer/src/bad.ts"
    bad.write_text("import x from '../../main/labyrinth_main/foo';\n")
    (root / "renderer/src/good.ts").write_text("import React from 'react';\n")
    env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "LABYRINTH_ROOT": str(root)}
    hook = [sys.executable, str(ROOT / "scripts/hooks/post_edit_boundary.py")]
    payload = json.dumps({"tool_name": "PowerShell", "tool_input": {"command": "x"}})
    assert run(hook, input=payload, env=env).returncode == 2
    bad.unlink()
    assert run(hook, input=payload, env=env).returncode == 0


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


def _stop_launcher(tmp_path, verify_cmd):
    env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "LABYRINTH_VERIFY_CMD": verify_cmd, "LABYRINTH_TOOLS": str(tmp_path / "none"),
           "LABYRINTH_STATE_DIR": str(tmp_path), "LABYRINTH_MAX_STOP_BLOCKS": "5", "HOME": str(tmp_path)}
    return run([sys.executable, "scripts/hooks/stop_launcher.py"], input=json.dumps({"session_id": "launcher"}), env=env)


def test_stop_launcher_blocks_with_2_and_passes_with_0(tmp_path):
    r = _stop_launcher(tmp_path, "echo STAGE-FAILED; exit 2")
    assert r.returncode == 2 and "FAILED (exit 2)" in r.stderr and "STAGE-FAILED" in r.stderr
    assert _stop_launcher(tmp_path, "exit 1").returncode == 2  # any failure is 2, never another code
    assert _stop_launcher(tmp_path, "true").returncode == 0


def test_stop_launcher_without_a_shell_blocks_once_then_releases(tmp_path, monkeypatch):
    import importlib.util
    import io
    spec = importlib.util.spec_from_file_location("stop_launcher", ROOT / "scripts/hooks/stop_launcher.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    def call(payload, behaviour):
        monkeypatch.setattr(mod.subprocess, "run", behaviour)
        monkeypatch.setattr(mod.sys, "stdin", io.TextIOWrapper(io.BytesIO(payload)))
        return mod.main()

    def no_shell(*_a, **_k):
        raise FileNotFoundError("wsl.exe")

    def exits(code):
        return lambda *_a, **_k: subprocess.CompletedProcess([], code)

    first, again = b'{"session_id":"x"}', b'{"session_id":"x","stop_hook_active":true}'
    # The gate's own verdicts pass straight through and are never released.
    assert call(first, exits(0)) == 0
    assert call(first, exits(2)) == 2
    assert call(again, exits(2)) == 2
    # The gate did not run at all (no shell, broken WSL = 4294967295, script not found = 127, killed):
    # block once, release on the retry so a machine without a working WSL cannot trap a session (SC-12).
    for broken in (no_shell, exits(4294967295), exits(127), exits(1), exits(-9)):
        assert call(first, broken) == 2
        assert call(b"not json", broken) == 2
        assert call(again, broken) == 0


def test_setup_pins_versions_and_digests_and_installs_nothing_unchecked():
    text = (ROOT / "scripts/setup-dev.sh").read_text()
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert "sudo" not in code
    import re
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
    for rel in ("scripts/verify.sh", "scripts/dev.sh", "scripts/hooks/stop_verify.sh", "artifacts/manifest.json"):
        assert b"\r\n" not in (ROOT / rel).read_bytes(), rel


def test_verify_rejects_bad_invocations_with_2():
    for args in (["nope"], [""], ["main", "extra"]):
        assert run(["bash", "scripts/verify.sh", *args]).returncode == 2, args


def _stop(tmp_path, verify_cmd, session="s1", max_blocks="2"):
    env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "LABYRINTH_VERIFY_CMD": verify_cmd,
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
    assert _stop(tmp_path, "true").returncode == 0


def _docs_tree(tmp_path, status, verify_text=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    for f in check_docs.REQUIRED:
        (tmp_path / f).write_text("x\n")
    t = tmp_path / "tasks/01-x"
    t.mkdir(parents=True)
    (t / "TASK.md").write_text(f"# x\n## Owner\no\n## Expected outcome\ne\n## Tests\nt\n## Status\n{status}\n")
    if verify_text is not None:
        (t / "VERIFY.md").write_text(verify_text)
    check_docs.ROOT = tmp_path
    try:
        return check_docs.main()
    finally:
        check_docs.ROOT = ROOT


def test_docs_gate_requires_final_verdict_line(tmp_path):
    assert _docs_tree(tmp_path / "a", "DONE", "x\nVerdict: PASS\n") == 0
    assert _docs_tree(tmp_path / "b", "DONE", "template: Verdict: PASS | FAIL\n") == 2
    assert _docs_tree(tmp_path / "c", "DONE", "Verdict: PASS\nlater re-run\nVerdict: FAIL\n") == 2
    assert _docs_tree(tmp_path / "d", "DONE", None) == 2
    assert _docs_tree(tmp_path / "e", "DONE", "Verdict: PASS\nre-run\nVerdict: FAIL — boundary bypass N1\n") == 2
    assert _docs_tree(tmp_path / "f", "DONE", "x\n```\nVerdict: PASS\n```\nVerdict: FAIL\n") == 2
    assert _docs_tree(tmp_path / "g", "DONE", "x\n```\nVerdict: PASS\n```\n") == 2
    assert _docs_tree(tmp_path / "h", "DONE", "Verdict: PASS — all outcomes hold\n") == 0
    assert _docs_tree(tmp_path / "i", "DONE", "Verdict: PASS | FAIL\n") == 2
    assert _docs_tree(tmp_path / "j", "DONE", "x\n~~~\nVerdict: PASS\n~~~\n") == 2
    assert _docs_tree(tmp_path / "k", "DONE", "F4–F5 not yet built\nVerdict: PASS\n") == 2
    assert _docs_tree(tmp_path / "l", "VERIFYING", "backend half only\nVerdict: PASS\n") == 0


def test_docs_gate_status_parsing_is_not_bypassable(tmp_path):
    assert _docs_tree(tmp_path / "a", "`DONE`", None) == 2
    assert _docs_tree(tmp_path / "b", "Done", None) == 2
    assert _docs_tree(tmp_path / "c", "**DONE**", None) == 2
    assert _docs_tree(tmp_path / "d", "FINISHED", None) == 2
    assert _docs_tree(tmp_path / "e", "TODO", None) == 0


def test_boundary_zero_file_scan_is_an_error(tmp_path):
    assert check_boundaries.run([], tmp_path) == 2
