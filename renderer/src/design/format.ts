// Number, unit and window formatting shared by the primitives and charts.
// One rule set so "2.242", "−0.01" and "1500–1900" look identical everywhere.

const MINUS = '−';
const EN_DASH = '–';

/**
 * True when `abs` lies exactly halfway between two numbers of `decimals` places (0.125 at 2, 2.5 at 0).
 * That is when abs × 10^d ends in exactly .5, i.e. abs is an odd multiple of 2^−(d+1): doubling it
 * d + 1 times, and no fewer, gives an integer. Doubling a double is exact, so this is too.
 */
function isExactTie(abs: number, decimals: number): boolean {
  let y = abs;
  for (let k = 0; k <= decimals + 1; k++) {
    if (Number.isInteger(y)) return k === decimals + 1;
    y *= 2;
  }
  return false;
}

/**
 * `abs` (≥ 0) to `decimals` places, an exact tie to the even neighbour: the rule of Python's round(),
 * which sets the artifacts' `matches` flags, so a value printed here and the flag computed from it
 * agree. toFixed() rounds the exact binary value too, so the two differ only on an exact tie, where
 * toFixed() goes up: 0.125 → 0.12 here, 0.13 there. 2.675 is stored below its tie and goes down in both.
 */
function fixedHalfEven(abs: number, decimals: number): string {
  const s = abs.toFixed(decimals);
  if (!isExactTie(abs, decimals)) return s;
  const last = s.charCodeAt(s.length - 1) - 48;
  // toFixed() took the upper neighbour; on an odd last digit the even one is one unit below.
  return last % 2 === 0 ? s : s.slice(0, -1) + String(last - 1);
}

/**
 * Fixed-decimal formatting with a true minus sign (U+2212). `null` -> em dash. An exact tie rounds to
 * even, as Python's round() does (0.125 → "0.12", 2.5 → "2").
 */
export function formatNumber(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const s = fixedHalfEven(Math.abs(value), decimals);
  // Avoid "−0.00": a value that rounds to zero is printed unsigned.
  const isZero = Number(s) === 0;
  return value < 0 && !isZero ? MINUS + s : s;
}

/** Always-signed formatting for deltas: +0.01, −0.01, 0.00 (same rounding as formatNumber). */
export function formatSigned(value: number, decimals: number): string {
  const s = formatNumber(value, decimals);
  if (!Number.isFinite(value) || Number(fixedHalfEven(Math.abs(value), decimals)) === 0) return s;
  return value > 0 ? `+${s}` : s;
}

/** Render a window like `1500–1900` (en dash, same decimals as given). */
export function formatWindow(window: readonly [number, number], decimals?: number): string {
  const f = (v: number) => (decimals === undefined ? trimNumber(v) : formatNumber(v, decimals));
  return `${f(window[0])}${EN_DASH}${f(window[1])}`;
}

/** Shortest faithful rendering of a number (1500, 1893.765), with a true minus sign. */
export function trimNumber(v: number): string {
  const s = String(v);
  return s.startsWith('-') ? MINUS + s.slice(1) : s;
}

/** Plain-language window for screen readers: "1500 to 1900". */
export function spokenWindow(window: readonly [number, number]): string {
  return `${trimNumber(window[0])} to ${trimNumber(window[1])}`;
}

export interface UnitPart {
  text: string;
  sub: boolean;
}

/**
 * Split a unit string into normal and subscript runs. `_x` subscripts one word, `_{...}` a group:
 * `Q_gB` -> Q + sub(gB); `a/v_{th,i}` -> a/v + sub(th,i). Words joined by a bare comma stay in one
 * subscript, the way the artifacts write units in prose: `Q_gB,i` -> Q + sub(gB,i); a comma followed
 * by a space ends it (`Q_i, Q_e`).
 */
export function parseUnit(unit: string): UnitPart[] {
  const parts: UnitPart[] = [];
  const re = /_\{([^}]*)\}|_([A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)/g;
  let last = 0;
  for (let m = re.exec(unit); m; m = re.exec(unit)) {
    if (m.index > last) parts.push({ text: unit.slice(last, m.index), sub: false });
    parts.push({ text: m[1] ?? m[2] ?? '', sub: true });
    last = m.index + m[0].length;
  }
  if (last < unit.length) parts.push({ text: unit.slice(last), sub: false });
  return parts;
}

/** Unit as plain text for accessible names: `Q_gB` -> "Q gB". */
export function spokenUnit(unit: string): string {
  return parseUnit(unit)
    .map((p) => (p.sub ? ` ${p.text}` : p.text))
    .join('')
    .trim();
}

/** Unit with Plotly's <sub> markup, for axis titles and hover templates. */
export function plotlyUnit(unit: string): string {
  return parseUnit(unit)
    .map((p) => (p.sub ? `<sub>${p.text}</sub>` : p.text))
    .join('');
}
