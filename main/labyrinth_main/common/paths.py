"""Repo-relative paths. The backend reads data/ and contracts/, writes artifacts/."""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW = REPO_ROOT / "data" / "raw"
CONTRACTS = REPO_ROOT / "contracts"
ARTIFACTS = REPO_ROOT / "artifacts"

STELLA_BENCHMARK_H5 = RAW / "stella_benchmark_DOI_10_1017_S0022377822000393.h5"
WOUT_W7X_KJM = RAW / "wout_w7x_kjm.nc"
STELLA_TEST2_GEOMETRY = RAW / "stella_test2_vmec_geometry.geometry"
STELLA_TEST2_VMEC_GEO = RAW / "stella_test2_vmec_geometry.vmec.geo"
STELLA_TEST2_INPUT = RAW / "stella_test2_vmec_geometry.in"
