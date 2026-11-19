#!/usr/bin/env python3
"""Enforce the main/renderer process boundary.

Rules (see architecture.md "Process boundary"):
  * renderer/ code may import only: relative paths that stay inside renderer/,
    bare npm package specifiers, and JSON files under contracts/.
  * main/ code may not import anything named or located in renderer/, and may not
    put renderer/ on sys.path.
  * Neither side may import the other via aliases or absolute paths.

Exit codes: 0 = clean, 2 = violation or invocation error (Claude Code hook
convention: exit 2 blocks and feeds stderr back to the agent).

Usage:
  check_boundaries.py                 scan the whole repo
  check_boundaries.py FILE [FILE...]  scan only these files (used by the edit hook)
  check_boundaries.py --self-test     prove the checker catches violations
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"}
PY_EXT = {".py"}
SKIP_DIRS = {"node_modules", "dist", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache", "coverage"}

JS_SPEC = re.compile(
    r"""(?:\bimport\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?|\bexport\s+[^'"]*?\sfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]"""
)
PY_IMPORT = re.compile(r"^\s*(?:from\s+([\w\.]+)\s+import|import\s+([\w\., ]+))", re.M)
PY_PATH_HACK = re.compile(r"sys\.path\.(?:insert|append)\([^)]*renderer", re.S)


def _side(path: Path, root: Path) -> str | None:
    try:
        rel = path.resolve().relative_to(root)
    except ValueError:
        return None
    top = rel.parts[0] if rel.parts else ""
    return top if top in {"main", "renderer"} else None


def check_js(path: Path, root: Path) -> list[str]:
    errors = []
    text = path.read_text(encoding="utf-8", errors="replace")
    renderer_root = (root / "renderer").resolve()
    contracts_root = (root / "contracts").resolve()
    for m in JS_SPEC.finditer(text):
        spec = m.group(1)
        line = text.count("\n", 0, m.start()) + 1
        where = f"{path.relative_to(root)}:{line}"
        if spec.startswith("."):
            target = (path.parent / spec).resolve()
            if str(target).startswith(str(renderer_root) + os.sep) or target == renderer_root:
                continue
            if str(target).startswith(str(contracts_root) + os.sep) and spec.endswith(".json"):
                continue
            shown = target.relative_to(root) if str(target).startswith(str(root)) else target
            errors.append(f"{where}: renderer imports '{spec}' which leaves renderer/ (resolves to {shown})")
        elif spec.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", spec):
            errors.append(f"{where}: absolute import '{spec}' is banned in renderer/")
        elif re.match(r"^(@main|main|labyrinth_main)(/|$)", spec) or "/main/" in spec or "labyrinth_main" in spec:
            errors.append(f"{where}: renderer imports backend module '{spec}'")
    return errors


def check_py(path: Path, root: Path) -> list[str]:
    errors = []
    text = path.read_text(encoding="utf-8", errors="replace")
    for m in PY_IMPORT.finditer(text):
        mods = [m.group(1)] if m.group(1) else [p.strip().split(" ")[0] for p in m.group(2).split(",")]
        for mod in mods:
            if mod and (mod == "renderer" or mod.startswith("renderer.")):
                line = text.count("\n", 0, m.start()) + 1
                errors.append(f"{path.relative_to(root)}:{line}: main imports frontend module '{mod}'")
    for m in PY_PATH_HACK.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        errors.append(f"{path.relative_to(root)}:{line}: main puts renderer/ on sys.path")
    return errors


def check_file(path: Path, root: Path) -> list[str]:
    side = _side(path, root)
    if side == "renderer" and path.suffix in JS_EXT:
        return check_js(path, root)
    if side == "main" and path.suffix in PY_EXT:
        return check_py(path, root)
    return []


def iter_files(root: Path):
    for side in ("main", "renderer"):
        base = root / side
        if not base.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for f in filenames:
                yield Path(dirpath) / f


def run(files: list[Path], root: Path) -> int:
    errors: list[str] = []
    n = 0
    for f in files:
        if f.exists() and f.is_file():
            n += 1
            errors.extend(check_file(f, root))
    if errors:
        print("BOUNDARY VIOLATION: main/ and renderer/ must never import each other.", file=sys.stderr)
        print("Exchange data through artifacts/ (JSON validated by contracts/) or the HTTP API instead.", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 2
    print(f"boundary: OK ({n} files scanned)")
    return 0


def self_test() -> int:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "renderer/src").mkdir(parents=True)
        (root / "main/labyrinth_main").mkdir(parents=True)
        (root / "contracts").mkdir()
        cases = {
            "renderer/src/bad1.ts": "import x from '../../main/labyrinth_main/foo';\n",
            "renderer/src/bad2.ts": "const y = await import('labyrinth_main/x');\n",
            "renderer/src/bad3.tsx": "export { z } from '../../scripts/thing';\n",
            "renderer/src/bad4.js": "const q = require('/abs/path');\n",
            "main/labyrinth_main/bad5.py": "from renderer.src import app\n",
            "main/labyrinth_main/bad6.py": "import sys\nsys.path.insert(0, '../renderer')\n",
        }
        good = {
            "renderer/src/ok.ts": "import React from 'react';\nimport s from '../../contracts/geometry.schema.json';\nimport { a } from './lib/a';\n",
            "main/labyrinth_main/ok.py": "import json\nfrom labyrinth_main.common import io\n",
        }
        for rel, body in {**cases, **good}.items():
            (root / rel).write_text(body)
        failures = []
        for rel in cases:
            if not check_file(root / rel, root):
                failures.append(f"missed violation in {rel}")
        for rel in good:
            errs = check_file(root / rel, root)
            if errs:
                failures.append(f"false positive in {rel}: {errs}")
        if failures:
            for f in failures:
                print(f"self-test FAIL: {f}", file=sys.stderr)
            return 2
        print(f"boundary self-test: OK ({len(cases)} violations caught, {len(good)} clean files passed)")
        return 0


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--self-test":
        return self_test()
    if argv and argv[0].startswith("-"):
        print(__doc__, file=sys.stderr)
        return 2
    if argv:
        return run([Path(a) if Path(a).is_absolute() else (Path.cwd() / a) for a in argv], ROOT)
    return run(list(iter_files(ROOT)), ROOT)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
