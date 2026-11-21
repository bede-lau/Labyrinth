# 09 · App shell

## Owner
frontend-engineer (`renderer/src/shell/`, `renderer/src/lib/`)

## Expected outcome
- A1. Navigation across the seven views (Locate the tubes, Advance plasma, Check transport, Forecast replay, Spatial parallelism, Budget, Heat & field), keyboard accessible, URL hash reflects the view; the Heat & field link names its source as an illustrative model, not replay (D-027).
- A2. Global mode indicator: REPLAY ($0) vs LIVE, driven by `/api/live/status`; with no backend reachable the app runs fully in replay.
- A3. Typed artifact loader (`src/lib/artifacts.ts`) with loading / error / data states; a missing or invalid artifact shows an error panel naming the file, never a blank screen.
- A4. Header states the user decision: "Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?" and a global provenance legend.
- A5. Static build (`npm run build`) contains `dist/artifacts/*.json` so replay works with no backend.
- A6. The global provenance legend explains the `model` kind (D-027) next to the other kinds, read from the schema enum.

## Tests
| # | Test |
|---|---|
| A1–A6 | `renderer/src/shell/*.test.tsx`, `renderer/src/lib/*.test.ts` |

## Status
IN-PROGRESS

Reopened 2026-11-21 for the owner's requirement (D-027: seventh view, `heatfield` artifact id, `model` kind in the legend). Previously DONE: verified at commit 77fd8b6 (tasks/09-app-shell/VERIFY.md run 3, `Verdict: PASS`, 2026-11-21).
