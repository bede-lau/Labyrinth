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

This document is tested against the code in both directions (`designDoc.test.ts`): every token,
status, series, component and export has its row here with the current values, and every row here
names something that exists.

---

## 1. Principles

1. **Evidence first.** Every number sits with its unit, window, source and verification state.
   Provenance is a first-class element: a compact `ProvenanceBadge` that expands to the full record.
   It is never a footnote.
2. **Honest states.** Live, billing risk, replay, rehearsal, archive, derived, PRD-reported,
   unverified, verified, failed, blocked and mismatch each have one consistent treatment, made of
   colour, icon and text. Colour is never the only signal. The live treatment cannot be produced
   from replayed data, and "GPUs may still be billing" is never left to a feature to improvise
   (see §5).
3. **Quiet chrome, loud data.** Surfaces are neutral, there is one accent (teal) and motion is
   restrained. **Gray always means unsampled or context, never data.**
4. **Comparison is the job.** Overlays share axes and units. When a claimed value and a computed value
   disagree (for example 2.68 claimed vs 2.67 computed, or the reduced Modal run's 5.79 vs the
   archives' 2.55/2.68), the two values are shown side by side with the delta, at every width and
   without any interaction.
5. **Accessible by construction.** WCAG AA contrast is computed from the tokens in both themes.
   Every control works from the keyboard and shows a visible focus ring, including the buttons
   Plotly draws. Motion respects reduced-motion settings. The series palette is checked for
   colour-blind safety.

## 2. Files

| File | Role |
|---|---|
| `tokens.ts` | **Single source of truth** for every colour and scale. It is the only source file that may contain colour values. |
| `tokens.css` | **Generated** by `renderTokensCss()`. Regenerate with `npm --prefix renderer run tokens`. `tokens.test.ts` fails if this file drifts from `tokens.ts`. `main.tsx` imports it once. Besides the custom properties it holds the base rules: focus ring, the themed ring for chart modebar buttons, `summary` targets, tabular numbers, reduced motion. |
| `scripts/gen-tokens-css.mjs` | What `npm run tokens` runs. It writes `tokens.css` and the token reference at the end of this document (§12). |
| `theme.ts` | `resolveTheme()`, `useResolvedTheme()`, `setThemePreference()`. These follow the same rules as the CSS selectors. |
| `plotTheme.ts` | Plotly layout, config, series styles, uncertainty bands, window and unsampled shapes, and `axisTitle` (§6). |
| `sceneTheme.ts` | Three.js colours, the field-line identity colours, the gray surface and the `bmag` colormap (§7). |
| `format.ts` | Number, delta, window and unit formatting (true minus sign, en dash, subscripts). An exact tie rounds to even, as Python's round() does, so a printed value agrees with the artifact flag computed from it. |
| `status.ts` | Label, icon and meaning for every status, the Alert's treatment, and `provenanceStatus()`, the rule that keeps LIVE out of replayed provenance (§5). |
| `types.ts` | Structural types for provenance and fixture data (they mirror the contracts; nothing is imported from them). |
| `components/` | Primitives and `components.css` (§8). |
| `index.ts` | The public surface (§11). Import from here only. |
| `color.ts` | Contrast, alpha compositing, CIELAB, CIEDE2000 and CVD simulation, used by the tests and the gallery. |
| `palette.ts` | The series-palette gates and the measurement they apply to (§4). |
| `contrastPairs.ts` | Every foreground/background pair the system draws, with the minimum it is held to (§10). |
| `cssRules.ts` | A small CSS reader. The tests use it to pin layout and focus rules that jsdom cannot evaluate, and to list every colour pair the components draw (§10). |
| `Gallery.tsx` | The review page at `/#gallery` (lazy chunk, not part of the app). |
| `gallery.css` | Layout of the review page only. |
| `css.d.ts` | Lets TypeScript accept CSS side-effect imports. |
| `*.test.ts` | The tests named throughout this document; `components/components.test.tsx` covers the primitives and `Gallery.test.tsx` the review page. |

## 3. Tokens

CSS custom properties are prefixed `--lab-`. Colour tokens exist in both themes with identical names.
The test suite enforces this. §12 lists every custom property with its values.

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
A theme switch labels the three choices "Auto", "Light" and "Dark".

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
| `color.textMuted` | `#42565e` | `#a9b8be` | Labels, subtitles, ticks, labels inside charts |
| `color.textSubtle` | `#56686f` | `#91a3aa` | Metadata and captions (still ≥ 4.5:1 everywhere) |
| `color.accent` | `#0b7f80` | `#41b2b2` | Selection, the bean tube |
| `color.accentHover` | `#096a6b` | `#5cc2c1` | Hovered links and accent fills |
| `color.accentText` | `#086a6b` | `#5cc2c1` | Links |
| `color.accentFg` | `#ffffff` | `#04191a` | Text on an accent fill |
| `color.accentSubtle` | `#e2f1f0` | `#0f2a2b` | Tinted accent fill (selected row, text selection) |
| `color.focus` | `#0b7f80` | `#5cc2c1` | Focus ring: 2px solid, 2px outside the control |
| `color.shadow` | `rgba(20, 38, 47, 0.14)` | `rgba(0, 0, 0, 0.5)` | Shadow of raised surfaces |

### Type scale

The system uses system font stacks and loads no web fonts, so replay works offline:
`ui-sans-serif, system-ui, …` and `ui-monospace, …` for hashes and revisions. **Numbers always use
tabular, lining figures** through `.lab-num`, so digits line up in columns. `Stat` applies it to the
value, the ± uncertainty and the window.

| Step | Size / line-height (px) | Use |
|---|---|---|
| `2xs` | 11 / 16 | Pills, eyebrows, column keys, labels inside charts |
| `xs` | 12 / 16 | Axis ticks, labels, metadata |
| `sm` | 13 / 20 | Body in dense panels, callouts |
| `md` | 14 / 20 | Default body |
| `lg` | 16 / 24 | Panel titles |
| `xl` | 20 / 28 | Section titles |
| `2xl` | 24 / 32 | Page title, Stat values |
| `3xl` | 32 / 40 | Hero Stat (`size="lg"`) |

Weights are 400, 500, 600 and 700. Titles use 600, and the page title uses 700 with −0.015em tracking.
Eyebrows are 11px uppercase with +0.07em tracking. Running prose (callout bodies, fixture notes,
panel footers) is at most 100ch wide. Subscripts (`sub`, `sup`) never grow the line box, so a row
of numbers with units keeps one baseline.

### Spacing, radius, elevation, motion

* **Spacing** is a 4px base. `--lab-space-{0, px, 0-5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16}` maps to
  0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48 and 64 px. Panels use 16/20px padding, or 12/16px when
  compact. The gap between panels is 16px.
* **Radius**: `xs` 2 (focus), `sm` 4 (segments, fixture rows), `md` 6 (panels, controls, callouts),
  `lg` 10, `pill` 999.
* **Elevation** is flat by default, using a 1px `border`. Only raised surfaces (popovers and hover
  labels) take `--lab-shadow-raised`.
* **Layers**: `popover` 20, `toast` 30.
* **Motion**: 120ms for hover and state, 180ms for disclosure, easing `cubic-bezier(0.2, 0, 0, 1)`.
  The only looping animation is the LIVE pulse. Under `prefers-reduced-motion: reduce`, all
  animations and transitions collapse to 0.01ms. The pulse becomes a static dot and the LIVE text
  stays.
* **Opacity** is never used to mute text or controls: it multiplies into every colour inside the
  element, below what the tokens guarantee. Disabled and secondary states use a text token instead.
  The one exception is the decorative LIVE pulse ring (`css.test.ts`).

## 4. Series palette

| Series | Legend name | Light | Dark | Line | Marker | Width (px) | Notes |
|---|---|---|---|---|---|---|---|
| `stella` | stella | `#1148b3` | `#467cc0` | `solid` | `circle` | 1.5 | Cobalt |
| `GENE` | GENE | `#b68b16` | `#e5c057` | `dash` | `square` | 1.5 | Ochre |
| `GX` | GX | `#2c2024` | `#ece6e7` | `solid` | `diamond` | 2.25 | Warm ink. The new run is the focal line; draw it with its markers. |
| `bean` | Bean tube | `#0b7f80` | `#41b2b2` | `solid` | `hexagon` | 2 | Teal, from the figure |
| `triangular` | Triangular tube | `#a8482a` | `#c36953` | `dashdot` | `triangle-up` | 2 | The figure's rust, deepened |

**Validation** (`palette.test.ts`; the gates and the measurement are in `palette.ts`) uses the
CIEDE2000 difference between every pair of the five series:

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
Each `fg` is at least 4.5:1 on its own tint. Every `fg` except `live` is also at least 4.5:1 on every
surface, because labels and icons are drawn bare as well; `live` is white and only ever sits on its
own solid fill. No two statuses share a label or an icon (`components.test.tsx` pins both).

| Status | Icon | Text | Treatment | When |
|---|---|---|---|---|
| `live` | `live` (drawn as a pulsing dot) | Live | **The only solid-filled pill**: crimson, white text, set in uppercase. The fill is at least 3:1 against every surface. | Only when `/api/live/status` reports `mode === "live"` |
| `billing-risk` | `danger` (a solid octagon with a knocked-out !) | Billing risk | **The only outlined pill**: raspberry tint, a solid outline in its own text colour (at least 3:1 against every surface and against its tint), bold text. Never a solid fill (that is live). | GPUs may still be billing: a stop is not confirmed, or the session state is unknown. Only the danger rows of the live-state table below; paired with an `Alert`. |
| `replay` | `replay` ↻ | Replay | neutral slate tint | Saved evidence, $0. The global mode shows "Replay · $0" only in the live-state rows below that list it. |
| `rehearsal` | `rehearsal` ◉ | Rehearsal | indigo tint | A recorded GX run playing back. Never styled like live. |
| `archive` | `archive` (box) | Archive | slate-blue tint | Read from a pinned upstream file (sha256) |
| `derived` | `derived` Σ | Derived | teal tint | Computed by Labyrinth from archives |
| `prd-reported` | `quote` ❝ | PRD-reported | sand tint, **dashed** outline | Stated in PRD.md, with no data in the repo |
| `unverified` | `question` ? | Unverified | neutral, **dashed** outline | Not checked against a reference (for example the raw triangular trace) |
| `passed` | `check` ✓ | Verified | green tint | Verification passed |
| `failed` | `alert` (!) | Failed | red tint | The run or the verification failed |
| `blocked` | `blocked` ⊘ | Blocked | violet tint | Cannot be checked until an input is provided (for example the 129 samples, D-007) |
| `mismatch` | `cross` ✗ | Mismatch | orange tint. Fixture rows are filled orange with a solid ✗ disc. | Claimed ≠ computed at printed precision |
| `not-applicable` | `dash` — | Not applicable | neutral | No verification applies |

**Dashed outlines mean the value is not backed by data in this repo.** Because the dash carries that
meaning, the two dashed outlines are at least 3:1 against every surface and against their own tint.
An arithmetic-only fixture row (§8) is dashed for the same reason. The billing-risk outline is solid
and drawn in the pill's text colour; it carries meaning too and is held to the same 3:1.

**Mapping the live-status store to the UI.** `useLiveStatus()` in `lib/liveStatus.ts` returns one
store status (`connecting`, `unreachable` or `ready`); `modePills()` and `liveDanger()` there turn it
into the pills and the danger that the header and the live panel show. That code is the frontend's;
this table is the contract it follows. A danger row wins over every mode row: its billing-risk pill
leads, then come the mode's pills with every `replay` pill dropped ("Replay · $0", "Checking
status…", "Playing saved run": $0 is not known while GPUs may be billing), and its `Alert` sits
under the header on every route and in the live panel. Markers and phrases are matched anywhere in
the reason, in any letter case and in any mode.

**"Replay · $0" appears only in the rows that list it** (`REPLAY_PILL` in `lib/liveStatus.ts`). Even
with no danger, "$0" is not known while a launch sent from this page may be running (the store's
`launchPhase`) or while a snapshot still lists workers: the store then puts "Launching…" or "Checking
status…" where "Replay · $0" would be.

| Live state | Indicator | Alert |
|---|---|---|
| `connecting` | `<StatusPill status="replay">Replay · $0</StatusPill>` | none |
| `unreachable` with cause `stale`: the snapshot outlived its freshness and a new request is already on its way | `<StatusPill status="replay">Checking status…</StatusPill>` | none |
| `unreachable` with cause `network`, `http`, `invalid` or `timeout`, when the last snapshot could not be billing (or there was none) and no launch from this page may be running | `<StatusPill status="replay">Replay · $0</StatusPill>` | none |
| `ready` with mode `unavailable`, `idle` or `terminated`, no workers listed, and no launch from this page outstanding (no `launchPhase`, or `refused`: the backend answered 409 and launched nothing) | `<StatusPill status="replay">Replay · $0</StatusPill>` | none |
| `ready` with mode `idle` and workers listed (a session whose workers have not started), or a launch from this page in flight or accepted (`launchPhase` `sent` or `accepted`) | `<StatusPill status="rehearsal">Launching…</StatusPill>` where "Replay · $0" would be | none |
| `ready` with mode `unavailable` or `terminated` and workers listed, or a launch from this page that got no usable answer (`launchPhase` `unknown`: the next snapshot decides) | `<StatusPill status="replay">Checking status…</StatusPill>` where "Replay · $0" would be | none |
| `ready` with mode `launching` | `<StatusPill status="rehearsal">Launching…</StatusPill>`. It is not live until workers report. | none |
| `ready` with mode `live` | `<StatusPill status="live">LIVE · GPU 0 / GPU 1</StatusPill>` | none |
| `ready` with mode `fallback` | `<StatusPill status="failed">{fallback cause}</StatusPill>` + `<StatusPill status="replay">Playing saved run</StatusPill>` ("Replay · $0" when no saved run is playable; a settled fallback keeps it, since every termination is confirmed, except while a launch from this page is outstanding, as in the two rows above) | none |
| danger `terminate-failed`: `ready`, and the reason contains TERMINATE FAILED. A reason that says "kill switch raised, stop not confirmed" or "kill switch could not be set" counts even without the marker. FAILED wins when both markers occur. | `<StatusPill status="billing-risk">TERMINATE FAILED</StatusPill>`, then the mode's pills that are not replay | `<Alert title="TERMINATE FAILED — GPUs may still be billing" reason={reason}>` |
| danger `termination-pending`: `ready`, and the reason contains TERMINATION PENDING (a cancel is queued, not confirmed) | `<StatusPill status="billing-risk">TERMINATION PENDING</StatusPill>`, then the mode's pills that are not replay | `<Alert title="TERMINATION PENDING — GPUs may still be billing" reason={reason}>` |
| danger `stop-unconfirmed`: `ready`, no termination marker, and the reason contains "Stop requested; terminating workers — not confirmed yet" | `<StatusPill status="billing-risk">Stop not confirmed</StatusPill>`, then the mode's pills that are not replay: LIVE stays while the API reports live | `<Alert title="STOP NOT CONFIRMED — GPUs may still be billing" reason={reason}>` |
| danger `connection-lost`: `unreachable` (any cause but `stale`) after a snapshot that may be billing (mode `launching`, `live` or `fallback`, workers listed, a termination marker or a requested stop), or after any snapshot while a launch sent from this page may be running | `<StatusPill status="billing-risk">Connection lost</StatusPill>` | `<Alert title="CONNECTION LOST — session state unknown" reason={detail}>`. The API is silent, so `detail` is the app's own sentence: what failed, when the last status arrived, its mode and reason, any launch still unanswered, and "GPUs may still be billing." |

**Where the Alert sits, and what it carries.**

* **Header, every route** (`ModeAlert` in `shell/ModeIndicator.tsx`): one Alert for the store's
  danger, with the title and reason above and the body "Check the Modal dashboard until both workers
  are confirmed stopped." Its action is the link "Open Advance plasma to send Terminate"; on
  `#/advance`, where the button is just below, it is a line of text instead: "Use Terminate in the
  Advance plasma panel below." When the Advance plasma view itself failed to render (`viewFailed`),
  that control is gone, so the header carries a Terminate of its own: "The Advance plasma panel
  failed to render; Terminate from here." with a button that reads like the panel's, then the answer
  as a status line, "Terminate confirmed: …" or "Terminate not confirmed: …". It sends the same
  request and applies the same confirmation rule as the panel (`sendTerminate()`). The header's copy
  is meant to be `compact`, which keeps every part and exists so that copy does not push a phone's
  page below the fold (the full layout stood about 370px tall at 390px); see "Not yet in the app".
* **Live panel** (`#/advance`): one full-size Alert per danger, worst first. The first carries the
  Terminate button: "Terminate", "Retry terminate" after a failed stop, "Terminating… (send again)"
  while a request is out. Besides the store's dangers it shows two that only this page knows:

| Panel-only state | Indicator (panel) | Alert (panel) |
|---|---|---|
| A failed Terminate answer: a Terminate sent from this page was answered with anything but a confirmation (not a 2xx `ok: true`, or its reason names a termination marker or a requested stop, or no answer came). It shows even while the status poll does not carry a marker. | `<StatusPill status="billing-risk">TERMINATE FAILED</StatusPill>` (or the marker the answer names) when the store shows no danger, then the mode's pills that are not replay | `<Alert title="TERMINATE FAILED — GPUs may still be billing" reason={answer}>` (TERMINATION PENDING when the answer says so); with no answer, the reason ends "termination is unconfirmed." |
| A launch request from this page got no usable answer (neither 202 nor 409) and the connection is not lost | the mode's pills; no billing-risk pill | `<Alert title="LAUNCH NOT CONFIRMED — a session may have started" reason={outcome}>`, with Terminate |

**The replay player and "$0".** The replay panel on `#/advance` prints "Replay · $0" (and "at $0" in
its subtitle) only while the mode pills show "Replay · $0". Whenever they do not (a danger, a
panel-only Alert, a launch that may be running, a session that still lists workers, a status still
being checked) its pill reads `<StatusPill status="replay">Replay</StatusPill>`: the replay itself
costs nothing, but "$0" is never printed next to a bill that may be running.

**One danger, one announcement.** The header's copy announces (`role="alert"`). A copy of the same
danger in the live panel is meant to pass `announce={false}`: it is then drawn the same and keeps its
name, as a labelled group, so a screen reader hears the danger once. The panel-only Alerts announce,
because nothing else on the page carries them. What an announcing Alert announces is its title and
reason. Its body and action stay inside it but sit in `aria-live="off"` sub-regions, so a change there
(the Terminate button's label, a terminate answer) is not announced assertively again.

**Not yet in the app.** Two parts of this contract are required of the frontend (`shell/`,
`features/live-gx/`) and not drawn yet: the header's `ModeAlert` does not pass `compact`, and the
live panel's copy of the header's danger does not pass `announce={false}`, so on `#/advance` a screen
reader hears that danger twice. `designDoc.test.ts` reads both files: this section may call either
part done only once the code does it.

**Provenance never produces LIVE by itself.** Provenance `kind` maps to the status of the same name
for `archive`, `derived`, `prd-reported` and `rehearsal`. Kind `live` is different: a record read
from an artifact or a saved run says how the numbers were made, not that a worker is running now.
`ProvenanceBadge` therefore draws kind `live` as **Recorded run** with the replay treatment, and
draws the live pill only when the caller also passes the `live` prop. That prop may be set only
from the live-status path (`mode === "live"`, `isLive()` in `lib/liveStatus.ts`); it has no effect on
any other kind. The rule is `provenanceStatus(kind, live)` in `status.ts`.

The verification `outcome` maps as passed → `passed`, failed → `failed`, blocked → `blocked`, and
not-applicable → `not-applicable`.

Callouts have three tones: **info** (context), **warn** (read with care, for example unverified
data) and **blocked** (cannot be checked; always say what would unblock it). Each has its own icon
and a screen-reader prefix: "Note:", "Warning:", "Blocked:". A callout is static (`role="note"`).
Money at risk now is not a callout tone: it is an `Alert` (`role="alert"`, the billing-risk
treatment, the prefix "Danger:"), used only for the danger rows above.

## 6. Chart conventions (Plotly, `plotTheme.ts`)

* **One layout, one config.** Build every chart with `plotLayout(theme, overrides)` and
  `plotConfig()`. Overrides are merged into the themed layout, not swapped in: passing
  `xaxis: { title: { text } }` keeps the themed title font (12px, muted) and its 8px standoff, and
  `margin: { r: 40 }` keeps the other three margins. Axes, `font`, `margin`, `legend`, `hoverlabel`,
  `title` and `modebar` merge key by key, and so does every font inside them: an axis's `title.font`
  and `tickfont`, and the `font` of `title`, `legend` and `hoverlabel` (`legend: { font: { size: 10 } }`
  keeps the themed colour and family). Everything else replaces.
  `seriesColorway(theme)` is the default trace order.
* **Units in every axis title.** `axisTitle('Ion heat flux Q_i', 'Q_gB')` produces
  "Ion heat flux Q<sub>i</sub> (Q<sub>gB</sub>)". The unit is mandatory, and an empty unit throws.
  Pass `'dimensionless'` explicitly when there is none.
* **Shared axes for comparisons.** Overlays of stella, GENE and GX use one axis, one unit and one time
  base. Raw GX is converted to archive units first (t × √2, Q ÷ 2√2) and labelled as converted.
* **Series** take `seriesStyle(series, theme)`: colour, dash, marker and width from §4, and the legend
  name from `SERIES_LABEL`. Two series drawn together must differ in dash or marker, so GX (solid)
  beside stella (solid) is drawn with its diamond markers.
* **Windows** (200–300, 300–400, 1500–1900 and so on): `windowShape(window, theme, '300–400')` draws a
  faint teal band *below* the data, labelled at the top left. Its dotted edge is opaque and at least
  3:1 on the plot, on the band and on the unsampled gray, because it marks where the average starts
  and ends.
* **Uncertainty**: `uncertaintyBand(x, mean, σ, series, theme)` draws a ±1σ band in the series colour at
  `plot.bandAlpha` (18% light, 22% dark). Add it before its line, with no legend entry. Window means
  appear as `meanSegment(...)` across the window, with the band around them. A mean without σ is
  shown as a value only; never invent a band.
* **Gray = unsampled.** `unsampledShapes(range, theme)` returns two shapes; spread both into `shapes`.
  The first, `unsampled`, covers a range with no samples in the `plot.unsampled` gray at
  `plot.unsampledAlpha` (35% light, 35% dark), under the grid and the data. The second,
  `unsampled label`, is transparent and carries the word "unsampled": Plotly draws every shape that
  refers to the paper and is not layer `above` under the grid lines, label included, so a grid line
  used to cut through the word. The label shape is `above`; it adds only the word, and the top layer
  takes no pointer events, so hover still reaches the traces. The word runs up the inside of the
  block's left edge: Plotly clips shape labels at the plot edge, so a horizontal word is cut whenever
  the block is narrower than the word. List the pair before any window it overlaps, so the window's
  edge is drawn over the gray. Never interpolate across it.
* **Published or claimed means** (triangular 2.22 on 1200–1500) use `meanSegment` in the series style.
  They are never drawn as if they were a trace.
* **Narrow charts.** The hover modebar is about 216px wide and would cover a top legend on a phone.
  When the viewport matches `NARROW_CHART_QUERY` (`(max-width: 640px)`), `plotLayout` anchors the
  legend to the bottom of the figure, where Plotly reserves room for it under the axis title. Pass
  `{ narrow: true }` as the third argument for a chart in a narrow card on a wide screen, or
  `{ narrow: false }` to opt out.
* Chrome: 1px axis lines, outside ticks, a light grid, no zero line, a horizontal legend at the top
  left (bottom on narrow charts), `x unified` hover on a raised surface, true minus signs (Plotly
  default), no Plotly logo, and SVG export. The modebar stays reachable from the keyboard, and its
  buttons take the themed focus ring (§10).
* **Name a chart on its `<figure>`** (`aria-label`, or a `figcaption`), never with `role="img"` on the
  element Plotly draws into: the children of an img are presentational, and Plotly puts the
  focusable modebar buttons in there.
* Title the chart in the Panel, not inside the plot.

## 7. 3D scene conventions (Three.js, `sceneTheme.ts`)

`sceneTheme(theme)` returns every colour below. Pass hex strings to `new THREE.Color(hex)`;
`toThreeHex(hex)` is there for APIs that want an integer.

* **Surface**: a gray wireframe (`scene.surfaceLine`) on the panel surface, matching the reference
  figures. It is context only. Unsampled parts of the surface or line stay `scene.unsampled` gray.
* **Field lines**: tube identity colours come from the series palette (bean teal, triangular rust).
  The selected tube is drawn 1.6× wider. The unselected tube drops to 35% opacity.
* **Markers**: start ■, centre ●, end ▲, as in the figures, with a `markerOutline` halo.
* **Colour by |B|**: bring the value into 0–1 with `normalizeBmag(b, tube.bmagRange)`, then look it
  up with `bmagColor(t, theme)`. It returns sRGB in
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
| `Panel` | Titled region (`section` with `aria-labelledby`) | Eyebrow is the view name. The title says what is shown. The subtitle gives the *how* in plain words. `status` holds the ProvenanceBadge, `actions` holds controls, and `footer` holds sources and captions. Use `density="compact"` in side columns. The body is an inline-size query container: lay content out with `@container`, never with a viewport `@media` width query, so a 450px card on a wide screen gets the narrow layout. |
| `Stat` | A number with its unit, ±σ and window | `unit` is required. `decimals` must match a precision you can defend. `null` renders "— not available" and never 0. The accessible name reads the full sentence. Uncertainty uses the same decimals as the value. |
| `StatusPill` | State label | Use one status per pill. Override the text only with a synonym ("Replay · $0", "TERMINATE FAILED"). Only use `live` when the API reports live, and `billing-risk` only for the danger rows of §5. |
| `Alert` | Money at risk now: GPUs may still be billing | `role="alert"` with the billing-risk treatment (solid octagon icon, raspberry tint, solid outline, 4px leading bar) and a spoken "Danger:" before the `title`. `reason` is the backend's text, printed verbatim: never re-cased, shortened or paraphrased, and long tokens wrap. `children` say what to do; `action` holds the control that acts (Terminate, Retry, or a link to the page that has it). `announce={false}` for a second copy of a danger the page already announces: drawn the same, named the same, a group instead of a live region (§5). `compact` for the header's copy: tighter padding, a 16px icon and one type step down, with every part kept and the reason still whole. Use it only for the danger rows of §5; anything else is a `Callout`. |
| `ProvenanceBadge` | Kind + verification outcome; expands to solver revision, units, coverage, runtime, verification and sources (sha256) | Put one on every result panel or table. Escape closes the card and returns focus to the badge. A click outside closes it and leaves focus where the click landed. `align="start"` applies when it sits on the left edge. Kind `live` shows the live pill only with the `live` prop (§5); without it the badge reads "Recorded run". Only an http(s) source is a link; any other (a repository file such as `PRD.md`) is named as text with its reference beside it. Units are typeset with `Unit`. |
| `FixtureCheck` | PRD claim (a value or a range) vs computed value, with Δ and an outcome in glyph and words | **Source:** the claim is PRD.md's unless the fixture's `claimSource` is "task" (only `tasks/<NN>/TASK.md` prints it). Then every word that names the source says TASK.md: the column reads "Claimed (TASK.md)" or "TASK.md range", the outcome "Inside TASK.md range", "Outside TASK.md range", "Arithmetic in TASK.md range" or "No TASK.md value", and the spoken range "TASK.md range lo to hi"; no call site needs to relabel it (`claimedLabel` still overrides the column label alone). A match requires both `matches === true` and the values: identical printed strings for a claimed value. Printed values round an exact tie to even, as Python's round() does when the producer sets `matches` (0.125 at two decimals is 0.12). Δ is the difference of the two printed values, so it reads 0 exactly when they match. Otherwise it is a mismatch, and any disagreement between the flag and the values is called out. **Ranges (D-023):** when the fixture has `claimedRange` (and `claimed` is null), the claimed column reads "PRD range" with lo–hi (never broken at its dash; only the unit may wrap) and the unit, and the check is lo ≤ computed ≤ hi, unrounded: "Inside PRD range" ✓ or "Outside PRD range" ✗. The computed value is printed with two more decimals than the PRD prints, more when needed so it never lands on the other side of a bound (−3.49e-16 against 0–1 reads "−0.0000000000000003", not "0.00"), up to the 100 places toFixed() prints; when even 100 places cannot separate it from a bound (only a bound at or near 0 allows that), it is every digit of its shortest round-trip form. It is always in fixed notation, never "e-16", and so is Δ. `printedDecimals` above 100 prints 100 places. Δ becomes "Δ to range": 0 inside, otherwise the signed distance to the nearer bound, never an unsigned zero. No midpoint is ever shown or spoken, even when an old artifact still has one in `claimed`. `claimed` null without a range shows "—" and "No PRD value". Reading order, in the DOM and in both layouts, is name, claimed, computed, Δ, outcome, note. Stacked by default (name, then the three numbers in equal columns, then the outcome). Inside a query container at least 500px wide the outcome sits beside the numbers; at least 720px wide the check becomes one table row whose four data columns have fixed minimum widths, so stacked rows line up, and the name, the values and the outcome share a line. Only the note can collapse: a note longer than 160 characters shows two lines behind "Show full note". **Basis:** taken from the fixture's `basis` (D-023). The `basis` prop can only make a check more cautious: it can mark a data fixture `arithmetic`, never turn an arithmetic fixture into a data-backed ✓. `arithmetic` marks a check that only redid the arithmetic on PRD-reported inputs: a match then reads "Arithmetic consistent" (or "Arithmetic in PRD range") with an = glyph, neutral colour and a dashed edge, never the green ✓ of a data-backed check. The basis never softens a mismatch. |
| `SegmentedControl` | One choice among 2–5 peers (bean / triangular, window) | It is a radiogroup with one tab stop. ←→↑↓ move and select, Home/End jump, and disabled options are skipped. The track never clips: the focus ring sits 2px outside the segment, and a control wider than its container wraps. For more than 5 options, or for navigation, use tabs or a select instead. |
| `Callout` | Inline info, warn or blocked explanation | `role="note"` (static, not an alert). A blocked callout always says what would unblock it (`action`). |
| `Icon`, `Unit` | 16-grid stroke icons (`currentColor`, aria-hidden); unit subscripts (`Q_gB`, `a/v_{th,i}`) | Icons always sit next to text. Every icon name draws a different shape. |

## 9. Do / Don't

| Do | Don't |
|---|---|
| `2.674 → "2.67"` next to `"2.68 (PRD)"` with `Δ −0.01  ✗ Mismatch` | Round the computed value up to match the claim, or hide the claim |
| Show the reduced Modal run as `5.79 Q_gB` with the **PRD-reported** pill, beside 2.55/2.68 | Plot 5.79 as a trace, or style it like archive data |
| Show "Replay · $0" only in the live-state rows of §5 that list it | Print "$0" beside a billing risk, a launch that may be running or a status still being checked |
| Draw replayed and rehearsed data with the `replay` or `rehearsal` pill | Use red, a pulse or the word "live" for anything replayed or rehearsed |
| Pass `live` to a ProvenanceBadge only from the live-status path | Decide LIVE from a provenance record's kind |
| Show "GPUs may still be billing" with the billing-risk pill and an `Alert` that quotes the backend's reason | Improvise a red box, reuse the `failed` pill, or paraphrase or shorten the reason |
| Show a PRD range as "PRD range 14–15 days" with Inside or Outside | Show or speak the range's midpoint as if the PRD printed it |
| Name a repository file as a source in text | Link a relative path: it resolves to the app itself |
| Mark arithmetic on PRD-reported inputs with `basis="arithmetic"` | Show a green ✓ "Match" for a number no data in this repo backs |
| Label every axis with its unit: "Time t (a/v<sub>th,i</sub>)" | Leave unitless axes ("Q", "time") |
| Leave unsampled ranges gray and labelled | Interpolate a line across missing data, or colour gray regions |
| Pair every colour with an icon and text, and every series with a dash and marker | Encode verification state or series identity by hue alone |
| Write a blocked callout that names the missing input and the unblock step | Show an empty panel or a spinner for something that can never load |
| Take colours from `themes[theme]` / `var(--lab-…)` | Write hex, `rgb()` or named colours anywhere in `renderer/src` outside `tokens.ts` (a test fails) |
| Use `.lab-num` for every column of numbers | Use proportional digits in tables and Stats |
| Collapse a long explanatory note | Collapse, clamp or hide a value, a Δ or a mismatch |
| Size layouts with `@container` inside a Panel | Use a viewport `@media` width query for content that can sit in a narrow card |

## 10. Accessibility checklist

Enforced by tests unless a line says otherwise.

* Contrast (`contrast.test.ts`, pair list in `contrastPairs.ts`), checked in both themes, with alpha
  fills composited the way the browser paints them:
  * Every text token on every surface is at least 4.5:1.
  * Every status and callout foreground is at least 4.5:1 on its tint and (except `live`) on every
    surface, and body text is at least 4.5:1 on every tint.
  * Labels inside charts are at least 4.5:1 on the fill under them: the window label on the window
    band, the "unsampled" label on the gray block, also where the block lies over a band.
  * Control borders, the focus ring, the accent, chart lines, |B| stops, the LIVE fill on every
    surface, both dashed outlines, the billing-risk outline and the window edge are at least 3:1.
    The focus ring is also at least 3:1 on every status and callout tint.
  * Links and hovered links are at least 4.5:1 on every surface and on the tints that hold
    controls: the `Alert`, a mismatch row ("Show full note") and every callout.
  * Measured worst cases: text 4.81:1 (light) and 4.77:1 (dark); non-text 3.14:1 (light) and 3.10:1 (dark).
* The pair list is checked against the stylesheet (`css.test.ts`): it reads every colour
  `components.css` draws, in every state the rules combine, plus the focus ring around each control
  and the links in an `__action` slot, and fails when a pair is missing from `contrastPairs.ts` or
  held to a lower minimum than its kind needs. A colour is paired with the background its own rule
  paints, else with that of an element its selector puts it inside, else with the component's tint.
  A component with no background of its own (`Stat`, `ProvenanceBadge`) can sit on any panel, so
  its colours are paired with every surface (`SURFACE_PROPERTIES`), the provenance card's
  `surfaceRaised` among them.
* Colour is never the only signal: no two statuses share a label or an icon, and the four fixture
  outcomes differ in words and glyph (`components.test.tsx`).
* Colour literals: `noHardcodedColors.test.ts` scans all of `renderer/src` and `index.html` for hex,
  functional and named colours. In code, a named colour is caught as a whole string and anywhere in
  a string that reads as a CSS value (a length, a line style, `inset` or a gradient, also in a
  template literal). Only `tokens.ts`, `tokens.css`, test files and the one line in `color.ts` that
  formats a token at an alpha are exempt, and each exemption is itself tested.
* Keyboard: SegmentedControl follows the radiogroup pattern (all four arrows, Home, End),
  ProvenanceBadge is a disclosure with Escape, and focus is shown with `:focus-visible`.
* Focus rings (`tokens.test.ts`, `css.test.ts`): 2px in `color.focus`. No rule in the design CSS
  switches an outline off. Chart modebar buttons take the same ring: Plotly ships its own 1px black
  outline for them, so `tokens.css` carries a rule that the test proves more specific than Plotly's.
  The segmented control's ring is not clipped, and the track colour separates it from the selected
  fill.
* Targets: `summary` elements are at least 24px tall and keep their disclosure triangle; segments
  and the fixture note toggle are at least 24px tall.
* Names: Stat, FixtureCheck, ProvenanceBadge, Callout and Alert expose full spoken sentences,
  including the tone and outcome words.
* Live regions: one danger is announced once. A second copy of an `Alert` on the same page takes
  `announce={false}` (§5). Not enforced in the app yet: the live panel does not pass it (§5, "Not
  yet in the app"). Within an announcing Alert only the title and reason are announced; changes to
  its body and action are not (`aria-live="off"`, `components.test.tsx`).
* Motion: `prefers-reduced-motion` is honoured globally (`tokens.css`).
* Colour-blind safety: `palette.test.ts` (see §4).
* Not covered by unit tests, because jsdom lays nothing out: that the container layouts, the
  baseline alignment and the rings look right. `css.test.ts` pins the rules; design review checks
  the rendering at 1440 and 390 px in both themes in a real browser.

## 11. Public API

Everything `index.ts` exports at runtime. Import from `src/design`, never from a file inside it.

| Module | Exports |
|---|---|
| `tokens.ts` | `THEMES`, `STATUS_KINDS`, `SERIES_IDS`, `CALLOUT_TONES`, `themes`, `font`, `typeScale`, `fontWeight`, `space`, `radius`, `motion`, `shadow`, `zIndex`, `themeCssVars`, `staticCssVars`, `renderTokensCss`, `renderTokenReferenceMd` |
| `theme.ts` | `resolveTheme`, `setThemePreference`, `useResolvedTheme`, `useThemeTokens` |
| `format.ts` | `formatNumber`, `formatSigned`, `formatWindow`, `trimNumber`, `spokenWindow`, `parseUnit`, `spokenUnit`, `plotlyUnit` |
| `status.ts` | `STATUS_META`, `VERIFICATION_STATUS`, `CALLOUT_META`, `ALERT_META`, `provenanceStatus` |
| `plotTheme.ts` | `SERIES_LABEL`, `NARROW_CHART_QUERY`, `axisTitle`, `plotLayout`, `plotConfig`, `seriesColorway`, `seriesStyle`, `uncertaintyBand`, `windowShape`, `unsampledShapes`, `meanSegment` |
| `sceneTheme.ts` | `sceneTheme`, `toThreeHex`, `bmagColor`, `normalizeBmag`, `bmagGradientCss` |
| `components/` | `Panel`, `Stat`, `StatusPill`, `ProvenanceBadge`, `FixtureCheck`, `fixtureOutcome`, `SegmentedControl`, `Callout`, `Alert`, `Icon`, `Unit` |

Types are exported beside them: the token and theme types, `Provenance`, `FixtureCheckData`,
`FixtureBasis`, `PlotLayout`, `PlotLayoutOverrides`, `PlotLayoutOptions`, `SeriesStyle`, `SceneTheme`,
`IconName` and each component's `…Props`.

## 12. Token reference

Every custom property in `tokens.css`. This section is generated: `npm --prefix renderer run tokens`
rewrites the tables between the two markers, and `designDoc.test.ts` fails if they differ from
`tokens.ts`.

<!-- tokens:begin (generated by `npm --prefix renderer run tokens`; do not edit by hand) -->

### Theme tokens

| Custom property | Light | Dark |
|---|---|---|
| `--lab-color-bg` | `#f3f5f6` | `#0b1317` |
| `--lab-color-surface` | `#ffffff` | `#111b20` |
| `--lab-color-surface-sunken` | `#eef2f4` | `#0d161a` |
| `--lab-color-surface-raised` | `#ffffff` | `#17242a` |
| `--lab-color-surface-hover` | `#e9eef1` | `#1b2a31` |
| `--lab-color-border` | `#dbe2e6` | `#233239` |
| `--lab-color-border-strong` | `#73868e` | `#62777f` |
| `--lab-color-text` | `#14262f` | `#e4ecef` |
| `--lab-color-text-muted` | `#42565e` | `#a9b8be` |
| `--lab-color-text-subtle` | `#56686f` | `#91a3aa` |
| `--lab-color-accent` | `#0b7f80` | `#41b2b2` |
| `--lab-color-accent-hover` | `#096a6b` | `#5cc2c1` |
| `--lab-color-accent-text` | `#086a6b` | `#5cc2c1` |
| `--lab-color-accent-fg` | `#ffffff` | `#04191a` |
| `--lab-color-accent-subtle` | `#e2f1f0` | `#0f2a2b` |
| `--lab-color-focus` | `#0b7f80` | `#5cc2c1` |
| `--lab-color-shadow` | `rgba(20, 38, 47, 0.14)` | `rgba(0, 0, 0, 0.5)` |
| `--lab-status-live-fg` | `#ffffff` | `#ffffff` |
| `--lab-status-live-bg` | `#c4122f` | `#da2a48` |
| `--lab-status-live-border` | `#c4122f` | `#da2a48` |
| `--lab-status-billing-risk-fg` | `#9b1145` | `#ff8fb4` |
| `--lab-status-billing-risk-bg` | `#fce9f0` | `#36101f` |
| `--lab-status-billing-risk-border` | `#9b1145` | `#ff8fb4` |
| `--lab-status-replay-fg` | `#42565e` | `#b4c2c8` |
| `--lab-status-replay-bg` | `#eef2f4` | `#18252b` |
| `--lab-status-replay-border` | `#c9d3d8` | `#34464e` |
| `--lab-status-rehearsal-fg` | `#3a4796` | `#aab4f2` |
| `--lab-status-rehearsal-bg` | `#eceefa` | `#181d36` |
| `--lab-status-rehearsal-border` | `#c3c9ec` | `#3a4584` |
| `--lab-status-archive-fg` | `#2c5674` | `#97bfe2` |
| `--lab-status-archive-bg` | `#e8f0f6` | `#12212d` |
| `--lab-status-archive-border` | `#bcd0e0` | `#2e4d66` |
| `--lab-status-derived-fg` | `#086a6b` | `#6fcfcb` |
| `--lab-status-derived-bg` | `#e2f1f0` | `#0f2627` |
| `--lab-status-derived-border` | `#a9d4d2` | `#245e5d` |
| `--lab-status-prd-reported-fg` | `#6c5715` | `#dcc78c` |
| `--lab-status-prd-reported-bg` | `#f7f2e3` | `#241f12` |
| `--lab-status-prd-reported-border` | `#96803a` | `#8f7c40` |
| `--lab-status-unverified-fg` | `#56686f` | `#a9b8be` |
| `--lab-status-unverified-bg` | `#f6f8f9` | `#141f24` |
| `--lab-status-unverified-border` | `#73868e` | `#62777f` |
| `--lab-status-passed-fg` | `#1d6a39` | `#74d394` |
| `--lab-status-passed-bg` | `#e5f3e9` | `#11281a` |
| `--lab-status-passed-border` | `#a3d2b1` | `#2b6a3f` |
| `--lab-status-failed-fg` | `#b3261e` | `#ff8f85` |
| `--lab-status-failed-bg` | `#fcebea` | `#311513` |
| `--lab-status-failed-border` | `#efb0aa` | `#7a2b25` |
| `--lab-status-blocked-fg` | `#673f9c` | `#c7aaf5` |
| `--lab-status-blocked-bg` | `#f1ecf8` | `#221a33` |
| `--lab-status-blocked-border` | `#cbb9e4` | `#54417c` |
| `--lab-status-mismatch-fg` | `#a8400c` | `#ffa56b` |
| `--lab-status-mismatch-bg` | `#fdefe5` | `#321f10` |
| `--lab-status-mismatch-border` | `#efbb98` | `#7a4719` |
| `--lab-status-not-applicable-fg` | `#56686f` | `#a9b8be` |
| `--lab-status-not-applicable-bg` | `#eef2f4` | `#18252b` |
| `--lab-status-not-applicable-border` | `#c9d3d8` | `#34464e` |
| `--lab-callout-info-fg` | `#24557f` | `#93c0ee` |
| `--lab-callout-info-bg` | `#ebf2f8` | `#0f2134` |
| `--lab-callout-info-border` | `#9fbfda` | `#2d5582` |
| `--lab-callout-warn-fg` | `#7d4c00` | `#f0c26a` |
| `--lab-callout-warn-bg` | `#fcf4e2` | `#2a2110` |
| `--lab-callout-warn-border` | `#e0bd73` | `#6e5418` |
| `--lab-callout-blocked-fg` | `#673f9c` | `#c7aaf5` |
| `--lab-callout-blocked-bg` | `#f1ecf8` | `#221a33` |
| `--lab-callout-blocked-border` | `#b9a2dc` | `#54417c` |
| `--lab-series-stella` | `#1148b3` | `#467cc0` |
| `--lab-series-gene` | `#b68b16` | `#e5c057` |
| `--lab-series-gx` | `#2c2024` | `#ece6e7` |
| `--lab-series-bean` | `#0b7f80` | `#41b2b2` |
| `--lab-series-triangular` | `#a8482a` | `#c36953` |
| `--lab-plot-paper` | `#ffffff` | `#111b20` |
| `--lab-plot-plot` | `#ffffff` | `#111b20` |
| `--lab-plot-grid` | `#e6ebee` | `#1e2b31` |
| `--lab-plot-axis` | `#73868e` | `#62777f` |
| `--lab-plot-zero` | `#c3ced3` | `#34464e` |
| `--lab-plot-window-shade` | `rgba(11, 127, 128, 0.07)` | `rgba(65, 178, 178, 0.09)` |
| `--lab-plot-window-edge` | `#238c8d` | `#379495` |
| `--lab-plot-unsampled` | `#c9d2d6` | `#3a4a51` |
| `--lab-plot-unsampled-alpha` | `0.35` | `0.35` |
| `--lab-plot-band-alpha` | `0.18` | `0.22` |
| `--lab-scene-background` | `#ffffff` | `#111b20` |
| `--lab-scene-surface-line` | `#b8c6cc` | `#3c4d55` |
| `--lab-scene-surface-fill` | `#eef2f4` | `#162228` |
| `--lab-scene-surface-opacity` | `0.35` | `0.35` |
| `--lab-scene-unsampled` | `#b8c6cc` | `#3c4d55` |
| `--lab-scene-boundary` | `#5d6d75` | `#8a9ca4` |
| `--lab-scene-sampled-surface` | `#6a939a` | `#6fa3aa` |
| `--lab-scene-marker-outline` | `#ffffff` | `#111b20` |
| `--lab-bmag-0` | `#182b58` | `#546b9d` |
| `--lab-bmag-1` | `#003d63` | `#4980ab` |
| `--lab-bmag-2` | `#004f67` | `#4095b1` |
| `--lab-bmag-3` | `#006064` | `#42aab0` |
| `--lab-bmag-4` | `#006f5a` | `#58bcaa` |
| `--lab-bmag-5` | `#2f7b4a` | `#7ccba0` |
| `--lab-bmag-6` | `#608338` | `#a7d895` |
| `--lab-bmag-7` | `#888528` | `#d3e18e` |
| `--lab-bmag-8` | `#b28a29` | `#ffe891` |

### Scale tokens (the same in both themes)

| Custom property | Value |
|---|---|
| `--lab-font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "DejaVu Sans", Arial, sans-serif` |
| `--lab-font-mono` | `ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace` |
| `--lab-font-size-2xs` | `11px` |
| `--lab-line-height-2xs` | `16px` |
| `--lab-font-size-xs` | `12px` |
| `--lab-line-height-xs` | `16px` |
| `--lab-font-size-sm` | `13px` |
| `--lab-line-height-sm` | `20px` |
| `--lab-font-size-md` | `14px` |
| `--lab-line-height-md` | `20px` |
| `--lab-font-size-lg` | `16px` |
| `--lab-line-height-lg` | `24px` |
| `--lab-font-size-xl` | `20px` |
| `--lab-line-height-xl` | `28px` |
| `--lab-font-size-2xl` | `24px` |
| `--lab-line-height-2xl` | `32px` |
| `--lab-font-size-3xl` | `32px` |
| `--lab-line-height-3xl` | `40px` |
| `--lab-font-weight-regular` | `400` |
| `--lab-font-weight-medium` | `500` |
| `--lab-font-weight-semibold` | `600` |
| `--lab-font-weight-bold` | `700` |
| `--lab-space-0` | `0px` |
| `--lab-space-1` | `4px` |
| `--lab-space-2` | `8px` |
| `--lab-space-3` | `12px` |
| `--lab-space-4` | `16px` |
| `--lab-space-5` | `20px` |
| `--lab-space-6` | `24px` |
| `--lab-space-8` | `32px` |
| `--lab-space-10` | `40px` |
| `--lab-space-12` | `48px` |
| `--lab-space-16` | `64px` |
| `--lab-space-px` | `1px` |
| `--lab-space-0-5` | `2px` |
| `--lab-radius-xs` | `2px` |
| `--lab-radius-sm` | `4px` |
| `--lab-radius-md` | `6px` |
| `--lab-radius-lg` | `10px` |
| `--lab-radius-pill` | `999px` |
| `--lab-motion-fast` | `120ms` |
| `--lab-motion-base` | `180ms` |
| `--lab-motion-easing` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--lab-shadow-raised` | `0 1px 2px var(--lab-color-shadow), 0 8px 24px var(--lab-color-shadow)` |
| `--lab-z-popover` | `20` |
| `--lab-z-toast` | `30` |

<!-- tokens:end -->
