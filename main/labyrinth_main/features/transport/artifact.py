"""transport.json: archived bean traces, window statistics, triangular mean, fixtures (T1–T7)."""
from __future__ import annotations

from labyrinth_main.common.provenance import fixture, provenance, source

from . import units
from .archive import (
    CODES,
    UNITS_HEAT_FLUX,
    UNITS_TIME,
    load_trace,
    trace_provenance,
)
from .stats import METHOD_SUMMARY, sample_span_trapezoid_mean, sig, window_stats

ARTIFACT_ID = "transport"
SCHEMA = "transport.schema.json"

COMMON_WINDOWS = ((200.0, 300.0), (300.0, 400.0), (1500.0, 1900.0))
EXTRA_WINDOWS = {"GENE": ((1500.0, 1893.765),)}

# PRD "Accuracy fixtures" (claimed values, printed precision).
PRD_STELLA_1500_1900 = 2.242
PRD_GENE_1500_1893 = 2.474
PRD_REDUCED_MODAL_300_400 = 5.79
PRD_ARCHIVE_STELLA_300_400 = 2.55
PRD_ARCHIVE_GENE_300_400 = 2.68
PRD_TRIANGULAR_MEAN = 2.22
TRIANGULAR_WINDOW = (1200.0, 1500.0)
TRIANGULAR_STATUS = ("PRD-reported; not checked against the paper (González-Jerez et al. 2022, "
                     "doi:10.1017/S0022377822000393)")
REDUCED_WINDOW = (300.0, 400.0)


def windows_for(code: str) -> tuple[tuple[float, float], ...]:
    return COMMON_WINDOWS + EXTRA_WINDOWS.get(code, ())


def window_rows() -> list[dict]:
    rows = []
    for code in CODES:
        tr = load_trace(code)
        for w in windows_for(code):
            s = window_stats(tr.t, tr.q, w)
            rows.append({
                "traceId": tr.id, "window": list(w), "covered": s.covered, "nSamples": s.n_samples,
                # Statistics derived from autocorrelation estimates are rounded to 4 significant
                # figures so that FFT/BLAS round-off across numpy versions cannot change the bytes.
                "mean": s.mean, "stderr": sig(s.stderr), "stationary": s.stationary,
                "stationarityDetail": f"{s.detail} Method: {METHOD_SUMMARY}.",
                "saturatedClaimAllowed": s.saturated_claim_allowed,
            })
    return rows


def _mean_fixture(fid: str, label: str, claimed: float, code: str, window: tuple[float, float],
                  decimals: int, extra: str = "") -> dict:
    tr = load_trace(code)
    s = window_stats(tr.t, tr.q, window)
    alt = sample_span_trapezoid_mean(tr.t, tr.q, window)
    err = ("not finite (autocorrelation time not resolved in this window)" if s.stderr is None
           else f"{s.stderr:.3g}{' (approximate)' if s.approximate else ''}")
    note = (f"Time-weighted mean (1/(b-a))∫Q dt over [{window[0]:.10g}, {window[1]:.10g}], Q linearly "
            f"interpolated at the edges (D-013) = {s.mean:.5f}; autocorrelation-corrected stderr "
            f"{err}. Definition sensitivity: the sample-span trapezoid (only samples with "
            f"a<=t<=b, divided by t_last-t_first; {s.n_samples} samples) gives {alt:.5f} "
            f"(prints as {alt:.{decimals}f}).")
    if extra:
        note = f"{note} {extra}"
    return fixture(fid, label, claimed, s.mean, decimals, note)


def fixtures() -> list[dict]:
    out = [
        _mean_fixture("stella-bean-1500-1900", "stella bean mean, 1500–1900", PRD_STELLA_1500_1900,
                      "stella", (1500.0, 1900.0), 3),
        _mean_fixture("gene-bean-1500-1893.765", "GENE bean mean, 1500–1893.765", PRD_GENE_1500_1893,
                      "GENE", (1500.0, 1893.765), 3),
        _mean_fixture("stella-bean-300-400", "stella archive mean, 300–400", PRD_ARCHIVE_STELLA_300_400,
                      "stella", REDUCED_WINDOW, 2),
        _mean_fixture(
            "gene-bean-300-400", "GENE archive mean, 300–400", PRD_ARCHIVE_GENE_300_400, "GENE",
            REDUCED_WINDOW, 2,
            extra=("This fixture is definition-sensitive: the edge-interpolated mean reproduces 2.68, the "
                   "sample-span trapezoid would not (D-009, superseded by D-013). The two definitions differ "
                   "by about 0.0008, far less than the window's sampling uncertainty."),
        ),
        fixture("reduced-modal-stella-300-400", "Reduced Modal stella run mean, 300–400",
                PRD_REDUCED_MODAL_300_400, None, 2,
                "PRD-reported; the reduced Modal run's trace is not in this repo, so it cannot be recomputed."),
        fixture("triangular-published-1200-1500", "Triangular published mean, 1200–1500", PRD_TRIANGULAR_MEAN,
                None, 2, f"{TRIANGULAR_STATUS}. The raw triangular trace is unverified and not emitted."),
    ]
    return out


def reduced_modal_run() -> dict:
    archive = {}
    for code in CODES:
        tr = load_trace(code)
        archive[code] = window_stats(tr.t, tr.q, REDUCED_WINDOW).mean
    return {
        "value": PRD_REDUCED_MODAL_300_400,
        "window": list(REDUCED_WINDOW),
        "archive": archive,
        "provenance": provenance(
            "prd-reported",
            solver_revision="unknown (reduced-resolution stella run on Modal; revision not recorded in PRD)",
            units=f"{UNITS_HEAT_FLUX} vs {UNITS_TIME}",
            coverage="300–400 window mean only (PRD); no trace in repo",
            t_start=REDUCED_WINDOW[0], t_end=REDUCED_WINDOW[1],
            sources=[source("PRD.md · Accuracy fixtures", "PRD.md")],
            outcome="blocked",
            details=("Number stated in PRD.md; the run's output is not in this repo so it cannot be "
                     "recomputed. Archive values beside it are recomputed time-weighted window means (D-013)."),
        ),
    }


def triangular() -> dict:
    return {
        "publishedMean": PRD_TRIANGULAR_MEAN,
        "window": list(TRIANGULAR_WINDOW),
        "rawTraceStatus": "unverified",
        "source": source(f"PRD.md · Accuracy fixtures — triangular published mean 2.22 over 1200–1500. "
                         f"{TRIANGULAR_STATUS}", "PRD.md"),
    }


def build() -> dict:
    traces = []
    for code in CODES:
        tr = load_trace(code)
        traces.append({"id": tr.id, "code": code, "tube": "bean", "t": tr.t, "Q": tr.q,
                       "provenance": trace_provenance(tr)})
    return {
        "schemaVersion": 1,
        "units": {"time": UNITS_TIME, "heatFlux": UNITS_HEAT_FLUX},
        "traces": traces,
        "windows": window_rows(),
        "triangular": triangular(),
        "reducedModalRun": reduced_modal_run(),
        "unitConversion": {"timeMultiplier": units.TIME_MULTIPLIER,
                           "heatFluxDivisor": units.HEAT_FLUX_DIVISOR, "validity": units.VALIDITY},
        "fixtures": fixtures(),
    }
