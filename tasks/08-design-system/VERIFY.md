# Verify: 08-design-system

Verifier run: 2026-11-20, commit 2b1607e + working tree. `renderer/src/design/` and
`renderer/scripts/gen-tokens-css.mjs` have no uncommitted changes (`git status --short` empty for both),
and the probe copy taken at the start was identical to the shared tree for both (`diff -rq`).
I did not write this code and I changed nothing in the repo except this file. Every mutation ran in an
isolated copy (`scripts/probe-copy.sh v08` -> `/home/qqbot/.cache/labyrinth-probes/v08`, deleted afterwards).
All colour numbers below come from my own Python (WCAG, CIELAB, CIEDE2000, CVD simulation); no repo helper was imported.

## Outcomes

| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| D1 | `DESIGN.md` documents principles, tokens, type scale, spacing, status semantics, chart conventions, component inventory, and matches the code | `designDoc.test.ts` (31 tests). Can fail: M1 red. Partial: M2 and M3a-M3f survive the whole renderer suite (it checks 7 of 17 colour tokens and only the direction code -> doc) | Own parser (`probe_doc.py`): 14/14 colour-table rows, 5/5 series rows, all 32 hex values, spacing, radius, type scale, motion, band alpha and 12/12 status rows equal the code; every `--lab-*` name in the doc exists; all 9 exported primitives and all 12 status kinds are documented; labels and icons are unique per kind. Three prose claims do not hold (F1, F10) | PASS for content and values; see F1, F4, F10 |
| D2 | `tokens.css` light + dark via `prefers-color-scheme` and `[data-theme]`; every used text/background pair meets WCAG AA (4.5 text, 3.0 UI/graphical) | `tokens.test.ts` (5), `contrast.test.ts` (395). Can fail: M4, M5, M6, M13, M27b, M28, M29 red. Blind spots: M33, M34 survive | Own WCAG code on values parsed from `tokens.css`, 264 gated pairs per theme. Text: every pair >= 4.5 (worst 4.74 light, 4.94 dark). Non-text at token level: all >= 3 except LIVE fill on `surfaceRaised` 2.90 (dark). Rendered focus indicator on chart modebar buttons: 1px `#000`, 1.20:1 in dark (computed style + screenshot). Theme selection at runtime: 4/4 combinations correct | FAIL for non-text in the dark theme (F1; also F5). Text pairs PASS |
| D3 | Series palette stella / GENE / GX / bean / triangular is colour-blind safe | `palette.test.ts` (29), `color.test.ts` (14), `themes.test.ts` (dash + marker). Can fail: M7, M8 red; the test has its own negative control | Own CIEDE2000 (checked against 6 Sharma-Wu-Dalal pairs) and own Machado 2009 / Vienot 1999 simulation: min pairwise dE00 under protanopia/deuteranopia 16.42 (light), 15.50 (dark) against the repo threshold 12; normal vision 30.33 / 27.41 (threshold 20); tritanopia 15.28 / 14.68 (threshold 8). Known-bad palettes score 1.25-4.97. Series that are plotted together always differ in dash or marker | PASS |
| D4 | `plotTheme.ts` and `sceneTheme.ts` derive from tokens; no colour literals outside `tokens.ts`; `tokens.css` generated | `noHardcodedColors.test.ts` (31), `tokens.test.ts` byte equality. Can fail: M9, M10, M13 red. Scope gap: M11, M12a, M12b survive the whole suite | Own scan of 86 files (`renderer/src/**/*.{ts,tsx,css}` + `renderer/index.html`, comments included, named colours included): no literal outside `tokens.ts` / `tokens.css` except test fixtures and the `rgba()` template in `color.ts`. `npm --prefix renderer run tokens` in the copy reproduces `tokens.css` byte for byte (14140 bytes, `cmp` exit 0, 0 CR bytes) | PASS (holds today); the guard is narrower than advertised (F3) |
| D5 | Primitives Panel, Stat, ProvenanceBadge, StatusPill, FixtureCheck, SegmentedControl, Callout with behavioural tests | `components/components.test.tsx` (34). Can fail: M14, M16-M26, M30, M39 red (14 mutations). Survive: M15 (design tests only), M15b, M27a, M35, M37a, M37b, M38 | Real browser through CDP: radiogroup keeps one tab stop, ArrowRight/ArrowDown/End move, select, wrap and switch `data-theme`; badge opens on Enter and Escape closes it with focus on the badge; primitives get `outline: solid 2px` in the focus token under `:focus-visible`; `prefers-reduced-motion: reduce` turns the LIVE pulse into `1e-05s x1` with no running animation; `.lab-num` computes `lining-nums tabular-nums` | PASS; gaps F2, F6, F12 |

## Real output

Commands were run from `D:\Labyrinth` in PowerShell; anything with pipes went through a `.sh`/`.py`/`.ps1`
file in my scratch directory
(`C:\Users\admin\AppData\Local\Temp\claude\cab28ef23558f274\9a7f397a-27eb-4e8c-9851-59a90e804ccb\scratchpad\v08`,
called `<scratch>` below). ANSI colour codes are stripped. Output lines are copied unchanged and in their
original order; where I left lines out, a line holding only `...` marks the cut.

### Environment

```
> wsl.exe -e bash scripts/dev.sh python3 --version
Python 3.12.3
> wsl.exe -e bash scripts/probe-copy.sh v08
/home/qqbot/.cache/labyrinth-probes/v08
> wsl.exe -e bash scripts/dev.sh bash <scratch>/gitinfo.sh
HEAD: 2b1607e
--- git status --short (design + task 08)
--- last commits touching renderer/src/design
27f77ea Design system: tokens, themes, primitives, gallery (verification pending)
--- copy vs shared tree: design dir identical?
identical: renderer/src/design
identical: gen-tokens-css.mjs
--- CRLF check in design dir (count of files containing CR)
0
--- sha256 of tokens.css / tokens.ts (shared tree)
05f7b87a470592d802d2f7af0683e015f988148ee2ebfaf3974a88e56c9df93d  /mnt/d/Labyrinth/renderer/src/design/tokens.css
41fd1affc0fe5f665d14413efdc26d7198eec9caa0fbbbaf7a03664ad80f5637  /mnt/d/Labyrinth/renderer/src/design/tokens.ts
```

### Gates (which scope, where)

1. `verify.sh renderer` on the shared tree: exit 0.

```
$ cd /mnt/d/Labyrinth && bash scripts/verify.sh renderer   # started 2026-11-20T14:22:28Z
...
 Test Files  19 passed (19)
      Tests  582 passed (582)
   Duration  184.23s (environment 72%, setup 22%, import 4%, worker 1%, tests 1%)
...
━━━ verify.sh summary (scope: renderer)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (32s)
  PASS  renderer:typecheck (13s)
  PASS  renderer:tests (187s)
  PASS  renderer:build (5s)
verify.sh: all stages passed.
EXIT CODE: 0
```

2. `verify.sh all` inside the probe copy, first run: exit 2. No test failed; three vitest fork workers
   did not start while the machine was at load average 15 (seven other agents testing), so three test
   files never ran, two of them design tests. See F13.

```
$ cd /home/qqbot/.cache/labyrinth-probes/v08 && bash scripts/verify.sh all
...
Error: [vitest-pool]: Failed to start forks worker for test files /home/qqbot/.cache/labyrinth-probes/v08/renderer/src/lib/contracts.test.ts.
...
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
...
Error: [vitest-pool]: Failed to start forks worker for test files /home/qqbot/.cache/labyrinth-probes/v08/renderer/src/design/designDoc.test.ts.
...
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
...
Error: [vitest-pool]: Failed to start forks worker for test files /home/qqbot/.cache/labyrinth-probes/v08/renderer/src/design/noHardcodedColors.test.ts.
...
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
...
 Test Files  16 passed (16)
      Tests  519 passed (519)
     Errors  3 errors
...
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (27s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (1s)
  PASS  renderer:typecheck (54s)
  FAIL  renderer:tests (110s)
  PASS  renderer:build (3s)
verify.sh: FAILED — fix the stages above and re-run. Exiting 2.
EXIT CODE: 2
```

3. `verify.sh all` inside the same probe copy, second run (no file changed in between): exit 0.

