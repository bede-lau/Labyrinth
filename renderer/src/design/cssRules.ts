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
