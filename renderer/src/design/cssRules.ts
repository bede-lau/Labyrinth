// A small CSS reader for the design-system tests. jsdom lays nothing out and evaluates no container
// or media queries, so the layout promises in DESIGN.md are pinned structurally instead: the tests
// read the stylesheets with this parser and assert on the rules themselves.
//
// It handles the subset this repo writes: comments, rule sets, and block at-rules
// (@media, @container, @supports, @keyframes) nested to any depth. No CSS nesting, no @import.

export interface CssRule {
  /** Selector list as written, split on top-level commas. Keyframe steps appear as "0%", "80%", … */
  selectors: string[];
  /** property -> value; the last declaration of a property in the rule wins. */
  decl: Record<string, string>;
  /** Enclosing at-rules, outermost first, e.g. ["@container (min-width: 720px)"]. */
  at: string[];
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Split on `sep` wherever it is not inside parentheses, brackets or quotes. */
export function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function declarations(body: string): Record<string, string> {
  const decl: Record<string, string> = {};
  for (const part of splitTopLevel(body, ';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    decl[part.slice(0, colon).trim()] = part.slice(colon + 1).trim().replace(/\s+/g, ' ');
  }
  return decl;
}

/** Parse a stylesheet into a flat list of rules, each knowing the at-rules around it. */
export function parseCss(source: string): CssRule[] {
  const css = stripComments(source);
  const rules: CssRule[] = [];
  let i = 0;
  const block = (at: string[]) => {
    while (i < css.length) {
      const open = css.indexOf('{', i);
      const close = css.indexOf('}', i);
      if (close >= 0 && (open < 0 || close < open)) {
        i = close + 1; // end of the enclosing block
        return;
      }
      if (open < 0) {
        i = css.length;
        return;
      }
      const prelude = css.slice(i, open).trim().replace(/\s+/g, ' ');
      i = open + 1;
      if (prelude.startsWith('@')) {
        block([...at, prelude]);
        continue;
      }
      const end = css.indexOf('}', i);
      if (end < 0) throw new Error(`unclosed rule: ${prelude}`);
      rules.push({ selectors: splitTopLevel(prelude, ','), decl: declarations(css.slice(i, end)), at });
      i = end + 1;
    }
  };
  block([]);
  return rules;
}

/** Rules that list exactly `selector`, optionally only those under an at-rule matching `at`. */
export function rulesFor(rules: readonly CssRule[], selector: string, at?: RegExp | null): CssRule[] {
  return rules.filter(
    (r) =>
      r.selectors.includes(selector) &&
      (at === undefined ? true : at === null ? r.at.length === 0 : r.at.some((a) => at.test(a))),
  );
}

/** The value `selector` declares for `prop` outside any at-rule (last rule wins), or undefined. */
export function declared(rules: readonly CssRule[], selector: string, prop: string): string | undefined {
  let value: string | undefined;
  for (const r of rulesFor(rules, selector, null)) if (prop in r.decl) value = r.decl[prop];
  return value;
}

/**
 * Selector specificity as [ids, classes + attributes + pseudo-classes, elements + pseudo-elements].
 * Enough for the selectors compared in the tests (compound and descendant selectors, :not()).
 */
export function specificity(selector: string): [number, number, number] {
  let s = selector.replace(/:where\([^)]*\)/g, '').replace(/:(?:not|is)\(([^)]*)\)/g, ' $1 ');
  const count = (re: RegExp) => {
    const n = (s.match(re) ?? []).length;
    s = s.replace(re, ' ');
    return n;
  };
  const ids = count(/#[\w-]+/g);
  const attrs = count(/\[[^\]]*\]/g);
  const pseudoEls = count(/::[\w-]+/g);
  const pseudoClasses = count(/:[\w-]+(?:\([^)]*\))?/g);
  const classes = count(/\.[\w-]+/g);
  const elements = (s.match(/[A-Za-z][\w-]*/g) ?? []).length;
  return [ids, classes + attrs + pseudoClasses, elements + pseudoEls];
}

/** Negative when `a` is less specific than `b`, positive when more, 0 when equal. */
export function compareSpecificity(a: string, b: string): number {
  const x = specificity(a);
  const y = specificity(b);
  for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return (x[k] as number) - (y[k] as number);
  return 0;
}

// ---- colour pairs a stylesheet draws -----------------------------------------------------------
// contrastPairs.ts lists the pairs the contrast gate measures by hand. drawnColorPairs() reads the
// pairs off the stylesheet instead, so a test can require that every pair drawn is in that list.

