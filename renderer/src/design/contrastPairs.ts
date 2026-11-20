// Every foreground/background pair the system draws and the WCAG 2.x AA minimum it is held to.
// One list, used by contrast.test.ts (the gate) and designDoc.test.ts (the worst cases DESIGN.md quotes).
//   Text (any size we use, incl. 11px pills): ≥ 4.5:1.
//   Non-text (control borders, focus ring, accent indicators, chart lines, |B| stops, the LIVE
//   fill as a shape, dashed "not backed by data" outlines, window edges): ≥ 3:1 (SC 1.4.11).
// Alpha fills are composited the way the browser paints them before measuring.
import { compositeOver, contrastRatio, withAlpha } from './color';
import { unsampledShapes, windowShape } from './plotTheme';
import { STATUS_META } from './status';
import { CALLOUT_TONES, STATUS_KINDS, themes, type ThemeName } from './tokens';

export const TEXT_MIN = 4.5;
export const NON_TEXT_MIN = 3;

export interface ContrastPair {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

export function contrastPairs(theme: ThemeName): ContrastPair[] {
  const t = themes[theme];
  const c = t.color;
  const TEXT = TEXT_MIN;
  const NON_TEXT = NON_TEXT_MIN;
  const surfaces = {
    bg: c.bg,
    surface: c.surface,
    surfaceSunken: c.surfaceSunken,
    surfaceRaised: c.surfaceRaised,
    surfaceHover: c.surfaceHover,
    accentSubtle: c.accentSubtle,
    plotPaper: t.plot.paper,
  };
  const out: ContrastPair[] = [];
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
  // The LIVE pill must stand out as a shape on every surface it can sit on: a hovered
  // ProvenanceBadge puts it on surfaceHover, a popover on surfaceRaised.
  for (const [sName, sv] of Object.entries(surfaces))
    out.push({ name: `live pill fill vs ${sName}`, fg: t.status.live.bg, bg: sv, min: NON_TEXT });
  // Dashed outlines carry meaning ("not backed by data in this repo", DESIGN.md §5), so the dashes
  // must be visible against the surface around the pill and against the tint showing through the gaps.
  // The billing-risk outline (and the Alert's border) carries meaning too: same rule.
  for (const k of STATUS_KINDS) {
    const meta = STATUS_META[k];
    if (!meta.dashed && !meta.outlined) continue;
    const s = t.status[k];
    const how = meta.dashed ? 'dashed' : 'outlined';
    out.push({ name: `${how} ${k} border vs its own tint`, fg: s.border, bg: s.bg, min: NON_TEXT });
    for (const [sName, sv] of Object.entries(surfaces))
      out.push({ name: `${how} ${k} border vs ${sName}`, fg: s.border, bg: sv, min: NON_TEXT });
  }
  // An Alert's action may be a link ("Open Advance plasma to send Terminate").
  out.push({ name: 'accentText on status billing-risk bg', fg: c.accentText, bg: t.status['billing-risk'].bg, min: TEXT });
  // Alpha fills on charts, composited the way the browser paints them.
  const shade = compositeOver(t.plot.plot, t.plot.windowShade);
  const unsampledFill = withAlpha(t.plot.unsampled, t.plot.unsampledAlpha);
  const unsampled = compositeOver(t.plot.plot, unsampledFill);
  const unsampledOnShade = compositeOver(t.plot.plot, t.plot.windowShade, unsampledFill);
  const windowLabel = windowShape([0, 1], theme, 'w').label?.font?.color as string;
  const unsampledLabel = unsampledShapes([0, 1], theme)[1]?.label?.font?.color as string;
  out.push({ name: 'window label text on the window shade over the plot', fg: windowLabel, bg: shade, min: TEXT });
  out.push({ name: 'window label text on the plot', fg: windowLabel, bg: t.plot.plot, min: TEXT });
  out.push({ name: 'unsampled label text on the unsampled fill over the plot', fg: unsampledLabel, bg: unsampled, min: TEXT });
  out.push({ name: 'unsampled label text on the unsampled fill over a window shade', fg: unsampledLabel, bg: unsampledOnShade, min: TEXT });
  // The window edge is the boundary of the averaging window: a graphical object, 3:1 against
  // everything it can be drawn on.
  for (const [bName, bv] of Object.entries({ plot: t.plot.plot, 'window shade': shade, 'unsampled fill': unsampled, 'unsampled fill over a shade': unsampledOnShade }))
    out.push({ name: `window edge vs ${bName}`, fg: compositeOver(bv, t.plot.windowEdge), bg: bv, min: NON_TEXT });
  // Focused segment: the ring is drawn 2px outside the selected fill; the track shows in the gap.
  out.push({ name: 'segment focus: track gap vs selected fill', fg: c.surfaceSunken, bg: c.accent, min: NON_TEXT });
  out.push({ name: 'segment focus: ring vs track gap', fg: c.focus, bg: c.surfaceSunken, min: NON_TEXT });
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

/** The lowest ratio among the pairs held to `min` (4.5 = text, 3 = non-text), with the pair it belongs to. */
export function worstContrast(theme: ThemeName, min: number): { ratio: number; pair: ContrastPair } {
  let worst: { ratio: number; pair: ContrastPair } | undefined;
  for (const pair of contrastPairs(theme)) {
    if (pair.min !== min) continue;
    const ratio = contrastRatio(pair.fg, pair.bg);
    if (!worst || ratio < worst.ratio) worst = { ratio, pair };
  }
  if (!worst) throw new Error(`no pair is held to ${min}:1`);
  return worst;
}
