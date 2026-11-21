// @vitest-environment node
// D6 (owner requirement 2026-11-21, D-027): the Heat & field colormaps and the diverter colour.
//
//  - Temperature: yellow = coldest -> orange -> red = hottest. |B| in Heat & field: green = weakest ->
//    dark blue = strongest. Those are the owner's words; the hue of each end is checked.
//  - Both: lightness falls monotonically along the ramp (coldest / weakest lightest) for every viewer,
//    every step is visible and the steps are even.
//  - |B| (field) also colours field lines, so every stop is ≥ 3:1 on the scene background (a line or a
//    cell never vanishes into it; contrast.test.ts holds the same pairs).
//  - Temperature (heat) only fills (the LCFS, cross-section cells), and its cold end is the owner's
//    yellow, which no light background can hold to 3:1. Instead every stop stands ≥ 20 ΔE00 off the
//    scene background for every viewer (it reads as a colour, never as the background), and the fill
//    is outlined in `sceneTheme().outline` (≥ 3:1 on the background, WCAG 1.4.11; contrast.test.ts).
//  - The |B| ramp stays apart from the temperature ramp (the surface toggles between the two in one
//    view) and from the |B| ramp of Locate the tubes (`scene.bmag`, which does not change: same
//    quantity, opposite direction), in normal vision and under simulated protanopia and deuteranopia
//    (Machado 2009 and Viénot 1999). The temperature ramp stays apart from `scene.bmag` in normal
//    vision (both have a yellow end). Gates and measurement: palette.ts; reasons: DESIGN.md §7.
//  - The diverter plate is near-black, and visible on every ground it can sit on.
// Thresholds are ΔE00 (CIEDE2000), as in palette.test.ts.
import { contrastRatio, deltaE2000, hexToLab, hexToRgb, relativeLuminance, simulateLab, type Lab } from './color';
import {
  PALETTE_CONDITIONS,
  PALETTE_GATES,
  RAMP_CONDITIONS,
  RAMP_SEPARATION_GATES,
  RAMP_SEPARATION_VIEWERS,
  rampPairConditions,
  rampPairSeparation,
  rampSamples,
  rampSeparation,
  type RampPair,
} from './palette';
import {
  bmagGradientCss,
  fieldColor,
  fieldGradientCss,
  heatColor,
  heatGradientCss,
  normalizeBmag,
  normalizeRange,
  sceneTheme,
} from './sceneTheme';
import { THEMES, themeCssVars, themes, type ThemeName } from './tokens';

const RAMPS = ['heat', 'field'] as const;
type NewRamp = (typeof RAMPS)[number];
const stopsOf = (ramp: NewRamp, theme: ThemeName) => themes[theme].scene[ramp];

/** CIELAB hue angle in degrees, [0, 360). */
const hue = (hex: string) => {
  const [, a, b] = hexToLab(hex);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};

const views: { name: string; lab: (h: string) => Lab; minStep: number; minEnds: number }[] = [
  { name: 'normal vision', lab: hexToLab, minStep: 4.5, minEnds: 40 },
  { name: 'protanopia (machado2009)', lab: (h) => simulateLab(h, 'protanopia'), minStep: 2.5, minEnds: 20 },
  { name: 'deuteranopia (machado2009)', lab: (h) => simulateLab(h, 'deuteranopia'), minStep: 2.5, minEnds: 20 },
  { name: 'protanopia (vienot1999)', lab: (h) => simulateLab(h, 'protanopia', 'vienot1999'), minStep: 2.5, minEnds: 20 },
  { name: 'deuteranopia (vienot1999)', lab: (h) => simulateLab(h, 'deuteranopia', 'vienot1999'), minStep: 2.5, minEnds: 20 },
];

describe('D6 the |B| ramp of Locate the tubes is unchanged', () => {
  // The owner's new ramp is an addition: Locate the tubes keeps its own (navy = weak -> ochre = strong).
  test('scene.bmag keeps its stops in both themes', () => {
    expect(themes.light.scene.bmag).toEqual(['#182b58', '#003d63', '#004f67', '#006064', '#006f5a', '#2f7b4a', '#608338', '#888528', '#b28a29']);
    expect(themes.dark.scene.bmag).toEqual(['#546b9d', '#4980ab', '#4095b1', '#42aab0', '#58bcaa', '#7ccba0', '#a7d895', '#d3e18e', '#ffe891']);
  });
});

