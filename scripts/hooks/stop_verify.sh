#!/usr/bin/env bash
# Claude Code Stop hook: the build -> check -> verify loop.
#
# When the agent tries to finish, run scripts/verify.sh. If it fails, exit 2 so
# Claude Code blocks the stop and feeds the failing output back to the agent,
# which must fix it and try again. That is the loop.
#
# Safety valve: after MAX consecutive blocked stops the hook lets the agent stop
# (exit 0) so a genuinely external blocker (no network, missing credential)
# cannot trap a session forever. The counter resets on the first green run.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$ROOT/.claude/state"
COUNTER="$STATE_DIR/stop_blocks"
MAX="${LABYRINTH_MAX_STOP_BLOCKS:-6}"
mkdir -p "$STATE_DIR"
cat >/dev/null  # drain hook JSON on stdin

# Nothing to verify if the tree is clean relative to HEAD and nothing is untracked.
if [[ -z "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]]; then
  echo 0 >"$COUNTER"; exit 0
fi

OUT="$(bash "$ROOT/scripts/verify.sh" all 2>&1)"
CODE=$?
if [[ $CODE -eq 0 ]]; then
  echo 0 >"$COUNTER"; exit 0
fi

n=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$COUNTER"
if (( n > MAX )); then
  echo 0 >"$COUNTER"
  echo "stop_verify: verify.sh still failing after $MAX attempts; releasing the stop. Record the blocker in status.md." >&2
  exit 0
fi
{
  echo "scripts/verify.sh FAILED (exit $CODE) — attempt $n/$MAX. Fix these before stopping:"
  echo "$OUT" | grep -E '^(━━━|  (PASS|FAIL)|FAIL|ERROR|BOUNDARY|DOCS|ARTIFACT|verify\.sh)|error|Error|assert' | tail -60
  echo "--- tail of raw output ---"
  echo "$OUT" | tail -40
} >&2
exit 2
