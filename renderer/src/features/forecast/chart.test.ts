// @vitest-environment node
// F7 (D-026): the Plotly spec of the predicted vs actual chart, without Plotly or the DOM.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORECAST_LINES, THEMES, forecastStyle, themes } from '../../design';
import { fluxRange, forecastChartSpec, spokenCaption } from './chart';
import { FLUX_UNIT, FORECASTERS, INITIAL, advance, type ForecastArtifact } from './model';

const ARTIFACT: ForecastArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/forecast.json'), 'utf8'));
const N = ARTIFACT.steps.length;
type Marker = { color: string; symbol: string; size: number[]; line: { width: number[] } };

test.each(THEMES)('F7 forecastChartSpec (%s): two traces named Predicted and Actual in the forecast styles, axes with units, a legend', (theme) => {
  const spec = forecastChartSpec(ARTIFACT, INITIAL, 'persistence', theme);
  expect(spec.data.map((d) => d.name)).toEqual(['Predicted', 'Actual']);
  FORECAST_LINES.forEach((line, i) => {
    const style = forecastStyle(line, theme);
    const trace = spec.data[i]!;
    expect(trace).toMatchObject({ type: 'scatter', mode: 'lines+markers', name: style.name, line: style.line, connectgaps: false, showlegend: true });
    const marker = trace.marker as Marker;
    expect([marker.color, marker.symbol]).toEqual([style.marker.color, style.marker.symbol]);
  });
  expect(spec.layout.xaxis.title?.text).toBe('Time t (a/v<sub>th,i</sub>)');
  expect(spec.layout.yaxis.title?.text).toBe('Ion heat flux Q<sub>i</sub> (Q<sub>gB,i</sub>)');
  expect(spec.layout.xaxis.range).toEqual([1500, 1900]);
  expect(spec.layout.showlegend).toBe(true);
  // Themed by the design system (no colours of its own).
  expect(spec.layout.paper_bgcolor).toBe(themes[theme].plot.paper);
});

test('F7 the spec carries only drawn values: no undrawn forecast or observation in the data, axes, shapes, annotations or hover text', () => {
  let s = INITIAL;
  for (let k = 0; k <= 3 * N; k++, s = advance(s, N)) {
    for (const f of FORECASTERS) {
      const spec = forecastChartSpec(ARTIFACT, s, f, 'light');
      const drawn = new Set(spec.data.flatMap((d) => (d.y as (number | null)[]).filter((v): v is number => v !== null)));
      const json = JSON.stringify([spec.data, spec.layout]);
      for (const st of ARTIFACT.steps)
        for (const v of [st.observed, st.persistence, st.frozen]) if (!drawn.has(v)) expect(json, `state ${s.index}/${s.phase}, ${f}`).not.toContain(String(v));
      // The flux axis is set from the drawn values only; the empty-state note only while nothing is drawn.
      expect(spec.layout.yaxis.range).toEqual(fluxRange([...drawn]));
      expect(spec.layout.annotations ?? []).toHaveLength(drawn.size === 0 ? 1 : 0);
      // Hover text names the line and the window, and reads the value from the drawn point.
      expect(spec.data[0]!.hovertemplate).toBe(`Predicted (${f} forecast), t %{customdata}: %{y:.3f}<extra></extra>`);
      expect(spec.data[1]!.hovertemplate).toBe('Actual (archived observed window mean), t %{customdata}: %{y:.3f}<extra></extra>');
      // One marker per drawn window, at its midpoint (no marker outline where there is no marker); a line
      // with nothing drawn is a single null point that keeps it, with its marker, in the legend.
      for (const d of spec.data) {
        const m = d.marker as Marker;
        const x = d.x as (number | null)[];
        const shown = x.filter((v) => v !== null).length;
        if (shown === 0) expect([x, d.y]).toEqual([[null], [null]]);
        expect(m.size.filter((v, i) => v > 0 && x[i] !== null).length * 3).toBe(shown);
        expect(m.line.width.map((w) => w > 0)).toEqual(m.size.map((v) => v > 0));
        expect(m).toMatchObject({ opacity: 1 });
      }
    }
  }
});

