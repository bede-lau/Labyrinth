// D4: plotTheme.ts and sceneTheme.ts (and every other design file) derive colours from tokens.
// (1) Static scan: no colour literals outside tokens.ts / tokens.css.
// (2) Runtime: every colour the Plotly/Three themes emit is a token value (or a token at an alpha).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { withAlpha } from './color';
import {
  axisTitle,
  meanSegment,
  plotLayout,
  seriesStyle,
  uncertaintyBand,
  unsampledShape,
  windowShape,
} from './plotTheme';
import { sceneTheme } from './sceneTheme';
import { SERIES_IDS, THEMES, themes, type ThemeName } from './tokens';

const DESIGN = resolve(import.meta.dirname);

// Hex (#abc, #aabbcc, #aabbccdd), functional colours, and 0xRRGGBB integers.
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(|\b0x[0-9a-fA-F]{6}\b/;

/** Files allowed to hold literals: the token source, its generated CSS, the colour maths, tests, docs. */
const ALLOWED = new Set(['tokens.ts', 'tokens.css', 'color.ts', 'DESIGN.md']);
const isTest = (f: string) => /\.test\.tsx?$/.test(f);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Strip comments so documentation may mention a hex value. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('colour-literal scanner (positive controls: it must be able to fail)', () => {
  test.each(['color: "#0b7f80"', "fill: '#fff'", 'rgba(0, 0, 0, 0.5)', 'new Color(0x0b7f80)', 'hsl(180 50% 40%)'])(
    'detects %s',
    (s) => expect(COLOR_LITERAL.test(s)).toBe(true),
  );
  test.each(['var(--lab-color-text)', 'themes[theme].series.GX', 'id="#gallery-1"'.replace('#', '')])(
    'ignores %s',
    (s) => expect(COLOR_LITERAL.test(s)).toBe(false),
  );
});

describe('no hard-coded colours outside tokens', () => {
  const files = walk(DESIGN).filter((f) => /\.(tsx?|css)$/.test(f));
  const targets = files.filter((f) => !ALLOWED.has(f.split('/').pop() as string) && !isTest(f));

  test('scans plotTheme.ts, sceneTheme.ts and the components', () => {
    const rel = targets.map((f) => relative(DESIGN, f));
    expect(rel).toEqual(expect.arrayContaining(['plotTheme.ts', 'sceneTheme.ts', 'components/components.css']));
  });

  test.each(targets.map((f) => [relative(DESIGN, f), f] as const))('%s has no colour literals', (_r, f) => {
    const lines = stripComments(readFileSync(f, 'utf8')).split('\n');
    const hits = lines.map((l, i) => [i + 1, l] as const).filter(([, l]) => COLOR_LITERAL.test(l));
    expect(hits.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});

/** Collect every string that looks like a colour inside an arbitrary object. */
function colorStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^#[0-9a-fA-F]{3,8}$|^rgba?\(/.test(value)) out.push(value);
  } else if (Array.isArray(value)) value.forEach((v) => colorStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => colorStrings(v, out));
  return out;
}

function tokenValues(theme: ThemeName): Set<string> {
  const vals = new Set(colorStrings(themes[theme]));
  // Derived alphas are allowed only as token-at-alpha.
  for (const v of [...vals]) {
    if (!v.startsWith('#')) continue;
    for (const a of [0, 0.35, themes[theme].plot.bandAlpha]) vals.add(withAlpha(v, a));
  }
  return vals;
}

describe.each(THEMES)('emitted theme colours are tokens — %s', (theme) => {
  const allowed = tokenValues(theme);
  const emitted = [
    plotLayout(theme, { xaxis: { title: { text: axisTitle('Time', 'a/v_{th,i}') } } }),
    ...SERIES_IDS.map((s) => seriesStyle(s, theme)),
    ...SERIES_IDS.map((s) => uncertaintyBand([0, 1], [1, 2], 0.1, s, theme)),
    windowShape([300, 400], theme, '300–400'),
    unsampledShape([0, 100], theme),
    meanSegment([1200, 1500], 2.22, 'triangular', theme),
    sceneTheme(theme),
  ];
  test('every colour is a token value', () => {
    const colors = colorStrings(emitted);
    expect(colors.length).toBeGreaterThan(30);
    expect(colors.filter((c) => !allowed.has(c))).toEqual([]);
  });
});
