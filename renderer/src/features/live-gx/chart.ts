// Plotly figure for the live panel (playback of saved evidence, or live GX samples). Pure.
import {
  axisTitle,
  formatNumber,
  plotLayout,
  seriesStyle,
  themes,
  type PlotLayout,
  type ThemeName,
} from '../../design';
import { countUpTo, type PlaySeries } from './model';

export const FLUX_UNIT = 'Q_{gB,i}';
export const TIME_UNIT = 'a/v_{th,i}';

export function playFigure(
  series: readonly PlaySeries[],
  cursor: number | null,
  theme: ThemeName,
): { data: Record<string, unknown>[]; layout: PlotLayout; summary: string } {
  const tEnd = Math.max(1, ...series.map((s) => s.t[s.t.length - 1] ?? 0));
  const qMax = Math.max(1, ...series.flatMap((s) => s.Q.filter(Number.isFinite)));
  const data = series.map((s) => {
    const n = cursor === null ? s.t.length : countUpTo(s.t, cursor);
    const st = seriesStyle(s.seriesId, theme);
    return {
      type: 'scatter',
      mode: 'lines',
      x: s.t.slice(0, n),
      y: s.Q.slice(0, n),
      name: s.name,
      line: st.line,
      hovertemplate: `${s.name}: %{y:.3f}<extra></extra>`,
    };
  });
  const t = themes[theme];
  const layout = plotLayout(theme, {
    height: 300,
    xaxis: { title: { text: axisTitle('Time t', TIME_UNIT) }, range: [0, Math.ceil(tEnd / 50) * 50] },
    yaxis: { title: { text: axisTitle('Ion heat flux Q_i', FLUX_UNIT) }, range: [0, Math.ceil(qMax * 1.1 * 2) / 2] },
    shapes:
      cursor === null
        ? []
        : [
            {
              type: 'line',
              xref: 'x',
              yref: 'paper',
              x0: cursor,
              x1: cursor,
              y0: 0,
              y1: 1,
              line: { color: t.plot.axis, width: 1, dash: 'dot' },
              layer: 'above',
              name: 'replay cursor',
            },
          ],
  });
  const summary = series
    .map((s) => {
      const n = cursor === null ? s.t.length : countUpTo(s.t, cursor);
      const last = n > 0 ? s.Q[n - 1] : null;
      return `${s.name}: ${n} of ${s.t.length} samples shown${last != null ? `, latest Q = ${formatNumber(last, 3)}` : ''}`;
    })
    .join('; ');
  return { data, layout, summary: `${summary}.` };
}
