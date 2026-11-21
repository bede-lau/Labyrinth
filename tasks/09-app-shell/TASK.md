# 09 · App shell

## Owner
frontend-engineer (`renderer/src/shell/`, `renderer/src/lib/`)

## Expected outcome
- A1. Navigation across the six views (Locate the tubes, Advance plasma, Check transport, Forecast replay, Spatial parallelism, Budget), keyboard accessible, URL hash reflects the view.
- A2. Global mode indicator: REPLAY ($0) vs LIVE, driven by `/api/live/status`; with no backend reachable the app runs fully in replay.
- A3. Typed artifact loader (`src/lib/artifacts.ts`) with loading / error / data states; a missing or invalid artifact shows an error panel naming the file, never a blank screen.
- A4. Header states the user decision: "Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?" and a global provenance legend.
- A5. Static build (`npm run build`) contains `dist/artifacts/*.json` so replay works with no backend.

## Tests
| # | Test |
|---|---|
| A1–A5 | `renderer/src/shell/*.test.tsx`, `renderer/src/lib/*.test.ts` |

## Status
DONE

Verified at commit 77fd8b6 (D-024: `renderer/src/lib/liveContract.ts` validates the live-status `comparison` field): tasks/09-app-shell/VERIFY.md run 3, `Verdict: PASS` (external verifier, 2026-11-21). Reviewer APPROVE of the D-024 change (2026-11-21). Previously DONE at 3faed3a.
