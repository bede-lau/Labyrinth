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

    def no_shell(*_a, **_k):
        raise FileNotFoundError("wsl.exe")

    monkeypatch.setattr(mod.subprocess, "run", no_shell)

    def call(payload):
        monkeypatch.setattr(mod.sys, "stdin", io.TextIOWrapper(io.BytesIO(payload)))
        return mod.main()

    assert call(b'{"session_id":"x"}') == 2
    assert call(b'{"session_id":"x","stop_hook_active":true}') == 0
    assert call(b"not json") == 2


def test_setup_and_env_scripts_never_leave_the_tools_dir_or_use_sudo():
    text = (ROOT / "scripts/setup-dev.sh").read_text()
    assert "sudo" not in text.replace("no sudo", "").replace("without sudo", "")
    assert "UV_NO_MODIFY_PATH=1" in text and "sha256sum -c" in text


def test_probe_copy_is_isolated_and_rejects_dangerous_names(tmp_path):
    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "LABYRINTH_PROBE_DIR": str(tmp_path / "probes")}
    for bad in ([], ["a", "b"], [".."], ["."], ["a/b"], ["-rf"], [""]):
        assert run(["bash", "scripts/probe-copy.sh", *bad], env=env).returncode == 2, bad
    r = run(["bash", "scripts/probe-copy.sh", "t1"], env=env)
    assert r.returncode == 0, r.stderr
    copy = Path(r.stdout.strip())
    assert copy == tmp_path / "probes" / "t1"
    assert (copy / "scripts/verify.sh").read_bytes() == (ROOT / "scripts/verify.sh").read_bytes()
    assert not (copy / ".git").exists()
    (copy / "status.md").write_text("mutated\n")  # mutating the copy must not touch the real tree
    assert (ROOT / "status.md").read_text() != "mutated\n"
    nm = copy / "renderer/node_modules"
    assert not nm.exists() or nm.is_symlink()


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
