# Task 10 · Heat & field — external verification

External verifier (did not write this code). Spec read: `tasks/10-heat-field/TASK.md` (H1–H16), `MODEL.md`, decision.md D-027 and
D-028, `design-artifacts/requirements-2026-11-21/README.md`. Commands run on the maintainer's machine through
`wsl.exe -e bash scripts/dev.sh ...`; probe scripts kept in the session scratchpad (not in the repo). Mutations ran only in a
`scripts/probe-copy.sh` copy, which was deleted afterwards. `git status --short` was empty and HEAD was `ca1871b` before and after.

## Run 1 — whole task
Verifier run: 2026-11-21, commit ca1871b

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| H1 | Nine surfaces 48 θ × 72 φ, R, Z, B magnitude from the VMEC reader; axis R, Z independent of θ, axis field spread stated; LCFS agrees with the reader and with geometry.json at ζ 0° and 36° | `test_H1_*` (5 tests) in `main/tests/test_heatfield.py`, incl. a second reader on the raw wout arrays sharing no code with vmec.py | Own script against `features/geometry/vmec.py`: 7 LCFS cells worst dR 4.6e-7 m, dZ 4.4e-8 m, rel dB 1.5e-7; axis R and Z theta-spread exactly 0; axis field spread 0.0293 T of mean 2.693 T, provenance text says 0.029 T (1.1 %); plane j=0 and j=36 equal geometry.json bean and triangular boundary at 16 common θ (difference 0); reader at ζ 36° vs plane j=36 within 4.6e-7 m | PASS |
| H2 | Eight LCFS field lines, one toroidal turn, every point on the LCFS with the reader's field magnitude | `test_H2_*` (2 tests): bisection of θ* = α + ιφ on raw arrays, x/y/z/B to 5e-6 m / 2e-6 rel | 168 sampled points (every 9th of 181 on each line): θ found by nearest point on the reader's LCFS at that φ, not by the tracer: max distance 6.1e-7 m, max rel field difference 2.3e-7; α = 2πm/8 | PASS |
| H3 | Four schematic diverters D1–D4 at 0, π/2, π, 3π/2 with the ten-units note | `test_H3_four_schematic_diverters_at_quarter_turns` | Artifact read: φ 0, 1.570796, 3.141593, 4.712389, thetaCentre 1.570796, note names ten island-divertor units | PASS |
| H4 | Reference model follows MODEL.md; uniform T_ped stays exact without sink/coils; T in [T_t, T_ped]; stability ≤ 1; coil sweep A_s·cos(2πft) and ε at centre; sweeping lowers tile peak; deterministic | `test_H4_*` (9 tests), incl. a literal per-cell loop transcription of steps 1–12 compared to 1e-12 | Own vectorised numpy implementation of MODEL.md (np.roll, written from MODEL.md, not from model.py) run from the on-disk artifact: all 3 golden scenarios reproduced, worst rel diff 3.75e-7; T range over each run within [0.655, 1.000]; own stability number 0.735497 = model.check_stability | PASS |
| H5 | Golden checkpoints for the three scenarios; regime: coils off at 3 s one diverter above and one below the limit, all coils on all below | `test_H5_*` (4 tests) | Own implementation: coils off at 3 s D1 1319.8, D2 1115.5, D3 1105.5, D4 1314.8 °C (D1, D4 above 1200; D2, D3 below); all on from 0 s 574.8, 485.5, 472.7, 572.8 °C (all below). model.py rerun from the on-disk artifact, switch-at-1s step 1500: rel diff 7.3e-8. MODEL.md D-028 figures match at printed precision | PASS |
| H6 | geometryProvenance derived with VMEC sha256, provenance model / not-applicable / illustrative, byte-identical rebuild, schema-valid, in the manifest | `test_H6_*` (3 tests), incl. every other provenance kind rejected only at `<field>.kind` | Contract read: `allOf` pins `kind` const derived / model (heatfield.schema.json:220, :227); verify.sh `artifacts:fresh` = byte-identical rebuild, `artifacts:schema` valid; manifest entry with sha256 present | PASS |
| H7 | Route #/heat loads heatfield.json through the artifact gate with a validator; broken artifact shows an error naming the file | `types.test.ts` H7 (3), `HeatFieldView.test.tsx` H7 (2) | Code read: HeatFieldView.tsx:47-49 `useArtifact('heatfield')` into `ArtifactGate ... validate={checkHeatfield}`; nav link "Heat & field" asserted current in the route test | PASS |
| H8 | TS port reads every value from the artifact and reproduces every golden checkpoint to relativeTolerance | `model.test.ts` H8 (8): 153 golden values compared, literal scan of model.ts | Mutation in a probe copy: swapping the T₊ interpolation weights makes the golden test go red (coils-off step 250 meanT rel error 2.3e-3 against 2e-6); hard-coding tileGain 165 keeps the golden test green but the input and literal-scan tests go red. Code read: model.ts takes every parameter through `p.<name>` | PASS |
| H9 | 3D scene: LCFS by temperature (red hottest, yellow coldest) or field (dark blue strongest, green weakest), black plates, field lines, arrows, colour bars with units, WebGL fallback | `HeatScene.test.tsx` H9 (14) with real three, `HeatFieldView.test.tsx` H9 (2) | Tokens read (tokens.ts:243-244): light heat ramp #fcdf00 yellow to #bc0013 red, field ramp #00a676 green to #1811a2 dark blue; WebGL fallback note names the text equivalents | PASS |
| H10 | Hover read-out (temperature keV labelled model, field T, angles) on 3D and cross-section; keyboard / text path | `HeatFieldView.test.tsx` H10 (5), `HeatScene.test.tsx` pickCell | Code read: HeatFieldView.tsx:253-285 read-outs carry the Model pill on temperature and the VMEC pill (plus Model coil-perturbation pill while a coil is on) on the field row | PASS |
| H11 | Cross-section with 5° slider, keyboard operable, jump-to-diverter, plate drawn at diverter angles | `HeatFieldView.test.tsx` H11 (3) | Code read: native `type=range`, min 0, max 360 − 360/nPhi, step 360/nPhi, `Go to D1`…`D4` buttons with aria-pressed (HeatFieldView.tsx:469-491) | PASS |
| H12 | Diverter panel: peak tile °C, peak heat flux MW/m², status text + icon, aria-pressed toggles, all off | `HeatFieldView.test.tsx` H12 | Code read: DiverterPanel.tsx:25-33 icon plus "Above limit" / "Below limit" words, :75-86 `aria-pressed`, :94 "All adjustments off" | PASS |
| H13 | Play / pause / reset / speed; no autoplay under reduced motion; model time shown; pause freezes all displays | `HeatFieldView.test.tsx` H13 (2) with a hand-driven requestAnimationFrame | Test reads model time, diverter table, chart data and model step before and after 20 s of frames while paused: unchanged | PASS |
| H14 | Field-against-φ graph at strike-line θ, redrawn as coils sweep, slider / diverter / hover markers, Freeze snapshot dashed | `HeatFieldView.test.tsx` H14 (4), `chart.test.ts` H14 (6) | Test compares the plotted curve with `model.field` of the D2 coil at the current step, frame by frame; snapshot trace `dash` and unchanged after the sweep | PASS |
| H15 | Loop current → predict → adjust (over-limit suggested, user may change any) → new heat map; predicted vs achieved side by side | `HeatFieldView.test.tsx` H15 | Test recomputes predicted (coils off, 2 s) and achieved (D1, D2, D4 on, 2 s) peaks with the model and checks both columns; prediction does not move the running state | PASS |
| H16 | Equation and parameter table shown; every model number carries the Model status; not-a-W7-X-simulation and schematic notes; prediction is this reduced model, not GENE-X | `HeatFieldView.test.tsx` H16 (4) and H10 H16 | Code read: callouts HeatFieldView.tsx:323 and :334, GENE-X sentence ControlLoop.tsx:214, Model pill on every model panel header (:601, :648, :667, cross-section :459, scene ProvenanceBadge :353); no live or replay status in the view | PASS |

