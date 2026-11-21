// The |B| against toroidal angle chart (H14) as its own component: it reads the running model directly and redraws
// on the playback loop's chart ticks (every frame of a 60 Hz display), not only at the view's ~10 Hz refresh, so
// the coil sweep is drawn as a sweep and not as jumps between a few phases (HF-R2). Only this component re-renders
// at that rate. Paused, nothing ticks and nothing steps, so the curve is frozen with every other display.
//
// Per frame only the traces change (HF3-1): the layout is memoised on the markers, axes and theme, keeps one
// `uirevision` (Plotly keeps the user's zoom and pan) and the running curve keeps one legend name.
import { useEffect, useMemo, useReducer, useState } from 'react';
import { NARROW_CHART_QUERY, type ThemeName } from '../../design';
import { fieldChartData, fieldChartLayout, fieldChartText, fieldCurve, type Snapshot } from './chart';
import type { FrameTicker } from './playback';
import { PlotlyChart } from './PlotlyChart';
import type { Simulation } from './sim';

export interface FieldChartProps {
  sim: Simulation;
  /** θ index of the strike line. */
  iStrike: number;
  yRange: [number, number];
  snapshot: Snapshot | null;
  sliceDeg: number;
  hoverDeg: number | null;
  diverters: { id: string; deg: number }[];
  theme: ThemeName;
  ticks: FrameTicker;
}

/** True while the viewport matches NARROW_CHART_QUERY (a phone): the chart then takes the narrow layout (DZ3-6). */
export function useNarrowChart(): boolean {
  const query = () => {
    if (typeof globalThis.matchMedia !== 'function') return null;
    const mq = globalThis.matchMedia(NARROW_CHART_QUERY);
    return mq && mq.media === NARROW_CHART_QUERY ? mq : null;
  };
  const [narrow, setNarrow] = useState(() => query()?.matches === true);
  useEffect(() => {
    const mq = query();
    if (!mq?.addEventListener) return;
    const on = () => setNarrow(mq.matches === true);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function FieldChart({ sim, iStrike, yRange, snapshot, sliceDeg, hoverDeg, diverters, theme, ticks }: FieldChartProps) {
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  useEffect(() => ticks.subscribe(redraw), [ticks]);
  const narrow = useNarrowChart();
  const thetaDeg = (360 * iStrike) / sim.model.nTheta;
  // The layout: only when a marker, an axis or the theme changes, never per model step (HF3-1).
  const layout = useMemo(
    () => fieldChartLayout({ sliceDeg, hoverDeg, diverters, thetaDeg, yRange, theme, narrow }),
    [sliceDeg, hoverDeg, diverters, thetaDeg, yRange, theme, narrow],
  );
  // sim.version changes with every step, coil switch and reset: the traces are rebuilt only then (or on a new snapshot).
  const version = sim.version;
  const curve = useMemo(() => fieldCurve(sim.model, sim.field(), iStrike), [sim, version, iStrike]);
  const data = useMemo(() => fieldChartData({ curve, snapshot, theme }), [curve, snapshot, theme]);
  const text = fieldChartText({ curve, snapshot, t: sim.time, sliceDeg, hoverDeg, diverters, thetaDeg, yRange, theme });
  return <PlotlyChart data={data} layout={layout} ariaLabel={text.ariaLabel} summary={text.summary} />;
}
