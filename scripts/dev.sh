#!/usr/bin/env bash
# Run a command with the project-local toolchain on PATH.
#
#   scripts/dev.sh <command> [args...]
#   e.g.  scripts/dev.sh bash scripts/verify.sh main
#
# The toolchain (Python venv + Node) is installed by scripts/setup-dev.sh under
# $LABYRINTH_TOOLS (default ~/.local/share/labyrinth). Where it does not exist (CI, a
# machine with python3/npm already on PATH) this is a transparent wrapper.
#
# On the maintainer's Windows machine everything runs inside WSL:
#   wsl.exe -e bash scripts/dev.sh bash scripts/verify.sh all
#
# Exit codes: the command's own; 2 if invoked without a command.
set -uo pipefail
TOOLS="${LABYRINTH_TOOLS:-$HOME/.local/share/labyrinth}"
[[ -d "$TOOLS/venv/bin" ]] && PATH="$TOOLS/venv/bin:$PATH"
[[ -d "$TOOLS/node/bin" ]] && PATH="$TOOLS/node/bin:$PATH"
[[ -d "$TOOLS/bin" ]] && PATH="$TOOLS/bin:$PATH"
export PATH
if [[ $# -eq 0 ]]; then
  echo "dev.sh: expected a command to run (e.g. scripts/dev.sh bash scripts/verify.sh all)" >&2
  exit 2
fi
exec "$@"
