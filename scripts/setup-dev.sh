#!/usr/bin/env bash
# One-time toolchain setup for a Linux/WSL x86-64 machine without sudo.
#
#   bash scripts/setup-dev.sh
#
# Installs under $LABYRINTH_TOOLS (default ~/.local/share/labyrinth) and nowhere else:
#   bin/uv   uv $UV_VERSION     release tarball from github.com/astral-sh/uv
#   venv/    Python venv with main/requirements.txt (pinned) from PyPI
#   node/    Node.js $NODE_VERSION  tarball from nodejs.org/dist
# and runs `npm ci` for renderer/ when node_modules is missing or older than the lockfile.
# Re-running is safe; finished steps are skipped.
# Use the result through scripts/dev.sh.
#
# Versions AND sha256 digests are pinned here (review finding SC-13): a download is only
# unpacked if it matches the digest in this file, so a changed upstream file or a moved
# "latest" pointer fails loudly instead of installing something unreviewed. To upgrade,
# change the version and its digest together in one reviewed commit.
# Each tool is unpacked into a temporary directory and moved into place only when complete,
# so an interrupted run never leaves a half-installed tool that a re-run would skip.
#
# Exit codes: 0 ok, 2 any failure (same convention as every other gate, decision D-003).
set -uo pipefail
fail() { echo "setup-dev.sh: $*" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || fail "cannot resolve the repo root"
[[ -n "${LABYRINTH_TOOLS:-}" || -n "${HOME:-}" ]] || fail "HOME is not set: set HOME or LABYRINTH_TOOLS"  # never set -u's exit 1 (RV-G20)
TOOLS="${LABYRINTH_TOOLS:-$HOME/.local/share/labyrinth}"

UV_VERSION="0.13.9"
UV_FILE="uv-x86_64-unknown-linux-gnu.tar.gz"
UV_SHA256="a7fbaff2b9a271d85c1bdb540941090fd1ce011797b4abeb48e4dcd39c2471d5"
NODE_VERSION="v22.23.5"
NODE_FILE="node-${NODE_VERSION}-linux-x64.tar.xz"
NODE_SHA256="cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8"

[[ "$(uname -s)-$(uname -m)" == "Linux-x86_64" ]] || fail "pinned downloads are for Linux x86_64, this is $(uname -s)-$(uname -m)"

# ---- hooks need a native python3 on Windows (review findings SC-11, RV-G10) --------
# .claude/settings.json starts both hooks with `python3 -c ...` from the host shell. Under WSL the
# host is Windows: without a native python3 there, the Stop gate would fail open (exit 1 does not block).
# `command -v python3.exe` is not enough: the WindowsApps App Execution Alias exists even when no Python
# is installed (the Store stub exits 9009), so the interpreter must really run. Checked before anything
# is installed. LABYRINTH_PROC_VERSION exists for the gate tests only.
if grep -qi microsoft "${LABYRINTH_PROC_VERSION:-/proc/version}" 2>/dev/null; then
  if ! command -v python3.exe >/dev/null 2>&1; then
    fail "WSL detected but Windows has no python3.exe on PATH: the Claude Code hooks (Stop gate, boundary hook) would not run. Install Python for Windows, then re-run."
  fi
  if ! python3.exe -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
    fail "python3.exe ($(command -v python3.exe)) does not run Python 3.8+ (the Microsoft Store alias stub?): the Claude Code hooks would not run. Install Python for Windows, then re-run."
  fi
  echo "native Windows python3 for hooks: $(command -v python3.exe)"
fi

mkdir -p "$TOOLS/bin" || fail "cannot create $TOOLS"
TMP="$(mktemp -d "$TOOLS/.setup.XXXXXX")" || fail "mktemp failed"
trap 'rm -rf "$TMP"' EXIT

# fetch <url> <file> <sha256>: download into $TMP and verify against the pinned digest.
fetch() {
  curl -fsSL "$1" -o "$TMP/$2" || fail "cannot download $1"
  echo "$3  $TMP/$2" | sha256sum -c - >/dev/null || fail "sha256 mismatch for $2 (expected $3)"
  echo "$2: sha256 OK"
}

# ---- uv ---------------------------------------------------------------------
if [[ ! -x "$TOOLS/bin/uv" || "$("$TOOLS/bin/uv" --version 2>/dev/null | awk '{print $2}')" != "$UV_VERSION" ]]; then
  echo "━━━ installing uv $UV_VERSION into $TOOLS/bin"
  fetch "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_FILE}" "$UV_FILE" "$UV_SHA256"
  mkdir "$TMP/uv" && tar -xzf "$TMP/$UV_FILE" -C "$TMP/uv" --strip-components=1 || fail "cannot extract $UV_FILE"
  mv -f "$TMP/uv/uv" "$TOOLS/bin/uv" || fail "cannot install uv"
fi
"$TOOLS/bin/uv" --version || fail "uv is not runnable"

# ---- python venv --------------------------------------------------------------
if [[ ! -x "$TOOLS/venv/bin/python3" ]]; then
  echo "━━━ creating venv at $TOOLS/venv"
  rm -rf "$TOOLS/venv"
  "$TOOLS/bin/uv" venv --seed --python "$(command -v python3)" "$TOOLS/venv" || fail "venv creation failed"
fi
echo "━━━ installing main/requirements.txt"
"$TOOLS/bin/uv" pip install --python "$TOOLS/venv/bin/python3" -r "$ROOT/main/requirements.txt" \
  || fail "pip install failed"

# ---- node ---------------------------------------------------------------------
if [[ ! -x "$TOOLS/node/bin/node" || "$("$TOOLS/node/bin/node" --version 2>/dev/null)" != "$NODE_VERSION" ]]; then
  echo "━━━ installing Node.js $NODE_VERSION into $TOOLS/node"
  fetch "https://nodejs.org/dist/${NODE_VERSION}/${NODE_FILE}" "$NODE_FILE" "$NODE_SHA256"
  mkdir "$TMP/node" && tar -xJf "$TMP/$NODE_FILE" -C "$TMP/node" --strip-components=1 || fail "cannot extract $NODE_FILE"
  rm -rf "$TOOLS/node" && mv "$TMP/node" "$TOOLS/node" || fail "cannot install node"
fi
PATH="$TOOLS/node/bin:$PATH"; export PATH
node --version || fail "node is not runnable"

# ---- renderer deps -------------------------------------------------------------
# `npm ci` deletes node_modules first. Other agents may be running tests out of it, so only do that
# when the installed tree is older than the lockfile (or missing). Delete node_modules to force it.
INSTALLED="$ROOT/renderer/node_modules/.package-lock.json"
if [[ -f "$INSTALLED" && ! "$ROOT/renderer/package-lock.json" -nt "$INSTALLED" ]]; then
  echo "━━━ renderer/node_modules is current with package-lock.json; skipping npm ci"
else
  echo "━━━ npm ci (renderer)"
  npm --prefix "$ROOT/renderer" ci --no-audit --no-fund || fail "npm ci failed"
fi

echo "setup-dev.sh: done. Run gates with: scripts/dev.sh bash scripts/verify.sh all"
exit 0
