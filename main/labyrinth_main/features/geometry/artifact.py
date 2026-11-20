"""Artifact ``geometry.json`` (contract ``geometry.schema.json``): Locate the tubes, replay."""
from __future__ import annotations

import math

from ... import __version__
from ...common import paths
from ...common.provenance import STELLA_BLOB, STELLA_COMMIT, provenance, source
from . import stella_reference, tubes
from .vmec import VmecEquilibrium

ARTIFACT_ID = "geometry"
SCHEMA = "geometry.schema.json"

WOUT_URL = f"{STELLA_BLOB}/AUTOMATIC_TESTS/numerical_tests/test_5_fluxtube/wout_w7x_kjm.nc"
TEST2_DIR = f"{STELLA_BLOB}/AUTOMATIC_TESTS/numerical_tests/test_2_geometry"
GEOMETRY_URL = f"{TEST2_DIR}/EXPECTED_OUTPUT.vmec_geometry.geometry"
OUT_NC_URL = f"{TEST2_DIR}/EXPECTED_OUTPUT.vmec_geometry.out.nc"

ACCEPTANCE_129_DETAILS = (
    "BLOCKED (decision D-007): the PRD acceptance test compares bean |B| with 129 saved stella samples "
    "at rho 0.8, but those samples are not in this repo or at the cited stella commit "
    f"{STELLA_COMMIT[:8]} (only rho 0.7 W7-X VMEC outputs with 13-25 samples exist there: test_2, test_5, "
    "test_7). The tracer is instead validated against stella's saved rho 0.7 geometry (25 samples). "
    "Unblock: add the stella .geometry/.out.nc file holding the 129 samples to data/raw/."
)


