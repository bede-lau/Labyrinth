// @vitest-environment node
// D4: every colour in the renderer comes from tokens.ts.
// (1) Static scan of ALL of renderer/src (+ index.html): no colour literal — hex, functional
//     notation, 0xRRGGBB, or a CSS named colour — outside tokens.ts / tokens.css.
// (2) Runtime: every colour the Plotly/Three themes emit is a token value (or a token at an alpha).
//
// Exemptions are explicit and listed below with their reason; each one is itself tested, so a stale
// or over-broad exemption fails. Nothing else is allow-listed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { withAlpha } from './color';
import { parseCss } from './cssRules';
import {
  axisTitle,
  meanSegment,
  plotLayout,
  seriesStyle,
  uncertaintyBand,
  unsampledShapes,
  windowShape,
} from './plotTheme';
import { sceneTheme } from './sceneTheme';
import { SERIES_IDS, THEMES, themes, type ThemeName } from './tokens';

const SRC = resolve(import.meta.dirname, '..'); // renderer/src
const RENDERER = resolve(SRC, '..');
const rel = (f: string) => relative(RENDERER, f).split('\\').join('/');

// ---- what counts as a colour literal -----------------------------------------------------------

/** Hex (#abc, #aabbcc, #aabbccdd), functional colours, and 0xRRGGBB integers. */
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color-mix|color)\(|\b0x[0-9a-fA-F]{6}\b/;

/** The 148 CSS named colours (CSS Color 4). `transparent` and `currentColor` are keywords, not colours. */
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
    'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
    'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
    'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen'
  ).split(' '),
);

