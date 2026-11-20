#!/usr/bin/env bash
# Claude Code Stop hook: the build -> check -> verify loop.
#
# When the agent tries to finish, run scripts/verify.sh. If it fails, exit 2 so
# Claude Code blocks the stop and feeds the failing output back to the agent,
# which must fix it and try again. That is the loop.
#
# Last-green shortcut: verification is skipped only when git answers, the tree is clean AND HEAD is
# the commit that last verified green (so committed-but-broken code is still caught). If git fails
# for any reason (not a repository, git not installed, a broken index) the shortcut is off: the gate
# runs, and nothing is recorded as "last green" (review finding SC-1: a hook that cannot ask git must
# not conclude "clean tree, known commit").
#
# Safety valve: after MAX consecutive blocked stops in the same session the hook
# lets the agent stop (exit 0) so a genuinely external blocker (no network,
# missing credential) cannot trap a session forever. The counter is per session
# and resets on the first green run.
#
# Exit codes: 0 or 2, nothing else (decision D-003).
#
# Env: LABYRINTH_MAX_STOP_BLOCKS (default 6); LABYRINTH_VERIFY_CMD (default
# "bash scripts/verify.sh all", overridable for tests).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || { echo "stop_verify: cannot resolve the repository root" >&2; exit 2; }
STATE_DIR="${LABYRINTH_STATE_DIR:-$ROOT/.claude/state}"
MAX="${LABYRINTH_MAX_STOP_BLOCKS:-6}"
[[ "$MAX" =~ ^[0-9]+$ ]] || MAX=6
VERIFY_CMD="${LABYRINTH_VERIFY_CMD:-bash $ROOT/scripts/verify.sh all}"
mkdir -p "$STATE_DIR" 2>/dev/null

PAYLOAD="$(cat)"
SESSION="$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys,re
try: s=json.load(sys.stdin).get("session_id") or "default"
except Exception: s="default"
print(re.sub(r"[^A-Za-z0-9_.-]","_",str(s))[:80])' 2>/dev/null || echo default)"
COUNTER="$STATE_DIR/stop_blocks.${SESSION:-default}"
LAST_GREEN="$STATE_DIR/last_green_head"

# git_state prints "<HEAD sha> clean" or "<HEAD sha> dirty"; it fails when git cannot answer either question.
git_state() {
  local head dirty
  head="$(git -C "$ROOT" rev-parse --verify --quiet 'HEAD^{commit}' 2>/dev/null)" || return 1
  [[ "$head" =~ ^[0-9a-f]{40,64}$ ]] || return 1
  dirty="$(git -C "$ROOT" status --porcelain 2>/dev/null)" || return 1
  if [[ -z "$dirty" ]]; then echo "$head clean"; else echo "$head dirty"; fi
}

BEFORE="$(git_state)" || BEFORE=""
if [[ -n "$BEFORE" && "$BEFORE" == *" clean" && "${BEFORE%% *}" == "$(cat "$LAST_GREEN" 2>/dev/null)" ]]; then
  echo 0 >"$COUNTER"; exit 0
fi

OUT="$(cd "$ROOT" && eval "$VERIFY_CMD" 2>&1)"
CODE=$?
if [[ $CODE -eq 0 ]]; then
  echo 0 >"$COUNTER"
  # Record the commit only if git answered before and after, the tree was clean both times and HEAD did not move.
  AFTER="$(git_state)" || AFTER=""
  if [[ -n "$BEFORE" && "$BEFORE" == "$AFTER" && "$AFTER" == *" clean" ]]; then
    printf '%s\n' "${AFTER%% *}" >"$LAST_GREEN"
  fi
  exit 0
fi

n=$(cat "$COUNTER" 2>/dev/null || echo 0)
[[ "$n" =~ ^[0-9]+$ ]] || n=0
n=$(( n + 1 ))
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