test('F7 fluxRange brackets the drawn values with room above for the window label, at least 0.1 wide; [0, 1] when nothing is drawn', () => {
  expect(fluxRange([])).toEqual([0, 1]);
  const one = fluxRange([2.2]);
  expect(one[0]).toBeCloseTo(2.14, 12);
  expect(one[1]).toBeCloseTo(2.275, 12);
  const wide = fluxRange([2.4, 2.0, 2.2]);
  expect(wide[0]).toBeCloseTo(1.96, 12);
  expect(wide[1]).toBeCloseTo(2.5, 12);
  // More room above the highest value than below the lowest: the "current window" label sits at the top.
  expect(wide[1] - 2.4).toBeGreaterThan(2.0 - wide[0]);
});

test('F7 the current window is shaded until the replay is complete; the label and summary name the forecaster drawn as Predicted', () => {
  const start = forecastChartSpec(ARTIFACT, INITIAL, 'frozen', 'dark');
  expect(start.layout.shapes).toHaveLength(1);
  expect(start.layout.shapes![0]).toMatchObject({ x0: 1500, x1: 1550, yref: 'paper' });
  expect(start.label).toMatch(/Predicted \(frozen forecast\) and Actual \(archived observed window mean\)/);
  expect(start.summary).toBe(
    'Nothing plotted yet. Predicted (frozen forecast) appears for a window after Predict, Actual (archived observed window mean) ' +
      'after Reveal; Run to end does both for all 8 windows from 1500–1900, in that order.',
  );
  expect(start.layout.annotations!.map((x) => x.text)).toEqual([
    'Nothing plotted yet: Predict draws the first forecast,<br>Run to end draws all windows',
  ]);
  let s = INITIAL;
  for (let k = 0; k < 3 * N; k++) s = advance(s, N);
  const end = forecastChartSpec(ARTIFACT, s, 'persistence', 'light');
  expect(end.layout.shapes).toEqual([]);
  expect(end.summary).toMatch(/^Predicted \(persistence forecast\), 8 of 8 windows: 1500–1550 2\.230, .*Actual \(archived observed window mean\), 8 of 8 windows: 1500–1550 2\.216, .*1850–1900 2\.213\. Heat flux in Q gB,i\.$/);
});

test('F7 the accessible name and the visible caption speak the units as words ("Q gB,i"), never raw "_" markup', () => {
  expect(forecastChartSpec(ARTIFACT, INITIAL, 'persistence', 'light').label).toBe(
    'Chart: ion heat flux Q i in Q gB,i against time t in a/v th,i, 1500–1900, Predicted (persistence forecast) and Actual ' +
      '(archived observed window mean) for the stella bean trace, each held over its 50-unit window',
  );
  let s = INITIAL;
  for (let k = 0; k <= 3 * N; k++, s = advance(s, N)) {
    for (const f of FORECASTERS) {
      const spec = forecastChartSpec(ARTIFACT, s, f, 'light');
      expect(spec.label, `label in state ${s.index}/${s.phase}`).not.toMatch(/[_{}]/);
      expect(spec.summary, `summary in state ${s.index}/${s.phase}`).not.toMatch(/[_{}]/);
    }
  }
  expect(forecastChartSpec(ARTIFACT, s, 'persistence', 'light').summary).toMatch(/ Heat flux in Q gB,i\.$/);
});

test('F7 (DZ3-8) the visible caption carries the flux unit as a unit to typeset, and spoken it is exactly the summary', () => {
  let s = INITIAL;
  for (let k = 0; k <= 3 * N; k++, s = advance(s, N)) {
    for (const f of FORECASTERS) {
      const spec = forecastChartSpec(ARTIFACT, s, f, 'light');
      const tag = `state ${s.index}/${s.phase}, ${f}`;
      // Spoken (each unit as words) the caption is the summary, the figure's accessible description.
      expect(spokenCaption(spec.caption), tag).toBe(spec.summary);
      // Its text runs never spell a unit out: no spoken "Q gB,i" and no raw "_" markup (FC-R5).
      const text = spec.caption.filter((p): p is string => typeof p === 'string').join('');
      expect(text, tag).not.toMatch(/Q gB|[_{}]/);
      const units = spec.caption.filter((p) => typeof p !== 'string');
      if (k === 0) {
        expect(units, tag).toEqual([]);
      } else {
        expect(units, tag).toEqual([{ unit: FLUX_UNIT }]);
        expect(spec.caption.slice(-2), tag).toEqual([{ unit: FLUX_UNIT }, '.']);
        expect(spec.caption.at(-3), tag).toMatch(/ Heat flux in $/);
      }
    }
  }
});
