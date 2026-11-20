#!/usr/bin/env python3
"""Claude Code PostToolUse hook (Edit|Write|MultiEdit|Bash|PowerShell).

Reads the hook JSON on stdin and checks the main/renderer boundary with scripts/check_boundaries.py:

  Edit / Write / MultiEdit   the edited file, when it is under main/ or renderer/
  Bash / PowerShell          the whole repo: shell edits (sed, heredocs, cp) bypass Edit/Write
  anything it cannot read    the whole repo (malformed JSON, no file_path): fail closed, never a silent 0

Exit codes: 0 = clean, 2 = violation or internal error, with the reason on stderr so the agent must fix
it. Nothing else (decision D-003): an exception here must not surface as Python's exit 1, which Claude
Code treats as non-blocking.

The file path may arrive in any spelling of the checkout (D:\\repo\\..., /mnt/d/repo/...); it is
mapped with the scanner's own pure-string logic, so the hook gives the same verdict under native Windows
Python and under WSL (review finding SC-11).
"""
import json
import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    import check_boundaries as cb  # honours LABYRINTH_ROOT (gate tests only)

    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))  # tolerate a BOM (PowerShell pipes add one)
    except Exception:
        payload = None
    if not isinstance(payload, dict):
        return cb.run(None, cb.ROOT)
    tool_input = payload.get("tool_input")
    path = tool_input.get("file_path") if isinstance(tool_input, dict) else None
    if payload.get("tool_name") in {"Bash", "PowerShell"} or not isinstance(path, str) or not path:
        return cb.run(None, cb.ROOT)
    root = str(cb.ROOT)
    rel = cb.rel_of(path, root)
    if rel is None:
        rel = cb.rel_of(os.path.abspath(path), root)
    side = rel.split("/", 1)[0] if rel else ""
    if side not in cb.SIDES:
        if side.lower() in cb.SIDES:
            # 'Renderer\\src\\bad.ts': on a case-insensitive disk (Windows, DrvFs) that IS renderer/ - scan
            # everything rather than guess the on-disk spelling (review finding RV-G4)
            return cb.run(None, cb.ROOT)
        return 0  # outside main/ and renderer/: nothing to check
    target = os.path.join(root, *rel.split("/"))
    if not os.path.lexists(target):
        return 0  # the edit removed the file
    return cb.run([Path(target)], cb.ROOT)


if __name__ == "__main__":
    try:
        code = main()
    except Exception:
        traceback.print_exc()
        print("post_edit_boundary: internal error - the boundary was NOT verified. Exiting 2.", file=sys.stderr)
        code = 2
    sys.exit(0 if code == 0 else 2)