### Real output

Whole gate (scope all), log tail:
```
$ wsl.exe -e bash scripts/dev.sh bash scripts/verify.sh all
...
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (2s)
  PASS  scripts:tests (22s)
  PASS  main:lint (1s)
  PASS  main:tests (66s)
  PASS  artifacts:schema (1s)
  PASS  artifacts:fresh (3s)
  PASS  renderer:typecheck (16s)
  PASS  renderer:tests (72s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
EXIT=0
```
Lines from the same log: `artifacts: schema-valid`, `artifacts: fresh (byte-identical rebuild)`, `378 passed in 69.22s (0:01:09)`,
`Test Files  40 passed (40)`, `Tests  1705 passed (1705)`.

Backend tests on their own:
```
$ wsl.exe -e bash scripts/dev.sh python3 -m pytest -v main/tests/test_heatfield.py
collecting ... collected 24 items

main/tests/test_heatfield.py::test_H1_nine_surfaces_on_the_48_by_72_grid PASSED [  4%]
main/tests/test_heatfield.py::test_H1_the_axis_does_not_depend_on_theta PASSED [  8%]
main/tests/test_heatfield.py::test_H1_axis_B_varies_with_theta_by_the_amount_the_provenance_states PASSED [ 12%]
main/tests/test_heatfield.py::test_H1_surfaces_agree_with_an_independent_reader PASSED [ 16%]
main/tests/test_heatfield.py::test_H1_lcfs_agrees_with_geometry_plasma_boundary PASSED [ 20%]
main/tests/test_heatfield.py::test_H2_eight_lcfs_field_lines_one_toroidal_turn PASSED [ 25%]
main/tests/test_heatfield.py::test_H2_every_field_line_point_lies_on_the_lcfs_with_the_readers_B PASSED [ 29%]
main/tests/test_heatfield.py::test_H3_four_schematic_diverters_at_quarter_turns PASSED [ 33%]
main/tests/test_heatfield.py::test_H4_parameters_are_the_model_md_table_except_the_two_tunable_ones PASSED [ 37%]
main/tests/test_heatfield.py::test_H4_the_model_consumes_the_inputs_as_written PASSED [ 41%]
main/tests/test_heatfield.py::test_H4_one_step_is_model_md_transcribed_literally PASSED [ 45%]
main/tests/test_heatfield.py::test_H4_uniform_pedestal_without_sinks_or_coils_stays_exactly_uniform PASSED [ 50%]
main/tests/test_heatfield.py::test_H4_temperature_stays_between_target_and_pedestal PASSED [ 54%]
main/tests/test_heatfield.py::test_H4_stability_condition_holds_for_the_coil_perturbed_field PASSED [ 58%]
main/tests/test_heatfield.py::test_H4_a_coil_moves_the_strike_line_and_changes_B_by_epsilon_at_its_centre PASSED [ 62%]
main/tests/test_heatfield.py::test_H4_sweeping_lowers_the_peak_tile_temperature PASSED [ 66%]
main/tests/test_heatfield.py::test_H4_runs_are_deterministic PASSED      [ 70%]
main/tests/test_heatfield.py::test_H5_golden_scenarios_as_model_md_specifies PASSED [ 75%]
main/tests/test_heatfield.py::test_H5_golden_values_equal_a_fresh_run_on_the_written_inputs PASSED [ 79%]
main/tests/test_heatfield.py::test_H5_regime_requirements_hold PASSED    [ 83%]
main/tests/test_heatfield.py::test_H5_model_text_states_what_the_model_is PASSED [ 87%]
main/tests/test_heatfield.py::test_H6_provenance_geometry_derived_and_model_model PASSED [ 91%]
main/tests/test_heatfield.py::test_H6_artifact_is_schema_valid_and_byte_identical_on_rebuild PASSED [ 95%]
main/tests/test_heatfield.py::test_H6_manifest_lists_heatfield PASSED    [100%]

============================= 24 passed in 15.23s ==============================
```

