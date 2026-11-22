// Three.js colours from tokens. No colour literals here (noHardcodedColors.test.ts).
//
// Three r152+ manages colour: pass hex *strings* to `new THREE.Color(hex)` (interpreted as sRGB),
// and for per-vertex colours use `color.setRGB(r, g, b, THREE.SRGBColorSpace)` with bmagColor(),
// heatColor() or fieldColor().

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
  /** |B| colormap stops, low -> high (Locate the tubes). */
  bmag: readonly string[];
  /**
   * Temperature colormap stops for Heat & field, COLDEST (yellow) -> HOTTEST (red). Owner's rule, D-027.
   * A fill ramp: its pale yellow end is not 3:1 on the light scene, so draw every heat-coloured shape
   * with `outline` round it (the LCFS silhouette in 3D, the LCFS in the cross-section). Never a line colour.
   */
  heat: readonly string[];
  /**
   * The outline round a heat-coloured fill (`scene.boundary`, ≥ 3:1 on the scene background): it carries
   * the shape's edge where a pale stop meets the scene (WCAG 1.4.11). At least 1.5px on screen.
   */
  outline: string;
  /** |B| colormap stops for Heat & field, WEAKEST (green) -> STRONGEST (dark blue). Owner's rule, D-027. */
  field: readonly string[];
  /**
   * Schematic diverter plates (Heat & field): a near-black `fill`, as the owner drew them, and an
   * `edge` drawn round it so the plate stays visible on the dark scene background and on the darkest
   * ramp colours. Draw both: on every ground one of the two is ≥ 3:1 (ramps.test.ts).
   */
  diverter: { fill: string; edge: string };
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
    heat: t.scene.heat,
    outline: t.scene.boundary,
    field: t.scene.field,
    diverter: { fill: t.scene.diverterFill, edge: t.scene.diverterEdge },
    text: t.color.text,
    textMuted: t.color.textMuted,
  };
}

/** Hex token -> integer for APIs that take 0xRRGGBB (e.g. `scene.background = new Color(n)`). */
export function toThreeHex(hex: string): number {
  return parseInt(hex.replace('#', '').slice(0, 6), 16);
}

/**
 * One colormap lookup for all three ramps: `t` clamped to [0, 1] (NaN -> 0), linear interpolation in
 * sRGB between adjacent stops. The stops are close enough (≈ 5–10 ΔE00 apart) that the
 * interpolation error is below a JND.
 */
export function rampColor(stops: readonly string[], t: number): RGB {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(stops[i] as string);
  const b = hexToRgb(stops[i + 1] as string);
  // a·(1−f) + b·f is exact at both ends (f = 0 gives a, f = 1 gives b), so t = 0 and t = 1 are the stops.
  return [a[0] * (1 - f) + b[0] * f, a[1] * (1 - f) + b[1] * f, a[2] * (1 - f) + b[2] * f];
}

/** CSS linear-gradient over the `--lab-<name>-<i>` stops (follows the CSS theme by itself). */
function gradientCss(name: 'bmag' | 'heat' | 'field', count: number, direction: string): string {
  const stops = Array.from({ length: count }, (_, i) => `var(--lab-${name}-${i}) ${((i / (count - 1)) * 100).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

/**
 * |B| colormap lookup (Locate the tubes). `t` in [0, 1] (normalise with bmagRange); returns sRGB in [0, 1].
 */
export function bmagColor(t: number, theme: ThemeName): RGB {
  return rampColor(themes[theme].scene.bmag, t);
}

/**
 * Temperature colormap lookup (Heat & field). `t` in [0, 1] with 0 = COLDEST (yellow) and
 * 1 = HOTTEST (red); clamped, NaN -> 0. Returns sRGB in [0, 1] for `color.setRGB(r, g, b, SRGBColorSpace)`.
 */
export function heatColor(t: number, theme: ThemeName): RGB {
  return rampColor(themes[theme].scene.heat, t);
}

/**
 * |B| colormap lookup for Heat & field. `t` in [0, 1] with 0 = WEAKEST (green) and 1 = STRONGEST
 * (dark blue); clamped, NaN -> 0. Returns sRGB in [0, 1]. Not `bmagColor`: that ramp runs the
 * other way round (dark = weak) and belongs to Locate the tubes.
 */
export function fieldColor(t: number, theme: ThemeName): RGB {
  return rampColor(themes[theme].scene.field, t);
}

/** Bring `value` into [0, 1] over `range` = [lo, hi] for a colormap lookup (0.5 when the range is empty). Not clamped: the lookups clamp. */
export function normalizeRange(value: number, range: readonly [number, number]): number {
  const [lo, hi] = range;
  return hi > lo ? (value - lo) / (hi - lo) : 0.5;
}

/** Normalise |B| into [0, 1] for bmagColor, given the tube's bmagRange. */
export function normalizeBmag(bmag: number, range: readonly [number, number]): number {
  return normalizeRange(bmag, range);
}

/** CSS linear-gradient for a |B| colour bar legend (uses the token CSS variables). */
export function bmagGradientCss(theme: ThemeName, direction = 'to right'): string {
  return gradientCss('bmag', themes[theme].scene.bmag.length, direction);
}

/**
 * CSS linear-gradient for the temperature colour bar: coldest at the START of `direction`, hottest
 * at its end. `'to right'` (default) puts hottest on the right; `'to top'` puts hottest at the top.
 */
export function heatGradientCss(theme: ThemeName, direction = 'to right'): string {
  return gradientCss('heat', themes[theme].scene.heat.length, direction);
}

/** CSS linear-gradient for the Heat & field |B| colour bar: weakest at the start of `direction`, strongest at its end. */
export function fieldGradientCss(theme: ThemeName, direction = 'to right'): string {
  return gradientCss('field', themes[theme].scene.field.length, direction);
}
