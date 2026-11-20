# Labyrinth design system

Labyrinth is a scientific instrument. A stellarator transport researcher uses it to decide whether a
W7-X heat-flux estimate is accurate enough to justify a longer simulation. They read numbers for a
living. The interface should be calm, dense, exact and trustworthy, and it is designed to support
their judgement. Delight is not a goal.

The system grows out of the existing flux-tube figures (`design-artifacts/flux-tubes/`). It keeps
their deep-slate title, the teal bean field line, the rust triangular line, the light gray-blue
wireframe surface, a clean sans-serif and minimal axes. It turns those into tokens and rules that
work in both themes.

Review page: run `npm --prefix renderer run dev` and open `/#gallery`. All gallery data is synthetic
and is labelled as synthetic.

---

## 1. Principles

1. **Evidence first.** Every number sits with its unit, window, source and verification state.
   Provenance is a first-class element: a compact `ProvenanceBadge` that expands to the full record.
   It is never a footnote.
2. **Honest states.** Live, replay, rehearsal, archive, derived, PRD-reported, unverified, verified,
   failed, blocked and mismatch each have one consistent treatment, made of colour, icon and text.
   Colour is never the only signal. The live treatment cannot be produced from replayed data
   (see §5).
3. **Quiet chrome, loud data.** Surfaces are neutral, there is one accent (teal) and motion is
   restrained. **Gray always means unsampled or context, never data.**