/** One foreground drawn on one background, by custom-property name (`--lab-…`). */
export interface DrawnPair {
  /** Where it is drawn: the block, its state and the rule, for the failure message. */
  where: string;
  fg: string;
  bg: string;
  /** 'text' for `color` (≥ 4.5:1); 'non-text' for the focus ring (≥ 3:1). */
  kind: 'text' | 'non-text';
}

interface Compound {
  classes: string[];
  attrs: Record<string, string>;
}

function parseCompound(c: string): Compound {
  // Pseudo-classes and pseudo-elements (with one level of nested arguments) do not change which
  // element or which component state a rule targets for colour purposes; :hover colours count too.
  const bare = c.replace(/:{1,2}[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?/g, '');
  return {
    classes: [...bare.matchAll(/\.([\w-]+)/g)].map((m) => m[1] as string),
    attrs: Object.fromEntries([...bare.matchAll(/\[([\w-]+)=['"]([^'"]*)['"]\]/g)].map((m) => [m[1] as string, m[2] as string])),
  };
}

const blockOf = (cls: string) => (cls.split('__')[0] as string).split('--')[0] as string;
const isRootOf = (c: Compound, block: string) => c.classes.some((k) => k === block || (k.startsWith(`${block}--`) && !k.includes('__')));

interface Entry {
  order: number;
  selector: string;
  decl: Record<string, string>;
  block: string;
  /**
   * null: the rule styles the component's root. Otherwise what it styles: an element class
   * (`lab-prov__list`), or a bare element inside one (`lab-prov__list dt`).
   */
  element: string | null;
  /** Root state the rule needs: attribute values and modifier classes on the component's root. */
  attrs: Record<string, string>;
  mods: string[];
  /** Element classes of the same block that the selector puts the styled element inside. */
  inside: string[];
  /** The rule applies only for a moment (hover, focus, active): its background holds nothing for good. */
  transient: boolean;
}

function entries(rules: readonly CssRule[]): Entry[] {
  const out: Entry[] = [];
  rules.forEach((r, order) => {
    for (const selector of r.selectors) {
      const raw = splitTopLevel(selector.replace(/\s*[>+~]\s*/g, ' '), ' ');
      const parts = raw.map(parseCompound);
      // The compound that names the component: the last one with a lab- class. A bare element after it
      // (`.lab-prov__list dt`) is styled inside that element.
      let at = parts.length - 1;
      while (at >= 0 && !(parts[at] as Compound).classes.some((k) => k.startsWith('lab-'))) at--;
      if (at < 0) continue;
      const subject = parts[at] as Compound;
      const own = subject.classes.find((k) => k.startsWith('lab-')) as string;
      const block = blockOf(own);
      const last = at === parts.length - 1;
      const isRoot = last && isRootOf(subject, block);
      // The compounds the styled element sits inside (the subject too, when a bare element follows it).
      const around = parts.slice(0, last ? at : at + 1);
      const root = isRoot ? subject : [...around].reverse().find((p) => isRootOf(p, block));
      out.push({
        order,
        selector,
        decl: r.decl,
        block,
        element: isRoot ? null : last ? own : `${own} ${raw.slice(at + 1).join(' ')}`,
        attrs: root?.attrs ?? {},
        mods: (root?.classes ?? []).filter((k) => k.startsWith(`${block}--`)),
        inside: around.flatMap((p) => p.classes.filter((k) => k.startsWith(`${block}__`))),
        transient: /:(?:hover|focus|focus-visible|focus-within|active)\b/.test(selector),
      });
    }
  });
  return out;
}

/** A `var(--x)` value followed through the custom properties in `props`, to a `--lab-…` name (or null). */
function tokenOf(value: string | undefined, props: Record<string, string>, depth = 0): string | null {
  const m = /^var\((--[\w-]+)\)$/.exec((value ?? '').trim());
  if (!m || depth > 8) return null;
  const name = m[1] as string;
  return name.startsWith('--lab-') ? name : tokenOf(props[name], props, depth + 1);
}

/**
 * Every (foreground, background) pair the component stylesheet draws. For each block (`.lab-x`) and
 * each state its root can be in (each combination of the attribute values and modifier classes its
 * rules name), the root's rules are cascaded by specificity and order. The ground is the background
 * the root paints (a tinted component); a root that paints none (Stat, ProvenanceBadge) can sit on
 * any panel, so its ground is every one of `surfaces`. Then:
 *  - every `color` on the root or an element is drawn on the element's own background; else on the
 *    background of an element its selector puts it inside (`.lab-x__card .lab-x__y`: the card's
 *    fill, not a hover fill); else on the ground;
 *  - every control (`cursor: pointer`) gets the focus ring, drawn outside it on what holds it;
 *  - an open slot (an `__action` element, which holds the caller's links and buttons) gets the base
 *    link colours and the focus ring on what holds it.
 * `base` is tokens.css: the `a`, `a:hover` and `:focus-visible` rules give those colours.
 * `surfaces` are custom-property names (contrastPairs.ts SURFACE_PROPERTIES).
 */
export function drawnColorPairs(components: readonly CssRule[], base: readonly CssRule[], surfaces: readonly string[]): DrawnPair[] {
  if (surfaces.length === 0) throw new Error('drawnColorPairs: no surfaces to draw an untinted component on');
  const baseToken = (sel: string, prop: string) => {
    const v = declared(base, sel, prop) ?? '';
    const name = /var\((--lab-[\w-]+)\)/.exec(v)?.[1];
    if (!name) throw new Error(`tokens.css: no token in ${sel} { ${prop} }`);
    return name;
  };
  const link = baseToken('a', 'color');
  const linkHover = baseToken('a:hover', 'color');
  const focus = baseToken(':focus-visible', 'outline');

  const all = entries(components);
  const out: DrawnPair[] = [];
  for (const block of [...new Set(all.map((e) => e.block))]) {
    const mine = all.filter((e) => e.block === block);
    const roots = mine.filter((e) => e.element === null);
    // The states come from every rule of the block, also those that only style an element in a state.
    const values = new Map<string, Set<string>>();
    for (const e of mine) for (const [a, v] of Object.entries(e.attrs)) values.set(a, (values.get(a) ?? new Set()).add(v));
    const mods = [...new Set(mine.flatMap((e) => e.mods))];
    // Every state: each attribute absent or one of its values, times every subset of the modifiers.
    let states: { attrs: Record<string, string>; mods: string[] }[] = [{ attrs: {}, mods: [] }];
    for (const [a, vs] of values) states = states.flatMap((s) => [s, ...[...vs].map((v) => ({ ...s, attrs: { ...s.attrs, [a]: v } }))]);
    for (const m of mods) states = states.flatMap((s) => [s, { ...s, mods: [...s.mods, m] }]);

    for (const s of states) {
      const applies = (e: Entry) => Object.entries(e.attrs).every(([a, v]) => s.attrs[a] === v) && e.mods.every((m) => s.mods.includes(m));
      const cascade = roots.filter(applies).sort((a, b) => compareSpecificity(a.selector, b.selector) || a.order - b.order);
      const props: Record<string, string> = Object.assign({}, ...cascade.map((e) => e.decl));
      const paint = (decl: Record<string, string>, vars: Record<string, string>) => tokenOf(decl.background ?? decl['background-color'], vars);
      const tint = paint(props, props);
      const ground = tint ? [tint] : [...surfaces];
      const elements = mine.filter((x) => x.element !== null && applies(x));
      // Elements that hold what is inside them on a fill of their own, in this state (not only on hover).
      const fills = new Map<string, string>();
      for (const e of elements) {
        const bg = !e.transient && paint(e.decl, { ...props, ...e.decl });
        if (bg) fills.set(e.element as string, bg);
      }
      /** What an element sits on: the fill of the nearest element its selector puts it inside, else the ground. */
      const holder = (e: Entry) => {
        const fill = [...e.inside].reverse().find((k) => fills.has(k));
        return fill ? [fills.get(fill) as string] : ground;
      };
      const label = [block, ...Object.entries(s.attrs).map(([a, v]) => `[${a}=${v}]`), ...s.mods.map((m) => m.slice(block.length))].join('');
      const add = (fg: string | null, bgs: readonly string[], kind: DrawnPair['kind'], rule: string) => {
        if (fg) for (const bg of bgs) out.push({ where: `${label} ${rule}`, fg, bg, kind });
      };
      add(tokenOf(props.color, props), ground, 'text', block);
      for (const e of elements) {
        const own = { ...props, ...e.decl };
        const bg = paint(e.decl, own);
        add(tokenOf(e.decl.color, own), bg ? [bg] : holder(e), 'text', e.selector);
        if (e.decl.cursor === 'pointer') add(focus, holder(e), 'non-text', `${e.selector} (focus ring)`);
        if ((e.element as string).endsWith('__action')) {
          add(link, holder(e), 'text', `${e.selector} (a link in the slot)`);
          add(linkHover, holder(e), 'text', `${e.selector} (a hovered link in the slot)`);
          add(focus, holder(e), 'non-text', `${e.selector} (focus ring in the slot)`);
        }
      }
      for (const e of cascade.filter((x) => x.decl.cursor === 'pointer')) add(focus, ground, 'non-text', `${e.selector} (focus ring)`);
    }
  }
  return out;
}
