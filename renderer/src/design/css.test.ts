// @vitest-environment node
// Layout and focus promises that jsdom cannot evaluate (it lays nothing out and runs no container
// queries) are pinned on the stylesheets themselves. Each block names the finding it guards; the
// same behaviour is checked in a real browser during design review (see DESIGN.md §10).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { declared, parseCss, rulesFor, splitTopLevel, type CssRule } from './cssRules';

const DESIGN = resolve(import.meta.dirname);
const read = (rel: string) => readFileSync(resolve(DESIGN, rel), 'utf8');
const components = parseCss(read('components/components.css'));
const gallery = parseCss(read('gallery.css'));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const designCss = walk(DESIGN)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ file: relative(DESIGN, f).split('\\').join('/'), rules: parseCss(readFileSync(f, 'utf8')) }));

const px = (v: string | undefined) => (v === undefined ? Number.NaN : Number.parseFloat(v));

/** The container-query layouts of `.lab-fixture`, narrowest first: the width they start at and their column template. */
function fixtureTiers(): { minWidth: number; template: string; tracks: number }[] {
  return rulesFor(components, '.lab-fixture', /^@container/)
    .map((r) => {
      const template = r.decl['grid-template-columns'] ?? '';
      const repeat = /^repeat\((\d+), [^)]*\)\) (.+)$/.exec(template);
      const tracks = repeat ? Number(repeat[1]) + splitTopLevel(repeat[2] as string, ' ').length : splitTopLevel(template, ' ').length;
      return { minWidth: px(/min-width: (\d+)px/.exec(r.at[0] ?? '')?.[1]), template, tracks };
    })
    .sort((a, b) => a.minWidth - b.minWidth);
}

describe('the CSS reader (it must be able to see what the tests ask about)', () => {
  const sample = `
    /* a comment with { braces } and a selector .ghost { color: x } */
    .a, .b:not(.c, .d) { color: var(--x); margin: 0 }
    @media (max-width: 640px) { .a { display: none; } }
    @container (min-width: 720px) { .a { display: grid; } .e { opacity: 0.3 } }
    @keyframes k { 0% { opacity: 0.9; } 80%, 100% { opacity: 0; } }
    .f:focus-visible { outline: none; }
  `;
  const rules = parseCss(sample);
  test('rules, selector lists, at-rule context and comments', () => {
    expect(rules.map((r) => r.selectors.join(' | '))).toEqual(['.a | .b:not(.c, .d)', '.a', '.a', '.e', '0%', '80% | 100%', '.f:focus-visible']);
    expect(rules[0]?.decl).toEqual({ color: 'var(--x)', margin: '0' });
    expect(rules[1]?.at).toEqual(['@media (max-width: 640px)']);
    expect(rules[4]?.at).toEqual(['@keyframes k']);
    expect(declared(rules, '.a', 'display')).toBeUndefined(); // only inside at-rules
    expect(rulesFor(rules, '.a', /@container/).map((r) => r.decl.display)).toEqual(['grid']);
    expect(splitTopLevel('a, b(c, d), "e,f"', ',')).toEqual(['a', 'b(c, d)', '"e,f"']);
  });
});

