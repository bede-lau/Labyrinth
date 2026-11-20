#!/usr/bin/env python3
"""Cross-platform entry point for the Claude Code Stop hook.

The real hook is scripts/hooks/stop_verify.sh (bash). This launcher only finds a bash to
run it with:

  POSIX    bash scripts/dev.sh bash scripts/hooks/stop_verify.sh
  Windows  wsl.exe -e bash scripts/dev.sh bash scripts/hooks/stop_verify.sh
           (the gates are bash + POSIX-signal tests, so they run inside WSL; decision D-020)

stdin (the hook JSON) is forwarded; stdout/stderr come back unchanged.

Exit codes (decision D-003: a gate answers 0 or 2, nothing else):
  0  the gate passed
  2  the gate failed (stop_verify.sh exited 2): the stop is blocked and the failing stages are
     fed back to the agent
The gate itself only ever exits 0 or 2. Anything else means the gate did not run at all: the
shell could not be started (OSError), WSL is broken (wsl.exe exits 4294967295), bash could not
find the script (127), the run was killed. That is an infrastructure failure, not a verdict:
the launcher blocks once with 2 and the reason, and releases with 0 when Claude Code reports
`stop_hook_active` (it already blocked once), so a machine without a working WSL cannot trap a
session forever (review finding SC-12). A working gate can never reach that branch.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INNER = ["bash", "scripts/dev.sh", "bash", "scripts/hooks/stop_verify.sh"]


def _infrastructure_failure(payload: bytes, reason: str) -> int:
    try:
        already_blocked = bool(json.loads(payload or b"{}").get("stop_hook_active"))
    except Exception:
        already_blocked = False
    sys.stderr.write(f"stop_launcher: the verify gate did not run: {reason}\n")
    if already_blocked:
        sys.stderr.write("stop_launcher: releasing the stop; record the blocker in status.md.\n")
        return 0
    return 2


def main() -> int:
    payload = sys.stdin.buffer.read()
    cmd = (["wsl.exe", "-e"] if os.name == "nt" else []) + INNER
    try:
        proc = subprocess.run(cmd, cwd=ROOT, input=payload, check=False)
    except OSError as exc:
        return _infrastructure_failure(payload, f"cannot run {' '.join(cmd)}: {exc}")
    if proc.returncode in (0, 2):
        return proc.returncode
    return _infrastructure_failure(payload, f"{' '.join(cmd)} exited {proc.returncode} (the gate only exits 0 or 2)")


if __name__ == "__main__":
    sys.exit(main())
