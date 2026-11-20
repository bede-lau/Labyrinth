#!/usr/bin/env python3
"""Handoff-doc gate. Exit 0 = OK, 2 = any failure, bad invocation or internal error (decision D-003).

1. status.md, architecture.md, decision.md, CLAUDE.md exist and are non-empty.
2. Every tasks/<NN-feature>/TASK.md has the sections Owner, Expected outcome, Tests, Status, and exactly
   one "## Status" heading followed by one of TODO | IN-PROGRESS | VERIFYING | DONE | BLOCKED.
3. A task whose Status is DONE needs tasks/<NN-feature>/VERIFY.md holding a genuine, whole-task,
   current PASS from the external verifier:

   a. Verdict. Outside code fences, a "verdict line" is any line with the word "verdict" among its
      first three words (so `**Verdict: FAIL**`, `- Verdict: FAIL`, `Final verdict: PARTIAL` all are
      verdict lines). The LAST verdict line decides: it must be exactly `Verdict: PASS`, and it must be
      the last non-blank line of the file. FAILED, PARTIAL, a reason after PASS, or text after the
      verdict all fail.
   b. Coverage. The final run (everything after the last "Verifier run" line) must contain an outcome
      table (header row ending in `| Result |`) with a row for every outcome ID listed under TASK.md
      "## Expected outcome" (`- G7. ...` or `3. ...`), and in each of those rows the Result cell must
      start with the word `PASS` (a note may follow) and must not contain FAIL / FAILED / PARTIAL.
      A report that covers half a task has no PASS row for the other half, whatever words it uses.
   c. Currency. The last "Verifier run: <date>, commit <sha> ..." line names the commit the final run
      verified. The files the task owns - the backticked paths in TASK.md "## Owner"; at least one, each
      must exist - must be identical in that commit and in the working tree
      (`git diff <sha> -- <paths>` prints nothing and there is no untracked file under them).

   When git or history is unavailable:
     * `.git` exists but git cannot answer (git not installed, a shallow clone without <sha>, an
       unknown <sha>): the gate FAILS. CI checks out with full history (ci.yml, fetch-depth: 0).
     * no `.git`, in a copy made by scripts/probe-copy.sh (it leaves the marker file
       `.labyrinth-probe-copy`): currency cannot be checked; a DOCS WARNING goes to stderr and rules
       a and b still decide.
     * no `.git` anywhere else: the gate FAILS.

Usage: check_docs.py   (no arguments)
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(os.environ.get("LABYRINTH_ROOT") or Path(__file__).resolve().parent.parent).resolve()
REQUIRED = ["status.md", "architecture.md", "decision.md", "CLAUDE.md"]
STATES = {"TODO", "IN-PROGRESS", "VERIFYING", "DONE", "BLOCKED"}
SECTIONS = ["## Owner", "## Expected outcome", "## Tests", "## Status"]
PROBE_MARKER = ".labyrinth-probe-copy"

FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})")
VERDICT_LINE = re.compile(r"^\W*(?:\w+\W+){0,2}verdict\b", re.I)
RUN_LINE = re.compile(r"^[ \t>*_#-]*Verifier run\b", re.I)
RUN_COMMIT = re.compile(r"\bcommit\s+`?([0-9a-f]{7,40})`?(?![0-9a-zA-Z])", re.I)
OUTCOME_ID = re.compile(r"^[ \t]*(?:[-*+][ \t]+)?\**([A-Z]{0,3}\d{1,3}[a-z]?)\**[.)][ \t]")
TABLE_HEADER = re.compile(r"^[ \t]*\|.*\|[ \t*]*Result[ \t*]*\|[ \t]*$", re.I)
TABLE_ROW = re.compile(r"^[ \t]*\|[ \t*`]*([A-Z]{0,3}\d{1,3}[a-z]?)[ \t*`]*\|(?:.*\|)?([^|]*)\|[ \t]*$")
RESULT_PASS = re.compile(r"PASS(?:[\s.,;:(].*)?", re.S)  # first word exactly PASS, then an optional note
RESULT_NOT_PASS = re.compile(r"\b(?:FAIL|FAILED|FAILS|PARTIAL|PARTIALLY)\b")  # ... that does not take the PASS back


def _read(path: Path, errors: list[str]) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: not valid UTF-8")
    except OSError as e:
        errors.append(f"{path.relative_to(ROOT).as_posix()}: cannot be read ({e.strerror})")
    return None


def outside_fences(text: str) -> list[tuple[int, str]]:
    """(line number, line) for every line outside ``` / ~~~ fences. An unclosed fence runs to the end."""
    out, fence = [], None
    for n, line in enumerate(text.splitlines(), 1):
        m = FENCE.match(line)
        if fence is None:
            if m:
                fence = m.group(1)
            else:
                out.append((n, line))
        elif m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not line.strip().strip(fence[0]):
            fence = None
    return out


def _section(text: str, heading: str) -> str:
    m = re.search(rf"^{re.escape(heading)}[ \t]*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


def _git(*args: str) -> tuple[int, str, str]:
    try:
        p = subprocess.run(["git", "-C", str(ROOT), "-c", "core.quotepath=off", *args], capture_output=True, text=True, timeout=120, check=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, "", str(e)
    return p.returncode, p.stdout, p.stderr.strip()


def check_verdict(verify_text: str) -> list[str]:
    """Rule a: the last verdict line is exactly `Verdict: PASS` and nothing follows it."""
    lines = outside_fences(verify_text)
    verdicts = [(n, line) for n, line in lines if VERDICT_LINE.match(line)]
    if not verdicts:
        return ["has no verdict line outside code fences"]
    n, line = verdicts[-1]
    if line.rstrip() != "Verdict: PASS":
        return [f"final verdict line (line {n}) is {line.strip()[:80]!r}, not exactly 'Verdict: PASS'"]
    last = max((i for i, raw in enumerate(verify_text.splitlines(), 1) if raw.strip()), default=0)
    if n != last:
        return [f"'Verdict: PASS' (line {n}) is not the last line: text follows it (line {last})"]
    return []


def final_run(verify_text: str) -> tuple[list[tuple[int, str]], str | None]:
    """(lines of the final run, the commit it names or None). The final run starts at the last 'Verifier run' line."""
    lines = outside_fences(verify_text)
    starts = [i for i, (_, line) in enumerate(lines) if RUN_LINE.match(line)]
    if not starts:
        return [], None
    run = lines[starts[-1]:]
    m = RUN_COMMIT.search(run[0][1])
    return run, m.group(1).lower() if m else None


def check_coverage(task_text: str, run: list[tuple[int, str]]) -> list[str]:
    """Rule b: every outcome ID of the task has a PASS row in the final run's outcome table."""
    ids = []
    for line in _section(task_text, "## Expected outcome").splitlines():
        m = OUTCOME_ID.match(line)
        if m and m.group(1) not in ids:
            ids.append(m.group(1))
    if not ids:
        return ["TASK.md lists no outcome IDs under '## Expected outcome' ('- G1. ...' or '1. ...'), so coverage cannot be checked"]
    results: dict[str, list[str]] = {}
    in_table = False
    for _, line in run:
        if TABLE_HEADER.match(line):
            in_table = True
        elif in_table and line.lstrip().startswith("|"):
            m = TABLE_ROW.match(line)
            if m:
                results.setdefault(m.group(1), []).append(re.sub(r"[*`_]", "", m.group(2)).strip())
        else:
            in_table = False
    if not results:
        return ["final run has no outcome table (a header row ending in '| Result |' followed by one row per outcome)"]
    errors = []
    missing = [i for i in ids if i not in results]
    if missing:
        errors.append(f"final run has no result row for outcome(s) {', '.join(missing)}: the verdict does not cover the whole task")
    bad = [f"{i} = {r[:40]!r}" for i in ids for r in results.get(i, []) if not RESULT_PASS.fullmatch(r) or RESULT_NOT_PASS.search(r)]
    if bad:
        errors.append(f"final run does not pass every outcome ({'; '.join(bad)})")
    return errors