describe.each(THEMES)('D6 the owner’s colours — %s theme', (theme) => {
  test('D6 temperature: yellow at the cold end, red at the hot end, through orange (hue falls stop by stop)', () => {
    const s = stopsOf('heat', theme);
    expect(hue(s[0] as string), 'coldest is yellow').toBeGreaterThanOrEqual(65);
    expect(hue(s[0] as string), 'coldest is yellow').toBeLessThanOrEqual(105);
    expect(hue(s.at(-1) as string), 'hottest is red').toBeGreaterThanOrEqual(15);
    expect(hue(s.at(-1) as string), 'hottest is red').toBeLessThanOrEqual(45);
    for (let i = 1; i < s.length; i++) expect(hue(s[i] as string), `stop ${i}`).toBeLessThan(hue(s[i - 1] as string));
  });
  test('D6 |B|: green at the weak end, blue at the strong end (hue rises stop by stop)', () => {
    const s = stopsOf('field', theme);
    expect(hue(s[0] as string), 'weakest is green').toBeGreaterThanOrEqual(130);
    expect(hue(s[0] as string), 'weakest is green').toBeLessThanOrEqual(180);
    expect(hue(s.at(-1) as string), 'strongest is blue').toBeGreaterThanOrEqual(265);
    expect(hue(s.at(-1) as string), 'strongest is blue').toBeLessThanOrEqual(312);
    for (let i = 1; i < s.length; i++) expect(hue(s[i] as string), `stop ${i}`).toBeGreaterThan(hue(s[i - 1] as string));
  });
});

describe.each(THEMES.flatMap((theme) => RAMPS.map((ramp) => [ramp, theme] as const)))('D6 %s ramp — %s theme', (ramp, theme) => {
  const stops = stopsOf(ramp, theme);
  test('D6 has at least 7 stops, the same number in both themes', () => {
    expect(stops.length).toBeGreaterThanOrEqual(7);
    expect(stops.length).toBe(stopsOf(ramp, theme === 'light' ? 'dark' : 'light').length);
  });
  test.each(views.map((v) => [v.name, v] as const))(
    'D6 lightness falls stop by stop (coldest / weakest lightest) and every step is visible under %s',
    (_n, v) => {
      const labs = stops.map(v.lab);
      for (let i = 1; i < labs.length; i++) {
        expect((labs[i] as Lab)[0], `L* step ${i}`).toBeLessThan((labs[i - 1] as Lab)[0]);
        expect(deltaE2000(labs[i - 1] as Lab, labs[i] as Lab), `ΔE00 step ${i}`).toBeGreaterThanOrEqual(v.minStep);
      }
      expect(deltaE2000(labs[0] as Lab, labs.at(-1) as Lab), 'ends').toBeGreaterThanOrEqual(v.minEnds);
    },
  );
  test('D6 even steps in normal vision: step sizes vary by < 20 % (coefficient of variation)', () => {
    const labs = stops.map(hexToLab);
    const steps = labs.slice(1).map((l, i) => deltaE2000(labs[i] as Lab, l));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    const sd = Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length);
    expect(sd / mean).toBeLessThan(0.2);
  });
  if (ramp === 'field')
    test('D6 every stop is at least 3:1 on the scene background (it colours field lines too)', () => {
      for (const [i, s] of stops.entries()) expect(contrastRatio(s, themes[theme].scene.background), `stop ${i} ${s}`).toBeGreaterThanOrEqual(3);
    });
  else
    test.each(views.map((v) => [v.name, v] as const))(
      'D6 a fill: every stop stands at least 20 ΔE00 (the series gate) off the scene background under %s',
      (_n, v) => {
        const bg = v.lab(themes[theme].scene.background);
        for (const [i, s] of stops.entries())
          expect(deltaE2000(v.lab(s), bg), `stop ${i} ${s}`).toBeGreaterThanOrEqual(PALETTE_GATES.normal);
      },
    );
});

