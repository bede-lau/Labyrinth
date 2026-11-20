import { formatNumber, formatSigned, spokenUnit } from '../format';
import type { FixtureCheckData } from '../types';
import { Icon } from './Icon';
import { Unit } from './Unit';
import './components.css';

export type FixtureOutcome = 'match' | 'mismatch' | 'unknown';

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

const OUTCOME = {
  match: { icon: 'check', text: 'Match' },
  mismatch: { icon: 'cross', text: 'Mismatch' },
  unknown: { icon: 'dash', text: 'Not recomputable' },
} as const;

export interface FixtureCheckProps {
  fixture: FixtureCheckData;
  unit?: string;
  /** Label for the claimed column. Default "Claimed (PRD)". */
  claimedLabel?: string;
  className?: string;
}

/**
 * A PRD number checked against the value this repo recomputes, both at the PRD's printed precision.
 * Mismatch is loud and textual (✗ + "Mismatch" + Δ), never colour alone.
 */
export function FixtureCheck({ fixture, unit, claimedLabel = 'Claimed (PRD)', className }: FixtureCheckProps) {
  const { outcome, inconsistent } = fixtureOutcome(fixture);
  const d = fixture.printedDecimals;
  const claimed = formatNumber(fixture.claimed, d);
  const computed = formatNumber(fixture.computed, d);
  const delta = fixture.computed === null ? null : formatSigned(fixture.computed - fixture.claimed, d);
  const o = OUTCOME[outcome];
  const unitSpoken = unit && unit !== 'dimensionless' ? ` ${spokenUnit(unit)}` : '';
  const spoken =
    `${fixture.label}: ${o.text}. Claimed ${claimed}${unitSpoken}, ` +
    (fixture.computed === null ? 'computed value not available' : `computed ${computed}${unitSpoken}`) +
    (delta ? `, difference ${delta.replace('−', 'minus ')}` : '') +
    (inconsistent ? '. The match flag disagrees with the printed values.' : '');

  return (
    <div
      className={['lab-fixture', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={spoken}
      data-outcome={outcome}
    >
      <div className="lab-fixture__label">
        <span className="lab-fixture__name">{fixture.label}</span>
        {fixture.note && <span className="lab-fixture__note">{fixture.note}</span>}
        {inconsistent && (
          <span className="lab-fixture__note lab-fixture__note--warn">
            Match flag disagrees with the printed values — treated as a mismatch.
          </span>
        )}
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
          {unit && unit !== 'dimensionless' && <Unit unit={unit} className="lab-fixture__unit" />}
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
    </div>
  );
}
