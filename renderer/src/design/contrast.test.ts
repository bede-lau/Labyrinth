// D2: WCAG 2.x AA contrast computed from the token values, both themes.
//   Text (any size we use, incl. 11px pills): ≥ 4.5:1.  Non-text UI (control borders, focus ring,
//   accent indicators, chart lines, |B| colormap): ≥ 3:1 (SC 1.4.11).
import { contrastRatio } from './color';
import { STATUS_KINDS, THEMES, themes, CALLOUT_TONES, type ThemeName } from './tokens';

const TEXT = 4.5;
const NON_TEXT = 3;

interface Pair {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

function pairs(theme: ThemeName): Pair[] {
  const t = themes[theme];
  const c = t.color;
  const surfaces = {
    bg: c.bg,
    surface: c.surface,
    surfaceSunken: c.surfaceSunken,
    surfaceRaised: c.surfaceRaised,
    surfaceHover: c.surfaceHover,
    accentSubtle: c.accentSubtle,
    plotPaper: t.plot.paper,
  };
  const out: Pair[] = [];
  // Every text token on every surface.
  for (const fgName of ['text', 'textMuted', 'textSubtle', 'accentText'] as const)
    for (const [sName, s] of Object.entries(surfaces)) out.push({ name: `${fgName} on ${sName}`, fg: c[fgName], bg: s, min: TEXT });
  // Selected segment / primary button.
  out.push({ name: 'accentFg on accent', fg: c.accentFg, bg: c.accent, min: TEXT });
  out.push({ name: 'accentFg on accentHover', fg: c.accentFg, bg: c.accentHover, min: TEXT });
  // Status pills: fg on its own tint, and fg used bare (icons/labels) on every surface.
  for (const k of STATUS_KINDS) {
    const s = t.status[k];
    out.push({ name: `status ${k} fg on its bg`, fg: s.fg, bg: s.bg, min: TEXT });
    if (k === 'live') continue; // live is only ever drawn as a solid pill
    for (const [sName, sv] of Object.entries(surfaces)) out.push({ name: `status ${k} fg on ${sName}`, fg: s.fg, bg: sv, min: TEXT });
    // Rows tinted with a status bg (FixtureCheck mismatch) carry body text.
    out.push({ name: `text on status ${k} bg`, fg: c.text, bg: s.bg, min: TEXT });
    out.push({ name: `textMuted on status ${k} bg`, fg: c.textMuted, bg: s.bg, min: TEXT });
  }
  // The LIVE pill must stand out from the page as a shape, too.
  out.push({ name: 'live pill fill vs surface', fg: t.status.live.bg, bg: c.surface, min: NON_TEXT });
  out.push({ name: 'live pill fill vs bg', fg: t.status.live.bg, bg: c.bg, min: NON_TEXT });
  // Callouts: title in tone colour, body in text colours.
  for (const tone of CALLOUT_TONES) {
    const s = t.callout[tone];
    out.push({ name: `callout ${tone} fg on bg`, fg: s.fg, bg: s.bg, min: TEXT });
    out.push({ name: `text on callout ${tone}`, fg: c.text, bg: s.bg, min: TEXT });
    out.push({ name: `textMuted on callout ${tone}`, fg: c.textMuted, bg: s.bg, min: TEXT });
    out.push({ name: `accentText on callout ${tone}`, fg: c.accentText, bg: s.bg, min: TEXT });
  }
  // Non-text UI.
  for (const [sName, s] of Object.entries(surfaces)) {
    out.push({ name: `borderStrong on ${sName}`, fg: c.borderStrong, bg: s, min: NON_TEXT });
    out.push({ name: `focus ring on ${sName}`, fg: c.focus, bg: s, min: NON_TEXT });
    out.push({ name: `accent on ${sName}`, fg: c.accent, bg: s, min: NON_TEXT });
  }
  out.push({ name: 'plot axis line', fg: t.plot.axis, bg: t.plot.plot, min: NON_TEXT });
  for (const [k, v] of Object.entries(t.series)) out.push({ name: `series ${k} on plot`, fg: v, bg: t.plot.plot, min: NON_TEXT });
  for (const [k, v] of Object.entries(t.series)) out.push({ name: `series ${k} on scene`, fg: v, bg: t.scene.background, min: NON_TEXT });
  t.scene.bmag.forEach((v, i) => out.push({ name: `|B| stop ${i} on scene`, fg: v, bg: t.scene.background, min: NON_TEXT }));
  return out;
}

describe('contrast-ratio implementation (sanity: must be able to fail)', () => {
  test('known reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 is the classic lightest gray passing AA on white; #777777 fails.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});

describe.each(THEMES)('WCAG AA contrast — %s theme', (theme) => {
  const list = pairs(theme);
  test('covers every text token × surface and every status', () => {
    expect(list.length).toBeGreaterThan(150);
  });
  test.each(list.map((p) => [p.name, p] as const))('%s', (_name, p) => {
    const ratio = contrastRatio(p.fg, p.bg);
    expect(ratio, `${p.fg} on ${p.bg} = ${ratio.toFixed(2)}:1, needs ${p.min}:1`).toBeGreaterThanOrEqual(p.min);
  });
});