```
$ cd /home/qqbot/.cache/labyrinth-probes/v08 && bash scripts/verify.sh all   # started 2026-11-20T14:17:50Z
...
105 passed in 25.85s
...
 Test Files  19 passed (19)
      Tests  582 passed (582)
...
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (26s)
  PASS  artifacts:schema (1s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (16s)
  PASS  renderer:tests (187s)
  PASS  renderer:build (5s)
verify.sh: all stages passed.
EXIT CODE: 0
```

`verify.sh all` was not run on the shared tree (`main/` is being edited concurrently); the maintainer's run
on the integrated tree is the final word.

### Boundary rule

```
> wsl.exe -e bash scripts/dev.sh python3 scripts/check_boundaries.py
boundary: OK (142 files scanned)
exit code: 0
> wsl.exe -e bash scripts/dev.sh python3 scripts/check_boundaries.py --self-test
boundary self-test: OK (37 violations caught, 8 clean files passed)
self-test exit code: 0
```

### Design tests on their own (shared tree)

```
$ cd /mnt/d/Labyrinth && npm --prefix renderer run -s test -- src/design
 RUN  v5.1.1 /mnt/d/Labyrinth/renderer
 ✓ src/design/themes.test.ts (12 tests) 8ms
 ✓ src/design/color.test.ts (14 tests) 5ms
 ✓ src/design/contrast.test.ts (395 tests) 17ms
 ✓ src/design/components/components.test.tsx (34 tests) 316ms
 ✓ src/design/tokens.test.ts (5 tests) 8ms
 ✓ src/design/palette.test.ts (29 tests) 9ms
 ✓ src/design/noHardcodedColors.test.ts (31 tests) 86ms
 ✓ src/design/designDoc.test.ts (31 tests) 6ms
 Test Files  8 passed (8)
      Tests  551 passed (551)
   Start at  14:47:46
   Duration  79.09s (environment 74%, setup 22%, import 3%, worker 1%)
...
EXIT CODE: 0
```

### D4: regeneration and drift (probe copy)

```
> wsl.exe -e bash scripts/dev.sh bash <scratch>/mut.sh G0
===== G0 baseline in the probe copy =====
  $ npm --prefix renderer run -s tokens -> exit 0 wrote /home/qqbot/.cache/labyrinth-probes/v08/renderer/src/design/tokens.css 
  regenerated tokens.css byte-identical to the committed file: True (14140 vs 14140 bytes)
  $ cmp <copy>/renderer/src/design/tokens.css /mnt/d/Labyrinth/renderer/src/design/tokens.css -> exit 0 
  CR bytes in regenerated file: 0
...
    src/design/color.test.ts: 14 tests, passed
    src/design/contrast.test.ts: 395 tests, passed
    src/design/designDoc.test.ts: 31 tests, passed
    src/design/noHardcodedColors.test.ts: 31 tests, passed
    src/design/palette.test.ts: 29 tests, passed
    src/design/themes.test.ts: 12 tests, passed
    src/design/tokens.test.ts: 5 tests, passed
    src/design/components/components.test.tsx: 34 tests, passed
[G0] driver exit 0
```

Drift: M13 (edit `tokens.ts`, do not regenerate) turns
`tokens.css is generated from tokens.ts ... file content equals renderTokensCss() byte for byte` red.

### Mutations (all in the probe copy; pristine sources restored before each group)

Driver: `<scratch>\mutate.py`, vitest run with `--reporter=json`; a mutation counts as red only when a test
whose name matches the expected text fails. Red group runs: G1 `exit 1 ... tests 551; passed 530; failed 21`,
G2 `exit 1 ... tests 551; passed 509; failed 42`, G3a/G3b/G3c `exit 1 ... tests 5; passed 4; failed 1` each.

| ID | File | Mutation | Outcome |
|---|---|---|---|
| M1 | `design/DESIGN.md` | every `` `blocked` `` code span removed | RED: ``documents status `blocked` `` |
| M4 | `design/tokens.ts` (+regen) | light `textSubtle` `#56686f` -> `#8a979c` | RED: `WCAG AA contrast — light theme textSubtle on surface` (+6) |
| M5 | `design/tokens.css` | `[data-theme="dark"]` block hand-edited | RED: `dark values appear under prefers-color-scheme ...` |
| M6 | `design/tokens.ts` (+regen) | dark failed fg `#ff8f85` -> `#8f4a45` | RED: `dark theme status failed fg on its bg` (+7) |
| M7 | `design/tokens.ts` (+regen) | light triangular `#a8482a` -> olive `#7a8a1e` | RED: `series palette — light theme pairwise ΔE00 under deuteranopia (machado2009)` (+4) |
| M8 | `design/plotTheme.ts` | GENE gets stella's dash and marker | RED: `each series has a unique dash+marker pair` |
| M9 | `design/plotTheme.ts` | `linecolor: '#73868e'` | RED: `plotTheme.ts has no colour literals` |
| M10 | `design/sceneTheme.ts` | `background: '#' + 'ff0000'` (dodges the static regex) | RED: `emitted theme colours are tokens — light every colour is a token value` (static scan stayed green, as expected) |
| M13 | `design/tokens.ts` | accent `#0b7f80` -> `#0b7f81`, no regeneration | RED: `file content equals renderTokensCss() byte for byte` |
| M14 | `components/StatusPill.tsx` | text span removed | RED: 12 x `renders visible text and an aria-hidden glyph` |
| M16 | `components/FixtureCheck.tsx` | `matches: null` treated as a match | RED: `not recomputable shows — and says so` |
| M17 | `components/FixtureCheck.tsx` | trust the flag without comparing printed values | RED: `a "matches: true" flag that disagrees ...` |
| M18 | `components/Stat.tsx` | null rendered as 0 | RED: `null value says "not available" — never renders 0` |
| M19 | `components/Stat.tsx` | value loses `lab-num` | RED: `value + uncertainty + unit + window, tabular ...` |
| M20 | `components/Stat.tsx` | uncertainty never rendered | RED: same test |
| M21 | `components/SegmentedControl.tsx` | every radio `tabIndex={0}` | RED: `radiogroup semantics with one tab stop` |
| M22 | `components/SegmentedControl.tsx` | arrows stop skipping disabled options | RED: `arrow keys move focus and selection, skip disabled ...` |
| M23 | `components/SegmentedControl.tsx` | `role="radio"` -> `role="button"` | RED: `radiogroup semantics ...` |
| M24 | `components/Callout.tsx` | spoken tone prefix removed | RED: 3 x `is a note whose name speaks the tone` |
| M25 | `components/Panel.tsx` | `aria-labelledby` removed | RED: `is a region named by its heading ...` |
| M26 | `components/ProvenanceBadge.tsx` | Escape no longer handled | RED: `Escape closes and returns focus to the button` |
| M27b | `design/tokens.ts` (+regen) | global `:focus-visible` outline -> `none` | RED: `body background is explicit, numbers are tabular, focus ring and reduced motion exist` |
| M28 | `design/tokens.ts` (+regen) | reduced-motion media query neutralised | RED: same test |
| M29 | `design/tokens.ts` (+regen) | `tabular-nums` removed from `.lab-num` | RED: same test |
| M30 | `components/StatusPill.tsx` | live drawn with an icon, no dot | RED: `live is distinct: its own dot ...` |
| M39 | `components/FixtureCheck.tsx` | delta sign flipped | RED: `mismatch: claimed vs computed at printed precision ...` |
| M15 | `design/status.ts` | `failed` -> label `Verified`, icon `check` (differs from `passed` by colour only) | GREEN against the 8 design test files (`G6: vitest exit 0; tests 551; passed 551`). Red only in the whole suite, through task 09's `A4 header states the user decision and a global provenance legend is shown` (`shell/App.test.tsx:136`) |
| M2 | `design/tokens.ts` (+regen) | light `surfaceSunken` `#eef2f4` -> `#eef2f5`, doc table left stale | SURVIVED |
| M3a | `design/DESIGN.md` | `Icon`, `Unit` row removed | SURVIVED |
| M3b | `design/DESIGN.md` | spacing scale `64 px` -> `99 px` | SURVIVED |
| M3c | `design/DESIGN.md` | measured dE claim `16.4 / 15.5` -> `99.9 / 99.9` | SURVIVED |
| M3d | `design/DESIGN.md` | `color.focus` values -> `#123456` / `#654321` | SURVIVED |
| M3e | `design/DESIGN.md` | row for a component `Tabs` that does not exist | SURVIVED |
| M3f | `design/DESIGN.md` | status table says `failed` = check icon + "Verified" | SURVIVED |
| M11 | `components/components.css` | `color: red;` (named colour) | SURVIVED |
| M12a | `features/transport/transport.css` | `.tr-probe { color: #ff0000; background: rgb(1, 2, 3); }` | SURVIVED |
| M12b | `features/transport/model.ts` | `export const PROBE_COLOR = '#ff00ff';` | SURVIVED |
| M15b | `design/status.ts` | `failed` keeps its label, takes the `check` icon | SURVIVED |
| M27a | `components/components.css` | `.lab-seg__opt:focus-visible { outline: none; }` | SURVIVED |
| M33 | `design/tokens.ts` (+regen) | light `windowShade` alpha 0.07 -> 0.95 (window label on it ~1.6:1) | SURVIVED |
| M34 | `components/components.css` | `.lab-pill { opacity: 0.3; }` | SURVIVED |
| M35 | `components/Stat.tsx` | uncertainty loses `lab-num` | SURVIVED |
| M37a/b | `components/SegmentedControl.tsx` | ArrowDown / ArrowUp no longer handled | SURVIVED |
| M38 | `components/ProvenanceBadge.tsx` | outside click no longer closes the card | SURVIVED |

