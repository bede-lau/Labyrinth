// Accuracy summary of the forecast replay: mean percentage error of each forecaster with its 95% confidence
// interval as an error bar, every scored window as a dot, a few stat tiles and what the numbers mean.
import { useMemo } from 'react';
import { plotLayout, themes, useResolvedTheme, type ThemeName } from '../../design';
import { accuracy, percentErrors, significance, type Accuracy } from './accuracy';
import { forecasterColor, type ForecastChartSpec } from './chart';
import { FORECASTERS, FORECASTER_LABEL, completeState, type ForecastArtifact, type ReplayState } from './model';
import { PlotlyChart } from './PlotlyChart';

export function accuracyChartSpec(a: ForecastArtifact, s: ReplayState, acc: Accuracy, theme: ThemeName): ForecastChartSpec {
  const t = themes[theme];
  const pct = percentErrors(a.steps, s);
  const data = FORECASTERS.flatMap((f, i) => {
    const st = acc.forecasters[f];
    const color = forecasterColor(f, theme);
    return [
      {
        type: 'bar',
        name: FORECASTER_LABEL[f],
        x: [FORECASTER_LABEL[f]],
        y: [st.mape],
        width: 0.5,
        marker: { color, opacity: 0.35, line: { color, width: 1.5 } },
        error_y: st.ci
          ? { type: 'data', symmetric: false, array: [st.ci[1] - st.mape], arrayminus: [st.mape - st.ci[0]], color: t.color.text, thickness: 1.5, width: 10 }
          : { visible: false },
        hovertemplate: st.ci
          ? `${FORECASTER_LABEL[f]}: %{y:.2f}% (95% CI ${st.ci[0].toFixed(2)}–${st.ci[1].toFixed(2)}%)<extra></extra>`
          : `${FORECASTER_LABEL[f]}: %{y:.2f}%<extra></extra>`,
        showlegend: false,
      },
      {
        type: 'scatter',
        mode: 'markers',
        name: `${FORECASTER_LABEL[f]} windows`,
        // Spread the window dots a little sideways so they do not sit on top of each other.
        x: pct[f].map(() => FORECASTER_LABEL[f]),
        y: pct[f].map((w) => w.abs),
        xaxis: 'x',
        marker: { color, size: 8, line: { color: t.plot.paper, width: 1 } },
        customdata: pct[f].map((w) => `${w.window[0]}–${w.window[1]}`),
        hovertemplate: `window %{customdata}: %{y:.2f}%<extra></extra>`,
        offsetgroup: String(i),
        showlegend: false,
      },
    ];
  });
  const layout = plotLayout(theme, {
    showlegend: false,
    hovermode: 'closest',
    margin: { t: 12, b: 36 },
    xaxis: { showgrid: false, title: { text: '' } },
    yaxis: { title: { text: 'Mean percentage error (%)' }, ticksuffix: '%', rangemode: 'tozero' },
  });
  const caption = [
    FORECASTERS.map((f) => {
      const st = acc.forecasters[f];
      return `${FORECASTER_LABEL[f]} mean percentage error ${st.mape.toFixed(2)}%` + (st.ci ? `, 95% confidence interval ${st.ci[0].toFixed(2)} to ${st.ci[1].toFixed(2)}%` : '') + '.';
    }).join(' '),
  ];
  return {
    data,
    layout,
    label: `Chart: mean percentage error of each forecaster with 95% confidence intervals, over ${acc.n} scored windows`,
    summary: caption.join(''),
    caption,
  };
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="fc-tile">
      <span className="fc-tile__label">{label}</span>
      <span className="fc-tile__value">{value}</span>
      {note && <span className="fc-tile__note">{note}</span>}
    </div>
  );
}

export function AccuracyPanel({ artifact, replay }: { artifact: ForecastArtifact; replay: ReplayState | null }) {
  const theme = useResolvedTheme();
  const state = replay ?? completeState(artifact.steps.length);
  const acc = useMemo(() => accuracy(artifact.steps, state), [artifact, state]);
  const spec = useMemo(() => (acc ? accuracyChartSpec(artifact, state, acc, theme) : null), [artifact, state, acc, theme]);
  if (!acc || !spec) return <section className="fc-accuracy"><h3>Forecast accuracy</h3><p className="fc-accuracy__empty">Reveal a window to score the forecasts.</p></section>;
  const { persistence: P, frozen: F } = acc.forecasters;
  const ci = (c: [number, number] | null) => (c ? `95% CI ${c[0].toFixed(2)}–${c[1].toFixed(2)}%` : 'needs 2+ windows');
  return (
    <section className="fc-accuracy" aria-label="Forecast accuracy">
      <div className="fc-accuracy__head">
        <h3>Forecast accuracy</h3>
        <span className="fc-accuracy__source">computed here from the archived window means · {acc.n} of {artifact.steps.length} windows</span>
      </div>
      <div className="fc-tiles">
        <Tile label="Persistence MAPE" value={P.mape.toFixed(2) + '%'} note={ci(P.ci)} />
        <Tile label="Frozen MAPE" value={F.mape.toFixed(2) + '%'} note={ci(F.ci)} />
        <Tile label="Flux variability" value={acc.variability === null ? '—' : acc.variability.toFixed(2) + '%'} note="window-to-window" />
        <Tile label="Difference" value={acc.paired.p === null ? '—' : 'p = ' + acc.paired.p.toFixed(2)} note="paired t-test" />
      </div>
      <div className="fc-accuracy__body">
        <PlotlyChart data={spec.data} layout={spec.layout} label={spec.label} caption={spec.caption} />
        <ul className="fc-accuracy__meaning">
          {significance(acc).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
    </section>
  );
}