/** Strip comments so documentation may mention a colour. Keeps line breaks, so line numbers survive. */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Named colours used as a value: whole words, not part of a hyphenated keyword, a var() name, a URL or a quoted string. */
function namedColorsInCssValue(value: string): string[] {
  const bare = value
    .replace(/var\(\s*--[\w-]+/g, 'var(')
    .replace(/url\([^)]*\)/g, ' ')
    .replace(/"[^"]*"|'[^']*'/g, ' ');
  const hits: string[] = [];
  for (const m of bare.matchAll(/(^|[^\w.#-])([A-Za-z]+)(?![\w(-])/g)) {
    const word = (m[2] as string).toLowerCase();
    if (NAMED_COLORS.has(word)) hits.push(m[2] as string);
  }
  return hits;
}

/**
 * Marks a string as a CSS value rather than prose: a length (`2px`, `${w}px`, `0.5em`), a line style
 * (`solid`, `dotted`, …), `inset`, or a gradient. Its words are then read as a CSS value is.
 */
const CSS_VALUE_HINT = /\d(?:px|em|rem|ch|vh|vw)\b|\}(?:px|em|rem)\b|\b(?:solid|dashed|dotted|double|groove|ridge|inset|outset)\b|gradient\(/;

/**
 * A string literal that is a colour name, or a CSS value that holds one anywhere: a border or outline
 * shorthand, a box shadow, a gradient, a template literal with interpolated lengths (design-r1-R5).
 */
function namedColorInString(text: string): string | null {
  const s = text.trim();
  if (NAMED_COLORS.has(s.toLowerCase())) return s;
  if (CSS_VALUE_HINT.test(s)) return namedColorsInCssValue(s)[0] ?? null;
  return null;
}

interface Hit {
  line: number;
  text: string;
  why: string;
}

export function findColorLiterals(source: string, kind: 'css' | 'code'): Hit[] {
  const src = stripComments(source);
  const lines = src.split('\n');
  const hits: Hit[] = [];
  lines.forEach((l, i) => {
    if (COLOR_LITERAL.test(l)) hits.push({ line: i + 1, text: l.trim(), why: 'colour literal' });
  });
  const lineOf = (needle: string, from = 0) => {
    const at = src.indexOf(needle, from);
    return at < 0 ? 0 : src.slice(0, at).split('\n').length;
  };
  if (kind === 'css') {
    for (const rule of parseCss(source))
      for (const [prop, value] of Object.entries(rule.decl))
        for (const name of namedColorsInCssValue(value))
          hits.push({ line: lineOf(`${prop}:`), text: `${rule.selectors.join(', ')} { ${prop}: ${value} }`, why: `named colour "${name}"` });
  } else {
    const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    for (const m of src.matchAll(literal)) {
      const name = namedColorInString(m[1] ?? m[2] ?? m[3] ?? '');
      if (name) hits.push({ line: src.slice(0, m.index).split('\n').length, text: m[0], why: `named colour "${name}"` });
    }
  }
  return hits;
}

// ---- exemptions --------------------------------------------------------------------------------

/** Whole files that may hold colour values, with the reason. Paths are relative to renderer/. */
const EXEMPT_FILES: Record<string, string> = {
  'src/design/tokens.ts': 'the single source of every colour value',
  'src/design/tokens.css': 'generated from tokens.ts; byte equality is tested in tokens.test.ts',
};
/** Test files hold reference colours and negative controls and never ship. */
const isTest = (f: string) => /\.test\.tsx?$/.test(f);
/** Single lines that format a token and hold no colour value. Matched exactly (trimmed). */
const EXEMPT_LINES: { file: string; line: string; reason: string }[] = [
  {
    file: 'src/design/color.ts',
    line: 'return `rgba(${r}, ${g}, ${b}, ${alpha})`;',
    reason: 'withAlpha(): writes a token at an alpha; the numbers come from the token',
  },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const scanned = [...walk(SRC).filter((f) => /\.(tsx?|css|html)$/.test(f)), join(RENDERER, 'index.html')];
const targets = scanned.filter((f) => !(rel(f) in EXEMPT_FILES) && !isTest(f));

function violations(file: string): string[] {
  const r = rel(file);
  const exempt = EXEMPT_LINES.filter((e) => e.file === r).map((e) => e.line);
  return findColorLiterals(readFileSync(file, 'utf8'), file.endsWith('.css') ? 'css' : 'code')
    .filter((h) => !exempt.includes(h.text))
    .map((h) => `${r}:${h.line}: ${h.why}: ${h.text}`);
}

// ---- tests -------------------------------------------------------------------------------------

describe('colour-literal scanner (positive controls: it must be able to fail)', () => {
  test.each(['color: "#0b7f80"', "fill: '#fff'", 'rgba(0, 0, 0, 0.5)', 'new Color(0x0b7f80)', 'hsl(180 50% 40%)', 'color-mix(in srgb, x, y)'])(
    'detects %s',
    (s) => expect(COLOR_LITERAL.test(s)).toBe(true),
  );
  test.each(['var(--lab-color-text)', 'themes[theme].series.GX', 'id="#gallery-1"'.replace('#', ''), 'href="#d-007"', 'location.hash === "#gallery"'])(
    'ignores %s',
    (s) => expect(COLOR_LITERAL.test(s)).toBe(false),
  );

  // Mutation M11: `color: red;` in a stylesheet.  M12a: hex + rgb() in a feature stylesheet.
  test.each([
    ['.a { color: red; }', 'named colour "red"'],
    ['.a { border: 1px solid Black }', 'named colour "Black"'],
    ['.a { background: linear-gradient(to right, white, var(--lab-color-bg)); }', 'named colour "white"'],
    ['.a { --edge: teal; }', 'named colour "teal"'],
    ['@container (min-width: 720px) { .a { outline-color: gold } }', 'named colour "gold"'],
    ['.tr-probe { color: #ff0000; background: rgb(1, 2, 3); }', 'colour literal'],
  ])('CSS: flags %s', (css, why) => {
    expect(findColorLiterals(css, 'css').map((h) => h.why)).toContain(why);
  });
  test.each([
    '.a { color: var(--lab-color-text); background: transparent; border-color: currentColor; }',
    '.a { white-space: nowrap; display: inline-flex; align-items: flex-start; }',
    '.a { font-family: "Snow Sans", ui-sans-serif; content: "red"; }',
    '.a { color: var(--lab-status-live-fg); outline: 2px solid var(--lab-color-focus); }',
    '.a { /* was: color: red */ width: calc(100% - 2px); transform: rotate(90deg); }',
    '.a:hover .gold, .tan-row { margin: 0 }',
  ])('CSS: accepts %s', (css) => {
    expect(findColorLiterals(css, 'css')).toEqual([]);
  });

  // Mutation M12b: a hex literal in a feature module; plus named colours in TS / JSX.
  test.each([
    ["export const PROBE_COLOR = '#ff00ff';", 'colour literal'],
    ["const style = { color: 'red' };", 'named colour "red"'],
    ['<path stroke="black" />', 'named colour "black"'],
    ["el.style.border = '1px solid orange';", 'named colour "orange"'],
    ['const bg = `linear-gradient(90deg, white, ${x})`;', 'named colour "white"'],
    ['scene.background = new Color(0x112233);', 'colour literal'],
    // design-r1-R5 (mutation MUT-G): CSS values in code that are not a bare `Npx solid name` shorthand.
    ["const s = { boxShadow: '0 0 0 2px red' };", 'named colour "red"'],
    ['el.style.border = `${1}px solid red`;', 'named colour "red"'],
    ["const o = { outline: 'thin dotted red' };", 'named colour "red"'],
    ["const o = { outline: '2px solid var(--lab-color-focus)', boxShadow: 'inset 0 0 0 1px Navy' };", 'named colour "Navy"'],
    ['const ring = `0 0 0 ${w}px gold, 0 1px 2px var(--lab-color-shadow)`;', 'named colour "gold"'],
  ])('code: flags %s', (code, why) => {
    expect(findColorLiterals(code, 'code').map((h) => h.why)).toContain(why);
  });
  test.each([
    "const a = themes[theme].color.text; // was '#fff'",
    '<circle fill="none" stroke="currentColor" />',
    "const label = 'Gray = unsampled or context, never data';",
    "const url = 'https://example.org/#/a?b=c';",
    "/* 'red' */ const tone = 'warn';",
    // CSS-looking strings with token colours only, and prose that happens to hold a length or a style word
    "const o = { outline: '2px solid var(--lab-color-focus)', boxShadow: '0 1px 2px var(--lab-color-shadow)' };",
    'const w = `${width}px`;',
    "const note = 'The hover modebar is about 216px wide and would cover a top legend on a phone.';",
    "const label = 'A dashed outline means the value is not backed by data in this repo.';",
  ])('code: accepts %s', (code) => {
    expect(findColorLiterals(code, 'code')).toEqual([]);
  });
});

describe('the scan covers the whole renderer, not only the design folder (F3)', () => {
  const scannedRel = targets.map(rel);
  test('walks every source folder that exists and index.html', () => {
    const folders = readdirSync(SRC).filter((n) => statSync(join(SRC, n)).isDirectory());
    expect(folders).toEqual(expect.arrayContaining(['design', 'features', 'shell', 'lib']));
    for (const folder of folders)
      expect(scannedRel.some((f) => f.startsWith(`src/${folder}/`)), `src/${folder} is scanned`).toBe(true);
    expect(scannedRel).toEqual(
      expect.arrayContaining(['index.html', 'src/main.tsx', 'src/design/plotTheme.ts', 'src/design/sceneTheme.ts', 'src/design/components/components.css']),
    );
    expect(scannedRel.filter((f) => f.endsWith('.css') && !f.startsWith('src/design/')).length).toBeGreaterThan(3);
  });
  test('exemptions are exact: the files exist, hold colours, and the exempt lines are really there', () => {
    for (const f of Object.keys(EXEMPT_FILES)) {
      expect(existsSync(join(RENDERER, f)), f).toBe(true);
      expect(findColorLiterals(readFileSync(join(RENDERER, f), 'utf8'), f.endsWith('.css') ? 'css' : 'code').length, f).toBeGreaterThan(0);
    }
    for (const e of EXEMPT_LINES) {
      const hits = findColorLiterals(readFileSync(join(RENDERER, e.file), 'utf8'), 'code').map((h) => h.text);
      expect(hits, `${e.file}: ${e.reason}`).toContain(e.line);
    }
    expect(Object.keys(EXEMPT_FILES).sort()).toEqual(['src/design/tokens.css', 'src/design/tokens.ts']);
    expect(EXEMPT_LINES).toHaveLength(1);
  });
});

describe('no hard-coded colours outside tokens', () => {
  test.each(targets.map((f) => [rel(f), f] as const))('%s has no colour literals', (_r, f) => {
    expect(violations(f)).toEqual([]);
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
    for (const a of [0, themes[theme].plot.unsampledAlpha, themes[theme].plot.bandAlpha]) vals.add(withAlpha(v, a));
  }
  return vals;
}

describe.each(THEMES)('emitted theme colours are tokens — %s', (theme) => {
  const allowed = tokenValues(theme);
  const emitted = [
    plotLayout(theme, { xaxis: { title: { text: axisTitle('Time', 'a/v_{th,i}') } } }),
    plotLayout(theme, {}, { narrow: true }),
    ...SERIES_IDS.map((s) => seriesStyle(s, theme)),
    ...SERIES_IDS.map((s) => uncertaintyBand([0, 1], [1, 2], 0.1, s, theme)),
    windowShape([300, 400], theme, '300–400'),
    ...unsampledShapes([0, 100], theme),
    meanSegment([1200, 1500], 2.22, 'triangular', theme),
    sceneTheme(theme),
  ];
  test('every colour is a token value', () => {
    const colors = colorStrings(emitted);
    expect(colors.length).toBeGreaterThan(30);
    expect(colors.filter((c) => !allowed.has(c))).toEqual([]);
  });
});
