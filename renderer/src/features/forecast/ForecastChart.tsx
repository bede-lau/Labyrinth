import { useMemo, useState } from 'react';
import { useResolvedTheme } from '../../design';
import { chartSpec, type ChartMetric } from './chart';
import { completeState, type ForecastArtifact, type ReplayState } from './model';
import { PlotlyChart } from './PlotlyChart';

const METRICS: readonly { value: ChartMetric; label: string }[] = [
  { value: 'flux', label: 'Heat flux' },
  { value: 'error', label: 'Absolute error' },
];


export interface ForecastChartProps {
  artifact: ForecastArtifact;
  /** The step-through replay's state, or null for the overview (every saved window). */
  replay: ReplayState | null;
}

export function ForecastChart({ artifact, replay }: ForecastChartProps) {
  const [metric, setMetric] = useState<ChartMetric>('flux');
  const theme = useResolvedTheme();
  const n = artifact.steps.length;
  // Memoised so Plotly redraws only when what it shows changes.
  const spec = useMemo(
    () => chartSpec(metric, artifact, replay ?? completeState(n), 'persistence', theme),
    [metric, artifact, replay, n, theme],
  );

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
      </div>
      <PlotlyChart data={spec.data} layout={spec.layout} label={spec.label} caption={spec.caption} />
    </div>
  );
}
