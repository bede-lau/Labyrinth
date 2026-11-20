"""Budget arithmetic (B1–B3), recomputed from the constants in ``pricing.py``.

Money is computed in exact ``Decimal`` arithmetic and rounded **half-up to whole cents**, the
convention the PRD's figures follow (6.10 × 15/60 = 1.525 exactly is printed as $1.53). The
ledger rounds each line item before summing; here that is not what makes the totals come out
right — rounding the exact totals once (13.725 → 13.73, 21.825 → 21.83) gives the same cents.
What matters is decimal half-up rounding: binary-float ``round(1.525, 2)`` gives 1.52 and
``round(21.825, 2)`` gives 21.82 because those decimals are not representable. The unrounded
totals are recorded beside the rounded ones.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from . import pricing

CENT = Decimal("0.01")


def dec(x: float | int | str) -> Decimal:
    return Decimal(str(x))


def cents(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class LiveLedger:
    slot_exact: Decimal
    slot: Decimal
    rehearsals: Decimal
    plan_exact: Decimal
    plan: Decimal
    posted: Decimal
    planned_exact: Decimal
    planned: Decimal
    ceiling: Decimal
    remaining: Decimal


def live_ledger() -> LiveLedger:
    rate = dec(pricing.LIVE_RATE_USD_PER_H)
    slot_exact = rate * dec(pricing.LIVE_SLOT_MIN) / Decimal(60)
    slot = cents(slot_exact)
    rehearsals = cents(rate * dec(pricing.REHEARSAL_H) * pricing.N_REHEARSALS)
    plan = rehearsals + slot
    posted = cents(dec(pricing.POSTED_USD))
    planned = plan + posted
    ceiling = cents(dec(pricing.CEILING_USD))
    return LiveLedger(slot_exact=slot_exact, slot=slot, rehearsals=rehearsals,
                      plan_exact=rehearsals + slot_exact, plan=plan, posted=posted,
                      planned_exact=rehearsals + slot_exact + posted, planned=planned,
                      ceiling=ceiling, remaining=ceiling - planned)


def stella_published_cpu_hours() -> int:
    return pricing.STELLA_PUBLISHED_HOURS * pricing.STELLA_PUBLISHED_PROCESSORS


@dataclass(frozen=True)
class FullGrid:
    steps: int
    s_per_step: float
    hours: float
    days: float
    usd: float


def full_grid(timestep_factor: float = 1.0) -> FullGrid:
    """Wall time and cost of the full-grid stella run on Modal.

    ``timestep_factor`` = 0.5 models a halved stable timestep (twice the steps)."""
    steps = pricing.FULL_GRID_STEPS / timestep_factor
    hours = steps * pricing.FULL_GRID_S_PER_STEP / 3600.0
    return FullGrid(steps=int(round(steps)), s_per_step=pricing.FULL_GRID_S_PER_STEP, hours=hours,
                    days=hours / 24.0, usd=hours * pricing.FULL_GRID_RATE_USD_PER_H)
