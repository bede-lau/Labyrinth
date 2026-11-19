#!/usr/bin/env python3
"""Validate artifacts/ against contracts/ and check they are fresh.

  validate_artifacts.py               schema-validate every artifact in artifacts/manifest.json
  validate_artifacts.py --check-fresh rebuild artifacts into a temp dir and require byte equality

Exit 0 = OK, 2 = failure or bad invocation.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"
ARTIFACTS = ROOT / "artifacts"


def registry():
    from referencing import Registry, Resource

    resources = []
    for p in CONTRACTS.glob("*.schema.json"):
        schema = json.loads(p.read_text())
        res = Resource.from_contents(schema)
        resources.append((p.name, res))
        resources.append((schema["$id"], res))
    return Registry().with_resources(resources)


def validate(art_dir: Path) -> list[str]:
    from jsonschema import Draft202012Validator

    errors: list[str] = []
    reg = registry()
    manifest_path = art_dir / "manifest.json"
    if not manifest_path.exists():
        return [f"{manifest_path.relative_to(ROOT)} missing — run: python3 -m labyrinth_main.build_artifacts (from main/)"]
    manifest = json.loads(manifest_path.read_text())
    schema = json.loads((CONTRACTS / "manifest.schema.json").read_text())
    for e in Draft202012Validator(schema, registry=reg).iter_errors(manifest):
        errors.append(f"manifest.json: {e.json_path}: {e.message}")
    for entry in manifest.get("artifacts", []):
        p = art_dir / entry["path"]
        if not p.exists():
            errors.append(f"{entry['path']}: listed in manifest but missing")
            continue
        raw = p.read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            errors.append(f"{entry['path']}: sha256 does not match manifest")
        schema = json.loads((CONTRACTS / entry["schema"]).read_text())
        for e in Draft202012Validator(schema, registry=reg).iter_errors(json.loads(raw)):
            errors.append(f"{entry['path']}: {e.json_path}: {e.message[:300]}")
    return errors


def check_fresh() -> list[str]:
    with tempfile.TemporaryDirectory() as d:
        cmd = [sys.executable, "-m", "labyrinth_main.build_artifacts", "--out", d]
        proc = subprocess.run(cmd, cwd=ROOT / "main", capture_output=True, text=True)
        if proc.returncode != 0:
            return [f"build_artifacts failed (exit {proc.returncode}):\n{proc.stdout}\n{proc.stderr}"]
        errors = []
        fresh = {p.name for p in Path(d).glob("*.json")}
        committed = {p.name for p in ARTIFACTS.glob("*.json")}
        for name in sorted(fresh | committed):
            a, b = Path(d) / name, ARTIFACTS / name
            if not a.exists():
                errors.append(f"artifacts/{name}: committed but no longer generated")
            elif not b.exists():
                errors.append(f"artifacts/{name}: generated but not committed")
            elif a.read_bytes() != b.read_bytes():
                errors.append(f"artifacts/{name}: stale or non-deterministic — regenerate with `cd main && python3 -m labyrinth_main.build_artifacts`")
        return errors


def main(argv: list[str]) -> int:
    if argv and argv != ["--check-fresh"]:
        print(__doc__, file=sys.stderr)
        return 2
    errors = check_fresh() if argv else validate(ARTIFACTS)
    if errors:
        for e in errors:
            print(f"ARTIFACT ERROR: {e}", file=sys.stderr)
        return 2
    print("artifacts: fresh (byte-identical rebuild)" if argv else "artifacts: schema-valid")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
