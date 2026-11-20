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
        # D-023: the PRD prints only a range, so there is no single claimed value (no invented midpoint).
        assert fx["claimed"] is None and fx["claimedRange"] == [float(rng[0]), float(rng[1])]
        assert fx["basis"] == "arithmetic" and fx["printedDecimals"] == 0
        assert "midpoint" not in fx["label"] + fx["note"] and "inside" in fx["note"]
    # The range check can fail: a 10 % slower step pushes the dollars out of the PRD range.
    out = artifact.range_fixture("x", "x", (3_100, 3_200), fg.usd * 1.1, 0, "USD")
    assert out["matches"] is False and "OUTSIDE" in out["note"]
    assert _sc(art, "full-grid-modal")["provenance"]["verification"]["outcome"] == "passed"


def test_B3_range_fixture_drives_scenario_verdict(monkeypatch):
    """A step time outside the PRD range fails the range fixtures and the scenario (no midpoint rounding involved)."""
    monkeypatch.setattr(pricing, "FULL_GRID_S_PER_STEP", 19.0 * 1.1)
    a = artifact.build()
    assert _fx(a, "full-grid-usd")["matches"] is False and _fx(a, "full-grid-usd")["claimed"] is None
    assert _sc(a, "full-grid-modal")["provenance"]["verification"]["outcome"] == "failed"


def test_B6_fixture_basis_marks_arithmetic_only_checks(art):
    """D-023 §1: basis comes from the artifact. Every budget check that is recomputed only re-does arithmetic on
    PRD-reported inputs (prices, hours, step counts); nothing here is data-backed. Not-recomputable items carry no basis."""
    by_id = {f["id"]: f for f in art["fixtures"]}
    arithmetic = {"live-slot-usd", "rehearsals-plus-slot-usd", "planned-usd", "remaining-usd", "stella-published-cpu-h",
                  "full-grid-days", "full-grid-usd", "halved-dt-days", "halved-dt-usd"}
    assert {k for k, f in by_id.items() if f.get("basis") == "arithmetic"} == arithmetic
    for fid in ("gx-1gpu-min", "gx-4gpu-min"):
        assert "basis" not in by_id[fid] and by_id[fid]["computed"] is None
    assert all(f.get("basis") in (None, "arithmetic") for f in by_id.values())
    assert all(f["computed"] is not None for f in by_id.values() if f.get("basis") == "arithmetic")


# ---- D-023 §5: the live budget guard's plan, from the guard itself (D-015) -------------------------------------------
def test_B7_guard_plan_comes_from_the_live_budget_guard(art):
    from labyrinth_main.features.live_gx import budget_guard as guard

    plan = art["guardPlan"]
    assert set(plan) == {"slotEstimateUsd", "rehearsalEstimateUsd", "slotHardTimeoutS", "rehearsalHardTimeoutS",
                         "plannedTotalUsd", "assumptions"}
    # D-015 values today
    assert (plan["slotEstimateUsd"], plan["rehearsalEstimateUsd"]) == (2.65, 7.73)
    assert (plan["slotHardTimeoutS"], plan["rehearsalHardTimeoutS"]) == (1500, 4500)
    assert plan["plannedTotalUsd"] == 26.21
    # ... and they are the guard's own answers
    assert plan["slotEstimateUsd"] == guard.slot_estimate_usd()
    assert plan["rehearsalEstimateUsd"] == guard.rehearsal_estimate_usd()
    assert plan["slotHardTimeoutS"] == guard.evaluate(guard.Ledger(0.0, 0.0, True)).hard_timeout_s
    assert plan["rehearsalHardTimeoutS"] == guard.evaluate(
        guard.Ledger(0.0, 0.0, True), slot_min=pricing.REHEARSAL_H * 60, setups=guard.REHEARSAL_SETUPS).hard_timeout_s
    posted = float(model.live_ledger().posted)
    assert plan["plannedTotalUsd"] == round(posted + pricing.N_REHEARSALS * plan["rehearsalEstimateUsd"]
                                            + plan["slotEstimateUsd"], 2)
    assert isinstance(plan["slotHardTimeoutS"], int) and isinstance(plan["rehearsalHardTimeoutS"], int)
    # the D-015 allowances are named with the guard's values, and labelled as assumptions, not PRD numbers
    text = plan["assumptions"]
    assert f"{guard.SETUP_MIN:g} min setup" in text and f"{guard.IDLE_MARGIN_MIN:g} min idle" in text
    assert f"${guard.STORAGE_EGRESS_USD:.2f} storage/egress" in text
    assert "D-015" in text and "not PRD numbers" in text and "rounded up to the cent" in text
    assert "fits" in text and "$40.00" in text
    # the PRD's GPU-only plan stays separate and different
    assert art["plannedUsd"] == 21.83 and plan["plannedTotalUsd"] != art["plannedUsd"]


def test_B7_guard_plan_is_recomputed_not_a_literal(monkeypatch):
    from labyrinth_main.features.live_gx import budget_guard as guard

    monkeypatch.setattr(guard, "IDLE_MARGIN_MIN", 10.0)  # every allocation 5 min longer
    plan = artifact.build()["guardPlan"]
    assert plan["slotEstimateUsd"] == guard.ceil_cents(6.10 * 30 / 60 + 0.10) == 3.15
    assert plan["rehearsalEstimateUsd"] == guard.ceil_cents(6.10 * 80 / 60 + 0.10) == 8.24
    assert (plan["slotHardTimeoutS"], plan["rehearsalHardTimeoutS"]) == (1800, 4800)
    assert plan["plannedTotalUsd"] == round(8.10 + 2 * 8.24 + 3.15, 2) == 27.73
    assert "10 min idle" in plan["assumptions"]
    monkeypatch.setattr(pricing, "POSTED_USD", 9.10)
    assert artifact.build()["guardPlan"]["plannedTotalUsd"] == 28.73


def test_B7_guard_plan_says_when_it_does_not_fit(monkeypatch):
    """With a posted amount that leaves too little, the guard cuts the timeout and the plan says it does not fit."""
    from labyrinth_main.features.live_gx import budget_guard as guard

    monkeypatch.setattr(pricing, "POSTED_USD", 30.00)
    plan = artifact.build()["guardPlan"]
    assert plan["plannedTotalUsd"] == round(30.00 + 2 * 7.73 + 2.65, 2) == 48.11
    assert "does NOT fit" in plan["assumptions"] and "refuses rehearsal 2, live slot" in plan["assumptions"]
    # the guard caps the second rehearsal and the slot to what is left; the plan reports the guard's own (lowest) caps
    assert plan["rehearsalHardTimeoutS"] == guard.hard_timeout_s(40.0 - 37.73, 60.0, setups=2) == 1280
    assert plan["slotHardTimeoutS"] == guard.hard_timeout_s(40.0 - 30.0 - 2 * 7.73) == 0


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
