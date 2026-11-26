import { linearTicks, logTicks } from './scene';
import './LogTicks.css';

/** Label of a tick value: no trailing zeros and no rounding (0.2, 0.5, 1, 1.5, 2, 10, 20). */
const label = (v: number) => String(Number(v.toPrecision(6)));

/**
 * The ticks of a colour bar over [lo, hi] (already in the displayed unit), placed where each value sits on the bar: the
 * 1-2-5 values of each decade on a logarithmic bar (the default), or even 1-2-5 steps on a linear one. Decorative for
 * screen readers: the bar's own label states the range and the scale.
 */
export function LogTicks({ lo, hi, scale = 'log' }: { lo: number; hi: number; scale?: 'log' | 'linear' }) {
  const ticks = scale === 'log' ? logTicks(lo, hi) : linearTicks(lo, hi);
  if (!ticks.length) return null;
  return (
    <span className="lab-logticks lab-num" aria-hidden="true" data-testid="log-ticks" data-scale={scale}>
      {ticks.map((t) => (
        <span key={t.value} style={{ left: `${(t.at * 100).toFixed(2)}%` }}>
          {label(t.value)}
        </span>
      ))}
    </span>
  );
}
