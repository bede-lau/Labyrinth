import { useId, useState } from 'react';
import { formatNumber, formatSigned, spokenUnit } from '../format';
import type { FixtureCheckData } from '../types';
import { Icon, type IconName } from './Icon';
import { Unit } from './Unit';
import './components.css';

export type FixtureOutcome = 'match' | 'mismatch' | 'unknown';

/**
 * What a match is backed by.
 * - `data` (default): the value was recomputed from data in this repo → "Match".
 * - `arithmetic`: only the arithmetic was redone, on inputs that are themselves PRD-reported
 *   (161 h × 288 processors = 46,368) → "Arithmetic consistent". It says the sum is right, not that
 *   the inputs are.
 */
export type FixtureBasis = 'data' | 'arithmetic';

/** The claim side of a fixture: a printed value, a printed range (D-023), or nothing to compare with. */
type Claim = { kind: 'value'; value: number } | { kind: 'range'; lo: number; hi: number } | { kind: 'none' };

function claimOf(f: FixtureCheckData): Claim {
  // A range wins over `claimed`: an old artifact put the range's midpoint there, a value the PRD never printed.
  if (f.claimedRange) {
    const [a, b] = f.claimedRange;
    return { kind: 'range', lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  return f.claimed === null || !Number.isFinite(f.claimed) ? { kind: 'none' } : { kind: 'value', value: f.claimed };
}

const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

/** The most decimals toFixed() prints (it throws above this). */
const MAX_DECIMALS = 100;
/** The fixture's printedDecimals as places to print: the contract allows any integer ≥ 0; toFixed() stops at 100. */
const placesOf = (printed: number) => (Number.isFinite(printed) ? Math.min(MAX_DECIMALS, Math.max(0, Math.trunc(printed))) : 0);

/** The number a reader sees: `v` at `d` decimals, rounded as formatNumber prints it (ties to even, like Python). */
const printedValue = (v: number, d: number) => Number(formatNumber(v, d).replace('−', '-'));

/**
 * Every digit of `v`'s shortest round-trip form, in fixed notation ("0.00000000000000034907…", never
 * "3.49…e-16"), with a true minus sign. It reads back as `v`, so it is always on `v`'s own side of a bound.
 */
function fixedFull(v: number): string {
  const s = String(Math.abs(v));
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  let out = s;
  if (m) {
    const digits = `${m[1] as string}${m[2] ?? ''}`;
    const point = (m[1] as string).length + Number(m[3]);
    if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`;
    else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
    else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return v < 0 ? `−${out}` : out;
}

/** Where the claim is printed (contract `claimSource`): "TASK.md" for "task", else "PRD". */
type SourceWord = 'PRD' | 'TASK.md';
const sourceWord = (f: FixtureCheckData): SourceWord => (f.claimSource === 'task' ? 'TASK.md' : 'PRD');

/**
 * Outcome, conservatively. A match needs BOTH the data's `matches` flag and the values: identical
 * printed strings for a claimed value, `lo ≤ computed ≤ hi` (unrounded) for a claimed range. If the
 * flag and the values disagree, it is a mismatch. With no claim, no computed value or no flag, unknown.
 * Printed strings round exact ties to even, as Python's round() does when it sets `matches`.
 */
export function fixtureOutcome(f: FixtureCheckData): { outcome: FixtureOutcome; inconsistent: boolean } {
  const claim = claimOf(f);
  if (claim.kind === 'none' || f.computed === null || f.matches === null) return { outcome: 'unknown', inconsistent: false };
  const d = placesOf(f.printedDecimals);
  const agrees = claim.kind === 'range' ? inRange(f.computed, claim.lo, claim.hi) : formatNumber(claim.value, d) === formatNumber(f.computed, d);
  if (f.matches && agrees) return { outcome: 'match', inconsistent: false };
  return { outcome: 'mismatch', inconsistent: f.matches !== agrees };
}

interface OutcomeWords {
  icon: IconName;
  text: string;
}
const OUTCOME: Record<FixtureOutcome, OutcomeWords> = {
  match: { icon: 'check', text: 'Match' },
  mismatch: { icon: 'cross', text: 'Mismatch' },
  unknown: { icon: 'dash', text: 'Not recomputable' },
};
/** A match whose basis is arithmetic only: its own words and glyph, never the ✓ of a data-backed match. */
const ARITHMETIC_MATCH: OutcomeWords = { icon: 'equals', text: 'Arithmetic consistent' };

/** The words that name the claim's source ("Inside PRD range", "No TASK.md value"). */
function words(outcome: FixtureOutcome, basis: FixtureBasis, claim: Claim, computedInRange: boolean | null, source: SourceWord): OutcomeWords {
  if (claim.kind === 'none') return { icon: 'dash', text: `No ${source} value` };
  if (outcome === 'match') {
    if (claim.kind === 'range')
      return basis === 'arithmetic' ? { icon: 'equals', text: `Arithmetic in ${source} range` } : { icon: 'check', text: `Inside ${source} range` };
    return basis === 'arithmetic' ? ARITHMETIC_MATCH : OUTCOME.match;
  }
  // "Outside" only when the value is outside; a flag that says no to a value inside is a plain mismatch.
  if (outcome === 'mismatch' && claim.kind === 'range' && computedInRange === false) return { icon: 'cross', text: `Outside ${source} range` };
  return OUTCOME[outcome];
}

/**
 * A computed value checked against a range, as printed. The check is unrounded, so the value is
 * printed with two more decimals than the claim's, and more when that would put the printed value on
 * the other side of a bound (15.000004 must not read "15.00" against 14–15; −3.49e-16 must not read
 * "0.00" against 0–1), up to the 100 places toFixed() prints. Nearer a bound than that (only a bound
 * at or near 0 allows it) the value prints with every digit of its shortest round-trip form, in fixed
 * notation, which reads back as v and so is always on v's own side.
 * `decimals` is how many places the text shows, for the Δ beside it.
 */
function rangeComputed(v: number, lo: number, hi: number, printed: number): { text: string; decimals: number } {
  const side = (x: number) => (x < lo ? -1 : x > hi ? 1 : 0);
  const truth = side(v);
  for (let d = Math.min(printed + 2, MAX_DECIMALS); d <= MAX_DECIMALS; d++)
    if (side(printedValue(v, d)) === truth) return { text: formatNumber(v, d), decimals: d };
  const text = fixedFull(v);
  return { text, decimals: /\.(\d+)$/.exec(text)?.[1]?.length ?? MAX_DECIMALS };
}

/**
 * The signed distance to the range at `decimals` places, with more places when that would print a
 * value outside the range as an unsigned zero (every digit, in fixed notation, past 100 places):
 * outside, Δ always carries its sign.
 */
function distanceText(distance: number, decimals: number): string {
  for (let d = Math.min(decimals, MAX_DECIMALS); d <= MAX_DECIMALS; d++) {
    const s = formatSigned(distance, d);
    if (distance === 0 || /^[+−]/.test(s)) return s;
  }
  return distance > 0 ? `+${fixedFull(distance)}` : fixedFull(distance);
}

/** A bound at the claim's decimals, unless that would change it (then every digit, in fixed notation). */
const boundText = (v: number, printed: number) => (printedValue(v, printed) === v ? formatNumber(v, printed) : fixedFull(v));
const spokenSigned = (s: string) => s.replace('−', 'minus ').replace('+', 'plus ');

/** Notes longer than this are clamped to two lines behind a "Show full note" toggle. */
export const FIXTURE_NOTE_CLAMP = 160;

export interface FixtureCheckProps {
  fixture: FixtureCheckData;
  unit?: string;
  /**
   * Label for the claimed column. Default "Claimed (PRD)", or "PRD range" when the fixture has a
   * `claimedRange`; "Claimed (TASK.md)" / "TASK.md range" when its `claimSource` is "task".
   */
  claimedLabel?: string;
  /**
   * What a match is backed by (see FixtureBasis). Default: the fixture's own `basis`, else 'data'.
   * It can only make a check more cautious: 'arithmetic' marks a data fixture as arithmetic-only, but
   * an arithmetic fixture stays arithmetic whatever is passed (D-023: the basis is the artifact's).
   * Never changes a mismatch or an unknown.
   */
  basis?: FixtureBasis;
  className?: string;
}

/**
 * A PRD number (or range) checked against the value this repo recomputes. A claimed value is
 * compared at the PRD's printed precision; a claimed range by `lo ≤ computed ≤ hi`, with no midpoint
 * anywhere. Mismatch is loud and textual (✗ + words + Δ), never colour alone. A fixture whose
 * `claimSource` is "task" is a TASK.md figure: every word that names the source says TASK.md.
 *
 * Reading order, in the DOM and in every layout: name → claimed → computed → Δ → outcome → note.
 * Only the explanatory note can collapse; the values, the Δ and the outcome are always shown.
 */
export function FixtureCheck({ fixture, unit, claimedLabel, basis: basisProp, className }: FixtureCheckProps) {
  const { outcome, inconsistent } = fixtureOutcome(fixture);
  const noteId = useId();
  const [expanded, setExpanded] = useState(false);
  // The prop may downgrade a data fixture, never upgrade an arithmetic one to a ✓ "Match".
  const basis: FixtureBasis = fixture.basis === 'arithmetic' ? 'arithmetic' : (basisProp ?? 'data');
  const claim = claimOf(fixture);
  const source = sourceWord(fixture);
  const d = placesOf(fixture.printedDecimals);
  const c = fixture.computed;
  const showUnit = Boolean(unit && unit !== 'dimensionless');
  const unitSpoken = showUnit ? ` ${spokenUnit(unit as string)}` : '';

  let claimedText: string;
  let computedText: string;
  let delta: string | null = null;
  let deltaKey = 'Δ';
  let claimedSpoken: string;
  let deltaSpoken = '';
  let computedInRange: boolean | null = null;
  if (claim.kind === 'range') {
    const lo = boundText(claim.lo, d);
    const hi = boundText(claim.hi, d);
    claimedText = `${lo}–${hi}`;
    claimedSpoken = `${source} range ${lo} to ${hi}${unitSpoken}`;
    deltaKey = 'Δ to range';
    if (c === null) computedText = formatNumber(c, d);
    else {
      const shown = rangeComputed(c, claim.lo, claim.hi, d);
      computedText = shown.text;
      computedInRange = inRange(c, claim.lo, claim.hi);
      // Distance to the nearer bound: 0 inside, negative below, positive above. Never a midpoint.
      const distance = c < claim.lo ? c - claim.lo : c > claim.hi ? c - claim.hi : 0;
      delta = distanceText(distance, shown.decimals);
      deltaSpoken = `, distance to the range ${spokenSigned(delta)}`;
    }
  } else {
    claimedText = claim.kind === 'value' ? formatNumber(claim.value, d) : '—';
    claimedSpoken = claim.kind === 'value' ? `Claimed ${claimedText}${unitSpoken}` : 'Claimed value not available';
    computedText = formatNumber(c, d);
    if (claim.kind === 'value' && c !== null) {
      // The difference of the two printed values: 0 exactly when they match, never a zero beside a mismatch.
      delta = formatSigned(printedValue(c, d) - printedValue(claim.value, d), d);
      deltaSpoken = `, difference ${delta.replace('−', 'minus ')}`;
    }
  }
  const o = words(outcome, basis, claim, computedInRange, source);
  const disagreement = claim.kind === 'range' ? 'the range test' : 'the printed values';
  const spoken =
    `${fixture.label}: ${o.text}. ${claimedSpoken}, ` +
    (c === null ? 'computed value not available' : `computed ${computedText}${unitSpoken}`) +
    deltaSpoken +
    (inconsistent ? `. The match flag disagrees with ${disagreement}.` : '');
  const longNote = Boolean(fixture.note) && (fixture.note as string).length > FIXTURE_NOTE_CLAMP;

  return (
    <div
      className={['lab-fixture', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={spoken}
      data-outcome={outcome}
      data-basis={basis}
      data-claim={claim.kind}
    >
      <div className="lab-fixture__label">
        <span className="lab-fixture__name">{fixture.label}</span>
      </div>
      <div className="lab-fixture__cell">
        <span className="lab-fixture__k">{claimedLabel ?? (claim.kind === 'range' ? `${source} range` : `Claimed (${source})`)}</span>
        <span className="lab-fixture__v lab-num" data-testid="claimed">
          {/* A range never breaks at its dash ("3100–" / "3200"); only the unit after it may wrap. */}
          {claim.kind === 'range' ? <span className="lab-fixture__range">{claimedText}</span> : claimedText}
          {/* A range is not a quantity without its unit; a single claimed value keeps the compact form.
              <wbr>: the unit's own break opportunity (the range span offers none), so a narrow column
              puts it on the next line instead of running it into the computed value. */}
          {claim.kind === 'range' && showUnit && (
            <>
              <wbr />
              <Unit unit={unit as string} className="lab-fixture__unit" />
            </>
          )}
        </span>
      </div>
      <div className="lab-fixture__cell">
        <span className="lab-fixture__k">Computed</span>
        <span className="lab-fixture__v lab-num" data-testid="computed">
          {computedText}
          {/* No unit after the em dash of a value that could not be recomputed: "— Q_gB" reads as a quantity. */}
          {c !== null && showUnit && <Unit unit={unit as string} className="lab-fixture__unit" />}
        </span>
      </div>
      <div className="lab-fixture__cell">
        <span className="lab-fixture__k">{deltaKey}</span>
        <span className="lab-fixture__v lab-fixture__delta lab-num">{delta ?? '—'}</span>
      </div>
      <div className="lab-fixture__outcome">
        <span className="lab-fixture__glyph" aria-hidden="true">
          <Icon name={o.icon} size={12} />
        </span>
        <span className="lab-fixture__outcome-text">{o.text}</span>
      </div>
      {(fixture.note || inconsistent) && (
        <div className="lab-fixture__notes">
          {inconsistent && (
            <span className="lab-fixture__note lab-fixture__note--warn">
              Match flag disagrees with {disagreement} — treated as a mismatch.
            </span>
          )}
          {fixture.note && (
            <span id={noteId} className="lab-fixture__note" data-clamped={longNote && !expanded ? 'true' : undefined}>
              {fixture.note}
            </span>
          )}
          {longNote && (
            <button
              type="button"
              className="lab-fixture__more"
              aria-expanded={expanded}
              aria-controls={noteId}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? 'Show less' : 'Show full note'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
