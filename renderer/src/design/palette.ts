// Series-palette and colormap gates and the measurements they are applied to. One definition, shared
// by palette.test.ts / ramps.test.ts (the gates), designDoc.test.ts (the numbers DESIGN.md quotes)
// and the gallery (the numbers the review page prints), so the three can never disagree.
import { deltaE2000, hexToLab, rgbToHex, simulateLab, type CvdModel, type Deficiency, type Lab } from './color';
import { bmagColor, fieldColor, heatColor } from './sceneTheme';
import { themes, type ThemeName } from './tokens';

/** Minimum pairwise CIEDE2000 between any two series. Why these numbers: DESIGN.md §4. */
export const PALETTE_GATES = {
  /** Full-severity protanopia and deuteranopia, Machado 2009 and Viénot 1999. */
  cvd: 12,
  /** Normal colour vision. */
  normal: 20,
  /** Tritanopia (Machado 2009). */
  tritan: 8,
} as const;

export type Vision = 'normal' | Deficiency;

export interface PaletteCondition {
  name: string;
  vision: Vision;
  model?: CvdModel;
  /** How a colour looks under this condition, in CIELAB. */
  toLab: (hex: string) => Lab;
  /** The gate this condition is held to. */
  min: number;
}

/** Every condition the palette is checked under. */
export const PALETTE_CONDITIONS: readonly PaletteCondition[] = [
  { name: 'normal vision', vision: 'normal', toLab: hexToLab, min: PALETTE_GATES.normal },
  ...(['protanopia', 'deuteranopia'] as const).flatMap((d) =>
    (['machado2009', 'vienot1999'] as const).map(
      (m): PaletteCondition => ({
        name: `${d} (${m})`,
        vision: d,
        model: m,
        toLab: (h: string) => simulateLab(h, d, m),
        min: PALETTE_GATES.cvd,
      }),
    ),
  ),
  {
    name: 'tritanopia (machado2009)',
    vision: 'tritanopia',
    model: 'machado2009',
    toLab: (h: string) => simulateLab(h, 'tritanopia'),
    min: PALETTE_GATES.tritan,
  },
];

/** Smallest CIEDE2000 between any two of `colors` as seen through `lab`, and the pair it belongs to. */
export function minPairwiseDeltaE(colors: Record<string, string>, toLab: (hex: string) => Lab): { min: number; pair: string } {
  const names = Object.keys(colors);
  let min = Infinity;
  let pair = '';
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i] as string;
      const b = names[j] as string;
      const d = deltaE2000(toLab(colors[a] as string), toLab(colors[b] as string));
      if (d < min) {
        min = d;
        pair = `${a}/${b}`;
      }
    }
  return { min, pair };
}

/** Smallest pairwise ΔE00 of a theme's series palette for one kind of vision, over every model that simulates it. */
export function seriesMinDeltaE(theme: ThemeName, vision: Vision): number {
  const series = themes[theme].series;
  return Math.min(
    ...PALETTE_CONDITIONS.filter((c) => c.vision === vision).map((c) => minPairwiseDeltaE(series, c.toLab).min),
  );
}

// ---- colormaps ---------------------------------------------------------------------------------

/** The three sequential colormaps: |B| of Locate the tubes, and temperature and |B| of Heat & field. */
export type RampId = 'bmag' | 'heat' | 'field';

const LOOKUP: Record<RampId, (t: number, theme: ThemeName) => readonly [number, number, number]> = {
  bmag: bmagColor,
  heat: heatColor,
  field: fieldColor,
};

/** `n` colours along a colormap exactly as the lookup draws them (stops and the sRGB interpolation between them). */
export function rampSamples(id: RampId, theme: ThemeName, n = 41): string[] {
  return Array.from({ length: n }, (_, k) => rgbToHex(LOOKUP[id](k / (n - 1), theme)));
}

/**
 * How far apart two colormaps must stay (closest approach, ΔE00). Why these numbers: DESIGN.md §7.
 *  - field / heat share a view (the surface toggles between them): the series gate, 12.
 *  - field / bmag show the same quantity in two views and run in opposite directions (dark is
 *    strong in one, weak in the other), so no colour of one may pass for a colour of the other: 8.
 *  - heat / bmag never share a view, but both have a yellow end (coldest in one, strongest in the
 *    other), so the yellow of one may not pass for the yellow of the other: 8, in normal vision
 *    (RAMP_SEPARATION_VIEWERS says why not under protanopia / deuteranopia).
 */
export const RAMP_SEPARATION_GATES = { 'field/heat': 12, 'field/bmag': 8, 'heat/bmag': 8 } as const;
export type RampPair = keyof typeof RAMP_SEPARATION_GATES;

/** The conditions colormaps are compared under by default: normal vision and protanopia / deuteranopia, both models. */
export const RAMP_CONDITIONS: readonly PaletteCondition[] = PALETTE_CONDITIONS.filter((c) => c.vision !== 'tritanopia');

/**
 * Whose vision each gate holds for. `all` = every RAMP_CONDITIONS entry. `normal` = normal vision only:
 * heat / bmag. Under protanopia and deuteranopia every yellow -> orange -> red ramp and the ochre end of
 * Locate the tubes' |B| ramp collapse onto the same yellow-browns where their lightness meets (L* ≈ 60 on
 * the light theme), and `scene.bmag` may not change; the two never share a view and each view shows its
 * own colour bar. DESIGN.md §7 quotes the measured figure under simulation for both themes.
 */
export const RAMP_SEPARATION_VIEWERS: Record<RampPair, 'all' | 'normal'> = { 'field/heat': 'all', 'field/bmag': 'all', 'heat/bmag': 'normal' };

/** The conditions the gate of `pair` is checked under. */
export function rampPairConditions(pair: RampPair): readonly PaletteCondition[] {
  return RAMP_SEPARATION_VIEWERS[pair] === 'normal' ? RAMP_CONDITIONS.filter((c) => c.vision === 'normal') : RAMP_CONDITIONS;
}

/**
 * Closest approach of two colormaps: the smallest ΔE00 between any colour drawn on one and any
 * colour drawn on the other, over normal vision and every protanopia / deuteranopia simulation.
 * `lab` restricts it to one condition (used by the tests to name the failing one).
 */
export function rampSeparation(a: readonly string[], b: readonly string[], lab?: (hex: string) => Lab): number {
  const conditions = lab ? [lab] : RAMP_CONDITIONS.map((c) => c.toLab);
  let min = Infinity;
  for (const toLab of conditions) {
    const lb = b.map(toLab);
    for (const ha of a) {
      const la = toLab(ha);
      for (const x of lb) min = Math.min(min, deltaE2000(la, x));
    }
  }
  return min;
}

/**
 * Closest approach of a theme's two colormaps named by `pair` ("field/heat", …) under the conditions
 * its gate holds for (`rampPairConditions`); `conditions` overrides them (DESIGN.md quotes heat / bmag
 * under every condition too).
 */
export function rampPairSeparation(pair: RampPair, theme: ThemeName, conditions: readonly PaletteCondition[] = rampPairConditions(pair)): number {
  const [a, b] = pair.split('/') as [RampId, RampId];
  const sa = rampSamples(a, theme);
  const sb = rampSamples(b, theme);
  return Math.min(...conditions.map((c) => rampSeparation(sa, sb, c.toLab)));
}
