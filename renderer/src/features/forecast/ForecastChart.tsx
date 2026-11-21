// The forecast chart block (owner's redesign bbf2fc6 combined with D-026): the owner's "Comparison metric" toggle
// (Heat flux | Absolute error) and the forecaster drawn as Predicted, above one Plotly figure with its text
// summary. Heat flux draws Predicted vs Actual (two lines); Absolute error draws |predicted − actual| of both
// forecasters and states the signed range of errors under the chart. In a step-through replay only predicted
// or revealed values are drawn; the overview (`replay` null) draws every saved window.
import { useMemo, useState } from 'react';
import { SegmentedControl, useResolvedTheme, type SegmentedOption } from '../../design';
import { chartSpec, type ChartMetric } from './chart';
import {
  FLUX_UNIT,
  FORECASTERS,
  FORECASTER_LABEL,
  completeState,
  formatStat,
  runningErrorStat,
  scoredCount,
  type ForecastArtifact,
  type Forecaster,
  type ReplayState,
} from './model';
import { CaptionUnit, PlotlyChart } from './PlotlyChart';

const METRICS: readonly { value: ChartMetric; label: string }[] = [
  { value: 'flux', label: 'Heat flux' },
  { value: 'error', label: 'Absolute error' },
];

const FORECASTER_OPTIONS: readonly SegmentedOption<Forecaster>[] = FORECASTERS.map((f) => ({ value: f, label: FORECASTER_LABEL[f] }));

export interface ForecastChartProps {
  artifact: ForecastArtifact;
  /** The step-through replay's state, or null for the overview (every saved window). */
  replay: ReplayState | null;
  /** The forecaster drawn as Predicted (and whose statistics the view shows). */
  forecaster: Forecaster;
  onForecasterChange: (f: Forecaster) => void;
}

export function ForecastChart({ artifact, replay, forecaster, onForecasterChange }: ForecastChartProps) {
  const [metric, setMetric] = useState<ChartMetric>('flux');
  const theme = useResolvedTheme();
  const n = artifact.steps.length;
  // Memoised so Plotly redraws only when what it shows changes.
  const spec = useMemo(
    () => chartSpec(metric, artifact, replay ?? completeState(n), forecaster, theme),
    [metric, artifact, replay, n, forecaster, theme],
  );
  const scored = replay ? scoredCount(replay) : n;

  return (
    <div className="fc-chart-block">
      <div className="fc-chart-head">
        <div className="fc-switch" role="group" aria-label="Comparison metric">
          {METRICS.map((m) => (
            <button key={m.value} type="button" aria-pressed={metric === m.value} onClick={() => setMetric(m.value)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="fc-forecaster">
          <span className="fc-forecaster__label" aria-hidden="true">
            Predicted
          </span>
          <SegmentedControl<Forecaster>
            label="Forecaster drawn as Predicted"
            options={FORECASTER_OPTIONS}
            value={forecaster}
            onChange={onForecasterChange}
            size="sm"
          />
        </div>
      </div>
      <PlotlyChart data={spec.data} layout={spec.layout} label={spec.label} caption={spec.caption} />
      {metric === 'error' && <ErrorRangeNote artifact={artifact} scored={scored} />}
    </div>
  );
}

/**
 * The absolute error drops the sign; the signed range of errors (min–max of predicted − actual) of both
 * forecasters says which way each erred, over the windows scored so far (a window counts at its Update, as the
 * MAE and the statistics below do).
 */
function ErrorRangeNote({ artifact, scored }: { artifact: ForecastArtifact; scored: number }) {
  const n = artifact.steps.length;
  const ranges = FORECASTERS.map((f) => ({ f, range: runningErrorStat(artifact.steps, scored, f).errorRange }));
  const over = scored >= n ? `all ${n} windows` : `${scored} of ${n} windows scored`;
  return (
    <p className="fc-range-note" data-testid="error-range-note">
      {ranges.every((r) => r.range === null) ? (
        <>Range of errors, predicted − actual: not scored yet (first Update).</>
      ) : (
        <>
          Range of errors, predicted − actual ({over}):{' '}
          {ranges.map(({ f, range }, i) => (
            <span key={f}>
              {i > 0 && '; '}
              {FORECASTER_LABEL[f]}{' '}
              <span className="lab-num">
                {formatStat('errorRange', range?.[0])} to {formatStat('errorRange', range?.[1])}
              </span>
            </span>
          ))}{' '}
          <CaptionUnit unit={FLUX_UNIT} />.
        </>
      )}
    </p>
  );
}
