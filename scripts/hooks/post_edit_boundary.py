#!/usr/bin/env python3
"""Claude Code PostToolUse hook (Edit|Write|MultiEdit|Bash).

Reads the hook JSON on stdin, checks the edited file against the main/renderer
import ban, and exits 2 with the violation on stderr so the agent must fix it.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("LABYRINTH_ROOT") or Path(__file__).resolve().parents[2]).resolve()

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)  # not our concern; never block on malformed hook input
if payload.get("tool_name") == "Bash":
    # Shell edits (sed, heredocs, cp) bypass Edit/Write; rescan the whole repo (fast, <1 s).
    proc = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "check_boundaries.py")], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout)
        sys.exit(2)
    sys.exit(0)
path = (payload.get("tool_input") or {}).get("file_path") or ""
if not path:
    sys.exit(0)
p = Path(path)
try:
    rel = p.resolve().relative_to(ROOT)
except ValueError:
    sys.exit(0)
if not rel.parts or rel.parts[0] not in {"main", "renderer"}:
    sys.exit(0)
proc = subprocess.run(
    [sys.executable, str(Path(__file__).resolve().parents[1] / "check_boundaries.py"), str(p.resolve())],
    capture_output=True, text=True, check=False,
)
if proc.returncode != 0:
    sys.stderr.write(proc.stderr or proc.stdout)
    sys.exit(2)
sys.exit(0)
