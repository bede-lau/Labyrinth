import { useMemo, useState } from 'react';
import { axisTitle, formatWindow, plotLayout, seriesStyle, useResolvedTheme } from '../../design';
import { PlotlyChart } from '../geometry/PlotlyChart';
import { visibility, type ForecastStep, type ReplayState } from './model';

const SERIES = [
  { key: 'observed', name: 'Observed', style: 'stella', symbol: 'circle', dash: 'solid' },
  { key: 'persistence', error: 'absErrPersistence', name: 'Persistence', style: 'GENE', symbol: 'diamond', dash: 'dash' },
  { key: 'frozen', error: 'absErrFrozen', name: 'Frozen', style: 'GX', symbol: 'square-open', dash: 'dot' },
] as const;

export function ForecastChart({ steps, replay }: { steps: ForecastStep[]; replay: ReplayState | null }) {
  const [errors, setErrors] = useState(false);
  const theme = useResolvedTheme();
  const metric = errors ? 'Absolute error' : 'Heat flux';
  const data = useMemo(() => SERIES.flatMap(series => {
    if (errors && !('error' in series)) return [];
    const rows = steps.filter((_, i) => {
      if (!replay) return true;
      const visible = visibility(replay, i);
      return errors || series.key === 'observed' ? visible.observed : visible.forecasts;
    });
    const field = errors && 'error' in series ? series.error : series.key;
    const color = seriesStyle(series.style, theme).line.color;
    return [{
      type: 'scatter', mode: 'lines+markers', name: series.name,
      x: rows.map(row => row.window[1]), y: rows.map(row => row[field]),
      customdata: rows.map(row => formatWindow(row.window)),
      line: { color, width: 2.5, dash: series.dash },
      marker: { color, size: 8, symbol: series.symbol },
      hovertemplate: 'Window %{customdata}<br>%{y:.4f}<extra>%{fullData.name}</extra>',
    }];
  }), [steps, replay, theme, errors]);
  const layout = useMemo(() => plotLayout(theme, {
    margin: { t: 32, l: 54, r: 16, b: 50 },
    xaxis: { title: { text: axisTitle('Window end', 'a/v_{th,i}') }, range: [steps[0]!.window[0], steps.at(-1)!.window[1] + (steps[0]!.window[1] - steps[0]!.window[0]) * 0.2], nticks: 8 },
    yaxis: { title: { text: axisTitle(metric, 'Q_{gB,i}') }, rangemode: errors ? 'tozero' : 'normal' },
    hovermode: 'closest',
    annotations: data.every(trace => trace.y.length === 0) ? [{
      text: 'Reveal a window to see its error', x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false,
    }] : [],
  }), [steps, errors, metric, theme, data]);
  return (
    <div className="fc-chart">
      <div className="fc-switch" role="group" aria-label="Comparison metric">
        {['Heat flux', 'Absolute error'].map((label, i) =>
          <button key={label} type="button" aria-pressed={metric === label} onClick={() => setErrors(i === 1)}>{label}</button>)}
      </div>
      <PlotlyChart data={data} layout={layout} ariaLabel={metric + ' by forecast window'} className="fc-plot" />
      <ul className="lab-visually-hidden" aria-label={metric + ' values'}>
        {data.map(trace => <li key={trace.name}>{trace.name}: {trace.y.map((value, i) => trace.customdata[i] + ' · ' + value.toFixed(4)).join(', ')}</li>)}
      </ul>
    </div>
  );
}
