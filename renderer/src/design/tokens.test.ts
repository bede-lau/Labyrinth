// D2 (part): tokens.css is generated from tokens.ts and must not drift; both themes are complete
// and wired through prefers-color-scheme AND [data-theme].
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