The 18 survivors were applied together and the whole renderer suite stayed green:

```
===== G5 (probes I expect the suite NOT to notice; whole renderer suite) =====
  vitest exit 0; files run 19; tests 582; passed 582; failed 0; file-level failures 0
```

26 mutations red, 18 survive the whole suite, 1 (M15) survives the design tests and is caught by a shell test.

### D2: contrast computed from the token values (own implementation)

`<scratch>\probe_colors.py tokens.css contrast`. Values are parsed from the generated `tokens.css`
(91 colour tokens per theme, same names in both, dark via media query == dark via `[data-theme]`).
Alpha tokens are composited in sRGB before measuring. 264 gated pairs per theme: the text tokens
(`text`, `textMuted`, `textSubtle`, `accentText`, `accentHover`) on all 8 surfaces, on every status tint and
every callout tint; each status and callout foreground on its own tint and on every surface; `accentFg` on
`accent` / `accentHover`; plot labels over the shaded window and unsampled regions; and the non-text set
(control border, focus ring, accent, axis, series, `|B|` stops, cross-section lines, LIVE fill, callout rule).

```
=== WCAG contrast, light theme: 264 gated pairs, 0 below threshold
  -- worst five DISTINCT colour pairs, text
      4.74:1  [#56686f on #e1e9eb]  unsampled label: text-subtle on unsampled@0.35 over windowShade over plot
      4.81:1  [#ffffff on #0b7f80]  accent-fg on accent (selected segment, primary button)
      4.98:1  [#56686f on #e9eef1]  status not-applicable fg on surfaceHover (bare label/outcome text)  (+2 more uses of the same two colours)
      5.01:1  [#56686f on #e2f1f0]  status not-applicable fg on accentSubtle (bare label/outcome text)  (+3 more uses of the same two colours)
      5.02:1  [#56686f on #f1ecf8]  text-subtle on callout blocked bg  (+1 more uses of the same two colours)
  -- worst five DISTINCT colour pairs, non-text
      3.14:1  [#b68b16 on #ffffff]  series gene on plot bg  (+1 more uses of the same two colours)
      3.20:1  [#b28a29 on #ffffff]  |B| stop 8 on scene bg
      3.25:1  [#73868e on #e9eef1]  border-strong (control boundary) on surfaceHover
      3.27:1  [#73868e on #e2f1f0]  border-strong (control boundary) on accentSubtle
      3.36:1  [#6a939a on #ffffff]  scene sampledSurface (cross-section line) on scene bg
=== WCAG contrast, dark theme: 264 gated pairs, 1 below threshold
  FAIL  2.90 < 3  live pill fill vs surfaceRaised  [#cf1739 on #17242a]
  -- worst five DISTINCT colour pairs, text
      4.94:1  [#91a3aa on #22343a]  unsampled label: text-subtle on unsampled@0.35 over windowShade over plot
      5.48:1  [#ffffff on #cf1739]  status live: fg on own bg (pill text + icon)
      5.51:1  [#91a3aa on #1f2b31]  unsampled label: text-subtle on unsampled@0.35 over plot
      5.64:1  [#91a3aa on #1b2a31]  text-subtle on surfaceHover
      5.79:1  [#91a3aa on #0f2a2b]  text-subtle on accentSubtle
  -- worst five DISTINCT colour pairs, non-text
      2.90:1  [#cf1739 on #17242a]  live pill fill vs surfaceRaised
      3.14:1  [#62777f on #1b2a31]  border-strong (control boundary) on surfaceHover
      3.19:1  [#cf1739 on #111b20]  live pill fill vs surface
      3.22:1  [#62777f on #0f2a2b]  border-strong (control boundary) on accentSubtle
      3.30:1  [#546b9d on #111b20]  |B| stop 0 on scene bg
```

Pairs measured but not gated, with the reason:

| Pair | Light | Dark | Treatment |
|---|---|---|---|
| Plotly modebar button focus outline (`#000`, 1px) on plot paper | 21.00 | **1.20** | Not exempt: focus indicator of an interactive control (F1) |
| LIVE pill fill on `surfaceHover` (hovered ProvenanceBadge) | 5.17 | **2.70** | Not exempt by the repo's own rule in `contrast.test.ts:46` (F5) |
| Window edge (`plot.windowEdge` over plot) | **1.90** | **2.68** | Not exempt in my reading: it is the boundary of the averaging window; it does carry a text label (F5) |
| Focus ring colour vs selected segment fill | 1.00 | 1.21 | Ring and fill are the same teal; separation is a 1px gap (F6) |
| Dashed outline, `prd-reported` border on surface | 1.86 | 2.63 | Exempt (icon + text carry the meaning), but `DESIGN.md:168` gives the dash a meaning (F11) |
| Dashed outline, `unverified` border on surface | 2.88 | 3.72 | Same |
| Disabled segment (`textMuted` at opacity .7 on `surfaceSunken`) | 3.40 | 4.97 | Exempt: inactive control |
| Disabled button text (`textSubtle` on `surfaceSunken`) | 5.17 | 7.00 | Exempt: inactive control; passes anyway |
| Hairline `border` on surface / on bg; panel surface vs bg; plot grid | 1.31 / 1.20; 1.09; 1.20 | 1.32 / 1.42; 1.07; 1.20 | Exempt: decorative dividers and grouping |
| Scene wireframe and `scene.unsampled` on scene bg | 1.75 | 1.98 | Wireframe is context. "Unsampled" gray in 3D has no text label, so I only note it |
| Series band at `bandAlpha` over plot | 1.20-1.43 | 1.30-1.87 | Exempt: redundant with the line |

Runtime check of the two selection paths (headless Edge 157 driven over CDP, `<scratch>\cdp.ps1`):

```
theme paths, OS light: {"mediaDark":false,"none":"#f3f5f6|rgb(243, 245, 246)","attrDark":"#0b1317|rgb(11, 19, 23)","attrLight":"#f3f5f6|rgb(243, 245, 246)"}
theme paths, OS dark:  {"mediaDark":true,"none":"#0b1317|rgb(11, 19, 23)","attrDark":"#0b1317|rgb(11, 19, 23)","attrLight":"#f3f5f6|rgb(243, 245, 246)"}
```

### D3: colour-blind safety (own implementation)

`<scratch>\probe_colors.py tokens.css cvd`. sRGB -> linear -> simulation -> XYZ (D65) -> CIELAB.
Difference metric: CIEDE2000 (kL = kC = kH = 1), CIE76 alongside. Simulation: Machado 2009 severity 1.0
(matrix typed from the paper) and Vienot 1999 composed by me from the classic RGB->LMS matrix, both in
linear RGB. Tritanopia: Machado only.

