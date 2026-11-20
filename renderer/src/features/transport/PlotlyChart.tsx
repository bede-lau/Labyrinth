// Thin Plotly adapter. jsdom has no WebGL/canvas, so tests mock 'plotly.js-dist-min' and test the
// data -> props logic (model.ts) plus the DOM around the chart (aria-label, text summary).
import { useEffect, useId, useRef, useState } from 'react';
import { Callout, plotConfig, type PlotLayout } from '../../design';
import './PlotlyChart.css';

export type PlotTrace = Record<string, unknown>;

interface PlotlyApi {
  react: (el: HTMLElement, data: PlotTrace[], layout: unknown, config: unknown) => Promise<unknown> | unknown;
  purge?: (el: HTMLElement) => void;
}

let plotlyPromise: Promise<PlotlyApi> | null = null;
function loadPlotly(): Promise<PlotlyApi> {
  // @ts-ignore — plotly.js-dist-min ships no type declarations.
  plotlyPromise ??= import('plotly.js-dist-min').then((mod: { default?: unknown }) => (mod.default ?? mod) as PlotlyApi);
  const p = plotlyPromise;
  p.catch(() => {
    plotlyPromise = null;
  });
  return p;
}

export interface PlotlyChartProps {
  data: PlotTrace[];
  layout: PlotLayout;
  /** Accessible name of the chart image. */
  ariaLabel: string;
  /** Text equivalent of the chart, rendered visibly under it. */
  summary: string;
  className?: string;
}

export function PlotlyChart({ data, layout, ariaLabel, summary, className }: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    loadPlotly()
      .then((Plotly) => {
        if (cancelled || !ref.current) return;
        return Plotly.react(ref.current, data, layout, plotConfig());
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [data, layout]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) loadPlotly().then((P) => P.purge?.(el), () => undefined);
    };
  }, []);

  return (
    <figure className={['tr-figure', className].filter(Boolean).join(' ')}>
      <div ref={ref} className="tr-chart" role="img" aria-label={ariaLabel} aria-describedby={`${id}-summary`} />
      <figcaption id={`${id}-summary`} className="tr-figure__summary">
        {summary}
      </figcaption>
      {error && (
        <Callout tone="warn" title="Chart could not be drawn">
          {error} The text summary above and the tables below carry the same numbers.
        </Callout>
      )}
    </figure>
  );
}