describe('DS-1: FixtureCheck responds to its container, not the viewport', () => {
  test('.lab-panel__body is an inline-size query container', () => {
    expect(declared(components, '.lab-panel__body', 'container-type')).toBe('inline-size');
  });
  test('no primitive is laid out by a viewport width query', () => {
    const viewportQueries = components.flatMap((r) => r.at).filter((a) => /^@media[^{]*\b(min|max)-width\b/.test(a));
    expect(viewportQueries).toEqual([]);
  });
  test('the default layout is the stacked one (three equal number columns); wider layouts need a wide container', () => {
    expect(declared(components, '.lab-fixture', 'grid-template-columns')).toBe('repeat(3, minmax(0, 1fr))');
    const tiers = fixtureTiers();
    expect(tiers.map((t) => t.tracks)).toEqual([4, 5]);
    // A 453 px budget card (413 px body) must stay stacked; the one-row table needs real width.
    expect((tiers[0] as (typeof tiers)[number]).minWidth).toBeGreaterThan(453);
    expect((tiers[1] as (typeof tiers)[number]).minWidth).toBeGreaterThanOrEqual(640);
    // Every responsive rule of the fixture is a container rule with a min-width (mobile first).
    const responsive = components.filter((r) => r.at.length > 0 && r.selectors.some((s) => s.startsWith('.lab-fixture')));
    expect(responsive.length).toBeGreaterThan(0);
    for (const r of responsive) expect(r.at).toEqual([expect.stringMatching(/^@container \(min-width: \d+px\)$/)]);
  });
  test('stacked layout: name, outcome and notes span the full row', () => {
    for (const sel of ['.lab-fixture__label', '.lab-fixture__outcome', '.lab-fixture__notes'])
      expect(declared(components, sel, 'grid-column'), sel).toBe('1 / -1');
  });
});

describe('F7: stacked fixture rows form a table; cells share one baseline', () => {
  test('table layout uses fixed-minimum tracks (no content-sized `auto` track), so rows line up', () => {
    const table = fixtureTiers().at(-1);
    const tracks = splitTopLevel(table?.template ?? '', ' ');
    expect(tracks).toHaveLength(5);
    expect(tracks[0]).toBe('minmax(0, 1fr)');
    for (const t of tracks.slice(1)) expect(t).toMatch(/^minmax\(\d+px, max-content\)$/);
  });
  test('no fixture layout has a content-sized `auto` track', () => {
    const templates = rulesFor(components, '.lab-fixture').map((r) => r.decl['grid-template-columns']).filter(Boolean);
    expect(templates).toHaveLength(3);
    for (const t of templates) expect(t).not.toMatch(/\bauto\b/);
  });
  test('items align to the value line (end), not to the vertical centre', () => {
    expect(declared(components, '.lab-fixture', 'align-items')).toBe('end');
  });
  test('a unit beside a value cannot grow the value line: the cell with a unit stays level with the others', () => {
    // Measured in the browser: without this the "Computed" cell sat 1–3 px above "Claimed" and "Δ".
    expect(declared(components, '.lab-fixture__unit', 'line-height')).toBe('0');
    // Label over value, same two line heights in every cell.
    expect(declared(components, '.lab-fixture__k', 'line-height')).toBe('var(--lab-line-height-2xs)');
    expect(declared(components, '.lab-fixture__v', 'line-height')).toBe('var(--lab-line-height-md)');
    expect(declared(components, '.lab-fixture__name', 'line-height')).toBe('var(--lab-line-height-sm)');
    expect(declared(components, '.lab-fixture__outcome', 'line-height')).toBe('var(--lab-line-height-md)');
  });
  test('the outcome glyphs form a column: the outcome is left-aligned in its fixed track', () => {
    expect(declared(components, '.lab-fixture__outcome', 'justify-content')).toBe('flex-start');
  });
});

describe('DS-7 / DS-13: notes and the arithmetic basis', () => {
  test('a clamped note shows two lines; nothing else in the row is clamped or hidden', () => {
    const clamp = rulesFor(components, ".lab-fixture__note[data-clamped='true']", null);
    expect(clamp).toHaveLength(1);
    expect((clamp[0] as CssRule).decl['-webkit-line-clamp']).toBe('2');
    const hidden = components.filter(
      (r) => r.selectors.some((s) => s.includes('.lab-fixture')) && (r.decl.display === 'none' || r.decl.visibility === 'hidden'),
    );
    expect(hidden).toEqual([]);
  });
  test('arithmetic-consistent rows take a dashed neutral edge, not the green of a data-backed match', () => {
    const sel = ".lab-fixture[data-outcome='match'][data-basis='arithmetic']";
    const rule = rulesFor(components, sel, null);
    expect(rule).toHaveLength(1);
    const d = (rule[0] as CssRule).decl;
    expect(d['border-left-style']).toBe('dashed');
    expect(d['--fx-edge']).toBe('var(--lab-color-border-strong)');
    expect(d['--fx-fg']).toBe('var(--lab-color-text-muted)');
    expect(Object.values(d).join(' ')).not.toMatch(/status-passed/);
  });
});

describe('DL-1: the billing-risk pill and the Alert', () => {
  test('the billing-risk pill takes its own three tokens and a solid outline (it is backed by the API: not dashed)', () => {
    const rule = rulesFor(components, ".lab-pill[data-status='billing-risk']", null);
    expect(rule).toHaveLength(1);
    const d = (rule[0] as CssRule).decl;
    expect([d['--pill-fg'], d['--pill-bg'], d['--pill-border']]).toEqual([
      'var(--lab-status-billing-risk-fg)',
      'var(--lab-status-billing-risk-bg)',
      'var(--lab-status-billing-risk-border)',
    ]);
    expect(d['border-style']).toBeUndefined();
    // The pill keeps its size: the outline is the same 1px as every pill, the weight carries the rest.
    expect(d['font-weight']).toBe('var(--lab-font-weight-bold)');
  });
  test('the alert is drawn from the billing-risk tokens, outline in the text colour', () => {
    expect(declared(components, '.lab-alert', 'background')).toBe('var(--lab-status-billing-risk-bg)');
    expect(declared(components, '.lab-alert', 'border')).toBe('1px solid var(--lab-status-billing-risk-border)');
    expect(declared(components, '.lab-alert__title', 'color')).toBe('var(--lab-status-billing-risk-fg)');
    expect(declared(components, '.lab-alert__icon', 'color')).toBe('var(--lab-status-billing-risk-fg)');
  });
  test('the backend reason is shown as written: never re-cased, clamped or hidden, and long words wrap', () => {
    const rules = components.filter((r) => r.selectors.some((s) => s.includes('.lab-alert')));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules.filter((x) => x.selectors.some((s) => /\.lab-alert__reason/.test(s)))) {
      expect(r.decl['text-transform'], r.selectors.join()).toBeUndefined();
      expect(r.decl['-webkit-line-clamp']).toBeUndefined();
      expect(r.decl.overflow).toBeUndefined();
      expect(r.decl.display).not.toBe('none');
    }
    expect(declared(components, '.lab-alert__reason', 'white-space')).toBe('pre-wrap');
    expect(declared(components, '.lab-alert__reason', 'overflow-wrap')).toBe('anywhere');
    expect(declared(components, '.lab-alert__reason', 'max-width')).toBe('100ch');
  });
});