| Theme | Condition | min dE00 | min dE76 | Closest pair | Repo threshold |
|---|---|---|---|---|---|
| light | normal | 30.33 | 43.33 | stella / GX | 20 |
| light | protanopia (Machado) | 22.54 | 37.20 | GENE / triangular | 12 |
| light | protanopia (Vienot) | 23.40 | 34.77 | GENE / triangular | 12 |
| light | deuteranopia (Machado) | **16.42** | 25.56 | GENE / triangular | 12 |
| light | deuteranopia (Vienot) | 16.56 | 27.12 | GENE / triangular | 12 |
| light | tritanopia (Machado) | 15.28 | 20.62 | stella / bean | 8 |
| dark | normal | 27.41 | 42.84 | GENE / GX | 20 |
| dark | protanopia (Machado) | 15.77 | 22.56 | GX / bean | 12 |
| dark | protanopia (Vienot) | **15.50** | 22.17 | GX / bean | 12 |
| dark | deuteranopia (Machado) | 19.09 | 30.19 | stella / bean | 12 |
| dark | deuteranopia (Vienot) | 19.07 | 30.33 | stella / bean | 12 |
| dark | tritanopia (Machado) | 14.68 | 19.61 | stella / bean | 8 |

```
=== series palette, light theme: stella=#1148b3, gene=#b68b16, gx=#2c2024, bean=#0b7f80, triangular=#a8482a; plot bg #ffffff
...
  severity sweep protan (blend 0.05..1.0): lowest min dE00 19.78 at severity 0.85 [stella/bean]
  severity sweep deutan (blend 0.05..1.0): lowest min dE00 15.85 at severity 0.8 [stella/bean]
  subset transport chart {stella,gene,gx}: min dE00 over all conditions 29.8 (protan (vienot))
  subset scene tubes {bean,triangular}: min dE00 over all conditions 26.3 (protan (machado))
=== series palette, dark theme: stella=#467cc0, gene=#e5c057, gx=#ece6e7, bean=#41b2b2, triangular=#c36953; plot bg #111b20
...
  severity sweep protan (blend 0.05..1.0): lowest min dE00 15.77 at severity 1.0 [gx/bean]
  severity sweep deutan (blend 0.05..1.0): lowest min dE00 17.15 at severity 0.85 [stella/bean]
  subset transport chart {stella,gene,gx}: min dE00 over all conditions 19.4 (tritan (machado))
  subset scene tubes {bean,triangular}: min dE00 over all conditions 26.6 (protan (machado))
...
  control red/green/orange normal             min dE00 26.52
  control red/green/orange protan (machado)   min dE00 1.25
  control red/green/orange protan (vienot)    min dE00 1.90
  control red/green/orange deutan (machado)   min dE00 4.61
  control red/green/orange deutan (vienot)    min dE00 4.97
  control red/green/orange tritan (machado)   min dE00 14.46
...
  reference tab10[:5] protan (machado)   min dE00 1.25 [orange/green]
  reference tab10[:5] protan (vienot)    min dE00 1.90 [orange/green]
  reference tab10[:5] deutan (machado)   min dE00 4.61 [green/red]
  reference tab10[:5] deutan (vienot)    min dE00 4.97 [green/red]
```

On both theme backgrounds the series nearest to the plot background is still dE00 >= 35 away under every
simulation; the lowest simulated contrast against the background is GENE in light under deuteranopia, 2.98:1
(3.14:1 unsimulated; WCAG does not ask for simulated contrast).

Is the threshold meaningful? Yes. 12 dE00 sits between the palettes that are known to collapse (1.25-4.97)
and this one (>= 15.5), the repo test carries a negative control that must fail, M7 turns it red, and my
numbers reproduce the minima quoted in `DESIGN.md:135-137` (16.4 / 15.5, 30.3 / 27.4, 15.3 / 14.7) and the
values the gallery prints (16.4, 22.5, 30.3 light; 19.1, 15.8, 27.4 dark). The intermediate-severity sweep is
an approximation (linear blend of the matrix), and it does not dip below 15.8.

Non-colour channel: `plotTheme.ts:93-99` gives stella solid/circle/1.5, GENE dash/square/1.5,
GX solid/diamond/2.25, bean solid/hexagon/2, triangular dashdot/triangle-up/2, and `SERIES_LABEL` names every
legend entry. Three series share `solid`, and markers only show where a trace asks for them, so I checked the
call sites: transport draws stella and GENE as lines and GX as `lines+markers`
(`features/transport/model.ts:237,275`); the live chart pairs bean (solid) with triangular (dashdot) or
stella (solid) with GENE (dash) (`features/live-gx/LiveView.tsx:398,430`). Every pair that is drawn together
differs in dash or marker. Only the gallery specimen draws stella and GX as two solid marker-less lines
(`Gallery.tsx:86`).

### D4: own scan for colour literals

`<scratch>\scan_literals.py` (hex, `rgb()/hsl()/oklch()/lab()/color-mix()`, `0xRRGGBB`, the 148 named
colours as quoted strings in TS/TSX or as CSS values; comments not stripped).

```
scanned 86 files under /mnt/d/Labyrinth/renderer
hit counts per file:
     9  src/design/color.test.ts
     2  src/design/color.ts
     5  src/design/contrast.test.ts
     2  src/design/noHardcodedColors.test.ts
     2  src/design/palette.test.ts
     1  src/design/themes.test.ts
   273  src/design/tokens.css
   106  src/design/tokens.ts
```

Every hit outside `tokens.ts` / `tokens.css`, and whether it is a violation:

| Hit | Violation? |
|---|---|
| `color.ts:178`, `color.ts:181` — the comment and template `` `rgba(${r}, ${g}, ${b}, ${alpha})` `` in `withAlpha` | No: formats a token at an alpha, holds no colour value |
| `color.test.ts:32,35,36,44,51,52,60,63,68` — reference colours for the colour maths | No: test fixtures |
| `contrast.test.ts:72-76` — `#000000`, `#ffffff`, `#767676`, `#777777` reference values | No: test fixtures |
| `noHardcodedColors.test.ts:21,39` — the scanner's own positive controls | No |
| `palette.test.ts:54` — the deliberately bad control palette (`:43` is a false hit on `lab(`) | No |
| `themes.test.ts:85` — `toThreeHex('#0b7f80')` expectation | No |

No hit in `renderer/src/features`, `renderer/src/shell`, `renderer/src/lib` or `renderer/index.html`.
All 9 real `new THREE.Color(...)` / `setRGB(...)` call sites and all 4 inline `style={{...}}` colour props take
token-derived expressions (`Gallery.tsx:136,147,170,199,336,376`, `features/geometry/FluxScene.tsx:39,53,77,83,98,99`,
`features/geometry/ColorBar.tsx:13`).

### D1: document against code

`<scratch>\probe_doc.py`:

```
1. colour table rows (`color.X` | light | dark)
   14 rows, mismatches: 0
   colour tokens in tokens.css with no row in the DESIGN.md table: ['accent-hover', 'accent-subtle', 'shadow']
...
3. every hex quoted in DESIGN.md is a current token value
   hex values in doc: 32; not a token value: []
...
   spacing: doc keys ['0', 'px', '0-5', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16'] -> doc px [0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]; css px [0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]; OK
...
   type scale rows checked: 8; css steps: 8
...
   kinds in code: 12; rows in doc: 12; labels unique: True; icons unique: True
...
6. exported names of the design system vs DESIGN.md
   value exports: 56; not mentioned anywhere in DESIGN.md: ['CALLOUT_META', 'CALLOUT_TONES', 'SERIES_IDS', 'SERIES_LABEL', 'STATUS_KINDS', 'STATUS_META', 'THEMES', 'VERIFICATION_STATUS', 'fixtureOutcome', 'fontWeight', 'formatNumber', 'formatSigned', 'formatWindow', 'parseUnit', 'plotConfig', 'plotLayout', 'plotlyUnit', 'seriesColorway', 'seriesStyle', 'spokenUnit', 'spokenWindow', 'staticCssVars', 'themeCssVars', 'toThreeHex', 'trimNumber', 'typeScale', 'useThemeTokens', 'zIndex']
7. code-looking names in DESIGN.md backticks that do not exist in the design sources
   ['fallback', 'idle', 'launching', 'main.tsx', 'md', 'terminated']
PROBLEMS: none
```

Item 7 is clean: four live-status modes, `renderer/src/main.tsx`, and the type step `md`. The seven primitives
of D5 plus `Icon` and `Unit` are all documented; what is missing by name are helpers (`plotLayout`,
`plotConfig`, `seriesStyle`, the formatters) and three colour tokens.

