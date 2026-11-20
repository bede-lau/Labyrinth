// @vitest-environment node
// D1: DESIGN.md documents the system and stays in sync with the code it describes — in BOTH
// directions: every token, status, series, component and export in the code has its row in the
// document with the right values, and every row in the document names something that exists.
// (Verifier finding F4: the old test sampled 7 of 17 colour tokens, code -> doc only.)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NON_TEXT_MIN, TEXT_MIN, worstContrast } from './contrastPairs';
import * as publicApi from './index';
import { PALETTE_GATES, seriesMinDeltaE } from './palette';
import * as plotThemeModule from './plotTheme';
import * as sceneThemeModule from './sceneTheme';
import { CALLOUT_META, STATUS_META } from './status';
import {
  CALLOUT_TONES,
  SERIES_IDS,
  STATUS_KINDS,
  THEMES,
  fontWeight,
  motion,
  radius,
  renderTokenReferenceMd,
  space,
  staticCssVars,
  themeCssVars,
  themes,
  typeScale,
  zIndex,
} from './tokens';

const DESIGN = resolve(import.meta.dirname);
const RENDERER = resolve(DESIGN, '../..');
const doc = readFileSync(resolve(DESIGN, 'DESIGN.md'), 'utf8');

// ---- a small Markdown reader -------------------------------------------------------------------

