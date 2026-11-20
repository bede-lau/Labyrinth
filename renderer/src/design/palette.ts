// Series-palette gates and the measurement they are applied to. One definition, shared by
// palette.test.ts (the gate), designDoc.test.ts (the numbers DESIGN.md quotes) and the gallery
// (the numbers the review page prints), so the three can never disagree.
import { deltaE2000, hexToLab, simulateLab, type CvdModel, type Deficiency, type Lab } from './color';
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
