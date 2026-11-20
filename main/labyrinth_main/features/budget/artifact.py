"""budget.json: live-demo ledger, published/full-grid stella cost, GX benchmark context (B1–B4), and the live
budget guard's plan (D-015, D-023).

Every recomputed budget fixture is ``basis: "arithmetic"``: its inputs (prices, hours, step counts) are all
PRD-reported, so the check re-does the PRD's arithmetic and nothing more. The GX benchmark items are not
recomputable (``computed: null``) and carry no basis.
"""
from __future__ import annotations

from dataclasses import replace

from labyrinth_main.common import provenance as prov
from labyrinth_main.common.provenance import fixture, provenance, source

from ..live_gx import budget_guard as guard
from . import model, pricing

ARTIFACT_ID = "budget"
SCHEMA = "budget.schema.json"

# PRD "Budget and presentation figures" (claimed values).
PRD_SLOT_USD = 1.53
PRD_PLAN_USD = 13.73
PRD_PLANNED_USD = 21.83
TASK_REMAINING_USD = 18.17          # tasks/04-budget/TASK.md B1 (implied by the PRD, not printed there)
PRD_STELLA_CPU_H = 46_368
PRD_FULL_DAYS = (14.0, 15.0)
PRD_FULL_USD = (3_100.0, 3_200.0)
PRD_HALVED_DAYS = (28.0, 30.0)
PRD_HALVED_USD = (6_200.0, 6_400.0)

ROUNDING_NOTE = ("Exact decimal arithmetic, rounded half-up to whole cents (the PRD's convention: "
                 "1.525 → $1.53). Rounding per line item or rounding the exact totals once gives the same "
                 "$13.73 and $21.83 here; binary-float round() would give 1.52 / 13.72 / 21.82.")


def _prd_source() -> dict:
    return source("PRD.md · Budget and presentation figures", "PRD.md")


def _pricing_source() -> dict:
    return source("Modal pricing", pricing.PRICING_URL)


def range_fixture(fid: str, label: str, rng: tuple[float, float], computed: float, decimals: int,
                  unit: str) -> dict:
    """The PRD prints a range [lo, hi], never a single value (D-023): ``claimed`` is null, the range is in
    ``claimedRange`` and ``matches`` is lo <= computed <= hi, not rounding to ``printedDecimals``."""
    lo, hi = rng
    inside = lo <= computed <= hi
    return prov.range_fixture(
        fid, label, rng, computed, decimals,
        (f"The PRD prints only the range {lo:,.{decimals}f}–{hi:,.{decimals}f} {unit}; compared by range, not "
         f"rounding: computed {computed:,.4g} {unit} is {'inside' if inside else 'OUTSIDE'} it. "
         "Inputs are PRD-reported (startup-step timing, Modal price)."),
        basis="arithmetic")


