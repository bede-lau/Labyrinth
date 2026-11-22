# Verify: 09-app-shell
Verifier run: 2026-11-20, commit `2b1607e` + working tree. `git status --short` was empty for `renderer/`,
`artifacts/` and `contracts/` at the start and at the end of the run (other agents changed only files under
`main/labyrinth_main/features/live_gx/`, `main/labyrinth_main/server/`, two live tests, `scripts/dev.sh`,
`status.md` and `tasks/01-geometry/VERIFY.md`).

Where things ran (Windows + WSL, every command through `wsl.exe -e bash scripts/dev.sh …`):
- `verify.sh renderer`, the named tests and the read-only probes: the shared tree `D:\Labyrinth`.
- `verify.sh all`, every mutation and every probe test I wrote: isolated copies made with
  `scripts/probe-copy.sh v0509` (plus `v0509b/c/d` for parallel mutation runs, checked identical to the first
  copy with `diff -rq`). All copies were deleted at the end. The shared tree was never mutated.
- Real browser: headless Edge 157. Screenshots and DOM dumps against the static build served on
  `http://127.0.0.1:4173` (vite preview of `renderer/dist`, no API behind it); key presses and history
  through the DevTools protocol; live-status scenarios against a scripted static server of my own
  (the copy's `renderer/dist` plus a fixed `/api/live/status` body per port, 127.0.0.1 only).
- Evidence files (scripts, logs, screenshots) are outside the repo, in
  `C:\Users\admin\AppData\Local\Temp\claude\cab28ef23558f274\9a7f397a-27eb-4e8c-9851-59a90e804ccb\scratchpad\v0509`.

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| A1 | Navigation across the six views, keyboard accessible, URL hash reflects the view | `renderer/src/shell/App.test.tsx` › "A1 navigation reaches all six views by keyboard and the URL hash names the view": real `App` (views replaced by markers), Tab and Enter through `userEvent`, real jsdom hash navigation, `aria-current`, main landmark name, title, hashchange, unknown hash. Can fail: 10 of 10 mutations red | jsdom probe (22 tests): Tab order, skip link, `history.back()/forward()`, 14 malformed hashes, deep links. Real browser over the DevTools protocol: real Tab/Enter key events, `:focus-visible` with a 2 px solid outline on every stop, Back/Forward, unknown hash, deep link. All agree | PASS |
| A2 | Global mode indicator: REPLAY ($0) vs LIVE, driven by `/api/live/status`; with no backend reachable the app runs fully in replay | same file › "A2 global mode: REPLAY ($0) unless /api/live/status reports live; no backend => full replay" and `renderer/src/lib/lib.test.tsx` › "live status: unreachable backend is not live; only mode=live is live". Can fail: 11 of 14 mutations red; 3 survive (finding 4, 8) | Indicator driven with 6 modes, an unreachable API, HTTP 500/404, HTML with status 200, truncated/empty/partial JSON, wrong types. LIVE appears only for `mode === "live"` and replay stays usable when the API is unreachable: agree. **Disagree:** (a) a `reason` of `TERMINATE FAILED…` or `TERMINATION PENDING…` is not shown as danger by the global indicator (finding 1); (b) a partial body `{"schemaVersion":1,"mode":"fallback"}` blanks the whole page (finding 2) | **FAIL** |
| A3 | Typed artifact loader with loading / error / data states; a missing or invalid artifact shows an error panel naming the file, never a blank screen | `renderer/src/shell/ArtifactGate.test.tsx` › "A3 artifact loading/error/data states…" and two tests in `lib.test.tsx`. Real `useArtifact` + `ArtifactGate` with an injected fetch; nothing under test is mocked. Can fail: 11 of 13 mutations red; 2 survive (finding 6) | The real app (no view mocks) on all six routes × 11 broken artifact responses (404, 500, truncated JSON, `schemaVersion` 2 and "1", HTML with status 200, wrong shape, network error, `null`, `[]`, empty body): 66 of 66 render a panel, 0 blank, 0 uncaught errors, 65 name the right file (finding 7). Real browser: `artifacts/spatial.json` answered with `index.html` and status 200 gives "Could not load artifacts/spatial.json" | PASS |
| A4 | Header states the user decision: "Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?" and a global provenance legend | same file as A1 › "A4 header states the user decision and a global provenance legend is shown". Can fail: 8 of 8 mutations red | Question: TASK.md string, `DECISION_QUESTION`, the served bundle and the `<h1>` of all six routes are identical. Legend against `contracts/common.schema.json`: the outcome `not-applicable` has no legend entry although `#/budget` draws three "Not applicable" pills; kind `live` is explained in words only (finding 3) | **FAIL** (question PASS, legend incomplete) |
| A5 | Static build (`npm run build`) contains `dist/artifacts/*.json` so replay works with no backend | `renderer/src/shell/build.test.ts` › "A5 static build copies artifacts/*.json into <outDir>/artifacts so replay needs no backend": the real config registers the build-only plugin; its hooks are run against a temp dir and compared file by file. Can fail: 6 of 6 mutations red | sha256 of all six files: `artifacts/` = copy's `renderer/dist/artifacts/` = shared `renderer/dist/artifacts/` = bytes served by `:4173`. A real `npm run build` without the plugin produces no `dist/artifacts`. Six routes screenshotted from the static build: no error panel, no blank view, mode "Replay · $0" | PASS |

## Real output

### 1. Gates
```
$ wsl.exe -e bash scripts/dev.sh bash scripts/verify.sh renderer ; echo EXIT=$?        (shared tree, HEAD 2b1607e)
 Test Files  19 passed (19)
      Tests  582 passed (582)
━━━ verify.sh summary (scope: renderer)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (35s)
  PASS  renderer:typecheck (16s)
  PASS  renderer:tests (199s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
EXIT=0

$ (cd ~/.cache/labyrinth-probes/v0509 && bash scripts/verify.sh all) ; echo EXIT=$?   (isolated copy taken at the start of the run)
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (27s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (60s)
  PASS  renderer:tests (102s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
EXIT=0

$ python3 scripts/check_boundaries.py     (shared tree)
boundary: OK (142 files scanned)
exit=0
```
`verify.sh all` was not run on the shared tree (another agent was editing `main/`); the maintainer's run on
the integrated tree is the final word. The gates are green. The verdict below is FAIL because two probes
disagree with the outcome, not because of a gate.

### 2. The named tests on their own (shared tree)
```
$ npm --prefix renderer run -s test -- src/features/spatial src/shell src/lib --reporter=verbose
 ✓ src/lib/lib.test.tsx > artifactUrl points at /artifacts/<id>.json 7ms
 ✓ src/lib/lib.test.tsx > fetchArtifact rejects wrong schemaVersion and HTTP errors with the file name 7ms
 ✓ src/lib/lib.test.tsx > useArtifact goes loading -> error naming the file (never blank) 67ms
 ✓ src/lib/lib.test.tsx > live status: unreachable backend is not live; only mode=live is live 55ms
 ✓ src/shell/ArtifactGate.test.tsx > A3 artifact loading/error/data states: missing or invalid artifacts name the file, never blank 204ms
 ✓ src/shell/build.test.ts > A5 static build copies artifacts/*.json into <outDir>/artifacts so replay needs no backend 129ms
 ✓ src/shell/App.test.tsx > A1 navigation reaches all six views by keyboard and the URL hash names the view 310ms
 ✓ src/shell/App.test.tsx > A2 global mode: REPLAY ($0) unless /api/live/status reports live; no backend => full replay 41ms
 ✓ src/shell/App.test.tsx > A4 header states the user decision and a global provenance legend is shown 18ms
 ✓ src/lib/contracts.test.ts > artifacts/manifest.json validates and every listed artifact validates 214ms
 Test Files  6 passed (6)
      Tests  12 passed (12)
exit=0
```
Reading the tests: none is tautological. `App.test.tsx` mocks the six feature views (markers), which is
fair for a shell test, and nothing of the shell itself. `ArtifactGate.test.tsx` and `lib.test.tsx` inject a
fetch function and use the real hooks. `build.test.ts` imports the real `vite.config.ts`. What they do not
cover is listed in the findings.

### 3. Mutations (isolated copies; each entry: mutated line, exit code of the named test run, first failing assertion)
Control on the unmutated copy:
```
$ npm --prefix renderer run -s test -- src/shell/App.test.tsx src/shell/ArtifactGate.test.tsx src/shell/build.test.ts src/lib/lib.test.tsx
    exit=0     Test Files  4 passed (4)     Tests  9 passed (9)
```
A1 — `npm --prefix renderer run -s test -- src/shell/App.test.tsx -t A1`
```
=== [MA1] hashchange listener removed                 useHashRoute.ts :: > (deleted)
    exit=1  × A1  TestingLibraryElementError: Unable to find an element with the text: view:advance.
=== [MA2] aria-current removed                        App.tsx :: > (deleted)
    exit=1  × A1  Error: expect(element).toHaveAttribute("aria-current", "page")
=== [MA3] href without the slash                      routes.ts :: > return `#${id}`;
    exit=1  × A1  AssertionError: expected '#locate' to be '#/locate' // Object.is equality
=== [MA4] nav links not keyboard reachable            App.tsx :: > <a className="shell-nav__link" tabIndex={-1} href={hrefFor(r.id)}
    exit=1  × A1  Error: expect(element).toHaveFocus()
=== [MA5] unknown/empty hash not rewritten in the URL useHashRoute.ts :: > (deleted)
    exit=1  × A1  AssertionError: expected '' to be '#/locate' // Object.is equality
=== [MA6] Budget route dropped                        routes.ts :: > (deleted)
    exit=1  × A1  AssertionError: expected [ 'Locate the tubes', …(4) ] to deeply equal [ 'Locate the tubes', …(5) ]
=== [MA7] #/spatial renders the budget view           App.tsx :: > spatial: BudgetView,
    exit=1  × A1  TestingLibraryElementError: Unable to find an element with the text: view:spatial.
=== [MA8] main landmark not named after the view      App.tsx :: > tabIndex={-1}>
    exit=1  × A1  Error: expect(element).toHaveAccessibleName()
=== [MA9] unknown hash keeps the previous view        useHashRoute.ts :: > if (parsed) setRoute(parsed);
    exit=1  × A1  TestingLibraryElementError: Unable to find an element with the text: view:locate.
=== [MA10] nav links without link role, click only    App.tsx :: > <a className="shell-nav__link" role="presentation" onClick={() => { location.hash = hrefFor(r.id); }}
    exit=1  × A1  TestingLibraryElementError: Unable to find an accessible element with the role "link"
```
A2 — `npm --prefix renderer run -s test -- src/shell/App.test.tsx src/lib/lib.test.tsx`
```
=== [MB1] isLive true for every mode except unavailable   liveStatus.ts :: > return s.status === 'ready' && s.data.mode !== 'unavailable';
    exit=1  × live status: unreachable backend is not live; only mode=live is live     × A2 global mode…
=== [MB2] unreachable backend shows LIVE                   ModeIndicator.tsx :: > pills: [{ status: 'live', text: 'LIVE · GPU 0 / GPU 1' }],
    exit=1  × A2 global mode…     Tests  1 failed | 6 passed (7)
=== [MB3] launching shows LIVE                             ModeIndicator.tsx :: > pills: [{ status: 'live', text: 'LIVE · GPU 0 / GPU 1' }]
    exit=1  × A2 global mode…
=== [MB4] payload validation removed from fetchLiveStatus  liveStatus.ts :: > (deleted)
    exit=1  × live status: unreachable backend is not live; only mode=live is live
=== [MB5] header indicator not driven by /api/live/status  App.tsx :: > <ModeIndicator state={{ status: 'connecting' }} />
    exit=1  × A2 global mode…
=== [MB6] connecting shows LIVE                            ModeIndicator.tsx :: > …pills: [{ status: 'live', … }], detail: 'Checking for a live backend…' };
    exit=1  × A2 global mode…