4. **Comparison is the job.** Overlays share axes and units. When a claimed value and a computed value
   disagree (for example 2.68 claimed vs 2.67 computed, or the reduced Modal run's 5.79 vs the
   archives' 2.55/2.68), the two values are shown side by side with the delta.
5. **Accessible by construction.** WCAG AA contrast is computed from the tokens in both themes.
   Every control works from the keyboard and shows a visible focus ring. Motion respects
   reduced-motion settings. The series palette is checked for colour-blind safety.

## 2. Files

| File | Role |
|---|---|
| `tokens.ts` | **Single source of truth** for every colour and scale. It is the only TS file that may contain colour literals. |
| `tokens.css` | **Generated** by `renderTokensCss()`. Regenerate with `npm --prefix renderer run tokens`. `tokens.test.ts` fails if this file drifts from `tokens.ts`. `main.tsx` imports it once. |
| `theme.ts` | `resolveTheme()`, `useResolvedTheme()`, `setThemePreference()`. These follow the same rules as the CSS selectors. |
| `plotTheme.ts` | Plotly layout, config, series styles, uncertainty bands, window and unsampled shapes, and `axisTitle`. |
| `sceneTheme.ts` | Three.js colours, the field-line identity colours, the gray surface and the `bmag` colormap. |
| `format.ts` | Number, delta, window and unit formatting (true minus sign, en dash, subscripts). |
| `status.ts` | Label, icon and meaning for every status. |
| `components/` | Primitives (§8). |
| `color.ts` | Contrast, CIELAB, CIEDE2000 and CVD simulation, used by the tests and the gallery. |

## 3. Tokens

CSS custom properties are prefixed `--lab-`. Colour tokens exist in both themes with identical names.
The test suite enforces this.

### Theme selection

```
:root                                   light (default)
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"])       dark, following the OS
}
:root[data-theme="dark"]                dark, forced
```

`setThemePreference('light' | 'dark' | 'system')` sets or removes `data-theme` on `<html>`.
Plotly and Three call `useResolvedTheme()` and read `themes[name]`, so they always match the CSS.

### Colour: neutrals and accent

| Token | Light | Dark | Use |
|---|---|---|---|
| `color.bg` | `#f3f5f6` | `#0b1317` | App canvas. `body` sets this background explicitly. |
| `color.surface` | `#ffffff` | `#111b20` | Panels, plot paper |
| `color.surfaceSunken` | `#eef2f4` | `#0d161a` | Wells, segmented-control track, table heads |
| `color.surfaceRaised` | `#ffffff` | `#17242a` | Popovers, hover labels (always with a shadow) |
| `color.surfaceHover` | `#e9eef1` | `#1b2a31` | Hover fill |
| `color.border` | `#dbe2e6` | `#233239` | Decorative hairlines |
| `color.borderStrong` | `#73868e` | `#62777f` | Control boundaries, axes (≥ 3:1) |
| `color.text` | `#14262f` | `#e4ecef` | Titles and values (the figures' deep slate) |
| `color.textMuted` | `#42565e` | `#a9b8be` | Labels, subtitles, ticks |
| `color.textSubtle` | `#56686f` | `#91a3aa` | Metadata and captions (still ≥ 4.5:1 everywhere) |
| `color.accent` | `#0b7f80` | `#41b2b2` | Selection, focus, the bean tube |
| `color.accentText` | `#086a6b` | `#5cc2c1` | Links |
| `color.accentFg` | `#ffffff` | `#04191a` | Text on an accent fill |
| `color.focus` | `#0b7f80` | `#5cc2c1` | Focus ring: 2px solid with a 2px offset |

### Type scale

The system uses system font stacks and loads no web fonts, so replay works offline:
`ui-sans-serif, system-ui, …` and `ui-monospace, …` for hashes and revisions. **Numbers always use
tabular, lining figures** through `.lab-num`, so digits line up in columns.

| Step | Size / line-height (px) | Use |
|---|---|---|
| `2xs` | 11 / 16 | Pills, eyebrows, column keys |
| `xs` | 12 / 16 | Axis ticks, labels, metadata |
| `sm` | 13 / 20 | Body in dense panels, callouts |
| `md` | 14 / 20 | Default body |
| `lg` | 16 / 24 | Panel titles |
| `xl` | 20 / 28 | Section titles |
| `2xl` | 24 / 32 | Page title, Stat values |
| `3xl` | 32 / 40 | Hero Stat (`size="lg"`) |

Weights are 400, 500, 600 and 700. Titles use 600, and the page title uses 700 with −0.015em tracking.
Eyebrows are 11px uppercase with +0.07em tracking.

### Spacing, radius, elevation, motion

* **Spacing** is a 4px base. `--lab-space-{0, px, 0-5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16}` maps to
  0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48 and 64 px. Panels use 16/20px padding, or 12/16px when
  compact. The gap between panels is 16px.
* **Radius**: `xs` 2 (focus), `sm` 4 (segments, fixture rows), `md` 6 (panels, controls, callouts),
  `lg` 10, `pill` 999.
* **Elevation** is flat by default, using a 1px `border`. Only raised surfaces (popovers and hover
  labels) take `--lab-shadow-raised`.
* **Motion**: 120ms for hover and state, 180ms for disclosure, easing `cubic-bezier(0.2, 0, 0, 1)`.
  The only looping animation is the LIVE pulse. Under `prefers-reduced-motion: reduce`, all
  animations and transitions collapse to 0.01ms. The pulse becomes a static dot and the LIVE text
  stays.

## 4. Series palette

| Series | Light | Dark | Redundant encoding |
|---|---|---|---|
| stella | `#1148b3` cobalt | `#467cc0` | solid line, circle marker, 1.5px |
| GENE | `#b68b16` ochre | `#e5c057` | dashed, square, 1.5px |
| GX | `#2c2024` warm ink | `#ece6e7` | solid, diamond, **2.25px** (the new run is the focal line) |
| bean | `#0b7f80` teal (from the figure) | `#41b2b2` | solid, hexagon |
| triangular | `#a8482a` rust (the figure's rust, deepened) | `#c36953` | dash-dot, triangle |

**Validation** (`palette.test.ts`) uses the CIEDE2000 difference between every pair of the five
series:

* At least 12 ΔE00 under full-severity protanopia and deuteranopia, using both the Machado 2009
  and Viénot 1999 simulations. Measured minimum: 16.4 (light) and 15.5 (dark).
* At least 20 ΔE00 in normal vision. Measured: 30.3 (light) and 27.4 (dark).
* At least 8 ΔE00 under tritanopia. Measured: 15.3 (light) and 14.7 (dark).
* At least 3:1 contrast against the plot background (WCAG 1.4.11).

*Why these thresholds.* A ΔE00 of about 1–2 is a just-noticeable difference, but only for large
uniform patches. Chart lines are thin, and the difference a viewer needs grows as marks get smaller
(Szafir 2018, *Modeling Color Difference for Visualization Design*). 12 is about five times a patch
JND, which keeps 1.5–2.25px lines distinct at a glance. Severity 1.0 (complete dichromacy) is the
worst case. Colour is also never the only channel, because every series has its own dash and marker.
A negative control in the test shows that a red/green/orange palette passes normal vision but fails
deuteranopia, so the check can fail for the reason it exists.

## 5. Status semantics

Every state has a **colour, an icon and text**. Tokens are `--lab-status-<kind>-{fg,bg,border}`.
Each `fg` is at least 4.5:1 on its own tint and on every surface.

| Status | Icon | Text | Treatment | When |
|---|---|---|---|---|
| `live` | pulsing dot | **LIVE** | **The only solid-filled pill** (crimson, white text, uppercase) | Only when `/api/live/status` reports `mode === "live"` |
| `replay` | ↻ | Replay | neutral slate tint | Saved evidence, $0. The global mode shows "Replay · $0". |
| `rehearsal` | ◉ | Rehearsal | indigo tint | A recorded GX run playing back. Never styled like live. |
| `archive` | box | Archive | slate-blue tint | Read from a pinned upstream file (sha256) |
| `derived` | Σ | Derived | teal tint | Computed by Labyrinth from archives |
| `prd-reported` | ❝ | PRD-reported | sand tint, **dashed** outline | Stated in PRD.md, with no data in the repo |
| `unverified` | ? | Unverified | neutral, **dashed** outline | Not checked against a reference (for example the raw triangular trace) |
| `passed` | ✓ | Verified | green tint | Verification passed |
| `failed` | (!) | Failed | red tint | The run or the verification failed |
| `blocked` | ⊘ | Blocked | violet tint | Cannot be checked until an input is provided (for example the 129 samples, D-007) |
| `mismatch` | ✗ | Mismatch | orange tint. Fixture rows are filled orange with a solid ✗ disc. | Claimed ≠ computed at printed precision |
| `not-applicable` | — | Not applicable | neutral | No verification applies |

**Dashed outlines mean the value is not backed by data in this repo.**

**Mapping the live-status mode to the global indicator.** This mapping is the frontend's job:

| `mode` | Indicator |
|---|---|
| `live` | `<StatusPill status="live">LIVE · GPU 0 / GPU 1</StatusPill>` |
| `fallback` | `<StatusPill status="failed">Worker failed</StatusPill>` + `<StatusPill status="replay">Playing saved run</StatusPill>` |
| `unavailable`, `idle`, `terminated` | `<StatusPill status="replay">Replay · $0</StatusPill>` |
| `launching` | `<StatusPill status="rehearsal">Launching…</StatusPill>`. It is not live until workers report. |

Provenance `kind` maps directly to a status (`archive`, `derived`, `prd-reported`, `live`,
`rehearsal`). The verification `outcome` maps as passed → `passed`, failed → `failed`,
blocked → `blocked`, and not-applicable → `not-applicable`.

Callouts have three tones: **info** (context), **warn** (read with care, for example unverified
data) and **blocked** (cannot be checked; always say what would unblock it). Each has its own icon
and a screen-reader prefix ("Note:", "Warning:", "Blocked:").

## 6. Chart conventions (Plotly, `plotTheme.ts`)

* **Units in every axis title.** `axisTitle('Ion heat flux Q_i', 'Q_gB')` produces
  "Ion heat flux Q<sub>i</sub> (Q<sub>gB</sub>)". The unit is mandatory, and an empty unit throws.
  Pass `'dimensionless'` explicitly when there is none.
* **Shared axes for comparisons.** Overlays of stella, GENE and GX use one axis, one unit and one time
  base. Raw GX is converted to archive units first (t × √2, Q ÷ 2√2) and labelled as converted.
* **Windows** (200–300, 300–400, 1500–1900 and so on): `windowShape(window, theme, '300–400')` draws a
  faint teal band with dotted edges, *below* the data, labelled at the top left.
* **Uncertainty**: `uncertaintyBand(x, mean, σ, series, theme)` draws a ±1σ band in the series colour at
  `plot.bandAlpha` (18% light, 22% dark). Add it before its line, with no legend entry. Window means
  appear as `meanSegment(...)` across the window, with the band around them. A mean without σ is
  shown as a value only; never invent a band.
* **Gray = unsampled.** `unsampledShape(range, theme)` covers ranges with no samples, labelled
  "unsampled" at the bottom. Never interpolate across it.
* **Published or claimed means** (triangular 2.22 on 1200–1500) use `meanSegment` in the series style.
  They are never drawn as if they were a trace.
* Chrome: 1px axis lines, outside ticks, a light grid, no zero line, a horizontal legend at the top
  left, `x unified` hover on a raised surface, true minus signs (Plotly default), no Plotly logo,
  and SVG export.
* Title the chart in the Panel, not inside the plot.

## 7. 3D scene conventions (Three.js, `sceneTheme.ts`)

* **Surface**: a gray wireframe (`scene.surfaceLine`) on the panel surface, matching the reference
  figures. It is context only. Unsampled parts of the surface or line stay `scene.unsampled` gray.
* **Field lines**: tube identity colours come from the series palette (bean teal, triangular rust).
  The selected tube is drawn 1.6× wider. The unselected tube drops to 35% opacity.
* **Markers**: start ■, centre ●, end ▲, as in the figures, with a `markerOutline` halo.
* **Colour by |B|**: use `bmagColor(normalizeBmag(b, tube.bmagRange), theme)`. It returns sRGB in
  0–1, so call `color.setRGB(r, g, b, SRGBColorSpace)`. The 9-stop map runs navy → teal → green →
  ochre and is built in OKLCH with linearly rising lightness, in the same spirit as cividis and viridis.
  It is tested so that lightness strictly increases under normal vision, protanopia and deuteranopia,
  each step is visible, step sizes vary by less than 20%, and every stop is at least 3:1 against the
  scene background. The light theme uses a darker band (L\* 18–60) and the dark theme a lighter one
  (L\* 45–92), so **always show the colour bar** (`bmagGradientCss(theme)`) labelled
  "|B| / B<sub>ref</sub>".
* Cross-section inset: dashed plasma boundary (`scene.boundary`), solid sampled surface
  (`scene.sampledSurface`), and the centre marker in the tube colour. Axes are labelled with units
  ("Major radius R (m)", "Z (m)").

## 8. Components

Import everything from `src/design` (`index.ts`).

| Component | Purpose | Rules |
|---|---|---|
| `Panel` | Titled region (`section` with `aria-labelledby`) | Eyebrow is the view name. The title says what is shown. The subtitle gives the *how* in plain words. `status` holds the ProvenanceBadge, `actions` holds controls, and `footer` holds sources and captions. Use `density="compact"` in side columns. |
| `Stat` | A number with its unit, ±σ and window | `unit` is required. `decimals` must match a precision you can defend. `null` renders "— not available" and never 0. The accessible name reads the full sentence. Uncertainty uses the same decimals as the value. |
| `StatusPill` | State label | Use one status per pill. Override the text only with a synonym ("Replay · $0"). Only use `live` when the API reports live. |
| `ProvenanceBadge` | Kind + verification outcome; expands to solver revision, units, coverage, runtime, verification and sources (sha256) | Put one on every result panel or table. Escape and outside-click close it and return focus to the badge. `align="start"` applies when it sits on the left edge. |
| `FixtureCheck` | PRD claim vs computed value at printed precision, with Δ and ✓/✗/— plus text | A match requires both `matches === true` and identical printed strings. Otherwise it is a mismatch, and any disagreement between the flag and the values is called out. Stack rows to make a fixture table. |
| `SegmentedControl` | One choice among 2–5 peers (bean / triangular, window) | It is a radiogroup with one tab stop. ←→↑↓ move and select, Home/End jump, and disabled options are skipped. For more than 5 options, or for navigation, use tabs or a select instead. |
| `Callout` | Inline info, warn or blocked explanation | `role="note"` (static, not an alert). A blocked callout always says what would unblock it (`action`). |
| `Icon`, `Unit` | 16-grid stroke icons (`currentColor`, aria-hidden); unit subscripts (`Q_gB`, `a/v_{th,i}`) | Icons always sit next to text. |

## 9. Do / Don't

| Do | Don't |
|---|---|
| `2.674 → "2.67"` next to `"2.68 (PRD)"` with `Δ −0.01  ✗ Mismatch` | Round the computed value up to match the claim, or hide the claim |
| Show the reduced Modal run as `5.79 Q_gB` with the **PRD-reported** pill, beside 2.55/2.68 | Plot 5.79 as a trace, or style it like archive data |
| Show the global "Replay · $0" indicator whenever the API is not `live` | Use red, a pulse or the word "live" for anything replayed or rehearsed |
| Label every axis with its unit: "Time t (a/v<sub>th,i</sub>)" | Leave unitless axes ("Q", "time") |
| Leave unsampled ranges gray and labelled | Interpolate a line across missing data, or colour gray regions |
| Pair every colour with an icon and text, and every series with a dash and marker | Encode verification state or series identity by hue alone |
| Write a blocked callout that names the missing input and the unblock step | Show an empty panel or a spinner for something that can never load |
| Take colours from `themes[theme]` / `var(--lab-…)` | Write hex values outside `tokens.ts` (a test fails) |
| Use `.lab-num` for every column of numbers | Use proportional digits in tables and Stats |

## 10. Accessibility checklist (all enforced by tests)

* Contrast (`contrast.test.ts`), checked in both themes:
  * Every text token on every surface is at least 4.5:1.
  * Every status and callout foreground is at least 4.5:1 on its tint and on every surface, and body
    text is at least 4.5:1 on every tint.
  * Control borders, the focus ring, the accent, chart lines and |B| stops are at least 3:1.
* Keyboard: SegmentedControl follows the radiogroup pattern, ProvenanceBadge is a disclosure with
  Escape, and focus is shown with `:focus-visible`.
* Names: Stat, FixtureCheck, ProvenanceBadge and Callout expose full spoken sentences, including the
  tone and outcome words.
* Motion: `prefers-reduced-motion` is honoured globally (`tokens.css`).
* Colour-blind safety: `palette.test.ts` (see §4).
