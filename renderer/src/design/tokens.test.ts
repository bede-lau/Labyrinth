// D2 (part): tokens.css is generated from tokens.ts and must not drift; both themes are complete
// and wired through prefers-color-scheme AND [data-theme].
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareSpecificity, parseCss, rulesFor, specificity } from './cssRules';
import { renderTokensCss, themeCssVars, themes, THEMES, STATUS_KINDS, SERIES_IDS } from './tokens';

const CSS_PATH = resolve(import.meta.dirname, 'tokens.css');
const css = readFileSync(CSS_PATH, 'utf8');

/** Extract `--name: value;` declarations inside the first block that follows `selector {`. */
function declarations(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const body = source.slice(start + selector.length + 2, source.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim();
  return out;
}

describe('tokens.css is generated from tokens.ts (single source of truth)', () => {
  test('file content equals renderTokensCss() byte for byte — run `npm run tokens` if this fails', () => {
    expect(css).toBe(renderTokensCss());
  });

  test('light values in :root equal the TS light theme', () => {
    const decl = declarations(css, ':root');
    for (const [k, v] of Object.entries(themeCssVars('light'))) expect(decl[k], k).toBe(v);
  });

  test('dark values appear under prefers-color-scheme guarded by :not([data-theme="light"]) and under [data-theme="dark"]', () => {
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    const viaMedia = declarations(media, ':root:not([data-theme="light"])');
    const viaAttr = declarations(css, ':root[data-theme="dark"]');
    for (const [k, v] of Object.entries(themeCssVars('dark'))) {
      expect(viaMedia[k], `media ${k}`).toBe(v);
      expect(viaAttr[k], `attr ${k}`).toBe(v);
    }
  });

  test('both themes define exactly the same token names', () => {
    expect(Object.keys(themeCssVars('dark')).sort()).toEqual(Object.keys(themeCssVars('light')).sort());
    for (const t of THEMES) {
      expect(Object.keys(themes[t].status).sort()).toEqual([...STATUS_KINDS].sort());
      expect(Object.keys(themes[t].series).sort()).toEqual([...SERIES_IDS].sort());
    }
  });

  test('body background is explicit, numbers are tabular, focus ring and reduced motion exist', () => {
    expect(css).toMatch(/body \{[^}]*background: var\(--lab-color-bg\)/);
    expect(css).toMatch(/\.lab-num[^{]*\{[^}]*font-variant-numeric: tabular-nums/);
    expect(css).toMatch(/:focus-visible \{[^}]*outline: 2px solid var\(--lab-color-focus\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms/);
    expect(css).toMatch(/color-scheme: dark/);
  });
});

// Verifier finding F1: Plotly ships its own `.modebar-btn:focus-visible { outline: 1px solid #000 }`
// and injects it at runtime, AFTER our stylesheet, so the global :focus-visible rule loses and the
// ring is 1.20:1 on the dark plot. The base CSS must carry a themed rule that out-specifies Plotly's.
describe('chart modebar focus ring is themed from tokens (F1)', () => {
  const rules = parseCss(css);
  const ours = rules.filter((r) => r.selectors.some((s) => /\.modebar-btn:focus-visible$/.test(s)));

  /** Plotly's own selector, read from the installed bundle so an upgrade cannot silently out-rank ours. */
  function plotlyFocusSelectors(): { selector: string; body: string }[] {
    const bundle = readFileSync(resolve(import.meta.dirname, '../../node_modules/plotly.js-dist-min/plotly.min.js'), 'utf8');
    const found: { selector: string; body: string }[] = [];
    // The bundle holds a map {"X .modebar-btn:focus-visible":"outline:…"}; X stands for the plot root.
    for (const m of bundle.matchAll(/"([^"]*\.modebar-btn[^"]*:focus[^"]*)":"([^"]*)"/g))
      found.push({ selector: (m[1] as string).replace(/X/g, '.js-plotly-plot .plotly'), body: m[2] as string });
    return found;
  }

  test('the installed Plotly really does style the focused modebar button (the control this test needs)', () => {
    const theirs = plotlyFocusSelectors();
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.map((t) => t.body).join(' ')).toMatch(/outline:/);
  });

  test('tokens.css has one rule for .modebar-btn:focus-visible: 2px solid ring in the focus token, offset outwards', () => {
    expect(ours).toHaveLength(1);
    const d = (ours[0] as (typeof ours)[number]).decl;
    expect(d.outline).toBe('2px solid var(--lab-color-focus)');
    expect(Number.parseFloat(d['outline-offset'] ?? '')).toBeGreaterThanOrEqual(1);
    expect((ours[0] as (typeof ours)[number]).at).toEqual([]);
  });

  test('our selector is strictly more specific than every Plotly selector for the same state', () => {
    const mine = (ours[0]?.selectors ?? []).filter((s) => /\.modebar-btn:focus-visible$/.test(s));
    expect(mine.length).toBeGreaterThan(0);
    for (const theirs of plotlyFocusSelectors())
      for (const s of mine)
        expect(compareSpecificity(s, theirs.selector), `${s}  vs  ${theirs.selector}`).toBeGreaterThan(0);
  });

  test('specificity helper: known values (it must be able to rank the two selectors)', () => {
    expect(specificity('.js-plotly-plot .plotly .modebar-btn:focus-visible')).toEqual([0, 4, 0]);
    expect(specificity(':focus-visible')).toEqual([0, 1, 0]);
    expect(specificity('a#x.y[z]:hover::before')).toEqual([1, 3, 2]);
    expect(compareSpecificity(':focus-visible', '.js-plotly-plot .plotly .modebar-btn:focus-visible')).toBeLessThan(0);
  });
});

describe('base rules the primitives rely on', () => {
  const rules = parseCss(css);
  test('DS-18: a <summary> is a pointer target at least 24 px tall and keeps its disclosure marker', () => {
    const summary = rulesFor(rules, 'summary', null);
    expect(summary).toHaveLength(1);
    const d = (summary[0] as (typeof summary)[number]).decl;
    expect(Number.parseFloat(d['min-height'] ?? '')).toBeGreaterThanOrEqual(24);
    expect(d.cursor).toBe('pointer');
    // display: flex / inline-flex would drop the ::marker triangle; the rule must leave display alone.
    expect(d.display).toBeUndefined();
  });
  test('F7: subscripts never grow the line box (units with a subscript keep rows on one baseline)', () => {
    const sub = rules.filter((r) => r.at.length === 0 && r.selectors.includes('sub'));
    expect(sub.map((r) => r.decl['line-height'])).toContain('0');
  });
});
