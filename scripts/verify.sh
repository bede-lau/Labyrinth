#!/usr/bin/env bash
# Labyrinth build -> check -> verify gate.
#
#   scripts/verify.sh [all|main|renderer|boundary|artifacts|docs]   (default: all)
#
# Stages per scope (scripts/tests/test_gates.py holds this table and runs every scope against it):
#   boundary   boundary:self-test  boundary:scan  scripts:tests
#   docs       docs:handoff
#   artifacts  artifacts:schema  artifacts:fresh
#   main       boundary:self-test  boundary:scan  scripts:tests  main:lint  main:tests  artifacts:schema  artifacts:fresh
#   renderer   boundary:self-test  boundary:scan  [renderer:install]  renderer:typecheck  renderer:tests  renderer:build
#   all        boundary:self-test  boundary:scan  docs:handoff  scripts:tests  main:lint  main:tests
#              artifacts:schema  artifacts:fresh  [renderer:install]  renderer:typecheck  renderer:tests  renderer:build
#   (renderer:install runs only when renderer/node_modules does not exist.)
#
# Exit codes:
#   0  every requested stage passed
#   2  any stage failed, the script was invoked incorrectly, or $PYTHON is not a working Python.
#      Exit 2 is deliberate: Claude Code hooks treat it as "blocking error" and
#      feed stderr back to the agent, which must fix the problem and retry.
#
# Every stage prints its real command and real output. Nothing is summarised away.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || { echo "verify.sh: cannot resolve the repository root" >&2; exit 2; }
unset LABYRINTH_ROOT LABYRINTH_ARTIFACTS  # gates always check this repo; the overrides are for gate tests only
cd "$ROOT" || { echo "verify.sh: cannot enter $ROOT" >&2; exit 2; }
if [[ $# -gt 1 ]]; then echo "verify.sh: expected at most one scope argument, got $#" >&2; exit 2; fi
if [[ $# -eq 1 && -z "$1" ]]; then echo "verify.sh: empty scope argument" >&2; exit 2; fi
SCOPE="${1:-all}"
PY="${PYTHON:-python3}"

case "$SCOPE" in
  all|main|renderer|boundary|artifacts|docs) ;;
  *) echo "verify.sh: unknown scope '$SCOPE' (expected all|main|renderer|boundary|artifacts|docs)" >&2; exit 2 ;;
esac

# Every scope runs Python gates. The interpreter must really be one: with PYTHON=true (or any program
# that exits 0 without doing the work) each Python stage would "pass" having checked nothing.
PY_MARK="$("$PY" -c 'import sys; print("labyrinth-python-ok" if sys.version_info >= (3, 11) else "labyrinth-python-too-old")' 2>/dev/null)"
if [[ "$PY_MARK" != "labyrinth-python-ok" ]]; then
  echo "verify.sh: '$PY' is not a working Python >= 3.11 (got '${PY_MARK:-no answer}'). Run through scripts/dev.sh or set PYTHON. Exiting 2." >&2
  exit 2
fi

declare -a RESULTS=()
FAILED=0

stage() {
  local name="$1"; shift
  echo
  echo "━━━ [$name] \$ $*"
  local start=$SECONDS
  if "$@"; then
    RESULTS+=("PASS  $name ($((SECONDS-start))s)")
  else
    RESULTS+=("FAIL  $name ($((SECONDS-start))s)")
    FAILED=1
  fi
}

want() { [[ "$SCOPE" == "all" || "$SCOPE" == "$1" ]]; }

# ---- boundary: imports between main/ and renderer/ are banned -------------
if want boundary || want main || want renderer; then
  stage "boundary:self-test" "$PY" scripts/check_boundaries.py --self-test
  stage "boundary:scan"      "$PY" scripts/check_boundaries.py
fi

# ---- docs: handoff files must exist ---------------------------------------
if want docs; then
  stage "docs:handoff" "$PY" scripts/check_docs.py
fi

# ---- main (backend) --------------------------------------------------------
if want main || want boundary; then
  stage "scripts:tests" "$PY" -m pytest -q -p no:cacheprovider scripts/tests
fi
if want main; then
  stage "main:lint"  "$PY" -m ruff check main scripts
  stage "main:tests" "$PY" -m pytest -q main/tests
fi

# ---- artifacts: committed artifacts are fresh, deterministic, schema-valid -
if want artifacts || want main; then
  stage "artifacts:schema" "$PY" scripts/validate_artifacts.py
  stage "artifacts:fresh"  "$PY" scripts/validate_artifacts.py --check-fresh
fi

# ---- renderer (frontend) ---------------------------------------------------
if want renderer; then
  if [[ ! -d renderer/node_modules ]]; then
    stage "renderer:install" npm --prefix renderer ci --no-audit --no-fund
  fi
  stage "renderer:typecheck" npm --prefix renderer run -s typecheck
  stage "renderer:tests"     npm --prefix renderer run -s test
  stage "renderer:build"     npm --prefix renderer run -s build
fi

echo
echo "━━━ verify.sh summary (scope: $SCOPE)"
for r in "${RESULTS[@]}"; do echo "  $r"; done
if [[ $FAILED -ne 0 || ${#RESULTS[@]} -eq 0 ]]; then
  echo "verify.sh: FAILED — fix the stages above and re-run. Exiting 2." >&2
  exit 2
fi
echo "verify.sh: all stages passed."
exit 0
