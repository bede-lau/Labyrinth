import { useId, useState } from 'react';
import { formatNumber, formatSigned, spokenUnit, trimNumber } from '../format';
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

/**
 * Outcome, conservatively. A match needs BOTH the data's `matches` flag and the values: identical
 * printed strings for a claimed value, `lo ≤ computed ≤ hi` (unrounded) for a claimed range. If the
 * flag and the values disagree, it is a mismatch. With no claim, no computed value or no flag, unknown.
 */
export function fixtureOutcome(f: FixtureCheckData): { outcome: FixtureOutcome; inconsistent: boolean } {
  const claim = claimOf(f);
  if (claim.kind === 'none' || f.computed === null || f.matches === null) return { outcome: 'unknown', inconsistent: false };
  const agrees =
    claim.kind === 'range'
      ? inRange(f.computed, claim.lo, claim.hi)
      : formatNumber(claim.value, f.printedDecimals) === formatNumber(f.computed, f.printedDecimals);
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
const RANGE_MATCH: OutcomeWords = { icon: 'check', text: 'Inside PRD range' };
const RANGE_ARITHMETIC_MATCH: OutcomeWords = { icon: 'equals', text: 'Arithmetic in PRD range' };
const RANGE_OUTSIDE: OutcomeWords = { icon: 'cross', text: 'Outside PRD range' };
const NO_CLAIM: OutcomeWords = { icon: 'dash', text: 'No PRD value' };

function words(outcome: FixtureOutcome, basis: FixtureBasis, claim: Claim, computedInRange: boolean | null): OutcomeWords {
  if (claim.kind === 'none') return NO_CLAIM;
  if (outcome === 'match') {
    if (claim.kind === 'range') return basis === 'arithmetic' ? RANGE_ARITHMETIC_MATCH : RANGE_MATCH;
    return basis === 'arithmetic' ? ARITHMETIC_MATCH : OUTCOME.match;
  }
  // "Outside" only when the value is outside; a flag that says no to a value inside is a plain mismatch.
  if (outcome === 'mismatch' && claim.kind === 'range' && computedInRange === false) return RANGE_OUTSIDE;
  return OUTCOME[outcome];
}

/**
 * Decimals for a computed value checked against a range. The check is unrounded, so the value is
 * printed with two more decimals than the PRD's, and more when that would put the printed value on
 * the other side of a bound (15.000004 must not read "15.00" against 14–15).
 */
function rangeDecimals(v: number, lo: number, hi: number, printed: number): number {
  const side = (x: number) => (x < lo ? -1 : x > hi ? 1 : 0);
  const truth = side(v);
  for (let d = printed + 2; d <= printed + 15; d++) if (side(Number(v.toFixed(d))) === truth) return d;
  return printed + 15;
}

/** A bound at the PRD's decimals, unless that would change it. */
const boundText = (v: number, printed: number) => (Number(v.toFixed(printed)) === v ? formatNumber(v, printed) : trimNumber(v));
const spokenSigned = (s: string) => s.replace('−', 'minus ').replace('+', 'plus ');

/** Notes longer than this are clamped to two lines behind a "Show full note" toggle. */
export const FIXTURE_NOTE_CLAMP = 160;

export interface FixtureCheckProps {
  fixture: FixtureCheckData;
  unit?: string;
  /** Label for the claimed column. Default "Claimed (PRD)", or "PRD range" when the fixture has a `claimedRange`. */
  claimedLabel?: string;
  /**
   * What a match is backed by (see FixtureBasis). Default: the fixture's own `basis`, else 'data'.
   * Pass it only to override the data. Never changes a mismatch or an unknown.
   */
  basis?: FixtureBasis;
  className?: string;
}

/**
 * A PRD number (or range) checked against the value this repo recomputes. A claimed value is
 * compared at the PRD's printed precision; a claimed range by `lo ≤ computed ≤ hi`, with no midpoint
 * anywhere. Mismatch is loud and textual (✗ + words + Δ), never colour alone.
 *
 * Reading order, in the DOM and in every layout: name → claimed → computed → Δ → outcome → note.
 * Only the explanatory note can collapse; the values, the Δ and the outcome are always shown.
 */
export function FixtureCheck({ fixture, unit, claimedLabel, basis: basisProp, className }: FixtureCheckProps) {
  const { outcome, inconsistent } = fixtureOutcome(fixture);
  const noteId = useId();
  const [expanded, setExpanded] = useState(false);
  const basis: FixtureBasis = basisProp ?? fixture.basis ?? 'data';
  const claim = claimOf(fixture);
  const d = fixture.printedDecimals;
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
    claimedSpoken = `PRD range ${lo} to ${hi}${unitSpoken}`;
    deltaKey = 'Δ to range';
    if (c === null) computedText = formatNumber(c, d);
    else {
      const dc = rangeDecimals(c, claim.lo, claim.hi, d);
      computedText = formatNumber(c, dc);
      computedInRange = inRange(c, claim.lo, claim.hi);
      // Distance to the nearer bound: 0 inside, negative below, positive above. Never a midpoint.
      const distance = c < claim.lo ? c - claim.lo : c > claim.hi ? c - claim.hi : 0;
      delta = formatSigned(distance, dc);
      deltaSpoken = `, distance to the range ${spokenSigned(delta)}`;
    }
  } else {
    claimedText = claim.kind === 'value' ? formatNumber(claim.value, d) : '—';
    claimedSpoken = claim.kind === 'value' ? `Claimed ${claimedText}${unitSpoken}` : 'Claimed value not available';
    computedText = formatNumber(c, d);
    if (claim.kind === 'value' && c !== null) {
      delta = formatSigned(c - claim.value, d);
      deltaSpoken = `, difference ${delta.replace('−', 'minus ')}`;
    }
  }
  const o = words(outcome, basis, claim, computedInRange);
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
        <span className="lab-fixture__k">{claimedLabel ?? (claim.kind === 'range' ? 'PRD range' : 'Claimed (PRD)')}</span>
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
