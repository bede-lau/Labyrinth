// Colour science used by the design-system tests and the gallery.
// Self-contained (no dependencies) so the checks can be audited line by line.
//
//  - sRGB <-> linear RGB (IEC 61966-2-1), relative luminance and WCAG 2.x contrast ratio
//  - CIE XYZ (D65) -> CIELAB
//  - CIEDE2000 colour difference (Sharma, Wu & Dalal 2005), verified against their test data
//  - Colour-vision-deficiency simulation:
//      Machado, Oliveira & Fernandes 2009 (severity 1.0 = full dichromacy), and
//      Viénot, Brettel & Mollon 1999 (protanope / deuteranope projection),
//    both applied in linear RGB.

export type RGB = readonly [number, number, number];
export type Lab = readonly [number, number, number];
export type Mat3 = readonly [RGB, RGB, RGB];

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored) to sRGB components in [0, 1]. */
export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as RGB;
}

export function rgbToHex(rgb: RGB): string {
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export const srgbToLinear = (rgb: RGB): RGB => rgb.map(toLinear) as unknown as RGB;
export const linearToSrgb = (rgb: RGB): RGB =>
  rgb.map((c) => fromLinear(Math.min(1, Math.max(0, c)))) as unknown as RGB;

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = srgbToLinear(hexToRgb(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear RGB (sRGB primaries, D65) -> CIELAB (D65 white). */
export function linearRgbToLab([r, g, b]: RGB): Lab {
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X / 0.95047);
  const fy = f(Y / 1);
  const fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const hexToLab = (hex: string): Lab => linearRgbToLab(srgbToLinear(hexToRgb(hex)));

/** CIEDE2000 colour difference with kL = kC = kH = 1. */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hue(b1, ap1);
  const hp2 = hue(b2, ap2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);
  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar: number;
  if (Cp1 * Cp2 === 0) hbar = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hbar = (hp1 + hp2) / 2;
  else if (hp1 + hp2 < 360) hbar = (hp1 + hp2 + 360) / 2;
  else hbar = (hp1 + hp2 - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.2 * Math.cos((4 * hbar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cpbar ** 7 / (Cpbar ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cpbar;
  const SH = 1 + 0.015 * Cpbar * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** CIE76 (Euclidean Lab) difference, reported alongside CIEDE2000 for reference. */
export const deltaE76 = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export type Deficiency = 'protanopia' | 'deuteranopia' | 'tritanopia';
export type CvdModel = 'machado2009' | 'vienot1999';

/** Machado et al. 2009, severity 1.0, linear RGB. */
export const MACHADO_2009: Record<Deficiency, Mat3> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Viénot et al. 1999 dichromat projection expressed in linear RGB (protan / deutan only). */
export const VIENOT_1999: Record<'protanopia' | 'deuteranopia', Mat3> = {
  protanopia: [
    [0.11238, 0.88762, 0],
    [0.11238, 0.88762, 0],
    [0.00401, -0.00401, 1],
  ],
  deuteranopia: [
    [0.29275, 0.70725, 0],
    [0.29275, 0.70725, 0],
    [-0.02234, 0.02234, 1],
  ],
};

const clamp01 = (c: number) => Math.min(1, Math.max(0, c));

/** Simulate how `hex` appears to a dichromat; returns the simulated colour in linear RGB. */
export function simulateLinear(hex: string, deficiency: Deficiency, model: CvdModel = 'machado2009'): RGB {
  const m =
    model === 'machado2009'
      ? MACHADO_2009[deficiency]
      : deficiency === 'tritanopia'
        ? undefined
        : VIENOT_1999[deficiency];
  if (!m) throw new Error(`${model} has no ${deficiency} matrix`);
  const l = srgbToLinear(hexToRgb(hex));
  return m.map((row) => clamp01(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])) as unknown as RGB;
}

export const simulateLab = (hex: string, d: Deficiency, model: CvdModel = 'machado2009'): Lab =>
  linearRgbToLab(simulateLinear(hex, d, model));

export const simulateHex = (hex: string, d: Deficiency, model: CvdModel = 'machado2009'): string =>
  rgbToHex(linearToSrgb(simulateLinear(hex, d, model)));

/** `rgba()` string for a hex token at the given alpha (used for bands and shading). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
