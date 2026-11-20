// @vitest-environment node
// D2: WCAG 2.x AA contrast computed from the token values, both themes.
//   Text (any size we use, incl. 11px pills): ≥ 4.5:1.  Non-text UI (control borders, focus ring,
//   accent indicators, chart lines, |B| colormap, the LIVE fill, dashed outlines, window edges): ≥ 3:1 (SC 1.4.11).
// The pair list lives in contrastPairs.ts (DESIGN.md quotes its worst cases; designDoc.test.ts checks them).
import { compositeOver, contrastRatio } from './color';
import { NON_TEXT_MIN, TEXT_MIN, contrastPairs, worstContrast } from './contrastPairs';
import { THEMES } from './tokens';

describe('contrast-ratio implementation (sanity: must be able to fail)', () => {
  test('known reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 is the classic lightest gray passing AA on white; #777777 fails.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });
  test('alpha compositing: source-over in sRGB, layers applied in order', () => {
    expect(compositeOver('#ffffff', 'rgba(0, 0, 0, 0.5)')).toBe('#808080');
    expect(compositeOver('#000000', 'rgba(255, 255, 255, 0.2)')).toBe('#333333');
    expect(compositeOver('#ffffff', 'rgba(0, 0, 0, 0)')).toBe('#ffffff');
    expect(compositeOver('#ffffff', '#102030')).toBe('#102030'); // an opaque layer replaces what is under it
    expect(compositeOver('#ffffff', 'rgba(0, 0, 0, 0.5)', 'rgba(255, 0, 0, 0.5)')).toBe('#bf4040');
    expect(() => compositeOver('#ffffff', 'teal')).toThrow(/not a colour/);
  });
  test('a label on a strong alpha fill is measured against the fill, not the paper (mutation M33)', () => {
    // 95 % teal over white is a dark fill: muted text on it must read as a failure.
    const fill = compositeOver('#ffffff', 'rgba(11, 127, 128, 0.95)');
    expect(contrastRatio('#42565e', fill)).toBeLessThan(4.5);
    expect(contrastRatio('#42565e', '#ffffff')).toBeGreaterThan(4.5);
  });
});

describe('the pairs that carry the fix round are in the list', () => {
  test.each(THEMES)('%s: live fill on hover/raised, dashed borders, window edge, labels on alpha fills', (theme) => {
    const names = contrastPairs(theme).map((p) => p.name);
    for (const n of [
      'live pill fill vs surfaceHover',
      'live pill fill vs surfaceRaised',
      'dashed prd-reported border vs surface',
      'dashed prd-reported border vs its own tint',
      'dashed unverified border vs surface',
      'window edge vs plot',
      'window edge vs window shade',
      'window label text on the window shade over the plot',
      'unsampled label text on the unsampled fill over a window shade',
      'segment focus: track gap vs selected fill',
      'focus ring on plotPaper', // the themed modebar ring (tokens.test.ts) is drawn on plot paper
      // DL-1: the billing-risk outline carries meaning; an alert's action may be a link.
      'outlined billing-risk border vs its own tint',
      'outlined billing-risk border vs surfaceHover',
      'accentText on status billing-risk bg',
      // design-r1-R4: drawn but not gated before — the ring and hovered links on the tints that hold
      // controls, and the "Show full note" link on a mismatch row.
      'focus ring on status billing-risk bg',
      'focus ring on status mismatch bg',
      'focus ring on callout warn',
      'accentText on status mismatch bg',
      'accentHover on status mismatch bg',
      'accentHover on status billing-risk bg',
      'accentHover on callout blocked',
      'accentHover on surface',
    ])
      expect(names, n).toContain(n);
    expect(new Set(names).size, 'pair names are unique').toBe(names.length);
  });
});

describe.each(THEMES)('WCAG AA contrast — %s theme', (theme) => {
  const list = contrastPairs(theme);
  test('covers every text token × surface and every status', () => {
    expect(list.length).toBeGreaterThan(190);
    expect(list.every((p) => p.min === TEXT_MIN || p.min === NON_TEXT_MIN)).toBe(true);
  });
  test.each(list.map((p) => [p.name, p] as const))('%s', (_name, p) => {
    const ratio = contrastRatio(p.fg, p.bg);
    expect(ratio, `${p.fg} on ${p.bg} = ${ratio.toFixed(2)}:1, needs ${p.min}:1`).toBeGreaterThanOrEqual(p.min);
  });
  test('worstContrast() reports the minimum of each class', () => {
    for (const min of [TEXT_MIN, NON_TEXT_MIN]) {
      const ratios = list.filter((p) => p.min === min).map((p) => contrastRatio(p.fg, p.bg));
      expect(worstContrast(theme, min).ratio).toBe(Math.min(...ratios));
    }
  });
});
