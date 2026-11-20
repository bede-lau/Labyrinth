"""Pricing constants from PRD.md (Budget and presentation figures). Single source for the
budget artifact and the live budget guard. Change only with a decision.md entry."""

CEILING_USD = 40.00                     # cumulative Modal ceiling
POSTED_USD = 8.10                       # provisionally posted earlier
LIVE_RATE_USD_PER_H = 6.10              # 2x A100-40GB + 8 CPU cores + 32 GiB
FULL_GRID_RATE_USD_PER_H = 9.15         # 32 CPU cores + 192 GiB
LIVE_SLOT_MIN = 15
REHEARSAL_H = 1.0
N_REHEARSALS = 2
PRICING_URL = "https://modal.com/pricing"

# --- Added for the budget artifact (task 04). Existing names above are unchanged. ---
LIVE_RESOURCES = "2x A100-40GB, 8 CPU cores, 32 GiB"
FULL_GRID_RESOURCES = "32 CPU cores, 192 GiB"
FULL_GRID_STEPS = 65_700                # explicit-streaming steps to normalised time 1900 (PRD estimate)
FULL_GRID_S_PER_STEP = 19.0             # from three startup steps (PRD)
FULL_GRID_TARGET_TIME = 1900            # normalised time t v_th,i/a
STELLA_PUBLISHED_HOURS = 161            # published full-resolution stella bean tube, authors' system
STELLA_PUBLISHED_PROCESSORS = 288
GX_BENCH_1GPU_MIN = 28                  # GX bean benchmark, 1 GPU, 4 Laguerre x 8 Hermite
GX_BENCH_4GPU_MIN = 90                  # GX bean benchmark, 4 GPUs, 8 x 16
GX_BENCHMARK_URL = ("https://www.cambridge.org/core/journals/journal-of-plasma-physics/article/"
                    "gx-a-gpunative-gyrokinetic-turbulence-code-for-tokamak-and-stellarator-design/"
                    "2C4BB81955E7E749B95B8B8141E997FA")
