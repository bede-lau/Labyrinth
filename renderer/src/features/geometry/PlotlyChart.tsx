// Thin Plotly adapter. plotly.js-dist-min (~4.6 MB) is imported lazily so it is not in the initial
// bundle. jsdom cannot render Plotly; tests mock this module and check the spec passed in.
import { useEffect, useRef, useState } from 'react';
import { Callout, plotConfig } from '../../design';

interface PlotlyApi {
  react: (el: HTMLElement, data: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
  purge: (el: HTMLElement) => void;
}

export interface PlotlyChartProps {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
  /** Accessible name of the chart (role="img"). */
  ariaLabel: string;
  /** id of the visible text summary that describes the chart. */
  describedBy?: string;
  className?: string;
}

export function PlotlyChart({ data, layout, ariaLabel, describedBy, className }: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const plotly = useRef<PlotlyApi | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    // @ts-ignore: plotly.js-dist-min ships no type declarations.
    import('plotly.js-dist-min')
      .then((mod: { default?: unknown }) => {
        if (cancelled || !el) return;
        plotly.current = (mod.default ?? mod) as PlotlyApi;
        return plotly.current.react(el, data, layout, plotConfig());
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [data, layout]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el && plotly.current) plotly.current.purge(el);
    };
  }, []);

  return (
    <>
      <div ref={ref} className={className} role="img" aria-label={ariaLabel} aria-describedby={describedBy} />
      {error && (
        <Callout tone="warn" title="Chart failed to load">
          {error}
        </Callout>
      )}
    </>
  );
}
