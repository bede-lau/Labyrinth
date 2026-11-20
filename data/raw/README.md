# Pinned raw inputs

Committed so replay needs no network and $0. Integrity is enforced by
`main/tests/test_common.py::test_raw_inputs_match_pinned_sha256`.

| File | Upstream | sha256 |
|---|---|---|
| `stella_benchmark_DOI_10_1017_S0022377822000393.h5` | stellaGK/stella @ `6f60964d` `AUTOMATIC_TESTS/quick_benchmarks/DOI_10_1017_S0022377822000393.h5` | `8560015e…9d4a` |
| `wout_w7x_kjm.nc` | stellaGK/stella @ `6f60964d` `AUTOMATIC_TESTS/numerical_tests/test_5_fluxtube/wout_w7x_kjm.nc` (W7-X high-mirror "KJM" VMEC equilibrium) | `a811669f…f6` |
| `stella_test2_vmec_geometry.geometry` | stellaGK/stella @ `6f60964d` `AUTOMATIC_TESTS/numerical_tests/test_2_geometry/EXPECTED_OUTPUT.vmec_geometry.geometry` | `5c156224…602d` |
| `stella_test2_vmec_geometry.vmec.geo` | same directory, `EXPECTED_OUTPUT.vmec_geometry.vmec.geo` | `efccb0d3…491` |
| `stella_test2_vmec_geometry.in` | same directory, `vmec_geometry.in` | `ea741f75…11d` |
| `stella_test2_vmec_geometry.out.nc` | same directory, `EXPECTED_OUTPUT.vmec_geometry.out.nc` (float64 `bmag(zed, alpha)`, used for the 1e-10 tracer check) | `75b8d0ac…f00` |

stella is MIT-licensed (`LICENCE.md` in the upstream repo; authors in its `CITATION.cff`).

Benchmark h5 layout used here: `compared/test5/{stella,GENE}/{t,Q}` = nonlinear bean-tube ion heat
flux in `Q_i/Q_gB,i` vs `t v_th,i/a` (`tgrad`=3, `ngrad`=1). Published reference:
González-Jerez et al., J. Plasma Phys. 88 (2022), doi:10.1017/S0022377822000393.

**Not present:** the "129 saved stella samples" of bean |B| at ρ = 0.8 named in the PRD acceptance
test. They are not at the cited stella commit (searched test_2, test_5, test_7, quick_benchmarks).
See decision.md D-007.