def owned_paths(task_text: str) -> tuple[list[str], list[str]]:
    """(owned repo-relative paths, errors) from the backticked paths in '## Owner'."""
    paths, errors = [], []
    for raw in re.findall(r"`([^`\n]+)`", _section(task_text, "## Owner")):
        p = raw.strip()
        if p.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", p) or ".." in re.split(r"[/\\]", p):
            errors.append(f"owned path `{p}` must be relative to the repository root")
        elif not (ROOT / p).exists():
            errors.append(f"owned path `{p}` does not exist")
        elif p.rstrip("/") not in paths:
            paths.append(p.rstrip("/"))
    if not paths and not errors:
        errors.append("TASK.md '## Owner' names no owned path in backticks, so the gate cannot tell whether the verdict is current")
    return paths, errors


def check_currency(rel: str, commit: str | None, paths: list[str]) -> list[str]:
    """Rule c: the owned files are the ones the final run verified."""
    if commit is None:
        return ["final 'Verifier run' line names no commit ('Verifier run: <date>, commit <sha>')"]
    if not (ROOT / ".git").exists():
        if (ROOT / PROBE_MARKER).is_file():
            print(f"DOCS WARNING: {rel}: no .git in this probe copy - whether the verdict (commit {commit}) is current was NOT checked", file=sys.stderr)
            return []
        return [f"not a git checkout: cannot prove the verdict (commit {commit}) is current"]
    code, _, err = _git("rev-parse", "--verify", "--quiet", f"{commit}^{{commit}}")
    if code != 0:
        return [f"verified commit {commit} cannot be found in this repository's history"
                f"{' (git: ' + err + ')' if err else ''}; fetch full history (CI: actions/checkout with fetch-depth: 0)"]
    code, changed, err = _git("diff", "--name-only", commit, "--", *paths)
    code2, untracked, err2 = _git("ls-files", "--others", "--exclude-standard", "--", *paths)
    if code != 0 or code2 != 0:
        return [f"git could not compare the task's files with commit {commit} (git: {err or err2})"]
    stale = sorted(set(changed.splitlines()) | set(untracked.splitlines()))
    if stale:
        shown = ", ".join(stale[:8]) + (f", ... ({len(stale)} files)" if len(stale) > 8 else "")
        return [f"files owned by the task changed after the verified commit {commit}: {shown}. Re-verify, or the task is not DONE"]
    return []


