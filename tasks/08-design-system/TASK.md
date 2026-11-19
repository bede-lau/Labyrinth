# 08 · Design system

## Owner
design-lead (`renderer/src/design/`)

## Expected outcome
- D1. `DESIGN.md` documents principles, tokens, type scale, spacing, status semantics (live / replay / prd-reported / unverified / failed / blocked), chart conventions, component inventory.
- D2. `tokens.css` with light and dark themes (prefers-color-scheme + `[data-theme]`), all text/background pairs ≥ WCAG AA (tested by computing contrast from the token values).
- D3. Colour-blind-safe series palette for stella / GENE / GX / bean / triangular (tested: pairwise ΔE under deuteranopia/protanopia simulation above threshold).
- D4. `plotTheme.ts` and `sceneTheme.ts` derive from tokens (no hard-coded hex outside tokens).
- D5. Primitives with tests: Panel, Stat, ProvenanceBadge, StatusPill, FixtureCheck, SegmentedControl, Callout.

## Tests
| # | Test |
|---|---|
| D1–D5 | `renderer/src/design/**/*.test.ts(x)` |

## Status
TODO
