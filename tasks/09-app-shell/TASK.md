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
TODO
