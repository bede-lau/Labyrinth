#!/usr/bin/env python3
"""Enforce the main/renderer process boundary.

Rules (see architecture.md "Process boundary"):
  renderer/  Every path-like string literal ('..', "..", `..`) in renderer source, config and
             HTML files is resolved relative to its file. It may point inside renderer/, at
             contracts/*.json, or (data only) at artifacts/. Anything else outside renderer/
             - main/, scripts/, data/ - is a violation. This catches import/export/require,
             dynamic import() with template literals, import.meta.glob, new URL(...),
             /// <reference path>, vite resolve.alias and tsconfig paths alike, because all of
             them are spelled as strings. Bare specifiers naming the backend (labyrinth_main,
             main/..., @main) are violations too.
  main/      Python is parsed with ast. Imports of `renderer`, importlib.import_module /
             __import__ of it, and any non-docstring string constant that names the renderer
             directory as a path ("renderer", ".../renderer", "renderer/...") are violations.
             That covers sys.path hacks, site.addsitedir, os.path.join(..., "renderer") and
             Path(...) / "renderer".

Exit codes: 0 = clean, 2 = violation or invocation error (Claude Code hook convention:
exit 2 blocks and feeds stderr back to the agent).

Usage:
  check_boundaries.py                 scan the whole repo
  check_boundaries.py FILE [FILE...]  scan only these files (used by the edit hook)
  check_boundaries.py --self-test     prove the checker catches violations
"""
from __future__ import annotations

