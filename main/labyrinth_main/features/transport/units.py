"""GX raw normalisation -> archive (stella/GENE benchmark) units.

PRD: for raw GX normalisations with identical dimensional references, multiply time by sqrt(2)
and divide heat flux by 2*sqrt(2). The factor comes from GX normalising to v_t = sqrt(T/m) where
the archive uses v_th = sqrt(2T/m).
"""
from __future__ import annotations

import math
from collections.abc import Sequence

TIME_MULTIPLIER = math.sqrt(2.0)
HEAT_FLUX_DIVISOR = 2.0 * math.sqrt(2.0)
VALIDITY = "Only for raw GX normalisations whose dimensional references (a, B_ref, T_ref, n_ref, m_ref) equal the archive's."


def gx_to_archive(t: Sequence[float], q: Sequence[float], *, identical_references: bool) -> tuple[list[float], list[float]]:
    if not identical_references:
        raise ValueError("refusing GX->archive conversion: dimensional references not asserted identical")
    if len(t) != len(q):
        raise ValueError("t and Q must have equal length")
    return [x * TIME_MULTIPLIER for x in t], [y / HEAT_FLUX_DIVISOR for y in q]
