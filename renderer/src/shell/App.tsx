import { useEffect, useMemo, type ComponentType } from 'react';
import { GeometryView } from '../features/geometry/GeometryView';
import { LiveView } from '../features/live-gx/LiveView';
import { TransportView } from '../features/transport/TransportView';
import { ForecastView } from '../features/forecast/ForecastView';
import { SpatialView } from '../features/spatial/SpatialView';
import { BudgetView } from '../features/budget/BudgetView';
import { useLiveStatus } from '../lib/liveStatus';
import { ViewErrorBoundary } from './ArtifactGate';
import { backoffFetch } from './liveFetch';
import { ModeIndicator } from './ModeIndicator';
import { ProvenanceLegend } from './ProvenanceLegend';
import { ROUTES, hrefFor, routeDef, type RouteId } from './routes';
import { ThemeSwitch } from './ThemeSwitch';
import { useHashRoute } from './useHashRoute';
import './shell.css';

export const DECISION_QUESTION = 'Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?';

const VIEWS: Record<RouteId, ComponentType> = {
  locate: GeometryView,
  advance: LiveView,
  transport: TransportView,
  forecast: ForecastView,
  spatial: SpatialView,
  budget: BudgetView,
};

export interface AppProps {
  /** Live-status poll interval (ms). */
  pollMs?: number;
}

export function App({ pollMs = 2000 }: AppProps) {
  const route = useHashRoute();
  // Stable across renders (useLiveStatus restarts polling when fetchImpl changes).
  const liveFetch = useMemo(() => backoffFetch(() => globalThis.fetch), []);
  const live = useLiveStatus(pollMs, liveFetch);
  const def = routeDef(route);
  const View = VIEWS[route];

  useEffect(() => {
    document.title = `${def.label} · Labyrinth`;
  }, [def.label]);

  return (
    <div className="shell">
      <a className="shell-skip" href="#main" onClick={(e) => {
        // Hash routing owns location.hash; move focus without changing the route.
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to content
      </a>
      <header className="shell-header">
        <div className="shell-header__brand">
          <p className="shell-header__product">Labyrinth</p>
          <h1 className="shell-header__question">{DECISION_QUESTION}</h1>
          <p className="shell-header__sub">
            The sampled field line, the solver output and an independent reference, side by side. Replay costs $0; live GX
            runs only when the backend qualifies and the $40 budget guard approves.
          </p>
        </div>
        <div className="shell-header__controls">
          <ModeIndicator state={live} />
          <ThemeSwitch />
        </div>
      </header>
      <nav className="shell-nav" aria-label="Views">
        <ul className="shell-nav__list">
          {ROUTES.map((r) => (
            <li key={r.id}>
              <a className="shell-nav__link" href={hrefFor(r.id)} aria-current={r.id === route ? 'page' : undefined}>
                <span className="shell-nav__label">{r.label}</span>
                <span className="shell-nav__source">{r.source === 'live' ? 'GX run · gated' : 'replay'}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" className="shell-main" tabIndex={-1} aria-label={def.label}>
        <ViewErrorBoundary key={route} view={def.label} files={def.files}>
          <View />
        </ViewErrorBoundary>
      </main>
      <footer className="shell-footer">
        <ProvenanceLegend />
      </footer>
    </div>
  );
}