def build() -> dict:
    eq = VmecEquilibrium(paths.WOUT_W7X_KJM)
    wout_src = source("W7-X high-mirror VMEC equilibrium wout_w7x_kjm.nc (stella test_5_fluxtube)",
                      WOUT_URL, paths.WOUT_W7X_KJM)
    geo_src = source("stella EXPECTED_OUTPUT.vmec_geometry.geometry (test_2_geometry, rho 0.7, 25 samples)",
                     GEOMETRY_URL, paths.STELLA_TEST2_GEOMETRY)

    ref = stella_reference.compare(eq, paths.STELLA_TEST2_GEOMETRY, paths.STELLA_TEST2_INPUT)
    ok = ref["allWithinPrintedPrecision"]
    f64 = stella_reference.compare_out_nc(eq, paths.STELLA_TEST2_INPUT, paths.STELLA_TEST2_OUT_NC)
    f64_ok = f64["allWithinTolerance"]
    # The tracer validation passes only when BOTH checks of the rho 0.7 run pass: stella's printed .geometry at its
    # printed precision and stella's float64 out.nc within FLOAT64_TOLERANCE (BE-DATA-5, D-023 §4).
    tracer_ok = ok and f64_ok
    tolerance = stella_reference.FLOAT64_TOLERANCE
    # D-023 §4: the float64 errors (~3e-13) are published as upper bounds (publish_bound: x1.2, rounded UP to one
    # significant figure) because their later digits move with last-bit differences between CPUs / BLAS kernels and
    # the artifact must rebuild byte-identically. The prose prints the same bounds; allWithinTolerance is decided on
    # the unrounded values.
    max_abs_bound = stella_reference.publish_bound(f64["maxAbsErrorBmag"])
    max_rel_bound = stella_reference.publish_bound(f64["maxRelErrorBmag"])
    out_nc_src = source("stella EXPECTED_OUTPUT.vmec_geometry.out.nc (test_2_geometry, float64 bmag)",
                        OUT_NC_URL, paths.STELLA_TEST2_OUT_NC)

    s = tubes.RHO**2
    surf = eq.surface(s)
    boundary_surf = eq.surface(1.0)
    tube_records = [tubes.tube_record(eq, surf, spec) for spec in tubes.TUBES]
    boundary = {}
    for spec in tubes.TUBES:
        R, Z = tubes.cross_section(boundary_surf, math.radians(spec["zetaCenterDeg"]))
        boundary[spec["id"]] = {"R": R, "Z": Z}

    # BE-DATA-9: allWithinTolerance has two terms (bmag, zed grid); a failure names the one(s) outside the tolerance.
    # The zed offset is printed only on failure (as a published bound): in a passing build it would be raw noise.
    zed_bound = f"max zed offset <= {stella_reference.publish_bound(f64['maxAbsErrorZed']):g}"
    if f64_ok:
        f64_verdict = f"every sample and the zed grid within tolerance {tolerance:g}"
    elif not f64["zedWithinTolerance"] and f64["bmagWithinTolerance"]:
        f64_verdict = f"every bmag sample within tolerance {tolerance:g} but the zed grid OUTSIDE it ({zed_bound})"
    elif not f64["zedWithinTolerance"]:
        f64_verdict = f"OUTSIDE tolerance {tolerance:g} on bmag and on the zed grid ({zed_bound})"
    else:
        f64_verdict = f"OUTSIDE tolerance {tolerance:g} on bmag (the zed grid within it)"
    details = (
        "PRD acceptance (bean |B| vs 129 saved stella samples at rho 0.8): BLOCKED, samples not available "
        "(D-007). Tracer validated vs stella rho 0.7: " + ("passed" if tracer_ok else "FAILED") + " "
        f"({ref['samplesCompared']} samples, 4 significant figures: bmag max |error| {ref['maxAbsError']:.3g}, "
        f"max rel {ref['maxRelError']:.3g}, zeta max |error| {ref['maxAbsErrorZeta']:.3g}; "
        + ("every zeta and bmag within half a unit in the last printed place"
           if ok else "NOT all samples within printed precision")
        + f"; vs stella's float64 out.nc bmag over {f64['samplesCompared']} samples: max |error| <= "
        f"{max_abs_bound:g}, max rel <= {max_rel_bound:g}, {f64_verdict})."
    )
    float64_reference = {
        "samplesCompared": f64["samplesCompared"],
        "tolerance": tolerance,
        "maxAbsError": max_abs_bound,
        "maxRelError": max_rel_bound,
        "allWithinTolerance": f64_ok,
        "source": out_nc_src,
    }
    units = (
        "R, Z, x, y, z in m; thetaStar, zeta, alpha in rad; bmag = |B|/B_ref with stella's "
        f"B_ref = 2|Phi_edge/2pi|/a^2 = {eq.b_ref:.6g} T, a = Aminor_p = {eq.l_ref:.6g} m"
    )
    coverage = (
        f"rho {tubes.RHO} (s {s:.2f}, iota {surf.iota:.6g}); bean (zeta_c 0 deg) and triangular "
        f"(zeta_c 36 deg) tubes, one poloidal turn theta* in [-pi, pi], {tubes.N_SAMPLES} samples each, "
        "alpha = -iota*zeta_c (D-010, stella convention theta* = alpha + iota*zeta). Surface mesh "
        f"{tubes.SURFACE_N_PHI} phi x {tubes.SURFACE_N_THETA} VMEC theta, periodic (no duplicated seam); "
        f"cross-sections closed polylines of {tubes.CROSS_SECTION_POINTS} points in VMEC theta."
    )
    return {
        "schemaVersion": 1,
        "equilibrium": {
            "name": "wout_w7x_kjm",
            "configuration": "W7-X high-mirror (KJM)",
            "nfp": eq.nfp,
            "source": wout_src,
        },
        "surface": {
            "rho": tubes.RHO,
            "s": s,
            "iota": surf.iota,
            "nTheta": tubes.SURFACE_N_THETA,
            "nPhi": tubes.SURFACE_N_PHI,
            "positions": tubes.surface_mesh(surf),
            "boundary": boundary,
        },
        "tubes": tube_records,
        "validation": {
            "stellaReference": {
                "samplesCompared": ref["samplesCompared"],
                "printedSignificantFigures": ref["printedSignificantFigures"],
                "maxAbsError": ref["maxAbsError"],
                "maxRelError": ref["maxRelError"],
                "allWithinPrintedPrecision": ok,
                "source": geo_src,
            },
            "float64Reference": float64_reference,
            "acceptance129": {"outcome": "blocked", "details": ACCEPTANCE_129_DETAILS},
        },
        "provenance": provenance(
            "derived",
            solver_revision=(f"labyrinth_main {__version__} VMEC straight-field-line tracer "
                             f"(stella {STELLA_COMMIT[:8]} conventions)"),
            units=units,
            coverage=coverage,
            sources=[wout_src, geo_src, out_nc_src],
            # The PRD acceptance is blocked, so the overall outcome must never read "passed" (D-007); a failed
            # tracer validation (printed-precision OR float64 check) is still reported as "failed".
            outcome="blocked" if tracer_ok else "failed",
            details=details,
            runtime="not recorded (artifact is byte-deterministic; no wall-clock values are stored)",
        ),
    }