Renderer heatfield tests on their own (ANSI colour codes stripped, durations kept):
```
$ wsl.exe -e bash scripts/dev.sh npm --prefix renderer run -s test -- --reporter=verbose src/features/heatfield
 RUN  v5.1.1 /mnt/d/Labyrinth/renderer
 ✓ src/features/heatfield/types.test.ts > H7 the committed artifact passes the check: 9 surfaces on 48 × 72, 8 field lines, D1–D4, probes inside the grid 16ms
 ✓ src/features/heatfield/types.test.ts > H7 every broken shape is rejected with a message that names the problem 190ms
 ✓ src/features/heatfield/types.test.ts > H7 the gate holds the provenance kinds the contract pins: model output "model", geometry and |B| "derived" (RV-HF-B1) 58ms
 ✓ src/features/heatfield/model.test.ts > H8 the port reproduces every golden checkpoint of the Python reference to relativeTolerance 1237ms
 ✓ src/features/heatfield/model.test.ts > H8 every input comes from the artifact: grid, |B|, ι, θ_d, φ_k and every parameter as written there 105ms
 ✓ src/features/heatfield/model.test.ts > H8 model.ts holds no duplicated model constant: its only numeric literals are 0, 1, 2 and 0.5 1ms
 ✓ src/features/heatfield/model.test.ts > H8 with no sink and no coils a uniform T_ped stays exactly uniform; the step is deterministic 98ms
 ✓ src/features/heatfield/model.test.ts > H8 T stays within [T_t, T_ped] and the stability condition holds (≤ 1, maximum over every coil state) 1047ms
 ✓ src/features/heatfield/model.test.ts > H8 a coil moves the strike line by A_s·cos(2πft) and changes |B| by ε at its centre; coils follow the schedule convention 6ms
 ✓ src/features/heatfield/model.test.ts > H8 diagnostics: probes, mean, tile peaks and heat-flux peaks of a state; sweeping lowers the tile peak 764ms
 ✓ src/features/heatfield/model.test.ts > H8 heat-flow vector and cross-section fields follow MODEL.md 8ms
 ✓ src/features/heatfield/chart.test.ts > H14 the φ axis is padded past 0° and 360°, so the D1 and slice markers at 0° are not hidden on the y axis line (DZ-5) 3ms
 ✓ src/features/heatfield/chart.test.ts > H14 the slice label moves to the bottom of its line when the slice is at a diverter angle, and stays at the top elsewhere (DZ-5) 4ms
 ✓ src/features/heatfield/chart.test.ts > H14 marker labels are anchored inside the plot: on the right of their line (clear of the y axis at 0°), ending at the top or starting at the bottom (clear of the tick labels) (DZ-5) 1ms
 ✓ src/features/heatfield/chart.test.ts > H14 per model step only the traces change: the layout keeps one uirevision (Plotly keeps the user’s zoom and pan) and the running curve one legend name (HF3-1) 1ms
 ✓ src/features/heatfield/chart.test.ts > H14 a narrow chart (a phone) gets five φ ticks, 0° to 360°, instead of nine (DZ3-6) 1ms
 ✓ src/features/heatfield/chart.test.ts > H14 staggerLabels: the first free position of top, bottom, middle among markers closer than the clash window 0ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H7 the route #/heat renders the view, which loads artifacts/heatfield.json through the artifact gate 673ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H7 a broken or missing artifact shows an error panel naming artifacts/heatfield.json and the problem 50ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H9 the scene starts from the spun-up state, colours by temperature or |B| with labelled colour bars, and toggles field lines and arrows 186ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H10 hovering the 3D surface or a cross-section cell shows temperature (keV, model), |B| (T) and the angles 110ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H10 H16 with a field adjustment on, |B| in the read-outs, the slice summary and the text summary is VMEC plus the model coil perturbation, and says so 208ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H10 without a mouse: the slice is one focusable group whose arrow keys move a cursor over the cells and show and announce the same read-out 450ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H10 without a mouse: every θ of the LCFS at the slider angle is listed with the values the 3D read-out shows there 67ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H8 the cross-section subtitle reads ρ_blend from the artifact, not a copy of it 466ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H11 the toroidal-angle slider (5° steps) and Go to D1–D4 choose the slice; the plate is drawn only at a diverter angle 124ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H11 the slice temperature bar starts at the data floor, so the cold footprint under a coil-off plate shows in the slice and follows the coils (DZ-4) 424ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H11 the cross-section cells and the edge strip are stroked in their own colour, so no hairline seams show between them (DZ3-4) 46ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H12 diverter table: peak tile °C, peak heat flux MW/m², status against the limit in words and icon, field-adjustment toggles 130ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H13 play, pause, reset and speed: model time runs only while playing, and pausing freezes every display 186ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H13 no autoplay under prefers-reduced-motion; otherwise the view plays from the start 63ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H14 |B| against φ at the strike-line θ, redrawn as the coils sweep; diverter, slice and pointer markers; Freeze snapshot keeps a dashed copy 161ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H14 while playing, the |B| curve is redrawn on every frame of a 60 Hz display, not only at the 10 Hz refresh, so the coil sweep is drawn as a sweep 249ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 buildContent: the closed LCFS mesh from the grid, four black plates with an edge, eight casing field lines, arrows and the slice ring 61ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 each black plate is drawn over its light rim from every view: the rim goes first and writes no depth 15ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 each black plate is drawn whole over the cross-section slice where they cross (φ 0° = D1, the default): plates after the slice, which writes no depth 36ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 the D1–D4 labels sit beyond each plate’s outer end along the major radius, joined by a leader line, and never cover the plate (DZ-2) 4ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 every scene label (D1–D4 and "Slice φ …") lies inside the scene box at every slice angle, on a 309 px phone and on desktops, still clear of the plates and each other (DZ4-1) 824ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 the LCFS silhouette is outlined in sceneTheme().outline: an inverted hull (back faces) pushed out along the outward normals (DZ-1) 25ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 applyFrame colours the LCFS by temperature (red hottest, yellow coldest) or |B| (dark blue strongest, green weakest), in place 39ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 field lines are coloured by their |B| with the coil perturbation, so their colour changes as the coils sweep; toggles hide them 8ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 heat-flow arrows follow the model heat-flow vector; the slice ring follows the slider plane 12ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 the cross-section slice is its own marker: a color.text core in a scene-background halo, at least 2 and 5 px wide, never the colour of a field line (DZ3-1) 43ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 heat-flow arrows are a color.text core on a scene-background halo, 1.5 px or wider, readable on every temperature and |B| colour (DZ3-2) 27ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 on a phone an arrow shorter than its head is wide gets a head no wider than it is long and a halo narrowed with it, so none is a blob; every arrow is still drawn (DZ4-2) 16ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H10 pickCell: a ray through a grid point of the LCFS returns that cell 11ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H15 control loop: current heat map → predict → adjust field (over-limit diverters suggested) → new heat map, predicted and achieved side by side 1618ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H16 the equation, the parameter table and the honesty notes are shown; every panel of model numbers carries the Model status 73ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 HeatScene mounts through three, redraws on every model change without rebuilding, answers the keyboard and cleans up 149ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 a plate behind the torus loses its label and leader, the others keep theirs (HF3-2) 32ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 the label boxes take their size from scene.ts LABEL and SLICE_LABEL, the numbers placement clears the plates with; heatfield.css sets none (HF3-4) 2ms
 ✓ src/features/heatfield/HeatScene.test.tsx > H9 when WebGL cannot start, the scene says so and points at the text equivalents 9ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H16 the equations and notes typeset every X_abc as a subscript, and the governing equation’s label is not repeated under it (DZ3-5) 43ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H16 the stability line says ≤ 1 only when the computed number is at most 1; above 1 it says so and warns (HF3-5) 13ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H16 an artifact whose explicit step is unstable is flagged at the top of the view (HF3-5) 48ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H9 the scene key draws field lines as the |B| ramp, and the arrow and the slice as drawn in 3D: a text-coloured core on a scene-ground halo (DZ3-1, DZ3-2) 81ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > DZ3-9 layout inside a Panel follows the Panel body (@container), not the viewport: only the page grid uses @media 5ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H14 the |B| chart leaves no listener behind: unmounted, a chart tick redraws nothing (HF3-3) 3ms
 ✓ src/features/heatfield/HeatFieldView.test.tsx > H14 on a phone the |B| chart takes the narrow layout: five φ ticks and the legend under the plot (DZ3-6) 40ms
 Test Files  5 passed (5)
      Tests  59 passed (59)
```

