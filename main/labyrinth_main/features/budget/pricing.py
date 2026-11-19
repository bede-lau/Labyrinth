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