import ast
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(os.environ.get("LABYRINTH_ROOT") or Path(__file__).resolve().parent.parent).resolve()
RENDERER_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".html", ".vue", ".svelte", ".css"}
RENDERER_JSON = re.compile(r"^(?:tsconfig|jsconfig)(?:\.[\w-]+)?\.json$|^package\.json$")
SKIP_DIRS = {"node_modules", "dist", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache", "coverage"}

# Any quoted string: '...', "...", `...` (template literals stop at the first ${ for resolution).
STRING = re.compile(r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`""")
BACKEND_SPEC = re.compile(r"^(?:@main|main)/|^@?labyrinth_main(?:/|$)|(?:^|/)labyrinth_main(?:/|$)")
RENDERER_PATH = re.compile(r"(?:^|[/\\])renderer(?:$|[/\\])")


def _side(path: Path, root: Path) -> str | None:
    try:
        rel = path.resolve().relative_to(root)
    except ValueError:
        return None
    top = rel.parts[0] if rel.parts else ""
    return top if top in {"main", "renderer"} else None


def _inside(target: Path, base: Path) -> bool:
    return target == base or str(target).startswith(str(base) + os.sep)


def _line(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


CWD_FILE = re.compile(r"\.(?:test|spec)\.[cm]?[jt]sx?$|^(?:vite|vitest|playwright)\.config\.[cm]?[jt]s$|\.config\.[cm]?[jt]s$")


def _cwd_relative_file(path: Path, renderer: Path) -> bool:
    """Files whose fs paths run with cwd = renderer/ (tests, configs, scripts/), not bundled imports."""
    return bool(CWD_FILE.search(path.name)) or _inside(path.resolve(), renderer / "scripts")


def check_renderer(path: Path, root: Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8", errors="replace")
    renderer = (root / "renderer").resolve()
    contracts = (root / "contracts").resolve()
    artifacts = (root / "artifacts").resolve()
    rel_file = path.resolve().relative_to(root)
    for m in STRING.finditer(text):
        raw = next(g for g in m.groups() if g is not None)
        spec = raw.split("${", 1)[0] if m.group(3) is not None else raw
        spec = spec.split("?", 1)[0].strip()
        where = f"{rel_file}:{_line(text, m.start())}"
        if BACKEND_SPEC.search(spec):
            errors.append(f"{where}: renderer references backend module/path '{raw}'")
            continue
        # (target, strict): strict = must stay inside renderer/ (or contracts/*.json, artifacts/);
        # non-strict = flagged only if it lands in a backend-owned tree (main/, scripts/, data/).
        candidates: list[tuple[Path, bool]] = []
        if spec.startswith("file://"):
            spec = spec[len("file://"):]
        if spec.startswith("/@fs/"):
            candidates.append((Path(spec[len("/@fs"):]).resolve(), False))  # vite raw-filesystem URL
        elif spec.startswith("/") and len(spec) > 1:
            # As a filesystem path, and as vite reads it: relative to the project root (renderer/).
            candidates.append((Path(spec).resolve(), False))
            candidates.append(((renderer / spec.lstrip("/")).resolve(), False))
        elif spec.startswith("./") or spec.startswith("../") or spec in {".", ".."}:
            candidates.append(((path.parent / spec).resolve(), True))  # how bundlers resolve it
            if _cwd_relative_file(path, renderer):
                candidates.append(((renderer / spec).resolve(), False))  # node/vitest resolve fs paths from cwd
        banned = [(root / d).resolve() for d in ("main", "scripts", "data")]
        for target, strict in candidates:
            if strict:
                if _inside(target, renderer) or _inside(target, artifacts) or not _inside(target, root):
                    continue
                if _inside(target, contracts) and (target.suffix == ".json" or target == contracts):
                    continue
            elif not any(_inside(target, b) for b in banned):
                continue
            shown = target.relative_to(root) if _inside(target, root) else target
            errors.append(f"{where}: renderer path '{raw}' leaves renderer/ (resolves to {shown})")
            break
    return errors


def _docstring_nodes(tree: ast.AST) -> set[int]:
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
                ids.add(id(body[0].value))
    return ids


def _is_renderer_module(name: str | None) -> bool:
    return bool(name) and (name == "renderer" or name.startswith("renderer."))


def check_main(path: Path, root: Path) -> list[str]:
    errors: list[str] = []
    rel_file = path.resolve().relative_to(root)
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        tree = ast.parse(text, filename=str(path))
    except SyntaxError as e:
        return [f"{rel_file}:{e.lineno}: cannot parse ({e.msg}); boundary cannot be verified"]
    docstrings = _docstring_nodes(tree)
    for node in ast.walk(tree):
        where = f"{rel_file}:{getattr(node, 'lineno', '?')}"
        if isinstance(node, ast.Import):
            for a in node.names:
                if _is_renderer_module(a.name):
                    errors.append(f"{where}: main imports frontend module '{a.name}'")
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and _is_renderer_module(node.module):
                errors.append(f"{where}: main imports frontend module '{node.module}'")
        elif isinstance(node, ast.Call):
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else fn.id if isinstance(fn, ast.Name) else ""
            if name in {"import_module", "__import__"} and node.args:
                a0 = node.args[0]
                if isinstance(a0, ast.Constant) and isinstance(a0.value, str) and _is_renderer_module(a0.value):
                    errors.append(f"{where}: main dynamically imports frontend module '{a0.value}'")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            if RENDERER_PATH.search(node.value) and len(node.value) < 300:
                errors.append(f"{where}: main references the renderer directory as a path ('{node.value}')")
    return errors


def check_file(path: Path, root: Path) -> list[str]:
    side = _side(path, root)
    if side == "renderer" and (path.suffix in RENDERER_EXT or RENDERER_JSON.match(path.name)):
        return check_renderer(path, root)
    if side == "main" and path.suffix == ".py":
        return check_main(path, root)
    return []


def iter_files(root: Path):
    for side in ("main", "renderer"):
        base = root / side
        if not base.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for f in filenames:
                if f == "package-lock.json":
                    continue
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
    if n == 0:
        print("boundary: scanned 0 files — wrong LABYRINTH_ROOT or empty tree; refusing to report OK", file=sys.stderr)
        return 2
    print(f"boundary: OK ({n} files scanned)")
    return 0


VIOLATIONS = {
    # renderer: classic forms
    "renderer/src/v01.ts": "import x from '../../main/labyrinth_main/foo';\n",
    "renderer/src/v02.ts": 'import x from "../../main/labyrinth_main/foo";\n',
    "renderer/src/v03.ts": "const y = await import('labyrinth_main/x');\n",
    "renderer/src/v04.tsx": "export { z } from '../../scripts/thing';\n",
    "renderer/src/v05.js": "const q = require('../../data/raw/x.h5');\n",
    "renderer/src/v06.ts": "import {\n  a,\n  b,\n} from '../../main/x';\n",
    "renderer/src/v07.ts": "import '../../main/side-effect';\n",
    # renderer: bypasses reported by the 00-scaffold verifier
    "renderer/src/v08.ts": "const m = await import(`../../main/labyrinth_main/build_artifacts.py?raw`);\n",
    "renderer/src/v09.ts": "const m = await import(`../../main/${name}.py`);\n",
    "renderer/vite.config.ts": "export default { resolve: { alias: { '@backend': resolve(__dirname, '../main') } } };\n",
    "renderer/tsconfig.json": '{ "compilerOptions": { "paths": { "@b/*": ["../main/*"] } } }\n',
    "renderer/src/v10.ts": "const mods = import.meta.glob('../../main/**/*.py', { as: 'raw' });\n",
    "renderer/src/v11.ts": "const u = new URL('../../main/pyproject.toml', import.meta.url);\n",
    "renderer/src/v12.ts": '/// <reference path="../../main/types.d.ts" />\n',
    "renderer/index.html": '<script type="module" src="../main/x.js"></script>\n',
    "renderer/src/v13.ts": "import x from '@main/foo';\n",
    "renderer/src/v14.ts": "import s from '../../contracts/notjson.ts';\n",
    # verifier run 2 (N1, N3, N4): absolute paths, vite /@fs/, cwd-relative paths, tsconfig.*.json
    "renderer/src/v26.ts": "import t from '{ROOT}/main/pyproject.toml?raw';\n",
    "renderer/src/v27.ts": "import t from '/@fs{ROOT}/main/pyproject.toml?raw';\n",
    "renderer/vite.config.mts": "export default { resolve: { alias: { '@b': '{ROOT}/main' } } };\n",
    "renderer/src/v28.test.ts": "const p = resolve(process.cwd(), '../main/labyrinth_main/x.py');\n",
    "renderer/src/v29.test.ts": "const raw = readFileSync('../data/raw/wout_w7x_kjm.nc');\n",
    "renderer/tsconfig.app.json": '{ "compilerOptions": { "paths": { "@b/*": ["../main/*"] } } }\n',
    # verifier run 3 (R1): vite treats '/x' as renderer-root-relative; file:// URLs
    "renderer/src/v30.ts": "import t from '/../main/pyproject.toml?raw';\n",
    "renderer/src/v31.ts": "const m = import.meta.glob('/src/../../main/*');\n",
    "renderer/src/v32.ts": "const u = 'file://{ROOT}/main/x.py';\n",
    # main: imports
    "main/labyrinth_main/v15.py": "from renderer.src import app\n",
    "main/labyrinth_main/v16.py": "import os, renderer.src as r\n",
    "main/labyrinth_main/v17.py": "def f():\n    import renderer\n",
    "main/labyrinth_main/v18.py": "from \\\n  renderer import x\n",
    "main/labyrinth_main/v19.py": "import importlib\nm = importlib.import_module('renderer.src')\n",
    "main/labyrinth_main/v20.py": "m = __import__('renderer')\n",
    # main: path hacks
    "main/labyrinth_main/v21.py": "import sys\nsys.path.insert(0, '../renderer')\n",
    "main/labyrinth_main/v22.py": "import os, sys\nsys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'renderer'))\n",
    "main/labyrinth_main/v23.py": "import sys\nfrom pathlib import Path\nsys.path.append(str(Path(__file__).parents[2] / 'renderer'))\n",
    "main/labyrinth_main/v24.py": "import site\nsite.addsitedir('/repo/renderer/src')\n",
    "main/labyrinth_main/v25.py": "import sys\np = 'renderer'\nsys.path += [p]\n",
}
CLEAN = {
    "renderer/src/ok1.ts": "import React from 'react';\nimport s from '../../contracts/geometry.schema.json';\nimport { a } from './lib/a';\n",
    "renderer/src/ok2.ts": "const r = await fetch('/artifacts/geometry.json');\nconst label = 'the main process';\nconst t = `../${x}`;\n"
    "const el = document.querySelector('main');\nconst s = '/src/main.tsx';\nconst api = '/api/live/status';\n",
    "renderer/src/ok3.test.ts": "const A = resolve(__dirname, '../../artifacts');\nconst C = resolve(__dirname, '../../contracts');\n",
    "renderer/src/features/x/ok4.tsx": "import f from '../data/fixtures';\nimport s from '../scripts/helper';\n",
    "renderer/index.html": None,  # replaced below for the clean pass
    "main/labyrinth_main/ok.py": (
        '"""Must never import from renderer/."""\nimport json\nfrom labyrinth_main.common import io\nmsg = "the renderer plays replay"\n'
    ),
}


def self_test() -> int:
    failures = []
    with tempfile.TemporaryDirectory() as d:
        root = Path(d).resolve()
        for sub in ("renderer/src/lib", "main/labyrinth_main", "contracts", "artifacts", "scripts", "data/raw"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        for rel, body in VIOLATIONS.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(body.replace("{ROOT}", str(root)))
            if not check_file(root / rel, root):
                failures.append(f"missed violation in {rel}: {body.strip()!r}")
        (root / "renderer/index.html").write_text('<script type="module" src="/src/main.tsx"></script>\n')
        (root / "renderer/vite.config.ts").write_text("const A = resolve(import.meta.dirname, '../artifacts');\n")
        (root / "renderer/tsconfig.json").write_text('{ "include": ["src", "vite.config.ts"] }\n')
        for rel, body in CLEAN.items():
            if body is not None:
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text(body)
        for rel in [*(k for k, v in CLEAN.items() if v is not None), "renderer/index.html", "renderer/vite.config.ts", "renderer/tsconfig.json"]:
            errs = check_file(root / rel, root)
            if errs:
                failures.append(f"false positive in {rel}: {errs}")
    if failures:
        for f in failures:
            print(f"self-test FAIL: {f}", file=sys.stderr)
        return 2
    print(f"boundary self-test: OK ({len(VIOLATIONS)} violations caught, {len(CLEAN) + 2} clean files passed)")
    return 0


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--self-test":
        return self_test() if len(argv) == 1 else 2
    if argv and argv[0].startswith("-"):
        print(__doc__, file=sys.stderr)
        return 2
    if argv:
        return run([Path(a) if Path(a).is_absolute() else (Path.cwd() / a) for a in argv], ROOT)
    return run(list(iter_files(ROOT)), ROOT)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
