#!/usr/bin/env python3
"""Cross-platform entry point for the Claude Code Stop hook.

The real hook is scripts/hooks/stop_verify.sh (bash). This launcher only finds a bash to
run it with:

  POSIX    bash scripts/dev.sh bash scripts/hooks/stop_verify.sh
  Windows  wsl.exe -e bash scripts/dev.sh bash scripts/hooks/stop_verify.sh
           (the gates are bash + POSIX-signal tests, so they run inside WSL; decision D-020)

stdin (the hook JSON) is forwarded; stdout/stderr and the exit code come back unchanged, so
exit 2 still blocks the stop and feeds the failing stages to the agent (decision D-003).

If bash/WSL cannot be started at all the launcher exits 2 once with the reason, and exits 0
when Claude Code reports `stop_hook_active` (i.e. it already blocked once), so a machine
without WSL cannot trap a session forever.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INNER = ["bash", "scripts/dev.sh", "bash", "scripts/hooks/stop_verify.sh"]


def main() -> int:
    payload = sys.stdin.buffer.read()
    cmd = (["wsl.exe", "-e"] if os.name == "nt" else []) + INNER
    try:
        proc = subprocess.run(cmd, cwd=ROOT, input=payload, check=False)
    except OSError as exc:
        try:
            already_blocked = bool(json.loads(payload or b"{}").get("stop_hook_active"))
        except Exception:
            already_blocked = False
        sys.stderr.write(f"stop_launcher: cannot run {' '.join(cmd)}: {exc}\n")
        if already_blocked:
            sys.stderr.write("stop_launcher: releasing the stop; record the blocker in status.md.\n")
            return 0
        return 2
    return 0 if proc.returncode == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