def fixtures() -> list[dict]:
    led = model.live_ledger()
    fg, hv = model.full_grid(), model.full_grid(0.5)
    return [
        fixture("live-slot-usd", "Live slot, 15 min at $6.10/h", PRD_SLOT_USD, float(led.slot), 2,
                f"Exact {led.slot_exact} → ${led.slot} (half-up; binary-float round() would give {round(float(led.slot_exact), 2)}).",
                basis="arithmetic"),
        fixture("rehearsals-plus-slot-usd", "Two 1-h rehearsals + one live slot", PRD_PLAN_USD, float(led.plan), 2,
                f"{led.rehearsals} + {led.slot} = {led.plan}; unrounded {led.plan_exact}. {ROUNDING_NOTE}", basis="arithmetic"),
        fixture("planned-usd", "Planned incl. $8.10 posted", PRD_PLANNED_USD, float(led.planned), 2,
                f"{led.plan} + {led.posted} = {led.planned}; unrounded {led.planned_exact} "
                f"(binary-float round() would give {round(float(led.planned_exact), 2)}). {ROUNDING_NOTE}", basis="arithmetic"),
        fixture("remaining-usd", "Remaining of the $40 ceiling after the plan", TASK_REMAINING_USD,
                float(led.remaining), 2, f"{led.ceiling} − {led.planned}; value from tasks/04-budget/TASK.md "
                "(the PRD implies it but does not print it).", basis="arithmetic"),
        fixture("stella-published-cpu-h", "Published stella bean: 161 h × 288 processors", PRD_STELLA_CPU_H,
                float(model.stella_published_cpu_hours()), 0, "Arithmetic recomputed; inputs are PRD-reported.",
                basis="arithmetic"),
        range_fixture("full-grid-days", "Full-grid stella wall time", PRD_FULL_DAYS, fg.days, 0, "days"),
        range_fixture("full-grid-usd", "Full-grid stella cost", PRD_FULL_USD, fg.usd, 0, "USD"),
        range_fixture("halved-dt-days", "Full-grid wall time, halved timestep", PRD_HALVED_DAYS, hv.days, 0, "days"),
        range_fixture("halved-dt-usd", "Full-grid cost, halved timestep", PRD_HALVED_USD, hv.usd, 0, "USD"),
        fixture("gx-1gpu-min", "GX bean benchmark, 1 GPU, 4×8", float(pricing.GX_BENCH_1GPU_MIN), None, 0,
                "PRD-reported published benchmark; no GX run in this repo to recompute it."),
        fixture("gx-4gpu-min", "GX bean benchmark, 4 GPUs, 8×16", float(pricing.GX_BENCH_4GPU_MIN), None, 0,
                "PRD-reported published benchmark; no GX run in this repo to recompute it."),
    ]


