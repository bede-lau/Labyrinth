"""04 · Budget and presentation figures — backend outcomes B1–B5 (tasks/04-budget/TASK.md)."""
from decimal import Decimal

import pytest

from labyrinth_main.features.budget import artifact, model, pricing


@pytest.fixture(scope="module")
def art():
    return artifact.build()


def _fx(art, fid):
    return next(f for f in art["fixtures"] if f["id"] == fid)


def _sc(art, sid):
    return next(s for s in art["scenarios"] if s["id"] == sid)


def test_B1_live_demo_ledger_recomputed_with_half_up_cents(art):
    led = model.live_ledger()
    assert led.slot_exact == Decimal("1.525") and led.slot == Decimal("1.53")
    assert led.rehearsals == Decimal("12.20") and led.plan == Decimal("13.73")
    assert led.planned == Decimal("21.83") and led.remaining == Decimal("18.17")
    assert led.plan_exact == Decimal("13.725") and led.planned_exact == Decimal("21.825")
    # The half-cent cases are exactly why Decimal half-up is used: binary-float round() goes down.
    assert round(1.525, 2) == 1.52 and round(21.825, 2) == 21.82
    # Per-item rounding is not what makes the totals work: rounding the exact totals once agrees.
    assert model.cents(led.plan_exact) == led.plan and model.cents(led.planned_exact) == led.planned
    for fid, claimed in [("live-slot-usd", 1.53), ("rehearsals-plus-slot-usd", 13.73),
                         ("planned-usd", 21.83), ("remaining-usd", 18.17)]:
        fx = _fx(art, fid)
        assert fx["claimed"] == claimed and fx["computed"] == claimed and fx["matches"] is True
        assert fx["printedDecimals"] == 2
    assert (art["ceilingUsd"], art["postedUsd"], art["plannedUsd"], art["remainingAfterPlanUsd"]) == \
        (40.0, 8.10, 21.83, 18.17)
    live = _sc(art, "live-demo")
    assert live["headline"] == "$1.53 for 15 minutes"
    assert "1.525" in live["derivation"] and "half-up" in live["derivation"]
    assert "same" in live["derivation"] and "before summing (the PRD" not in live["derivation"]
    assert live["provenance"]["kind"] == "derived" and live["provenance"]["verification"]["outcome"] == "passed"


def test_B2_published_stella_cpu_hours(art):
    assert model.stella_published_cpu_hours() == 161 * 288 == 46_368
    fx = _fx(art, "stella-published-cpu-h")
    assert fx["claimed"] == 46_368 and fx["matches"] is True and fx["printedDecimals"] == 0
    sc = _sc(art, "stella-published")
    assert "46,368" in sc["headline"] and sc["provenance"]["kind"] == "prd-reported"


def test_B3_full_grid_days_and_dollars_inside_prd_ranges(art):
    fg, hv = model.full_grid(), model.full_grid(0.5)
    assert fg.hours == pytest.approx(65_700 * 19 / 3600) == pytest.approx(346.75)
    assert 14 <= fg.days <= 15 and fg.days == pytest.approx(14.448, abs=1e-3)
    assert 3_100 <= fg.usd <= 3_200 and fg.usd == pytest.approx(3_172.76, abs=0.01)
    assert hv.steps == 131_400 and 28 <= hv.days <= 30 and 6_200 <= hv.usd <= 6_400
    for fid, rng in (("full-grid-days", (14, 15)), ("full-grid-usd", (3_100, 3_200)),
                     ("halved-dt-days", (28, 30)), ("halved-dt-usd", (6_200, 6_400))):
        fx = _fx(art, fid)
        assert fx["matches"] is True and rng[0] <= fx["computed"] <= rng[1]
        # claimed is the midpoint the PRD never printed: the label shows the range and the note says so.
        assert fx["claimed"] == sum(rng) / 2
        assert "PRD range [" in fx["label"]
        assert "claimed = midpoint of PRD range" in fx["note"] and "compare by range, not rounding" in fx["note"]
    # The range check can fail: a 10 % slower step pushes the dollars out of the PRD range.
    assert artifact.range_fixture("x", "x", (3_100, 3_200), fg.usd * 1.1, 0, "USD")["matches"] is False
    assert _sc(art, "full-grid-modal")["provenance"]["verification"]["outcome"] == "passed"


def test_B4_gx_benchmark_is_prd_reported_context_only(art):
    sc = _sc(art, "gx-benchmark")
    assert sc["provenance"]["kind"] == "prd-reported"
    assert "28 minutes on one GPU" in sc["headline"] and "90 minutes on four GPUs" in sc["headline"]
    assert sc["inputs"]["oneGpuMoments"] == "4x8" and sc["inputs"]["fourGpuMoments"] == "8x16"
    for fid in ("gx-1gpu-min", "gx-4gpu-min"):
        fx = _fx(art, fid)
        assert fx["computed"] is None and fx["matches"] is None


def test_B5_pricing_constants_exported_for_budget_guard():
    assert pricing.CEILING_USD == 40.0 and pricing.POSTED_USD == 8.10
    assert pricing.LIVE_RATE_USD_PER_H == 6.10 and pricing.FULL_GRID_RATE_USD_PER_H == 9.15
    assert pricing.LIVE_SLOT_MIN == 15 and pricing.REHEARSAL_H == 1.0 and pricing.N_REHEARSALS == 2
    assert pricing.PRICING_URL == "https://modal.com/pricing"
    # The budget artifact derives from these constants, not from literals.
    assert _sc(artifact.build(), "live-demo")["inputs"]["rateUsdPerH"] == pricing.LIVE_RATE_USD_PER_H
