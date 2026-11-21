# Owner requirement, 2026-11-21

Source: the owner's Word document "Black colour straight lines are diverters.docx" (four handwritten pages and two
typed paragraphs), received 2026-11-21. The pages are kept here unchanged; the text below is a transcription.
Decisions D-026 (forecast) and D-027 (heat and field model) record how Labyrinth implements it.

## Typed text

> Black colour straight lines are diverters, this is a top down view of the W7x. red colour boxes are cross
> sectional slices that should be displayed on a separated display. The red orange yellow are meant to reflect
> temperature of heat map.

> Replace the current graph on the forecast replay tab with this graph of predicted heat flux and actual heat flux
> (2 lines) against time.

## Page 1 — `1-control-loop.jpg`

A loop of four steps: 1. Existing heat flux map → 2. Parallelism predicts future heat flux movements (spatial) →
3. Change magnetic field to alter plasma movement → 4. New heat flux map created → back to 1.

## Page 2 — `2-top-view-diverters.jpg`

Top-down sketch of the W7-X torus: four black straight lines across the torus (the diverters), red, orange and
yellow strokes for the temperature heat map, and a ticked checkbox "magnetic field".
"Problem: Showing magnetic field but not showing the effect of it."
"Feature: Dynamic magnetic field graph with respect to time + snapshot frozen."

## Page 3 — `3-interactive-model-notes.jpg`

3D interactive model:
- Heat map to be added with colour coding from red to yellow: red hottest, yellow coldest.
- When the mouse hovers over a region, a text box shows temperature and magnetic field strength.
- Cross section on the side showing the heatmap, with a slider of angle control to check each slice of the torus
  shape's temperature and magnetic field.
- Add diverters, and the magnetic field controls plasma movement to the diverters; show a side panel of diverter
  temperatures. 4 diverters, at 0 rad, π/2 rad, π rad, 3π/2 rad.
- Toggle on and off magnetic field adjustment buttons and show how the heat flow is moving.
- Magnetic field strength against angle graph plotted, which changes with time — an actually moving graph that is
  linked to the 3D model.
- Magnetic flux to be colour coded: dark blue strongest, green weakest.
- Display varying magnetic field strength with colour changing on the 3D model.

Display the equation used to predict heat flux movements.

## Page 4 — `4-forecast-predicted-vs-actual.jpg`

"Tab 2. Predicted heat flux vs actual heat flux." A sketch of a heat flux against time graph with two lines
(legend: predicted, actual). "Show MSE, and range of MSE (mean square error). Give range of errors against
predicted and actual heat flux difference."
