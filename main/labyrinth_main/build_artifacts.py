"""Build every artifact into artifacts/ (or --out DIR). Deterministic.

    cd main && python3 -m labyrinth_main.build_artifacts [--out DIR]

Each feature package that exposes `ARTIFACT_ID`, `SCHEMA` and `build() -> dict`
in its `artifact.py` is included. Features without one are skipped.
"""
from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path

from . import __version__
from .common.io import write_json
from .common.paths import ARTIFACTS

FEATURES = ["geometry", "transport", "forecast", "budget", "spatial"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ARTIFACTS)
    ap.add_argument("--only", nargs="*", default=None)
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    entries = []
    for name in FEATURES:
        try:
            mod = importlib.import_module(f"labyrinth_main.features.{name}.artifact")
        except ModuleNotFoundError as e:
            if e.name == f"labyrinth_main.features.{name}.artifact":
                print(f"skip {name}: no artifact.py yet", file=sys.stderr)
                continue
            raise
        if args.only and mod.ARTIFACT_ID not in args.only:
            continue
        path = f"{mod.ARTIFACT_ID}.json"
        digest = write_json(args.out / path, mod.build())
        entries.append({"id": mod.ARTIFACT_ID, "path": path, "schema": mod.SCHEMA, "sha256": digest})
        print(f"wrote {path} {digest[:12]}")
    if args.only:  # partial rebuild: keep other features' entries from the existing manifest
        existing = args.out / "manifest.json"
        if existing.exists():
            kept = [e for e in json.loads(existing.read_text())["artifacts"] if e["id"] not in args.only]
            entries = sorted(kept + entries, key=lambda e: FEATURES.index(e["id"]))
    manifest = {"schemaVersion": 1, "generator": {"name": "labyrinth_main", "version": __version__},
                "artifacts": entries}
    write_json(args.out / "manifest.json", manifest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
