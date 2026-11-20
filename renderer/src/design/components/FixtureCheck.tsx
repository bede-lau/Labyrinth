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

/**
 * Outcome at printed precision, conservatively: a match needs BOTH the data's `matches` flag and
 * identical printed strings. If the flag and the printed values disagree, it is a mismatch.
 */
export function fixtureOutcome(f: FixtureCheckData): { outcome: FixtureOutcome; inconsistent: boolean } {
  if (f.computed === null || f.matches === null) return { outcome: 'unknown', inconsistent: false };
  const same = formatNumber(f.claimed, f.printedDecimals) === formatNumber(f.computed, f.printedDecimals);
  if (f.matches && same) return { outcome: 'match', inconsistent: false };
  return { outcome: 'mismatch', inconsistent: f.matches !== same };
}

const OUTCOME: Record<FixtureOutcome, { icon: IconName; text: string }> = {
  match: { icon: 'check', text: 'Match' },
  mismatch: { icon: 'cross', text: 'Mismatch' },
  unknown: { icon: 'dash', text: 'Not recomputable' },
};
/** A match whose basis is arithmetic only: its own words and glyph, never the ✓ of a data-backed match. */
const ARITHMETIC_MATCH: { icon: IconName; text: string } = { icon: 'equals', text: 'Arithmetic consistent' };

/** Notes longer than this are clamped to two lines behind a "Show full note" toggle. */
export const FIXTURE_NOTE_CLAMP = 160;

export interface FixtureCheckProps {
  fixture: FixtureCheckData;
  unit?: string;
  /** Label for the claimed column. Default "Claimed (PRD)". */
  claimedLabel?: string;
  /** What a match is backed by (see FixtureBasis). Default 'data'. Never changes a mismatch or an unknown. */
  basis?: FixtureBasis;
  className?: string;
}

/**
 * A PRD number checked against the value this repo recomputes, both at the PRD's printed precision.
 * Mismatch is loud and textual (✗ + "Mismatch" + Δ), never colour alone.
 *
 * Reading order, in the DOM and in every layout: name → claimed → computed → Δ → outcome → note.
 * Only the explanatory note can collapse; the values, the Δ and the outcome are always shown.
 */
export function FixtureCheck({ fixture, unit, claimedLabel = 'Claimed (PRD)', basis = 'data', className }: FixtureCheckProps) {
  const { outcome, inconsistent } = fixtureOutcome(fixture);
  const noteId = useId();
  const [expanded, setExpanded] = useState(false);
  const d = fixture.printedDecimals;
  const claimed = formatNumber(fixture.claimed, d);
  const computed = formatNumber(fixture.computed, d);
  const delta = fixture.computed === null ? null : formatSigned(fixture.computed - fixture.claimed, d);
  const o = outcome === 'match' && basis === 'arithmetic' ? ARITHMETIC_MATCH : OUTCOME[outcome];
  const unitSpoken = unit && unit !== 'dimensionless' ? ` ${spokenUnit(unit)}` : '';
  const spoken =
    `${fixture.label}: ${o.text}. Claimed ${claimed}${unitSpoken}, ` +
    (fixture.computed === null ? 'computed value not available' : `computed ${computed}${unitSpoken}`) +
    (delta ? `, difference ${delta.replace('−', 'minus ')}` : '') +
    (inconsistent ? '. The match flag disagrees with the printed values.' : '');
  const longNote = Boolean(fixture.note) && (fixture.note as string).length > FIXTURE_NOTE_CLAMP;

  return (
    <div
      className={['lab-fixture', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={spoken}
      data-outcome={outcome}
      data-basis={basis}
    >
      <div className="lab-fixture__label">
        <span className="lab-fixture__name">{fixture.label}</span>
      </div>
      <div className="lab-fixture__cell">
        <span className="lab-fixture__k">{claimedLabel}</span>
        <span className="lab-fixture__v lab-num" data-testid="claimed">
          {claimed}
        </span>
      </div>
      <div className="lab-fixture__cell">
        <span className="lab-fixture__k">Computed</span>
        <span className="lab-fixture__v lab-num" data-testid="computed">
          {computed}
          {/* No unit after the em dash of a value that could not be recomputed: "— Q_gB" reads as a quantity. */}
          {fixture.computed !== null && unit && unit !== 'dimensionless' && <Unit unit={unit} className="lab-fixture__unit" />}
        </span>
      </div>
      <div className="lab-fixture__cell">
        <span className="lab-fixture__k">Δ</span>
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
              Match flag disagrees with the printed values — treated as a mismatch.
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
