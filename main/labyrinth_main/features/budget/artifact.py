"""budget.json: live-demo ledger, published/full-grid stella cost, GX benchmark context (B1–B4)."""
from __future__ import annotations

from labyrinth_main.common.provenance import fixture, provenance, source

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
    """The PRD prints a range [lo, hi], never a single value.

    ``claimed`` must be a number in the contract, so it holds the midpoint of the PRD range — a
    value the PRD never printed — and the label and note say so. ``matches`` compares by range
    (lo <= computed <= hi), not by rounding to ``printedDecimals``.
    """
    lo, hi = rng
    rng_txt = f"[{lo:,.{decimals}f}, {hi:,.{decimals}f}] {unit}"
    return {"id": fid, "label": f"{label} — PRD range {rng_txt}",
            "claimed": (lo + hi) / 2, "computed": computed, "printedDecimals": decimals,
            "matches": bool(lo <= computed <= hi),
            "note": (f"claimed = midpoint of PRD range {rng_txt} (the PRD prints only the range, not this value); "
                     f"compare by range, not rounding: computed {computed:,.4g} is "
                     f"{'inside' if lo <= computed <= hi else 'OUTSIDE'} the range.")}


def fixtures() -> list[dict]:
    led = model.live_ledger()
    fg, hv = model.full_grid(), model.full_grid(0.5)
    return [
        fixture("live-slot-usd", "Live slot, 15 min at $6.10/h", PRD_SLOT_USD, float(led.slot), 2,
                f"Exact {led.slot_exact} → ${led.slot} (half-up; binary-float round() would give {round(float(led.slot_exact), 2)})."),
        fixture("rehearsals-plus-slot-usd", "Two 1-h rehearsals + one live slot", PRD_PLAN_USD, float(led.plan), 2,
                f"{led.rehearsals} + {led.slot} = {led.plan}; unrounded {led.plan_exact}. {ROUNDING_NOTE}"),
        fixture("planned-usd", "Planned incl. $8.10 posted", PRD_PLANNED_USD, float(led.planned), 2,
                f"{led.plan} + {led.posted} = {led.planned}; unrounded {led.planned_exact} "
                f"(binary-float round() would give {round(float(led.planned_exact), 2)}). {ROUNDING_NOTE}"),
        fixture("remaining-usd", "Remaining of the $40 ceiling after the plan", TASK_REMAINING_USD,
                float(led.remaining), 2, f"{led.ceiling} − {led.planned}; value from tasks/04-budget/TASK.md "
                "(the PRD implies it but does not print it)."),
        fixture("stella-published-cpu-h", "Published stella bean: 161 h × 288 processors", PRD_STELLA_CPU_H,
                float(model.stella_published_cpu_hours()), 0, "Arithmetic recomputed; inputs are PRD-reported."),
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
    }
