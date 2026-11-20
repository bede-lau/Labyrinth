#!/usr/bin/env bash
# One-time toolchain setup for a Linux/WSL machine without sudo.
#
#   bash scripts/setup-dev.sh
#
# Installs, under $LABYRINTH_TOOLS (default ~/.local/share/labyrinth), nothing system-wide:
#   bin/uv        the uv installer from https://astral.sh/uv (no shell-profile edits)
#   venv/         Python venv with main/requirements.txt (pinned) from PyPI
#   node/         Node.js 22 LTS from https://nodejs.org/dist (sha256-checked)
# and runs `npm ci` for renderer/. Re-running is safe; finished steps are skipped.
# Use the result through scripts/dev.sh.
#
# Exit codes: 0 ok, 2 any failure (same convention as every other gate, decision D-003).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="${LABYRINTH_TOOLS:-$HOME/.local/share/labyrinth}"
NODE_MAJOR=22
fail() { echo "setup-dev.sh: $*" >&2; exit 2; }
mkdir -p "$TOOLS/bin" || fail "cannot create $TOOLS"

# ---- uv ---------------------------------------------------------------------
if [[ ! -x "$TOOLS/bin/uv" ]]; then
  echo "━━━ installing uv into $TOOLS/bin"
  curl -LsSf https://astral.sh/uv/install.sh \
    | env UV_INSTALL_DIR="$TOOLS/bin" UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 sh \
    || fail "uv install failed"
fi
"$TOOLS/bin/uv" --version || fail "uv is not runnable"

# ---- python venv --------------------------------------------------------------
if [[ ! -x "$TOOLS/venv/bin/python3" ]]; then
  echo "━━━ creating venv at $TOOLS/venv"
  "$TOOLS/bin/uv" venv --seed --python "$(command -v python3)" "$TOOLS/venv" || fail "venv creation failed"
fi
echo "━━━ installing main/requirements.txt"
"$TOOLS/bin/uv" pip install --python "$TOOLS/venv/bin/python3" -r "$ROOT/main/requirements.txt" \
  || fail "pip install failed"

# ---- node ---------------------------------------------------------------------
if [[ ! -x "$TOOLS/node/bin/node" ]]; then
  echo "━━━ installing Node.js $NODE_MAJOR into $TOOLS/node"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  tmp="$(mktemp -d)" || fail "mktemp failed"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" || fail "cannot fetch node checksums"
  file="$(grep -oE "node-v${NODE_MAJOR}\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)"
  [[ -n "$file" ]] || fail "no linux-x64 tarball listed at $base"
  curl -fsSL "$base/$file" -o "$tmp/$file" || fail "cannot download $file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -) || fail "sha256 mismatch for $file"
  mkdir -p "$TOOLS/node" && tar -xJf "$tmp/$file" -C "$TOOLS/node" --strip-components=1 || fail "cannot extract $file"
  rm -rf "$tmp"
fi
PATH="$TOOLS/node/bin:$PATH"; export PATH
node --version || fail "node is not runnable"

# ---- renderer deps -------------------------------------------------------------
echo "━━━ npm ci (renderer)"
npm --prefix "$ROOT/renderer" ci --no-audit --no-fund || fail "npm ci failed"

echo "setup-dev.sh: done. Run gates with: scripts/dev.sh bash scripts/verify.sh all"
exit 0
