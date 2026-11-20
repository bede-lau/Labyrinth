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
import { deltaE2000, hexToLab, simulateLab, type CvdModel, type Deficiency, type Lab } from './color';
import { SERIES_IDS, THEMES, themes } from './tokens';

const CVD_MIN = 12;
const NORMAL_MIN = 20;
const TRITAN_MIN = 8;

type Condition = { name: string; lab: (hex: string) => Lab; min: number };

const conditions: Condition[] = [
  { name: 'normal vision', lab: hexToLab, min: NORMAL_MIN },
  ...(['protanopia', 'deuteranopia'] as Deficiency[]).flatMap((d) =>
    (['machado2009', 'vienot1999'] as CvdModel[]).map((m) => ({
      name: `${d} (${m})`,
      lab: (h: string) => simulateLab(h, d, m),
      min: CVD_MIN,
    })),
  ),
  { name: 'tritanopia (machado2009)', lab: (h: string) => simulateLab(h, 'tritanopia'), min: TRITAN_MIN },
];

function minPairwise(colors: Record<string, string>, lab: (h: string) => Lab) {
  const names = Object.keys(colors);
  let min = Infinity;
  let pair = '';
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i] as string;
      const b = names[j] as string;
      const d = deltaE2000(lab(colors[a] as string), lab(colors[b] as string));
      if (d < min) {
        min = d;
        pair = `${a}/${b}`;
      }
    }
  return { min, pair };
}

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
    const { min, pair } = minPairwise(series, c.lab);
    expect(min, `closest pair ${pair}: ΔE00 ${min.toFixed(1)} < ${c.min}`).toBeGreaterThanOrEqual(c.min);
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