/** The body of the section whose heading matches, up to the next heading of the same or a higher level. */
function section(heading: RegExp): string {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => /^#{2,3} /.test(l) && heading.test(l));
  if (start < 0) throw new Error(`DESIGN.md has no section matching ${heading}`);
  const level = (/^#+/.exec(lines[start] as string) as RegExpExecArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i] as string);
    if (m && (m[1] as string).length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

interface Table {
  header: string[];
  rows: string[][];
}

function tables(block: string): Table[] {
  const out: Table[] = [];
  let cur: string[] = [];
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  const flush = () => {
    if (cur.length >= 2) out.push({ header: cells(cur[0] as string), rows: cur.slice(2).map(cells) });
    cur = [];
  };
  for (const l of block.split('\n')) {
    if (l.trim().startsWith('|')) cur.push(l);
    else flush();
  }
  flush();
  return out;
}

function tableIn(heading: RegExp, firstHeader: string): Table {
  const t = tables(section(heading)).find((x) => x.header[0] === firstHeader);
  if (!t) throw new Error(`no table starting with "${firstHeader}" under ${heading}`);
  return t;
}

/** Text inside backticks, in order. */
const codes = (cell: string | undefined) => [...(cell ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
const code = (cell: string | undefined) => codes(cell)[0];
/** Cell text without Markdown emphasis or code marks. */
const plain = (cell: string | undefined) => (cell ?? '').replace(/[*`]/g, '').trim();
const numbers = (text: string) => [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

// ---- structure ---------------------------------------------------------------------------------

test.each([
  'Principles',
  'Files',
  'Tokens',
  'Type scale',
  'Spacing, radius, elevation, motion',
  'Series palette',
  'Status semantics',
  'Chart conventions',
  '3D scene conventions',
  'Components',
  'Do / Don',
  'Accessibility checklist',
  'Public API',
  'Token reference',
])('has a "%s" section', (h) => {
  expect(doc).toMatch(new RegExp(`^#{2,3} .*${h.replace(/[/]/g, '\\/')}`, 'm'));
});

test('the reader itself: a missing section or table is an error, not an empty pass', () => {
  expect(() => section(/No such section/)).toThrow(/no section/);
  expect(() => tableIn(/Principles/, 'Token')).toThrow(/no table/);
  expect(tables('| a | b |\n|---|---|\n| `x` | **y** |\n\ntext')).toEqual([{ header: ['a', 'b'], rows: [['`x`', '**y**']] }]);
});

// ---- §2 files ----------------------------------------------------------------------------------

describe('§2 Files: the table and the folder list the same things', () => {
  const listedPaths = () => tableIn(/^## 2\. Files/, 'File').rows.flatMap((r) => codes(r[0]));
  const entries = readdirSync(DESIGN, { withFileTypes: true });
  test('every listed path exists (a `*` entry is a pattern that must match a file)', () => {
    const listed = listedPaths();
    expect(listed.length).toBeGreaterThan(10);
    for (const p of listed) {
      if (p.includes('*')) {
        const re = new RegExp(`^${p.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`);
        expect(entries.some((e) => re.test(e.name)), p).toBe(true);
      } else expect(existsSync(resolve(DESIGN, p)) || existsSync(resolve(RENDERER, p)), p).toBe(true);
    }
  });
  test('every source file in design/ is listed (tests are covered by their pattern row)', () => {
    const listed = listedPaths();
    const present = entries
      .filter((e) => !/\.test\.tsx?$/.test(e.name) && e.name !== 'DESIGN.md')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    expect(present.filter((p) => !listed.includes(p))).toEqual([]);
    expect(listed).toContain('*.test.ts');
  });
});

// ---- §3 tokens ---------------------------------------------------------------------------------

describe('§3 colour table: one row per `color.*` token, both themes', () => {
  const table = () => tableIn(/Colour: neutrals and accent/, 'Token').rows;
  const keys = Object.keys(themes.light.color);
  test('rows are exactly the tokens, in the order of tokens.ts', () => {
    expect(table().map((r) => code(r[0]))).toEqual(keys.map((k) => `color.${k}`));
  });
  test.each(keys)('color.%s shows the current light and dark values', (k) => {
    const row = table().find((r) => code(r[0]) === `color.${k}`);
    expect(code(row?.[1]), 'light').toBe(themes.light.color[k as keyof typeof themes.light.color]);
    expect(code(row?.[2]), 'dark').toBe(themes.dark.color[k as keyof typeof themes.dark.color]);
    expect(plain(row?.[3]).length, 'has a use').toBeGreaterThan(3);
  });
});

describe('§3 scales', () => {
  test('type scale: the rows are the scale', () => {
    const rows = tableIn(/Type scale/, 'Step').rows;
    const fromDoc = Object.fromEntries(rows.map((r) => [code(r[0]), numbers(r[1] ?? '')]));
    expect(fromDoc).toEqual(Object.fromEntries(Object.entries(typeScale).map(([k, v]) => [k, [...v]])));
    expect(rows).toHaveLength(Object.keys(typeScale).length);
  });
  test('font weights', () => {
    const m = /Weights are ([^.]+)\./.exec(section(/Type scale/));
    expect(numbers(m?.[1] ?? '')).toEqual(Object.values(fontWeight));
  });
  const scalesText = () => section(/Spacing, radius, elevation, motion/);
  test('spacing: every step and its px value', () => {
    const scales = scalesText();
    const steps = /--lab-space-\{([^}]+)\}/.exec(scales)?.[1]?.split(',').map((s) => s.trim()) ?? [];
    const px = numbers(/maps to\s+([\d,\s]+and\s+\d+)\s+px/.exec(scales)?.[1] ?? '');
    expect(steps.length).toBe(px.length);
    expect(Object.fromEntries(steps.map((s, i) => [s, px[i]]))).toEqual({ ...space });
  });
  test('radius', () => {
    const scales = scalesText();
    const line = /\*\*Radius\*\*:([^\n]*(?:\n {2}[^\n]*)*)/.exec(scales)?.[1] ?? '';
    const fromDoc = Object.fromEntries([...line.matchAll(/`(\w+)` (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(fromDoc).toEqual({ ...radius });
  });
  test('motion and layers', () => {
    const scales = scalesText();
    const m = /\*\*Motion\*\*: (\d+ms) for hover and state, (\d+ms) for disclosure, easing `([^`]+)`/.exec(scales);
    expect(m?.slice(1)).toEqual([motion.fast, motion.base, motion.easing]);
    const layers = /\*\*Layers\*\*:([^\n]*)/.exec(scales)?.[1] ?? '';
    expect(Object.fromEntries([...layers.matchAll(/`(\w+)` (\d+)/g)].map((x) => [x[1], Number(x[2])]))).toEqual({ ...zIndex });
  });
});

// ---- §4 series ---------------------------------------------------------------------------------

describe('§4 series table and the measured colour differences', () => {
  const table = () => tableIn(/^## 4\. Series palette/, 'Series').rows;
  test('rows are exactly the five series, in order', () => {
    expect(table().map((r) => code(r[0]))).toEqual([...SERIES_IDS]);
  });
  test.each([...SERIES_IDS])('%s: legend name, both colours, dash, marker and width', (id) => {
    const row = table().find((r) => code(r[0]) === id);
    const style = plotThemeModule.seriesStyle(id, 'light');
    expect(plain(row?.[1])).toBe(plotThemeModule.SERIES_LABEL[id]);
    expect(code(row?.[2])).toBe(themes.light.series[id]);
    expect(code(row?.[3])).toBe(themes.dark.series[id]);
    expect(code(row?.[4])).toBe(style.line.dash);
    expect(code(row?.[5])).toBe(style.marker.symbol);
    expect(Number(plain(row?.[6]))).toBe(style.line.width);
  });
  const paletteText = () => section(/^## 4\. Series palette/);
  const fixed = (n: number) => n.toFixed(1);
  test('protanopia / deuteranopia: the gate and the measured minimum', () => {
    const palette = paletteText();
    const m = /At least (\d+) ΔE00 under full-severity protanopia and deuteranopia[\s\S]*?Measured minimum: ([\d.]+) \(light\) and ([\d.]+) \(dark\)/.exec(palette);
    expect(Number(m?.[1])).toBe(PALETTE_GATES.cvd);
    const measured = THEMES.map((t) => fixed(Math.min(seriesMinDeltaE(t, 'protanopia'), seriesMinDeltaE(t, 'deuteranopia'))));
    expect([m?.[2], m?.[3]]).toEqual(measured);
  });
  test('normal vision and tritanopia: the gates and the measured minima', () => {
    const palette = paletteText();
    const n = /At least (\d+) ΔE00 in normal vision\. Measured: ([\d.]+) \(light\) and ([\d.]+) \(dark\)/.exec(palette);
    expect(Number(n?.[1])).toBe(PALETTE_GATES.normal);
    expect([n?.[2], n?.[3]]).toEqual(THEMES.map((t) => fixed(seriesMinDeltaE(t, 'normal'))));
    const tr = /At least (\d+) ΔE00 under tritanopia\. Measured: ([\d.]+) \(light\) and ([\d.]+) \(dark\)/.exec(palette);
    expect(Number(tr?.[1])).toBe(PALETTE_GATES.tritan);
    expect([tr?.[2], tr?.[3]]).toEqual(THEMES.map((t) => fixed(seriesMinDeltaE(t, 'tritanopia'))));
  });
});

// ---- §5 status ---------------------------------------------------------------------------------

describe('§5 status table: one row per status, with the icon and text the code draws', () => {
  const table = () => tableIn(/^## 5\. Status semantics/, 'Status').rows;
  test('rows are exactly the status kinds, in order', () => {
    expect(table().map((r) => code(r[0]))).toEqual([...STATUS_KINDS]);
  });
  test.each([...STATUS_KINDS])('`%s`: icon name, visible text and the dashed rule', (k) => {
    const row = table().find((r) => code(r[0]) === k);
    expect(code(row?.[1]), 'icon').toBe(STATUS_META[k].icon);
    expect(plain(row?.[2]), 'text').toBe(STATUS_META[k].label);
    expect(/dashed/i.test(row?.[3] ?? ''), 'dashed outline').toBe(Boolean(STATUS_META[k].dashed));
  });
  test('callout tones and their spoken prefixes', () => {
    const s = section(/^## 5\. Status semantics/);
    for (const tone of CALLOUT_TONES) {
      expect(s, tone).toContain(`**${tone}**`);
      expect(s, tone).toContain(`"${CALLOUT_META[tone].spoken}:"`);
    }
  });
  test('the live rule for provenance is stated: kind `live` needs the `live` flag, otherwise "Recorded run"', () => {
    const s = section(/^## 5\. Status semantics/);
    expect(s).toMatch(/`live` prop/);
    expect(s).toContain('Recorded run');
  });
  // DL-1: the mapping table follows the states the live-status store exposes (lib/, read as text:
  // the design system never imports from it).
  test('the live-state mapping names every mode, store status and danger kind the store exposes', () => {
    const lib = resolve(RENDERER, 'src/lib');
    const contract = readFileSync(resolve(lib, 'liveContract.ts'), 'utf8');
    const store = readFileSync(resolve(lib, 'liveStatus.ts'), 'utf8');
    const quoted = (src: string | undefined) => [...(src ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
    const modes = quoted(/export type LiveMode = ([^;]+);/.exec(contract)?.[1]);
    const stateType = /export type LiveState =([\s\S]*?);\n\n/.exec(store)?.[1] ?? '';
    const statuses = [...stateType.matchAll(/status: '([a-z-]+)'/g)].map((m) => m[1] as string);
    const kinds = quoted(/interface LiveDanger \{\s*kind: ((?:'[^']+'\s*\|?\s*)+);/.exec(store)?.[1]);
    expect(modes).toEqual(['unavailable', 'idle', 'launching', 'live', 'fallback', 'terminated']);
    expect(new Set(statuses)).toEqual(new Set(['connecting', 'unreachable', 'ready']));
    expect(kinds.length).toBeGreaterThanOrEqual(3);
    const table = tableIn(/^## 5\. Status semantics/, 'Live state');
    const named = new Set(table.rows.flatMap((r) => codes(r[0])));
    for (const name of [...modes, ...statuses, ...kinds, 'stale']) expect(named, name).toContain(name);
    // Every danger row uses the billing-risk pill and the Alert.
    for (const kind of kinds) {
      const row = table.rows.find((r) => codes(r[0]).includes(kind));
      expect(row?.[1], kind).toContain('status="billing-risk"');
      expect(row?.[2], kind).toContain('<Alert');
    }
  });
});

// ---- §6, §7 charts and scene -------------------------------------------------------------------

describe('§6 / §7: every helper the chart and scene themes export is named where it is explained', () => {
  const chartsText = () => section(/^## 6\. Chart conventions/);
  const sceneText = () => section(/^## 7\. 3D scene conventions/);
  test.each(Object.keys(plotThemeModule))('plotTheme.%s is named in §6', (name) => {
    expect(chartsText()).toMatch(new RegExp('`' + name + '\\b'));
  });
  test.each(Object.keys(sceneThemeModule))('sceneTheme.%s is named in §7', (name) => {
    expect(sceneText()).toMatch(new RegExp('`' + name + '\\b'));
  });
  test('chart conventions: units in axis titles, uncertainty bands, window shading, gray = unsampled', () => {
    const charts = chartsText();
    expect(charts).toMatch(/Units in every axis title/);
    expect(charts).toMatch(/Gray = unsampled/);
  });
  test('alphas quoted in §6 are the token values', () => {
    const charts = chartsText();
    const band = /`plot\.bandAlpha` \((\d+)% light, (\d+)% dark\)/.exec(charts);
    expect(band?.slice(1).map(Number)).toEqual(THEMES.map((t) => Math.round(themes[t].plot.bandAlpha * 100)));
    const uns = /`plot\.unsampledAlpha` \((\d+)% light, (\d+)% dark\)/.exec(charts);
    expect(uns?.slice(1).map(Number)).toEqual(THEMES.map((t) => Math.round(themes[t].plot.unsampledAlpha * 100)));
    expect(charts).toContain(`\`${plotThemeModule.NARROW_CHART_QUERY}\``);
  });
});

// ---- §8 components -----------------------------------------------------------------------------

describe('§8 components table and index.ts list the same components', () => {
  const documentedRows = () => tableIn(/^## 8\. Components/, 'Component').rows.flatMap((r) => codes(r[0]));
  const indexSource = readFileSync(resolve(DESIGN, 'index.ts'), 'utf8');
  const exported = [...indexSource.matchAll(/export \{([^}]+)\} from '\.\/components\/\w+'/g)]
    .flatMap((m) => (m[1] as string).split(','))
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('type ') && /^[A-Z]/.test(s));
  test('index.ts exports the ten primitives (the control for this test)', () => {
    expect(exported.sort()).toEqual(['Alert', 'Callout', 'FixtureCheck', 'Icon', 'Panel', 'ProvenanceBadge', 'SegmentedControl', 'Stat', 'StatusPill', 'Unit']);
    for (const name of exported) expect(typeof (publicApi as Record<string, unknown>)[name], name).toBe('function');
  });
  test('every exported component has a row', () => {
    const documented = documentedRows();
    expect(exported.filter((c) => !documented.includes(c))).toEqual([]);
  });
  test('every row names an exported component', () => {
    const documented = documentedRows();
    expect(documented.filter((c) => !exported.includes(c))).toEqual([]);
  });
});

// ---- §10 accessibility -------------------------------------------------------------------------

describe('§10 quotes the measured worst contrast', () => {
  test('text and non-text worst cases, both themes, to two decimals', () => {
    const a11y = section(/^## 10\. Accessibility checklist/);
    const m = /text ([\d.]+):1 \(light\) and ([\d.]+):1 \(dark\); non-text ([\d.]+):1 \(light\) and ([\d.]+):1 \(dark\)/.exec(a11y);
    expect(m, 'the "Measured worst cases" sentence').not.toBeNull();
    expect([m?.[1], m?.[2]]).toEqual(THEMES.map((t) => worstContrast(t, TEXT_MIN).ratio.toFixed(2)));
    expect([m?.[3], m?.[4]]).toEqual(THEMES.map((t) => worstContrast(t, NON_TEXT_MIN).ratio.toFixed(2)));
  });
});

// ---- §11 public API ----------------------------------------------------------------------------

describe('§11 Public API lists exactly what index.ts exports at runtime', () => {
  const listedNames = () => tableIn(/^## 11\. Public API/, 'Module').rows.flatMap((r) => codes(r[1]));
  const actual = Object.keys(publicApi);
  test('nothing exported is missing from the list', () => {
    const listed = listedNames();
    expect(actual.filter((n) => !listed.includes(n)).sort()).toEqual([]);
  });
  test('nothing listed is missing from the exports', () => {
    const listed = listedNames();
    expect(listed.filter((n) => !actual.includes(n)).sort()).toEqual([]);
  });
  test('no name is listed twice', () => {
    const listed = listedNames();
    expect(listed.filter((n, i) => listed.indexOf(n) !== i)).toEqual([]);
  });
});

// ---- §12 token reference -----------------------------------------------------------------------

describe('§12 Token reference: every custom property, with the values tokens.css carries', () => {
  const ref = () => tables(section(/^## 12\. Token reference/));
  test('the generated block equals renderTokenReferenceMd() byte for byte — run `npm run tokens` if this fails', () => {
    const begin = doc.indexOf('<!-- tokens:begin');
    const end = doc.indexOf('<!-- tokens:end -->');
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(doc.slice(doc.indexOf('\n', begin) + 1, end)).toBe(`\n${renderTokenReferenceMd()}\n\n`);
  });
  test('theme tokens: the rows are exactly the theme custom properties, light and dark', () => {
    const themed = ref().find((t) => t.header.length === 3);
    const fromDoc = Object.fromEntries((themed?.rows ?? []).map((r) => [code(r[0]), [code(r[1]), code(r[2])]]));
    const light = themeCssVars('light');
    const dark = themeCssVars('dark');
    const fromCode = Object.fromEntries(Object.keys(light).map((k) => [k, [light[k], dark[k]]]));
    expect(Object.keys(fromDoc).sort()).toEqual(Object.keys(fromCode).sort());
    expect(fromDoc).toEqual(fromCode);
    expect(themed?.rows.length).toBe(Object.keys(light).length);
  });
  test('scale tokens: the rows are exactly the theme-independent custom properties', () => {
    const fixed = ref().find((t) => t.header.length === 2);
    const fromDoc = Object.fromEntries((fixed?.rows ?? []).map((r) => [code(r[0]), code(r[1])]));
    expect(fromDoc).toEqual(staticCssVars());
    expect(fixed?.rows.length).toBe(Object.keys(staticCssVars()).length);
  });
});

// ---- document -> code, everywhere --------------------------------------------------------------

describe('nothing in DESIGN.md names a value or a property that does not exist', () => {
  const tokenValues = new Set(THEMES.flatMap((t) => Object.values(themeCssVars(t))));
  const properties = [...Object.keys(themeCssVars('light')), ...Object.keys(staticCssVars())];
  test('every hex colour quoted anywhere is a current token value', () => {
    const quoted = [...new Set([...doc.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]))];
    expect(quoted.length).toBeGreaterThan(100);
    expect(quoted.filter((h) => !tokenValues.has(h))).toEqual([]);
  });
  test('every --lab-* name (or name pattern) matches a real custom property', () => {
    const names = [...new Set([...doc.matchAll(/--lab-[a-z0-9-]*/g)].map((m) => m[0]))];
    expect(names.length).toBeGreaterThan(100);
    const unknown = names.filter((n) => (n.endsWith('-') ? !properties.some((p) => p.startsWith(n)) : !properties.includes(n)));
    expect(unknown).toEqual([]);
  });
});
