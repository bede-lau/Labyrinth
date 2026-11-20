#!/usr/bin/env python3
"""Handoff-doc gate. Exit 0 = OK, 2 = failure.

* status.md, architecture.md, decision.md, CLAUDE.md exist and are non-empty.
* Every tasks/<feature>/TASK.md has the sections: Owner, Expected outcome, Tests, Status.
* A task whose Status line says DONE must have tasks/<feature>/VERIFY.md containing
  a final line exactly "Verdict: PASS" (written by the external verifier agent).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = ["status.md", "architecture.md", "decision.md", "CLAUDE.md"]
STATES = {"TODO", "IN-PROGRESS", "VERIFYING", "DONE", "BLOCKED"}
SECTIONS = ["## Owner", "## Expected outcome", "## Tests", "## Status"]


def main() -> int:
    errors = []
    for f in REQUIRED:
        p = ROOT / f
        if not p.exists() or not p.read_text().strip():
            errors.append(f"{f} missing or empty")
    tasks = sorted((ROOT / "tasks").glob("*/TASK.md"))
    if not tasks:
        errors.append("no tasks/<feature>/TASK.md files found")
    for t in tasks:
        text = t.read_text()
        rel = t.relative_to(ROOT)
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
            v = t.parent / "VERIFY.md"
            body = re.sub(r"^(```|~~~).*?^\1", "", v.read_text(), flags=re.M | re.S) if v.exists() else ""  # ignore fenced output
            verdicts = re.findall(r"^Verdict:[ \t]*(PASS|FAIL)\b(?![ \t]*\|).*$", body, re.M)  # not the 'PASS | FAIL' template
            if not verdicts or verdicts[-1] != "PASS":
                errors.append(f"{rel}: Status DONE but {v.relative_to(ROOT)} has no final 'Verdict: PASS' line (outside code fences) from the verifier")
    if errors:
        for e in errors:
            print(f"DOCS ERROR: {e}", file=sys.stderr)
        return 2
    print(f"docs: OK ({len(tasks)} task folders)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
