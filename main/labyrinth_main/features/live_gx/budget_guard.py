"""Live GX budget guard (pure). Every allocation must pass `evaluate()`.

PRD (Budget and presentation figures): before each allocation, reconcile billed and pending
usage, allow for setup, idle time, storage and egress, and set resource limits and a hard timeout
within the remaining $40. Use replay when the next slot cannot fit.

    slot estimate = rate x (slot + setup + idle margin) + storage/egress allowance
    approve only if the ledger is reconciled and billed + pending + estimate <= ceiling

The rate, ceiling, slot length and rehearsal length come from `features/budget/pricing.py`
(PRD numbers). SETUP_MIN, IDLE_MARGIN_MIN and STORAGE_EGRESS_USD are NOT PRD numbers: they are
Labyrinth's conservative allowances until a measured rehearsal replaces them.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

from ..budget.pricing import CEILING_USD, LIVE_RATE_USD_PER_H, LIVE_SLOT_MIN, REHEARSAL_H

SETUP_MIN = 5.0             # per container launch: image pull + GX start-up (assumption, unmeasured)
IDLE_MARGIN_MIN = 5.0       # polling, retrieval and termination latency (assumption, unmeasured)
STORAGE_EGRESS_USD = 0.10   # checkpoint Volume + flux-sample egress allowance (assumption, unmeasured)
REHEARSAL_SETUPS = 2        # rehearsal = run from initialization + run continued from its checkpoint
PHASE_FRACTION = 0.5        # each rehearsal phase gets half of the rehearsal allocation's hard timeout


@dataclass(frozen=True)
class Ledger:
    """Cumulative Modal usage. `reconciled` is True only after a human has checked billed and
    pending against Modal's usage page; any new reservation makes it stale again."""
    billed: float
    pending: float
    reconciled: bool

    def reserve(self, amount_usd: float) -> Ledger:
        return replace(self, pending=round(self.pending + amount_usd, 2), reconciled=False)


@dataclass(frozen=True)
class GuardDecision:
    approved: bool
    reason: str
    ceiling_usd: float
    billed_usd: float
    pending_usd: float
    slot_estimate_usd: float
    hard_timeout_s: int

    def budget_snapshot(self) -> dict:
        """The `budget` object of contracts/live-status.schema.json."""
        return {
            "ceilingUsd": self.ceiling_usd,
            "billedUsd": self.billed_usd,
            "pendingUsd": self.pending_usd,
            "slotEstimateUsd": self.slot_estimate_usd,
            "slotFits": self.approved,
            "hardTimeoutS": self.hard_timeout_s,
        }


def ceil_cents(x: float) -> float:
    """Round a cost UP to the cent (never under-estimate); tolerant of float noise."""
    return math.ceil(round(x * 100.0, 6)) / 100.0


def planned_minutes(slot_min: float, setups: int = 1) -> float:
    return slot_min + setups * SETUP_MIN + IDLE_MARGIN_MIN


def slot_estimate_usd(slot_min: float = LIVE_SLOT_MIN, *, setups: int = 1, rate_usd_per_h: float = LIVE_RATE_USD_PER_H) -> float:
    return ceil_cents(rate_usd_per_h * planned_minutes(slot_min, setups) / 60.0 + STORAGE_EGRESS_USD)


def rehearsal_estimate_usd() -> float:
    return slot_estimate_usd(REHEARSAL_H * 60.0, setups=REHEARSAL_SETUPS)


def hard_timeout_s(remaining_usd: float, slot_min: float = LIVE_SLOT_MIN, *, setups: int = 1,
                   rate_usd_per_h: float = LIVE_RATE_USD_PER_H) -> int:
    """Wall-clock cap for the allocation: the planned duration, cut so that the GPU time it can
    bill (plus the storage allowance) stays within the remaining budget."""
    planned = planned_minutes(slot_min, setups) * 60.0
    affordable = max(0.0, (remaining_usd - STORAGE_EGRESS_USD) / rate_usd_per_h * 3600.0)
    return int(math.floor(min(planned, affordable)))


def planned_call_s(kind: str) -> int:
    """Planned wall-clock seconds for ONE worker call of `kind` (one setup included). This is the hard
    timeout the orchestrator enforces from launch; an approved allocation always gets at least this."""
    if kind == "live":
        return int(planned_minutes(LIVE_SLOT_MIN) * 60)
    if kind == "rehearsal":
        return int(planned_minutes(REHEARSAL_H * 60.0, REHEARSAL_SETUPS) * 60 * PHASE_FRACTION)
    raise ValueError(f"unknown worker kind {kind!r}")


def modal_startup_timeout_s() -> int:
    """Container start-up budget (image pull + cold start): the priced setup allowance."""
    return int(SETUP_MIN * 60)


def modal_timeout_s(kind: str) -> int:
    """Execution timeout Modal enforces on the deployed function of `kind`, counted from container start.

    Priced in stages: startup (<= modal_startup_timeout_s) + execution (this) == planned_call_s(kind), the
    orchestrator's hard timeout counted from launch. The worker stops GX and checkpoints CHECKPOINT_MARGIN
    seconds before this, so it finishes before the orchestrator gives up even after a full-length cold start."""
    return planned_call_s(kind) - modal_startup_timeout_s()


def evaluate(ledger: Ledger, *, slot_min: float = LIVE_SLOT_MIN, setups: int = 1, ceiling_usd: float = CEILING_USD,
             rate_usd_per_h: float = LIVE_RATE_USD_PER_H) -> GuardDecision:
    estimate = slot_estimate_usd(slot_min, setups=setups, rate_usd_per_h=rate_usd_per_h)
    values_ok = all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0
                    for v in (ledger.billed, ledger.pending))
    billed = float(ledger.billed) if values_ok else 0.0
    pending = float(ledger.pending) if values_ok else 0.0
    remaining = ceiling_usd - billed - pending
    timeout = hard_timeout_s(remaining, slot_min, setups=setups, rate_usd_per_h=rate_usd_per_h) if values_ok else 0

    def decide(ok: bool, reason: str) -> GuardDecision:
        return GuardDecision(ok, reason, ceiling_usd, round(billed, 2), round(pending, 2), estimate, timeout)

    if not values_ok:
        return decide(False, "Budget guard refused: ledger billed/pending must be finite, non-negative numbers.")
    if not ledger.reconciled:
        return decide(False, f"Budget guard refused: ledger not reconciled (billed ${billed:.2f}, pending ${pending:.2f}). "
                             "Check both against Modal's usage page and record them before any allocation.")
    total = billed + pending + estimate
    if total > ceiling_usd + 1e-9:  # unrounded: $40.004 is over the ceiling (1e-9 absorbs float noise only)
        return decide(False, f"Budget guard refused: billed ${billed:.2f} + pending ${pending:.2f} + slot ${estimate:.2f} "
                             f"= ${total:.2f} exceeds the ${ceiling_usd:.2f} ceiling. Use replay.")
    return decide(True, f"Budget guard approves: billed ${billed:.2f} + pending ${pending:.2f} + slot ${estimate:.2f} "
                        f"= ${total:.2f} <= ${ceiling_usd:.2f}; hard timeout {timeout} s.")
