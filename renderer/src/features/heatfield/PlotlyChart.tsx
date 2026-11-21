// Thin Plotly adapter for Heat & field. plotly.js-dist-min (~4.6 MB) is imported lazily, never statically
// (features/transport/lazyLoad.test.ts scans all of src). jsdom cannot render Plotly; the view tests replace this
// module and check the spec passed in. Named on its <figure> (DESIGN.md §6), not with role="img" on the plot.
import { useEffect, useRef, useState } from 'react';
import { Callout, plotConfig, type PlotLayout } from '../../design';

interface PlotlyApi {
  react: (el: HTMLElement, data: unknown[], layout: unknown, config: unknown) => Promise<unknown> | unknown;
  purge?: (el: HTMLElement) => void;
}

let plotlyPromise: Promise<PlotlyApi> | null = null;
function loadPlotly(): Promise<PlotlyApi> {
  // @ts-ignore: plotly.js-dist-min ships no type declarations.
  plotlyPromise ??= import('plotly.js-dist-min').then((mod: { default?: unknown }) => (mod.default ?? mod) as PlotlyApi);
  const p = plotlyPromise;
  p.catch(() => {
    plotlyPromise = null;
  });
  return p;
}

export interface PlotlyChartProps {
  data: Record<string, unknown>[];
  layout: PlotLayout;
  /** Accessible name of the figure. */
  ariaLabel: string;
  /** Text equivalent, shown under the chart. */
  summary: string;
}

export function PlotlyChart({ data, layout, ariaLabel, summary }: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

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
    <figure className="hf-figure" aria-label={ariaLabel}>
      <div ref={ref} className="hf-figure__plot" />
      <figcaption className="hf-figure__summary">{summary}</figcaption>
      {error && (
        <Callout tone="warn" title="Chart could not be drawn">
          {error} The text summary above carries the same numbers.
        </Callout>
      )}
    </figure>
  );
}
