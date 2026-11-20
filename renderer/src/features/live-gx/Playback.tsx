// Replay player for saved evidence (archived stella/GENE traces or a saved GX rehearsal run).
// Never styled as live: its Panel carries a Replay or Rehearsal pill, and the clock is labelled "replay clock".
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Stat, Unit, formatNumber, useResolvedTheme } from '../../design';
import { PlotlyChart } from '../transport/PlotlyChart';
import { FLUX_UNIT, TIME_UNIT, playFigure } from './chart';
import { countUpTo, type PlaySeries } from './model';

const STEPS = 60;
const TICK_MS = 500;

function prefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface PlaybackProps {
  kind: 'replay' | 'rehearsal';
  /** Visible label of what is playing ("Archived stella/GENE evidence", "saved GX rehearsal run …"). */
  label: string;
  series: PlaySeries[];
  autoPlay?: boolean;
  children?: ReactNode;
}

export function Playback({ kind, label, series, autoPlay, children }: PlaybackProps) {
  const theme = useResolvedTheme();
  const id = useId();
  const tEnd = Math.max(0, ...series.map((s) => s.t[s.t.length - 1] ?? 0));
  const startPlaying = autoPlay ?? !prefersReducedMotion();
  const [cursor, setCursor] = useState(startPlaying ? 0 : tEnd);
  const [playing, setPlaying] = useState(startPlaying);

  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => {
      setCursor((c) => {
        const next = Math.min(tEnd, c + tEnd / STEPS);
        if (next >= tEnd) setPlaying(false);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(h);
  }, [playing, tEnd]);

  const fig = useMemo(() => playFigure(series, cursor, theme), [series, cursor, theme]);
  const atEnd = cursor >= tEnd;

  return (
    <div className="lg-play" data-kind={kind}>
      {/* The enclosing Panel carries the one Replay / Rehearsal pill for this evidence (DS-21). */}
      <div className="lg-play__head">
        <p className="lg-play__label" data-testid="playback-label">
          Playing: {label}
        </p>
      </div>
      <div className="lg-play__controls">
        <button
          type="button"
          className="lg-btn"
          onClick={() => {
            if (atEnd) setCursor(0);
            setPlaying((p) => (atEnd ? true : !p));
          }}
        >
          {playing ? 'Pause replay' : atEnd ? 'Restart replay' : 'Play replay'}
        </button>
        <label className="lg-scrub" htmlFor={`${id}-scrub`}>
          <span>Replay clock</span>
          <input
            id={`${id}-scrub`}
            type="range"
            min={0}
            max={tEnd}
            step={tEnd / STEPS || 1}
            value={cursor}
            onChange={(e) => {
              setPlaying(false);
              setCursor(Number(e.target.value));
            }}
            aria-valuetext={`t = ${formatNumber(cursor, 0)} of ${formatNumber(tEnd, 0)}`}
          />
        </label>
      </div>
      <div className="lg-play__stats">
        <Stat label="Replay clock (not live)" value={cursor} unit={TIME_UNIT} decimals={0} />
        {series.map((s) => {
          const n = countUpTo(s.t, cursor);
          return (
            <Stat
              key={s.id}
              label={`${s.name} · samples played`}
              value={n}
              unit="dimensionless"
              decimals={0}
              note={
                n > 0 ? (
                  <>
                    of {s.t.length} · latest Q = {formatNumber(s.Q[n - 1], 3)} <Unit unit={FLUX_UNIT} />
                  </>
                ) : (
                  `of ${s.t.length}`
                )
              }
            />
          );
        })}
      </div>
      <PlotlyChart
        data={fig.data}
        layout={fig.layout}
        ariaLabel={`Replay chart (${kind === 'rehearsal' ? 'saved rehearsal' : 'archived evidence'}, not live): ion heat flux versus time up to the replay clock`}
        summary={fig.summary}
      />
      {children}
    </div>
  );
}
