"""forecast.json: persistence vs frozen forecast replay on the stella bean trace (F1–F3)."""
from __future__ import annotations

from labyrinth_main.common.provenance import fixture, provenance
from labyrinth_main.features.transport.archive import (
    RUNTIME,
    SOLVER_REVISION,
    UNITS,
    archive_source,
    benchmark_paper_source,
    load_trace,
)
from labyrinth_main.features.transport.stats import sample_and_hold_mean

from . import model

ARTIFACT_ID = "forecast"
SCHEMA = "forecast.schema.json"

PRD_MAE_PERSISTENCE = 0.0444
PRD_MAE_FROZEN = 0.0423
DECIMALS = 4


# The four archive-mean PRD fixtures (transport), used to show that no tested window-mean
# definition reproduces all six PRD numbers (4 means + 2 MAEs).
ARCHIVE_MEAN_FIXTURES = (
    ("stella", (300.0, 400.0), 2.55, 2),
    ("GENE", (300.0, 400.0), 2.68, 2),
    ("stella", (1500.0, 1900.0), 2.242, 3),
    ("GENE", (1500.0, 1893.765), 2.474, 3),
)
SAMPLE_AND_HOLD = "time-weighted sample-and-hold (zero-order hold, edge-clipped)"


def sensitivity() -> dict[str, dict]:
    tr = load_trace("stella")
    return {name: model.run(tr.t, tr.q, fn, forecast_mean=None)["mae"] for name, fn in model.VARIANTS.items()}


def look_ahead_effect() -> dict:
    """MAE with and without the one-sample look-ahead at the forecaster's right edge."""
    tr = load_trace("stella")
    return {"oneSided": model.run(tr.t, tr.q)["mae"],
            "lookAhead": model.run(tr.t, tr.q, forecast_mean=None)["mae"]}


def sample_and_hold_archive_means() -> list[dict]:
    out = []
    for code, w, claimed, dec in ARCHIVE_MEAN_FIXTURES:
        tr = load_trace(code)
        v = sample_and_hold_mean(tr.t, tr.q, w)
        out.append({"code": code, "window": w, "claimed": claimed, "value": v, "decimals": dec,
                    "matches": round(v, dec) == round(claimed, dec)})
    return out


def _note(matched: bool) -> str:
    sens = sensitivity()
    sh = sens[SAMPLE_AND_HOLD]
    sh_hits = (round(sh["persistence"], DECIMALS) == PRD_MAE_PERSISTENCE
               and round(sh["frozen"], DECIMALS) == PRD_MAE_FROZEN)
    sh_means = sample_and_hold_archive_means()
    misses = [f"{m['code']} {m['window'][0]:g}–{m['window'][1]:g} = {m['value']:.{m['decimals'] + 2}f} "
              f"(prints {m['value']:.{m['decimals']}f}, PRD {m['claimed']})" for m in sh_means if not m["matches"]]
    la = look_ahead_effect()
    others = "; ".join(f"{k}: {v['persistence']:.6f} / {v['frozen']:.6f}" for k, v in sens.items()
                       if k != SAMPLE_AND_HOLD)
    sh_txt = (f"A time-weighted sample-and-hold (zero-order hold, edge-clipped) window mean "
              f"{'reproduces BOTH' if sh_hits else 'does not reproduce both'} PRD scores "
              f"(persistence {sh['persistence']:.6f} → {sh['persistence']:.4f}, frozen {sh['frozen']:.6f} → "
              f"{sh['frozen']:.4f})")
    if misses:
        sh_txt += (f" but gives {', '.join(misses)} for the transport fixtures, so no single tested definition "
                   f"reproduces all six PRD numbers")
    return (f"Computed with the stated method and the time-weighted edge-interpolated window mean (D-013), "
            f"forecasts held at the right edge (no look-ahead); not tuned to the PRD (D-008); the MAE "
            f"fixtures {'match' if matched else 'do not match'}. {sh_txt}. D-013 is kept for every window mean. Other definitions "
            f"(persistence / frozen MAE): {others}. Removing the look-ahead changes the MAE from "
            f"{la['lookAhead']['persistence']:.6f} / {la['lookAhead']['frozen']:.6f} to "
            f"{la['oneSided']['persistence']:.6f} / {la['oneSided']['frozen']:.6f}.")


def build() -> dict:
    tr = load_trace("stella")
    res = model.run(tr.t, tr.q)
    matched = (round(res["mae"]["persistence"], DECIMALS) == PRD_MAE_PERSISTENCE
               and round(res["mae"]["frozen"], DECIMALS) == PRD_MAE_FROZEN)
    note = _note(matched)
    w0, w1 = model.INIT_WINDOW[0], model.step_windows()[-1][1]
    fixtures = [
        fixture("mae-persistence", "stella MAE, persistence forecast", PRD_MAE_PERSISTENCE,
                res["mae"]["persistence"], DECIMALS, note),
        fixture("mae-frozen", "stella MAE, frozen forecast", PRD_MAE_FROZEN, res["mae"]["frozen"], DECIMALS, note),
    ]
    reproduced = all(f["matches"] for f in fixtures)
    verdict = ("reproduce" if reproduced else
               "do not reproduce at printed precision with the stated method (D-008)")
    return {
        "schemaVersion": 1,
        "traceId": tr.id,
        "initWindow": list(model.INIT_WINDOW),
        "windowWidth": model.WIDTH,
        "method": model.METHOD,
        "steps": res["steps"],
        "mae": res["mae"],
        "fixtures": fixtures,
        "provenance": provenance(
            "derived",
            solver_revision=SOLVER_REVISION["stella"],
            units=UNITS,
            coverage=f"stella bean trace, init [{w0:g},{model.INIT_WINDOW[1]:g}] + {model.N_STEPS} windows to {w1:g}",
            t_start=w0, t_end=w1,
            runtime=RUNTIME["stella"],
            sources=[archive_source(), benchmark_paper_source()],
            outcome="passed" if reproduced else "failed",
            details=(f"Recomputed MAE persistence {res['mae']['persistence']:.4f} vs PRD {PRD_MAE_PERSISTENCE}, "
                     f"frozen {res['mae']['frozen']:.4f} vs PRD {PRD_MAE_FROZEN}: the PRD scores {verdict}."),
        ),
    }