def check_done(task: Path, task_text: str) -> list[str]:
    rel = task.relative_to(ROOT).as_posix()
    v = task.parent / "VERIFY.md"
    vrel = v.relative_to(ROOT).as_posix()
    if not v.is_file():
        return [f"{rel}: Status DONE but {vrel} does not exist"]
    errors: list[str] = []
    verify_text = _read(v, errors)
    if verify_text is None:
        return errors
    found = check_verdict(verify_text)
    run, commit = final_run(verify_text)
    if not run:
        found.append("has no 'Verifier run: <date>, commit <sha>' line")
    else:
        found += check_coverage(task_text, run)
        paths, path_errors = owned_paths(task_text)
        found += path_errors or check_currency(rel, commit, paths)
    return [f"{rel}: Status DONE but {vrel} {e}" if not e.startswith(("TASK.md", "owned path")) else f"{rel}: Status DONE but {e}" for e in found]


def main(argv: list[str] | None = None) -> int:
    if argv:
        print(__doc__, file=sys.stderr)
        return 2
    errors: list[str] = []
    for f in REQUIRED:
        p = ROOT / f
        if not p.is_file():
            errors.append(f"{f} missing or empty")
        else:
            text = _read(p, errors)
            if text is not None and not text.strip():
                errors.append(f"{f} missing or empty")
    tasks = sorted((ROOT / "tasks").glob("*/TASK.md"))
    if not tasks:
        errors.append("no tasks/<feature>/TASK.md files found")
    for t in tasks:
        text = _read(t, errors)
        if text is None:
            continue
        rel = t.relative_to(ROOT).as_posix()
        for s in SECTIONS:
            if s not in text:
                errors.append(f"{rel}: missing section '{s}'")
        if len(re.findall(r"^## Status[ \t]*$", text, re.M)) != 1:
            errors.append(f"{rel}: must contain exactly one '## Status' heading")
        m = re.search(r"^## Status[ \t]*\n+[ \t]*[`*_ ]*([A-Za-z][A-Za-z\-]*)", text, re.M)
        status = m.group(1).upper() if m else "?"
        if status not in STATES:
            errors.append(f"{rel}: Status must be one of {sorted(STATES)}, found {status!r}")
        if status == "DONE":
            errors.extend(check_done(t, text))
    if errors:
        for e in errors:
            print(f"DOCS ERROR: {e}", file=sys.stderr)
        return 2
    print(f"docs: OK ({len(tasks)} task folders)")
    return 0


def cli(argv: list[str]) -> int:
    """Every failure path is exit 2 (D-003): an uncaught exception must not surface as Python's exit 1."""
    try:
        return 0 if main(argv) == 0 else 2
    except Exception:
        traceback.print_exc()
        print("check_docs.py: internal error - the docs were NOT verified. Exiting 2.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
