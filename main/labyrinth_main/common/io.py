"""Deterministic JSON output + hashing. Artifacts must rebuild byte-identically."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

SIG_FIGS = 7


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _round(x: float, sig: int) -> float:
    if x == 0 or not math.isfinite(x):
        if not math.isfinite(x):
            raise ValueError(f"non-finite float in artifact: {x}")
        return 0.0
    return float(f"{x:.{sig - 1}e}")


def normalize(obj: Any, sig: int = SIG_FIGS) -> Any:
    """Round floats to `sig` significant figures; convert numpy scalars/arrays."""
    try:
        import numpy as np

        if isinstance(obj, np.ndarray):
            return [normalize(v, sig) for v in obj.tolist()]
        if isinstance(obj, np.generic):
            obj = obj.item()
    except ImportError:  # pragma: no cover
        pass
    if isinstance(obj, bool) or obj is None or isinstance(obj, (int, str)):
        return obj
    if isinstance(obj, float):
        return _round(obj, sig)
    if isinstance(obj, dict):
        return {str(k): normalize(v, sig) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [normalize(v, sig) for v in obj]
    raise TypeError(f"cannot serialise {type(obj)!r}")


def dumps(obj: Any) -> bytes:
    return (json.dumps(normalize(obj), sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def write_json(path: Path, obj: Any) -> str:
    data = dumps(obj)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()