describe.each(THEMES)('D6 the temperature fill is outlined — %s theme', (theme) => {
  const sc = themes[theme].scene;
  test('D6 the outline is scene.boundary and at least 3:1 on the scene background', () => {
    expect(sceneTheme(theme).outline).toBe(sc.boundary);
    expect(contrastRatio(sceneTheme(theme).outline, sc.background)).toBeGreaterThanOrEqual(3);
  });
  test('D6 the hot end stays at least 3:1 on the scene background (where the heat is, the fill holds its own edge)', () => {
    expect(contrastRatio(sc.heat.at(-1) as string, sc.background)).toBeGreaterThanOrEqual(3);
  });
});

test('D6 why the outline is needed: the owner’s yellow cannot be 3:1 on the light scene, and the old 3:1 ramp read brown (DZ-1)', () => {
  // The cold end is a true yellow (L* > 85), far below 3:1 on white …
  expect(hexToLab(themes.light.scene.heat[0] as string)[0]).toBeGreaterThan(85);
  expect(contrastRatio(themes.light.scene.heat[0] as string, themes.light.scene.background)).toBeLessThan(1.5);
  // … while the ramp that held every stop to 3:1 on white started at a dark mustard (L* ≈ 60) and spanned
  // only about 28 L*: ochre -> brick -> maroon, no visible yellow or orange.
  const old = ['#b68b05', '#b67e03', '#b47104', '#b26302', '#af5505', '#ab4702', '#a63703', '#a32001', '#9b020e'];
  expect(old.every((s) => contrastRatio(s, '#ffffff') >= 3)).toBe(true);
  expect(hexToLab(old[0] as string)[0]).toBeLessThan(61);
  expect(hexToLab(old[0] as string)[0] - hexToLab(old.at(-1) as string)[0]).toBeLessThan(30);
  const span = (s: readonly string[]) => hexToLab(s[0] as string)[0] - hexToLab(s.at(-1) as string)[0];
  expect(span(themes.light.scene.heat)).toBeGreaterThan(45);
});

describe('D6 the ramps stay apart (closest approach, ΔE00)', () => {
  test('the gates are the documented ones: 12 for field/heat (one view), 8 for field/|B| and temperature/|B| of Locate the tubes', () => {
    expect(RAMP_SEPARATION_GATES).toEqual({ 'field/heat': 12, 'field/bmag': 8, 'heat/bmag': 8 });
  });
  const pairs = Object.keys(RAMP_SEPARATION_GATES) as RampPair[];
  const conditions = PALETTE_CONDITIONS.filter((c) => c.vision !== 'tritanopia');
  test('the conditions are normal vision and protanopia / deuteranopia under both models', () => {
    expect(conditions.map((c) => c.name)).toEqual([
      'normal vision',
      'protanopia (machado2009)',
      'protanopia (vienot1999)',
      'deuteranopia (machado2009)',
      'deuteranopia (vienot1999)',
    ]);
    expect(RAMP_CONDITIONS).toEqual(conditions);
  });
  test('field/heat and field/bmag hold for every viewer; heat/bmag (never in one view) in normal vision only, as DESIGN.md §7 says', () => {
    expect(RAMP_SEPARATION_VIEWERS).toEqual({ 'field/heat': 'all', 'field/bmag': 'all', 'heat/bmag': 'normal' });
    expect(rampPairConditions('field/heat')).toEqual(conditions);
    expect(rampPairConditions('field/bmag')).toEqual(conditions);
    expect(rampPairConditions('heat/bmag').map((c) => c.name)).toEqual(['normal vision']);
  });
  describe.each(THEMES.flatMap((theme) => pairs.map((pair) => [pair, theme] as const)))('D6 %s — %s theme', (pair, theme) => {
    const [a, b] = pair.split('/') as ['heat' | 'field' | 'bmag', 'heat' | 'field' | 'bmag'];
    test.each(rampPairConditions(pair).map((c) => [c.name, c] as const))('under %s', (_n, c) => {
      const d = rampSeparation(rampSamples(a, theme), rampSamples(b, theme), c.toLab);
      expect(d, `${pair} comes within ΔE00 ${d.toFixed(1)}`).toBeGreaterThanOrEqual(RAMP_SEPARATION_GATES[pair]);
    });
    test('rampPairSeparation is the worst of those conditions', () => {
      const worst = Math.min(...rampPairConditions(pair).map((c) => rampSeparation(rampSamples(a, theme), rampSamples(b, theme), c.toLab)));
      expect(rampPairSeparation(pair, theme)).toBe(worst);
    });
    test('rampPairSeparation over every condition equals rampSeparation’s default', () => {
      expect(rampPairSeparation(pair, theme, RAMP_CONDITIONS)).toBe(rampSeparation(rampSamples(a, theme), rampSamples(b, theme)));
    });
  });
  test('heat/bmag: the yellow ends are far apart in every viewer’s eyes (coldest in one view, strongest in the other; DZ-7)', () => {
    for (const theme of THEMES) {
      const sc = themes[theme].scene;
      for (const c of conditions)
        expect(deltaE2000(c.toLab(sc.heat[0] as string), c.toLab(sc.bmag.at(-1) as string)), `${theme} ${c.name}`).toBeGreaterThanOrEqual(
          RAMP_SEPARATION_GATES['heat/bmag'],
        );
    }
  });
  test('samples follow the lookups: the ends are the stops, 41 samples by default', () => {
    for (const theme of THEMES) {
      const s = rampSamples('field', theme);
      expect(s).toHaveLength(41);
      expect(s[0]).toBe(themes[theme].scene.field[0]);
      expect(s.at(-1)).toBe(themes[theme].scene.field.at(-1));
    }
  });
});