Independent backend probe (own script; reads `artifacts/heatfield.json` and calls `features/geometry/vmec.py` directly; H4/H5 use an
own numpy implementation of MODEL.md, not `model.py`):
```
$ wsl.exe -e bash scripts/dev.sh python3 .../scratchpad/vf10-probe_backend.py
== H1 grid 48 72 surfaces [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0]
  LCFS cell i= 0 j= 0: art R=6.173944 reader 6.17394427; Z=0 reader 0; |B|=2.821221 reader 2.82122143
  LCFS cell i=12 j= 0: art R=5.633485 reader 5.63348535; Z=0.8294309 reader 0.829430887; |B|=3.081536 reader 3.08153615
  LCFS cell i= 5 j= 7: art R=5.716202 reader 5.71620238; Z=0.1898489 reader 0.189848893; |B|=2.631995 reader 2.63199535
  LCFS cell i=31 j=44: art R=5.646187 reader 5.64618654; Z=-0.569647 reader -0.569646956; |B|=3.354979 reader 3.35497939
  LCFS cell i=47 j=71: art R=6.144547 reader 6.14454656; Z=-0.1397029 reader -0.139702861; |B|=2.787504 reader 2.78750407
  LCFS cell i=24 j=36: art R=4.611926 reader 4.61192579; Z=0 reader 2.76616289e-16; |B|=2.396361 reader 2.39636066
  LCFS cell i=40 j=13: art R=5.781282 reader 5.78128236; Z=-0.7510623 reader -0.751062337; |B|=2.780369 reader 2.7803691
  worst |dR| 4.58e-07 m, |dZ| 4.43e-08 m, rel |dB| 1.52e-07
  rho 0.625: art R 4.996031 vs 4.99603149, |B| 2.429377 vs 2.42937703
== H1 axis: max theta-spread of R 0.0 of Z 0.0
  axis |B| theta spread 0.0293 T, mean 2.6930 T (1.09 %)
  geometryProvenance details: ... within one phi plane the axis |B| varies with theta by up to 0.029 T (1.1 % of its mean 2.69 T); ...
  bean: heatfield plane j=0 vs geometry.json boundary at 16 common theta: max|dR| 0.00e+00, max|dZ| 0.00e+00; reader at zeta=0 deg vs heatfield: max|dR| 4.78e-07; n boundary pts 129
  triangular: heatfield plane j=36 vs geometry.json boundary at 16 common theta: max|dR| 0.00e+00, max|dZ| 0.00e+00; reader at zeta=36 deg vs heatfield: max|dR| 4.60e-07; n boundary pts 129
== H2 field lines 8 [0.0, 0.785398, 1.570796, 2.356194, 3.141593, 3.926991, 4.712389, 5.497787]
  168 sampled points: max distance to LCFS 6.12e-07 m, max rel |B| diff vs reader 2.29e-07
== H3 diverters [('D1', 0.0, 'D1 · 0 rad'), ('D2', 1.570796, 'D2 · π/2 rad'), ('D3', 3.141593, 'D3 · π rad'), ('D4', 4.712389, 'D4 · 3π/2 rad')] thetaCentre 1.570796
  note: Schematic positions as specified by the owner (2026-11-21). W7-X has ten island-divertor units, upper and lower in each of its five field periods; these four do not represent them.
== H4/H5 own numpy implementation of MODEL.md vs model.golden (relativeTolerance 2e-06 )
  coils-off: checkpoints [250, 1000, 3000]; worst rel diff 2.38e-07; T range over run [0.655802, 1.000000] (T_t 0.01, T_ped 1.0); step 3000 peakTileC golden [1319.8, 1115.5, 1105.5, 1314.8] mine [1319.8, 1115.5, 1105.5, 1314.8]
  coils-D1-D3: checkpoints [250, 1000, 3000]; worst rel diff 3.75e-07; T range over run [0.655251, 1.000000] (T_t 0.01, T_ped 1.0); step 3000 peakTileC golden [575.4, 1114.7, 473.1, 1313.8] mine [575.4, 1114.7, 473.1, 1313.8]
  switch-at-1s: checkpoints [1000, 1500, 3000]; worst rel diff 7.34e-08; T range over run [0.657287, 1.000000] (T_t 0.01, T_ped 1.0); step 3000 peakTileC golden [594.8, 502.2, 497.8, 592.5] mine [594.8, 502.2, 497.8, 592.5]
  regime: tileLimit 1200.0; coils off @3 s [1319.8, 1115.5, 1105.5, 1314.8] -> above ['D1', 'D4'], below ['D2', 'D3']; all on @3 s [574.8, 485.5, 472.7, 572.8] -> all below: True
  stability number (own) 0.735497; reference model.check_stability 0.735497
  reference model.py from on-disk artifact, switch-at-1s step 1500: worst rel diff vs golden 7.34e-08
== H6 provenance kinds: derived / model verification not-applicable
  provenance details: Illustrative model, not a W7-X simulation: parameters chosen for illustration, not fitted to measurements, and not verified against measurements or a simulation of W7-X (none exist in this repo). Its only check is internal: the renderer's TypeScript port is checked against the golden checkpoints of this Python reference to relativeTolerance 2e-06.
  geometry source sha256 a811669f3eb50e2a7aa006afc591dc7d5b58d6b66b72ba2a5e5933088810fbf6
  manifest entry: [{'id': 'heatfield', 'path': 'heatfield.json', 'schema': 'heatfield.schema.json', 'sha256': 'a99249a2bec9aabd6043df3aaba3cadb734a7241bac2ba7e5b798f6e13d3c8f6'}]
EXIT=0
```
(Two lines shortened with "..." where the provenance text was printed in full; the numpy scalar reprs `np.float64(x)` of the
"mine" and "all on" lists are shown as plain numbers.) Exact artifact values at coils-off step 3000:
`peakTileC [1319.752, 1115.476, 1105.523, 1314.778]`; the artifact's limitations text reads "D1 1320 °C, D2 1115 °C, D3 1106 °C,
D4 1315 °C ... D1 575 °C, D2 486 °C, D3 473 °C, D4 573 °C", the same as MODEL.md's D-028 outcome line.

