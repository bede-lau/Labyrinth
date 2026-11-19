#!/usr/bin/env bash
# Claude Code Stop hook: the build -> check -> verify loop.
#
# When the agent tries to finish, run scripts/verify.sh. If it fails, exit 2 so
# Claude Code blocks the stop and feeds the failing output back to the agent,
# which must fix it and try again. That is the loop.
#
# Verification is skipped only when the tree is clean AND HEAD is the commit that
# last verified green (so committed-but-broken code is still caught).
#
# Safety valve: after MAX consecutive blocked stops in the same session the hook
# lets the agent stop (exit 0) so a genuinely external blocker (no network,
# missing credential) cannot trap a session forever. The counter is per session
# and resets on the first green run.
#
# Env: LABYRINTH_MAX_STOP_BLOCKS (default 6); LABYRINTH_VERIFY_CMD (default
# "bash scripts/verify.sh all", overridable for tests).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${LABYRINTH_STATE_DIR:-$ROOT/.claude/state}"
MAX="${LABYRINTH_MAX_STOP_BLOCKS:-6}"
VERIFY_CMD="${LABYRINTH_VERIFY_CMD:-bash $ROOT/scripts/verify.sh all}"
mkdir -p "$STATE_DIR"

PAYLOAD="$(cat)"
SESSION="$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys,re
try: s=json.load(sys.stdin).get("session_id") or "default"
except Exception: s="default"
print(re.sub(r"[^A-Za-z0-9_.-]","_",str(s))[:80])' 2>/dev/null || echo default)"
COUNTER="$STATE_DIR/stop_blocks.$SESSION"
LAST_GREEN="$STATE_DIR/last_green_head"

HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo none)"
if [[ -z "$(git -C "$ROOT" status --porcelain 2>/dev/null)" && "$HEAD" == "$(cat "$LAST_GREEN" 2>/dev/null)" ]]; then
  echo 0 >"$COUNTER"; exit 0
fi

OUT="$(cd "$ROOT" && eval "$VERIFY_CMD" 2>&1)"
CODE=$?
if [[ $CODE -eq 0 ]]; then
  echo 0 >"$COUNTER"
  [[ -z "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]] && echo "$HEAD" >"$LAST_GREEN"
  exit 0
fi

n=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$COUNTER"
if (( n > MAX )); then
  echo 0 >"$COUNTER"
  echo "stop_verify: verify still failing after $MAX attempts; releasing the stop. Record the blocker in status.md." >&2
  exit 0
fi
{
  echo "scripts/verify.sh FAILED (exit $CODE) — attempt $n/$MAX. Fix these before stopping:"
  echo "$OUT" | grep -E '^(━━━|  (PASS|FAIL)|FAIL|ERROR|BOUNDARY|DOCS|ARTIFACT|verify\.sh)|error|Error|assert' | tail -60
  echo "--- tail of raw output ---"
  echo "$OUT" | tail -40
} >&2
exit 2
