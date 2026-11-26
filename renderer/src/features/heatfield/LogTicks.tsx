import { logTicks } from './scene';
import './LogTicks.css';

/** Label of a tick value: no trailing zeros (0.2, 0.5, 1, 2, 5, 10, 20). */
const label = (v: number) => (v >= 1 ? v.toFixed(0) : String(Number(v.toPrecision(1))));

/**
 * The 1-2-5 ticks of a logarithmic colour bar over [lo, hi] (already in the displayed unit), placed where each value sits on
 * the bar. Decorative for screen readers: the bar's own label states the range and the scale.
 */
export function LogTicks({ lo, hi }: { lo: number; hi: number }) {
  const ticks = logTicks(lo, hi);
  if (!ticks.length) return null;
  return (
    <span className="lab-logticks lab-num" aria-hidden="true" data-testid="log-ticks">
      {ticks.map((t) => (
        <span key={t.value} style={{ left: `${(t.at * 100).toFixed(2)}%` }}>
          {label(t.value)}
        </span>
      ))}
    </span>
  );
}
