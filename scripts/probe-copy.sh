#!/usr/bin/env bash
# Make an isolated, throwaway copy of the working tree for mutation probes.
#
#   scripts/probe-copy.sh <name>      prints the copy's path on stdout
#
# Verifiers and reviewers must never mutate the shared working tree: other agents are
# running tests in it at the same time. Mutate the copy instead, run the gates there
# (`cd <copy> && bash scripts/verify.sh renderer`), and delete it when done.
# The copy lives under $LABYRINTH_PROBE_DIR (default ~/.cache/labyrinth-probes/<name>) and has no .git.
# renderer/node_modules in the copy is a real directory holding one symlink per package, so
# `npm ci` or `rm -rf node_modules` inside a copy removes links, never the shared packages.
#
# Safety (review findings SC-10, RV-G19): the destination may not overlap the repo in either direction,
# and an existing destination is only replaced when it carries this script's marker file. Overlap is
# decided before anything is created, by identity (`-ef` on every existing ancestor) and by spelling
# without regard to letter case (the /mnt/c and /mnt/d DrvFs mounts are case-insensitive; on a
# case-sensitive disk this only adds a refusal).
#
# Exit codes: 0 ok, 2 bad invocation, unsafe destination or copy failure.
set -uo pipefail
MARKER=".labyrinth-probe-copy"
fail() { echo "probe-copy.sh: $*" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)" || fail "cannot resolve the repo root"
if [[ $# -ne 1 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
  fail "expected exactly one name matching [A-Za-z0-9][A-Za-z0-9_-]*"
fi
[[ -n "${LABYRINTH_PROBE_DIR:-}" || -n "${HOME:-}" ]] || fail "HOME is not set: set HOME or LABYRINTH_PROBE_DIR"
BASE="${LABYRINTH_PROBE_DIR:-$HOME/.cache/labyrinth-probes}"
BASE="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$BASE")" || fail "cannot resolve $BASE"
DEST="$BASE/$1"
# within A B: A is B or lies inside it - same spelling in any letter case, or B is A or one of A's existing ancestors.
within() {
  local a b p="$1"
  a="$(printf '%s/' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  b="$(printf '%s/' "$2" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  [[ "$a" == "$b"* ]] && return 0
  while [[ -n "$p" ]]; do
    [[ -e "$p" && "$p" -ef "$2" ]] && return 0
    [[ "$p" == "/" ]] && return 1
    p="$(dirname -- "$p")"
  done
  return 1
}
within "$DEST" "$ROOT" && fail "refusing: destination $DEST is the repo or inside it"
within "$ROOT" "$DEST" && fail "refusing: the repo is inside destination $DEST"
mkdir -p -- "$BASE" || fail "cannot create $BASE"
if [[ -L "$DEST" ]]; then fail "refusing: $DEST is a symlink"; fi
if [[ -e "$DEST" ]]; then
  [[ -f "$DEST/$MARKER" ]] || fail "refusing: $DEST exists and was not created by probe-copy.sh (no $MARKER)"
  rm -rf -- "$DEST" || fail "cannot remove the previous copy $DEST"
fi
mkdir -- "$DEST" && : >"$DEST/$MARKER" || fail "cannot create $DEST"
tar -C "$ROOT" \
    --exclude=.git --exclude=renderer/node_modules --exclude=renderer/dist --exclude=.venv \
    --exclude='*.bundle' --exclude=__pycache__ --exclude=.pytest_cache --exclude=.ruff_cache \
    --exclude=./.claude/state --exclude="./$MARKER" -cf - . \
  | tar -C "$DEST" -xf - || fail "copy failed"
if [[ -d "$ROOT/renderer/node_modules" ]]; then
  mkdir -- "$DEST/renderer/node_modules" || fail "cannot create node_modules in the copy"
  shopt -s nullglob
  links=("$ROOT"/renderer/node_modules/* "$ROOT/renderer/node_modules/.bin")
  for entry in "${links[@]}"; do
    [[ -e "$entry" ]] || continue
    ln -s -- "$entry" "$DEST/renderer/node_modules/" || fail "cannot link $(basename "$entry")"
  done
fi
echo "$DEST"
exit 0
