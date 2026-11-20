// Three.js colours from tokens. No colour literals here (noHardcodedColors.test.ts).
//
// Three r152+ manages colour: pass hex *strings* to `new THREE.Color(hex)` (interpreted as sRGB),
// and for per-vertex colours use `color.setRGB(r, g, b, THREE.SRGBColorSpace)` with bmagColor().

import { hexToRgb, type RGB } from './color';
import { themes, type ThemeName } from './tokens';

export type TubeId = 'bean' | 'triangular';

export interface SceneTheme {
  background: string;
  /** Flux-surface wireframe and fill — gray context, never data. */
  surface: { line: string; fill: string; opacity: number };
  /** Gray = unsampled (parts of a field line or surface with no samples). */
  unsampled: string;
  /** Identity colour per tube (matches the series palette and the reference figures). */
  fieldLine: Record<TubeId, string>;
  /** Selected tube line width multiplier vs. unselected (unselected also drops to `unsampled`-gray if desired). */
  selectedWidth: number;
  unselectedOpacity: number;
  /** Start / centre / end glyphs, as in the reference figures: square / circle / triangle. */
  markers: { start: 'square'; centre: 'circle'; end: 'triangle'; outline: string };
  /** 2D cross-section inset. */
  crossSection: { boundary: string; boundaryDash: [number, number]; sampled: string; axis: string; text: string };
  /** |B| colormap stops, low -> high. */
  bmag: readonly string[];
  text: string;
  textMuted: string;
}

export function sceneTheme(theme: ThemeName): SceneTheme {
  const t = themes[theme];
  return {
    background: t.scene.background,
    surface: { line: t.scene.surfaceLine, fill: t.scene.surfaceFill, opacity: t.scene.surfaceOpacity },
    unsampled: t.scene.unsampled,
    fieldLine: { bean: t.series.bean, triangular: t.series.triangular },
    selectedWidth: 1.6,
    unselectedOpacity: 0.35,
    markers: { start: 'square', centre: 'circle', end: 'triangle', outline: t.scene.markerOutline },
    crossSection: {
      boundary: t.scene.boundary,
      boundaryDash: [4, 3],
      sampled: t.scene.sampledSurface,
      axis: t.plot.axis,
      text: t.color.textMuted,
    },
    bmag: t.scene.bmag,
    text: t.color.text,
    textMuted: t.color.textMuted,
  };
}

/** Hex token -> integer for APIs that take 0xRRGGBB (e.g. `scene.background = new Color(n)`). */
export function toThreeHex(hex: string): number {
  return parseInt(hex.replace('#', '').slice(0, 6), 16);
}

/**
 * |B| colormap lookup. `t` in [0, 1] (normalise with bmagRange); returns sRGB in [0, 1].
 * Linear interpolation between adjacent stops; the 9 stops are close enough (ΔE00 ≈ 10 apart)
 * that the interpolation error is below a JND.
 */
export function bmagColor(t: number, theme: ThemeName): RGB {
  const stops = themes[theme].scene.bmag;
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(stops[i] as string);
  const b = hexToRgb(stops[i + 1] as string);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Normalise |B| into [0, 1] for bmagColor, given the tube's bmagRange. */
export function normalizeBmag(bmag: number, range: readonly [number, number]): number {
  const [lo, hi] = range;
  return hi > lo ? (bmag - lo) / (hi - lo) : 0.5;
}

/** CSS linear-gradient for a |B| colour bar legend (uses the token CSS variables). */
export function bmagGradientCss(theme: ThemeName, direction = 'to right'): string {
  const n = themes[theme].scene.bmag.length;
  const stops = Array.from({ length: n }, (_, i) => `var(--lab-bmag-${i}) ${((i / (n - 1)) * 100).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}