describe('D6 the separation check can fail (negative controls)', () => {
  test('the obvious field ramp, green -> navy through teal, nearly retraces |B| of Locate the tubes', () => {
    const naive = ['#45b164', '#04a376', '#05917f', '#078080', '#05707d', '#036079', '#005076', '#013e77', '#132282'];
    // DESIGN.md §7 quotes this: within 4 ΔE00.
    expect(rampSeparation(naive, rampSamples('bmag', 'light'))).toBeLessThan(4);
  });
  test('a yellower green end passes beside the heat ramp in normal vision but fails under protanopia', () => {
    // A lime end (#b4ff90): about 24 ΔE00 from the temperature ramp in normal vision, under 10 under protanopia.
    const greener = ['#b4ff90', '#45f6d0', '#1fe8e1', '#29d8ec', '#13c6f5', '#1db2fd', '#409bfe', '#467ffe', '#5163fe'];
    const heat = rampSamples('heat', 'dark');
    expect(rampSeparation(greener, heat, hexToLab)).toBeGreaterThanOrEqual(RAMP_SEPARATION_GATES['field/heat']);
    expect(rampSeparation(greener, heat, (h) => simulateLab(h, 'protanopia', 'vienot1999'))).toBeLessThan(RAMP_SEPARATION_GATES['field/heat']);
  });
  test('the heat/bmag gate fails the ramp that held every stop to 3:1 on white: its mustard cold end was Locate the tubes’ ochre (DZ-7)', () => {
    const old = ['#b68b05', '#b67e03', '#b47104', '#b26302', '#af5505', '#ab4702', '#a63703', '#a32001', '#9b020e'];
    expect(rampSeparation(old, rampSamples('bmag', 'light'), hexToLab)).toBeLessThan(RAMP_SEPARATION_GATES['heat/bmag']);
    expect(deltaE2000(hexToLab(old[0] as string), hexToLab(themes.light.scene.bmag.at(-1) as string))).toBeLessThan(4);
  });
});

