#!/usr/bin/env python3
"""Validate artifacts/ against contracts/ and check they are fresh.

  validate_artifacts.py               the files under artifacts/ are exactly manifest.json plus the
                                      artifacts it lists (recursive: no extra file, no subdirectory,
                                      nothing that is not .json), every sha256 matches the manifest and
                                      every file validates against its schema in contracts/
  validate_artifacts.py --check-fresh rebuild the artifacts into a temp dir and require the same file
                                      set and byte equality

Exit 0 = OK, 2 = failure, bad invocation or internal error (decision D-003). A truncated or non-UTF-8
file is a reported failure, not a traceback.

LABYRINTH_ARTIFACTS overrides the artifacts directory; it exists for the gate tests only and verify.sh
unsets it.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"
ARTIFACTS = Path(os.environ.get("LABYRINTH_ARTIFACTS") or ROOT / "artifacts").resolve()
MANIFEST = "manifest.json"
ARTIFACT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.json$")
SCHEMA_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.schema\.json$")
REBUILD = "regenerate with `cd main && python3 -m labyrinth_main.build_artifacts`"


def load_json(path: Path, label: str, errors: list[str]):
    """Parsed JSON, or None after appending the reason to `errors` (missing, non-UTF-8, truncated, invalid)."""
    try:
        return json.loads(path.read_bytes().decode("utf-8"))
    except OSError as e:
        errors.append(f"{label}: cannot be read ({e.strerror})")
    except UnicodeDecodeError:
        errors.append(f"{label}: not valid UTF-8")
    except json.JSONDecodeError as e:
        errors.append(f"{label}: not valid JSON (line {e.lineno}: {e.msg}) - truncated or hand-edited?")
    return None


def listing(art_dir: Path) -> tuple[set[str], list[str]]:
    """(relative posix paths of every regular .json file, errors for everything else found under art_dir)."""
    files: set[str] = set()
    errors: list[str] = []
    for dirpath, dirnames, filenames in os.walk(art_dir):
        base = Path(dirpath)
        for d in dirnames:
            errors.append(f"{(base / d).relative_to(art_dir).as_posix()}/: subdirectories are not allowed in artifacts/")
        for f in filenames:
            rel = (base / f).relative_to(art_dir).as_posix()
            if (base / f).is_symlink() or not (base / f).is_file():
                errors.append(f"{rel}: not a regular file")
            elif not f.endswith(".json"):
                errors.append(f"{rel}: only .json files are allowed in artifacts/ (the build copies the whole directory)")
            else:
                files.add(rel)
    return files, errors


def registry(errors: list[str]):
    from referencing import Registry, Resource

    resources = []
    for p in sorted(CONTRACTS.glob("*.schema.json")):
        schema = load_json(p, f"contracts/{p.name}", errors)
        if isinstance(schema, dict):
            res = Resource.from_contents(schema)
            resources.append((p.name, res))
            if isinstance(schema.get("$id"), str):
                resources.append((schema["$id"], res))
    return Registry().with_resources(resources)


def validate(art_dir: Path) -> list[str]:
    from jsonschema import Draft202012Validator

    if not (art_dir / MANIFEST).is_file():
        return [f"{MANIFEST} missing - {REBUILD}"]
    on_disk, errors = listing(art_dir)
    reg = registry(errors)
    manifest = load_json(art_dir / MANIFEST, MANIFEST, errors)
    schema = load_json(CONTRACTS / "manifest.schema.json", "contracts/manifest.schema.json", errors)
    if manifest is None or schema is None:
        return errors
    for e in Draft202012Validator(schema, registry=reg).iter_errors(manifest):
        errors.append(f"{MANIFEST}: {e.json_path}: {e.message[:300]}")
    entries = manifest.get("artifacts", []) if isinstance(manifest, dict) else []
    listed: set[str] = set()
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or not all(isinstance(entry.get(k), str) for k in ("path", "schema", "sha256")):
            continue  # already reported by the manifest schema
        name = entry["path"]
        if not ARTIFACT_NAME.match(name) or name == MANIFEST:
            errors.append(f"{MANIFEST}: artifact path {name!r} must be a plain <name>.json file name inside artifacts/")
            continue
        if name in listed:
            errors.append(f"{MANIFEST}: {name} is listed twice")
            continue
        listed.add(name)
        if name not in on_disk:
            errors.append(f"{name}: listed in the manifest but missing")
            continue
        raw = (art_dir / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            errors.append(f"{name}: sha256 does not match the manifest")
        if not SCHEMA_NAME.match(entry["schema"]) or not (CONTRACTS / entry["schema"]).is_file():
            errors.append(f"{name}: schema {entry['schema']!r} is not a file in contracts/")
            continue
        data = load_json(art_dir / name, name, errors)
        artifact_schema = load_json(CONTRACTS / entry["schema"], f"contracts/{entry['schema']}", errors)
        if data is None or artifact_schema is None:
            continue
        for e in Draft202012Validator(artifact_schema, registry=reg).iter_errors(data):
            errors.append(f"{name}: {e.json_path}: {e.message[:300]}")
    for extra in sorted(on_disk - listed - {MANIFEST}):
        errors.append(f"{extra}: in artifacts/ but not listed in {MANIFEST} (the build would ship it)")
    return errors


def check_fresh(art_dir: Path) -> list[str]:
    with tempfile.TemporaryDirectory() as d:
        cmd = [sys.executable, "-m", "labyrinth_main.build_artifacts", "--out", d]
        proc = subprocess.run(cmd, cwd=ROOT / "main", capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            return [f"build_artifacts failed (exit {proc.returncode}):\n{proc.stdout}\n{proc.stderr}"]
        fresh, errors = listing(Path(d))
        committed, committed_errors = listing(art_dir)
        errors = [f"(rebuilt) {e}" for e in errors] + committed_errors
        if not fresh:
            errors.append("build_artifacts wrote no .json file")
        for name in sorted(fresh | committed):
            if name not in fresh:
                errors.append(f"artifacts/{name}: committed but no longer generated")
            elif name not in committed:
                errors.append(f"artifacts/{name}: generated but not committed")
            elif (Path(d) / name).read_bytes() != (art_dir / name).read_bytes():
                errors.append(f"artifacts/{name}: stale or non-deterministic - {REBUILD}")
        return errors


def main(argv: list[str]) -> int:
    if argv and argv != ["--check-fresh"]:
        print(__doc__, file=sys.stderr)
        return 2
    errors = check_fresh(ARTIFACTS) if argv else validate(ARTIFACTS)
    if errors:
        for e in errors:
            print(f"ARTIFACT ERROR: {e}", file=sys.stderr)
        return 2
    print("artifacts: fresh (byte-identical rebuild)" if argv else "artifacts: schema-valid")
    return 0


def cli(argv: list[str]) -> int:
    """Every failure path is exit 2 (D-003): an uncaught exception must not surface as Python's exit 1."""
    try:
        return 0 if main(argv) == 0 else 2
    except Exception:
        traceback.print_exc()
        print("validate_artifacts.py: internal error - the artifacts were NOT verified. Exiting 2.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
