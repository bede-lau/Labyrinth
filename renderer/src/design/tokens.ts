// Labyrinth design tokens — the single source of truth.
//
// tokens.css is GENERATED from this file (renderTokensCss) and a test requires byte equality,
// so CSS, Plotly (plotTheme.ts) and Three.js (sceneTheme.ts) can never drift apart.
// Regenerate after editing:   npm --prefix renderer run tokens
//
// Colour values may appear as literals ONLY in this file. Everything else references tokens.
// Erasable TypeScript only (no enums/namespaces): the generator runs it with node --experimental-strip-types.

export type ThemeName = 'light' | 'dark';
export const THEMES: readonly ThemeName[] = ['light', 'dark'];

/** Every status the UI can show. Colour is never the only channel: each also has an icon and text. */
export const STATUS_KINDS = [
  'live',
  'billing-risk',
  'replay',
  'rehearsal',
  'archive',
  'derived',
  'prd-reported',
  'model',
  'unverified',
  'passed',
  'failed',
  'blocked',
  'mismatch',
  'not-applicable',
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export const SERIES_IDS = ['stella', 'GENE', 'GX', 'bean', 'triangular'] as const;
export type SeriesId = (typeof SERIES_IDS)[number];

export const CALLOUT_TONES = ['info', 'warn', 'blocked'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export interface StatusColors {
  /** Text and icon colour. ≥ 4.5:1 on `bg` and on every surface. */
  fg: string;
  /** Tinted fill behind the pill / row. `live` is the only solid fill: ≥ 3:1 against every surface. */
  bg: string;
  /**
   * Outline of the pill. A hairline for most kinds (the icon and text carry the meaning). For the
   * kinds drawn DASHED (prd-reported, model, unverified) the dash itself means "not backed by data
   * in this repo", so those are ≥ 3:1 against every surface and against their own tint. The one
   * OUTLINED kind (billing-risk) draws it in its text colour, held to the same 3:1.
   */
  border: string;
}

export interface ColorTokens {
  /** App canvas behind panels. */
  bg: string;
  /** Panels, cards, plot paper. */
  surface: string;
  /** Wells, table headers, inset rows. */
  surfaceSunken: string;
  /** Popovers, tooltips (with shadow). */
  surfaceRaised: string;
  /** Hover fill for interactive rows / segments. */
  surfaceHover: string;
  /** Decorative hairline dividers. */
  border: string;
  /** Boundaries of interactive controls — ≥ 3:1 against surfaces (WCAG 1.4.11). */
  borderStrong: string;
  /** Primary text: titles, values. (Deep slate from the flux-tube figures.) */
  text: string;
  /** Secondary text: subtitles, labels, axis ticks. */
  textMuted: string;
  /** Tertiary text: metadata, captions. Still ≥ 4.5:1 everywhere. */
  textSubtle: string;
  /** The one accent: selection, focus, links. Teal from the bean field line. */
  accent: string;
  accentHover: string;
  /** Accent used as text (links) — tuned for 4.5:1 on all surfaces. */
  accentText: string;
  /** Text on an `accent` fill (selected segment). */
  accentFg: string;
  /** Tinted accent fill (selected row, info wells). */
  accentSubtle: string;
  /** Focus ring. ≥ 3:1 against every surface. */
  focus: string;
  /** Shadow colour for raised surfaces. */
  shadow: string;
}

export interface PlotTokens {
  paper: string;
  plot: string;
  grid: string;
  axis: string;
  zero: string;
  /** Shading for the analysis windows (200–300, 300–400, …). An alpha fill: the data stays visible through it. */
  windowShade: string;
  /** Dotted boundary of an analysis window. Opaque, ≥ 3:1 on the plot, on the shade and on the unsampled fill. */
  windowEdge: string;
  /** Gray = unsampled / not covered. */
  unsampled: string;
  /** Opacity of the `unsampled` gray when it covers a range of a chart (the data stays visible around it). */
  unsampledAlpha: number;
  /** Opacity applied to a series colour for its ±1σ sampling-uncertainty band. */
  bandAlpha: number;
  /**
   * The forecast chart's "Predicted" line (D-026). Its partner "Actual" is the archived stella trace
   * and keeps `series.stella`. Validated against it in palette.test.ts; ≥ 3:1 on the plot.
   */
  predicted: string;
}

export interface SceneTokens {
  background: string;
  /** Flux-surface wireframe: gray context, never data. */
  surfaceLine: string;
  /** Faint fill behind the wireframe. */
  surfaceFill: string;
  surfaceOpacity: number;
  /** Gray = unsampled regions of the field line or surface. */
  unsampled: string;
  /**
   * Plasma boundary: the dashed boundary of the Locate the tubes cross-section inset, and in Heat & field
   * the outline round every temperature fill (the LCFS silhouette in 3D, the LCFS in the cross-section).
   * ≥ 3:1 on `background` (contrastPairs.ts).
   */
  boundary: string;
  sampledSurface: string;
  /** Marker outline so start/centre/end glyphs read on any line colour. */
  markerOutline: string;
  /** |B| colormap stops (low -> high), perceptually ordered, CVD-safe, ≥ 3:1 on `background`. Locate the tubes. */
  bmag: readonly string[];
  /**
   * Schematic diverter plates in Heat & field (D-027): black as the owner drew them. The fill is
   * near-black in both themes; the edge keeps the plate visible where the fill is not (the dark
   * scene background, the darkest ramp colours). ramps.test.ts: on every ground, fill or edge ≥ 3:1.
   */
  diverterFill: string;
  diverterEdge: string;
  /**
   * Temperature colormap stops, COLDEST -> HOTTEST: yellow -> orange -> red (the owner's rule,
   * D-027). Lightness falls monotonically (yellow lightest, red darkest). A FILL ramp (surfaces and
   * cross-section cells, never lines): every stop ≥ 20 ΔE00 off `background`, and the filled shape is
   * outlined in `boundary` (≥ 3:1 on `background`), which carries its edge where a pale stop meets the
   * scene (ramps.test.ts, DESIGN.md §7).
   */
  heat: readonly string[];
  /**
   * |B| colormap for Heat & field, WEAKEST -> STRONGEST: green -> dark blue (the owner's rule,
   * D-027). Lightness falls monotonically; kept apart from `heat` and from `bmag` (ramps.test.ts).
   */
  field: readonly string[];
}

export interface ThemeTokens {
  color: ColorTokens;
  status: Record<StatusKind, StatusColors>;
  callout: Record<CalloutTone, StatusColors>;
  series: Record<SeriesId, string>;
  plot: PlotTokens;
  scene: SceneTokens;
}

// ---------------------------------------------------------------------------------------------
// Light theme
// ---------------------------------------------------------------------------------------------
const light: ThemeTokens = {
  color: {
    bg: '#f3f5f6',
    surface: '#ffffff',
    surfaceSunken: '#eef2f4',
    surfaceRaised: '#ffffff',
    surfaceHover: '#e9eef1',
    border: '#dbe2e6',
    borderStrong: '#73868e',
    text: '#14262f',
    textMuted: '#42565e',
    textSubtle: '#56686f',
    accent: '#0b7f80',
    accentHover: '#096a6b',
    accentText: '#086a6b',
    accentFg: '#ffffff',
    accentSubtle: '#e2f1f0',
    focus: '#0b7f80',
    shadow: 'rgba(20, 38, 47, 0.14)',
  },
  status: {
    live: { fg: '#ffffff', bg: '#c4122f', border: '#c4122f' },
    'billing-risk': { fg: '#9b1145', bg: '#fce9f0', border: '#9b1145' },
    replay: { fg: '#42565e', bg: '#eef2f4', border: '#c9d3d8' },
    rehearsal: { fg: '#3a4796', bg: '#eceefa', border: '#c3c9ec' },
    archive: { fg: '#2c5674', bg: '#e8f0f6', border: '#bcd0e0' },
    derived: { fg: '#086a6b', bg: '#e2f1f0', border: '#a9d4d2' },
    'prd-reported': { fg: '#6c5715', bg: '#f7f2e3', border: '#96803a' },
    model: { fg: '#8c2b74', bg: '#f9ecf4', border: '#a85e96' },
    unverified: { fg: '#56686f', bg: '#f6f8f9', border: '#73868e' },
    passed: { fg: '#1d6a39', bg: '#e5f3e9', border: '#a3d2b1' },
    failed: { fg: '#b3261e', bg: '#fcebea', border: '#efb0aa' },
    blocked: { fg: '#673f9c', bg: '#f1ecf8', border: '#cbb9e4' },
    mismatch: { fg: '#a8400c', bg: '#fdefe5', border: '#efbb98' },
    'not-applicable': { fg: '#56686f', bg: '#eef2f4', border: '#c9d3d8' },
  },
  callout: {
    info: { fg: '#24557f', bg: '#ebf2f8', border: '#9fbfda' },
    warn: { fg: '#7d4c00', bg: '#fcf4e2', border: '#e0bd73' },
    blocked: { fg: '#673f9c', bg: '#f1ecf8', border: '#b9a2dc' },
  },
  // Validated in palette.test.ts: pairwise CIEDE2000 ≥ 12 under simulated protanopia and
  // deuteranopia (Machado 2009 and Viénot 1999), ≥ 20 in normal vision, ≥ 3:1 on the plot.
  series: {
    stella: '#1148b3',
    GENE: '#b68b16',
    GX: '#2c2024',
    bean: '#0b7f80',
    triangular: '#a8482a',
  },
  plot: {
    paper: '#ffffff',
    plot: '#ffffff',
    grid: '#e6ebee',
    axis: '#73868e',
    zero: '#c3ced3',
    windowShade: 'rgba(11, 127, 128, 0.07)',
    windowEdge: '#238c8d',
    unsampled: '#c9d2d6',
    unsampledAlpha: 0.35,
    bandAlpha: 0.18,
    predicted: '#c85a0a',
  },
  // Ramps built in OKLCH (ramps.test.ts holds the gates; DESIGN.md §7 says why). The field ramp also
  // colours field lines, so every stop stays ≥ 3:1 on white (its green is a jade). The heat ramp is a
  // fill outlined in `boundary`, so its cold end can be the true yellow the owner asked for.
  scene: {
    background: '#ffffff',
    surfaceLine: '#b8c6cc',
    surfaceFill: '#eef2f4',
    surfaceOpacity: 0.35,
    unsampled: '#b8c6cc',
    boundary: '#5d6d75',
    sampledSurface: '#6a939a',
    markerOutline: '#ffffff',
    bmag: ['#182b58', '#003d63', '#004f67', '#006064', '#006f5a', '#2f7b4a', '#608338', '#888528', '#b28a29'],
    diverterFill: '#14181a',
    diverterEdge: '#ffffff',
    heat: ['#f8ea21', '#ffcc00', '#ffac00', '#ff8c00', '#fa6900', '#ec4812', '#dc302c', '#c7183c', '#a80046', '#7f0049', '#590042'],
    field: ['#00a676', '#059b87', '#0c9091', '#0a8497', '#06779a', '#0066a2', '#0351a9', '#0037ab', '#1811a2'],
  },
};

// ---------------------------------------------------------------------------------------------
// Dark theme
// ---------------------------------------------------------------------------------------------
const dark: ThemeTokens = {
  color: {
    bg: '#0b1317',
    surface: '#111b20',
    surfaceSunken: '#0d161a',
    surfaceRaised: '#17242a',
    surfaceHover: '#1b2a31',
    border: '#233239',
    borderStrong: '#62777f',
    text: '#e4ecef',
    textMuted: '#a9b8be',
    textSubtle: '#91a3aa',
    accent: '#41b2b2',
    accentHover: '#5cc2c1',
    accentText: '#5cc2c1',
    accentFg: '#04191a',
    accentSubtle: '#0f2a2b',
    focus: '#5cc2c1',
    shadow: 'rgba(0, 0, 0, 0.5)',
  },
  status: {
    live: { fg: '#ffffff', bg: '#da2a48', border: '#da2a48' },
    'billing-risk': { fg: '#ff8fb4', bg: '#36101f', border: '#ff8fb4' },
    replay: { fg: '#b4c2c8', bg: '#18252b', border: '#34464e' },
    rehearsal: { fg: '#aab4f2', bg: '#181d36', border: '#3a4584' },
    archive: { fg: '#97bfe2', bg: '#12212d', border: '#2e4d66' },
    derived: { fg: '#6fcfcb', bg: '#0f2627', border: '#245e5d' },
    'prd-reported': { fg: '#dcc78c', bg: '#241f12', border: '#8f7c40' },
    model: { fg: '#eba0de', bg: '#2a1427', border: '#a0609a' },
    unverified: { fg: '#a9b8be', bg: '#141f24', border: '#62777f' },
    passed: { fg: '#74d394', bg: '#11281a', border: '#2b6a3f' },
    failed: { fg: '#ff8f85', bg: '#311513', border: '#7a2b25' },
    blocked: { fg: '#c7aaf5', bg: '#221a33', border: '#54417c' },
    mismatch: { fg: '#ffa56b', bg: '#321f10', border: '#7a4719' },
    'not-applicable': { fg: '#a9b8be', bg: '#18252b', border: '#34464e' },
  },
  callout: {
    info: { fg: '#93c0ee', bg: '#0f2134', border: '#2d5582' },
    warn: { fg: '#f0c26a', bg: '#2a2110', border: '#6e5418' },
    blocked: { fg: '#c7aaf5', bg: '#221a33', border: '#54417c' },
  },
  series: {
    stella: '#467cc0',
    GENE: '#e5c057',
    GX: '#ece6e7',
    bean: '#41b2b2',
    triangular: '#c36953',
  },
  plot: {
    paper: '#111b20',
    plot: '#111b20',
    grid: '#1e2b31',
    axis: '#62777f',
    zero: '#34464e',
    windowShade: 'rgba(65, 178, 178, 0.09)',
    windowEdge: '#379495',
    unsampled: '#3a4a51',
    unsampledAlpha: 0.35,
    bandAlpha: 0.22,
    predicted: '#f08a3c',
  },
  // On the dark scene the near-black diverter fill disappears into the background, so its light
  // edge carries the outline there; on the yellow end of the heat map the fill carries it.
  scene: {
    background: '#111b20',
    surfaceLine: '#3c4d55',
    surfaceFill: '#162228',
    surfaceOpacity: 0.35,
    unsampled: '#3c4d55',
    boundary: '#8a9ca4',
    sampledSurface: '#6fa3aa',
    markerOutline: '#111b20',
    bmag: ['#546b9d', '#4980ab', '#4095b1', '#42aab0', '#58bcaa', '#7ccba0', '#a7d895', '#d3e18e', '#ffe891'],
    diverterFill: '#030506',
    diverterEdge: '#d5dee2',
    heat: ['#fff44a', '#ffd800', '#ffbb00', '#ffa00d', '#ff8b2d', '#ff773f', '#ff6351', '#ff4e64', '#f8367a', '#e0278a', '#bf1e94'],
    field: ['#76ffd0', '#40f5de', '#29e6ea', '#33d5f1', '#1dc3f8', '#27affe', '#3f99fe', '#3e7fff', '#4766fe'],
  },
};

export const themes: Record<ThemeName, ThemeTokens> = { light, dark };

// ---------------------------------------------------------------------------------------------
// Theme-independent scales
// ---------------------------------------------------------------------------------------------
export const font = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "DejaVu Sans", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
} as const;

/** Type scale in px (size / line-height). Dense instrument scale on a 4px rhythm. */
export const typeScale = {
  '2xs': [11, 16],
  xs: [12, 16],
  sm: [13, 20],
  md: [14, 20],
  lg: [16, 24],
  xl: [20, 28],
  '2xl': [24, 32],
  '3xl': [32, 40],
} as const satisfies Record<string, readonly [number, number]>;

export const fontWeight = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

/** Spacing scale in px (4px base). Key = step name used in CSS: --lab-space-<key>. */
export const space = {
  0: 0,
  px: 1,
  '0-5': 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = { xs: 2, sm: 4, md: 6, lg: 10, pill: 999 } as const;

export const motion = {
  fast: '120ms',
  base: '180ms',
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export const shadow = {
  raised: '0 1px 2px var(--lab-color-shadow), 0 8px 24px var(--lab-color-shadow)',
} as const;

export const zIndex = { popover: 20, toast: 30 } as const;

// ---------------------------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------------------------
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Flatten one theme's colour tokens to CSS custom properties. */
export function themeCssVars(theme: ThemeName): Record<string, string> {
  const t = themes[theme];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.color)) out[`--lab-color-${kebab(k)}`] = v;
  for (const [k, c] of Object.entries(t.status)) {
    out[`--lab-status-${k}-fg`] = c.fg;
    out[`--lab-status-${k}-bg`] = c.bg;
    out[`--lab-status-${k}-border`] = c.border;
  }
  for (const [k, c] of Object.entries(t.callout)) {
    out[`--lab-callout-${k}-fg`] = c.fg;
    out[`--lab-callout-${k}-bg`] = c.bg;
    out[`--lab-callout-${k}-border`] = c.border;
  }
  for (const [k, v] of Object.entries(t.series)) out[`--lab-series-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(t.plot)) out[`--lab-plot-${kebab(k)}`] = String(v);
  // Colormaps (bmag, heat, field) become one property per stop: --lab-bmag-0 … --lab-heat-8.
  for (const [k, v] of Object.entries(t.scene)) {
    if (Array.isArray(v)) (v as readonly string[]).forEach((c, i) => (out[`--lab-${kebab(k)}-${i}`] = c));
    else out[`--lab-scene-${kebab(k)}`] = String(v);
  }
  return out;
}

/** Theme-independent custom properties (type, space, radius, motion). */
export function staticCssVars(): Record<string, string> {
  const out: Record<string, string> = {
    '--lab-font-sans': font.sans,
    '--lab-font-mono': font.mono,
  };
  for (const [k, [size, lh]] of Object.entries(typeScale)) {
    out[`--lab-font-size-${k}`] = `${size}px`;
    out[`--lab-line-height-${k}`] = `${lh}px`;
  }
  for (const [k, v] of Object.entries(fontWeight)) out[`--lab-font-weight-${k}`] = String(v);
  for (const [k, v] of Object.entries(space)) out[`--lab-space-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(radius)) out[`--lab-radius-${k}`] = `${v}px`;
  out['--lab-motion-fast'] = motion.fast;
  out['--lab-motion-base'] = motion.base;
  out['--lab-motion-easing'] = motion.easing;
  out['--lab-shadow-raised'] = shadow.raised;
  for (const [k, v] of Object.entries(zIndex)) out[`--lab-z-${k}`] = String(v);
  return out;
}

const block = (selector: string, vars: Record<string, string>, indent = '') =>
  `${indent}${selector} {\n${Object.entries(vars)
    .map(([k, v]) => `${indent}  ${k}: ${v};`)
    .join('\n')}\n${indent}}`;

const BASE_CSS = `/* ---- base ------------------------------------------------------------------------------ */
*, *::before, *::after { box-sizing: border-box; }
html {
  background: var(--lab-color-bg);
  color: var(--lab-color-text);
  font-family: var(--lab-font-sans);
  font-size: var(--lab-font-size-md);
  line-height: var(--lab-line-height-md);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
body {
  margin: 0;
  background: var(--lab-color-bg);
  color: var(--lab-color-text);
}
h1, h2, h3, h4, h5, h6, p, dl, dd, figure { margin: 0; }
a { color: var(--lab-color-accent-text); text-underline-offset: 2px; }
a:hover { color: var(--lab-color-accent-hover); }
button, input, select, textarea { font: inherit; color: inherit; }
::selection { background: var(--lab-color-accent-subtle); color: var(--lab-color-text); }

/* Focus: visible only for keyboard users; 2px ring + 2px offset reads on any fill. */
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--lab-color-focus);
  outline-offset: 2px;
  border-radius: var(--lab-radius-xs);
}
/* Chart modebar buttons. Plotly injects its own focus rule for them at runtime (a 1px black
 * outline), after this sheet and more specific than the rule above; on the dark plot that ring
 * is 1.2:1. This selector out-ranks Plotly's (tokens.test.ts compares the two), so chart buttons
 * take the same themed ring as every other control. */
.js-plotly-plot .plotly .modebar .modebar-btn:focus-visible {
  outline: 2px solid var(--lab-color-focus);
  outline-offset: 1px;
  border-radius: var(--lab-radius-xs);
}
/* Disclosure summaries are pointer targets: at least 24px tall (WCAG 2.5.8). Done with padding
 * and min-height, never display:flex, so the disclosure triangle stays. */
summary {
  min-height: 24px;
  padding-block: var(--lab-space-1);
  cursor: pointer;
}
/* Subscripts in units (Q_gB, a/v_th,i) must not grow the line box, or a row of numbers loses
 * its shared baseline. */
sub, sup { line-height: 0; }

/* ---- utilities ------------------------------------------------------------------------- */
/* Numbers: tabular, lining figures so columns of values align digit-for-digit. */
.lab-num, .lab-tabular {
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
}
.lab-mono { font-family: var(--lab-font-mono); font-size: 0.92em; }
.lab-visually-hidden {
  position: absolute !important;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%);
  white-space: nowrap; border: 0;
}

/* ---- reduced motion -------------------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

/**
 * The "Token reference" tables of DESIGN.md: every custom property with its values. Written between
 * the `tokens:begin` / `tokens:end` markers by `npm run tokens`; designDoc.test.ts fails on drift.
 */
export function renderTokenReferenceMd(): string {
  const lightVars = themeCssVars('light');
  const darkVars = themeCssVars('dark');
  const code = (v: string | undefined) => `\`${v ?? ''}\``;
  return [
    '### Theme tokens',
    '',
    '| Custom property | Light | Dark |',
    '|---|---|---|',
    ...Object.keys(lightVars).map((k) => `| ${code(k)} | ${code(lightVars[k])} | ${code(darkVars[k])} |`),
    '',
    '### Scale tokens (the same in both themes)',
    '',
    '| Custom property | Value |',
    '|---|---|',
    ...Object.entries(staticCssVars()).map(([k, v]) => `| ${code(k)} | ${code(v)} |`),
  ].join('\n');
}