=== [MB7] poll errors ignored (never 'unreachable')        liveStatus.ts :: > () => undefined,
    exit=1  × live status…     × A2 global mode…
=== [MB8] LIVE is sticky: a failed poll after a live one keeps the last status
    liveStatus.ts :: > (err: unknown) => alive && setState((prev) => (prev.status === 'ready' ? prev : { status: 'unreachable', … })),
    exit=0  GREEN — MUTATION SURVIVED     Tests  7 passed (7)
=== [MB9] fetchLiveStatus accepts non-2xx responses (HTTP 500 with a live body => LIVE)   liveStatus.ts :: > (the `if (!res.ok) throw` line deleted)
    exit=0  GREEN — MUTATION SURVIVED     Tests  7 passed (7)
=== [MB10] terminated shows LIVE                           ModeIndicator.tsx :: > if (state.status === 'ready' && ['live', 'terminated'].includes(state.data.mode)) {
    exit=1  × A2 global mode…
=== [MB11] backoff never retries after the first failure   liveFetch.ts :: > nextAttempt = Infinity;
    exit=0  GREEN — MUTATION SURVIVED     Tests  7 passed (7)
=== [MB12] status polled from the wrong URL                liveStatus.ts :: > fetchImpl('/api/live/state', {
    exit=1  × A2 global mode…
=== [MB13] fallback shows only a Replay pill               ModeIndicator.tsx :: > (the 'Worker failed' pill deleted)
    exit=1  × A2 global mode…
=== [MB14] idle shows 'Launching…'                         ModeIndicator.tsx :: > if (mode === 'launching' || mode === 'idle') {
    exit=1  × A2 global mode…
```
A3 — `npm --prefix renderer run -s test -- src/shell/ArtifactGate.test.tsx src/lib/lib.test.tsx` (MC10, MC11 also with `src/shell/App.test.tsx`)
```
=== [MC1] fetchArtifact ignores HTTP status          artifacts.ts :: > (deleted)
    exit=1  × A3 artifact loading/error/data states…   × fetchArtifact rejects wrong schemaVersion and HTTP errors with the file name
=== [MC2] schemaVersion check removed                artifacts.ts :: > (deleted)
    exit=1  × A3…   × fetchArtifact rejects wrong schemaVersion and HTTP errors with the file name
=== [MC3] error state does not name the file         artifacts.ts :: > file: 'the artifact',
    exit=1  × A3…   × useArtifact goes loading -> error naming the file (never blank)
=== [MC4] error state renders nothing (blank)        ArtifactGate.tsx :: > if (state.status === 'error') return null;
    exit=1  × A3  TestingLibraryElementError: Unable to find role="heading" and name "Could not load artifacts/spatial.json"
=== [MC5] loading state renders nothing (blank)      ArtifactGate.tsx :: > return null;
    exit=1  × A3  TestingLibraryElementError: Unable to find an accessible element with the role "status"
=== [MC6] error boundary renders nothing after a throw   ArtifactGate.tsx :: > return null;
    exit=1  × A3  TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "Could not load artifacts/geometry.json"
=== [MC7] structural validate() ignored              ArtifactGate.tsx :: > const problem = null;
    exit=1  × A3  TestingLibraryElementError: Unable to find an element with the text: artifacts/spatial.json: x missing.
=== [MC8] panel title does not name the file         ArtifactGate.tsx :: > title="Could not load this view"
    exit=1  × A3  TestingLibraryElementError: Unable to find role="heading" and name "Could not load artifacts/spatial.json"
=== [MC9] useArtifact swallows the rejection         artifacts.ts :: > () => undefined,
    exit=1  × useArtifact goes loading -> error naming the file (never blank)   × A3…
=== [MC10] App no longer wraps the view in ViewErrorBoundary   App.tsx :: > <View />
    exit=0  GREEN — MUTATION SURVIVED     Tests  8 passed (8)
=== [MC11] boundary not reset on route change (key removed)    App.tsx :: > <ViewErrorBoundary view
    exit=0  GREEN — MUTATION SURVIVED     Tests  8 passed (8)
=== [MC12] callout title does not name the file      ArtifactGate.tsx :: > title="The file is missing or invalid"
    exit=1  × A3  Error: expect(element).toHaveTextContent()
=== [MC13] error message dropped from the panel      ArtifactGate.tsx :: > <p className="lab-mono shell-error__message" />
    exit=1  × A3  TestingLibraryElementError: Unable to find an element with the text: /HTTP 404/.
```
A4 — `npm --prefix renderer run -s test -- src/shell/App.test.tsx -t A4`
```
=== [MD1] decision question altered (hyphen dropped)  App.tsx :: > 'Is this W7-X heat flux estimate accurate enough to justify a longer simulation?'
    exit=1  × A4  Error: expect(element).toHaveTextContent()
=== [MD2] legend removed from the shell               App.tsx :: > (deleted)
    exit=1  × A4  TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Provenance legend"
=== [MD3] 'blocked' missing from the legend           ProvenanceLegend.tsx :: > kinds: ['passed', 'unverified', 'mismatch', 'failed']
    exit=1  × A4  TestingLibraryElementError: Unable to find an element with the text: Blocked, which matches selector '.lab-pill__text'.
=== [MD4] question not a level-1 heading              App.tsx :: > <p className="shell-header__question">{DECISION_QUESTION}</p>
    exit=1  × A4  TestingLibraryElementError: Unable to find an accessible element with the role "heading"
=== [MD5] legend draws a LIVE pill                    ProvenanceLegend.tsx :: > kinds: ['live', 'replay', 'archive', 'derived', 'prd-reported', 'rehearsal']
    exit=1  × A4  AssertionError: expected <span …(3)>…(2)</span> to be null
=== [MD6] legend descriptions dropped (pills only)    ProvenanceLegend.tsx :: > <dd />
    exit=1  × A4  TestingLibraryElementError: Unable to find an element with the text: Stated in PRD.md; no underlying data in this repo..
=== [MD7] 'prd-reported' missing from the legend      ProvenanceLegend.tsx :: > kinds: ['replay', 'archive', 'derived', 'rehearsal']
    exit=1  × A4  TestingLibraryElementError: Unable to find an element with the text: PRD-reported, which matches selector '.lab-pill__text'.
=== [MD8] header shows another sentence than the constant   App.tsx :: > <h1 className="shell-header__question">Is this estimate good enough?</h1>
    exit=1  × A4  Error: expect(element).toHaveTextContent()
```
A5 — `npm --prefix renderer run -s test -- src/shell/build.test.ts`
```
=== [ME1] copy plugin not registered in the config    vite.config.ts :: > plugins: [react(), serveArtifacts()],
    exit=1  × A5  AssertionError: expected undefined to be defined
=== [ME2] copies into dist/artifact (wrong directory) vite.config.ts :: > cpSync(source, resolve(outDir, 'artifact'), { recursive: true });
    exit=1  × A5  Error: ENOENT: no such file or directory, scandir '/tmp/lab-build-xM5udn/dist/artifacts'
=== [ME3] copy plugin applies to 'serve' only         vite.config.ts :: > apply: 'serve',
    exit=1  × A5  AssertionError: expected 'serve' to be 'build' // Object.is equality
=== [ME4] manifest.json not copied                    vite.config.ts :: > …{ recursive: true, filter: (s) => !s.endsWith('manifest.json') });
    exit=1  × A5  AssertionError: expected [ Array(5) ] to deeply equal [ Array(6) ]
=== [ME5] missing source silently skipped             vite.config.ts :: > if (!existsSync(source)) return;
    exit=1  × A5  AssertionError: expected [Function] to throw an error
=== [ME6] configured outDir ignored                   vite.config.ts :: > (deleted)
    exit=1  × A5  Error: ENOENT: no such file or directory, scandir '/tmp/lab-build-KBcHyu/dist/artifacts'
```
Totals: A1 10/10 red, A2 11/14, A3 11/13, A4 8/8, A5 6/6. Survivors: MB8, MB9, MB11, MC10, MC11.

### 4. A1 probes
jsdom (`probe_a1.test.tsx` in the copy, real `App`, views replaced by markers):
```
PROBE|A1-TAB|
1. a"Skip to content"
2. radio"Follow system theme" [aria-checked=true]
3. a"Locate the tubesreplay" [aria-current=page]
4. a"Advance plasmaGX run · gated"
5. a"Check transportreplay"
6. a"Forecast replayreplay"
7. a"Spatial parallelismreplay"
8. a"Budgetreplay"
9. body
PROBE|A1-HIST|history.length 1 -> 3 after two link activations
PROBE|A1-HIST|back, back, forward, forward: views followed the hash
 ✓ src/__probe__/probe_a1.test.tsx (22 tests) 623ms
 Test Files  1 passed (1)
      Tests  22 passed (22)
exit=0
```
The 22 tests include: the skip link moves focus to `<main>` without changing the hash; each of `#/Spatial`,
`#/spatial/x`, `#spatial`, `#/`, `#`, `#/__proto__`, `#/constructor`, `#/hasOwnProperty`, `#/spatial?x=1`,
`#//spatial`, `#/%73patial`, `#/nope`, `#/spatial#/budget`, `#/ spatial` falls back to `#/locate` with exactly
one `aria-current` and no extra history entry; `#/spatial`, `#/budget`, `#/advance`, `#/spatial/` open
directly; after an unknown hash, Back returns to the previous view. The nav is a list of links, not a
tablist, so arrow keys do not apply; Tab and Enter are the keyboard model.

Real browser (headless Edge, real key events through `Input.dispatchKeyEvent`, `cdp_a1.ps1`):
```
1. load http://127.0.0.1:4173/ (no hash)            -> {"hash":"#/locate","title":"Locate the tubes · Labyrinth","historyLength":2,"current":["#/locate=page"],"mainName":"Locate the tubes","firstHeading":"Field lines on the ρ = 0.8 flux surface","mode":"Replay · $0"}
2. Tab key, one press at a time (real key events):
   Tab 1 -> {"el":"a","name":"Skip to content","href":"#main","ariaCurrent":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset 2px","box":"12,12 126x36"}
   Tab 2 -> {"el":"button[role=radio]","name":"Follow system theme","href":null,"ariaCurrent":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset 1px","box":"1225,91 50x24"}
   Tab 3 -> {"el":"a","name":"Locate the tubesreplay","href":"#/locate","ariaCurrent":"page","focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset -2px","box":"24,157 132x54"}
   Tab 4 -> {"el":"a","name":"Advance plasmaGX run · gated","href":"#/advance","ariaCurrent":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset -2px","box":"160,157 125x54"}
   Tab 5 -> {"el":"a","name":"Check transportreplay","href":"#/transport","ariaCurrent":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset -2px","box":"290,157 123x54"}
   Tab 6 -> {"el":"a","name":"Forecast replayreplay","href":"#/forecast","ariaCurrent":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset -2px","box":"417,157 118x54"}
   Tab 7 -> {"el":"a","name":"Spatial parallelismreplay","href":"#/spatial","ariaCurrent":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset -2px","box":"539,157 136x54"}
   Tab 8 -> {"el":"a","name":"Budgetreplay","href":"#/budget","ariaCurrent":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset -2px","box":"679,157 69x54"}
   Tab 9 -> {"el":"button","name":"Provenance of field-line geometry:","href":null,"ariaCurrent":null,"focusVisible":true,"outline":"solid 2px rgb(11, 127, 128) offset 2px","box":"418,345 180x26"}
3. Shift+Tab x2 (back to 'Spatial parallelism'), then Enter:
   after Enter -> {"hash":"#/spatial","title":"Spatial parallelism · Labyrinth","historyLength":3,"current":["#/spatial=page"],"mainName":"Spatial parallelism","firstHeading":"GENE-X on Dommaschk geometry — not W7-X","mode":"Replay · $0"}
4. Tab to 'Budget', Enter:
   -> {"hash":"#/budget","title":"Budget · Labyrinth","historyLength":4,"current":["#/budget=page"],"mainName":"Budget","firstHeading":"Modal spend against the $40.00 ceiling","mode":"Replay · $0"}
5. history.back() / forward():
   back    -> {"hash":"#/spatial","title":"Spatial parallelism · Labyrinth","historyLength":4,"current":["#/spatial=page"],…}
   back    -> {"hash":"#/locate","title":"Locate the tubes · Labyrinth","historyLength":4,"current":["#/locate=page"],…}
   forward -> {"hash":"#/spatial","title":"Spatial parallelism · Labyrinth","historyLength":4,"current":["#/spatial=page"],…}
   forward -> {"hash":"#/budget","title":"Budget · Labyrinth","historyLength":4,"current":["#/budget=page"],…}
6. unknown hash typed into the address (location.hash = '#/nope'):
   -> {"hash":"#/locate","title":"Locate the tubes · Labyrinth","historyLength":5,"current":["#/locate=page"],…}
   back -> {"hash":"#/budget","title":"Budget · Labyrinth","historyLength":5,"current":["#/budget=page"],…}
7. deep link http://127.0.0.1:4173/#/forecast (fresh navigation):
   -> {"hash":"#/forecast","title":"Forecast replay · Labyrinth",…,"current":["#/forecast=page"],"mainName":"Forecast replay",…}
8. deep link with an unknown hash http://127.0.0.1:4173/#/Budget (wrong case):
   -> {"hash":"#/locate","title":"Locate the tubes · Labyrinth",…,"current":["#/locate=page"],…}
9. focus ring colour token and nav overflow at 390 px:
   --lab-color-focus = #0b7f80
   390x844: {"navScrollWidth":732,"navClientWidth":390,"pageScrollWidth":390,"links":6}
```
The screenshot taken at Tab 7 shows a teal ring around "Spatial parallelism". At 390 px the nav scrolls
sideways inside its own box and the page does not overflow.

Edge case (`cdp_gallery.ps1`): the design gallery and the Back button.
```
1. http://127.0.0.1:4173/#/spatial                  -> {"hash":"#/spatial","title":"Spatial parallelism · Labyrinth","appShell":true,…,"navCurrent":["#/spatial"]}
2. location.hash = '#gallery'        -> {"hash":"#gallery","title":"Labyrinth","appShell":false,…,"navCurrent":[]}
3. history.back()                    -> {"hash":"#/spatial","title":"Labyrinth","appShell":false,…,"navCurrent":[]}
4. location.hash = '#/budget'        -> {"hash":"#/budget","title":"Labyrinth","appShell":false,…,"navCurrent":[]}
```
After a visit to `#gallery` the gallery stays on screen under `#/spatial` and `#/budget` (finding 9).

### 5. A2 probes
App-level matrix (`probe_a2.test.tsx`, real `App` with a stubbed `fetch`, one line per `/api/live/status` answer):
```
PROBE|A2|mode unavailable|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=reason-unavailable
PROBE|A2|mode idle|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=reason-idle
PROBE|A2|mode launching|pills=["rehearsal:Launching…"]|live=false|view=true|nav=6|crash=null|detail=reason-launching
PROBE|A2|mode live|pills=["live:LIVE · GPU 0 / GPU 1"]|live=true|view=true|nav=6|crash=null|detail=reason-live
PROBE|A2|mode fallback|pills=["failed:Worker failed","replay:Playing saved run"]|live=false|view=true|nav=6|crash=null|detail=reason-fallback
PROBE|A2|mode terminated|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=reason-terminated
PROBE|A2|unreachable (fetch rejects)|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|HTTP 500 with a live body|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|HTTP 404|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|HTML 200 (static host fallback)|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|truncated JSON|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|empty body 200|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|JSON null|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|JSON array|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|JSON string "live"|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|no schemaVersion, mode live|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|schemaVersion 2, mode live|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|schemaVersion "1" (string), mode live|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|mode "LIVE" (wrong case)|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=reason-LIVE
PROBE|A2|mode "live " (trailing space)|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=reason-live 
PROBE|A2|mode ["live"] (array)|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|mode missing|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=No live backend reachable: every view plays saved evidence.
PROBE|A2|mode "bogus"|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=reason-bogus
PROBE|A2|PARTIAL {schemaVersion:1, mode:"live"} only|pills=["live:LIVE · GPU 0 / GPU 1"]|live=true|view=true|nav=6|crash=null|detail=GX workers are reporting.
PROBE|A2|PARTIAL {schemaVersion:1, mode:"fallback"} only|pills=[]|live=false|view=false|nav=0|crash=SHELL CRASHED: Cannot read properties of undefined (reading 'label')|detail=
PROBE|A2|PARTIAL {schemaVersion:1, mode:"launching"} only|pills=["rehearsal:Launching…"]|live=false|view=true|nav=6|crash=null|detail=Not live until workers report.
PROBE|A2|PARTIAL {schemaVersion:1, mode:"idle"} only|pills=["replay:Replay · $0"]|live=false|view=true|nav=6|crash=null|detail=Live backend mode: idle.
PROBE|A2|PARTIAL fallback, reason "" and no fallback object|pills=[]|live=false|view=false|nav=0|crash=SHELL CRASHED: Cannot read properties of undefined (reading 'label')|detail=
PROBE|A2-DROP|after backend vanished: Replay · $0No live backend reachable: every view plays saved evidence.
PROBE|A2-DROP2|Replay · $0No live backend reachable: every view plays saved evidence.
PROBE|A2-DROP2|Replay · $0reason-terminated
PROBE|A2-STALE|before=Replay · $0reason-terminated|after stale answer=LIVE · GPU 0 / GPU 1reason-live|LIVE shown from a stale response=true
```
("SHELL CRASHED" is printed by an error boundary that my probe puts around `<App />`; the app itself has
none above the header.) The three DROP lines are `live` followed by a rejected fetch, by HTTP 500 and by
`terminated`: LIVE drops each time. The STALE line is a slow first answer (`live`) that lands after a newer
answer (`terminated`).

Termination reasons (`probe_a2.test.tsx` shell only, then `probe_term.test.tsx` with the real views and real artifacts):
```
PROBE|A2-TERM|mode=live|reason=TERMINATE FAILED — |pills=["live:LIVE · GPU 0 / GPU 1"]|alerts=0|dangerPills=0|detail=TERMINATE FAILED — check Modal dashboard|…
PROBE|A2-TERM|mode=live|reason=TERMINATION PENDING|pills=["live:LIVE · GPU 0 / GPU 1"]|alerts=0|dangerPills=0|detail=TERMINATION PENDING — cancel queued, not|…
PROBE|A2-TERM|mode=fallback|reason=TERMINATE FAILED — |pills=["failed:Worker failed","replay:Playing saved run"]|alerts=0|dangerPills=1|detail=TERMINATE FAILED — check Modal dashboard|…
PROBE|A2-TERM|mode=fallback|reason=TERMINATION PENDING|pills=["failed:Worker failed","replay:Playing saved run"]|alerts=0|dangerPills=1|detail=TERMINATION PENDING — cancel queued, not|…
PROBE|A2-TERM|mode=terminated|reason=TERMINATE FAILED — |pills=["replay:Replay · $0"]|alerts=0|dangerPills=0|detail=TERMINATE FAILED — check Modal dashboard|…
PROBE|A2-TERM|mode=terminated|reason=TERMINATION PENDING|pills=["replay:Replay · $0"]|alerts=0|dangerPills=0|detail=TERMINATION PENDING — cancel queued, not|…

PROBE|TERM|
mode=live | TERMINATE FAILED —  | #/advance | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 1 ["TERMINATE FAILED — GPUs may still be billingTERMINATE FAILED — check M"] | reason text on page true
mode=live | TERMINATE FAILED —  | #/spatial | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=live | TERMINATE FAILED —  | #/budget | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=live | TERMINATE FAILED —  | #/transport | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=live | TERMINATE FAILED —  | #/forecast | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=live | TERMINATION PENDING | #/advance | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=live | TERMINATION PENDING | #/spatial | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=live | TERMINATION PENDING | #/budget | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=live | TERMINATION PENDING | #/transport | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=live | TERMINATION PENDING | #/forecast | header pills ["live:LIVE · GPU 0 / GPU 1"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=fallback | TERMINATE FAILED —  | #/advance | header pills ["failed:Worker failed","replay:Playing saved run"] | header alerts 0 | alerts on page 1 ["TERMINATE FAILED — GPUs may still be billingTERMINATE FAILED — check M"] | reason text on page true
mode=fallback | TERMINATE FAILED —  | #/spatial | header pills ["failed:Worker failed","replay:Playing saved run"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=fallback | TERMINATION PENDING | #/advance | header pills ["failed:Worker failed","replay:Playing saved run"] | header alerts 0 | alerts on page 0 | reason text on page true
mode=fallback | TERMINATION PENDING | #/spatial | header pills ["failed:Worker failed","replay:Playing saved run"] | header alerts 0 | alerts on page 0 | reason text on page true
```
The A2-TERM lines are cut after the detail field. The fallback rows for `#/budget`, `#/transport` and
`#/forecast` equal the `#/spatial` rows and are left out. In fallback mode the red "Worker failed" pill is
the normal fallback pill; it is there with any reason. The `terminated` rows show what the header would do
if the backend ever paired that mode with such a reason; interface.md §3 names `live` and `fallback`.

Real browser, scripted `/api/live/status` (`fake_api_server.py`, headless Edge, `--dump-dom` and screenshots):
```
127.0.0.1:45091  live + TERMINATE FAILED
127.0.0.1:45092  live + TERMINATION PENDING
127.0.0.1:45093  partial body {schemaVersion:1, mode:fallback}
127.0.0.1:45094  no API; artifacts/spatial.json answered with index.html (HTTP 200)
127.0.0.1:45095  healthy live
ready

$ cat shots/partial_fallback.html          (http://127.0.0.1:45093/#/spatial, 521 bytes)
<!DOCTYPE html>
<html lang="en"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Spatial parallelism · Labyrinth</title>
    <script type="module" crossorigin="" src="/assets/index-D6civ2KJ.js"></script>
    <link rel="modulepreload" crossorigin="" href="/assets/rolldown-runtime-WkwZ5CU-.js">
    <link rel="stylesheet" crossorigin="" href="/assets/index-2hdb9thG.css">
  </head>
  <body>
    <div id="root"></div>
</body></html>
```
Searching the other DOM dumps: `role="alert"` occurs once in `term_failed_advance.html` and not at all in
`term_failed_spatial.html`, `term_pending_advance.html` and `term_pending_budget.html`.
`partial_fallback.png` is an empty white page (6,491 bytes). `html200_spatial.html` holds "Could not load
artifacts/spatial.json", "is missing or invalid" and the message `Unexpected token '<', "<!doctype "... is
not valid JSON`.

In the `45091/#/spatial` screenshot the header shows the ordinary crimson "LIVE · GPU 0 / GPU 1" pill and,
under it, in small grey text, "TERMINATE FAILED — check Modal dashboard; GPUs may still be billing". Nothing
else on the page mentions it. In the `45092/#/advance` screenshot the view shows "LIVE — GX running on two
GPUs" with the pending text as body copy, an ordinary "Terminate" button and no alert.

Unit matrix for `fetchLiveStatus` + `isLive` (same answers, no React):
```
HTTP 500 with a live body => rejected: /api/live/status: HTTP 500
HTML 200 (static host fallback) => rejected: Unexpected token '<', "<!doctype "... is not valid JSON
truncated JSON => rejected: Unterminated string in JSON at position 38 (line 1 column 39)
JSON null => rejected: /api/live/status: bad payload
schemaVersion "1" (string), mode live => rejected: /api/live/status: bad payload
mode "LIVE" (wrong case) => resolved mode="LIVE" isLive=false
mode "bogus" => resolved mode="bogus" isLive=false
PARTIAL {schemaVersion:1, mode:"live"} only => resolved mode="live" isLive=true
PARTIAL {schemaVersion:1, mode:"fallback"} only => resolved mode="fallback" isLive=false
```

### 6. A3 probe
The real app, no view mocks, API unreachable, each `/artifacts/*.json` answered with a broken response
(`probe_a3.test.tsx`; 6 routes × 11 bodies; rows for `#/spatial` and the one deviating row shown):
```
{"route":"spatial","body":"HTTP 404","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"HTTP 500","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"invalid JSON (truncated)","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"schemaVersion 2","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"schemaVersion \"1\" (string)","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"HTML body, status 200","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"schemaVersion 1 but empty shape","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"network error","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"JSON null","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"JSON array","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"spatial","body":"empty body, status 200","crashed":null,"blank":false,"stillLoading":false,"namesFile":true,"headings":["Could not load artifacts/spatial.json"],"nav":6,"mode":"Replay · $0","unhandled":0}
{"route":"advance","body":"schemaVersion 1 but empty shape","crashed":null,"blank":false,"stillLoading":false,"namesFile":false,"headings":["Could not load /api/live/status"],"nav":6,"mode":"Replay · $0","unhandled":0}

AssertionError: advance / schemaVersion 1 but empty shape: names artifacts/transport.json (headings: Could not load /api/live/status): expected false to be true
```
Over all 66 rows: `crashed` null 66, `blank` false 66, `stillLoading` false 66, `nav` 6 and mode "Replay · $0"
66, `unhandled` 0 in 66, `namesFile` true 65. Headings by route: `#/locate` and `#/spatial` "Could not load
artifacts/<id>.json" (the shared `ArtifactGate`); `#/transport`, `#/forecast`, `#/budget` their own panel
("Transport evidence could not be loaded" and so on) with the callout "artifacts/<id>.json failed to load",
and "Could not load artifacts/<id>.json" from the shell's error boundary when the shape is wrong; `#/advance`
keeps its live panel and names `artifacts/transport.json` in its replay panel.

`fetchArtifact` messages for the same bodies:
```
HTTP 404 => Error: /artifacts/spatial.json: HTTP 404
invalid JSON (truncated) => SyntaxError: Unexpected end of JSON input
schemaVersion 2 => Error: /artifacts/spatial.json: unexpected schemaVersion (expected 1)
HTML body, status 200 => SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON
schemaVersion 1 but empty shape => RESOLVED (no error)
network error => TypeError: Failed to fetch
JSON null => Error: /artifacts/spatial.json: unexpected schemaVersion (expected 1)
```
(The loader checks only `schemaVersion`; a wrong shape is caught by the view's `validate` or by the error boundary.)

### 7. A4 probe
```
$ python3 -I <scratch>/a4_legend_check.py /mnt/d/Labyrinth
contract provenance.kind enum       : ['archive', 'derived', 'prd-reported', 'live', 'rehearsal']
contract verification.outcome enum  : ['passed', 'failed', 'blocked', 'not-applicable']
legend pills (ProvenanceLegend.tsx) : ['replay', 'archive', 'derived', 'prd-reported', 'rehearsal', 'passed', 'unverified', 'blocked', 'mismatch', 'failed']
kinds without a legend pill         : ['live']
outcomes without a legend pill      : ['not-applicable']
legend prose mentions LIVE          : True | mentions 'not applicable': False
budget.json     provenance kinds {'derived': 2, 'prd-reported': 2} | outcomes {'passed': 2, 'not-applicable': 2}
forecast.json   provenance kinds {'derived': 1} | outcomes {'failed': 1}
geometry.json   provenance kinds {'derived': 1} | outcomes {'blocked': 1}
spatial.json    provenance kinds {'prd-reported': 1} | outcomes {'blocked': 1}
transport.json  provenance kinds {'prd-reported': 1, 'archive': 2} | outcomes {'blocked': 1, 'passed': 2}
TASK.md question : 'Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?'
App.tsx constant : 'Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?' | identical: True | appears verbatim in PRD.md: False
served bundle /assets/index-D6civ2KJ.js contains the question verbatim: True
```
PRD.md:3 words the purpose as a sentence ("…needs to judge whether a Wendelstein 7-X heat-flux estimate is
accurate enough to justify a longer simulation"); the question form is TASK.md's, and the header matches
TASK.md character for character. The rendered `#/budget` page holds three pills with
`data-status="not-applicable"` (DOM dump below) and the legend on the same page has no such entry.

### 8. A5 probe
```
$ bash <scratch>/a5_check.sh
### 1. probe copy: output of the gate's 'npm --prefix renderer run -s build' (verify.sh all, stage renderer:build)
a480133edeb546fa29e5a64abed70912a0b13a0458ef623eef46d323fc24c088  budget.json
75c7039534843200ec579dff86658f93a5030dfa5d9a58633bcef61001e51961  forecast.json
3cd6a3d5cdb797edef8be1259b72a1047d8224d3ded3489bec4b90672b819d9c  geometry.json
00ac739f291ed90039adaa31286265f91787e9b2b8d5da8972014635c2697ccb  manifest.json
af255d380559803d1efacb81431f081277c826ec41066bca4bf55448fe17ea06  spatial.json
ae594c701e542a5a9040c70b324b2a7ee9db29668e10f40764514038fa58a8fc  transport.json
sha256 lists identical: YES (6 files)
### 2. shared tree: renderer/dist (what vite preview serves on :4173)
sha256 lists identical: YES (6 files)
### 3. served over HTTP from http://127.0.0.1:4173 (no API behind it)
GET /artifacts/budget.json -> 200 application/json  sha256 a480133edeb546fa29e5a64abed70912a0b13a0458ef623eef46d323fc24c088  identical
GET /artifacts/forecast.json -> 200 application/json  sha256 75c7039534843200ec579dff86658f93a5030dfa5d9a58633bcef61001e51961  identical
GET /artifacts/geometry.json -> 200 application/json  sha256 3cd6a3d5cdb797edef8be1259b72a1047d8224d3ded3489bec4b90672b819d9c  identical
GET /artifacts/manifest.json -> 200 application/json  sha256 00ac739f291ed90039adaa31286265f91787e9b2b8d5da8972014635c2697ccb  identical
GET /artifacts/spatial.json -> 200 application/json  sha256 af255d380559803d1efacb81431f081277c826ec41066bca4bf55448fe17ea06  identical
GET /artifacts/transport.json -> 200 application/json  sha256 ae594c701e542a5a9040c70b324b2a7ee9db29668e10f40764514038fa58a8fc  identical
all served artifacts byte-identical to artifacts/: YES
### 5. what the static host answers for things that do not exist
GET /api/live/status -> 502 text/plain 0 bytes; first bytes: 
GET /artifacts/nope.json -> 200 text/html 481 bytes; first bytes: <!doctype html> <html lang="en">   <head
does the JS bundle reference the API host or main/?
0

$ bash <scratch>/a5_build_mutation.sh        (a real build in the copy, with and without the plugin)
### fresh build, unmutated
✓ built in 2.45s
build exit=0
dist/artifacts: budget.json forecast.json geometry.json manifest.json spatial.json transport.json 
byte-identical to artifacts/*.json: YES
### mutation: copyArtifacts() removed from the plugin list, then a real build
✓ built in 2.76s
build exit=0
dist: assets index.html 
dist/artifacts exists: NO — a static host would answer /artifacts/*.json with index.html
### restored; rebuild
build exit=0
byte-identical to artifacts/*.json: YES
vite.config.ts restored
```
Six routes of the static build in headless Edge (`--screenshot` at 1440×2400 and `--dump-dom`, summarised by `dom_check.py`):
```
#/locate: title='Locate the tubes · Labyrinth' aria-current=['#/locate'] mode='Replay · $0 | No live backend reachable: every view plays saved evidence.'
   main text 4585 chars; … canvas=1 svg-in-main=26 plotly-plots=1 error-panel-phrases=[] LIVE-pill=False
#/advance: title='Advance plasma · Labyrinth' aria-current=['#/advance'] mode='Replay · $0 | No live backend reachable: every view plays saved evidence.'
   main text 1188 chars; … canvas=0 svg-in-main=14 plotly-plots=1 error-panel-phrases=[] LIVE-pill=False
#/transport: title='Check transport · Labyrinth' aria-current=['#/transport'] mode='Replay · $0 | No live backend reachable: every view plays saved evidence.'
   main text 13047 chars; … canvas=0 svg-in-main=52 plotly-plots=1 error-panel-phrases=[] LIVE-pill=False
#/forecast: title='Forecast replay · Labyrinth' aria-current=['#/forecast'] mode='Replay · $0 | No live backend reachable: every view plays saved evidence.'
   main text 5592 chars; … canvas=0 svg-in-main=11 plotly-plots=0 error-panel-phrases=[] LIVE-pill=False
#/spatial: title='Spatial parallelism · Labyrinth' aria-current=['#/spatial'] mode='Replay · $0 | No live backend reachable: every view plays saved evidence.'
   main text 2844 chars; … canvas=0 svg-in-main=21 plotly-plots=0 error-panel-phrases=[] LIVE-pill=False
#/budget: title='Budget · Labyrinth' aria-current=['#/budget'] mode='Replay · $0 | No live backend reachable: every view plays saved evidence.'
   main text 6927 chars; …
   pills by status: {'archive': 1, 'blocked': 1, 'derived': 9, 'failed': 1, 'mismatch': 1, 'not-applicable': 3, 'passed': 3, 'prd-reported': 6, 'rehearsal': 1, 'replay': 3, 'unverified': 1}
   canvas=0 svg-in-main=46 plotly-plots=0 error-panel-phrases=[] LIVE-pill=False
```
I read the `#/spatial` and `#/advance` screenshots by eye: header question, "Replay · $0", six nav links with
the current one underlined, the view, and the legend at the bottom. The other four were checked through
their DOM dumps (non-empty `<main>`, the view's headings present, no error-panel phrase).

## Findings, ranked

### Blocker
1. **A failed or pending termination is not shown as danger by the global indicator, and a pending one is
   not shown as danger anywhere.** `renderer/src/shell/ModeIndicator.tsx:20-22` returns the ordinary LIVE pill
   for `mode === "live"` and puts `reason` into the small detail line (`shell.css:34`, subtle text, 36 ch);
   the component is `role="status"` (`ModeIndicator.tsx:51`), never an alert. With
   `reason: "TERMINATE FAILED — …GPUs may still be billing"` the header is a normal LIVE badge on every
   route (in fallback mode: the usual two fallback pills), and five of the six routes show nothing else.
   interface.md §3 asks for
   "a loud danger alert, not just a badge" in exactly this case. Only `#/advance` raises an alert, and only for
   the `TERMINATE FAILED` prefix (`renderer/src/features/live-gx/model.ts:87-90`, `LiveView.tsx:173`):
   `TERMINATION PENDING` gets no alert on any route and the button stays "Terminate". No shell test mentions
   either reason. Fix: one shared `terminationProblem(state)` in `lib/liveStatus.ts` that matches both
   prefixes for any mode; `ModeIndicator` renders a `failed` pill plus a `role="alert"` line when it is set;
   LiveView uses the same helper; add the six mode × reason cases to the A2 test.

### Major
2. **A partial status body blanks the whole app.** `lib/liveStatus.ts:39` accepts any object with
   `schemaVersion: 1` and a string `mode`. `ModeIndicator.tsx:39` then reads `state.data.fallback.label`; for
   `{"schemaVersion":1,"mode":"fallback"}` (or an empty `reason` and no `fallback`) this throws in the header,
   which sits outside `ViewErrorBoundary` (`App.tsx:65` vs `App.tsx:82`), and `main.tsx:10-20` has no boundary
   above the app: the page becomes an empty `<div id="root">` (real-browser dump above). The static replay
   itself is not affected; this needs a backend that breaks its own contract. Fix: validate `reason`
   (string), `budget`, `workers` (array) and `fallback` (object) in `fetchLiveStatus` and reject as
   "bad payload"; use optional chaining at `ModeIndicator.tsx:39`; put an error boundary around the header or
   the whole app.
3. **The legend omits the `not-applicable` outcome (A4).** `renderer/src/shell/ProvenanceLegend.tsx:4-7` lists
   ten states; `contracts/common.schema.json` defines the verification outcome `not-applicable`,
   `artifacts/budget.json` uses it twice and `#/budget` draws three "Not applicable" pills that the legend
   does not explain. Kind `live` is deliberately described in words instead of drawn
   (`ProvenanceLegend.tsx:16-20`), which is fine. The test hard-codes the ten labels
   (`App.test.tsx:136`) and so cannot notice. Fix: add `'not-applicable'` to the second group and make the
   test read the two enums from `contracts/common.schema.json`.
4. **Weak test for the LIVE rule (A2).** Two mutations that would show LIVE wrongly stay green: keeping the
   last `ready` status when a later poll fails (MB8, `liveStatus.ts:50`) and accepting a non-2xx response that
   carries a live body (MB9, `liveStatus.ts:37`). The shipped code handles both (probe lines A2-DROP, "HTTP 500
   with a live body"). Fix: in `App.test.tsx` A2, answer `live` once and then reject, and assert the pill
   returns to "Replay · $0"; in `lib.test.tsx`, `fetchLiveStatus` with status 500 and a valid live body must reject.

### Minor
5. A slow answer can overwrite a newer one: `useLiveStatus` (`liveStatus.ts:47-51`) applies responses in
   arrival order, so a late `live` answer puts LIVE back after `terminated` until the next poll (probe
   A2-STALE; at most one poll interval, 2 s). Fix: a request counter, ignore answers older than the latest applied.
6. Weak test (A3): removing `ViewErrorBoundary` from the app (MC10) or its `key={route}` (MC11) at
   `App.tsx:82` passes every test; the boundary is only tested on its own. Fix: in `App.test.tsx`, make one
   mocked view throw, expect the named panel, navigate away and expect the next view.
7. `#/advance` with a wrong-shaped but `schemaVersion: 1` transport artifact shows "Could not load
   /api/live/status" (`routes.ts:20` lists only the API for that route; `LiveView` reads
   `artifacts/transport.json` too). Fix: add `artifactFile('transport')` to that route's `files`.
8. `renderer/src/shell/liveFetch.ts` has no test (MB11 survives). Also, a static host that answers
   `/api/live/status` with `index.html` and status 200 resets the backoff (`liveFetch.ts:29-30`), so the header
   polls every 2 s for the life of the page. Fix: a unit test with an injected clock; count a JSON parse failure
   as a failure for the backoff.
9. After a visit to `#gallery`, Back (or any hash route) leaves the gallery on screen while the URL names a
   view, because `main.tsx:8` decides once at load and only the app listens for hash changes
   (`useHashRoute.ts:12-16`). Review-only page. Fix: a `hashchange` listener in `main.tsx` that reloads when
   the hash enters or leaves `#gallery`.
10. Indicator text is not taken from the data: "LIVE · GPU 0 / GPU 1" is fixed whatever `workers` holds, and an
    empty `reason` is replaced by "GX workers are reporting." (`ModeIndicator.tsx:21`). An unknown mode string
    shows "Replay · $0" (`ModeIndicator.tsx:45`). Fix: name the devices from `workers`; show "Unknown backend
    mode" instead of "$0" for a mode outside the contract.
11. Outside the shell, for the 06/02/04 verifiers: `LiveView.tsx:105`, `TransportView.tsx:45` and
    `BudgetView.tsx:37` each start their own `useLiveStatus` poll with the plain `fetch` (no backoff), so the
    header and a view can disagree for one poll interval, and `LiveView.tsx:125` decides LIVE with
    `data?.mode === 'live'` instead of `isLive`, which interface.md §3 calls the single source.
12. For the product owner: when the API disappears during a live session the header goes to "Replay · $0 —
    No live backend reachable" with no trace that the last known state was live. interface.md §3 specifies
    unreachable ⇒ REPLAY, so this is as designed; a "last seen live at …" note would be safer for money.

Could not check: the real `labyrinth_main.server` behind the app (another agent was editing `main/`, and
nothing live may be launched; every mode was driven with stubs and a scripted server); `npm run dev` and its
`/artifacts` middleware; browsers other than headless Edge; screen readers; the dark theme and phone layout
beyond the nav overflow measurement.

Verdict: FAIL — A2: a TERMINATE FAILED / TERMINATION PENDING reason is not shown as danger by the global mode indicator and a partial live-status body blanks the app; A4: the legend omits the not-applicable outcome

## Run 2 — whole task
Verifier run: 2026-11-20, commit 3faed3a
Scope kept short at the owner's request: the task's own tests, one independent probe per outcome and five
mutations in total (one per outcome). `wsl.exe -e git status --short` showed no change under the owned paths
`renderer/src/shell/` and `renderer/src/lib/` at the start and at the end (only `status.md` and other tasks'
VERIFY.md files were modified by other agents); `git diff --stat 3faed3a -- renderer/src/shell renderer/src/lib`
printed nothing. Gate evidence is the maintainer's `verify.sh all` at 3faed3a on this tree (quoted below, not
re-run: nine other verifiers share the machine). Mutations and probe tests ran only in
`scripts/probe-copy.sh vt-09-app-shell`, deleted at the end; the shared tree was never mutated.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| A1 | Navigation across the six views, keyboard accessible, URL hash reflects the view | `renderer/src/shell/App.test.tsx` › "A1 navigation reaches all six views by keyboard and the URL hash names the view" (real Tab and Enter through userEvent, aria-current, main landmark name, title, hashchange, unknown hash) and "A1 a route change is announced and moves focus…". Views are replaced by markers; the shell itself is not mocked | Probe test in the copy with the real views: parseHash on 15 hashes (only the six exact routes accepted), history back/back/forward gives #/spatial, #/transport, #/spatial with the matching main landmark. Built bundle contains all six routes. Mutation M1 (drop the hashchange listener) turns both A1 tests red | PASS |
| A2 | Global mode indicator: REPLAY ($0) vs LIVE, driven by `/api/live/status`; no backend means full replay | same file › "A2 global mode: REPLAY ($0) unless /api/live/status reports live…", 12 danger cases (6 modes × 2 markers, spread over the routes), 18 round-6 stop cases (3 states × 6 routes), "LIVE is not sticky", "idle backend that goes away", "a partial or malformed status body never blanks the page"; `renderer/src/lib/lib.test.tsx` A2 tests (bad payload, non-2xx with a live body, stale answer, hung backend) | Static build served from the copy on 127.0.0.1 with no API behind it: `/api/live/status` answers 404 while all six artifacts are served, and the bundle polls `/api/live/status`; the A2 test already drives the real App with a rejected fetch and asserts Replay · $0 with the view rendered. Mutation M2 (skip the contract check in `fetchLiveStatus`) turns 3 A2 tests red, including the partial-body App test that covers the earlier blank-page defect | PASS |
| A3 | Typed artifact loader with loading / error / data states; a missing or invalid artifact shows an error panel naming the file, never a blank screen | `renderer/src/shell/ArtifactGate.test.tsx` › "A3 artifact loading/error/data states…" (real `useArtifact` + `ArtifactGate`, injected fetch), `lib.test.tsx` three A3 tests, `App.test.tsx` › "A3 a view that throws shows the named error panel inside the shell, and navigating away recovers" | Probe test with the real App and real views (no view mocks), no backend: 6 routes × 5 broken artifact answers (HTTP 404, HTML with 200, schemaVersion 2, schemaVersion 1 with no fields, null) = 30 of 30 show a panel or callout naming the route's file, none blank, nav intact. Mutation M3 (accept any schemaVersion) turns 2 A3 tests red | PASS |
| A4 | Header states the user decision question and a global provenance legend | `App.test.tsx` › "A4 header states the user decision and a global provenance legend is shown" and "A4 the legend explains every provenance kind and verification outcome defined in contracts/common.schema.json" (reads both enums from the schema) | The question extracted from TASK.md is present verbatim in the built bundle. Mutation M4 (remove `not-applicable` from the legend, the earlier run's defect) turns the schema-driven A4 test red | PASS |
| A5 | Static build (`npm run build`) contains `dist/artifacts/*.json` so replay works with no backend | `renderer/src/shell/build.test.ts` › "A5 static build copies artifacts/*.json into <outDir>/artifacts…" (real config plugin, its hooks run against a temp dir, byte comparison, missing source throws) | A real `npm run build` in the copy: 6 of 6 `dist/artifacts/*.json` have the same sha256 as `artifacts/*.json`; served by a plain static server they come back identical with schemaVersion 1. Mutation M5 (copy skips spatial.json) turns the A5 test red | PASS |

### Real output
Gate evidence (maintainer, not re-run here, as instructed): `verify.sh all` at commit 3faed3a on this exact tree,
exit 0, 11/11 stages: boundary self-test 134 shapes, scripts 71 passed, ruff clean, main 331 passed, artifacts
schema + fresh, tsc clean, vitest 1350 passed, vite build OK.

```
$ wsl.exe -e bash scripts/dev.sh python3 --version
Python 3.12.3
$ wsl.exe -e git status --short          (start)
 M status.md
$ npm --prefix renderer run -s test -- src/shell src/lib   (VITEST_MAX_WORKERS=2, shared tree, HEAD 3faed3a)
 ✓ src/shell/App.test.tsx (43 tests)
 ✓ src/lib/lib.test.tsx (9 tests)
 ✓ src/shell/build.test.ts (6 tests)
 ✓ src/lib/liveContract.test.ts (6 tests)
 ✓ src/shell/advance.test.tsx (3 tests)
 ✓ src/lib/contracts.test.ts (1 test)
 ✓ src/shell/Boundary.test.tsx (4 tests)
 ✓ src/lib/liveStatusStore.test.ts (30 tests)
 ✓ src/shell/ArtifactGate.test.tsx (1 test)
 ✓ src/shell/galleryMode.test.ts (2 tests)
 Test Files  10 passed (10)
      Tests  105 passed (105)
EXIT=0
```

Probe tests (copy, real views). The first attempt asserted the shell's own heading wording ("Could not load …")
and 18 cases on #/advance, #/budget, #/forecast, #/transport did not match it, because those views draw their own
panel; the rerun checks that the panel text names the file instead. Output of the rerun (abridged to one line per
view and kind of answer; all 30 lines have names-file=true):
```
VT-A1 parseHash [["#/locate","locate"],["#/advance/","advance"],["#/budget","budget"],["#/spatial","spatial"],["",null],["#",null],["#/",null],["#/LOCATE",null],["#locate",null],["#/locate/x",null],["#/budget?x=1",null],["#gallery",null],["#/constructor",null],["#/toString",null],["#//locate",null]]
VT-A1 history ["#/spatial","#/transport","#/spatial"]
VT-A3 locate http-404 -> headings ["Could not load artifacts/geometry.json"] callouts ["Warning: artifacts/geometry.json is missing or invalid"] names-file=true len=295
VT-A3 spatial html-200 -> headings ["Could not load artifacts/spatial.json"] callouts ["Warning: artifacts/spatial.json is missing or invalid"] names-file=true len=330
VT-A3 budget schema-2 -> headings ["Budget figures could not be loaded"] callouts ["Warning: artifacts/budget.json failed to load"] names-file=true len=146
VT-A3 forecast shape-v1 -> headings ["Could not load artifacts/forecast.json"] callouts ["Warning: artifacts/forecast.json is missing or invalid"] names-file=true len=314
VT-A3 transport null -> headings ["Transport evidence could not be loaded"] callouts ["Warning: artifacts/transport.json failed to load"] names-file=true len=165
VT-A3 advance shape-v1 -> headings ["Nonlinear GX on two A100s: GPU 0 bean tube, GPU 1 triangular tube","Replay: archived stella and GENE bean traces"] callouts ["Warning: artifacts/transport.json has an unexpected shape — no archived evidence to replay"] names-file=true len=765
      Tests  30 passed | 2 skipped (32)        (-t VT-A3; the two A1 probes passed in the first run)
```

Real build and static serve (copy, 127.0.0.1 only, no API):
```
✓ built in 2.63s
budget.json src=b7d16911e7b4944d dist=b7d16911e7b4944d same
forecast.json src=75c7039534843200 dist=75c7039534843200 same
geometry.json src=1df0e9d5bdfd752a dist=1df0e9d5bdfd752a same
manifest.json src=4c823491715bafe8 dist=4c823491715bafe8 same
spatial.json src=6f2ed8add50c693c dist=6f2ed8add50c693c same
transport.json src=ae594c701e542a5a dist=ae594c701e542a5a same
dist/artifacts json count: 6, source count: 6
GET / -> 200 481 bytes
GET /artifacts/budget.json -> 200, identical to artifacts/budget.json: True, schemaVersion 1
GET /artifacts/geometry.json -> 200, identical to artifacts/geometry.json: True, schemaVersion 1
GET /artifacts/spatial.json -> 200, identical to artifacts/spatial.json: True, schemaVersion 1
GET /api/live/status -> 404 (no backend behind the static build)
A4 question from TASK.md: Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?
A4 question present verbatim in the built bundle: True
A2 bundle requests /api/live/status: True ; A5 bundle requests /artifacts/: True
A1 bundle has #/locate: True   (same for #/advance #/transport #/forecast #/spatial #/budget)
```

Mutations (copy; each runs only that outcome's tests with -t; every file restored and compared with the shared tree):
```
M1-A1 (renderer/src/shell/useHashRoute.ts) exit=1  Tests  2 failed | 41 skipped (43)
   × A1 a route change is announced and moves focus to the view, unless the keyboard is in the nav (FE-12)
   × A1 navigation reaches all six views by keyboard and the URL hash names the view
M2-A2 (renderer/src/lib/liveStatus.ts) exit=1  Tests  3 failed | 38 passed | 11 skipped (52)
   × A2 a partial or malformed status body never blanks the page: it is rejected and the app stays in replay
   × A2 fetchLiveStatus rejects partial and wrong-typed bodies as "bad payload" (they must never reach a render)
   × A2 live status: unreachable backend is not live; only mode=live is live
M3-A3 (renderer/src/lib/artifacts.ts) exit=1  Tests  2 failed | 2 passed | 6 skipped (10)
   × A3 artifact loading/error/data states: missing or invalid artifacts name the file, never blank
   × A3 fetchArtifact rejects wrong schemaVersion and HTTP errors with the file name
M4-A4 (renderer/src/shell/ProvenanceLegend.tsx) exit=1  Tests  1 failed | 1 passed | 41 skipped (43)
   × A4 the legend explains every provenance kind and verification outcome defined in contracts/common.schema.json
M5-A5 (renderer/vite.config.ts) exit=1  Tests  1 failed | 5 skipped (6)
   × A5 static build copies artifacts/*.json into <outDir>/artifacts so replay needs no backend
--- copy restored? (diff against the shared tree, expect nothing)
probe copy deleted: /home/qqbot/.cache/labyrinth-probes/vt-09-app-shell
```

### Findings
The previous run's blocking items are fixed and now tested: the header raises the billing-risk Alert for
TERMINATE FAILED / TERMINATION PENDING in every mode on every route (`App.test.tsx:263-287`); a partial status body
is rejected by the contract validator (`renderer/src/lib/liveStatus.ts:272-273`, tested at `App.test.tsx:389` and
`lib.test.tsx:48`); the legend lists `not-applicable` (`renderer/src/shell/ProvenanceLegend.tsx:10`) and its test
reads the enums from `contracts/common.schema.json` (`App.test.tsx:527`). Weak-test items 4 and 6 of that run are
covered (`lib.test.tsx:64`, `lib.test.tsx:71`, `App.test.tsx:431`). Its minor items 10 to 12 were not re-checked
in this shortened run.

Minor (none blocks an outcome):
1. `renderer/src/lib/liveStatus.ts:226`: `modePills` decides the LIVE pill with its own `s.data.mode === 'live'`
   instead of calling `isLive` (`liveStatus.ts:57-59`), which interface.md §3 names the single source. Same
   behaviour today; a later change to `isLive` would not reach the header pill. Fix: use `isLive(s)` there.
2. Error panels are worded two ways. Locate and Spatial (and shape errors in Forecast and Transport) use the
   shell's `ArtifactErrorPanel` ("Could not load <file>", `renderer/src/shell/ArtifactGate.tsx:20`); fetch errors
   in Budget, Forecast and Transport draw their own panel ("… could not be loaded" with "<file> failed to load",
   e.g. `renderer/src/features/budget/BudgetView.tsx:62-70`). Every one names the file, so A3 holds; this is for
   the feature owners if one wording is wanted.

Not checked in this run: a real browser (keyboard focus styles, screen readers), the dev server, the real
`labyrinth_main.server` behind the app.

Verdict: PASS

## Run 3 — whole task
Verifier run: 2026-11-21, commit 77fd8b6
Re-verification after D-024. `git status --short` was empty at the start and at the end of the run (whole tree, so the
owned paths `renderer/src/shell/` and `renderer/src/lib/` too). `git diff --stat 3faed3a HEAD -- renderer/src/shell` prints
nothing; in `renderer/src/lib` only `liveContract.ts`, `liveContract.test.ts` and `liveStatus.ts` changed. Short scope at the
owner's request: the task's own tests, one independent probe per outcome, five mutations (all on the D-024 change).
`verify.sh all`, every probe test and every mutation ran in isolated copies (`scripts/probe-copy.sh vt09-gate` and
`vt09-probe`, both deleted at the end, restore checked with `cmp` against the shared tree). The targeted tests and
`check_boundaries.py` ran read-only in the shared tree at HEAD 77fd8b6.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| A1 | Navigation across the six views, keyboard accessible, URL hash reflects the view | `renderer/src/shell/App.test.tsx` › "A1 navigation reaches all six views by keyboard and the URL hash names the view" and "A1 a route change is announced and moves focus…"; the shell is unchanged since 3faed3a | Real `App` with the real views and real artifacts, no backend: `#/Nope` is rewritten to `#/locate`; setting the hash to each of the six views gives exactly one `aria-current` (that link), the title "<view> · Labyrinth" and a main landmark named after the view. The built bundle carries the six route ids | PASS |
| A2 | Global mode indicator: REPLAY ($0) vs LIVE, driven by `/api/live/status`; no backend means full replay | `App.test.tsx` A2 tests (incl. "a partial or malformed status body never blanks the page"), `lib.test.tsx` A2 tests, `renderer/src/lib/liveContract.test.ts` (9 tests; the 3 D-024 tests compare the validator with ajv on a corruption corpus, on every comparison rule alone and inside a saved run, and pin the messages) | (1) My own 51 hand-written and text-level comparison payloads plus 4000 seeded multi-step fuzzed documents against Ajv2020 (strictNumbers on) over `contracts/live-status.schema.json` and `live-run.schema.json`: 0 disagreements for `validateLiveStatus` and for `validateSavedRun`. (2) Five `comparison` objects produced by the real backend `comparison.py` (no samples, partial cover, full cover, injected agree/disagree, error path) are accepted by ajv and both validators. (3) Real `App` with the real views: a mode "live" snapshot with 8 kinds of broken comparison on `#/transport`, `#/advance`, `#/budget` shows "Replay · $0" with "invalid status", no LIVE pill, 6 nav links, the h1 and the view; control with a valid comparison shows LIVE. Mutations M1 to M4 on the validator turn the repo tests red; M5 is caught only by my probe (finding 1) | PASS |
| A3 | Typed artifact loader with loading / error / data states; a missing or invalid artifact shows an error panel naming the file, never a blank screen | `renderer/src/shell/ArtifactGate.test.tsx`, the A3 tests in `lib.test.tsx`, `App.test.tsx` › "A3 a view that throws shows the named error panel…"; `artifacts.ts` and the shell are untouched by 77fd8b6 | Real `App` with the real views, no backend: `spatial.json` answered with HTML (200), `transport.json` with schemaVersion 2, `geometry.json` 404, `forecast.json` schemaVersion 1 with no fields: the main region names the file in each case (headings "Could not load artifacts/spatial.json", "Transport evidence could not be loaded", "Could not load artifacts/geometry.json", "Could not load artifacts/forecast.json"), 6 nav links, h1 intact | PASS |
| A4 | Header states the user decision question and a global provenance legend | `App.test.tsx` › "A4 header states the user decision…" and "A4 the legend explains every provenance kind and verification outcome defined in contracts/common.schema.json" | The question read from TASK.md equals the rendered h1 and `DECISION_QUESTION`, character for character, and appears verbatim in the built bundle; the "Provenance legend" region is rendered | PASS |
| A5 | Static build (`npm run build`) contains `dist/artifacts/*.json` so replay works with no backend | `renderer/src/shell/build.test.ts` (6 tests) | The real `npm run build` of `verify.sh all` in the gate copy: 6 of 6 `dist/artifacts/*.json` have the sha256 of `artifacts/*.json`; a plain `python3 -m http.server` on 127.0.0.1 serving `dist` returns all six byte-identical with schemaVersion 1 and 404 for `/api/live/status` | PASS |

### Real output
Gate (isolated copy of the clean tree at 77fd8b6; `docs:handoff` warns that currency cannot be checked in a copy without `.git`):
```
$ (cd ~/.cache/labyrinth-probes/vt09-gate && VITEST_MAX_WORKERS=2 bash scripts/verify.sh all) ; echo EXIT=$?
main/tests: 347 passed in 43.48s
 Test Files  30 passed (30)
      Tests  1370 passed (1370)
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (10s)
  PASS  main:lint (0s)
  PASS  main:tests (42s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (1s)
  PASS  renderer:typecheck (16s)
  PASS  renderer:tests (70s)
  PASS  renderer:build (3s)
verify.sh: all stages passed.
EXIT=0
```
Targeted tests and boundary check (shared tree, read-only, HEAD 77fd8b6):
```
$ npm --prefix renderer run -s test -- src/shell src/lib
 ✓ src/shell/build.test.ts (6 tests)
 ✓ src/shell/App.test.tsx (43 tests)
 ✓ src/lib/lib.test.tsx (9 tests)
 ✓ src/lib/liveContract.test.ts (9 tests)
 ✓ src/shell/advance.test.tsx (3 tests)
 ✓ src/lib/contracts.test.ts (1 test)
 ✓ src/shell/Boundary.test.tsx (4 tests)
 ✓ src/lib/liveStatusStore.test.ts (30 tests)
 ✓ src/shell/ArtifactGate.test.tsx (1 test)
 ✓ src/shell/galleryMode.test.ts (2 tests)
 Test Files  10 passed (10)
      Tests  108 passed (108)
EXIT=0
$ npm --prefix renderer run -s test -- src/lib/liveContract.test.ts --reporter=verbose
 ✓ … > D-024 validateLiveStatus agrees with the schema on snapshots carrying a comparison and on every corruption of them
 ✓ … > D-024 every comparison rule: the schema and the validator give the same verdict, alone and inside a saved run
 ✓ … > D-024 validateLiveStatus names what is wrong in a comparison
 Test Files  1 passed (1)
      Tests  9 passed (9)
EXIT=0
$ python3 scripts/check_boundaries.py
boundary: OK (169 files scanned)
exit=0
```
Validator probe (`vt09_contract.test.ts` in the copy; oracle `new Ajv2020({ strict: false, strictNumbers: true })` over all
`contracts/*.schema.json`; each document checked alone and as phase 2 of a saved run). Abridged to the rows of interest; all 51 rows say `agree`:
```
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|comparison = null|$.comparison: expected an object, got null
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|covered missing on uncovered window|$.comparison.windows[1]: missing required property "covered"
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|flip covered window to false, stats kept|$.comparison.windows[0].mean: expected null, got 2.7 (window not covered)
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|flip to false with stats nulled but claim true|$.comparison.windows[0].saturatedClaimAllowed: expected false, got true (window not covered)
VT09|agree|ajv=valid|validator=valid|run ajv=valid validateSavedRun=valid|flip to false, everything nulled, claim false (valid)|
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|uncovered, only stationary false|$.comparison.windows[1].stationary: expected null, got boolean (window not covered)
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|windows: second only|$.comparison.windows: expected 0 or 2 items, got 1
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|archive[1] code "stella"|$.comparison.windows[1].archive[1].code: expected one of "GENE", got "stella"
VT09|agree|ajv=valid|validator=valid|run ajv=valid validateSavedRun=valid|top-level claim true with every verdict "no claim" (schema does not encode it)|
VT09|agree|ajv=valid|validator=valid|run ajv=valid validateSavedRun=valid|both windows covered and identical (valid)|
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|"__proto__" key in comparison|$.comparison: unexpected property "__proto__"
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|"hasOwnProperty" key in an archive entry|$.comparison.windows[0].archive[0]: unexpected property "hasOwnProperty"
VT09|agree|ajv=invalid|validator=invalid|run ajv=invalid validateSavedRun=invalid|window.window [200, 1e400]|$.comparison.windows[0].window[1]: expected a finite number, got Infinity
VT09|SUMMARY|51 cases, 39 invalid by ajv, 51 agree
VT09|FUZZ|4000 documents, 2536 invalid and 1464 valid by ajv, 0 disagreements
VT09|BACKEND|no samples|ajv=true|validator=valid|savedRun ajv=true validator=valid
VT09|BACKEND|partial 180-290 (committed archive)|ajv=true|validator=valid|savedRun ajv=true validator=valid
VT09|BACKEND|full 150-420 (committed archive)|ajv=true|validator=valid|savedRun ajv=true validator=valid
VT09|BACKEND|full 150-420 (injected archive: stella same mean, GENE far)|ajv=true|validator=valid|savedRun ajv=true validator=valid
VT09|BACKEND|divergent repeat (error path)|ajv=true|validator=valid|savedRun ajv=true validator=valid
```
The backend objects came from `labyrinth_main.features.live_gx.comparison.live_comparison` in the copy:
```
no samples: nSamples=0 windows=2 covered=[False, False] verdicts=[['no claim', 'no claim'], ['no claim', 'no claim']] saturatedClaimAllowed=False
full 150-420 (committed archive): nSamples=541 windows=2 covered=[True, True] verdicts=[['no claim', 'no claim'], ['no claim', 'no claim']] saturatedClaimAllowed=False
full 150-420 (injected archive: stella same mean, GENE far): nSamples=541 windows=2 covered=[True, True] verdicts=[['agree', 'disagree'], ['agree', 'disagree']] saturatedClaimAllowed=True
divergent repeat (error path): nSamples=2 windows=0 covered=[] verdicts=[] saturatedClaimAllowed=False reason='Live comparison could not be computed: ValueError: the live bean trace'
```
A2 app probe (`vt09_a2app.test.tsx`, real views, real artifacts; 24 rows, all alike; `#/transport` shown in full, one row each for the others):
```
VT09-A2|control valid comparison|#/transport|pills=["live:LIVE · GPU 0 / GPU 1"]|mode=LIVE · GPU 0 / GPU 1Both workers launched; streaming GX output (live).
VT09-A2|#/transport|comparison: null|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=14341|mode=Replay · $0The live API answered with an invalid status; it is ignored and every view plays saved evidence.
VT09-A2|#/transport|one window only|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=14341|mode=Replay · $0The live API answered with an invalid status; …
VT09-A2|#/transport|uncovered window with a mean|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=14341|mode=Replay · $0The live API answered with an invalid status; …
VT09-A2|#/transport|uncovered window claims saturation|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=14341|mode=Replay · $0The live API answered with an invalid status; …
VT09-A2|#/transport|archive GENE before stella|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=14341|mode=Replay · $0The live API answered with an invalid status; …
VT09-A2|#/transport|verdict "agrees"|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=14341|mode=Replay · $0The live API answered with an invalid status; …
VT09-A2|#/transport|comparison has an extra key|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=14341|mode=Replay · $0The live API answered with an invalid status; …
VT09-A2|#/transport|windows: undefined-ish (string)|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=14341|mode=Replay · $0The live API answered with an invalid status; …
VT09-A2|#/advance|comparison: null|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=1229|mode=Replay · $0The live API answered with an invalid status; …
VT09-A2|#/budget|comparison: null|pills=["replay:Replay · $0"]|liveAnywhere=false|nav=6|h1=true|mainChars=8527|mode=Replay · $0The live API answered with an invalid status; …
```
A1, A3, A4 probe (`vt09_shell.test.tsx`, real views, real artifacts, API unreachable):
```
VT09-A1|#/forecast|aria-current=["#/forecast"]|title=Forecast replay · Labyrinth|main=Forecast replay
VT09-A1|#/spatial|aria-current=["#/spatial"]|title=Spatial parallelism · Labyrinth|main=Spatial parallelism
VT09-A1|#/budget|aria-current=["#/budget"]|title=Budget · Labyrinth|main=Budget
VT09-A1|#/advance|aria-current=["#/advance"]|title=Advance plasma · Labyrinth|main=Advance plasma
VT09-A1|#/transport|aria-current=["#/transport"]|title=Check transport · Labyrinth|main=Check transport
VT09-A1|#/locate|aria-current=["#/locate"]|title=Locate the tubes · Labyrinth|main=Locate the tubes
VT09-A3|#/spatial|spatial|names file=true|headings=["Could not load artifacts/spatial.json"]|nav=6|h1=true
VT09-A3|#/transport|transport|names file=true|headings=["Transport evidence could not be loaded"]|nav=6|h1=true
VT09-A3|#/locate|geometry|names file=true|headings=["Could not load artifacts/geometry.json"]|nav=6|h1=true
VT09-A3|#/forecast|forecast|names file=true|headings=["Could not load artifacts/forecast.json"]|nav=6|h1=true
VT09-A4|TASK.md=Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?|h1=Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?|identical=true|constant identical=true
 Test Files  3 passed (3)
      Tests  10 passed (10)
EXIT=0
```
A5 / A4 / A1 on the build that `verify.sh all` produced in the gate copy:
```
budget.json src=b7d16911e7b4944d dist=b7d16911e7b4944d
forecast.json src=75c7039534843200 dist=75c7039534843200
geometry.json src=1df0e9d5bdfd752a dist=1df0e9d5bdfd752a
manifest.json src=4c823491715bafe8 dist=4c823491715bafe8
spatial.json src=6f2ed8add50c693c dist=6f2ed8add50c693c
transport.json src=ae594c701e542a5a dist=ae594c701e542a5a
identical: 6 of 6; dist/artifacts count: 6
Serving HTTP on 127.0.0.1 port 47391 (http://127.0.0.1:47391/) ...
GET /artifacts/manifest.json -> 200, identical=True, schemaVersion=1
GET /artifacts/geometry.json -> 200, identical=True, schemaVersion=1
GET /artifacts/transport.json -> 200, identical=True, schemaVersion=1
GET /artifacts/forecast.json -> 200, identical=True, schemaVersion=1
GET /artifacts/spatial.json -> 200, identical=True, schemaVersion=1
GET /artifacts/budget.json -> 200, identical=True, schemaVersion=1
GET /api/live/status -> 404 (no backend)
TASK.md question: Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?
question verbatim in renderer/dist/assets/index-VS5okhCr.js: 1
### route ids in renderer/dist/assets/index-VS5okhCr.js
locate:id:`locate` advance:id:`advance` transport:id:`transport` forecast:id:`forecast` spatial:id:`spatial` budget:id:`budget`
```
Mutations (probe copy; M1 to M4 run `src/lib/liveContract.test.ts` plus my contract probe, M5 runs `src/shell src/lib
src/features/transport src/features/live-gx` plus my A2 app probe; each file restored and compared with the shared tree):
```
=== [M1-ifthen-dropped] renderer/src/lib/liveContract.ts :: >   if (w.covered !== false || true) return null;
    exit=1
   × D-024 validateLiveStatus agrees with the schema on snapshots carrying a comparison and on every corruption of them
   × D-024 every comparison rule: the schema and the validator give the same verdict, alone and inside a saved run
   × D-024 validateLiveStatus names what is wrong in a comparison
   × VT09 hand-written and text-level comparison corruptions: validator == ajv, alone and inside a saved run
   × VT09 seeded multi-step fuzz of comparison: validator == ajv on every document, alone and inside a saved run
    restored, identical to the shared tree
=== [M2-one-window-allowed] renderer/src/lib/liveContract.ts :: > return (v as unknown[]).length === 99 ?
    exit=1
   × D-024 every comparison rule: the schema and the validator give the same verdict, alone and inside a saved run
   × D-024 validateLiveStatus names what is wrong in a comparison
   × VT09 hand-written and text-level comparison corruptions: validator == ajv, alone and inside a saved run
   × VT09 seeded multi-step fuzz of comparison: validator == ajv on every document, alone and inside a saved run
    restored, identical to the shared tree
=== [M3-comparison-nullable] renderer/src/lib/liveContract.ts :: > { qualified: bool, provenance, comparison: nullable(comparison) }
    exit=1
   × D-024 validateLiveStatus agrees with the schema on snapshots carrying a comparison and on every corruption of them
   × D-024 every comparison rule: the schema and the validator give the same verdict, alone and inside a saved run
   × D-024 validateLiveStatus names what is wrong in a comparison
   × VT09 hand-written and text-level comparison corruptions: validator == ajv, alone and inside a saved run
    restored, identical to the shared tree
=== [M4-archive-order-free] renderer/src/lib/liveContract.ts :: > object({ code: oneOf(['stella', 'GENE']),
    exit=1
   × D-024 every comparison rule: the schema and the validator give the same verdict, alone and inside a saved run
   × D-024 validateLiveStatus names what is wrong in a comparison
   × VT09 hand-written and text-level comparison corruptions: validator == ajv, alone and inside a saved run
   × VT09 seeded multi-step fuzz of comparison: validator == ajv on every document, alone and inside a saved run
    restored, identical to the shared tree
=== [M5-fetch-skips-check-when-comparison] renderer/src/lib/liveStatus.ts :: > const problem = (body as { comparison?: unknown } | null)?.comparison !== undefined ? null : validateLiveStatus(body);
    exit=1
   × VT09-A2 a live snapshot with a broken comparison drops to REPLAY and never blanks (#/transport)
   × VT09-A2 a live snapshot with a broken comparison drops to REPLAY and never blanks (#/advance)
   × VT09-A2 a live snapshot with a broken comparison drops to REPLAY and never blanks (#/budget)
    restored, identical to the shared tree
--- whole copy vs shared tree for the owned dirs
diff exit=0
probe copy deleted: /home/qqbot/.cache/labyrinth-probes/vt09-gate
probe copy deleted: /home/qqbot/.cache/labyrinth-probes/vt09-probe
$ git status --short          (end: empty)
$ git diff --stat 77fd8b6 -- renderer/src/shell renderer/src/lib          (empty)
```

### Findings
No outcome is blocked. The validator change agrees with ajv on everything I tried, including multi-step corruptions the
repo's single-step corpus does not generate, accepts what the real backend emits, and a rejected body leaves the app in
replay with the shell and the view on screen.
1. Minor, weak test (A2 after D-024): no repo test sends a status body with a broken `comparison` through
   `fetchLiveStatus` or the App. Mutation M5 at `renderer/src/lib/liveStatus.ts:283` (skip `validateLiveStatus` when the body
   carries a comparison) leaves `src/shell`, `src/lib`, `src/features/transport` and `src/features/live-gx` green; only my
   probe caught it. Low risk: line 283 is the single check, and both halves are tested (the rules in
   `liveContract.test.ts:329-450`, the rejection path in `App.test.tsx:389-409`). Fix: add `{ ...status('live'), comparison: null }`
   and a one-window comparison to the bodies at `renderer/src/shell/App.test.tsx:390-397`.
2. Note for task 02: the schema and the validator both accept a top-level `comparison.saturatedClaimAllowed: true` with every
   archive entry at "no claim" (the "only with an agree" rule lives in the schema description and the backend, not in the
   schema). The transport model already flags this case (`renderer/src/features/transport/model.ts:535`); it is not a shell matter.
3. Note: a reversed `window` such as [300, 200] is accepted by both, as documented at `renderer/src/lib/liveContract.ts:191`
   (JSON Schema cannot order the two items).
4. The two minors of the previous run (`modePills` deciding LIVE on its own at `liveStatus.ts`, two wordings of error
   panels) were not re-checked; the shell code is unchanged since then.

Not checked in this run: a real browser, the dev server, the real `labyrinth_main.server` behind the app.

Verdict: PASS

## Run 5 — whole task
Verifier run: 2026-11-22, commit 9e017b6
### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| A1 | Seven keyboard routes, Heat seventh and model-labelled | A1 shell tests | Chromium used Tab and Enter through every route at 390, 900 and 1440 px with no page overflow | PASS |
| A2 | Global replay and live mode status | A2 shell and live-status store tests | Intercepted unavailable API showed global Replay $0 with no API writes | PASS |
| A3 | Named artifact errors avoid blank page | A3 shell and artifact-loader tests | Full gate exercised artifact validation and static artifacts | PASS |
| A4 | Decision question and provenance legend | A4 shell tests | Browser observed the exact question and opened legend | PASS |
| A5 | Static build carries replay artifacts | Shell build tests | Inspected all seven JSON files in `renderer/dist/artifacts` | PASS |
| A6 | Legend explains schema-derived model provenance | A6 shell tests | Browser opened model explanation | PASS |
### Real output
`PATH=/Users/bedelau/Desktop/Labyrinth/app-checkout/.venv/bin:$PATH VITEST_MAX_WORKERS=2 bash scripts/dev.sh bash scripts/verify.sh all` exited 0. Summary: 71 script tests, 378 backend tests, renderer typecheck, 1736 renderer tests and build passed.

`PATH=/Users/bedelau/Desktop/Labyrinth/app-checkout/.venv/bin:$PATH VITEST_MAX_WORKERS=2 bash scripts/dev.sh npm --prefix renderer run -s test -- src/features/forecast src/design src/shell src/lib` exited 0. 26 files and 1529 tests passed.

`PATH=/Users/bedelau/Desktop/Labyrinth/app-checkout/.venv/bin:$PATH bash scripts/dev.sh python3 scripts/check_boundaries.py` exited 0. `boundary: OK (208 files scanned)`.
### Findings
The independent browser run used a static server with live API responses set to 404. It made no live jobs or API writes and recorded no page errors.

Verdict: PASS