H8 mutation probe (isolated copy from `scripts/probe-copy.sh vf10-h8`, deleted afterwards; ANSI codes stripped):
```
copy: /home/qqbot/.cache/labyrinth-probes/vf10-h8
242:        const tp = (1 - w) * T[plus0[c]!]! + w * T[plus1[c]!]!; // 7
242:        const tp = w * T[plus0[c]!]! + (1 - w) * T[plus1[c]!]!; // 7
   × H8 the port reproduces every golden checkpoint of the Python reference to relativeTolerance 395ms
 FAIL  src/features/heatfield/model.test.ts > H8 the port reproduces every golden checkpoint of the Python reference to relativeTolerance
AssertionError: coils-off step 250 meanT: got 0.9629080662312696, golden 0.9650856: expected 0.0022563115320862956 to be less than or equal to 0.000002
      Tests  1 failed | 7 skipped (8)
mutation-1 vitest exit: 1
235:      tilesN[x] = tiles[x]! + (p.dt * (p.Tcool + 165 * loads[x]! - tiles[x]!)) / p.tauTile; // 11
   ✓ H8 the port reproduces every golden checkpoint of the Python reference to relativeTolerance 1164ms
   × H8 every input comes from the artifact: grid, |B|, ι, θ_d, φ_k and every parameter as written there 90ms
   × H8 model.ts holds no duplicated model constant: its only numeric literals are 0, 1, 2 and 0.5 3ms
      Tests  2 failed | 6 passed (8)
mutation-2 vitest exit: 1
copy removed: yes
```

