import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { GeometryView } from '../features/geometry/GeometryView';
import { LiveView } from '../features/live-gx/LiveView';
import { TransportView } from '../features/transport/TransportView';
import { ForecastView } from '../features/forecast/ForecastView';
import { SpatialView } from '../features/spatial/SpatialView';
import { BudgetView } from '../features/budget/BudgetView';
import { HeatFieldView } from '../features/heatfield/HeatFieldView';
import { useLiveStatus } from '../lib/liveStatus';
import { ViewErrorBoundary } from './ArtifactGate';
import { HeaderBoundary } from './Boundary';
import { ModeAlert, ModeIndicator } from './ModeIndicator';
import { centeredScrollLeft, fadeEdges, type FadeEdges } from './navScroll';
import { ProvenanceLegend } from './ProvenanceLegend';
import { ROUTES, hrefFor, routeDef, sourceLabel, type RouteId } from './routes';
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
  heat: HeatFieldView,
};

export interface AppProps {
  /** Live-status poll interval (ms). */
  pollMs?: number;
}

export function App({ pollMs = 2000 }: AppProps) {
  const route = useHashRoute();
  // The shared store (lib/liveStatus.ts): the views that call useLiveStatus read this same state.
  const live = useLiveStatus(pollMs);
  const def = routeDef(route);
  const View = VIEWS[route];
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shownRoute = useRef(route);
  const [announcement, setAnnouncement] = useState('');
  const [fade, setFade] = useState<FadeEdges>('none');
  // FE2-1: the route whose view failed to render (its boundary is keyed by route, so a new visit starts clean).
  const [failedRoute, setFailedRoute] = useState<RouteId | null>(null);
  const [visited, setVisited] = useState(route);
  if (visited !== route) {
    setVisited(route);
    setFailedRoute(null);
  }

  useEffect(() => {
    document.title = `${def.label} · Labyrinth`;
  }, [def.label]);

  // A route change is announced, and focus follows it to the view unless the keyboard is in the nav
  // (there focus stays on the link, so Tab keeps moving along the views). Nothing on first load.
  useEffect(() => {
    if (shownRoute.current === route) return;
    shownRoute.current = route;
    setAnnouncement(`${routeDef(route).label} view`);
    if (!navRef.current?.contains(document.activeElement)) mainRef.current?.focus({ preventScroll: true });
  }, [route]);

  const syncFade = useCallback(() => {
    const el = scrollRef.current;
    if (el) setFade(fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }, []);

  // Narrow screens: bring the active tab to the middle of the nav. Only the nav scrolls, never the page.
  useEffect(() => {
    const el = scrollRef.current;
    const link = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && link) {
      const box = el.getBoundingClientRect();
      const item = link.getBoundingClientRect();
      el.scrollLeft = centeredScrollLeft(el.clientWidth, el.scrollWidth, item.left - box.left + el.scrollLeft, item.width);
    }
    syncFade();
  }, [route, syncFade]);

  useEffect(() => {
    const el = scrollRef.current;
    el?.addEventListener('scroll', syncFade, { passive: true });
    window.addEventListener('resize', syncFade);
    return () => {
      el?.removeEventListener('scroll', syncFade);
      window.removeEventListener('resize', syncFade);
    };
  }, [syncFade]);

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
          <HeaderBoundary what="mode indicator" resetKey={live}>
            <ModeIndicator state={live} />
          </HeaderBoundary>
          <ThemeSwitch />
        </div>
        <HeaderBoundary what="live-session alert" resetKey={live}>
          <ModeAlert state={live} route={route} viewFailed={failedRoute === route} />
        </HeaderBoundary>
      </header>
      <nav ref={navRef} className="shell-nav" aria-label="Views">
        <div ref={scrollRef} className="shell-nav__scroll" data-fade={fade}>
          <ul className="shell-nav__list">
            {ROUTES.map((r) => (
              <li key={r.id}>
                <a className="shell-nav__link" href={hrefFor(r.id)} aria-current={r.id === route ? 'page' : undefined}>
                  <span className="shell-nav__label">{r.label}</span>
                  <span className="shell-nav__source">{sourceLabel(r.source)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div className="lab-visually-hidden" aria-live="polite" aria-atomic="true" data-testid="route-announcer">
        {announcement}
      </div>
      <main ref={mainRef} id="main" className="shell-main" tabIndex={-1} aria-label={def.label}>
        <ViewErrorBoundary key={route} view={def.label} files={def.files} onError={() => setFailedRoute(route)}>
          <View />
        </ViewErrorBoundary>
      </main>
      <footer className="shell-footer">
        <ProvenanceLegend />
      </footer>
    </div>
  );
}
