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