def scenarios(fx: list[dict]) -> list[dict]:
    led = model.live_ledger()
    fg, hv = model.full_grid(), model.full_grid(0.5)
    ok = {f["id"]: f["matches"] for f in fx}
    live_ok = all(ok[k] for k in ("live-slot-usd", "rehearsals-plus-slot-usd", "planned-usd", "remaining-usd"))
    fg_ok = all(ok[k] for k in ("full-grid-days", "full-grid-usd", "halved-dt-days", "halved-dt-usd"))
    return [
        {
            "id": "live-demo",
            "title": "Live demo",
            "headline": f"${led.slot} for {pricing.LIVE_SLOT_MIN} minutes",
            "inputs": {"rateUsdPerH": pricing.LIVE_RATE_USD_PER_H, "slotMin": pricing.LIVE_SLOT_MIN,
                       "rehearsals": pricing.N_REHEARSALS, "rehearsalH": pricing.REHEARSAL_H,
                       "postedUsd": pricing.POSTED_USD, "ceilingUsd": pricing.CEILING_USD,
                       "resources": pricing.LIVE_RESOURCES},
            "derivation": (f"slot = {pricing.LIVE_RATE_USD_PER_H:.2f} × {pricing.LIVE_SLOT_MIN}/60 = {led.slot_exact} "
                           f"→ ${led.slot}; rehearsals = {pricing.N_REHEARSALS} × {pricing.REHEARSAL_H:g} h × "
                           f"{pricing.LIVE_RATE_USD_PER_H:.2f} = ${led.rehearsals}; plan = {led.rehearsals} + {led.slot} "
                           f"= ${led.plan}; planned = {led.plan} + {led.posted} posted = ${led.planned}; remaining = "
                           f"{led.ceiling} − {led.planned} = ${led.remaining}. {ROUNDING_NOTE}"),
            "interpretation": (f"Two one-hour rehearsals plus one live slot cost about ${led.plan}; with "
                               f"${led.posted} provisionally posted earlier, ${led.planned} is planned against the "
                               f"${led.ceiling:.0f} ceiling, leaving ${led.remaining}."),
            "provenance": provenance(
                "derived", solver_revision="n/a (cost model)", units="USD",
                coverage="Two 1-h rehearsals + one 15-min live slot + $8.10 posted",
                sources=[_pricing_source(), _prd_source()], runtime="n/a",
                outcome="passed" if live_ok else "failed",
                details=("Recomputed from pricing.py constants; matches the PRD's $1.53 / $13.73 / $21.83 at 2 dp"
                         if live_ok else "Recomputed ledger does not match the PRD; see fixtures")),
        },
        {
            "id": "stella-published",
            "title": "Published full-resolution stella bean tube",
            "headline": (f"{pricing.STELLA_PUBLISHED_HOURS} hours on {pricing.STELLA_PUBLISHED_PROCESSORS} processors, "
                         f"{model.stella_published_cpu_hours():,} CPU-hours"),
            "inputs": {"hours": pricing.STELLA_PUBLISHED_HOURS, "processors": pricing.STELLA_PUBLISHED_PROCESSORS},
            "derivation": (f"{pricing.STELLA_PUBLISHED_HOURS} h × {pricing.STELLA_PUBLISHED_PROCESSORS} = "
                           f"{model.stella_published_cpu_hours():,} CPU-h"),
            "interpretation": "Measured on the authors' system for one local tube.",
            "provenance": provenance(
                "prd-reported", solver_revision="stella (published run; revision not stated in PRD)", units="CPU-hours",
                coverage="one local flux tube (bean), full resolution", sources=[_prd_source()],
                runtime=f"{pricing.STELLA_PUBLISHED_HOURS} h on {pricing.STELLA_PUBLISHED_PROCESSORS} processors (PRD-reported)",
                outcome="not-applicable",
                details="Published measurement; only the product 161 × 288 is recomputed here."),
        },
        {
            "id": "full-grid-modal",
            "title": "Full-grid stella on Modal to normalized time 1900",
            "headline": (f"{fg.days:.1f} days, ${fg.usd:,.0f}; halved timestep: {hv.days:.1f} days, ${hv.usd:,.0f}"),
            "inputs": {"steps": pricing.FULL_GRID_STEPS, "secondsPerStep": pricing.FULL_GRID_S_PER_STEP,
                       "rateUsdPerH": pricing.FULL_GRID_RATE_USD_PER_H, "targetTime": pricing.FULL_GRID_TARGET_TIME,
                       "resources": pricing.FULL_GRID_RESOURCES},
            "derivation": (f"{pricing.FULL_GRID_STEPS:,} × {pricing.FULL_GRID_S_PER_STEP:g} s = {fg.hours:,.2f} h = "
                           f"{fg.days:.2f} d; × ${pricing.FULL_GRID_RATE_USD_PER_H:.2f}/h = ${fg.usd:,.2f}. Halved "
                           f"timestep: {hv.steps:,} steps = {hv.hours:,.2f} h = {hv.days:.2f} d, ${hv.usd:,.2f}."),
            "interpretation": ("Estimate from three explicit-streaming startup steps. Long-run timestep, I/O and "
                               "restarts can change the total."),
            "provenance": provenance(
                "derived", solver_revision="stella (startup-step timing; revision not stated in PRD)", units="days, USD",
                coverage="three startup steps extrapolated to normalised time 1900",
                sources=[_pricing_source(), _prd_source()], runtime="n/a (estimate)",
                outcome="passed" if fg_ok else "failed",
                details=("Recomputed days and dollars fall inside the PRD's printed ranges" if fg_ok
                         else "Recomputed values fall outside the PRD ranges; see fixtures")),
        },
        {
            "id": "gx-benchmark",
            "title": "Published GPU-native GX bean benchmark",
            "headline": (f"{pricing.GX_BENCH_1GPU_MIN} minutes on one GPU (4 Laguerre × 8 Hermite); "
                         f"{pricing.GX_BENCH_4GPU_MIN} minutes on four GPUs (8 × 16)"),
            "inputs": {"oneGpuMin": pricing.GX_BENCH_1GPU_MIN, "oneGpuMoments": "4x8",
                       "fourGpuMin": pricing.GX_BENCH_4GPU_MIN, "fourGpuMoments": "8x16"},
            "derivation": "None: published figures, quoted as context.",
            "interpretation": ("Different velocity resolutions. Use as rehearsal context; only a measured "
                               "Labyrinth run establishes its timing."),
            "provenance": provenance(
                "prd-reported", solver_revision="GX (published benchmark, §6.2)", units="minutes",
                coverage="published GX bean benchmark", sources=[source("GX benchmark §6.2", pricing.GX_BENCHMARK_URL),
                                                                  _prd_source()],
                runtime=f"{pricing.GX_BENCH_1GPU_MIN} min (1 GPU), {pricing.GX_BENCH_4GPU_MIN} min (4 GPUs), PRD-reported",
                outcome="not-applicable", details="Context only; no Labyrinth GX run has been measured (D-011)."),
        },
    ]