/** The full contents of tokens.css. */
export function renderTokensCss(): string {
  const lightVars = { ...staticCssVars(), ...themeCssVars('light') };
  const darkVars = themeCssVars('dark');
  return [
    '/* GENERATED from tokens.ts by renderTokensCss() — do not edit by hand.',
    ' * Regenerate: npm --prefix renderer run tokens   (tokens.test.ts fails if this file drifts.)',
    ' *',
    ' * Theme selection: light by default; dark when the OS prefers dark unless',
    ' * <html data-theme="light"> forces light; <html data-theme="dark"> forces dark. */',
    '',
    block(':root', { 'color-scheme': 'light', ...lightVars }),
    '',
    '@media (prefers-color-scheme: dark) {',
    block(':root:not([data-theme="light"])', { 'color-scheme': 'dark', ...darkVars }, '  '),
    '}',
    '',
    block(':root[data-theme="dark"]', { 'color-scheme': 'dark', ...darkVars }),
    '',
    BASE_CSS,
  ].join('\n');
}

/** Co-registered Locate scene: edge temperature spectrum, flux tracer and hardware materials. */
export const plasmaMaterials = {
  /**
   * Temperature, coldest -> hottest (D-038; the owner's final choice, 2026-11-26: "red to yellow to green to blue, the
   * coldest blue on the edge"): 17 samples of the Turbo map (Mikhailov 2019) between 0.06 and 0.94, indigo-blue -> cyan
   * -> green -> yellow -> orange -> red. Read on a LINEAR scale from 0 to the core temperature, so the cold edge (~2 MK)
   * is the coldest blue and the hot core red.
   */
  temperature: ['#493dab', '#4763e9', '#3789f9', '#29aeec', '#25cdd0', '#2fe6ac', '#48f789', '#6cfd69', '#96fa50', '#c1ed3d', '#e5d730', '#feb927', '#ff9520', '#fe6e1a', '#e54813', '#c2270a', '#a01101'],
  /** Heat on the move (D-039): glowing comets from the core to the divertors and between them; warm gold tails. */
  heatGlow: '#ffa94d',
  /** The bright head of a heat comet. */
  heatGlowCore: '#ffd88a',
  /**
   * Change in the edge field the coils make (ΔB/B₀), weaker -> no change -> stronger: purple -> grey -> orange (a diverging
   * map; it replaces the temperature colours on the surface while the field-change layer is on, with its own colour bar).
   */
  fieldChange: ['#5e3c99', '#a596cc', '#8f959a', '#f3b277', '#d95f02'],
  /** The warm band of a divertor target (the old ramp's yellow, kept when the ramp widened). */
  targetWarm: '#f4c75c',
  tracer: '#fff4ca',
  particleColours: ['#fe4e93', '#31c8ff', '#ffbc32', '#a987ff', '#70e65a'],
  solenoid: { steel: '#a9b6c6', jacket: '#b790c2', copper: '#dc9362', collar: '#56658b', fastener: '#d7d9e1' },
  targetCold: '#263447',
  targetHot: '#ff6433',
  windings: ['#92a9bf', '#c59c78'],
  vessel: '#98b6c7',
} as const;
