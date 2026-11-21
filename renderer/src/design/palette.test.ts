// @vitest-environment node
// D3: the series palette (stella / GENE / GX / bean / triangular) stays distinguishable under
// simulated protanopia and deuteranopia, and the |B| colormap stays ordered for every viewer.
//
// Thresholds (CIEDE2000, ΔE00):
//   - ≥ 12 between every pair of series under full-severity protanopia and deuteranopia, with BOTH
//     the Machado 2009 and the Viénot 1999 models. A ΔE00 near 1–2 is a just-noticeable difference
//     for large uniform patches; chart lines are thin, and the difference needed to tell two colours
//     apart grows as marks shrink (Szafir 2018, "Modeling Color Difference for Visualization
//     Design"). 12 is ~5× a patch JND: comfortably distinct at a glance for 1.5–2.25 px lines.
//     Severity 1.0 (complete dichromacy) is the worst case; anomalous trichromats see more.
//   - ≥ 20 in normal vision (the palette must not look like near-duplicates to anyone).
//   - Tritanopia (~0.01 % of people) is reported and held to a softer ≥ 8.
//   Colour is also never the only channel: every series has its own dash and marker (plotTheme).
// The gates and the measurement live in palette.ts so the gallery and DESIGN.md quote the same numbers.
import { contrastRatio, deltaE2000, hexToLab, simulateLab, type Lab } from './color';
import { PALETTE_CONDITIONS, PALETTE_GATES, minPairwiseDeltaE, seriesMinDeltaE } from './palette';
import { FORECAST_LABEL, FORECAST_LINES, forecastStyle, seriesStyle } from './plotTheme';
import { SERIES_IDS, THEMES, themes } from './tokens';

const CVD_MIN = PALETTE_GATES.cvd;
const NORMAL_MIN = PALETTE_GATES.normal;
const conditions = PALETTE_CONDITIONS;
const minPairwise = minPairwiseDeltaE;

describe('the gates are the documented ones', () => {
  test('12 for protanopia/deuteranopia, 20 for normal vision, 8 for tritanopia', () => {
    expect(PALETTE_GATES).toEqual({ cvd: 12, normal: 20, tritan: 8 });
  });
  test('six conditions: normal, protan and deutan under both models, tritan', () => {
    expect(conditions.map((c) => [c.name, c.min])).toEqual([
      ['normal vision', 20],
      ['protanopia (machado2009)', 12],
      ['protanopia (vienot1999)', 12],
      ['deuteranopia (machado2009)', 12],
      ['deuteranopia (vienot1999)', 12],
      ['tritanopia (machado2009)', 8],
    ]);
  });
});

describe('the distinguishability check can fail (negative control)', () => {
  test('a red/green/orange palette passes normal vision but fails deuteranopia', () => {
    const bad = { a: '#d62728', b: '#2ca02c', c: '#ff7f0e' };
    expect(minPairwise(bad, hexToLab).min).toBeGreaterThan(NORMAL_MIN);
    expect(minPairwise(bad, (h) => simulateLab(h, 'deuteranopia')).min).toBeLessThan(CVD_MIN);
  });
});

describe.each(THEMES)('series palette — %s theme', (theme) => {
  const series = themes[theme].series;
  test('has exactly the five series', () => {
    expect(Object.keys(series).sort()).toEqual([...SERIES_IDS].sort());
  });
  test.each(conditions.map((c) => [c.name, c] as const))('pairwise ΔE00 under %s', (_n, c) => {
    const { min, pair } = minPairwise(series, c.toLab);
    expect(min, `closest pair ${pair}: ΔE00 ${min.toFixed(1)} < ${c.min}`).toBeGreaterThanOrEqual(c.min);
  });
  test('seriesMinDeltaE reports the worst model for each kind of vision', () => {
    for (const vision of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const) {
      const worst = Math.min(...conditions.filter((c) => c.vision === vision).map((c) => minPairwise(series, c.toLab).min));
      expect(seriesMinDeltaE(theme, vision)).toBe(worst);
    }
  });
});