describe('DL-5: a PRD range is one unbreakable token', () => {
  // Seen at 390 px: "3100–3200 USD" broke after the dash ("3100–" / "3200 USD"). Only the unit may wrap.
  test('.lab-fixture__range never wraps; the unit outside it still can', () => {
    expect(declared(components, '.lab-fixture__range', 'white-space')).toBe('nowrap');
    expect(declared(components, '.lab-fixture__v', 'white-space')).toBeUndefined();
  });
});

describe('DS-17: long prose keeps a readable measure', () => {
  test.each(['.lab-callout__body', '.lab-fixture__note'])('%s is at most 100ch wide', (sel) => {
    expect(declared(components, sel, 'max-width')).toBe('100ch');
  });
  test('.lab-panel__footer limits its text to 100ch while its rule keeps the full width', () => {
    expect(declared(components, '.lab-panel__footer', 'max-width')).toBeUndefined();
    expect(declared(components, '.lab-panel__footer', 'padding-inline-end')).toMatch(/100ch/);
  });
});

describe('DS-18 / F6: the segment focus ring is whole and separated from the fill', () => {
  test('.lab-seg does not clip (no overflow other than visible) and wraps instead of scrolling', () => {
    for (const r of rulesFor(components, '.lab-seg'))
      for (const prop of ['overflow', 'overflow-x', 'overflow-y'])
        if (prop in r.decl) expect(r.decl[prop], prop).toBe('visible');
    expect(declared(components, '.lab-seg', 'flex-wrap')).toBe('wrap');
  });
  test('the ring sits 2px outside the segment (2px ring + 2px gap, as everywhere else)', () => {
    const d = rulesFor(components, '.lab-seg__opt:focus-visible', null);
    expect(d).toHaveLength(1);
    expect(px((d[0] as CssRule).decl['outline-offset'])).toBeGreaterThanOrEqual(2);
  });
  test.each(designCss.map((f) => [f.file, f] as const))('%s: no rule switches the focus outline off (mutation M27a)', (file, f) => {
    const offenders = f.rules.filter((r) => {
      const onFocus = r.selectors.some((s) => /:focus/.test(s));
      // The one allowed reset: `:focus { outline: none }` in the base, paired with the :focus-visible ring.
      if (file === 'tokens.css' && r.selectors.length === 1 && r.selectors[0] === ':focus') return false;
      const d = r.decl;
      return (
        onFocus &&
        (/^(none|0(px)?)\b/.test(d.outline ?? '') || d['outline-style'] === 'none' || /^0(px)?$/.test(d['outline-width'] ?? ''))
      );
    });
    expect(offenders.map((r) => r.selectors.join(', '))).toEqual([]);
  });
});

describe('CSS-level opacity cannot dim text below the contrast the tokens guarantee (mutation M34)', () => {
  // Opacity multiplies into every colour inside the element, which contrast.test.ts cannot see.
  // The only places allowed to declare it: the decorative LIVE pulse ring and its keyframes.
  const ALLOWED = new Set(['.lab-pill__dot::after', '0%', '80%', '100%']);
  test.each(designCss.filter((f) => f.file !== 'tokens.css').map((f) => [f.file, f] as const))('%s', (_file, f) => {
    const offenders = f.rules
      .filter((r) => 'opacity' in r.decl || /opacity\(/.test(r.decl.filter ?? ''))
      .filter((r) => !r.selectors.every((s) => ALLOWED.has(s)));
    expect(offenders.map((r) => `${r.selectors.join(', ')} { opacity: ${r.decl.opacity} }`)).toEqual([]);
  });
});

describe('F9: gallery layout', () => {
  test('status pills keep their own width (grid items are not stretched)', () => {
    expect(declared(gallery, '.gal-status', 'justify-items')).toBe('start');
  });
  test('the palette table never truncates its headers', () => {
    const cvd = gallery.filter((r) => r.selectors.some((s) => s.startsWith('.gal-cvd')));
    expect(cvd.length).toBeGreaterThan(0);
    expect(cvd.filter((r) => r.decl['text-overflow'] === 'ellipsis' || r.decl['table-layout'] === 'fixed')).toEqual([]);
  });
});