### D5 and D2 in a real browser

`<scratch>\cdp.ps1` and `<scratch>\cdp2.ps1` drive headless Edge 157 against the served build
(`http://127.0.0.1:4173/#gallery`).

```
motion no-preference: {"reduce":false,"afterAnimation":"lab-live-pulse 1.6s xinfinite","afterOpacity":"0.145744","segTransitionDuration":"0.12s, 0.12s","runningAnimations":["lab-live-pulse:running:Infinity"]}
motion reduce:        {"reduce":true,"afterAnimation":"lab-live-pulse 1e-05s x1","afterOpacity":"0","segTransitionDuration":"1e-05s","runningAnimations":[]}
...
focus light tab#1 : {"tag":"BUTTON","cls":"lab-seg__opt","text":"System","role":"radio","checked":"true","expanded":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset 1px","bg":"rgb(11, 127, 128)","parentOverflow":"auto/auto","x":1209.8125,"y":27,"w":63.40625,"h":24}
...
focus light tab#2 : {"tag":"BUTTON","cls":"lab-prov__toggle","text":"ArchiveVerified","role":null,"checked":null,"expanded":"false","focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset 2px","bg":"rgba(0, 0, 0, 0)","parentOverflow":"visible/visible","x":357.3125,"y":264,"w":178.09375,"h":26}
...
focus dark tab#1 : {"tag":"BUTTON","cls":"lab-seg__opt","text":"System","role":"radio","checked":"true","expanded":null,"focusVisible":true,"outline":"solid 2px rgb(92, 194, 193) offset 1px","bg":"rgb(65, 178, 178)","parentOverflow":"auto/auto","x":1209.8125,"y":27,"w":63.40625,"h":24}
...
focus dark tab#4 : {"tag":"BUTTON","cls":"modebar-btn","text":"","role":null,"checked":null,"expanded":null,"focusVisible":true,"outline":"solid 1px rgb(0, 0, 0) offset 1px","bg":"rgba(0, 0, 0, 0)","parentOverflow":"visible/visible","x":481,"y":424,"w":24,"h":22}
...
Tab            -> {"active":"BUTTON:System","dataTheme":null,"bg":"#f3f5f6","checked":["System"],"tabStops":1,"provExpanded":"false","provDetailHidden":true}
ArrowRight     -> {"active":"BUTTON:Light","dataTheme":"light","bg":"#f3f5f6","checked":["Light"],"tabStops":1,"provExpanded":"false","provDetailHidden":true}
ArrowRight     -> {"active":"BUTTON:Dark","dataTheme":"dark","bg":"#0b1317","checked":["Dark"],"tabStops":1,"provExpanded":"false","provDetailHidden":true}
ArrowDown(wrap)-> {"active":"BUTTON:System","dataTheme":null,"bg":"#f3f5f6","checked":["System"],"tabStops":1,"provExpanded":"false","provDetailHidden":true}
End            -> {"active":"BUTTON:Dark","dataTheme":"dark","bg":"#0b1317","checked":["Dark"],"tabStops":1,"provExpanded":"false","provDetailHidden":true}
Tab (to badge) -> {"active":"BUTTON:ArchiveVerified","dataTheme":"dark","bg":"#0b1317","checked":["Dark"],"tabStops":1,"provExpanded":"false","provDetailHidden":true}
Enter on badge -> {"active":"BUTTON:ArchiveVerified","dataTheme":"dark","bg":"#0b1317","checked":["Dark"],"tabStops":1,"provExpanded":"true","provDetailHidden":false}
...
Escape         -> {"active":"BUTTON:ArchiveVerified","dataTheme":"dark","bg":"#0b1317","checked":["Dark"],"tabStops":1,"provExpanded":"false","provDetailHidden":true}
```

The full logs are `<scratch>\cdp-log.txt` and `<scratch>\cdp2-log.txt`. The modebar rule comes from the Plotly bundle
(`renderer/node_modules/plotly.js-dist-min/plotly.min.js`):
`"X .modebar-btn:focus-visible":"outline:1px solid #000;outline-offset:1px;border-radius:3px;"`.

Tabular figures: `.lab-stat__number` computes `font-variant-numeric: lining-nums tabular-nums`; ten `1`s and
ten `0`s both measure 148.02 px (Segoe UI digits are tabular with or without the class on this machine, so
the width check cannot discriminate here).

### Screenshots and what they show

All under `<scratch>`:

| File | How |
|---|---|
| `gallery-light-1440.png`, `gallery-dark-1440.png` | Edge headless `--window-size=1440,3000`; dark through `--force-dark-mode` (the `prefers-color-scheme` path; the page says "dark theme") |
| `gallery-light-390-cdp.png`, `gallery-dark-390-cdp.png` | True 390 CSS px through CDP device metrics at 2x (780 px wide images). Edge's `--window-size=390` clamps the window to about 500 px and crops the picture, so I discarded those files |
| `g390L-1..6.png`, `g390D-1..6.png`, `crop-l-*.png` | Crops of the files above |
| `focus-light-tab1..4.png`, `focus-dark-tab1..4.png` | 6x crops around the keyboard-focused element |
| `prov-open-dark.png` | ProvenanceBadge detail card, dark forced through `data-theme` |

At 390 px there is no horizontal page overflow in either theme on a fresh load
(`"innerWidth":390,"clientWidth":390,"scrollWidth":390,"scrollHeight":4132`). Defects I can see:

1. **FixtureCheck** (1440 and 390, both themes): stacked rows do not share columns. In the third row
   "Claimed (PRD)", "Computed" and "Δ" sit about 14 px left of the rows above, so the numbers do not line up
   down the table. Inside one row the "Computed" label and value sit about 3 px above "Claimed (PRD)" and "Δ"
   whenever a unit with a subscript is shown. (`crop-l-fixtures.png`, `g390L-2.png`)
2. **Chart modebar** (dark): the focused button's ring is invisible at normal size (`focus-dark-tab4.png`).
3. **SegmentedControl** focus: the ring is the same teal as the selected fill and the track clips it to about
   1 px, so focus shows only as a 1 px light gap inside the segment (`focus-light-tab1.png`,
   `focus-dark-tab1.png`).