// D-026: the forecast chart draws two lines, Predicted and Actual. Actual is the archived stella
// trace and keeps stella's colour; Predicted has its own token. The pair is held to the series gates.
describe.each(THEMES)('D6 forecast lines Predicted / Actual (D-026) — %s theme', (theme) => {
  const t = themes[theme];
  const pair = { predicted: forecastStyle('predicted', theme).line.color, actual: forecastStyle('actual', theme).line.color };
  test('two lines, named as the owner wrote them; Actual is the stella colour, Predicted its own token', () => {
    expect([...FORECAST_LINES]).toEqual(['predicted', 'actual']);
    expect(FORECAST_LINES.map((l) => forecastStyle(l, theme).name)).toEqual(['Predicted', 'Actual']);
    expect(FORECAST_LABEL).toEqual({ predicted: 'Predicted', actual: 'Actual' });
    expect(pair.actual).toBe(t.series.stella);
    expect(pair.predicted).toBe(t.plot.predicted);
    expect(Object.values(t.series)).not.toContain(t.plot.predicted);
  });
  test.each(conditions.map((c) => [c.name, c] as const))('ΔE00 between the two under %s meets the series gate (and the 40 DESIGN.md §6 quotes)', (_n, c) => {
    const { min } = minPairwise(pair, c.toLab);
    expect(min).toBeGreaterThanOrEqual(c.min);
    expect(min).toBeGreaterThan(40);
  });
  test('both at least 3:1 on the plot; never colour alone: they differ in dash and in marker', () => {
    for (const c of Object.values(pair)) expect(contrastRatio(c, t.plot.plot)).toBeGreaterThanOrEqual(3);
    const p = forecastStyle('predicted', theme);
    const a = forecastStyle('actual', theme);
    expect(p.line.dash).not.toBe(a.line.dash);
    expect(p.marker.symbol).not.toBe(a.marker.symbol);
    // Actual draws like stella; Predicted's marker is one no series uses.
    expect([a.line.dash, a.marker.symbol]).toEqual([seriesStyle('stella', theme).line.dash, seriesStyle('stella', theme).marker.symbol]);
    expect(SERIES_IDS.map((s) => seriesStyle(s, theme).marker.symbol)).not.toContain(p.marker.symbol);
  });
});

describe.each(THEMES)('|B| colormap — %s theme', (theme) => {
  const stops = themes[theme].scene.bmag;
  const views: { name: string; lab: (h: string) => Lab; minStep: number }[] = [
    { name: 'normal vision', lab: hexToLab, minStep: 8 },
    { name: 'protanopia', lab: (h) => simulateLab(h, 'protanopia'), minStep: 2.5 },
    { name: 'deuteranopia', lab: (h) => simulateLab(h, 'deuteranopia'), minStep: 2.5 },
    { name: 'protanopia (vienot1999)', lab: (h) => simulateLab(h, 'protanopia', 'vienot1999'), minStep: 2.5 },
    { name: 'deuteranopia (vienot1999)', lab: (h) => simulateLab(h, 'deuteranopia', 'vienot1999'), minStep: 2.5 },
  ];

  test('has at least 7 stops', () => expect(stops.length).toBeGreaterThanOrEqual(7));

  test.each(views.map((v) => [v.name, v] as const))(
    'lightness strictly increases and every step is visible under %s',
    (_n, v) => {
      const labs = stops.map(v.lab);
      for (let i = 1; i < labs.length; i++) {
        const prev = labs[i - 1] as Lab;
        const cur = labs[i] as Lab;
        expect(cur[0], `L* step ${i}`).toBeGreaterThan(prev[0]);
        expect(deltaE2000(prev, cur), `ΔE00 step ${i}`).toBeGreaterThanOrEqual(v.minStep);
      }
      // Ends are far apart for everyone: the full range of |B| is readable.
      expect(deltaE2000(labs[0] as Lab, labs[labs.length - 1] as Lab)).toBeGreaterThan(45);
    },
  );

  test('perceptually uniform in normal vision: step sizes vary by < 20 % (coefficient of variation)', () => {
    const labs = stops.map(hexToLab);
    const steps = labs.slice(1).map((l, i) => deltaE2000(labs[i] as Lab, l));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    const sd = Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length);
    expect(sd / mean).toBeLessThan(0.2);
  });
});
