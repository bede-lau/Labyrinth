// Thin Plotly adapter for the forecast chart. plotly.js-dist-min (~4.6 MB) is imported lazily, so it stays out
// of the entry chunk; jsdom cannot draw it, so tests mock the module and check the spec it receives.
// The chart is named on its <figure> (DESIGN.md §6), never with role="img" on the element Plotly draws into:
// an img's children are presentational, and Plotly puts its focusable modebar buttons in there.
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Callout, Unit, plotConfig, spokenUnit, type PlotLayout } from '../../design';
import type { CaptionPart, PlotTrace } from './chart';

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
  /** Accessible name of the figure. */
  label: string;
  /**
   * Text equivalent of the chart: the visible figcaption, also the figure's description. A unit part is typeset
   * where it is seen and spoken as words where it is read (DZ3-8), so the description is `spokenCaption(caption)`.
   */
  caption: readonly CaptionPart[];
}

/**
 * A unit inside running text: typeset for the eye (Q with subscript gB,i) and hidden from assistive technology,
 * which reads the spoken copy beside it ("Q gB,i") instead of the run-together "QgB,i".
 */
function CaptionUnit({ unit }: { unit: string }) {
  return (
    <>
      <span aria-hidden="true">
        <Unit unit={unit} />
      </span>
      <span className="lab-visually-hidden">{spokenUnit(unit)}</span>
    </>
  );
}

export function PlotlyChart({ data, layout, label, caption }: PlotlyChartProps) {
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
      .then(
        () => !cancelled && setError(null),
        (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
      );
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
    <figure className="fc-figure" aria-label={label} aria-describedby={`${id}-summary`}>
      <div ref={ref} className="fc-chart" data-testid="forecast-plot" />
      <figcaption id={`${id}-summary`} className="fc-figure__summary">
        {caption.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <CaptionUnit key={i} unit={p.unit} />))}
      </figcaption>
      {error && (
        <Callout tone="warn" title="Chart could not be drawn">
          {error} The text summary above and the steps table below carry the same numbers.
        </Callout>
      )}
    </figure>
  );
}