4. **Chart** at 390: the "unsampled" label is cut by the right plot edge ("unsample") and the dotted window
   edge runs through it (`g390L-2.png`, `g390D-2.png`). With touch emulation the Plotly modebar covers the
   legend row (seen in the app's Browser pane at 390 px; no file kept).
5. **ProvenanceBadge** detail: "✓ Verified" sits about 2 px above the baseline of the sentence after it, and
   the units line prints `Q_gB` and `a/v_th,i` raw instead of with subscripts (`prov-open-dark.png`).
6. **StatusPill** `prd-reported` in light: the dashed outline, which the doc gives a meaning, is barely
   visible (1.86:1) (`crop-l-status.png`).
7. Gallery page only, 390: the 3D specimen torus is cropped on both sides; the Series-palette table truncates
   its headers to "GE…", "Tria…", "Deuterano…"; the status pills are stretched to the widest pill at every
   width (`g390L-3.png`, `g390L-4.png`, `g390L-5.png`).

Nothing else overflows or clips in the primitives; Stat values share a baseline; contrast in both themes
reads as computed.

### Honesty check

FixtureCheck treats a `matches: true` flag that disagrees with the printed values as a mismatch and says so
(M17 red), shows "Not recomputable" with a dash for `matches: null` (M16 red), and prints the delta with its
sign (M39 red). Stat renders "— not available" for null and never 0 (M18 red). The solid LIVE treatment exists
only for status `live` (M30 red). The gallery labels its data as synthetic in the header and the panel footer.

## Findings

Ranked. "Fix" is a suggestion for the owner; I changed nothing.

**F1 — blocker. Keyboard focus on chart modebar buttons is invisible in the dark theme.**
`renderer/src/design/plotTheme.ts:164` themes the modebar colours and `plotTheme.ts:171` (`plotConfig`) leaves the
modebar on, but nothing overrides Plotly's own `.modebar-btn:focus-visible { outline: 1px solid #000 }`, which
out-specifies the global rule at `renderer/src/design/tokens.ts:406-410`. Computed in the browser:
`solid 1px rgb(0, 0, 0)` on plot paper `#111b20` = 1.20:1 (needs 3:1). Every chart built with `plotConfig()`
is affected (`features/transport/PlotlyChart.tsx:45`, `features/geometry/PlotlyChart.tsx:34`, `Gallery.tsx:105`).
This contradicts `DESIGN.md:32-34` ("Every control works from the keyboard and shows a visible focus ring") and
the heading at `DESIGN.md:257` ("all enforced by tests"); no test looks at it.
Fix: add `.js-plotly-plot .plotly .modebar-btn:focus-visible { outline: 2px solid var(--lab-color-focus); outline-offset: 1px; }`
to the generated base CSS and assert it in `tokens.test.ts`.

**F2 — major (weak test). "Never colour alone" is not pinned by the design tests.**
`components/components.test.tsx:94-101` is titled "(not colour alone)" but only asserts that some text and some
`aria-hidden` node exist. M15 (`status.ts:43`: `failed` -> "Verified" + check icon) passes all 551 design tests;
it is caught only by task 09's legend test (`shell/App.test.tsx:136-137`). M15b (icon alone) passes the whole suite.
Fix: in the design tests assert that label and icon are unique across `STATUS_KINDS` and pin the label per kind.

**F3 — major (weak test). The colour-literal guard covers less than the docs say.**
`noHardcodedColors.test.ts:19,50` walks only `renderer/src/design`; the regex at `:22` knows no named colours.
M11 (`color: red` in `components.css`), M12a and M12b (hex / `rgb()` in `features/transport`) pass the whole
suite, while `interface.md:102` says "No hex/rgb literals outside tokens (scanned by test)" and `DESIGN.md:254`
says "(a test fails)". The outcome itself holds today (my scan: no literal anywhere in `renderer/src`).
Fix: walk `renderer/src`, and add a named-colour pattern for CSS colour properties and quoted TS strings.

**F4 — minor (weak test). `designDoc.test.ts` checks a sample, one way.**
`designDoc.test.ts:39-47` compares 7 of 17 colour tokens and the series and type rows; M2 and M3a-M3f survive
(stale `surfaceSunken`, falsified focus values, spacing, dE claims, a status row describing `failed` as
"Verified", an undocumented `Icon`/`Unit`, a documented component that does not exist).
Fix: parse the tables and compare every row; assert every `index.ts` component export has a row and every
component row has an export.

**F5 — minor. Non-text pairs below 3:1 that the contrast test cannot see.**
(a) LIVE pill fill on `surfaceRaised` 2.90:1 and on `surfaceHover` 2.70:1 in dark (`tokens.ts:222`); the pill sits
on `surfaceHover` when a live ProvenanceBadge is hovered (`components.css:167`, `ProvenanceBadge.tsx:74`), but
`contrast.test.ts:47-48` checks `surface` and `bg` only. (b) Window edge 1.90:1 light, 2.68:1 dark
(`tokens.ts:181,254`). (c) The test works on opaque tokens only, so text over alpha fills (M33) and CSS-level
opacity (M34) are outside it. Fix: lighten dark `status.live.bg` slightly or add the two surfaces to the test;
raise the edge alpha to about 0.8 light / 0.6 dark (3.40:1 / 3.29:1) or draw it in `plot.axis`; composite the
alpha tokens in the test.

**F6 — minor. SegmentedControl focus ring is weak.**
`components.css:291` (`overflow-x: auto` on `.lab-seg`) clips the 2px ring drawn at `components.css:315`
(offset 1px) to about 1px, and in light `color.focus` equals `color.accent` (`tokens.ts:138,143`); keyboard focus
is always on the selected segment, so ring and fill are the same colour. M27a (ring removed) passes the suite.
Fix: draw the ring inside the segment in `accent-fg` (`outline-offset: -3px`) or drop the clipping and offset it 2px.

**F7 — minor (visual). FixtureCheck does not line up.**
`components.css:221` sizes columns per row (`auto` tracks), so stacked rows do not form a table as
`DESIGN.md:238` promises; `components.css:222` (`align-items: center`) plus the taller `<sub>` unit lifts the
"Computed" cell about 3px. Fix: fixed tracks or `subgrid` under a wrapper, `align-items: start`, and
`.lab-fixture__unit sub { line-height: 0 }`.

**F8 — minor (visual). Chart at 390 px.** The `unsampledShape` label (`plotTheme.ts:271-276`) is clipped when
the region is narrower than the word; the legend at top-left (`plotTheme.ts:143-154`) collides with the modebar
on touch. Fix: place the label inside-left with `textposition: 'bottom left'` or drop it under a width
threshold; set `modebar.orientation: 'v'` or reserve top margin on narrow layouts.

**F9 — minor (gallery only).** `Gallery.tsx:139-141` uses a fixed camera, so the specimen is cropped at 390;
`gallery.css:45-47` truncates table headers; `gallery.css:42` stretches the pills (grid items).
`Gallery.tsx:86` draws stella and GX as two solid marker-less lines.

**F10 — minor (doc).** `DESIGN.md:237` says outside-click returns focus to the badge; the code only closes
(`ProvenanceBadge.tsx:44-46`). `DESIGN.md:151` says each `fg` is at least 4.5:1 on every surface; `live` fg is
white and `contrast.test.ts:40` skips it. `accentHover`, `accentSubtle`, `shadow` have no row in the section 3
table; `plotLayout`, `plotConfig`, `seriesStyle` are not named in section 6.

**F11 — minor.** The dashed outline that `DESIGN.md:168` gives a meaning is 1.86:1 (`prd-reported`, light,
`tokens.ts:152`), 2.63:1 (dark, `tokens.ts:227`) and 2.88:1 (`unverified`, light, `tokens.ts:153`).
Fix: darken the two border tokens to 3:1 or stop assigning meaning to the dash.

**F12 — minor (untested behaviour that the doc states).** ArrowUp/ArrowDown (`SegmentedControl.tsx:51-57`,
M37a/b), outside-click close (`ProvenanceBadge.tsx:44-46`, M38), tabular uncertainty (`Stat.tsx:69`, M35).
Fix: one assertion each in `components.test.tsx`.

**F13 — minor (gate, not this task's code).** Under load average 15 the first `verify.sh all` exited 2 because
three vitest fork workers timed out at start-up; no test failed and the rerun was green. The default pool with
one jsdom per file (`renderer/vite.config.ts:55-60`) is fragile on a shared machine.
Fix: cap the worker count or share the environment (`isolate: false`) for the pure-TS tests, and treat
"Failed to start forks worker" as a rerun, since the files it names did not execute.

**F14 — note.** `tasks/08-design-system/TASK.md:21` says 553 tests; the renderer suite now has 582, of which
551 are under `src/design`.

### Not checked

- Real colour-deficient viewers: simulation only, and intermediate severities by a linear blend.
- The 3D scene on a real GPU: headless Edge rendered it with software WebGL.
- Hover states, touch behaviour beyond the one pane observation, Firefox and Safari.
- Screen-reader output: accessible names were checked through ARIA attributes and testing-library, not a reader.
- The product views (`#/transport` and the others): I confirmed in the source that they use `plotConfig()`
  and the same primitives, and did not screenshot them.
- `verify.sh all` on the shared tree, by instruction.

Verdict: FAIL — dark-theme keyboard focus on chart modebar buttons renders as a 1px #000 outline at 1.20:1 (Plotly default, not themed), against DESIGN.md Principle 5 and section 10, and no test covers it; the status "not colour alone" test and the colour-literal scan also let through the regressions they name (M15 passes the design tests; M15b, M11, M12a, M12b pass the whole suite).

## Run 2 — whole task
Verifier run: 2026-11-20, commit 3faed3a

Before starting, `git status --short` showed only ` M status.md`, which this task does not own; `renderer/src/design/`
had no change against 3faed3a. I did not write this code and changed nothing in the repo except this file.
Mutations ran only in a copy from `scripts/probe-copy.sh vt-08-design-system` (deleted afterwards; after the last
revert `diff -rq` of the copy's `renderer/src` against the shared tree was empty). Every colour number in the probe
column comes from my own Python (WCAG 2.x, CIELAB, CIEDE2000, Machado 2009); no repo helper was imported.
The owner asked for short, non-redundant checks: one targeted mutation per outcome (5 in total), no browser
session, and no `verify.sh all` of my own.

Gate evidence (quoted, not rerun by me): the maintainer ran `verify.sh all` at commit 3faed3a on this tree:
exit 0, 11/11 stages (boundary self-test 134 shapes, scripts 71 passed, ruff clean, main 331 passed, artifacts
schema + fresh, tsc clean, vitest 1350 passed, vite build OK).

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| D1 | `DESIGN.md` documents principles, tokens, type scale, spacing, status semantics, chart conventions, component inventory | `designDoc.test.ts` (102): required section headings; colour, scale, series, status and component tables compared row by row with the code in both directions; every quoted hex must be a token value. Can fail: M5 red (2 tests) | Own parser on the raw files: all required sections present; section 5 has a row for live / replay / prd-reported / unverified / failed / blocked; section 8 names all 7 primitives; 138 distinct hex values quoted, none outside the token values | PASS |
| D2 | `tokens.css` light + dark via prefers-color-scheme and `[data-theme]`; all text/background pairs at WCAG AA | `tokens.test.ts` (11): byte equality with `renderTokensCss()`, dark values under both selectors, themed modebar focus rule ranked against the selector read from the installed Plotly bundle. `contrast.test.ts` (557): reference ratios, then every listed pair in both themes. Can fail: M1 red (7 pairs) | Own WCAG on values parsed from `tokens.css`: the media-query dark block equals the `[data-theme="dark"]` block; worst text on any surface 4.98 light / 5.64 dark; worst status fg on its bg 5.17 / 4.77; accent-fg on accent 4.81 / 7.11; series on plot paper 3.14 / 4.08; focus ring 4.12 / 6.99; modebar ring rule present (2px, focus token) | PASS |
| D3 | Series palette stella / GENE / GX / bean / triangular is colour-blind safe (pairwise ΔE under deuteranopia / protanopia above threshold) | `palette.test.ts` (33): Machado 2009 and Viénot 1999, gates 12 (protan/deutan), 20 (normal), 8 (tritan), with its own red/green/orange negative control. Can fail: M2 red (6 conditions) | Own CIEDE2000 (reproduces Sharma-Wu-Dalal pairs 2.0425 and 27.1492) with own Machado 2009 severity 1.0: min ΔE00 light normal 30.33, protan 22.54, deutan 16.42; dark normal 27.41, protan 15.77, deutan 19.09. Negative control scores 4.61 under deuteranopia | PASS |
| D4 | `plotTheme.ts` and `sceneTheme.ts` derive from tokens; no hard-coded hex outside tokens | `noHardcodedColors.test.ts` (124): walks all of `renderer/src` plus `index.html`, hex / functional / 0x / named colours, a runtime check of every colour the Plotly and Three themes emit, one exemption that is itself tested. Can fail: M3 red (literal in `features/transport`) | Own scan of 76 non-test `.ts/.tsx/.css` files: one hit, the `rgba()` template at `color.ts:181` (the test's single listed exemption). `plotTheme.ts` imports only `./color`, `./format`, `./tokens`; `sceneTheme.ts` only `./color`, `./tokens` | PASS |
| D5 | Primitives with tests: Panel, Stat, ProvenanceBadge, StatusPill, FixtureCheck, SegmentedControl, Callout | `components/components.test.tsx` (147): testing-library on the real components, nothing under test mocked; roles and names, badge Escape and outside click, radiogroup arrow keys, null Stat, FixtureCheck flag that disagrees with the values, status label and icon pinned per kind and unique. Can fail: M4 red | M4 (null Stat printed as `0.00`) turns the null test red; the other six primitives were read, not mutated (the owner asked for short checks) | PASS |

### Real output

Commands ran from `D:\Labyrinth` in PowerShell; the two scripts live in my scratch directory
`C:\Users\admin\AppData\Local\Temp\claude\cab28ef23558f274\9a7f397a-27eb-4e8c-9851-59a90e804ccb\scratchpad\vt-08-design-system`
(`<scratch>` below; WSL path under `/mnt/c/...`). ANSI colour codes are stripped.

```
> wsl.exe -e bash scripts/dev.sh python3 --version; wsl.exe -e git status --short
Python 3.12.3
 M status.md
> wsl.exe -e git rev-parse --short HEAD
3faed3a
```

```
> wsl.exe -e bash scripts/dev.sh npm --prefix renderer run -s test -- src/design
 RUN  v5.1.1 /mnt/d/Labyrinth/renderer

 ✓ src/design/tokens.test.ts (11 tests) 470ms
 ✓ src/design/noHardcodedColors.test.ts (124 tests) 444ms
 ✓ src/design/designDoc.test.ts (102 tests) 144ms
 ✓ src/design/css.test.ts (39 tests) 92ms
 ✓ src/design/contrast.test.ts (557 tests) 61ms
 ✓ src/design/palette.test.ts (33 tests) 19ms
 ✓ src/design/color.test.ts (14 tests) 8ms
 ✓ src/design/Gallery.test.tsx (9 tests) 907ms
   ✓ DS-21: the theme switch uses the app’s words — Auto / Light / Dark 383ms
 ✓ src/design/themes.test.ts (49 tests) 413ms
   ✓ plotTheme (27)
     ✓ the installed Plotly layers shapes as DL-4 assumes (the control for the test above) 388ms
 ✓ src/design/components/components.test.tsx (147 tests) 2261ms
   ✓ FixtureCheck renders D-023 fixtures: ranges, missing claims and the basis from the data (50)
     ✓ a sweep of values near bounds across magnitudes: never exponential; printed side, Δ sign and outcome follow the value 1220ms

 Test Files  10 passed (10)
      Tests  1085 passed (1085)
   Start at  22:40:33
   Duration  47.97s (environment 63%, setup 25%, import 5%, tests 3%, worker 2%, transform 1%)
```

```
> wsl.exe -e bash scripts/dev.sh python3 -I <scratch>/probe.py /mnt/d/Labyrinth
theme blocks: light vars 143 dark vars 97 media-dark == attr-dark: True
[light] worst text/surface 4.98 (color-text-subtle on color-surface-hover); worst status fg/bg 5.17 (not-applicable, 13 kinds); accent-fg/accent 4.81; worst series/plot-paper 3.14 (gene); worst focus ring 4.12 (color-surface-hover)
[dark] worst text/surface 5.64 (color-text-subtle on color-surface-hover); worst status fg/bg 4.77 (live, 13 kinds); accent-fg/accent 7.11; worst series/plot-paper 4.08 (stella); worst focus ring 6.99 (color-surface-hover)
modebar focus rule: /* Chart modebar buttons. Plotly injects its own focus rule for them at runtime (a 1px black
 * outline), after this sheet and more specific than the rule above; on the dark plot that ring
 * is 1.2:1. This selector out-ranks Plotly's (tokens.test.ts compares the two), so chart buttons
 * take the same themed ring as every other control. */
.js-plotly-plot .plotly .modebar .modebar-btn:focus-visible -> outline: 2px solid var(--lab-color-focus); outline-offset: 1px; border-radius: var(--lab-radius-xs);
CIEDE2000 self-check: 2.0425 27.1492
negative control (#d62728/#2ca02c/#ff7f0e) deuteranopia min dE00: 4.61
[light] series min pairwise dE00: normal 30.33 (stella/gx); protanopia 22.54 (gene/triangular); deuteranopia 16.42 (gene/triangular)
[dark] series min pairwise dE00: normal 27.41 (gene/gx); protanopia 15.77 (gx/bean); deuteranopia 19.09 (stella/bean)
colour-literal scan: 76 non-test files, 1 hits
   renderer/src/design/color.ts:181: return `rgba(${r}, ${g}, ${b}, ${alpha})`;
plotTheme.ts imports: ['./color', './format', './tokens']
sceneTheme.ts imports: ['./color', './tokens']
D1: six statuses have a §5 row; primitives in §8: ['Panel', 'Stat', 'ProvenanceBadge', 'StatusPill', 'FixtureCheck', 'SegmentedControl', 'Callout']
D1: 138 distinct hex values quoted in DESIGN.md; not a token value: []
D1: sections present: Principles, Tokens, Type scale, Spacing, Status semantics, Chart conventions, Components
```

Mutations (`<scratch>/mutate.sh <copy>`: apply one textual change, run one test file with `npx vitest run`, restore).
In the first pass my output filter showed only passing lines for M3, and for M5 my backup file
`DESIGN.md.orig`, written next to the mutated file, added one unrelated failure (the section 2 file list).
I moved the backup out of the tree and reran M3 and M5; M1, M2 and M4 below are from the first pass,
M3 and M5 from the rerun.

```
> $copy = wsl.exe -e bash scripts/probe-copy.sh vt-08-design-system
copy: /home/qqbot/.cache/labyrinth-probes/vt-08-design-system
> wsl.exe -e bash scripts/dev.sh bash <scratch>/mutate.sh $copy
=== M1: tokens.ts: 'textSubtle: '#91a3aa'' -> 'textSubtle: '#5a6b72'' (matches before: 1)
     × textSubtle on bg 2ms
     × textSubtle on surface 0ms
     × textSubtle on surfaceSunken 0ms
     × textSubtle on surfaceRaised 0ms
     × textSubtle on surfaceHover 0ms
     × textSubtle on accentSubtle 0ms
     × textSubtle on plotPaper 0ms
 FAIL  src/design/contrast.test.ts > WCAG AA contrast — dark theme > textSubtle on bg
  exit=1
=== M2: tokens.ts: 'bean: '#41b2b2'' -> 'bean: '#4a80c4'' (matches before: 1)
     × pairwise ΔE00 under normal vision 3ms
     × pairwise ΔE00 under protanopia (machado2009) 1ms
     × pairwise ΔE00 under protanopia (vienot1999) 0ms
     × pairwise ΔE00 under deuteranopia (machado2009) 1ms
     × pairwise ΔE00 under deuteranopia (vienot1999) 0ms
     × pairwise ΔE00 under tritanopia (machado2009) 1ms
 FAIL  src/design/palette.test.ts > series palette — dark theme > pairwise ΔE00 under normal vision
AssertionError: closest pair stella/bean: ΔE00 1.5 < 20: expected 1.5140738460362795 to be greater than or equal to 20
  exit=1
...
=== M4: Stat.tsx: 'formatNumber(hasValue ? value : null, decimals)' -> 'formatNumber(hasValue ? value : 0, decimals)' (matches before: 1)
     × null value says "not available" — never renders 0 11ms
 FAIL  src/design/components/components.test.tsx > Stat > null value says "not available" — never renders 0
 Test Files  1 failed (1)
      Tests  1 failed | 146 passed (147)
  exit=1
...
> wsl.exe -e env ONLY=M3,M5 bash scripts/dev.sh bash <scratch>/mutate.sh /home/qqbot/.cache/labyrinth-probes/vt-08-design-system
=== M3: PlotlyChart.tsx: 'export type PlotTrace = Record<string, unknown>;' -> 'export type PlotTrace = Record<string, unknown>; export const probeColour = '#ff0000';' (matches before: 1)
     × src/features/transport/PlotlyChart.tsx has no colour literals 4ms
 FAIL  src/design/noHardcodedColors.test.ts > no hard-coded colours outside tokens > src/features/transport/PlotlyChart.tsx has no colour literals
AssertionError: expected [ Array(1) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 123 passed (124)
  exit=1
=== M5: DESIGN.md: '| `color.textSubtle` | `#56686f`' -> '| `color.textSubtle` | `#56686e`' (matches before: 1)
     × color.textSubtle shows the current light and dark values 6ms
     × every hex colour quoted anywhere is a current token value 3ms
 FAIL  src/design/designDoc.test.ts > §3 colour table: one row per `color.*` token, both themes > color.textSubtle shows the current light and dark values
AssertionError: light: expected '#56686e' to be '#56686f' // Object.is equality
 FAIL  src/design/designDoc.test.ts > nothing in DESIGN.md names a value or a property that does not exist > every hex colour quoted anywhere is a current token value
AssertionError: expected [ '#56686e' ] to deeply equal []
 Test Files  1 failed (1)
      Tests  2 failed | 100 passed (102)
  exit=1
=== copy restored? (diff against the shared tree)
renderer/src identical
> wsl.exe -e bash -c 'rm -rf -- /home/qqbot/.cache/labyrinth-probes/vt-08-design-system; ls /home/qqbot/.cache/labyrinth-probes/ | grep -c vt-08-design-system'
0
```

### Findings

No defect found in what this run checked. Status of the run-1 findings at 3faed3a:

- Run-1 F1 (modebar focus ring): addressed. `renderer/src/design/tokens.css:392` (generated from
  `renderer/src/design/tokens.ts:428`) themes the ring; `renderer/src/design/tokens.test.ts:62-104` ranks it against the
  selector read from the installed Plotly bundle, and `contrast.test.ts:48` gates the ring on plot paper. I checked
  this statically only; I did not render a chart in a browser this time.
- Run-1 F2 (status not colour alone): addressed. `renderer/src/design/components/components.test.tsx:128-190` pins the
  label and icon of every kind and asserts both are unique.
- Run-1 F3 (literal guard scope): addressed. `renderer/src/design/noHardcodedColors.test.ts:149` walks all of
  `renderer/src` plus `index.html` and knows named colours; M3 in `features/transport` is caught.
- Run-1 F4 (doc test sampled one way): addressed. `designDoc.test.ts` compares every row in both directions; M5 is caught.
- Run-1 F5, F6, F11 (non-text pairs): the pairs are now in the list at `renderer/src/design/contrast.test.ts:37-63` and pass.
  I did not recompute those alpha composites myself.
- Minor (doc): `tasks/08-design-system/TASK.md:21` still says "553 tests"; the design suite now runs 1085.

### Not checked

- Anything in a real browser: rendered focus rings (modebar included), reduced motion, layout items F6-F9 from run 1.
- Real colour-deficient viewers (simulation only), screen-reader output.
- `verify.sh all` on the shared tree, by instruction (maintainer's result quoted above).

Verdict: PASS

## Run 3 — whole task
Verifier run: 2026-11-22, commit 9e017b6
### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| D1 | Design documentation covers system rules and components | `renderer/src/design/designDoc.test.ts` | Read the current DESIGN.md sections for status, charts, scenes and components | PASS |
| D2 | Theme tokens meet contrast requirements | `renderer/src/design/contrast.test.ts` | Ran the full focused design suite in both themes | PASS |
| D3 | Series palette remains distinct under simulated colour vision | `renderer/src/design/palette.test.ts` | Reviewed the independent negative controls and both simulation models used by the test | PASS |
| D4 | Plot and scene themes derive from tokens | Design token, plot and scene tests | Imported token data directly through Node and compared the named scene values | PASS |
| D5 | Primitives provide tested semantics and controls | `renderer/src/design/components/components.test.tsx` | Browser exercised the visible provenance disclosure and model status content | PASS |
| D6 | Heat and field ramps, diverter and model status meet the requirement | `ramps.test.ts`, `palette.test.ts`, `Gallery.test.tsx` and component tests | Direct token probe measured light field-to-heat separation of 39.66 and dark separation of 34.92, with diverter edge contrasts 17.87 and 14.95 | PASS |
### Real output
`PATH=/Users/bedelau/Desktop/Labyrinth/app-checkout/.venv/bin:$PATH VITEST_MAX_WORKERS=2 bash scripts/dev.sh bash scripts/verify.sh all` exited 0. Summary: 71 script tests, 378 backend tests, renderer typecheck, 1736 renderer tests and build all passed.

`PATH=/Users/bedelau/Desktop/Labyrinth/app-checkout/.venv/bin:$PATH VITEST_MAX_WORKERS=2 bash scripts/dev.sh npm --prefix renderer run -s test -- src/features/forecast src/design src/shell src/lib` exited 0. 26 files and 1529 tests passed.

`PATH=/Users/bedelau/Desktop/Labyrinth/app-checkout/.venv/bin:$PATH bash scripts/dev.sh python3 scripts/check_boundaries.py` exited 0. `boundary: OK (208 files scanned)`.
### Findings
Colour-vision checks are deterministic simulations. The Chromium probe at 390, 900 and 1440 px loaded Heat and field, opened the model provenance explanation and recorded no page errors. It does not substitute for usability testing with colour-deficient people or a screen-reader session.

Verdict: PASS
