# 08 · Design system

## Owner
design-lead (`renderer/src/design/`)

## Expected outcome
- D1. `DESIGN.md` documents principles, tokens, type scale, spacing, status semantics (live / replay / prd-reported / unverified / failed / blocked), chart conventions, component inventory.
- D2. `tokens.css` with light and dark themes (prefers-color-scheme + `[data-theme]`), all text/background pairs ≥ WCAG AA (tested by computing contrast from the token values).
- D3. Colour-blind-safe series palette for stella / GENE / GX / bean / triangular (tested: pairwise ΔE under deuteranopia/protanopia simulation above threshold).
- D4. `plotTheme.ts` and `sceneTheme.ts` derive from tokens (no hard-coded hex outside tokens).
- D5. Primitives with tests: Panel, Stat, ProvenanceBadge, StatusPill, FixtureCheck, SegmentedControl, Callout.
- D6. Owner requirement 2026-11-21 (D-027): a temperature ramp (yellow = coldest → orange → red = hottest) and a magnetic-field ramp (green = weakest → dark blue = strongest) as tokens in both themes, each with monotonic lightness and distinguishable from each other under deuteranopia/protanopia simulation; against the |B| field-line ramp of Locate the tubes (frozen, D-028): ΔE00 ≥ 8 in normal vision, the two yellow ends ≥ 8 apart for every viewer, and the two ramps shown only in separate views with their own colour bars; a diverter colour (black as the owner drew it) that stays visible on both scene backgrounds; a `model` status (dashed outline, own icon, "illustrative model, not measured") in `STATUS_META`, `provenanceStatus` and DESIGN.md.

## Tests
| # | Test |
|---|---|
| D1–D6 | `renderer/src/design/**/*.test.ts(x)` (D6 tests named `D6 …`) |

## Status
VERIFYING

Also carries the owner's 2026-11-21 local design changes (bbf2fc6). Reopened 2026-11-21 for the owner's requirement (D-027: heat and field ramps, diverter colour, `model` status). Previously DONE: verified at commit 3faed3a (tasks/08-design-system/VERIFY.md, `Verdict: PASS`, external verifier, 2026-11-20).