def guard_plan() -> dict:
    """The live budget guard's plan (D-015), priced by ``live_gx/budget_guard.py`` itself (single source, D-023).

    The guard is asked exactly what the rehearsal CLI and the live service ask it, in plan order: two rehearsal
    allocations, then one live slot. Each is evaluated against a reconciled ledger (the PRD requires reconciling
    before every allocation) holding the posted amount plus every earlier allocation reserved at its estimate.
    Nothing here re-derives the guard's formula."""
    ledger = guard.Ledger(billed=0.0, pending=float(model.live_ledger().posted), reconciled=True)
    steps = [(f"rehearsal {i}", {"slot_min": pricing.REHEARSAL_H * 60.0, "setups": guard.REHEARSAL_SETUPS})
             for i in range(1, pricing.N_REHEARSALS + 1)] + [("live slot", {})]
    decided = []
    for name, ask in steps:
        d = guard.evaluate(ledger, **ask)
        decided.append((name, d))
        ledger = replace(ledger.reserve(d.slot_estimate_usd), reconciled=True)
    rehearsals = [d for name, d in decided if name.startswith("rehearsal")]
    slot = decided[-1][1]
    total = round(ledger.billed + ledger.pending, 2)
    refused = [name for name, d in decided if not d.approved]
    ceiling = slot.ceiling_usd
    verdict = (f"The guard approves every step against the ${ceiling:.2f} ceiling: the plan fits." if not refused else
               f"The guard refuses {', '.join(refused)}: the plan does NOT fit the ${ceiling:.2f} ceiling.")
    assumptions = (
        f"Priced by the live budget guard (D-015): rate ${pricing.LIVE_RATE_USD_PER_H:.2f}/h × (allocation + "
        f"{guard.SETUP_MIN:g} min setup per launch + {guard.IDLE_MARGIN_MIN:g} min idle margin) + "
        f"${guard.STORAGE_EGRESS_USD:.2f} storage/egress, rounded up to the cent. A rehearsal is "
        f"{pricing.REHEARSAL_H:g} h with {guard.REHEARSAL_SETUPS} launches (initialization + checkpoint continuation); "
        f"the live slot is {pricing.LIVE_SLOT_MIN} min with 1 launch. The setup, idle and storage/egress allowances are "
        "Labyrinth's assumptions, not PRD numbers, and are unmeasured until a rehearsal replaces them; rate and lengths "
        f"are PRD. Plan: ${model.live_ledger().posted} posted + {pricing.N_REHEARSALS} rehearsals + 1 live slot, each "
        f"evaluated on a reconciled ledger with every earlier allocation reserved at its estimate. {verdict}")
    return {
        "slotEstimateUsd": slot.slot_estimate_usd,
        "rehearsalEstimateUsd": max(d.slot_estimate_usd for d in rehearsals),
        "slotHardTimeoutS": int(slot.hard_timeout_s),
        "rehearsalHardTimeoutS": int(min(d.hard_timeout_s for d in rehearsals)),
        "plannedTotalUsd": total,
        "assumptions": assumptions,
    }


def build() -> dict:
    led = model.live_ledger()
    fx = fixtures()
    return {
        "schemaVersion": 1,
        "ceilingUsd": float(led.ceiling),
        "postedUsd": float(led.posted),
        "plannedUsd": float(led.planned),
        "remainingAfterPlanUsd": float(led.remaining),
        "scenarios": scenarios(fx),
        "fixtures": fx,
        "guardPlan": guard_plan(),
    }
