#!/usr/bin/env bash
# Make an isolated, throwaway copy of the working tree for mutation probes.
#
#   scripts/probe-copy.sh <name>      prints the copy's path on stdout
#
# Verifiers and reviewers must never mutate the shared working tree: other agents are
# running tests in it at the same time. Mutate the copy instead, run the gates there
# (`cd <copy> && bash scripts/verify.sh renderer`), and delete it when done.
# The copy lives under $LABYRINTH_PROBE_DIR (default ~/.cache/labyrinth-probes/<name>), has no
# .git, and shares renderer/node_modules through a symlink (never edit inside node_modules).
#
# Exit codes: 0 ok, 2 bad invocation or copy failure.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 1 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
  echo "probe-copy.sh: expected exactly one name matching [A-Za-z0-9][A-Za-z0-9_-]*" >&2
  exit 2
fi
BASE="${LABYRINTH_PROBE_DIR:-$HOME/.cache/labyrinth-probes}"
DEST="$BASE/$1"
mkdir -p "$BASE" || { echo "probe-copy.sh: cannot create $BASE" >&2; exit 2; }
rm -rf "$DEST" && mkdir "$DEST" || { echo "probe-copy.sh: cannot reset $DEST" >&2; exit 2; }
tar -C "$ROOT" \
    --exclude=./.git --exclude=./renderer/node_modules --exclude=./renderer/dist \
    --exclude='*.bundle' --exclude=__pycache__ --exclude=.pytest_cache --exclude=.ruff_cache \
    --exclude=./.claude/state -cf - . \
  | tar -C "$DEST" -xf - || { echo "probe-copy.sh: copy failed" >&2; exit 2; }
if [[ -d "$ROOT/renderer/node_modules" ]]; then
  ln -s "$ROOT/renderer/node_modules" "$DEST/renderer/node_modules" || { echo "probe-copy.sh: cannot link node_modules" >&2; exit 2; }
fi
echo "$DEST"
exit 0