Boundary rule and tree state:
```
$ wsl.exe -e bash scripts/dev.sh python3 scripts/check_boundaries.py
boundary: OK (204 files scanned)
EXIT=0
$ wsl.exe -e git status --short
$ wsl.exe -e git rev-parse --short HEAD
ca1871b
```

### Findings
No defect found. Notes, none blocking:
- Honesty: this task holds no PRD numbers. Every temperature, heat flux, tile temperature and prediction in the view carries the
  Model status; |B| carries Derived (VMEC), plus "Model (coil perturbation)" exactly while a coil is on (HeatFieldView.tsx:214-227,
  asserted on and off in the H10 H16 test). The "Illustrative model — not a W7-X simulation" and "Schematic diverter positions"
  callouts are at HeatFieldView.tsx:323 and :334; the GENE-X sentence is at ControlLoop.tsx:214. The tuned numbers MODEL.md and
  D-028 quote (1320 / 1115 / 1106 / 1315 °C off, 575 / 486 / 473 / 573 °C on, 0.7355) reproduce at printed precision.
- Weak spot (H11, minor): the slider test sets the value with `fireEvent.change` after focusing it
  (HeatFieldView.test.tsx:419-421); arrow-key stepping is not simulated (jsdom does not step range inputs). Keyboard operation
  rests on it being a native `type=range` in the tab order (HeatFieldView.tsx:469-478), which is acceptable.
- Weak spot (H8, minor): the literal scan in model.test.ts:79-89 only looks at model.ts; sim.ts, scene.ts and the view could hold
  their own copies of model constants. Spot check: the view's ρ_b subtitle is asserted to follow the artifact
  (HeatFieldView.test.tsx:391-399) and the golden test exercises model.ts only, so the H8 claim as written (the TypeScript model) holds.
- Observation (H9): the owner's colour words are met literally by the light theme (tokens.ts:243-244, yellow #fcdf00 to red
  #bc0013; green #00a676 to dark blue #1811a2). The dark theme's strongest-field stop is a mid blue #4766fe (tokens.ts:327), the
  darkest stop of that ramp; D-027 §7 leaves both themes to the design system.
- Not checked by eye: no browser screenshot was taken (the owner asked for lean checks); the 3D scene was checked through the
  real three.js geometry and materials in HeatScene.test.tsx with only WebGLRenderer replaced.

Verdict: PASS