describe('D6 lookups and colour-bar helpers', () => {
  test.each(THEMES)('%s: heatColor / fieldColor hit the stops at the ends, interpolate between, clamp, and read NaN as 0', (theme) => {
    for (const [lookup, stops] of [
      [heatColor, themes[theme].scene.heat],
      [fieldColor, themes[theme].scene.field],
    ] as const) {
      expect(lookup(0, theme)).toEqual(hexToRgb(stops[0] as string));
      expect(lookup(1, theme)).toEqual(hexToRgb(stops.at(-1) as string));
      expect(lookup(-2, theme)).toEqual(lookup(0, theme));
      expect(lookup(7, theme)).toEqual(lookup(1, theme));
      expect(lookup(Number.NaN, theme)).toEqual(lookup(0, theme));
      // Halfway between stops 0 and 1 is the sRGB midpoint of the two.
      const half = lookup(0.5 / (stops.length - 1), theme);
      const [a, b] = [hexToRgb(stops[0] as string), hexToRgb(stops[1] as string)];
      half.forEach((c, i) => expect(c).toBeCloseTo(((a[i] as number) + (b[i] as number)) / 2, 10));
    }
  });
  test('normalizeRange maps [lo, hi] onto [0, 1], does not clamp, and is 0.5 on an empty range; normalizeBmag is the same', () => {
    expect(normalizeRange(0.01, [0.01, 1])).toBe(0);
    expect(normalizeRange(1, [0.01, 1])).toBe(1);
    expect(normalizeRange(0.505, [0.01, 1])).toBeCloseTo(0.5, 12);
    expect(normalizeRange(2, [0, 1])).toBe(2);
    expect(normalizeRange(3, [3, 3])).toBe(0.5);
    expect(normalizeBmag(1.5, [1, 2])).toBe(normalizeRange(1.5, [1, 2]));
  });
  test.each(THEMES)('%s: the gradients run over the token custom properties, cold / weak first', (theme) => {
    const vars = themeCssVars(theme);
    for (const [css, name, stops] of [
      [heatGradientCss(theme), 'heat', themes[theme].scene.heat],
      [fieldGradientCss(theme), 'field', themes[theme].scene.field],
      [bmagGradientCss(theme), 'bmag', themes[theme].scene.bmag],
    ] as const) {
      const used = [...css.matchAll(/var\((--lab-[\w-]+)\) ([\d.]+)%/g)].map((m) => [m[1] as string, Number(m[2])] as const);
      expect(used.map(([p]) => p)).toEqual(stops.map((_, i) => `--lab-${name}-${i}`));
      expect(used.map(([p]) => vars[p])).toEqual([...stops]);
      expect(used[0]?.[1]).toBe(0);
      expect(used.at(-1)?.[1]).toBe(100);
      expect(css.startsWith('linear-gradient(to right, ')).toBe(true);
    }
    expect(heatGradientCss(theme, 'to top').startsWith('linear-gradient(to top, var(--lab-heat-0) 0.0%')).toBe(true);
  });
  test.each(THEMES)('%s: sceneTheme exposes both ramps and the diverter from the tokens', (theme) => {
    const st = sceneTheme(theme);
    const sc = themes[theme].scene;
    expect(st.heat).toEqual(sc.heat);
    expect(st.outline).toBe(sc.boundary);
    expect(st.field).toEqual(sc.field);
    expect(st.bmag).toEqual(sc.bmag);
    expect(st.diverter).toEqual({ fill: sc.diverterFill, edge: sc.diverterEdge });
  });
});

describe.each(THEMES)('D6 the diverter plate — %s theme', (theme) => {
  const sc = themes[theme].scene;
  const { fill, edge } = sceneTheme(theme).diverter;
  test('D6 black, as the owner drew it: a near-black fill', () => {
    expect(relativeLuminance(fill)).toBeLessThan(0.01);
    const [r, g, b] = hexToRgb(fill);
    expect(Math.max(r, g, b) - Math.min(r, g, b), 'neutral').toBeLessThan(0.04);
  });
  test('D6 its edge reads as an outline round the fill (≥ 3:1)', () => {
    expect(contrastRatio(edge, fill)).toBeGreaterThanOrEqual(3);
  });
  test('D6 visible on every ground it can sit on: the scene, the surface fill and every temperature and |B| colour', () => {
    const grounds: [string, string][] = [
      ['scene background', sc.background],
      ['surface fill', sc.surfaceFill],
      ...sc.heat.map((c, i): [string, string] => [`heat stop ${i}`, c]),
      ...sc.field.map((c, i): [string, string] => [`field stop ${i}`, c]),
    ];
    for (const [name, g] of grounds)
      expect(Math.max(contrastRatio(fill, g), contrastRatio(edge, g)), `${name} ${g}`).toBeGreaterThanOrEqual(3);
  });
});

test('D6 why the diverter needs its edge: on the dark scene the black fill alone is invisible', () => {
  expect(contrastRatio(themes.dark.scene.diverterFill, themes.dark.scene.background)).toBeLessThan(1.5);
  expect(contrastRatio(themes.dark.scene.diverterEdge, themes.dark.scene.background)).toBeGreaterThanOrEqual(3);
});
