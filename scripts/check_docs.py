#!/usr/bin/env python3
"""Handoff-doc gate. Exit 0 = OK, 2 = failure.

* status.md, architecture.md, decision.md, CLAUDE.md exist and are non-empty.
* Every tasks/<feature>/TASK.md has the sections: Owner, Expected outcome, Tests, Status.
* A task whose Status line says DONE must have tasks/<feature>/VERIFY.md containing
  "Verdict: PASS" (written by the external verifier agent, with real test output).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = ["status.md", "architecture.md", "decision.md", "CLAUDE.md"]
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
        m = re.search(r"## Status\s*\n+\s*\**([A-Z\-]+)", text)
        status = m.group(1) if m else "?"
        if status == "DONE":
            v = t.parent / "VERIFY.md"
            if not v.exists() or "Verdict: PASS" not in v.read_text():
                errors.append(f"{rel}: Status DONE but {v.relative_to(ROOT)} lacks 'Verdict: PASS' from the verifier")
    if errors:
        for e in errors:
            print(f"DOCS ERROR: {e}", file=sys.stderr)
        return 2
    print(f"docs: OK ({len(tasks)} task folders)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
