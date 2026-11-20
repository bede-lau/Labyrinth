import type { ReactNode } from 'react';
import { formatNumber, formatWindow, spokenUnit, spokenWindow } from '../format';
import { Unit } from './Unit';
import './components.css';

export interface StatProps {
  /** What the number is: "stella mean", "GPU 0 sim time". */
  label: string;
  /** `null` = not available; renders an em dash and says so, never 0. */
  value: number | null;
  /** Mandatory. Use 'dimensionless' when there is none. Subscripts: `Q_gB`, `a/v_{th,i}`. */
  unit: string;
  /** Decimals to print (match the precision you can defend). */
  decimals: number;
  /** ±1σ sampling uncertainty, printed with the same decimals. */
  uncertainty?: number | null;
  /** Averaging window, e.g. [1500, 1900]. */
  window?: readonly [number, number];
  /** Unit of the window axis (e.g. time `a/v_{th,i}`). */
  windowUnit?: string;
  /** Symbol for the window variable. Default "t". */
  windowVariable?: string;
  /** Optional trailing status (StatusPill / ProvenanceBadge). */
  status?: ReactNode;
  /** Why the value is missing, or a short qualifier. */
  note?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}

/** A number with its unit, uncertainty and window — the atomic unit of evidence. */
export function Stat({
  label,
  value,
  unit,
  decimals,
  uncertainty,
  window,
  windowUnit,
  windowVariable = 't',
  status,
  note,
  size = 'md',
  className,
}: StatProps) {
  const hasValue = value !== null && Number.isFinite(value);
  const hasUnc = hasValue && uncertainty !== null && uncertainty !== undefined && Number.isFinite(uncertainty);
  const unitShown = unit !== 'dimensionless';

  const spoken = [
    `${label}: `,
    hasValue ? formatNumber(value, decimals).replace('−', 'minus ') : 'not available',
    hasUnc ? ` plus or minus ${formatNumber(uncertainty, decimals)}` : '',
    hasValue && unitShown ? ` ${spokenUnit(unit)}` : '',
    window ? `, window ${windowVariable} ${spokenWindow(window)}${windowUnit ? ` ${spokenUnit(windowUnit)}` : ''}` : '',
  ].join('');

  return (
    <div
      className={['lab-stat', `lab-stat--${size}`, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={spoken}
      data-available={hasValue ? 'true' : 'false'}
    >
      <div className="lab-stat__label">{label}</div>
      <div className="lab-stat__value">
        <span className="lab-stat__number lab-num">{formatNumber(hasValue ? value : null, decimals)}</span>
        {hasUnc && (
          <span className="lab-stat__pm lab-num">
            <span aria-hidden="true">±</span>
            {formatNumber(uncertainty, decimals)}
          </span>
        )}
        {hasValue && unitShown && <Unit unit={unit} className="lab-stat__unit" />}
        {!hasValue && <span className="lab-stat__na">not available</span>}
        {status && <span className="lab-stat__status">{status}</span>}
      </div>
      {window && (
        <div className="lab-stat__window lab-num">
          <span className="lab-stat__window-var">{windowVariable}</span> {formatWindow(window)}
          {windowUnit && (
            <>
              {' '}
              <Unit unit={windowUnit} />
            </>
          )}
        </div>
      )}
      {note && <div className="lab-stat__note">{note}</div>}
    </div>
  );
}
